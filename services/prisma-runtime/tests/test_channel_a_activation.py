"""Test-first behavioral contract for the Channel A functional activation.

Scope
-----
This module is the test-first artifact of the bounded Channel A backend
composition unit (tracker: ``odd/tasks/prisma-channel-a-remote.md``, active
continuation). It exercises the *real* production objects end to end:

    ChannelARunner -> real ChannelAPairingDialogue over a real
    ChannelAPairingRegistry -> real HmiSessionRegistry -> the existing
    ``answer_from_snapshot`` parser -> the phone text the adapter sent.

One inert, self-contained Telegram boundary satisfies the actual runner and
dialogue protocols. The pairing link is never fabricated: the confirmation
callback data is read back from the button the dialogue itself delivered, and a
pre-linked ticket, a precomputed action nonce, a private action table and any
direct bypass of ``ChannelARunner`` are all deliberately absent. The identity
reservation is the real in-memory ``BotIdentityReservation``, not a double.

The proposal under test
-----------------------
The production surface does not exist yet. These tests define the proposed
public API of ``prisma_runtime.channel_a_activation``:

``ChannelAActivation(*, transport, sessions, destination_label, parse, on_outcome,
clock, pairing_clock, query_clock, warning_lead, max_question_bytes,
poll_timeout, read_timeout, join_timeout, poll_pause, reservation=None)``

* ``transport`` -- one transport object shared by the runner and the dialogue.
* ``sessions`` -- the real ``HmiSessionRegistry`` used as the owner-context
  reader (``get_owner_context``); no bearer capability is ever read.
* ``destination_label`` -- trusted ``owner_id -> str | None`` lookup.
* ``parse`` -- the existing parser injected as a dependency, so the composition
  never imports the local presentation application module (no import cycle).
* ``on_outcome`` -- the caller-injected synchronous consumer with exactly the
  runner's semantics: invoked once per completed ingress outcome, in order, and
  never handed the same outcome twice. The composition publishes and forgets; it
  keeps no retained outcome, envelope or history state of its own, and this
  module's observation ledger is test-owned.
* ``clock`` / ``pairing_clock`` / ``query_clock`` -- three independent monotonic
  domains: the runner's seven-day horizon, the pairing registry (whose dialogue
  resolves its own clock from the registry), and the query coordinator's
  freshness arithmetic.
* ``warning_lead`` -- the pairing registry requires an injected warning lead.
* ``poll_timeout`` / ``read_timeout`` / ``join_timeout`` / ``poll_pause`` -- the
  runner's mandatory bounded budget.
* ``reservation`` -- an injected equivalent of the runner's reservation seam; a
  real ``BotIdentityReservation`` here, and ``None`` in production selects the
  shared process registry exactly as the runner documents.

Methods: ``prepare()`` (delegates to the runner and propagates its closed error
on failure), ``issue_pairing_challenge(owner_id)``, ``poll_once()`` (synchronous,
never ``start()``) and ``stop()`` (sticky, idempotent).

``issue_pairing_challenge`` returns ``None`` for every activation that is not
currently authorized to issue a challenge: before a successful prepare, after a
terminal failure, after idle retirement, and after a stop request -- including a
stop whose settle has not been confirmed and whose ``stop()`` returned ``False``.
It consults only the runner's public ``status()``; no private runner field is
read, and the runner's own sticky fences are preserved rather than replicated.

Fixed policy exercised here: a 15-second receipt-age bound applied both to
``get_owner_context(max_age_seconds=15.0)`` and to the coordinator's
``freshness_bound``. The 4096-byte HMI question policy is exercised behaviorally
as well. ``max_question_bytes`` is injected from the existing
``HMI_QUESTION_MAX_BYTES`` constant at composition time, so the activation module
does not duplicate the policy or import the application module.

Required additional source seam (specified; execution still pending)
---------------------------------------------------------------------
``ChannelAPairingDialogue.enable_queries`` accepts no clock, so the coordinator's
``clock`` default (``time.monotonic``) is captured once at class definition and a
deterministic query clock cannot be injected. The test proposes an explicit
``query_clock`` dependency instead of mutating ``coordinator.clock`` or private
state. The intended behavioral check is that a parser spending the captured
remaining lifetime withholds the answer when the injected clock reaches the
coordinator; this test has not yet been executed. The minimal additive seam this requires in a later, separately
scoped production task is an optional keyword on ``enable_queries``:

    def enable_queries(self, *, ..., clock=None):
        options = {...}
        if clock is not None:
            options["clock"] = clock
        coordinator = ChannelAQueryCoordinator(**options)

No behavior changes when the keyword is omitted.

Safety posture
--------------
Nothing here performs real I/O, sleeps, starts a thread, proves concurrency or
inspects the environment or persisted state. The offline boundary is an
in-process object with no socket, no session, no thread and no clock.

Static import-surface review (no execution): every module imported at this
module's top level was inspected for column-zero initialization. The only
import-time calls anywhere in that closure are ``threading.Lock``,
``threading.BoundedSemaphore``, ``frozenset`` and ``re.compile``; there is no
import-time file access, directory creation, environment read, network client
construction or thread start. ``voice_service`` -- the only package module that
builds ``requests.Session`` objects and a ``Flask`` app at import time -- is not
in this closure. Unknown and unverified here: the import-time behavior of the
third-party ``requests`` and ``flask`` packages, which this pass neither executed
nor inspected.

``prisma_runtime.channel_a_activation`` is absent, so it is imported lazily
inside ``activate()`` -- after the containment layers are installed, with no
``ImportError`` catch and no fallback. A missing production module is therefore
reported as individual per-case errors while the independent guard-proof case
still executes, and no empty production scaffold is invented ahead of RED.

Containment: a per-test ``requests.Session.request`` record/refuse guard with a
persistent numeric ledger, an inert ``HTTPAdapter.send`` floor installed
underneath it, and external cleanup assertions that observe both ledgers while
the guard is still installed. Every owned activation is stopped first; each stop
result is collected and the collection is asserted externally, so a ``False``
settle can never be silently accepted.

No auxiliary cleanup/clock harness module is imported: this module is fully
self-contained, by design, so legacy or paused fixtures cannot be discovered
through it.
"""

from __future__ import annotations

import itertools
import sys
import unittest
from pathlib import Path

import requests
import requests.adapters

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.bot_identity_reservation import BotIdentityReservation
from prisma_runtime.channel_a_bot import (
    ACTION_REFUSED,
    BUTTON_CONFIRM,
    CALLBACK_CONFIRM,
    COPY_REFUSED,
    PAIRING_CONFIRMED,
    PAIRING_PROMPT_DELIVERED,
    PAIRING_REFUSED,
    SEND_DELIVERED,
    SEND_NONE,
)
from prisma_runtime.channel_a_lifecycle import (
    DISPOSITION_COMPLETED,
    DISPOSITION_FAILED,
    DISPOSITION_RESTART_REQUIRED,
    DISPOSITION_STOPPED,
    SEVEN_DAY_HORIZON_SECONDS,
    ChannelALifecycleError,
)
from prisma_runtime.channel_a_query import (
    COPY_QUERY_UNAVAILABLE,
    QUERY_ANSWER_DELIVERED,
    QUERY_ANSWER_UNPUBLISHED,
    QUERY_IGNORED_OVERSIZE,
    QUERY_IGNORED_UNBOUND,
    QUERY_UNAVAILABLE,
)
from prisma_runtime.channel_a_transport import ChannelABotIdentity
from prisma_runtime.hmi_sessions import HmiSessionRegistry
from prisma_runtime.local_presentation import HMI_QUESTION_MAX_BYTES, answer_from_snapshot

# A fixed, non-disclosing refusal shared by both offline dispatch layers.
CHANNEL_A_ACTIVATION_OFFLINE_REFUSED = "PRISMA_CHANNEL_A_ACTIVATION_OFFLINE_REFUSED"
# Reserved probe host. Safety comes from the two installed layers, never from the
# host name: name resolution and proxies can still perform I/O for a reserved name.
PROBE_URL = "https://channel-a-activation-probe.invalid/getMe"

BOT_ID = 700200
BOT_USERNAME = "prisma_channel_a_bot"
PHONE_A = 810001
PHONE_B = 810002

LABEL_A = "Prensa 12 - Linea sur"
LABEL_B = "Prensa 07 - Linea norte"

QUESTION = "¿cuál es el oee?"
SNAPSHOT_A = {
    "machine": {"id": "M-1", "name": "Prensa 12"},
    "widgets": [{"id": "oee", "title": "OEE", "data": {"value": 88.6}, "unit": "%"}],
}
SNAPSHOT_B = {
    "machine": {"id": "M-2", "name": "Prensa 07"},
    "widgets": [{"id": "oee", "title": "OEE", "data": {"value": 41.2}, "unit": "%"}],
}
ANSWER_A = "El OEE actual es 88,6 %."
ANSWER_B = "El OEE actual es 41,2 %."

# The observed HMI question policy, in UTF-8 bytes: one byte past it is refused.
QUESTION_MAX_BYTES = 4096
# 43 URL-safe characters: a well-formed opaque ticket that no live claim owns.
UNKNOWN_TICKET = "A" * 43


class OfflineDispatchRefused(RuntimeError):
    """Fixed guard error: an offline test must never dispatch a real request."""

    def __init__(self) -> None:
        super().__init__(CHANNEL_A_ACTIVATION_OFFLINE_REFUSED)


def install_inert_transport_floor(case) -> list:
    """Install the lower inert dispatcher below ``Session.request`` first.

    It records a bare numeric attempt and refuses, never building a socket,
    reading an environment value or inspecting the request. It is installed
    before the upper guard so a dispatch that somehow bypassed the guard still
    meets a layer this module owns. Restoration is registered immediately after
    the patch succeeds, so a partial ``setUp`` still restores it.
    """
    attempts: list = []
    original = requests.adapters.HTTPAdapter.send

    def inert_send(self, request, *args, **kwargs):
        attempts.append(1)
        raise OfflineDispatchRefused()

    requests.adapters.HTTPAdapter.send = inert_send
    case.addCleanup(lambda: setattr(requests.adapters.HTTPAdapter, "send", original))
    return attempts


def install_record_refuse_guard(case) -> list:
    """Record and refuse every real outbound dispatch for one test case.

    ``requests.Session.request`` is the single funnel behind every verb, so one
    class-level patch covers every channel call. The ledger counts bare numbers
    before any inspection; the refusal carries no URL, method, body or token
    detail. Restoration is registered immediately after the patch succeeds, so a
    partial ``setUp`` still restores it. The caller owns the external ledger
    assertion, so this helper can also drive the deliberate guard proof.
    """
    attempts: list = []
    original = requests.Session.request

    def guarded_request(self, method, url, *args, **kwargs):
        attempts.append(1)
        raise OfflineDispatchRefused()

    requests.Session.request = guarded_request
    case.addCleanup(lambda: setattr(requests.Session, "request", original))
    return attempts


def sequential_entropy():
    """Deterministic 32-byte entropy so two capabilities can never collide."""
    counter = itertools.count(1)

    def entropy(size):
        seed = next(counter)
        return bytes((seed + index) % 256 for index in range(size))

    return entropy


def sequential_owner_factory():
    """Distinct canonical UUID v4 owner identities in creation order."""
    counter = itertools.count(1)

    def factory():
        return "00000000-0000-4000-8000-%012d" % next(counter)

    return factory


def recording_parser(parse, calls):
    """Record every parse request before delegating to the injected parser.

    A recording seam around the real parser, not a replacement for it: the
    returned callable always produces the parser's own result.
    """

    def observed_parse(snapshot, question):
        calls.append((snapshot, question))
        return parse(snapshot, question)

    return observed_parse


def published_envelopes(observed):
    """The envelope of every published outcome that actually carried one."""
    return [outcome.answer_envelope for outcome in observed if outcome.answer_envelope is not None]


def start_update(update_id, chat_id, token):
    """One private ``/start <opaque>`` message envelope."""
    return {
        "update_id": update_id,
        "message": {
            "message_id": update_id,
            "date": 1700000000,
            "chat": {"id": chat_id, "type": "private"},
            "from": {"id": chat_id, "is_bot": False, "first_name": "Phone"},
            "text": "/start " + token,
        },
    }


def question_update(update_id, chat_id, text):
    """One private ordinary-text message envelope."""
    return {
        "update_id": update_id,
        "message": {
            "message_id": update_id,
            "date": 1700000000,
            "chat": {"id": chat_id, "type": "private"},
            "from": {"id": chat_id, "is_bot": False, "first_name": "Phone"},
            "text": text,
        },
    }


def callback_update(update_id, chat_id, callback_data):
    """One private callback-press envelope on a message this bot sent."""
    return {
        "update_id": update_id,
        "callback_query": {
            "id": "cbq-" + str(update_id),
            "from": {"id": chat_id, "is_bot": False},
            "data": callback_data,
            "message": {
                "message_id": 900000 + update_id,
                "date": 1700000000,
                "chat": {"id": chat_id, "type": "private"},
                "from": {"id": BOT_ID, "is_bot": True},
            },
        },
    }


def callback_data_for(transport, chat_id, button_text):
    """Read the real callback data the adapter put on a delivered button."""
    for message in transport.sent:
        if message["chatId"] != chat_id:
            continue
        markup = message["replyMarkup"] or {}
        for row in markup.get("inline_keyboard", []):
            for button in row:
                if button.get("text") == button_text:
                    return button["callback_data"]
    raise AssertionError("the expected inline button was never delivered")


class ScriptedChannelATransport:
    """Inert Telegram boundary satisfying the real runner and dialogue protocols.

    ``getMe``/``getUpdates``/``sendMessage``/``answerCallbackQuery`` and the
    scalar ``request_timeout`` are the whole surface. No socket, no session, no
    thread and no clock: batches are scripted and sends are recorded verbatim.
    """

    def __init__(self, *, identity, request_timeout=1.0, fail_get_me=False):
        self.identity = identity
        self.request_timeout = request_timeout
        self.bot_id = identity.id
        self.batches: list = []
        self.get_me_calls = 0
        self.get_updates_calls: list = []
        self.sent: list = []
        self.acknowledged: list = []
        self.fail_get_me = fail_get_me
        self._message_id = 9000

    def get_me(self):
        self.get_me_calls += 1
        if self.fail_get_me:
            raise RuntimeError("offline getMe failure")
        return self.identity

    def get_updates(self, *, poll_timeout, read_timeout, offset=None):
        self.get_updates_calls.append(
            {"pollTimeout": poll_timeout, "readTimeout": read_timeout, "offset": offset}
        )
        if self.batches:
            return self.batches.pop(0)
        return ()

    def send_message(self, *, chat_id, text, reply_markup=None):
        self._message_id += 1
        self.sent.append({"chatId": chat_id, "text": text, "replyMarkup": reply_markup})
        return {
            "ok": True,
            "result": {
                "message_id": self._message_id,
                "chat": {"id": chat_id, "type": "private"},
                "from": {"id": self.bot_id, "is_bot": True},
            },
        }

    def answer_callback_query(self, *, callback_query_id, text=None):
        self.acknowledged.append(callback_query_id)
        return True


class ActivationUnderTest:
    """Test-owned handle: the real composition, its boundary and its ledgers.

    ``observed`` receives each published ingress outcome exactly as the runner
    hands it to the caller-injected ``on_outcome``; ``parse_calls`` records every
    real parse request. Both ledgers live here, never inside the composition.
    """

    def __init__(self, activation, transport, observed, parse_calls):
        self.activation = activation
        self.transport = transport
        self.observed = observed
        self.parse_calls = parse_calls


class ActivationHarnessTestCase(unittest.TestCase):
    """Containment, controlled clocks and shared state for one activation case.

    Cleanup order is explicit and load-bearing (``addCleanup`` is LIFO): every
    owned activation is stopped first, the collected stop results and the
    persistent dispatch ledgers are then asserted while the guard is still
    installed, and only afterwards are the guard and the inert floor restored.
    """

    def setUp(self):
        super().setUp()
        self.activations: list = []
        self.stop_failures: list = []
        self.runner_now = [5000.0]
        self.pairing_now = [6000.0]
        self.query_now = [7000.0]
        self.wall_now = [1000.0]
        self.labels: dict = {}
        self.reservation = BotIdentityReservation()
        self.sessions = HmiSessionRegistry(
            clock=lambda: self.wall_now[0],
            entropy=sequential_entropy(),
            owner_factory=sequential_owner_factory(),
        )

        self.dispatch_floor_attempts = install_inert_transport_floor(self)
        self.dispatch_attempts = install_record_refuse_guard(self)
        self.addCleanup(self._assert_no_unexpected_dispatch)
        self.addCleanup(self._assert_activations_settled)
        self.addCleanup(self._stop_activations)

    # -- cleanup -----------------------------------------------------------

    def _stop_activations(self):
        """Stop every owned activation, collecting refusals and exceptions.

        No stop result is silently accepted: a ``False`` settle or a raising stop
        is recorded here and reported by the external assertion that runs after
        all attempts, while the dispatch guard is still installed. No thread is
        created by this module.
        """
        for activation in reversed(self.activations):
            try:
                settled = activation.stop()
            except Exception as error:  # reported, never swallowed
                self.stop_failures.append("stop raised " + type(error).__name__)
            else:
                if settled is not True:
                    self.stop_failures.append("stop did not settle")

    def _assert_activations_settled(self):
        self.assertEqual(self.stop_failures, [], "an owned activation did not settle cleanly")

    def _assert_no_unexpected_dispatch(self):
        # The upper guard must have refused nothing (no dispatch was attempted),
        # and the lower inert floor must never have been reached at all.
        self.assertEqual(
            self.dispatch_attempts, [], "an unexpected real HTTP dispatch was attempted"
        )
        self.assertEqual(
            self.dispatch_floor_attempts, [], "the lower inert dispatch floor was reached"
        )

    # -- fixtures ----------------------------------------------------------

    def new_owner(self, snapshot, label):
        """Create one HMI session, publish its snapshot and register a label."""
        capability, _metadata = self.sessions.create()
        owner_id = self.sessions.get_context(capability)[0]
        self.sessions.set_context(capability, snapshot)
        self.labels[owner_id] = label
        return owner_id

    def new_transport(self, *, fail_get_me=False):
        return ScriptedChannelATransport(
            identity=ChannelABotIdentity(id=BOT_ID, username=BOT_USERNAME),
            fail_get_me=fail_get_me,
        )

    def activate(self, *, transport=None, reservation=None, parse=None, pairing_clock=None):
        """Build the real composition over inert boundaries and fake clocks.

        The absent production module is imported here, after the containment
        layers are installed, with no ``ImportError`` catch and no fallback.
        ``pairing_clock`` optionally replaces the default fixture pairing clock
        for tests that must retarget individual clock samples.
        """
        from prisma_runtime.channel_a_activation import ChannelAActivation

        transport = self.new_transport() if transport is None else transport
        parse_calls: list = []
        observed: list = []
        injected_parse = answer_from_snapshot if parse is None else parse
        activation = ChannelAActivation(
            transport=transport,
            sessions=self.sessions,
            destination_label=lambda owner_id: self.labels.get(owner_id),
            parse=recording_parser(injected_parse, parse_calls),
            on_outcome=observed.append,
            clock=lambda: self.runner_now[0],
            pairing_clock=lambda: self.pairing_now[0] if pairing_clock is None else pairing_clock(),
            query_clock=lambda: self.query_now[0],
            warning_lead=60.0,
            max_question_bytes=HMI_QUESTION_MAX_BYTES,
            poll_timeout=1,
            read_timeout=2.0,
            join_timeout=1.0,
            poll_pause=0.05,
            reservation=self.reservation if reservation is None else reservation,
        )
        self.activations.append(activation)
        return ActivationUnderTest(activation, transport, observed, parse_calls)

    def link(self, fixture, phone_id, owner_id, update_id):
        """Link one phone through the real challenge -> start -> confirm flow."""
        activation = fixture.activation
        transport = fixture.transport
        challenge = activation.issue_pairing_challenge(owner_id)
        self.assertIsNotNone(challenge)
        self.assertEqual(challenge.owner_id, owner_id)
        transport.batches.append((start_update(update_id, phone_id, challenge.token),))
        prompt = activation.poll_once()
        self.assertEqual([outcome.kind for outcome in prompt.outcomes], [PAIRING_PROMPT_DELIVERED])
        confirm_data = callback_data_for(transport, phone_id, BUTTON_CONFIRM)
        transport.batches.append((callback_update(update_id + 1, phone_id, confirm_data),))
        confirmed = activation.poll_once()
        self.assertEqual([outcome.kind for outcome in confirmed.outcomes], [PAIRING_CONFIRMED])
        return challenge


class ChannelAActivationFlowTests(ActivationHarnessTestCase):
    """The authorized functional slice: correct owner, fresh context, real refusals."""

    def test_the_full_offline_flow_links_the_phone_and_answers_from_the_owner_snapshot(self):
        owner_a = self.new_owner(SNAPSHOT_A, LABEL_A)
        fixture = self.activate()
        activation = fixture.activation
        transport = fixture.transport

        self.assertTrue(activation.prepare())
        # The observed identity was frozen once: a repeated prepare never
        # re-observes the provider, and the same transport serves both sides.
        self.assertTrue(activation.prepare())
        self.assertEqual(transport.get_me_calls, 1)

        challenge = activation.issue_pairing_challenge(owner_a)
        self.assertIsNotNone(challenge)

        transport.batches.append((start_update(1, PHONE_A, challenge.token),))
        prompt = activation.poll_once()
        self.assertEqual(prompt.disposition, DISPOSITION_COMPLETED)
        self.assertEqual([outcome.kind for outcome in prompt.outcomes], [PAIRING_PROMPT_DELIVERED])
        delivered_prompt = transport.sent[-1]
        self.assertEqual(delivered_prompt["chatId"], PHONE_A)
        self.assertIn(LABEL_A, delivered_prompt["text"])

        confirm_data = callback_data_for(transport, PHONE_A, BUTTON_CONFIRM)
        transport.batches.append((callback_update(2, PHONE_A, confirm_data),))
        confirmed = activation.poll_once()
        self.assertEqual([outcome.kind for outcome in confirmed.outcomes], [PAIRING_CONFIRMED])

        transport.batches.append((question_update(3, PHONE_A, QUESTION),))
        answered = activation.poll_once()
        self.assertEqual([outcome.kind for outcome in answered.outcomes], [QUERY_ANSWER_DELIVERED])
        envelope = answered.outcomes[0].answer_envelope
        self.assertIsNotNone(envelope)
        self.assertEqual(envelope.owner_id, owner_a)
        self.assertEqual(envelope.generation, 1)
        self.assertEqual(envelope.answer_text, ANSWER_A)
        self.assertEqual(
            transport.sent[-1],
            {"chatId": PHONE_A, "text": ANSWER_A, "replyMarkup": None},
        )
        self.assertEqual(len(fixture.parse_calls), 1)

        # Publication happens exactly once, through the runner's own seam, and an
        # idle poll republishes nothing.
        self.assertEqual(
            tuple(fixture.observed), prompt.outcomes + confirmed.outcomes + answered.outcomes
        )
        self.assertEqual(len(published_envelopes(fixture.observed)), 1)
        observed_before_idle = tuple(fixture.observed)
        idle = activation.poll_once()
        self.assertEqual(idle.outcomes, ())
        self.assertEqual(tuple(fixture.observed), observed_before_idle)

        # The observed 4096-byte question policy reaches the coordinator: one byte
        # past it is refused with no send and no new envelope.
        before = len(transport.sent)
        transport.batches.append((question_update(4, PHONE_A, "a" * (QUESTION_MAX_BYTES + 1)),))
        oversized = activation.poll_once()
        self.assertEqual([outcome.kind for outcome in oversized.outcomes], [QUERY_IGNORED_OVERSIZE])
        self.assertEqual(len(transport.sent), before)
        self.assertEqual(len(published_envelopes(fixture.observed)), 1)

    def test_two_linked_phones_receive_their_own_owner_snapshot(self):
        owner_a = self.new_owner(SNAPSHOT_A, LABEL_A)
        owner_b = self.new_owner(SNAPSHOT_B, LABEL_B)
        fixture = self.activate()
        transport = fixture.transport
        self.assertTrue(fixture.activation.prepare())

        self.link(fixture, PHONE_A, owner_a, 1)
        self.link(fixture, PHONE_B, owner_b, 3)
        self.assertNotEqual(owner_a, owner_b)

        transport.batches.append(
            (
                question_update(5, PHONE_A, QUESTION),
                question_update(6, PHONE_B, QUESTION),
            )
        )
        answered = fixture.activation.poll_once()
        self.assertEqual(
            [outcome.kind for outcome in answered.outcomes],
            [QUERY_ANSWER_DELIVERED, QUERY_ANSWER_DELIVERED],
        )
        self.assertEqual(
            [outcome.answer_envelope.owner_id for outcome in answered.outcomes],
            [owner_a, owner_b],
        )
        self.assertEqual(
            [message["text"] for message in transport.sent[-2:]], [ANSWER_A, ANSWER_B]
        )
        self.assertEqual(
            [message["chatId"] for message in transport.sent[-2:]], [PHONE_A, PHONE_B]
        )

    def test_an_unlinked_phone_question_is_never_answered(self):
        owner_a = self.new_owner(SNAPSHOT_A, LABEL_A)
        self.new_owner(SNAPSHOT_B, LABEL_B)
        fixture = self.activate()
        transport = fixture.transport
        self.assertTrue(fixture.activation.prepare())
        self.link(fixture, PHONE_A, owner_a, 1)

        before = len(transport.sent)
        transport.batches.append((question_update(5, PHONE_B, QUESTION),))
        result = fixture.activation.poll_once()
        self.assertEqual([outcome.kind for outcome in result.outcomes], [QUERY_IGNORED_UNBOUND])
        self.assertEqual(len(transport.sent), before)
        self.assertEqual(published_envelopes(fixture.observed), [])

    def test_an_expired_qr_token_and_an_unlinked_callback_press_are_refused(self):
        owner_a = self.new_owner(SNAPSHOT_A, LABEL_A)
        fixture = self.activate()
        transport = fixture.transport
        self.assertTrue(fixture.activation.prepare())
        challenge = fixture.activation.issue_pairing_challenge(owner_a)
        self.assertIsNotNone(challenge)

        # 61 seconds later the owner's own single-use challenge has expired.
        self.pairing_now[0] += 61.0
        transport.batches.append((start_update(1, PHONE_A, challenge.token),))
        expired = fixture.activation.poll_once()
        self.assertEqual([outcome.kind for outcome in expired.outcomes], [PAIRING_REFUSED])
        self.assertEqual(transport.sent[-1]["text"], COPY_REFUSED)
        self.assertIsNone(transport.sent[-1]["replyMarkup"])

        # A confirmation press whose claim never existed is refused, not linked.
        transport.batches.append(
            (callback_update(2, PHONE_A, CALLBACK_CONFIRM + ":" + UNKNOWN_TICKET),)
        )
        unlinked = fixture.activation.poll_once()
        self.assertEqual([outcome.kind for outcome in unlinked.outcomes], [ACTION_REFUSED])
        self.assertEqual(unlinked.outcomes[0].delivery, SEND_NONE)
        self.assertEqual(published_envelopes(fixture.observed), [])

    def test_a_stale_hmi_context_is_rejected_before_the_parser_runs(self):
        owner_a = self.new_owner(SNAPSHOT_A, LABEL_A)
        fixture = self.activate()
        transport = fixture.transport
        self.assertTrue(fixture.activation.prepare())
        self.link(fixture, PHONE_A, owner_a, 1)

        # Inside the fixed 15-second receipt-age policy the answer is delivered.
        self.wall_now[0] += 14.0
        transport.batches.append((question_update(5, PHONE_A, QUESTION),))
        fresh = fixture.activation.poll_once()
        self.assertEqual([outcome.kind for outcome in fresh.outcomes], [QUERY_ANSWER_DELIVERED])
        self.assertEqual(transport.sent[-1]["text"], ANSWER_A)
        self.assertEqual(len(fixture.parse_calls), 1)
        envelopes_before = published_envelopes(fixture.observed)
        observed_before = len(fixture.observed)

        # Beyond it, the same question never reaches the parser: fail closed.
        before = len(transport.sent)
        self.wall_now[0] += 2.0
        transport.batches.append((question_update(6, PHONE_A, QUESTION),))
        stale = fixture.activation.poll_once()
        self.assertEqual([outcome.kind for outcome in stale.outcomes], [QUERY_UNAVAILABLE])
        self.assertEqual(stale.outcomes[0].delivery, SEND_DELIVERED)
        self.assertIsNone(stale.outcomes[0].answer_envelope)
        self.assertEqual(
            [message["text"] for message in transport.sent[before:]], [COPY_QUERY_UNAVAILABLE]
        )
        # The external ledger proves the parser itself was never consulted, and
        # the already-published fresh evidence is neither lost nor duplicated.
        self.assertEqual(len(fixture.parse_calls), 1)
        self.assertEqual(len(fixture.observed), observed_before + 1)
        self.assertEqual(published_envelopes(fixture.observed), envelopes_before)

    def test_a_parser_that_spends_the_freshness_window_withholds_the_answer(self):
        owner_a = self.new_owner(SNAPSHOT_A, LABEL_A)
        transport = self.new_transport()

        def spend_freshness(snapshot, question):
            # The real parser runs, and only then is the injected query clock
            # advanced past the lifetime the coordinator captured before the
            # parse -- exactly what a slow real parser would cost in wall time.
            answer = answer_from_snapshot(snapshot, question)
            self.query_now[0] += 16.0
            return answer

        fixture = self.activate(transport=transport, parse=spend_freshness)
        self.assertTrue(fixture.activation.prepare())
        self.link(fixture, PHONE_A, owner_a, 1)

        before = len(transport.sent)
        transport.batches.append((question_update(5, PHONE_A, QUESTION),))
        result = fixture.activation.poll_once()
        # Discriminating proof that ``query_clock`` reaches the coordinator: with
        # the coordinator's own captured ``time.monotonic`` the clock would not
        # have moved and this answer would have been delivered.
        self.assertEqual([outcome.kind for outcome in result.outcomes], [QUERY_UNAVAILABLE])
        self.assertEqual(len(fixture.parse_calls), 1)
        self.assertEqual(published_envelopes(fixture.observed), [])
        self.assertEqual(
            [message["text"] for message in transport.sent[before:]], [COPY_QUERY_UNAVAILABLE]
        )
        self.assertNotIn(ANSWER_A, [message["text"] for message in transport.sent])
        # The wall/receipt domain never moved: pairing, query and runner domains
        # stay independent.
        self.assertEqual(self.wall_now[0], 1000.0)

    def test_no_challenge_exists_before_prepare_after_stop_and_after_retirement(self):
        owner_a = self.new_owner(SNAPSHOT_A, LABEL_A)
        fixture = self.activate()
        activation = fixture.activation
        transport = fixture.transport

        self.assertIsNone(activation.issue_pairing_challenge(owner_a))
        unprepared = activation.poll_once()
        self.assertEqual(unprepared.disposition, DISPOSITION_FAILED)
        self.assertEqual(transport.get_updates_calls, [])

        self.assertTrue(activation.prepare())
        self.assertIsNotNone(activation.issue_pairing_challenge(owner_a))

        self.assertTrue(activation.stop())
        self.assertIsNone(activation.issue_pairing_challenge(owner_a))
        self.assertEqual(activation.poll_once().disposition, DISPOSITION_STOPPED)
        # The sticky fence is idempotent and never re-observes the provider.
        self.assertTrue(activation.stop())
        self.assertEqual(transport.get_me_calls, 1)

        # A retired activation is equally unauthorized to issue a challenge, and
        # the seven-day fence refuses before any transport dispatch.
        retiring = self.activate()
        self.assertTrue(retiring.activation.prepare())
        self.runner_now[0] += SEVEN_DAY_HORIZON_SECONDS
        retired = retiring.activation.poll_once()
        self.assertEqual(retired.disposition, DISPOSITION_RESTART_REQUIRED)
        self.assertEqual(retiring.transport.get_updates_calls, [])
        self.assertIsNone(retiring.activation.issue_pairing_challenge(owner_a))

    def test_a_second_activation_starts_from_a_fresh_empty_pairing_epoch(self):
        owner_a = self.new_owner(SNAPSHOT_A, LABEL_A)
        first = self.activate()
        self.assertTrue(first.activation.prepare())
        self.link(first, PHONE_A, owner_a, 1)
        self.assertTrue(first.activation.stop())
        # A stop that settled released the exact real lease; the public occupancy
        # view is the non-authoritative evidence, never a fake ledger.
        self.assertIsNone(self.reservation.held_by(BOT_ID))

        second = self.activate()
        # Preparing over the SAME real reservation is the release proof: an
        # unreleased lease would be refused with the canonical reservation error.
        self.assertTrue(second.activation.prepare())
        self.assertIsNotNone(self.reservation.held_by(BOT_ID))
        # The new epoch inherits no link: the same phone is unbound again.
        second.transport.batches.append((question_update(1, PHONE_A, QUESTION),))
        rebound = second.activation.poll_once()
        self.assertEqual([outcome.kind for outcome in rebound.outcomes], [QUERY_IGNORED_UNBOUND])
        # ...and the old owner's slot is free for a brand new challenge.
        self.assertIsNotNone(second.activation.issue_pairing_challenge(owner_a))
        self.assertTrue(second.activation.stop())
        self.assertIsNone(self.reservation.held_by(BOT_ID))

    def test_a_failed_observation_never_reserves_or_leaks_the_identity(self):
        owner_a = self.new_owner(SNAPSHOT_A, LABEL_A)
        fixture = self.activate(transport=self.new_transport(fail_get_me=True))

        with self.assertRaises(ChannelALifecycleError):
            fixture.activation.prepare()
        # getMe failed BEFORE any lease was acquired, so this proves no
        # reservation leak, not the release of an acquired lease.
        self.assertIsNone(self.reservation.held_by(BOT_ID))
        self.assertIsNone(fixture.activation.issue_pairing_challenge(owner_a))
        self.assertEqual(fixture.activation.poll_once().disposition, DISPOSITION_FAILED)

        # The identity is still free for a fresh activation over the same registry.
        recovered = self.activate()
        self.assertTrue(recovered.activation.prepare())
        self.assertIsNotNone(self.reservation.held_by(BOT_ID))
        self.assertIsNotNone(recovered.activation.issue_pairing_challenge(owner_a))


class ChannelAActivationRevisionTests(ActivationHarnessTestCase):
    """Existing public composition must wire revision capture and validation."""

    def test_parser_replacement_refuses_old_answer_through_real_pairing_flow(self):
        capability, _ = self.sessions.create()
        owner = self.sessions.authorize(capability, touch=False)
        self.sessions.set_context(capability, SNAPSHOT_A)
        self.labels[owner] = LABEL_A

        def replace_during_parse(snapshot, question):
            answer = answer_from_snapshot(snapshot, question)
            self.sessions.set_context(capability, SNAPSHOT_B)
            return answer

        fixture = self.activate(parse=replace_during_parse)
        self.assertTrue(fixture.activation.prepare())
        self.link(fixture, PHONE_A, owner, 1)
        sent_before = len(fixture.transport.sent)
        fixture.transport.batches.append((question_update(3, PHONE_A, QUESTION),))
        result = fixture.activation.poll_once()

        # Behavioral RED on existing APIs: current production delivers ANSWER_A.
        self.assertEqual([outcome.kind for outcome in result.outcomes], [QUERY_UNAVAILABLE])
        self.assertEqual(fixture.parse_calls, [(SNAPSHOT_A, QUESTION)])
        self.assertEqual(published_envelopes(fixture.observed), [])
        self.assertEqual(
            [message["text"] for message in fixture.transport.sent[sent_before:]],
            [COPY_QUERY_UNAVAILABLE],
        )

    def test_post_send_replacement_is_delivered_but_never_published(self):
        capability, _ = self.sessions.create()
        owner = self.sessions.authorize(capability, touch=False)
        self.sessions.set_context(capability, SNAPSHOT_A)
        self.labels[owner] = LABEL_A
        fixture = self.activate()
        self.assertTrue(fixture.activation.prepare())
        self.link(fixture, PHONE_A, owner, 1)
        original_send = fixture.transport.send_message

        def send_then_replace(**kwargs):
            receipt = original_send(**kwargs)
            if kwargs["text"] == ANSWER_A:
                self.sessions.set_context(capability, SNAPSHOT_B)
            return receipt

        fixture.transport.send_message = send_then_replace
        sent_before = len(fixture.transport.sent)
        fixture.transport.batches.append((question_update(3, PHONE_A, QUESTION),))
        result = fixture.activation.poll_once()
        self.assertEqual([outcome.kind for outcome in result.outcomes], [QUERY_ANSWER_UNPUBLISHED])
        self.assertEqual(published_envelopes(fixture.observed), [])
        self.assertEqual(
            [message["text"] for message in fixture.transport.sent[sent_before:]], [ANSWER_A]
        )

    def test_unchanged_composed_answer_preserves_exact_revision(self):
        capability, _ = self.sessions.create()
        owner = self.sessions.authorize(capability, touch=False)
        self.labels[owner] = LABEL_A
        self.sessions.set_context(capability, SNAPSHOT_B)
        self.sessions.set_context(capability, SNAPSHOT_A)
        _, _, revision = self.sessions.capture_owner_context(owner, max_age_seconds=15)
        fixture = self.activate()
        self.assertTrue(fixture.activation.prepare())
        self.link(fixture, PHONE_A, owner, 1)
        fixture.transport.batches.append((question_update(3, PHONE_A, QUESTION),))
        result = fixture.activation.poll_once()
        envelope = result.outcomes[0].answer_envelope
        self.assertEqual(result.outcomes[0].kind, QUERY_ANSWER_DELIVERED)
        self.assertEqual(envelope.context_revision, revision)
        self.assertEqual(envelope.as_dict()["contextRevision"], revision)
        self.assertEqual(envelope.answer_text, ANSWER_A)
        self.assertEqual(published_envelopes(fixture.observed), [envelope])


class ChannelAActivationDeadlineTests(ActivationHarnessTestCase):
    """The captured answer dies when the query clock passes its captured deadline."""

    def _deliver_answer(self):
        capability, _ = self.sessions.create()
        owner = self.sessions.authorize(capability, touch=False)
        self.labels[owner] = LABEL_A
        self.sessions.set_context(capability, SNAPSHOT_A)
        fixture = self.activate()
        self.assertTrue(fixture.activation.prepare())
        self.link(fixture, PHONE_A, owner, 1)
        fixture.transport.batches.append((question_update(3, PHONE_A, QUESTION),))
        result = fixture.activation.poll_once()
        self.assertEqual([o.kind for o in result.outcomes], [QUERY_ANSWER_DELIVERED])
        envelope = result.outcomes[0].answer_envelope
        self.assertIsNotNone(envelope)
        return fixture, envelope, capability

    def test_the_delivered_answer_dies_when_the_query_clock_passes_its_deadline(self):
        fixture, envelope, _capability = self._deliver_answer()
        activation = fixture.activation
        self.assertTrue(activation.is_query_envelope_current(envelope))
        # No receipt-age or revision change: only the monotonic query clock moved.
        # This is the reported intermittence: same-frame refreshes renew the
        # receipt forever, while the captured answer must expire on its own.
        self.query_now[0] += 16.0
        self.assertFalse(activation.is_query_envelope_current(envelope))

    def test_the_captured_deadline_is_strictly_after_the_delivery_sample(self):
        fixture, envelope, _capability = self._deliver_answer()
        activation = fixture.activation
        deadline = envelope.captured_deadline
        self.assertIs(type(deadline), float)
        self.assertGreater(deadline, self.query_now[0])
        self.query_now[0] = deadline - 0.5
        self.assertTrue(activation.is_query_envelope_current(envelope))
        # Exact equality fails closed: at the deadline the answer is expired.
        self.query_now[0] = deadline
        self.assertFalse(activation.is_query_envelope_current(envelope))
        self.query_now[0] = deadline + 0.5
        self.assertFalse(activation.is_query_envelope_current(envelope))

    def test_an_unusable_query_clock_sample_fails_closed(self):
        fixture, envelope, _capability = self._deliver_answer()
        activation = fixture.activation
        self.assertTrue(activation.is_query_envelope_current(envelope))
        self.query_now[0] = envelope.captured_deadline - 1.0
        broken = (
            ("bool", lambda: True),
            ("string", lambda: "1.0"),
            ("nan", lambda: float("nan")),
            ("inf", lambda: float("inf")),
            ("negative", lambda: -1.0),
        )
        for name, clock in broken:
            with self.subTest(clock=name):
                activation._query_clock = clock
                self.assertFalse(activation.is_query_envelope_current(envelope))

        def exploding():
            raise RuntimeError("query clock failure")

        activation._query_clock = exploding
        self.assertFalse(activation.is_query_envelope_current(envelope))

    def test_a_reentrant_query_clock_that_stops_the_activation_cannot_authorize(self):
        fixture, envelope, _capability = self._deliver_answer()
        activation = fixture.activation
        self.assertTrue(activation.is_query_envelope_current(envelope))
        deadline = envelope.captured_deadline

        def stop_during_sample():
            # An injected clock is a foreign domain: it may reenter stop() and
            # still return an otherwise-valid pre-deadline float.
            activation.stop()
            return deadline - 1.0

        activation._query_clock = stop_during_sample
        self.assertFalse(activation.is_query_envelope_current(envelope))

    def test_a_reentrant_query_clock_that_invalidates_the_context_cannot_authorize(self):
        fixture, envelope, capability = self._deliver_answer()
        activation = fixture.activation
        self.assertTrue(activation.is_query_envelope_current(envelope))
        deadline = envelope.captured_deadline

        def invalidate_during_sample():
            # A same-domain reentrant invalidation during the final sample must
            # not authorize the already-captured witness afterwards.
            self.sessions.apply_context_command(
                capability, {"version": 1, "command": "invalidate", "order": 1})
            return deadline - 1.0

        activation._query_clock = invalidate_during_sample
        self.assertFalse(activation.is_query_envelope_current(envelope))


class ChannelAActivationForwardingTests(ActivationHarnessTestCase):
    """RCA-5f additions: constructor-injected local runner, never a real worker."""

    def injected_activation(self, *, start_result=True):
        from unittest.mock import patch
        from prisma_runtime import channel_a_activation as module
        from prisma_runtime.channel_a_lifecycle import ChannelAStatus

        calls = []
        status = ChannelAStatus("running", None, False, False)

        class LocalRunner:
            def __init__(self, **kwargs):
                calls.append("construct")

            def start(self):
                calls.append("start")
                return start_result

            def status(self):
                calls.append("status")
                return status

            def stop(self):
                calls.append("stop")
                return True

        # Patch only the composition's constructor dependency. No private runner,
        # lease or dialogue is inspected, and Thread.start is never called.
        with patch.object(module, "ChannelARunner", LocalRunner):
            activation = self.activate().activation
        self.assertEqual(calls, ["construct"])
        return activation, calls, status

    def test_start_forwards_exact_runner_return_once_per_call(self):
        for value in (True, False):
            with self.subTest(value=value):
                activation, calls, _ = self.injected_activation(start_result=value)
                self.assertIs(activation.start(), value)
                self.assertEqual(calls, ["construct", "start"])
                self.assertIs(activation.start(), value)
                self.assertEqual(calls, ["construct", "start", "start"])

    def test_status_forwards_exact_immutable_runner_snapshot_without_start(self):
        activation, calls, status = self.injected_activation()
        self.assertIs(activation.status(), status)
        self.assertIs(activation.status(), status)
        self.assertEqual(calls, ["construct", "status", "status"])


from prisma_runtime.channel_a_pairing import (
    ChannelAPairingConfigInvalid,
    PRISMA_CHANNEL_A_CLOCK_INVALID,
)
from prisma_runtime.channel_a_lifecycle import ChannelAStatus
from unittest.mock import patch

URLSAFE_TOKEN_ALPHABET = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
)
UNKNOWN_PAIRING_OWNER = "00000000-0000-4000-8000-00000000000f"


class ChannelAActivationPairingViewTests(ActivationHarnessTestCase):
    """RCA-5l additive pairing-status and QR-view projection over the real composition.

    The public surface under test does not exist yet: ``pairing_status`` and
    ``issue_pairing_challenge_view`` are expected next to the retained
    ``issue_pairing_challenge``. The pairing clock is the fixture's
    ``pairing_now`` domain and the registry QR TTL stays at its 60-second
    default, so remaining seconds are always positive and bounded by it.
    """

    def test_pairing_status_is_unavailable_without_a_registry_then_reports_free_pending_and_linked(self):
        owner = self.new_owner(SNAPSHOT_A, LABEL_A)
        fixture = self.activate()

        # No registry exists before a successful preparation: unavailable,
        # never free.
        self.assertEqual(fixture.activation.pairing_status(owner), "unavailable")
        self.assertEqual(fixture.activation.pairing_status(UNKNOWN_PAIRING_OWNER), "unavailable")

        self.assertTrue(fixture.activation.prepare())
        self.assertEqual(fixture.activation.pairing_status(owner), "free")
        self.assertEqual(fixture.activation.pairing_status(UNKNOWN_PAIRING_OWNER), "free")

        challenge = fixture.activation.issue_pairing_challenge(owner)
        self.assertIsNotNone(challenge)
        fixture.transport.batches.append((start_update(1, PHONE_A, challenge.token),))
        prompt = fixture.activation.poll_once()
        self.assertEqual([outcome.kind for outcome in prompt.outcomes], [PAIRING_PROMPT_DELIVERED])
        self.assertEqual(fixture.activation.pairing_status(owner), "pending")
        self.assertEqual(fixture.activation.pairing_status(UNKNOWN_PAIRING_OWNER), "free")

        confirm_data = callback_data_for(fixture.transport, PHONE_A, BUTTON_CONFIRM)
        fixture.transport.batches.append((callback_update(2, PHONE_A, confirm_data),))
        confirmed = fixture.activation.poll_once()
        self.assertEqual([outcome.kind for outcome in confirmed.outcomes], [PAIRING_CONFIRMED])
        self.assertEqual(fixture.activation.pairing_status(owner), "linked")
        self.assertEqual(fixture.activation.pairing_status(UNKNOWN_PAIRING_OWNER), "free")

    def test_issue_pairing_challenge_view_returns_the_exact_backend_view(self):
        owner = self.new_owner(SNAPSHOT_A, LABEL_A)
        fixture = self.activate()

        # Before a successful preparation nothing is issued.
        self.assertIsNone(fixture.activation.issue_pairing_challenge_view(owner))

        self.assertTrue(fixture.activation.prepare())
        view = fixture.activation.issue_pairing_challenge_view(owner)
        self.assertEqual(set(view), {"token", "botUsername", "expiresInSeconds"})
        self.assertEqual(view["botUsername"], BOT_USERNAME)
        token = view["token"]
        self.assertEqual(len(token), 43)
        self.assertTrue(set(token) <= URLSAFE_TOKEN_ALPHABET)
        remaining = view["expiresInSeconds"]
        self.assertIsInstance(remaining, (int, float))
        self.assertNotIsInstance(remaining, bool)
        self.assertGreater(remaining, 0.0)
        self.assertLessEqual(remaining, 60.0)

        # Retrieval is idempotent inside the TTL and recomputes the remaining
        # seconds from the injected pairing clock.
        self.assertEqual(fixture.activation.issue_pairing_challenge_view(owner), view)
        self.pairing_now[0] += 10.0
        refreshed = fixture.activation.issue_pairing_challenge_view(owner)
        self.assertEqual(refreshed["token"], token)
        self.assertEqual(refreshed["expiresInSeconds"], remaining - 10.0)

    def test_issue_pairing_challenge_view_rotates_at_expiry_and_rejects_unusable_clocks(self):
        owner = self.new_owner(SNAPSHOT_A, LABEL_A)
        fixture = self.activate()
        self.assertTrue(fixture.activation.prepare())
        first = fixture.activation.issue_pairing_challenge_view(owner)

        # Rotation at expiry mints a fresh challenge: never a stale or clamped
        # view.
        self.pairing_now[0] += 60.0
        rotated = fixture.activation.issue_pairing_challenge_view(owner)
        self.assertNotEqual(rotated["token"], first["token"])
        self.assertGreater(rotated["expiresInSeconds"], 0.0)
        self.assertLessEqual(rotated["expiresInSeconds"], 60.0)

        registry = fixture.activation._registry
        original_clock = registry.clock
        cases = (
            ("boolean", lambda: True),
            ("nonfinite", lambda: float("nan")),
            ("backwards", lambda: 0.0),
        )
        try:
            for label, broken_clock in cases:
                with self.subTest(clock=label):
                    registry.clock = broken_clock
                    with self.assertRaises(ChannelAPairingConfigInvalid) as rejected:
                        fixture.activation.issue_pairing_challenge_view(owner)
                    self.assertEqual(str(rejected.exception), PRISMA_CHANNEL_A_CLOCK_INVALID)
        finally:
            registry.clock = original_clock
        # The registry stays usable after the rejected samples.
        recovered = fixture.activation.issue_pairing_challenge_view(owner)
        self.assertEqual(recovered["token"], rotated["token"])

    def test_stop_withdraws_the_registry_and_every_pairing_projection(self):
        owner = self.new_owner(SNAPSHOT_A, LABEL_A)
        fixture = self.activate()
        self.assertTrue(fixture.activation.prepare())
        self.assertIsNotNone(fixture.activation.issue_pairing_challenge_view(owner))
        self.assertEqual(fixture.activation.pairing_status(owner), "free")

        self.assertTrue(fixture.activation.stop())

        self.assertEqual(fixture.activation.pairing_status(owner), "unavailable")
        self.assertIsNone(fixture.activation.issue_pairing_challenge_view(owner))
        self.assertIsNone(fixture.activation.issue_pairing_challenge(owner))

    def test_pairing_status_revalidates_the_registry_after_a_foreign_stop(self):
        owner = self.new_owner(SNAPSHOT_A, LABEL_A)
        fixture = self.activate()
        self.assertTrue(fixture.activation.prepare())
        self.assertEqual(fixture.activation.pairing_status(owner), "free")

        registry = fixture.activation._registry
        original_clock = registry.clock

        def reentrant_stop_clock():
            # The injected pairing clock may reenter stop(): the projection
            # must revalidate the registry identity afterwards and fail closed.
            fixture.activation.stop()
            return self.pairing_now[0]

        registry.clock = reentrant_stop_clock
        try:
            self.assertEqual(fixture.activation.pairing_status(owner), "unavailable")
        finally:
            registry.clock = original_clock

    def test_issue_pairing_challenge_view_revalidates_issuance_and_rejects_broken_projection_samples(self):
        """Issuance reentry and post-issuance projection samples fail closed.

        The gated pairing clock returns one valid sample for the registry's
        challenge read and breaks every later sample of the same call, so the
        *projection* (not the registry validation) is what must refuse. A
        broken projection sample returns an explicit ``None``: never a stale
        positive or clamped view. A registry-invalid clock keeps its native
        code (covered by the existing registry tests).
        """
        owner = self.new_owner(SNAPSHOT_A, LABEL_A)
        self.projection_samples = []
        self.projection_mode = ["valid"]

        def gated_pairing_clock():
            self.projection_samples.append(1)
            if len(self.projection_samples) == 1:
                return self.pairing_now[0]
            if self.projection_mode[0] == "valid":
                # The initial successful view and every restored call need a
                # valid second sample for the remaining-seconds projection.
                return self.pairing_now[0]
            if self.projection_mode[0] == "stop":
                fixture.activation.stop()
                return self.pairing_now[0]
            if self.projection_mode[0] == "expired":
                # One second past the live challenge's 60-second deadline:
                # remaining seconds compute non-positive and must never be
                # projected as a positive or clamped view.
                return self.pairing_now[0] + 61.0
            return float("nan")

        fixture = self.activate(pairing_clock=gated_pairing_clock)
        self.assertTrue(fixture.activation.prepare())

        # A valid issuance projects the normal view; at least two samples are
        # consumed: one for the registry challenge read, one for the projection.
        valid = fixture.activation.issue_pairing_challenge_view(owner)
        self.assertIsNotNone(valid)
        self.assertGreaterEqual(len(self.projection_samples), 2)

        for mode in ("invalid", "expired", "stop"):
            with self.subTest(sample=mode):
                self.projection_samples.clear()
                self.projection_mode[0] = mode
                try:
                    outcome = fixture.activation.issue_pairing_challenge_view(owner)
                except ChannelAPairingConfigInvalid as rejected:
                    # A broken sample that reaches the registry keeps its
                    # native code; both fail-closed shapes are acceptable,
                    # a fabricated view never is.
                    self.assertEqual(str(rejected), PRISMA_CHANNEL_A_CLOCK_INVALID)
                else:
                    # Explicit None on a failed projection sample or a
                    # withdrawn registry; never a positive, stale or clamped
                    # view.
                    self.assertIsNone(outcome)
                finally:
                    self.projection_mode[0] = "valid"
                # An expired sample sits one second past the live challenge's
                # deadline; advancing the fixture clock past it keeps every
                # later registry sample watermark-safe regardless of which
                # layer consumed the broken sample.
                if mode == "expired":
                    self.pairing_now[0] += 61.0

        # After the reentrant stop inside issuance, the withdrawn registry is
        # never resurrected: the stopped activation still issues and observes
        # nothing.
        self.assertIsNone(fixture.activation.issue_pairing_challenge_view(owner))
        self.assertEqual(fixture.activation.pairing_status(owner), "unavailable")


    def test_issue_pairing_challenge_view_enforces_the_runner_restart_fence(self):
        """The frozen restart rule fences issuance; no new lifecycle transition.

        Row A pins a constant restart-required status: nothing is issued and
        no challenge is minted behind the fence. Row B pins the order rule:
        an initially active status that turns restart-required only after the
        registry issue still suppresses the view, while the retained challenge
        becomes retrievable once the real status is restored.
        """
        active = ChannelAStatus("running", None, False, False)
        fenced = ChannelAStatus("running", None, False, True)

        # Row A: constant restart-required status. A later valid call must
        # mint a fresh 60-second challenge: a 50-second retrieval would prove
        # the fenced call had minted after all.
        owner = self.new_owner(SNAPSHOT_A, LABEL_A)
        fixture = self.activate()
        self.assertTrue(fixture.activation.prepare())
        with patch.object(fixture.activation._runner, "status", lambda: fenced):
            self.assertIsNone(fixture.activation.issue_pairing_challenge_view(owner))
            self.assertIsNone(fixture.activation.issue_pairing_challenge_view(owner))
        self.pairing_now[0] += 10.0
        fresh = fixture.activation.issue_pairing_challenge_view(owner)
        self.assertIsNotNone(fresh)
        self.assertEqual(fresh["expiresInSeconds"], 60.0)

        # Row A is done: stop while the real status is restored so the runner
        # releases its bot identity before the next fixture prepares with the
        # same bot in this method (teardown alone would come too late).
        self.assertTrue(fixture.activation.stop())

        # Row B: the status turns restart-required only after the registry
        # issue (flagged by the pairing clock sample inside the foreign call).
        owner = self.new_owner(SNAPSHOT_A, LABEL_A)
        state = {"issued": False}

        def flip_after_issue_clock():
            state["issued"] = True
            return self.pairing_now[0]

        fixture = self.activate(pairing_clock=flip_after_issue_clock)
        self.assertTrue(fixture.activation.prepare())

        def status_flipping_after_issue():
            return fenced if state["issued"] else active

        with patch.object(fixture.activation._runner, "status", status_flipping_after_issue):
            self.assertIsNone(fixture.activation.issue_pairing_challenge_view(owner))
        # The fence suppresses the projection; the minted challenge itself
        # stays retrievable under the restored real status.
        restored = fixture.activation.issue_pairing_challenge_view(owner)
        self.assertIsNotNone(restored)

    def test_pairing_status_final_observation_fails_closed_in_order(self):
        """Final-observation order: throw, restart fence, identity after stop.

        Each row uses a fresh prepared fixture and a scoped patch of the
        runner's status only; the pairing clock sample inside the foreign
        registry read marks the point after which the final observation
        differs from the valid pre-call one. No global atomicity is claimed
        and no call counts are asserted beyond this finite boundary.
        """
        active = ChannelAStatus("running", None, False, False)
        fenced = ChannelAStatus("running", None, False, True)

        def flip_state_clock(state):
            def clock():
                state["observed"] = True
                return self.pairing_now[0]

            return clock

        # Row A: the final observation raises -> unavailable, never propagates.
        state = {"observed": False}
        owner = self.new_owner(SNAPSHOT_A, LABEL_A)
        fixture = self.activate(pairing_clock=flip_state_clock(state))
        self.assertTrue(fixture.activation.prepare())

        def breaking_status():
            if state["observed"]:
                raise RuntimeError("final-observation-canary")
            return active

        with patch.object(fixture.activation._runner, "status", breaking_status):
            self.assertEqual(fixture.activation.pairing_status(owner), "unavailable")

        # Row A is done: stop after the patch exits (real status restored) to
        # release the bot identity before the next fixture prepares.
        self.assertTrue(fixture.activation.stop())

        # Row B: the final observation reports restart-required -> unavailable.
        state = {"observed": False}
        owner = self.new_owner(SNAPSHOT_A, LABEL_A)
        fixture = self.activate(pairing_clock=flip_state_clock(state))
        self.assertTrue(fixture.activation.prepare())

        def fenced_status():
            return fenced if state["observed"] else active

        with patch.object(fixture.activation._runner, "status", fenced_status):
            self.assertEqual(fixture.activation.pairing_status(owner), "unavailable")

        # Row B is done: stop after the patch exits (real status restored) to
        # release the bot identity before the row C fixture prepares.
        self.assertTrue(fixture.activation.stop())

        # Row C: the final status callback stops the activation and still
        # returns a previously captured valid snapshot; the registry identity
        # recheck after the callback must fail closed. The one-shot guard keeps
        # the reentrant stop from recursing through the patched status.
        state = {"observed": False}
        stops = {"done": False}
        owner = self.new_owner(SNAPSHOT_A, LABEL_A)
        fixture = self.activate(pairing_clock=flip_state_clock(state))
        self.assertTrue(fixture.activation.prepare())

        def stopping_status():
            if state["observed"] and not stops["done"]:
                stops["done"] = True
                fixture.activation.stop()
            return active

        with patch.object(fixture.activation._runner, "status", stopping_status):
            self.assertEqual(fixture.activation.pairing_status(owner), "unavailable")


class OfflineDispatchGuardProofTests(unittest.TestCase):
    """Minimal proof that the containment layers actually refuse and restore."""

    def _assert_layers_restored(self, before):
        self.assertEqual(
            (requests.Session.request, requests.adapters.HTTPAdapter.send),
            before,
            "the offline dispatch layers were not restored",
        )

    def test_the_record_refuse_guard_stops_a_real_dispatch_and_restores_both_layers(self):
        before = (requests.Session.request, requests.adapters.HTTPAdapter.send)
        self.addCleanup(self._assert_layers_restored, before)

        floor_attempts = install_inert_transport_floor(self)
        guard_attempts = install_record_refuse_guard(self)
        session = requests.Session()
        self.addCleanup(session.close)
        session.trust_env = False

        with self.assertRaises(OfflineDispatchRefused):
            session.request("GET", PROBE_URL)

        # The upper guard refused before the lower inert floor could be reached.
        self.assertEqual(guard_attempts, [1])
        self.assertEqual(floor_attempts, [])


if __name__ == "__main__":
    unittest.main()
