"""Local names travel in existing context; no app, provider or worker is started."""

import itertools
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from prisma_runtime.channel_a_bot import (
    ChannelAPairingDialogue, PAIRING_CONFIRMED, PAIRING_PROMPT_DELIVERED,
)
from prisma_runtime.channel_a_pairing import ChannelAPairingRegistry
from prisma_runtime.hmi_sessions import HmiSessionRegistry


def entropy():
    counter = itertools.count(1)
    return lambda size: next(counter).to_bytes(size, "big")


def registry(now, **overrides):
    owners = itertools.count(1)
    options = dict(
        clock=lambda: now[0], entropy=entropy(),
        owner_factory=lambda: f"00000000-0000-4000-8000-{next(owners):012d}",
        idle_ttl=30, absolute_ttl=60,
    )
    options.update(overrides)
    return HmiSessionRegistry(**options)


class RegistryNameTests(unittest.TestCase):
    def setUp(self):
        self.now = [10.0]
        self.removed = []
        self.registry = registry(self.now, on_remove=self.removed.append)

    def named(self, name="Panel recepción"):
        capability, _ = self.registry.create()
        owner = self.registry.authorize(capability, touch=False)
        self.registry.set_context(capability, {"widgets": [], "hmiName": name})
        return capability, owner

    def name(self, owner):
        return self.registry.get_owner_name(owner, max_age_seconds=15)

    def test_exact_owner_lookup_and_two_owner_isolation(self):
        cap, owner = self.named()
        other_cap, other_owner = self.named("Panel bombas")
        self.assertEqual(self.name(owner), "Panel recepción")
        self.assertEqual(self.name(other_owner), "Panel bombas")
        self.assertIsNone(self.name(cap))
        self.assertIsNone(self.name("unknown"))
        self.registry.set_context(cap, {"widgets": [], "hmiName": None})
        self.assertIsNone(self.name(owner))
        self.assertEqual(self.name(other_owner), "Panel bombas")
        self.assertNotEqual(cap, other_cap)
        self.assertNotEqual(owner, other_owner)

    def test_context_missing_unset_and_invalidated_have_no_dashboard_fallback(self):
        cap, _ = self.registry.create()
        owner = self.registry.authorize(cap, touch=False)
        self.assertIsNone(self.name(owner))
        self.registry.set_context(cap, {"widgets": [], "dashboard": {"name": "Not the HMI name"}})
        self.assertIsNone(self.name(owner))
        self.registry.set_context(cap, {"widgets": [], "hmiName": "Panel"})
        self.assertEqual(self.name(owner), "Panel")
        self.registry.apply_context_command(cap, {"version": 1, "command": "invalidate", "order": 1})
        self.assertIsNone(self.name(owner))

    def test_name_requires_fresh_server_received_context(self):
        cap, owner = self.named()
        self.now[0] = 25.0
        self.assertEqual(self.name(owner), "Panel recepción")
        self.now[0] = 25.001
        self.assertIsNone(self.name(owner))
        self.registry.set_context(cap, {"widgets": [], "hmiName": "Panel nuevo"})
        self.assertEqual(self.name(owner), "Panel nuevo")

    def test_expired_and_closed_owners_have_no_name(self):
        for options, refresh_at, expires_at in (
            ({"idle_ttl": 5}, None, 15.0),
            ({"absolute_ttl": 12}, 21.0, 22.0),
        ):
            with self.subTest(options=options):
                self.now[0] = 10.0
                self.registry = registry(self.now, **options)
                cap, owner = self.named()
                received_at = self.now[0]
                if refresh_at is not None:
                    self.now[0] = refresh_at
                    self.registry.set_context(
                        cap, {"widgets": [], "hmiName": "Panel recepción"}
                    )
                    received_at = refresh_at
                self.now[0] = expires_at
                self.assertLess(expires_at - received_at, 15)
                self.assertIsNone(self.name(owner))

        self.now[0] = 10.0
        self.registry = registry(self.now)
        cap, owner = self.named()
        self.registry.close(cap)
        self.assertIsNone(self.name(owner))

    def test_lookup_does_not_touch_presence_context_or_removal_callbacks(self):
        _, owner = self.named()
        session = next(iter(self.registry._sessions.values()))
        before = vars(session).copy()
        self.now[0] = 14.0
        self.assertEqual(self.name(owner), "Panel recepción")
        self.assertEqual(vars(session), before)
        self.now[0] = 40.0
        self.assertIsNone(self.name(owner))
        self.assertEqual(vars(session), before)
        self.assertEqual(len(self.registry._sessions), 1)
        self.assertEqual(self.removed, [])


class PhoneNameTests(unittest.TestCase):
    def setUp(self):
        guard = patch("requests.Session.request", side_effect=AssertionError("TEST_NETWORK_REFUSED"))
        dispatch = guard.start()
        self.addCleanup(guard.stop)
        self.addCleanup(dispatch.assert_not_called)
        self.now = [10.0]
        self.sessions = registry(self.now)
        self.cap, _ = self.sessions.create()
        self.owner = self.sessions.authorize(self.cap, touch=False)
        self.sessions.set_context(self.cap, {
            "widgets": [], "hmiName": "Panel recepción", "dashboard": "Not the label",
        })
        self.pairing = ChannelAPairingRegistry(warning_lead=60, clock=lambda: self.now[0], entropy=entropy())
        self.transport = Mock()
        self.sent = []

        def send(**payload):
            self.sent.append(payload)
            return {"ok": True, "result": {"message_id": len(self.sent), "date": 1,
                    "chat": {"id": payload["chat_id"], "type": "private"},
                    "from": {"id": 700100, "is_bot": True}, "text": "accepted"}}

        self.transport.send_message.side_effect = send
        self.transport.answer_callback_query.return_value = {"ok": True, "result": True}
        self.dialogue = ChannelAPairingDialogue(
            bot_id=700100, registry=self.pairing, transport=self.transport,
            destination_label=lambda owner: self.sessions.get_owner_name(owner, max_age_seconds=15),
            clock=lambda: self.now[0], entropy=entropy(), epoch_factory=lambda: "name-test-epoch",
        )

    def test_phone_prompt_and_confirmation_use_the_exact_session_context_name(self):
        token = self.pairing.issue_qr(self.owner).token
        prompt = self.dialogue.handle_update({"update_id": 1, "message": {
            "message_id": 11, "chat": {"id": 5001, "type": "private"},
            "from": {"id": 5001, "is_bot": False}, "text": "/start " + token,
        }})
        self.assertEqual(prompt.kind, PAIRING_PROMPT_DELIVERED)
        self.assertIn("Panel recepción", self.sent[-1]["text"])
        self.assertNotIn("Not the label", self.sent[-1]["text"])
        self.assertNotIn(self.cap, self.sent[-1]["text"])
        self.assertNotIn("parse_mode", self.sent[-1])
        data = self.sent[-1]["reply_markup"]["inline_keyboard"][0][0]["callback_data"]
        confirmation = self.dialogue.handle_update({"update_id": 2, "callback_query": {
            "id": "cb-name", "from": {"id": 5001, "is_bot": False}, "data": data,
            "message": {"message_id": 1, "date": 1, "text": "prompt",
                        "chat": {"id": 5001, "type": "private"}, "from": {"id": 700100, "is_bot": True}},
        }})
        self.assertEqual(confirmation.kind, PAIRING_CONFIRMED)
        self.assertEqual(self.pairing.phone_link("tg:5001").owner_id, self.owner)


if __name__ == "__main__":
    unittest.main()
