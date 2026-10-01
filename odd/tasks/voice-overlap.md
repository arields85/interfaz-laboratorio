# Voice overlap — consecutive/overlapping answers must all play — ODD bug-fix tracker

> ODD bug fix (not SDD). Worktree `D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\voice-overlap`,
> branch `fix/voice-overlap`, from `main` `ee7cb0c`.

## Objective

Two Channel A voice notes answered back-to-back for the same HMI session must each play, in order,
on the HMI (orb + voice) — never dropped with `audio-failure`, never overlapping.

## Evidence (live retest 2026-09-25 ~09:33, logs)

Two Channel A voice notes arrived in the same `getUpdates` batch (presentation log
`Channel A getUpdates: count=2`); both transcribed in ~1-2s; both answers published almost
simultaneously; the voice process returned 503 for BOTH `POST /internal/leda/prefetch` and
`POST /leda/speak-live` for BOTH events at 09:33:39 (voice log), then 200 for both at 09:33:40;
the HMI recorded `HMI voice timeline: ... type=error ... error_code=audio-failure` — one answer
never played. The 503 comes from `voice_service.py` ~L1137-1141: `AudioCapacityError` other than
`VOICE_SUBSCRIBER_LIMIT` -> 503, or `AudioCoordinatorError/RuntimeError` -> 503
`VOICE_SERVICE_UNAVAILABLE` (the response body error string was not logged anywhere).

## Root-cause investigation (read-only, this task)

- `AudioCoordinator` (`event_audio.py`) default admission bounds (`max_queue_per_owner=2`,
  `max_subscribers_per_owner=8`, `max_records=64`, `max_queue=8` global) do NOT trip from just two
  concurrent events for one owner under the prefetch-then-attach pattern — empirically probed with
  a real `AudioCoordinator` (2 owners x prefetch+speak-live, concurrent threads): no rejection.
- `useLedaOrbPresentation.ts` (T17, deliberate, documented design): every new voice event —
  "including one arriving while the previous answer is still speaking" — immediately calls
  `engine.play()`, which unconditionally cancels ("cancel", true) whatever is currently playing
  (`LedaVoiceAudioEngine.play()` -> `cleanupActive('cancel', true)` -> `abortController.abort()`).
  This is the mechanism that makes two back-to-back answers overlap/drop instead of queueing.
- **Confirmed real backend defect**: `/leda/speak-live`'s response
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
  `/leda/speak-live` wiring through `_timed_pcm_stream`, so the gap was untested.
- Rejections were never logged at all (`leda_speak_live`/`leda_prefetch`'s `except` branches go
  straight to `jsonify(...)`), so the exact admission reason was invisible in the reported incident.

## Fix strategy (server-side preferred, per this task's brief; HMI also fixed since dropping the
current answer to start the next one is the direct, documented cause of "never dropped, never
overlapping" not being met today)

1. **Backend**: `_timed_pcm_stream` (`voice_service.py`) closes the wrapped `AudioSubscription` in
   its `finally`, on every teardown path (normal, error, or early external `.close()`) — mirrors
   `leda_prefetch`'s existing explicit `subscription.close()`. `AudioSubscription.close()` is
   already idempotent, so this is safe alongside the existing self-close-on-`StopIteration` path.
2. **Backend**: log (WARNING, no secrets/ids) the admission-rejection reason in `leda_speak_live`
   and `leda_prefetch` when `subscribe()`/`resolve_voice_event()` raises an
   `AudioCapacityError`/`AudioCoordinatorError`/`RuntimeError` — currently silent.
3. **Frontend**: `useLedaOrbPresentation.ts` — a new voice event arriving while the CURRENT one is
   still actively being presented (thinking or visible/speaking, i.e. before its own terminal
   fires) is queued (small bounded FIFO) instead of aborting the current playback; it starts the
   moment the current one's terminal (`onEnded`/`onError`/thinking-timeout) fires. An event arriving
   during the current one's cosmetic fade-out (AFTER its terminal already fired — the answer has
   fully played, only the visual wind-down remains) still interrupts immediately, unchanged from
   today (T17's own existing, still-passing test covers this).

## TDD

Strict TDD: enabled (source: session configuration "Strict TDD Mode: enabled").
Runner (leda-runtime, worktree-scoped):
`D:\Proyectos\Interfaz-HMI\Interfaz-HMI\services\leda-runtime\.venv\Scripts\python.exe -m
unittest discover -s D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\voice-overlap\services\leda-runtime -p "test_*.py"`.
Runner (hmi-app, worktree-scoped): `cd hmi-app && npx vitest run` / `npx tsc -b` / `npm run lint`.

Baseline (worktree, before changes, 2026-09-25): leda-runtime **1766 tests, 2 pre-existing
environmental failures, 2 skipped** (`test_real_missing_import_is_normalized_to_bootstrap_remedy_under_stop_preference`,
`test_cancellation_during_voice_startup_rolls_back_only_the_launched_child` — both spawn a
subprocess expecting a worktree-local `.venv\Scripts\python.exe` this worktree does not have;
unrelated to this task, not touched). hmi-app: 221 files / 2571 tests, all passing (after
`npm ci`, no `node_modules` present in this worktree).

## Tasks

- [x] **V1 — Reproduce and fix the AudioSubscription close-forwarding leak (backend).**
  `services/leda-runtime/src/leda_runtime/voice_service.py`, `tests/test_voice_service.py`.
  Route: inline (one already-understood file + its test, no design decision after the read-only
  investigation above).
  Evidence: new `test_speak_live_closes_the_underlying_subscription_on_early_response_teardown`
  posts to `/leda/speak-live` with `buffered=False`, reads only the first chunk (simulating the
  orb aborting mid-stream), calls `response.close()`, and asserts the mocked `AudioSubscription`'s
  `close()` was called exactly once. RED confirmed (`Expected 'close' to be called once. Called 0
  times.`) before the fix; GREEN after `_timed_pcm_stream`'s `finally` also closes `stream`
  (idempotent, safe alongside the pre-existing self-close-on-`StopIteration` path and
  `leda_prefetch`'s own explicit `.close()`). Full `test_voice_service` module: 88 passed.
  Commit: `a6b0102`.
- [x] **V2 — Log the admission-rejection reason (backend).**
  `services/leda-runtime/src/leda_runtime/voice_service.py`, `tests/test_voice_service.py`.
  Route: inline (same file as V1).
  Evidence: new `test_speak_live_logs_the_admission_rejection_reason` and
  `test_prefetch_logs_the_admission_rejection_reason` assert one WARNING line containing the
  rejection reason (e.g. `VOICE_CAPACITY_EXCEEDED`) and never the event id. RED confirmed (`no logs
  of level WARNING or higher triggered`) before adding `_logger.warning(...)` to both routes'
  `AudioCapacityError`/`(AudioCoordinatorError, RuntimeError)` branches; GREEN after. Commit:
  `a6b0102`.
- [x] **V3 — Queue an overlapping voice event instead of aborting the current answer (frontend).**
  `hmi-app/src/hooks/useLedaOrbPresentation.ts`, `useLedaOrbPresentation.test.ts`. Route:
  inline (one already-understood file + its test).
  Evidence: `presentVoiceEvent` now queues (bounded FIFO, `LEDA_ORB_VOICE_EVENT_QUEUE_LIMIT = 4`)
  a new event while `isActiveRef.current` is true (set at the start of the renamed
  `beginPresenting`, cleared at the top of `beginFade` — i.e. active from "thinking" through
  "visible" until the answer's own terminal, not through the cosmetic fade/hidden transition, so an
  event arriving during fade still interrupts immediately, unchanged); `beginFade` dequeues and
  calls `beginPresenting` directly instead of fading when a next event is queued. 4 new tests added
  (queues while thinking; queues while visible; plays the queued event immediately, in order, once
  the current one finishes; drops the newest overflow event beyond the bound). RED confirmed by
  stashing the source change and re-running: `expected "vi.fn()" to be called 1 times, but got 2
  times` (the old code always interrupted) for the "queues while thinking"/"queues while visible"
  tests, and an overflow-bound failure for the drop test (`LEDA_ORB_VOICE_EVENT_QUEUE_LIMIT` did
  not exist yet); GREEN after restoring the fix. All 27 tests in the file green (was 24; net +3
  after removing the now-inaccurate "ignores stale terminal callbacks" test, replaced by the 4
  above — the pre-existing "restarts at thinking when a new event arrives while fading" test needed
  no change, confirming fade-time interruption stays exactly as before). Full hmi-app suite: 221
  files / 2574 tests (was 2571). `npx tsc -b` clean. `npm run lint` clean. Commit: `b827937`.
  Re-entrancy check (raised by the GGA pre-commit review): `beginFade` calling `beginPresenting` ->
  `engine.play()` from inside the engine's own `onEnded`/`onError` callback is safe —
  `LedaVoiceAudioEngine` already calls `cleanupActive('complete'|'error', ...)` and nulls
  `this.active` BEFORE invoking `lifecycle.onEnded`/`onError`, so the re-entrant `play()`'s own
  `cleanupActive('cancel', true)` finds `this.active === null` and no-ops (verified by reading
  `ledaVoiceAudioEngine.ts`'s `completeLiveIfFinished`/`failActive`).

## V4 (added mid-task) — bursts of 401 on `/internal/leda/prefetch`

**Evidence (coordinator, 2026-09-25 live log):** `leda-voice-stderr.log` shows bursts of ~11 and
~9 consecutive `POST /internal/leda/prefetch` 401 within ~1 s at 09:51:08 and 09:54:29-30.

**Investigation (read-only, this task).** Correlated `leda-presentation-stderr.log` for the same
timestamps: each voice-side 401 corresponds to a presentation-side `GET
/internal/leda/voice-events/<event_id>` 401 (the loopback hop `resolve_voice_event` makes) — and
critically, **each of the ~11 has a DIFFERENT event id**, not the same id repeated. This rules out a
retry storm outright: `_fire_voice_prefetch`/`_fire_channel_a_voice_prefetch` fire exactly once per
call, on their own background thread, with a blanket `except Exception: pass` and (before this fix)
zero logging — there is no retry loop anywhere in this path to produce repeated attempts against one
event. 11 distinct ids means 11 distinct `channel_a_on_outcome` invocations, each successfully
publishing a fresh event (passing the `is_query_envelope_current` guard) and minting a fresh
prefetch token, each of which then failed to resolve on its own first and only use. The presentation
log shows no process restart (`Running on http://...` appears exactly once) and no admin/credential
activity in the relevant window that plausibly touches Channel A's separate `telegram_channel_a`
credential; the ~15-minute silent gap before the first burst (09:36:20 -> 09:51:08) is consistent
with a Channel A backlog (a burst of `getUpdates` messages, matching this task's own earlier "two
voice notes in one batch" evidence) being drained rapidly once processing resumed — plausible since
plain-text Channel A answers are local/fast (T1 finding), so 11 could legitimately complete within
~1 s.
Empirically verified `VoiceEventStore.mint_prefetch_token`/`resolve_prefetch_token` are NOT the bug:
a 20-iteration synchronous loop and an 11-thread concurrent reproduction (mint then immediately
resolve, 11 distinct events, one shared owner, real store, real `threading.RLock`) both resolved
every token correctly, 0 failures. Read `hmi_sessions.py`'s `authorize()`/`_digest()` (no crash or
side effect on a well-formed-but-foreign token; a prefetch token's `secrets.token_urlsafe(32)` shape
is byte-compatible with a session capability's, so it cleanly reaches "not a known session" and
falls through to the prefetch-token check, as designed) and `create_app`'s composition (`voice_events`
bound exactly once, before every closure that captures it) — no bug found in either.
**Conclusion: the exact trigger was not conclusively reproduced** within this task's evidence and
time budget. No retry-without-backoff exists to remove (already true: `_fire_voice_prefetch` never
retries; a prefetch token is used once, so retrying a 401 would not help and is deliberately not
added). No capacity/clock/eviction bug found in the token store itself under either serial or
concurrent load. The most likely remaining explanation — 11 near-simultaneous background prefetch
threads (one per backlog message) contending for the voice process's and presentation process's
Flask dev-server concurrency and the shared loopback `requests.Session` connection pool — was not
reproduced deterministically and is reported, not fixed, as speculative.

**Fix applied (safe, evidence-independent, directly requested): WARNING logging.**
`services/leda-runtime/src/leda_runtime/local_presentation.py` — `_fire_voice_prefetch` now logs
`Leda voice prefetch rejected: status=%s` on a non-2xx response and `Leda voice prefetch
rejected: reason=%s` (exception class name only) on any exception — WARNING, never the event id or
the capability/token, matching every other rejection-logging line added in this task (V2). This is
additive and never changes control flow (still no retry, still never raises). Route: inline (one
already-understood file + its test).
Evidence: 3 new tests in `tests/test_local_presentation.py`
(`test_fire_voice_prefetch_logs_a_warning_on_a_non_ok_response`,
`test_fire_voice_prefetch_logs_a_warning_on_an_exception`,
`test_fire_voice_prefetch_never_logs_on_a_successful_response`). RED confirmed (`no logs of level
WARNING or higher triggered`) for the first two before the fix; the third (no log on success) passed
immediately, kept as a regression guard. Full `test_local_presentation` module: 60 passed. Full
runtime suite: 1772 tests (was 1769), same 2 pre-existing environmental failures, no new failures.
Commit: see below.

**Recommendation:** the next live occurrence of this burst will now carry a WARNING line with the
actual HTTP status/exception reason; if it recurs, correlate that new line's timestamp with the
number of Channel A messages the presentation log's `getUpdates`/batch-processing lines show landed
in the same window (`Channel A getUpdates: count=N`), and check the exact elapsed time between
mint and the failed resolve to confirm or rule out the queueing-under-burst theory above.

## Acceptance criteria

- A real `/leda/speak-live` response whose HTTP teardown happens before the stream is fully
  drained (client abort) closes the underlying `AudioCoordinator` subscription exactly once.
- An admission rejection on `/leda/speak-live` or `/internal/leda/prefetch` is logged at
  WARNING with the rejection reason, no event/owner id, no secret.
- Two voice events for the same HMI session, arriving while the first is still thinking/speaking,
  both play in full, in order — the second never aborts the first mid-stream.
- An event arriving during the first answer's cosmetic fade-out (after it has already fully played)
  still starts immediately, unchanged from before.
- Runtime suite green (2 known pre-existing worktree-`.venv` environmental failures acceptable,
  named above). hmi-app `npx vitest run` / `npx tsc -b` / `npm run lint` clean.

## Live verification (2026-09-27)

Passed. Overlapping Channel A answers are queued and play in order (no drop, no overlap); the
overall orb "thinking" signal on voice-note receipt also works (answer ~3 s later). See also
`odd/tasks/channel-a-voice-note-ux.md`'s K2 fix (rejected voice notes no longer flash the orb),
integrated on `main` `76464d0`. No pending work.
