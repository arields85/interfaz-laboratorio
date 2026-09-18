import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.local_presentation import TelegramLocalBot
from prisma_runtime.telegram_lifecycle import TelegramStateRepository, TelegramStateUnavailable


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


class TelegramLifecycleTests(unittest.TestCase):
    def build_bot(self, state=None):
        return TelegramLocalBot("secret-token", Mock(), MemoryStateStore(state), Mock())

    def test_protected_token_bytes_are_preserved_at_consumer(self):
        self.assertEqual(TelegramLocalBot("  protected-token  ", Mock(), Mock(), Mock()).token, "  protected-token  ")

    def test_out_of_order_duplicate_and_stale_updates_advance_monotonically(self):
        state = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [], "nextUpdateOffset": 10, "migrationActive": False}}}
        bot = TelegramLocalBot("token", Mock(), MemoryStateStore(state), Mock())
        bot.bot_id, bot._state, bot.stop_event = 123, state, ImmediateStopEvent()
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
        bot = TelegramLocalBot("token", Mock(), MemoryStateStore(state), Mock())
        bot.bot_id, bot._state = 123, state
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
        bot = TelegramLocalBot("secret-token", Mock(), FailingStateStore(state, failures=1), Mock())
        bot.stop_event = ImmediateStopEvent()
        bot.bot_id = 123
        bot._state = state
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
            bot = TelegramLocalBot("secret-token", Mock(), repository, Mock())
            bot._call = Mock(side_effect=[
                {"ok": True, "result": True},
                {"ok": True, "result": {"id": 123, "username": "bot"}},
            ])

            bot.run()

            persisted = path.read_text(encoding="utf-8")

        self.assertEqual(bot.last_error, "TELEGRAM_PREPARATION_FAILED")
        self.assertEqual(persisted, "{broken")

    def test_recognized_legacy_state_starts_explicit_repairing_without_importing_chat_ids(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "chat-state.json"
            path.write_text('{"allowedChatIds":[7]}', encoding="utf-8")
            repository = TelegramStateRepository(path)
            bot = TelegramLocalBot("secret-token", Mock(), repository, Mock())
            bot._call = Mock(side_effect=[
                {"ok": True, "result": True},
                {"ok": True, "result": {"id": 123, "username": "bot"}},
            ])

            bot.prepare()

            persisted = repository.read()
        self.assertEqual(bot.paired_chat_ids, set())
        self.assertTrue(persisted["bots"]["123"]["migrationActive"])

    def test_same_bot_rotation_and_process_restart_retain_only_its_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            repository = TelegramStateRepository(Path(temporary) / "chat-state.json")

            def prepared_bot(token, bot_id):
                bot = TelegramLocalBot(token, Mock(), repository, Mock())
                bot._call = Mock(side_effect=[
                    {"ok": True, "result": True},
                    {"ok": True, "result": {"id": bot_id, "username": "bot"}},
                ])
                bot.prepare()
                return bot

            first = prepared_bot("old-token", 123)
            first._record().update({"pairedPrivateChatIds": [7], "nextUpdateOffset": 44, "migrationActive": False})
            first._persist()
            rotated = prepared_bot("new-token", 123)
            different = prepared_bot("different-token", 456)
            restored = prepared_bot("restored-token", 123)

        self.assertEqual(rotated.paired_chat_ids, {7})
        self.assertEqual(rotated._record()["nextUpdateOffset"], 44)
        self.assertEqual(different.paired_chat_ids, set())
        self.assertTrue(different._record()["migrationActive"])
        self.assertEqual(restored.paired_chat_ids, {7})


if __name__ == "__main__":
    unittest.main()
