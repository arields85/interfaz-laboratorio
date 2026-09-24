# PW-006 Prisma channel A and HMI voice responsiveness — ODD feature tracker

> ODD feature task (not SDD). Branch `feat/prisma-responsiveness-and-scaling` (from `main` b20edba),
> shared with PW-007 (`odd/tasks/pw-007-responsive-scaling.md`). Every commit belongs to one task of
> one feature. Engram mirror: `odd/pw-006-prisma-responsiveness/tasks`. Backlog detail:
> `backlog/prisma-channel-a-responsiveness`.

## Objective

Make Prisma feel responsive again in Telegram (channel A) and in HMI voice queries, and apply the
approved Telegram UX improvements.

## Problem and evidence (user-reported 2026-09-23)

1. After the QR scan the HMI popover reacts instantly, but the Telegram confirmation message arrives
   with a large lag (~1 min between messages in the pairing/confirm flow).
2. Confirmation copy is unclear: "Confirme para recibir en este teléfono las respuestas de ese
   documento." mentions "documento".
3. Keep-connected/unlink buttons scroll away in the chat.
4. No feedback while Prisma prepares an answer (dead time).
5. HMI voice queries lag, the orb is often missing, and there is often no audio. Behavior was more
   fluid before the migration from `C:\hmi_tts`. The user doubts QR pairing is the cause.

Root cause is unknown; diagnosis with real measurements comes first.

## Scope and constraints

- Read-only plant constraint unaffected (Prisma assistant and HMI configuration only).
- User-facing Spanish always uses formal "usted"; no "presentación" wording.
- Fixed ports 5056/5057/5173; single Prisma runtime and launcher; no git worktrees.
- Approved UX decisions:
  - Confirmation copy: "Está a un paso: confirme y Prisma responderá sus consultas en este chat."
  - Keep/unlink buttons: evaluate pinning the message (`pinChatMessage`) and a persistent reply
    keyboard with "Desvincular"; show both options to the user before implementing.
  - Telegram "typing…" chat action (`sendChatAction`) while preparing an answer.
- Out of scope: PW-003 semantic query (parked), channel B behavior changes, push/PR.

## TDD

Strict TDD: enabled (source: global orchestrator config). Runners:
- hmi-app: `cd hmi-app && npm test` (vitest; focused: `npx vitest run <file>`).
- prisma-runtime: `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s services\prisma-runtime -p "test_*.py"`
  (focused: single test module).

## Delivery

Strategy: `ask-on-risk`. Forecast pending until diagnosis defines the fixes. RDD: off (global) —
no native review. Work-unit commits on the shared branch; `.gga` and `CLAUDE.md` stay untracked.
Integrate to `main` by fast-forward at the end together with PW-007; NO push.

## Tasks

- [x] **T1 — Root-cause diagnosis (read-only, static).** Route: delegated (mapping trigger).
  Findings (2026-09-23) — no root cause confirmed; current logs hold no evidence of the incident
  (logs are recreated on every launcher start, `start-local.ps1:209-210`):
  - Channel A: `getUpdates` long poll (25 s), batches handled serially on the poll thread
    (`channel_a_lifecycle.py` `_process_batch`/`_loop`). Query answering (`answer_from_snapshot`) is
    local and fast — ruled out as the blocker.
  - Likely cause 1: any transient poll failure ends the activation and `ChannelAManager` reconnects
    with backoff 5→10→20→40→80 s (cap 300 s) (`channel_a_manager.py:81-91`, verified) — matches the
    "~1 min" lag. Failures log `Canal A background failure: code=... next_delay_s=...`.
  - Discarded by the user (2026-09-23): VPN keep-alive (`C:\hmi_tts\mantener_vpn_steigen.ps1`)
    belonged to a first version where queries went through Node-RED over the VPN; Prisma and the
    snapshot are local, so the VPN plays no role. External poller on the same token (409): the bot
    token was rotated several times, so no other process can hold it.
  - HMI voice: 1 s HTTP polling (`voiceEventListener.service.ts`), progressive live PCM playback
    (`prismaVoiceAudioEngine.ts` `playProgressiveLive`) — architecture sound. Unconfirmed
    candidates: session-boundary gating dropping events (`prismaSessionClient`), AudioContext
    autoplay/resume after idle, TTS network latency; orb no-ops without `event.id`
    (`usePrismaOrbPresentation.ts:55-63`).
  - No timing instrumentation exists for update→send or query→first audio byte.
  - UX hooks: copy `channel_a_bot.py:154-159` (`CONFIRMATION_PROMPT_TEMPLATE`); buttons
    `channel_a_bot.py:151-152`, `_keyboard()` 485-491, attached at 1096-1097 and 1409-1410;
    typing needs `send_chat_action` on `ChannelATextTransport` (`channel_a_bot.py:313-326`) and
    `ChannelATransport` (`channel_a_transport.py`), call site `_handle_query` (~874).
- [ ] **T2 — Confirmation copy.** Replace the pairing confirmation text with the approved copy.
- [ ] **T3 — Keep/unlink buttons reachable.** Decided by the user (2026-09-23): persistent reply
  keyboard (`is_persistent`) with a "Desvincular" button, always visible under the input. Tapping it
  sends "Desvincular" as a user message; Prisma answers asking for confirmation with an inline
  button (guards against accidental unlinking). Pinned message discarded (two taps, pin service
  message, unpin on relink). Remove the keyboard when the chat is unlinked.
- [ ] **T4 — Typing indicator.** Send Telegram "typing…" while an answer is being prepared.
- [x] **T1b — Old vs new comparison (read-only, delegated).** Findings (2026-09-23), static code:
  - Same library (raw `requests`), same poll cadence (25 s / 35 s), same Gemini TTS model, both
    Flask servers `threaded=True` (not a differentiator).
  - Difference 1 (confirmed by code): old reused one `requests.Session` for the bot's lifetime
    (`C:\hmi_tts\prisma_local_service.py:434,455`); new opens and closes a Session on every Bot API
    call (`channel_a_transport.py:16-21,252-259,345-366`) — fresh TCP+TLS handshake per
    `getUpdates`/`sendMessage`, more transient failures.
  - Difference 2 (confirmed by code): old retried a failed `getUpdates` in place after a flat 5 s in
    the same thread/session (`prisma_local_service.py:549-552`); new ends the whole activation on
    one failed poll (`channel_a_lifecycle.py:993-1009,1124-1143`) and rebuilds it after 5→10→20→40→80 s
    backoff (`channel_a_manager.py:77-91,310-378`). Combined with difference 1 this matches the
    ~1 min gaps.
  - HMI voice: no code path found that drops fresh events; `AudioContext.resume()` is called when
    suspended. Orb/audio misses remain unexplained → need live instrumentation.
- [x] **T5 — Timing instrumentation.** Monotonic timing logs for Channel A update received →
  message sent, and HMI voice query → first audio byte, so the lag can be measured.
  Evidence (2026-09-23): `channel_a_transport.py` logs `sendMessage`/`getUpdates` elapsed_ms (+count)
  around `_effect`/`_discovery`; `channel_a_lifecycle.py` logs per-update `type=message|callback_query
  |unknown elapsed_ms=` in `_process_batch` (update received → `handle_update` return, which includes
  the synchronous send); `voice_service.py` logs `Prisma speak-live: first_chunk_elapsed_ms=`/
  `stream_end_elapsed_ms=` wrapping the `/prisma/speak-live` PCM generator; `local_presentation.py`
  logs `Prisma voice event publish: elapsed_ms=` around both `voice_events.publish()` call sites
  (`/local/ask` and the Channel A on-outcome callback). All at `logger.warning(...)` — not `.info()` as
  literally requested — because this runtime has no `logging.basicConfig` anywhere (confirmed by grep)
  and Python's default "handler of last resort" only surfaces WARNING+ to stderr; INFO would be
  silently dropped and useless for T6. Same module-logger convention as the existing T16 lines
  (`channel_a_manager.py`), new lines use "Channel A"/"Prisma" (English) instead of the legacy "Canal A"
  prefix per AGENTS.md. No secrets/tokens/chat text/user/event ids logged (verified by test). RED
  confirmed via `git stash` of the 4 source files (4 new tests failed with `AttributeError: ... no
  attribute '_logger'`), GREEN after restore. 7 new focused tests added (4 transport, 1 lifecycle,
  1 voice_service, 1 local_presentation) using `assertLogs`. Full suite:
  `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s services\prisma-runtime
  -p "test_*.py"` → 1276 passed (was 1269 on main + 7 new). Commit: `feat(prisma): log Channel A and
  voice timings`.
- [ ] **T6 — Live repro and confirmation (user manual).** Tail the presentation log and watch the
  admin reconnecting indicator during a QR pairing and voice queries; check VPN state and stray
  processes polling the same token.
- [x] **T7 — Reuse one HTTP session per activation.** Port back the old behavior: one
  `requests.Session` reused for all Bot API calls of an activation, closed on teardown.
  Evidence (2026-09-23): `channel_a_transport.py` — `ChannelATransport` now builds its session
  lazily on the first call (`_ensure_session`) and caches it in `self._session`; every later
  `sendMessage`/`answerCallbackQuery`/`getMe`/`getUpdates` call reuses it (no more
  open+close per call); a session the lazy default obtained but could not configure
  (`trust_env` failure) is still closed immediately and never cached, so a later call can
  retry. New `ChannelATransport.close()` closes the owned session exactly once, idempotent,
  never raises. `channel_a_activation.py` — `ChannelAActivation` now stores the transport it
  was given and calls `transport.close()` in `stop()` right after `self._runner.stop()`
  (activation teardown); safe because `runner.stop()` only returns without having joined the
  owned thread when called reentrantly from that thread's own admission, which this
  activation's callers (the manager) never do. Timeouts, error classification (401 →
  `ChannelATransportUnauthorized`) and redaction are unchanged; `session_factory` semantics
  preserved (still invoked at most once now instead of once per call). Preserved but adapted
  concurrency proof: `requests.Session` is documented as safe for concurrent use, so
  `test_concurrent_send_and_poll_share_the_reused_session_without_serializing` and
  `test_concurrent_sends_share_the_reused_session_without_serializing` now warm the session up
  with one synchronous `get_me()` (mirroring the real `prepare()`-before-`start()` sequencing,
  which is why no lock was added to the lazy-creation path) then prove the shared session
  still isn't serialized by anything the transport holds. RED confirmed via `git stash` of the
  2 source files: transport suite 27 failures/4 errors, cleanup-harness suite 11 failures;
  GREEN after restore. Updated ~14 existing transport tests whose assertions assumed one fresh
  session per call (now `close_calls=0` mid-call, `1` after explicit `close()`); updated the
  `test_channel_a_transport_cleanup.py` meta-harness (6 tests) and 2 fake-transport test
  doubles (`test_channel_a_activation.py`, `test_channel_a_delivery_authority.py`) to add
  `close()`. Full suite:
  `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s services\prisma-runtime
  -p "test_*.py"` → 1276 passed. Commit: `fix(prisma): reuse Channel A HTTP session per activation`.
- [x] **T8 — In-place poll retry.** Port back the old behavior: a transient `getUpdates` failure
  retries in place after a flat 5 s within the same activation (status surfaces "reconnecting");
  terminal failures (e.g. invalid token) still end the activation; the manager backoff remains only
  for activation-level failures.
  Evidence (2026-09-23): `channel_a_lifecycle.py` — an ordinary (non-`ChannelATransportUnauthorized`)
  `get_updates` exception is no longer terminal: `_poll_iteration` returns the new, non-terminal
  `DISPOSITION_POLL_RETRY` (reason `PRISMA_CHANNEL_A_POLL_FAILED`, unchanged code) instead of calling
  `_terminal_result`; `_loop` (the managed thread `start()` actually uses) treats that disposition by
  waiting `poll_retry_delay` on the SAME interruptible `_pause_event` used for normal pacing, then
  retrying the SAME activation (session/dialogue/cursor untouched) — `stop()` interrupts the wait
  immediately. A direct `poll_once()` call still returns after exactly one attempt (never blocks
  internally), matching its existing "exactly one iteration" contract; only the managed loop actually
  retries. `ChannelATransportUnauthorized` is unchanged (still terminal). New optional
  `poll_retry_delay` (required keyword, validated like `poll_pause`, no default) and `on_poll_retry`
  observer (mirrors `on_terminal`: `set_on_poll_retry`, fires once entering a poll-retry outage and
  once on recovery with the elapsed gap, hostile callback swallowed). `channel_a_manager.py` —
  `_bind_poll_retry_observer`/`_handle_poll_retry` mirror the T16 background-failure wiring and write
  the SAME `retrying`/`retryAttempt` status fields the admin "reconnecting" indicator already reads
  (`status()`), so in-place retries surface identically to the old backoff-reconnect UI; new
  `Channel A poll retry: started` / `recovered gap_s=` log lines (English, mirroring the T16 log
  shape). Activation-level backoff (`_handle_background_failure`/`_retry_tick`) is untouched and now
  reserved for genuinely terminal failures only, since `PRISMA_CHANNEL_A_POLL_FAILED` is no longer
  produced as a background-failure reason. `channel_a_activation.py` forwards `poll_retry_delay` to
  the runner and `set_on_poll_retry` (pure forwarding seam). `local_presentation.py` adds
  `CHANNEL_A_POLL_RETRY_DELAY_SECONDS = 5.0` (flat 5 s, matching the old `hmi_tts` behavior) passed
  into `build_channel_a_activation`. RED confirmed via `git stash` of the 4 source files (lifecycle
  suite failed to import: `DISPOSITION_POLL_RETRY` undefined; activation suite: 31 errors, missing
  required `poll_retry_delay`); GREEN after restore. Rewrote 10 existing lifecycle tests whose
  premise ("any ordinary poll failure is immediately terminal") T8 deliberately reverses — switched
  their triggers to `ChannelATransportUnauthorized` where the test's real intent was about terminal/
  `on_terminal` mechanics, and rewrote the 2 tests whose actual subject was the retry-vs-terminal
  behavior itself. Added 9 new focused tests (managed-loop retry-then-recover, stop interrupts the
  wait promptly, an unauthorized failure mid-cycle still ends the activation, `on_poll_retry`
  observer mechanics, activation forwarding). Full suite:
  `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s services\prisma-runtime
  -p "test_*.py"` → 1285 passed. Commit: `fix(prisma): retry Channel A polling in place after
  transient failures`.
- [x] **T6 — Live repro (user manual, 2026-09-23 21:24–21:29, runtime at `90f1932`).** User
  verdict: QR pairing, confirmation and every reply excellent in Telegram and in HMI voice (orb and
  audio present every time). Log evidence (`prisma-presentation-stderr.log`,
  `prisma-voice-stderr.log`): Channel A `sendMessage` 361–370 ms; update handled 362–717 ms
  (message ~380–420 ms, confirm callback 717 ms); `getUpdates` elapsed with count=1 is long-poll wait
  for the user's next message, not lag; voice event publish 0 ms; speak-live first audio chunk
  2.3–6.7 s (first request slowest), stream end 5.1–8.7 s (Gemini TTS). No poll failures or retries
  occurred in the window, so T8's in-place retry was not exercised; the improvement is consistent
  with T7 (reused session) removing the transient failures that triggered the 5→80 s backoff, but
  that causal link is inferred, not directly observed.
- [x] **T8b — Verifier corrections (independent verifier, 2026-09-23; T5 and T7 PASS).**
  Evidence (2026-09-23):
  - Should-fix (T8): `channel_a_manager.py` — new `self._poll_retrying` bool, set only by
    `_handle_poll_retry` (T8), never touching `_retry_attempt` (T16's own backoff counter) anymore.
    `status()` merges purely for display: `retrying = self._retrying or self._poll_retrying`;
    `retry_attempt = self._retry_attempt or (1 if self._poll_retrying else 0)` — preserves T16's
    existing semantics verbatim (including staying at the last attempt count after a permanent
    background failure stops retrying) while a pure poll retry that never touched the background
    counter displays attempt 1 instead of 0. New manager-level tests in
    `ChannelAManagerPollRetryTests` (extends `ChannelAManagerBackgroundRecoveryTests`, mirroring
    T16's own fixture-extension pattern): poll retry started sets `retrying`/`retryAttempt=1` with
    no backoff timer created; recovery clears both; a stale/superseded activation's poll retry is
    ignored; and the should-fix interaction case itself — a background failure landing while a poll
    retry is sticky now starts its own backoff at attempt 1 (5 s), not attempt 2 (10 s). RED
    confirmed for the interaction test only (`retryAttempt: 2 != 1`, i.e. exactly the reported bug);
    the other 3 new poll-retry tests passed immediately since they didn't exercise the
    cross-contamination path. `test_channel_a_manager.py` — added `set_on_poll_retry`/`on_poll_retry`
    to `FakeActivation`, mirroring the existing `set_on_terminal`/`on_terminal` (never
    ledger-tracked).
  - Should-fix (T7): new `test_stop_closes_the_transport_exactly_once` in
    `ChannelAActivationPairingViewTests` (`test_channel_a_activation.py`) — no RED possible (pure
    coverage: `ChannelAActivation.stop()` already called `transport.close()` since T7), confirmed
    passing immediately.
  - Noise (T5): `channel_a_transport.py` — `get_updates`'s `finally` now logs only when
    `count is None` (failed) or `count > 0` (updates arrived); an empty long poll (`count == 0`)
    logs nothing. New `test_get_updates_logs_nothing_on_an_empty_long_poll` using
    `assertNoLogs` (Python 3.14 in this venv). RED confirmed (empty-poll case logged
    `count=0 elapsed_ms=0` before the fix); the two pre-existing count/failure log tests kept
    passing unchanged.
  Full suite: `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s
  services\prisma-runtime -p "test_*.py"` → 1352 passed (was 1285; +67 includes the 6 new focused
  tests plus every inherited base-class test re-run under the new `ChannelAManagerPollRetryTests`
  fixture, matching the project's existing T16 fixture-extension convention).
  Commit: `fix(prisma): separate Channel A poll retry state from reconnect backoff`.
- [ ] **T9+ — Further fixes.** From T5/T6 evidence (HMI voice orb/audio).

## Acceptance criteria

- Pairing/confirm messages in Telegram arrive without perceptible lag (measured before/after).
- HMI voice queries show the orb and play audio consistently, with latency comparable to
  pre-migration behavior.
- Approved copy, reachable keep/unlink control, and typing indicator in place.
- All gates green: vitest, `tsc`, eslint, prisma-runtime unittest discover.

## Progress

- 2026-09-23: branch created; feature document created. T1 static diagnosis done (no
  confirmed root cause).
- 2026-09-23: T5 (timing instrumentation), T7 (Channel A session reuse) and T8 (in-place poll
  retry) implemented and committed (`8da7148`, `1267411`, and the T8 commit above). Full
  prisma-runtime suite green (1285 tests) after each. Route: delegated writer (multi-file,
  behavior-changing work across channel_a_transport.py, channel_a_lifecycle.py,
  channel_a_manager.py, channel_a_activation.py, local_presentation.py, voice_service.py and
  their tests).

## Next step

Next: T6 — live repro with the user, using the new T5 timing logs to measure the reported lag
before/after T7+T8. Tail `%LOCALAPPDATA%\CoreAnalytics\Prisma\logs\prisma-presentation-stderr.log`
(Channel A: `Channel A sendMessage:`/`Channel A getUpdates:`/`Channel A update:` lines, and on a
transient poll failure `Canal A background failure:` should no longer appear — instead
`Channel A poll retry: started` then `Channel A poll retry: recovered gap_s=<N>`, where `<N>`
is the measured reconnect gap, expected around 5 s instead of the old 5→10→20→40→80 s backoff)
and `prisma-voice-stderr.log` (`Prisma speak-live: first_chunk_elapsed_ms=`/`stream_end_elapsed_ms=`,
`Prisma voice event publish: elapsed_ms=`) during a QR pairing and HMI voice queries. Also watch
the admin Channel A panel's "reconnecting" indicator during a simulated/real network hiccup. Then
root-cause fixes for the still-unexplained HMI voice orb/audio misses (T9+), followed by the
parked UX items T2–T4.
