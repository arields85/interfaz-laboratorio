# PW-011 Leda minor follow-ups — ODD bug-fix tracker

> ODD bug fix (not SDD). Branch `fix/pw-011-leda-minor-followups` (from `main` `30f84ca`).
> Engram mirror: `odd/pw-011-leda-minor-followups/tasks`; backlog topic `backlog/leda-voice-minor-followups`.

## Objective

Close out five minor follow-ups inherited from PW-006 (T14/T16), decided per item as fix-now
(clear cause, small, no product decision) or report (needs a product decision or is larger than a
follow-up):

1. **M1** — bursts of 401 on `/internal/leda/voice-events/<id>` (T16 follow-up).
2. **M2** — confirm the HMI returns from polling to SSE after a fallback (T16 follow-up).
3. **M3** — Channel A inactivity expiry leaves the "Desvincular" menu entry/reply keyboard (T14 gap).
4. **M4** — runtime timing logs at WARNING level, without losing `HMI voice timeline:` lines.
5. **M5** — Telegram typing action may arrive after the answer.

**2026-09-24 follow-up — user decisions received for M3 and M5** (both were reported, not fixed,
in the first pass below): the user explicitly authorized (M3) building the periodic Channel A
sweep now, covering both the inactivity-warning wiring and idle-expiry cleanup, and (M5) stopping
the typing indicator once the answer for that message has already been sent, via per-message state
checked deterministically. Both are now implemented; see the updated M3/M5 entries and the
"2026-09-24 follow-up" sections below. The original report text is kept for the record.

**2026-09-24 second follow-up — M6, "documento" leaked into user-facing copy.** The internal term
"documento" (referring to the HMI destination) leaked into three Telegram messages instead of the
same `{label}` the pairing flow already shows in `CONFIRMATION_PROMPT_TEMPLATE`/`WELCOME_TEMPLATE`.
Fixed; see M6 below.

**2026-09-24 third follow-up — M7, the "documento" occurrence found (not changed) during M6 is now
approved too.** `channel_a_query.py`'s `COPY_QUERY_UNAVAILABLE` also named "el documento del HMI";
the user approved the same `{label}` treatment for it. Fixed; see M7 below.

## TDD

Strict TDD: enabled (source: session/global orchestrator config).
Runner (leda-runtime, worktree-scoped): `D:\Proyectos\Interfaz-HMI\Interfaz-HMI\services\leda-runtime\.venv\Scripts\python.exe -m unittest discover -s D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\pw-011\services\leda-runtime -p "test_*.py"`.
Runner (hmi-app, worktree-scoped): `cd hmi-app && npx vitest run` / `npx tsc -b` / `npm run lint`.
Baseline (worktree, before changes): leda-runtime 1532 tests, 2 pre-existing environmental
failures (`test_real_missing_import_is_normalized_to_bootstrap_remedy_under_stop_preference`,
`test_cancellation_during_voice_startup_rolls_back_only_the_launched_child` — both expect a
worktree-local `.venv\Scripts\python.exe` that does not exist in this worktree; unrelated to
PW-011). hmi-app: 221 files / 2532 tests, `tsc -b` clean, `npm run lint` clean.

## Tasks

- [x] **M1 — 401 bursts on `/internal/leda/voice-events/<id>`.** Route: inline
  (`services/leda-runtime/src/leda_runtime/event_audio.py`, one already-understood file, no
  design decision). Fix now.
  - **Root cause.** `AudioCoordinator._State.capability` is captured once, at admission, from the
    *first* subscriber's `_capability`. When a second subscriber (same owner, different caller)
    attaches to an existing non-terminal job — e.g. Channel A's `/internal/leda/prefetch` (a
    60s-TTL, event-scoped prefetch token) admits the job first, then the real HMI browser session
    calls `/leda/speak-live` with its own long-lived capability and attaches to the same
    still-queued job — `subscribe()` only refreshed `state.capability` on the `retry` path
    (`event_audio.py:368`, pre-existing), never on a plain attach. The dequeue-time revalidation in
    `_run()` (`event_audio.py:459-460`) then reuses the *stale* first-subscriber capability. Evidence
    from `%LOCALAPPDATA%\CoreAnalytics\Leda\logs\leda-presentation-stderr.log`: bursts of many
    *distinct* event ids all answering 401 within the same 1-2s window (e.g. 18:10:14-18:10:15,
    18:31:23-18:31:24) — consistent with the single-threaded worker catching up on a backlog of
    jobs whose stored capability no longer matches the live subscriber.
  - **Fix.** `subscribe()` now refreshes `state.capability` from the calling subscriber on every
    attach to a non-created state (not just `retry`), so dequeue-time revalidation always uses the
    most recent subscriber's own capability. Safe: `state_key` is `(owner_id, event_id)`, and
    `owner_id` is already authoritative (resolved server-side from the calling capability before
    `subscribe()` is invoked) — a later attacher can never be a different owner.
  - **TDD.** New test `test_late_attach_to_a_queued_job_refreshes_the_capability_used_at_dequeue`
    (`services/leda-runtime/tests/test_event_audio.py`): blocks the worker on a first job, admits
    a second job with a prefetch-style token, attaches a second subscriber with a session-style
    capability while still queued, asserts `state.capability` updated immediately and that dequeue's
    `event_validator` sees the newer capability (not the stale one). RED confirmed (validator saw
    `["prefetch-token", "session-capability", "prefetch-token"]` instead of
    `[..., "session-capability"]`) before the fix; GREEN after.
  - **Checks:** `tests.test_event_audio` — OK. Full leda-runtime suite — 1532 (2 pre-existing
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

- [x] **M3 — Channel A inactivity expiry leaves the Telegram menu/keyboard.** Originally reported
  (see report below); user decision 2026-09-24: build the periodic sweep now, both the warning
  wiring and expiry cleanup. Route: delegated direct (3 non-trivial files across registry/bot/
  activation layers, each with its own tests). Fixed.
  - **Registry (`channel_a_pairing.py`).** New `due_expirations()`, mirroring `due_warnings()`'s own
    shape: under the lock, purge and return a snapshot of every link released by idle expiry THIS
    call. `_purge_locked` gained an internal `collect_expired_links` flag (default `False`, every
    other call site unchanged) so the existing purge logic isn't duplicated. Must run BEFORE
    `due_warnings()` in the same sweep tick, or `due_warnings()`'s own purge silently drops the link
    first (proven by the pre-existing `test_due_warnings_is_empty_at_expiry_and_purges_the_link`).
    New `ChannelAPairingExpirySweepTests` (8 tests) plus `due_expirations` added to the exhaustive
    regressing-clock coverage test. RED confirmed (`AttributeError: no attribute 'due_expirations'`).
  - **Bot (`channel_a_bot.py`).** New `send_expiry_cleanup()` + `_cleanup_one()`, mirroring
    `send_inactivity_warnings()`/`_warn_one()`'s own synchronous, no-own-loop contract. Reuses the
    exact effects `_link_action`'s explicit "Desvincular" branch already uses: `_remove_reply_keyboard()`
    on the notice send, `_clear_unlink_menu()` for the T14 per-chat command/button, `_forget_claims_for_owner()`
    and `_purge_actions()` for the local index. New `ExpiryCleanupOutcome` dataclass. New
    `ChannelAExpiryCleanupSweepTests` (9 tests), all GREEN on first implementation after RED
    (`ImportError: cannot import name 'COPY_EXPIRED'`).
  - **Activation (`channel_a_activation.py`).** `ChannelAActivation` now arms a self-rescheduling
    `Timer` (`CHANNEL_A_SWEEP_INTERVAL_SECONDS = 30.0`) on a successful `start()`, calling
    `send_expiry_cleanup()` then `send_inactivity_warnings()` on the live dialogue each tick, and
    disarms it in `stop()` before withdrawing the dialogue/registry. Injectable `sweep_timer_factory`
    (defaults to real `threading.Timer`), mirroring `ChannelAManager`'s own backoff-retry Timer
    pattern exactly (including never running Telegram effects under the pairing registry's own
    domain lock). New `ChannelAActivationSweepSchedulerTests` (7 tests) in `test_channel_a_activation.py`,
    using a `FakeSweepTimerFactory` test double (mirrors `channel_a_manager.py`'s own
    `FakeRetryTimer`/`FakeTimerFactory`) injected into every activation this offline test module
    builds, so no test starts a real background thread. RED confirmed
    (`TypeError: unexpected keyword argument 'sweep_timer_factory'` /
    `ImportError: cannot import name 'CHANNEL_A_SWEEP_INTERVAL_SECONDS'`).
  - **Docstrings updated** (per instruction): `channel_a_bot.py`'s module docstring no longer lists
    "the scheduler that invokes the warning sweep" as deliberately absent, and now names
    `ChannelAActivation`'s periodic sweep as the real caller; `send_inactivity_warnings()`'s own
    docstring no longer says "a future RCA-5 scheduler calls this," naming the actual caller and
    ordering (`send_expiry_cleanup` first) instead.
  - **New user-facing Spanish (usted), verbatim:** `COPY_EXPIRED = "Esta vinculación se cerró por
    inactividad."` — sent once, to the phone, in place of the previously completely silent release,
    with the reply keyboard removed on the same message. Deliberately distinct from `COPY_UNLINKED`
    ("Este teléfono quedó desvinculado.") since this was never an explicit tap.
  - **Regression found and fixed during this pass:** `test_channel_a_delivery_authority.py` globally
    patches `threading.Thread.start` to refuse (an offline-dispatch guard) and constructs a real
    `ChannelAActivation` whose fake runner's `start()` returns `True` — since `threading.Timer.start()`
    calls the inherited `Thread.start()`, the new scheduler broke 26 of that file's 36 tests the
    first time the full suite ran (they passed in isolation runs that didn't include this file).
    Fixed by injecting an inert `sweep_timer_factory` there too, matching the other two test files.
  - **Checks:** `tests.test_channel_a_pairing` — 67 OK. `tests.test_channel_a_bot` — 222 OK.
    `tests.test_channel_a_activation` — 39 OK. `tests.test_channel_a_delivery_authority` — 36 OK.
    Full leda-runtime suite — 1562 tests (was 1534 before this follow-up), same 2 pre-existing
    environmental failures, no new failures.
  - **Commits:** `a6179e0` (registry `due_expirations()`), `66c3216` (review follow-up: cover
    `due_expirations` in the regressing-clock test), `16f9971` (bot `send_expiry_cleanup()`),
    `7ba2c78` (activation scheduler + docstrings + delivery-authority test fix).
  - Original report (needs-a-decision framing, now resolved) kept below for the record.

- [x] **M4 — routine timing logs at WARNING level.** Route: inline, one file family at a time
  (mechanical, same pattern repeated; no design decision). Fix now.
  - **How the log is configured.** No `logging.basicConfig` exists anywhere in this runtime (by
    design, per T5's own comments); an unconfigured logger falls back to Python's WARNING-or-above
    "handler of last resort", which is what makes any of this visible in
    `leda-presentation-stderr.log` / `leda-voice-stderr.log` at all. Downgrading a line to INFO
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
    - `local_presentation.py`: `Leda voice event publish: elapsed_ms=...` (direct HMI-ask path)
      and `Leda voice event publish (channel A): elapsed_ms=...` (Channel A answer-delivery path).
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
  - **Checks:** full leda-runtime suite — 1532 tests, same 2 pre-existing environmental failures,
    no new failures.
  - **Commits:** `54a765c`/`6401c7a` (event_audio.py's own portion landed alongside the M1 fix —
    process note: a `git add <path>` during the M1 review-follow-up commit re-swept the still-unstaged
    M4 hunks for `event_audio.py`/`test_event_audio.py` back in; functionally identical to a separate
    commit, just not cleanly isolated for that one file pair), `0930989` (the other four files),
    `47c7f8e` (stale-comment follow-up caught by the pre-commit review).

- [x] **M5 — typing action may arrive after the answer.** Originally reported (see report below);
  user decision 2026-09-24: stop the indicator once the answer for that message is already sent,
  via per-message state, tested deterministically (inject dispatch points, not thread timing). Route:
  inline (one file, `channel_a_bot.py`). Fixed.
  - **Design.** `_typing()` now returns a per-message `threading.Event` ("answered") instead of
    `None`. Its background worker's actual dispatch logic was split into a new
    `_send_typing_unless_answered(chat_id, answered, send)` static method — directly callable, no
    thread — which checks `answered.is_set()` immediately before calling `send_chat_action` and
    skips the call once it is set. `_handle_query` captures the returned event and calls
    `.set()` in a `finally` right after `self.query.handle_query(...)` returns, whether or not an
    answer was actually sent (once query handling is done, "typing…" no longer means anything).
    T13's non-blocking latency win is unchanged: the worker still runs on its own background
    thread; the event is a plain flag, never awaited by the caller.
  - **TDD.** New direct tests on `_send_typing_unless_answered` (skip-when-answered, send-when-not,
    swallows-a-failure) — fully deterministic, no thread. New wiring-level test that captures the
    background worker (patches `threading.Thread` to record its target instead of starting it), runs
    a full query to completion, then invokes the captured worker exactly as a very-late OS schedule
    would — asserts no chat action fired. RED confirmed for all four
    (`AttributeError: no attribute '_send_typing_unless_answered'` / an unfixed capture test failing
    with a chat action present when none was expected).
  - **Existing-test fallout (expected, not a regression):** three pre-existing tests
    (`test_typing_indicator_is_sent_without_blocking_the_answer`,
    `test_typing_indicator_never_delays_the_answer`,
    `test_typing_indicator_failure_never_blocks_or_fails_the_answer`) asserted the indicator always
    arrives, relying on real (unsynchronized) thread scheduling — a guarantee the new skip check
    deliberately removes for a fast-enough answer. Rewrote all three using `parse_hook`-based
    sequencing (an existing test seam: a hook run synchronously inside `handle_query`'s own parse
    step) to block answer completion until the real background worker has verifiably passed its
    "already answered" check, so they still deterministically prove delivery and non-blocking
    behavior on the path where typing legitimately fires first — reproducible on any platform/timing,
    not dependent on this machine's own thread-scheduling behavior. Removed the now-unused
    `_wait_for_chat_action` polling helper.
  - **Checks:** `tests.test_channel_a_bot` — 222 OK (run 5x back to back, no flake). Full
    leda-runtime suite — 1562 tests, same 2 pre-existing environmental failures, no new failures.
  - **Commit:** `2ccddef`.
  - Original report (needs-a-decision framing, now resolved) kept below for the record.

- [x] **M6 — "documento" leaked into user-facing Telegram copy.** Route: inline (one file,
  `channel_a_bot.py`). Fixed.
  - **Fix.** `COPY_DESTINATION_UNAVAILABLE`, `COPY_INACTIVITY_WARNING` and `COPY_EXPIRED` became
    `{label}` templates. New `_display_label(label, *, sentence_start=False)` returns `label`
    verbatim when usable, else the fallback ("la HMI" mid-sentence, "La HMI" at a sentence start).
    Each call site formats with the SAME trusted label source `CONFIRMATION_PROMPT_TEMPLATE`/
    `WELCOME_TEMPLATE` already use, no new data source: `_claim`'s branch (no label was ever
    established) uses the fallback; `_confirm`'s branch uses `claim.label` (the destination the
    human actually confirmed against, never the new/changed one the fresh lookup returned);
    `_warn_one`/`_cleanup_one` (the M3 sweep) call `self._read_label(owner_id)` fresh, falling back
    on a lookup failure or an unusable value rather than skipping the notice.
  - **Final strings (usted, verbatim):**
    - `COPY_INACTIVITY_WARNING`: `"La vinculación con {label} se va a cerrar por inactividad.\nUse el botón para seguir conectado, o el botón «Desvincular» de este chat para desvincular este teléfono."`
    - `COPY_EXPIRED`: `"La vinculación con {label} se cerró por inactividad."`
    - `COPY_DESTINATION_UNAVAILABLE`: `"{label} ya no está disponible. Genere un código nuevo desde la pantalla."`
    - Fallback: `"la HMI"` mid-sentence, `"La HMI"` at a sentence start (only `COPY_DESTINATION_UNAVAILABLE` opens with the placeholder).
  - **Other "documento" occurrences found, not changed (out of scope, reported per instruction):**
    `channel_a_query.py`'s `COPY_QUERY_UNAVAILABLE` = `"No se pudo leer el documento del HMI en este
    momento. Intente de nuevo en unos segundos."` — a different concept (the snapshot/document
    itself failed to read, not the destination's display name), not one of the three listed messages.
  - **TDD.** Updated 8 existing exact-copy assertions (`test_missing_destination_label_...`,
    `test_unusable_label_values_all_fail_closed`, `test_confirm_needs_a_fresh_label_...`,
    `test_confirm_refuses_when_the_presented_label_changed`, the warning/expiry sweep copy tests) to
    expect the formatted string; added 2 new fallback tests (warning sweep, expiry sweep) and 3
    direct tests on `_display_label`. RED confirmed: 15 failures (`AssertionError` comparing the
    sent text against the old literal constant, since the source now sends an unformatted
    `"...{label}..."` template) before updating the call sites; GREEN after.
  - **Checks:** `tests.test_channel_a_bot` — 227 OK. Full leda-runtime suite — 1567 tests, same 2
    pre-existing environmental failures, no new failures.
  - **Commit:** `dcabe50`.

- [x] **M7 — "documento" in `channel_a_query.py`'s `COPY_QUERY_UNAVAILABLE`.** User decision
  2026-09-24 (the occurrence M6 found and reported instead of changing). Route: inline (one small
  seam addition across `channel_a_query.py` + its one real caller in `channel_a_bot.py`). Fixed.
  - **String:** `"No se pudieron leer los datos de {label} en este momento. Intente de nuevo en
    unos segundos."`
  - **Where the label comes from.** `channel_a_query.py`'s own module docstring lists the pairing
    registry/Telegram/label lookup as "deliberately absent from this stage," and
    `channel_a_bot.py` already imports FROM `channel_a_query.py` (so the reverse import would be
    circular) — so the coordinator cannot resolve or format the label itself. New required
    constructor dependency `resolve_label` (validated `callable`, same pattern as
    `validate`/`read_context`/`parse`/`deliver`): `ChannelAPairingDialogue.enable_queries` injects
    `self._resolve_display_label`, a new one-line method calling the SAME `self._read_label(owner_id)`
    (no new data source) and M6's own `_display_label()` fallback helper — identical semantics, not
    reimplemented. `_fail_closed` calls `self._resolved_label(binding.owner_id)` (foreign code:
    any `resolve_label` failure or unusable value fails closed to a local `_FALLBACK_LABEL = "la
    HMI"` constant, exactly matching M6's mid-sentence fallback text, kept local to avoid the
    circular import).
  - **TDD.** Added `resolve_label` to `test_channel_a_query.py`'s shared `QueryHarness`/`build()`
    (single point covering ~90 existing tests) and to its "injected callables must be callable"
    loop test. New `ChannelAQueryUnavailableLabelTests` (4 tests: resolved label used, a raising
    resolver falls back, an unusable resolved value falls back, the owner id never leaks). Updated
    10 existing exact-copy assertions across `test_channel_a_query.py` plus 2 in `test_channel_a_bot.py`
    and 3 in `test_channel_a_activation.py`. RED confirmed: the whole `test_channel_a_query.py` file
    (95/98 tests) failed at harness construction (`TypeError: unexpected keyword argument
    'resolve_label'`) before the source change; GREEN after.
  - **Checks:** `tests.test_channel_a_query` — 98 OK. `tests.test_channel_a_bot` — 227 OK.
    `tests.test_channel_a_activation` — 39 OK. Full Channel A suite (query/bot/activation/
    delivery-authority/manager/pairing/lifecycle/transport) — 848 OK. Full leda-runtime suite —
    1571 tests, same 2 pre-existing environmental failures, no new failures.
  - **Commits:** `32f61dc` (fix), `361d210` (review follow-up: `_typing`'s return type annotation,
    stale since the M5 fix).

## Verification (final, all items)

- `D:\Proyectos\Interfaz-HMI\Interfaz-HMI\services\leda-runtime\.venv\Scripts\python.exe -m unittest discover -s D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\pw-011\services\leda-runtime -p "test_*.py"` — 1571 tests, 2 pre-existing environmental failures (same as baseline; `test_real_missing_import_is_normalized_to_bootstrap_remedy_under_stop_preference` and `test_cancellation_during_voice_startup_rolls_back_only_the_launched_child`, both expecting a worktree-local `.venv\Scripts\python.exe` this worktree doesn't have), no new failures.
- `cd hmi-app && npx vitest run` — 221 files / 2532 tests OK. `npx tsc -b` clean. `npm run lint` clean. (hmi-app untouched in this follow-up; re-verified unchanged.)

## M3 report (needs a product/scope decision)

Not fixed. `ChannelAPairingRegistry._purge_locked` (in
`services/leda-runtime/src/leda_runtime/channel_a_pairing.py`) silently drops an idle-expired
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

## Integration

Rebased onto `main` at `2b4c683` (`git rebase main`). The rebase replayed all 18 commits with zero
conflicts — `main`'s Channel B work, PW-004, and the dev launcher landed in disjoint files from
PW-011's changes. New tip: `21fcbe3`.

Checks after rebase:
- Runtime suite (`python -m unittest discover -s services/leda-runtime -p "test_*.py"`): 1616
  tests, 2 failures, 2 skipped. Both failures are the known environment-only cases that expect a
  worktree-local `.venv\Scripts\python.exe` bootstrapped via `operations\bootstrap-local.ps1`
  (`test_real_missing_import_is_normalized_to_bootstrap_remedy_under_stop_preference` and
  `test_cancellation_during_voice_startup_rolls_back_only_the_launched_child`), not caused by the
  rebase.
- hmi-app `npx vitest run`: 221 test files, 2551 tests, all passed.
- hmi-app `npx tsc -b`: clean, no output.
- hmi-app `npm run lint`: clean, no findings.

`fix/pw-011-leda-minor-followups` is confirmed a descendant of `main`
(`git merge-base --is-ancestor main HEAD` succeeds).

## Live verification (2026-09-25)

Passed for the items exercised live: Channel A's inactivity warning and idle-expiry cleanup (M3)
fired correctly, showing the confirmed HMI label ("Notebook") rather than falling back to "la HMI"
(the label-capture fix landed as F3 in `odd/tasks/live-test-2026-09-25-runtime.md`); the "typing…"
indicator behavior (M5, and Channel B's F6 counterpart) was confirmed live in the same session. No
pending work for these items.
