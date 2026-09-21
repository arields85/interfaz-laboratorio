"""Inert cleanup proof for the two actual WarningSweep racing callers.

Reuse the frozen generation harness's guards, ownership model and external
oracles. Inline, nonblocking workers prove cleanup accounting, not native
concurrency. The original nested callers retain every business assertion.
"""

if __package__:
    from . import test_channel_a_pairing_cleanup as harness
else:
    import test_channel_a_pairing_cleanup as harness


BATCH_INDIVIDUAL = "test_concurrent_batch_and_individual_reserve_once"
BATCH_BATCH = "test_concurrent_batch_sweeps_reserve_once"
MAIN_WAIT_MARKER = "PRISMA_PAIRING_WARNING_INJECTED_MAIN_WAIT_FAILURE"


class InjectedMainWaitFailure(Exception):
    """A main-thread rendezvous failure, independent of worker failures."""


class WarningThreadingFacade(harness.InertThreadingFacade):
    """Add only a third-wait fault to the existing nonblocking model."""

    def __init__(self, *, fail_main_wait=False, **options):
        super().__init__(**options)
        self.fail_main_wait = fail_main_wait
        self.main_wait_failures = []
        self.main_wait_injections = 0

    def reserve_worker_fault(self):
        if self.fail_main_wait and self.wait_ordinal == 3:
            error = InjectedMainWaitFailure(MAIN_WAIT_MARKER)
            self.main_wait_injections += 1
            self.main_wait_failures.append(error)
            self.timeline.append(("main_wait_failure_reserved", 3))
            return error
        return super().reserve_worker_fault()


class WarningSweepCleanupTests(harness.PairingCleanupHarnessTestCase):
    def run_warning(self, method_name=BATCH_INDIVIDUAL, **options):
        facade = self.activate(WarningThreadingFacade(**options))
        result = self.new_result(facade)
        case = harness.pairing_tests.ChannelAPairingWarningSweepTests(method_name)
        case.run(result)
        self.assertEqual(result.testsRun, 1)
        self.assertEqual(type(case), harness.pairing_tests.ChannelAPairingWarningSweepTests)
        self.assertEqual(case.id().rsplit(".", 1)[-1], method_name)
        self.assertEqual(len(result.reports), 1)
        self.assertIs(result.reports[0][1], case)

        fail_index = options.get("fail_start_index")
        started_count = 2 if fail_index is None else fail_index
        attempts = 2 if fail_index is None else fail_index + 1
        owned = self.event_positions(facade, "thread_owned")
        starts = self.event_positions(facade, "thread_start_attempt")
        self.assertEqual(len(facade.threads), 2)
        self.assertEqual(len(owned), 2)
        self.assertEqual(len(starts), attempts)
        self.assertLess(max(owned), min(starts))
        self.assertEqual([thread.start_attempts for thread in facade.threads],
                         [1] * attempts + [0] * (2 - attempts))
        self.assertEqual([thread.index for thread in self.started_threads(facade)],
                         list(range(started_count)))
        self.assertEqual([thread.ident for thread in facade.threads],
                         [index if index < started_count else None for index in range(2)])
        if started_count:
            self.assertEqual(facade.threads[0].ident, 0)

        self.assertEqual(len(facade.barriers), 1)
        barrier = facade.barriers[0]
        self.assertEqual(barrier.parties, 3)
        if fail_index is not None:
            self.assertEqual(barrier.wait_calls, started_count)
        elif options.get("worker_fault_ordinal") is not None:
            # A corrected helper may skip MAIN's already-broken rendezvous.
            self.assertIn(barrier.wait_calls, (2, 3))
        else:
            self.assertEqual(barrier.wait_calls, 3)
        self.assertEqual(facade.wait_ordinal, barrier.wait_calls)
        self.assert_recorded_wait_inputs(barrier)
        if barrier.wait_calls:
            self.assert_every_wait_is_bounded(barrier)
        return facade, result

    def assert_warning_cleanup(self, facade, *, require_abort=False):
        if self.started_threads(facade):
            self.assert_race_cleanup_contract(
                facade, context="warning sweep", require_abort=require_abort,
            )
        else:
            self.assertEqual([thread.join_calls for thread in facade.threads], [0, 0])
            self.assertEqual([thread.join_timeouts for thread in facade.threads], [[], []])
            self.assertEqual(facade.join_attempts, 0)
            self.assertEqual(self.event_positions(facade, "thread_join"), [])
            self.assertEqual(self.observed_liveness(facade), [])
            self.assertEqual([thread.liveness_checks for thread in facade.threads], [0, 0])
            self.assert_no_unstarted_joins(facade)
            self.assert_facade_contract(facade)
            self.assert_no_escape(facade)

    def assert_main_wait_evidence(self, facade):
        self.assertEqual(facade.main_wait_injections, 1)
        self.assertEqual(len(facade.main_wait_failures), 1)
        error = facade.main_wait_failures[0]
        self.assertIs(type(error), InjectedMainWaitFailure)
        self.assertEqual(str(error), MAIN_WAIT_MARKER)
        self.assertEqual(facade.worker_faults, [])
        starts = self.event_positions(facade, "thread_start_attempt")
        reserved = self.event_positions(facade, "main_wait_failure_reserved")
        self.assertEqual(len(starts), 2)
        self.assertEqual(len(reserved), 1)
        self.assertEqual(facade.timeline[reserved[0]], ("main_wait_failure_reserved", 3))
        self.assertLess(max(starts), reserved[0])
        self.assertEqual(
            [event for event in facade.timeline if event[0] == "barrier_wait_faulted"],
            [("barrier_wait_faulted", 3, 2)],
        )
        return error

    def assert_preserved_error(self, result, error):
        reported = self.assert_single_report(result, "error")
        self.assertIs(reported, error)
        self.assertIs(type(reported), type(error))

    def assert_failure_markers(self, result, *markers):
        reported = self.assert_single_report(result, "failure")
        self.assertIsInstance(reported, AssertionError)
        for marker in markers:
            self.assertIn(marker, str(reported))

    def assert_healthy_warning(self, method_name):
        facade, result = self.run_warning(method_name)
        self.assertEqual(facade.barriers[0].wait_results, [0, 1, 2])
        self.assertEqual(facade.start_failures, [])
        self.assertEqual(facade.worker_faults, [])
        self.assertEqual(facade.main_wait_failures, [])
        self.assertEqual(facade.main_wait_injections, 0)
        self.assertEqual(facade.join_failures, [])
        self.assertEqual(facade.abort_failures, [])
        self.assert_warning_cleanup(facade)
        self.assert_single_report(result, "success")
        self.assertTrue(result.wasSuccessful())

    def test_healthy_batch_and_individual(self):
        self.assert_healthy_warning(BATCH_INDIVIDUAL)

    def test_healthy_batch_and_batch(self):
        self.assert_healthy_warning(BATCH_BATCH)

    def test_first_launch_failure_preserves_error_without_joining(self):
        facade, result = self.run_warning(fail_start_index=0)
        error = self.assert_launch_evidence(facade, workers=2, fail_index=0)
        self.assertIs(type(error), harness.InjectedLaunchFailure)
        self.assert_warning_cleanup(facade)
        self.assert_preserved_error(result, error)

    def test_second_launch_failure_aborts_and_preserves_error(self):
        facade, result = self.run_warning(fail_start_index=1)
        error = self.assert_launch_evidence(facade, workers=2, fail_index=1)
        self.assertIs(type(error), harness.InjectedLaunchFailure)
        self.assert_warning_cleanup(facade, require_abort=True)
        self.assert_preserved_error(result, error)

    def test_worker_base_exception_is_reported_after_cleanup(self):
        facade, result = self.run_warning(worker_fault_ordinal=0)
        self.assert_worker_fault_evidence(facade, ordinal=0)
        self.assertEqual(facade.main_wait_failures, [])
        self.assertEqual(facade.main_wait_injections, 0)
        self.assert_warning_cleanup(facade, require_abort=True)
        self.assert_failure_markers(result, harness.INJECTED_WORKER_MARKER)

    def test_main_wait_failure_aborts_and_preserves_error(self):
        facade, result = self.run_warning(fail_main_wait=True)
        error = self.assert_main_wait_evidence(facade)
        self.assert_warning_cleanup(facade, require_abort=True)
        self.assert_preserved_error(result, error)

    def test_survivor_is_observed_before_failure(self):
        facade, result = self.run_warning(join_survivor_index=0)
        self.assert_warning_cleanup(facade)
        self.assert_failure_markers(result, harness.LIVENESS_CATEGORY)

    def test_first_join_failure_still_joins_and_observes_both_workers(self):
        facade, result = self.run_warning(fail_join_index=0)
        self.assertEqual(len(facade.join_failures), 1)
        error = facade.join_failures[0]
        self.assertIs(type(error), harness.InjectedCleanupFailure)
        self.assertEqual(str(error), f"{harness.INJECTED_JOIN_CLEANUP_ERROR} 1")
        self.assertEqual([thread.join_calls for thread in facade.threads], [1, 1])
        self.assertEqual(facade.join_attempts, 2)
        self.assert_warning_cleanup(facade)
        self.assertIn((0, True), self.observed_liveness(facade))
        self.assert_failure_markers(
            result, harness.INJECTED_JOIN_CLEANUP_ERROR, harness.LIVENESS_CATEGORY,
        )

    def test_main_wait_and_abort_failures_are_both_reported(self):
        facade, result = self.run_warning(fail_main_wait=True, fail_abort_index=0)
        self.assert_main_wait_evidence(facade)
        self.assertEqual(len(facade.abort_failures), 1)
        error = facade.abort_failures[0]
        self.assertIs(type(error), harness.InjectedCleanupFailure)
        self.assertEqual(str(error), f"{harness.INJECTED_ABORT_FAILURE} 1")
        self.assertGreaterEqual(facade.abort_attempts, 1)
        self.assert_warning_cleanup(facade, require_abort=True)
        self.assert_failure_markers(result, MAIN_WAIT_MARKER, harness.INJECTED_ABORT_FAILURE)

    def test_second_launch_failure_and_survivor_are_both_reported(self):
        facade, result = self.run_warning(fail_start_index=1, join_survivor_index=0)
        self.assert_launch_evidence(facade, workers=2, fail_index=1)
        self.assert_warning_cleanup(facade, require_abort=True)
        self.assert_failure_markers(result, harness.INJECTED_START_FAILURE, harness.LIVENESS_CATEGORY)

    def test_second_launch_and_worker_failures_are_both_reported(self):
        facade, result = self.run_warning(fail_start_index=1, worker_fault_ordinal=0)
        self.assert_launch_evidence(facade, workers=2, fail_index=1)
        self.assert_worker_fault_evidence(facade, ordinal=0)
        self.assertEqual(facade.main_wait_failures, [])
        self.assertEqual(facade.main_wait_injections, 0)
        self.assert_warning_cleanup(facade, require_abort=True)
        self.assert_failure_markers(result, harness.INJECTED_START_FAILURE, harness.INJECTED_WORKER_MARKER)

    def test_main_wait_failure_and_survivor_are_both_reported(self):
        facade, result = self.run_warning(fail_main_wait=True, join_survivor_index=0)
        self.assert_main_wait_evidence(facade)
        self.assert_warning_cleanup(facade, require_abort=True)
        self.assert_failure_markers(result, MAIN_WAIT_MARKER, harness.LIVENESS_CATEGORY)
