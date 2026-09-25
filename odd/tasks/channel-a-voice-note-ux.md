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
means the HMI is told about the new event (and can immediately POST `/prisma/speak-live`, a single
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
`"answer"` (every existing event, unchanged). `/prisma/speak-live` and `/internal/prisma/prefetch`
reject a non-answer-kind event id with 400 `INVALID_VOICE_EVENT_REQUEST` before ever reaching
`AudioCoordinator.subscribe()` — a thinking/cancel event must never be able to trigger TTS.

Frontend (`usePrismaOrbPresentation.ts`): `presentVoiceEvent` branches on `event.kind`. A `thinking`
event, when no answer is currently active (`isActiveRef` false), shows the existing `'thinking'` phase
and starts a new bounded `PRISMA_ORB_THINKING_SIGNAL_TIMEOUT_MS` wait for the real answer; if nothing
arrives, the orb returns to `'hidden'` (no fade — nothing ever played). A `cancel` event, while
awaiting an answer, clears that wait and hides immediately. Either kind is a no-op while an answer is
currently active/playing (`isActiveRef` true) — per the user's explicit requirement, a thinking signal
must never abort an answer in progress; a *real* answer arriving while active still queues, unchanged
(V3, `fix/voice-overlap`).

`PRISMA_ORB_THINKING_SIGNAL_TIMEOUT_MS` chosen at 30 000 ms: comfortably above
`VOICE_TRANSCRIPTION_REQUEST_TIMEOUT_SECONDS = 25` s (the backend's own worst-case ceiling for the
download+transcribe round trip), so the orb is never hidden out from under a transcription that is
still legitimately in flight, while still bounded per the requirement.

Typed Channel A questions (`_handle_query`, used directly for typed text and indirectly, after
transcription, for voice notes) are **not** wired to the thinking signal — `_handle_query` has no
existing hook point for it and adding one is new wiring, not free, so per the explicit instruction
("only if it costs nothing extra") this is reported, not implemented.

## TDD

Strict TDD: enabled (source: session configuration "Strict TDD Mode: enabled").
Runner (prisma-runtime, worktree-scoped):
`D:\Proyectos\Interfaz-HMI\Interfaz-HMI\services\prisma-runtime\.venv\Scripts\python.exe -m
unittest discover -s D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\voice-ux\services\prisma-runtime -p "test_*.py"`.
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
  `usePrismaOrbPresentation.ts`, and each file's tests. Route: delegated-writer-equivalent scope
  (multi-file, behavior-changing, across both `services/prisma-runtime` and `hmi-app`) done as one
  continuous writer pass by this bounded agent (no sub-delegation available to it).

## Acceptance criteria

- A Channel A voice note from an authorized/paired actor shows the orb "thinking" before
  download/transcription starts.
- The orb never gets stuck in "thinking" forever: it returns to hidden on a bounded timeout or an
  explicit cancel signal.
- A thinking/cancel signal never aborts an answer currently playing; a real answer arriving while one
  is active still queues, unchanged from `fix/voice-overlap`.
- A thinking/cancel event id can never be used to trigger TTS via `/prisma/speak-live` or
  `/internal/prisma/prefetch`.
- The Channel A prefetch is always dispatched before the owner's SSE/poll waiter is notified of the
  new answer event.
- Runtime suite green (2 known pre-existing worktree-`.venv` environmental failures acceptable,
  named above). hmi-app `npx vitest run` / `npx tsc -b` / `npm run lint` clean.

## Evidence

(filled in as each task completes)

## Next step

Live retest by the user once both tasks are done — see the final report for exactly what to look for
in the HMI voice timeline log.
