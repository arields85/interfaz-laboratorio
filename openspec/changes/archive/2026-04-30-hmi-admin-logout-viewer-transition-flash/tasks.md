# Tasks: Fix admin logout viewer transition flash

## Phase 1: RED — Shield rollback and font-readiness specs

- [x] 1.1 Update `hmi-app/src/App.test.tsx` to fail until `App.tsx` stops importing/calling `useResumeShield`, while still calling `useBootShield` and `useReloadShield` once.
- [x] 1.2 Delete `hmi-app/src/hooks/useResumeShield.test.tsx` in the same RED step that proves warm resume no longer has any root shield wiring or focus-resume reveal path.
- [x] 1.3 Rewrite `hmi-app/src/hooks/useBootShield.test.tsx` to fail against `REQUIRED_FONT_CHECKS`, asserting readiness comes from canonical CSS tokens via `getComputedStyle(document.documentElement)` and not hook-local hardcoded font names.
- [x] 1.4 Add RED fallback tests in `hmi-app/src/hooks/useBootShield.test.tsx` for empty/unresolvable token values so bounded timeout behavior stays unchanged without blocking on removed literals.

## Phase 2: RED — Shared canvas readiness and viewer shell specs

- [x] 2.1 Extend `hmi-app/src/utils/useCanvasReference.test.tsx` with RED coverage proving `hasFirstValidMeasurement` starts `false` before any valid `ResizeObserver` callback.
- [x] 2.2 Add RED coverage in `hmi-app/src/utils/useCanvasReference.test.tsx` proving the first valid measurement flips readiness to `true` and later stable valid measurements still replace cached metrics.
- [x] 2.3 Add RED coverage in `hmi-app/src/utils/useCanvasReference.test.tsx` proving transient zero/invalid measurements never reset readiness and retain the last valid metrics.
- [x] 2.4 Add RED coverage in `hmi-app/src/components/viewer/DashboardViewer.test.tsx` proving `dashboard-viewer-frame` is absent before first valid measurement, so malformed zero-metric layout never renders.
- [x] 2.5 Add RED coverage in `hmi-app/src/components/viewer/DashboardViewer.test.tsx` proving the frame appears with valid measured styles only after readiness becomes `true`.
- [x] 2.6 Optional if verified: add `hmi-app/src/layouts/AdminLayout.test.tsx` proving logout relies on auth-state redirect alone and does not imperatively navigate after `logout()`.

## Phase 3: GREEN — Implement minimal production changes

- [x] 3.1 Remove `useResumeShield` from `hmi-app/src/App.tsx` and delete `hmi-app/src/hooks/useResumeShield.ts` once Phase 1 RED tests exist.
- [x] 3.2 Refactor `hmi-app/src/hooks/useBootShield.ts` to replace `REQUIRED_FONT_CHECKS` with canonical runtime token resolution and preserve all existing timing/constants.
- [x] 3.3 Add `hasFirstValidMeasurement` to `hmi-app/src/utils/useCanvasReference.ts` with a one-way first-valid latch while keeping the current invalid-measurement last-valid guard.
- [x] 3.4 Gate `hmi-app/src/components/viewer/DashboardViewer.tsx` frame rendering on shared readiness so the root container remains a neutral shell before first valid metrics.
- [x] 3.5 Optional if Phase 2.6 is proven: simplify `hmi-app/src/layouts/AdminLayout.tsx` by removing redundant `navigate('/')` and any unused `useNavigate` import.

## Phase 4: Verification — targeted only

- [x] 4.1 Run targeted Vitest coverage for `src/App.test.tsx`, `src/hooks/useBootShield.test.tsx`, `src/utils/useCanvasReference.test.tsx`, `src/components/viewer/DashboardViewer.test.tsx`, plus `src/layouts/AdminLayout.test.tsx` only if added.
- [x] 4.2 Run `npm run lint` in `hmi-app/` after tests pass; do not build.
