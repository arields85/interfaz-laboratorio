"""Process-local cooperative exclusion for observed Telegram bot identities.

Channel A (remote query transport) and Channel B (the autonomous local text
channel) must never run the same observed Telegram bot at the same time, and
neither channel may take over the other's live authority. This module owns that
decision and nothing else: reservations are keyed on the identity Telegram
reports through ``getMe`` and never on a token prefix, a persisted state key or
a historical identifier.

Channel B is the channel that consumes this registry today. Channel A is the
intended future consumer, so this module supplies the shared decision for both
while operational exclusion holds only once every live path consumes the same
instance.

The registry is in-memory, process-local and holds no secret. Its lock guards
bounded dictionary state only: no I/O, no storage, no network and no caller
callback ever runs while it is held. Owners and epochs are compared by object
identity, so a lease is authoritative even when a caller object defines a
surprising ``__eq__`` or ``__hash__``. Identifiers must be exact built-in
``int`` values, so an ``int`` subclass can never run its own comparison, hash or
conversion callback against the registry lock.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass

from .channel_a_bot import MAX_TELEGRAM_ID


TELEGRAM_BOT_IDENTITY_RESERVED = "TELEGRAM_BOT_IDENTITY_RESERVED"
TELEGRAM_BOT_IDENTITY_INVALID = "TELEGRAM_BOT_IDENTITY_INVALID"

_INITIALIZATION_LOCK = threading.Lock()
_PROCESS_RESERVATION: "BotIdentityReservation | None" = None


class BotIdentityReservationError(RuntimeError):
    """Fixed, sanitized refusal raised when a live reservation already exists.

    The message is a closed constant and no caller-supplied value is ever
    attached, so a rejected acquisition can never leak a token, a path or any
    other detail through the error surface.
    """

    def __init__(self) -> None:
        super().__init__(TELEGRAM_BOT_IDENTITY_RESERVED)


@dataclass(frozen=True, slots=True, eq=False)
class BotIdentityLease:
    """Opaque, immutable ownership record for one observed bot identity.

    ``owner`` and ``epoch`` are compared by identity, never by equality or
    hashing, so a lease is a stable handle rather than a value object. The
    record is frozen: retargeting ``bot_id`` would strand the live entry it can
    no longer release, and retargeting ``owner``/``epoch`` would rewrite who is
    authorized.
    """

    bot_id: int
    owner: object
    epoch: object


@dataclass(frozen=True, slots=True, eq=False)
class BotIdentityOccupancy:
    """Immutable, non-authoritative view of one live reservation.

    It publishes only the identifier that ``getMe`` already exposed. It
    deliberately withholds the owner and the activation epoch: the owner object
    is what retains the releasable lease, so publishing it would surrender the
    very handle this view exists to keep private.
    """

    bot_id: int


def _is_valid_bot_id(value: object) -> bool:
    """Non-raising exact-identifier test for no-op decision paths.

    The check is ``type(value) is int`` rather than ``isinstance``: an ``int``
    subclass (including ``bool``) could otherwise run a caller-supplied
    ``__eq__``, ``__hash__`` or ``__index__`` while the leaf registry lock is
    held. Rejection happens before any comparison, conversion, hashing or lock.
    """
    return type(value) is int and 1 <= value <= MAX_TELEGRAM_ID


def _validated_bot_id(value: object) -> int:
    """Require a positive exact built-in ``int`` identifier within the bound."""
    if not _is_valid_bot_id(value):
        raise ValueError(TELEGRAM_BOT_IDENTITY_INVALID)
    return value


class BotIdentityReservation:
    """Thread-safe map from an observed bot identity to its single live lease."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._leases: dict[int, BotIdentityLease] = {}

    def acquire(self, bot_id: object, *, owner: object, epoch: object) -> BotIdentityLease:
        """Reserve ``bot_id`` for ``owner``/``epoch`` or return the existing lease.

        Re-entering with the exact same owner and epoch is idempotent. Any other
        live lease — including one held by the same channel label under a new
        epoch — is refused with the fixed reservation error and no mutation.
        """
        key = _validated_bot_id(bot_id)
        with self._lock:
            existing = self._leases.get(key)
            if existing is None:
                lease = BotIdentityLease(key, owner, epoch)
                self._leases[key] = lease
                return lease
            if existing.owner is owner and existing.epoch is epoch:
                return existing
            raise BotIdentityReservationError()

    def release(self, lease: object) -> bool:
        """Release exactly ``lease``; a stale, foreign or inspection handle no-ops.

        Only an exact ``BotIdentityLease`` carrying a proven exact built-in
        identifier key is considered. A lease subclass could turn ``bot_id``
        into an attribute hook, and a subclassed key could run its own hash or
        comparison, so both are rejected before any callback, lock or
        dictionary access; a rejected handle never touches live authority.
        """
        if type(lease) is not BotIdentityLease:
            return False
        key = lease.bot_id
        if not _is_valid_bot_id(key):
            return False
        with self._lock:
            if self._leases.get(key) is lease:
                del self._leases[key]
                return True
            return False

    def held_by(self, bot_id: object) -> BotIdentityOccupancy | None:
        """Return an immutable, non-releasable occupancy view, never the lease."""
        key = _validated_bot_id(bot_id)
        with self._lock:
            lease = self._leases.get(key)
            return None if lease is None else BotIdentityOccupancy(lease.bot_id)


def process_bot_identity_reservation() -> BotIdentityReservation:
    """Return the single process-wide registry, creating it exactly once.

    Channel B is the autonomous local text channel and binds its manager
    factory, standalone bots and ``create_app`` to this instance so no code path
    can quietly introduce a second, disjoint registry. Channel A is the intended
    future consumer of the same instance. Tests inject fresh instances instead
    of resetting this one.
    """
    global _PROCESS_RESERVATION
    with _INITIALIZATION_LOCK:
        if _PROCESS_RESERVATION is None:
            _PROCESS_RESERVATION = BotIdentityReservation()
        return _PROCESS_RESERVATION
