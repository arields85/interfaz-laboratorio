"""Authoritative Telegram credential source selection."""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping

from .credential_store import CredentialService


class TelegramCredentialError(RuntimeError):
    pass


class TelegramCredentialResolver:
    def __init__(
        self,
        environ: Mapping[str, str] | None = None,
        credential_service_factory: Callable[[], CredentialService] | None = None,
    ):
        self.environ = environ if environ is not None else os.environ
        self.credential_service_factory = credential_service_factory

    @property
    def source(self) -> str:
        return "protected" if self.environ.get("PRISMA_CREDENTIAL_MASTER_KEY_FILE", "").strip() else "environment"

    def resolve(self) -> str:
        try:
            if self.source == "protected":
                if self.credential_service_factory is None:
                    raise TelegramCredentialError("CREDENTIAL_STORAGE_UNAVAILABLE")
                value = self.credential_service_factory().get_secret("telegram")
            else:
                value = self.environ.get("PRISMA_LOCAL_TELEGRAM_BOT_TOKEN", "").strip()
        except TelegramCredentialError:
            raise
        except Exception:
            raise TelegramCredentialError("CREDENTIAL_STORAGE_UNAVAILABLE") from None
        if not isinstance(value, str) or not value.strip():
            raise TelegramCredentialError("TELEGRAM_CREDENTIAL_MISSING")
        return value if self.source == "protected" else value.strip()
