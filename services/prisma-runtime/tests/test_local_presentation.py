import json
import os
import sys
import tempfile
import threading
import time
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

    def test_local_ask_logs_the_voice_event_publish_elapsed_ms(self) -> None:
        """T5: the voice event publish duration for HMI voice queries."""
        import prisma_runtime.local_presentation as local_presentation_module

        with tempfile.TemporaryDirectory() as temporary:
            store = JsonFileStore(Path(temporary) / "snapshot.json")
            events = VoiceEventStore()
            client = create_app(store, events, None, **DISABLED_HTTP_OPTIONS).test_client()
            headers = session_headers(client)
            client.post("/hmi/current-snapshot", json={"version": 1, "command": "publish", "order": 1, "snapshot": demo_snapshot()}, headers=headers)
            with self.assertLogs(local_presentation_module._logger, level="WARNING") as observed:
                response = client.post("/local/ask", json={"question": "¿Cuál es el OEE?"}, headers=headers)
            self.assertEqual(response.status_code, 200)
            matching = [line for line in observed.output if "Prisma voice event publish: elapsed_ms=" in line]
            self.assertEqual(len(matching), 1)
            self.assertNotIn("OEE", matching[0])

    def test_local_ask_fires_a_background_prefetch_without_delaying_the_response(self) -> None:
        """T10 unit 3: /local/ask must trigger voice-service prefetch for its
        own freshly published event, on a background thread, carrying this
        exact request's own capability -- and never block on it."""
        import prisma_runtime.local_presentation as local_presentation_module

        fired = threading.Event()
        captured = {}

        def fake_prefetch(local_http, voice_url, event_id, capability):
            captured["event_id"] = event_id
            captured["capability"] = capability
            fired.set()

        with tempfile.TemporaryDirectory() as temporary:
            store = JsonFileStore(Path(temporary) / "snapshot.json")
            events = VoiceEventStore()
            client = create_app(store, events, None, **DISABLED_HTTP_OPTIONS).test_client()
            headers = session_headers(client)
            client.post("/hmi/current-snapshot", json={"version": 1, "command": "publish", "order": 1, "snapshot": demo_snapshot()}, headers=headers)
            with patch.object(local_presentation_module, "_fire_voice_prefetch", side_effect=fake_prefetch):
                response = client.post("/local/ask", json={"question": "¿Cuál es el OEE?"}, headers=headers)
        self.assertEqual(response.status_code, 200)
        event_id = response.get_json()["voiceEvent"]["id"]
        self.assertTrue(fired.wait(2), "prefetch was never fired")
        self.assertEqual(captured["event_id"], event_id)
        self.assertEqual(captured["capability"], headers["X-Prisma-Session-Capability"])

    def test_fire_voice_prefetch_posts_the_event_id_with_the_capability_header(self) -> None:
        import prisma_runtime.local_presentation as local_presentation_module

        local_http = Mock()
        local_presentation_module._fire_voice_prefetch(local_http, "http://127.0.0.1:5056", "event-one", "cap-one")

        local_http.post.assert_called_once_with(
            "http://127.0.0.1:5056/internal/prisma/prefetch",
            json={"eventId": "event-one"},
            headers={"X-Prisma-Session-Capability": "cap-one"},
            timeout=3,
        )

    def test_fire_voice_prefetch_swallows_every_exception(self) -> None:
        import prisma_runtime.local_presentation as local_presentation_module

        local_http = Mock()
        local_http.post.side_effect = requests.RequestException("boom")

        local_presentation_module._fire_voice_prefetch(local_http, "http://127.0.0.1:5056", "event-one", "cap-one")  # must not raise

    def test_fire_channel_a_voice_prefetch_starts_a_background_thread(self) -> None:
        """T13 unit (b): reuses _fire_voice_prefetch's own transport/route on
        its own background thread, never inline, never blocking the caller
        (the Channel A poll loop)."""
        import prisma_runtime.local_presentation as local_presentation_module

        fired = threading.Event()
        captured = {}

        def fake_prefetch(local_http, voice_url, event_id, token):
            captured["event_id"] = event_id
            captured["token"] = token
            fired.set()

        local_http = Mock()
        with patch.object(local_presentation_module, "_fire_voice_prefetch", side_effect=fake_prefetch):
            local_presentation_module._fire_channel_a_voice_prefetch(local_http, "http://127.0.0.1:5056", "event-one", "token-one")

        self.assertTrue(fired.wait(2), "channel A prefetch was never fired")
        self.assertEqual(captured["event_id"], "event-one")
        self.assertEqual(captured["token"], "token-one")

    def test_voice_event_route_accepts_a_valid_prefetch_token_without_a_session(self) -> None:
        """T13 unit (b): the internal voice-event lookup falls back to a
        Channel-A-minted prefetch token when no HMI session capability
        authorizes the request."""
        with tempfile.TemporaryDirectory() as temporary:
            events = VoiceEventStore()
            client = create_app(JsonFileStore(Path(temporary) / "snapshot.json"), events, None, **DISABLED_HTTP_OPTIONS).test_client()
            owner_id = "00000000-0000-4000-8000-000000000001"
            event = events.publish("", "Respuesta de canal A", owner_id=owner_id)
            token = events.mint_prefetch_token(event["id"], owner_id)

            response = client.get(f"/internal/prisma/voice-events/{event['id']}", headers={"X-Prisma-Session-Capability": token})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["text"], "Respuesta de canal A")

    def test_voice_event_route_rejects_an_unknown_token_and_a_missing_session(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            events = VoiceEventStore()
            client = create_app(JsonFileStore(Path(temporary) / "snapshot.json"), events, None, **DISABLED_HTTP_OPTIONS).test_client()
            owner_id = "00000000-0000-4000-8000-000000000001"
            event = events.publish("", "Respuesta de canal A", owner_id=owner_id)

            no_header = client.get(f"/internal/prisma/voice-events/{event['id']}")
            bad_token = client.get(f"/internal/prisma/voice-events/{event['id']}", headers={"X-Prisma-Session-Capability": "not-a-real-token"})

        self.assertEqual(no_header.status_code, 401)
        self.assertEqual(bad_token.status_code, 401)

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


class VoiceEventsStreamTests(unittest.TestCase):
    """T13 unit (c) / T10 unit 5: push voice events to the HMI (SSE)."""

    def _client(self, events=None):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        events = events if events is not None else VoiceEventStore()
        client = create_app(JsonFileStore(Path(temporary.name) / "snapshot.json"), events, None, **DISABLED_HTTP_OPTIONS).test_client()
        return client, events

    def test_requires_authorization(self) -> None:
        client, _events = self._client()
        response = client.get("/hmi/voice/events")
        self.assertEqual(response.status_code, 401)

    def test_rejects_an_unknown_capability_via_header_or_query(self) -> None:
        client, _events = self._client()
        via_header = client.get("/hmi/voice/events", headers={"X-Prisma-Session-Capability": "not-a-real-capability"})
        via_query = client.get("/hmi/voice/events?capability=not-a-real-capability")
        self.assertEqual(via_header.status_code, 401)
        self.assertEqual(via_query.status_code, 401)

    def test_query_string_capability_no_longer_authorizes(self) -> None:
        """T13b blocking finding: a real, valid capability travelled in the
        URL (`?capability=...`) and Werkzeug's dev server logs the full
        request line, leaking the session capability to
        prisma-presentation-stderr.log. The HMI now reads this stream with a
        header-based fetch reader (like every other authorized route), so
        the query-string fallback is removed entirely -- a valid capability
        offered ONLY via the query string must no longer authorize."""
        client, _events = self._client()
        headers = session_headers(client)
        capability = headers["X-Prisma-Session-Capability"]
        response = client.get(f"/hmi/voice/events?capability={capability}")
        self.assertEqual(response.status_code, 401)

    def test_accepts_a_valid_capability_via_header_only(self) -> None:
        client, _events = self._client()
        headers = session_headers(client)
        # Publish first: Werkzeug's test client pulls the stream's first
        # chunk as part of client.get() itself (to conform to WSGI, it
        # eagerly runs the generator up to its first yield before
        # returning), so an already-existing event avoids this test
        # blocking on the route's own keep-alive interval.
        client.post("/local/ask", json={"question": "status"}, headers=headers)
        response = client.get("/hmi/voice/events", headers=headers)
        try:
            self.assertEqual(response.status_code, 200)
        finally:
            response.close()

    def test_response_headers_avoid_buffering(self) -> None:
        client, _events = self._client()
        headers = session_headers(client)
        client.post("/local/ask", json={"question": "status"}, headers=headers)  # see note above
        response = client.get("/hmi/voice/events", headers=headers)
        try:
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.mimetype, "text/event-stream")
            self.assertEqual(response.headers.get("Cache-Control"), "no-cache")
            self.assertEqual(response.headers.get("X-Accel-Buffering"), "no")
        finally:
            response.close()

    def test_sends_the_existing_latest_event_immediately_on_connect(self) -> None:
        client, _events = self._client()
        headers = session_headers(client)
        client.post("/hmi/current-snapshot", json={"version": 1, "command": "publish", "order": 1, "snapshot": demo_snapshot()}, headers=headers)
        ask_response = client.post("/local/ask", json={"question": "¿Cuál es el OEE?"}, headers=headers)
        published_id = ask_response.get_json()["voiceEvent"]["id"]

        response = client.get("/hmi/voice/events", headers=headers)
        try:
            chunk = next(iter(response.response)).decode("utf-8")
            self.assertTrue(chunk.startswith("data: "))
            payload = json.loads(chunk[len("data: "):].strip())
            self.assertEqual(payload["id"], published_id)
            self.assertEqual(payload["text"], "El OEE actual es 88,6 %.")
        finally:
            response.close()

    def test_pushes_a_new_event_published_after_the_connection_opened(self) -> None:
        """No event exists yet when the connection opens. Werkzeug's test
        client eagerly runs the response generator up to its first yield as
        part of client.get() itself (a WSGI-conformance behavior, not
        lazy iteration afterward) -- so client.get() itself must run on its
        own thread here, or it would block the test on the route's own
        keep-alive interval instead of on the publish this test is after."""
        client, events = self._client()
        headers = session_headers(client)
        result: dict = {}

        def connect_and_receive_first_chunk() -> None:
            response = result["response"] = client.get("/hmi/voice/events", headers=headers)
            result["first_chunk"] = next(iter(response.response)).decode("utf-8")

        consumer = threading.Thread(target=connect_and_receive_first_chunk)
        consumer.start()
        try:
            # subscribe_owner() runs as soon as the generator starts (inside
            # client.get() itself, on the consumer thread) -- wait for the
            # real subscription (not just "the thread started") before
            # publishing, so this test's own publish is guaranteed to land
            # after subscription.
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline and not any(events._owner_waiters.values()):
                time.sleep(0.01)
            self.assertTrue(any(events._owner_waiters.values()), "the stream never subscribed")

            ask_response = client.post("/local/ask", json={"question": "status"}, headers=headers)
            published_id = ask_response.get_json()["voiceEvent"]["id"]
            consumer.join(timeout=2)
            self.assertFalse(consumer.is_alive(), "the SSE stream never delivered the new event")
            self.assertTrue(result["first_chunk"].startswith("data: "))
            payload = json.loads(result["first_chunk"][len("data: "):].strip())
            self.assertEqual(payload["id"], published_id)
        finally:
            response = result.get("response")
            if response is not None:
                response.close()
            consumer.join(timeout=2)

    def test_closing_the_response_unsubscribes_from_the_store(self) -> None:
        client, events = self._client()
        headers = session_headers(client)
        # Publish first so the generator's first pass resolves immediately
        # (an already-existing latest event) instead of blocking on
        # flag.wait() -- the generator body only starts executing, and thus
        # only calls subscribe_owner(), once actually iterated.
        client.post("/local/ask", json={"question": "status"}, headers=headers)
        response = client.get("/hmi/voice/events", headers=headers)
        next(iter(response.response))
        response.close()
        for waiters in events._owner_waiters.values():
            self.assertEqual(len(waiters), 0)


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


class MainStartupWiringTests(unittest.TestCase):
    """PW-007: Channel A must restore an applied configuration at boot the
    same way Channel B (Telegram) already does, so main() must call both
    managers' startup_apply() and the comment must no longer claim Channel A
    stays inert until an explicit operator Apply."""

    def test_main_calls_both_channel_startup_applies_next_to_each_other(self) -> None:
        source = (RUNTIME_ROOT / "src" / "prisma_runtime" / "local_presentation.py").read_text(encoding="utf-8")
        main_start = source.index("\ndef main():")
        main_body = source[main_start:source.index("\nif __name__", main_start)]
        self.assertIn("telegram_manager.startup_apply()", main_body)
        self.assertIn("channel_a_manager.startup_apply()", main_body)
        self.assertLess(
            main_body.index("telegram_manager.startup_apply()"),
            main_body.index("app.run("),
        )
        self.assertLess(
            main_body.index("channel_a_manager.startup_apply()"),
            main_body.index("app.run("),
        )
        self.assertNotIn("A stays inert until an", main_body)
        self.assertIn("if channel_a_manager: channel_a_manager.stop()", main_body)
        self.assertIn("if telegram_manager: telegram_manager.stop()", main_body)

    def test_main_installs_access_log_query_redaction_before_app_run(self) -> None:
        """T13b should-fix (defense in depth): the query-string-redacting
        access log filter must be installed before Werkzeug's dev server
        starts logging requests, not after."""
        source = (RUNTIME_ROOT / "src" / "prisma_runtime" / "local_presentation.py").read_text(encoding="utf-8")
        main_start = source.index("\ndef main():")
        main_body = source[main_start:source.index("\nif __name__", main_start)]
        self.assertIn("install_access_log_query_redaction()", main_body)
        self.assertLess(
            main_body.index("install_access_log_query_redaction()"),
            main_body.index("app.run("),
        )


if __name__ == "__main__":
    unittest.main()
