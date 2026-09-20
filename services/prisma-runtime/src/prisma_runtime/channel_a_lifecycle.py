"""Standalone Channel A activation runner (RCA-5c).

Scope
-----
One Channel A activation: prepare an identity reservation, own exactly one
polling loop, hand every completed ingress outcome to a required synchronous
consumer, and settle deterministically. This module is the *only* place that
owns a Channel A ``getUpdates`` offset; neither the adapter nor the transport
keeps one.

Deliberately absent: credentials, an operator/manager process, bootstrap and
``create_app`` wiring, the warning scheduler, persisted policy, any HTTP or
admin projection, webhook inspection or mutation, and any transport ``close()``
that does not exist on the accepted RCA-5a transport. A later manager owns
automatic replacement; this unit never replaces a retired activation by itself.
A later warning seam must acquire the same owned-operation admission instead of
calling the dialogue directly.

Ownership model
---------------
* One *admission* is outstanding at a time. Preparation, a direct ``poll_once``
  and the managed loop all take it, so a second actor can only observe a fixed
  ``busy`` refusal; it never mutates the incumbent activity.
* The lifecycle re-entrant lock guards internal state only. It is never held
  across a foreign call: the clock, the transport, the pairing registry, the
  dialogue factory, the injected dialogue, the outcome consumer, the reservation
  or ``thread.join``.
* A stop request is a sticky fence set before any waiting, and it is rechecked
  after every foreign call and before every further handler. A stop issued from
  the thread that owns admission never joins itself and reports ``False`` while
  owned work remains.
* Terminal failure and idle retirement are final. There is no retry, no backoff
  and no reactivation: a stopped, failed or retired instance can only be asked
  to release-again via ``stop``.

Identity and freshness
----------------------
The trusted factory must build a NEW :class:`ChannelAPairingDialogue` over a NEW
EMPTY :class:`ChannelAPairingRegistry` and a fresh adapter epoch each time. An
activation never inherits a prior activation's links; the runner validates the
identity match but never reuses a retained dialogue.

Idle retirement limitation
--------------------------
Retirement uses the documented seven-day protocol horizon rather than the
600-second human idle TTL. This is LOCAL retirement, not lossless Telegram
discontinuity handling: a Telegram receipt time is not a generation time, and a
suspension or a backlog can let an already-issued long poll acknowledge a lower
update identifier that resets after the discontinuity. A later manager must
await quiescence, detach the old authority and create an entirely fresh
activation with a fresh empty pairing registry and ``cursor = None``. This unit
deliberately performs no automatic replacement and no lossless provider
identifier reset, so that limitation stays visible in
:data:`PRISMA_CHANNEL_A_RESTART_REQUIRED`.
"""

from __future__ import annotations

import math
import re
import threading
from collections.abc import Mapping
from dataclasses import dataclass

from .bot_identity_reservation import (
    BotIdentityReservationError,
    process_bot_identity_reservation,
)
from .channel_a_bot import (
    MAX_TELEGRAM_ID,
    ChannelAPairingDialogue,
    IngressOutcome,
)
from .channel_a_pairing import ChannelAPairingRegistry
from .channel_a_transport import (
    GET_UPDATES_LIMIT,
    ChannelABotIdentity,
)

__all__ = [
    "DISPOSITION_BUSY",
    "DISPOSITION_COMPLETED",
    "DISPOSITION_FAILED",
    "DISPOSITION_RESTART_REQUIRED",
    "DISPOSITION_STOPPED",
    "MAX_LIFECYCLE_WAIT_SECONDS",
    "PHASE_FAILED",
    "PHASE_IDLE",
    "PHASE_PREPARED",
    "PHASE_PREPARING",
    "PHASE_RETIRED",
    "PHASE_RUNNING",
    "PHASE_STOPPED",
    "PHASE_STOPPING",
    "PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE",
    "PRISMA_CHANNEL_A_RESTART_REQUIRED",
    "SEVEN_DAY_HORIZON_SECONDS",
    "TELEGRAM_BOT_IDENTITY_RESERVED",
    "ChannelALifecycleError",
    "ChannelAPollResult",
    "ChannelARunner",
    "ChannelAStatus",
]

# One fixed, non-disclosing code for every invalid dependency, malformed batch,
# invalid clock and terminal runtime failure. The caller can never distinguish a
# token, a URL, a response body or a raw exception message through this surface.
PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE = "PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE"
# Idle retirement is a deterministic, separate outcome: the activation must be
# replaced, not resumed.
PRISMA_CHANNEL_A_RESTART_REQUIRED = "PRISMA_CHANNEL_A_RESTART_REQUIRED"
# Canonical Channel B code, preserved verbatim for a real reservation conflict.
TELEGRAM_BOT_IDENTITY_RESERVED = "TELEGRAM_BOT_IDENTITY_RESERVED"

# The documented Telegram discontinuity horizon. Not the 600-second human idle
# TTL: that TTL governs a *link*, while this governs one polling activation.
SEVEN_DAY_HORIZON_SECONDS = 7 * 24 * 60 * 60
MAX_LIFECYCLE_WAIT_SECONDS = SEVEN_DAY_HORIZON_SECONDS

PHASE_IDLE = "idle"
PHASE_PREPARING = "preparing"
PHASE_PREPARED = "prepared"
PHASE_RUNNING = "running"
PHASE_STOPPING = "stopping"
PHASE_STOPPED = "stopped"
PHASE_FAILED = "failed"
PHASE_RETIRED = "retired"

DISPOSITION_COMPLETED = "completed"
DISPOSITION_BUSY = "busy"
DISPOSITION_STOPPED = "stopped"
DISPOSITION_FAILED = "failed"
DISPOSITION_RESTART_REQUIRED = "restart_required"

# The public ``ChannelABotIdentity.username`` bound accepted by RCA-5a. Repeated
# here so a foreign transport cannot smuggle an unpublishable identity past the
# lifecycle boundary.
_USERNAME_PATTERN = re.compile(r"\A[A-Za-z0-9_]{5,32}\Z")

_LOOP_THREAD_NAME = "prisma-channel-a-lifecycle"


class ChannelALifecycleError(RuntimeError):
    """Fixed, sanitized lifecycle failure.

    The message is always a closed constant: either
    :data:`PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE` or the canonical
    :data:`TELEGRAM_BOT_IDENTITY_RESERVED` for a real reservation conflict. A raw
    dependency exception, message, URL, token or response body is never attached,
    rethrown or chained visibly.
    """


@dataclass(frozen=True, slots=True)
class ChannelAPollResult:
    """One bounded, immutable declaration of what a poll actually did.

    ``outcomes`` is the completed prefix: every handler that ran and every
    outcome that was consumed, in order, no more than ``GET_UPDATES_LIMIT``.
    ``disposition`` is a closed value. ``reason`` is a fixed code or ``None``.
    Returned outcomes are observational evidence for the caller; they are NOT
    another publication instruction.
    """

    outcomes: tuple = ()
    disposition: str = DISPOSITION_COMPLETED
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class ChannelAStatus:
    """Immutable, sanitized internal status with exactly four closed fields.

    No raw exception, update, dialogue, lease, owner, epoch, token or answer text
    ever reaches this shape. ``quiescent`` means no owned activity is in flight;
    it is not a delivery confirmation.
    """

    phase: str
    reason: str | None
    quiescent: bool
    restart_required: bool


def _unavailable() -> ChannelALifecycleError:
    return ChannelALifecycleError(PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)


class _ReservedIdentity(ChannelALifecycleError):
    """Internal marker for a real identity-reservation conflict.

    Only this internally constructed marker may publish the canonical
    :data:`TELEGRAM_BOT_IDENTITY_RESERVED` code: a dependency that raises our own
    public class is never a trusted source of a lifecycle code. The public
    boundary converts it back to an exact :class:`ChannelALifecycleError`, so the
    private marker never escapes the module.
    """

    def __init__(self) -> None:
        super().__init__(TELEGRAM_BOT_IDENTITY_RESERVED)


def _dependency_attribute(value, name):
    """Read one optional dependency attribute, normalizing an accessor fault.

    A hostile property that raises instead of returning is reported as ``None`` so
    the caller refuses the configuration with a fixed code instead of leaking the
    dependency's raw exception.
    """
    try:
        return getattr(value, name, None)
    except Exception:
        return None


def _numeric(value) -> float | None:
    """Normalize one candidate to ``float``, or ``None`` for an unusable value.

    A boolean, a non-numeric object, a hostile conversion (including a float
    subclass whose ``__float__`` raises) and an overflowing value all normalize to
    ``None``, so every boundary fails closed with a fixed code instead of leaking a
    dependency's conversion error.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return float(value)
    except Exception:
        return None


def _sample_clock(clock) -> float | None:
    """Read one monotonic sample in the accepted nonnegative finite domain.

    A raising, boolean, non-numeric, overflowing, non-finite or negative sample is
    reported as ``None`` so every caller fails closed instead of comparing an
    unusable value. The clock call itself happens outside the lifecycle lock.
    """
    try:
        value = clock()
    except Exception:
        return None
    number = _numeric(value)
    if number is None or not math.isfinite(number) or number < 0.0:
        return None
    return number


def _is_callable(value) -> bool:
    return callable(value)


def _validated_poll_timeout(value) -> int:
    """Require a nonnegative exact built-in ``int`` long-poll timeout."""
    if type(value) is not int or value < 0:
        raise _unavailable() from None
    return value


def _validated_positive_bounded(value, *, upper: float) -> float:
    """Require finite, non-boolean, strictly positive and below ``upper``.

    ``upper`` is the platform wait bound (``threading.TIMEOUT_MAX``) so a join or
    an event wait can never raise ``OverflowError`` for a validated value.
    """
    number = _numeric(value)
    if number is None or not math.isfinite(number) or number <= 0.0 or number >= upper:
        raise _unavailable() from None
    return number


def _validated_read_timeout(value, *, poll_timeout: int) -> float:
    """Require a finite read bound strictly above the long-poll timeout."""
    number = _numeric(value)
    # ``poll_timeout`` is an already-validated exact nonnegative ``int``. Comparing
    # it directly against the float bound is exact and cannot overflow the way an
    # unguarded ``float(poll_timeout)`` on an arbitrarily huge int would, so an
    # unusable budget is canonically refused instead of leaking ``OverflowError``.
    if number is None or not math.isfinite(number) or number <= poll_timeout:
        raise _unavailable() from None
    if number >= float(SEVEN_DAY_HORIZON_SECONDS):
        raise _unavailable() from None
    return number


def _validated_connect_timeout(value) -> float:
    number = _numeric(value)
    if number is None or not math.isfinite(number) or number <= 0.0:
        raise _unavailable() from None
    return number


class ChannelARunner:
    """Own one Channel A polling activation from preparation to settlement.

    Every dependency is injected; the constructor performs no I/O and looks up no
    credential. ``reservation=None`` is the only value that selects the shared
    process registry: any other value must be an object that exposes callable
    ``acquire`` and ``release`` seams, so an absent reservation is never silently
    substituted.
    """

    def __init__(
        self,
        *,
        transport,
        dialogue_factory,
        clock,
        poll_timeout,
        read_timeout,
        join_timeout,
        poll_pause,
        on_outcome,
        reservation=None,
    ) -> None:
        if transport is None or not _is_callable(_dependency_attribute(transport, "get_me")):
            raise _unavailable() from None
        if not _is_callable(_dependency_attribute(transport, "get_updates")):
            raise _unavailable() from None
        if not _is_callable(dialogue_factory):
            raise _unavailable() from None
        if not _is_callable(clock):
            raise _unavailable() from None
        if not _is_callable(on_outcome):
            raise _unavailable() from None

        validated_poll = _validated_poll_timeout(poll_timeout)
        validated_read = _validated_read_timeout(read_timeout, poll_timeout=validated_poll)
        validated_join = _validated_positive_bounded(
            join_timeout, upper=float(threading.TIMEOUT_MAX)
        )
        validated_pause = _validated_positive_bounded(
            poll_pause, upper=float(threading.TIMEOUT_MAX)
        )
        validated_connect = _validated_connect_timeout(
            _dependency_attribute(transport, "request_timeout")
        )
        # A connect-plus-read budget that already reaches the horizon could not
        # complete before retirement, so it is refused as unusable configuration.
        if validated_connect + validated_read >= float(SEVEN_DAY_HORIZON_SECONDS):
            raise _unavailable() from None

        if reservation is None:
            resolved_reservation = process_bot_identity_reservation()
        else:
            if not _is_callable(_dependency_attribute(reservation, "acquire")):
                raise _unavailable() from None
            if not _is_callable(_dependency_attribute(reservation, "release")):
                raise _unavailable() from None
            resolved_reservation = reservation

        self.transport = transport
        self.clock = clock
        self.poll_timeout = validated_poll
        self.read_timeout = validated_read
        self.join_timeout = validated_join
        self.poll_pause = validated_pause
        self.on_outcome = on_outcome
        self.reservation = resolved_reservation

        self._dialogue_factory = dialogue_factory
        self._connect_timeout = validated_connect

        self._lock = threading.RLock()
        self._pause_event = threading.Event()

        self._phase = PHASE_IDLE
        self._reason: str | None = None
        self._restart_required = False
        self._prepared = False
        self._terminal = False
        self._finalized = False
        self._stop_requested = False
        self._released = False
        self._leased = False
        # Serializes settlement: at most one release may be in flight, so a
        # reentrant or concurrent stop never enters the same release twice.
        self._release_in_flight = False

        self._activity = 0
        self._admission: object | None = None
        self._admission_thread: int | None = None
        self._thread: threading.Thread | None = None

        self._lease: object | None = None
        self._owner: object | None = None
        self._activation: object | None = None
        self._bot_id: int | None = None
        self._dialogue: ChannelAPairingDialogue | None = None
        self._cursor: int | None = None
        self._anchor: float | None = None
        self._last_sample: float | None = None

    # -- public boundary ---------------------------------------------------

    def prepare(self) -> bool:
        """Register ownership once and mark the activation ready to poll.

        Idempotent after success. A concurrent preparation, a stop or a terminal
        state refuses without mutating the incumbent activity. Invalid
        configuration, a foreign dependency failure or a real reservation
        conflict raises :class:`ChannelALifecycleError` with a fixed code.
        """
        with self._lock:
            if self._terminal or self._stop_requested:
                return False
            if self._prepared:
                return True
            if self._admission is not None:
                return False
            token = object()
            self._admission = token
            self._admission_thread = threading.get_ident()
            self._activity += 1
            self._phase = PHASE_PREPARING
        try:
            return self._prepare_owned()
        except _ReservedIdentity:
            # The one dependency failure whose canonical code survives, published as
            # our own exact class so no caller ever observes the private marker.
            self._terminal_fail(TELEGRAM_BOT_IDENTITY_RESERVED)
            raise ChannelALifecycleError(TELEGRAM_BOT_IDENTITY_RESERVED) from None
        except Exception:
            # A failed preparation is terminal and must still release whatever it
            # already acquired; otherwise the identity would stay reserved. Every
            # other failure -- including a dependency's same-class
            # ``ChannelALifecycleError`` -- publishes only the fixed code, because a
            # foreign exception is never a trusted source of a lifecycle code.
            self._terminal_fail(PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
            raise _unavailable() from None
        finally:
            self._release(token)
            self._settle()

    def poll_once(self) -> ChannelAPollResult:
        """Run exactly one owned ``getUpdates`` iteration.

        While a preparation or a runner already owns admission this returns the
        fixed ``busy`` disposition and changes nothing. A terminally fenced
        instance reports its closed terminal disposition instead of polling.
        """
        token, refusal = self._begin_owned(phase=PHASE_RUNNING, from_caller_thread=True)
        if token is None:
            return refusal
        try:
            return self._poll_iteration()
        finally:
            self._release(token)
            self._settle()

    def run(self) -> ChannelAPollResult:
        """Block in the owned poll loop until a stop or a terminal outcome.

        Never re-contends with itself: the loop uses the already-owned path. The
        returned result is the terminal bounded outcome of the loop.
        """
        token, refusal = self._begin_owned(phase=PHASE_RUNNING, from_caller_thread=True)
        if token is None:
            return refusal
        return self._loop(token)

    def start(self) -> bool:
        """Launch the managed loop on one owned thread.

        Returns ``True`` only when a managed loop was actually launched. Startup
        admission is reserved *before* the thread is launched, so a launch failure
        or a stop that arrives before the thread's first instruction still settles
        deterministically and never leaks ownership.
        """
        with self._lock:
            if self._terminal or self._stop_requested or not self._prepared:
                return False
            if self._admission is not None:
                return False
            if self._thread is not None and self._thread.is_alive():
                return False
            token = object()
            self._admission = token
            self._admission_thread = None
            self._activity += 1
            self._phase = PHASE_RUNNING

        thread = threading.Thread(
            target=self._run_entry,
            args=(token,),
            name=_LOOP_THREAD_NAME,
        )
        try:
            thread.start()
        except Exception:
            # A thread that could not start owns nothing; settle honestly rather
            # than leaving a phantom admission behind.
            self._terminal_fail(PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
            self._release(token)
            self._settle()
            return False
        with self._lock:
            self._thread = thread
            if self._admission is token and self._admission_thread is None:
                self._admission_thread = thread.ident
        return True

    def stop(self) -> bool:
        """Request the sticky stop fence and report whether the runner settled.

        Returns ``True`` only when every owned activity finished, the reservation
        release was confirmed and finalization completed. It returns ``False``
        while owned work remains, when called from the owning thread, or when the
        release could not be confirmed -- in which case the exact lease handle is
        retained for a later retry.
        """
        current = threading.get_ident()
        with self._lock:
            self._stop_requested = True
            self._pause_event.set()
            if self._activity > 0:
                if self._admission_thread == current:
                    # Same-thread stop: never join or wait on ourselves.
                    if self._phase not in (PHASE_FAILED, PHASE_RETIRED):
                        self._phase = PHASE_STOPPING
                    return False
                if self._phase not in (PHASE_FAILED, PHASE_RETIRED):
                    self._phase = PHASE_STOPPING
                thread = self._thread
            else:
                thread = None
                if self._phase in (PHASE_IDLE, PHASE_PREPARED):
                    self._phase = PHASE_STOPPED

        if (
            thread is not None
            and thread is not threading.current_thread()
            and getattr(thread, "ident", None) is not None
        ):
            # Bounded join: a timeout retains authority instead of forcing it.
            thread.join(self.join_timeout)

        return self._settle()

    def status(self) -> ChannelAStatus:
        """Return the immutable, sanitized status snapshot."""
        with self._lock:
            return ChannelAStatus(
                phase=self._phase,
                reason=self._reason,
                quiescent=self._activity == 0,
                restart_required=self._restart_required,
            )

    # -- admission ---------------------------------------------------------

    def _begin_owned(self, *, phase: str, from_caller_thread: bool):
        """Take admission or return ``(None, refusal)`` without mutating state."""
        with self._lock:
            refusal = self._fence_result(())
            if refusal is not None:
                return None, refusal
            # An occupied admission is busy *whatever* owns it -- a preparation as
            # well as a managed loop -- and must never report a terminal failure.
            if self._admission is not None:
                return None, ChannelAPollResult((), DISPOSITION_BUSY)
            if not self._prepared:
                return None, ChannelAPollResult(
                    (), DISPOSITION_FAILED, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE
                )
            token = object()
            self._admission = token
            self._admission_thread = threading.get_ident() if from_caller_thread else None
            self._activity += 1
            self._phase = phase
            return token, ChannelAPollResult((), DISPOSITION_BUSY)

    def _release(self, token) -> None:
        with self._lock:
            if self._admission is token:
                self._admission = None
                self._admission_thread = None
                self._activity -= 1

    def _owned_by_caller(self, token) -> bool:
        with self._lock:
            return self._admission is token

    # -- terminal fences ---------------------------------------------------

    def _fenced(self) -> bool:
        """Report whether a sticky stop or terminal fence is already set."""
        with self._lock:
            return self._stop_requested or self._terminal

    def _fence_result(self, completed) -> ChannelAPollResult | None:
        """Return the fixed refusal for a fenced instance, or ``None`` if open."""
        with self._lock:
            if self._restart_required:
                return ChannelAPollResult(
                    tuple(completed), DISPOSITION_RESTART_REQUIRED, PRISMA_CHANNEL_A_RESTART_REQUIRED
                )
            if self._phase == PHASE_FAILED:
                return ChannelAPollResult(tuple(completed), DISPOSITION_FAILED, self._reason)
            if self._stop_requested or self._phase in (PHASE_STOPPED, PHASE_STOPPING, PHASE_RETIRED):
                return ChannelAPollResult(tuple(completed), DISPOSITION_STOPPED)
            return None

    def _terminal_fail(self, reason: str) -> None:
        with self._lock:
            self._stop_requested = True
            if not self._terminal:
                self._terminal = True
                self._phase = PHASE_FAILED
                self._reason = reason
            # Detach the old activation's dialogue: a failed instance can never
            # reuse it, and the caller must build a new one.
            self._dialogue = None
        self._pause_event.set()

    def _retire(self) -> None:
        with self._lock:
            self._stop_requested = True
            if not self._terminal:
                self._terminal = True
                self._restart_required = True
                self._phase = PHASE_RETIRED
                self._reason = PRISMA_CHANNEL_A_RESTART_REQUIRED
            self._dialogue = None
        self._pause_event.set()

    def _terminal_result(self, completed, reason: str) -> ChannelAPollResult:
        if reason == PRISMA_CHANNEL_A_RESTART_REQUIRED:
            self._retire()
            return ChannelAPollResult(
                tuple(completed), DISPOSITION_RESTART_REQUIRED, PRISMA_CHANNEL_A_RESTART_REQUIRED
            )
        self._terminal_fail(reason)
        return ChannelAPollResult(tuple(completed), DISPOSITION_FAILED, reason)

    # -- settlement --------------------------------------------------------

    def _release_attempt(self) -> bool:
        """Attempt exactly one release; ``True`` only on a *confirmed* release.

        A refusal return value or a raising reservation is NOT a confirmed
        release: the exact lease handle is retained so a later ``stop`` can retry.
        At most one release is ever in flight: a reentrant stop reports ``False``
        instead of recursing, and a concurrent stop reports ``False`` instead of
        entering the same release while the first attempt is still pending.
        """
        with self._lock:
            if not self._leased or self._released:
                return True
            if self._release_in_flight:
                return False
            self._release_in_flight = True
            lease = self._lease
        try:
            if lease is None:
                return False
            try:
                confirmed = self.reservation.release(lease)
            except Exception:
                return False
            if confirmed is not True:
                return False
            with self._lock:
                self._released = True
            return True
        finally:
            with self._lock:
                self._release_in_flight = False

    def _settle(self) -> bool:
        """Finalize once every owned activity ended. Idempotent after success."""
        with self._lock:
            if self._activity > 0:
                return False
            if self._finalized:
                return True
            if not (self._terminal or self._stop_requested):
                return False

        confirmed = self._release_attempt()
        if not confirmed:
            with self._lock:
                # Another caller may have confirmed the very same release and
                # finalized while this attempt was refused. Revalidate under the
                # lock so a stale refusal never reopens a terminal phase: the
                # settled STOPPED/reason survive and finalization stays idempotent.
                if self._finalized:
                    return True
                if self._phase not in (PHASE_FAILED, PHASE_RETIRED):
                    self._phase = PHASE_STOPPING
            return False

        with self._lock:
            if self._activity > 0:
                return False
            self._finalized = True
            if self._phase not in (PHASE_FAILED, PHASE_RETIRED):
                self._phase = PHASE_STOPPED
                self._reason = None
            self._dialogue = None
        return True

    # -- preparation -------------------------------------------------------

    def _prepare_owned(self) -> bool:
        sample = self._read_clock()
        if sample is None:
            raise _unavailable() from None
        # A stop that landed inside the clock sample is honored before any I/O.
        if self._fenced():
            return False

        try:
            identity = self.transport.get_me()
        except Exception:
            raise _unavailable() from None
        bot_id = self._validated_identity(identity)

        if self._fenced():
            return False

        owner = object()
        activation = object()
        try:
            lease = self.reservation.acquire(bot_id, owner=owner, epoch=activation)
        except BotIdentityReservationError:
            # A real conflict is the one dependency failure whose canonical code
            # survives -- but it is raised as our own private marker, never rethrown.
            raise _ReservedIdentity() from None
        except Exception:
            raise _unavailable() from None
        with self._lock:
            self._lease = lease
            self._leased = True

        # A stop that landed inside the acquire callback is honored before the
        # factory. The lease already acquired stays owned, so the caller's
        # confirmed release still cleans it up: it is never dropped or leaked here.
        if self._fenced():
            return False

        try:
            dialogue = self._dialogue_factory()
        except Exception:
            raise _unavailable() from None
        self._validated_dialogue(dialogue, bot_id)

        if self._fenced():
            return False

        with self._lock:
            self._owner = owner
            self._activation = activation
            self._bot_id = bot_id
            self._dialogue = dialogue
            self._anchor = sample
            self._prepared = True
            self._phase = PHASE_PREPARED
        return True

    def _validated_identity(self, identity) -> int:
        """Validate the observed identity, normalizing hostile accessors."""
        if not isinstance(identity, ChannelABotIdentity):
            raise _unavailable() from None
        # A hostile accessor -- including one raising our own public error class --
        # is normalized here: a foreign exception is never a trusted code.
        try:
            bot_id = identity.id
            username = identity.username
        except Exception:
            raise _unavailable() from None
        if type(bot_id) is not int or bot_id < 1 or bot_id > MAX_TELEGRAM_ID:
            raise _unavailable() from None
        if type(username) is not str or _USERNAME_PATTERN.fullmatch(username) is None:
            raise _unavailable() from None
        return bot_id

    def _validated_dialogue(self, dialogue, bot_id: int) -> None:
        """Validate the factory's dialogue, normalizing hostile accessors."""
        if not isinstance(dialogue, ChannelAPairingDialogue):
            raise _unavailable() from None
        try:
            owner = dialogue.bot_id
            registry = dialogue.registry
            transport = dialogue.transport
        except Exception:
            raise _unavailable() from None
        if owner != bot_id:
            raise _unavailable() from None
        if not isinstance(registry, ChannelAPairingRegistry):
            raise _unavailable() from None
        if transport is not self.transport:
            raise _unavailable() from None

    # -- clock and horizon -------------------------------------------------

    def _read_clock(self) -> float | None:
        """Sample the clock outside the lock and enforce nondecreasing order."""
        sample = _sample_clock(self.clock)
        if sample is None:
            return None
        with self._lock:
            last = self._last_sample
            if last is not None and sample < last:
                return None
            self._last_sample = sample
        return sample

    def _elapsed(self, sample: float) -> float | None:
        with self._lock:
            anchor = self._anchor
        if anchor is None:
            return None
        try:
            return sample - anchor
        except OverflowError:
            return None

    def _retirement_before_poll(self, sample: float) -> str | None:
        """Decide retirement *before* dispatch. Returns a fixed reason or None."""
        elapsed = self._elapsed(sample)
        if elapsed is None:
            return PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE
        try:
            remaining = float(SEVEN_DAY_HORIZON_SECONDS) - elapsed
            budget = self._connect_timeout + self.read_timeout
        except OverflowError:
            return PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE
        if remaining <= 0.0 or budget >= remaining:
            return PRISMA_CHANNEL_A_RESTART_REQUIRED
        return None

    def _retirement_reached(self, sample: float) -> str | None:
        elapsed = self._elapsed(sample)
        if elapsed is None:
            return PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE
        if elapsed >= float(SEVEN_DAY_HORIZON_SECONDS):
            return PRISMA_CHANNEL_A_RESTART_REQUIRED
        return None

    # -- batch validation --------------------------------------------------

    def _validate_batch(self, updates) -> list | None:
        """Validate the WHOLE bounded batch before any handler runs.

        A non-tuple, an oversized batch, a non-mapping entry, a non-exact
        identifier outside ``0..MAX_TELEGRAM_ID``, a decreasing suffix or a
        raising accessor all yield ``None``: nothing is processed, nothing is
        sorted and the cursor never advances.
        """
        if type(updates) is not tuple:
            return None
        if len(updates) > GET_UPDATES_LIMIT:
            return None
        validated: list = []
        previous: int | None = None
        try:
            for entry in updates:
                if not isinstance(entry, Mapping):
                    return None
                value = entry.get("update_id")
                if type(value) is not int or value < 0 or value > MAX_TELEGRAM_ID:
                    return None
                if previous is not None and value < previous:
                    return None
                previous = value
                validated.append((value, entry))
        except Exception:
            return None
        return validated

    # -- polling -----------------------------------------------------------

    def _poll_iteration(self) -> ChannelAPollResult:
        completed: list = []

        sample = self._read_clock()
        if sample is None:
            return self._terminal_result(completed, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
        reason = self._retirement_before_poll(sample)
        if reason is not None:
            return self._terminal_result(completed, reason)

        fence = self._fence_result(completed)
        if fence is not None:
            return fence

        with self._lock:
            offset = self._cursor
        try:
            updates = self.transport.get_updates(
                poll_timeout=self.poll_timeout,
                read_timeout=self.read_timeout,
                offset=offset,
            )
        except Exception:
            return self._terminal_result(completed, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)

        # A stop that landed during the long poll is honored before any handler,
        # leaving the returned suffix untouched.
        fence = self._fence_result(completed)
        if fence is not None:
            return fence

        validated = self._validate_batch(updates)
        if validated is None:
            return self._terminal_result(completed, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)

        after = self._read_clock()
        if after is None:
            return self._terminal_result(completed, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
        reason = self._retirement_reached(after)
        if reason is not None:
            return self._terminal_result(completed, reason)

        return self._process_batch(completed, validated, sample)

    def _process_batch(self, completed: list, validated: list, poll_start: float) -> ChannelAPollResult:
        for value, entry in validated:
            fence = self._fence_result(completed)
            if fence is not None:
                return fence

            sample = self._read_clock()
            if sample is None:
                return self._terminal_result(completed, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)

            # A stop that landed inside this entry's clock sample is honored before
            # the cursor is reserved and before any handler runs; the completed
            # prefix carried so far is preserved.
            fence = self._fence_result(completed)
            if fence is not None:
                return fence

            reason = self._retirement_reached(sample)
            if reason is not None:
                return self._terminal_result(completed, reason)

            # The final stop/terminal fence validation and the cursor admission are
            # one atomic protected transition: a stop that lands after the unlocked
            # clock fence above can no longer slip between the check and the
            # reservation, so a fenced instance never admits the next handler. The
            # lock is released before the handler and every foreign callback, so an
            # already-admitted handler may still finish and hand off under
            # ownership even if a stop follows.
            with self._lock:
                fence = self._fence_result(completed)
                if fence is not None:
                    return fence
                cursor = self._cursor
                if cursor is not None and value < cursor:
                    # Stale, or a duplicate whose first occurrence already owns it.
                    # It is never replayed and never advances the cursor.
                    continue
                # Reserve immediately before the handler, matching the adapter's
                # pre-handler high-water so a handler failure keeps this cursor.
                self._cursor = value + 1
                dialogue = self._dialogue

            try:
                outcome = dialogue.handle_update(entry)
            except Exception:
                return self._terminal_result(completed, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)

            if not self._outcome_is_consistent(outcome, value):
                return self._terminal_result(completed, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)

            with self._lock:
                # A newly admitted valid update is the only thing that renews the
                # idle anchor, using this poll's conservative start sample.
                self._anchor = poll_start
            completed.append(outcome)

            try:
                self.on_outcome(outcome)
            except Exception:
                return self._terminal_result(completed, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)

        return ChannelAPollResult(tuple(completed), DISPOSITION_COMPLETED)

    def _outcome_is_consistent(self, outcome, expected_id: int) -> bool:
        if not isinstance(outcome, IngressOutcome):
            return False
        try:
            update_id = outcome.update_id
            accepted = outcome.accepted
        except Exception:
            # A hostile or raising accessor is a mismatched outcome, never a leak.
            return False
        # Only an exact built-in ``int`` proves the identifier: ``True == 1`` and
        # ``1.0 == 1``, so a boolean or float subclass is not the claimed update.
        if type(update_id) is not int or update_id != expected_id:
            return False
        # Acceptance is not delivery, but a reserved identifier must have been
        # accepted; anything else is a mismatched outcome from the dialogue.
        return accepted is True

    # -- managed loop ------------------------------------------------------

    def _run_entry(self, token) -> None:
        with self._lock:
            if self._admission is token:
                self._admission_thread = threading.get_ident()
        try:
            self._loop(token)
        except BaseException:
            # No exception is attached to any public surface: only the fixed code.
            self._terminal_fail(PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
            self._release(token)
            self._settle()

    def _loop(self, token) -> ChannelAPollResult:
        # The last successful iteration's completed prefix is carried into the
        # terminating result, so a stop between polls never hides what already
        # ran. It is bounded by one batch, never an accumulating queue.
        carried: tuple = ()
        try:
            while True:
                fence = self._fence_result(carried)
                if fence is not None:
                    return fence
                result = self._poll_iteration()
                if result.disposition != DISPOSITION_COMPLETED:
                    return result
                carried = result.outcomes
                # Interruptible pacing after a *successful* poll only; never a
                # retry backoff after a terminal failure.
                self._pause_event.wait(self.poll_pause)
        finally:
            self._release(token)
            self._settle()
