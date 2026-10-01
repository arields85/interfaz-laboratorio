import hashlib
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import Mock

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from leda_runtime.admin_auth import AdminAuthRepository, AdminAuthService, AuthUnavailable
from leda_runtime.admin_http import AdminHttpBoundary
from leda_runtime.local_presentation import JsonFileStore, VoiceEventStore, create_app


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
                "/api/leda/admin/auth/login",
                data=b"null",
                content_type="application/json",
                headers={"Origin": "http://localhost:5173"},
                environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"},
            )
        return client.post(
            "/api/leda/admin/auth/login",
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
            "/api/leda/admin/auth/login",
            json={"username": "admin", "password": PASSWORD},
            headers={"Origin": "http://127.0.0.1:5173"},
            environ_overrides=defaults,
        )

    def test_login_session_reads_and_logout_are_server_authorized_with_stable_csrf(self) -> None:
        client = self.client()
        response = self.login(client)
        payload = response.get_json()
        cookie = client.get_cookie("leda_admin_session", path="/api/leda/admin")

        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(cookie)
        self.assertIn("HttpOnly", response.headers["Set-Cookie"])
        self.assertIn("SameSite=Strict", response.headers["Set-Cookie"])
        self.assertIn("Path=/api/leda/admin", response.headers["Set-Cookie"])
        self.assertNotIn("Domain=", response.headers["Set-Cookie"])
        self.assertNotIn("Secure", response.headers["Set-Cookie"])

        first = client.get("/api/leda/admin/auth/session")
        second = client.get("/api/leda/admin/auth/session")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.get_json()["csrfToken"], payload["csrfToken"])
        self.assertEqual(second.get_json()["csrfToken"], payload["csrfToken"])

        missing = client.post("/api/leda/admin/auth/logout", headers={"Origin": "http://127.0.0.1:5173"})
        self.assertEqual(missing.status_code, 403)
        logout = client.post(
            "/api/leda/admin/auth/logout",
            headers={"Origin": "http://127.0.0.1:5173", "X-CSRF-Token": payload["csrfToken"]},
        )
        self.assertEqual(logout.status_code, 204)
        self.assertEqual(client.get("/api/leda/admin/auth/session").status_code, 401)

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
                    "/api/leda/admin/auth/login",
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
            "/api/leda/admin/auth/login",
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
        service.login.assert_called_once_with(username, password, "127.0.0.1", takeover=False)

    def test_sequential_and_concurrent_style_reads_do_not_invalidate_csrf(self) -> None:
        client = self.client()
        token = self.login(client).get_json()["csrfToken"]
        for _ in range(4):
            self.assertEqual(client.get("/api/leda/admin/auth/session").get_json()["csrfToken"], token)
        self.assertEqual(
            client.post(
                "/api/leda/admin/auth/logout",
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
                    "/api/leda/admin/auth/login",
                    json={"username": "admin", "password": PASSWORD},
                    headers={"Origin": origin},
                    environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": host},
                )
                self.assertEqual(response.status_code, 403)

    def test_configured_https_origin_accepts_only_loopback_proxy_peer_and_sets_secure_cookie(self) -> None:
        client = self.client(public_origin="https://hmi.example.test")
        accepted = client.post(
            "/api/leda/admin/auth/login",
            json={"username": "admin", "password": PASSWORD},
            headers={"Origin": "https://hmi.example.test"},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "127.0.0.1:5057"},
        )
        self.assertEqual(accepted.status_code, 200)
        self.assertIn("Secure", accepted.headers["Set-Cookie"])

        direct_remote = self.client(public_origin="https://hmi.example.test").post(
            "/api/leda/admin/auth/login",
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
        self.assertEqual(client.get("/api/leda/admin/auth/status").get_json(), {"configured": False})
        self.assertEqual(
            client.post(
                "/api/leda/admin/auth/login",
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
        response = corrupt_client.get("/api/leda/admin/auth/status")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "AUTH_STORAGE_UNAVAILABLE")
        self.assertNotIn(str(corrupt), response.get_data(as_text=True))

    def login_with(self, client, **payload):
        return client.post(
            "/api/leda/admin/auth/login",
            json={"username": "admin", "password": PASSWORD, **payload},
            headers={"Origin": "http://127.0.0.1:5173"},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"},
        )

    def test_second_login_without_takeover_gets_409_and_no_cookie(self) -> None:
        first = self.client()
        self.login(first)
        second = self.client()

        response = self.login_with(second)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json(), {"ok": False, "error": "ADMIN_SESSION_ACTIVE_ELSEWHERE"})
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertNotIn("Set-Cookie", response.headers)
        self.assertEqual(first.get("/api/leda/admin/auth/session").status_code, 200)

    def test_wrong_password_returns_401_even_when_a_session_is_active(self) -> None:
        self.login(self.client())

        response = self.login_with(self.client(), password="wrong but sufficiently long password")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "INVALID_CREDENTIALS")

    def test_takeover_displaces_the_other_browser_with_a_distinct_code(self) -> None:
        first = self.client()
        old_token = self.login(first).get_json()["csrfToken"]
        second = self.client()

        response = self.login_with(second, takeover=True)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(second.get("/api/leda/admin/auth/session").status_code, 200)
        stale_cookie = first.get_cookie("leda_admin_session", path="/api/leda/admin").value

        def displaced_browser():
            browser = self.client()
            browser.set_cookie("leda_admin_session", stale_cookie)
            return browser

        displaced = displaced_browser().get("/api/leda/admin/auth/session")
        self.assertEqual(displaced.status_code, 401)
        self.assertEqual(displaced.get_json(), {"ok": False, "error": "ADMIN_SESSION_REPLACED"})
        protected = displaced_browser().get("/api/leda/admin/credentials")
        self.assertEqual(protected.status_code, 401)
        self.assertEqual(protected.get_json()["error"], "ADMIN_SESSION_REPLACED")
        write = displaced_browser().put(
            "/api/leda/admin/hmi-config",
            json={"set": {}, "delete": []},
            headers={"Origin": "http://127.0.0.1:5173", "X-CSRF-Token": old_token},
            environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"},
        )
        self.assertEqual(write.status_code, 401)
        self.assertEqual(write.get_json()["error"], "ADMIN_SESSION_REPLACED")

    def test_the_replaced_response_expires_the_session_cookie_so_it_is_reported_once(self) -> None:
        first = self.client()
        self.login(first)
        self.login_with(self.client(), takeover=True)

        displaced = first.get("/api/leda/admin/auth/session")

        self.assertEqual(displaced.get_json()["error"], "ADMIN_SESSION_REPLACED")
        cookie = displaced.headers["Set-Cookie"]
        self.assertIn("leda_admin_session=;", cookie)
        self.assertIn("Expires=Thu, 01 Jan 1970", cookie)
        self.assertIn("Path=/api/leda/admin", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        self.assertEqual(first.get("/api/leda/admin/auth/session").get_json()["error"], "AUTHENTICATION_REQUIRED")

    def test_a_forged_cookie_gets_the_generic_401_without_any_replaced_marker_write(self) -> None:
        client = self.client()
        client.set_cookie("leda_admin_session", "forged")

        response = client.get("/api/leda/admin/auth/session")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "AUTHENTICATION_REQUIRED")
        self.assertNotIn("Set-Cookie", response.headers)
        with closing(sqlite3.connect(self.database)) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM replaced_sessions").fetchone()[0], 0)

    def test_a_failing_replaced_lookup_falls_back_to_the_generic_401_never_503(self) -> None:
        service = Mock()
        service.read_session.return_value = None
        service.was_session_replaced.side_effect = AuthUnavailable("AUTH_STORAGE_UNAVAILABLE")
        client = self.client_for_service(service)
        client.set_cookie("leda_admin_session", "stale")

        response = client.get("/api/leda/admin/auth/session")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "AUTHENTICATION_REQUIRED")

    def test_plain_expiry_and_anonymous_requests_keep_the_generic_401(self) -> None:
        self.assertEqual(self.client().get("/api/leda/admin/auth/session").get_json()["error"], "AUTHENTICATION_REQUIRED")
        client = self.client()
        self.login(client)
        self.clock[0] += 16 * 60

        self.assertEqual(client.get("/api/leda/admin/auth/session").get_json()["error"], "AUTHENTICATION_REQUIRED")

    def test_takeover_flag_must_be_a_boolean(self) -> None:
        for value in ("yes", 1, None, []):
            with self.subTest(value=value):
                self.assert_invalid_login_request(self.login_with(self.client(), takeover=value), "yes")

    def test_login_boundary_forwards_the_takeover_flag(self) -> None:
        service = Mock()
        service.login.return_value = None
        client = self.client_for_service(service)

        self.login_with(client, takeover=True)

        service.login.assert_called_once_with("admin", PASSWORD, "127.0.0.1", takeover=True)

    def test_generic_failures_and_rate_limit_do_not_reveal_account_existence(self) -> None:
        client = self.client()
        results = []
        for username in ("missing", "admin"):
            response = client.post(
                "/api/leda/admin/auth/login",
                json={"username": username, "password": "wrong but sufficiently long password"},
                headers={"Origin": "http://127.0.0.1:5173"},
                environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "127.0.0.1:5057"},
            )
            results.append((response.status_code, response.get_json()))
        self.assertEqual(results[0], results[1])
        self.assertEqual(results[0][1]["error"], "INVALID_CREDENTIALS")

    PASSWORD_ROUTE = "/api/leda/admin/auth/password"
    NEW_PASSWORD = "a different durable passphrase"

    def change_password(self, client, token, *, json=None, headers=None, **environ):
        defaults = {"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"}
        defaults.update(environ)
        request_headers = {"Origin": "http://127.0.0.1:5173"}
        if token is not None:
            request_headers["X-CSRF-Token"] = token
        request_headers.update(headers or {})
        payload = {"currentPassword": PASSWORD, "newPassword": self.NEW_PASSWORD} if json is None else json
        return client.post(self.PASSWORD_ROUTE, json=payload, headers=request_headers, environ_overrides=defaults)

    def add_other_session(self, name="other-session") -> str:
        with closing(sqlite3.connect(self.database)) as connection, connection:
            connection.execute(
                "INSERT INTO admin_sessions VALUES (?, 'csrf', 'admin', 1010.0, 1010.0, 2000.0)",
                (hashlib.sha256(name.encode()).hexdigest(),),
            )
        return name

    def test_password_change_stores_the_new_password_and_keeps_the_caller_signed_in(self) -> None:
        client = self.client()
        token = self.login(client).get_json()["csrfToken"]
        other = self.add_other_session()

        response = self.change_password(client, token)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"ok": True})
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertNotIn("Set-Cookie", response.headers)
        self.assertEqual(client.get("/api/leda/admin/auth/session").get_json()["csrfToken"], token)
        self.assertIsNone(self.service.read_session(other))
        self.assertFalse(self.service.was_session_replaced(other))
        self.assertEqual(self.login_with(self.client(), password=PASSWORD, takeover=True).status_code, 401)
        self.assertEqual(self.login_with(self.client(), password=self.NEW_PASSWORD, takeover=True).status_code, 200)

    def test_password_change_never_echoes_either_password(self) -> None:
        client = self.client()
        token = self.login(client).get_json()["csrfToken"]

        for payload in (
            {"currentPassword": "wrong but sufficiently long password", "newPassword": self.NEW_PASSWORD},
            {"currentPassword": PASSWORD, "newPassword": "short"},
        ):
            body = self.change_password(client, token, json=payload).get_data(as_text=True)
            for secret in (payload["currentPassword"], payload["newPassword"]):
                self.assertNotIn(secret, body)

    def test_wrong_current_password_is_a_distinct_401_and_counts_toward_the_login_budget(self) -> None:
        client = self.client()
        token = self.login(client).get_json()["csrfToken"]
        wrong = {"currentPassword": "wrong but sufficiently long password", "newPassword": self.NEW_PASSWORD}

        response = self.change_password(client, token, json=wrong)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json(), {"ok": False, "error": "INVALID_CURRENT_PASSWORD"})
        self.assertEqual(self.repository.count_failure_rows(), 1)
        self.assertEqual(client.get("/api/leda/admin/auth/session").status_code, 200)

        for _ in range(4):
            self.change_password(client, token, json=wrong)
        limited = self.change_password(client, token)

        self.assertEqual(limited.status_code, 429)
        self.assertEqual(limited.get_json()["error"], "LOGIN_RATE_LIMITED")
        self.assertEqual(self.login_with(self.client(), takeover=True).status_code, 429)

    def test_a_policy_violation_is_a_400_that_counts_nothing(self) -> None:
        client = self.client()
        token = self.login(client).get_json()["csrfToken"]

        for new_password in ("too short", "x" * 1025):
            with self.subTest(length=len(new_password)):
                response = self.change_password(
                    client, token, json={"currentPassword": PASSWORD, "newPassword": new_password}
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json(), {"ok": False, "error": "PASSWORD_POLICY_REJECTED"})
        same = self.change_password(client, token, json={"currentPassword": PASSWORD, "newPassword": PASSWORD})
        self.assertEqual(same.status_code, 400)
        self.assertEqual(same.get_json()["error"], "PASSWORD_UNCHANGED")
        self.assertEqual(self.repository.count_failure_rows(), 0)

    def test_password_change_requires_a_session_and_a_csrf_token(self) -> None:
        anonymous = self.change_password(self.client(), "irrelevant")
        self.assertEqual(anonymous.status_code, 401)
        self.assertEqual(anonymous.get_json()["error"], "AUTHENTICATION_REQUIRED")

        client = self.client()
        token = self.login(client).get_json()["csrfToken"]
        for supplied in (None, "forged-token"):
            with self.subTest(token=supplied):
                response = self.change_password(client, supplied)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.get_json()["error"], "CSRF_VALIDATION_FAILED")
        self.assertEqual(self.login_with(self.client(), takeover=True).status_code, 200)
        self.assertIsNotNone(token)

    def test_password_change_enforces_origin_and_host_checks(self) -> None:
        client = self.client()
        token = self.login(client).get_json()["csrfToken"]

        for headers, environ in (
            ({"Origin": "http://evil.test"}, {}),
            ({}, {"HTTP_HOST": "evil.test"}),
            ({}, {"REMOTE_ADDR": "203.0.113.8"}),
        ):
            with self.subTest(headers=headers, environ=environ):
                response = self.change_password(client, token, headers=headers, **environ)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.get_json()["error"], "AUTH_TRANSPORT_REJECTED")

    def test_password_change_rejects_malformed_bodies_before_any_attempt_is_counted(self) -> None:
        client = self.client()
        token = self.login(client).get_json()["csrfToken"]
        headers = {"Origin": "http://127.0.0.1:5173", "X-CSRF-Token": token}
        environ = {"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"}

        for payload in (
            None,
            [],
            {},
            {"currentPassword": PASSWORD},
            {"currentPassword": PASSWORD, "newPassword": 7},
            {"currentPassword": None, "newPassword": self.NEW_PASSWORD},
            {"currentPassword": PASSWORD, "newPassword": self.NEW_PASSWORD, "extra": "x"},
        ):
            with self.subTest(payload=payload):
                response = client.post(
                    self.PASSWORD_ROUTE,
                    data=b"null" if payload is None else None,
                    json=payload if payload is not None else None,
                    content_type="application/json",
                    headers=headers,
                    environ_overrides=environ,
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json(), {"ok": False, "error": "INVALID_PASSWORD_CHANGE_REQUEST"})
        not_json = client.post(
            self.PASSWORD_ROUTE, data=b"x", content_type="text/plain", headers=headers, environ_overrides=environ
        )
        self.assertEqual(not_json.status_code, 415)
        oversized = client.post(
            self.PASSWORD_ROUTE,
            json={"currentPassword": "x" * 20000, "newPassword": self.NEW_PASSWORD},
            headers=headers,
            environ_overrides=environ,
        )
        self.assertEqual(oversized.status_code, 413)
        self.assertEqual(self.repository.count_failure_rows(), 0)

    def test_password_change_is_atomic_when_the_store_refuses_the_write(self) -> None:
        client = self.client()
        token = self.login(client).get_json()["csrfToken"]
        other = self.add_other_session()
        with closing(sqlite3.connect(self.database)) as connection:
            connection.executescript(
                "CREATE TRIGGER refuse_update BEFORE UPDATE ON administrator "
                "BEGIN SELECT RAISE(ABORT, 'refused'); END;"
            )

        response = self.change_password(client, token)

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "AUTH_STORAGE_UNAVAILABLE")
        self.assertIsNotNone(self.service.read_session(other))
        self.assertEqual(client.get("/api/leda/admin/auth/session").status_code, 200)
        self.assertEqual(self.login_with(self.client(), takeover=True).status_code, 200)


if __name__ == "__main__":
    unittest.main()
