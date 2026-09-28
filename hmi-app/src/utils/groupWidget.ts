import { isGroupWidget, type WidgetConfig, type WidgetLayout } from '../domain/admin.types';

// =============================================================================
// groupWidget — pure logic for the `group` container widget (builder-only).
//
// Every helper here is a pure function over plain rects/ids so it can be unit
// tested without React or the canvas pixel/pointer machinery. Callers
// (BuilderCanvas, DashboardBuilderPage, dashboardViews normalization/remap)
// pass in whatever slice of widgets/layout they already hold.
// =============================================================================

/** Minimal grid rect shape shared by `WidgetLayout` and container bounds. */
export interface LayoutRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Sanitizes a persisted/imported `memberWidgetIds` value. A non-array value
 * (malformed legacy or imported data) is treated as an empty member list; the
 * group's own id and the ids of any other group widget are always dropped —
 * a container is never a member of itself nor of another group (no nesting).
 */
export function sanitizeGroupMemberIds(
    memberWidgetIds: unknown,
    groupWidgetId: string,
    widgets: readonly WidgetConfig[],
): string[] {
    if (!Array.isArray(memberWidgetIds)) {
        return [];
    }

    const otherGroupWidgetIds = new Set(widgets.filter(isGroupWidget).map((widget) => widget.id));

    return memberWidgetIds.filter(
        (id): id is string => typeof id === 'string' && id !== groupWidgetId && !otherGroupWidgetIds.has(id),
    );
}

/** True when `inner` is completely contained within `outer` (D1 membership rule). */
export function isRectFullyInside(inner: LayoutRect, outer: LayoutRect): boolean {
    return inner.x >= outer.x
        && inner.y >= outer.y
        && inner.x + inner.w <= outer.x + outer.w
        && inner.y + inner.h <= outer.y + outer.h;
}

/**
 * D1 membership: widgets of the same view whose layout rect is completely
 * inside the container's rect at close time. Partially overlapping widgets
 * stay out; the container never includes itself or another group widget.
 */
export function computeGroupMembers(
    containerWidgetId: string,
    containerRect: LayoutRect,
    widgets: readonly WidgetConfig[],
    layout: readonly WidgetLayout[],
): string[] {
    const layoutByWidgetId = new Map(layout.map((item) => [item.widgetId, item]));
    const groupWidgetIds = new Set(widgets.filter(isGroupWidget).map((widget) => widget.id));

    return widgets
        .filter((widget) => widget.id !== containerWidgetId && !groupWidgetIds.has(widget.id))
        .filter((widget) => {
            const rect = layoutByWidgetId.get(widget.id);
            return rect !== undefined && isRectFullyInside(rect, containerRect);
        })
        .map((widget) => widget.id);
}

/**
 * Reorders `widgets` so the group widget precedes all of its members
 * (stacking = array/DOM order — see G1 note), while keeping the relative
 * order of every other widget stable. The group is placed right before the
 * earliest member index, which is enough to guarantee it precedes every
 * member since that index is the minimum among them.
 */
export function reorderWidgetsWithGroupBeforeMembers<T extends { id: string }>(
    widgets: readonly T[],
    groupWidgetId: string,
    memberWidgetIds: readonly string[],
): T[] {
    const groupIndex = widgets.findIndex((widget) => widget.id === groupWidgetId);

    if (groupIndex === -1 || memberWidgetIds.length === 0) {
        return [...widgets];
    }

    const memberIdSet = new Set(memberWidgetIds);
    const groupWidget = widgets[groupIndex];
    const rest = widgets.filter((widget) => widget.id !== groupWidgetId);
    const firstMemberIndex = rest.findIndex((widget) => memberIdSet.has(widget.id));

    if (firstMemberIndex === -1) {
        return [...widgets];
    }

    return [
        ...rest.slice(0, firstMemberIndex),
        groupWidget,
        ...rest.slice(firstMemberIndex),
    ];
}

/** Union bounding box of the given members' layout rects, or null if none resolve. */
export function computeMembersBoundingBox(
    memberWidgetIds: readonly string[],
    layout: readonly WidgetLayout[],
): LayoutRect | null {
    const rects = memberWidgetIds
        .map((id) => layout.find((item) => item.widgetId === id))
        .filter((item): item is WidgetLayout => item !== undefined);

    if (rects.length === 0) {
        return null;
    }

    const x = Math.min(...rects.map((rect) => rect.x));
    const y = Math.min(...rects.map((rect) => rect.y));
    const right = Math.max(...rects.map((rect) => rect.x + rect.w));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.h));

    return { x, y, w: right - x, h: bottom - y };
}

/**
 * Clamps a proposed move delta (in grid cells) so the whole group — every
 * rect in `rects` (container + members), each in its pre-move position —
 * stays within the [0, cols) x [0, rows) grid. The group moves as a rigid
 * body: a single shared delta is applied to every rect, or none at all.
 */
export function clampGroupMoveDelta(
    rects: readonly LayoutRect[],
    dx: number,
    dy: number,
    cols: number,
    rows: number,
): { dx: number; dy: number } {
    if (rects.length === 0) {
        return { dx: 0, dy: 0 };
    }

    const minX = Math.min(...rects.map((rect) => rect.x));
    const minY = Math.min(...rects.map((rect) => rect.y));
    const maxRight = Math.max(...rects.map((rect) => rect.x + rect.w));
    const maxBottom = Math.max(...rects.map((rect) => rect.y + rect.h));

    const clampedDx = Math.min(Math.max(dx, -minX), cols - maxRight);
    const clampedDy = Math.min(Math.max(dy, -minY), rows - maxBottom);

    // Normalize -0 (e.g. -Math.max(-10, -0)) to 0: same grid position, cleaner equality/output.
    return {
        dx: clampedDx === 0 ? 0 : clampedDx,
        dy: clampedDy === 0 ? 0 : clampedDy,
    };
}

/**
 * Clamps a tentative resize rect so it never gets smaller than the members'
 * bounding box and keeps containing it: grows the rect just enough to stay a
 * superset, on every edge that would otherwise cut into the bounding box.
 * Never shrinks below the tentative rect either — this only grows.
 */
export function clampGroupResizeToMembers(tentative: LayoutRect, membersBoundingBox: LayoutRect | null): LayoutRect {
    if (!membersBoundingBox) {
        return tentative;
    }

    const left = Math.min(tentative.x, membersBoundingBox.x);
    const top = Math.min(tentative.y, membersBoundingBox.y);
    const right = Math.max(tentative.x + tentative.w, membersBoundingBox.x + membersBoundingBox.w);
    const bottom = Math.max(tentative.y + tentative.h, membersBoundingBox.y + membersBoundingBox.h);

    return { x: left, y: top, w: right - left, h: bottom - top };
}
