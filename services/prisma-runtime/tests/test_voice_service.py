import base64
import os
import tempfile
import unittest
import wave
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from prisma_runtime import voice_service as service


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

        with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "test-token"}), patch.object(service, "_telegram_post", side_effect=responses) as telegram_post:
            service._send_same_prisma_audio_to_telegram(job)

        self.assertEqual(telegram_post.call_count, 3)
        self.assertTrue(telegram_post.call_args_list[0].args[0].endswith("/sendVoice"))
        self.assertEqual(telegram_post.call_args_list[1].kwargs["files"]["document"][1], b"ogg-bytes")
        self.assertTrue(telegram_post.call_args_list[1].args[0].endswith("/sendDocument"))
        wav_upload = telegram_post.call_args_list[2].kwargs["files"]["document"][1]
        self.assertTrue(telegram_post.call_args_list[2].args[0].endswith("/sendDocument"))
        with wave.open(BytesIO(wav_upload), "rb") as wav_file:
            self.assertEqual(wav_file.readframes(wav_file.getnframes()), processed_pcm)

    def test_local_health_is_ready_without_live_session(self):
        response = service.app.test_client().get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["mode"], "local")
        self.assertTrue(response.get_json()["ready"])
        self.assertFalse(response.get_json()["liveReady"])

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
        stream = FakeStream([audio_event(b"\x12\x34", mime_type="audio/l16", sample_rate=24000, channels=1), completed_event()])
        client = FakeClient([stream])
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-only"}), patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "PrismaStreamingDSP", IdentityDsp), patch.object(service, "_queue_same_prisma_audio_to_telegram"):
            response = service.app.test_client().post("/prisma/speak-live", json={"text": "Endpoint transcript"}, buffered=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, b"\x12\x34")
        self.assertEqual(response.headers["X-Prisma-Audio-Format"], "pcm_s16le")
        self.assertEqual(response.headers["X-Prisma-Sample-Rate"], "24000")
        self.assertEqual(response.headers["X-Prisma-Channels"], "1")

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
