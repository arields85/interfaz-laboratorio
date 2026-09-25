# Voice overlap — consecutive/overlapping answers must all play — ODD bug-fix tracker

> ODD bug fix (not SDD). Worktree `D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\voice-overlap`,
> branch `fix/voice-overlap`, from `main` `ee7cb0c`.

## Objective

Two Channel A voice notes answered back-to-back for the same HMI session must each play, in order,
on the HMI (orb + voice) — never dropped with `audio-failure`, never overlapping.

## Evidence (live retest 2026-09-25 ~09:33, logs)

Two Channel A voice notes arrived in the same `getUpdates` batch (presentation log
`Channel A getUpdates: count=2`); both transcribed in ~1-2s; both answers published almost
simultaneously; the voice process returned 503 for BOTH `POST /internal/prisma/prefetch` and
`POST /prisma/speak-live` for BOTH events at 09:33:39 (voice log), then 200 for both at 09:33:40;
the HMI recorded `HMI voice timeline: ... type=error ... error_code=audio-failure` — one answer
never played. The 503 comes from `voice_service.py` ~L1137-1141: `AudioCapacityError` other than
`VOICE_SUBSCRIBER_LIMIT` -> 503, or `AudioCoordinatorError/RuntimeError` -> 503
`VOICE_SERVICE_UNAVAILABLE` (the response body error string was not logged anywhere).

## Root-cause investigation (read-only, this task)

- `AudioCoordinator` (`event_audio.py`) default admission bounds (`max_queue_per_owner=2`,
  `max_subscribers_per_owner=8`, `max_records=64`, `max_queue=8` global) do NOT trip from just two
  concurrent events for one owner under the prefetch-then-attach pattern — empirically probed with
  a real `AudioCoordinator` (2 owners x prefetch+speak-live, concurrent threads): no rejection.
- `usePrismaOrbPresentation.ts` (T17, deliberate, documented design): every new voice event —
  "including one arriving while the previous answer is still speaking" — immediately calls
  `engine.play()`, which unconditionally cancels ("cancel", true) whatever is currently playing
  (`PrismaVoiceAudioEngine.play()` -> `cleanupActive('cancel', true)` -> `abortController.abort()`).
  This is the mechanism that makes two back-to-back answers overlap/drop instead of queueing.
- **Confirmed real backend defect**: `/prisma/speak-live`'s response
  (`voice_service.py` `_pcm_stream_response(lambda: _timed_pcm_stream(stream, request_received))`)
  registers `response.call_on_close(close)` with `close = _timed_pcm_stream`'s OWN generator's
  `.close`, never the inner `AudioSubscription` (`stream`) it wraps. On a NORMAL full read,
  `AudioSubscription._next_chunk` self-closes on `StopIteration` (event_audio.py `_next_chunk`), so
  this is invisible for a complete answer. But when the HTTP response is torn down EARLY — exactly
  what happens when the orb aborts the previous answer's fetch because a new voice event
  superseded it (`cleanupActive` -> `abortController.abort()` -> the browser closes the connection
  -> Werkzeug tears the response down via its registered `close`) — the wrapping generator's
  `finally` only logs; it never calls `stream.close()`. The `AudioSubscription`'s subscriber slot
  (and, if the job hasn't finished, its non-terminal state) is never released. Over a session with
  several overlapping answers this leaks subscriber counts and prevents `_detach`'s reap condition
  (`subscribers == 0`) from ever firing for those jobs, growing `AudioCoordinator.states`/
  `total_subscribers` toward its bounds — a real, deterministic, provable defect on its own,
  and the most evidence-backed explanation for a real coordinator eventually rejecting brand-new,
  unrelated events with `AudioCapacityError` after a live session with repeated overlapping voice
  answers (matching the reported transient 503 window). Existing test
  `test_http_response_close_releases_unstarted_audio_subscription` only covers `_pcm_stream_response`
  called DIRECTLY with the subscription as `stream` — it never exercises the real
  `/prisma/speak-live` wiring through `_timed_pcm_stream`, so the gap was untested.
- Rejections were never logged at all (`prisma_speak_live`/`prisma_prefetch`'s `except` branches go
  straight to `jsonify(...)`), so the exact admission reason was invisible in the reported incident.

## Fix strategy (server-side preferred, per this task's brief; HMI also fixed since dropping the
current answer to start the next one is the direct, documented cause of "never dropped, never
overlapping" not being met today)

1. **Backend**: `_timed_pcm_stream` (`voice_service.py`) closes the wrapped `AudioSubscription` in
   its `finally`, on every teardown path (normal, error, or early external `.close()`) — mirrors
   `prisma_prefetch`'s existing explicit `subscription.close()`. `AudioSubscription.close()` is
   already idempotent, so this is safe alongside the existing self-close-on-`StopIteration` path.
2. **Backend**: log (WARNING, no secrets/ids) the admission-rejection reason in `prisma_speak_live`
   and `prisma_prefetch` when `subscribe()`/`resolve_voice_event()` raises an
   `AudioCapacityError`/`AudioCoordinatorError`/`RuntimeError` — currently silent.
3. **Frontend**: `usePrismaOrbPresentation.ts` — a new voice event arriving while the CURRENT one is
   still actively being presented (thinking or visible/speaking, i.e. before its own terminal
   fires) is queued (small bounded FIFO) instead of aborting the current playback; it starts the
   moment the current one's terminal (`onEnded`/`onError`/thinking-timeout) fires. An event arriving
   during the current one's cosmetic fade-out (AFTER its terminal already fired — the answer has
   fully played, only the visual wind-down remains) still interrupts immediately, unchanged from
   today (T17's own existing, still-passing test covers this).

## TDD

Strict TDD: enabled (source: session configuration "Strict TDD Mode: enabled").
Runner (prisma-runtime, worktree-scoped):
`D:\Proyectos\Interfaz-HMI\Interfaz-HMI\services\prisma-runtime\.venv\Scripts\python.exe -m
unittest discover -s D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\voice-overlap\services\prisma-runtime -p "test_*.py"`.
Runner (hmi-app, worktree-scoped): `cd hmi-app && npx vitest run` / `npx tsc -b` / `npm run lint`.

Baseline (worktree, before changes, 2026-09-25): prisma-runtime **1766 tests, 2 pre-existing
environmental failures, 2 skipped** (`test_real_missing_import_is_normalized_to_bootstrap_remedy_under_stop_preference`,
`test_cancellation_during_voice_startup_rolls_back_only_the_launched_child` — both spawn a
subprocess expecting a worktree-local `.venv\Scripts\python.exe` this worktree does not have;
unrelated to this task, not touched). hmi-app: 221 files / 2571 tests, all passing (after
`npm ci`, no `node_modules` present in this worktree).

## Tasks

- [x] **V1 — Reproduce and fix the AudioSubscription close-forwarding leak (backend).**
  `services/prisma-runtime/src/prisma_runtime/voice_service.py`, `tests/test_voice_service.py`.
  Route: inline (one already-understood file + its test, no design decision after the read-only
  investigation above).
- [x] **V2 — Log the admission-rejection reason (backend).**
  `services/prisma-runtime/src/prisma_runtime/voice_service.py`, `tests/test_voice_service.py`.
  Route: inline (same file as V1).
- [x] **V3 — Queue an overlapping voice event instead of aborting the current answer (frontend).**
  `hmi-app/src/hooks/usePrismaOrbPresentation.ts`, `usePrismaOrbPresentation.test.ts`. Route:
  inline (one already-understood file + its test).

## Acceptance criteria

- A real `/prisma/speak-live` response whose HTTP teardown happens before the stream is fully
  drained (client abort) closes the underlying `AudioCoordinator` subscription exactly once.
- An admission rejection on `/prisma/speak-live` or `/internal/prisma/prefetch` is logged at
  WARNING with the rejection reason, no event/owner id, no secret.
- Two voice events for the same HMI session, arriving while the first is still thinking/speaking,
  both play in full, in order — the second never aborts the first mid-stream.
- An event arriving during the first answer's cosmetic fade-out (after it has already fully played)
  still starts immediately, unchanged from before.
- Runtime suite green (2 known pre-existing worktree-`.venv` environmental failures acceptable,
  named above). hmi-app `npx vitest run` / `npx tsc -b` / `npm run lint` clean.
