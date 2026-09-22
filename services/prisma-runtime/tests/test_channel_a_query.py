"""Behavioral contract tests for the Channel A correlated query coordinator (RCA-3b).

The coordinator is driven with the *real* ``ChannelAPairingRegistry`` and the
real ``HmiSessionRegistry`` where possible, plus fake parser, context and
delivery callables and an injectable monotonic clock. No test performs network
I/O, reads credentials, sleeps or starts a bot.
"""

import itertools
import math
import sys
import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime import channel_a_query as query_module
from prisma_runtime.channel_a_query import (
    COPY_QUERY_UNAVAILABLE,
    PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID,
    QUERY_ANSWER_DELIVERED,
    QUERY_ANSWER_REJECTED,
    QUERY_ANSWER_UNKNOWN,
    QUERY_ANSWER_UNPUBLISHED,
    QUERY_IGNORED_BLANK,
    QUERY_IGNORED_COMMAND,
    QUERY_IGNORED_MALFORMED,
    QUERY_IGNORED_OVERSIZE,
    QUERY_IGNORED_STALE,
    QUERY_IGNORED_UNBOUND,
    QUERY_UNAVAILABLE,
    ChannelAQueryConfigInvalid,
    ChannelAQueryCoordinator,
    QueryBinding,
    QueryEnvelope,
    QueryOutcome,
    is_query_envelope_well_formed,
)
from prisma_runtime.channel_a_pairing import ChannelAPairingRegistry
from prisma_runtime.hmi_sessions import HmiSessionRegistry
from prisma_runtime.local_presentation import LocalAnswer, answer_from_snapshot

OWNER = "00000000-0000-4000-8000-000000000001"
OWNER2 = "00000000-0000-4000-8000-000000000002"
OWNER3 = "00000000-0000-4000-8000-000000000003"
PHONE = "tg:5001"
PHONE2 = "tg:5002"
PHONE3 = "tg:5003"
EPOCH = "epoch-1"
EPOCH2 = "epoch-2"

SNAPSHOT = {"widgets": [{"id": "oee", "title": "OEE", "data": {"value": 88.5}, "unit": "%"}]}
SNAPSHOT2 = {"widgets": [{"id": "oee", "title": "OEE", "data": {"value": 12.5}, "unit": "%"}]}
QUESTION = "¿cuál es el oee?"
ANSWER = "El OEE actual es 88.5 %."

DELIVERED = "delivered"
REJECTED = "rejected"
UNKNOWN = "unknown"

_UNSET = object()


def sequential_entropy():
    counter = itertools.count(1)

    def entropy(size):
        return next(counter).to_bytes(size, "big")

    return entropy


class QueryHarness:
    """Real domain state plus scripted, recording external callables."""

    def __init__(
        self,
        *,
        freshness_bound=30.0,
        max_question_bytes=4096,
        max_answer_chars=4096,
        epoch=EPOCH,
        wall=1000.0,
        mono=50.0,
        answer_text=ANSWER,
    ):
        self.wall = [wall]
        self.mono = [mono]
        self.epoch = epoch
        self.freshness_bound = freshness_bound
        self.max_question_bytes = max_question_bytes
        self.max_answer_chars = max_answer_chars
        self.answer_text = answer_text
        self.sessions = HmiSessionRegistry(
            clock=lambda: self.wall[0],
            owner_factory=lambda: OWNER,
            entropy=sequential_entropy(),
        )
        self.registry = ChannelAPairingRegistry(
            warning_lead=60.0,
            clock=lambda: self.mono[0],
            entropy=sequential_entropy(),
        )
        self.parses = []
        self.deliveries = []
        self.validations = []
        self.context_reads = []
        self.touches = []
        self.delivery_script = []
        self.parser_hook = None
        self.context_hook = None
        self.deliver_hook = None
        self.validate_hook = None
        self.context_override = None
        self.parser_product = _UNSET
        self._wrap_touch()
        self.coordinator = self.build()

    def _wrap_touch(self):
        original = self.registry.human_touch

        def recorded(phone_id, generation):
            self.touches.append((phone_id, generation))
            return original(phone_id, generation)

        self.registry.human_touch = recorded

    # -- domain helpers ----------------------------------------------------

    def open_session(self, owner, snapshot=SNAPSHOT):
        original = self.sessions.owner_factory
        self.sessions.owner_factory = lambda owner=owner: owner
        try:
            capability, _info = self.sessions.create()
        finally:
            self.sessions.owner_factory = original
        if snapshot is not None:
            self.sessions.set_context(capability, snapshot)
        return capability

    def pair(self, owner=OWNER, phone=PHONE):
        token = self.registry.issue_qr(owner).token
        ticket, _pending = self.registry.claim_qr(token, phone)
        return self.registry.confirm(ticket, phone)

    def binding(self, link, **overrides):
        values = {
            "phone_id": link.phone_id,
            "owner_id": link.owner_id,
            "generation": link.generation,
            "update_id": 100,
            "confirmed_update_id": 99,
            "epoch": self.epoch,
        }
        values.update(overrides)
        return QueryBinding(**values)

    # -- injected callables ------------------------------------------------

    def validate(self, binding):
        self.validations.append(binding)
        if self.validate_hook is not None:
            return bool(self.validate_hook(binding))
        return binding.epoch == self.epoch

    def read_context(self, owner_id, *, max_age_seconds):
        self.context_reads.append((owner_id, max_age_seconds))
        if self.context_hook is not None:
            self.context_hook()
        if self.context_override is not None:
            return self.context_override(owner_id, max_age_seconds)
        return self.sessions.capture_owner_context(owner_id, max_age_seconds=max_age_seconds)

    def context_is_current(self, owner_id, revision):
        return self.sessions.is_owner_context_current(owner_id, revision)

    def parse(self, snapshot, question):
        self.parses.append((snapshot, question))
        if self.parser_hook is not None:
            self.parser_hook()
        if self.parser_product is not _UNSET:
            return self.parser_product
        if self.answer_text is _UNSET:
            return None
        if isinstance(self.answer_text, BaseException):
            raise self.answer_text
        return LocalAnswer(question, self.answer_text, [])

    def deliver(self, binding, text):
        self.deliveries.append((binding, text))
        if self.deliver_hook is not None:
            self.deliver_hook()
        if self.delivery_script:
            return self.delivery_script.pop(0)
        return DELIVERED

    def build(self, **overrides):
        options = {
            "registry": self.registry,
            "validate": self.validate,
            "read_context": self.read_context,
            "context_is_current": self.context_is_current,
            "parse": self.parse,
            "deliver": self.deliver,
            "freshness_bound": self.freshness_bound,
            "max_question_bytes": self.max_question_bytes,
            "max_answer_chars": self.max_answer_chars,
            "delivered_label": DELIVERED,
            "rejected_label": REJECTED,
            "unknown_label": UNKNOWN,
            "clock": lambda: self.mono[0],
        }
        options.update(overrides)
        return ChannelAQueryCoordinator(**options)

    # -- assertions --------------------------------------------------------

    def assert_outcome(self, outcome, kind, *, delivery=_UNSET):
        assert isinstance(outcome, QueryOutcome), f"not a QueryOutcome: {outcome!r}"
        assert outcome.kind == kind, f"kind {outcome.kind!r} != {kind!r}"
        if delivery is not _UNSET:
            assert outcome.delivery == delivery, (
                f"delivery {outcome.delivery!r} != {delivery!r}"
            )
        return outcome


class ChannelAQueryConfigTests(unittest.TestCase):
    def setUp(self):
        self.harness = QueryHarness()

    def test_missing_keywords_are_a_programming_error(self):
        with self.assertRaises(TypeError):
            ChannelAQueryCoordinator(registry=self.harness.registry)

    def test_revision_validator_is_required_not_an_optional_legacy_fallback(self):
        with self.assertRaises(TypeError):
            ChannelAQueryCoordinator(
                registry=self.harness.registry,
                validate=self.harness.validate,
                read_context=self.harness.read_context,
                parse=self.harness.parse,
                deliver=self.harness.deliver,
                freshness_bound=15.0,
                max_question_bytes=4096,
                max_answer_chars=4096,
                delivered_label=DELIVERED,
                rejected_label=REJECTED,
                unknown_label=UNKNOWN,
                clock=lambda: self.harness.mono[0],
            )

    def test_registry_must_be_the_real_pairing_registry(self):
        for value in (None, object(), dict, "registry"):
            with self.subTest(value=value):
                with self.assertRaises(ChannelAQueryConfigInvalid) as captured:
                    self.harness.build(registry=value)
                self.assertEqual(str(captured.exception), PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID)

    def test_injected_callables_must_be_callable(self):
        for name in ("validate", "read_context", "context_is_current", "parse", "deliver", "clock"):
            for value in (None, 5, "callable"):
                with self.subTest(name=name, value=value):
                    with self.assertRaises(ChannelAQueryConfigInvalid):
                        self.harness.build(**{name: value})

    def test_freshness_bound_must_be_positive_and_finite(self):
        for value in (0, -1, True, False, "30", None, float("inf"), float("nan")):
            with self.subTest(value=value):
                with self.assertRaises(ChannelAQueryConfigInvalid):
                    self.harness.build(freshness_bound=value)
        self.assertEqual(self.harness.build(freshness_bound=0.5).freshness_bound, 0.5)

    def test_byte_and_character_bounds_must_be_positive_bounded_integers(self):
        for name in ("max_question_bytes", "max_answer_chars"):
            for value in (0, -1, True, False, "4", 4.0, None, 2**40):
                with self.subTest(name=name, value=value):
                    with self.assertRaises(ChannelAQueryConfigInvalid):
                        self.harness.build(**{name: value})

    def test_delivery_labels_must_be_distinct_non_empty_strings(self):
        for overrides in (
            {"delivered_label": ""},
            {"unknown_label": None},
            {"rejected_label": 5},
            {"delivered_label": DELIVERED, "rejected_label": DELIVERED},
        ):
            with self.subTest(overrides=overrides):
                with self.assertRaises(ChannelAQueryConfigInvalid):
                    self.harness.build(**overrides)

    def test_config_error_str_is_the_error_code(self):
        with self.assertRaises(ChannelAQueryConfigInvalid) as captured:
            self.harness.build(freshness_bound=0)
        self.assertEqual(str(captured.exception), PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID)
        self.assertIsInstance(captured.exception, RuntimeError)

    def test_module_imports_no_transport_voice_or_presentation_code(self):
        source = Path(query_module.__file__).read_text(encoding="utf-8")
        for name in (
            "local_presentation",
            "voice_events",
            "voice_service",
            "event_audio",
            "requests",
            "socket",
            "subprocess",
            "environ",
        ):
            with self.subTest(name=name):
                self.assertNotIn(name, source)

    def test_module_holds_no_unbounded_index(self):
        harness = QueryHarness()
        for name, value in vars(harness.coordinator).items():
            with self.subTest(name=name):
                self.assertNotIsInstance(value, (dict, list, set))
        for name, value in vars(query_module).items():
            if name.startswith("__"):
                continue
            self.assertNotIsInstance(value, (dict, list, set), msg=name)


class ChannelAQueryHappyPathTests(unittest.TestCase):
    def setUp(self):
        self.harness = QueryHarness()
        self.harness.open_session(OWNER)
        self.link = self.harness.pair()
        self.binding = self.harness.binding(self.link)

    def test_a_fresh_bound_query_is_answered_and_enveloped(self):
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_ANSWER_DELIVERED, delivery=DELIVERED)
        self.assertEqual(len(self.harness.deliveries), 1)
        self.assertEqual(self.harness.deliveries[0][0], self.binding)
        self.assertEqual(self.harness.deliveries[0][1], ANSWER)
        envelope = outcome.envelope
        self.assertIsInstance(envelope, QueryEnvelope)
        self.assertEqual(envelope.owner_id, OWNER)
        self.assertEqual(envelope.generation, self.link.generation)
        self.assertEqual(envelope.update_id, self.binding.update_id)
        self.assertEqual(envelope.epoch, EPOCH)
        self.assertEqual(envelope.answer_text, ANSWER)
        self.assertEqual(envelope.answer_text, self.harness.deliveries[0][1])

    def test_the_parser_receives_the_trimmed_question_and_the_owner_snapshot(self):
        outcome = self.harness.coordinator.handle_query(self.binding, "  " + QUESTION + "  ")
        self.harness.assert_outcome(outcome, QUERY_ANSWER_DELIVERED)
        self.assertEqual(len(self.harness.parses), 1)
        snapshot, question = self.harness.parses[0]
        self.assertEqual(snapshot, SNAPSHOT)
        self.assertEqual(question, QUESTION)
        self.assertEqual(self.harness.deliveries[0][1], ANSWER)

    def test_the_real_parser_produces_the_visible_snapshot_answer(self):
        self.harness.answer_text = _UNSET
        self.harness.parser = answer_from_snapshot
        self.harness.coordinator = self.harness.build(parse=answer_from_snapshot)
        outcome = self.harness.coordinator.handle_query(self.binding, "cuál es el oee?")
        self.harness.assert_outcome(outcome, QUERY_ANSWER_DELIVERED)
        self.assertIn("88", self.harness.deliveries[0][1])
        self.assertEqual(outcome.envelope.answer_text, self.harness.deliveries[0][1])

    def test_human_touch_happens_exactly_once_per_admitted_query(self):
        self.assertEqual(self.harness.touches, [])
        self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.assertEqual(self.harness.touches, [(PHONE, self.link.generation)])
        advanced = self.harness.registry.phone_link(PHONE).last_human_activity_at
        self.assertEqual(advanced, self.harness.mono[0])

    def test_the_binding_is_rechecked_after_each_external_callback(self):
        events = []
        self.harness.validate_hook = lambda binding: events.append("validate") or True
        self.harness.context_hook = lambda: events.append("context")
        self.harness.parser_hook = lambda: events.append("parse")
        coordinator = self.harness.build(
            clock=lambda: events.append("clock") or self.harness.mono[0]
        )
        outcome = coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_ANSWER_DELIVERED)
        self.assertEqual(events[0], "validate")
        for name in ("context", "parse"):
            index = events.index(name)
            self.assertEqual(events[index + 1], "validate")
        self.assertEqual(self.harness.context_reads, [(OWNER, self.harness.freshness_bound)])

    def test_no_effectful_callback_runs_between_the_final_clock_sample_and_the_send(self):
        events = []
        self.harness.validate_hook = lambda binding: events.append("validate") or True
        self.harness.context_hook = lambda: events.append("context")
        self.harness.parser_hook = lambda: events.append("parse")
        self.harness.deliver_hook = lambda: events.append("send")
        coordinator = self.harness.build(
            clock=lambda: events.append("clock") or self.harness.mono[0]
        )
        outcome = coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_ANSWER_DELIVERED)
        send_index = events.index("send")
        self.assertEqual(events.count("send"), 1)
        # The final effectful validation must precede the final clock sample,
        # and the phone send must immediately follow that sample.
        self.assertEqual(events[send_index - 2], "validate")
        self.assertEqual(events[send_index - 1], "clock")
        # The same ordering guards the HMI envelope after the send.
        self.assertEqual(events[-2], "validate")
        self.assertEqual(events[-1], "clock")

    def test_a_question_longer_than_the_command_cap_still_works(self):
        question = "consulta " * 40
        self.assertTrue(len(question) > 128)
        outcome = self.harness.coordinator.handle_query(self.binding, question)
        self.harness.assert_outcome(outcome, QUERY_ANSWER_DELIVERED)
        self.assertEqual(self.harness.parses[0][1], question.strip())

    def test_the_envelope_serializes_the_correlation_without_payload_or_question(self):
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        data = outcome.envelope.as_dict()
        self.assertEqual(
            set(data),
            {"ownerId", "generation", "updateId", "epoch", "answerText", "contextRevision"},
        )
        self.assertEqual(data["ownerId"], OWNER)
        self.assertEqual(data["answerText"], ANSWER)
        self.assertNotIn("question", data)
        self.assertNotIn("snapshot", data)
        self.assertNotIn("datosRelevantes", data)

    def test_the_envelope_is_frozen_and_redacts_the_answer_in_repr(self):
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        envelope = outcome.envelope
        with self.assertRaises(FrozenInstanceError):
            envelope.answer_text = "changed"
        self.assertNotIn(ANSWER, repr(envelope))
        self.assertNotIn(EPOCH, repr(self.binding))

    def test_two_independent_pairs_never_cross_owners(self):
        self.harness.open_session(OWNER2, SNAPSHOT2)
        link2 = self.harness.pair(OWNER2, PHONE2)
        outcome2 = self.harness.coordinator.handle_query(self.harness.binding(link2), QUESTION)
        self.harness.assert_outcome(outcome2, QUERY_ANSWER_DELIVERED)
        self.assertEqual(len(self.harness.parses), 1)
        self.assertEqual(self.harness.parses[0][0], SNAPSHOT2)
        self.assertEqual(self.harness.deliveries[0][1], ANSWER)
        self.assertEqual(outcome2.envelope.owner_id, OWNER2)

    def test_a_query_on_an_unlinked_phone_is_not_routed(self):
        self.harness.registry.unlink_phone(PHONE, self.link.generation)
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_IGNORED_STALE, delivery=None)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(self.harness.deliveries, [])
        self.assertEqual(self.harness.parses, [])
        self.assertEqual(self.harness.touches, [])


class ChannelAQueryBindingTests(unittest.TestCase):
    def setUp(self):
        self.harness = QueryHarness()
        self.harness.open_session(OWNER)
        self.harness.open_session(OWNER2, SNAPSHOT2)
        self.link = self.harness.pair()
        self.binding = self.harness.binding(self.link)

    def assert_silent(self, outcome):
        self.harness.assert_outcome(outcome, QUERY_IGNORED_STALE, delivery=None)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(self.harness.deliveries, [])
        self.assertEqual(self.harness.parses, [])
        self.assertEqual(self.harness.context_reads, [])
        self.assertEqual(self.harness.touches, [])

    def test_non_binding_objects_are_silently_discarded(self):
        for value in (None, object(), {"phone_id": PHONE}, PHONE):
            with self.subTest(value=value):
                outcome = self.harness.coordinator.handle_query(value, QUESTION)
                self.harness.assert_outcome(outcome, QUERY_IGNORED_UNBOUND, delivery=None)
                self.assertIsNone(outcome.envelope)
                self.assertEqual(self.harness.deliveries, [])
                self.assertEqual(self.harness.touches, [])

    def test_an_input_at_or_below_the_confirmation_fence_is_stale(self):
        for fence in (100, 120):
            with self.subTest(fence=fence):
                binding = self.harness.binding(
                    self.link, update_id=100, confirmed_update_id=fence
                )
                self.assert_silent(self.harness.coordinator.handle_query(binding, QUESTION))

    def test_a_same_owner_relink_invalidates_the_old_binding(self):
        self.harness.registry.unlink_phone(PHONE, self.link.generation)
        replacement = self.harness.pair(OWNER, PHONE)
        self.assertNotEqual(replacement.generation, self.link.generation)
        self.assert_silent(self.harness.coordinator.handle_query(self.binding, QUESTION))
        fresh = self.harness.binding(replacement)
        self.harness.assert_outcome(
            self.harness.coordinator.handle_query(fresh, QUESTION), QUERY_ANSWER_DELIVERED
        )
        self.assertEqual(self.harness.parses[0][0], SNAPSHOT)

    def test_a_different_owner_binding_is_never_resolved(self):
        binding = self.harness.binding(self.link, owner_id=OWNER2)
        self.assert_silent(self.harness.coordinator.handle_query(binding, QUESTION))

    def test_a_stale_generation_binding_is_discarded(self):
        binding = self.harness.binding(self.link, generation=self.link.generation + 5)
        self.assert_silent(self.harness.coordinator.handle_query(binding, QUESTION))

    def test_a_new_adapter_epoch_discards_an_old_binding(self):
        old = self.harness.binding(self.link)
        self.harness.epoch = EPOCH2
        fresh = self.harness.build()
        self.assert_silent(fresh.handle_query(old, QUESTION))
        # The registry link itself was never touched: the adapter epoch is the
        # only reason the old binding died.
        self.assertIsNotNone(self.harness.registry.phone_link(PHONE))
        self.assert_silent(fresh.handle_query(old, QUESTION))
        new = self.harness.binding(self.link)
        self.harness.assert_outcome(
            fresh.handle_query(new, QUESTION), QUERY_ANSWER_DELIVERED
        )
        self.assertEqual(self.harness.parses[0][0], SNAPSHOT)

    def test_a_validator_refusal_discards_the_query_without_context_or_send(self):
        self.harness.validate_hook = lambda binding: False
        self.assert_silent(self.harness.coordinator.handle_query(self.binding, QUESTION))

    def test_an_unknown_owner_link_in_the_registry_is_never_admitted(self):
        other = self.harness.binding(
            self.link, phone_id=PHONE3, owner_id=OWNER2, generation=1
        )
        self.assert_silent(self.harness.coordinator.handle_query(other, QUESTION))

    def test_binding_mutations_after_capture_do_not_rebind_the_owner(self):
        self.harness.registry.unlink_phone(PHONE, self.link.generation)
        self.harness.pair(OWNER2, PHONE3)
        self.assert_silent(self.harness.coordinator.handle_query(self.binding, QUESTION))


class ChannelAQueryInputBoundsTests(unittest.TestCase):
    def setUp(self):
        self.harness = QueryHarness()
        self.harness.open_session(OWNER)
        self.link = self.harness.pair()
        self.binding = self.harness.binding(self.link)

    def query(self, question):
        return self.harness.coordinator.handle_query(self.binding, question)

    def assert_ignored(self, question, kind):
        outcome = self.query(question)
        self.harness.assert_outcome(outcome, kind, delivery=None)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(self.harness.parses, [])
        self.assertEqual(self.harness.deliveries, [])
        self.assertEqual(self.harness.context_reads, [])
        self.assertEqual(self.harness.touches, [])

    def test_blank_and_whitespace_questions_are_ignored(self):
        for question in ("", "   ", "\n\t"):
            with self.subTest(question=question):
                self.assert_ignored(question, QUERY_IGNORED_BLANK)

    def test_commands_are_never_routed_as_questions(self):
        for question in ("/start", "/help", "  /unlink  ", "/start token"):
            with self.subTest(question=question):
                self.assert_ignored(question, QUERY_IGNORED_COMMAND)

    def test_non_string_questions_are_ignored(self):
        for question in (None, 5, ["q"], {"q": "x"}, b"q"):
            with self.subTest(question=question):
                self.assert_ignored(question, QUERY_IGNORED_MALFORMED)

    def test_surrogate_questions_fail_closed(self):
        self.assert_ignored("hola \ud800 mundo", QUERY_IGNORED_MALFORMED)

    def test_the_byte_bound_is_the_injected_policy(self):
        harness = QueryHarness(max_question_bytes=6)
        harness.open_session(OWNER)
        link = harness.pair()
        binding = harness.binding(link)
        self.harness.assert_outcome(
            harness.coordinator.handle_query(binding, "ááá"), QUERY_ANSWER_DELIVERED
        )
        self.assertEqual(harness.parses[0][1], "ááá")
        outcome = harness.coordinator.handle_query(binding, "áááá")
        harness.assert_outcome(outcome, QUERY_IGNORED_OVERSIZE, delivery=None)
        self.assertEqual(len(harness.parses), 1)
        self.assertEqual(harness.touches, [(PHONE, link.generation)])

    def test_an_oversize_question_never_touches_or_reads_context(self):
        harness = QueryHarness(max_question_bytes=16)
        harness.open_session(OWNER)
        link = harness.pair()
        outcome = harness.coordinator.handle_query(harness.binding(link), "x" * 17)
        harness.assert_outcome(outcome, QUERY_IGNORED_OVERSIZE, delivery=None)
        self.assertEqual(harness.touches, [])
        self.assertEqual(harness.context_reads, [])
        self.assertEqual(harness.deliveries, [])

    def test_a_question_of_128_characters_is_still_a_valid_ordinary_query(self):
        question = "a" * 128
        self.harness.assert_outcome(self.query(question), QUERY_ANSWER_DELIVERED)
        self.assertEqual(self.harness.parses[0][1], question)


class ChannelAQueryFreshnessTests(unittest.TestCase):
    def setUp(self):
        self.harness = QueryHarness()
        self.harness.open_session(OWNER)
        self.link = self.harness.pair()
        self.binding = self.harness.binding(self.link)

    def assert_notice(self, outcome):
        self.harness.assert_outcome(outcome, QUERY_UNAVAILABLE, delivery=DELIVERED)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(len(self.harness.deliveries), 1)
        self.assertEqual(self.harness.deliveries[0][1], COPY_QUERY_UNAVAILABLE)

    def test_a_missing_context_fails_closed_with_a_generic_notice(self):
        self.harness.sessions = HmiSessionRegistry(
            clock=lambda: self.harness.wall[0],
            owner_factory=lambda: OWNER,
            entropy=sequential_entropy(),
        )
        self.harness.open_session(OWNER, snapshot=None)
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.assert_notice(outcome)
        self.assertEqual(self.harness.parses, [])
        self.assertEqual(self.harness.touches, [(PHONE, self.link.generation)])

    def test_a_stale_context_fails_closed_with_a_generic_notice(self):
        self.harness.wall[0] += self.harness.freshness_bound + 1
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.assert_notice(outcome)
        self.assertEqual(self.harness.parses, [])

    def test_a_slow_reader_that_spends_the_deadline_never_parses(self):
        def slow(owner_id, max_age_seconds):
            self.harness.mono[0] += 5.0
            return 29.0, SNAPSHOT, 1

        self.harness.context_override = slow
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.assert_notice(outcome)
        self.assertEqual(self.harness.parses, [])
        self.assertIsNone(outcome.envelope)

    def test_a_captured_deadline_is_not_refreshed_by_a_new_snapshot(self):
        def refresh_during_parse():
            # A brand new, perfectly fresh owner context appears mid-computation.
            self.harness.wall[0] = 1000.0
            self.harness.open_session(OWNER, SNAPSHOT2)
            self.harness.mono[0] += 5.0

        self.harness.context_override = lambda owner_id, max_age_seconds: (29.0, SNAPSHOT, 1)
        self.harness.parser_hook = refresh_during_parse
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.assert_notice(outcome)
        self.assertEqual(len(self.harness.parses), 1)
        self.assertEqual(self.harness.parses[0][0], SNAPSHOT)
        self.assertEqual(len(self.harness.deliveries), 1)
        self.assertEqual(self.harness.deliveries[0][1], COPY_QUERY_UNAVAILABLE)

    def test_an_expired_deadline_before_the_send_never_delivers_the_answer(self):
        self.harness.context_override = lambda owner_id, max_age_seconds: (29.5, SNAPSHOT, 1)
        self.harness.parser_hook = lambda: self.harness.mono.__setitem__(0, self.harness.mono[0] + 1.0)
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.assert_notice(outcome)
        self.assertEqual(self.harness.deliveries[0][1], COPY_QUERY_UNAVAILABLE)

    def test_an_invalid_start_clock_refuses_silently_without_touch(self):
        harness = QueryHarness()
        harness.open_session(OWNER)
        link = harness.pair()
        coordinator = harness.build(clock=lambda: "not-a-number")
        outcome = coordinator.handle_query(harness.binding(link), QUESTION)
        harness.assert_outcome(outcome, QUERY_IGNORED_STALE, delivery=None)
        self.assertEqual(harness.touches, [])
        self.assertEqual(harness.deliveries, [])

    def test_a_regressing_clock_refuses_silently(self):
        self.harness.context_override = lambda owner_id, max_age_seconds: (1.0, SNAPSHOT, 1)
        self.harness.context_hook = lambda: self.harness.mono.__setitem__(0, self.harness.mono[0] - 10.0)
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_IGNORED_STALE, delivery=None)
        self.assertEqual(self.harness.deliveries, [])

    def test_a_returned_age_above_the_bound_is_never_answered(self):
        self.harness.context_override = lambda owner_id, max_age_seconds: (
            max_age_seconds + 1.0,
            SNAPSHOT,
            1,
        )
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.assert_notice(outcome)
        self.assertEqual(self.harness.parses, [])

    def test_a_non_numeric_or_negative_age_is_never_answered(self):
        for age in ("1", None, True, float("nan"), -1.0, float("inf")):
            with self.subTest(age=age):
                self.harness = QueryHarness()
                self.harness.open_session(OWNER)
                link = self.harness.pair()
                binding = self.harness.binding(link)
                self.harness.context_override = (
                    lambda owner_id, max_age_seconds, age=age: (age, SNAPSHOT, 1)
                )
                outcome = self.harness.coordinator.handle_query(binding, QUESTION)
                self.harness.assert_outcome(outcome, QUERY_UNAVAILABLE)
                self.assertIsNone(outcome.envelope)
                self.assertEqual(self.harness.parses, [])

    def test_a_non_tuple_reader_result_fails_closed(self):
        for value in (None, SNAPSHOT, (1.0,), (1.0, SNAPSHOT), (1.0, SNAPSHOT, 1, 2)):
            with self.subTest(value=value):
                self.harness = QueryHarness()
                self.harness.open_session(OWNER)
                link = self.harness.pair()
                binding = self.harness.binding(link)
                self.harness.context_override = (
                    lambda owner_id, max_age_seconds, value=value: value
                )
                outcome = self.harness.coordinator.handle_query(binding, QUESTION)
                self.harness.assert_outcome(outcome, QUERY_UNAVAILABLE)
                self.assertEqual(self.harness.parses, [])

    def test_a_raising_context_reader_never_reaches_the_parser(self):
        def boom(owner_id, max_age_seconds):
            raise RuntimeError("reader exploded")

        self.harness.context_override = boom
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.assert_notice(outcome)
        self.assertEqual(self.harness.parses, [])


class ChannelAQueryAnswerTests(unittest.TestCase):
    def setUp(self):
        self.harness = QueryHarness()
        self.harness.open_session(OWNER)
        self.link = self.harness.pair()
        self.binding = self.harness.binding(self.link)

    def assert_unavailable(self, outcome):
        self.harness.assert_outcome(outcome, QUERY_UNAVAILABLE, delivery=DELIVERED)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(self.harness.deliveries[-1][1], COPY_QUERY_UNAVAILABLE)

    def test_a_raising_parser_fails_closed_without_leaking_input(self):
        self.harness.answer_text = RuntimeError("parser exploded")
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.assert_unavailable(outcome)
        self.assertNotIn(QUESTION, repr(outcome))
        self.assertNotIn(COPY_QUERY_UNAVAILABLE, repr(outcome))

    def test_answers_without_a_string_answer_text_are_never_coerced(self):
        for value in ({}, {"answer_text": "dict answer"}, 5, ["answer"], None, "plain string"):
            with self.subTest(value=value):
                self.harness.parser_product = value
                outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
                self.assert_unavailable(outcome)

    def test_an_object_with_a_non_string_answer_text_is_refused(self):
        class Weird:
            answer_text = 5

        self.harness.answer_text = Weird()
        self.assert_unavailable(self.harness.coordinator.handle_query(self.binding, QUESTION))

    def test_blank_answers_are_refused_instead_of_sent(self):
        self.harness.answer_text = "   "
        self.assert_unavailable(self.harness.coordinator.handle_query(self.binding, QUESTION))

    def test_overlong_answers_are_refused_without_silent_truncation(self):
        harness = QueryHarness(max_answer_chars=10, answer_text="x" * 11)
        harness.open_session(OWNER)
        link = harness.pair()
        outcome = harness.coordinator.handle_query(harness.binding(link), QUESTION)
        harness.assert_outcome(outcome, QUERY_UNAVAILABLE)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(harness.deliveries[0][1], COPY_QUERY_UNAVAILABLE)

    def test_an_answer_object_with_answer_text_uses_the_exact_text(self):
        self.harness.answer_text = "  spaced answer  "
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_ANSWER_DELIVERED)
        self.assertEqual(self.harness.deliveries[0][1], "  spaced answer  ")
        self.assertEqual(outcome.envelope.answer_text, "  spaced answer  ")

    def test_a_parser_invalidation_discards_the_result_before_sending(self):
        def invalidate():
            self.harness.registry.unlink_phone(PHONE, self.link.generation)

        self.harness.parser_hook = invalidate
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_IGNORED_STALE, delivery=None)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(self.harness.deliveries, [])

    def test_a_context_callback_invalidation_discards_the_query(self):
        self.harness.context_hook = lambda: self.harness.registry.unlink_phone(
            PHONE, self.link.generation
        )
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_IGNORED_STALE, delivery=None)
        self.assertEqual(self.harness.parses, [])
        self.assertEqual(self.harness.deliveries, [])

    def test_a_raising_answer_text_property_fails_closed_sanitized(self):
        class Exploding:
            @property
            def answer_text(self):
                raise RuntimeError("accessor-canary")

        self.harness.parser_product = Exploding()
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.assert_unavailable(outcome)
        self.assertIsNone(outcome.envelope)
        rendered = repr(outcome) + repr(outcome.envelope) + repr(self.harness.deliveries)
        self.assertNotIn("accessor-canary", rendered)


class ChannelAQueryValidatorOrderingTests(unittest.TestCase):
    """The admission seam runs before the authoritative registry read."""

    def setUp(self):
        self.harness = QueryHarness()
        self.harness.open_session(OWNER)
        self.harness.open_session(OWNER2, SNAPSHOT2)
        self.link = self.harness.pair()
        self.binding = self.harness.binding(self.link)

    def relink(self, owner):
        current = self.harness.registry.phone_link(PHONE)
        self.harness.registry.unlink_phone(PHONE, current.generation)
        return self.harness.pair(owner, PHONE)

    def test_the_admission_seam_runs_before_the_authoritative_registry_read(self):
        events = []
        original = self.harness.registry.phone_link

        def spy(phone_id):
            events.append("registry")
            return original(phone_id)

        self.harness.registry.phone_link = spy
        self.harness.validate_hook = lambda binding: events.append("validate") or True
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_ANSWER_DELIVERED)
        self.assertEqual(events[0], "validate")
        # No cached pre-callback registry read may authorize a query: every
        # authoritative registry read follows the effectful admission seam.
        for index, name in enumerate(events):
            if name == "registry":
                self.assertGreater(index, 0)
                self.assertEqual(events[index - 1], "validate")

    def test_a_final_predelivery_validation_relink_refuses_the_answer(self):
        state = {"parsed": False, "acted": False}
        self.harness.parser_hook = lambda: state.__setitem__("parsed", True)

        def hook(binding):
            if state["parsed"] and not state["acted"]:
                state["acted"] = True
                self.relink(OWNER)
            return True

        self.harness.validate_hook = hook
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_IGNORED_STALE, delivery=None)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(self.harness.deliveries, [])

    def test_a_final_predelivery_validation_handover_refuses_the_answer(self):
        state = {"parsed": False, "acted": False}
        self.harness.parser_hook = lambda: state.__setitem__("parsed", True)

        def hook(binding):
            if state["parsed"] and not state["acted"]:
                state["acted"] = True
                self.relink(OWNER2)
            return True

        self.harness.validate_hook = hook
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_IGNORED_STALE, delivery=None)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(self.harness.deliveries, [])

    def test_a_final_predelivery_validation_unlink_produces_no_output(self):
        state = {"parsed": False, "acted": False}
        self.harness.parser_hook = lambda: state.__setitem__("parsed", True)

        def hook(binding):
            if state["parsed"] and not state["acted"]:
                state["acted"] = True
                current = self.harness.registry.phone_link(PHONE)
                self.harness.registry.unlink_phone(PHONE, current.generation)
            return True

        self.harness.validate_hook = hook
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_IGNORED_STALE, delivery=None)
        self.assertEqual(self.harness.deliveries, [])
        self.assertIsNone(outcome.envelope)

    def test_a_post_send_validation_relink_withholds_the_envelope(self):
        state = {"sent": False, "acted": False}
        self.harness.deliver_hook = lambda: state.__setitem__("sent", True)

        def hook(binding):
            if state["sent"] and not state["acted"]:
                state["acted"] = True
                self.relink(OWNER)
            return True

        self.harness.validate_hook = hook
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_ANSWER_UNPUBLISHED, delivery=DELIVERED)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(self.harness.deliveries[0][1], ANSWER)

    def test_a_validation_that_unlinks_during_fail_closed_sends_no_notice(self):
        self.harness.sessions = HmiSessionRegistry(
            clock=lambda: self.harness.wall[0],
            owner_factory=lambda: OWNER,
            entropy=sequential_entropy(),
        )
        self.harness.open_session(OWNER, snapshot=None)
        state = {"read": False, "acted": False}
        self.harness.context_hook = lambda: state.__setitem__("read", True)

        def boom(owner_id, max_age_seconds):
            raise RuntimeError("missing context")

        self.harness.context_override = boom

        def hook(binding):
            if state["read"] and not state["acted"]:
                state["acted"] = True
                current = self.harness.registry.phone_link(PHONE)
                self.harness.registry.unlink_phone(PHONE, current.generation)
            return True

        self.harness.validate_hook = hook
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_IGNORED_STALE, delivery=None)
        self.assertEqual(self.harness.deliveries, [])


class ChannelAQueryDeadlineRaceTests(unittest.TestCase):
    """The captured deadline is resampled after the last validator, before send."""

    def setUp(self):
        self.harness = QueryHarness()
        self.harness.open_session(OWNER)
        self.link = self.harness.pair()
        self.binding = self.harness.binding(self.link)

    def test_a_final_predelivery_validation_that_expires_the_deadline_sends_no_answer(self):
        self.harness.context_override = lambda owner_id, max_age_seconds: (29.0, SNAPSHOT, 1)
        state = {"parsed": False, "acted": False}
        self.harness.parser_hook = lambda: state.__setitem__("parsed", True)

        def hook(binding):
            if state["parsed"] and not state["acted"]:
                state["acted"] = True
                self.harness.mono[0] = 52.0
            return True

        self.harness.validate_hook = hook
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_UNAVAILABLE, delivery=DELIVERED)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(self.harness.deliveries[0][1], COPY_QUERY_UNAVAILABLE)

    def test_a_post_send_validation_that_expires_the_deadline_withholds_the_envelope(self):
        self.harness.context_override = lambda owner_id, max_age_seconds: (29.9, SNAPSHOT, 1)
        state = {"sent": False, "acted": False}
        self.harness.deliver_hook = lambda: state.__setitem__("sent", True)

        def hook(binding):
            if state["sent"] and not state["acted"]:
                state["acted"] = True
                self.harness.mono[0] += 1.0
            return True

        self.harness.validate_hook = hook
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_ANSWER_UNPUBLISHED, delivery=DELIVERED)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(self.harness.deliveries[0][1], ANSWER)

    def test_an_age_exactly_at_the_bound_is_already_expired(self):
        self.harness.context_override = lambda owner_id, max_age_seconds: (
            float(max_age_seconds),
            SNAPSHOT,
            1,
        )
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_UNAVAILABLE, delivery=DELIVERED)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(self.harness.parses, [])
        self.assertEqual(self.harness.deliveries[0][1], COPY_QUERY_UNAVAILABLE)

    def test_a_slow_validator_that_crosses_the_deadline_sends_no_answer(self):
        self.harness.context_override = lambda owner_id, max_age_seconds: (28.0, SNAPSHOT, 1)
        state = {"parsed": False, "acted": False}
        self.harness.parser_hook = lambda: state.__setitem__("parsed", True)

        def hook(binding):
            if state["parsed"] and not state["acted"]:
                state["acted"] = True
                self.harness.mono[0] += 30.0
            return True

        self.harness.validate_hook = hook
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_UNAVAILABLE, delivery=DELIVERED)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(self.harness.deliveries[0][1], COPY_QUERY_UNAVAILABLE)


class ChannelAQueryDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.harness = QueryHarness()
        self.harness.open_session(OWNER)
        self.link = self.harness.pair()
        self.binding = self.harness.binding(self.link)

    def test_a_rejected_send_exposes_no_envelope_and_is_never_retried(self):
        self.harness.delivery_script = [REJECTED]
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_ANSWER_REJECTED, delivery=REJECTED)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(len(self.harness.deliveries), 1)
        self.assertEqual(self.harness.deliveries[0][1], ANSWER)

    def test_an_unknown_send_exposes_no_envelope_and_is_never_retried(self):
        self.harness.delivery_script = [UNKNOWN]
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_ANSWER_UNKNOWN, delivery=UNKNOWN)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(len(self.harness.deliveries), 1)

    def test_a_raising_send_is_unknown_and_exposes_no_envelope(self):
        def boom():
            raise RuntimeError("transport exploded")

        self.harness.deliver_hook = boom
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_ANSWER_UNKNOWN, delivery=UNKNOWN)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(len(self.harness.deliveries), 1)

    def test_a_non_string_send_classification_is_unknown(self):
        self.harness.delivery_script = [None]
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_ANSWER_UNKNOWN, delivery=UNKNOWN)
        self.assertIsNone(outcome.envelope)

    def test_a_post_send_relink_reports_delivery_but_withholds_the_envelope(self):
        def relink():
            self.harness.registry.unlink_phone(PHONE, self.link.generation)
            self.harness.pair(OWNER, PHONE)

        self.harness.deliver_hook = relink
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_ANSWER_UNPUBLISHED, delivery=DELIVERED)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(self.harness.deliveries[0][1], ANSWER)

    def test_a_post_send_different_owner_reports_delivery_without_envelope(self):
        def handover():
            self.harness.registry.unlink_phone(PHONE, self.link.generation)
            self.harness.pair(OWNER2, PHONE)

        self.harness.open_session(OWNER2, SNAPSHOT2)
        self.harness.deliver_hook = handover
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_ANSWER_UNPUBLISHED, delivery=DELIVERED)
        self.assertIsNone(outcome.envelope)

    def test_a_deadline_that_expires_after_the_send_withholds_the_envelope(self):
        self.harness.context_override = lambda owner_id, max_age_seconds: (29.9, SNAPSHOT, 1)
        self.harness.deliver_hook = lambda: self.harness.mono.__setitem__(
            0, self.harness.mono[0] + 1.0
        )
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.harness.assert_outcome(outcome, QUERY_ANSWER_UNPUBLISHED, delivery=DELIVERED)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(self.harness.deliveries[0][1], ANSWER)

    def test_the_answer_send_is_never_classified_twice(self):
        self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.assertEqual(len(self.harness.deliveries), 1)
        self.assertEqual(self.harness.deliveries[0][0], self.binding)


class ChannelAContextRevisionTests(unittest.TestCase):
    def setUp(self):
        self.harness = QueryHarness(freshness_bound=15.0)
        self.capability = self.harness.open_session(OWNER)
        self.link = self.harness.pair()
        self.binding = self.harness.binding(self.link)

    def replace_context(self):
        self.harness.sessions.set_context(self.capability, SNAPSHOT2)

    def assert_no_answer(self, outcome):
        self.assertIsNone(outcome.envelope)
        self.assertNotIn(ANSWER, [text for _binding, text in self.harness.deliveries])
        # Preserve the generic-notice path while the phone binding stays valid.
        self.assertEqual(outcome.kind, QUERY_UNAVAILABLE)
        self.assertEqual(self.harness.deliveries, [(self.binding, COPY_QUERY_UNAVAILABLE)])

    def test_unchanged_answer_carries_the_exact_captured_context_revision(self):
        self.replace_context()
        _, snapshot, revision = self.harness.sessions.capture_owner_context(
            OWNER, max_age_seconds=15
        )
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.assertEqual(outcome.kind, QUERY_ANSWER_DELIVERED)
        self.assertEqual(self.harness.parses, [(snapshot, QUESTION)])
        self.assertEqual(outcome.envelope.context_revision, revision)
        self.assertEqual(outcome.envelope.as_dict()["contextRevision"], revision)
        self.assertEqual(outcome.envelope.answer_text, ANSWER)
        self.assertEqual(self.harness.context_reads, [(OWNER, 15.0)])

    def test_parser_replacement_never_sends_the_answer_from_the_old_snapshot(self):
        self.harness.parser_hook = self.replace_context
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.assertEqual(self.harness.parses, [(SNAPSHOT, QUESTION)])
        self.assert_no_answer(outcome)

    def test_parser_invalidation_refuses_the_captured_revision(self):
        current = [True]
        self.harness.parser_hook = lambda: current.__setitem__(0, False)
        coordinator = self.harness.build(
            context_is_current=lambda _owner, _revision: current[0]
        )
        self.assert_no_answer(coordinator.handle_query(self.binding, QUESTION))
        self.assertEqual(self.harness.parses, [(SNAPSHOT, QUESTION)])

    def test_revision_validator_cannot_spend_the_remaining_lifetime_before_send(self):
        self.harness.wall[0] += 14.0

        def validate_revision(owner, revision):
            if self.harness.parses:
                self.harness.mono[0] = 51.0
            return self.harness.sessions.is_owner_context_current(owner, revision)

        coordinator = self.harness.build(context_is_current=validate_revision)
        self.assert_no_answer(coordinator.handle_query(self.binding, QUESTION))

    def test_revision_validator_cannot_spend_the_remaining_lifetime_after_send(self):
        self.harness.wall[0] += 14.0

        def validate_revision(owner, revision):
            if self.harness.deliveries:
                self.harness.mono[0] = 51.0
            return self.harness.sessions.is_owner_context_current(owner, revision)

        coordinator = self.harness.build(context_is_current=validate_revision)
        outcome = coordinator.handle_query(self.binding, QUESTION)
        self.assertEqual(outcome.kind, QUERY_ANSWER_UNPUBLISHED)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(self.harness.deliveries, [(self.binding, ANSWER)])

    def test_parser_owner_close_never_sends_the_captured_answer(self):
        self.harness.parser_hook = lambda: self.harness.sessions.close(self.capability)
        self.assert_no_answer(self.harness.coordinator.handle_query(self.binding, QUESTION))

    def test_admission_callback_replacement_after_capture_prevents_parsing(self):
        def validate(_binding):
            if self.harness.context_reads:
                self.replace_context()
            return True

        self.harness.validate_hook = validate
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.assert_no_answer(outcome)
        self.assertEqual(self.harness.parses, [])

    def test_final_admission_callback_replacement_prevents_phone_answer(self):
        def validate(_binding):
            if self.harness.parses:
                self.replace_context()
            return True

        self.harness.validate_hook = validate
        self.assert_no_answer(self.harness.coordinator.handle_query(self.binding, QUESTION))
        self.assertEqual(self.harness.parses, [(SNAPSHOT, QUESTION)])

    def test_delivered_phone_answer_is_not_published_after_context_replacement(self):
        self.harness.deliver_hook = self.replace_context
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.assertEqual(outcome.kind, QUERY_ANSWER_UNPUBLISHED)
        self.assertEqual(outcome.delivery, DELIVERED)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(self.harness.deliveries, [(self.binding, ANSWER)])

    def test_post_send_admission_replacement_withholds_envelope_without_resending(self):
        def validate(_binding):
            if self.harness.deliveries:
                self.replace_context()
            return True

        self.harness.validate_hook = validate
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.assertEqual(outcome.kind, QUERY_ANSWER_UNPUBLISHED)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(self.harness.deliveries, [(self.binding, ANSWER)])

    def test_new_context_cannot_extend_the_original_fifteen_second_deadline(self):
        self.harness.wall[0] += 14.0

        def parse_finished():
            self.replace_context()
            self.harness.mono[0] += 1.0

        self.harness.parser_hook = parse_finished
        self.assert_no_answer(self.harness.coordinator.handle_query(self.binding, QUESTION))
        self.assertEqual(self.harness.context_reads, [(OWNER, 15.0)])

    def test_post_send_expiry_at_the_original_deadline_withholds_envelope(self):
        self.harness.wall[0] += 14.0
        self.harness.deliver_hook = lambda: self.harness.mono.__setitem__(0, 51.0)
        outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
        self.assertEqual(outcome.kind, QUERY_ANSWER_UNPUBLISHED)
        self.assertIsNone(outcome.envelope)
        self.assertEqual(self.harness.deliveries, [(self.binding, ANSWER)])

    def test_context_revision_must_be_a_strict_positive_integer(self):
        for revision in (None, True, False, 0, -1, 1.0, "1", float("nan")):
            with self.subTest(revision=revision):
                self.harness.parses.clear()
                self.harness.deliveries.clear()
                self.harness.context_override = lambda _owner, _bound: (0.0, SNAPSHOT, revision)
                outcome = self.harness.coordinator.handle_query(self.binding, QUESTION)
                self.assert_no_answer(outcome)
                self.assertEqual(self.harness.parses, [])

    def test_legacy_two_tuple_reader_cannot_bypass_the_required_revision(self):
        self.harness.context_override = lambda _owner, _bound: (0.0, SNAPSHOT)
        self.assert_no_answer(self.harness.coordinator.handle_query(self.binding, QUESTION))
        self.assertEqual(self.harness.parses, [])

    def test_revision_validator_refusal_and_exception_fail_closed(self):
        def unavailable(_owner, _revision):
            raise RuntimeError("private-validator-detail")

        for validator in (lambda _owner, _revision: False, unavailable):
            with self.subTest(validator=validator):
                self.harness.deliveries.clear()
                coordinator = self.harness.build(context_is_current=validator)
                outcome = coordinator.handle_query(self.binding, QUESTION)
                self.assert_no_answer(outcome)
                self.assertEqual(self.harness.parses, [])
                self.assertNotIn("private-validator-detail", repr(outcome))


class QueryEnvelopeDeadlineTests(unittest.TestCase):
    """The captured monotonic deadline is a required internal envelope field.

    The coordinator already computes the deadline from the injected monotonic
    query clock; anchoring it inside the envelope makes the captured answer's
    lifetime immune to same-frame receipt renewal. The field stays internal:
    ``as_dict`` and the answerEnvelope wire projection are unchanged, and the
    six-field constructor fails at construction, not at the guard.
    """

    def envelope(self, **overrides):
        values = {
            "owner_id": OWNER,
            "generation": 1,
            "update_id": 11,
            "epoch": EPOCH,
            "answer_text": ANSWER,
            "context_revision": 1,
            "captured_deadline": 61.5,
        }
        values.update(overrides)
        return QueryEnvelope(**values)

    def test_the_six_field_constructor_fails_at_construction_not_at_the_guard(self):
        with self.assertRaises(TypeError):
            QueryEnvelope(
                owner_id=OWNER, generation=1, update_id=11, epoch=EPOCH,
                answer_text=ANSWER, context_revision=1,
            )
        self.assertTrue(is_query_envelope_well_formed(self.envelope()))

    def test_the_deadline_must_be_a_positive_finite_float(self):
        invalid = (None, True, False, 1, "61.5", float("nan"), float("inf"),
                   -float("inf"), 0.0, -1.5)
        for deadline in invalid:
            with self.subTest(deadline=deadline):
                self.assertFalse(is_query_envelope_well_formed(
                    self.envelope(captured_deadline=deadline)))
        self.assertTrue(is_query_envelope_well_formed(
            self.envelope(captured_deadline=1.0)))

    def test_as_dict_keeps_the_internal_deadline_off_the_wire(self):
        data = self.envelope().as_dict()
        self.assertEqual(
            set(data),
            {"ownerId", "generation", "updateId", "epoch", "answerText",
             "contextRevision"},
        )
        self.assertNotIn("capturedDeadline", data)
        self.assertNotIn("captured_deadline", data)

    def test_the_delivered_envelope_anchors_the_coordinator_deadline(self):
        harness = QueryHarness()
        harness.open_session(OWNER)
        link = harness.pair()
        outcome = harness.coordinator.handle_query(harness.binding(link), QUESTION)
        harness.assert_outcome(outcome, QUERY_ANSWER_DELIVERED)
        envelope = outcome.envelope
        self.assertIs(type(envelope.captured_deadline), float)
        self.assertTrue(math.isfinite(envelope.captured_deadline))
        self.assertGreater(envelope.captured_deadline, harness.mono[0])
        self.assertTrue(is_query_envelope_well_formed(envelope))


if __name__ == "__main__":
    unittest.main()
