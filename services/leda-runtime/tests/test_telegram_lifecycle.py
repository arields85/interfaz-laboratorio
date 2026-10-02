import copy
import io
import json
import os
import sys
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests


RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from leda_runtime.bot_identity_reservation import (
    TELEGRAM_BOT_IDENTITY_RESERVED,
    BotIdentityReservation,
    BotIdentityReservationError,
    process_bot_identity_reservation,
)
from leda_runtime.channel_b_admission import ChatMessageLimiter
from leda_runtime.hmi_sessions import HmiSessionRegistry
from leda_runtime.local_presentation import (
    CHANNEL_B_VOICE_QUEUE_MAX_PENDING,
    MAX_PENDING_ACCESS_REQUESTS,
    NO_DASHBOARD_OPEN_REPLY,
    TELEGRAM_STOPPING,
    TelegramLocalBot,
    build_telegram_bot,
)
from leda_runtime.telegram_config import TelegramConfig
from leda_runtime.telegram_lifecycle import (
    STATE_SCHEMA_VERSION,
    TelegramChatNotFound,
    TelegramInvalidTransition,
    TelegramLifecycleError,
    TelegramLifecycleManager,
    TelegramStateRepository,
    TelegramStateUnavailable,
    empty_telegram_state,
    validate_telegram_state,
)
from leda_runtime.voice_events import VoiceEventStore
from leda_runtime.voice_transcription import (
    MAX_VOICE_NOTE_DURATION_SECONDS,
    MAX_VOICE_NOTE_FILE_SIZE_BYTES,
    VoiceTranscriptionEmpty,
    VoiceTranscriptionUnavailable,
)


class MemoryStateStore(TelegramStateRepository):
    """In-memory repository: the real operations (update, add_pending, set_status, set_offset...) over a dict."""

    def __init__(self, value=None):
        super().__init__(Path("memory-state-store.json"))
        self.value = value
        self.writes = []

    def read(self):
        if self.value is None or (isinstance(self.value, dict) and "schemaVersion" not in self.value):
            return empty_telegram_state()
        return validate_telegram_state(copy.deepcopy(self.value))

    def write(self, value):
        validated = validate_telegram_state(value)
        self.value = validated
        self.writes.append(validated)


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


STAMP = "2026-10-01T12:00:00Z"


def approved_chat(**overrides):
    chat = {"status": "approved", "displayName": "", "username": None, "requestedAt": STAMP, "decidedAt": STAMP}
    chat.update(overrides)
    return chat


def pending_chat(**overrides):
    chat = {"status": "pending", "displayName": "Ana", "username": "ana", "requestedAt": STAMP, "decidedAt": None}
    chat.update(overrides)
    return chat


def v3_state(chats=None, offset=None, migration_active=False):
    return {"schemaVersion": 3, "bots": {"123": {"chats": dict(chats or {}), "nextUpdateOffset": offset, "migrationActive": migration_active}}}


def identity_transport(bot_id=123, username="leda_bot"):
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
        bot = TelegramLocalBot(
            "secret-token",
            Mock(),
            MemoryStateStore(state),
            Mock(),
            reservation=reservation if reservation is not None else BotIdentityReservation(),
        )
        # F6 (live test 2026-09-25): _typing spawns a real background thread
        # that calls _call("sendChatAction", ...) -- this offline-guarded
        # suite must never dispatch it unmocked. Dedicated typing-indicator
        # tests (ChannelBTypingIndicatorTests) construct their own bot
        # directly instead of using this helper.
        bot._typing = Mock(return_value=None)
        return bot

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

    def test_ready_reply_for_an_already_paired_chat_never_mentions_a_screen(self):
        state = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [7], "nextUpdateOffset": None, "migrationActive": False}}}
        bot = self.prepared_bot(state)
        bot.send_message = Mock()

        bot._handle_message({"chat": {"id": 7, "type": "private"}, "text": "/start"})

        bot.send_message.assert_called_once_with(7, "Leda está lista para responder sus consultas.")

    def test_unidentified_bot_fails_closed_instead_of_answering_anyone(self):
        bot = self.build_bot()
        bot.send_message = Mock()

        with self.assertRaises(TelegramStateUnavailable):
            bot._handle_message({"chat": {"id": 7, "type": "private"}, "text": "/start"})

        bot.send_message.assert_not_called()
        self.assertEqual(bot.state_store.writes, [])

    def test_status_reply_never_mentions_a_snapshot_or_presentation(self):
        state = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [7], "nextUpdateOffset": None, "migrationActive": False}}}
        bot = self.prepared_bot(state)
        bot.send_message = Mock()
        bot.snapshot_store.read = Mock(return_value={"timestamp": "2026-09-23T10:00:00Z"})

        bot._handle_message({"chat": {"id": 7, "type": "private"}, "text": "/status"})

        bot.send_message.assert_called_once_with(7, "Leda está activa. Última actualización de datos: 2026-09-23T10:00:00Z.")

    def test_status_reply_without_a_snapshot_reports_no_data(self):
        state = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [7], "nextUpdateOffset": None, "migrationActive": False}}}
        bot = self.prepared_bot(state)
        bot.send_message = Mock()
        bot.snapshot_store.read = Mock(return_value=None)

        bot._handle_message({"chat": {"id": 7, "type": "private"}, "text": "/status"})

        bot.send_message.assert_called_once_with(7, "Leda está activa. Última actualización de datos: sin datos.")

    def test_legacy_allowlists_do_not_authorize_first_migrating_bot(self):
        state = {"allowedChatIds": [7]}
        with patch.dict(os.environ, {"LEDA_LOCAL_ALLOWED_CHAT_IDS": "7"}, clear=True):
            bot = self.prepared_bot(state)
            bot.send_message = Mock()
            bot._handle_message({"chat": {"id": 7, "type": "private"}, "text": "/status"})

        self.assertIsNone(bot.state_store.status_of(123, 7))
        bot.send_message.assert_called_once_with(7, "Para solicitar acceso, envíe /start.")

    def test_migration_fence_drains_multiple_backlog_batches_before_requesting_access(self):
        bot = self.build_bot()
        bot.stop_event = ImmediateStopEvent()
        sent = []

        def send(chat_id, text):
            sent.append((chat_id, text))
            if "solicitud de acceso quedó registrada" in text:
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
        self.assertEqual({chat_id: chat["status"] for chat_id, chat in record["chats"].items()}, {"7": "pending"})
        self.assertNotIn("pairedPrivateChatIds", record)
        self.assertEqual(record["nextUpdateOffset"], 4)
        self.assertFalse(record["migrationActive"])
        self.assertEqual([text for _, text in sent[:2]], ["Envíe /start nuevamente cuando finalice la migración."] * 2)

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
            paired = bot.paired_chat_ids
        self.assertEqual(paired, set())
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
            repository.write(v3_state({"7": approved_chat()}, offset=44))
            # A confirmed stop is what frees the identity for the same channel;
            # a replacement object then sees the retained state.
            self.assertTrue(first.stop())
            rotated = rotate("new-token", 123, reservation)
            different = rotate("different-token", 456, reservation)
            # A process restart starts from an empty registry, not from authority reuse.
            restored = rotate("restored-token", 123, BotIdentityReservation())

            # The bot reads its state fresh, so the checks run while the file exists.
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
            return {"ok": True, "result": {"id": 123, "username": "leda_bot"}}

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
            return {"ok": True, "result": {"id": True, "username": "leda_bot"}}

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
            return {"ok": True, "result": {"id": 123, "username": "leda_bot"}}

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
                return {"ok": True, "result": {"id": 123, "username": "leda_bot"}}
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
                return {"ok": True, "result": {"id": 123, "username": "leda_bot"}}
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
                return {"ok": True, "result": {"id": 123, "username": "leda_bot"}}
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
                return {"ok": True, "result": {"id": 123, "username": "leda_bot"}}
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
                return {"ok": True, "result": {"id": 123, "username": "leda_bot"}}
            entered.set()
            # A timeout is recorded externally and cancels the bot; it is never an
            # assertion that production's own except-Exception would swallow.
            fixture.await_event(release_effects, "deleteWebhook barrier")
            return {"ok": True, "result": True}

        bot._call = fixture.protect(call)
        outcomes = []
        preparer = fixture.start(lambda: outcomes.append(bot.prepare()), label="leda-preparer")
        self.assertTrue(entered.wait(5), "the guarded preparation never reached its webhook effect")
        stopper = fixture.start(lambda: outcomes.append(bot.stop()), label="leda-stopper")

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

        runner = fixture.start(owned_runner, label="leda-waiting-stop-runner")
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
                return {"ok": True, "result": {"id": 123, "username": "leda_bot"}}
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
        runner = fixture.start(bot.run, label="leda-direct-runner")
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
        first = fixture.start(bot.run, label="leda-direct-runner")
        self.assertTrue(entered.wait(5), "the first runner never reached its long poll")

        duplicate = fixture.start(bot.run, label="leda-duplicate-runner")
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

                fixture.start(wait_for_barrier, label="leda-inert-barrier-worker")
                fixture.start(raise_inert_failure, label="leda-inert-error-worker")
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


def channel_b_snapshot():
    """Minimal snapshot exercising the same widget shapes as
    test_local_presentation.demo_snapshot(), trimmed to the two answers these
    tests need."""
    return {
        "widgets": [
            {"id": "oee", "title": "OEE", "type": "metric-card", "value": 88.6, "unit": "%"},
            {"id": "lote", "title": "Lote: BT-2407", "type": "text-title", "value": "Lote: BT-2407"},
        ]
    }


class ChannelBVoiceReplyTests(unittest.TestCase):
    """B1: after TelegramLocalBot answers a Channel B question with text, it
    must also request a same-text voice note for the same chat, as a reply to
    the question message, from the voice process -- without ever publishing
    through the shared HMI voice_events store (Channel B has no HMI owner and
    must never reach the orb; see channel_a_on_outcome for the HMI-owned
    counterpart this deliberately does not reuse)."""

    def setUp(self):
        install_offline_dispatch_guard(self)

    def build_bot(self, *, voice_events=None, voice_url="http://127.0.0.1:5056", local_http=None):
        state = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [7], "nextUpdateOffset": None, "migrationActive": False}}}
        bot = TelegramLocalBot(
            "secret-token", Mock(), MemoryStateStore(state),
            voice_events if voice_events is not None else VoiceEventStore(),
            reservation=BotIdentityReservation(), voice_url=voice_url, local_http=local_http,
        )
        bot._call = identity_transport()
        bot.prepare()
        bot.snapshot_store.read = Mock(return_value=channel_b_snapshot())
        bot.send_message = Mock()
        bot._typing = Mock(return_value=None)  # F6: see TelegramLifecycleTests.build_bot
        return bot

    def test_answer_triggers_exactly_one_voice_request_for_the_same_text_chat_and_question(self):
        import leda_runtime.local_presentation as local_presentation_module

        fired = threading.Event()
        captured = {}

        def fake_fire(local_http, voice_url, token):
            captured["voice_url"] = voice_url
            captured["token"] = token
            fired.set()

        events = VoiceEventStore()
        bot = self.build_bot(voice_events=events, local_http=Mock())
        with patch.object(local_presentation_module, "_fire_channel_b_voice_reply", side_effect=fake_fire) as fire:
            bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 55, "text": "¿Cuál es el OEE?"})

        self.assertTrue(fired.wait(2), "channel B voice reply was never fired")
        fire.assert_called_once()
        bot.send_message.assert_called_once_with(7, "El OEE actual es 88,6 %.")
        self.assertEqual(captured["voice_url"], "http://127.0.0.1:5056")
        payload = events.resolve_channel_b_reply_token(captured["token"])
        self.assertEqual(payload, {"chatId": 7, "text": "El OEE actual es 88,6 %.", "replyToMessageId": 55})

    def test_informational_replies_never_trigger_a_voice_request(self):
        import leda_runtime.local_presentation as local_presentation_module

        events = VoiceEventStore()
        bot = self.build_bot(voice_events=events, local_http=Mock())
        with patch.object(local_presentation_module, "_fire_channel_b_voice_reply") as fire:
            bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 1, "text": "/start"})
            bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 2, "text": "/status"})
            bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 3, "text": "/help"})

        fire.assert_not_called()

    def test_overlapping_requests_for_the_same_chat_are_queued_and_processed_in_order(self):
        """B1b (user decision): a chat that asks again before its previous
        voice note finished no longer loses that voice note -- both are
        delivered, sequentially, each as a reply to its own question."""
        import leda_runtime.local_presentation as local_presentation_module

        release_first = threading.Event()
        entered_first = threading.Event()
        fire_calls = []

        def blocking_fire(local_http, voice_url, token):
            fire_calls.append(token)
            if len(fire_calls) == 1:
                entered_first.set()
                release_first.wait(2)

        events = VoiceEventStore()
        bot = self.build_bot(voice_events=events, local_http=Mock())
        try:
            with patch.object(local_presentation_module, "_fire_channel_b_voice_reply", side_effect=blocking_fire):
                bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 10, "text": "¿Cuál es el OEE?"})
                self.assertTrue(entered_first.wait(2), "first voice request never started")
                bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 11, "text": "¿Qué lote está activo?"})
                # Release and drain the queue while the patch is still active:
                # the second (queued) item's own dispatch call must still
                # resolve to this test's mocked _fire_channel_b_voice_reply.
                release_first.set()
                for worker in threading.enumerate():
                    if worker.name == "LedaChannelBVoiceReply":
                        worker.join(timeout=2)
        finally:
            release_first.set()

        self.assertEqual(len(fire_calls), 2, "both overlapping requests must be delivered, not dropped")
        payloads = [events.resolve_channel_b_reply_token(token) for token in fire_calls]
        self.assertEqual(payloads, [
            {"chatId": 7, "text": "El OEE actual es 88,6 %.", "replyToMessageId": 10},
            {"chatId": 7, "text": "El lote activo es BT-2407.", "replyToMessageId": 11},
        ])
        self.assertEqual(bot.send_message.call_count, 2, "both text answers must still be sent")

    def test_a_fourth_overlapping_request_when_three_are_already_pending_goes_text_only(self):
        import leda_runtime.local_presentation as local_presentation_module

        self.assertEqual(CHANNEL_B_VOICE_QUEUE_MAX_PENDING, 3)
        release_first = threading.Event()
        entered_first = threading.Event()
        fire_calls = []

        def blocking_fire(local_http, voice_url, token):
            fire_calls.append(token)
            if len(fire_calls) == 1:
                entered_first.set()
                release_first.wait(2)

        events = VoiceEventStore()
        bot = self.build_bot(voice_events=events, local_http=Mock())
        try:
            with patch.object(local_presentation_module, "_fire_channel_b_voice_reply", side_effect=blocking_fire):
                bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 20, "text": "¿Cuál es el OEE?"})
                self.assertTrue(entered_first.wait(2), "first voice request never started")
                # Two more fit within the 3-pending bound (the in-flight one
                # plus two queued).
                bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 21, "text": "¿Qué lote está activo?"})
                bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 22, "text": "¿Cuál es el OEE?"})
                # A fourth overlapping question exceeds the bound: text-only,
                # no voice request queued.
                bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 23, "text": "¿Qué lote está activo?"})
                release_first.set()
                for worker in threading.enumerate():
                    if worker.name == "LedaChannelBVoiceReply":
                        worker.join(timeout=2)
        finally:
            release_first.set()

        self.assertEqual(len(fire_calls), 3, "only the 3 bounded pending voice notes must be delivered")
        self.assertEqual(bot.send_message.call_count, 4, "every question still receives its text answer")

    def test_a_failing_item_in_the_middle_of_the_queue_never_blocks_the_rest(self):
        import leda_runtime.local_presentation as local_presentation_module

        release_first = threading.Event()
        entered_first = threading.Event()
        fire_calls = []

        def fire(local_http, voice_url, token):
            fire_calls.append(token)
            if len(fire_calls) == 1:
                entered_first.set()
                release_first.wait(2)
                return
            if len(fire_calls) == 2:
                raise RuntimeError("boom")

        events = VoiceEventStore()
        bot = self.build_bot(voice_events=events, local_http=Mock())
        try:
            with patch.object(local_presentation_module, "_fire_channel_b_voice_reply", side_effect=fire):
                bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 30, "text": "¿Cuál es el OEE?"})
                self.assertTrue(entered_first.wait(2), "first voice request never started")
                bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 31, "text": "¿Qué lote está activo?"})
                bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 32, "text": "¿Cuál es el OEE?"})
                release_first.set()
                for worker in threading.enumerate():
                    if worker.name == "LedaChannelBVoiceReply":
                        worker.join(timeout=2)
        finally:
            release_first.set()

        self.assertEqual(len(fire_calls), 3, "a failing item must not block the rest of the queue")
        self.assertEqual(bot.send_message.call_count, 3)

    def test_mint_or_dispatch_failure_never_raises_or_touches_the_text_reply(self):
        import leda_runtime.local_presentation as local_presentation_module

        events = VoiceEventStore()
        bot = self.build_bot(voice_events=events, local_http=Mock())
        fired = threading.Event()

        def failing_fire(local_http, voice_url, token):
            fired.set()
            raise RuntimeError("boom")

        with patch.object(local_presentation_module, "_fire_channel_b_voice_reply", side_effect=failing_fire):
            bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 12, "text": "¿Cuál es el OEE?"})

        self.assertTrue(fired.wait(2), "dispatch was never attempted")
        bot.send_message.assert_called_once_with(7, "El OEE actual es 88,6 %.")

    def test_channel_b_never_publishes_an_hmi_voice_event(self):
        import leda_runtime.local_presentation as local_presentation_module

        events = VoiceEventStore()
        bot = self.build_bot(voice_events=events, local_http=Mock())
        fired = threading.Event()
        with patch.object(local_presentation_module, "_fire_channel_b_voice_reply", side_effect=lambda *a, **k: fired.set()), \
                patch.object(events, "publish", wraps=events.publish) as publish:
            bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 13, "text": "¿Cuál es el OEE?"})
            self.assertTrue(fired.wait(2), "voice reply was never fired")

        publish.assert_not_called()
        self.assertIsNone(events.latest("any-owner"))

    def test_missing_voice_wiring_never_raises(self):
        bot = self.build_bot(voice_url=None, local_http=None)

        bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 14, "text": "¿Cuál es el OEE?"})

        bot.send_message.assert_called_once_with(7, "El OEE actual es 88,6 %.")


def voice_note_message(chat_id, message_id, *, duration=5, file_id="voice-file-1", file_size=1024, mime_type="audio/ogg"):
    """One private voice-note message envelope for Channel B (PW-013)."""
    return {
        "chat": {"id": chat_id, "type": "private"},
        "message_id": message_id,
        "voice": {"duration": duration, "file_id": file_id, "file_size": file_size, "mime_type": mime_type},
    }


class ChannelBVoiceNoteQuestionTests(unittest.TestCase):
    """PW-013: Channel B accepts a voice note as a spoken question, transcribes
    it, and answers exactly like the equivalent typed text -- no transcript
    echo, same downstream (answer_from_snapshot + the existing voice-reply
    pipeline)."""

    def setUp(self):
        install_offline_dispatch_guard(self)

    def build_bot(self, *, voice_url="http://127.0.0.1:5056", local_http=None, paired=True):
        paired_ids = [7] if paired else []
        state = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": paired_ids, "nextUpdateOffset": None, "migrationActive": False}}}
        bot = TelegramLocalBot(
            "secret-token", Mock(), MemoryStateStore(state), VoiceEventStore(),
            reservation=BotIdentityReservation(), voice_url=voice_url, local_http=local_http,
        )
        bot._call = identity_transport()
        bot.prepare()
        bot.snapshot_store.read = Mock(return_value=channel_b_snapshot())
        bot.send_message = Mock()
        bot._typing = Mock(return_value=None)  # F6: see TelegramLifecycleTests.build_bot
        return bot

    def wire_download(self, bot, *, file_path="voice/file_1.oga", audio_chunks=(b"fake-ogg-audio",), get_file_error=None, download_error=None):
        def fake_call(method, *, timeout=35, **kwargs):
            if method == "getFile":
                if get_file_error is not None:
                    raise get_file_error
                return {"ok": True, "result": {"file_path": file_path}}
            raise AssertionError(f"unexpected _call in a voice-note test: {method}")

        bot._call = fake_call
        response = Mock()
        if download_error is not None:
            response.raise_for_status = Mock(side_effect=download_error)
        else:
            response.raise_for_status = Mock()
        response.iter_content = Mock(return_value=list(audio_chunks))
        response.close = Mock()
        bot.session = Mock()
        bot.session.get = Mock(return_value=response)
        return response

    def test_a_voice_note_is_transcribed_and_answered_like_typed_text(self):
        import leda_runtime.local_presentation as local_presentation_module

        bot = self.build_bot(local_http=Mock())
        self.wire_download(bot)
        with patch.object(local_presentation_module, "_request_voice_transcription", return_value="¿cuál es el oee?") as request, \
                patch.object(local_presentation_module, "_fire_channel_b_voice_reply"):
            bot._handle_message(voice_note_message(7, 40))

        bot.send_message.assert_called_once_with(7, "El OEE actual es 88,6 %.")
        request.assert_called_once()
        # No transcript echo: the only reply sent is the answer, never the
        # transcript itself.
        self.assertNotIn("¿cuál es el oee?", [call.args[1] for call in bot.send_message.call_args_list])

    def test_authorization_runs_before_any_download(self):
        bot = self.build_bot(local_http=Mock(), paired=False)
        self.wire_download(bot)
        with patch.object(bot.session, "get") as session_get:
            bot._handle_message(voice_note_message(7, 41))

        bot.send_message.assert_called_once_with(7, "Para solicitar acceso, envíe /start.")
        session_get.assert_not_called()

    def test_a_voice_note_over_the_duration_cap_is_rejected_before_any_download(self):
        bot = self.build_bot(local_http=Mock())
        with patch.object(bot.session, "get") as session_get:
            bot._handle_message(voice_note_message(7, 42, duration=MAX_VOICE_NOTE_DURATION_SECONDS + 1))

        session_get.assert_not_called()
        self.assertIn("30 segundos", bot.send_message.call_args.args[1])

    def test_a_voice_note_over_the_size_cap_is_rejected_before_any_download(self):
        bot = self.build_bot(local_http=Mock())
        with patch.object(bot.session, "get") as session_get:
            bot._handle_message(voice_note_message(7, 43, file_size=MAX_VOICE_NOTE_FILE_SIZE_BYTES + 1))

        session_get.assert_not_called()
        bot.send_message.assert_called_once()

    def test_a_download_failure_replies_and_never_reaches_transcription(self):
        import leda_runtime.local_presentation as local_presentation_module

        bot = self.build_bot(local_http=Mock())
        self.wire_download(bot, get_file_error=RuntimeError("boom"))
        with patch.object(local_presentation_module, "_request_voice_transcription") as request:
            bot._handle_message(voice_note_message(7, 44))

        request.assert_not_called()
        bot.send_message.assert_called_once()

    def test_an_empty_downloaded_file_replies_and_never_raises(self):
        """A 0-byte download must never escape as an uncaught ValueError from
        mint_voice_transcription_token (which rejects an empty payload) --
        that would break the caller's update-offset bookkeeping and cause
        the same update to be reprocessed forever."""
        import leda_runtime.local_presentation as local_presentation_module

        bot = self.build_bot(local_http=Mock())
        self.wire_download(bot, audio_chunks=())
        with patch.object(local_presentation_module, "_request_voice_transcription") as request:
            bot._handle_message(voice_note_message(7, 49))

        request.assert_not_called()
        bot.send_message.assert_called_once()

    def test_an_empty_transcript_replies_and_never_answers(self):
        import leda_runtime.local_presentation as local_presentation_module

        bot = self.build_bot(local_http=Mock())
        self.wire_download(bot)
        with patch.object(local_presentation_module, "_request_voice_transcription", side_effect=VoiceTranscriptionEmpty("x")), \
                patch.object(local_presentation_module, "answer_from_snapshot") as parse:
            bot._handle_message(voice_note_message(7, 45))

        parse.assert_not_called()
        bot.send_message.assert_called_once()

    def test_a_provider_failure_replies_and_never_crashes(self):
        import leda_runtime.local_presentation as local_presentation_module

        bot = self.build_bot(local_http=Mock())
        self.wire_download(bot)
        with patch.object(local_presentation_module, "_request_voice_transcription", side_effect=VoiceTranscriptionUnavailable("x")):
            bot._handle_message(voice_note_message(7, 46))

        bot.send_message.assert_called_once()

    def test_missing_voice_wiring_replies_and_never_crashes(self):
        bot = self.build_bot(voice_url=None, local_http=None)
        self.wire_download(bot)

        bot._handle_message(voice_note_message(7, 47))

        bot.send_message.assert_called_once()

    def test_domain_terms_from_the_active_snapshot_reach_the_minted_token(self):
        events = VoiceEventStore()
        bot = TelegramLocalBot(
            "secret-token", Mock(), MemoryStateStore({"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [7], "nextUpdateOffset": None, "migrationActive": False}}}),
            events, reservation=BotIdentityReservation(), voice_url="http://127.0.0.1:5056", local_http=Mock(),
        )
        bot._call = identity_transport()
        bot.prepare()
        bot.snapshot_store.read = Mock(return_value={
            "widgets": channel_b_snapshot()["widgets"],
            "machine": {"machineId": 10, "name": "FT2000"},
        })
        bot.send_message = Mock()
        self.wire_download(bot)
        import leda_runtime.local_presentation as local_presentation_module

        with patch.object(local_presentation_module, "_request_voice_transcription", return_value="¿cuál es el oee?") as request:
            bot._handle_message(voice_note_message(7, 48))

        token = request.call_args.args[2]
        payload = events.resolve_voice_transcription_token(token)
        self.assertEqual(payload["extraTerms"], ["FT2000"])


class ChannelBActiveScreenTests(unittest.TestCase):
    """B1c: Channel B answers from the active HMI screen -- the most
    recently updated live session context, read through the trusted
    HmiSessionRegistry accessor -- instead of the retired file-based
    snapshot store (last written before the HMI migrated to per-session
    context; see leda_local_snapshot.json / JsonFileStore)."""

    def setUp(self):
        install_offline_dispatch_guard(self)

    def build_bot(self, *, session_registry=None):
        state = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [7], "nextUpdateOffset": None, "migrationActive": False}}}
        bot = TelegramLocalBot(
            "secret-token", Mock(), MemoryStateStore(state), Mock(),
            reservation=BotIdentityReservation(), session_registry=session_registry,
        )
        bot._call = identity_transport()
        bot.prepare()
        bot.send_message = Mock()
        bot._typing = Mock(return_value=None)  # F6: see TelegramLifecycleTests.build_bot
        return bot

    def test_answers_from_the_active_screen_session_context(self):
        registry = HmiSessionRegistry()
        capability, _metadata = registry.create()
        registry.set_context(capability, channel_b_snapshot())
        bot = self.build_bot(session_registry=registry)

        bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 1, "text": "¿Cuál es el OEE?"})

        bot.send_message.assert_called_once_with(7, "El OEE actual es 88,6 %.")

    def test_status_reports_the_active_screen_timestamp(self):
        registry = HmiSessionRegistry()
        capability, _metadata = registry.create()
        registry.set_context(capability, {"widgets": [], "timestamp": "2026-09-23T10:00:00Z"})
        bot = self.build_bot(session_registry=registry)

        bot._handle_message({"chat": {"id": 7, "type": "private"}, "text": "/status"})

        bot.send_message.assert_called_once_with(7, "Leda está activa. Última actualización de datos: 2026-09-23T10:00:00Z.")

    def test_no_live_session_answers_honestly_without_touching_the_retired_file_store(self):
        registry = HmiSessionRegistry()  # no session was ever created
        bot = self.build_bot(session_registry=registry)
        bot.snapshot_store.read = Mock(side_effect=AssertionError("the retired file store must not be read"))

        bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 2, "text": "¿Cuál es el OEE?"})

        bot.send_message.assert_called_once_with(7, NO_DASHBOARD_OPEN_REPLY)
        self.assertEqual(NO_DASHBOARD_OPEN_REPLY, "En este momento no hay ningún dashboard abierto en la HMI. Vuelva a consultar cuando haya uno en pantalla.")

    def test_answers_from_the_most_recently_updated_session_among_several(self):
        registry = HmiSessionRegistry()
        older_capability, _older = registry.create()
        registry.set_context(older_capability, {"widgets": [
            {"id": "oee", "title": "OEE", "type": "metric-card", "value": 1.0, "unit": "%"},
        ]})
        newer_capability, _newer = registry.create()
        registry.set_context(newer_capability, {"widgets": [
            {"id": "oee", "title": "OEE", "type": "metric-card", "value": 99.0, "unit": "%"},
        ]})
        bot = self.build_bot(session_registry=registry)

        bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 3, "text": "¿Cuál es el OEE?"})

        bot.send_message.assert_called_once_with(7, "El OEE actual es 99 %.")

    def test_without_a_session_registry_falls_back_to_the_retired_file_store(self):
        """Legacy/direct construction (no production session_registry) keeps
        answering from the file store it was built with -- backward
        compatible with the standalone build_telegram_bot path and every
        pre-B1c test that mocks snapshot_store directly."""
        bot = self.build_bot(session_registry=None)
        bot.snapshot_store.read = Mock(return_value=channel_b_snapshot())

        bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 4, "text": "¿Cuál es el OEE?"})

        bot.send_message.assert_called_once_with(7, "El OEE actual es 88,6 %.")


class ChannelBTypingIndicatorTests(unittest.TestCase):
    """Live test 2026-09-25 (F6): Channel B shows "typing…" while it
    processes a question (text or voice note), non-blocking, and never
    after its own text answer already went out -- same per-message
    "answered" design as Channel A's PW-011 M5, reusing
    channel_a_bot.send_chat_action_unless_answered directly instead of
    duplicating the dispatch-skip decision."""

    def setUp(self):
        install_offline_dispatch_guard(self)

    def build_bot(self, *, paired=True):
        paired_ids = [7] if paired else []
        state = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": paired_ids, "nextUpdateOffset": None, "migrationActive": False}}}
        bot = TelegramLocalBot(
            "secret-token", Mock(), MemoryStateStore(state), VoiceEventStore(),
            reservation=BotIdentityReservation(), typing_enabled=True,
        )
        bot._call = identity_transport()
        bot.prepare()
        bot.snapshot_store.read = Mock(return_value=channel_b_snapshot())
        bot.send_message = Mock()
        return bot

    def test_typing_is_disabled_by_default(self):
        """F6: opt-in, defaulting to disabled -- every direct construction
        elsewhere in this test suite (not through this class's own
        typing_enabled=True build_bot) keeps its exact prior behavior."""
        bot = TelegramLocalBot("secret-token", Mock(), MemoryStateStore(None), Mock())
        self.assertIsNone(bot._typing(7))

    def test_typing_spawns_a_background_dispatcher_using_the_shared_channel_a_helper(self):
        bot = self.build_bot()
        captured = {}

        class CapturingThread:
            def __init__(self, *, target, args=(), name=None, daemon=None):
                captured["target"] = target
                captured["args"] = args
                captured["daemon"] = daemon

            def start(self):
                captured["started"] = True

        with patch("leda_runtime.local_presentation.threading.Thread", CapturingThread):
            answered = bot._typing(7)

        self.assertIsInstance(answered, threading.Event)
        self.assertTrue(captured.get("started"))
        self.assertTrue(captured.get("daemon"))
        import leda_runtime.channel_a_bot as channel_a_bot_module

        self.assertIs(captured["target"], channel_a_bot_module.send_chat_action_unless_answered)
        self.assertEqual(captured["args"][0], 7)
        self.assertIs(captured["args"][1], answered)

    def test_send_chat_action_calls_sendchataction(self):
        bot = self.build_bot()
        bot._call = Mock(return_value={"ok": True, "result": True})

        bot._send_chat_action(7, "typing")

        bot._call.assert_called_once_with("sendChatAction", timeout=5, data={"chat_id": 7, "action": "typing"})

    def test_a_paired_text_question_starts_and_stops_typing_around_the_answer(self):
        """Wiring-level proof, mirroring Channel A's own capture-the-worker
        technique: the indicator is armed before the answer is produced and
        marked answered right after send_message -- verified by running the
        captured worker exactly as a very-late OS schedule would."""
        bot = self.build_bot()
        captured = {}

        class CapturingThread:
            def __init__(self, *, target, args=(), name=None, daemon=None):
                captured["target"] = target
                captured["args"] = args

            def start(self):
                pass

        with patch("leda_runtime.local_presentation.threading.Thread", CapturingThread), \
                patch.object(bot, "_send_chat_action") as send_chat_action:
            bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 4, "text": "¿Cuál es el OEE?"})

        bot.send_message.assert_called_once_with(7, "El OEE actual es 88,6 %.")
        self.assertIn("target", captured)
        # Run the captured worker exactly as a very-late scheduling would:
        # the answer already went out, so no chat action must fire.
        captured["target"](*captured["args"])
        send_chat_action.assert_not_called()

    def test_typing_still_fires_when_the_worker_runs_before_the_answer(self):
        bot = self.build_bot()
        captured = {}

        class CapturingThread:
            def __init__(self, *, target, args=(), name=None, daemon=None):
                captured["target"] = target
                captured["args"] = args

            def start(self):
                # Simulate the worker actually running before the answer.
                captured["target"](*captured["args"])

        with patch("leda_runtime.local_presentation.threading.Thread", CapturingThread), \
                patch.object(bot, "_send_chat_action") as send_chat_action:
            bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 4, "text": "¿Cuál es el OEE?"})

        send_chat_action.assert_called_once_with(chat_id=7, action="typing")

    def test_typing_never_starts_for_an_unpaired_chat(self):
        bot = self.build_bot(paired=False)
        with patch.object(bot, "_typing") as typing:
            bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 4, "text": "¿Cuál es el OEE?"})
        typing.assert_not_called()
        bot.send_message.assert_called_once_with(7, "Para solicitar acceso, envíe /start.")

    def test_typing_wraps_voice_note_processing_too(self):
        bot = self.build_bot()
        with patch.object(bot, "_typing") as typing, \
                patch.object(bot, "_transcribe_voice_note", return_value="¿Cuál es el OEE?") as transcribe:
            bot._handle_message({
                "chat": {"id": 7, "type": "private"},
                "message_id": 4,
                "voice": {"duration": 3, "file_id": "abc", "file_size": 1000},
            })
        typing.assert_called_once_with(7)
        transcribe.assert_called_once()
        typing.return_value.set.assert_called_once_with()
        bot.send_message.assert_called_once_with(7, "El OEE actual es 88,6 %.")


class TelegramStateSchemaV3Tests(unittest.TestCase):
    def test_schema_version_is_three(self):
        self.assertEqual(STATE_SCHEMA_VERSION, 3)

    def test_valid_v3_state_round_trips(self):
        state = v3_state({"7": approved_chat(), "-8": pending_chat(username=None)}, offset=5)
        self.assertEqual(validate_telegram_state(state), state)

    def test_v3_rejects_malformed_chat_records(self):
        bad_chats = {
            "extra key": {**pending_chat(), "note": "x"},
            "missing key": {k: v for k, v in pending_chat().items() if k != "username"},
            "unknown status": pending_chat(status="banned"),
            "bool display name": pending_chat(displayName=True),
            "int username": pending_chat(username=3),
            "naive requestedAt": pending_chat(requestedAt="2026-10-01T12:00:00"),
            "null requestedAt": pending_chat(requestedAt=None),
            "bad decidedAt": approved_chat(decidedAt="yesterday"),
            "pending with decidedAt": pending_chat(decidedAt=STAMP),
            "approved without decidedAt": approved_chat(decidedAt=None),
            "not an object": "approved",
        }
        for label, chat in bad_chats.items():
            with self.subTest(label), self.assertRaises(TelegramStateUnavailable):
                validate_telegram_state(v3_state({"7": chat}))

    def test_v3_rejects_malformed_chat_keys_and_bot_records(self):
        for key in ("07", "+7", "abc", "7.0", " 7", ""):
            with self.subTest(key), self.assertRaises(TelegramStateUnavailable):
                validate_telegram_state(v3_state({key: pending_chat()}))
        record_shapes = [
            {"pairedPrivateChatIds": [], "nextUpdateOffset": None, "migrationActive": False},
            {"chats": [], "nextUpdateOffset": None, "migrationActive": False},
            {"chats": {}, "nextUpdateOffset": -1, "migrationActive": False},
            {"chats": {}, "nextUpdateOffset": None, "migrationActive": "no"},
            {"chats": {}, "nextUpdateOffset": None, "migrationActive": False, "extra": 1},
        ]
        for record in record_shapes:
            with self.subTest(record), self.assertRaises(TelegramStateUnavailable):
                validate_telegram_state({"schemaVersion": 3, "bots": {"123": record}})

    def test_v2_state_migrates_every_paired_id_to_approved(self):
        v2 = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [7, 9], "nextUpdateOffset": 4, "migrationActive": False}}}
        migrated = validate_telegram_state(v2)
        record = migrated["bots"]["123"]
        self.assertEqual(migrated["schemaVersion"], 3)
        self.assertNotIn("pairedPrivateChatIds", record)
        self.assertEqual(set(record["chats"]), {"7", "9"})
        for chat in record["chats"].values():
            self.assertEqual(chat["status"], "approved")
            self.assertEqual(chat["displayName"], "")
            self.assertIsNone(chat["username"])
            self.assertEqual(chat["requestedAt"], chat["decidedAt"])
        self.assertEqual(record["nextUpdateOffset"], 4)
        self.assertFalse(record["migrationActive"])
        validate_telegram_state(migrated)

    def test_v2_migration_uses_the_given_clock_and_still_rejects_malformed_v2(self):
        v2 = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [7], "nextUpdateOffset": None, "migrationActive": False}}}
        self.assertEqual(validate_telegram_state(v2, now=STAMP)["bots"]["123"]["chats"]["7"], approved_chat())
        for chats in ([7, 7], [True], ["7"]):
            bad = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": chats, "nextUpdateOffset": None, "migrationActive": False}}}
            with self.subTest(chats), self.assertRaises(TelegramStateUnavailable):
                validate_telegram_state(bad)

    def test_unknown_schema_versions_are_rejected(self):
        for version in (1, 4, True, "3"):
            with self.subTest(version), self.assertRaises(TelegramStateUnavailable):
                validate_telegram_state({"schemaVersion": version, "bots": {}})


class TelegramStateRepositoryOperationsTests(unittest.TestCase):
    def setUp(self):
        self._directory = tempfile.TemporaryDirectory()
        self.addCleanup(self._directory.cleanup)
        self.path = Path(self._directory.name) / "chat-state.json"
        self.repository = TelegramStateRepository(self.path)
        self.repository.write(v3_state())

    def test_reading_a_v2_file_migrates_and_persists_v3_on_the_first_read(self):
        self.path.write_text(
            '{"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [7], "nextUpdateOffset": 3, "migrationActive": false}}}',
            encoding="utf-8",
        )
        self.assertEqual(self.repository.status_of(123, 7), "approved")
        self.repository.set_offset(123, 4)
        persisted = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(persisted["schemaVersion"], 3)
        self.assertEqual(persisted["bots"]["123"]["chats"]["7"]["status"], "approved")
        self.assertEqual(persisted["bots"]["123"]["nextUpdateOffset"], 4)

    def test_two_consecutive_reads_of_a_v2_file_return_identical_records(self):
        self.path.write_text(
            '{"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [7, 8], "nextUpdateOffset": 3, "migrationActive": false}}}',
            encoding="utf-8",
        )
        first = self.repository.read()
        second = self.repository.read()
        self.assertEqual(first, second)
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8")), first)
        chats = first["bots"]["123"]["chats"]
        self.assertEqual(chats["7"]["requestedAt"], chats["8"]["requestedAt"])

    def test_timestamps_stamped_by_default_survive_a_reload(self):
        self.repository.add_pending(123, 7, "Ana", "ana")
        self.repository.set_status(123, 7, "approved")
        reloaded = TelegramStateRepository(self.path).list_chats(123)[0]
        self.assertEqual(reloaded["status"], "approved")
        self.assertTrue(reloaded["requestedAt"].endswith("Z"))
        self.assertTrue(reloaded["decidedAt"].endswith("Z"))

    def test_add_pending_records_the_request_once(self):
        self.assertTrue(self.repository.add_pending(123, 7, "Ana", "ana", now=STAMP))
        self.assertEqual(self.repository.status_of(123, 7), "pending")
        self.assertEqual(self.repository.list_chats(123), [{"chatId": 7, **pending_chat()}])

    def test_add_pending_is_a_noop_for_a_known_chat(self):
        self.repository.add_pending(123, 7, "Ana", "ana", now=STAMP)
        self.repository.set_status(123, 7, "rejected", now="2026-10-02T00:00:00Z")
        self.assertFalse(self.repository.add_pending(123, 7, "Other", None, now="2026-10-03T00:00:00Z"))
        chat = self.repository.list_chats(123)[0]
        self.assertEqual((chat["status"], chat["displayName"], chat["requestedAt"]), ("rejected", "Ana", STAMP))

    def test_set_status_records_the_decision_time(self):
        self.repository.add_pending(123, 7, "Ana", "ana", now=STAMP)
        for status in ("approved", "revoked", "approved", "rejected"):
            with self.subTest(status):
                self.assertTrue(self.repository.set_status(123, 7, status, now="2026-10-02T00:00:00Z"))
                self.assertEqual(self.repository.status_of(123, 7), status)
                self.assertEqual(self.repository.list_chats(123)[0]["decidedAt"], "2026-10-02T00:00:00Z")

    def test_set_status_rejects_unknown_chats_and_invalid_targets(self):
        self.assertFalse(self.repository.set_status(123, 99, "approved", now=STAMP))
        self.repository.add_pending(123, 7, "Ana", "ana", now=STAMP)
        with self.assertRaises(ValueError):
            self.repository.set_status(123, 7, "pending", now=STAMP)
        self.assertEqual(self.repository.status_of(123, 7), "pending")

    def test_status_of_an_unknown_chat_is_none(self):
        self.assertIsNone(self.repository.status_of(123, 99))

    def test_operations_on_an_unknown_bot_fail_closed(self):
        with self.assertRaises(TelegramStateUnavailable):
            self.repository.add_pending(999, 7, "Ana", None, now=STAMP)
        with self.assertRaises(TelegramStateUnavailable):
            self.repository.set_offset(999, 1)

    def test_set_offset_keeps_chats_and_migration_flag(self):
        self.repository.add_pending(123, 7, "Ana", "ana", now=STAMP)
        self.repository.set_offset(123, 12)
        state = self.repository.read()["bots"]["123"]
        self.assertEqual(state["nextUpdateOffset"], 12)
        self.assertEqual(set(state["chats"]), {"7"})

    def test_a_failing_mutation_writes_nothing(self):
        before = self.path.read_text(encoding="utf-8")

        def boom(state):
            state["bots"]["123"]["nextUpdateOffset"] = 50
            raise RuntimeError("stop")

        with self.assertRaises(RuntimeError):
            self.repository.update(boom)
        self.assertEqual(self.path.read_text(encoding="utf-8"), before)

    def test_concurrent_decisions_and_offset_writes_never_clobber_each_other(self):
        errors = []

        def requests_worker(base):
            try:
                for index in range(25):
                    self.repository.add_pending(123, base + index, "n", None, now=STAMP)
                    self.repository.set_status(123, base + index, "approved", now=STAMP)
            except Exception as error:  # pragma: no cover - reported below
                errors.append(error)

        def offset_worker():
            try:
                for offset in range(100):
                    self.repository.set_offset(123, offset)
            except Exception as error:  # pragma: no cover - reported below
                errors.append(error)

        threads = [threading.Thread(target=requests_worker, args=(base,)) for base in (100, 200, 300)]
        threads.append(threading.Thread(target=offset_worker))
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        record = self.repository.read()["bots"]["123"]
        self.assertEqual(errors, [])
        self.assertEqual(len(record["chats"]), 75)
        self.assertTrue(all(chat["status"] == "approved" for chat in record["chats"].values()))
        self.assertEqual(record["nextUpdateOffset"], 99)

    def test_request_access_reports_added_exists_and_full_without_writing_when_refused(self):
        self.assertEqual(self.repository.request_access(123, 1, "Ana", None, max_pending=2, now=STAMP), "added")
        self.assertEqual(self.repository.request_access(123, 1, "Otro", None, max_pending=2, now=STAMP), "exists")
        self.assertEqual(self.repository.request_access(123, 2, "Beto", "beto", max_pending=2, now=STAMP), "added")
        before = self.path.read_text(encoding="utf-8")
        self.assertEqual(self.repository.request_access(123, 3, "Cata", None, max_pending=2, now=STAMP), "full")
        self.assertEqual(self.path.read_text(encoding="utf-8"), before)
        self.assertIsNone(self.repository.status_of(123, 3))

    def test_request_access_counts_only_pending_chats_against_the_cap(self):
        self.repository.request_access(123, 1, "Ana", None, max_pending=1, now=STAMP)
        self.repository.set_status(123, 1, "approved", now=STAMP)
        self.assertEqual(self.repository.request_access(123, 2, "Beto", None, max_pending=1, now=STAMP), "added")

    def test_concurrent_requests_never_exceed_the_pending_cap(self):
        outcomes = []
        barrier = threading.Barrier(12)

        def worker(chat_id):
            barrier.wait()
            outcomes.append(self.repository.request_access(123, chat_id, "n", None, max_pending=5, now=STAMP))

        threads = [threading.Thread(target=worker, args=(chat_id,)) for chat_id in range(12)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(outcomes.count("added"), 5)
        self.assertEqual(outcomes.count("full"), 7)
        self.assertEqual(len(self.repository.list_chats(123)), 5)

    def test_concurrent_first_reads_of_a_v2_file_migrate_it_exactly_once(self):
        self.path.write_text(
            '{"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [7, 8], "nextUpdateOffset": 3, "migrationActive": false}}}',
            encoding="utf-8",
        )
        results = []
        barrier = threading.Barrier(8)

        def reader():
            barrier.wait()
            results.append(self.repository.read())

        with patch.object(self.repository, "write", wraps=self.repository.write) as write:
            threads = [threading.Thread(target=reader) for _ in range(8)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
        self.assertEqual(write.call_count, 1)
        self.assertEqual(len(results), 8)
        self.assertTrue(all(result == results[0] for result in results))
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8")), results[0])

    def test_apply_decision_follows_the_transition_table_and_returns_the_updated_record(self):
        allowed = [("pending", "approved"), ("pending", "rejected"), ("approved", "revoked"), ("rejected", "approved"), ("revoked", "approved")]
        for current, target in allowed:
            with self.subTest(current=current, target=target):
                chat = pending_chat() if current == "pending" else approved_chat(status=current)
                self.repository.write(v3_state({"7": chat}))
                record = self.repository.apply_decision(123, 7, target, now="2026-10-02T00:00:00Z")
                self.assertEqual(record, {"chatId": 7, **chat, "status": target, "decidedAt": "2026-10-02T00:00:00Z"})
                self.assertEqual(self.repository.status_of(123, 7), target)

    def test_apply_decision_refuses_every_other_transition_without_writing(self):
        allowed = {("pending", "approved"), ("pending", "rejected"), ("approved", "revoked"), ("rejected", "approved"), ("revoked", "approved")}
        for current in ("pending", "approved", "rejected", "revoked"):
            for target in ("approved", "rejected", "revoked"):
                if (current, target) in allowed:
                    continue
                with self.subTest(current=current, target=target):
                    self.repository.write(v3_state({"7": pending_chat() if current == "pending" else approved_chat(status=current)}))
                    before = self.path.read_text(encoding="utf-8")
                    with self.assertRaises(TelegramInvalidTransition):
                        self.repository.apply_decision(123, 7, target, now=STAMP)
                    self.assertEqual(self.path.read_text(encoding="utf-8"), before)

    def test_apply_decision_on_an_unknown_chat_or_target_fails_closed(self):
        with self.assertRaises(TelegramChatNotFound):
            self.repository.apply_decision(123, 99, "approved", now=STAMP)
        self.repository.add_pending(123, 7, "Ana", None, now=STAMP)
        with self.assertRaises(ValueError):
            self.repository.apply_decision(123, 7, "pending", now=STAMP)

    def test_writes_are_atomic_and_leave_no_temporary_file(self):
        self.repository.add_pending(123, 7, "Ana", "ana", now=STAMP)
        self.assertEqual(sorted(path.name for path in self.path.parent.iterdir()), ["chat-state.json"])


class FakeClock:
    def __init__(self, now=1000.0):
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


def private_message(chat_id, text="/start", *, first_name="Ana", last_name=None, username=None, **extra):
    chat = {"id": chat_id, "type": "private", "first_name": first_name}
    if last_name is not None:
        chat["last_name"] = last_name
    if username is not None:
        chat["username"] = username
    return {"chat": chat, "message_id": 1, "text": text, **extra}


class ChannelBAdmissionTests(unittest.TestCase):
    def setUp(self):
        install_offline_dispatch_guard(self)

    def build_bot(self, chats=None, *, offset=None, state_store=None, typing_enabled=False, **bot_options):
        state = v3_state(chats, offset=offset)
        bot = TelegramLocalBot(
            "secret-token", Mock(), state_store if state_store is not None else MemoryStateStore(state), Mock(),
            reservation=BotIdentityReservation(), typing_enabled=typing_enabled, **bot_options,
        )
        bot._call = identity_transport(username="bot")
        bot.prepare()
        bot.send_message = Mock()
        return bot

    def test_only_approved_chats_count_as_paired(self):
        chats = {"1": approved_chat(), "2": pending_chat(), "3": approved_chat(status="rejected"), "4": approved_chat(status="revoked")}
        self.assertEqual(self.build_bot(chats).paired_chat_ids, {1})

    def test_start_from_an_unknown_chat_registers_a_pending_request_with_the_telegram_name(self):
        bot = self.build_bot()
        bot._handle_message(private_message(7, first_name=" Ana ", last_name="Pérez ", username="ana_p"))
        chat = bot.state_store.list_chats(123)[0]
        self.assertEqual((chat["chatId"], chat["status"], chat["displayName"], chat["username"]), (7, "pending", "Ana Pérez", "ana_p"))
        self.assertIsNone(chat["decidedAt"])
        bot.send_message.assert_called_once_with(7, "Su solicitud de acceso quedó registrada. Se le avisará cuando un administrador la apruebe.")

    def test_a_request_without_username_or_last_name_stores_none_and_the_first_name(self):
        bot = self.build_bot()
        bot._handle_message(private_message(7, first_name="Ana"))
        chat = bot.state_store.list_chats(123)[0]
        self.assertEqual((chat["displayName"], chat["username"]), ("Ana", None))

    def test_the_stored_request_validates_on_reload(self):
        with tempfile.TemporaryDirectory() as temporary:
            repository = TelegramStateRepository(Path(temporary) / "chat-state.json")
            bot = self.build_bot(state_store=repository)
            bot._handle_message(private_message(7))
            reloaded = TelegramStateRepository(repository.path).read()
        self.assertEqual(reloaded["bots"]["123"]["chats"]["7"]["status"], "pending")

    def test_pending_requests_are_capped_with_a_fixed_reply(self):
        self.assertEqual(MAX_PENDING_ACCESS_REQUESTS, 20)
        chats = {str(100 + index): pending_chat() for index in range(MAX_PENDING_ACCESS_REQUESTS)}
        chats["5"] = approved_chat()
        bot = self.build_bot(chats)
        bot._handle_message(private_message(7))
        self.assertIsNone(bot.state_store.status_of(123, 7))
        bot.send_message.assert_called_once_with(7, "En este momento no es posible registrar nuevas solicitudes. Intente más tarde.")

    def test_decided_chats_do_not_count_against_the_pending_cap(self):
        chats = {str(100 + index): approved_chat(status="rejected") for index in range(MAX_PENDING_ACCESS_REQUESTS + 5)}
        bot = self.build_bot(chats)
        bot._handle_message(private_message(7))
        self.assertEqual(bot.state_store.status_of(123, 7), "pending")

    def test_unknown_chat_messages_other_than_start_get_the_request_hint_only(self):
        bot = self.build_bot()
        bot._handle_message(private_message(7, "¿Cuál es el OEE?"))
        bot._handle_message(private_message(7, "/status"))
        bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 2, "voice": {"file_id": "f", "duration": 2}})
        self.assertEqual(
            [call.args for call in bot.send_message.call_args_list],
            [(7, "Para solicitar acceso, envíe /start.")] * 3,
        )
        self.assertIsNone(bot.state_store.status_of(123, 7))

    def test_pending_chat_gets_the_waiting_reply_and_is_not_added_again(self):
        bot = self.build_bot({"7": pending_chat()})
        bot._handle_message(private_message(7, "/start", first_name="Otro"))
        bot._handle_message(private_message(7, "hola"))
        self.assertEqual(
            [call.args for call in bot.send_message.call_args_list],
            [(7, "Su solicitud de acceso está pendiente de aprobación.")] * 2,
        )
        self.assertEqual(bot.state_store.list_chats(123), [{"chatId": 7, **pending_chat()}])

    def test_rejected_and_revoked_chats_get_the_denial_and_cannot_re_request(self):
        for status in ("rejected", "revoked"):
            with self.subTest(status):
                bot = self.build_bot({"7": approved_chat(status=status)})
                bot._handle_message(private_message(7, "/start"))
                bot._handle_message(private_message(7, "hola"))
                self.assertEqual(
                    [call.args for call in bot.send_message.call_args_list],
                    [(7, "No tiene acceso a este asistente.")] * 2,
                )
                self.assertEqual(bot.state_store.status_of(123, 7), status)

    def test_approved_chat_start_gets_the_ready_reply(self):
        bot = self.build_bot({"7": approved_chat()})
        bot._handle_message(private_message(7, "/start"))
        bot.send_message.assert_called_once_with(7, "Leda está lista para responder sus consultas.")

    def test_start_is_deferred_during_the_migration_fence_and_registers_nothing(self):
        bot = self.build_bot()
        bot._handle_message(private_message(7, "/start"), migration_active=True)
        bot.send_message.assert_called_once_with(7, "Envíe /start nuevamente cuando finalice la migración.")
        self.assertIsNone(bot.state_store.status_of(123, 7))

    def test_groups_stay_ignored(self):
        bot = self.build_bot()
        bot._handle_message({"chat": {"id": -100, "type": "group"}, "text": "/start"})
        bot.send_message.assert_not_called()
        self.assertEqual(bot.state_store.list_chats(123), [])

    def test_non_approved_chats_get_no_typing_download_or_answer(self):
        for status in (None, "pending", "rejected", "revoked"):
            with self.subTest(status):
                if status is None:
                    chats = {}
                elif status == "pending":
                    chats = {"7": pending_chat()}
                else:
                    chats = {"7": approved_chat(status=status)}
                bot = self.build_bot(chats, typing_enabled=True)
                bot.session = Mock()
                with patch.object(bot, "_typing") as typing, patch.object(bot, "_active_snapshot") as snapshot, \
                        patch.object(bot, "_transcribe_voice_note") as transcribe:
                    bot._handle_message(private_message(7, "¿Cuál es el OEE?"))
                    bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 3, "voice": {"file_id": "f", "duration": 2}})
                typing.assert_not_called()
                snapshot.assert_not_called()
                transcribe.assert_not_called()
                bot.session.get.assert_not_called()
                bot.session.post.assert_not_called()
                self.assertEqual(bot.send_message.call_count, 2)

    def test_a_revocation_applies_to_the_very_next_message(self):
        bot = self.build_bot({"7": approved_chat()})
        bot.snapshot_store.read = Mock(return_value={"timestamp": "2026-09-23T10:00:00Z"})
        bot._handle_message(private_message(7, "/status"))
        bot.state_store.set_status(123, 7, "revoked", now="2026-10-02T00:00:00Z")
        bot._handle_message(private_message(7, "/status"))
        self.assertEqual(
            [call.args[1] for call in bot.send_message.call_args_list],
            ["Leda está activa. Última actualización de datos: 2026-09-23T10:00:00Z.", "No tiene acceso a este asistente."],
        )

    def test_an_approval_applies_to_the_very_next_message(self):
        bot = self.build_bot({"7": pending_chat()})
        bot._handle_message(private_message(7, "/start"))
        bot.state_store.set_status(123, 7, "approved", now="2026-10-02T00:00:00Z")
        bot._handle_message(private_message(7, "/start"))
        self.assertEqual(
            [call.args[1] for call in bot.send_message.call_args_list],
            ["Su solicitud de acceso está pendiente de aprobación.", "Leda está lista para responder sus consultas."],
        )

    def test_a_failed_request_write_surfaces_and_registers_nothing(self):
        bot = self.build_bot()
        bot.state_store = FailingStateStore(bot.state_store.value, failures=1)
        with self.assertRaises(TelegramStateUnavailable):
            bot._handle_message(private_message(7, "/start"))
        bot.send_message.assert_not_called()
        self.assertIsNone(bot.state_store.status_of(123, 7))

    def test_an_approved_chat_over_the_limit_gets_one_fixed_reply_and_no_further_work(self):
        bot = self.build_bot({"7": approved_chat()}, typing_enabled=True, rate_limiter=ChatMessageLimiter(clock=FakeClock()))
        bot.snapshot_store.read = Mock(return_value=None)
        bot.session = Mock()
        with patch.object(bot, "_typing") as typing, patch.object(bot, "_transcribe_voice_note") as transcribe:
            for _ in range(10):
                bot._handle_message(private_message(7, "/status"))
            self.assertEqual(typing.call_count, 10)
            bot.send_message.reset_mock()
            typing.reset_mock()
            bot._handle_message(private_message(7, "/status"))
            bot._handle_message(private_message(7, "¿Cuál es el OEE?"))
            bot._handle_message({"chat": {"id": 7, "type": "private"}, "message_id": 4, "voice": {"file_id": "f", "duration": 2}})
        bot.send_message.assert_called_once_with(7, "Ha enviado demasiadas consultas seguidas. Espere un momento y vuelva a intentarlo.")
        typing.assert_not_called()
        transcribe.assert_not_called()
        bot.session.get.assert_not_called()

    def test_an_approved_chat_is_answered_again_after_the_window(self):
        clock = FakeClock()
        bot = self.build_bot({"7": approved_chat()}, rate_limiter=ChatMessageLimiter(clock=clock))
        bot.snapshot_store.read = Mock(return_value=None)
        for _ in range(11):
            bot._handle_message(private_message(7, "/status"))
        clock.advance(61)
        bot.send_message.reset_mock()
        bot._handle_message(private_message(7, "/status"))
        self.assertIn("Leda está activa", bot.send_message.call_args.args[1])

    def test_the_limit_also_caps_the_fixed_replies_for_chats_without_access_and_sends_nothing_extra(self):
        cases = (
            ("unknown", {}),
            ("pending", {"7": pending_chat()}),
            ("rejected", {"7": approved_chat(status="rejected")}),
            ("revoked", {"7": approved_chat(status="revoked")}),
        )
        for label, chats in cases:
            with self.subTest(label):
                bot = self.build_bot(chats, rate_limiter=ChatMessageLimiter(clock=FakeClock()))
                for _ in range(40):
                    bot._handle_message(private_message(7, "hola"))
                self.assertEqual(bot.send_message.call_count, 10)
                self.assertNotIn(
                    "Ha enviado demasiadas consultas seguidas. Espere un momento y vuelva a intentarlo.",
                    [call.args[1] for call in bot.send_message.call_args_list],
                )

    def test_the_limit_is_per_chat(self):
        bot = self.build_bot({"7": approved_chat(), "8": approved_chat()}, rate_limiter=ChatMessageLimiter(clock=FakeClock()))
        bot.snapshot_store.read = Mock(return_value=None)
        for _ in range(11):
            bot._handle_message(private_message(7, "/status"))
        bot.send_message.reset_mock()
        bot._handle_message(private_message(8, "/status"))
        self.assertIn("Leda está activa", bot.send_message.call_args.args[1])

    def test_a_new_request_is_audited_without_any_personal_data(self):
        audit = Mock()
        bot = self.build_bot(audit_log=audit)
        bot._handle_message(private_message(7, "/start", first_name="Ana", username="ana_p"))
        audit.record.assert_called_once_with("requested", 123, 7, "telegram")

    def test_a_refused_request_is_audited_and_a_repeat_start_is_not(self):
        audit = Mock()
        chats = {str(100 + index): pending_chat() for index in range(MAX_PENDING_ACCESS_REQUESTS)}
        bot = self.build_bot(chats, audit_log=audit)
        bot._handle_message(private_message(7, "/start"))
        audit.record.assert_called_once_with("request_refused_full", 123, 7, "telegram")
        audit.reset_mock()
        bot._handle_message(private_message(100, "/start"))
        audit.record.assert_not_called()

    def test_an_audit_failure_never_breaks_the_request(self):
        audit = Mock()
        audit.record.side_effect = RuntimeError("disk gone")
        bot = self.build_bot(audit_log=audit)
        bot._handle_message(private_message(7, "/start"))
        self.assertEqual(bot.state_store.status_of(123, 7), "pending")
        bot.send_message.assert_called_once_with(7, "Su solicitud de acceso quedó registrada. Se le avisará cuando un administrador la apruebe.")

    def test_the_pending_cap_is_enforced_by_the_locked_insert_not_by_a_stale_listing(self):
        chats = {str(100 + index): pending_chat() for index in range(MAX_PENDING_ACCESS_REQUESTS)}
        bot = self.build_bot(chats)
        with patch.object(bot.state_store, "list_chats", return_value=[]):
            bot._handle_message(private_message(7, "/start"))
        self.assertIsNone(bot.state_store.status_of(123, 7))
        bot.send_message.assert_called_once_with(7, "En este momento no es posible registrar nuevas solicitudes. Intente más tarde.")

    def notice_ready_bot(self, chats):
        """A bot with the real transport methods and two inert sessions: the poll one and the notice one."""
        bot = self.build_bot(chats)
        bot._call = types.MethodType(TelegramLocalBot._call, bot)
        bot.send_message = types.MethodType(TelegramLocalBot.send_message, bot)
        ok_response = Mock()
        ok_response.json.return_value = {"ok": True}
        bot.session = Mock()
        bot._notice_session = Mock()
        bot._notice_session.post.return_value = ok_response
        return bot

    def test_an_approval_notice_is_not_blocked_by_a_long_poll_on_the_shared_session(self):
        bot = self.notice_ready_bot({"8": approved_chat()})
        poll_started, release_poll = threading.Event(), threading.Event()

        def long_poll(*_args, **_kwargs):
            poll_started.set()
            release_poll.wait(5)
            return Mock()

        bot.session.post.side_effect = long_poll
        self.addCleanup(release_poll.set)
        poller = threading.Thread(target=bot._call, args=("getUpdates",), kwargs={"timeout": 35, "data": {}}, daemon=True)
        poller.start()
        self.assertTrue(poll_started.wait(2))
        result = []
        notifier = threading.Thread(target=lambda: result.append(bot.send_approval_notice(8)), daemon=True)
        notifier.start()
        notifier.join(1)
        self.assertFalse(notifier.is_alive(), "the notice waited for the long poll")
        self.assertEqual(result, [True])
        # The notice went out on its own session; the poll session saw only the getUpdates call.
        self.assertEqual(bot._notice_session.post.call_count, 1)
        self.assertTrue(bot._notice_session.post.call_args.args[0].endswith("/sendMessage"))
        self.assertEqual(bot.session.post.call_count, 1)

    def test_concurrent_approval_notices_never_overlap_on_the_notice_session(self):
        bot = self.notice_ready_bot({"8": approved_chat()})
        in_flight, peak, lock = [0], [0], threading.Lock()
        ok_response = bot._notice_session.post.return_value

        def slow_post(*_args, **_kwargs):
            with lock:
                in_flight[0] += 1
                peak[0] = max(peak[0], in_flight[0])
            time.sleep(0.02)
            with lock:
                in_flight[0] -= 1
            return ok_response

        bot._notice_session.post.side_effect = slow_post
        threads = [threading.Thread(target=bot.send_approval_notice, args=(8,)) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(bot._notice_session.post.call_count, 4)
        self.assertEqual(peak[0], 1)

    def test_a_stopped_bot_sends_no_approval_notice(self):
        bot = self.notice_ready_bot({"8": approved_chat()})
        bot.stop_event.set()
        with self.assertRaises(RuntimeError):
            bot.send_approval_notice(8)
        bot._notice_session.post.assert_not_called()

    def test_stopping_the_bot_closes_the_notice_session_too(self):
        bot = self.notice_ready_bot({"8": approved_chat()})
        notice_session = bot._notice_session
        bot.stop()
        notice_session.close.assert_called_once_with()

    def test_approval_notice_is_sent_only_to_a_currently_approved_chat(self):
        text = "Su acceso fue aprobado. Ya puede realizar sus consultas."
        bot = self.build_bot({"1": approved_chat(), "2": pending_chat(), "3": approved_chat(status="rejected"), "4": approved_chat(status="revoked")})
        bot._send_notice_message = Mock()
        self.assertTrue(bot.send_approval_notice(1))
        for chat_id in (2, 3, 4, 99):
            self.assertFalse(bot.send_approval_notice(chat_id))
        bot._send_notice_message.assert_called_once_with(1, text)

    def test_the_bot_persists_the_offset_without_a_whole_state_write_of_its_own_copy(self):
        store = MemoryStateStore(v3_state({"7": approved_chat()}, offset=5))
        bot = self.build_bot(state_store=store)
        bot.stop_event = ImmediateStopEvent()
        calls = 0

        def call(_method, **_kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                return {"ok": True, "result": [{"update_id": 5, "message": private_message(7, "/status")}]}
            bot.stop_event.set()
            return {"ok": True, "result": []}

        bot.snapshot_store.read = Mock(return_value=None)
        bot._call = call
        bot.run()
        self.assertEqual(store.value["bots"]["123"]["nextUpdateOffset"], 6)
        self.assertFalse(hasattr(bot, "_state"))
        self.assertFalse(hasattr(bot, "_persist"))

    def test_an_admin_decision_between_two_updates_survives_the_next_offset_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            repository = TelegramStateRepository(Path(temporary) / "chat-state.json")
            repository.write(v3_state({"7": approved_chat(), "8": pending_chat()}))
            bot = self.build_bot(state_store=repository)
            bot.snapshot_store.read = Mock(return_value=None)
            bot.stop_event = ImmediateStopEvent()
            decided = []

            def send(chat_id, text):
                # The admin decides while the bot is handling the first update.
                if not decided:
                    decided.append(repository.set_status(123, 8, "approved", now="2026-10-02T00:00:00Z"))
                    repository.set_status(123, 7, "revoked", now="2026-10-02T00:00:00Z")

            bot.send_message = send
            calls = 0

            def call(_method, **_kwargs):
                nonlocal calls
                calls += 1
                if calls == 1:
                    return {"ok": True, "result": [
                        {"update_id": 1, "message": private_message(7, "/status")},
                        {"update_id": 2, "message": private_message(8, "/start")},
                    ]}
                bot.stop_event.set()
                return {"ok": True, "result": []}

            bot._call = call
            bot.run()
            record = repository.read()["bots"]["123"]
        self.assertEqual(decided, [True])
        self.assertEqual(record["nextUpdateOffset"], 3)
        self.assertEqual((record["chats"]["7"]["status"], record["chats"]["8"]["status"]), ("revoked", "approved"))


if __name__ == "__main__":
    unittest.main()
