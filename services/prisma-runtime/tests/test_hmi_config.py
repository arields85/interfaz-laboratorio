import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.admin_http import AdminHttpBoundary
from prisma_runtime.hmi_config_store import (
    MAX_DOCUMENT_BYTES,
    MAX_VALUE_BYTES,
    HmiConfigInvalid,
    HmiConfigStore,
    HmiConfigTooLarge,
)
from prisma_runtime.local_presentation import JsonFileStore, VoiceEventStore, create_app

READ_ROUTE = "/api/prisma/hmi-config"
REVISION_ROUTE = "/api/prisma/hmi-config/revision"
WRITE_ROUTE = "/api/prisma/admin/hmi-config"


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
        self.client.set_cookie("prisma_admin_session", "session-id", path="/api/prisma/admin")
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
        self.assertTrue(WRITE_ROUTE.startswith("/api/prisma/admin/"))
        self.assertFalse(READ_ROUTE.startswith("/api/prisma/admin"))

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
