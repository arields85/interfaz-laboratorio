"""Bounded anonymous document-session authority for Prisma HMI interactions."""

from __future__ import annotations

import base64
import copy
import hashlib
import json
import secrets
import threading
import time
import uuid
from dataclasses import dataclass


CAPABILITY_HEADER = "X-Prisma-Session-Capability"


class HmiSessionError(RuntimeError):
    pass


class HmiSessionUnauthorized(HmiSessionError):
    pass


class HmiSessionCapacity(HmiSessionError):
    pass


class HmiSessionContextTooLarge(HmiSessionError):
    pass


@dataclass
class _Session:
    owner_id: str
    created_at: float
    last_seen_at: float
    context: dict | None = None


class HmiSessionRegistry:
    def __init__(
        self,
        *,
        clock=time.time,
        entropy=secrets.token_bytes,
        owner_factory=lambda: str(uuid.uuid4()),
        max_sessions=64,
        idle_ttl=30 * 60,
        absolute_ttl=8 * 60 * 60,
        on_remove=lambda _owner_id: None,
        max_context_bytes=1024 * 1024,
    ):
        self.clock = clock
        self.entropy = entropy
        self.owner_factory = owner_factory
        self.max_sessions = max_sessions
        self.idle_ttl = idle_ttl
        self.absolute_ttl = absolute_ttl
        self.on_remove = on_remove
        self.max_context_bytes = max_context_bytes
        self.lock = threading.RLock()
        self._sessions: dict[bytes, _Session] = {}

    @staticmethod
    def _digest(capability: str) -> bytes:
        if not isinstance(capability, str) or len(capability) != 43 or not capability.isascii():
            raise HmiSessionUnauthorized("PRISMA_SESSION_REQUIRED")
        try:
            raw = base64.urlsafe_b64decode(capability + "=")
        except (ValueError, TypeError):
            raise HmiSessionUnauthorized("PRISMA_SESSION_REQUIRED") from None
        if len(raw) != 32 or base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=") != capability:
            raise HmiSessionUnauthorized("PRISMA_SESSION_REQUIRED")
        return hashlib.sha256(raw).digest()

    def create(self) -> tuple[str, dict]:
        now = self.clock()
        with self.lock:
            self._purge_locked(now)
            if len(self._sessions) >= self.max_sessions:
                raise HmiSessionCapacity("PRISMA_SESSION_CAPACITY")
            raw = bytes(self.entropy(32))
            if len(raw) != 32:
                raise HmiSessionError("PRISMA_SESSION_UNAVAILABLE")
            capability = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
            digest = hashlib.sha256(raw).digest()
            if digest in self._sessions:
                raise HmiSessionError("PRISMA_SESSION_UNAVAILABLE")
            owner_id = str(uuid.UUID(str(self.owner_factory())))
            self._sessions[digest] = _Session(owner_id, now, now)
        return capability, {
            "ok": True,
            "idleExpiresAt": now + self.idle_ttl,
            "absoluteExpiresAt": now + self.absolute_ttl,
        }

    def authorize(self, capability: str, *, touch=True) -> str:
        digest = self._digest(capability)
        now = self.clock()
        with self.lock:
            self._purge_locked(now)
            session = self._sessions.get(digest)
            if session is None:
                raise HmiSessionUnauthorized("PRISMA_SESSION_REQUIRED")
            if touch:
                session.last_seen_at = now
            return session.owner_id

    def close(self, capability: str) -> str:
        digest = self._digest(capability)
        with self.lock:
            session = self._sessions.pop(digest, None)
        if session is None:
            raise HmiSessionUnauthorized("PRISMA_SESSION_REQUIRED")
        self.on_remove(session.owner_id)
        return session.owner_id

    def set_context(self, capability: str, context: dict) -> str:
        if len(json.dumps(context, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > self.max_context_bytes:
            raise HmiSessionContextTooLarge("PRISMA_SESSION_CONTEXT_TOO_LARGE")
        digest = self._digest(capability)
        now = self.clock()
        with self.lock:
            self._purge_locked(now)
            session = self._sessions.get(digest)
            if session is None:
                raise HmiSessionUnauthorized("PRISMA_SESSION_REQUIRED")
            session.last_seen_at = now
            session.context = copy.deepcopy(context)
            return session.owner_id

    def get_context(self, capability: str) -> tuple[str, dict | None]:
        digest = self._digest(capability)
        now = self.clock()
        with self.lock:
            self._purge_locked(now)
            session = self._sessions.get(digest)
            if session is None:
                raise HmiSessionUnauthorized("PRISMA_SESSION_REQUIRED")
            session.last_seen_at = now
            return session.owner_id, copy.deepcopy(session.context)

    def _purge_locked(self, now):
        expired = [
            digest
            for digest, session in self._sessions.items()
            if now - session.last_seen_at >= self.idle_ttl or now - session.created_at >= self.absolute_ttl
        ]
        owners = [self._sessions[digest].owner_id for digest in expired]
        for digest in expired:
            self._sessions.pop(digest, None)
        for owner_id in owners:
            self.on_remove(owner_id)
