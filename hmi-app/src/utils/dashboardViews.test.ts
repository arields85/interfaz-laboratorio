import { describe, expect, it } from 'vitest';

import { getDashboardVisualStatus, type Dashboard } from '../domain/admin.types';
import { makeDashboard, makeGroupWidget, makeLayout, makeWidget } from '../test/fixtures/dashboard.fixture';
import {
    createDashboardView,
    canDeleteDashboardView,
    cloneDashboardViewsWithRemappedIds,
    createDefaultDashboardView,
    deleteDashboardView,
    getActiveDashboardView,
    getDefaultDashboardView,
    mapDashboardWidgets,
    materializeDashboardView,
    moveDashboardView,
    normalizeDashboardViews,
    updateDashboardView,
    updateDashboardViewPresentation,
} from './dashboardViews';
import { collectWidgetIdsInOtherLockedGroups, computeGroupMembers, removeMemberFromGroups } from './groupWidget';

describe('dashboardViews', () => {
    it('normalizes a legacy dashboard into one default internal view without losing widgets or layout', () => {
        const legacyDashboard = makeDashboard({
            id: 'dashboard-legacy',
            widgets: [makeWidget({ id: 'widget-legacy', title: 'Legacy widget' })],
            layout: [makeLayout({ widgetId: 'widget-legacy', x: 3, y: 2, w: 5, h: 4 })],
        });

        const normalized = normalizeDashboardViews(legacyDashboard);

        expect(normalized.views).toEqual([
            expect.objectContaining({
                name: 'Default view',
                order: 0,
                widgets: [expect.objectContaining({ id: 'widget-legacy', title: 'Legacy widget' })],
                layout: [expect.objectContaining({ widgetId: 'widget-legacy', x: 3, y: 2, w: 5, h: 4 })],
            }),
        ]);
        expect(normalized.activeViewId).toBe(normalized.views?.[0]?.id);
        expect(normalized.widgets).toEqual([expect.objectContaining({ id: 'widget-legacy' })]);
        expect(normalized.layout).toEqual([expect.objectContaining({ widgetId: 'widget-legacy' })]);
    });

    it('creates a default internal view with cloned widget and layout collections', () => {
        const widget = makeWidget({ id: 'widget-default', title: 'Default widget' });
        const layout = makeLayout({ widgetId: 'widget-default', x: 1, y: 1, w: 6, h: 2 });

        const defaultView = createDefaultDashboardView({
            widgets: [widget],
            layout: [layout],
        });

        expect(defaultView).toEqual(expect.objectContaining({
            id: 'view-default',
            name: 'Default view',
            order: 0,
            widgets: [expect.objectContaining({ id: 'widget-default', title: 'Default widget' })],
            layout: [expect.objectContaining({ widgetId: 'widget-default', x: 1, y: 1, w: 6, h: 2 })],
        }));
        expect(defaultView.widgets[0]).not.toBe(widget);
        expect(defaultView.layout[0]).not.toBe(layout);
    });

    it('guards against deleting the last remaining internal view', () => {
        const singleViewDashboard = normalizeDashboardViews(makeDashboard());
        const multiViewDashboard = normalizeDashboardViews({
            ...makeDashboard(),
            views: [
                createDefaultDashboardView({ id: 'view-a', name: 'Production' }),
                createDefaultDashboardView({ id: 'view-b', name: 'Technical', order: 1 }),
            ],
            activeViewId: 'view-a',
        } satisfies Dashboard);

        expect(canDeleteDashboardView(singleViewDashboard.views ?? [], singleViewDashboard.views?.[0]?.id ?? '')).toBe(false);
        expect(canDeleteDashboardView(multiViewDashboard.views ?? [], 'view-a')).toBe(true);
    });

    it('clones views with fresh view/widget ids and remapped layouts', () => {
        const cloned = cloneDashboardViewsWithRemappedIds([
            {
                id: 'view-a',
                name: 'Production',
                order: 0,
                widgets: [makeWidget({ id: 'widget-shared', title: 'Production widget' })],
                layout: [makeLayout({ widgetId: 'widget-shared', x: 0, y: 0, w: 4, h: 4 })],
            },
            {
                id: 'view-b',
                name: 'Technical',
                order: 1,
                widgets: [makeWidget({ id: 'widget-shared', title: 'Technical widget' })],
                layout: [makeLayout({ widgetId: 'widget-shared', x: 4, y: 0, w: 4, h: 4 })],
            },
        ], 'dup-001');

        expect(cloned.views.map((view) => view.id)).toEqual(['view-a-dup-001', 'view-b-dup-001']);
        expect(cloned.views[0]?.widgets[0]?.id).toBe('widget-shared-dup-001-view-a');
        expect(cloned.views[1]?.widgets[0]?.id).toBe('widget-shared-dup-001-view-b');
        expect(cloned.views[0]?.layout).toEqual([
            expect.objectContaining({ widgetId: 'widget-shared-dup-001-view-a', x: 0, y: 0, w: 4, h: 4 }),
        ]);
        expect(cloned.views[1]?.layout).toEqual([
            expect.objectContaining({ widgetId: 'widget-shared-dup-001-view-b', x: 4, y: 0, w: 4, h: 4 }),
        ]);
    });

    it('remaps a group widget\'s memberWidgetIds through the same map and drops ids missing from the view', () => {
        const cloned = cloneDashboardViewsWithRemappedIds([
            {
                id: 'view-a',
                name: 'Production',
                order: 0,
                widgets: [
                    makeWidget({ id: 'widget-member-1', title: 'Member one' }),
                    makeWidget({ id: 'widget-member-2', title: 'Member two' }),
                    makeGroupWidget({
                        id: 'group-1',
                        memberWidgetIds: ['widget-member-1', 'widget-member-2', 'widget-missing'],
                        locked: true,
                    }),
                ],
                layout: [
                    makeLayout({ widgetId: 'widget-member-1', x: 0, y: 0, w: 4, h: 4 }),
                    makeLayout({ widgetId: 'widget-member-2', x: 4, y: 0, w: 4, h: 4 }),
                    makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 8, h: 4 }),
                ],
            },
        ], 'dup-001');

        const clonedGroup = cloned.views[0]?.widgets.find((widget) => widget.type === 'group');
        const clonedMemberOneId = cloned.views[0]?.widgets.find((widget) => widget.title === 'Member one')?.id;
        const clonedMemberTwoId = cloned.views[0]?.widgets.find((widget) => widget.title === 'Member two')?.id;

        expect(clonedGroup?.type === 'group' ? clonedGroup.memberWidgetIds : undefined).toEqual([
            clonedMemberOneId,
            clonedMemberTwoId,
        ]);
        expect(clonedGroup?.type === 'group' ? clonedGroup.locked : undefined).toBe(true);
    });

    it('normalizes a legacy group widget missing memberWidgetIds/locked into safe defaults', () => {
        const legacyDashboard = makeDashboard({
            id: 'dashboard-legacy-group',
            widgets: [
                {
                    id: 'group-legacy',
                    type: 'group',
                    title: 'Contenedor viejo',
                    position: { x: 0, y: 0 },
                    size: { w: 8, h: 8 },
                } as unknown as ReturnType<typeof makeGroupWidget>,
            ],
            layout: [makeLayout({ widgetId: 'group-legacy', x: 0, y: 0, w: 8, h: 8 })],
        });

        const normalized = normalizeDashboardViews(legacyDashboard);
        const normalizedGroup = normalized.widgets.find((widget) => widget.type === 'group');

        expect(normalizedGroup?.type === 'group' ? normalizedGroup.memberWidgetIds : undefined).toEqual([]);
        expect(normalizedGroup?.type === 'group' ? normalizedGroup.locked : undefined).toBe(false);
    });

    it('normalizes a malformed non-array memberWidgetIds into an empty list instead of throwing', () => {
        const malformedDashboard = makeDashboard({
            id: 'dashboard-malformed-group',
            widgets: [
                makeGroupWidget({
                    id: 'group-malformed',
                    memberWidgetIds: 'not-an-array' as unknown as string[],
                }),
            ],
            layout: [makeLayout({ widgetId: 'group-malformed', x: 0, y: 0, w: 8, h: 8 })],
        });

        expect(() => normalizeDashboardViews(malformedDashboard)).not.toThrow();

        const normalized = normalizeDashboardViews(malformedDashboard);
        const normalizedGroup = normalized.widgets.find((widget) => widget.type === 'group');

        expect(normalizedGroup?.type === 'group' ? normalizedGroup.memberWidgetIds : undefined).toEqual([]);
    });

    it('drops a group\'s own id and other group ids from memberWidgetIds on normalize', () => {
        const dashboard = makeDashboard({
            id: 'dashboard-self-and-nested-group',
            widgets: [
                makeWidget({ id: 'widget-member' }),
                makeGroupWidget({ id: 'group-inner' }),
                makeGroupWidget({
                    id: 'group-outer',
                    memberWidgetIds: ['group-outer', 'group-inner', 'widget-member'],
                }),
            ],
            layout: [
                makeLayout({ widgetId: 'widget-member', x: 0, y: 0, w: 2, h: 2 }),
                makeLayout({ widgetId: 'group-inner', x: 2, y: 0, w: 2, h: 2 }),
                makeLayout({ widgetId: 'group-outer', x: 0, y: 0, w: 8, h: 8 }),
            ],
        });

        const normalized = normalizeDashboardViews(dashboard);
        const outerGroup = normalized.widgets.find((widget) => widget.id === 'group-outer');

        expect(outerGroup?.type === 'group' ? outerGroup.memberWidgetIds : undefined).toEqual(['widget-member']);
    });

    it('keeps a widget only in the first group that lists it (view order) when two groups claim it on normalize (G5b)', () => {
        const dashboard = makeDashboard({
            id: 'dashboard-double-membership',
            widgets: [
                makeGroupWidget({ id: 'group-first', locked: true, memberWidgetIds: ['widget-member'] }),
                makeGroupWidget({ id: 'group-second', locked: true, memberWidgetIds: ['widget-member'] }),
                makeWidget({ id: 'widget-member' }),
            ],
            layout: [
                makeLayout({ widgetId: 'group-first', x: 0, y: 0, w: 8, h: 8 }),
                makeLayout({ widgetId: 'group-second', x: 0, y: 0, w: 8, h: 8 }),
                makeLayout({ widgetId: 'widget-member', x: 1, y: 1, w: 1, h: 1 }),
            ],
        });

        const normalized = normalizeDashboardViews(dashboard);
        const firstGroup = normalized.widgets.find((widget) => widget.id === 'group-first');
        const secondGroup = normalized.widgets.find((widget) => widget.id === 'group-second');

        expect(firstGroup?.type === 'group' ? firstGroup.memberWidgetIds : undefined).toEqual(['widget-member']);
        expect(secondGroup?.type === 'group' ? secondGroup.memberWidgetIds : undefined).toEqual([]);
    });

    it('sanitizes a malformed or self-referencing memberWidgetIds when remapping ids across a view clone', () => {
        const cloned = cloneDashboardViewsWithRemappedIds([
            {
                id: 'view-a',
                name: 'Production',
                order: 0,
                widgets: [
                    makeWidget({ id: 'widget-member' }),
                    makeGroupWidget({
                        id: 'group-1',
                        memberWidgetIds: 'not-an-array' as unknown as string[],
                    }),
                ],
                layout: [
                    makeLayout({ widgetId: 'widget-member', x: 0, y: 0, w: 2, h: 2 }),
                    makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 8, h: 8 }),
                ],
            },
        ], 'dup-002');

        const clonedGroup = cloned.views[0]?.widgets.find((widget) => widget.type === 'group');

        expect(clonedGroup?.type === 'group' ? clonedGroup.memberWidgetIds : undefined).toEqual([]);
    });

    it('drops self and other-group ids from memberWidgetIds when remapping ids across a view clone', () => {
        const cloned = cloneDashboardViewsWithRemappedIds([
            {
                id: 'view-a',
                name: 'Production',
                order: 0,
                widgets: [
                    makeWidget({ id: 'widget-member' }),
                    makeGroupWidget({ id: 'group-inner' }),
                    makeGroupWidget({
                        id: 'group-outer',
                        memberWidgetIds: ['group-outer', 'group-inner', 'widget-member'],
                    }),
                ],
                layout: [
                    makeLayout({ widgetId: 'widget-member', x: 0, y: 0, w: 2, h: 2 }),
                    makeLayout({ widgetId: 'group-inner', x: 2, y: 0, w: 2, h: 2 }),
                    makeLayout({ widgetId: 'group-outer', x: 0, y: 0, w: 8, h: 8 }),
                ],
            },
        ], 'dup-003');

        const clonedOuterGroup = cloned.views[0]?.widgets.find((widget) => widget.id === `group-outer-dup-003-view-a`);
        const clonedMemberId = cloned.views[0]?.widgets.find((widget) => widget.id.startsWith('widget-member-'))?.id;

        expect(clonedOuterGroup?.type === 'group' ? clonedOuterGroup.memberWidgetIds : undefined).toEqual([clonedMemberId]);
    });

    it('keeps a widget only in the first group that lists it (view order) when two groups claim it after remapping ids across a view clone (G5b)', () => {
        const cloned = cloneDashboardViewsWithRemappedIds([
            {
                id: 'view-a',
                name: 'Production',
                order: 0,
                widgets: [
                    makeGroupWidget({ id: 'group-first', locked: true, memberWidgetIds: ['widget-member'] }),
                    makeGroupWidget({ id: 'group-second', locked: true, memberWidgetIds: ['widget-member'] }),
                    makeWidget({ id: 'widget-member' }),
                ],
                layout: [
                    makeLayout({ widgetId: 'group-first', x: 0, y: 0, w: 8, h: 8 }),
                    makeLayout({ widgetId: 'group-second', x: 0, y: 0, w: 8, h: 8 }),
                    makeLayout({ widgetId: 'widget-member', x: 1, y: 1, w: 1, h: 1 }),
                ],
            },
        ], 'dup-004');

        const clonedFirstGroup = cloned.views[0]?.widgets.find((widget) => widget.id === 'group-first-dup-004-view-a');
        const clonedSecondGroup = cloned.views[0]?.widgets.find((widget) => widget.id === 'group-second-dup-004-view-a');

        expect(clonedFirstGroup?.type === 'group' ? clonedFirstGroup.memberWidgetIds : undefined).toEqual(['widget-member-dup-004-view-a']);
        expect(clonedSecondGroup?.type === 'group' ? clonedSecondGroup.memberWidgetIds : undefined).toEqual([]);
    });

    it('compares normalized views when deriving dashboard visual status', () => {
        const dashboard = normalizeDashboardViews({
            ...makeDashboard({
                id: 'dashboard-visual-status',
                ownerNodeId: 'node-1',
                status: 'published',
            }),
            widgets: [makeWidget({ id: 'widget-root-stale', title: 'Stale root widget' })],
            layout: [makeLayout({ widgetId: 'widget-root-stale' })],
            views: [
                {
                    id: 'view-production',
                    name: 'Production',
                    order: 0,
                    widgets: [makeWidget({ id: 'widget-production', title: 'Production widget' })],
                    layout: [makeLayout({ widgetId: 'widget-production' })],
                },
            ],
            activeViewId: 'view-production',
            publishedSnapshot: {
                aspect: '16:9',
                cols: 40,
                rows: 24,
                widgets: [makeWidget({ id: 'widget-root-other', title: 'Other root widget' })],
                layout: [makeLayout({ widgetId: 'widget-root-other' })],
                views: [
                    {
                        id: 'view-production',
                        name: 'Production',
                        order: 0,
                        widgets: [makeWidget({ id: 'widget-production', title: 'Production widget' })],
                        layout: [makeLayout({ widgetId: 'widget-production' })],
                    },
                ],
                activeViewId: 'view-production',
                publishedAt: '2026-07-04T12:00:00.000Z',
            },
        });

        expect(getDashboardVisualStatus(dashboard)).toBe('published');
    });

    it('treats icon and subtitle changes as published-view differences', () => {
        const dashboard = normalizeDashboardViews({
            ...makeDashboard({
                id: 'dashboard-view-presentation-status',
                ownerNodeId: 'node-1',
                status: 'published',
            }),
            views: [
                createDefaultDashboardView({
                    id: 'view-maintenance',
                    name: 'Maintenance',
                    subtitle: 'Line A',
                    iconKey: 'maintenance',
                    widgets: [makeWidget({ id: 'widget-maintenance', title: 'Maintenance widget' })],
                    layout: [makeLayout({ widgetId: 'widget-maintenance' })],
                }),
            ],
            activeViewId: 'view-maintenance',
            publishedSnapshot: {
                aspect: '16:9',
                cols: 40,
                rows: 24,
                widgets: [makeWidget({ id: 'widget-maintenance', title: 'Maintenance widget' })],
                layout: [makeLayout({ widgetId: 'widget-maintenance' })],
                views: [
                    createDefaultDashboardView({
                        id: 'view-maintenance',
                        name: 'Maintenance',
                        subtitle: 'Line B',
                        iconKey: 'technical',
                        widgets: [makeWidget({ id: 'widget-maintenance', title: 'Maintenance widget' })],
                        layout: [makeLayout({ widgetId: 'widget-maintenance' })],
                    }),
                ],
                activeViewId: 'view-maintenance',
                publishedAt: '2026-07-05T09:00:00.000Z',
            },
        });

        expect(getDashboardVisualStatus(dashboard)).toBe('pending');
    });

    it('creates, renames, reorders, updates, and deletes internal views while keeping the persisted default view materialized', () => {
        const dashboard = normalizeDashboardViews(makeDashboard({
            views: [
                createDefaultDashboardView({
                    id: 'view-production',
                    name: 'Production',
                    widgets: [makeWidget({ id: 'widget-production', title: 'Production widget' })],
                    layout: [makeLayout({ widgetId: 'widget-production', x: 0 })],
                }),
                createDefaultDashboardView({
                    id: 'view-technical',
                    name: 'Technical',
                    order: 1,
                    widgets: [makeWidget({ id: 'widget-technical', title: 'Technical widget' })],
                    layout: [makeLayout({ widgetId: 'widget-technical', x: 4 })],
                }),
            ],
            activeViewId: 'view-technical',
        }));

        const created = createDashboardView(dashboard, { name: 'Maintenance', iconKey: 'maintenance' });
        const createdView = created.views?.find((view) => view.name === 'Maintenance');

        expect(created.views).toHaveLength(3);
        expect(created.activeViewId).toBe('view-production');
        expect(created.widgets).toEqual([expect.objectContaining({ id: 'widget-production', title: 'Production widget' })]);
        expect(createdView).toEqual(expect.objectContaining({ iconKey: 'maintenance' }));

        const renamed = updateDashboardViewPresentation(created, createdView?.id ?? '', {
            name: 'Maintenance East',
            iconKey: 'default',
        });
        const moved = moveDashboardView(renamed, createdView?.id ?? '', 'left');
        const updated = updateDashboardView(moved, createdView?.id ?? '', (view) => ({
            ...view,
            widgets: [makeWidget({ id: 'widget-maintenance', title: 'Maintenance widget' })],
            layout: [makeLayout({ widgetId: 'widget-maintenance', x: 8 })],
        }));
        const deleted = deleteDashboardView(updated, 'view-production');

        expect(moved.views?.map((view) => view.name)).toEqual(['Production', 'Maintenance East', 'Technical']);
        expect(updated.activeViewId).toBe('view-production');
        expect(updated.widgets).toEqual([expect.objectContaining({ id: 'widget-production', title: 'Production widget' })]);
        expect(updated.layout).toEqual([expect.objectContaining({ widgetId: 'widget-production', x: 0 })]);
        expect(getActiveDashboardView(updated, createdView?.id)).toEqual(expect.objectContaining({ name: 'Maintenance East', iconKey: 'default' }));
        expect(deleted.views?.map((view) => view.name)).toEqual(['Maintenance East', 'Technical']);
        expect(deleted.activeViewId).toBe(createdView?.id);
    });

    it('sorts normalized views by order and resolves the default view from the first ordered entry', () => {
        const dashboard = normalizeDashboardViews(makeDashboard({
            views: [
                createDefaultDashboardView({
                    id: 'view-technical',
                    name: 'Technical',
                    order: 1,
                    widgets: [makeWidget({ id: 'widget-technical', title: 'Technical widget' })],
                    layout: [makeLayout({ widgetId: 'widget-technical', x: 4 })],
                }),
                createDefaultDashboardView({
                    id: 'view-production',
                    name: 'Production',
                    order: 0,
                    widgets: [makeWidget({ id: 'widget-production', title: 'Production widget' })],
                    layout: [makeLayout({ widgetId: 'widget-production', x: 0 })],
                }),
            ],
            activeViewId: 'view-technical',
        }));

        expect(dashboard.views?.map((view) => view.id)).toEqual(['view-production', 'view-technical']);
        expect(getDefaultDashboardView(dashboard)).toEqual(expect.objectContaining({ id: 'view-production', name: 'Production' }));
        expect(dashboard.widgets).toEqual([expect.objectContaining({ id: 'widget-production' })]);
        expect(dashboard.layout).toEqual([expect.objectContaining({ widgetId: 'widget-production' })]);
    });

    it('keeps preferred view exploration local while order-first default wins for initial materialization', () => {
        const dashboard = normalizeDashboardViews(makeDashboard({
            views: [
                createDefaultDashboardView({
                    id: 'view-technical',
                    name: 'Technical',
                    order: 1,
                    widgets: [makeWidget({ id: 'widget-technical', title: 'Technical widget' })],
                    layout: [makeLayout({ widgetId: 'widget-technical', x: 4 })],
                }),
                createDefaultDashboardView({
                    id: 'view-production',
                    name: 'Production',
                    order: 0,
                    widgets: [makeWidget({ id: 'widget-production', title: 'Production widget' })],
                    layout: [makeLayout({ widgetId: 'widget-production', x: 0 })],
                }),
            ],
            activeViewId: 'view-technical',
        }));

        const initialMaterialized = materializeDashboardView(dashboard);
        const locallySelected = materializeDashboardView(dashboard, 'view-technical');

        expect(initialMaterialized.activeViewId).toBe('view-production');
        expect(initialMaterialized.widgets).toEqual([expect.objectContaining({ id: 'widget-production' })]);
        expect(locallySelected.activeViewId).toBe('view-technical');
        expect(locallySelected.widgets).toEqual([expect.objectContaining({ id: 'widget-technical' })]);
    });

    it('updates a selected non-default internal view without changing the persisted default view id', () => {
        const dashboard = normalizeDashboardViews(makeDashboard({
            views: [
                createDefaultDashboardView({
                    id: 'view-production',
                    name: 'Production',
                    widgets: [makeWidget({ id: 'widget-production', title: 'Production widget' })],
                    layout: [makeLayout({ widgetId: 'widget-production', x: 0 })],
                }),
                createDefaultDashboardView({
                    id: 'view-technical',
                    name: 'Technical',
                    order: 1,
                    widgets: [makeWidget({ id: 'widget-technical', title: 'Technical widget' })],
                    layout: [makeLayout({ widgetId: 'widget-technical', x: 4 })],
                }),
            ],
            activeViewId: 'view-production',
        }));

        const updated = updateDashboardView(dashboard, 'view-technical', (view) => ({
            ...view,
            widgets: [...view.widgets, makeWidget({ id: 'widget-maintenance', title: 'Maintenance widget' })],
            layout: [...view.layout, makeLayout({ widgetId: 'widget-maintenance', x: 8 })],
        }));

        expect(updated.activeViewId).toBe('view-production');
        expect(updated.widgets).toEqual([expect.objectContaining({ id: 'widget-production', title: 'Production widget' })]);
        expect(getActiveDashboardView(updated, 'view-technical')).toEqual(expect.objectContaining({
            widgets: expect.arrayContaining([expect.objectContaining({ id: 'widget-maintenance', title: 'Maintenance widget' })]),
        }));
    });

    // G11: promoting one member of a locked group to the header releases ONLY that member — the
    // other member(s) must survive both the promotion itself AND a later unlock/relock through
    // the FULL production view-update pipeline (`updateDashboardView`, which re-normalizes on
    // every step), not just the bare pure helpers in isolation.
    it('keeps the other locked member through promote-to-header, then unlock, then relock (G11)', () => {
        const dashboard = normalizeDashboardViews(makeDashboard({
            views: [
                createDefaultDashboardView({
                    id: 'view-1',
                    name: 'View 1',
                    widgets: [
                        makeGroupWidget({ id: 'group-1', locked: true, memberWidgetIds: ['member-1', 'member-2'] }),
                        makeWidget({ id: 'member-1', title: 'Member 1' }),
                        makeWidget({ id: 'member-2', title: 'Member 2' }),
                    ],
                    layout: [
                        makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 }),
                        makeLayout({ widgetId: 'member-1', x: 1, y: 1, w: 2, h: 2 }),
                        makeLayout({ widgetId: 'member-2', x: 5, y: 5, w: 2, h: 2 }),
                    ],
                }),
            ],
            activeViewId: 'view-1',
        }));

        // Step A: promote member-1 (mirrors assignWidgetToHeaderSlot exactly).
        const afterPromote = updateDashboardView(dashboard, 'view-1', (view) => ({
            ...view,
            widgets: removeMemberFromGroups(view.widgets, 'member-1'),
        }));
        const dashboardAfterPromote = {
            ...afterPromote,
            headerConfig: {
                ...(afterPromote.headerConfig ?? {}),
                widgetSlots: [{ widgetId: 'member-1', column: 0 }],
            },
        };
        expect(
            getActiveDashboardView(dashboardAfterPromote, 'view-1').widgets.find((w) => w.id === 'group-1'),
        ).toEqual(expect.objectContaining({ memberWidgetIds: ['member-2'] }));

        // Step B: unlock (mirrors handleToggleGroupLock's unlock branch).
        const afterUnlock = updateDashboardView(dashboardAfterPromote, 'view-1', (view) => ({
            ...view,
            widgets: view.widgets.map((item) => (
                item.id === 'group-1' ? { ...item, locked: false, memberWidgetIds: [] } : item
            )),
        }));

        // Step C: lock again (mirrors handleToggleGroupLock's lock branch exactly).
        const afterRelock = updateDashboardView(afterUnlock, 'view-1', (view) => {
            const containerLayout = view.layout.find((item) => item.widgetId === 'group-1')!;
            const headerWidgetIdSet = new Set((afterUnlock.headerConfig?.widgetSlots ?? []).map((slot) => slot.widgetId));
            const otherLockedGroupMemberIds = collectWidgetIdsInOtherLockedGroups(view.widgets, 'group-1');
            const excludedWidgetIds = new Set([...headerWidgetIdSet, ...otherLockedGroupMemberIds]);
            const memberWidgetIds = computeGroupMembers('group-1', containerLayout, view.widgets, view.layout, excludedWidgetIds);
            return {
                ...view,
                widgets: view.widgets.map((item) => (
                    item.id === 'group-1' ? { ...item, locked: true, memberWidgetIds } : item
                )),
            };
        });

        const group = getActiveDashboardView(afterRelock, 'view-1').widgets.find((w) => w.id === 'group-1');
        expect(group).toEqual(expect.objectContaining({ memberWidgetIds: ['member-2'] }));
    });

    it('maps widgets across every view without leaking one view into another', () => {
        const dashboard = normalizeDashboardViews(makeDashboard({
            views: [
                createDefaultDashboardView({
                    id: 'view-production',
                    name: 'Production',
                    widgets: [makeWidget({ id: 'widget-shared', title: 'Production widget' })],
                }),
                createDefaultDashboardView({
                    id: 'view-technical',
                    name: 'Technical',
                    order: 1,
                    widgets: [makeWidget({ id: 'widget-shared', title: 'Technical widget' })],
                }),
            ],
            activeViewId: 'view-production',
        }));

        const mapped = mapDashboardWidgets(dashboard, (widget, view) => ({
            ...widget,
            displayOptions: {
                ...widget.displayOptions,
                subtitle: `${view.name} scoped`,
            },
        }));

        expect(mapped.views?.[0]?.widgets[0]).toEqual(expect.objectContaining({
            displayOptions: expect.objectContaining({ subtitle: 'Production scoped' }),
        }));
        expect(mapped.views?.[1]?.widgets[0]).toEqual(expect.objectContaining({
            displayOptions: expect.objectContaining({ subtitle: 'Technical scoped' }),
        }));
        expect(mapped.widgets[0]).toEqual(expect.objectContaining({
            displayOptions: expect.objectContaining({ subtitle: 'Production scoped' }),
        }));
    });
});
