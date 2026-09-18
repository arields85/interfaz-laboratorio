import hashlib
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.admin_auth import AdminAuthRepository, AdminAuthService
from prisma_runtime.admin_http import AdminHttpBoundary
from prisma_runtime.local_presentation import JsonFileStore, VoiceEventStore, create_app


PASSWORD = "correct horse battery staple"


class FastPasswordHasher:
    def hash_password(self, password: str) -> dict:
        return {"algorithm": "test", "digest": hashlib.sha256(password.encode()).hexdigest()}

    def verify_password(self, password: str, record: dict) -> bool:
        return record == self.hash_password(password)


class AdminHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.database = self.root / "auth" / "admin.sqlite3"
        self.permissions = Mock()
        self.repository = AdminAuthRepository(self.database, permission_checker=self.permissions.verify)
        self.hasher = FastPasswordHasher()
        self.repository.initialize_for_provisioning()
        self.repository.provision_admin("admin", self.hasher.hash_password(PASSWORD), now=1000.0)
        self.clock = [1010.0]
        self.service = AdminAuthService(self.repository, self.hasher, now=lambda: self.clock[0])

    def client(self, *, public_origin: str | None = None):
        boundary = AdminHttpBoundary(self.service, public_origin=public_origin)
        store = JsonFileStore(self.root / "snapshot.json")
        return create_app(store, VoiceEventStore(), None, admin_http=boundary).test_client()

    def client_for_service(self, service):
        boundary = AdminHttpBoundary(service)
        store = JsonFileStore(self.root / "isolated-snapshot.json")
        return create_app(store, VoiceEventStore(), None, admin_http=boundary).test_client()

    @staticmethod
    def post_login_payload(client, payload):
        if payload is None:
            return client.post(
                "/api/prisma/admin/auth/login",
                data=b"null",
                content_type="application/json",
                headers={"Origin": "http://localhost:5173"},
                environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"},
            )
        return client.post(
            "/api/prisma/admin/auth/login",
            json=payload,
            headers={"Origin": "http://localhost:5173"},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"},
        )

    def assert_invalid_login_request(self, response, marker: str = "credential-marker") -> None:
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.content_type, "application/json")
        self.assertEqual(response.get_json(), {"ok": False, "error": "INVALID_LOGIN_REQUEST"})
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertNotIn("Set-Cookie", response.headers)
        self.assertNotIn(marker, response.get_data(as_text=True))

    def login(self, client, **environ):
        defaults = {"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"}
        defaults.update(environ)
        return client.post(
            "/api/prisma/admin/auth/login",
            json={"username": "admin", "password": PASSWORD},
            headers={"Origin": "http://127.0.0.1:5173"},
            environ_overrides=defaults,
        )

    def test_login_session_reads_and_logout_are_server_authorized_with_stable_csrf(self) -> None:
        client = self.client()
        response = self.login(client)
        payload = response.get_json()
        cookie = client.get_cookie("prisma_admin_session", path="/api/prisma/admin")

        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(cookie)
        self.assertIn("HttpOnly", response.headers["Set-Cookie"])
        self.assertIn("SameSite=Strict", response.headers["Set-Cookie"])
        self.assertIn("Path=/api/prisma/admin", response.headers["Set-Cookie"])
        self.assertNotIn("Domain=", response.headers["Set-Cookie"])
        self.assertNotIn("Secure", response.headers["Set-Cookie"])

        first = client.get("/api/prisma/admin/auth/session")
        second = client.get("/api/prisma/admin/auth/session")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.get_json()["csrfToken"], payload["csrfToken"])
        self.assertEqual(second.get_json()["csrfToken"], payload["csrfToken"])

        missing = client.post("/api/prisma/admin/auth/logout", headers={"Origin": "http://127.0.0.1:5173"})
        self.assertEqual(missing.status_code, 403)
        logout = client.post(
            "/api/prisma/admin/auth/logout",
            headers={"Origin": "http://127.0.0.1:5173", "X-CSRF-Token": payload["csrfToken"]},
        )
        self.assertEqual(logout.status_code, 204)
        self.assertEqual(client.get("/api/prisma/admin/auth/session").status_code, 401)

    def test_login_rejects_non_object_json_and_missing_fields_before_auth(self) -> None:
        service = Mock()
        service.login.return_value = None
        client = self.client_for_service(service)
        invalid_payloads = (
            None,
            False,
            0,
            "credential-marker",
            [],
            [1],
            {},
            {"username": "admin"},
            {"password": "credential-marker"},
        )

        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                self.assert_invalid_login_request(self.post_login_payload(client, payload))

        service.login.assert_not_called()

    def test_login_rejects_wrong_field_types_before_auth(self) -> None:
        service = Mock()
        service.login.return_value = None
        client = self.client_for_service(service)
        invalid_values = (None, False, 0, ["credential-marker"], {"value": "credential-marker"})

        for field in ("username", "password"):
            for invalid_value in invalid_values:
                payload = {"username": "admin", "password": "credential-marker"}
                payload[field] = invalid_value
                with self.subTest(field=field, invalid_value=invalid_value):
                    self.assert_invalid_login_request(self.post_login_payload(client, payload))

        service.login.assert_not_called()

    def test_login_rejects_malformed_json_before_auth(self) -> None:
        service = Mock()
        service.login.return_value = None
        client = self.client_for_service(service)
        for body in (b"", b'{"username": "credential-marker"'):
            with self.subTest(body=body):
                response = client.post(
                    "/api/prisma/admin/auth/login",
                    data=body,
                    content_type="application/json",
                    headers={"Origin": "http://localhost:5173"},
                    environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"},
                )
                self.assert_invalid_login_request(response)
        service.login.assert_not_called()

    def test_login_preserves_unsupported_media_type_rejection_before_auth(self) -> None:
        service = Mock()
        client = self.client_for_service(service)
        response = client.post(
            "/api/prisma/admin/auth/login",
            data=b'{"username":"admin","password":"credential-marker"}',
            content_type="text/plain",
            headers={"Origin": "http://localhost:5173"},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"},
        )

        self.assertEqual(response.status_code, 415)
        self.assertEqual(response.get_json(), {"ok": False, "error": "JSON_REQUIRED"})
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertNotIn("Set-Cookie", response.headers)
        service.login.assert_not_called()

    def test_login_passes_valid_unicode_and_whitespace_strings_unchanged(self) -> None:
        service = Mock()
        service.login.return_value = None
        client = self.client_for_service(service)
        username = "  administratör  "
        password = "  correct horse battery staple  "

        response = self.post_login_payload(client, {"username": username, "password": password})

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "INVALID_CREDENTIALS")
        service.login.assert_called_once_with(username, password, "127.0.0.1")

    def test_sequential_and_concurrent_style_reads_do_not_invalidate_csrf(self) -> None:
        client = self.client()
        token = self.login(client).get_json()["csrfToken"]
        for _ in range(4):
            self.assertEqual(client.get("/api/prisma/admin/auth/session").get_json()["csrfToken"], token)
        self.assertEqual(
            client.post(
                "/api/prisma/admin/auth/logout",
                headers={"Origin": "http://127.0.0.1:5173", "X-CSRF-Token": token},
            ).status_code,
            204,
        )

    def test_remote_peer_cannot_activate_plaintext_development_auth_with_forged_origin_or_forwarded_headers(self) -> None:
        client = self.client()
        response = self.login(
            client,
            REMOTE_ADDR="203.0.113.8",
            HTTP_X_FORWARDED_FOR="127.0.0.1",
            HTTP_X_FORWARDED_PROTO="https",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "AUTH_TRANSPORT_REJECTED")

    def test_exact_origin_and_host_validation_rejects_downgrades_and_lookalikes(self) -> None:
        client = self.client()
        for origin, host in (
            ("http://127.0.0.1:5173.evil.test", "127.0.0.1:5057"),
            ("https://127.0.0.1:5173", "127.0.0.1:5057"),
            ("http://127.0.0.1:5173", "evil.test"),
        ):
            with self.subTest(origin=origin, host=host):
                response = client.post(
                    "/api/prisma/admin/auth/login",
                    json={"username": "admin", "password": PASSWORD},
                    headers={"Origin": origin},
                    environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": host},
                )
                self.assertEqual(response.status_code, 403)

    def test_configured_https_origin_accepts_only_loopback_proxy_peer_and_sets_secure_cookie(self) -> None:
        client = self.client(public_origin="https://hmi.example.test")
        accepted = client.post(
            "/api/prisma/admin/auth/login",
            json={"username": "admin", "password": PASSWORD},
            headers={"Origin": "https://hmi.example.test"},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "127.0.0.1:5057"},
        )
        self.assertEqual(accepted.status_code, 200)
        self.assertIn("Secure", accepted.headers["Set-Cookie"])

        direct_remote = self.client(public_origin="https://hmi.example.test").post(
            "/api/prisma/admin/auth/login",
            json={"username": "admin", "password": PASSWORD},
            headers={"Origin": "https://hmi.example.test"},
            environ_overrides={"REMOTE_ADDR": "203.0.113.8", "HTTP_HOST": "hmi.example.test"},
        )
        self.assertEqual(direct_remote.status_code, 403)

    def test_malformed_public_origin_fails_closed_without_transport_downgrade(self) -> None:
        client = self.client(public_origin="http://hmi.example.test/path")
        response = self.login(client)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "AUTH_CONFIGURATION_INVALID")

    def test_unconfigured_and_corrupt_storage_are_sanitized_while_existing_routes_remain_open(self) -> None:
        unconfigured_path = self.root / "missing" / "admin.sqlite3"
        unconfigured_service = AdminAuthService(
            AdminAuthRepository(unconfigured_path, permission_checker=self.permissions.verify),
            self.hasher,
        )
        store = JsonFileStore(self.root / "other-snapshot.json")
        app = create_app(store, VoiceEventStore(), None, admin_http=AdminHttpBoundary(unconfigured_service))
        client = app.test_client()
        self.assertEqual(client.get("/api/prisma/admin/auth/status").get_json(), {"configured": False})
        self.assertEqual(
            client.post(
                "/api/prisma/admin/auth/login",
                json={"username": "admin", "password": PASSWORD},
                headers={"Origin": "http://127.0.0.1:5173"},
                environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "127.0.0.1:5057"},
            ).status_code,
            503,
        )
        self.assertEqual(client.get("/hmi/voice/latest").status_code, 401)
        self.assertEqual(client.post("/hmi/current-snapshot", json={"widgets": []}).status_code, 401)

        corrupt = self.root / "corrupt" / "admin.sqlite3"
        corrupt.parent.mkdir()
        corrupt.write_text("broken database", encoding="utf-8")
        corrupt_service = AdminAuthService(AdminAuthRepository(corrupt, permission_checker=lambda *_: None), self.hasher)
        corrupt_client = create_app(
            JsonFileStore(self.root / "third-snapshot.json"),
            VoiceEventStore(),
            None,
            admin_http=AdminHttpBoundary(corrupt_service),
        ).test_client()
        response = corrupt_client.get("/api/prisma/admin/auth/status")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "AUTH_STORAGE_UNAVAILABLE")
        self.assertNotIn(str(corrupt), response.get_data(as_text=True))

    def test_generic_failures_and_rate_limit_do_not_reveal_account_existence(self) -> None:
        client = self.client()
        results = []
        for username in ("missing", "admin"):
            response = client.post(
                "/api/prisma/admin/auth/login",
                json={"username": username, "password": "wrong but sufficiently long password"},
                headers={"Origin": "http://127.0.0.1:5173"},
                environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "127.0.0.1:5057"},
            )
            results.append((response.status_code, response.get_json()))
        self.assertEqual(results[0], results[1])
        self.assertEqual(results[0][1]["error"], "INVALID_CREDENTIALS")


if __name__ == "__main__":
    unittest.main()
