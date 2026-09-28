import { describe, expect, it } from 'vitest';
import {
    clampGroupMoveDelta,
    clampGroupResizeToMembers,
    clampRectInsideContainer,
    clampResizeRectInsideContainer,
    collectWidgetIdsInOtherLockedGroups,
    computeGroupMembers,
    computeMembersBoundingBox,
    duplicateLockedGroup,
    isRectFullyInside,
    orderRenderItemsWithGroupsFirst,
    removeMemberFromGroups,
    resolveEffectiveInteractionTarget,
    resolveEffectiveNavigationTarget,
    resolveExistingGroupMemberIds,
    resolveHoveredGroupId,
    resolveWidgetSurfaceInset,
    sanitizeGroupMemberIds,
    sanitizeGroupMembershipAcrossWidgets,
} from './groupWidget';
import type { GroupWidgetConfig, WidgetConfig, WidgetLayout } from '../domain/admin.types';

function makeGroup(overrides: Partial<GroupWidgetConfig> = {}): GroupWidgetConfig {
    return {
        id: 'group-1',
        type: 'group',
        title: 'Contenedor',
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        memberWidgetIds: [],
        locked: false,
        displayOptions: {},
        ...overrides,
    };
}

function makeWidget(overrides: Partial<WidgetConfig> & { id: string }): WidgetConfig {
    return {
        type: 'metric-card',
        title: overrides.id,
        position: { x: 0, y: 0 },
        size: { w: 2, h: 2 },
        ...overrides,
    } as WidgetConfig;
}

function makeLayout(overrides: Partial<WidgetLayout> & { widgetId: string }): WidgetLayout {
    return { x: 0, y: 0, w: 2, h: 2, ...overrides };
}

describe('sanitizeGroupMemberIds', () => {
    it('treats a non-array value as an empty member list', () => {
        expect(sanitizeGroupMemberIds(undefined, 'group-1', [])).toEqual([]);
        expect(sanitizeGroupMemberIds('widget-1' as unknown, 'group-1', [])).toEqual([]);
        expect(sanitizeGroupMemberIds({ length: 1 } as unknown, 'group-1', [])).toEqual([]);
    });

    it('drops the group own id from its member list', () => {
        const widgets = [makeGroup({ id: 'group-1' }), makeWidget({ id: 'widget-1' })];
        expect(sanitizeGroupMemberIds(['group-1', 'widget-1'], 'group-1', widgets)).toEqual(['widget-1']);
    });

    it('drops ids that belong to other group widgets (no nesting)', () => {
        const widgets = [makeGroup({ id: 'group-1' }), makeGroup({ id: 'group-2' }), makeWidget({ id: 'widget-1' })];
        expect(sanitizeGroupMemberIds(['group-2', 'widget-1'], 'group-1', widgets)).toEqual(['widget-1']);
    });

    it('drops non-string entries', () => {
        const widgets = [makeGroup({ id: 'group-1' }), makeWidget({ id: 'widget-1' })];
        expect(sanitizeGroupMemberIds(['widget-1', 42, null], 'group-1', widgets)).toEqual(['widget-1']);
    });

    // G8: a malformed/imported member list (e.g. propagated through view duplication or a
    // hand-edited export) can repeat the same id; a repeated id must resolve to exactly one
    // membership entry, otherwise a locked-group copy duplicates that member several times
    // (`duplicateLockedGroup` maps one new id per member — a repeated old id would otherwise
    // produce several widget/layout entries all sharing that single new id).
    it('deduplicates a repeated member id, keeping only its first occurrence', () => {
        const widgets = [makeGroup({ id: 'group-1' }), makeWidget({ id: 'widget-1' }), makeWidget({ id: 'widget-2' })];
        expect(sanitizeGroupMemberIds(['widget-1', 'widget-2', 'widget-1'], 'group-1', widgets)).toEqual(['widget-1', 'widget-2']);
    });
});

describe('resolveExistingGroupMemberIds (G9 review fix: R3-delete-count-includes-dangling-ids)', () => {
    it('drops a dangling member id that no longer resolves to a widget', () => {
        const group = makeGroup({ id: 'group-1', memberWidgetIds: ['widget-1', 'ghost-id'] });
        const widgets = [group, makeWidget({ id: 'widget-1' })];

        expect(resolveExistingGroupMemberIds(group, widgets)).toEqual(['widget-1']);
    });

    it('returns every member id when all of them resolve to an existing widget', () => {
        const group = makeGroup({ id: 'group-1', memberWidgetIds: ['widget-1', 'widget-2'] });
        const widgets = [group, makeWidget({ id: 'widget-1' }), makeWidget({ id: 'widget-2' })];

        expect(resolveExistingGroupMemberIds(group, widgets)).toEqual(['widget-1', 'widget-2']);
    });

    it('still applies the usual sanitation (non-array, self-id, other-group-id, dedupe)', () => {
        const otherGroup = makeGroup({ id: 'group-2' });
        const group = makeGroup({
            id: 'group-1',
            memberWidgetIds: ['group-1', 'group-2', 'widget-1', 'widget-1'] as unknown as string[],
        });
        const widgets = [group, otherGroup, makeWidget({ id: 'widget-1' })];

        expect(resolveExistingGroupMemberIds(group, widgets)).toEqual(['widget-1']);
    });

    it('returns an empty list for a non-array memberWidgetIds', () => {
        const group = makeGroup({ id: 'group-1', memberWidgetIds: undefined });

        expect(resolveExistingGroupMemberIds(group, [group])).toEqual([]);
    });
});

describe('isRectFullyInside', () => {
    it('is true when the inner rect is completely inside the outer rect', () => {
        expect(isRectFullyInside({ x: 1, y: 1, w: 2, h: 2 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(true);
    });

    it('is true when the inner rect exactly matches the outer rect', () => {
        expect(isRectFullyInside({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(true);
    });

    it('is false when the inner rect partially overlaps the outer rect', () => {
        expect(isRectFullyInside({ x: 8, y: 8, w: 5, h: 5 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(false);
    });

    it('is false when the inner rect is entirely outside the outer rect', () => {
        expect(isRectFullyInside({ x: 20, y: 20, w: 2, h: 2 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(false);
    });
});

describe('computeGroupMembers', () => {
    it('collects only widgets whose layout is completely inside the container rect', () => {
        const widgets = [
            makeGroup({ id: 'group-1' }),
            makeWidget({ id: 'inside' }),
            makeWidget({ id: 'partial' }),
            makeWidget({ id: 'outside' }),
        ];
        const layout = [
            makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 }),
            makeLayout({ widgetId: 'inside', x: 1, y: 1, w: 2, h: 2 }),
            makeLayout({ widgetId: 'partial', x: 8, y: 8, w: 5, h: 5 }),
            makeLayout({ widgetId: 'outside', x: 20, y: 20, w: 2, h: 2 }),
        ];

        expect(computeGroupMembers('group-1', layout[0], widgets, layout)).toEqual(['inside']);
    });

    it('never includes the container itself', () => {
        const widgets = [makeGroup({ id: 'group-1' })];
        const layout = [makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 })];

        expect(computeGroupMembers('group-1', layout[0], widgets, layout)).toEqual([]);
    });

    it('never includes another group widget, even if fully inside', () => {
        const widgets = [
            makeGroup({ id: 'group-1' }),
            makeGroup({ id: 'group-2' }),
        ];
        const layout = [
            makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 }),
            makeLayout({ widgetId: 'group-2', x: 1, y: 1, w: 2, h: 2 }),
        ];

        expect(computeGroupMembers('group-1', layout[0], widgets, layout)).toEqual([]);
    });

    it('excludes header-promoted widgets even if fully inside (G4: they never live on the canvas)', () => {
        const widgets = [
            makeGroup({ id: 'group-1' }),
            makeWidget({ id: 'inside' }),
            makeWidget({ id: 'header-widget' }),
        ];
        const layout = [
            makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 }),
            makeLayout({ widgetId: 'inside', x: 1, y: 1, w: 2, h: 2 }),
            makeLayout({ widgetId: 'header-widget', x: 3, y: 3, w: 2, h: 2 }),
        ];

        expect(computeGroupMembers('group-1', layout[0], widgets, layout, new Set(['header-widget']))).toEqual(['inside']);
    });
});

describe('orderRenderItemsWithGroupsFirst', () => {
    it('moves every group-widget item before every other item, regardless of the input order', () => {
        const widgets = [
            makeWidget({ id: 'a' }),
            makeWidget({ id: 'b' }),
            makeGroup({ id: 'group-1' }),
            makeWidget({ id: 'c' }),
        ];
        const items = [
            { widgetId: 'a' }, { widgetId: 'b' }, { widgetId: 'group-1' }, { widgetId: 'c' },
        ];

        const result = orderRenderItemsWithGroupsFirst(items, widgets);

        expect(result.map((item) => item.widgetId)).toEqual(['group-1', 'a', 'b', 'c']);
    });

    it('keeps a group first even when it is authored/laid out AFTER its members (G7 stacking bug)', () => {
        const widgets = [
            makeWidget({ id: 'member-1' }),
            makeWidget({ id: 'member-2' }),
            makeGroup({ id: 'group-1' }),
        ];
        // The container's layout entry is LAST — this is exactly the shape that reproduced the
        // "container always paints on top" bug, since the array/DOM order used to be `layout`
        // order untouched.
        const items = [
            { widgetId: 'member-1' }, { widgetId: 'member-2' }, { widgetId: 'group-1' },
        ];

        const result = orderRenderItemsWithGroupsFirst(items, widgets);

        expect(result.map((item) => item.widgetId)).toEqual(['group-1', 'member-1', 'member-2']);
    });

    it('preserves the relative order within each partition (groups, then everything else)', () => {
        const widgets = [
            makeGroup({ id: 'group-a' }),
            makeGroup({ id: 'group-b' }),
            makeWidget({ id: 'x' }),
            makeWidget({ id: 'y' }),
        ];
        const items = [
            { widgetId: 'y' }, { widgetId: 'group-b' }, { widgetId: 'x' }, { widgetId: 'group-a' },
        ];

        const result = orderRenderItemsWithGroupsFirst(items, widgets);

        expect(result.map((item) => item.widgetId)).toEqual(['group-b', 'group-a', 'y', 'x']);
    });

    it('applies the rule regardless of the group container being locked or unlocked', () => {
        const widgets = [
            makeWidget({ id: 'widget-1' }),
            makeGroup({ id: 'group-1', locked: false }),
        ];
        const items = [{ widgetId: 'widget-1' }, { widgetId: 'group-1' }];

        expect(orderRenderItemsWithGroupsFirst(items, widgets).map((item) => item.widgetId))
            .toEqual(['group-1', 'widget-1']);
    });

    it('is a no-op when there are no group widgets', () => {
        const widgets = [makeWidget({ id: 'a' }), makeWidget({ id: 'b' })];
        const items = [{ widgetId: 'b' }, { widgetId: 'a' }];

        expect(orderRenderItemsWithGroupsFirst(items, widgets).map((item) => item.widgetId))
            .toEqual(['b', 'a']);
    });

    it('does not mutate the input array', () => {
        const widgets = [makeWidget({ id: 'a' }), makeGroup({ id: 'group-1' })];
        const items = [{ widgetId: 'a' }, { widgetId: 'group-1' }];

        orderRenderItemsWithGroupsFirst(items, widgets);

        expect(items.map((item) => item.widgetId)).toEqual(['a', 'group-1']);
    });
});

describe('computeMembersBoundingBox', () => {
    it('returns the union rect of every member layout', () => {
        const layout = [
            makeLayout({ widgetId: 'member-1', x: 2, y: 3, w: 2, h: 2 }),
            makeLayout({ widgetId: 'member-2', x: 5, y: 1, w: 3, h: 4 }),
        ];

        expect(computeMembersBoundingBox(['member-1', 'member-2'], layout)).toEqual({ x: 2, y: 1, w: 6, h: 4 });
    });

    it('returns null when there are no resolvable members', () => {
        expect(computeMembersBoundingBox([], [])).toBeNull();
        expect(computeMembersBoundingBox(['missing'], [])).toBeNull();
    });
});

describe('clampGroupMoveDelta', () => {
    const rects = [
        { x: 0, y: 0, w: 10, h: 10 }, // container
        { x: 1, y: 1, w: 2, h: 2 },   // member
    ];

    it('keeps the delta unchanged when the whole group stays in bounds', () => {
        expect(clampGroupMoveDelta(rects, 5, 3, 40, 24)).toEqual({ dx: 5, dy: 3 });
    });

    it('clamps a negative delta so the group does not cross the left/top edge', () => {
        expect(clampGroupMoveDelta(rects, -10, -10, 40, 24)).toEqual({ dx: 0, dy: 0 });
    });

    it('clamps a positive delta so the group does not cross the right/bottom edge', () => {
        expect(clampGroupMoveDelta(rects, 100, 100, 40, 24)).toEqual({ dx: 30, dy: 14 });
    });

    it('returns a zero delta for an empty group', () => {
        expect(clampGroupMoveDelta([], 5, 5, 40, 24)).toEqual({ dx: 0, dy: 0 });
    });
});

describe('clampGroupResizeToMembers', () => {
    it('returns the tentative rect unchanged when it already contains the members bounding box', () => {
        const tentative = { x: 0, y: 0, w: 10, h: 10 };
        const bbox = { x: 1, y: 1, w: 2, h: 2 };

        expect(clampGroupResizeToMembers(tentative, bbox)).toEqual(tentative);
    });

    it('grows the tentative rect to stay a superset of the members bounding box', () => {
        const tentative = { x: 0, y: 0, w: 3, h: 3 };
        const bbox = { x: 1, y: 1, w: 5, h: 5 };

        expect(clampGroupResizeToMembers(tentative, bbox)).toEqual({ x: 0, y: 0, w: 6, h: 6 });
    });

    it('passes through the tentative rect when there is no bounding box', () => {
        const tentative = { x: 0, y: 0, w: 3, h: 3 };

        expect(clampGroupResizeToMembers(tentative, null)).toEqual(tentative);
    });
});

describe('removeMemberFromGroups', () => {
    it('drops the id from every locked group that lists it as a member', () => {
        const widgets = [
            makeGroup({ id: 'group-1', locked: true, memberWidgetIds: ['widget-1', 'widget-2'] }),
            makeWidget({ id: 'widget-1' }),
            makeWidget({ id: 'widget-2' }),
        ];

        const result = removeMemberFromGroups(widgets, 'widget-1');
        const group = result.find((widget) => widget.id === 'group-1') as GroupWidgetConfig;

        expect(group.memberWidgetIds).toEqual(['widget-2']);
    });

    it('is a no-op when no group lists the id', () => {
        const widgets = [
            makeGroup({ id: 'group-1', locked: true, memberWidgetIds: ['widget-2'] }),
            makeWidget({ id: 'widget-1' }),
        ];

        const result = removeMemberFromGroups(widgets, 'widget-1');

        expect(result).toEqual(widgets);
    });

    it('leaves non-group widgets untouched', () => {
        const widgets = [makeWidget({ id: 'widget-1' })];

        expect(removeMemberFromGroups(widgets, 'widget-1')).toEqual(widgets);
    });
});

describe('collectWidgetIdsInOtherLockedGroups', () => {
    it('collects the sanitized members of every OTHER currently locked group', () => {
        const widgets = [
            makeGroup({ id: 'group-1', locked: true, memberWidgetIds: ['widget-1'] }),
            makeGroup({ id: 'group-2', locked: true, memberWidgetIds: ['widget-2'] }),
            makeWidget({ id: 'widget-1' }),
            makeWidget({ id: 'widget-2' }),
        ];

        expect(collectWidgetIdsInOtherLockedGroups(widgets, 'group-2')).toEqual(new Set(['widget-1']));
    });

    it('ignores unlocked groups', () => {
        const widgets = [
            makeGroup({ id: 'group-1', locked: false, memberWidgetIds: ['widget-1'] }),
            makeGroup({ id: 'group-2', locked: true, memberWidgetIds: [] }),
            makeWidget({ id: 'widget-1' }),
        ];

        expect(collectWidgetIdsInOtherLockedGroups(widgets, 'group-2')).toEqual(new Set());
    });

    it('excludes the group itself even if locked', () => {
        const widgets = [
            makeGroup({ id: 'group-1', locked: true, memberWidgetIds: ['widget-1'] }),
            makeWidget({ id: 'widget-1' }),
        ];

        expect(collectWidgetIdsInOtherLockedGroups(widgets, 'group-1')).toEqual(new Set());
    });
});

describe('sanitizeGroupMembershipAcrossWidgets', () => {
    it('keeps a widget only in the first group that lists it, in widgets order', () => {
        const widgets = [
            makeGroup({ id: 'group-1', locked: true, memberWidgetIds: ['widget-1'] }),
            makeGroup({ id: 'group-2', locked: true, memberWidgetIds: ['widget-1'] }),
            makeWidget({ id: 'widget-1' }),
        ];

        const result = sanitizeGroupMembershipAcrossWidgets(widgets);
        const group1 = result.find((widget) => widget.id === 'group-1') as GroupWidgetConfig;
        const group2 = result.find((widget) => widget.id === 'group-2') as GroupWidgetConfig;

        expect(group1.memberWidgetIds).toEqual(['widget-1']);
        expect(group2.memberWidgetIds).toEqual([]);
    });

    it('leaves non-conflicting membership untouched', () => {
        const widgets = [
            makeGroup({ id: 'group-1', locked: true, memberWidgetIds: ['widget-1'] }),
            makeGroup({ id: 'group-2', locked: true, memberWidgetIds: ['widget-2'] }),
            makeWidget({ id: 'widget-1' }),
            makeWidget({ id: 'widget-2' }),
        ];

        const result = sanitizeGroupMembershipAcrossWidgets(widgets);

        expect(result).toEqual(widgets);
    });

    it('leaves non-group widgets untouched', () => {
        const widgets = [makeWidget({ id: 'widget-1' })];

        expect(sanitizeGroupMembershipAcrossWidgets(widgets)).toEqual(widgets);
    });

    it('only LOCKED groups can claim a member: a stale unlocked group never blocks a later locked one', () => {
        const widgets = [
            makeGroup({ id: 'group-unlocked', locked: false, memberWidgetIds: ['widget-1'] }),
            makeGroup({ id: 'group-locked', locked: true, memberWidgetIds: ['widget-1'] }),
            makeWidget({ id: 'widget-1' }),
        ];

        const result = sanitizeGroupMembershipAcrossWidgets(widgets);
        const lockedGroup = result.find((widget) => widget.id === 'group-locked') as GroupWidgetConfig;

        expect(lockedGroup.memberWidgetIds).toEqual(['widget-1']);
    });
});

describe('resolveEffectiveNavigationTarget', () => {
    it("returns the widget's own target when it has one, regardless of group membership", () => {
        const widgets = [
            makeGroup({ id: 'group-1', locked: true, memberWidgetIds: ['member-1'], navigationTargetDashboardId: 'dash-group' }),
            makeWidget({ id: 'member-1', navigationTargetDashboardId: 'dash-own' }),
        ];

        expect(resolveEffectiveNavigationTarget(widgets[1], widgets)).toBe('dash-own');
    });

    it("inherits the locked group's target when the member has none of its own", () => {
        const widgets = [
            makeGroup({ id: 'group-1', locked: true, memberWidgetIds: ['member-1'], navigationTargetDashboardId: 'dash-group' }),
            makeWidget({ id: 'member-1' }),
        ];

        expect(resolveEffectiveNavigationTarget(widgets[1], widgets)).toBe('dash-group');
    });

    it('does not inherit from an unlocked group', () => {
        const widgets = [
            makeGroup({ id: 'group-1', locked: false, memberWidgetIds: [], navigationTargetDashboardId: 'dash-group' }),
            makeWidget({ id: 'member-1' }),
        ];

        expect(resolveEffectiveNavigationTarget(widgets[1], widgets)).toBeUndefined();
    });

    it('returns undefined when neither the widget nor its group has a target', () => {
        const widgets = [
            makeGroup({ id: 'group-1', locked: true, memberWidgetIds: ['member-1'] }),
            makeWidget({ id: 'member-1' }),
        ];

        expect(resolveEffectiveNavigationTarget(widgets[1], widgets)).toBeUndefined();
    });

    it('returns undefined for a widget outside any locked group with no target of its own', () => {
        const widgets = [makeWidget({ id: 'widget-1' })];

        expect(resolveEffectiveNavigationTarget(widgets[0], widgets)).toBeUndefined();
    });
});

describe('resolveHoveredGroupId', () => {
    it('resolves to its own id when the widget is a locked group container', () => {
        const widgets = [makeGroup({ id: 'group-1', locked: true, memberWidgetIds: [] })];

        expect(resolveHoveredGroupId('group-1', widgets)).toBe('group-1');
    });

    it('resolves to the owning locked group id when the widget is one of its members', () => {
        const widgets = [
            makeGroup({ id: 'group-1', locked: true, memberWidgetIds: ['member-1'] }),
            makeWidget({ id: 'member-1' }),
        ];

        expect(resolveHoveredGroupId('member-1', widgets)).toBe('group-1');
    });

    it('is undefined for an unlocked group container', () => {
        const widgets = [makeGroup({ id: 'group-1', locked: false, memberWidgetIds: [] })];

        expect(resolveHoveredGroupId('group-1', widgets)).toBeUndefined();
    });

    it('is undefined for a widget that belongs to no locked group', () => {
        const widgets = [makeWidget({ id: 'widget-1' })];

        expect(resolveHoveredGroupId('widget-1', widgets)).toBeUndefined();
    });
});

describe('resolveEffectiveInteractionTarget (D6, G8)', () => {
    it('redirects a member of a locked, non-editing group to its container', () => {
        const widgets = [
            makeGroup({ id: 'group-1', locked: true, memberWidgetIds: ['member-1'] }),
            makeWidget({ id: 'member-1' }),
        ];

        expect(resolveEffectiveInteractionTarget('member-1', widgets, undefined)).toBe('group-1');
    });

    it('does not redirect a member of the group currently in edit mode', () => {
        const widgets = [
            makeGroup({ id: 'group-1', locked: true, memberWidgetIds: ['member-1'] }),
            makeWidget({ id: 'member-1' }),
        ];

        expect(resolveEffectiveInteractionTarget('member-1', widgets, 'group-1')).toBe('member-1');
    });

    it('does not redirect a member while a DIFFERENT group is being edited', () => {
        const widgets = [
            makeGroup({ id: 'group-1', locked: true, memberWidgetIds: ['member-1'] }),
            makeGroup({ id: 'group-2', locked: true, memberWidgetIds: [] }),
            makeWidget({ id: 'member-1' }),
        ];

        expect(resolveEffectiveInteractionTarget('member-1', widgets, 'group-2')).toBe('group-1');
    });

    it('never redirects a group container itself', () => {
        const widgets = [makeGroup({ id: 'group-1', locked: true, memberWidgetIds: [] })];

        expect(resolveEffectiveInteractionTarget('group-1', widgets, undefined)).toBe('group-1');
    });

    it('does not redirect a plain widget outside any locked group', () => {
        const widgets = [makeWidget({ id: 'widget-1' })];

        expect(resolveEffectiveInteractionTarget('widget-1', widgets, undefined)).toBe('widget-1');
    });

    it('does not redirect a member of an UNLOCKED group', () => {
        const widgets = [
            makeGroup({ id: 'group-1', locked: false, memberWidgetIds: [] }),
            makeWidget({ id: 'member-1' }),
        ];

        expect(resolveEffectiveInteractionTarget('member-1', widgets, undefined)).toBe('member-1');
    });
});

describe('clampRectInsideContainer (D6, G8)', () => {
    it('leaves a rect already fully inside the container untouched', () => {
        const container = { x: 0, y: 0, w: 10, h: 10 };
        const rect = { x: 2, y: 2, w: 2, h: 2 };

        expect(clampRectInsideContainer(rect, container)).toEqual(rect);
    });

    it('pulls a rect back inside when it moved past the right/bottom edge', () => {
        const container = { x: 0, y: 0, w: 10, h: 10 };
        const rect = { x: 9, y: 9, w: 3, h: 3 };

        expect(clampRectInsideContainer(rect, container)).toEqual({ x: 7, y: 7, w: 3, h: 3 });
    });

    it('pulls a rect back inside when it moved past the left/top edge', () => {
        const container = { x: 5, y: 5, w: 10, h: 10 };
        const rect = { x: 1, y: 1, w: 2, h: 2 };

        expect(clampRectInsideContainer(rect, container)).toEqual({ x: 5, y: 5, w: 2, h: 2 });
    });

    it('shrinks a rect resized larger than the container itself', () => {
        const container = { x: 0, y: 0, w: 10, h: 10 };
        const rect = { x: 0, y: 0, w: 14, h: 14 };

        expect(clampRectInsideContainer(rect, container)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    });
});

describe('clampResizeRectInsideContainer (G9 review fix: R3-clamp-resize-translates-member)', () => {
    const container = { x: 2, y: 2, w: 10, h: 10 };

    it('leaves a rect already fully inside the container untouched, for every direction', () => {
        const rect = { x: 4, y: 4, w: 2, h: 2 };

        (['se', 'ne', 'nw', 'sw'] as const).forEach((direction) => {
            expect(clampResizeRectInsideContainer(rect, container, direction)).toEqual(rect);
        });
    });

    it('se: shrinks width/height from the bottom-right, keeping the top-left anchor fixed (never translates)', () => {
        // Anchor (top-left) is x:4,y:4; the tentative rect grew past the container's right/bottom edge.
        const rect = { x: 4, y: 4, w: 20, h: 20 };

        expect(clampResizeRectInsideContainer(rect, container, 'se')).toEqual({ x: 4, y: 4, w: 8, h: 8 });
    });

    it('ne: shrinks from the top, keeping the bottom-left anchor (x, bottom edge) fixed', () => {
        // Anchor: x=4 (left), bottom edge = 4+4=8 (unchanged). Growing upward past the container's
        // top edge (y=2) must shrink height from the top, not move x.
        const rect = { x: 4, y: -10, w: 2, h: 18 };

        const result = clampResizeRectInsideContainer(rect, container, 'ne');
        expect(result.x).toBe(4);
        expect(result.y + result.h).toBe(8);
        expect(result.y).toBeGreaterThanOrEqual(container.y);
    });

    it('nw: shrinks from the top-left, keeping the bottom-right anchor fixed', () => {
        // Anchor: right edge = 6+2=8, bottom edge = 6+2=8 (unchanged).
        const rect = { x: -20, y: -20, w: 28, h: 28 };

        const result = clampResizeRectInsideContainer(rect, container, 'nw');
        expect(result.x + result.w).toBe(8);
        expect(result.y + result.h).toBe(8);
        expect(result.x).toBeGreaterThanOrEqual(container.x);
        expect(result.y).toBeGreaterThanOrEqual(container.y);
    });

    it('sw: shrinks from the bottom-left, keeping the top-right anchor (right edge, y) fixed', () => {
        // Anchor: right edge = 4+2=6, y=4 (unchanged).
        const rect = { x: -18, y: 4, w: 24, h: 20 };

        const result = clampResizeRectInsideContainer(rect, container, 'sw');
        expect(result.x + result.w).toBe(6);
        expect(result.y).toBe(4);
        expect(result.x).toBeGreaterThanOrEqual(container.x);
    });

    it('never grows a rect that is already smaller than the container', () => {
        const rect = { x: 4, y: 4, w: 1, h: 1 };

        expect(clampResizeRectInsideContainer(rect, container, 'se')).toEqual(rect);
    });

    it('never shrinks below 1 grid unit even against a tiny container', () => {
        const tinyContainer = { x: 0, y: 0, w: 1, h: 1 };
        const rect = { x: 0, y: 0, w: 5, h: 5 };

        const result = clampResizeRectInsideContainer(rect, tinyContainer, 'se');
        expect(result.w).toBeGreaterThanOrEqual(1);
        expect(result.h).toBeGreaterThanOrEqual(1);
    });
});

describe('duplicateLockedGroup', () => {
    let idCounter = 0;
    function nextId(type: string): string {
        idCounter += 1;
        return `new-${type}-${idCounter}`;
    }

    it('returns null when the widget is not a locked group', () => {
        const widgets = [makeGroup({ id: 'group-1', locked: false, memberWidgetIds: [] })];
        const layout = [makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 })];

        expect(duplicateLockedGroup('group-1', widgets, layout, 40, 24, nextId)).toBeNull();
    });

    it('duplicates the container and every member with new, remapped ids as one new grouped copy', () => {
        idCounter = 0;
        const widgets = [
            makeGroup({ id: 'group-1', locked: true, memberWidgetIds: ['member-1'], title: 'Contenedor' }),
            makeWidget({ id: 'member-1', title: 'Member 1' }),
        ];
        const layout = [
            makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 4 }),
            makeLayout({ widgetId: 'member-1', x: 1, y: 1, w: 2, h: 2 }),
        ];

        const result = duplicateLockedGroup('group-1', widgets, layout, 40, 24, nextId);

        expect(result).not.toBeNull();
        const newContainer = result!.widgets.find((widget) => widget.id === 'new-group-1') as GroupWidgetConfig;
        const newMember = result!.widgets.find((widget) => widget.id === 'new-metric-card-2');

        expect(newContainer).toBeDefined();
        expect(newContainer.locked).toBe(true);
        expect(newContainer.memberWidgetIds).toEqual(['new-metric-card-2']);
        expect(newMember).toBeDefined();

        // Original group is untouched (still points at the original member).
        const originalGroup = result!.widgets.find((widget) => widget.id === 'group-1') as GroupWidgetConfig;
        expect(originalGroup.memberWidgetIds).toEqual(['member-1']);

        // Offsets like a single-widget duplicate (y += own height), applied rigidly to the group.
        const newContainerLayout = result!.layout.find((item) => item.widgetId === 'new-group-1');
        const newMemberLayout = result!.layout.find((item) => item.widgetId === 'new-metric-card-2');
        expect(newContainerLayout).toEqual({ widgetId: 'new-group-1', x: 0, y: 4, w: 10, h: 4 });
        expect(newMemberLayout).toEqual({ widgetId: 'new-metric-card-2', x: 1, y: 5, w: 2, h: 2 });

        expect(result!.newSelectedWidgetId).toBe('new-group-1');

        // Stacking: the new container precedes its new member.
        const newContainerIndex = result!.widgets.findIndex((widget) => widget.id === 'new-group-1');
        const newMemberIndex = result!.widgets.findIndex((widget) => widget.id === 'new-metric-card-2');
        expect(newContainerIndex).toBeLessThan(newMemberIndex);
    });

    it('clamps the duplicated group as a rigid body so it never crosses the grid edge', () => {
        idCounter = 0;
        const widgets = [
            makeGroup({ id: 'group-1', locked: true, memberWidgetIds: ['member-1'] }),
            makeWidget({ id: 'member-1' }),
        ];
        const layout = [
            makeLayout({ widgetId: 'group-1', x: 0, y: 20, w: 10, h: 4 }),
            makeLayout({ widgetId: 'member-1', x: 1, y: 21, w: 2, h: 2 }),
        ];

        const result = duplicateLockedGroup('group-1', widgets, layout, 40, 24, nextId);

        const newContainerLayout = result!.layout.find((item) => item.widgetId === 'new-group-1');
        expect(newContainerLayout).toEqual({ widgetId: 'new-group-1', x: 0, y: 20, w: 10, h: 4 });
    });

    it('excludes a header-promoted id from the duplicated members even if it is still listed', () => {
        idCounter = 0;
        const widgets = [
            makeGroup({ id: 'group-1', locked: true, memberWidgetIds: ['member-1', 'header-widget'] }),
            makeWidget({ id: 'member-1' }),
            makeWidget({ id: 'header-widget' }),
        ];
        const layout = [
            makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 4 }),
            makeLayout({ widgetId: 'member-1', x: 1, y: 1, w: 2, h: 2 }),
            makeLayout({ widgetId: 'header-widget', x: 3, y: 1, w: 2, h: 2 }),
        ];

        const result = duplicateLockedGroup('group-1', widgets, layout, 40, 24, nextId, new Set(['header-widget']));

        const newContainer = result!.widgets.find((widget) => widget.id === 'new-group-1') as GroupWidgetConfig;
        expect(newContainer.memberWidgetIds).toEqual(['new-metric-card-2']);
        expect(result!.widgets.some((widget) => widget.title === 'header-widget' && widget.id !== 'header-widget')).toBe(false);
    });

    // G8 (copy bug, live check 2): a group whose `memberWidgetIds` already lists the same member
    // id more than once (malformed/imported data) must still duplicate that member exactly once —
    // not "several times". Before the `sanitizeGroupMemberIds` dedup fix, `idByOldMemberId` (a Map
    // keyed by the OLD member id) collapsed the repeated id to a single NEW id, but `members`/
    // `newMembers`/`newMemberLayouts` stayed unmapped over the repeated entries, producing several
    // widget/layout entries that all shared that one new id.
    it('duplicates a repeated member id exactly once, not several times', () => {
        idCounter = 0;
        const widgets = [
            makeGroup({ id: 'group-1', locked: true, memberWidgetIds: ['member-1', 'member-1', 'member-2'] }),
            makeWidget({ id: 'member-1', title: 'Member 1' }),
            makeWidget({ id: 'member-2', title: 'Member 2' }),
        ];
        const layout = [
            makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 4 }),
            makeLayout({ widgetId: 'member-1', x: 1, y: 1, w: 2, h: 2 }),
            makeLayout({ widgetId: 'member-2', x: 5, y: 1, w: 2, h: 2 }),
        ];

        const result = duplicateLockedGroup('group-1', widgets, layout, 40, 24, nextId);

        expect(result).not.toBeNull();
        const newContainer = result!.widgets.find((widget) => widget.id === 'new-group-1') as GroupWidgetConfig;
        expect(newContainer.memberWidgetIds).toHaveLength(2);

        const newMemberOneCopies = result!.widgets.filter((widget) => widget.title === 'Member 1 (Copia)');
        const newMemberTwoCopies = result!.widgets.filter((widget) => widget.title === 'Member 2 (Copia)');
        expect(newMemberOneCopies).toHaveLength(1);
        expect(newMemberTwoCopies).toHaveLength(1);

        const newMemberOneLayouts = result!.layout.filter((item) => item.widgetId === newMemberOneCopies[0].id);
        expect(newMemberOneLayouts).toHaveLength(1);
    });
});

describe('resolveWidgetSurfaceInset (G9)', () => {
    it('returns no inset for a group container, so its frame sits exactly on the grid lines', () => {
        expect(resolveWidgetSurfaceInset(makeGroup({ id: 'group-1' }))).toBe('0px');
    });

    it('returns the standard widget-spacing token for every non-group widget', () => {
        expect(resolveWidgetSurfaceInset(makeWidget({ id: 'widget-1' }))).toBe('var(--widget-spacing)');
    });
});
