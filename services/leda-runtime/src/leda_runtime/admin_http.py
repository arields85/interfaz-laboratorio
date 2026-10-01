"""Flask boundary for Leda administrator authentication and credentials."""

from __future__ import annotations

import ipaddress
import hmac
import json
from dataclasses import dataclass
from urllib.parse import urlsplit

from flask import Response, jsonify, request

from .admin_auth import (
    MAX_PASSWORD_BYTES,
    AdminSessionActiveElsewhere,
    AuthNotConfigured,
    AuthUnavailable,
    LoginRateLimited,
    PasswordChange,
    PasswordPolicyError,
)
from .bot_identity_reservation import TELEGRAM_BOT_IDENTITY_RESERVED
from .channel_a_lifecycle import LEDA_CHANNEL_A_LIFECYCLE_UNAVAILABLE, LEDA_CHANNEL_A_UNAUTHORIZED
from .channel_a_manager import ChannelAManagerError
from .credential_store import ALLOWED_PROVIDERS, MAX_SECRET_BYTES, CredentialUnavailable, InvalidCredential
from .gemini_credentials import GEMINI_VERIFY_MODEL, GeminiVerificationInProgress
from .hmi_config_store import HmiConfigInvalid, HmiConfigTooLarge, HmiConfigUnavailable
from .telegram_lifecycle import TelegramLifecycleError
from .telegram_verification import TelegramTokenVerificationInProgress


COOKIE_NAME = "leda_admin_session"
COOKIE_PATH = "/api/leda/admin"
LOCAL_ORIGINS = {"http://127.0.0.1:5173", "http://localhost:5173"}
CREDENTIAL_ROUTE_ROOT = "/api/leda/admin/credentials"
MAX_JSON_ESCAPE_BYTES_PER_SECRET_BYTE = 6
MAX_CREDENTIAL_JSON_OVERHEAD_BYTES = 1024
MAX_CREDENTIAL_REQUEST_BYTES = (
    MAX_SECRET_BYTES * MAX_JSON_ESCAPE_BYTES_PER_SECRET_BYTE + MAX_CREDENTIAL_JSON_OVERHEAD_BYTES
)
MAX_TELEGRAM_APPLY_REQUEST_BYTES = 128
PASSWORD_CHANGE_ROUTE = "/api/leda/admin/auth/password"
# Two passwords, each at most MAX_PASSWORD_BYTES raw bytes, each raw byte expanding by at most
# MAX_JSON_ESCAPE_BYTES_PER_SECRET_BYTE when JSON-escaped. The extra 1024 bytes cover the two key
# names, quotes, braces, comma and any whitespace around them, same as MAX_CREDENTIAL_JSON_OVERHEAD_BYTES.
MAX_PASSWORD_CHANGE_REQUEST_BYTES = (
    2 * MAX_PASSWORD_BYTES * MAX_JSON_ESCAPE_BYTES_PER_SECRET_BYTE + MAX_CREDENTIAL_JSON_OVERHEAD_BYTES
)
# Shared HMI configuration. Public reads live outside the admin prefix because the
# session cookie is scoped to COOKIE_PATH and must never reach them; the write is
# mounted under the admin prefix so that cookie (and CSRF) authorize it.
HMI_CONFIG_READ_ROUTE = "/api/leda/hmi-config"
HMI_CONFIG_REVISION_ROUTE = "/api/leda/hmi-config/revision"
HMI_CONFIG_WRITE_ROUTE = "/api/leda/admin/hmi-config"
MAX_HMI_CONFIG_REQUEST_BYTES = 16 * 1024 * 1024
TELEGRAM_APPLY_ROUTE = "/api/leda/admin/credentials/telegram/apply"
GEMINI_VERIFY_ROUTE = "/api/leda/admin/credentials/gemini/verify"
TELEGRAM_VERIFY_ROUTE = "/api/leda/admin/credentials/telegram/verify"
CHANNEL_A_PROVIDER = "telegram_channel_a"
CHANNEL_A_STATUS_ROUTE = f"{CREDENTIAL_ROUTE_ROOT}/{CHANNEL_A_PROVIDER}/status"
CHANNEL_A_APPLY_ROUTE = f"{CREDENTIAL_ROUTE_ROOT}/{CHANNEL_A_PROVIDER}/apply"
CHANNEL_A_VERIFY_ROUTE = f"{CREDENTIAL_ROUTE_ROOT}/{CHANNEL_A_PROVIDER}/verify"
# Closed refusal for every Channel A route when no manager was composed into
# this boundary: no direct-store fallback exists for Channel A (approved user
# decision), and the report must stay independent of store availability.
LEDA_CHANNEL_A_MANAGER_UNAVAILABLE = "LEDA_CHANNEL_A_MANAGER_UNAVAILABLE"
# Frozen admin wire contract, mirrored by hmi-app/src/domain/adminCredential.types.ts,
# which rejects a response carrying any additional key.
ADMIN_TELEGRAM_STATUS_FIELDS = (
    "source",
    "enabled",
    "configured",
    "desiredGeneration",
    "appliedGeneration",
    "running",
    "verified",
    "restartRequired",
    "lastError",
    "botUsername",
)


def project_admin_telegram_status(status: dict) -> dict:
    """Copy only the nine admin contract fields out of lifecycle status.

    Manager status also carries internal telemetry (``telegramDiagnostic``)
    consumed by public health; the admin route must not widen its contract with
    it. Copying keeps the manager-owned status object untouched.
    """
    return {field: status[field] for field in ADMIN_TELEGRAM_STATUS_FIELDS}


# Frozen admin Channel A wire contract: exactly ten status keys (T15 adds
# `paired`, T16 adds `retrying`/`retryAttempt`) with a nested activation
# projection; no raw manager object or credential is ever exposed.
ADMIN_CHANNEL_A_STATUS_FIELDS = (
    "configured",
    "desiredGeneration",
    "appliedGeneration",
    "activationEpoch",
    "activation",
    "lastError",
    "botUsername",
    "paired",
    "retrying",
    "retryAttempt",
)


def project_admin_channel_a_status(status: dict) -> dict:
    """Copy only the frozen admin contract fields out of manager-owned status.

    The nested activation object is projected through its four closed fields
    (or ``None``), never serialized raw; the source status is never mutated.
    """
    projection = {field: status[field] for field in ADMIN_CHANNEL_A_STATUS_FIELDS}
    activation = status["activation"]
    projection["activation"] = (
        None
        if activation is None
        else {
            "phase": activation.phase,
            "reason": activation.reason,
            "quiescent": activation.quiescent,
            "restartRequired": activation.restart_required,
        }
    )
    return projection


# Closed Channel A manager error mapping frozen by the tracker contract; any
# unknown, empty or non-string manager error code sanitizes to the fixed
# lifecycle-unavailable response instead of leaking manager internals.
CHANNEL_A_MANAGER_ERROR_STATUS = {
    "INVALID_CREDENTIAL_REQUEST": 400,
    "LEDA_CHANNEL_A_MANAGER_BUSY": 409,
    "LEDA_CHANNEL_A_CREDENTIAL_MISSING": 409,
    "LEDA_CHANNEL_A_RESTART_REQUIRED": 409,
    "LEDA_CHANNEL_A_STOP_UNCONFIRMED": 409,
    TELEGRAM_BOT_IDENTITY_RESERVED: 409,
    "LEDA_CHANNEL_A_CREDENTIAL_UNAVAILABLE": 503,
    "LEDA_CHANNEL_A_CONFIGURATION_UNAVAILABLE": 503,
    "LEDA_CHANNEL_A_CONFIGURATION_INVALID": 503,
    LEDA_CHANNEL_A_LIFECYCLE_UNAVAILABLE: 502,
    # T16: a revoked/invalid token surfaced synchronously (e.g. an explicit
    # admin Apply); same bucket as the generic lifecycle failure.
    LEDA_CHANNEL_A_UNAUTHORIZED: 502,
}

# Longest textual IPv6 form (with an IPv4-mapped tail) is 45 characters.
MAX_CLIENT_ADDRESS_CHARACTERS = 45


@dataclass(frozen=True)
class TransportPolicy:
    public_origin: str | None
    public_host: str | None
    secure_cookie: bool
    valid: bool

    @classmethod
    def build(cls, public_origin: str | None) -> "TransportPolicy":
        if public_origin is None or not public_origin.strip():
            return cls(None, None, False, True)
        try:
            parsed = urlsplit(public_origin)
            valid = (
                parsed.scheme == "https"
                and bool(parsed.hostname)
                and not parsed.username
                and not parsed.password
                and not parsed.path
                and not parsed.query
                and not parsed.fragment
                and public_origin == f"https://{parsed.netloc}"
            )
        except ValueError:
            valid, parsed = False, None
        return cls(public_origin, parsed.hostname if valid else None, True, valid)

    def allows(self, *, remote_addr: str | None, host: str, origin: str | None, require_origin: bool) -> bool:
        try:
            peer_is_loopback = ipaddress.ip_address(remote_addr or "").is_loopback
            request_host = urlsplit(f"//{host}").hostname
            host_allowed = bool(request_host) and (
                ipaddress.ip_address(request_host).is_loopback if request_host in {"127.0.0.1", "::1"} else request_host == "localhost" or request_host == self.public_host
            )
        except ValueError:
            return False
        if not peer_is_loopback or not host_allowed:
            return False
        if not require_origin:
            return True
        expected = {self.public_origin} if self.public_origin else LOCAL_ORIGINS
        return origin in expected


class AdminHttpBoundary:
    def __init__(
        self,
        auth_service,
        *,
        credential_service=None,
        telegram_manager=None,
        channel_a_manager=None,
        public_origin: str | None = None,
        gemini_verification_service=None,
        telegram_verification_service=None,
        channel_a_verification_service=None,
        hmi_config_store=None,
    ):
        self.auth_service = auth_service
        self.hmi_config_store = hmi_config_store
        self.credential_service = credential_service
        self.telegram_manager = telegram_manager
        self.channel_a_manager = channel_a_manager
        self.gemini_verification_service = gemini_verification_service
        self.telegram_verification_service = telegram_verification_service
        self.channel_a_verification_service = channel_a_verification_service
        self.transport = TransportPolicy.build(public_origin)

    def _gemini_verification_snapshot(self) -> dict:
        """Never crash the credentials status route when no verification
        service was composed; report the same closed not_checked shape."""
        if self.gemini_verification_service is None:
            return {"state": "not_checked", "checkedAt": None}
        snapshot = self.gemini_verification_service.snapshot()
        return {"state": snapshot.state, "checkedAt": snapshot.checked_at}

    def _telegram_family_verification_snapshot(self, service) -> dict:
        """Same closed not_checked shape as Gemini's, plus the bot username
        the last successful verification observed (never the token itself);
        a missing service reports the same shape instead of crashing."""
        if service is None:
            return {"state": "not_checked", "checkedAt": None, "username": None}
        snapshot = service.snapshot()
        return {"state": snapshot.state, "checkedAt": snapshot.checked_at, "username": snapshot.username}

    def _provider_metadata(self, provider: str, configured: bool) -> dict:
        if provider == "gemini":
            verification = self._gemini_verification_snapshot()
            # T15: the exact TTS model this key is verified/verifies against
            # (never hardcoded on the frontend), so the admin panel's resting
            # display can name it instead of a generic "not checked" copy.
            return {
                "configured": configured,
                "verified": verification["state"] == "verified",
                "verification": verification,
                "model": GEMINI_VERIFY_MODEL,
            }
        elif provider == "telegram":
            verification = self._telegram_family_verification_snapshot(self.telegram_verification_service)
        elif provider == CHANNEL_A_PROVIDER:
            verification = self._telegram_family_verification_snapshot(self.channel_a_verification_service)
        else:
            return {"configured": configured}
        return {"configured": configured, "verified": verification["state"] == "verified", "verification": verification}

    def _reset_verification_if_applicable(self, provider: str) -> None:
        """Saving or deleting a credential invalidates any prior verification
        result for that exact provider only; a missing service, or a provider
        with no verification service at all, is a silent no-op."""
        service = {
            "gemini": self.gemini_verification_service,
            "telegram": self.telegram_verification_service,
            CHANNEL_A_PROVIDER: self.channel_a_verification_service,
        }.get(provider)
        if service is not None:
            service.reset()

    def _channel_a_manager_error(self, error):
        """Map a closed manager error through the frozen allowlist."""
        code = error.args[0] if error.args else None
        status = CHANNEL_A_MANAGER_ERROR_STATUS.get(code) if isinstance(code, str) else None
        if status is None:
            return self._error(LEDA_CHANNEL_A_LIFECYCLE_UNAVAILABLE, 502)
        return self._error(code, status)

    def _require_channel_a_manager(self):
        """Refuse every Channel A route without a composed manager, regardless
        of protected-store availability; there is no direct-store fallback."""
        if self.channel_a_manager is None:
            return self._error(LEDA_CHANNEL_A_MANAGER_UNAVAILABLE, 503)
        return None

    def _apply_telegram_after_save(self) -> None:
        """Restart Telegram with the freshly saved token (T10: save applies).

        Mirrors ``TelegramLifecycleManager.startup_apply()``'s non-raising
        contract: an apply failure stays captured in the manager's own
        lifecycle status (``lastError``) and must never fail the save
        response -- the panel re-reads status on its next automatic refresh.
        """
        try:
            self.telegram_manager.apply()
        except TelegramLifecycleError:
            pass

    def _apply_channel_a_after_save(self) -> None:
        """Restart Channel A with the freshly saved token (T10: save applies).

        Same non-raising contract as ``_apply_telegram_after_save``: a failure
        is already captured inside the manager's own status by ``apply()``.
        """
        try:
            self.channel_a_manager.apply()
        except ChannelAManagerError:
            pass

    def _channel_a_credential_write(self, provider: str, secret: str):
        """Save Channel A through the manager, then apply the new credential."""
        unavailable = self._require_channel_a_manager()
        if unavailable:
            return unavailable
        try:
            self.channel_a_manager.save_credential(secret)
        except ChannelAManagerError as error:
            return self._channel_a_manager_error(error)
        self._apply_channel_a_after_save()
        self._reset_verification_if_applicable(CHANNEL_A_PROVIDER)
        response = jsonify({"ok": True, "provider": provider, "configured": True})
        response.headers["Cache-Control"] = "no-store"
        return response

    def _channel_a_credential_delete(self):
        """Delete Channel A through the manager; 204 only on confirmed success."""
        unavailable = self._require_channel_a_manager()
        if unavailable:
            return unavailable
        try:
            self.channel_a_manager.delete_credential()
        except ChannelAManagerError as error:
            return self._channel_a_manager_error(error)
        self._reset_verification_if_applicable(CHANNEL_A_PROVIDER)
        response = Response(status=204)
        response.headers["Cache-Control"] = "no-store"
        return response

    @staticmethod
    def _error(code: str, status: int):
        response = jsonify({"ok": False, "error": code})
        response.status_code = status
        response.headers["Cache-Control"] = "no-store"
        return response

    def _client_source(self) -> str:
        """Client address used as the login/password-change rate-limit source.

        Behind nginx every peer is loopback, so ``remote_addr`` alone would put all clients in one
        budget. ``X-Real-IP`` (set, not appended, by nginx) is trusted only when the TCP peer is
        loopback, a valid production origin is configured, and the value is exactly one IP address;
        anything else falls back to the peer address (dev with Vite keeps working unchanged).
        """
        peer = request.remote_addr or ""
        if not (self.transport.valid and self.transport.public_origin):
            return peer
        try:
            if not ipaddress.ip_address(peer).is_loopback:
                return peer
        except ValueError:
            return peer
        header = request.headers.get("X-Real-IP", "")
        if not header or len(header) > MAX_CLIENT_ADDRESS_CHARACTERS or header != header.strip():
            return peer
        try:
            return str(ipaddress.ip_address(header))
        except ValueError:
            return peer

    def _allow(self, *, require_origin: bool):
        if not self.transport.valid:
            return self._error("AUTH_CONFIGURATION_INVALID", 503)
        if not self.transport.allows(
            remote_addr=request.remote_addr,
            host=request.host,
            origin=request.headers.get("Origin"),
            require_origin=require_origin,
        ):
            return self._error("AUTH_TRANSPORT_REJECTED", 403)
        return None

    def _unauthenticated(self):
        """401 for a request without a live session.

        A session that was displaced by another login (takeover) answers with its own code so the
        client can say so; every other cause (no cookie, expiry, logout, reset) stays generic.
        """
        try:
            replaced = self.auth_service.was_session_replaced(request.cookies.get(COOKIE_NAME, ""))
        except AuthUnavailable:
            replaced = False  # the lookup is best-effort: an unauthenticated 401 never becomes a 503
        if not replaced:
            return self._error("AUTHENTICATION_REQUIRED", 401)
        response = self._error("ADMIN_SESSION_REPLACED", 401)
        self._expire_session_cookie(response)  # the displaced browser is told once, not on every request
        return response

    def _expire_session_cookie(self, response) -> None:
        response.delete_cookie(COOKIE_NAME, path=COOKIE_PATH, secure=self.transport.secure_cookie, httponly=True, samesite="Strict")

    def _authorized_session(self, *, require_csrf: bool):
        try:
            session = self.auth_service.read_session(request.cookies.get(COOKIE_NAME, ""))
        except AuthUnavailable:
            return None, self._error("AUTH_STORAGE_UNAVAILABLE", 503)
        if session is None:
            return None, self._unauthenticated()
        if require_csrf:
            supplied = request.headers.get("X-CSRF-Token", "")
            expected = getattr(session, "csrf_token", None)
            try:
                supplied_bytes = supplied.encode("ascii")
                expected_bytes = expected.encode("ascii") if isinstance(expected, str) else b""
            except UnicodeEncodeError:
                return None, self._error("CSRF_VALIDATION_FAILED", 403)
            if not supplied_bytes or not expected_bytes or not hmac.compare_digest(supplied_bytes, expected_bytes):
                return None, self._error("CSRF_VALIDATION_FAILED", 403)
        return session, None

    def _credential_payload(self):
        if not request.is_json:
            return None, self._error("JSON_REQUIRED", 415)
        # The wire limit bounds parsing independently from the decoded 4096-byte
        # secret limit. Six bytes covers JSON's longest single-byte escape.
        if request.content_length is None or request.content_length > MAX_CREDENTIAL_REQUEST_BYTES:
            return None, self._error("CREDENTIAL_REQUEST_TOO_LARGE", 413)
        try:
            payload = json.loads(request.get_data(cache=False).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None, self._error("INVALID_CREDENTIAL_REQUEST", 400)
        if not isinstance(payload, dict) or set(payload) != {"secret"} or not isinstance(payload["secret"], str):
            return None, self._error("INVALID_CREDENTIAL_REQUEST", 400)
        secret = payload["secret"]
        try:
            encoded = secret.encode("utf-8")
        except UnicodeEncodeError:
            return None, self._error("INVALID_CREDENTIAL_REQUEST", 400)
        if not secret.strip() or len(encoded) > MAX_SECRET_BYTES:
            return None, self._error("INVALID_CREDENTIAL_REQUEST", 400)
        return secret, None

    def _hmi_config_batch(self):
        """Parse ``{"set": {key: str}, "delete": [key]}``; both members optional."""
        if not request.is_json:
            return None, self._error("JSON_REQUIRED", 415)
        if request.content_length is None or request.content_length > MAX_HMI_CONFIG_REQUEST_BYTES:
            return None, self._error("HMI_CONFIG_REQUEST_TOO_LARGE", 413)
        try:
            payload = json.loads(request.get_data(cache=False).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None, self._error("HMI_CONFIG_INVALID_REQUEST", 400)
        if not isinstance(payload, dict) or not set(payload) <= {"set", "delete"}:
            return None, self._error("HMI_CONFIG_INVALID_REQUEST", 400)
        sets, deletes = payload.get("set", {}), payload.get("delete", [])
        if not isinstance(sets, dict) or not isinstance(deletes, list):
            return None, self._error("HMI_CONFIG_INVALID_REQUEST", 400)
        return (sets, deletes), None

    def _hmi_config_read(self, read):
        """Public read of the shared document: transport checks only, no session."""
        rejected = self._allow(require_origin=False)
        if rejected:
            return rejected
        if self.hmi_config_store is None:
            return self._error("HMI_CONFIG_UNAVAILABLE", 503)
        try:
            response = jsonify({"ok": True, **read(self.hmi_config_store)})
        except HmiConfigUnavailable:
            return self._error("HMI_CONFIG_UNAVAILABLE", 503)
        response.headers["Cache-Control"] = "no-store"
        return response

    def register(self, app) -> None:
        @app.get(HMI_CONFIG_READ_ROUTE)
        def hmi_config_document():
            def read(store):
                revision, items = store.read_document()
                return {"revision": revision, "items": items}

            return self._hmi_config_read(read)

        @app.get(HMI_CONFIG_REVISION_ROUTE)
        def hmi_config_revision():
            return self._hmi_config_read(lambda store: {"revision": store.read_revision()})

        @app.put(HMI_CONFIG_WRITE_ROUTE)
        def hmi_config_write():
            rejected = self._allow(require_origin=True)
            if rejected:
                return rejected
            _, rejected = self._authorized_session(require_csrf=True)
            if rejected:
                return rejected
            if self.hmi_config_store is None:
                return self._error("HMI_CONFIG_UNAVAILABLE", 503)
            batch, rejected = self._hmi_config_batch()
            if rejected:
                return rejected
            try:
                revision = self.hmi_config_store.apply_batch(*batch)
            except HmiConfigInvalid:
                return self._error("HMI_CONFIG_INVALID_REQUEST", 400)
            except HmiConfigTooLarge as error:
                return self._error(error.args[0], 413)
            except HmiConfigUnavailable:
                return self._error("HMI_CONFIG_UNAVAILABLE", 503)
            response = jsonify({"ok": True, "revision": revision})
            response.headers["Cache-Control"] = "no-store"
            return response

        @app.after_request
        def credential_cache_policy(response):
            path = request.path
            provider_path = path.startswith(f"{CREDENTIAL_ROUTE_ROOT}/") and "/" not in path[
                len(CREDENTIAL_ROUTE_ROOT) + 1 :
            ]
            if (
                path == CREDENTIAL_ROUTE_ROOT
                or provider_path
                or path == TELEGRAM_APPLY_ROUTE
                or path == GEMINI_VERIFY_ROUTE
                or path == TELEGRAM_VERIFY_ROUTE
                or path in (CHANNEL_A_STATUS_ROUTE, CHANNEL_A_APPLY_ROUTE, CHANNEL_A_VERIFY_ROUTE)
            ):
                response.headers["Cache-Control"] = "no-store"
            return response

        @app.get("/api/leda/admin/auth/status")
        def admin_auth_status():
            rejected = self._allow(require_origin=False)
            if rejected:
                return rejected
            try:
                return jsonify({"configured": self.auth_service.is_configured()})
            except AuthUnavailable:
                return self._error("AUTH_STORAGE_UNAVAILABLE", 503)

        @app.post("/api/leda/admin/auth/login")
        def admin_auth_login():
            rejected = self._allow(require_origin=True)
            if rejected:
                return rejected
            if not request.is_json:
                return self._error("JSON_REQUIRED", 415)
            payload = request.get_json(silent=True)
            if not isinstance(payload, dict):
                return self._error("INVALID_LOGIN_REQUEST", 400)
            username = payload.get("username")
            password = payload.get("password")
            takeover = payload.get("takeover", False)
            if not isinstance(username, str) or not isinstance(password, str) or not isinstance(takeover, bool):
                return self._error("INVALID_LOGIN_REQUEST", 400)
            try:
                session = self.auth_service.login(username, password, self._client_source(), takeover=takeover)
            except AuthNotConfigured:
                return self._error("AUTH_NOT_CONFIGURED", 503)
            except LoginRateLimited:
                return self._error("LOGIN_RATE_LIMITED", 429)
            except AdminSessionActiveElsewhere:
                return self._error("ADMIN_SESSION_ACTIVE_ELSEWHERE", 409)
            except AuthUnavailable:
                return self._error("AUTH_STORAGE_UNAVAILABLE", 503)
            except ValueError:
                session = None
            if session is None:
                return self._error("INVALID_CREDENTIALS", 401)
            response = jsonify(self._session_payload(session))
            response.headers["Cache-Control"] = "no-store"
            response.set_cookie(
                COOKIE_NAME,
                session.session_id,
                secure=self.transport.secure_cookie,
                httponly=True,
                samesite="Strict",
                path=COOKIE_PATH,
            )
            return response

        @app.get("/api/leda/admin/auth/session")
        def admin_auth_session():
            rejected = self._allow(require_origin=False)
            if rejected:
                return rejected
            try:
                session = self.auth_service.read_session(request.cookies.get(COOKIE_NAME, ""))
            except AuthUnavailable:
                return self._error("AUTH_STORAGE_UNAVAILABLE", 503)
            if session is None:
                return self._unauthenticated()
            response = jsonify(self._session_payload(session))
            response.headers["Cache-Control"] = "no-store"
            return response

        @app.post("/api/leda/admin/auth/logout")
        def admin_auth_logout():
            rejected = self._allow(require_origin=True)
            if rejected:
                return rejected
            try:
                revoked = self.auth_service.revoke_session(
                    request.cookies.get(COOKIE_NAME, ""), request.headers.get("X-CSRF-Token", "")
                )
            except AuthUnavailable:
                return self._error("AUTH_STORAGE_UNAVAILABLE", 503)
            if not revoked:
                return self._error("CSRF_VALIDATION_FAILED", 403)
            response = Response(status=204)
            self._expire_session_cookie(response)
            response.headers["Cache-Control"] = "no-store"
            return response

        @app.post(PASSWORD_CHANGE_ROUTE)
        def admin_auth_password():
            """The administrator changes their own password; the calling session stays valid."""
            rejected = self._allow(require_origin=True)
            if rejected:
                return rejected
            session, rejected = self._authorized_session(require_csrf=True)
            if rejected:
                return rejected
            if not request.is_json:
                return self._error("JSON_REQUIRED", 415)
            if request.content_length is None or request.content_length > MAX_PASSWORD_CHANGE_REQUEST_BYTES:
                return self._error("PASSWORD_CHANGE_REQUEST_TOO_LARGE", 413)
            payload = request.get_json(silent=True)
            if (
                not isinstance(payload, dict)
                or set(payload) != {"currentPassword", "newPassword"}
                or not isinstance(payload["currentPassword"], str)
                or not isinstance(payload["newPassword"], str)
            ):
                return self._error("INVALID_PASSWORD_CHANGE_REQUEST", 400)
            try:
                outcome = self.auth_service.change_password(
                    session.session_id, payload["currentPassword"], payload["newPassword"], self._client_source()
                )
            except PasswordPolicyError as error:
                return self._error(str(error), 400)
            except LoginRateLimited:
                return self._error("LOGIN_RATE_LIMITED", 429)
            except AuthNotConfigured:
                return self._error("AUTH_NOT_CONFIGURED", 503)
            except AuthUnavailable:
                return self._error("AUTH_STORAGE_UNAVAILABLE", 503)
            if outcome is PasswordChange.WRONG_CURRENT_PASSWORD:
                return self._error("INVALID_CURRENT_PASSWORD", 401)
            if outcome is PasswordChange.SESSION_ENDED:
                return self._error("AUTHENTICATION_REQUIRED", 401)
            response = jsonify({"ok": True})
            response.headers["Cache-Control"] = "no-store"
            return response

        @app.get("/api/leda/admin/credentials")
        def admin_credentials_status():
            rejected = self._allow(require_origin=False)
            if rejected:
                return rejected
            _, rejected = self._authorized_session(require_csrf=False)
            if rejected:
                return rejected
            try:
                if self.credential_service is None:
                    raise CredentialUnavailable("CREDENTIAL_STORAGE_UNAVAILABLE")
                status = self.credential_service.status()
                response = jsonify(
                    {
                        "ok": True,
                        "providers": {
                            provider: self._provider_metadata(provider, bool(status[provider]))
                            for provider in ALLOWED_PROVIDERS
                        },
                    }
                )
                response.headers["Cache-Control"] = "no-store"
                return response
            except (CredentialUnavailable, KeyError, TypeError):
                return self._error("CREDENTIAL_STORAGE_UNAVAILABLE", 503)

        @app.put("/api/leda/admin/credentials/<provider>")
        def admin_credentials_set(provider: str):
            rejected = self._allow(require_origin=True)
            if rejected:
                return rejected
            _, rejected = self._authorized_session(require_csrf=True)
            if rejected:
                return rejected
            if provider not in ALLOWED_PROVIDERS:
                return self._error("CREDENTIAL_PROVIDER_UNSUPPORTED", 404)
            secret, rejected = self._credential_payload()
            if rejected:
                return rejected
            if provider == CHANNEL_A_PROVIDER:
                return self._channel_a_credential_write(provider, secret)
            try:
                if self.credential_service is None:
                    raise CredentialUnavailable("CREDENTIAL_STORAGE_UNAVAILABLE")
                if provider == "telegram" and self.telegram_manager is not None:
                    self.telegram_manager.set_secret(secret)
                    self._apply_telegram_after_save()
                else:
                    self.credential_service.set_secret(provider, secret)
                self._reset_verification_if_applicable(provider)
                response = jsonify({"ok": True, "provider": provider, "configured": True})
                response.headers["Cache-Control"] = "no-store"
                return response
            except InvalidCredential:
                return self._error("INVALID_CREDENTIAL_REQUEST", 400)
            except CredentialUnavailable:
                return self._error("CREDENTIAL_STORAGE_UNAVAILABLE", 503)

        @app.delete("/api/leda/admin/credentials/<provider>")
        def admin_credentials_delete(provider: str):
            rejected = self._allow(require_origin=True)
            if rejected:
                return rejected
            _, rejected = self._authorized_session(require_csrf=True)
            if rejected:
                return rejected
            if provider not in ALLOWED_PROVIDERS:
                return self._error("CREDENTIAL_PROVIDER_UNSUPPORTED", 404)
            if provider == CHANNEL_A_PROVIDER:
                return self._channel_a_credential_delete()
            try:
                if self.credential_service is None:
                    raise CredentialUnavailable("CREDENTIAL_STORAGE_UNAVAILABLE")
                if provider == "telegram" and self.telegram_manager is not None:
                    if not self.telegram_manager.delete_secret():
                        return self._error("TELEGRAM_STOP_TIMEOUT", 409)
                else:
                    self.credential_service.delete_secret(provider)
                self._reset_verification_if_applicable(provider)
                response = Response(status=204)
                response.headers["Cache-Control"] = "no-store"
                return response
            except CredentialUnavailable:
                return self._error("CREDENTIAL_STORAGE_UNAVAILABLE", 503)

        @app.post(GEMINI_VERIFY_ROUTE)
        def admin_gemini_verify():
            """Explicit, admin-authenticated, non-generating Gemini key check.

            Same auth/origin/CSRF pattern as the credential PUT/DELETE routes.
            Never echoes the secret or raw provider error text; the service
            itself only ever returns a closed state classification.
            """
            rejected = self._allow(require_origin=True)
            if rejected:
                return rejected
            _, rejected = self._authorized_session(require_csrf=True)
            if rejected:
                return rejected
            if self.gemini_verification_service is None:
                return self._error("GEMINI_VERIFICATION_UNAVAILABLE", 503)
            try:
                result = self.gemini_verification_service.verify()
            except GeminiVerificationInProgress:
                return self._error("GEMINI_VERIFICATION_IN_PROGRESS", 409)
            try:
                configured = bool(self.credential_service.status()["gemini"]) if self.credential_service is not None else False
            except (CredentialUnavailable, KeyError, TypeError):
                configured = False
            verification = {"state": result.state, "checkedAt": result.checked_at}
            response = jsonify({
                "ok": True,
                "gemini": {
                    "configured": configured,
                    "verified": result.state == "verified",
                    "verification": verification,
                    "model": GEMINI_VERIFY_MODEL,
                },
            })
            response.headers["Cache-Control"] = "no-store"
            return response

        def _telegram_family_verify(*, service, in_progress_code, unavailable_code, provider, key):
            """Shared body for both Telegram-family verify routes (T13).

            Same auth/origin/CSRF pattern and non-leaking contract as Gemini's
            verify route; never starts, stops or restarts the bot, and never
            reads or advances its update offset -- the composed service only
            ever performs one non-sending ``getMe`` call.
            """
            rejected = self._allow(require_origin=True)
            if rejected:
                return rejected
            _, rejected = self._authorized_session(require_csrf=True)
            if rejected:
                return rejected
            if service is None:
                return self._error(unavailable_code, 503)
            try:
                result = service.verify()
            except TelegramTokenVerificationInProgress:
                return self._error(in_progress_code, 409)
            try:
                configured = bool(self.credential_service.status()[provider]) if self.credential_service is not None else False
            except (CredentialUnavailable, KeyError, TypeError):
                configured = False
            verification = {"state": result.state, "checkedAt": result.checked_at, "username": result.username}
            response = jsonify({
                "ok": True,
                key: {"configured": configured, "verified": result.state == "verified", "verification": verification},
            })
            response.headers["Cache-Control"] = "no-store"
            return response

        @app.post(TELEGRAM_VERIFY_ROUTE)
        def admin_telegram_verify():
            """Explicit, admin-authenticated, non-sending Telegram (Canal B)
            bot token check: one ``getMe`` call, never ``getUpdates`` or a
            send."""
            return _telegram_family_verify(
                service=self.telegram_verification_service,
                in_progress_code="TELEGRAM_VERIFICATION_IN_PROGRESS",
                unavailable_code="TELEGRAM_VERIFICATION_UNAVAILABLE",
                provider="telegram",
                key="telegram",
            )

        @app.post(CHANNEL_A_VERIFY_ROUTE)
        def admin_channel_a_verify():
            """Same non-sending Telegram token check for Channel A. Deliberately
            independent of ``channel_a_manager``: verification never touches
            manager mutation state (busy lock, activation, generations)."""
            return _telegram_family_verify(
                service=self.channel_a_verification_service,
                in_progress_code="LEDA_CHANNEL_A_VERIFICATION_IN_PROGRESS",
                unavailable_code="LEDA_CHANNEL_A_VERIFICATION_UNAVAILABLE",
                provider=CHANNEL_A_PROVIDER,
                key="channelA",
            )

        @app.post(TELEGRAM_APPLY_ROUTE)
        def admin_telegram_apply():
            rejected = self._allow(require_origin=True)
            if rejected:
                return rejected
            _, rejected = self._authorized_session(require_csrf=True)
            if rejected:
                return rejected
            if not request.is_json:
                return self._error("JSON_REQUIRED", 415)
            if request.content_length is None or request.content_length > MAX_TELEGRAM_APPLY_REQUEST_BYTES:
                return self._error("TELEGRAM_APPLY_REQUEST_TOO_LARGE", 413)
            try:
                payload = json.loads(request.get_data(cache=False).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                return self._error("INVALID_TELEGRAM_APPLY_REQUEST", 400)
            if not isinstance(payload, dict) or payload:
                return self._error("INVALID_TELEGRAM_APPLY_REQUEST", 400)
            if self.telegram_manager is None:
                return self._error("TELEGRAM_PROVIDER_UNAVAILABLE", 502)
            try:
                status = self.telegram_manager.apply()
                response = jsonify({"ok": True, "telegram": project_admin_telegram_status(status)})
                response.headers["Cache-Control"] = "no-store"
                return response
            except TelegramLifecycleError as error:
                code = error.args[0]
                status_code = {
                    "TELEGRAM_DISABLED": 409,
                    "TELEGRAM_CREDENTIAL_MISSING": 409,
                    "TELEGRAM_STOP_TIMEOUT": 409,
                    TELEGRAM_BOT_IDENTITY_RESERVED: 409,
                    "CREDENTIAL_STORAGE_UNAVAILABLE": 503,
                    "TELEGRAM_PROVIDER_UNAVAILABLE": 502,
                }.get(code, 502)
                public_code = code if code in {
                    "TELEGRAM_DISABLED",
                    "TELEGRAM_CREDENTIAL_MISSING",
                    "TELEGRAM_STOP_TIMEOUT",
                    TELEGRAM_BOT_IDENTITY_RESERVED,
                    "CREDENTIAL_STORAGE_UNAVAILABLE",
                    "TELEGRAM_PROVIDER_UNAVAILABLE",
                } else "TELEGRAM_PROVIDER_UNAVAILABLE"
                response = jsonify({"ok": False, "error": public_code, "telegram": project_admin_telegram_status(self.telegram_manager.status())})
                response.status_code = status_code
                response.headers["Cache-Control"] = "no-store"
                return response

        @app.get(CHANNEL_A_STATUS_ROUTE)
        def admin_channel_a_status():
            """Observational Channel A status: authenticated read only, never a
            validate, activate or store probe."""
            rejected = self._allow(require_origin=False)
            if rejected:
                return rejected
            _, rejected = self._authorized_session(require_csrf=False)
            if rejected:
                return rejected
            unavailable = self._require_channel_a_manager()
            if unavailable:
                return unavailable
            try:
                status = self.channel_a_manager.status()
            except ChannelAManagerError as error:
                return self._channel_a_manager_error(error)
            response = jsonify({"ok": True, "channelA": project_admin_channel_a_status(status)})
            response.headers["Cache-Control"] = "no-store"
            return response

        @app.post(CHANNEL_A_APPLY_ROUTE)
        def admin_channel_a_apply():
            """The only explicit Channel A activation entry: the same auth,
            origin, CSRF and empty-JSON-object bound as the Telegram Apply."""
            rejected = self._allow(require_origin=True)
            if rejected:
                return rejected
            _, rejected = self._authorized_session(require_csrf=True)
            if rejected:
                return rejected
            if not request.is_json:
                return self._error("JSON_REQUIRED", 415)
            if request.content_length is None or request.content_length > MAX_TELEGRAM_APPLY_REQUEST_BYTES:
                return self._error("TELEGRAM_APPLY_REQUEST_TOO_LARGE", 413)
            try:
                payload = json.loads(request.get_data(cache=False).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                return self._error("INVALID_TELEGRAM_APPLY_REQUEST", 400)
            if not isinstance(payload, dict) or payload:
                return self._error("INVALID_TELEGRAM_APPLY_REQUEST", 400)
            unavailable = self._require_channel_a_manager()
            if unavailable:
                return unavailable
            try:
                status = self.channel_a_manager.apply()
            except ChannelAManagerError as error:
                return self._channel_a_manager_error(error)
            response = jsonify({"ok": True, "channelA": project_admin_channel_a_status(status)})
            response.headers["Cache-Control"] = "no-store"
            return response

    @staticmethod
    def _session_payload(session) -> dict:
        return {
            "ok": True,
            "administrator": {"username": session.username},
            "csrfToken": session.csrf_token,
            "absoluteExpiresAt": session.absolute_expires_at,
        }
