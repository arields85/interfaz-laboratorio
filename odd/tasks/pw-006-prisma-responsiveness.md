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
  - Confirmation copy (revised by the user 2026-09-23, replacing the first approved text): "Confirme
    para hacerle preguntas a Prisma desde aquí; le responderá en pantalla y con voz." Rationale:
    Channel A makes the phone a remote input for the HMI session (answers shown and spoken on the
    HMI, `PRISMA_DOCUMENTO_MAESTRO.md` §6.2), not a Telegram answer channel.
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
  Revision (2026-09-23, user): sentence replaced with "Confirme para hacerle preguntas a Prisma desde
  aquí; le responderá en pantalla y con voz." (route: inline, one mechanical file + its test). RED
  observed on the updated copy test, then GREEN; full suite 1402 passed.
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
- [ ] **T10 — HMI voice first-audio latency, part 1 (user-approved plan, 2026-09-23). PARTIAL: units
  1-4 done, unit 5 blocked.** User goal: spoken answers as close to instant as possible. Current path
  (read-only map): event published in 0 ms → HMI 1 s poll → orb shown → POST `/prisma/speak-live` →
  new `genai.Client` per request (`gemini_credentials.py:84-98`) → `client.interactions.create(stream=
  True)` with `gemini-3.1-flash-tts-preview` and ~45 lines of inline style notes (`build_tts_prompt`,
  `voice_service.py:305-351`) → first chunk 2.3–6.7 s (first request slowest). The old `C:\hmi_tts`
  local mode was identical (no warm-up, no prefetch).
  - Route: delegated writer (multi-file, behavior-changing work across `voice_service.py`,
    `gemini_credentials.py`, `event_audio.py`, `local_presentation.py` and their tests). Strict TDD
    observed for every unit (RED confirmed before each implementation, GREEN after).
  - **Unit 1 — split timing** (2026-09-23, commit `163435d`, extended by commit `5ded8a3` after new
    evidence). Evidence: `voice_service.py` `get_gemini_client` logs `Prisma Gemini client:
    resolve_elapsed_ms=%d build_elapsed_ms=%d` (later `reused=%s`, unit 2); `_generate_interactions_
    tts_audio` logs `Prisma Gemini TTS: time_to_first_byte_ms=%d` (stream request → first Gemini
    delta) and `first_yield_processing_elapsed_ms=%d` (first delta → first yielded post-DSP chunk,
    covering S16LE assembler accumulation + DSP); `prisma_speak_live` logs `Prisma speak-live:
    event_publish_to_received_ms=%s`, computed from the voice event's own `timestamp` field (not a
    hash-correlation scheme — simpler, cross-process-safe via wall clock, one number instead of two
    log lines to grep and subtract; documented in code). New tests in `test_voice_service.py`
    (`test_get_gemini_client_logs_...`, `test_stream_logs_time_to_first_byte_...`, `test_speak_live_
    logs_event_publish_to_received_delta_...`, `test_speak_live_logs_none_delta_when_...`).
    Follow-up (2026-09-23): a standalone benchmark outside the repo (same key/model/voice/prompt,
    `interactions.create(stream=True)`) measured median Gemini TTFB ~1.31 s (0.89-1.71 s over 6 runs)
    against the runtime's own logged 2.3-6.7 s for the same kind of request — most of the gap is in
    OUR pipeline, not Gemini. Instrumented every synchronous step before the Gemini call: found
    `resolve_voice_event` (HTTP call to the presentation process) and `gemini_credentials.resolve()`
    (protected-store secret resolve) are each called **redundantly up to 3x and 2x per single voice
    request** — once in `prisma_speak_live()`'s own handler, once in `AudioCoordinator.subscribe()`'s
    admission validation/credential gate, once again in its worker thread right before generation
    (`event_audio.py` `subscribe()`/`_run()`, confirmed by reading the code: `subscribe()` calls
    `self.event_validator(...)` and `self.resolve_credential()` once each before queueing, then `_run()`
    calls both again before calling `self.generate(...)`). Added `_logger` to `event_audio.py` and new
    log lines: `AudioCoordinator subscribe: validate_elapsed_ms=%d` / `credential_gate_elapsed_ms=%d`,
    `AudioCoordinator generate: queue_wait_ms=%d` / `validate_elapsed_ms=%d` / `credential_elapsed_ms=
    %d`; `voice_service.py` `resolve_voice_event` logs `Prisma voice event resolve: elapsed_ms=%d`
    (every call, success or failure) and `_create_interactions_tts_job` logs `Prisma TTS job create:
    elapsed_ms=%d telegram=%s`. New tests in `test_event_audio.py` (`AudioCoordinatorTimingTests`, 3
    tests) and `test_voice_service.py` (4 tests). **Not fixed in T10** (reported per the coordinator's
    request, out of the 5 planned units, T11 owns TTS call-style changes): the redundant
    `resolve_voice_event`/`resolve_credential` calls are themselves a real, well-evidenced latency
    cost (each resolve does filesystem ACL checks via `SecureStoragePermissions.verify`, a symlink-safe
    path walk in `validate_key_path`, and opens a fresh unpooled `sqlite3.connect()` — see
    `credential_store.py` `CredentialService._cipher`/`_connection`/`get_secret`, called 2x per request
    even after T10's own warm-client fix, since `AudioCoordinator`'s own two `resolve_credential()`
    calls are separate from `get_gemini_client`'s). Eliminating the duplication would need an
    `AudioCoordinator` behavior change (its admission-then-generation double-validate/double-resolve
    design) beyond this unit's scope — flagged for a future task. Full suite green after both commits
    (1376, then 1390 passed).
  - **Unit 2 — persistent warm Gemini client** (2026-09-23, commit `98b2f1b`). Evidence:
    `gemini_credentials.py` new `WarmGeminiClient` — builds the SDK client once, reuses it across
    requests (thread-safe, double-checked rebuild), invalidates implicitly by comparing a SHA-256 hash
    of the freshly resolved secret on every call (no cross-process signal needed since credential
    resolution already re-reads the store/env each time; only the hash is retained, never the secret).
    Decided NOT to perform a real synthesis at boot (costs one Gemini API call per process start with
    no measurement benefit) — only pre-builds the client object, documented in `WarmGeminiClient.
    warm_up`'s docstring. `voice_service.py` `main()` starts a daemon thread
    (`_warm_up_gemini_client_in_background`) before `app.run(...)`, never blocking startup/health.
    Cancellation and normal completion no longer close the shared client (only the per-request stream);
    removed the now-dead `_close_gemini_client` helper. New tests: `WarmGeminiClientTests` (7 tests
    incl. a 4-thread race test asserting no two live clients) in `test_gemini_credentials.py`;
    `test_generate_interactions_tts_audio_never_closes_the_warm_client` plus 2 updated close-count
    assertions in `test_voice_service.py`. Full suite green (1384 passed).
  - **Unit 4 — exact-text audio cache** (2026-09-23, commit `691ab1d`; note: done before unit 3 below,
    since it only needed unit 2's warm-client secret hash, not unit 3's prefetch). Evidence:
    `voice_service.py` new `VoiceAudioCache` — bounded LRU by both entry count and total bytes,
    thread-safe; keyed by `_voice_audio_cache_key(job)` on exact transcript text + voice/DSP config +
    the fixed `TTS_MODEL`/`VOICE` constants + `_warm_gemini_client.current_secret_hash()` (new cheap
    accessor, no forced resolve), so a credential rotation invalidates prior entries for free.
    `_generate_interactions_tts_audio` checks the cache before any provider work; a hit replays
    already-DSP-processed PCM and never calls Gemini (mirrors the same success/cancel/error cleanup as
    the miss path); a miss stores the full generated PCM into the cache on successful completion. Test
    isolation fix: cleared the module-level cache singleton in `VoiceServiceTests.setUp` (it's shared
    across the whole test run, same as production). New tests: `VoiceAudioCacheTests`-equivalent cases
    in `test_voice_service.py` (eviction by count+bytes, second identical request served from cache
    without calling Gemini, different text/config is a miss, cache key changes with the secret hash)
    plus `WarmGeminiClient.current_secret_hash` tests in `test_gemini_credentials.py`. Full suite green
    (1395 passed).
  - **Unit 3 — server-side prefetch at answer time** (2026-09-23, commit `b9cfc04`; scoped narrower
    than planned). Evidence: presentation (`local_presentation.py`) fires a background, never-awaited
    call (`_fire_voice_prefetch`, own daemon thread) to a new `POST /internal/prisma/prefetch` on the
    voice service, right after `/local/ask` publishes its voice event, carrying that same request's own
    session capability. The new route (`voice_service.py` `prisma_prefetch`) reuses the *exact* same
    `resolve_voice_event` + `audio_coordinator.subscribe(...)` admission path, capability/session/auth
    checks, and error taxonomy as `/prisma/speak-live`, then closes its subscription immediately.
    Design finding that simplified this a lot: no separate TTL/reaper was needed for an abandoned
    prefetch — `AudioCoordinator`'s existing per-event-id dedup and shared buffered-generation replay
    (already covered by `test_event_audio.py`'s multi-subscriber tests) means the buffered audio just
    sits under the event's own existing `expiresAt`/capacity-eviction rules, identical to any other
    completed generation with zero current subscribers; a later real `/prisma/speak-live` subscribe
    attaches to the same in-flight-or-buffered generation instead of duplicating it. **Scoped to the
    `/local/ask` HMI path only** — the Channel A on-outcome publish site (`channel_a_on_outcome` in
    `local_presentation.py`) has no live browser request/capability in hand at publish time (it is an
    async Telegram outcome callback, not a request handler), so minting or looking up a capability for
    it would need new machinery beyond this unit; left as a named follow-up, not silently dropped. New
    tests: `test_voice_service.py` (4: capability required, malformed body, admits-then-closes,
    error-taxonomy parity with speak-live) and `test_local_presentation.py` (3: `/local/ask` fires the
    prefetch on a background thread without delaying its own response, using a `threading.Event` for
    deterministic synchronization; `_fire_voice_prefetch` posts the right payload; swallows every
    exception). Full suite green (1402 passed).
  - **Unit 5 — push events to the HMI instead of 1 s polling: NOT DONE, blocked.** This writer's brief
    explicitly forbids starting/stopping the runtime/launcher. Unit 5's own acceptance bar includes
    "verify proxy buffering does not delay SSE" through the real Vite dev-server proxy (5173 → 5056/
    5057) and preserving the orb/audio experience T6 just verified working live with the user — neither
    is something a static code read or a Flask/vitest unit test can confirms; the closest a headless
    unit test could get is asserting response headers and generator behavior, not that `http-proxy`
    (Vite's proxy middleware) actually streams chunks through without buffering, which is exactly the
    kind of environment-specific behavior this task named as a risk. Stopped here per the task's own
    guidance ("especially 3 or 5... stop... report partial") rather than shipping a change to the live
    voice-orb path that cannot be verified end-to-end by this writer. Recommended next step: a
    follow-up pass that runs with the launcher available, implements the SSE endpoint + listener with
    the same TDD rigor as units 1-4, and does one live proxy check before calling it done.
- [x] **T11 — Near-instant voice, part 2.** Benchmark authorized and run (2026-09-23; results in
  Engram `odd/pw-006-prisma-responsiveness/t11-benchmark`): Gemini TTFB for the current call 1.31 s
  median vs 2.3–6.7 s in the runtime; `gemini-3.8-flash-lite-tts` + `generate_content_stream`
  0.61 s. **User decision (2026-09-23): adopt `gemini-3.8-flash-lite-tts`** — the user listened to
  the raw samples and prefers its voice (Leda) over the current one. **Style decision (user,
  2026-09-23): "normal" — plain transcript only, no style instructions.** Compared samples on 3.8
  flash-lite: (1) plain text, (2) condensed style in the separate `speech_metadata.style`
  annotation (only reachable via raw REST; google-genai 2.17 rejects the annotation type), (3) the
  current 45-line `build_tts_prompt` inline (3.8 did not read it aloud; audio length matched plain
  text). The 45 lines were guard rails for the 3.1 preview model (voice/accent/pacing plus "do not
  read or change the transcript"); 3.8 treats input as a verbatim transcript by default. Idea
  recorded, not scheduled: a Prisma settings selector for the style (normal / 45-line / style
  field).
  Evidence (2026-09-23, commit `bd10a52`): `voice_service.py` — `TTS_MODEL` changed to
  `"gemini-3.8-flash-lite-tts"`; the Interactions-API call path
  (`build_tts_prompt`/`_tts_interaction_request`/`_create_tts_interaction`/
  `_iter_interaction_audio_deltas`/`_validate_audio_delta`/`_decode_audio_delta`) is removed as
  dead code and replaced with `_tts_generate_content_config`/`_create_tts_stream`/
  `_create_tts_response` (`client.models.generate_content_stream`/`generate_content`, same
  `importlib.import_module("google.genai")` mockability pattern as `gemini_credentials.py`) and
  `_iter_inline_audio_parts`/`_iter_tts_audio_parts`/`_validate_audio_inline_data`/
  `_decode_audio_inline_data` reading `candidates[].content.parts[].inline_data` instead of
  `step.delta` events. "Normal" style sends the plain transcript as `contents`, unwrapped. Decode
  accepts raw `bytes` (confirmed against the real installed `google-genai==2.17.0` SDK) and a
  base64 `str` defensively; mime validation accepts any `audio/l16*` form and only rejects an
  explicit non-24000 `rate=` parameter (accept-if-absent, matching the old delta's optional-field
  behavior); no `channels` check anymore since `inline_data` exposes no such field (24 kHz mono is
  this model's fixed output) — documented as the one dropped validation. No explicit "stream
  completed" event exists in this API (unlike Interactions' `interaction.completed`); the existing
  "no audio at all" check (`TTS_STREAM_AUDIO_MISSING`) still covers a stream that ends without ever
  yielding anything. The non-streaming fallback (`_full_file_fallback_pcm`) now calls
  `_create_tts_response`/`generate_content` and concatenates every inline audio part instead of
  reading `interaction.output_audio.data`; its blanket `except Exception` mapping to
  `TTS_FALLBACK_PROVIDER_FAILED` is unchanged. `gemini_credentials.py` —
  `GEMINI_VERIFY_MODEL = "gemini-3.8-flash-lite-tts"` (existing guard test keeps both constants
  equal). Renamed for clarity (no behavior change): `_generate_interactions_tts_audio` →
  `_generate_tts_audio`, `_discard_interactions_tts_job` → `_discard_tts_job`,
  `_close_interaction_stream` → `_close_tts_stream`; `_create_interactions_tts_job` kept as-is
  (job/state builder, not protocol-specific). Warm client reuse, the exact-text cache (its key
  already includes `TTS_MODEL`, so the model switch invalidates old entries for free), prefetch,
  DSP, Telegram audio delivery, cancellation/idle-guard handling, and the T5/T10 timing log lines
  (`time_to_first_byte_ms`, `first_yield_processing_elapsed_ms`, etc.) are unchanged in shape — no
  log format changes besides the removed `interactions`-specific comments. No docs referenced the
  specific model/API by name (checked `services/prisma-runtime/README.md` and
  `docs/prisma/PRISMA_DOCUMENTO_MAESTRO.md`), so none needed updating.
  RED confirmed (`test_tts_request_uses_streaming_interactions_contract` failing on the model
  string change) before rewriting the test doubles (`FakeStream`/`FakeModels`/`FakeClient`/
  `audio_chunk` replacing the Interactions-shaped fakes) and every dependent test; new tests added
  for mime/rate acceptance and rejection, bytes-vs-base64 decode, the plain-transcript stream/
  response request shape, and that the retired helpers no longer exist. Full suite:
  `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s services\prisma-runtime
  -p "test_*.py"` → 1407 passed (was 1402; +5 net after renames/rewrites). Commit: `feat(prisma):
  speak with gemini-3.8-flash-lite-tts plain transcripts`.
  Risk/cost note: `gemini-3.8-flash-lite-tts` generation cost per request is unverified by this
  writer (no live Gemini call made — fakes only, per this writer's brief); confirm via the user's
  next live voice test alongside the T10 timing logs.
- [x] **T12 — Remove redundant per-request resolves (T10 finding).** `resolve_voice_event` runs up
  to 3× and the Gemini credential resolve up to 2× per voice request (`prisma_speak_live`,
  `AudioCoordinator.subscribe` admission gate, worker `_run`), each credential resolve opening the
  protected store and checking ACLs. Resolve once per request/job and pass the result along,
  preserving the same authorization guarantees.
  Evidence (2026-09-23, commit `9521bbe`) — **credential resolve reduced 2x → 1x, resolve_voice_event
  deliberately left at 3x (reasoned, not silently skipped):**
  - `event_audio.py` `AudioCoordinator.subscribe()`: removed its own admission-time
    `self.resolve_credential()` call (the `credential_gate_elapsed_ms` log line it produced is
    gone with it). This resolve's result was always discarded — it only ever fail-fast-probed
    whether the local protected secret store was readable (it never calls Gemini itself, so it
    never actually proved provider reachability), duplicating the exact same store read (ACL check
    + fresh `sqlite3.connect()`, T10 unit 1's finding) that `_run()` already performs once,
    immediately before generation. `_run()`'s own resolve is the one kept as the single remaining
    per-request credential read, because it must stay fresh for a job that waited in the queue —
    proven load-bearing by the pre-existing `test_queued_work_reads_replacement_credential_at_
    dequeue`, which a first design attempt (keep admission's resolve, drop the worker's) would have
    broken. `WarmGeminiClient`'s rotation detection (`current_secret_hash`) keeps working correctly
    off this single resolve with no extra protected-store read — the "one read is the only safe
    signal" option from the task brief, chosen over eliminating both.
    Documented, accepted trade-off: a request submitted while Gemini credentials are entirely
    unconfigured/unreadable no longer gets an immediate `503 GEMINI_CREDENTIAL_UNAVAILABLE` JSON
    response from `subscribe()` itself; it is admitted and fails once its generation attempt
    starts (`AudioRetryUnavailable("VOICE_GENERATION_UNAVAILABLE")`, surfaced as a stream failure
    instead of a synchronous error) — still rejected, just later. Judged acceptable because Gemini
    configuration is an admin-side, session-independent condition already surfaced separately
    (`/health`'s `providerStatus`, the admin credential UI), not a per-request authorization
    decision.
  - `resolve_voice_event`'s two `AudioCoordinator`-internal calls (admission's `event_validator` in
    `subscribe()`, and the same validator again in `_run()` before generation) were evaluated and
    **kept unchanged** after finding both are load-bearing for distinct, real guarantees that a
    same-narrow reduction would break: admission's synchronous revalidation is what lets an
    invalid/unauthorized/expired event map to a clean `404`/`401` from `prisma_speak_live` — proven
    necessary because Flask commits the streaming response's `200` status as soon as the view
    function returns, before the PCM generator ever yields a first chunk, so a failure discovered
    only later can no longer become a clean JSON error; the worker's revalidation is what protects
    a job that waited in the queue (up to `queue_timeout`, 30 s) from acting on a since-invalidated
    event. Removing either changes observable rejection behavior for a common, per-request
    condition (unlike the now-removed credential admission check, which only ever guarded a rare,
    admin-side misconfiguration). A safe reduction here would need a larger restructuring
    (`AudioCoordinator`'s `event_validator` contract returning and propagating the resolved event so
    the route handler's own upfront resolve could be dropped instead) — flagged as a follow-up
    beyond this task's scope, not attempted.
  - New/changed tests: `test_event_audio.py` — `test_rejected_subscriber_does_not_create_or_
    enqueue_paid_work` updated (`credentials.call_count` 2 → 1);
    `test_subscribe_logs_validate_and_credential_gate_elapsed_ms` renamed to
    `test_subscribe_logs_validate_elapsed_ms_but_no_longer_a_credential_gate` and rewritten to
    assert `validate_elapsed_ms` still logs from `subscribe()` while `credential_gate_elapsed_ms`
    no longer does; new `test_unconfigured_credential_no_longer_rejects_subscribe_itself` locks in
    the documented trade-off (subscribe() admits even with an always-failing resolver; the failure
    surfaces on the first `next()` instead). RED confirmed for exactly these 2 pre-existing tests
    (`credentials.call_count: 1 != 2`, `credential_gate_lines: 0 not >= 1`) before the test updates;
    no other test in the 1408-test suite was affected. `voice_service.py`'s `resolve_voice_event`
    comment updated to record the "kept, reasoned" decision for future readers. Full suite:
    `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s services\prisma-runtime
    -p "test_*.py"` → 1408 passed. Commit: `perf(prisma): resolve voice event and credential once
    per request`.

## Acceptance criteria

- Pairing/confirm messages in Telegram arrive without perceptible lag (measured before/after).
- HMI voice queries show the orb and play audio consistently, with latency comparable to
  pre-migration behavior.
- Approved copy, reachable keep/unlink control, and typing indicator in place.
- All gates green: vitest, `tsc`, eslint, prisma-runtime unittest discover.

- [x] **T13 — Voice latency, part 3 (from the 2026-09-24 live test, runtime at `82e7176`).**
  Measured per voice answer (Channel A questions from the phone): `event_publish_to_received_ms`
  170–1088 (HMI 1 s poll, no prefetch on the Channel A publish path); `AudioCoordinator generate:
  credential_elapsed_ms` 581–604 on EVERY request, cache hits included (protected-store secret
  read); validate/resolve 3×~15 ms; Gemini `time_to_first_byte_ms` 1311–1486 (vs 0.6–0.7 s in the
  standalone benchmark and the smoke test of the same helpers — unexplained); cache hit first chunk
  619–656 ms (almost all of it the credential read); miss first chunk 1958–2132 ms. Channel A update
  handling grew from ~0.38 s to ~0.74–0.80 s: T4's synchronous `sendChatAction` (~0.36 s) runs
  before the answer is sent. User report: the orb appears and waits a few seconds before the audio.
  Scope: (a) keep the resolved Gemini secret in memory and invalidate it on credential
  save/delete/rotate instead of reading the protected store per request; (b) start synthesis at
  publish time for the Channel A on-outcome path too (prefetch keyed by event id without an HMI
  capability — reuse the internal prefetch route's authorization model safely); (c) T10 unit 5 —
  push voice events to the HMI (SSE) with polling fallback, verified live through the Vite proxy;
  (d) find why Gemini TTFB inside the runtime is ~2× the standalone measurement and fix it if it is
  ours; (e) send the Telegram typing action without blocking the answer (fire-and-forget) or skip
  it when the answer is immediate.
  - **Unit (a) — in-memory Gemini secret** (2026-09-24, commit `5411978`). Evidence:
    `gemini_credentials.py` `GeminiCredentialResolver` now keeps the resolved secret in memory and
    only re-reads the protected store when a cheap `os.stat()` on the credential database's mtime
    proves it changed, instead of on every `resolve()` call. Chosen invalidation: file mtime of
    `runtime_paths().credential_database`, not a cross-process signal — the presentation process
    (admin routes) and this voice process are separate OS processes with no shared memory, but
    every `CredentialService.set_secret`/`delete_secret` (save, delete, and rotate — a rotate is
    just a re-save) already writes to that same SQLite file, so its mtime advances on any of those
    changes for free. New `_default_mtime_probe()` (injectable via `mtime_probe=`) does the stat();
    a failed or unprovable stat always fails safe to a real resolve (never serves a possibly-stale
    secret). Only cached on a *successful* resolve (a failure is never cached, so the next call
    retries the store normally). Environment-mode (unprotected) credentials never consult the probe
    at all — that path was already free (a plain `os.environ.get`). Adapts
    `test_queued_work_reads_replacement_credential_at_dequeue`'s guarantee (unchanged,
    `test_event_audio.py` — that test exercises `AudioCoordinator`'s own call-timing with a hand-
    rolled resolver, untouched by this change) to this resolver's own cache with new
    `GeminiCredentialCachingTests` (6 tests: cache hit never touches the store; mtime change
    invalidates and re-reads; an unprovable/failed probe always bypasses the cache; environment
    source never calls the probe; a failed resolve is never cached; `status()` benefits from the
    cache too) plus `GeminiCredentialDefaultMtimeProbeTests` (3 tests for the default probe, using a
    patched `runtime_paths()` pointing at a temp file — never touches the real credential database).
    RED confirmed (`TypeError: unexpected keyword argument 'mtime_probe'` / `AttributeError: no
    attribute '_default_mtime_probe'`) before implementation. Full suite green (1417 passed).
  - **Unit (d) — Gemini TTFB inside the runtime** (2026-09-24, commit `74cf145`). Root cause found and
    fixed, evidence-backed by a live standalone measurement (user-authorized real Gemini calls,
    short Spanish sentences, 4 requests total; script under the session scratchpad, not committed):
    httpx's own default `keepalive_expiry` is **5 seconds** (`httpx.Limits()`, confirmed by reading
    the installed `httpx` 0.28.1 source) and `google-genai`'s `_api_client.py` never overrides it, so
    the pooled HTTP connection closes whenever more than 5 s pass between Gemini calls — which real,
    humanly-spaced Channel A/HMI questions almost always do — forcing a fresh TCP+TLS handshake on
    nearly every real request. `WarmGeminiClient` reusing the same SDK client *object* does not by
    itself keep the underlying httpx connection warm. Measured with the exact production helpers
    (`create_gemini_client`, `TTS_MODEL`, `VOICE`) against the real API: a call issued after a 7 s
    idle gap on the default client measured **1335 ms** (matches the runtime's observed
    1311–1486 ms almost exactly); the same 7 s gap on a client built with a longer
    `keepalive_expiry` measured **559 ms** (matches the ~0.6–0.7 s standalone benchmark/smoke-test
    figures). This is ours to fix. `gemini_credentials.py` — new
    `GEMINI_HTTP_KEEPALIVE_EXPIRY_SECONDS = 55.0`; `create_gemini_client` now passes
    `http_options=genai.types.HttpOptions(timeout=timeout_ms, client_args={"limits":
    httpx.Limits(max_keepalive_connections=20, keepalive_expiry=55.0)})` (`client_args` flows
    straight into the SDK's own `httpx.Client(**client_args)` construction — confirmed by reading
    `_api_client.py`'s `_ensure_httpx_ssl_ctx`). Applies to both the TTS client and the verification
    client (same factory function); harmless for verification's one-off calls. Added `httpx==0.28.1`
    to `requirements.in` as a direct dependency (was already pinned with hashes in
    `requirements.lock.txt` as a transitive dependency of `google-genai`, so the lock file needed no
    regeneration — the pin is already exactly consistent). New/updated tests in
    `test_gemini_credentials.py`: new `test_client_uses_a_keepalive_expiry_longer_than_httpxs_five_
    second_default`; the two existing `HttpOptions(timeout=...)` call-shape assertions
    (`test_client_uses_documented_45_second_sdk_timeout`,
    `test_default_client_factory_uses_the_short_verification_timeout`) updated to also expect
    `client_args={"limits": ANY}`. RED confirmed (both existing tests failed on the old call shape)
    before implementation. Full suite green (1418 passed).
  - **Unit (b) — prefetch for Channel A answers** (2026-09-24, commit `7e84d4f`). Evidence: Channel
    A's on-outcome publish site (`channel_a_on_outcome`, `local_presentation.py`) runs on the
    Channel A poll thread, after the Telegram answer has already been sent — it is an async
    callback, not a Flask request handler, so it has no live HMI session capability to forward the
    way `/local/ask` does. Reused the existing `/internal/prisma/prefetch` route and
    `_fire_voice_prefetch` transport unchanged; the missing authorization is bridged with a new
    short-lived (60 s), event-scoped, server-minted bearer token
    (`VoiceEventStore.mint_prefetch_token`/`resolve_prefetch_token`, `voice_events.py`, random via
    `secrets.token_urlsafe(32)`, matching `hmi_sessions.py`'s own entropy standard) carried in the
    exact same capability header/transport a real session capability would use — zero changes
    needed in `voice_service.py`. Deliberately reusable within its TTL, not single-use:
    `AudioCoordinator` revalidates the same event twice per job (subscribe()-time admission, then
    again at dequeue — see `event_audio.py`'s own T12 comment on why both calls are load-bearing),
    and a single-use token would break the second revalidation for the very job its first use
    admitted. Never returned in any browser-facing response; only ever exchanged between the
    presentation and voice processes over localhost. `local_presentation.py`'s
    `/internal/prisma/voice-events/<event_id>` route (`voice_event()`) now falls back to
    `resolve_prefetch_token` only after the normal session-capability path fails to resolve —
    the ordinary HMI browser-facing authorization path is unchanged. New
    `_fire_channel_a_voice_prefetch` wrapper spawns the actual background thread (mirrors
    `/local/ask`'s existing pattern) so a slow/failed prefetch can never delay the Channel A poll
    loop from processing the next update. `channel_a_on_outcome` mints the token and fires the
    prefetch right after a successful publish; a missing token (event already gone) or an
    unsuccessful publish (guard refused/raised) simply skips prefetch, never raises. Security note:
    the prefetch endpoint itself never returns audio to its caller regardless of credential kind
    (it closes its subscription immediately), so the actual confidentiality boundary — reading real
    audio via `/prisma/speak-live` — still requires the HMI's own genuine session capability; a
    leaked prefetch token could theoretically also authorize a `/prisma/speak-live` read since
    token resolution is layered onto the same internal lookup route, but tokens are high-entropy,
    short-lived and never sent to any browser, so this is judged an acceptable, documented
    trade-off at the same trust level as the primary capability mechanism. Tests: new
    `VoiceEventPrefetchTokenTests` (7, `test_voice_event_delivery.py` — round trip, wrong-event
    rejection, malformed/unknown token, reusability within TTL across two resolves, expiry,
    never authorizes a foreign owner); new tests in `test_local_presentation.py` (prefetch wrapper
    starts a background thread; the voice-event route accepts a valid token without a session and
    rejects an unknown token/missing session). `test_channel_a_root.py`'s offline-containment
    harness (`RootHarness.install_offline_guards`) refuses every `threading.Thread.start()` and
    real network call for its whole test class and asserts zero attempts at teardown — adapted
    (not weakened) by patching the new `_fire_channel_a_voice_prefetch` wrapper itself (the same
    technique `test_local_presentation.py` already uses for `_fire_voice_prefetch`), so the
    real thread/network path is never exercised there while the "ignores"/"fails closed"/
    "publishes" `on_outcome` tests now also assert the prefetch fired (or didn't) with the right
    event id and a token that resolves back to the exact owner. Full suite green (1428 passed).
  - **Unit (e) — typing action must not delay the answer** (2026-09-24, commit `acea713`). Evidence:
    `channel_a_bot.py` — `ChannelAPairingDialogue._typing()` now spawns a background daemon thread
    (`ChannelATypingIndicator`) to call `send_chat_action`, chosen over skipping it when the answer
    is immediate (the "typing…" indicator still gives real feedback during the actual dead time —
    Gemini/local answer prep — it was only ITS OWN synchronous wait, not the answer prep itself,
    that added the ~0.36 s). Reuses the transport's own T7-reused HTTP session and existing error
    handling (`requests.Session` documented safe for concurrent use, confirmed already relied upon
    by T7). Still never blocks or fails the answer, on either thread; still a best-effort probe for
    an optional `send_chat_action` method. Test fallout: the old
    `test_typing_indicator_is_sent_right_before_the_answer` asserted an exact call-order fence
    (`transport.calls[-2:] == ["send_chat_action", "send_message"]`) that a fire-and-forget design
    can no longer guarantee — renamed to `test_typing_indicator_is_sent_without_blocking_the_answer`
    and rewritten to poll (bounded, 2 s) for the chat action to land instead of asserting order; the
    failure-never-blocks test similarly adds the same bounded wait. New
    `test_typing_indicator_never_delays_the_answer`: a `send_chat_action` double that blocks on a
    `threading.Event` for up to 2 s proves the answer still returns in well under 1 s. RED confirmed
    (`elapsed=2.008s not less than 1.0s`) before implementation; the full `ChannelAQueryIntegrationTests`
    class also dropped from 2.018 s to 0.014 s wall time now that no test in it pays the old
    synchronous chat-action cost. Full suite green (1429 passed).
  - **Unit (c) — push voice events to the HMI, T10 unit 5** (2026-09-24, commit `82345d0`). The
    launcher was running throughout (ports 5056/5057/5173 in use) and this writer's brief forbids
    starting/stopping it, so this could not be verified live through the real Vite proxy against the
    newly written code (the running processes still serve the pre-this-unit code; only a restart
    picks up file changes) -- implemented with full unit/integration test coverage on both sides
    instead, per the brief's own guidance for this case. **Pending live check**: confirm the orb/audio
    experience is unchanged and that the SSE connection survives the real Vite dev-server proxy
    without buffering, after the next launcher restart.
    - Backend (`services/prisma-runtime`): `voice_events.py` — new `VoiceEventStore.subscribe_owner`/
      `_notify_owner` (per-owner `threading.Event` waiters, guard-refused publishes never notify).
      `local_presentation.py` — new `GET /hmi/voice/events` SSE route, same session-capability
      authorization as `/hmi/voice/latest`; also accepts `?capability=` (native browser `EventSource`
      cannot set a custom header) tried only after the header path fails, never weakening the
      ordinary path. Sends the current latest event immediately on connect (matching polling's own
      first-response behavior), then blocks on the owner's wake flag (re-checking `latest()` on every
      wake, so no event is ever missed even if a wake races a check) and re-authorizes every pass
      (not just at connect) so a long-lived stream keeps the session's idle window alive the way 1s
      polling used to, stopping cleanly if the session is later closed/expired/revoked. Headers:
      `Cache-Control: no-cache`, `X-Accel-Buffering: no`, `Connection: keep-alive`,
      `mimetype=text/event-stream`; a 15s keep-alive comment (`VOICE_EVENTS_SSE_KEEPALIVE_SECONDS`)
      during idle periods. `unsubscribe()` always runs on generator exit (`try/finally`, covers a
      client disconnect via `GeneratorExit`).
      New tests: `VoiceEventOwnerNotificationTests` (6, `test_voice_event_delivery.py`) and
      `VoiceEventsStreamTests` (7, `test_local_presentation.py`: authorization required; header/query
      capability accepted/rejected; no-buffering headers; existing-latest-sent-immediately;
      new-event-pushed-after-connect; unsubscribe-on-close). Debugging note kept for future
      test-writers in this codebase: Werkzeug's test client eagerly runs a streaming Response's
      generator up to its first `yield` as part of `client.get()` itself (a WSGI-conformance
      behavior), not lazily afterward — a test that opens the connection before any event exists
      must run `client.get()` itself on a background thread (confirmed necessary and sufficient via a
      standalone repro before rewriting the real tests; an earlier version of these tests blocked on
      the route's own keep-alive interval for exactly this reason, since `client.get()` was called on
      the main thread instead). Full prisma-runtime suite green (1442 passed, was 1429).
    - Frontend (`hmi-app`): `prismaAssistant.config.ts` — new `PRISMA_EVENTS_STREAM_URL =
      '/api/prisma/events/stream'`, added to `PRISMA_BROWSER_ROUTES` (closed-set contract test
      updated to 8 routes). `vite.prismaProxy.config.ts` — new proxy route to `/hmi/voice/events`;
      verified via the existing rewrite/query-preservation test, no proxy-level SSE-specific config
      needed (`http-proxy`'s default streaming already proxies `/prisma/speak-live`'s PCM generator
      response live today, confirmed working in the T6 live test — the same unbuffered pass-through
      applies to any streamed response regardless of content type). `prismaSessionClient.ts` — new
      `capability()` method (bootstraps the session like `fetch()` does, returns the raw capability
      string) because a native `EventSource` cannot set the `X-Prisma-Session-Capability` header;
      the query-parameter fallback is scoped to this one same-origin, dev-proxied, local endpoint,
      never logged (no `logging.basicConfig` anywhere in the runtime) and never recorded in browser
      history (EventSource is a background request, not a page navigation).
      `voiceEventListener.service.ts` — `startVoiceEventListener` now attempts SSE first
      (`EventSource` + query capability) and falls back to the existing, unchanged polling loop on
      any error, a malformed/unsupported environment, or a `capability()` rejection; both paths share
      one `lastProcessedKey`/`acceptVoiceEvent` dedupe state so a mid-stream fallback never replays or
      blocks an event the other path already handled. SSE is attempted only when `fetchImpl ===
      undefined` — the exact same internal convention the existing code already used to distinguish
      "real production client" from "test/injected transport" — so **every one of the 21 existing
      polling tests needed zero changes** (they all already pass `fetchImpl`) and continues to
      exercise the identical, unmodified polling code path. `useVoiceEventListener.ts` now also
      passes `streamUrl: PRISMA_EVENTS_STREAM_URL`.
      New tests: 3 in `prismaSessionClient.test.ts` (`capability()` round trip, bootstrap-failure
      rejection, stale-after-reset rejection); 8 new SSE tests in `voiceEventListener.service.test.ts`
      using a `FakeEventSource` test double and a mocked `prismaSessionClient` (happy path with the
      exact query-string URL asserted; cross-listener dedupe; malformed-frame tolerance; fallback on
      `onerror`; fallback on `capability()` rejection; fallback when unsupported -- exercised against
      the REAL jsdom test environment, confirmed to have no global `EventSource`, not a simulated
      absence; fetchImpl bypasses SSE entirely; `stop()` racing before `capability()` resolves closes
      instead of connecting). Verified the new SSE tests actually exercise the new code (not
      vacuously passing) by temporarily disabling the SSE branch and confirming exactly the 4 tests
      that depend on it failed, then restoring it. `tsc -b`: clean. `eslint`: clean. Full hmi-app
      suite green (2384 passed, was 2372).
- [x] **T13b — Verifier findings on T13 (independent verifier, 2026-09-24).** `5411978`, `74cf145`,
  `7e84d4f`, `acea713` PASS. `82345d0` (SSE):
  - **Blocking, confirmed in the real log:** the HMI session capability travels in
    `GET /hmi/voice/events?capability=…` (EventSource cannot send headers) and Werkzeug's dev server
    logs the full request line to stderr → `prisma-presentation-stderr.log`. Parent check found 11
    such lines already written by the running (pre-T13) runtime after Vite hot-reloaded the new
    listener. Capabilities live up to 8 h and are refreshed by the SSE keep-alive. Fix: stop putting
    the capability in the URL — read the SSE stream with `fetch` + header (ReadableStream parser) and
    remove the `?capability=` fallback server-side; add defense in depth (a Werkzeug log filter that
    redacts query strings). Existing leaked lines: the launcher start deletes the logs and restarting
    the runtime invalidates all in-memory session capabilities.
  - Should-fix: SSE holds one Werkzeug thread per open connection with no explicit cap beyond the
    64-session registry; add a bounded limit.
  - Nit (acea713): typing may now arrive after the answer; accepted trade-off, revisit if visible.
  - Pending: live check of SSE through the Vite proxy.
  - **Fixed (2026-09-24), route: delegated writer (multi-file, behavior-changing work across
    `local_presentation.py`, `voice_service.py`, `voice_events.py`, `prismaSessionClient.ts`,
    `voiceEventListener.service.ts` and their tests in both trees; brief forbade starting/stopping
    the runtime/launcher, so the blocking and should-fix items below are unverified against the real
    launcher/Vite proxy, same as `82345d0`'s own SSE implementation).**
    - **Blocking fix — capability out of the URL** (commit `82e9378`, extended by `795f926`).
      `hmi-app/src/services/voiceEventListener.service.ts`: replaced the native `EventSource`
      connection with a `fetch`-based reader through `prismaSessionClient.fetch(streamUrl, ...)` —
      the same transport polling already uses, so capability handling, abort and rotation stay in
      one place; the capability now travels only in the ordinary `X-Prisma-Session-Capability`
      header, never in the URL. Parses `text/event-stream` from `response.body`'s
      `ReadableStream<Uint8Array>` by hand: `TextDecoder`-decodes each chunk, buffers across reads,
      splits on `\n\n` frame boundaries (correct across arbitrarily split chunks — new dedicated
      test), extracts `data:` line(s) per frame (comments/heartbeats with no `data:` line are
      skipped, not treated as malformed), UTF-8 via the stream decoder's own incremental mode. Kept
      the existing polling fallback and cross-listener dedupe (`lastProcessedKey`,
      `prismaSessionClient.acceptVoiceEvent`) exactly as-is; falls back to polling on a rejected
      fetch, a non-ok response (401/429/etc.), a missing/non-streaming `response.body`, a stale
      response after a mid-connect session reset (`isCurrentResponse`), a rejected read, or the
      stream ending — one shared code path (`if (!stopped && !usingPolling) startPolling();`) rather
      than duplicated fallback logic per failure mode. `services/prisma-runtime/src/prisma_runtime/
      local_presentation.py`: removed the `?capability=` query-parameter fallback from
      `voice_events_stream()` entirely — header-only now, identical to every other HMI route; no
      other route ever read a query-string capability (confirmed by repo-wide search). Dead code
      removed: `PrismaSessionClient.capability()` (only caller was the old `EventSource` URL
      construction) and its 3 tests. `PRISMA_EVENTS_STREAM_URL` added to `prismaSessionClient.ts`'s
      `AUTHORIZED_PATHS` so `.fetch()` accepts it. `vite.prismaProxy.config.ts`'s stale comment
      updated (no proxy behavior change — the route already passed the capability header through
      unmodified; `stripSessionCapability` was already `false` for it).
      Follow-up correction (`795f926`, same review pass): the unterminated-frame overflow guard
      (`MAX_SSE_BUFFERED_CHARS`) originally ran before extracting complete frames from the buffer,
      so a legitimately large complete frame (or several frames arriving in one chunk) landing right
      at that size boundary would have been dropped along with a genuinely runaway buffer; reordered
      to extract every complete frame first and only then clear a leftover unterminated remainder.
      New regression test proves a single complete frame larger than the guard is still delivered.
      Tests: backend — `test_local_presentation.py` `VoiceEventsStreamTests`: new
      `test_query_string_capability_no_longer_authorizes` (a real, valid capability sent only via
      `?capability=` now gets 401), `test_accepts_a_valid_capability_via_header_only` (renamed from
      the old EventSource-specific test). Frontend — `voiceEventListener.service.test.ts`: replaced
      the entire `FakeEventSource`-based SSE describe block with a `FakeSseBody` (a controllable fake
      `ReadableStreamDefaultReader`) and 15 new tests covering the plain connect/deliver path with no
      `capability=` in the fetch URL, split-chunk reassembly, heartbeat/comment frames, cross-listener
      dedupe, malformed JSON, and every fallback trigger listed above, plus the overflow-guard
      ordering regression and the existing "never attempts SSE when fetchImpl is provided" seam test
      adapted to the new transport. `prismaSessionClient.test.ts`: removed the 3 `capability()` tests,
      added one asserting the stream route is authorized and the capability travels as a header with
      no `capability=` in the URL. RED confirmed for every new/changed assertion (backend query-401
      test; frontend: 11 of the 15 new SSE tests failed against the old EventSource code path before
      the rewrite, the other 4 — deliver/dedupe/malformed/never-attempts — already passed
      coincidentally since jsdom has no native `EventSource` and fell straight to polling, so the
      rewrite's behavior was independently verified equivalent for those; the overflow-guard fix was
      RED-verified separately by toggling the two-line reorder back and forth). Full suites:
      prisma-runtime 1443 passed (`82e9378`); hmi-app 2392 tests / `tsc -b` clean / `eslint` clean
      (`82e9378` + `795f926`).
    - **Should-fix — bounded SSE connections** (commit `c590523`). `voice_events.py`:
      `VoiceEventStore.subscribe_owner()` now enforces a per-owner cap (default 4 — one real tab plus
      a brief reconnect overlap) and a global cap (default 32 — well below the 64-session HMI
      registry) via new `max_stream_subscribers_per_owner`/`max_stream_subscribers_total` constructor
      kwargs, raising new `VoiceEventStreamCapacity` before the new waiter is appended (a rejected
      caller never holds a slot). `local_presentation.py`'s `voice_events_stream()`: moved the
      `subscribe_owner()` call out of the `generate()` generator into the view function itself —
      Flask commits the streaming response's 200 status as soon as the view function returns, before
      the generator ever yields its first chunk, so a capacity error raised only once the generator
      started could no longer become a clean rejection (same class of bug T12 documented for
      `resolve_voice_event`). A capacity error now answers a clean `429` with
      `{"ok": false, "error": "VOICE_EVENT_STREAM_SUBSCRIBER_LIMIT" | "VOICE_EVENT_STREAM_CAPACITY"}`,
      which the frontend's fetch-based SSE reader already treats as a non-ok response and falls back
      to polling for (covered by the frontend's own "falls back to polling on a non-ok SSE response"
      test from the blocking fix above — no frontend change needed for this unit). `unsubscribe()`
      (unchanged) still releases both the per-owner and global slot on disconnect. Tests: 6 new in
      `test_voice_event_delivery.py`'s new `VoiceEventStreamCapacityTests` (per-owner limit, global
      limit spanning owners, a rejected subscription never holds a slot, unsubscribe releases both
      kinds of slot for a later subscription) plus 2 new integration tests in
      `test_local_presentation.py`'s `VoiceEventsStreamTests` (a saturated store answers 429 through
      the real route before any stream byte is sent; releasing a slot lets a later connection
      through). `VoiceEventsStreamTests._client()` extended to also build and return its
      `HmiSessionRegistry` (needed to resolve `owner_id` for direct store pre-saturation in the new
      tests) — every existing caller in the class updated to the 3-tuple unpack; no behavior change
      to those tests. RED confirmed: the store-level tests failed on `ImportError:
      VoiceEventStreamCapacity` before the store change; the two route-level tests failed with an
      uncaught `VoiceEventStreamCapacity` crashing the response mid-stream (rather than a clean 429)
      before the view-function restructuring. Full suite: 1459 passed.
    - **Nit (acea713):** left as the documented accepted trade-off — not revisited (not reported as
      visible in the 2026-09-24 live test).
    - **Also confirmed (static check only, per this task's own brief):** the Vite dev proxy's default
      streaming pass-through needs no SSE-specific configuration (unchanged from `82345d0` — same
      conclusion, re-verified by reading `vite.prismaProxy.config.ts` again); response headers
      `Cache-Control: no-cache` and `X-Accel-Buffering: no` were already set by `82345d0` and remain
      unchanged. The live proxy check itself stays pending for the user's next launcher restart (see
      Next step).
    - **Defense in depth — access log query-string redaction** (commit `e29d4c6`, not itself a T13b
      finding but explicitly requested by this task's brief as belt-and-suspenders alongside the
      blocking fix). New `access_log_redaction.py`: a `logging.Filter` installed on the `"werkzeug"`
      logger in both `local_presentation.py`'s and `voice_service.py`'s `main()` (before `app.run()`,
      source-inspection-tested for ordering, matching this file's existing `MainStartupWiringTests`
      convention) that rewrites the request-line log argument to redact everything after `?` when
      Werkzeug logs a request with a query string, leaving method/path/protocol/status/size intact;
      never drops or crashes on a record it cannot parse. Idempotent install. Tests: 6 in the new
      `test_access_log_redaction.py` (redacts while preserving the rest, leaves a query-less line
      untouched, never drops an unparseable record, redacts a multi-parameter query string, installs
      exactly one filter across repeated calls, and one end-to-end `assertLogs` round trip through the
      real `"werkzeug"` logger) plus the 2 `MainStartupWiringTests` wiring-order tests above. RED
      confirmed: the module tests via `ImportError` before the module existed; the two wiring tests by
      temporarily removing the `install_access_log_query_redaction()` call from each `main()` and
      confirming both failed, then restoring. Full suite: 1451 passed.
- [x] **T16 — Browser-side voice timeline and first-question miss (live test 2026-09-24 09:39–09:51).**
  Server side after T13/T13b: publish → `/prisma/speak-live` 117–143 ms (SSE works), server first
  chunk 482–762 ms (first request 1358 ms), cache hit 28 ms, credential 0 ms, no capability in
  logs. The user still perceives the orb waiting before audio, and after the launcher restart the
  first question showed neither orb nor voice although the server answered 200. Read-only browser
  diagnosis: Vite proxy and client stream reader are pass-through (parent's buffering suspicion
  refuted, `vite.prismaProxy.config.ts:85-142`, `prismaSessionClient.ts:273-333`); the engine's
  `log` defaults to a no-op (`prismaVoiceAudioEngine.ts:276`) and `prisma-browser-metric` events have
  no production listener, so the browser timeline is invisible. First-question candidates: session
  epoch reset race (a concurrent 401 invalidates the epoch → orb hidden and the already-answered
  speak-live response discarded as stale, `prismaSessionClient.ts:203-206,335-350`,
  `usePrismaOrbPresentation.ts:97-103`, `prismaVoiceTtsAudioSource.ts:39-41`) or autoplay
  (`ensureContextRunning`, `prismaVoiceAudioEngine.ts:928-937`). Scope: dev-guarded console
  instrumentation (engine `log`, metric listener, reset/401 warnings), then one live repro, then fix
  the confirmed cause.
  **Delivered as observability only (no repro/fix — see Next step)**, route: delegated writer
  (multi-file, behavior-changing across `hmi-app` and `services/prisma-runtime`; forbidden from
  starting/stopping the runtime/launcher).
  - **Design.** Extended the existing closed `prisma-audio-record.v1` schema
    (`schemas/prisma-audio-record.v1.schema.json`, already driving codegen for both languages via
    `schemas/generate_prisma_audio_bindings.py`) with 7 new `browser`-layer record types instead of
    inventing a parallel validation mechanism: `voice-event-received` (`source`: sse|poll),
    `orb-phase` (`phase`: hidden|buffering|visible|fading), `speak-live-request-start` (no payload),
    `speak-live-response-received` (`http_status`, `elapsed_ms`), `speak-live-stale-discarded`
    (`elapsed_ms`), `session-reset` (`reason`: unauthorized-401|explicit, `epoch_after`),
    `audio-context-state` (`state`: suspended|running|closed|interrupted, `when`: at-play|after-resume).
    Regenerated `audio_record_types.py` and `prismaAudioMetric.generated.ts`; both language
    validators (`make_record`/`isPrismaAudioMetric`) now accept these for free. No real question,
    answer, capability, or event id ever enters a record — only enums, non-negative numbers, and the
    existing opaque `run_id` pattern (`prisma-[0-9a-f]{16,64}`); a per-event short hash was judged
    unnecessary since no record needs to correlate back to a specific event id.
  - **Frontend pipeline.** New `prismaVoiceTimelineRecorder.ts`: mints ONE opaque page-run id
    (reuses `createOpaqueBrowserRunId`) and emits the 6 page-scoped record types through the
    existing `dispatchPrismaBrowserMetric`/`prisma-browser-metric` CustomEvent channel — the exact
    same bus the audio engine's own per-playback records (`request-start`, `first-readable-audio`,
    `playback-started/ended`, `eof`, `cancel`, `error`, `underflow`, `canonical-decode`) already use,
    so the sink needs only one listener for the whole timeline. `audio-context-state` is the one
    exception: it is playback-scoped (AudioContext resume happens inside one playback), so the
    engine emits it itself through its own per-playback `emitDiagnostic`
    (`prismaVoiceAudioEngine.ts` `ensureContextRunning`), only when a resume was actually needed
    (not on every scheduled PCM block, which would flood the timeline with "already running").
    New `prismaVoiceTimelineDiagnosticsSink.ts`: the first production listener on
    `prisma-browser-metric`. Batches validated records (`isPrismaAudioMetric` filters malformed/
    foreign CustomEvent details), flushes on a 2 s interval, immediately once 20 records are
    pending, and on `pagehide`. Every POST is fire-and-forget (rejection swallowed); the module
    never throws from its own handlers. Wired into `main.tsx`, unconditional (dev and prod alike —
    single local kiosk runtime, no separate flag needed per the brief's "keep it simple" guidance).
  - **The pagehide race (verifier-adjacent finding, fixed same pass).** The obvious design — flush
    the final batch on `pagehide` through the normal `prismaSessionClient.fetch()` — silently loses
    the batch: `fetch()` awaits `#waitForBootstrap()` even when already bootstrapped (still yields a
    microtask), and the pre-existing `pagehide` listener in `main.tsx` that calls
    `prismaSessionClient.reset()` runs synchronously right after (same macrotask, listeners fire in
    registration order) and bumps the epoch before `fetch()` resumes, so it throws
    `PrismaStaleSessionResponse`. Fixed with a new `PrismaSessionClient.sendBeacon(path, body)`:
    reads the capability synchronously, never awaits bootstrap, never checks the epoch, no-ops
    without a capability. The sink's pagehide flush uses this instead of the ordinary transport;
    interval/size flushes still use the ordinary `fetch()`. `sendBeacon` matches every other
    capability-bearing call's `cache: 'no-store'`/`redirect: 'error'`.
  - **Backend endpoint.** New `POST /hmi/voice/timeline` (`local_presentation.py`), same
    session-capability header authorization and `no-store` CORS as every other HMI route,
    `touch=False` (a diagnostics POST alone shouldn't extend the idle window). New
    `voice_timeline_diagnostics.py`: `validate_timeline_batch()` rejects a non-`{"records": [...]}`
    envelope, an empty/oversized batch (cap 40), any record outside the `browser` layer, a wrong
    `schema_version`, an unknown record type, an unlisted/free-text payload key, or a missing
    required field — reusing the generated `make_record()` per record (never partially accepts a
    malformed batch). `VoiceTimelineRateLimiter`: in-memory per-owner sliding window (default 30
    req/60 s), a clean `429` before any body read. Body capped at 16 KiB
    (`HMI_VOICE_TIMELINE_MAX_BYTES`). `format_timeline_log_line()` produces exactly:
    `HMI voice timeline: run=<run_id> seq=<sequence> type=<record_type> t_ms=<round(elapsed_ms)>[ extra=<k>=<v> ...]`
    (fields sorted, `extra=` omitted when the payload is empty) — one `logger.warning(...)` per
    accepted record, same WARNING-level/no-`basicConfig` convention as every other T5/T10/T13 log
    line, landing in `prisma-presentation-stderr.log`.
  - **TDD.** RED confirmed before every implementation: `test_audio_record_types.py`/
    `test_audio_bindings_generation.py` (schema drift) before regenerating bindings;
    `test_voice_timeline_diagnostics.py` (18 tests, module missing) before the backend module;
    `VoiceTimelineDiagnosticsRouteTests` (7 tests) before the route; frontend — moved
    `prismaVoiceTimelineRecorder.ts` aside to confirm an import-resolution RED before restoring it;
    every other new/changed `*.test.ts(x)` failed for the right reason (assertion mismatch or
    missing export) before its implementation, confirmed individually. GREEN after every step; full
    suites green after every commit (see below).
  - **Independent code-review gate (pre-commit hook, not part of this task's own brief) findings,
    fixed before the first commit landed:** (1) inline string-union payload types in the recorder
    duplicated the generated `PrismaAudioMetricSource/Phase/Reason` enums instead of importing them
    from `domain/prismaAudioMetric.types.ts` — fixed, those types now re-exported from the domain
    module and imported. (2) the pagehide flush never actually sent (the race above) — fixed with
    `sendBeacon`. (3) `recordSessionReset`/`recordAudioContextState` were exported but never called
    from production code, contradicting their own doc comment — fixed: `session-reset` now wired
    into `prismaSessionClient.ts`'s `#invalidate()` (both call sites, 401 and explicit reset);
    `audio-context-state` moved to the engine's own per-playback diagnostic stream instead (a
    better fit, and removed the now-dead page-scoped duplicate). Two more non-blocking review notes
    fixed same pass: reuse `PrismaAudioMetricReason` instead of repeating its union in
    `#invalidate()`'s signature; `sendBeacon` missing `redirect: 'error'`/`cache: 'no-store'`.
  - **Files:** `schemas/prisma-audio-record.v1.schema.json`,
    `services/prisma-runtime/src/prisma_runtime/audio_record_types.py` (generated),
    `services/prisma-runtime/src/prisma_runtime/voice_timeline_diagnostics.py` (new),
    `services/prisma-runtime/src/prisma_runtime/local_presentation.py`,
    `services/prisma-runtime/tests/test_voice_timeline_diagnostics.py` (new),
    `services/prisma-runtime/tests/test_audio_record_types.py`,
    `services/prisma-runtime/tests/test_local_presentation.py`,
    `hmi-app/src/domain/prismaAudioMetric.generated.ts` (generated),
    `hmi-app/src/domain/prismaAudioMetric.types.ts`,
    `hmi-app/src/services/prismaVoiceTimelineRecorder.ts` (new),
    `hmi-app/src/services/prismaVoiceTimelineDiagnosticsSink.ts` (new),
    `hmi-app/src/services/prismaSessionClient.ts`, `hmi-app/src/services/prismaVoiceAudioEngine.ts`,
    `hmi-app/src/services/prismaVoiceTtsAudioSource.ts`,
    `hmi-app/src/services/voiceEventListener.service.ts`,
    `hmi-app/src/hooks/usePrismaOrbPresentation.ts`, `hmi-app/src/config/prismaAssistant.config.ts`,
    `hmi-app/vite.prismaProxy.config.ts`, `hmi-app/src/main.tsx`, plus every listed file's test.
  - **Checks:** `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s
    services\prisma-runtime -p "test_*.py"` → 1487 passed (was 1459). `cd hmi-app && npm test` →
    2418 passed (was 2392). `npx tsc -b` clean. `npm run lint` clean.
  - **Known, accepted trade-off (not fixed, judged low-risk):** the sink's automatic pagehide flush
    and `main.tsx`'s explicit session-reset pagehide listener are two separate `pagehide` listeners
    whose *relative* registration order matters (the sink is registered first in `main.tsx`,
    documented there); a later edit that reorders those two lines would silently break the pagehide
    flush again. Not restructured into one handler in this pass (would mean the sink stop-lifecycle
    exposing its flush function to the caller, touching its public contract and every existing
    sink test) — flagged for a future pass if this proves fragile in practice.
  - **Commits:** `c605519` (feat: stream HMI voice timeline diagnostics), `9db0368` (refactor: reuse
    the generated session-reset reason type), `2964d1a` (fix: pin sendBeacon to no-store/no-redirect).
- [ ] **T16 follow-ups (parent, 2026-09-24 ~11:10 test).** (1) The launcher reused the runtime
  started at 09:39 ("already running", `start-local.ps1:114-131`), so the T16 endpoint answered 404
  (12 POSTs) and no timeline was captured; a real restart needs `stop-local.cmd` before relaunching
  (known reuse behavior). (2) The same log shows 1148 `GET /hmi/voice/latest` polls vs 22 SSE
  connections: once the HMI falls back to polling it apparently never returns to SSE — investigate
  with the timeline. (3) 55 of 130 `GET /internal/prisma/voice-events/<id>` answered 401 (bursts,
  e.g. 10:26:16) — check whether prefetch-token validations expire or race. (4) T14 gap: inactivity
  expiry purges the link silently, leaving the menu entry and reply keyboard in that chat.
- [x] **T14 — "Desvincular" hidden while typing (user report 2026-09-24).** Telegram hides a reply
  keyboard while the system keyboard is open (it shows a keyboard toggle icon instead). **User
  decision (2026-09-24): keep BOTH** — the persistent "Desvincular" reply keyboard and a Telegram
  menu button (always visible left of the input, also while typing) offering "Desvincular"
  (e.g. `setMyCommands` + chat menu button of type commands), routed to the same confirm-unlink
  flow. Only for linked chats if Telegram allows per-chat scope; otherwise handle the command
  gracefully when not linked. Queued after T13 (same files).
  Evidence (2026-09-24, commit `feat(prisma): add an always-visible Telegram menu entry to unlink
  Channel A`): route: inline (2 non-trivial files, mechanical/already-understood transport+dialogue
  extension of the existing T4 typing pattern, no unresolved design decision — writer's own call per
  this task's delegation rules).
  - **Scope decision — per-chat, confirmed viable.** `setMyCommands`/`deleteMyCommands` support
    `BotCommandScopeChat` (one chat, via `chat_id`), and `setChatMenuButton` already takes an
    optional `chat_id`. Chose per-chat scope (preferred option in the brief): the "/desvincular"
    entry and the "Menú" button only ever appear in a chat that is actually linked, never bot-wide.
    Set on link (`_confirm`'s welcome branch), cleared on unlink. This codebase has exactly ONE
    unlink code path (`_link_action`'s `CALLBACK_UNLINK` branch — confirmed by T3's own search, no
    admin-side or inactivity-expiry path sends a separate unlink notice or mutates
    `registry.unlink_phone` elsewhere), and both the T3 reply-keyboard button and T14's own
    "/desvincular" command route through the SAME confirm prompt into that one branch, so "cleared on
    every unlink path" is satisfied by one clearing call there. Inactivity expiry is a silent registry
    purge with no notice today (a pre-existing gap already accepted at T3, unaffected by T14) — it
    still leaves the per-chat command/menu-button published until the next explicit unlink action;
    flagged, not fixed, as out of this task's scope.
  - **Transport** (`channel_a_transport.py`): new `ChannelATransport.set_my_commands(chat_id, command,
    description)` (`setMyCommands` with `scope={"type":"chat","chat_id":...}`),
    `delete_my_commands(chat_id)` (`deleteMyCommands` with the same scope), and
    `set_chat_menu_button(chat_id, button_type)` (`setChatMenuButton`, `button_type` closed to
    `"commands"`/`"default"`). Same owned/reused T7 session, timeouts and error classification as
    every other call; command name/description validated against Telegram's own bot-command charset
    and length bound before any I/O. Timing logged only on failure (`_log_menu_call_failed_elapsed`,
    same noise discipline as T4's `sendChatAction`) — a successful call carries no useful lag signal.
    `ChannelATextTransport` Protocol (`channel_a_bot.py`) gains the same three methods, all optional
    at runtime (probed via `getattr`/`callable`, exactly like `send_chat_action`).
  - **Command routing** (`channel_a_bot.py`): new `_UNLINK_COMMAND_PATTERN` matches
    `/desvincular`, `/desvincular@<botname>` (any username — this bot's own username is not yet
    known when the dialogue is constructed, and a private-chat update can only ever originate from
    this bot's own polling stream), and tolerates trailing text. Matched inside `_handle_message`'s
    existing command branch (`self.query is None or text.startswith("/")`), so it is structurally
    never routed to the query coordinator even when one is attached — same guarantee as T3's button
    text. Routes to the exact same `_request_unlink(...)` as the reply-keyboard button, which already
    handles "not linked" gracefully (`INGRESS_IGNORED_UNRELATED`, no data leak).
  - **Fire-and-forget menu maintenance** (`channel_a_bot.py`): new `_set_unlink_menu`/
    `_clear_unlink_menu`, called right after `_confirm`'s welcome send and right after
    `_link_action`'s unlink notice send, respectively — same background-daemon-thread shape as T13's
    `_typing`, so they never add latency to either response. Like `_typing`, no thread is even started
    when the transport declares neither relevant method (`_has_menu_capability`) — required both for
    the "never break pairing/unlinking" contract and because `test_channel_a_delivery_authority.py`
    patches `threading.Thread.start` to fail hard on any unexpected dispatch; its fake transport
    declares none of the three T14 methods, so no thread now starts there (confirmed by re-running the
    full suite after the fix, see below). Each of the two calls inside `_apply_unlink_menu`/
    `_apply_cleared_menu` is independently try/excepted, so one failing never blocks the other or the
    already-sent response.
  - **User-visible Spanish (usted):** command description "Desvincular este teléfono de la HMI"
    (`UNLINK_COMMAND_DESCRIPTION`) — no new chat message text; the existing T3 prompt/copy is reused.
  - **RED confirmed** via `git stash` of both source files: `test_channel_a_transport.py` — 59
    errors/failures (`AttributeError: no attribute 'set_my_commands'` etc.); `test_channel_a_bot.py`
    — `ImportError: cannot import name 'UNLINK_COMMAND'`. GREEN after restore.
  - **Test fallout from legitimate scope growth:** `test_source_avoids_unimplemented_channel_a_surfaces`
    (a pre-existing RCA-3a scope guard forbidding literal Bot-API-surface strings in this module's
    source) had `set_my_commands` on its forbidden list — removed with a comment, the same reasoned
    exception `send_chat_action` already got at T4 (declared on the Protocol, invoked only through
    duck-typed transport calls, never implemented here). `test_confirm_acknowledges_before_the_welcome_
    is_sent` asserted the exact synchronous `transport.calls` list; updated to assert only the
    synchronous prefix (`calls[:3]`), documented the same way T13's typing-indicator tests already
    document async-ordering non-determinism, since the new menu calls are fire-and-forget and may or
    may not have landed by assertion time.
  - **New tests:** transport — `SetMyCommandsTests`, `DeleteMyCommandsTests`, `SetChatMenuButtonTests`
    (payload shape, chat-id/command/description/button-type validation before I/O, session reuse) plus
    2 `TimingLogTests` (log-nothing-on-success, log-only-on-failure for all three calls) and the 3 new
    calls added to `TransportBoundaryTests`' fixed-HTTPS/no-redirect sweep. Bot — `ChannelAUnlinkCommandTests`
    (7: same prompt as the button, `@botname` suffix, trailing payload, a mere-prefix command is NOT
    matched, bypasses the query coordinator even when attached, graceful ignore when not linked,
    confirm reuses the real unlink) and `ChannelAUnlinkMenuTests` (8: set on link scoped to that chat,
    cleared on unlink, setup/clearing never delay the welcome/unlink response, setup/clearing failures
    never break confirm/unlink, setup/clearing skipped with no thread when the transport lacks the
    methods). `test_transport_protocol_declares_exactly_six_calls` (renamed from `...three_calls`).
  - Full suite: `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s
    services\prisma-runtime -p "test_*.py"` → **1517 passed** (was 1487; +30 net).
  - Size note: ~682 authored lines (four files: 2 production + 2 test), above the ~400-line advisory
    heuristic — two coupled layers (transport + dialogue) each needed proportional TDD coverage
    (validation-before-I/O bounds, session reuse, timing-log discipline, fire-and-forget/no-thread
    contracts); splitting transport from dialogue would have left either half untestable in isolation.
  - **Next step (user):** open a linked Telegram chat, tap the text input to bring up the system
    keyboard (hides the "Desvincular" reply keyboard), and confirm the "Menú"/commands icon next to
    the input still offers "/desvincular" — tapping it (or typing "/desvincular") should open the same
    confirm/cancel prompt as the reply-keyboard button. After unlinking, confirm the command disappears
    from that chat's menu on a fresh pairing check.

- [ ] **T15 — Unused HMI 2.5 s playback buffer (deferred by the user, 2026-09-24).** The
  `buffer-before-playback` transport (`prismaLocalAudioPlayback.ts`
  `PRISMA_LOCAL_BUFFERING_POLICY.targetBufferSeconds: 2.5`, `playLocalWorklet`,
  `PrismaPcmWorkletBuffer`, the PCM audio worklet) was built to stop choppy audio and used in
  `local` runtime mode until `36eeaa4` (2026-09-17) hard-coded `playbackTransport: 'progressive'`
  (`prismaVoiceTtsAudioSource.ts:23`, 25 ms lead). It is dead code in production and does not
  explain the current orb wait. **Revised user decision (2026-09-24): keep it as an opt-in bypass**
  instead of deleting it. Scope: a toggle in the admin General Settings → Prisma tab, OFF by
  default, stored in the shared Prisma voice configuration (runtime config, same as the rest of the
  tab); when ON, the HMI plays voice answers through the buffered transport. Buffer duration
  adjustable by the user: default 1.0 s, min 0.3 s, max 3.0 s, step 0.1 s (replaces the fixed
  2.5 s policy; validated on both runtime and HMI). Copy (formal usted): toggle "Activar buffer de
  audio"; legend "Acumula audio antes de reproducir cada respuesta. Actívelo si la voz de Prisma se
  escucha entrecortada, por ejemplo con una conexión a internet inestable. Agrega una breve demora
  al inicio de cada respuesta." (legend no longer states "un segundo", since the value is
  adjustable). Re-verify the buffered path with tests and a live test on the new model before
  exposing it (unused since 2026-09-17). Automatic underflow detection was considered and
  rejected for now (complexity vs. a rare case). **Deprioritized by the user (2026-09-24):** start
  only after the screen scaling (PW-007) and voice latency work are solved.
  **Scope extension proposed by the user (2026-09-24), pending one decision:** besides OFF, two
  modes — Manual (the user sets the cushion "by eye" within 0.3–3.0 s) and Automatic (chooses the
  best value for the current conditions, since network quality varies day to day). Evidence that
  motivates it: the 2026-09-24 ~11:30 timeline recorded one underflow (`underflow_count=1`) on an
  answer. Parent proposal for Automatic: an adaptive jitter buffer that learns from real answers
  (chunk arrival gaps vs playback rate, underflows) and moves the cushion within min–max, instead
  of a separate test request (no extra Gemini calls, adapts within the day; trade-off: the first
  answer after the network degrades may still cut once). The earlier "automatic underflow
  detection rejected" note is superseded by this user request.
- [x] **T17 — Orb "thinking" state (user decision 2026-09-24, option B).** Evidence (browser
  timeline after a real restart, 2026-09-24 ~11:30): orb visible → first sound 0.58–0.79 s (1.11 s
  on the first answer after startup, of which 0.38 s is the first AudioContext start), 0.15 s for a
  cached answer; ~0.5–0.7 s of it is Gemini's first-audio time, our own share ~0.07 s; all events
  via SSE; no session resets; the first question after restart worked. Decision: show a distinct
  "thinking" orb look from event received until playback starts, then the speaking look; never stay
  in thinking forever (fall back on error/timeout). Visual options being mapped (read-only).
  **Design agreed with the user (2026-09-24):** the orb's own two internal states in
  `leda-orb.js` (idle breathing vs `speaking` voice modulation driven by the audio engine) stay
  untouched. The change lives only in the overlay container: thinking = ~75 % scale and ~60 %
  opacity (orb keeps its native idle breathing, no extra CSS pulse because a removed CSS animation
  snaps instead of interpolating); on playback start, scale and opacity interpolate to 100 % over
  ~400 ms with an ease curve while voice modulation starts; when speech ends, a smooth fade-out
  replaces today's abrupt disappearance (user reports it vanishes abruptly; today `fading` lasts
  200 ms); if audio never starts, a bounded timeout fades it out. Existing hooks: phase
  `buffering` declared but unused in `usePrismaOrbPresentation.ts`, engine `onStarted` wired to a
  no-op. Durations/scales as named constants; `prefers-reduced-motion` keeps the current
  no-transition behavior.
  Evidence (2026-09-24, commit `041af41`) — implemented exactly as agreed, engine untouched:
  - **Schema/generated bindings.** Renamed the `orb-phase` payload's `phase` enum value
    `buffering` → `thinking` in `schemas/prisma-audio-record.v1.schema.json` (both the
    `x-payload-enums` and `properties.payload.properties.phase` copies) and regenerated both
    projections via `schemas/generate_prisma_audio_bindings.py`
    (`services/prisma-runtime/src/prisma_runtime/audio_record_types.py`,
    `hmi-app/src/domain/prismaAudioMetric.generated.ts`) — the unrelated `buffering-complete`
    record type (PCM pre-buffering, a different concept) was left untouched, confirmed by grep
    before and after. No test hardcoded the old `"buffering"` phase value, so only the schema-drift
    tests needed the regeneration to turn green.
  - **`usePrismaOrbPresentation.ts`.** Phase type is now `'hidden' | 'thinking' | 'visible' |
    'fading'`. New named constants: `PRISMA_ORB_FADE_DURATION_MS = 700` (was 200 — chosen at the
    low end of the user's 600-800 ms range: long enough to read as a fade, short enough not to
    linger), `PRISMA_ORB_GROW_DURATION_MS = 400` (thinking→visible), `PRISMA_ORB_THINKING_TIMEOUT_MS
    = 9_000` (chosen from the user's 8-10 s range — comfortably above every first-chunk time T13
    measured live, 0.6-2.1 s typical, up to 8.7 s stream end on the retired TTS model). Phase type
    `PrismaOrbPresentationPhase` is now a direct alias of the generated `PrismaAudioMetricPhase`
    (T16's timeline schema type) instead of a separately hand-maintained union, so the hook and the
    timeline schema can never silently drift apart (post-review fix, see below).
    `presentVoiceEvent` now sets phase `thinking` (was `visible`) and starts a bounded
    `thinkingTimeoutRef` timer alongside `engine.play(...)`; `onStarted` (previously a no-op) now
    clears that timer and moves to `visible`; the thinking-timeout callback and `onEnded`/`onError`
    all route through the same `beginFade` used before (guarded by generation +
    `terminalCallbackHandled`, unchanged pattern). A new voice event arriving during `visible` or
    `fading` always re-enters `thinking` unconditionally (no special-casing by current phase) — the
    "no hard jump" requirement is satisfied by the overlay's own CSS transition interpolating from
    wherever it currently is, not by any extra state-machine logic. `engine.play`'s call signature
    and the `VoicePlaybackLifecycle` contract (`onStarted`/`onEnded`/`onError`) are unchanged; no
    edits to `prismaVoiceAudioEngine.ts` or `leda-orb.js` (verified: `git status` shows neither
    file touched).
  - **`PrismaOrbOverlay.tsx`.** Renders for `thinking`/`visible`/`fading` (still `null` for
    `hidden`, so the overlay stays mounted through the whole fade as required). Three named class
    constants (`PRISMA_ORB_THINKING_CLASSES = 'scale-75 opacity-60'`, `_VISIBLE_ = 'scale-100
    opacity-100'`, `_FADING_ = 'scale-75 opacity-0'`) picked by a small `phaseClasses()` switch,
    using Tailwind's own default scale/opacity steps (60/75/100/0 are all on the default scale, no
    arbitrary values needed). Fading eases the scale back toward the thinking scale (75%) instead
    of staying at 100% while fading out, per the brief's "optionally ease scale back" — avoids the
    orb ballooning to full size right before disappearing. Transition property changed from
    `transition-opacity` to `transition-[opacity,transform]` (GPU-friendly: opacity + transform
    only); `motion-reduce:transition-none motion-reduce:duration-0` kept unchanged, so reduced
    motion still skips the transition entirely regardless of duration (verified by a new test
    re-asserting the same base classes across thinking/visible/fading).
  - **TDD.** RED confirmed for the schema-drift tests (4 failures: stale hash + stale body, both
    languages) before regenerating bindings; full prisma-runtime suite green after regeneration
    (1517 passed, unchanged count — pure rename, no new record types). RED confirmed for the
    frontend behavior change itself by running the pre-existing hook/overlay tests against the new
    code before touching the tests: 6 failures, all exactly the expected ones (phase `'visible'` →
    `'thinking'` right after `presentVoiceEvent`, stale `data-testid` lookups once `opacity-100`
    stopped being the immediate post-event class). Rewrote both test files (hook: 10→16 tests;
    overlay: 7→9 tests) adding: thinking→visible on `onStarted`; fade uses the new 700 ms duration
    and stays mounted until it elapses; bounded thinking-timeout fade when `onStarted` never fires;
    timeout is cleared once `onStarted` does fire; new event mid-fade restarts at thinking without
    unmounting; `orb-phase` timeline records for the full `thinking→visible→fading→hidden` cycle and
    for the never-started `thinking→fading→hidden` path; reduced-motion classes present in every
    phase; the engine's `play()` lifecycle-callback contract (`onStarted`/`onEnded`/`onError`, 3
    keys, nothing added) is unchanged; the hook itself never calls `orb.setSpeaking` (that stays the
    engine's job). All GREEN after implementation.
  - **Checks:** `cd hmi-app && npm test` → 2427 passed (was 2418). `npx tsc -b` clean. `npm run
    lint` clean. `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s
    services\prisma-runtime -p "test_*.py"` → 1517 passed (unchanged — pure schema rename).
  - **Post-commit code-review fixes (non-blocking findings, applied same pass, commit `74f5c1b`).**
    The repo's own commit-time review flagged two duplication risks: (1) the duration
    numbers existed in two places (the JS constants and the literal `duration-[400ms]`/
    `duration-[700ms]` Tailwind classes) — fixed by reading `PRISMA_ORB_GROW_DURATION_MS`/
    `PRISMA_ORB_FADE_DURATION_MS` directly into an inline `style.transitionDuration` in
    `PrismaOrbOverlay.tsx` instead of a Tailwind arbitrary-value class, confirmed safe because
    `motion-reduce:transition-none` clears `transition-property` (not just the duration), so an
    inline duration never fights reduced motion. (2) `PrismaOrbPresentationPhase` duplicated the
    generated `PrismaAudioMetricPhase` union by hand — fixed by making it a direct type alias of the
    generated type instead. Re-ran the full check set after both fixes: `npm test` still 2427
    passed, `tsc -b` clean, `lint` clean.
  - **Next step (user, live check):** open the HMI and ask Prisma a voice question. Look for: (1)
    the orb appearing smaller/dimmer ("thinking") right when the question lands, still breathing
    natively, no extra pulsing; (2) a smooth grow to full size/opacity exactly when the voice starts
    speaking (no snap); (3) a smooth ~0.7 s fade-out at the end instead of the old abrupt
    disappearance; (4) if practical to test, a stalled/failed answer should still fade the orb out
    after a few seconds rather than leaving it stuck "thinking".

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
- 2026-09-23: T10 writer ran units 1-4 of the user-approved plan (split timing, persistent warm
  Gemini client, exact-text audio cache, server-side prefetch scoped to `/local/ask`), each with
  strict TDD (RED confirmed before every implementation) and a green full prisma-runtime suite after
  every commit (`163435d`, `5ded8a3`, `98b2f1b`, `691ab1d`, `b9cfc04`; suite grew 1376 → 1390 → 1384 →
  1395 → 1402 as units landed — note unit ordering in the commits differs slightly from the plan's
  listed order: unit 2 before the unit-1 follow-up's full count, unit 4 before unit 3, since unit 4
  only needed unit 2's secret hash, not unit 3's prefetch). Mid-task, new user-supplied evidence (a
  standalone Gemini benchmark showing ~1.3s median TTFB vs the runtime's 2.3-6.7s) prompted expanding
  unit 1 to instrument the full pre-Gemini pipeline, which surfaced a real, unfixed finding: up to 3x/
  2x redundant `resolve_voice_event`/credential-resolve calls inside `AudioCoordinator.subscribe()`/
  `_run()` (see unit 1's evidence above) — flagged for a future task, not fixed here (out of T10's 5
  planned units). Unit 5 (SSE push) was not attempted: this writer's brief forbade starting/stopping
  the runtime/launcher, and unit 5's own bar requires a live Vite-proxy verification no static
  read or headless test can substitute for. T10 stays unchecked (partial); see unit 5's evidence
  entry above for the recommended follow-up. Route: delegated writer (multi-file, behavior-changing
  work across `voice_service.py`, `gemini_credentials.py`, `event_audio.py`, `local_presentation.py`
  and their tests; touched only `services/prisma-runtime` and this doc).
- 2026-09-23: T11 (switch TTS to `gemini-3.8-flash-lite-tts` + `generate_content_stream`, plain
  transcript) and T12 (remove the redundant per-request resolves T10 unit 1 found) implemented and
  committed (`bd10a52`, `9521bbe`). Full prisma-runtime suite green after each (1407, then 1408
  tests). T12 reduced the Gemini credential resolve from 2x to 1x per request but deliberately left
  `resolve_voice_event`'s 3x unchanged after finding both `AudioCoordinator`-internal calls
  load-bearing (synchronous 404/401 mapping vs. queue-wait TOCTOU protection) — see T12's evidence
  above for the full reasoning and the flagged follow-up. This writer's brief forbade starting the
  runtime/launcher or calling Gemini for real, so both tasks used fakes only (no live Gemini call,
  no live voice test) — the cost/behavior of the new model and the credential-resolve trade-off are
  unverified against the real API/runtime and need the user's next live voice test. Route: delegated
  writer (multi-file, behavior-changing work across `voice_service.py`, `gemini_credentials.py`,
  `event_audio.py` and their tests; touched only `services/prisma-runtime` and this doc).
- 2026-09-23 (parent, authorized real-API smoke test of the committed T11 helpers at `9521bbe`):
  `_create_tts_stream` + `_iter_tts_audio_parts` + `_decode_audio_inline_data` against
  `gemini-3.8-flash-lite-tts` → first audio 0.62 s and 0.70 s (3.4 s and 7.1 s of audio); the real
  mime type `audio/l16; rate=24000; channels=1` passes validation. Full suite 1408 passed
  (parent spot check).
- 2026-09-24: T13 writer implemented all five scoped units from the 2026-09-24 live test
  (a: in-memory Gemini secret with mtime-based cache invalidation; d: found and fixed the Gemini
  TTFB gap via a longer httpx keepalive_expiry, evidence-backed by a live standalone measurement;
  b: prefetch for Channel A answers via a new short-lived event-scoped token; e: fire-and-forget
  Telegram typing indicator; c: push voice events to the HMI over SSE, backend+frontend, with full
  test coverage but a pending live Vite-proxy check since the launcher was running and could not be
  restarted). Commits `5411978`, `74cf145`, `7e84d4f`, `acea713`, `82345d0`. Full
  prisma-runtime suite green after each (1417 → 1418 → 1428 → 1429 → 1442 tests); full hmi-app suite
  green for unit (c)'s frontend half (2384 tests, `tsc -b` and `eslint` both clean). Route: delegated
  writer (multi-file, behavior-changing work across `gemini_credentials.py`, `voice_events.py`,
  `local_presentation.py`, `channel_a_bot.py` and their tests in `services/prisma-runtime`, plus
  `prismaAssistant.config.ts`, `vite.prismaProxy.config.ts`, `prismaSessionClient.ts`,
  `voiceEventListener.service.ts`, `useVoiceEventListener.ts` and their tests in `hmi-app`; touched
  only those two trees and this doc).
- 2026-09-24: T13b writer fixed all three verifier findings on T13's SSE unit (c). Blocking: the HMI
  session capability no longer travels in the SSE URL — the frontend reads the stream with a
  `fetch`-based reader through `prismaSessionClient.fetch()` (header-only, same transport polling
  uses), and the server-side `?capability=` fallback is removed (commit `82e9378`); a same-pass
  review fix reordered the SSE frame parser's overflow guard to extract complete frames before
  clearing an unterminated remainder (commit `795f926`). Should-fix: concurrent SSE streams are now
  capped per-owner and globally in `VoiceEventStore`, well below the 64-session registry, with a
  clean 429 (not a mid-stream crash) once the cap is hit (commit `c590523`). Defense in depth
  (explicitly requested by the brief): a Werkzeug access-log filter redacts query strings in both
  Flask processes' request logs (commit `e29d4c6`). Full suites green after every commit
  (prisma-runtime 1443 → 1443 → 1451 → 1459; hmi-app 2392 tests, `tsc -b` and `eslint` both clean
  throughout). This writer's brief again forbade starting/stopping the runtime/launcher, so the
  capability-out-of-URL fix and the bounded-connections fix are unverified against the real
  launcher/Vite proxy, same as `82345d0` itself — see Next step. Route: delegated writer (multi-file,
  behavior-changing work across `local_presentation.py`, `voice_service.py`, `voice_events.py` and
  their tests in `services/prisma-runtime`, plus `prismaSessionClient.ts`,
  `voiceEventListener.service.ts`, `vite.prismaProxy.config.ts` and their tests in `hmi-app`, plus a
  new `access_log_redaction.py` and its test; touched only those two trees and this doc).
- 2026-09-24: T16 writer made the browser voice timeline observable server-side (diagnostics only,
  no fix attempted): extended the closed audio-record schema with 7 browser record types, a new
  `prismaVoiceTimelineRecorder.ts`/`prismaVoiceTimelineDiagnosticsSink.ts` pair on the frontend
  batches and POSTs them through a new `POST /hmi/voice/timeline` route
  (`voice_timeline_diagnostics.py`), which writes one WARNING log line per record to
  `prisma-presentation-stderr.log`. Wired: orb phase, voice-event delivery source, speak-live
  request/response/stale-discard, every session reset (with cause), and AudioContext resume
  outcomes. Fixed a pagehide/session-reset race found while implementing (the naive design silently
  lost the final batch) with a new `PrismaSessionClient.sendBeacon()`. Commits `c605519`, `9db0368`,
  `2964d1a` (the latter two are code-review follow-ups on the first). Full suites green after every
  commit (prisma-runtime 1487, was 1459; hmi-app 2418, was 2392; `tsc -b` and `eslint` both clean).
  Route: delegated writer (multi-file, behavior-changing work across `services/prisma-runtime` and
  `hmi-app`; forbidden from starting/stopping the runtime/launcher, so this is unverified against a
  real live voice test — see Next step).

## Next step

Next: a live voice test with the user, covering everything still unverified against the real
runtime:
1. **T16, highest priority (new)**: restart the launcher (picks up the new
   `/hmi/voice/timeline` route and the browser diagnostics sink) and repeat the exact 2026-09-24
   09:39–09:51 scenario: ask the first question right after the restart (this is the one that
   previously showed neither orb nor voice), then 4-5 more ordinary questions. The parent then
   reads `prisma-presentation-stderr.log` for `HMI voice timeline: run=... seq=... type=... t_ms=...
   extra=...` lines (no browser console needed) to see, per question: `voice-event-received` (source
   sse/poll) → `orb-phase` transitions (hidden→visible→fading→hidden, or a `hidden` with no prior
   `visible` if the orb never showed) → `speak-live-request-start`/`speak-live-response-received` →
   any `speak-live-stale-discarded` or `session-reset` (reason=unauthorized-401 means a concurrent
   401 raced the request; reason=explicit is an ordinary pagehide/reset) → any `audio-context-state`
   (state=suspended when=at-play means the browser needed a resume; when=after-resume shows whether
   it succeeded) — cross-referenced with the existing server-side speak-live timing lines already in
   the log. This should finally show which of the two named candidates (session-reset race vs.
   AudioContext autoplay) explains the first-question miss, or reveal a third cause. Observability
   only in this pass — no fix attempted yet; a follow-up task should read this log, confirm the root
   cause, and fix it.
2. **T13b / T13 unit (c)**: after the next launcher restart (so it picks up the
   new SSE code — restarting also deletes the logs and invalidates every in-memory session
   capability, including any leaked by the pre-T13b query-string fallback), confirm the orb/audio
   experience is unchanged and that `GET /hmi/voice/events` streams live through the real Vite
   dev-server proxy (5173 → 5057) without buffering — open the HMI, check the Network tab for a
   `fetch`/`text/event-stream` connection to `/api/prisma/events/stream` with the session
   capability in its request header and **no `capability=` in the URL**, ask a question, and confirm
   the answer arrives at least as fast as before (no regression), with polling never engaging unless
   the SSE connection is deliberately broken. Also confirm `prisma-presentation-stderr.log` never
   shows a raw capability value again, even for an unrelated route's query string.
3. T13 units (a)/(b)/(d)/(e): read the updated `credential_elapsed_ms`, `time_to_first_byte_ms`, and
   Channel A update-handling timings in the logs to confirm the measured improvements hold live
   (in-memory secret cache should show near-zero `credential_elapsed_ms` on repeat requests; Gemini
   TTFB should drop close to the ~0.6-0.7s standalone figure even after idle gaps between
   questions; a Channel A phone answer should also get audio on the HMI without waiting for the
   1s poll; Channel A update handling should return close to the pre-T4 ~0.38s again).
4. T10 units 1-4's latency improvement, T11's new model/voice sounding right end-to-end, and T12's
   documented credential-resolve trade-off (all still pending their own first live confirmation from
   before T13).
5. **User manual check of T2/T3/T4 in Telegram**, since these are UX changes best confirmed live:
   - **T2**: pair a phone via QR; the confirmation prompt should read "Confirme para hacerle
     preguntas a Prisma desde aquí; le responderá en pantalla y con voz." (no "documento").
   - **T3**: after confirming, a persistent "Desvincular" button should appear under the input and
     stay visible through later messages. Tapping it should ask for confirmation with "Confirmar
     desvinculación"/"Cancelar" inline buttons — confirming should unlink and remove the persistent
     button; cancelling should keep the link and the button. The inactivity-warning message (idle
     ~9 minutes) should show only "Seguir conectado" now, not a second inline "Desvincular".
   - **T4**: send an ordinary question; Telegram should show "Prisma está escribiendo…" (now
     fire-and-forget) before the answer arrives, without the answer itself feeling delayed.

After that: T14 is done (see its own evidence above, including the user's next Telegram check) and T15
(deferred by the user) remains open, not started.
