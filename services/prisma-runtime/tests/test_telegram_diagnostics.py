"""Bounded in-memory telegramDiagnostic telemetry for the local Telegram poller.

Covers the D2 diagnostic contract: stage/category/httpStatus/failureAt/lastSuccessAt,
type-derived categories, genuine HTTP status validation, polling-only success
timestamps, privacy canaries, safe projection for mocks, and coherent snapshots.
"""

import io
import json
import sys
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import requests

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime import local_presentation
from prisma_runtime.admin_http import AdminHttpBoundary
from prisma_runtime.bot_identity_reservation import (
    TELEGRAM_BOT_IDENTITY_RESERVED,
    BotIdentityReservation,
)
from prisma_runtime.local_presentation import JsonFileStore, TelegramLocalBot, VoiceEventStore, create_app, utc_now_iso
from prisma_runtime.telegram_config import TelegramConfig
from prisma_runtime.telegram_lifecycle import (
    TelegramLifecycleError,
    TelegramLifecycleManager,
    TelegramStateUnavailable,
    project_telegram_diagnostic,
)

CANARY = "CANARY-telegram-diagnostic-secret"
DIAGNOSTIC_FIELDS = {"stage", "category", "httpStatus", "failureAt", "lastSuccessAt"}
# Exact admin wire contract; hmi-app/src/domain/adminCredential.types.ts rejects any extra key.
ADMIN_TELEGRAM_FIELDS = {
    "source", "enabled", "configured", "desiredGeneration", "appliedGeneration",
    "running", "verified", "restartRequired", "lastError",
}


class MemoryStateStore:
    def __init__(self, value=None):
        self.value = value
        self.writes = []

    def read(self):
        return self.value

    def write(self, value):
        self.value = value
        self.writes.append(value)


class FailingWriteStateStore(MemoryStateStore):
    def write(self, value):
        raise OSError(f"disk failure path {CANARY}")


class ImmediateStopEvent:
    def __init__(self):
        self.stopped = False

    def is_set(self):
        return self.stopped

    def set(self):
        self.stopped = True

    def wait(self, _timeout):
        return self.stopped


class FirstFailureStopEvent(ImmediateStopEvent):
    """Stops the poll loop after the first failure wait, for single-failure scenarios."""

    def wait(self, _timeout):
        self.stopped = True
        return True


class RecordingStopEvent(ImmediateStopEvent):
    """Records every wait() the poll loop performs and never stops on its own."""

    def __init__(self):
        super().__init__()
        self.waits = []

    def wait(self, timeout):
        self.waits.append(timeout)
        return self.stopped


def parse_utc_timestamp(value):
    """Return the parsed aware UTC datetime for strict UTC ISO text, else None."""
    if not isinstance(value, str) or not value.endswith("Z"):
        return None
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        return None
    return parsed if parsed.utcoffset() == timedelta(0) else None


def diagnostic_record(**overrides):
    record = {"stage": None, "category": None, "httpStatus": None, "failureAt": None, "lastSuccessAt": None}
    record.update(overrides)
    return record


def prepared_state(paired=None, offset=None):
    return {
        "schemaVersion": 2,
        "bots": {
            "123": {
                "pairedPrivateChatIds": list(paired or []),
                "nextUpdateOffset": offset,
                "migrationActive": False,
            }
        },
    }


TELEGRAM_OFFLINE_DISPATCH_REFUSED = "TELEGRAM_OFFLINE_DISPATCH_REFUSED"


class OfflineDispatchRefused(RuntimeError):
    """Fixed guard error: an offline test case must never dispatch a real request."""

    def __init__(self) -> None:
        super().__init__(TELEGRAM_OFFLINE_DISPATCH_REFUSED)


def install_offline_dispatch_guard(case) -> list[int]:
    """Refuse every real outbound dispatch for the lifetime of one test case.

    ``requests.Session.request`` is the single funnel behind both ``get`` and
    ``post``, so one class-level patch covers every bot call regardless of the
    verb a path uses. Attempts are counted without any URL, method or token
    detail. The assertion is registered as a cleanup so a broad
    ``except Exception`` inside the code under test cannot swallow it, and the
    original funnel is always restored, including when the test fails.
    """
    attempts: list[int] = []
    original = requests.Session.request

    def guarded_request(self, method, url, *args, **kwargs):
        attempts.append(1)
        raise OfflineDispatchRefused()

    requests.Session.request = guarded_request
    case.addCleanup(lambda: setattr(requests.Session, "request", original))
    case.addCleanup(lambda: case.assertEqual(attempts, [], "an unexpected real HTTP dispatch was attempted"))
    return attempts


def install_inert_transport_floor(case) -> list[int]:
    """Install a second inert dispatcher below ``Session.request``.

    It answers nothing and only counts an attempt; it never builds a socket.
    Probes install this first so no version of the code under test can reach the
    network even if the primary funnel guard were absent.
    """
    attempted: list[int] = []
    original = requests.adapters.HTTPAdapter.send

    def inert_send(self, request, *args, **kwargs):
        attempted.append(1)
        raise OfflineDispatchRefused()

    requests.adapters.HTTPAdapter.send = inert_send
    case.addCleanup(lambda: setattr(requests.adapters.HTTPAdapter, "send", original))
    return attempted


class TelegramDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        install_offline_dispatch_guard(self)

    def build_bot(self, state=None, state_store=None, *, reservation=None):
        bot = TelegramLocalBot(
            "secret-token",
            Mock(),
            state_store if state_store is not None else MemoryStateStore(state),
            Mock(),
            reservation=reservation if reservation is not None else BotIdentityReservation(),
        )
        bot.stop_event = ImmediateStopEvent()
        return bot

    def prepared_bot(self, paired=None, offset=None, state_store=None, *, reservation=None):
        """A real bot that completed the guarded preparation path."""
        state = prepared_state(paired, offset)
        if state_store is None:
            state_store = MemoryStateStore(state)
        bot = self.build_bot(state, state_store=state_store, reservation=reservation)
        bot._call = Mock(side_effect=[
            {"ok": True, "result": {"id": 123, "username": "prisma_bot"}},
            {"ok": True, "result": True},
        ])
        bot.prepare()
        return bot

    def bot_diagnostic(self, bot):
        getter = getattr(bot, "telegram_diagnostic", None)
        self.assertIsNotNone(getter, "TelegramLocalBot must expose telegram_diagnostic()")
        return getter()

    def build_manager(self, bot):
        config = TelegramConfig(enabled=True, token="secret-token")
        resolver = SimpleNamespace(source="environment", resolve=lambda: "secret-token")
        manager = TelegramLifecycleManager(config, resolver, Mock(), lambda token: bot)
        manager.bot = bot
        manager._update(configured=True, appliedGeneration=1, running=True, verified=True)
        return manager

    def health_payload(self, manager):
        fake_http = Mock()
        fake_http.get.return_value.json.return_value = {"ok": True}
        with patch.object(local_presentation.requests, "Session", return_value=fake_http):
            with tempfile.TemporaryDirectory() as temporary:
                boundary = AdminHttpBoundary(Mock(), credential_service=Mock(), telegram_manager=manager)
                client = create_app(
                    JsonFileStore(Path(temporary) / "snapshot.json"),
                    VoiceEventStore(),
                    None,
                    admin_http=boundary,
                    telegram_manager=manager,
                ).test_client()
                response = client.get("/health")
        self.assertEqual(response.status_code, 200)
        return response.get_json()

    def assert_public_json_hides_canaries(self, payload):
        serialized = json.dumps(payload)
        self.assertNotIn(CANARY, serialized)
        self.assertNotIn("secret-token", serialized)
        return serialized

    # --- Safe surface: manager status and health projection -----------------

    def test_status_exposes_null_diagnostic_for_fresh_bot(self):
        manager = self.build_manager(self.build_bot())

        status = manager.status()

        self.assertIn("telegramDiagnostic", status)
        diagnostic = status.get("telegramDiagnostic")
        self.assertIsNotNone(diagnostic)
        self.assertEqual(set(diagnostic), DIAGNOSTIC_FIELDS)
        self.assertEqual(
            diagnostic,
            {"stage": None, "category": None, "httpStatus": None, "failureAt": None, "lastSuccessAt": None},
        )

    def test_status_without_bot_reports_null_diagnostic(self):
        config = TelegramConfig(enabled=True, token="secret-token")
        resolver = SimpleNamespace(source="environment", resolve=lambda: "secret-token")
        manager = TelegramLifecycleManager(config, resolver, Mock(), Mock())

        status = manager.status()

        self.assertIsNone(status.get("telegramDiagnostic"))

    def test_status_with_mock_bot_projects_null_diagnostic_instead_of_mock(self):
        manager = self.build_manager(Mock())
        manager.bot = Mock()

        status = manager.status()

        self.assertIsNone(status.get("telegramDiagnostic"))
        self.assertIn("telegramDiagnostic", json.dumps(status))

    def test_health_exposes_null_diagnostic_and_preserves_existing_fields(self):
        manager = self.build_manager(self.build_bot())

        payload = self.health_payload(manager)

        for key in (
            "telegramEnabled",
            "telegramConfigured",
            "telegramConnected",
            "telegramVerified",
            "telegramConfigurationError",
            "telegramLastError",
            "telegramDesiredGeneration",
            "telegramAppliedGeneration",
            "telegramRestartRequired",
        ):
            self.assertIn(key, payload)
        self.assertEqual(payload.get("telegramDiagnostic"), {"stage": None, "category": None, "httpStatus": None, "failureAt": None, "lastSuccessAt": None})

    def test_health_with_mock_manager_status_stays_safe_without_diagnostic_key(self):
        manager = Mock()
        manager.status.return_value = {
            "source": "environment",
            "enabled": True,
            "configured": True,
            "running": True,
            "verified": True,
            "restartRequired": False,
            "lastError": None,
            "desiredGeneration": 1,
            "appliedGeneration": 1,
        }

        payload = self.health_payload(manager)

        self.assertIsNone(payload.get("telegramDiagnostic"))
        self.assertEqual(payload["telegramConnected"], True)
        self.assertEqual(payload["telegramLastError"], None)
        self.assert_public_json_hides_canaries(payload)

    def test_health_never_serializes_mock_value_stored_as_diagnostic(self):
        manager = Mock()
        manager.status.return_value = {
            "source": "environment",
            "enabled": True,
            "configured": True,
            "running": True,
            "verified": True,
            "restartRequired": False,
            "lastError": None,
            "desiredGeneration": 1,
            "appliedGeneration": 1,
            "telegramDiagnostic": Mock(),
        }

        payload = self.health_payload(manager)

        self.assertIsNone(payload.get("telegramDiagnostic"))
        self.assertEqual(payload["telegramConnected"], True)
        self.assert_public_json_hides_canaries(payload)

    # --- Failure classification through the real poll loop ------------------

    def test_http_409_poll_failure_classifies_http_status_and_hides_response_url(self):
        bot = self.prepared_bot()
        response = requests.Response()
        response.status_code = 409
        response.url = f"https://api.telegram.org/botsecret-token/getUpdates?leak={CANARY}"

        def call(_method, **_kwargs):
            bot.stop_event.set()
            raise requests.HTTPError("409 Conflict", response=response)

        bot._call = call
        bot.run()

        diagnostic = self.bot_diagnostic(bot)
        self.assertEqual(diagnostic["stage"], "poll")
        self.assertEqual(diagnostic["category"], "http")
        self.assertEqual(diagnostic["httpStatus"], 409)
        self.assertTrue(diagnostic["failureAt"])
        self.assertIsNone(diagnostic["lastSuccessAt"])
        self.assert_public_json_hides_canaries(diagnostic)
        self.assertEqual(bot.last_error, "TELEGRAM_POLL_FAILED")

    def test_connection_error_classifies_transport_without_http_status(self):
        bot = self.prepared_bot()

        def call(_method, **_kwargs):
            bot.stop_event.set()
            raise requests.ConnectionError(f"name resolution failed {CANARY}")

        bot._call = call
        bot.run()

        diagnostic = self.bot_diagnostic(bot)
        self.assertEqual(diagnostic["stage"], "poll")
        self.assertEqual(diagnostic["category"], "transport")
        self.assertIsNone(diagnostic["httpStatus"])
        self.assert_public_json_hides_canaries(diagnostic)

    def test_requests_json_decode_error_wins_over_request_exception_inheritance(self):
        for factory in (
            lambda: requests.exceptions.JSONDecodeError("invalid json", CANARY, 0),
            lambda: json.JSONDecodeError("invalid json", CANARY, 0),
        ):
            bot = self.prepared_bot()
            error = factory()

            def call(_method, **_kwargs):
                bot.stop_event.set()
                raise error

            bot._call = call
            bot.run()

            diagnostic = self.bot_diagnostic(bot)
            self.assertEqual(diagnostic["stage"], "poll")
            self.assertEqual(diagnostic["category"], "response_json")
            self.assertNotEqual(diagnostic["category"], "transport")
            self.assertIsNone(diagnostic["httpStatus"])
            self.assert_public_json_hides_canaries(diagnostic)

    def test_state_read_failure_maps_storage_error_to_state(self):
        bot = self.prepared_bot()
        bot.stop_event = FirstFailureStopEvent()
        bot._state = None

        bot.run()

        diagnostic = self.bot_diagnostic(bot)
        self.assertEqual(diagnostic["stage"], "state_read")
        self.assertEqual(diagnostic["category"], "state")
        self.assertIsNone(diagnostic["httpStatus"])
        self.assertEqual(bot.last_error, "TELEGRAM_POLL_FAILED")

    def test_validate_failure_maps_provider_shape_error_to_unexpected(self):
        bot = self.prepared_bot()

        def call(_method, **_kwargs):
            bot.stop_event.set()
            return {"ok": True, "result": "not-a-list"}

        bot._call = call
        bot.run()

        diagnostic = self.bot_diagnostic(bot)
        self.assertEqual(diagnostic["stage"], "validate")
        self.assertEqual(diagnostic["category"], "unexpected")

    def test_handle_failure_maps_message_error_to_unexpected_and_keeps_offset(self):
        bot = self.prepared_bot(paired=[7])
        bot.stop_event = FirstFailureStopEvent()
        bot.send_message = Mock(side_effect=RuntimeError(f"send failed {CANARY}"))

        def call(_method, **_kwargs):
            return {"ok": True, "result": [{"update_id": 5, "message": {"chat": {"id": 7, "type": "private"}, "text": "/status"}}]}

        bot._call = call
        bot.run()

        diagnostic = self.bot_diagnostic(bot)
        self.assertEqual(diagnostic["stage"], "handle")
        self.assertEqual(diagnostic["category"], "unexpected")
        self.assertEqual(bot._record()["nextUpdateOffset"], None)
        self.assert_public_json_hides_canaries(diagnostic)

    def test_persist_failure_maps_storage_error_to_state_and_rolls_back(self):
        bot = self.prepared_bot(paired=[7], state_store=FailingWriteStateStore(prepared_state(paired=[7])))
        bot.stop_event = FirstFailureStopEvent()
        bot.send_message = Mock()

        def call(_method, **_kwargs):
            return {"ok": True, "result": [{"update_id": 5, "message": {"chat": {"id": 7, "type": "private"}, "text": "/status"}}]}

        bot._call = call
        bot.run()

        diagnostic = self.bot_diagnostic(bot)
        self.assertEqual(diagnostic["stage"], "persist")
        self.assertEqual(diagnostic["category"], "state")
        self.assertEqual(bot._record()["nextUpdateOffset"], None)
        self.assert_public_json_hides_canaries(diagnostic)

    def test_preparation_failure_tracks_prepare_stage_without_success_timestamp(self):
        bot = self.build_bot()

        def call(_method, **_kwargs):
            raise requests.ConnectionError(f"offline during prepare {CANARY}")

        bot._call = call
        bot.run()

        diagnostic = self.bot_diagnostic(bot)
        self.assertEqual(diagnostic["stage"], "prepare")
        self.assertEqual(diagnostic["category"], "transport")
        self.assertIsNone(diagnostic["lastSuccessAt"])
        self.assertEqual(bot.last_error, "TELEGRAM_PREPARATION_FAILED")

    def test_arbitrary_value_error_maps_to_unexpected_not_json(self):
        bot = self.prepared_bot()

        def call(_method, **_kwargs):
            bot.stop_event.set()
            raise ValueError(f"bad value {CANARY}")

        bot._call = call
        bot.run()

        diagnostic = self.bot_diagnostic(bot)
        self.assertEqual(diagnostic["stage"], "poll")
        self.assertEqual(diagnostic["category"], "unexpected")

    # --- HTTP status validation ---------------------------------------------

    def test_http_error_status_is_only_reported_when_genuine(self):
        for status_code in (True, 99, 700, "409", None):
            bot = self.prepared_bot()
            response = requests.Response()
            response.status_code = status_code
            error = requests.HTTPError("failed", response=response)

            def call(_method, **_kwargs):
                bot.stop_event.set()
                raise error

            bot._call = call
            bot.run()

            diagnostic = self.bot_diagnostic(bot)
            self.assertEqual(diagnostic["category"], "http")
            self.assertIsNone(diagnostic["httpStatus"], f"status {status_code!r} must not be reported")

    def test_http_error_without_response_keeps_category_but_drops_status(self):
        bot = self.prepared_bot()

        def call(_method, **_kwargs):
            bot.stop_event.set()
            raise requests.HTTPError("no response attached")

        bot._call = call
        bot.run()

        diagnostic = self.bot_diagnostic(bot)
        self.assertEqual(diagnostic["category"], "http")
        self.assertIsNone(diagnostic["httpStatus"])

    # --- Success lifecycle ---------------------------------------------------

    def test_successful_poll_cycle_records_last_success_and_clears_failures(self):
        bot = self.prepared_bot()

        def call(_method, **_kwargs):
            bot.stop_event.set()
            return {"ok": True, "result": []}

        bot._call = call
        bot.run()

        diagnostic = self.bot_diagnostic(bot)
        self.assertTrue(diagnostic["lastSuccessAt"])
        self.assertIsNone(diagnostic["failureAt"])
        self.assertIsNone(diagnostic["stage"])
        self.assertIsNone(diagnostic["category"])
        self.assertIsNone(diagnostic["httpStatus"])
        self.assertIsNone(bot.last_error)

    def test_successful_preparation_alone_does_not_record_last_success(self):
        bot = self.build_bot()
        bot._call = Mock(return_value={"ok": True, "result": {"id": 123, "username": "prisma_bot"}})

        bot.prepare()

        self.assertIsNone(self.bot_diagnostic(bot)["lastSuccessAt"])

    def test_failure_keeps_previous_last_success_timestamp(self):
        bot = self.prepared_bot()
        bot.stop_event = FirstFailureStopEvent()
        captured = {}

        def call(_method, **_kwargs):
            if "first_success" not in captured:
                captured["first_success"] = True
                return {"ok": True, "result": []}
            if "preserved" not in captured:
                captured["preserved"] = getattr(bot, "telegram_diagnostic", lambda: None)()["lastSuccessAt"] if callable(getattr(bot, "telegram_diagnostic", None)) else None
                raise requests.ConnectionError(CANARY)
            return {"ok": True, "result": []}

        bot._call = call
        bot.run()

        diagnostic = self.bot_diagnostic(bot)
        self.assertTrue(captured["preserved"])
        self.assertEqual(diagnostic["lastSuccessAt"], captured["preserved"])
        self.assertTrue(diagnostic["failureAt"])
        self.assertEqual(diagnostic["category"], "transport")
        self.assertEqual(bot.last_error, "TELEGRAM_POLL_FAILED")

    def test_recovered_cycle_clears_failure_details_and_updates_last_success(self):
        bot = self.prepared_bot()
        calls = []

        def call(_method, **_kwargs):
            calls.append(1)
            if len(calls) == 2:
                raise requests.ConnectionError(CANARY)
            if len(calls) >= 3:
                bot.stop_event.set()
            return {"ok": True, "result": []}

        bot._call = call
        bot.run()

        diagnostic = self.bot_diagnostic(bot)
        self.assertIsNone(diagnostic["failureAt"])
        self.assertIsNone(diagnostic["stage"])
        self.assertIsNone(diagnostic["category"])
        self.assertIsNone(diagnostic["httpStatus"])
        self.assertTrue(diagnostic["lastSuccessAt"])

    # --- Snapshot safety ------------------------------------------------------

    def test_diagnostic_getter_returns_an_independent_copy(self):
        bot = self.prepared_bot()

        def call(_method, **_kwargs):
            bot.stop_event.set()
            raise requests.ConnectionError(CANARY)

        bot._call = call
        bot.run()

        snapshot = self.bot_diagnostic(bot)
        snapshot["stage"] = "tampered"
        snapshot["category"] = "tampered"

        fresh = self.bot_diagnostic(bot)
        self.assertEqual(fresh["stage"], "poll")
        self.assertEqual(fresh["category"], "transport")

    def test_concurrent_reads_observe_coherent_snapshots_during_polling(self):
        bot = self.prepared_bot()
        blocked = threading.Event()
        release = threading.Event()
        done = threading.Event()
        problems = []

        def call(_method, **_kwargs):
            blocked.set()
            release.wait(5)
            bot.stop_event.set()
            raise requests.ConnectionError(CANARY)

        def reader():
            getter = getattr(bot, "telegram_diagnostic", None)
            if getter is None:
                problems.append("missing telegram_diagnostic getter")
                done.set()
                return
            reads = 0
            while not done.is_set() and reads < 20000:
                diagnostic = getter()
                coherent_failure = diagnostic["failureAt"] is not None and diagnostic["stage"] in {
                    "prepare", "poll", "state_read", "validate", "persist", "handle"
                }
                coherent_clear = diagnostic["failureAt"] is None and (
                    diagnostic["stage"] is None
                    and diagnostic["category"] is None
                    and diagnostic["httpStatus"] is None
                )
                if not (coherent_failure or coherent_clear):
                    problems.append(dict(diagnostic))
                reads += 1
            done.set()

        bot._call = call
        thread = threading.Thread(target=reader, daemon=True)
        thread.start()
        try:
            bot.run()
        finally:
            release.set()
            done.set()
            thread.join(timeout=5)

        self.assertEqual(problems, [])
        self.assertEqual(self.bot_diagnostic(bot)["category"], "transport")

    # --- Public health integration --------------------------------------------

    def test_health_surfaces_failed_diagnostic_and_keeps_configured_warning_fix(self):
        bot = self.prepared_bot()
        response = requests.Response()
        response.status_code = 409

        def call(_method, **_kwargs):
            bot.stop_event.set()
            raise requests.HTTPError("409 Conflict", response=response)

        bot._call = call
        bot.run()
        manager = self.build_manager(bot)

        payload = self.health_payload(manager)

        diagnostic = payload.get("telegramDiagnostic")
        self.assertIsNotNone(diagnostic)
        self.assertEqual(diagnostic["stage"], "poll")
        self.assertEqual(diagnostic["category"], "http")
        self.assertEqual(diagnostic["httpStatus"], 409)
        self.assertTrue(diagnostic["failureAt"])
        self.assertEqual(bot.last_error, "TELEGRAM_POLL_FAILED")
        self.assertIsNone(payload["telegramConfigurationError"])
        self.assertEqual(payload["telegramConnected"], True)
        self.assert_public_json_hides_canaries(payload)


    # --- P1: strict UTC timestamp sanitizer ---------------------------------

    def test_projection_requires_strict_utc_timestamps(self):
        valid_values = (
            utc_now_iso(),
            "2026-09-19T22:08:41Z",
            "2026-09-19T22:08:41.304123Z",
            "2026-09-19T22:08:41.3Z",
        )
        invalid_values = (
            CANARY,
            f"2026-09-19T22:08:41Z{CANARY}",
            f"{CANARY}2026-09-19T22:08:41Z",
            "2026-09-19T22:08:41",
            "2026-09-19T22:08:41+00:00",
            "2026-09-19T22:08:41+02:00",
            "2026-09-19 22:08:41Z",
            "20260919T220841Z",
            "2026-13-45T99:99:99Z",
            "2026-02-30T10:00:00.000000Z",
            "2026-09-19T24:00:00Z",
            "2026-09-19T22:08:60Z",
            12345,
            True,
            None,
        )

        for value in valid_values:
            with self.subTest(value=value):
                projected = project_telegram_diagnostic(diagnostic_record(failureAt=value, lastSuccessAt=value))
                self.assertEqual(projected["failureAt"], value)
                self.assertEqual(projected["lastSuccessAt"], value)
        for value in invalid_values:
            with self.subTest(value=value):
                projected = project_telegram_diagnostic(diagnostic_record(failureAt=value, lastSuccessAt=value))
                self.assertIsNone(projected["failureAt"])
                self.assertIsNone(projected["lastSuccessAt"])

    def test_manager_status_health_and_admin_error_null_synthetic_timestamps(self):
        bot = Mock()
        bot.telegram_diagnostic.return_value = diagnostic_record(
            stage="poll", category="transport", failureAt=CANARY, lastSuccessAt=f"2026-09-19T22:08:41Z{CANARY}"
        )
        manager = self.build_manager(bot)

        status = manager.status()

        diagnostic = status["telegramDiagnostic"]
        self.assertEqual(diagnostic["stage"], "poll")
        self.assertEqual(diagnostic["category"], "transport")
        self.assertIsNone(diagnostic["failureAt"])
        self.assertIsNone(diagnostic["lastSuccessAt"])
        self.assert_public_json_hides_canaries(status)

        health = self.health_payload(manager)
        self.assertIsNone(health["telegramDiagnostic"]["failureAt"])
        self.assertIsNone(health["telegramDiagnostic"]["lastSuccessAt"])
        self.assert_public_json_hides_canaries(health)

    def test_mocked_admin_apply_error_never_echoes_synthetic_timestamps(self):
        bot = Mock()
        bot.telegram_diagnostic.return_value = diagnostic_record(
            stage="poll", category="transport", failureAt=CANARY, lastSuccessAt=f"2026-09-19T22:08:41Z{CANARY}"
        )
        manager = self.build_manager(bot)
        manager.apply = Mock(side_effect=TelegramLifecycleError("TELEGRAM_PROVIDER_UNAVAILABLE"))

        response = self.admin_apply_error_response(manager)

        self.assertEqual(response.status_code, 502)
        payload = response.get_json()
        telegram = payload["telegram"]
        # The admin wire shape stays at its exact nine-field legacy contract;
        # the internal diagnostic never crosses that boundary.
        self.assertEqual(set(telegram), ADMIN_TELEGRAM_FIELDS)
        self.assertNotIn("telegramDiagnostic", telegram)
        self.assert_public_json_hides_canaries(payload)
        # The manager still retains its own projected, sanitized diagnostic.
        internal = manager.status()["telegramDiagnostic"]
        self.assertEqual(internal["stage"], "poll")
        self.assertEqual(internal["category"], "transport")
        self.assertIsNone(internal["failureAt"])
        self.assertIsNone(internal["lastSuccessAt"])

    def test_genuine_generated_timestamps_survive_projection(self):
        bot = Mock()
        generated = utc_now_iso()
        bot.telegram_diagnostic.return_value = diagnostic_record(
            stage="poll", category="transport", failureAt=generated, lastSuccessAt=generated
        )
        manager = self.build_manager(bot)

        diagnostic = manager.status()["telegramDiagnostic"]

        self.assertEqual(diagnostic["failureAt"], generated)
        self.assertEqual(diagnostic["lastSuccessAt"], generated)
        self.assertIsNotNone(parse_utc_timestamp(diagnostic["failureAt"]))

    # --- P2: success instrumentation containment ----------------------------

    def test_clock_fault_during_successful_poll_is_contained(self):
        bot = self.prepared_bot()
        bot.stop_event = RecordingStopEvent()
        bot.session = Mock()
        calls = []

        def call(_method, **_kwargs):
            calls.append(1)
            if len(calls) >= 2:
                bot.stop_event.set()
            return {"ok": True, "result": []}

        bot._call = call

        with patch.object(local_presentation, "utc_now_iso", Mock(side_effect=OSError("clock fault"))):
            bot.run()

        self.assertIsNone(bot.last_error)
        self.assertEqual(bot.stop_event.waits, [])
        self.assertEqual(len(calls), 2)
        self.assertIsNone(self.bot_diagnostic(bot)["failureAt"])
        self.assertIsNone(self.bot_diagnostic(bot)["stage"])
        self.assertIsNone(bot._record()["nextUpdateOffset"])
        self.assertFalse(bot._record()["migrationActive"])
        bot.session.post.assert_not_called()

    def test_clock_fault_during_migration_fence_success_is_contained(self):
        state = {"schemaVersion": 2, "bots": {"123": {"pairedPrivateChatIds": [], "nextUpdateOffset": None, "migrationActive": True}}}
        store = MemoryStateStore(state)
        bot = self.build_bot(state, state_store=store)
        bot.stop_event = RecordingStopEvent()
        bot.session = Mock()
        bot._call = Mock(side_effect=[
            {"ok": True, "result": {"id": 123, "username": "prisma_bot"}},
            {"ok": True, "result": True},
        ])
        bot.prepare()
        calls = []

        def call(_method, **_kwargs):
            calls.append(1)
            if len(calls) >= 2:
                bot.stop_event.set()
            return {"ok": True, "result": []}

        bot._call = call

        with patch.object(local_presentation, "utc_now_iso", Mock(side_effect=OSError("clock fault"))):
            bot.run()

        self.assertIsNone(bot.last_error)
        self.assertEqual(bot.stop_event.waits, [])
        self.assertEqual(len(store.writes), 1)
        self.assertFalse(bot._record()["migrationActive"])
        self.assertIsNone(bot._record()["nextUpdateOffset"])
        self.assertIsNone(self.bot_diagnostic(bot)["failureAt"])
        bot.session.post.assert_not_called()

    # --- P3: preparation diagnostics through the real manager ---------------

    def failing_prepare_bot(self):
        bot = TelegramLocalBot("secret-token", Mock(), MemoryStateStore(None), Mock())
        bot.session = Mock()
        bot._call = Mock(side_effect=requests.ConnectionError(f"fake-prepare-failure {CANARY}"))
        bot.start = Mock()
        bot.stop = Mock(return_value=True)
        return bot

    def manager_with_factory(self, holder):
        config = TelegramConfig(enabled=True, token="secret-token")
        resolver = SimpleNamespace(source="environment", resolve=lambda: "secret-token")
        return TelegramLifecycleManager(config, resolver, Mock(), lambda token: holder["bot"])

    def admin_apply_error_response(self, manager):
        auth = Mock()
        auth.read_session.return_value = SimpleNamespace(csrf_token="csrf", username="admin")
        with tempfile.TemporaryDirectory() as temporary:
            boundary = AdminHttpBoundary(auth, credential_service=Mock(), telegram_manager=manager)
            client = create_app(
                JsonFileStore(Path(temporary) / "snapshot.json"),
                VoiceEventStore(),
                None,
                admin_http=boundary,
                telegram_manager=manager,
            ).test_client()
            client.set_cookie("prisma_admin_session", "session", path="/api/prisma/admin")
            return client.post(
                "/api/prisma/admin/credentials/telegram/apply",
                json={},
                headers={"Origin": "http://localhost:5173", "X-CSRF-Token": "csrf"},
                environ_overrides={"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"},
            )

    def test_direct_prepare_failure_records_stage_and_reraises(self):
        bot = self.build_bot()
        bot.session = Mock()
        bot._call = Mock(side_effect=requests.ConnectionError(f"fake-prepare-failure {CANARY}"))

        with self.assertRaises(requests.ConnectionError):
            bot.prepare()

        diagnostic = self.bot_diagnostic(bot)
        self.assertEqual(diagnostic["stage"], "prepare")
        self.assertEqual(diagnostic["category"], "transport")
        self.assertIsNone(diagnostic["httpStatus"])
        self.assertIsNotNone(parse_utc_timestamp(diagnostic["failureAt"]))
        self.assertIsNone(diagnostic["lastSuccessAt"])
        self.assertIsNone(bot.bot_id)
        bot.session.post.assert_not_called()

    def test_startup_apply_captures_failed_preparation_snapshot_without_retaining_candidate(self):
        holder = {}
        manager = self.manager_with_factory(holder)
        candidate = self.failing_prepare_bot()
        holder["bot"] = candidate

        before = datetime.now(timezone.utc)
        status = manager.startup_apply()
        after = datetime.now(timezone.utc)

        candidate.start.assert_not_called()
        candidate.stop.assert_called_once_with()
        self.assertIsNone(manager.bot)
        self.assertEqual(status["lastError"], "TELEGRAM_PROVIDER_UNAVAILABLE")
        self.assertFalse(status["running"])
        self.assertFalse(status["verified"])
        self.assertEqual(status["appliedGeneration"], 0)
        diagnostic = status["telegramDiagnostic"]
        self.assertIsNotNone(diagnostic)
        self.assertEqual(diagnostic["stage"], "prepare")
        self.assertEqual(diagnostic["category"], "transport")
        self.assertIsNone(diagnostic["httpStatus"])
        self.assertIsNone(diagnostic["lastSuccessAt"])
        failure_time = parse_utc_timestamp(diagnostic["failureAt"])
        self.assertIsNotNone(failure_time)
        self.assertLessEqual(before, failure_time)
        self.assertLessEqual(failure_time, after)
        candidate.session.post.assert_not_called()

        health = self.health_payload(manager)
        self.assertEqual(health["telegramDiagnostic"]["stage"], "prepare")
        self.assert_public_json_hides_canaries(health)

    def test_preparation_failure_snapshot_is_an_isolated_copy(self):
        holder = {}
        manager = self.manager_with_factory(holder)
        candidate = self.failing_prepare_bot()
        holder["bot"] = candidate

        manager.startup_apply()

        snapshot = manager.status()["telegramDiagnostic"]
        self.assertIsNotNone(snapshot)
        self.assertEqual(snapshot["stage"], "prepare")
        snapshot["stage"] = "tampered"
        snapshot["failureAt"] = "tampered"

        fresh = manager.status()["telegramDiagnostic"]
        self.assertEqual(fresh["stage"], "prepare")
        self.assertIsNotNone(parse_utc_timestamp(fresh["failureAt"]))
        self.assertEqual(candidate.telegram_diagnostic()["failureAt"], fresh["failureAt"])

    def test_successful_apply_supersedes_preparation_failure_snapshot(self):
        holder = {}
        manager = self.manager_with_factory(holder)
        holder["bot"] = self.failing_prepare_bot()

        failed_status = manager.startup_apply()
        failed_diagnostic = failed_status["telegramDiagnostic"]
        self.assertIsNotNone(failed_diagnostic)
        self.assertEqual(failed_diagnostic["stage"], "prepare")

        healthy_bot = self.build_bot()
        healthy_bot.session = Mock()
        healthy_bot.start = Mock()
        healthy_bot.stop = Mock(return_value=True)
        healthy_bot._call = Mock(
            side_effect=[
                {"ok": True, "result": {"id": 123, "username": "prisma_bot"}},
                {"ok": True, "result": True},
            ]
        )
        holder["bot"] = healthy_bot

        status = manager.apply()

        self.assertEqual(status["lastError"], None)
        self.assertTrue(status["configured"])
        self.assertEqual(status["appliedGeneration"], 1)
        self.assertTrue(status["running"])
        self.assertTrue(status["verified"])
        self.assertIs(manager.bot, healthy_bot)
        diagnostic = status["telegramDiagnostic"]
        self.assertIsNone(diagnostic["failureAt"])
        self.assertIsNone(diagnostic["stage"])
        self.assertNotIn(failed_diagnostic["failureAt"], json.dumps(status))
        healthy_bot.session.post.assert_not_called()

    def test_delete_secret_clears_preparation_failure_snapshot(self):
        holder = {}
        manager = self.manager_with_factory(holder)
        holder["bot"] = self.failing_prepare_bot()

        failed_status = manager.startup_apply()
        self.assertIsNotNone(failed_status["telegramDiagnostic"])
        self.assertEqual(failed_status["telegramDiagnostic"]["stage"], "prepare")

        self.assertTrue(manager.delete_secret())

        status = manager.status()
        self.assertIsNone(manager.bot)
        self.assertIsNone(status["telegramDiagnostic"])
        self.assertIsNone(status["lastError"])

    # --- P4: cooperative identity conflict through the real manager ---------

    def test_identity_conflict_reports_fixed_status_with_the_same_cleanup_discipline(self):
        reservation = BotIdentityReservation()
        incumbent = TelegramLocalBot(
            "incumbent-token", Mock(), MemoryStateStore(None), Mock(), reservation=reservation
        )
        incumbent._call = Mock(side_effect=[
            {"ok": True, "result": {"id": 123, "username": "prisma_bot"}},
            {"ok": True, "result": True},
        ])
        incumbent.prepare()
        config = TelegramConfig(enabled=True, token="secret-token")
        resolver = SimpleNamespace(source="environment", resolve=lambda: "secret-token")

        def factory(_token):
            candidate = TelegramLocalBot(
                "candidate-token", Mock(), MemoryStateStore(None), Mock(), reservation=reservation
            )
            candidate._call = Mock(side_effect=[
                {"ok": True, "result": {"id": 123, "username": "prisma_bot"}},
                {"ok": True, "result": True},
            ])
            return candidate

        manager = TelegramLifecycleManager(config, resolver, Mock(), factory)

        with self.assertRaises(TelegramLifecycleError) as raised:
            manager.apply()

        self.assertEqual(raised.exception.args[0], TELEGRAM_BOT_IDENTITY_RESERVED)
        self.assertIsNone(manager.bot)
        status = manager.status()
        self.assertEqual(status["lastError"], TELEGRAM_BOT_IDENTITY_RESERVED)
        self.assertFalse(status["running"])
        self.assertFalse(status["verified"])
        diagnostic = status["telegramDiagnostic"]
        self.assertEqual(diagnostic["stage"], "prepare")
        self.assertEqual(diagnostic["category"], "unexpected")
        self.assertIsNotNone(parse_utc_timestamp(diagnostic["failureAt"]))
        self.assert_public_json_hides_canaries(status)
        # The winning channel keeps its lease, state, diagnostics and stop event.
        winner = reservation.held_by(123)
        self.assertIsNotNone(winner)
        self.assertEqual(winner.bot_id, 123)
        self.assertEqual(len(incumbent.state_store.writes), 1)
        self.assertIsNone(incumbent.last_error)
        self.assertFalse(incumbent.stop_event.is_set())

    # --- P5: the offline dispatch guard itself ------------------------------

    def test_offline_guard_fails_an_unmocked_poll_that_would_hide_as_a_poll_error(self):
        """Prove the guard discriminates when production code swallows the cause.

        An unmocked bot whose only symptom is ``TELEGRAM_POLL_FAILED`` would let a
        silently network-reaching test pass. The guard must record and refuse the
        attempt, and the cleanup assertion must fail the run from outside the
        production ``except Exception`` block.
        """
        recorded = {}

        class GuardProbe(unittest.TestCase):
            def runTest(inner):
                # Inert floor first: no version of the code can reach the network.
                recorded["floor"] = install_inert_transport_floor(inner)
                recorded["guard"] = install_offline_dispatch_guard(inner)
                probe_bot = TelegramLocalBot(
                    "token", Mock(), MemoryStateStore(None), Mock(), reservation=BotIdentityReservation()
                )
                recorded["bot"] = probe_bot
                probe_bot.run()

        result = unittest.TestResult(stream=io.StringIO())
        GuardProbe().run(result)

        self.assertFalse(result.wasSuccessful())
        self.assertEqual(len(result.errors) + len(result.failures), 1)
        self.assertEqual(recorded["guard"], [1])
        self.assertEqual(recorded["floor"], [])
        self.assertEqual(recorded["bot"].last_error, "TELEGRAM_PREPARATION_FAILED")


if __name__ == "__main__":
    unittest.main()
