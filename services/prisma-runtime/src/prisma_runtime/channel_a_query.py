"""Channel A correlated text queries: one admitted binding in, one declared outcome out.

Scope (RCA-3b)
--------------

This module implements only the *correlated text query* of Channel A: given an
already-admitted pairing binding and one raw question, it captures freshness
from the server-received HMI context, parses the visible snapshot through an
injected parser, delivers the same text through the adapter's existing send
classification and returns a generation/epoch-correlated answer envelope for a
future HMI publisher.

Deliberately absent from this stage: the Telegram transport, the pairing
registry, the snapshot parser, the HMI publication of the answer, audio, TTS,
Gemini, polling, the proactive idle-warning sweep and any credential access.
The module imports no network, process, voice, credential, configuration or
lifecycle code, and it never reads ambient configuration.

Authority and correlation
-------------------------

* The coordinator consumes a frozen :class:`QueryBinding` captured by the
  adapter at ingress from the adapter's own admitted record. It never resolves a
  phone to a *new* owner: the captured owner, generation, confirmation fence and
  adapter epoch are revalidated, never recomputed.
* ``validate`` is the injected adapter seam. It proves current admission --
  adapter epoch and live local record -- without exposing the raw action nonce.
  The coordinator additionally revalidates the registry link (owner and
  generation) so neither side alone is trusted.
* A binding whose input is at or below its confirmation fence is stale: an input
  queued before the link existed can never bind to the link. A binding from a
  previous adapter epoch, a different owner or a replaced generation is silently
  discarded.
* Freshness uses the server receipt age returned by the context reader plus the
  local monotonic elapsed time only. The remaining lifetime is anchored at the
  monotonic instant sampled *before* the context read, so a newer snapshot that
  arrives during computation can never extend the captured answer's deadline.
  No absolute clock domain is ever combined with the monotonic domain.
* Delivery is not domain validity. A send whose fate is unknown, or a rejection,
  exposes no envelope and is never retried. The envelope exists only after an
  observed delivery and a post-send revalidation of binding and freshness; an
  already-delivered phone message is never claimed to be retractable.
* The generic unavailable notice is sent only while the captured binding is
  still current. A stale binding is silent and never leaks the question, the
  context or any context-specific detail.
Error taxonomy: :class:`ChannelAQueryConfigInvalid` is raised for unusable
configuration. Programmer errors inside injected callables are not classified as
domain failures: the parser, the context reader and the delivery callable are
foreign code, so their own raised exceptions fail closed, while the coordinator's
own domain errors stay explicit.
"""

from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass, field

from .channel_a_pairing import ChannelAPairingError, ChannelAPairingRegistry

QUERY_ANSWER_DELIVERED = "query_answer_delivered"
QUERY_ANSWER_REJECTED = "query_answer_rejected"
QUERY_ANSWER_UNKNOWN = "query_answer_unknown"
QUERY_ANSWER_UNPUBLISHED = "query_answer_unpublished"
QUERY_UNAVAILABLE = "query_unavailable"
QUERY_IGNORED_BLANK = "query_ignored_blank"
QUERY_IGNORED_COMMAND = "query_ignored_command"
QUERY_IGNORED_MALFORMED = "query_ignored_malformed"
QUERY_IGNORED_OVERSIZE = "query_ignored_oversize"
QUERY_IGNORED_STALE = "query_ignored_stale"
QUERY_IGNORED_UNBOUND = "query_ignored_unbound"

PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID = "PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID"

# The generic, context-free notice. It never echoes the question, the owner, the
# snapshot or any freshness detail, and it is sent only while the binding is
# still current.
COPY_QUERY_UNAVAILABLE = (
    "No se pudo leer el documento del HMI en este momento. Intenta de nuevo en unos segundos."
)

# An explicit upper bound on injected numeric policies: a caller must choose a
# real bound, not an arbitrary enormous one.
MAX_POLICY_BYTES = 1_000_000

__all__ = [
    "COPY_QUERY_UNAVAILABLE",
    "MAX_POLICY_BYTES",
    "PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID",
    "QUERY_ANSWER_DELIVERED",
    "QUERY_ANSWER_REJECTED",
    "QUERY_ANSWER_UNKNOWN",
    "QUERY_ANSWER_UNPUBLISHED",
    "QUERY_IGNORED_BLANK",
    "QUERY_IGNORED_COMMAND",
    "QUERY_IGNORED_MALFORMED",
    "QUERY_IGNORED_OVERSIZE",
    "QUERY_IGNORED_STALE",
    "QUERY_IGNORED_UNBOUND",
    "QUERY_UNAVAILABLE",
    "ChannelAQueryConfigInvalid",
    "ChannelAQueryCoordinator",
    "ChannelAQueryError",
    "QueryBinding",
    "QueryEnvelope",
    "QueryOutcome",
]


class ChannelAQueryError(RuntimeError):
    """Base failure for the Channel A query coordinator."""


class ChannelAQueryConfigInvalid(ChannelAQueryError):
    """The coordinator was configured with unusable values."""


@dataclass(frozen=True)
class QueryBinding:
    """The immutable owner/phone/generation identity captured at ingress.

    ``confirmed_update_id`` is the confirmation fence: an input at or below it
    was queued before the link existed and can never be answered by that link.
    ``epoch`` is an opaque process-local adapter epoch, redacted from ``repr``.
    """

    phone_id: str
    owner_id: str
    generation: int
    update_id: int
    confirmed_update_id: int
    epoch: str = field(repr=False)


@dataclass(frozen=True)
class QueryEnvelope:
    """The internal, generation/epoch-correlated answer for a future HMI publisher.

    It carries only the correlation identity and the exact phone answer text --
    no snapshot, no question and no secret -- and the answer text is redacted
    from ``repr``.
    """

    owner_id: str
    generation: int
    update_id: int
    epoch: str = field(repr=False)
    answer_text: str = field(repr=False)
    context_revision: int

    def as_dict(self) -> dict:
        return {
            "ownerId": self.owner_id,
            "generation": self.generation,
            "updateId": self.update_id,
            "epoch": self.epoch,
            "answerText": self.answer_text,
            "contextRevision": self.context_revision,
        }


@dataclass(frozen=True)
class QueryOutcome:
    """What the coordinator did, declared as an immutable outcome.

    ``delivery`` is the adapter's own send classification when a send was
    attempted, or ``None`` when nothing was sent. ``envelope`` is present only
    for an observed delivery that stayed current and fresh after the send.
    """

    kind: str
    delivery: str | None = None
    envelope: QueryEnvelope | None = field(default=None, repr=False)


def _positive_bound(value) -> float:
    """Return a positive finite float bound, or fail closed."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ChannelAQueryConfigInvalid(PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID)
    try:
        number = float(value)
    except OverflowError:
        raise ChannelAQueryConfigInvalid(PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID) from None
    if not math.isfinite(number) or number <= 0.0:
        raise ChannelAQueryConfigInvalid(PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID)
    return number


def _positive_policy(value) -> int:
    """Return a positive bounded integer policy value, or fail closed."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ChannelAQueryConfigInvalid(PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID)
    if value < 1 or value > MAX_POLICY_BYTES:
        raise ChannelAQueryConfigInvalid(PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID)
    return value


def _label(value) -> str:
    """Return a non-empty ASCII-printable delivery label, or fail closed."""
    if not isinstance(value, str) or not value or len(value) > 64:
        raise ChannelAQueryConfigInvalid(PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID)
    if not value.isascii() or not value.isprintable():
        raise ChannelAQueryConfigInvalid(PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID)
    return value


def _remaining_lifetime(start: float, age: float, bound: float):
    """Return the captured monotonic deadline, or ``None`` when already expired."""
    remaining = bound - age
    if not math.isfinite(remaining) or remaining <= 0.0:
        return None
    deadline = start + remaining
    if not math.isfinite(deadline) or deadline <= start:
        return None
    return deadline


class ChannelAQueryCoordinator:
    """Correlate one admitted binding and one question into one declared outcome.

    Every dependency is injected: the pairing registry (generation authority),
    the adapter ``validate`` seam (current admission without the raw nonce), the
    context reader bound to ``HmiSessionRegistry.capture_owner_context``, the parser
    (``answer_from_snapshot`` and nothing else), the delivery callable bound to
    the adapter's existing send classification, and the bounds and delivery
    labels. ``clock`` is a monotonic infrastructure function.
    """

    def __init__(
        self,
        *,
        registry,
        validate,
        read_context,
        context_is_current,
        parse,
        deliver,
        freshness_bound,
        max_question_bytes,
        max_answer_chars,
        delivered_label,
        rejected_label,
        unknown_label,
        clock=time.monotonic,
    ):
        if not isinstance(registry, ChannelAPairingRegistry):
            raise ChannelAQueryConfigInvalid(PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID)
        if not callable(validate):
            raise ChannelAQueryConfigInvalid(PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID)
        if not callable(context_is_current):
            raise ChannelAQueryConfigInvalid(PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID)
        if not callable(read_context):
            raise ChannelAQueryConfigInvalid(PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID)
        if not callable(parse):
            raise ChannelAQueryConfigInvalid(PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID)
        if not callable(deliver):
            raise ChannelAQueryConfigInvalid(PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID)
        if not callable(clock):
            raise ChannelAQueryConfigInvalid(PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID)
        delivered = _label(delivered_label)
        rejected = _label(rejected_label)
        unknown = _label(unknown_label)
        if len({delivered, rejected, unknown}) != 3:
            raise ChannelAQueryConfigInvalid(PRISMA_CHANNEL_A_QUERY_CONFIG_INVALID)

        self.registry = registry
        self.validate = validate
        self.read_context = read_context
        self.context_is_current = context_is_current
        self.parse = parse
        self.deliver = deliver
        self.freshness_bound = _positive_bound(freshness_bound)
        self.max_question_bytes = _positive_policy(max_question_bytes)
        self.max_answer_chars = _positive_policy(max_answer_chars)
        self.delivered_label = delivered
        self.rejected_label = rejected
        self.unknown_label = unknown
        self.clock = clock
        self._lock = threading.RLock()
        self._last_sample: float | None = None

    # -- entry point -------------------------------------------------------

    def handle_query(self, binding, question) -> QueryOutcome:
        """Consume one admitted binding and one question, and declare the outcome.

        The caller serializes ingress; the coordinator only revalidates and never
        resolves the phone to a new owner.
        """
        normalized, ignored = self._normalize_question(question)
        if ignored is not None:
            # Blank, command, malformed or oversize input never touches the
            # registry, the clock, the context, the parser or the transport.
            return QueryOutcome(ignored)
        if not self._binding_shape_ok(binding):
            # No owner/generation/fence identity at all: nothing can be bound.
            return QueryOutcome(QUERY_IGNORED_UNBOUND)
        if not self._binding_current(binding):
            return QueryOutcome(QUERY_IGNORED_STALE)
        start = self._now()
        if start is None:
            # Without a trustworthy monotonic instant no freshness deadline can
            # be established, so fail closed before any activity is renewed.
            return QueryOutcome(QUERY_IGNORED_STALE)
        if not self._touch(binding):
            return self._fail_closed(binding)
        read = self._read_context(binding)
        if read is None:
            return self._fail_closed(binding)
        age, snapshot, revision = read
        if not self._binding_current(binding):
            return QueryOutcome(QUERY_IGNORED_STALE)
        deadline = _remaining_lifetime(start, age, self.freshness_bound)
        if deadline is None or not self._context_current(binding, revision) or not self._fresh(deadline):
            return self._fail_closed(binding)
        answer_text = self._parse(snapshot, normalized)
        if answer_text is None:
            return self._fail_closed(binding)
        # Final gate before the phone effect: the effectful admission seam runs
        # first and the captured deadline is resampled immediately after it, so a
        # validator that spends the remaining lifetime can never deliver an
        # expired answer, and no arbitrary callback sits between the last clock
        # sample and the send.
        if not self._binding_current(binding):
            return QueryOutcome(QUERY_IGNORED_STALE)
        if not self._context_current(binding, revision) or not self._fresh(deadline):
            return self._fail_closed(binding)
        delivery = self._attempt_deliver(binding, answer_text)
        if delivery != self.delivered_label:
            kind = (
                QUERY_ANSWER_REJECTED
                if delivery == self.rejected_label
                else QUERY_ANSWER_UNKNOWN
            )
            return QueryOutcome(kind, delivery)
        if (
            not self._binding_current(binding)
            or not self._context_current(binding, revision)
            or not self._fresh(deadline)
        ):
            # The phone already received the text and it cannot be retracted,
            # but a stale or superseded answer must never reach the HMI.
            return QueryOutcome(QUERY_ANSWER_UNPUBLISHED, delivery)
        envelope = QueryEnvelope(
            binding.owner_id,
            binding.generation,
            binding.update_id,
            binding.epoch,
            answer_text,
            revision,
        )
        return QueryOutcome(QUERY_ANSWER_DELIVERED, delivery, envelope)

    # -- validation --------------------------------------------------------

    def _normalize_question(self, question):
        """Return ``(question, None)`` or ``(None, ignored_kind)``."""
        if not isinstance(question, str):
            return None, QUERY_IGNORED_MALFORMED
        normalized = question.strip()
        if not normalized:
            return None, QUERY_IGNORED_BLANK
        if normalized.startswith("/"):
            return None, QUERY_IGNORED_COMMAND
        try:
            size = len(normalized.encode("utf-8"))
        except UnicodeEncodeError:
            return None, QUERY_IGNORED_MALFORMED
        if size < 1:
            return None, QUERY_IGNORED_BLANK
        if size > self.max_question_bytes:
            return None, QUERY_IGNORED_OVERSIZE
        return normalized, None

    def _binding_shape_ok(self, binding) -> bool:
        if not isinstance(binding, QueryBinding):
            return False
        if not isinstance(binding.phone_id, str) or not isinstance(binding.owner_id, str):
            return False
        if not isinstance(binding.epoch, str):
            return False
        for value in (binding.generation, binding.update_id, binding.confirmed_update_id):
            if isinstance(value, bool) or not isinstance(value, int):
                return False
        return True

    def _binding_current(self, binding) -> bool:
        """Prove the captured binding is still the admitted, current one.

        The effectful admission seam runs first: any side effect it performs --
        an unlink, a relink or an owner handover -- is then observed by the
        authoritative registry read that follows. A registry read that merely
        preceded the seam could otherwise authorize an already-replaced link, let
        a stale answer reach the phone, expose an old-generation envelope, or
        send the generic notice to a now-unbound phone.
        """
        if not self._binding_shape_ok(binding):
            return False
        if binding.update_id <= binding.confirmed_update_id:
            return False
        try:
            admitted = self.validate(binding)
        except Exception:
            return False
        if admitted is not True:
            return False
        try:
            link = self.registry.phone_link(binding.phone_id)
        except Exception:
            return False
        if (
            link is None
            or link.owner_id != binding.owner_id
            or link.generation != binding.generation
        ):
            return False
        return True

    # -- freshness ---------------------------------------------------------

    def _now(self):
        """Sample the injected monotonic clock, or ``None`` when unusable.

        Rejects bools, non-numbers, non-finite values, negatives and any sample
        below the previous one, so a broken or regressing clock fails closed.
        """
        try:
            value = self.clock()
        except Exception:
            return None
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        try:
            number = float(value)
        except OverflowError:
            return None
        if not math.isfinite(number) or number < 0.0:
            return None
        with self._lock:
            if self._last_sample is not None and number < self._last_sample:
                return None
            self._last_sample = number
            return number

    def _fresh(self, deadline) -> bool:
        now = self._now()
        return now is not None and now < deadline

    def _context_current(self, binding, revision) -> bool:
        try:
            return self.context_is_current(binding.owner_id, revision) is True
        except Exception:
            return False

    def _read_context(self, binding):
        """Return ``(age, snapshot, revision)`` from the injected reader, or ``None``.

        The returned age is the server receipt age in the reader's own wall-clock
        domain; only the age value crosses into the monotonic arithmetic. A
        non-tuple result, a non-numeric, non-finite, negative or over-bound age
        fails closed.
        """
        try:
            result = self.read_context(binding.owner_id, max_age_seconds=self.freshness_bound)
        except Exception:
            return None
        if not isinstance(result, (tuple, list)) or len(result) != 3:
            return None
        age, snapshot, revision = result
        if type(revision) is not int or revision <= 0:
            return None
        if isinstance(age, bool) or not isinstance(age, (int, float)):
            return None
        try:
            number = float(age)
        except OverflowError:
            return None
        if not math.isfinite(number) or number < 0.0:
            return None
        if number > self.freshness_bound:
            return None
        return number, snapshot, revision

    def _parse(self, snapshot, question):
        """Return the bounded plain answer text, or ``None``.

        The parser result must expose a non-empty string ``answer_text``; a dict,
        an error, a plain string or any other shape is refused instead of being
        coerced. Over-long text is refused instead of being silently truncated.
        """
        try:
            answer = self.parse(snapshot, question)
            text = getattr(answer, "answer_text", None)
        except Exception:
            # A property accessor that raises is normalized into the same
            # controlled unavailable path as any other unusable parser result;
            # no raw exception reaches the result, the phone copy or ``repr``.
            return None
        if not isinstance(text, str):
            return None
        if not text.strip():
            return None
        if len(text) > self.max_answer_chars:
            return None
        return text

    # -- registry and transport seams --------------------------------------

    def _touch(self, binding) -> bool:
        """Renew the human idle window once for an admitted valid query.

        Only the registry's own domain error taxonomy is treated as a refusal;
        any other raised exception is a programmer error and propagates.
        """
        try:
            self.registry.human_touch(binding.phone_id, binding.generation)
        except ChannelAPairingError:
            return False
        return True

    def _attempt_deliver(self, binding, text) -> str:
        """Send one text through the adapter's classification, or ``unknown``.

        The raw classification label is reused verbatim; the coordinator never
        re-classifies the transport response and never retries.
        """
        try:
            value = self.deliver(binding, text)
        except Exception:
            return self.unknown_label
        if not isinstance(value, str):
            return self.unknown_label
        return value

    def _fail_closed(self, binding) -> QueryOutcome:
        """Fail closed: a generic notice only while the binding is still current."""
        if not self._binding_current(binding):
            return QueryOutcome(QUERY_IGNORED_STALE)
        delivery = self._attempt_deliver(binding, COPY_QUERY_UNAVAILABLE)
        return QueryOutcome(QUERY_UNAVAILABLE, delivery)
