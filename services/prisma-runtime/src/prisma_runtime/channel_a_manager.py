"""Inert Channel A coordinator; explicit Apply is the only activation entry.

Admission is separate from the state lock. Every foreign call (including method
lookup and status accessors) occurs outside that lock. Only a confirmed stop
withdraws owned authority; reservation acquisition/release belongs to the runner.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from threading import Lock, Timer

from .channel_a_configuration import (
    ChannelAConfiguration,
    ChannelAConfigurationError,
    PRISMA_CHANNEL_A_CONFIGURATION_INVALID,
    PRISMA_CHANNEL_A_CONFIGURATION_UNAVAILABLE,
)
from .channel_a_credentials import (
    ChannelACredentialError,
    ChannelACredentialResolver,
    PRISMA_CHANNEL_A_CREDENTIAL_MISSING,
    PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE,
)
from .channel_a_lifecycle import (
    ChannelALifecycleError,
    ChannelAStatus,
    PHASE_IDLE,
    PHASE_PREPARING,
    PHASE_PREPARED,
    PHASE_RUNNING,
    PHASE_STOPPING,
    PHASE_STOPPED,
    PHASE_FAILED,
    PHASE_RETIRED,
    PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,
    PRISMA_CHANNEL_A_POLL_FAILED,
    PRISMA_CHANNEL_A_RESTART_REQUIRED,
    PRISMA_CHANNEL_A_UNAUTHORIZED,
    TELEGRAM_BOT_IDENTITY_RESERVED,
)
from .channel_a_query import is_query_envelope_well_formed
from .channel_a_pairing import ChannelAPairingConflict
from .credential_store import InvalidCredential, validate_secret

PRISMA_CHANNEL_A_MANAGER_BUSY = "PRISMA_CHANNEL_A_MANAGER_BUSY"
PRISMA_CHANNEL_A_STOP_UNCONFIRMED = "PRISMA_CHANNEL_A_STOP_UNCONFIRMED"
_INVALID_CREDENTIAL = "INVALID_CREDENTIAL_REQUEST"
_PROVIDER = "telegram_channel_a"
_CONFIGURATION_CODES = frozenset({
    PRISMA_CHANNEL_A_CONFIGURATION_INVALID, PRISMA_CHANNEL_A_CONFIGURATION_UNAVAILABLE,
})
_CREDENTIAL_CODES = frozenset({
    PRISMA_CHANNEL_A_CREDENTIAL_MISSING, PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE,
})
_LIFECYCLE_CODES = frozenset({
    PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE, PRISMA_CHANNEL_A_RESTART_REQUIRED,
    TELEGRAM_BOT_IDENTITY_RESERVED, PRISMA_CHANNEL_A_POLL_FAILED, PRISMA_CHANNEL_A_UNAUTHORIZED,
})
_ERROR_CODES = _CONFIGURATION_CODES | _CREDENTIAL_CODES | _LIFECYCLE_CODES | frozenset({
    _INVALID_CREDENTIAL, PRISMA_CHANNEL_A_MANAGER_BUSY, PRISMA_CHANNEL_A_STOP_UNCONFIRMED,
})
# T16: PERMANENT background/retry failures a manager must never retry -- they
# stay failed with their exact code until the admin acts (a new token, a
# fixed configuration, or reserving the identity for this channel again).
# Every other recognized manager error code is TRANSIENT and always retried
# with backoff (a busy manager, an unconfirmed stop, or any other unexpected
# runner/manager exception). This activation-level backoff is reserved for a
# genuinely terminal activation failure; T8's ordinary network/timeout/5xx/
# Telegram-409 `getUpdates` failures never reach it anymore -- they retry in
# place within the SAME activation (`ChannelARunner._poll_iteration`'s
# `DISPOSITION_POLL_RETRY` path, surfaced here via `_handle_poll_retry`), so
# `PRISMA_CHANNEL_A_POLL_FAILED` is no longer actively produced as a
# background-failure reason.
_PERMANENT_RETRY_FAILURE_CODES = frozenset({
    TELEGRAM_BOT_IDENTITY_RESERVED,
    PRISMA_CHANNEL_A_UNAUTHORIZED,
    PRISMA_CHANNEL_A_CREDENTIAL_MISSING,
    PRISMA_CHANNEL_A_CONFIGURATION_INVALID,
})
# Named backoff policy (T16): 5s, doubling every attempt, capped at 5 minutes.
# Retries continue indefinitely for a TRANSIENT failure while the credential
# stays configured; only an explicit admin save/delete/apply, or runtime
# shutdown, ever stops them early.
CHANNEL_A_RETRY_INITIAL_DELAY_SECONDS = 5.0
CHANNEL_A_RETRY_BACKOFF_FACTOR = 2.0
CHANNEL_A_RETRY_MAX_DELAY_SECONDS = 300.0


def _retry_delay_seconds(attempt: int) -> float:
    """Exponential backoff for the Nth automatic retry attempt (N >= 1)."""
    if attempt <= 1:
        return CHANNEL_A_RETRY_INITIAL_DELAY_SECONDS
    delay = CHANNEL_A_RETRY_INITIAL_DELAY_SECONDS * (CHANNEL_A_RETRY_BACKOFF_FACTOR ** (attempt - 1))
    return min(delay, CHANNEL_A_RETRY_MAX_DELAY_SECONDS)


# T16: no `logging.basicConfig` exists anywhere in this runtime. A module
# logger with no handler configured on it or any ancestor (root included)
# falls back to `logging`'s own "handler of last resort", which writes a
# WARNING-or-above record directly to `sys.stderr` -- exactly the stream the
# launcher already redirects to `prisma-presentation-stderr.log`. Every field
# below is a closed code, boolean or number; never a token, chat id, username
# or raw provider/exception text.
_logger = logging.getLogger(__name__)


def _format_delay(delay: float | None) -> str:
    return "none" if delay is None else f"{delay:g}"


def _log_channel_a_background_failure(code, *, transient: bool, retry_attempt: int, next_delay: float | None) -> None:
    _logger.warning(
        "Canal A background failure: code=%s transient=%s retry_attempt=%s next_delay_s=%s",
        code, "true" if transient else "false", retry_attempt, _format_delay(next_delay),
    )


def _log_channel_a_reconnected(attempts: int) -> None:
    _logger.warning("Canal A reconnected after %s attempts", attempts)


def _log_channel_a_retries_stopped(code, *, retry_attempt: int) -> None:
    _logger.warning(
        "Canal A retries stopped: code=%s after %s attempts", code, retry_attempt,
    )


# T8: the in-place poll retry within one activation is a distinct mechanism
# from the T16 background-failure backoff above (which rebuilds a NEW
# activation) -- it never ends the activation, so it gets its own pair of log
# lines, in English per this project's logging convention, reusing the same
# "one line, closed fields only" shape as the T16 lines above.
def _log_channel_a_poll_retry_started() -> None:
    _logger.warning("Channel A poll retry: started")


def _log_channel_a_poll_recovered(gap_seconds: float | None) -> None:
    _logger.warning("Channel A poll retry: recovered gap_s=%s", _format_delay(gap_seconds))


_PHASES = frozenset({
    PHASE_IDLE, PHASE_PREPARING, PHASE_PREPARED, PHASE_RUNNING,
    PHASE_STOPPING, PHASE_STOPPED, PHASE_FAILED, PHASE_RETIRED,
})
# Pairing projections are active only in these phases without a pending
# restart; every other observation closes to 'unavailable' without any
# foreign pairing call.
_PAIRING_ACTIVE_PHASES = (PHASE_PREPARED, PHASE_RUNNING)
_PAIRING_STATES = frozenset({"free", "pending", "linked"})


class ChannelAManagerError(RuntimeError):
    """Closed manager error; dependency exceptions are never retained."""


def _error_code(error, fallback):
    # Read only a domain exception's exact string argument, never stringify an
    # arbitrary dependency error. Accessor failures also close to the fallback.
    try:
        allowed = ()
        if isinstance(error, ChannelAManagerError):
            allowed = _ERROR_CODES
        elif isinstance(error, ChannelAConfigurationError):
            allowed = _CONFIGURATION_CODES
        elif isinstance(error, ChannelACredentialError):
            allowed = _CREDENTIAL_CODES
        elif isinstance(error, ChannelALifecycleError):
            allowed = _LIFECYCLE_CODES
        elif isinstance(error, InvalidCredential):
            allowed = (_INVALID_CREDENTIAL,)
        args = error.args
        if len(args) == 1 and type(args[0]) is str and args[0] in allowed:
            return args[0]
    except Exception:
        pass
    return fallback


def _raise_closed(code):
    """Raise an owned error without retaining the ambient exception context.

    Raising outside our dependency handler normally suffices, but a caller may
    itself be handling an exception (including contextlib's generator throw).
    Python attaches that ambient exception on the initial raise. Detach it only
    from this newly constructed error, then use a bare re-raise, which preserves
    the detached links. Never modify a dependency's exception or traceback.
    """
    try:
        raise ChannelAManagerError(code) from None
    except ChannelAManagerError as closed:
        closed.__context__ = None
        raise


def _call(operation, fallback):
    try:
        return operation()
    except Exception as error:
        code = _error_code(error, fallback)
    _raise_closed(code)


class ChannelAManager:
    def __init__(self, *, credential_service, configuration_store, activation_factory, reservation, timer_factory=None):
        self._credentials = credential_service
        self._configuration = configuration_store
        self._factory = activation_factory
        self._reservation = reservation
        # This closure captures the protected service, never a resolved secret.
        self._resolver = ChannelACredentialResolver(lambda: credential_service)
        # Public alias for composition callers that need only a read-only
        # resolve() (T13: on-demand token verification, composed outside this
        # manager, mirrors TelegramLifecycleManager's own public `resolver`
        # attribute). Internal call sites keep using `_resolver` unchanged.
        self.resolver = self._resolver
        self._lock = Lock()
        self._busy = False
        self._activation = None
        self._retired = None  # Bounded: only the most recently confirmed retirement.
        self._attempt_epoch = 0
        self._applied_generation = None
        self._activation_epoch = None
        self._last_error = None
        # T16: automatic backoff retry after a background failure. Injectable
        # only for tests (a fake recording start()/cancel() without a real
        # thread); production always uses the real ``threading.Timer``.
        self._timer_factory = timer_factory if callable(timer_factory) else Timer
        self._retrying = False
        self._retry_attempt = 0
        self._retry_timer = None
        # T8b: the T8 in-place poll retry is a distinct signal from the T16
        # background-failure backoff above and gets its own state, merged
        # with `_retrying`/`_retry_attempt` only for display in `status()` --
        # never shared, so a background failure that lands while a poll
        # retry is sticky still starts its OWN backoff at attempt 1 (5s)
        # instead of inheriting the poll retry's attempt count.
        self._poll_retrying = False

    @contextmanager
    def _mutation(self):
        with self._lock:
            admitted = not self._busy
            if admitted:
                self._busy = True
        if not admitted:
            # Do not enter the incumbent's error/finally path on busy refusal.
            _raise_closed(PRISMA_CHANNEL_A_MANAGER_BUSY)
        try:
            code = None
            try:
                yield
            except Exception as error:
                code = _error_code(error, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
            if code is not None:
                self._record_error(code)
                _raise_closed(code)
        finally:
            with self._lock:
                self._busy = False

    def _record_error(self, code):
        with self._lock:
            self._last_error = code

    # -- T16: background-failure recording and automatic backoff retry -----

    def _cancel_retry(self, *, reset_attempt: bool) -> None:
        """Cancel any pending automatic retry (T16).

        Called by every explicit admin-facing mutation (save, delete, the
        public ``apply()``, and ``stop()``) BEFORE that mutation's own work,
        so an explicit action always wins over a stale scheduled retry --
        "never overlap with an admin save/delete/apply". The timer's own
        ``.cancel()`` runs outside the lock: it never blocks and nothing
        foreign runs while the manager's lock is held, matching every other
        boundary in this module. A timer that already fired past the point of
        cancellation is a harmless no-op: ``_retry_tick`` re-checks
        ``_retrying`` itself under the same lock before doing any work.
        """
        with self._lock:
            self._retrying = False
            if reset_attempt:
                self._retry_attempt = 0
            timer = self._retry_timer
            self._retry_timer = None
        if timer is not None:
            try:
                timer.cancel()
            except Exception:
                pass

    def _bind_background_observer(self, candidate) -> None:
        """Wire the background-failure observer onto a freshly built candidate.

        Called from ``_new_candidate`` before ``prepare()``/``start()`` ever
        run, so the runner can never reach a background failure before the
        observer exists. A candidate whose activation predates this feature
        (a foreign/test double without ``set_on_terminal``) is left
        unobserved instead of raising: this is diagnostics, never an
        activation admission gate.
        """
        bind = getattr(candidate, "set_on_terminal", None)
        if not callable(bind):
            return
        try:
            bind(lambda reason: self._handle_background_failure(candidate, reason))
        except Exception:
            pass

    def _handle_background_failure(self, activation, reason) -> None:
        """Observer invoked by the runner's OWN thread on a NEW terminal
        failure (T16). Never touches the mutation lock (``_mutation``/
        ``_busy``), never blocks and never raises: it records the classified
        failure and, for a TRANSIENT reason on the activation that is STILL
        the one this manager publishes, schedules exactly one backoff retry.
        A stale/superseded activation (already replaced by an explicit admin
        action, or by a previous retry) is recorded nowhere and never
        retried: generation/epoch authority stays with whichever activation
        the manager currently publishes, checked by identity under the lock.
        """
        with self._lock:
            if self._activation is not activation:
                return
            self._last_error = reason
            if reason in _PERMANENT_RETRY_FAILURE_CODES:
                self._retrying = False
                old_timer = self._retry_timer
                self._retry_timer = None
                timer = None
                transient = False
                delay = None
            else:
                self._retry_attempt += 1
                self._retrying = True
                old_timer = self._retry_timer
                delay = _retry_delay_seconds(self._retry_attempt)
                timer = self._timer_factory(delay, self._retry_tick)
                timer.daemon = True
                self._retry_timer = timer
                transient = True
            attempt = self._retry_attempt
        if old_timer is not None:
            try:
                old_timer.cancel()
            except Exception:
                pass
        if timer is not None:
            timer.start()
        # T16 requirement 1: one redacted diagnostic line per recorded
        # background failure, logged AFTER the staleness check above and
        # outside the lock (logging is I/O, never performed while held).
        _log_channel_a_background_failure(reason, transient=transient, retry_attempt=attempt, next_delay=delay)

    def _bind_poll_retry_observer(self, candidate) -> None:
        """Wire the in-place poll-retry observer onto a freshly built candidate
        (T8), mirroring :meth:`_bind_background_observer` exactly: bound
        before ``prepare()``/``start()`` ever run, and a candidate without
        ``set_on_poll_retry`` is left unobserved instead of raising.
        """
        bind = getattr(candidate, "set_on_poll_retry", None)
        if not callable(bind):
            return
        try:
            bind(lambda retrying, gap_seconds: self._handle_poll_retry(candidate, retrying, gap_seconds))
        except Exception:
            pass

    def _handle_poll_retry(self, activation, retrying, gap_seconds) -> None:
        """Observer invoked by the runner's OWN thread on an in-place
        poll-retry state transition (T8). NEVER terminal: the activation stays
        exactly the one this manager already publishes, so this never touches
        the mutation lock, the manager's own backoff timer or ``_activation``
        itself -- only its OWN ``_poll_retrying`` flag (T8b), which
        ``status()`` merges with T16's ``retrying``/``retryAttempt`` fields
        purely for display, so the admin/HMI "reconnecting" signal reads the
        same regardless of whether the manager is rebuilding a new activation
        after a terminal failure or this activation is retrying its OWN
        session/dialogue in place. Never written back into
        ``_retry_attempt``: that counter is T16's own backoff-attempt state
        and must stay untouched by an in-place poll retry, so a background
        failure that lands while a poll retry is sticky still starts its own
        backoff at attempt 1. A stale/superseded activation is recorded
        nowhere, matching :meth:`_handle_background_failure`.
        """
        with self._lock:
            if self._activation is not activation:
                return
            self._poll_retrying = retrying
        if retrying:
            _log_channel_a_poll_retry_started()
        else:
            _log_channel_a_poll_recovered(gap_seconds)

    def _retry_tick(self) -> None:
        """Timer callback: attempt exactly one automatic ``apply()`` (T16).

        Runs on the timer's own thread, never inside any lock. A busy
        manager (an admin save/delete/apply already in flight) fails this
        attempt harmlessly like any other transient failure -- the next
        scheduled retry (or the next background failure) tries again. Calls
        the internal ``_apply_impl`` directly, NOT the public ``apply()``:
        the public entry point resets the attempt counter for an explicit
        admin action, which would defeat growing backoff across repeated
        automatic retries.
        """
        with self._lock:
            self._retry_timer = None
            if not self._retrying:
                return  # an explicit action already cancelled this retry
        try:
            self._apply_impl()
        except ChannelAManagerError as error:
            code = error.args[0] if error.args else None
            timer = None
            stopped_attempt = None
            with self._lock:
                if not self._retrying:
                    return
                if code in _PERMANENT_RETRY_FAILURE_CODES:
                    self._retrying = False
                    stopped_attempt = self._retry_attempt
                else:
                    self._retry_attempt += 1
                    delay = _retry_delay_seconds(self._retry_attempt)
                    timer = self._timer_factory(delay, self._retry_tick)
                    timer.daemon = True
                    self._retry_timer = timer
            if timer is not None:
                timer.start()
            if stopped_attempt is not None:
                _log_channel_a_retries_stopped(code, retry_attempt=stopped_attempt)
        except Exception:
            # A retry attempt must never crash a bare timer thread; leave the
            # recorded state as whatever the failed attempt already set.
            pass
        else:
            with self._lock:
                attempts = self._retry_attempt
                self._retrying = False
                self._retry_attempt = 0
            _log_channel_a_reconnected(attempts)

    def _desired(self):
        def read():
            snapshot = self._configuration.read()
            if type(snapshot) is not ChannelAConfiguration:
                raise ChannelAManagerError(PRISMA_CHANNEL_A_CONFIGURATION_UNAVAILABLE)
            return snapshot

        return _call(read, PRISMA_CHANNEL_A_CONFIGURATION_UNAVAILABLE)

    def _reserve_generation(self):
        return _call(lambda: self._configuration.advance_generation(), PRISMA_CHANNEL_A_CONFIGURATION_UNAVAILABLE)

    def _observe(self, activation):
        if activation is None:
            return None

        def read():
            observed = activation.status()
            # Preserve the actual immutable object, but never publish arbitrary
            # foreign status text, subclass properties or invented flags.
            if (
                type(observed) is not ChannelAStatus
                or type(observed.phase) is not str or observed.phase not in _PHASES
                or (observed.reason is not None and (
                    type(observed.reason) is not str or observed.reason not in _LIFECYCLE_CODES
                ))
                or type(observed.quiescent) is not bool
                or type(observed.restart_required) is not bool
            ):
                raise ChannelAManagerError(PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
            return observed

        return _call(read, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)

    @staticmethod
    def _bot_username_if_running(activation, observed):
        """Public info (not the secret token), only while genuinely connected.

        Never exposed without a running, non-restart-pending observation, and
        any broken/foreign activation attribute closes to ``None`` instead of
        raising -- this is a display projection, not an authority check.
        """
        if activation is None or observed is None:
            return None
        if observed.phase != PHASE_RUNNING or observed.restart_required:
            return None
        try:
            username = activation.bot_username
        except Exception:
            return None
        return username if isinstance(username, str) and username else None

    @staticmethod
    def _has_paired_owner(activation, observed):
        """Coarse, owner-agnostic pairing signal (T15), gated exactly like
        ``_bot_username_if_running``: never published without a running,
        non-restart-pending observation, and any broken/foreign activation
        method closes to ``False`` instead of raising -- a display
        projection, not an authority check.
        """
        if activation is None or observed is None:
            return False
        if observed.phase != PHASE_RUNNING or observed.restart_required:
            return False
        try:
            return bool(activation.has_paired_owner())
        except Exception:
            return False

    def status(self):
        """Observe metadata only; never resolve credentials or drive lifecycle."""
        try:
            desired = self._desired()

            def configured():
                metadata = self._credentials.status()
                value = metadata[_PROVIDER]
                if type(value) is not bool:
                    raise ChannelAManagerError(PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE)
                return value

            present = _call(configured, PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE)
            with self._lock:
                activation = self._activation
                generation = self._applied_generation
                epoch = self._activation_epoch
                error = self._last_error
                # T8b: `_retrying`/`_retry_attempt` (T16 background backoff)
                # and `_poll_retrying` (T8 in-place poll retry) are separate
                # state, merged here only for display so the admin
                # "reconnecting" indicator reads the same either way.
                # `_retry_attempt` keeps its own existing semantics verbatim
                # (including staying at its last value after a permanent
                # background failure stops retrying, T16's original
                # diagnostic behavior); a pure poll retry that never touched
                # the background counter (still 0) displays attempt 1 while
                # in flight instead of a bare 0.
                retrying = self._retrying or self._poll_retrying
                retry_attempt = self._retry_attempt or (1 if self._poll_retrying else 0)
            observed = self._observe(activation)
            return {
                "configured": present,
                "desiredGeneration": desired.desired_generation,
                "appliedGeneration": generation,
                "activationEpoch": epoch,
                "activation": observed,
                "lastError": error,
                "botUsername": self._bot_username_if_running(activation, observed),
                "paired": self._has_paired_owner(activation, observed),
                # T16: surfaced so the admin UI can show "reconnecting" instead
                # of a bare failure while an automatic retry is in flight.
                "retrying": retrying,
                "retryAttempt": retry_attempt,
            }
        except Exception as error:
            code = _error_code(error, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
        self._record_error(code)
        _raise_closed(code)

    def pairing_status(self, owner_id):
        """Observe the published activation's pairing state without mutation.

        No configuration or credential read, no mutation gate and no
        desired==applied requirement: a technical read of the currently
        published activation only. Inactive or untrusted phases are refused
        before the foreign pairing call, a withdrawn publication never
        delegates, every foreign call (status and pairing projection) runs
        outside the state lock, a safe second status observation follows the
        delegation, and the publication identity is finally revalidated under
        the lock after the last foreign observation. Any failure closes to
        ``'unavailable'``; ``lastError`` and lifecycle ownership never change.
        """
        with self._lock:
            activation = self._activation
        if activation is None:
            return "unavailable"
        try:
            observed = self._observe(activation)
        except Exception:
            return "unavailable"
        if (
            observed.phase not in _PAIRING_ACTIVE_PHASES
            or observed.restart_required is not False
        ):
            return "unavailable"
        # A publication withdrawn before the delegation never reaches the
        # foreign pairing call.
        with self._lock:
            if self._activation is not activation:
                return "unavailable"
        try:
            state = activation.pairing_status(owner_id)
            # A status transition during the foreign pairing call closes the
            # projection: re-observe safely outside the lock after delegation.
            reobserved = self._observe(activation)
            if (
                reobserved.phase not in _PAIRING_ACTIVE_PHASES
                or reobserved.restart_required is not False
            ):
                return "unavailable"
        except Exception:
            return "unavailable"
        # Final publication identity check after the last foreign observation.
        with self._lock:
            if self._activation is not activation:
                return "unavailable"
        return state if state in _PAIRING_STATES else "unavailable"

    def issue_pairing_challenge(self, owner_id):
        """Delegate issuance to the published activation's closed QR view.

        The activation is snapshotted under the existing lock and the foreign
        issuance runs outside it. Inactive or untrusted phases issue nothing,
        a withdrawn publication never delegates, a safe second status
        observation follows the delegation and the publication identity is
        finally revalidated under the lock after the last foreign observation,
        so a reentrant confirmed stop discards the view. A real pairing domain
        conflict survives untouched for the HTTP layer and every other failure
        closes to a sanitized lifecycle error. ``lastError`` and lifecycle
        ownership never change.
        """
        with self._lock:
            activation = self._activation
        if activation is None:
            return None
        try:
            observed = self._observe(activation)
        except Exception:
            return None
        if (
            observed.phase not in _PAIRING_ACTIVE_PHASES
            or observed.restart_required is not False
        ):
            return None
        # A publication withdrawn before the delegation never reaches the
        # foreign issuance call.
        with self._lock:
            if self._activation is not activation:
                return None
        try:
            view = activation.issue_pairing_challenge_view(owner_id)
        except ChannelAPairingConflict:
            # The one real pairing conflict is the caller's contract.
            raise
        except Exception as error:
            _raise_closed(_error_code(error, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE))
        try:
            # A status transition during the foreign issuance closes the
            # projection: re-observe safely outside the lock after delegation.
            reobserved = self._observe(activation)
        except Exception:
            return None
        if (
            reobserved.phase not in _PAIRING_ACTIVE_PHASES
            or reobserved.restart_required is not False
        ):
            return None
        # Final publication identity check after the last foreign observation.
        with self._lock:
            if self._activation is not activation:
                return None
        return view

    def is_query_envelope_current(self, envelope) -> bool:
        """Read published running authority without configuration or credential I/O."""
        if not is_query_envelope_well_formed(envelope):
            return False
        with self._lock:
            activation = self._activation
            epoch = self._activation_epoch
            generation = self._applied_generation
        if activation is None or epoch is None or generation is None:
            return False
        try:
            # Child-owned representation stays opaque; capture alone grants nothing.
            witness = activation._capture_delivery_witness(envelope)
            if witness is None or not self._publication_matches(activation, epoch, generation):
                return False
            observed = self._observe(activation)
            if (observed.phase != PHASE_RUNNING or observed.restart_required is not False
                    or not self._publication_matches(activation, epoch, generation)):
                return False
            if activation.is_query_envelope_current(envelope) is not True:
                return False
            if not self._publication_matches(activation, epoch, generation):
                return False
            # A final status callback can revoke inner authority without changing
            # manager publication. The callback-free child comparison fences it.
            observed = self._observe(activation)
            if (observed.phase != PHASE_RUNNING or observed.restart_required is not False
                    or not self._publication_matches(activation, epoch, generation)):
                return False
            if activation._delivery_witness_matches(witness) is not True:
                return False
            return self._publication_matches(activation, epoch, generation)
        except Exception:
            return False

    def _publication_matches(self, activation, epoch, generation) -> bool:
        with self._lock:
            return (
                self._activation is activation
                and self._activation_epoch == epoch
                and self._applied_generation == generation
            )

    def _success(self):
        self._record_error(None)
        return self.status()

    def save_credential(self, secret):
        self._cancel_retry(reset_attempt=True)
        with self._mutation():
            try:
                _call(lambda: validate_secret(_PROVIDER, secret), _INVALID_CREDENTIAL)
                self._reserve_generation()
                _call(lambda: self._credentials.set_secret(_PROVIDER, secret), PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE)
            finally:
                secret = None
            return self._success()

    def set_warning_lead(self, value):
        with self._mutation():
            _call(lambda: self._configuration.set_warning_lead(value), PRISMA_CHANNEL_A_CONFIGURATION_UNAVAILABLE)
            return self._success()

    def _settle(self):
        with self._lock:
            activation = self._activation
        if activation is None:
            return True
        try:
            confirmed = activation.stop() is True
        except Exception:
            confirmed = False
        if not confirmed:
            return False
        with self._lock:
            previous_retired = self._retired
            self._retired = activation
            self._activation = None
            self._applied_generation = None
            self._activation_epoch = None
        # Dropping the previous foreign instance may invoke its finalizer. Keep
        # that reference alive until after releasing the manager state lock.
        del previous_retired
        return True

    def startup_apply(self):
        """Restore an applied Channel A configuration on runtime start.

        Mirrors Telegram's accepted ``startup_apply()`` semantics: once a
        credential is configured, boot must not leave the channel requiring
        an operator's manual Apply again. Absent a credential, this is a
        pure no-op -- status stays exactly as the constructor left it. Any
        apply failure is captured in status and never raised, so it can
        never crash the runtime or block the presentation server from
        serving.
        """
        try:
            metadata = self._credentials.status()
            present = metadata[_PROVIDER]
        except Exception:
            present = False
        if type(present) is not bool or not present:
            return self.status()
        try:
            return self.apply()
        except ChannelAManagerError:
            return self.status()

    def stop(self):
        # T16: shutdown (main()'s finally) and any explicit stop must cancel a
        # pending automatic retry promptly, before the mutation itself.
        self._cancel_retry(reset_attempt=True)
        with self._mutation():
            confirmed = self._settle()
            self._record_error(None if confirmed else PRISMA_CHANNEL_A_STOP_UNCONFIRMED)
            return confirmed

    def delete_credential(self):
        self._cancel_retry(reset_attempt=True)
        with self._mutation():
            self._reserve_generation()
            _call(lambda: self._credentials.delete_secret(_PROVIDER), PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE)
            if not self._settle():
                raise ChannelAManagerError(PRISMA_CHANNEL_A_STOP_UNCONFIRMED)
            return self._success()

    def _new_candidate(self, desired):
        # The token exists only in this call frame and the trusted factory call.
        # Neither a manager field nor a persistent callback holds its value.
        token = None
        try:
            token = _call(lambda: self._resolver.resolve(), PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE)
            with self._lock:
                self._attempt_epoch += 1
                epoch = self._attempt_epoch
                retired = self._retired
                current = self._activation
            candidate = _call(
                lambda: self._factory(token, desired, epoch, self._reservation),
                PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,
            )
        finally:
            token = None
        if candidate is None or candidate is retired or candidate is current:
            raise ChannelAManagerError(PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
        # T16: bound BEFORE publication, so the runner can never reach a
        # background failure before the observer exists.
        self._bind_background_observer(candidate)
        # T8: same reasoning, for the in-place poll-retry observer.
        self._bind_poll_retry_observer(candidate)
        with self._lock:
            self._activation = candidate
        return candidate, epoch

    def apply(self):
        """Explicit (admin or startup) apply: always cancels a pending
        automatic retry and resets its attempt counter first (T16) -- "never
        overlap with an admin save/delete/apply". The automatic retry timer
        calls ``_apply_impl`` directly instead, which does NOT reset the
        attempt counter, so backoff keeps growing across repeated automatic
        retries.
        """
        self._cancel_retry(reset_attempt=True)
        return self._apply_impl()

    def _apply_impl(self):
        with self._mutation():
            desired = self._desired()
            with self._lock:
                activation = self._activation
                applied = self._applied_generation
            if activation is not None and applied == desired.desired_generation:
                observed = self._observe(activation)
                if observed.phase == PHASE_RUNNING and not observed.restart_required:
                    return self._success()
            # Even a failed unpublished candidate must settle before resolution.
            if not self._settle():
                raise ChannelAManagerError(PRISMA_CHANNEL_A_STOP_UNCONFIRMED)
            candidate, epoch = self._new_candidate(desired)
            failure_code = None
            try:
                prepared = _call(lambda: candidate.prepare(), PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
                if prepared is not True:
                    raise ChannelAManagerError(PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
                started = _call(lambda: candidate.start(), PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
                if started is not True:
                    raise ChannelAManagerError(PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
                observed = self._observe(candidate)
                if observed.phase != PHASE_RUNNING or observed.restart_required:
                    raise ChannelAManagerError(PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
            except Exception as error:
                failure_code = _error_code(error, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
            if failure_code is not None:
                # Settle outside the originating handler: cleanup must not link
                # its dependency errors to the failed preparation/start error.
                # Uncertainty still retains authority and the originating code.
                self._settle()
                _raise_closed(failure_code)
            generation = desired.desired_generation
            with self._lock:
                self._applied_generation = generation
                self._activation_epoch = epoch
            return self._success()
