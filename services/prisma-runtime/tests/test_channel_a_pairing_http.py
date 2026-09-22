"""RCA-5l focused contract: the QR/status pairing route at the local HMI boundary.

What this file pins down
------------------------

* ``GET /hmi/channel-a/pairing`` and ``POST /hmi/channel-a/pairing`` derive the
  owner identity exclusively from the existing HMI session capability header
  (``touch=False`` for the observational GET, ``touch=True`` for the explicit
  POST). Without a valid capability both verbs answer the exact existing
  ``401 {"ok": false, "error": "PRISMA_SESSION_REQUIRED"}`` and never call the
  Channel A manager.
* ``OPTIONS`` answers 204. Every response on the route, including method
  refusals, carries ``Cache-Control: no-store`` and the existing loopback CORS
  conventions; no new auth framework is introduced.
* GET answers exactly ``{"ok": true, "state": <state>}`` with ``state`` one of
  ``free | pending | linked | unavailable``. The state is the manager's
  observational projection; a pending claim is reported as ``pending``. No
  owner id, phone, generation, timestamp, token or secret is ever projected.
* GET is read-only: it never mints a QR, never drives activation,
  configuration or credentials, and never touches either idle clock. The
  POST is the only issuance path: it refreshes the *HMI session* idle timer
  like every explicit session operation (``touch=True``), but it never touches
  the pairing registry's *human-activity* clock — that clock belongs to the
  phone's confirmed link and is only renewed by real human interaction.
* POST accepts exactly one empty JSON object inside the existing 128-byte
  body bound; anything else is ``400 {"ok": false, "error": "INVALID_REQUEST"}``
  before the manager is reached (a body can never inject a capability).
* POST success answers exactly ``{"ok": true, "qr": {"deepLink": ..., "expiresInSeconds": ...}}``.
  The backend builds the deep link ``https://t.me/<botUsername>?start=<token>``
  from the manager's issued view; the opaque 43-character URL-safe token appears
  only inside the deep link, and no bare token, bot username field, internal
  object or health addition is exposed.
* Failure mapping: no composed manager is
  ``503 PRISMA_CHANNEL_A_MANAGER_UNAVAILABLE``; a ``None`` view (nothing issued)
  and unknown or foreign failures sanitize to
  ``502 PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE``; a real pairing domain conflict
  is ``409 PRISMA_CHANNEL_A_CONFLICT``. No exception detail is ever leaked.
* Owner authority stays server side: each session capability maps to its own
  canonical UUID owner identity, and the request body can never choose one.

Containment
-----------

``requests.Session.request``, ``requests.adapters.HTTPAdapter.send`` and
``threading.Thread.start`` are recorded and refused in ``setUp`` before any
production module is imported (all production imports happen inside the guarded
``setUp``), and the zero-attempt claim is asserted externally after every test.
Runtime state is redirected to a temporary directory with a scrubbed
environment. The application is composed through ``create_app`` with an inert
admin boundary, a real in-memory ``HmiSessionRegistry`` under a controlled
clock and a scriptable inert pairing manager; there are no sockets, no
providers, no real credentials and no workers.
"""

from __future__ import annotations

import os
import re
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import requests
import requests.adapters

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

PAIRING_PATH = "/hmi/channel-a/pairing"
SESSION_REQUIRED = "PRISMA_SESSION_REQUIRED"
INVALID_REQUEST = "INVALID_REQUEST"
MANAGER_UNAVAILABLE = "PRISMA_CHANNEL_A_MANAGER_UNAVAILABLE"
LIFECYCLE_UNAVAILABLE = "PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE"
FAKE_BOT_USERNAME = "prisma_channel_a_bot"
FAKE_TOKEN = "b" * 43
# The closed manager view shape: the HTTP layer builds the deep link from it.
FAKE_VIEW = {"token": FAKE_TOKEN, "botUsername": FAKE_BOT_USERNAME, "expiresInSeconds": 42.0}
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
DEEP_LINK_PATTERN = re.compile(
    r"^https://t\.me/" + re.escape(FAKE_BOT_USERNAME) + r"\?start=[A-Za-z0-9_-]{43}$"
)


class InertAdminBoundary:
    """Stand-in admin boundary; the pairing tests exercise only local HMI routes."""

    def __init__(self):
        self.registered = None

    def register(self, app):
        self.registered = app


class FakePairingManager:
    """Scriptable Channel A manager pairing surface; every call is recorded."""

    def __init__(self):
        self.calls = []
        self.status_results = []
        self.issue_results = []
        self.issue_error = None

    def pairing_status(self, owner_id):
        self.calls.append(("pairing_status", owner_id))
        return self.status_results.pop(0) if self.status_results else "free"

    def issue_pairing_challenge(self, owner_id):
        self.calls.append(("issue_pairing_challenge", owner_id))
        if self.issue_error is not None:
            raise self.issue_error
        return self.issue_results.pop(0) if self.issue_results else None


class ChannelAPairingHttpTests(unittest.TestCase):
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

        temporary = tempfile.TemporaryDirectory(prefix="prisma-pairing-http-")
        self.addCleanup(temporary.cleanup)
        self.state_root = Path(temporary.name)
        environment = patch.dict(
            os.environ, {"PRISMA_RUNTIME_STATE_DIR": temporary.name}, clear=True
        )
        environment.start()
        self.addCleanup(environment.stop)

        # Production imports live inside the guarded setUp: nothing above this
        # line may import a module that could dispatch or start a worker.
        from prisma_runtime.channel_a_manager import ChannelAManagerError
        from prisma_runtime.channel_a_pairing import (
            ChannelAPairingConflict,
            PRISMA_CHANNEL_A_CONFLICT,
        )
        from prisma_runtime.hmi_sessions import CAPABILITY_HEADER, HmiSessionRegistry
        from prisma_runtime.local_presentation import (
            JsonFileStore,
            VoiceEventStore,
            create_app,
        )
        from prisma_runtime.telegram_config import TelegramConfig

        self.CAPABILITY_HEADER = CAPABILITY_HEADER
        self.HmiSessionRegistry = HmiSessionRegistry
        self.ChannelAManagerError = ChannelAManagerError
        self.ChannelAPairingConflict = ChannelAPairingConflict
        self.PRISMA_CHANNEL_A_CONFLICT = PRISMA_CHANNEL_A_CONFLICT
        self.create_app = create_app
        self.JsonFileStore = JsonFileStore
        self.VoiceEventStore = VoiceEventStore
        self.TelegramConfig = TelegramConfig

        self.now = [0.0]
        self.idle_ttl = 100.0
        self.manager = FakePairingManager()

    # -- fixtures ----------------------------------------------------------

    def build_client(self, *, pairing_manager="default"):
        manager = self.manager if pairing_manager == "default" else pairing_manager
        self.sessions = self.HmiSessionRegistry(
            clock=lambda: self.now[0],
            idle_ttl=self.idle_ttl,
            absolute_ttl=1_000_000.0,
        )
        app = self.create_app(
            snapshot_store=self.JsonFileStore(self.state_root / "snapshot.json"),
            voice_events=self.VoiceEventStore(),
            telegram_configuration=self.TelegramConfig(enabled=False, token=""),
            session_registry=self.sessions,
            admin_http=InertAdminBoundary(),
            # The new optional seam under test; a None value is the absent case.
            channel_a_manager=manager,
        )
        return app.test_client()

    def create_session(self, client):
        created = client.post("/hmi/session", json={})
        self.assertEqual(created.status_code, 201)
        capability = created.headers.get(self.CAPABILITY_HEADER)
        self.assertTrue(capability)
        return capability

    def assert_valid_owner(self, owner_id, capability):
        self.assertIsInstance(owner_id, str)
        self.assertIsNotNone(UUID_PATTERN.match(owner_id))
        self.assertNotEqual(owner_id, capability)

    # -- route mechanics ---------------------------------------------------

    def test_options_preflight_is_204_no_store_with_the_existing_loopback_cors(self) -> None:
        client = self.build_client()

        response = client.options(PAIRING_PATH)

        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        self.assertTrue(response.headers.get("Access-Control-Allow-Origin"))
        self.assertEqual(self.manager.calls, [])

    def test_get_and_post_require_a_capability_and_fail_with_the_exact_session_error(self) -> None:
        client = self.build_client()
        capability_header = self.CAPABILITY_HEADER

        for verb in ("get", "post"):
            arguments = {"json": {}} if verb == "post" else {}
            with self.subTest(verb=verb):
                missing = getattr(client, verb)(PAIRING_PATH, **arguments)
                self.assertEqual(missing.status_code, 401)
                self.assertEqual(missing.get_json(), {"ok": False, "error": SESSION_REQUIRED})
                self.assertEqual(missing.headers.get("Cache-Control"), "no-store")
                foreign = getattr(client, verb)(
                    PAIRING_PATH, headers={capability_header: "A" * 43}, **arguments
                )
                self.assertEqual(foreign.status_code, 401)
                self.assertEqual(foreign.get_json(), {"ok": False, "error": SESSION_REQUIRED})
                self.assertEqual(foreign.headers.get("Cache-Control"), "no-store")

        self.assertEqual(self.manager.calls, [])

    def test_unsupported_methods_are_refused_with_no_store_and_no_manager_call(self) -> None:
        client = self.build_client()

        for verb in ("put", "patch", "delete"):
            with self.subTest(verb=verb):
                response = getattr(client, verb)(PAIRING_PATH)
                self.assertEqual(response.status_code, 405)
                self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        self.assertEqual(self.manager.calls, [])

    # -- GET: observational state projection -------------------------------

    def test_get_projects_exactly_ok_and_state_and_only_reads_the_status(self) -> None:
        client = self.build_client()
        capability = self.create_session(client)

        response = client.get(
            PAIRING_PATH, headers={self.CAPABILITY_HEADER: capability}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"ok": True, "state": "free"})
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:5173")
        self.assertEqual([verb for verb, _owner in self.manager.calls], ["pairing_status"])
        _verb, owner_id = self.manager.calls[0]
        self.assert_valid_owner(owner_id, capability)

    def test_get_projects_pending_linked_and_unavailable_without_extra_fields(self) -> None:
        client = self.build_client()
        capability = self.create_session(client)

        for state in ("pending", "linked", "unavailable"):
            with self.subTest(state=state):
                self.manager.status_results.append(state)
                response = client.get(
                    PAIRING_PATH, headers={self.CAPABILITY_HEADER: capability}
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.get_json(), {"ok": True, "state": state})
                self.assertEqual(response.headers.get("Cache-Control"), "no-store")
                self.assertNotIn(capability, response.get_data(as_text=True))

        # Without a composed manager the observation is honestly unavailable,
        # never free and never an error.
        unmanaged = self.build_client(pairing_manager=None)
        absent_capability = self.create_session(unmanaged)
        absent = unmanaged.get(
            PAIRING_PATH, headers={self.CAPABILITY_HEADER: absent_capability}
        )
        self.assertEqual(absent.status_code, 200)
        self.assertEqual(absent.get_json(), {"ok": True, "state": "unavailable"})
        self.assertEqual(absent.headers.get("Cache-Control"), "no-store")

    def test_get_never_touches_the_session_timer_while_post_renews_it(self) -> None:
        """Session idle TTL only: the pairing human-idle clock is untouched.

        The HMI *session* idle window is renewed by ``touch=True`` on the
        explicit POST and not by the observational GET. The pairing registry's
        *human-activity* clock is a different domain entirely: neither verb
        touches it here — the fake manager records that no human renewal path
        exists on the HTTP surface at all.
        """
        client = self.build_client()
        read_capability = self.create_session(client)
        post_capability = self.create_session(client)
        self.manager.status_results.append("free")

        # Inside the session idle window both verbs are authorized.
        self.now[0] = self.idle_ttl - 40.0
        read = client.get(PAIRING_PATH, headers={self.CAPABILITY_HEADER: read_capability})
        self.assertEqual(read.status_code, 200)
        self.manager.issue_results.append(dict(FAKE_VIEW))
        posted = client.post(
            PAIRING_PATH, json={}, headers={self.CAPABILITY_HEADER: post_capability}
        )
        self.assertEqual(posted.status_code, 200)

        # Past the original session idle deadline the GET-only session is gone
        # because the observational GET never touched it, while the session
        # whose owner issued a QR through the explicit POST was renewed.
        self.now[0] = self.idle_ttl + 5.0
        expired = client.get(PAIRING_PATH, headers={self.CAPABILITY_HEADER: read_capability})
        self.assertEqual(expired.status_code, 401)
        self.assertEqual(expired.get_json(), {"ok": False, "error": SESSION_REQUIRED})
        self.manager.issue_results.append(dict(FAKE_VIEW))
        renewed = client.post(
            PAIRING_PATH, json={}, headers={self.CAPABILITY_HEADER: post_capability}
        )
        self.assertEqual(renewed.status_code, 200)

    # -- POST: explicit issuance -------------------------------------------

    def test_post_rejects_every_body_that_is_not_the_empty_json_object(self) -> None:
        client = self.build_client()
        capability = self.create_session(client)
        headers = {self.CAPABILITY_HEADER: capability}
        oversized = b"{" + b" " * 127 + b"}"
        at_bound = b"{" + b" " * 126 + b"}"
        self.assertEqual(len(oversized), 129)
        self.assertEqual(len(at_bound), 128)

        cases = (
            ("missing_body", {}),
            ("capability_key", {"json": {"capability": "injected"}}),
            ("token_key", {"json": {"token": "injected"}}),
            ("json_array", {"json": []}),
            ("json_null", {"data": b"null", "content_type": "application/json"}),
            ("malformed", {"data": b"{", "content_type": "application/json"}),
            ("oversized", {"data": oversized, "content_type": "application/json"}),
            ("wrong_content_type", {"data": b"{}", "content_type": "text/plain"}),
        )
        for label, arguments in cases:
            with self.subTest(body=label):
                response = client.post(PAIRING_PATH, headers=headers, **arguments)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json(), {"ok": False, "error": INVALID_REQUEST})
                self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        self.assertEqual(self.manager.calls, [])

        # Exactly the empty JSON object inside the bound is the one accepted
        # body; extra whitespace does not widen it past the 128-byte bound.
        self.manager.issue_results.append(dict(FAKE_VIEW))
        accepted = client.post(
            PAIRING_PATH, data=at_bound, content_type="application/json", headers=headers
        )
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(
            [verb for verb, _owner in self.manager.calls], ["issue_pairing_challenge"]
        )

    def test_post_projects_the_exact_qr_envelope_without_leaking_the_bare_token(self) -> None:
        client = self.build_client()
        capability = self.create_session(client)
        self.manager.issue_results.append(dict(FAKE_VIEW))

        response = client.post(
            PAIRING_PATH, json={}, headers={self.CAPABILITY_HEADER: capability}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        payload = response.get_json()
        self.assertEqual(set(payload), {"ok", "qr"})
        self.assertIs(payload["ok"], True)
        qr = payload["qr"]
        self.assertEqual(set(qr), {"deepLink", "expiresInSeconds"})
        self.assertIsNotNone(DEEP_LINK_PATTERN.match(qr["deepLink"]))
        self.assertEqual(qr["expiresInSeconds"], 42.0)
        raw = response.get_data(as_text=True)
        # The opaque token appears exactly once: inside the deep link.
        self.assertEqual(raw.count(FAKE_TOKEN), 1)
        self.assertNotIn('"token"', raw)
        self.assertNotIn('"botUsername"', raw)
        self.assertNotIn(capability, raw)
        self.assertEqual(
            [verb for verb, _owner in self.manager.calls], ["issue_pairing_challenge"]
        )

    def test_post_maps_absent_manager_none_view_conflict_and_unknown_failures(self) -> None:
        unmanaged = self.build_client(pairing_manager=None)
        absent_capability = self.create_session(unmanaged)
        absent = unmanaged.post(
            PAIRING_PATH, json={}, headers={self.CAPABILITY_HEADER: absent_capability}
        )
        self.assertEqual(absent.status_code, 503)
        self.assertEqual(absent.get_json(), {"ok": False, "error": MANAGER_UNAVAILABLE})
        self.assertEqual(absent.headers.get("Cache-Control"), "no-store")

        client = self.build_client()
        capability = self.create_session(client)
        rows = (
            ("no_view", None, 502, LIFECYCLE_UNAVAILABLE),
            ("closed_manager_error", self.ChannelAManagerError(LIFECYCLE_UNAVAILABLE), 502, LIFECYCLE_UNAVAILABLE),
            (
                "conflict",
                self.ChannelAPairingConflict(self.PRISMA_CHANNEL_A_CONFLICT),
                409,
                self.PRISMA_CHANNEL_A_CONFLICT,
            ),
            ("unknown_error", RuntimeError("private-canary"), 502, LIFECYCLE_UNAVAILABLE),
        )
        for label, outcome, expected_status, expected_error in rows:
            with self.subTest(row=label):
                self.manager.issue_error = outcome if isinstance(outcome, Exception) else None
                response = client.post(
                    PAIRING_PATH, json={}, headers={self.CAPABILITY_HEADER: capability}
                )
                self.assertEqual(response.status_code, expected_status)
                self.assertEqual(response.get_json(), {"ok": False, "error": expected_error})
                self.assertEqual(response.headers.get("Cache-Control"), "no-store")
                self.assertNotIn("private-canary", response.get_data(as_text=True))
        self.manager.issue_error = None

    def test_owner_authority_stays_server_side_and_isolated_per_session(self) -> None:
        client = self.build_client()
        first = self.create_session(client)
        second = self.create_session(client)
        self.assertNotEqual(first, second)

        self.manager.issue_results.append(dict(FAKE_VIEW))
        client.post(PAIRING_PATH, json={}, headers={self.CAPABILITY_HEADER: first})
        self.manager.issue_results.append(dict(FAKE_VIEW))
        client.post(PAIRING_PATH, json={}, headers={self.CAPABILITY_HEADER: second})

        owners = [owner for verb, owner in self.manager.calls if verb == "issue_pairing_challenge"]
        self.assertEqual(len(owners), 2)
        self.assertNotEqual(owners[0], owners[1])
        for owner_id, capability in ((owners[0], first), (owners[1], second)):
            self.assert_valid_owner(owner_id, capability)

        # A read through one capability never observes the other owner.
        self.manager.status_results.append("linked")
        client.get(PAIRING_PATH, headers={self.CAPABILITY_HEADER: first})
        self.assertEqual(self.manager.calls[-1], ("pairing_status", owners[0]))


if __name__ == "__main__":
    unittest.main()
