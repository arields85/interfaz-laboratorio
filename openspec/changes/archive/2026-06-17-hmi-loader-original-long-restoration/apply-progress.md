# Apply Progress: HMI Loader Original Long Restoration

## Execution

- **Date**: 2026-06-17
- **Mode**: Strict TDD
- **Delivery strategy**: chained PR slice
- **Chain strategy**: feature-branch-chain
- **Current work unit**: Work Unit 3 / PR 3
- **Boundary**: wire dashboard content-readiness signaling into the restored long flow, replace the live blank-root extension check with the content-ready helper, and tighten the focused verification set without disturbing PR 1 / PR 2 worktree changes
- **Rollback boundary**: revert `Dashboard.tsx`, `Dashboard.test.tsx`, `useBootShield.ts`, `useBootShield.test.tsx`, `AdminLayout.test.tsx`, and `shieldDebug.ts`; preserve prior PR 1 / PR 2 files and OpenSpec artifacts

## Completed Tasks

- [x] 1.1 Update `hmi-app/src/shield/__tests__/shieldController.test.ts` and create `hmi-app/src/shield/__tests__/shieldContentReadiness.test.ts` for `ShieldRevealRequest`, `allowNoContentExtension`, and narrow content-ready semantics.
- [x] 1.2 Rewrite `hmi-app/src/hooks/useBootShield.test.tsx`, `hmi-app/src/hooks/shieldLifecycle.test.tsx`, and `hmi-app/src/hooks/useReloadShield.test.tsx` to fail against the restored long contract, short isolation, and no repeated long cycles.
- [x] 1.3 Update `hmi-app/src/pages/Dashboard.test.tsx` and `hmi-app/src/layouts/AdminLayout.test.tsx` so loading/empty/error layouts count as content while blank states keep the shield extended.
- [x] 2.1 Modify `hmi-app/src/shield/shieldEvents.ts` and `hmi-app/src/shield/shieldController.ts` to emit `ShieldRevealRequest` with `runner`, `allowNoContentExtension`, and `restartCycle`.
- [x] 2.2 Create `hmi-app/src/shield/shieldContentReadiness.ts` with reset/signal/wait helpers and bounded fallback used only by the long no-content exception.
- [x] 2.3 Modify `hmi-app/src/hooks/useReloadShield.ts` and `hmi-app/src/layouts/AdminLayout.tsx` to request restored `long` explicitly and stop passing generic viewer-ready intent.
- [x] 3.1 Refactor `hmi-app/src/hooks/useBootShield.ts` into dispatcher logic that selects `runOriginalLongReveal()` or isolated `runShortReveal()` without repeat-cycle orchestration.
- [x] 3.2 Keep original long gates in `hmi-app/src/hooks/useBootShield.ts`: fonts -> WebGL first draw -> stable frames -> minimum visible -> optional no-content extension -> hide.
- [x] 3.3 Modify `hmi-app/src/pages/Dashboard.tsx` to reset content readiness before blank phases and signal readiness once loading, empty, error, or viewer layout is coherently mounted.
- [x] 4.1 Delete `hmi-app/src/shield/viewerReadiness.ts` and migrate any remaining imports/tests to `shieldContentReadiness.ts` or the new reveal contract.
- [x] 4.2 Re-run and tighten affected tests in `hmi-app/src/hooks/*.test.tsx`, `hmi-app/src/shield/__tests__/*.ts`, `hmi-app/src/pages/Dashboard.test.tsx`, and `hmi-app/src/layouts/AdminLayout.test.tsx` to cover every spec scenario with no duplicate assertions.

## Remaining Tasks

- None.

## Files Changed

| File | Action | Notes |
|---|---|---|
| `hmi-app/src/shield/__tests__/shieldController.test.ts` | Modified | Added RED assertions for the restored reveal-request contract and short-path isolation. |
| `hmi-app/src/shield/__tests__/shieldContentReadiness.test.ts` | Created | Added RED coverage for content-ready signal/reset/wait behavior and bounded fallback. |
| `hmi-app/src/shield/shieldEvents.ts` | Modified | Added `ShieldRunner` and `ShieldRevealRequest` contract types. |
| `hmi-app/src/shield/shieldController.ts` | Modified | Emitted the new request contract while preserving compatibility for current callers. |
| `hmi-app/src/shield/shieldContentReadiness.ts` | Created | Added narrow content readiness helpers for the future long no-content exception. |
| `hmi-app/src/shield/shieldDebug.ts` | Created | Added a no-op shield debug shim so the shared content-readiness helper can be imported in runtime and tests. |
| `hmi-app/src/shield/shieldProfiles.ts` | Restored | Reintroduced the preserved PR 1 profile contract that shield controller/tests still import. |
| `hmi-app/src/hooks/useBootShield.ts` | Modified | Swapped the live long-extension check from generic root-content observation to the content-ready helper contract. |
| `hmi-app/src/hooks/useBootShield.test.tsx` | Modified | Tightened long-extension coverage so mounted DOM alone no longer releases the shield without an explicit content-ready signal. |
| `hmi-app/src/hooks/useReloadShield.ts` | Modified | Routed keyboard reload through the explicit restored-long request contract before scheduling reload. |
| `hmi-app/src/hooks/useReloadShield.test.tsx` | Modified | Asserted reload emits the restored-long request contract while preserving the one-frame reload behavior. |
| `hmi-app/src/layouts/AdminLayout.tsx` | Modified | Routed logout through the restored-long request contract before invoking auth logout. |
| `hmi-app/src/layouts/AdminLayout.test.tsx` | Modified | Kept logout contract coverage and tightened shell-mounted assertions for the admin outlet. |
| `hmi-app/src/pages/Dashboard.tsx` | Modified | Reset content readiness on mount/unmount and signal coherent loading/empty/viewer states. |
| `hmi-app/src/pages/Dashboard.test.tsx` | Modified | Added integration coverage for loading, empty, viewer, and cleanup content-readiness behavior. |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `hmi-app/src/shield/__tests__/shieldController.test.ts`, `hmi-app/src/shield/__tests__/shieldContentReadiness.test.ts` | Unit | ✅ `npm run test -- src/shield/__tests__/shieldController.test.ts src/shield/__tests__/viewerReadiness.test.ts` (5/5) | ✅ Wrote failing contract/helper tests first; controller detail mismatch and missing helper module failed | ✅ `npm run test -- src/shield/__tests__/shieldController.test.ts src/shield/__tests__/shieldContentReadiness.test.ts` (7/7) | ✅ Added long + short contract cases and ready + timeout helper cases | ✅ Extracted contract-resolution helpers while keeping tests green |
| 2.1 | `hmi-app/src/shield/__tests__/shieldController.test.ts` | Unit | ✅ `npm run test -- src/shield/__tests__/shieldController.test.ts src/shield/__tests__/viewerReadiness.test.ts` (5/5) | ✅ Added failing assertions for `runner` and `allowNoContentExtension` on emitted requests | ✅ `npm run test -- src/shield/__tests__/shieldController.test.ts src/shield/__tests__/shieldContentReadiness.test.ts` (7/7) | ✅ Covered both `long` and `short` request branches | ✅ Extracted `resolveRunner()` and `resolveAllowNoContentExtension()` |
| 2.2 | `hmi-app/src/shield/__tests__/shieldContentReadiness.test.ts` | Unit | N/A (new) | ✅ Added failing import/behavior tests before creating the helper | ✅ `npm run test -- src/shield/__tests__/shieldController.test.ts src/shield/__tests__/shieldContentReadiness.test.ts` (7/7) | ✅ Covered explicit ready signal and bounded timeout fallback | ✅ Kept helper API focused; no further refactor needed |
| 1.2 | `hmi-app/src/hooks/useBootShield.test.tsx`, `hmi-app/src/hooks/useReloadShield.test.tsx` | Integration | ✅ `npm run test -- src/hooks/useBootShield.test.tsx src/hooks/shieldLifecycle.test.tsx src/hooks/useReloadShield.test.tsx` (13/13) | ✅ Added failing tests first for restarted long requests, short-path isolation, and blank-root extension before touching runtime hook code | ✅ `npm run test -- src/hooks/useBootShield.test.tsx src/hooks/shieldLifecycle.test.tsx src/hooks/useReloadShield.test.tsx` (16/16) | ✅ Covered restarted long, isolated short, blank-root extension, and warm-resume/no-repeat safety | ✅ Consolidated the request contract into exported hook helpers used by runtime callers |
| 2.3 | `hmi-app/src/hooks/useReloadShield.test.tsx`, `hmi-app/src/layouts/AdminLayout.test.tsx` | Integration | ✅ `npm run test -- src/hooks/useReloadShield.test.tsx src/layouts/AdminLayout.test.tsx` (6/6) | ✅ Added failing contract assertions for reload and logout request emission before updating the callers | ✅ `npm run test -- src/hooks/useReloadShield.test.tsx src/layouts/AdminLayout.test.tsx` (6/6) | ✅ Covered both keyboard reload and admin logout long-request paths | ✅ Reused the shared request helper instead of duplicating event dispatch logic |
| 3.1 | `hmi-app/src/hooks/useBootShield.test.tsx` | Integration | ✅ `npm run test -- src/hooks/useBootShield.test.tsx src/hooks/shieldLifecycle.test.tsx src/hooks/useReloadShield.test.tsx` (13/13) | ✅ Added failing restart/short dispatcher tests before refactoring the hook | ✅ `npm run test -- src/hooks/useBootShield.test.tsx` (11/11) | ✅ Forced both dispatcher branches (`original-long`, `short`) through separate execution paths | ✅ Replaced one-shot boot logic with a reusable dispatcher while preserving existing hide semantics |
| 3.2 | `hmi-app/src/hooks/useBootShield.test.tsx` | Integration | ✅ `npm run test -- src/hooks/useBootShield.test.tsx src/hooks/shieldLifecycle.test.tsx src/hooks/useReloadShield.test.tsx` (13/13) | ✅ Added failing blank-root extension coverage before changing the long runner | ✅ `npm run test -- src/hooks/useBootShield.test.tsx` (11/11) | ✅ Covered default long hide plus the narrow blank-root extension path | ✅ Kept the long runner sequence explicit and isolated from generic repeat/viewer-ready orchestration |
| 1.3 | `hmi-app/src/pages/Dashboard.test.tsx`, `hmi-app/src/layouts/AdminLayout.test.tsx` | Integration | ✅ `npm run test -- src/pages/Dashboard.test.tsx src/layouts/AdminLayout.test.tsx` (6/6) | ✅ Added failing dashboard readiness assertions first for coherent loading/empty/viewer layouts; admin shell coverage stayed green and was tightened in the same slice | ✅ `npm run test -- src/pages/Dashboard.test.tsx src/layouts/AdminLayout.test.tsx` (8/8) | ✅ Covered loading, empty, viewer, and unmount cleanup paths without relying on CSS-only assertions | ✅ Reused the root readiness attribute as the shared behavioral probe |
| 3.3 | `hmi-app/src/pages/Dashboard.test.tsx`, `hmi-app/src/hooks/useBootShield.test.tsx` | Integration | ✅ `npm run test -- src/pages/Dashboard.test.tsx src/layouts/AdminLayout.test.tsx src/hooks/useBootShield.test.tsx` (19/19 after slice) | ✅ Wrote failing tests first so mounted DOM alone no longer released long; dashboard had to signal coherent content explicitly | ✅ `npm run test -- src/pages/Dashboard.test.tsx src/hooks/useBootShield.test.tsx` (17/17) | ✅ Covered loading/empty/viewer signals plus long-wait release only after the content-ready event | ✅ Removed the generic root-content observer in favor of the shared helper contract |
| 4.2 | `hmi-app/src/hooks/useBootShield.test.tsx`, `hmi-app/src/hooks/useReloadShield.test.tsx`, `hmi-app/src/shield/__tests__/shieldContentReadiness.test.ts`, `hmi-app/src/pages/Dashboard.test.tsx`, `hmi-app/src/layouts/AdminLayout.test.tsx` | Integration + Unit | ✅ `npm run test -- src/pages/Dashboard.test.tsx src/layouts/AdminLayout.test.tsx src/hooks/useBootShield.test.tsx` (19/19) | ✅ Added the final failing assertions before tightening the slice-wide coverage set | ✅ `npm run test -- src/pages/Dashboard.test.tsx src/layouts/AdminLayout.test.tsx src/hooks/useBootShield.test.tsx src/hooks/useReloadShield.test.tsx src/shield/__tests__/shieldContentReadiness.test.ts` (25/25) | ✅ Re-ran the full PR 3 slice across unit + integration helpers and runtime callers | ✅ Removed duplicate readiness assumptions by anchoring on one explicit content-ready contract |

## Test Summary

- **Total tests written**: 11 cumulative across PR 1-3 slices
- **Total tests passing**: 56 cumulative focused test executions across PR 1-3 slices
- **Layers used**: Unit (15), Integration (41), E2E (0)
- **Approval tests**: None — no behavior-preserving approval capture was required in these slices
- **Pure functions created**: 3 (`resolveRunner`, `resolveAllowNoContentExtension`, `hasRecognizableRootContent` from prior slices; PR 3 added no new pure helper)

## Verification Evidence

| Command | Result |
|---|---|
| `npm run test -- src/shield/__tests__/shieldController.test.ts src/shield/__tests__/viewerReadiness.test.ts` | ✅ Baseline safety net passed (5/5) |
| `npm run test -- src/shield/__tests__/shieldController.test.ts src/shield/__tests__/shieldContentReadiness.test.ts` | ✅ PR 1 contract/helper tests passed (7/7) |
| `npm run test -- src/hooks/useReloadShield.test.tsx src/shield/__tests__/viewerReadiness.test.ts` | ✅ PR 1 compatibility tests passed (6/6) |
| `npm run test -- src/hooks/useBootShield.test.tsx src/hooks/shieldLifecycle.test.tsx src/hooks/useReloadShield.test.tsx` | ✅ PR 2 hook safety net passed before production changes (13/13) |
| `npm run test -- src/hooks/useBootShield.test.tsx src/hooks/useReloadShield.test.tsx src/layouts/AdminLayout.test.tsx src/hooks/shieldLifecycle.test.tsx` | ✅ PR 2 focused slice tests passed after implementation (18/18) |
| `npm run test -- src/hooks/useBootShield.test.tsx` | ✅ Boot dispatcher/original-long tests passed (11/11) |
| `npm run test -- src/hooks/useReloadShield.test.tsx src/layouts/AdminLayout.test.tsx` | ✅ Runtime caller migration tests passed (6/6) |
| `npm run test -- src/pages/Dashboard.test.tsx src/layouts/AdminLayout.test.tsx src/shield/__tests__/shieldController.test.ts` | ✅ Passed after restoring `src/shield/shieldProfiles.ts` and re-exporting the profile-aware shield-content normalizer |
| `npm run test -- src/pages/Dashboard.test.tsx src/layouts/AdminLayout.test.tsx src/hooks/useBootShield.test.tsx` | ✅ PR 3 dashboard/content-ready RED->GREEN slice passed (19/19) |
| `npm run test -- src/shield/__tests__/shieldContentReadiness.test.ts src/hooks/useReloadShield.test.tsx` | ✅ Helper + reload regression tests passed (6/6) |
| `npm run test -- src/pages/Dashboard.test.tsx src/layouts/AdminLayout.test.tsx src/hooks/useBootShield.test.tsx src/hooks/useReloadShield.test.tsx src/shield/__tests__/shieldContentReadiness.test.ts` | ✅ Final PR 3 focused suite passed (25/25) |
| `npm run test -- src/shield/__tests__/shieldController.test.ts src/shield/__tests__/shieldContentReadiness.test.ts src/hooks/useBootShield.test.tsx src/hooks/useReloadShield.test.tsx` | ✅ Remediation regression suite passed (22/22) |
| `npx tsc --noEmit` | ✅ No TypeScript errors after the shield baseline repair |
| `npx eslint src/pages/Dashboard.tsx src/pages/Dashboard.test.tsx src/layouts/AdminLayout.test.tsx src/hooks/useBootShield.ts src/hooks/useBootShield.test.tsx src/shield/shieldContentReadiness.ts src/shield/shieldDebug.ts` | ✅ No lint errors |

## Deviations

- None after remediation. The temporary `waitForViewerReady` compatibility surface was removed and the runtime error shell now matches the content-readiness design intent.

## Issues Found

- None blocking. The missing `src/shield/shieldProfiles.ts` dependency was restored from the isolated shield stash, and the controller path also required `normalizeBootShieldContent` to remain importable/profile-aware for the preserved PR 1 compatibility tests.

## Post-Verify Remediation (2026-06-17)

### Completed Remediation

- [x] Added an explicit runtime dashboard failure-path test and matching runtime error shell so post-error content readiness is proven by integration coverage.
- [x] Removed lingering `waitForViewerReady` compatibility fields from `shieldController.ts` and `shieldEvents.ts`, leaving only the final reveal contract fields from design.
- [x] Added focused `shieldDebug` approval coverage and typed no-op parameters so the changed shim no longer reports 0% focused coverage.

### Files Changed (Remediation)

| File | Action | Notes |
|---|---|---|
| `hmi-app/src/pages/Dashboard.tsx` | Modified | Added an explicit storage-failure shell with `role="alert"` and content-readiness signaling for the error state. |
| `hmi-app/src/pages/Dashboard.test.tsx` | Modified | Added RED->GREEN integration coverage for the storage failure path and readiness signal. |
| `hmi-app/src/shield/shieldController.ts` | Modified | Removed compatibility `waitForViewerReady` handling and defaulted explicit reveals to the final `allowNoContentExtension` contract. |
| `hmi-app/src/shield/shieldEvents.ts` | Modified | Removed the deprecated `waitForViewerReady` field from the shared event contract. |
| `hmi-app/src/shield/shieldDebug.ts` | Modified | Typed the shim parameters and kept explicit no-op returns for cheap focused coverage. |
| `hmi-app/src/shield/__tests__/shieldController.test.ts` | Modified | Added RED coverage for the final contract shape and explicit long extension opt-in. |
| `hmi-app/src/shield/__tests__/shieldDebug.test.ts` | Created | Added approval coverage for the no-op shield debug shim. |

### TDD Cycle Evidence (Remediation)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| R1 | `hmi-app/src/pages/Dashboard.test.tsx` | Integration | ✅ `npm run test -- src/pages/Dashboard.test.tsx src/shield/__tests__/shieldController.test.ts src/shield/__tests__/shieldContentReadiness.test.ts` (13/13) | ✅ Added a failing storage-error readiness test requiring an alert shell | ✅ `npm run test -- src/pages/Dashboard.test.tsx src/shield/__tests__/shieldController.test.ts src/shield/__tests__/shieldContentReadiness.test.ts src/shield/__tests__/shieldDebug.test.ts` (17/17) | ✅ Covered loading, empty, viewer, and explicit error readiness paths | ✅ Silenced expected test logging with a targeted `console.error` spy |
| R2 | `hmi-app/src/shield/__tests__/shieldController.test.ts` | Unit | ✅ `npm run test -- src/pages/Dashboard.test.tsx src/shield/__tests__/shieldController.test.ts src/shield/__tests__/shieldContentReadiness.test.ts` (13/13) | ✅ Added failing assertions removing `waitForViewerReady` and requiring explicit long extension opt-in | ✅ `npm run test -- src/pages/Dashboard.test.tsx src/shield/__tests__/shieldController.test.ts src/shield/__tests__/shieldContentReadiness.test.ts src/shield/__tests__/shieldDebug.test.ts` (17/17) | ✅ Covered default long, explicit long extension, and short isolation branches | ✅ Collapsed the controller contract to the design-owned fields only |
| R3 | `hmi-app/src/shield/__tests__/shieldDebug.test.ts` | Unit | N/A (new focused coverage for an existing shim) | ➖ Approval tests captured the existing no-op behavior before typing the shim | ✅ `npm run test -- src/pages/Dashboard.test.tsx src/shield/__tests__/shieldController.test.ts src/shield/__tests__/shieldContentReadiness.test.ts src/shield/__tests__/shieldDebug.test.ts` (17/17) | ✅ Covered both generic and shield-scoped debug entry points | ✅ Typed unused parameters with explicit no-op returns so lint and focused coverage stay green |

### Verification Evidence (Remediation)

| Command | Result |
|---|---|
| `npm run test -- src/pages/Dashboard.test.tsx src/shield/__tests__/shieldController.test.ts src/shield/__tests__/shieldContentReadiness.test.ts` | ✅ Safety net passed (13/13) |
| `npm run test -- src/pages/Dashboard.test.tsx src/shield/__tests__/shieldController.test.ts src/shield/__tests__/shieldDebug.test.ts` | ✅ RED captured 3 failing assertions before production fixes |
| `npm run test -- src/pages/Dashboard.test.tsx src/shield/__tests__/shieldController.test.ts src/shield/__tests__/shieldContentReadiness.test.ts src/shield/__tests__/shieldDebug.test.ts` | ✅ GREEN remediation suite passed (17/17) |
| `npm run test:coverage -- src/pages/Dashboard.test.tsx src/shield/__tests__/shieldController.test.ts src/shield/__tests__/shieldContentReadiness.test.ts src/shield/__tests__/shieldDebug.test.ts` | ⚠️ Focused run still fails repo-global thresholds, but changed remediation files now include `shieldDebug.ts` at 100% and `Dashboard.tsx` at 96.96% lines / 88.88% branches |
| `npx tsc --noEmit` | ✅ No TypeScript errors |
| `npx eslint src/pages/Dashboard.tsx src/pages/Dashboard.test.tsx src/shield/shieldController.ts src/shield/shieldEvents.ts src/shield/shieldDebug.ts src/shield/__tests__/shieldController.test.ts src/shield/__tests__/shieldContentReadiness.test.ts src/shield/__tests__/shieldDebug.test.ts` | ✅ No lint errors |
