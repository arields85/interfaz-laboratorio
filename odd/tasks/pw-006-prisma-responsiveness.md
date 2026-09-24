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

## Next step

Next: a live voice test with the user is now the priority — it covers three still-unverified things
at once: (1) T10 units 1-4's latency improvement (read `Prisma Gemini TTS: time_to_first_byte_ms=`,
`Prisma TTS cache:`, and the other T10 log lines), (2) T11's new model/voice actually sounding right
end-to-end over the real Vite→voice-service→Gemini path (this writer only exercised it against
fakes), and (3) T12's documented credential-resolve trade-off not causing a surprise (it only
changes behavior when Gemini credentials are entirely unconfigured, which should not be the case in
the user's normal setup). After that: a follow-up pass for T10 unit 5 (SSE push), run with the
launcher available so the Vite proxy can be checked live. In parallel, **user manual check of
T2/T3/T4 in Telegram**, since these are UX changes best confirmed live:
- **T2**: pair a phone via QR; the confirmation prompt should read "Está a un paso: confirme y
  Prisma responderá sus consultas en este chat." (no "documento").
- **T3**: after confirming, a persistent "Desvincular" button should appear under the input and
  stay visible through later messages. Tapping it should ask for confirmation with "Confirmar
  desvinculación"/"Cancelar" inline buttons — confirming should unlink and remove the persistent
  button; cancelling should keep the link and the button. The inactivity-warning message (idle ~9
  minutes) should show only "Seguir conectado" now, not a second inline "Desvincular".
- **T4**: send an ordinary question; Telegram should show "Prisma está escribiendo…" briefly before
  the answer arrives.
