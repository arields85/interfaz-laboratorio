"""Channel B admission safeguards: a per-chat message limit and a redacted admission audit log."""

from __future__ import annotations

import enum
import json
import logging
import os
import threading
import time
from collections import OrderedDict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

# Per-chat limit: at most this many messages inside any sliding window.
MESSAGE_LIMIT_PER_WINDOW = 10
MESSAGE_LIMIT_WINDOW_SECONDS = 60.0
# Upper bound on chats tracked at once; the least recently active ones are dropped first.
MAX_TRACKED_CHATS = 1024

ADMISSION_AUDIT_EVENTS = frozenset({"requested", "approved", "rejected", "revoked", "request_refused_full"})
ADMISSION_AUDIT_ACTORS = frozenset({"telegram", "admin"})
ADMISSION_AUDIT_MAX_BYTES = 1024 * 1024

# Only the exception type is ever logged, never a path, identifier or message text.
_logger = logging.getLogger(__name__)


class MessageVerdict(enum.Enum):
    ALLOWED = "allowed"
    # The first message over the limit in a window: the caller may answer it once.
    LIMITED_NOTIFY = "limited_notify"
    LIMITED_SILENT = "limited_silent"


class ChatMessageLimiter:
    """Sliding-window message counter per chat, kept in memory and bounded."""

    def __init__(
        self,
        *,
        limit: int = MESSAGE_LIMIT_PER_WINDOW,
        window_seconds: float = MESSAGE_LIMIT_WINDOW_SECONDS,
        max_tracked: int = MAX_TRACKED_CHATS,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._limit, self._window, self._max_tracked, self._clock = limit, window_seconds, max_tracked, clock
        self._lock = threading.Lock()
        # Ordered by last activity, oldest first, so eviction only ever looks at the front.
        self._chats: OrderedDict[int, tuple[deque[float], list[bool]]] = OrderedDict()

    @property
    def tracked_chats(self) -> int:
        with self._lock:
            return len(self._chats)

    def admit(self, chat_id: int) -> MessageVerdict:
        with self._lock:
            now = self._clock()
            self._evict_idle(now)
            stamps, notified = self._chats.get(chat_id) or (deque(), [False])
            while stamps and stamps[0] <= now - self._window:
                stamps.popleft()
            if len(stamps) < self._limit:
                stamps.append(now)
                notified[0] = False
                verdict = MessageVerdict.ALLOWED
            elif not notified[0]:
                notified[0] = True
                verdict = MessageVerdict.LIMITED_NOTIFY
            else:
                verdict = MessageVerdict.LIMITED_SILENT
            self._chats[chat_id] = (stamps, notified)
            self._chats.move_to_end(chat_id)
            while len(self._chats) > self._max_tracked:
                self._evict_one(chat_id, now)
            return verdict

    def _evict_one(self, keep: int, now: float) -> None:
        """Drop a chat whose window already expired; only if every chat is active, the least recent one.

        Dropping an active chat forgets its count, so that is the last resort.
        """
        for chat_id, (stamps, _) in self._chats.items():
            if chat_id != keep and not (stamps and stamps[-1] > now - self._window):
                del self._chats[chat_id]
                return
        self._chats.popitem(last=False)

    def _evict_idle(self, now: float) -> None:
        while self._chats:
            chat_id, (stamps, _) = next(iter(self._chats.items()))
            if stamps and stamps[-1] > now - self._window:
                return
            del self._chats[chat_id]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


class AdmissionAuditLog:
    """Append-only JSON Lines log of admission events: who decided what, never any content.

    Each line holds only the time, the event, the bot id, the chat id and the actor.
    The file is capped: once it exceeds ``max_bytes`` it moves to a single ``.1`` backup
    (replacing the previous one). A write failure is logged without detail and never raised.
    """

    def __init__(self, path: Path, *, max_bytes: int = ADMISSION_AUDIT_MAX_BYTES, clock: Callable[[], str] = _utc_now):
        self.path = Path(path)
        self._max_bytes = max_bytes
        self._clock = clock
        self._lock = threading.Lock()

    def record(self, event: str, bot_id: int, chat_id: int, actor: str) -> None:
        try:
            if event not in ADMISSION_AUDIT_EVENTS or actor not in ADMISSION_AUDIT_ACTORS or not _is_int(bot_id) or not _is_int(chat_id):
                raise ValueError("invalid audit record")
            line = json.dumps(
                {"at": self._clock(), "event": event, "botId": bot_id, "chatId": chat_id, "actor": actor},
                ensure_ascii=True,
                separators=(",", ":"),
            )
            with self._lock:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                self._rotate_if_needed()
                with self.path.open("a", encoding="utf-8", newline="\n") as handle:
                    handle.write(line + "\n")
        except Exception as error:
            _logger.warning("Leda Channel B admission audit not written: reason=%s", type(error).__name__)

    def _rotate_if_needed(self) -> None:
        try:
            size = self.path.stat().st_size
        except FileNotFoundError:
            return
        if size > self._max_bytes:
            os.replace(self.path, self.path.with_name(self.path.name + ".1"))
