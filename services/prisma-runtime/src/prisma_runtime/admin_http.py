"""Flask boundary for Prisma administrator authentication and credentials."""

from __future__ import annotations

import ipaddress
import hmac
import json
from dataclasses import dataclass
from urllib.parse import urlsplit

from flask import Response, jsonify, request

from .admin_auth import AuthNotConfigured, AuthUnavailable, LoginRateLimited
from .bot_identity_reservation import TELEGRAM_BOT_IDENTITY_RESERVED
from .channel_a_lifecycle import PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE
from .channel_a_manager import ChannelAManagerError
from .credential_store import ALLOWED_PROVIDERS, MAX_SECRET_BYTES, CredentialUnavailable, InvalidCredential
from .telegram_lifecycle import TelegramLifecycleError


COOKIE_NAME = "prisma_admin_session"
COOKIE_PATH = "/api/prisma/admin"
LOCAL_ORIGINS = {"http://127.0.0.1:5173", "http://localhost:5173"}
CREDENTIAL_ROUTE_ROOT = "/api/prisma/admin/credentials"
MAX_JSON_ESCAPE_BYTES_PER_SECRET_BYTE = 6
MAX_CREDENTIAL_JSON_OVERHEAD_BYTES = 1024
MAX_CREDENTIAL_REQUEST_BYTES = (
    MAX_SECRET_BYTES * MAX_JSON_ESCAPE_BYTES_PER_SECRET_BYTE + MAX_CREDENTIAL_JSON_OVERHEAD_BYTES
)
MAX_TELEGRAM_APPLY_REQUEST_BYTES = 128
TELEGRAM_APPLY_ROUTE = "/api/prisma/admin/credentials/telegram/apply"
CHANNEL_A_PROVIDER = "telegram_channel_a"
CHANNEL_A_STATUS_ROUTE = f"{CREDENTIAL_ROUTE_ROOT}/{CHANNEL_A_PROVIDER}/status"
CHANNEL_A_APPLY_ROUTE = f"{CREDENTIAL_ROUTE_ROOT}/{CHANNEL_A_PROVIDER}/apply"
# Closed refusal for every Channel A route when no manager was composed into
# this boundary: no direct-store fallback exists for Channel A (approved user
# decision), and the report must stay independent of store availability.
PRISMA_CHANNEL_A_MANAGER_UNAVAILABLE = "PRISMA_CHANNEL_A_MANAGER_UNAVAILABLE"
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
)


def project_admin_telegram_status(status: dict) -> dict:
    """Copy only the nine admin contract fields out of lifecycle status.

    Manager status also carries internal telemetry (``telegramDiagnostic``)
    consumed by public health; the admin route must not widen its contract with
    it. Copying keeps the manager-owned status object untouched.
    """
    return {field: status[field] for field in ADMIN_TELEGRAM_STATUS_FIELDS}


# Frozen admin Channel A wire contract: exactly six status keys with a nested
# activation projection; no raw manager object or credential is ever exposed.
ADMIN_CHANNEL_A_STATUS_FIELDS = (
    "configured",
    "desiredGeneration",
    "appliedGeneration",
    "activationEpoch",
    "activation",
    "lastError",
)


def project_admin_channel_a_status(status: dict) -> dict:
    """Copy only the six admin contract fields out of manager-owned status.

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
    "PRISMA_CHANNEL_A_MANAGER_BUSY": 409,
    "PRISMA_CHANNEL_A_CREDENTIAL_MISSING": 409,
    "PRISMA_CHANNEL_A_RESTART_REQUIRED": 409,
    "PRISMA_CHANNEL_A_STOP_UNCONFIRMED": 409,
    TELEGRAM_BOT_IDENTITY_RESERVED: 409,
    "PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE": 503,
    "PRISMA_CHANNEL_A_CONFIGURATION_UNAVAILABLE": 503,
    "PRISMA_CHANNEL_A_CONFIGURATION_INVALID": 503,
    PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE: 502,
}


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
    def __init__(self, auth_service, *, credential_service=None, telegram_manager=None, channel_a_manager=None, public_origin: str | None = None):
        self.auth_service = auth_service
        self.credential_service = credential_service
        self.telegram_manager = telegram_manager
        self.channel_a_manager = channel_a_manager
        self.transport = TransportPolicy.build(public_origin)

    def _channel_a_manager_error(self, error):
        """Map a closed manager error through the frozen allowlist."""
        code = error.args[0] if error.args else None
        status = CHANNEL_A_MANAGER_ERROR_STATUS.get(code) if isinstance(code, str) else None
        if status is None:
            return self._error(PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE, 502)
        return self._error(code, status)

    def _require_channel_a_manager(self):
        """Refuse every Channel A route without a composed manager, regardless
        of protected-store availability; there is no direct-store fallback."""
        if self.channel_a_manager is None:
            return self._error(PRISMA_CHANNEL_A_MANAGER_UNAVAILABLE, 503)
        return None

    def _channel_a_credential_write(self, provider: str, secret: str):
        """Save Channel A through the manager's generation accounting only."""
        unavailable = self._require_channel_a_manager()
        if unavailable:
            return unavailable
        try:
            self.channel_a_manager.save_credential(secret)
        except ChannelAManagerError as error:
            return self._channel_a_manager_error(error)
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
        response = Response(status=204)
        response.headers["Cache-Control"] = "no-store"
        return response

    @staticmethod
    def _error(code: str, status: int):
        response = jsonify({"ok": False, "error": code})
        response.status_code = status
        response.headers["Cache-Control"] = "no-store"
        return response

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

    def _authorized_session(self, *, require_csrf: bool):
        try:
            session = self.auth_service.read_session(request.cookies.get(COOKIE_NAME, ""))
        except AuthUnavailable:
            return None, self._error("AUTH_STORAGE_UNAVAILABLE", 503)
        if session is None:
            return None, self._error("AUTHENTICATION_REQUIRED", 401)
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

    def register(self, app) -> None:
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
                or path in (CHANNEL_A_STATUS_ROUTE, CHANNEL_A_APPLY_ROUTE)
            ):
                response.headers["Cache-Control"] = "no-store"
            return response

        @app.get("/api/prisma/admin/auth/status")
        def admin_auth_status():
            rejected = self._allow(require_origin=False)
            if rejected:
                return rejected
            try:
                return jsonify({"configured": self.auth_service.is_configured()})
            except AuthUnavailable:
                return self._error("AUTH_STORAGE_UNAVAILABLE", 503)

        @app.post("/api/prisma/admin/auth/login")
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
            if not isinstance(username, str) or not isinstance(password, str):
                return self._error("INVALID_LOGIN_REQUEST", 400)
            try:
                session = self.auth_service.login(username, password, request.remote_addr or "")
            except AuthNotConfigured:
                return self._error("AUTH_NOT_CONFIGURED", 503)
            except LoginRateLimited:
                return self._error("LOGIN_RATE_LIMITED", 429)
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

        @app.get("/api/prisma/admin/auth/session")
        def admin_auth_session():
            rejected = self._allow(require_origin=False)
            if rejected:
                return rejected
            try:
                session = self.auth_service.read_session(request.cookies.get(COOKIE_NAME, ""))
            except AuthUnavailable:
                return self._error("AUTH_STORAGE_UNAVAILABLE", 503)
            if session is None:
                return self._error("AUTHENTICATION_REQUIRED", 401)
            response = jsonify(self._session_payload(session))
            response.headers["Cache-Control"] = "no-store"
            return response

        @app.post("/api/prisma/admin/auth/logout")
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
            response.delete_cookie(COOKIE_NAME, path=COOKIE_PATH, secure=self.transport.secure_cookie, httponly=True, samesite="Strict")
            response.headers["Cache-Control"] = "no-store"
            return response

        @app.get("/api/prisma/admin/credentials")
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
                    {"ok": True, "providers": {provider: {"configured": bool(status[provider])} for provider in ALLOWED_PROVIDERS}}
                )
                response.headers["Cache-Control"] = "no-store"
                return response
            except (CredentialUnavailable, KeyError, TypeError):
                return self._error("CREDENTIAL_STORAGE_UNAVAILABLE", 503)

        @app.put("/api/prisma/admin/credentials/<provider>")
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
                else:
                    self.credential_service.set_secret(provider, secret)
                response = jsonify({"ok": True, "provider": provider, "configured": True})
                response.headers["Cache-Control"] = "no-store"
                return response
            except InvalidCredential:
                return self._error("INVALID_CREDENTIAL_REQUEST", 400)
            except CredentialUnavailable:
                return self._error("CREDENTIAL_STORAGE_UNAVAILABLE", 503)

        @app.delete("/api/prisma/admin/credentials/<provider>")
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
                response = Response(status=204)
                response.headers["Cache-Control"] = "no-store"
                return response
            except CredentialUnavailable:
                return self._error("CREDENTIAL_STORAGE_UNAVAILABLE", 503)

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
