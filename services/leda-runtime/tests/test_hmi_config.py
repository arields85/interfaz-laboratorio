import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from werkzeug.test import EnvironBuilder, run_wsgi_app

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from leda_runtime import hmi_config_store
from leda_runtime.admin_http import MAX_HMI_CONFIG_REQUEST_BYTES, AdminHttpBoundary
from leda_runtime.hmi_config_store import (
    MAX_DOCUMENT_BYTES,
    MAX_VALUE_BYTES,
    HmiConfigInvalid,
    HmiConfigStore,
    HmiConfigTooLarge,
)
from leda_runtime.local_presentation import JsonFileStore, VoiceEventStore, create_app

READ_ROUTE = "/api/leda/hmi-config"
REVISION_ROUTE = "/api/leda/hmi-config/revision"
WRITE_ROUTE = "/api/leda/admin/hmi-config"


class HmiConfigStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "hmi-config" / "hmi-config.sqlite3"
        self.store = HmiConfigStore(self.path)

    def test_empty_document_has_revision_zero(self) -> None:
        self.assertEqual(self.store.read_document(), (0, {}))
        self.assertEqual(self.store.read_revision(), 0)

    def test_batch_sets_and_deletes_keys_and_bumps_revision_once(self) -> None:
        revision = self.store.apply_batch({"hmi:a": "1", "hmi:b": "2", "hmi:c": "3"}, [])
        self.assertEqual(revision, 1)
        revision = self.store.apply_batch({"hmi:a": "10"}, ["hmi:b"])
        self.assertEqual(revision, 2)
        self.assertEqual(self.store.read_document(), (2, {"hmi:a": "10", "hmi:c": "3"}))

    def test_state_survives_reopening_the_file(self) -> None:
        self.store.apply_batch({"hmi:a": "1"}, [])
        reopened = HmiConfigStore(self.path)
        self.assertEqual(reopened.read_document(), (1, {"hmi:a": "1"}))

    def test_invalid_batches_are_rejected_without_changing_anything(self) -> None:
        self.store.apply_batch({"hmi:a": "1"}, [])
        invalid = (
            ({}, []),
            ({"": "x"}, []),
            ({"bad key": "x"}, []),
            ({"k" * 129: "x"}, []),
            ({"hmi:a": 1}, []),
            ({"hmi:a": "x"}, ["hmi:a"]),
            ({}, ["bad key"]),
            ({"hmi:%d" % index: "x" for index in range(201)}, []),
        )
        for sets, deletes in invalid:
            with self.subTest(sets=len(sets), deletes=deletes):
                with self.assertRaises(HmiConfigInvalid):
                    self.store.apply_batch(sets, deletes)
        with self.assertRaises(HmiConfigTooLarge):
            self.store.apply_batch({"hmi:big": "x" * (MAX_VALUE_BYTES + 1)}, [])
        self.assertEqual(self.store.read_document(), (1, {"hmi:a": "1"}))

    def test_total_document_size_is_bounded(self) -> None:
        chunk = "x" * MAX_VALUE_BYTES
        for index in range(MAX_DOCUMENT_BYTES // MAX_VALUE_BYTES):
            self.store.apply_batch({"hmi:chunk%d" % index: chunk}, [])
        revision = self.store.read_revision()
        with self.assertRaises(HmiConfigTooLarge):
            self.store.apply_batch({"hmi:overflow": "x"}, [])
        self.assertEqual(self.store.read_revision(), revision)

    def test_bounds_are_coherent(self) -> None:
        self.assertEqual(MAX_VALUE_BYTES, 4 * 1024 * 1024)
        self.assertEqual(MAX_DOCUMENT_BYTES, 32 * 1024 * 1024)
        self.assertGreaterEqual(MAX_HMI_CONFIG_REQUEST_BYTES, 4 * MAX_VALUE_BYTES)
        self.assertGreaterEqual(MAX_DOCUMENT_BYTES, 2 * MAX_HMI_CONFIG_REQUEST_BYTES)
        self.store.apply_batch({"hmi:max": "x" * MAX_VALUE_BYTES}, [])

    def test_reads_do_not_take_the_write_lock_once_initialized(self) -> None:
        self.store.apply_batch({"hmi:a": "1"}, [])
        locker = sqlite3.connect(self.path, isolation_level=None)
        self.addCleanup(locker.close)
        locker.execute("BEGIN IMMEDIATE")
        self.addCleanup(lambda: locker.execute("ROLLBACK"))
        with patch.object(hmi_config_store, "BUSY_TIMEOUT_SECONDS", 0.05):
            self.assertEqual(self.store.read_revision(), 1)
            self.assertEqual(self.store.read_document(), (1, {"hmi:a": "1"}))


class HmiConfigHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.auth = Mock()
        self.session = SimpleNamespace(csrf_token="csrf-token", username="admin")
        self.auth.read_session.return_value = self.session
        self.store = HmiConfigStore(self.root / "hmi-config.sqlite3")
        boundary = AdminHttpBoundary(self.auth, hmi_config_store=self.store)
        self.client = create_app(
            JsonFileStore(self.root / "snapshot.json"), VoiceEventStore(), None, admin_http=boundary
        ).test_client()
        self.client.set_cookie("leda_admin_session", "session-id", path="/api/leda/admin")
        self.environ = {"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"}
        self.headers = {"Origin": "http://localhost:5173", "X-CSRF-Token": "csrf-token"}

    def write(self, payload, **overrides):
        return self.client.put(
            WRITE_ROUTE,
            json=payload,
            headers=overrides.pop("headers", self.headers),
            environ_overrides=self.environ,
        )

    def read(self, route=READ_ROUTE):
        return self.client.get(route, environ_overrides=self.environ)

    def test_empty_document_is_public_and_not_cacheable(self) -> None:
        self.auth.read_session.return_value = None
        self.auth.was_session_replaced.return_value = False
        response = self.read()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"ok": True, "revision": 0, "items": {}})
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_revision_endpoint_returns_only_the_revision(self) -> None:
        self.write({"set": {"hmi:a": "1"}})
        response = self.read(REVISION_ROUTE)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"ok": True, "revision": 1})
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_write_requires_a_session(self) -> None:
        self.auth.read_session.return_value = None
        self.auth.was_session_replaced.return_value = False
        response = self.write({"set": {"hmi:a": "1"}})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "AUTHENTICATION_REQUIRED")
        self.assertEqual(self.store.read_revision(), 0)

    def test_write_requires_matching_csrf_and_origin(self) -> None:
        for token in (None, "wrong", "é"):
            with self.subTest(token=token):
                headers = {"Origin": "http://localhost:5173"}
                if token is not None:
                    headers["X-CSRF-Token"] = token
                response = self.write({"set": {"hmi:a": "1"}}, headers=headers)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.get_json()["error"], "CSRF_VALIDATION_FAILED")
        no_origin = self.write({"set": {"hmi:a": "1"}}, headers={"X-CSRF-Token": "csrf-token"})
        self.assertEqual(no_origin.status_code, 403)
        self.assertEqual(no_origin.get_json()["error"], "AUTH_TRANSPORT_REJECTED")
        self.assertEqual(self.store.read_revision(), 0)

    def test_session_cookie_scope_covers_the_write_route_but_not_the_public_reads(self) -> None:
        self.assertTrue(WRITE_ROUTE.startswith("/api/leda/admin/"))
        self.assertFalse(READ_ROUTE.startswith("/api/leda/admin"))

    def test_successful_batch_bumps_revision_once_and_is_readable(self) -> None:
        response = self.write({"set": {"hmi:a": "1", "hmi:b": "2"}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"ok": True, "revision": 1})
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(
            self.read().get_json(), {"ok": True, "revision": 1, "items": {"hmi:a": "1", "hmi:b": "2"}}
        )

    def test_delete_removes_keys(self) -> None:
        self.write({"set": {"hmi:a": "1", "hmi:b": "2"}})
        response = self.write({"delete": ["hmi:a"]})
        self.assertEqual(response.get_json(), {"ok": True, "revision": 2})
        self.assertEqual(self.read().get_json()["items"], {"hmi:b": "2"})

    def test_validation_errors_use_stable_codes(self) -> None:
        cases = (
            ({}, 400, "HMI_CONFIG_INVALID_REQUEST"),
            ({"set": {"bad key": "x"}}, 400, "HMI_CONFIG_INVALID_REQUEST"),
            ({"set": {"hmi:a": 1}}, 400, "HMI_CONFIG_INVALID_REQUEST"),
            ({"set": {"hmi:a": "x"}, "delete": ["hmi:a"]}, 400, "HMI_CONFIG_INVALID_REQUEST"),
            ({"set": {}, "extra": 1}, 400, "HMI_CONFIG_INVALID_REQUEST"),
            ([], 400, "HMI_CONFIG_INVALID_REQUEST"),
            ({"set": {"hmi:a": "x" * (MAX_VALUE_BYTES + 1)}}, 413, "HMI_CONFIG_VALUE_TOO_LARGE"),
        )
        for payload, status, code in cases:
            with self.subTest(payload=str(payload)[:40]):
                response = self.write(payload)
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.get_json(), {"ok": False, "error": code})
        self.assertEqual(self.store.read_revision(), 0)

    def test_non_json_body_is_rejected(self) -> None:
        response = self.client.put(
            WRITE_ROUTE, data="x", content_type="text/plain", headers=self.headers, environ_overrides=self.environ
        )
        self.assertEqual(response.status_code, 415)
        invalid = self.client.put(
            WRITE_ROUTE, data=b"{", content_type="application/json", headers=self.headers, environ_overrides=self.environ
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.get_json()["error"], "HMI_CONFIG_INVALID_REQUEST")

    def test_request_too_large_is_rejected_with_413(self) -> None:
        oversized = b'{"set":{"hmi:a":"' + b"x" * MAX_HMI_CONFIG_REQUEST_BYTES + b'"}}'
        response = self.client.put(
            WRITE_ROUTE,
            data=oversized,
            content_type="application/json",
            headers=self.headers,
            environ_overrides=self.environ,
        )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.get_json(), {"ok": False, "error": "HMI_CONFIG_REQUEST_TOO_LARGE"})
        self.assertEqual(self.store.read_revision(), 0)

    def test_missing_content_length_is_rejected_with_413(self) -> None:
        builder = EnvironBuilder(
            WRITE_ROUTE,
            method="PUT",
            data=b'{"set":{"hmi:a":"1"}}',
            content_type="application/json",
            headers={**self.headers, "Cookie": "leda_admin_session=session-id"},
            environ_overrides=self.environ,
        )
        environ = builder.get_environ()
        environ.pop("CONTENT_LENGTH", None)
        body, status, _ = run_wsgi_app(self.client.application.wsgi_app, environ)
        self.assertTrue(status.startswith("413"), status)
        self.assertEqual(json.loads(b"".join(body)), {"ok": False, "error": "HMI_CONFIG_REQUEST_TOO_LARGE"})
        self.assertEqual(self.store.read_revision(), 0)

    def test_document_too_large_is_rejected_with_413_and_rolled_back(self) -> None:
        chunk = "x" * MAX_VALUE_BYTES
        for index in range(MAX_DOCUMENT_BYTES // MAX_VALUE_BYTES):
            self.assertEqual(self.write({"set": {"hmi:chunk%d" % index: chunk}}).status_code, 200)
        revision = self.store.read_revision()
        response = self.write({"set": {"hmi:overflow": "x"}})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.get_json(), {"ok": False, "error": "HMI_CONFIG_DOCUMENT_TOO_LARGE"})
        self.assertEqual(self.store.read_revision(), revision)

    def test_unavailable_store_reports_503_on_write_and_reads(self) -> None:
        blocker = self.root / "blocker"
        blocker.write_text("not a directory", encoding="utf-8")
        broken = AdminHttpBoundary(self.auth, hmi_config_store=HmiConfigStore(blocker / "hmi-config.sqlite3"))
        client = create_app(
            JsonFileStore(self.root / "snapshot3.json"), VoiceEventStore(), None, admin_http=broken
        ).test_client()
        client.set_cookie("leda_admin_session", "session-id", path="/api/leda/admin")
        written = client.put(WRITE_ROUTE, json={"set": {"hmi:a": "1"}}, headers=self.headers, environ_overrides=self.environ)
        self.assertEqual(written.status_code, 503)
        self.assertEqual(written.get_json(), {"ok": False, "error": "HMI_CONFIG_UNAVAILABLE"})
        for route in (READ_ROUTE, REVISION_ROUTE):
            self.assertEqual(client.get(route, environ_overrides=self.environ).status_code, 503)

    def test_missing_store_write_reports_unavailable(self) -> None:
        boundary = AdminHttpBoundary(self.auth)
        client = create_app(
            JsonFileStore(self.root / "snapshot4.json"), VoiceEventStore(), None, admin_http=boundary
        ).test_client()
        client.set_cookie("leda_admin_session", "session-id", path="/api/leda/admin")
        response = client.put(WRITE_ROUTE, json={"set": {"hmi:a": "1"}}, headers=self.headers, environ_overrides=self.environ)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "HMI_CONFIG_UNAVAILABLE")

    def test_missing_store_reports_unavailable(self) -> None:
        boundary = AdminHttpBoundary(self.auth)
        client = create_app(
            JsonFileStore(self.root / "snapshot2.json"), VoiceEventStore(), None, admin_http=boundary
        ).test_client()
        response = client.get(READ_ROUTE, environ_overrides=self.environ)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "HMI_CONFIG_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
