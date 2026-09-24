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
- [x] **T2 — Confirmation copy.** Replace the pairing confirmation text with the approved copy.
  Evidence (2026-09-23): `channel_a_bot.py` — `CONFIRMATION_PROMPT_TEMPLATE`'s explanatory sentence
  changed to exactly "Está a un paso: confirme y Prisma responderá sus consultas en este chat.";
  the "Un teléfono quiere conectarse con:\n{label}" header is unchanged. New
  `test_confirmation_prompt_copy_matches_the_approved_wording` in `ChannelAClaimTests`
  (`test_channel_a_bot.py`) asserts the exact sentence and the absence of "documento"/
  "presentación"; the existing `test_live_token_sends_the_prompt_with_separate_ticket_buttons`
  already asserted the delivered payload equals `CONFIRMATION_PROMPT_TEMPLATE.format(...)` verbatim,
  so it needed no change. RED confirmed (old copy did not contain the new sentence). Full suite:
  `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s services\prisma-runtime
  -p "test_*.py"` → 1353 passed. Commit: `fix(prisma): clarify Channel A pairing confirmation copy`.
- [x] **T3 — Keep/unlink buttons reachable.** Decided by the user (2026-09-23): persistent reply
  keyboard (`is_persistent`) with a "Desvincular" button, always visible under the input. Tapping it
  sends "Desvincular" as a user message; Prisma answers asking for confirmation with an inline
  button (guards against accidental unlinking). Pinned message discarded (two taps, pin service
  message, unpin on relink). Remove the keyboard when the chat is unlinked.
  Evidence (2026-09-23): `channel_a_bot.py`:
  - New `_unlink_reply_keyboard()` (`{"keyboard": [[{"text": "Desvincular"}]], "resize_keyboard":
    true, "is_persistent": true}`) and `_remove_reply_keyboard()` (`{"remove_keyboard": true}`).
  - `_confirm`'s welcome send now uses `_unlink_reply_keyboard()` instead of the old inline
    Keep-connected/Unlink buttons (Telegram allows only one `reply_markup` per message, so the
    persistent keyboard REPLACES them there, not joins them). Once shown it stays visible under the
    input for every later message regardless of what markup that message itself carries (inline
    keyboards are a separate UI element from the reply keyboard).
  - New `_is_unlink_button_text()` matches the exact button text, `.strip().casefold()`-tolerant of
    whitespace/case. `_handle_message` checks it BEFORE both the `/`-command path and the query
    coordinator, so it is never treated as a data query (proved by
    `test_desvincular_text_bypasses_the_query_coordinator_even_when_attached`, which attaches a real
    coordinator and asserts zero parse calls).
  - New `_request_unlink()`: with no live action record for the phone, the text is simply
    `INGRESS_IGNORED_UNRELATED` (nothing to unlink); otherwise it sends `COPY_UNLINK_CONFIRM_PROMPT`
    ("¿Confirma que desea desvincular este teléfono? Ya no recibirá respuestas de Prisma en este
    chat.") with two inline buttons: "Confirmar desvinculación" (reuses the existing, already-proven
    `CALLBACK_UNLINK` callback and nonce — the real unlink is the SAME code path `_link_action` always
    used, not a duplicate) and "Cancelar" (new `CALLBACK_UNLINK_CANCEL`, handled by new
    `_cancel_unlink()`, which performs no registry mutation — the link is simply left untouched).
  - `_link_action`'s UNLINK success branch now sends `COPY_UNLINKED` with `_remove_reply_keyboard()`.
    This is the ONLY place in the runtime that ever calls `registry.unlink_phone(...)` or sends an
    unlink notice (confirmed by search — no admin-side or inactivity-expiry path sends a separate
    unlink message), so it is also the only place that needed the removal call.
  - Inline-button decision on the two other messages (documented in code comments at both sites):
    kept "Seguir conectado" only where it has a real function — the inactivity WARNING message
    (`_warn_one`) — because tapping it proactively renews the idle window without needing to send an
    ordinary query first, which is exactly the situation the warning fires in (no recent query
    already proved activity). Dropped the inline "Desvincular" button from that same warning message:
    the persistent reply keyboard already covers unlinking at any time, and a second unlink
    affordance on the same message would be confusing. The welcome message drops BOTH inline buttons
    entirely (persistent keyboard replaces them, and "Seguir conectado" there was redundant — the
    very next ordinary query already proves activity).
  - Transport check: `ChannelATransport.send_message`/`ChannelAPairingDialogue._send` pass
    `reply_markup` through opaquely (no shape validation), so inline keyboards, the persistent reply
    keyboard and `remove_keyboard` all transport unchanged — confirmed by reading
    `channel_a_transport.py`, no transport change needed. Every call site sends exactly one
    `reply_markup` value per message (never both an inline keyboard and a reply keyboard at once),
    respecting the Telegram one-`reply_markup`-per-message constraint.
  - All new/changed user-visible Spanish is formal "usted" ("¿Confirma que desea desvincular...?",
    "Ya no recibirá...", "Ya puede realizar sus consultas...").
  - Test fallout from removing the welcome message's inline keyboard: `test_channel_a_bot.py`'s
    `footer_nonce()` helper (used by `pair_up()`, load-bearing for ~20 existing tests) now reads the
    nonce from `self.dialogue._actions` directly instead of parsing a button; rewrote the two tests
    that asserted the welcome message's old inline-keyboard shape directly
    (`test_confirm_links_and_sends_the_welcome_with_the_persistent_unlink_keyboard`,
    `test_chat_text_never_carries_the_ticket_or_the_action_nonce`) and the warning-keyboard test
    (`test_sweep_sends_one_plain_warning_with_the_keep_connected_button`, renamed from
    `..._with_the_existing_action_buttons`). `test_channel_a_delivery_authority.py`'s `relink()`
    helper (used across ~30 tests) similarly rebuilds `self.unlink_button` from
    `self.dialogue._actions` plus the imported `CALLBACK_UNLINK` constant instead of reading it off
    the welcome message's (now absent) inline keyboard.
  - New tests: 8 in `ChannelAUnlinkKeyboardTests` (prompt sent + not a query even with a live
    coordinator attached + case/whitespace tolerance + a sentence merely mentioning the word is not
    matched + no live link is ignored + confirm reuses the real unlink and removes the keyboard +
    cancel keeps the link + a foreign phone cannot cancel another phone's prompt).
  - RED confirmed: `ImportError` for the new names before implementation; after implementing
    production code, RED also independently confirmed via the initial `KeyError: 'inline_keyboard'`
    failures surfaced by the pre-existing welcome/warning-keyboard tests and by
    `test_channel_a_delivery_authority.py` (27 errors) before those were rewritten to the new shape.
  Full suite: `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s
  services\prisma-runtime -p "test_*.py"` → 1361 passed. Commit: `feat(prisma): add persistent
  unlink keyboard to Channel A chats`.
- [x] **T4 — Typing indicator.** Send Telegram "typing…" while an answer is being prepared.
  Evidence (2026-09-23): `channel_a_transport.py` — new `ChannelATransport.send_chat_action(chat_id,
  action)` posting `sendChatAction`; reuses the T7 owned/lazy session via `self._effect`, same
  `request_timeout`, same error classification (`_unavailable()`/`ChannelATransportError`) and
  redaction as every other call; `action` is validated closed (`_validated_chat_action`, only
  `"typing"` accepted — this runtime never sends any other chat action). Timing is logged only on
  failure (`_log_send_chat_action_failed_elapsed`, T5-style noise discipline matching T8b's
  `getUpdates` fix): a successful ping carries no useful lag signal on its own. `channel_a_bot.py` —
  `ChannelATextTransport` Protocol gains `send_chat_action`; new `ChannelAPairingDialogue._typing()`
  probes `getattr(self.transport, "send_chat_action", None)` and swallows every exception (including
  a transport that omits the method entirely), so a failure NEVER blocks or fails the answer; called
  from `_handle_query` right after binding validation (unbound/stale queries never see a typing
  ping) and right before `self.query.handle_query(...)` produces the actual answer. New tests: 4 in
  `ChannelAQueryIntegrationTests` (sent right before the answer with the correct chat_id/action;
  failure never blocks or fails the answer; not sent for an unbound query; gracefully skipped when
  the transport lacks the method at all) plus the transport-level `SendChatActionTests` (4 tests) and
  2 `TimingLogTests` (log-only-on-failure). Updated
  `test_transport_protocol_declares_exactly_three_calls` (renamed from `...two_calls`) and the
  method-enumeration list in `TransportBoundaryTests`. RED confirmed at both layers (transport:
  `AttributeError: no attribute 'send_chat_action'`; bot: `0 != 1` chat actions recorded) before
  implementation. Full suite: `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover
  -s services\prisma-runtime -p "test_*.py"` → 1372 passed. Commit: `feat(prisma): show typing
  indicator while Channel A prepares answers`.
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
- [x] **T9 — Orb/audio misses: closed by T6.** In the T6 live test the orb and audio appeared on
  every voice answer; no separate fix needed.
- [ ] **T10 — HMI voice first-audio latency, part 1 (user-approved plan, 2026-09-23).** User goal:
  spoken answers as close to instant as possible. Current path (read-only map): event published in
  0 ms → HMI 1 s poll → orb shown → POST `/prisma/speak-live` → new `genai.Client` per request
  (`gemini_credentials.py:84-98`) → `client.interactions.create(stream=True)` with
  `gemini-3.1-flash-tts-preview` and ~45 lines of inline style notes (`build_tts_prompt`,
  `voice_service.py:305-351`) → first chunk 2.3–6.7 s (first request slowest). The old `C:\hmi_tts`
  local mode was identical (no warm-up, no prefetch). Scope: split timing (credential resolve /
  client build / Gemini time-to-first-byte / our processing; event publish vs speak-live received),
  persistent warm client + boot warm-up (invalidate on credential change), server-side synthesis
  started at answer time keyed by event id (reuse `AudioCoordinator`, `event_audio.py`), exact-text
  audio cache, push events to the HMI instead of 1 s polling.
- [ ] **T11 — Near-instant voice, part 2 (research done; benchmark awaits user authorization).**
  Research (2026-09-23, sources in the session report): community reports that
  `gemini-3.1-flash-tts-preview` via `interactions.create(stream=True)` is much slower than
  `generate_content_stream` and delivers audio in a burst
  (https://discuss.ai.google.dev/t/3-1-flash-tts-preview-streaming-latency/176050, unconfirmed by
  Google); `gemini-3.8-flash-tts` / `gemini-3.8-flash-lite-tts` released as stable on 2026-09-23
  (verbatim transcript by default, style in `speech_metadata.style`); Gemini Live has no verbatim
  guarantee and had 16–26 s first-audio reports in the EU in 2026-09 — not a safer bet; the old
  `PrismaLiveManager` targets the deprecated 3.1 Live model and has no measurements. Proposed
  benchmark (needs the user's Gemini key and authorization): 5–10 short fixed-sentence requests per
  variant — 3.1 via `interactions.create` (baseline) vs `generate_content_stream`, and 3.8 lite
  with both — recording only time to first PCM byte. Later options needing user decisions: fixed
  prefix + synthesized value, local TTS (voice identity change).

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
- 2026-09-23: T6 live repro (user verdict: excellent, see below), T8b verifier corrections, T2
  (confirmation copy), T3 (persistent unlink keyboard) and T4 (typing indicator) implemented and
  committed (`b236e95`, `c523c40`, `99f2fd8`, and the T4 commit above). Full prisma-runtime suite
  green after each (1352 → 1353 → 1361 → 1372 tests). Route: delegated writer (multi-file,
  behavior-changing work across channel_a_bot.py, channel_a_transport.py, channel_a_manager.py and
  their tests; touched only `services/prisma-runtime` and this doc, concurrently with a read-only
  verifier working in `hmi-app`).

## Next step

Next: T10 writer (voice latency part 1); T11 benchmark once the user authorizes it. In parallel,
**user manual check of T2/T3/T4 in Telegram**, since these are UX changes best confirmed live:
- **T2**: pair a phone via QR; the confirmation prompt should read "Está a un paso: confirme y
  Prisma responderá sus consultas en este chat." (no "documento").
- **T3**: after confirming, a persistent "Desvincular" button should appear under the input and
  stay visible through later messages. Tapping it should ask for confirmation with "Confirmar
  desvinculación"/"Cancelar" inline buttons — confirming should unlink and remove the persistent
  button; cancelling should keep the link and the button. The inactivity-warning message (idle ~9
  minutes) should show only "Seguir conectado" now, not a second inline "Desvincular".
- **T4**: send an ordinary question; Telegram should show "Prisma está escribiendo…" briefly before
  the answer arrives.
