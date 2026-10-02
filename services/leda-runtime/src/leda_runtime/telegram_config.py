"""Enablement policy for the optional Telegram integration.

Protected mode (``LEDA_CREDENTIAL_MASTER_KEY_FILE`` set) is controlled from the
HMI admin: Channel B is enabled by the credential stored in the protected store
and ``LEDA_LOCAL_TELEGRAM_ENABLED`` is ignored there, whatever its value. The
legacy environment mode keeps the explicit ``LEDA_LOCAL_TELEGRAM_ENABLED=1``
opt-in.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping


TELEGRAM_ENABLED_ENV = "LEDA_LOCAL_TELEGRAM_ENABLED"
TELEGRAM_TOKEN_ENV = "LEDA_LOCAL_TELEGRAM_BOT_TOKEN"


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
            return "TELEGRAM_CREDENTIAL_MISSING" if self.source == "protected" else "LEDA_LOCAL_TELEGRAM_BOT_TOKEN_MISSING"
        return None


def read_telegram_config(environ: Mapping[str, str] | None = None) -> TelegramConfig:
    values = environ if environ is not None else os.environ
    protected = bool(values.get("LEDA_CREDENTIAL_MASTER_KEY_FILE", "").strip())
    # Protected mode: the stored credential, not the environment, decides
    # whether the channel runs, so the opt-in variable can never block it.
    enabled = protected or values.get(TELEGRAM_ENABLED_ENV, "").strip() == "1"
    token = "" if protected else values.get(TELEGRAM_TOKEN_ENV, "").strip()
    return TelegramConfig(enabled=enabled, token=token if enabled else "", source="protected" if protected else "environment")


def telegram_token(environ: Mapping[str, str] | None = None) -> str:
    return read_telegram_config(environ).token
