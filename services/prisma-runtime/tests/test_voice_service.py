import base64
import json
import os
import sys
import tempfile
import threading
import uuid
import unittest
import wave
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime import voice_service as service
from prisma_runtime.event_audio import GenerationControl


class FakeStream:
    def __init__(self, events, failure=None):
        self.events, self.failure, self.index, self.close_calls = list(events), failure, 0, 0

    def __iter__(self):
        return self

    def __next__(self):
        if self.index < len(self.events):
            event = self.events[self.index]
            self.index += 1
            return event
        if self.failure is not None:
            failure, self.failure = self.failure, None
            raise failure
        raise StopIteration

    def close(self):
        self.close_calls += 1


class FakeInteractions:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        result = self.responses.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result


class FakeClient:
    def __init__(self, responses):
        self.interactions, self.close_calls = FakeInteractions(responses), 0

    def close(self):
        self.close_calls += 1


class IdentityDsp:
    def __init__(self, _config):
        self.inputs = []

    def process(self, pcm):
        self.inputs.append(bytes(pcm))
        return bytes(pcm)


def audio_event(raw, **metadata):
    return SimpleNamespace(event_type="step.delta", delta=SimpleNamespace(type="audio", data=base64.b64encode(raw).decode("ascii"), **metadata))


def completed_event(status="completed"):
    return SimpleNamespace(event_type="interaction.completed", interaction=SimpleNamespace(status=status))


class VoiceServiceTests(unittest.TestCase):
    def test_raw_tts_is_retired_and_live_request_is_strictly_event_only(self):
        raw = service.app.test_client().post("/prisma/speak", json={"text": "raw"})
        self.assertEqual(raw.status_code, 410)
        self.assertEqual(raw.get_json()["error"], "RAW_TTS_DISABLED")

        for body in ({}, {"eventId": "not-a-uuid"}, {"eventId": str(uuid.uuid4()), "text": "override"}):
            with self.subTest(body=body):
                response = service.app.test_client().post("/prisma/speak-live", json=body)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json()["error"], "INVALID_VOICE_EVENT_REQUEST")

    def test_event_lookup_is_fixed_proxy_disabled_bounded_and_no_redirect(self):
        event_id = str(uuid.uuid4())
        response = Mock(status_code=200)
        owner_id = str(uuid.uuid4())
        response.iter_content.return_value = [b'{"id":"' + event_id.encode() + b'","ownerId":"' + owner_id.encode() + b'","text":"answer","question":"q","timestamp":"2026-09-17T12:00:00Z","expiresAt":9999999999}']
        http = Mock()
        http.get.return_value = response

        event = service.resolve_voice_event(event_id, "test-capability", http=http)

        self.assertEqual(event["text"], "answer")
        response.close.assert_called_once_with()
        self.assertFalse(http.trust_env)
        http.get.assert_called_once_with(
            f"http://127.0.0.1:5057/internal/prisma/voice-events/{event_id}",
            headers={"X-Prisma-Session-Capability": "test-capability"},
            timeout=2,
            allow_redirects=False,
            stream=True,
        )

    def test_event_lookup_rejects_noncanonical_field_shapes_and_closes_response(self):
        event_id = str(uuid.uuid4())
        valid = {
            "id": event_id,
            "text": "answer",
            "question": "q",
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "expiresAt": 9999999999,
        }
        invalid_values = (
            ("timestamp", []),
            ("timestamp", "not-a-time"),
            ("question", {}),
            ("question", "\ud800"),
            ("text", "\ud800"),
            ("expiresAt", True),
            ("expiresAt", float("nan")),
            ("expiresAt", float("inf")),
        )
        for field, value in invalid_values:
            with self.subTest(field=field, value=repr(value)):
                response = Mock(status_code=200)
                response.iter_content.return_value = [json.dumps({**valid, field: value}).encode("utf-8", "surrogatepass")]
                http = Mock()
                http.get.return_value = response
                with self.assertRaisesRegex(RuntimeError, "LOOKUP_UNAVAILABLE"):
                    service.resolve_voice_event(event_id, http=http)
                response.close.assert_called_once_with()

    def test_event_lookup_closes_response_on_not_found_redirect_and_oversize(self):
        event_id = str(uuid.uuid4())
        for status, chunks, expected in (
            (404, [], LookupError),
            (302, [], RuntimeError),
            (200, [b"x" * (service._VOICE_EVENT_MAX_BYTES + 1)], RuntimeError),
        ):
            with self.subTest(status=status):
                response = Mock(status_code=status)
                response.iter_content.return_value = chunks
                http = Mock()
                http.get.return_value = response
                with self.assertRaises(expected):
                    service.resolve_voice_event(event_id, http=http)
                response.close.assert_called_once_with()

    def test_all_viewers_receive_pcm_without_admin_cookie_or_role(self):
        event_id = str(uuid.uuid4())
        event = {"id": event_id, "text": "answer", "question": "q", "expiresAt": 9999999999}
        coordinator = Mock()
        coordinator.subscribe.return_value = iter([b"\x12\x34"])
        with patch.object(service, "resolve_voice_event", return_value=event), patch.object(service, "audio_coordinator", coordinator):
            response = service.app.test_client().post("/prisma/speak-live", json={"eventId": event_id}, headers={"X-Prisma-Session-Capability": "test-capability"}, buffered=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, b"\x12\x34")
        coordinator.subscribe.assert_called_once()

    def test_http_response_close_releases_unstarted_audio_subscription(self):
        stream = Mock()
        stream.__iter__ = Mock(return_value=iter(()))
        response = service._pcm_stream_response(lambda: stream)

        response.close()
        response.close()

        self.assertGreaterEqual(stream.close.call_count, 1)

    def test_known_multiworker_and_reloader_modes_fail_closed(self):
        with self.assertRaisesRegex(RuntimeError, "SINGLE_PROCESS"):
            service._validate_single_process_environment({"WEB_CONCURRENCY": "2"})
        with self.assertRaisesRegex(RuntimeError, "RELOADER"):
            service._validate_single_process_environment({"WERKZEUG_RUN_MAIN": "true"})
        service._validate_single_process_environment({"WEB_CONCURRENCY": "1"})

    def test_telegram_falls_back_from_non_2xx_ogg_attempts_to_identical_pcm_wav(self):
        processed_pcm = b"\x10\x20\x30\x40\x50\x60"
        encoder = Mock()
        encoder.finish_and_get.return_value = b"ogg-bytes"
        job = {
            "telegram_chat_id": 995701520,
            "telegram_encoder": encoder,
            "telegram_pcm_parts": [processed_pcm],
            "cancelled": Mock(is_set=Mock(return_value=False)),
            "event_id": "same-audio",
        }
        responses = [Mock(ok=False, status_code=500), Mock(ok=False, status_code=502), Mock(ok=True)]

        with patch.dict(os.environ, {"PRISMA_LOCAL_TELEGRAM_ENABLED": "1", "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "test-token"}), patch.object(service, "_telegram_post", side_effect=responses) as telegram_post:
            service._send_same_prisma_audio_to_telegram(job)

        self.assertEqual(telegram_post.call_count, 3)
        self.assertTrue(telegram_post.call_args_list[0].args[0].endswith("/sendVoice"))
        self.assertEqual(telegram_post.call_args_list[1].kwargs["files"]["document"][1], b"ogg-bytes")
        self.assertTrue(telegram_post.call_args_list[1].args[0].endswith("/sendDocument"))
        wav_upload = telegram_post.call_args_list[2].kwargs["files"]["document"][1]
        self.assertTrue(telegram_post.call_args_list[2].args[0].endswith("/sendDocument"))
        with wave.open(BytesIO(wav_upload), "rb") as wav_file:
            self.assertEqual(wav_file.readframes(wav_file.getnframes()), processed_pcm)

    def test_local_health_is_ready_but_provider_is_unconfigured_without_key(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(service, "get_gemini_client") as get_client:
            response = service.app.test_client().get("/health")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["service"], "prisma-voice")
        self.assertEqual(payload["mode"], "local")
        self.assertTrue(payload["ready"])
        self.assertFalse(payload["liveReady"])
        self.assertEqual(payload["providerStatus"], {"source": "environment", "configured": False, "available": True, "verified": False})
        self.assertNotIn("apiKey", str(payload))
        get_client.assert_not_called()

    def test_health_reports_key_presence_as_configured_but_never_verified(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "  configured-secret  "}, clear=True), patch.object(service, "get_gemini_client") as get_client:
            payload = service.app.test_client().get("/health").get_json()
        self.assertEqual(payload["providerStatus"], {"source": "environment", "configured": True, "available": True, "verified": False})
        self.assertNotIn("configured-secret", str(payload))
        get_client.assert_not_called()

    def test_raw_retirement_and_invalid_event_precede_credential_work(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "   "}, clear=True), patch.object(service, "get_gemini_client") as get_client, patch.object(service.prisma_audio_sink, "emit") as emit:
            regular = service.app.test_client().post("/prisma/speak", json={"text": "Status"})
            live = service.app.test_client().post("/prisma/speak-live", json={"text": "Status"})
        self.assertEqual(regular.status_code, 410)
        self.assertEqual(regular.get_json()["error"], "RAW_TTS_DISABLED")
        self.assertEqual(live.status_code, 400)
        self.assertEqual(live.get_json()["error"], "INVALID_VOICE_EVENT_REQUEST")
        get_client.assert_not_called()
        emit.assert_not_called()

    def test_missing_key_does_not_change_empty_request_validation(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(service, "get_gemini_client") as get_client:
            regular = service.app.test_client().post("/prisma/speak", json={})
            live = service.app.test_client().post("/prisma/speak-live", json={})
        self.assertEqual(regular.status_code, 410)
        self.assertEqual(regular.get_json(), {"ok": False, "error": "RAW_TTS_DISABLED"})
        self.assertEqual(live.status_code, 400)
        self.assertEqual(live.get_json(), {"ok": False, "error": "INVALID_VOICE_EVENT_REQUEST"})
        get_client.assert_not_called()

    def test_tts_request_uses_streaming_interactions_contract(self):
        stream = FakeStream([])
        client = FakeClient([stream])
        result = service._create_tts_interaction(client, "Exact transcript", stream=True)
        self.assertEqual(client.interactions.calls[0]["model"], "gemini-3.1-flash-tts-preview")
        self.assertEqual(client.interactions.calls[0]["generation_config"], {"speech_config": [{"voice": "Leda"}]})
        self.assertTrue(client.interactions.calls[0]["stream"])
        self.assertIs(result, stream)

    def test_stream_yields_first_post_dsp_chunk_before_completion(self):
        stream = FakeStream([audio_event(b"\x12\x34"), completed_event()])
        client = FakeClient([stream])
        with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "PrismaStreamingDSP", IdentityDsp), patch.object(service, "_queue_same_prisma_audio_to_telegram"):
            job = service._create_interactions_tts_job("Lazy transcript")
            output = service._generate_interactions_tts_audio(job)
            self.assertEqual(next(output), b"\x12\x34")
            self.assertEqual(list(output), [])
        self.assertEqual(stream.close_calls, 1)
        self.assertEqual(client.close_calls, 1)
        self.assertFalse(any(thread.name == "PrismaProviderIdleGuard" for thread in threading.enumerate()))

    def test_generation_control_runs_provider_and_job_cleanup_once(self):
        stream = FakeStream([audio_event(b"\x12\x34"), completed_event()])
        client = FakeClient([stream])
        control = GenerationControl()
        with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "PrismaStreamingDSP", IdentityDsp), patch.object(service, "_queue_same_prisma_audio_to_telegram"):
            job = service._create_interactions_tts_job("Cancelled transcript")
            with patch.object(service, "_create_interactions_tts_job", return_value=job):
                output = service._generate_event_audio({"id": str(uuid.uuid4()), "text": "Cancelled transcript"}, {}, "secret", control)
                self.assertEqual(next(output), b"\x12\x34")
                control.signal()
                control.run_callbacks()
                control.run_callbacks()
                self.assertTrue(job["cancelled"].is_set())
                self.assertEqual(stream.close_calls, 1)
                self.assertEqual(client.close_calls, 1)
                output.close()

    def test_stream_falls_back_once_before_any_audio(self):
        stream = FakeStream([], RuntimeError("provider unavailable"))
        fallback = b"\x34\x12\xfe\xff"
        interaction = SimpleNamespace(output_audio=SimpleNamespace(data=base64.b64encode(fallback).decode("ascii")))
        client = FakeClient([stream, interaction])
        with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "PrismaStreamingDSP", IdentityDsp), patch.object(service, "apply_prisma_dsp_full_pcm", side_effect=lambda pcm, _config: pcm), patch.object(service, "_queue_same_prisma_audio_to_telegram"):
            job = service._create_interactions_tts_job("Fallback transcript")
            self.assertEqual(list(service._generate_interactions_tts_audio(job)), [fallback])
        self.assertEqual(len(client.interactions.calls), 2)
        self.assertNotIn("stream", client.interactions.calls[1])

    def test_stream_rejects_incomplete_pcm_without_fallback(self):
        stream = FakeStream([audio_event(b"\x7f"), completed_event()])
        client = FakeClient([stream])
        with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "PrismaStreamingDSP", IdentityDsp):
            job = service._create_interactions_tts_job("Odd sample transcript")
            with self.assertRaisesRegex(service.PrismaTtsFormatError, "INCOMPLETE_PCM_S16LE_SAMPLE"):
                list(service._generate_interactions_tts_audio(job))
        self.assertEqual(len(client.interactions.calls), 1)

    def test_local_endpoint_returns_canonical_pcm_metadata_without_provider_connection(self):
        event_id = str(uuid.uuid4())
        coordinator = Mock()
        coordinator.subscribe.return_value = iter([b"\x12\x34"])
        with patch.object(service, "resolve_voice_event", return_value={"id": event_id, "text": "answer", "expiresAt": 9999999999}), patch.object(service, "audio_coordinator", coordinator):
            response = service.app.test_client().post("/prisma/speak-live", json={"eventId": event_id}, headers={"X-Prisma-Session-Capability": "test-capability"}, buffered=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, b"\x12\x34")
        self.assertEqual(response.headers["X-Prisma-Audio-Format"], "pcm_s16le")
        self.assertEqual(response.headers["X-Prisma-Sample-Rate"], "24000")
        self.assertEqual(response.headers["X-Prisma-Channels"], "1")
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_session_tts_responses_are_no_store_without_changing_unrelated_health(self):
        event_id = str(uuid.uuid4())
        coordinator = Mock()
        coordinator.subscribe.return_value = iter([b"\x12\x34"])
        with patch.object(service, "resolve_voice_event", return_value={"id": event_id, "text": "answer", "expiresAt": 9999999999}), patch.object(service, "audio_coordinator", coordinator):
            success = service.app.test_client().post(
                "/prisma/speak-live",
                json={"eventId": event_id},
                headers={"X-Prisma-Session-Capability": "test-capability"},
                buffered=True,
            )
        invalid = service.app.test_client().post("/prisma/speak-live", json={})
        options = service.app.test_client().options("/prisma/speak-live")
        method = service.app.test_client().get("/prisma/speak-live")
        health = service.app.test_client().get("/health")

        for response in (success, invalid, options, method):
            self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertNotEqual(health.headers.get("Cache-Control"), "no-store")

    def test_local_config_update_is_atomic_and_strict(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = service.PrismaVoiceConfigStore(Path(temporary) / "config.json")
            valid = service.clone_json(service.DEFAULT_PRISMA_VOICE_CONFIG)
            invalid = service.clone_json(valid); invalid["unexpected"] = True
            store.update_local(valid)
            before = Path(temporary, "config.json").read_bytes()
            with self.assertRaises(ValueError):
                store.update_local(invalid)
            self.assertEqual(Path(temporary, "config.json").read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
