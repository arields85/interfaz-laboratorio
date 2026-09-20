import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.admin_http import AdminHttpBoundary
from prisma_runtime import local_presentation
from prisma_runtime.local_presentation import JsonFileStore, VoiceEventStore, create_app
from prisma_runtime.telegram_config import read_telegram_config
from prisma_runtime.telegram_lifecycle import TelegramLifecycleError


# Exact admin contract mirrored from hmi-app/src/domain/adminCredential.types.ts,
# which rejects any additional key instead of ignoring it.
ADMIN_TELEGRAM_FIELDS = {
    "source", "enabled", "configured", "desiredGeneration", "appliedGeneration",
    "running", "verified", "restartRequired", "lastError",
}
INTERNAL_STATUS_CANARY = "CANARY-internal-telegram-diagnostic"


def canonical_admin_status(**overrides):
    """Realistic manager status: the exact nine admin fields plus internal-only extras."""
    status = {
        "source": "protected",
        "enabled": True,
        "configured": True,
        "desiredGeneration": 2,
        "appliedGeneration": 2,
        "running": True,
        "verified": True,
        "restartRequired": False,
        "lastError": None,
        "telegramDiagnostic": {
            "stage": "poll",
            "category": "http",
            "httpStatus": 409,
            "failureAt": "2026-09-19T22:08:41Z",
            "lastSuccessAt": None,
        },
        "internalFutureField": INTERNAL_STATUS_CANARY,
    }
    status.update(overrides)
    return status


class TelegramHttpTests(unittest.TestCase):
    def authenticated_client(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        auth = Mock()
        auth.read_session.return_value = SimpleNamespace(csrf_token="csrf", username="admin")
        credentials = Mock()
        manager = Mock()
        boundary = AdminHttpBoundary(auth, credential_service=credentials, telegram_manager=manager)
        client = create_app(
            JsonFileStore(Path(temporary.name) / "snapshot.json"),
            VoiceEventStore(),
            None,
            admin_http=boundary,
            telegram_manager=manager,
        ).test_client()
        client.set_cookie("prisma_admin_session", "session", path="/api/prisma/admin")
        return client, credentials, manager

    def test_apply_requires_admin_authentication_before_request_processing(self):
        with tempfile.TemporaryDirectory() as temporary:
            auth = Mock()
            auth.read_session.return_value = None
            boundary = AdminHttpBoundary(auth, credential_service=Mock())
            client = create_app(
                JsonFileStore(Path(temporary) / "snapshot.json"),
                VoiceEventStore(),
                None,
                admin_http=boundary,
            ).test_client()

            response = client.post(
                "/api/prisma/admin/credentials/telegram/apply",
                data=b"not-json",
                headers={"Origin": "http://localhost:5173", "X-CSRF-Token": "ignored"},
                environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"},
            )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "AUTHENTICATION_REQUIRED")
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_apply_validates_origin_and_csrf_before_body_or_lifecycle(self):
        client, credentials, manager = self.authenticated_client()
        environ = {"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"}

        missing_origin = client.post(
            "/api/prisma/admin/credentials/telegram/apply",
            data=b"not-json",
            content_type="application/json",
            headers={"X-CSRF-Token": "csrf"},
            environ_overrides=environ,
        )
        wrong_csrf = client.post(
            "/api/prisma/admin/credentials/telegram/apply",
            data=b"not-json",
            content_type="application/json",
            headers={"Origin": "http://localhost:5173", "X-CSRF-Token": "wrong"},
            environ_overrides=environ,
        )

        self.assertEqual(missing_origin.status_code, 403)
        self.assertEqual(wrong_csrf.status_code, 403)
        manager.assert_not_called()
        credentials.assert_not_called()

    def test_exact_bounded_apply_contract_and_no_store_method_family(self):
        client, _credentials, manager = self.authenticated_client()
        manager.apply.return_value = {
            "source": "protected", "enabled": True, "configured": True,
            "desiredGeneration": 2, "appliedGeneration": 2, "running": True,
            "verified": True, "restartRequired": False, "lastError": None,
        }
        headers = {"Origin": "http://localhost:5173", "X-CSRF-Token": "csrf"}
        environ = {"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"}

        accepted = client.post("/api/prisma/admin/credentials/telegram/apply", json={}, headers=headers, environ_overrides=environ)
        invalid = client.post("/api/prisma/admin/credentials/telegram/apply", json={"extra": True}, headers=headers, environ_overrides=environ)
        oversized = client.post(
            "/api/prisma/admin/credentials/telegram/apply",
            data=b"{" + b" " * 128 + b"}",
            content_type="application/json",
            headers=headers,
            environ_overrides=environ,
        )
        wrong_type = client.post(
            "/api/prisma/admin/credentials/telegram/apply",
            data=b"{}",
            content_type="text/plain",
            headers=headers,
            environ_overrides=environ,
        )
        method_error = client.get("/api/prisma/admin/credentials/telegram/apply", environ_overrides=environ)
        options = client.options("/api/prisma/admin/credentials/telegram/apply", environ_overrides=environ)

        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.get_json()["telegram"]["appliedGeneration"], 2)
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(oversized.status_code, 413)
        self.assertEqual(wrong_type.status_code, 415)
        self.assertEqual(method_error.status_code, 405)
        self.assertEqual(options.status_code, 200)
        for response in (accepted, invalid, oversized, wrong_type, method_error, options):
            self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        manager.apply.assert_called_once_with()

    def test_apply_success_projects_only_the_exact_nine_admin_fields(self):
        client, _credentials, manager = self.authenticated_client()
        status = canonical_admin_status()
        manager.apply.return_value = status

        response = client.post(
            "/api/prisma/admin/credentials/telegram/apply",
            json={},
            headers={"Origin": "http://localhost:5173", "X-CSRF-Token": "csrf"},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"},
        )

        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["ok"])
        self.assertEqual(set(payload["telegram"]), ADMIN_TELEGRAM_FIELDS)
        for field in ADMIN_TELEGRAM_FIELDS:
            self.assertEqual(payload["telegram"][field], status[field])
        self.assertNotIn("telegramDiagnostic", payload["telegram"])
        self.assertNotIn(INTERNAL_STATUS_CANARY, response.get_data(as_text=True))
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        # The projection must copy manager-owned state, never pop from it.
        self.assertEqual(set(status), ADMIN_TELEGRAM_FIELDS | {"telegramDiagnostic", "internalFutureField"})
        self.assertEqual(status["telegramDiagnostic"]["stage"], "poll")

    def test_apply_lifecycle_error_projects_only_the_exact_nine_admin_fields(self):
        client, _credentials, manager = self.authenticated_client()
        status = canonical_admin_status(running=False, verified=False, lastError="TELEGRAM_STOP_TIMEOUT")
        manager.apply.side_effect = TelegramLifecycleError("TELEGRAM_STOP_TIMEOUT")
        manager.status.return_value = status

        response = client.post(
            "/api/prisma/admin/credentials/telegram/apply",
            json={},
            headers={"Origin": "http://localhost:5173", "X-CSRF-Token": "csrf"},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"},
        )

        payload = response.get_json()
        self.assertEqual(response.status_code, 409)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"], "TELEGRAM_STOP_TIMEOUT")
        self.assertEqual(set(payload["telegram"]), ADMIN_TELEGRAM_FIELDS)
        for field in ADMIN_TELEGRAM_FIELDS:
            self.assertEqual(payload["telegram"][field], status[field])
        self.assertNotIn("telegramDiagnostic", payload["telegram"])
        self.assertNotIn(INTERNAL_STATUS_CANARY, response.get_data(as_text=True))
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(set(status), ADMIN_TELEGRAM_FIELDS | {"telegramDiagnostic", "internalFutureField"})

    def test_apply_identity_conflict_maps_to_fixed_409_with_exact_nine_fields(self):
        client, credentials, manager = self.authenticated_client()
        status = canonical_admin_status(
            appliedGeneration=0,
            running=False,
            verified=False,
            restartRequired=True,
            lastError="TELEGRAM_BOT_IDENTITY_RESERVED",
            telegramDiagnostic={
                "stage": "prepare",
                "category": "unexpected",
                "httpStatus": None,
                "failureAt": "2026-09-19T22:08:41Z",
                "lastSuccessAt": None,
            },
        )
        manager.apply.side_effect = TelegramLifecycleError("TELEGRAM_BOT_IDENTITY_RESERVED")
        manager.status.return_value = status

        response = client.post(
            "/api/prisma/admin/credentials/telegram/apply",
            json={},
            headers={"Origin": "http://localhost:5173", "X-CSRF-Token": "csrf"},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"},
        )

        payload = response.get_json()
        self.assertEqual(response.status_code, 409)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"], "TELEGRAM_BOT_IDENTITY_RESERVED")
        self.assertEqual(set(payload["telegram"]), ADMIN_TELEGRAM_FIELDS)
        for field in ADMIN_TELEGRAM_FIELDS:
            self.assertEqual(payload["telegram"][field], status[field])
        self.assertNotIn("telegramDiagnostic", payload["telegram"])
        self.assertNotIn("committed", payload)
        self.assertNotIn(INTERNAL_STATUS_CANARY, response.get_data(as_text=True))
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        # A refused activation never becomes a credential mutation.
        credentials.set_secret.assert_not_called()
        credentials.delete_secret.assert_not_called()
        manager.set_secret.assert_not_called()
        manager.delete_secret.assert_not_called()
        self.assertEqual(set(status), ADMIN_TELEGRAM_FIELDS | {"telegramDiagnostic", "internalFutureField"})

    def test_put_is_desired_only_and_delete_timeout_reports_committed_outcome(self):
        client, credentials, manager = self.authenticated_client()
        manager.delete_secret.return_value = False
        headers = {"Origin": "http://localhost:5173", "X-CSRF-Token": "csrf"}
        environ = {"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"}

        saved = client.put(
            "/api/prisma/admin/credentials/telegram",
            json={"secret": "replacement"},
            headers=headers,
            environ_overrides=environ,
        )
        deleted = client.delete(
            "/api/prisma/admin/credentials/telegram",
            headers=headers,
            environ_overrides=environ,
        )

        self.assertEqual(saved.status_code, 200)
        manager.set_secret.assert_called_once_with("replacement")
        manager.apply.assert_not_called()
        self.assertEqual(deleted.status_code, 409)
        self.assertEqual(deleted.get_json(), {"ok": False, "error": "TELEGRAM_STOP_TIMEOUT"})
        manager.delete_secret.assert_called_once_with()
        credentials.set_secret.assert_not_called()
        credentials.delete_secret.assert_not_called()

    def test_apply_errors_are_sanitized_and_never_echo_secret_details(self):
        client, _credentials, manager = self.authenticated_client()
        manager.apply.side_effect = TelegramLifecycleError("TELEGRAM_PROVIDER_UNAVAILABLE")
        manager.status.return_value = canonical_admin_status(
            running=False, verified=False, lastError="TELEGRAM_PROVIDER_UNAVAILABLE"
        )
        response = client.post(
            "/api/prisma/admin/credentials/telegram/apply",
            json={},
            headers={"Origin": "http://localhost:5173", "X-CSRF-Token": "csrf"},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"},
        )

        self.assertEqual(response.status_code, 502)
        self.assertFalse(response.get_json()["ok"])
        self.assertEqual(response.get_json()["error"], "TELEGRAM_PROVIDER_UNAVAILABLE")
        self.assertEqual(set(response.get_json()["telegram"]), ADMIN_TELEGRAM_FIELDS)
        self.assertNotIn(INTERNAL_STATUS_CANARY, response.get_data(as_text=True))

    def test_public_health_reads_only_cached_manager_status(self):
        client, credentials, manager = self.authenticated_client()
        manager.status.return_value = {
            "source": "protected", "enabled": True, "configured": True,
            "desiredGeneration": 3, "appliedGeneration": 2, "running": True,
            "verified": True, "restartRequired": True, "lastError": None,
        }
        fake_http = Mock()
        fake_http.get.return_value.json.return_value = {"ok": True}

        with patch.object(local_presentation.requests, "Session", return_value=fake_http):
            # Rebuild so the voice-health session is also a fully offline fake.
            temporary = tempfile.TemporaryDirectory()
            self.addCleanup(temporary.cleanup)
            boundary = AdminHttpBoundary(Mock(), credential_service=credentials, telegram_manager=manager)
            health_client = create_app(
                JsonFileStore(Path(temporary.name) / "snapshot.json"),
                VoiceEventStore(),
                None,
                admin_http=boundary,
                telegram_manager=manager,
            ).test_client()
            response = health_client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["telegramDesiredGeneration"], 3)
        manager.status.assert_called_once_with()
        manager.apply.assert_not_called()
        credentials.assert_not_called()

    def offline_health_response(self, manager, telegram_configuration):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        credentials = Mock()
        fake_http = Mock()
        fake_http.get.return_value.json.return_value = {"ok": True}
        with patch.object(local_presentation.requests, "Session", return_value=fake_http):
            boundary = AdminHttpBoundary(Mock(), credential_service=credentials, telegram_manager=manager)
            health_client = create_app(
                JsonFileStore(Path(temporary.name) / "snapshot.json"),
                VoiceEventStore(),
                None,
                telegram_configuration=telegram_configuration,
                admin_http=boundary,
                telegram_manager=manager,
            ).test_client()
            response = health_client.get("/health")
        manager.apply.assert_not_called()
        self.assertEqual(credentials.mock_calls, [])
        return response

    def protected_startup_configuration(self):
        # Inert fake master-key path: only selects protected mode in the config
        # dictionary; no key file, credential store, or provider is ever touched.
        return read_telegram_config({
            "PRISMA_LOCAL_TELEGRAM_ENABLED": "1",
            "PRISMA_CREDENTIAL_MASTER_KEY_FILE": "inert-fake-master-key.path",
        })

    def test_public_health_does_not_report_missing_credential_when_lifecycle_is_configured(self):
        manager = Mock()
        manager.status.return_value = {
            "source": "protected", "enabled": True, "configured": True,
            "desiredGeneration": 2, "appliedGeneration": 0, "running": False,
            "verified": False, "restartRequired": True, "lastError": None,
        }

        response = self.offline_health_response(manager, self.protected_startup_configuration())

        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(payload["telegramConfigurationError"])
        self.assertIsNone(payload["telegramLastError"])
        self.assertTrue(payload["telegramConfigured"])
        self.assertFalse(payload["telegramConnected"])
        self.assertTrue(payload["telegramRestartRequired"])
        self.assertEqual(payload["telegramDesiredGeneration"], 2)
        self.assertEqual(payload["telegramAppliedGeneration"], 0)

    def test_public_health_keeps_lifecycle_error_out_of_configuration_error_when_configured(self):
        manager = Mock()
        manager.status.return_value = {
            "source": "protected", "enabled": True, "configured": True,
            "desiredGeneration": 2, "appliedGeneration": 2, "running": True,
            "verified": True, "restartRequired": False, "lastError": "TELEGRAM_POLL_FAILED",
        }

        response = self.offline_health_response(manager, self.protected_startup_configuration())

        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(payload["telegramConfigurationError"])
        self.assertEqual(payload["telegramLastError"], "TELEGRAM_POLL_FAILED")
        self.assertTrue(payload["telegramConfigured"])

    def test_public_health_preserves_unconfigured_manager_error(self):
        manager = Mock()
        manager.status.return_value = {
            "source": "protected", "enabled": True, "configured": False,
            "desiredGeneration": 1, "appliedGeneration": 0, "running": False,
            "verified": False, "restartRequired": False,
            "lastError": "TELEGRAM_PROVIDER_UNAVAILABLE",
        }

        response = self.offline_health_response(manager, self.protected_startup_configuration())

        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["telegramConfigurationError"], "TELEGRAM_PROVIDER_UNAVAILABLE")
        self.assertEqual(payload["telegramLastError"], "TELEGRAM_PROVIDER_UNAVAILABLE")
        self.assertFalse(payload["telegramConfigured"])

    def test_public_health_manager_status_outranks_startup_missing_credential_when_unconfigured(self):
        manager = Mock()
        manager.status.return_value = {
            "source": "protected", "enabled": True, "configured": False,
            "desiredGeneration": 1, "appliedGeneration": 0, "running": False,
            "verified": False, "restartRequired": False, "lastError": None,
        }

        response = self.offline_health_response(manager, self.protected_startup_configuration())

        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(payload["telegramConfigurationError"])
        self.assertFalse(payload["telegramConfigured"])


if __name__ == "__main__":
    unittest.main()
