import itertools
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.local_presentation import JsonFileStore, create_app
from prisma_runtime.hmi_sessions import (
    HmiSessionCapacity,
    HmiSessionContextStale,
    HmiSessionContextTooLarge,
    HmiSessionContextUnavailable,
    HmiSessionFreshnessInvalid,
    HmiSessionOwnerUnavailable,
    HmiSessionRegistry,
    HmiSessionUnauthorized,
)


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


class OwnerContextFreshnessTests(unittest.TestCase):
    OWNER_FIRST = "00000000-0000-4000-8000-000000000010"
    OWNER_SECOND = "00000000-0000-4000-8000-000000000011"

    @staticmethod
    def make_registry(now, **overrides):
        owners = itertools.count(10)
        sources = itertools.count(1)
        options = {
            "clock": lambda: now[0],
            "entropy": lambda size: bytes([next(sources)]) * size,
            "owner_factory": lambda: f"00000000-0000-4000-8000-{next(owners):012d}",
            "idle_ttl": 30,
            "absolute_ttl": 60,
        }
        options.update(overrides)
        return HmiSessionRegistry(**options)

    def test_owner_context_requires_a_positive_finite_bound(self):
        now = [10.0]
        registry = self.make_registry(now)
        capability, _metadata = registry.create()
        registry.set_context(capability, {"snapshot": {"value": 1}})

        invalid_bounds = (True, False, 0, 0.0, -0.001, float("nan"), float("inf"), -float("inf"), None, "5", [5])
        for invalid in invalid_bounds:
            with self.subTest(bound=invalid):
                with self.assertRaises(HmiSessionFreshnessInvalid):
                    registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=invalid)

        self.assertEqual(registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=0.001), (0.0, {"snapshot": {"value": 1}}))

    def test_owner_context_normalizes_oversized_integer_bounds_to_a_domain_error(self):
        now = [10.0]
        registry = self.make_registry(now)
        capability, _metadata = registry.create()
        registry.set_context(capability, {"snapshot": 1})

        for oversized in (10 ** 1000, -(10 ** 1000)):
            with self.subTest(bound=oversized):
                with self.assertRaises(HmiSessionFreshnessInvalid) as caught:
                    registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=oversized)
                self.assertIsNone(caught.exception.__cause__)
                self.assertIsNone(caught.exception.__context__)

        self.assertEqual(
            registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=10 ** 308),
            (0.0, {"snapshot": 1}),
        )

    def test_absolute_expiry_at_its_exact_boundary_ends_owner_availability_despite_recent_context(self):
        removed = []
        now = [10.0]
        registry = self.make_registry(now, idle_ttl=600, absolute_ttl=10, on_remove=removed.append)
        capability, _metadata = registry.create()
        registry.set_context(capability, {"snapshot": 1})

        now[0] = 19.9
        registry.set_context(capability, {"snapshot": 2})
        age, snapshot = registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=10)
        self.assertEqual((age, snapshot), (0.0, {"snapshot": 2}))
        self.assertEqual(removed, [])

        now[0] = 20.0
        with self.assertRaises(HmiSessionOwnerUnavailable):
            registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=10)
        self.assertEqual(removed, [self.OWNER_FIRST])

    def test_stale_context_can_be_replaced_by_a_fresh_server_receipt(self):
        now = [10.0]
        registry = self.make_registry(now, idle_ttl=600, absolute_ttl=600)
        capability, _metadata = registry.create()
        registry.set_context(capability, {"snapshot": "first"})

        now[0] = 16.0
        with self.assertRaises(HmiSessionContextStale):
            registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=5)

        registry.set_context(capability, {"snapshot": "second"})
        self.assertEqual(
            registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=5),
            (0.0, {"snapshot": "second"}),
        )

    def test_rejected_context_replacement_keeps_previous_content_and_receipt_age(self):
        now = [10.0]
        registry = self.make_registry(now, idle_ttl=600, absolute_ttl=600, max_context_bytes=20)
        capability, _metadata = registry.create()
        registry.set_context(capability, {"ok": 1})

        now[0] = 12.0
        self.assertEqual(registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=5), (2.0, {"ok": 1}))

        with self.assertRaises(HmiSessionContextTooLarge):
            registry.set_context(capability, {"value": "x" * 50})
        with self.assertRaises(HmiSessionUnauthorized):
            registry.set_context("invalid", {})

        self.assertEqual(registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=5), (2.0, {"ok": 1}))

    def test_owner_context_returns_fresh_deep_copied_server_context(self):
        now = [10.0]
        registry = self.make_registry(now)
        capability, _metadata = registry.create()
        source = {"snapshot": {"value": 1}, "widgets": [{"id": "a"}]}
        registry.set_context(capability, source)
        source["snapshot"]["value"] = 99
        source["widgets"][0]["id"] = "caller-mutation"

        now[0] = 12.5
        age, snapshot = registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=2.5)
        self.assertEqual(age, 2.5)
        self.assertEqual(snapshot, {"snapshot": {"value": 1}, "widgets": [{"id": "a"}]})

        snapshot["snapshot"]["value"] = -1
        snapshot["widgets"][0]["id"] = "reader-mutation"
        self.assertEqual(
            registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=2.5),
            (2.5, {"snapshot": {"value": 1}, "widgets": [{"id": "a"}]}),
        )

    def test_owner_context_freshness_ignores_client_supplied_timestamps(self):
        now = [100.0]
        registry = self.make_registry(now)
        capability, _metadata = registry.create()
        registry.set_context(capability, {"clientReceivedAt": 1.0, "timestamp": "1999-01-01T00:00:00Z"})

        age, snapshot = registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=1.0)
        self.assertEqual((age, snapshot), (0.0, {"clientReceivedAt": 1.0, "timestamp": "1999-01-01T00:00:00Z"}))

        now[0] = 101.5
        with self.assertRaises(HmiSessionContextStale):
            registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=1.0)

    def test_owner_context_rejects_stale_reads_at_the_inclusive_bound(self):
        now = [10.0]
        registry = self.make_registry(now, idle_ttl=50, absolute_ttl=100)
        capability, _metadata = registry.create()
        registry.set_context(capability, {"snapshot": 1})

        now[0] = 15.0
        age, snapshot = registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=5)
        self.assertEqual((age, snapshot), (5.0, {"snapshot": 1}))

        now[0] = 15.001
        with self.assertRaises(HmiSessionContextStale):
            registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=5)

    def test_owner_context_rejects_missing_context_without_cross_owner_fallback(self):
        now = [5.0]
        registry = self.make_registry(now)
        registry.create()
        second, _metadata = registry.create()
        registry.set_context(second, {"snapshot": {"value": "second"}})

        with self.assertRaises(HmiSessionContextUnavailable):
            registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=5)
        with self.assertRaises(HmiSessionOwnerUnavailable):
            registry.get_owner_context("00000000-0000-4000-8000-0000000000ff", max_age_seconds=5)

        age, snapshot = registry.get_owner_context(self.OWNER_SECOND, max_age_seconds=5)
        self.assertEqual((age, snapshot), (0.0, {"snapshot": {"value": "second"}}))

    def test_owner_context_rejects_closed_and_expired_owners_and_keeps_removal_callback(self):
        removed = []
        now = [10.0]
        registry = self.make_registry(now, idle_ttl=5, on_remove=removed.append)
        capability, _metadata = registry.create()
        registry.set_context(capability, {"snapshot": 1})

        now[0] = 14.0
        age, snapshot = registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=10)
        self.assertEqual((age, snapshot), (4.0, {"snapshot": 1}))

        now[0] = 16.0
        with self.assertRaises(HmiSessionOwnerUnavailable):
            registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=10)
        self.assertEqual(removed, [self.OWNER_FIRST])

        closed_now = [10.0]
        closed_registry = self.make_registry(closed_now, on_remove=removed.append)
        closed_capability, _metadata = closed_registry.create()
        closed_registry.close(closed_capability)
        with self.assertRaises(HmiSessionOwnerUnavailable):
            closed_registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=10)
        self.assertEqual(removed, [self.OWNER_FIRST, self.OWNER_FIRST])

    def test_owner_context_leaves_capability_and_activity_untouched(self):
        now = [10.0]
        registry = self.make_registry(now, idle_ttl=600)
        capability, _metadata = registry.create()
        registry.set_context(capability, {"snapshot": 1})
        session = next(iter(registry._sessions.values()))

        now[0] = 20.0
        registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=30)
        registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=30)
        self.assertEqual(session.last_seen_at, 10.0)

        age, snapshot = registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=30)
        self.assertEqual((age, snapshot), (10.0, {"snapshot": 1}))
        self.assertEqual(session.last_seen_at, 10.0)
        for representation in (repr((age, snapshot)), repr(session), repr(registry._sessions)):
            self.assertNotIn(capability, representation)
        with self.assertRaises(HmiSessionOwnerUnavailable):
            registry.get_owner_context(capability, max_age_seconds=30)

        registry.get_context(capability)
        self.assertEqual(session.last_seen_at, 20.0)

    def test_failed_context_receipt_does_not_establish_freshness(self):
        now = [10.0]
        registry = self.make_registry(now, max_context_bytes=10)
        capability, _metadata = registry.create()

        with self.assertRaises(HmiSessionContextTooLarge):
            registry.set_context(capability, {"value": "éé"})
        with self.assertRaises(HmiSessionUnauthorized):
            registry.set_context("invalid", {})
        with self.assertRaises(HmiSessionContextUnavailable):
            registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=1000)

        now[0] = 11.0
        registry.set_context(capability, {"ok": 1})
        self.assertEqual(
            registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=1000),
            (0.0, {"ok": 1}),
        )

    def test_owner_context_rejects_backward_and_nonfinite_receipt_ages(self):
        now = [10.0]
        registry = self.make_registry(now, idle_ttl=600)
        capability, _metadata = registry.create()
        registry.set_context(capability, {"snapshot": 1})

        now[0] = 4.0
        with self.assertRaises(HmiSessionFreshnessInvalid):
            registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=600)
        now[0] = float("nan")
        with self.assertRaises(HmiSessionFreshnessInvalid):
            registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=600)
        now[0] = 12.0
        self.assertEqual(
            registry.get_owner_context(self.OWNER_FIRST, max_age_seconds=600),
            (2.0, {"snapshot": 1}),
        )

        skewed_now = [float("inf")]
        skewed = self.make_registry(skewed_now, idle_ttl=600)
        skewed_capability, _metadata = skewed.create()
        skewed.set_context(skewed_capability, {"snapshot": 1})
        skewed_now[0] = 10.0
        with self.assertRaises(HmiSessionFreshnessInvalid):
            skewed.get_owner_context(self.OWNER_FIRST, max_age_seconds=600)


if __name__ == "__main__":
    unittest.main()
