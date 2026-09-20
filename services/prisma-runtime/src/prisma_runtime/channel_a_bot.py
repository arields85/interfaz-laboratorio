"""Channel A private pairing dialogue: one authenticated Telegram update in, one outcome out.

Scope (RCA-3a–3c)
--------------

This module implements the *private pairing dialogue* of Channel A and nothing
else. Given one already-fetched Telegram update it performs at most one
declared side effect and returns exactly one :class:`IngressOutcome`. The
covered dialogue is: a private ``/start <opaque QR>`` claim, the confirmation
prompt with its confirm/cancel ticket buttons, the authenticated confirmation
that creates the link, the confirmed-link welcome with its keep-connected and
unlink buttons, and cancellation.

Deliberately absent from this stage: answer parsing, snapshot capture and
freshness checks (all injected through the RCA-3b coordinator), HMI/audio
publication, the scheduler that invokes the warning sweep, offset bookkeeping,
batching, and any real HTTP client. The polling loop that owns ``getUpdates``
offsets, the long-poll cadence and the per-bot transport wiring belongs to the
later runtime integration stage. This module never imports an HTTP, socket,
subprocess, lifecycle or operator-secret module.

Unknown ordinary text is ignored by default. When the optional correlated
query coordinator (RCA-3b) is attached through ``enable_queries``, ordinary text
from a currently linked phone is answered through it under a captured owner,
generation, confirmation fence and adapter epoch; without that attachment the
accepted RCA-3a behavior is unchanged and ordinary text is never routed.

The proactive inactivity warning (RCA-3c) is an explicit, synchronous sweep, not
a background loop: ``send_inactivity_warnings`` uses only the public registry
sweep and this adapter's own admitted action records, re-reads the authoritative
link immediately before each send, and returns a bounded tuple of
delivered/rejected/unknown/skipped attempts. A reservation is one attempt per
human-activity window; a skipped, rejected or unknown attempt is never retried
or re-armed, and a warning that already reached the phone cannot be retracted.

Authority model
---------------

* The injected :class:`ChannelAPairingRegistry` is the only authority. The
  adapter-local maps are bounded preflight indexes; losing them (a restart)
  downgrades to a fail-closed refusal, it never grants a link.
* The phone identity is derived from the authenticated private-chat actor, not
  from any string inside the update body. A UUID that appears in free text is
  never authority.
* Secrets are callback tickets and process-local action nonces. They travel only
  inside ``callback_data``; they are never written into chat text, acknowledgements,
  error copy or ``repr``.
* Delivery is not domain validity. A send that is known to be rejected may cancel
  a pending claim, but a send whose fate is unknown is reported as unknown and is
  never replayed or announced as a success. A send failure on a confirmed link
  never transfers or rebinds the link; the link keeps expiring on its own
  deadline.
* An uncertain infrastructure failure — an invalid clock, bad configuration or an
  unavailable registry — only refuses the current press. It never erases live
  local preflight state; a local claim or action record is dropped only on an
  authoritative absence, a stale generation or a confirmed release.
* Ingress is serialized by one re-entrant lock and ordered by a process-local
  update high-water mark, so a stale or duplicate update is rejected before its
  payload is ever parsed. This instance belongs to exactly one polling epoch and
  keeps no durable offset, no replay history and no tombstone list. After the
  documented week-long idle discontinuity the Telegram update identifiers can
  restart, so the future lifecycle code must establish a fresh adapter and a
  fresh empty link epoch instead of resetting ordering while keeping authority.
  Callback nonces, not numeric ordering, are what protect a restart from reusing
  an old button.
* Callback acknowledgements carry no secret and can never grant authority.
"""

from __future__ import annotations

import base64
import hashlib
import math
import re
import secrets
import threading
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Protocol

from .channel_a_pairing import (
    OPAQUE_BYTES,
    OPAQUE_CHARS,
    ChannelAPairingConflict,
    ChannelAPairingError,
    ChannelAPairingRegistry,
    ChannelAPairingStaleGeneration,
    ChannelAPairingUnauthorized,
)
from .channel_a_query import (
    QUERY_IGNORED_STALE,
    QUERY_IGNORED_UNBOUND,
    ChannelAQueryCoordinator,
    QueryBinding,
)

PRISMA_CHANNEL_A_BOT_CONFIG_INVALID = "PRISMA_CHANNEL_A_BOT_CONFIG_INVALID"
PRISMA_CHANNEL_A_BOT_UNAVAILABLE = "PRISMA_CHANNEL_A_BOT_UNAVAILABLE"

# Telegram identifiers are bounded to the JavaScript-safe integer range so no
# identifier can lose precision in a JSON round trip; bools are never identifiers.
MAX_TELEGRAM_ID = 2**53 - 1
PHONE_ID_PREFIX = "tg:"
CALLBACK_DATA_MAX_BYTES = 64
MAX_MESSAGE_TEXT_CHARS = 128
MAX_LABEL_CHARS = 160
MAX_DESCRIPTION_CHARS = 512
MAX_CALLBACK_ID_CHARS = 64
MAX_ACK_TEXT_CHARS = 200
MAX_NONCE_ATTEMPTS = 8
MAX_EPOCH_CHARS = 128

URLSAFE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

VARIANT_MESSAGE = "message"
VARIANT_CALLBACK = "callback_query"
VARIANT_UNKNOWN = "unknown"

SEND_DELIVERED = "delivered"
SEND_REJECTED = "rejected"
SEND_UNKNOWN = "unknown"
SEND_NONE = "none"

CALLBACK_CONFIRM = "cf"
CALLBACK_CANCEL = "cn"
CALLBACK_KEEP_CONNECTED = "kc"
CALLBACK_UNLINK = "ul"

INGRESS_IGNORED_STALE = "ignored_stale"
INGRESS_IGNORED_MALFORMED = "ignored_malformed"
INGRESS_IGNORED_UNSUPPORTED = "ignored_unsupported"
INGRESS_IGNORED_AMBIGUOUS = "ignored_ambiguous"
INGRESS_IGNORED_UNRELATED = "ignored_unrelated"

PAIRING_PROMPT_DELIVERED = "pairing_prompt_delivered"
PAIRING_PROMPT_REJECTED = "pairing_prompt_rejected"
PAIRING_PROMPT_UNKNOWN = "pairing_prompt_unknown"
PAIRING_CONFIRMED = "pairing_confirmed"
PAIRING_WELCOME_REJECTED = "pairing_welcome_rejected"
PAIRING_WELCOME_UNKNOWN = "pairing_welcome_unknown"
PAIRING_CANCELLED = "pairing_cancelled"
PAIRING_REFUSED = "pairing_refused"
PAIRING_DESTINATION_UNAVAILABLE = "pairing_destination_unavailable"
KEEP_CONNECTED = "keep_connected"
UNLINKED = "unlinked"
ACTION_REFUSED = "action_refused"

BUTTON_CONFIRM = "Confirmar"
BUTTON_CANCEL = "Cancelar"
BUTTON_KEEP_CONNECTED = "Seguir conectado"
BUTTON_UNLINK = "Desvincular"

CONFIRMATION_PROMPT_TEMPLATE = (
    "Un teléfono quiere conectarse con:\n"
    "{label}\n"
    "\n"
    "Confirma para recibir en este teléfono las respuestas de ese documento."
)
WELCOME_TEMPLATE = (
    "Vinculación confirmada con:\n"
    "{label}\n"
    "\n"
    "Usa los botones para seguir conectado o desvincular este teléfono."
)
COPY_REFUSED = (
    "No se pudo iniciar la vinculación: el código no es válido, ya venció o este teléfono ya está vinculado."
)
COPY_DESTINATION_UNAVAILABLE = (
    "Ese documento del HMI ya no está disponible. Genera un código nuevo desde la pantalla."
)
COPY_CANCELLED = "Vinculación cancelada."
COPY_CONFIRMED = "Vinculación confirmada."
COPY_KEEP_CONNECTED = "Listo, seguimos conectados."
COPY_UNLINKED = "Este teléfono quedó desvinculado."
COPY_ACTION_REFUSED = (
    "Ese botón ya no es válido. Genera un código nuevo desde la pantalla del HMI."
)
COPY_INACTIVITY_WARNING = (
    "La vinculación con este documento se va a cerrar por inactividad.\n"
    "Usa los botones para seguir conectado o desvincular este teléfono."
)

# One warning reservation is one *attempt*. A skipped, rejected or unknown
# attempt is reported honestly and is never automatically retried or re-armed.
WARNING_SKIPPED = "skipped"

# Every other update kind Telegram may deliver alongside a supported variant.
# Presence of any of them turns the update into an ambiguous envelope that is
# refused without being parsed.
_AMBIGUOUS_UPDATE_KEYS = frozenset(
    (
        "edited_message",
        "channel_post",
        "edited_channel_post",
        "business_connection",
        "business_message",
        "edited_business_message",
        "deleted_business_messages",
        "guest_message",
        "message_reaction",
        "message_reaction_count",
        "inline_query",
        "chosen_inline_result",
        "shipping_query",
        "pre_checkout_query",
        "purchased_paid_media",
        "poll",
        "poll_answer",
        "my_chat_member",
        "chat_member",
        "chat_join_request",
        "chat_boost",
        "removed_chat_boost",
    )
)
_MESSAGE_AMBIGUITY_KEYS = ("via_bot", "sender_chat", "business_connection_id")
_CALLBACK_AMBIGUITY_KEYS = ("inline_message_id", "via_bot", "business_connection_id")

# Registry failures that authoritatively prove local preflight state is gone or
# stale. Every other domain failure (clock/config/unavailable) is uncertain and
# must never erase live local authority; it only refuses the current press.
_AUTHORITATIVE_CLAIM_FAILURES = (ChannelAPairingUnauthorized, ChannelAPairingConflict)
_AUTHORITATIVE_LINK_FAILURES = (ChannelAPairingUnauthorized, ChannelAPairingStaleGeneration)

# ``/start`` alone, or ``/start <payload>``. ``\Z`` keeps a trailing newline from
# matching, and ``.`` does not cross a newline, so a multi-line body is unrelated.
_START_PATTERN = re.compile(r"^/start(?:[ \t]+(?P<rest>.*))?\Z")
_URLSAFE_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{" + str(OPAQUE_CHARS) + r"}\Z")
_CALLBACK_DATA_PATTERN = re.compile(
    r"^(?P<action>"
    + "|".join((CALLBACK_CONFIRM, CALLBACK_CANCEL, CALLBACK_KEEP_CONNECTED, CALLBACK_UNLINK))
    + r"):(?P<token>[A-Za-z0-9_-]{"
    + str(OPAQUE_CHARS)
    + r"})\Z"
)

__all__ = [
    "ACTION_REFUSED",
    "BUTTON_CANCEL",
    "BUTTON_CONFIRM",
    "BUTTON_KEEP_CONNECTED",
    "BUTTON_UNLINK",
    "CALLBACK_CANCEL",
    "CALLBACK_CONFIRM",
    "CALLBACK_DATA_MAX_BYTES",
    "CALLBACK_KEEP_CONNECTED",
    "CALLBACK_UNLINK",
    "CONFIRMATION_PROMPT_TEMPLATE",
    "COPY_ACTION_REFUSED",
    "COPY_CANCELLED",
    "COPY_CONFIRMED",
    "COPY_DESTINATION_UNAVAILABLE",
    "COPY_INACTIVITY_WARNING",
    "COPY_KEEP_CONNECTED",
    "COPY_REFUSED",
    "COPY_UNLINKED",
    "ChannelABotConfigInvalid",
    "ChannelABotError",
    "ChannelAPairingDialogue",
    "ChannelATextTransport",
    "INGRESS_IGNORED_AMBIGUOUS",
    "INGRESS_IGNORED_MALFORMED",
    "INGRESS_IGNORED_STALE",
    "INGRESS_IGNORED_UNRELATED",
    "INGRESS_IGNORED_UNSUPPORTED",
    "InactivityWarningOutcome",
    "IngressOutcome",
    "KEEP_CONNECTED",
    "MAX_ACK_TEXT_CHARS",
    "MAX_CALLBACK_ID_CHARS",
    "MAX_LABEL_CHARS",
    "MAX_MESSAGE_TEXT_CHARS",
    "MAX_TELEGRAM_ID",
    "OPAQUE_BYTES",
    "OPAQUE_CHARS",
    "PAIRING_CANCELLED",
    "PAIRING_CONFIRMED",
    "PAIRING_DESTINATION_UNAVAILABLE",
    "PAIRING_PROMPT_DELIVERED",
    "PAIRING_PROMPT_REJECTED",
    "PAIRING_PROMPT_UNKNOWN",
    "PAIRING_REFUSED",
    "PAIRING_WELCOME_REJECTED",
    "PAIRING_WELCOME_UNKNOWN",
    "PHONE_ID_PREFIX",
    "PRISMA_CHANNEL_A_BOT_CONFIG_INVALID",
    "PRISMA_CHANNEL_A_BOT_UNAVAILABLE",
    "QUERY_IGNORED_UNBOUND",
    "SEND_DELIVERED",
    "SEND_NONE",
    "SEND_REJECTED",
    "SEND_UNKNOWN",
    "UNLINKED",
    "URLSAFE_ALPHABET",
    "VARIANT_CALLBACK",
    "VARIANT_MESSAGE",
    "VARIANT_UNKNOWN",
    "WARNING_SKIPPED",
    "WELCOME_TEMPLATE",
    "phone_identity",
]


class ChannelABotError(RuntimeError):
    """Base failure for the Channel A bot adapter."""


class ChannelABotConfigInvalid(ChannelABotError):
    """The adapter was configured or driven with unusable values."""


class ChannelATextTransport(Protocol):
    """The text-only transport the dialogue needs, and nothing more.

    Both calls return the raw Bot API response body so this module, not the
    transport, decides what "delivered" means. ``send_message`` cannot edit or
    delete a message and no other method is ever used.
    """

    def send_message(self, *, chat_id: int, text: str, reply_markup: object = None) -> object:
        """Deliver one text message and return the raw response body."""

    def answer_callback_query(self, *, callback_query_id: str, text: str = None) -> object:
        """Acknowledge one callback press and return the raw response body."""


@dataclass(frozen=True)
class IngressOutcome:
    """What one ingress call did, declared as an immutable outcome.

    ``accepted`` is true when the update carried a usable identifier that was
    reserved as the new high-water mark, or when the body was not a mapping at
    all. ``update_id`` is ``None`` when the body had no usable identifier.
    ``acknowledged`` is ``None`` when no callback acknowledgement was attempted.
    ``answer_envelope`` is the correlated answer for a future HMI publisher, and
    is ``None`` for every outcome that did not deliver a still-current answer;
    it is redacted from ``repr`` and only grows ``as_dict`` when present.
    """

    update_id: int | None
    variant: str
    kind: str
    accepted: bool
    delivery: str = SEND_NONE
    acknowledged: bool | None = None
    answer_envelope: object | None = field(default=None, repr=False)

    def as_dict(self) -> dict:
        data = {
            "updateId": self.update_id,
            "variant": self.variant,
            "kind": self.kind,
            "accepted": self.accepted,
            "delivery": self.delivery,
            "acknowledged": self.acknowledged,
        }
        if self.answer_envelope is not None:
            # Only an outcome that actually carries the correlated answer grows
            # the serialized shape; every RCA-3a caller keeps the original keys.
            data["answerEnvelope"] = self.answer_envelope.as_dict()
        return data


@dataclass(frozen=True)
class InactivityWarningOutcome:
    """One declared inactivity-warning attempt for one live link.

    ``status`` is the existing ``delivered``/``rejected``/``unknown`` send
    classification, or ``skipped`` when the reserved window could no longer be
    honored. No token, nonce or envelope is carried, so the bounded tuple is
    safe to report verbatim. A reservation is a single attempt: a failure or an
    unknown outcome is never retried or re-armed automatically.
    """

    owner_id: str
    phone_id: str
    generation: int
    status: str

    def as_dict(self) -> dict:
        return {
            "ownerId": self.owner_id,
            "phoneId": self.phone_id,
            "generation": self.generation,
            "status": self.status,
        }


@dataclass
class _Claim:
    """A local preflight index entry for one pending confirmation. No secret.

    ``label`` is the exact presented label the human is confirming against:
    confirmation is only valid while the trusted destination still normalizes to
    the same text. ``expires_at`` is the authoritative registry deadline.
    """

    owner_id: str
    phone_id: str
    expires_at: float
    label: str


@dataclass
class _Action:
    """The single bounded local action record for one live link."""

    phone_id: str
    owner_id: str
    generation: int
    nonce: str = field(repr=False)
    confirmed_update_id: int = 0


def phone_identity(actor_id: int) -> str:
    """Return the phone identity for an already authenticated private actor."""
    bounded = _bounded_id(actor_id)
    if bounded is None:
        raise ChannelABotConfigInvalid(PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
    return PHONE_ID_PREFIX + str(bounded)


def _bounded_id(value) -> int | None:
    """Return a positive bounded Telegram identifier, or ``None``. Never a bool."""
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    if value < 1 or value > MAX_TELEGRAM_ID:
        return None
    return value


def _bounded_count(value) -> int | None:
    """Return a positive bounded count, or ``None``. Never a bool."""
    return _bounded_id(value)


def _bounded_update_id(value) -> int | None:
    """Return a non-negative bounded Telegram update identifier, or ``None``.

    Update identifiers are ordered, not identities: zero is a valid value and
    only bools, non-integers and out-of-range values are rejected.
    """
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    if value < 0 or value > MAX_TELEGRAM_ID:
        return None
    return value


def _digest(value: str) -> bytes:
    """Digest one ASCII secret so no local index ever stores it in clear."""
    return hashlib.sha256(value.encode("ascii")).digest()


def _read_epoch(factory) -> str:
    """Mint one opaque, bounded process-local adapter epoch, or fail closed."""
    try:
        value = factory()
    except Exception:
        raise ChannelABotConfigInvalid(PRISMA_CHANNEL_A_BOT_CONFIG_INVALID) from None
    if not isinstance(value, str) or not value or len(value) > MAX_EPOCH_CHARS:
        raise ChannelABotConfigInvalid(PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
    if not value.isascii() or not value.isprintable():
        raise ChannelABotConfigInvalid(PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
    return value


def _safe_label(value, *, limit: int = MAX_LABEL_CHARS) -> str | None:
    """Return a printable, non-empty label, or ``None`` when it is unusable.

    No ``parse_mode`` is ever sent, so Telegram markup characters are nothing but
    literal plain text: the label is normalized for whitespace but never
    destructively rewritten.
    """
    if not isinstance(value, str):
        return None
    label = value.strip()
    if not label or len(label) > limit or not label.isprintable():
        return None
    return " ".join(label.split())[:limit]


def _keyboard(*buttons) -> dict:
    """Build one inline keyboard with one named button per row."""
    return {
        "inline_keyboard": [
            [{"text": text, "callback_data": data}] for text, data in buttons
        ]
    }


class ChannelAPairingDialogue:
    """Serialize one Telegram update at a time into one declared outcome.

    Every dependency is injected: the pairing registry that owns authority, the
    text-only transport, the trusted ``destination_label`` lookup and the
    ``clock``/``entropy`` infrastructure functions. ``bot_id`` is mandatory.
    """

    def __init__(
        self,
        *,
        bot_id,
        registry,
        transport,
        destination_label,
        entropy=secrets.token_bytes,
        clock=None,
        epoch_factory=None,
        max_link_actions=64,
        max_pending_claims=64,
    ):
        bounded_bot = _bounded_id(bot_id)
        if bounded_bot is None:
            raise ChannelABotConfigInvalid(PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
        if not isinstance(registry, ChannelAPairingRegistry):
            raise ChannelABotConfigInvalid(PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
        if not callable(getattr(transport, "send_message", None)):
            raise ChannelABotConfigInvalid(PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
        if not callable(getattr(transport, "answer_callback_query", None)):
            raise ChannelABotConfigInvalid(PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
        if not callable(destination_label):
            raise ChannelABotConfigInvalid(PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
        if not callable(entropy):
            raise ChannelABotConfigInvalid(PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
        resolved_clock = getattr(registry, "clock", None) if clock is None else clock
        if not callable(resolved_clock):
            raise ChannelABotConfigInvalid(PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
        bounded_actions = _bounded_count(max_link_actions)
        if bounded_actions is None:
            raise ChannelABotConfigInvalid(PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
        bounded_claims = _bounded_count(max_pending_claims)
        if bounded_claims is None:
            raise ChannelABotConfigInvalid(PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
        resolved_epoch_factory = secrets.token_hex if epoch_factory is None else epoch_factory
        if not callable(resolved_epoch_factory):
            raise ChannelABotConfigInvalid(PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
        epoch = _read_epoch(resolved_epoch_factory)

        self.bot_id = bounded_bot
        self.registry = registry
        self.transport = transport
        self.destination_label = destination_label
        self.entropy = entropy
        self.clock = resolved_clock
        self.max_link_actions = bounded_actions
        self.max_pending_claims = bounded_claims
        self._lock = threading.RLock()
        self._last_update_id = -1
        self._pending_claims: dict = {}
        self._actions: dict = {}
        self._epoch = epoch
        # Optional: attaching a query coordinator is what turns on ordinary
        # text queries. Left unset, the accepted RCA-3a behavior is untouched.
        self.query = None

    # -- ingress -----------------------------------------------------------

    def handle_update(self, update) -> IngressOutcome:
        """Consume one raw update and declare exactly what happened."""
        with self._lock:
            return self._handle_locked(update)

    def _handle_locked(self, update) -> IngressOutcome:
        if not isinstance(update, Mapping):
            return IngressOutcome(None, VARIANT_UNKNOWN, INGRESS_IGNORED_MALFORMED, True)
        update_id = _bounded_update_id(update.get("update_id"))
        if update_id is None:
            return IngressOutcome(None, VARIANT_UNKNOWN, INGRESS_IGNORED_MALFORMED, False)
        if update_id <= self._last_update_id:
            # A stale or duplicate update is rejected before its payload is read.
            return IngressOutcome(update_id, VARIANT_UNKNOWN, INGRESS_IGNORED_STALE, False)
        self._last_update_id = update_id
        variant, refusal = self._classify(update)
        if refusal is not None:
            return IngressOutcome(update_id, variant, refusal, True)
        if variant == VARIANT_MESSAGE:
            return self._handle_message(update_id, update["message"])
        return self._handle_callback(update_id, update["callback_query"])

    def _classify(self, update) -> tuple:
        """Resolve the single supported variant, or the reason it is refused.

        Two supported variants in one envelope, or a supported variant beside any
        other update kind, is an ambiguous envelope that is never parsed. An
        envelope with no supported variant is simply unsupported: nothing was
        parsed either way, so the outcome stays precise about what was seen.
        """
        supported = [key for key in ("message", "callback_query") if key in update]
        if len(supported) > 1:
            return VARIANT_UNKNOWN, INGRESS_IGNORED_AMBIGUOUS
        if not supported:
            return VARIANT_UNKNOWN, INGRESS_IGNORED_UNSUPPORTED
        if any(key in update for key in _AMBIGUOUS_UPDATE_KEYS):
            return VARIANT_UNKNOWN, INGRESS_IGNORED_AMBIGUOUS
        return (VARIANT_MESSAGE if supported[0] == "message" else VARIANT_CALLBACK), None

    # -- inbound shape validation ------------------------------------------

    def _private_message_actor(self, message):
        """Return ``(chat_id, actor_id)`` for a proven private human, else ``None``."""
        if not isinstance(message, Mapping):
            return None
        if any(key in message for key in _MESSAGE_AMBIGUITY_KEYS):
            return None
        if _bounded_id(message.get("message_id")) is None:
            return None
        chat = message.get("chat")
        sender = message.get("from")
        if not isinstance(chat, Mapping) or not isinstance(sender, Mapping):
            return None
        if chat.get("type") != "private":
            return None
        if sender.get("is_bot") is not False:
            return None
        chat_id = _bounded_id(chat.get("id"))
        actor_id = _bounded_id(sender.get("id"))
        if chat_id is None or actor_id is None or chat_id != actor_id:
            return None
        return chat_id, actor_id

    def _callback_actor(self, callback):
        """Return ``(actor_id, callback_id)`` for a proven private human, else ``None``."""
        if not isinstance(callback, Mapping):
            return None
        if any(key in callback for key in _CALLBACK_AMBIGUITY_KEYS):
            return None
        callback_id = callback.get("id")
        if (
            not isinstance(callback_id, str)
            or not callback_id
            or len(callback_id) > MAX_CALLBACK_ID_CHARS
            or not callback_id.isascii()
        ):
            return None
        actor = callback.get("from")
        if not isinstance(actor, Mapping) or actor.get("is_bot") is not False:
            return None
        actor_id = _bounded_id(actor.get("id"))
        if actor_id is None:
            return None
        message = callback.get("message")
        if not isinstance(message, Mapping):
            return None
        if any(key in message for key in _MESSAGE_AMBIGUITY_KEYS):
            return None
        if _bounded_id(message.get("message_id")) is None:
            return None
        if _bounded_id(message.get("date")) is None:
            return None
        chat = message.get("chat")
        author = message.get("from")
        if not isinstance(chat, Mapping) or not isinstance(author, Mapping):
            return None
        if chat.get("type") != "private" or _bounded_id(chat.get("id")) != actor_id:
            return None
        if author.get("is_bot") is not True or _bounded_id(author.get("id")) != self.bot_id:
            return None
        return actor_id, callback_id

    # -- message ingress ---------------------------------------------------

    def _handle_message(self, update_id, message) -> IngressOutcome:
        actor = self._private_message_actor(message)
        if actor is None:
            return IngressOutcome(update_id, VARIANT_MESSAGE, INGRESS_IGNORED_MALFORMED, True)
        chat_id, actor_id = actor
        text = message.get("text")
        if text is None:
            return IngressOutcome(update_id, VARIANT_MESSAGE, INGRESS_IGNORED_UNRELATED, True)
        if not isinstance(text, str):
            return IngressOutcome(update_id, VARIANT_MESSAGE, INGRESS_IGNORED_MALFORMED, True)
        if self.query is None or text.startswith("/"):
            # The command path keeps the historical 128-character bound. Only an
            # ordinary query, when the correlated coordinator is attached, is
            # bounded by the injected byte policy instead.
            if len(text) > MAX_MESSAGE_TEXT_CHARS:
                return IngressOutcome(
                    update_id, VARIANT_MESSAGE, INGRESS_IGNORED_MALFORMED, True
                )
            matched = _START_PATTERN.match(text)
            if matched is None:
                # Ordinary text and every other command stay ignored on this path.
                return IngressOutcome(
                    update_id, VARIANT_MESSAGE, INGRESS_IGNORED_UNRELATED, True
                )
            rest = matched.group("rest")
            payload = "" if rest is None else rest.strip()
            if not payload:
                return IngressOutcome(
                    update_id, VARIANT_MESSAGE, INGRESS_IGNORED_UNRELATED, True
                )
            if _URLSAFE_TOKEN_PATTERN.match(payload) is None:
                return self._notice(
                    update_id, VARIANT_MESSAGE, PAIRING_REFUSED, chat_id, COPY_REFUSED
                )
            return self._claim(update_id, chat_id, actor_id, payload)
        return self._handle_query(update_id, actor_id, text)

    # -- correlated text queries (RCA-3b, optional) ------------------------

    def enable_queries(
        self,
        *,
        read_context,
        parse,
        freshness_bound,
        max_question_bytes,
        max_answer_chars,
    ) -> ChannelAQueryCoordinator:
        """Attach the correlated query coordinator around this adapter's seams.

        Optional and startup-only. Without this call ordinary text keeps the
        accepted RCA-3a behavior. The coordinator receives only the foreign
        dependencies -- the owner-scoped context reader, the visible-snapshot
        parser and the injected bounds -- while admission validation and
        delivery reuse this adapter's live action record and its existing text
        send classification. No second transport path and no raw action nonce
        leave this adapter.

        Exactly one attachment is allowed. A repeated attempt is rejected with a
        sanitized configuration error before any state changes, so a live
        coordinator is never hot-swapped and an in-flight query keeps the policy
        it started under. Construction runs under the serial adapter lock, so
        concurrent attempts leave exactly one coordinator attached and a failed
        construction never partially attaches.
        """
        with self._lock:
            if self.query is not None:
                raise ChannelABotConfigInvalid(PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
            coordinator = ChannelAQueryCoordinator(
                registry=self.registry,
                validate=self.binding_admitted,
                read_context=read_context,
                parse=parse,
                deliver=self.send_query,
                freshness_bound=freshness_bound,
                max_question_bytes=max_question_bytes,
                max_answer_chars=max_answer_chars,
                delivered_label=SEND_DELIVERED,
                rejected_label=SEND_REJECTED,
                unknown_label=SEND_UNKNOWN,
            )
            self.query = coordinator
            return coordinator

    def binding_admitted(self, binding) -> bool:
        """Prove the captured binding still matches this adapter's live record.

        The coordinator also revalidates the registry link; this seam adds the
        adapter epoch and the local admission record without ever exporting the
        raw action nonce. It runs under the serial adapter lock with its caller.
        """
        if not isinstance(binding, QueryBinding):
            return False
        if binding.epoch != self._epoch:
            return False
        for record in self._actions.values():
            if (
                record.phone_id == binding.phone_id
                and record.owner_id == binding.owner_id
                and record.generation == binding.generation
                and record.confirmed_update_id == binding.confirmed_update_id
            ):
                return True
        return False

    def send_query(self, binding, text) -> str:
        """Send one answer text through the existing text-only classification."""
        chat_id = self._chat_from_phone(binding.phone_id)
        if chat_id is None:
            return SEND_UNKNOWN
        return self._send(chat_id, text)

    def _handle_query(self, update_id, actor_id, text) -> IngressOutcome:
        """Route one ordinary text from a linked phone through the coordinator."""
        phone_id = phone_identity(actor_id)
        record = self._record_for_phone(phone_id)
        if record is None:
            # No adapter-admitted record exists for this phone, so nothing is
            # bound: a registry link alone never authorizes an answer.
            return IngressOutcome(update_id, VARIANT_MESSAGE, QUERY_IGNORED_UNBOUND, True)
        if update_id <= record.confirmed_update_id:
            # Queued before this link was confirmed: it can never bind to it.
            return IngressOutcome(update_id, VARIANT_MESSAGE, QUERY_IGNORED_STALE, True)
        binding = QueryBinding(
            phone_id,
            record.owner_id,
            record.generation,
            update_id,
            record.confirmed_update_id,
            self._epoch,
        )
        outcome = self.query.handle_query(binding, text)
        delivery = SEND_NONE if outcome.delivery is None else outcome.delivery
        return IngressOutcome(
            update_id,
            VARIANT_MESSAGE,
            outcome.kind,
            True,
            delivery,
            None,
            outcome.envelope,
        )

    def _record_for_phone(self, phone_id):
        """Return the single bounded local action record for one phone, or ``None``."""
        for record in self._actions.values():
            if record.phone_id == phone_id:
                return record
        return None

    @staticmethod
    def _chat_from_phone(phone_id):
        """Recover the bounded private chat id from a canonical phone identity."""
        if not isinstance(phone_id, str) or not phone_id.startswith(PHONE_ID_PREFIX):
            return None
        suffix = phone_id[len(PHONE_ID_PREFIX):]
        if not suffix.isdigit() or len(suffix) > 16:
            return None
        return _bounded_id(int(suffix))

    def _claim(self, update_id, chat_id, actor_id, token) -> IngressOutcome:
        phone_id = phone_identity(actor_id)
        self._purge_claims()
        if len(self._pending_claims) >= self.max_pending_claims:
            # The local preflight index is full of live records. Refuse before
            # touching the registry so no QR token is consumed and no live
            # record is evicted: only genuinely stale records may be purged.
            return self._notice(
                update_id, VARIANT_MESSAGE, PAIRING_REFUSED, chat_id, COPY_REFUSED
            )
        try:
            ticket, claim = self.registry.claim_qr(token, phone_id)
        except Exception:
            return self._notice(
                update_id, VARIANT_MESSAGE, PAIRING_REFUSED, chat_id, COPY_REFUSED
            )
        label, lookup_ok = self._read_label(claim.owner_id)
        if not lookup_ok:
            # A lookup/config/clock failure is not an authoritative absence: the
            # freshly reserved pending claim stays live and expires on its own.
            return self._notice(
                update_id, VARIANT_MESSAGE, PAIRING_REFUSED, chat_id, COPY_REFUSED
            )
        if label is None:
            self._cancel_claim(ticket, phone_id)
            return self._notice(
                update_id,
                VARIANT_MESSAGE,
                PAIRING_DESTINATION_UNAVAILABLE,
                chat_id,
                COPY_DESTINATION_UNAVAILABLE,
            )
        self._pending_claims[_digest(ticket)] = _Claim(
            claim.owner_id, phone_id, claim.expires_at, label
        )
        delivery = self._send(
            chat_id,
            CONFIRMATION_PROMPT_TEMPLATE.format(label=label),
            _keyboard(
                (BUTTON_CONFIRM, CALLBACK_CONFIRM + ":" + ticket),
                (BUTTON_CANCEL, CALLBACK_CANCEL + ":" + ticket),
            ),
        )
        if delivery == SEND_REJECTED:
            self._forget_claim(ticket)
            self._cancel_claim(ticket, phone_id)
            return IngressOutcome(
                update_id, VARIANT_MESSAGE, PAIRING_PROMPT_REJECTED, True, SEND_REJECTED
            )
        if delivery == SEND_UNKNOWN:
            # The prompt may or may not have arrived: keep the pending claim and
            # never replay, so the phone can still confirm or let it expire.
            return IngressOutcome(
                update_id, VARIANT_MESSAGE, PAIRING_PROMPT_UNKNOWN, True, SEND_UNKNOWN
            )
        return IngressOutcome(
            update_id, VARIANT_MESSAGE, PAIRING_PROMPT_DELIVERED, True, SEND_DELIVERED
        )

    # -- callback ingress --------------------------------------------------

    def _handle_callback(self, update_id, callback) -> IngressOutcome:
        actor = self._callback_actor(callback)
        if actor is None:
            return IngressOutcome(update_id, VARIANT_CALLBACK, INGRESS_IGNORED_MALFORMED, True)
        actor_id, callback_id = actor
        data = callback.get("data")
        if not isinstance(data, str) or not data or len(data) > CALLBACK_DATA_MAX_BYTES:
            return self._refuse_action(update_id, callback_id)
        if not data.isascii():
            return self._refuse_action(update_id, callback_id)
        matched = _CALLBACK_DATA_PATTERN.match(data)
        if matched is None:
            return self._refuse_action(update_id, callback_id)
        action = matched.group("action")
        token = matched.group("token")
        if action == CALLBACK_CONFIRM:
            return self._confirm(update_id, actor_id, callback_id, token)
        if action == CALLBACK_CANCEL:
            return self._cancel(update_id, actor_id, callback_id, token)
        return self._link_action(update_id, actor_id, callback_id, action, token)

    def _confirm(self, update_id, actor_id, callback_id, ticket) -> IngressOutcome:
        phone_id = phone_identity(actor_id)
        claim = self._pending_claims.get(_digest(ticket))
        if claim is None or claim.phone_id != phone_id:
            # Never cancel a reservation that cannot be attributed to this phone.
            return self._refuse_action(update_id, callback_id)
        owner_id = claim.owner_id
        label, lookup_ok = self._read_label(owner_id)
        if not lookup_ok:
            # A lookup/config/clock failure is not an authoritative absence: keep
            # the live pending claim instead of deleting authority.
            return self._acknowledge(
                update_id, callback_id, COPY_ACTION_REFUSED, PAIRING_REFUSED
            )
        if label is None or label != claim.label:
            # The destination presented in the prompt is gone or has changed: the
            # human never approved the current destination, so fail closed.
            self._forget_claim(ticket)
            self._cancel_claim(ticket, phone_id)
            acknowledged = self._answer(callback_id, COPY_DESTINATION_UNAVAILABLE)
            delivery = self._send(actor_id, COPY_DESTINATION_UNAVAILABLE)
            return IngressOutcome(
                update_id,
                VARIANT_CALLBACK,
                PAIRING_DESTINATION_UNAVAILABLE,
                True,
                delivery,
                acknowledged,
            )
        self._purge_actions()
        if len(self._actions) >= self.max_link_actions:
            # Reserve capacity before mutating the registry, and fail closed.
            self._forget_claim(ticket)
            self._cancel_claim(ticket, phone_id)
            return self._acknowledge(
                update_id, callback_id, COPY_ACTION_REFUSED, PAIRING_REFUSED
            )
        try:
            link = self.registry.confirm(ticket, phone_id)
        except ChannelAPairingError as error:
            if isinstance(error, _AUTHORITATIVE_CLAIM_FAILURES):
                # The registry authoritatively no longer holds a usable ticket:
                # release the stale local record and its reservation.
                self._forget_claim(ticket)
                self._cancel_claim(ticket, phone_id)
            # An uncertain failure (clock/config/unavailable) keeps the live
            # pending claim so a later attempt can still confirm it. Never retry
            # or announce a success inside this call.
            return self._acknowledge(
                update_id, callback_id, COPY_ACTION_REFUSED, PAIRING_REFUSED
            )
        self._forget_claim(ticket)
        if not self._link_matches(phone_id, link.owner_id, link.generation):
            # The freshly confirmed link is already gone or replaced underneath.
            acknowledged = self._answer(callback_id, COPY_ACTION_REFUSED)
            delivery = self._send(actor_id, COPY_ACTION_REFUSED)
            return IngressOutcome(
                update_id, VARIANT_CALLBACK, PAIRING_REFUSED, True, delivery, acknowledged
            )
        try:
            nonce = self._mint_nonce()
        except ChannelABotError:
            # The registry keeps the freshly confirmed link; it still expires by
            # its own idle deadline, so nothing is silently transferred or rebound.
            acknowledged = self._answer(callback_id, COPY_ACTION_REFUSED)
            delivery = self._send(actor_id, COPY_ACTION_REFUSED)
            return IngressOutcome(
                update_id, VARIANT_CALLBACK, PAIRING_REFUSED, True, delivery, acknowledged
            )
        if not self._link_matches(phone_id, link.owner_id, link.generation):
            # The entropy draw may have replaced the captured link as a side
            # effect: validate before the success acknowledgement, never after it.
            acknowledged = self._answer(callback_id, COPY_ACTION_REFUSED)
            delivery = self._send(actor_id, COPY_ACTION_REFUSED)
            return IngressOutcome(
                update_id, VARIANT_CALLBACK, PAIRING_REFUSED, True, delivery, acknowledged
            )
        self._remember_action(
            nonce, phone_id, link.owner_id, link.generation, update_id
        )
        acknowledged = self._answer(callback_id, COPY_CONFIRMED)
        if not self._link_matches(phone_id, link.owner_id, link.generation):
            # The acknowledgement hook may have replaced the captured link: never
            # deliver a late welcome or claim a success that is no longer true.
            self._actions.pop(_digest(nonce), None)
            return IngressOutcome(
                update_id, VARIANT_CALLBACK, PAIRING_REFUSED, True, SEND_NONE, acknowledged
            )
        delivery = self._send(
            actor_id,
            WELCOME_TEMPLATE.format(label=label),
            _keyboard(
                (BUTTON_KEEP_CONNECTED, CALLBACK_KEEP_CONNECTED + ":" + nonce),
                (BUTTON_UNLINK, CALLBACK_UNLINK + ":" + nonce),
            ),
        )
        if delivery == SEND_REJECTED:
            kind = PAIRING_WELCOME_REJECTED
        elif delivery == SEND_UNKNOWN:
            kind = PAIRING_WELCOME_UNKNOWN
        else:
            kind = PAIRING_CONFIRMED
        return IngressOutcome(update_id, VARIANT_CALLBACK, kind, True, delivery, acknowledged)

    def _cancel(self, update_id, actor_id, callback_id, ticket) -> IngressOutcome:
        phone_id = phone_identity(actor_id)
        claim = self._pending_claims.get(_digest(ticket))
        if claim is None or claim.phone_id != phone_id:
            return self._refuse_action(update_id, callback_id)
        if not self._cancel_claim(ticket, phone_id):
            # Only report a cancellation the registry actually performed.
            return self._refuse_action(update_id, callback_id)
        self._forget_claim(ticket)
        acknowledged = self._answer(callback_id, COPY_CANCELLED)
        delivery = self._send(actor_id, COPY_CANCELLED)
        return IngressOutcome(
            update_id, VARIANT_CALLBACK, PAIRING_CANCELLED, True, delivery, acknowledged
        )

    def _link_action(self, update_id, actor_id, callback_id, action, nonce) -> IngressOutcome:
        phone_id = phone_identity(actor_id)
        digest = _digest(nonce)
        record = self._actions.get(digest)
        if record is None or record.phone_id != phone_id:
            # A foreign actor never gets to forget another phone's record.
            return self._refuse_action(update_id, callback_id)
        link, read_ok = self._read_link(phone_id)
        if not read_ok:
            # An uncertain link read never erases the live action record.
            return self._refuse_action(update_id, callback_id)
        if (
            link is None
            or link.generation != record.generation
            or link.owner_id != record.owner_id
        ):
            self._actions.pop(digest, None)
            return self._refuse_action(update_id, callback_id)
        if action == CALLBACK_KEEP_CONNECTED:
            try:
                self.registry.human_touch(phone_id, record.generation)
            except ChannelAPairingError as error:
                if isinstance(error, _AUTHORITATIVE_LINK_FAILURES):
                    # Authoritatively gone or stale: the control is dead.
                    self._actions.pop(digest, None)
                # Otherwise the failure is uncertain: keep the live control.
                return self._refuse_action(update_id, callback_id)
            acknowledged = self._answer(callback_id, COPY_KEEP_CONNECTED)
            return IngressOutcome(
                update_id, VARIANT_CALLBACK, KEEP_CONNECTED, True, SEND_NONE, acknowledged
            )
        try:
            self.registry.unlink_phone(phone_id, record.generation)
        except ChannelAPairingError as error:
            if isinstance(error, _AUTHORITATIVE_LINK_FAILURES):
                self._actions.pop(digest, None)
            return self._refuse_action(update_id, callback_id)
        self._actions.pop(digest, None)
        self._forget_claims_for_owner(record.owner_id)
        acknowledged = self._answer(callback_id, COPY_UNLINKED)
        delivery = self._send(actor_id, COPY_UNLINKED)
        return IngressOutcome(
            update_id, VARIANT_CALLBACK, UNLINKED, True, delivery, acknowledged
        )

    # -- local bounded indexes ---------------------------------------------

    def _purge_claims(self) -> None:
        """Expire genuinely stale local records before any registry mutation.

        Live records are never evicted: the caller enforces the bound before it
        touches the registry. When the clock is unusable nothing is purged,
        because an unknown now can neither prove staleness nor fabricate zero.
        """
        now = self._sample_clock()
        if now is None:
            return
        for digest, claim in list(self._pending_claims.items()):
            if now >= claim.expires_at:
                self._pending_claims.pop(digest, None)

    def _purge_actions(self) -> None:
        """Drop action records whose link is gone or has been replaced.

        The action bound is enforced by the caller's capacity check before it
        mutates the registry, so this method never evicts a live record.
        """
        for digest, record in list(self._actions.items()):
            link, read_ok = self._read_link(record.phone_id)
            if not read_ok:
                # An uncertain link read never erases a live action record.
                continue
            if (
                link is None
                or link.generation != record.generation
                or link.owner_id != record.owner_id
            ):
                self._actions.pop(digest, None)

    def _remember_action(
        self, nonce, phone_id, owner_id, generation, confirmed_update_id
    ) -> None:
        for digest, record in list(self._actions.items()):
            if record.phone_id == phone_id and record.generation == generation:
                self._actions.pop(digest, None)
        self._actions[_digest(nonce)] = _Action(
            phone_id, owner_id, generation, nonce, confirmed_update_id
        )

    def _forget_claim(self, ticket) -> None:
        self._pending_claims.pop(_digest(ticket), None)

    def _forget_claims_for_owner(self, owner_id) -> None:
        for digest, claim in list(self._pending_claims.items()):
            if claim.owner_id == owner_id:
                self._pending_claims.pop(digest, None)

    def _mint_nonce(self) -> str:
        """Mint one process-local action nonce bound to a live link."""
        for _attempt in range(MAX_NONCE_ATTEMPTS):
            try:
                raw = bytes(self.entropy(OPAQUE_BYTES))
            except Exception:
                raise ChannelABotError(PRISMA_CHANNEL_A_BOT_UNAVAILABLE) from None
            if len(raw) != OPAQUE_BYTES:
                raise ChannelABotError(PRISMA_CHANNEL_A_BOT_UNAVAILABLE)
            nonce = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
            digest = _digest(nonce)
            if digest in self._actions or digest in self._pending_claims:
                continue
            return nonce
        raise ChannelABotError(PRISMA_CHANNEL_A_BOT_UNAVAILABLE)

    # -- injected infrastructure -------------------------------------------

    def _read_label(self, owner_id):
        """Read a trusted owner label.

        Returns ``(label, lookup_ok)``. ``lookup_ok`` is false when the lookup
        itself failed, which is distinct from an authoritative absence where the
        lookup succeeded but produced no usable label. An authoritative absence
        may fail closed by releasing the pending claim; a lookup failure may not.
        Never runs under a domain lock.
        """
        try:
            value = self.destination_label(owner_id)
        except Exception:
            return None, False
        return _safe_label(value), True

    def _read_link(self, phone_id):
        """Return ``(link, read_ok)`` for one phone's current link."""
        try:
            return self.registry.phone_link(phone_id), True
        except Exception:
            return None, False

    def _link_matches(self, phone_id, owner_id, generation) -> bool:
        """Report whether the captured link is still the current one."""
        link, read_ok = self._read_link(phone_id)
        return (
            read_ok
            and link is not None
            and link.owner_id == owner_id
            and link.generation == generation
        )

    def _cancel_claim(self, ticket, phone_id) -> bool:
        """Release a pending claim and report whether the registry released it."""
        try:
            self.registry.cancel_pending(ticket, phone_id)
        except Exception:
            return False
        return True

    def _sample_clock(self):
        """Sample the injected clock, or ``None`` when it is unusable."""
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
        return number

    # -- transport ---------------------------------------------------------

    def _send(self, chat_id, text, reply_markup=None) -> str:
        """Send one text message and classify the raw response as delivery evidence."""
        try:
            response = self.transport.send_message(
                chat_id=chat_id, text=text, reply_markup=reply_markup
            )
        except Exception:
            return SEND_UNKNOWN
        if not isinstance(response, Mapping):
            return SEND_UNKNOWN
        ok = response.get("ok")
        if ok is False:
            error_code = _bounded_id(response.get("error_code"))
            description = response.get("description")
            if error_code is None or not isinstance(description, str):
                return SEND_UNKNOWN
            if not description.strip() or len(description) > MAX_DESCRIPTION_CHARS:
                return SEND_UNKNOWN
            return SEND_REJECTED
        if ok is not True:
            return SEND_UNKNOWN
        result = response.get("result")
        if not isinstance(result, Mapping):
            return SEND_UNKNOWN
        if _bounded_id(result.get("message_id")) is None:
            return SEND_UNKNOWN
        chat = result.get("chat")
        author = result.get("from")
        if not isinstance(chat, Mapping) or not isinstance(author, Mapping):
            return SEND_UNKNOWN
        if chat.get("type") != "private" or _bounded_id(chat.get("id")) != chat_id:
            return SEND_UNKNOWN
        if author.get("is_bot") is not True or _bounded_id(author.get("id")) != self.bot_id:
            return SEND_UNKNOWN
        return SEND_DELIVERED

    def _answer(self, callback_id, text) -> bool:
        """Acknowledge one callback press. Returns true only on an explicit ack."""
        payload = text[:MAX_ACK_TEXT_CHARS]
        try:
            response = self.transport.answer_callback_query(
                callback_query_id=callback_id, text=payload
            )
        except Exception:
            return False
        if response is True:
            return True
        if not isinstance(response, Mapping):
            return False
        return response.get("ok") is True and response.get("result") is True

    # -- outcome helpers ---------------------------------------------------

    def _notice(self, update_id, variant, kind, chat_id, text) -> IngressOutcome:
        delivery = self._send(chat_id, text)
        return IngressOutcome(update_id, variant, kind, True, delivery)

    def _acknowledge(self, update_id, callback_id, text, kind) -> IngressOutcome:
        acknowledged = self._answer(callback_id, text)
        return IngressOutcome(update_id, VARIANT_CALLBACK, kind, True, SEND_NONE, acknowledged)

    def _refuse_action(self, update_id, callback_id) -> IngressOutcome:
        return self._acknowledge(update_id, callback_id, COPY_ACTION_REFUSED, ACTION_REFUSED)

    # -- proactive inactivity warnings (RCA-3c) ----------------------------

    def send_inactivity_warnings(self) -> tuple[InactivityWarningOutcome, ...]:
        """Attempt one reserved inactivity warning per due link, and no more.

        Synchronous and serialized: a future RCA-5 scheduler calls this
        explicitly; this adapter starts no loop, thread, timer or ``getUpdates``.
        The public registry sweep runs under the serial adapter lock -- never
        under the domain lock across I/O -- and its per-window reservation is one
        attempt, not a guaranteed delivery. A rejected or unknown send is never
        retried or re-armed, and an uncertain registry read never deletes a live
        local control. The returned tuple is bounded by the live links and
        carries no secret.
        """
        with self._lock:
            try:
                due = self.registry.due_warnings()
            except Exception:
                # A whole-sweep registry failure is reported as a controlled
                # error: nothing is claimed delivered and no live action record
                # is lost.
                raise ChannelABotError(PRISMA_CHANNEL_A_BOT_UNAVAILABLE) from None
            return tuple(self._warn_one(snapshot) for snapshot in due)

    def _warn_one(self, snapshot) -> InactivityWarningOutcome:
        """Attempt one reserved snapshot, or skip it without deleting authority.

        The authoritative link is re-read immediately before the effect and
        after any earlier warning send in this same sweep, so a prior recipient's
        transport hook may invalidate, replace or touch a later recipient
        without this attempt trusting a stale capture.
        """
        record = self._action_for(snapshot.phone_id, snapshot.owner_id, snapshot.generation)
        if record is None:
            # A registry link alone is not authority: without this adapter's own
            # admitted action record the captured warning is skipped.
            return self._skipped_warning(snapshot)
        chat_id = self._chat_from_phone(snapshot.phone_id)
        if chat_id is None:
            return self._skipped_warning(snapshot)
        link, read_ok = self._read_link(snapshot.phone_id)
        if not read_ok or not self._same_warning_window(link, snapshot):
            # An uncertain read never erases the live control; a stale, replaced
            # or human-refreshed window is simply no longer due.
            return self._skipped_warning(snapshot)
        delivery = self._send(
            chat_id,
            COPY_INACTIVITY_WARNING,
            _keyboard(
                (BUTTON_KEEP_CONNECTED, CALLBACK_KEEP_CONNECTED + ":" + record.nonce),
                (BUTTON_UNLINK, CALLBACK_UNLINK + ":" + record.nonce),
            ),
        )
        return InactivityWarningOutcome(
            snapshot.owner_id, snapshot.phone_id, snapshot.generation, delivery
        )

    def _action_for(self, phone_id, owner_id, generation):
        """Return this adapter's admitted action record for the exact link."""
        for record in self._actions.values():
            if (
                record.phone_id == phone_id
                and record.owner_id == owner_id
                and record.generation == generation
            ):
                return record
        return None

    @staticmethod
    def _same_warning_window(link, snapshot) -> bool:
        """Report whether the live link still carries the reserved warning window."""
        return (
            link is not None
            and link.owner_id == snapshot.owner_id
            and link.generation == snapshot.generation
            and link.last_human_activity_at == snapshot.last_human_activity_at
            and link.idle_expires_at == snapshot.idle_expires_at
            and link.warning_issued
        )

    @staticmethod
    def _skipped_warning(snapshot) -> InactivityWarningOutcome:
        return InactivityWarningOutcome(
            snapshot.owner_id, snapshot.phone_id, snapshot.generation, WARNING_SKIPPED
        )
