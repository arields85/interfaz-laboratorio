"""Behavioral contract tests for the Channel A private pairing dialogue (RCA-3a).

The dialogue is driven end to end through a fake, text-only transport that
records every call and returns scripted raw Bot API responses. The real
``ChannelAPairingRegistry`` is injected, so no test performs network I/O, reads
credentials or starts a bot.
"""

import dataclasses
import itertools
import sys
import threading
import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime import channel_a_bot as bot_module
from prisma_runtime.channel_a_bot import (
    ACTION_REFUSED,
    BUTTON_CANCEL,
    BUTTON_CONFIRM,
    BUTTON_KEEP_CONNECTED,
    BUTTON_UNLINK,
    CALLBACK_CANCEL,
    CALLBACK_CONFIRM,
    CALLBACK_DATA_MAX_BYTES,
    CALLBACK_KEEP_CONNECTED,
    CALLBACK_UNLINK,
    CONFIRMATION_PROMPT_TEMPLATE,
    COPY_ACTION_REFUSED,
    COPY_CANCELLED,
    COPY_CONFIRMED,
    COPY_DESTINATION_UNAVAILABLE,
    COPY_KEEP_CONNECTED,
    COPY_REFUSED,
    COPY_UNLINKED,
    INGRESS_IGNORED_AMBIGUOUS,
    INGRESS_IGNORED_MALFORMED,
    INGRESS_IGNORED_STALE,
    INGRESS_IGNORED_UNRELATED,
    INGRESS_IGNORED_UNSUPPORTED,
    KEEP_CONNECTED,
    MAX_LABEL_CHARS,
    MAX_TELEGRAM_ID,
    OPAQUE_CHARS,
    PAIRING_CANCELLED,
    PAIRING_CONFIRMED,
    PAIRING_DESTINATION_UNAVAILABLE,
    PAIRING_PROMPT_DELIVERED,
    PAIRING_PROMPT_REJECTED,
    PAIRING_PROMPT_UNKNOWN,
    PAIRING_REFUSED,
    PAIRING_WELCOME_REJECTED,
    PAIRING_WELCOME_UNKNOWN,
    PHONE_ID_PREFIX,
    PRISMA_CHANNEL_A_BOT_CONFIG_INVALID,
    PRISMA_CHANNEL_A_BOT_UNAVAILABLE,
    QUERY_IGNORED_UNBOUND,
    SEND_DELIVERED,
    SEND_NONE,
    SEND_REJECTED,
    SEND_UNKNOWN,
    UNLINKED,
    URLSAFE_ALPHABET,
    VARIANT_CALLBACK,
    VARIANT_MESSAGE,
    VARIANT_UNKNOWN,
    WELCOME_TEMPLATE,
    ChannelABotConfigInvalid,
    ChannelABotError,
    ChannelAPairingDialogue,
    ChannelATextTransport,
    IngressOutcome,
    phone_identity,
)
from prisma_runtime.channel_a_pairing import ChannelAPairingRegistry
from prisma_runtime.channel_a_query import (
    COPY_QUERY_UNAVAILABLE,
    QUERY_ANSWER_DELIVERED,
    QUERY_ANSWER_REJECTED,
    QUERY_ANSWER_UNKNOWN,
    QUERY_ANSWER_UNPUBLISHED,
    QUERY_IGNORED_BLANK,
    QUERY_IGNORED_COMMAND,
    QUERY_IGNORED_MALFORMED,
    QUERY_IGNORED_OVERSIZE,
    QUERY_IGNORED_STALE,
    QUERY_UNAVAILABLE,
    ChannelAQueryConfigInvalid,
    ChannelAQueryCoordinator,
)
from prisma_runtime.hmi_sessions import HmiSessionRegistry
from prisma_runtime.local_presentation import answer_from_snapshot

BOT_ID = 700100
OTHER_BOT_ID = 700101
URLSAFE_CHARS = set(URLSAFE_ALPHABET)
_UNSET = object()


def owner_id(index):
    return "00000000-0000-4000-8000-%012d" % index


def chat_id(index):
    return 5000 + index


OWNER = owner_id(1)
OWNER2 = owner_id(2)
OWNER3 = owner_id(3)
CHAT_ID = chat_id(1)
CHAT_ID_2 = chat_id(2)
CHAT_ID_3 = chat_id(3)
PHONE = PHONE_ID_PREFIX + str(CHAT_ID)
PHONE2 = PHONE_ID_PREFIX + str(CHAT_ID_2)
PHONE3 = PHONE_ID_PREFIX + str(CHAT_ID_3)


def sequential_entropy():
    counter = itertools.count(1)

    def entropy(size):
        return next(counter).to_bytes(size, "big")

    return entropy


def message_update(update_id, text="/start", *, chat, from_id=None, message_id=11, remove=()):
    """Build one private text ``message`` update accepted by the dialogue."""
    sender = chat if from_id is None else from_id
    message = {
        "message_id": message_id,
        "chat": {"id": chat, "type": "private"},
        "from": {"id": sender, "is_bot": False},
        "text": text,
    }
    for name in remove:
        message.pop(name, None)
    return {"update_id": update_id, "message": message}


def callback_update(update_id, data, *, chat=CHAT_ID, from_id=None, callback_id="cb-1", message_id=7):
    """Build one private ``callback_query`` update authored by the configured bot."""
    sender = chat if from_id is None else from_id
    return {
        "update_id": update_id,
        "callback_query": {
            "id": callback_id,
            "from": {"id": sender, "is_bot": False},
            "message": {
                "message_id": message_id,
                "date": 1,
                "chat": {"id": chat, "type": "private"},
                "from": {"id": BOT_ID, "is_bot": True},
                "text": "message",
            },
            "data": data,
        },
    }


class FakeTransport:
    """Text-only transport double: records calls and replays scripted responses."""

    def __init__(self, *, bot_id=BOT_ID, send_responses=None, ack_responses=None):
        self.bot_id = bot_id
        self.sent = []
        self.answered = []
        self.calls = []
        self.send_responses = list(send_responses or ())
        self.ack_responses = list(ack_responses or ())
        self.on_send = None
        self.on_ack = None

    def delivered(self, chat, *, message_id=1):
        return {
            "ok": True,
            "result": {
                "message_id": message_id,
                "date": 1,
                "text": "accepted",
                "chat": {"id": chat, "type": "private"},
                "from": {"id": self.bot_id, "is_bot": True},
            },
        }

    @staticmethod
    def rejected(*, error_code=400, description="Bad Request: chat not found"):
        return {"ok": False, "error_code": error_code, "description": description}

    def send_message(self, **payload):
        self.calls.append("send_message")
        self.sent.append(payload)
        if self.on_send is not None:
            self.on_send(payload)
        if self.send_responses:
            return self.send_responses.pop(0)
        return self.delivered(payload["chat_id"])

    def answer_callback_query(self, **payload):
        self.calls.append("answer_callback_query")
        self.answered.append(payload)
        if self.on_ack is not None:
            self.on_ack(payload)
        if self.ack_responses:
            return self.ack_responses.pop(0)
        return {"ok": True, "result": True}


class _ConcurrencyProbe:
    """Wrap a lock and record how many holders sit inside it at the same time."""

    def __init__(self, inner):
        self._inner = inner
        self._depth = 0
        self.max_depth = 0
        self._guard = threading.Lock()

    def __enter__(self):
        self._inner.acquire()
        with self._guard:
            self._depth += 1
            self.max_depth = max(self.max_depth, self._depth)
        return self

    def __exit__(self, *exc_info):
        with self._guard:
            self._depth -= 1
        self._inner.release()
        return False


class ChannelABotTestCase(unittest.TestCase):
    def setUp(self):
        self.now = [1000.0]
        self.labels = {"value": "Sala 3 — Reactor"}
        self.label_calls = []
        self.registry = ChannelAPairingRegistry(
            warning_lead=60.0,
            clock=lambda: self.now[0],
            entropy=sequential_entropy(),
        )
        self.transport = FakeTransport()
        self.dialogue = self.build()

    def label(self, owner):
        self.label_calls.append(owner)
        value = self.labels["value"]
        if isinstance(value, BaseException):
            raise value
        return value

    def build(self, **overrides):
        options = {
            "bot_id": BOT_ID,
            "registry": self.registry,
            "transport": self.transport,
            "destination_label": self.label,
        }
        options.update(overrides)
        return ChannelAPairingDialogue(**options)

    # -- assertions --------------------------------------------------------

    def assert_outcome(
        self,
        outcome,
        kind,
        *,
        variant=None,
        delivery=None,
        accepted=True,
        update_id=_UNSET,
        acknowledged=_UNSET,
    ):
        self.assertIsInstance(outcome, IngressOutcome)
        self.assertEqual(outcome.kind, kind)
        if variant is not None:
            self.assertEqual(outcome.variant, variant)
        if delivery is not None:
            self.assertEqual(outcome.delivery, delivery)
        if accepted is not None:
            self.assertEqual(outcome.accepted, accepted)
        if update_id is not _UNSET:
            self.assertEqual(outcome.update_id, update_id)
        if acknowledged is not _UNSET:
            self.assertEqual(outcome.acknowledged, acknowledged)

    def assert_quiet(self):
        self.assertEqual(self.transport.calls, [])
        self.assertEqual(self.transport.sent, [])
        self.assertEqual(self.transport.answered, [])

    # -- drivers -----------------------------------------------------------

    def handle(self, update, dialogue=None):
        return (dialogue or self.dialogue).handle_update(update)

    def tick(self):
        """Return an update identifier strictly above the current high-water mark."""
        return self.dialogue._last_update_id + 1

    def issue(self, owner=OWNER):
        return self.registry.issue_qr(owner).token

    def prompted(self, update_id, *, owner=OWNER, chat=CHAT_ID, token=None):
        if token is None:
            token = self.issue(owner)
        outcome = self.handle(message_update(update_id, "/start " + token, chat=chat))
        self.assert_outcome(outcome, PAIRING_PROMPT_DELIVERED, variant=VARIANT_MESSAGE, update_id=update_id)
        return outcome

    def button_data(self, row):
        rows = self.transport.sent[-1]["reply_markup"]["inline_keyboard"]
        return rows[row][0]["callback_data"]

    def prompt_ticket(self):
        return self.button_data(0).split(":", 1)[1]

    def footer_nonce(self):
        return self.button_data(0).split(":", 1)[1]

    def pair_up(self, claim_id, confirm_id, *, owner=OWNER, chat=CHAT_ID):
        self.prompted(claim_id, owner=owner, chat=chat)
        ticket = self.prompt_ticket()
        outcome = self.handle(callback_update(confirm_id, CALLBACK_CONFIRM + ":" + ticket, chat=chat))
        self.assert_outcome(
            outcome,
            PAIRING_CONFIRMED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_DELIVERED,
            accepted=True,
            update_id=confirm_id,
            acknowledged=True,
        )
        return self.footer_nonce()


class ChannelABotConfigTests(ChannelABotTestCase):
    def test_missing_bot_id_keyword_is_a_programming_error(self):
        with self.assertRaises(TypeError):
            ChannelAPairingDialogue(
                registry=self.registry,
                transport=self.transport,
                destination_label=self.label,
            )

    def test_bot_id_must_be_a_positive_bounded_integer(self):
        for value in (None, True, False, 0, -1, MAX_TELEGRAM_ID + 1, "700100", 700100.0):
            with self.subTest(value=value):
                with self.assertRaises(ChannelABotConfigInvalid) as captured:
                    self.build(bot_id=value)
                self.assertEqual(str(captured.exception), PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)

    def test_registry_must_be_the_real_pairing_registry(self):
        class Stub:
            warning_lead = 60.0
            qr_ttl = 60.0

            def issue_qr(self, owner_id):
                return None

        for value in (Stub(), None, object(), dict):
            with self.subTest(value=value):
                with self.assertRaises(ChannelABotConfigInvalid):
                    self.build(registry=value)

    def test_transport_must_expose_both_text_only_calls(self):
        class SendOnly:
            def send_message(self, **payload):
                return None

        class AckOnly:
            def answer_callback_query(self, **payload):
                return None

        for value in (SendOnly(), AckOnly(), object(), None, "transport"):
            with self.subTest(value=value):
                with self.assertRaises(ChannelABotConfigInvalid):
                    self.build(transport=value)

    def test_destination_label_and_entropy_must_be_callable(self):
        for overrides in ({"destination_label": "label"}, {"entropy": 5}, {"entropy": None}):
            with self.subTest(overrides=overrides):
                with self.assertRaises(ChannelABotConfigInvalid):
                    self.build(**overrides)

    def test_clock_defaults_to_the_registry_clock_and_must_be_callable(self):
        broken = ChannelAPairingRegistry(
            warning_lead=60.0, clock=lambda: 1000.0, entropy=sequential_entropy()
        )
        broken.clock = 5
        with self.assertRaises(ChannelABotConfigInvalid):
            self.build(registry=broken)
        dialogue = self.build(clock=lambda: 1000.0)
        self.assertTrue(callable(dialogue.clock))

    def test_bound_counts_must_be_positive_bounded_integers(self):
        for field in ("max_link_actions", "max_pending_claims"):
            for value in (0, -1, True, False, "4", 4.0, None):
                with self.subTest(field=field, value=value):
                    with self.assertRaises(ChannelABotConfigInvalid):
                        self.build(**{field: value})

    def test_configured_values_are_exposed_for_inspection(self):
        dialogue = self.build(max_link_actions=3, max_pending_claims=2)
        self.assertEqual(dialogue.bot_id, BOT_ID)
        self.assertEqual(dialogue.max_link_actions, 3)
        self.assertEqual(dialogue.max_pending_claims, 2)
        self.assertIs(dialogue.registry, self.registry)
        self.assertIs(dialogue.transport, self.transport)

    def test_config_error_str_is_the_error_code(self):
        with self.assertRaises(ChannelABotError) as captured:
            self.build(bot_id=0)
        self.assertEqual(str(captured.exception), PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
        unavailable = ChannelABotError(PRISMA_CHANNEL_A_BOT_UNAVAILABLE)
        self.assertEqual(str(unavailable), PRISMA_CHANNEL_A_BOT_UNAVAILABLE)

    def test_phone_identity_is_derived_from_the_authenticated_actor(self):
        self.assertEqual(phone_identity(CHAT_ID), PHONE)
        self.assertEqual(PHONE_ID_PREFIX, "tg:")
        for value in (True, 0, -1, MAX_TELEGRAM_ID + 1, "5001", 5001.0, None):
            with self.subTest(value=value):
                with self.assertRaises(ChannelABotConfigInvalid):
                    phone_identity(value)

    def test_transport_protocol_declares_exactly_two_calls(self):
        names = {name for name in vars(ChannelATextTransport) if not name.startswith("_")}
        self.assertEqual(names, {"send_message", "answer_callback_query"})

    def test_ingress_outcome_is_frozen_and_serializes_camel_case(self):
        outcome = IngressOutcome(1, VARIANT_MESSAGE, PAIRING_PROMPT_DELIVERED, True, SEND_DELIVERED, True)
        self.assertEqual(
            outcome.as_dict(),
            {
                "updateId": 1,
                "variant": VARIANT_MESSAGE,
                "kind": PAIRING_PROMPT_DELIVERED,
                "accepted": True,
                "delivery": SEND_DELIVERED,
                "acknowledged": True,
            },
        )
        with self.assertRaises(FrozenInstanceError):
            outcome.kind = PAIRING_REFUSED

    def test_new_adapter_starts_with_empty_maps_and_no_watermark(self):
        self.assertEqual(self.dialogue._pending_claims, {})
        self.assertEqual(self.dialogue._actions, {})
        # The sentinel sits below the smallest valid update identifier (zero).
        self.assertEqual(self.dialogue._last_update_id, -1)

    def test_adapter_and_module_hold_no_unbounded_index(self):
        containers = [
            name for name, value in vars(self.dialogue).items() if isinstance(value, (dict, list, set))
        ]
        self.assertEqual(containers, ["_pending_claims", "_actions"])
        for name, value in vars(bot_module).items():
            if name.startswith("__"):
                continue
            self.assertNotIsInstance(value, (list, dict, set), msg=name)

    def test_module_has_no_ambient_network_or_process_capabilities(self):
        for name in (
            "requests",
            "socket",
            "urllib",
            "http",
            "subprocess",
            "telegram_lifecycle",
            "local_presentation",
        ):
            with self.subTest(name=name):
                self.assertNotIn(name, vars(bot_module))

    def test_source_avoids_unimplemented_channel_a_surfaces(self):
        source = Path(bot_module.__file__).read_text(encoding="utf-8")
        for name in (
            "get_updates",
            "getUpdates(",
            "get_me",
            "delete_message",
            "edit_message_text",
            "send_photo",
            "send_audio",
            "set_webhook",
            "delete_webhook",
            "set_my_commands",
        ):
            with self.subTest(name=name):
                self.assertNotIn(name, source)

    def test_module_docstring_declares_the_stage_scope(self):
        doc = bot_module.__doc__ or ""
        for snippet in ("Channel A", "RCA-3a", "getUpdates", "unknown"):
            with self.subTest(snippet=snippet):
                self.assertIn(snippet, doc)


class ChannelAUpdateShapeTests(ChannelABotTestCase):
    def test_non_mapping_bodies_are_malformed_but_never_raise(self):
        for body in (None, "text", 5, 5.5, [], (), object()):
            with self.subTest(body=body):
                outcome = self.handle(body)
                self.assert_outcome(
                    outcome,
                    INGRESS_IGNORED_MALFORMED,
                    variant=VARIANT_UNKNOWN,
                    delivery=SEND_NONE,
                    accepted=True,
                    update_id=None,
                    acknowledged=None,
                )
        self.assert_quiet()

    def test_update_id_must_be_a_bounded_non_negative_integer(self):
        for value in (None, True, False, -1, MAX_TELEGRAM_ID + 1, "1", 1.0):
            with self.subTest(value=value):
                update = message_update(1, "/start", chat=CHAT_ID)
                update["update_id"] = value
                outcome = self.handle(update)
                self.assert_outcome(
                    outcome, INGRESS_IGNORED_MALFORMED, update_id=None, accepted=False
                )
        self.assert_quiet()

    def test_zero_and_the_upper_bound_are_valid_update_ids(self):
        for value in (0, MAX_TELEGRAM_ID):
            with self.subTest(value=value):
                self.setUp()
                self.assert_outcome(
                    self.handle({"update_id": value, "unexpected_variant": {}}),
                    INGRESS_IGNORED_UNSUPPORTED,
                    update_id=value,
                    accepted=True,
                )
                self.assertEqual(self.dialogue._last_update_id, value)

    def test_unknown_variant_is_unsupported_and_reserves_the_watermark(self):
        outcome = self.handle({"update_id": 4, "unexpected_variant": {}})
        self.assert_outcome(outcome, INGRESS_IGNORED_UNSUPPORTED, update_id=4, accepted=True)
        self.assert_quiet()
        self.assertEqual(self.dialogue._last_update_id, 4)

    def test_known_but_unsupported_variants_are_ignored_without_side_effects(self):
        for key in ("edited_message", "channel_post", "inline_query", "poll_answer", "my_chat_member"):
            with self.subTest(key=key):
                self.setUp()
                outcome = self.handle({"update_id": 4, key: {}})
                self.assert_outcome(outcome, INGRESS_IGNORED_UNSUPPORTED, update_id=4)
                self.assert_quiet()

    def test_two_supported_variants_are_ambiguous_and_never_parsed(self):
        update = message_update(4, "/start " + self.issue(), chat=CHAT_ID)
        update["callback_query"] = callback_update(4, CALLBACK_CONFIRM + ":" + "A" * OPAQUE_CHARS)[
            "callback_query"
        ]
        outcome = self.handle(update)
        self.assert_outcome(
            outcome, INGRESS_IGNORED_AMBIGUOUS, variant=VARIANT_UNKNOWN, update_id=4, accepted=True
        )
        self.assert_quiet()
        self.assertEqual(self.registry._pendings, {})
        self.assertEqual(len(self.registry._challenges), 1)

    def test_supported_variant_alongside_another_variant_key_is_ambiguous(self):
        update = message_update(4, "/start", chat=CHAT_ID)
        update["edited_message"] = {"message_id": 1}
        outcome = self.handle(update)
        self.assert_outcome(outcome, INGRESS_IGNORED_AMBIGUOUS, variant=VARIANT_UNKNOWN, update_id=4)
        self.assert_quiet()

    def test_unknown_additional_keys_are_ignored_when_one_variant_is_present(self):
        update = message_update(4, "/start", chat=CHAT_ID)
        update["custom_payload"] = {"anything": True}
        outcome = self.handle(update)
        self.assert_outcome(outcome, INGRESS_IGNORED_UNRELATED, variant=VARIANT_MESSAGE, update_id=4)

    def test_empty_or_foreign_message_objects_are_malformed(self):
        for value in (None, "message", [], 7):
            with self.subTest(value=value):
                self.setUp()
                outcome = self.handle({"update_id": 4, "message": value})
                self.assert_outcome(
                    outcome, INGRESS_IGNORED_MALFORMED, variant=VARIANT_MESSAGE, update_id=4
                )
                self.assert_quiet()

    def test_messages_without_text_are_unrelated(self):
        update_id = self.tick()
        update = message_update(update_id, remove=("text",), chat=CHAT_ID)
        self.assert_outcome(
            self.handle(update),
            INGRESS_IGNORED_UNRELATED,
            variant=VARIANT_MESSAGE,
            update_id=update_id,
        )
        update_id = self.tick()
        update = message_update(update_id, chat=CHAT_ID)
        update["message"]["text"] = None
        self.assert_outcome(
            self.handle(update),
            INGRESS_IGNORED_UNRELATED,
            variant=VARIANT_MESSAGE,
            update_id=update_id,
        )

    def test_oversized_or_non_text_payloads_are_malformed(self):
        update = message_update(4, {"nested": True}, chat=CHAT_ID)
        self.assert_outcome(
            self.handle(update), INGRESS_IGNORED_MALFORMED, variant=VARIANT_MESSAGE, update_id=4
        )
        self.setUp()
        update = message_update(4, "/start " + "A" * 200, chat=CHAT_ID)
        self.assert_outcome(
            self.handle(update), INGRESS_IGNORED_MALFORMED, variant=VARIANT_MESSAGE, update_id=4
        )

    def test_owner_uuid_in_free_text_is_never_authority(self):
        outcome = self.handle(message_update(4, OWNER, chat=CHAT_ID))
        self.assert_outcome(
            outcome, INGRESS_IGNORED_UNRELATED, variant=VARIANT_MESSAGE, update_id=4
        )
        self.assertEqual(self.registry._pendings, {})
        self.assert_quiet()


class ChannelAOrderingTests(ChannelABotTestCase):
    def test_duplicate_and_lower_update_ids_are_stale(self):
        self.handle(message_update(5, "hola", chat=CHAT_ID))
        for value in (5, 4, 1):
            with self.subTest(value=value):
                outcome = self.handle(message_update(value, "hola", chat=CHAT_ID))
                self.assert_outcome(
                    outcome,
                    INGRESS_IGNORED_STALE,
                    variant=VARIANT_UNKNOWN,
                    delivery=SEND_NONE,
                    accepted=False,
                    update_id=value,
                )
        self.assert_quiet()

    def test_stale_updates_are_never_parsed_even_with_a_live_token(self):
        token = self.issue()
        self.assert_outcome(
            self.handle(message_update(5, "/start " + token, chat=CHAT_ID)),
            PAIRING_PROMPT_DELIVERED,
            update_id=5,
        )
        self.assert_outcome(
            self.handle(message_update(5, "/start " + token, chat=CHAT_ID)),
            INGRESS_IGNORED_STALE,
            update_id=5,
            accepted=False,
        )
        self.assertEqual(len(self.transport.sent), 1)
        self.assertEqual(len(self.registry._pendings), 1)

    def test_replayed_token_after_the_watermark_moves_is_refused(self):
        token = self.issue()
        self.handle(message_update(5, "/start " + token, chat=CHAT_ID))
        outcome = self.handle(message_update(6, "/start " + token, chat=CHAT_ID))
        self.assert_outcome(outcome, PAIRING_REFUSED, update_id=6, delivery=SEND_DELIVERED)
        self.assertEqual(self.transport.sent[-1]["text"], COPY_REFUSED)

    def test_unsupported_updates_still_advance_the_watermark(self):
        self.handle({"update_id": 5, "unexpected_variant": {}})
        outcome = self.handle(message_update(5, "/start", chat=CHAT_ID))
        self.assert_outcome(outcome, INGRESS_IGNORED_STALE, update_id=5, accepted=False)

    def test_invalid_update_id_never_advances_the_watermark(self):
        update = message_update(1, "/start", chat=CHAT_ID)
        update["update_id"] = "nope"
        self.handle(update)
        self.assertEqual(self.dialogue._last_update_id, -1)
        self.assert_outcome(
            self.handle(message_update(1, "/start", chat=CHAT_ID)),
            INGRESS_IGNORED_UNRELATED,
            update_id=1,
        )

    def test_watermark_never_moves_backwards(self):
        self.handle({"update_id": 10, "unexpected_variant": {}})
        self.assert_outcome(
            self.handle(message_update(6, "hola", chat=CHAT_ID)),
            INGRESS_IGNORED_STALE,
            update_id=6,
            accepted=False,
        )
        self.assertEqual(self.dialogue._last_update_id, 10)
        self.assert_outcome(
            self.handle(message_update(11, "hola", chat=CHAT_ID)),
            INGRESS_IGNORED_UNRELATED,
            update_id=11,
        )

    def test_ingress_lock_is_a_reentrant_rlock(self):
        lock = self.dialogue._lock
        self.assertIsInstance(lock, type(threading.RLock()))
        self.assertTrue(lock.acquire(blocking=False))
        self.assertTrue(lock.acquire(blocking=False))
        lock.release()
        lock.release()

    def test_reentrant_ingress_during_a_send_is_serialized_not_deadlocked(self):
        inner = []

        def on_send(payload):
            if inner:
                return
            inner.append(self.handle(message_update(5, "hola", chat=CHAT_ID)))

        self.transport.on_send = on_send
        outcome = self.handle(message_update(5, "/start " + "A" * OPAQUE_CHARS, chat=CHAT_ID))
        self.assert_outcome(outcome, PAIRING_REFUSED, update_id=5)
        self.assert_outcome(inner[0], INGRESS_IGNORED_STALE, update_id=5, accepted=False)

    def test_each_adapter_instance_owns_its_own_ordering_epoch(self):
        fresh = self.build()
        self.assert_outcome(
            fresh.handle_update(message_update(5, "/start", chat=CHAT_ID)),
            INGRESS_IGNORED_UNRELATED,
            update_id=5,
        )
        self.assertEqual(self.dialogue._last_update_id, -1)


class ChannelAPrivateIdentityTests(ChannelABotTestCase):
    def assert_malformed_message(self, mutate):
        update_id = self.tick()
        update = message_update(update_id, "/start", chat=CHAT_ID)
        mutate(update)
        outcome = self.handle(update)
        self.assert_outcome(
            outcome, INGRESS_IGNORED_MALFORMED, variant=VARIANT_MESSAGE, update_id=update_id
        )
        self.assert_quiet()

    def test_only_private_one_to_one_chats_are_accepted(self):
        for kind in ("group", "channel", "supergroup", "private "):
            with self.subTest(kind=kind):
                self.setUp()
                self.assert_malformed_message(
                    lambda update, kind=kind: update["message"]["chat"].__setitem__("type", kind)
                )

    def test_chat_must_equal_the_human_sender(self):
        self.assert_malformed_message(
            lambda update: update["message"]["from"].__setitem__("id", CHAT_ID_2)
        )

    def test_bots_and_unproven_senders_are_rejected(self):
        for value in (True, None):
            with self.subTest(value=value):
                self.setUp()
                self.assert_malformed_message(
                    lambda update, value=value: update["message"]["from"].__setitem__("is_bot", value)
                )

    def test_missing_or_foreign_message_participants_are_rejected(self):
        self.assert_malformed_message(lambda update: update["message"].pop("from"))
        self.assert_malformed_message(lambda update: update["message"].pop("chat"))
        self.assert_malformed_message(lambda update: update["message"].__setitem__("chat", "private"))
        self.assert_malformed_message(lambda update: update["message"].__setitem__("from", []))

    def test_ambiguous_message_envelopes_are_rejected(self):
        self.assert_malformed_message(
            lambda update: update["message"].__setitem__("via_bot", {"id": 1})
        )
        self.assert_malformed_message(
            lambda update: update["message"].__setitem__("sender_chat", {"id": 1})
        )
        self.assert_malformed_message(
            lambda update: update["message"].__setitem__("business_connection_id", "bc-1")
        )

    def test_message_and_actor_ids_are_bounded(self):
        for value in (None, True, 0, -1, MAX_TELEGRAM_ID + 1, "11"):
            with self.subTest(value=value):
                self.setUp()
                self.assert_malformed_message(
                    lambda update, value=value: update["message"].__setitem__("message_id", value)
                )
        self.assert_malformed_message(lambda update: update["message"]["from"].__setitem__("id", 0))

    def test_identifier_bound_matches_the_documented_limit(self):
        self.assertEqual(MAX_TELEGRAM_ID, 2**53 - 1)
        self.assertEqual(
            phone_identity(MAX_TELEGRAM_ID), PHONE_ID_PREFIX + str(MAX_TELEGRAM_ID)
        )
        for value in (MAX_TELEGRAM_ID + 1, 0, -1, True, "5"):
            with self.subTest(value=value):
                with self.assertRaises(ChannelABotConfigInvalid):
                    phone_identity(value)

    def assert_malformed_callback(self, mutate):
        update_id = self.tick()
        update = callback_update(update_id, CALLBACK_CONFIRM + ":" + "A" * OPAQUE_CHARS)
        mutate(update)
        outcome = self.handle(update)
        self.assert_outcome(
            outcome,
            INGRESS_IGNORED_MALFORMED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_NONE,
            update_id=update_id,
            acknowledged=None,
        )
        self.assert_quiet()

    def test_callback_needs_an_accessible_private_message_in_the_same_chat(self):
        self.assert_malformed_callback(lambda update: update["callback_query"].pop("message"))
        self.assert_malformed_callback(
            lambda update: update["callback_query"].__setitem__("message", "message")
        )
        self.assert_malformed_callback(
            lambda update: update["callback_query"]["message"]["chat"].__setitem__("type", "group")
        )
        self.assert_malformed_callback(
            lambda update: update["callback_query"]["message"]["chat"].__setitem__("id", CHAT_ID_2)
        )
        self.assert_malformed_callback(
            lambda update: update["callback_query"]["message"].__setitem__("message_id", 0)
        )
        self.assert_malformed_callback(
            lambda update: update["callback_query"]["message"].pop("date")
        )

    def test_callback_message_date_must_be_a_bounded_positive_integer(self):
        for value in (None, True, 0, -1, MAX_TELEGRAM_ID + 1, "1", 1.0):
            with self.subTest(value=value):
                self.setUp()
                self.assert_malformed_callback(
                    lambda update, value=value: update["callback_query"]["message"].__setitem__(
                        "date", value
                    )
                )

    def test_callback_message_must_be_authored_by_the_configured_bot(self):
        self.assert_malformed_callback(
            lambda update: update["callback_query"]["message"]["from"].__setitem__("id", OTHER_BOT_ID)
        )
        self.assert_malformed_callback(
            lambda update: update["callback_query"]["message"]["from"].__setitem__("is_bot", False)
        )
        self.assert_malformed_callback(lambda update: update["callback_query"]["message"].pop("from"))

    def test_callback_rejects_inline_business_and_forwarding_ambiguity(self):
        self.assert_malformed_callback(
            lambda update: update["callback_query"].__setitem__("inline_message_id", "inline-1")
        )
        self.assert_malformed_callback(
            lambda update: update["callback_query"].__setitem__("via_bot", {"id": 1})
        )
        self.assert_malformed_callback(
            lambda update: update["callback_query"].__setitem__("business_connection_id", "bc-1")
        )
        self.assert_malformed_callback(
            lambda update: update["callback_query"]["message"].__setitem__("via_bot", {"id": 1})
        )
        self.assert_malformed_callback(
            lambda update: update["callback_query"]["message"].__setitem__(
                "sender_chat", {"id": 1}
            )
        )
        self.assert_malformed_callback(
            lambda update: update["callback_query"]["message"].__setitem__(
                "business_connection_id", "bc-1"
            )
        )

    def test_callback_actor_must_be_a_bounded_human_private_identity(self):
        self.assert_malformed_callback(
            lambda update: update["callback_query"]["from"].__setitem__("is_bot", True)
        )
        self.assert_malformed_callback(
            lambda update: update["callback_query"]["from"].__setitem__("id", 0)
        )
        self.assert_malformed_callback(lambda update: update["callback_query"].pop("from"))

    def test_callback_id_must_be_a_bounded_ascii_string(self):
        for value in (None, True, "", "c" * 65, "cb-\u00f1", 7):
            with self.subTest(value=value):
                self.setUp()
                self.assert_malformed_callback(
                    lambda update, value=value: update["callback_query"].__setitem__("id", value)
                )


class ChannelAClaimTests(ChannelABotTestCase):
    def test_plain_start_is_unrelated_and_leaves_the_challenge_claimable(self):
        token = self.issue()
        outcome = self.handle(message_update(4, "/start", chat=CHAT_ID))
        self.assert_outcome(outcome, INGRESS_IGNORED_UNRELATED, variant=VARIANT_MESSAGE, update_id=4)
        self.assert_quiet()
        self.assertEqual(self.registry._pendings, {})
        self.assert_outcome(
            self.handle(message_update(5, "/start " + token, chat=CHAT_ID)),
            PAIRING_PROMPT_DELIVERED,
            update_id=5,
        )

    def test_ordinary_text_and_help_are_ignored_never_routed(self):
        for text in ("hola", "help", "/help", "start", "start " + "A" * OPAQUE_CHARS, "", "//start"):
            with self.subTest(text=text):
                self.setUp()
                outcome = self.handle(message_update(4, text, chat=CHAT_ID))
                self.assert_outcome(
                    outcome, INGRESS_IGNORED_UNRELATED, variant=VARIANT_MESSAGE, update_id=4
                )
                self.assert_quiet()

    def test_start_with_a_mention_is_unrelated_because_the_target_is_unverifiable(self):
        self.assert_outcome(
            self.handle(message_update(4, "/start@PrismaBot", chat=CHAT_ID)),
            INGRESS_IGNORED_UNRELATED,
            update_id=4,
        )
        self.assert_quiet()

    def test_unusable_start_payloads_are_refused_with_operator_copy(self):
        for payload in ("abc", "A" * 42, "A" * 44, "A" * 42 + "=", "A" * 42 + "!", "a b"):
            with self.subTest(payload=payload):
                self.setUp()
                outcome = self.handle(message_update(4, "/start " + payload, chat=CHAT_ID))
                self.assert_outcome(
                    outcome, PAIRING_REFUSED, variant=VARIANT_MESSAGE, update_id=4,
                    delivery=SEND_DELIVERED,
                )
                self.assertEqual(self.transport.sent[-1]["text"], COPY_REFUSED)
                self.assertIsNone(self.transport.sent[-1]["reply_markup"])
                self.assertEqual(self.registry._pendings, {})

    def test_foreign_or_expired_tokens_are_refused(self):
        for offset, token in enumerate(("A" * OPAQUE_CHARS, "B" * OPAQUE_CHARS), start=1):
            with self.subTest(token=token):
                outcome = self.handle(message_update(offset, "/start " + token, chat=CHAT_ID))
                self.assert_outcome(outcome, PAIRING_REFUSED, update_id=offset)
        token = self.issue()
        self.now[0] = 1061.0
        outcome = self.handle(message_update(self.tick(), "/start " + token, chat=CHAT_ID))
        self.assert_outcome(outcome, PAIRING_REFUSED, update_id=3)
        self.assertEqual(self.registry._pendings, {})

    def test_live_token_sends_the_prompt_with_separate_ticket_buttons(self):
        self.prompted(4)
        payload = self.transport.sent[-1]
        self.assertEqual(payload["chat_id"], CHAT_ID)
        self.assertEqual(
            payload["text"], CONFIRMATION_PROMPT_TEMPLATE.format(label=self.labels["value"])
        )
        self.assertNotIn("parse_mode", payload)
        self.assertIsNotNone(payload["reply_markup"])
        rows = payload["reply_markup"]["inline_keyboard"]
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0][0]["text"], BUTTON_CONFIRM)
        self.assertEqual(rows[1][0]["text"], BUTTON_CANCEL)
        ticket = self.prompt_ticket()
        self.assertEqual(rows[0][0]["callback_data"], CALLBACK_CONFIRM + ":" + ticket)
        self.assertEqual(rows[1][0]["callback_data"], CALLBACK_CANCEL + ":" + ticket)

    def test_every_callback_payload_stays_within_the_telegram_byte_limit(self):
        self.prompted(4)
        for row in (0, 1):
            with self.subTest(row=row):
                data = self.button_data(row)
                self.assertLessEqual(len(data.encode("ascii")), CALLBACK_DATA_MAX_BYTES)
                self.assertTrue(set(data.split(":", 1)[1]) <= URLSAFE_CHARS)

    def test_claim_registers_a_bounded_preflight_index_without_secrets(self):
        self.prompted(4)
        self.assertEqual(len(self.dialogue._pending_claims), 1)
        claim = next(iter(self.dialogue._pending_claims.values()))
        names = {field.name for field in dataclasses.fields(claim)}
        self.assertEqual(names, {"owner_id", "phone_id", "expires_at", "label"})
        self.assertEqual(claim.owner_id, OWNER)
        self.assertEqual(claim.phone_id, PHONE)
        self.assertEqual(claim.expires_at, 1060.0)
        self.assertEqual(self.label_calls, [OWNER])

    def test_claimed_phone_cannot_claim_another_challenge(self):
        self.prompted(4)
        outcome = self.handle(message_update(5, "/start " + self.issue(OWNER2), chat=CHAT_ID))
        self.assert_outcome(outcome, PAIRING_REFUSED, update_id=5)
        self.assertEqual(len(self.registry._pendings), 1)

    def test_unknown_send_keeps_the_pending_claim(self):
        self.transport.send_responses = [{"ok": True, "result": None}]
        outcome = self.handle(message_update(4, "/start " + self.issue(), chat=CHAT_ID))
        self.assert_outcome(
            outcome, PAIRING_PROMPT_UNKNOWN, variant=VARIANT_MESSAGE, update_id=4,
            delivery=SEND_UNKNOWN,
        )
        self.assertEqual(len(self.registry._pendings), 1)
        self.assertEqual(len(self.dialogue._pending_claims), 1)

    def test_send_exception_is_unknown_and_never_claims_success(self):
        def explode(payload):
            raise RuntimeError("transport down")

        self.transport.on_send = explode
        outcome = self.handle(message_update(4, "/start " + self.issue(), chat=CHAT_ID))
        self.assert_outcome(outcome, PAIRING_PROMPT_UNKNOWN, delivery=SEND_UNKNOWN, update_id=4)
        self.assertEqual(len(self.dialogue._pending_claims), 1)
        self.assertEqual(len(self.registry._pendings), 1)

    def test_known_send_rejection_cancels_the_pending_claim(self):
        self.transport.send_responses = [FakeTransport.rejected()]
        outcome = self.handle(message_update(4, "/start " + self.issue(), chat=CHAT_ID))
        self.assert_outcome(
            outcome, PAIRING_PROMPT_REJECTED, variant=VARIANT_MESSAGE, update_id=4,
            delivery=SEND_REJECTED,
        )
        self.assertEqual(self.registry._pendings, {})
        self.assertEqual(self.dialogue._pending_claims, {})

    def test_missing_destination_label_cancels_pending_and_fails_closed(self):
        self.labels["value"] = None
        outcome = self.handle(message_update(4, "/start " + self.issue(), chat=CHAT_ID))
        self.assert_outcome(
            outcome, PAIRING_DESTINATION_UNAVAILABLE, variant=VARIANT_MESSAGE, update_id=4,
            delivery=SEND_DELIVERED,
        )
        self.assertEqual(self.transport.sent[-1]["text"], COPY_DESTINATION_UNAVAILABLE)
        self.assertEqual(self.registry._pendings, {})
        self.assertEqual(self.dialogue._pending_claims, {})
        self.assertIsNone(self.registry.phone_link(PHONE))

    def test_label_lookup_failure_is_refused_without_deleting_live_authority(self):
        # A backend/lookup failure is not an authoritative absence: the live
        # pending claim must survive the transient error.
        self.labels["value"] = RuntimeError("label backend down")
        outcome = self.handle(message_update(4, "/start " + self.issue(), chat=CHAT_ID))
        self.assert_outcome(outcome, PAIRING_REFUSED, update_id=4)
        self.assertEqual(len(self.registry._pendings), 1)
        self.assertEqual(self.label_calls, [OWNER])

    def test_unusable_label_values_all_fail_closed(self):
        values = (None, "", "   ", 42, "x" * (MAX_LABEL_CHARS + 1), "bad\x00label")
        for index, value in enumerate(values, start=1):
            with self.subTest(value=value):
                registry = ChannelAPairingRegistry(
                    warning_lead=60.0, clock=lambda: 1000.0, entropy=sequential_entropy()
                )
                transport = FakeTransport()
                dialogue = ChannelAPairingDialogue(
                    bot_id=BOT_ID,
                    registry=registry,
                    transport=transport,
                    destination_label=lambda owner, value=value: value,
                )
                update = message_update(
                    index,
                    "/start " + registry.issue_qr(owner_id(index)).token,
                    chat=chat_id(index),
                )
                outcome = dialogue.handle_update(update)
                self.assertEqual(outcome.kind, PAIRING_DESTINATION_UNAVAILABLE)
                self.assertEqual(registry._pendings, {})
                self.assertEqual(transport.sent[-1]["text"], COPY_DESTINATION_UNAVAILABLE)

    def test_markup_characters_in_the_label_stay_plain_text(self):
        self.labels["value"] = "<b>Sala</b> *3* _x_"
        self.prompted(4)
        payload = self.transport.sent[-1]
        # No ``parse_mode`` is ever sent, so markup characters are literal text
        # and must not be destructively stripped from the trusted label.
        self.assertIn(self.labels["value"], payload["text"])
        self.assertNotIn("parse_mode", payload)

    def test_local_pending_claim_survives_within_the_qr_window(self):
        self.prompted(4)
        outcome = self.handle(message_update(5, "/start " + "A" * OPAQUE_CHARS, chat=CHAT_ID_2))
        self.assert_outcome(outcome, PAIRING_REFUSED, update_id=5)
        self.assertEqual(len(self.dialogue._pending_claims), 1)

    def test_local_pending_claim_is_purged_after_the_qr_window(self):
        self.prompted(4)
        self.now[0] = 1061.0
        outcome = self.handle(message_update(5, "/start " + "A" * OPAQUE_CHARS, chat=CHAT_ID_2))
        self.assert_outcome(outcome, PAIRING_REFUSED, update_id=5)
        self.assertEqual(self.dialogue._pending_claims, {})

    def test_local_pending_claim_is_purged_at_the_exact_deadline(self):
        self.prompted(4)
        self.now[0] = 1060.0
        outcome = self.handle(message_update(5, "/start " + "A" * OPAQUE_CHARS, chat=CHAT_ID_2))
        self.assert_outcome(outcome, PAIRING_REFUSED, update_id=5)
        self.assertEqual(self.dialogue._pending_claims, {})

    def test_pending_claims_are_bounded_without_evicting_live_records(self):
        self.dialogue = self.build(max_pending_claims=2)
        self.prompted(4)
        first_ticket = self.prompt_ticket()
        self.prompted(5, owner=OWNER2, chat=CHAT_ID_2)
        self.assertEqual(len(self.dialogue._pending_claims), 2)
        # The third live claim is refused before the registry is touched, so no
        # live record is evicted and no domain reservation appears.
        third_token = self.issue(OWNER3)
        outcome = self.handle(message_update(6, "/start " + third_token, chat=CHAT_ID_3))
        self.assert_outcome(outcome, PAIRING_REFUSED, variant=VARIANT_MESSAGE, update_id=6)
        self.assertEqual(len(self.dialogue._pending_claims), 2)
        self.assertEqual(len(self.registry._pendings), 2)
        self.assertEqual(len(self.registry._challenges), 1)
        # The oldest live record is still usable: the first ticket cancels cleanly.
        outcome = self.handle(callback_update(7, CALLBACK_CANCEL + ":" + first_ticket, chat=CHAT_ID))
        self.assert_outcome(
            outcome,
            PAIRING_CANCELLED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_DELIVERED,
            update_id=7,
            acknowledged=True,
        )
        self.assertEqual(len(self.registry._pendings), 1)

    def test_broken_clock_never_fabricates_expiry_or_evicts_live_records(self):
        self.dialogue = self.build(clock=lambda: "not-a-number", max_pending_claims=1)
        self.prompted(4)
        self.assertEqual(len(self.dialogue._pending_claims), 1)
        outcome = self.handle(
            message_update(5, "/start " + self.issue(OWNER2), chat=CHAT_ID_2)
        )
        self.assert_outcome(outcome, PAIRING_REFUSED, variant=VARIANT_MESSAGE, update_id=5)
        self.assertEqual(len(self.dialogue._pending_claims), 1)
        self.assertEqual(len(self.registry._pendings), 1)
        self.assertEqual(len(self.registry._challenges), 1)


class ChannelAConfirmTests(ChannelABotTestCase):
    def test_confirm_links_and_sends_the_welcome_with_the_two_footer_buttons(self):
        nonce = self.pair_up(4, 5)
        link = self.registry.phone_link(PHONE)
        self.assertIsNotNone(link)
        self.assertEqual(link.owner_id, OWNER)
        payload = self.transport.sent[-1]
        self.assertEqual(payload["chat_id"], CHAT_ID)
        self.assertEqual(payload["text"], WELCOME_TEMPLATE.format(label=self.labels["value"]))
        self.assertNotIn("parse_mode", payload)
        rows = payload["reply_markup"]["inline_keyboard"]
        self.assertEqual(rows[0][0]["text"], BUTTON_KEEP_CONNECTED)
        self.assertEqual(rows[1][0]["text"], BUTTON_UNLINK)
        self.assertEqual(rows[0][0]["callback_data"], CALLBACK_KEEP_CONNECTED + ":" + nonce)
        self.assertEqual(rows[1][0]["callback_data"], CALLBACK_UNLINK + ":" + nonce)

    def test_confirm_acknowledges_before_the_welcome_is_sent(self):
        self.prompted(4)
        ticket = self.prompt_ticket()
        self.handle(callback_update(5, CALLBACK_CONFIRM + ":" + ticket))
        self.assertEqual(
            self.transport.calls,
            ["send_message", "answer_callback_query", "send_message"],
        )
        self.assertEqual(self.transport.answered[-1]["text"], COPY_CONFIRMED)

    def test_confirm_uses_a_process_local_action_nonce_not_a_generation(self):
        nonce = self.pair_up(4, 5)
        link = self.registry.phone_link(PHONE)
        self.assertEqual(len(nonce), OPAQUE_CHARS)
        self.assertTrue(set(nonce) <= URLSAFE_CHARS)
        self.assertNotEqual(nonce, str(link.generation))
        self.assertEqual(self.button_data(0).split(":", 1)[0], CALLBACK_KEEP_CONNECTED)
        self.assertEqual(self.button_data(1).split(":", 1)[0], CALLBACK_UNLINK)

    def test_each_link_gets_its_own_action_nonce(self):
        first = self.pair_up(4, 5)
        second = self.pair_up(6, 7, owner=OWNER2, chat=CHAT_ID_2)
        self.assertNotEqual(first, second)

    def test_at_most_one_action_record_per_link(self):
        self.pair_up(4, 5)
        self.assertEqual(len(self.dialogue._actions), 1)
        record = next(iter(self.dialogue._actions.values()))
        names = {field.name for field in dataclasses.fields(record)}
        self.assertEqual(
            names,
            {"phone_id", "owner_id", "generation", "nonce", "confirmed_update_id"},
        )
        # Additive RCA-3b fence: the update that confirmed this link.
        self.assertEqual(record.confirmed_update_id, 5)
        self.assertEqual(record.phone_id, PHONE)
        self.assertEqual(record.owner_id, OWNER)
        self.assertEqual(record.generation, self.registry.phone_link(PHONE).generation)
        self.assertNotIn(record.nonce, repr(record))

    def test_confirm_from_a_foreign_phone_is_refused_without_side_effects(self):
        self.prompted(4)
        ticket = self.prompt_ticket()
        outcome = self.handle(callback_update(5, CALLBACK_CONFIRM + ":" + ticket, chat=CHAT_ID_2))
        self.assert_outcome(
            outcome,
            ACTION_REFUSED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_NONE,
            update_id=5,
            acknowledged=True,
        )
        self.assertEqual(self.transport.answered[-1]["text"], COPY_ACTION_REFUSED)
        self.assertEqual(len(self.registry._pendings), 1)
        self.assertEqual(len(self.dialogue._pending_claims), 1)
        self.assertIsNone(self.registry.phone_link(PHONE2))

    def test_unknown_and_replayed_tickets_are_refused(self):
        for data in (
            CALLBACK_CONFIRM + ":" + "A" * OPAQUE_CHARS,
            CALLBACK_CONFIRM + ":" + "B" * OPAQUE_CHARS,
        ):
            with self.subTest(data=data):
                self.setUp()
                outcome = self.handle(callback_update(4, data))
                self.assert_outcome(outcome, ACTION_REFUSED, update_id=4, acknowledged=True)
        self.prompted(5)
        ticket = self.prompt_ticket()
        self.handle(callback_update(6, CALLBACK_CONFIRM + ":" + ticket))
        outcome = self.handle(callback_update(7, CALLBACK_CONFIRM + ":" + ticket))
        self.assert_outcome(outcome, ACTION_REFUSED, update_id=7, acknowledged=True)

    def test_confirm_after_cancel_is_refused(self):
        self.prompted(4)
        ticket = self.prompt_ticket()
        self.handle(callback_update(5, CALLBACK_CANCEL + ":" + ticket))
        outcome = self.handle(callback_update(6, CALLBACK_CONFIRM + ":" + ticket))
        self.assert_outcome(outcome, ACTION_REFUSED, update_id=6, acknowledged=True)
        self.assertIsNone(self.registry.phone_link(PHONE))

    def test_confirm_needs_a_fresh_label_and_cancels_pending_when_it_is_gone(self):
        self.prompted(4)
        ticket = self.prompt_ticket()
        self.labels["value"] = None
        outcome = self.handle(callback_update(5, CALLBACK_CONFIRM + ":" + ticket))
        self.assert_outcome(
            outcome,
            PAIRING_DESTINATION_UNAVAILABLE,
            variant=VARIANT_CALLBACK,
            delivery=SEND_DELIVERED,
            update_id=5,
            acknowledged=True,
        )
        self.assertEqual(self.transport.answered[-1]["text"], COPY_DESTINATION_UNAVAILABLE)
        self.assertEqual(self.transport.sent[-1]["text"], COPY_DESTINATION_UNAVAILABLE)
        self.assertIsNone(self.registry.phone_link(PHONE))
        self.assertEqual(self.registry._pendings, {})
        self.assertEqual(self.dialogue._pending_claims, {})
        self.assertEqual(self.label_calls, [OWNER, OWNER])

    def test_confirm_keeps_the_prompted_label_when_it_is_unchanged(self):
        self.prompted(4)
        ticket = self.prompt_ticket()
        prompt_text = self.transport.sent[-1]["text"]
        self.handle(callback_update(5, CALLBACK_CONFIRM + ":" + ticket))
        welcome = self.transport.sent[-1]["text"]
        self.assertIn(self.labels["value"], prompt_text)
        self.assertIn(self.labels["value"], welcome)
        self.assertEqual(self.label_calls, [OWNER, OWNER])

    def test_confirm_refuses_when_the_presented_label_changed(self):
        self.prompted(4)
        ticket = self.prompt_ticket()
        self.labels["value"] = "Sala 9 — Compresor"
        outcome = self.handle(callback_update(5, CALLBACK_CONFIRM + ":" + ticket))
        self.assert_outcome(
            outcome,
            PAIRING_DESTINATION_UNAVAILABLE,
            variant=VARIANT_CALLBACK,
            delivery=SEND_DELIVERED,
            update_id=5,
            acknowledged=True,
        )
        self.assertEqual(self.transport.answered[-1]["text"], COPY_DESTINATION_UNAVAILABLE)
        self.assertIsNone(self.registry.phone_link(PHONE))
        self.assertEqual(self.registry._pendings, {})
        self.assertEqual(self.dialogue._pending_claims, {})
        # The welcome must never advertise the destination that changed underneath.
        self.assertNotIn("Compresor", self.transport.sent[-1]["text"])

    def test_confirm_label_lookup_failure_is_refused_without_cancelling_authority(self):
        self.prompted(4)
        ticket = self.prompt_ticket()
        self.labels["value"] = RuntimeError("label backend down")
        outcome = self.handle(callback_update(5, CALLBACK_CONFIRM + ":" + ticket))
        self.assert_outcome(
            outcome,
            PAIRING_REFUSED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_NONE,
            update_id=5,
            acknowledged=True,
        )
        self.assertEqual(self.transport.answered[-1]["text"], COPY_ACTION_REFUSED)
        self.assertEqual(len(self.registry._pendings), 1)
        self.assertEqual(len(self.dialogue._pending_claims), 1)
        self.assertIsNone(self.registry.phone_link(PHONE))

    def test_confirm_rechecks_the_captured_link_before_the_welcome(self):
        self.prompted(4)
        ticket = self.prompt_ticket()

        def replace(payload):
            # The acknowledgement hook runs between the registry confirm and the
            # welcome: the captured owner link is invalidated underneath the dialogue.
            self.registry.invalidate_owner(OWNER)

        self.transport.on_ack = replace
        outcome = self.handle(callback_update(5, CALLBACK_CONFIRM + ":" + ticket))
        self.assert_outcome(
            outcome,
            PAIRING_REFUSED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_NONE,
            update_id=5,
            acknowledged=True,
        )
        # Only the confirmation prompt was ever sent: no late welcome.
        self.assertEqual(len(self.transport.sent), 1)
        self.assertEqual(self.dialogue._actions, {})
        self.assertIsNone(self.registry.phone_link(PHONE))

    def test_nonce_collision_never_overwrites_another_links_buttons(self):
        self.dialogue = self.build(entropy=lambda size: b"\x05" * size)
        self.pair_up(4, 5)
        first_records = dict(self.dialogue._actions)
        self.prompted(6, owner=OWNER2, chat=CHAT_ID_2)
        ticket = self.prompt_ticket()
        outcome = self.handle(callback_update(7, CALLBACK_CONFIRM + ":" + ticket, chat=CHAT_ID_2))
        self.assert_outcome(
            outcome,
            PAIRING_REFUSED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_DELIVERED,
            update_id=7,
            acknowledged=True,
        )
        self.assertEqual(self.transport.answered[-1]["text"], COPY_ACTION_REFUSED)
        self.assertEqual(self.dialogue._actions, first_records)
        self.assertIsNotNone(self.registry.phone_link(PHONE2))

    def test_confirm_uncertain_registry_failure_preserves_the_pending_claim(self):
        self.prompted(4)
        ticket = self.prompt_ticket()
        self.assertIsNone(self.registry.phone_link(PHONE))
        # The registry clock is invalid for the confirmation attempt only.
        self.now[0] = float("nan")
        outcome = self.handle(callback_update(5, CALLBACK_CONFIRM + ":" + ticket))
        self.assert_outcome(
            outcome,
            PAIRING_REFUSED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_NONE,
            update_id=5,
            acknowledged=True,
        )
        self.assertEqual(self.transport.answered[-1]["text"], COPY_ACTION_REFUSED)
        # An uncertain failure keeps both the local and the registry reservation.
        self.assertEqual(len(self.registry._pendings), 1)
        self.assertEqual(len(self.dialogue._pending_claims), 1)
        # Recovery: the same original ticket still links through the adapter.
        self.now[0] = 1000.0
        self.assertIsNone(self.registry.phone_link(PHONE))
        outcome = self.handle(callback_update(6, CALLBACK_CONFIRM + ":" + ticket))
        self.assert_outcome(
            outcome,
            PAIRING_CONFIRMED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_DELIVERED,
            update_id=6,
            acknowledged=True,
        )
        self.assertEqual(self.registry.phone_link(PHONE).owner_id, OWNER)

    def test_confirm_revalidates_after_nonce_generation_before_the_ack(self):
        def relinking_entropy(size):
            # The entropy draw itself replaces the just-confirmed link: the phone
            # is relinked to another owner before the success acknowledgement.
            link = self.registry.phone_link(PHONE)
            self.registry.unlink_phone(PHONE, link.generation)
            token = self.registry.issue_qr(OWNER2).token
            replacement, _pending = self.registry.claim_qr(token, PHONE)
            self.registry.confirm(replacement, PHONE)
            return b"\x07" * size

        self.dialogue = self.build(entropy=relinking_entropy)
        self.prompted(4)
        ticket = self.prompt_ticket()
        outcome = self.handle(callback_update(5, CALLBACK_CONFIRM + ":" + ticket))
        self.assert_outcome(
            outcome,
            PAIRING_REFUSED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_DELIVERED,
            update_id=5,
            acknowledged=True,
        )
        # No confirmed acknowledgement and no stale welcome were ever sent.
        self.assertEqual(self.transport.answered[-1]["text"], COPY_ACTION_REFUSED)
        self.assertNotIn(
            COPY_CONFIRMED, [payload["text"] or "" for payload in self.transport.answered]
        )
        self.assertEqual(
            [p for p in self.transport.sent if WELCOME_TEMPLATE.split("\n")[0] in p["text"]],
            [],
        )
        # The replacement link is preserved and no local action record was kept.
        self.assertEqual(self.registry.phone_link(PHONE).owner_id, OWNER2)
        self.assertEqual(self.dialogue._actions, {})

    def test_registry_refusal_at_confirm_is_reported_and_clears_the_local_claim(self):
        self.prompted(4)
        ticket = self.prompt_ticket()
        self.registry.invalidate_owner(OWNER)
        outcome = self.handle(callback_update(5, CALLBACK_CONFIRM + ":" + ticket))
        self.assert_outcome(
            outcome,
            PAIRING_REFUSED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_NONE,
            update_id=5,
            acknowledged=True,
        )
        self.assertEqual(self.transport.answered[-1]["text"], COPY_ACTION_REFUSED)
        self.assertEqual(self.dialogue._pending_claims, {})
        self.assertIsNone(self.registry.phone_link(PHONE))

    def test_rejected_welcome_keeps_the_confirmed_link(self):
        self.transport.send_responses = [self.transport.delivered(CHAT_ID), FakeTransport.rejected()]
        self.prompted(4)
        outcome = self.handle(callback_update(5, CALLBACK_CONFIRM + ":" + self.prompt_ticket()))
        self.assert_outcome(
            outcome,
            PAIRING_WELCOME_REJECTED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_REJECTED,
            update_id=5,
            acknowledged=True,
        )
        self.assertIsNotNone(self.registry.phone_link(PHONE))
        self.assertEqual(len(self.dialogue._actions), 1)

    def test_unknown_welcome_keeps_the_confirmed_link_without_replay(self):
        self.transport.send_responses = [self.transport.delivered(CHAT_ID), {"ok": True, "result": None}]
        self.prompted(4)
        outcome = self.handle(callback_update(5, CALLBACK_CONFIRM + ":" + self.prompt_ticket()))
        self.assert_outcome(
            outcome,
            PAIRING_WELCOME_UNKNOWN,
            variant=VARIANT_CALLBACK,
            delivery=SEND_UNKNOWN,
            update_id=5,
            acknowledged=True,
        )
        self.assertIsNotNone(self.registry.phone_link(PHONE))
        self.assertEqual(len(self.transport.sent), 2)

    def test_nonce_mint_failure_is_refused_and_leaves_the_link_expiring(self):
        self.dialogue = self.build(entropy=lambda size: b"\x01" * (size - 1))
        self.prompted(4)
        outcome = self.handle(callback_update(5, CALLBACK_CONFIRM + ":" + self.prompt_ticket()))
        self.assert_outcome(
            outcome,
            PAIRING_REFUSED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_DELIVERED,
            update_id=5,
            acknowledged=True,
        )
        self.assertEqual(self.transport.answered[-1]["text"], COPY_ACTION_REFUSED)
        self.assertEqual(self.transport.sent[-1]["text"], COPY_ACTION_REFUSED)
        self.assertEqual(self.dialogue._actions, {})
        self.assertIsNotNone(self.registry.phone_link(PHONE))

    def test_confirm_capacity_is_reserved_before_mutating_the_registry(self):
        self.dialogue = self.build(max_link_actions=1)
        self.pair_up(4, 5)
        self.assertEqual(len(self.dialogue._actions), 1)
        self.prompted(6, owner=OWNER2, chat=CHAT_ID_2)
        ticket = self.prompt_ticket()
        outcome = self.handle(callback_update(7, CALLBACK_CONFIRM + ":" + ticket, chat=CHAT_ID_2))
        self.assert_outcome(
            outcome,
            PAIRING_REFUSED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_NONE,
            update_id=7,
            acknowledged=True,
        )
        self.assertIsNone(self.registry.phone_link(PHONE2))
        self.assertEqual(self.registry._pendings, {})
        self.assertEqual(self.dialogue._pending_claims, {})

    def test_expired_link_records_are_purged_before_the_capacity_check(self):
        self.dialogue = self.build(max_link_actions=1)
        self.pair_up(4, 5)
        self.now[0] = 1601.0
        self.prompted(6, owner=OWNER2, chat=CHAT_ID_2)
        ticket = self.prompt_ticket()
        outcome = self.handle(callback_update(7, CALLBACK_CONFIRM + ":" + ticket, chat=CHAT_ID_2))
        self.assert_outcome(
            outcome,
            PAIRING_CONFIRMED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_DELIVERED,
            update_id=7,
            acknowledged=True,
        )
        self.assertEqual(len(self.dialogue._actions), 1)
        self.assertIsNone(self.registry.phone_link(PHONE))
        self.assertIsNotNone(self.registry.phone_link(PHONE2))


class ChannelACancelTests(ChannelABotTestCase):
    def test_cancel_releases_the_pending_claim_and_acknowledges(self):
        self.prompted(4)
        ticket = self.prompt_ticket()
        outcome = self.handle(callback_update(5, CALLBACK_CANCEL + ":" + ticket))
        self.assert_outcome(
            outcome,
            PAIRING_CANCELLED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_DELIVERED,
            update_id=5,
            acknowledged=True,
        )
        self.assertEqual(self.transport.answered[-1]["text"], COPY_CANCELLED)
        self.assertEqual(self.transport.sent[-1]["text"], COPY_CANCELLED)
        self.assertEqual(self.registry._pendings, {})
        self.assertEqual(self.dialogue._pending_claims, {})
        self.assertIsNone(self.registry.phone_link(PHONE))

    def test_cancel_is_not_reported_when_the_registry_no_longer_holds_the_claim(self):
        self.prompted(4)
        ticket = self.prompt_ticket()
        # The registry claim expires underneath the local index, so the
        # authoritative cancellation can no longer succeed.
        self.now[0] = 1061.0
        outcome = self.handle(callback_update(5, CALLBACK_CANCEL + ":" + ticket))
        self.assert_outcome(
            outcome,
            ACTION_REFUSED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_NONE,
            update_id=5,
            acknowledged=True,
        )
        self.assertEqual(self.transport.answered[-1]["text"], COPY_ACTION_REFUSED)
        self.assertNotIn(COPY_CANCELLED, [payload["text"] for payload in self.transport.sent])

    def test_cancel_never_touches_a_foreign_reservation(self):
        self.prompted(4)
        ticket = self.prompt_ticket()
        outcome = self.handle(callback_update(5, CALLBACK_CANCEL + ":" + ticket, chat=CHAT_ID_2))
        self.assert_outcome(outcome, ACTION_REFUSED, update_id=5, acknowledged=True)
        self.assertEqual(len(self.registry._pendings), 1)
        self.assertEqual(len(self.dialogue._pending_claims), 1)

    def test_cancel_of_an_unknown_ticket_is_refused(self):
        outcome = self.handle(callback_update(4, CALLBACK_CANCEL + ":" + "A" * OPAQUE_CHARS))
        self.assert_outcome(outcome, ACTION_REFUSED, update_id=4, acknowledged=True)
        self.assertEqual(self.transport.answered[-1]["text"], COPY_ACTION_REFUSED)

    def test_cancel_twice_refuses_the_second_press(self):
        self.prompted(4)
        ticket = self.prompt_ticket()
        self.handle(callback_update(5, CALLBACK_CANCEL + ":" + ticket))
        outcome = self.handle(callback_update(6, CALLBACK_CANCEL + ":" + ticket))
        self.assert_outcome(outcome, ACTION_REFUSED, update_id=6, acknowledged=True)

    def test_cancel_does_not_release_a_confirmed_link(self):
        nonce = self.pair_up(4, 5)
        outcome = self.handle(callback_update(6, CALLBACK_CANCEL + ":" + nonce))
        self.assert_outcome(outcome, ACTION_REFUSED, update_id=6, acknowledged=True)
        self.assertIsNotNone(self.registry.phone_link(PHONE))

    def test_a_freed_phone_can_pair_again_after_cancel(self):
        self.prompted(4)
        ticket = self.prompt_ticket()
        self.handle(callback_update(5, CALLBACK_CANCEL + ":" + ticket))
        self.prompted(6, owner=OWNER, chat=CHAT_ID)
        outcome = self.handle(callback_update(7, CALLBACK_CONFIRM + ":" + self.prompt_ticket()))
        self.assert_outcome(outcome, PAIRING_CONFIRMED, update_id=7)
        self.assertIsNotNone(self.registry.phone_link(PHONE))


class ChannelALinkActionTests(ChannelABotTestCase):
    def test_keep_connected_renews_the_idle_window_without_a_chat_message(self):
        nonce = self.pair_up(4, 5)
        sent = len(self.transport.sent)
        outcome = self.handle(callback_update(6, CALLBACK_KEEP_CONNECTED + ":" + nonce))
        self.assert_outcome(
            outcome,
            KEEP_CONNECTED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_NONE,
            update_id=6,
            acknowledged=True,
        )
        self.assertEqual(self.transport.answered[-1]["text"], COPY_KEEP_CONNECTED)
        self.assertEqual(len(self.transport.sent), sent)

    def test_keep_connected_extends_the_human_idle_deadline(self):
        nonce = self.pair_up(4, 5)
        before = self.registry.phone_link(PHONE).idle_expires_at
        self.now[0] = 1400.0
        self.handle(callback_update(6, CALLBACK_KEEP_CONNECTED + ":" + nonce))
        after = self.registry.phone_link(PHONE).idle_expires_at
        self.assertEqual(after, 1400.0 + 600.0)
        self.assertGreater(after, before)

    def test_unlink_releases_the_link_and_reports_it(self):
        nonce = self.pair_up(4, 5)
        outcome = self.handle(callback_update(6, CALLBACK_UNLINK + ":" + nonce))
        self.assert_outcome(
            outcome,
            UNLINKED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_DELIVERED,
            update_id=6,
            acknowledged=True,
        )
        self.assertEqual(self.transport.answered[-1]["text"], COPY_UNLINKED)
        self.assertEqual(self.transport.sent[-1]["text"], COPY_UNLINKED)
        self.assertIsNone(self.registry.phone_link(PHONE))
        self.assertEqual(self.dialogue._actions, {})

    def test_unknown_action_nonces_fail_closed(self):
        for nonce in ("A" * OPAQUE_CHARS, "B" * OPAQUE_CHARS):
            with self.subTest(nonce=nonce):
                self.setUp()
                self.pair_up(4, 5)
                outcome = self.handle(callback_update(6, CALLBACK_UNLINK + ":" + nonce))
                self.assert_outcome(outcome, ACTION_REFUSED, update_id=6, acknowledged=True)
                self.assertIsNotNone(self.registry.phone_link(PHONE))

    def test_foreign_phone_cannot_use_another_phones_action_nonce(self):
        nonce = self.pair_up(4, 5)
        outcome = self.handle(callback_update(6, CALLBACK_KEEP_CONNECTED + ":" + nonce, chat=CHAT_ID_2))
        self.assert_outcome(outcome, ACTION_REFUSED, update_id=6, acknowledged=True)
        self.assertEqual(len(self.dialogue._actions), 1)
        self.assertIsNotNone(self.registry.phone_link(PHONE))

    def test_legacy_generation_payloads_are_unusable(self):
        self.pair_up(4, 5)
        generation = self.registry.phone_link(PHONE).generation
        payloads = ("un:" + str(generation), "un:" + "A" * OPAQUE_CHARS, "ul:" + str(generation))
        for offset, data in enumerate(payloads, start=6):
            with self.subTest(data=data):
                outcome = self.handle(callback_update(offset, data))
                self.assert_outcome(outcome, ACTION_REFUSED, update_id=offset, acknowledged=True)
        self.assertIsNotNone(self.registry.phone_link(PHONE))

    def test_restart_epoch_has_no_action_records_and_refuses_old_buttons(self):
        nonce = self.pair_up(4, 5)
        restarted = self.build()
        self.assertEqual(restarted._actions, {})
        outcome = restarted.handle_update(callback_update(6, CALLBACK_UNLINK + ":" + nonce))
        self.assert_outcome(outcome, ACTION_REFUSED, update_id=6, acknowledged=True)
        self.assertIsNotNone(self.registry.phone_link(PHONE))

    def test_old_generation_buttons_fail_after_an_unlink_relink_cycle(self):
        old_nonce = self.pair_up(4, 5)
        self.handle(callback_update(6, CALLBACK_UNLINK + ":" + old_nonce))
        self.assertIsNone(self.registry.phone_link(PHONE))
        new_nonce = self.pair_up(7, 8, owner=OWNER2, chat=CHAT_ID)
        self.assertNotEqual(new_nonce, old_nonce)
        outcome = self.handle(callback_update(9, CALLBACK_UNLINK + ":" + old_nonce))
        self.assert_outcome(outcome, ACTION_REFUSED, update_id=9, acknowledged=True)
        self.assertIsNotNone(self.registry.phone_link(PHONE))

    def test_authoritative_stale_generation_still_cleans_the_action_record(self):
        old_nonce = self.pair_up(4, 5)
        self.assertEqual(len(self.dialogue._actions), 1)
        # Replace the link out of band, leaving the old action record behind.
        self.registry.invalidate_owner(OWNER)
        token = self.registry.issue_qr(OWNER2).token
        ticket, _pending = self.registry.claim_qr(token, PHONE)
        self.registry.confirm(ticket, PHONE)
        outcome = self.handle(callback_update(6, CALLBACK_UNLINK + ":" + old_nonce))
        self.assert_outcome(outcome, ACTION_REFUSED, update_id=6, acknowledged=True)
        # The authoritatively stale record is cleaned, never resurrected.
        self.assertEqual(self.dialogue._actions, {})
        self.assertIsNotNone(self.registry.phone_link(PHONE))

    def test_keep_connected_uncertain_mutation_preserves_the_action_record(self):
        nonce = self.pair_up(4, 5)
        # The first registry clock sample (link lookup) is valid; the mutation
        # sample is invalid, so the domain refuses without touching the link.
        samples = [1000.0, float("nan")]
        self.registry.clock = lambda: samples.pop(0) if samples else 1000.0
        outcome = self.handle(callback_update(6, CALLBACK_KEEP_CONNECTED + ":" + nonce))
        self.assert_outcome(
            outcome,
            ACTION_REFUSED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_NONE,
            update_id=6,
            acknowledged=True,
        )
        self.assertEqual(len(self.dialogue._actions), 1)
        # Recovery: the same delivered nonce still operates the live control.
        self.registry.clock = lambda: self.now[0]
        outcome = self.handle(callback_update(7, CALLBACK_KEEP_CONNECTED + ":" + nonce))
        self.assert_outcome(
            outcome,
            KEEP_CONNECTED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_NONE,
            update_id=7,
            acknowledged=True,
        )
        self.assertIsNotNone(self.registry.phone_link(PHONE))

    def test_unlink_uncertain_mutation_preserves_the_action_record(self):
        nonce = self.pair_up(4, 5)
        samples = [1000.0, float("nan")]
        self.registry.clock = lambda: samples.pop(0) if samples else 1000.0
        outcome = self.handle(callback_update(6, CALLBACK_UNLINK + ":" + nonce))
        self.assert_outcome(
            outcome,
            ACTION_REFUSED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_NONE,
            update_id=6,
            acknowledged=True,
        )
        self.assertEqual(len(self.dialogue._actions), 1)
        self.assertIsNotNone(self.registry.phone_link(PHONE))
        # Recovery: the same delivered nonce still releases the link.
        self.registry.clock = lambda: self.now[0]
        outcome = self.handle(callback_update(7, CALLBACK_UNLINK + ":" + nonce))
        self.assert_outcome(
            outcome,
            UNLINKED,
            variant=VARIANT_CALLBACK,
            delivery=SEND_DELIVERED,
            update_id=7,
            acknowledged=True,
        )
        self.assertIsNone(self.registry.phone_link(PHONE))
        self.assertEqual(self.dialogue._actions, {})

    def test_expired_link_forgets_its_action_record(self):
        nonce = self.pair_up(4, 5)
        self.now[0] = 1601.0
        outcome = self.handle(callback_update(6, CALLBACK_KEEP_CONNECTED + ":" + nonce))
        self.assert_outcome(outcome, ACTION_REFUSED, update_id=6, acknowledged=True)
        self.assertEqual(self.dialogue._actions, {})
        self.assertIsNone(self.registry.phone_link(PHONE))

    def test_unlink_leaves_no_local_state_that_blocks_repairing(self):
        nonce = self.pair_up(4, 5)
        self.handle(callback_update(6, CALLBACK_UNLINK + ":" + nonce))
        self.assertEqual(self.dialogue._pending_claims, {})
        self.assertEqual(self.dialogue._actions, {})
        self.prompted(7, owner=OWNER, chat=CHAT_ID)
        outcome = self.handle(callback_update(8, CALLBACK_CONFIRM + ":" + self.prompt_ticket()))
        self.assert_outcome(outcome, PAIRING_CONFIRMED, update_id=8)

    def test_action_acknowledgement_failure_is_reported_not_hidden(self):
        nonce = self.pair_up(4, 5)
        self.transport.ack_responses = [{"ok": True, "result": False}]
        outcome = self.handle(callback_update(6, CALLBACK_KEEP_CONNECTED + ":" + nonce))
        self.assert_outcome(outcome, KEEP_CONNECTED, update_id=6, acknowledged=False)

    def test_transient_link_read_failure_does_not_erase_live_buttons(self):
        nonce = self.pair_up(4, 5)
        original = self.registry.phone_link

        def unstable(phone_id):
            if phone_id == PHONE:
                raise RuntimeError("registry read failed")
            return original(phone_id)

        self.registry.phone_link = unstable
        outcome = self.handle(callback_update(6, CALLBACK_KEEP_CONNECTED + ":" + nonce))
        self.assert_outcome(outcome, ACTION_REFUSED, update_id=6, acknowledged=True)
        # An uncertain link read must not erase the live action record.
        self.assertEqual(len(self.dialogue._actions), 1)

    def test_bad_callback_grammar_is_refused_with_an_acknowledgement(self):
        bad = (
            None,
            7,
            "",
            "cf",
            "cf:",
            "cf:" + "A" * (OPAQUE_CHARS - 1),
            "cf:" + "A" * (OPAQUE_CHARS + 1),
            "zz:" + "A" * OPAQUE_CHARS,
            "cf:" + "A" * (OPAQUE_CHARS - 1) + "!",
            "cf:" + "A" * (OPAQUE_CHARS - 1) + "\n",
            "cf:" + "\u00f1" * OPAQUE_CHARS,
            "cf:" + "A" * 62,
        )
        for data in bad:
            with self.subTest(data=data):
                self.setUp()
                outcome = self.handle(callback_update(4, data))
                self.assert_outcome(
                    outcome,
                    ACTION_REFUSED,
                    variant=VARIANT_CALLBACK,
                    delivery=SEND_NONE,
                    update_id=4,
                    acknowledged=True,
                )
                self.assertEqual(self.transport.answered[-1]["text"], COPY_ACTION_REFUSED)
                self.assertEqual(self.transport.sent, [])

    def test_action_refusal_acknowledgement_never_carries_the_token(self):
        token = "A" * OPAQUE_CHARS
        outcome = self.handle(callback_update(4, "cf:" + token))
        self.assert_outcome(outcome, ACTION_REFUSED, update_id=4)
        self.assertNotIn(token, self.transport.answered[-1]["text"])
        self.assertNotIn(token, repr(outcome))


class ChannelALeakTests(ChannelABotTestCase):
    def test_chat_text_never_carries_the_ticket_or_the_action_nonce(self):
        nonce = self.pair_up(4, 5)
        keyboards = [payload for payload in self.transport.sent if payload["reply_markup"] is not None]
        self.assertEqual(len(keyboards), 2)
        ticket = keyboards[0]["reply_markup"]["inline_keyboard"][0][0]["callback_data"].split(":", 1)[1]
        welcome = keyboards[1]["reply_markup"]["inline_keyboard"][0][0]["callback_data"].split(":", 1)[1]
        self.assertEqual(welcome, nonce)
        for payload in self.transport.sent:
            self.assertNotIn(ticket, payload["text"])
            self.assertNotIn(nonce, payload["text"])
        for payload in self.transport.answered:
            self.assertNotIn(ticket, payload["text"] or "")
            self.assertNotIn(nonce, payload["text"] or "")

    def test_prompt_text_only_exposes_the_trusted_label(self):
        self.prompted(4)
        ticket = self.prompt_ticket()
        text = self.transport.sent[-1]["text"]
        self.assertIn(self.labels["value"], text)
        self.assertNotIn(ticket, text)
        self.assertNotIn("cf:", text)
        self.assertNotIn("cn:", text)

    def test_repr_never_exposes_tickets_nonces_or_tokens(self):
        nonce = self.pair_up(4, 5)
        record = next(iter(self.dialogue._actions.values()))
        self.assertNotIn(record.nonce, repr(self.dialogue))
        self.assertNotIn(record.nonce, repr(record))
        self.assertNotIn(nonce, repr(self.dialogue))
        self.assertNotIn("nonce", repr(self.dialogue._pending_claims))
        self.assertNotIn("token", repr(self.dialogue._pending_claims))

    def test_local_index_never_stores_the_ticket_in_clear(self):
        self.prompted(4)
        ticket = self.prompt_ticket()
        self.assertEqual(len(self.dialogue._pending_claims), 1)
        self.assertNotIn(ticket, repr(self.dialogue._pending_claims))
        digest = next(iter(self.dialogue._pending_claims))
        self.assertIsInstance(digest, bytes)
        self.assertEqual(len(digest), 32)

    def test_error_copy_never_echoes_user_input(self):
        token = "A" * OPAQUE_CHARS
        outcome = self.handle(message_update(4, "/start " + token, chat=CHAT_ID))
        self.assert_outcome(outcome, PAIRING_REFUSED, update_id=4)
        self.assertNotIn(token, self.transport.sent[-1]["text"])


class ChannelASerializationTests(ChannelABotTestCase):
    def test_concurrent_pairing_never_overlaps_the_domain_critical_section(self):
        probe = _ConcurrencyProbe(self.registry.lock)
        self.registry.lock = probe
        failures = []

        def run(index):
            try:
                transport = FakeTransport()
                dialogue = self.build(transport=transport)
                chat = chat_id(index)
                token = self.registry.issue_qr(owner_id(index)).token
                dialogue.handle_update(message_update(index * 10, "/start " + token, chat=chat))
                data = transport.sent[-1]["reply_markup"]["inline_keyboard"][0][0]["callback_data"]
                dialogue.handle_update(callback_update(index * 10 + 1, data, chat=chat))
                self.assertEqual(transport.answered[-1]["text"], COPY_CONFIRMED)
            except Exception as error:  # pragma: no cover - reported through failures
                failures.append(repr(error))

        threads = [threading.Thread(target=run, args=(index,)) for index in range(10, 14)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(15)
        self.assertEqual(failures, [])
        self.assertTrue(all(not thread.is_alive() for thread in threads))
        self.assertEqual(probe.max_depth, 1)
        self.assertEqual(len(self.dialogue._actions), 0)

    def test_destination_label_runs_outside_the_domain_lock(self):
        observed = []

        def label(owner):
            acquired = []

            def probe():
                got = self.registry.lock.acquire(timeout=2.0)
                acquired.append(got)
                if got:
                    self.registry.lock.release()

            thread = threading.Thread(target=probe)
            thread.start()
            thread.join(5)
            observed.append(acquired)
            return "Sala 3"

        transport = FakeTransport()
        dialogue = self.build(transport=transport, destination_label=label)
        outcome = dialogue.handle_update(message_update(4, "/start " + self.issue(), chat=CHAT_ID))
        self.assertEqual(outcome.kind, PAIRING_PROMPT_DELIVERED)
        self.assertEqual(observed, [[True]])

    def test_module_never_reads_environment_logging_or_credentials(self):
        source = Path(bot_module.__file__).read_text(encoding="utf-8")
        for name in ("environ", "getenv", "dotenv", "credential", "token_store", "logging"):
            with self.subTest(name=name):
                self.assertNotIn(name, source)


class ChannelABoundaryTests(ChannelABotTestCase):
    def scripted_prompt(self, index, response):
        transport = FakeTransport(send_responses=[response])
        dialogue = self.build(transport=transport)
        update = message_update(index, "/start " + self.issue(owner_id(index)), chat=chat_id(index))
        outcome = dialogue.handle_update(update)
        return dialogue, transport, outcome

    def test_delivered_send_requires_a_matching_private_chat(self):
        response = self.transport.delivered(CHAT_ID)
        response["result"]["chat"]["type"] = "group"
        dialogue, _transport, outcome = self.scripted_prompt(9, response)
        self.assertEqual(outcome.kind, PAIRING_PROMPT_UNKNOWN)
        self.assertEqual(outcome.delivery, SEND_UNKNOWN)
        self.assertEqual(len(dialogue._pending_claims), 1)

    def test_delivered_send_requires_the_configured_bot_origin(self):
        response = self.transport.delivered(CHAT_ID)
        response["result"]["from"]["id"] = OTHER_BOT_ID
        _dialogue, _transport, outcome = self.scripted_prompt(9, response)
        self.assertEqual(outcome.kind, PAIRING_PROMPT_UNKNOWN)

    def test_delivered_send_requires_a_positive_bounded_message_id(self):
        for value in (None, 0, True, "1", MAX_TELEGRAM_ID + 1):
            with self.subTest(value=value):
                self.setUp()
                response = self.transport.delivered(CHAT_ID)
                response["result"]["message_id"] = value
                _dialogue, _transport, outcome = self.scripted_prompt(9, response)
                self.assertEqual(outcome.kind, PAIRING_PROMPT_UNKNOWN)
                self.assertEqual(outcome.delivery, SEND_UNKNOWN)

    def test_delivered_send_requires_a_result_object(self):
        for response in ({"ok": True}, {"ok": True, "result": None}, {"ok": True, "result": "done"}):
            with self.subTest(response=response):
                self.setUp()
                _dialogue, _transport, outcome = self.scripted_prompt(9, response)
                self.assertEqual(outcome.kind, PAIRING_PROMPT_UNKNOWN)

    def test_rejected_send_requires_a_bounded_error_and_description(self):
        variants = (
            {"ok": False},
            {"ok": False, "error_code": 400},
            {"ok": False, "error_code": 400, "description": ""},
            {"ok": False, "error_code": 400, "description": "   "},
            {"ok": False, "error_code": 400, "description": "x" * 513},
            {"ok": False, "error_code": True, "description": "x"},
            {"ok": False, "error_code": 0, "description": "x"},
            {"ok": False, "error_code": "400", "description": "x"},
        )
        for response in variants:
            with self.subTest(response=response):
                self.setUp()
                _dialogue, _transport, outcome = self.scripted_prompt(9, response)
                self.assertEqual(outcome.kind, PAIRING_PROMPT_UNKNOWN)
                self.assertEqual(len(self.registry._pendings), 1)

    def test_malformed_and_non_mapping_send_responses_are_unknown(self):
        for response in (None, "ok", 5, [], {"ok": "yes"}, {"ok": 1, "result": {}}):
            with self.subTest(response=response):
                self.setUp()
                _dialogue, _transport, outcome = self.scripted_prompt(9, response)
                self.assertEqual(outcome.kind, PAIRING_PROMPT_UNKNOWN)
                self.assertEqual(outcome.delivery, SEND_UNKNOWN)
                self.assertEqual(len(self.registry._pendings), 1)

    def test_acknowledgement_response_must_be_explicit(self):
        for response, expected in (
            ({"ok": True, "result": True}, True),
            (True, True),
            ({"ok": True}, False),
            ({"ok": True, "result": False}, False),
            ({"ok": False, "error_code": 400, "description": "x"}, False),
            ("accepted", False),
            (None, False),
        ):
            with self.subTest(response=response):
                self.setUp()
                self.transport.ack_responses = [response]
                outcome = self.handle(callback_update(4, "cf:" + "A" * OPAQUE_CHARS))
                self.assert_outcome(outcome, ACTION_REFUSED, update_id=4, acknowledged=expected)

    def test_acknowledgement_exception_is_reported_as_not_acknowledged(self):
        def explode(payload):
            raise RuntimeError("ack transport down")

        self.transport.on_ack = explode
        outcome = self.handle(callback_update(4, "cf:" + "A" * OPAQUE_CHARS))
        self.assert_outcome(outcome, ACTION_REFUSED, update_id=4, acknowledged=False)

    def test_transport_is_called_with_named_arguments_only(self):
        self.prompted(4)
        self.assertEqual(set(self.transport.sent[-1]), {"chat_id", "text", "reply_markup"})
        self.assertEqual(self.transport.answered, [])
        ticket = self.prompt_ticket()
        self.handle(callback_update(5, CALLBACK_CANCEL + ":" + ticket))
        self.assertEqual(set(self.transport.answered[-1]), {"callback_query_id", "text"})
        self.assertEqual(self.transport.answered[-1]["callback_query_id"], "cb-1")

    def test_hostile_updates_never_raise_and_always_report_an_outcome(self):
        hostile = (
            None,
            5,
            "text",
            [],
            {},
            {"update_id": 1},
            {"update_id": -5, "message": {}},
            {"update_id": 1, "message": {"chat": {}, "from": {}, "text": 7}},
            {"update_id": 1, "callback_query": {"id": "cb", "from": {}, "data": "cf:1"}},
            {"update_id": 1, "message": {}, "callback_query": {}},
        )
        for body in hostile:
            with self.subTest(body=body):
                outcome = self.handle(body)
                self.assertIsInstance(outcome, IngressOutcome)
                self.assertIsInstance(outcome.kind, str)
                self.assertIn(outcome.variant, (VARIANT_MESSAGE, VARIANT_CALLBACK, VARIANT_UNKNOWN))
                self.assertIsInstance(outcome.accepted, bool)


SNAPSHOT = {"widgets": [{"id": "oee", "title": "OEE", "data": {"value": 88.5}, "unit": "%"}]}
SNAPSHOT2 = {"widgets": [{"id": "oee", "title": "OEE", "data": {"value": 12.5}, "unit": "%"}]}


class ChannelAQueryIntegrationTests(ChannelABotTestCase):
    """RCA-3b: ordinary text queries routed through the adapter's own send."""

    def setUp(self):
        super().setUp()
        self.wall = [1000.0]
        self.sessions = HmiSessionRegistry(
            clock=lambda: self.wall[0],
            owner_factory=lambda: OWNER,
            entropy=sequential_entropy(),
        )
        self.parses = []
        self.touches = []
        self.parse_hook = None
        original = self.registry.human_touch

        def recorded(phone_id, generation):
            self.touches.append((phone_id, generation))
            return original(phone_id, generation)

        self.registry.human_touch = recorded
        self.open_session(OWNER, SNAPSHOT)
        self.coordinator = self.enable_queries()

    # -- wiring helpers ----------------------------------------------------

    def open_session(self, owner, snapshot=SNAPSHOT):
        original = self.sessions.owner_factory
        self.sessions.owner_factory = lambda owner=owner: owner
        try:
            capability, _info = self.sessions.create()
        finally:
            self.sessions.owner_factory = original
        if snapshot is not None:
            self.sessions.set_context(capability, snapshot)
        return capability

    def parse(self, snapshot, question):
        self.parses.append((snapshot, question))
        if self.parse_hook is not None:
            self.parse_hook()
        return answer_from_snapshot(snapshot, question)

    def enable_queries(self, **overrides):
        options = {
            "read_context": self.sessions.get_owner_context,
            "parse": self.parse,
            "freshness_bound": 30.0,
            "max_question_bytes": 4096,
            "max_answer_chars": 4096,
        }
        options.update(overrides)
        return self.dialogue.enable_queries(**options)

    def query(self, question, *, owner=OWNER, chat=CHAT_ID, claim_id=4, confirm_id=5, query_id=6):
        self.pair_up(claim_id, confirm_id, owner=owner, chat=chat)
        return self.handle(message_update(query_id, question, chat=chat))

    # -- wiring contract ---------------------------------------------------

    def test_enable_queries_builds_and_stores_the_coordinator(self):
        coordinator = self.coordinator
        self.assertIsInstance(coordinator, ChannelAQueryCoordinator)
        self.assertIs(self.dialogue.query, coordinator)
        self.assertTrue(callable(self.dialogue.binding_admitted))
        self.assertTrue(callable(self.dialogue.send_query))

    def test_enable_queries_rejects_unusable_injected_dependencies_without_attaching(self):
        for overrides in (
            {"parse": None},
            {"read_context": None},
            {"freshness_bound": 0},
            {"max_question_bytes": 0},
            {"max_answer_chars": -1},
        ):
            with self.subTest(overrides=overrides):
                dialogue = self.build()
                options = {
                    "read_context": self.sessions.get_owner_context,
                    "parse": self.parse,
                    "freshness_bound": 30.0,
                    "max_question_bytes": 4096,
                    "max_answer_chars": 4096,
                }
                options.update(overrides)
                with self.assertRaises(ChannelAQueryConfigInvalid):
                    dialogue.enable_queries(**options)
                self.assertIsNone(dialogue.query)

    def test_a_second_attachment_is_rejected_before_state_change(self):
        original = self.dialogue.query
        self.assertIsNotNone(original)
        with self.assertRaises(ChannelABotConfigInvalid) as captured:
            self.enable_queries(max_question_bytes=1, max_answer_chars=1)
        self.assertEqual(str(captured.exception), PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
        self.assertIs(self.dialogue.query, original)
        # The rejected attempt did not install the 1-character policy.
        outcome = self.query("¿cuál es el oee?")
        self.assert_outcome(outcome, QUERY_ANSWER_DELIVERED)
        self.assertIsNotNone(outcome.answer_envelope)
        self.assertGreater(len(self.transport.sent[-1]["text"]), 1)

    def test_concurrent_attachments_leave_exactly_one_coordinator(self):
        dialogue = self.build()
        results = []
        barrier = threading.Barrier(4)

        def attach(_index):
            try:
                barrier.wait(timeout=5)
                coordinator = dialogue.enable_queries(
                    read_context=self.sessions.get_owner_context,
                    parse=self.parse,
                    freshness_bound=30.0,
                    max_question_bytes=4096,
                    max_answer_chars=4096,
                )
            except ChannelABotConfigInvalid as error:
                results.append(("rejected", str(error)))
            else:
                results.append(("attached", coordinator))

        threads = [threading.Thread(target=attach, args=(index,)) for index in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)
        attached = [value for status, value in results if status == "attached"]
        rejected = [value for status, value in results if status == "rejected"]
        self.assertEqual(len(attached), 1)
        self.assertEqual(rejected, [PRISMA_CHANNEL_A_BOT_CONFIG_INVALID] * 3)
        self.assertIs(dialogue.query, attached[0])

    def test_epoch_factory_must_produce_a_bounded_opaque_value(self):
        for value in (5, "epoch", lambda: "", lambda: None, lambda: "x" * 200):
            with self.subTest(value=value):
                with self.assertRaises(ChannelABotConfigInvalid):
                    ChannelAPairingDialogue(
                        bot_id=BOT_ID,
                        registry=self.registry,
                        transport=self.transport,
                        destination_label=self.label,
                        epoch_factory=value,
                    )

    def test_without_the_coordinator_ordinary_text_stays_ignored(self):
        plain = self.build()
        self.assertIsNone(plain.query)
        outcome = plain.handle_update(message_update(4, "hola", chat=CHAT_ID))
        self.assert_outcome(outcome, INGRESS_IGNORED_UNRELATED, update_id=4)
        self.assertIsNone(outcome.answer_envelope)

    # -- happy path --------------------------------------------------------

    def test_a_linked_phone_query_is_answered_and_enveloped(self):
        outcome = self.query("¿cuál es el oee?")
        self.assert_outcome(
            outcome,
            QUERY_ANSWER_DELIVERED,
            variant=VARIANT_MESSAGE,
            delivery=SEND_DELIVERED,
            update_id=6,
        )
        self.assertEqual(len(self.parses), 1)
        self.assertEqual(self.parses[0][1], "¿cuál es el oee?")
        self.assertEqual(self.parses[0][0], SNAPSHOT)
        sent = self.transport.sent[-1]
        self.assertEqual(sent["chat_id"], CHAT_ID)
        self.assertIn("88", sent["text"])
        envelope = outcome.answer_envelope
        self.assertIsNotNone(envelope)
        self.assertEqual(envelope.owner_id, OWNER)
        self.assertEqual(envelope.answer_text, sent["text"])
        self.assertEqual(envelope.update_id, 6)
        link = self.registry.phone_link(PHONE)
        self.assertEqual(envelope.generation, link.generation)
        self.assertEqual(self.touches, [(PHONE, link.generation)])

    def test_the_serialized_outcome_exposes_the_envelope_only_when_present(self):
        outcome = self.query("¿cuál es el oee?")
        data = outcome.as_dict()
        self.assertIn("answerEnvelope", data)
        self.assertEqual(data["answerEnvelope"]["answerText"], self.transport.sent[-1]["text"])
        self.assertEqual(data["kind"], QUERY_ANSWER_DELIVERED)
        self.assertEqual(data["delivery"], SEND_DELIVERED)

    def test_ordinary_text_longer_than_the_command_cap_is_still_answerable(self):
        question = "consulta " * 40
        self.assertTrue(len(question) > 128)
        outcome = self.query(question)
        self.assert_outcome(outcome, QUERY_ANSWER_DELIVERED)
        self.assertEqual(self.parses[0][1], question.strip())

    def test_the_start_command_cap_is_unchanged_when_queries_are_enabled(self):
        outcome = self.handle(message_update(4, "/start " + "A" * 200, chat=CHAT_ID))
        self.assert_outcome(outcome, INGRESS_IGNORED_MALFORMED, update_id=4)
        self.assertIsNone(outcome.answer_envelope)

    def test_two_independent_pairs_never_cross_answers(self):
        self.open_session(OWNER2, SNAPSHOT2)
        first = self.query("¿cuál es el oee?", claim_id=4, confirm_id=5, query_id=6)
        second = self.query(
            "¿cuál es el oee?",
            owner=OWNER2,
            chat=CHAT_ID_2,
            claim_id=10,
            confirm_id=11,
            query_id=12,
        )
        self.assertEqual(first.answer_envelope.owner_id, OWNER)
        self.assertEqual(second.answer_envelope.owner_id, OWNER2)
        self.assertEqual(self.parses[0][0], SNAPSHOT)
        self.assertEqual(self.parses[1][0], SNAPSHOT2)
        self.assertEqual(self.transport.sent[-1]["chat_id"], CHAT_ID_2)

    # -- ignored input -----------------------------------------------------

    def test_blank_commands_and_oversize_text_never_route_or_touch(self):
        self.pair_up(4, 5)
        sent_before = len(self.transport.sent)
        cases = (
            ("", QUERY_IGNORED_BLANK),
            ("   ", QUERY_IGNORED_BLANK),
            ("/help", INGRESS_IGNORED_UNRELATED),
            ("  /unlink  ", QUERY_IGNORED_COMMAND),
            ("x" * 5000, QUERY_IGNORED_OVERSIZE),
            ("hola \ud800 mundo", QUERY_IGNORED_MALFORMED),
        )
        for question, kind in cases:
            with self.subTest(question=question):
                update_id = self.tick()
                outcome = self.handle(message_update(update_id, question, chat=CHAT_ID))
                self.assert_outcome(
                    outcome, kind, variant=VARIANT_MESSAGE, update_id=update_id
                )
                self.assertIsNone(outcome.answer_envelope)
        self.assertEqual(len(self.transport.sent), sent_before)
        self.assertEqual(self.touches, [])
        self.assertEqual(self.parses, [])

    def test_an_unlinked_phone_is_never_routed(self):
        outcome = self.handle(message_update(4, "hola", chat=CHAT_ID))
        self.assert_outcome(outcome, QUERY_IGNORED_UNBOUND, update_id=4)
        self.assert_quiet()
        self.assertEqual(self.touches, [])
        self.assertEqual(self.parses, [])

    def test_input_at_or_below_the_confirmation_fence_is_stale(self):
        self.pair_up(4, 5)
        digest = next(iter(self.dialogue._actions))
        self.dialogue._actions[digest].confirmed_update_id = 99
        self.dialogue._last_update_id = 0
        outcome = self.handle(message_update(50, "hola", chat=CHAT_ID))
        self.assert_outcome(outcome, QUERY_IGNORED_STALE, update_id=50)
        self.assertIsNone(outcome.answer_envelope)
        self.assertEqual(self.touches, [])
        self.assertEqual(self.parses, [])

    def test_a_foreign_owner_query_cannot_borrow_the_binding(self):
        self.pair_up(4, 5)
        digest = next(iter(self.dialogue._actions))
        self.dialogue._actions[digest].owner_id = OWNER2
        outcome = self.handle(message_update(6, "hola", chat=CHAT_ID))
        self.assert_outcome(outcome, QUERY_IGNORED_STALE)
        self.assertEqual(self.parses, [])
        self.assertEqual(self.touches, [])

    # -- failure and delivery ---------------------------------------------

    def test_a_rejected_answer_send_exposes_no_envelope_and_is_not_retried(self):
        self.pair_up(4, 5)
        sent_before = len(self.transport.sent)
        self.transport.send_responses = [FakeTransport.rejected()]
        outcome = self.handle(message_update(6, "hola", chat=CHAT_ID))
        self.assert_outcome(outcome, QUERY_ANSWER_REJECTED, delivery=SEND_REJECTED)
        self.assertIsNone(outcome.answer_envelope)
        self.assertEqual(len(self.transport.sent), sent_before + 1)

    def test_an_unknown_answer_send_exposes_no_envelope_and_is_not_retried(self):
        self.pair_up(4, 5)
        self.transport.send_responses = [{"ok": True, "result": "not-a-message"}]
        outcome = self.handle(message_update(6, "hola", chat=CHAT_ID))
        self.assert_outcome(outcome, QUERY_ANSWER_UNKNOWN, delivery=SEND_UNKNOWN)
        self.assertIsNone(outcome.answer_envelope)
        self.assertEqual(len(self.parses), 1)

    def test_a_post_send_relink_withholds_the_hmi_envelope(self):
        self.pair_up(4, 5)

        def relink(_payload):
            link = self.registry.phone_link(PHONE)
            self.registry.unlink_phone(PHONE, link.generation)

        self.transport.on_send = relink
        outcome = self.handle(message_update(6, "hola", chat=CHAT_ID))
        self.assert_outcome(outcome, QUERY_ANSWER_UNPUBLISHED, delivery=SEND_DELIVERED)
        self.assertIsNone(outcome.answer_envelope)

    def test_a_parser_invalidation_discards_the_query_before_sending(self):
        self.pair_up(4, 5)
        self.parse_hook = lambda: self.registry.invalidate_owner(OWNER)
        sent_before = len(self.transport.sent)
        outcome = self.handle(message_update(6, "hola", chat=CHAT_ID))
        self.assert_outcome(outcome, QUERY_IGNORED_STALE)
        self.assertIsNone(outcome.answer_envelope)
        self.assertEqual(len(self.transport.sent), sent_before)

    def test_reconfiguration_during_parse_cannot_swap_authority(self):
        self.pair_up(4, 5)
        attempts = []
        original = self.dialogue.query

        def reconfigure():
            try:
                self.enable_queries(max_answer_chars=1)
            except ChannelABotConfigInvalid as error:
                attempts.append(str(error))
            else:
                attempts.append("attached")

        self.parse_hook = reconfigure
        sent_before = len(self.transport.sent)
        outcome = self.handle(message_update(6, "¿cuál es el oee?", chat=CHAT_ID))
        self.assertEqual(attempts, [PRISMA_CHANNEL_A_BOT_CONFIG_INVALID])
        self.assertIs(self.dialogue.query, original)
        # The rejected swap never installs the 1-character policy: the original
        # policy answers with the real, longer text and its envelope.
        self.assert_outcome(outcome, QUERY_ANSWER_DELIVERED, delivery=SEND_DELIVERED)
        self.assertIsNotNone(outcome.answer_envelope)
        self.assertGreater(len(self.transport.sent[-1]["text"]), 1)
        self.assertEqual(len(self.transport.sent), sent_before + 1)

    def test_an_uncontained_reconfiguration_failure_cannot_emit_an_answer(self):
        self.pair_up(4, 5)

        def reconfigure():
            self.enable_queries(max_answer_chars=1)

        self.parse_hook = reconfigure
        sent_before = len(self.transport.sent)
        outcome = self.handle(message_update(6, "¿cuál es el oee?", chat=CHAT_ID))
        self.assert_outcome(outcome, QUERY_UNAVAILABLE, delivery=SEND_DELIVERED)
        self.assertIsNone(outcome.answer_envelope)
        self.assertEqual(self.transport.sent[-1]["text"], COPY_QUERY_UNAVAILABLE)
        self.assertEqual(len(self.transport.sent), sent_before + 1)

    def test_a_stale_context_fails_closed_with_a_generic_notice(self):
        self.pair_up(4, 5)
        self.wall[0] += 1000.0
        outcome = self.handle(message_update(6, "hola", chat=CHAT_ID))
        self.assert_outcome(outcome, QUERY_UNAVAILABLE, delivery=SEND_DELIVERED)
        self.assertIsNone(outcome.answer_envelope)
        self.assertEqual(self.transport.sent[-1]["text"], COPY_QUERY_UNAVAILABLE)
        self.assertEqual(self.parses, [])

    def test_the_envelope_repr_never_carries_the_nonce_or_the_question(self):
        self.pair_up(4, 5)
        digest = next(iter(self.dialogue._actions))
        nonce = self.dialogue._actions[digest].nonce
        outcome = self.handle(message_update(6, "¿cuál es el oee?", chat=CHAT_ID))
        rendered = repr(outcome) + repr(outcome.answer_envelope) + str(outcome.as_dict())
        self.assertNotIn(nonce, rendered)
        self.assertNotIn("¿cuál es el oee?", rendered)


if __name__ == "__main__":
    unittest.main()
