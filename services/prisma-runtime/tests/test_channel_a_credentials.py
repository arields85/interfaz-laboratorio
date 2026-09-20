import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, call, patch

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime import channel_a_credentials
from prisma_runtime.channel_a_credentials import (
    PRISMA_CHANNEL_A_CREDENTIAL_MISSING,
    PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE,
    ChannelACredentialError,
    ChannelACredentialResolver,
)


class ChannelACredentialResolverTests(unittest.TestCase):
    def test_constructor_is_lazy_and_retains_explicit_factory(self):
        factory = Mock()

        resolver = ChannelACredentialResolver(factory)

        self.assertIs(resolver.credential_service_factory, factory)
        self.assertEqual(factory.mock_calls, [])

    def test_explicit_none_factory_uses_module_default_reference_without_invoking_it(self):
        with patch.object(channel_a_credentials, "_default_service") as default_service:
            resolver = ChannelACredentialResolver(None)

            self.assertIs(resolver.credential_service_factory, default_service)
            self.assertEqual(default_service.mock_calls, [])

    def test_falsy_explicit_factory_is_not_replaced_by_default(self):
        store = Mock()
        store.get_secret.return_value = "falsy-value"

        class FalsyFactory:
            def __bool__(self):
                return False

            def __call__(self):
                return store

        factory = FalsyFactory()
        resolver = ChannelACredentialResolver(factory)

        self.assertIs(resolver.credential_service_factory, factory)
        self.assertEqual(resolver.resolve(), "falsy-value")

    def test_resolve_invokes_factory_and_secret_lookup_with_exact_key(self):
        factory = Mock()
        factory.return_value.get_secret.return_value = "protected-value"
        resolver = ChannelACredentialResolver(factory)

        self.assertEqual(resolver.resolve(), "protected-value")
        self.assertEqual(factory.mock_calls, [call(), call().get_secret("telegram_channel_a")])

    def test_protected_secret_bytes_are_returned_unchanged(self):
        for secret in ("  spaced-token  ", "clé-ünïcode-🔐", "line\nbreak\ttab"):
            store = Mock()
            store.get_secret.return_value = secret
            resolver = ChannelACredentialResolver(lambda: store)
            with self.subTest(secret=secret):
                self.assertEqual(resolver.resolve(), secret)

    def test_absent_non_string_or_blank_secret_is_fixed_missing(self):
        for candidate in (None, "", "   ", b"bytes", 12345, ["list"]):
            store = Mock()
            store.get_secret.return_value = candidate
            resolver = ChannelACredentialResolver(lambda: store)
            with self.subTest(candidate=candidate):
                with self.assertRaises(ChannelACredentialError) as raised:
                    resolver.resolve()
                self.assertEqual(raised.exception.args, (PRISMA_CHANNEL_A_CREDENTIAL_MISSING,))

    def test_repeated_resolve_rereads_rotated_and_deleted_secret(self):
        store = Mock()
        store.get_secret.side_effect = ["first-rotation", None, "second-rotation"]
        factory = Mock(return_value=store)
        resolver = ChannelACredentialResolver(factory)

        self.assertEqual(resolver.resolve(), "first-rotation")
        with self.assertRaises(ChannelACredentialError) as deleted:
            resolver.resolve()
        self.assertEqual(deleted.exception.args, (PRISMA_CHANNEL_A_CREDENTIAL_MISSING,))
        self.assertEqual(resolver.resolve(), "second-rotation")
        self.assertEqual(factory.call_count, 3)
        self.assertEqual(store.get_secret.call_args_list, [call("telegram_channel_a")] * 3)

    def test_environment_tokens_never_act_as_alternate_authority(self):
        store = Mock()
        store.get_secret.return_value = None
        synthetic = {
            "PRISMA_CREDENTIAL_MASTER_KEY_FILE": "C:/protected/master.key",
            "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "synthetic-bot-b-marker",
            "GEMINI_API_KEY": "synthetic-gemini-marker",
            "PRISMA_CHANNEL_A_BOT_TOKEN": "synthetic-future-a-marker",
        }
        resolver = ChannelACredentialResolver(lambda: store)

        with patch.dict(os.environ, synthetic):
            with self.assertRaises(ChannelACredentialError) as raised:
                resolver.resolve()

        self.assertEqual(raised.exception.args, (PRISMA_CHANNEL_A_CREDENTIAL_MISSING,))
        self.assertEqual(store.get_secret.call_args_list, [call("telegram_channel_a")])

    def test_factory_store_and_presence_failures_sanitize_to_fixed_unavailable(self):
        class ExplosiveStr(str):
            def strip(self, *args, **kwargs):
                raise RuntimeError("raw-presence-marker")

        def failing_factory():
            raise RuntimeError("raw-factory-marker")

        store = Mock()
        store.get_secret.side_effect = OSError("raw-store-marker")
        presence_store = Mock()
        presence_store.get_secret.return_value = ExplosiveStr("secret")
        cases = (
            (ChannelACredentialResolver(failing_factory), "raw-factory-marker"),
            (ChannelACredentialResolver(lambda: store), "raw-store-marker"),
            (ChannelACredentialResolver(lambda: presence_store), "raw-presence-marker"),
        )

        for resolver, canary in cases:
            with self.subTest(canary=canary):
                with self.assertRaises(ChannelACredentialError) as raised:
                    resolver.resolve()
                error = raised.exception
                self.assertEqual(error.args, (PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE,))
                self.assertNotIn(canary, str(error))
                self.assertNotIn(canary, repr(error))
                self.assertIsNone(error.__cause__)
                self.assertTrue(error.__suppress_context__)

    def test_collaborator_channel_a_error_is_sanitized_not_passed_through(self):
        def failing_factory():
            raise ChannelACredentialError("canary-secret-9c3")

        resolver = ChannelACredentialResolver(failing_factory)

        with self.assertRaises(ChannelACredentialError) as raised:
            resolver.resolve()

        error = raised.exception
        self.assertEqual(error.args, (PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE,))
        self.assertNotIn("canary-secret-9c3", str(error))
        self.assertNotIn("canary-secret-9c3", repr(error))
        self.assertTrue(error.__suppress_context__)

    def test_default_factory_composes_protected_store_like_gemini(self):
        paths = Mock()
        paths.credential_database = Path("C:/runtime/credentials/provider-credentials.sqlite3")
        paths.root = Path("C:/runtime")
        permissions = Mock()
        service = Mock()
        service.get_secret.return_value = "  protected-value  "
        service_type = Mock(return_value=service)
        permissions_type = Mock(return_value=permissions)

        with patch.object(channel_a_credentials, "runtime_paths", return_value=paths) as runtime_paths_mock, \
                patch.object(channel_a_credentials, "SecureStoragePermissions", permissions_type), \
                patch.object(channel_a_credentials, "CredentialService", service_type), \
                patch.dict(os.environ, {"PRISMA_CREDENTIAL_MASTER_KEY_FILE": "C:/protected/master.key"}):
            resolver = ChannelACredentialResolver()
            self.assertEqual(service_type.mock_calls, [])
            result = resolver.resolve()

        self.assertEqual(result, "  protected-value  ")
        runtime_paths_mock.assert_called_once_with()
        permissions_type.assert_called_once_with()
        self.assertEqual(permissions.mock_calls, [])
        service_type.assert_called_once_with(
            paths.credential_database,
            "C:/protected/master.key",
            paths.root,
            permissions.verify,
        )
        self.assertEqual(service.get_secret.call_args_list, [call("telegram_channel_a")])

    def test_default_factory_never_uses_environment_tokens_as_alternate_authority(self):
        paths = Mock()
        paths.credential_database = Path("C:/runtime/credentials/provider-credentials.sqlite3")
        paths.root = Path("C:/runtime")
        permissions = Mock()
        service = Mock()
        service.get_secret.return_value = None
        service_type = Mock(return_value=service)
        permissions_type = Mock(return_value=permissions)
        synthetic = {
            "PRISMA_CREDENTIAL_MASTER_KEY_FILE": "C:/protected/master.key",
            "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "synthetic-bot-b-marker",
            "GEMINI_API_KEY": "synthetic-gemini-marker",
            "PRISMA_CHANNEL_A_BOT_TOKEN": "synthetic-future-a-marker",
        }

        with patch.object(channel_a_credentials, "runtime_paths", return_value=paths), \
                patch.object(channel_a_credentials, "SecureStoragePermissions", permissions_type), \
                patch.object(channel_a_credentials, "CredentialService", service_type), \
                patch.dict(os.environ, synthetic):
            resolver = ChannelACredentialResolver()
            with self.assertRaises(ChannelACredentialError) as raised:
                resolver.resolve()

        error = raised.exception
        self.assertEqual(error.args, (PRISMA_CHANNEL_A_CREDENTIAL_MISSING,))
        self.assertNotIn("synthetic-bot-b-marker", str(error))
        self.assertNotIn("synthetic-gemini-marker", repr(error))
        self.assertEqual(permissions.mock_calls, [])
        service_type.assert_called_once_with(
            paths.credential_database,
            "C:/protected/master.key",
            paths.root,
            permissions.verify,
        )

    def test_default_absent_master_is_unavailable_without_filesystem_probe(self):
        paths = Mock()
        paths.root = Path("C:/synthetic-runtime")
        paths.credential_database = Path("C:/synthetic-runtime/credentials/provider-credentials.sqlite3")
        permissions = Mock()
        permissions_type = Mock(return_value=permissions)
        synthetic = {
            "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "synthetic-bot-b-marker",
            "GEMINI_API_KEY": "synthetic-gemini-marker",
            "PRISMA_CHANNEL_A_BOT_TOKEN": "synthetic-future-a-marker",
        }

        with patch.object(channel_a_credentials, "runtime_paths", return_value=paths) as runtime_paths_mock, \
                patch.object(channel_a_credentials, "SecureStoragePermissions", permissions_type), \
                patch("prisma_runtime.credential_store.os.lstat") as lstat_mock, \
                patch("prisma_runtime.credential_store.sqlite3.connect") as connect_mock, \
                patch("pathlib.Path.open") as open_mock, \
                patch.dict(os.environ, synthetic, clear=False):
            os.environ.pop("PRISMA_CREDENTIAL_MASTER_KEY_FILE", None)
            resolver = ChannelACredentialResolver()
            with self.assertRaises(ChannelACredentialError) as raised:
                resolver.resolve()

        error = raised.exception
        self.assertEqual(error.args, (PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE,))
        runtime_paths_mock.assert_called_once_with()
        permissions_type.assert_called_once_with()
        self.assertEqual(permissions.mock_calls, [])
        self.assertEqual(lstat_mock.mock_calls, [])
        self.assertEqual(connect_mock.mock_calls, [])
        self.assertEqual(open_mock.mock_calls, [])
        for marker in synthetic.values():
            self.assertNotIn(marker, str(error))
            self.assertNotIn(marker, repr(error))

    def test_resolver_repr_does_not_expose_secret_material(self):
        secret = "repr-canary-7d1"
        store = Mock()
        store.get_secret.return_value = secret
        resolver = ChannelACredentialResolver(lambda: store)
        resolver.resolve()

        self.assertNotIn(secret, repr(resolver))
        self.assertNotIn(secret, str(resolver))
        self.assertNotIn(secret, repr(resolver.credential_service_factory))


if __name__ == "__main__":
    unittest.main()
