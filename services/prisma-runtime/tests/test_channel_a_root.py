"""RCA-5i-2 focused contract: root composition of Channel A.

What this file pins down
------------------------

* ``create_app`` composes exactly one ``ChannelAManager`` that shares the
  protected ``CredentialService`` already used by Channel B, the shared
  process identity reservation and the session registry the application serves.
* The manager's default activation factory builds a real ``ChannelAActivation``
  with the real ``ChannelATransport``, the existing snapshot parser, the
  live-owner destination getter bounded to 15 seconds, the existing question
  byte bound, monotonic clocks, the desired warning lead and the accepted
  request 20 / poll 25 / read 35 / join 40 / pause 0.1 bounds.
* Composition stays inert: no credential resolution, no ``apply``/``prepare``/
  ``start``, no worker thread, no provider call and no startup Apply of A.
* ``on_outcome`` handles only ``IngressOutcome.answer_envelope`` (``None``
  ignored) through the real ``VoiceEventStore``: publication for the exact
  envelope owner, empty question, live ``is_query_envelope_current`` closure
  that is re-evaluated on every read, fail-closed on refusal or exception, no
  cross-owner service and no fallback response after revocation.
* Root ``main`` starts B as before, stops A and B in its ``finally`` on both a
  normal server return and a raised exit, and never applies A.
* ``RuntimePaths.channel_a_configuration`` follows the existing ``paths.py``
  conventions: a root-relative JSON policy path relocated by
  ``PRISMA_RUNTIME_STATE_DIR`` with no new override framework.

Containment
-----------

``requests.Session.request``, ``requests.adapters.HTTPAdapter.send`` and
``threading.Thread.start`` are recorded and refused before any production
import, and the zero-attempt claim is asserted externally after every test.
Runtime state is redirected to a temporary directory with a scrubbed
environment, so no real credential is read or written. There are no sockets, no
provider calls, no native workers, no sleeps and no auxiliary harness imports.
Real ``CredentialService``, ``VoiceEventStore``, ``HmiSessionRegistry``,
``ChannelAManager``, ``ChannelAActivation`` and ``ChannelATransport`` objects
are used wherever they are inert; doubles exist only to capture constructor
arguments and to keep forbidden lifecycle entries observable.
"""

from __future__ import annotations

import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import requests
import requests.adapters

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

TOKEN = "123456:offline-channel-a-token"
ANSWER_TEXT = "Respuesta offline de Canal A"
HMI_NAME = "Planta Norte"
OWNER_A = "00000000-0000-0000-0000-00000000000a"
OWNER_B = "00000000-0000-0000-0000-00000000000b"

# Accepted Channel B timeouts reused by Channel A, plus the approved poll pause.
REQUEST_TIMEOUT = 20
POLL_TIMEOUT = 25
READ_TIMEOUT = 35
JOIN_TIMEOUT = 40
POLL_PAUSE = 0.1
WARNING_LEAD = 45
DESIRED_GENERATION = 9
OWNER_NAME_MAX_AGE_SECONDS = 15.0


class InertReservation:
    """Process-local reservation stand-in: any real acquire/release is a defect."""

    def __init__(self):
        self.acquired = []

    def acquire(self, *args, **kwargs):
        self.acquired.append(("acquire", args, kwargs))
        raise AssertionError("RESERVATION_MUST_STAY_UNUSED")

    def release(self, *args, **kwargs):
        self.acquired.append(("release", args, kwargs))
        raise AssertionError("RESERVATION_MUST_STAY_UNUSED")


class CaptureDouble:
    """Constructor capture that records arguments and performs no effect."""

    instances: tuple = ()

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs
        self.calls = []
        type(self).instances = type(self).instances + (self,)

    def argument(self, index, name):
        if name in self.kwargs:
            return self.kwargs[name]
        return self.args[index] if len(self.args) > index else None


class ChannelAActivationDouble(CaptureDouble):
    """Captures the activation the default factory composes."""


class ChannelATransportDouble(CaptureDouble):
    """Captures the transport the default factory composes."""


class TelegramLocalBotDouble(CaptureDouble):
    """Captures the Channel B bot so the shared reservation stays observable."""


class ChannelAManagerDouble(CaptureDouble):
    """Captures the composed manager and refuses every lifecycle entry."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.guard_calls = []
        self.guard = lambda envelope: True

    @property
    def activation_factory(self):
        return self.kwargs.get("activation_factory")

    @property
    def credential_service(self):
        return self.kwargs.get("credential_service")

    @property
    def configuration_store(self):
        return self.kwargs.get("configuration_store")

    @property
    def reservation(self):
        return self.kwargs.get("reservation")

    def apply(self):
        self.calls.append("apply")
        return None

    def prepare(self):
        self.calls.append("prepare")
        return None

    def start(self):
        self.calls.append("start")
        return None

    def startup_apply(self):
        self.calls.append("startup_apply")
        return None

    def stop(self):
        self.calls.append("stop")
        return True

    def status(self):
        self.calls.append("status")
        return None

    def is_query_envelope_current(self, envelope):
        self.guard_calls.append(envelope)
        return self.guard(envelope)


class ChannelAConfigurationStoreDouble(CaptureDouble):
    """Captures the policy path; a read never touches a real policy file."""

    @property
    def path(self):
        return self.argument(0, "path")

    def read(self):
        self.calls.append("read")

        class _Desired:
            warning_lead_seconds = WARNING_LEAD
            desired_generation = 0

        return _Desired()


class AdminHttpBoundaryDouble(CaptureDouble):
    """Inert admin boundary that records who received the protected service."""

    @property
    def credential_service(self):
        return self.argument(1, "credential_service")

    @property
    def channel_a_manager(self):
        return self.kwargs.get("channel_a_manager")

    def register(self, app):
        self.registered_app = app


class TelegramLifecycleManagerDouble(CaptureDouble):
    """Inert Channel B manager used to observe the shared store and reservation."""

    @property
    def credential_service(self):
        return self.argument(2, "credential_service")

    @property
    def bot_factory(self):
        return self.argument(3, "bot_factory")


class ChannelAManagerRecorder:
    """Mixin recording the Channel A lifecycle entry points.

    ``apply`` is never delegated: a real apply would resolve credentials and
    start provider work, which this offline contract forbids. ``stop`` is
    delegated because stopping an unapplied real manager is inert.
    """

    instances: tuple = ()

    def __init__(self, **kwargs):
        self.activation_factory = kwargs.get("activation_factory")
        self.credential_service = kwargs.get("credential_service")
        self.configuration_store = kwargs.get("configuration_store")
        self.reservation = kwargs.get("reservation")
        self.calls = []
        super().__init__(**kwargs)
        type(self).instances = type(self).instances + (self,)

    def apply(self):
        self.calls.append("apply")
        return None

    def prepare(self):
        self.calls.append("prepare")
        return None

    def start(self):
        self.calls.append("start")
        return None

    def startup_apply(self):
        self.calls.append("startup_apply")
        return None

    def stop(self):
        self.calls.append("stop")
        return super().stop()


class TelegramLifecycleManagerRecorder:
    """Mixin keeping Channel B's real inert behaviour while recording it."""

    instances: tuple = ()

    def __init__(self, *args, **kwargs):
        self.calls = []
        super().__init__(*args, **kwargs)
        type(self).instances = type(self).instances + (self,)

    def startup_apply(self):
        self.calls.append("startup_apply")
        return super().startup_apply()

    def stop(self):
        self.calls.append("stop")
        return super().stop()


class RootHarness:
    """Shared offline containment: guards, isolated state and patch helpers."""

    def install_offline_guards(self):
        self.forbidden = []

        def refuse(*args, **kwargs):
            self.forbidden.append(1)
            raise AssertionError("OFFLINE_OPERATION_REFUSED")

        # Installed before any production import so a lazy import cannot
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

    def isolate_runtime_state(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.state_root = Path(temporary.name)
        environment = patch.dict(os.environ, {"PRISMA_RUNTIME_STATE_DIR": temporary.name}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

    def patch_target(self, target, name, value, *, create=False):
        patcher = patch.object(target, name, value, create=create)
        patcher.start()
        self.addCleanup(patcher.stop)
        return value

    def single(self, double):
        self.assertEqual(len(double.instances), 1, f"expected exactly one composed {double.__name__}")
        return double.instances[0]

    def reset_doubles(self, *doubles):
        for double in doubles:
            double.instances = ()

    def build_inert_telegram_configuration(self):
        from prisma_runtime.telegram_config import TelegramConfig

        return TelegramConfig(enabled=False, token="")

    def build_session_registry(self, events):
        from prisma_runtime.hmi_sessions import HmiSessionRegistry

        self.now = [1_000.0]
        registry = HmiSessionRegistry(
            clock=lambda: self.now[0],
            owner_factory=lambda: OWNER_A,
            on_remove=events.remove_owner,
        )
        capability, _metadata = registry.create()
        registry.set_context(capability, {"hmiName": HMI_NAME})
        return registry

    def compose_application(self):
        from prisma_runtime import local_presentation

        self.module = local_presentation
        self.events = local_presentation.VoiceEventStore()
        self.registry = self.build_session_registry(self.events)
        return local_presentation.create_app(
            snapshot_store=local_presentation.JsonFileStore(self.state_root / "snapshot.json"),
            voice_events=self.events,
            telegram_configuration=self.build_inert_telegram_configuration(),
            session_registry=self.registry,
        )

    def assert_monotonic_clock(self, clock, name):
        self.assertTrue(callable(clock), f"{name} must be a callable clock")
        first = clock()
        self.assertNotIsInstance(first, bool)
        self.assertIsInstance(first, (int, float))
        self.assertGreaterEqual(clock(), first)
        self.assertLess(
            abs(first - time.monotonic()),
            300.0,
            f"{name} must live in the monotonic domain, not in epoch seconds",
        )
        self.assertIsNot(clock, time.time)


class ChannelARootCompositionTests(RootHarness, unittest.TestCase):
    """Wiring and ``on_outcome`` behaviour, using inert capture doubles."""

    def setUp(self):
        self.install_offline_guards()
        self.isolate_runtime_state()
        self.reset_doubles(
            ChannelAManagerDouble,
            ChannelAActivationDouble,
            ChannelATransportDouble,
            ChannelAConfigurationStoreDouble,
            AdminHttpBoundaryDouble,
            TelegramLifecycleManagerDouble,
            TelegramLocalBotDouble,
        )
        self.reservation = InertReservation()

        from prisma_runtime import (
            channel_a_activation,
            channel_a_configuration,
            channel_a_manager,
            channel_a_transport,
            local_presentation,
        )
        from prisma_runtime.channel_a_bot import IngressOutcome, SEND_DELIVERED, VARIANT_MESSAGE
        from prisma_runtime.channel_a_configuration import ChannelAConfiguration
        from prisma_runtime.channel_a_query import QUERY_ANSWER_DELIVERED, QueryEnvelope
        from prisma_runtime.credential_store import CredentialService

        self.IngressOutcome = IngressOutcome
        self.VARIANT_MESSAGE = VARIANT_MESSAGE
        self.SEND_DELIVERED = SEND_DELIVERED
        self.QUERY_ANSWER_DELIVERED = QUERY_ANSWER_DELIVERED
        self.QueryEnvelope = QueryEnvelope
        self.ChannelAConfiguration = ChannelAConfiguration
        self.CredentialService = CredentialService

        for module, name, value, create in (
            (local_presentation, "ChannelAManager", ChannelAManagerDouble, True),
            (channel_a_manager, "ChannelAManager", ChannelAManagerDouble, False),
            (local_presentation, "ChannelAActivation", ChannelAActivationDouble, True),
            (channel_a_activation, "ChannelAActivation", ChannelAActivationDouble, False),
            (local_presentation, "ChannelATransport", ChannelATransportDouble, True),
            (channel_a_transport, "ChannelATransport", ChannelATransportDouble, False),
            (local_presentation, "ChannelAConfigurationStore", ChannelAConfigurationStoreDouble, True),
            (channel_a_configuration, "ChannelAConfigurationStore", ChannelAConfigurationStoreDouble, False),
            (local_presentation, "AdminHttpBoundary", AdminHttpBoundaryDouble, False),
            (local_presentation, "TelegramLifecycleManager", TelegramLifecycleManagerDouble, False),
            (local_presentation, "TelegramLocalBot", TelegramLocalBotDouble, False),
        ):
            self.patch_target(module, name, value, create=create)
        self.patch_target(local_presentation, "process_bot_identity_reservation", lambda: self.reservation)
        self.app = self.compose_application()

    def activation_arguments(self):
        """Call the composed factory exactly as the manager calls it."""
        manager = self.single(ChannelAManagerDouble)
        factory = manager.activation_factory
        self.assertTrue(callable(factory), "the composed manager must expose a default activation factory")
        activation = factory(
            TOKEN,
            self.ChannelAConfiguration(warning_lead_seconds=WARNING_LEAD, desired_generation=DESIRED_GENERATION),
            7,
            self.reservation,
        )
        self.assertEqual(
            len(ChannelAActivationDouble.instances), 1, "one factory call must compose exactly one activation"
        )
        return activation.kwargs

    def ingress(self, envelope=None):
        return self.IngressOutcome(
            update_id=11,
            variant=self.VARIANT_MESSAGE,
            kind=self.QUERY_ANSWER_DELIVERED,
            accepted=True,
            delivery=self.SEND_DELIVERED,
            answer_envelope=envelope,
        )

    def envelope(self, owner_id, *, answer_text=ANSWER_TEXT):
        return self.QueryEnvelope(
            owner_id=owner_id,
            generation=1,
            update_id=11,
            epoch="offline-channel-a-epoch",
            answer_text=answer_text,
            context_revision=3,
        )

    def test_create_app_composes_one_inert_manager_sharing_protected_state(self):
        manager = self.single(ChannelAManagerDouble)
        boundary = self.single(AdminHttpBoundaryDouble)
        telegram_manager = self.single(TelegramLifecycleManagerDouble)
        store = self.single(ChannelAConfigurationStoreDouble)

        # No lifecycle entry may run while the application is being created.
        self.assertEqual(manager.calls, [])
        self.assertEqual(manager.guard_calls, [])

        # One protected store, already used by the admin boundary and Channel B.
        protected = boundary.credential_service
        self.assertIsInstance(protected, self.CredentialService)
        self.assertIs(manager.credential_service, protected)
        self.assertIs(telegram_manager.credential_service, protected)

        # The root builds A before its admin boundary and injects that exact
        # instance, so admin routes share the composed manager's accounting.
        self.assertIs(boundary.channel_a_manager, manager)

        # A and B share the one process-local identity reservation.
        self.assertIs(manager.reservation, self.reservation)
        telegram_bot = telegram_manager.bot_factory(TOKEN)
        self.assertIs(telegram_bot.kwargs.get("reservation"), self.reservation)

        # The shared session registry the application serves is the one composed,
        # and the composed manager is published under the configuration key that
        # shutdown and future capability routes read back.
        self.assertIs(self.app.config["session_registry"], self.registry)
        self.assertIs(self.app.config["channel_a_manager"], manager)

        # The policy path is the canonical runtime path, not an ad-hoc filename.
        configured_path = getattr(self.module.runtime_paths(), "channel_a_configuration", None)
        self.assertIsNotNone(configured_path, "RuntimePaths must expose the canonical channel_a_configuration path")
        self.assertEqual(store.path, configured_path)
        self.assertIs(manager.configuration_store, store)
        self.assertTrue(callable(manager.activation_factory))

    def test_default_activation_factory_uses_approved_bounds_and_real_collaborators(self):
        arguments = self.activation_arguments()
        transport = self.single(ChannelATransportDouble)

        self.assertEqual(transport.argument(0, "token"), TOKEN)
        self.assertEqual(transport.kwargs.get("request_timeout"), REQUEST_TIMEOUT)
        self.assertIs(arguments.get("transport"), transport)
        self.assertIs(arguments.get("sessions"), self.registry)
        self.assertIs(arguments.get("parse"), self.module.answer_from_snapshot)
        self.assertEqual(arguments.get("warning_lead"), WARNING_LEAD)
        self.assertEqual(arguments.get("max_question_bytes"), self.module.HMI_QUESTION_MAX_BYTES)
        self.assertEqual(arguments.get("poll_timeout"), POLL_TIMEOUT)
        self.assertEqual(arguments.get("read_timeout"), READ_TIMEOUT)
        self.assertEqual(arguments.get("join_timeout"), JOIN_TIMEOUT)
        self.assertEqual(arguments.get("poll_pause"), POLL_PAUSE)
        self.assertIs(arguments.get("reservation"), self.reservation)
        for name in ("clock", "pairing_clock", "query_clock"):
            self.assert_monotonic_clock(arguments.get(name), name)
        self.assertTrue(callable(arguments.get("destination_label")))
        self.assertTrue(callable(arguments.get("on_outcome")))

    def test_default_destination_label_reads_only_a_fresh_live_owner_name(self):
        label = self.activation_arguments()["destination_label"]
        self.assertTrue(callable(label))

        self.assertEqual(label(OWNER_A), HMI_NAME)
        self.assertIsNone(label(OWNER_B))

        # Past the 15-second receipt bound the label is no longer trusted.
        self.now[0] += OWNER_NAME_MAX_AGE_SECONDS + 1.0
        self.assertIsNone(label(OWNER_A))

    def test_on_outcome_ignores_an_outcome_without_an_answer_envelope(self):
        arguments = self.activation_arguments()
        manager = self.single(ChannelAManagerDouble)

        arguments["on_outcome"](self.ingress(None))

        self.assertEqual(manager.guard_calls, [])
        self.assertIsNone(self.events.latest(OWNER_A))
        self.assertIsNone(self.events.latest(OWNER_B))

    def test_on_outcome_publishes_for_the_exact_owner_with_an_empty_question(self):
        arguments = self.activation_arguments()
        manager = self.single(ChannelAManagerDouble)
        envelope = self.envelope(OWNER_A)

        arguments["on_outcome"](self.ingress(envelope))

        # The guard is consulted with the exact envelope, and again on every read.
        self.assertEqual(manager.guard_calls, [envelope])
        event = self.events.latest(OWNER_A)
        self.assertIsNotNone(event)
        self.assertGreaterEqual(len(manager.guard_calls), 2)
        self.assertEqual(event["text"], ANSWER_TEXT)
        self.assertEqual(event["question"], "")
        self.assertNotIn("telegramChatId", event)

        self.assertIsNotNone(self.events.get(event["id"], OWNER_A))
        self.assertIsNone(self.events.latest(OWNER_B))
        self.assertIsNone(self.events.get(event["id"], OWNER_B))
        self.assertIsNone(self.events.get_internal(event["id"], OWNER_B))

    def test_on_outcome_fails_closed_when_the_publication_guard_refuses_or_raises(self):
        arguments = self.activation_arguments()
        manager = self.single(ChannelAManagerDouble)
        envelope = self.envelope(OWNER_A)

        def refuse(_envelope):
            raise RuntimeError("OFFLINE_GUARD_REFUSED")

        for guard in (lambda _envelope: False, refuse):
            with self.subTest(guard=guard):
                manager.guard = guard
                manager.guard_calls.clear()

                arguments["on_outcome"](self.ingress(envelope))

                self.assertEqual(manager.guard_calls, [envelope])
                self.assertIsNone(self.events.latest(OWNER_A))
                self.assertIsNone(self.events.latest(OWNER_B))

    def test_published_answer_is_revoked_on_read_and_never_served_to_another_owner(self):
        arguments = self.activation_arguments()
        manager = self.single(ChannelAManagerDouble)
        envelope_a = self.envelope(OWNER_A)
        envelope_b = self.envelope(OWNER_B, answer_text="Otra respuesta")

        manager.guard = lambda envelope: envelope is envelope_a
        arguments["on_outcome"](self.ingress(envelope_a))
        arguments["on_outcome"](self.ingress(envelope_b))

        self.assertIn(envelope_a, manager.guard_calls)
        self.assertIn(envelope_b, manager.guard_calls)
        published = self.events.latest(OWNER_A)
        self.assertIsNotNone(published)
        self.assertIsNone(self.events.latest(OWNER_B))

        # Revocation after publication is observed on read, with no fallback.
        manager.guard = lambda envelope: False
        self.assertIsNone(self.events.latest(OWNER_A))
        self.assertIsNone(self.events.latest(OWNER_A))
        self.assertIsNone(self.events.get(published["id"], OWNER_A))


class ChannelARootRealCompositionTests(RootHarness, unittest.TestCase):
    """Real manager/activation/transport composition plus root ``main``."""

    def setUp(self):
        self.install_offline_guards()
        self.isolate_runtime_state()
        self.reservation = InertReservation()

        from prisma_runtime import channel_a_activation, channel_a_manager, local_presentation, telegram_lifecycle
        from prisma_runtime.channel_a_configuration import ChannelAConfiguration
        from prisma_runtime.channel_a_lifecycle import PHASE_IDLE

        self.module = local_presentation
        self.ChannelAManager = channel_a_manager.ChannelAManager
        self.ChannelAActivation = channel_a_activation.ChannelAActivation
        self.ChannelAConfiguration = ChannelAConfiguration
        self.PHASE_IDLE = PHASE_IDLE

        class RecordingChannelAManager(ChannelAManagerRecorder, self.ChannelAManager):
            pass

        class RecordingTelegramLifecycleManager(
            TelegramLifecycleManagerRecorder, telegram_lifecycle.TelegramLifecycleManager
        ):
            pass

        self.ManagerRecorder = RecordingChannelAManager
        self.TelegramManagerRecorder = RecordingTelegramLifecycleManager
        self.patch_target(local_presentation, "ChannelAManager", RecordingChannelAManager, create=True)
        self.patch_target(channel_a_manager, "ChannelAManager", RecordingChannelAManager)
        self.patch_target(local_presentation, "TelegramLifecycleManager", RecordingTelegramLifecycleManager)
        self.patch_target(telegram_lifecycle, "TelegramLifecycleManager", RecordingTelegramLifecycleManager)
        self.patch_target(local_presentation, "process_bot_identity_reservation", lambda: self.reservation)

    def desired_configuration(self):
        return self.ChannelAConfiguration(
            warning_lead_seconds=WARNING_LEAD, desired_generation=DESIRED_GENERATION
        )

    def invoke_main(self, behaviour):
        """Run root ``main`` with a fake server, recording its ``app.run`` call."""
        run_calls = []
        real_create_app = self.module.create_app

        def capture_app(*args, **kwargs):
            app = real_create_app(*args, **kwargs)

            def fake_run(*run_args, **run_kwargs):
                run_calls.append((run_args, run_kwargs))
                return behaviour()

            app.run = fake_run
            return app

        with patch.object(
            self.module, "read_telegram_config", lambda: self.build_inert_telegram_configuration()
        ), patch.object(self.module, "create_app", capture_app):
            self.module.main()
        return run_calls

    def test_real_manager_builds_a_real_inert_activation_without_starting_anything(self):
        self.compose_application()
        manager = self.single(self.ManagerRecorder)
        self.assertIsInstance(manager, self.ChannelAManager)
        self.assertEqual(manager.calls, [])

        # This exercises construction through the real factory, never a live
        # activation: status() only reports the freshly built idle lifecycle.
        activation = manager.activation_factory(TOKEN, self.desired_configuration(), 7, self.reservation)

        self.assertIsInstance(activation, self.ChannelAActivation)
        status = activation.status()
        self.assertEqual(status.phase, self.PHASE_IDLE)
        self.assertIs(status.quiescent, True)
        self.assertIs(status.restart_required, False)
        self.assertEqual(manager.calls, [])
        self.assertEqual(self.reservation.acquired, [])

    def test_main_starts_b_without_applying_a_and_stops_both_managers(self):
        run_calls = self.invoke_main(lambda: None)

        channel_a_manager = self.single(self.ManagerRecorder)
        telegram_manager = self.single(self.TelegramManagerRecorder)
        self.assertEqual(telegram_manager.calls, ["startup_apply", "stop"])
        self.assertEqual(channel_a_manager.calls, ["stop"])

        self.assertEqual(len(run_calls), 1)
        _run_args, run_kwargs = run_calls[0]
        self.assertEqual(run_kwargs.get("host"), self.module.DEFAULT_HOST)
        self.assertEqual(run_kwargs.get("port"), self.module.DEFAULT_PORT)

    def test_main_stops_both_managers_when_the_server_raises(self):
        def raise_from_server():
            raise RuntimeError("OFFLINE_SERVER_EXIT")

        with self.assertRaises(RuntimeError):
            self.invoke_main(raise_from_server)

        self.assertEqual(self.single(self.ManagerRecorder).calls, ["stop"])
        self.assertEqual(self.single(self.TelegramManagerRecorder).calls, ["startup_apply", "stop"])


class ChannelAConfigurationPathTests(unittest.TestCase):
    """The policy path follows the existing ``paths.py`` conventions."""

    def test_channel_a_configuration_path_is_a_root_relative_runtime_path(self):
        from prisma_runtime.paths import runtime_paths

        with patch.dict(os.environ, {"LOCALAPPDATA": r"C:\Users\test\AppData\Local"}, clear=True):
            defaults = runtime_paths()
        with patch.dict(os.environ, {"PRISMA_RUNTIME_STATE_DIR": r"D:\PrismaState"}, clear=True):
            relocated = runtime_paths()

        configured = defaults.channel_a_configuration
        self.assertIsInstance(configured, Path)
        self.assertNotEqual(configured.name, "")
        self.assertEqual(configured.parent, defaults.root)
        self.assertNotIn(
            configured.name,
            {defaults.voice_config.name, defaults.snapshot.name, defaults.chat_state.name},
        )
        self.assertEqual(relocated.channel_a_configuration, Path(r"D:\PrismaState") / configured.name)


class ChannelARootManagerSeamTests(RootHarness, unittest.TestCase):
    """RCA-5l: the optional ``channel_a_manager`` injection seam on ``create_app``.

    The default composition keeps building exactly one inert manager for the
    admin boundary and the root configuration. An explicitly injected manager
    is shared as-is and never replaced; an injected admin boundary without a
    manager leaves the configuration key honestly ``None`` with no duplicate
    composition; the existing default root composition stays inert. An
    injected admin boundary owns its already-constructed collaborators: the
    root never mutates a supplied boundary, and only the default-built
    boundary receives the composed manager. The seam is construction wiring
    only and stays inert.
    """

    def setUp(self):
        self.install_offline_guards()
        self.isolate_runtime_state()
        self.reset_doubles(
            ChannelAManagerDouble,
            ChannelAActivationDouble,
            ChannelATransportDouble,
            ChannelAConfigurationStoreDouble,
            AdminHttpBoundaryDouble,
            TelegramLifecycleManagerDouble,
            TelegramLocalBotDouble,
        )
        self.reservation = InertReservation()

        from prisma_runtime import local_presentation

        self.module = local_presentation
        for module, name, value, create in (
            (local_presentation, "ChannelAManager", ChannelAManagerDouble, True),
            (local_presentation, "AdminHttpBoundary", AdminHttpBoundaryDouble, False),
            (local_presentation, "TelegramLifecycleManager", TelegramLifecycleManagerDouble, False),
            (local_presentation, "TelegramLocalBot", TelegramLocalBotDouble, False),
        ):
            self.patch_target(module, name, value, create=create)
        self.patch_target(
            local_presentation, "process_bot_identity_reservation", lambda: self.reservation
        )

    def compose(self, **overrides):
        from prisma_runtime.telegram_config import TelegramConfig

        self.events = self.module.VoiceEventStore()
        self.registry = self.build_session_registry(self.events)
        arguments = {
            "snapshot_store": self.module.JsonFileStore(self.state_root / "snapshot.json"),
            "voice_events": self.events,
            "telegram_configuration": TelegramConfig(enabled=False, token=""),
            "session_registry": self.registry,
        }
        arguments.update(overrides)
        return self.module.create_app(**arguments)

    def test_injected_channel_a_manager_is_shared_with_admin_and_root_never_replaced(self):
        injected = object()
        app = self.compose(channel_a_manager=injected)

        # The seam must not compose a replacement manager: zero doubles built.
        self.assertEqual(ChannelAManagerDouble.instances, ())
        boundary = self.single(AdminHttpBoundaryDouble)
        self.assertIs(boundary.channel_a_manager, injected)
        self.assertIs(app.config["channel_a_manager"], injected)

    def test_injected_admin_boundary_without_a_manager_keeps_the_manager_none(self):
        admin = AdminHttpBoundaryDouble()
        app = self.compose(admin_http=admin)

        self.assertIs(admin.registered_app, app)
        self.assertIsNone(admin.channel_a_manager)
        self.assertIsNone(app.config["channel_a_manager"])
        # No duplicate Channel A or B composition either: the injected
        # boundary already owns its collaborators.
        self.assertEqual(ChannelAManagerDouble.instances, ())
        self.assertEqual(TelegramLifecycleManagerDouble.instances, ())

    def test_injected_manager_is_honored_alongside_an_injected_admin_boundary(self):
        injected = object()
        # An injected boundary owns its collaborators: it is constructed with
        # the manager it already holds, and the root must preserve it verbatim
        # instead of mutating a supplied boundary's wiring.
        admin = AdminHttpBoundaryDouble(channel_a_manager=injected)
        app = self.compose(admin_http=admin, channel_a_manager=injected)

        self.assertIs(admin.registered_app, app)
        self.assertIs(admin.channel_a_manager, injected)
        self.assertIs(app.config["channel_a_manager"], injected)
        self.assertEqual(ChannelAManagerDouble.instances, ())


if __name__ == "__main__":
    unittest.main()
