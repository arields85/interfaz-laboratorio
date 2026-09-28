import { isGroupWidget, type GroupWidgetConfig, type WidgetConfig, type WidgetLayout } from '../domain/admin.types';

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
 * `excludedWidgetIds` (G4) drops header-promoted widgets from candidacy: they
 * do not live on the canvas, so they can never become — or stay — members.
 */
export function computeGroupMembers(
    containerWidgetId: string,
    containerRect: LayoutRect,
    widgets: readonly WidgetConfig[],
    layout: readonly WidgetLayout[],
    excludedWidgetIds: ReadonlySet<string> = new Set(),
): string[] {
    const layoutByWidgetId = new Map(layout.map((item) => [item.widgetId, item]));
    const groupWidgetIds = new Set(widgets.filter(isGroupWidget).map((widget) => widget.id));

    return widgets
        .filter((widget) => (
            widget.id !== containerWidgetId
            && !groupWidgetIds.has(widget.id)
            && !excludedWidgetIds.has(widget.id)
        ))
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

/**
 * D5 delete: drops `removedWidgetId` from every locked group's `memberWidgetIds` that lists it
 * (the group stays locked with the rest of its members). Non-group widgets and groups that don't
 * list the id pass through unchanged.
 */
export function removeMemberFromGroups(widgets: readonly WidgetConfig[], removedWidgetId: string): WidgetConfig[] {
    return widgets.map((widget) => {
        if (!isGroupWidget(widget) || !widget.memberWidgetIds?.includes(removedWidgetId)) {
            return widget;
        }

        return {
            ...widget,
            memberWidgetIds: widget.memberWidgetIds.filter((id) => id !== removedWidgetId),
        };
    });
}

/** The locked group that currently lists `widgetId` as a sanitized member, or undefined. */
export function findOwningLockedGroup(
    widgetId: string,
    widgets: readonly WidgetConfig[],
): GroupWidgetConfig | undefined {
    return widgets
        .filter(isGroupWidget)
        .find((group) => group.locked === true && sanitizeGroupMemberIds(group.memberWidgetIds, group.id, widgets).includes(widgetId));
}

/**
 * D3 click priority (viewer): the navigation target a widget should actually navigate to — its
 * own `navigationTargetDashboardId` when set, otherwise (for a member of a currently locked
 * group) the group's target. Returns `undefined` when neither resolves to a non-empty target.
 */
export function resolveEffectiveNavigationTarget(
    widget: WidgetConfig,
    widgets: readonly WidgetConfig[],
): string | undefined {
    const own = widget.navigationTargetDashboardId?.trim();
    if (own) {
        return own;
    }

    const owningGroup = findOwningLockedGroup(widget.id, widgets);
    const inherited = owningGroup?.navigationTargetDashboardId?.trim();

    return inherited || undefined;
}

/**
 * G5 group hover: the id of the locked group that should show its hover look while the pointer
 * is over `widgetId` — the group's own id when `widgetId` is itself a locked container, or the
 * id of the locked group that owns it as a member. `undefined` when `widgetId` is not part of any
 * locked group (members and unrelated widgets keep only their own native hover).
 */
export function resolveHoveredGroupId(widgetId: string, widgets: readonly WidgetConfig[]): string | undefined {
    const widget = widgets.find((item) => item.id === widgetId);

    if (widget && isGroupWidget(widget) && widget.locked === true) {
        return widget.id;
    }

    return findOwningLockedGroup(widgetId, widgets)?.id;
}

/** One duplicated group: the appended widgets/layout (already merged with the originals) and the new container id to select. */
export interface GroupDuplicationResult {
    widgets: WidgetConfig[];
    layout: WidgetLayout[];
    newSelectedWidgetId: string;
}

/**
 * D5 copy: duplicating a LOCKED group duplicates the container and every one of its members as
 * one new, already-grouped copy — new ids throughout, `memberWidgetIds` remapped to the new
 * member ids, `locked: true`, stacking (container before members) preserved. The whole group
 * offsets the same way a single-widget duplicate does (`y += own height`), applied as one rigid
 * body and clamped to the grid like a group move (G3). `excludedWidgetIds` (defensive, mirrors
 * G4's membership exclusion) keeps a header-promoted id out of the copy even if it were still
 * listed. Returns `null` when `groupWidgetId` is not a currently locked group with a resolvable
 * container layout — callers duplicate an unlocked container or a plain member widget (including
 * one that happens to be a group member) through the regular single-widget duplicate path
 * instead, since D5 only special-cases a locked group's own copy.
 */
export function duplicateLockedGroup(
    groupWidgetId: string,
    widgets: readonly WidgetConfig[],
    layout: readonly WidgetLayout[],
    cols: number,
    rows: number,
    generateId: (type: string) => string,
    excludedWidgetIds: ReadonlySet<string> = new Set(),
): GroupDuplicationResult | null {
    const group = widgets.find((widget) => widget.id === groupWidgetId);
    if (!group || !isGroupWidget(group) || group.locked !== true) {
        return null;
    }

    const containerLayout = layout.find((item) => item.widgetId === groupWidgetId);
    if (!containerLayout) {
        return null;
    }

    const memberIds = sanitizeGroupMemberIds(group.memberWidgetIds, group.id, widgets)
        .filter((memberId) => !excludedWidgetIds.has(memberId));
    const members = memberIds
        .map((id) => {
            const widget = widgets.find((item) => item.id === id);
            const memberLayout = layout.find((item) => item.widgetId === id);
            return widget && memberLayout ? { widget, layout: memberLayout } : null;
        })
        .filter((entry): entry is { widget: WidgetConfig; layout: WidgetLayout } => entry !== null);

    const groupRects: LayoutRect[] = [containerLayout, ...members.map((member) => member.layout)];
    // Same offset a single-widget duplicate uses (y += own height), clamped as one rigid body.
    const { dx, dy } = clampGroupMoveDelta(groupRects, 0, containerLayout.h, cols, rows);

    const newContainerId = generateId(group.type);
    const idByOldMemberId = new Map(members.map((member) => [member.widget.id, generateId(member.widget.type)]));

    const newContainer: GroupWidgetConfig = {
        ...(JSON.parse(JSON.stringify(group)) as GroupWidgetConfig),
        id: newContainerId,
        title: group.title ? `${group.title} (Copia)` : undefined,
        locked: true,
        memberWidgetIds: members.map((member) => idByOldMemberId.get(member.widget.id) as string),
    };
    const newContainerLayout: WidgetLayout = {
        ...containerLayout,
        widgetId: newContainerId,
        x: containerLayout.x + dx,
        y: containerLayout.y + dy,
    };

    const newMembers: WidgetConfig[] = members.map((member) => ({
        ...(JSON.parse(JSON.stringify(member.widget)) as WidgetConfig),
        id: idByOldMemberId.get(member.widget.id) as string,
        title: member.widget.title ? `${member.widget.title} (Copia)` : undefined,
    }));
    const newMemberLayouts: WidgetLayout[] = members.map((member) => ({
        ...member.layout,
        widgetId: idByOldMemberId.get(member.widget.id) as string,
        x: member.layout.x + dx,
        y: member.layout.y + dy,
    }));

    return {
        widgets: reorderWidgetsWithGroupBeforeMembers(
            [...widgets, newContainer, ...newMembers],
            newContainerId,
            newContainer.memberWidgetIds ?? [],
        ),
        layout: [...layout, newContainerLayout, ...newMemberLayouts],
        newSelectedWidgetId: newContainerId,
    };
}
