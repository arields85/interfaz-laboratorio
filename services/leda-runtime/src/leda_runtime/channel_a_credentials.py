"""Protected-store-only credential resolution for the dedicated Channel A bot.

The resolver has a single authority: the existing encrypted provider store. It
never consults a bot-token environment variable, so an absent protected secret
or an unavailable master key can never silently fall back to another source.
"""

from __future__ import annotations

import os
from collections.abc import Callable

from .credential_store import CredentialService
from .paths import runtime_paths
from .storage_permissions import SecureStoragePermissions


LEDA_CHANNEL_A_CREDENTIAL_MISSING = "LEDA_CHANNEL_A_CREDENTIAL_MISSING"
LEDA_CHANNEL_A_CREDENTIAL_UNAVAILABLE = "LEDA_CHANNEL_A_CREDENTIAL_UNAVAILABLE"
_CHANNEL_A_PROVIDER = "telegram_channel_a"


class ChannelACredentialError(RuntimeError):
    pass


def _default_service() -> CredentialService:
    paths = runtime_paths()
    permissions = SecureStoragePermissions()
    return CredentialService(
        paths.credential_database,
        os.environ.get("LEDA_CREDENTIAL_MASTER_KEY_FILE", ""),
        paths.root,
        permissions.verify,
    )


class ChannelACredentialResolver:
    def __init__(self, credential_service_factory: Callable[[], CredentialService] | None = None):
        self.credential_service_factory = _default_service if credential_service_factory is None else credential_service_factory

    def resolve(self) -> str:
        try:
            value = self.credential_service_factory().get_secret(_CHANNEL_A_PROVIDER)
            present = isinstance(value, str) and bool(value.strip())
        except Exception:
            raise ChannelACredentialError(LEDA_CHANNEL_A_CREDENTIAL_UNAVAILABLE) from None
        if not present:
            raise ChannelACredentialError(LEDA_CHANNEL_A_CREDENTIAL_MISSING)
        return value
