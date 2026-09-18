import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock


RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.telegram_config import read_telegram_config
from prisma_runtime.telegram_credentials import TelegramCredentialError, TelegramCredentialResolver
from prisma_runtime.telegram_lifecycle import TelegramLifecycleError, TelegramLifecycleManager


class FakeThread:
    def __init__(self, alive=True):
        self.alive = alive

    def is_alive(self):
        return self.alive


class FakeEvent:
    def __init__(self, stopped=False):
        self.stopped = stopped

    def is_set(self):
        return self.stopped


class FakeBot:
    def __init__(self, events, stop_result=True):
        self.events = events
        self.stop_result = stop_result
        self.thread = FakeThread()
        self.stop_event = FakeEvent()

    def prepare(self):
        self.events.append("prepare")

    def start(self):
        self.events.append("start")

    def stop(self):
        self.events.append("stop")
        if self.stop_result:
            self.stop_event.stopped = True
            self.thread.alive = False
        return self.stop_result


class TelegramCredentialTests(unittest.TestCase):
    def test_failed_equal_generation_restart_invalidates_applied_proof_and_contains_cleanup_failure(self):
        config = read_telegram_config({"PRISMA_LOCAL_TELEGRAM_ENABLED": "1", "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "token"})
        resolver = Mock(source="environment", resolve=Mock(return_value="token"))
        old = FakeBot([])
        candidate = FakeBot([])
        replacement = FakeBot([])
        candidate.prepare = Mock(side_effect=RuntimeError("operational-marker"))
        candidate.stop = Mock(side_effect=[RuntimeError("disposal-marker"), RuntimeError("raw-cleanup-marker"), True])
        bot_factory = Mock(side_effect=[candidate, replacement])
        manager = TelegramLifecycleManager(config, resolver, Mock(), bot_factory)
        manager.bot = old
        manager._update(appliedGeneration=1, verified=True)
        with self.assertRaisesRegex(TelegramLifecycleError, "TELEGRAM_PROVIDER_UNAVAILABLE"):
            manager.apply()
        status = manager.status()
        self.assertEqual(status["appliedGeneration"], 0)
        self.assertTrue(status["restartRequired"])
        self.assertEqual(status["lastError"], "TELEGRAM_PROVIDER_UNAVAILABLE")
        self.assertIs(manager.bot, candidate)

        with self.assertRaisesRegex(TelegramLifecycleError, "TELEGRAM_STOP_TIMEOUT") as retry:
            manager.apply()
        self.assertNotIn("raw-cleanup-marker", str(retry.exception))
        self.assertIs(manager.bot, candidate)
        self.assertEqual(bot_factory.call_count, 1)
        self.assertEqual(candidate.stop.call_count, 2)
        self.assertEqual(manager.status()["lastError"], "TELEGRAM_STOP_TIMEOUT")

        recovered = manager.apply()
        self.assertIs(manager.bot, replacement)
        self.assertEqual(bot_factory.call_count, 2)
        self.assertEqual(candidate.stop.call_count, 3)
        self.assertTrue(recovered["running"])
        self.assertFalse(recovered["restartRequired"])

    def test_status_reflects_allowlisted_poller_error_and_thread_death(self):
        config = read_telegram_config({"PRISMA_LOCAL_TELEGRAM_ENABLED": "1", "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "token"})
        manager = TelegramLifecycleManager(config, Mock(source="environment"), Mock(), Mock())
        manager.bot = FakeBot([])
        manager.bot.last_error = "TELEGRAM_POLL_FAILED"
        manager._update(appliedGeneration=1, verified=True, lastError=None)
        self.assertEqual(manager.status()["lastError"], "TELEGRAM_POLL_FAILED")
        manager.bot.last_error = "https://api.telegram.org/bottoken"
        manager.bot.thread.alive = False
        status = manager.status()
        self.assertFalse(status["running"])
        self.assertFalse(status["verified"])
        self.assertNotIn("bottoken", str(status))
    def test_protected_mode_never_exposes_legacy_environment_token_as_desired(self):
        config = read_telegram_config(
            {
                "PRISMA_LOCAL_TELEGRAM_ENABLED": "1",
                "PRISMA_CREDENTIAL_MASTER_KEY_FILE": "C:/protected/key",
                "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "legacy-token",
            }
        )

        self.assertTrue(config.enabled)
        self.assertEqual(config.token, "")
        self.assertFalse(config.configured)

    def test_protected_resolver_is_authoritative_and_preserves_stored_bytes(self):
        store = Mock()
        store.get_secret.return_value = None
        resolver = TelegramCredentialResolver(
            {"PRISMA_CREDENTIAL_MASTER_KEY_FILE": "C:/protected/key", "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "legacy"},
            lambda: store,
        )
        with self.assertRaisesRegex(TelegramCredentialError, "TELEGRAM_CREDENTIAL_MISSING"):
            resolver.resolve()
        store.get_secret.return_value = "  protected-token  "
        self.assertEqual(resolver.resolve(), "  protected-token  ")

    def test_save_advances_desired_without_resolve_or_bot_activity(self):
        config = read_telegram_config({"PRISMA_LOCAL_TELEGRAM_ENABLED": "1", "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "old"})
        resolver = Mock(source="environment")
        credentials = Mock()
        bot_factory = Mock()
        manager = TelegramLifecycleManager(config, resolver, credentials, bot_factory)

        manager.set_secret("new-protected-token")

        credentials.set_secret.assert_called_once_with("telegram", "new-protected-token")
        resolver.resolve.assert_not_called()
        bot_factory.assert_not_called()
        self.assertEqual(manager.status()["desiredGeneration"], 2)
        self.assertTrue(manager.status()["restartRequired"])

    def test_delete_commits_and_advances_before_truthful_stop_timeout(self):
        events = []
        credentials = Mock()
        credentials.delete_secret.side_effect = lambda _provider: events.append("delete")
        config = read_telegram_config({"PRISMA_LOCAL_TELEGRAM_ENABLED": "1", "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "old"})
        manager = TelegramLifecycleManager(config, Mock(source="environment"), credentials, Mock())
        manager.bot = FakeBot(events, stop_result=False)

        stopped = manager.delete_secret()

        self.assertFalse(stopped)
        self.assertEqual(events, ["delete", "stop"])
        self.assertEqual(manager.status()["desiredGeneration"], 2)
        self.assertEqual(manager.status()["appliedGeneration"], 0)
        self.assertEqual(manager.status()["lastError"], "TELEGRAM_STOP_TIMEOUT")

    def test_apply_never_constructs_replacement_when_old_bot_does_not_join(self):
        events = []
        config = read_telegram_config({"PRISMA_LOCAL_TELEGRAM_ENABLED": "1", "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "token"})
        resolver = Mock(source="environment")
        resolver.resolve.return_value = "token"
        factory = Mock()
        manager = TelegramLifecycleManager(config, resolver, Mock(), factory)
        manager.bot = FakeBot(events, stop_result=False)

        with self.assertRaisesRegex(TelegramLifecycleError, "TELEGRAM_STOP_TIMEOUT"):
            manager.apply()

        factory.assert_not_called()
        self.assertEqual(events, ["stop"])

    def test_successful_apply_stops_old_before_preparing_and_starting_one_replacement(self):
        events = []
        config = read_telegram_config({"PRISMA_LOCAL_TELEGRAM_ENABLED": "1", "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "token"})
        resolver = Mock(source="environment")
        resolver.resolve.return_value = "token"
        replacement = FakeBot(events)
        manager = TelegramLifecycleManager(config, resolver, Mock(), lambda _token: replacement)
        manager.bot = FakeBot(events)

        status = manager.apply()

        self.assertEqual(events, ["stop", "prepare", "start"])
        self.assertTrue(status["running"])
        self.assertTrue(status["verified"])
        self.assertFalse(status["restartRequired"])

    def test_disabled_startup_does_not_resolve_or_construct(self):
        config = read_telegram_config({"PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "ignored"})
        resolver = Mock(source="environment")
        manager = TelegramLifecycleManager(config, resolver, Mock(), Mock())

        status = manager.startup_apply()

        resolver.resolve.assert_not_called()
        manager.bot_factory.assert_not_called()
        self.assertFalse(status["enabled"])
        self.assertFalse(status["running"])

    def test_store_mutation_and_generation_capture_are_atomic_against_apply(self):
        entered = threading.Event()
        release = threading.Event()
        credentials = Mock()

        def blocking_set(_provider, _secret):
            entered.set()
            self.assertTrue(release.wait(1))

        credentials.set_secret.side_effect = blocking_set
        config = read_telegram_config({"PRISMA_LOCAL_TELEGRAM_ENABLED": "1", "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "token"})
        resolver = Mock(source="environment")
        resolver.resolve.return_value = "token"
        events = []
        manager = TelegramLifecycleManager(config, resolver, credentials, lambda _token: FakeBot(events))
        saved = threading.Thread(target=manager.set_secret, args=("new",))
        applied = threading.Thread(target=manager.apply)

        saved.start()
        self.assertTrue(entered.wait(1))
        applied.start()
        self.assertEqual(events, [])
        release.set()
        saved.join(1)
        applied.join(1)

        self.assertFalse(saved.is_alive())
        self.assertFalse(applied.is_alive())
        self.assertEqual(manager.status()["desiredGeneration"], 2)
        self.assertEqual(manager.status()["appliedGeneration"], 2)


if __name__ == "__main__":
    unittest.main()
