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
- [x] **B1c — Answer from the active HMI screen (provisional source).** Channel B was still reading
  `prisma_local_snapshot.json`, a file the HMI stopped writing after migrating to per-session context
  (`POST /hmi/current-snapshot`) — 3-week-stale data. Give `HmiSessionRegistry` a read-only accessor
  for the most recently updated live session's context (the "active screen"), and wire
  `TelegramLocalBot` (production factory) to answer from it instead, for both the free-text Q&A and
  `/status`. Route: delegated writer (multi-file: `hmi_sessions.py`, `local_presentation.py`, tests).
  **Done 2026-09-24** — see Evidence below.
- [x] **B1b — Queue overlapping Channel B voice notes; hermetic test env (user decision).** Replace
  B1's one-in-flight-drop with a bounded per-chat FIFO of up to 3 pending voice notes, generated
  sequentially, each replying to its own question; beyond the bound, text-only (logged). Also make
  the runtime test suite hermetic for Telegram/Gemini token env vars, closing the token-fragment leak
  risk observed during B1 development. Route: delegated writer (multi-file: `local_presentation.py`,
  `tests/__init__.py`, tests). **Done 2026-09-24** — see Evidence below.
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

## Evidence (B1c, delegated writer, 2026-09-24)

- Finding (verified by the parent before this task started): `TelegramLocalBot` answered from
  `self.snapshot_store.read()` = `%LOCALAPPDATA%/CoreAnalytics/Prisma/prisma_local_snapshot.json`,
  last written 2026-08-31 — the HMI stopped writing that file once it migrated to posting its screen
  context to the per-session `HmiSessionRegistry` (`POST /hmi/current-snapshot` →
  `apply_context_command`; `GET` → `get_context`). Channel B was answering with 3-week-old data.
  User decision: provisionally (until PW-003's own data source exists), Channel B answers "según la
  pantalla activa" — the HMI's own currently-shown screen — as before the migration.
- "Active screen" definition: the context of the most recently updated (`context_received_at`),
  non-expired live session, among every session currently held by the registry. Justification:
  Channel B is a single remote person with no HMI session of its own and no way to name a particular
  HMI browser/tab; "whatever the HMI is showing right now" is unambiguous only when read as "the
  freshest live screen this process knows about", matching the pre-migration single-file behavior
  where there was exactly one shared snapshot for the whole process.
- Files: `services/prisma-runtime/src/prisma_runtime/hmi_sessions.py`
  (`HmiSessionRegistry.get_most_recent_context`), `local_presentation.py`
  (`TelegramLocalBot.__init__` gains `session_registry=None`; new `_active_snapshot()` helper used by
  both `/status` and the free-text answer path; `create_app`'s `TelegramLifecycleManager` factory
  lambda now passes `session_registry=session_registry`), `tests/test_hmi_sessions.py`
  (`MostRecentContextTests`, 7 tests), `tests/test_telegram_lifecycle.py`
  (`ChannelBActiveScreenTests`, 5 tests), `tests/test_runtime_safety.py` (1 production-wiring test).
- Registry accessor: `get_most_recent_context()` selects, under the registry's own lock, the live
  (non-expired) session with the greatest `context_received_at` that has actually received a context;
  returns a deep copy of only that context (never an owner id or capability — Channel B must not
  learn about other sessions' identities). Never purges, never touches `last_seen_at` — mirrors
  `get_owner_name`'s no-touch discipline — so an unrelated remote question can never extend or
  shorten an HMI browser session's idle/absolute lifetime. Thread-safe via the registry's existing
  `RLock`; no new locking primitive.
- Wiring/fallback decision: `TelegramLocalBot._active_snapshot()` reads `session_registry` when one
  was supplied, else falls back to the legacy `snapshot_store.read()` it was already built with. The
  production factory (`create_app`) always supplies `session_registry`, so the fallback is provably
  unreachable in production (covered by
  `test_runtime_safety.py::test_production_factory_wires_the_session_registry_for_channel_b`, which
  calls the real `TelegramLifecycleManager.bot_factory` and asserts identity). The fallback exists
  only so the legacy standalone `build_telegram_bot` path and every pre-B1c direct-construction test
  that mocks `snapshot_store` keep working unchanged (verified, not just assumed:
  `test_without_a_session_registry_falls_back_to_the_retired_file_store`).
- No-data copy: unchanged — `answer_from_snapshot(None, question)` already returns
  `"Todavía no hay datos del dashboard cargados."` (existing string, formal usted, no new copy
  needed); verified end-to-end with a registry that has zero live sessions, and that this path never
  touches the retired file store (`bot.snapshot_store.read = Mock(side_effect=AssertionError(...))`).
- File store disposition: left in place, not removed. Still read by the unrelated `/health` route
  (`snapshotReady`/`snapshotTimestamp` fields) and by the legacy standalone `build_telegram_bot`
  path/`JsonFileStore` class — both out of this task's scope (`/health`'s snapshot fields are now
  equally stale, but changing `/health`'s contract was not part of B1c's authorized scope). Grepped
  `snapshot_store`/`JsonFileStore`/`prisma_local_snapshot` across `src/`: no other writer exists
  anywhere in the runtime (nothing has written that file since the HMI's migration), only these two
  readers remain.
- RED evidence: added 13 tests (7 registry, 5 bot-level, 1 production-wiring) before implementing;
  ran the targeted files and observed `AttributeError: 'HmiSessionRegistry' object has no attribute
  'get_most_recent_context'` (registry tests), `AttributeError: 'TelegramLocalBot' object has no
  attribute 'session_registry'` (bot-level and production-wiring tests) — the intended reason, no
  accidental passes. Implemented, then reran: all green.
- Checks: `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s services\prisma-
  runtime -p "test_*.py"` → **1569 OK** (1556 baseline + 13 new). `hmi-app` untouched, no HMI checks
  run.
- Commit: `a2de608` — `feat(prisma-channel-b): answer from the active HMI screen (B1c)`.

## Evidence (B1b, delegated writer, 2026-09-24)

- Queue design: `TelegramLocalBot._channel_b_voice_queues: dict[int, deque]` replaces the old
  `_channel_b_voice_in_flight: set[int]`. `_request_channel_b_voice_reply` appends
  `(reply_to_message_id, answer_text)` under the existing `_channel_b_voice_lock`; if the chat's queue
  already holds `CHANNEL_B_VOICE_QUEUE_MAX_PENDING = 3` items it logs and returns (text-only, silent
  to the user — the text answer was already sent by the caller). A background worker
  (`_drain_channel_b_voice_queue`) is spawned only when the append makes the queue length 1 (no worker
  already draining this chat); it peeks (not pops) the head item while minting/firing it, so an item
  stays counted against the 3-pending bound for its whole synthesis, and only pops it once it settles
  (success or failure) before looping to the next item or exiting when the queue is empty. A later
  call that finds an empty/absent queue for that chat starts a fresh worker — no race window, both
  the pop-and-exit and the append-and-maybe-start-worker steps happen under the same lock.
- Failure isolation: each item's mint+fire runs in its own `try/except` inside the worker's loop; an
  exception is logged (redacted — no answer text, chat id or token) and the loop continues to the next
  queued item regardless — verified by
  `test_a_failing_item_in_the_middle_of_the_queue_never_blocks_the_rest` (item 2 of 3 raises, items 1
  and 3 still fire).
- Bound named as a constant: `CHANNEL_B_VOICE_QUEUE_MAX_PENDING = 3` in `local_presentation.py`
  (next to `CHANNEL_B_VOICE_REPLY_TIMEOUT_SECONDS`), asserted directly in
  `test_a_fourth_overlapping_request_when_three_are_already_pending_goes_text_only`.
  `CHANNEL_B_VOICE_REPLY_TIMEOUT_SECONDS = 45` (per-item HTTP timeout) is unchanged and still bounds
  each item's synthesis call.
- Hermetic test environment: `services/prisma-runtime/tests/__init__.py` now defines
  `HERMETIC_TOKEN_ENV_VARS = (PRISMA_LOCAL_TELEGRAM_BOT_TOKEN, GEMINI_API_KEY,
  PRISMA_CREDENTIAL_MASTER_KEY_FILE)` (grepped every `environ.get(...)`/`environ[...]` call across
  `src/prisma_runtime/*.py`; these three are exactly the token/key-shaped ones — the others are file
  paths/URLs/config flags, not secrets) and `scrub_ambient_token_env_vars()`, called once at test
  package import time — before any test module or fixture runs, in the same process every test in the
  suite shares. This closes the leak B1 hit: a real value left in this machine's own User-scope
  Windows environment is gone before any test's own `patch.dict(os.environ, ..., clear=True)` even
  takes its baseline snapshot, so that baseline (and its restore) is provably clean. New
  `tests/test_hermetic_test_environment.py` (5 tests): scrub removes injected fake values, scrub is a
  no-op when already absent, a regex-based regression scan of `src/prisma_runtime/*.py` for any
  `TOKEN`/`KEY`/`SECRET`-shaped env var name not yet covered (fails closed on a future addition), and
  two end-to-end checks (`read_telegram_config`, `GeminiCredentialResolver.resolve`) proving a
  real-shaped ambient value never survives into production config resolution once scrubbed. No real
  token value was ever read, logged or echoed while implementing this — only synthetic
  `"fake-<VAR>-value"` strings were used in tests.
- RED evidence: added 3 queue tests + 5 hermetic-environment tests before implementing.
  `test_telegram_lifecycle.py` queue tests: temporarily reverted (via `git stash`) to confirm the
  original B1 drop-not-queue implementation fails them with `AssertionError: 1 != 2` /
  `AssertionError: 1 != 3` (all overlapping requests actually delivered vs. only the first) — the
  intended reason. `test_hermetic_test_environment.py`: ran against the pre-B1b `tests/__init__.py`
  (via `git stash`) and observed `AttributeError: module 'tests' has no attribute
  'HERMETIC_TOKEN_ENV_VARS'` / `'scrub_ambient_token_env_vars'` on all 5 tests. Implemented, then
  reran: all green.
- Checks: `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s services\prisma-
  runtime -p "test_*.py"` → **1576 OK** (1569 B1c baseline + 7 new: the old single drop-test replaced
  by 3 new queue tests, net +2, plus 5 new hermetic-environment tests). `hmi-app` untouched, no HMI
  checks run.
- Commit: `c8df41b` — `feat(prisma-channel-b): queue overlapping Channel B voice notes (B1b)`.

## Progress

- 2026-09-24: product definition clarified with the user; read-only investigation of `C:\hmi_tts`
  and the new runtime; feature document created.
- 2026-09-24: B1 implemented and verified (delegated writer, strict TDD) — see Evidence above.
- 2026-09-24: B1c implemented and verified (delegated writer, strict TDD) — Channel B now answers
  from the active HMI screen (live session registry) instead of the retired file snapshot. See
  Evidence above.
- 2026-09-24: B1b implemented and verified (delegated writer, strict TDD) — overlapping Channel B
  voice notes are now queued (bounded FIFO of 3) instead of dropped; the runtime test suite is now
  hermetic for Telegram/Gemini token env vars. See Evidence above.

## Next step

B2 (inline — update `docs/prisma/PRISMA_DOCUMENTO_MAESTRO.md` §1/§6.3), then B3 (live verification,
user).
