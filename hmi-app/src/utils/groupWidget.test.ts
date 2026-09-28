import { describe, expect, it } from 'vitest';
import {
    clampGroupMoveDelta,
    clampGroupResizeToMembers,
    computeGroupMembers,
    computeMembersBoundingBox,
    isRectFullyInside,
    reorderWidgetsWithGroupBeforeMembers,
    sanitizeGroupMemberIds,
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
});

describe('reorderWidgetsWithGroupBeforeMembers', () => {
    it('moves the group widget to precede its earliest member, keeping other relative order stable', () => {
        const widgets = [
            { id: 'a' }, { id: 'member-1' }, { id: 'group-1' }, { id: 'b' }, { id: 'member-2' },
        ];

        const result = reorderWidgetsWithGroupBeforeMembers(widgets, 'group-1', ['member-1', 'member-2']);

        expect(result.map((w) => w.id)).toEqual(['a', 'group-1', 'member-1', 'b', 'member-2']);
    });

    it('is a no-op when there are no members', () => {
        const widgets = [{ id: 'a' }, { id: 'group-1' }, { id: 'b' }];

        const result = reorderWidgetsWithGroupBeforeMembers(widgets, 'group-1', []);

        expect(result.map((w) => w.id)).toEqual(['a', 'group-1', 'b']);
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
