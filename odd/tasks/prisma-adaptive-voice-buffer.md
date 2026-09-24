# Prisma adaptive voice buffer — ODD feature document

> ODD feature task (not SDD). Created 2026-09-24. Supersedes the "Automatic" part of PW-006 T15
> (`odd/tasks/pw-006-prisma-responsiveness.md`). Engram mirror: `odd/prisma-adaptive-voice-buffer/tasks`
> (project `interfaz-laboratorio`).

## Objective

Voice answers in the HMI play without audible cuts on any machine and network, adding the smallest
start delay that the current conditions allow, instead of a fixed prebuffer tuned for one notebook.

## Problem and evidence

- PW-006 T22 (2026-09-24): with a 25 ms playback lead the timeline recorded `underflow_count=1` in
  2 of 4 answers and the user heard micro-cuts. Raising the lead to a fixed 200 ms
  (`c7efaf1`, `PRISMA_PCM_PLAYBACK_LEAD_SECONDS`) plus `latencyHint: 'playback'` removed them:
  5/5 answers with `underflow_count=0`, wall-clock playback equal to PCM duration within 20 ms,
  user heard all perfectly.
- The 200 ms value was measured on one notebook with an excellent connection. Chunk arrival
  jitter depends on the network, the machine and the time of day, so a fixed value either cuts
  elsewhere or adds needless delay here.
- The per-block resampling hypothesis was refuted (headless Chrome `OfflineAudioContext`, max seam
  error 0.0001), so the prebuffer is the right lever.

## Why

User decision (2026-09-24): the buffer must adjust itself continuously; a value learned once and
kept forever is not acceptable, because circumstances change. Learning from real answers was
chosen over a startup self-test (no extra Gemini calls, adapts during the day, no start delay).

## Design (agreed with the user 2026-09-24)

1. **Measurement per answer (every answer, not only failing ones).** In the progressive path,
   record for each PCM block its arrival time `a_i` and the cumulative audio duration before it
   `D_i`; with `t0` = arrival of the first block, the prebuffer that would have avoided every gap
   is `needed = max_i(a_i - t0 - D_i) + schedulingMargin`, clamped at 0. Single clock: the
   engine's injectable `now()` (wall clock, ms). Independent of the prebuffer actually used.
   A cached answer (all audio at once) measures ~0.
2. **Continuous estimator ("rises fast, falls slowly").** Keep the last N=10 measurements with
   timestamps. Next prebuffer = `clamp(max(window) + safety, min, max)`. A single demanding answer
   raises the value on the next answer; the value only falls once high measurements age out of
   the window. Constants (initial): safety 50 ms, min 100 ms, max 3,000 ms, default 200 ms
   (the T22 value). Measurements older than 12 h are discarded, so a machine that moved to
   another network restarts from the safe default instead of a stale learned value.
3. **Storage.** The learned window lives in the HMI browser (`localStorage`, key
   `hmi-prisma-voice-prebuffer-history`), because it describes that machine and its network.
   Every access wrapped in try/catch (pattern of `adminAuth.storage.ts` `SafeAdminStorage`);
   unavailable storage means "no history" → default value, never an error.
4. **Modes (General Settings → Prisma tab).** `Automático` (default) and `Manual` (seconds chosen
   by the user). Mode and manual value live in the shared Prisma voice configuration
   (HMI `domain/prismaVoiceConfig.ts` + runtime `voice_service.py` `validate_prisma_voice_config`),
   like the rest of the tab. Manual range **decided by the user (2026-09-24): 0.1–3.0 s, step 0.1 s, default 0.2 s**
   (revises T15's 0.3–3.0 s / default 1.0 s, since 0.2 s is now the proven baseline).
   Manual answers are still measured and logged, but do not change the manual value.
5. **Fixed, not adaptive:** `latencyHint: 'playback'` stays fixed — device-level underruns are not
   observable from the page, so there is no signal to adapt it.
6. **Observability.** `playback-ended` gains `prebuffer_ms` (used), `needed_prebuffer_ms`
   (measured) and `prebuffer_mode`, through the single schema source
   `schemas/prisma-audio-record.v1.schema.json` + `schemas/generate_prisma_audio_bindings.py`
   (regenerates `audio_record_types.py` and `prismaAudioMetric.generated.ts`), accepted by the
   runtime's closed validator (`voice_timeline_diagnostics.py` `validate_timeline_batch`).

## Scope and constraints

- In scope: progressive transport only (the one production uses:
  `prismaVoiceTtsAudioSource.ts` hard-codes `playbackTransport: 'progressive'`).
- Out of scope: the unused `buffer-before-playback` worklet transport (`prismaLocalAudioPlayback.ts`
  2.5 s policy, `PrismaPcmWorkletBuffer`, `playLocalWorklet`). Left untouched; whether to delete it
  is a separate user decision (open question below).
- Read-only HMI rule unaffected: this is playback configuration of the HMI itself.
- UI copy in Spanish, formal **usted**; tokens only, Lucide icons, `hmi-scrollbar`.
- Known caveat PW-004: Global Settings `Guardar` saves only the active tab; the new fields
  inherit that behavior, not fixed here.
- Existing persisted voice configs lack the new field: runtime and HMI must default it (the
  runtime validator checks an exact field set).

## TDD

- Mode: **strict TDD enabled** (source: session configuration "Strict TDD Mode: enabled").
  RED observed before each implementation, then GREEN, then REFACTOR.
- Runners: `cd hmi-app && npx vitest run` (plus `npx tsc -b`, `npm run lint`);
  `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s services\prisma-runtime -p "test_*.py"`.

## Delivery

- Branch: `feat/prisma-adaptive-voice-buffer`, created from `main` after T0.
- Forecast: ~1,200 authored changed lines (T1 ~250, T2 ~250, T3 ~200, T4 ~300, T5 ~200), above
  the ~400-line slice heuristic. Standing user decision: integrate into local `main` by
  fast-forward, no push/PRs; slice boundaries are recorded per task as work-unit commits.
- RDD: off (global), so no native review runs; ordinary checks apply.

## Tasks

- [x] **T0 — Close PW-006 first.** Mark PW-006 T22 done (live retest passed 2026-09-24 ~15:25),
  integrate `fix/prisma-voice-playback-buffer` (`c7efaf1`) into local `main` (user confirmation),
  close PW-006 in `docs/PENDING_WORK.md` and Engram, move the remaining optional items (T16
  follow-ups, minor logs) to backlog entries, register this feature in the index. Route: inline.
  Evidence (2026-09-24, user confirmed the integration): Engram `backlog/prisma-channel-a-responsiveness`
  updated to CLOSED; new `backlog/prisma-adaptive-voice-buffer` (PW-010, this feature) and
  `backlog/prisma-voice-minor-followups` (PW-011), verified with `mem_search`; PW-006 row removed
  from `docs/PENDING_WORK.md`; docs commit `docs: close PW-006 and open PW-010/PW-011` on the fix
  branch, then local `main` fast-forwarded to it (no push).
- [x] **T1 — Measure the needed prebuffer per answer.** Pure function over (arrival ms, block
  duration) samples + engine wiring in `playProgressiveLive`/`schedulePcmBlock`
  (`hmi-app/src/services/prismaVoiceAudioEngine.ts`); new `playback-ended` fields via schema +
  generator + runtime validator. Tests: `prismaVoiceAudioEngine.test.ts`,
  `prismaAudioMetric.types.test.ts`, `test_voice_timeline_diagnostics.py`. Route: delegated writer
  (multi-file across `schemas/`, `hmi-app`, `services/prisma-runtime`).

  **Evidence (2026-09-24, delegated writer, strict TDD):**
  - Files: new `hmi-app/src/services/prismaPrebufferNeedTracker.ts` (+ co-located
    `.test.ts`) with `PrismaPrebufferNeedTracker` and the named
    `PRISMA_PREBUFFER_SCHEDULING_MARGIN_MS` (25 ms) constant; wiring in
    `hmi-app/src/services/prismaVoiceAudioEngine.ts` (`ActivePlayback.prebufferNeedTracker`,
    new private `handleProgressiveBlock` shared by the streaming loop and the final
    flushed block, `completeLiveIfFinished`); schema
    `schemas/prisma-audio-record.v1.schema.json` (`playback-ended` gains optional
    `prebuffer_ms`, `needed_prebuffer_ms`, `prebuffer_mode` with enum
    `fixed | automatic | manual`, required-fields list unchanged); regenerated
    `hmi-app/src/domain/prismaAudioMetric.generated.ts` and
    `services/prisma-runtime/src/prisma_runtime/audio_record_types.py` via
    `schemas/generate_prisma_audio_bindings.py` (never hand-edited); tests extended in
    `prismaVoiceAudioEngine.test.ts`, `prismaAudioMetric.types.test.ts`,
    `test_voice_timeline_diagnostics.py`.
  - Design decisions: arrival `a_i` captured with `this.now()` inside the new
    `handleProgressiveBlock` helper, at the moment each block becomes available
    (before scheduling), reused for both the tracker and the first-audio elapsed
    log (one clock read per block, not two). `needed = max(0, max_i(a_i - t0 - D_i)
    + margin)`, rounded with `Math.round`; the tracker's running max starts at 0,
    which is always correct because the first block's own term is exactly 0 by
    construction. `neededPrebufferMs()` returns 0 if no block was ever recorded
    (defensive; never hit in practice). `prebuffer_ms` reports the lead actually
    used (`PRISMA_PCM_PLAYBACK_LEAD_SECONDS * 1000`, unchanged at 200 ms) and
    `prebuffer_mode` is always the literal `'fixed'` for this task. Non-progressive
    handling: the `buffer-before-playback` worklet transport (out of scope, D5)
    cannot measure per-block arrival, so its `playback-ended` simply omits the
    three fields rather than reporting a fabricated value; they are optional (not
    in `x-required-payload-fields`) in the schema for exactly this reason, locked
    in by a dedicated test asserting the fields are absent there.
  - RED evidence: `prismaPrebufferNeedTracker.test.ts` — `Failed to resolve import
    "./prismaPrebufferNeedTracker" ... Does the file exist?` before the module
    existed. `prismaVoiceAudioEngine.test.ts` — both the extended underflow test and
    the new "measures the needed prebuffer..." test failed with `expected {
    record_type: 'playback-ended', …(7) } to match object { …(1) }` (missing
    `prebuffer_ms`/`needed_prebuffer_ms`/`prebuffer_mode`) before the engine wiring.
    `prismaAudioMetric.types.test.ts` — new round-trip test failed with `Prisma
    audio metric violates the browser allowlist` before the schema/generator update.
    `test_voice_timeline_diagnostics.py` — new
    `test_accepts_a_progressive_playback_ended_record_with_t1_prebuffer_fields`
    raised `ValueError: VOICE_TIMELINE_RECORD_INVALID` before the schema/generator
    update. All four RED failures observed by running the exact target suites, then
    GREEN after each implementation step.
  - Checks (repo root unless noted): `cd hmi-app && npx vitest run` → 220 files /
    2476 tests passed (baseline 219/2467 + 9 new: 6 tracker + 1 engine + 2 domain
    type). `cd hmi-app && npx tsc -b` → clean, no output. `cd hmi-app && npm run
    lint` → clean, no findings. `services/prisma-runtime/.venv/Scripts/python.exe -m
    unittest discover -s services/prisma-runtime -p "test_*.py"` → 1522 tests OK
    (baseline 1519 + 3 new), including the pre-existing
    `test_audio_bindings_generation.py` drift checker confirming the regenerated
    projections match the schema exactly.
  - Commits (branch `feat/prisma-adaptive-voice-buffer`, GGA review passed on each):
    `a2e6a33` feat(hmi): measure the needed voice prebuffer per progressive answer;
    `bc2b911` refactor(hmi): dedupe the progressive prebuffer block handling;
    `15e72d8` refactor(hmi): reuse the captured block-arrival clock reading (both
    refactor commits address GGA review nits from the feat commit: comment
    direction/wording, block-handling duplication, redundant clock read).
  - Route: delegated writer (confirmed; touched `schemas/`, `hmi-app/src/domain/`,
    `hmi-app/src/services/`, `services/prisma-runtime/src/` and
    `services/prisma-runtime/tests/`).
- [x] **T2 — Continuous estimator and browser history.** New pure module (window N=10, max +
  safety, clamp, 12 h staleness) and a safe `localStorage` wrapper. Fully deterministic tests
  with injected clock and storage. Route: delegated writer.

  **Evidence (2026-09-24, delegated writer, strict TDD):**
  - Files: domain `hmi-app/src/domain/prismaVoicePrebufferHistory.types.ts` (+ `.test.ts`) —
    `PrismaVoicePrebufferMeasurement` / `PrismaVoicePrebufferHistory` and the strict shape guard
    `isPrismaVoicePrebufferMeasurement`; service `hmi-app/src/services/prismaVoicePrebufferEstimator.ts`
    (+ `.test.ts`) — pure `estimateNextPrismaVoicePrebufferMs(history, nowMs)` and
    `appendPrismaVoicePrebufferMeasurement(history, measurement)`, with the six named constants
    (`PRISMA_PREBUFFER_HISTORY_WINDOW_SIZE=10`, `PRISMA_PREBUFFER_HISTORY_MAX_AGE_MS=12h`,
    `PRISMA_PREBUFFER_ESTIMATE_SAFETY_MS=50`, `_MIN_MS=100`, `_MAX_MS=3000`, `_DEFAULT_MS=200`)
    all in this one module; service `hmi-app/src/services/prismaVoicePrebufferHistoryStorage.ts`
    (+ `.test.ts`) — `PrismaVoicePrebufferHistoryStorage` class under key
    `hmi-prisma-voice-prebuffer-history`, `SafeAdminStorage`-style (injectable
    `Storage | (() => Storage) | null`, every access try/catch, `createBrowser...()` factory);
    service `hmi-app/src/services/prismaVoicePrebufferController.ts` (+ `.test.ts`) — the optional
    facade (built, since it keeps T3 simple), `getNextPrebufferMs()` / `recordMeasurement(ms)`,
    combining the estimator and storage with an injectable clock (defaults to `Date.now`).
  - Design decisions (public API T3 should call): `PrismaVoicePrebufferController` (or the
    lower-level `estimateNextPrismaVoicePrebufferMs`/`appendPrismaVoicePrebufferMeasurement` +
    `PrismaVoicePrebufferHistoryStorage` directly, if T3's DI pattern needs finer control).
    Estimator defensively re-applies both the 12h staleness filter and the last-10 cap on read
    (not just on append), so a raw/unpruned history is still handled correctly. Storage: a
    non-array or unparseable top-level payload is treated as fully corrupted (empty history);
    within a valid array, individual invalid entries are dropped rather than discarding the whole
    read — a single malformed entry (future schema change, manual tampering) should not throw away
    otherwise-valid recent measurements next to it. GGA review (passed) flagged one minor,
    non-blocking note: a measurement timestamped in the future (system clock moved backwards)
    reads as "fresh"; impact is bounded because the result is still clamped to
    `PRISMA_PREBUFFER_ESTIMATE_MAX_MS`. Left as-is (no reported case of this happening; T3/T6 will
    surface it live if it ever matters).
  - RED evidence: `prismaVoicePrebufferHistory.types.test.ts`,
    `prismaVoicePrebufferEstimator.test.ts`, `prismaVoicePrebufferHistoryStorage.test.ts` and
    `prismaVoicePrebufferController.test.ts` each failed first with
    `Failed to resolve import "./<module>" ... Does the file exist?` (module not yet created),
    run individually via `npx vitest run <file>`, before each module was implemented and the same
    run turned GREEN (8, 13, 10, 5 tests respectively).
  - Checks: `cd hmi-app && npx vitest run` → 224 files / 2512 tests passed (baseline 220/2476 + 36
    new: 8 domain + 13 estimator + 10 storage + 5 controller). `cd hmi-app && npx tsc -b` → clean,
    no output. `cd hmi-app && npm run lint` → clean, no findings.
  - Commits (branch `feat/prisma-adaptive-voice-buffer`, GGA review passed): `013795f` feat(hmi):
    add the continuous prebuffer estimator and its browser history.
  - Route: delegated writer (confirmed; 8 new files across `hmi-app/src/domain/` and
    `hmi-app/src/services/`).
- [x] **T3 — Feed the estimator into playback.** Engine takes the prebuffer per answer (per-answer
  `play()` option or a `resolvePrebufferSeconds` dependency, decided by the writer against the
  existing DI pattern) and reports the measurement back; wire in
  `hmi-app/src/hooks/usePrismaOrbPresentation.ts` using the configured mode. Remove the fixed
  `PRISMA_PCM_PLAYBACK_LEAD_SECONDS` role as the only source (keep 200 ms as the default).
  Route: delegated writer.

  **Evidence (2026-09-24, delegated writer, strict TDD):**
  - Files: `hmi-app/src/services/prismaVoiceAudioEngine.ts` (+ `.test.ts`) — new exported
    `PrismaVoicePrebufferMode` (`Exclude<PrismaAudioMetricPrebufferMode, 'fixed'>`),
    `PrismaVoicePrebufferResolution` and `PrismaVoicePrebufferPolicy` types; new optional
    `prebufferPolicy` engine dependency; `ActivePlayback.prebufferMs`/`prebufferMode` snapshotted
    once in `play()`; `schedulePcmBlock` uses `active.prebufferMs / 1_000` as the lead instead of
    the module constant; `completeLiveIfFinished` calls
    `this.prebufferPolicy?.recordNeededPrebufferMs(neededPrebufferMs)` and reports
    `active.prebufferMs`/`active.prebufferMode` on `playback-ended`. Renamed the module constant
    to `PRISMA_PCM_PLAYBACK_LEAD_MS`, now sourced from `PRISMA_PREBUFFER_ESTIMATE_DEFAULT_MS`
    (single source of truth with the T2 estimator's no-history default, both 200 ms) instead of a
    second, independent `0.2` literal. `hmi-app/src/domain/prismaAudioMetric.types.ts` — added the
    missing re-export of `PrismaAudioMetricPrebufferMode` (schema/generator already supported the
    `automatic`/`manual` enum values since T1; this task only needed the type, no schema/generator
    change). `hmi-app/src/services/prismaVoicePrebufferController.ts` (+ `.test.ts`) — new
    `createPrismaVoiceAutomaticPrebufferPolicy(controller)` (adapts the T2 controller to the
    engine's policy interface, always resolving/reporting `mode: 'automatic'`) and
    `createBrowserPrismaVoiceAutomaticPrebufferPolicy()` (one-call production factory).
    `hmi-app/src/hooks/usePrismaOrbPresentation.ts` (+ `.test.ts`) — the production engine is now
    built with `new PrismaVoiceAudioEngine({ prebufferPolicy:
    createBrowserPrismaVoiceAutomaticPrebufferPolicy() })` when no `options.engine` is injected.
  - Design decisions: injection point is a **constructor-level (per-hook-lifetime) dependency**,
    matching every other `PrismaVoiceAudioEngineDependencies` entry (`now`, `log`, `onDiagnostic`,
    `levelPolicy`, ...) rather than a per-`play()` option — the engine is already a long-lived
    singleton across answers in `usePrismaOrbPresentation.ts` (`engineRef.current`), so this is
    the existing DI pattern, not a new one. `resolvePrebufferMs()` is called exactly once per
    answer at `play()` time and the result is snapshotted onto `ActivePlayback` (no mid-answer
    re-reads), satisfying Design item 1. Record rule: `recordNeededPrebufferMs()` is called from
    exactly one call site, `completeLiveIfFinished()`, which only ever runs when
    `active.streamCompleted && active.sourceNodes.size === 0` for a *current* (non-superseded)
    playback — i.e. only on true normal completion of a progressive answer; a stopped/cancelled
    answer goes through `cleanupActive('cancel', ...)`, an errored one through
    `cleanupActive('error', ...)`/`failActive`, and the buffer-before-playback transport never
    reaches this function at all (its own completion path is `handleLocalWorkletEnded`). No
    engine-side `mode` branching was added: the engine always resolves once and records once
    per completed answer regardless of what `mode` the injected policy reports, so a Manual-mode
    policy (T4) can still receive the call ("still measured and logged", per Design item 4) and
    decide internally whether to feed it back into the shared history, without touching the engine.
    Constant consolidation: `PRISMA_PCM_PLAYBACK_LEAD_SECONDS` (0.2, unexported, no external
    consumers) was replaced by `PRISMA_PCM_PLAYBACK_LEAD_MS`, importing
    `PRISMA_PREBUFFER_ESTIMATE_DEFAULT_MS` from `prismaVoicePrebufferEstimator.ts` — this is a
    pure-constant, one-directional dependency (engine -> estimator; no cycle, since the controller
    depends on the engine only via a type-only import for the policy interface).
  - T4 hook: mode selection lives entirely in *which policy object* `usePrismaOrbPresentation.ts`
    constructs and injects (e.g. a Manual policy resolving the configured seconds with
    `mode: 'manual'`); the engine's dependency shape, snapshot timing and record call site do not
    change.
  - RED evidence: `prismaVoiceAudioEngine.test.ts` — the three new "T3: per-answer prebuffer
    policy" positive tests failed first (`expected "vi.fn()" to be called with arguments: [ 1.5 ]`
    received `[ 1.2 ]`; `resolvePrebufferMs`/`recordNeededPrebufferMs` called 0 times) before the
    engine wiring, run via `npx vitest run src/services/prismaVoiceAudioEngine.test.ts -t "T3"`.
    `prismaVoicePrebufferController.test.ts` — the three new `createPrismaVoiceAutomaticPrebufferPolicy`
    tests failed with `TypeError: createPrismaVoiceAutomaticPrebufferPolicy is not a function`
    before the adapter existed. `usePrismaOrbPresentation.test.ts` — the new "builds the production
    engine..." test failed with `expected "vi.fn()" to be called 1 times, but got 0 times` (the
    mocked `createBrowserPrismaVoiceAutomaticPrebufferPolicy` factory) before the hook wiring, with
    all 20 pre-existing tests in the file still green throughout (every other test injects its own
    `engine`, so the real construction path is only exercised by this one test). Two negative tests
    (never record on stop; never record on WAV-fallback failure) were added as regression guards
    but do not RED before the change, since the unused dependency trivially satisfies "not called"
    before wiring -- noted honestly rather than claimed as driving RED.
  - Checks: `cd hmi-app && npx vitest run` -> 224 files / 2521 tests passed (baseline 224/2512 + 9
    new: 5 engine + 3 controller + 1 hook). `cd hmi-app && npx tsc -b` -> clean, no output.
    `cd hmi-app && npm run lint` -> clean, no findings.
  - Commits (branch `feat/prisma-adaptive-voice-buffer`, GGA review passed): `b94c2fd` feat(hmi):
    feed the adaptive prebuffer estimator into progressive playback.
  - Route: delegated writer (confirmed; touched `hmi-app/src/domain/`, `hmi-app/src/hooks/` and
    `hmi-app/src/services/` across 4 non-trivial source files plus their tests).
- [ ] **T4 — Configuration field.** `playbackBuffer: { mode: 'automatic' | 'manual',
  manualSeconds }` in the Prisma voice config: HMI domain types/validation/defaults, runtime
  defaults/validation/persistence, backward-compatible defaulting of stored configs. Tests:
  `test_voice_service.py`, `usePrismaVoiceConfig*.test.tsx`, `usePrismaVoiceConfigDraft.test.ts`.
  Route: delegated writer.
- [ ] **T5 — Prisma tab controls.** In `hmi-app/src/components/admin/VoiceSettingsTab.tsx`:
  "Buffer de audio" with `Automático`/`Manual`; manual seconds control shown only in Manual.
  Copy (usted) drafted by the writer and confirmed with the user before commit. Follow the
  `widget-property-panel`/admin conventions where they apply. Tests: `VoiceSettingsTab.test.tsx`,
  `GlobalSettingsDialog.voice.integration.test.tsx`; visual check in a real browser. Route:
  delegated writer.
- [ ] **T6 — Live verification (user).** Several voice answers in Automatic: `playback-ended`
  shows `needed_prebuffer_ms` per answer and `prebuffer_ms` following it; no audible cuts; a
  Manual run confirms the fixed value is used. Parent reads the `HMI voice timeline:` lines in
  `%LOCALAPPDATA%\CoreAnalytics\Prisma\logs\prisma-presentation-stderr.log`.

- [ ] **T7 — Delete the unused 2.5 s `buffer-before-playback` transport (user decision 2026-09-24).**
  Only after T6 passes, so a fallback exists until the adaptive prebuffer is proven live. Remove
  `prismaLocalAudioPlayback.ts` (2.5 s policy), `PrismaPcmWorkletBuffer`, `playLocalWorklet`, the PCM
  audio worklet and the local worklet context, plus their tests; the `playback-ended` optional-field
  handling for that transport goes with it. Route: delegated writer.

## Acceptance criteria

- Every progressive answer logs `prebuffer_ms`, `needed_prebuffer_ms` and `prebuffer_mode`.
- In Automatic, a measurement above the current value raises the prebuffer on the next answer;
  the value falls only after the high measurement leaves the 10-answer window; history older
  than 12 h is ignored; with no or unreadable history the prebuffer is 200 ms.
- In Manual, the configured seconds are used verbatim (within 0.1–3.0 s).
- Old stored voice configs load with `mode: 'automatic'` and no error on HMI or runtime.
- All hmi-app and prisma-runtime suites green; `tsc -b` and lint clean; live test without cuts.

## Open questions

None. (Legacy transport: delete after T6, see T7. Manual range: decided, see Design item 4.)

## Progress

- 2026-09-24: feature document created after a read-only mapping of the playback path, the Prisma
  tab/config, browser-storage conventions and the audio-record schema (delegated explorer).

- 2026-09-24: T0 done (PW-006 closed, fix integrated into local `main`).

- 2026-09-24: T1 done (delegated writer, strict TDD; RED observed for the pure tracker, the
  engine wiring and both the HMI and runtime schema-projection tests before each GREEN). Every
  progressive `playback-ended` now carries `prebuffer_ms`, `needed_prebuffer_ms` and
  `prebuffer_mode: 'fixed'`; the non-progressive worklet transport omits the (schema-optional)
  fields. hmi-app (220 files / 2476 tests), `tsc -b`, lint and prisma-runtime (1522 tests) all
  green. Three commits on `feat/prisma-adaptive-voice-buffer`: `a2e6a33`, `bc2b911`, `15e72d8`.

- 2026-09-24: T2 done (delegated writer, strict TDD; RED observed for each of the four new
  modules before its GREEN). New pure continuous estimator
  (`prismaVoicePrebufferEstimator.ts`), safe `localStorage` history
  (`prismaVoicePrebufferHistoryStorage.ts`, key `hmi-prisma-voice-prebuffer-history`) and an
  optional facade (`prismaVoicePrebufferController.ts`) with domain types
  (`domain/prismaVoicePrebufferHistory.types.ts`) — not yet wired into playback. hmi-app (224
  files / 2512 tests), `tsc -b` and lint all green. One commit on
  `feat/prisma-adaptive-voice-buffer`: `013795f` (GGA review passed).

- 2026-09-24: T3 done (delegated writer, strict TDD; RED observed for the engine wiring, the new
  automatic-policy adapter and the hook wiring before each GREEN). Progressive playback now takes
  its prebuffer from an optional `prebufferPolicy` engine dependency, snapshotted once per answer;
  `usePrismaOrbPresentation.ts` wires a browser-backed Automatic policy in production, so every
  production progressive answer now reports `prebuffer_mode: 'automatic'` and feeds its measured
  `needed_prebuffer_ms` back to the T2 estimator on normal completion. `PRISMA_PCM_PLAYBACK_LEAD_MS`
  (fallback default, 200 ms) is now sourced from the same `PRISMA_PREBUFFER_ESTIMATE_DEFAULT_MS`
  constant as the estimator, removing the duplicate literal. hmi-app (224 files / 2521 tests),
  `tsc -b` and lint all green. One commit on `feat/prisma-adaptive-voice-buffer`: `b94c2fd` (GGA
  review passed).

## Next step

Start T4 (configuration field: `playbackBuffer: { mode: 'automatic' | 'manual', manualSeconds }`
in the Prisma voice config, HMI + runtime; delegated writer, strict TDD).
