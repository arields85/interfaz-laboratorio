"""Immutable, bounded voice-event eligibility registry."""

from __future__ import annotations

import copy
import math
import threading
import time
import uuid
from collections import OrderedDict
from datetime import datetime, timezone


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class VoiceEventCapacity(RuntimeError):
    pass


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
    def __init__(self, *, clock=time.time, ttl_seconds=300, max_events=16, max_total_events=256):
        self.clock = clock
        self.ttl_seconds = ttl_seconds
        self.max_events = max_events
        self.max_total_events = max_total_events
        self.lock = threading.RLock()
        self._events = OrderedDict()
        self._latest = {}
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
        return copy.deepcopy(event)

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
