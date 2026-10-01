import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch


RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from leda_runtime.channel_b_admission import (
    ADMISSION_AUDIT_EVENTS,
    ADMISSION_AUDIT_MAX_BYTES,
    MESSAGE_LIMIT_PER_WINDOW,
    MESSAGE_LIMIT_WINDOW_SECONDS,
    AdmissionAuditLog,
    ChatMessageLimiter,
    MessageVerdict,
)
from leda_runtime.paths import runtime_paths


class FakeClock:
    def __init__(self, now=1000.0):
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class ChatMessageLimiterTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.limiter = ChatMessageLimiter(clock=self.clock)

    def test_defaults_are_ten_messages_per_sixty_seconds(self):
        self.assertEqual((MESSAGE_LIMIT_PER_WINDOW, MESSAGE_LIMIT_WINDOW_SECONDS), (10, 60.0))

    def test_the_first_ten_messages_pass_and_the_eleventh_is_limited(self):
        verdicts = [self.limiter.admit(7) for _ in range(MESSAGE_LIMIT_PER_WINDOW)]
        self.assertEqual(set(verdicts), {MessageVerdict.ALLOWED})
        self.assertEqual(self.limiter.admit(7), MessageVerdict.LIMITED_NOTIFY)

    def test_the_limit_reply_is_offered_once_per_window(self):
        for _ in range(MESSAGE_LIMIT_PER_WINDOW):
            self.limiter.admit(7)
        verdicts = [self.limiter.admit(7) for _ in range(5)]
        self.assertEqual(verdicts, [MessageVerdict.LIMITED_NOTIFY] + [MessageVerdict.LIMITED_SILENT] * 4)

    def test_the_window_slides_and_the_chat_recovers(self):
        for _ in range(MESSAGE_LIMIT_PER_WINDOW):
            self.limiter.admit(7)
            self.clock.advance(1)
        self.assertEqual(self.limiter.admit(7), MessageVerdict.LIMITED_NOTIFY)
        self.clock.advance(MESSAGE_LIMIT_WINDOW_SECONDS)
        self.assertEqual(self.limiter.admit(7), MessageVerdict.ALLOWED)

    def test_limited_messages_do_not_extend_the_window(self):
        for _ in range(MESSAGE_LIMIT_PER_WINDOW):
            self.limiter.admit(7)
        for _ in range(50):
            self.clock.advance(1)
            self.limiter.admit(7)
        self.clock.advance(10.5)
        self.assertEqual(self.limiter.admit(7), MessageVerdict.ALLOWED)

    def test_a_new_window_notifies_again(self):
        for _ in range(MESSAGE_LIMIT_PER_WINDOW + 1):
            self.limiter.admit(7)
        self.clock.advance(MESSAGE_LIMIT_WINDOW_SECONDS + 1)
        for _ in range(MESSAGE_LIMIT_PER_WINDOW):
            self.assertEqual(self.limiter.admit(7), MessageVerdict.ALLOWED)
        self.assertEqual(self.limiter.admit(7), MessageVerdict.LIMITED_NOTIFY)

    def test_chats_are_limited_independently(self):
        for _ in range(MESSAGE_LIMIT_PER_WINDOW + 1):
            self.limiter.admit(7)
        self.assertEqual(self.limiter.admit(8), MessageVerdict.ALLOWED)

    def test_idle_chats_are_evicted_so_memory_stays_bounded(self):
        limiter = ChatMessageLimiter(clock=self.clock, max_tracked=50)
        for chat_id in range(40):
            limiter.admit(chat_id)
        self.clock.advance(MESSAGE_LIMIT_WINDOW_SECONDS + 1)
        limiter.admit(999)
        self.assertEqual(limiter.tracked_chats, 1)

    def test_the_tracked_set_never_exceeds_its_bound_even_when_every_chat_is_active(self):
        limiter = ChatMessageLimiter(clock=self.clock, max_tracked=50)
        for chat_id in range(500):
            limiter.admit(chat_id)
            self.clock.advance(0.01)
        self.assertLessEqual(limiter.tracked_chats, 50)

    def test_overflow_evicts_an_expired_chat_before_an_active_one_so_counts_survive(self):
        limiter = ChatMessageLimiter(clock=self.clock, limit=1, max_tracked=2)
        limiter.admit("old")  # stamped at t0, then only re-attempted: it stays recent in the order but its window expires first
        self.clock.advance(10)
        self.assertEqual(limiter.admit("active"), MessageVerdict.ALLOWED)
        self.clock.advance(20)
        self.assertEqual(limiter.admit("old"), MessageVerdict.LIMITED_NOTIFY)
        self.clock.advance(35)  # "old" expired (65 s), "active" still inside its window (55 s)
        self.assertEqual(limiter.admit("new"), MessageVerdict.ALLOWED)
        self.assertEqual(limiter.tracked_chats, 2)
        # The active chat kept its window: evicting it would have let this message through.
        self.assertEqual(limiter.admit("active"), MessageVerdict.LIMITED_NOTIFY)

    def test_when_every_tracked_chat_is_active_the_least_recent_one_is_evicted(self):
        limiter = ChatMessageLimiter(clock=self.clock, limit=1, max_tracked=2)
        limiter.admit("first")
        self.clock.advance(1)
        limiter.admit("second")
        self.clock.advance(1)
        limiter.admit("third")
        self.assertEqual(limiter.tracked_chats, 2)
        self.assertEqual(limiter.admit("second"), MessageVerdict.LIMITED_NOTIFY)

    def test_concurrent_use_never_admits_more_than_the_limit(self):
        results = []
        lock = threading.Lock()

        def worker():
            verdict = self.limiter.admit(7)
            with lock:
                results.append(verdict)

        threads = [threading.Thread(target=worker) for _ in range(40)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(results.count(MessageVerdict.ALLOWED), MESSAGE_LIMIT_PER_WINDOW)
        self.assertEqual(results.count(MessageVerdict.LIMITED_NOTIFY), 1)


class AdmissionAuditLogTests(unittest.TestCase):
    def setUp(self):
        self._directory = tempfile.TemporaryDirectory()
        self.addCleanup(self._directory.cleanup)
        self.path = Path(self._directory.name) / "admission-audit.jsonl"
        self.log = AdmissionAuditLog(self.path, clock=lambda: "2026-10-01T12:00:00Z")

    def lines(self, path=None):
        return [json.loads(line) for line in (path or self.path).read_text(encoding="utf-8").splitlines()]

    def test_the_audit_file_lives_in_the_runtime_state_directory(self):
        with patch.dict("os.environ", {"LEDA_RUNTIME_STATE_DIR": self._directory.name}):
            paths = runtime_paths()
        self.assertEqual(paths.admission_audit, Path(self._directory.name) / "leda_channel_b_admission_audit.jsonl")

    def test_every_event_is_one_json_line_with_exactly_the_documented_keys(self):
        self.assertEqual(ADMISSION_AUDIT_EVENTS, {"requested", "approved", "rejected", "revoked", "request_refused_full"})
        self.log.record("requested", 123, 7, "telegram")
        self.log.record("approved", 123, 7, "admin")
        self.assertEqual(
            self.lines(),
            [
                {"at": "2026-10-01T12:00:00Z", "event": "requested", "botId": 123, "chatId": 7, "actor": "telegram"},
                {"at": "2026-10-01T12:00:00Z", "event": "approved", "botId": 123, "chatId": 7, "actor": "admin"},
            ],
        )

    def test_the_default_clock_stamps_a_utc_iso_time(self):
        AdmissionAuditLog(self.path).record("rejected", 123, -5, "admin")
        entry = self.lines()[0]
        self.assertRegex(entry["at"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
        self.assertEqual(entry["chatId"], -5)

    def test_unknown_events_actors_and_malformed_ids_are_dropped_without_raising(self):
        self.log.record("deleted", 123, 7, "admin")
        self.log.record("approved", 123, 7, "someone")
        self.log.record("approved", 123, "7", "admin")
        self.log.record("approved", True, 7, "admin")
        self.assertFalse(self.path.exists())

    def test_no_message_text_name_or_token_can_reach_the_file(self):
        self.log.record("requested", 123, 7, "telegram")
        text = self.path.read_text(encoding="utf-8")
        self.assertEqual(set(json.loads(text)), {"at", "event", "botId", "chatId", "actor"})

    def test_the_file_rotates_to_a_single_backup_once_it_exceeds_the_limit(self):
        log = AdmissionAuditLog(self.path, max_bytes=300, clock=lambda: "2026-10-01T12:00:00Z")
        for chat_id in range(40):
            log.record("requested", 123, chat_id, "telegram")
        backup = self.path.with_name(self.path.name + ".1")
        self.assertTrue(backup.exists())
        self.assertEqual(sorted(entry.name for entry in self.path.parent.iterdir()), sorted([backup.name, self.path.name]))
        self.assertLessEqual(self.path.stat().st_size, 300 + 120)
        self.assertLessEqual(backup.stat().st_size, 300 + 120)
        # The newest entry is always in the live file and the backup holds older ones only.
        self.assertEqual(self.lines()[-1]["chatId"], 39)
        self.assertLess(self.lines(backup)[-1]["chatId"], self.lines()[0]["chatId"])

    def test_the_default_size_bound_is_one_mebibyte(self):
        self.assertEqual(ADMISSION_AUDIT_MAX_BYTES, 1024 * 1024)

    def test_a_write_failure_is_swallowed_and_logged_without_identifiers(self):
        with patch("leda_runtime.channel_b_admission._logger") as logger, \
                patch("pathlib.Path.open", side_effect=PermissionError("C:/secret/path")):
            self.log.record("approved", 123, 987654321, "admin")
        logger.warning.assert_called_once()
        logged = " ".join(str(part) for part in logger.warning.call_args.args)
        self.assertNotIn("987654321", logged)
        self.assertNotIn("secret", logged)

    def test_concurrent_writers_never_interleave_lines(self):
        def worker(base):
            for index in range(50):
                self.log.record("requested", 123, base + index, "telegram")

        threads = [threading.Thread(target=worker, args=(base,)) for base in (0, 1000, 2000, 3000)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(len(self.lines()), 200)


if __name__ == "__main__":
    unittest.main()
