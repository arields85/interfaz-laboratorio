import { describe, expect, it } from 'vitest';

import { getDashboardVisualStatus, type Dashboard } from '../domain/admin.types';
import { makeDashboard, makeLayout, makeWidget } from '../test/fixtures/dashboard.fixture';
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
