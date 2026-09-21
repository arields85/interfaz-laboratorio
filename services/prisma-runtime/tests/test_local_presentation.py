import json
import os
import sys
import tempfile
import threading
import uuid
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.local_presentation import JsonFileStore, VoiceEventStore, answer_from_snapshot, create_app
from prisma_runtime.voice_events import VoiceEventCapacity
from prisma_runtime.hmi_sessions import HmiSessionRegistry


# Explicitly inert collaborators for these HTTP fixtures, never runtime defaults.
DISABLED_HTTP_OPTIONS = {
    "telegram_configuration": type("Config", (), {
        "enabled": False, "configured": False, "configuration_error": None,
    })(),
    "admin_http": type("Admin", (), {"register": lambda _self, _app: None})(),
}


def demo_snapshot():
    return {"timestamp": "2026-08-26T12:00:00Z", "screen": {"ownerNodeName": "Fette2000"}, "machine": {"machineId": 10, "name": "FT2000"}, "widgets": [{"id": "lote", "title": "Lote: BT-2407", "type": "text-title", "value": "Lote: BT-2407"}, {"id": "producto_receta", "title": "Producto/receta", "type": "info-card", "data": {"fields": [{"id": "field-1", "label": "ORDEN: OP-45821", "text": "Paracetamol 500 mg", "subtext": "ORDEN: OP-45821", "tag": "Cliente: FarmaSalud"}], "valuesByFieldId": {"field-1": "Paracetamol 500 mg"}}}, {"id": "progreso", "title": "Progreso Lote", "type": "kpi", "value": 65, "unit": "%"}, {"id": "oee", "title": "OEE", "type": "metric-card", "value": 88.6, "unit": "%"}]}


def session_headers(client):
    return {"X-Prisma-Session-Capability": client.post("/hmi/session", json={}).headers["X-Prisma-Session-Capability"]}


class LocalPresentationTests(unittest.TestCase):
    def test_answers_use_only_visible_snapshot_data(self) -> None:
        snapshot = demo_snapshot()
        self.assertEqual(answer_from_snapshot(snapshot, "¿Cuál es el OEE?").answer_text, "El OEE actual es 88,6 %.")
        self.assertEqual(answer_from_snapshot(snapshot, "¿Qué lote está activo?").answer_text, "El lote activo es BT-2407.")
        self.assertEqual(answer_from_snapshot(snapshot, "¿Cuál es la presión hidráulica?").answer_text, "Ese dato no está visible en el dashboard actual.")

    def test_local_api_preserves_snapshot_and_voice_event_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            store = JsonFileStore(Path(temporary) / "snapshot.json")
            events = VoiceEventStore()
            client = create_app(store, events, None, **DISABLED_HTTP_OPTIONS).test_client()
            headers = session_headers(client)
            self.assertEqual(client.post("/hmi/current-snapshot", json={"version": 1, "command": "publish", "order": 1, "snapshot": demo_snapshot()}, headers=headers).status_code, 202)
            self.assertEqual(client.get("/hmi/current-snapshot", headers=headers).get_json()["machine"]["name"], "FT2000")
            response = client.post("/local/ask", json={"question": "¿Cuál es el OEE?"}, headers=headers)
            self.assertEqual(response.status_code, 200)
            event = response.get_json()["voiceEvent"]
            uuid.UUID(event["id"])
            self.assertNotIn("telegramChatId", event)
            self.assertEqual(client.get(f"/internal/prisma/voice-events/{event['id']}", headers=headers).get_json()["text"], "El OEE actual es 88,6 %.")

    def test_local_ask_rejects_caller_supplied_telegram_recipient(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            client = create_app(JsonFileStore(Path(temporary) / "snapshot.json"), VoiceEventStore(), None, **DISABLED_HTTP_OPTIONS).test_client()
            response = client.post("/local/ask", json={"question": "status", "telegramChatId": 12345}, headers=session_headers(client))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "TELEGRAM_RECIPIENT_NOT_ALLOWED")

    def test_local_ask_requires_exact_string_question_contract(self) -> None:
        invalid_bodies = (
            b"null",
            b"[]",
            b'{"question":123}',
            b'{"question":"status","ownerId":"caller"}',
            b'{"question":""}',
            b'{"question":"   "}',
            b'{"question":"\\ud800"}',
            b"{",
        )
        with tempfile.TemporaryDirectory() as temporary:
            client = create_app(JsonFileStore(Path(temporary) / "snapshot.json"), VoiceEventStore(), None, **DISABLED_HTTP_OPTIONS).test_client()
            headers = session_headers(client)
            for body in invalid_bodies:
                with self.subTest(body=body):
                    response = client.post("/local/ask", data=body, content_type="application/json", headers=headers)
                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_local_ask_enforces_utf8_question_and_wire_bounds(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            client = create_app(JsonFileStore(Path(temporary) / "snapshot.json"), VoiceEventStore(), None, **DISABLED_HTTP_OPTIONS).test_client()
            headers = session_headers(client)
            max_unicode = "😀" * 1024
            accepted = client.post(
                "/local/ask",
                data=json.dumps({"question": max_unicode}, ensure_ascii=False).encode("utf-8"),
                content_type="application/json",
                headers=headers,
            )
            oversized_question = client.post("/local/ask", json={"question": "x" * 4097}, headers=headers)
            oversized_wire = client.post(
                "/local/ask",
                data=json.dumps({"question": "ok", "padding": "x" * (32 * 1024)}).encode("utf-8"),
                content_type="application/json",
                headers=headers,
            )

        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(oversized_question.status_code, 400)
        self.assertEqual(oversized_wire.status_code, 400)

    def test_registry_is_unique_thread_safe_deep_copied_and_expiring(self) -> None:
        now = [10.0]
        events = VoiceEventStore(clock=lambda: now[0], ttl_seconds=5)
        published = []
        threads = [threading.Thread(target=lambda: published.append(events.publish("q", "a", None))) for _ in range(20)]
        for thread in threads: thread.start()
        for thread in threads: thread.join(1)
        self.assertEqual(len({event["id"] for event in published}), 20)
        event = published[-1]
        event["text"] = "mutated"
        self.assertEqual(events.get(event["id"])["text"], "a")
        now[0] = 16.0
        self.assertIsNone(events.get(event["id"]))

    def test_registry_retains_only_64_events_and_bot_producer_may_attach_recipient(self) -> None:
        events = VoiceEventStore(clock=lambda: 10.0)
        published = [events.publish("q", str(index), None) for index in range(65)]
        self.assertIsNone(events.get(published[0]["id"]))
        paired = events.publish("q", "paired", -100123, paired_bot_producer=True)
        self.assertEqual(paired["telegramChatId"], -100123)
        untrusted = events.publish("q", "untrusted", -100123)
        self.assertNotIn("telegramChatId", untrusted)

    def test_registry_rejects_aggregate_capacity_without_evicting_another_owner(self) -> None:
        events = VoiceEventStore(clock=lambda: 10.0, max_events=2, max_total_events=2)
        first = events.publish("q", "a", owner_id="owner-a")
        events.publish("q", "b", owner_id="owner-b")

        with self.assertRaises(VoiceEventCapacity):
            events.publish("q", "c", owner_id="owner-c")

        self.assertEqual(events.get(first["id"], "owner-a")["text"], "a")

    def test_invalid_snapshot_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            client = create_app(JsonFileStore(Path(temporary) / "snapshot.json"), VoiceEventStore(), None, **DISABLED_HTTP_OPTIONS).test_client()
            response = client.post("/hmi/current-snapshot", json={
                "version": 1, "command": "publish", "order": 1,
                "snapshot": {"widgets": "invalid"},
            }, headers=session_headers(client))
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.get_json()["error"], "INVALID_SNAPSHOT")


class LocalAskRevisionTests(unittest.TestCase):
    def setUp(self):
        dispatch_patch = patch("requests.Session.request", side_effect=AssertionError("offline HTTP only"))
        dispatch = dispatch_patch.start()
        self.addCleanup(dispatch_patch.stop)
        self.addCleanup(dispatch.assert_not_called)

    def test_local_answer_is_not_published_if_parser_replaces_owner_context(self):
        with tempfile.TemporaryDirectory() as temporary:
            registry = HmiSessionRegistry()
            events = VoiceEventStore()
            client = create_app(
                JsonFileStore(Path(temporary) / "snapshot.json"), events,
                session_registry=registry, **DISABLED_HTTP_OPTIONS,
            ).test_client()
            headers = session_headers(client)
            capability = headers["X-Prisma-Session-Capability"]
            owner = registry.authorize(capability, touch=False)
            registry.set_context(capability, demo_snapshot())
            parsed = []

            def replace_during_parse(snapshot, question):
                parsed.append((snapshot, question))
                answer = answer_from_snapshot(snapshot, question)
                registry.set_context(capability, {"widgets": []})
                return answer

            with patch("prisma_runtime.local_presentation.answer_from_snapshot", replace_during_parse):
                response = client.post("/local/ask", json={"question": "¿Cuál es el OEE?"}, headers=headers)
            self.assertEqual(len(parsed), 1)
            self.assertIsNone(events.latest(owner))
            self.assertNotIn("voiceEvent", response.get_json())


class VoiceProbeTests(unittest.TestCase):
    def _health(self, fake_http: Mock, environment: dict[str, str] | None = None) -> dict:
        with tempfile.TemporaryDirectory() as temporary:
            store = JsonFileStore(Path(temporary) / "snapshot.json")
            test_environment = {"PRISMA_RUNTIME_STATE_DIR": temporary, **(environment or {})}
            with patch.dict(os.environ, test_environment, clear=True), patch.object(
                requests, "Session", return_value=fake_http
            ):
                return create_app(store, VoiceEventStore(), None).test_client().get("/health").get_json()

    def test_default_target_uses_no_proxy_environment_and_reports_success(self) -> None:
        fake_http = Mock()
        fake_http.get.return_value = Mock(status_code=200)
        fake_http.get.return_value.json.return_value = {"ok": True}

        health = self._health(fake_http)

        self.assertFalse(fake_http.trust_env)
        fake_http.get.assert_called_once_with("http://127.0.0.1:5056/health", timeout=1)
        self.assertEqual(
            health["voiceProbe"],
            {
                "target": {"scheme": "http", "host": "127.0.0.1", "port": 5056, "path": "/health"},
                "status": 200,
                "ok": True,
                "error": None,
            },
        )
        self.assertTrue(health["ready"])
        self.assertTrue(health["prismaVoiceReady"])

    def test_configured_target_and_upstream_ok_false_preserve_readiness_gate(self) -> None:
        fake_http = Mock()
        fake_http.get.return_value = Mock(status_code=503)
        fake_http.get.return_value.json.return_value = {"ok": False}

        health = self._health(fake_http, {"PRISMA_LOCAL_VOICE_URL": "http://voice.local:5099"})

        fake_http.get.assert_called_once_with("http://voice.local:5099/health", timeout=1)
        self.assertEqual(health["voiceProbe"]["target"]["host"], "voice.local")
        self.assertEqual(health["voiceProbe"]["target"]["port"], 5099)
        self.assertEqual(health["voiceProbe"]["status"], 503)
        self.assertFalse(health["voiceProbe"]["ok"])
        self.assertEqual(health["voiceProbe"]["error"]["category"], "upstream")
        self.assertEqual(health["voiceProbe"]["error"]["type"], "ok_false")
        self.assertFalse(health["ready"])
        self.assertFalse(health["prismaVoiceReady"])

    def test_malformed_json_is_observable_without_claiming_readiness(self) -> None:
        fake_http = Mock()
        fake_http.get.return_value = Mock(status_code=200)
        fake_http.get.return_value.json.side_effect = ValueError("not json")

        health = self._health(fake_http)
        probe = health["voiceProbe"]

        self.assertEqual(probe["status"], 200)
        self.assertIsNone(probe["ok"])
        self.assertEqual(probe["error"]["category"], "response")
        self.assertEqual(probe["error"]["type"], "malformed_json")
        self.assertFalse(health["ready"])
        self.assertFalse(health["prismaVoiceReady"])

    def test_timeout_and_connection_failures_are_distinguished(self) -> None:
        for exception, error_type in (
            (requests.Timeout("timed out"), "timeout"),
            (requests.ConnectionError("connection failed"), "connection"),
        ):
            with self.subTest(error_type=error_type):
                fake_http = Mock()
                fake_http.get.side_effect = exception

                health = self._health(fake_http)
                probe = health["voiceProbe"]

                self.assertIsNone(probe["status"])
                self.assertIsNone(probe["ok"])
                self.assertEqual(probe["error"]["category"], "request")
                self.assertEqual(probe["error"]["type"], error_type)
                self.assertFalse(health["ready"])
                self.assertFalse(health["prismaVoiceReady"])

    def test_probe_diagnostic_redacts_sensitive_url_parts_and_bounds_messages(self) -> None:
        secret_url = "https://user:secret@example.test:5443/private?token=do-not-leak"
        fake_http = Mock()
        fake_http.get.side_effect = requests.RequestException(
            f"request failed for {secret_url} with {'x' * 1000}"
        )

        health = self._health(fake_http, {"PRISMA_LOCAL_VOICE_URL": secret_url})
        serialized = json.dumps(health["voiceProbe"])
        probe = health["voiceProbe"]

        self.assertNotIn("user", serialized)
        self.assertNotIn("secret", serialized)
        self.assertNotIn("token", serialized)
        self.assertNotIn("do-not-leak", serialized)
        self.assertNotIn("?", serialized)
        self.assertEqual(probe["target"], {"scheme": "https", "host": "example.test", "port": 5443, "path": "/health"})
        self.assertLessEqual(len(probe["error"]["message"]), 160)
        self.assertLessEqual(len(serialized), 1000)


if __name__ == "__main__":
    unittest.main()
