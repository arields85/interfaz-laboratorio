"""B8: in protected mode Channel B is enabled by its stored credential, not by an env switch."""

import sys
import unittest
from pathlib import Path


RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from leda_runtime.telegram_config import read_telegram_config
from leda_runtime.telegram_credentials import TelegramCredentialError
from leda_runtime.telegram_lifecycle import TelegramLifecycleError, TelegramLifecycleManager

PROTECTED_ENV = {"LEDA_CREDENTIAL_MASTER_KEY_FILE": "inert-fake-master-key.path"}


class FakeBot:
    def __init__(self, token):
        self.token = token
        self.stopped = False
        self.thread = None
        self.stop_event = None
        self.bot_username = None

    def prepare(self):
        pass

    def start(self):
        pass

    def stop(self):
        self.stopped = True
        return True


class FakeStore:
    """Stands in for the protected credential database, shared across 'restarts'."""

    def __init__(self, token=None, unavailable=False):
        self.token = token
        self.unavailable = unavailable

    def set_secret(self, provider, secret):
        assert provider == "telegram"
        self.token = secret

    def delete_secret(self, provider):
        assert provider == "telegram"
        self.token = None


class FakeResolver:
    source = "protected"

    def __init__(self, store):
        self.store = store

    def resolve(self):
        if self.store.unavailable:
            raise TelegramCredentialError("CREDENTIAL_STORAGE_UNAVAILABLE")
        if not self.store.token:
            raise TelegramCredentialError("TELEGRAM_CREDENTIAL_MISSING")
        return self.store.token


def build_manager(store, env=None):
    config = read_telegram_config({**PROTECTED_ENV, **(env or {})})
    created = []

    def factory(token):
        bot = FakeBot(token)
        created.append(bot)
        return bot

    return TelegramLifecycleManager(config, FakeResolver(store), store, factory), created


class ProtectedConfigTests(unittest.TestCase):
    def test_protected_mode_is_enabled_without_the_env_switch(self):
        config = read_telegram_config(dict(PROTECTED_ENV))
        self.assertTrue(config.enabled)
        self.assertEqual(config.source, "protected")
        self.assertEqual(config.token, "")

    def test_protected_mode_ignores_an_explicit_disabling_env_value(self):
        for value in ("0", "", "false"):
            config = read_telegram_config({**PROTECTED_ENV, "LEDA_LOCAL_TELEGRAM_ENABLED": value})
            self.assertTrue(config.enabled, value)

    def test_environment_mode_still_requires_the_env_switch(self):
        self.assertFalse(read_telegram_config({"LEDA_LOCAL_TELEGRAM_BOT_TOKEN": "t"}).enabled)
        config = read_telegram_config({"LEDA_LOCAL_TELEGRAM_ENABLED": "1", "LEDA_LOCAL_TELEGRAM_BOT_TOKEN": "t"})
        self.assertTrue(config.enabled)
        self.assertEqual(config.token, "t")


class ProtectedLifecycleTests(unittest.TestCase):
    def test_boot_with_a_stored_credential_starts_without_the_env_switch(self):
        manager, created = build_manager(FakeStore("stored-token"))
        status = manager.startup_apply()
        self.assertEqual([bot.token for bot in created], ["stored-token"])
        self.assertTrue(status["enabled"])
        self.assertTrue(status["configured"])
        self.assertTrue(status["running"])
        self.assertTrue(status["verified"])
        self.assertFalse(status["restartRequired"])
        self.assertIsNone(status["lastError"])

    def test_boot_with_a_disabling_env_value_still_starts(self):
        manager, created = build_manager(FakeStore("stored-token"), {"LEDA_LOCAL_TELEGRAM_ENABLED": "0"})
        self.assertTrue(manager.startup_apply()["running"])
        self.assertEqual(len(created), 1)

    def test_boot_without_a_credential_is_a_pure_no_op(self):
        manager, created = build_manager(FakeStore())
        before = manager.status()
        status = manager.startup_apply()
        self.assertEqual(created, [])
        self.assertEqual(status, before)
        self.assertFalse(status["enabled"])
        self.assertFalse(status["configured"])
        self.assertFalse(status["running"])
        self.assertFalse(status["restartRequired"])
        self.assertIsNone(status["lastError"])

    def test_boot_with_unavailable_storage_captures_the_failure_and_never_raises(self):
        manager, created = build_manager(FakeStore("stored-token", unavailable=True))
        status = manager.startup_apply()
        self.assertEqual(created, [])
        self.assertFalse(status["running"])
        self.assertEqual(status["lastError"], "CREDENTIAL_STORAGE_UNAVAILABLE")

    def test_boot_with_an_unexpected_storage_error_never_raises(self):
        store = FakeStore("stored-token")
        manager, created = build_manager(store)

        def explode():
            raise OSError("disk unavailable")

        manager.resolver.resolve = explode
        with self.assertLogs("leda_runtime.telegram_lifecycle", level="WARNING") as logs:
            status = manager.startup_apply()
        self.assertEqual(len(logs.output), 1)
        self.assertIn("reason=OSError", logs.output[0])
        self.assertNotIn("disk unavailable", logs.output[0])
        self.assertEqual(created, [])
        self.assertFalse(status["running"])
        self.assertEqual(status["lastError"], "CREDENTIAL_STORAGE_UNAVAILABLE")

    def test_apply_without_a_credential_reports_the_missing_credential_not_disabled(self):
        manager, created = build_manager(FakeStore())
        with self.assertRaises(TelegramLifecycleError) as context:
            manager.apply()
        self.assertEqual(context.exception.args[0], "TELEGRAM_CREDENTIAL_MISSING")
        self.assertEqual(created, [])
        self.assertEqual(manager.status()["lastError"], "TELEGRAM_CREDENTIAL_MISSING")
        self.assertFalse(manager.status()["enabled"])

    def test_saving_the_credential_marks_it_enabled_and_apply_starts_it(self):
        store = FakeStore()
        manager, created = build_manager(store)
        manager.set_secret("fresh-token")
        pending = manager.status()
        self.assertTrue(pending["enabled"])
        self.assertTrue(pending["configured"])
        self.assertTrue(pending["restartRequired"])
        status = manager.apply()
        self.assertEqual([bot.token for bot in created], ["fresh-token"])
        self.assertTrue(status["running"])
        self.assertTrue(status["enabled"])
        self.assertFalse(status["restartRequired"])

    def test_deleting_the_credential_stops_it_and_it_stays_off_after_a_restart(self):
        store = FakeStore("stored-token")
        manager, created = build_manager(store)
        manager.startup_apply()
        self.assertTrue(manager.delete_secret())
        self.assertTrue(created[0].stopped)
        status = manager.status()
        self.assertFalse(status["enabled"])
        self.assertFalse(status["configured"])
        self.assertFalse(status["running"])
        self.assertFalse(status["restartRequired"])

        rebooted, rebooted_created = build_manager(store)
        rebooted_status = rebooted.startup_apply()
        self.assertEqual(rebooted_created, [])
        self.assertFalse(rebooted_status["running"])
        self.assertFalse(rebooted_status["enabled"])
        self.assertIsNone(rebooted_status["lastError"])

    def test_status_keeps_the_strict_field_set(self):
        manager, _ = build_manager(FakeStore("stored-token"))
        before = set(manager.status())
        manager.startup_apply()
        self.assertEqual(set(manager.status()), before)


class EnvironmentLifecycleTests(unittest.TestCase):
    def test_environment_mode_without_the_switch_stays_disabled(self):
        config = read_telegram_config({"LEDA_LOCAL_TELEGRAM_BOT_TOKEN": "t"})
        created = []
        resolver = FakeResolver(FakeStore("t"))
        resolver.source = "environment"
        manager = TelegramLifecycleManager(config, resolver, None, lambda token: created.append(token))
        status = manager.startup_apply()
        self.assertEqual(created, [])
        self.assertFalse(status["enabled"])
        with self.assertRaises(TelegramLifecycleError) as context:
            manager.apply()
        self.assertEqual(context.exception.args[0], "TELEGRAM_DISABLED")


if __name__ == "__main__":
    unittest.main()
