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
 * A repeated id (also malformed/imported data — see `duplicateLockedGroup`'s
 * doc comment, G8) is kept only on its first occurrence: every other caller
 * (`normalizeWidget`, `duplicateLockedGroup`, the view-duplication remap,
 * `findOwningLockedGroup`) treats this as the single point of truth for a
 * group's membership, so deduplicating here is what keeps a duplicated
 * member id from ever producing more than one copy of that member.
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
    const seenMemberIds = new Set<string>();

    return memberWidgetIds.filter((id): id is string => {
        if (typeof id !== 'string' || id === groupWidgetId || otherGroupWidgetIds.has(id)) {
            return false;
        }
        if (seenMemberIds.has(id)) {
            return false;
        }
        seenMemberIds.add(id);
        return true;
    });
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
 * G7(b): render order for any list of items keyed by `widgetId` (a `WidgetLayout[]`, most
 * commonly) — every group-widget item comes first, in its original relative order, followed by
 * every other item, also in its original relative order. This is the single source of truth for
 * stacking: a group container ALWAYS paints beneath every non-group widget, locked or not,
 * independent of `widgets`/`layout` array order or drag/authoring history. Every renderer of the
 * dashboard grid (BuilderCanvas, DashboardViewer) must derive its render/DOM order from this
 * helper instead of using `layout` (or `widgets`) order directly, and pointer hit-testing follows
 * the same DOM order for free (later siblings paint — and receive pointer events — on top).
 */
export function orderRenderItemsWithGroupsFirst<T extends { widgetId: string }>(
    items: readonly T[],
    widgets: readonly WidgetConfig[],
): T[] {
    const groupWidgetIds = new Set(widgets.filter(isGroupWidget).map((widget) => widget.id));

    const groupItems = items.filter((item) => groupWidgetIds.has(item.widgetId));
    const otherItems = items.filter((item) => !groupWidgetIds.has(item.widgetId));

    return [...groupItems, ...otherItems];
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

/**
 * G5b (R3-group-double-membership): union of every OTHER currently locked group's sanitized
 * member ids. Used to exclude a widget from candidacy when locking a NEW container: a widget
 * belongs to at most one locked group, so one already claimed by a different locked group can
 * never become a member of this one, even if it now sits fully inside its bounds.
 */
export function collectWidgetIdsInOtherLockedGroups(
    widgets: readonly WidgetConfig[],
    excludeGroupId: string,
): Set<string> {
    const ids = new Set<string>();

    widgets
        .filter(isGroupWidget)
        .filter((group) => group.id !== excludeGroupId && group.locked === true)
        .forEach((group) => {
            sanitizeGroupMemberIds(group.memberWidgetIds, group.id, widgets).forEach((id) => ids.add(id));
        });

    return ids;
}

/**
 * G5b (R3-group-double-membership): resolves cross-group duplicate membership already present in
 * `widgets` — a widget belongs to at most one LOCKED group. When the same id is listed by more
 * than one currently locked group, it is kept only in the first one encountered in `widgets`
 * order (deterministic); every later locked group drops it. Used on read (normalize/load/import),
 * where malformed or hand-edited data could otherwise list the same member under two groups. An
 * unlocked group's `memberWidgetIds` is left untouched and never claims a member: D1 already
 * empties it on unlock, so a stale/malformed one here is not an authoritative owner and must
 * never block a locked group from a member it legitimately has.
 */
export function sanitizeGroupMembershipAcrossWidgets(widgets: readonly WidgetConfig[]): WidgetConfig[] {
    const claimedWidgetIds = new Set<string>();

    return widgets.map((widget) => {
        if (!isGroupWidget(widget) || widget.locked !== true) {
            return widget;
        }

        const memberWidgetIds = (widget.memberWidgetIds ?? []).filter((id) => !claimedWidgetIds.has(id));
        memberWidgetIds.forEach((id) => claimedWidgetIds.add(id));

        return { ...widget, memberWidgetIds };
    });
}

/**
 * D6: while a locked group is NOT in edit mode, it acts as ONE widget — a pointer interaction
 * (select or drag) that starts on any of its members must actually target the CONTAINER instead.
 * Resolves the id BuilderCanvas should treat as the interaction target for `widgetId`: the id of
 * the locked group that owns it as a member, UNLESS that group is the one currently in edit mode
 * (`editingGroupId`), in which case the member is interacted with individually — or `widgetId`
 * itself for anything else (a plain widget, or a group container, which is always its own target).
 */
export function resolveEffectiveInteractionTarget(
    widgetId: string,
    widgets: readonly WidgetConfig[],
    editingGroupId: string | undefined,
): string {
    const owningGroup = findOwningLockedGroup(widgetId, widgets);

    if (!owningGroup || owningGroup.id === editingGroupId) {
        return widgetId;
    }

    return owningGroup.id;
}

/**
 * D6 pencil edit mode: clamps `rect` so it stays fully inside `container` — shrinking it first if
 * it is wider/taller than the container, then repositioning it so neither edge crosses the
 * container's bounds. Used to keep an individually moved/resized group member inside its locked
 * container while the group is being edited.
 */
export function clampRectInsideContainer(rect: LayoutRect, container: LayoutRect): LayoutRect {
    const w = Math.min(rect.w, container.w);
    const h = Math.min(rect.h, container.h);
    const x = Math.min(Math.max(rect.x, container.x), container.x + container.w - w);
    const y = Math.min(Math.max(rect.y, container.y), container.y + container.h - h);

    return { x, y, w, h };
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
        // The new container is appended right before its new members, which already stacks it
        // beneath them in `widgets` order; actual render/stacking order is independently owned by
        // `orderRenderItemsWithGroupsFirst` (G7b), so no extra reordering is needed here.
        widgets: [...widgets, newContainer, ...newMembers],
        layout: [...layout, newContainerLayout, ...newMemberLayouts],
        newSelectedWidgetId: newContainerId,
    };
}

/**
 * G9 grid snap: CSS padding for a widget's grid-cell "surface" wrapper — the div both
 * `BuilderCanvas` and `DashboardViewer` wrap every grid item in. Every other widget keeps
 * `--widget-spacing` there as the breathing gutter between its own card and the grid lines (the
 * raw grid-cell boundary, which is also where the builder's dashed guides sit — the CSS grid
 * itself has no gap of its own). A group container renders with none of it, so its frame sits
 * exactly on the grid lines instead of stopping short like a normal widget. A member placed inside
 * the container still keeps its own `--widget-spacing` inset, so its frame never coincides with or
 * overlaps the container's — the container simply reaches all the way out to the shared grid line.
 */
export function resolveWidgetSurfaceInset(widget: WidgetConfig): string {
    return isGroupWidget(widget) ? '0px' : 'var(--widget-spacing)';
}
