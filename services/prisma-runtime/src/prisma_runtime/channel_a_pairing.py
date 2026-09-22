"""Channel A pairing domain: single-use QR challenge -> pending claim -> confirmed link.

Pure, in-process state machine for the remote pairing channel. It owns only the
pairing invariants; it never performs I/O.

Integration obligations (deliberately outside this module):

* Domain validity is not delivery. A returned challenge means "this owner is
  allowed one QR"; it does **not** guarantee that the QR reached the phone, that
  the callback ticket reached the adapter, or that anything was delivered
  atomically. The transport layer must decide delivery and retries.
* Pairing state never cancels audio that is already playing. Stopping or
  replacing playback is the caller's decision.
* This module imports no transport, HTTP, bot, credential, configuration or
  storage code, and it holds no persistent state. Restarting the process loses
  every challenge, pending claim and link by design.
* `owner_id` is the HMI session owner identity produced by
  `HmiSessionRegistry` (a canonical lowercase UUID string). A capability, admin
  or bot secret is never a valid owner identity here. The UUID shape check is a
  fail-closed shape validation, not proof of authority and not a guarantee that
  every possible secret is excluded: authority comes from the authenticated
  adapter together with the phone identity and the current generation, never
  from the owner id alone.
* `phone_id` must come from the authenticated private-chat actor resolved by the
  Telegram adapter. It is never taken from an untrusted request body.
* Liveness and freshness of the HMI session are checked separately by the caller
  (see `HmiSessionRegistry.get_owner_context`); this module only validates the
  pairing generation.
* Owner-side invalidation is an internal, trusted operation. Later integration
  wires it to HMI session removal by calling `invalidate_owner`.
* The injected `clock` and `entropy` are trusted infrastructure functions, not
  lifecycle callbacks: the registry invokes them deliberately, including while
  the lock is held. They must be bounded and non-reentrant -- they must never
  call back into the registry and must never block. Every other external
  callback (owner-removal notifications, delivery, playback control) belongs to
  the caller and never runs under the domain lock.
* `clock` defaults to `time.monotonic` and produces a monotonic clock domain,
  not Unix epoch timestamps. Every serialized transition samples the clock
  inside the lock, rejects a sample below the last observed value, and validates
  every computed deadline as a finite value strictly in the future before it
  consumes a challenge or a ticket or mutates activity state. A broken clock
  therefore fails closed instead of bypassing a deadline. Public snapshots carry
  those raw monotonic values; projecting them to wall-clock time or to remaining
  durations is the adapter's responsibility.

Error taxonomy (all raised as `str(error)` codes): `PRISMA_CHANNEL_A_IDENTITY_REQUIRED`,
`PRISMA_CHANNEL_A_TOKEN_REQUIRED`, `PRISMA_CHANNEL_A_TICKET_REQUIRED`,
`PRISMA_CHANNEL_A_OWNER_UNAVAILABLE`, `PRISMA_CHANNEL_A_CONFLICT`,
`PRISMA_CHANNEL_A_STALE_GENERATION`, `PRISMA_CHANNEL_A_CAPACITY`,
`PRISMA_CHANNEL_A_CONFIG_INVALID`, `PRISMA_CHANNEL_A_CLOCK_INVALID`,
`PRISMA_CHANNEL_A_UNAVAILABLE`.
"""

from __future__ import annotations

import base64
import hashlib
import itertools
import math
import secrets
import threading
import time
import uuid
from dataclasses import dataclass, field

PRISMA_CHANNEL_A_IDENTITY_REQUIRED = "PRISMA_CHANNEL_A_IDENTITY_REQUIRED"
PRISMA_CHANNEL_A_TOKEN_REQUIRED = "PRISMA_CHANNEL_A_TOKEN_REQUIRED"
PRISMA_CHANNEL_A_TICKET_REQUIRED = "PRISMA_CHANNEL_A_TICKET_REQUIRED"
PRISMA_CHANNEL_A_OWNER_UNAVAILABLE = "PRISMA_CHANNEL_A_OWNER_UNAVAILABLE"
PRISMA_CHANNEL_A_CONFLICT = "PRISMA_CHANNEL_A_CONFLICT"
PRISMA_CHANNEL_A_STALE_GENERATION = "PRISMA_CHANNEL_A_STALE_GENERATION"
PRISMA_CHANNEL_A_CAPACITY = "PRISMA_CHANNEL_A_CAPACITY"
PRISMA_CHANNEL_A_CONFIG_INVALID = "PRISMA_CHANNEL_A_CONFIG_INVALID"
PRISMA_CHANNEL_A_CLOCK_INVALID = "PRISMA_CHANNEL_A_CLOCK_INVALID"
PRISMA_CHANNEL_A_UNAVAILABLE = "PRISMA_CHANNEL_A_UNAVAILABLE"

# 32 bytes of entropy render as 43 URL-safe characters, under the 64-character
# payload and 64-byte callback-ticket limits of the Telegram transport.
OPAQUE_BYTES = 32
OPAQUE_CHARS = 43
MAX_IDENTITY_CHARS = 255

__all__ = [
    "PRISMA_CHANNEL_A_CAPACITY",
    "PRISMA_CHANNEL_A_CLOCK_INVALID",
    "PRISMA_CHANNEL_A_CONFIG_INVALID",
    "PRISMA_CHANNEL_A_CONFLICT",
    "PRISMA_CHANNEL_A_IDENTITY_REQUIRED",
    "PRISMA_CHANNEL_A_OWNER_UNAVAILABLE",
    "PRISMA_CHANNEL_A_STALE_GENERATION",
    "PRISMA_CHANNEL_A_TICKET_REQUIRED",
    "PRISMA_CHANNEL_A_TOKEN_REQUIRED",
    "PRISMA_CHANNEL_A_UNAVAILABLE",
    "ChannelAPairingCapacity",
    "ChannelAPairingConfigInvalid",
    "ChannelAPairingConflict",
    "ChannelAPairingError",
    "ChannelAPairingRegistry",
    "ChannelAPairingStaleGeneration",
    "ChannelAPairingUnauthorized",
    "OwnerRelease",
    "PairingLink",
    "PendingClaim",
    "QrChallenge",
]


class ChannelAPairingError(RuntimeError):
    """Base failure for the Channel A pairing domain."""


class ChannelAPairingUnauthorized(ChannelAPairingError):
    """The caller presented an unknown, expired, replayed or foreign credential."""


class ChannelAPairingCapacity(ChannelAPairingError):
    """The bounded registry is full and nothing live may be evicted."""


class ChannelAPairingConflict(ChannelAPairingError):
    """The owner or the phone is already reserved by a pending claim or a link."""


class ChannelAPairingStaleGeneration(ChannelAPairingError):
    """The caller holds a generation that is no longer the current link."""


class ChannelAPairingConfigInvalid(ChannelAPairingError):
    """The registry was configured, or is being driven, with unusable values."""


@dataclass(frozen=True)
class QrChallenge:
    """One single-use, owner-bound QR challenge. The token is redacted from repr."""

    owner_id: str
    token: str = field(repr=False)
    issued_at: float
    expires_at: float

    def as_dict(self) -> dict:
        return {
            "ownerId": self.owner_id,
            "token": self.token,
            "issuedAt": self.issued_at,
            "expiresAt": self.expires_at,
        }


@dataclass(frozen=True)
class PendingClaim:
    """A claimed QR waiting for confirmation. The callback ticket stays with the caller."""

    owner_id: str
    phone_id: str
    claimed_at: float
    expires_at: float

    def as_dict(self) -> dict:
        return {
            "ownerId": self.owner_id,
            "phoneId": self.phone_id,
            "claimedAt": self.claimed_at,
            "expiresAt": self.expires_at,
        }


@dataclass(frozen=True)
class PairingLink:
    """A confirmed owner/phone link with its generation and human-activity deadline."""

    owner_id: str
    phone_id: str
    generation: int
    confirmed_at: float
    last_human_activity_at: float
    idle_expires_at: float
    warning_issued: bool

    def as_dict(self) -> dict:
        return {
            "ownerId": self.owner_id,
            "phoneId": self.phone_id,
            "generation": self.generation,
            "confirmedAt": self.confirmed_at,
            "lastHumanActivityAt": self.last_human_activity_at,
            "idleExpiresAt": self.idle_expires_at,
            "warningIssued": self.warning_issued,
        }


@dataclass(frozen=True)
class OwnerRelease:
    """What an owner invalidation actually released."""

    owner_id: str
    released_link: bool
    released_pending: bool
    released_qr: bool

    def as_dict(self) -> dict:
        return {
            "ownerId": self.owner_id,
            "releasedLink": self.released_link,
            "releasedPending": self.released_pending,
            "releasedQr": self.released_qr,
        }


@dataclass
class _Challenge:
    owner_id: str
    token: str = field(repr=False)
    issued_at: float
    expires_at: float


@dataclass
class _Pending:
    owner_id: str
    phone_id: str
    claimed_at: float
    expires_at: float


@dataclass
class _Link:
    owner_id: str
    phone_id: str
    generation: int
    confirmed_at: float
    last_human_activity_at: float
    idle_expires_at: float
    warning_issued: bool


def _numeric(value, code: str) -> float:
    """Normalize a numeric input into a float, or fail closed with ``code``."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ChannelAPairingConfigInvalid(code)
    try:
        return float(value)
    except OverflowError:
        raise ChannelAPairingConfigInvalid(code) from None


def _positive_seconds(value) -> float:
    number = _numeric(value, PRISMA_CHANNEL_A_CONFIG_INVALID)
    if not math.isfinite(number) or number <= 0:
        raise ChannelAPairingConfigInvalid(PRISMA_CHANNEL_A_CONFIG_INVALID)
    return number


def _clock_sample(value) -> float:
    """Normalize one clock sample into the monotonic domain or fail closed."""
    number = _numeric(value, PRISMA_CHANNEL_A_CLOCK_INVALID)
    if not math.isfinite(number) or number < 0.0:
        raise ChannelAPairingConfigInvalid(PRISMA_CHANNEL_A_CLOCK_INVALID)
    return number


def _deadline(now: float, ttl: float) -> float:
    """Return a finite future deadline, or fail closed instead of truncating."""
    deadline = now + ttl
    if not math.isfinite(deadline) or deadline <= now:
        raise ChannelAPairingConfigInvalid(PRISMA_CHANNEL_A_CLOCK_INVALID)
    return deadline


def _positive_count(value) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ChannelAPairingConfigInvalid(PRISMA_CHANNEL_A_CONFIG_INVALID)
    return value


def _identity(value, *, owner: bool) -> str:
    if not isinstance(value, str) or not value or len(value) > MAX_IDENTITY_CHARS:
        raise ChannelAPairingUnauthorized(PRISMA_CHANNEL_A_IDENTITY_REQUIRED)
    if not value.isascii() or not value.isprintable() or value != value.strip():
        raise ChannelAPairingUnauthorized(PRISMA_CHANNEL_A_IDENTITY_REQUIRED)
    if owner:
        try:
            parsed = uuid.UUID(value)
        except (ValueError, AttributeError, TypeError):
            raise ChannelAPairingUnauthorized(PRISMA_CHANNEL_A_IDENTITY_REQUIRED) from None
        if str(parsed) != value:
            raise ChannelAPairingUnauthorized(PRISMA_CHANNEL_A_IDENTITY_REQUIRED)
    return value


def _generation(value) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ChannelAPairingStaleGeneration(PRISMA_CHANNEL_A_STALE_GENERATION)
    return value


def _link_snapshot(link: _Link) -> PairingLink:
    return PairingLink(
        link.owner_id,
        link.phone_id,
        link.generation,
        link.confirmed_at,
        link.last_human_activity_at,
        link.idle_expires_at,
        link.warning_issued,
    )


class ChannelAPairingRegistry:
    """Bounded, thread-safe, in-memory pairing state for one Channel A bot.

    ``warning_lead`` is required: the product owns the human-idle TTL, but the
    warning lead must be injected because it is not a product constant yet. It
    must be a positive finite number strictly below ``human_idle_ttl``.
    """

    def __init__(
        self,
        *,
        warning_lead,
        clock=time.monotonic,
        entropy=secrets.token_bytes,
        qr_ttl=60.0,
        human_idle_ttl=600.0,
        max_challenges=64,
        max_pairings=64,
    ):
        self.warning_lead = _positive_seconds(warning_lead)
        self.qr_ttl = _positive_seconds(qr_ttl)
        self.human_idle_ttl = _positive_seconds(human_idle_ttl)
        if self.warning_lead >= self.human_idle_ttl:
            raise ChannelAPairingConfigInvalid(PRISMA_CHANNEL_A_CONFIG_INVALID)
        self.max_challenges = _positive_count(max_challenges)
        self.max_pairings = _positive_count(max_pairings)
        self.clock = clock
        self.entropy = entropy
        self.lock = threading.RLock()
        self._last_observed: float | None = None
        self._challenges: dict[bytes, _Challenge] = {}
        self._challenge_owner: dict[str, bytes] = {}
        self._pendings: dict[bytes, _Pending] = {}
        self._pending_owner: dict[str, bytes] = {}
        self._pending_phone: dict[str, bytes] = {}
        self._links: dict[str, _Link] = {}
        self._phone_link: dict[str, str] = {}
        self._generations = itertools.count(1)

    # -- public operations -------------------------------------------------

    def issue_qr(self, owner_id: str) -> QrChallenge:
        """Return the owner's one live challenge, minting it when none is live.

        Repeated calls return the same token and the same deadline; retrieval
        never extends the challenge. A linked or pending owner is refused.
        """
        owner = _identity(owner_id, owner=True)
        with self.lock:
            now = self._now()
            self._purge_locked(now)
            if owner in self._links or owner in self._pending_owner:
                raise ChannelAPairingConflict(PRISMA_CHANNEL_A_CONFLICT)
            digest = self._challenge_owner.get(owner)
            if digest is not None and digest in self._challenges:
                live = self._challenges[digest]
                return QrChallenge(owner, live.token, live.issued_at, live.expires_at)
            if len(self._challenges) >= self.max_challenges:
                raise ChannelAPairingCapacity(PRISMA_CHANNEL_A_CAPACITY)
            expires_at = _deadline(now, self.qr_ttl)
            token, digest = self._mint_locked()
            self._challenges[digest] = _Challenge(owner, token, now, expires_at)
            self._challenge_owner[owner] = digest
            return QrChallenge(owner, token, now, expires_at)

    def claim_qr(self, token: str, phone_id: str) -> tuple[str, PendingClaim]:
        """Consume one challenge into a pending confirmation bound to ``phone_id``.

        Returns ``(ticket, pending)``. The ticket is a separate opaque secret and
        is never stored; consuming the QR creates no link by itself.
        """
        phone = _identity(phone_id, owner=False)
        digest = self._opaque(token, PRISMA_CHANNEL_A_TOKEN_REQUIRED)
        with self.lock:
            now = self._now()
            self._purge_locked(now)
            challenge = self._challenges.get(digest)
            if challenge is None:
                raise ChannelAPairingUnauthorized(PRISMA_CHANNEL_A_TOKEN_REQUIRED)
            owner = challenge.owner_id
            if owner in self._links or owner in self._pending_owner:
                raise ChannelAPairingConflict(PRISMA_CHANNEL_A_CONFLICT)
            if phone in self._phone_link or phone in self._pending_phone:
                raise ChannelAPairingConflict(PRISMA_CHANNEL_A_CONFLICT)
            if len(self._pendings) + len(self._links) >= self.max_pairings:
                raise ChannelAPairingCapacity(PRISMA_CHANNEL_A_CAPACITY)
            ticket, ticket_digest = self._mint_locked()
            self._challenges.pop(digest, None)
            if self._challenge_owner.get(owner) == digest:
                self._challenge_owner.pop(owner, None)
            self._pendings[ticket_digest] = _Pending(owner, phone, now, challenge.expires_at)
            self._pending_owner[owner] = ticket_digest
            self._pending_phone[phone] = ticket_digest
            return ticket, PendingClaim(owner, phone, now, challenge.expires_at)

    def cancel_pending(self, ticket: str, phone_id: str) -> PendingClaim:
        """Release a pending confirmation. Only the claiming phone may cancel it."""
        phone = _identity(phone_id, owner=False)
        digest = self._opaque(ticket, PRISMA_CHANNEL_A_TICKET_REQUIRED)
        with self.lock:
            now = self._now()
            self._purge_locked(now)
            pending = self._pendings.get(digest)
            if pending is None or pending.phone_id != phone:
                raise ChannelAPairingUnauthorized(PRISMA_CHANNEL_A_TICKET_REQUIRED)
            self._release_pending_locked(digest)
            return PendingClaim(pending.owner_id, pending.phone_id, pending.claimed_at, pending.expires_at)

    def confirm(self, ticket: str, phone_id: str) -> PairingLink:
        """Turn a pending confirmation into the current link for a fresh generation."""
        phone = _identity(phone_id, owner=False)
        digest = self._opaque(ticket, PRISMA_CHANNEL_A_TICKET_REQUIRED)
        with self.lock:
            now = self._now()
            self._purge_locked(now)
            pending = self._pendings.get(digest)
            if pending is None or pending.phone_id != phone:
                raise ChannelAPairingUnauthorized(PRISMA_CHANNEL_A_TICKET_REQUIRED)
            owner = pending.owner_id
            if owner in self._links or phone in self._phone_link:
                raise ChannelAPairingConflict(PRISMA_CHANNEL_A_CONFLICT)
            idle_expires_at = _deadline(now, self.human_idle_ttl)
            self._release_pending_locked(digest)
            generation = next(self._generations)
            self._links[owner] = _Link(owner, phone, generation, now, now, idle_expires_at, False)
            self._phone_link[phone] = owner
            return self._snapshot_locked(owner)

    def owner_link(self, owner_id: str) -> PairingLink | None:
        """Current link for an owner, or ``None``. A technical read, never a refresh."""
        owner = _identity(owner_id, owner=True)
        with self.lock:
            now = self._now()
            self._purge_locked(now)
            if owner not in self._links:
                return None
            return self._snapshot_locked(owner)

    def owner_state(self, owner_id: str) -> str:
        """Project ``'free' | 'pending' | 'linked'`` for one owner.

        A technical observation like :meth:`owner_link`: under the existing
        lock, sampling the same validated clock and purging the same
        expirations, but never minting a challenge, never touching a
        human-activity deadline and never creating state. A live unclaimed
        challenge is not a state of its own: an owner with only a QR still
        reads ``free`` until the phone claims it.
        """
        owner = _identity(owner_id, owner=True)
        with self.lock:
            now = self._now()
            self._purge_locked(now)
            if owner in self._links:
                return "linked"
            if owner in self._pending_owner:
                return "pending"
            return "free"

    def challenge_remaining_seconds(self, challenge: QrChallenge) -> float | None:
        """Remaining seconds of one issued challenge, or ``None`` when not live.

        Internal QR-projection helper for the activation's closed view: it
        reuses the registry's own clock validation and monotonic watermark, so
        a backwards post-issuance sample fails closed instead of extending
        remaining time. The challenge must still be live with the same token
        and deadline after the purge; the read never mints, extends or touches
        anything, and an unusable clock keeps its native config error.
        """
        if type(challenge) is not QrChallenge:
            return None
        with self.lock:
            now = self._now()
            self._purge_locked(now)
            digest = self._challenge_owner.get(challenge.owner_id)
            live = self._challenges.get(digest) if digest is not None else None
            if live is None or live.token != challenge.token or live.expires_at != challenge.expires_at:
                return None
            remaining = live.expires_at - now
            if not math.isfinite(remaining) or remaining <= 0.0:
                return None
            return remaining

    def _capture_link_witness(self, owner_id, generation):
        """Capture identity only; no clock sample or liveness assertion."""
        if type(owner_id) is not str or type(generation) is not int or generation <= 0:
            return None
        with self.lock:
            link = self._links.get(owner_id)
            if link is None or link.generation != generation:
                return None
            return owner_id, link, generation

    def _link_witness_matches(self, witness) -> bool:
        """Compare owned link identity without callbacks, renewal or expiry work."""
        if type(witness) is not tuple or len(witness) != 3:
            return False
        owner, link, generation = witness
        if type(owner) is not str or type(link) is not _Link or type(generation) is not int:
            return False
        with self.lock:
            return (
                self._links.get(owner) is link
                and link.owner_id == owner
                and link.generation == generation
            )

    def is_owner_link_current(self, owner_id: str, generation: int) -> bool:
        """Observe live generation without purging, touching or advancing the clock."""
        try:
            if type(owner_id) is not str or type(generation) is not int:
                return False
            owner = _identity(owner_id, owner=True)
            generation = _generation(generation)
            with self.lock:
                # _now updates the watermark; this read only compares against it.
                now = _clock_sample(self.clock())
                if self._last_observed is not None and now < self._last_observed:
                    return False
                link = self._links.get(owner)
                return (
                    link is not None
                    and link.generation == generation
                    and now >= link.last_human_activity_at
                    and now < link.idle_expires_at
                )
        except Exception:
            return False

    def phone_link(self, phone_id: str) -> PairingLink | None:
        """Current link for a phone, or ``None``. A technical read, never a refresh."""
        phone = _identity(phone_id, owner=False)
        with self.lock:
            now = self._now()
            self._purge_locked(now)
            owner = self._phone_link.get(phone)
            if owner is None or owner not in self._links:
                return None
            return self._snapshot_locked(owner)

    def validate_result(self, phone_id: str, generation: int) -> str:
        """Return the owner a result may be delivered to, for the current generation only."""
        phone = _identity(phone_id, owner=False)
        generation = _generation(generation)
        with self.lock:
            now = self._now()
            self._purge_locked(now)
            return self._require_link_locked(phone, generation).owner_id

    def human_touch(self, phone_id: str, generation: int) -> PairingLink:
        """Admit one human interaction and renew the idle window for this generation."""
        phone = _identity(phone_id, owner=False)
        generation = _generation(generation)
        with self.lock:
            now = self._now()
            self._purge_locked(now)
            link = self._require_link_locked(phone, generation)
            if now < link.last_human_activity_at:
                raise ChannelAPairingConfigInvalid(PRISMA_CHANNEL_A_CLOCK_INVALID)
            idle_expires_at = _deadline(now, self.human_idle_ttl)
            link.last_human_activity_at = now
            link.idle_expires_at = idle_expires_at
            link.warning_issued = False
            return self._snapshot_locked(link.owner_id)

    def warning_due(self, phone_id: str, generation: int) -> bool:
        """Report, at most once per human-activity window, that the idle warning is due."""
        phone = _identity(phone_id, owner=False)
        generation = _generation(generation)
        with self.lock:
            now = self._now()
            self._purge_locked(now)
            link = self._require_link_locked(phone, generation)
            if not self._warning_due_locked(link, now):
                return False
            link.warning_issued = True
            return True

    def due_warnings(self) -> tuple[PairingLink, ...]:
        """Reserve, at most once per human-activity window, every due live link.

        Public and atomic: under the registry lock it samples the validated
        monotonic clock, purges expirations, marks each eligible warning and
        returns an immutable, bounded tuple of existing snapshots. The shared
        predicate with :meth:`warning_due` means a concurrent individual
        reservation and a batch sweep can never spend the same window twice.
        The reservation is one *attempt*, not a delivery: a caller that fails to
        notify gets no second reservation for that window. A technical sweep
        never renews ``last_human_activity_at`` or ``idle_expires_at``, and no
        callback runs under this lock.
        """
        with self.lock:
            now = self._now()
            self._purge_locked(now)
            due = []
            for owner_id in list(self._links):
                link = self._links.get(owner_id)
                if link is None or not self._warning_due_locked(link, now):
                    continue
                link.warning_issued = True
                due.append(_link_snapshot(link))
            return tuple(due)

    def unlink_phone(self, phone_id: str, generation: int) -> PairingLink:
        """Release one phone's link. A stale generation can never touch a replacement."""
        phone = _identity(phone_id, owner=False)
        generation = _generation(generation)
        with self.lock:
            now = self._now()
            self._purge_locked(now)
            link = self._require_link_locked(phone, generation)
            self._release_link_locked(link.owner_id)
            return _link_snapshot(link)

    def invalidate_owner(self, owner_id: str) -> OwnerRelease:
        """Trusted internal owner invalidation: drop link, pending claim and challenge."""
        owner = _identity(owner_id, owner=True)
        with self.lock:
            now = self._now()
            self._purge_locked(now)
            released_link = owner in self._links
            if released_link:
                self._release_link_locked(owner)
            pending_digest = self._pending_owner.get(owner)
            released_pending = pending_digest is not None and pending_digest in self._pendings
            if released_pending:
                self._release_pending_locked(pending_digest)
            challenge_digest = self._challenge_owner.get(owner)
            released_qr = challenge_digest is not None and challenge_digest in self._challenges
            if released_qr:
                self._challenges.pop(challenge_digest, None)
                self._challenge_owner.pop(owner, None)
            return OwnerRelease(owner, released_link, released_pending, released_qr)

    # -- internals ---------------------------------------------------------

    def _now(self) -> float:
        """Sample the clock under the lock and keep the monotonic watermark."""
        try:
            sample = self.clock()
        except Exception:
            raise ChannelAPairingConfigInvalid(PRISMA_CHANNEL_A_CLOCK_INVALID) from None
        number = _clock_sample(sample)
        if self._last_observed is not None and number < self._last_observed:
            raise ChannelAPairingConfigInvalid(PRISMA_CHANNEL_A_CLOCK_INVALID)
        self._last_observed = number
        return number

    @staticmethod
    def _opaque(value, code: str) -> bytes:
        if not isinstance(value, str) or len(value) != OPAQUE_CHARS or not value.isascii():
            raise ChannelAPairingUnauthorized(code)
        try:
            raw = base64.urlsafe_b64decode(value + "=")
        except (ValueError, TypeError):
            raise ChannelAPairingUnauthorized(code) from None
        if len(raw) != OPAQUE_BYTES:
            raise ChannelAPairingUnauthorized(code)
        if base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=") != value:
            raise ChannelAPairingUnauthorized(code)
        return hashlib.sha256(raw).digest()

    def _mint_locked(self) -> tuple[str, bytes]:
        try:
            raw = bytes(self.entropy(OPAQUE_BYTES))
        except Exception:
            raise ChannelAPairingError(PRISMA_CHANNEL_A_UNAVAILABLE) from None
        if len(raw) != OPAQUE_BYTES:
            raise ChannelAPairingError(PRISMA_CHANNEL_A_UNAVAILABLE)
        digest = hashlib.sha256(raw).digest()
        if digest in self._challenges or digest in self._pendings:
            raise ChannelAPairingError(PRISMA_CHANNEL_A_UNAVAILABLE)
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("="), digest

    def _purge_locked(self, now: float) -> None:
        for digest, challenge in list(self._challenges.items()):
            if now >= challenge.expires_at:
                self._challenges.pop(digest, None)
                if self._challenge_owner.get(challenge.owner_id) == digest:
                    self._challenge_owner.pop(challenge.owner_id, None)
        for pending_digest, pending in list(self._pendings.items()):
            if now >= pending.expires_at:
                self._release_pending_locked(pending_digest)
        for owner in list(self._links):
            link = self._links[owner]
            if now >= link.idle_expires_at:
                self._release_link_locked(owner)

    def _release_pending_locked(self, digest: bytes) -> None:
        pending = self._pendings.pop(digest, None)
        if pending is None:
            return
        if self._pending_owner.get(pending.owner_id) == digest:
            self._pending_owner.pop(pending.owner_id, None)
        if self._pending_phone.get(pending.phone_id) == digest:
            self._pending_phone.pop(pending.phone_id, None)

    def _release_link_locked(self, owner_id: str) -> None:
        link = self._links.pop(owner_id, None)
        if link is None:
            return
        if self._phone_link.get(link.phone_id) == owner_id:
            self._phone_link.pop(link.phone_id, None)

    def _require_link_locked(self, phone: str, generation: int) -> _Link:
        owner = self._phone_link.get(phone)
        link = self._links.get(owner) if owner is not None else None
        if link is None:
            raise ChannelAPairingUnauthorized(PRISMA_CHANNEL_A_OWNER_UNAVAILABLE)
        if link.generation != generation:
            raise ChannelAPairingStaleGeneration(PRISMA_CHANNEL_A_STALE_GENERATION)
        return link

    def _warning_due_locked(self, link: _Link, now: float) -> bool:
        """Shared warning predicate: never reserved and inside the warning lead."""
        return not link.warning_issued and link.idle_expires_at - now <= self.warning_lead

    def _snapshot_locked(self, owner_id: str) -> PairingLink:
        return _link_snapshot(self._links[owner_id])
