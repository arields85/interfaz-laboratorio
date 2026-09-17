Repository-relative file: odd/tasks/prisma-unified-browser-runtime.md

# Prisma unified browser routing and legacy selector retirement

## Status

UNI-1, UNI-2, and UNI-3 are complete offline after a corrected independent `PASS` and parent approval. The first independent UNI-3 review returned `PARTIAL`: it confirmed the routing and telemetry boundaries but found retained-behavior coverage gaps and a timing-sensitive Dashboard assertion. One bounded correction pass restored that coverage, stabilized the assertion, and reconciled active documentation; the independent recheck then passed. No live Vite server, backend, browser, provider, proxy deployment, network probe, installer, credential, external legacy state, or production system was executed or changed by this increment.

This is a new feature increment. The completed `FND-1`–`FND-11` history remains closed and authoritative in [`odd/tasks/prisma-runtime-foundations.md`](./prisma-runtime-foundations.md); this plan neither overwrites nor reopens it.

## Objective, problem, and why

Make the browser consume one Prisma runtime through fixed same-origin routes and retire the obsolete Server/Local selector and editable Prisma endpoint plumbing. The current split allows visitor-loopback addresses, persisted mode/query overrides, arbitrary assistant endpoints, two snapshot exporters, and mode-dependent response/audio behavior to reach browser code. That conflicts with the production requirement that Prisma live on the IT server and with a single stable browser contract.

The browser must know only same-origin routes. Development forwarding belongs to Vite server configuration; production forwarding belongs to the future IT deployment boundary. Node-RED may remain the industrial telemetry source, but it is no longer a browser-selectable Prisma runtime.

## Authorized contract

| Browser route | Development target | Upstream path | Method/behavior |
|---|---|---|---|
| `/api/prisma/snapshot` | `http://127.0.0.1:5057` | `/hmi/current-snapshot` | `POST` current valid dashboard frame |
| `/api/prisma/events/latest` | `http://127.0.0.1:5057` | `/hmi/voice/latest` | `GET` polling |
| `/api/prisma/voice-config` | `http://127.0.0.1:5057` | `/hmi/prisma-config` | `GET`/`PUT` runtime envelope |
| `/api/prisma/tts/live` | `http://127.0.0.1:5056` | `/prisma/speak-live` | `POST` progressive PCM stream with response headers preserved |

Vite uses fixed `^` regular-expression proxy entries that match only each exact pathname, optionally followed by a query. Rewrites replace only the matched pathname prefix, preserve the encoded query bytes, and reject suffixes, extra slashes, encoded-path lookalikes, and unrelated `/api/prisma/*` paths. The proxy does not broaden Vite host or CORS settings.

Browser endpoint constants remain pure and same-origin. Loopback targets and rewrite helpers remain server-only and cannot be imported by browser modules. Production documentation specifies equivalent exact-route forwarding on the IT host without choosing nginx, a cloud product, an OS supervisor, or a remote deployment mechanism.

## Constraints and non-goals

- The HMI remains observational. Prisma voice-effect configuration is HMI configuration, not industrial process control; industrial telemetry base, overview, history, and activity-series contracts remain unchanged.
- Delete the retired runtime mode system instead of aliasing `central` to `local`: no mode type, profile hook, event/revision, selector, URL override, or `PRISMA LOCAL` indicator remains.
- Existing `hmi:prisma-runtime-mode`, `?prismaMode=local`, assistant endpoint, snapshot-export, and TTS URL values become inert. Do not migrate them to another mode, consume them, or globally clear browser storage. Preserve unrelated stored data, visual effects, orb settings, and their events.
- Remove only assistant-specific exports and controls from `dataConnection.config.ts` and `ConnectionSettingsTab.tsx`. Keep Node-RED telemetry URL, snapshot/overview endpoint, history, and activity-series settings and tests.
- Snapshot, events, voice config, and live TTS always use the canonical same-origin routes. There is one frame-ready snapshot exporter with no central opt-in or parallel schedule.
- Preserve snapshot valid-frame readiness, one-request-at-a-time behavior, timeout/cancellation, event polling dedupe/cancellation, voice-config save generation/cancellation/read-after-write/rebase behavior, and progressive PCM validation/streaming.
- Keep tolerant voice-event domain behavior. Do not make `id` mandatory or cascade unrelated fixture/schema changes merely because the mode branch disappears.
- Do not redesign the audio engine, Prisma schema, provider integration, TTS internals unrelated to routing, runtime process ownership, or completed startup orchestration.
- This is not authentication work. Do not claim protected access, secret storage, production hardening, or live acceptance.
- Do not touch `Directrices/`, external `C:\hmi_tts`, backups, archived OpenSpec/history, completed runtime operations code, providers, credentials, `.env`, or real machine/runtime state.
- Preserve the existing dirty FND implementation and documentation files exactly except for later independently authorized reconciliation that is explicitly in this feature's scope. No cleanup, install, commit, staging, or push is part of these tasks.
- TDD is ON for service/config/adapter logic and regressions under `AGENTS.md` section 8 and `docs/TESTING.md` lines 65–74. Write failing behavior tests before source changes; do not remove meaningful effect, save, telemetry, or presentation tests to reduce the diff.
- About 400 authored changed lines per task is an advisory review budget, not a gate. The cohesive routing retirement may exceed it; explain the breadth rather than code-golfing or creating artificial file-type splits.

## Implemented boundary

### New

- `hmi-app/vite.prismaProxy.config.ts` — server-only exact-route proxy targets and rewrite helpers.
- `hmi-app/vite.prismaProxy.config.test.ts` — Node-environment tests for exact matching, rewrites, encoded queries, lookalike rejection, targets, and streaming-safe proxy options.
- `docs/prisma/PRISMA_BROWSER_ROUTING.md` — subordinate route map, development/production ownership, streaming requirement, SPA exclusion, and security non-claims.

### Delete

- `hmi-app/src/config/prismaRuntime.config.ts`
- `hmi-app/src/config/prismaRuntime.config.test.ts`
- `hmi-app/src/domain/prismaRuntime.types.ts`
- `hmi-app/src/hooks/usePrismaRuntimeProfile.ts`
- `hmi-app/src/hooks/usePrismaRuntimeProfile.test.ts`
- `hmi-app/src/config/prismaVoiceTts.config.ts`
- `hmi-app/src/config/prismaVoiceTts.config.test.ts`

### Modify

- `hmi-app/vite.config.ts` — install the server-only proxy table without startup side effects.
- `hmi-app/src/config/prismaAssistant.config.ts` and `.test.ts` — expose only the four fixed same-origin browser routes; no loopback, mode, arbitrary URL, or fallback resolver.
- `hmi-app/src/domain/index.ts` — remove the retired runtime type export.
- `hmi-app/src/config/dataConnection.config.ts` and `.test.ts` — remove voice/config/snapshot-export storage and URL APIs while preserving all industrial telemetry APIs.
- `hmi-app/src/adapters/prismaVoiceConfig.adapter.ts` and `.test.ts` — accept the runtime envelope as the sole response contract while preserving validation and ambiguous-write confirmation.
- `hmi-app/src/queries/usePrismaVoiceConfig.ts`, `usePrismaVoiceConfig.test.tsx`, `useUpdatePrismaVoiceConfig.ts`, and `useUpdatePrismaVoiceConfig.test.tsx` — use the fixed route and envelope; remove profile revision effects and caller URLs while retaining cancellation, generation, cache, and read-after-write semantics.
- `hmi-app/src/services/voiceEventListener.service.ts` and `.test.ts` — remove only mode-specific validation; keep tolerant payload normalization, first-frame silence, dedupe, single active poller, abort, and nonfatal failures.
- `hmi-app/src/hooks/useVoiceEventListener.ts` and `.test.ts` — always poll the canonical route; remove Node-RED/runtime revision listeners.
- `hmi-app/src/services/dashboardSnapshotExport.service.ts` and `.test.ts` — collapse central/local exporters into one canonical exporter while preserving single-flight, timeout, cancellation, and failure isolation.
- `hmi-app/src/pages/Dashboard.tsx`, `Dashboard.test.tsx`, `Dashboard.runtime.integration.test.tsx`, and `Dashboard.presentation.test.tsx` — always run one valid-presentation-frame exporter and replace mode-switch assertions with canonical-route/no-double-export regressions.
- `hmi-app/src/pages/Dashboard.activityAnalyticsPersistence.test.tsx` — direct Dashboard test mock discovered by RED: remove only retired snapshot-setting exports so the retained activity-analytics persistence scenarios continue exercising the unified Dashboard.
- `hmi-app/src/services/prismaVoiceTtsAudioSource.ts` and `.test.ts` — bind live progressive PCM to the canonical route and preserve request body, cancellation, stream, and header validation; retire configurable URL and legacy route fallback selection.
- `hmi-app/src/hooks/usePrismaOrbPresentation.ts` and `.test.ts` — remove mode/profile reset branches and always request progressive canonical TTS while preserving generation cancellation and fade/error behavior.
- `hmi-app/src/components/PrismaOrbOverlay.test.tsx` — remove retired mode setup while retaining meaningful generic presentation lifecycle coverage.
- `hmi-app/src/components/admin/VoiceSettingsTab.tsx`, `VoiceSettingsTab.test.tsx`, and `GlobalSettingsDialog.voice.integration.test.tsx` — remove the selector and three endpoint fields but preserve effect loading/editing, orb preview/settings, validation, shared Save state, error handling, concurrent edit rebase, and exact-one-PUT behavior.
- `hmi-app/src/components/admin/PrismaVoiceEffectsSettings.tsx` — direct validation dependency discovered during retained invalid-save regression: publish advanced-field validity synchronously so an immediate shared Save cannot race the validation effect.
- `hmi-app/src/components/admin/ConnectionSettingsTab.tsx` and `.test.tsx` — remove only legacy Prisma snapshot-export controls; preserve telemetry controls and invalidations.
- `hmi-app/src/components/layout/Topbar.tsx` and `.test.tsx` — remove the obsolete local indicator and only its assertions/imports.

This list is implementation-authoritative unless a failing test proves an additional direct reference. Any newly discovered path must be reported before broadening scope.

## Tasks

- [x] **UNI-1 — Establish the unified endpoint, proxy, and service contract with TDD.**
  - Start RED tests for the pure browser route constants and server-only Vite proxy: exact route plus optional query matches; encoded query text survives rewrite; suffix, slash, and encoded-path lookalikes do not match; the 5056/5057 targets never appear in browser-importable modules; `changeOrigin`/rewrite preserve upstream behavior without host/CORS broadening.
  - Wire `vite.config.ts` to the tested server-only proxy table. Keep Vite transforms/SPA fallback outside matched API routes and preserve streaming response headers/body behavior.
  - Convert voice config GET/PUT to the fixed `/api/prisma/voice-config` runtime-envelope contract, retaining abort, generation, cache-key consistency, response validation, read-after-write confirmation, and stale-write rejection.
  - Route events, snapshots, and TTS through their fixed browser constants. Collapse snapshot scheduling to one frame-ready exporter and retain single-flight/timeout/cancel behavior. Keep event payload tolerance/dedupe and live PCM request/header/stream behavior.
  - Acceptance: browser fetch assertions contain only the four same-origin routes; arbitrary or visitor-loopback Prisma destinations are impossible through public APIs; exactly one snapshot schedule exists; event polling and TTS remain nonfatal and cancellable; no industrial telemetry path changes.
  - Review forecast: likely above 400 authored lines because tests and four cohesive service paths move together. Do not split browser constants from the consumers that prove them.

- [x] **UNI-2 — Retire the selector and legacy plumbing without collateral data loss.**
  - Start RED component/integration regressions proving the runtime selector, three editable endpoint fields, Prisma snapshot-export controls, and `PRISMA LOCAL` indicator are absent while effects, orb controls/preview, shared Save, telemetry fields, and meaningful lifecycle behavior remain.
  - Delete runtime config/types/hook and their dead tests/imports. Remove mode/query/revision branching from dashboard, queries, event listener, orb presentation, and layout.
  - Remove assistant-only storage/export helpers from `dataConnection.config.ts` and the obsolete configurable TTS module. Do not clear or migrate legacy keys; test that pre-existing legacy values and unrelated stored settings remain untouched and cannot influence requests. Leave `prismaMode` query text inert rather than mutating navigation.
  - Simplify `VoiceSettingsTab` to one fixed Prisma config source. Preserve effect initialization, invalid-config blocking, dirty/saving/saved/error transitions, concurrent-edit rebase, orb visual persistence, and one PUT per Save.
  - Acceptance: no source reference remains to runtime mode/profile symbols, retired endpoint storage APIs, editable assistant endpoints, or local indicator copy; old values cannot alter routing; telemetry overview/history/activity settings and tests remain; no meaningful save/effect/audio test is deleted merely to shrink the diff.
  - Review forecast: likely above 400 authored lines due to removal plus regression rewrites across existing integration tests. Keep this as one retirement work unit so no intermediate selector points at a deleted mode system.

- [x] **UNI-3 — Verify independently and reconcile browser-routing documentation.**
  - Run focused tests first, then the full HMI suite, both TypeScript projects, production build, lint, `git diff --check`, and scoped diff/status readback. Do not execute `npm run dev`, Vite server, Prisma services, providers, runtime launchers, installers, network probes, or real production forwarding.
  - Add `docs/prisma/PRISMA_BROWSER_ROUTING.md` as the only subordinate routing guide. Document exact browser/upstream paths, methods, development versus production ownership, encoded-query preservation, exact-match/SPA exclusions, progressive TTS streaming/headers, and the absence of auth/secret/deployment claims.
  - Reconcile only directly stale references found in the existing Prisma master/index after implementation evidence exists. Preserve FND completion/history and all prior proof chronology; do not restate the full foundation ledger here.
  - Acceptance: independent readback confirms the source boundary, deletion list, route contract, untouched telemetry/runtime foundations, test evidence, documentation accuracy, and complete Engram mirror before closure.
  - Review forecast: below 400 authored lines unless existing documentation contains broader stale selector guidance; report rather than silently expanding.
  - Result: corrected independent verification passed offline and the parent approved closure. Live runtime, browser, provider, and production forwarding acceptance remain outside this result.

## Exact verification commands

Run from `hmi-app` unless stated otherwise:

```powershell
npm.cmd run test -- vite.prismaProxy.config.test.ts src/config/prismaAssistant.config.test.ts src/config/dataConnection.config.test.ts src/adapters/prismaVoiceConfig.adapter.test.ts src/queries/usePrismaVoiceConfig.test.tsx src/queries/useUpdatePrismaVoiceConfig.test.tsx src/services/voiceEventListener.service.test.ts src/hooks/useVoiceEventListener.test.ts src/services/dashboardSnapshotExport.service.test.ts src/pages/Dashboard.test.tsx src/pages/Dashboard.runtime.integration.test.tsx src/pages/Dashboard.presentation.test.tsx src/services/prismaVoiceTtsAudioSource.test.ts src/hooks/usePrismaOrbPresentation.test.ts src/components/PrismaOrbOverlay.test.tsx src/components/admin/VoiceSettingsTab.test.tsx src/components/admin/GlobalSettingsDialog.voice.integration.test.tsx src/components/admin/ConnectionSettingsTab.test.tsx src/components/layout/Topbar.test.tsx
npm.cmd run test
.\node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit --incremental false
.\node_modules\.bin\tsc.cmd -p tsconfig.node.json --noEmit --incremental false
npm.cmd run build
npm.cmd run lint
```

From the repository root after the non-runtime checks:

```powershell
git diff --check
git status --short
git diff --stat
```

The unchanged Python baseline remains the completed historical `107/107` result in the foundation record. This browser-only feature does not modify Python, PowerShell, operations, schema, or runtime services, so Python discovery is intentionally not rerun; do not present `107/107` as fresh UNI evidence. If implementation unexpectedly touches any such path, stop and re-plan before verification.

## Writer verification evidence

Recorded on 2026-09-17. This is implementation-writer evidence, not the independent UNI-3 verdict.

- Focused browser-routing suite: `19` files and `129` tests passed.
- Full HMI suite: `197` files and `1818` tests passed. Existing jsdom canvas diagnostics remained non-fatal.
- `tsconfig.app.json` and `tsconfig.node.json`: passed with `--noEmit --incremental false`.
- Production build: passed; existing unresolved `/grid.svg` and large-chunk warnings remained non-fatal.
- ESLint: passed with zero findings.
- `git diff --check`: passed; Git reported only existing LF-to-CRLF working-copy warnings.
- `docs/prisma/PRISMA_BROWSER_ROUTING.md`: added as the subordinate browser/forwarding contract.
- Python/PowerShell/runtime/provider checks were intentionally not executed; the historical `107/107` foundation result is not claimed as fresh evidence.

## Bounded correction evidence after independent PARTIAL

Recorded on 2026-09-17. This is the bounded correction writer evidence that preceded the independent recheck.

- Independent finding `#5367` reported no confirmed functional routing defect. It identified retained-behavior coverage gaps and a timing-sensitive Dashboard exporter assertion.
- Restored regressions cover immediate invalid advanced edits, invalid edits while a PUT is pending, preview-only controls, auto-demo cadence and cleanup, manual speaking with auto-demo disabled, duplicate Save suppression, close/discard reset, scheduled snapshot timeout recovery, orb playback-error cleanup, and overlay failure/reduced-motion/geometry/live visual updates.
- `Dashboard.test.tsx` now waits for the exporter effect instead of relying on viewer DOM timing.
- The accepted implementation boundary includes `PrismaVoiceEffectsSettings.tsx`, where synchronous validity publication prevents immediate Save from observing stale validity, and `Dashboard.activityAnalyticsPersistence.test.tsx`, whose direct mock required removal of retired exports.
- Affected correction suite: `6` files and `60` tests passed.
- Focused browser-routing suite: `19` files and `140` tests passed.
- Isolated Dashboard suite: `1` file and `22` tests passed.
- Full HMI suite: `197` files and `1829` tests passed. Existing jsdom canvas diagnostics remained non-fatal.
- Both TypeScript projects passed with `--noEmit --incremental false`; production build and ESLint passed. Existing `/grid.svg` and large-chunk build warnings remained non-fatal.
- `git diff --check` and no-index checks for all `7` untracked files passed with only LF-to-CRLF working-copy warnings.
- The active Prisma master is now version `2.0.7`; it and the runtime README describe the unified same-origin browser contract and no longer instruct users to select a legacy Local runtime.
- Python/PowerShell/runtime/provider checks remained intentionally unexecuted; the historical `107/107` foundation result is still not fresh UNI evidence.

## Independent UNI-3 closure evidence

Recorded on 2026-09-17 and approved by the parent.

- The first independent focused run reached `128/129`; the isolated Dashboard suite passed `22/22`, and a `129/129` rerun did not close the review because the assertion remained timing-sensitive and retained behavior was still under-covered.
- The correction restored `11` meaningful cases: same-act invalid blur plus Save, invalid advanced editing during a pending PUT, preview-only non-dirty behavior, demo cadence cleanup and manual speaking, duplicate Save suppression, close/discard reset, scheduled timeout retry, playback-error fade, and orb geometry/reduced-motion/live configuration behavior.
- Dashboard now waits semantically for the exporter effect without timeout padding.
- Corrected independent verification passed `140/140` tests in `19` files, the isolated Dashboard suite passed `22/22`, both TypeScript projects passed, and static plus new-file whitespace checks passed.
- Parent final confirmation passed the same `19` files and `140` tests in `4.36s`.
- No functional source change followed the initial writer pass except the causally justified `10`-line `PrismaVoiceEffectsSettings.tsx` validity fix already covered by the correction evidence.
- The writer full suite passed `197` files and `1829` tests; build, lint, both local TypeScript checks, and whitespace checks passed. The earlier `1818` full and `129` focused counts remain honest historical evidence but were insufficient because retained coverage had been removed.
- Native risk assessment was unavailable for untracked files, so risk remained `HIGH` and required independent verification. RDD remained off and no receipts exist.
- This is offline closure only. No real Vite/backend/browser/provider/proxy-deployment acceptance was performed, and Python `107/107` remains unchanged historical FND evidence.
- During final documentation-only closure, the `592`-file source/test/Vite/runtime boundary remained byte-identical before and after edits at SHA-256 `dbf808ad92560e517a0b5371ae03d3d1318674959309d01b3e5fe5022f590704`. At that historical verification checkpoint, all source and documentation changes were uncommitted; nothing was staged, pushed, or cleaned.

## Rollback boundary

Rollback UNI by reverting only the New/Modify paths above, restoring the seven Delete paths, and removing the subordinate routing guide. Do not revert or clean the existing FND dirty files, runtime operations, service/provider code, master history, unrelated storage, or external state. A rollback restores the legacy selector/browser routing only; it does not undo completed `FND-1`–`FND-11` startup ownership work.

## Genuine gap, effort, and side effects

- **Open production gap:** the IT server must provide forwarding equivalent to the route table, including progressive response streaming and headers. The concrete proxy/server product, auth boundary, certificate policy, and deployment procedure are intentionally unresolved and cannot be claimed by this feature.
- **Estimated implementation:** UNI-1 about 1.5–2 days, UNI-2 about 1.5–2 days, UNI-3 about 0.5–1 day; roughly 3.5–5 engineering days including TDD and independent verification.
- **Expected user-visible side effects:** the Prisma mode selector, three assistant endpoint inputs, legacy snapshot-export controls, and topbar local badge disappear. Prisma remains one assistant whose availability depends on same-origin forwarding. Existing legacy keys/query parameters remain physically present but inert.

## Next step

Proceed with protected backend credential storage/API and access control, then add Voice fields and diagnostics. IT same-origin forwarding and live acceptance remain pending under PW-002/PW-003; do not reopen the completed FND or UNI work to address them.
