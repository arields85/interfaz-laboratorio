"""RCA-5h.2 test-first contract; execution requires a fresh independent grant.

No existing test module, application root, local_presentation or voice_service
is imported. Real sessions, pairing, dialogue and activation supply authority;
only the runner and transport are inert doubles. Manager-only tests isolate its
identity/lock/I/O boundary. No sockets, native workers or filesystem fixtures
are needed. Guards are containment, not a claim about third-party import safety.
These predicates admit trusted internal envelopes, not client-authored answers,
and cannot cancel audio already playing in a browser.
"""

from dataclasses import replace
import gc
import itertools
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch
import weakref

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

OWNER = "00000000-0000-0000-0000-000000000001"
OTHER = "00000000-0000-0000-0000-000000000002"
BOT = 700200
PHONE = 810001
ANSWER = "Offline answer"


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


def entropy_sequence():
    counter = itertools.count(1)
    return lambda size: next(counter).to_bytes(size, "big")


class DepthLock:
    """Single-thread instrumentation: reentry alone does not prove unlocking."""

    def __init__(self):
        self.depth = 0

    def __enter__(self):
        self.depth += 1
        return self

    def __exit__(self, *args):
        self.depth -= 1


class Transport:
    def __init__(self):
        self.sent = []
        self.acks = []

    def send_message(self, **kwargs):
        self.sent.append(kwargs)
        return {"ok": True, "result": {"message_id": len(self.sent),
                "chat": {"id": kwargs["chat_id"], "type": "private"},
                "from": {"id": BOT, "is_bot": True}, "text": kwargs["text"]}}

    def answer_callback_query(self, **kwargs):
        self.acks.append(kwargs)
        return {"ok": True, "result": True}

    def button(self, row):
        return self.sent[-1]["reply_markup"]["inline_keyboard"][row][0]["callback_data"]


def message(update, text):
    return {"update_id": update, "message": {"message_id": update,
            "chat": {"id": PHONE, "type": "private"},
            "from": {"id": PHONE, "is_bot": False}, "text": text}}


def callback(update, data):
    return {"update_id": update, "callback_query": {"id": str(update),
            "from": {"id": PHONE, "is_bot": False}, "data": data,
            "message": {"message_id": update, "date": 1,
                        "chat": {"id": PHONE, "type": "private"},
                        "from": {"id": BOT, "is_bot": True}}}}


class AuthorityCase(unittest.TestCase):
    def setUp(self):
        self.forbidden = []

        def refuse(*args, **kwargs):
            self.forbidden.append(1)
            raise RuntimeError("OFFLINE_OPERATION_REFUSED")

        # Installed before lazy production imports. Never deliberately dispatched.
        for target in ("requests.adapters.HTTPAdapter.send", "requests.Session.request",
                       "threading.Thread.start"):
            guard = patch(target, side_effect=refuse)
            guard.start()
            self.addCleanup(guard.stop)
        self.addCleanup(lambda: self.assertEqual(self.forbidden, []))
        from prisma_runtime import channel_a_activation as activation
        from prisma_runtime.channel_a_lifecycle import ChannelAStatus
        from prisma_runtime.channel_a_query import QueryEnvelope
        from prisma_runtime.hmi_sessions import HmiSessionRegistry
        self.module = activation
        self.Status = ChannelAStatus
        self.Envelope = QueryEnvelope
        self.clock = Clock()
        self.pairing_clock = Clock()
        self.removed = []
        self.sessions = HmiSessionRegistry(
            clock=self.clock, entropy=entropy_sequence(), owner_factory=lambda: OWNER,
            on_remove=self.removed.append,
        )
        self.capability, _ = self.sessions.create()
        self.sessions.set_context(self.capability, {"widgets": []})
        self.transport = Transport()
        self.runner_calls = []
        self.runners = []
        case = self

        class Runner:
            def __init__(self, **kwargs):
                self.factory = kwargs["dialogue_factory"]
                self.observed = case.Status("idle", None, True, False)
                self.dialogue = None
                self.on_status = None
                self.on_stop = None
                case.runners.append(self)
                case.runner_calls.append("construct")

            def prepare(self):
                from prisma_runtime.channel_a_transport import ChannelABotIdentity
                self.dialogue = self.factory(ChannelABotIdentity(BOT, "offline_bot"))
                self.observed = case.Status("prepared", None, True, False)
                case.runner_calls.append("prepare")
                return True

            def start(self):
                self.observed = case.Status("running", None, False, False)
                case.runner_calls.append("start")
                return True

            def status(self):
                if self.on_status:
                    self.on_status()
                return self.observed

            def stop(self):
                if self.on_stop:
                    self.on_stop()
                self.observed = case.Status("stopped", None, True, False)
                case.runner_calls.append("stop")
                return True

        with patch.object(activation, "ChannelARunner", Runner):
            self.activation = activation.ChannelAActivation(
                transport=self.transport, sessions=self.sessions,
                destination_label=lambda owner: "Offline HMI" if owner == OWNER else None,
                parse=lambda snapshot, question: SimpleNamespace(answer_text=ANSWER),
                on_outcome=lambda outcome: None,
                clock=self.clock, pairing_clock=self.pairing_clock, query_clock=self.clock,
                warning_lead=60, max_question_bytes=4096, poll_timeout=1,
                read_timeout=2, join_timeout=3, poll_pause=0.1,
            )
        self.runner = self.runners[-1]

    def linked(self):
        self.assertIs(self.activation.prepare(), True)
        self.assertIs(self.activation.start(), True)
        return self.relink(1)

    def relink(self, first):
        challenge = self.activation.issue_pairing_challenge(OWNER)
        self.assertIsNotNone(challenge)
        self.dialogue = self.runner.dialogue
        prompt = self.dialogue.handle_update(message(first, "/start " + challenge.token))
        self.assertEqual(prompt.kind, "pairing_prompt_delivered")
        confirmed = self.dialogue.handle_update(callback(first + 1, self.transport.button(0)))
        self.assertEqual(confirmed.kind, "pairing_confirmed")
        self.unlink_button = self.transport.button(1)
        outcome = self.dialogue.handle_update(message(first + 2, "What is visible?"))
        self.assertEqual(outcome.kind, "query_answer_delivered")
        self.assertIs(type(outcome.answer_envelope), self.Envelope)
        return outcome.answer_envelope

    def current(self, envelope):
        return self.activation.is_query_envelope_current(envelope)


class ActivationAuthorityTests(AuthorityCase):
    def test_freshness_public_unlink_and_same_dialogue_relink_revoke_old_envelope(self):
        for relink in (False, True):
            with self.subTest(relink=relink):
                envelope = self.linked()
                dialogue = self.dialogue
                freshness = self.sessions.is_owner_context_fresh_current
                outcomes = []
                replacements = []

                def revoke_after_freshness(*args, **kwargs):
                    result = freshness(*args, **kwargs)
                    if result is True and not outcomes:
                        outcomes.append(dialogue.handle_update(callback(4, self.unlink_button)).kind)
                        if relink:
                            replacements.append(self.relink(5))
                    return result

                with patch.object(self.sessions, "is_owner_context_fresh_current",
                                  side_effect=revoke_after_freshness):
                    result = self.current(envelope)
                self.assertEqual(outcomes, ["unlinked"])
                self.assertIs(self.runner.dialogue, dialogue)
                if relink:
                    self.assertEqual(len(replacements), 1)
                    self.assertNotEqual(replacements[0].generation, envelope.generation)
                    self.assertIs(self.current(replacements[0]), True)
                self.assertIs(result, False)

    def assert_status_revocation(self, operation, *, late=True):
        envelope = self.linked()
        freshness = self.sessions.is_owner_context_fresh_current
        armed = not late
        outcomes = []
        boundary = []

        def completed_freshness(*args, **kwargs):
            nonlocal armed
            result = freshness(*args, **kwargs)
            if result is True:
                armed = True
            return result

        def revoke():
            nonlocal armed
            if not armed or outcomes:
                return
            armed = False
            boundary.append("reached")
            if operation == "unlink":
                outcomes.append(self.dialogue.handle_update(callback(4, self.unlink_button)).kind)
            elif operation == "invalidate":
                outcomes.append(self.sessions.apply_context_command(self.capability,
                    {"version": 1, "command": "invalidate", "order": 1}))
            else:
                outcomes.append(self.sessions.close(self.capability))

        self.runner.on_status = revoke
        with patch.object(self.sessions, "is_owner_context_fresh_current",
                          side_effect=completed_freshness):
            result = self.current(envelope)
        self.runner.on_status = None
        if not boundary:
            # A future implementation may remove the late foreign status read.
            # This records noncoverage, not a successful revocation experiment.
            boundary.append("absent: late status callback eliminated")
            self.assertTrue(late)
            self.assertEqual(outcomes, [])
            self.assertIs(result, True)
        else:
            self.assertEqual(boundary, ["reached"])
            self.assertEqual(outcomes, [{"unlink": "unlinked", "invalidate": True,
                                         "close": OWNER}[operation]])
            self.assertIs(result, False)
        return boundary

    def test_final_status_public_unlink_revokes_admission(self):
        self.assert_status_revocation("unlink")

    def test_final_status_public_invalidation_revokes_context(self):
        self.assert_status_revocation("invalidate")

    def test_final_status_public_close_revokes_owner(self):
        self.assert_status_revocation("close")

    def test_first_status_public_revocation_is_reached(self):
        self.assertEqual(self.assert_status_revocation("unlink", late=False), ["reached"])

    def test_epoch_subclass_factory_preserves_value_and_eligibility(self):
        from prisma_runtime.channel_a_bot import ChannelAPairingDialogue

        class EpochSubclass(str):
            pass

        def dialogue_factory(**kwargs):
            return ChannelAPairingDialogue(**kwargs,
                epoch_factory=lambda: EpochSubclass("offline epoch"))

        with patch.object(self.module, "ChannelAPairingDialogue", side_effect=dialogue_factory):
            envelope = self.linked()
        self.assertEqual(envelope.epoch, "offline epoch")
        self.assertIs(self.current(envelope), True)

    def test_constructor_is_inert_and_prepared_is_not_running(self):
        self.assertEqual(self.runner_calls, ["construct"])
        self.assertIsNone(self.runner.dialogue)
        envelope = self.Envelope(OWNER, 1, 3, "not-an-adapter", ANSWER, 1)
        self.assertIs(self.current(envelope), False)
        self.activation.prepare()
        self.assertIs(self.current(envelope), False)
        self.assertEqual(self.transport.sent, [])

    def test_live_public_flow_is_true_and_read_has_no_effects(self):
        envelope = self.linked()
        link = self.dialogue.registry.owner_link(OWNER)
        effects = (len(self.transport.sent), len(self.transport.acks), list(self.runner_calls))
        with patch.object(self.sessions, "_purge_locked", side_effect=AssertionError("purge")), \
             patch.object(self.sessions, "_copy_context", side_effect=AssertionError("copy")), \
             patch.object(self.dialogue.registry, "_purge_locked", side_effect=AssertionError("purge")):
            self.assertIs(self.current(envelope), True)
            self.clock.now += 1
            self.pairing_clock.now += 1
            self.assertIs(self.current(envelope), True)
        self.assertEqual(self.dialogue.registry.owner_link(OWNER), link)
        self.assertEqual(effects, (len(self.transport.sent), len(self.transport.acks), self.runner_calls))
        self.assertEqual(self.removed, [])
        reference = weakref.ref(envelope)
        del envelope
        gc.collect()
        self.assertIsNone(reference(), "eligibility must not retain the envelope")

    def test_unlink_and_same_owner_relink_reject_old_generation(self):
        old = self.linked()
        self.assertEqual(self.dialogue.handle_update(callback(4, self.unlink_button)).kind, "unlinked")
        self.assertIs(self.current(old), False)
        new = self.relink(5)
        self.assertNotEqual(old.generation, new.generation)
        self.assertIs(self.current(old), False)
        self.assertIs(self.current(new), True)

    def test_epoch_confirmation_fence_owner_and_malformed_fields(self):
        envelope = self.linked()
        mutations = ({"epoch": "other-adapter"}, {"epoch": 1}, {"owner_id": OTHER},
                     {"owner_id": []}, {"generation": True}, {"generation": 0},
                     {"update_id": 2}, {"update_id": True}, {"update_id": -1},
                     {"update_id": 2**53}, {"context_revision": True},
                     {"context_revision": 0}, {"epoch": ""})
        for fields in mutations:
            with self.subTest(fields=fields):
                malformed = replace(envelope, **fields)
                self.assertIs(self.current(malformed), False)
                self.assertIs(self.dialogue.is_query_envelope_admitted(malformed), False)
        for wrong in (None, {}, envelope.as_dict(), object()):
            with self.subTest(type=type(wrong)):
                self.assertIs(self.current(wrong), False)
                self.assertIs(self.dialogue.is_query_envelope_admitted(wrong), False)
        class DerivedEnvelope(self.Envelope):
            pass
        derived = DerivedEnvelope(OWNER, envelope.generation, 3, envelope.epoch, ANSWER, 1)
        self.assertIs(self.current(derived), False)
        self.assertIs(self.dialogue.is_query_envelope_admitted(derived), False)

    def test_context_revision_change_and_invalidation_refuse(self):
        envelope = self.linked()
        self.sessions.set_context(self.capability, {"widgets": [], "hmiName": ""})
        self.assertIs(self.current(envelope), False)
        fresh = self.dialogue.handle_update(message(4, "Again?")).answer_envelope
        self.assertIsNotNone(fresh)
        self.assertIs(self.current(fresh), True)  # Name is not pairing authority.
        self.sessions.apply_context_command(self.capability,
            {"version": 1, "command": "invalidate", "order": 1})
        self.assertIs(self.current(fresh), False)

    def test_receipt_age_includes_boundary_then_expires(self):
        envelope = self.linked()
        self.clock.now += 15
        self.assertIs(self.current(envelope), True)
        self.clock.now += 0.001
        self.assertIs(self.current(envelope), False)

    def test_live_session_idle_expiry_is_not_masked_by_freshness(self):
        self.sessions.idle_ttl = 5
        envelope = self.linked()
        self.clock.now += 4
        self.assertIs(self.current(envelope), True)
        self.clock.now += 1
        self.assertIs(self.current(envelope), False)  # Receipt age only five seconds.
        self.assertEqual(self.removed, [])

    def test_absolute_expiry_with_recent_context_and_idle_activity(self):
        self.sessions.absolute_ttl = 10
        self.sessions.idle_ttl = 8
        self.clock.now += 7
        self.sessions.set_context(self.capability, {"widgets": []})
        envelope = self.linked()
        self.clock.now += 2
        self.assertIs(self.current(envelope), True)
        self.clock.now += 1
        self.assertIs(self.current(envelope), False)  # Receipt/idle ages only three.
        self.assertEqual(self.removed, [])

    def test_closed_owner_is_not_rescued_by_pairing_presence(self):
        envelope = self.linked()
        self.sessions.close(self.capability)
        self.assertIsNotNone(self.dialogue.registry.owner_link(OWNER))
        self.assertIs(self.current(envelope), False)

    def test_stop_withdraws_dialogue_before_runner_stop_callback(self):
        envelope = self.linked()
        during = []
        self.runner.on_stop = lambda: during.append(self.current(envelope))
        self.assertIs(self.activation.stop(), True)
        self.assertEqual(during, [False])
        self.assertIs(self.current(envelope), False)

    def test_status_and_restart_required_gate_current_dialogue(self):
        envelope = self.linked()
        for phase, restart in (("prepared", False), ("stopped", False),
                               ("running", True), ("running", 0)):
            with self.subTest(phase=phase, restart=restart):
                self.runner.observed = self.Status(phase, None, False, restart)
                self.assertIs(self.current(envelope), False)

    def test_foreign_admission_stop_and_freshness_replacement_are_rechecked(self):
        envelope = self.linked()
        def stop_then_true(*args):
            self.activation.stop()
            return True
        with patch.object(self.dialogue, "is_query_envelope_admitted", side_effect=stop_then_true):
            self.assertIs(self.current(envelope), False)
        self.activation.prepare()
        self.activation.start()
        replacement = self.relink(1)
        self.assertIs(self.current(envelope), False)
        def replace_dialogue(*args, **kwargs):
            self.activation.prepare()
            self.activation.start()
            return True
        with patch.object(self.sessions, "is_owner_context_fresh_current", side_effect=replace_dialogue):
            self.assertIs(self.current(replacement), False)

    def test_foreign_freshness_status_change_is_rechecked(self):
        envelope = self.linked()
        def retire(*args, **kwargs):
            self.runner.observed = self.Status("running", None, False, True)
            return True
        with patch.object(self.sessions, "is_owner_context_fresh_current", side_effect=retire):
            self.assertIs(self.current(envelope), False)

    def test_false_nontrue_and_throwing_collaborators_fail_closed(self):
        envelope = self.linked()
        for target, method in ((self.dialogue, "is_query_envelope_admitted"),
                               (self.sessions, "is_owner_context_fresh_current"),
                               (self.runner, "status")):
            for result in (False, None, 1, RuntimeError("offline-private-canary")):
                with self.subTest(method=method, result=type(result)):
                    options = ({"side_effect": result} if isinstance(result, Exception)
                               else {"return_value": result})
                    with patch.object(target, method, **options), self.assertNoLogs():
                        self.assertIs(self.current(envelope), False)
        self.assertIs(self.current(envelope), True)

    def test_dialogue_checks_pairing_outside_lock_and_rechecks_action(self):
        envelope = self.linked()
        lock = DepthLock()
        self.dialogue._lock = lock
        depths = []
        def unlink_during_check(*args):
            depths.append(lock.depth)
            self.dialogue.handle_update(callback(4, self.unlink_button))
            return True
        with patch.object(self.dialogue.registry, "is_owner_link_current", side_effect=unlink_during_check):
            self.assertIs(self.dialogue.is_query_envelope_admitted(envelope), False)
        self.assertEqual(depths, [0])

    def test_dialogue_registry_refusals_do_not_renew_or_forget_admission(self):
        envelope = self.linked()
        for result in (False, None, 1, RuntimeError("offline-private-canary")):
            with self.subTest(result=type(result)):
                options = ({"side_effect": result} if isinstance(result, Exception)
                           else {"return_value": result})
                with patch.object(self.dialogue.registry, "is_owner_link_current", **options):
                    self.assertIs(self.dialogue.is_query_envelope_admitted(envelope), False)
        self.assertIs(self.dialogue.is_query_envelope_admitted(envelope), True)


class RegistryAuthorityTests(AuthorityCase):
    def test_pairing_predicate_no_touch_no_purge_and_idle_expiry(self):
        envelope = self.linked()
        registry = self.dialogue.registry
        before = registry.owner_link(OWNER)
        self.pairing_clock.now = before.idle_expires_at - 1
        with patch.object(registry, "_purge_locked", side_effect=AssertionError("purge")) as purge:
            self.assertIs(registry.is_owner_link_current(OWNER, envelope.generation), True)
            self.pairing_clock.now += 1
            self.assertIs(registry.is_owner_link_current(OWNER, envelope.generation), False)
            purge.assert_not_called()
        # Read-only private observation is needed to distinguish refusal from purge;
        # all creation/release/mutation of pairing authority uses public operations.
        self.assertIn(OWNER, registry._links)
        self.assertEqual(registry._links[OWNER].last_human_activity_at, before.last_human_activity_at)
        self.assertEqual(registry._links[OWNER].idle_expires_at, before.idle_expires_at)

    def test_pairing_generation_absence_and_invalid_clock_fail_closed(self):
        envelope = self.linked()
        registry = self.dialogue.registry
        for owner, generation in ((OTHER, envelope.generation), (OWNER, None),
                                  (OWNER, True), (OWNER, 0), (OWNER, envelope.generation + 1)):
            with self.subTest(owner=owner, generation=generation):
                self.assertIs(registry.is_owner_link_current(owner, generation), False)
        for sample in (99, float("nan"), float("inf"), -1, True):
            with self.subTest(sample=sample):
                self.pairing_clock.now = sample
                self.assertIs(registry.is_owner_link_current(OWNER, envelope.generation), False)
        with patch.object(registry, "clock", side_effect=RuntimeError("offline-private-canary")):
            self.assertIs(registry.is_owner_link_current(OWNER, envelope.generation), False)
        self.pairing_clock.now = 100
        registry.invalidate_owner(OWNER)
        self.assertIs(registry.is_owner_link_current(OWNER, envelope.generation), False)

    def test_context_predicate_invalid_inputs_bounds_and_clock(self):
        predicate = self.sessions.is_owner_context_fresh_current
        for owner, revision, bound in ((OTHER, 1, 15), ([], 1, 15), (OWNER, True, 15),
                                      (OWNER, 0, 15), (OWNER, 2, 15), (OWNER, 1, 0),
                                      (OWNER, 1, -1), (OWNER, 1, True),
                                      (OWNER, 1, float("nan")), (OWNER, 1, float("inf")),
                                      (OWNER, 1, "15"), (OWNER, 1, 10**400)):
            with self.subTest(owner=owner, revision=revision, bound=bound):
                self.assertIs(predicate(owner, revision, max_age_seconds=bound), False)
        for sample in (99, float("nan"), float("inf"), None, "100"):
            with self.subTest(sample=sample):
                self.clock.now = sample
                self.assertIs(predicate(OWNER, 1, max_age_seconds=15), False)
        with patch.object(self.sessions, "clock", side_effect=RuntimeError("offline-private-canary")):
            self.assertIs(predicate(OWNER, 1, max_age_seconds=15), False)

    def test_context_predicate_missing_context_and_no_copy_touch_purge_callback(self):
        predicate = self.sessions.is_owner_context_fresh_current
        before = [(s.last_seen_at, s.context_received_at, s.context_revision)
                  for s in self.sessions._sessions.values()]
        with patch("prisma_runtime.hmi_sessions.copy.deepcopy", side_effect=AssertionError("copy")) as copy, \
             patch.object(self.sessions, "_purge_locked", side_effect=AssertionError("purge")) as purge:
            self.clock.now += 1
            self.assertIs(predicate(OWNER, 1, max_age_seconds=15), True)
            self.clock.now += self.sessions.idle_ttl
            self.assertIs(predicate(OWNER, 1, max_age_seconds=15), False)
            copy.assert_not_called()
            purge.assert_not_called()
        self.assertEqual(before, [(s.last_seen_at, s.context_received_at, s.context_revision)
                                 for s in self.sessions._sessions.values()])
        self.assertEqual(self.removed, [])
        self.clock.now = 100
        self.sessions.apply_context_command(self.capability,
            {"version": 1, "command": "invalidate", "order": 1})
        self.assertIs(predicate(OWNER, 2, max_age_seconds=15), False)


class ManagerAuthorityTests(AuthorityCase):
    def manager_fixture(self):
        from prisma_runtime.channel_a_configuration import ChannelAConfiguration
        from prisma_runtime.channel_a_manager import ChannelAManager
        case = self
        self.io = []
        self.candidates = []

        class Credentials:
            def status(self):
                case.io.append("metadata")
                return {"telegram_channel_a": True}
            def get_secret(self, provider):
                case.io.append("resolve")
                return "123456:offline-only-fixture"
            def set_secret(self, provider, value):
                case.io.append("save")

        class Configuration:
            snapshot = ChannelAConfiguration(60, 0)
            def read(self):
                case.io.append("config")
                return self.snapshot
            def advance_generation(self):
                self.snapshot = replace(self.snapshot, desired_generation=self.snapshot.desired_generation + 1)
                return self.snapshot
            def set_warning_lead(self, value):
                self.advance_generation()
                self.snapshot = replace(self.snapshot, warning_lead_seconds=value)
                return self.snapshot

        class Candidate:
            def __init__(self):
                self.observed = case.Status("idle", None, True, False)
                self.hook = None
                self.result = True
                self.stop_result = True
                self.start_result = True
                self.depths = []
                self._delivery_witness = object()
            def _capture_delivery_witness(self, envelope):
                return self._delivery_witness
            def _delivery_witness_matches(self, witness):
                return witness is self._delivery_witness
            def prepare(self):
                case.io.append("prepare")
                return True
            def start(self):
                case.io.append("start")
                self.observed = case.Status("running", None, False, False)
                return self.start_result
            def stop(self):
                case.io.append("stop")
                return self.stop_result
            def status(self):
                self.depths.append(case.manager._lock.depth)
                if self.hook:
                    self.hook("status")
                return self.observed
            def is_query_envelope_current(self, envelope):
                self.depths.append(case.manager._lock.depth)
                if self.hook:
                    self.hook("predicate")
                return self.result

        def factory(*args):
            self.io.append("factory")
            candidate = Candidate()
            self.candidates.append(candidate)
            return candidate

        self.manager = ChannelAManager(credential_service=Credentials(),
            configuration_store=Configuration(), activation_factory=factory, reservation=object())
        self.manager._lock = DepthLock()
        self.envelope = self.Envelope(OWNER, 1, 3, "adapter-not-manager-epoch", ANSWER, 1)
        return self.manager

    def assert_manager_inner_revocation(self, *, late):
        envelope = self.linked()
        manager = self.manager_fixture()
        manager.apply()
        candidate = self.candidates[0]
        publication = (manager._activation, manager._activation_epoch, manager._applied_generation)
        outcomes = []
        delegated = []
        boundary = []

        def revoke(operation):
            if operation == "status":
                candidate.hook = None
                boundary.append("reached")
                outcomes.append(self.dialogue.handle_update(callback(4, self.unlink_button)).kind)

        def eligible(value):
            result = self.activation.is_query_envelope_current(value)
            delegated.append(result)
            if result is True and late:
                candidate.hook = revoke
            return result

        candidate.is_query_envelope_current = eligible
        # Late lookup: the frozen implementation has no witness API yet. Its
        # boolean path must reach the behavioral oracle, not fail during setup.
        candidate._capture_delivery_witness = lambda value: self.activation._capture_delivery_witness(value)
        candidate._delivery_witness_matches = lambda witness: self.activation._delivery_witness_matches(witness)
        if not late:
            candidate.hook = revoke
        result = manager.is_query_envelope_current(envelope)
        self.assertEqual(delegated, [True] if late else [False])
        self.assertEqual(publication, (manager._activation, manager._activation_epoch,
                                       manager._applied_generation))
        if not boundary:
            boundary.append("absent: late status callback eliminated")
            self.assertTrue(late)
            self.assertEqual(outcomes, [])
            self.assertIs(result, True)
        else:
            self.assertEqual(boundary, ["reached"])
            self.assertEqual(outcomes, ["unlinked"])
            self.assertIs(result, False)

    def test_final_manager_status_public_unlink_revokes_inner_authority(self):
        self.assert_manager_inner_revocation(late=True)

    def test_first_manager_status_public_inner_revocation_is_reached(self):
        self.assert_manager_inner_revocation(late=False)

    def test_inert_manager_and_applied_running_read_without_io(self):
        manager = self.manager_fixture()
        self.assertEqual(self.io, [])
        self.assertIs(manager.is_query_envelope_current(self.envelope), False)
        manager.apply()
        self.io.clear()
        self.assertIs(manager.is_query_envelope_current(self.envelope), True)
        self.assertEqual(self.io, [])
        self.assertTrue(self.candidates[0].depths)
        self.assertEqual(set(self.candidates[0].depths), {0})
        reference = weakref.ref(self.envelope)
        del self.envelope
        gc.collect()
        self.assertIsNone(reference(), "manager must not retain the envelope")

    def test_manager_rejects_malformed_envelope_even_with_permissive_activation(self):
        manager = self.manager_fixture()
        manager.apply()
        for envelope in (None, {}, self.envelope.as_dict(),
                         replace(self.envelope, generation=True),
                         replace(self.envelope, update_id=-1),
                         replace(self.envelope, context_revision=0)):
            with self.subTest(envelope_type=type(envelope)):
                self.assertIs(manager.is_query_envelope_current(envelope), False)

    def test_passive_policy_and_credential_dirty_keep_running_authority(self):
        manager = self.manager_fixture()
        manager.apply()
        for mutate in (lambda: manager.set_warning_lead(61),
                       lambda: manager.save_credential("123456:offline-new-fixture")):
            mutate()
            snapshot = manager.status()
            self.assertNotEqual(snapshot["desiredGeneration"], snapshot["appliedGeneration"])
            self.io.clear()
            self.assertIs(manager.is_query_envelope_current(self.envelope), True)
            self.assertEqual(self.io, [])
            self.assertEqual(len(self.candidates), 1)

    def test_pending_unpublished_running_candidate_is_not_authority(self):
        manager = self.manager_fixture()
        # Fail start while leaving a running-looking, unsettled candidate visible.
        def factory(*args):
            candidate = original(*args)
            candidate.start_result = False
            candidate.stop_result = False
            return candidate
        original = manager._factory
        manager._factory = factory
        from prisma_runtime.channel_a_manager import ChannelAManagerError
        with self.assertRaises(ChannelAManagerError):
            manager.apply()
        self.assertIsNone(manager.status()["activationEpoch"])
        self.assertIs(manager.is_query_envelope_current(self.envelope), False)

    def test_actual_status_and_strict_collaborator_results_fail_closed(self):
        manager = self.manager_fixture()
        manager.apply()
        candidate = self.candidates[0]
        for observed in (None, {"phase": "running"}, self.Status("prepared", None, True, False),
                         self.Status("running", None, False, True), self.Status("running", None, False, 0)):
            with self.subTest(observed=observed):
                candidate.observed = observed
                self.assertIs(manager.is_query_envelope_current(self.envelope), False)
        candidate.observed = self.Status("running", None, False, False)
        for value in (False, None, 1, "true"):
            candidate.result = value
            self.assertIs(manager.is_query_envelope_current(self.envelope), False)
        for method in ("status", "is_query_envelope_current"):
            candidate.result = True
            with patch.object(candidate, method, side_effect=RuntimeError("offline-private-canary")), self.assertNoLogs():
                self.assertIs(manager.is_query_envelope_current(self.envelope), False)

    def test_foreign_status_and_predicate_stop_recheck_identity_without_lock(self):
        for stage in ("status", "predicate"):
            with self.subTest(stage=stage):
                manager = self.manager_fixture()
                manager.apply()
                candidate = self.candidates[0]
                def hook(operation):
                    if operation == stage:
                        candidate.hook = None
                        self.assertEqual(manager._lock.depth, 0)
                        manager.stop()
                candidate.hook = hook
                self.assertIs(manager.is_query_envelope_current(self.envelope), False)
                self.assertEqual(set(candidate.depths), {0})

    def test_reentrant_apply_replacement_cannot_authorize_old_instance(self):
        manager = self.manager_fixture()
        manager.apply()
        old = self.candidates[0]
        def replace_current(operation):
            if operation == "predicate":
                old.hook = None
                manager.set_warning_lead(61)
                manager.apply()
        old.hook = replace_current
        self.assertIs(manager.is_query_envelope_current(self.envelope), False)
        self.assertEqual(len(self.candidates), 2)
        self.assertEqual(manager.status()["activationEpoch"], 2)


if __name__ == "__main__":
    unittest.main()
