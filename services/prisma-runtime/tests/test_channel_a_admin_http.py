"""RCA-5j-2 focused contract: Channel A administration at the admin HTTP boundary.

What this file pins down
------------------------

* Channel A credential PUT/DELETE route through the injected ``ChannelAManager``
  (``save_credential`` / ``delete_credential``) and never through the protected
  ``CredentialService`` directly.
* A boundary without a Channel A manager refuses every A route with the closed
  ``PRISMA_CHANNEL_A_MANAGER_UNAVAILABLE`` / 503 code and performs no direct
  store mutation (approved user decision).
* The dedicated ``GET .../telegram_channel_a/status`` route is authenticated and
  observational, and the ``POST .../telegram_channel_a/apply`` route is
  authenticated plus origin/CSRF protected. Both reject before any manager call.
* Apply accepts only an empty JSON object inside the reused 128-byte bound.
* Status and Apply success return ``{ok: true, channelA: <projection>}`` with
  exactly the six frozen fields and a nested activation projection
  (``phase``, ``reason``, ``quiescent``, ``restartRequired``), never a raw object.
* Every manager domain error maps to a closed ``{ok: false, error}`` body and a
  fixed status, with no second ``status()`` call; an unknown manager error
  sanitizes to lifecycle unavailable / 502.
* Every A route, including options and method errors, is ``Cache-Control:
  no-store`` without widening to lookalike paths.
* Channel B Apply keeps its exact nine-field wire even when a Channel A manager
  is present on the same boundary.

Containment
-----------

``requests.Session.request``, ``requests.adapters.HTTPAdapter.send`` and
``threading.Thread.start`` are recorded and refused before any lazy production
import, and the zero-attempt claim is asserted externally after every test. The
boundary is registered on a minimal Flask app; there are no sockets, no
providers, no real credentials or runtime state, no native workers and no
auxiliary harness imports. Channel A and Channel B managers and the protected
store are inert doubles.
"""

from __future__ import annotations

import sys
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, call, patch

import requests
import requests.adapters

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

A_PROVIDER = "telegram_channel_a"
A_ROUTE = f"/api/prisma/admin/credentials/{A_PROVIDER}"
A_STATUS_ROUTE = f"{A_ROUTE}/status"
A_APPLY_ROUTE = f"{A_ROUTE}/apply"
TELEGRAM_APPLY_ROUTE = "/api/prisma/admin/credentials/telegram/apply"

SECRET = "  synthetic-秘密-channel-a-token  "
INTERNAL_CANARY = "CANARY-internal-channel-a-diagnostic"
MANAGER_UNAVAILABLE = "PRISMA_CHANNEL_A_MANAGER_UNAVAILABLE"
LIFECYCLE_UNAVAILABLE = "PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE"

# Exact admin Channel A contract frozen by the tracker: six status keys with a
# nested activation projection and no additional key.
ADMIN_CHANNEL_A_FIELDS = frozenset(
    {"configured", "desiredGeneration", "appliedGeneration", "activationEpoch", "activation", "lastError"}
)
ADMIN_CHANNEL_A_ACTIVATION_FIELDS = frozenset({"phase", "reason", "quiescent", "restartRequired"})

# Frozen nine-field Channel B wire, mirrored from hmi-app/src/domain/adminCredential.types.ts.
ADMIN_TELEGRAM_FIELDS = frozenset(
    {
        "source",
        "enabled",
        "configured",
        "desiredGeneration",
        "appliedGeneration",
        "running",
        "verified",
        "restartRequired",
        "lastError",
    }
)

# Approved manager domain error mapping; the frozen contract names every code.
MANAGER_ERROR_STATUS = {
    "INVALID_CREDENTIAL_REQUEST": 400,
    "PRISMA_CHANNEL_A_MANAGER_BUSY": 409,
    "PRISMA_CHANNEL_A_CREDENTIAL_MISSING": 409,
    "PRISMA_CHANNEL_A_RESTART_REQUIRED": 409,
    "PRISMA_CHANNEL_A_STOP_UNCONFIRMED": 409,
    "TELEGRAM_BOT_IDENTITY_RESERVED": 409,
    "PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE": 503,
    "PRISMA_CHANNEL_A_CONFIGURATION_UNAVAILABLE": 503,
    "PRISMA_CHANNEL_A_CONFIGURATION_INVALID": 503,
    "PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE": 502,
}


class ChannelAAdminHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.forbidden = []

        def refuse(*args, **kwargs):
            self.forbidden.append(1)
            raise AssertionError("OFFLINE_OPERATION_REFUSED")

        # Installed before the lazy production imports below so no import can
        # dispatch a request or start a worker behind the test's back.
        for owner, name in (
            (requests.Session, "request"),
            (requests.adapters.HTTPAdapter, "send"),
            (threading.Thread, "start"),
        ):
            guard = patch.object(owner, name, side_effect=refuse)
            guard.start()
            self.addCleanup(guard.stop)
        self.addCleanup(lambda: self.assertEqual(self.forbidden, []))

        from flask import Flask

        from prisma_runtime.admin_http import AdminHttpBoundary
        from prisma_runtime.channel_a_lifecycle import ChannelAStatus, PHASE_RUNNING
        from prisma_runtime.channel_a_manager import ChannelAManagerError

        self.Flask = Flask
        self.AdminHttpBoundary = AdminHttpBoundary
        self.ChannelAStatus = ChannelAStatus
        self.PHASE_RUNNING = PHASE_RUNNING
        self.ChannelAManagerError = ChannelAManagerError

        self.auth = Mock()
        self.auth.read_session.return_value = SimpleNamespace(csrf_token="csrf-token", username="admin")
        self.auth.is_configured.return_value = True
        self.credentials = Mock()
        self.telegram_manager = Mock()
        self.channel_a = Mock()
        self.channel_a.status.return_value = self.channel_a_status()
        # The real manager returns its status mapping on every successful mutation.
        self.channel_a.save_credential.return_value = self.channel_a_status()
        self.channel_a.delete_credential.return_value = self.channel_a_status()
        self.channel_a.apply.return_value = self.channel_a_status()
        self.environ = {"REMOTE_ADDR": "127.0.0.1", "HTTP_HOST": "localhost"}
        self.headers = {"Origin": "http://localhost:5173", "X-CSRF-Token": "csrf-token"}

    def channel_a_status(self, **overrides):
        """Manager-owned status shape: exactly six keys plus optional extras."""
        status = {
            "configured": True,
            "desiredGeneration": 4,
            "appliedGeneration": 4,
            "activationEpoch": 2,
            "activation": self.ChannelAStatus(
                phase=self.PHASE_RUNNING, reason=None, quiescent=False, restart_required=False
            ),
            "lastError": None,
        }
        status.update(overrides)
        return status

    def build_client(self, *, channel_a=None, telegram=None, auth_service=None):
        app = self.Flask(__name__)
        boundary = self.AdminHttpBoundary(
            auth_service if auth_service is not None else self.auth,
            credential_service=self.credentials,
            telegram_manager=telegram,
            channel_a_manager=channel_a,
        )
        boundary.register(app)
        return app.test_client()

    def test_a_credential_writes_route_through_the_manager_and_never_the_store(self) -> None:
        client = self.build_client(channel_a=self.channel_a, telegram=self.telegram_manager)

        saved = client.put(A_ROUTE, json={"secret": SECRET}, headers=self.headers, environ_overrides=self.environ)

        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.get_json(), {"ok": True, "provider": A_PROVIDER, "configured": True})
        self.assertEqual(saved.headers.get("Cache-Control"), "no-store")
        self.assertNotIn(SECRET, saved.get_data(as_text=True))
        self.channel_a.save_credential.assert_called_once_with(SECRET)
        # Success is exactly the one manager mutation: no automatic apply,
        # status probe or direct store write beyond it.
        self.assertEqual(self.channel_a.mock_calls, [call.save_credential(SECRET)])
        self.assertEqual(self.credentials.mock_calls, [])
        self.assertEqual(self.telegram_manager.mock_calls, [])

        deleted = client.delete(A_ROUTE, headers=self.headers, environ_overrides=self.environ)

        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(deleted.headers.get("Cache-Control"), "no-store")
        self.channel_a.delete_credential.assert_called_once_with()
        self.assertEqual(
            self.channel_a.mock_calls, [call.save_credential(SECRET), call.delete_credential()]
        )
        self.assertEqual(self.credentials.mock_calls, [])
        self.assertEqual(self.telegram_manager.mock_calls, [])

    def test_a_missing_manager_refuses_every_route_without_touching_the_protected_store(self) -> None:
        client = self.build_client(channel_a=None, telegram=self.telegram_manager)
        expected = {"ok": False, "error": MANAGER_UNAVAILABLE}

        attempts = (
            ("put", client.put, A_ROUTE, {"json": {"secret": SECRET}, "headers": self.headers}),
            ("delete", client.delete, A_ROUTE, {"headers": self.headers}),
            ("status", client.get, A_STATUS_ROUTE, {}),
            ("apply", client.post, A_APPLY_ROUTE, {"json": {}, "headers": self.headers}),
        )
        for label, method, path, kwargs in attempts:
            with self.subTest(route=label):
                response = method(path, environ_overrides=self.environ, **kwargs)
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.get_json(), expected)
                self.assertEqual(response.headers.get("Cache-Control"), "no-store")

        self.credentials.set_secret.assert_not_called()
        self.credentials.delete_secret.assert_not_called()
        self.credentials.status.assert_not_called()
        self.assertEqual(self.credentials.mock_calls, [])
        self.assertEqual(self.telegram_manager.mock_calls, [])

    def test_a_write_rejects_missing_origin_and_bad_csrf_before_the_manager(self) -> None:
        client = self.build_client(channel_a=self.channel_a, telegram=self.telegram_manager)

        missing_origin = client.put(
            A_ROUTE, json={"secret": SECRET}, headers={"X-CSRF-Token": "csrf-token"}, environ_overrides=self.environ
        )
        self.assertEqual(missing_origin.status_code, 403)

        for method, token in (("put", None), ("put", "wrong"), ("delete", None), ("delete", "wrong")):
            with self.subTest(method=method, token=token):
                headers = {"Origin": "http://localhost:5173"}
                if token is not None:
                    headers["X-CSRF-Token"] = token
                arguments = {"json": {"secret": SECRET}} if method == "put" else {}
                response = getattr(client, method)(A_ROUTE, headers=headers, environ_overrides=self.environ, **arguments)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.get_json()["error"], "CSRF_VALIDATION_FAILED")

        self.channel_a.save_credential.assert_not_called()
        self.channel_a.delete_credential.assert_not_called()
        self.credentials.set_secret.assert_not_called()
        self.credentials.delete_secret.assert_not_called()

    def test_a_status_get_requires_authentication_and_is_observational(self) -> None:
        unauthenticated = Mock()
        unauthenticated.read_session.return_value = None
        denied_client = self.build_client(
            channel_a=self.channel_a, telegram=self.telegram_manager, auth_service=unauthenticated
        )

        denied = denied_client.get(A_STATUS_ROUTE, environ_overrides=self.environ)
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(denied.get_json()["error"], "AUTHENTICATION_REQUIRED")
        self.assertEqual(denied.headers.get("Cache-Control"), "no-store")
        self.channel_a.status.assert_not_called()
        self.assertEqual(self.credentials.mock_calls, [])
        self.assertEqual(self.telegram_manager.mock_calls, [])

        client = self.build_client(channel_a=self.channel_a, telegram=self.telegram_manager)
        allowed = client.get(A_STATUS_ROUTE, environ_overrides=self.environ)
        self.assertEqual(allowed.status_code, 200)
        self.assertIs(allowed.get_json()["ok"], True)
        # Observational GET: exactly one manager status read, no store and no B.
        self.assertEqual(self.channel_a.mock_calls, [call.status()])
        self.assertEqual(self.credentials.mock_calls, [])
        self.assertEqual(self.telegram_manager.mock_calls, [])

    def test_a_status_projects_exactly_six_fields_with_nested_activation(self) -> None:
        client = self.build_client(channel_a=self.channel_a)
        status = self.channel_a_status(internalDiagnostic={"stage": "poll", "future": INTERNAL_CANARY})
        self.channel_a.status.return_value = status

        response = client.get(A_STATUS_ROUTE, environ_overrides=self.environ)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        payload = response.get_json()
        self.assertEqual(set(payload), {"ok", "channelA"})
        self.assertIs(payload["ok"], True)
        channel_a = payload["channelA"]
        self.assertEqual(set(channel_a), set(ADMIN_CHANNEL_A_FIELDS))
        self.assertIs(channel_a["configured"], True)
        self.assertEqual(channel_a["desiredGeneration"], 4)
        self.assertEqual(channel_a["appliedGeneration"], 4)
        self.assertEqual(channel_a["activationEpoch"], 2)
        self.assertIsNone(channel_a["lastError"])
        self.assertEqual(set(channel_a["activation"]), set(ADMIN_CHANNEL_A_ACTIVATION_FIELDS))
        self.assertEqual(
            channel_a["activation"],
            {"phase": self.PHASE_RUNNING, "reason": None, "quiescent": False, "restartRequired": False},
        )
        self.assertNotIn(INTERNAL_CANARY, response.get_data(as_text=True))
        # The projection copies manager-owned state and never mutates it.
        self.assertEqual(status["internalDiagnostic"], {"stage": "poll", "future": INTERNAL_CANARY})
        self.assertEqual(set(status), set(ADMIN_CHANNEL_A_FIELDS) | {"internalDiagnostic"})

        # Activation is nullable in the frozen contract.
        self.channel_a.status.return_value = self.channel_a_status(activation=None)
        null_activation = client.get(A_STATUS_ROUTE, environ_overrides=self.environ).get_json()["channelA"]
        self.assertIsNone(null_activation["activation"])

    def test_a_apply_requires_authentication_origin_and_csrf_before_the_manager(self) -> None:
        unauthenticated = Mock()
        unauthenticated.read_session.return_value = None
        unauth_client = self.build_client(channel_a=self.channel_a, auth_service=unauthenticated)

        denied = unauth_client.post(
            A_APPLY_ROUTE,
            data=b"not-json",
            content_type="application/json",
            headers=self.headers,
            environ_overrides=self.environ,
        )
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(denied.get_json()["error"], "AUTHENTICATION_REQUIRED")

        client = self.build_client(channel_a=self.channel_a)
        missing_origin = client.post(
            A_APPLY_ROUTE, json={}, headers={"X-CSRF-Token": "csrf-token"}, environ_overrides=self.environ
        )
        wrong_csrf = client.post(
            A_APPLY_ROUTE,
            json={},
            headers={"Origin": "http://localhost:5173", "X-CSRF-Token": "wrong"},
            environ_overrides=self.environ,
        )
        self.assertEqual(missing_origin.status_code, 403)
        self.assertEqual(wrong_csrf.status_code, 403)
        for response in (denied, missing_origin, wrong_csrf):
            self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        self.channel_a.apply.assert_not_called()
        self.assertEqual(self.channel_a.mock_calls, [])
        self.assertEqual(self.credentials.mock_calls, [])

    def test_a_apply_accepts_only_an_empty_json_object_within_the_128_byte_bound(self) -> None:
        client = self.build_client(channel_a=self.channel_a)

        accepted = client.post(A_APPLY_ROUTE, json={}, headers=self.headers, environ_overrides=self.environ)
        self.assertEqual(accepted.status_code, 200)
        self.channel_a.apply.assert_called_once_with()

        exactly_at_bound = b"{" + b" " * 126 + b"}"
        too_large = b"{" + b" " * 127 + b"}"
        self.assertEqual(len(exactly_at_bound), 128)
        self.assertEqual(len(too_large), 129)
        self.channel_a.apply.reset_mock()
        at_bound = client.post(
            A_APPLY_ROUTE,
            data=exactly_at_bound,
            content_type="application/json",
            headers=self.headers,
            environ_overrides=self.environ,
        )
        over_bound = client.post(
            A_APPLY_ROUTE,
            data=too_large,
            content_type="application/json",
            headers=self.headers,
            environ_overrides=self.environ,
        )
        self.assertEqual(at_bound.status_code, 200)
        self.assertEqual(over_bound.status_code, 413)
        self.assertEqual(over_bound.headers.get("Cache-Control"), "no-store")
        self.channel_a.apply.assert_called_once_with()

        # Malformed and non-empty bodies close before the manager; the exact
        # error string belongs to the existing Apply family, so the closed
        # shape, the exact status and the zero-call claim are pinned here.
        self.channel_a.apply.reset_mock()
        invalid_bodies = (
            ("extra_key", 400, {"json": {"extra": True}}),
            ("secret_key", 400, {"json": {"secret": SECRET}}),
            ("malformed_json", 400, {"data": b"{", "content_type": "application/json"}),
            ("json_array", 400, {"json": []}),
            ("json_null", 400, {"data": b"null", "content_type": "application/json"}),
            ("wrong_content_type", 415, {"data": b"{}", "content_type": "text/plain"}),
        )
        for label, expected_status, arguments in invalid_bodies:
            with self.subTest(body=label):
                response = client.post(A_APPLY_ROUTE, headers=self.headers, environ_overrides=self.environ, **arguments)
                self.assertEqual(response.status_code, expected_status)
                body = response.get_json()
                self.assertEqual(set(body), {"ok", "error"})
                self.assertIs(body["ok"], False)
                self.assertIsInstance(body["error"], str)
                self.assertTrue(body["error"])
                self.assertEqual(response.headers.get("Cache-Control"), "no-store")
                self.assertNotIn(SECRET, response.get_data(as_text=True))
        self.channel_a.apply.assert_not_called()

    def test_a_apply_success_projects_exactly_six_fields_with_nested_activation(self) -> None:
        client = self.build_client(channel_a=self.channel_a)
        status = self.channel_a_status(internalDiagnostic={"stage": "poll", "future": INTERNAL_CANARY})
        self.channel_a.apply.return_value = status

        response = client.post(A_APPLY_ROUTE, json={}, headers=self.headers, environ_overrides=self.environ)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        self.channel_a.apply.assert_called_once_with()
        self.channel_a.status.assert_not_called()
        payload = response.get_json()
        self.assertEqual(set(payload), {"ok", "channelA"})
        channel_a = payload["channelA"]
        self.assertEqual(set(channel_a), set(ADMIN_CHANNEL_A_FIELDS))
        self.assertEqual(set(channel_a["activation"]), set(ADMIN_CHANNEL_A_ACTIVATION_FIELDS))
        self.assertEqual(
            channel_a["activation"],
            {"phase": self.PHASE_RUNNING, "reason": None, "quiescent": False, "restartRequired": False},
        )
        self.assertNotIn(INTERNAL_CANARY, response.get_data(as_text=True))
        self.assertEqual(set(status), set(ADMIN_CHANNEL_A_FIELDS) | {"internalDiagnostic"})

    def test_a_save_domain_errors_map_to_closed_statuses_without_a_second_status_call(self) -> None:
        client = self.build_client(channel_a=self.channel_a)

        for code, expected_status in MANAGER_ERROR_STATUS.items():
            with self.subTest(code=code):
                self.channel_a.save_credential.reset_mock()
                self.channel_a.status.reset_mock()
                self.credentials.reset_mock()
                self.channel_a.save_credential.side_effect = self.ChannelAManagerError(code)

                response = client.put(
                    A_ROUTE, json={"secret": SECRET}, headers=self.headers, environ_overrides=self.environ
                )

                self.assertEqual(response.status_code, expected_status)
                self.assertEqual(response.get_json(), {"ok": False, "error": code})
                self.assertEqual(response.headers.get("Cache-Control"), "no-store")
                self.assertNotIn(SECRET, response.get_data(as_text=True))
                self.channel_a.status.assert_not_called()
                self.credentials.set_secret.assert_not_called()

    def test_a_apply_domain_errors_map_to_closed_statuses_without_a_second_status_call(self) -> None:
        client = self.build_client(channel_a=self.channel_a)
        subset = {
            "PRISMA_CHANNEL_A_MANAGER_BUSY": 409,
            "PRISMA_CHANNEL_A_CREDENTIAL_MISSING": 409,
            "PRISMA_CHANNEL_A_RESTART_REQUIRED": 409,
            "TELEGRAM_BOT_IDENTITY_RESERVED": 409,
            "PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE": 503,
            "PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE": 502,
        }

        for code, expected_status in subset.items():
            with self.subTest(code=code):
                self.channel_a.apply.reset_mock()
                self.channel_a.status.reset_mock()
                self.channel_a.apply.side_effect = self.ChannelAManagerError(code)

                response = client.post(A_APPLY_ROUTE, json={}, headers=self.headers, environ_overrides=self.environ)

                self.assertEqual(response.status_code, expected_status)
                self.assertEqual(response.get_json(), {"ok": False, "error": code})
                self.assertEqual(response.headers.get("Cache-Control"), "no-store")
                self.channel_a.apply.assert_called_once_with()
                self.channel_a.status.assert_not_called()

    def test_a_delete_stop_error_maps_to_closed_409(self) -> None:
        client = self.build_client(channel_a=self.channel_a)
        self.channel_a.delete_credential.side_effect = self.ChannelAManagerError(
            "PRISMA_CHANNEL_A_STOP_UNCONFIRMED"
        )

        response = client.delete(A_ROUTE, headers=self.headers, environ_overrides=self.environ)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json(), {"ok": False, "error": "PRISMA_CHANNEL_A_STOP_UNCONFIRMED"})
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        self.channel_a.delete_credential.assert_called_once_with()
        self.credentials.delete_secret.assert_not_called()
        self.channel_a.status.assert_not_called()

    def test_a_status_domain_errors_map_to_closed_statuses(self) -> None:
        client = self.build_client(channel_a=self.channel_a)
        subset = {
            "PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE": 502,
            "PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE": 503,
            "PRISMA_CHANNEL_A_CONFIGURATION_UNAVAILABLE": 503,
        }

        for code, expected_status in subset.items():
            with self.subTest(code=code):
                self.channel_a.status.reset_mock()
                self.channel_a.status.side_effect = self.ChannelAManagerError(code)

                response = client.get(A_STATUS_ROUTE, environ_overrides=self.environ)

                self.assertEqual(response.status_code, expected_status)
                self.assertEqual(response.get_json(), {"ok": False, "error": code})
                self.assertEqual(response.headers.get("Cache-Control"), "no-store")
                self.channel_a.status.assert_called_once_with()
                self.assertEqual(self.credentials.mock_calls, [])

    def test_a_unknown_manager_error_sanitizes_to_lifecycle_unavailable(self) -> None:
        client = self.build_client(channel_a=self.channel_a)
        for error in (
            self.ChannelAManagerError("PRISMA_CHANNEL_A_FUTURE_UNKNOWN"),
            self.ChannelAManagerError(),
        ):
            with self.subTest(error=repr(error.args)):
                self.channel_a.save_credential.reset_mock()
                self.channel_a.status.reset_mock()
                self.channel_a.save_credential.side_effect = error

                response = client.put(
                    A_ROUTE, json={"secret": SECRET}, headers=self.headers, environ_overrides=self.environ
                )

                self.assertEqual(response.status_code, 502)
                self.assertEqual(response.get_json(), {"ok": False, "error": LIFECYCLE_UNAVAILABLE})
                self.assertEqual(response.headers.get("Cache-Control"), "no-store")
                self.channel_a.status.assert_not_called()

    def test_a_routes_and_method_errors_are_no_store_without_scoping_lookalikes(self) -> None:
        client = self.build_client(channel_a=self.channel_a)

        options_status = client.options(A_STATUS_ROUTE, environ_overrides=self.environ)
        options_apply = client.options(A_APPLY_ROUTE, environ_overrides=self.environ)
        status_method_error = client.post(
            A_STATUS_ROUTE, json={}, headers=self.headers, environ_overrides=self.environ
        )
        apply_method_error = client.get(A_APPLY_ROUTE, environ_overrides=self.environ)

        self.assertEqual(options_status.status_code, 200)
        self.assertEqual(options_apply.status_code, 200)
        self.assertEqual(status_method_error.status_code, 405)
        self.assertEqual(apply_method_error.status_code, 405)
        for response in (options_status, options_apply, status_method_error, apply_method_error):
            self.assertEqual(response.headers.get("Cache-Control"), "no-store")

        lookalike = client.options("/api/prisma/admin/credentials-lookalike", environ_overrides=self.environ)
        self.assertNotEqual(lookalike.headers.get("Cache-Control"), "no-store")
        self.assertEqual(self.channel_a.mock_calls, [])

    def test_telegram_apply_keeps_its_exact_nine_field_wire_with_channel_a_present(self) -> None:
        client = self.build_client(channel_a=self.channel_a, telegram=self.telegram_manager)
        telegram_status = {
            "source": "protected",
            "enabled": True,
            "configured": True,
            "desiredGeneration": 2,
            "appliedGeneration": 2,
            "running": True,
            "verified": True,
            "restartRequired": False,
            "lastError": None,
            "telegramDiagnostic": {"stage": "poll", "future": INTERNAL_CANARY},
        }
        self.telegram_manager.apply.return_value = telegram_status

        response = client.post(TELEGRAM_APPLY_ROUTE, json={}, headers=self.headers, environ_overrides=self.environ)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        payload = response.get_json()
        self.assertEqual(set(payload), {"ok", "telegram"})
        self.assertEqual(set(payload["telegram"]), set(ADMIN_TELEGRAM_FIELDS))
        self.assertNotIn(INTERNAL_CANARY, response.get_data(as_text=True))
        self.telegram_manager.apply.assert_called_once_with()
        self.channel_a.apply.assert_not_called()


if __name__ == "__main__":
    unittest.main()
