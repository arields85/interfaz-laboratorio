import type { WidgetConfig } from '../domain/admin.types';
import { DEFAULT_DASHBOARD_VIEW_ID } from './dashboardViews';
import { findOwningLockedGroup } from './groupWidget';

// =============================================================================
// Viewer dashboard entrance
// Pure helpers behind the viewer entrance animation. The timings themselves
// live as CSS custom properties in `index.css` (`--viewer-entrance-*`); this
// module only decides WHO enters WHEN, as a unitless fraction of the random
// window (`--viewer-entrance-spread`), so tuning stays in one place.
// =============================================================================

/**
 * Replay key of the viewer grid: entering a dashboard or switching between its
 * views changes it (grid remounts, entrance replays); a data refresh does not.
 */
export function buildViewerEntranceKey(dashboardId: string, viewId: string | undefined): string {
    return `${dashboardId}:${viewId ?? DEFAULT_DASHBOARD_VIEW_ID}`;
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
    const result = [...items];

    for (let index = result.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1));
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }

    return result;
}

/**
 * Assigns each rendered widget a position in [0, 1] inside the entrance window.
 * The order is shuffled per call (random source injectable for determinism) and
 * the positions are evenly spread, so the stagger always fills the window.
 * A locked group container never enters later than any of its members.
 */
export function resolveViewerEntranceOrders(
    widgets: readonly WidgetConfig[],
    renderedWidgetIds: readonly string[],
    random: () => number = Math.random,
): Map<string, number> {
    const shuffled = shuffle(renderedWidgetIds, random);
    const lastIndex = shuffled.length - 1;
    const orders = new Map<string, number>(
        shuffled.map((widgetId, index) => [widgetId, lastIndex > 0 ? index / lastIndex : 0]),
    );

    // Group container before its members: pull the container forward to the
    // earliest member position when the shuffle put it later.
    for (const widgetId of renderedWidgetIds) {
        const group = findOwningLockedGroup(widgetId, widgets);
        const memberOrder = orders.get(widgetId);
        const groupOrder = group ? orders.get(group.id) : undefined;

        if (group && memberOrder !== undefined && groupOrder !== undefined && groupOrder > memberOrder) {
            orders.set(group.id, memberOrder);
        }
    }

    return orders;
}

/**
 * Orders for widgets that appear under an already-running entrance (same replay key): every widget
 * without an order gets a random position in [0, 1] from the injected source, and the existing
 * orders are never touched (no reshuffle, no replay of what is already on screen). A locked group
 * container added later is pulled to its earliest member. Returns the SAME map when nothing is new.
 */
export function extendViewerEntranceOrders(
    widgets: readonly WidgetConfig[],
    existingOrders: ReadonlyMap<string, number>,
    renderedWidgetIds: readonly string[],
    random: () => number = Math.random,
): Map<string, number> {
    const newIds = renderedWidgetIds.filter((widgetId) => !existingOrders.has(widgetId));

    if (newIds.length === 0) {
        return existingOrders as Map<string, number>;
    }

    const orders = new Map(existingOrders);
    for (const widgetId of newIds) {
        orders.set(widgetId, random());
    }

    for (const widgetId of renderedWidgetIds) {
        const group = findOwningLockedGroup(widgetId, widgets);
        const memberOrder = orders.get(widgetId);
        const groupOrder = group ? orders.get(group.id) : undefined;

        if (group && newIds.includes(group.id) && memberOrder !== undefined && groupOrder !== undefined && groupOrder > memberOrder) {
            orders.set(group.id, memberOrder);
        }
    }

    return orders;
}

// -----------------------------------------------------------------------------
// Count-up (numbers rising from zero on entrance)
// The timing has ONE source of truth: the same `--viewer-entrance-*` CSS tokens
// that drive the frame and gauge animations, read from the document root.
// -----------------------------------------------------------------------------

/** Control values `[x1, y1, x2, y2]` of a CSS `cubic-bezier()`. */
export type CubicBezier = readonly [number, number, number, number];

export interface ViewerEntranceCountUpTiming {
    /** Random window of the frame stagger (`--viewer-entrance-spread`). */
    spreadMs: number;
    /** Wait of a value after its frame starts (`--viewer-entrance-value-offset`). */
    offsetMs: number;
    /** Duration of the count (`--viewer-entrance-count-duration`). */
    durationMs: number;
    /** The shared entrance curve (`--viewer-entrance-ease`); `null` (linear) when it is not a cubic-bezier. */
    ease: CubicBezier | null;
}

/** Parses a CSS `<time>` (`700ms`, `0.9s`) into milliseconds; `null` when it is not one. */
export function parseCssTimeMs(raw: string): number | null {
    const match = raw.trim().match(/^(-?\d*\.?\d+)(ms|s)$/);

    if (!match) {
        return null;
    }

    const amount = Number(match[1]);
    return match[2] === 's' ? amount * 1000 : amount;
}

/** Parses a CSS `cubic-bezier(x1, y1, x2, y2)`; `null` for keywords or invalid values. */
export function parseCubicBezier(raw: string): CubicBezier | null {
    const match = raw.trim().match(/^cubic-bezier\(\s*([^,\s]+)\s*,\s*([^,\s]+)\s*,\s*([^,\s]+)\s*,\s*([^,\s)]+)\s*\)$/);

    if (!match) {
        return null;
    }

    const [x1, y1, x2, y2] = match.slice(1).map(Number);

    if ([x1, y1, x2, y2].some(Number.isNaN) || x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
        return null;
    }

    return [x1, y1, x2, y2];
}

function bezierCoordinate(a: number, b: number, s: number): number {
    const inverse = 1 - s;
    return 3 * inverse * inverse * s * a + 3 * inverse * s * s * b + s * s * s;
}

/**
 * Eased progress (`y`) of a CSS cubic-bezier at linear time `t` (0..1): solves `x(s) = t` by
 * bisection (x is monotonic for control x in 0..1) and evaluates `y(s)`. `null` curve = linear.
 */
export function resolveCubicBezierProgress(curve: CubicBezier | null, t: number): number {
    if (curve === null || t <= 0 || t >= 1) {
        return curve === null ? t : t <= 0 ? 0 : 1;
    }

    const [x1, y1, x2, y2] = curve;
    let low = 0;
    let high = 1;

    for (let iteration = 0; iteration < 32; iteration += 1) {
        const middle = (low + high) / 2;

        if (bezierCoordinate(x1, x2, middle) < t) {
            low = middle;
        } else {
            high = middle;
        }
    }

    return bezierCoordinate(y1, y2, (low + high) / 2);
}

/**
 * Reads the count-up timing from the entrance tokens. `null` (no count-up, value shown
 * directly) when a token is missing/unparsable or the duration is not positive.
 */
export function readViewerEntranceCountUpTiming(
    root: Element = document.documentElement,
): ViewerEntranceCountUpTiming | null {
    const style = getComputedStyle(root);
    const spreadMs = parseCssTimeMs(style.getPropertyValue('--viewer-entrance-spread'));
    const offsetMs = parseCssTimeMs(style.getPropertyValue('--viewer-entrance-value-offset'));
    const durationMs = parseCssTimeMs(style.getPropertyValue('--viewer-entrance-count-duration'));
    const ease = parseCubicBezier(style.getPropertyValue('--viewer-entrance-ease'));

    if (spreadMs === null || offsetMs === null || durationMs === null || durationMs <= 0) {
        return null;
    }

    return { spreadMs, offsetMs, durationMs, ease };
}

/** Delay from the grid mount to the count start: the item delay plus the value offset (same as the gauges). */
export function resolveCountUpStartOffsetMs(order: number, timing: ViewerEntranceCountUpTiming): number {
    return timing.spreadMs * order + timing.offsetMs;
}

/** Number of decimals a value is displayed with (exponent notation counts as an integer). */
export function countFractionDigits(value: number): number {
    const text = String(value);

    if (text.includes('e')) {
        return 0;
    }

    const dot = text.indexOf('.');
    return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * Value shown at `progress` (0..1) of a count-up towards `target`. Intermediate values are
 * rounded to the target's own decimals so the widget's formatting never changes mid-count; at
 * completion the untouched target is returned, so the final text is exactly today's.
 */
export function resolveViewerCountUpValue(target: number, progress: number, fractionDigits: number): number {
    if (progress >= 1) {
        return target;
    }

    if (progress <= 0) {
        return 0;
    }

    return Number((target * progress).toFixed(fractionDigits));
}
