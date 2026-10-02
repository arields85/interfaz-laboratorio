"""Shared Gemini speech-to-text transcription for Telegram voice-note questions.

PW-013: both Channel A (the dedicated HMI bot) and Channel B (the personal
remote bot) accept a voice note as a spoken question. Downloading the note is
transport-specific -- each bot owns its own Telegram HTTP client -- but
everything after the raw audio bytes (duration/size limits, the domain
vocabulary prompt and the actual Gemini call) lives here, shared, so both
channels behave identically and the caps can never drift between them.

Model id: ``GEMINI_TRANSCRIPTION_MODEL`` is a named constant, not verified
against a live listing -- no provider call is authorized by this task.
Unlike ``voice_service.TTS_MODEL``/``gemini_credentials.GEMINI_VERIFY_MODEL``
(``"gemini-3.8-flash-lite-tts"``, speech-*generation*-only), transcription
needs a general multimodal model that accepts inline audio for
understanding, so the "-lite-tts" suffix is deliberately dropped. This is an
assumption, reported to the user/parent for confirmation before any live use
-- not silently guessed and forgotten.
"""

from __future__ import annotations

from collections.abc import Iterable

from .copy_register import DEFAULT_COPY_REGISTER
from .leda_copy import leda_text

MAX_VOICE_NOTE_DURATION_SECONDS = 30
# Telegram bots may download files up to 20 MB; a 30 s Opus/OGG voice note is
# normally well under 1 MB, so this stays a generous independent safety cap,
# not the provider ceiling -- named so both channels share exactly one bound.
MAX_VOICE_NOTE_FILE_SIZE_BYTES = 5_000_000

GEMINI_TRANSCRIPTION_MODEL = "gemini-3.8-flash"
# Shorter than voice_service.SDK_TIMEOUT_MS (TTS): the input here is at most
# 30 s of audio plus a short prompt, not a long spoken answer to synthesize.
# Applied at the client-build call site (the new voice_service.py route),
# passed to gemini_credentials.create_gemini_client(secret, timeout_ms=...)
# exactly like GEMINI_VERIFY_TIMEOUT_MS is for verification -- this module
# never builds a client itself (see transcribe_voice_note's docstring).
GEMINI_TRANSCRIPTION_TIMEOUT_MS = 20_000

# F7 (live test 2026-09-25): authorized benchmark (google-genai 2.17.0,
# model gemini-3.8-flash, 5 synthesized Spanish questions) measured warm
# median 2292 ms with no generation config vs 1224 ms with thinking
# disabled/deterministic/bounded output -- identical accuracy in that
# benchmark. Transcription is a closed, short-answer task (a single spoken
# question, never open-ended generation), so no "thinking" budget or
# sampling randomness is needed. Named separately from any TTS/other
# Gemini call site's own config so they can vary independently.
GEMINI_TRANSCRIPTION_THINKING_BUDGET = 0
GEMINI_TRANSCRIPTION_TEMPERATURE = 0
GEMINI_TRANSCRIPTION_MAX_OUTPUT_TOKENS = 128

# Telegram voice notes are always OGG/Opus, but a caller may still receive a
# message without a reported mime_type; both bots and transcribe_voice_note
# itself fall back to this one named default instead of a repeated literal.
DEFAULT_VOICE_NOTE_MIME_TYPE = "audio/ogg"


def voice_note_reply(message_id: str, register: object) -> str:
    """One voice-note failure reply in a register, stating the configured duration limit where it applies."""
    return leda_text(message_id, register, max_seconds=MAX_VOICE_NOTE_DURATION_SECONDS)


DOMAIN_VOCABULARY_TERMS = (
    "lote",
    "producto",
    "receta",
    "orden",
    "cliente",
    "OEE",
    "estado",
    "actividad",
    "potencia",
    "progreso",
    "tiempo restante",
    "alertas",
)

# The failure replies sent to the user, in the default (usted) register. Both bots send the variant of the
# configured register through ``voice_note_reply``; these constants stay the usted wording for importers.
VOICE_NOTE_TOO_LONG_REPLY = voice_note_reply("voice_note_too_long", DEFAULT_COPY_REGISTER)
VOICE_NOTE_TOO_LARGE_REPLY = voice_note_reply("voice_note_too_large", DEFAULT_COPY_REGISTER)
VOICE_NOTE_DOWNLOAD_FAILED_REPLY = voice_note_reply("voice_note_download_failed", DEFAULT_COPY_REGISTER)
VOICE_NOTE_TRANSCRIPTION_EMPTY_REPLY = voice_note_reply("voice_note_transcription_empty", DEFAULT_COPY_REGISTER)
VOICE_NOTE_TRANSCRIPTION_UNAVAILABLE_REPLY = voice_note_reply(
    "voice_note_transcription_unavailable", DEFAULT_COPY_REGISTER
)


class VoiceTranscriptionError(RuntimeError):
    """Base failure for one voice-note transcription attempt."""


class VoiceNoteTooLong(VoiceTranscriptionError):
    """The reported duration is missing, invalid, or exceeds the cap."""


class VoiceNoteTooLarge(VoiceTranscriptionError):
    """The reported (or observed) file size exceeds the cap."""


class VoiceNoteDownloadFailed(VoiceTranscriptionError):
    """The audio bytes could not be retrieved from the transport."""


class VoiceTranscriptionUnavailable(VoiceTranscriptionError):
    """The transcription provider could not be reached, or failed."""


class VoiceTranscriptionEmpty(VoiceTranscriptionError):
    """The provider returned no usable transcript text."""


def validate_voice_note_duration(duration: object) -> None:
    """Raise ``VoiceNoteTooLong`` for a missing/invalid/oversize duration.

    Must be called -- and must pass -- before any download is attempted
    (user decision, 2026-09-24): Telegram already reports ``Voice.duration``
    on the update itself, so this never needs the file bytes.
    """
    if isinstance(duration, bool) or not isinstance(duration, int) or duration <= 0:
        raise VoiceNoteTooLong("VOICE_NOTE_DURATION_INVALID")
    # Telegram reports whole seconds, so a note reported as exactly the bound
    # already lasts longer than it (30.0-30.9 s for a 30 s bound).
    if duration >= MAX_VOICE_NOTE_DURATION_SECONDS:
        raise VoiceNoteTooLong("VOICE_NOTE_DURATION_EXCEEDED")


def validate_voice_note_size(file_size: object) -> None:
    """Raise ``VoiceNoteTooLarge`` for an out-of-bound reported file size.

    ``file_size`` may legitimately be ``None`` -- Telegram does not always
    report it before download -- and only a value that IS present and
    exceeds the cap is rejected here. The transport must still bound the
    actual download independently (this is a fast pre-check, not the only
    guard).
    """
    if file_size is None:
        return
    if isinstance(file_size, bool) or not isinstance(file_size, int) or file_size < 0:
        raise VoiceNoteTooLarge("VOICE_NOTE_SIZE_INVALID")
    if file_size > MAX_VOICE_NOTE_FILE_SIZE_BYTES:
        raise VoiceNoteTooLarge("VOICE_NOTE_SIZE_EXCEEDED")


def build_transcription_prompt(extra_terms: Iterable[str] = ()) -> str:
    """Build the Spanish transcription prompt, biased toward domain vocabulary.

    ``extra_terms`` lets a caller add cheaply-available context (e.g. the
    active screen's machine name) without introducing a new data source;
    non-string or blank entries are silently ignored.
    """
    terms = list(DOMAIN_VOCABULARY_TERMS)
    # A bare string is iterable character-by-character; never split one term
    # into its individual letters.
    normalized_extra_terms = (extra_terms,) if isinstance(extra_terms, str) else extra_terms
    for term in normalized_extra_terms:
        if isinstance(term, str) and term.strip():
            terms.append(term.strip())
    vocabulary = ", ".join(dict.fromkeys(terms))
    return (
        "Transcriba fielmente, en español, el audio adjunto. Es una pregunta "
        "dirigida a un asistente de una interfaz industrial de solo lectura. "
        "Favorezca el reconocimiento de estos términos de dominio cuando el "
        f"audio los mencione: {vocabulary}. Devuelva únicamente el texto "
        "transcripto de la pregunta, sin comentarios ni formato adicional."
    )


def transcribe_voice_note(
    client: object,
    audio_bytes: bytes,
    mime_type: str,
    *,
    extra_terms: Iterable[str] = (),
) -> str:
    """Transcribe one already-downloaded, already-bounded voice note.

    ``client`` is an already-built Gemini SDK client (see
    ``gemini_credentials.create_gemini_client``/``WarmGeminiClient.get``);
    this function never resolves credentials or builds a client itself,
    matching every other Gemini call site in this runtime. Raises
    ``VoiceTranscriptionUnavailable`` for any provider/network failure and
    ``VoiceTranscriptionEmpty`` when the provider returns no usable text or
    the input audio is empty -- never returns an empty/blank string.
    """
    if not isinstance(audio_bytes, (bytes, bytearray)) or not audio_bytes:
        raise VoiceTranscriptionEmpty("VOICE_NOTE_AUDIO_EMPTY")
    resolved_mime_type = mime_type if isinstance(mime_type, str) and mime_type.strip() else DEFAULT_VOICE_NOTE_MIME_TYPE
    prompt = build_transcription_prompt(extra_terms)
    try:
        import importlib

        genai = importlib.import_module("google.genai")
        part = genai.types.Part.from_bytes(data=bytes(audio_bytes), mime_type=resolved_mime_type)
        config = genai.types.GenerateContentConfig(
            thinking_config=genai.types.ThinkingConfig(thinking_budget=GEMINI_TRANSCRIPTION_THINKING_BUDGET),
            temperature=GEMINI_TRANSCRIPTION_TEMPERATURE,
            max_output_tokens=GEMINI_TRANSCRIPTION_MAX_OUTPUT_TOKENS,
        )
        response = client.models.generate_content(
            model=GEMINI_TRANSCRIPTION_MODEL,
            contents=[prompt, part],
            config=config,
        )
    except VoiceTranscriptionError:
        raise
    except Exception:
        raise VoiceTranscriptionUnavailable("VOICE_TRANSCRIPTION_UNAVAILABLE") from None
    text = getattr(response, "text", None)
    if not isinstance(text, str) or not text.strip():
        raise VoiceTranscriptionEmpty("VOICE_NOTE_TRANSCRIPT_EMPTY")
    return text.strip()
