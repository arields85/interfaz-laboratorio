"""Resolve Gemini credentials without exposing them beyond provider construction."""

from __future__ import annotations

import os
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from threading import Lock
from typing import Literal

from .credential_store import CredentialService
from .paths import runtime_paths
from .storage_permissions import SecureStoragePermissions


SDK_TIMEOUT_MS = 45_000
# Verification is a short liveness/authorization probe, never a generation
# call, so it uses its own much shorter SDK timeout than TTS.
GEMINI_VERIFY_TIMEOUT_MS = 10_000
# Must stay equal to voice_service.TTS_MODEL (guarded by
# tests/test_gemini_credentials.py::GeminiVerifyModelTests): verification must
# check the exact model the voice service actually speaks with. Not imported
# directly from voice_service to avoid coupling this port-5057 module to the
# separate port-5056 voice service process.
GEMINI_VERIFY_MODEL = "gemini-3.1-flash-tts-preview"

GeminiVerificationState = Literal[
    "not_checked", "verified", "invalid_key", "unreachable", "not_configured"
]


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


def create_gemini_client(secret: str, timeout_ms: int = SDK_TIMEOUT_MS):
    # importlib.import_module always resolves through sys.modules, unlike
    # `from google import genai`, which can bind through an already-real
    # `google.genai` package attribute even when a test replaces the
    # sys.modules entry. That keeps this lookup reliably mockable regardless
    # of import order relative to other google.genai submodule imports
    # elsewhere in the process (see GeminiVerificationService._run_check).
    import importlib

    genai = importlib.import_module("google.genai")

    return genai.Client(
        api_key=secret,
        http_options=genai.types.HttpOptions(timeout=timeout_ms),
    )


@dataclass(frozen=True)
class GeminiVerification:
    state: GeminiVerificationState
    checked_at: float | None


class GeminiVerificationInProgress(RuntimeError):
    pass


class GeminiVerificationService:
    """In-memory, on-demand Gemini API key verification.

    Decoupled from credential storage: it never persists its result, only
    keeps the latest outcome and timestamp in process memory. A verification
    performs one non-generating model lookup (never a generation call, so it
    never consumes generation quota) and never logs or returns the secret or
    raw provider error text -- only a closed classification.
    """

    def __init__(
        self,
        resolver: "GeminiCredentialResolver",
        client_factory: Callable[[str], object] | None = None,
        model: str = GEMINI_VERIFY_MODEL,
        clock: Callable[[], float] = time.time,
    ):
        self.resolver = resolver
        self.client_factory = client_factory or (
            lambda secret: create_gemini_client(secret, timeout_ms=GEMINI_VERIFY_TIMEOUT_MS)
        )
        self.model = model
        self.clock = clock
        self._lock = Lock()
        self._in_flight = False
        self._state: GeminiVerificationState = "not_checked"
        self._checked_at: float | None = None

    def snapshot(self) -> GeminiVerification:
        with self._lock:
            return GeminiVerification(self._state, self._checked_at)

    def reset(self) -> None:
        """Saving or deleting the Gemini credential invalidates any prior result."""
        with self._lock:
            self._state = "not_checked"
            self._checked_at = None

    def verify(self) -> GeminiVerification:
        with self._lock:
            if self._in_flight:
                raise GeminiVerificationInProgress("GEMINI_VERIFICATION_IN_PROGRESS")
            self._in_flight = True
        try:
            state = self._run_check()
        finally:
            with self._lock:
                self._in_flight = False
        with self._lock:
            self._state = state
            self._checked_at = self.clock()
            return GeminiVerification(self._state, self._checked_at)

    def _run_check(self) -> GeminiVerificationState:
        try:
            secret = self.resolver.resolve()
        except GeminiCredentialUnavailable:
            return "not_configured"

        import importlib

        genai_errors = importlib.import_module("google.genai.errors")

        try:
            client = self.client_factory(secret)
            client.models.get(model=self.model)
        except genai_errors.ClientError:
            return "invalid_key"
        except Exception:
            # Server errors, network failures, and anything else unexpected:
            # the key may still be valid, so this is never reported as
            # invalid_key. Fail closed to unreachable rather than crash.
            return "unreachable"
        return "verified"
