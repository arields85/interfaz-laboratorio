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
