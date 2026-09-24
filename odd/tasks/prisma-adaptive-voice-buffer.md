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
   like the rest of the tab. Manual range proposed: 0.1–3.0 s, step 0.1 s, default 0.2 s
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
- [ ] **T1 — Measure the needed prebuffer per answer.** Pure function over (arrival ms, block
  duration) samples + engine wiring in `playProgressiveLive`/`schedulePcmBlock`
  (`hmi-app/src/services/prismaVoiceAudioEngine.ts`); new `playback-ended` fields via schema +
  generator + runtime validator. Tests: `prismaVoiceAudioEngine.test.ts`,
  `prismaAudioMetric.types.test.ts`, `test_voice_timeline_diagnostics.py`. Route: delegated writer
  (multi-file across `schemas/`, `hmi-app`, `services/prisma-runtime`).
- [ ] **T2 — Continuous estimator and browser history.** New pure module (window N=10, max +
  safety, clamp, 12 h staleness) and a safe `localStorage` wrapper. Fully deterministic tests
  with injected clock and storage. Route: delegated writer.
- [ ] **T3 — Feed the estimator into playback.** Engine takes the prebuffer per answer (per-answer
  `play()` option or a `resolvePrebufferSeconds` dependency, decided by the writer against the
  existing DI pattern) and reports the measurement back; wire in
  `hmi-app/src/hooks/usePrismaOrbPresentation.ts` using the configured mode. Remove the fixed
  `PRISMA_PCM_PLAYBACK_LEAD_SECONDS` role as the only source (keep 200 ms as the default).
  Route: delegated writer.
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

## Acceptance criteria

- Every progressive answer logs `prebuffer_ms`, `needed_prebuffer_ms` and `prebuffer_mode`.
- In Automatic, a measurement above the current value raises the prebuffer on the next answer;
  the value falls only after the high measurement leaves the 10-answer window; history older
  than 12 h is ignored; with no or unreadable history the prebuffer is 200 ms.
- In Manual, the configured seconds are used verbatim (within 0.1–3.0 s).
- Old stored voice configs load with `mode: 'automatic'` and no error on HMI or runtime.
- All hmi-app and prisma-runtime suites green; `tsc -b` and lint clean; live test without cuts.

## Open questions

- Delete the unused 2.5 s `buffer-before-playback` worklet transport, or keep it? (Not needed by
  this feature; user decision.)
- Manual range/default (0.1–3.0 s, 0.2 s) proposed above; confirm or adjust.

## Progress

- 2026-09-24: feature document created after a read-only mapping of the playback path, the Prisma
  tab/config, browser-storage conventions and the audio-record schema (delegated explorer).

- 2026-09-24: T0 done (PW-006 closed, fix integrated into local `main`).

## Next step

Create `feat/prisma-adaptive-voice-buffer` from `main` and start T1 (delegated writer, strict TDD).
