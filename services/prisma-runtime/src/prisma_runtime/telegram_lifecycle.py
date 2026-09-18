"""Bot-scoped Telegram state with strict corruption handling."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

from .telegram_credentials import TelegramCredentialError


STATE_SCHEMA_VERSION = 2


class TelegramStateUnavailable(RuntimeError):
    pass


class TelegramLifecycleError(RuntimeError):
    pass


def empty_telegram_state() -> dict[str, Any]:
    return {"schemaVersion": STATE_SCHEMA_VERSION, "bots": {}}


def validate_telegram_state(value: object) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {"schemaVersion", "bots"}:
        raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
    if value.get("schemaVersion") != STATE_SCHEMA_VERSION or isinstance(value.get("schemaVersion"), bool):
        raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
    bots = value.get("bots")
    if not isinstance(bots, dict):
        raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
    validated: dict[str, Any] = {}
    for key, record in bots.items():
        if not isinstance(key, str) or not key.isascii() or not key.isdigit() or key.startswith("0"):
            raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
        bot_id = int(key)
        if bot_id <= 0 or str(bot_id) != key or not isinstance(record, dict):
            raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
        allowed_keys = {"pairedPrivateChatIds", "nextUpdateOffset", "migrationActive"}
        if set(record) != allowed_keys:
            raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
        chats = record.get("pairedPrivateChatIds")
        offset = record.get("nextUpdateOffset")
        migration_active = record.get("migrationActive")
        if (
            not isinstance(chats, list)
            or any(isinstance(chat_id, bool) or not isinstance(chat_id, int) for chat_id in chats)
            or len(set(chats)) != len(chats)
            or (offset is not None and (isinstance(offset, bool) or not isinstance(offset, int) or offset < 0))
            or not isinstance(migration_active, bool)
        ):
            raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
        validated[key] = {
            "pairedPrivateChatIds": list(chats),
            "nextUpdateOffset": offset,
            "migrationActive": migration_active,
        }
    return {"schemaVersion": STATE_SCHEMA_VERSION, "bots": validated}


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
                return validate_telegram_state(decoded)
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
            bot = self.bot
            if bot is not None and bot.thread is not None:
                result["running"] = bot.thread.is_alive() and not bot.stop_event.is_set()
                poll_error = getattr(bot, "last_error", None)
                if poll_error in {"TELEGRAM_POLL_FAILED", "TELEGRAM_PREPARATION_FAILED"}:
                    result["lastError"] = poll_error
                if not bot.thread.is_alive():
                    result.update(running=False, verified=False)
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
            self._update(appliedGeneration=generation, running=False, verified=False, lastError=None)
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
            candidate = self.bot_factory(token)
            try:
                candidate.prepare()
                candidate.start()
            except Exception:
                cleanup_safe = False
                try:
                    cleanup_safe = candidate.stop()
                except Exception:
                    cleanup_safe = False
                if not cleanup_safe:
                    self.bot = candidate
                self._update(running=False, verified=False, lastError="TELEGRAM_PROVIDER_UNAVAILABLE")
                raise TelegramLifecycleError("TELEGRAM_PROVIDER_UNAVAILABLE") from None
            self.bot = candidate
            self._update(
                configured=True,
                appliedGeneration=generation,
                running=True,
                verified=True,
                lastError=None,
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
