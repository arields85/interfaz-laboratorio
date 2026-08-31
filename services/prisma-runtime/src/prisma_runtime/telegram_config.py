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

    @property
    def configured(self) -> bool:
        return self.enabled and bool(self.token)


def read_telegram_config(environ: Mapping[str, str] | None = None) -> TelegramConfig:
    values = environ if environ is not None else os.environ
    enabled = values.get(TELEGRAM_ENABLED_ENV, "").strip() == "1"
    token = values.get(TELEGRAM_TOKEN_ENV, "").strip()
    if enabled and not token:
        raise RuntimeError(f"{TELEGRAM_TOKEN_ENV} must be provided when {TELEGRAM_ENABLED_ENV}=1.")
    return TelegramConfig(enabled=enabled, token=token if enabled else "")


def telegram_token(environ: Mapping[str, str] | None = None) -> str:
    return read_telegram_config(environ).token
