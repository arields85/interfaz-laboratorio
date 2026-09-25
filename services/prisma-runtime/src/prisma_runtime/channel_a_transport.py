"""Standalone Channel A transport: raw Bot API over one owned, reused HTTPS session.

Scope (RCA-5a)
--------------

This module is the HTTP boundary of the dedicated Channel A bot and nothing
else. It performs exactly nine Bot API calls — ``sendMessage``,
``answerCallbackQuery``, ``getMe``, ``getUpdates``, ``sendChatAction`` (T4),
``setMyCommands``, ``deleteMyCommands``, ``setChatMenuButton`` (T14) and
``getFile`` (PW-013) — against the fixed official HTTPS host, plus one
bounded download from Telegram's separate file host (``download_file``,
PW-013), and returns the raw response mapping (or, for a download, the raw
bytes) to its caller. The adapter (RCA-3a) keeps deciding what
``delivered``, ``rejected`` and ``unknown`` mean; this module never
classifies a receipt beyond the status/boundary rules the frozen contract
declares.

Boundary rules that deliberately stay here:

* T7: one owned session, lazily built on the first call and reused (keep-alive)
  for every later ``sendMessage``/``answerCallbackQuery``/``getMe``/
  ``getUpdates`` call of this transport's activation, including sends that run
  concurrently with a poll -- ``requests.Session`` is safe for concurrent use by
  multiple threads. There is still no process global and no transport lock: this
  session is owned by, and private to, one transport instance, and a fresh
  activation always gets its own fresh transport (see
  ``local_presentation.build_channel_a_activation``). It is closed exactly once,
  explicitly, by :meth:`ChannelATransport.close` on activation teardown -- never
  implicitly and never per call. A session the lazy default factory obtained but
  could not configure (`trust_env`) is closed immediately and never cached, so a
  later call may still build a fresh one. The lazy default constructs
  ``requests.Session()`` with ``trust_env = False`` and default TLS verification,
  so no proxy environment variable can redirect a bot token.
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
* A response is closed exactly once per call; the owned session is closed
  exactly once, on ``close()``. A cleanup failure can never mask an observed
  result or the primary failure.

Deliberately absent: parse mode, message editing or deletion, file or voice
upload, webhooks, retries, environment or configuration overrides, offset state,
a polling loop, and any wiring into the runtime lifecycle.

T14: ``setMyCommands``/``deleteMyCommands`` publish or remove exactly one bot
command scoped to exactly one chat (``BotCommandScopeChat``), and
``setChatMenuButton`` sets or resets exactly one chat's menu button. All three
follow the same session/timeout/redaction contract as every other call; the
runtime only ever calls them with the closed values it actually needs
(one command, two menu-button types), never a bot-wide/default scope.
"""

from __future__ import annotations

import logging
import math
import re
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass

import requests

from .channel_a_bot import (
    MAX_ACK_TEXT_CHARS,
    MAX_CALLBACK_ID_CHARS,
    MAX_TELEGRAM_ID,
)
from .credential_store import MAX_SECRET_BYTES

# T5: no `logging.basicConfig` exists anywhere in this runtime (see the T16
# comment in `channel_a_manager.py`); a module logger with no handler falls
# back to `logging`'s WARNING-or-above "handler of last resort", which writes
# directly to `sys.stderr` -- the stream the launcher redirects to
# `prisma-presentation-stderr.log`. Every field below is a closed code,
# duration or count; never a token, chat id, username or update body.
_logger = logging.getLogger(__name__)


def _log_send_message_elapsed(elapsed_seconds: float) -> None:
    # PW-011 M4: routine per-send timing, not a warning-worthy condition.
    _logger.info("Channel A sendMessage: elapsed_ms=%d", round(elapsed_seconds * 1000))


def _log_get_updates_elapsed(count: int | None, elapsed_seconds: float) -> None:
    _logger.warning(
        "Channel A getUpdates: count=%s elapsed_ms=%d",
        "failed" if count is None else count,
        round(elapsed_seconds * 1000),
    )


def _log_send_chat_action_failed_elapsed(elapsed_seconds: float) -> None:
    # T4: unlike sendMessage/getUpdates, a successful chat-action ping is not
    # itself a useful lag signal (it precedes the answer, it does not carry
    # it), so this is logged only on failure -- T5-style noise discipline.
    _logger.warning("Channel A sendChatAction: elapsed_ms=%d", round(elapsed_seconds * 1000))


def _log_menu_call_failed_elapsed(method: str, elapsed_seconds: float) -> None:
    # T14: the three menu-maintenance calls are UX plumbing, not a delivery
    # contract (mirrors T4's sendChatAction) -- a successful call carries no
    # useful lag signal on its own, so this is logged only on failure.
    _logger.warning("Channel A %s: elapsed_ms=%d", method, round(elapsed_seconds * 1000))

PRISMA_CHANNEL_A_TRANSPORT_UNAVAILABLE = "PRISMA_CHANNEL_A_TRANSPORT_UNAVAILABLE"
# T16: the one deliberate exception to "every failure becomes the same fixed
# code" -- a provider-confirmed 401 on the bot token itself is distinguished
# from every other failure so the lifecycle layer can classify a genuinely
# revoked/invalid token as PERMANENT instead of retrying it forever. Still a
# closed, non-disclosing constant: no provider body, URL or token is attached.
PRISMA_CHANNEL_A_TRANSPORT_UNAUTHORIZED = "PRISMA_CHANNEL_A_TRANSPORT_UNAUTHORIZED"

CHANNEL_A_API_BASE = "https://api.telegram.org"
# PW-013: Telegram serves downloadable files from a separate host path (never
# the JSON Bot API host above); getFile only ever returns a file_path to be
# joined onto this base, never a full URL.
CHANNEL_A_FILE_BASE = "https://api.telegram.org/file"
MESSAGE_MAX_CHARS = 4096
GET_UPDATES_LIMIT = 100
ALLOWED_UPDATES = ("message", "callback_query")

SEND_MESSAGE_METHOD = "sendMessage"
ANSWER_CALLBACK_QUERY_METHOD = "answerCallbackQuery"
GET_ME_METHOD = "getMe"
GET_UPDATES_METHOD = "getUpdates"
SEND_CHAT_ACTION_METHOD = "sendChatAction"
SET_MY_COMMANDS_METHOD = "setMyCommands"
DELETE_MY_COMMANDS_METHOD = "deleteMyCommands"
SET_CHAT_MENU_BUTTON_METHOD = "setChatMenuButton"
# PW-013: resolves a voice note's file_id into its downloadable file_path.
GET_FILE_METHOD = "getFile"

# PW-013: Telegram's own file_id bound is generous; this is a closed safety
# cap, not the provider's documented limit.
MAX_FILE_ID_CHARS = 256
# Telegram's file_path is always a relative, forward-slash path under a known
# prefix (e.g. "voice/file_1.oga"); the charset excludes backslash, and every
# "." segment is rejected below (never just a leading "..") before this is
# ever joined into a URL.
_FILE_PATH_PATTERN = re.compile(r"\A[A-Za-z0-9_./-]{1,512}\Z")

# T4: the only chat action this runtime ever sends; the transport's own
# closed, non-disclosing validation accepts nothing else.
CHAT_ACTION_TYPING = "typing"
_ALLOWED_CHAT_ACTIONS = frozenset({CHAT_ACTION_TYPING})

# T14: the two chat menu button states this runtime ever requests -- show the
# published command list, or reset to Telegram's own default. Never any other
# ``MenuButton`` variant (e.g. a web app button).
MENU_BUTTON_COMMANDS = "commands"
MENU_BUTTON_DEFAULT = "default"
_ALLOWED_MENU_BUTTON_TYPES = frozenset({MENU_BUTTON_COMMANDS, MENU_BUTTON_DEFAULT})

# T14: Telegram's own bot command charset (lowercase ASCII letters, digits,
# underscores, 1-32 characters) and the documented command-description bound.
_COMMAND_NAME_PATTERN = re.compile(r"\A[a-z0-9_]{1,32}\Z")
MAX_COMMAND_DESCRIPTION_CHARS = 256

_TOKEN_PATTERN = re.compile(r"\A[A-Za-z0-9_:-]+\Z")
_USERNAME_PATTERN = re.compile(r"\A[A-Za-z0-9_]{5,32}\Z")

HttpTimeout = int | float | tuple[int | float, int | float]

__all__ = [
    "ALLOWED_UPDATES",
    "ANSWER_CALLBACK_QUERY_METHOD",
    "CHANNEL_A_API_BASE",
    "CHANNEL_A_FILE_BASE",
    "CHAT_ACTION_TYPING",
    "ChannelABotIdentity",
    "ChannelATransport",
    "ChannelATransportError",
    "ChannelATransportUnauthorized",
    "DELETE_MY_COMMANDS_METHOD",
    "GET_FILE_METHOD",
    "GET_ME_METHOD",
    "GET_UPDATES_LIMIT",
    "GET_UPDATES_METHOD",
    "MAX_COMMAND_DESCRIPTION_CHARS",
    "MENU_BUTTON_COMMANDS",
    "MENU_BUTTON_DEFAULT",
    "MESSAGE_MAX_CHARS",
    "PRISMA_CHANNEL_A_TRANSPORT_UNAUTHORIZED",
    "PRISMA_CHANNEL_A_TRANSPORT_UNAVAILABLE",
    "SEND_CHAT_ACTION_METHOD",
    "SEND_MESSAGE_METHOD",
    "SET_CHAT_MENU_BUTTON_METHOD",
    "SET_MY_COMMANDS_METHOD",
]


class ChannelATransportError(RuntimeError):
    """The transport could not produce a validated Bot API response.

    The message is always the fixed, non-disclosing
    ``PRISMA_CHANNEL_A_TRANSPORT_UNAVAILABLE`` code. Input problems, dependency
    failures and malformed responses are all reported through this one shape so
    a caller can never distinguish — or leak — a token, URL or response body.
    """


class ChannelATransportUnauthorized(ChannelATransportError):
    """The provider rejected the bot token itself (HTTP 401) on a discovery call.

    Raised by every call routed through :meth:`ChannelATransport._discovery`
    -- :meth:`get_me`, :meth:`get_updates` (the two calls the lifecycle layer
    depends on) and, since PW-013, :meth:`get_file`; ``send_message`` and
    ``answer_callback_query`` are unaffected and keep collapsing every non-2xx
    status into the base error. Still the same closed, non-disclosing
    contract: the message is always the fixed
    ``PRISMA_CHANNEL_A_TRANSPORT_UNAUTHORIZED`` code, never a provider body,
    URL or token (T16).
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


def _validated_chat_action(value: object) -> str:
    if not isinstance(value, str) or value not in _ALLOWED_CHAT_ACTIONS:
        raise _unavailable() from None
    return value


def _validated_menu_button_type(value: object) -> str:
    if not isinstance(value, str) or value not in _ALLOWED_MENU_BUTTON_TYPES:
        raise _unavailable() from None
    return value


def _validated_command_name(value: object) -> str:
    if not isinstance(value, str) or _COMMAND_NAME_PATTERN.fullmatch(value) is None:
        raise _unavailable() from None
    return value


def _validated_command_description(value: object) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= MAX_COMMAND_DESCRIPTION_CHARS:
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


def _validated_file_id(value: object) -> str:
    if not isinstance(value, str) or not value or len(value) > MAX_FILE_ID_CHARS:
        raise _unavailable() from None
    return value


def _validated_file_path(value: object) -> str:
    if (
        not isinstance(value, str)
        or _FILE_PATH_PATTERN.fullmatch(value) is None
        or ".." in value.split("/")
    ):
        raise _unavailable() from None
    return value


def _validated_max_bytes(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise _unavailable() from None
    return value


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
    is a trusted callable that returns one new owned session; an explicit
    ``None`` selects the lazy default factory instead of replacing a falsy
    callable. T7: the factory is invoked at most once per transport instance --
    the returned session is cached and reused (keep-alive) for every call of
    this transport's activation, and released only by :meth:`close`.
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
        self._session: object | None = None

    def send_message(self, *, chat_id: int, text: str, reply_markup: object = None) -> object:
        """Deliver one text message and return the raw Bot API response body."""
        payload: dict[str, object] = {
            "chat_id": _validated_chat_id(chat_id),
            "text": _validated_message_text(text),
        }
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        started = time.monotonic()
        try:
            return self._effect(SEND_MESSAGE_METHOD, payload, self.request_timeout)
        finally:
            _log_send_message_elapsed(time.monotonic() - started)

    def answer_callback_query(self, *, callback_query_id: str, text: str = None) -> object:
        """Acknowledge one callback press and return the raw Bot API response body."""
        payload: dict[str, object] = {"callback_query_id": _validated_callback_id(callback_query_id)}
        if text is not None:
            payload["text"] = _validated_ack_text(text)
        return self._effect(ANSWER_CALLBACK_QUERY_METHOD, payload, self.request_timeout)

    def send_chat_action(self, *, chat_id: int, action: str) -> object:
        """Signal a transient chat action (e.g. "typing") while preparing an
        answer (T4). Same owned/reused session, timeouts, error
        classification and redaction as every other call; a successful ping
        carries no useful lag signal on its own, so timing is logged only on
        failure (T5-style noise discipline, mirroring T8b's getUpdates fix).
        """
        payload: dict[str, object] = {
            "chat_id": _validated_chat_id(chat_id),
            "action": _validated_chat_action(action),
        }
        started = time.monotonic()
        try:
            return self._effect(SEND_CHAT_ACTION_METHOD, payload, self.request_timeout)
        except Exception:
            _log_send_chat_action_failed_elapsed(time.monotonic() - started)
            raise

    def set_my_commands(self, *, chat_id: int, command: str, description: str) -> object:
        """Publish one bot command scoped to exactly one chat (T14).

        Uses ``BotCommandScopeChat`` -- never the bot-wide/default scope --
        so only this chat's command menu changes. Same owned/reused session,
        timeouts, error classification and redaction as every other call;
        this is UX plumbing, not a delivery contract, so timing is logged
        only on failure (mirrors ``send_chat_action``).
        """
        payload: dict[str, object] = {
            "commands": [
                {
                    "command": _validated_command_name(command),
                    "description": _validated_command_description(description),
                }
            ],
            "scope": {"type": "chat", "chat_id": _validated_chat_id(chat_id)},
        }
        started = time.monotonic()
        try:
            return self._effect(SET_MY_COMMANDS_METHOD, payload, self.request_timeout)
        except Exception:
            _log_menu_call_failed_elapsed(SET_MY_COMMANDS_METHOD, time.monotonic() - started)
            raise

    def delete_my_commands(self, *, chat_id: int) -> object:
        """Remove the chat-scoped command list for exactly one chat (T14).

        Same ``BotCommandScopeChat`` targeting, session, timeout, error
        classification and failure-only timing log as ``set_my_commands``.
        """
        payload: dict[str, object] = {"scope": {"type": "chat", "chat_id": _validated_chat_id(chat_id)}}
        started = time.monotonic()
        try:
            return self._effect(DELETE_MY_COMMANDS_METHOD, payload, self.request_timeout)
        except Exception:
            _log_menu_call_failed_elapsed(DELETE_MY_COMMANDS_METHOD, time.monotonic() - started)
            raise

    def set_chat_menu_button(self, *, chat_id: int, button_type: str) -> object:
        """Set or reset the chat menu button for exactly one chat (T14).

        ``button_type`` is closed to ``"commands"`` (show the published
        command list) or ``"default"`` (reset to Telegram's own default) --
        the only two states this runtime ever requests. Same session,
        timeout, error classification and failure-only timing log as the
        other two menu calls.
        """
        payload: dict[str, object] = {
            "chat_id": _validated_chat_id(chat_id),
            "menu_button": {"type": _validated_menu_button_type(button_type)},
        }
        started = time.monotonic()
        try:
            return self._effect(SET_CHAT_MENU_BUTTON_METHOD, payload, self.request_timeout)
        except Exception:
            _log_menu_call_failed_elapsed(SET_CHAT_MENU_BUTTON_METHOD, time.monotonic() - started)
            raise

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

    def get_file(self, *, file_id: str) -> str:
        """Resolve a voice note's file_id into its downloadable file_path.

        Never downloads anything itself: the caller (PW-013's
        ``ChannelAPairingDialogue._handle_voice_note``) checks the reported
        duration/size before this is ever called, then downloads separately
        with :meth:`download_file`, so the two effects stay independently
        bounded."""
        payload: dict[str, object] = {"file_id": _validated_file_id(file_id)}
        _, body = self._discovery(GET_FILE_METHOD, payload, self.request_timeout)
        result = _field(body, "result")
        if not isinstance(result, Mapping):
            raise _unavailable() from None
        file_path = _field(result, "file_path")
        if not isinstance(file_path, str) or _FILE_PATH_PATTERN.fullmatch(file_path) is None:
            raise _unavailable() from None
        return file_path

    def download_file(self, *, file_path: str, max_bytes: int) -> bytes:
        """Download one file's raw bytes from Telegram's separate file host.

        Bounded by ``max_bytes``: a response that exceeds it raises the same
        closed transport error rather than buffering an unbounded body in
        memory. Reuses this transport's one owned/reused session (T7), same
        as every other call, but never the JSON Bot API host -- Telegram
        serves files from :data:`CHANNEL_A_FILE_BASE`.
        """
        validated_path = _validated_file_path(file_path)
        validated_max_bytes = _validated_max_bytes(max_bytes)
        session = self._ensure_session()
        response = None
        try:
            response = session.get(
                f"{CHANNEL_A_FILE_BASE}/bot{self._token}/{validated_path}",
                timeout=self.request_timeout,
                allow_redirects=False,
            )
            status = getattr(response, "status_code", None)
            if isinstance(status, bool) or not isinstance(status, int) or not 200 <= status < 300:
                raise _unavailable() from None
            chunks: list[bytes] = []
            total = 0
            for chunk in response.iter_content(chunk_size=65536):
                if not chunk:
                    continue
                total += len(chunk)
                if total > validated_max_bytes:
                    raise _unavailable() from None
                chunks.append(chunk)
            return b"".join(chunks)
        except ChannelATransportError:
            raise
        except Exception:
            raise _unavailable() from None
        finally:
            _close_quietly(response)

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
        started = time.monotonic()
        count: int | None = None
        try:
            _, body = self._discovery(GET_UPDATES_METHOD, payload, (self.request_timeout, read))
            result = _field(body, "result")
            if not isinstance(result, list):
                raise _unavailable() from None
            for item in result:
                if not isinstance(item, Mapping):
                    raise _unavailable() from None
            updates = tuple(result)
            count = len(updates)
            return updates
        finally:
            # T8b: an empty long poll (no updates, no failure) is noise at
            # the ~25s poll cadence -- log only when updates actually
            # arrived (count > 0) or the poll failed (count is None).
            if count is None or count > 0:
                _log_get_updates_elapsed(count, time.monotonic() - started)

    def _url(self, method: str) -> str:
        return f"{CHANNEL_A_API_BASE}/bot{self._token}/{method}"

    def _ensure_session(self) -> object:
        """Return the one owned session, building it lazily on the first call.

        Nothing is cached on failure: a factory that raises, or a lazy default
        session whose ``trust_env`` setup fails, leaves ``self._session`` unset
        so a later call may still build a fresh one instead of staying stuck.
        """
        if self._session is not None:
            return self._session
        try:
            session = self.session_factory()
        except Exception:
            raise _unavailable() from None
        self._session = session
        return session

    def _request(self, method: str, payload: dict[str, object], timeout: HttpTimeout) -> tuple[int, Mapping]:
        session = self._ensure_session()
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

    def close(self) -> None:
        """Close the owned session exactly once, on activation teardown (T7).

        Idempotent and never raises: a cleanup failure can never mask the
        caller's own teardown. Never called per request -- only here.
        """
        session = self._session
        self._session = None
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
        # Checked before the generic ok/status gate below (T16): a 401 is
        # never ambiguous with a malformed response or an ordinary failure,
        # regardless of what -- if anything -- the body otherwise contains.
        if status == 401:
            raise ChannelATransportUnauthorized(PRISMA_CHANNEL_A_TRANSPORT_UNAUTHORIZED) from None
        if not 200 <= status < 300 or _field(body, "ok") is not True:
            raise _unavailable() from None
        return status, body
