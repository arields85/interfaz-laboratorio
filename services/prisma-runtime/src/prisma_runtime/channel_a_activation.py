"""Trusted in-process composition of one Channel A pairing/query activation.

Lifecycle ownership stays with the runner; pairing authority stays with its
fresh registry. This seam is not HTTP authorization and exposes no raw identity,
registry or credentials. Application bootstrap and capability projection belong
to later integration layers.
"""

from __future__ import annotations

from .channel_a_bot import ChannelAPairingDialogue
from .channel_a_lifecycle import (
    PHASE_PREPARED,
    PHASE_RUNNING,
    ChannelAPollResult,
    ChannelARunner,
)
from .channel_a_pairing import ChannelAPairingRegistry, QrChallenge
from .channel_a_transport import MESSAGE_MAX_CHARS, ChannelABotIdentity

__all__ = ["ChannelAActivation"]

_CONTEXT_FRESHNESS_SECONDS = 15.0


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

    def poll_once(self) -> ChannelAPollResult:
        """Poll synchronously and publish through the caller's unchanged consumer."""
        return self._runner.poll_once()

    def stop(self) -> bool:
        """Request the runner's sticky stop, even when settlement is uncertain."""
        # Withdraw issuance before settlement can call a foreign reservation.
        self._registry = None
        return self._runner.stop()

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
            or self._runner.status().phase not in (PHASE_PREPARED, PHASE_RUNNING)
        ):
            return None
        return challenge
