"""Resolve Gemini credentials without exposing them beyond provider construction."""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping

from .credential_store import CredentialService
from .paths import runtime_paths
from .storage_permissions import SecureStoragePermissions


SDK_TIMEOUT_MS = 45_000


class GeminiCredentialUnavailable(RuntimeError):
    pass


def _default_service() -> CredentialService:
    paths = runtime_paths()
    permissions = SecureStoragePermissions()
    return CredentialService(
        paths.credential_database,
        os.environ.get("PRISMA_CREDENTIAL_MASTER_KEY_FILE", ""),
        paths.root,
        permissions.verify,
    )


class GeminiCredentialResolver:
    def __init__(
        self,
        environ: Mapping[str, str] | None = None,
        credential_service_factory: Callable[[], CredentialService] = _default_service,
    ):
        self.environ = environ if environ is not None else os.environ
        self.credential_service_factory = credential_service_factory

    @property
    def source(self) -> str:
        return "protected" if self.environ.get("PRISMA_CREDENTIAL_MASTER_KEY_FILE", "").strip() else "environment"

    def resolve(self) -> str:
        try:
            protected = self.source == "protected"
            value = self.credential_service_factory().get_secret("gemini") if protected else self.environ.get("GEMINI_API_KEY", "")
        except Exception:
            raise GeminiCredentialUnavailable("GEMINI_CREDENTIAL_UNAVAILABLE") from None
        if not isinstance(value, str) or not value.strip():
            raise GeminiCredentialUnavailable("GEMINI_CREDENTIAL_MISSING")
        return value if protected else value.strip()

    def status(self) -> dict[str, object]:
        try:
            self.resolve()
        except GeminiCredentialUnavailable as error:
            return {
                "source": self.source,
                "configured": False,
                "available": error.args[0] != "GEMINI_CREDENTIAL_UNAVAILABLE",
                "verified": False,
            }
        return {"source": self.source, "configured": True, "available": True, "verified": False}


def create_gemini_client(secret: str):
    from google import genai

    return genai.Client(
        api_key=secret,
        http_options=genai.types.HttpOptions(timeout=SDK_TIMEOUT_MS),
    )
