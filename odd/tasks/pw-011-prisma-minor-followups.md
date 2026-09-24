# PW-011 Prisma minor follow-ups — ODD bug-fix tracker

> ODD bug fix (not SDD). Branch `fix/pw-011-prisma-minor-followups` (from `main` `30f84ca`).
> Engram mirror: `odd/pw-011-prisma-minor-followups/tasks`; backlog topic `backlog/prisma-voice-minor-followups`.

## Objective

Close out five minor follow-ups inherited from PW-006 (T14/T16), decided per item as fix-now
(clear cause, small, no product decision) or report (needs a product decision or is larger than a
follow-up):

1. **M1** — bursts of 401 on `/internal/prisma/voice-events/<id>` (T16 follow-up).
2. **M2** — confirm the HMI returns from polling to SSE after a fallback (T16 follow-up).
3. **M3** — Channel A inactivity expiry leaves the "Desvincular" menu entry/reply keyboard (T14 gap).
4. **M4** — runtime timing logs at WARNING level, without losing `HMI voice timeline:` lines.
5. **M5** — Telegram typing action may arrive after the answer.

## TDD

Strict TDD: enabled (source: session/global orchestrator config).
Runner (prisma-runtime, worktree-scoped): `D:\Proyectos\Interfaz-HMI\Interfaz-HMI\services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\pw-011\services\prisma-runtime -p "test_*.py"`.
Runner (hmi-app, worktree-scoped): `cd hmi-app && npx vitest run` / `npx tsc -b` / `npm run lint`.
Baseline (worktree, before changes): prisma-runtime 1532 tests, 2 pre-existing environmental
failures (`test_real_missing_import_is_normalized_to_bootstrap_remedy_under_stop_preference`,
`test_cancellation_during_voice_startup_rolls_back_only_the_launched_child` — both expect a
worktree-local `.venv\Scripts\python.exe` that does not exist in this worktree; unrelated to
PW-011). hmi-app: 221 files / 2532 tests, `tsc -b` clean, `npm run lint` clean.

## Tasks

- [x] **M1 — 401 bursts on `/internal/prisma/voice-events/<id>`.** Route: inline
  (`services/prisma-runtime/src/prisma_runtime/event_audio.py`, one already-understood file, no
  design decision). Fix now.
  - **Root cause.** `AudioCoordinator._State.capability` is captured once, at admission, from the
    *first* subscriber's `_capability`. When a second subscriber (same owner, different caller)
    attaches to an existing non-terminal job — e.g. Channel A's `/internal/prisma/prefetch` (a
    60s-TTL, event-scoped prefetch token) admits the job first, then the real HMI browser session
    calls `/prisma/speak-live` with its own long-lived capability and attaches to the same
    still-queued job — `subscribe()` only refreshed `state.capability` on the `retry` path
    (`event_audio.py:368`, pre-existing), never on a plain attach. The dequeue-time revalidation in
    `_run()` (`event_audio.py:459-460`) then reuses the *stale* first-subscriber capability. Evidence
    from `%LOCALAPPDATA%\CoreAnalytics\Prisma\logs\prisma-presentation-stderr.log`: bursts of many
    *distinct* event ids all answering 401 within the same 1-2s window (e.g. 18:10:14-18:10:15,
    18:31:23-18:31:24) — consistent with the single-threaded worker catching up on a backlog of
    jobs whose stored capability no longer matches the live subscriber.
  - **Fix.** `subscribe()` now refreshes `state.capability` from the calling subscriber on every
    attach to a non-created state (not just `retry`), so dequeue-time revalidation always uses the
    most recent subscriber's own capability. Safe: `state_key` is `(owner_id, event_id)`, and
    `owner_id` is already authoritative (resolved server-side from the calling capability before
    `subscribe()` is invoked) — a later attacher can never be a different owner.
  - **TDD.** New test `test_late_attach_to_a_queued_job_refreshes_the_capability_used_at_dequeue`
    (`services/prisma-runtime/tests/test_event_audio.py`): blocks the worker on a first job, admits
    a second job with a prefetch-style token, attaches a second subscriber with a session-style
    capability while still queued, asserts `state.capability` updated immediately and that dequeue's
    `event_validator` sees the newer capability (not the stale one). RED confirmed (validator saw
    `["prefetch-token", "session-capability", "prefetch-token"]` instead of
    `[..., "session-capability"]`) before the fix; GREEN after.
  - **Checks:** `tests.test_event_audio` — OK. Full prisma-runtime suite — 1532 (2 pre-existing
    environmental failures, unrelated).
  - **Commits:** `54a765c` (fix), `6401c7a` (review follow-up: gate the refresh to
    admitting/queued jobs only, so a capability is never reintroduced onto an already
    active/complete/evicted job).

- [x] **M2 — HMI never returns from polling to SSE.** Route: inline
  (`hmi-app/src/services/voiceEventListener.service.ts`, one already-understood file). Fix now.
  - **Root cause.** `startPolling()` sets `usingPolling = true` and is never reset; nothing ever
    re-attempted SSE afterward. Confirmed by the live-test log evidence in the parent doc (1148
    polling GETs vs 22 SSE connections in one session) and by reading the module: no code path calls
    `startSse()` again once `usingPolling` flips.
  - **Fix.** Added a 30s SSE-retry timer (`SSE_RETRY_INTERVAL_MS`) armed whenever `startPolling()`
    runs; on fire it flips `usingPolling` back to `false` and re-attempts `startSse()`. A failed
    retry runs `startSse()`'s own existing fallback (`startPolling()` again), which re-arms the
    timer — so retries continue for the listener's whole lifetime. Also fixed a latent issue
    uncovered while testing the retry: `poll()`'s own reschedule in its `finally` block did not
    check `usingPolling`, so a poll already in flight when SSE recovers would still schedule one
    more poll cycle; guarded on `usingPolling` and proactively cleared the pending poll timer on a
    successful reconnect.
  - **TDD.** New test `PW-011 M2: returns to SSE once the retry interval elapses after a fallback to
    polling` (`hmi-app/src/services/voiceEventListener.service.test.ts`). RED confirmed (3rd fetch
    call — the retry — never happened); GREEN after the retry timer; a follow-up RED/GREEN cycle
    caught the stale-poll-reschedule issue (4th unexpected fetch call after recovery) before it was
    fixed.
  - **Checks:** `npx vitest run src/services/voiceEventListener.service.test.ts` — 37/37 OK. Full
    hmi-app suite — 221 files / 2532 tests OK. `npx tsc -b` clean. `npm run lint` clean.
  - **Commit:** `d76a871`.

- [ ] **M3 — Channel A inactivity expiry leaves the Telegram menu/keyboard.** Reported, not fixed —
  larger than a follow-up. See report below.

- [x] **M4 — routine timing logs at WARNING level.** Route: inline, one file family at a time
  (mechanical, same pattern repeated; no design decision). Fix now.
  - **How the log is configured.** No `logging.basicConfig` exists anywhere in this runtime (by
    design, per T5's own comments); an unconfigured logger falls back to Python's WARNING-or-above
    "handler of last resort", which is what makes any of this visible in
    `prisma-presentation-stderr.log` / `prisma-voice-stderr.log` at all. Downgrading a line to INFO
    therefore makes it stop appearing in the default log — the intended effect for routine
    per-request/per-job timing noise, which was only ever WARNING as a workaround. Left unchanged:
    every genuinely warning-worthy line (Channel A background-failure/retry/reconnect signals in
    `channel_a_manager.py`; the two `except Exception:` failure-only logs in
    `channel_a_transport.py`), and — explicitly, per the item's instruction — the
    `HMI voice timeline:` line (`voice_timeline_diagnostics.format_timeline_log_line`, called from
    `local_presentation.py:1257`) that the parent reads from the log.
  - **Downgraded (WARNING → INFO), all pure per-request/per-job timing with no failure signal:**
    - `channel_a_lifecycle.py`: `Channel A update: type=... elapsed_ms=...`.
    - `channel_a_transport.py`: `Channel A sendMessage: elapsed_ms=...` (the unconditional
      success-or-failure timing; the two failure-only menu/chat-action logs were left at WARNING).
    - `event_audio.py` (`AudioCoordinator`): `subscribe: validate_elapsed_ms`,
      `generate: queue_wait_ms`, `generate: validate_elapsed_ms`, `generate: credential_elapsed_ms`.
    - `voice_service.py`: Gemini client resolve/build elapsed, TTS job create elapsed, TTS cache
      hit/miss, Gemini time-to-first-byte/first-yield-processing, voice-event-resolve elapsed,
      speak-live first-chunk/stream-end elapsed, speak-live event-publish-to-received delta (10
      call sites, all confirmed routine by reading their call context).
    - `local_presentation.py`: `Prisma voice event publish: elapsed_ms=...` (direct HMI-ask path)
      and `Prisma voice event publish (channel A): elapsed_ms=...` (Channel A answer-delivery path).
  - **Left at WARNING (not touched):** `channel_a_manager.py` (background-failure/reconnect/retry
    signals — genuine operational conditions), `channel_a_transport.py`'s two failure-only logs,
    `local_presentation.py`'s `HMI voice timeline:` line and its `getUpdates`-count log in
    `channel_a_transport.py` (mixed failure/activity signal, already noise-disciplined, left as is).
  - **TDD.** For every downgraded call site with existing test coverage, changed the test's
    `assertLogs(..., level="WARNING")` to `level="INFO"` and added an explicit
    `line.startswith("INFO:")` assertion (an unqualified level bump alone would not fail against
    unfixed code, since a WARNING record also satisfies an INFO capture level) — confirmed RED
    (`AssertionError: False is not true`) before each corresponding source change, GREEN after.
    Files: `test_channel_a_lifecycle.py`, `test_channel_a_transport.py`, `test_event_audio.py`,
    `test_voice_service.py` (bulk level change plus 7 new prefix assertions), `test_local_presentation.py`.
    One line (`local_presentation.py`'s Channel-A-answer publish-elapsed log) has no existing test
    reaching that closure in isolation (`channel_a_on_outcome`, only reachable through the full
    `channel_a_manager` wiring) — changed without a new dedicated test; low risk (identical,
    already-proven pattern to its direct-HMI sibling), flagged here rather than silently skipped.
  - **Checks:** full prisma-runtime suite — 1532 tests, same 2 pre-existing environmental failures,
    no new failures.
  - **Commits:** `54a765c`/`6401c7a` (event_audio.py's own portion landed alongside the M1 fix —
    process note: a `git add <path>` during the M1 review-follow-up commit re-swept the still-unstaged
    M4 hunks for `event_audio.py`/`test_event_audio.py` back in; functionally identical to a separate
    commit, just not cleanly isolated for that one file pair), `0930989` (the other four files),
    `47c7f8e` (stale-comment follow-up caught by the pre-commit review).

- [ ] **M5 — typing action may arrive after the answer.** Reported, not fixed — see report below.

## Verification (final, all items)

- `D:\Proyectos\Interfaz-HMI\Interfaz-HMI\services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\pw-011\services\prisma-runtime -p "test_*.py"` — 1534 tests, 2 pre-existing environmental failures (same as baseline), no new failures.
- `cd hmi-app && npx vitest run` — 221 files / 2532 tests OK. `npx tsc -b` clean. `npm run lint` clean.

## M3 report (needs a product/scope decision)

Not fixed. `ChannelAPairingRegistry._purge_locked` (in
`services/prisma-runtime/src/prisma_runtime/channel_a_pairing.py`) silently drops an idle-expired
link — this is the "silent registry purge" T14's own doc already named as a pre-existing,
out-of-scope gap. Two things block a small fix:

1. The registry's own module docstring documents, as a deliberate invariant, that "every other
   external callback (owner-removal notifications, delivery, playback control) belongs to the
   caller and never runs under the domain lock" — so any Telegram cleanup must happen *outside*
   `_purge_locked`, driven by something that periodically asks the registry what changed.
2. `channel_a_bot.py` already has exactly that shape for the *warning* threshold
   (`due_warnings()` + `send_inactivity_warnings()`), but its own module docstring says the
   proactive sweep is "an explicit, synchronous sweep, not a background loop" and that "the
   scheduler that invokes the warning sweep" is "deliberately absent from this stage" — deferred to
   "a future RCA-5 scheduler". Confirmed by grep: `send_inactivity_warnings` has no caller anywhere
   in the runtime today: the warning mechanism itself is not live yet.

Closing M3 the way the item asks ("reuse the existing cleanup path") means either (a) building a
parallel `due_expirations()` + `send_expiry_cleanup()` pair mirroring the warning-sweep shape, which
is a real, testable, mechanical addition but still sits on top of (b) building the RCA-5 scheduler
that would actually call it on a cadence — and RCA-5 is explicitly out of scope for this stage per
the existing code's own docstrings. Building the scheduler now would preempt a decision the project
already deferred. Recommend the user decide: (1) build the RCA-5 scheduler now as part of closing
this gap, folding both the warning sweep and the expiry cleanup into it, or (2) keep this gap open
and re-file it once RCA-5 is scheduled, or (3) accept the gap permanently (stale command/menu button
until the next explicit unlink) as low-risk cosmetic debt.

## M5 report (no clear, verifiable fix within this item's scope)

Not fixed. `channel_a_bot.py`'s `_typing()` (the one call site, `channel_a_bot.py:1007`, right
before `handle_query()`) already fires the "typing…" chat action *before* the answer is computed —
the ordering bug is not in the call sequence. The cause is `_typing()`'s own T13 design: it fires
`send_chat_action` on an independent, fire-and-forget background daemon thread specifically so it
can never delay the answer that follows on the main thread. T13's own docstring (`_typing`, and the
test `test_typing_indicator_is_sent_without_blocking_the_answer`) documents this as a *deliberate*
trade-off, made after a live measurement showed the previous synchronous call added ~0.36s to every
question: "the exact relative order between send_chat_action and send_message is no longer
guaranteed." Once two independent HTTP requests race to Telegram's servers with no synchronization,
nothing on this side can guarantee which one Telegram processes/renders first.

I prototyped the smallest plausible mitigation — block `_typing()` briefly (bounded, non-blocking on
the actual network round trip) until its worker thread has been scheduled and is about to call
`send_chat_action`, narrowing the dispatch-order race without reintroducing T13's latency. It failed
its own purpose as a Strict-TDD candidate: a test asserting `_typing()`'s caller can't proceed before
`send_chat_action` was invoked **already passes against the current, unfixed code** in this test
harness (`FakeTransport.send_chat_action` is an instant in-process list append, so CPython's thread
creation already appears to yield the new thread a turn before `_typing()` returns, empirically,
every run) — so there is no reproducible RED to fix against, and no way to prove the mitigation
changes anything observable here. The real race is a *production, real-network* phenomenon (two
concurrent HTTP requests to Telegram with independent latency), not a Python-thread-scheduling one;
this project's synchronous `FakeTransport` test doubles cannot simulate that, so I could not
honestly claim a verified fix.

Closing this properly means either (a) accepting the T13 trade-off as-is (typing is "UX feedback,
not a delivery contract," per its own docstring) and treating an occasional out-of-order arrival as
expected, low-severity behavior, or (b) reintroducing a bounded wait for the *actual* `send_chat_action`
round trip before producing the answer, which is precisely the latency T13 was written to remove —
a real product trade-off (guaranteed visual ordering vs. the measured ~0.36s/question latency) that
needs the user's call, not a code-level "clear cause" fix.
