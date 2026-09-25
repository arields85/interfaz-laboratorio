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
publication, offset bookkeeping, batching, and any real HTTP client. The
polling loop that owns ``getUpdates`` offsets, the long-poll cadence and the
per-bot transport wiring belongs to the later runtime integration stage. This
module never imports an HTTP, socket, subprocess, lifecycle or
operator-secret module.

Unknown ordinary text is ignored by default. When the optional correlated
query coordinator (RCA-3b) is attached through ``enable_queries``, ordinary text
from a currently linked phone is answered through it under a captured owner,
generation, confirmation fence and adapter epoch; without that attachment the
accepted RCA-3a behavior is unchanged and ordinary text is never routed.

The proactive inactivity warning (RCA-3c) and idle-expiry cleanup (PW-011 M3)
are explicit, synchronous sweeps, not background loops themselves:
``send_inactivity_warnings``/``send_expiry_cleanup`` use only the public
registry sweep and this adapter's own admitted action records, and return a
bounded tuple of delivered/rejected/unknown/skipped attempts. A reservation
(warning) or a release (expiry) is one attempt per window; a skipped,
rejected or unknown attempt is never retried or re-armed, and an effect that
already reached the phone cannot be retracted. ``ChannelAActivation`` (PW-011
M3) is what actually calls both, periodically, on a named interval, starting
and stopping with the activation itself -- this module still starts no loop,
thread or timer of its own.

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
    is_query_envelope_well_formed,
)
from .voice_transcription import (
    DEFAULT_VOICE_NOTE_MIME_TYPE,
    MAX_VOICE_NOTE_FILE_SIZE_BYTES,
    VOICE_NOTE_DOWNLOAD_FAILED_REPLY,
    VOICE_NOTE_TOO_LARGE_REPLY,
    VOICE_NOTE_TOO_LONG_REPLY,
    VOICE_NOTE_TRANSCRIPTION_EMPTY_REPLY,
    VOICE_NOTE_TRANSCRIPTION_UNAVAILABLE_REPLY,
    VoiceNoteTooLarge,
    VoiceNoteTooLong,
    VoiceTranscriptionEmpty,
    validate_voice_note_duration,
    validate_voice_note_size,
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
# T3: cancels a pending unlink confirmation without touching the link. The
# real unlink reuses CALLBACK_UNLINK (the existing, already-proven callback)
# rather than minting a parallel confirm action.
CALLBACK_UNLINK_CANCEL = "uc"

INGRESS_IGNORED_STALE = "ignored_stale"
INGRESS_IGNORED_MALFORMED = "ignored_malformed"
INGRESS_IGNORED_UNSUPPORTED = "ignored_unsupported"
INGRESS_IGNORED_AMBIGUOUS = "ignored_ambiguous"
INGRESS_IGNORED_UNRELATED = "ignored_unrelated"

# PW-013: voice-note question outcomes, reported on the exact same
# IngressOutcome shape as every other message kind. A voice note that
# successfully transcribes never gets its own kind: it is routed through
# _handle_query and reports the SAME kinds a typed question would.
VOICE_NOTE_REJECTED = "voice_note_rejected"
VOICE_NOTE_DOWNLOAD_FAILED = "voice_note_download_failed"
VOICE_NOTE_TRANSCRIPTION_FAILED = "voice_note_transcription_failed"

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
# T3: the "Desvincular" persistent reply-keyboard button never unlinks
# directly -- it opens a SEPARATE confirmation prompt first.
UNLINK_PROMPT_DELIVERED = "unlink_prompt_delivered"
UNLINK_PROMPT_REJECTED = "unlink_prompt_rejected"
UNLINK_PROMPT_UNKNOWN = "unlink_prompt_unknown"
UNLINK_CANCELLED = "unlink_cancelled"

BUTTON_CONFIRM = "Confirmar"
BUTTON_CANCEL = "Cancelar"
BUTTON_KEEP_CONNECTED = "Seguir conectado"
BUTTON_UNLINK = "Desvincular"
# T3: the confirm button on the SEPARATE unlink-confirmation prompt (guards
# against an accidental tap of the persistent reply-keyboard button below).
BUTTON_UNLINK_CONFIRM = "Confirmar desvinculación"

CONFIRMATION_PROMPT_TEMPLATE = (
    "Un teléfono quiere conectarse con:\n"
    "{label}\n"
    "\n"
    "Confirme para hacerle preguntas a Prisma desde aquí; le responderá en pantalla y con voz."
)
WELCOME_TEMPLATE = (
    "Vinculación confirmada con:\n"
    "{label}\n"
    "\n"
    "Ya puede realizar sus consultas. Use el botón «Desvincular» de este chat para dejar de "
    "recibir respuestas en este teléfono."
)
COPY_REFUSED = (
    "No se pudo iniciar la vinculación: el código no es válido, ya venció o este teléfono ya está vinculado."
)
COPY_DESTINATION_UNAVAILABLE = (
    "{label} ya no está disponible. Genere un código nuevo desde la pantalla."
)
COPY_CANCELLED = "Vinculación cancelada."
COPY_CONFIRMED = "Vinculación confirmada."
COPY_KEEP_CONNECTED = "Listo, seguimos conectados."
COPY_UNLINKED = "Este teléfono quedó desvinculado."
COPY_ACTION_REFUSED = (
    "Ese botón ya no es válido. Genere un código nuevo desde la pantalla del HMI."
)
COPY_INACTIVITY_WARNING = (
    "La vinculación con {label} se va a cerrar por inactividad.\n"
    "Use el botón para seguir conectado, o el botón «Desvincular» de este chat para desvincular "
    "este teléfono."
)
# PW-011 M3: sent once, to the phone, when a periodic sweep finds a link the
# registry already released by idle expiry -- never a delivery contract (the
# release already happened), just the visible counterpart of the cleanup
# below (removing the reply keyboard requires sending some message with
# remove_keyboard; without this notice the release stayed completely
# silent). Deliberately distinct from COPY_UNLINKED: this was never an
# explicit "Desvincular" tap.
COPY_EXPIRED = "La vinculación con {label} se cerró por inactividad."
# T3: shown when the persistent "Desvincular" button is pressed, before any
# unlink actually happens -- guards against an accidental tap.
COPY_UNLINK_CONFIRM_PROMPT = (
    "¿Confirma que desea desvincular este teléfono? Ya no recibirá respuestas de Prisma en este chat."
)

# T14: the always-visible Telegram menu entry (chat menu button + one
# chat-scoped command), shown alongside the T3 persistent reply keyboard so
# unlinking stays reachable even while the system keyboard hides it. The
# description is the exact text Telegram shows next to the command in the
# menu list.
UNLINK_COMMAND = "desvincular"
UNLINK_COMMAND_DESCRIPTION = "Desvincular este teléfono de la HMI"

# One warning reservation is one *attempt*. A skipped, rejected or unknown
# attempt is reported honestly and is never automatically retried or re-armed.
WARNING_SKIPPED = "skipped"
# PW-011 M3: the release itself already happened (the registry sweep already
# dropped the link) -- only the notice/menu-clear attempt for it can be
# skipped, when no chat id can be recovered for the phone.
EXPIRY_SKIPPED = "skipped"

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
# T14: ``/desvincular``, optionally with Telegram's own ``@<botname>``
# disambiguation suffix (sent by some clients even in a private chat) and/or
# trailing text, all ignored -- this command never carries a payload. The
# suffix's own username is not checked against this bot's identity: a
# private-chat update can only ever originate from this bot's own polling
# stream (a different bot's commands never reach it), and the bot's own
# username is not yet known when this dialogue is constructed (identity
# discovery runs later, during activation).
_UNLINK_COMMAND_PATTERN = re.compile(r"^/desvincular(?:@[A-Za-z0-9_]{5,32})?(?:[ \t].*)?\Z")
_URLSAFE_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{" + str(OPAQUE_CHARS) + r"}\Z")
_CALLBACK_DATA_PATTERN = re.compile(
    r"^(?P<action>"
    + "|".join((
        CALLBACK_CONFIRM, CALLBACK_CANCEL, CALLBACK_KEEP_CONNECTED,
        CALLBACK_UNLINK, CALLBACK_UNLINK_CANCEL,
    ))
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
    "BUTTON_UNLINK_CONFIRM",
    "CALLBACK_CANCEL",
    "CALLBACK_CONFIRM",
    "CALLBACK_DATA_MAX_BYTES",
    "CALLBACK_KEEP_CONNECTED",
    "CALLBACK_UNLINK",
    "CALLBACK_UNLINK_CANCEL",
    "CONFIRMATION_PROMPT_TEMPLATE",
    "COPY_ACTION_REFUSED",
    "COPY_CANCELLED",
    "COPY_CONFIRMED",
    "COPY_DESTINATION_UNAVAILABLE",
    "COPY_EXPIRED",
    "COPY_INACTIVITY_WARNING",
    "COPY_KEEP_CONNECTED",
    "COPY_REFUSED",
    "COPY_UNLINK_CONFIRM_PROMPT",
    "COPY_UNLINKED",
    "EXPIRY_SKIPPED",
    "ChannelABotConfigInvalid",
    "ChannelABotError",
    "ChannelAPairingDialogue",
    "ChannelATextTransport",
    "ExpiryCleanupOutcome",
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
    "UNLINK_CANCELLED",
    "UNLINK_COMMAND",
    "UNLINK_COMMAND_DESCRIPTION",
    "UNLINK_PROMPT_DELIVERED",
    "UNLINK_PROMPT_REJECTED",
    "UNLINK_PROMPT_UNKNOWN",
    "UNLINKED",
    "URLSAFE_ALPHABET",
    "VARIANT_CALLBACK",
    "VARIANT_MESSAGE",
    "VARIANT_UNKNOWN",
    "VOICE_NOTE_DOWNLOAD_FAILED",
    "VOICE_NOTE_REJECTED",
    "VOICE_NOTE_TRANSCRIPTION_FAILED",
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

    def send_chat_action(self, *, chat_id: int, action: str) -> object:
        """Signal a transient chat action (e.g. "typing") and return the raw
        response body (T4). Optional at runtime: a transport double that
        omits this method is tolerated -- see ``_typing``."""

    def set_my_commands(self, *, chat_id: int, command: str, description: str) -> object:
        """Publish one bot command scoped to exactly one chat and return the
        raw response body (T14). Optional at runtime -- see
        ``_set_unlink_menu``."""

    def delete_my_commands(self, *, chat_id: int) -> object:
        """Remove the chat-scoped command list for exactly one chat and
        return the raw response body (T14). Optional at runtime -- see
        ``_clear_unlink_menu``."""

    def set_chat_menu_button(self, *, chat_id: int, button_type: str) -> object:
        """Set or reset the chat menu button for exactly one chat and return
        the raw response body (T14). Optional at runtime -- see
        ``_set_unlink_menu``/``_clear_unlink_menu``."""

    def get_file(self, *, file_id: str) -> str:
        """Resolve a voice note's file_id into its downloadable file_path
        (PW-013). Optional at runtime: only required when
        :meth:`ChannelAPairingDialogue.enable_voice_notes` is attached -- see
        ``_handle_voice_note``."""

    def download_file(self, *, file_path: str, max_bytes: int) -> bytes:
        """Download one file's raw bytes, bounded by ``max_bytes`` (PW-013).
        Optional at runtime, same condition as ``get_file``."""


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


@dataclass(frozen=True)
class ExpiryCleanupOutcome:
    """One declared cleanup attempt for one link the registry just released
    by idle expiry (PW-011 M3).

    ``status`` is the existing ``delivered``/``rejected``/``unknown`` send
    classification for the expiry notice, or ``skipped`` when no chat could
    be recovered for the phone. The release itself already happened (the
    registry sweep already dropped the link) before this outcome is ever
    produced -- this only reports the notice/menu-clear attempt.
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
    # Live test 2026-09-25 (F3): the exact label WELCOME_TEMPLATE showed the
    # human at confirmation (claim.label, already validated equal to a fresh
    # read at that moment -- see _confirm). The M3 sweep uses this captured
    # value instead of a fresh destination_label() re-read, which is
    # freshness-bound to a live HMI session and fails exactly when a sweep
    # is due (the session has, by definition, gone idle by then). None only
    # for a record that predates this field or was never confirmed with a
    # usable label -- _display_label's existing fallback still applies.
    label: str | None = None


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
    # Preserve the accepted string value, including subclasses overriding __str__.
    return str.__str__(value)


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


# PW-011: "el documento" leaked into user-facing Telegram copy that should
# instead name the same HMI destination label CONFIRMATION_PROMPT_TEMPLATE/
# WELCOME_TEMPLATE already show. When no usable label exists -- a fresh
# lookup failed or returned nothing, or (at first claim time) none was ever
# established -- fall back to a generic, still-grammatical reference to the
# HMI. Two forms because {label} sits at different positions across the
# affected templates: mid-sentence keeps the lowercase article, a
# sentence-initial placeholder needs it capitalized.
_FALLBACK_LABEL = "la HMI"
_FALLBACK_LABEL_SENTENCE_START = "La HMI"


def _display_label(label: str | None, *, sentence_start: bool = False) -> str:
    """Return ``label`` verbatim when usable, otherwise the generic fallback."""
    if label:
        return label
    return _FALLBACK_LABEL_SENTENCE_START if sentence_start else _FALLBACK_LABEL


def _keyboard(*buttons) -> dict:
    """Build one inline keyboard with one named button per row."""
    return {
        "inline_keyboard": [
            [{"text": text, "callback_data": data}] for text, data in buttons
        ]
    }


def _is_unlink_button_text(text: str) -> bool:
    """Match the persistent "Desvincular" reply-keyboard button text (T3).

    Exact match only, tolerant of surrounding whitespace and case: a longer
    sentence that merely mentions the word is never mistaken for the button,
    and this check runs before the query coordinator ever sees the text, so
    the button press is never treated as a data query.
    """
    return text.strip().casefold() == BUTTON_UNLINK.casefold()


def _unlink_reply_keyboard() -> dict:
    """Build the persistent reply keyboard (T3) shown once a phone is linked.

    Telegram allows only one ``reply_markup`` per message, so this replaces
    -- never joins -- an inline keyboard on the same send.
    """
    return {
        "keyboard": [[{"text": BUTTON_UNLINK}]],
        "resize_keyboard": True,
        "is_persistent": True,
    }


def send_chat_action_unless_answered(chat_id, answered, send, *, action="typing") -> None:
    """Shared PW-011 M5 / live-test-2026-09-25 F6 dispatch check.

    Skips ``send`` once the caller's own per-message ``answered`` signal is
    already set, so a best-effort "typing…" (or other) chat action can never
    visibly arrive at the phone after its answer already did. This is the
    exact decision ``ChannelAPairingDialogue._send_typing_unless_answered``
    used before PW-011 M5 introduced it (kept there as a thin delegating
    staticmethod for its own existing tests); Channel B's own typing
    indicator (``local_presentation.TelegramLocalBot._typing``) reuses this
    same function directly instead of duplicating the check. Never blocks
    or fails the caller: any exception ``send`` raises is silently
    swallowed -- this is UX feedback, not a delivery contract.
    """
    if answered.is_set():
        return
    try:
        send(chat_id=chat_id, action=action)
    except Exception:
        pass


def _remove_reply_keyboard() -> dict:
    """Remove any reply keyboard (T3): sent on every path that unlinks."""
    return {"remove_keyboard": True}


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
        # PW-013: optional -- attaching voice-note support requires the query
        # coordinator above to already be attached. Left unset, a voice note
        # is simply ignored (INGRESS_IGNORED_UNRELATED), same as before this
        # task existed.
        self._transcribe = None

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
            voice = message.get("voice")
            if self._transcribe is not None and isinstance(voice, Mapping):
                # PW-013: a voice note is only ever routed to the ordinary
                # query coordinator, exactly like typed text below -- it
                # never reaches the "/start"/unlink/command branches, which
                # all require actual text.
                return self._handle_voice_note(update_id, chat_id, actor_id, voice)
            return IngressOutcome(update_id, VARIANT_MESSAGE, INGRESS_IGNORED_UNRELATED, True)
        if not isinstance(text, str):
            return IngressOutcome(update_id, VARIANT_MESSAGE, INGRESS_IGNORED_MALFORMED, True)
        if _is_unlink_button_text(text):
            # T3: the persistent reply-keyboard button sends this exact text
            # as an ordinary message. Intercepted before both the command
            # path and the query coordinator below -- never treated as a
            # data query, regardless of whether one is attached.
            return self._request_unlink(update_id, chat_id, actor_id)
        if self.query is None or text.startswith("/"):
            # The command path keeps the historical 128-character bound. Only an
            # ordinary query, when the correlated coordinator is attached, is
            # bounded by the injected byte policy instead.
            if len(text) > MAX_MESSAGE_TEXT_CHARS:
                return IngressOutcome(
                    update_id, VARIANT_MESSAGE, INGRESS_IGNORED_MALFORMED, True
                )
            if _UNLINK_COMMAND_PATTERN.match(text) is not None:
                # T14: the Telegram menu entry's "/desvincular" routes to the
                # SAME confirm-unlink flow as the persistent reply-keyboard
                # button above -- never treated as a data query (this branch
                # only runs for text starting with "/"), and gracefully
                # ignored via _request_unlink's own INGRESS_IGNORED_UNRELATED
                # when this chat has no live link.
                return self._request_unlink(update_id, chat_id, actor_id)
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
        context_is_current,
        parse,
        freshness_bound,
        max_question_bytes,
        max_answer_chars,
        clock=None,
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
            options = {}
            if clock is not None:
                options["clock"] = clock
            coordinator = ChannelAQueryCoordinator(
                registry=self.registry,
                validate=self.binding_admitted,
                read_context=read_context,
                context_is_current=context_is_current,
                parse=parse,
                deliver=self.send_query,
                resolve_label=self._resolve_display_label,
                freshness_bound=freshness_bound,
                max_question_bytes=max_question_bytes,
                max_answer_chars=max_answer_chars,
                delivered_label=SEND_DELIVERED,
                rejected_label=SEND_REJECTED,
                unknown_label=SEND_UNKNOWN,
                **options,
            )
            self.query = coordinator
            return coordinator

    def enable_voice_notes(self, *, transcribe) -> None:
        """Attach voice-note question support (PW-013).

        Requires :meth:`enable_queries` to already be attached: a voice
        note's transcript is routed through the exact same query coordinator
        as typed text (see ``_handle_voice_note``/``_handle_query``), so
        every binding/freshness/answer rule applies identically -- there is
        no separate voice-only answer path. ``transcribe(audio_bytes,
        mime_type)`` must return the transcript text or raise a
        ``voice_transcription.VoiceTranscriptionError`` subtype; it never
        resolves a provider secret or talks to Telegram itself (downloading
        is this class's own job, via ``self.transport``). Construction runs
        under the serial adapter lock, matching ``enable_queries``.
        """
        with self._lock:
            if self.query is None:
                raise ChannelABotConfigInvalid(PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
            if not callable(transcribe):
                raise ChannelABotConfigInvalid(PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
            if not callable(getattr(self.transport, "get_file", None)) or not callable(
                getattr(self.transport, "download_file", None)
            ):
                raise ChannelABotConfigInvalid(PRISMA_CHANNEL_A_BOT_CONFIG_INVALID)
            self._transcribe = transcribe

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

    def _capture_delivery_witness(self, envelope):
        """Capture admission references without clocks or a liveness assertion."""
        if not is_query_envelope_well_formed(envelope):
            return None
        try:
            with self._lock:
                epoch = self._epoch
                if epoch != envelope.epoch:
                    return None
                registry = self.registry
                action = None
                for key, record in self._actions.items():
                    if (record.owner_id == envelope.owner_id
                            and record.generation == envelope.generation
                            and envelope.update_id > record.confirmed_update_id):
                        action = (key, record, record.owner_id, record.generation,
                                  record.confirmed_update_id)
                        break
            if action is None:
                return None
            link = registry._capture_link_witness(envelope.owner_id, envelope.generation)
            if link is None:
                return None
            witness = (self, epoch, action, registry, link)
            return witness if self._delivery_witness_matches(witness) is True else None
        except Exception:
            return None

    def _delivery_witness_matches(self, witness) -> bool:
        """Compare pairing and action under separate locks, without foreign checks."""
        try:
            if type(witness) is not tuple or len(witness) != 5:
                return False
            dialogue, epoch, action, registry, link = witness
            if (dialogue is not self or type(epoch) is not str
                    or type(action) is not tuple or len(action) != 5
                    or registry is not self.registry):
                return False
            key, record, owner, generation, fence = action
            if (type(key) is not bytes or type(record) is not _Action
                    or type(owner) is not str or type(generation) is not int
                    or type(fence) is not int):
                return False
            if registry._link_witness_matches(link) is not True:
                return False
            with self._lock:
                return (
                    self.registry is registry and self._epoch == epoch
                    and self._actions.get(key) is record
                    and record.owner_id == owner and record.generation == generation
                    and record.confirmed_update_id == fence
                )
        except Exception:
            return False

    def is_query_envelope_admitted(self, envelope) -> bool:
        """Check trusted delivery eligibility without renewing the admitted link."""
        if not is_query_envelope_well_formed(envelope):
            return False
        try:
            with self._lock:
                epoch = self._epoch
                if envelope.epoch != epoch:
                    return False
                action_key = None
                action = None
                for key, record in self._actions.items():
                    if (
                        record.owner_id == envelope.owner_id
                        and record.generation == envelope.generation
                        and envelope.update_id > record.confirmed_update_id
                    ):
                        action_key, action = key, record
                        break
                if action is None:
                    return False
            # Registry calls may reenter ingress. Never hold the dialogue lock.
            if self.registry.is_owner_link_current(envelope.owner_id, envelope.generation) is not True:
                return False
            with self._lock:
                return (
                    self._epoch == epoch
                    and self._actions.get(action_key) is action
                    and action.owner_id == envelope.owner_id
                    and action.generation == envelope.generation
                    and envelope.update_id > action.confirmed_update_id
                )
        except Exception:
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
        # T4: signal "typing…" right before producing the answer, so the
        # phone shows feedback for the dead time while a query is prepared.
        answered = self._typing(actor_id)
        try:
            outcome = self.query.handle_query(binding, text)
        finally:
            # PW-011 M5: query handling is done -- typing no longer makes
            # sense, whether or not an answer actually went out.
            if answered is not None:
                answered.set()
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

    def _handle_voice_note(self, update_id, chat_id, actor_id, voice) -> IngressOutcome:
        """Transcribe one voice-note question, then route it through
        _handle_query exactly like typed text (PW-013). Authorization runs
        first, before any download: the SAME phone-to-owner binding check
        _handle_query itself uses, never weakened for a voice note."""
        phone_id = phone_identity(actor_id)
        record = self._record_for_phone(phone_id)
        if record is None:
            # No adapter-admitted record for this phone: nothing to answer,
            # and nothing is downloaded.
            return IngressOutcome(update_id, VARIANT_MESSAGE, QUERY_IGNORED_UNBOUND, True)
        if update_id <= record.confirmed_update_id:
            return IngressOutcome(update_id, VARIANT_MESSAGE, QUERY_IGNORED_STALE, True)
        duration = voice.get("duration")
        file_id = voice.get("file_id")
        file_size = voice.get("file_size")
        mime_type = voice.get("mime_type") if isinstance(voice.get("mime_type"), str) else DEFAULT_VOICE_NOTE_MIME_TYPE
        if not isinstance(file_id, str) or not file_id:
            return IngressOutcome(update_id, VARIANT_MESSAGE, INGRESS_IGNORED_MALFORMED, True)
        try:
            validate_voice_note_duration(duration)
            validate_voice_note_size(file_size)
        except VoiceNoteTooLong:
            delivery = self._send(chat_id, VOICE_NOTE_TOO_LONG_REPLY)
            return IngressOutcome(update_id, VARIANT_MESSAGE, VOICE_NOTE_REJECTED, True, delivery)
        except VoiceNoteTooLarge:
            delivery = self._send(chat_id, VOICE_NOTE_TOO_LARGE_REPLY)
            return IngressOutcome(update_id, VARIANT_MESSAGE, VOICE_NOTE_REJECTED, True, delivery)
        # T4-style feedback for the dead time while the note is downloaded
        # and transcribed, same as _handle_query does before parsing.
        self._typing(actor_id)
        try:
            file_path = self.transport.get_file(file_id=file_id)
            audio_bytes = self.transport.download_file(
                file_path=file_path, max_bytes=MAX_VOICE_NOTE_FILE_SIZE_BYTES
            )
        except Exception:
            delivery = self._send(chat_id, VOICE_NOTE_DOWNLOAD_FAILED_REPLY)
            return IngressOutcome(update_id, VARIANT_MESSAGE, VOICE_NOTE_DOWNLOAD_FAILED, True, delivery)
        try:
            transcript = self._transcribe(audio_bytes, mime_type)
        except VoiceTranscriptionEmpty:
            delivery = self._send(chat_id, VOICE_NOTE_TRANSCRIPTION_EMPTY_REPLY)
            return IngressOutcome(update_id, VARIANT_MESSAGE, VOICE_NOTE_TRANSCRIPTION_FAILED, True, delivery)
        except Exception:
            # Any other injected-transcribe failure -- VoiceTranscriptionError
            # subtypes as well as an unexpected raise from the caller-built
            # callable -- must still never crash the poll loop (user
            # decision): fail closed with the same generic unavailable reply.
            delivery = self._send(chat_id, VOICE_NOTE_TRANSCRIPTION_UNAVAILABLE_REPLY)
            return IngressOutcome(update_id, VARIANT_MESSAGE, VOICE_NOTE_TRANSCRIPTION_FAILED, True, delivery)
        return self._handle_query(update_id, actor_id, transcript)

    def _request_unlink(self, update_id, chat_id, actor_id) -> IngressOutcome:
        """Handle the persistent "Desvincular" reply-keyboard button (T3).

        Never unlinks directly: it opens a separate confirmation prompt with
        its own inline confirm/cancel buttons, guarding against an
        accidental tap. Without a live admitted action record for this phone
        there is nothing to unlink, so the text is simply unrelated -- the
        same outcome ordinary unrecognized text gets.
        """
        phone_id = phone_identity(actor_id)
        record = self._record_for_phone(phone_id)
        if record is None:
            return IngressOutcome(update_id, VARIANT_MESSAGE, INGRESS_IGNORED_UNRELATED, True)
        delivery = self._send(
            chat_id,
            COPY_UNLINK_CONFIRM_PROMPT,
            _keyboard(
                (BUTTON_UNLINK_CONFIRM, CALLBACK_UNLINK + ":" + record.nonce),
                (BUTTON_CANCEL, CALLBACK_UNLINK_CANCEL + ":" + record.nonce),
            ),
        )
        if delivery == SEND_REJECTED:
            kind = UNLINK_PROMPT_REJECTED
        elif delivery == SEND_UNKNOWN:
            kind = UNLINK_PROMPT_UNKNOWN
        else:
            kind = UNLINK_PROMPT_DELIVERED
        return IngressOutcome(update_id, VARIANT_MESSAGE, kind, True, delivery)

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
            # PW-011: no label was ever established for this claim -- the
            # generic HMI fallback names the placeholder that opens the
            # sentence, so it is capitalized.
            return self._notice(
                update_id,
                VARIANT_MESSAGE,
                PAIRING_DESTINATION_UNAVAILABLE,
                chat_id,
                COPY_DESTINATION_UNAVAILABLE.format(
                    label=_display_label(None, sentence_start=True)
                ),
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
        if action == CALLBACK_UNLINK_CANCEL:
            return self._cancel_unlink(update_id, actor_id, callback_id, token)
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
            # PW-011: names the destination the human actually confirmed
            # against (claim.label, always usable -- see its own assignment
            # below), never the new/changed one, and never the internal
            # "documento" term.
            unavailable_text = COPY_DESTINATION_UNAVAILABLE.format(
                label=_display_label(claim.label, sentence_start=True)
            )
            acknowledged = self._answer(callback_id, unavailable_text)
            delivery = self._send(actor_id, unavailable_text)
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
            nonce, phone_id, link.owner_id, link.generation, update_id, label
        )
        acknowledged = self._answer(callback_id, COPY_CONFIRMED)
        if not self._link_matches(phone_id, link.owner_id, link.generation):
            # The acknowledgement hook may have replaced the captured link: never
            # deliver a late welcome or claim a success that is no longer true.
            self._actions.pop(_digest(nonce), None)
            return IngressOutcome(
                update_id, VARIANT_CALLBACK, PAIRING_REFUSED, True, SEND_NONE, acknowledged
            )
        # T3: the welcome message carries the persistent "Desvincular" reply
        # keyboard instead of the old inline Keep-connected/Unlink buttons --
        # Telegram allows only one reply_markup per message, and this
        # keyboard, once shown, stays visible under the input for every
        # later message regardless of what markup those carry.
        delivery = self._send(
            actor_id,
            WELCOME_TEMPLATE.format(label=label),
            _unlink_reply_keyboard(),
        )
        # T14: the always-visible Telegram menu entry complements the T3
        # persistent reply keyboard above (Telegram hides a reply keyboard
        # while the system keyboard is open, but not the chat menu button).
        # Fire-and-forget, same as _typing -- never delays this response.
        self._set_unlink_menu(actor_id)
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

    def _cancel_unlink(self, update_id, actor_id, callback_id, nonce) -> IngressOutcome:
        """Cancel a pending unlink confirmation (T3): the link is untouched.

        A foreign actor or an already-superseded action record is refused the
        same way every other action nonce refuses (T15's existing pattern);
        a real cancellation performs no registry mutation at all.
        """
        phone_id = phone_identity(actor_id)
        record = self._actions.get(_digest(nonce))
        if record is None or record.phone_id != phone_id:
            return self._refuse_action(update_id, callback_id)
        acknowledged = self._answer(callback_id, COPY_KEEP_CONNECTED)
        return IngressOutcome(
            update_id, VARIANT_CALLBACK, UNLINK_CANCELLED, True, SEND_NONE, acknowledged
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
        # T3: the only unlink path this module has -- remove the persistent
        # reply keyboard along with the unlink notice.
        delivery = self._send(actor_id, COPY_UNLINKED, _remove_reply_keyboard())
        # T14: clear the per-chat menu entry along with the reply keyboard --
        # same fire-and-forget shape as _set_unlink_menu, never delays this
        # response.
        self._clear_unlink_menu(actor_id)
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
        self, nonce, phone_id, owner_id, generation, confirmed_update_id, label=None
    ) -> None:
        for digest, record in list(self._actions.items()):
            if record.phone_id == phone_id and record.generation == generation:
                self._actions.pop(digest, None)
        self._actions[_digest(nonce)] = _Action(
            phone_id, owner_id, generation, nonce, confirmed_update_id, label
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

    def _resolve_display_label(self, owner_id) -> str:
        """PW-011 M7: the same trusted label source/fallback every other
        user-facing notice in this module already uses, injected into the
        query coordinator as its ``resolve_label`` seam (that module has
        deliberately no Telegram/pairing-label access of its own)."""
        label, _lookup_ok = self._read_label(owner_id)
        return _display_label(label)

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

    def _typing(self, chat_id) -> threading.Event | None:
        """Best-effort "typing…" chat action (T4), fire-and-forget (T13
        unit (e)).

        T4's original synchronous call added ~0.36s to every question
        (measured live, 2026-09-24: update handling grew from ~0.38s to
        ~0.74-0.80s) since it ran to completion before the answer was
        produced. It now runs on its own background daemon thread so it can
        never add latency to the answer that follows immediately after --
        the transport's own reused HTTP session (T7) is documented safe for
        concurrent use, so this never needs to serialize with the answer's
        own send. Never blocks or fails the caller's answer: a transport
        double without ``send_chat_action`` at all, or any exception it
        raises (on either thread), is silently swallowed. This is UX
        feedback, not a delivery contract -- there is no outcome, no retry
        and no logged failure at this layer (the transport itself already
        logs elapsed time on a genuine failure, T4/T5-style).

        PW-011 M5: the indicator only makes sense while the answer for this
        exact message is still being produced -- returns a ``threading.Event``
        the caller sets right after its own answer send completes (whether
        or not it actually sent anything: once query handling is done,
        "typing…" no longer means anything). The background worker checks
        that event immediately before calling ``send_chat_action`` and skips
        the call entirely if it is already set, so "typing…" can never
        visibly arrive at the phone after the answer already did. Returns
        ``None`` (nothing to set) when the transport has no chat-action
        method at all.
        """
        send = getattr(self.transport, "send_chat_action", None)
        if not callable(send):
            return None
        answered = threading.Event()
        threading.Thread(
            target=self._send_typing_unless_answered,
            args=(chat_id, answered, send),
            name="ChannelATypingIndicator",
            daemon=True,
        ).start()
        return answered

    @staticmethod
    def _send_typing_unless_answered(chat_id, answered, send) -> None:
        """The actual dispatch check (PW-011 M5), split out from ``_typing``'s
        thread-spawning wrapper so a test can call it directly -- exercising
        the skip/send decision deterministically, without racing a real
        background thread against a real answer send. Delegates to the
        shared module-level ``send_chat_action_unless_answered`` (live test
        2026-09-25, F6) -- kept as a staticmethod here only so this class's
        own existing tests, which call it via the class, keep working."""
        send_chat_action_unless_answered(chat_id, answered, send)

    def _set_unlink_menu(self, chat_id) -> None:
        """Best-effort, fire-and-forget Telegram menu entry for this chat (T14).

        Publishes the chat-scoped "/desvincular" command and switches this
        chat's menu button to show it, so an always-visible unlink entry
        sits next to the input even while the system keyboard hides the T3
        persistent reply keyboard. Runs on its own background daemon thread,
        exactly like ``_typing`` (T13 unit (e)), so it can never add latency
        to the welcome message it follows. Never blocks or fails the
        caller: a transport double missing either method, or any exception
        either call raises, is silently swallowed here -- this is UX
        plumbing, not a delivery contract (the transport itself already
        logs elapsed time on a genuine failure, T4/T14-style). Like
        ``_typing``, no background thread is even started when the
        transport declares neither method.
        """
        if not self._has_menu_capability("set_my_commands", "set_chat_menu_button"):
            return
        self._run_menu_effect(chat_id, self._apply_unlink_menu)

    def _clear_unlink_menu(self, chat_id) -> None:
        """Best-effort, fire-and-forget removal of the per-chat menu entry (T14).

        Mirrors ``_set_unlink_menu``: runs on the same kind of background
        thread so it never delays the unlink notice, never raises, and
        never starts a thread when the transport declares neither method.
        """
        if not self._has_menu_capability("delete_my_commands", "set_chat_menu_button"):
            return
        self._run_menu_effect(chat_id, self._apply_cleared_menu)

    def _has_menu_capability(self, *method_names) -> bool:
        """True when the transport implements at least one named menu call.

        Mirrors ``_typing``'s check-before-spawn precedent: a transport (or
        test double) declaring none of them never starts a background
        thread at all.
        """
        return any(callable(getattr(self.transport, name, None)) for name in method_names)

    def _run_menu_effect(self, chat_id, apply) -> None:
        def worker() -> None:
            apply(chat_id)

        threading.Thread(target=worker, name="ChannelAUnlinkMenu", daemon=True).start()

    def _apply_unlink_menu(self, chat_id) -> None:
        set_commands = getattr(self.transport, "set_my_commands", None)
        if callable(set_commands):
            try:
                set_commands(chat_id=chat_id, command=UNLINK_COMMAND, description=UNLINK_COMMAND_DESCRIPTION)
            except Exception:
                pass
        set_button = getattr(self.transport, "set_chat_menu_button", None)
        if callable(set_button):
            try:
                # Mirrors _typing's literal "typing": the transport module
                # (channel_a_transport.py) owns MENU_BUTTON_COMMANDS as the
                # canonical closed value; this module never imports from it
                # (transport imports FROM this module, not the reverse).
                set_button(chat_id=chat_id, button_type="commands")
            except Exception:
                pass

    def _apply_cleared_menu(self, chat_id) -> None:
        delete_commands = getattr(self.transport, "delete_my_commands", None)
        if callable(delete_commands):
            try:
                delete_commands(chat_id=chat_id)
            except Exception:
                pass
        set_button = getattr(self.transport, "set_chat_menu_button", None)
        if callable(set_button):
            try:
                set_button(chat_id=chat_id, button_type="default")
            except Exception:
                pass

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

        Synchronous and serialized: ``ChannelAActivation``'s periodic sweep
        (PW-011 M3) calls this explicitly, right after
        ``send_expiry_cleanup``; this adapter itself starts no loop, thread,
        timer or ``getUpdates``. The public registry sweep runs under the
        serial adapter lock -- never under the domain lock across I/O -- and
        its per-window reservation is one attempt, not a guaranteed delivery.
        A rejected or unknown send is never retried or re-armed, and an
        uncertain registry read never deletes a live local control. The
        returned tuple is bounded by the live links and carries no secret.
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
        # T3: only "Seguir conectado" is kept here -- it has a real function
        # (proactively renewing the idle window without needing an ordinary
        # query first). The inline "Desvincular" button was dropped: the
        # persistent reply keyboard already covers unlinking at any time, and
        # duplicating the affordance here would be confusing.
        # Live test 2026-09-25 (F3): the label captured on this action
        # record at confirmation time -- never a fresh destination_label()
        # re-read, which is freshness-bound to a live HMI session and fails
        # exactly when a sweep is due (the session has gone idle by then).
        # An unusable/never-captured value still falls back to the generic
        # HMI reference rather than skipping a warning that is otherwise due.
        delivery = self._send(
            chat_id,
            COPY_INACTIVITY_WARNING.format(label=_display_label(record.label)),
            _keyboard(
                (BUTTON_KEEP_CONNECTED, CALLBACK_KEEP_CONNECTED + ":" + record.nonce),
            ),
        )
        return InactivityWarningOutcome(
            snapshot.owner_id, snapshot.phone_id, snapshot.generation, delivery
        )

    # -- proactive expiry cleanup (PW-011 M3) -------------------------------

    def send_expiry_cleanup(self) -> tuple[ExpiryCleanupOutcome, ...]:
        """Clean up every link the registry just released by idle expiry,
        and no more.

        Synchronous and serialized, mirroring ``send_inactivity_warnings``'s
        own contract: a scheduler calls this explicitly; this adapter starts
        no loop, thread or timer of its own here (the menu-clear effect
        below still runs on its own short-lived background thread, exactly
        like every other menu-maintenance call). The registry sweep
        (``due_expirations``) runs under the domain lock; every Telegram
        effect below runs outside it, under this adapter's own serializing
        lock instead -- the same one ``handle_update``/
        ``send_inactivity_warnings`` already hold across their own I/O.

        Must be called BEFORE ``send_inactivity_warnings`` in the same sweep
        tick: see ``due_expirations()``'s own docstring for why the order
        matters (otherwise ``due_warnings()``'s own purge could drop an
        expired link unobserved, before this ever sees it).
        """
        with self._lock:
            try:
                expired = self.registry.due_expirations()
            except Exception:
                # A whole-sweep registry failure is reported as a controlled
                # error: nothing is claimed delivered and no live action
                # record is lost.
                raise ChannelABotError(PRISMA_CHANNEL_A_BOT_UNAVAILABLE) from None
            outcomes = tuple(self._cleanup_one(link) for link in expired)
            if expired:
                # The link is already gone; drop any local action record
                # still pointing at it (mirrors _confirm's own _purge_actions
                # call, and the explicit unlink path's _actions.pop).
                self._purge_actions()
            return outcomes

    def _cleanup_one(self, link) -> ExpiryCleanupOutcome:
        """Reuse the exact same unlink-cleanup effects the explicit
        "Desvincular" flow already uses (_link_action's CALLBACK_UNLINK
        branch) -- the module's only unlink-cleanup shape, now also reached
        by a silent inactivity release instead of only an explicit tap. The
        link is already released by the time this runs; there is no
        authoritative re-read here (unlike _warn_one, there is no live
        window left to still be current against)."""
        chat_id = self._chat_from_phone(link.phone_id)
        if chat_id is None:
            return ExpiryCleanupOutcome(
                link.owner_id, link.phone_id, link.generation, EXPIRY_SKIPPED
            )
        self._forget_claims_for_owner(link.owner_id)
        # Live test 2026-09-25 (F3): the label captured on this action
        # record at confirmation time -- never a fresh destination_label()
        # re-read (see _warn_one's own note; the same freshness-bound
        # failure mode applies here, and by expiry time it is even more
        # certain to fail). The action record for this exact link is still
        # present here: send_expiry_cleanup() only purges it AFTER every
        # _cleanup_one call in this sweep completes. An unusable/
        # never-captured value falls back to the generic HMI reference
        # rather than skipping the cleanup itself.
        record = self._action_for(link.phone_id, link.owner_id, link.generation)
        label = record.label if record is not None else None
        # T3: the only unlink-notice path this module has -- remove the
        # persistent reply keyboard along with the expiry notice.
        delivery = self._send(
            chat_id, COPY_EXPIRED.format(label=_display_label(label)), _remove_reply_keyboard()
        )
        # T14: clear the per-chat menu entry along with the reply keyboard --
        # same fire-and-forget shape as _clear_unlink_menu's other caller.
        self._clear_unlink_menu(chat_id)
        return ExpiryCleanupOutcome(
            link.owner_id, link.phone_id, link.generation, delivery
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
