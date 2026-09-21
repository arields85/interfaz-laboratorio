"""Cleanup regression tests for the racing methods of the Channel A pairing module.

``services/prisma-runtime/tests/test_channel_a_pairing.py`` runs three racing
methods inside ``ChannelAPairingGenerationTests``:

* ``test_racing_claims_on_one_qr_produce_exactly_one_pending`` (two workers),
* ``test_racing_confirms_on_one_ticket_produce_exactly_one_link`` (two workers),
* ``test_racing_issue_qr_for_one_owner_returns_a_single_challenge`` (four workers).

Each of them creates a real ``threading.Barrier`` plus real ``threading.Thread``
workers, joins each worker with a fixed bound, and then asserts the complete
result. The unchanged methods are not edited here: this module runs them exactly
as they are written and observes them from the outside.

This file delivers the inert harness proof, the three complete-result positive
controls, and the cleanup regressions of the three racing methods. The harness
checks discrimination, non-vacuity and restoration before any defect can be
claimed. Each regression then injects one fault into one owned primitive, or two
faults when a single report has to carry two independent causes, records each in
its own independent ledger before it is raised, and asserts from the outside the
contract the method must meet once those faults have happened. No regression edits,
copies or relaxes the method under test: the method runs exactly as written, and the
evidence is the report ``unittest`` actually produced together with the ledgers the
instrument actually recorded, never a re-synthesised state. Whether the methods as
written already satisfy each contract is not asserted here: it is observed when the
suite runs, and what each regression fixes is the contract itself, not a prediction
about the outcome.

The instrument is module-local and inert:

* The pairing test module's own ``threading`` binding is replaced by
  ``InertThreadingFacade``, so only ``Thread`` and ``Barrier`` -- the two names
  those methods actually use -- are doubled for that one module, for the duration
  of one test, and the original binding is restored unconditionally. The facade has
  no catch-all delegation and no ``Event`` or ``current_thread`` seam: a method
  reaching for any other primitive would raise ``AttributeError`` loudly instead of
  silently running on the real standard library.
* An inert worker runs its target inline on the test thread, records ownership in
  the facade before any launch attempt, and models a worker as alive from
  ``start()`` until a ``join()`` observes it, because the non-blocking fake waits
  remove the real blocking that kept it alive. The state a ``join`` observes is kept
  apart from the actual ``is_alive()`` calls: the first is recorded as simulated
  join state, the second as a real liveness observation carrying the index and the
  value it returned. Every fake wait is non-blocking, so the legacy
  ``barrier.wait()`` call with no bound stays safe; the recorded input is kept so a
  later contract can tighten it. An ``abort`` leaves the rendezvous permanently
  broken, so a later ``wait`` is refused immediately instead of returning a party
  index, the way a real broken barrier refuses a late party.
* A worker target that escapes with a ``BaseException`` -- an ``Exception`` or one
  of the two control-flow exceptions alike -- is caught in the instrument and
  recorded as an uncaught worker failure, the way a real thread's uncaught hook
  reports it. It is therefore never reclassified as a launch failure and can never
  escape into the test runner. No instrument callback ever asserts, so an instrument
  failure can never be swallowed by an expected inner failure.
* Two nested layers cover each real boundary on the same attribute: an inert floor
  installed first, and a refusing guard installed on top of it.
  ``requests.Session.request`` and ``stdlib_threading.Thread.start`` are each
  covered that way with an independent persistent numeric ledger, so a dispatch that
  bypassed the facade still meets a layer this module owns. Neither layer ever
  reaches the original implementation, and both are restored in reverse order after
  the active-binding check and the attempts check have each observed the layer while
  it was still installed.
* The source registry's own ``threading.RLock`` is intentionally left untouched. It
  is reached only sequentially because the inline workers run one at a time on one
  thread, which is exactly what makes the real lock safe to use here.

Every oracle is asserted outside the nested run, and each nested run is reported
through ``RecordingTestResult``, which records every ``addSuccess``,
``addFailure`` and ``addError`` into the run's shared timeline before it delegates
to ``unittest``. Report ordering is therefore observed where it happened instead of
being re-synthesised by the harness afterwards.
"""

from __future__ import annotations

import io
import threading as stdlib_threading
import unittest

import requests

if __package__:
    from . import test_channel_a_pairing as pairing_tests
else:
    import test_channel_a_pairing as pairing_tests

# Fixed, non-disclosing messages. The trailing number is the recorded attempt
# count, so a refusal is both fixed and traceable in a rendered failure.
REQUEST_GUARD_REFUSAL = "PRISMA_PAIRING_CLEANUP_REQUEST_GUARD_REFUSED"
REQUEST_FLOOR_REFUSAL = "PRISMA_PAIRING_CLEANUP_INERT_REQUEST_FLOOR_REACHED"
THREAD_START_GUARD_REFUSAL = "PRISMA_PAIRING_CLEANUP_REAL_THREAD_START_REFUSED"
THREAD_FLOOR_REFUSAL = "PRISMA_PAIRING_CLEANUP_INERT_THREAD_START_FLOOR_REACHED"
INTENTIONAL_NESTED_FAILURE = "PRISMA_PAIRING_CLEANUP_INTENTIONAL_NESTED_FAILURE"

# A reserved probe host, used only to keep the probe URL non-routable by
# convention while the harness proof exercises the two owned request layers
# directly. The suffix proves nothing about reachability on its own: name
# resolution and proxies can still perform I/O for a reserved name, so the safety
# of this probe comes from the inert floor and the refusing guard that cover
# ``requests.Session.request``, never from the host name.
PROBE_URL = "https://channel-a-pairing-probe.invalid/getMe"

# The three existing racing methods this module runs unchanged, and the worker
# count and rendezvous size each one declares.
CLAIMS_METHOD = "test_racing_claims_on_one_qr_produce_exactly_one_pending"
CONFIRMS_METHOD = "test_racing_confirms_on_one_ticket_produce_exactly_one_link"
ISSUE_QR_METHOD = "test_racing_issue_qr_for_one_owner_returns_a_single_challenge"
CLAIM_WORKERS = 2
CONFIRM_WORKERS = 2
ISSUE_WORKERS = 4

# Faults this module can inject into one owned primitive. Each injected fault is
# recorded in its own independent ledger before it is raised, so the evidence
# survives even when the method under test never reports the cause itself, and each
# ledger counts only what this instrument actually injected. A regression normally
# injects one fault, and injects two when a single report has to carry two
# independent causes.
INJECTED_START_FAILURE = "PRISMA_PAIRING_CLEANUP_INJECTED_START_FAILURE"
INJECTED_WORKER_MARKER = "PRISMA_PAIRING_CLEANUP_INJECTED_WORKER_BASE_EXCEPTION"
INJECTED_JOIN_CLEANUP_ERROR = "PRISMA_PAIRING_CLEANUP_INJECTED_JOIN_CLEANUP_ERROR"
INJECTED_ABORT_FAILURE = "PRISMA_PAIRING_CLEANUP_INJECTED_ABORT_FAILURE"

# The refusal a wait meets on a rendezvous that was already broken. It is not an
# injected fault: it is the inert answer to a real ``BrokenBarrierError``, kept
# fixed so a late wait stays attributable.
BROKEN_BARRIER_REFUSAL = "PRISMA_PAIRING_CLEANUP_BARRIER_ALREADY_BROKEN"

# Only lowercase ``liveness`` is required in the nested method's diagnostic.
# ``cleanup`` and ``release wait`` label this harness's own assertions; they are
# not additional message requirements on the method under test.
LIVENESS_CATEGORY = "liveness"
CLEANUP_CATEGORY = "cleanup"
RELEASE_WAIT_CATEGORY = "release wait"


class InertWorkerBaseException(BaseException):
    """The failure one owned worker raises inside its target, before it can be caught.

    It derives from ``BaseException`` on purpose. The worker targets call
    ``barrier.wait()`` as their first statement, outside the ``except
    ChannelAPairingError`` block the two claim and confirm races use, and the
    four-worker race has no handler around its registry call at all. A plain
    ``Exception`` subclass would not be caught by that handler either: the point is
    that this is not an ordinary domain refusal, it stands for a worker that died
    with an uncaught control-flow failure, and no ``except Exception`` may absorb it
    silently. The report is owed by the method under test, whose own wrapper must
    catch whatever its workers raise and carry it into the outcome it reports. The
    instrument's ``except BaseException`` hook is only the last resort that records a
    genuinely uncaught worker failure as leak evidence, and it never stands in for the
    report the method owes.
    """

    def __init__(self, marker: str = INJECTED_WORKER_MARKER) -> None:
        super().__init__(marker)
        self.marker = marker


class InjectedLaunchFailure(Exception):
    """The refusal the fake ``Thread.start`` raises for one chosen worker index.

    It derives from ``Exception`` so a nested run that raises nothing else is reported
    as an ordinary reported error that preserves the very object this instrument
    injected. Preservation is therefore asserted by identity, never by matching a
    message the run may have rewritten.
    """


class InjectedCleanupFailure(Exception):
    """The refusal the fake join or abort raises, told apart by its fixed marker."""


class InertBarrier:
    """A rendezvous whose ``wait`` returns immediately with a party index.

    Every ``wait`` keeps the timeout it was given and the party index it returned,
    so a caller can account for every party and for every recorded input without
    trusting an argument this fake never blocks on. The unchanged methods call
    ``wait()`` with no bound at all, so the recorded input may be ``None``; a
    positive control must stay green either way, and the finite-bound contract is a
    separate regression. ``abort`` breaks the rendezvous, and that broken state
    persists: a rendezvous that was abandoned can never complete again, so every
    later ``wait`` is counted first and then refused immediately, non-blocking, with
    an inert ``BrokenBarrierError`` and a recorded late-wait position instead of a
    party index. ``abort`` is recorded with its position so a later contract can
    require a failing method to break a rendezvous it can no longer complete, and a
    healthy run is never required to abort: with nothing broken and nothing injected,
    the recorded inputs stay exactly as they were. An injected fault is reserved only
    after the wait input and the party position have been recorded, so a refused
    rendezvous never costs the instrument its evidence. No method here ever asserts.
    """

    def __init__(self, facade, *, parties) -> None:
        self._facade = facade
        self.parties = parties
        self.wait_calls = 0
        self.wait_timeouts: list = []
        self.wait_results: list = []
        self.refused_waits: list = []
        self.abort_calls = 0
        self.broken = False

    def wait(self, timeout=None) -> int:
        self.wait_calls += 1
        self.wait_timeouts.append(timeout)
        party = self.wait_calls - 1
        self._facade.wait_ordinal += 1
        if self.broken:
            self.refused_waits.append(party)
            self._facade.timeline.append(("barrier_wait_after_break", self.parties, party))
            raise stdlib_threading.BrokenBarrierError(BROKEN_BARRIER_REFUSAL)
        fault = self._facade.reserve_worker_fault()
        if fault is not None:
            self._facade.timeline.append(("barrier_wait_faulted", self.parties, party))
            raise fault
        self.wait_results.append(party)
        self._facade.timeline.append(("barrier_wait", self.parties, party))
        return party

    def abort(self) -> None:
        self.abort_calls += 1
        self._facade.timeline.append(("barrier_abort", self.parties))
        failure = self._facade.reserve_abort_failure()
        if failure is not None:
            raise failure
        self.broken = True
        self._facade.timeline.append(("barrier_abort_succeeded", self.parties))


class InertThread:
    """An owned worker that runs its target inline and never launches a thread.

    Ownership is recorded by the facade in ``Thread`` before ``start`` is ever
    called. ``alive`` stays true from a successful ``start`` until a ``join``
    observes the worker, and a ``join`` on a worker that never started is recorded
    as an unstarted join attempt instead of being silently skipped. A real
    ``is_alive()`` call is recorded separately from the simulated state a ``join``
    left behind, so a join simulation can never stand in for a liveness check the
    method actually performed. ``ident`` follows the standard rule: a started worker
    reports its ownership index, the first one being ``0``, and a worker that never
    started reports ``None``. A reserved launch or join refusal is raised only after
    the attempt has been recorded and is kept in the facade's own ledger first, so a
    refused worker never becomes a launched one and the refusal stays attributable.
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
        failure = self._facade.reserve_start_failure(self.index)
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
        failure = self._facade.reserve_join_failure(self.index)
        if failure is not None:
            raise failure
        self.alive = self.index == self._facade.join_survivor_index
        self._facade.timeline.append(("join_observed_alive_state", self.index, self.alive))

    def is_alive(self) -> bool:
        """A real liveness call, recorded with its index and the value it returned."""
        self.liveness_checks += 1
        self._facade.timeline.append(("liveness_observed", self.index, self.alive))
        return self.alive


class InertThreadingFacade:
    """The ``threading`` stand-in installed on the pairing test module for one test.

    Every owned primitive is recorded here before it is launched or waited on, and
    ``timeline`` keeps the observation order, so ownership and ordering are asserted
    externally instead of being inferred from sleeps or enumeration. The timeline
    also keeps simulated state apart from actual calls: ``join_observed_alive_state``
    is the state the model held after a join, while ``liveness_observed`` is a real
    ``is_alive()`` call together with the value it returned. Each injected fault is
    kept in its own ledger here and recorded before it is raised, so a caller can
    prove what the instrument injected without trusting the message the run produced.
    No method here ever asserts.
    """

    def __init__(
        self,
        *,
        fail_start_index=None,
        worker_fault_ordinal=None,
        join_survivor_index=None,
        fail_join_index=None,
        fail_abort_index=None,
    ) -> None:
        self._fail_start_index = fail_start_index
        self._worker_fault_ordinal = worker_fault_ordinal
        self._join_survivor_index = join_survivor_index
        self._fail_join_index = fail_join_index
        self._fail_abort_index = fail_abort_index
        self.threads: list = []
        self.barriers: list = []
        self.timeline: list = []
        self.uncaught_errors: list = []
        self.start_failures: list = []
        self.worker_faults: list = []
        self.join_failures: list = []
        self.abort_failures: list = []
        self.wait_ordinal = 0
        self.join_attempts = 0
        self.abort_attempts = 0

    @property
    def join_survivor_index(self):
        """The one worker index a join must leave alive, or ``None`` for a clean join."""
        return self._join_survivor_index

    def Thread(self, target=None, args=(), kwargs=None, name=None, **extra) -> InertThread:
        thread = InertThread(
            self, index=len(self.threads), target=target, args=args, kwargs=kwargs, name=name, extra=extra
        )
        self.threads.append(thread)
        self.timeline.append(("thread_owned", thread.index))
        return thread

    def Barrier(self, parties: int) -> InertBarrier:
        barrier = InertBarrier(self, parties=parties)
        self.barriers.append(barrier)
        self.timeline.append(("barrier_created", parties))
        return barrier

    def unstarted_join_attempts(self) -> int:
        return sum(thread.unstarted_join_attempts for thread in self.threads)

    def reserve_start_failure(self, index):
        """Reserve a launch refusal for one worker index, recorded before it is raised.

        The worker is never marked as started, so a refused launch cannot leave a
        launched worker behind, and the reserved object is the one the caller must see
        carried out of the run.
        """
        if index != self._fail_start_index:
            return None
        failure = InjectedLaunchFailure(f"{INJECTED_START_FAILURE} {index + 1}")
        self.start_failures.append(failure)
        self.timeline.append(("start_failure_reserved", index))
        return failure

    def reserve_worker_fault(self):
        """Reserve the worker failure for one rendezvous ordinal, before it is raised.

        The ordinal is the zero-based party position: the first wait that reaches the
        fake is ordinal 0. The count advances on every wait, so a run that never
        reached the chosen wait leaves the ledger empty instead of reporting a fault it
        never injected.
        """
        ordinal = self.wait_ordinal - 1
        if ordinal != self._worker_fault_ordinal:
            return None
        fault = InertWorkerBaseException(INJECTED_WORKER_MARKER)
        self.worker_faults.append(fault)
        self.timeline.append(("worker_fault_reserved", self.wait_ordinal, type(fault).__name__))
        return fault

    def reserve_join_failure(self, index):
        """Reserve a join refusal for one worker index, recorded before it is raised.

        Every join attempt is counted, whether or not it is refused, so a caller can
        tell a run that stopped joining apart from one that only refused one join.
        """
        self.join_attempts += 1
        if index != self._fail_join_index:
            return None
        failure = InjectedCleanupFailure(f"{INJECTED_JOIN_CLEANUP_ERROR} {self.join_attempts}")
        self.join_failures.append(failure)
        self.timeline.append(("join_failure_reserved", index))
        return failure

    def reserve_abort_failure(self):
        """Reserve an abort refusal for one abort ordinal, recorded before it is raised."""
        self.abort_attempts += 1
        ordinal = self.abort_attempts - 1
        if ordinal != self._fail_abort_index:
            return None
        failure = InjectedCleanupFailure(f"{INJECTED_ABORT_FAILURE} {self.abort_attempts}")
        self.abort_failures.append(failure)
        self.timeline.append(("abort_failure_reserved", self.abort_attempts))
        return failure


def register_restoring_cleanups(case, *, owner, attribute, original, installed, label, attempts, message):
    """Restore one patched attribute, then prove its identity, its check and its restore.

    Registration order is the contract. Cleanups run last-registered-first, so these
    four callbacks execute in exactly this order: ``check_binding`` proves the layer
    is still the installed one, ``check_attempts`` then reads the attempts ledger,
    ``restore`` puts the original binding back, and ``prove_restored`` proves that
    binding is the original. Each callback is registered independently and
    ``unittest`` runs the remaining ones after a failing cleanup, so a failed
    identity check can never suppress the attempts check, and neither can skip the
    unconditional restore or the proof of restoration. The ``cleanup_order``
    observations this writes are how a caller proves that the active-binding check
    and the attempts check both observed the layer while it was still installed, in
    that order, and that each layer was restored only after both checks. The failure
    message carries the layer label, and the attempts message also carries its
    recorded attempt count, so a tripped tripwire is attributable to the layer that
    owns it.
    """
    ledger = getattr(case, "cleanup_order", None)

    def check_binding():
        active = getattr(owner, attribute)
        if ledger is not None:
            ledger.append(("binding_checked", label, active is installed))
        case.assertIs(
            active,
            installed,
            f"{message} [{label}] the active binding was not the installed layer",
        )

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
    case.addCleanup(check_binding)


def replace_module_attribute(case, *, name, replacement, message):
    """Replace one pairing-module name for one test, restore it and prove both."""
    original = getattr(pairing_tests, name)
    setattr(pairing_tests, name, replacement)
    case.addCleanup(lambda: case.assertIs(getattr(pairing_tests, name), original, f"{message} and was not restored"))
    case.addCleanup(lambda: setattr(pairing_tests, name, original))
    case.addCleanup(lambda: case.assertIs(getattr(pairing_tests, name), replacement, message))
    return original


def install_inert_request_floor(case):
    """Install the inert floor on ``requests.Session.request`` itself, first.

    The floor occupies the very attribute the refusal guard is installed on next, so
    it sits directly under the guard and directly above the real implementation. A
    dispatch that bypassed the guard therefore still meets a layer this module owns,
    and it meets it before any session, netrc or proxy-environment read could happen.
    It counts the attempt in its own persistent ledger and raises without ever
    touching the original. It returns its own callable and its ledger so a caller can
    exercise the floor directly without invoking the original request path.
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

    The pairing module's ``threading`` binding is replaced by the facade, so this
    floor covers the other way a launch could escape: real standard-library use. It
    is imported as ``stdlib_threading`` so it can never be confused with the module's
    replacement. It counts the attempt in its own persistent ledger and raises
    without launching anything, and it returns its own callable and ledger.
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


def reported_exceptions(result) -> list:
    """The exception objects ``unittest`` reported for one nested run.

    The report is the evidence: a success report carries no exception, and one
    aggregated failure still yields exactly one exception, whose message must
    represent every cause the run actually observed.
    """
    return [error[1] for _, _, error in result.reports if error is not None]


class RecordingTestResult(unittest.TestResult):
    """A nested result that records the actual report before it delegates to ``unittest``.

    Report ordering is part of the evidence: a worker failure or a survivor must be
    reported only after the joins and the liveness observations that precede it, and
    a case reported as a pass must be distinguishable from a case reported as a
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


class PairingCleanupHarnessTestCase(unittest.TestCase):
    """Base case: run the real racing methods with inert owned primitives.

    ``activate`` installs two nested layers on each real boundary first, then the
    pairing module's ``threading`` replacement. The cleanups registered by each
    install run the active-binding check first and the attempts check next, both
    while that layer is still installed; they restore the original binding after
    that and prove the restored identity last. Every callback is registered
    independently, so a failing check can never suppress a later one or skip the
    restore, every patch is restored even when the body fails, and each restoration
    is proven by a separate assertion.
    """

    def activate(self, facade):
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

    def new_result(self, facade):
        """A nested result that records each report into the run's own timeline.

        The stream is still captured, so a nested run never writes out. Unlike a plain
        result, this one appends an observation at the instant ``unittest`` reports the
        nested case, so report ordering is read from where it happened instead of
        being re-synthesised after the run.
        """
        return RecordingTestResult(facade.timeline)

    def run_owned_method(self, method_name, result):
        """Run one real method of the sibling module exactly as it is written today.

        The method is reached through the package-aware module alias -- the same way
        the module is discovered -- and is never imported, copied or re-implemented
        here, so every business assertion it makes stays in force.
        """
        case = pairing_tests.ChannelAPairingGenerationTests(method_name)
        case.run(result)
        return case

    def recorded_outcomes(self, result):
        """The rendered text of every nested error and failure, asserted externally."""
        self.assertEqual(result.testsRun, 1, "the nested run must execute exactly one real method")
        return "\n".join(text for _, text in result.errors + result.failures)

    def reported_kinds(self, result):
        """The kinds of the outcomes ``unittest`` actually reported for this nested run."""
        return [kind for kind, _, _ in result.reports]

    def event_positions(self, facade, name):
        """The positions of one timeline event name, in observation order."""
        return [position for position, event in enumerate(facade.timeline) if event[0] == name]

    def tagged_positions(self, facade, tag, index):
        """The positions of one timeline event tag for one owned primitive index."""
        return [
            position
            for position, event in enumerate(facade.timeline)
            if event[0] == tag and event[1] == index
        ]

    def assert_bounded(self, timeouts, message):
        """Every recorded join carried a finite, positive, non-boolean bound.

        The exact bound is never asserted, so any positive value stays acceptable. A
        boolean is rejected explicitly because ``True`` would otherwise pass an
        ordering check as the number 1, and the infinities are rejected because an
        unbounded join is exactly what this instrument must never model.
        """
        self.assertTrue(timeouts, f"{message}: at least one bounded join must be recorded")
        for timeout in timeouts:
            self.assertNotIsInstance(timeout, bool, message)
            self.assertIsInstance(timeout, (int, float), message)
            self.assertNotEqual(timeout, float("inf"), message)
            self.assertNotEqual(timeout, float("-inf"), message)
            self.assertGreater(timeout, 0, message)

    def assert_recorded_wait_inputs(self, barrier):
        """Every recorded rendezvous input was a legal, non-blocking argument.

        The unchanged methods call ``wait()`` with no bound at all, and a
        non-blocking fake never blocks on ``None``. The recorded input is therefore
        checked for legality only -- a positive, finite, non-boolean number or
        ``None`` -- so this control stays green today and would stay green after the
        separate finite-bound contract tightens the call.
        """
        self.assertEqual(len(barrier.wait_timeouts), barrier.wait_calls, "every wait must record its input")
        for timeout in barrier.wait_timeouts:
            if timeout is None:
                continue
            self.assertNotIsInstance(timeout, bool, "a boolean is not a wait bound")
            self.assertIsInstance(timeout, (int, float), "a wait bound must be numeric")
            self.assertNotEqual(timeout, float("inf"), "a wait bound must be finite")
            self.assertNotEqual(timeout, float("-inf"), "a wait bound must be finite")
            self.assertGreater(timeout, 0, "a wait bound must be positive")

    def assert_every_started_worker_was_joined(self, facade):
        """Every worker that started was joined at least once; none is abandoned."""
        started = [thread for thread in facade.threads if thread.started]
        self.assertTrue(started, "at least one worker must have started")
        for thread in started:
            self.assertGreaterEqual(thread.join_calls, 1, f"worker {thread.index} was started but never joined")

    def assert_liveness_observed_per_started_worker(self, facade):
        """Each started worker was actually asked about its liveness, after its join.

        A single ``any(...)`` over the workers is not enough: it short-circuits, so a
        worker it never reached would be left unobserved. This requires one real
        observation per started worker, recorded as an ``is_alive()`` call and placed
        after that worker's join.
        """
        started = [thread for thread in facade.threads if thread.started]
        self.assertTrue(started, "at least one worker must have started")
        for thread in started:
            self.assertGreaterEqual(
                thread.liveness_checks, 1, f"worker {thread.index} was never asked about its liveness"
            )
            joins = self.tagged_positions(facade, "thread_join", thread.index)
            observations = self.tagged_positions(facade, "liveness_observed", thread.index)
            self.assertTrue(joins, f"worker {thread.index} must have been joined")
            self.assertTrue(observations, f"worker {thread.index} must have been observed")
            self.assertLess(max(joins), max(observations), f"worker {thread.index} must be observed after its join")

    def assert_no_escape(self, facade):
        """No real launch, no real dispatch and no uncaught worker failure escaped."""
        self.assertEqual(facade.uncaught_errors, [], "no worker failure may escape unrecorded")
        self.assertEqual(self.real_thread_attempts, [], "no real thread may be launched by the run under test")
        self.assertEqual(self.request_attempts, [], "no real HTTP dispatch may be attempted by the run under test")
        self.assertEqual(self.request_floor_attempts, [], "the inert request floor must never be reached")
        self.assertEqual(self.thread_floor_attempts, [], "the inert thread-start floor must never be reached")

    def assert_facade_contract(self, facade):
        """The facade must model every ``threading`` name and keyword the methods use.

        A keyword the fake does not model would otherwise be swallowed by ``**extra``,
        so the recorded extras must be empty. The facade exposes only ``Thread`` and
        ``Barrier``, so a method reaching for another primitive would have raised
        ``AttributeError`` long before this check.
        """
        self.assertTrue(facade.threads, "the unchanged method must own at least one worker")
        for thread in facade.threads:
            self.assertEqual(thread.extra_kwargs, {}, "the facade ignored a threading keyword it does not model")

    def assert_healthy_race(self, method_name, workers):
        """Run one racing method unchanged and prove its complete healthy result.

        The nested run must succeed on its own business assertions: this control
        never re-implements or relaxes them, it requires the actual nested success.
        On top of that it proves the instrument was non-vacuous: every worker was
        owned before the first launch attempt, every worker started and was joined
        through its own join record, exactly one rendezvous was used with the declared
        number of parties and every party was accounted for, every recorded wait input
        was a legal argument, every join carried a finite positive bound, each worker
        performed a real liveness observation after its join, every join preceded the
        first actual liveness call, and all of that happened before ``unittest``
        reported the nested success. A healthy run is never required to abort the
        rendezvous, so ``abort`` is not asserted here.
        """
        facade = InertThreadingFacade()
        self.activate(facade)
        result = self.new_result(facade)
        case = self.run_owned_method(method_name, result)

        self.assertIn(method_name, case.id(), "the nested run must execute the named real method")
        self.assertEqual(
            self.recorded_outcomes(result),
            "",
            "the unchanged method must pass on its own business assertions",
        )
        self.assertTrue(result.wasSuccessful(), "the unchanged method must not be reported as failing")
        self.assertEqual(
            self.reported_kinds(result), ["success"], "a complete healthy run must be reported as a success"
        )

        # Ownership: every worker exists before the first launch attempt, and the
        # first owned worker reports identity 0 once it starts.
        owned = self.event_positions(facade, "thread_owned")
        starts = self.event_positions(facade, "thread_start_attempt")
        self.assertEqual(len(facade.threads), workers, "the declared workers must all be constructed")
        self.assertEqual(len(owned), workers, "every declared worker must be owned")
        self.assertEqual(len(starts), workers, "every declared worker must be launched once")
        self.assertEqual(facade.threads[0].ident, 0, "the first owned worker must report identity 0")
        self.assertLess(max(owned), min(starts), "every worker must be owned before the first launch attempt")

        started = [thread for thread in facade.threads if thread.started]
        self.assertEqual(len(started), workers, "every declared worker must have started")
        self.assert_every_started_worker_was_joined(facade)
        self.assertEqual(facade.unstarted_join_attempts(), 0, "no unstarted worker may be joined")

        # Rendezvous: one barrier, the declared parties, every party accounted for.
        self.assertEqual(len(facade.barriers), 1, "the unchanged method uses exactly one rendezvous")
        barrier = facade.barriers[0]
        self.assertEqual(barrier.parties, workers, "the rendezvous must declare the expected party count")
        self.assertEqual(barrier.wait_calls, workers, "every party must reach the rendezvous once")
        self.assertEqual(sorted(barrier.wait_results), list(range(workers)), "every party index must be accounted for")
        self.assert_recorded_wait_inputs(barrier)

        # Joins are bounded today: the unchanged methods join with a finite positive
        # bound, so this is a real record and not an assumption.
        self.assert_bounded(
            [timeout for thread in started for timeout in thread.join_timeouts],
            "every join must carry a finite positive bound",
        )

        # Every worker performed a real liveness observation after its own join, and
        # the run finished in the required global order: all joins first, then the
        # first actual liveness call, then the sole nested report. The recorded
        # counts are validated before any position is indexed or reduced with
        # ``min``/``max``, so a short-circuited liveness check can never be read as a
        # complete one.
        self.assert_liveness_observed_per_started_worker(facade)
        joins = self.event_positions(facade, "thread_join")
        observations = self.event_positions(facade, "liveness_observed")
        self.assertGreaterEqual(len(joins), workers, "every declared worker must record a join")
        self.assertGreaterEqual(len(observations), workers, "every declared worker must record a liveness call")
        self.assertLess(max(joins), min(observations), "every join must precede the first actual liveness call")
        report = self.event_positions(facade, "nested_reported")
        self.assertEqual(len(report), 1, "the nested run must report exactly once")
        self.assertLess(max(joins), report[0], "the joins must precede the report")
        self.assertLess(max(observations), report[0], "the liveness observations must precede the report")

        self.assert_no_escape(facade)
        self.assert_facade_contract(facade)
        return facade


    def reported_messages(self, result) -> list:
        """The rendered message of every reported exception, read from the report itself."""
        return [str(error) for error in reported_exceptions(result)]

    def assert_single_report(self, result, expected_kind):
        """Exactly one nested outcome, of the one expected kind, with one exception.

        The count is proven before anything is indexed, so a run that reports nothing
        produces an attributable failure instead of an ``IndexError``. Every caller
        names exactly one bucket: ``error`` for an injected cause the method must carry
        out unchanged, and ``failure`` for an aggregated assertion the method must raise
        with every cause it observed. For a non-success outcome the single reported
        exception is returned, and its uniqueness is proven before it is indexed.
        """
        self.assertEqual(result.testsRun, 1, "the nested run must execute exactly one real method")
        kinds = self.reported_kinds(result)
        self.assertEqual(len(kinds), 1, "the nested run must report exactly once")
        self.assertEqual(kinds[0], expected_kind, "the nested run reported an unexpected outcome")
        if kinds[0] == "success":
            return None
        errors = reported_exceptions(result)
        self.assertEqual(len(errors), 1, "the nested run must report exactly one exception")
        return errors[0]

    def run_race(self, method_name, **facade_options):
        """Activate one owned facade, run one real racing method and return both.

        The method is reached through the module alias exactly as written and is never
        copied, edited or relaxed here, so every business assertion it makes stays in
        force and only the injected fault decides what the run does next.
        """
        facade = InertThreadingFacade(**facade_options)
        self.activate(facade)
        result = self.new_result(facade)
        case = self.run_owned_method(method_name, result)
        self.assertIn(method_name, case.id(), "the nested run must execute the named real method")
        workers = {
            CLAIMS_METHOD: CLAIM_WORKERS,
            CONFIRMS_METHOD: CONFIRM_WORKERS,
            ISSUE_QR_METHOD: ISSUE_WORKERS,
        }[method_name]
        fail_index = facade_options.get("fail_start_index")
        started_count = workers if fail_index is None else fail_index
        owned = self.event_positions(facade, "thread_owned")
        starts = self.event_positions(facade, "thread_start_attempt")
        self.assertEqual(len(facade.threads), workers, "all declared workers must be owned")
        self.assertEqual(len(owned), workers)
        self.assertEqual(len(starts), workers if fail_index is None else fail_index + 1)
        self.assertLess(max(owned), min(starts), "ownership must precede every launch")
        self.assertEqual(
            [thread.index for thread in self.started_threads(facade)],
            list(range(started_count)),
            "the exact expected worker prefix must have started",
        )
        self.assertEqual(len(facade.barriers), 1, "the method must create one rendezvous")
        barrier = facade.barriers[0]
        self.assertEqual(barrier.parties, workers)
        self.assertEqual(barrier.wait_calls, started_count, "every started worker must attempt its wait")
        self.assertEqual(facade.wait_ordinal, barrier.wait_calls, "even broken waits must be counted")
        self.assert_recorded_wait_inputs(barrier)
        return facade, result

    def started_threads(self, facade) -> list:
        """The owned workers that actually started."""
        return [thread for thread in facade.threads if thread.started]

    def observed_liveness(self, facade) -> list:
        """The index and value of every real ``is_alive()`` call, in observation order."""
        return [(event[1], event[2]) for event in facade.timeline if event[0] == "liveness_observed"]

    def assert_launch_evidence(self, facade, *, workers, fail_index):
        """The launch refusal happened, in its own ledger, before any later worker started.

        Ownership is proven before the first launch attempt, the refusal is read from the
        independent ledger rather than from the message, and the identity rule is proven
        for every worker: the ones before the refusal report their index, the refused one
        and every worker after it report none.
        """
        owned = self.event_positions(facade, "thread_owned")
        starts = self.event_positions(facade, "thread_start_attempt")
        self.assertEqual(len(facade.threads), workers, "the declared workers must all be constructed")
        self.assertEqual(len(owned), workers, "every declared worker must be owned")
        self.assertEqual(len(starts), fail_index + 1, "only the workers up to the refusal were launched")
        self.assertLess(max(owned), min(starts), "every worker must be owned before the first launch attempt")
        self.assertEqual(len(facade.start_failures), 1, "exactly one launch refusal must be reserved")
        failure = facade.start_failures[0]
        self.assertEqual(str(failure), f"{INJECTED_START_FAILURE} {fail_index + 1}")
        expected = [index if index < fail_index else None for index in range(workers)]
        self.assertEqual([thread.ident for thread in facade.threads], expected)
        self.assertEqual([str(error) for error in facade.threads[fail_index].start_errors], [str(failure)])
        return failure

    def assert_worker_fault_evidence(self, facade, *, ordinal):
        """The worker failure was reserved once, for the declared rendezvous ordinal.

        The ledger keeps the very instance the fake raised, and that instance is a
        ``BaseException`` that is deliberately not an ``Exception``, so an ordinary
        domain refusal could never be mistaken for it. The refused party position is
        recorded separately from the refusal, because a refused wait never returned.
        """
        self.assertEqual(len(facade.worker_faults), 1, "exactly one worker failure must be reserved")
        fault = facade.worker_faults[0]
        self.assertIsInstance(fault, InertWorkerBaseException)
        self.assertNotIsInstance(fault, Exception)
        self.assertEqual(str(fault), INJECTED_WORKER_MARKER)
        self.assertEqual(len(facade.barriers), 1, "the unchanged method uses exactly one rendezvous")
        faulted = [(event[1], event[2]) for event in facade.timeline if event[0] == "barrier_wait_faulted"]
        self.assertEqual(faulted, [(facade.barriers[0].parties, ordinal)])
        return fault

    def assert_every_wait_is_bounded(self, barrier):
        """Every recorded rendezvous wait carried a finite, positive, non-boolean bound.

        The exact bound is never asserted, so any positive value stays acceptable. A
        boolean is rejected explicitly because ``True`` would otherwise pass an ordering
        check as the number 1, and the infinities are rejected because an unbounded wait
        is exactly what this instrument must never model. This is a dedicated bounds
        obligation for the three ``test_*_rendezvous_and_joins_stay_bounded``
        regressions and is never a general cleanup obligation: the unchanged methods
        call ``wait()`` with no bound at all, so a cleanup contract must not demand a
        bound a run does not carry yet.
        """
        self.assertTrue(barrier.wait_timeouts, "at least one rendezvous wait must be recorded")
        for timeout in barrier.wait_timeouts:
            self.assertNotIsInstance(timeout, bool, f"{RELEASE_WAIT_CATEGORY}: a boolean is not a wait bound")
            self.assertIsInstance(timeout, (int, float), f"{RELEASE_WAIT_CATEGORY}: a wait bound must be numeric")
            self.assertNotEqual(timeout, float("inf"), f"{RELEASE_WAIT_CATEGORY}: a wait bound must be finite")
            self.assertNotEqual(timeout, float("-inf"), f"{RELEASE_WAIT_CATEGORY}: a wait bound must be finite")
            self.assertGreater(timeout, 0, f"{RELEASE_WAIT_CATEGORY}: a wait bound must be positive")

    def assert_all_joins_precede_first_liveness(self, facade):
        """Every join precedes the first actual liveness call, globally.

        The counts are validated before any reduction, so a short-circuited liveness
        check can never be read as a complete one, and an incomplete evidence set fails
        attributably instead of raising out of ``min``.
        """
        joins = self.event_positions(facade, "thread_join")
        observations = self.event_positions(facade, "liveness_observed")
        self.assertTrue(joins, "the run must record at least one join")
        self.assertTrue(observations, "the run must record at least one liveness call")
        self.assertLess(max(joins), min(observations), "every join must precede the first actual liveness call")

    def assert_joins_and_observations_precede_report(self, facade):
        """All joins and liveness observations happened before the sole report."""
        report = self.event_positions(facade, "nested_reported")
        self.assertEqual(len(report), 1, "the nested run must report exactly once")
        joins = self.event_positions(facade, "thread_join")
        observations = self.event_positions(facade, "liveness_observed")
        self.assertTrue(joins, "the run must record at least one join")
        self.assertTrue(observations, "the run must record at least one liveness call")
        self.assertLess(max(joins), report[0], "the joins must precede the report")
        self.assertLess(max(observations), report[0], "the liveness observations must precede the report")

    def assert_abort_precedes_first_join(self, facade):
        """A rendezvous that can no longer complete must be broken before any join."""
        aborts = self.event_positions(facade, "barrier_abort")
        joins = self.event_positions(facade, "thread_join")
        self.assertTrue(aborts, "an abandoned rendezvous must be aborted")
        self.assertTrue(joins, "the started workers must still be joined")
        self.assertLess(min(aborts), min(joins), "the abort must precede the first join")

    def assert_bounded_worker_joins(self, facade):
        """Check the recorded bound of every attempted join, including refused joins."""
        started = self.started_threads(facade)
        self.assertTrue(started, "at least one worker must have started")
        for thread in started:
            self.assertEqual(len(thread.join_timeouts), thread.join_calls)
            self.assert_bounded(thread.join_timeouts, f"worker {thread.index} joins must be bounded")

    def assert_no_unstarted_joins(self, facade):
        self.assertEqual(facade.unstarted_join_attempts(), 0, "no unstarted worker may be joined")

    def assert_race_cleanup_contract(self, facade, *, context, require_abort=False):
        """Collect missing cleanup obligations before inspecting the final report.

        Partial launch or a failed party requires an abort attempt before joins;
        merely entering a wait does not mean that party completed the rendezvous.
        Healthy and survivor-only runs need no abort. A refused abort is an attempt,
        not successful release, but it must not prevent the remaining cleanup.
        Every started worker needs bounded joins and actual liveness observations,
        globally after all joins and before reporting. Compatibility and escape
        checks are independent too. ``cleanup`` labels this helper's assertion only.
        """
        violations: list = []
        obligations: list = []
        if require_abort:
            obligations.append(self.assert_abort_precedes_first_join)
        obligations.extend(
            [
                self.assert_every_started_worker_was_joined,
                self.assert_bounded_worker_joins,
                self.assert_no_unstarted_joins,
                self.assert_liveness_observed_per_started_worker,
                self.assert_all_joins_precede_first_liveness,
                self.assert_joins_and_observations_precede_report,
                self.assert_facade_contract,
                self.assert_no_escape,
            ]
        )
        for obligation in obligations:
            try:
                obligation(facade)
            except AssertionError as error:
                violations.append(str(error))
        if violations:
            self.fail(f"{context} ({CLEANUP_CATEGORY}): " + "; ".join(violations))
        if facade.join_survivor_index is not None:
            self.assertIn(
                (facade.join_survivor_index, True),
                self.observed_liveness(facade),
                "the injected survivor must actually be observed alive before inspecting the report",
            )


class InertPairingCleanupHarnessTests(PairingCleanupHarnessTestCase):
    """Harness proof for the inert layers that cover the pairing racing methods."""

    def test_activation_refuses_real_dispatch_launches_and_restores_every_patch(self):
        """Harness proof: both layers discriminate, never launch and always restore.

        The nested case trips each layer directly, keeps the observed counts as
        immutable evidence and leaves the live ledgers in place, so the protective
        tripwires report their own attributable cleanup failures instead of being
        silenced, and the intentional body failure must not stop the remaining
        restorations from running. The outer assertions prove that a failing body
        still restores both nested patches on each attribute and the pairing module's
        ``threading`` binding, that each refusal came from the layer that owns it,
        that a tripped layer is reported as a failure rather than an error, and that
        the active-binding check and the attempts check each observed their own layer
        still installed, in that order, before that layer was restored.
        """
        recorded = {}
        before = (requests.Session.request, stdlib_threading.Thread.start, pairing_tests.threading)

        class ActivationProbeCase(PairingCleanupHarnessTestCase):
            def runTest(inner):
                facade = inner.activate(InertThreadingFacade())
                recorded["facade"] = facade
                recorded["installed_threading"] = pairing_tests.threading
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
                probe_thread = stdlib_threading.Thread(target=lambda: None, name="pairing-cleanup-probe")
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

                # The installed binding is the facade, and it discriminates: an owned
                # worker runs inline on this thread and reports identity 0, while an
                # owned worker that was never started reports no identity at all.
                started_probe = pairing_tests.threading.Thread(target=lambda: None)
                started_probe.start()
                recorded["facade_started_ident"] = started_probe.ident
                recorded["facade_started_alive"] = started_probe.is_alive()
                unstarted_probe = pairing_tests.threading.Thread(target=lambda: None)
                recorded["facade_unstarted_ident"] = unstarted_probe.ident
                recorded["facade_unstarted_alive"] = unstarted_probe.is_alive()
                recorded["facade_owned_indexes"] = [thread.index for thread in facade.threads]
                recorded["facade_uncaught_errors"] = list(facade.uncaught_errors)

                # Exercise the inert barrier itself, without altering the sibling
                # method or launching a worker. Keep every attempt and fault ledger.
                abort_facade = InertThreadingFacade(worker_fault_ordinal=0, fail_abort_index=0)
                abort_probe = abort_facade.Barrier(2)
                with inner.assertRaises(InjectedCleanupFailure) as refused_abort:
                    abort_probe.abort()
                recorded["failed_abort_broken"] = abort_probe.broken
                recorded["abort_error"] = refused_abort.exception
                with inner.assertRaises(InertWorkerBaseException) as worker_fault:
                    abort_probe.wait()
                recorded["worker_fault"] = worker_fault.exception
                abort_probe.abort()
                with inner.assertRaises(stdlib_threading.BrokenBarrierError):
                    abort_probe.wait()
                recorded["abort_facade"] = abort_facade
                recorded["abort_probe"] = abort_probe

                broken_facade = InertThreadingFacade(worker_fault_ordinal=1, fail_abort_index=1)
                broken_probe = broken_facade.Barrier(2)
                broken_probe.abort()
                with inner.assertRaises(stdlib_threading.BrokenBarrierError):
                    broken_probe.wait()
                with inner.assertRaises(InjectedCleanupFailure):
                    broken_probe.abort()
                recorded["failed_abort_preserved_break"] = broken_probe.broken
                with inner.assertRaises(stdlib_threading.BrokenBarrierError):
                    broken_probe.wait()
                recorded["broken_facade"] = broken_facade
                recorded["broken_probe"] = broken_probe

                # The live ledgers are deliberately left in place: each tripped layer
                # reports its own cleanup failure, and the intentional body failure
                # must neither silence that evidence nor stop the remaining
                # restorations.
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
        self.assertEqual((recorded["request_guard_after_upper"], recorded["request_floor_after_upper"]), (1, 0))
        self.assertEqual((recorded["request_guard_after_floor"], recorded["request_floor_after_floor"]), (1, 1))
        self.assertEqual((recorded["thread_guard_after_upper"], recorded["thread_floor_after_upper"]), (1, 0))
        self.assertEqual((recorded["thread_guard_after_floor"], recorded["thread_floor_after_floor"]), (1, 1))
        # The lower floor refused instead of the original: nothing was launched.
        self.assertIsNone(recorded["probe_thread_ident"])
        self.assertFalse(recorded["probe_thread_alive"])
        # The visible attribute is the guard, and the floor is a distinct layer under it.
        self.assertIsNot(recorded["installed_request"], recorded["request_floor"])
        self.assertIsNot(recorded["installed_thread_start"], recorded["thread_floor"])
        self.assertIsNot(recorded["installed_request"], before[0])
        self.assertIsNot(recorded["installed_thread_start"], before[1])
        self.assertIs(recorded["installed_threading"], recorded["facade"])
        # Facade discrimination: an owned worker runs inline and reports identity 0,
        # an unstarted owned worker reports no identity, and no worker failure
        # escaped because the fake never raises inside the test runner.
        self.assertEqual(recorded["facade_owned_indexes"], [0, 1])
        self.assertEqual(recorded["facade_started_ident"], 0)
        self.assertTrue(recorded["facade_started_alive"])
        self.assertIsNone(recorded["facade_unstarted_ident"])
        self.assertFalse(recorded["facade_unstarted_alive"])
        self.assertEqual(recorded["facade_uncaught_errors"], [])
        # A refused abort never fabricates release or clears an earlier break.
        # Every late wait counts, but no unraised worker fault enters its ledger.
        self.assertFalse(recorded["failed_abort_broken"])
        self.assertTrue(recorded["failed_abort_preserved_break"])
        abort_facade = recorded["abort_facade"]
        abort_probe = recorded["abort_probe"]
        self.assertEqual(abort_facade.abort_failures, [recorded["abort_error"]])
        self.assertEqual(abort_facade.worker_faults, [recorded["worker_fault"]])
        self.assertTrue(abort_probe.broken)
        self.assertEqual((abort_probe.abort_calls, abort_facade.abort_attempts), (2, 2))
        self.assertEqual((abort_probe.wait_calls, abort_facade.wait_ordinal), (2, 2))
        self.assertEqual(abort_probe.refused_waits, [1])
        self.assertEqual(abort_probe.wait_results, [])
        broken_facade = recorded["broken_facade"]
        broken_probe = recorded["broken_probe"]
        self.assertEqual(len(broken_facade.abort_failures), 1)
        self.assertEqual(broken_facade.worker_faults, [])
        self.assertEqual((broken_probe.abort_calls, broken_facade.abort_attempts), (2, 2))
        self.assertEqual((broken_probe.wait_calls, broken_facade.wait_ordinal), (2, 2))
        self.assertEqual(broken_probe.refused_waits, [0, 1])
        self.assertEqual(broken_probe.wait_results, [])
        # The active-binding check and the attempts check each ran while their own
        # layer was still installed, in the reverse order the layers were installed,
        # and each layer was restored only after both checks had already observed it
        # as active. The identity checks pass here; only the attempts checks trip, so
        # this ordering stays evidence instead of a second failure count.
        self.assertEqual(
            probe.cleanup_order,
            [
                ("binding_checked", THREAD_START_GUARD_REFUSAL, True),
                ("attempts_checked", THREAD_START_GUARD_REFUSAL, True),
                ("restored", THREAD_START_GUARD_REFUSAL),
                ("binding_checked", THREAD_FLOOR_REFUSAL, True),
                ("attempts_checked", THREAD_FLOOR_REFUSAL, True),
                ("restored", THREAD_FLOOR_REFUSAL),
                ("binding_checked", REQUEST_GUARD_REFUSAL, True),
                ("attempts_checked", REQUEST_GUARD_REFUSAL, True),
                ("restored", REQUEST_GUARD_REFUSAL),
                ("binding_checked", REQUEST_FLOOR_REFUSAL, True),
                ("attempts_checked", REQUEST_FLOOR_REFUSAL, True),
                ("restored", REQUEST_FLOOR_REFUSAL),
            ],
            rendered,
        )
        # Every patch, including the pairing module's threading binding, is restored
        # to exactly the object that was installed before this test touched anything.
        self.assertIs(requests.Session.request, before[0])
        self.assertIs(stdlib_threading.Thread.start, before[1])
        self.assertIs(pairing_tests.threading, before[2])


class RacingClaimsCleanupTests(PairingCleanupHarnessTestCase):
    """Complete-result control for the two-worker claim race."""

    def test_healthy_claim_race_still_completes_without_any_injected_fault(self):
        """The unchanged two-worker claim race still produces its complete result.

        Nothing is injected: the real method runs against the inert instrument and
        must still satisfy every one of its own business assertions before any defect
        of its cleanup path is claimed.
        """
        self.assert_healthy_race(CLAIMS_METHOD, CLAIM_WORKERS)

    def test_failed_first_claim_launch_is_preserved_and_abandons_nothing(self):
        """A first launch that fails before any worker started is carried out unchanged.

        Nothing else can go wrong in this run: no worker started, so there is no worker
        to join and no worker to observe. Whether the method also breaks the rendezvous
        it can never complete is left open -- with nothing started there is nothing to
        join, so an abort is permitted but not required. The one reported exception must
        still be the very object the instrument refused with, and the run must have
        abandoned nothing on its way out.
        """
        facade, result = self.run_race(CLAIMS_METHOD, fail_start_index=0)
        failure = self.assert_launch_evidence(facade, workers=CLAIM_WORKERS, fail_index=0)
        self.assertEqual(self.started_threads(facade), [], "a refused first launch must leave no worker running")
        self.assertEqual(facade.unstarted_join_attempts(), 0, "no unstarted worker may be joined")
        self.assertEqual(self.event_positions(facade, "thread_join"), [], "nothing started, so nothing is joined")
        self.assertEqual(self.observed_liveness(facade), [], "nothing started, so nothing is observed")
        self.assertEqual(len(facade.barriers), 1, "the unchanged method still creates its one rendezvous")
        self.assertEqual(facade.barriers[0].wait_calls, 0, "no party may have reached the rendezvous")
        self.assertEqual(facade.barriers[0].wait_timeouts, [], "an empty rendezvous must record no wait input")
        self.assert_no_escape(facade)
        self.assert_facade_contract(facade)
        error = self.assert_single_report(result, "error")
        self.assertIs(error, failure, "the sole launch failure must be the very object that was refused")
        self.assertIsInstance(error, InjectedLaunchFailure, "the injected type must be preserved")
        self.assertEqual(str(error), f"{INJECTED_START_FAILURE} 1")

    def test_failed_second_claim_launch_joins_the_started_worker_before_reporting(self):
        """A launch that fails while a worker is already running must still clean up.

        The refusal is the only cause the run reports, but it is not the only thing that
        happened: the first worker started, the rendezvous can therefore never gather
        all of its parties, and that worker is still owned by the run. The contract is
        that the run breaks the rendezvous it can no longer complete and joins and
        observes the worker it started before it reports anything, and that the report
        then carries the very refusal out unchanged.
        """
        facade, result = self.run_race(CLAIMS_METHOD, fail_start_index=1)
        failure = self.assert_launch_evidence(facade, workers=CLAIM_WORKERS, fail_index=1)
        self.assertEqual(
            [thread.index for thread in self.started_threads(facade)],
            [0],
            "only the workers launched before the refusal may have started",
        )
        self.assertEqual(facade.unstarted_join_attempts(), 0, "no unstarted worker may be joined")
        self.assert_race_cleanup_contract(
            facade,
            context="a failed second launch must still clean up the worker it started",
            require_abort=True,
        )
        error = self.assert_single_report(result, "error")
        self.assertIs(error, failure, "the sole launch failure must be the very object that was refused")

    def test_uncaught_claim_worker_failure_reaches_an_outcome_channel(self):
        """A worker failure that escapes its target must reach the run's report.

        The worker raises a ``BaseException`` from outside the method's own handler, so
        the method cannot catch it as a domain refusal. The contract is that the run
        reports that failure instead of completing as if every business assertion had
        held, and that the instrument is never left holding it.
        """
        facade, result = self.run_race(CLAIMS_METHOD, worker_fault_ordinal=0)
        self.assert_worker_fault_evidence(facade, ordinal=0)
        self.assert_race_cleanup_contract(
            facade,
            context="a worker failure must be reported without abandoning the other worker",
            require_abort=True,
        )
        error = self.assert_single_report(result, "failure")
        self.assertIn(INJECTED_WORKER_MARKER, str(error))

    def test_claim_survivor_is_reported_only_after_joins_and_liveness_observations(self):
        """A worker that survives its join must be reported as a liveness defect.

        Both workers complete the rendezvous, so no abort is required here. What is
        required is that every worker is joined and actually asked about its liveness
        first, and that the reported message says so.
        """
        facade, result = self.run_race(CLAIMS_METHOD, join_survivor_index=0)
        self.assertEqual(
            [event[1] for event in facade.timeline if event[0] == "join_observed_alive_state"],
            [0, 1],
            "both workers must be joined exactly once",
        )
        self.assert_race_cleanup_contract(
            facade,
            context="a surviving worker must be reported after every join and every liveness observation",
        )
        error = self.assert_single_report(result, "failure")
        self.assertIn(LIVENESS_CATEGORY, str(error))

    def test_failed_claim_launch_with_a_survivor_reports_both_causes_once(self):
        """A failed launch and a surviving worker must both appear in the single report.

        Two independent causes exist at once. ``unittest`` reports one outcome per test,
        so the contract is that the one reported failure names both, not that whichever
        came first silently hides the other.
        """
        facade, result = self.run_race(CLAIMS_METHOD, fail_start_index=1, join_survivor_index=0)
        self.assert_launch_evidence(facade, workers=CLAIM_WORKERS, fail_index=1)
        self.assert_race_cleanup_contract(
            facade,
            context="a failed launch and a surviving worker must be reported together",
            require_abort=True,
        )
        error = self.assert_single_report(result, "failure")
        self.assertIn(INJECTED_START_FAILURE, str(error))
        self.assertIn(LIVENESS_CATEGORY, str(error))

    def test_failed_claim_launch_and_worker_failure_are_both_reported_once(self):
        """A failed launch and an escaped worker failure must both appear once.

        The instrument reserved one launch refusal and one worker failure, and the run
        must carry both causes into its single report.
        """
        facade, result = self.run_race(CLAIMS_METHOD, fail_start_index=1, worker_fault_ordinal=0)
        self.assert_launch_evidence(facade, workers=CLAIM_WORKERS, fail_index=1)
        self.assert_worker_fault_evidence(facade, ordinal=0)
        self.assert_race_cleanup_contract(
            facade,
            context="a failed launch and an escaped worker failure must be reported together",
            require_abort=True,
        )
        error = self.assert_single_report(result, "failure")
        self.assertIn(INJECTED_START_FAILURE, str(error))
        self.assertIn(INJECTED_WORKER_MARKER, str(error))

    def test_claim_rendezvous_and_joins_stay_bounded(self):
        """A complete claim race must bound both its rendezvous and its joins.

        Nothing is injected, so the method's own business assertions still decide whether
        the run is complete; this regression only tightens the instrument record such a
        run must leave behind.
        """
        facade, result = self.run_race(CLAIMS_METHOD)
        self.assert_race_cleanup_contract(facade, context="the bounded claim race must complete cleanup")
        self.assertEqual(len(facade.barriers), 1, "the unchanged method uses exactly one rendezvous")
        self.assert_every_wait_is_bounded(facade.barriers[0])
        self.assert_bounded(
            [timeout for thread in self.started_threads(facade) for timeout in thread.join_timeouts],
            "every join must carry a finite positive bound",
        )
        self.assert_single_report(result, "success")


class RacingConfirmsCleanupTests(PairingCleanupHarnessTestCase):
    """Complete-result control for the two-worker confirm race."""

    def test_healthy_confirm_race_still_completes_without_any_injected_fault(self):
        """The unchanged two-worker confirm race still produces its complete result.

        Nothing is injected: the real method runs against the inert instrument and
        must still satisfy every one of its own business assertions before any defect
        of its cleanup path is claimed.
        """
        self.assert_healthy_race(CONFIRMS_METHOD, CONFIRM_WORKERS)

    def test_failed_first_confirm_launch_is_preserved_and_abandons_nothing(self):
        """A first launch that fails before any worker started is carried out unchanged.

        No worker started, so there is no worker to join and no worker to observe.
        Whether the method also breaks the rendezvous it can never complete is left
        open: with nothing started there is nothing to join, so an abort is permitted
        but not required. The one reported exception must still be the very object the
        instrument refused with, and the run must have abandoned nothing on its way out.
        """
        facade, result = self.run_race(CONFIRMS_METHOD, fail_start_index=0)
        failure = self.assert_launch_evidence(facade, workers=CONFIRM_WORKERS, fail_index=0)
        self.assertEqual(self.started_threads(facade), [], "a refused first launch must leave no worker running")
        self.assertEqual(facade.unstarted_join_attempts(), 0, "no unstarted worker may be joined")
        self.assertEqual(self.event_positions(facade, "thread_join"), [], "nothing started, so nothing is joined")
        self.assertEqual(self.observed_liveness(facade), [], "nothing started, so nothing is observed")
        self.assertEqual(len(facade.barriers), 1, "the unchanged method still creates its one rendezvous")
        self.assertEqual(facade.barriers[0].wait_calls, 0, "no party may have reached the rendezvous")
        self.assertEqual(facade.barriers[0].wait_timeouts, [], "an empty rendezvous must record no wait input")
        self.assert_no_escape(facade)
        self.assert_facade_contract(facade)
        error = self.assert_single_report(result, "error")
        self.assertIs(error, failure, "the sole launch failure must be the very object that was refused")
        self.assertIsInstance(error, InjectedLaunchFailure, "the injected type must be preserved")
        self.assertEqual(str(error), f"{INJECTED_START_FAILURE} 1")

    def test_failed_second_confirm_launch_joins_the_started_worker_before_reporting(self):
        """A launch that fails while a worker is already running must still clean up.

        The refusal is the only cause the run reports, but it is not the only thing that
        happened: the first worker started, the rendezvous can therefore never gather
        all of its parties, and that worker is still owned by the run. The contract is
        that the run breaks the rendezvous it can no longer complete and joins and
        observes the worker it started before it reports anything, and that the report
        then carries the very refusal out unchanged.
        """
        facade, result = self.run_race(CONFIRMS_METHOD, fail_start_index=1)
        failure = self.assert_launch_evidence(facade, workers=CONFIRM_WORKERS, fail_index=1)
        self.assertEqual(
            [thread.index for thread in self.started_threads(facade)],
            [0],
            "only the workers launched before the refusal may have started",
        )
        self.assertEqual(facade.unstarted_join_attempts(), 0, "no unstarted worker may be joined")
        self.assert_race_cleanup_contract(
            facade,
            context="a failed second launch must still clean up the worker it started",
            require_abort=True,
        )
        error = self.assert_single_report(result, "error")
        self.assertIs(error, failure, "the sole launch failure must be the very object that was refused")

    def test_uncaught_confirm_worker_failure_reaches_an_outcome_channel(self):
        """A worker failure that escapes its target must reach the run's report.

        The worker raises a ``BaseException`` from outside the method's own handler, so
        the method cannot catch it as a domain refusal. The contract is that the run
        reports that failure instead of completing as if every business assertion had
        held, and that the instrument is never left holding it.
        """
        facade, result = self.run_race(CONFIRMS_METHOD, worker_fault_ordinal=0)
        self.assert_worker_fault_evidence(facade, ordinal=0)
        self.assert_race_cleanup_contract(
            facade,
            context="a worker failure must be reported without abandoning the other worker",
            require_abort=True,
        )
        error = self.assert_single_report(result, "failure")
        self.assertIn(INJECTED_WORKER_MARKER, str(error))

    def test_confirm_survivor_is_reported_only_after_joins_and_liveness_observations(self):
        """A worker that survives its join must be reported as a liveness defect.

        Both workers complete the rendezvous, so no abort is required here. What is
        required is that every worker is joined and actually asked about its liveness
        first, and that the reported message says so.
        """
        facade, result = self.run_race(CONFIRMS_METHOD, join_survivor_index=0)
        self.assertEqual(
            [event[1] for event in facade.timeline if event[0] == "join_observed_alive_state"],
            [0, 1],
            "both workers must be joined exactly once",
        )
        self.assert_race_cleanup_contract(
            facade,
            context="a surviving worker must be reported after every join and every liveness observation",
        )
        error = self.assert_single_report(result, "failure")
        self.assertIn(LIVENESS_CATEGORY, str(error))

    def test_failed_confirm_launch_with_a_survivor_reports_both_causes_once(self):
        """A failed launch and a surviving worker must both appear in the single report.

        Two independent causes exist at once. ``unittest`` reports one outcome per test,
        so the contract is that the one reported failure names both, not that whichever
        came first silently hides the other.
        """
        facade, result = self.run_race(CONFIRMS_METHOD, fail_start_index=1, join_survivor_index=0)
        self.assert_launch_evidence(facade, workers=CONFIRM_WORKERS, fail_index=1)
        self.assert_race_cleanup_contract(
            facade,
            context="a failed launch and a surviving worker must be reported together",
            require_abort=True,
        )
        error = self.assert_single_report(result, "failure")
        self.assertIn(INJECTED_START_FAILURE, str(error))
        self.assertIn(LIVENESS_CATEGORY, str(error))

    def test_failed_confirm_launch_and_worker_failure_are_both_reported_once(self):
        """A failed launch and an escaped worker failure must both appear once.

        The instrument reserved one launch refusal and one worker failure, and the run
        must carry both causes into its single report.
        """
        facade, result = self.run_race(CONFIRMS_METHOD, fail_start_index=1, worker_fault_ordinal=0)
        self.assert_launch_evidence(facade, workers=CONFIRM_WORKERS, fail_index=1)
        self.assert_worker_fault_evidence(facade, ordinal=0)
        self.assert_race_cleanup_contract(
            facade,
            context="a failed launch and an escaped worker failure must be reported together",
            require_abort=True,
        )
        error = self.assert_single_report(result, "failure")
        self.assertIn(INJECTED_START_FAILURE, str(error))
        self.assertIn(INJECTED_WORKER_MARKER, str(error))

    def test_confirm_rendezvous_and_joins_stay_bounded(self):
        """A complete confirm race must bound both its rendezvous and its joins.

        Nothing is injected, so the method's own business assertions still decide whether
        the run is complete; this regression only tightens the instrument record such a
        run must leave behind.
        """
        facade, result = self.run_race(CONFIRMS_METHOD)
        self.assert_race_cleanup_contract(facade, context="the bounded confirm race must complete cleanup")
        self.assertEqual(len(facade.barriers), 1, "the unchanged method uses exactly one rendezvous")
        self.assert_every_wait_is_bounded(facade.barriers[0])
        self.assert_bounded(
            [timeout for thread in self.started_threads(facade) for timeout in thread.join_timeouts],
            "every join must carry a finite positive bound",
        )
        self.assert_single_report(result, "success")


class RacingIssueQrCleanupTests(PairingCleanupHarnessTestCase):
    """Complete-result control for the four-worker issue-qr race."""

    def test_healthy_issue_race_still_completes_without_any_injected_fault(self):
        """The unchanged four-worker issue-qr race still produces its complete result.

        Nothing is injected: the real method runs against the inert instrument and
        must still satisfy every one of its own business assertions before any defect
        of its cleanup path is claimed.
        """
        self.assert_healthy_race(ISSUE_QR_METHOD, ISSUE_WORKERS)

    def test_failed_first_issue_launch_is_preserved_and_abandons_nothing(self):
        """A first launch that fails before any worker started is carried out unchanged.

        No worker started, so there is no worker to join and no worker to observe.
        Whether the method also breaks the rendezvous it can never complete is left
        open: with nothing started there is nothing to join, so an abort is permitted
        but not required. The one reported exception must still be the very object the
        instrument refused with, and the run must have abandoned nothing on its way out.
        """
        facade, result = self.run_race(ISSUE_QR_METHOD, fail_start_index=0)
        failure = self.assert_launch_evidence(facade, workers=ISSUE_WORKERS, fail_index=0)
        self.assertEqual(self.started_threads(facade), [], "a refused first launch must leave no worker running")
        self.assertEqual(facade.unstarted_join_attempts(), 0, "no unstarted worker may be joined")
        self.assertEqual(self.event_positions(facade, "thread_join"), [], "nothing started, so nothing is joined")
        self.assertEqual(self.observed_liveness(facade), [], "nothing started, so nothing is observed")
        self.assertEqual(len(facade.barriers), 1, "the unchanged method still creates its one rendezvous")
        self.assertEqual(facade.barriers[0].wait_calls, 0, "no party may have reached the rendezvous")
        self.assertEqual(facade.barriers[0].wait_timeouts, [], "an empty rendezvous must record no wait input")
        self.assert_no_escape(facade)
        self.assert_facade_contract(facade)
        error = self.assert_single_report(result, "error")
        self.assertIs(error, failure, "the sole launch failure must be the very object that was refused")
        self.assertIsInstance(error, InjectedLaunchFailure, "the injected type must be preserved")
        self.assertEqual(str(error), f"{INJECTED_START_FAILURE} 1")

    def _assert_partial_issue_launch(self, fail_index):
        """A refused launch at ``fail_index`` must still join every worker it started.

        The refused launch means the rendezvous can never gather all of its parties, so
        the method must break it before joining. What this helper demands is that every
        started worker is joined and observed, that the abort precedes the first join,
        and that the report then carries the very refusal out unchanged.
        """
        facade, result = self.run_race(ISSUE_QR_METHOD, fail_start_index=fail_index)
        failure = self.assert_launch_evidence(facade, workers=ISSUE_WORKERS, fail_index=fail_index)
        self.assertEqual(
            [thread.index for thread in self.started_threads(facade)],
            list(range(fail_index)),
            "only the workers launched before the refusal may have started",
        )
        self.assertEqual(facade.unstarted_join_attempts(), 0, "no unstarted worker may be joined")
        self.assert_race_cleanup_contract(
            facade,
            context=f"a launch refused at worker {fail_index + 1} must still clean up every worker it started",
            require_abort=True,
        )
        error = self.assert_single_report(result, "error")
        self.assertIs(error, failure, "the sole launch failure must be the very object that was refused")

    def test_failed_second_issue_launch_joins_every_started_worker_before_reporting(self):
        """A refusal on the second of four launches must not abandon the first worker."""
        self._assert_partial_issue_launch(1)

    def test_failed_third_issue_launch_joins_every_started_worker_before_reporting(self):
        """A refusal on the third of four launches must not abandon the first two workers."""
        self._assert_partial_issue_launch(2)

    def test_failed_fourth_issue_launch_joins_every_started_worker_before_reporting(self):
        """A refusal on the fourth of four launches must not abandon the first three workers."""
        self._assert_partial_issue_launch(3)

    def test_uncaught_issue_worker_failure_reaches_an_outcome_channel(self):
        """A worker failure that escapes its target must reach the run's report.

        The four-worker race has no handler around its registry call at all, so a
        failure raised from outside it can only reach the run through the outcome
        channel. The contract is that the run reports it instead of completing as if its
        business assertions had held, and that the instrument is never left holding it.
        """
        facade, result = self.run_race(ISSUE_QR_METHOD, worker_fault_ordinal=0)
        self.assert_worker_fault_evidence(facade, ordinal=0)
        self.assert_race_cleanup_contract(
            facade,
            context="a worker failure must be reported without abandoning the other workers",
            require_abort=True,
        )
        error = self.assert_single_report(result, "failure")
        self.assertIn(INJECTED_WORKER_MARKER, str(error))

    def test_issue_survivor_is_reported_only_after_joins_and_liveness_observations(self):
        """A worker that survives its join must be reported as a liveness defect.

        All four workers complete the rendezvous, so no abort is required here. What is
        required is that every worker is joined and actually asked about its liveness
        first, and that the reported message says so.
        """
        facade, result = self.run_race(ISSUE_QR_METHOD, join_survivor_index=0)
        self.assertEqual(
            [event[1] for event in facade.timeline if event[0] == "join_observed_alive_state"],
            [0, 1, 2, 3],
            "all four workers must be joined exactly once",
        )
        self.assert_race_cleanup_contract(
            facade,
            context="a surviving worker must be reported after every join and every liveness observation",
        )
        error = self.assert_single_report(result, "failure")
        self.assertIn(LIVENESS_CATEGORY, str(error))

    def test_failed_issue_launch_with_a_survivor_reports_both_causes_once(self):
        """A failed fourth launch and a surviving worker must both appear once."""
        facade, result = self.run_race(ISSUE_QR_METHOD, fail_start_index=3, join_survivor_index=0)
        self.assert_launch_evidence(facade, workers=ISSUE_WORKERS, fail_index=3)
        self.assert_race_cleanup_contract(
            facade,
            context="a failed launch and a surviving worker must be reported together",
            require_abort=True,
        )
        error = self.assert_single_report(result, "failure")
        self.assertIn(INJECTED_START_FAILURE, str(error))
        self.assertIn(LIVENESS_CATEGORY, str(error))

    def test_failed_issue_launch_and_worker_failure_are_both_reported_once(self):
        """A failed fourth launch and an earlier escaped worker failure must both appear once."""
        facade, result = self.run_race(ISSUE_QR_METHOD, worker_fault_ordinal=2, fail_start_index=3)
        self.assert_launch_evidence(facade, workers=ISSUE_WORKERS, fail_index=3)
        self.assert_worker_fault_evidence(facade, ordinal=2)
        self.assert_race_cleanup_contract(
            facade,
            context="a failed launch and an escaped worker failure must be reported together",
            require_abort=True,
        )
        error = self.assert_single_report(result, "failure")
        self.assertIn(INJECTED_START_FAILURE, str(error))
        self.assertIn(INJECTED_WORKER_MARKER, str(error))

    def test_issue_rendezvous_and_joins_stay_bounded(self):
        """A complete four-worker issue race must bound its rendezvous and its joins.

        Nothing is injected, so the method's own business assertions still decide whether
        the run is complete; this regression only tightens the instrument record such a
        run must leave behind.
        """
        facade, result = self.run_race(ISSUE_QR_METHOD)
        self.assert_race_cleanup_contract(facade, context="the bounded issue race must complete cleanup")
        self.assertEqual(len(facade.barriers), 1, "the unchanged method uses exactly one rendezvous")
        self.assert_every_wait_is_bounded(facade.barriers[0])
        self.assert_bounded(
            [timeout for thread in self.started_threads(facade) for timeout in thread.join_timeouts],
            "every join must carry a finite positive bound",
        )
        self.assert_single_report(result, "success")

    def test_a_failing_join_is_reported_as_a_cleanup_cause_without_abandoning_workers(self):
        """A refused join must be reported as a cleanup cause, and the joins must continue.

        The refusal is reserved by the instrument, so the caller proves it happened from
        its own ledger instead of the message. Refusing one join must not stop the joins
        that come after it, and every started worker must still be observed after all
        the attempts have been made and before anything is reported. The one report must
        therefore keep both the marker of the refused join and the liveness category the
        run also left behind.
        """
        facade, result = self.run_race(ISSUE_QR_METHOD, fail_join_index=0)
        started = self.started_threads(facade)
        self.assertEqual(len(started), ISSUE_WORKERS, "every declared worker must have started")
        self.assertEqual(
            [str(failure) for failure in facade.join_failures],
            [f"{INJECTED_JOIN_CLEANUP_ERROR} 1"],
            "exactly one join refusal must be reserved, counted by attempt",
        )
        self.assertEqual(
            [thread.join_calls for thread in facade.threads],
            [1] * ISSUE_WORKERS,
            "a refused join must not stop the remaining workers from being joined",
        )
        self.assert_bounded(
            [timeout for thread in started for timeout in thread.join_timeouts],
            "every join attempt must carry a finite positive bound even after a refusal",
        )
        self.assertEqual(facade.unstarted_join_attempts(), 0, "no unstarted worker may be joined")
        self.assert_race_cleanup_contract(
            facade, context="a refused join must not suppress any remaining cleanup obligation"
        )
        self.assertIn((0, True), self.observed_liveness(facade), "the refused first join must leave observed liveness")
        error = self.assert_single_report(result, "failure")
        self.assertIn(INJECTED_JOIN_CLEANUP_ERROR, str(error))
        self.assertIn(LIVENESS_CATEGORY, str(error))

    def test_a_failing_abort_after_a_partial_launch_still_joins_and_reports_both_causes(self):
        """A refused abort must not hide the launch failure or the workers left running.

        The launch is refused on the third of four workers, so two workers started and
        the rendezvous can never complete. The instrument then refuses the abort as well.
        Both causes must appear in the single report, the abort attempt must precede the
        joins, and every started worker must still be joined and observed.
        """
        facade, result = self.run_race(ISSUE_QR_METHOD, fail_start_index=2, fail_abort_index=0)
        self.assert_launch_evidence(facade, workers=ISSUE_WORKERS, fail_index=2)
        self.assertEqual(
            [thread.index for thread in self.started_threads(facade)],
            [0, 1],
            "exactly the workers launched before the refusal may have started",
        )
        self.assertEqual(
            [str(failure) for failure in facade.abort_failures],
            [f"{INJECTED_ABORT_FAILURE} 1"],
            "exactly one abort refusal must be reserved, counted by attempt",
        )
        self.assert_race_cleanup_contract(
            facade,
            context="a refused abort must not hide the launch failure or abandon a started worker",
            require_abort=True,
        )
        error = self.assert_single_report(result, "failure")
        self.assertIn(INJECTED_START_FAILURE, str(error))
        self.assertIn(INJECTED_ABORT_FAILURE, str(error))


if __name__ == "__main__":
    unittest.main()
