"""Bot-scoped Telegram state with strict corruption handling."""

from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, TypeVar

from .bot_identity_reservation import BotIdentityReservationError, TELEGRAM_BOT_IDENTITY_RESERVED
from .telegram_credentials import TelegramCredentialError


T = TypeVar("T")
STATE_SCHEMA_VERSION = 3
LEGACY_PAIRED_SCHEMA_VERSION = 2
CHAT_STATUSES = frozenset({"pending", "approved", "rejected", "revoked"})
DECISION_STATUSES = frozenset({"approved", "rejected", "revoked"})
CHAT_RECORD_KEYS = frozenset({"status", "displayName", "username", "requestedAt", "decidedAt"})
# Admin decisions: (current status, new status). A pending chat is decided once; a decided chat
# can later be revoked (approved only) or approved again (rejected or revoked).
ACCESS_TRANSITIONS = frozenset({
    ("pending", "approved"),
    ("pending", "rejected"),
    ("approved", "revoked"),
    ("rejected", "approved"),
    ("revoked", "approved"),
})
ACCESS_REQUEST_ADDED = "added"
ACCESS_REQUEST_EXISTS = "exists"
ACCESS_REQUEST_FULL = "full"
UTC_TIMESTAMP_PATTERN =re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z")


class TelegramStateUnavailable(RuntimeError):
    pass


class TelegramLifecycleError(RuntimeError):
    pass


class TelegramChatNotFound(LookupError):
    pass


class TelegramInvalidTransition(ValueError):
    pass


def empty_telegram_state() -> dict[str, Any]:
    return {"schemaVersion": STATE_SCHEMA_VERSION, "bots": {}}


def _is_utc_timestamp(value: Any) -> bool:
    """Accept only locally generated UTC ISO timestamps ("...Z"); any other text is rejected."""
    if not isinstance(value, str) or UTC_TIMESTAMP_PATTERN.fullmatch(value) is None:
        return False
    for shape in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S.%fZ"):
        try:
            datetime.strptime(value, shape)
        except ValueError:
            continue
        return True
    return False


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _is_chat_key(key: object) -> bool:
    if not isinstance(key, str):
        return False
    try:
        return str(int(key)) == key
    except ValueError:
        return False


def _validate_chat_record(record: object) -> dict[str, Any]:
    if not isinstance(record, dict) or set(record) != CHAT_RECORD_KEYS:
        raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
    status, display_name, username = record["status"], record["displayName"], record["username"]
    requested_at, decided_at = record["requestedAt"], record["decidedAt"]
    if (
        not isinstance(status, str)
        or status not in CHAT_STATUSES
        or not isinstance(display_name, str)
        or (username is not None and not isinstance(username, str))
        or not _is_utc_timestamp(requested_at)
        # A pending request has no decision yet; every other status was decided at a known time.
        or (decided_at is not None) == (status == "pending")
        or (decided_at is not None and not _is_utc_timestamp(decided_at))
    ):
        raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
    return {"status": status, "displayName": display_name, "username": username, "requestedAt": requested_at, "decidedAt": decided_at}


def _migrate_paired_chats(chats: object, now: str) -> dict[str, Any]:
    """Turn the schema-2 paired id list into approved chat records stamped with the migration time."""
    if (
        not isinstance(chats, list)
        or any(isinstance(chat_id, bool) or not isinstance(chat_id, int) for chat_id in chats)
        or len(set(chats)) != len(chats)
    ):
        raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
    return {
        str(chat_id): {"status": "approved", "displayName": "", "username": None, "requestedAt": now, "decidedAt": now}
        for chat_id in chats
    }


def validate_telegram_state(value: object, *, now: str | None = None) -> dict[str, Any]:
    """Validate a state document; a schema-2 document is migrated to schema 3 in memory."""
    if not isinstance(value, dict) or set(value) != {"schemaVersion", "bots"}:
        raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
    version = value.get("schemaVersion")
    if isinstance(version, bool) or version not in (STATE_SCHEMA_VERSION, LEGACY_PAIRED_SCHEMA_VERSION):
        raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
    legacy = version == LEGACY_PAIRED_SCHEMA_VERSION
    bots = value.get("bots")
    if not isinstance(bots, dict):
        raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
    migration_time = now if now is not None else _utc_now()
    validated: dict[str, Any] = {}
    for key, record in bots.items():
        if not isinstance(key, str) or not key.isascii() or not key.isdigit() or key.startswith("0"):
            raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
        bot_id = int(key)
        if bot_id <= 0 or str(bot_id) != key or not isinstance(record, dict):
            raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
        chats_key = "pairedPrivateChatIds" if legacy else "chats"
        if set(record) != {chats_key, "nextUpdateOffset", "migrationActive"}:
            raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
        offset = record.get("nextUpdateOffset")
        migration_active = record.get("migrationActive")
        if (
            (offset is not None and (isinstance(offset, bool) or not isinstance(offset, int) or offset < 0))
            or not isinstance(migration_active, bool)
        ):
            raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
        if legacy:
            chats = _migrate_paired_chats(record[chats_key], migration_time)
        else:
            raw_chats = record[chats_key]
            if not isinstance(raw_chats, dict) or not all(_is_chat_key(chat_key) for chat_key in raw_chats):
                raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
            chats = {chat_key: _validate_chat_record(chat) for chat_key, chat in raw_chats.items()}
        validated[key] = {"chats": chats, "nextUpdateOffset": offset, "migrationActive": migration_active}
    return {"schemaVersion": STATE_SCHEMA_VERSION, "bots": validated}


TELEGRAM_DIAGNOSTIC_FIELDS = frozenset({"stage", "category", "httpStatus", "failureAt", "lastSuccessAt"})
TELEGRAM_DIAGNOSTIC_STAGES = frozenset({"prepare", "poll", "state_read", "validate", "persist", "handle"})
TELEGRAM_DIAGNOSTIC_CATEGORIES = frozenset({"transport", "http", "response_json", "state", "unexpected"})
def project_telegram_diagnostic(raw: Any) -> dict[str, Any] | None:
    """Restrict a raw diagnostic record to the public safe schema; invalid values become null."""
    if not isinstance(raw, dict) or set(raw) != TELEGRAM_DIAGNOSTIC_FIELDS:
        return None
    stage = raw["stage"] if isinstance(raw["stage"], str) and raw["stage"] in TELEGRAM_DIAGNOSTIC_STAGES else None
    category = raw["category"] if isinstance(raw["category"], str) and raw["category"] in TELEGRAM_DIAGNOSTIC_CATEGORIES else None
    status_code = raw["httpStatus"]
    http_status = status_code if isinstance(status_code, int) and not isinstance(status_code, bool) and 100 <= status_code <= 599 else None
    failure_at = raw["failureAt"] if _is_utc_timestamp(raw["failureAt"]) else None
    last_success_at = raw["lastSuccessAt"] if _is_utc_timestamp(raw["lastSuccessAt"]) else None
    return {"stage": stage, "category": category, "httpStatus": http_status, "failureAt": failure_at, "lastSuccessAt": last_success_at}


def _bot_telegram_diagnostic(bot: Any) -> dict[str, Any] | None:
    """Read a bot diagnostic defensively so mocks, broken bots, or absent getters never leak into status."""
    try:
        getter = getattr(bot, "telegram_diagnostic", None)
        return project_telegram_diagnostic(getter()) if callable(getter) else None
    except Exception:
        return None


class TelegramStateRepository:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.lock = threading.RLock()

    def read(self) -> dict[str, Any]:
        with self.lock:
            try:
                payload = self.path.read_text(encoding="utf-8")
            except FileNotFoundError:
                return empty_telegram_state()
            except OSError:
                raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE") from None
            try:
                decoded = json.loads(payload)
                if (
                    isinstance(decoded, dict)
                    and set(decoded) == {"allowedChatIds"}
                    and isinstance(decoded["allowedChatIds"], list)
                    and all(not isinstance(value, bool) and isinstance(value, int) for value in decoded["allowedChatIds"])
                ):
                    return empty_telegram_state()
                validated = validate_telegram_state(decoded)
                if decoded.get("schemaVersion") == LEGACY_PAIRED_SCHEMA_VERSION:
                    # Persist the migration right away: the migrated records carry a
                    # timestamp, so leaving the file at v2 would stamp a new one on every read.
                    # The whole read-migrate-write runs under the repository lock, so a concurrent
                    # reader waits and then finds the v3 file: the migration is stamped once.
                    self.write(validated)
                return validated
            except (UnicodeError, json.JSONDecodeError, TelegramStateUnavailable):
                raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE") from None

    def write(self, value: dict[str, Any]) -> None:
        validated = validate_telegram_state(value)
        with self.lock:
            temporary = self.path.with_suffix(self.path.suffix + ".tmp")
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                temporary.write_text(json.dumps(validated, ensure_ascii=False, indent=2), encoding="utf-8")
                os.replace(temporary, self.path)
            except OSError:
                raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE") from None


    # Every mutation is a read-modify-write under the repository lock, so the poll
    # loop's offset write and an admin decision can never overwrite each other.

    def update(self, mutator: Callable[[dict[str, Any]], T]) -> T:
        """Apply ``mutator`` to the validated state and persist it; nothing is written if it raises."""
        with self.lock:
            state = self.read()
            result = mutator(state)
            self.write(state)
            return result

    def _update_when_changed(self, mutator: Callable[[dict[str, Any]], bool]) -> bool:
        """Like ``update``, but persist only when ``mutator`` reports a change."""
        with self.lock:
            state = self.read()
            if not mutator(state):
                return False
            self.write(state)
            return True

    @staticmethod
    def _bot_record(state: dict[str, Any], bot_id: int) -> dict[str, Any]:
        record = state["bots"].get(str(bot_id))
        if record is None:
            raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
        return record

    def status_of(self, bot_id: int, chat_id: int) -> str | None:
        chat = self._bot_record(self.read(), bot_id)["chats"].get(str(chat_id))
        return chat["status"] if chat is not None else None

    def list_chats(self, bot_id: int) -> list[dict[str, Any]]:
        chats = self._bot_record(self.read(), bot_id)["chats"]
        return [{"chatId": int(chat_id), **chat} for chat_id, chat in chats.items()]

    def request_access(
        self,
        bot_id: int,
        chat_id: int,
        display_name: str,
        username: str | None,
        *,
        max_pending: int | None = None,
        now: str | None = None,
    ) -> str:
        """Record an access request in one locked step: the cap check and the insert cannot interleave.

        Returns ``ACCESS_REQUEST_ADDED``, ``ACCESS_REQUEST_EXISTS`` (the chat is already known and left
        untouched) or ``ACCESS_REQUEST_FULL`` (``max_pending`` requests already wait; nothing is written).
        """
        requested_at = now if now is not None else _utc_now()
        with self.lock:
            state = self.read()
            chats = self._bot_record(state, bot_id)["chats"]
            if str(chat_id) in chats:
                return ACCESS_REQUEST_EXISTS
            if max_pending is not None and sum(1 for chat in chats.values() if chat["status"] == "pending") >= max_pending:
                return ACCESS_REQUEST_FULL
            chats[str(chat_id)] = {
                "status": "pending",
                "displayName": display_name,
                "username": username,
                "requestedAt": requested_at,
                "decidedAt": None,
            }
            self.write(state)
            return ACCESS_REQUEST_ADDED

    def add_pending(self, bot_id: int, chat_id: int, display_name: str, username: str | None, *, now: str | None = None) -> bool:
        """Record an access request without a cap; a chat that is already known is left untouched."""
        return self.request_access(bot_id, chat_id, display_name, username, now=now) == ACCESS_REQUEST_ADDED

    def set_status(self, bot_id: int, chat_id: int, status: str, *, now: str | None = None) -> bool:
        """Record an admin decision; returns False when the chat is unknown."""
        if status not in DECISION_STATUSES:
            raise ValueError(status)
        decided_at = now if now is not None else _utc_now()

        def mutate(state: dict[str, Any]) -> bool:
            chat = self._bot_record(state, bot_id)["chats"].get(str(chat_id))
            if chat is None:
                return False
            chat.update(status=status, decidedAt=decided_at)
            return True

        return self._update_when_changed(mutate)

    def apply_decision(self, bot_id: int, chat_id: int, status: str, *, now: str | None = None) -> dict[str, Any]:
        """Apply one admin decision in a single locked step and return the updated chat record.

        Only the transitions in ``ACCESS_TRANSITIONS`` are accepted; anything else raises
        ``TelegramInvalidTransition`` and an unknown chat raises ``TelegramChatNotFound``,
        in both cases without writing.
        """
        if status not in DECISION_STATUSES:
            raise ValueError(status)
        decided_at = now if now is not None else _utc_now()

        def mutate(state: dict[str, Any]) -> dict[str, Any]:
            chat = self._bot_record(state, bot_id)["chats"].get(str(chat_id))
            if chat is None:
                raise TelegramChatNotFound(chat_id)
            if (chat["status"], status) not in ACCESS_TRANSITIONS:
                raise TelegramInvalidTransition(f"{chat['status']}->{status}")
            chat.update(status=status, decidedAt=decided_at)
            return {"chatId": chat_id, **chat}

        return self.update(mutate)

    def set_offset(self, bot_id: int, offset: int | None) -> None:
        self.update(lambda state: self._bot_record(state, bot_id).update(nextUpdateOffset=offset))


class TelegramLifecycleManager:
    def __init__(self, config, resolver, credential_service, bot_factory):
        self.config = config
        self.resolver = resolver
        self.credential_service = credential_service
        self.bot_factory = bot_factory
        self.operation_lock = threading.RLock()
        self.state_lock = threading.RLock()
        self.bot = None
        self._status = {
            "source": resolver.source,
            "enabled": bool(config.enabled),
            "configured": bool(config.token) if resolver.source == "environment" else False,
            "desiredGeneration": 1,
            "appliedGeneration": 0,
            "running": False,
            "verified": False,
            "restartRequired": True,
            "lastError": config.configuration_error,
            "telegramDiagnostic": None,
        }
        if not config.enabled:
            self._status.update({"appliedGeneration": 1, "restartRequired": False, "lastError": None})

    def _update(self, **values):
        with self.state_lock:
            self._status.update(values)
            self._status["restartRequired"] = self._status["desiredGeneration"] != self._status["appliedGeneration"]

    def status(self):
        with self.state_lock:
            result = dict(self._status)
            live_diagnostic = _bot_telegram_diagnostic(self.bot)
            stored_diagnostic = result.get("telegramDiagnostic")
            diagnostic = live_diagnostic if live_diagnostic is not None else stored_diagnostic
            result["telegramDiagnostic"] = dict(diagnostic) if diagnostic is not None else None
            bot = self.bot
            if bot is not None and bot.thread is not None:
                result["running"] = bot.thread.is_alive() and not bot.stop_event.is_set()
                poll_error = getattr(bot, "last_error", None)
                if poll_error in {"TELEGRAM_POLL_FAILED", "TELEGRAM_PREPARATION_FAILED"}:
                    result["lastError"] = poll_error
                if not bot.thread.is_alive():
                    result.update(running=False, verified=False)
            # Public info (not the secret token), only while genuinely
            # connected; a missing/foreign attribute or an empty value closes
            # to None instead of raising -- this is a display projection.
            username = getattr(bot, "bot_username", None) if (bot is not None and result["running"]) else None
            result["botUsername"] = username if isinstance(username, str) and username else None
            return result

    def _stop_owned_bot(self) -> bool:
        if self.bot is None:
            return True
        try:
            return self.bot.stop()
        except Exception:
            return False

    def set_secret(self, secret: str):
        with self.operation_lock:
            self.credential_service.set_secret("telegram", secret)
            with self.state_lock:
                generation = self._status["desiredGeneration"] + 1
            self._update(desiredGeneration=generation, configured=True, verified=False, lastError=None)

    def delete_secret(self) -> bool:
        with self.operation_lock:
            self.credential_service.delete_secret("telegram")
            with self.state_lock:
                generation = self._status["desiredGeneration"] + 1
            self._update(desiredGeneration=generation, configured=False, verified=False, lastError=None)
            if not self._stop_owned_bot():
                self._update(lastError="TELEGRAM_STOP_TIMEOUT")
                return False
            self.bot = None
            self._update(appliedGeneration=generation, running=False, verified=False, lastError=None, telegramDiagnostic=None)
            return True

    def apply(self):
        with self.operation_lock:
            if not self.config.enabled:
                self._update(lastError="TELEGRAM_DISABLED")
                raise TelegramLifecycleError("TELEGRAM_DISABLED")
            with self.state_lock:
                generation = self._status["desiredGeneration"]
            if not self._stop_owned_bot():
                self._update(lastError="TELEGRAM_STOP_TIMEOUT")
                raise TelegramLifecycleError("TELEGRAM_STOP_TIMEOUT")
            self.bot = None
            self._update(appliedGeneration=0, running=False, verified=False)
            try:
                token = self.resolver.resolve()
            except TelegramCredentialError as error:
                code = error.args[0]
                self._update(running=False, configured=False, verified=False, lastError=code)
                raise TelegramLifecycleError(code) from None
            try:
                candidate = self.bot_factory(token)
            except Exception:
                # A factory/setup failure must surface as a safe provider status and
                # must never leave an unowned candidate behind.
                self._update(
                    running=False,
                    verified=False,
                    lastError="TELEGRAM_PROVIDER_UNAVAILABLE",
                    telegramDiagnostic=None,
                )
                raise TelegramLifecycleError("TELEGRAM_PROVIDER_UNAVAILABLE") from None
            try:
                candidate.prepare()
                candidate.start()
            except Exception as error:
                cleanup_safe = False
                try:
                    cleanup_safe = candidate.stop()
                except Exception:
                    cleanup_safe = False
                if not cleanup_safe:
                    self.bot = candidate
                failed_diagnostic = _bot_telegram_diagnostic(candidate) if cleanup_safe else None
                # A cooperative identity conflict uses the same cleanup and retention
                # discipline as any other failed preparation; only the fixed code differs.
                failure_code = (
                    TELEGRAM_BOT_IDENTITY_RESERVED
                    if isinstance(error, BotIdentityReservationError)
                    else "TELEGRAM_PROVIDER_UNAVAILABLE"
                )
                self._update(
                    running=False,
                    verified=False,
                    lastError=failure_code,
                    telegramDiagnostic=failed_diagnostic if failed_diagnostic and failed_diagnostic["failureAt"] is not None else None,
                )
                raise TelegramLifecycleError(failure_code) from None
            self.bot = candidate
            self._update(
                configured=True,
                appliedGeneration=generation,
                running=True,
                verified=True,
                lastError=None,
                telegramDiagnostic=None,
            )
            return self.status()

    def startup_apply(self):
        if not self.config.enabled:
            return self.status()
        try:
            return self.apply()
        except TelegramLifecycleError:
            return self.status()

    def stop(self) -> bool:
        with self.operation_lock:
            if self.bot is None:
                return True
            stopped = self._stop_owned_bot()
            if stopped:
                self.bot = None
                self._update(running=False, verified=False)
            else:
                self._update(lastError="TELEGRAM_STOP_TIMEOUT")
            return stopped
