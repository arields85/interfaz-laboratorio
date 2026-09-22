"""RCA-5f test-first manager contract over deterministic inert boundaries.

No real runner, credential store, provider client, filesystem, worker, sleep or
clock is used. New production modules are imported only inside guarded setUp.
The credential fake implements the actual provider-keyed service protocol; the
manager must construct the existing resolver over that SAME service.

Exceptions proposed here are RuntimeError subclasses with fixed code messages.
Successful mutations except stop return the same six-field status contract;
stop returns an exact bool. Reentrant callbacks only collect evidence: assertions
run outside foreign calls so a production catch cannot swallow an oracle.
"""

from __future__ import annotations

import sys
import traceback
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

A = "telegram_channel_a"
TOKEN = "123456:offline-only-secret-canary"
CANARY = "private/path/raw-exception-canary"
BUSY = "PRISMA_CHANNEL_A_MANAGER_BUSY"
STOP_UNCONFIRMED = "PRISMA_CHANNEL_A_STOP_UNCONFIRMED"
CONFIG_INVALID = "PRISMA_CHANNEL_A_CONFIGURATION_INVALID"
CONFIG_UNAVAILABLE = "PRISMA_CHANNEL_A_CONFIGURATION_UNAVAILABLE"
CREDENTIAL_UNAVAILABLE = "PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE"
CREDENTIAL_MISSING = "PRISMA_CHANNEL_A_CREDENTIAL_MISSING"
INVALID_CREDENTIAL = "INVALID_CREDENTIAL_REQUEST"
LIFECYCLE_UNAVAILABLE = "PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE"
COLLISION = "TELEGRAM_BOT_IDENTITY_RESERVED"
STATUS_KEYS = {
    "configured", "desiredGeneration", "appliedGeneration",
    "activationEpoch", "activation", "lastError",
}


class FakeCredentials:
    def __init__(self, ledger):
        self.ledger = ledger
        self.secret = TOKEN
        self.metadata = {"gemini": True, "telegram": True, A: True}
        self.fail = {}
        self.callback = None

    def event(self, name, *args):
        self.ledger.append((name, *args))
        if self.callback is not None:
            self.callback(name)
        if name in self.fail:
            raise self.fail[name]

    def status(self):
        self.event("credentials.status")
        return dict(self.metadata)

    def get_secret(self, provider):
        self.event("credentials.get", provider)
        return self.secret

    def set_secret(self, provider, secret):
        self.event("credentials.set", provider)
        self.secret = secret
        self.metadata[provider] = True

    def delete_secret(self, provider):
        self.event("credentials.delete", provider)
        self.secret = None
        self.metadata[provider] = False


class FakeConfigurationStore:
    def __init__(self, ledger, snapshot_type, error_type):
        self.ledger = ledger
        self.Snapshot = snapshot_type
        self.Error = error_type
        self.snapshot = snapshot_type(60, 0)
        self.fail = {}
        self.callback = None

    def event(self, name, *args):
        self.ledger.append((name, *args))
        if self.callback is not None:
            self.callback(name)
        if name in self.fail:
            raise self.fail[name]

    def read(self):
        self.event("configuration.read")
        return self.snapshot

    def advance_generation(self):
        self.event("configuration.advance")
        self.snapshot = replace(self.snapshot, desired_generation=self.snapshot.desired_generation + 1)
        return self.snapshot

    def set_warning_lead(self, value):
        self.event("configuration.policy", value)
        if type(value) is not int or not 15 <= value <= 300:
            raise self.Error(CONFIG_INVALID)
        if value != self.snapshot.warning_lead_seconds:
            self.snapshot = self.Snapshot(value, self.snapshot.desired_generation + 1)
        return self.snapshot


class ForbiddenManagerReservation:
    """A passive incumbent sentinel; only activations may own lease operations."""

    def __init__(self):
        self.calls = []
        self.incumbent = object()

    def acquire(self, *args, **kwargs):
        self.calls.append("acquire")
        raise RuntimeError(CANARY)

    def release(self, *args, **kwargs):
        self.calls.append("release")
        raise RuntimeError(CANARY)


class FakeActivation:
    def __init__(self, ledger, name, status_type):
        self.ledger = ledger
        self.name = name
        self.Status = status_type
        self.observed = status_type("idle", None, True, False)
        self.prepare_result = True
        self.start_result = True
        self.stop_result = True
        self.start_observed = status_type("running", None, False, False)
        self.fail = {}
        self.callback = None

    def event(self, operation):
        self.ledger.append((self.name, operation))
        if self.callback is not None:
            self.callback(operation)
        if operation in self.fail:
            raise self.fail[operation]

    def prepare(self):
        self.event("prepare")
        if self.prepare_result is True:
            self.observed = self.Status("prepared", None, True, False)
        return self.prepare_result

    def start(self):
        self.event("start")
        if self.start_result is True:
            self.observed = self.start_observed
        return self.start_result

    def status(self):
        self.event("status")
        return self.observed

    def stop(self):
        self.event("stop")
        if self.stop_result is True:
            self.observed = self.Status("stopped", None, True, False)
        return self.stop_result


class ChannelAManagerTests(unittest.TestCase):
    def setUp(self):
        self.dispatches = []

        def refuse(*args, **kwargs):
            self.dispatches.append(1)
            raise RuntimeError("OFFLINE_DISPATCH_REFUSED")

        guard = patch.object(requests.Session, "request", refuse)
        guard.start()
        self.addCleanup(guard.stop)
        self.addCleanup(self.assertEqual, self.dispatches, [])
        # No ImportError fallback: first RED is honestly missing-module evidence.
        from prisma_runtime.channel_a_configuration import ChannelAConfiguration, ChannelAConfigurationError
        from prisma_runtime.channel_a_manager import ChannelAManager, ChannelAManagerError
        from prisma_runtime.channel_a_lifecycle import ChannelAStatus, ChannelALifecycleError

        self.Manager = ChannelAManager
        self.Error = ChannelAManagerError
        self.ConfigError = ChannelAConfigurationError
        self.LifecycleError = ChannelALifecycleError
        self.Snapshot = ChannelAConfiguration
        self.Status = ChannelAStatus
        self.ledger = []
        self.credentials = FakeCredentials(self.ledger)
        self.store = FakeConfigurationStore(self.ledger, self.Snapshot, self.ConfigError)
        self.reservation = ForbiddenManagerReservation()
        self.addCleanup(self.assertEqual, self.reservation.calls, [])
        self.candidates = []
        self.factory_calls = []
        self.factory_result = None
        self.factory_error = None
        self.factory_callback = None
        self.manager = self.Manager(
            credential_service=self.credentials,
            configuration_store=self.store,
            activation_factory=self.factory,
            reservation=self.reservation,
        )

    def factory(self, token, snapshot, epoch, reservation):
        # Exactly four positional arguments; no prepare/start side effects here.
        self.ledger.append(("factory",))
        self.factory_calls.append((token, snapshot, epoch, reservation))
        if self.factory_callback is not None:
            self.factory_callback()
        if self.factory_error is not None:
            raise self.factory_error
        candidate = self.factory_result
        if candidate is None:
            candidate = self.new_candidate()
        self.candidates.append(candidate)
        return candidate

    def new_candidate(self):
        return FakeActivation(self.ledger, "candidate-" + str(len(self.candidates) + 1), self.Status)

    def names(self):
        return [entry[0] for entry in self.ledger]

    def effects(self):
        """Ignore observational reads, not secret resolution or lifecycle effects."""
        return [entry for entry in self.ledger if entry[0] not in (
            "credentials.status", "configuration.read",
        ) and not (len(entry) == 2 and entry[1] == "status")]

    def assert_status(self, result, *, configured=True, desired=0, applied=None, epoch=None, activation=None, error=None):
        self.assertIs(type(result), dict)
        self.assertEqual(set(result), STATUS_KEYS)
        self.assertIs(result["configured"], configured)
        self.assertEqual(result["desiredGeneration"], desired)
        self.assertEqual(result["appliedGeneration"], applied)
        self.assertEqual(result["activationEpoch"], epoch)
        self.assertIs(result["activation"], activation)
        if activation is not None:
            self.assertIsInstance(activation, self.Status)
        self.assertEqual(result["lastError"], error)
        self.assertNotIn(TOKEN, repr(result))
        self.assertNotIn(CANARY, repr(result))

    def assert_sanitized_exception_chain(self, error):
        """Check retained cause/context only, even when display suppresses them.

        Caller-owned fixtures and traceback locals deliberately hold canaries;
        they are not part of this exception-chain retention oracle.
        """
        pending = [error]
        seen = set()
        while pending:
            current = pending.pop()
            if id(current) in seen:
                continue
            seen.add(id(current))
            for text in (repr(current.args), str(current), repr(current)):
                for marker in (TOKEN, CANARY):
                    self.assertTrue(marker not in text, "retained exception chain contains a canary")
            for linked in (current.__cause__, current.__context__):
                if linked is not None:
                    pending.append(linked)

    def assert_error(self, code, operation):
        with self.assertRaises(self.Error) as caught:
            operation()
        self.assertIsInstance(caught.exception, RuntimeError)
        self.assertEqual(str(caught.exception), code)
        self.assertNotIn(TOKEN, repr(caught.exception))
        self.assertNotIn(CANARY, repr(caught.exception))
        rendered = "".join(traceback.format_exception(caught.exception))
        self.assertNotIn(TOKEN, rendered)
        self.assertNotIn(CANARY, rendered)
        self.assert_sanitized_exception_chain(caught.exception)
        return caught.exception

    def test_exception_chain_oracle_detects_display_suppressed_nested_canaries(self):
        # Oracle control only; actual manager regressions use the existing
        # credentials.set and factory_error cases below, not these errors.
        for link in ("__context__", "__cause__"):
            for marker in (TOKEN, CANARY):
                with self.subTest(link=link, marker_kind="token" if marker == TOKEN else "path"):
                    raw = OSError(marker)
                    intermediate = RuntimeError(CREDENTIAL_UNAVAILABLE)
                    setattr(intermediate, link, raw)
                    sanitized = self.Error(CREDENTIAL_UNAVAILABLE)
                    sanitized.__context__ = intermediate
                    sanitized.__suppress_context__ = True
                    rendered = "".join(traceback.format_exception(sanitized))
                    self.assertNotIn(marker, rendered)
                    with self.assertRaisesRegex(AssertionError, "retained exception chain contains a canary"):
                        self.assert_sanitized_exception_chain(sanitized)
        self.assertEqual(self.ledger, [])
        self.assertEqual(self.factory_calls, [])

    def test_exception_chain_oracle_accepts_detached_and_safe_cyclic_chains(self):
        sanitized = self.Error(CREDENTIAL_UNAVAILABLE)
        self.assert_sanitized_exception_chain(sanitized)
        # Safe links need not be empty; repeated identities must terminate.
        safe = RuntimeError(CREDENTIAL_UNAVAILABLE)
        sanitized.__context__ = safe
        sanitized.__cause__ = safe
        safe.__context__ = sanitized
        self.assert_sanitized_exception_chain(sanitized)
        self.assertEqual(self.ledger, [])
        self.assertEqual(self.factory_calls, [])

    def applied(self):
        result = self.manager.apply()
        candidate = self.candidates[-1]
        self.assertIsNotNone(result["activationEpoch"])
        self.assert_status(result, desired=self.store.snapshot.desired_generation,
                           applied=self.store.snapshot.desired_generation,
                           epoch=result["activationEpoch"], activation=candidate.observed)
        return candidate, result

    def test_constructor_cold_start_is_inert_and_status_is_fresh_honest_metadata(self):
        self.assertEqual(self.ledger, [])
        self.assertEqual(self.factory_calls, [])
        self.assert_status(self.manager.status())
        first = self.manager.status()
        second = self.manager.status()
        self.assertIsNot(first, second)
        first["configured"] = False
        self.assert_status(second)
        self.credentials.metadata[A] = False
        self.assert_status(self.manager.status(), configured=False)
        self.assertEqual(self.effects(), [])

    def test_save_reserves_generation_before_only_a_write_without_resolution(self):
        self.credentials.secret = None
        self.credentials.metadata[A] = False
        result = self.manager.save_credential(TOKEN)
        self.assert_status(result, desired=1)
        self.assertEqual(self.effects(), [("configuration.advance",), ("credentials.set", A)])
        self.assertEqual(self.factory_calls, [])
        self.assertEqual(self.credentials.secret, TOKEN)
        self.assertNotIn(TOKEN, repr(self.manager))

    def test_save_preserves_existing_secret_byte_limit_and_validation(self):
        for secret in (None, "", "   ", True, "x" * 4097, "é" * 2049, "\ud800"):
            with self.subTest(secret_type=type(secret).__name__, length=len(secret) if isinstance(secret, str) else None):
                self.ledger.clear()
                self.assert_error(INVALID_CREDENTIAL, lambda: self.manager.save_credential(secret))
                self.assertEqual(self.effects(), [])
                self.assertEqual(self.store.snapshot.desired_generation, 0)
                self.assertEqual(self.credentials.secret, TOKEN)
        result = self.manager.save_credential("é" * 2048)
        self.assert_status(result, desired=1)
        self.assertEqual(self.credentials.secret, "é" * 2048)

    def test_generation_failure_prevents_all_credential_io_for_save_and_delete(self):
        self.store.fail["configuration.advance"] = self.ConfigError(CONFIG_UNAVAILABLE)
        for operation in (lambda: self.manager.save_credential(TOKEN), self.manager.delete_credential):
            with self.subTest(operation=operation.__name__):
                self.ledger.clear()
                self.assert_error(CONFIG_UNAVAILABLE, operation)
                self.assertFalse(any(name.startswith("credentials.") for name in self.names()))
                self.assertEqual(self.store.snapshot.desired_generation, 0)
        self.store.fail.clear()
        self.assert_status(self.manager.status(), error=CONFIG_UNAVAILABLE)

    def test_credential_write_failure_consumes_generation_without_rollback(self):
        # assert_error checks the actual manager's retained dependency chain.
        self.credentials.fail["credentials.set"] = OSError(CANARY + TOKEN)
        self.assert_error(CREDENTIAL_UNAVAILABLE, lambda: self.manager.save_credential("replacement"))
        self.assertEqual(self.store.snapshot.desired_generation, 1)
        self.assertEqual(self.credentials.secret, TOKEN)
        self.assert_status(self.manager.status(), desired=1, error=CREDENTIAL_UNAVAILABLE)
        self.assertEqual(self.effects(), [("configuration.advance",), ("credentials.set", A)])
        self.credentials.fail.clear()
        self.assert_status(self.manager.save_credential("replacement"), desired=2)
        self.assertEqual(self.credentials.secret, "replacement")

    def test_policy_is_passive_idempotent_and_invalid_values_have_no_change(self):
        self.assert_status(self.manager.set_warning_lead(60))
        self.assert_status(self.manager.set_warning_lead(15), desired=1)
        self.assert_status(self.manager.set_warning_lead(15), desired=1)
        for value in (True, 15.0, 14, 301):
            with self.subTest(value=value):
                self.assert_error(CONFIG_INVALID, lambda: self.manager.set_warning_lead(value))
                self.assertEqual(self.store.snapshot, self.Snapshot(15, 1))
        self.assertNotIn("credentials.get", self.names())
        self.assertEqual(self.factory_calls, [])

    def test_apply_resolves_same_service_once_then_prepares_starts_and_observes(self):
        candidate, result = self.applied()
        self.assertEqual(self.effects(), [
            ("credentials.get", A), ("factory",),
            (candidate.name, "prepare"), (candidate.name, "start"),
        ])
        start_index = self.ledger.index((candidate.name, "start"))
        self.assertIn((candidate.name, "status"), self.ledger[start_index + 1:])
        token, snapshot, epoch, reservation = self.factory_calls[0]
        self.assertEqual(token, TOKEN)
        self.assertIs(snapshot, self.store.snapshot)
        self.assertEqual(epoch, result["activationEpoch"])
        self.assertIs(reservation, self.reservation)
        self.assertNotIn(TOKEN, repr(self.manager))

    def test_running_same_generation_apply_is_no_effect_idempotent(self):
        candidate, first = self.applied()
        self.ledger.clear()
        second = self.manager.apply()
        self.assert_status(second, applied=0, epoch=first["activationEpoch"], activation=candidate.observed)
        self.assertEqual(self.effects(), [])
        self.assertEqual(len(self.factory_calls), 1)

    def test_policy_and_credential_changes_leave_old_running_until_fresh_apply(self):
        old, first = self.applied()
        self.ledger.clear()
        self.assert_status(self.manager.set_warning_lead(120), desired=1, applied=0,
                           epoch=first["activationEpoch"], activation=old.observed)
        self.assert_status(self.manager.save_credential("new-offline-token"), desired=2, applied=0,
                           epoch=first["activationEpoch"], activation=old.observed)
        self.assertFalse(any(entry[0] == old.name for entry in self.effects()))
        self.assertNotIn("credentials.get", self.names())
        self.ledger.clear()
        fresh, second = self.applied()
        self.assertIsNot(fresh, old)
        self.assertNotEqual(first["activationEpoch"], second["activationEpoch"])
        self.assertEqual(self.effects()[:3], [(old.name, "stop"), ("credentials.get", A), ("factory",)])
        self.assertEqual(self.factory_calls[-1][:2], ("new-offline-token", self.Snapshot(120, 2)))
        self.assertTrue(all(call[3] is self.reservation for call in self.factory_calls))

    def test_retired_or_restart_required_status_forces_new_attempt_at_same_generation(self):
        for status in (self.Status("retired", None, True, True), self.Status("running", None, False, True)):
            with self.subTest(status=status):
                old, first = self.applied()
                old.observed = status
                self.ledger.clear()
                fresh, second = self.applied()
                self.assertIsNot(fresh, old)
                self.assertNotEqual(second["activationEpoch"], first["activationEpoch"])
                self.assertEqual(self.effects()[:3], [(old.name, "stop"), ("credentials.get", A), ("factory",)])

    def test_old_stop_false_or_exception_retains_public_identity_and_retries_first(self):
        for failure in (False, RuntimeError(CANARY + TOKEN)):
            with self.subTest(failure_type=type(failure).__name__):
                old, before = self.applied()
                self.manager.set_warning_lead(90 if self.store.snapshot.warning_lead_seconds != 90 else 120)
                if failure is False:
                    old.stop_result = False
                else:
                    old.fail["stop"] = failure
                self.ledger.clear()
                self.assert_error(STOP_UNCONFIRMED, self.manager.apply)
                self.assertEqual(self.effects(), [(old.name, "stop")])
                self.assert_status(self.manager.status(), desired=self.store.snapshot.desired_generation,
                                   applied=before["appliedGeneration"], epoch=before["activationEpoch"],
                                   activation=old.observed, error=STOP_UNCONFIRMED)
                old.stop_result = True
                old.fail.clear()
                self.ledger.clear()
                fresh, _ = self.applied()
                self.assertIsNot(fresh, old)
                self.assertEqual(self.effects()[:3], [(old.name, "stop"), ("credentials.get", A), ("factory",)])

    def test_candidate_is_attached_before_prepare_without_publishing_identity(self):
        candidate = self.new_candidate()
        self.factory_result = candidate
        observations = []
        initial_status = candidate.observed

        def observe(operation):
            if operation == "prepare":
                observations.append(self.manager.status())

        candidate.callback = observe
        self.applied()
        self.assertEqual(len(observations), 1)
        observed = observations[0]
        self.assert_status(observed, activation=initial_status)

    def test_prepare_and_start_false_cleanup_retains_pending_candidate_on_uncertainty(self):
        for operation in ("prepare", "start"):
            with self.subTest(operation=operation):
                self.assertTrue(self.manager.stop())
                candidate = self.new_candidate()
                setattr(candidate, operation + "_result", False)
                candidate.stop_result = False
                self.factory_result = candidate
                self.ledger.clear()
                self.assert_error(LIFECYCLE_UNAVAILABLE, self.manager.apply)
                first_epoch = self.factory_calls[-1][2]
                self.assert_status(self.manager.status(), activation=candidate.observed, error=LIFECYCLE_UNAVAILABLE)
                self.assertEqual(self.ledger.count((candidate.name, operation)), 1)
                self.assertEqual(self.ledger.count((candidate.name, "stop")), 1)
                if operation == "prepare":
                    self.assertNotIn((candidate.name, "start"), self.ledger)
                self.ledger.clear()
                self.assert_error(STOP_UNCONFIRMED, self.manager.apply)
                self.assertEqual(self.effects(), [(candidate.name, "stop")])
                candidate.stop_result = True
                self.factory_result = None
                self.ledger.clear()
                fresh, result = self.applied()
                self.assertIsNot(fresh, candidate)
                self.assertNotEqual(first_epoch, result["activationEpoch"])
                self.assertEqual(self.effects()[:3], [(candidate.name, "stop"), ("credentials.get", A), ("factory",)])

    def test_start_success_requires_actual_running_without_restart(self):
        for status in (self.Status("prepared", None, True, False), self.Status("running", None, False, True)):
            with self.subTest(status=status):
                candidate = self.new_candidate()
                candidate.start_observed = status
                self.factory_result = candidate
                self.assert_error(LIFECYCLE_UNAVAILABLE, self.manager.apply)
                self.assertIn((candidate.name, "stop"), self.ledger)
                self.assert_status(self.manager.status(), error=LIFECYCLE_UNAVAILABLE)

    def test_foreign_lifecycle_exceptions_are_sanitized_and_cleanup_is_attempted(self):
        for operation in ("prepare", "start", "status"):
            with self.subTest(operation=operation):
                candidate = self.new_candidate()
                candidate.fail[operation] = RuntimeError(CANARY + TOKEN)
                self.factory_result = candidate
                self.assert_error(LIFECYCLE_UNAVAILABLE, self.manager.apply)
                self.assertIn((candidate.name, "stop"), self.ledger)
                self.assert_status(self.manager.status(), error=LIFECYCLE_UNAVAILABLE)

    def test_uncertain_exception_cleanup_retains_candidate_until_confirmed_stop(self):
        candidate = self.new_candidate()
        candidate.fail["prepare"] = RuntimeError(CANARY)
        candidate.fail["stop"] = RuntimeError(TOKEN)
        self.factory_result = candidate
        self.assert_error(LIFECYCLE_UNAVAILABLE, self.manager.apply)
        self.assert_status(self.manager.status(), activation=candidate.observed, error=LIFECYCLE_UNAVAILABLE)
        self.ledger.clear()
        self.assertIs(self.manager.stop(), False)
        self.assertEqual(self.effects(), [(candidate.name, "stop")])
        candidate.fail.clear()
        self.assertIs(self.manager.stop(), True)
        self.assertIsNone(self.manager.status()["activation"])

    def test_factory_failure_never_publishes_identity_or_reuses_attempt_epoch(self):
        # Factory failures must not retain raw exceptions behind sanitized ones.
        self.factory_error = RuntimeError(CANARY + TOKEN)
        self.assert_error(LIFECYCLE_UNAVAILABLE, self.manager.apply)
        failed_epoch = self.factory_calls[0][2]
        self.assert_status(self.manager.status(), error=LIFECYCLE_UNAVAILABLE)
        self.factory_error = None
        _, result = self.applied()
        self.assertNotEqual(failed_epoch, result["activationEpoch"])

    def test_identity_collision_preserves_incumbent_without_manager_lease_operations(self):
        incumbent = self.reservation.incumbent
        candidate = self.new_candidate()
        candidate.fail["prepare"] = self.LifecycleError(COLLISION)
        self.factory_result = candidate
        self.assert_error(COLLISION, self.manager.apply)
        self.assertIs(self.reservation.incumbent, incumbent)
        self.assertEqual(self.reservation.calls, [])
        self.assertNotIn((candidate.name, "start"), self.ledger)
        self.assertIn((candidate.name, "stop"), self.ledger)
        self.assert_status(self.manager.status(), error=COLLISION)

    def test_factory_cannot_recycle_current_or_just_retired_instance(self):
        old, _ = self.applied()
        self.factory_result = old
        self.manager.set_warning_lead(90)
        self.ledger.clear()
        self.assert_error(LIFECYCLE_UNAVAILABLE, self.manager.apply)
        self.assertNotIn((old.name, "prepare"), self.ledger)
        self.assertNotIn((old.name, "start"), self.ledger)
        self.assertIsNone(self.manager.status()["activation"])
        self.ledger.clear()
        self.assert_error(LIFECYCLE_UNAVAILABLE, self.manager.apply)
        self.assertNotIn((old.name, "prepare"), self.ledger)
        self.assertNotIn((old.name, "start"), self.ledger)

    def test_delete_reserves_then_deletes_only_a_then_stops(self):
        old, _ = self.applied()
        self.ledger.clear()
        self.assert_status(self.manager.delete_credential(), configured=False, desired=1)
        self.assertEqual(self.effects(), [("configuration.advance",), ("credentials.delete", A), (old.name, "stop")])
        self.assertTrue(self.credentials.metadata["telegram"])
        self.assertTrue(self.credentials.metadata["gemini"])
        self.assertIsNone(self.credentials.secret)

    def test_delete_uncertain_stop_retains_instance_even_after_secret_is_removed(self):
        for raises in (False, True):
            with self.subTest(raises=raises):
                self.manager.save_credential(TOKEN)
                old, before = self.applied()
                if raises:
                    old.fail["stop"] = RuntimeError(CANARY)
                else:
                    old.stop_result = False
                self.ledger.clear()
                self.assert_error(STOP_UNCONFIRMED, self.manager.delete_credential)
                self.assertEqual(self.effects(), [("configuration.advance",), ("credentials.delete", A), (old.name, "stop")])
                self.assert_status(self.manager.status(), configured=False, desired=self.store.snapshot.desired_generation,
                                   applied=before["appliedGeneration"], epoch=before["activationEpoch"],
                                   activation=old.observed, error=STOP_UNCONFIRMED)
                self.assertIsNone(self.credentials.secret)
                old.fail.clear()
                old.stop_result = True
                self.assertIs(self.manager.stop(), True)

    def test_failed_secret_delete_consumes_generation_but_does_not_stop(self):
        old, before = self.applied()
        self.credentials.fail["credentials.delete"] = RuntimeError(TOKEN + CANARY)
        self.ledger.clear()
        self.assert_error(CREDENTIAL_UNAVAILABLE, self.manager.delete_credential)
        self.assertEqual(self.effects(), [("configuration.advance",), ("credentials.delete", A)])
        self.assert_status(self.manager.status(), desired=1, applied=0, epoch=before["activationEpoch"],
                           activation=old.observed, error=CREDENTIAL_UNAVAILABLE)

    def test_stop_uncertain_retains_then_confirmed_stop_is_idempotent_and_passive(self):
        old, before = self.applied()
        old.stop_result = False
        self.ledger.clear()
        self.assertIs(self.manager.stop(), False)
        self.assert_status(self.manager.status(), applied=0, epoch=before["activationEpoch"],
                           activation=old.observed, error=STOP_UNCONFIRMED)
        old.stop_result = True
        self.assertIs(self.manager.stop(), True)
        self.assertIsNone(self.manager.status()["activation"])
        self.assertIsNone(self.manager.status()["activationEpoch"])
        self.assertIsNone(self.manager.status()["appliedGeneration"])
        effects = self.effects()
        self.assertEqual(effects, [(old.name, "stop"), (old.name, "stop")])
        self.assertIs(self.manager.stop(), True)
        self.assertEqual(self.effects(), effects)
        self.assertEqual(self.store.snapshot, self.Snapshot(60, 0))
        self.assertEqual(self.credentials.secret, TOKEN)

    def test_unknown_metadata_is_unavailable_not_false_missing_or_resolution(self):
        for value in (None, 0, 1, "true"):
            with self.subTest(value=value):
                self.credentials.metadata[A] = value
                self.assert_error(CREDENTIAL_UNAVAILABLE, self.manager.status)
        self.credentials.metadata.pop(A)
        self.assert_error(CREDENTIAL_UNAVAILABLE, self.manager.status)
        self.credentials.fail["credentials.status"] = RuntimeError(TOKEN + CANARY)
        self.assert_error(CREDENTIAL_UNAVAILABLE, self.manager.status)
        self.assertNotIn("credentials.get", self.names())
        self.credentials.fail.clear()
        self.credentials.metadata[A] = True
        self.assert_status(self.manager.status(), error=CREDENTIAL_UNAVAILABLE)

    def test_missing_and_unavailable_secret_are_closed_apply_failures(self):
        self.credentials.secret = None
        self.assert_error(CREDENTIAL_MISSING, self.manager.apply)
        self.assertEqual(self.factory_calls, [])
        self.assert_status(self.manager.status(), error=CREDENTIAL_MISSING)
        self.credentials.fail["credentials.get"] = RuntimeError(TOKEN + CANARY)
        self.assert_error(CREDENTIAL_UNAVAILABLE, self.manager.apply)
        self.assert_status(self.manager.status(), error=CREDENTIAL_UNAVAILABLE)
        self.assertEqual(self.factory_calls, [])
        self.assertEqual([entry for entry in self.ledger if entry[0] == "credentials.get"], [("credentials.get", A)] * 2)

    def test_configuration_read_unavailability_is_sanitized_without_resolution(self):
        self.store.fail["configuration.read"] = OSError(TOKEN + CANARY)
        self.assert_error(CONFIG_UNAVAILABLE, self.manager.status)
        self.assert_error(CONFIG_UNAVAILABLE, self.manager.apply)
        self.assertNotIn("credentials.get", self.names())
        self.assertEqual(self.factory_calls, [])
        self.store.fail.clear()
        self.assert_status(self.manager.status(), error=CONFIG_UNAVAILABLE)

    def test_status_observes_actual_activation_without_restart_or_secret_resolution(self):
        candidate, first = self.applied()
        candidate.observed = self.Status("retired", None, True, True)
        self.ledger.clear()
        self.assert_status(self.manager.status(), applied=0, epoch=first["activationEpoch"],
                           activation=candidate.observed)
        self.assertEqual(self.effects(), [])
        candidate.fail["status"] = RuntimeError(TOKEN + CANARY)
        self.assert_error(LIFECYCLE_UNAVAILABLE, self.manager.status)
        candidate.fail.clear()
        self.assert_status(self.manager.status(), applied=0, epoch=first["activationEpoch"],
                           activation=candidate.observed, error=LIFECYCLE_UNAVAILABLE)
        self.assertEqual(self.effects(), [])

    def test_save_policy_delete_and_stop_callbacks_refuse_reentrant_apply(self):
        old, _ = self.applied()
        observations = []

        def probe(boundary):
            if boundary not in {"configuration.advance", "configuration.policy", "credentials.set", "credentials.delete", "stop"}:
                return
            try:
                self.manager.apply()
            except Exception as error:
                observations.append((boundary, type(error), str(error)))
            else:
                observations.append((boundary, None, None))

        self.store.callback = probe
        self.credentials.callback = probe
        old.callback = probe
        self.manager.save_credential(TOKEN)
        self.manager.set_warning_lead(90)
        self.manager.delete_credential()
        self.store.callback = None
        self.credentials.callback = None
        old.callback = None
        self.assertEqual(observations, [
            ("configuration.advance", self.Error, BUSY),
            ("credentials.set", self.Error, BUSY),
            ("configuration.policy", self.Error, BUSY),
            ("configuration.advance", self.Error, BUSY),
            ("credentials.delete", self.Error, BUSY),
            ("stop", self.Error, BUSY),
        ])
        self.assertEqual(len(self.factory_calls), 1)
        self.assertEqual(self.store.snapshot, self.Snapshot(90, 3))
        self.assert_status(self.manager.status(), configured=False, desired=3)

    def test_reentrant_mutations_are_busy_at_foreign_boundaries_without_clobbering_error(self):
        # Seed an observable incumbent error before a successful outer operation.
        self.assert_error(CONFIG_INVALID, lambda: self.manager.set_warning_lead(14))
        observed = []
        probing = [False]

        def probe(boundary):
            if probing[0]:
                return
            probing[0] = True
            try:
                before = self.manager.status()["lastError"]
                errors = []
                for operation in (
                    lambda: self.manager.save_credential("reentrant"),
                    lambda: self.manager.set_warning_lead(300),
                    self.manager.apply, self.manager.delete_credential, self.manager.stop,
                ):
                    try:
                        operation()
                    except Exception as error:
                        errors.append((type(error), str(error)))
                    else:
                        errors.append((None, None))
                after = self.manager.status()["lastError"]
                observed.append((boundary, before, after, errors))
            finally:
                probing[0] = False

        self.store.callback = probe
        self.credentials.callback = probe
        self.factory_callback = lambda: probe("factory")
        candidate = self.new_candidate()
        candidate.callback = probe
        self.factory_result = candidate
        self.applied()
        self.store.callback = None
        self.credentials.callback = None
        self.factory_callback = None
        candidate.callback = None
        self.assertTrue(observed)
        boundaries = {row[0] for row in observed}
        self.assertTrue({"configuration.read", "credentials.get", "factory", "prepare", "start", "status"} <= boundaries)
        for boundary, before, after, errors in observed:
            with self.subTest(boundary=boundary):
                self.assertEqual(errors, [(self.Error, BUSY)] * 5)
                self.assertEqual(after, before)
        self.assertEqual(self.store.snapshot, self.Snapshot(60, 0))
        self.assertEqual(self.credentials.secret, TOKEN)
        self.assertEqual(len(self.factory_calls), 1)
        self.assertNotIn("credentials.set", self.names())
        self.assertNotIn("credentials.delete", self.names())
        self.assertNotIn((candidate.name, "stop"), self.ledger)


from prisma_runtime.channel_a_pairing import (
    ChannelAPairingConflict,
    ChannelAPairingConfigInvalid,
    PRISMA_CHANNEL_A_CLOCK_INVALID,
    PRISMA_CHANNEL_A_CONFLICT,
)

PAIRING_OWNER = "00000000-0000-4000-8000-00000000000a"
PAIRING_VIEW = {"token": "b" * 43, "botUsername": "prisma_channel_a_bot", "expiresInSeconds": 42.0}


class PairingFakeActivation(FakeActivation):
    """FakeActivation with the additive RCA-5l pairing surface and mid-call hooks.

    The manager's public issuance API is ``issue_pairing_challenge``, but the
    contract delegates it to the activation's ``issue_pairing_challenge_view``;
    this fake records the delegated call under the view's exact name.
    """

    def __init__(self, ledger, name, status_type):
        super().__init__(ledger, name, status_type)
        self.pairing_calls = []
        self.pairing_states = []
        self.pairing_issue_results = []
        self.pairing_status_error = None
        self.pairing_issue_error = None
        self.on_pairing_status = None
        self.on_pairing_issue = None

    def _pairing_event(self, operation):
        self.ledger.append((self.name, operation))
        if self.callback is not None:
            self.callback(operation)
        if operation in self.fail:
            raise self.fail[operation]

    def pairing_status(self, owner_id):
        self.pairing_calls.append(("pairing_status", owner_id))
        self._pairing_event("pairing_status")
        if self.on_pairing_status is not None:
            self.on_pairing_status()
        if self.pairing_status_error is not None:
            raise self.pairing_status_error
        return self.pairing_states.pop(0) if self.pairing_states else "free"

    def issue_pairing_challenge_view(self, owner_id):
        self.pairing_calls.append(("issue_pairing_challenge_view", owner_id))
        self._pairing_event("pairing_issue")
        if self.on_pairing_issue is not None:
            self.on_pairing_issue()
        if self.pairing_issue_error is not None:
            raise self.pairing_issue_error
        return self.pairing_issue_results.pop(0) if self.pairing_issue_results else None


class ChannelAManagerPairingTests(unittest.TestCase):
    """RCA-5l: additive pairing projection and issuance over the published activation.

    The manager observes the pairing state of its published activation only:
    no mutation gate, no configuration or credential read and no
    desired==applied requirement. Every foreign call stays outside the state
    lock and the publication is revalidated afterwards. A real pairing
    conflict is the one exception that survives; every other failure closes.

    Fixture-only reuse: this class deliberately extends ``unittest.TestCase``
    directly and delegates to the existing suite's helpers unbound, so none of
    its 31 prior test methods are collected twice here. The existing suite is
    untouched.
    """

    def setUp(self):
        self.dispatches = []

        def refuse(*args, **kwargs):
            self.dispatches.append(1)
            raise RuntimeError("OFFLINE_DISPATCH_REFUSED")

        guard = patch.object(requests.Session, "request", refuse)
        guard.start()
        self.addCleanup(guard.stop)
        self.addCleanup(self.assertEqual, self.dispatches, [])

        from prisma_runtime.channel_a_configuration import (
            ChannelAConfiguration,
            ChannelAConfigurationError,
        )
        from prisma_runtime.channel_a_lifecycle import ChannelAStatus
        from prisma_runtime.channel_a_manager import ChannelAManager, ChannelAManagerError

        self.Manager = ChannelAManager
        self.Error = ChannelAManagerError
        self.Status = ChannelAStatus
        self.ledger = []
        self.credentials = FakeCredentials(self.ledger)
        self.store = FakeConfigurationStore(self.ledger, ChannelAConfiguration, ChannelAConfigurationError)
        self.reservation = ForbiddenManagerReservation()
        self.addCleanup(self.assertEqual, self.reservation.calls, [])
        self.candidates = []
        self.factory_calls = []
        self.factory_result = None
        self.factory_error = None
        self.factory_callback = None
        self.manager = self.Manager(
            credential_service=self.credentials,
            configuration_store=self.store,
            activation_factory=self.factory,
            reservation=self.reservation,
        )

    # -- fixture-only delegates into the existing suite's helpers ----------

    def factory(self, token, snapshot, epoch, reservation):
        return ChannelAManagerTests.factory(self, token, snapshot, epoch, reservation)

    def new_candidate(self):
        return ChannelAManagerTests.new_candidate(self)

    def assert_status(self, result, **kwargs):
        return ChannelAManagerTests.assert_status(self, result, **kwargs)

    def assert_sanitized_exception_chain(self, error):
        return ChannelAManagerTests.assert_sanitized_exception_chain(self, error)

    def assert_error(self, code, operation):
        return ChannelAManagerTests.assert_error(self, code, operation)

    def applied(self):
        return ChannelAManagerTests.applied(self)

    def publish_pairing_candidate(self):
        candidate = PairingFakeActivation(self.ledger, "pairing-candidate", self.Status)
        self.factory_result = candidate
        self.applied()
        return candidate

    def test_pairing_status_projects_published_states_without_any_mutation_or_read(self):
        candidate = self.publish_pairing_candidate()
        published_epoch = self.manager.status()["activationEpoch"]
        self.ledger.clear()

        for expected in ("free", "pending", "linked"):
            with self.subTest(state=expected):
                candidate.pairing_states.append(expected)
                self.assertEqual(self.manager.pairing_status(PAIRING_OWNER), expected)
        self.assertEqual(candidate.pairing_calls, [("pairing_status", PAIRING_OWNER)] * 3)
        # Observation only: beyond the closed status read and the pairing
        # projection itself, the ledger must stay empty.
        self.assertEqual(
            [entry for entry in self.ledger if entry not in (
                ("pairing-candidate", "status"), ("pairing-candidate", "pairing_status"),
            )],
            [],
        )
        final = self.manager.status()
        self.assertEqual(final["lastError"], None)
        self.assertEqual(final["activationEpoch"], published_epoch)

    def test_pairing_status_fails_closed_on_absence_phase_and_broken_observations(self):
        # No published activation: unavailable, with zero foreign work.
        self.assertEqual(self.manager.pairing_status(PAIRING_OWNER), "unavailable")
        self.assertEqual(self.ledger, [])

        candidate = self.publish_pairing_candidate()
        self.ledger.clear()

        # Inactive or untrusted phases: refused before the foreign pairing call.
        for phase, reason, quiescent, restart in (
            ("stopped", None, True, False),
            ("running", None, False, True),
        ):
            with self.subTest(phase=phase, restart_required=restart):
                candidate.observed = self.Status(phase, reason, quiescent, restart)
                self.assertEqual(self.manager.pairing_status(PAIRING_OWNER), "unavailable")
                self.assertEqual(candidate.pairing_calls, [])

        # A broken status observation is closed into the unavailable state.
        candidate.observed = None
        self.assertEqual(self.manager.pairing_status(PAIRING_OWNER), "unavailable")
        self.assertEqual(candidate.pairing_calls, [])

        # A foreign pairing failure is closed too, never leaked.
        candidate.observed = self.Status("running", None, False, False)
        candidate.pairing_status_error = RuntimeError(CANARY)
        self.assertEqual(self.manager.pairing_status(PAIRING_OWNER), "unavailable")
        candidate.pairing_status_error = None

        # Publication withdrawn during the foreign call revalidates to
        # unavailable: a reentrant stop during the pairing observation wins.
        candidate.on_pairing_status = self.manager.stop
        self.assertEqual(self.manager.pairing_status(PAIRING_OWNER), "unavailable")

        # Observation never changes lastError or the lifecycle record.
        final = self.manager.status()
        self.assertEqual(final["lastError"], None)
        self.assertIsNone(final["activation"])

    def test_issue_pairing_challenge_passes_views_through_and_refuses_inactive_phases(self):
        # No published activation issues nothing.
        self.assertIsNone(self.manager.issue_pairing_challenge(PAIRING_OWNER))

        candidate = self.publish_pairing_candidate()

        view = dict(PAIRING_VIEW)
        candidate.pairing_issue_results.append(view)
        self.assertIs(self.manager.issue_pairing_challenge(PAIRING_OWNER), view)
        self.assertEqual(
            candidate.pairing_calls[-1], ("issue_pairing_challenge_view", PAIRING_OWNER)
        )

        candidate.pairing_issue_results.append(None)
        self.assertIsNone(self.manager.issue_pairing_challenge(PAIRING_OWNER))

        # Inactive or untrusted phases: refused before the foreign issuance.
        for phase, reason, quiescent, restart in (
            ("stopped", None, True, False),
            ("running", None, False, True),
        ):
            with self.subTest(phase=phase, restart_required=restart):
                calls_before = len(candidate.pairing_calls)
                candidate.observed = self.Status(phase, reason, quiescent, restart)
                self.assertIsNone(self.manager.issue_pairing_challenge(PAIRING_OWNER))
                self.assertEqual(len(candidate.pairing_calls), calls_before)

    def test_post_delegation_phase_and_restart_changes_fail_closed_without_withdrawal(self):
        """A same-publication observed-state change after the delegated call wins.

        Before every call the pre-call status observation is valid; only the
        delegated foreign pairing call itself mutates the activation's
        observed status (stopped/stopping, running+restartRequired, or a
        broken observation). The publication identity is never withdrawn, so
        the refusal comes purely from the post-call observation: identity
        alone is not authority. No lifecycle resurrection happens.
        """
        candidate = self.publish_pairing_candidate()
        before = self.manager.status()
        self.ledger.clear()

        rows = (
            ("stopped", self.Status("stopped", None, True, False)),
            ("stopping", self.Status("stopping", None, False, False)),
            ("restart_required", self.Status("running", None, False, True)),
            ("broken_observation", None),
        )
        for verb in ("pairing_status", "issue_pairing_challenge"):
            for label, mutated in rows:
                with self.subTest(verb=verb, state=label):
                    candidate.observed = self.Status("running", None, False, False)
                    hook = lambda mutated=mutated: setattr(candidate, "observed", mutated)
                    if verb == "pairing_status":
                        candidate.on_pairing_status = hook
                        self.assertEqual(
                            self.manager.pairing_status(PAIRING_OWNER), "unavailable"
                        )
                        candidate.on_pairing_status = None
                    else:
                        candidate.on_pairing_issue = hook
                        candidate.pairing_issue_results.append(dict(PAIRING_VIEW))
                        self.assertIsNone(self.manager.issue_pairing_challenge(PAIRING_OWNER))
                        candidate.on_pairing_issue = None

        # The publication was never withdrawn: identity survived every row,
        # which is exactly why the post-call observation must gate.
        candidate.observed = self.Status("running", None, False, False)
        after = self.manager.status()
        self.assertIs(after["activation"], candidate.observed)
        self.assertEqual(after["activationEpoch"], before["activationEpoch"])
        self.assertEqual(after["appliedGeneration"], before["appliedGeneration"])
        self.assertEqual(
            [entry for entry in self.ledger if entry[-1] in ("prepare", "start", "stop")],
            [],
        )

    def test_issue_pairing_challenge_maps_failures_closed_except_a_real_conflict(self):
        candidate = self.publish_pairing_candidate()

        candidate.pairing_issue_error = RuntimeError(CANARY)
        self.assert_error(
            LIFECYCLE_UNAVAILABLE,
            lambda: self.manager.issue_pairing_challenge(PAIRING_OWNER),
        )

        candidate.pairing_issue_error = ChannelAPairingConfigInvalid(PRISMA_CHANNEL_A_CLOCK_INVALID)
        self.assert_error(
            LIFECYCLE_UNAVAILABLE,
            lambda: self.manager.issue_pairing_challenge(PAIRING_OWNER),
        )

        # The one real pairing conflict survives untouched for the HTTP layer.
        candidate.pairing_issue_error = ChannelAPairingConflict(PRISMA_CHANNEL_A_CONFLICT)
        with self.assertRaises(ChannelAPairingConflict) as conflict:
            self.manager.issue_pairing_challenge(PAIRING_OWNER)
        self.assertEqual(str(conflict.exception), PRISMA_CHANNEL_A_CONFLICT)
        self.assertNotIsInstance(conflict.exception, self.Error)

        # None of the pairing failures changed lastError or lifecycle ownership.
        final = self.manager.status()
        self.assertEqual(final["lastError"], None)
        # The nested activation field is the observed ChannelAStatus projection,
        # never the candidate activation object itself.
        self.assertIs(final["activation"], candidate.observed)

    def test_issue_pairing_challenge_reentry_withdraws_publication_without_resurrection(self):
        candidate = self.publish_pairing_candidate()
        ledger_before = len(self.ledger)

        # Seed a real view: without the reentrant stop the delegated issuance
        # would return it, so a None result proves the confirmed stop discarded
        # it rather than the fake having nothing to give.
        candidate.pairing_issue_results.append(dict(PAIRING_VIEW))

        # A reentrant confirmed stop during the delegated foreign issuance wins:
        # the view is refused and the publication stays withdrawn.
        candidate.callback = lambda operation: (
            self.manager.stop() if operation == "pairing_issue" else None
        )
        self.assertIsNone(self.manager.issue_pairing_challenge(PAIRING_OWNER))

        # No unsafe lifecycle resurrection: the stopped publication stays gone,
        # no candidate is prepared or started behind the pairing call, and a
        # repeated issuance keeps returning None.
        prepared = [
            entry for entry in self.ledger[ledger_before:] if entry[1] in ("prepare", "start")
        ]
        self.assertEqual(prepared, [])
        self.assertIsNone(self.manager.issue_pairing_challenge(PAIRING_OWNER))
        final = self.manager.status()
        self.assertIsNone(final["activation"])
        self.assertIsNone(final["appliedGeneration"])
        self.assertIsNone(final["activationEpoch"])


if __name__ == "__main__":
    unittest.main()
