# Prisma Channel B voice replies — ODD feature document

> ODD feature task (not SDD). Created 2026-09-24. Index row: PW-012 (`docs/PENDING_WORK.md`).
> Engram: decisions `backlog/prisma-channel-b`, findings `backlog/prisma-channel-b-findings`,
> tracker mirror `odd/prisma-channel-b-voice-replies/tasks` (project `interfaz-laboratorio`).

## Objective

A person using Channel B (the dedicated, personal Telegram bot for remote queries) receives every
answer as the current text message **plus a voice note in the same chat**, produced by the runtime
on its own — without any HMI browser open and without anything playing or showing on the HMI.

## Product definition (user, 2026-09-24)

- **Channel B = remote personal Telegram.** The person already has access to the dedicated bot
  (`@Interfaz_hmi_bot`); there is no HMI/QR pairing (QR belongs to Channel A only). The existing
  single-paired-chat admission stays as is (master doc, clarification 2.0.12).
- **Never on the HMI:** no orb, no HMI voice, no navigation, no HMI events. The audio goes to
  Telegram because the person is remote and can neither see nor hear the HMI.
- **Receives:** text today; voice notes later (PW-013, both channels).
- **Responds:** text today; **text + voice note — this feature**.
- **Data source (provisional):** answers from the snapshot currently shown on the HMI screen, as
  before the migration. The own data source (semantic query service,
  `docs/prisma/PRISMA_SEMANTIC_QUERY_SERVICE.md`, PW-003) will later serve both channels.
- This updates the master document §6.3 ("recibe texto y responde texto"): task B2.

## Evidence (read-only investigation 2026-09-24, verified by the parent)

- Channel B bot today: `TelegramLocalBot` (`services/prisma-runtime/src/prisma_runtime/local_presentation.py:483`),
  `/start` single-chat pairing, answers `answer_from_snapshot(...)` as text only (`:743`).
- The Telegram voice pipeline already exists in the voice process
  (`services/prisma-runtime/src/prisma_runtime/voice_service.py`): `TelegramOpusStreamEncoder` (`:110`,
  in-memory ffmpeg OGG/Opus, bundled `imageio_ffmpeg` fallback `:159-161`), delivery fallback
  `sendVoice` → `sendDocument(ogg)` → `sendDocument(wav)` (`:212-228`), typing action, and
  `_create_interactions_tts_job(text, event_id, telegram_chat_id, voice_config)` (`:611`). It is
  unreachable today: the browser-facing `/local/ask` rejects `telegramChatId`
  (`local_presentation.py:1270`) — that rejection stays for the browser route.
- Old system (`C:\hmi_tts`) — **not to copy:** audio was only produced if an HMI browser was open
  and polling (browser round trip), text and audio were uncorrelated, PATH-only ffmpeg, voseo copy,
  flat allowlist. **Worth keeping (already ported):** same answer text for text and speech, the
  in-memory encoder, the delivery fallback chain, the chat action while synthesizing.

## Scope and constraints

- In scope: Channel B replies (text unchanged + voice note), server-side, and the master doc update.
- Out of scope: voice-note questions (PW-013), own data source (PW-003), Channel A behavior,
  widening Channel B admission, PW-009 (answers mixing machines — affects both channels, separate).
- The text answer must never be delayed or lost because of the audio: synthesis runs off the bot's
  receive loop, bounded (one in flight per chat or a small bounded queue), with timeouts; an audio
  failure is logged (redacted) and never produces an error reply storm.
- The voice note is sent as a reply to the user's question message, so text and audio stay
  visually paired even with overlapping questions.
- Same Prisma voice (shared voice configuration, including effects) as the HMI voice.
- Read-only rule unaffected; secrets never logged; any new user-facing Spanish copy in formal usted.
- Internal call between the presentation and voice processes must reuse the existing internal
  authentication pattern (the way Channel A's outcome path already calls the voice service), not a
  new unauthenticated route; the browser-facing `/local/ask` keeps rejecting `telegramChatId`.

## TDD

- Mode: **strict TDD enabled** (source: session configuration "Strict TDD Mode: enabled").
- Runner: `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s services\prisma-runtime -p "test_*.py"`
  (baseline 1532 OK). HMI suite only if `hmi-app` is touched (`cd hmi-app && npx vitest run`).

## Delivery

- Branch `feat/prisma-channel-b-voice-replies` from `main` (`731512c`). Forecast ~300–400 authored
  changed lines. Standing user decision: integrate into local `main` by fast-forward, no push/PRs.
- RDD: off (global).

## Tasks

- [x] **B1 — Channel B voice-note replies.** After `TelegramLocalBot` sends the text answer, request
  a voice note for the same answer text and chat from the voice process (existing TTS + Opus +
  delivery pipeline), as a reply to the question message, with the "recording/typing" chat action
  while it is produced. Non-blocking for the receive loop, bounded, with timeouts; failures logged
  and silent to the user. Channel B never publishes HMI voice events. Tests in the runtime suite
  (bot → voice request wiring, reply-to id, failure isolation, no HMI event, `/local/ask` still
  rejects `telegramChatId`). Route: delegated writer (multi-file across `local_presentation.py`,
  `voice_service.py` and tests). **Done 2026-09-24** — see Evidence below.
- [ ] **B2 — Documentation.** Update `docs/prisma/PRISMA_DOCUMENTO_MAESTRO.md` §1 table and §6.3
  with the user's Channel B definition (remote personal, receives text now and voice notes later,
  responds text + voice note in Telegram, never on the HMI, provisional screen-snapshot source) and
  point to PW-012/PW-013/PW-003. Route: inline.
- [ ] **B3 — Live verification (user).** With the HMI showing a dashboard, ask the Channel B bot a
  few questions: the text answer arrives as today, then a voice note replying to the same question
  with Prisma's voice; nothing plays or shows on the HMI; overlapping questions keep their audio
  paired. Parent checks the runtime logs for errors.

## Acceptance criteria

- Every Channel B answer: text first (no added delay), then a voice note replying to the question.
- No HMI voice event, orb or audio is ever triggered by Channel B.
- Audio failures never block or duplicate the text answer and never spam the chat.
- Runtime suite green; any touched HMI checks green; live test passes.

## Evidence (B1, delegated writer, 2026-09-24)

- Files: `services/prisma-runtime/src/prisma_runtime/voice_events.py` (new `_channel_b_reply_tokens`
  table + `mint_channel_b_reply_token`/`resolve_channel_b_reply_token`, single-use, own TTL/capacity,
  never touches `_events`/`_latest`), `local_presentation.py` (`TelegramLocalBot.voice_url`/
  `local_http`, `_request_channel_b_voice_reply` with a per-chat in-flight guard,
  `_fire_channel_b_voice_reply`, new `GET /internal/prisma/channel-b/voice-reply` resolve route, wired
  into the production `TelegramLifecycleManager` factory), `voice_service.py`
  (`_resolve_channel_b_voice_reply_payload`, `_deliver_channel_b_voice_reply`, new
  `POST /internal/prisma/channel-b/telegram-voice-reply` route, `telegram_reply_to_message_id` threaded
  through `_create_interactions_tts_job` and `_send_same_prisma_audio_to_telegram`).
- Internal call/auth reuse decision: Channel A's `channel_a_on_outcome` reuses the shared
  `voice_events` store (mint a short-lived prefetch token bound to a *published* HMI voice event,
  forwarded as the existing `X-Prisma-Session-Capability` header, resolved back on the presentation
  process). Channel B has no HMI owner and must never publish through that store (`_events`/`_latest`
  feed `/hmi/voice/latest`, the SSE stream and the orb), so B1 mirrors the *pattern* — a random
  `secrets.token_urlsafe(32)` bearer token, carried in the same header, resolved via one loopback HTTP
  round trip back to presentation — against a **new, fully separate token table** on the same
  `VoiceEventStore` instance instead of the shared event store. The token is single-use (popped on
  resolve) since Channel B synthesizes and delivers exactly once, unlike the reusable prefetch token
  Channel A needs for `AudioCoordinator`'s two-time admission/dequeue revalidation. `/local/ask` keeps
  rejecting `telegramChatId` unchanged; no new unauthenticated route was added.
- Reply-to: `message.get("message_id")` from the incoming Telegram update is threaded through the
  mint token → `_resolve_channel_b_voice_reply_payload` → `_create_interactions_tts_job(
  telegram_reply_to_message_id=...)` → `job["telegram_reply_to_message_id"]`, included as
  `reply_to_message_id` in the `sendVoice`/`sendDocument` form data only when present (omitted, not
  null, for every other caller).
- Chat action: reused as-is. `_create_interactions_tts_job` already starts
  `_start_telegram_recording_indicator`, which sends `record_voice` (not generic `typing`) whenever a
  valid Telegram chat id is attached — accurate for a voice note, so B1 needed no change here.
- Concurrency/timeout: at most one voice request in flight per chat id (`TelegramLocalBot.
  _channel_b_voice_in_flight`, a synchronous check-and-reserve before spawning the background worker);
  a second overlapping question for the same chat is dropped (logged), not queued — Channel B is a
  single paired human, so losing an occasional voice note under overlap beats an unbounded queue or
  delaying the receive loop. `CHANNEL_B_VOICE_REPLY_TIMEOUT_SECONDS = 45` bounds the presentation →
  voice-process HTTP call (covers the full Gemini TTS + Opus encode + Telegram upload synchronously).
  A mint/dispatch/synthesis failure is caught, logged with no answer text/chat id/token, and never
  reaches the chat or the already-sent text answer.
- Voice config: no explicit `voice_config` passed for Channel B — `_create_interactions_tts_job`
  already defaults to `prisma_voice_config_store.get()` (the same store the HMI's own TTS jobs read),
  so Channel B automatically gets the same voice and effects.
- Informational replies (`/start`, `/status`, `/help`) never trigger a voice request: the call site is
  only reached from `_handle_message`'s final `answer_from_snapshot` branch, after every earlier
  `return`.
- RED evidence: added 24 tests across `test_voice_event_delivery.py` (7, token mint/resolve/TTL/
  single-use/no-shared-store), `test_local_presentation.py` (2, new resolve route), `test_telegram_
  lifecycle.py` (6, bot-level wiring/concurrency/failure-isolation/no-HMI-event), `test_voice_service.py`
  (9, new route/reply-to threading/payload validation), then ran the full suite: 26 failures/errors, all
  `AttributeError`/`TypeError` (missing method, route or kwarg) or the expected default-404/wrong-status
  — the intended reason, no accidental passes. Fixed two tests mid-implementation that would otherwise
  have exercised the real local `PRISMA_LOCAL_TELEGRAM_BOT_TOKEN` from this machine's environment
  (`_create_interactions_tts_job` starts the chat-action indicator for any valid chat id); both now pin
  a fake token and mock `_telegram_post` before creating a job, matching the existing `test_telegram_
  falls_back_from_non_2xx_ogg_attempts_to_identical_pcm_wav` guard pattern. No real secret was sent to
  any network; the only exposure was a token fragment inside one local assertion-failure message during
  development, never persisted or shared beyond that.
- Checks: `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s services\prisma-
  runtime -p "test_*.py"` → **1556 OK** (1532 baseline + 24 new). `hmi-app` untouched, no HMI checks run.
- Commits: implementation commit (tests + code, this task's route: delegated writer) followed by this
  doc-update commit.

## Progress

- 2026-09-24: product definition clarified with the user; read-only investigation of `C:\hmi_tts`
  and the new runtime; feature document created.
- 2026-09-24: B1 implemented and verified (delegated writer, strict TDD) — see Evidence above.

## Next step

B2 (inline — update `docs/prisma/PRISMA_DOCUMENTO_MAESTRO.md` §1/§6.3).
