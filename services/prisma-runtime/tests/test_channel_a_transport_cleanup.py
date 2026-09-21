"""Cleanup regression tests for the owned workers of the transport test module.

``services/prisma-runtime/tests/test_channel_a_transport.py`` launches real
``threading.Thread`` workers inside ``ConcurrencyTests``. On an early assertion
failure, a failing poll or a failed second launch, the unchanged method returns
before releasing the release event it created or joining a worker it already
started, and a worker failure only ever reaches a thread's stderr. This module
does not edit that behavior: it runs the existing methods exactly as they are
written and observes the defect from the outside.

The instrument is module-local and inert:

* The target module's own ``threading`` binding is replaced by
  ``InertThreadingFacade``, so only ``Event``, ``Barrier`` and ``Thread`` are
  doubled for that one module, for the duration of one test, and the original
  binding is restored unconditionally.
* An inert worker runs its target inline on the test thread, records ownership in
  the facade before any launch attempt, and models a worker as alive from
  ``start()`` until a ``join()`` observes it, because the non-blocking fake waits
  remove the real blocking that kept the worker alive. The state a ``join``
  observes is kept apart from the actual ``is_alive()`` calls: the first is recorded
  as simulated join state, the second as a real liveness observation carrying the
  index and the value it returned. A cooperative release wait is modelled explicitly
  instead of being inferred from a signal state, and the release is never inferred
  from that model or from a simulated join: it is proven by the recorded position of
  the ``Event.set``, which must precede the joins of the workers it unblocks.
* Two nested layers cover each real boundary on the same attribute: an inert floor
  installed first, and a refusing guard installed on top of it.
  ``requests.Session.request`` and ``stdlib_threading.Thread.start`` are each
  covered that way, so a dispatch that bypassed the facade still meets a layer this
  module owns. Neither layer ever reaches the original implementation, and both are
  restored in reverse order with the attempts check run while the layer is still
  installed.
* No instrument callback ever asserts, so an instrument assertion can never be
  swallowed by the expected inner failure. Every oracle is asserted outside the
  nested run, and each nested run is reported through its own result, which records
  every ``addSuccess``, ``addFailure`` and ``addError`` before it delegates to
  ``unittest``. Report ordering is therefore observed where it happened instead of
  being re-synthesised by the harness afterwards.

RED dimensions exercised here: a failed early assertion and a failed poll must
still release the event and join the started worker; a failed second ``start()``
must abort the barrier, join the already-started worker without ever joining the
unstarted one, and surface an attributable unsuccessful report instead of
swallowing it; a worker ``BaseException`` must reach an external outcome channel
instead of only a thread's stderr; and a survivor must surface as a reported
failure only after the joins and after the per-worker liveness observations taken
after those joins. The ``join_clears_alive`` differential pair on the
concurrent-sends method is the instrument-validity control for the survivor
dimension: only that policy differs between the pair, so a survivor that the
unchanged method reports as a clean pass is attributable to its missing post-join
liveness check rather than to the instrument.
"""

from __future__ import annotations

import io
import sys
import threading as stdlib_threading
import unittest

import requests

if __package__:
    from . import test_channel_a_transport as transport_tests
else:
    import test_channel_a_transport as transport_tests

# Fixed, non-disclosing messages. The trailing number is the recorded attempt
# count, so a refusal is both fixed and traceable in a rendered failure.
REQUEST_GUARD_REFUSAL = "PRISMA_CLEANUP_REQUEST_GUARD_REFUSED"
REQUEST_FLOOR_REFUSAL = "PRISMA_CLEANUP_INERT_REQUEST_FLOOR_REACHED"
THREAD_START_GUARD_REFUSAL = "PRISMA_CLEANUP_REAL_THREAD_START_REFUSED"
THREAD_FLOOR_REFUSAL = "PRISMA_CLEANUP_INERT_THREAD_START_FLOOR_REACHED"
# Scripted outcomes injected through the module's own inert session.
INJECTED_START_FAILURE = "PRISMA_CLEANUP_INJECTED_START_FAILURE"
INJECTED_POLL_FAILURE = "PRISMA_CLEANUP_INJECTED_POLL_FAILURE"
INJECTED_WORKER_MARKER = "PRISMA_CLEANUP_INJECTED_WORKER_BASE_EXCEPTION"
INTENTIONAL_NESTED_FAILURE = "PRISMA_CLEANUP_INTENTIONAL_NESTED_FAILURE"

# Fixed production URL suffixes, used to target one scripted session call.
SEND_METHOD_PATH = "/sendMessage"
POLL_METHOD_PATH = "/getUpdates"
# A reserved probe host, used only to keep the probe URL non-routable by
# convention while the harness proof exercises the two owned layers directly. The
# suffix proves nothing about reachability on its own: name resolution and proxies
# can still perform I/O for a reserved name, so the safety of this probe comes from
# the inert floor and the refusing guard that cover ``requests.Session.request``,
# never from the host name.
PROBE_URL = "https://channel-a-probe.invalid/getMe"

# The two existing methods this module runs unchanged.
SEND_AND_POLL_METHOD = "test_concurrent_send_and_poll_hold_owned_sessions_without_a_shared_lock"
CONCURRENT_SENDS_METHOD = "test_concurrent_sends_are_not_serialized_by_a_transport_lock"


class InertWorkerBaseException(BaseException):
    """A worker failure that ``except Exception`` can never normalize."""

    def __init__(self, marker: str = INJECTED_WORKER_MARKER) -> None:
        super().__init__(marker)


def register_restoring_cleanups(case, *, owner, attribute, original, installed, label, attempts, message):
    """Restore one patched attribute, then prove its check, its restore and its identity.

    Registration order is the contract. Cleanups run last-registered-first, so the
    attempts check runs while the layer is still installed, the original binding is
    restored next, and the restored identity is proven last. ``unittest`` records a
    failing check and still runs the remaining cleanups, so restoration stays
    unconditional even when the check fails. The ``cleanup_order`` observations this
    writes are how a caller proves that every check observed its own still-active
    layer and that each layer was restored only after its own check. The failure
    message carries the layer label and its recorded attempt count, so a tripped
    tripwire is attributable to the layer that owns it.
    """
    ledger = getattr(case, "cleanup_order", None)

    def check_attempts():
        if ledger is not None:
            ledger.append(("attempts_checked", label, getattr(owner, attribute) is installed))
        case.assertEqual(
            list(attempts),
            [],
            f"{message} [{label}] attempts={len(attempts)}",
        )

    def restore():
        setattr(owner, attribute, original)
        if ledger is not None:
            ledger.append(("restored", label))

    def prove_restored():
        case.assertIs(getattr(owner, attribute), original, "a test guard was not restored")

    case.addCleanup(prove_restored)
    case.addCleanup(restore)
    case.addCleanup(check_attempts)


def replace_module_attribute(case, *, name, replacement, message):
    """Replace one target-module name for one test, restore it and prove both."""
    original = getattr(transport_tests, name)
    setattr(transport_tests, name, replacement)
    case.addCleanup(lambda: case.assertIs(getattr(transport_tests, name), original, f"{message} and was not restored"))
    case.addCleanup(lambda: setattr(transport_tests, name, original))
    case.addCleanup(lambda: case.assertIs(getattr(transport_tests, name), replacement, message))
    return original


def install_inert_request_floor(case):
    """Install the inert floor on ``requests.Session.request`` itself, first.

    The floor occupies the very attribute the refusal guard is installed on next, so
    it sits directly under the guard and directly above the real implementation. A
    dispatch that bypassed the guard therefore still meets a layer this module owns,
    and it meets it before any session, netrc or proxy-environment read could happen.
    It counts the attempt and raises without ever touching the original. It returns
    its own callable and its ledger so a caller can exercise the floor directly
    without invoking the original request path.
    """
    attempts: list = []
    original = requests.Session.request

    def inert_request(self, method, url, *args, **kwargs):
        attempts.append(1)
        raise RuntimeError(f"{REQUEST_FLOOR_REFUSAL} {len(attempts)}")

    requests.Session.request = inert_request
    register_restoring_cleanups(
        case,
        owner=requests.Session,
        attribute="request",
        original=original,
        installed=inert_request,
        label=REQUEST_FLOOR_REFUSAL,
        attempts=attempts,
        message="the inert request floor must never be reached",
    )
    return inert_request, attempts


def install_request_refusal_guard(case, floor):
    """Refuse every real outbound dispatch on top of the inert request floor.

    ``requests.Session.request`` is the single funnel behind ``get`` and ``post``,
    so one class-level patch covers every verb. The guard is installed on the same
    attribute that already holds ``floor``; when that nesting invariant does not hold
    the install fails loudly instead of silently covering the original. Attempts are
    counted before any inspection and the refusal carries no URL, method, body or
    token detail.
    """
    attempts: list = []
    original = requests.Session.request
    if original is not floor:
        raise AssertionError("the inert request floor was not installed under the refusal guard")

    def refused_request(self, method, url, *args, **kwargs):
        attempts.append(1)
        raise RuntimeError(f"{REQUEST_GUARD_REFUSAL} {len(attempts)}")

    requests.Session.request = refused_request
    register_restoring_cleanups(
        case,
        owner=requests.Session,
        attribute="request",
        original=original,
        installed=refused_request,
        label=REQUEST_GUARD_REFUSAL,
        attempts=attempts,
        message="an unexpected real HTTP dispatch was attempted",
    )
    return attempts


def install_inert_thread_start_floor(case):
    """Install the inert floor on ``stdlib_threading.Thread.start`` itself, first.

    The target module's ``threading`` binding is replaced by the facade, so this
    floor covers the other way a launch could escape: real standard-library use. It
    is imported as ``stdlib_threading`` so it can never be confused with the target
    module's replacement. It counts the attempt and raises without launching
    anything, and it returns its own callable and ledger.
    """
    attempts: list = []
    original = stdlib_threading.Thread.start

    def inert_start(self, *args, **kwargs):
        attempts.append(1)
        raise RuntimeError(f"{THREAD_FLOOR_REFUSAL} {len(attempts)}")

    stdlib_threading.Thread.start = inert_start
    register_restoring_cleanups(
        case,
        owner=stdlib_threading.Thread,
        attribute="start",
        original=original,
        installed=inert_start,
        label=THREAD_FLOOR_REFUSAL,
        attempts=attempts,
        message="the inert thread-start floor must never be reached",
    )
    return inert_start, attempts


def install_real_thread_start_refusal(case, floor):
    """Refuse every real standard-library thread launch on top of the thread floor."""
    attempts: list = []
    original = stdlib_threading.Thread.start
    if original is not floor:
        raise AssertionError("the inert thread-start floor was not installed under the refusal guard")

    def refused_start(self, *args, **kwargs):
        attempts.append(1)
        raise RuntimeError(f"{THREAD_START_GUARD_REFUSAL} {len(attempts)}")

    stdlib_threading.Thread.start = refused_start
    register_restoring_cleanups(
        case,
        owner=stdlib_threading.Thread,
        attribute="start",
        original=original,
        installed=refused_start,
        label=THREAD_START_GUARD_REFUSAL,
        attempts=attempts,
        message="a real thread was launched by the run under test",
    )
    return attempts


class InertEvent:
    """A release event whose ``wait`` never blocks and never asserts.

    Model limitation, stated plainly: because the fake ``wait`` cannot block, it
    cannot observe a real release. ``cooperative_wait`` models "the worker's wait
    completed cooperatively", which is what a non-blocking inline run looks like,
    and it is deliberately distinct from a suppressed handshake, which is the
    early-assertion route and still reports ``False``. The release itself is never
    inferred from that model or from a simulated join: it is proven by the recorded
    position of ``set``, which must precede the joins of the workers it unblocks, and
    by the independent ``set_calls`` ledger. Every ``wait`` also keeps the timeout it
    was given, so a caller can assert the wait stayed bounded.
    """

    def __init__(self, facade: InertThreadingFacade, *, index: int, cooperative_wait: bool = False) -> None:
        self._facade = facade
        self.index = index
        self.cooperative_wait = cooperative_wait
        self.signaled = False
        self.suppress_signal = False
        self.set_calls = 0
        self.wait_calls = 0
        self.wait_timeouts: list = []
        self.wait_results: list = []

    def set(self) -> None:
        """Record the release where it happened, so the release order is observable."""
        self.set_calls += 1
        self.signaled = True
        self._facade.timeline.append(("event_set", self.index))

    def is_set(self) -> bool:
        return self.signaled

    def wait(self, timeout=None) -> bool:
        self.wait_calls += 1
        self.wait_timeouts.append(timeout)
        if self.suppress_signal:
            observed = False
        elif self.cooperative_wait:
            observed = True
        else:
            observed = self.signaled
        self.wait_results.append(observed)
        return observed


class InertBarrier:
    """A rendezvous whose ``wait`` returns immediately with a party index.

    Every ``wait`` keeps the timeout it was given, so a caller can assert that the
    rendezvous stayed bounded instead of trusting an argument this fake discards.
    ``abort`` is recorded with its position, so "a failing method must break the
    rendezvous it can no longer complete, before joining the worker it already
    started" is an external oracle instead of a timing guess.
    """

    def __init__(self, facade: InertThreadingFacade, *, parties: int) -> None:
        self._facade = facade
        self.parties = parties
        self.wait_calls = 0
        self.wait_timeouts: list = []
        self.abort_calls = 0

    def wait(self, timeout=None) -> int:
        self.wait_calls += 1
        self.wait_timeouts.append(timeout)
        return self.wait_calls - 1

    def abort(self) -> None:
        self.abort_calls += 1
        self._facade.timeline.append(("barrier_abort", self.parties))


class InertThread:
    """An owned worker that runs its target inline and never launches a thread.

    Ownership is recorded by the facade in ``Thread`` before ``start`` is ever
    called. ``alive`` stays true from a successful ``start`` until a ``join``
    observes the worker, and ``join`` on a worker that never started is recorded as
    an unstarted join attempt instead of being silently skipped. A join records two
    distinct observations: the join itself, and the simulated state that join left
    behind. A real ``is_alive()`` call is recorded separately, with its own index and
    the value it returned, so a join simulation can never stand in for a liveness
    check the method actually performed. A target failure is recorded the way a
    thread's uncaught-exception hook would report it, and it is never asserted here:
    the oracle belongs outside the nested run.
    """

    def __init__(self, facade, *, index, target, args, kwargs, name, extra) -> None:
        self._facade = facade
        self.index = index
        self._target = target
        self._args = tuple(args or ())
        self._kwargs = dict(kwargs or {})
        self.name = name
        self.extra_kwargs = dict(extra)
        self.started = False
        self.alive = False
        self.start_attempts = 0
        self.start_errors: list = []
        self.join_calls = 0
        self.join_timeouts: list = []
        self.unstarted_join_attempts = 0
        self.liveness_checks = 0
        self.worker_error = None

    @property
    def ident(self):
        """A started worker reports an identity, so an ownership check may consult it."""
        return self.index if self.started else None

    def start(self) -> None:
        self.start_attempts += 1
        self._facade.timeline.append(("thread_start_attempt", self.index))
        failure = self._facade.reserve_start_failure()
        if failure is not None:
            self.start_errors.append(failure)
            raise failure
        self.started = True
        self.alive = True
        try:
            self._target(*self._args, **self._kwargs)
        except BaseException as error:  # noqa: BLE001 - an uncaught thread error reaches its hook
            self.worker_error = error
            self._facade.uncaught_errors.append(error)
            self._facade.timeline.append(("worker_error", self.index, type(error).__name__))

    def join(self, timeout=None) -> None:
        if not self.started:
            self.unstarted_join_attempts += 1
            self._facade.timeline.append(("join_unstarted", self.index))
            return
        self.join_calls += 1
        self.join_timeouts.append(timeout)
        self._facade.timeline.append(("thread_join", self.index))
        if self._facade.join_clears_alive:
            self.alive = False
        self._facade.timeline.append(("join_observed_alive_state", self.index, self.alive))

    def is_alive(self) -> bool:
        """A real liveness call, recorded with its index and the value it returned."""
        self.liveness_checks += 1
        self._facade.timeline.append(("liveness_observed", self.index, self.alive))
        return self.alive


class InertThreadingFacade:
    """The ``threading`` stand-in installed on the target module for one test.

    Every owned primitive is recorded here before it is launched or waited on, and
    ``timeline`` keeps the observation order, so ownership and ordering are asserted
    externally instead of being inferred from sleeps or enumeration. The timeline
    also keeps simulated state apart from actual calls: ``join_observed_alive_state``
    is the state the model held after a join, while ``liveness_observed`` is a real
    ``is_alive()`` call together with the value it returned. No method here ever
    asserts.
    """

    def __init__(self, *, fail_start_index=None, join_clears_alive=True, suppress_event_index=None) -> None:
        self.threads: list = []
        self.events: list = []
        self.barriers: list = []
        self.timeline: list = []
        self.uncaught_errors: list = []
        self.start_attempts = 0
        self._fail_start_index = fail_start_index
        self._join_clears_alive = join_clears_alive
        self._suppress_event_index = suppress_event_index

    def Thread(self, target=None, args=(), kwargs=None, name=None, **extra) -> InertThread:
        thread = InertThread(
            self, index=len(self.threads), target=target, args=args, kwargs=kwargs, name=name, extra=extra
        )
        self.threads.append(thread)
        self.timeline.append(("thread_owned", thread.index))
        return thread

    def Event(self) -> InertEvent:
        """The first event a method creates is its handshake; later ones are releases.

        The methods under test create ``send_entered`` and then ``release_send``, so
        the creation-order rule models the handshake as a plain recorded signal and
        every later event as a cooperative, non-blocking release.
        """
        event = InertEvent(self, index=len(self.events), cooperative_wait=bool(self.events))
        if event.index == self._suppress_event_index:
            event.suppress_signal = True
        self.events.append(event)
        self.timeline.append(("event_created", event.index))
        return event

    def Barrier(self, parties: int) -> InertBarrier:
        barrier = InertBarrier(self, parties=parties)
        self.barriers.append(barrier)
        self.timeline.append(("barrier_created", parties))
        return barrier

    @property
    def join_clears_alive(self) -> bool:
        return self._join_clears_alive

    def reserve_start_failure(self):
        """Return the one scripted launch failure, keyed by the launch attempt count."""
        self.start_attempts += 1
        if self._fail_start_index is None or self.start_attempts != self._fail_start_index:
            return None
        return RuntimeError(f"{INJECTED_START_FAILURE} {self.start_attempts}")

    def unstarted_join_attempts(self) -> int:
        return sum(thread.unstarted_join_attempts for thread in self.threads)


class ScriptedSession:
    """The module's inert session whose ``post`` raises one scripted error.

    Every other attribute is delegated, so the existing assertions keep reading the
    module's own call ledger.
    """

    def __init__(self, factory, session) -> None:
        self._factory = factory
        self._session = session

    def __getattr__(self, name):
        return getattr(self._session, name)

    def post(self, url, **kwargs):
        error = self._factory.scripted_error(url)
        if error is None:
            return self._session.post(url, **kwargs)
        # Mirror the module's inert ordering exactly, then record the injection
        # immediately before it is raised, so the injection is evidenced by its own
        # ledger instead of by whatever the run later reports.
        self._session.calls.append((url, kwargs))
        if self._session.before_post is not None:
            self._session.before_post()
        self._factory.record_injection(url, error)
        raise error

    def close(self) -> None:
        return self._session.close()


class ScriptedSessionFactory:
    """A callable that mirrors the module's ``FakeSession`` while recording what it builds.

    ``FakeSession`` is reached as a module global by the method under test, so
    replacing that global is the only way to script a failure without editing the
    existing behavior. With no scripted outcome it is a thin recording wrapper, and
    its recorded sessions, responses and creation keywords let a caller assert
    completeness externally instead of inferring it from a simulated pass.
    """

    def __init__(self, original, *, url_marker=None, post_error=None) -> None:
        self._original = original
        self._url_marker = url_marker
        self._post_error = post_error
        self.sessions: list = []
        self.responses: list = []
        self.creation_kwargs: list = []
        self.injections: list = []

    def __call__(self, response=None, **kwargs):
        session = self._original(response, **kwargs)
        self.sessions.append(session)
        self.responses.append(response)
        self.creation_kwargs.append(dict(kwargs))
        if self._post_error is None:
            return session
        return ScriptedSession(self, session)

    def scripted_error(self, url):
        if self._url_marker is None or not url.endswith(self._url_marker):
            return None
        return self._post_error

    def record_injection(self, url, error) -> None:
        """Record one injected failure at the instant it is raised."""
        self.injections.append((url, error))


class RecordingTestResult(unittest.TestResult):
    """A nested result that records the actual report before it delegates to ``unittest``.

    Report ordering is part of the evidence: a survivor or a lost worker failure must
    be reported only after the joins and the liveness checks that precede it, and a
    case reported as a pass must be distinguishable from a case reported as a
    failure. Each ``addSuccess``, ``addFailure`` and ``addError`` is therefore
    appended to the run's shared timeline at the moment ``unittest`` reports it, and
    delegated afterwards, so the collected failures and errors keep behaving exactly
    as a plain result would. Nothing here ever asserts.
    """

    def __init__(self, timeline: list) -> None:
        super().__init__(stream=io.StringIO())
        self.timeline = timeline
        self.reports: list = []

    def _record(self, kind: str, test, err) -> None:
        self.reports.append((kind, test, err))
        self.timeline.append(("nested_reported", kind))

    def addSuccess(self, test) -> None:
        self._record("success", test, None)
        super().addSuccess(test)

    def addFailure(self, test, err) -> None:
        self._record("failure", test, err)
        super().addFailure(test, err)

    def addError(self, test, err) -> None:
        self._record("error", test, err)
        super().addError(test, err)


def reported_exceptions(result: RecordingTestResult) -> list:
    """The exception of every unsuccessful outcome the nested run reported.

    The report is the evidence: a diagnostic-category oracle reads the exception
    message recorded with that outcome instead of the rendered traceback text, so an
    unrelated source line or an arbitrary nested failure can never satisfy it. Success
    reports carry no exception and are filtered out, so this returns exactly one
    exception per reported failure or error -- never more. It is not a per-cause
    channel: an implementation that aggregates several independent causes into a single
    reported failure yields one exception, and its message must represent all of them.
    """
    return [err[1] for _, _, err in result.reports if err is not None]


class CleanupHarnessTestCase(unittest.TestCase):
    """Base case: run the real methods with inert owned primitives.

    ``activate`` installs two nested layers on each real boundary first, then the
    target module's ``threading`` replacement. The cleanups registered by each
    install run the attempts check while that layer is still installed, restore it
    next and prove the restored identity last, so every patch is restored even when
    the body fails and each restoration is proven by a separate assertion.
    """

    def activate(self, facade: InertThreadingFacade) -> InertThreadingFacade:
        self.cleanup_order: list = []
        self.request_floor, self.request_floor_attempts = install_inert_request_floor(self)
        self.request_attempts = install_request_refusal_guard(self, self.request_floor)
        self.thread_floor, self.thread_floor_attempts = install_inert_thread_start_floor(self)
        self.real_thread_attempts = install_real_thread_start_refusal(self, self.thread_floor)
        replace_module_attribute(
            self,
            name="threading",
            replacement=facade,
            message="the inert threading facade was not installed",
        )
        return facade

    def install_session_factory(self, *, url_marker=None, post_error=None) -> ScriptedSessionFactory:
        script = ScriptedSessionFactory(transport_tests.FakeSession, url_marker=url_marker, post_error=post_error)
        replace_module_attribute(
            self,
            name="FakeSession",
            replacement=script,
            message="the scripted inert session was not installed",
        )
        return script

    def new_result(self, facade: InertThreadingFacade) -> RecordingTestResult:
        """A nested result that records each report into the run's own timeline.

        The stream is still captured, so a nested run never writes out. Unlike a plain
        result, this one appends an observation at the instant ``unittest`` reports the
        nested case, so report ordering is read from where it happened instead of being
        re-synthesised after the run.
        """
        return RecordingTestResult(facade.timeline)

    def run_owned_method(self, method_name: str, result: unittest.TestResult):
        """Run one real method of the sibling module exactly as it is written today."""
        case = transport_tests.ConcurrencyTests(method_name)
        case.run(result)
        return case

    def recorded_outcomes(self, result: unittest.TestResult) -> str:
        """The rendered text of every nested error and failure, asserted externally."""
        self.assertEqual(result.testsRun, 1, "the nested run must execute exactly one real method")
        return "\n".join(text for _, text in result.errors + result.failures)

    def event_positions(self, facade: InertThreadingFacade, name: str) -> list:
        """The positions of one timeline event name, in observation order."""
        return [position for position, event in enumerate(facade.timeline) if event[0] == name]

    def tagged_positions(self, facade: InertThreadingFacade, tag: str, index: int) -> list:
        """The positions of one timeline event tag for one owned primitive index."""
        return [
            position
            for position, event in enumerate(facade.timeline)
            if event[0] == tag and event[1] == index
        ]

    def reported_kinds(self, result: RecordingTestResult) -> list:
        """The kinds of the outcomes ``unittest`` actually reported for this nested run."""
        return [kind for kind, _, _ in result.reports]

    def assert_unblock_precedes_joins(self, set_positions, join_positions, message: str) -> None:
        """The worker was released before the first join attempt, never joined blind.

        A join is only evidence of a release when the release was already recorded: a
        worker waiting on an event cannot finish while that event is unset, so a method
        that joins first and releases after is still abandoning it.
        """
        self.assertTrue(set_positions, f"{message}: the release must be observed")
        self.assertTrue(join_positions, f"{message}: the join must be observed")
        self.assertLess(min(set_positions), min(join_positions), message)

    def assert_all_observed(self, observations, message: str) -> None:
        """Every recorded non-blocking wait observed the cooperative outcome."""
        self.assertTrue(observations, f"{message}: at least one observation is required")
        self.assertTrue(all(observations), message)

    def assert_bounded(self, timeouts, message: str) -> None:
        """Every recorded wait or join carried a finite, positive, non-boolean bound.

        The exact bound is never asserted, so any positive value stays acceptable. A
        boolean is rejected explicitly because ``True`` would otherwise pass an
        ordering check as the number 1, and the infinities are rejected because an
        unbounded wait is exactly what this instrument must never model.
        """
        self.assertTrue(timeouts, f"{message}: at least one bounded wait must be recorded")
        for timeout in timeouts:
            self.assertNotIsInstance(timeout, bool, message)
            self.assertIsInstance(timeout, (int, float), message)
            self.assertNotEqual(timeout, float("inf"), message)
            self.assertNotEqual(timeout, float("-inf"), message)
            self.assertGreater(timeout, 0, message)

    def assert_facade_contract(self, facade: InertThreadingFacade) -> None:
        """The facade must model every ``threading`` name and keyword the methods use."""
        for thread in facade.threads:
            self.assertEqual(thread.extra_kwargs, {}, "the facade ignored a threading keyword it does not model")
        if facade.events:
            self.assertFalse(
                facade.events[0].cooperative_wait,
                "the first event is the handshake and must stay a plainly recorded signal",
            )
            for event in facade.events[1:]:
                self.assertTrue(
                    event.cooperative_wait,
                    "a release event created after the handshake must model cooperative completion",
                )


class InertCleanupRegressionTests(CleanupHarnessTestCase):
    """External oracles for the unchanged concurrency methods of the sibling module."""

    def test_activation_refuses_real_dispatch_launches_and_restores_every_patch(self):
        """Harness proof: both layers discriminate, never launch and always restore.

        The nested case trips each layer directly, keeps the observed counts as
        immutable evidence and leaves the live ledgers in place, so the protective
        tripwires report their own attributable cleanup failures instead of being
        silenced, and the intentional body failure must not stop the remaining
        restorations from running. The outer assertions prove that a failing body still
        restores both nested patches on each attribute, that each refusal came from the
        layer that owns it, that a tripped layer is reported as a failure rather than an
        error, and that every attempts check observed its own layer still installed
        before restoring it.
        """
        recorded = {}
        before = (requests.Session.request, stdlib_threading.Thread.start)

        class ActivationProbeCase(CleanupHarnessTestCase):
            def runTest(inner):
                facade = inner.activate(InertThreadingFacade())
                recorded["facade"] = facade
                recorded["installed_threading"] = transport_tests.threading
                recorded["installed_request"] = requests.Session.request
                recorded["installed_thread_start"] = stdlib_threading.Thread.start
                recorded["request_floor"] = inner.request_floor
                recorded["thread_floor"] = inner.thread_floor

                # Upper request layer: the guard refuses, and the floor is untouched.
                with inner.assertRaisesRegex(RuntimeError, REQUEST_GUARD_REFUSAL) as upper_request:
                    requests.Session.request(object(), "GET", PROBE_URL)
                recorded["upper_request_error"] = str(upper_request.exception)
                recorded["request_guard_after_upper"] = len(inner.request_attempts)
                recorded["request_floor_after_upper"] = len(inner.request_floor_attempts)

                # Lower request layer: the floor refuses on its own, above nothing.
                with inner.assertRaisesRegex(RuntimeError, REQUEST_FLOOR_REFUSAL) as lower_request:
                    inner.request_floor(object(), "GET", PROBE_URL)
                recorded["lower_request_error"] = str(lower_request.exception)
                recorded["request_guard_after_floor"] = len(inner.request_attempts)
                recorded["request_floor_after_floor"] = len(inner.request_floor_attempts)

                # Upper thread layer: the guard refuses before any real launch.
                probe_thread = stdlib_threading.Thread(target=lambda: None, name="cleanup-probe")
                with inner.assertRaisesRegex(RuntimeError, THREAD_START_GUARD_REFUSAL) as upper_thread:
                    probe_thread.start()
                recorded["upper_thread_error"] = str(upper_thread.exception)
                recorded["thread_guard_after_upper"] = len(inner.real_thread_attempts)
                recorded["thread_floor_after_upper"] = len(inner.thread_floor_attempts)

                # Lower thread layer: the floor refuses without launching anything.
                with inner.assertRaisesRegex(RuntimeError, THREAD_FLOOR_REFUSAL) as lower_thread:
                    inner.thread_floor(probe_thread)
                recorded["lower_thread_error"] = str(lower_thread.exception)
                recorded["thread_guard_after_floor"] = len(inner.real_thread_attempts)
                recorded["thread_floor_after_floor"] = len(inner.thread_floor_attempts)
                recorded["probe_thread_ident"] = probe_thread.ident
                recorded["probe_thread_alive"] = probe_thread.is_alive()

                # The live ledgers are deliberately left in place: each tripped layer
                # reports its own cleanup failure, and the intentional body failure must
                # neither silence that evidence nor stop the remaining restorations.
                raise AssertionError(INTENTIONAL_NESTED_FAILURE)

        probe = ActivationProbeCase()
        result = unittest.TestResult(stream=io.StringIO())
        probe.run(result)

        rendered = "\n".join(text for _, text in result.errors + result.failures)
        failure_texts = [text for _, text in result.failures]
        # The intentional body failure plus one distinct cleanup failure per tripped
        # layer. A failing cleanup is a failure, not an error: AssertionError is the
        # default ``failureException``, so a non-empty error list would mean a real
        # instrument defect and is asserted empty.
        self.assertEqual(result.errors, [], rendered)
        self.assertEqual(len(failure_texts), 5, rendered)
        self.assertEqual(
            len([text for text in failure_texts if INTENTIONAL_NESTED_FAILURE in text]),
            1,
            rendered,
        )
        # Each tripped layer is reported by its own fixed, attributable check, and the
        # remaining cleanups still ran after the first failing one.
        for tripwire in (
            THREAD_START_GUARD_REFUSAL,
            THREAD_FLOOR_REFUSAL,
            REQUEST_GUARD_REFUSAL,
            REQUEST_FLOOR_REFUSAL,
        ):
            matching = [text for text in failure_texts if f"[{tripwire}] attempts=1" in text]
            self.assertEqual(len(matching), 1, f"{tripwire}: {rendered}")
        # Each layer raised its own fixed, traceable refusal on its first attempt.
        self.assertEqual(recorded["upper_request_error"], f"{REQUEST_GUARD_REFUSAL} 1")
        self.assertEqual(recorded["lower_request_error"], f"{REQUEST_FLOOR_REFUSAL} 1")
        self.assertEqual(recorded["upper_thread_error"], f"{THREAD_START_GUARD_REFUSAL} 1")
        self.assertEqual(recorded["lower_thread_error"], f"{THREAD_FLOOR_REFUSAL} 1")
        # The guard refused before the floor, and the floor never went through it.
        self.assertEqual(
            (recorded["request_guard_after_upper"], recorded["request_floor_after_upper"]), (1, 0)
        )
        self.assertEqual(
            (recorded["request_guard_after_floor"], recorded["request_floor_after_floor"]), (1, 1)
        )
        self.assertEqual(
            (recorded["thread_guard_after_upper"], recorded["thread_floor_after_upper"]), (1, 0)
        )
        self.assertEqual(
            (recorded["thread_guard_after_floor"], recorded["thread_floor_after_floor"]), (1, 1)
        )
        # The lower floor refused instead of the original: nothing was launched.
        self.assertIsNone(recorded["probe_thread_ident"])
        self.assertFalse(recorded["probe_thread_alive"])
        # The visible attribute is the guard, and the floor is a distinct layer under it.
        self.assertIsNot(recorded["installed_request"], recorded["request_floor"])
        self.assertIsNot(recorded["installed_thread_start"], recorded["thread_floor"])
        self.assertIsNot(recorded["installed_request"], before[0])
        self.assertIsNot(recorded["installed_thread_start"], before[1])
        self.assertIs(recorded["installed_threading"], recorded["facade"])
        # Every attempts check ran while its own layer was still installed, in the
        # reverse order the layers were installed, and each layer was restored only
        # after its own check had already observed it as active.
        self.assertEqual(
            probe.cleanup_order,
            [
                ("attempts_checked", THREAD_START_GUARD_REFUSAL, True),
                ("restored", THREAD_START_GUARD_REFUSAL),
                ("attempts_checked", THREAD_FLOOR_REFUSAL, True),
                ("restored", THREAD_FLOOR_REFUSAL),
                ("attempts_checked", REQUEST_GUARD_REFUSAL, True),
                ("restored", REQUEST_GUARD_REFUSAL),
                ("attempts_checked", REQUEST_FLOOR_REFUSAL, True),
                ("restored", REQUEST_FLOOR_REFUSAL),
            ],
            "every check must observe its own active layer and restore it before the next check",
        )
        # Every patch is restored, even though the nested body failed.
        self.assertEqual((requests.Session.request, stdlib_threading.Thread.start), before)
        self.assertIs(transport_tests.threading, stdlib_threading)
        # Discovery safety: the sibling's cases are reachable only through its alias.
        self.assertNotIn("ConcurrencyTests", globals())
        self.assertNotIn("ChannelATransportTestCase", globals())
        self.assertIs(transport_tests, sys.modules[transport_tests.__name__])
        self.assertTrue(transport_tests.__name__.endswith("test_channel_a_transport"))

    def test_poll_failure_must_still_release_the_event_and_join_the_started_worker(self):
        """Dimension 1a: a failing poll must not abandon an owned event or worker.

        The poll session is scripted through the module's own inert session, so the
        real method fails on the poll assignment before reaching its release or its
        join. The oracles read the facade ledger, never the nested result.
        """
        facade = self.activate(InertThreadingFacade())
        self.install_session_factory(url_marker=POLL_METHOD_PATH, post_error=RuntimeError(INJECTED_POLL_FAILURE))

        result = self.new_result(facade)
        self.run_owned_method(SEND_AND_POLL_METHOD, result)

        rendered = self.recorded_outcomes(result)
        # The injected poll failure is the one the transport normalized, so the
        # instrument, not the harness, produced the inner failure.
        self.assertIn(transport_tests.PRISMA_CHANNEL_A_TRANSPORT_UNAVAILABLE, rendered)
        self.assert_facade_contract(facade)
        self.assertEqual(len(facade.events), 2, "the method must own exactly the two events it creates")
        send_entered, release_send = facade.events
        self.assertEqual(send_entered.set_calls, 1, "the fake send must have entered post")
        self.assert_all_observed(send_entered.wait_results, "the handshake wait must observe the recorded signal")
        self.assert_bounded(send_entered.wait_timeouts, "the handshake wait must stay bounded")
        self.assert_bounded(release_send.wait_timeouts, "the release wait must stay bounded")
        self.assertEqual(len(facade.threads), 1)
        worker = facade.threads[0]
        self.assertTrue(worker.started)
        # RED oracles: the unchanged method returns on the poll failure without
        # releasing the event it created or joining the worker it started. A count is
        # not enough on its own: the release only counts if it was recorded before the
        # join it exists to unblock, and the join only counts if it stayed bounded.
        self.assertGreaterEqual(release_send.set_calls, 1, "the failing method must still release its event")
        self.assertGreaterEqual(worker.join_calls, 1, "the failing method must still join the started worker")
        self.assert_bounded(worker.join_timeouts, "the join must stay bounded, never unbounded")
        self.assert_unblock_precedes_joins(
            self.tagged_positions(facade, "event_set", release_send.index),
            self.tagged_positions(facade, "thread_join", worker.index),
            "the poll failure must release the event before joining the worker",
        )
        self.assertEqual(facade.unstarted_join_attempts(), 0)
        self.assertEqual(facade.uncaught_errors, [])

    def test_early_handshake_assertion_must_still_release_the_event_and_join_the_worker(self):
        """Dimension 1b: a failed early assertion must not abandon the worker.

        The first event's ``wait`` reports that it never observed the handshake, so
        the real method fails on its own early assertion after it already started its
        worker. The oracles still read the facade ledger only.
        """
        facade = self.activate(InertThreadingFacade(suppress_event_index=0))

        result = self.new_result(facade)
        self.run_owned_method(SEND_AND_POLL_METHOD, result)

        rendered = self.recorded_outcomes(result)
        self.assertIn("the fake send must have entered post", rendered)
        self.assert_facade_contract(facade)
        self.assertEqual(len(facade.events), 2, "the method must own exactly the two events it creates")
        send_entered, release_send = facade.events
        self.assertEqual(send_entered.set_calls, 1, "the fake send did enter post before the assertion")
        self.assertEqual(send_entered.wait_results, [False], "the suppressed handshake must report no observation")
        self.assert_bounded(send_entered.wait_timeouts, "the handshake wait must stay bounded")
        self.assert_bounded(release_send.wait_timeouts, "the release wait must stay bounded")
        self.assertEqual(len(facade.threads), 1)
        worker = facade.threads[0]
        self.assertTrue(worker.started, "the worker was already launched before the failing assertion")
        # RED oracles: the unchanged method abandons the release and the joined worker.
        # The release must be recorded before the join it exists to unblock.
        self.assertGreaterEqual(release_send.set_calls, 1, "the failing method must still release its event")
        self.assertGreaterEqual(worker.join_calls, 1, "the failing method must still join the started worker")
        self.assert_bounded(worker.join_timeouts, "the join must stay bounded, never unbounded")
        self.assert_unblock_precedes_joins(
            self.tagged_positions(facade, "event_set", release_send.index),
            self.tagged_positions(facade, "thread_join", worker.index),
            "the failed early assertion must release the event before joining the worker",
        )
        self.assertEqual(facade.unstarted_join_attempts(), 0)

    def test_second_start_failure_must_abort_the_barrier_and_join_only_the_started_worker(self):
        """Dimension 2: a failed second launch must clean up after the first one.

        The second owned worker fails to launch. The unchanged method leaves the
        ``for worker in workers: worker.start()`` loop on that failure, so the barrier
        is never aborted and the already-started worker is never joined, while the
        unstarted worker must never be joined at all. The failure must nevertheless
        reach the run's own outcome channel, attributed to the injected launch error and
        reported only after that cleanup, instead of being swallowed by a passing case.
        """
        facade = self.activate(InertThreadingFacade(fail_start_index=2))

        result = self.new_result(facade)
        self.run_owned_method(CONCURRENT_SENDS_METHOD, result)

        rendered = self.recorded_outcomes(result)
        self.assert_facade_contract(facade)
        self.assertEqual(len(facade.threads), 2, "both owned workers must be recorded, started or not")
        first, second = facade.threads
        self.assertEqual([first.started, second.started], [True, False])
        self.assertEqual([str(error) for error in second.start_errors], [f"{INJECTED_START_FAILURE} 2"])
        # Every worker is owned before the launch attempt that fails.
        owned_positions = self.event_positions(facade, "thread_owned")
        failed_positions = [
            position for position, event in enumerate(facade.timeline) if event == ("thread_start_attempt", 1)
        ]
        self.assertEqual((len(owned_positions), len(failed_positions)), (2, 1))
        self.assertTrue(
            all(position < failed_positions[0] for position in owned_positions),
            "ownership must be recorded before the launch attempt",
        )
        self.assertEqual(facade.start_attempts, 2)
        self.assertEqual(len(facade.barriers), 1)
        barrier = facade.barriers[0]
        self.assertEqual(barrier.parties, 2)
        self.assertGreaterEqual(barrier.wait_calls, 1, "the started send must attempt the rendezvous")
        self.assert_bounded(barrier.wait_timeouts, "the rendezvous wait must stay bounded")
        # RED oracles: the unchanged method leaks the barrier and the started worker.
        self.assertGreaterEqual(barrier.abort_calls, 1, "the failing method must abort the barrier")
        self.assertGreaterEqual(first.join_calls, 1, "the failing method must join the started worker")
        self.assert_bounded(first.join_timeouts, "the join must stay bounded, never unbounded")
        # Safety invariants: never join an unstarted worker, never launch a real one.
        self.assertEqual(second.join_calls, 0, "the unstarted worker must never be joined")
        self.assertEqual(facade.unstarted_join_attempts(), 0)
        self.assertIsNone(second.worker_error, "a worker that never launched must have no worker error")
        # The cleanup runs before the failure is reported: the incomplete rendezvous is
        # broken first, then the started worker is joined, and only then does the run's
        # own outcome channel carry the injected launch failure.
        abort_positions = self.event_positions(facade, "barrier_abort")
        join_positions = self.event_positions(facade, "thread_join")
        self.assertTrue(abort_positions, "the barrier abort must be observed")
        self.assertTrue(join_positions, "the join of the started worker must be observed")
        self.assertLess(min(abort_positions), min(join_positions), "the barrier must be aborted before the join")
        report_positions = self.event_positions(facade, "nested_reported")
        self.assertEqual(len(report_positions), 1, "exactly one nested outcome must be reported")
        self.assertIn(
            self.reported_kinds(result),
            (["failure"], ["error"]),
            "a failed second launch must be reported as an unsuccessful outcome, never swallowed",
        )
        self.assertFalse(result.wasSuccessful(), "a failed second launch must not be reported as a pass")
        self.assertIn(INJECTED_START_FAILURE, rendered, "the reported outcome must name the injected launch error")
        self.assertLess(
            max(abort_positions + join_positions),
            report_positions[0],
            "the failure must be reported only after the cleanup has run",
        )

    def test_inert_targets_satisfy_the_send_and_poll_method_when_joins_clear_liveness(self):
        """Lever coverage, not a RED dimension: the send-and-poll instrument is faithful.

        The method's own post-join liveness assertion is the lever this control
        exercises, so it proves the inert events, worker and sessions satisfy every
        existing assertion of that method before the other dimensions read its
        ledger. It is the baseline GREEN half of the instrument: the release the method
        performs and the bounded join that follows it are asserted here as already
        satisfied behaviour, not as an unmet cleanup obligation, so this control is not
        one of the RED dimensions.
        """
        facade = self.activate(InertThreadingFacade())
        factory = self.install_session_factory()

        result = self.new_result(facade)
        self.run_owned_method(SEND_AND_POLL_METHOD, result)

        self.assertEqual(self.recorded_outcomes(result), "", "the inert instrument must satisfy the real method")
        self.assertTrue(result.wasSuccessful())
        self.assert_facade_contract(facade)
        self.assertEqual([len(session.calls) for session in factory.sessions], [1, 1])
        self.assertEqual([session.close_calls for session in factory.sessions], [1, 1])
        self.assertEqual(factory.injections, [])
        self.assertEqual(len(facade.events), 2)
        send_entered, release_send = facade.events
        self.assert_all_observed(send_entered.wait_results, "the handshake wait must observe the recorded signal")
        self.assert_all_observed(release_send.wait_results, "the release wait must complete cooperatively")
        self.assert_bounded(
            [timeout for event in facade.events for timeout in event.wait_timeouts],
            "every fake wait must stay bounded",
        )
        self.assertEqual(len(facade.threads), 1)
        worker = facade.threads[0]
        self.assertGreaterEqual(worker.join_calls, 1)
        self.assert_bounded(worker.join_timeouts, "the join must stay bounded, never unbounded")
        # The release is required independently of the cooperative wait model, and it
        # must be recorded before the join it exists to unblock.
        self.assertGreaterEqual(release_send.set_calls, 1, "the method must release the event it created")
        self.assert_unblock_precedes_joins(
            self.tagged_positions(facade, "event_set", release_send.index),
            self.tagged_positions(facade, "thread_join", worker.index),
            "the method must release the worker before it joins it",
        )
        self.assertGreaterEqual(worker.liveness_checks, 1, "the method checks the worker's liveness")
        self.assertFalse(worker.alive, "the post-join liveness assertion must observe a finished worker")
        self.assertEqual(facade.uncaught_errors, [])

    def test_inert_targets_satisfy_the_concurrent_sends_method_when_joins_clear_liveness(self):
        """Dimension 3 control: the concurrent-sends instrument is complete and valid.

        This is the passing half of the differential pair. Only ``join_clears_alive``
        differs from the survivor case below, and with it the unchanged method's every
        own assertion must pass, with results and close counts complete instead of
        empty. That is what makes a survivor failure attributable to the missing
        post-join liveness check rather than to an incomplete instrument.
        """
        facade = self.activate(InertThreadingFacade())
        factory = self.install_session_factory()

        result = self.new_result(facade)
        self.run_owned_method(CONCURRENT_SENDS_METHOD, result)

        self.assertEqual(self.recorded_outcomes(result), "", "the inert instrument must satisfy the real method")
        self.assertTrue(result.wasSuccessful())
        self.assert_facade_contract(facade)
        # Complete results and close counts, asserted independently of the run.
        self.assertEqual([response.json()["result"]["message_id"] for response in factory.responses], [1, 2])
        self.assertEqual([len(session.calls) for session in factory.sessions], [1, 1])
        self.assertEqual([session.close_calls for session in factory.sessions], [1, 1])
        self.assertEqual(len(factory.creation_kwargs), 2)
        self.assertEqual(factory.injections, [])
        # Both owned workers were joined with a bounded timeout and no survivor.
        self.assertTrue(all(thread.join_calls >= 1 for thread in facade.threads), "both workers must be joined")
        self.assert_bounded(
            [timeout for thread in facade.threads for timeout in thread.join_timeouts],
            "every join must stay bounded, never unbounded",
        )
        self.assertEqual([thread.alive for thread in facade.threads], [False, False])
        self.assertGreaterEqual(
            len(self.event_positions(facade, "thread_join")), 2, "both joins must be observed"
        )
        self.assertEqual(len(facade.barriers), 1)
        self.assertEqual([barrier.wait_calls for barrier in facade.barriers], [2])
        self.assert_bounded(
            [timeout for barrier in facade.barriers for timeout in barrier.wait_timeouts],
            "every rendezvous wait must stay bounded",
        )
        self.assertEqual(facade.uncaught_errors, [])

    def test_survivor_after_the_join_surfaces_as_a_failed_inner_case(self):
        """Dimension 3: a survivor is reported only after the joins, as a failed case.

        Only the ``join_clears_alive`` policy differs from the passing control above,
        so both workers finish their joins with identical complete results while the
        instrument keeps reporting them alive. The unchanged method performs no
        post-join liveness check at all, so it reports that survivor as a clean pass;
        a method that joins every worker it started and then checks their liveness must
        instead fail this case. Only the liveness observations the method really made
        are read here: the simulated state a join leaves behind can never stand in for
        them.
        """
        facade = self.activate(InertThreadingFacade(join_clears_alive=False))
        factory = self.install_session_factory()

        result = self.new_result(facade)
        self.run_owned_method(CONCURRENT_SENDS_METHOD, result)

        # Differential evidence first: the pair differs only in the liveness policy,
        # and the results are complete, so a survivor cannot come from empty output.
        self.assert_facade_contract(facade)
        self.assertEqual([response.json()["result"]["message_id"] for response in factory.responses], [1, 2])
        self.assertEqual([len(session.calls) for session in factory.sessions], [1, 1])
        self.assertEqual([session.close_calls for session in factory.sessions], [1, 1])
        self.assertEqual(factory.injections, [])
        self.assertEqual(facade.uncaught_errors, [])
        self.assertTrue(all(thread.join_calls >= 1 for thread in facade.threads), "both workers must be joined")
        self.assert_bounded(
            [timeout for thread in facade.threads for timeout in thread.join_timeouts],
            "every join must stay bounded, never unbounded",
        )
        self.assert_bounded(
            [timeout for barrier in facade.barriers for timeout in barrier.wait_timeouts],
            "every rendezvous wait must stay bounded",
        )
        # Each owned worker must be joined, and the method must take a real liveness
        # observation of it that sees it alive. All the joins must happen before the
        # checks: a check placed before the join is not a post-join check.
        self.assertTrue(facade.threads, "the method must own the workers it launches")
        for thread in facade.threads:
            own_joins = self.tagged_positions(facade, "thread_join", thread.index)
            own_checks = self.tagged_positions(facade, "liveness_observed", thread.index)
            self.assertTrue(thread.started, f"worker {thread.index} must be started")
            self.assertTrue(own_joins, f"worker {thread.index} must be joined")
            self.assertTrue(
                own_checks,
                f"worker {thread.index} must be checked for liveness after its join",
            )
            self.assertTrue(
                all(event[2] for event in facade.timeline if event[0] == "liveness_observed" and event[1] == thread.index),
                f"worker {thread.index} must be observed still alive after its join",
            )
        # The joins and their liveness checks all precede the outcome the run actually
        # reported, and that outcome is the failure a survivor must produce.
        join_positions = self.event_positions(facade, "thread_join")
        liveness_positions = self.event_positions(facade, "liveness_observed")
        report_positions = self.event_positions(facade, "nested_reported")
        self.assertTrue(join_positions, "the joins must be observed")
        self.assertTrue(liveness_positions, "the liveness checks must be observed")
        self.assertLess(
            max(join_positions),
            min(liveness_positions),
            "every owned started-worker join must happen before the post-join liveness checks",
        )
        self.assertEqual(len(report_positions), 1, "exactly one nested outcome must be reported")
        self.assertEqual(
            self.reported_kinds(result),
            ["failure"],
            "a surviving worker must be reported as a failed case, not as a pass or an error",
        )
        self.assertLess(
            max(join_positions + liveness_positions),
            report_positions[0],
            "the survivor must be reported only after the joins and their liveness checks",
        )
        # RED oracle: the unchanged method never checks liveness after its joins, so
        # it reports the surviving workers as a clean pass.
        self.assertFalse(
            result.wasSuccessful(),
            "the unchanged method must report the surviving workers after its joins;"
            f" liveness_checks={[thread.liveness_checks for thread in facade.threads]}"
            f" alive={[thread.alive for thread in facade.threads]}",
        )

    def test_worker_base_exception_must_reach_an_external_outcome_channel(self):
        """Dimension 4: a worker ``BaseException`` must not be lost to thread stderr.

        The send session is scripted to raise a ``BaseException`` after the handshake,
        so the transport's ``except Exception`` can never normalize it. Three separate
        observations are kept apart: the injection ledger, which records the failure at
        the instant it is raised; the facade's uncaught-thread hook, which models where
        a leaked error would otherwise end up; and what the run actually reports after
        its joins. No legacy uncaught behavior is required, so a fix that catches the
        worker failure and reports it is not penalized for it.
        """
        facade = self.activate(InertThreadingFacade())
        injected = InertWorkerBaseException()
        factory = self.install_session_factory(url_marker=SEND_METHOD_PATH, post_error=injected)

        result = self.new_result(facade)
        self.run_owned_method(SEND_AND_POLL_METHOD, result)

        rendered = self.recorded_outcomes(result)
        self.assert_facade_contract(facade)
        # Observation 1: the injection really happened, exactly once, at the raise point.
        self.assertEqual(len(factory.injections), 1, "the scripted failure must be injected exactly once")
        injected_url, injected_error = factory.injections[0]
        self.assertTrue(injected_url.endswith(SEND_METHOD_PATH))
        self.assertIs(injected_error, injected)
        self.assertIn(INJECTED_WORKER_MARKER, str(injected_error))
        # The transport's own cleanup still ran on that path: one session per call,
        # each closed once, each with its single recorded post.
        self.assertEqual(len(factory.sessions), 2)
        self.assertEqual([len(session.calls) for session in factory.sessions], [1, 1])
        self.assertEqual([session.close_calls for session in factory.sessions], [1, 1])
        # Observation 2: the owned worker was released, joined with a bounded wait, and
        # every join and liveness check precedes the outcome the run actually reported.
        # The owned primitives are counted before anything is unpacked or indexed, so a
        # fixture mismatch cannot quietly stand in for the contract under test.
        self.assertEqual(len(facade.events), 2, "the method must own exactly the two events it creates")
        self.assertEqual(len(facade.threads), 1, "the method must own exactly the one worker it launches")
        send_entered, release_send = facade.events
        # Both waits the method already executed are asserted from their own record: a
        # count first, then the bounded timeout each wait carried. The recorded wait
        # outcomes are read as they were observed, never re-derived here.
        self.assertGreaterEqual(send_entered.wait_calls, 1, "the handshake wait must be observed")
        self.assertGreaterEqual(release_send.wait_calls, 1, "the release wait must be observed")
        self.assert_all_observed(send_entered.wait_results, "the handshake wait must observe the recorded signal")
        self.assert_all_observed(release_send.wait_results, "the release wait must complete cooperatively")
        self.assert_bounded(send_entered.wait_timeouts, "the handshake wait must stay bounded")
        self.assert_bounded(release_send.wait_timeouts, "the release wait must stay bounded")
        self.assertEqual(send_entered.set_calls, 1, "the fake send must have entered post")
        worker = facade.threads[0]
        self.assertTrue(worker.started)
        self.assertGreaterEqual(worker.join_calls, 1)
        self.assert_bounded(worker.join_timeouts, "the join must stay bounded, never unbounded")
        self.assert_unblock_precedes_joins(
            self.tagged_positions(facade, "event_set", release_send.index),
            self.tagged_positions(facade, "thread_join", worker.index),
            "the worker must be released before it is joined",
        )
        report_positions = self.event_positions(facade, "nested_reported")
        self.assertEqual(len(report_positions), 1, "exactly one nested outcome must be reported")
        observed_positions = self.event_positions(facade, "thread_join") + self.event_positions(
            facade, "liveness_observed"
        )
        self.assertTrue(observed_positions, "the join and its liveness check must be observed")
        self.assertLess(
            max(observed_positions),
            report_positions[0],
            "the reported outcome must follow the joins and their liveness checks",
        )
        self.assertFalse(result.wasSuccessful(), "a worker failure must not leave the case reported as passing")
        # RED oracle 1: the reported failure must be attributable to the injected
        # worker error, not to an unrelated lookup that merely masks it.
        self.assertIn(
            INJECTED_WORKER_MARKER,
            rendered,
            "the worker failure must reach the test's own outcome channel, not only a thread's stderr",
        )
        # RED oracle 2: the injected failure must not be left to the thread's
        # uncaught-exception hook either, which is where a lost error would surface.
        self.assertEqual(
            facade.uncaught_errors,
            [],
            "the worker failure must be reported to the test instead of escaping to the thread hook",
        )

    def test_poll_failure_must_report_the_surviving_worker_liveness_diagnostic(self):
        """A failed poll must not hide the worker it could not outlive.

        The poll session is scripted to fail while the instrument keeps modelling a
        joined worker as alive, so the method records a post-join liveness observation it
        never validates and then returns on the poll failure. The injection and the alive
        observation are proven first, then the canonical poll error, and only then the
        missing category, so the RED is attributable to that one contract.
        """
        facade = self.activate(InertThreadingFacade(join_clears_alive=False))
        injected = RuntimeError(INJECTED_POLL_FAILURE)
        factory = self.install_session_factory(url_marker=POLL_METHOD_PATH, post_error=injected)

        result = self.new_result(facade)
        self.run_owned_method(SEND_AND_POLL_METHOD, result)

        # Injection first: the scripted poll failure happened exactly once, on the poll
        # method, and the object the transport saw is this very one.
        self.assertEqual(len(factory.injections), 1, "the scripted poll failure must be injected exactly once")
        injected_url, injected_error = factory.injections[0]
        self.assertTrue(injected_url.endswith(POLL_METHOD_PATH))
        self.assertIs(injected_error, injected)
        self.assertEqual([len(session.calls) for session in factory.sessions], [1, 1])
        self.assertEqual([session.close_calls for session in factory.sessions], [1, 1])
        # Then the observations the method really made: the send entered post, the
        # release preceded a bounded join, and that join was followed by a liveness
        # check that saw the worker still alive.
        self.assert_facade_contract(facade)
        self.assertEqual(len(facade.events), 2, "the method must own exactly the two events it creates")
        self.assertEqual(len(facade.threads), 1, "the method must own exactly the one worker it launches")
        send_entered, release_send = facade.events
        worker = facade.threads[0]
        self.assertTrue(worker.started)
        self.assertEqual(send_entered.set_calls, 1, "the fake send must enter post before the poll fails")
        # Both recorded event waits are counted and their outcomes read before any bound is
        # asserted: this case keeps the normal cooperative model, so the handshake observed
        # its signal and the release wait completed. The poll failure stops the body before
        # its mid-flight liveness assertion, so the only liveness call left is the post-join
        # one; that constraint belongs to this error path and is not generalized to the
        # normal control, which takes that mid-flight check as well.
        self.assertEqual(len(send_entered.wait_timeouts), 1, "the handshake wait must be recorded exactly once")
        self.assertEqual(len(release_send.wait_timeouts), 1, "the release wait must be recorded exactly once")
        self.assertEqual(send_entered.wait_results, [True], "the handshake wait must observe the recorded signal")
        self.assertEqual(release_send.wait_results, [True], "the release wait must complete cooperatively")
        self.assert_bounded(send_entered.wait_timeouts, "the handshake wait must stay bounded")
        self.assert_bounded(release_send.wait_timeouts, "the release wait must stay bounded")
        self.assertGreaterEqual(release_send.set_calls, 1, "the failing method must still release its event")
        self.assertGreaterEqual(worker.join_calls, 1, "the failing method must still join the started worker")
        self.assert_bounded(worker.join_timeouts, "the join must stay bounded, never unbounded")
        self.assert_unblock_precedes_joins(
            self.tagged_positions(facade, "event_set", release_send.index),
            self.tagged_positions(facade, "thread_join", worker.index),
            "the poll failure must release the event before joining the worker",
        )
        # The actual post-join liveness observation, kept apart from the join simulation:
        # exactly one is recorded here and it saw the joined worker still alive.
        alive_observations = [
            event[2]
            for event in facade.timeline
            if event[0] == "liveness_observed" and event[1] == worker.index
        ]
        self.assertEqual(alive_observations, [True], "the joined worker must be observed still alive")
        # Counts first, then the ordering they support: every join completes before the
        # actual liveness checks, and both precede the outcome the run really reported.
        join_positions = self.event_positions(facade, "thread_join")
        liveness_positions = self.event_positions(facade, "liveness_observed")
        self.assertEqual(len(join_positions), 1, "the started worker must be joined exactly once")
        self.assertEqual(len(liveness_positions), 1, "the joined worker must be checked for liveness once")
        self.assertLess(
            max(join_positions),
            min(liveness_positions),
            "every join must complete before the actual liveness checks",
        )
        report_positions = self.event_positions(facade, "nested_reported")
        self.assertEqual(len(report_positions), 1, "exactly one nested outcome must be reported")
        self.assertLess(
            max(join_positions + liveness_positions),
            report_positions[0],
            "the reported outcome must follow the joins and their liveness checks",
        )
        # Finally the actual reported message, read from the recorded exception rather
        # than from the rendered traceback.
        messages = [str(error) for error in reported_exceptions(result)]
        self.assertEqual(len(messages), 1, "exactly one nested outcome must be reported")
        self.assertFalse(result.wasSuccessful())
        self.assertIn(
            transport_tests.PRISMA_CHANNEL_A_TRANSPORT_UNAVAILABLE,
            messages[0],
            "the injected poll failure must reach the reported message as the canonical transport error",
        )
        self.assertIn(
            "liveness",
            messages[0],
            "a reported outcome must identify the unsatisfied post-join liveness obligation",
        )

    def test_poll_failure_must_report_the_unsatisfied_release_wait_diagnostic(self):
        """A failed poll must not hide the release wait the method never validated.

        Only the release event's ``wait`` outcome differs from the passing control: the
        handshake still observes its signal while the release wait reports that it never
        completed cooperatively. That deliberately unmet wait is not the normal
        cooperative model, so the instrument is left exactly as it is; what this oracle
        captures is the method's own validation of that wait, which the poll failure
        skips.
        """
        facade = self.activate(InertThreadingFacade(suppress_event_index=1))
        injected = RuntimeError(INJECTED_POLL_FAILURE)
        factory = self.install_session_factory(url_marker=POLL_METHOD_PATH, post_error=injected)

        result = self.new_result(facade)
        self.run_owned_method(SEND_AND_POLL_METHOD, result)

        self.assertEqual(len(factory.injections), 1, "the scripted poll failure must be injected exactly once")
        injected_url, injected_error = factory.injections[0]
        self.assertTrue(injected_url.endswith(POLL_METHOD_PATH))
        self.assertIs(injected_error, injected)
        # The two recorded wait outcomes are kept apart: the handshake observed its
        # signal, while the release wait did not complete cooperatively.
        self.assert_facade_contract(facade)
        self.assertEqual(len(facade.events), 2, "the method must own exactly the two events it creates")
        send_entered, release_send = facade.events
        self.assertEqual(send_entered.wait_results, [True], "the handshake wait must observe the recorded signal")
        self.assertEqual(release_send.wait_results, [False], "the release wait must report its unmet outcome")
        self.assertGreaterEqual(send_entered.wait_calls, 1, "the handshake wait must be observed")
        self.assertGreaterEqual(release_send.wait_calls, 1, "the release wait must be observed")
        self.assert_bounded(send_entered.wait_timeouts, "the handshake wait must stay bounded")
        self.assert_bounded(release_send.wait_timeouts, "the release wait must stay bounded")
        # The release is required independently of the wait outcome it recorded: it must
        # still be recorded before the join it exists to unblock.
        self.assertEqual(len(facade.threads), 1, "the method must own exactly the one worker it launches")
        worker = facade.threads[0]
        self.assertTrue(worker.started)
        self.assertGreaterEqual(release_send.set_calls, 1, "the failing method must still release its event")
        self.assertGreaterEqual(worker.join_calls, 1, "the failing method must still join the started worker")
        self.assert_bounded(worker.join_timeouts, "the join must stay bounded, never unbounded")
        self.assert_unblock_precedes_joins(
            self.tagged_positions(facade, "event_set", release_send.index),
            self.tagged_positions(facade, "thread_join", worker.index),
            "the poll failure must release the event before joining the worker",
        )
        # The deliberately unmet release wait never excuses the rest of the contract: the
        # actual post-join liveness observation, the join-before-check order and the report
        # order are pinned here too, so a post-report cleanup or a dropped liveness call
        # cannot pass in this case. The poll failure stops the body before its mid-flight
        # liveness assertion, so exactly one liveness call remains, the post-join one.
        alive_observations = [
            event[2]
            for event in facade.timeline
            if event[0] == "liveness_observed" and event[1] == worker.index
        ]
        self.assertEqual(alive_observations, [False], "the joined worker must be observed after its join")
        join_positions = self.event_positions(facade, "thread_join")
        liveness_positions = self.event_positions(facade, "liveness_observed")
        self.assertEqual(len(join_positions), 1, "the started worker must be joined exactly once")
        self.assertEqual(len(liveness_positions), 1, "the joined worker must be checked for liveness once")
        self.assertLess(
            max(join_positions),
            min(liveness_positions),
            "every join must complete before the actual liveness checks",
        )
        report_positions = self.event_positions(facade, "nested_reported")
        self.assertEqual(len(report_positions), 1, "exactly one nested outcome must be reported")
        self.assertLess(
            max(join_positions + liveness_positions),
            report_positions[0],
            "the reported outcome must follow the joins and their liveness checks",
        )
        messages = [str(error) for error in reported_exceptions(result)]
        self.assertEqual(len(messages), 1, "exactly one nested outcome must be reported")
        self.assertFalse(result.wasSuccessful())
        self.assertIn(
            transport_tests.PRISMA_CHANNEL_A_TRANSPORT_UNAVAILABLE,
            messages[0],
            "the injected poll failure must reach the reported message as the canonical transport error",
        )
        self.assertIn(
            "release wait",
            messages[0],
            "a reported outcome must identify the release wait the method could not validate",
        )

    def test_worker_and_poll_failures_must_both_reach_the_reported_message(self):
        """Two independent causes must both survive aggregation in one reported message.

        The send session is scripted to raise the worker ``BaseException`` and the poll
        session to raise its own transport failure, so the run ends with one cause on each
        side. The poll script is installed on top of the send script: each session is a
        wrapper delegating to the one below it, every injected error is recorded in the
        ledger of the script that raised it, and the two layers restore in reverse order.
        """
        facade = self.activate(InertThreadingFacade())
        worker_error = InertWorkerBaseException()
        poll_error = RuntimeError(INJECTED_POLL_FAILURE)
        send_script = self.install_session_factory(url_marker=SEND_METHOD_PATH, post_error=worker_error)
        poll_script = self.install_session_factory(url_marker=POLL_METHOD_PATH, post_error=poll_error)

        result = self.new_result(facade)
        self.run_owned_method(SEND_AND_POLL_METHOD, result)

        # Each injection is evidenced by its own ledger, at the instant it was raised.
        self.assertEqual(len(send_script.injections), 1, "the worker failure must be injected exactly once")
        self.assertTrue(send_script.injections[0][0].endswith(SEND_METHOD_PATH))
        self.assertIs(send_script.injections[0][1], worker_error)
        self.assertEqual(len(poll_script.injections), 1, "the poll failure must be injected exactly once")
        self.assertTrue(poll_script.injections[0][0].endswith(POLL_METHOD_PATH))
        self.assertIs(poll_script.injections[0][1], poll_error)
        # Both real sessions are used once and closed once through the nested wrappers.
        self.assertEqual([len(session.calls) for session in send_script.sessions], [1, 1])
        self.assertEqual([session.close_calls for session in send_script.sessions], [1, 1])
        # The worker failure was caught by the owning case and never left to the thread
        # hook. Both recorded event waits are counted and read before any bound, and the
        # release still precedes the join it exists to unblock.
        self.assert_facade_contract(facade)
        self.assertEqual(facade.uncaught_errors, [], "the worker failure must not escape to the thread hook")
        self.assertEqual(len(facade.events), 2, "the method must own exactly the two events it creates")
        self.assertEqual(len(facade.threads), 1, "the method must own exactly the one worker it launches")
        send_entered, release_send = facade.events
        worker = facade.threads[0]
        self.assertTrue(worker.started)
        self.assertEqual(send_entered.wait_results, [True], "the handshake wait must observe the recorded signal")
        self.assertEqual(release_send.wait_results, [True], "the release wait must complete cooperatively")
        self.assertGreaterEqual(send_entered.wait_calls, 1, "the handshake wait must be observed")
        self.assertGreaterEqual(release_send.wait_calls, 1, "the release wait must be observed")
        self.assert_bounded(send_entered.wait_timeouts, "the handshake wait must stay bounded")
        self.assert_bounded(release_send.wait_timeouts, "the release wait must stay bounded")
        self.assertGreaterEqual(release_send.set_calls, 1, "the failing method must still release its event")
        self.assertGreaterEqual(worker.join_calls, 1, "the failing method must still join the started worker")
        self.assert_bounded(worker.join_timeouts, "the join must stay bounded, never unbounded")
        self.assert_unblock_precedes_joins(
            self.tagged_positions(facade, "event_set", release_send.index),
            self.tagged_positions(facade, "thread_join", worker.index),
            "the poll failure must release the event before joining the worker",
        )
        # The actual post-join liveness observation, asserted non-empty on its own instead
        # of riding on the join ledger: exactly one is recorded, because the poll failure
        # stops the body before its mid-flight liveness assertion, and the report follows
        # both that join and that check.
        alive_observations = [
            event[2]
            for event in facade.timeline
            if event[0] == "liveness_observed" and event[1] == worker.index
        ]
        self.assertEqual(alive_observations, [False], "the joined worker must be observed after its join")
        join_positions = self.event_positions(facade, "thread_join")
        liveness_positions = self.event_positions(facade, "liveness_observed")
        self.assertEqual(len(join_positions), 1, "the started worker must be joined exactly once")
        self.assertEqual(len(liveness_positions), 1, "the joined worker must be checked for liveness once")
        self.assertLess(
            max(join_positions),
            min(liveness_positions),
            "every join must complete before the actual liveness checks",
        )
        report_positions = self.event_positions(facade, "nested_reported")
        self.assertEqual(len(report_positions), 1, "exactly one nested outcome must be reported")
        self.assertLess(
            max(join_positions + liveness_positions),
            report_positions[0],
            "the reported outcome must follow the joins and their liveness checks",
        )
        messages = [str(error) for error in reported_exceptions(result)]
        self.assertEqual(len(messages), 1, "exactly one nested outcome must be reported")
        self.assertFalse(result.wasSuccessful())
        # The reported message is checked from the worker marker first: it must stay
        # represented...
        self.assertIn(
            INJECTED_WORKER_MARKER,
            messages[0],
            "the reported message must still name the worker failure",
        )
        # ...beside the body cause. The two causes are independent, so the body failure must
        # survive aggregation instead of being dropped because another problem was already
        # reported.
        self.assertIn(
            transport_tests.PRISMA_CHANNEL_A_TRANSPORT_UNAVAILABLE,
            messages[0],
            "the reported message must also account for the independent poll failure",
        )

    def test_second_start_failure_must_report_the_surviving_worker_liveness_diagnostic(self):
        """A failed second launch must not hide the first worker's failed liveness.

        The second worker fails to launch while the instrument keeps the joined first
        worker alive, so the single reported outcome must account for both. The exact
        launch failure, the started and unstarted workers and the abort-before-join
        sequence are proven first, then the injected launch marker, and only then the
        missing category.
        """
        facade = self.activate(InertThreadingFacade(fail_start_index=2, join_clears_alive=False))

        result = self.new_result(facade)
        self.run_owned_method(CONCURRENT_SENDS_METHOD, result)

        # The exact launch failure, and the worker on each side of it.
        self.assertEqual(len(facade.threads), 2, "both owned workers must be recorded, started or not")
        first, second = facade.threads
        self.assertEqual([first.started, second.started], [True, False])
        self.assertEqual([str(error) for error in second.start_errors], [f"{INJECTED_START_FAILURE} 2"])
        self.assertEqual(facade.start_attempts, 2)
        self.assert_facade_contract(facade)
        # The rendezvous is broken before any join, only the started worker is joined, and
        # every recorded rendezvous wait is counted and bounded before its position is read.
        self.assertEqual(len(facade.barriers), 1)
        barrier = facade.barriers[0]
        self.assertEqual(barrier.parties, 2)
        self.assertGreaterEqual(barrier.wait_calls, 1, "the started send must attempt the rendezvous")
        self.assertEqual(
            len(barrier.wait_timeouts), barrier.wait_calls, "every rendezvous wait must be recorded"
        )
        self.assert_bounded(barrier.wait_timeouts, "the rendezvous wait must stay bounded")
        self.assertGreaterEqual(barrier.abort_calls, 1, "the failing method must abort the barrier")
        self.assertGreaterEqual(first.join_calls, 1, "the failing method must join the started worker")
        self.assert_bounded(first.join_timeouts, "the join must stay bounded, never unbounded")
        abort_positions = self.event_positions(facade, "barrier_abort")
        join_positions = self.event_positions(facade, "thread_join")
        self.assertGreaterEqual(len(abort_positions), 1, "the barrier abort must be observed")
        self.assertEqual(len(join_positions), 1, "the started worker must be joined exactly once")
        self.assertLess(min(abort_positions), min(join_positions), "the barrier must be aborted before the join")
        self.assertEqual(second.join_calls, 0, "the unstarted worker must never be joined")
        self.assertEqual(facade.unstarted_join_attempts(), 0)
        # The actual post-join liveness observation saw a surviving worker; every join
        # completes before it, and both precede the outcome the run really reported.
        alive_observations = [
            event[2]
            for event in facade.timeline
            if event[0] == "liveness_observed" and event[1] == first.index
        ]
        self.assertEqual(alive_observations, [True], "the joined worker must be observed still alive")
        liveness_positions = self.event_positions(facade, "liveness_observed")
        self.assertEqual(len(liveness_positions), 1, "the joined worker must be checked for liveness once")
        self.assertLess(
            max(join_positions),
            min(liveness_positions),
            "every join must complete before the actual liveness checks",
        )
        report_positions = self.event_positions(facade, "nested_reported")
        self.assertEqual(len(report_positions), 1, "exactly one nested outcome must be reported")
        self.assertLess(
            max(join_positions + liveness_positions),
            report_positions[0],
            "the reported outcome must follow the joins and their liveness checks",
        )
        messages = [str(error) for error in reported_exceptions(result)]
        self.assertEqual(len(messages), 1, "exactly one nested outcome must be reported")
        self.assertFalse(result.wasSuccessful())
        self.assertIn(
            INJECTED_START_FAILURE,
            messages[0],
            "the reported message must retain the injected launch failure",
        )
        self.assertIn(
            "liveness",
            messages[0],
            "a reported outcome must identify the unsatisfied post-join liveness obligation",
        )

    def test_unstarted_worker_must_preserve_the_body_exception_without_wait_or_liveness(self):
        """An unstarted worker owes no join, no liveness check and no completed wait.

        The very first launch attempt fails, so the method owns an event and a worker and
        never runs that worker's target. The case still releases the event it owns, but no
        wait completes and no worker state can be observed, so this oracle requires no
        bounded wait, no join and no liveness observation at all: a future cleanup
        validator that demanded any of them from an unstarted worker would be inventing an
        obligation the run never had. The sole body exception must stay the reported one,
        unchanged and identical.
        """
        facade = self.activate(InertThreadingFacade(fail_start_index=1))

        result = self.new_result(facade)
        self.run_owned_method(SEND_AND_POLL_METHOD, result)

        self.assertEqual(len(facade.threads), 1, "the method must own exactly the one worker it creates")
        worker = facade.threads[0]
        self.assert_facade_contract(facade)
        self.assertFalse(worker.started, "the first launch attempt must fail before any start")
        self.assertIsNone(worker.ident, "an unstarted worker must report no identity")
        self.assertEqual(facade.start_attempts, 1)
        self.assertEqual([str(error) for error in worker.start_errors], [f"{INJECTED_START_FAILURE} 1"])
        # No join of an unstarted worker was even attempted, and no liveness was observed.
        self.assertEqual(worker.join_calls, 0, "an unstarted worker must never be joined")
        self.assertEqual(worker.unstarted_join_attempts, 0, "an unstarted worker must not be joined blindly")
        self.assertEqual(facade.unstarted_join_attempts(), 0)
        self.assertEqual(worker.liveness_checks, 0, "an unstarted worker has no post-join state to observe")
        self.assertEqual(self.event_positions(facade, "thread_join"), [])
        self.assertEqual(self.event_positions(facade, "liveness_observed"), [])
        self.assertEqual(facade.uncaught_errors, [])
        # The owned event is still released, but nothing ever waited on either event: no
        # wait is required here, so no bound is asserted on an empty ledger.
        self.assertEqual(len(facade.events), 2, "the method must own exactly the two events it creates")
        send_entered, release_send = facade.events
        self.assertEqual(release_send.set_calls, 1, "the case must still release the event it owns")
        self.assertEqual(send_entered.set_calls, 0, "a failed launch must never run the send")
        self.assertEqual(send_entered.wait_timeouts, [], "no handshake wait may be required of a failed launch")
        self.assertEqual(release_send.wait_timeouts, [], "no release wait may be required of a failed launch")
        # The body exception is the sole failure and stays the reported one, unchanged.
        exceptions = reported_exceptions(result)
        self.assertEqual(len(exceptions), 1, "exactly one nested outcome must be reported")
        self.assertIs(exceptions[0], worker.start_errors[0], "the sole body exception must be reported unchanged")
        self.assertEqual(self.reported_kinds(result), ["error"], "the sole body exception must stay an error")
        self.assertFalse(result.wasSuccessful())


if __name__ == "__main__":
    unittest.main()
