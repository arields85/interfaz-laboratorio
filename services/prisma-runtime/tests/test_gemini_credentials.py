import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.gemini_credentials import (
    GeminiCredentialResolver,
    GeminiCredentialUnavailable,
    create_gemini_client,
)


class GeminiCredentialResolverTests(unittest.TestCase):
    def test_protected_mode_is_authoritative_and_never_falls_back(self):
        store = Mock()
        store.get_secret.return_value = None
        resolver = GeminiCredentialResolver(
            {"PRISMA_CREDENTIAL_MASTER_KEY_FILE": "C:/protected/key", "GEMINI_API_KEY": "legacy"},
            credential_service_factory=lambda: store,
        )

        with self.assertRaises(GeminiCredentialUnavailable):
            resolver.resolve()

        self.assertEqual(
            resolver.status(),
            {"source": "protected", "configured": False, "available": True, "verified": False},
        )
        self.assertEqual(store.get_secret.call_count, 2)

    def test_legacy_environment_is_used_only_without_protected_mode(self):
        resolver = GeminiCredentialResolver({"GEMINI_API_KEY": "  legacy-key  "})

        self.assertEqual(resolver.resolve(), "legacy-key")
        self.assertEqual(
            resolver.status(),
            {"source": "environment", "configured": True, "available": True, "verified": False},
        )

    def test_protected_secret_is_not_trimmed_before_provider_construction(self):
        store = Mock()
        store.get_secret.return_value = "  protected-key  "
        resolver = GeminiCredentialResolver(
            {"PRISMA_CREDENTIAL_MASTER_KEY_FILE": "C:/protected/key"},
            credential_service_factory=lambda: store,
        )

        self.assertEqual(resolver.resolve(), "  protected-key  ")

    def test_storage_failure_is_sanitized_and_health_does_not_create_sdk_client(self):
        store = Mock()
        store.get_secret.side_effect = OSError("secret path")
        resolver = GeminiCredentialResolver(
            {"PRISMA_CREDENTIAL_MASTER_KEY_FILE": "C:/protected/key"},
            credential_service_factory=lambda: store,
        )

        self.assertEqual(
            resolver.status(),
            {"source": "protected", "configured": False, "available": False, "verified": False},
        )
        with self.assertRaisesRegex(GeminiCredentialUnavailable, "GEMINI_CREDENTIAL_UNAVAILABLE"):
            resolver.resolve()

    def test_client_uses_documented_45_second_sdk_timeout(self):
        client_type = Mock(return_value=object())
        http_options_type = Mock(return_value="http-options")
        with patch.dict("sys.modules", {"google.genai": Mock(Client=client_type, types=Mock(HttpOptions=http_options_type))}):
            result = create_gemini_client("secret")

        self.assertIsNotNone(result)
        http_options_type.assert_called_once_with(timeout=45_000)
        client_type.assert_called_once_with(api_key="secret", http_options="http-options")


if __name__ == "__main__":
    unittest.main()
