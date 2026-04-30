# Design: Fix admin logout viewer transition flash

## Overview

This design addresses two visual regressions and one redundant navigation path:

1. **Resume shield regression**: `useResumeShield` re-reveals the boot shield on every tab focus/visibility/pageshow event, producing a visible black blink over live UI.
2. **Viewer malformed flash**: After admin logout (or any fresh viewer mount), `DashboardViewer` renders frame-dependent grid styles from zero metrics (`width=0, height=0, rowHeight=0`) until the first `ResizeObserver` callback fires.
3. **Redundant logout navigation**: `AdminLayout` calls both `logout()` and `navigate('/')`, but `RequirePermission` already redirects to `/` once auth is cleared.

Additionally, the boot shield's font-readiness gate uses hardcoded literal font strings instead of deriving them from the canonical `@theme` typography tokens.

---

## Module 1: Resume Shield Rollback

### Problem

`App.tsx:14` mounts `useResumeShield()` at root level. The hook (177 lines) listens to `visibilitychange`, `focus`, `blur`, and `pageshow` events, then calls `revealBootShield()` which removes the hidden class and opacity transition on `#hmi-shield` — producing a visible fade-in of a black overlay with loader text over an already-rendered UI.

### Design

**Remove `useResumeShield` from the runtime entirely.**

| File | Action |
|------|--------|
| `hmi-app/src/App.tsx` | Remove `useResumeShield` import and call (lines 10, 14) |
| `hmi-app/src/hooks/useResumeShield.ts` | Delete file |
| `hmi-app/src/hooks/useResumeShield.test.tsx` | Delete file |

**App.tsx after change:**
```tsx
import AppRouter from './app/router';
import { useBootShield } from './hooks/useBootShield';
import { useReloadShield } from './hooks/useReloadShield';

export default function App() {
    useBootShield();
    useReloadShield();

    return <AppRouter />;
}
```

### Rationale

The resume shield was introduced to mask potential visual corruption on tab restore, but it creates a worse regression: a deterministic black blink on every focus event. The approved #1088 boot/reload shield already covers cold start and keyboard reload. Any remaining tab-resume layout issues must be solved through layout stability (Module 3), not overlay masking.

### Risks

- If a real tab-resume visual glitch exists beyond the zero-metric flash, it will become visible. Mitigation: Module 3 ensures layout stability on fresh mount, which covers the primary scenario.

---

## Module 2: Canonical Boot Font Readiness

### Problem

`useBootShield.ts:22-26` hardcodes font check strings:
```ts
export const REQUIRED_FONT_CHECKS = [
    '400 11px "JetBrainsMono"',
    '400 10px "IBMPlexMono"',
    '400 48px "Magistral"',
];
```

These happen to match the current `@theme` tokens (`--font-system`, `--font-mono`, `--font-dashboard-title` with their corresponding `--font-weight-*` and `--font-size-*`), but they are decoupled copies. If a future admin font override or theme change updates the CSS tokens, the boot shield will gate on stale fonts.

### Design

**Replace the hardcoded array with a function that reads font check strings from CSS custom properties at runtime.**

New exported function in `useBootShield.ts`:

```ts
interface FontCheckToken {
    family: string;   // CSS var name: '--font-system'
    weight: string;   // CSS var name: '--font-weight-system'
    size: string;     // CSS var name: '--font-size-system'
}

const FONT_CHECK_TOKENS: FontCheckToken[] = [
    { family: '--font-system',          weight: '--font-weight-system',          size: '--font-size-system' },
    { family: '--font-mono',            weight: '--font-weight-mono',            size: '--font-size-mono' },
    { family: '--font-dashboard-title', weight: '--font-weight-dashboard-title', size: '--font-size-dashboard-title' },
];

function resolveFontCheckString(token: FontCheckToken): string | null {
    const style = document.documentElement
        ? getComputedStyle(document.documentElement)
        : null;

    if (!style) return null;

    const family = style.getPropertyValue(token.family).trim();
    const weight = style.getPropertyValue(token.weight).trim() || '400';
    const size   = style.getPropertyValue(token.size).trim()   || '16px';

    if (!family) return null;

    // Extract primary font family (before any fallback comma)
    const primaryFamily = family.split(',')[0].trim();

    return `${weight} ${size} ${primaryFamily}`;
}

export function getRequiredFontChecks(): string[] {
    return FONT_CHECK_TOKENS
        .map(resolveFontCheckString)
        .filter((s): s is string => s !== null);
}
```

**Changes to existing code:**

| Location | Change |
|----------|--------|
| `REQUIRED_FONT_CHECKS` constant (line 22-26) | Remove the exported constant |
| `areRequiredFontsReady()` (line 122-130) | Call `getRequiredFontChecks()` instead of referencing the constant |
| `waitForRequiredFonts()` (line 142-146) | No change needed — it calls `areRequiredFontsReady()` |

**Updated `areRequiredFontsReady`:**
```ts
export function areRequiredFontsReady(): boolean {
    const fonts = (document as FontsReadyDocument).fonts;

    if (!fonts?.check) {
        return true;
    }

    const checks = getRequiredFontChecks();

    if (checks.length === 0) {
        return true; // No tokens resolvable — don't block
    }

    return checks.every((font) => fonts.check?.(font) ?? true);
}
```

### Behavioral preservation

- The `BOOT_SHIELD_MIN_VISIBLE_MS` (1200ms), `BOOT_SHIELD_TIMEOUT_MS` (5000ms), `BOOT_SHIELD_STABLE_FRAME_COUNT` (4), and the entire boot/reload lifecycle remain **unchanged**.
- The font readiness gate resolves the same three font families as before when the default theme is active, so perceived loader timing is identical.
- The bounded timeout remains the safety net if `getComputedStyle` is unavailable or tokens resolve empty.

### Impact on useResumeShield removal

`useResumeShield.ts` imports `areRequiredFontsReady` from `useBootShield.ts`. Since Module 1 deletes `useResumeShield.ts` entirely, there is no import to update — the only remaining consumer is `useBootShield.ts` itself.

### Risks

- `getComputedStyle(document.documentElement)` during early boot (before CSS is parsed) could return empty values. Mitigation: `getRequiredFontChecks()` returns an empty array if no tokens resolve, and `areRequiredFontsReady()` treats that as ready (falls through to the existing timeout safety net).
- Repeated `getComputedStyle` calls during the polling loop (every 50ms up to 5s). Mitigation: `getComputedStyle` reads are cheap on modern browsers; the values are cached by the style engine. The polling frequency is unchanged from current behavior.

---

## Module 3: First-Valid Canvas Measurement Readiness

### Problem

`useCanvasReference.ts` initializes metrics at `width=0, height=0, rowHeight=0` (line 50-52, via `getInitialMetrics`). The `ResizeObserver` callback (line 86-104) correctly filters out invalid measurements (`width <= 0 || height <= 0`), but there is no signal to consumers about whether **any** valid measurement has ever been observed. Fresh mounts (like after admin logout) immediately render from zero metrics.

### Design

**Add a `hasFirstValidMeasurement` boolean to the hook's return value and internal state.**

**Interface changes:**

```ts
export interface UseCanvasReferenceResult extends CanvasReferenceMetrics {
    containerRef: RefObject<HTMLDivElement | null>;
    hasFirstValidMeasurement: boolean;  // NEW
}
```

**Implementation changes in `useCanvasReference.ts`:**

```ts
export function useCanvasReference(options: UseCanvasReferenceOptions = {}): UseCanvasReferenceResult {
    const { cols = DEFAULT_COLS, rows = DEFAULT_ROWS } = options;

    const containerRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<number | null>(null);
    const hasReceivedValidRef = useRef(false);             // NEW — stable across renders
    const [metrics, setMetrics] = useState<CanvasReferenceMetrics>(() => getInitialMetrics(cols, rows));
    const [hasFirstValidMeasurement, setHasFirstValidMeasurement] = useState(false); // NEW

    useEffect(() => {
        const cancelScheduledFrame = () => { /* unchanged */ };

        const scheduleMetricsUpdate = (nextMetrics: CanvasReferenceMetrics) => {
            cancelScheduledFrame();
            frameRef.current = requestAnimationFrame(() => {
                if (!hasReceivedValidRef.current) {        // NEW
                    hasReceivedValidRef.current = true;    // NEW
                    setHasFirstValidMeasurement(true);     // NEW
                }                                          // NEW
                setMetrics(nextMetrics);
                frameRef.current = null;
            });
        };

        // ... rest unchanged (ResizeObserver setup, cleanup)
    }, [cols, rows]);

    return {
        containerRef,
        hasFirstValidMeasurement,  // NEW
        ...metrics,
    };
}
```

**Key design decisions:**

1. **Ref + state dual tracking**: `hasReceivedValidRef` is a ref so the `ResizeObserver` callback closure doesn't need the boolean in its dependency array. `hasFirstValidMeasurement` is state so consumers re-render when it transitions `false → true`.
2. **One-way latch**: Once `true`, it never reverts to `false`. This is intentional — the "first valid" signal means "this hook instance has received at least one usable measurement." Transient zero-measurements after that are already handled by the existing invalid-measurement filter.
3. **No new timers or observers**: The signal piggybacks on the existing `ResizeObserver` → `requestAnimationFrame` → `setMetrics` pipeline. No additional scheduling overhead.

### Existing last-valid guard

The current `ResizeObserver` callback (line 92-93) already skips invalid measurements, which means after the first valid one, consumers keep the last valid metrics during transient collapses. This design **preserves that guard exactly as-is**. The new `hasFirstValidMeasurement` only tells consumers whether to trust the metrics for initial render.

---

## Module 4: Neutral Shell Before First Measurement

### Problem

`DashboardViewer.tsx` (and `BuilderCanvas.tsx`) immediately render frame-dependent grid styles from metrics, including `gridTemplateRows: repeat(N, 0px)` and `width: 0px` when no valid measurement exists yet. This produces a collapsed/malformed layout flash visible to the user.

### Design

**Gate the frame-dependent grid render on `hasFirstValidMeasurement`. Show a neutral, non-malformed shell until metrics are valid.**

**DashboardViewer.tsx changes:**

```tsx
export default function DashboardViewer({ /* props unchanged */ }: DashboardViewerProps) {
    const { containerRef, width, height, rowHeight, hasFirstValidMeasurement } = useCanvasReference({
        cols,
        rows,
    });

    const widgetMap = new Map(widgets.map(w => [w.id, w]));

    return (
        <div
            ref={containerRef}
            data-testid="dashboard-viewer-root"
            className="flex h-full w-full items-center justify-center overflow-hidden"
        >
            {hasFirstValidMeasurement ? (
                <div
                    data-testid="dashboard-viewer-frame"
                    className="grid shrink-0"
                    style={{
                        ...getGridTemplateStyle(cols),
                        gridTemplateRows: `repeat(${rows}, ${rowHeight}px)`,
                        width: `${width}px`,
                        height: `${height}px`,
                        gap: 0,
                    }}
                >
                    {layout.map((item) => {
                        if (headerWidgetIds?.has(item.widgetId)) return null;
                        const widget = widgetMap.get(item.widgetId);
                        if (!widget) return null;
                        return (
                            <div key={widget.id} /* ...existing props... */ >
                                {/* ...existing widget render... */}
                            </div>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
```

**Why `null` and not a loading spinner:**
The outer `<div ref={containerRef}>` with `flex h-full w-full items-center justify-center overflow-hidden` is already a neutral, visually empty container matching the app background. During boot, the `#hmi-shield` overlay is still visible (covering everything). During admin logout transition, the brief empty container is preferable to a collapsed grid with zero-height rows. No spinner or skeleton is needed — the container simply has no visible children until metrics arrive (typically one `requestAnimationFrame` after mount).

**BuilderCanvas.tsx:**
The same pattern applies. `BuilderCanvas` already uses `useCanvasReference` at line 178. The frame-dependent grid section (the `<div className="grid ...">` with computed styles) should be gated on `hasFirstValidMeasurement`. The builder's empty state (`AdminEmptyState`) and selection overlays can still render outside the gate since they don't depend on pixel metrics.

However, BuilderCanvas is admin-only and the admin layout always mounts with a measured container. The malformed flash is primarily a viewer problem (logout transition). BuilderCanvas changes are **recommended but lower priority** — they can be included in the same PR or deferred.

---

## Module 5: Admin Logout Navigation Cleanup

### Problem

`AdminLayout.tsx:73-76`:
```tsx
onClick={() => {
    logout();
    navigate('/');
}}
```

`RequirePermission.tsx:21-25` already handles the redirect:
```tsx
if (session.isAuthenticated && hasPermission) {
    return <>{children}</>;
}
return <Navigate to={redirectTo ?? '/'} replace />;
```

When `logout()` clears auth state, `RequirePermission` (which wraps the `/admin` route) will re-render and emit `<Navigate to="/" replace />`. The explicit `navigate('/')` in `AdminLayout` is redundant and causes a double navigation — first the imperative `navigate`, then the declarative `<Navigate>`.

### Design

**Remove the `navigate('/')` call. Keep only `logout()`.**

```tsx
onClick={() => {
    logout();
}}
```

Also remove the unused `useNavigate` import and `navigate` variable if no other code in `AdminLayout` uses them.

| Line | Change |
|------|--------|
| 2 | Remove `useNavigate` from import if unused elsewhere |
| 20 | Remove `const navigate = useNavigate();` if unused elsewhere |
| 73-76 | Simplify to `onClick={() => { logout(); }}` |

**Verification**: Grep `AdminLayout.tsx` for other uses of `navigate` — if the only usage is the logout button, remove the import entirely.

---

## Module 6: Test Plan

### Strict TDD is active. Tests must be written before implementation for each module.

### Tests to DELETE

| File | Reason |
|------|--------|
| `hmi-app/src/hooks/useResumeShield.test.tsx` | Module being removed entirely |

### Tests to MODIFY

#### `useBootShield.test.tsx`

| Test | Change |
|------|--------|
| Any test referencing `REQUIRED_FONT_CHECKS` constant | Update to use `getRequiredFontChecks()` function |
| Add: "resolves font checks from CSS custom properties" | Mock `getComputedStyle` to return theme token values, assert `getRequiredFontChecks()` produces correct `document.fonts.check()` strings |
| Add: "returns empty array when getComputedStyle is unavailable" | Assert `getRequiredFontChecks()` returns `[]` when `document.documentElement` is null or `getComputedStyle` throws |
| Add: "areRequiredFontsReady returns true when no tokens resolve" | Assert no-block behavior when CSS tokens are missing |

#### `useCanvasReference.test.tsx`

| Test | Change |
|------|--------|
| Add: "hasFirstValidMeasurement is false before any ResizeObserver callback" | Assert initial return has `hasFirstValidMeasurement: false` |
| Add: "hasFirstValidMeasurement becomes true after first valid measurement" | Trigger ResizeObserver with valid dimensions, assert transition to `true` |
| Add: "hasFirstValidMeasurement stays true after transient zero measurement" | After a valid measurement, trigger a zero-dimension callback, assert `hasFirstValidMeasurement` remains `true` |
| Add: "metrics retain last valid values during transient collapse" | Existing behavior — add explicit test if missing |

#### `DashboardViewer.test.tsx`

| Test | Change |
|------|--------|
| Add: "does not render frame element before first valid measurement" | Mock `useCanvasReference` to return `hasFirstValidMeasurement: false`, assert `dashboard-viewer-frame` is not in DOM |
| Add: "renders frame element after first valid measurement" | Mock `useCanvasReference` to return `hasFirstValidMeasurement: true` with valid metrics, assert `dashboard-viewer-frame` is present with correct styles |
| Existing render tests | May need to mock `hasFirstValidMeasurement: true` to pass |

#### `App.test.tsx` (if exists)

| Test | Change |
|------|--------|
| Any test asserting `useResumeShield` is called | Remove those assertions |

### Tests to ADD (new files)

None — all new test cases belong in existing test files.

---

## Dependency Order

```
Module 1 (resume shield rollback)     — independent
Module 2 (canonical font readiness)   — independent
Module 3 (canvas first-valid signal)  — independent
Module 4 (neutral shell)              — depends on Module 3
Module 5 (logout navigation cleanup)  — independent
```

Modules 1, 2, 3, and 5 can be implemented in parallel. Module 4 depends on Module 3's API change.

**Recommended implementation order for a single-threaded apply:**
1. Module 1 — smallest, removes code
2. Module 5 — smallest, removes code
3. Module 3 — API addition, no consumers change yet
4. Module 2 — refactor, no API change
5. Module 4 — consumer change, depends on Module 3

---

## Files Changed Summary

| File | Action | Module |
|------|--------|--------|
| `hmi-app/src/App.tsx` | Modify (remove resume shield) | 1 |
| `hmi-app/src/hooks/useResumeShield.ts` | Delete | 1 |
| `hmi-app/src/hooks/useResumeShield.test.tsx` | Delete | 1 |
| `hmi-app/src/hooks/useBootShield.ts` | Modify (canonical font resolution) | 2 |
| `hmi-app/src/hooks/useBootShield.test.tsx` | Modify (new font resolution tests) | 2 |
| `hmi-app/src/utils/useCanvasReference.ts` | Modify (add hasFirstValidMeasurement) | 3 |
| `hmi-app/src/utils/useCanvasReference.test.tsx` | Modify (new readiness tests) | 3 |
| `hmi-app/src/components/viewer/DashboardViewer.tsx` | Modify (gate on readiness) | 4 |
| `hmi-app/src/components/viewer/DashboardViewer.test.tsx` | Modify (new shell tests) | 4 |
| `hmi-app/src/components/admin/BuilderCanvas.tsx` | Modify (optional gate) | 4 |
| `hmi-app/src/layouts/AdminLayout.tsx` | Modify (remove navigate) | 5 |

---

## What This Design Does NOT Change

- Boot shield timing constants (`BOOT_SHIELD_MIN_VISIBLE_MS`, `BOOT_SHIELD_TIMEOUT_MS`, `BOOT_SHIELD_STABLE_FRAME_COUNT`)
- Boot shield DOM structure, typewriter loader, or transition behavior
- Reload shield (`useReloadShield`) behavior
- `#hmi-shield` CSS in `index.html`
- Widget rendering logic or widget-specific layout
- `RequirePermission` guard logic
- Any process-control behavior (HMI is read-only)
- Any `@theme` token values in `index.css`
