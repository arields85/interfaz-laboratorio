# Design: HMI Loader Original Long Restoration

## Technical Approach

Restore one `long` lifecycle by replacing the mixed `startCycle(waitForViewerReady)` orchestration in `hmi-app/src/hooks/useBootShield.ts` with a request dispatcher that chooses between two runners only: dedicated original-`long` and isolated `short`. Every `long` activation (initial boot, keyboard reload, admin/logout, future explicit reveals) must create the same reveal contract and enter the same original sequence: fonts -> WebGL first draw -> stable frames -> minimum visible -> hide. Specs: `runtime-boot-shield`, `shield-reveal-profiles`.

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|---|---|---|---|
| Long lifecycle shape | Keep one hook with booleans; remove orchestration entirely; dedicated runner dispatch | Dedicated original-`long` runner plus isolated `short` runner | Restores `d538c33`/`c67e9a8` semantics without risking short regressions or keeping repeat-cycle behavior alive by accident. |
| Exit extension contract | Reuse `waitForViewerReady`; add explicit content gate | Explicit `allowNoContentExtension` + content-ready gate | Prevents generic viewer-readiness from redefining default long timing; the exception becomes opt-in and narrow. |
| DOM ownership | New shield element; reuse root shell | Reuse existing root-owned `#hmi-shield` | Preserves #1088 constraints, static bootstrap behavior, and existing visual baseline in `hmi-app/index.html`. |

## Data Flow

```text
Boot / reload / explicit reveal
        -> ShieldRevealRequest
        -> useBootShield dispatcher
           -> long  -> runOriginalLongReveal()
                    -> fonts -> first draw -> stable frames -> min visible
                    -> if allowNoContentExtension && !isContentReady()
                         waitForContentReady() within remaining timeout
                    -> hide
           -> short -> runShortReveal()
                    -> short visual budget -> hide

Dashboard / destination layout
        -> resetContentReady() before blank phase
        -> signalContentReady() once loading/empty/error/real layout is coherently mounted
```

## File Changes

| File | Action | Description |
|---|---|---|
| `hmi-app/src/hooks/useBootShield.ts` | Modify | Replace `startCycle`/repeat logic with request dispatcher and original-`long` runner. |
| `hmi-app/src/shield/shieldController.ts` | Modify | Emit explicit reveal contract (`allowNoContentExtension`) instead of `waitForViewerReady`. |
| `hmi-app/src/shield/shieldEvents.ts` | Modify | Rename event detail to a reveal-request contract shared by boot and explicit reveals. |
| `hmi-app/src/shield/shieldContentReadiness.ts` | Create | Narrow readiness helper for the no-content exception only. |
| `hmi-app/src/hooks/useReloadShield.ts` | Modify | Request restored `long` with explicit exception intent for reload only. |
| `hmi-app/src/layouts/AdminLayout.tsx` | Modify | Request restored `long` via the new contract for logout. |
| `hmi-app/src/pages/Dashboard.tsx` | Modify | Signal content-ready when a coherent layout exists; stop using generic viewer-ready semantics. |
| `hmi-app/src/shield/viewerReadiness.ts` | Delete | Remove the generic gate after callers migrate. |
| `hmi-app/src/hooks/*.test.tsx`, `hmi-app/src/shield/__tests__/*.ts`, `hmi-app/src/pages/Dashboard.test.tsx`, `hmi-app/src/layouts/AdminLayout.test.tsx` | Modify/Create | Replace mixed-long assertions with restored-contract and exception-focused tests. |

## Interfaces / Contracts

```ts
type ShieldRunner = 'original-long' | 'short';

interface ShieldRevealRequest {
  profileId: ShieldProfileId;
  runner: ShieldRunner;
  allowNoContentExtension: boolean;
  restartCycle: boolean;
}
```

`allowNoContentExtension` is evaluated only after the restored long sequence completes. Content readiness means a mounted, stable, recognizable layout; loading, empty, and error states count as ready.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Reveal contract mapping and content-ready helper | Add/red tests around request creation, reset/signal/wait semantics, and timeout boundaries. |
| Integration | Original long boot/reload/admin flow; short isolation; no repeated long cycles | Rewrite `useBootShield.test.tsx`, `shieldLifecycle.test.tsx`, `useReloadShield.test.tsx`, `shieldController.test.ts` first under strict TDD. |
| Integration | Dashboard exception behavior | Update `Dashboard.test.tsx` so coherent loading/empty/error layouts release long, while blank `null` states keep the exception active. |
| E2E | N/A | No E2E harness exists in this repo. |

## Migration / Rollout

No migration required. Apply as a bounded refactor: write failing tests first, add the new reveal contract and content-ready helper, route all current `long` callers through it, then remove repeat-cycle/viewer-ready branching. Keep static shield markup, profile timings, and short bootstrap intent unchanged.

## Open Questions

- [ ] Confirm during apply whether post-logout destination already mounts a coherent shell immediately; if yes, `allowNoContentExtension` can remain harmless but may prove unnecessary for that path.
