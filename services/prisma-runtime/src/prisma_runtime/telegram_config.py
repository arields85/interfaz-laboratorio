"""Explicit opt-in policy for the optional Telegram integration."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping


TELEGRAM_ENABLED_ENV = "PRISMA_LOCAL_TELEGRAM_ENABLED"
TELEGRAM_TOKEN_ENV = "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN"


@dataclass(frozen=True)
class TelegramConfig:
    enabled: bool
    token: str
    source: str = "environment"

    @property
    def configured(self) -> bool:
        return self.enabled and bool(self.token)

    @property
    def configuration_error(self) -> str | None:
        if self.enabled and not self.token:
            return "TELEGRAM_CREDENTIAL_MISSING" if self.source == "protected" else "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN_MISSING"
        return None


def read_telegram_config(environ: Mapping[str, str] | None = None) -> TelegramConfig:
    values = environ if environ is not None else os.environ
    enabled = values.get(TELEGRAM_ENABLED_ENV, "").strip() == "1"
    protected = bool(values.get("PRISMA_CREDENTIAL_MASTER_KEY_FILE", "").strip())
    token = "" if protected else values.get(TELEGRAM_TOKEN_ENV, "").strip()
    return TelegramConfig(enabled=enabled, token=token if enabled else "", source="protected" if protected else "environment")


def telegram_token(environ: Mapping[str, str] | None = None) -> str:
    return read_telegram_config(environ).token
