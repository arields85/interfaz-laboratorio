"""Immutable, bounded voice-event eligibility registry."""

from __future__ import annotations

import copy
import math
import secrets
import threading
import time
import uuid
from collections import OrderedDict
from datetime import datetime, timezone


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class VoiceEventCapacity(RuntimeError):
    pass


class VoiceEventStreamCapacity(RuntimeError):
    """T13b should-fix: raised by subscribe_owner() when a new SSE
    subscription would exceed the per-owner or global stream-subscriber
    cap. A rejected caller never holds a slot -- the check runs before the
    new waiter is appended."""


def validate_voice_event(payload, expected_id, *, now=time.time, max_text_bytes=16 * 1024, require_owner=False):
    """Validate an event returned by the canonical in-process registry boundary."""
    required = {"id", "timestamp", "expiresAt", "text", "question"}
    allowed = required | {"telegramChatId", "ownerId"}
    if not isinstance(payload, dict) or set(payload) - allowed or not required.issubset(payload):
        raise ValueError("VOICE_EVENT_SHAPE_INVALID")
    canonical = str(uuid.UUID(str(expected_id)))
    if payload["id"] != canonical:
        raise ValueError("VOICE_EVENT_ID_INVALID")
    owner_id = payload.get("ownerId")
    if require_owner:
        try:
            canonical_owner = str(uuid.UUID(str(owner_id)))
        except (ValueError, TypeError, AttributeError):
            raise ValueError("VOICE_EVENT_OWNER_INVALID") from None
        if owner_id != canonical_owner:
            raise ValueError("VOICE_EVENT_OWNER_INVALID")
    timestamp = payload["timestamp"]
    if not isinstance(timestamp, str) or len(timestamp) > 64 or "T" not in timestamp or not timestamp.endswith("Z"):
        raise ValueError("VOICE_EVENT_TIMESTAMP_INVALID")
    try:
        datetime.fromisoformat(timestamp[:-1] + "+00:00")
    except ValueError:
        raise ValueError("VOICE_EVENT_TIMESTAMP_INVALID") from None
    for field, allow_empty in (("text", False), ("question", True)):
        value = payload[field]
        if not isinstance(value, str) or (not allow_empty and not value.strip()) or len(value.encode("utf-8")) > max_text_bytes:
            raise ValueError(f"VOICE_EVENT_{field.upper()}_INVALID")
    expires_at = payload["expiresAt"]
    if (
        not isinstance(expires_at, (int, float))
        or isinstance(expires_at, bool)
        or not math.isfinite(expires_at)
        or expires_at <= now()
    ):
        raise ValueError("VOICE_EVENT_EXPIRY_INVALID")
    chat_id = payload.get("telegramChatId")
    if "telegramChatId" in payload and (
        not isinstance(chat_id, int)
        or isinstance(chat_id, bool)
        or chat_id == 0
        or abs(chat_id) > 9007199254740991
    ):
        raise ValueError("VOICE_EVENT_CHAT_INVALID")
    return copy.deepcopy(payload)


class VoiceEventStore:
    def __init__(
        self,
        *,
        clock=time.time,
        ttl_seconds=300,
        max_events=16,
        max_total_events=256,
        prefetch_token_ttl_seconds=60.0,
        max_prefetch_tokens=64,
        channel_b_reply_token_ttl_seconds=60.0,
        max_channel_b_reply_tokens=64,
        max_stream_subscribers_per_owner=4,
        max_stream_subscribers_total=32,
    ):
        self.clock = clock
        self.ttl_seconds = ttl_seconds
        self.max_events = max_events
        self.max_total_events = max_total_events
        self.prefetch_token_ttl_seconds = prefetch_token_ttl_seconds
        self.max_prefetch_tokens = max_prefetch_tokens
        self.channel_b_reply_token_ttl_seconds = channel_b_reply_token_ttl_seconds
        self.max_channel_b_reply_tokens = max_channel_b_reply_tokens
        # T13b should-fix: an open SSE stream holds one Werkzeug thread for
        # as long as the connection lives, with no explicit cap of its own
        # before this -- only the 64-session HMI registry indirectly bounded
        # it. Both caps stay comfortably below that: a small per-owner limit
        # (a real tab plus a brief reconnect overlap) and a global limit well
        # below 64 concurrent sessions.
        self.max_stream_subscribers_per_owner = max_stream_subscribers_per_owner
        self.max_stream_subscribers_total = max_stream_subscribers_total
        self.lock = threading.RLock()
        self._events = OrderedDict()
        self._latest = {}
        # T13 unit (b): short-lived, event-scoped, server-minted bearer
        # tokens standing in for an HMI session capability at a publish site
        # with no live browser request in flight (Channel A's on-outcome
        # callback). token -> (event_id, owner_id, expires_at).
        self._prefetch_tokens: OrderedDict[str, tuple[str, str, float]] = OrderedDict()
        # B1: Channel B (the remote personal Telegram bot) has no HMI owner
        # and no published voice event to bind a prefetch token to -- its own
        # bearer token instead carries the full answer payload (destination
        # chat, answer text, question message id) in this fully separate
        # table. Deliberately never touches _events/_latest: resolving it can
        # never surface on /hmi/voice/latest, /hmi/voice/events or the orb.
        # Single-use (popped on resolve, unlike the reusable prefetch token
        # above) since Channel B's flow synthesizes and delivers exactly
        # once, with no AudioCoordinator multi-admission revalidation to
        # support.
        self._channel_b_reply_tokens: OrderedDict[str, tuple[dict, float]] = OrderedDict()
        # T13 unit (c): per-owner wake flags so a push (SSE) endpoint can
        # block-wait for the next publish instead of polling the store.
        self._owner_waiters: dict[str, list[threading.Event]] = {}
        self._empty_event = {"id": str(uuid.uuid4()), "timestamp": _timestamp(), "text": "", "question": "inicio-local"}

    @staticmethod
    def _is_current(guard):
        if guard is None:
            return True
        try:
            return guard() is True
        except Exception:
            return False

    def publish(self, question, answer_text, chat_id=None, *, paired_bot_producer=False, owner_id="legacy", is_current=None):
        if is_current is not None and not callable(is_current):
            raise ValueError("VOICE_EVENT_GUARD_INVALID")
        if not self._is_current(is_current):
            return None
        now = self.clock()
        event = {
            "id": str(uuid.uuid4()),
            "timestamp": _timestamp(),
            "expiresAt": now + self.ttl_seconds,
            "text": str(answer_text),
            "question": str(question),
        }
        if paired_bot_producer and isinstance(chat_id, int) and not isinstance(chat_id, bool) and chat_id != 0:
            event["telegramChatId"] = chat_id
        with self.lock:
            self._purge(now)
            owner_events = [key for key, (owner, _event, _guard) in self._events.items() if owner == str(owner_id)]
            for event_id in owner_events[:max(0, len(owner_events) - self.max_events + 1)]:
                self._events.pop(event_id, None)
            if len(self._events) >= self.max_total_events:
                raise VoiceEventCapacity("VOICE_EVENT_CAPACITY")
            self._events[event["id"]] = (str(owner_id), copy.deepcopy(event), is_current)
            self._latest[str(owner_id)] = event["id"]
        self._notify_owner(str(owner_id))
        return copy.deepcopy(event)

    def subscribe_owner(self, owner_id):
        """T13 unit (c): returns (flag, unsubscribe). ``flag`` is a
        threading.Event set by every later successful publish() for this
        exact owner (a guard-refused publish never sets it); the caller
        blocks on ``flag.wait(timeout)`` instead of polling. ``unsubscribe``
        is idempotent and must always be called when the caller is done.

        T13b should-fix: raises VoiceEventStreamCapacity when this
        subscription would exceed the per-owner or global stream-subscriber
        cap. The check runs before the new waiter is appended, so a
        rejected caller never holds a slot."""
        owner_id = str(owner_id)
        flag = threading.Event()
        with self.lock:
            owner_waiters = self._owner_waiters.get(owner_id, [])
            if len(owner_waiters) >= self.max_stream_subscribers_per_owner:
                raise VoiceEventStreamCapacity("VOICE_EVENT_STREAM_SUBSCRIBER_LIMIT")
            total_waiters = sum(len(waiters) for waiters in self._owner_waiters.values())
            if total_waiters >= self.max_stream_subscribers_total:
                raise VoiceEventStreamCapacity("VOICE_EVENT_STREAM_CAPACITY")
            self._owner_waiters.setdefault(owner_id, []).append(flag)

        def unsubscribe():
            with self.lock:
                waiters = self._owner_waiters.get(owner_id)
                if waiters is None:
                    return
                if flag in waiters:
                    waiters.remove(flag)
                if not waiters:
                    self._owner_waiters.pop(owner_id, None)

        return flag, unsubscribe

    def _notify_owner(self, owner_id):
        with self.lock:
            waiters = list(self._owner_waiters.get(owner_id, ()))
        for flag in waiters:
            flag.set()

    def get(self, event_id, owner_id=None):
        try:
            canonical = str(uuid.UUID(str(event_id)))
        except (ValueError, TypeError, AttributeError):
            return None
        with self.lock:
            self._purge(self.clock())
            stored = self._events.get(canonical)
            if stored is None or (owner_id is not None and stored[0] != str(owner_id)):
                return None
        return self._read_candidate(canonical, stored)

    def latest(self, owner_id=None):
        with self.lock:
            self._purge(self.clock())
            key = "legacy" if owner_id is None else str(owner_id)
            event_id = self._latest.get(key)
            stored = self._events.get(event_id)
            if stored is None:
                return copy.deepcopy(self._empty_event) if owner_id is None else None
        return self._read_candidate(event_id, stored)

    def _read_candidate(self, event_id, stored):
        # Foreign guards may reenter the store; never call them under its lock.
        current = self._is_current(stored[2])
        with self.lock:
            if self._events.get(event_id) is not stored:
                return None
            if not current:
                self._events.pop(event_id)
                owner_id = stored[0]
                if self._latest.get(owner_id) == event_id:
                    # Refusal must not promote an older response on later reads.
                    self._latest.pop(owner_id)
                return None
            self._purge(self.clock())
            if self._events.get(event_id) is not stored:
                return None
            return copy.deepcopy(stored[1])

    def get_internal(self, event_id, owner_id):
        event = self.get(event_id, owner_id)
        return {**event, "ownerId": str(owner_id)} if event is not None else None

    def mint_prefetch_token(self, event_id, owner_id):
        """T13 unit (b): a background (non-browser) publish site -- Channel
        A's on-outcome callback -- has no live HMI session capability to
        forward at publish time, but it does have direct in-process
        knowledge of the exact event id and owner it just published. This
        mints a random (secrets.token_urlsafe, matching hmi_sessions.py's
        own entropy standard), short-lived, event-scoped bearer token that
        voice_service's existing internal prefetch route can carry in the
        SAME capability header/transport unchanged, without ever needing a
        real HMI session capability. Reusable within its short TTL (not
        single-use): AudioCoordinator revalidates the same event twice per
        job (subscribe()-time admission, then again at dequeue), and a
        single-use token would break the second revalidation for the very
        job its first use admitted. Never included in any browser-facing
        response. Returns None if the event does not exist (nothing to
        prefetch)."""
        try:
            canonical = str(uuid.UUID(str(event_id)))
        except (ValueError, TypeError, AttributeError):
            return None
        now = self.clock()
        with self.lock:
            self._purge(now)
            if canonical not in self._events:
                return None
            self._purge_prefetch_tokens_locked(now)
            if len(self._prefetch_tokens) >= self.max_prefetch_tokens:
                self._prefetch_tokens.popitem(last=False)
            token = secrets.token_urlsafe(32)
            self._prefetch_tokens[token] = (canonical, str(owner_id), now + self.prefetch_token_ttl_seconds)
        return token

    def resolve_prefetch_token(self, token, event_id):
        """Validate a prefetch token against the exact event id it was
        minted for; returns the bound owner id on success, None otherwise
        (missing, malformed, expired, or bound to a different event)."""
        if not isinstance(token, str) or not token:
            return None
        try:
            canonical = str(uuid.UUID(str(event_id)))
        except (ValueError, TypeError, AttributeError):
            return None
        now = self.clock()
        with self.lock:
            self._purge_prefetch_tokens_locked(now)
            record = self._prefetch_tokens.get(token)
        if record is None:
            return None
        bound_event_id, owner_id, expires_at = record
        if bound_event_id != canonical or expires_at <= now:
            return None
        return owner_id

    def _purge_prefetch_tokens_locked(self, now):
        expired = [token for token, (_eid, _oid, expires_at) in self._prefetch_tokens.items() if expires_at <= now]
        for token in expired:
            self._prefetch_tokens.pop(token, None)

    def mint_channel_b_reply_token(self, chat_id, text, reply_to_message_id=None):
        """B1: mint a single-use bearer token for one Channel B answer, bound
        to its destination chat, its own text, and (when known) the question
        message id to reply to. See the table's own docstring above for why
        this never touches _events/_latest."""
        if not isinstance(chat_id, int) or isinstance(chat_id, bool) or chat_id == 0:
            raise ValueError("VOICE_EVENT_CHAT_INVALID")
        normalized_reply_to = (
            reply_to_message_id
            if isinstance(reply_to_message_id, int) and not isinstance(reply_to_message_id, bool) and reply_to_message_id > 0
            else None
        )
        now = self.clock()
        with self.lock:
            self._purge_channel_b_reply_tokens_locked(now)
            if len(self._channel_b_reply_tokens) >= self.max_channel_b_reply_tokens:
                self._channel_b_reply_tokens.popitem(last=False)
            token = secrets.token_urlsafe(32)
            payload = {"chatId": chat_id, "text": str(text), "replyToMessageId": normalized_reply_to}
            self._channel_b_reply_tokens[token] = (payload, now + self.channel_b_reply_token_ttl_seconds)
        return token

    def resolve_channel_b_reply_token(self, token):
        """Single-use: a valid token is consumed by its first resolution."""
        if not isinstance(token, str) or not token:
            return None
        now = self.clock()
        with self.lock:
            self._purge_channel_b_reply_tokens_locked(now)
            record = self._channel_b_reply_tokens.pop(token, None)
        if record is None:
            return None
        payload, expires_at = record
        if expires_at <= now:
            return None
        return dict(payload)

    def _purge_channel_b_reply_tokens_locked(self, now):
        expired = [token for token, (_payload, expires_at) in self._channel_b_reply_tokens.items() if expires_at <= now]
        for token in expired:
            self._channel_b_reply_tokens.pop(token, None)

    def remove_owner(self, owner_id):
        owner_id = str(owner_id)
        with self.lock:
            self._events = OrderedDict(
                (event_id, stored) for event_id, stored in self._events.items() if stored[0] != owner_id
            )
            self._latest.pop(owner_id, None)

    def _purge(self, now):
        expired = [event_id for event_id, (_owner, event, _guard) in self._events.items() if event["expiresAt"] <= now]
        for event_id in expired:
            self._events.pop(event_id, None)
        for owner_id, event_id in list(self._latest.items()):
            if event_id not in self._events:
                replacement = next(
                    (candidate for candidate, (owner, _event, _guard) in reversed(self._events.items()) if owner == owner_id),
                    None,
                )
                if replacement is None:
                    self._latest.pop(owner_id, None)
                else:
                    self._latest[owner_id] = replacement
