import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import httpx
from google.genai import errors as genai_errors

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.gemini_credentials import (
    GEMINI_VERIFY_MODEL,
    GEMINI_VERIFY_TIMEOUT_MS,
    GeminiCredentialResolver,
    GeminiCredentialUnavailable,
    GeminiVerificationInProgress,
    GeminiVerificationService,
    create_gemini_client,
)
from prisma_runtime.voice_service import TTS_MODEL


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

    def test_client_accepts_an_explicit_shorter_timeout_for_verification(self):
        client_type = Mock(return_value=object())
        http_options_type = Mock(return_value="http-options")
        with patch.dict("sys.modules", {"google.genai": Mock(Client=client_type, types=Mock(HttpOptions=http_options_type))}):
            create_gemini_client("secret", timeout_ms=GEMINI_VERIFY_TIMEOUT_MS)

        http_options_type.assert_called_once_with(timeout=GEMINI_VERIFY_TIMEOUT_MS)


class GeminiVerifyModelTests(unittest.TestCase):
    def test_verification_checks_the_exact_model_the_voice_service_speaks_with(self):
        # The verification call must never silently drift from the model Prisma
        # actually uses for TTS generation; keep the two constants tied together.
        self.assertEqual(GEMINI_VERIFY_MODEL, TTS_MODEL)


class GeminiVerificationServiceTests(unittest.TestCase):
    def _resolver(self, *, secret: str | None = "a-real-looking-key"):
        resolver = Mock()
        if secret is None:
            resolver.resolve.side_effect = GeminiCredentialUnavailable("GEMINI_CREDENTIAL_MISSING")
        else:
            resolver.resolve.return_value = secret
        return resolver

    def test_snapshot_starts_not_checked(self):
        service = GeminiVerificationService(self._resolver(), client_factory=Mock())
        snapshot = service.snapshot()
        self.assertEqual(snapshot.state, "not_checked")
        self.assertIsNone(snapshot.checked_at)

    def test_missing_credential_is_not_configured_without_constructing_a_client(self):
        client_factory = Mock()
        service = GeminiVerificationService(
            self._resolver(secret=None), client_factory=client_factory, clock=lambda: 42.0
        )

        result = service.verify()

        self.assertEqual(result.state, "not_configured")
        self.assertEqual(result.checked_at, 42.0)
        client_factory.assert_not_called()
        self.assertEqual(service.snapshot(), result)

    def test_successful_model_lookup_is_verified(self):
        client = Mock()
        client.models.get.return_value = object()
        service = GeminiVerificationService(
            self._resolver(), client_factory=lambda secret: client, model="model-x", clock=lambda: 1.0
        )

        result = service.verify()

        self.assertEqual(result.state, "verified")
        self.assertEqual(result.checked_at, 1.0)
        client.models.get.assert_called_once_with(model="model-x")

    def test_client_error_maps_to_invalid_key(self):
        client = Mock()
        client.models.get.side_effect = genai_errors.ClientError(
            400, {"message": "API key not valid", "status": "INVALID_ARGUMENT"}
        )
        service = GeminiVerificationService(self._resolver(), client_factory=lambda secret: client, clock=lambda: 2.0)

        result = service.verify()

        self.assertEqual(result.state, "invalid_key")
        self.assertEqual(result.checked_at, 2.0)

    def test_server_error_and_network_failures_map_to_unreachable(self):
        for side_effect in (
            genai_errors.ServerError(503, {"message": "overloaded", "status": "UNAVAILABLE"}),
            httpx.ConnectError("connection refused"),
            httpx.TimeoutException("timed out"),
            TimeoutError("timed out"),
            OSError("network down"),
        ):
            with self.subTest(error=type(side_effect).__name__):
                client = Mock()
                client.models.get.side_effect = side_effect
                service = GeminiVerificationService(self._resolver(), client_factory=lambda secret: client, clock=lambda: 3.0)

                result = service.verify()

                self.assertEqual(result.state, "unreachable")

    def test_reset_returns_to_not_checked_after_a_verified_result(self):
        client = Mock()
        client.models.get.return_value = object()
        service = GeminiVerificationService(self._resolver(), client_factory=lambda secret: client, clock=lambda: 5.0)
        service.verify()

        service.reset()

        snapshot = service.snapshot()
        self.assertEqual(snapshot.state, "not_checked")
        self.assertIsNone(snapshot.checked_at)

    def test_a_verification_in_flight_rejects_a_concurrent_request(self):
        observed = {}

        def client_factory(secret):
            try:
                service.verify()
            except GeminiVerificationInProgress as error:
                observed["nested_error"] = error
            client = Mock()
            client.models.get.return_value = object()
            return client

        service = GeminiVerificationService(self._resolver(), client_factory=client_factory, clock=lambda: 6.0)

        result = service.verify()

        self.assertEqual(result.state, "verified")
        self.assertIsInstance(observed.get("nested_error"), GeminiVerificationInProgress)

    def test_default_client_factory_uses_the_short_verification_timeout(self):
        client_type = Mock()
        model_client = Mock()
        client_type.return_value = model_client
        http_options_type = Mock(return_value="http-options")
        with patch.dict("sys.modules", {"google.genai": Mock(Client=client_type, types=Mock(HttpOptions=http_options_type))}):
            service = GeminiVerificationService(self._resolver(secret="real-key"), clock=lambda: 7.0)
            result = service.verify()

        http_options_type.assert_called_once_with(timeout=GEMINI_VERIFY_TIMEOUT_MS)
        client_type.assert_called_once_with(api_key="real-key", http_options="http-options")
        model_client.models.get.assert_called_once_with(model=GEMINI_VERIFY_MODEL)
        self.assertEqual(result.state, "verified")


if __name__ == "__main__":
    unittest.main()
