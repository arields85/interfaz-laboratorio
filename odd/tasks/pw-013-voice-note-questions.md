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
  **Done 2026-09-24** — see Evidence below for all of V1-V6.

## Acceptance criteria

- A voice note under 30 s, from an authorized/paired chat, on either channel, is answered exactly
  as the equivalent typed text would be, with no transcript echo.
- A voice note over 30 s is rejected (short formal-usted reply) **before** any `getFile`/download.
- A download or provider failure, or an empty/unintelligible transcript, replies with a short
  formal-usted message and never crashes the poll loop or blocks other chats on other channels/bots.
- Runtime suite green: **1686/1686** (baseline 1576 + 110 new), modulo the 2 known pre-existing
  worktree-env failures (unrelated, not touched).
- Live test by the user pending (voice notes require a real Telegram client and a real Gemini key;
  not exercised by this task — see V7 below).

### Open architecture note: "must not block other chats" (decision gap, reported not silently resolved)

Transcription (download + Gemini call) runs **synchronously** inside each bot's own message
handler, on that bot's own dedicated poll thread — not dispatched to a background worker the way
Channel B's voice-note **reply** (TTS, PW-012/B1) already is. This was a deliberate scope decision,
not an oversight:

- Channel A's poll loop (`channel_a_lifecycle.py`'s `_process_batch`) requires `handle_update` to
  return a fully-formed `IngressOutcome` **synchronously**, and its `on_outcome` callback
  (`channel_a_on_outcome` in `local_presentation.py`) reads `outcome.answer_envelope` immediately
  after, in the same iteration, to publish the HMI voice event. Deferring the whole
  transcribe→answer sequence to a background thread would mean returning a placeholder outcome with
  no envelope, and publishing the real one later through a different, currently-nonexistent path —
  a materially larger redesign than this task's authorized scope (widen the transport minimally,
  route through the existing query coordinator).
- Given that constraint, both channels transcribe synchronously. This means a voice note on a given
  bot **does** delay that same bot's processing of the *next* queued update in the same `getUpdates`
  batch (bounded by `VOICE_TRANSCRIPTION_REQUEST_TIMEOUT_SECONDS = 25` s plus download time) — the
  same category of latency a slow answer already has today, just larger. It does **not** block the
  other channel, the other bot, or the HTTP/admin server: each already runs on its own thread/
  process, unchanged by this task.
- This satisfies "never crash the poll loop" and "never block other channels/bots" exactly as
  stated, but does **not** achieve "instant return to the same bot's own next queued update" the
  way PW-012's voice-*reply* queue does for TTS. Flagging this explicitly rather than silently
  calling the weaker guarantee "the same thing" — if same-bot concurrency during transcription turns
  out to matter in practice (V7 live test), it is a separate, larger follow-up (a queue/background
  design symmetric to B1b, plus a way to defer Channel A's envelope publish), not something to
  quietly fold into this task after the fact.

- [x] **V7 — Live verification (user).** Send a voice note under 30 s to each bot (the Channel A
  dedicated/QR bot and the Channel B personal bot) with the HMI showing a dashboard: the answer must
  arrive exactly as if the question had been typed, with no transcript echo. Then a voice note over
  30 s (rejected before download) and, if convenient, one in a noisy/unclear recording (empty-
  transcript reply). Parent checks the runtime logs for errors and confirms the model id in
  Evidence really is a valid, reachable Gemini model (`GEMINI_TRANSCRIPTION_MODEL` in
  `voice_transcription.py`) — **not verified by this task, no live provider call was made.**
  **Done 2026-09-25 ~09:54-09:59** — see Evidence below.

## Model id decision (needs user/parent confirmation before live use)

`GEMINI_TRANSCRIPTION_MODEL = "gemini-3.8-flash"` (`voice_transcription.py`). Reasoning: the only
Gemini model already used in this runtime, `gemini-3.8-flash-lite-tts`
(`voice_service.TTS_MODEL`/`gemini_credentials.GEMINI_VERIFY_MODEL`), is speech-*generation*-only
(TTS); transcription needs a general multimodal model that accepts inline audio for understanding,
so the "-lite-tts" suffix was dropped, keeping the same version family as the rest of this runtime's
Gemini usage. This is a **named-constant assumption, not verified against a live model listing** —
no provider call is authorized by this task. If this id is wrong, the failure mode is safe: every
call site (`voice_service.py`'s new route) catches the resulting provider error as
`VoiceTranscriptionUnavailable` and replies with the fixed "servicio de voz no disponible" message —
it will not crash, but voice-note questions will not work until the id is corrected.

## Evidence

- **Baseline verified 2026-09-24** (before any change): `unittest discover` → **1576 tests, 2
  pre-existing failures (worktree-local `.venv` missing, expected — see below), 2 skipped**.
- **Final verified 2026-09-24** (after all tasks): same command → **1686 tests, the same 2
  pre-existing failures, 2 skipped** (110 new tests added; no regression).
- **The 2 pre-existing failures** (`test_python_environment.py::test_real_missing_import_is_
  normalized_to_bootstrap_remedy_under_stop_preference`, `test_runtime_safety.py::
  test_cancellation_during_voice_startup_rolls_back_only_the_launched_child`) both fail because this
  worktree has no `.venv` under `services/prisma-runtime/` of its own — they spawn a subprocess with
  the repository-owned interpreter path, which only exists in the main checkout. Pre-existing,
  unrelated to this task, not touched.

### V1 — shared transcription module (`voice_transcription.py`, `tests/test_voice_transcription.py`)

- Constants: `MAX_VOICE_NOTE_DURATION_SECONDS = 30`, `MAX_VOICE_NOTE_FILE_SIZE_BYTES = 5_000_000`
  (independent safety cap, well under Telegram's 20 MB bot-download ceiling),
  `GEMINI_TRANSCRIPTION_MODEL` (see decision above), `GEMINI_TRANSCRIPTION_TIMEOUT_MS = 20_000`
  (applied at the client-build call site in `voice_service.py`, like `GEMINI_VERIFY_TIMEOUT_MS`),
  `DEFAULT_VOICE_NOTE_MIME_TYPE = "audio/ogg"`, `DOMAIN_VOCABULARY_TERMS` (lote, producto, receta,
  orden, cliente, OEE, estado, actividad, potencia, progreso, tiempo restante, alertas).
- `transcribe_voice_note(client, audio_bytes, mime_type, extra_terms=())`: never resolves credentials
  or builds a client (matches every other Gemini call site — the caller passes an already-built
  client); calls `client.models.generate_content(model=GEMINI_TRANSCRIPTION_MODEL, contents=[prompt,
  Part.from_bytes(...)])`; raises `VoiceTranscriptionEmpty` for empty input or an empty/blank
  response, `VoiceTranscriptionUnavailable` for any other provider/network failure.
- Exact new Spanish copy (all formal usted, verified by `SpanishCopyTests`):
  - `VOICE_NOTE_TOO_LONG_REPLY` = "La nota de voz dura más de 30 segundos. Por favor, envíe una nota
    más breve." (the "30" is f-string-interpolated from the constant, not a duplicated literal).
  - `VOICE_NOTE_TOO_LARGE_REPLY` = "La nota de voz es demasiado pesada. Por favor, envíe una nota más
    breve."
  - `VOICE_NOTE_DOWNLOAD_FAILED_REPLY` = "No se pudo descargar su nota de voz. Intente nuevamente."
  - `VOICE_NOTE_TRANSCRIPTION_EMPTY_REPLY` = "No se pudo entender la nota de voz. Intente nuevamente
    o escriba su pregunta."
  - `VOICE_NOTE_TRANSCRIPTION_UNAVAILABLE_REPLY` = "El servicio de voz no está disponible en este
    momento. Intente nuevamente en unos minutos o escriba su pregunta."
- RED evidence: `ImportError: cannot import name 'voice_transcription'` on the first test run (module
  did not exist yet). Implemented, then 18/18 green. GGA pre-commit review caught a real anti-hardcode
  violation (the "30 segundos" literal duplicating the constant) and a weak voseo test-marker set;
  both fixed with new/updated tests before commit `4517a94`. A follow-up fix (`c6897f7`) closed a
  real bug both this module and `voice_events.py` shared: a bare `extra_terms` string would be split
  character-by-character instead of treated as one term.
- Commits: `4517a94`, `c6897f7` (shared with V2).

### V2 — voice-transcription bearer token table (`voice_events.py`, `tests/test_voice_event_delivery.py`)

- `mint_voice_transcription_token(audio_base64, mime_type, extra_terms=())` /
  `resolve_voice_transcription_token(token)`: single-use (popped on resolve), own TTL (60 s) and
  capacity (64), a fully separate table (`_voice_transcription_tokens`) that never touches
  `_events`/`_latest` — mirrors `mint_channel_b_reply_token`'s existing discipline exactly.
- RED evidence: `AttributeError: 'VoiceEventStore' object has no attribute
  'mint_voice_transcription_token'` (and `resolve_...`) on all 9 new tests. Implemented, then 9/9
  green (48/48 for the whole file).
- Commits: `b3a1f7f`, `c6897f7`.

### V3 — internal transcription routes (`voice_service.py`, `local_presentation.py`, tests)

- Direction/architecture decision: unlike Channel B's fire-and-forget voice-**reply** route (B1),
  this call is synchronous — presentation needs the transcript back to keep answering. Presentation
  downloads/bounds the audio, mints a token (`mint_voice_transcription_token`), POSTs it (bearer-only
  body) to voice's new `POST /internal/prisma/voice-transcription`; voice resolves it back via one
  loopback `GET /internal/prisma/voice-transcription` on presentation
  (`_resolve_voice_transcription_payload`), decodes the audio, calls `get_gemini_client()` +
  `transcribe_voice_note(...)`, and returns `{"ok": true, "transcript": "..."}` directly in the
  original POST's response (`voice_transcription()` route) — presentation's own
  `_request_voice_transcription(local_http, voice_url, token)` helper parses that response and maps
  422/other-non-200/network-error to `VoiceTranscriptionEmpty`/`VoiceTranscriptionUnavailable`.
- `_VOICE_TRANSCRIPTION_MAX_AUDIO_BASE64_CHARS` bounds the resolve GET's body, sized off
  `MAX_VOICE_NOTE_FILE_SIZE_BYTES` (~4/3 base64 expansion + margin).
- The new presentation route was added to the existing `Cache-Control: no-store` set in
  `add_local_cors` (GGA caught this was missing on first commit — fixed in `171eb04`, with a new
  test; the pre-existing `/internal/prisma/channel-b/voice-reply` route still lacks it, left
  unchanged — out of this task's authorized scope).
- RED evidence: 10 new/changed test failures across `test_voice_service.py` (`AttributeError`/404 —
  route and helper functions did not exist) and `test_local_presentation.py` (404 on the new GET
  route). Implemented, then green: `test_voice_service.py` 72/72, `test_local_presentation.py` 49/49
  (then 50/50 after the no-store fix).
- Commits: `102ea8f`, `171eb04`.

### V4 — Channel A integration (transport, bot, activation, production wiring)

- **V4a — `channel_a_transport.py`** (`tests/test_channel_a_transport.py`): `get_file(file_id=...)`
  (calls Telegram `getFile`, returns the validated `file_path`) and
  `download_file(file_path=..., max_bytes=...)` (bounded streaming GET against
  `CHANNEL_A_FILE_BASE = "https://api.telegram.org/file"`, never the JSON Bot API host; rejects a
  non-2xx status, an over-bound response, or a `file_path` containing a `..` segment, all before any
  network I/O for the invalid-input cases). RED: 20 `AttributeError`s (`download_file` did not
  exist). Green: 95/95. Two GGA-caught follow-ups fixed: stale module/exception docstrings undercounting
  the call surface (`13e924f`), and `get_file` not reusing the same path validator as `download_file`
  (`7a88808`).
- **V4b — `channel_a_bot.py`** (`tests/test_channel_a_bot.py`): `ChannelATextTransport` protocol
  widened with optional `get_file`/`download_file` (8 calls total, was 6); `enable_voice_notes(
  transcribe=...)` (requires `enable_queries` already attached; validates `transcribe` is callable
  and the transport actually has `get_file`/`download_file`); `_handle_voice_note` — phone-to-owner
  authorization (`_record_for_phone`, the exact gate `_handle_query` uses) runs **before** any
  duration/size check or download; duration/size validated next; then `get_file`/`download_file`;
  then `transcribe`; the resulting transcript is passed to the existing `_handle_query`, so a voice
  note gets exactly the same binding/freshness/answer/envelope treatment as typed text. New
  `IngressOutcome` kinds: `VOICE_NOTE_REJECTED`, `VOICE_NOTE_DOWNLOAD_FAILED`,
  `VOICE_NOTE_TRANSCRIPTION_FAILED`. RED: `ImportError` for the new constants (implementation and
  this file's tests were written in the same pass rather than strictly test-first — confirmed
  genuinely RED by temporarily stashing the source file: `AttributeError`/`ImportError` on every new
  test). Green: 249/249 (later 251/251). Three GGA-caught follow-ups: a docstring accidentally
  tripped `test_module_never_reads_environment_logging_or_credentials` (contained the substring
  "credential" — reworded, `df3880a`); an unexpected (non-`VoiceTranscriptionError`) exception from
  the injected `transcribe` callable could have escaped `_handle_voice_note` and crashed the poll
  loop — now caught by a broad `except Exception` with the same generic reply (`048ece2`, with a new
  regression test); `enable_voice_notes` now also validates the transport actually exposes
  `get_file`/`download_file` before attaching, instead of only failing at first use.
- **V4c — `channel_a_activation.py`** (`tests/test_channel_a_activation.py`): `ChannelAActivation`
  gained an optional `transcribe=None` parameter, threaded into `dialogue.enable_voice_notes(...)`
  only when supplied — every existing caller/test is unaffected (backward-compatible default). RED:
  `TypeError: unexpected keyword argument 'transcribe'` on the new end-to-end test (confirmed by
  temporarily reverting the production file). Green: 34/34, including one full real-composition
  test (mint→download→transcribe→answer through `ChannelAActivation.poll_once()`) and one proving
  the without-`transcribe` fallback never downloads anything.
- **V4d — `local_presentation.py` `build_channel_a_activation`** (`tests/test_runtime_safety.py`):
  `channel_a_transcribe(audio_bytes, mime_type)` closure — base64-encodes the audio, mints a
  transcription token, calls `_request_voice_transcription`; raises
  `VoiceTranscriptionUnavailable` if `voice_url`/`local_http` are unset. No per-owner context terms
  are added to Channel A's prompt (unlike Channel B) — a deliberate scope decision to avoid a second,
  unguarded read of the owner's HMI context outside `ChannelAQueryCoordinator`'s own binding/
  freshness discipline; the static domain vocabulary still applies. RED: `KeyError: 'transcribe'` on
  the new production-wiring test (confirmed by temporarily reverting the file). Green: new test
  passes; full suite unaffected.
- Commits: `3aeafc6`, `13e924f`, `7a88808`, `70138db`, `df3880a`, `048ece2`, `95c0e27`, `8bc4ab5`,
  `18d18d8`.

### V5 — Channel B integration (`local_presentation.py` `TelegramLocalBot`, `tests/test_telegram_lifecycle.py`)

- `_handle_message` restructured: `has_text`/`has_voice` replace the old `not isinstance(text, str):
  return` early exit; the `/start` and pairing-check branches are unchanged and still run **before**
  a voice note is ever downloaded (an unpaired chat gets the existing "Envíe /start" reply, no
  download); a voice note's transcript then simply replaces `text` and falls through to the
  unchanged `/status`/`/help`/answer logic — so a transcribed question also still triggers the
  existing PW-012 voice-reply pipeline (`_request_channel_b_voice_reply`) automatically, with no new
  code needed for that.
- `_transcribe_voice_note`: same duration/size-before-download discipline as Channel A;
  `_download_voice_file` does a bounded streaming download via this bot's own owned `self.session`
  against `{api_base}/file/bot{token}/{file_path}` (rejects a `..` path segment and any response
  over `MAX_VOICE_NOTE_FILE_SIZE_BYTES`); `_voice_note_domain_terms` cheaply reuses
  `_active_snapshot()`'s `machine.name`/`screen.ownerNodeName` as the one extra transcription hint
  (no new data source).
- RED evidence: all 9 new tests failed (0 calls to `send_message` — the voice note was silently
  dropped by the pre-existing `not isinstance(text, str): return` guard). Implemented, then 9/9
  green (65/65 for the whole file). A GGA-caught follow-up (`e4de079`) fixed a real bug: an empty
  (0-byte) download would have let `mint_voice_transcription_token`'s `ValueError` escape uncaught
  from the original code (the mint call sat outside any `try`), which would have broken the caller's
  update-offset bookkeeping and reprocessed the same update forever — fixed by moving the mint call
  inside the same `try` as the transcription request and adding an explicit empty-download check;
  new regression test `test_an_empty_downloaded_file_replies_and_never_raises` (66/66 green after).
- Commits: `9bd03c9`, `be15b9f`, `e4de079`.

### V6 — documentation (`docs/prisma/PRISMA_DOCUMENTO_MAESTRO.md`)

- §1.1 rows "Canal A — QR/status y panel manual" and "Canal B — Telegram autónomo": both now note
  voice-note questions are implemented offline as of 2026-09-24 (PW-013), live test pending.
  §6.2 gained a new "Preguntas por nota de voz" clarification block (Channel A's dedicated bot,
  distinct from the still-pending in-HMI-browser microphone row, which this task does **not**
  touch). §6.3 gained the matching clarification block for Channel B and updated its opening
  paragraph (dropped the forward-looking "(y, en PW-013, notas de voz)" phrasing now that it is
  implemented).
- Commit: `574be18`.

## Evidence (V7, live verification, 2026-09-25 ~09:54-09:59, follow-up 2026-09-27)

Voice-note questions passed on both channels: transcription in 1-3 s; Channel B answered with text
plus a voice note, Channel A answered with the orb plus voice. Notes over 30 s are rejected before
download. `GEMINI_TRANSCRIPTION_MODEL` confirmed reachable in production use.

2026-09-27 follow-up: a note Telegram reported as exactly 0:30 was accepted and got an unrelated
keyword answer — fixed on `main` `c782287` (duration `>= 30` now rejected; Telegram reports whole
seconds, so an exact-30 note was previously let through). Unrelated answers to long/rambling
transcripts are a keyword-parser limitation, deferred to PW-003 by the user (not part of this task).

## Progress

- 2026-09-24: read-only investigation complete (transports, bots, Gemini credential/TTS wiring,
  existing Channel B voice-reply token pattern); architecture decided; feature document created.
- 2026-09-24: V1 through V6 implemented and verified (strict TDD; see Evidence above). Runtime suite
  1686/1686 green modulo the 2 known pre-existing worktree-`.venv` failures. `hmi-app` untouched, no
  HMI checks run (backend-only task).

## Next step

Closed for this task's scope; V7 live verification passed 2026-09-25/2026-09-27 (see Evidence
above). The unrelated-answer keyword-parser limitation on long/rambling transcripts remains open,
tracked under PW-003.

## Integration

Rebased onto `fix/pw-011-prisma-minor-followups` (main + PW-011), using
`git rebase --onto fix/pw-011-prisma-minor-followups 7da1131` so only PW-013's own 20 commits
(everything after `7da1131`) replayed — the Channel B commits already present on `main` were not
re-applied. New tip: `51dd0eb`.

One conflicting commit: `95c0e27` (`feat(prisma-voice-notes): thread transcribe through
ChannelAActivation (V4c)`), touching:
- `services/prisma-runtime/src/prisma_runtime/channel_a_activation.py` — both sides added a new
  keyword-only constructor parameter (PW-011's `sweep_interval_seconds`/`sweep_timer_factory` for
  the periodic housekeeping sweep, PW-013's `transcribe` for voice-note transcription). Resolved by
  keeping all three parameters.
- `services/prisma-runtime/tests/test_channel_a_activation.py` — the `activate()` test helper had
  the same two-sided parameter addition (`sweep_timer_factory` vs `transcribe`). Resolved by keeping
  both parameters on the helper signature and forwarding both to the real constructor call.

No other files conflicted. Spot-checked the files called out as merge-risk in the integration
instructions even though git reported no conflict on them: `channel_a_bot.py` (PW-011's `_typing`
`threading.Event`/sweep-skip plumbing and HMI label fallback both present alongside PW-013's
`_handle_voice_note`/`enable_voice_notes`), `local_presentation.py` (main's Channel B
active-screen/FIFO voice-reply queue and PW-013's `_transcribe_voice_note` path both present), and
`channel_a_query.py` (PW-011's `resolve_label` dependency intact; PW-013 added no test construction
that omitted it, so no test update was needed there).

Checks after rebase:
- Runtime suite (`python -m unittest discover -s services/prisma-runtime -p "test_*.py"`): 1730
  tests, 2 failures, 2 skipped. Same known environment-only cases as PW-011 (worktree-local `.venv`
  missing), not caused by the rebase.
- hmi-app: `node_modules` was missing in this worktree, ran `npm ci` first (343 packages).
- hmi-app `npx vitest run`: 221 test files, 2551 tests, all passed.
- hmi-app `npx tsc -b`: clean, no output.
- hmi-app `npm run lint`: clean, no findings.

`feat/pw-013-voice-note-questions` is confirmed a descendant of `fix/pw-011-prisma-minor-followups`
(`git merge-base --is-ancestor fix/pw-011-prisma-minor-followups HEAD` succeeds), which is itself a
descendant of `main`.
