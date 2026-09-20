"""Standalone Channel A transport: raw Bot API over one fresh owned HTTPS session.

Scope (RCA-5a)
--------------

This module is the HTTP boundary of the dedicated Channel A bot and nothing
else. It performs exactly four Bot API calls — ``sendMessage``,
``answerCallbackQuery``, ``getMe`` and ``getUpdates`` — against the fixed
official HTTPS host and returns the raw response mapping to its caller. The
adapter (RCA-3a) keeps deciding what ``delivered``, ``rejected`` and ``unknown``
mean; this module never classifies a receipt beyond the status/boundary rules the
frozen contract declares.

Boundary rules that deliberately stay here:

* One fresh **owned** session per method call, including sends that run
  concurrently with a poll. There is no shared session, no process global and no
  transport lock; two overlapping calls can never observe or close each other's
  session. The lazy default constructs ``requests.Session()`` with
  ``trust_env = False`` and default TLS verification, so no proxy environment
  variable can redirect a bot token.
* The host is the fixed ``https://api.telegram.org`` with the token used only as
  a path segment. There is no configurable host, no environment fallback, no
  redirect following, no webhook mutation, no retry, no offset bookkeeping and no
  polling loop. Offset ownership, cadence and lifecycle belong to the runtime
  integration stage; this transport never advances an offset on its own.
* ``sendMessage``, ``answerCallbackQuery`` and ``getMe`` post with the scalar
  ``request_timeout``. ``getUpdates`` posts with the
  ``(request_timeout, read_timeout)`` connect/read timeout tuple, so the
  validated polling read bound is the HTTP bound that call actually uses.
* Every input is validated *before* any I/O, so an invalid caller value never
  produces a network request. Numbers are bounded explicitly: booleans are never
  identifiers, infinities and overflow conversions are rejected, chat/bot
  identifiers and offsets reuse the adapter's public ``MAX_TELEGRAM_ID`` bound,
  the token reuses the protected store's public ``MAX_SECRET_BYTES`` bound, and
  text, callback identifiers and acknowledgement text reuse the adapter's public
  character bounds. The 4096-character message limit is the Bot API's own text
  limit and is distinct from the adapter's 128-character ``/start`` bound and
  from the question's 4096 UTF-8-byte bound.
* Every failure — invalid input, dependency error, malformed response or a provider mapping whose accessor raises
  becomes the fixed ``PRISMA_CHANNEL_A_TRANSPORT_UNAVAILABLE`` error raised from ``None``.
  No provider exception, token, URL or body can reach a caller's ``repr``, log or
  error message, and the transport object's own ``repr`` never includes the
  token.
* A response and its session are each closed exactly once, independently, and a
  cleanup failure can never mask an observed result or the primary failure.

Deliberately absent: parse mode, message editing or deletion, file or voice
upload, webhooks, retries, environment or configuration overrides, offset state,
a polling loop, and any wiring into the runtime lifecycle.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass

import requests

from .channel_a_bot import (
    MAX_ACK_TEXT_CHARS,
    MAX_CALLBACK_ID_CHARS,
    MAX_TELEGRAM_ID,
)
from .credential_store import MAX_SECRET_BYTES

PRISMA_CHANNEL_A_TRANSPORT_UNAVAILABLE = "PRISMA_CHANNEL_A_TRANSPORT_UNAVAILABLE"

CHANNEL_A_API_BASE = "https://api.telegram.org"
MESSAGE_MAX_CHARS = 4096
GET_UPDATES_LIMIT = 100
ALLOWED_UPDATES = ("message", "callback_query")

SEND_MESSAGE_METHOD = "sendMessage"
ANSWER_CALLBACK_QUERY_METHOD = "answerCallbackQuery"
GET_ME_METHOD = "getMe"
GET_UPDATES_METHOD = "getUpdates"

_TOKEN_PATTERN = re.compile(r"\A[A-Za-z0-9_:-]+\Z")
_USERNAME_PATTERN = re.compile(r"\A[A-Za-z0-9_]{5,32}\Z")

HttpTimeout = int | float | tuple[int | float, int | float]

__all__ = [
    "ALLOWED_UPDATES",
    "ANSWER_CALLBACK_QUERY_METHOD",
    "CHANNEL_A_API_BASE",
    "ChannelABotIdentity",
    "ChannelATransport",
    "ChannelATransportError",
    "GET_ME_METHOD",
    "GET_UPDATES_LIMIT",
    "GET_UPDATES_METHOD",
    "MESSAGE_MAX_CHARS",
    "PRISMA_CHANNEL_A_TRANSPORT_UNAVAILABLE",
    "SEND_MESSAGE_METHOD",
]


class ChannelATransportError(RuntimeError):
    """The transport could not produce a validated Bot API response.

    The message is always the fixed, non-disclosing
    ``PRISMA_CHANNEL_A_TRANSPORT_UNAVAILABLE`` code. Input problems, dependency
    failures and malformed responses are all reported through this one shape so
    a caller can never distinguish — or leak — a token, URL or response body.
    """


@dataclass(frozen=True)
class ChannelABotIdentity:
    """The identity Channel A observed for its own dedicated bot.

    The token prefix is not identity; only a successful ``getMe`` produces this
    value. Channel A and the legacy bot remain independently reserved.
    """

    id: int
    username: str


def _unavailable() -> ChannelATransportError:
    return ChannelATransportError(PRISMA_CHANNEL_A_TRANSPORT_UNAVAILABLE)


def _validated_token(value: object) -> str:
    if (
        not isinstance(value, str)
        or not value
        or _TOKEN_PATTERN.fullmatch(value) is None
        or len(value) > MAX_SECRET_BYTES
    ):
        raise _unavailable() from None
    return value


def _validated_timeout(value: object) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _unavailable() from None
    if isinstance(value, int):
        try:
            magnitude = float(value)
        except OverflowError:
            raise _unavailable() from None
    else:
        magnitude = value
    if not math.isfinite(magnitude) or magnitude <= 0:
        raise _unavailable() from None
    return value


def _validated_identifier(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > MAX_TELEGRAM_ID:
        raise _unavailable() from None
    return value


def _validated_chat_id(value: object) -> int:
    return _validated_identifier(value)


def _validated_message_text(value: object) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= MESSAGE_MAX_CHARS:
        raise _unavailable() from None
    return value


def _validated_callback_id(value: object) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= MAX_CALLBACK_ID_CHARS:
        raise _unavailable() from None
    return value


def _validated_ack_text(value: object) -> str:
    if not isinstance(value, str) or len(value) > MAX_ACK_TEXT_CHARS:
        raise _unavailable() from None
    return value


def _validated_poll_timeout(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise _unavailable() from None
    return value


def _validated_read_timeout(value: object, poll_timeout: int) -> int | float:
    validated = _validated_timeout(value)
    if validated <= poll_timeout:
        raise _unavailable() from None
    return validated


def _validated_offset(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > MAX_TELEGRAM_ID + 1:
        raise _unavailable() from None
    return value


def _read_response(response: object) -> tuple[int, Mapping]:
    status = getattr(response, "status_code", None)
    if isinstance(status, bool) or not isinstance(status, int):
        raise _unavailable() from None
    try:
        body = response.json()
    except Exception:
        raise _unavailable() from None
    if not isinstance(body, Mapping):
        raise _unavailable() from None
    return status, body


def _field(mapping: Mapping, key: str) -> object:
    """Read one provider field without letting a failing accessor escape."""
    try:
        return mapping.get(key)
    except Exception:
        raise _unavailable() from None


def _close_quietly(resource: object) -> None:
    if resource is None:
        return
    try:
        resource.close()
    except Exception:
        return


def _default_session() -> object:
    session = requests.Session()
    try:
        session.trust_env = False
    except Exception:
        _close_quietly(session)
        raise _unavailable() from None
    return session


class ChannelATransport:
    """Raw Bot API text transport for the dedicated Channel A bot.

    ``token`` is the protected Channel A bot token. ``request_timeout`` is the
    required bounded HTTP timeout; there is deliberately no default product
    timing. ``session_factory`` may be supplied for tests and ownership seams: it
    is a trusted callable that must return a new owned session per call, and an
    explicit ``None`` selects the lazy default factory instead of replacing a
    falsy callable.
    """

    def __init__(
        self,
        token: str,
        *,
        request_timeout: int | float,
        session_factory: Callable[[], object] | None = None,
    ) -> None:
        self._token = _validated_token(token)
        self.request_timeout: int | float = _validated_timeout(request_timeout)
        self.session_factory = _default_session if session_factory is None else session_factory

    def send_message(self, *, chat_id: int, text: str, reply_markup: object = None) -> object:
        """Deliver one text message and return the raw Bot API response body."""
        payload: dict[str, object] = {
            "chat_id": _validated_chat_id(chat_id),
            "text": _validated_message_text(text),
        }
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        return self._effect(SEND_MESSAGE_METHOD, payload, self.request_timeout)

    def answer_callback_query(self, *, callback_query_id: str, text: str = None) -> object:
        """Acknowledge one callback press and return the raw Bot API response body."""
        payload: dict[str, object] = {"callback_query_id": _validated_callback_id(callback_query_id)}
        if text is not None:
            payload["text"] = _validated_ack_text(text)
        return self._effect(ANSWER_CALLBACK_QUERY_METHOD, payload, self.request_timeout)

    def get_me(self) -> ChannelABotIdentity:
        """Observe the bot identity Channel A is actually authenticated as."""
        _, body = self._discovery(GET_ME_METHOD, {}, self.request_timeout)
        result = _field(body, "result")
        if not isinstance(result, Mapping):
            raise _unavailable() from None
        bot_id = _validated_identifier(_field(result, "id"))
        if _field(result, "is_bot") is not True:
            raise _unavailable() from None
        username = _field(result, "username")
        if not isinstance(username, str) or _USERNAME_PATTERN.fullmatch(username) is None:
            raise _unavailable() from None
        return ChannelABotIdentity(id=bot_id, username=username)

    def get_updates(self, *, poll_timeout: int, read_timeout: float, offset: int | None = None) -> tuple[Mapping, ...]:
        """Fetch one ordered batch of updates without owning the offset.

        ``poll_timeout`` is the Bot API long-poll timeout and ``read_timeout`` is
        the HTTP read bound for this call, which must strictly exceed it; the
        request posts with ``(request_timeout, read_timeout)`` as its connect/read
        timeout tuple. The returned tuple preserves the received order and
        content; no update is filtered, sorted or acknowledged here.
        """
        poll = _validated_poll_timeout(poll_timeout)
        read = _validated_read_timeout(read_timeout, poll)
        payload: dict[str, object] = {
            "timeout": poll,
            "limit": GET_UPDATES_LIMIT,
            "allowed_updates": list(ALLOWED_UPDATES),
        }
        if offset is not None:
            payload["offset"] = _validated_offset(offset)
        _, body = self._discovery(GET_UPDATES_METHOD, payload, (self.request_timeout, read))
        result = _field(body, "result")
        if not isinstance(result, list):
            raise _unavailable() from None
        for item in result:
            if not isinstance(item, Mapping):
                raise _unavailable() from None
        return tuple(result)

    def _url(self, method: str) -> str:
        return f"{CHANNEL_A_API_BASE}/bot{self._token}/{method}"

    def _open_session(self) -> object:
        try:
            return self.session_factory()
        except Exception:
            raise _unavailable() from None

    def _request(self, method: str, payload: dict[str, object], timeout: HttpTimeout) -> tuple[int, Mapping]:
        session = self._open_session()
        response = None
        try:
            response = session.post(
                self._url(method),
                json=payload,
                timeout=timeout,
                allow_redirects=False,
            )
            return _read_response(response)
        except Exception:
            raise _unavailable() from None
        finally:
            _close_quietly(response)
            _close_quietly(session)

    def _effect(self, method: str, payload: dict[str, object], timeout: HttpTimeout) -> object:
        status, body = self._request(method, payload, timeout)
        if 200 <= status < 300:
            return body
        if 400 <= status < 500 and _field(body, "ok") is False:
            return body
        raise _unavailable() from None

    def _discovery(self, method: str, payload: dict[str, object], timeout: HttpTimeout) -> tuple[int, Mapping]:
        status, body = self._request(method, payload, timeout)
        if not 200 <= status < 300 or _field(body, "ok") is not True:
            raise _unavailable() from None
        return status, body
