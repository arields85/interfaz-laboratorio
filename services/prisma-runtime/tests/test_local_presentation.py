import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

from prisma_runtime.local_presentation import JsonFileStore, VoiceEventStore, answer_from_snapshot, create_app


def demo_snapshot():
    return {"timestamp": "2026-08-26T12:00:00Z", "screen": {"ownerNodeName": "Fette2000"}, "machine": {"machineId": 10, "name": "FT2000"}, "widgets": [{"id": "lote", "title": "Lote: BT-2407", "type": "text-title", "value": "Lote: BT-2407"}, {"id": "producto_receta", "title": "Producto/receta", "type": "info-card", "data": {"fields": [{"id": "field-1", "label": "ORDEN: OP-45821", "text": "Paracetamol 500 mg", "subtext": "ORDEN: OP-45821", "tag": "Cliente: FarmaSalud"}], "valuesByFieldId": {"field-1": "Paracetamol 500 mg"}}}, {"id": "progreso", "title": "Progreso Lote", "type": "kpi", "value": 65, "unit": "%"}, {"id": "oee", "title": "OEE", "type": "metric-card", "value": 88.6, "unit": "%"}]}


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
            client = create_app(store, events, None).test_client()
            self.assertEqual(client.post("/hmi/current-snapshot", json=demo_snapshot()).status_code, 202)
            self.assertEqual(client.get("/hmi/current-snapshot").get_json()["machine"]["name"], "FT2000")
            response = client.post("/local/ask", json={"question": "¿Cuál es el OEE?", "telegramChatId": 12345})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.get_json()["voiceEvent"]["telegramChatId"], 12345)

    def test_invalid_snapshot_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            client = create_app(JsonFileStore(Path(temporary) / "snapshot.json"), VoiceEventStore(), None).test_client()
            response = client.post("/hmi/current-snapshot", json={"widgets": "invalid"})
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.get_json()["error"], "INVALID_SNAPSHOT")


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
