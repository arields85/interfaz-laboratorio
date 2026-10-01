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

from leda_runtime import voice_service as service
from leda_runtime.event_audio import GenerationControl


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
        raw = service.app.test_client().post("/leda/speak", json={"text": "raw"})
        self.assertEqual(raw.status_code, 410)
        self.assertEqual(raw.get_json()["error"], "RAW_TTS_DISABLED")

        for body in ({}, {"eventId": "not-a-uuid"}, {"eventId": str(uuid.uuid4()), "text": "override"}):
            with self.subTest(body=body):
                response = service.app.test_client().post("/leda/speak-live", json=body)
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

        with self.assertLogs(service._logger, level="INFO") as observed:
            service.resolve_voice_event(event_id, "test-capability", http=http)

        lines = [line for line in observed.output if "Leda voice event resolve" in line]
        self.assertEqual(len(lines), 1)
        self.assertIn("elapsed_ms=", lines[0])
        self.assertNotIn(event_id, lines[0])
        # PW-011 M4: routine per-call timing, not a warning-worthy condition.
        self.assertTrue(lines[0].startswith("INFO:"))

    def test_event_lookup_logs_elapsed_ms_even_on_failure(self):
        http = Mock()
        http.get.side_effect = RuntimeError("boom")
        with self.assertLogs(service._logger, level="INFO") as observed:
            with self.assertRaises(RuntimeError):
                service.resolve_voice_event(str(uuid.uuid4()), "cap", http=http)
        self.assertTrue(any("Leda voice event resolve" in line for line in observed.output))

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
            f"http://127.0.0.1:5057/internal/leda/voice-events/{event_id}",
            headers={"X-Leda-Session-Capability": "test-capability"},
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
            response = service.app.test_client().post("/leda/speak-live", json={"eventId": event_id}, headers={"X-Leda-Session-Capability": "test-capability"}, buffered=True)
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
            with self.assertLogs(service._logger, level="INFO") as observed:
                response = service.app.test_client().post("/leda/speak-live", json={"eventId": event_id}, headers={"X-Leda-Session-Capability": "test-capability"}, buffered=True)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data, b"\x12\x34\x56\x78")
        first_chunk = [line for line in observed.output if "first_chunk_elapsed_ms" in line]
        stream_end = [line for line in observed.output if "stream_end_elapsed_ms" in line]
        self.assertEqual(len(first_chunk), 1)
        self.assertEqual(len(stream_end), 1)
        # PW-011 M4: routine per-request timing, not a warning-worthy condition.
        self.assertTrue(first_chunk[0].startswith("INFO:"))
        self.assertTrue(stream_end[0].startswith("INFO:"))
        self.assertNotIn(event_id, first_chunk[0])
        self.assertNotIn(event_id, stream_end[0])

    def test_speak_live_closes_the_underlying_subscription_on_early_response_teardown(self):
        """V1 (voice-overlap): the HMI orb aborts the previous answer's fetch
        the instant a new voice event supersedes it
        (LedaVoiceAudioEngine.play -> cleanupActive -> abortController.abort()).
        The AudioCoordinator subscription behind /leda/speak-live must be
        released on that early teardown, exactly like a fully-drained stream
        already self-closes via AudioSubscription._next_chunk -- otherwise the
        subscriber slot (and the job's state) is never reaped, and
        consecutive/overlapping answers for the same owner can eventually
        exhaust real coordinator capacity. _pcm_stream_response's
        call_on_close only ever saw _timed_pcm_stream's own wrapping
        generator, never the inner AudioSubscription it wraps."""
        event_id = str(uuid.uuid4())
        event = {"id": event_id, "text": "answer", "question": "q", "expiresAt": 9999999999}
        subscription = Mock()
        subscription.__iter__ = Mock(return_value=iter([b"\x12\x34", b"\x56\x78"]))
        coordinator = Mock()
        coordinator.subscribe.return_value = subscription
        with patch.object(service, "resolve_voice_event", return_value=event), patch.object(service, "audio_coordinator", coordinator):
            response = service.app.test_client().post(
                "/leda/speak-live",
                json={"eventId": event_id},
                headers={"X-Leda-Session-Capability": "test-capability"},
                buffered=False,
            )
            # Simulate the browser aborting mid-stream instead of reading to
            # completion: consume only the first chunk, then tear the
            # response down early -- exactly what an aborted fetch does.
            next(iter(response.response))
            response.close()
        subscription.close.assert_called_once_with()

    def test_speak_live_rejects_a_non_answer_kind_event_before_ever_subscribing(self):
        """voice-ux U1: a thinking/cancel signal event must never be able to
        trigger TTS generation via /leda/speak-live."""
        event_id = str(uuid.uuid4())
        coordinator = Mock()
        for kind in ("thinking", "cancel"):
            with self.subTest(kind=kind):
                event = {"id": event_id, "text": "", "question": "", "expiresAt": 9999999999, "kind": kind}
                with patch.object(service, "resolve_voice_event", return_value=event), patch.object(service, "audio_coordinator", coordinator):
                    response = service.app.test_client().post(
                        "/leda/speak-live",
                        json={"eventId": event_id},
                        headers={"X-Leda-Session-Capability": "test-capability"},
                    )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json()["error"], "INVALID_VOICE_EVENT_REQUEST")
        coordinator.subscribe.assert_not_called()

    def test_prefetch_rejects_a_non_answer_kind_event_before_ever_subscribing(self):
        """voice-ux U1: same guard on the prefetch route -- a thinking/cancel
        signal must never start (or admit into) a generation either."""
        event_id = str(uuid.uuid4())
        coordinator = Mock()
        for kind in ("thinking", "cancel"):
            with self.subTest(kind=kind):
                event = {"id": event_id, "text": "", "question": "", "expiresAt": 9999999999, "kind": kind}
                with patch.object(service, "resolve_voice_event", return_value=event), patch.object(service, "audio_coordinator", coordinator):
                    response = service.app.test_client().post(
                        "/internal/leda/prefetch",
                        json={"eventId": event_id},
                        headers={"X-Leda-Session-Capability": "cap"},
                    )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json()["error"], "INVALID_VOICE_EVENT_REQUEST")
        coordinator.subscribe.assert_not_called()

    def test_speak_live_logs_the_admission_rejection_reason(self):
        """V2 (voice-overlap): a rejected admission was never logged at all,
        so the reported live incident's exact rejection reason was
        unrecoverable from the log. No event id, owner id or secret."""
        event_id = str(uuid.uuid4())
        event = {"id": event_id, "text": "answer", "question": "q", "expiresAt": 9999999999}
        coordinator = Mock()
        coordinator.subscribe.side_effect = service.AudioCapacityError("VOICE_CAPACITY_EXCEEDED")
        with patch.object(service, "resolve_voice_event", return_value=event), patch.object(service, "audio_coordinator", coordinator):
            with self.assertLogs(service._logger, level="WARNING") as observed:
                response = service.app.test_client().post(
                    "/leda/speak-live",
                    json={"eventId": event_id},
                    headers={"X-Leda-Session-Capability": "test-capability"},
                )
        self.assertEqual(response.status_code, 503)
        rejection_lines = [line for line in observed.output if "admission rejected" in line]
        self.assertEqual(len(rejection_lines), 1)
        self.assertIn("VOICE_CAPACITY_EXCEEDED", rejection_lines[0])
        self.assertTrue(rejection_lines[0].startswith("WARNING:"))
        self.assertNotIn(event_id, rejection_lines[0])

    def test_prefetch_logs_the_admission_rejection_reason(self):
        """V2 (voice-overlap): same logging contract on the prefetch route."""
        event_id = str(uuid.uuid4())
        event = {"id": event_id, "text": "answer", "question": "q", "expiresAt": 9999999999}
        coordinator = Mock()
        coordinator.subscribe.side_effect = service.AudioCapacityError("VOICE_CAPACITY_EXCEEDED")
        with patch.object(service, "resolve_voice_event", return_value=event), patch.object(service, "audio_coordinator", coordinator):
            with self.assertLogs(service._logger, level="WARNING") as observed:
                response = service.app.test_client().post(
                    "/internal/leda/prefetch",
                    json={"eventId": event_id},
                    headers={"X-Leda-Session-Capability": "cap"},
                )
        self.assertEqual(response.status_code, 503)
        rejection_lines = [line for line in observed.output if "admission rejected" in line]
        self.assertEqual(len(rejection_lines), 1)
        self.assertIn("VOICE_CAPACITY_EXCEEDED", rejection_lines[0])
        self.assertNotIn(event_id, rejection_lines[0])

    def test_prefetch_requires_a_capability(self):
        response = service.app.test_client().post("/internal/leda/prefetch", json={"eventId": str(uuid.uuid4())})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "LEDA_SESSION_REQUIRED")

    def test_prefetch_rejects_malformed_bodies(self):
        for body in ({}, {"eventId": 1}, {"eventId": "x", "extra": 1}):
            with self.subTest(body=body):
                response = service.app.test_client().post("/internal/leda/prefetch", json=body, headers={"X-Leda-Session-Capability": "cap"})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json()["error"], "INVALID_VOICE_EVENT_REQUEST")

    def test_prefetch_admits_a_subscription_then_closes_it_immediately(self):
        """T10 unit 3: prefetch triggers generation via the exact same
        resolve+admit path as /leda/speak-live, then releases its own
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
            response = service.app.test_client().post("/internal/leda/prefetch", json={"eventId": event_id}, headers={"X-Leda-Session-Capability": "cap"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"ok": True})
        coordinator.subscribe.assert_called_once()
        subscription.close.assert_called_once_with()

    def test_prefetch_maps_admission_errors_the_same_way_speak_live_does(self):
        event_id = str(uuid.uuid4())
        cases = (
            (LookupError("VOICE_EVENT_NOT_FOUND"), 404, "VOICE_EVENT_NOT_FOUND"),
            (service.VoiceSessionUnauthorized("LEDA_SESSION_REQUIRED"), 401, "LEDA_SESSION_REQUIRED"),
            (service.GeminiCredentialUnavailable("GEMINI_CREDENTIAL_UNAVAILABLE"), 503, "GEMINI_CREDENTIAL_UNAVAILABLE"),
            (service.AudioCapacityError("VOICE_SUBSCRIBER_LIMIT"), 429, "VOICE_SUBSCRIBER_LIMIT"),
            (RuntimeError("boom"), 503, "VOICE_SERVICE_UNAVAILABLE"),
        )
        for error, expected_status, expected_body in cases:
            with self.subTest(error=type(error).__name__):
                with patch.object(service, "resolve_voice_event", side_effect=error):
                    response = service.app.test_client().post("/internal/leda/prefetch", json={"eventId": event_id}, headers={"X-Leda-Session-Capability": "cap"})
                self.assertEqual(response.status_code, expected_status)
                self.assertEqual(response.get_json()["error"], expected_body)

    def test_channel_b_voice_reply_requires_a_capability(self):
        response = service.app.test_client().post("/internal/leda/channel-b/telegram-voice-reply")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "LEDA_SESSION_REQUIRED")

    def test_channel_b_voice_reply_resolves_the_token_then_delivers_and_never_touches_voice_events(self):
        """B1: the new internal call never reaches AudioCoordinator or the
        shared voice_events store -- only _create_interactions_tts_job +
        _generate_tts_audio, the exact same pipeline Channel A's
        telegramChatId path already exercises."""
        payload = {"chatId": 995701520, "text": "El OEE actual es 88,6 %.", "replyToMessageId": 55}
        captured = {}

        def fake_generate(job):
            captured["job"] = job
            yield b"pcm-chunk"

        # Job creation starts the "record_voice" chat-action indicator as
        # soon as a valid chat id is present, independent of the mocked
        # generator below -- _telegram_post and the token must both be
        # controlled here so this test never resolves or dispatches a real
        # Telegram credential (see LEDA_LOCAL_TELEGRAM_BOT_TOKEN).
        with patch.dict(os.environ, {"LEDA_LOCAL_TELEGRAM_ENABLED": "1", "LEDA_LOCAL_TELEGRAM_BOT_TOKEN": "test-token"}), \
                patch.object(service, "_telegram_post"), \
                patch.object(service, "_resolve_channel_b_voice_reply_payload", return_value=payload) as resolve, \
                patch.object(service, "_generate_tts_audio", side_effect=fake_generate), \
                patch.object(service, "audio_coordinator") as coordinator:
            response = service.app.test_client().post(
                "/internal/leda/channel-b/telegram-voice-reply",
                headers={"X-Leda-Session-Capability": "channel-b-token"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"ok": True})
        resolve.assert_called_once_with("channel-b-token")
        coordinator.subscribe.assert_not_called()
        self.assertEqual(captured["job"]["text"], "El OEE actual es 88,6 %.")
        self.assertEqual(captured["job"]["telegram_chat_id"], 995701520)
        self.assertEqual(captured["job"]["telegram_reply_to_message_id"], 55)

    def test_channel_b_voice_reply_maps_resolve_failures(self):
        cases = (
            (service.VoiceSessionUnauthorized("LEDA_SESSION_REQUIRED"), 401, "LEDA_SESSION_REQUIRED"),
            (RuntimeError("CHANNEL_B_VOICE_REPLY_LOOKUP_UNAVAILABLE"), 503, "CHANNEL_B_VOICE_REPLY_LOOKUP_UNAVAILABLE"),
        )
        for error, expected_status, expected_body in cases:
            with self.subTest(error=type(error).__name__):
                with patch.object(service, "_resolve_channel_b_voice_reply_payload", side_effect=error):
                    response = service.app.test_client().post(
                        "/internal/leda/channel-b/telegram-voice-reply",
                        headers={"X-Leda-Session-Capability": "channel-b-token"},
                    )
                self.assertEqual(response.status_code, expected_status)
                self.assertEqual(response.get_json()["error"], expected_body)

    def test_channel_b_voice_reply_swallows_a_synthesis_failure_without_sending_anything(self):
        """A synthesis/delivery failure is a fire-and-forget background call
        from presentation: it must never crash the route, and the chat must
        never receive a voice message or an error reply -- delivery only
        ever happens inside _generate_tts_audio's own success path, which we
        never reach here (the chat-action indicator legitimately still
        fires -- see _start_telegram_recording_indicator -- so only the
        absence of a sendVoice/sendDocument call is asserted)."""
        payload = {"chatId": 995701520, "text": "answer", "replyToMessageId": None}
        with patch.dict(os.environ, {"LEDA_LOCAL_TELEGRAM_ENABLED": "1", "LEDA_LOCAL_TELEGRAM_BOT_TOKEN": "test-token"}), \
                patch.object(service, "_resolve_channel_b_voice_reply_payload", return_value=payload), \
                patch.object(service, "_generate_tts_audio", side_effect=service.LedaTtsProviderError("boom")), \
                patch.object(service, "_telegram_post") as telegram_post:
            response = service.app.test_client().post(
                "/internal/leda/channel-b/telegram-voice-reply",
                headers={"X-Leda-Session-Capability": "channel-b-token"},
            )
        self.assertEqual(response.status_code, 502)
        delivery_calls = [call for call in telegram_post.call_args_list if "sendVoice" in call.args[0] or "sendDocument" in call.args[0]]
        self.assertEqual(delivery_calls, [])

    def test_resolve_channel_b_voice_reply_payload_round_trip(self):
        response = Mock(status_code=200)
        response.json.return_value = {"chatId": 995701520, "text": "answer", "replyToMessageId": 55}
        http = Mock()
        http.get.return_value = response

        payload = service._resolve_channel_b_voice_reply_payload("channel-b-token", http=http)

        self.assertEqual(payload, {"chatId": 995701520, "text": "answer", "replyToMessageId": 55})
        http.get.assert_called_once_with(
            "http://127.0.0.1:5057/internal/leda/channel-b/voice-reply",
            headers={"X-Leda-Session-Capability": "channel-b-token"},
            timeout=2,
            allow_redirects=False,
        )
        response.close.assert_called_once_with()

    def test_resolve_channel_b_voice_reply_payload_rejects_unauthorized_and_malformed(self):
        unauthorized = Mock(status_code=401)
        http = Mock(get=Mock(return_value=unauthorized))
        with self.assertRaises(service.VoiceSessionUnauthorized):
            service._resolve_channel_b_voice_reply_payload("bad-token", http=http)

        for body in ({"chatId": "not-an-int", "text": "a"}, {"chatId": 7, "text": ""}, {"chatId": 7, "text": "a", "replyToMessageId": "x"}, []):
            with self.subTest(body=body):
                response = Mock(status_code=200)
                response.json.return_value = body
                http = Mock(get=Mock(return_value=response))
                with self.assertRaises(RuntimeError):
                    service._resolve_channel_b_voice_reply_payload("token", http=http)

    def test_http_response_close_releases_unstarted_audio_subscription(self):
        stream = Mock()
        stream.__iter__ = Mock(return_value=iter(()))
        response = service._pcm_stream_response(lambda: stream)

        response.close()
        response.close()

        self.assertGreaterEqual(stream.close.call_count, 1)

    def test_voice_transcription_requires_a_capability(self):
        response = service.app.test_client().post("/internal/leda/voice-transcription")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "LEDA_SESSION_REQUIRED")

    def test_voice_transcription_resolves_decodes_and_returns_the_transcript(self):
        payload = {"audioBase64": "YXVkaW8=", "mimeType": "audio/ogg", "extraTerms": ["Prensa 3"]}
        with patch.object(service, "_resolve_voice_transcription_payload", return_value=payload) as resolve, \
                patch.object(service, "get_gemini_client", return_value="fake-client") as get_client, \
                patch.object(service, "transcribe_voice_note", return_value="lote 42") as transcribe:
            response = service.app.test_client().post(
                "/internal/leda/voice-transcription",
                headers={"X-Leda-Session-Capability": "transcription-token"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"ok": True, "transcript": "lote 42"})
        resolve.assert_called_once_with("transcription-token")
        get_client.assert_called_once_with()
        transcribe.assert_called_once_with("fake-client", b"audio", "audio/ogg", extra_terms=["Prensa 3"])

    def test_voice_transcription_maps_resolve_failures(self):
        cases = (
            (service.VoiceSessionUnauthorized("LEDA_SESSION_REQUIRED"), 401, "LEDA_SESSION_REQUIRED"),
            (RuntimeError("VOICE_TRANSCRIPTION_LOOKUP_UNAVAILABLE"), 503, "VOICE_TRANSCRIPTION_LOOKUP_UNAVAILABLE"),
        )
        for error, expected_status, expected_body in cases:
            with self.subTest(error=type(error).__name__):
                with patch.object(service, "_resolve_voice_transcription_payload", side_effect=error):
                    response = service.app.test_client().post(
                        "/internal/leda/voice-transcription",
                        headers={"X-Leda-Session-Capability": "transcription-token"},
                    )
                self.assertEqual(response.status_code, expected_status)
                self.assertEqual(response.get_json()["error"], expected_body)

    def test_voice_transcription_rejects_invalid_base64(self):
        payload = {"audioBase64": "not-valid-base64!!", "mimeType": "audio/ogg", "extraTerms": []}
        with patch.object(service, "_resolve_voice_transcription_payload", return_value=payload):
            response = service.app.test_client().post(
                "/internal/leda/voice-transcription",
                headers={"X-Leda-Session-Capability": "transcription-token"},
            )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "INVALID_VOICE_TRANSCRIPTION_REQUEST")

    def test_voice_transcription_maps_missing_gemini_credential(self):
        payload = {"audioBase64": "YXVkaW8=", "mimeType": "audio/ogg", "extraTerms": []}
        with patch.object(service, "_resolve_voice_transcription_payload", return_value=payload), \
                patch.object(service, "get_gemini_client", side_effect=service.GeminiCredentialUnavailable("x")):
            response = service.app.test_client().post(
                "/internal/leda/voice-transcription",
                headers={"X-Leda-Session-Capability": "transcription-token"},
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "GEMINI_CREDENTIAL_UNAVAILABLE")

    def test_voice_transcription_maps_empty_transcript_to_422(self):
        payload = {"audioBase64": "YXVkaW8=", "mimeType": "audio/ogg", "extraTerms": []}
        with patch.object(service, "_resolve_voice_transcription_payload", return_value=payload), \
                patch.object(service, "get_gemini_client", return_value="fake-client"), \
                patch.object(service, "transcribe_voice_note", side_effect=service.VoiceTranscriptionEmpty("x")):
            response = service.app.test_client().post(
                "/internal/leda/voice-transcription",
                headers={"X-Leda-Session-Capability": "transcription-token"},
            )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.get_json()["error"], "VOICE_NOTE_TRANSCRIPT_EMPTY")

    def test_voice_transcription_maps_provider_failure_to_502(self):
        payload = {"audioBase64": "YXVkaW8=", "mimeType": "audio/ogg", "extraTerms": []}
        with patch.object(service, "_resolve_voice_transcription_payload", return_value=payload), \
                patch.object(service, "get_gemini_client", return_value="fake-client"), \
                patch.object(service, "transcribe_voice_note", side_effect=service.VoiceTranscriptionUnavailable("x")):
            response = service.app.test_client().post(
                "/internal/leda/voice-transcription",
                headers={"X-Leda-Session-Capability": "transcription-token"},
            )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json()["error"], "VOICE_TRANSCRIPTION_UNAVAILABLE")

    def test_voice_transcription_provider_failure_logs_elapsed_ms(self):
        """F2 (live test 2026-09-25): every transcription failure/timeout must
        log its elapsed time (never a secret) so a slow provider call is
        diagnosable from the log alone."""
        payload = {"audioBase64": "YXVkaW8=", "mimeType": "audio/ogg", "extraTerms": []}
        with patch.object(service, "_resolve_voice_transcription_payload", return_value=payload), \
                patch.object(service, "get_gemini_client", return_value="fake-client"), \
                patch.object(service, "transcribe_voice_note", side_effect=service.VoiceTranscriptionUnavailable("x")):
            with self.assertLogs(service._logger, level="WARNING") as captured:
                service.app.test_client().post(
                    "/internal/leda/voice-transcription",
                    headers={"X-Leda-Session-Capability": "transcription-token"},
                )
        joined = "\n".join(captured.output)
        self.assertIn("elapsed_ms", joined)
        self.assertNotIn("YXVkaW8=", joined)

    def test_voice_transcription_empty_transcript_logs_elapsed_ms(self):
        payload = {"audioBase64": "YXVkaW8=", "mimeType": "audio/ogg", "extraTerms": []}
        with patch.object(service, "_resolve_voice_transcription_payload", return_value=payload), \
                patch.object(service, "get_gemini_client", return_value="fake-client"), \
                patch.object(service, "transcribe_voice_note", side_effect=service.VoiceTranscriptionEmpty("x")):
            with self.assertLogs(service._logger, level="WARNING") as captured:
                service.app.test_client().post(
                    "/internal/leda/voice-transcription",
                    headers={"X-Leda-Session-Capability": "transcription-token"},
                )
        joined = "\n".join(captured.output)
        self.assertIn("elapsed_ms", joined)

    def test_resolve_voice_transcription_payload_round_trip(self):
        response = Mock(status_code=200)
        response.json.return_value = {"audioBase64": "YXVkaW8=", "mimeType": "audio/ogg", "extraTerms": ["Prensa 3"]}
        http = Mock()
        http.get.return_value = response

        payload = service._resolve_voice_transcription_payload("transcription-token", http=http)

        self.assertEqual(payload, {"audioBase64": "YXVkaW8=", "mimeType": "audio/ogg", "extraTerms": ["Prensa 3"]})
        http.get.assert_called_once_with(
            "http://127.0.0.1:5057/internal/leda/voice-transcription",
            headers={"X-Leda-Session-Capability": "transcription-token"},
            timeout=2,
            allow_redirects=False,
        )
        response.close.assert_called_once_with()

    def test_resolve_voice_transcription_payload_rejects_unauthorized_and_malformed(self):
        unauthorized = Mock(status_code=401)
        http = Mock(get=Mock(return_value=unauthorized))
        with self.assertRaises(service.VoiceSessionUnauthorized):
            service._resolve_voice_transcription_payload("bad-token", http=http)

        for body in (
            {"audioBase64": "", "mimeType": "audio/ogg", "extraTerms": []},
            {"audioBase64": "YXVkaW8=", "mimeType": "", "extraTerms": []},
            {"audioBase64": "YXVkaW8=", "mimeType": "audio/ogg", "extraTerms": "not-a-list"},
            [],
        ):
            with self.subTest(body=body):
                response = Mock(status_code=200)
                response.json.return_value = body
                http = Mock(get=Mock(return_value=response))
                with self.assertRaises(RuntimeError):
                    service._resolve_voice_transcription_payload("token", http=http)

    def test_boot_warm_up_builds_the_client_and_performs_one_real_network_touch(self):
        """F2 (live test 2026-09-25): building the client object alone never
        opens a real TCP/TLS connection to Gemini -- the genai SDK's httpx
        client connects lazily on the first real call. Without a genuine
        network round trip here, the very first live request (often a
        voice-note transcription, user-facing) pays the full cold-connection
        cost instead of this best-effort boot warm-up. A cheap,
        non-generating client.models.get(...) lookup -- the same call
        GeminiVerificationService already uses to verify a key, consuming no
        generation quota -- forces that real connection now. main() must
        never block on Gemini reachability; this stays a plain, synchronous,
        already-safe delegation that main() runs on its own daemon thread
        (not exercised here)."""
        fake_client = Mock()
        with patch.object(service.gemini_credentials, "resolve", return_value="secret-value") as resolve, \
                patch.object(service._warm_gemini_client, "get", return_value=(fake_client, False)) as get:
            service._warm_up_gemini_client_in_background()
        resolve.assert_called_once_with()
        get.assert_called_once_with("secret-value")
        fake_client.models.get.assert_called_once_with(model=service.TTS_MODEL)

    def test_boot_warm_up_never_raises_when_credential_resolution_fails(self):
        with patch.object(service.gemini_credentials, "resolve", side_effect=service.GeminiCredentialUnavailable("x")):
            service._warm_up_gemini_client_in_background()  # must not raise

    def test_boot_warm_up_never_raises_when_the_client_build_fails(self):
        with patch.object(service.gemini_credentials, "resolve", return_value="secret-value"), \
                patch.object(service._warm_gemini_client, "get", side_effect=RuntimeError("boom")):
            service._warm_up_gemini_client_in_background()  # must not raise

    def test_boot_warm_up_never_raises_when_the_network_touch_fails(self):
        fake_client = Mock()
        fake_client.models.get.side_effect = RuntimeError("boom")
        with patch.object(service.gemini_credentials, "resolve", return_value="secret-value"), \
                patch.object(service._warm_gemini_client, "get", return_value=(fake_client, False)):
            service._warm_up_gemini_client_in_background()  # must not raise

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

        with patch.dict(os.environ, {"LEDA_LOCAL_TELEGRAM_ENABLED": "1", "LEDA_LOCAL_TELEGRAM_BOT_TOKEN": "test-token"}), patch.object(service, "_telegram_post", side_effect=responses) as telegram_post:
            service._send_same_leda_audio_to_telegram(job)

        self.assertEqual(telegram_post.call_count, 3)
        self.assertTrue(telegram_post.call_args_list[0].args[0].endswith("/sendVoice"))
        self.assertEqual(telegram_post.call_args_list[1].kwargs["files"]["document"][1], b"ogg-bytes")
        self.assertTrue(telegram_post.call_args_list[1].args[0].endswith("/sendDocument"))
        wav_upload = telegram_post.call_args_list[2].kwargs["files"]["document"][1]
        self.assertTrue(telegram_post.call_args_list[2].args[0].endswith("/sendDocument"))
        with wave.open(BytesIO(wav_upload), "rb") as wav_file:
            self.assertEqual(wav_file.readframes(wav_file.getnframes()), processed_pcm)

    def test_telegram_delivery_replies_to_the_question_message_when_present(self):
        """B1: Channel B's voice note must reply to the user's question
        message so text and audio stay paired under overlapping questions."""
        encoder = Mock()
        encoder.finish_and_get.return_value = b"ogg-bytes"
        job = {
            "telegram_chat_id": 995701520,
            "telegram_reply_to_message_id": 55,
            "telegram_encoder": encoder,
            "telegram_pcm_parts": [b"pcm"],
            "cancelled": Mock(is_set=Mock(return_value=False)),
            "event_id": "same-audio",
        }
        with patch.dict(os.environ, {"LEDA_LOCAL_TELEGRAM_ENABLED": "1", "LEDA_LOCAL_TELEGRAM_BOT_TOKEN": "test-token"}), \
                patch.object(service, "_telegram_post", return_value=Mock(ok=True, status_code=200)) as telegram_post:
            service._send_same_leda_audio_to_telegram(job)
        self.assertEqual(telegram_post.call_args_list[0].kwargs["data"]["reply_to_message_id"], 55)

    def test_telegram_delivery_omits_reply_to_message_id_when_absent(self):
        encoder = Mock()
        encoder.finish_and_get.return_value = b"ogg-bytes"
        job = {
            "telegram_chat_id": 995701520,
            "telegram_encoder": encoder,
            "telegram_pcm_parts": [b"pcm"],
            "cancelled": Mock(is_set=Mock(return_value=False)),
            "event_id": "same-audio",
        }
        with patch.dict(os.environ, {"LEDA_LOCAL_TELEGRAM_ENABLED": "1", "LEDA_LOCAL_TELEGRAM_BOT_TOKEN": "test-token"}), \
                patch.object(service, "_telegram_post", return_value=Mock(ok=True, status_code=200)) as telegram_post:
            service._send_same_leda_audio_to_telegram(job)
        self.assertNotIn("reply_to_message_id", telegram_post.call_args_list[0].kwargs["data"])

    def test_job_creation_validates_and_stores_the_reply_to_message_id(self):
        valid = service._create_interactions_tts_job("text", telegram_reply_to_message_id=55)
        self.assertEqual(valid["telegram_reply_to_message_id"], 55)
        for invalid in (0, -1, True, "55", None):
            with self.subTest(value=invalid):
                job = service._create_interactions_tts_job("text", telegram_reply_to_message_id=invalid)
                self.assertIsNone(job["telegram_reply_to_message_id"])

    def test_telegram_token_resolves_from_the_protected_credential_store_in_protected_mode(self):
        """F1 (live test 2026-09-25): telegram_token() alone always returns ""
        in protected mode (LEDA_CREDENTIAL_MASTER_KEY_FILE set) -- this is
        what silently cancelled every Channel B voice-note reply job. The
        voice process must resolve the SAME "telegram" secret the
        presentation process's own Channel B bot construction reads."""
        with patch.dict(os.environ, {"LEDA_LOCAL_TELEGRAM_ENABLED": "1", "LEDA_CREDENTIAL_MASTER_KEY_FILE": "C:/protected/key"}), \
                patch.object(service.telegram_credentials, "resolve", return_value="protected-token") as resolve:
            token = service._telegram_token()
        self.assertEqual(token, "protected-token")
        resolve.assert_called_once_with()

    def test_telegram_token_returns_empty_and_logs_a_warning_when_the_protected_store_has_no_secret(self):
        with patch.dict(os.environ, {"LEDA_LOCAL_TELEGRAM_ENABLED": "1", "LEDA_CREDENTIAL_MASTER_KEY_FILE": "C:/protected/key"}), \
                patch.object(service.telegram_credentials, "resolve", side_effect=service.TelegramCredentialError("TELEGRAM_CREDENTIAL_MISSING")):
            with self.assertLogs(service._logger, level="WARNING") as captured:
                token = service._telegram_token()
        self.assertEqual(token, "")
        joined = "\n".join(captured.output)
        self.assertIn("WARNING", joined)
        self.assertNotIn("protected-token", joined)

    def test_telegram_token_stays_empty_when_not_enabled_even_in_protected_mode(self):
        with patch.dict(os.environ, {"LEDA_CREDENTIAL_MASTER_KEY_FILE": "C:/protected/key"}, clear=True), \
                patch.object(service.telegram_credentials, "resolve") as resolve:
            token = service._telegram_token()
        self.assertEqual(token, "")
        resolve.assert_not_called()

    def test_telegram_token_reads_the_environment_value_directly_when_not_protected(self):
        with patch.dict(os.environ, {"LEDA_LOCAL_TELEGRAM_ENABLED": "1", "LEDA_LOCAL_TELEGRAM_BOT_TOKEN": "env-token"}), \
                patch.object(service.telegram_credentials, "resolve") as resolve:
            token = service._telegram_token()
        self.assertEqual(token, "env-token")
        resolve.assert_not_called()

    def test_send_same_leda_audio_to_telegram_logs_a_warning_when_cancelled_for_a_missing_token(self):
        job = {
            "telegram_chat_id": 995701520,
            "telegram_encoder": None,
            "telegram_pcm_parts": [b"pcm"],
            "cancelled": Mock(is_set=Mock(return_value=False)),
            "telegram_chat_action_stop": threading.Event(),
            "event_id": "missing-token",
        }
        with patch.dict(os.environ, {}, clear=True), patch.object(service, "_telegram_post") as telegram_post:
            with self.assertLogs(service._logger, level="WARNING") as captured:
                service._send_same_leda_audio_to_telegram(job)
        telegram_post.assert_not_called()
        joined = "\n".join(captured.output)
        self.assertIn("WARNING", joined)
        self.assertIn("missing-token", joined)

    def test_send_same_leda_audio_to_telegram_logs_a_warning_when_every_delivery_attempt_fails(self):
        encoder = Mock()
        encoder.finish_and_get.return_value = b"ogg-bytes"
        job = {
            "telegram_chat_id": 995701520,
            "telegram_encoder": encoder,
            "telegram_pcm_parts": [b"pcm"],
            "cancelled": Mock(is_set=Mock(return_value=False)),
            "event_id": "exhausted",
        }
        with patch.dict(os.environ, {"LEDA_LOCAL_TELEGRAM_ENABLED": "1", "LEDA_LOCAL_TELEGRAM_BOT_TOKEN": "test-token"}), \
                patch.object(service, "_telegram_post", return_value=Mock(ok=False, status_code=500)):
            with self.assertLogs(service._logger, level="WARNING") as captured:
                service._send_same_leda_audio_to_telegram(job)
        joined = "\n".join(captured.output)
        self.assertIn("WARNING", joined)
        self.assertNotIn("test-token", joined)

    def test_telegram_chat_action_sends_record_voice_when_a_protected_mode_token_resolves(self):
        """F6 (live test 2026-09-25): proves F1's protected-mode token fix
        and the existing record_voice chat-action indicator (Channel B's
        voice-reply pipeline; unrelated to F6's own Channel B typing
        indicator, which lives on the presentation process) compose
        correctly -- this is the exact call _start_telegram_recording_
        indicator's background worker makes on every tick."""
        with patch.dict(os.environ, {"LEDA_LOCAL_TELEGRAM_ENABLED": "1", "LEDA_CREDENTIAL_MASTER_KEY_FILE": "C:/protected/key"}), \
                patch.object(service.telegram_credentials, "resolve", return_value="protected-token"), \
                patch.object(service, "_telegram_post", return_value=Mock(ok=True)) as telegram_post:
            result = service._telegram_chat_action(995701520, "record_voice")
        self.assertTrue(result)
        telegram_post.assert_called_once_with(
            "https://api.telegram.org/botprotected-token/sendChatAction",
            data={"chat_id": "995701520", "action": "record_voice"},
            timeout=5,
        )

    def test_recording_indicator_actually_starts_in_protected_mode_once_a_token_resolves(self):
        """F6: before F1's fix, _telegram_token() always returned "" in
        protected mode, so this indicator (gated on it) never started at
        all for Channel B -- proves the gate now opens once the protected
        store resolves a token."""
        job = {
            "telegram_chat_id": 995701520,
            "telegram_chat_action_stop": threading.Event(),
            "event_id": "protected-record-voice",
        }
        with patch.dict(os.environ, {"LEDA_LOCAL_TELEGRAM_ENABLED": "1", "LEDA_CREDENTIAL_MASTER_KEY_FILE": "C:/protected/key"}), \
                patch.object(service.telegram_credentials, "resolve", return_value="protected-token"), \
                patch.object(service.threading, "Thread") as thread_cls:
            service._start_telegram_recording_indicator(job)
        thread_cls.assert_called_once()
        thread_cls.return_value.start.assert_called_once_with()
        self.assertIs(job["telegram_action_thread"], thread_cls.return_value)

    def test_local_health_is_ready_but_provider_is_unconfigured_without_key(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(service, "get_gemini_client") as get_client:
            response = service.app.test_client().get("/health")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["service"], "leda-voice")
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
        with patch.dict(os.environ, {"GEMINI_API_KEY": "   "}, clear=True), patch.object(service, "get_gemini_client") as get_client, patch.object(service.leda_audio_sink, "emit") as emit:
            regular = service.app.test_client().post("/leda/speak", json={"text": "Status"})
            live = service.app.test_client().post("/leda/speak-live", json={"text": "Status"})
        self.assertEqual(regular.status_code, 410)
        self.assertEqual(regular.get_json()["error"], "RAW_TTS_DISABLED")
        self.assertEqual(live.status_code, 400)
        self.assertEqual(live.get_json()["error"], "INVALID_VOICE_EVENT_REQUEST")
        get_client.assert_not_called()
        emit.assert_not_called()

    def test_missing_key_does_not_change_empty_request_validation(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(service, "get_gemini_client") as get_client:
            regular = service.app.test_client().post("/leda/speak", json={})
            live = service.app.test_client().post("/leda/speak-live", json={})
        self.assertEqual(regular.status_code, 410)
        self.assertEqual(regular.get_json(), {"ok": False, "error": "RAW_TTS_DISABLED"})
        self.assertEqual(live.status_code, 400)
        self.assertEqual(live.get_json(), {"ok": False, "error": "INVALID_VOICE_EVENT_REQUEST"})
        get_client.assert_not_called()

    def test_job_creation_logs_elapsed_ms(self):
        with self.assertLogs(service._logger, level="INFO") as observed:
            service._create_interactions_tts_job("Some transcript")
        lines = [line for line in observed.output if "Leda TTS job create" in line]
        self.assertEqual(len(lines), 1)
        self.assertIn("elapsed_ms=", lines[0])
        self.assertNotIn("Some transcript", lines[0])
        # PW-011 M4: routine per-job timing, not a warning-worthy condition.
        self.assertTrue(lines[0].startswith("INFO:"))

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
                with self.assertRaisesRegex(service.LedaTtsFormatError, code):
                    service._decode_audio_inline_data(inline_data)

    def test_audio_inline_data_handles_bytes_and_base64_str_defensively(self):
        raw = b"\x12\x34\x56"
        self.assertEqual(service._decode_audio_inline_data(SimpleNamespace(data=raw, mime_type=None)), raw)
        encoded = base64.b64encode(raw).decode("ascii")
        self.assertEqual(service._decode_audio_inline_data(SimpleNamespace(data=encoded, mime_type=None)), raw)

    def test_audio_inline_data_rejects_missing_or_empty_data(self):
        for data in (None, "", b""):
            with self.subTest(data=data):
                with self.assertRaises(service.LedaTtsFormatError):
                    service._decode_audio_inline_data(SimpleNamespace(data=data, mime_type=None))

    def test_get_gemini_client_logs_resolve_build_elapsed_ms_and_reused_flag(self):
        """T10 unit 1+2: split credential-resolve time from client-build time,
        and report whether the T10-unit-2 warm client cache was reused."""
        fake_client = object()
        with patch.object(service.gemini_credentials, "resolve", return_value="secret-value") as resolve, \
                patch.object(service._warm_gemini_client, "get", return_value=(fake_client, True)) as warm_get:
            with self.assertLogs(service._logger, level="INFO") as observed:
                result = service.get_gemini_client()
        self.assertIs(result, fake_client)
        resolve.assert_called_once_with()
        warm_get.assert_called_once_with("secret-value")
        lines = [line for line in observed.output if "Leda Gemini client:" in line]
        self.assertEqual(len(lines), 1)
        self.assertIn("resolve_elapsed_ms=", lines[0])
        self.assertIn("build_elapsed_ms=", lines[0])
        self.assertIn("reused=True", lines[0])
        self.assertNotIn("secret-value", lines[0])
        # PW-011 M4: routine per-call timing, not a warning-worthy condition.
        self.assertTrue(lines[0].startswith("INFO:"))

    def test_generate_tts_audio_never_closes_the_warm_client(self):
        """T10 unit 2: the client is a shared warm singleton now, so neither
        an ordinary completion nor a cancellation may close it; only the
        per-request stream and idle guard are ever closed."""
        stream = FakeStream([audio_chunk(b"\x12\x34")])
        client = FakeClient([stream])
        control = GenerationControl()
        with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "LedaStreamingDSP", IdentityDsp), patch.object(service, "_queue_same_leda_audio_to_telegram"):
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
        with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "LedaStreamingDSP", IdentityDsp), patch.object(service, "_queue_same_leda_audio_to_telegram"):
            job = service._create_interactions_tts_job("Lazy transcript")
            with self.assertLogs(service._logger, level="INFO") as observed:
                output = service._generate_tts_audio(job)
                self.assertEqual(next(output), b"\x12\x34")
                self.assertEqual(list(output), [])
        first_byte = [line for line in observed.output if "time_to_first_byte_ms" in line]
        first_yield = [line for line in observed.output if "first_yield_processing_elapsed_ms" in line]
        self.assertEqual(len(first_byte), 1)
        self.assertEqual(len(first_yield), 1)
        # PW-011 M4: routine per-request timing, not a warning-worthy condition.
        self.assertTrue(first_byte[0].startswith("INFO:"))
        self.assertTrue(first_yield[0].startswith("INFO:"))
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
            with self.assertLogs(service._logger, level="INFO") as observed:
                response = service.app.test_client().post("/leda/speak-live", json={"eventId": event_id}, headers={"X-Leda-Session-Capability": "test-capability"}, buffered=True)
                self.assertEqual(response.status_code, 200)
        lines = [line for line in observed.output if "event_publish_to_received_ms" in line]
        self.assertEqual(len(lines), 1)
        self.assertNotIn(event_id, lines[0])
        self.assertNotIn("event_publish_to_received_ms=None", lines[0])
        # PW-011 M4: routine per-request timing, not a warning-worthy condition.
        self.assertTrue(lines[0].startswith("INFO:"))

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
                    with self.assertLogs(service._logger, level="INFO") as observed:
                        response = service.app.test_client().post("/leda/speak-live", json={"eventId": event_id}, headers={"X-Leda-Session-Capability": "test-capability"}, buffered=True)
                        self.assertEqual(response.status_code, 200)
                lines = [line for line in observed.output if "event_publish_to_received_ms" in line]
                self.assertEqual(len(lines), 1)
                self.assertIn("event_publish_to_received_ms=None", lines[0])

    def test_stream_yields_first_post_dsp_chunk_before_completion(self):
        stream = FakeStream([audio_chunk(b"\x12\x34")])
        client = FakeClient([stream])
        with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "LedaStreamingDSP", IdentityDsp), patch.object(service, "_queue_same_leda_audio_to_telegram"):
            job = service._create_interactions_tts_job("Lazy transcript")
            output = service._generate_tts_audio(job)
            self.assertEqual(next(output), b"\x12\x34")
            self.assertEqual(list(output), [])
        self.assertEqual(stream.close_calls, 1)
        # T10 unit 2: the client is now a shared warm singleton, never closed
        # per-generation.
        self.assertEqual(client.close_calls, 0)
        self.assertFalse(any(thread.name == "LedaProviderIdleGuard" for thread in threading.enumerate()))

    def test_generation_control_runs_provider_and_job_cleanup_once(self):
        stream = FakeStream([audio_chunk(b"\x12\x34")])
        client = FakeClient([stream])
        control = GenerationControl()
        with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "LedaStreamingDSP", IdentityDsp), patch.object(service, "_queue_same_leda_audio_to_telegram"):
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
        with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "LedaStreamingDSP", IdentityDsp), patch.object(service, "_queue_same_leda_audio_to_telegram"):
            job_one = service._create_interactions_tts_job("Repeated transcript")
            first_output = list(service._generate_tts_audio(job_one))
            self.assertEqual(first_output, [b"\x12\x34\x56\x78"])

            job_two = service._create_interactions_tts_job("Repeated transcript")
            with self.assertLogs(service._logger, level="INFO") as observed:
                second_output = list(service._generate_tts_audio(job_two))
        self.assertEqual(second_output, [b"\x12\x34\x56\x78"])
        # Only the first job's stream was ever created; the SDK's
        # generate_content_stream was never called a second time.
        self.assertEqual(len(client.models.calls), 1)
        cache_hit_lines = [line for line in observed.output if "Leda TTS cache: hit" in line]
        self.assertEqual(len(cache_hit_lines), 1)
        # PW-011 M4: routine cache-stat noise, not a warning-worthy condition.
        self.assertTrue(cache_hit_lines[0].startswith("INFO:"))

    def test_different_text_or_voice_config_is_a_cache_miss(self):
        def run(text, config=None):
            stream = FakeStream([audio_chunk(b"\xaa\xbb")])
            client = FakeClient([stream])
            with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "LedaStreamingDSP", IdentityDsp), patch.object(service, "_queue_same_leda_audio_to_telegram"):
                job = service._create_interactions_tts_job(text, voice_config=config)
                list(service._generate_tts_audio(job))
            return client

        base_config = service.clone_json(service.DEFAULT_LEDA_VOICE_CONFIG)
        other_config = service.clone_json(service.DEFAULT_LEDA_VOICE_CONFIG)
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
        with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "LedaStreamingDSP", IdentityDsp), patch.object(service, "apply_leda_dsp_full_pcm", side_effect=lambda pcm, _config: pcm), patch.object(service, "_queue_same_leda_audio_to_telegram"):
            job = service._create_interactions_tts_job("Fallback transcript")
            self.assertEqual(list(service._generate_tts_audio(job)), [fallback])
        self.assertEqual(len(client.models.calls), 2)
        self.assertNotIn("stream", client.models.calls[1])
        self.assertEqual(client.models.calls[1]["model"], "gemini-3.8-flash-lite-tts")

    def test_stream_rejects_incomplete_pcm_without_fallback(self):
        stream = FakeStream([audio_chunk(b"\x7f")])
        client = FakeClient([stream])
        with patch.object(service, "get_gemini_client", return_value=client), patch.object(service, "LedaStreamingDSP", IdentityDsp):
            job = service._create_interactions_tts_job("Odd sample transcript")
            with self.assertRaisesRegex(service.LedaTtsFormatError, "INCOMPLETE_PCM_S16LE_SAMPLE"):
                list(service._generate_tts_audio(job))
        self.assertEqual(len(client.models.calls), 1)

    def test_local_endpoint_returns_canonical_pcm_metadata_without_provider_connection(self):
        event_id = str(uuid.uuid4())
        coordinator = Mock()
        coordinator.subscribe.return_value = iter([b"\x12\x34"])
        with patch.object(service, "resolve_voice_event", return_value={"id": event_id, "text": "answer", "expiresAt": 9999999999}), patch.object(service, "audio_coordinator", coordinator):
            response = service.app.test_client().post("/leda/speak-live", json={"eventId": event_id}, headers={"X-Leda-Session-Capability": "test-capability"}, buffered=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, b"\x12\x34")
        self.assertEqual(response.headers["X-Leda-Audio-Format"], "pcm_s16le")
        self.assertEqual(response.headers["X-Leda-Sample-Rate"], "24000")
        self.assertEqual(response.headers["X-Leda-Channels"], "1")
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_session_tts_responses_are_no_store_without_changing_unrelated_health(self):
        event_id = str(uuid.uuid4())
        coordinator = Mock()
        coordinator.subscribe.return_value = iter([b"\x12\x34"])
        with patch.object(service, "resolve_voice_event", return_value={"id": event_id, "text": "answer", "expiresAt": 9999999999}), patch.object(service, "audio_coordinator", coordinator):
            success = service.app.test_client().post(
                "/leda/speak-live",
                json={"eventId": event_id},
                headers={"X-Leda-Session-Capability": "test-capability"},
                buffered=True,
            )
        invalid = service.app.test_client().post("/leda/speak-live", json={})
        options = service.app.test_client().options("/leda/speak-live")
        method = service.app.test_client().get("/leda/speak-live")
        health = service.app.test_client().get("/health")

        for response in (success, invalid, options, method):
            self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertNotEqual(health.headers.get("Cache-Control"), "no-store")

    def test_local_config_update_is_atomic_and_strict(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = service.LedaVoiceConfigStore(Path(temporary) / "config.json")
            valid = service.clone_json(service.DEFAULT_LEDA_VOICE_CONFIG)
            invalid = service.clone_json(valid); invalid["unexpected"] = True
            store.update_local(valid)
            before = Path(temporary, "config.json").read_bytes()
            with self.assertRaises(ValueError):
                store.update_local(invalid)
            self.assertEqual(Path(temporary, "config.json").read_bytes(), before)

    # T4: playbackBuffer mode/manualSeconds -- config field, defaults,
    # validation bounds/step and backward-compatible defaulting of configs
    # persisted before this field existed.

    def test_default_config_carries_the_automatic_playback_buffer_default(self):
        self.assertEqual(
            service.DEFAULT_LEDA_VOICE_CONFIG["playbackBuffer"],
            {"mode": "automatic", "manualSeconds": 0.2},
        )

    def test_validate_accepts_a_manual_playback_buffer_on_the_grid(self):
        config = service.clone_json(service.DEFAULT_LEDA_VOICE_CONFIG)
        config["playbackBuffer"] = {"mode": "manual", "manualSeconds": 1.5}

        validated = service.validate_leda_voice_config(config)

        self.assertEqual(validated["playbackBuffer"], {"mode": "manual", "manualSeconds": 1.5})

    def test_validate_accepts_the_manual_seconds_boundaries(self):
        for manual_seconds in (0.1, 3.0):
            with self.subTest(manual_seconds=manual_seconds):
                config = service.clone_json(service.DEFAULT_LEDA_VOICE_CONFIG)
                config["playbackBuffer"] = {"mode": "manual", "manualSeconds": manual_seconds}
                validated = service.validate_leda_voice_config(config)
                self.assertEqual(validated["playbackBuffer"]["manualSeconds"], manual_seconds)

    def test_validate_rejects_a_missing_playback_buffer(self):
        config = service.clone_json(service.DEFAULT_LEDA_VOICE_CONFIG)
        del config["playbackBuffer"]

        with self.assertRaises(ValueError):
            service.validate_leda_voice_config(config)

    def test_validate_rejects_an_unsupported_playback_buffer_mode(self):
        config = service.clone_json(service.DEFAULT_LEDA_VOICE_CONFIG)
        config["playbackBuffer"] = {"mode": "fixed", "manualSeconds": 0.2}

        with self.assertRaises(ValueError):
            service.validate_leda_voice_config(config)

    def test_validate_rejects_manual_seconds_out_of_range(self):
        for manual_seconds in (0.05, 3.1):
            with self.subTest(manual_seconds=manual_seconds):
                config = service.clone_json(service.DEFAULT_LEDA_VOICE_CONFIG)
                config["playbackBuffer"] = {"mode": "manual", "manualSeconds": manual_seconds}
                with self.assertRaises(ValueError):
                    service.validate_leda_voice_config(config)

    def test_validate_rejects_manual_seconds_off_the_grid(self):
        config = service.clone_json(service.DEFAULT_LEDA_VOICE_CONFIG)
        config["playbackBuffer"] = {"mode": "manual", "manualSeconds": 0.25}

        with self.assertRaises(ValueError):
            service.validate_leda_voice_config(config)

    def test_validate_still_rejects_an_unexpected_top_level_field(self):
        """The T4 backward-compatible defaulting only backfills a MISSING
        playbackBuffer -- it must not become a loophole that tolerates
        arbitrary unknown top-level fields."""
        config = service.clone_json(service.DEFAULT_LEDA_VOICE_CONFIG)
        config["unexpected"] = True

        with self.assertRaises(ValueError):
            service.validate_leda_voice_config(config)

    def test_store_loads_a_legacy_config_file_without_playback_buffer_as_the_default(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "config.json"
            legacy = service.clone_json(service.DEFAULT_LEDA_VOICE_CONFIG)
            del legacy["playbackBuffer"]
            path.write_text(json.dumps(legacy), encoding="utf-8")

            store = service.LedaVoiceConfigStore(path)

            self.assertEqual(store.get()["playbackBuffer"], {"mode": "automatic", "manualSeconds": 0.2})
            # every other legacy field survives the migration untouched
            self.assertEqual(store.get()["preset"], legacy["preset"])
            self.assertEqual(store.get()["robotic"], legacy["robotic"])

    def test_store_update_local_defaults_a_legacy_candidate_missing_playback_buffer(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = service.LedaVoiceConfigStore(Path(temporary) / "config.json")
            legacy_candidate = service.clone_json(service.DEFAULT_LEDA_VOICE_CONFIG)
            del legacy_candidate["playbackBuffer"]

            updated = store.update_local(legacy_candidate)

            self.assertEqual(updated["playbackBuffer"], {"mode": "automatic", "manualSeconds": 0.2})
            persisted = json.loads(Path(temporary, "config.json").read_text(encoding="utf-8"))
            self.assertIn("playbackBuffer", persisted)


class MainStartupWiringTests(unittest.TestCase):
    def test_main_installs_access_log_query_redaction_before_app_run(self) -> None:
        """T13b should-fix (defense in depth): the query-string-redacting
        access log filter must be installed before Werkzeug's dev server
        starts logging requests, not after."""
        source = (RUNTIME_ROOT / "src" / "leda_runtime" / "voice_service.py").read_text(encoding="utf-8")
        main_start = source.index("\ndef main():")
        main_body = source[main_start:]
        self.assertIn("install_access_log_query_redaction()", main_body)
        self.assertLess(
            main_body.index("install_access_log_query_redaction()"),
            main_body.index("app.run("),
        )


if __name__ == "__main__":
    unittest.main()
