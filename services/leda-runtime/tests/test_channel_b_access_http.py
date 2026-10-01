import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from leda_runtime.admin_http import AdminHttpBoundary
from leda_runtime.channel_b_access import ChannelBAccess
from leda_runtime.local_presentation import JsonFileStore, VoiceEventStore, create_app
from leda_runtime.telegram_lifecycle import TelegramStateRepository, TelegramStateUnavailable


LIST_ROUTE = "/api/leda/admin/channel-b/access"
CHAT_FIELDS = {"chatId", "status", "displayName", "username", "requestedAt", "decidedAt"}
NOTICE_ERROR_CANARY = "CANARY-telegram-down-4242"


def chat(status, *, name="Ana", username="ana", requested="2026-10-01T10:00:00Z"):
    decided = None if status == "pending" else "2026-10-01T11:00:00Z"
    return {"status": status, "displayName": name, "username": username, "requestedAt": requested, "decidedAt": decided}


def state(chats):
    return {"schemaVersion": 3, "bots": {"123": {"chats": chats, "nextUpdateOffset": 9, "migrationActive": False}}}


class ChannelBAccessHttpTests(unittest.TestCase):
    """Admin routes for the Channel B access list.

    Contract chosen for a bot that is not running yet (no token, stopped, no identity): the list and
    every decision answer 503 ``CHANNEL_B_ACCESS_UNAVAILABLE``, the same closed-refusal style the
    other Telegram and Channel A admin routes use when their collaborator is missing.
    """

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repository = TelegramStateRepository(self.root / "chat-state.json")
        self.repository.write(state({}))
        self.bot = SimpleNamespace(bot_id=123, state_store=self.repository, send_approval_notice=Mock(return_value=True))
        self.manager = SimpleNamespace(bot=self.bot)
        self.audit = Mock()
        self.auth = Mock()
        self.auth.read_session.return_value = SimpleNamespace(csrf_token="csrf", username="admin")
        self.auth.was_session_replaced.return_value = False
        self.environ = {"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"}
        self.headers = {"Origin": "http://localhost:5173", "X-CSRF-Token": "csrf"}
        self.client = self.build_client(ChannelBAccess(lambda: self.manager.bot, self.audit))

    def build_client(self, access):
        boundary = AdminHttpBoundary(self.auth, channel_b_access=access)
        client = create_app(JsonFileStore(self.root / "snapshot.json"), VoiceEventStore(), None, admin_http=boundary).test_client()
        client.set_cookie("leda_admin_session", "session", path="/api/leda/admin")
        return client

    def seed(self, chats):
        self.repository.write(state(chats))

    def decide(self, chat_id, action, **overrides):
        return self.client.post(
            f"{LIST_ROUTE}/{chat_id}/{action}",
            headers=overrides.get("headers", self.headers),
            environ_overrides=overrides.get("environ", self.environ),
        )

    def status_of(self, chat_id):
        return self.repository.status_of(123, chat_id)

    # Protection: exactly the checks of the existing credential routes.

    def test_every_route_requires_an_admin_session(self):
        self.auth.read_session.return_value = None
        self.seed({"7": chat("pending")})
        responses = [
            self.client.get(LIST_ROUTE, environ_overrides=self.environ),
            self.decide(7, "approve"),
            self.decide(7, "reject"),
            self.decide(7, "revoke"),
        ]
        for response in responses:
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.get_json()["error"], "AUTHENTICATION_REQUIRED")
            self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(self.status_of(7), "pending")
        self.audit.record.assert_not_called()

    def test_decisions_require_origin_csrf_and_a_loopback_peer_before_any_effect(self):
        self.seed({"7": chat("pending")})
        no_origin = self.decide(7, "approve", headers={"X-CSRF-Token": "csrf"})
        foreign_origin = self.decide(7, "approve", headers={"Origin": "http://evil.example", "X-CSRF-Token": "csrf"})
        no_csrf = self.decide(7, "approve", headers={"Origin": "http://localhost:5173"})
        wrong_csrf = self.decide(7, "approve", headers={"Origin": "http://localhost:5173", "X-CSRF-Token": "wrong"})
        non_ascii_csrf = self.decide(7, "approve", headers={"Origin": "http://localhost:5173", "X-CSRF-Token": "é"})
        remote = self.decide(7, "approve", environ={"REMOTE_ADDR": "203.0.113.9", "HTTP_HOST": "localhost"})
        self.assertEqual([r.status_code for r in (no_origin, foreign_origin, remote)], [403, 403, 403])
        self.assertEqual(no_origin.get_json()["error"], "AUTH_TRANSPORT_REJECTED")
        for response in (no_csrf, wrong_csrf, non_ascii_csrf):
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.get_json()["error"], "CSRF_VALIDATION_FAILED")
        self.assertEqual(self.status_of(7), "pending")
        self.bot.send_approval_notice.assert_not_called()
        self.audit.record.assert_not_called()

    def test_the_list_needs_no_origin_and_other_methods_are_refused(self):
        self.assertEqual(self.client.get(LIST_ROUTE, environ_overrides=self.environ).status_code, 200)
        self.assertEqual(self.client.post(LIST_ROUTE, headers=self.headers, environ_overrides=self.environ).status_code, 405)
        self.assertEqual(self.client.get(f"{LIST_ROUTE}/7/approve", environ_overrides=self.environ).status_code, 405)
        self.assertEqual(self.decide(7, "delete").status_code, 404)

    # List.

    def test_the_list_has_a_strict_shape_and_orders_pending_first_oldest_request_first(self):
        self.seed({
            "1": chat("revoked", name="Rita", requested="2026-09-01T00:00:00Z"),
            "2": chat("approved", name="Aldo", requested="2026-09-02T00:00:00Z"),
            "3": chat("pending", name="Nueva", username=None, requested="2026-10-01T12:00:00Z"),
            "4": chat("pending", name="Vieja", requested="2026-10-01T08:00:00Z"),
            "5": chat("rejected", name="Rosa", requested="2026-09-03T00:00:00Z"),
            "6": chat("approved", name="Beto", requested="2026-09-04T00:00:00Z"),
        })
        response = self.client.get(LIST_ROUTE, environ_overrides=self.environ)
        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(set(payload), {"ok", "chats"})
        self.assertTrue(payload["ok"])
        self.assertEqual([entry["chatId"] for entry in payload["chats"]], [4, 3, 2, 6, 1, 5])
        for entry in payload["chats"]:
            self.assertEqual(set(entry), CHAT_FIELDS)
            self.assertIsInstance(entry["chatId"], int)
        self.assertEqual(payload["chats"][1], {"chatId": 3, "status": "pending", "displayName": "Nueva", "username": None, "requestedAt": "2026-10-01T12:00:00Z", "decidedAt": None})

    def test_an_empty_list_is_an_empty_array(self):
        self.assertEqual(self.client.get(LIST_ROUTE, environ_overrides=self.environ).get_json(), {"ok": True, "chats": []})

    def test_without_a_running_bot_identity_every_route_answers_a_stable_unavailable_code(self):
        unavailable_bots = (None, SimpleNamespace(bot_id=None, state_store=self.repository))
        for bot in unavailable_bots:
            with self.subTest(bot=bot):
                self.manager.bot = bot
                responses = [self.client.get(LIST_ROUTE, environ_overrides=self.environ), self.decide(7, "approve")]
                for response in responses:
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.get_json(), {"ok": False, "error": "CHANNEL_B_ACCESS_UNAVAILABLE"})

    def test_a_boundary_composed_without_channel_b_access_answers_the_same_unavailable_code(self):
        client = self.build_client(None)
        for response in (client.get(LIST_ROUTE, environ_overrides=self.environ), client.post(f"{LIST_ROUTE}/7/approve", headers=self.headers, environ_overrides=self.environ)):
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.get_json()["error"], "CHANNEL_B_ACCESS_UNAVAILABLE")

    def test_an_unreadable_state_file_answers_a_stable_state_code(self):
        with patch.object(self.repository, "read", side_effect=TelegramStateUnavailable("C:/secret/path")):
            list_response = self.client.get(LIST_ROUTE, environ_overrides=self.environ)
            decision = self.decide(7, "approve")
        for response in (list_response, decision):
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.get_json(), {"ok": False, "error": "TELEGRAM_STATE_UNAVAILABLE"})

    # Decisions.

    def test_approving_a_pending_chat_records_it_notifies_and_audits_it(self):
        self.seed({"7": chat("pending")})
        response = self.decide(7, "approve")
        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(set(payload), {"ok", "chat", "noticeSent"})
        self.assertTrue(payload["ok"])
        self.assertIs(payload["noticeSent"], True)
        self.assertEqual(set(payload["chat"]), CHAT_FIELDS)
        self.assertEqual((payload["chat"]["chatId"], payload["chat"]["status"]), (7, "approved"))
        self.assertRegex(payload["chat"]["decidedAt"], r"Z$")
        self.assertEqual(self.status_of(7), "approved")
        self.bot.send_approval_notice.assert_called_once_with(7)
        self.audit.record.assert_called_once_with("approved", 123, 7, "admin")

    def test_reject_and_revoke_never_send_a_notice_and_audit_their_event(self):
        self.seed({"7": chat("pending"), "8": chat("approved")})
        rejected = self.decide(7, "reject")
        revoked = self.decide(8, "revoke")
        self.assertEqual((rejected.get_json()["chat"]["status"], revoked.get_json()["chat"]["status"]), ("rejected", "revoked"))
        self.assertEqual((rejected.get_json()["noticeSent"], revoked.get_json()["noticeSent"]), (False, False))
        self.bot.send_approval_notice.assert_not_called()
        self.assertEqual(
            [call.args for call in self.audit.record.call_args_list],
            [("rejected", 123, 7, "admin"), ("revoked", 123, 8, "admin")],
        )

    def test_every_allowed_transition_succeeds_and_every_other_is_a_409_without_effects(self):
        routes = {"approve": "approved", "reject": "rejected", "revoke": "revoked"}
        allowed = {("pending", "approved"), ("pending", "rejected"), ("approved", "revoked"), ("rejected", "approved"), ("revoked", "approved")}
        for current in ("pending", "approved", "rejected", "revoked"):
            for action, target in routes.items():
                with self.subTest(current=current, action=action):
                    self.seed({"7": chat(current)})
                    self.audit.reset_mock()
                    self.bot.send_approval_notice.reset_mock()
                    before = self.repository.path.read_text(encoding="utf-8")
                    response = self.decide(7, action)
                    if (current, target) in allowed:
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(self.status_of(7), target)
                        self.audit.record.assert_called_once_with(target, 123, 7, "admin")
                    else:
                        self.assertEqual(response.status_code, 409)
                        self.assertEqual(response.get_json(), {"ok": False, "error": "CHANNEL_B_INVALID_TRANSITION"})
                        self.assertEqual(self.repository.path.read_text(encoding="utf-8"), before)
                        self.audit.record.assert_not_called()
                        self.bot.send_approval_notice.assert_not_called()

    def test_a_decision_on_an_unknown_chat_is_a_404(self):
        self.seed({"7": chat("pending")})
        response = self.decide(99, "approve")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json(), {"ok": False, "error": "CHANNEL_B_CHAT_NOT_FOUND"})
        self.audit.record.assert_not_called()

    def test_a_malformed_chat_id_is_a_400_before_any_effect(self):
        self.seed({"7": chat("pending")})
        for chat_id in ("abc", "07", "+7", "1.5", "7e0", "-", "--7", "%207", "9" * 25):
            with self.subTest(chat_id=chat_id):
                response = self.decide(chat_id, "approve")
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json(), {"ok": False, "error": "INVALID_CHAT_ID"})
        self.assertEqual(self.status_of(7), "pending")
        self.audit.record.assert_not_called()

    def test_a_failed_approval_notice_never_undoes_the_approval(self):
        self.seed({"7": chat("pending")})
        self.bot.send_approval_notice.side_effect = RuntimeError(NOTICE_ERROR_CANARY)
        with patch("leda_runtime.channel_b_access._logger") as logger:
            response = self.decide(7, "approve")
        self.assertEqual(response.status_code, 200)
        self.assertIs(response.get_json()["noticeSent"], False)
        self.assertEqual(response.get_json()["chat"]["status"], "approved")
        self.assertEqual(self.status_of(7), "approved")
        self.audit.record.assert_called_once_with("approved", 123, 7, "admin")
        logger.warning.assert_called_once()
        logged = " ".join(str(part) for part in logger.warning.call_args.args)
        self.assertNotIn(NOTICE_ERROR_CANARY, logged)
        self.assertNotIn(7, logger.warning.call_args.args)
        self.assertNotIn("7", logger.warning.call_args.args)

    def test_a_notice_that_reports_not_sent_is_surfaced_without_failing(self):
        self.seed({"7": chat("rejected")})
        self.bot.send_approval_notice.return_value = False
        response = self.decide(7, "approve")
        self.assertEqual(response.status_code, 200)
        self.assertIs(response.get_json()["noticeSent"], False)
        self.assertEqual(self.status_of(7), "approved")

    def test_an_audit_failure_never_breaks_a_decision(self):
        self.seed({"7": chat("pending")})
        self.audit.record.side_effect = RuntimeError("disk gone")
        response = self.decide(7, "approve")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.status_of(7), "approved")

    def test_the_notice_is_sent_after_the_approval_is_persisted(self):
        self.seed({"7": chat("pending")})
        seen = []
        self.bot.send_approval_notice.side_effect = lambda chat_id: seen.append(self.status_of(chat_id)) or True
        self.decide(7, "approve")
        self.assertEqual(seen, ["approved"])

    def test_responses_never_carry_message_text_or_secrets(self):
        self.seed({"7": chat("pending")})
        body = json.dumps(self.decide(7, "approve").get_json())
        self.assertNotIn("token", body.lower())


if __name__ == "__main__":
    unittest.main()
