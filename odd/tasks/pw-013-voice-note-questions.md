# PW-013 — voice-note questions on both channels — ODD feature document

> ODD feature task (not SDD). Created 2026-09-24. Index row: PW-013 (`docs/PENDING_WORK.md`,
> `docs/prisma/PRISMA_DOCUMENTO_MAESTRO.md` §6.3). Branch `feat/pw-013-voice-note-questions` from
> `feat/prisma-channel-b-voice-replies` at `7da1131` (already contains B1/B1c/B1b Channel B voice
> replies). Worktree: `D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\pw-013`.

## Objective

A person can ask Prisma a question by sending a Telegram voice note, on **both** channels (A —
dedicated HMI bot — and B — personal remote bot), instead of only typing. The note is transcribed
and answered exactly as if the transcript had been typed: no echo of the transcript is sent back,
and the answer goes through the same downstream path typed text already uses on each channel
(Channel A: `_handle_query`/`ChannelAQueryCoordinator`; Channel B: `answer_from_snapshot` +
existing text/voice-reply delivery).

## User decisions (2026-09-24)

- STT with Gemini, using the existing client/credential infrastructure (`gemini_credentials.py`,
  `WarmGeminiClient`). No new dependency, no local/offline fallback.
- No echo of the transcript: the transcript is used directly as the question text; the person only
  ever sees the answer (and, on Channel B, its voice reply, unchanged from PW-012).
- Max voice-note duration 30 s. Duration (`Voice.duration`, present in the update) is checked and
  rejected **before** calling `getFile`/downloading anything, with a short formal-usted reply. File
  size is also bounded (a named constant, independent safety cap under Telegram's 20 MB bot-download
  ceiling).
- Both channels. Authorization/pairing must run **before** any download: Channel A's existing
  phone-to-owner binding check (`_record_for_phone`, the same gate `_handle_query` already uses);
  Channel B's existing single-paired-chat check.
- Transcription is biased toward HMI domain vocabulary via the prompt (lote, producto, receta,
  orden, cliente, OEE, estado, actividad, potencia, progreso, tiempo restante, alertas), plus, on
  Channel B only, the active screen's machine/screen name when cheaply available from the context
  already read for `answer_from_snapshot` (no new data source). Channel A does not add per-owner
  context terms to the prompt (see Evidence — avoids a second unguarded context read outside the
  query coordinator's own binding/freshness discipline; the static vocabulary still applies).
- Failures (provider down, empty/unintelligible transcript, download error) always reply with a
  short formal-usted message, logged with secrets redacted; never silent; never crash the poll loop;
  must not block other chats/channels (see Evidence — architecture note on what "off the receive
  loop" means in this codebase, and what was and was not achieved for the same-channel case).

## Architecture

- `services/prisma-runtime/src/prisma_runtime/voice_transcription.py` (new, shared by both bots):
  duration/size limits, the domain-vocabulary prompt builder, the `transcribe_voice_note(client,
  audio_bytes, mime_type, extra_terms=...)` Gemini call, the closed exception hierarchy, and the
  Spanish user-facing failure copy.
- Download is transport-specific: Channel A gets `get_file`/`download_file` added to
  `ChannelATransport` (`channel_a_transport.py`) and the `ChannelATextTransport` protocol; Channel B
  reuses its own existing `requests.Session`/`_call` in `TelegramLocalBot`.
- The actual Gemini call happens in the voice process (5056, where `WarmGeminiClient`/
  `GeminiCredentialResolver` already live), never in the presentation process (5057, where both
  bots run) — mirrors the existing Channel B voice-**reply** design (B1): presentation mints a
  single-use bearer token (new `VoiceEventStore` table, `mint_voice_transcription_token`/
  `resolve_voice_transcription_token`), POSTs it to a new voice-process route
  (`/internal/prisma/voice-transcription`), which resolves the token back via one loopback GET to a
  new presentation-process route of the same name, decodes the audio, calls Gemini, and returns the
  transcript **synchronously** in the POST response (unlike B1's fire-and-forget voice-reply route,
  this call's caller needs the transcript back to continue answering).

## TDD

- Mode: **strict TDD enabled** (source: session configuration "Strict TDD Mode: enabled").
- Runner (from the worktree, using the main checkout's interpreter):
  `D:\Proyectos\Interfaz-HMI\Interfaz-HMI\services\prisma-runtime\.venv\Scripts\python.exe -m
  unittest discover -s services/prisma-runtime -p "test_*.py"`. Baseline verified 2026-09-24:
  **1576 tests, 2 pre-existing failures (worktree-local `.venv` missing — expected, reported
  separately, not touched by this task), 2 skipped.**
- HMI suite only if `hmi-app` is touched (not expected for this backend-only task).

## Tasks

- [x] **V1 — Shared transcription module.** `voice_transcription.py`: limits, prompt builder,
  `transcribe_voice_note`, exceptions, Spanish copy. Fakes only (fake Gemini client). Route: direct
  inline (single new file, no cross-file coordination needed for this unit alone).
- [x] **V2 — Voice-event token table.** `voice_events.py`: `mint_voice_transcription_token`/
  `resolve_voice_transcription_token` (single-use, own TTL/capacity, mirrors
  `mint_channel_b_reply_token`). Route: direct inline.
- [x] **V3 — Internal transcription routes.** New route on voice (5056):
  `POST /internal/prisma/voice-transcription`. New route on presentation (5057):
  `GET /internal/prisma/voice-transcription`. Plus the presentation-side synchronous request helper.
  Route: delegated writer (multi-file: `voice_service.py`, `local_presentation.py`, tests).
- [x] **V4 — Channel A integration.** `channel_a_transport.py` (`get_file`/`download_file`),
  `channel_a_bot.py` (`enable_voice_notes`, `_handle_voice_note`, protocol widening),
  `channel_a_activation.py` (thread `transcribe` through), `local_presentation.py`
  (`build_channel_a_activation` wiring). Route: delegated writer (multi-file).
- [x] **V5 — Channel B integration.** `local_presentation.py` (`TelegramLocalBot._handle_message`
  voice branch, `_transcribe_voice_note`). Route: delegated writer (same pass as V3/V4 — one writer
  thread, not re-delegated per file).
- [x] **V6 — Documentation.** `docs/prisma/PRISMA_DOCUMENTO_MAESTRO.md` §1/§1.1/§6.3 updated to say
  both channels now receive voice-note questions. Route: inline.

## Acceptance criteria

- A voice note under 30 s, from an authorized/paired chat, on either channel, is answered exactly
  as the equivalent typed text would be, with no transcript echo.
- A voice note over 30 s is rejected (short formal-usted reply) **before** any `getFile`/download.
- A download or provider failure, or an empty/unintelligible transcript, replies with a short
  formal-usted message and never crashes the poll loop or blocks other chats on other channels/bots.
- Runtime suite green (baseline + new tests, modulo the 2 known pre-existing env failures).
- Live test by the user pending (voice notes require a real Telegram client and a real Gemini key;
  not exercised by this task — see B3-style "Live verification" note below).

## Evidence

(filled in per task as implemented — see below)

## Progress

- 2026-09-24: read-only investigation complete (transports, bots, Gemini credential/TTS wiring,
  existing Channel B voice-reply token pattern); architecture decided; feature document created.

## Next step

Implement V1 (shared module) first with its own tests, then V2, then V3+V4+V5 as one delegated
writer pass (they share the same internal-route/token wiring), then V6 docs, then final live-test
note for the user (B-style "Next step").
