"""Inert Channel A coordinator; explicit Apply is the only activation entry.

Admission is separate from the state lock. Every foreign call (including method
lookup and status accessors) occurs outside that lock. Only a confirmed stop
withdraws owned authority; reservation acquisition/release belongs to the runner.
"""

from __future__ import annotations

from contextlib import contextmanager
from threading import Lock

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
    PRISMA_CHANNEL_A_RESTART_REQUIRED,
    TELEGRAM_BOT_IDENTITY_RESERVED,
)
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
    TELEGRAM_BOT_IDENTITY_RESERVED,
})
_ERROR_CODES = _CONFIGURATION_CODES | _CREDENTIAL_CODES | _LIFECYCLE_CODES | frozenset({
    _INVALID_CREDENTIAL, PRISMA_CHANNEL_A_MANAGER_BUSY, PRISMA_CHANNEL_A_STOP_UNCONFIRMED,
})
_PHASES = frozenset({
    PHASE_IDLE, PHASE_PREPARING, PHASE_PREPARED, PHASE_RUNNING,
    PHASE_STOPPING, PHASE_STOPPED, PHASE_FAILED, PHASE_RETIRED,
})


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
    def __init__(self, *, credential_service, configuration_store, activation_factory, reservation):
        self._credentials = credential_service
        self._configuration = configuration_store
        self._factory = activation_factory
        self._reservation = reservation
        # This closure captures the protected service, never a resolved secret.
        self._resolver = ChannelACredentialResolver(lambda: credential_service)
        self._lock = Lock()
        self._busy = False
        self._activation = None
        self._retired = None  # Bounded: only the most recently confirmed retirement.
        self._attempt_epoch = 0
        self._applied_generation = None
        self._activation_epoch = None
        self._last_error = None

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
            observed = self._observe(activation)
            return {
                "configured": present,
                "desiredGeneration": desired.desired_generation,
                "appliedGeneration": generation,
                "activationEpoch": epoch,
                "activation": observed,
                "lastError": error,
            }
        except Exception as error:
            code = _error_code(error, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
        self._record_error(code)
        _raise_closed(code)

    def _success(self):
        self._record_error(None)
        return self.status()

    def save_credential(self, secret):
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

    def stop(self):
        with self._mutation():
            confirmed = self._settle()
            self._record_error(None if confirmed else PRISMA_CHANNEL_A_STOP_UNCONFIRMED)
            return confirmed

    def delete_credential(self):
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
        with self._lock:
            self._activation = candidate
        return candidate, epoch

    def apply(self):
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
