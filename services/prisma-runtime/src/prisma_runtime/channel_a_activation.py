"""Trusted in-process composition of one Channel A pairing/query activation.

Lifecycle ownership stays with the runner; pairing authority stays with its
fresh registry. This seam is not HTTP authorization and exposes no raw identity,
registry or credentials. Application bootstrap and capability projection belong
to later integration layers.
"""

from __future__ import annotations

import math

from .channel_a_bot import ChannelAPairingDialogue
from .channel_a_lifecycle import (
    PHASE_PREPARED,
    PHASE_RUNNING,
    ChannelAPollResult,
    ChannelARunner,
    ChannelAStatus,
)
from .channel_a_pairing import ChannelAPairingRegistry, QrChallenge
from .channel_a_query import is_query_envelope_well_formed
from .channel_a_transport import MESSAGE_MAX_CHARS, ChannelABotIdentity

__all__ = ["ChannelAActivation"]

_CONTEXT_FRESHNESS_SECONDS = 15.0
# The pairing projections are active only while the runner holds a prepared or
# running phase without a pending restart; every other phase is unavailable.
_PAIRING_ACTIVE_PHASES = (PHASE_PREPARED, PHASE_RUNNING)
_PAIRING_STATES = frozenset({"free", "pending", "linked"})


class ChannelAActivation:
    """Compose dependencies lazily, without starting a worker or observing a bot."""

    def __init__(
        self,
        *,
        transport,
        sessions,
        destination_label,
        parse,
        on_outcome,
        clock,
        pairing_clock,
        query_clock,
        warning_lead,
        max_question_bytes,
        poll_timeout,
        read_timeout,
        join_timeout,
        poll_pause,
        reservation=None,
    ) -> None:
        self._registry: ChannelAPairingRegistry | None = None
        self._dialogue: ChannelAPairingDialogue | None = None
        self._bot_username: str | None = None
        self._sessions = sessions
        # The same monotonic clock the coordinator uses for the captured
        # deadline: both domains are one, so no wall-clock mixing is possible.
        self._query_clock = query_clock

        def dialogue_factory(identity: ChannelABotIdentity) -> ChannelAPairingDialogue:
            registry = ChannelAPairingRegistry(
                clock=pairing_clock,
                warning_lead=warning_lead,
            )
            dialogue = ChannelAPairingDialogue(
                bot_id=identity.id,
                registry=registry,
                transport=transport,
                destination_label=destination_label,
            )
            dialogue.enable_queries(
                read_context=sessions.capture_owner_context,
                context_is_current=sessions.is_owner_context_current,
                parse=parse,
                freshness_bound=_CONTEXT_FRESHNESS_SECONDS,
                max_question_bytes=max_question_bytes,
                max_answer_chars=MESSAGE_MAX_CHARS,
                clock=query_clock,
            )
            # Publication here is not issuance permission: only the runner's
            # successful preparation can open the public status gate below.
            self._registry = registry
            self._dialogue = dialogue
            # The validated bot identity is retained for the QR deep-link view
            # only; it is withdrawn together with the registry on stop.
            self._bot_username = identity.username
            return dialogue

        self._runner = ChannelARunner(
            transport=transport,
            dialogue_factory=dialogue_factory,
            clock=clock,
            on_outcome=on_outcome,
            poll_timeout=poll_timeout,
            read_timeout=read_timeout,
            join_timeout=join_timeout,
            poll_pause=poll_pause,
            reservation=reservation,
        )

    def prepare(self) -> bool:
        """Prepare once, preserving the runner's failure and cleanup semantics."""
        return self._runner.prepare()

    def start(self) -> bool:
        """Forward explicit managed start without adding lifecycle ownership."""
        return self._runner.start()

    def status(self) -> ChannelAStatus:
        """Return the runner's actual immutable lifecycle snapshot."""
        return self._runner.status()

    def poll_once(self) -> ChannelAPollResult:
        """Poll synchronously and publish through the caller's unchanged consumer."""
        return self._runner.poll_once()

    def stop(self) -> bool:
        """Request the runner's sticky stop, even when settlement is uncertain."""
        # Withdraw issuance and the retained bot identity before settlement can
        # call a foreign reservation.
        self._dialogue = None
        self._registry = None
        self._bot_username = None
        return self._runner.stop()

    def _capture_delivery_witness(self, envelope):
        """Capture ephemeral references before callbacks; this is not admission."""
        if not is_query_envelope_well_formed(envelope):
            return None
        dialogue = self._dialogue
        sessions = self._sessions
        if dialogue is None:
            return None
        try:
            admission = dialogue._capture_delivery_witness(envelope)
            if admission is None or self._dialogue is not dialogue:
                return None
            context = sessions._capture_context_witness(
                envelope.owner_id, envelope.context_revision,
            )
            if context is None:
                return None
            witness = (self, dialogue, sessions, admission, context)
            return witness if self._delivery_witness_matches(witness) is True else None
        except Exception:
            return None

    def _delivery_witness_matches(self, witness) -> bool:
        """Compare current references only, with no status or clock callbacks.

        Separate domain locks do not establish cross-domain atomicity or prove
        elapsed-time validity after the last ordinary freshness observation.
        """
        try:
            if type(witness) is not tuple or len(witness) != 5:
                return False
            activation, dialogue, sessions, admission, context = witness
            if (activation is not self or dialogue is None
                    or self._dialogue is not dialogue or self._sessions is not sessions):
                return False
            return (
                dialogue._delivery_witness_matches(admission) is True
                and sessions._context_witness_matches(context) is True
                and self._dialogue is dialogue and self._sessions is sessions
            )
        except Exception:
            return False

    def is_query_envelope_current(self, envelope) -> bool:
        """Observe current admission and live context, never cache the envelope."""
        if not is_query_envelope_well_formed(envelope):
            return False
        witness = self._capture_delivery_witness(envelope)
        if witness is None:
            return False
        dialogue = self._dialogue
        try:
            observed = self._runner.status()
            if (
                type(observed) is not ChannelAStatus
                or type(observed.phase) is not str or observed.phase != PHASE_RUNNING
                or observed.restart_required is not False
                or type(observed.quiescent) is not bool or observed.reason is not None
                or self._dialogue is not dialogue
            ):
                return False
            if dialogue.is_query_envelope_admitted(envelope) is not True:
                return False
            if self._sessions.is_owner_context_fresh_current(
                envelope.owner_id, envelope.context_revision,
                max_age_seconds=_CONTEXT_FRESHNESS_SECONDS,
            ) is not True:
                return False
            observed = self._runner.status()
            if not (
                type(observed) is ChannelAStatus
                and type(observed.phase) is str and observed.phase == PHASE_RUNNING
                and observed.restart_required is False
                and type(observed.quiescent) is bool and observed.reason is None
                and self._dialogue is dialogue
                and self._delivery_witness_matches(witness) is True
            ):
                return False
            # Final gate: the captured monotonic deadline. Same-frame receipt
            # renewal can keep the revision guard satisfied forever, so the
            # answer itself expires when the injected query clock reaches the
            # deadline sampled before the context read at capture time.
            return self._captured_deadline_current(envelope, witness)
        except Exception:
            return False

    def _captured_deadline_current(self, envelope, witness) -> bool:
        """Sample the injected query clock once; fail closed on any misuse.

        The clock sample is the last foreign action before the verdict: an
        exception, a bool, a non-number, a non-finite or a negative sample
        closes the gate, and exact deadline equality expires the answer. The
        production clock is ``time.monotonic``, but an injected clock is a
        foreign domain that may reenter ``stop()`` or invalidate the context
        during that sample — the same reentrancy ``issue_pairing_challenge``
        already documents. The reference-only witness recheck closes that
        window: it compares captured references under the existing locks and
        runs no foreign callback, clock sample or status query of its own, so
        nothing foreign executes after the sample.
        """
        try:
            now = self._query_clock()
        except Exception:
            return False
        if isinstance(now, bool) or not isinstance(now, (int, float)):
            return False
        if not math.isfinite(now) or now < 0:
            return False
        if now >= envelope.captured_deadline:
            return False
        return self._delivery_witness_matches(witness) is True

    def issue_pairing_challenge(self, owner_id: str) -> QrChallenge | None:
        """Issue only while prepared; domain refusals retain their native errors."""
        registry = self._registry
        if registry is None or self._runner.status().phase not in (PHASE_PREPARED, PHASE_RUNNING):
            return None
        challenge = registry.issue_qr(owner_id)
        # The registry's injected clock may reenter stop(). Never return a live
        # challenge based on a status sampled before that foreign domain work.
        if (
            self._registry is not registry
            or self._runner.status().phase not in _PAIRING_ACTIVE_PHASES
        ):
            return None
        return challenge

    def _pairing_gate_open(self, registry) -> bool:
        """One closed observation guarding every pairing projection.

        The runner status is a foreign callback: it must return a real
        ``ChannelAStatus`` in an active phase without a pending restart, and
        the registry identity is only trusted AFTER that status callback
        returned. Any failure or mismatch closes the gate; a registry-invalid
        domain error is never handled here and keeps its native code.
        """
        try:
            observed = self._runner.status()
        except Exception:
            return False
        if (
            type(observed) is not ChannelAStatus
            or observed.phase not in _PAIRING_ACTIVE_PHASES
            or observed.restart_required is not False
        ):
            return False
        return self._registry is registry

    def pairing_status(self, owner_id: str) -> str:
        """Observe one owner's pairing state through the live registry.

        Returns ``'free' | 'pending' | 'linked'`` or ``'unavailable'``: a
        missing registry, an inactive phase, a restart fence, a broken status
        observation or any failed observation is unavailable, never ``free``.
        Both status observations and the registry identity check happen inside
        fail-closed handling, with the identity trusted only after each status
        callback returned; the registry's clock is a foreign domain that may
        reenter stop().
        """
        registry = self._registry
        if registry is None or not self._pairing_gate_open(registry):
            return "unavailable"
        try:
            state = registry.owner_state(owner_id)
        except Exception:
            return "unavailable"
        if not self._pairing_gate_open(registry):
            return "unavailable"
        return state if state in _PAIRING_STATES else "unavailable"

    def issue_pairing_challenge_view(self, owner_id: str) -> dict | None:
        """Issue (or re-read) the owner's QR challenge as the closed backend view.

        Returns the exact ``{token, botUsername, expiresInSeconds}`` projection
        or ``None`` when nothing may be issued or projected: before a
        successful preparation, under a restart fence, after a stop, on a
        withdrawn registry, on a broken status observation, on a failed
        post-issuance projection sample, or without a usable retained bot
        username. Phase and restart are re-gated before the issuance, after it
        and after the remaining-seconds helper, and the registry identity is
        checked after every status callback. The registry's clock is a foreign
        domain that may reenter stop(); a registry-invalid clock keeps its
        native error. The retained :meth:`issue_pairing_challenge` API is
        unchanged.
        """
        registry = self._registry
        if registry is None or not self._pairing_gate_open(registry):
            return None
        challenge = registry.issue_qr(owner_id)
        if not self._pairing_gate_open(registry):
            return None
        remaining = registry.challenge_remaining_seconds(challenge)
        if remaining is None:
            return None
        if not self._pairing_gate_open(registry):
            return None
        username = self._bot_username
        if type(username) is not str or not username:
            return None
        return {"token": challenge.token, "botUsername": username, "expiresInSeconds": remaining}
