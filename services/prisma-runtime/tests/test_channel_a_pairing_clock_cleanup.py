"""Inert fault-unwind proof, not a healthy clock-interleaving simulation.

The original clock test assertions execute unchanged. A transparent gate observer
records entry attempts, exceptions and normal returns, NOT inner acquire attempts.
The False-return contract also requires a later static guard-before-acquire check.
The tested helper in ``test_channel_a_pairing.py`` now also rejects a failed gate
wait with a truthful TimeoutError; no expectation in this module changed.
"""

if __package__:
    from . import test_channel_a_pairing_cleanup as harness
else:
    import test_channel_a_pairing_cleanup as harness


CLAIM = "test_clock_is_sampled_inside_the_lock_so_claim_at_exact_expiry_is_rejected"
DELAYED = "test_delayed_touch_cannot_overwrite_a_newer_committed_activity"
WORKER_MARKER = "PRISMA_PAIRING_CLOCK_INJECTED_GATE_WAIT_FAILURE"
MAIN_MARKER = "PRISMA_PAIRING_CLOCK_INJECTED_MAIN_WAIT_FAILURE"
SET_MARKER = "PRISMA_PAIRING_CLOCK_INJECTED_RELEASE_SET_FAILURE"


class InjectedGateWaitFailure(BaseException):
    """A worker control-flow failure, deliberately not an Exception."""


class InjectedMainWaitFailure(Exception):
    """A distinct failure of MAIN's entered-event wait."""


class InjectedReleaseSetFailure(Exception):
    """A release attempt that leaves the previous flag untouched."""


class ClockEvent:
    """Two explicit event roles with nonblocking waits and persistent evidence."""

    def __init__(self, facade, index):
        self.facade = facade
        self.index = index
        self.flag = False
        self.counts = {operation: 0 for operation in ("clear", "set", "wait")}
        self.error_counts = dict(self.counts)
        self.attempts = {operation: [] for operation in self.counts}
        self.returns = {operation: [] for operation in self.counts}
        self.errors = {operation: [] for operation in self.counts}

    def record_attempt(self, operation, timeout=None):
        actor = self.facade.current_thread()
        self.counts[operation] += 1
        self.attempts[operation].append((actor, self.flag, timeout))
        self.facade.timeline.append(("event_attempt", self.index, operation, actor, self.flag, timeout))

    def record_return(self, operation, value):
        self.returns[operation].append((self.facade.current_thread(), self.flag, value))
        self.facade.timeline.append(("event_return", self.index, operation, self.flag, value))
        return value

    def record_error(self, operation, error):
        self.error_counts[operation] += 1
        self.errors[operation].append(error)
        self.facade.timeline.append(("event_error", self.index, operation, error))

    def clear(self):
        self.record_attempt("clear")
        self.flag = False
        return self.record_return("clear", None)

    def set(self):
        self.record_attempt("set")
        if self.index == 1 and self.counts["set"] == self.facade.fail_release_set_attempt:
            error = InjectedReleaseSetFailure(SET_MARKER)
            self.record_error("set", error)
            raise error
        self.flag = True
        return self.record_return("set", None)

    def wait(self, timeout=None):
        self.record_attempt("wait", timeout)
        error = None
        if self.index == 0 and self.facade.fail_main_wait and self.facade.current_thread() is self.facade.main_identity:
            error = InjectedMainWaitFailure(MAIN_MARKER)
        elif self.index == 1 and not self.flag and not self.facade.release_wait_false:
            error = InjectedGateWaitFailure(WORKER_MARKER)
        if error is not None:
            self.record_error("wait", error)
            raise error
        return self.record_return("wait", self.flag)


class ClockThreadingFacade(harness.InertThreadingFacade):
    """Keep inherited Thread/start/join semantics; add identity and two events."""

    def __init__(self, *, fail_main_wait=False, fail_release_set_attempt=None,
                 release_wait_false=False, **options):
        super().__init__(**options)
        self.fail_main_wait = fail_main_wait
        self.fail_release_set_attempt = fail_release_set_attempt
        self.release_wait_false = release_wait_false
        self.main_identity = object()
        self.current_identity = self.main_identity
        self.events = []
        self.gates = []
        self.callback_calls = []
        self.callback_returns = []
        self.callback_errors = []

    def current_thread(self):
        return self.current_identity

    def Event(self):
        event = ClockEvent(self, len(self.events))
        self.events.append(event)
        return event

    def Thread(self, target=None, args=(), kwargs=None, name=None, **extra):
        def invoke(*values, **keywords):
            previous = self.current_identity
            self.current_identity = thread
            self.callback_calls.append((thread, values, keywords))
            try:
                value = target(*values, **keywords)
            except BaseException as error:
                self.callback_errors.append((thread, error))
                raise
            else:
                self.callback_returns.append((thread, value))
                return value
            finally:
                self.current_identity = previous

        thread = super().Thread(target=invoke, args=args, kwargs=kwargs, name=name, **extra)
        return thread


def install_gate_observer(case, facade):
    original = harness.pairing_tests._GatedLock

    class ObservedGate(original):
        def __init__(self, inner):
            super().__init__(inner)
            self.entry_attempts = []
            self.entry_errors = []
            self.admissions = []
            facade.gates.append(self)

        def __enter__(self):
            actor, held = facade.current_thread(), self._held_thread
            self.entry_attempts.append((actor, held))
            facade.timeline.append(("gate_entry", actor, held))
            try:
                value = super().__enter__()
            except BaseException as error:
                self.entry_errors.append((actor, held, error))
                facade.timeline.append(("gate_error", actor, held, error))
                raise
            else:
                self.admissions.append((actor, held, value))
                facade.timeline.append(("gate_admission", actor, held, value))
                return value

    harness.replace_module_attribute(
        case, name="_GatedLock", replacement=ObservedGate,
        message="the clock gate observer must remain installed",
    )


class ClockCleanupTests(harness.PairingCleanupHarnessTestCase):
    def run_clock(self, method_name, **options):
        facade = self.activate(ClockThreadingFacade(**options))
        install_gate_observer(self, facade)
        result = self.new_result(facade)
        case = harness.pairing_tests.ChannelAPairingClockDisciplineTests(method_name)
        case.run(result)
        self.assertEqual(result.testsRun, 1)
        self.assertIs(type(case), harness.pairing_tests.ChannelAPairingClockDisciplineTests)
        self.assertEqual(case.id().rsplit(".", 1)[-1], method_name)
        self.assertEqual(len(result.reports), 1)
        self.assertIs(result.reports[0][1], case)
        self.assertEqual(len(facade.threads), 1)
        self.assertEqual(len(facade.events), 2)
        self.assertEqual(len(facade.gates), 1)
        self.assertEqual(facade.barriers, [])
        owned = self.event_positions(facade, "thread_owned")
        starts = self.event_positions(facade, "thread_start_attempt")
        self.assertEqual(len(owned), 1)
        self.assertEqual(len(starts), 1)
        self.assertLess(owned[0], starts[0])
        worker = facade.threads[0]
        started = options.get("fail_start_index") is None
        self.assertEqual(worker.start_attempts, 1)
        self.assertEqual(worker.started, started)
        self.assertEqual(worker.ident, 0 if started else None)
        self.assertEqual(len(facade.callback_calls), 1 if started else 0)
        if started:
            self.assertIs(facade.callback_calls[0][0], worker)
        self.assertIs(facade.current_thread(), facade.main_identity)
        gate = facade.gates[0]
        self.assertIs(gate.entered, facade.events[0])
        self.assertIs(gate.release, facade.events[1])
        self.assert_event_ledgers(facade)
        for event in facade.events:
            self.assertEqual(event.counts["clear"], 1)
            self.assertEqual(event.returns["clear"], [(facade.main_identity, False, None)])
        return facade, result

    def assert_event_ledgers(self, facade):
        for event in facade.events:
            for operation in event.counts:
                self.assertEqual(event.counts[operation], len(event.attempts[operation]))
                self.assertEqual(event.error_counts[operation], len(event.errors[operation]))
                self.assertEqual(event.counts[operation],
                                 len(event.returns[operation]) + event.error_counts[operation])
            if event.counts["wait"]:
                self.assert_bounded([row[2] for row in event.attempts["wait"]], "event waits")
            for _, flag, returned in event.returns["wait"]:
                self.assertIs(type(returned), bool)
                self.assertIs(returned, flag)

    def assert_release_order(self, facade):
        releases = [index for index, row in enumerate(facade.timeline)
                    if row[:3] == ("event_attempt", 1, "set")]
        joins = self.event_positions(facade, "thread_join")
        reports = self.event_positions(facade, "nested_reported")
        self.assertTrue(releases, "release.set must be attempted even during failure unwind")
        self.assertTrue(joins, "the owned started worker must be joined")
        self.assertEqual(len(reports), 1)
        self.assertLess(min(releases), min(joins))
        self.assertLess(min(releases), reports[0])

    def assert_clock_cleanup(self, facade):
        violations = []
        for obligation in (
            self.assert_release_order,
            lambda value: self.assert_race_cleanup_contract(
                value, context="clock gate", require_abort=False),
        ):
            try:
                obligation(facade)
            except AssertionError as error:
                violations.append(str(error))
        if violations:
            self.fail("; ".join(violations))

    def assert_held_wait(self, facade):
        worker, gate = facade.threads[0], facade.gates[0]
        entered, release = facade.events
        self.assertEqual(release.counts["wait"], 1)
        actor, flag, _ = release.attempts["wait"][0]
        self.assertIs(actor, worker)
        self.assertIs(flag, False)
        self.assertEqual(entered.counts["set"], 1)
        self.assertEqual(entered.returns["set"], [(worker, True, None)])
        sets = [index for index, row in enumerate(facade.timeline)
                if row[:3] == ("event_return", 0, "set")]
        waits = [index for index, row in enumerate(facade.timeline)
                 if row[:3] == ("event_attempt", 1, "wait")]
        self.assertEqual(len(sets), 1)
        self.assertEqual(len(waits), 1)
        self.assertLess(sets[0], waits[0])
        self.assertEqual([row for row in gate.entry_attempts if row[0] is worker], [(worker, worker)])
        self.assertEqual([row for row in gate.admissions if row[0] is worker], [],
                         "a held worker must never be admitted after a failed wait")
        errors = [row[2] for row in gate.entry_errors if row[0] is worker and row[1] is worker]
        self.assertEqual(len(errors), 1)
        return errors[0]

    def assert_failure_causes(self, result, causes):
        error = self.assert_single_report(result, "failure")
        self.assertIsInstance(error, AssertionError)
        for cause in causes:
            self.assertIn(cause, str(error))

    def assert_first_launch(self, method_name):
        facade, result = self.run_clock(method_name, fail_start_index=0)
        error = self.assert_launch_evidence(facade, workers=1, fail_index=0)
        self.assertIs(type(error), harness.InjectedLaunchFailure)
        self.assertEqual(facade.callback_returns, [])
        self.assertEqual(facade.callback_errors, [])
        self.assertEqual(facade.gates[0].entry_attempts, [])
        self.assertEqual(facade.gates[0].admissions, [])
        self.assertEqual(facade.gates[0].entry_errors, [])
        self.assertEqual([event.counts["wait"] for event in facade.events], [0, 0])
        self.assertEqual(facade.join_attempts, 0)
        self.assertEqual(facade.threads[0].join_timeouts, [])
        self.assertEqual(facade.threads[0].liveness_checks, 0)
        self.assertEqual(self.event_positions(facade, "thread_join"), [])
        self.assertEqual(self.observed_liveness(facade), [])
        self.assert_no_unstarted_joins(facade)
        self.assert_facade_contract(facade)
        self.assert_no_escape(facade)
        reported = self.assert_single_report(result, "error")
        self.assertIs(reported, error)
        self.assertIs(type(reported), harness.InjectedLaunchFailure)

    def assert_fault_row(self, method_name, **options):
        facade, result = self.run_clock(method_name, **options)
        entered, release = facade.events
        self.assertEqual(release.error_counts["wait"], 1)
        self.assertEqual(len(release.errors["wait"]), 1)
        worker_error = release.errors["wait"][0]
        self.assertIs(type(worker_error), InjectedGateWaitFailure)
        self.assertNotIsInstance(worker_error, Exception)
        self.assertEqual(str(worker_error), WORKER_MARKER)
        self.assertEqual(release.returns["wait"], [])
        self.assertIs(self.assert_held_wait(facade), worker_error)
        causes = [WORKER_MARKER]
        if options.get("fail_main_wait"):
            self.assertEqual(entered.error_counts["wait"], 1)
            self.assertEqual(len(entered.errors["wait"]), 1)
            main_error = entered.errors["wait"][0]
            self.assertIs(type(main_error), InjectedMainWaitFailure)
            self.assertEqual(str(main_error), MAIN_MARKER)
            self.assertEqual(entered.counts["wait"], 1)
            self.assertIs(entered.attempts["wait"][0][0], facade.main_identity)
            gate = facade.gates[0]
            self.assertEqual([row for row in gate.entry_attempts if row[0] is facade.main_identity], [])
            self.assertEqual([row for row in gate.admissions if row[0] is facade.main_identity], [])
            causes.append(MAIN_MARKER)
        else:
            self.assertEqual(entered.errors["wait"], [])
        if options.get("fail_release_set_attempt") is not None:
            self.assertEqual(release.error_counts["set"], 1)
            self.assertEqual(len(release.errors["set"]), 1)
            self.assertIs(type(release.errors["set"][0]), InjectedReleaseSetFailure)
            self.assertEqual(str(release.errors["set"][0]), SET_MARKER)
            self.assertIs(release.attempts["set"][0][1], False)
            causes.append(SET_MARKER)
        else:
            self.assertEqual(release.errors["set"], [])
        if options.get("fail_join_index") is not None:
            self.assertEqual(len(facade.join_failures), 1)
            self.assertIs(type(facade.join_failures[0]), harness.InjectedCleanupFailure)
            self.assertEqual(str(facade.join_failures[0]), f"{harness.INJECTED_JOIN_CLEANUP_ERROR} 1")
            self.assertEqual(facade.threads[0].join_calls, 1)
            causes.extend([harness.INJECTED_JOIN_CLEANUP_ERROR, harness.LIVENESS_CATEGORY])
        else:
            self.assertEqual(facade.join_failures, [])
        if options.get("join_survivor_index") is not None:
            causes.append(harness.LIVENESS_CATEGORY)
        self.assert_clock_cleanup(facade)
        if options.get("fail_join_index") is not None:
            self.assertIn((0, True), self.observed_liveness(facade))
        self.assert_failure_causes(result, causes)

    def test_component_seams_preserve_identity_flags_and_evidence(self):
        facade = self.activate(ClockThreadingFacade())
        value, keyword, returned = object(), object(), object()
        thrown = InjectedGateWaitFailure("PRISMA_PAIRING_CLOCK_COMPONENT_CALLBACK_FAILURE")
        observations = []

        def succeeds(argument, *, named):
            observations.append((facade.current_thread(), argument, named))
            return returned

        def fails(argument, *, named):
            observations.append((facade.current_thread(), argument, named))
            raise thrown

        first = facade.Thread(target=succeeds, args=(value,), kwargs={"named": keyword})
        second = facade.Thread(target=fails, args=(value,), kwargs={"named": keyword})
        first.start()
        after_success = facade.current_thread()
        second.start()
        after_error = facade.current_thread()
        first.join(5)
        second.join(5)
        observed = [first.is_alive(), second.is_alive()]
        self.assertEqual(observed, [False, False])
        self.assertEqual(observations, [(first, value, keyword), (second, value, keyword)])
        self.assertEqual(facade.callback_calls,
                         [(first, (value,), {"named": keyword}), (second, (value,), {"named": keyword})])
        self.assertEqual(facade.callback_returns, [(first, returned)])
        self.assertEqual(facade.callback_errors, [(second, thrown)])
        self.assertIs(facade.callback_errors[0][1], thrown)
        self.assertEqual(facade.uncaught_errors, [thrown])
        self.assertIs(second.worker_error, thrown)
        self.assertIs(after_success, facade.main_identity)
        self.assertIs(after_error, facade.main_identity)
        # These are intentional primitive-probe errors, not SUT worker escapes.
        for attempts in (self.request_attempts, self.request_floor_attempts,
                         self.real_thread_attempts, self.thread_floor_attempts):
            self.assertEqual(attempts, [])
        self.assert_bounded_worker_joins(facade)
        self.assert_all_joins_precede_first_liveness(facade)
        self.assert_facade_contract(facade)

        for prior in (False, True):
            model = ClockThreadingFacade(fail_release_set_attempt=2 if prior else 1)
            entered, release = model.Event(), model.Event()
            self.assertIs(entered.wait(5), False)
            entered.set()
            self.assertIs(entered.wait(5), True)
            entered.clear()
            self.assertIs(entered.wait(5), False)
            if prior:
                release.set()
            with self.assertRaises(InjectedReleaseSetFailure) as caught:
                release.set()
            self.assertIs(release.flag, prior)
            self.assertEqual(release.error_counts["set"], 1)
            self.assertEqual(len(release.errors["set"]), 1)
            self.assertIs(release.errors["set"][0], caught.exception)
            self.assertEqual(str(caught.exception), SET_MARKER)
            self.assertIs(release.attempts["set"][-1][1], prior)
            release.clear()
            with self.assertRaises(InjectedGateWaitFailure) as waited:
                release.wait(5)
            self.assertNotIsInstance(waited.exception, Exception)
            self.assertEqual(len(release.errors["wait"]), 1)
            self.assertIs(release.errors["wait"][0], waited.exception)
            self.assertEqual(str(waited.exception), WORKER_MARKER)
            release.set()
            self.assertIs(release.wait(5), True)
            release.clear()
            self.assertEqual(release.error_counts["wait"], 1)
            self.assertEqual(release.error_counts["set"], 1)
            self.assertEqual(release.counts["clear"], 2)
            self.assertEqual(release.counts["set"], 3 if prior else 2)
            self.assertEqual(release.counts["wait"], 2)
            self.assertEqual(entered.counts, {"clear": 1, "set": 1, "wait": 3})
            self.assert_event_ledgers(model)

        model = ClockThreadingFacade(release_wait_false=True)
        model.Event()
        release = model.Event()
        self.assertIs(release.wait(5), False)
        self.assertEqual(release.errors["wait"], [])
        self.assertEqual(release.error_counts["wait"], 0)
        self.assertEqual(release.returns["wait"], [(model.main_identity, False, False)])
        self.assert_event_ledgers(model)

    def test_claim_first_launch_refusal(self):
        self.assert_first_launch(CLAIM)

    def test_delayed_first_launch_refusal(self):
        self.assert_first_launch(DELAYED)

    def test_claim_worker_wait_failure(self):
        self.assert_fault_row(CLAIM)

    def test_claim_worker_and_main_wait_failures(self):
        self.assert_fault_row(CLAIM, fail_main_wait=True)

    def test_claim_worker_and_release_set_failures(self):
        self.assert_fault_row(CLAIM, fail_release_set_attempt=1)

    def test_claim_worker_and_join_failures(self):
        self.assert_fault_row(CLAIM, fail_join_index=0)

    def test_claim_worker_failure_and_survivor(self):
        self.assert_fault_row(CLAIM, join_survivor_index=0)

    def test_delayed_worker_wait_failure(self):
        self.assert_fault_row(DELAYED)

    def test_delayed_worker_and_main_wait_failures(self):
        self.assert_fault_row(DELAYED, fail_main_wait=True)

    def test_delayed_worker_and_release_set_failures(self):
        self.assert_fault_row(DELAYED, fail_release_set_attempt=1)

    def test_delayed_worker_and_join_failures(self):
        self.assert_fault_row(DELAYED, fail_join_index=0)

    def test_delayed_worker_failure_and_survivor(self):
        self.assert_fault_row(DELAYED, join_survivor_index=0)

    def test_shared_gate_false_wait_must_deny_held_worker_admission(self):
        facade, result = self.run_clock(CLAIM, release_wait_false=True)
        entered, release = facade.events
        self.assertEqual(release.error_counts["wait"], 0)
        self.assertEqual(release.errors["wait"], [])
        self.assertEqual(release.returns["wait"], [(facade.threads[0], False, False)])
        error = self.assert_held_wait(facade)
        self.assertIs(type(error), TimeoutError)
        self.assertTrue(str(error), "the source timeout must explain the failed gate wait")
        self.assertEqual(entered.errors["wait"], [])
        self.assertEqual(release.errors["set"], [])
        self.assertEqual(facade.join_failures, [])
        self.assert_clock_cleanup(facade)
        self.assert_failure_causes(result, [str(error)])
