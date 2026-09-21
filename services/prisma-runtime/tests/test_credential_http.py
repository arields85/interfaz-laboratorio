import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.admin_http import AdminHttpBoundary
from prisma_runtime.credential_store import CredentialUnavailable
from prisma_runtime.local_presentation import JsonFileStore, VoiceEventStore, create_app


SECRET = "  synthetic-秘密-token  "


class CredentialHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.auth = Mock()
        self.credentials = Mock()
        self.session = SimpleNamespace(csrf_token="csrf-token", username="admin")
        self.auth.read_session.return_value = self.session
        self.telegram_manager = Mock()
        boundary = AdminHttpBoundary(
            self.auth, credential_service=self.credentials, telegram_manager=self.telegram_manager
        )
        self.client = create_app(
            JsonFileStore(self.root / "snapshot.json"),
            VoiceEventStore(),
            None,
            admin_http=boundary,
        ).test_client()
        self.client.set_cookie("prisma_admin_session", "session-id", path="/api/prisma/admin")
        self.environ = {"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"}
        self.headers = {"Origin": "http://localhost:5173", "X-CSRF-Token": "csrf-token"}

    def test_absent_expired_or_revoked_session_denies_before_provider_or_storage(self) -> None:
        self.auth.read_session.return_value = None
        response = self.client.put(
            "/api/prisma/admin/credentials/unsupported",
            json={"secret": "synthetic"},
            headers=self.headers,
            environ_overrides=self.environ,
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "AUTHENTICATION_REQUIRED")
        self.credentials.status.assert_not_called()
        self.credentials.set_secret.assert_not_called()
        self.credentials.delete_secret.assert_not_called()

    def test_write_requires_origin_and_rejects_malformed_csrf_before_storage(self) -> None:
        missing_origin = self.client.put(
            "/api/prisma/admin/credentials/gemini",
            json={"secret": SECRET},
            headers={"X-CSRF-Token": "csrf-token"},
            environ_overrides=self.environ,
        )
        self.assertEqual(missing_origin.status_code, 403)
        for method, token in (("put", None), ("put", "wrong"), ("put", "é"), ("delete", None), ("delete", "wrong"), ("delete", "é")):
            with self.subTest(method=method, token=token):
                headers = {"Origin": "http://localhost:5173"}
                if token is not None:
                    headers["X-CSRF-Token"] = token
                arguments = {"json": {"secret": SECRET}} if method == "put" else {}
                response = getattr(self.client, method)(
                    "/api/prisma/admin/credentials/gemini",
                    headers=headers,
                    environ_overrides=self.environ,
                    **arguments,
                )
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.get_json()["error"], "CSRF_VALIDATION_FAILED")
        self.credentials.assert_not_called()

    def test_metadata_only_get_and_committed_put_delete_never_echo_secret_or_set_cookie(self) -> None:
        self.credentials.status.return_value = {"gemini": True, "telegram": False, "telegram_channel_a": False}
        response = self.client.get("/api/prisma/admin/credentials", environ_overrides=self.environ)
        self.assertEqual(
            response.get_json(),
            {
                "ok": True,
                "providers": {
                    "gemini": {"configured": True},
                    "telegram": {"configured": False},
                    "telegram_channel_a": {"configured": False},
                },
            },
        )
        self.assertNotIn("Set-Cookie", response.headers)
        self.assertNotIn(SECRET, response.get_data(as_text=True))

        saved = self.client.put(
            "/api/prisma/admin/credentials/gemini",
            json={"secret": SECRET},
            headers=self.headers,
            environ_overrides=self.environ,
        )
        self.assertEqual(saved.get_json(), {"ok": True, "provider": "gemini", "configured": True})
        self.credentials.set_secret.assert_called_once_with("gemini", SECRET)
        self.assertNotIn(SECRET, saved.get_data(as_text=True))
        deleted = self.client.delete(
            "/api/prisma/admin/credentials/gemini", headers=self.headers, environ_overrides=self.environ
        )
        self.assertEqual(deleted.status_code, 204)
        self.credentials.delete_secret.assert_called_once_with("gemini")

    def test_strict_provider_payload_type_shape_and_decoded_bound_are_controlled(self) -> None:
        invalid_payloads = (None, [], {}, {"secret": None}, {"secret": ""}, {"secret": "   "}, {"secret": "x", "extra": 1})
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                arguments = {"json": payload} if payload is not None else {"data": b"null", "content_type": "application/json"}
                response = self.client.put(
                    "/api/prisma/admin/credentials/gemini", headers=self.headers, environ_overrides=self.environ, **arguments
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json()["error"], "INVALID_CREDENTIAL_REQUEST")

        unsupported = self.client.put(
            "/api/prisma/admin/credentials/other",
            json={"secret": "valid"},
            headers=self.headers,
            environ_overrides=self.environ,
        )
        self.assertEqual(unsupported.status_code, 404)
        over_decoded_limit = self.client.put(
            "/api/prisma/admin/credentials/gemini",
            json={"secret": "é" * 2049},
            headers=self.headers,
            environ_overrides=self.environ,
        )
        self.assertEqual(over_decoded_limit.status_code, 400)
        self.assertEqual(over_decoded_limit.get_json()["error"], "INVALID_CREDENTIAL_REQUEST")

    def test_wire_bound_accepts_maximum_decoded_secrets_but_rejects_true_oversize_bodies(self) -> None:
        for secret in ("😀" * 1024, "\x00" * 4096):
            with self.subTest(first_character=repr(secret[0])):
                response = self.client.put(
                    "/api/prisma/admin/credentials/gemini",
                    json={"secret": secret},
                    headers=self.headers,
                    environ_overrides=self.environ,
                )
                self.assertGreater(response.request.content_length, 8192)
                self.assertEqual(response.status_code, 200)
                self.credentials.set_secret.assert_called_with("gemini", secret)

        oversized = self.client.put(
            "/api/prisma/admin/credentials/gemini",
            data=b'{"secret":"' + b"x" * 30000 + b'"}',
            content_type="application/json",
            headers=self.headers,
            environ_overrides=self.environ,
        )
        self.assertEqual(oversized.status_code, 413)

    def test_credential_family_responses_are_no_store_without_scoping_lookalikes(self) -> None:
        self.auth.reset_mock()
        self.credentials.reset_mock()
        for path in ("/api/prisma/admin/credentials", "/api/prisma/admin/credentials/gemini"):
            with self.subTest(path=path):
                response = self.client.options(path, environ_overrides=self.environ)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers.get("Cache-Control"), "no-store")
                self.assertNotIn(SECRET, response.get_data(as_text=True))
        self.auth.read_session.assert_not_called()
        self.credentials.assert_not_called()

        method_error = self.client.post(
            "/api/prisma/admin/credentials/gemini", environ_overrides=self.environ
        )
        self.assertEqual(method_error.status_code, 405)
        self.assertEqual(method_error.headers.get("Cache-Control"), "no-store")
        lookalike = self.client.options(
            "/api/prisma/admin/credentials-lookalike", environ_overrides=self.environ
        )
        self.assertNotEqual(lookalike.headers.get("Cache-Control"), "no-store")

    def test_channel_a_writes_are_refused_without_a_manager_and_never_touch_the_store(self) -> None:
        # Approved user decision: a missing Channel A manager refuses save/delete
        # with a closed 503 instead of falling back to a direct store write.
        saved = self.client.put(
            "/api/prisma/admin/credentials/telegram_channel_a",
            json={"secret": SECRET},
            headers=self.headers,
            environ_overrides=self.environ,
        )
        self.assertEqual(saved.status_code, 503)
        self.assertEqual(saved.get_json(), {"ok": False, "error": "PRISMA_CHANNEL_A_MANAGER_UNAVAILABLE"})
        self.assertEqual(saved.headers.get("Cache-Control"), "no-store")
        self.credentials.set_secret.assert_not_called()
        self.assertNotIn(SECRET, saved.get_data(as_text=True))

        deleted = self.client.delete(
            "/api/prisma/admin/credentials/telegram_channel_a",
            headers=self.headers,
            environ_overrides=self.environ,
        )
        self.assertEqual(deleted.status_code, 503)
        self.assertEqual(deleted.get_json(), {"ok": False, "error": "PRISMA_CHANNEL_A_MANAGER_UNAVAILABLE"})
        self.assertEqual(deleted.headers.get("Cache-Control"), "no-store")
        self.credentials.delete_secret.assert_not_called()
        self.assertEqual(self.telegram_manager.mock_calls, [])

    def test_telegram_provider_keeps_the_manager_special_case(self) -> None:
        self.telegram_manager.delete_secret.return_value = True
        saved = self.client.put(
            "/api/prisma/admin/credentials/telegram",
            json={"secret": SECRET},
            headers=self.headers,
            environ_overrides=self.environ,
        )
        self.assertEqual(saved.get_json(), {"ok": True, "provider": "telegram", "configured": True})
        self.telegram_manager.set_secret.assert_called_once_with(SECRET)
        self.credentials.set_secret.assert_not_called()
        deleted = self.client.delete(
            "/api/prisma/admin/credentials/telegram",
            headers=self.headers,
            environ_overrides=self.environ,
        )
        self.assertEqual(deleted.status_code, 204)
        self.telegram_manager.delete_secret.assert_called_once_with()
        self.credentials.delete_secret.assert_not_called()

    def test_storage_failures_are_sanitized_and_do_not_leak_secret(self) -> None:
        self.credentials.set_secret.side_effect = CredentialUnavailable("sensitive path and key detail")
        response = self.client.put(
            "/api/prisma/admin/credentials/gemini",
            json={"secret": SECRET},
            headers=self.headers,
            environ_overrides=self.environ,
        )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json(), {"ok": False, "error": "CREDENTIAL_STORAGE_UNAVAILABLE"})
        self.assertNotIn(SECRET, response.get_data(as_text=True))
        self.assertNotIn("sensitive", response.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
