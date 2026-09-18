import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.local_presentation import JsonFileStore, create_app
from prisma_runtime import voice_service


HEADER = "X-Prisma-Session-Capability"


class HmiSessionIsolationTests(unittest.TestCase):
    def test_two_documents_have_independent_context_events_and_revocation(self):
        with tempfile.TemporaryDirectory() as temporary:
            app = create_app(
                snapshot_store=JsonFileStore(Path(temporary) / "legacy.json"),
                telegram_configuration=type("Config", (), {
                    "enabled": False,
                    "configured": False,
                    "configuration_error": None,
                })(),
                admin_http=type("Admin", (), {"register": lambda _self, _app: None})(),
            )
            a = app.test_client()
            b = app.test_client()
            cap_a = a.post("/hmi/session", json={}).headers[HEADER]
            cap_b = b.post("/hmi/session", json={}).headers[HEADER]
            headers_a = {HEADER: cap_a}
            headers_b = {HEADER: cap_b}

            self.assertEqual(a.post("/hmi/current-snapshot", json={"widgets": [], "batch": "A"}, headers=headers_a).status_code, 202)
            self.assertEqual(b.post("/hmi/current-snapshot", json={"widgets": [], "batch": "B"}, headers=headers_b).status_code, 202)
            self.assertEqual(a.get("/hmi/current-snapshot", headers=headers_a).get_json()["batch"], "A")
            self.assertEqual(b.get("/hmi/current-snapshot", headers=headers_b).get_json()["batch"], "B")

            event_a = a.post("/local/ask", json={"question": "same question"}, headers=headers_a).get_json()["voiceEvent"]
            event_b = b.post("/local/ask", json={"question": "same question"}, headers=headers_b).get_json()["voiceEvent"]
            self.assertNotEqual(event_a["id"], event_b["id"])
            self.assertEqual(a.get("/hmi/voice/latest", headers=headers_a).get_json()["id"], event_a["id"])
            self.assertEqual(b.get("/hmi/voice/latest", headers=headers_b).get_json()["id"], event_b["id"])

            foreign = a.get(f"/internal/prisma/voice-events/{event_b['id']}", headers=headers_a)
            self.assertEqual(foreign.status_code, 404)
            internal = a.get(f"/internal/prisma/voice-events/{event_a['id']}", headers=headers_a).get_json()
            self.assertIn("ownerId", internal)
            self.assertNotIn("ownerId", event_a)

            class PresentationHttp:
                trust_env = True

                def get(self, url, *, headers, **_options):
                    event_id = url.rsplit("/", 1)[-1]
                    response = app.test_client().get(
                        f"/internal/prisma/voice-events/{event_id}",
                        headers=headers,
                    )
                    response.iter_content = lambda _size: [response.data]
                    return response

            class FakeAudioCoordinator:
                def subscribe(self, event, _config):
                    return iter([event["ownerId"].encode("ascii")])

            with patch.object(voice_service, "voice_event_http", PresentationHttp()), patch.object(
                voice_service,
                "audio_coordinator",
                FakeAudioCoordinator(),
            ):
                audio_a = voice_service.app.test_client().post(
                    "/prisma/speak-live",
                    json={"eventId": event_a["id"]},
                    headers=headers_a,
                    buffered=True,
                )
                foreign_audio = voice_service.app.test_client().post(
                    "/prisma/speak-live",
                    json={"eventId": event_b["id"]},
                    headers=headers_a,
                    buffered=True,
                )
                audio_b = voice_service.app.test_client().post(
                    "/prisma/speak-live",
                    json={"eventId": event_b["id"]},
                    headers=headers_b,
                    buffered=True,
                )
            self.assertEqual(audio_a.status_code, 200)
            self.assertEqual(audio_b.status_code, 200)
            self.assertNotEqual(audio_a.data, audio_b.data)
            self.assertEqual(foreign_audio.status_code, 404)

            self.assertEqual(a.delete("/hmi/session", headers=headers_a).status_code, 204)
            self.assertEqual(a.get("/hmi/voice/latest", headers=headers_a).status_code, 401)
            self.assertEqual(b.get("/hmi/voice/latest", headers=headers_b).status_code, 200)


if __name__ == "__main__":
    unittest.main()
