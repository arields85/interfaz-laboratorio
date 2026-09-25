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
Runner: `D:\Proyectos\Interfaz-HMI\Interfaz-HMI\services\prisma-runtime\.venv\Scripts\python.exe -m
unittest discover -s D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\runtime-fixes\services\prisma-runtime -p "test_*.py"`.
Baseline (worktree, before changes, 2026-09-25): **1730 tests, 2 pre-existing environmental
failures, 2 skipped** — `test_real_missing_import_is_normalized_to_bootstrap_remedy_under_stop_preference`
and `test_cancellation_during_voice_startup_rolls_back_only_the_launched_child`, both because this
worktree has no `.venv\Scripts\python.exe` of its own (they spawn a subprocess with the
repository-owned interpreter path, which only exists in the main checkout). Unrelated to this task,
not touched.

## Tasks

- [ ] **F1 — Channel B voice-note replies never arrive in protected credential mode.** Root cause:
  `telegram_config.telegram_token()` always returns "" when `PRISMA_CREDENTIAL_MASTER_KEY_FILE` is
  set (protected mode), so `voice_service.py`'s `_telegram_token()` never resolves the Channel B bot
  token from the protected credential store, silently cancelling every Telegram voice job. Fix:
  resolve the "telegram" secret from the protected `CredentialService` in `voice_service.py`, mirroring
  `gemini_credentials.py`'s own resolver/cache pattern; add WARNING logging (no secret) for a
  cancelled-for-missing-token job and for an exhausted sendVoice/sendDocument delivery. Route:
  delegated writer equivalent (multi-file: `telegram_credentials.py`, `voice_service.py`, tests).
- [ ] **F2 — Channel A's first voice-note transcription after pairing is slow (~30s vs ~3s later),
  timing out against presentation's client timeout.** Investigate `voice_transcription.py`/
  `voice_service.py` client warm-up vs TTS. Fix the identifiable cold-start cause (a real network
  touch at boot, not just building the client object) and add WARNING+elapsed_ms diagnostics on
  both sides of the transcription round trip. Do not redesign the synchronous-on-poll-thread
  architecture. Route: delegated writer equivalent (`voice_service.py`, `local_presentation.py`, tests).
- [ ] **F3 — Channel A inactivity warning/expiry messages fall back to "la HMI" instead of the
  confirmed pairing label.** Root cause: the M3 sweep re-reads `_read_label(owner_id)` at sweep
  time, which is freshness-bound to a live HMI session and fails exactly when a sweep is due (the
  session has gone idle). Fix: capture the label shown in `WELCOME_TEMPLATE` at confirmation time
  on the local action record, and use it for both the warning and expiry copy; keep the "la HMI"
  fallback only when no label was ever captured. Route: inline/delegated writer equivalent
  (`channel_a_bot.py`, tests).
- [ ] **F6 (added mid-task, same worktree/branch/rules) — Channel B typing indicator.** While
  Channel B is processing a question (text or voice note), send the Telegram "typing" chat action,
  non-blocking, and stop it once the text answer for that message has already gone out — same
  per-message "answered" flag design as Channel A's PW-011 M5
  (`_send_typing_unless_answered`/`_typing`), reusing that helper/pattern rather than duplicating
  it. Also verify (test) that the Channel B voice-reply job's existing `record_voice` chat action
  actually fires once F1 resolves a real token from the protected store. Route: delegated writer
  equivalent (`channel_a_bot.py`, `local_presentation.py`, tests + 4-6 existing test-helper
  `build_bot()` sites in `test_telegram_lifecycle.py`/`test_telegram_diagnostics.py` need a
  `_typing` stub to keep the existing offline-dispatch-guarded suite hermetic).

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
- Runtime suite green (2 known pre-existing worktree-`.venv` environmental failures acceptable, named).

## Progress

- 2026-09-25: read AGENTS.md, docs/CONVENTIONS.md, docs/TESTING.md, the three referenced PW feature
  documents; read-only investigation of `telegram_config.py`, `telegram_credentials.py`,
  `gemini_credentials.py`, `channel_a_credentials.py`, `voice_service.py`, `local_presentation.py`,
  `voice_transcription.py`, `channel_a_bot.py` to confirm root causes for F1-F3 and design F6.
  Feature document created before the first source edit.
