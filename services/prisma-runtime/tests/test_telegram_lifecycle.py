import io
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests


RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.bot_identity_reservation import (
    TELEGRAM_BOT_IDENTITY_RESERVED,
    BotIdentityReservation,
    BotIdentityReservationError,
    process_bot_identity_reservation,
)
from prisma_runtime.local_presentation import TELEGRAM_STOPPING, TelegramLocalBot, build_telegram_bot
from prisma_runtime.telegram_config import TelegramConfig
from prisma_runtime.telegram_lifecycle import (
    TelegramLifecycleError,
    TelegramLifecycleManager,
    TelegramStateRepository,
    TelegramStateUnavailable,
)


class MemoryStateStore:
    def __init__(self, value=None):
        self.value = value
        self.writes = []

    def read(self):
        return self.value

    def write(self, value):
        self.value = value
        self.writes.append(value)


class FailingStateStore(MemoryStateStore):
    def __init__(self, value, failures):
        super().__init__(value)
        self.failures = failures

    def write(self, value):
        if self.failures:
            self.failures -= 1
            raise TelegramStateUnavailable("sensitive path")
        super().write(value)


class ImmediateStopEvent:
    def __init__(self):
        self.stopped = False

    def is_set(self):
        return self.stopped

    def set(self):
        self.stopped = True

    def wait(self, _timeout):
        return self.stopped


class StuckThread:
    """A thread that never terminates, so stop() cannot confirm quiescence."""

    def is_alive(self):
        return True

    def join(self, timeout=None):
        return None


class RecordingCloseSession:
    """A session that counts teardown attempts, can fault, and never dispatches.

    ``fault_teardown`` is the discriminating control: a finalization that is not
    retryable reports a false failure while one that is not idempotent closes a
    completed object a second time. Both show up as an external count.
    """

    def __init__(self, *, fault_teardown=False):
        self.closes = 0
        self.fault_teardown = fault_teardown

    def close(self):
        self.closes += 1
        if self.fault_teardown:
            raise RuntimeError("TELEGRAM_TEARDOWN_FAILED")

    def post(self, *_args, **_kwargs):
        raise AssertionError("a fenced or stopped object must never reach the network")


class InertThreadDispatch:
    """A ``threading.Thread`` stand-in that records construction without running.

    Proving that a fenced object dispatches no runner must not create a real
    thread: an inert replacement records the construction and starts nothing.
    """

    instances: list = []

    def __init__(self, *args, **kwargs):
        self.target = kwargs.get("target")
        self.name = kwargs.get("name")
        self.started = False
        type(self).instances.append(self)

    def start(self):
        self.started = True

    def is_alive(self):
        return self.started

    def join(self, timeout=None):
        return None


def identity_transport(bot_id=123, username="prisma_bot"):
    """The exact observed identity followed by the single accepted webhook effect."""
    return Mock(side_effect=[
        {"ok": True, "result": {"id": bot_id, "username": username}},
        {"ok": True, "result": True},
    ])


TELEGRAM_OFFLINE_DISPATCH_REFUSED = "TELEGRAM_OFFLINE_DISPATCH_REFUSED"


class OfflineDispatchRefused(RuntimeError):
    """Fixed guard error: an offline test case must never dispatch a real request."""

    def __init__(self) -> None:
        super().__init__(TELEGRAM_OFFLINE_DISPATCH_REFUSED)


def install_offline_dispatch_guard(case) -> list[int]:
    """Refuse every real outbound dispatch for the lifetime of one test case.

    ``requests.Session.request`` is the single funnel behind both ``get`` and
    ``post``, so one class-level patch covers every bot call regardless of the
    verb a path uses. Attempts are counted without any URL, method or token
    detail. The assertion is registered as a cleanup so a broad
    ``except Exception`` inside the code under test cannot swallow it, and the
    original funnel is always restored, including when the test fails.
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


def install_inert_transport_floor(case) -> list[int]:
    """Install a second inert dispatcher below ``Session.request``.

    It answers nothing and only counts an attempt; it never builds a socket.
    Probes install this first so no version of the code under test can reach the
    network even if the primary funnel guard were absent.
    """
    attempted: list[int] = []
    original = requests.adapters.HTTPAdapter.send

    def inert_send(self, request, *args, **kwargs):
        attempted.append(1)
        raise OfflineDispatchRefused()

    requests.adapters.HTTPAdapter.send = inert_send
    case.addCleanup(lambda: setattr(requests.adapters.HTTPAdapter, "send", original))
    return attempted


class OwnedThreadFixture:
    """Failure-safe ownership of the threads, barriers and outcomes of one test.

    A test that launches its own threads must still cancel, release and join them
    after a passing run, an assertion failure, an escaping exception or a fake
    callback timeout. ``register_cleanup`` runs before the first launch, so
    unittest's last-registered-first cleanup order performs this teardown while
    the offline dispatch guard installed in ``setUp`` is still in place; a guard
    restored earlier could let an owned thread dispatch unguarded.
    """

    def __init__(self, case, cancel):
        self._case = case
        self._cancel = cancel
        self._events = []
        self._threads = []
        self._timeouts = []
        self._errors = []
        self._lock = threading.Lock()

    def register_cleanup(self):
        """Register teardown before any owned thread exists."""
        self._case.addCleanup(self._teardown)

    def watch(self, event):
        """Track a fake barrier or event so teardown always releases it."""
        self._events.append(event)
        return event

    def await_event(self, event, label, timeout=5):
        """Wait for a fake barrier, recording a timeout instead of asserting.

        A callback that never observes its barrier records the timeout as an
        external outcome and requests cancellation, so the code under test cannot
        keep polling and no assertion is raised inside its own ``except`` block.
        """
        if event.wait(timeout):
            return True
        with self._lock:
            self._timeouts.append(label)
        self._cancel()
        return False

    def record_error(self, error):
        """Record one callback or thread exception as an external outcome."""
        with self._lock:
            self._errors.append(error)

    def protect(self, callback):
        """Wrap a production-invoked callback so its exception is never swallowed."""
        def guarded(*args, **kwargs):
            try:
                return callback(*args, **kwargs)
            except BaseException as error:
                self.record_error(error)
                raise
        return guarded

    def start(self, target, *, label):
        """Track and start one owned thread whose exception becomes an outcome."""
        def owned_target():
            try:
                target()
            except BaseException as error:
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

    def owned_threads(self):
        """Return a copy of every tracked thread, started or not."""
        return list(self._threads)

    def outcomes(self):
        """Return read-only copies of the recorded timeouts and errors."""
        with self._lock:
            return list(self._timeouts), list(self._errors)

    def assert_clean(self):
        """Assert external outcomes outside every production catch."""
        timeouts, errors = self.outcomes()
        self._case.assertEqual(timeouts, [], "a fake callback timed out instead of observing its barrier")
        self._case.assertEqual(errors, [], "an owned callback or thread raised an unexpected error")

    def _teardown(self):
        problems = []
        # Cancellation and barrier release always precede the joins, otherwise a
        # join could block on a barrier the failing test never released.
        try:
            self._cancel()
        except Exception as error:
            problems.append(error)
        for event in self._events:
            try:
                event.set()
            except Exception as error:
                problems.append(error)
        for thread in self._threads:
            try:
                if thread.ident is not None:
                    thread.join(5)
            except Exception as error:
                problems.append(error)
        for thread in self._threads:
            try:
                self._case.assertFalse(thread.is_alive(), f"owned thread {thread.name!r} survived teardown")
            except Exception as error:
                problems.append(error)
        try:
            self.assert_clean()
        except Exception as error:
            problems.append(error)
        if problems:
            # Raised only after every phase ran, so one broken cleanup assertion
            # cannot skip the remaining releases, joins or liveness checks.
            raise problems[0]


class TelegramLifecycleTests(unittest.TestCase):
    def setUp(self):
        install_offline_dispatch_guard(self)

    def build_bot(self, state=None, *, reservation=None):
        return TelegramLocalBot(
            "secret-token",
            Mock(),
            MemoryStateStore(state),
            Mock(),
            reservation=reservation if reservation is not None else BotIdentityReservation(),
        )

    def prepared_bot(self, state=None, *, reservation=None):
        bot = self.build_bot(state, reservation=reservation)
        bot._call = identity_transport()
        bot.prepare()
        return bot

    def assert_reserved(self, reservation, bot_id=123):
        """Assert a live reservation exists without ever requesting its release handle."""
        view = reservation.held_by(bot_id)
        self.assertIsNotNone(view)
        self.assertEqual(view.bot_id, bot_id)
        return view

    def assert_start_dispatches_no_runner(self, bot):
        """Prove a fenced object never dispatches a managed runner thread."""
        InertThreadDispatch.instances = []
        with patch.object(threading, "Thread", InertThreadDispatch):
            bot.start()
        self.assertEqual(InertThreadDispatch.instances, [], "a fenced object dispatched a runner")
        self.assertIsNone(bot.thread)

    def assert_activation_fenced(self, bot, session, calls):
        """Prove a fenced object cannot activate again, observed externally.

        The evidence is external counters only: a new observed call, a new
        teardown attempt or a dispatched runner. Private flags are never cited.
        """
        observed, teardowns = list(calls), session.closes
        with self.assertRaises(RuntimeError) as raised:
            bot.prepare()
        self.assertEqual(str(raised.exception), TELEGRAM_STOPPING)
        self.assert_start_dispatches_no_runner(bot)
        bot.run()
        self.assertEqual(calls, observed, "a fenced object attempted activation again")
        self.assertEqual(session.closes, teardowns, "a fenced object attempted teardown again")

    def test_protected_token_bytes_are_preserved_at_consumer(self):
        self.assertEqual(TelegramLocalBot("  protected-token  ", Mock(), Mock(), Mock()).token, "  protected-token  ")

    def test_out_of_order_duplicate_and_stale_updates_advance_monotonically(self):
        state = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [], "nextUpdateOffset": 10, "migrationActive": False}}}
        bot = self.prepared_bot(state)
        bot.stop_event = ImmediateStopEvent()
        handled = []
        bot._handle_message = lambda message, **_kwargs: handled.append(message["text"])
        calls = 0
        def call(_method, **_kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                return {"ok": True, "result": [{"update_id": 10, "message": {"text": "ten"}}, {"update_id": 9, "message": {"text": "stale"}}, {"update_id": 10, "message": {"text": "duplicate"}}]}
            bot.stop_event.set(); return {"ok": True, "result": []}
        bot._call = call
        bot.run()
        self.assertEqual(handled, ["ten"])
        self.assertEqual(bot._record()["nextUpdateOffset"], 11)

    def test_stop_before_send_keeps_update_unacknowledged(self):
        state = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [7], "nextUpdateOffset": 5, "migrationActive": False}}}
        bot = self.prepared_bot(state)
        bot.snapshot_store.read.side_effect = lambda: (bot.stop_event.set() or {})
        bot._call = Mock(return_value={"ok": True, "result": [{"update_id": 5, "message": {"chat": {"id": 7, "type": "private"}, "text": "/status"}}]})
        bot.run()
        self.assertEqual(bot._record()["nextUpdateOffset"], 5)

    def test_group_start_cannot_pair_or_receive_snapshot_access(self):
        bot = self.build_bot()
        bot.send_message = Mock()

        bot._handle_message({"chat": {"id": -100, "type": "group"}, "text": "/start"})

        self.assertEqual(bot.state_store.writes, [])
        bot.send_message.assert_not_called()

    def test_failed_message_send_does_not_advance_next_poll_offset(self):
        bot = self.build_bot({"allowedChatIds": [7]})
        bot.stop_event = ImmediateStopEvent()
        bot.send_message = Mock(side_effect=RuntimeError("token-bearing failure"))
        poll_payloads = []

        def call(method, **kwargs):
            if method == "deleteWebhook":
                self.assertNotEqual(kwargs.get("data", {}).get("drop_pending_updates"), "true")
                return {"ok": True, "result": True}
            if method == "getMe":
                return {"ok": True, "result": {"id": 123, "username": "bot"}}
            poll_payloads.append(dict(kwargs.get("data", {})))
            if len(poll_payloads) == 1:
                return {
                    "ok": True,
                    "result": [{"update_id": 41, "message": {"chat": {"id": 7, "type": "private"}, "text": "/status"}}],
                }
            bot.stop_event.set()
            return {"ok": True, "result": []}

        bot._call = call
        bot.run()

        self.assertNotIn("offset", poll_payloads[1])
        self.assertNotIn("secret-token", str(bot.last_error))

    def test_legacy_allowlists_do_not_authorize_first_migrating_bot(self):
        state = {"allowedChatIds": [7]}
        with patch.dict(os.environ, {"PRISMA_LOCAL_ALLOWED_CHAT_IDS": "7"}, clear=True):
            bot = self.build_bot(state)
            bot.send_message = Mock()
            bot._handle_message({"chat": {"id": 7, "type": "private"}, "text": "/status"})

        self.assertEqual(bot.state_store.writes, [])
        bot.send_message.assert_called_once_with(7, "Send /start to pair this local bot.")

    def test_migration_fence_drains_multiple_backlog_batches_before_pairing(self):
        bot = self.build_bot()
        bot.stop_event = ImmediateStopEvent()
        sent = []

        def send(chat_id, text):
            sent.append((chat_id, text))
            if "quedó vinculada" in text:
                bot.stop_event.set()

        bot.send_message = send
        batches = [
            [{"update_id": 1, "message": {"chat": {"id": 7, "type": "private"}, "text": "/start"}}],
            [{"update_id": 2, "message": {"chat": {"id": 7, "type": "private"}, "text": "/start"}}],
            [],
            [{"update_id": 3, "message": {"chat": {"id": 7, "type": "private"}, "text": "/start"}}],
        ]

        def call(method, **_kwargs):
            if method == "deleteWebhook":
                return {"ok": True, "result": True}
            if method == "getMe":
                return {"ok": True, "result": {"id": 123, "username": "bot"}}
            return {"ok": True, "result": batches.pop(0)}

        bot._call = call
        bot.run()

        record = bot.state_store.value["bots"]["123"]
        self.assertEqual(record["pairedPrivateChatIds"], [7])
        self.assertEqual(record["nextUpdateOffset"], 4)
        self.assertFalse(record["migrationActive"])
        self.assertEqual([text for _, text in sent[:2]], ["Send /start again after migration completes."] * 2)

    def test_state_write_failure_retries_same_update_without_acknowledging_it(self):
        state = {
            "schemaVersion": 2,
            "bots": {"123": {"pairedPrivateChatIds": [7], "nextUpdateOffset": None, "migrationActive": False}},
        }
        bot = TelegramLocalBot(
            "secret-token", Mock(), FailingStateStore(state, failures=1), Mock(),
            reservation=BotIdentityReservation(),
        )
        bot.stop_event = ImmediateStopEvent()
        bot._call = identity_transport()
        bot.prepare()
        bot.send_message = Mock()
        poll_payloads = []

        def call(method, **kwargs):
            poll_payloads.append(dict(kwargs["data"]))
            if len(poll_payloads) <= 2:
                return {"ok": True, "result": [{"update_id": 9, "message": {"chat": {"id": 7, "type": "private"}, "text": "/status"}}]}
            bot.stop_event.set()
            return {"ok": True, "result": []}

        bot._call = call
        bot.run()

        self.assertNotIn("offset", poll_payloads[1])
        self.assertEqual(bot.send_message.call_count, 2)
        self.assertEqual(bot.state_store.value["bots"]["123"]["nextUpdateOffset"], 10)

    def test_corrupt_state_fails_closed_instead_of_resetting_pairing(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "chat-state.json"
            path.write_text("{broken", encoding="utf-8")
            repository = TelegramStateRepository(path)
            bot = TelegramLocalBot("secret-token", Mock(), repository, Mock(), reservation=BotIdentityReservation())
            bot._call = identity_transport(username="bot")

            bot.run()

            persisted = path.read_text(encoding="utf-8")

        self.assertEqual(bot.last_error, "TELEGRAM_PREPARATION_FAILED")
        self.assertEqual(persisted, "{broken")

    def test_recognized_legacy_state_starts_explicit_repairing_without_importing_chat_ids(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "chat-state.json"
            path.write_text('{"allowedChatIds":[7]}', encoding="utf-8")
            repository = TelegramStateRepository(path)
            bot = TelegramLocalBot("secret-token", Mock(), repository, Mock(), reservation=BotIdentityReservation())
            bot._call = identity_transport(username="bot")

            bot.prepare()

            persisted = repository.read()
        self.assertEqual(bot.paired_chat_ids, set())
        self.assertTrue(persisted["bots"]["123"]["migrationActive"])

    def test_same_bot_rotation_and_process_restart_retain_only_its_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            repository = TelegramStateRepository(Path(temporary) / "chat-state.json")
            reservation = BotIdentityReservation()

            def rotate(token, bot_id, holder):
                bot = TelegramLocalBot(token, Mock(), repository, Mock(), reservation=holder)
                bot._call = identity_transport(bot_id, "bot")
                bot.prepare()
                return bot

            first = rotate("old-token", 123, reservation)
            first._record().update({"pairedPrivateChatIds": [7], "nextUpdateOffset": 44, "migrationActive": False})
            first._persist()
            # A confirmed stop is what frees the identity for the same channel;
            # a replacement object then sees the retained state.
            self.assertTrue(first.stop())
            rotated = rotate("new-token", 123, reservation)
            different = rotate("different-token", 456, reservation)
            # A process restart starts from an empty registry, not from authority reuse.
            restored = rotate("restored-token", 123, BotIdentityReservation())

        self.assertEqual(rotated.paired_chat_ids, {7})
        self.assertEqual(rotated._record()["nextUpdateOffset"], 44)
        self.assertEqual(different.paired_chat_ids, set())
        self.assertTrue(different._record()["migrationActive"])
        self.assertEqual(restored.paired_chat_ids, {7})

    # --- Cooperative bot identity exclusion ---------------------------------

    def test_prepare_observes_identity_before_webhook_and_state_effects(self):
        reservation = BotIdentityReservation()
        bot = self.build_bot(reservation=reservation)
        calls = []

        def call(method, **_kwargs):
            calls.append(method)
            return {"ok": True, "result": {"id": 123, "username": "prisma_bot"}}

        bot._call = call
        bot.prepare()

        self.assertEqual(calls, ["getMe", "deleteWebhook"])
        self.assertEqual(bot.bot_id, 123)
        self.assertTrue(bot.prepared)
        self.assertEqual(bot.state_store.writes[-1]["bots"]["123"]["migrationActive"], True)
        self.assert_reserved(reservation)

    def test_malformed_observed_identity_produces_no_effect_or_reservation(self):
        reservation = BotIdentityReservation()
        bot = self.build_bot(reservation=reservation)
        calls = []

        def call(method, **_kwargs):
            calls.append(method)
            return {"ok": True, "result": {"id": True, "username": "prisma_bot"}}

        bot._call = call

        with self.assertRaises(RuntimeError):
            bot.prepare()

        self.assertEqual(calls, ["getMe"])
        self.assertIsNone(bot.bot_id)
        self.assertFalse(bot.prepared)
        self.assertEqual(bot.state_store.writes, [])
        self.assertIsNone(reservation.held_by(123))

    def test_a_new_lifecycle_object_cannot_steal_the_live_lease(self):
        reservation = BotIdentityReservation()
        incumbent = self.prepared_bot(reservation=reservation)
        challenger = self.build_bot(reservation=reservation)
        calls = []

        def call(method, **_kwargs):
            calls.append(method)
            return {"ok": True, "result": {"id": 123, "username": "prisma_bot"}}

        challenger._call = call

        with self.assertRaises(BotIdentityReservationError) as raised:
            challenger.prepare()

        self.assertEqual(str(raised.exception), TELEGRAM_BOT_IDENTITY_RESERVED)
        # Only the observation ran; nothing was reserved, written or torn down.
        self.assertEqual(calls, ["getMe"])
        self.assertFalse(challenger.prepared)
        self.assertIsNone(challenger.bot_id)
        self.assertEqual(challenger.state_store.writes, [])
        self.assert_reserved(reservation)
        self.assertIs(incumbent.prepared, True)
        self.assertIsNone(incumbent.last_error)
        self.assertFalse(incumbent.stop_event.is_set())

    def test_repeated_prepare_after_readiness_does_not_reobserve_identity(self):
        reservation = BotIdentityReservation()
        bot = self.prepared_bot(reservation=reservation)
        self.assert_reserved(reservation)
        calls = []

        def call(method, **_kwargs):
            calls.append(method)
            return {"ok": True, "result": {"id": 999, "username": "different_bot"}}

        bot._call = call
        bot.prepare()

        self.assertEqual(calls, [])
        self.assertEqual(bot.bot_id, 123)
        self.assert_reserved(reservation)

    def test_observed_but_unprepared_run_cannot_poll(self):
        bot = self.build_bot()
        calls = []

        def call(method, **_kwargs):
            calls.append(method)
            raise RuntimeError("offline observation")

        bot._call = call
        bot.run()

        self.assertEqual(calls, ["getMe"])
        self.assertEqual(bot.last_error, "TELEGRAM_PREPARATION_FAILED")
        self.assertFalse(bot.prepared)
        self.assertIsNone(bot.thread)

    def test_standalone_prepare_failure_releases_the_lease_once_quiescent(self):
        reservation = BotIdentityReservation()
        bot = self.build_bot(reservation=reservation)

        def call(method, **_kwargs):
            if method == "getMe":
                return {"ok": True, "result": {"id": 123, "username": "prisma_bot"}}
            raise RuntimeError("webhook unavailable")

        bot._call = call

        with self.assertRaises(RuntimeError):
            bot.prepare()

        self.assertFalse(bot.prepared)
        # A known-quiescent standalone failure must not strand the identity until
        # some later caller remembers to stop it.
        self.assertIsNone(reservation.held_by(123))
        self.assertIsNotNone(bot.telegram_diagnostic()["failureAt"])
        # The released object is terminal, so a replacement object can take over.
        with self.assertRaises(RuntimeError) as raised:
            bot.prepare()
        self.assertEqual(str(raised.exception), TELEGRAM_STOPPING)
        self.assertTrue(bot.stop())

    def test_direct_run_prepare_failure_releases_the_lease_once_quiescent(self):
        reservation = BotIdentityReservation()
        bot = self.build_bot(reservation=reservation)

        def call(method, **_kwargs):
            if method == "getMe":
                return {"ok": True, "result": {"id": 123, "username": "prisma_bot"}}
            raise RuntimeError("webhook unavailable")

        bot._call = call
        bot.run()

        self.assertEqual(bot.last_error, "TELEGRAM_PREPARATION_FAILED")
        self.assertFalse(bot.prepared)
        self.assertIsNone(reservation.held_by(123))
        self.assertIsNotNone(bot.telegram_diagnostic()["failureAt"])

    def test_stop_cleanup_fault_retains_the_lease_until_a_confirmed_retry(self):
        reservation = BotIdentityReservation()
        bot = self.prepared_bot(reservation=reservation)
        bot.session = Mock()
        bot.session.close.side_effect = RuntimeError("synthetic teardown fault")

        self.assertFalse(bot.stop())
        self.assert_reserved(reservation)

        bot.session.close.side_effect = None
        self.assertTrue(bot.stop())
        self.assertIsNone(reservation.held_by(123))

    def test_stopped_object_cannot_reactivate_or_restart(self):
        reservation = BotIdentityReservation()
        bot = self.prepared_bot(reservation=reservation)

        self.assertTrue(bot.stop())
        self.assertIsNone(reservation.held_by(123))

        with self.assertRaises(RuntimeError):
            bot.prepare()
        bot.start()

        self.assertIsNone(bot.thread)
        self.assertIsNone(reservation.held_by(123))

    def test_uncertain_stop_retains_the_lease_instead_of_freeing_it(self):
        reservation = BotIdentityReservation()
        bot = self.prepared_bot(reservation=reservation)
        bot.thread = StuckThread()

        self.assertFalse(bot.stop())

        self.assert_reserved(reservation)
        self.assertFalse(bot.stop())
        self.assert_reserved(reservation)

    def test_cleanup_without_a_lease_never_releases_the_incumbent(self):
        reservation = BotIdentityReservation()
        incumbent = self.prepared_bot(reservation=reservation)
        bare = self.build_bot(reservation=reservation)

        self.assertTrue(bare.stop())

        self.assert_reserved(reservation)
        self.assertTrue(incumbent.prepared)

    def test_failed_standalone_prepare_with_a_teardown_fault_fences_activation(self):
        reservation = BotIdentityReservation()
        bot = self.build_bot(reservation=reservation)
        session = RecordingCloseSession(fault_teardown=True)
        bot.session = session
        calls = []

        def call(method, **_kwargs):
            calls.append(method)
            if method == "getMe":
                return {"ok": True, "result": {"id": 123, "username": "prisma_bot"}}
            raise RuntimeError("webhook unavailable")

        bot._call = call

        with self.assertRaises(RuntimeError) as raised:
            bot.prepare()

        self.assertEqual(str(raised.exception), "webhook unavailable")
        self.assertFalse(bot.prepared)
        self.assertEqual(calls, ["getMe", "deleteWebhook"])
        # An uncertain teardown is not a clean release: the identity stays
        # reserved until some later stop can retry the cleanup.
        self.assertGreaterEqual(session.closes, 1)
        self.assert_reserved(reservation)

        # A failed activation is terminal. Nothing may revive this object: no
        # second observation, no second teardown attempt and no dispatched runner.
        self.assert_activation_fenced(bot, session, calls)
        self.assert_reserved(reservation)

        session.fault_teardown = False
        self.assertTrue(bot.stop())
        self.assertIsNone(reservation.held_by(123))
        self.assertFalse(bot.prepared)

    def test_failed_direct_run_with_a_teardown_fault_fences_activation(self):
        state = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [], "nextUpdateOffset": None, "migrationActive": False}}}
        reservation = BotIdentityReservation()
        bot = self.build_bot(state, reservation=reservation)
        session = RecordingCloseSession(fault_teardown=True)
        bot.session = session
        calls = []

        def call(method, **_kwargs):
            calls.append(method)
            if method == "getMe":
                return {"ok": True, "result": {"id": 123, "username": "prisma_bot"}}
            raise RuntimeError("webhook unavailable")

        bot._call = call
        bot.run()

        # The classification of a failed preparation survives the new fence.
        self.assertEqual(bot.last_error, "TELEGRAM_PREPARATION_FAILED")
        self.assertFalse(bot.prepared)
        self.assertEqual(calls, ["getMe", "deleteWebhook"])
        self.assertGreaterEqual(session.closes, 1)
        self.assert_reserved(reservation)

        self.assert_activation_fenced(bot, session, calls)
        self.assert_reserved(reservation)

        session.fault_teardown = False
        self.assertTrue(bot.stop())
        self.assertIsNone(reservation.held_by(123))

    def test_concurrent_prepare_and_stop_release_only_after_effects_finish(self):
        reservation = BotIdentityReservation()
        bot = self.build_bot(reservation=reservation)
        fixture = OwnedThreadFixture(self, lambda: bot.stop_event.set())
        fixture.register_cleanup()
        entered = fixture.watch(threading.Event())
        release_effects = fixture.watch(threading.Event())

        def call(method, **_kwargs):
            if method == "getMe":
                return {"ok": True, "result": {"id": 123, "username": "prisma_bot"}}
            entered.set()
            # A timeout is recorded externally and cancels the bot; it is never an
            # assertion that production's own except-Exception would swallow.
            fixture.await_event(release_effects, "deleteWebhook barrier")
            return {"ok": True, "result": True}

        bot._call = fixture.protect(call)
        outcomes = []
        preparer = fixture.start(lambda: outcomes.append(bot.prepare()), label="prisma-preparer")
        self.assertTrue(entered.wait(5), "the guarded preparation never reached its webhook effect")
        stopper = fixture.start(lambda: outcomes.append(bot.stop()), label="prisma-stopper")

        self.assertIsNotNone(reservation.held_by(123))

        release_effects.set()
        preparer.join(5)
        stopper.join(5)

        fixture.assert_clean()
        self.assertFalse(preparer.is_alive())
        self.assertFalse(stopper.is_alive())
        self.assertIn(True, outcomes)
        self.assertIn(None, outcomes)
        self.assertFalse(bot.prepared)
        self.assertTrue(bot.stop_event.is_set())
        self.assertIsNone(bot.thread)
        self.assertIsNone(reservation.held_by(123))

    def test_completed_finalization_is_idempotent_across_repeated_stops(self):
        reservation = BotIdentityReservation()
        bot = self.prepared_bot(reservation=reservation)
        session = RecordingCloseSession()
        bot.session = session

        self.assertTrue(bot.stop())

        self.assertEqual(session.closes, 1)
        self.assertIsNone(reservation.held_by(123))
        self.assertFalse(bot.prepared)

        # A completed finalization is terminal: a repeated stop must not tear the
        # object down again. The injected fault is the discriminator, so a
        # non-idempotent teardown reports a false failure as well as a second close.
        session.fault_teardown = True
        self.assertTrue(bot.stop())
        self.assertEqual(session.closes, 1)
        self.assertIsNone(reservation.held_by(123))

    def test_runner_settlement_after_a_waiting_stop_does_not_tear_down_again(self):
        state = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [], "nextUpdateOffset": None, "migrationActive": False}}}
        reservation = BotIdentityReservation()
        bot = self.prepared_bot(state, reservation=reservation)
        session = RecordingCloseSession()
        bot.session = session
        fixture = OwnedThreadFixture(self, lambda: bot.stop_event.set())
        fixture.register_cleanup()
        entered = fixture.watch(threading.Event())
        release = fixture.watch(threading.Event())
        settled = fixture.watch(threading.Event())

        def call(_method, **_kwargs):
            entered.set()
            # A timeout is recorded externally and cancels the bot instead of
            # asserting inside production's own except-Exception block.
            fixture.await_event(release, "getUpdates barrier")
            bot.stop_event.set()
            return {"ok": True, "result": []}

        bot._call = fixture.protect(call)

        def owned_runner():
            bot.run()
            settled.set()

        runner = fixture.start(owned_runner, label="prisma-waiting-stop-runner")
        self.assertTrue(entered.wait(5), "the runner never reached its long poll")

        # While the runner is still active the stop is not quiescent, so it must
        # not finalize; the runner that settles last owns the single teardown.
        self.assertFalse(bot.stop())
        self.assertEqual(session.closes, 0)
        self.assert_reserved(reservation)

        release.set()
        self.assertTrue(settled.wait(5), "the runner never settled after it was released")
        runner.join(5)

        fixture.assert_clean()
        self.assertFalse(runner.is_alive())
        self.assertEqual(session.closes, 1)
        self.assertIsNone(reservation.held_by(123))

        # The finalization already completed, so the waiting stop must not close
        # a second time; the injected fault discriminates a false failure.
        session.fault_teardown = True
        self.assertTrue(bot.stop())
        self.assertEqual(session.closes, 1)

    def test_start_never_spawns_a_thread_after_a_stop_fence(self):
        bot = self.build_bot()

        self.assertTrue(bot.stop())
        bot.start()

        self.assertIsNone(bot.thread)
        self.assertEqual(bot.state_store.writes, [])

    def test_default_construction_and_build_telegram_bot_share_the_process_registry(self):
        reservation = process_bot_identity_reservation()
        config = TelegramConfig(enabled=True, token="secret-token")
        default_bot = TelegramLocalBot("secret-token", Mock(), MemoryStateStore(None), Mock())
        built_bot = build_telegram_bot(Mock(), MemoryStateStore(None), Mock(), config=config)
        default_bot._call = identity_transport()
        built_bot._call = identity_transport()
        try:
            default_bot.prepare()

            with self.assertRaises(BotIdentityReservationError):
                built_bot.prepare()

            self.assert_reserved(reservation)
            self.assertFalse(built_bot.prepared)
            self.assertEqual(built_bot.state_store.writes, [])
        finally:
            default_bot.stop()
            built_bot.stop()

        self.assertIsNone(reservation.held_by(123))

    def test_own_reapply_rotation_reacquires_only_after_a_confirmed_stop(self):
        reservation = BotIdentityReservation()
        replacements = []

        def factory(_token):
            bot = TelegramLocalBot("secret-token", Mock(), MemoryStateStore(None), Mock(), reservation=reservation)
            bot._call = identity_transport()
            bot.start = Mock()
            replacements.append(bot)
            return bot

        manager = TelegramLifecycleManager(
            TelegramConfig(enabled=True, token="secret-token"),
            Mock(source="environment", resolve=Mock(return_value="secret-token")),
            Mock(),
            factory,
        )

        self.assertTrue(manager.apply()["running"])
        self.assertTrue(manager.apply()["running"])

        self.assertEqual(len(replacements), 2)
        self.assert_reserved(reservation, bot_id=123)

    def test_factory_failure_normalizes_to_a_safe_provider_status(self):
        manager = TelegramLifecycleManager(
            TelegramConfig(enabled=True, token="secret-token"),
            Mock(source="environment", resolve=Mock(return_value="secret-token")),
            Mock(),
            Mock(side_effect=RuntimeError("raw-factory-detail")),
        )

        with self.assertRaises(TelegramLifecycleError) as raised:
            manager.apply()

        self.assertEqual(raised.exception.args[0], "TELEGRAM_PROVIDER_UNAVAILABLE")
        self.assertNotIn("raw-factory-detail", str(raised.exception))
        status = manager.status()
        self.assertEqual(status["lastError"], "TELEGRAM_PROVIDER_UNAVAILABLE")
        self.assertIsNone(manager.bot)
        self.assertIsNone(status["telegramDiagnostic"])

    def test_same_thread_stop_during_preparation_fences_later_effects(self):
        reservation = BotIdentityReservation()
        bot = self.build_bot(reservation=reservation)
        stop_outcomes = []

        def call(method, **_kwargs):
            if method == "getMe":
                return {"ok": True, "result": {"id": 123, "username": "prisma_bot"}}
            # A foreign callback re-enters stop() on the same thread while the
            # guarded preparation still has later effects pending.
            stop_outcomes.append(bot.stop())
            return {"ok": True, "result": True}

        bot._call = call

        with self.assertRaises(RuntimeError) as raised:
            bot.prepare()

        self.assertEqual(str(raised.exception), TELEGRAM_STOPPING)
        self.assertEqual(stop_outcomes, [False])
        self.assertEqual(bot.state_store.writes, [])
        self.assertFalse(bot.prepared)
        self.assertIsNone(reservation.held_by(123))

    def test_direct_runner_registers_activity_so_stop_retains_authority_until_quiescent(self):
        state = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [], "nextUpdateOffset": None, "migrationActive": False}}}
        reservation = BotIdentityReservation()
        bot = self.prepared_bot(state, reservation=reservation)
        fixture = OwnedThreadFixture(self, lambda: bot.stop_event.set())
        fixture.register_cleanup()
        entered = fixture.watch(threading.Event())
        release = fixture.watch(threading.Event())

        def call(_method, **_kwargs):
            entered.set()
            # A timeout is recorded externally and cancels the bot instead of
            # asserting inside production's own except-Exception block.
            fixture.await_event(release, "getUpdates barrier")
            bot.stop_event.set()
            return {"ok": True, "result": []}

        bot._call = fixture.protect(call)
        runner = fixture.start(bot.run, label="prisma-direct-runner")
        self.assertTrue(entered.wait(5), "the direct runner never reached its long poll")

        # The direct runner is not published through ``thread``, so only real
        # owned activity can keep the lease from being released under an
        # outstanding getUpdates.
        self.assertIsNone(bot.thread)
        self.assertFalse(bot.stop())
        self.assert_reserved(reservation)

        release.set()
        runner.join(5)

        fixture.assert_clean()
        self.assertFalse(runner.is_alive())
        self.assertIsNone(reservation.held_by(123))

    def test_at_most_one_runner_wins_between_direct_and_managed_start(self):
        state = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [], "nextUpdateOffset": None, "migrationActive": False}}}
        bot = self.prepared_bot(state)
        fixture = OwnedThreadFixture(self, lambda: bot.stop_event.set())
        fixture.register_cleanup()
        entered = fixture.watch(threading.Event())
        release = fixture.watch(threading.Event())
        active, peak = [], []
        counts = threading.Lock()

        def call(_method, **_kwargs):
            with counts:
                active.append(1)
                peak.append(len(active))
            entered.set()
            # A timeout is recorded externally and cancels the bot, so no runner
            # can keep polling while the test body is failing.
            fixture.await_event(release, "getUpdates barrier")
            with counts:
                active.pop()
            bot.stop_event.set()
            return {"ok": True, "result": []}

        bot._call = fixture.protect(call)
        first = fixture.start(bot.run, label="prisma-direct-runner")
        self.assertTrue(entered.wait(5), "the first runner never reached its long poll")

        duplicate = fixture.start(bot.run, label="prisma-duplicate-runner")
        duplicate.join(5)
        bot.start()
        # A managed runner is production-owned, so track it explicitly before any
        # assertion can fail; an unstarted slot stays None and is skipped safely.
        fixture.own(bot.thread)

        self.assertFalse(duplicate.is_alive())
        self.assertIsNone(bot.thread)

        release.set()
        first.join(5)

        fixture.assert_clean()
        self.assertFalse(first.is_alive())
        self.assertEqual(max(peak), 1)

    def test_stopped_direct_runner_does_not_persist_migration_completion(self):
        state = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [], "nextUpdateOffset": None, "migrationActive": True}}}
        bot = self.prepared_bot(state)

        def call(_method, **_kwargs):
            # The fence lands while the long poll is in flight, so the late empty
            # payload must not complete the migration handshake.
            bot.stop_event.set()
            return {"ok": True, "result": []}

        bot._call = call
        bot.run()

        self.assertEqual(bot.state_store.writes, [])
        self.assertTrue(bot._record()["migrationActive"])

    def test_managed_runner_stop_from_its_own_thread_does_not_deadlock(self):
        state = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [], "nextUpdateOffset": None, "migrationActive": False}}}
        reservation = BotIdentityReservation()
        bot = self.prepared_bot(state, reservation=reservation)
        fixture = OwnedThreadFixture(self, lambda: bot.stop_event.set())
        fixture.register_cleanup()
        stop_outcomes = []

        def call(_method, **_kwargs):
            stop_outcomes.append(bot.stop())
            return {"ok": True, "result": []}

        bot._call = fixture.protect(call)
        bot.start()
        # Production owns this runner, so track it explicitly before any assertion
        # can fail; None means no runner was spawned and is skipped safely.
        managed = fixture.own(bot.thread)
        self.assertIsNotNone(managed, "the managed runner never started")
        managed.join(5)

        fixture.assert_clean()
        self.assertFalse(managed.is_alive())
        self.assertEqual(stop_outcomes, [False])
        self.assertIsNone(reservation.held_by(123))

    def test_owned_thread_teardown_cancels_releases_and_joins_after_a_failure(self):
        """Prove the fixture still cleans up when a case fails before it releases.

        The nested case raises an intentional failure and never releases its own
        barrier, then also runs an inert worker that raises. That failure is the
        expected evidence: the outer assertions require the nested run to fail, to
        have cancelled and released before its joins, to have joined every owned
        thread, and to have surfaced the worker error externally. Nothing here
        touches a transport, so no lower inert floor is needed.
        """
        recorded = {}

        class InertBarrierWorker:
            def __init__(self):
                self.cancelled = False

            def cancel(self):
                self.cancelled = True

        class FailingFixtureCase(unittest.TestCase):
            def runTest(inner):
                worker = InertBarrierWorker()
                fixture = OwnedThreadFixture(inner, worker.cancel)
                fixture.register_cleanup()
                barrier = fixture.watch(threading.Event())

                def wait_for_barrier():
                    fixture.await_event(barrier, "inert-barrier-worker")

                def raise_inert_failure():
                    raise RuntimeError("inert worker failure")

                fixture.start(wait_for_barrier, label="prisma-inert-barrier-worker")
                fixture.start(raise_inert_failure, label="prisma-inert-error-worker")
                recorded["worker"] = worker
                recorded["fixture"] = fixture
                recorded["barrier"] = barrier
                recorded["threads"] = fixture.owned_threads()
                inner.assertFalse(worker.cancelled, "teardown must be the first canceller")
                raise AssertionError("intentional nested failure before barrier release")

        result = unittest.TestResult(stream=io.StringIO())
        FailingFixtureCase().run(result)

        worker = recorded["worker"]
        fixture = recorded["fixture"]
        rendered = "\n".join(text for _, text in result.errors + result.failures)
        # One entry for the intentional test failure and one for the surfaced
        # inert worker error: an intentional failure is never a clean pass.
        self.assertGreaterEqual(len(result.errors) + len(result.failures), 2)
        self.assertIn("an owned callback or thread raised an unexpected error", rendered)
        self.assertTrue(worker.cancelled, "teardown never requested cancellation")
        self.assertTrue(recorded["barrier"].is_set(), "teardown never released the fake barrier")
        self.assertFalse(any(thread.is_alive() for thread in recorded["threads"]), "teardown left an owned thread alive")
        timeouts, errors = fixture.outcomes()
        self.assertEqual(timeouts, [])
        self.assertEqual([type(error) for error in errors], [RuntimeError])

    def test_offline_guard_fails_an_unmocked_poll_that_would_hide_as_a_poll_error(self):
        """Prove the guard discriminates when production code swallows the cause.

        An unmocked bot whose only symptom is ``TELEGRAM_POLL_FAILED`` would let a
        silently network-reaching test pass. The guard must record and refuse the
        attempt, and the cleanup assertion must fail the run from outside the
        production ``except Exception`` block.
        """
        recorded = {}

        class GuardProbe(unittest.TestCase):
            def runTest(inner):
                # Inert floor first: no version of the code can reach the network.
                recorded["floor"] = install_inert_transport_floor(inner)
                recorded["guard"] = install_offline_dispatch_guard(inner)
                probe_bot = TelegramLocalBot(
                    "token", Mock(), MemoryStateStore(None), Mock(), reservation=BotIdentityReservation()
                )
                recorded["bot"] = probe_bot
                probe_bot.run()

        result = unittest.TestResult(stream=io.StringIO())
        GuardProbe().run(result)

        self.assertFalse(result.wasSuccessful())
        self.assertEqual(len(result.errors) + len(result.failures), 1)
        self.assertEqual(recorded["guard"], [1])
        self.assertEqual(recorded["floor"], [])
        self.assertEqual(recorded["bot"].last_error, "TELEGRAM_PREPARATION_FAILED")
        self.assertIsNone(recorded["bot"].bot_id)


if __name__ == "__main__":
    unittest.main()
