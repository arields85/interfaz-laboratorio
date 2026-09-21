"""Behavioral contract tests for the standalone Channel A transport (RCA-5a).

The transport is driven exclusively through fake sessions and fake responses, so
no test opens a socket, reads a credential, starts a polling loop or waits on a
sleep. The default-factory test patches the module's ``requests`` construction
both to prove ``trust_env`` is disabled and to make a real request impossible.
Concurrency is coordinated with events and a barrier, which is deterministic
evidence rather than a timing race.
"""

import json
import os
import sys
import threading
import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path
from unittest.mock import Mock, patch

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime import channel_a_transport as transport_module
from prisma_runtime.channel_a_bot import (
    MAX_ACK_TEXT_CHARS,
    MAX_CALLBACK_ID_CHARS,
    MAX_TELEGRAM_ID,
)
from prisma_runtime.channel_a_transport import (
    CHANNEL_A_API_BASE,
    PRISMA_CHANNEL_A_TRANSPORT_UNAVAILABLE,
    ChannelABotIdentity,
    ChannelATransport,
    ChannelATransportError,
)
from prisma_runtime.credential_store import MAX_SECRET_BYTES

TOKEN = "123456:CHANNEL-A_Token"
TIMEOUT = 8.0
CHAT_ID = 5001
CALLBACK_ID = "callback-ticket-1"
MESSAGE_LIMIT = 4096
CANARY = "canary-synthetic-secret-42"


def ok_body(result):
    return {"ok": True, "result": result}


class FakeResponse:
    """A controlled response that records how many times it was closed."""

    def __init__(self, status_code=200, body=None, *, json_error=None, close_error=None, status_error=None):
        self._status = status_code
        self._body = body
        self._json_error = json_error
        self._close_error = close_error
        self._status_error = status_error
        self.close_calls = 0

    @property
    def status_code(self):
        if self._status_error is not None:
            raise self._status_error
        return self._status

    def json(self):
        if self._json_error is not None:
            raise self._json_error
        return self._body

    def close(self):
        self.close_calls += 1
        if self._close_error is not None:
            raise self._close_error


class FakeSession:
    """An owned session whose ``post`` records the exact URL and keyword arguments."""

    def __init__(self, response=None, *, post_error=None, close_error=None, before_post=None):
        self.response = response
        self.post_error = post_error
        self.close_error = close_error
        self.before_post = before_post
        self.calls = []
        self.close_calls = 0

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if self.before_post is not None:
            self.before_post()
        if self.post_error is not None:
            raise self.post_error
        return self.response

    def close(self):
        self.close_calls += 1
        if self.close_error is not None:
            raise self.close_error


class SessionFactory:
    """Hands out one pre-built session per call and records how many were taken."""

    def __init__(self, *sessions):
        self.sessions = list(sessions)
        self.calls = []

    def __call__(self):
        self.calls.append(object())
        return self.sessions.pop(0)


class ThrowingGetMapping(dict):
    """A provider mapping whose ``get`` raises, optionally for a single key only."""

    def __init__(self, value, error, *, raise_for=None):
        super().__init__(value)
        self.error = error
        self.raise_for = raise_for
        self.get_calls = 0
        self.keys_seen = []

    def get(self, key, default=None):
        self.get_calls += 1
        self.keys_seen.append(key)
        if self.raise_for is None or key == self.raise_for:
            raise self.error
        return super().get(key, default)


class SetupFailingSession:
    """A session obtained by the default factory whose ``trust_env`` assignment fails."""

    def __init__(self, setup_error, close_error=None):
        self.setup_error = setup_error
        self.close_error = close_error
        self.close_calls = 0
        self.post_calls = 0

    @property
    def trust_env(self):
        return True

    @trust_env.setter
    def trust_env(self, value):
        raise self.setup_error

    def post(self, *args, **kwargs):
        self.post_calls += 1
        raise AssertionError("a session that failed setup must never post")

    def close(self):
        self.close_calls += 1
        if self.close_error is not None:
            raise self.close_error


class ChannelATransportTestCase(unittest.TestCase):
    def build(self, *sessions, token=TOKEN, timeout=TIMEOUT):
        self.factory = SessionFactory(*sessions)
        return ChannelATransport(token, request_timeout=timeout, session_factory=self.factory)

    def assert_unavailable(self, error):
        self.assertIsInstance(error, ChannelATransportError)
        self.assertEqual(str(error), PRISMA_CHANNEL_A_TRANSPORT_UNAVAILABLE)
        self.assertIsNone(error.__cause__)
        self.assertTrue(error.__suppress_context__)
        self.assertNotIn(CANARY, repr(error))

    def assert_rejected_before_io(self, call):
        factory = SessionFactory()
        transport = ChannelATransport(TOKEN, request_timeout=TIMEOUT, session_factory=factory)
        with self.assertRaises(ChannelATransportError) as raised:
            call(transport)
        self.assert_unavailable(raised.exception)
        self.assertEqual(factory.calls, [])

    def assert_posted(self, session, method, payload, timeout=TIMEOUT):
        self.assertEqual(len(session.calls), 1)
        url, kwargs = session.calls[0]
        self.assertEqual(url, f"{CHANNEL_A_API_BASE}/bot{TOKEN}/{method}")
        self.assertEqual(kwargs, {"json": payload, "timeout": timeout, "allow_redirects": False})


class ConstructorTests(ChannelATransportTestCase):
    def test_request_timeout_is_required_keyword_only_and_never_defaulted(self):
        factory = SessionFactory()
        with self.assertRaises(TypeError):
            ChannelATransport(TOKEN, session_factory=factory)
        with self.assertRaises(TypeError):
            ChannelATransport(TOKEN, TIMEOUT, session_factory=factory)
        self.assertEqual(factory.calls, [])

    def test_construction_is_lazy_and_touches_no_http_dependency(self):
        with patch.object(transport_module.requests, "Session") as session_type:
            transport = self.build()
        self.assertEqual(session_type.mock_calls, [])
        self.assertEqual(self.factory.calls, [])
        self.assertEqual(transport.request_timeout, TIMEOUT)

    def test_invalid_tokens_are_rejected_before_any_io(self):
        invalid = (
            "",
            " ",
            "  token  ",
            "tok en",
            "token\n",
            "token\u00e9",
            "token#",
            "a" * (MAX_SECRET_BYTES + 1),
            None,
            123,
            b"token",
            True,
        )
        for token in invalid:
            with self.subTest(token=token):
                factory = SessionFactory()
                with self.assertRaises(ChannelATransportError) as raised:
                    ChannelATransport(token, request_timeout=TIMEOUT, session_factory=factory)
                self.assert_unavailable(raised.exception)
                self.assertEqual(factory.calls, [])

    def test_token_character_set_and_secret_byte_bound_are_accepted(self):
        for token in ("123456:ABC-def_9", "a" * MAX_SECRET_BYTES, "9:-"):
            with self.subTest(token=token[:12]):
                factory = SessionFactory()
                transport = ChannelATransport(token, request_timeout=TIMEOUT, session_factory=factory)
                session = FakeSession(FakeResponse(200, {"ok": True}))
                factory.sessions.append(session)
                transport.send_message(chat_id=CHAT_ID, text="hola")
                self.assertEqual(session.calls[0][0], f"{CHANNEL_A_API_BASE}/bot{token}/sendMessage")

    def test_invalid_timeouts_are_rejected_before_any_io(self):
        invalid = (0, -1, -0.5, True, False, float("nan"), float("inf"), float("-inf"), "10", None, 10**1000)
        for timeout in invalid:
            with self.subTest(timeout=timeout):
                factory = SessionFactory()
                with self.assertRaises(ChannelATransportError) as raised:
                    ChannelATransport(TOKEN, request_timeout=timeout, session_factory=factory)
                self.assert_unavailable(raised.exception)
                self.assertEqual(factory.calls, [])

    def test_valid_timeouts_are_accepted_without_io(self):
        for timeout in (1, 0.5, 30.0, 10**300):
            with self.subTest(timeout=timeout):
                factory = SessionFactory()
                transport = ChannelATransport(TOKEN, request_timeout=timeout, session_factory=factory)
                self.assertEqual(transport.request_timeout, timeout)
                self.assertEqual(factory.calls, [])

    def test_explicit_none_selects_the_lazy_default_factory(self):
        with patch.object(transport_module.requests, "Session") as session_type:
            transport = ChannelATransport(TOKEN, request_timeout=TIMEOUT, session_factory=None)
            self.assertEqual(session_type.call_count, 0)
            session_type.return_value.post.return_value = FakeResponse(200, {"ok": True})
            transport.send_message(chat_id=CHAT_ID, text="hola")
            created = session_type.return_value
        self.assertEqual(session_type.call_count, 1)
        self.assertFalse(created.trust_env)
        self.assertEqual(created.post.call_args.args, (f"{CHANNEL_A_API_BASE}/bot{TOKEN}/sendMessage",))
        self.assertEqual(set(created.post.call_args.kwargs), {"json", "timeout", "allow_redirects"})
        self.assertNotIn("verify", created.post.call_args.kwargs)

    def test_falsy_callable_factory_is_retained(self):
        session = FakeSession(FakeResponse(200, {"ok": True}))

        class FalsyFactory:
            def __init__(self, owned):
                self.owned = owned
                self.calls = 0

            def __bool__(self):
                return False

            def __call__(self):
                self.calls += 1
                return self.owned

        factory = FalsyFactory(session)
        transport = ChannelATransport(TOKEN, request_timeout=TIMEOUT, session_factory=factory)

        self.assertIs(transport.session_factory, factory)
        transport.send_message(chat_id=CHAT_ID, text="hola")
        self.assertEqual(factory.calls, 1)
        self.assertEqual(len(session.calls), 1)

    def test_explicit_factory_never_constructs_a_requests_session(self):
        session = FakeSession(FakeResponse(200, {"ok": True}))
        transport = self.build(session)
        with patch.object(transport_module.requests, "Session") as session_type:
            transport.send_message(chat_id=CHAT_ID, text="hola")
        self.assertEqual(session_type.mock_calls, [])


class DefaultSessionOwnershipTests(ChannelATransportTestCase):
    """The lazy default factory must not leak a session it obtained but could not configure."""

    def test_default_session_is_closed_once_when_trust_env_setup_fails(self):
        cases = (
            (RuntimeError(f"trust_env setter rejected {CANARY}"), None),
            (ChannelATransportError(CANARY), None),
            (RuntimeError(f"trust_env setter rejected {CANARY}"), RuntimeError(f"close failed {CANARY}")),
        )
        for setup_error, close_error in cases:
            with self.subTest(setup=type(setup_error).__name__, close_raises=close_error is not None):
                session = SetupFailingSession(setup_error, close_error)
                with patch.object(transport_module.requests, "Session", return_value=session) as session_type:
                    transport = ChannelATransport(TOKEN, request_timeout=TIMEOUT, session_factory=None)
                    with self.assertRaises(ChannelATransportError) as raised:
                        transport.send_message(chat_id=CHAT_ID, text="hola")
                self.assert_unavailable(raised.exception)
                self.assertNotIn(CANARY, str(raised.exception))
                self.assertEqual(session_type.call_count, 1)
                self.assertEqual(session.close_calls, 1)
                self.assertEqual(session.post_calls, 0)


class SendMessageTests(ChannelATransportTestCase):
    def test_send_message_posts_the_exact_url_payload_timeout_and_no_redirects(self):
        body = {"ok": True, "result": {"message_id": 7}}
        session = FakeSession(FakeResponse(200, body))
        transport = self.build(session)
        returned = transport.send_message(chat_id=CHAT_ID, text="estado actual")
        self.assert_posted(session, "sendMessage", {"chat_id": CHAT_ID, "text": "estado actual"})
        self.assertIs(returned, body)

    def test_two_hundred_mapping_body_passes_through_unchanged_including_explicit_ok_false(self):
        bodies = ({"ok": True, "result": {"message_id": 7}}, {"ok": False, "description": "blocked"}, {"result": {}})
        for body in bodies:
            with self.subTest(body=body):
                session = FakeSession(FakeResponse(200, body))
                transport = self.build(session)
                self.assertIs(transport.send_message(chat_id=CHAT_ID, text="hola"), body)

    def test_explicit_client_error_with_explicit_ok_false_passes_through(self):
        for status in (400, 404, 409):
            with self.subTest(status=status):
                body = {"ok": False, "error_code": status, "description": "rejected"}
                session = FakeSession(FakeResponse(status, body))
                transport = self.build(session)
                self.assertIs(transport.send_message(chat_id=CHAT_ID, text="hola"), body)

    def test_reply_markup_is_passed_as_a_json_structure_and_omitted_when_none(self):
        markup = {"inline_keyboard": [[{"text": "Confirmar", "callback_data": "cf"}]], "n": 1}
        session = FakeSession(FakeResponse(200, {"ok": True}))
        transport = self.build(session)
        transport.send_message(chat_id=CHAT_ID, text="hola", reply_markup=markup)
        url, kwargs = session.calls[0]
        self.assertIs(kwargs["json"]["reply_markup"], markup)
        self.assertIn('"inline_keyboard"', json.dumps(kwargs["json"]))

        session2 = FakeSession(FakeResponse(200, {"ok": True}))
        transport2 = self.build(session2)
        transport2.send_message(chat_id=CHAT_ID, text="hola")
        self.assertNotIn("reply_markup", session2.calls[0][1]["json"])

    def test_text_bytes_are_preserved_without_normalization(self):
        text = "  ¿Cuál es el OEE?\n\temoji: \U0001f4a1  "
        session = FakeSession(FakeResponse(200, {"ok": True}))
        transport = self.build(session)
        transport.send_message(chat_id=CHAT_ID, text=text)
        self.assertEqual(session.calls[0][1]["json"]["text"], text)

    def test_chat_identifier_bounds_are_enforced_before_io(self):
        for chat_id in (True, 0, -1, MAX_TELEGRAM_ID + 1, 10**1000, 1.0, "1", None):
            with self.subTest(chat_id=chat_id):
                self.assert_rejected_before_io(lambda t, value=chat_id: t.send_message(chat_id=value, text="hola"))
        for chat_id in (1, MAX_TELEGRAM_ID):
            with self.subTest(chat_id=chat_id):
                session = FakeSession(FakeResponse(200, {"ok": True}))
                self.build(session).send_message(chat_id=chat_id, text="hola")
                self.assertEqual(session.calls[0][1]["json"]["chat_id"], chat_id)

    def test_message_text_uses_the_4096_character_limit_without_truncation(self):
        for text in ("", None, 4097 * "a", b"hola"):
            with self.subTest(text_type=type(text).__name__):
                self.assert_rejected_before_io(lambda t, value=text: t.send_message(chat_id=CHAT_ID, text=value))

        session = FakeSession(FakeResponse(200, {"ok": True}))
        transport = self.build(session)
        transport.send_message(chat_id=CHAT_ID, text="a" * MESSAGE_LIMIT)
        self.assertEqual(len(session.calls[0][1]["json"]["text"]), MESSAGE_LIMIT)

    def test_message_limit_is_distinct_from_the_adapter_start_bound(self):
        session = FakeSession(FakeResponse(200, {"ok": True}))
        transport = self.build(session)
        transport.send_message(chat_id=CHAT_ID, text="b" * 129)
        self.assertEqual(len(session.calls[0][1]["json"]["text"]), 129)

    def test_contradictory_and_unsuccessful_statuses_normalize_to_the_fixed_error(self):
        cases = (
            (400, {"ok": True, "description": "contradictory"}),
            (400, {"description": "missing ok"}),
            (400, {"ok": 0}),
            (400, {"ok": None}),
            (302, {"ok": False}),
            (500, {"ok": False}),
            (600, {"ok": True}),
            (None, {"ok": True}),
            (True, {"ok": True}),
            ("200", {"ok": True}),
        )
        for status, body in cases:
            with self.subTest(status=status, body=body):
                session = FakeSession(FakeResponse(status, body))
                transport = self.build(session)
                with self.assertRaises(ChannelATransportError) as raised:
                    transport.send_message(chat_id=CHAT_ID, text="hola")
                self.assert_unavailable(raised.exception)
                self.assertEqual(len(session.calls), 1)

    def test_non_mapping_and_unparsable_bodies_normalize_to_the_fixed_error(self):
        cases = (
            FakeResponse(200, ["not", "a", "mapping"]),
            FakeResponse(200, "text"),
            FakeResponse(200, None),
            FakeResponse(200, None, json_error=ValueError(f"unparsable {CANARY}")),
        )
        for response in cases:
            with self.subTest(response=response):
                session = FakeSession(response)
                transport = self.build(session)
                with self.assertRaises(ChannelATransportError) as raised:
                    transport.send_message(chat_id=CHAT_ID, text="hola")
                self.assert_unavailable(raised.exception)
                self.assertEqual(response.close_calls, 1)

    def test_no_retry_after_a_failure_status(self):
        session = FakeSession(FakeResponse(500, {"ok": False}))
        transport = self.build(session)
        with self.assertRaises(ChannelATransportError):
            transport.send_message(chat_id=CHAT_ID, text="hola")
        self.assertEqual(len(session.calls), 1)


class AnswerCallbackQueryTests(ChannelATransportTestCase):
    def test_answer_posts_the_exact_payload_and_omits_absent_text(self):
        body = {"ok": True}
        session = FakeSession(FakeResponse(200, body))
        transport = self.build(session)
        returned = transport.answer_callback_query(callback_query_id=CALLBACK_ID)
        self.assert_posted(session, "answerCallbackQuery", {"callback_query_id": CALLBACK_ID})
        self.assertIs(returned, body)

    def test_empty_and_full_acknowledgement_texts_are_valid_without_truncation(self):
        for text in ("", "a" * MAX_ACK_TEXT_CHARS):
            with self.subTest(length=len(text)):
                session = FakeSession(FakeResponse(200, {"ok": True}))
                transport = self.build(session)
                transport.answer_callback_query(callback_query_id=CALLBACK_ID, text=text)
                self.assertEqual(session.calls[0][1]["json"]["text"], text)

    def test_callback_identifier_and_acknowledgement_text_bounds_are_enforced_before_io(self):
        for callback_id in ("", "a" * (MAX_CALLBACK_ID_CHARS + 1), None, 1, True):
            with self.subTest(callback_id=callback_id):
                self.assert_rejected_before_io(
                    lambda t, value=callback_id: t.answer_callback_query(callback_query_id=value)
                )
        for text in ("a" * (MAX_ACK_TEXT_CHARS + 1), 5, b"text"):
            with self.subTest(text=text):
                self.assert_rejected_before_io(
                    lambda t, value=text: t.answer_callback_query(callback_query_id=CALLBACK_ID, text=value)
                )

    def test_explicit_four_hundred_ok_false_passes_through_and_other_failures_do_not(self):
        body = {"ok": False, "error_code": 400, "description": "query is too old"}
        session = FakeSession(FakeResponse(400, body))
        self.assertIs(self.build(session).answer_callback_query(callback_query_id=CALLBACK_ID), body)

        for response in (FakeResponse(400, {"ok": True}), FakeResponse(500, {"ok": False}), FakeResponse(302, {"ok": False})):
            with self.subTest(status=response.status_code):
                session = FakeSession(response)
                transport = self.build(session)
                with self.assertRaises(ChannelATransportError) as raised:
                    transport.answer_callback_query(callback_query_id=CALLBACK_ID, text="ok")
                self.assert_unavailable(raised.exception)


class GetMeTests(ChannelATransportTestCase):
    def test_get_me_posts_an_empty_payload_and_returns_a_frozen_identity(self):
        session = FakeSession(FakeResponse(200, ok_body({"id": 987654321, "is_bot": True, "username": "prisma_bot"})))
        transport = self.build(session)
        identity = transport.get_me()
        self.assert_posted(session, "getMe", {})
        self.assertEqual(identity, ChannelABotIdentity(id=987654321, username="prisma_bot"))
        with self.assertRaises(FrozenInstanceError):
            identity.username = "other"

    def test_get_me_requires_two_hundred_and_explicit_ok_true(self):
        cases = (
            (200, {"ok": False, "result": {"id": 1, "is_bot": True, "username": "prisma_bot"}}),
            (200, {"ok": "true", "result": {"id": 1, "is_bot": True, "username": "prisma_bot"}}),
            (200, {"ok": True}),
            (200, {"result": {"id": 1, "is_bot": True, "username": "prisma_bot"}}),
            (200, {"ok": True, "result": None}),
            (400, {"ok": True, "result": {"id": 1, "is_bot": True, "username": "prisma_bot"}}),
            (500, {"ok": True, "result": {"id": 1, "is_bot": True, "username": "prisma_bot"}}),
        )
        for status, body in cases:
            with self.subTest(status=status, body=body):
                session = FakeSession(FakeResponse(status, body))
                transport = self.build(session)
                with self.assertRaises(ChannelATransportError) as raised:
                    transport.get_me()
                self.assert_unavailable(raised.exception)

    def test_get_me_validates_the_identity_fields(self):
        invalid = (
            {"id": True, "is_bot": True, "username": "prisma_bot"},
            {"id": 0, "is_bot": True, "username": "prisma_bot"},
            {"id": -1, "is_bot": True, "username": "prisma_bot"},
            {"id": MAX_TELEGRAM_ID + 1, "is_bot": True, "username": "prisma_bot"},
            {"id": 10**1000, "is_bot": True, "username": "prisma_bot"},
            {"id": "1", "is_bot": True, "username": "prisma_bot"},
            {"id": 1.0, "is_bot": True, "username": "prisma_bot"},
            {"id": 1, "is_bot": False, "username": "prisma_bot"},
            {"id": 1, "is_bot": 1, "username": "prisma_bot"},
            {"id": 1, "is_bot": "true", "username": "prisma_bot"},
            {"id": 1, "is_bot": True},
            {"id": 1, "is_bot": True, "username": "abcd"},
            {"id": 1, "is_bot": True, "username": "a" * 33},
            {"id": 1, "is_bot": True, "username": "prisma-bot"},
            {"id": 1, "is_bot": True, "username": "prisma bot"},
            {"id": 1, "is_bot": True, "username": 5},
            {"id": 1, "is_bot": True, "username": "bot\u00e9"},
            {"id": 1, "is_bot": True, "username": None},
        )
        for result in invalid:
            with self.subTest(result=result):
                session = FakeSession(FakeResponse(200, ok_body(result)))
                transport = self.build(session)
                with self.assertRaises(ChannelATransportError) as raised:
                    transport.get_me()
                self.assert_unavailable(raised.exception)

    def test_get_me_accepts_the_documented_username_bounds_without_a_suffix_assertion(self):
        for username in ("abcde", "a" * 32, "prisma_bot", "1_2_3", "NoSuffix"):
            with self.subTest(username=username):
                session = FakeSession(FakeResponse(200, ok_body({"id": MAX_TELEGRAM_ID, "is_bot": True, "username": username})))
                identity = self.build(session).get_me()
                self.assertEqual(identity.username, username)
                self.assertEqual(identity.id, MAX_TELEGRAM_ID)

    def test_get_me_rejects_a_non_mapping_result(self):
        for result in ([1, 2], "prisma_bot", 5, True):
            with self.subTest(result=result):
                session = FakeSession(FakeResponse(200, ok_body(result)))
                transport = self.build(session)
                with self.assertRaises(ChannelATransportError) as raised:
                    transport.get_me()
                self.assert_unavailable(raised.exception)


class GetUpdatesTests(ChannelATransportTestCase):
    def test_get_updates_posts_the_exact_payload_without_an_offset(self):
        session = FakeSession(FakeResponse(200, ok_body([])))
        transport = self.build(session)
        self.assertEqual(transport.get_updates(poll_timeout=10, read_timeout=15.5), ())
        self.assert_posted(
            session,
            "getUpdates",
            {"timeout": 10, "limit": 100, "allowed_updates": ["message", "callback_query"]},
            timeout=(TIMEOUT, 15.5),
        )

    def test_only_get_updates_uses_the_two_value_http_timeout(self):
        bodies = (
            {"ok": True, "result": {"message_id": 1}},
            {"ok": True},
            {"ok": True, "result": {"id": 1, "is_bot": True, "username": "prisma_bot"}},
            {"ok": True, "result": []},
        )
        sessions = [FakeSession(FakeResponse(200, body)) for body in bodies]
        factory = SessionFactory(*sessions)
        transport = ChannelATransport(TOKEN, request_timeout=2, session_factory=factory)
        transport.send_message(chat_id=CHAT_ID, text="hola")
        transport.answer_callback_query(callback_query_id=CALLBACK_ID)
        transport.get_me()
        transport.get_updates(poll_timeout=5, read_timeout=7)
        self.assertEqual([session.calls[0][1]["timeout"] for session in sessions], [2, 2, 2, (2, 7)])

    def test_get_updates_includes_a_valid_offset_and_omits_an_absent_one(self):
        for offset in (0, MAX_TELEGRAM_ID + 1):
            with self.subTest(offset=offset):
                session = FakeSession(FakeResponse(200, ok_body([])))
                transport = self.build(session)
                transport.get_updates(poll_timeout=0, read_timeout=0.5, offset=offset)
                self.assertEqual(session.calls[0][1]["json"]["offset"], offset)
                self.assertEqual(session.calls[0][1]["timeout"], (TIMEOUT, 0.5))

    def test_get_updates_timeouts_are_validated_before_io(self):
        for poll_timeout in (-1, True, 1.5, "10", None, 10**1000):
            with self.subTest(poll_timeout=poll_timeout):
                self.assert_rejected_before_io(
                    lambda t, value=poll_timeout: t.get_updates(poll_timeout=value, read_timeout=30)
                )
        for read_timeout in (0, -1, True, float("nan"), float("inf"), "10", None, 10**1000, 10, 9.5):
            with self.subTest(read_timeout=read_timeout):
                self.assert_rejected_before_io(
                    lambda t, value=read_timeout: t.get_updates(poll_timeout=10, read_timeout=value)
                )

    def test_get_updates_offset_bounds_are_validated_before_io(self):
        for offset in (-1, MAX_TELEGRAM_ID + 2, True, 1.0, "5", 10**1000):
            with self.subTest(offset=offset):
                self.assert_rejected_before_io(
                    lambda t, value=offset: t.get_updates(poll_timeout=0, read_timeout=1, offset=value)
                )

    def test_get_updates_preserves_order_and_content_without_owning_the_offset(self):
        first = {"update_id": 9, "message": {"text": "later"}}
        second = {"update_id": 3, "callback_query": {"id": "cb"}}
        result = [first, second, first]
        session = FakeSession(FakeResponse(200, ok_body(list(result))))
        transport = self.build(session)
        updates = transport.get_updates(poll_timeout=1, read_timeout=2)
        self.assertEqual(updates, (first, second, first))
        self.assertIs(updates[0], first)
        self.assertEqual([item["update_id"] for item in updates], [9, 3, 9])

        session2 = FakeSession(FakeResponse(200, ok_body([])))
        transport2 = self.build(session2)
        transport2.get_updates(poll_timeout=1, read_timeout=2)
        self.assertEqual(session2.calls[0][1]["json"], session.calls[0][1]["json"])
        self.assertEqual(session2.calls[0][1]["timeout"], session.calls[0][1]["timeout"])
        self.assertEqual(session.calls[0][1]["timeout"], (TIMEOUT, 2))
        self.assertNotIn("offset", session2.calls[0][1]["json"])

    def test_get_updates_rejects_non_mapping_items_and_non_list_results(self):
        for result in ([{"update_id": 1}, "item"], [None], [5], {"update_id": 1}, None, "item"):
            with self.subTest(result=result):
                session = FakeSession(FakeResponse(200, ok_body(result)))
                transport = self.build(session)
                with self.assertRaises(ChannelATransportError) as raised:
                    transport.get_updates(poll_timeout=1, read_timeout=2)
                self.assert_unavailable(raised.exception)

    def test_get_updates_requires_two_hundred_and_explicit_ok_true(self):
        for status, body in ((200, {"ok": False, "result": []}), (200, {"ok": True}), (400, {"ok": True, "result": []})):
            with self.subTest(status=status, body=body):
                session = FakeSession(FakeResponse(status, body))
                transport = self.build(session)
                with self.assertRaises(ChannelATransportError) as raised:
                    transport.get_updates(poll_timeout=1, read_timeout=2)
                self.assert_unavailable(raised.exception)


class MappingAccessorTests(ChannelATransportTestCase):
    """A provider mapping whose accessors fail must never leak a canary upward."""

    def test_client_error_classification_normalizes_a_throwing_outer_get(self):
        for error in (RuntimeError(CANARY), ChannelATransportError(CANARY)):
            with self.subTest(error=type(error).__name__):
                body = ThrowingGetMapping({"ok": False, "error_code": 400}, error)
                session = FakeSession(FakeResponse(400, body))
                transport = self.build(session)
                with self.assertRaises(ChannelATransportError) as raised:
                    transport.send_message(chat_id=CHAT_ID, text="hola")
                self.assert_unavailable(raised.exception)
                self.assertEqual(session.close_calls, 1)

    def test_two_hundred_effect_body_is_returned_by_identity_without_touching_accessors(self):
        body = ThrowingGetMapping({"ok": False}, RuntimeError(CANARY))
        session = FakeSession(FakeResponse(200, body))
        transport = self.build(session)
        self.assertIs(transport.send_message(chat_id=CHAT_ID, text="hola"), body)
        self.assertEqual(body.get_calls, 0)
        self.assertEqual(session.close_calls, 1)

    def test_discovery_normalizes_a_throwing_outer_get(self):
        for error in (RuntimeError(CANARY), ChannelATransportError(CANARY)):
            for call in (lambda t: t.get_me(), lambda t: t.get_updates(poll_timeout=1, read_timeout=2)):
                with self.subTest(error=type(error).__name__, call=call):
                    session = FakeSession(FakeResponse(200, ThrowingGetMapping({"ok": True, "result": []}, error)))
                    transport = self.build(session)
                    with self.assertRaises(ChannelATransportError) as raised:
                        call(transport)
                    self.assert_unavailable(raised.exception)
                    self.assertEqual(session.close_calls, 1)

    def test_discovery_normalizes_a_throwing_result_extraction(self):
        for error in (RuntimeError(CANARY), ChannelATransportError(CANARY)):
            for call in (lambda t: t.get_me(), lambda t: t.get_updates(poll_timeout=1, read_timeout=2)):
                with self.subTest(error=type(error).__name__, call=call):
                    body = ThrowingGetMapping({"ok": True, "result": []}, error, raise_for="result")
                    response = FakeResponse(200, body)
                    session = FakeSession(response)
                    transport = self.build(session)
                    with self.assertRaises(ChannelATransportError) as raised:
                        call(transport)
                    self.assert_unavailable(raised.exception)
                    self.assertNotIn(CANARY, str(raised.exception))
                    self.assertEqual(body.keys_seen, ["ok", "result"])
                    self.assertEqual(body.get_calls, 2)
                    self.assertEqual(response.close_calls, 1)
                    self.assertEqual(session.close_calls, 1)

    def test_identity_fields_normalize_a_throwing_nested_get(self):
        for field in ("id", "is_bot", "username"):
            for error in (RuntimeError(CANARY), ChannelATransportError(CANARY)):
                with self.subTest(field=field, error=type(error).__name__):
                    result = ThrowingGetMapping(
                        {"id": 1, "is_bot": True, "username": "prisma_bot"}, error, raise_for=field
                    )
                    session = FakeSession(FakeResponse(200, {"ok": True, "result": result}))
                    transport = self.build(session)
                    with self.assertRaises(ChannelATransportError) as raised:
                        transport.get_me()
                    self.assert_unavailable(raised.exception)
                    self.assertEqual(session.close_calls, 1)


class TransportBoundaryTests(ChannelATransportTestCase):
    def test_every_method_uses_fixed_https_without_redirects_retries_or_webhooks(self):
        methods = (
            lambda transport: transport.send_message(chat_id=CHAT_ID, text="hola"),
            lambda transport: transport.answer_callback_query(callback_query_id=CALLBACK_ID),
            lambda transport: transport.get_me(),
            lambda transport: transport.get_updates(poll_timeout=1, read_timeout=2),
        )
        seen = []
        for call in methods:
            session = FakeSession(FakeResponse(200, ok_body({"id": 7, "is_bot": True, "username": "prisma_bot"})))
            transport = self.build(session)
            try:
                call(transport)
            except ChannelATransportError:
                pass
            url, kwargs = session.calls[0]
            seen.append(url)
            self.assertTrue(url.startswith(f"{CHANNEL_A_API_BASE}/bot{TOKEN}/"), url)
            self.assertFalse(kwargs["allow_redirects"])
            self.assertNotIn("verify", kwargs)
            self.assertEqual(len(session.calls), 1)
        self.assertEqual(len(seen), len(methods))
        self.assertFalse([url for url in seen if "Webhook" in url or "webhook" in url])

    def test_host_is_fixed_and_ignores_environment_overrides(self):
        session = FakeSession(FakeResponse(200, {"ok": True}))
        transport = self.build(session)
        overrides = {
            "TELEGRAM_BOT_API_BASE": "http://127.0.0.1:1",
            "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "other-token",
            "PRISMA_PUBLIC_ORIGIN": "http://example.invalid",
        }
        with patch.dict(os.environ, overrides, clear=False):
            transport.send_message(chat_id=CHAT_ID, text="hola")
        self.assertEqual(session.calls[0][0], f"{CHANNEL_A_API_BASE}/bot{TOKEN}/sendMessage")

    def test_accessor_and_dependency_failures_are_sanitized(self):
        cases = (
            FakeSession(FakeResponse(200, {"ok": True}, status_error=ValueError(CANARY))),
            FakeSession(FakeResponse(200, {"ok": True}, json_error=json.JSONDecodeError("bad", CANARY, 0))),
            FakeSession(post_error=ConnectionError(f"connection refused {CANARY}")),
            FakeSession(FakeResponse(200, {"ok": True}, status_error=RuntimeError(f"status accessor {CANARY}"))),
        )
        for session in cases:
            with self.subTest(session=session):
                factory = SessionFactory(session)
                transport = ChannelATransport(TOKEN, request_timeout=TIMEOUT, session_factory=factory)
                with self.assertRaises(ChannelATransportError) as raised:
                    transport.send_message(chat_id=CHAT_ID, text="hola")
                self.assert_unavailable(raised.exception)
                self.assertNotIn(CANARY, str(raised.exception))
                self.assertEqual(session.close_calls, 1)

    def test_same_class_dependency_errors_are_normalized_instead_of_rethrown(self):
        cases = (
            FakeSession(post_error=ChannelATransportError(CANARY)),
            FakeSession(FakeResponse(200, {"ok": True}, status_error=ChannelATransportError(CANARY))),
        )
        for session in cases:
            with self.subTest(session=session):
                factory = SessionFactory(session)
                transport = ChannelATransport(TOKEN, request_timeout=TIMEOUT, session_factory=factory)
                with self.assertRaises(ChannelATransportError) as raised:
                    transport.send_message(chat_id=CHAT_ID, text="hola")
                self.assert_unavailable(raised.exception)
                self.assertNotIn(CANARY, str(raised.exception))
                self.assertEqual(session.close_calls, 1)

    def test_factory_failure_is_sanitized_and_closes_nothing(self):
        def factory():
            raise RuntimeError(f"factory failed {CANARY}")

        transport = ChannelATransport(TOKEN, request_timeout=TIMEOUT, session_factory=factory)
        with self.assertRaises(ChannelATransportError) as raised:
            transport.send_message(chat_id=CHAT_ID, text="hola")
        self.assert_unavailable(raised.exception)

    def test_repr_and_str_never_expose_the_token(self):
        session = FakeSession(FakeResponse(200, {"ok": True}))
        transport = self.build(session)
        self.assertNotIn(TOKEN, repr(transport))
        self.assertNotIn(TOKEN, str(transport))

    def test_response_and_session_are_closed_once_per_call(self):
        for response in (FakeResponse(200, {"ok": True}), FakeResponse(500, {"ok": False})):
            with self.subTest(status=response.status_code):
                session = FakeSession(response)
                transport = self.build(session)
                try:
                    transport.send_message(chat_id=CHAT_ID, text="hola")
                except ChannelATransportError:
                    pass
                self.assertEqual(response.close_calls, 1)
                self.assertEqual(session.close_calls, 1)

    def test_cleanup_failures_never_mask_a_result(self):
        response = FakeResponse(200, {"ok": True}, close_error=RuntimeError(f"close failed {CANARY}"))
        session = FakeSession(response, close_error=RuntimeError(f"session close failed {CANARY}"))
        transport = self.build(session)
        self.assertIs(transport.send_message(chat_id=CHAT_ID, text="hola"), response._body)
        self.assertEqual(response.close_calls, 1)
        self.assertEqual(session.close_calls, 1)

    def test_cleanup_failures_never_mask_the_fixed_error(self):
        response = FakeResponse(500, {"ok": False}, close_error=RuntimeError(CANARY))
        session = FakeSession(response, close_error=RuntimeError(CANARY))
        transport = self.build(session)
        with self.assertRaises(ChannelATransportError) as raised:
            transport.send_message(chat_id=CHAT_ID, text="hola")
        self.assert_unavailable(raised.exception)
        self.assertEqual(response.close_calls, 1)
        self.assertEqual(session.close_calls, 1)

    def test_cleanup_attempts_are_independent(self):
        response = FakeResponse(200, {"ok": True}, close_error=RuntimeError(CANARY))
        session = FakeSession(response, close_error=RuntimeError(CANARY))
        transport = self.build(session)
        transport.send_message(chat_id=CHAT_ID, text="hola")
        self.assertEqual(response.close_calls, 1)
        self.assertEqual(session.close_calls, 1)

    def test_source_declares_no_webhook_offset_loop_sleep_or_environment_read(self):
        source = (RUNTIME_ROOT / "src" / "prisma_runtime" / "channel_a_transport.py").read_text(encoding="utf-8")
        for forbidden in ("Webhook", "os.environ", "getenv", "threading", "time.sleep", "drop_pending_updates"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)


class ConcurrencyTests(ChannelATransportTestCase):
    def setUp(self):
        super().setUp()
        # Class-local HTTP containment. This class drives the transport through fake
        # sessions only, so a real outbound dispatch inside it is always a defect. Two
        # nested layers cover ``requests.Session.request``, the single funnel behind
        # every verb: an inert floor is installed first on the live binding, and a
        # numeric record-and-refuse guard is installed on top of it. Neither layer ever
        # reaches the original implementation nor reads the URL, the arguments, the
        # environment or the token, and a refusal carries only a fixed reason and its
        # attempt count. The containment lives exactly as long as this case: each
        # layer's attempt check runs while that layer is still installed, its restore
        # runs next and the restored binding is proven last, so restoration stays
        # unconditional and nests under whatever binding was already there.
        session_class = transport_module.requests.Session
        previous_request = session_class.request

        self.addCleanup(
            lambda: self.assertIs(
                session_class.request,
                previous_request,
                "the class-local HTTP containment was not restored",
            )
        )

        floor_attempts = []

        def inert_request_floor(self, method, url, *args, **kwargs):
            floor_attempts.append(1)
            raise RuntimeError(f"PRISMA_CONCURRENCY_REQUEST_FLOOR_REACHED {len(floor_attempts)}")

        session_class.request = inert_request_floor
        self.addCleanup(lambda: setattr(session_class, "request", previous_request))
        self.addCleanup(
            lambda: self.assertEqual(floor_attempts, [], "the inert request floor must never be reached")
        )
        self.addCleanup(
            lambda: self.assertIs(
                session_class.request,
                inert_request_floor,
                "the inert request floor must still be installed while its attempts are checked",
            )
        )

        guard_attempts = []

        def refused_request(self, method, url, *args, **kwargs):
            guard_attempts.append(1)
            raise RuntimeError(f"PRISMA_CONCURRENCY_REQUEST_GUARD_REFUSED {len(guard_attempts)}")

        self.assertIs(
            session_class.request,
            inert_request_floor,
            "the inert request floor must sit directly under the refusal guard",
        )
        session_class.request = refused_request
        self.addCleanup(lambda: setattr(session_class, "request", inert_request_floor))
        self.addCleanup(
            lambda: self.assertEqual(guard_attempts, [], "an unexpected real HTTP dispatch was attempted")
        )
        self.addCleanup(
            lambda: self.assertIs(
                session_class.request,
                refused_request,
                "the request guard must still be installed while its attempts are checked",
            )
        )

    def test_concurrent_send_and_poll_hold_owned_sessions_without_a_shared_lock(self):
        send_entered = threading.Event()
        release_send = threading.Event()
        send_response = FakeResponse(200, {"ok": True, "result": {"message_id": 1}})
        poll_response = FakeResponse(200, ok_body([{"update_id": 7}]))
        release_observed = []

        def enter_post():
            send_entered.set()
            release_observed.append(release_send.wait(5))

        send_session = FakeSession(send_response, before_post=enter_post)
        poll_session = FakeSession(poll_response)
        factory = SessionFactory(send_session, poll_session)
        transport = ChannelATransport(TOKEN, request_timeout=TIMEOUT, session_factory=factory)
        results = {}
        worker_errors = []

        def send():
            try:
                results["send"] = transport.send_message(chat_id=CHAT_ID, text="hola")
            except BaseException as error:  # noqa: BLE001 - the owning test reports it, not a thread hook
                worker_errors.append(error)

        worker = threading.Thread(target=send)
        body_error = None
        cleanup_errors = []
        liveness_observed = []

        try:
            # The worker is owned before it is started, and its identity -- never its
            # truthiness -- decides later whether it may be joined at all.
            worker.start()
            self.assertTrue(send_entered.wait(5), "the fake send must have entered post")
            results["updates"] = transport.get_updates(poll_timeout=1, read_timeout=2)
            self.assertTrue(worker.is_alive(), "the send must still be in flight while the poll completes")
        except BaseException as error:  # noqa: BLE001 - re-raised unchanged once the cleanup below has run
            body_error = error
        finally:
            # One unwind, run exactly once on every exit path. Each step keeps its own
            # guard, so a step that fails never skips the ones after it, and the whole
            # cleanup finishes before any outcome is reported: the release first, then
            # the bounded join, then the post-join liveness observation.
            try:
                release_send.set()
            except BaseException as error:  # noqa: BLE001 - recorded, never allowed to skip the join
                cleanup_errors.append(("the release signal", error))
            if worker.ident is not None:
                try:
                    worker.join(5)
                except BaseException as error:  # noqa: BLE001 - the liveness check below still runs
                    cleanup_errors.append(("the worker join", error))
                try:
                    liveness_observed.append(worker.is_alive())
                except BaseException as error:  # noqa: BLE001 - collected, never raised from the unwind
                    cleanup_errors.append(("the post-join liveness check", error))

        # Every outcome the unwind produced is evaluated here as data before anything is
        # reported, so no known problem can be lost to an earlier failure. The two cleanup
        # obligations belong only to a worker that really started: an unstarted worker owes
        # neither a liveness observation nor a completed release wait, so no violation is
        # invented for it. Each obligation is judged independently of the other one and of
        # any body, worker or cleanup failure.
        worker_started = worker.ident is not None
        violations = []
        if worker_started and not liveness_observed:
            violations.append(
                ("liveness", "the joined send worker was never checked for liveness after its join")
            )
        if worker_started and any(liveness_observed):
            violations.append(
                ("liveness", f"the joined send worker was still alive after its join: alive={liveness_observed}")
            )
        if worker_started and not release_observed:
            violations.append(("release wait", "the send worker recorded no bounded release wait"))
        if worker_started and release_observed and not release_observed[0]:
            violations.append(
                ("release wait", f"the send worker's release wait did not complete: {release_observed}")
            )

        # Every cause keeps its own neutral attribution: none of them is described as the
        # origin of another. The body failure is re-raised unchanged only while it is the
        # sole problem, keeping its own type, message and traceback; as soon as any
        # independent cause exists, one assertion failure carries all of them, the body
        # message included.
        body_causes = [f"the case body reported {body_error!r}"] if body_error is not None else []
        other_causes = [f"the send worker reported {error!r}" for error in worker_errors]
        other_causes += [f"{label} reported {error!r}" for label, error in cleanup_errors]
        other_causes += [
            f"the cleanup contract was not met ({category}): {detail}" for category, detail in violations
        ]
        if body_error is not None and not other_causes:
            raise body_error
        if body_causes or other_causes:
            self.fail(
                f"the send and poll case did not complete cleanly: {'; '.join(body_causes + other_causes)}"
            )
        self.assertIs(results["send"], send_response._body)
        self.assertEqual(results["updates"], ({"update_id": 7},))
        self.assertIsNot(send_session, poll_session)
        self.assertEqual(len(send_session.calls), 1)
        self.assertEqual(len(poll_session.calls), 1)
        self.assertEqual(send_session.calls[0][1]["json"], {"chat_id": CHAT_ID, "text": "hola"})
        self.assertEqual(
            poll_session.calls[0][1]["json"],
            {"timeout": 1, "limit": 100, "allowed_updates": ["message", "callback_query"]},
        )
        self.assertEqual(poll_session.calls[0][1]["timeout"], (TIMEOUT, 2))
        self.assertEqual((send_session.close_calls, poll_session.close_calls), (1, 1))
        self.assertEqual((send_response.close_calls, poll_response.close_calls), (1, 1))
        self.assertEqual(len(factory.calls), 2)

    def test_concurrent_sends_are_not_serialized_by_a_transport_lock(self):
        barrier = threading.Barrier(2)
        results = []
        worker_errors = []
        rendezvous = []

        def wait_for_peer(index):
            """The rendezvous one session must complete before it posts."""

            def enter_post():
                # The party position is kept next to the worker that met it, so an
                # incomplete rendezvous can never be read as a complete one.
                rendezvous.append((index, barrier.wait(5)))

            return enter_post

        sessions = [
            FakeSession(
                FakeResponse(200, {"ok": True, "result": {"message_id": index}}),
                before_post=wait_for_peer(index),
            )
            for index in (1, 2)
        ]
        factory = SessionFactory(*sessions)
        transport = ChannelATransport(TOKEN, request_timeout=TIMEOUT, session_factory=factory)

        def send(index):
            try:
                results.append(transport.send_message(chat_id=CHAT_ID, text=f"hola {index}"))
            except BaseException as error:  # noqa: BLE001 - the owning test reports it, not a thread hook
                worker_errors.append(error)

        workers = [threading.Thread(target=send, args=(index,)) for index in (1, 2)]
        launch_errors = []
        cleanup_errors = []
        liveness_observed = []

        try:
            # The launch stops at the first failure: only the workers that really
            # started are ever joined below, and the unstarted ones are left alone.
            for worker in workers:
                try:
                    worker.start()
                except BaseException as error:  # noqa: BLE001 - recorded now, reported after the cleanup
                    launch_errors.append(error)
                    break
        finally:
            # One unwind, run exactly once on every exit path and before anything is
            # reported. A rendezvous that can no longer complete is broken before any
            # join, so no worker is joined while it is still blocked there; every worker
            # that really started is then joined with a bounded wait; and every post-join
            # liveness observation is taken before the first assertion can abort the rest.
            if launch_errors:
                try:
                    barrier.abort()
                except BaseException as error:  # noqa: BLE001 - a failed unblock must not skip the joins
                    cleanup_errors.append(("the barrier abort", error))
            for worker in workers:
                if worker.ident is None:
                    continue
                try:
                    worker.join(10)
                except BaseException as error:  # noqa: BLE001 - every remaining join is still attempted
                    cleanup_errors.append(("the worker join", error))
            for worker in workers:
                if worker.ident is None:
                    continue
                try:
                    liveness_observed.append(worker.is_alive())
                except BaseException as error:  # noqa: BLE001 - collected, never raised from the unwind
                    cleanup_errors.append(("the post-join liveness check", error))
            if not launch_errors:
                # A final barrier release after all join attempts. Successful launches
                # do not prove quiescence: the collected liveness observations and errors
                # are validated below.
                try:
                    barrier.abort()
                except BaseException as error:  # noqa: BLE001 - recorded, never raised from the unwind
                    cleanup_errors.append(("the final barrier release", error))

        # Every outcome the unwind produced is evaluated here as data before anything is
        # reported. Liveness is owed only by the workers that actually started, and each of
        # them owes one post-join observation: a partial launch is never asked for the
        # observations of a worker it never started, and no cause is dropped because another
        # one exists or described as the origin of another.
        started_workers = [worker for worker in workers if worker.ident is not None]
        violations = []
        missing_liveness = len(started_workers) - len(liveness_observed)
        if missing_liveness > 0:
            violations.append(
                (
                    "liveness",
                    f"{missing_liveness} started worker(s) were never checked for liveness after their join",
                )
            )
        if any(liveness_observed):
            violations.append(
                ("liveness", f"a joined worker was still alive after its join: alive={liveness_observed}")
            )

        causes = [f"the send worker reported {error!r}" for error in worker_errors]
        causes += [f"the launch reported {error!r}" for error in launch_errors]
        causes += [f"{label} reported {error!r}" for label, error in cleanup_errors]
        causes += [
            f"the cleanup contract was not met ({category}): {detail}" for category, detail in violations
        ]
        if causes:
            self.fail(f"the concurrent sends case did not complete cleanly: {'; '.join(causes)}")
        # Non-vacuous rendezvous evidence: both owned workers must have reached the
        # barrier and each must have been handed its own distinct party position, so a
        # serialized pair can never pass as a concurrent one.
        self.assertEqual(
            sorted(index for index, _ in rendezvous),
            [1, 2],
            "both owned workers must reach the rendezvous before they post",
        )
        self.assertEqual(
            sorted(party for _, party in rendezvous),
            [0, 1],
            "the rendezvous must give each worker its own party position",
        )
        self.assertEqual([type(result).__name__ for result in results], ["dict", "dict"])
        self.assertEqual(sorted(result["result"]["message_id"] for result in results), [1, 2])
        self.assertEqual([session.close_calls for session in sessions], [1, 1])
        self.assertEqual(len(factory.calls), 2)


if __name__ == "__main__":
    unittest.main()
