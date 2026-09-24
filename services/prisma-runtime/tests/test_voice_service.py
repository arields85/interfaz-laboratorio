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
    """T11: mimics client.models.generate_content_stream's return value --
    an iterator of chunks, each shaped like candidates[].content.parts[]
    .inline_data (see FakeChunk below). Unlike the retired Interactions
    stream, there is no distinct terminal "completed" event; the stream
    simply ends."""

    def __init__(self, chunks, failure=None):
        self.chunks, self.failure, self.index, self.close_calls = list(chunks), failure, 0, 0

    def __iter__(self):
        return self

    def __next__(self):
        if self.index < len(self.chunks):
            chunk = self.chunks[self.index]
            self.index += 1
            return chunk
        if self.failure is not None:
            failure, self.failure = self.failure, None
            raise failure
        raise StopIteration

    def close(self):
        self.close_calls += 1


class FakeModels:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), []

    def _pop(self, kwargs):
        self.calls.append(kwargs)
        result = self.responses.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result

    def generate_content_stream(self, **kwargs):
        return self._pop(kwargs)

    def generate_content(self, **kwargs):
        return self._pop(kwargs)


class FakeClient:
    def __init__(self, responses):
        self.models, self.close_calls = FakeModels(responses), 0

    def close(self):
        self.close_calls += 1


class IdentityDsp:
    def __init__(self, _config):
        self.inputs = []

    def process(self, pcm):
        self.inputs.append(bytes(pcm))
        return bytes(pcm)


def audio_chunk(raw, mime_type="audio/L16;codec=pcm;rate=24000", as_base64=False):
    """A generate_content_stream chunk carrying one audio part. `as_base64`
    exercises the defensive str-data fallback; production/real SDK 2.17
    delivers inline_data.data as raw bytes."""
    data = base64.b64encode(raw).decode("ascii") if as_base64 else raw
    inline_data = SimpleNamespace(data=data, mime_type=mime_type)
    part = SimpleNamespace(inline_data=inline_data)
    content = SimpleNamespace(parts=[part])
    candidate = SimpleNamespace(content=content)
    return SimpleNamespace(candidates=[candidate])


class VoiceServiceTests(unittest.TestCase):
    def setUp(self):
        # T10 unit 4: the exact-text audio cache is a module-level singleton
        # shared by production requests across the process's lifetime, so it
        # must not leak entries between tests that reuse the same transcript.
        service._voice_audio_cache.clear()

    def test_raw_tts_is_retired_and_live_request_is_strictly_event_only(self):
        raw = service.app.test_client().post("/prisma/speak", json={"text": "raw"})
        self.assertEqual(raw.status_code, 410)
        self.assertEqual(raw.get_json()["error"], "RAW_TTS_DISABLED")

        for body in ({}, {"eventId": "not-a-uuid"}, {"eventId": str(uuid.uuid4()), "text": "override"}):
            with self.subTest(body=body):
                response = service.app.test_client().post("/prisma/speak-live", json=body)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json()["error"], "INVALID_VOICE_EVENT_REQUEST")

    def test_event_lookup_logs_elapsed_ms_without_the_event_id(self):
        """T10: resolve_voice_event is called up to 3 times per HMI voice
        query (route handler, AudioCoordinator.subscribe, and again inside
        its worker before generation) -- each call's own network elapsed
        time must be individually visible."""
        event_id = str(uuid.uuid4())
        owner_id = str(uuid.uuid4())
        response = Mock(status_code=200)
        response.iter_content.return_value = [
            b'{"id":"' + event_id.encode() + b'","ownerId":"' + owner_id.encode() + b'","text":"answer","question":"q","timestamp":"2026-09-17T12:00:00Z","expiresAt":9999999999}'
        ]
        http = Mock()
        http.get.return_value = response

        with self.assertLogs(service._logger, level="WARNING") as observed:
            service.resolve_voice_event(event_id, "test-capability", http=http)

        lines = [line for line in observed.output if "Prisma voice event resolve" in line]
        self.assertEqual(len(lines), 1)
        self.assertIn("elapsed_ms=", lines[0])
        self.assertNotIn(event_id, lines[0])

    def test_event_lookup_logs_elapsed_ms_even_on_failure(self):
        http = Mock()
        http.get.side_effect = RuntimeError("boom")
        with self.assertLogs(service._logger, level="WARNING") as observed:
            with self.assertRaises(RuntimeError):
                service.resolve_voice_event(str(uuid.uuid4()), "cap", http=http)
        self.assertTrue(any("Prisma voice event resolve" in line for line in observed.output))

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

    def test_speak_live_logs_first_chunk_and_stream_end_elapsed_ms(self):
        """T5: request received -> first audio chunk -> stream end, elapsed ms."""
        event_id = str(uuid.uuid4())
        event = {"id": event_id, "text": "answer", "question": "q", "expiresAt": 9999999999}
        coordinator = Mock()
        coordinator.subscribe.return_value = iter([b"\x12\x34", b"\x56\x78"])
        with patch.object(service, "resolve_voice_event", return_value=event), patch.object(service, "audio_coordinator", coordinator):
            with self.assertLogs(service._logger, level="WARNING") as observed:
                response = service.app.test_client().post("/prisma/speak-live", json={"eventId": event_id}, headers={"X-Prisma-Session-Capability": "test-capability"}, buffered=True)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data, b"\x12\x34\x56\x78")
        first_chunk = [line for line in observed.output if "first_chunk_elapsed_ms" in line]
        stream_end = [line for line in observed.output if "stream_end_elapsed_ms" in line]
        self.assertEqual(len(first_chunk), 1)
        self.assertEqual(len(stream_end), 1)
        self.assertNotIn(event_id, first_chunk[0])
        self.assertNotIn(event_id, stream_end[0])

    def test_prefetch_requires_a_capability(self):
        response = service.app.test_client().post("/internal/prisma/prefetch", json={"eventId": str(uuid.uuid4())})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "PRISMA_SESSION_REQUIRED")

    def test_prefetch_rejects_malformed_bodies(self):
        for body in ({}, {"eventId": 1}, {"eventId": "x", "extra": 1}):
            with self.subTest(body=body):
                response = service.app.test_client().post("/internal/prisma/prefetch", json=body, headers={"X-Prisma-Session-Capability": "cap"})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json()["error"], "INVALID_VOICE_EVENT_REQUEST")

    def test_prefetch_admits_a_subscription_then_closes_it_immediately(self):
        """T10 unit 3: prefetch triggers generation via the exact same
        resolve+admit path as /prisma/speak-live, then releases its own
        subscriber slot right away -- AudioCoordinator's existing buffered
        replay (already exercised by test_event_audio.py's multi-subscriber
        tests) is what lets a later real subscriber attach to the same,
        already-in-flight or already-buffered generation."""
        event_id = str(uuid.uuid4())
        event = {"id": event_id, "text": "answer", "question": "q", "expiresAt": 9999999999}
        subscription = Mock()
        coordinator = Mock()
        coordinator.subscribe.return_value = subscription
        with patch.object(service, "resolve_voice_event", return_value=event), patch.object(service, "audio_coordinator", coordinator):
            response = service.app.test_client().post("/internal/prisma/prefetch", json={"eventId": event_id}, headers={"X-Prisma-Session-Capability": "cap"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"ok": True})
        coordinator.subscribe.assert_called_once()
        subscription.close.assert_called_once_with()

    def test_prefetch_maps_admission_errors_the_same_way_speak_live_does(self):
        event_id = str(uuid.uuid4())
        cases = (
            (LookupError("VOICE_EVENT_NOT_FOUND"), 404, "VOICE_EVENT_NOT_FOUND"),
            (service.VoiceSessionUnauthorized("PRISMA_SESSION_REQUIRED"), 401, "PRISMA_SESSION_REQUIRED"),
            (service.GeminiCredentialUnavailable("GEMINI_CREDENTIAL_UNAVAILABLE"), 503, "GEMINI_CREDENTIAL_UNAVAILABLE"),
            (service.AudioCapacityError("VOICE_SUBSCRIBER_LIMIT"), 429, "VOICE_SUBSCRIBER_LIMIT"),
            (RuntimeError("boom"), 503, "VOICE_SERVICE_UNAVAILABLE"),
        )
        for error, expected_status, expected_body in cases:
            with self.subTest(error=type(error).__name__):
                with patch.object(service, "resolve_voice_event", side_effect=error):
                    response = service.app.test_client().post("/internal/prisma/prefetch", json={"eventId": event_id}, headers={"X-Prisma-Session-Capability": "cap"})
                self.assertEqual(response.status_code, expected_status)
                self.assertEqual(response.get_json()["error"], expected_body)

    def test_http_response_close_releases_unstarted_audio_subscription(self):
        stream = Mock()
        stream.__iter__ = Mock(return_value=iter(()))
        response = service._pcm_stream_response(lambda: stream)

        response.close()
        response.close()

        self.assertGreaterEqual(stream.close.call_count, 1)

    def test_boot_warm_up_delegates_to_the_warm_client_without_blocking(self):
        """T10 unit 2: main() must never block on Gemini reachability, so the
        warm-up entry point is a plain, synchronous, already-safe delegation
        that main() runs on its own daemon thread (not exercised here)."""
        with patch.object(service, "_warm_gemini_client") as warm_client, \
                patch.object(service.gemini_credentials, "resolve") as resolve:
            service._warm_up_gemini_client_in_background()
        warm_client.warm_up.assert_called_once_with(resolve)

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

    def test_job_creation_logs_elapsed_ms(self):
        with self.assertLogs(service._logger, level="WARNING") as observed:
            service._create_interactions_tts_job("Some transcript")
        lines = [line for line in observed.output if "Prisma TTS job create" in line]
        self.assertEqual(len(lines), 1)
        self.assertIn("elapsed_ms=", lines[0])
        self.assertNotIn("Some transcript", lines[0])

    def test_tts_stream_request_sends_the_plain_transcript_with_no_wrapping_prompt(self):
        """T11: "normal" style is the only style implemented -- the exact
        transcript text is sent as `contents`, never wrapped in a prompt
        (the retired build_tts_prompt no longer exists)."""
        stream = FakeStream([])
        client = FakeClient([stream])
        result = service._create_tts_stream(client, "Exact transcript")
        call = client.models.calls[0]
        self.assertEqual(call["model"], "gemini-3.8-flash-lite-tts")
        self.assertEqual(call["contents"], "Exact transcript")
        config = call["config"]
        self.assertEqual(config.response_modalities, ["AUDIO"])
        self.assertEqual(config.speech_config.voice_config.prebuilt_voice_config.voice_name, "Leda")
        self.assertIs(result, stream)

    def test_tts_response_request_uses_the_same_model_and_config_as_the_stream(self):
        """The non-streaming fallback call must speak with the exact same
        model/voice as the streaming path, just without `stream`."""
        response = SimpleNamespace(candidates=[])
        client = FakeClient([response])
        result = service._create_tts_response(client, "Exact transcript")
        call = client.models.calls[0]
        self.assertEqual(call["model"], "gemini-3.8-flash-lite-tts")
        self.assertEqual(call["contents"], "Exact transcript")
        self.assertEqual(call["config"].speech_config.voice_config.prebuilt_voice_config.voice_name, "Leda")
        self.assertIs(result, response)

    def test_build_tts_prompt_and_the_interactions_call_path_are_retired(self):
        """T11: the 45-line build_tts_prompt and the Interactions-API request
        builders are dead code now that "normal" style sends the plain
        transcript via generate_content_stream/generate_content."""
        for removed in ("build_tts_prompt", "_tts_interaction_request", "_create_tts_interaction", "_iter_interaction_audio_deltas", "_validate_audio_delta", "_decode_audio_delta"):
            with self.subTest(removed=removed):
                self.assertFalse(hasattr(service, removed))

    def test_audio_inline_data_accepts_equivalent_mime_forms_and_rejects_others(self):
        accepted = ("audio/L16;codec=pcm;rate=24000", "audio/l16", "AUDIO/L16;RATE=24000", None)
        for mime_type in accepted:
            with self.subTest(mime_type=mime_type):
                inline_data = SimpleNamespace(data=b"\x12\x34", mime_type=mime_type)
                self.assertEqual(service._decode_audio_inline_data(inline_data), b"\x12\x34")

        rejected = (
            ("audio/mpeg", "UNSUPPORTED_TTS_AUDIO_MIME_TYPE"),
            ("audio/l16;rate=16000", "UNSUPPORTED_TTS_SAMPLE_RATE"),
        )
        for mime_type, code in rejected:
            with self.subTest(mime_type=mime_type):
                inline_data = SimpleNamespace(data=b"\x12\x34", mime_type=mime_type)
                with self.assertRaisesRegex(service.PrismaTtsFormatError, code):
                    service._decode_audio_inline_data(inline_data)

    def test_audio_inline_data_handles_bytes_and_base64_str_defensively(self):
        raw = b"\x12\x34\x56"
        self.assertEqual(service._decode_audio_inline_data(SimpleNamespace(data=raw, mime_type=None)), raw)
        encoded = base64.b64encode(raw).decode("ascii")
        self.assertEqual(service._decode_audio_inline_data(SimpleNamespace(data=encoded, mime_type=None)), raw)

    def test_audio_inline_data_rejects_missing_or_empty_data(self):
        for data in (None, "", b""):
            with self.subTest(data=data):
                with self.assertRaises(service.PrismaTtsFormatError):
                    service._decode_audio_inline_data(SimpleNamespace(data=data, mime_type=None))

    def test_get_gemini_client_logs_resolve_build_elapsed_ms_and_reused_flag(self):
        """T10 unit 1+2: split credential-resolve time from client-build time,
        and report whether the T10-unit-2 warm client cache was reused."""
        fake_client = object()
        with patch.object(service.gemini_credentials, "resolve", return_value="secret-value") as resolve, \
                patch.object(service._warm_gemini_client, "get", return_value=(fake_client, True)) as warm_get:
            with self.assertLogs(service._logger, level="WARNING") as observed:
                result = service.get_gemini_client()
        self.assertIs(result, fake_client)
        resolve.assert_called_once_with()
        warm_get.assert_called_once_with("secret-value")
        lines = [line for line in observed.output if "Prisma Gemini client:" in line]
        self.assertEqual(len(lines), 1)
        self.assertIn("resolve_elapsed_ms=", lines[0])
        self.assertIn("build_elapsed_ms=", lines[0])
        self.assertIn("reused=True", lines[0])
        self.assertNotIn("secret-value", lines[0])

    def test_generate_tts_audio_never_closes_the_warm_client(self):
        """T10 unit 2: the client is a shared warm singleton now, so neither
        an ordinary completion nor a cancellation may close it; only the
        per-request stream and idle guard are ever closed."""
        stream = FakeStream([audio_chunk(b"\x12\x34")])
        client = FakeClient([stream])
        control = GenerationControl()
        with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "PrismaStreamingDSP", IdentityDsp), patch.object(service, "_queue_same_prisma_audio_to_telegram"):
            job = service._create_interactions_tts_job("Cancelled transcript")
            with patch.object(service, "_create_interactions_tts_job", return_value=job):
                output = service._generate_event_audio({"id": str(uuid.uuid4()), "text": "Cancelled transcript"}, {}, "secret", control)
                self.assertEqual(next(output), b"\x12\x34")
                control.signal()
                control.run_callbacks()
                self.assertEqual(stream.close_calls, 1)
                self.assertEqual(client.close_calls, 0)
                output.close()

    def test_stream_logs_time_to_first_byte_and_first_yield_processing_once(self):
        """T10 unit 1: Gemini time-to-first-byte vs our own post-processing time."""
        stream = FakeStream([audio_chunk(b"\x12\x34")])
        client = FakeClient([stream])
        with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "PrismaStreamingDSP", IdentityDsp), patch.object(service, "_queue_same_prisma_audio_to_telegram"):
            job = service._create_interactions_tts_job("Lazy transcript")
            with self.assertLogs(service._logger, level="WARNING") as observed:
                output = service._generate_tts_audio(job)
                self.assertEqual(next(output), b"\x12\x34")
                self.assertEqual(list(output), [])
        first_byte = [line for line in observed.output if "time_to_first_byte_ms" in line]
        first_yield = [line for line in observed.output if "first_yield_processing_elapsed_ms" in line]
        self.assertEqual(len(first_byte), 1)
        self.assertEqual(len(first_yield), 1)
        self.assertNotIn("Lazy transcript", first_byte[0] + first_yield[0])

    def test_speak_live_logs_event_publish_to_received_delta_from_event_timestamp(self):
        """T10 unit 1: cross-process delta computed from the event's own wall-clock
        timestamp, never by logging the raw event id on either side."""
        event_id = str(uuid.uuid4())
        published_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        event = {"id": event_id, "text": "answer", "question": "q", "expiresAt": 9999999999, "timestamp": published_at}
        coordinator = Mock()
        coordinator.subscribe.return_value = iter([b"\x12\x34"])
        with patch.object(service, "resolve_voice_event", return_value=event), patch.object(service, "audio_coordinator", coordinator):
            with self.assertLogs(service._logger, level="WARNING") as observed:
                response = service.app.test_client().post("/prisma/speak-live", json={"eventId": event_id}, headers={"X-Prisma-Session-Capability": "test-capability"}, buffered=True)
                self.assertEqual(response.status_code, 200)
        lines = [line for line in observed.output if "event_publish_to_received_ms" in line]
        self.assertEqual(len(lines), 1)
        self.assertNotIn(event_id, lines[0])
        self.assertNotIn("event_publish_to_received_ms=None", lines[0])

    def test_speak_live_logs_none_delta_when_event_timestamp_is_missing_or_invalid(self):
        for timestamp in (None, "not-a-time"):
            with self.subTest(timestamp=timestamp):
                event_id = str(uuid.uuid4())
                event = {"id": event_id, "text": "answer", "question": "q", "expiresAt": 9999999999}
                if timestamp is not None:
                    event["timestamp"] = timestamp
                coordinator = Mock()
                coordinator.subscribe.return_value = iter([b"\x12\x34"])
                with patch.object(service, "resolve_voice_event", return_value=event), patch.object(service, "audio_coordinator", coordinator):
                    with self.assertLogs(service._logger, level="WARNING") as observed:
                        response = service.app.test_client().post("/prisma/speak-live", json={"eventId": event_id}, headers={"X-Prisma-Session-Capability": "test-capability"}, buffered=True)
                        self.assertEqual(response.status_code, 200)
                lines = [line for line in observed.output if "event_publish_to_received_ms" in line]
                self.assertEqual(len(lines), 1)
                self.assertIn("event_publish_to_received_ms=None", lines[0])

    def test_stream_yields_first_post_dsp_chunk_before_completion(self):
        stream = FakeStream([audio_chunk(b"\x12\x34")])
        client = FakeClient([stream])
        with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "PrismaStreamingDSP", IdentityDsp), patch.object(service, "_queue_same_prisma_audio_to_telegram"):
            job = service._create_interactions_tts_job("Lazy transcript")
            output = service._generate_tts_audio(job)
            self.assertEqual(next(output), b"\x12\x34")
            self.assertEqual(list(output), [])
        self.assertEqual(stream.close_calls, 1)
        # T10 unit 2: the client is now a shared warm singleton, never closed
        # per-generation.
        self.assertEqual(client.close_calls, 0)
        self.assertFalse(any(thread.name == "PrismaProviderIdleGuard" for thread in threading.enumerate()))

    def test_generation_control_runs_provider_and_job_cleanup_once(self):
        stream = FakeStream([audio_chunk(b"\x12\x34")])
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
                # T10 unit 2: cancellation must never close the shared warm client.
                self.assertEqual(client.close_calls, 0)
                output.close()

    def test_voice_audio_cache_evicts_by_count_and_bytes(self):
        cache = service.VoiceAudioCache(max_entries=2, max_bytes=10)
        cache.put("a", b"12345")
        cache.put("b", b"12345")
        self.assertEqual(cache.get("a"), b"12345")
        # A third entry pushes past max_entries=2: the least recently used
        # ("a" was just touched above, so "b" is the LRU one) is evicted.
        cache.put("c", b"12345")
        self.assertIsNone(cache.get("b"))
        self.assertEqual(cache.get("a"), b"12345")
        self.assertEqual(cache.get("c"), b"12345")

        # An entry alone larger than max_bytes is never cached.
        cache.put("too-big", b"x" * 11)
        self.assertIsNone(cache.get("too-big"))

    def test_second_identical_request_is_served_from_cache_without_calling_gemini(self):
        stream = FakeStream([audio_chunk(b"\x12\x34\x56\x78")])
        client = FakeClient([stream])
        with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "PrismaStreamingDSP", IdentityDsp), patch.object(service, "_queue_same_prisma_audio_to_telegram"):
            job_one = service._create_interactions_tts_job("Repeated transcript")
            first_output = list(service._generate_tts_audio(job_one))
            self.assertEqual(first_output, [b"\x12\x34\x56\x78"])

            job_two = service._create_interactions_tts_job("Repeated transcript")
            with self.assertLogs(service._logger, level="WARNING") as observed:
                second_output = list(service._generate_tts_audio(job_two))
        self.assertEqual(second_output, [b"\x12\x34\x56\x78"])
        # Only the first job's stream was ever created; the SDK's
        # generate_content_stream was never called a second time.
        self.assertEqual(len(client.models.calls), 1)
        self.assertTrue(any("Prisma TTS cache: hit" in line for line in observed.output))

    def test_different_text_or_voice_config_is_a_cache_miss(self):
        def run(text, config=None):
            stream = FakeStream([audio_chunk(b"\xaa\xbb")])
            client = FakeClient([stream])
            with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "PrismaStreamingDSP", IdentityDsp), patch.object(service, "_queue_same_prisma_audio_to_telegram"):
                job = service._create_interactions_tts_job(text, voice_config=config)
                list(service._generate_tts_audio(job))
            return client

        base_config = service.clone_json(service.DEFAULT_PRISMA_VOICE_CONFIG)
        other_config = service.clone_json(service.DEFAULT_PRISMA_VOICE_CONFIG)
        other_config["effectIntensity"] = 1

        run("Text one", base_config)
        client_for_different_text = run("Text two", base_config)
        client_for_different_config = run("Text one", other_config)

        self.assertEqual(len(client_for_different_text.models.calls), 1)
        self.assertEqual(len(client_for_different_config.models.calls), 1)

    def test_cache_key_changes_when_the_warm_client_secret_hash_changes(self):
        with patch.object(service._warm_gemini_client, "current_secret_hash", return_value="hash-one"):
            key_one = service._voice_audio_cache_key({"text": "same", "voice_config": {}})
        with patch.object(service._warm_gemini_client, "current_secret_hash", return_value="hash-two"):
            key_two = service._voice_audio_cache_key({"text": "same", "voice_config": {}})
        self.assertNotEqual(key_one, key_two)

    def test_stream_falls_back_once_before_any_audio(self):
        stream = FakeStream([], RuntimeError("provider unavailable"))
        fallback = b"\x34\x12\xfe\xff"
        response = SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=[SimpleNamespace(inline_data=SimpleNamespace(data=fallback, mime_type="audio/L16;codec=pcm;rate=24000"))]))])
        client = FakeClient([stream, response])
        with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "PrismaStreamingDSP", IdentityDsp), patch.object(service, "apply_prisma_dsp_full_pcm", side_effect=lambda pcm, _config: pcm), patch.object(service, "_queue_same_prisma_audio_to_telegram"):
            job = service._create_interactions_tts_job("Fallback transcript")
            self.assertEqual(list(service._generate_tts_audio(job)), [fallback])
        self.assertEqual(len(client.models.calls), 2)
        self.assertNotIn("stream", client.models.calls[1])
        self.assertEqual(client.models.calls[1]["model"], "gemini-3.8-flash-lite-tts")

    def test_stream_rejects_incomplete_pcm_without_fallback(self):
        stream = FakeStream([audio_chunk(b"\x7f")])
        client = FakeClient([stream])
        with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "PrismaStreamingDSP", IdentityDsp):
            job = service._create_interactions_tts_job("Odd sample transcript")
            with self.assertRaisesRegex(service.PrismaTtsFormatError, "INCOMPLETE_PCM_S16LE_SAMPLE"):
                list(service._generate_tts_audio(job))
        self.assertEqual(len(client.models.calls), 1)

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


class MainStartupWiringTests(unittest.TestCase):
    def test_main_installs_access_log_query_redaction_before_app_run(self) -> None:
        """T13b should-fix (defense in depth): the query-string-redacting
        access log filter must be installed before Werkzeug's dev server
        starts logging requests, not after."""
        source = (RUNTIME_ROOT / "src" / "prisma_runtime" / "voice_service.py").read_text(encoding="utf-8")
        main_start = source.index("\ndef main():")
        main_body = source[main_start:]
        self.assertIn("install_access_log_query_redaction()", main_body)
        self.assertLess(
            main_body.index("install_access_log_query_redaction()"),
            main_body.index("app.run("),
        )


if __name__ == "__main__":
    unittest.main()
