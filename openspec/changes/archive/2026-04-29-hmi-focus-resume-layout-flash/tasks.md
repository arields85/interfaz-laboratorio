# Tasks: hmi-focus-resume-layout-flash

## Phase 1: RED — failing tests first

- [x] 1.1 Add `hmi-app/src/hooks/useResumeShield.test.tsx` covering `visibilitychange`/`focus` resume, debounce `< 150ms`, in-flight guard, timeout fallback, stable-frame wait, and listener cleanup against the root-owned `#hmi-shield` lifecycle.
- [x] 1.2 Update `hmi-app/src/hooks/useBootShield.test.tsx` to fail against runtime typography tokens by asserting `REQUIRED_FONT_CHECKS` uses `JetBrainsMono`, `IBMPlexMono`, and `Magistral` font strings from `hmi-app/src/index.css` instead of legacy names.
- [x] 1.3 Extend `hmi-app/src/utils/useCanvasReference.test.tsx` with failing cases where transient zero/invalid `ResizeObserver` measurements are ignored after a valid measurement and later replaced by the next stable valid size.
- [x] 1.4 Update `hmi-app/src/hooks/shieldLifecycle.test.tsx` and `hmi-app/src/App.test.tsx` so the combined shield harness expects `useResumeShield()` orchestration without breaking existing boot/reload behavior.

## Phase 2: GREEN — minimal implementation

- [x] 2.1 Create `hmi-app/src/hooks/useResumeShield.ts` with resume detection from `document.visibilitychange`, `window.blur`, and `window.focus`, reusing the existing root-owned shield helpers, debounce/timeout constants, and a 3-frame stability wait.
- [x] 2.2 Modify `hmi-app/src/hooks/useBootShield.ts` to export the shared shield helpers needed by resume and replace legacy font checks with runtime-token-aligned font strings derived from `hmi-app/src/index.css`.
- [x] 2.3 Wire `useResumeShield()` in `hmi-app/src/App.tsx` and keep `hmi-app/src/hooks/useReloadShield.ts` behavior untouched so reload still owns its terminal path.
- [x] 2.4 Harden `hmi-app/src/utils/useCanvasReference.ts` to discard transient zero/invalid measurements and retain the last valid metrics until a later valid measurement arrives.

## Phase 3: REFACTOR + targeted verification

- [x] 3.1 Refactor only shared shield internals needed to satisfy the new tests while preserving #1088 boot/reload ownership and avoiding widget-specific or renderer-specific patches.
- [x] 3.2 Run targeted tests only: `useResumeShield.test.tsx`, `useBootShield.test.tsx`, `shieldLifecycle.test.tsx`, `App.test.tsx`, and `useCanvasReference.test.tsx`; do not run a build.

## Phase 4: Documentation follow-up only if needed

- [x] 4.1 Update `openspec/changes/hmi-focus-resume-layout-flash/design.md` or related change docs only if implementation requires reconciling artifact details such as the resume event surface; otherwise leave docs unchanged.
