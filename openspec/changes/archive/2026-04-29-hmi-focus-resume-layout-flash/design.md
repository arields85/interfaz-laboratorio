# Design: hmi-focus-resume-layout-flash

## 1. Architectural Decision: New Hook vs Extend Existing

**Decision**: Add a new `useResumeShield` hook alongside the existing `useBootShield` and `useReloadShield`.

**Rationale**:
- `useBootShield` owns the **boot lifecycle** (mount -> fonts -> shader -> stable paint -> min-visible -> hide). Its async pipeline is linear and runs once. Injecting resume logic into it would entangle two distinct lifecycles in one effect, violating single-responsibility and making the boot pipeline harder to reason about.
- `useReloadShield` owns **keyboard-triggered reload** (intercept shortcut -> reveal shield -> rAF -> reload). It is synchronous and terminal (the page reloads). Resume is neither.
- `useResumeShield` owns the **focus/visibility resume lifecycle** (detect resume -> reveal shield -> wait for stable state -> hide). It reuses the same root-owned `#hmi-shield` DOM element and the existing `revealBootShield`/`hideBootShield` helpers, but runs its own independent readiness pipeline.
- All three hooks are called from `App.tsx`, keeping the shield orchestration visible at the top level.

**Shared infrastructure extracted from `useBootShield`**:
- `revealBootShield()` — already exported, reused as-is.
- `hideBootShield()` — currently private. Must be exported (or extracted to a shared `shieldDom.ts` utility).
- `areRequiredFontsReady()` — currently private. Must be exported for reuse.
- `waitForStablePaint()` pattern — duplicated inline in `useResumeShield` (not extracted as shared, because the boot version is entangled with its own cleanup/cancellation refs).

The `#hmi-shield` element lifecycle remains **root-owned**: created in `index.html`, never removed, shown/hidden by hooks. No new DOM elements are created.

## 2. Browser Lifecycle Events and Debounce Strategy

### 2.1 Events Listened

| Event | Target | Purpose |
|-------|--------|---------|
| `visibilitychange` | `document` | Primary signal for tab switch resume. Fires when `document.visibilityState` transitions from `"hidden"` to `"visible"`. |
| `focus` | `window` | Catches OS-level window restore/alt-tab that may not fire `visibilitychange` in all browsers. |
| `pageshow` | `window` | Covers browser restore paths that surface like a page re-show and still need the shared shield before exposing intermediate frames. |

**Not used**:
- `resize`: Handled separately by `useCanvasReference` hardening (Section 4). Not a shield trigger.

### 2.2 Resume Detection Logic

```
visibilitychange (hidden -> visible)  ──┐
window focus                           ──┼──> scheduleResumeShield()
window pageshow                        ──┘
```

**Guard conditions** (skip if any is true):
1. Shield is already visible (`data-hmi-shield-state === "visible"`). Avoids stacking with boot or reload.
2. A resume cycle is already in progress (internal `isResuming` ref).
3. The page was hidden for less than `RESUME_DEBOUNCE_MS` (150ms). Very brief focus blips (e.g., DevTools toggle) don't need shielding.

### 2.3 Hidden Duration Tracking

A `hiddenSince` timestamp is captured when:
- `visibilitychange` fires with `document.visibilityState === "hidden"`, OR
- `window` fires `blur` while `!document.hasFocus()`.

On resume, `Date.now() - hiddenSince` is compared against `RESUME_DEBOUNCE_MS`. If below threshold, no shield is raised.

### 2.4 Stable-Frame Strategy

Once the shield is revealed on resume, the hook waits for **readiness** before hiding:

```
1. revealBootShield(shield)           // instant, reuses existing reveal
2. await fontsStable()                // see Section 3
3. await waitForStableFrames(3)       // 3 consecutive rAF callbacks
4. hideBootShield(shield)             // fade-out via existing CSS transition
```

**Why 3 frames instead of 4 (boot uses 4)**:
- Boot starts from cold (no layout yet). Resume starts from warm (layout was valid before hide). Fewer frames needed to confirm compositor stability after re-composition.

**Timeout safety net**: `RESUME_SHIELD_TIMEOUT_MS = 2000` (shorter than boot's 5000ms, because resume should be fast). If readiness doesn't resolve, shield hides unconditionally.

**No min-visible time**: Unlike boot, resume should be as brief as possible. The shield is utilitarian, not branding. Show it only as long as needed.

### 2.5 Constants

```typescript
export const RESUME_DEBOUNCE_MS = 150;
export const RESUME_SHIELD_TIMEOUT_MS = 2000;
export const RESUME_STABLE_FRAME_COUNT = 3;
```

## 3. Font Readiness Strategy

### 3.1 Current Problem

`useBootShield` checks:
```typescript
const REQUIRED_FONT_CHECKS = ['16px "Plus Jakarta Sans"', '16px "Roboto Mono"'];
```

But `index.css` defines the actual typography tokens as:
- `--font-system: "JetBrainsMono"` (body, most UI)
- `--font-mono: "IBMPlexMono"` (monospace displays)
- `--font-dashboard-title: "Magistral"` (large titles)
- `--font-widget-value: "Magistral"` (metric values)

`Plus Jakarta Sans` and `Roboto Mono` are loaded via Google Fonts (`index.html` line 159) but are NOT referenced by any CSS token in `index.css`. They appear to be legacy/unused fonts from an earlier design iteration.

### 3.2 Design: Align Font Checks with Actual Tokens

**Replace `REQUIRED_FONT_CHECKS` in `useBootShield`** with fonts derived from the actual typography stack:

```typescript
export const REQUIRED_FONT_CHECKS = [
    '400 11px "JetBrainsMono"',   // --font-system at --font-size-system
    '400 10px "IBMPlexMono"',     // --font-mono at --font-size-mono
    '400 48px "Magistral"',       // --font-dashboard-title at --font-size-dashboard-title
];
```

**Why these three**:
- `JetBrainsMono` is the system font — used everywhere, most visible if missing.
- `IBMPlexMono` is the mono/chart font — used in data displays.
- `Magistral` is the dashboard title and widget value font — large text, very noticeable if it falls back to sans-serif.

**Why not check all fonts** (Poppins, SpaceGrotesk, Ubuntu, Lato, etc.):
- They are defined in `@font-face` but are theme-selectable options, not all active at once. Waiting for all of them would over-wait. The three above cover the default theme's critical rendering path.

**Resume reuses the same check**: `useResumeShield` calls `areRequiredFontsReady()` (now checking the correct fonts). After a visibility resume, browsers may need to re-activate font caches. The check confirms fonts are queryable before exposing the UI.

### 3.3 Font Wait Strategy for Resume

Resume does NOT call `document.fonts.ready` (the full FontFaceSet promise). That promise resolves when ALL fonts finish loading — overkill for resume where fonts are already loaded but may need re-activation.

Instead, resume polls `areRequiredFontsReady()` with a tight loop (16ms interval) bounded by `RESUME_SHIELD_TIMEOUT_MS`. In practice, fonts should be immediately available on resume; the poll is a safety net for edge cases where the font subsystem is briefly unavailable.

```typescript
async function waitForFontsOnResume(deadline: number): Promise<void> {
    while (!areRequiredFontsReady() && Date.now() < deadline) {
        await waitForDelay(16);
    }
}
```

## 4. Measurement Hardening: `useCanvasReference`

### 4.1 Current Problem

`useCanvasReference` commits every `ResizeObserver` entry immediately (via one rAF). During visibility resume or abrupt window restore, the browser may report **transient zero or near-zero dimensions** for one frame before settling. This causes:
- `rowHeight` of 0 (stacked/collapsed widgets)
- `cellWidth` of 0 (overlapping columns)
- One frame of broken layout visible to the user

### 4.2 Design: Last-Valid-Metrics Guard

Add a validity check before committing new metrics. If the incoming dimensions are invalid, **retain the previous valid metrics** until a valid measurement arrives.

```typescript
function isValidMeasurement(width: number, height: number): boolean {
    return width > 0 && height > 0;
}
```

In the `ResizeObserver` callback:

```typescript
const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;

    const { width, height } = entry.contentRect;

    if (!isValidMeasurement(width, height)) {
        return; // silently discard — keep last valid metrics
    }

    scheduleMetricsUpdate(computeCanvasMetrics({
        width, height, cols, rows, offsetX: 0, offsetY: 0,
    }));
});
```

**Why this is safe**:
- Initial state already has `width: 0, height: 0` from `getInitialMetrics()`. The guard does NOT prevent the first valid measurement from being committed.
- Once a valid measurement has been committed, transient zeros are ignored until a new valid measurement arrives.
- Legitimate zero-size (e.g., container actually hidden with `display: none`) is handled correctly: metrics freeze at last valid size, which is correct because a hidden container should not trigger layout recalculation.

### 4.3 No Debounce on Valid Measurements

The existing single-rAF batching (`requestAnimationFrame` in `scheduleMetricsUpdate`) is sufficient. Adding a time-based debounce would delay legitimate resize responses (e.g., window drag-resize) and make the grid feel laggy. The fix is **filtering**, not throttling.

### 4.4 Scope Guard: no aspect-fit / letterboxing change in this delta

This change intentionally does **not** modify how builder or viewer consume the shared canvas dimensions for aspect-fit / letterboxing. That product behavior belongs to the broader `canvas-bounds` capability and remains outside the focus-resume flash fix. The only `canvas-bounds` responsibility in scope here is preventing transient invalid restore/resume measurements from replacing the last valid shared metrics.

## 5. File Changes Summary

| File | Change | Details |
|------|--------|---------|
| `hmi-app/src/hooks/useResumeShield.ts` | **New** | Resume lifecycle hook: visibilitychange/focus listeners, debounce, shield reveal/hide with stable-frame wait. |
| `hmi-app/src/hooks/useResumeShield.test.tsx` | **New** | Tests for resume detection, debounce, font readiness integration, timeout, cleanup. |
| `hmi-app/src/hooks/useBootShield.ts` | **Modified** | (1) Update `REQUIRED_FONT_CHECKS` to actual app fonts. (2) Export `hideBootShield` and `areRequiredFontsReady` for reuse by resume hook. |
| `hmi-app/src/hooks/useBootShield.test.tsx` | **Modified** | Update font check expectations to match new `REQUIRED_FONT_CHECKS`. |
| `hmi-app/src/utils/useCanvasReference.ts` | **Modified** | Add `isValidMeasurement` guard in ResizeObserver callback. |
| `hmi-app/src/utils/useCanvasReference.test.tsx` | **Modified** | Add test cases for transient zero dimensions being discarded. |
| `hmi-app/src/App.tsx` | **Modified** | Import and call `useResumeShield()`. |
| `hmi-app/src/App.test.tsx` | **Modified** | Mock `useResumeShield` alongside existing shield mocks. |

**Not modified**:
- `hmi-app/index.html` — No changes needed. The `#hmi-shield` element and its CSS are already sufficient for resume (same reveal/hide mechanism).
- `hmi-app/src/hooks/useReloadShield.ts` — No changes needed. Reload is independent of resume.

## 6. Testing Plan

### 6.1 `useResumeShield.test.tsx` (New)

| Test Case | Description |
|-----------|-------------|
| `reveals shield on visibilitychange hidden->visible after debounce threshold` | Simulate `visibilitychange` with enough elapsed time. Assert shield becomes visible, then hides after stable frames. |
| `reveals shield on window focus after debounce threshold` | Simulate `blur` + `focus` with enough elapsed time. Assert shield lifecycle. |
| `skips shield when hidden duration is below debounce threshold` | Simulate rapid hidden->visible (< 150ms). Assert shield is NOT revealed. |
| `skips shield when shield is already visible (boot in progress)` | Mount with shield in visible state. Simulate resume. Assert no double-reveal or state corruption. |
| `skips shield when resume is already in progress` | Trigger two rapid resumes. Assert only one cycle runs. |
| `hides shield unconditionally after timeout` | Stub `areRequiredFontsReady` to always return false. Assert shield hides after `RESUME_SHIELD_TIMEOUT_MS`. |
| `waits for fonts before hiding` | Stub `areRequiredFontsReady` to return false then true. Assert shield waits. |
| `waits for stable frames before hiding` | Assert rAF is called `RESUME_STABLE_FRAME_COUNT` times before hide. |
| `cleans up listeners and timers on unmount` | Unmount mid-resume. Assert no dangling listeners, no state updates after unmount. |
| `does not interfere with reload shield` | Trigger reload shortcut during resume. Assert reload takes precedence (shield stays visible for reload). |

### 6.2 `useBootShield.test.tsx` (Modified)

| Test Case | Change |
|-----------|--------|
| Existing font check tests | Update expected font strings from `Plus Jakarta Sans`/`Roboto Mono` to `JetBrainsMono`/`IBMPlexMono`/`Magistral`. |
| All existing tests | Must continue passing — boot lifecycle is unchanged except for which fonts are checked. |

### 6.3 `useCanvasReference.test.tsx` (Modified)

| Test Case | Description |
|-----------|-------------|
| `discards transient zero-width measurement and retains previous metrics` | Emit valid resize, then emit resize with `width: 0`. Assert metrics unchanged. |
| `discards transient zero-height measurement and retains previous metrics` | Emit valid resize, then emit resize with `height: 0`. Assert metrics unchanged. |
| `accepts valid measurement after transient zero` | Emit valid -> zero -> valid. Assert final metrics match second valid emission. |
| `initial zero metrics are not overwritten by transient zero resize` | Before any valid resize, emit zero resize. Assert initial metrics (already zero) unchanged, no crash. |

### 6.4 `shieldLifecycle.test.tsx` (Modified)

| Test Case | Description |
|-----------|-------------|
| Existing boot+reload integration | Add `useResumeShield` to the combined hook harness. Verify no interference between boot, reload, and resume lifecycles. |

### 6.5 `App.test.tsx` (Modified)

| Test Case | Change |
|-----------|--------|
| Existing render test | Add mock for `useResumeShield`. Assert it is called once on mount. |

## 7. Sequence Diagram: Resume Shield Lifecycle

```
User switches tab / minimizes window
    │
    ▼
visibilitychange (hidden)
    │  hiddenSince = Date.now()
    │
    ... time passes ...
    │
visibilitychange (visible) / window focus
    │
    ├─ if (Date.now() - hiddenSince < RESUME_DEBOUNCE_MS) → SKIP
    ├─ if (shield already visible) → SKIP
    ├─ if (isResuming) → SKIP
    │
    ▼
revealBootShield(shield)        ← reuse existing function
    │
    ▼
poll areRequiredFontsReady()    ← 16ms interval, bounded by RESUME_SHIELD_TIMEOUT_MS
    │
    ▼
waitForStableFrames(3)          ← 3x requestAnimationFrame
    │
    ▼
hideBootShield(shield)          ← CSS transition fade-out
```

## 8. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Shield flicker on very fast tab-switch | Low | Low | `RESUME_DEBOUNCE_MS = 150` filters brief blips. |
| Shield visible too long on resume | Low | Med | `RESUME_SHIELD_TIMEOUT_MS = 2000` caps worst case. No min-visible time. |
| Font check race with boot | Low | Low | Resume checks `data-hmi-shield-state` before acting; if boot is running, resume is a no-op. |
| Stale metrics in `useCanvasReference` after legitimate container removal | Low | Low | Container with `display: none` correctly freezes at last valid size. Re-showing triggers new valid resize. |
| Google Fonts link (`Plus Jakarta Sans`, `Roboto Mono`) becomes dead weight | None | None | Out of scope for this change. Can be cleaned up separately if fonts are confirmed unused. |
