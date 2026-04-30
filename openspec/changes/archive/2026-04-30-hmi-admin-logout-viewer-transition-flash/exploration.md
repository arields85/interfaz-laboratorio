## Exploration: hmi-admin-logout-viewer-transition-flash

### Current State
`App.tsx` now mounts `useResumeShield()` alongside the approved #1088 boot/reload hooks. `useResumeShield.ts` listens to `visibilitychange`, `focus`, and `pageshow`, then calls `revealBootShield()` on resume and hides the same root shield after runtime font checks plus 3 rAFs. Because `#hmi-shield` is hidden with `opacity: 0`/`visibility: hidden` and a transition in `index.html`, revealing it over an already-rendered viewer produces a visible fade-in black blink and loader text over live UI.

The deterministic admin logout flash is separate. `AdminLayout.tsx` calls `logout()` and `navigate('/')` synchronously, while `/admin` is already guarded by `RequirePermission`, which also redirects to `/` once auth is cleared. On the viewer side, `Dashboard.tsx` remounts and eventually renders `DashboardViewer.tsx`, whose `useCanvasReference()` metrics still start at `width=0`, `height=0`, `rowHeight=0` until the first valid `ResizeObserver` measurement arrives. The recent `useCanvasReference` guard only preserves the last valid metrics after a valid measurement already existed; it does not protect fresh mounts.

Boot/reload constants from #1088 did not change (`BOOT_SHIELD_MIN_VISIBLE_MS = 1200`, `BOOT_SHIELD_TIMEOUT_MS = 5000`, `BOOT_SHIELD_STABLE_FRAME_COUNT = 4`). The perceived shorter reload duration is still plausible because `useBootShield.ts` changed the font-readiness gate from legacy Google-font checks (`Plus Jakarta Sans` / `Roboto Mono`) to different fonts, so the shield can now reach the unchanged 1200ms floor sooner. However, the current `REQUIRED_FONT_CHECKS` implementation still hardcodes literal names inside the hook instead of deriving them from the canonical typography source.

### Affected Areas
- `hmi-app/src/App.tsx` — root wiring currently enables the aggressive resume shield globally.
- `hmi-app/src/hooks/useResumeShield.ts` — direct source of the tab-return black blink/loader overlay.
- `hmi-app/index.html` — shield hidden state uses an opacity transition, which makes resume reveal visibly fade over live UI.
- `hmi-app/src/hooks/useBootShield.ts` — boot timing constants are intact, but font readiness was changed and is still hardcoded.
- `hmi-app/src/utils/useCanvasReference.ts` — safely preserves last valid metrics, but has no first-valid-measurement readiness signal.
- `hmi-app/src/components/viewer/DashboardViewer.tsx` — renders frame-dependent grid styles immediately, even before first valid canvas metrics exist.
- `hmi-app/src/pages/Dashboard.tsx` — viewer mount path after logout; currently only gates on dashboard data loading, not canvas readiness.
- `hmi-app/src/layouts/AdminLayout.tsx` — logout path performs redundant synchronous auth+navigation changes.
- `hmi-app/src/components/auth/RequirePermission.tsx` — already redirects away from `/admin` once auth is cleared.

### Approaches
1. **Rollback resume shield; fix viewer readiness at the canvas layer** — Remove `useResumeShield` from the root flow, keep the last-valid measurement guard, and add a first-valid-measurement readiness signal so viewer/builder can withhold frame-dependent rendering until metrics are real.
   - Pros: Restores approved #1088 behavior, directly removes the tab-return regression, fixes the deterministic logout flash in the responsible layout/measurement path, preserves the safe invalid-measurement hardening.
   - Cons: Requires a small API expansion in `useCanvasReference` plus consumer updates/tests.
   - Effort: Medium.

2. **Keep resume shield but retune it** — Try to special-case focus/pageshow behavior, remove reveal fade-in, or reveal only for selected resume paths.
   - Pros: Keeps the original intent of masking resume corruption.
   - Cons: High risk of more lifecycle edge cases, still mixes boot/reload architecture with warm-route/viewer problems, does not solve the fresh-mount zero-metrics logout flash by itself.
   - Effort: High.

3. **Patch only admin logout navigation** — Remove the duplicate `navigate('/')` or redirect only once.
   - Pros: Cheap cleanup and worth doing.
   - Cons: Insufficient alone; the viewer can still mount with zero metrics and flash malformed layout on any fresh route entry.
   - Effort: Low.

### Recommendation
Use **Approach 1**, with Approach 3 as a cleanup inside the same fix.

Concretely: revert the root `useResumeShield` behavior and remove the resume hook from `App.tsx`; keep the `useCanvasReference` invalid-measurement filter; extend the shared canvas primitive so consumers know whether a first valid measurement exists; make `DashboardViewer` (and ideally `BuilderCanvas`) avoid rendering frame-dependent grid/layout output until that readiness is true; and simplify admin logout to a single redirect path. For boot/reload, preserve all #1088 timing constants and loader behavior, but replace literal `REQUIRED_FONT_CHECKS` with a token-derived/shared typography source so readiness follows canonical font configuration instead of hook-local strings.

### Risks
- If font readiness is derived from runtime CSS variables, persisted admin font overrides may need an earlier bootstrap source than React to be fully honored on first paint.
- Hiding viewer content until first valid measurement must avoid introducing a new visible blank gap; tests should assert a neutral/loading shell rather than a broken grid.
- Removing `useResumeShield` means any remaining real tab-resume issue must be solved through layout stability, not overlay masking.

### Ready for Proposal
Yes — proposal should scope the change as: rollback the resume shield regression, preserve and extend shared canvas resilience for first valid measurement, simplify admin logout redirect flow, and move boot font-readiness checks to a canonical typography source without altering approved #1088 timing constants.
