"""Offline guard harness for the standalone Channel A activation runner (RCA-5c).

This module is the staged first artifact of RCA-5c. Before the production
``prisma_runtime.channel_a_lifecycle`` module or any behavioral test exists, it
installs the safety harness every later test in this file must run under:

* a per-test ``requests.Session.request`` record/refuse guard that counts
  attempts as bare numbers and raises one fixed sanitized error,
* an inert lower transport floor (``HTTPAdapter.send``) installed first that
  must never be reached and cannot authorise real I/O,
* an owned-activity registry that registers cancellation callbacks, release
  events and production-managed thread ownership before launch, and keeps the
  request guard installed through bounded worker cleanup.

Restoration and the external cleanup assertions are registered with
``addCleanup`` immediately after each patch succeeds, so a partial ``setUp``
failure still restores both patches. Teardown is phased: cancel/release ALL,
join ALL started threads, then collect every external error, liveness, guard and
floor assertion, and only then restore -- one failing phase never short-circuits
the rest.

Nothing here performs real I/O, sleeps, daemon-only cleanup, or synthetic
network attempts outside the deliberately refused proofs. The behavioral tests
and the production module itself are added only after explicit parent approval;
this scaffold is unvalidated and unaccepted.
"""

from __future__ import annotations

import dataclasses
import io
import sys
import threading
import unittest
from pathlib import Path

import requests
import requests.adapters

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

# The single fixed sanitized error for every refused offline dispatch.
CHANNEL_A_OFFLINE_DISPATCH_REFUSED = "PRISMA_CHANNEL_A_OFFLINE_DISPATCH_REFUSED"
# Bounded, non-sleep budgets for fake barrier waits and owned-thread joins.
_FAKE_BARRIER_TIMEOUT_SECONDS = 5.0
_BOUNDED_JOIN_SECONDS = 5.0


class OfflineDispatchRefused(RuntimeError):
    """Fixed guard error: an offline test must never dispatch a real request."""

    def __init__(self) -> None:
        super().__init__(CHANNEL_A_OFFLINE_DISPATCH_REFUSED)


def install_inert_transport_floor(case) -> list[int]:
    """Install the lower inert dispatcher below ``Session.request`` FIRST.

    It answers nothing and records a bare numeric attempt; it never builds a
    socket, reads an environment value or inspects the request. Probes install
    this before the primary guard so no version of the code under test can reach
    the network even if the primary funnel guard were absent. The original
    dispatcher is restored by a cleanup registered immediately after the patch.
    """
    attempted: list[int] = []
    original = requests.adapters.HTTPAdapter.send

    def inert_send(self, request, *args, **kwargs):
        attempted.append(1)
        raise OfflineDispatchRefused()

    requests.adapters.HTTPAdapter.send = inert_send
    case.addCleanup(lambda: setattr(requests.adapters.HTTPAdapter, "send", original))
    return attempted


def install_offline_dispatch_guard(case) -> list[int]:
    """Refuse every real outbound dispatch for the lifetime of one test case.

    ``requests.Session.request`` is the single funnel behind ``get`` and
    ``post``, so one class-level patch covers every channel call regardless of
    the verb a path uses. Attempts are counted as bare numbers before any
    inspection, and the refusal raises one fixed error with no URL, method, body
    or token detail. The assertion is registered as a cleanup so a broad
    ``except Exception`` inside the code under test cannot swallow it, and the
    original funnel is always restored, including on a partial ``setUp``.
    """
    attempts: list[int] = []
    original = requests.Session.request

    def guarded_request(self, method, url, *args, **kwargs):
        attempts.append(1)
        raise OfflineDispatchRefused()

    requests.Session.request = guarded_request
    case.addCleanup(lambda: setattr(requests.Session, "request", original))
    case.addCleanup(lambda: case.assertEqual(attempts, [], "an unexpected real HTTP dispatch was attempted"))
    return attempts


class OwnedChannelAActivity:
    """Failure-safe ownership of one test's threads, barriers and outcomes.

    A test that drives the runner must still cancel, release and join everything
    after a passing run, an assertion failure or an escaping exception. Per-runner
    cancellation callbacks, release events and production-managed threads are all
    registered before launch. ``register_cleanup`` runs before the first launch, so
    unittest's last-registered-first order performs this teardown while the offline
    dispatch guard is still installed; a guard restored earlier could let an owned
    thread dispatch unguarded.
    """

    def __init__(self, case) -> None:
        self._case = case
        self._cancellers: list = []
        self._events: list = []
        self._threads: list = []
        self._timeouts: list = []
        self._errors: list = []
        self._lock = threading.Lock()

    def register_cleanup(self) -> None:
        """Register phased teardown before any owned thread or event exists."""
        self._case.addCleanup(self._teardown)

    def register_canceller(self, callback):
        """Register a per-runner cancellation callback before launch."""
        self._cancellers.append(callback)
        return callback

    def watch(self, event):
        """Track a fake barrier or release event so teardown always releases it."""
        self._events.append(event)
        return event

    def request_cancel(self) -> list:
        """Invoke every registered canceller, returning any callback failures."""
        problems = []
        for callback in list(self._cancellers):
            try:
                callback()
            except BaseException as error:  # noqa: BLE001 - returned, never swallowed
                problems.append(error)
        return problems

    def await_event(self, event, label, timeout=_FAKE_BARRIER_TIMEOUT_SECONDS):
        """Wait for a fake barrier, recording a timeout instead of asserting.

        A callback that never observes its barrier records the timeout as an
        external outcome and requests cancellation, so the code under test cannot
        keep polling and no assertion is raised inside its own ``except`` block.
        """
        if event.wait(timeout):
            return True
        with self._lock:
            self._timeouts.append(label)
        for problem in self.request_cancel():
            self.record_error(problem)
        return False

    def record_error(self, error) -> None:
        """Record one callback or thread exception as an external outcome."""
        with self._lock:
            self._errors.append(error)

    def protect(self, callback):
        """Wrap a production-invoked callback so its exception is never swallowed."""

        def guarded(*args, **kwargs):
            try:
                return callback(*args, **kwargs)
            except BaseException as error:  # noqa: BLE001 - recorded then re-raised
                self.record_error(error)
                raise

        return guarded

    def start(self, target, *, label):
        """Track and start one owned thread whose exception becomes an outcome."""

        def owned_target() -> None:
            try:
                target()
            except BaseException as error:  # noqa: BLE001 - recorded, asserted externally
                self.record_error(error)

        thread = threading.Thread(target=owned_target, name=label)
        # Tracked before start so a thread that fails to start is still handled.
        self._threads.append(thread)
        thread.start()
        return thread

    def own(self, thread):
        """Track a thread started elsewhere, for example by the code under test."""
        if thread is not None:
            self._threads.append(thread)
        return thread

    def owned_threads(self) -> list:
        """Return a copy of every tracked thread, started or not."""
        return list(self._threads)

    def outcomes(self):
        """Return read-only copies of the recorded timeouts and errors."""
        with self._lock:
            return list(self._timeouts), list(self._errors)

    def assert_clean(self) -> None:
        """Assert external outcomes outside every production catch."""
        timeouts, errors = self.outcomes()
        self._case.assertEqual(timeouts, [], "a fake callback timed out instead of observing its barrier")
        self._case.assertEqual(errors, [], "an owned callback or thread raised an unexpected error")

    def _teardown(self) -> None:
        problems = []
        # Cancellation and barrier release always precede the joins; a join must
        # never block on a barrier the failing test never released.
        try:
            problems.extend(self.request_cancel())
        except BaseException as error:  # noqa: BLE001 - collected, raised after all phases
            problems.append(error)
        for event in self._events:
            try:
                event.set()
            except BaseException as error:  # noqa: BLE001 - collected
                problems.append(error)
        for thread in self._threads:
            try:
                # An unstarted or failed-start thread has no ident and is skipped.
                if getattr(thread, "ident", None) is not None:
                    thread.join(_BOUNDED_JOIN_SECONDS)
            except BaseException as error:  # noqa: BLE001 - collected
                problems.append(error)
        for thread in self._threads:
            try:
                self._case.assertFalse(thread.is_alive(), "an owned thread survived teardown")
            except BaseException as error:  # noqa: BLE001 - collected
                problems.append(error)
        try:
            self.assert_clean()
        except BaseException as error:  # noqa: BLE001 - collected
            problems.append(error)
        if problems:
            # Raised only after every phase ran, so one broken cleanup assertion
            # cannot skip the remaining releases, joins, liveness or guard checks.
            raise problems[0]


class ChannelALifecycleTestCase(unittest.TestCase):
    """Base case: every behavior test runs under the offline dispatch guard.

    Cleanup order (last-registered-first) is the teardown contract: owned-activity
    teardown runs first, then the declared post-join checks, while both patches and
    the managed-thread capture are still installed; only after that come the
    inert-floor and request-guard assertions and finally the restorations.
    """

    def setUp(self) -> None:
        super().setUp()
        self.floor_attempts = install_inert_transport_floor(self)
        self.request_attempts = install_offline_dispatch_guard(self)
        self.addCleanup(self._assert_inert_floor_untouched)
        self.activity = OwnedChannelAActivity(self)
        # Registered before the activity cleanup on purpose: teardown is
        # last-registered-first, so the capture outlives the owned-activity
        # teardown and keeps intercepting every managed thread construction.
        self.capture = ManagedThreadCapture(self, self.activity).install()
        self.post_join_checks: list = []
        # Registered after the capture and before the activity cleanup, so these
        # checks run after every owned thread was cancelled and joined, and before
        # the capture or either network guard is restored.
        self.addCleanup(self._run_post_join_checks)
        self.activity.register_cleanup()

    def _run_post_join_checks(self) -> None:
        """Validate every declared outcome once owned activity has been joined.

        Every check is attempted, so one failing assertion can never hide the
        others; the first failure is raised only after all of them ran.
        """
        problems = []
        for check in self.post_join_checks:
            try:
                check()
            except BaseException as error:  # noqa: BLE001 - collected, raised after all checks
                problems.append(error)
        if problems:
            raise problems[0]

    def _assert_inert_floor_untouched(self) -> None:
        self.assertEqual(self.floor_attempts, [], "the inert transport floor must never be reached")


class LifecycleGuardHarnessProofTest(ChannelALifecycleTestCase):
    """Proves the harness discriminates and always restores."""

    def test_request_guard_fails_externally_when_production_swallows_the_refusal(self) -> None:
        """The counter is never cleared, so external cleanup must fail the run.

        The probe uses an invalid host and disables ``trust_env`` so a guard bypass
        could not consult netrc or proxy configuration for real credentials. The
        inert floor is installed first, so no version of the code can reach a socket.
        """
        recorded = {}
        before_request = requests.Session.request
        before_send = requests.adapters.HTTPAdapter.send

        class GuardProbe(unittest.TestCase):
            def runTest(inner):
                recorded["floor"] = install_inert_transport_floor(inner)
                recorded["guard"] = install_offline_dispatch_guard(inner)
                probe = requests.Session()
                probe.trust_env = False
                recorded["probe"] = probe
                try:
                    probe.request("GET", "http://channel-a.invalid/getMe")
                except OfflineDispatchRefused:
                    # Production-style catch. The attempt counter stays uncleared.
                    pass

        result = unittest.TestResult(stream=io.StringIO())
        GuardProbe().run(result)

        self.assertFalse(result.wasSuccessful())
        self.assertEqual(len(result.errors) + len(result.failures), 1)
        rendered = "\n".join(text for _, text in result.errors + result.failures)
        self.assertIn("an unexpected real HTTP dispatch was attempted", rendered)
        self.assertEqual(recorded["guard"], [1])
        self.assertEqual(recorded["floor"], [])
        # Both patches are restored to the enclosing harness state.
        self.assertIs(requests.Session.request, before_request)
        self.assertIs(requests.adapters.HTTPAdapter.send, before_send)

    def test_owned_activity_teardown_cancels_releases_joins_and_surfaces_failures(self) -> None:
        """A case that fails before releasing or joining must still clean up.

        The nested case fails intentionally before releasing its barrier, and also
        runs an inert worker that raises. The outer assertions require the nested
        run to fail, to have cancelled and released before its joins, to have joined
        every owned thread, and to have surfaced the worker error externally.
        """
        recorded = {}

        class InertCanceller:
            def __init__(self) -> None:
                self.cancelled = 0

            def cancel(self) -> None:
                self.cancelled += 1

        class FailingFixtureCase(unittest.TestCase):
            def runTest(inner):
                canceller = InertCanceller()
                activity = OwnedChannelAActivity(inner)
                activity.register_canceller(canceller.cancel)
                activity.register_cleanup()
                barrier = activity.watch(threading.Event())

                def wait_for_barrier():
                    activity.await_event(barrier, "inert-barrier-worker")

                def raise_inert_failure():
                    raise RuntimeError("inert worker failure")

                activity.start(wait_for_barrier, label="prisma-channel-a-inert-barrier-worker")
                activity.start(raise_inert_failure, label="prisma-channel-a-inert-error-worker")
                recorded["canceller"] = canceller
                recorded["activity"] = activity
                recorded["barrier"] = barrier
                recorded["threads"] = activity.owned_threads()
                inner.assertEqual(canceller.cancelled, 0, "teardown must be the first canceller")
                raise AssertionError("intentional nested failure before barrier release")

        result = unittest.TestResult(stream=io.StringIO())
        FailingFixtureCase().run(result)

        rendered = "\n".join(text for _, text in result.errors + result.failures)
        # One entry for the intentional test failure and one for the surfaced
        # inert worker error: an intentional failure is never a clean pass.
        self.assertGreaterEqual(len(result.errors) + len(result.failures), 2)
        self.assertIn("an owned callback or thread raised an unexpected error", rendered)
        self.assertTrue(recorded["canceller"].cancelled, "teardown never requested cancellation")
        self.assertTrue(recorded["barrier"].is_set(), "teardown never released the fake barrier")
        self.assertFalse(
            any(thread.is_alive() for thread in recorded["threads"]),
            "teardown left an owned thread alive",
        )
        timeouts, errors = recorded["activity"].outcomes()
        self.assertEqual(timeouts, [])
        self.assertEqual([type(error) for error in errors], [RuntimeError])

    def test_owned_activity_teardown_handles_unstarted_and_stopped_threads_safely(self) -> None:
        """Unstarted or already-stopped slots are skipped without masking cleanup."""
        recorded = {}

        class UnstartedThread:
            name = "prisma-channel-a-unstarted"
            ident = None

            def is_alive(self):
                return False

            def join(self, timeout=None):
                raise AssertionError("an unstarted thread must never be joined")

        class StoppedThread:
            name = "prisma-channel-a-stopped"
            ident = 1

            def __init__(self) -> None:
                self.joins = 0

            def is_alive(self):
                return False

            def join(self, timeout=None):
                self.joins += 1

        class UnstartedCase(unittest.TestCase):
            def runTest(inner):
                activity = OwnedChannelAActivity(inner)
                activity.register_cleanup()
                stopped = StoppedThread()
                activity.own(UnstartedThread())
                activity.own(stopped)
                activity.own(None)
                recorded["activity"] = activity
                recorded["stopped"] = stopped

        result = unittest.TestResult(stream=io.StringIO())
        UnstartedCase().run(result)

        self.assertTrue(result.wasSuccessful(), "unstarted slots must not break teardown")
        self.assertEqual(recorded["stopped"].joins, 1)
        timeouts, errors = recorded["activity"].outcomes()
        self.assertEqual((timeouts, errors), ([], []))


import prisma_runtime.channel_a_lifecycle as lifecycle_module
from prisma_runtime.bot_identity_reservation import (
    BotIdentityReservationError,
    process_bot_identity_reservation,
)
from prisma_runtime.channel_a_bot import (
    INGRESS_IGNORED_STALE,
    INGRESS_IGNORED_UNSUPPORTED,
    SEND_UNKNOWN,
    VARIANT_UNKNOWN,
    ChannelAPairingDialogue,
    IngressOutcome,
)
from prisma_runtime.channel_a_lifecycle import (
    DISPOSITION_BUSY,
    DISPOSITION_COMPLETED,
    DISPOSITION_FAILED,
    DISPOSITION_RESTART_REQUIRED,
    DISPOSITION_STOPPED,
    PHASE_FAILED,
    PHASE_IDLE,
    PHASE_PREPARED,
    PHASE_PREPARING,
    PHASE_RETIRED,
    PHASE_STOPPED,
    PHASE_STOPPING,
    PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,
    PRISMA_CHANNEL_A_RESTART_REQUIRED,
    SEVEN_DAY_HORIZON_SECONDS,
    TELEGRAM_BOT_IDENTITY_RESERVED,
    ChannelALifecycleError,
    ChannelAPollResult,
    ChannelARunner,
    ChannelAStatus,
)
from prisma_runtime.channel_a_pairing import ChannelAPairingRegistry
from prisma_runtime.channel_a_transport import GET_UPDATES_LIMIT, ChannelABotIdentity

# Distinguishes "not supplied" from an explicit ``None`` in every builder.
_UNSET = object()

DEFAULT_BOT_ID = 1234
DEFAULT_USERNAME = "prisma_channel_a"
MANAGED_THREAD_NAME = "prisma-channel-a-lifecycle"
CANARY = "CANARY-PRISMA-RCA5C-SECRET-TOKEN"


# -- managed-thread capture ------------------------------------------------


def _exploding_start() -> None:
    """Replace ``Thread.start`` to simulate a launch that fails immediately."""
    raise RuntimeError(CANARY)


class ManagedThreadCapture:
    """Deterministic, test-owned capture of every production-managed thread.

    The lifecycle owns exactly one thread shape: it builds a ``threading.Thread``
    around a target and starts it itself. This facade is installed on the lifecycle
    module's ``threading`` global for the duration of a test, so the *exact* thread
    object is recorded and handed to the owned-activity teardown BEFORE the
    production ``start()`` runs.

    Deliberately narrow: only the lifecycle module's reference is replaced, and
    only its ``Thread`` attribute is intercepted. Both the delegated attributes and
    the underlying thread factory come from this test module's untouched
    standard-library ``threading``, so a nested capture never chains into an
    enclosing capture and the fixture's own threads are never intercepted.
    ``restore`` puts back the exact prior object, which for a nested case is the
    enclosing facade. Nothing here enumerates threads, matches names, or sleeps.
    """

    def __init__(self, case, activity) -> None:
        self._case = case
        self._activity = activity
        self._module = lifecycle_module
        # The exact object to put back: the enclosing facade for a nested case, or
        # the real module at the top level.
        self._prior = lifecycle_module.threading
        # The untouched standard-library module: the one real thread factory, so a
        # nested capture owns only its own thread.
        self._stdlib = threading
        self._threads: list = []
        self._escaped: list = []
        self._fail_next = False
        self._installed = False

    # -- lifecycle ---------------------------------------------------------

    def install(self) -> "ManagedThreadCapture":
        """Swap the lifecycle module's ``threading`` global for the facade."""
        capture = self

        class _CapturedThread:
            """Callable stand-in for ``threading.Thread`` that records the build.

            It is a class so a non-call reference such as a ``Thread | None``
            annotation stays a valid type expression, while the construction is
            forwarded to the real thread builder.
            """

            def __new__(cls, *args, **kwargs):
                return capture._build(*args, **kwargs)

        class _LifecycleThreadingFacade:
            """Delegates every attribute; intercepts only ``Thread``."""

            def __getattr__(self, name):
                if name == "Thread":
                    return _CapturedThread
                return getattr(capture._stdlib, name)

        self._module.threading = _LifecycleThreadingFacade()
        self._installed = True
        self._case.addCleanup(self.restore)
        return self

    def restore(self) -> None:
        """Put back the exact object that was installed before the facade."""
        if not self._installed:
            return
        self._module.threading = self._prior
        self._installed = False

    # -- capture -----------------------------------------------------------

    def _build(self, *args, **kwargs):
        """Build the real thread, wrapping its target and owning it at once."""
        target = kwargs.pop("target", None)
        target_args = kwargs.pop("args", ())
        self._case.assertTrue(
            callable(target), "the lifecycle must build every managed thread with a target"
        )
        capture = self

        def recorded_target(*inner_args, **inner_kwargs):
            # An error escaping the managed target is recorded here, then handed
            # back unchanged so production still observes exactly what it threw.
            try:
                return target(*inner_args, **inner_kwargs)
            except BaseException as error:
                capture._escaped.append(error)
                raise

        thread = self._stdlib.Thread(*args, target=recorded_target, args=target_args, **kwargs)
        if self._fail_next:
            self._fail_next = False
            thread.start = _exploding_start
        # Owned before the production ``start()``: the exact object is known here,
        # so teardown never has to discover it.
        self._threads.append(thread)
        self._activity.own(thread)
        return thread

    def fail_next_start(self) -> None:
        """Make the next captured thread's own ``start()`` raise."""
        self._fail_next = True

    # -- evidence ----------------------------------------------------------

    def captured_threads(self) -> list:
        return list(self._threads)

    def last_thread(self):
        self._case.assertTrue(self._threads, "no managed thread was captured")
        return self._threads[-1]

    def escaped_errors(self) -> list:
        return list(self._escaped)


class _ManagedExpectation:
    """The outcome one managed path declared *before* production started it.

    Declared before ``start()`` and validated after every owned thread has been
    cancelled and joined, but before the capture and the network guards are
    restored. A failed start, a failing test body, or a worker that only fails
    once cleanup releases it can therefore never hide a terminal failure or an
    error that escaped the managed boundary.
    """

    def __init__(self, case, runner, *, expect_failure) -> None:
        self._case = case
        self._runner = runner
        self._expect_failure = expect_failure
        # Captured at declaration time, before the production start built anything.
        self.captured_before = len(case.capture.captured_threads())

    def validate(self) -> None:
        """Check every declared outcome even when an earlier check failed."""
        case = self._case
        problems = []

        def check(callback, *args, **kwargs):
            try:
                callback(*args, **kwargs)
            except BaseException as error:  # noqa: BLE001 - collected, raised after all checks
                problems.append(error)

        def read(read_callback, fallback):
            """Read a settled value without letting a failing read hide a check."""
            try:
                return read_callback()
            except BaseException as error:  # noqa: BLE001 - collected, raised after all checks
                problems.append(error)
                return fallback

        settled = read(self._runner.stop, False)
        status = read(self._runner.status, None)

        check(case.assertTrue, settled, "a managed runner must settle on stop")
        if status is not None:
            check(case.assertTrue, status.quiescent, "a settled runner must be quiescent")
            if self._expect_failure is None:
                check(
                    case.assertEqual,
                    status.phase,
                    PHASE_STOPPED,
                    "the managed loop failed without a declared expectation",
                )
                check(case.assertIsNone, status.reason)
            else:
                check(case.assertEqual, status.phase, PHASE_FAILED)
                check(case.assertEqual, status.reason, self._expect_failure)
        check(
            case.assertEqual,
            case.capture.escaped_errors(),
            [],
            "no error may escape the managed boundary",
        )
        if problems:
            raise problems[0]


# -- inert doubles ---------------------------------------------------------


class _FakeClock:
    """Deterministic monotonic clock with optional tracing and forced failure."""

    def __init__(self, start=1000.0, trace=None) -> None:
        self._lock = threading.Lock()
        self._value = float(start)
        self._trace = trace
        self.samples = 0
        self.failure = None

    def __call__(self):
        if self._trace is not None:
            self._trace.append("clock")
        with self._lock:
            self.samples += 1
            if self.failure is not None:
                raise self.failure
            return self._value

    def set(self, value) -> None:
        with self._lock:
            self._value = float(value)

    def advance(self, delta) -> None:
        with self._lock:
            self._value += float(delta)

    def peek(self) -> float:
        with self._lock:
            return self._value


class _FakeLease:
    def __init__(self, bot_id, owner, epoch) -> None:
        self.bot_id = bot_id
        self.owner = owner
        self.epoch = epoch


class _FakeReservation:
    """Injected reservation seam with a scripted release outcome."""

    def __init__(self) -> None:
        self.acquires: list = []
        self.releases: list = []
        self.script: list = []
        self.acquire_error = None
        self.on_acquire = None

    def acquire(self, bot_id, *, owner, epoch):
        if self.on_acquire is not None:
            self.on_acquire(bot_id, owner, epoch)
        if self.acquire_error is not None:
            raise self.acquire_error
        self.acquires.append((bot_id, owner, epoch))
        return _FakeLease(bot_id, owner, epoch)

    def release(self, lease):
        self.releases.append(lease)
        if self.script:
            kind, payload = self.script.pop(0)
            if kind == "raise":
                raise payload
            return payload
        return True


class _FakeTransport:
    """Inert Channel A transport double; it never constructs a session."""

    def __init__(self, *, request_timeout=5, identity=_UNSET, batches=None) -> None:
        self.request_timeout = request_timeout
        self.identity = (
            ChannelABotIdentity(id=DEFAULT_BOT_ID, username=DEFAULT_USERNAME)
            if identity is _UNSET
            else identity
        )
        self.batches = list(batches or [])
        self.get_me_calls = 0
        self.get_updates_calls: list = []
        self.get_me_error = None
        self.get_updates_error = None
        self.on_get_me = None
        self.on_get_updates = None

    def get_me(self):
        self.get_me_calls += 1
        if self.on_get_me is not None:
            self.on_get_me()
        if self.get_me_error is not None:
            raise self.get_me_error
        return self.identity

    def get_updates(self, *, poll_timeout, read_timeout, offset=None):
        self.get_updates_calls.append((poll_timeout, read_timeout, offset))
        if self.on_get_updates is not None:
            self.on_get_updates(offset)
        if self.get_updates_error is not None:
            raise self.get_updates_error
        if self.batches:
            return self.batches.pop(0)
        return ()

    def send_message(self, **kwargs):
        raise AssertionError("the lifecycle must never send chat text")

    def answer_callback_query(self, **kwargs):
        raise AssertionError("the lifecycle must never acknowledge a callback")


def _make_registry(clock, **overrides):
    options = dict(warning_lead=60.0, clock=clock)
    options.update(overrides)
    return ChannelAPairingRegistry(**options)


def _make_dialogue(transport, clock, *, bot_id=DEFAULT_BOT_ID, registry=None, handler=None):
    """Build a REAL dialogue (the runner validates the concrete type).

    ``handler`` replaces only the per-instance ingress entry point so a test can
    declare exact outcomes; the object stays a real ``ChannelAPairingDialogue``.
    """
    resolved = _make_registry(clock) if registry is None else registry
    dialogue = ChannelAPairingDialogue(
        bot_id=bot_id,
        registry=resolved,
        transport=transport,
        destination_label=lambda: "Documento de laboratorio",
        clock=clock,
    )
    if handler is not None:
        dialogue.handle_update = handler
    return dialogue


def _outcome(update_id, *, kind=INGRESS_IGNORED_UNSUPPORTED, accepted=True, delivery=None):
    if delivery is None:
        return IngressOutcome(update_id, VARIANT_UNKNOWN, kind, accepted)
    return IngressOutcome(update_id, VARIANT_UNKNOWN, kind, accepted, delivery)


def _report(result) -> str:
    """Render every nested ``TestResult`` outcome for the outer message."""
    details = list(result.failures) + list(result.errors)
    return "\n".join(f"{test}: {trace}" for test, trace in details)


class _HookClock(_FakeClock):
    """A fake clock that fires one recorded hook from inside a sample call.

    The hook runs after the sample was produced and after the clock released its
    own lock, so a hook that re-enters the runner cannot deadlock the clock.
    """

    def __init__(self, start=1000.0, trace=None) -> None:
        super().__init__(start=start, trace=trace)
        self._remaining = None
        self._hook = None

    def arm(self, *, after_samples, hook) -> None:
        """Fire ``hook`` on the ``after_samples``-th call counted from now."""
        self._remaining = after_samples
        self._hook = hook

    def __call__(self):
        value = super().__call__()
        if self._remaining is not None:
            self._remaining -= 1
            if self._remaining <= 0:
                self._remaining = None
                hook, self._hook = self._hook, None
                hook()
        return value


class _CanaryFloat(float):
    """A float subclass whose conversion raises, to prove sanitized validation.

    CPython dispatches ``float(value)`` to a subclass's ``__float__``. If a
    runtime ever disagreed, this double alone could not make a test fail, so
    every expectation built on it is paired with a non-conversion check.
    """

    def __float__(self):
        raise RuntimeError(CANARY)


class _HostileAttributeTransport:
    """A transport whose ``request_timeout`` accessor raises instead of returning."""

    def __init__(self) -> None:
        self.calls: list = []

    @property
    def request_timeout(self):
        raise RuntimeError(CANARY)

    def get_me(self):
        self.calls.append("get_me")
        raise AssertionError("a rejected transport must never be polled")

    def get_updates(self, **kwargs):
        self.calls.append("get_updates")
        raise AssertionError("a rejected transport must never be polled")


class _SwitchingClock(_FakeClock):
    """A fake clock that returns a non-convertible sample once armed."""

    def __init__(self, start=1000.0) -> None:
        super().__init__(start=start)
        self.hostile = False

    def __call__(self):
        if self.hostile:
            return _CanaryFloat(self.peek())
        return super().__call__()


class _HostileIdentity(ChannelABotIdentity):
    """An identity whose ``id`` accessor raises a caller-chosen error.

    The accessor is a property, so it wins over any instance attribute, and the
    dataclass initializer cannot be used: the value is built directly.
    """

    @property
    def id(self):
        raise self.hostile_error

    @staticmethod
    def build(error):
        identity = object.__new__(_HostileIdentity)
        object.__setattr__(identity, "username", DEFAULT_USERNAME)
        object.__setattr__(identity, "hostile_error", error)
        return identity


class _HostileOutcome(IngressOutcome):
    """An outcome whose chosen accessor raises when the runner reads it."""

    def __getattribute__(self, name):
        if name == object.__getattribute__(self, "hostile_accessor"):
            raise object.__getattribute__(self, "hostile_error")
        return object.__getattribute__(self, name)

    @staticmethod
    def build(error, *, accessor="update_id"):
        outcome = object.__new__(_HostileOutcome)
        object.__setattr__(outcome, "update_id", 1)
        object.__setattr__(outcome, "variant", VARIANT_UNKNOWN)
        object.__setattr__(outcome, "kind", INGRESS_IGNORED_UNSUPPORTED)
        object.__setattr__(outcome, "accepted", True)
        object.__setattr__(outcome, "hostile_accessor", accessor)
        object.__setattr__(outcome, "hostile_error", error)
        return outcome


class _Escaped(BaseException):
    """An error that bypasses every ``except Exception`` in the lifecycle."""


class _ReentrantReleaseReservation(_FakeReservation):
    """A reservation whose first release tries to re-enter ``stop()``."""

    def __init__(self) -> None:
        super().__init__()
        self.entries = 0
        self.in_flight = 0
        self.peak = 0
        self.reentrant_results: list = []
        # Armed by the test after preparation, so the reentry hits the release.
        self.runner_ref: list = []

    def release(self, lease):
        self.entries += 1
        self.in_flight += 1
        self.peak = max(self.peak, self.in_flight)
        try:
            if self.entries == 1 and self.runner_ref:
                self.reentrant_results.append(self.runner_ref[0].stop())
            return super().release(lease)
        finally:
            self.in_flight -= 1


class _BlockingReleaseReservation(_FakeReservation):
    """A reservation whose first release blocks until the test opens the gate."""

    def __init__(self, activity, entered, release_now) -> None:
        super().__init__()
        self._activity = activity
        self._entered = entered
        self._release_now = release_now
        self.entries = 0
        self.in_flight = 0
        self.peak = 0
        self.blocked: list = []

    def release(self, lease):
        self.entries += 1
        self.in_flight += 1
        self.peak = max(self.peak, self.in_flight)
        try:
            if self.entries == 1:
                self._entered.set()
                self.blocked.append(
                    self._activity.await_event(self._release_now, "blocked-release")
                )
            return super().release(lease)
        finally:
            self.in_flight -= 1


class ChannelARunnerCase(ChannelALifecycleTestCase):
    """Shared rig: every runner is stopped by the owned-activity teardown."""

    def setUp(self) -> None:
        super().setUp()
        self.received: list = []

    def make_rig(
        self,
        *,
        transport=_UNSET,
        clock=_UNSET,
        reservation=_UNSET,
        handler=None,
        dialogue=None,
        factory=_UNSET,
        registry=None,
        on_outcome=_UNSET,
        **overrides,
    ):
        transport = _FakeTransport() if transport is _UNSET else transport
        clock = _FakeClock() if clock is _UNSET else clock
        reservation = _FakeReservation() if reservation is _UNSET else reservation
        calls = []
        if factory is _UNSET:

            def factory():
                calls.append(1)
                if dialogue is not None:
                    return dialogue
                return _make_dialogue(transport, clock, registry=registry, handler=handler)

        options = dict(
            transport=transport,
            dialogue_factory=factory,
            clock=clock,
            poll_timeout=1,
            read_timeout=2.0,
            join_timeout=2.0,
            poll_pause=0.01,
            on_outcome=self.received.append if on_outcome is _UNSET else on_outcome,
            reservation=reservation,
        )
        options.update(overrides)
        runner = ChannelARunner(**options)
        runner.factory_calls = calls
        self.activity.register_canceller(runner.stop)
        return runner

    def expect_managed_outcome(self, runner, *, expect_failure=None) -> _ManagedExpectation:
        """Declare, before production start, what this managed path must settle to.

        Validated after every owned thread has been cancelled and joined: a failed
        start, a failing body or a worker that only fails once cleanup releases it
        cannot hide a terminal failure or an escaped managed error. Pass
        ``expect_failure`` when the managed loop is required to terminate
        terminally; without it any non-``STOPPED`` phase is reported externally.
        """
        expectation = _ManagedExpectation(self, runner, expect_failure=expect_failure)
        self.post_join_checks.append(expectation.validate)
        return expectation

    def launch(self, runner, *, expect_failure=None) -> bool:
        """Start the managed loop through the capture seam, never by discovery.

        Requires the production start to build exactly one managed thread, and
        that the thread is owned before it is started. The declared outcome is
        registered *before* the start, so the managed path is always validated
        even when the start itself fails or the test body aborts right after.
        """
        expectation = self.expect_managed_outcome(runner, expect_failure=expect_failure)
        before = expectation.captured_before
        started = runner.start()
        captured = self.capture.captured_threads()
        self.assertEqual(
            len(captured),
            before + 1,
            "a managed start must build exactly one thread through the seam",
        )
        thread = self.capture.last_thread()
        self.assertEqual(thread.name, MANAGED_THREAD_NAME)
        self.assertIn(
            thread, self.activity.owned_threads(), "the managed thread must be owned before start"
        )
        return started

    def assert_start_refused(self, runner) -> None:
        """Require an expected refusal that constructs no managed thread at all.

        A refusal must be ``False`` *and* build nothing: measuring the capture on
        both sides of the call detects an illegal launch that would otherwise hide
        behind a ``False`` return. It deliberately does not go through ``launch``,
        which requires exactly one managed thread.
        """
        before = len(self.capture.captured_threads())
        self.assertFalse(runner.start(), "a refused start must report False")
        self.assertEqual(
            len(self.capture.captured_threads()),
            before,
            "a refused start must not construct a managed thread",
        )

    def join_owned(self, thread) -> None:
        thread.join(5.0)
        self.assertFalse(thread.is_alive(), "an owned thread survived its bounded join")


class ManagedThreadCaptureProofTest(ChannelARunnerCase):
    """Proves the managed-thread capture is exact, honest and never shared."""

    def test_an_immediate_finish_loop_is_owned_before_it_is_started(self) -> None:
        recorded = {}
        finished = threading.Event()

        class OneShotCase(ManagedThreadCaptureProofTest):
            def runTest(inner):
                def one_shot():
                    recorded["ran"] = True
                    finished.set()

                thread = lifecycle_module.threading.Thread(
                    target=one_shot, name=MANAGED_THREAD_NAME
                )
                recorded["thread"] = thread
                recorded["captured"] = inner.capture.captured_threads()
                recorded["ident_before_start"] = thread.ident
                recorded["owned_before_start"] = thread in inner.activity.owned_threads()
                thread.start()
                recorded["observed"] = inner.activity.await_event(finished, "one-shot-loop")
                inner.join_owned(thread)

        result = unittest.TestResult(stream=io.StringIO())
        OneShotCase().run(result)
        self.assertTrue(result.wasSuccessful(), _report(result))
        self.assertTrue(recorded["ran"])
        self.assertEqual(recorded["captured"], [recorded["thread"]])
        self.assertIsNone(
            recorded["ident_before_start"], "a captured thread must not be started yet"
        )
        self.assertTrue(
            recorded["owned_before_start"], "the captured thread must be owned before start"
        )
        self.assertTrue(recorded["observed"])
        # The nested case captured its own thread: the outer capture saw nothing.
        self.assertEqual(self.capture.captured_threads(), [])

    def test_a_thread_whose_start_raises_is_still_captured_and_owned(self) -> None:
        recorded = {}

        class FailingStartCase(ManagedThreadCaptureProofTest):
            def runTest(inner):
                inner.capture.fail_next_start()

                def never_runs():
                    recorded["ran"] = True

                thread = lifecycle_module.threading.Thread(
                    target=never_runs, name=MANAGED_THREAD_NAME
                )
                recorded["thread"] = thread
                recorded["captured"] = inner.capture.captured_threads()
                recorded["owned"] = thread in inner.activity.owned_threads()
                try:
                    thread.start()
                except RuntimeError as error:
                    recorded["error"] = error

        result = unittest.TestResult(stream=io.StringIO())
        FailingStartCase().run(result)
        self.assertTrue(result.wasSuccessful(), _report(result))
        thread = recorded["thread"]
        self.assertEqual(recorded["captured"], [thread])
        self.assertTrue(recorded["owned"], "a failed launch must still be owned")
        self.assertEqual(str(recorded["error"]), CANARY)
        self.assertNotIn("ran", recorded, "a thread whose start raised must never run")
        self.assertIsNone(thread.ident)
        self.assertFalse(thread.is_alive())

    def test_a_swallowed_managed_failure_is_surfaced_externally(self) -> None:
        """A runner that hides its own terminal failure must fail the run.

        The swallowing runner reports a settled terminal failure, so the only
        thing that can fail the run is the capture harness itself.
        """

        class SwallowingRunner:
            def start(self):
                self._thread = lifecycle_module.threading.Thread(
                    target=lambda: None, name=MANAGED_THREAD_NAME
                )
                self._thread.start()
                return True

            def stop(self):
                return True

            def status(self):
                return ChannelAStatus(
                    PHASE_FAILED, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE, True, False
                )

        class DeclaredCase(ManagedThreadCaptureProofTest):
            def runTest(inner):
                inner.launch(
                    SwallowingRunner(), expect_failure=PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE
                )

        class UndeclaredCase(ManagedThreadCaptureProofTest):
            def runTest(inner):
                inner.launch(SwallowingRunner())

        declared = unittest.TestResult(stream=io.StringIO())
        DeclaredCase().run(declared)
        self.assertTrue(declared.wasSuccessful(), _report(declared))

        undeclared = unittest.TestResult(stream=io.StringIO())
        UndeclaredCase().run(undeclared)
        self.assertFalse(undeclared.wasSuccessful(), "an undeclared managed failure must fail")
        self.assertIn(
            "the managed loop failed without a declared expectation", _report(undeclared)
        )

    def test_a_post_join_check_reports_a_terminal_failure_the_body_hid(self) -> None:
        """A body failure must not hide a terminal failure released during cleanup.

        The inert managed worker only reports its terminal failure once the
        owned-activity teardown has released its gate, so the external report can
        only come from a check that runs after the joins -- never from the body.
        """
        recorded = {}

        class DeferredRunner:
            """An inert managed worker that fails only after cleanup releases it."""

            def __init__(self, activity, gate) -> None:
                self._activity = activity
                self._gate = gate
                self._released = False

            def start(self):
                thread = lifecycle_module.threading.Thread(
                    target=self._deferred_work, name=MANAGED_THREAD_NAME
                )
                recorded["thread"] = thread
                thread.start()
                return True

            def _deferred_work(self):
                self._activity.await_event(self._gate, "deferred-terminal-failure")
                self._released = True

            def stop(self):
                return True

            def status(self):
                if not self._released:
                    return ChannelAStatus(PHASE_STOPPED, None, True, False)
                return ChannelAStatus(
                    PHASE_FAILED, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE, True, False
                )

        class DeferredCase(ManagedThreadCaptureProofTest):
            def runTest(inner):
                gate = inner.activity.watch(threading.Event())
                inner.launch(DeferredRunner(inner.activity, gate))
                # The body fails while the worker's terminal failure does not exist.
                raise AssertionError("body failed before the terminal failure surfaced")

        result = unittest.TestResult(stream=io.StringIO())
        DeferredCase().run(result)

        reported = _report(result)
        self.assertFalse(result.wasSuccessful(), "the body failure must still be reported")
        self.assertIn("body failed before the terminal failure surfaced", reported)
        self.assertIn("the managed loop failed without a declared expectation", reported)
        # The external report exists only because the check ran after the join.
        self.assertFalse(recorded["thread"].is_alive(), "the check must run after the join")


# -- construction ----------------------------------------------------------


class ChannelARunnerConstructionTest(ChannelARunnerCase):
    def test_constructor_rejects_non_callable_injected_seams(self) -> None:
        for overrides in (
            {"transport": object()},
            {"dialogue_factory": None},
            {"clock": None},
            {"on_outcome": None},
            {"transport": None},
        ):
            with self.subTest(overrides=sorted(overrides)):
                with self.assertRaises(ChannelALifecycleError) as caught:
                    self.make_rig(**overrides)
                self.assertEqual(
                    caught.exception.args, (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,)
                )

    def test_constructor_requires_nonnegative_exact_int_poll_timeout(self) -> None:
        self.make_rig(poll_timeout=0, read_timeout=1.0)
        for value in (True, 1.5, -1, "1", None):
            with self.subTest(value=value):
                with self.assertRaises(ChannelALifecycleError) as caught:
                    self.make_rig(poll_timeout=value)
                self.assertEqual(
                    caught.exception.args, (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,)
                )

    def test_constructor_requires_read_timeout_above_poll_timeout(self) -> None:
        for value in (1, 0.5, float("nan"), float("inf"), True, "2"):
            with self.subTest(value=value):
                with self.assertRaises(ChannelALifecycleError) as caught:
                    self.make_rig(poll_timeout=1, read_timeout=value)
                self.assertEqual(
                    caught.exception.args, (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,)
                )
        self.make_rig(poll_timeout=1, read_timeout=1.0001)

    def test_constructor_bounds_join_timeout_and_poll_pause(self) -> None:
        for field in ("join_timeout", "poll_pause"):
            for value in (0, -1, float("nan"), float("inf"), threading.TIMEOUT_MAX, True):
                with self.subTest(field=field, value=value):
                    with self.assertRaises(ChannelALifecycleError) as caught:
                        self.make_rig(**{field: value})
                    self.assertEqual(
                        caught.exception.args, (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,)
                    )
            self.make_rig(**{field: 0.25})

    def test_constructor_validates_the_transport_connect_timeout(self) -> None:
        for value in (0, -1, float("nan"), float("inf"), True, "5", None):
            with self.subTest(value=value):
                with self.assertRaises(ChannelALifecycleError) as caught:
                    self.make_rig(transport=_FakeTransport(request_timeout=value))
                self.assertEqual(
                    caught.exception.args, (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,)
                )

    def test_constructor_sanitizes_a_raising_dependency_accessor(self) -> None:
        transport = _HostileAttributeTransport()

        with self.assertRaises(ChannelALifecycleError) as caught:
            self.make_rig(transport=transport)

        self.assertEqual(caught.exception.args, (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,))
        self.assertNotIn(CANARY, repr(caught.exception))
        self.assertEqual(transport.calls, [], "a rejected transport must never be polled")

    def test_constructor_sanitizes_a_non_convertible_budget_value(self) -> None:
        # The value is a real ``float`` instance, so the only thing that can
        # refuse it is the conversion itself, and that refusal is sanitized.
        for field, value in (
            ("read_timeout", _CanaryFloat(2.0)),
            ("join_timeout", _CanaryFloat(2.0)),
            ("poll_pause", _CanaryFloat(0.01)),
        ):
            with self.subTest(field=field):
                with self.assertRaises(ChannelALifecycleError) as caught:
                    self.make_rig(**{field: value})
                self.assertEqual(
                    caught.exception.args, (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,)
                )
                self.assertNotIn(CANARY, repr(caught.exception))

    def test_constructor_sanitizes_a_non_convertible_connect_timeout(self) -> None:
        # The transport's own connect timeout runs through a different validator
        # than the injected budgets, so it needs its own conversion proof.
        transport = _FakeTransport(request_timeout=_CanaryFloat(5.0))

        with self.assertRaises(ChannelALifecycleError) as caught:
            self.make_rig(transport=transport)

        self.assertEqual(caught.exception.args, (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,))
        self.assertNotIn(CANARY, repr(caught.exception))

    def test_constructor_rejects_a_budget_that_reaches_the_horizon(self) -> None:
        transport = _FakeTransport(request_timeout=5)
        with self.assertRaises(ChannelALifecycleError) as caught:
            self.make_rig(
                transport=transport,
                poll_timeout=1,
                read_timeout=float(SEVEN_DAY_HORIZON_SECONDS) - 1.0,
            )
        self.assertEqual(caught.exception.args, (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,))

    def test_constructor_performs_no_io_and_stays_idle(self) -> None:
        trace: list = []
        transport = _FakeTransport()
        transport.on_get_me = lambda: trace.append("get_me")
        runner = self.make_rig(transport=transport, clock=_FakeClock(trace=trace))

        self.assertEqual(trace, [])
        self.assertEqual(runner.factory_calls, [])
        self.assertEqual(transport.get_updates_calls, [])
        status = runner.status()
        self.assertEqual(status.phase, PHASE_IDLE)
        self.assertIsNone(status.reason)
        self.assertTrue(status.quiescent)
        self.assertFalse(status.restart_required)

    def test_constructor_requires_callable_reservation_seams(self) -> None:
        # ``None`` is the documented selector for the shared process registry, so
        # only a non-``None`` value without callable seams is invalid.
        for value in (object(), _FakeTransport(), 0, "registry"):
            with self.subTest(value=type(value).__name__):
                with self.assertRaises(ChannelALifecycleError) as caught:
                    self.make_rig(reservation=value)
                self.assertEqual(
                    caught.exception.args, (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,)
                )

    def test_explicit_none_selects_the_shared_process_registry(self) -> None:
        shared = process_bot_identity_reservation()
        bot_id = 999000111
        incumbent = shared.acquire(bot_id, owner=object(), epoch=object())
        self.addCleanup(shared.release, incumbent)

        transport = _FakeTransport(
            identity=ChannelABotIdentity(id=bot_id, username=DEFAULT_USERNAME)
        )
        runner = self.make_rig(transport=transport, reservation=None)
        with self.assertRaises(ChannelALifecycleError) as caught:
            runner.prepare()
        self.assertEqual(caught.exception.args, (TELEGRAM_BOT_IDENTITY_RESERVED,))
        self.assertTrue(shared.release(incumbent))
        self.assertIsNone(shared.held_by(bot_id))

    def test_status_shape_is_four_closed_fields_and_immutable(self) -> None:
        names = [field.name for field in dataclasses.fields(ChannelAStatus)]
        self.assertEqual(names, ["phase", "reason", "quiescent", "restart_required"])
        status = self.make_rig().status()
        with self.assertRaises(dataclasses.FrozenInstanceError):
            status.phase = PHASE_FAILED

    def test_poll_result_shape_is_bounded_and_immutable(self) -> None:
        names = [field.name for field in dataclasses.fields(ChannelAPollResult)]
        self.assertEqual(names, ["outcomes", "disposition", "reason"])
        result = ChannelAPollResult()
        self.assertEqual(result.outcomes, ())
        self.assertEqual(result.disposition, DISPOSITION_COMPLETED)
        self.assertIsNone(result.reason)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            result.disposition = DISPOSITION_BUSY


# -- preparation -----------------------------------------------------------


class ChannelARunnerPreparationTest(ChannelARunnerCase):
    def test_prepare_orders_clock_identity_reservation_and_factory(self) -> None:
        trace: list = []
        clock = _FakeClock(trace=trace)
        transport = _FakeTransport()
        transport.on_get_me = lambda: trace.append("get_me")
        reservation = _FakeReservation()
        reservation.on_acquire = lambda *a, **k: trace.append("acquire")
        dialogue = _make_dialogue(transport, clock)
        runner = self.make_rig(
            transport=transport,
            clock=clock,
            reservation=reservation,
            factory=lambda: (trace.append("factory"), dialogue)[1],
        )

        self.assertTrue(runner.prepare())
        self.assertEqual(trace, ["clock", "get_me", "acquire", "factory"])
        self.assertEqual(len(reservation.acquires), 1)
        bot_id, owner, epoch = reservation.acquires[0]
        self.assertEqual(bot_id, DEFAULT_BOT_ID)
        self.assertIsNot(owner, epoch)
        self.assertTrue(runner.status().quiescent)
        self.assertEqual(runner.status().phase, PHASE_PREPARED)

    def test_prepare_is_idempotent_after_success(self) -> None:
        transport = _FakeTransport()
        runner = self.make_rig(transport=transport)
        self.assertTrue(runner.prepare())
        self.assertTrue(runner.prepare())
        self.assertEqual(transport.get_me_calls, 1)
        self.assertEqual(len(runner.factory_calls), 1)

    def test_concurrent_preparation_refuses_without_mutating_the_incumbent(self) -> None:
        entered = threading.Event()
        release = self.activity.watch(threading.Event())
        transport = _FakeTransport()

        def block():
            entered.set()
            self.activity.await_event(release, "prepare-block")

        transport.on_get_me = block
        runner = self.make_rig(transport=transport)
        results: list = []
        worker = self.activity.start(lambda: results.append(runner.prepare()), label="owned-prepare")
        self.activity.await_event(entered, "prepare-entered")

        self.assertFalse(runner.prepare())
        self.assertEqual(runner.status().phase, PHASE_PREPARING)
        self.assertFalse(runner.status().quiescent)

        release.set()
        self.join_owned(worker)
        self.assertEqual(results, [True])
        self.assertEqual(runner.status().phase, PHASE_PREPARED)

    def test_poll_while_preparation_owns_admission_is_busy_not_failed(self) -> None:
        entered = threading.Event()
        release = self.activity.watch(threading.Event())
        transport = _FakeTransport()

        def block():
            entered.set()
            self.activity.await_event(release, "prepare-poll-busy")

        transport.on_get_me = block
        runner = self.make_rig(transport=transport)
        results: list = []
        worker = self.activity.start(lambda: results.append(runner.prepare()), label="owned-prepare")
        self.activity.await_event(entered, "prepare-entered")

        # Preparation already owns admission: an external poll is busy, and a
        # worker in preparation is never a terminal failure.
        result = runner.poll_once()
        self.assertEqual(result.disposition, DISPOSITION_BUSY)
        self.assertIsNone(result.reason)
        self.assertEqual(result.outcomes, ())
        self.assertEqual(transport.get_updates_calls, [])
        self.assertEqual(runner.status().phase, PHASE_PREPARING)
        self.assertFalse(runner.status().quiescent)

        release.set()
        self.join_owned(worker)
        self.assertEqual(results, [True])
        self.assertEqual(runner.status().phase, PHASE_PREPARED)
        self.assertTrue(runner.stop())

    def test_a_stop_reentering_from_the_clock_fences_before_any_io(self) -> None:
        trace: list = []
        stops: list = []
        clock = _HookClock(trace=trace)
        transport = _FakeTransport()
        transport.on_get_me = lambda: trace.append("get_me")
        reservation = _FakeReservation()
        reservation.on_acquire = lambda *a, **k: trace.append("acquire")
        dialogue = _make_dialogue(transport, clock)
        runner = self.make_rig(
            transport=transport,
            clock=clock,
            reservation=reservation,
            factory=lambda: (trace.append("factory"), dialogue)[1],
        )
        clock.arm(after_samples=1, hook=lambda: stops.append(runner.stop()))

        self.assertFalse(runner.prepare())

        self.assertEqual(stops, [False])
        self.assertEqual(trace, ["clock"])
        self.assertEqual(transport.get_me_calls, 0)
        self.assertEqual(reservation.acquires, [])
        self.assertEqual(reservation.releases, [])
        self.assertEqual(runner.status().phase, PHASE_STOPPED)
        self.assertIsNone(runner.status().reason)
        self.assertTrue(runner.status().quiescent)

    def test_a_stop_reentering_from_the_reservation_fences_before_the_factory(self) -> None:
        trace: list = []
        stops: list = []
        runner_ref: list = []
        clock = _FakeClock(trace=trace)
        transport = _FakeTransport()
        transport.on_get_me = lambda: trace.append("get_me")
        reservation = _FakeReservation()

        def on_acquire(*args, **kwargs):
            trace.append("acquire")
            stops.append(runner_ref[0].stop())

        reservation.on_acquire = on_acquire
        dialogue = _make_dialogue(transport, clock)
        runner = self.make_rig(
            transport=transport,
            clock=clock,
            reservation=reservation,
            factory=lambda: (trace.append("factory"), dialogue)[1],
        )
        runner_ref.append(runner)

        self.assertFalse(runner.prepare())

        self.assertEqual(stops, [False])
        self.assertEqual(trace, ["clock", "get_me", "acquire"])
        self.assertEqual(transport.get_me_calls, 1)
        self.assertEqual(len(reservation.acquires), 1)
        self.assertEqual(len(reservation.releases), 1)
        self.assertEqual(runner.status().phase, PHASE_STOPPED)
        self.assertIsNone(runner.status().reason)
        self.assertTrue(runner.status().quiescent)

    def test_prepare_never_reuses_a_dependency_supplied_lifecycle_code(self) -> None:
        # The identity accessor raises the lifecycle's own error class, so a
        # ``args[0]`` relay would republish a caller-supplied code verbatim.
        transport = _FakeTransport(
            identity=_HostileIdentity.build(ChannelALifecycleError(CANARY))
        )
        runner = self.make_rig(transport=transport)

        with self.assertRaises(ChannelALifecycleError) as caught:
            runner.prepare()

        self.assertEqual(caught.exception.args, (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,))
        self.assertNotIn(CANARY, repr(caught.exception))
        status = runner.status()
        self.assertEqual(status.phase, PHASE_FAILED)
        self.assertEqual(status.reason, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
        self.assertNotIn(CANARY, repr(status))
        self.assertTrue(status.quiescent)

    def test_prepare_refuses_and_settles_when_stop_lands_mid_preparation(self) -> None:
        entered = threading.Event()
        release = self.activity.watch(threading.Event())
        transport = _FakeTransport()

        def block():
            entered.set()
            self.activity.await_event(release, "prepare-stop")

        transport.on_get_me = block
        runner = self.make_rig(transport=transport)
        results: list = []
        worker = self.activity.start(lambda: results.append(runner.prepare()), label="owned-prepare")
        self.activity.await_event(entered, "prepare-entered")

        self.assertFalse(runner.stop())
        release.set()
        self.join_owned(worker)

        self.assertEqual(results, [False])
        self.assertEqual(runner.status().phase, PHASE_STOPPED)
        self.assertTrue(runner.status().quiescent)

    def test_prepare_rejects_a_foreign_identity_shape(self) -> None:
        for identity in (
            {"id": DEFAULT_BOT_ID, "username": DEFAULT_USERNAME},
            None,
            "not-an-identity",
        ):
            with self.subTest(identity=type(identity).__name__):
                transport = _FakeTransport(identity=identity)
                reservation = _FakeReservation()
                runner = self.make_rig(transport=transport, reservation=reservation)
                with self.assertRaises(ChannelALifecycleError) as caught:
                    runner.prepare()
                self.assertEqual(
                    caught.exception.args, (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,)
                )
                self.assertEqual(reservation.acquires, [])

    def test_prepare_rejects_an_out_of_bounds_bot_identifier(self) -> None:
        for bot_id in (0, -1, True, 2**53, "1234"):
            with self.subTest(bot_id=bot_id):
                transport = _FakeTransport(
                    identity=ChannelABotIdentity(id=bot_id, username=DEFAULT_USERNAME)
                )
                reservation = _FakeReservation()
                runner = self.make_rig(transport=transport, reservation=reservation)
                with self.assertRaises(ChannelALifecycleError):
                    runner.prepare()
                self.assertEqual(reservation.acquires, [])

    def test_prepare_rejects_an_unpublishable_username(self) -> None:
        # The accepted RCA-5a bound is ``[A-Za-z0-9_]{5,32}``, so case is allowed
        # and only the length/alphabet/type rules can refuse an identity.
        for username in ("abc", "has space", "with-dash", "x" * 33, 12, None, ""):
            with self.subTest(username=username):
                transport = _FakeTransport(
                    identity=ChannelABotIdentity(id=DEFAULT_BOT_ID, username=username)
                )
                reservation = _FakeReservation()
                runner = self.make_rig(transport=transport, reservation=reservation)
                with self.assertRaises(ChannelALifecycleError):
                    runner.prepare()
                self.assertEqual(reservation.acquires, [])

    def test_prepare_translates_a_real_conflict_to_the_canonical_code(self) -> None:
        reservation = _FakeReservation()
        reservation.acquire_error = BotIdentityReservationError()
        runner = self.make_rig(reservation=reservation)

        with self.assertRaises(ChannelALifecycleError) as caught:
            runner.prepare()
        error = caught.exception
        self.assertEqual(error.args, (TELEGRAM_BOT_IDENTITY_RESERVED,))
        self.assertIs(type(error), ChannelALifecycleError)
        self.assertNotIsInstance(error, BotIdentityReservationError)
        self.assertEqual(runner.status().phase, PHASE_FAILED)
        self.assertEqual(runner.status().reason, TELEGRAM_BOT_IDENTITY_RESERVED)
        self.assertTrue(runner.status().quiescent)

    def test_prepare_never_leaks_a_dependency_error_message(self) -> None:
        transport = _FakeTransport()
        transport.get_me_error = RuntimeError(CANARY)
        runner = self.make_rig(transport=transport)

        with self.assertRaises(ChannelALifecycleError) as caught:
            runner.prepare()
        self.assertEqual(caught.exception.args, (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,))
        self.assertNotIn(CANARY, str(caught.exception))
        self.assertNotIn(CANARY, repr(caught.exception))
        self.assertEqual(runner.status().phase, PHASE_FAILED)
        self.assertNotIn(CANARY, repr(runner.status()))

    def test_prepare_rejects_a_dialogue_that_is_not_the_validated_type(self) -> None:
        runner = self.make_rig(factory=lambda: {"bot_id": DEFAULT_BOT_ID})
        with self.assertRaises(ChannelALifecycleError) as caught:
            runner.prepare()
        self.assertEqual(caught.exception.args, (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,))

    def test_prepare_rejects_a_dialogue_for_a_different_bot_id(self) -> None:
        transport = _FakeTransport()
        clock = _FakeClock()
        dialogue = _make_dialogue(transport, clock, bot_id=7777)
        runner = self.make_rig(transport=transport, clock=clock, dialogue=dialogue)
        with self.assertRaises(ChannelALifecycleError):
            runner.prepare()

    def test_prepare_rejects_a_dialogue_over_a_foreign_transport(self) -> None:
        transport = _FakeTransport()
        clock = _FakeClock()
        dialogue = _make_dialogue(_FakeTransport(), clock)
        runner = self.make_rig(transport=transport, clock=clock, dialogue=dialogue)
        with self.assertRaises(ChannelALifecycleError):
            runner.prepare()

    def test_prepare_rejects_a_dialogue_over_a_foreign_registry(self) -> None:
        transport = _FakeTransport()
        clock = _FakeClock()
        dialogue = _make_dialogue(transport, clock)
        dialogue.registry = object()
        runner = self.make_rig(transport=transport, clock=clock, dialogue=dialogue)
        with self.assertRaises(ChannelALifecycleError):
            runner.prepare()

    def test_prepare_releases_the_lease_when_the_factory_fails(self) -> None:
        reservation = _FakeReservation()

        def exploding_factory():
            raise RuntimeError(CANARY)

        runner = self.make_rig(reservation=reservation, factory=exploding_factory)
        with self.assertRaises(ChannelALifecycleError) as caught:
            runner.prepare()
        self.assertEqual(caught.exception.args, (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,))
        self.assertNotIn(CANARY, str(caught.exception))
        self.assertEqual(len(reservation.acquires), 1)
        self.assertEqual(len(reservation.releases), 1)
        self.assertIs(reservation.releases[0].owner, reservation.acquires[0][1])

    def test_prepare_refuses_after_a_terminal_failure_or_stop(self) -> None:
        failed_transport = _FakeTransport()
        failed_transport.get_me_error = RuntimeError(CANARY)
        failed = self.make_rig(transport=failed_transport)
        with self.assertRaises(ChannelALifecycleError):
            failed.prepare()
        self.assertFalse(failed.prepare())

        stopped = self.make_rig()
        self.assertTrue(stopped.stop())
        self.assertFalse(stopped.prepare())

    def test_preparation_is_not_polling_success(self) -> None:
        transport = _FakeTransport()
        runner = self.make_rig(transport=transport)
        self.assertTrue(runner.prepare())
        self.assertEqual(transport.get_updates_calls, [])
        status = runner.status()
        self.assertEqual(status.phase, PHASE_PREPARED)
        self.assertTrue(status.quiescent)
        self.assertFalse(status.restart_required)


# -- batch, cursor and outcome handoff -------------------------------------


class ChannelARunnerPollingTest(ChannelARunnerCase):
    def prepared(self, *, batches=None, handler=None, **overrides):
        transport = _FakeTransport(batches=batches)
        runner = self.make_rig(transport=transport, handler=handler, **overrides)
        self.assertTrue(runner.prepare())
        return runner, transport

    def test_poll_before_prepare_fails_closed(self) -> None:
        runner = self.make_rig()
        result = runner.poll_once()
        self.assertEqual(result.disposition, DISPOSITION_FAILED)
        self.assertEqual(result.reason, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
        self.assertEqual(result.outcomes, ())

    def test_poll_processes_a_gap_ordered_batch_and_advances_the_cursor(self) -> None:
        handler = self._echo_handler()
        runner, transport = self.prepared(batches=[({"update_id": 5},), ({"update_id": 9},)], handler=handler)

        first = runner.poll_once()
        self.assertEqual(first.disposition, DISPOSITION_COMPLETED)
        self.assertEqual([item.update_id for item in first.outcomes], [5])
        self.assertEqual(first.outcomes[0], self.received[0])

        second = runner.poll_once()
        self.assertEqual([item.update_id for item in second.outcomes], [9])
        self.assertEqual(
            transport.get_updates_calls,
            [(1, 2.0, None), (1, 2.0, 6)],
        )

    def test_poll_keeps_the_first_occurrence_and_skips_stale_duplicates(self) -> None:
        runner, transport = self.prepared(
            batches=[({"update_id": 7}, {"update_id": 7})],
            handler=self._echo_handler(),
        )
        result = runner.poll_once()
        self.assertEqual(result.disposition, DISPOSITION_COMPLETED)
        self.assertEqual([item.update_id for item in result.outcomes], [7])
        self.assertEqual(len(self.received), 1)

        transport.batches = [({"update_id": 5}, {"update_id": 7})]
        again = runner.poll_once()
        self.assertEqual(again.outcomes, ())
        self.assertEqual(again.disposition, DISPOSITION_COMPLETED)
        self.assertEqual(len(self.received), 1)
        self.assertEqual(transport.get_updates_calls[-1], (1, 2.0, 8))

    def test_poll_accepts_the_maximum_identifier_and_cursor(self) -> None:
        from prisma_runtime.channel_a_bot import MAX_TELEGRAM_ID

        runner, transport = self.prepared(
            batches=[({"update_id": MAX_TELEGRAM_ID},), ({"update_id": MAX_TELEGRAM_ID},)],
            handler=self._echo_handler(),
        )
        result = runner.poll_once()
        self.assertEqual([item.update_id for item in result.outcomes], [MAX_TELEGRAM_ID])
        self.assertEqual(transport.get_updates_calls, [(1, 2.0, None)])
        runner.poll_once()
        self.assertEqual(transport.get_updates_calls[-1], (1, 2.0, MAX_TELEGRAM_ID + 1))

    def test_poll_validates_the_whole_batch_before_any_handler(self) -> None:
        cases = {
            "non_tuple": [{"update_id": 1}],
            "oversized": tuple({"update_id": index} for index in range(GET_UPDATES_LIMIT + 1)),
            "non_mapping": ("not-a-mapping",),
            "bool_id": ({"update_id": True},),
            "missing_id": ({},),
            "negative_id": ({"update_id": -1},),
            "oversized_id": ({"update_id": 2**53},),
            "float_id": ({"update_id": 1.0},),
            "decreasing_suffix": ({"update_id": 9}, {"update_id": 4}),
            "equal_then_lower": ({"update_id": 9}, {"update_id": 9}, {"update_id": 3}),
        }
        for label, batch in cases.items():
            with self.subTest(batch=label):
                runner, transport = self.prepared(batches=[batch], handler=self._echo_handler())
                result = runner.poll_once()
                self.assertEqual(result.disposition, DISPOSITION_FAILED, label)
                self.assertEqual(result.reason, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
                self.assertEqual(result.outcomes, ())
                self.assertEqual(self.received, [])
                self.assertTrue(runner.status().quiescent)

    def test_poll_rejects_a_raising_accessor_without_processing(self) -> None:
        class HostileMapping(dict):
            def get(self, key, default=None):
                raise RuntimeError(CANARY)

        runner, transport = self.prepared(
            batches=[(HostileMapping(update_id=1),)], handler=self._echo_handler()
        )
        result = runner.poll_once()
        self.assertEqual(result.disposition, DISPOSITION_FAILED)
        self.assertNotIn(CANARY, repr(result))
        self.assertEqual(self.received, [])

    def test_poll_rejects_a_mismatched_or_inconsistent_outcome(self) -> None:
        cases = {
            "wrong_id": lambda update: _outcome(update["update_id"] + 1),
            "not_accepted": lambda update: _outcome(update["update_id"], accepted=False),
            "foreign_type": lambda update: {"updateId": update["update_id"]},
            "unknown_acceptance": lambda update: _outcome(
                update["update_id"], accepted=None
            ),
        }
        for label, handler in cases.items():
            with self.subTest(case=label):
                runner, transport = self.prepared(
                    batches=[({"update_id": 4},)], handler=handler
                )
                result = runner.poll_once()
                self.assertEqual(result.disposition, DISPOSITION_FAILED, label)
                self.assertEqual(result.reason, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
                self.assertEqual(self.received, [])
                self.assertEqual(runner.status().phase, PHASE_FAILED)

    def test_poll_consumes_ignored_and_unknown_deliveries_exactly_once(self) -> None:
        deliveries = [
            _outcome(1, kind=INGRESS_IGNORED_UNSUPPORTED),
            _outcome(2, kind=INGRESS_IGNORED_STALE),
            _outcome(3, kind=INGRESS_IGNORED_UNSUPPORTED, delivery=SEND_UNKNOWN),
        ]
        order = iter(deliveries)
        runner, transport = self.prepared(
            batches=[({"update_id": 1}, {"update_id": 2}, {"update_id": 3})],
            handler=lambda update: next(order),
        )
        first = runner.poll_once()
        self.assertEqual(first.disposition, DISPOSITION_COMPLETED)
        self.assertEqual(len(first.outcomes), 3)
        self.assertEqual(self.received, deliveries)

        transport.batches = [({"update_id": 3},)]
        second = runner.poll_once()
        self.assertEqual(second.outcomes, ())
        self.assertEqual(len(self.received), 3)
        self.assertEqual(transport.get_updates_calls[-1], (1, 2.0, 4))

    def test_handler_failure_is_terminal_and_keeps_the_attempted_cursor(self) -> None:
        helper = self._echo_handler()
        calls: list = []

        def handler(update):
            calls.append(update["update_id"])
            if update["update_id"] == 6:
                raise RuntimeError(CANARY)
            return helper(update)

        runner, transport = self.prepared(
            batches=[({"update_id": 6}, {"update_id": 8})], handler=handler
        )
        result = runner.poll_once()
        self.assertEqual(result.disposition, DISPOSITION_FAILED)
        self.assertNotIn(CANARY, repr(result))
        self.assertEqual(result.outcomes, ())
        self.assertEqual(calls, [6])
        self.assertTrue(runner.stop())

        poll_calls = list(transport.get_updates_calls)
        for _ in range(2):
            fenced = runner.poll_once()
            self.assertEqual(fenced.disposition, DISPOSITION_FAILED)
            self.assertEqual(fenced.outcomes, ())
        self.assertEqual(transport.get_updates_calls, poll_calls)

    def test_consumer_failure_returns_the_completed_prefix_once(self) -> None:
        received: list = []

        def consumer(outcome):
            received.append(outcome.update_id)
            if outcome.update_id == 8:
                raise RuntimeError(CANARY)

        runner, transport = self.prepared(
            batches=[({"update_id": 6}, {"update_id": 8}, {"update_id": 9})],
            handler=self._echo_handler(),
            on_outcome=consumer,
        )
        result = runner.poll_once()
        self.assertEqual(result.disposition, DISPOSITION_FAILED)
        self.assertEqual([item.update_id for item in result.outcomes], [6, 8])
        self.assertEqual(received, [6, 8])
        self.assertNotIn(CANARY, repr(result))

        runner.poll_once()
        self.assertEqual(received, [6, 8])

    def test_transport_failure_is_terminal_and_never_retried(self) -> None:
        transport = _FakeTransport()
        transport.get_updates_error = RuntimeError(CANARY)
        runner = self.make_rig(transport=transport)
        self.assertTrue(runner.prepare())

        result = runner.poll_once()
        self.assertEqual(result.disposition, DISPOSITION_FAILED)
        self.assertNotIn(CANARY, repr(result))
        attempts = len(transport.get_updates_calls)
        self.assertEqual(runner.poll_once().disposition, DISPOSITION_FAILED)
        self.assertEqual(len(transport.get_updates_calls), attempts)

    def test_external_poll_is_busy_while_a_runner_owns_admission(self) -> None:
        entered = threading.Event()
        release = self.activity.watch(threading.Event())
        transport = _FakeTransport()

        def stall(offset):
            entered.set()
            self.activity.await_event(release, "stalled-get-updates")

        transport.on_get_updates = stall
        runner = self.make_rig(transport=transport)
        self.assertTrue(runner.prepare())

        results: list = []
        worker = self.activity.start(lambda: results.append(runner.poll_once()), label="owned-poll")
        self.activity.await_event(entered, "stalled-entered")

        self.assertEqual(runner.poll_once().disposition, DISPOSITION_BUSY)
        self.assertFalse(runner.status().quiescent)
        self.assertEqual(len(transport.get_updates_calls), 1)
        self.assertFalse(runner.stop())

        release.set()
        self.join_owned(worker)
        self.assertEqual(results[0].disposition, DISPOSITION_STOPPED)
        self.assertEqual(results[0].outcomes, ())
        self.assertTrue(runner.stop())
        self.assertEqual(runner.status().phase, PHASE_STOPPED)

    def test_a_stop_between_handlers_leaves_the_suffix_untouched(self) -> None:
        calls: list = []
        runner_ref: list = []

        def handler(update):
            calls.append(update["update_id"])
            if update["update_id"] == 6:
                # Same-thread stop: it fences immediately and reports False.
                self.assertFalse(runner_ref[0].stop())
            return _outcome(int(update["update_id"]))

        runner, transport = self.prepared(
            batches=[({"update_id": 6}, {"update_id": 8}, {"update_id": 9})],
            handler=handler,
        )
        runner_ref.append(runner)

        result = runner.poll_once()
        self.assertEqual(result.disposition, DISPOSITION_STOPPED)
        self.assertEqual([item.update_id for item in result.outcomes], [6])
        self.assertEqual(calls, [6])
        self.assertEqual(len(self.received), 1)
        # The untouched suffix is never dispatched, so no second poll happens.
        self.assertEqual(runner.poll_once().disposition, DISPOSITION_STOPPED)
        self.assertEqual(len(transport.get_updates_calls), 1)
        self.assertEqual(runner.status().phase, PHASE_STOPPED)

    def test_poll_requires_an_identifier_of_the_exact_expected_type(self) -> None:
        # ``True == 1`` and ``1.0 == 1``, so a truthy or a float identifier passes
        # a loose comparison: only an exact built-in ``int`` may be accepted.
        for label, returned in (("boolean", True), ("float", 1.0)):
            with self.subTest(identifier=label):
                self.received.clear()
                runner, transport = self.prepared(
                    batches=[({"update_id": 1},)],
                    handler=lambda update, value=returned: _outcome(value),
                )

                result = runner.poll_once()

                self.assertEqual(result.disposition, DISPOSITION_FAILED, label)
                self.assertEqual(result.reason, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
                self.assertEqual(result.outcomes, ())
                self.assertEqual(self.received, [])
                self.assertEqual(len(transport.get_updates_calls), 1)
                self.assertEqual(runner.status().phase, PHASE_FAILED)

        # Control: the exact integer for the same batch is still accepted.
        self.received.clear()
        control, transport = self.prepared(
            batches=[({"update_id": 1},)], handler=lambda update: _outcome(1)
        )
        self.assertEqual(control.poll_once().disposition, DISPOSITION_COMPLETED)
        self.assertEqual([item.update_id for item in self.received], [1])

    def test_poll_sanitizes_a_hostile_outcome_accessor(self) -> None:
        for accessor in ("update_id", "accepted"):
            with self.subTest(accessor=accessor):
                self.received.clear()
                hostile = _HostileOutcome.build(RuntimeError(CANARY), accessor=accessor)
                runner, transport = self.prepared(
                    batches=[({"update_id": 1},)], handler=lambda update: hostile
                )

                result = runner.poll_once()

                self.assertEqual(result.disposition, DISPOSITION_FAILED, accessor)
                self.assertEqual(result.reason, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
                self.assertEqual(result.outcomes, ())
                self.assertNotIn(CANARY, repr(result))
                self.assertEqual(self.received, [])
                self.assertEqual(runner.status().phase, PHASE_FAILED)

    def test_poll_sanitizes_a_non_convertible_clock_sample(self) -> None:
        clock = _SwitchingClock()
        runner, transport = self.prepared(batches=[({"update_id": 1},)], clock=clock)
        # The preparation already sampled a good value: only the poll sample is
        # hostile, so nothing but the poll's own sanitization is under test.
        clock.hostile = True

        result = runner.poll_once()

        self.assertEqual(result.disposition, DISPOSITION_FAILED)
        self.assertEqual(result.reason, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
        self.assertEqual(result.outcomes, ())
        self.assertNotIn(CANARY, repr(result))
        self.assertEqual(self.received, [])
        # The frozen fail-closed contract stops at the clock fault: the hostile
        # sample is taken before ``getUpdates``, so the transport is never called.
        # The raw conversion exception escaping ``poll_once`` is the genuine RED.
        self.assertEqual(len(transport.get_updates_calls), 0)
        self.assertEqual(runner.status().phase, PHASE_FAILED)

    def test_a_stop_reentering_from_the_per_update_sample_fences_the_handler(self) -> None:
        calls: list = []
        stops: list = []
        clock = _HookClock()
        runner, transport = self.prepared(
            batches=[({"update_id": 4},)],
            handler=lambda update: (calls.append(update["update_id"]), _outcome(4))[1],
            clock=clock,
        )
        # Preparation consumed one sample: the third call from here is the
        # per-update sample taken inside the batch.
        clock.arm(after_samples=3, hook=lambda: stops.append(runner.stop()))

        result = runner.poll_once()

        self.assertEqual(stops, [False])
        self.assertEqual(calls, [])
        self.assertEqual(self.received, [])
        self.assertEqual(result.disposition, DISPOSITION_STOPPED)
        self.assertEqual(result.outcomes, ())
        self.assertEqual(len(transport.get_updates_calls), 1)
        self.assertEqual(runner.status().phase, PHASE_STOPPED)

    @staticmethod
    def _echo_handler():
        return lambda update: _outcome(int(update["update_id"]))


# -- clock and idle retirement ---------------------------------------------


class ChannelARunnerRetirementTest(ChannelARunnerCase):
    def prepared(self, *, batches=None, handler=None, clock=None, **overrides):
        transport = _FakeTransport(batches=batches)
        clock = _FakeClock() if clock is None else clock
        runner = self.make_rig(
            transport=transport, clock=clock, handler=handler, **overrides
        )
        self.assertTrue(runner.prepare())
        return runner, transport, clock

    def test_poll_retires_when_the_remaining_horizon_reaches_zero(self) -> None:
        runner, transport, clock = self.prepared(
            batches=[({"update_id": 1},)], handler=ChannelARunnerPollingTest._echo_handler()
        )
        clock.advance(SEVEN_DAY_HORIZON_SECONDS)

        result = runner.poll_once()
        self.assertEqual(result.disposition, DISPOSITION_RESTART_REQUIRED)
        self.assertEqual(result.reason, PRISMA_CHANNEL_A_RESTART_REQUIRED)
        self.assertEqual(result.outcomes, ())
        self.assertEqual(transport.get_updates_calls, [])
        status = runner.status()
        self.assertEqual(status.phase, PHASE_RETIRED)
        self.assertTrue(status.restart_required)
        self.assertEqual(status.reason, PRISMA_CHANNEL_A_RESTART_REQUIRED)

    def test_poll_retires_before_dispatch_when_the_budget_reaches_the_horizon(self) -> None:
        runner, transport, clock = self.prepared(batches=[()])
        # connect 5 + read 2.0 == 7.0, so a remaining budget of 3 already reaches it.
        clock.advance(SEVEN_DAY_HORIZON_SECONDS - 3)

        result = runner.poll_once()
        self.assertEqual(result.disposition, DISPOSITION_RESTART_REQUIRED)
        self.assertEqual(transport.get_updates_calls, [])

    def test_poll_retires_after_return_without_touching_the_suffix(self) -> None:
        runner, transport, clock = self.prepared(
            batches=[({"update_id": 3},)], handler=ChannelARunnerPollingTest._echo_handler()
        )
        transport.on_get_updates = lambda offset: clock.advance(SEVEN_DAY_HORIZON_SECONDS)

        result = runner.poll_once()
        self.assertEqual(result.disposition, DISPOSITION_RESTART_REQUIRED)
        self.assertEqual(result.outcomes, ())
        self.assertEqual(self.received, [])

    def test_empty_batches_do_not_renew_the_idle_anchor(self) -> None:
        runner, transport, clock = self.prepared(
            batches=[(), ()], handler=ChannelARunnerPollingTest._echo_handler()
        )
        clock.advance(SEVEN_DAY_HORIZON_SECONDS / 2)
        self.assertEqual(runner.poll_once().disposition, DISPOSITION_COMPLETED)

        clock.set(SEVEN_DAY_HORIZON_SECONDS + 1000.0)
        result = runner.poll_once()
        self.assertEqual(result.disposition, DISPOSITION_RESTART_REQUIRED)

    def test_stale_only_batches_do_not_renew_the_idle_anchor(self) -> None:
        runner, transport, clock = self.prepared(
            batches=[({"update_id": 9},), ({"update_id": 3},), ({"update_id": 4},)],
            handler=ChannelARunnerPollingTest._echo_handler(),
        )
        self.assertEqual(runner.poll_once().disposition, DISPOSITION_COMPLETED)
        clock.advance(SEVEN_DAY_HORIZON_SECONDS / 2)
        stale = runner.poll_once()
        self.assertEqual(stale.disposition, DISPOSITION_COMPLETED)
        self.assertEqual(stale.outcomes, ())

        clock.set(SEVEN_DAY_HORIZON_SECONDS + 1000.0)
        self.assertEqual(runner.poll_once().disposition, DISPOSITION_RESTART_REQUIRED)

    def test_a_newly_admitted_update_renews_the_idle_anchor(self) -> None:
        runner, transport, clock = self.prepared(
            batches=[({"update_id": 5},), ({"update_id": 6},)],
            handler=ChannelARunnerPollingTest._echo_handler(),
        )
        clock.advance(SEVEN_DAY_HORIZON_SECONDS / 2)
        self.assertEqual(runner.poll_once().disposition, DISPOSITION_COMPLETED)

        clock.set(SEVEN_DAY_HORIZON_SECONDS)
        renewed = runner.poll_once()
        self.assertEqual(renewed.disposition, DISPOSITION_COMPLETED)
        self.assertEqual([item.update_id for item in renewed.outcomes], [6])

    def test_a_retired_runner_cannot_reactivate(self) -> None:
        runner, transport, clock = self.prepared(batches=[()])
        clock.advance(SEVEN_DAY_HORIZON_SECONDS)
        self.assertEqual(runner.poll_once().disposition, DISPOSITION_RESTART_REQUIRED)

        self.assertFalse(runner.prepare())
        self.assert_start_refused(runner)
        self.assertEqual(runner.poll_once().disposition, DISPOSITION_RESTART_REQUIRED)
        self.assertEqual(runner.run().disposition, DISPOSITION_RESTART_REQUIRED)
        self.assertEqual(transport.get_updates_calls, [])
        self.assertTrue(runner.stop())
        self.assertTrue(runner.status().restart_required)

    def test_invalid_or_raising_clock_samples_fail_closed(self) -> None:
        for value in (None, float("nan"), float("inf"), -1.0, True, "1000"):
            with self.subTest(value=value):
                clock = _FakeClock()
                clock.failure = None

                class _Returning:
                    def __call__(self):
                        return value

                runner = self.make_rig(clock=_Returning())
                with self.assertRaises(ChannelALifecycleError) as caught:
                    runner.prepare()
                self.assertEqual(
                    caught.exception.args, (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,)
                )
                self.assertEqual(runner.status().phase, PHASE_FAILED)

        raising = _FakeClock()
        raising.failure = RuntimeError(CANARY)
        runner = self.make_rig(clock=raising)
        with self.assertRaises(ChannelALifecycleError) as caught:
            runner.prepare()
        self.assertEqual(caught.exception.args, (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,))
        self.assertNotIn(CANARY, str(caught.exception))

    def test_a_regressing_clock_fails_closed_mid_poll(self) -> None:
        runner, transport, clock = self.prepared(batches=[()])
        transport.on_get_updates = lambda offset: clock.set(1.0)

        result = runner.poll_once()
        self.assertEqual(result.disposition, DISPOSITION_FAILED)
        self.assertEqual(result.reason, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
        self.assertEqual(runner.status().phase, PHASE_FAILED)


# -- stop, start and finalization ------------------------------------------


class ChannelARunnerStopTest(ChannelARunnerCase):
    def test_stop_of_an_unprepared_runner_is_confirmed_and_idempotent(self) -> None:
        reservation = _FakeReservation()
        runner = self.make_rig(reservation=reservation)
        self.assertTrue(runner.status().quiescent)
        self.assertTrue(runner.stop())
        self.assertTrue(runner.stop())
        self.assertEqual(runner.status().phase, PHASE_STOPPED)
        self.assertIsNone(runner.status().reason)
        self.assertEqual(reservation.releases, [])

    def test_a_reentrant_release_enters_exactly_once(self) -> None:
        reservation = _ReentrantReleaseReservation()
        runner = self.make_rig(reservation=reservation)
        self.assertTrue(runner.prepare())
        # Armed after preparation so the reentry lands on the release itself.
        reservation.runner_ref.append(runner)

        self.assertTrue(runner.stop())

        self.assertEqual(reservation.entries, 1)
        self.assertEqual(reservation.peak, 1)
        self.assertEqual(reservation.reentrant_results, [False])
        self.assertEqual(len(reservation.releases), 1)
        self.assertEqual(runner.status().phase, PHASE_STOPPED)
        self.assertTrue(runner.status().quiescent)

    def test_a_concurrent_stop_cannot_enter_the_release_twice(self) -> None:
        entered = threading.Event()
        release_now = self.activity.watch(threading.Event())
        reservation = _BlockingReleaseReservation(self.activity, entered, release_now)
        runner = self.make_rig(reservation=reservation)
        self.assertTrue(runner.prepare())

        results: list = []
        worker = self.activity.start(lambda: results.append(runner.stop()), label="owned-release")
        self.activity.await_event(entered, "release-entered")

        self.assertFalse(runner.stop(), "a stop must refuse while the release is in flight")

        release_now.set()
        self.join_owned(worker)

        self.assertEqual(results, [True])
        self.assertEqual(reservation.entries, 1)
        self.assertEqual(reservation.peak, 1)
        self.assertEqual(reservation.blocked, [True])
        self.assertEqual(runner.status().phase, PHASE_STOPPED)
        self.assertTrue(runner.status().quiescent)

    def test_stop_of_a_prepared_runner_releases_exactly_once(self) -> None:
        reservation = _FakeReservation()
        runner = self.make_rig(reservation=reservation)
        self.assertTrue(runner.prepare())

        self.assertTrue(runner.stop())
        self.assertTrue(runner.stop())
        self.assertEqual(len(reservation.acquires), 1)
        self.assertEqual(len(reservation.releases), 1)
        self.assertIs(reservation.releases[0].owner, reservation.acquires[0][1])
        self.assertEqual(runner.status().phase, PHASE_STOPPED)

    def test_an_unconfirmed_release_retains_the_handle_and_retries(self) -> None:
        reservation = _FakeReservation()
        reservation.script = [("ok", False), ("ok", True)]
        runner = self.make_rig(reservation=reservation)
        self.assertTrue(runner.prepare())

        self.assertFalse(runner.stop())
        self.assertEqual(runner.status().phase, PHASE_STOPPING)
        self.assertEqual(len(reservation.releases), 1)

        self.assertTrue(runner.stop())
        self.assertEqual(len(reservation.releases), 2)
        self.assertIs(reservation.releases[0], reservation.releases[1])
        self.assertEqual(runner.status().phase, PHASE_STOPPED)

    def test_a_raising_release_retains_the_handle_and_retries(self) -> None:
        reservation = _FakeReservation()
        reservation.script = [("raise", RuntimeError(CANARY))]
        runner = self.make_rig(reservation=reservation)
        self.assertTrue(runner.prepare())

        self.assertFalse(runner.stop())
        self.assertNotIn(CANARY, repr(runner.status()))
        self.assertEqual(runner.status().phase, PHASE_STOPPING)
        self.assertTrue(runner.stop())
        self.assertEqual(runner.status().phase, PHASE_STOPPED)

    def test_stop_from_the_owning_thread_never_joins_itself(self) -> None:
        helper = ChannelARunnerPollingTest._echo_handler()
        observations: list = []
        runner_ref: list = []

        def consumer(outcome):
            observations.append(runner_ref[0].stop())

        transport = _FakeTransport(batches=[({"update_id": 1},)])
        runner = self.make_rig(transport=transport, handler=helper, on_outcome=consumer)
        runner_ref.append(runner)
        self.assertTrue(runner.prepare())

        results: list = []
        worker = self.activity.start(lambda: results.append(runner.run()), label="owned-run")
        self.join_owned(worker)

        self.assertEqual(observations, [False])
        self.assertEqual(results[0].disposition, DISPOSITION_STOPPED)
        self.assertEqual([item.update_id for item in results[0].outcomes], [1])
        self.assertTrue(runner.stop())

    def test_run_blocks_until_stop_and_settles_quiescent(self) -> None:
        entered = threading.Event()
        transport = _FakeTransport()
        transport.on_get_updates = lambda offset: entered.set()
        runner = self.make_rig(transport=transport)
        self.assertTrue(runner.prepare())

        results: list = []
        worker = self.activity.start(lambda: results.append(runner.run()), label="owned-run")
        self.activity.await_event(entered, "run-entered")

        self.assertFalse(runner.stop())
        self.join_owned(worker)
        self.assertEqual(results[0].disposition, DISPOSITION_STOPPED)
        self.assertTrue(runner.stop())
        status = runner.status()
        self.assertEqual(status.phase, PHASE_STOPPED)
        self.assertTrue(status.quiescent)

    def test_managed_start_launches_one_loop_and_refuses_a_duplicate(self) -> None:
        entered = threading.Event()
        transport = _FakeTransport()
        transport.on_get_updates = lambda offset: entered.set()
        runner = self.make_rig(transport=transport)
        self.assertTrue(runner.prepare())

        self.assertTrue(self.launch(runner))
        self.activity.await_event(entered, "managed-entered")
        self.assert_start_refused(runner)
        # Idempotent after success: the incumbent activity is not mutated.
        self.assertTrue(runner.prepare())
        self.assertEqual(runner.poll_once().disposition, DISPOSITION_BUSY)
        self.assertTrue(runner.stop())
        self.assertEqual(runner.status().phase, PHASE_STOPPED)

    def test_start_refuses_before_preparation_or_after_stop(self) -> None:
        unprepared = self.make_rig()
        self.assert_start_refused(unprepared)

        stopped = self.make_rig()
        self.assertTrue(stopped.prepare())
        self.assertTrue(stopped.stop())
        self.assert_start_refused(stopped)

    def test_a_launch_failure_settles_without_leaking_ownership(self) -> None:
        reservation = _FakeReservation()
        runner = self.make_rig(reservation=reservation)
        self.assertTrue(runner.prepare())
        self.capture.fail_next_start()

        # The failed launch is a managed path too, so its terminal outcome is
        # declared before the start and validated with the same post-join check.
        self.assertFalse(
            self.launch(runner, expect_failure=PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
        )

        captured = self.capture.captured_threads()
        self.assertEqual(
            len(captured), 1, "the failed launch must still build exactly one managed thread"
        )
        thread = self.capture.last_thread()
        self.assertEqual(thread.name, MANAGED_THREAD_NAME)
        self.assertIn(
            thread, self.activity.owned_threads(), "a failed launch must not leak ownership"
        )
        self.assertIsNone(thread.ident, "a thread whose start raised never ran")
        self.assertFalse(thread.is_alive())

        status = runner.status()
        self.assertEqual(status.phase, PHASE_FAILED)
        self.assertTrue(status.quiescent)
        self.assertNotIn(CANARY, repr(status))
        self.assertTrue(runner.stop())
        self.assertEqual(len(reservation.releases), 1)

    def test_a_handler_error_beyond_exception_is_sanitized_and_declared(self) -> None:
        # The *handler* raises a ``BaseException``, so the lifecycle's own
        # ``except Exception`` cannot sanitize it: only the managed boundary can.
        # It is therefore declared as a terminal failure instead of staying
        # silent, and nothing from it may reach a public surface.
        def handler(update):
            raise _Escaped("escaped-handler-internal")

        transport = _FakeTransport(batches=[({"update_id": 4},)])
        runner = self.make_rig(transport=transport, handler=handler)
        self.assertTrue(runner.prepare())

        self.assertTrue(
            self.launch(runner, expect_failure=PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
        )
        self.join_owned(self.capture.last_thread())

        status = runner.status()
        self.assertEqual(status.phase, PHASE_FAILED)
        self.assertEqual(status.reason, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
        self.assertNotIn("escaped-handler-internal", repr(status))
        self.assertEqual(self.received, [])

    def test_a_consumer_error_beyond_exception_is_sanitized_and_declared(self) -> None:
        # The handler is valid and the *consumer* raises a ``BaseException``, so
        # only the managed boundary can normalize it. Every observation is recorded
        # inside the callback and asserted on the test thread after the join: an
        # assertion raised inside the callback could be swallowed by production and
        # a swallowed failure would falsely satisfy the expected terminal FAILED.
        reservation = _FakeReservation()
        transport = _FakeTransport(batches=[({"update_id": 4},)])
        produced: list = []

        def handler(update):
            outcome = _outcome(int(update["update_id"]))
            produced.append(outcome)
            return outcome

        observed: list = []

        def hostile_consumer(outcome):
            # The intentional exception is raised only after the observations, so
            # the record survives whatever production does with the callback.
            observed.append(
                {
                    "outcome": outcome,
                    "acquires": len(reservation.acquires),
                    "releases": len(reservation.releases),
                }
            )
            raise _Escaped("escaped-consumer-internal")

        runner = self.make_rig(
            transport=transport,
            reservation=reservation,
            handler=handler,
            on_outcome=hostile_consumer,
        )
        self.assertTrue(runner.prepare())

        self.assertTrue(
            self.launch(runner, expect_failure=PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
        )
        self.join_owned(self.capture.last_thread())

        self.assertEqual(len(observed), 1, "the consumer must be invoked exactly once")
        self.assertIs(observed[0]["outcome"], produced[0], "the identity must be preserved")
        self.assertEqual(observed[0]["outcome"].update_id, 4)
        self.assertEqual(observed[0]["acquires"], 1)
        self.assertEqual(
            observed[0]["releases"], 0, "the lease must still be owned during the callback"
        )

        status = runner.status()
        self.assertEqual(status.phase, PHASE_FAILED)
        self.assertEqual(status.reason, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)
        self.assertNotIn("escaped-consumer-internal", repr(status))
        self.assertTrue(status.quiescent)
        self.assertEqual(len(reservation.releases), 1, "the lease is released exactly once")
        # The intentional exception is accounted at the managed boundary only: it
        # is neither recorded as an incidental callback error nor re-thrown.
        timeouts, errors = self.activity.outcomes()
        self.assertEqual((timeouts, errors), ([], []))
        self.assertEqual(self.capture.escaped_errors(), [])

    def test_a_failed_runner_cannot_reactivate(self) -> None:
        transport = _FakeTransport()
        transport.get_updates_error = RuntimeError(CANARY)
        runner = self.make_rig(transport=transport)
        self.assertTrue(runner.prepare())
        self.assertEqual(runner.poll_once().disposition, DISPOSITION_FAILED)
        attempts = len(transport.get_updates_calls)

        self.assertFalse(runner.prepare())
        self.assert_start_refused(runner)
        self.assertEqual(runner.run().disposition, DISPOSITION_FAILED)
        self.assertEqual(runner.poll_once().disposition, DISPOSITION_FAILED)
        self.assertEqual(len(transport.get_updates_calls), attempts)
        self.assertTrue(runner.stop())

    def test_finalization_after_failure_is_idempotent_and_never_releases_twice(self) -> None:
        reservation = _FakeReservation()
        transport = _FakeTransport()
        transport.get_updates_error = RuntimeError(CANARY)
        runner = self.make_rig(transport=transport, reservation=reservation)
        self.assertTrue(runner.prepare())
        runner.poll_once()

        self.assertTrue(runner.stop())
        self.assertTrue(runner.stop())
        self.assertEqual(len(reservation.releases), 1)
        self.assertEqual(runner.status().phase, PHASE_FAILED)
        self.assertEqual(runner.status().reason, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)


# -- sanitizer canaries ----------------------------------------------------


class ChannelARunnerSanitizerTest(ChannelARunnerCase):
    def _failure_codes(self) -> list:
        codes: list = []

        transport = _FakeTransport()
        transport.get_me_error = RuntimeError(CANARY)
        runner = self.make_rig(transport=transport)
        try:
            runner.prepare()
        except ChannelALifecycleError as error:
            codes.append(error.args)

        reservation = _FakeReservation()
        reservation.acquire_error = BotIdentityReservationError()
        conflict = self.make_rig(reservation=reservation)
        try:
            conflict.prepare()
        except ChannelALifecycleError as error:
            codes.append(error.args)

        # A dependency that raises our own error class with its own argument must
        # not be able to choose the published code.
        hostile = self.make_rig(
            transport=_FakeTransport(
                identity=_HostileIdentity.build(ChannelALifecycleError(CANARY))
            )
        )
        try:
            hostile.prepare()
        except ChannelALifecycleError as error:
            codes.append(error.args)

        return codes

    def test_every_failure_message_is_a_fixed_closed_code(self) -> None:
        for code in self._failure_codes():
            self.assertEqual(len(code), 1)
            self.assertIn(
                code[0],
                (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE, TELEGRAM_BOT_IDENTITY_RESERVED),
            )

    def test_status_reason_is_always_a_closed_code(self) -> None:
        closing = self.make_rig()
        self.assertIsNone(closing.status().reason)

        failing = _FakeTransport()
        failing.get_me_error = RuntimeError(CANARY)
        runner = self.make_rig(transport=failing)
        try:
            runner.prepare()
        except ChannelALifecycleError:
            pass
        self.assertEqual(runner.status().reason, PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE)

    def test_status_and_result_reprs_never_carry_injected_authority(self) -> None:
        reservation = _FakeReservation()
        runner = self.make_rig(reservation=reservation)
        self.assertTrue(runner.prepare())
        rendered = repr(runner.status()) + repr(ChannelAPollResult())
        self.assertNotIn(CANARY, rendered)
        self.assertNotIn("owner=", rendered)
        self.assertNotIn("epoch=", rendered)
        self.assertTrue(runner.stop())

    def test_horizon_constants_are_the_documented_week(self) -> None:
        self.assertEqual(SEVEN_DAY_HORIZON_SECONDS, 7 * 24 * 60 * 60)
        from prisma_runtime.channel_a_lifecycle import MAX_LIFECYCLE_WAIT_SECONDS

        self.assertEqual(MAX_LIFECYCLE_WAIT_SECONDS, SEVEN_DAY_HORIZON_SECONDS)

    def test_generated_activation_objects_are_distinct_per_runner(self) -> None:
        first = _FakeReservation()
        second = _FakeReservation()
        runner_a = self.make_rig(reservation=first)
        runner_b = self.make_rig(reservation=second)
        self.assertTrue(runner_a.prepare())
        self.assertTrue(runner_b.prepare())
        self.assertIsNot(first.acquires[0][1], second.acquires[0][1])
        self.assertIsNot(first.acquires[0][2], second.acquires[0][2])


# -- fresh activation ownership --------------------------------------------


class ChannelARunnerFreshnessTest(ChannelARunnerCase):
    def _fresh_activation(self, transport, clock, *, handler=None):
        """A factory that builds a NEW dialogue over a NEW EMPTY registry."""
        created: list = []

        def factory():
            registry = _make_registry(clock)
            dialogue = _make_dialogue(transport, clock, registry=registry, handler=handler)
            created.append((dialogue, registry))
            return dialogue

        return factory, created

    def test_each_activation_gets_a_new_dialogue_and_an_empty_registry(self) -> None:
        clock = _FakeClock()
        transport = _FakeTransport()
        factory, created = self._fresh_activation(transport, clock)

        first = self.make_rig(transport=transport, clock=clock, factory=factory)
        self.assertTrue(first.prepare())
        _, registry_a = created[0]

        owner = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
        phone = "tg:424242"
        challenge = registry_a.issue_qr(owner)
        ticket, _ = registry_a.claim_qr(challenge.token, phone)
        self.assertIsNotNone(registry_a.confirm(ticket, phone))
        self.assertIsNotNone(registry_a.phone_link(phone))
        self.assertTrue(first.stop())

        second = self.make_rig(transport=transport, clock=clock, factory=factory)
        self.assertTrue(second.prepare())
        dialogue_b, registry_b = created[1]

        self.assertIsNot(registry_b, registry_a)
        self.assertIsNot(dialogue_b, created[0][0])
        self.assertIsNone(registry_b.phone_link(phone))
        self.assertIsNone(registry_b.owner_link(owner))
        self.assertTrue(second.stop())

    def test_real_fresh_factories_survive_a_full_prepare_and_poll(self) -> None:
        clock = _FakeClock()
        transport = _FakeTransport(
            batches=[({"update_id": 1, "message": {"text": "hola"}},)]
        )
        factory, created = self._fresh_activation(transport, clock)
        runner = self.make_rig(transport=transport, clock=clock, factory=factory)
        self.assertTrue(runner.prepare())

        result = runner.poll_once()
        self.assertEqual(result.disposition, DISPOSITION_COMPLETED)
        self.assertEqual(len(result.outcomes), 1)
        self.assertEqual(result.outcomes[0].update_id, 1)
        self.assertIsNone(result.outcomes[0].answer_envelope)
        self.assertEqual(len(created), 1)

    def test_a_failed_dialogue_validation_releases_the_new_reservation(self) -> None:
        clock = _FakeClock()
        transport = _FakeTransport()
        reservation = _FakeReservation()
        foreign = _make_dialogue(_FakeTransport(), clock)
        factory, created = self._fresh_activation(transport, clock)

        def biased_factory():
            created.append((foreign, foreign.registry))
            return foreign

        runner = self.make_rig(
            transport=transport, clock=clock, reservation=reservation, factory=biased_factory
        )
        with self.assertRaises(ChannelALifecycleError):
            runner.prepare()
        self.assertEqual(len(reservation.releases), 1)
        self.assertEqual(created, [(foreign, foreign.registry)])


# -- RCA-5c residual findings: test-only regressions ------------------------
#
# This block adds real regression tests for the three residual source findings
# named by the independent verifier and bounded deterministic proofs for two
# frozen-contract coverage gaps. Only this test module is touched: the production
# module and its already accepted 90-case harness are unchanged. Every double
# here delegates the real method under test and returns its exact result; the
# instrumentation only bounds *when* a real stop or a real settlement runs, so a
# defect is surfaced by an assertion instead of being described in prose.


class _StopDuringEntryRunner(ChannelARunner):
    """Delegating runner that lands one real cross-thread stop on the entry seam.

    ``_retirement_reached`` is an internal scheduling seam used as test
    instrumentation: it runs *after* the per-entry clock fence check and *before*
    the cursor is reserved, which is exactly the interleaving the residual HIGH
    finding describes. Every call still delegates to the real method and returns
    its exact value. The stop fires once, on the first per-entry call that already
    observes a completed prefix (``self._cursor`` reserved by a prior entry), so a
    non-empty prefix is preserved instead of an empty one.

    The harness reference is stored as ``_test_activity`` on purpose: production
    ``self._activity`` is the integer owned-activity counter and must stay intact.
    """

    def __init__(self, *args, test_activity=None, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._test_activity = test_activity
        self.retirement_calls = 0
        self.fired_at_call: int | None = None
        self.stop_results: list = []
        self.stop_threads: list = []
        self.stop_thread_alive: list = []

    def _retirement_reached(self, sample):
        reason = super()._retirement_reached(sample)
        self.retirement_calls += 1
        with self._lock:
            prefix_reserved = self._cursor is not None
        if self.fired_at_call is None and prefix_reserved:
            self.fired_at_call = self.retirement_calls
            # An owned helper so a raising stop is recorded externally and the
            # thread is joined again by teardown instead of escaping ownership.
            helper = self._test_activity.start(
                lambda: self.stop_results.append(self.stop()),
                label="owned-cross-thread-stop",
            )
            # Never silently ignore the bounded join: its completion is recorded
            # and asserted externally, never inside a production catch.
            helper.join(_FAKE_BARRIER_TIMEOUT_SECONDS)
            self.stop_threads.append(helper)
            self.stop_thread_alive.append(helper.is_alive())
        return reason


class _GatedReleaseReservation(_FakeReservation):
    """Release seam whose first confirmation blocks until the test opens a gate."""

    def __init__(self, test_activity, entered, release_gate) -> None:
        super().__init__()
        self._test_activity = test_activity
        self._entered = entered
        self._release_gate = release_gate
        self.entries = 0

    def release(self, lease):
        self.entries += 1
        if self.entries == 1:
            self._entered.set()
            # A bounded fake-barrier wait: a timeout is recorded externally and
            # requests cancellation instead of hanging the release.
            self._test_activity.await_event(self._release_gate, "gated-release")
        return super().release(lease)


class _DelayedRefusalRunner(ChannelARunner):
    """Delegating runner whose refused settlement pauses before the refusal branch.

    Only the *refused* ``_release_attempt`` path is instrumented, and it is
    single-shot: the real implementation still runs and its exact result is
    returned, while one bound gate holds the caller between the refused attempt
    and the lock inside ``_settle``'s refusal branch.
    """

    def __init__(self, *args, test_activity=None, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        # ``_test_activity`` is deliberately collision-free: production
        # ``self._activity`` is the integer owned-activity counter and is left
        # untouched.
        self._test_activity = test_activity
        self.refusal_paused = threading.Event()
        self.resume_refusal = threading.Event()
        self._refusals_to_delay = 1

    def _release_attempt(self) -> bool:
        confirmed = super()._release_attempt()
        if not confirmed and self._refusals_to_delay > 0:
            self._refusals_to_delay -= 1
            self.refusal_paused.set()
            self._test_activity.await_event(self.resume_refusal, "second-stop-refused")
        return confirmed


class ChannelARunnerResidualRegressionTest(ChannelARunnerCase):
    """Residual source findings: these three are expected RED before the fix.

    Each test drives the *actual* production method with bounded, delegating
    instrumentation and asserts the frozen contract, so the current defective
    behavior fails an assertion instead of being merely described.
    """

    def _build_runner(
        self, runner_class, *, transport, clock, reservation, factory, **overrides
    ):
        options = dict(
            transport=transport,
            dialogue_factory=factory,
            clock=clock,
            poll_timeout=1,
            read_timeout=2.0,
            join_timeout=2.0,
            poll_pause=0.01,
            on_outcome=self.received.append,
        )
        options.update(overrides)
        return runner_class(reservation=reservation, test_activity=self.activity, **options)

    def test_a_cross_thread_stop_before_cursor_admission_preserves_the_prefix(self) -> None:
        """HIGH: a stop after the last entry fence must precede cursor admission.

        ``_retirement_reached`` runs after the per-entry clock fence check and
        before ``self._cursor = value + 1``, so a real cross-thread stop fired
        there has already set the sticky fence when the batch loop resumes. The
        batch carries two ordered updates: the first completes normally and the
        stop lands on the *second* entry's pre-admission seam. The frozen contract
        requires that stop to be honored before the second cursor is reserved and
        before the second handler runs, preserving the completed prefix exactly
        once; the current code reserves the second identifier and dispatches
        anyway, which is the genuine RED.
        """
        clock = _FakeClock()
        transport = _FakeTransport(batches=[({"update_id": 5}, {"update_id": 9})])
        handled: list = []

        def handler(entry):
            handled.append(entry["update_id"])
            return _outcome(entry["update_id"])

        dialogue = _make_dialogue(transport, clock, handler=handler)
        runner = self._build_runner(
            _StopDuringEntryRunner,
            transport=transport,
            clock=clock,
            reservation=_FakeReservation(),
            factory=lambda: dialogue,
        )
        self.activity.register_canceller(runner.stop)
        self.assertTrue(runner.prepare())

        result = runner.poll_once()

        # The stop must land on the second entry's seam: the first post-poll call
        # and the first entry's call both observe an empty cursor.
        self.assertEqual(runner.fired_at_call, 3)
        self.assertEqual(runner.retirement_calls, 3)
        self.assertEqual(runner.stop_results, [False])
        self.assertEqual(runner.stop_thread_alive, [False])
        for helper in runner.stop_threads:
            self.assertFalse(helper.is_alive(), "the cross-thread stop helper must be joined")

        self.assertEqual(result.disposition, DISPOSITION_STOPPED)
        self.assertEqual([item.update_id for item in result.outcomes], [5])
        self.assertEqual(handled, [5], "the fenced second entry must never run the handler")
        self.assertEqual([item.update_id for item in self.received], [5])
        self.assertEqual(runner._cursor, 6, "the completed prefix keeps the first cursor")
        self.assertEqual(runner.status().phase, PHASE_STOPPED)

    def test_a_refused_settlement_never_overwrites_a_confirmed_stop_phase(self) -> None:
        """MEDIUM: a refused settle must not clobber a phase another caller closed.

        The first caller owns the single in-flight release and finalizes STOPPED;
        the second caller observed a refused release and pauses before the refusal
        branch's lock. When it resumes, the current code overwrites the terminal
        STOPPED phase with STOPPING, which is the genuine RED. Both callers run on
        owned threads and the second pause is a one-shot bound gate, so the
        interleaving is deterministic and no teardown ever waits recursively.
        """
        clock = _FakeClock()
        transport = _FakeTransport()
        entered = threading.Event()
        release_gate = self.activity.watch(threading.Event())
        reservation = _GatedReleaseReservation(self.activity, entered, release_gate)
        dialogue = _make_dialogue(transport, clock)
        runner = self._build_runner(
            _DelayedRefusalRunner,
            transport=transport,
            clock=clock,
            reservation=reservation,
            factory=lambda: dialogue,
        )
        self.activity.watch(runner.resume_refusal)

        def cancel():
            # Open both gates before the stop, so a run that failed before the
            # body reached them can never leave a caller paused on a gate.
            runner.resume_refusal.set()
            release_gate.set()
            return runner.stop()

        self.activity.register_canceller(cancel)
        self.assertTrue(runner.prepare())

        first: list = []
        second: list = []
        first_thread = self.activity.start(
            lambda: first.append(runner.stop()), label="owned-first-stop"
        )
        self.activity.await_event(entered, "first-stop-entered-release")

        second_thread = self.activity.start(
            lambda: second.append(runner.stop()), label="owned-second-stop"
        )
        self.activity.await_event(runner.refusal_paused, "second-stop-refused")

        release_gate.set()
        self.join_owned(first_thread)
        self.assertEqual(first, [True], "the in-flight release must confirm and finalize")

        runner.resume_refusal.set()
        self.join_owned(second_thread)
        self.assertEqual(len(second), 1)

        status = runner.status()
        self.assertEqual(status.phase, PHASE_STOPPED)
        self.assertIsNone(status.reason)
        self.assertTrue(status.quiescent)
        self.assertEqual(len(reservation.releases), 1)
        # A settled runner stays confirmed and idempotent on any later stop, and
        # that later stop never releases the lease a second time.
        self.assertTrue(runner.stop())
        self.assertEqual(runner.status().phase, PHASE_STOPPED)
        self.assertEqual(len(reservation.releases), 1)

    def test_constructor_rejects_a_huge_poll_timeout_with_the_canonical_code(self) -> None:
        """MEDIUM: an unconvertible exact-int poll timeout must fail canonically.

        ``poll_timeout = 10 ** 1000`` is an exact nonnegative ``int``, so it passes
        ``_validated_poll_timeout``; the unguarded ``float(poll_timeout)`` inside
        ``_validated_read_timeout`` then raises a raw ``OverflowError``. The frozen
        contract requires the canonical sanitized code and no transport I/O; the
        raw overflow escaping the constructor is the genuine RED.
        """
        transport = _FakeTransport()

        with self.assertRaises(ChannelALifecycleError) as caught:
            self.make_rig(transport=transport, poll_timeout=10 ** 1000, read_timeout=2.0)

        self.assertEqual(caught.exception.args, (PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE,))
        self.assertEqual(transport.get_me_calls, 0, "a rejected budget must never dispatch")
        self.assertEqual(transport.get_updates_calls, [])


class ChannelARunnerFrozenCoverageProofTest(ChannelARunnerCase):
    """Bounded deterministic proofs for two frozen-contract coverage gaps.

    Both drive the real managed path and are expected to already PASS: the
    residual report did not name them as defects, and no RED is invented here.
    """

    def test_a_managed_stop_before_the_loop_enters_still_settles_without_leaking(self) -> None:
        """A stop before the managed loop's first instruction settles deterministically.

        The gated wrapper delegates the real ``_run_entry`` and blocks it on the
        runner's own pause signal, which only ``stop`` sets. The managed thread is
        therefore launched but has not entered the loop when ``stop`` runs, and the
        stop releases it, joins it and settles without leaking ownership.
        """
        recorded = {"entry_calls": 0, "gate_observed": None}
        wrapper_entered = self.activity.watch(threading.Event())
        transport = _FakeTransport()
        reservation = _FakeReservation()
        runner = self.make_rig(transport=transport, reservation=reservation)
        self.assertTrue(runner.prepare())
        # Register the real pause event before launch so teardown can always
        # release it even if the canceller fails, and so the wait is observable.
        self.activity.watch(runner._pause_event)

        original_entry = runner._run_entry

        def gated_entry(token):
            wrapper_entered.set()
            # Released only by ``stop`` through the real pause event, so the
            # interleaving is bounded and deterministic instead of timing-based.
            # The bounded wait is recorded externally and the real entry always
            # runs, so a timeout can never orphan the owned admission.
            recorded["gate_observed"] = self.activity.await_event(
                runner._pause_event, "managed-entry-gate"
            )
            recorded["entry_calls"] += 1
            return original_entry(token)

        runner._run_entry = gated_entry

        self.assertTrue(self.launch(runner))
        self.activity.await_event(wrapper_entered, "managed-entry-wrapper-gated")
        self.assertEqual(recorded["entry_calls"], 0, "the real entry must not have run yet")
        self.assertFalse(runner.status().quiescent)

        self.assertTrue(runner.stop())
        self.join_owned(self.capture.last_thread())

        self.assertIs(recorded["gate_observed"], True, "the bounded gate wait must be observed")
        self.assertEqual(recorded["entry_calls"], 1, "the loop must still enter exactly once")
        status = runner.status()
        self.assertEqual(status.phase, PHASE_STOPPED)
        self.assertIsNone(status.reason)
        self.assertTrue(status.quiescent)
        self.assertEqual(len(reservation.releases), 1)
        self.assertEqual(transport.get_updates_calls, [], "a stop before entry must never poll")

    def test_a_managed_join_timeout_retains_authority_until_quiescence(self) -> None:
        """A join timeout retains the lease until the worker is confirmed quiet.

        The managed thread is gated before entry on a test-owned event, so the
        bounded join inside ``stop`` deterministically times out. The stop must
        then report ``False``, keep the phase ``STOPPING`` and retain the lease;
        only after the gate is opened and the worker quiesces does a later stop
        report settled and release exactly once.
        """
        recorded = {"entry_calls": 0, "gate_observed": None}
        entry_gate = self.activity.watch(threading.Event())
        entered = self.activity.watch(threading.Event())
        transport = _FakeTransport()
        reservation = _FakeReservation()
        runner = self.make_rig(
            transport=transport, reservation=reservation, join_timeout=0.05
        )
        self.assertTrue(runner.prepare())

        original_entry = runner._run_entry

        def gated_entry(token):
            entered.set()
            # The bounded wait is recorded externally and the real entry always
            # runs, so a timeout can never orphan the owned admission.
            recorded["gate_observed"] = self.activity.await_event(
                entry_gate, "managed-entry-gate"
            )
            recorded["entry_calls"] += 1
            return original_entry(token)

        runner._run_entry = gated_entry

        self.assertTrue(self.launch(runner))
        self.activity.await_event(entered, "managed-entry-entered")

        self.assertFalse(runner.stop(), "a timed-out join must retain authority")
        blocked = runner.status()
        self.assertEqual(blocked.phase, PHASE_STOPPING)
        self.assertFalse(blocked.quiescent)
        self.assertEqual(reservation.releases, [], "the lease is retained until quiescence")

        entry_gate.set()
        self.join_owned(self.capture.last_thread())

        self.assertIs(recorded["gate_observed"], True, "the bounded gate wait must be observed")
        self.assertEqual(recorded["entry_calls"], 1)
        settled = runner.status()
        self.assertEqual(settled.phase, PHASE_STOPPED)
        self.assertTrue(settled.quiescent)
        self.assertEqual(
            len(reservation.releases), 1, "the lease is released only after quiescence"
        )
        self.assertTrue(runner.stop())


if __name__ == "__main__":
    unittest.main()
