# Live test 2026-09-25 — runtime defects — ODD bug-fix tracker

> ODD bug fix (not SDD). Worktree `D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\runtime-fixes`,
> branch `fix/live-test-runtime`, from `main` `d9455ed`.

## Objective

Fix three runtime defects found during the user's live test on 2026-09-25 (F1-F3), plus one
follow-up request added mid-task (F6): Channel B voice-note replies never arriving in protected
credential mode, a slow first Channel A voice-note transcription, Channel A inactivity/expiry
messages falling back to "la HMI" instead of the confirmed destination label, and a Channel B
typing indicator mirroring Channel A's PW-011 M5 behavior.

## TDD

Strict TDD: enabled (source: session configuration "Strict TDD Mode: enabled").
Runner: `D:\Proyectos\Interfaz-HMI\Interfaz-HMI\services\leda-runtime\.venv\Scripts\python.exe -m
unittest discover -s D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\runtime-fixes\services\leda-runtime -p "test_*.py"`.
Baseline (worktree, before changes, 2026-09-25): **1730 tests, 2 pre-existing environmental
failures, 2 skipped** — `test_real_missing_import_is_normalized_to_bootstrap_remedy_under_stop_preference`
and `test_cancellation_during_voice_startup_rolls_back_only_the_launched_child`, both because this
worktree has no `.venv\Scripts\python.exe` of its own (they spawn a subprocess with the
repository-owned interpreter path, which only exists in the main checkout). Unrelated to this task,
not touched.

## Tasks

- [x] **F1 — Channel B voice-note replies never arrive in protected credential mode.** Root cause:
  `telegram_config.telegram_token()` always returns "" when `LEDA_CREDENTIAL_MASTER_KEY_FILE` is
  set (protected mode), so `voice_service.py`'s `_telegram_token()` never resolves the Channel B bot
  token from the protected credential store, silently cancelling every Telegram voice job. Fix:
  resolve the "telegram" secret from the protected `CredentialService` in `voice_service.py`, mirroring
  `gemini_credentials.py`'s own resolver/cache pattern; add WARNING logging (no secret) for a
  cancelled-for-missing-token job and for an exhausted sendVoice/sendDocument delivery. Route:
  delegated writer equivalent (multi-file: `telegram_credentials.py`, `voice_service.py`, tests).
  **Done 2026-09-25** — see Evidence below.
- [x] **F2 — Channel A's first voice-note transcription after pairing is slow (~30s vs ~3s later),
  timing out against presentation's client timeout.** Investigate `voice_transcription.py`/
  `voice_service.py` client warm-up vs TTS. Fix the identifiable cold-start cause (a real network
  touch at boot, not just building the client object) and add WARNING+elapsed_ms diagnostics on
  both sides of the transcription round trip. Do not redesign the synchronous-on-poll-thread
  architecture. Route: delegated writer equivalent (`voice_service.py`, `local_presentation.py`, tests).
  **Done 2026-09-25** — see Evidence below.
- [x] **F3 — Channel A inactivity warning/expiry messages fall back to "la HMI" instead of the
  confirmed pairing label.** Root cause: the M3 sweep re-reads `_read_label(owner_id)` at sweep
  time, which is freshness-bound to a live HMI session and fails exactly when a sweep is due (the
  session has gone idle). Fix: capture the label shown in `WELCOME_TEMPLATE` at confirmation time
  on the local action record, and use it for both the warning and expiry copy; keep the "la HMI"
  fallback only when no label was ever captured. Route: inline/delegated writer equivalent
  (`channel_a_bot.py`, tests). **Done 2026-09-25** — see Evidence below.
- [x] **F6 (added mid-task, same worktree/branch/rules) — Channel B typing indicator.** While
  Channel B is processing a question (text or voice note), send the Telegram "typing" chat action,
  non-blocking, and stop it once the text answer for that message has already gone out — same
  per-message "answered" flag design as Channel A's PW-011 M5
  (`_send_typing_unless_answered`/`_typing`), reusing that helper/pattern rather than duplicating
  it. Also verify (test) that the Channel B voice-reply job's existing `record_voice` chat action
  actually fires once F1 resolves a real token from the protected store. Route: delegated writer
  equivalent (`channel_a_bot.py`, `local_presentation.py`, tests + 4-6 existing test-helper
  `build_bot()` sites in `test_telegram_lifecycle.py`/`test_telegram_diagnostics.py` need a
  `_typing` stub to keep the existing offline-dispatch-guarded suite hermetic). **Done 2026-09-25**
  — see Evidence below.
- [x] **F7 (added mid-task, same worktree/branch/rules) — transcription generation config + active
  machine/screen names as extra_terms.** (a) Pass a tuned `GenerateContentConfig`
  (`thinking_budget=0`, `temperature=0`, `max_output_tokens=128`, named constants) on every
  `transcribe_voice_note` call — an authorized live benchmark found this nearly halves warm
  latency with identical accuracy. (b) Bias the transcription prompt with the active HMI context's
  machine/screen names for both channels (Channel B already had this for one name; widened to
  both, deduplicated, bounded; Channel A newly reads its own owner's context through the same
  guarded `session_registry.capture_owner_context` the query coordinator itself uses). Route:
  delegated writer equivalent (`voice_transcription.py`, `local_presentation.py`,
  `channel_a_bot.py`, tests). **Done 2026-09-25** — see Evidence below.

## Acceptance criteria

- F1: a Channel B voice job resolves a real Telegram bot token in protected mode, exactly like the
  presentation process's own bot construction; env-mode behavior unchanged; Channel A unaffected
  (confirmed Channel A never calls `voice_service.telegram_token()`/`_telegram_token()` — its own
  Telegram messaging always uses the separate `telegram_channel_a` credential via
  `channel_a_credentials.py`/`ChannelATransport`, and its answer-audio publish path never sets
  `telegramChatId` in production).
- F2: the boot-time warm-up performs a real, cheap (non-generating) network round trip; every
  transcription failure/timeout logs elapsed_ms and a redacted reason on both processes.
- F3: the warning/expiry copy uses the label confirmed at pairing time even when a fresh
  `destination_label()` read would fail (idle/stale HMI session), falling back to "la HMI" only
  when no label was ever captured for that action record.
- F6: Channel B shows "typing…" while processing, never after its own text answer already sent;
  the voice-reply job's `record_voice` indicator is proven to fire once a protected-mode token
  resolves.
- F7: transcription calls carry the tuned generation config; both channels bias the transcription
  prompt with the active machine/screen names available to them, read through each channel's own
  already-guarded accessor (no new, weaker read path).
- Runtime suite green (2 known pre-existing worktree-`.venv` environmental failures acceptable, named).

## Evidence

### F1 — Channel B protected-mode Telegram token (`telegram_credentials.py`, `voice_service.py`)

- Root cause confirmed by reading: `telegram_config.read_telegram_config()` forces `token=""`
  whenever `LEDA_CREDENTIAL_MASTER_KEY_FILE` is set (protected mode) — by design, so the legacy
  env var can never leak in protected mode — but `voice_service.py`'s `_telegram_token()` called
  only `telegram_token()`, so it always got "". `_send_same_leda_audio_to_telegram`
  (`if not token: _cancel_telegram_job(job); return`) and `_create_interactions_tts_job`'s encoder
  creation (`if valid_chat is not None and _telegram_token(): ...`) both silently no-opped.
- Fix: `telegram_credentials.py`'s `TelegramCredentialResolver` gained an mtime-based cache
  (mirrors `gemini_credentials.GeminiCredentialResolver` exactly — same
  `runtime_paths().credential_database` stat-based invalidation). `voice_service.py` gained
  `_default_telegram_credential_service()` (identical construction to
  `gemini_credentials._default_service`) and a module-level `telegram_credentials` resolver;
  `_telegram_token()` now reads `read_telegram_config()` for the `enabled`/`source` gate, and in
  protected mode resolves via `telegram_credentials.resolve()` (same "telegram" secret the
  presentation process's own `TelegramCredentialResolver(os.environ, lambda: credentials)`
  already reads for Channel B's own bot construction), logging one WARNING (no secret) on
  failure. Env mode behavior is unchanged (still reads `LEDA_LOCAL_TELEGRAM_BOT_TOKEN` directly,
  never calls the protected resolver).
- Added WARNING logging in `_send_same_leda_audio_to_telegram`: once when cancelled for a
  missing token (event_id only, no secret), once when every sendVoice/sendDocument attempt is
  exhausted.
- Channel A cross-check (task's own instruction): grepped and read `channel_a_credentials.py`,
  `channel_a_manager.py`, `channel_a_transport.py` — Channel A's Telegram messaging always uses
  the separate `telegram_channel_a` credential (`ChannelACredentialResolver`, never touches
  `telegram_config`/`voice_service.telegram_token()`). `voice_service._generate_event_audio` reads
  `event.get("telegramChatId")`, but `channel_a_on_outcome`'s own `voice_events.publish(...)` call
  never sets `telegramChatId` in production — that path is a vestige, not live for Channel A. No
  Channel A behavior change.
- RED evidence: `TelegramCredentialResolver.__init__() got an unexpected keyword argument
  'mtime_probe'` (3 new cache tests); `AttributeError: module 'leda_runtime.voice_service' has
  no attribute 'telegram_credentials'` (new `_telegram_token()` tests) before implementation.
- Checks: `tests.test_telegram_credentials` — 14 OK. `tests.test_voice_service` — 85 OK (targeted
  run). Full suite after F1+F2 — 1747 tests, same 2 pre-existing environmental failures.
- Commit: `a685a9b`. Process note: `git commit -- <pathspec>` re-stages a pathspec's full
  working-tree diff (an implicit `git add <pathspec>`), which silently absorbed F2's
  already-written-but-intentionally-unstaged hunks in `voice_service.py`/`test_voice_service.py`
  into this commit too (confirmed via `git show --stat`) — content is correct, only the commit
  boundary for those two files is not cleanly isolated from F2.

### F2 — cold Gemini connection + transcription latency diagnostics (`voice_service.py`, `local_presentation.py`)

- Root cause (identifiable, not fully explained by profiling alone): boot-time warm-up
  (`_warm_up_gemini_client_in_background`) only built the Gemini SDK client OBJECT
  (`WarmGeminiClient.warm_up`) — the genai SDK's underlying httpx client opens its real TCP/TLS
  connection lazily, on the first real API call. The first live voice note after pairing was
  therefore the first REAL network call this process ever made to Gemini, paying the full
  cold-connection cost (~30s observed) instead of a normal call (~3s).
- Fix: `_warm_up_gemini_client_in_background` now performs one cheap, non-generating
  `client.models.get(model=TTS_MODEL)` touch after building the client — the same call
  `GeminiVerificationService` already uses to verify a key, consuming no generation quota — still
  fully best-effort (never raises, never blocks startup, never logs the secret).
- Added elapsed_ms + redacted-reason WARNING logging on both sides of the transcription round
  trip: `voice_service.py`'s `voice_transcription()` route (empty-transcript and provider-failure
  branches) and `local_presentation.py`'s `_request_voice_transcription` (network exception,
  non-200 status, empty transcript).
- Architecture preserved: no change to the synchronous-on-poll-thread design (per instruction).
- RED evidence: `test_boot_warm_up_builds_the_client_and_performs_one_real_network_touch` failed
  (`_warm_gemini_client.get`/`.models.get` never called — old code only called `.warm_up(...)`);
  logging tests failed with no WARNING captured, before implementation.
- Checks: `tests.test_voice_service` + `tests.test_local_presentation` — 150 OK (targeted).
- Commit: `eff09e6` (`local_presentation.py`/`test_local_presentation.py` only — see F1's process
  note above for why `voice_service.py`'s share of this fix landed in `a685a9b` instead).

### F3 — confirmed pairing label for warning/expiry copy (`channel_a_bot.py`)

- Root cause confirmed: `_warn_one`/`_cleanup_one` called `self._read_label(owner_id)` —
  `destination_label` → `session_registry.get_owner_name(owner_id, max_age_seconds=15.0)` —
  freshness-bound to a LIVE HMI session. An inactivity/expiry sweep is, by definition, only due
  once that session has gone idle, so the fresh read reliably fails exactly when needed, falling
  back to "la HMI" instead of the destination the human actually confirmed.
- Fix: `_Action` gained a `label: str | None = None` field; `_remember_action` (called from
  `_confirm`) now captures the SAME `label` variable `WELCOME_TEMPLATE` shows the human at
  confirmation (already validated equal to `claim.label` at that point). `_warn_one` reads
  `record.label` directly (no more `_read_label` call at sweep time). `_cleanup_one` looks up its
  own action record via `_action_for(link.phone_id, link.owner_id, link.generation)` — still
  present at that point, since `send_expiry_cleanup()` only purges it AFTER every `_cleanup_one`
  call in that sweep completes — and reads `record.label`. `_display_label`'s existing "la HMI"
  fallback still applies whenever no record or no captured label exists.
- RED evidence: two rewritten tests (`test_the_warning/expiry_copy_uses_the_label_confirmed_...`)
  failed with the old fallback text ("la HMI") instead of the confirmed label, since the old code
  re-read a since-nulled `self.labels["value"]`; a stale-field-set assertion
  (`test_at_most_one_action_record_per_link`) failed on the new `label` field before it existed.
- Checks: `tests.test_channel_a_bot` — 277 OK (targeted).
- Commit: `ce668f8`.

### F6 — Channel B typing indicator (`channel_a_bot.py`, `local_presentation.py`)

- Extracted Channel A's PW-011 M5 dispatch-skip decision into a module-level
  `channel_a_bot.send_chat_action_unless_answered(chat_id, answered, send, *, action="typing")`;
  `ChannelAPairingDialogue._send_typing_unless_answered` now delegates to it (kept as a thin
  staticmethod only so that class's own existing tests, which call it via the class, keep
  working).
- `TelegramLocalBot` gained `_send_chat_action`/`_typing` (same per-message `threading.Event`
  contract as Channel A) and `_handle_message`'s paired-chat branch now wraps voice-transcription
  + `/status`/`/help`/answer processing in `try/finally`, arming typing before and marking
  `answered.set()` right after, mirroring Channel A's own `_handle_query` exactly.
- **Design decision (risk mitigation, not in the original ask, but required for safety):** typing
  is opt-in via a new `typing_enabled: bool = False` constructor parameter, defaulting to
  disabled — mirrors this exact file's own existing `voice_url`/`local_http` gating precedent for
  Channel B's voice-reply feature. Reason: dozens of existing tests construct `TelegramLocalBot`
  directly (not through the production factory) and call `_handle_message` against an
  offline-dispatch-guarded `requests.Session` with no mock for a chat-action call; an
  always-on background typing thread calling the real (unmocked) `_call` would have both raced
  real assertions non-deterministically and tripped `install_offline_dispatch_guard`'s "no real
  HTTP dispatch" assertion across the whole `test_telegram_lifecycle.py`/`test_telegram_diagnostics.py`
  suite. Confirmed empirically: an always-on first draft broke
  `test_state_write_failure_retries_same_update_without_acknowledging_it` (a direct construction,
  not using any `build_bot()` helper) by polluting its own custom `_call` recorder with the
  typing thread's concurrent `sendChatAction` call. The production factory (`create_app`'s
  `TelegramLifecycleManager` bot factory) is the only caller that passes `typing_enabled=True`
  (new test: `test_production_factory_enables_the_channel_b_typing_indicator`); every other
  construction site keeps its exact prior behavior with zero per-test changes needed beyond the
  4-6 defensive `bot._typing = Mock(return_value=None)` stubs already added (now redundant given
  the opt-in default, kept as explicit intent documentation).
- Also verified (separate commit `e5b09b9`, per the coordinator's explicit request): F1's
  protected-mode token fix and the existing `record_voice` chat-action indicator
  (`_start_telegram_recording_indicator`/`_telegram_chat_action`, unrelated to this typing
  indicator — that one lives on the voice process for the TTS voice-reply job) compose correctly
  — `test_telegram_chat_action_sends_record_voice_when_a_protected_mode_token_resolves` and
  `test_recording_indicator_actually_starts_in_protected_mode_once_a_token_resolves`.
- RED evidence: `AttributeError: 'TelegramLocalBot' object has no attribute '_typing'`/
  `'_send_chat_action'` on all new wiring tests, before implementation.
- Checks: `tests.test_telegram_lifecycle` + `tests.test_telegram_diagnostics` +
  `tests.test_runtime_safety` — 420 OK (targeted). Full suite — 1757 tests, same 2 pre-existing
  environmental failures.
- Commits: `c1005d5` (feature), `e5b09b9` (record_voice verification).

### F7 — tuned generation config + active machine/screen names (`voice_transcription.py`, `local_presentation.py`, `channel_a_bot.py`)

- (a) `voice_transcription.py` gained `GEMINI_TRANSCRIPTION_THINKING_BUDGET = 0`,
  `GEMINI_TRANSCRIPTION_TEMPERATURE = 0`, `GEMINI_TRANSCRIPTION_MAX_OUTPUT_TOKENS = 128`;
  `transcribe_voice_note` now builds and passes a `genai.types.GenerateContentConfig` on every
  call. Evidence basis (authorized live benchmark, reported by the coordinator, not independently
  re-run by this task): google-genai 2.17.0, model `gemini-3.8-flash`, 5 synthesized Spanish
  questions — warm median 2292 ms with no config vs 1224 ms with this config, identical accuracy;
  cold first call ~2.3 s for both either way (confirms the ~30 s cold case F2 fixed is not the
  model/config itself). `gemini-3.8-flash-lite` confirmed NOT to exist (404) — the model id is
  unchanged.
- (b) New shared `local_presentation._voice_note_context_terms(context)`: extracts BOTH
  `machine.name` and `screen.ownerNodeName` (previously Channel B only took whichever was truthy
  first via `or`), deduplicated, bounded to `VOICE_NOTE_CONTEXT_TERMS_MAX = 4`. Channel B's
  `_voice_note_domain_terms` now delegates to it (no behavior loss, strictly more terms
  available). Channel A: `channel_a_transcribe(audio_bytes, mime_type, owner_id=None)` widened to
  accept `owner_id`; `_handle_voice_note` passes `record.owner_id` (already phone-to-owner bound
  before this call, the same id `_handle_query` is about to use next). When present, the closure
  reads `session_registry.capture_owner_context(owner_id, max_age_seconds=CHANNEL_A_OWNER_NAME_MAX_AGE_SECONDS)`
  — the SAME guarded, freshness-bound accessor (`_CONTEXT_FRESHNESS_SECONDS = 15.0` in
  `channel_a_activation.py`, matched by the existing `CHANNEL_A_OWNER_NAME_MAX_AGE_SECONDS = 15.0`
  reused here) the query coordinator's own `read_context` seam already uses — a second CALL to
  the identical guarded reader, not a second, weaker read path. This supersedes PW-013 V4d's
  earlier "no per-owner context terms" decision, per this task's explicit instruction; any
  `HmiSessionError` (owner unavailable, stale, absent) yields no extra terms rather than failing
  the transcription.
- RED evidence: `KeyError: 'config'` (F7a, `client.models.generate_content` called without a
  `config` kwarg); `TypeError: transcribe() got an unexpected keyword argument 'owner_id'` on the
  widened test doubles (F7b), before implementation.
- Checks: `tests.test_voice_transcription` — 20 OK. `tests.test_channel_a_bot` +
  `tests.test_channel_a_activation` + `tests.test_local_presentation` + `tests.test_runtime_safety`
  — 420 OK (targeted). Full suite — 1766 tests, same 2 pre-existing environmental failures.
- Commit: `1026553`.

## Final verification (all fixes)

`D:\Proyectos\Interfaz-HMI\Interfaz-HMI\services\leda-runtime\.venv\Scripts\python.exe -m
unittest discover -s D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\runtime-fixes\services\leda-runtime
-p "test_*.py"` → **1766 tests, 2 pre-existing environmental failures (same as baseline,
worktree-local `.venv` missing), 2 skipped, no new failures.**

## Progress

- 2026-09-25: read AGENTS.md, docs/CONVENTIONS.md, docs/TESTING.md, the three referenced PW feature
  documents; read-only investigation of `telegram_config.py`, `telegram_credentials.py`,
  `gemini_credentials.py`, `channel_a_credentials.py`, `voice_service.py`, `local_presentation.py`,
  `voice_transcription.py`, `channel_a_bot.py` to confirm root causes for F1-F3 and design F6.
  Feature document created before the first source edit.
- 2026-09-25: F1 and F2 implemented and verified (strict TDD) — see Evidence above.
- 2026-09-25: F3 implemented and verified (strict TDD) — see Evidence above.
- 2026-09-25: F6 (mid-task addition) implemented and verified (strict TDD), including the
  requested record_voice/F1 composition proof — see Evidence above.
- 2026-09-25: F7 (mid-task addition) implemented and verified (strict TDD) — see Evidence above.
  Full runtime suite green at 1766 tests, same 2 pre-existing environmental failures throughout.

## Next step

Closed; no pending work. Live retest by the user on 2026-09-25 passed: F3's inactivity
warning/expiry copy showed the confirmed HMI label ("Notebook"), and F6's Channel B "typing…"
indicator behaved as fixed (see `odd/tasks/pw-011-leda-minor-followups.md`'s Live verification
section). F1/F2/F7 were exercised as part of the same session's voice-note and Channel B retests
(see `odd/tasks/leda-channel-b-voice-replies.md` B3 and `odd/tasks/pw-013-voice-note-questions.md`
V7), with no errors observed in the runtime logs.
