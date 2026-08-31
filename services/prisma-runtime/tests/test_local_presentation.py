import tempfile
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
