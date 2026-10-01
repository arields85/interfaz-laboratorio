"""Authoritative Telegram credential source selection."""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from threading import Lock

from .credential_store import CredentialService
from .paths import runtime_paths


class TelegramCredentialError(RuntimeError):
    pass


def _default_mtime_probe() -> float | None:
    """Mirrors gemini_credentials._default_mtime_probe exactly: the
    cheapest reliable signal that the protected credential store changed
    is a stat() on its encrypted SQLite database file -- every
    set_secret/delete_secret call advances its mtime, so this resolver
    never needs a cross-process signal to notice a rotation."""
    try:
        return os.stat(runtime_paths().credential_database).st_mtime_ns
    except OSError:
        return None


class TelegramCredentialResolver:
    def __init__(
        self,
        environ: Mapping[str, str] | None = None,
        credential_service_factory: Callable[[], CredentialService] | None = None,
        *,
        mtime_probe: Callable[[], float | None] = _default_mtime_probe,
    ):
        self.environ = environ if environ is not None else os.environ
        self.credential_service_factory = credential_service_factory
        # F1 (live test 2026-09-25): a caller that resolves this token on
        # every outbound Telegram call (voice_service.py, unlike
        # presentation's construction-time-only resolve) pays a fresh
        # protected-store read every time without this -- mirrors
        # GeminiCredentialResolver's own mtime-based cache/invalidation.
        self.mtime_probe = mtime_probe
        self._cache_lock = Lock()
        self._cached_secret: str | None = None
        self._cached_mtime: float | None = None

    @property
    def source(self) -> str:
        return "protected" if self.environ.get("LEDA_CREDENTIAL_MASTER_KEY_FILE", "").strip() else "environment"

    def _safe_mtime(self) -> float | None:
        try:
            return self.mtime_probe()
        except Exception:
            return None

    def _cached_secret_if_fresh(self) -> str | None:
        with self._cache_lock:
            secret, cached_mtime = self._cached_secret, self._cached_mtime
        if secret is None:
            return None
        current_mtime = self._safe_mtime()
        # Fail-safe: once freshness can no longer be proven (the database is
        # gone, the probe failed, or a concurrent save/delete/rotate moved
        # the mtime), never serve the possibly-stale cached secret -- fall
        # through to a real resolve instead.
        if current_mtime is None or current_mtime != cached_mtime:
            with self._cache_lock:
                if self._cached_mtime == cached_mtime:
                    self._cached_secret = None
                    self._cached_mtime = None
            return None
        return secret

    def _store_cache(self, value: str) -> None:
        # Only cache when the mtime that will guard it is itself provably
        # fresh (never cache "blind").
        mtime = self._safe_mtime()
        with self._cache_lock:
            self._cached_secret = value if mtime is not None else None
            self._cached_mtime = mtime

    def resolve(self) -> str:
        protected = self.source == "protected"
        if protected:
            cached = self._cached_secret_if_fresh()
            if cached is not None:
                return cached
        try:
            if protected:
                if self.credential_service_factory is None:
                    raise TelegramCredentialError("CREDENTIAL_STORAGE_UNAVAILABLE")
                value = self.credential_service_factory().get_secret("telegram")
            else:
                value = self.environ.get("LEDA_LOCAL_TELEGRAM_BOT_TOKEN", "").strip()
        except TelegramCredentialError:
            raise
        except Exception:
            raise TelegramCredentialError("CREDENTIAL_STORAGE_UNAVAILABLE") from None
        if not isinstance(value, str) or not value.strip():
            raise TelegramCredentialError("TELEGRAM_CREDENTIAL_MISSING")
        result = value if protected else value.strip()
        if protected:
            self._store_cache(result)
        return result
