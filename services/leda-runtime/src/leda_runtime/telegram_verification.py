"""On-demand, non-sending Telegram bot token verification.

Shared by both Telegram channels (Channel A and the legacy/"Canal B" bot):
each channel composes its own ``TelegramTokenVerificationService`` around its
own credential resolver, exactly like ``GeminiVerificationService`` composes
around a ``GeminiCredentialResolver`` -- this module never resolves a
credential itself.

Deliberately independent from ``channel_a_transport.ChannelATransport.get_me``
and ``local_presentation.TelegramLocalBot.observe_identity``: both of those
are production connect-time calls scoped (by design, see RCA-5a) to collapse
every failure -- bad token, network error, malformed response -- into one
generic unavailable code, because at connect time a caller only needs to know
"can I proceed", never why not. On-demand verification has the opposite need:
the whole point is telling an administrator "the token itself is wrong" apart
from "Telegram could not be reached right now", so this module keeps its own
narrow HTTP call and status classification rather than reusing either.

Only one Bot API method is ever called here: ``getMe``. Never ``getUpdates``
(no offset is read or consumed) and never ``sendMessage`` -- verification must
never start, stop, restart or otherwise disturb a live bot. The raw token and
any raw provider response body are never logged or returned; only a closed
state classification plus, on success, the bot's own public username.
"""

from __future__ import annotations

import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from threading import Lock
from typing import Literal

import requests

TELEGRAM_API_BASE = "https://api.telegram.org"
TELEGRAM_VERIFY_TIMEOUT_MS = 10_000
_USERNAME_PATTERN = re.compile(r"\A[A-Za-z0-9_]{5,32}\Z")

TelegramTokenVerificationState = Literal[
    "not_checked", "verified", "invalid_token", "unreachable", "not_configured",
]

__all__ = [
    "TELEGRAM_VERIFY_TIMEOUT_MS",
    "TelegramTokenVerification",
    "TelegramTokenVerificationInProgress",
    "TelegramTokenVerificationService",
    "TelegramTokenVerificationState",
]


class TelegramTokenVerificationInProgress(RuntimeError):
    """A verification is already running for this service; the caller must wait."""


@dataclass(frozen=True)
class TelegramTokenVerification:
    state: TelegramTokenVerificationState
    checked_at: float | None
    username: str | None = None


def _default_http_post(token: str, *, timeout_ms: int) -> tuple[int | None, dict | None]:
    """One owned-session ``getMe`` call. Never raises; a ``None`` status means
    the request itself failed (timeout, connection error, or anything else
    unexpected) rather than that a response was received."""
    session = None
    response = None
    try:
        session = requests.Session()
        session.trust_env = False
        response = session.post(
            f"{TELEGRAM_API_BASE}/bot{token}/getMe",
            timeout=timeout_ms / 1000,
            allow_redirects=False,
        )
        status = response.status_code
        try:
            body = response.json()
        except Exception:
            body = None
        return status, (body if isinstance(body, dict) else None)
    except Exception:
        return None, None
    finally:
        try:
            if response is not None:
                response.close()
        except Exception:
            pass
        try:
            if session is not None:
                session.close()
        except Exception:
            pass


def _classify(status: int | None, body: dict | None) -> tuple[TelegramTokenVerificationState, str | None]:
    """Pure classification of one raw ``getMe`` outcome.

    401 is Telegram's documented "Unauthorized" response for a bad bot token
    and is the only status this module reports as ``invalid_token``; every
    other failure shape (no response, another status, a malformed or falsy
    body) fails closed to ``unreachable`` -- the token may still be valid, so
    it is never reported as invalid on ambiguous evidence.
    """
    if status == 401:
        return "invalid_token", None
    if status is None or not (200 <= status < 300) or body is None or body.get("ok") is not True:
        return "unreachable", None
    result = body.get("result")
    if not isinstance(result, dict) or result.get("is_bot") is not True:
        return "unreachable", None
    username = result.get("username")
    if not isinstance(username, str) or _USERNAME_PATTERN.fullmatch(username) is None:
        return "unreachable", None
    return "verified", username


class TelegramTokenVerificationService:
    """In-memory, on-demand token verification (mirrors ``GeminiVerificationService``).

    Never persists its result -- only the latest outcome, timestamp and
    (once verified) the observed username live in process memory, reset by
    an explicit ``reset()`` call whenever the caller saves or deletes the
    underlying credential.
    """

    def __init__(
        self,
        token_resolver: Callable[[], str],
        *,
        timeout_ms: int = TELEGRAM_VERIFY_TIMEOUT_MS,
        http_post: Callable[[str, int], tuple[int | None, dict | None]] | None = None,
        clock: Callable[[], float] = time.time,
    ):
        self.token_resolver = token_resolver
        self.timeout_ms = timeout_ms
        self.http_post = http_post or (lambda token, timeout_ms: _default_http_post(token, timeout_ms=timeout_ms))
        self.clock = clock
        self._lock = Lock()
        self._in_flight = False
        self._state: TelegramTokenVerificationState = "not_checked"
        self._checked_at: float | None = None
        self._username: str | None = None

    def snapshot(self) -> TelegramTokenVerification:
        with self._lock:
            return TelegramTokenVerification(self._state, self._checked_at, self._username)

    def reset(self) -> None:
        """Saving or deleting the credential invalidates any prior result."""
        with self._lock:
            self._state = "not_checked"
            self._checked_at = None
            self._username = None

    def verify(self) -> TelegramTokenVerification:
        with self._lock:
            if self._in_flight:
                raise TelegramTokenVerificationInProgress("TELEGRAM_VERIFICATION_IN_PROGRESS")
            self._in_flight = True
        try:
            state, username = self._run_check()
        finally:
            with self._lock:
                self._in_flight = False
        with self._lock:
            self._state = state
            self._checked_at = self.clock()
            self._username = username
            return TelegramTokenVerification(self._state, self._checked_at, self._username)

    def _run_check(self) -> tuple[TelegramTokenVerificationState, str | None]:
        try:
            token = self.token_resolver()
        except Exception:
            token = None
        if not isinstance(token, str) or not token.strip():
            return "not_configured", None
        status, body = self.http_post(token, self.timeout_ms)
        return _classify(status, body)
