# Channel A voice-note UX — orb "thinking" signal + reliable answer prefetch — ODD feature document

> ODD feature task (not SDD). Worktree `D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\voice-ux`,
> branch `feat/channel-a-voice-note-ux`, from `fix/voice-overlap` tip `8fc89f9` (queues overlapping
> answers on the orb, closes speak-live subscriptions on early teardown).

## Objective

Two user-approved UX improvements for Channel A voice-note questions:

- **U1** — show the orb's existing "thinking" state (T17) the moment the Channel A bot accepts a
  voice note from an authorized/paired actor, before download/transcription — instead of the orb
  staying invisible for the whole 1-3 s download+transcribe window with no signal at all.
- **U2** — make the TTS prefetch for a Channel A answer reliably win the race against the HMI's own
  speak-live request, so the answer audio is (almost) always already cached by the time the orb asks
  for it.

## Measured (live, 2026-09-25, from live-test-2026-09-25-runtime.md and this task's own read-only
investigation)

Channel A voice-note questions take ~1.5-4.5 s from the note arriving to the orb starting to speak;
the HMI part (voice-event-received -> playback-started) is 0.1-0.2 s when the answer audio was
already prefetched (first-readable-audio 15-80 ms) and 0.6-0.9 s when not (first-readable-audio
520-760 ms). Before that, download + transcription (~1-3 s) happens with NO visible signal on the
HMI. Channel B feels faster only because its text reply arrives first.

## Root cause found for U2 (read-only investigation, this task)

`VoiceEventStore.publish()` (`voice_events.py`) calls `self._notify_owner(str(owner_id))`
**synchronously, before returning**, waking any blocked `/hmi/voice/events` SSE waiter immediately.
`channel_a_on_outcome` (`local_presentation.py`) calls `voice_events.publish(...)` **first**, and
only **after** it returns does it call `mint_prefetch_token(...)` + `_fire_channel_a_voice_prefetch`
(which spawns a background thread that itself still has to reach the voice process over HTTP). This
means the HMI is told about the new event (and can immediately POST `/leda/speak-live`, a single
local hop once notified) strictly *before* the prefetch has even been dispatched — a real ordering
defect, not a fundamental race: whichever request reaches `AudioCoordinator.subscribe()` first
creates the generation job; the other attaches to it (confirmed already covered by
`test_two_subscribers_share_one_generation_and_replay_without_side_effects` in
`test_event_audio.py`, state keyed by `(owner_id, event_id)` — both the prefetch-token path and the
real-session path resolve to the identical key for the same event, so there is no risk of two
separate generations, only of which side wins and therefore whether the HMI arrives ahead of buffered
audio or not). Fix: defer the owner notification until after the prefetch has been minted and
dispatched, so the prefetch is always started first and gets a real head start.

## Design for U1

Reuse the existing per-owner voice-event channel (SSE + polling fallback, `VoiceEventStore` +
`/hmi/voice/events` + `/hmi/voice/latest`) with a new optional `kind` field on the wire event:
`"thinking"` (no answer, sent the moment `_handle_voice_note` confirms phone-to-owner authorization,
before any duration/size check or download) and `"cancel"` (sent when the note is rejected/fails, so
the orb can hide immediately instead of waiting out the bounded timeout). Absent `kind` means
`"answer"` (every existing event, unchanged). `/leda/speak-live` and `/internal/leda/prefetch`
reject a non-answer-kind event id with 400 `INVALID_VOICE_EVENT_REQUEST` before ever reaching
`AudioCoordinator.subscribe()` — a thinking/cancel event must never be able to trigger TTS.

Frontend (`useLedaOrbPresentation.ts`): `presentVoiceEvent` branches on `event.kind`. A `thinking`
event, when no answer is currently active (`isActiveRef` false), shows the existing `'thinking'` phase
and starts a new bounded `LEDA_ORB_THINKING_SIGNAL_TIMEOUT_MS` wait for the real answer; if nothing
arrives, the orb returns to `'hidden'` (no fade — nothing ever played). A `cancel` event, while
awaiting an answer, clears that wait and hides immediately. Either kind is a no-op while an answer is
currently active/playing (`isActiveRef` true) — per the user's explicit requirement, a thinking signal
must never abort an answer in progress; a *real* answer arriving while active still queues, unchanged
(V3, `fix/voice-overlap`).

`LEDA_ORB_THINKING_SIGNAL_TIMEOUT_MS` chosen at 30 000 ms: comfortably above
`VOICE_TRANSCRIPTION_REQUEST_TIMEOUT_SECONDS = 25` s (the backend's own worst-case ceiling for the
download+transcribe round trip), so the orb is never hidden out from under a transcription that is
still legitimately in flight, while still bounded per the requirement.

Typed Channel A questions (`_handle_query`, used directly for typed text and indirectly, after
transcription, for voice notes) are **not** wired to the thinking signal — `_handle_query` has no
existing hook point for it and adding one is new wiring, not free, so per the explicit instruction
("only if it costs nothing extra") this is reported, not implemented.

## TDD

Strict TDD: enabled (source: session configuration "Strict TDD Mode: enabled").
Runner (leda-runtime, worktree-scoped):
`D:\Proyectos\Interfaz-HMI\Interfaz-HMI\services\leda-runtime\.venv\Scripts\python.exe -m
unittest discover -s D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\voice-ux\services\leda-runtime -p "test_*.py"`.
Runner (hmi-app, worktree-scoped): `cd hmi-app && npx vitest run` / `npx tsc -b` / `npm run lint`.

Baseline (worktree, before changes, 2026-09-25): full runtime suite **1772 tests, 2 pre-existing
environmental failures** (`test_real_missing_import_is_normalized_to_bootstrap_remedy_under_stop_preference`,
`test_cancellation_during_voice_startup_rolls_back_only_the_launched_child` — both spawn a subprocess
expecting a worktree-local `.venv\Scripts\python.exe` this worktree does not have; unrelated,
pre-existing, not touched), 2 skipped. hmi-app `npx vitest run`: 221 files / 2574 tests, all passing
(after `npm ci`, no `node_modules` present in this worktree).

## Tasks

- [x] **U2 — fix the publish/notify ordering so the Channel A prefetch reliably starts before the
  HMI is notified.** `voice_events.py` (`publish(..., notify=...)`, new `notify_owner()`),
  `local_presentation.py` (`channel_a_on_outcome`), `test_voice_event_delivery.py`,
  `test_channel_a_root.py`. Route: inline (two already-understood files + their tests, one already
  fully read-only-investigated design decision, no cross-cutting design work left).
- [x] **U1 — orb "thinking" signal on voice-note receipt + cancel-on-failure + speak-live/prefetch
  kind guard.** `voice_events.py` (`kind` field), `voice_service.py` (reject non-answer kind),
  `channel_a_bot.py` (`enable_voice_notes(notify_thinking=..., notify_cancelled=...)`,
  `_handle_voice_note`), `channel_a_activation.py` (thread both through), `local_presentation.py`
  (`build_channel_a_activation` wiring), `voice.types.ts`, `voiceEventListener.service.ts`,
  `useLedaOrbPresentation.ts`, and each file's tests. Route: delegated-writer-equivalent scope
  (multi-file, behavior-changing, across both `services/leda-runtime` and `hmi-app`) done as one
  continuous writer pass by this bounded agent (no sub-delegation available to it).

## Acceptance criteria

- A Channel A voice note from an authorized/paired actor shows the orb "thinking" before
  download/transcription starts.
- The orb never gets stuck in "thinking" forever: it returns to hidden on a bounded timeout or an
  explicit cancel signal.
- A thinking/cancel signal never aborts an answer currently playing; a real answer arriving while one
  is active still queues, unchanged from `fix/voice-overlap`.
- A thinking/cancel event id can never be used to trigger TTS via `/leda/speak-live` or
  `/internal/leda/prefetch`.
- The Channel A prefetch is always dispatched before the owner's SSE/poll waiter is notified of the
  new answer event.
- Runtime suite green (2 known pre-existing worktree-`.venv` environmental failures acceptable,
  named above). hmi-app `npx vitest run` / `npx tsc -b` / `npm run lint` clean.

## Evidence

### U2 — prefetch/notify ordering

- RED: new `test_on_outcome_starts_the_prefetch_before_notifying_the_owners_sse_waiter`
  (`test_channel_a_root.py`) subscribed the owner's SSE flag before calling `on_outcome`, and
  recorded `flag.is_set()` at the moment the patched `_fire_channel_a_voice_prefetch` ran:
  `AssertionError: Lists differ: [True] != [False]` (notify had already fired). Also RED:
  `VoiceEventStore.publish() got an unexpected keyword argument 'notify'` on the two new
  `test_voice_event_delivery.py` tests.
- Fix: `voice_events.py`'s `publish()` gained `notify=True` (default preserves every other caller's
  behavior) and a new public `notify_owner(owner_id)`. `local_presentation.py`'s `channel_a_on_outcome`
  now publishes with `notify=False`, mints the prefetch token and fires `_fire_channel_a_voice_prefetch`
  first, and only then calls `voice_events.notify_owner(...)` — unconditionally, even when no token was
  minted, so the event is never silently withheld from the HMI.
- GREEN: `test_voice_event_delivery.py` (56 tests), `test_channel_a_root.py` (66 tests, both classes).
- Also confirmed (not re-tested, cited): `AudioCoordinator.subscribe()` keys generation state by
  `(owner_id, event_id)` — the prefetch-token path and the real-session path resolve to the identical
  key for the same event, so whichever request wins the race still shares one generation (existing
  `test_two_subscribers_share_one_generation_and_replay_without_side_effects` in
  `test_event_audio.py`). This was never an unsafe race, only a missed prefetch opportunity — now fixed.

### U1 — thinking/cancel signal + kind guard

- **`voice_events.py`** — `kind` field (`answer`/`thinking`/`cancel`) on `validate_voice_event` and
  `publish()`; absent/`"answer"` never adds the key (verified: `test_the_default_answer_kind_never_adds_a_kind_key`).
  RED confirmed by temporarily reverting the file: `TypeError: publish() got an unexpected keyword
  argument 'kind'` on all 4 new tests.
- **`voice_service.py`** — `/leda/speak-live` and `/internal/leda/prefetch` both reject
  `event.get("kind", "answer") != "answer"` as `INVALID_VOICE_EVENT_REQUEST` (400) before ever calling
  `audio_coordinator.subscribe()`. RED: `coordinator.subscribe.assert_not_called()` failed (`Called 2
  times`) before the guard existed. GREEN: `test_voice_service.py` (90 tests).
- **`channel_a_bot.py`** — `enable_voice_notes` gained optional `notify_thinking`/`notify_cancelled`
  (validated callable-or-None, same precedent as `transcribe`). `_handle_voice_note` calls
  `_signal_thinking(record.owner_id)` right after the malformed-file-id check (authorized, well-formed
  voice note, before any duration/size check or download) and `_signal_cancelled(record.owner_id)` on
  every rejection/failure branch that follows (too long, too large, download failed, transcription
  empty/unavailable/unexpected). Both are best-effort (wrapped in try/except, never break voice-note
  handling — verified by `test_a_thinking_signal_failure_never_breaks_voice_note_handling` and
  `test_a_cancelled_signal_failure_never_breaks_the_rejection_reply`). A malformed (non-)voice note
  signals neither. RED confirmed by temporarily reverting the file: 14 errors, all
  `TypeError: enable_voice_notes() got an unexpected keyword argument 'notify_thinking'`/`'notify_cancelled'`.
  GREEN: `test_channel_a_bot.py` (280 tests, was 275).
- **`channel_a_activation.py`** — `notify_thinking`/`notify_cancelled` threaded through to
  `dialogue.enable_voice_notes(...)` alongside `transcribe`, same optional/backward-compatible pattern
  as PW-013's own V4c. RED confirmed: `TypeError: ChannelAActivation.__init__() got an unexpected
  keyword argument 'notify_thinking'` on the new end-to-end test. GREEN: `test_channel_a_activation.py`
  (42 tests, was 41).
- **`local_presentation.py`** — new `channel_a_notify_thinking`/`channel_a_notify_cancelled` closures
  publish a signal-only `thinking`/`cancel` event for the owner (no `is_current` guard available at
  this point — no query envelope exists yet; the phone-to-owner binding `_handle_voice_note` already
  checked is the only freshness this relies on); both wired into `build_channel_a_activation`'s
  `ChannelAActivation(...)` call. RED confirmed: `KeyError: 'notify_thinking'`/`'notify_cancelled'` on
  the 3 new `test_runtime_safety.py` tests (production-wiring + both closures' actual publish
  behavior). GREEN: `test_runtime_safety.py` (56 tests, was 53, 1 known pre-existing environmental
  failure unrelated).
- **Frontend (`voice.types.ts`, `voiceEventListener.service.ts`, `useLedaOrbPresentation.ts`)** —
  `VoiceEvent.kind?: 'thinking' | 'cancel'` (absent means answer); `normalizeVoiceEvent` passes through
  a recognized kind and drops an unrecognized one without rejecting the event (RED:
  `voiceEventListener.service.test.ts`'s new "passes through a thinking/cancel kind" test failed —
  `kind` field missing from the received payload — before the parser change; GREEN after, 39 tests).
  `useLedaOrbPresentation.ts`'s `presentVoiceEvent` branches on `event.kind`: `"thinking"` shows the
  `'thinking'` phase without calling `engine.play()` and starts a new bounded
  `LEDA_ORB_THINKING_SIGNAL_TIMEOUT_MS` (30 000 ms) wait for the real answer, returning to `'hidden'`
  if nothing follows; `"cancel"` clears that wait and hides immediately; either kind is a no-op while
  an answer is currently active (`isActiveRef`). RED confirmed: 4 of 8 new hook tests failed before the
  change (`engine.play` called for a thinking-kind event; phase stuck at `'thinking'` instead of
  reaching `'hidden'` on timeout/cancel) — the other 4 (queueing/no-abort-while-active tests) already
  passed by coincidence of the pre-existing queue mechanism, confirmed as a legitimate regression guard
  rather than a false RED. GREEN after: `useLedaOrbPresentation.test.ts` (34 tests, was 27).

### Full verification (after both tasks)

- Runtime: `unittest discover` → **1791 tests** (baseline 1772 + 19 new), same 2 pre-existing
  environmental failures (`test_real_missing_import_is_normalized_to_bootstrap_remedy_under_stop_preference`,
  `test_cancellation_during_voice_startup_rolls_back_only_the_launched_child`), 2 skipped, no new
  failures.
- hmi-app: `npx vitest run` → **221 files / 2583 tests** (baseline 221/2574 + 9 new), all passing.
  `npx tsc -b` clean (no output). `npm run lint` clean (no findings).

## Progress

- 2026-09-25: read-only investigation (AGENTS.md, docs/CONVENTIONS.md, docs/TESTING.md, the three
  referenced PW/voice-overlap feature documents; `voice_events.py`, `local_presentation.py`,
  `voice_service.py`, `event_audio.py`, `channel_a_bot.py`, `channel_a_activation.py`,
  `voiceEventListener.service.ts`, `useLedaOrbPresentation.ts`) confirmed U2's root cause (notify
  fires inside `publish()` before the prefetch is even minted) and designed U1's `kind`-discriminated
  signal event. Feature document created before the first source edit.
- 2026-09-25: U2 and U1 implemented and verified (strict TDD throughout; every RED independently
  confirmed, most by a failing assertion from the test itself, the rest by temporarily reverting the
  just-written source file and observing the exact expected failure) — see Evidence above. Full runtime
  suite 1791/1791 modulo the 2 known pre-existing environmental failures; hmi-app 221/2583, `tsc -b`
  and `lint` both clean.

## Next step

Closed; no pending work (K2 below is also fixed and verified). Live retest by the user on
2026-09-27 passed: the orb shows "thinking" on Channel A voice-note receipt (answer arriving ~3 s
later), and overlapping answers are queued and play in order (see `odd/tasks/voice-overlap.md`).

## K2 — a rejected voice note must never signal "thinking" (2026-09-27)

Live test (2026-09-27) evidence: a >30 s voice note produced `orb-phase thinking` at
`t=156606 ms` and `hidden` at `t=157001 ms` (a `cancel` 0.4 s later) — the orb flashed for a note that
was always going to be rejected.

Root cause: `channel_a_bot.py`'s `_handle_voice_note` called `self._signal_thinking(record.owner_id)`
right after the authorization/malformed-file-id check, **before** the cheap, download-free
`validate_voice_note_duration`/`validate_voice_note_size` checks. A note rejected by either check
still got a `thinking` signal (immediately followed by `cancel`), even though nothing was ever going
to be downloaded or transcribed.

Fix: run `validate_voice_note_duration`/`validate_voice_note_size` first; call `_signal_thinking`
only once both pass. The `VoiceNoteTooLong`/`VoiceNoteTooLarge` except branches no longer call
`_signal_cancelled` either (there is nothing to cancel — `thinking` was never sent for these). Every
failure that happens AFTER `_signal_thinking` (download failure, transcription empty/unavailable/
unexpected) keeps signalling `_signal_cancelled`, unchanged.

Route: direct inline (one already-understood file — `channel_a_bot.py` — plus its existing test
class `ChannelAVoiceNoteIntegrationTests` in `test_channel_a_bot.py`).

TDD: Strict, same runner as U1/U2. RED observed first on the three duration/size tests (asserted the
pre-fix behavior of `thinking_calls == [OWNER]`) and confirmed failing for the expected reason before
being flipped to assert `thinking_calls == []` / `cancelled_calls == []`.

Checks: `test_channel_a_bot.py`; full runtime suite baseline 1791/1791 modulo the 2 known
pre-existing worktree-`.venv` environmental failures.

### K2 evidence

- RED: rewrote `test_a_voice_note_over_the_duration_cap_is_rejected_before_any_download`,
  `test_a_voice_note_with_a_missing_or_invalid_duration_is_rejected`, and
  `test_a_voice_note_over_the_size_cap_is_rejected_before_any_download` to assert
  `thinking_calls == []` / `cancelled_calls == []`; all three failed against the pre-fix source for
  the expected reason (`Lists differ: ['00000000-0000-4000-8000-000000000001'] != []`, i.e. thinking
  still fired before the reject checks). Also rewrote
  `test_a_cancelled_signal_failure_never_breaks_the_rejection_reply` (its old duration-over-cap
  scenario no longer signals cancelled at all, so it would stop exercising `notify_cancelled`'s error
  path) to use a download failure instead — a failure that happens AFTER thinking is sent.
- Fix: `channel_a_bot.py`'s `_handle_voice_note` now runs the `validate_voice_note_duration`/
  `validate_voice_note_size` try/except block BEFORE `self._signal_thinking(record.owner_id)`; the
  `VoiceNoteTooLong`/`VoiceNoteTooLarge` except branches no longer call `self._signal_cancelled(...)`.
  Every failure after thinking is sent (download failure, transcription empty/unavailable/unexpected)
  is untouched.
- GREEN: `test_channel_a_bot.py` — 280 tests (unchanged count; existing tests were rewritten, none
  added/removed). Full runtime suite: 1791/1791 modulo the same 2 known pre-existing worktree-`.venv`
  environmental failures, 2 skipped — unchanged from baseline.
- Commit: `b1f87cf`.

**Live verification (2026-09-27):** passed. A rejected voice note no longer flashes the orb;
integrated on `main` `76464d0`. No pending work.
