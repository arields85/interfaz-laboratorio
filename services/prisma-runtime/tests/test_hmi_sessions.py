import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.local_presentation import JsonFileStore, create_app
from prisma_runtime.hmi_sessions import HmiSessionCapacity, HmiSessionContextTooLarge, HmiSessionRegistry, HmiSessionUnauthorized


class SessionRegistryTests(unittest.TestCase):
    def test_capacity_rejects_without_evicting_a_live_session_and_expiry_releases_it(self):
        now = [10.0]
        registry = HmiSessionRegistry(
            clock=lambda: now[0],
            entropy=lambda size: bytes([len(registry._sessions) + 1]) * size,
            owner_factory=lambda: "00000000-0000-4000-8000-000000000001",
            max_sessions=1,
            idle_ttl=5,
        )
        capability, _metadata = registry.create()
        with self.assertRaises(HmiSessionCapacity):
            registry.create()
        self.assertEqual(registry.authorize(capability), "00000000-0000-4000-8000-000000000001")
        now[0] = 16.0
        with self.assertRaises(HmiSessionUnauthorized):
            registry.authorize(capability)

    def test_capability_is_digest_only_and_malformed_values_are_rejected(self):
        registry = HmiSessionRegistry(
            entropy=lambda size: b"A" * size,
            owner_factory=lambda: "00000000-0000-4000-8000-000000000002",
        )
        capability, _metadata = registry.create()
        self.assertNotIn(capability, repr(registry._sessions))
        for invalid in ("", "é" * 43, "a" * 44, "?" * 43):
            with self.subTest(invalid=invalid):
                with self.assertRaises(HmiSessionUnauthorized):
                    registry.authorize(invalid)

    def test_context_limit_is_measured_as_encoded_json_bytes(self):
        registry = HmiSessionRegistry(
            entropy=lambda size: b"B" * size,
            owner_factory=lambda: "00000000-0000-4000-8000-000000000003",
            max_context_bytes=10,
        )
        capability, _metadata = registry.create()
        with self.assertRaises(HmiSessionContextTooLarge):
            registry.set_context(capability, {"value": "éé"})


class HmiSessionHttpRedTests(unittest.TestCase):
    @staticmethod
    def make_client(temporary, *, session_registry=None, voice_events=None):
        return create_app(
            snapshot_store=JsonFileStore(Path(temporary) / "snapshot.json"),
            voice_events=voice_events,
            telegram_configuration=type("Config", (), {
                "enabled": False,
                "configured": False,
                "configuration_error": None,
            })(),
            admin_http=type("Admin", (), {"register": lambda _self, _app: None})(),
            session_registry=session_registry,
        ).test_client()

    def test_bootstrap_exists_and_unscoped_snapshot_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            app = create_app(
                snapshot_store=JsonFileStore(root / "snapshot.json"),
                telegram_configuration=type("Config", (), {
                    "enabled": False,
                    "configured": False,
                    "configuration_error": None,
                })(),
                admin_http=type("Admin", (), {"register": lambda _self, _app: None})(),
            )
            client = app.test_client()

            bootstrap = client.post("/hmi/session", json={})
            self.assertEqual(bootstrap.status_code, 201)
            self.assertIn("X-Prisma-Session-Capability", bootstrap.headers)
            self.assertNotIn("ownerId", bootstrap.get_json())
            self.assertEqual(bootstrap.headers["Cache-Control"], "no-store")

            unauthorized = client.post("/hmi/current-snapshot", json={"widgets": []})
            self.assertEqual(unauthorized.status_code, 401)
            self.assertEqual(unauthorized.get_json(), {"ok": False, "error": "PRISMA_SESSION_REQUIRED"})

    def test_bootstrap_enforces_actual_wire_bound_before_allocation(self):
        registry = Mock()
        with tempfile.TemporaryDirectory() as temporary:
            client = self.make_client(temporary, session_registry=registry)
            response = client.post(
                "/hmi/session",
                data=(b" " * 127) + b"{}",
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        registry.create.assert_not_called()

    def test_bootstrap_accepts_only_an_exact_empty_json_object(self):
        invalid_bodies = (b"null", b"[]", b'"value"', b'{"ownerId":"caller"}', b"{")
        with tempfile.TemporaryDirectory() as temporary:
            client = self.make_client(temporary)
            for body in invalid_bodies:
                with self.subTest(body=body):
                    response = client.post("/hmi/session", data=body, content_type="application/json")
                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_close_requires_an_empty_body_and_returns_bodyless_204(self):
        with tempfile.TemporaryDirectory() as temporary:
            client = self.make_client(temporary)
            capability = client.post("/hmi/session", json={}).headers["X-Prisma-Session-Capability"]
            headers = {"X-Prisma-Session-Capability": capability}

            rejected = client.delete("/hmi/session", data=b"{}", content_type="application/json", headers=headers)
            self.assertEqual(rejected.status_code, 400)
            self.assertEqual(client.get("/hmi/voice/latest", headers=headers).status_code, 204)

            closed = client.delete("/hmi/session", headers=headers)
            self.assertEqual(closed.status_code, 204)
            self.assertEqual(closed.data, b"")
            self.assertEqual(closed.headers["Cache-Control"], "no-store")

    def test_close_with_bad_authority_is_controlled_401_even_with_no_body(self):
        with tempfile.TemporaryDirectory() as temporary:
            response = self.make_client(temporary).delete(
                "/hmi/session",
                headers={"X-Prisma-Session-Capability": "invalid"},
            )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json(), {"ok": False, "error": "PRISMA_SESSION_REQUIRED"})
        self.assertEqual(response.headers["Cache-Control"], "no-store")


if __name__ == "__main__":
    unittest.main()
