import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.event_audio import AudioCapacityError, AudioCoordinator, AudioRetryUnavailable


class FakeClock:
    def __init__(self):
        self.value = 100.0

    def __call__(self):
        return self.value


class AudioCoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.credentials = Mock(return_value="key-one")
        self.calls = []

    def tearDown(self):
        if hasattr(self, "coordinator"):
            self.coordinator.close()

    def test_two_subscribers_share_one_generation_and_replay_without_side_effects(self):
        release = threading.Event()
        started = threading.Event()

        def generate(event, config, secret):
            self.calls.append((event, config, secret))
            started.set()
            yield b"one"
            release.wait(1)
            yield b"two"

        self.coordinator = AudioCoordinator(self.credentials, generate, clock=self.clock, wall_clock=self.clock)
        event = {"id": "a", "text": "answer", "expiresAt": 200.0}
        first = self.coordinator.subscribe(event, {"volume": 1})
        self.assertTrue(started.wait(1))
        second = self.coordinator.subscribe(event, {"volume": 9})
        self.assertEqual(next(first), b"one")
        self.assertEqual(next(second), b"one")
        first.close()
        release.set()
        self.assertEqual(list(second), [b"two"])
        self.assertEqual(list(self.coordinator.subscribe(event, {"volume": 7})), [b"one", b"two"])
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0][1], {"volume": 1})

    def test_same_event_id_from_different_owners_never_shares_audio(self):
        def generate(event, _config, _secret):
            self.calls.append(event["ownerId"])
            yield event["ownerId"].encode()

        self.coordinator = AudioCoordinator(self.credentials, generate, clock=self.clock, wall_clock=self.clock)
        first = {"id": "collision", "ownerId": "owner-a", "text": "A", "expiresAt": 200.0}
        second = {"id": "collision", "ownerId": "owner-b", "text": "B", "expiresAt": 200.0}

        self.assertEqual(list(self.coordinator.subscribe(first, {})), [b"owner-a"])
        self.assertEqual(list(self.coordinator.subscribe(second, {})), [b"owner-b"])
        self.assertEqual(self.calls, ["owner-a", "owner-b"])

    def test_pending_generation_rotates_owners_instead_of_draining_one_owner(self):
        started = threading.Event()
        release = threading.Event()

        def generate(event, _config, _secret):
            self.calls.append(event["id"])
            if event["id"] == "a-1":
                started.set()
                release.wait(1)
            yield event["id"].encode()

        self.coordinator = AudioCoordinator(self.credentials, generate, clock=self.clock, wall_clock=self.clock)
        first = self.coordinator.subscribe({"id": "a-1", "ownerId": "owner-a", "expiresAt": 200.0}, {})
        self.assertTrue(started.wait(1))
        second_a = self.coordinator.subscribe({"id": "a-2", "ownerId": "owner-a", "expiresAt": 200.0}, {})
        first_b = self.coordinator.subscribe({"id": "b-1", "ownerId": "owner-b", "expiresAt": 200.0}, {})
        release.set()

        self.assertEqual(list(first), [b"a-1"])
        self.assertEqual(list(first_b), [b"b-1"])
        self.assertEqual(list(second_a), [b"a-2"])
        self.assertEqual(self.calls, ["a-1", "b-1", "a-2"])

    def test_zero_byte_failure_has_one_cooled_down_retry_but_partial_failure_never_retries(self):
        attempts = 0

        def generate(_event, _config, _secret):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise RuntimeError("zero")
            yield b"published"
            raise RuntimeError("partial")

        self.coordinator = AudioCoordinator(self.credentials, generate, clock=self.clock, wall_clock=self.clock, retry_cooldown=30)
        event = {"id": "retry", "text": "answer", "expiresAt": 200.0}
        with self.assertRaises(AudioRetryUnavailable):
            list(self.coordinator.subscribe(event, {}))
        with self.assertRaises(AudioRetryUnavailable):
            list(self.coordinator.subscribe(event, {}))
        self.clock.value += 30
        with self.assertRaises(AudioRetryUnavailable):
            list(self.coordinator.subscribe(event, {}))
        self.assertEqual(attempts, 2)
        with self.assertRaises(AudioRetryUnavailable):
            list(self.coordinator.subscribe(event, {}))
        self.assertEqual(attempts, 2)

    def test_terminal_states_scrub_transient_session_capability(self):
        capability = "fake-session-capability"

        def complete(_event, _config, _secret):
            yield b"done"

        self.coordinator = AudioCoordinator(self.credentials, complete, clock=self.clock, wall_clock=self.clock)
        event = {"id": "complete", "ownerId": "owner", "text": "a", "expiresAt": 200.0, "_capability": capability}
        self.assertEqual(list(self.coordinator.subscribe(event, {})), [b"done"])
        complete_state = self.coordinator.states[("owner", "complete")]
        self.assertNotIn("_capability", complete_state.event)
        self.assertIsNone(getattr(complete_state, "capability", None))

        self.coordinator.close()

        def fail(_event, _config, _secret):
            raise RuntimeError("failed")
            yield b"unreachable"

        self.coordinator = AudioCoordinator(self.credentials, fail, clock=self.clock, wall_clock=self.clock)
        failed_event = {"id": "failed", "ownerId": "owner", "text": "a", "expiresAt": 200.0, "_capability": capability}
        with self.assertRaises(AudioRetryUnavailable):
            list(self.coordinator.subscribe(failed_event, {}))
        failed_state = self.coordinator.states[("owner", "failed")]
        self.assertNotIn("_capability", failed_state.event)
        self.assertIsNone(getattr(failed_state, "capability", None))

    def test_zero_pcm_retry_uses_only_newly_validated_authority(self):
        attempts = 0
        validated = []

        def validate(event):
            validated.append(event.get("_capability"))

        def generate(event, _config, _secret):
            nonlocal attempts
            attempts += 1
            self.calls.append(dict(event))
            if attempts == 1:
                raise RuntimeError("zero")
            yield b"retry"

        self.coordinator = AudioCoordinator(
            self.credentials,
            generate,
            clock=self.clock,
            wall_clock=self.clock,
            retry_cooldown=5,
            event_validator=validate,
        )
        first = {"id": "retry-authority", "ownerId": "owner", "text": "a", "expiresAt": 200.0, "_capability": "token-one"}
        with self.assertRaises(AudioRetryUnavailable):
            list(self.coordinator.subscribe(first, {}))
        state = self.coordinator.states[("owner", "retry-authority")]
        self.assertNotIn("_capability", state.event)
        self.assertIsNone(getattr(state, "capability", None))

        self.clock.value += 5
        second = {**first, "_capability": "token-two"}
        self.assertEqual(list(self.coordinator.subscribe(second, {})), [b"retry"])

        self.assertEqual(validated, ["token-one", "token-one", "token-two", "token-two"])
        self.assertTrue(all("_capability" not in event for event in self.calls))
        self.assertIsNone(getattr(state, "capability", None))

    def test_active_event_byte_and_chunk_limits_fail_without_background_retry(self):
        def generate(_event, _config, _secret):
            yield b"1234"
            yield b"5"

        self.coordinator = AudioCoordinator(
            self.credentials,
            generate,
            clock=self.clock,
            wall_clock=self.clock,
            max_event_bytes=4,
            max_total_bytes=4,
            max_chunks=1,
        )
        event = {"id": "capacity", "text": "answer", "expiresAt": 200.0}
        stream = self.coordinator.subscribe(event, {})
        self.assertEqual(next(stream), b"1234")
        with self.assertRaises(AudioCapacityError):
            next(stream)

    def test_subscriber_limits_are_explicit(self):
        release = threading.Event()

        def generate(_event, _config, _secret):
            release.wait(1)
            yield b"done"

        self.coordinator = AudioCoordinator(
            self.credentials,
            generate,
            clock=self.clock,
            wall_clock=self.clock,
            max_subscribers_per_event=1,
            max_subscribers_total=1,
        )
        event = {"id": "subscribers", "text": "answer", "expiresAt": 200.0}
        first = self.coordinator.subscribe(event, {})
        with self.assertRaises(AudioCapacityError):
            self.coordinator.subscribe(event, {})
        first.close()
        release.set()

    def test_queued_work_reads_replacement_credential_at_dequeue(self):
        release = threading.Event()
        first_started = threading.Event()
        current = ["key-one"]
        calls = []

        def resolve():
            return current[0]

        def generate(event, _config, secret):
            calls.append((event["id"], secret))
            if event["id"] == "first":
                first_started.set()
                release.wait(1)
            yield event["id"].encode()

        self.coordinator = AudioCoordinator(resolve, generate, clock=self.clock, wall_clock=self.clock)
        first = self.coordinator.subscribe({"id": "first", "text": "a", "expiresAt": 200.0}, {})
        self.assertTrue(first_started.wait(1))
        second = self.coordinator.subscribe({"id": "second", "text": "b", "expiresAt": 200.0}, {})
        current[0] = "key-two"
        release.set()
        self.assertEqual(list(first), [b"first"])
        self.assertEqual(list(second), [b"second"])
        self.assertEqual(calls, [("first", "key-one"), ("second", "key-two")])

    def test_completed_pcm_eviction_keeps_tombstone_and_never_regenerates(self):
        calls = []

        def generate(event, _config, _secret):
            calls.append(event["id"])
            yield b"1234"

        self.coordinator = AudioCoordinator(
            self.credentials,
            generate,
            clock=self.clock,
            wall_clock=self.clock,
            max_total_bytes=4,
        )
        first_event = {"id": "first", "text": "a", "expiresAt": 200.0}
        second_event = {"id": "second", "text": "b", "expiresAt": 200.0}
        self.assertEqual(list(self.coordinator.subscribe(first_event, {})), [b"1234"])
        self.assertEqual(list(self.coordinator.subscribe(second_event, {})), [b"1234"])
        with self.assertRaises(AudioCapacityError):
            self.coordinator.subscribe(first_event, {})
        self.assertEqual(calls, ["first", "second"])

    def test_queue_accepts_eight_waiters_and_rejects_the_ninth(self):
        release = threading.Event()
        active = threading.Event()

        def generate(event, _config, _secret):
            if event["id"] == "active":
                active.set()
                release.wait(1)
            yield b"ok"

        self.coordinator = AudioCoordinator(self.credentials, generate, clock=self.clock, wall_clock=self.clock)
        streams = [self.coordinator.subscribe({"id": "active", "text": "a", "expiresAt": 200.0}, {})]
        self.assertTrue(active.wait(1))
        for index in range(8):
            streams.append(self.coordinator.subscribe({"id": f"queued-{index}", "text": "a", "expiresAt": 200.0}, {}))
        with self.assertRaises(AudioCapacityError):
            self.coordinator.subscribe({"id": "overflow", "text": "a", "expiresAt": 200.0}, {})
        release.set()
        for stream in streams:
            self.assertEqual(list(stream), [b"ok"])

    def test_queue_job_and_chunk_deadlines_are_explicit(self):
        release = threading.Event()
        active = threading.Event()

        def generate(event, _config, _secret):
            if event["id"] == "active":
                active.set()
                release.wait(1)
            yield b"a"
            if event["id"] == "deadline":
                self.clock.value += 61
                yield b"b"

        self.coordinator = AudioCoordinator(
            self.credentials,
            generate,
            clock=self.clock,
            wall_clock=self.clock,
            max_chunks=1,
        )
        first = self.coordinator.subscribe({"id": "active", "text": "a", "expiresAt": 300.0}, {})
        self.assertTrue(active.wait(1))
        queued = self.coordinator.subscribe({"id": "queued", "text": "a", "expiresAt": 300.0}, {})
        self.clock.value += 31
        release.set()
        self.assertEqual(list(first), [b"a"])
        with self.assertRaises(AudioRetryUnavailable):
            list(queued)

        self.coordinator.close()
        self.clock.value = 100
        self.coordinator = AudioCoordinator(
            self.credentials,
            generate,
            clock=self.clock,
            wall_clock=self.clock,
            max_chunks=10,
            job_timeout=60,
        )
        deadline = self.coordinator.subscribe({"id": "deadline", "text": "a", "expiresAt": 300.0}, {})
        self.assertEqual(next(deadline), b"a")
        with self.assertRaises(AudioRetryUnavailable):
            next(deadline)

    def test_total_subscriber_limit_and_expired_events_are_rejected(self):
        release = threading.Event()

        def generate(_event, _config, _secret):
            release.wait(1)
            yield b"ok"

        self.coordinator = AudioCoordinator(
            self.credentials,
            generate,
            clock=self.clock,
            wall_clock=self.clock,
            max_queue=4,
            max_subscribers_per_event=2,
            max_subscribers_total=2,
        )
        event = {"id": "one", "text": "a", "expiresAt": 200.0}
        first = self.coordinator.subscribe(event, {})
        second = self.coordinator.subscribe(event, {})
        with self.assertRaises(AudioCapacityError):
            self.coordinator.subscribe({"id": "two", "text": "a", "expiresAt": 200.0}, {})
        with self.assertRaises(AudioRetryUnavailable):
            self.coordinator.subscribe({"id": "expired", "text": "a", "expiresAt": 99.0}, {})
        first.close()
        second.close()
        release.set()

    def test_deleted_credential_blocks_queued_client_creation(self):
        release = threading.Event()
        active = threading.Event()
        available = [True]
        generated = []

        def resolve():
            if not available[0]:
                raise RuntimeError("deleted")
            return "key"

        def generate(event, _config, _secret):
            generated.append(event["id"])
            if event["id"] == "active":
                active.set()
                release.wait(1)
            yield b"ok"

        self.coordinator = AudioCoordinator(resolve, generate, clock=self.clock, wall_clock=self.clock)
        first = self.coordinator.subscribe({"id": "active", "text": "a", "expiresAt": 200.0}, {})
        self.assertTrue(active.wait(1))
        queued = self.coordinator.subscribe({"id": "queued", "text": "a", "expiresAt": 200.0}, {})
        available[0] = False
        release.set()
        self.assertEqual(list(first), [b"ok"])
        with self.assertRaises(AudioRetryUnavailable):
            list(queued)
        self.assertEqual(generated, ["active"])

    def test_deadline_releases_consumer_before_noncooperative_generator_returns(self):
        started = threading.Event()
        release = threading.Event()
        cleanup_done = threading.Event()
        cleanup = Mock(side_effect=cleanup_done.set)
        terminal = threading.Event()
        provider_calls = []
        outcome = []

        def generate(event, _config, _secret, control):
            provider_calls.append(event["id"])
            control.add_cancel_callback(cleanup)
            started.set()
            release.wait(1)
            yield b"late"

        self.coordinator = AudioCoordinator(
            self.credentials,
            generate,
            clock=time.monotonic,
            wall_clock=time.time,
            job_timeout=0.05,
            subscriber_idle_timeout=1,
        )
        event = {"id": "blocked", "text": "a", "expiresAt": time.time() + 10, "_capability": "timeout-token"}
        stream = self.coordinator.subscribe(event, {})

        def consume():
            try:
                next(stream)
            except Exception as error:
                outcome.append(str(error))
            finally:
                terminal.set()

        consumer = threading.Thread(target=consume)
        consumer.start()
        self.assertTrue(started.wait(1))
        try:
            self.assertTrue(terminal.wait(0.3))
            self.assertEqual(outcome, ["VOICE_JOB_TIMEOUT"])
            self.assertTrue(cleanup_done.wait(0.3))
            with self.assertRaisesRegex(AudioRetryUnavailable, "QUARANTINED"):
                self.coordinator.subscribe({"id": "second", "text": "b", "expiresAt": time.time() + 10}, {})
            self.assertEqual(provider_calls, ["blocked"])
        finally:
            release.set()
            consumer.join(1)
        self.assertEqual(provider_calls, ["blocked"])
        self.assertEqual(self.coordinator.states["blocked"].status, "timed_out")
        self.assertEqual(self.coordinator.states["blocked"].chunks, [])
        self.assertNotIn("_capability", self.coordinator.states["blocked"].event)
        self.assertIsNone(getattr(self.coordinator.states["blocked"], "capability", None))
        cleanup.assert_called_once_with()

    def test_unstarted_and_repeated_close_release_subscription_exactly_once(self):
        release = threading.Event()

        def generate(_event, _config, _secret):
            release.wait(1)
            yield b"ok"

        self.coordinator = AudioCoordinator(self.credentials, generate, clock=self.clock, wall_clock=self.clock)
        stream = self.coordinator.subscribe({"id": "close", "text": "a", "expiresAt": 200.0}, {})
        self.assertEqual(self.coordinator.total_subscribers, 1)
        stream.close()
        stream.close()
        self.assertEqual(self.coordinator.total_subscribers, 0)
        release.set()

    def test_idle_timeout_releases_subscription_counter(self):
        release = threading.Event()

        def generate(_event, _config, _secret):
            release.wait(1)
            yield b"ok"

        self.coordinator = AudioCoordinator(
            self.credentials,
            generate,
            clock=self.clock,
            wall_clock=self.clock,
            subscriber_idle_timeout=0.01,
        )
        stream = self.coordinator.subscribe({"id": "idle", "text": "a", "expiresAt": 200.0}, {})
        with self.assertRaisesRegex(AudioRetryUnavailable, "IDLE_TIMEOUT"):
            next(stream)
        self.assertEqual(self.coordinator.total_subscribers, 0)
        stream.close()
        self.assertEqual(self.coordinator.total_subscribers, 0)
        release.set()

    def test_rejected_subscriber_does_not_create_or_enqueue_paid_work(self):
        release = threading.Event()
        started = threading.Event()
        generated = []

        def generate(event, _config, _secret):
            generated.append(event["id"])
            started.set()
            release.wait(1)
            yield b"ok"

        self.coordinator = AudioCoordinator(
            self.credentials,
            generate,
            clock=self.clock,
            wall_clock=self.clock,
            max_subscribers_total=1,
        )
        first = self.coordinator.subscribe({"id": "first", "text": "a", "expiresAt": 200.0}, {})
        self.assertTrue(started.wait(1))
        with self.assertRaisesRegex(AudioCapacityError, "SUBSCRIBER"):
            self.coordinator.subscribe({"id": "rejected", "text": "b", "expiresAt": 200.0}, {})
        self.assertEqual(self.credentials.call_count, 2)
        release.set()
        self.assertEqual(list(first), [b"ok"])
        self.assertEqual(generated, ["first"])
        self.assertNotIn("rejected", self.coordinator.states)

    def test_admitted_replay_pcm_is_not_evicted_or_unaccounted_until_close(self):
        def generate(event, _config, _secret):
            yield event["id"].encode().ljust(4, b"x")[:4]

        self.coordinator = AudioCoordinator(
            self.credentials,
            generate,
            clock=self.clock,
            wall_clock=self.clock,
            max_total_bytes=4,
        )
        first_event = {"id": "one", "text": "a", "expiresAt": 101.0}
        first = self.coordinator.subscribe(first_event, {})
        deadline = time.monotonic() + 1
        while self.coordinator.states["one"].status != "complete" and time.monotonic() < deadline:
            threading.Event().wait(0.001)
        self.assertEqual(self.coordinator.states["one"].status, "complete")
        with self.assertRaises(AudioCapacityError):
            self.coordinator.subscribe({"id": "two", "text": "b", "expiresAt": 200.0}, {})
        self.assertEqual(next(first), b"onex")
        self.clock.value = 102.0
        with self.assertRaises(AudioCapacityError):
            self.coordinator.subscribe({"id": "three", "text": "c", "expiresAt": 200.0}, {})
        self.assertEqual(self.coordinator.total_bytes, 4)
        first.close()
        self.assertEqual(self.coordinator.total_bytes, 0)
        self.assertNotIn("one", self.coordinator.states)

    def test_queued_deadline_releases_subscriber_before_active_producer_returns(self):
        release = threading.Event()
        active = threading.Event()
        generated = []

        def generate(event, _config, _secret):
            generated.append(event["id"])
            if event["id"] == "active":
                active.set()
                release.wait(1)
            yield b"ok"

        self.coordinator = AudioCoordinator(self.credentials, generate, clock=self.clock, wall_clock=self.clock)
        first = self.coordinator.subscribe({"id": "active", "text": "a", "expiresAt": 300.0}, {})
        self.assertTrue(active.wait(1))
        queued = self.coordinator.subscribe({"id": "queued", "text": "b", "expiresAt": 300.0}, {})
        self.clock.value += 31
        self.coordinator.notify_clock_advanced()
        with self.assertRaisesRegex(AudioRetryUnavailable, "QUEUE_TIMEOUT"):
            next(queued)
        self.assertEqual(generated, ["active"])
        release.set()
        self.assertEqual(list(first), [b"ok"])


if __name__ == "__main__":
    unittest.main()
