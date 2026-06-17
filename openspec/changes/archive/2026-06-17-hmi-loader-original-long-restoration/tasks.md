# Tasks: HMI Loader Original Long Restoration

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 650-900 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 -> PR 2 -> PR 3 |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Lock the new reveal-request contract and no-content helper | PR 1 | Contract/tests first; safe base for later wiring |
| 2 | Migrate boot/reload long orchestration to original-long runner | PR 2 | Depends on PR 1; include hook/controller tests |
| 3 | Wire dashboard/admin content readiness and remove generic viewer gate | PR 3 | Depends on PR 2; delete `viewerReadiness.ts` |

## Phase 1: Contracts / RED

- [x] 1.1 Update `hmi-app/src/shield/__tests__/shieldController.test.ts` and create `hmi-app/src/shield/__tests__/shieldContentReadiness.test.ts` for `ShieldRevealRequest`, `allowNoContentExtension`, and narrow content-ready semantics.
- [x] 1.2 Rewrite `hmi-app/src/hooks/useBootShield.test.tsx`, `hmi-app/src/hooks/shieldLifecycle.test.tsx`, and `hmi-app/src/hooks/useReloadShield.test.tsx` to fail against the restored long contract, short isolation, and no repeated long cycles.
- [x] 1.3 Update `hmi-app/src/pages/Dashboard.test.tsx` and `hmi-app/src/layouts/AdminLayout.test.tsx` so loading/empty/error layouts count as content while blank states keep the shield extended.

## Phase 2: Foundation / GREEN

- [x] 2.1 Modify `hmi-app/src/shield/shieldEvents.ts` and `hmi-app/src/shield/shieldController.ts` to emit `ShieldRevealRequest` with `runner`, `allowNoContentExtension`, and `restartCycle`.
- [x] 2.2 Create `hmi-app/src/shield/shieldContentReadiness.ts` with reset/signal/wait helpers and bounded fallback used only by the long no-content exception.
- [x] 2.3 Modify `hmi-app/src/hooks/useReloadShield.ts` and `hmi-app/src/layouts/AdminLayout.tsx` to request restored `long` explicitly and stop passing generic viewer-ready intent.

## Phase 3: Core Implementation / GREEN

- [x] 3.1 Refactor `hmi-app/src/hooks/useBootShield.ts` into dispatcher logic that selects `runOriginalLongReveal()` or isolated `runShortReveal()` without repeat-cycle orchestration.
- [x] 3.2 Keep original long gates in `hmi-app/src/hooks/useBootShield.ts`: fonts -> WebGL first draw -> stable frames -> minimum visible -> optional no-content extension -> hide.
- [x] 3.3 Modify `hmi-app/src/pages/Dashboard.tsx` to reset content readiness before blank phases and signal readiness once loading, empty, error, or viewer layout is coherently mounted.

## Phase 4: Cleanup / REFACTOR

- [x] 4.1 Delete `hmi-app/src/shield/viewerReadiness.ts` and migrate any remaining imports/tests to `shieldContentReadiness.ts` or the new reveal contract.
- [x] 4.2 Re-run and tighten affected tests in `hmi-app/src/hooks/*.test.tsx`, `hmi-app/src/shield/__tests__/*.ts`, `hmi-app/src/pages/Dashboard.test.tsx`, and `hmi-app/src/layouts/AdminLayout.test.tsx` to cover every spec scenario with no duplicate assertions.
