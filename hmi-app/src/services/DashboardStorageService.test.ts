import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardStorage } from './DashboardStorageService';
import { DASHBOARDS_STORAGE_KEY } from '../utils/legacyStorageCleanup';
import { makeDashboard, makeLayout, makeTemplate, makeWidget } from '../test/fixtures/dashboard.fixture';
import { TemplateAspectMismatchError, buildTemplateAspectMismatchMessage } from '../utils/templateAspectMismatch';

describe('DashboardStorageService', () => {
    const readStoredDashboards = () => JSON.parse(localStorage.getItem(DASHBOARDS_STORAGE_KEY) ?? '[]');

    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-16T15:00:00.000Z'));
        vi.spyOn(Date, 'now').mockReturnValue(1_234_567_890);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('seeds and reads dashboards from DASHBOARDS_STORAGE_KEY', async () => {
        const dashboardsPromise = dashboardStorage.getDashboards();

        await vi.advanceTimersByTimeAsync(300);
        const dashboards = await dashboardsPromise;

        expect(dashboards.length).toBeGreaterThan(0);
        expect(localStorage.getItem(DASHBOARDS_STORAGE_KEY)).not.toBeNull();
    });

    it('seeds header connection widgets using connection-status type', async () => {
        const dashboardsPromise = dashboardStorage.getDashboards();

        await vi.advanceTimersByTimeAsync(300);
        const dashboards = await dashboardsPromise;

        const seededConnectionWidget = dashboards
            .flatMap(dashboard => dashboard.widgets)
            .find(widget => widget.id === 'w-hdr-conn');

        expect(seededConnectionWidget).toEqual(expect.objectContaining({
            id: 'w-hdr-conn',
            type: 'connection-status',
        }));
    });

    it('creates empty dashboards with aspect 16:9, cols 40, and rows 24 by default', async () => {
        const dashboardPromise = dashboardStorage.createEmptyDashboard('Nuevo dashboard');

        await vi.advanceTimersByTimeAsync(400);
        const dashboard = await dashboardPromise;

        expect(dashboard.aspect).toBe('16:9');
        expect(dashboard.cols).toBe(40);
        expect(dashboard.rows).toBe(24);

        const persistedDashboards = JSON.parse(localStorage.getItem(DASHBOARDS_STORAGE_KEY) ?? '[]');
        expect(persistedDashboards).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: dashboard.id,
                    aspect: '16:9',
                    cols: 40,
                    rows: 24,
                }),
            ]),
        );
    });

    it('creates dashboards from templates preserving aspect, cols, and rows', async () => {
        const template = makeTemplate({
            aspect: '21:9',
            cols: 24,
            rows: 18,
            widgetPresets: [makeWidget({ title: 'Template widget' })],
            layoutPreset: [makeLayout({ widgetId: 'preset-0', x: 3, y: 4, w: 5, h: 6 })],
        });

        const dashboardPromise = dashboardStorage.createFromTemplate(template, 'Desde template');

        await vi.advanceTimersByTimeAsync(400);
        const dashboard = await dashboardPromise;

        expect(dashboard.aspect).toBe('21:9');
        expect(dashboard.cols).toBe(24);
        expect(dashboard.rows).toBe(18);
        expect(dashboard.layout).toEqual([
            expect.objectContaining({ x: 3, y: 4, w: 5, h: 6 }),
        ]);
    });

    it('migrates stored dashboards missing aspect, cols, and rows', async () => {
        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify([
            makeDashboard({
                id: 'dashboard-missing-dimensions',
                aspect: undefined as never,
                cols: undefined as never,
                rows: undefined as never,
            }),
        ]));

        const dashboardsPromise = dashboardStorage.getDashboards();

        await vi.advanceTimersByTimeAsync(300);
        const dashboards = await dashboardsPromise;

        expect(dashboards[0]).toEqual(expect.objectContaining({
            aspect: '16:9',
            cols: 40,
            rows: 24,
        }));
        expect(readStoredDashboards()[0]).toEqual(expect.objectContaining({
            aspect: '16:9',
            cols: 40,
            rows: 24,
        }));
    });

    it('downgrades published dashboards without ownerNodeId to draft during migration', async () => {
        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify([
            makeDashboard({
                id: 'dashboard-orphan-published',
                status: 'published',
                ownerNodeId: undefined,
                publishedSnapshot: {
                    aspect: '16:9',
                    cols: 40,
                    rows: 24,
                    widgets: [],
                    layout: [],
                    publishedAt: '2026-01-01T00:00:00.000Z',
                },
            }),
        ]));

        const dashboardPromise = dashboardStorage.getDashboard('dashboard-orphan-published');

        await vi.advanceTimersByTimeAsync(200);
        const dashboard = await dashboardPromise;

        expect(dashboard?.status).toBe('draft');
        expect(dashboard?.publishedSnapshot).toBeUndefined();
        expect(readStoredDashboards()[0]).toEqual(expect.objectContaining({
            status: 'draft',
        }));
        expect(readStoredDashboards()[0]).not.toHaveProperty('publishedSnapshot');
    });

    it('creates missing published snapshots for published dashboards with ownerNodeId during migration', async () => {
        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify([
            makeDashboard({
                id: 'dashboard-needs-snapshot',
                status: 'published',
                ownerNodeId: 'node-1',
                aspect: '21:9',
                cols: 24,
                rows: 18,
                widgets: [makeWidget({ id: 'widget-live', title: 'Live widget' })],
                layout: [makeLayout({ widgetId: 'widget-live', x: 4, y: 5, w: 6, h: 7 })],
                headerConfig: {
                    title: 'Published title',
                    widgetSlots: [{ widgetId: 'widget-live', column: 1 }],
                },
                publishedSnapshot: undefined,
                lastUpdateAt: '2026-02-02T00:00:00.000Z',
            }),
        ]));

        const dashboardPromise = dashboardStorage.getDashboard('dashboard-needs-snapshot');

        await vi.advanceTimersByTimeAsync(200);
        const dashboard = await dashboardPromise;

        expect(dashboard?.publishedSnapshot).toEqual(expect.objectContaining({
            aspect: '21:9',
            cols: 24,
            rows: 18,
            widgets: [expect.objectContaining({ id: 'widget-live', title: 'Live widget' })],
            layout: [expect.objectContaining({ widgetId: 'widget-live', x: 4, y: 5, w: 6, h: 7 })],
            headerConfig: expect.objectContaining({
                title: 'Published title',
                widgetSlots: [{ widgetId: 'widget-live', column: 1 }],
            }),
            publishedAt: '2026-02-02T00:00:00.000Z',
        }));
    });

    it('backfills missing published snapshot aspect, cols, and rows during migration', async () => {
        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify([
            makeDashboard({
                id: 'dashboard-snapshot-backfill',
                status: 'published',
                ownerNodeId: 'node-1',
                aspect: '4:3',
                cols: 16,
                rows: 12,
                publishedSnapshot: {
                    aspect: undefined as never,
                    cols: undefined as never,
                    rows: undefined as never,
                    widgets: [makeWidget({ id: 'widget-snapshot' })],
                    layout: [makeLayout({ widgetId: 'widget-snapshot' })],
                    publishedAt: '2026-03-03T00:00:00.000Z',
                },
            }),
        ]));

        const dashboardPromise = dashboardStorage.getDashboard('dashboard-snapshot-backfill');

        await vi.advanceTimersByTimeAsync(200);
        const dashboard = await dashboardPromise;

        expect(dashboard?.publishedSnapshot).toEqual(expect.objectContaining({
            aspect: '4:3',
            cols: 16,
            rows: 12,
        }));
        expect(readStoredDashboards()[0].publishedSnapshot).toEqual(expect.objectContaining({
            aspect: '4:3',
            cols: 16,
            rows: 12,
        }));
    });

    it('publishes snapshots with aspect, cols, and rows and restores them on discard', async () => {
        const initialDashboard = makeDashboard({
            id: 'dashboard-publish',
            name: 'Publicable',
            aspect: '21:9',
            cols: 24,
            rows: 18,
            ownerNodeId: 'node-1',
            widgets: [makeWidget({ id: 'widget-1', title: 'Original' })],
            layout: [makeLayout({ widgetId: 'widget-1', x: 2, y: 1, w: 4, h: 3 })],
        });

        const savePromise = dashboardStorage.saveDashboard(initialDashboard);
        await vi.advanceTimersByTimeAsync(400);
        await savePromise;

        const publishPromise = dashboardStorage.publishDashboard(initialDashboard.id);
        const publishAdvance = vi.advanceTimersByTimeAsync(600);
        await publishAdvance;
        const published = await publishPromise;

        expect(published?.publishedSnapshot).toEqual(
            expect.objectContaining({
                aspect: '21:9',
                cols: 24,
                rows: 18,
                layout: [expect.objectContaining({ x: 2, y: 1, w: 4, h: 3 })],
            }),
        );

        const pendingDashboard = {
            ...published!,
            aspect: '4:3' as const,
            cols: 16,
            rows: 9,
            widgets: [makeWidget({ id: 'widget-1', title: 'Editado' })],
            layout: [makeLayout({ widgetId: 'widget-1', x: 0, y: 0, w: 2, h: 2 })],
        };

        const updatePromise = dashboardStorage.saveDashboard(pendingDashboard);
        await vi.advanceTimersByTimeAsync(400);
        await updatePromise;

        const discardPromise = dashboardStorage.discardChanges(initialDashboard.id);
        const discardAdvance = vi.advanceTimersByTimeAsync(600);
        await discardAdvance;
        const discarded = await discardPromise;

        expect(discarded?.aspect).toBe('21:9');
        expect(discarded?.cols).toBe(24);
        expect(discarded?.rows).toBe(18);
        expect(discarded?.widgets[0]?.title).toBe('Original');
        expect(discarded?.layout[0]).toEqual(expect.objectContaining({ x: 2, y: 1, w: 4, h: 3 }));
    });

    it('persists published cols in the stored snapshot for the viewer flow', async () => {
        const dashboard = makeDashboard({
            id: 'dashboard-cols-publish',
            name: 'Cols publish',
            status: 'draft',
            cols: 30,
            rows: 12,
            ownerNodeId: 'node-1',
        });

        const savePromise = dashboardStorage.saveDashboard(dashboard);
        await vi.advanceTimersByTimeAsync(400);
        await savePromise;

        const publishPromise = dashboardStorage.publishDashboard(dashboard.id);
        await vi.advanceTimersByTimeAsync(600);
        await publishPromise;

        const loadPromise = dashboardStorage.getDashboard(dashboard.id);
        await vi.advanceTimersByTimeAsync(200);
        const storedPublishedDashboard = await loadPromise;

        expect(storedPublishedDashboard?.publishedSnapshot).toEqual(
            expect.objectContaining({
                cols: 30,
                rows: 12,
            }),
        );
    });

    it('persists viewer activity-analytics custom windows without rewriting the saved builder grouping default', async () => {
        const dashboard = makeDashboard({
            id: 'dashboard-activity-analytics',
            status: 'published',
            ownerNodeId: 'node-1',
            widgets: [makeWidget({
                id: 'activity-widget',
                type: 'activity-analytics',
                displayOptions: { range: '24h', groupBy: 'day' },
            } as never)],
            publishedSnapshot: {
                aspect: '16:9',
                cols: 40,
                rows: 24,
                widgets: [makeWidget({
                    id: 'activity-widget',
                    type: 'activity-analytics',
                    displayOptions: { range: '24h', groupBy: 'day' },
                } as never)],
                layout: [],
                publishedAt: '2026-04-16T15:00:00.000Z',
            },
        });

        const savePromise = dashboardStorage.saveDashboard(dashboard);
        await vi.advanceTimersByTimeAsync(400);
        await savePromise;

        const persistPromise = dashboardStorage.persistPublishedWidgetDisplayOptions(
            dashboard.id,
            'activity-widget',
            {
                range: 'custom',
                start: '2026-06-18T10:00:00.000Z',
                end: '2026-06-18T12:00:00.000Z',
                groupBy: 'shift',
            },
        );
        await vi.advanceTimersByTimeAsync(600);
        const updated = await persistPromise;

        expect(updated?.widgets[0]).toEqual(expect.objectContaining({
            displayOptions: expect.objectContaining({
                range: 'custom',
                start: '2026-06-18T10:00:00.000Z',
                end: '2026-06-18T12:00:00.000Z',
                groupBy: 'day',
            }),
        }));
        expect(updated?.publishedSnapshot?.widgets[0]).toEqual(expect.objectContaining({
            displayOptions: expect.objectContaining({
                range: 'custom',
                start: '2026-06-18T10:00:00.000Z',
                end: '2026-06-18T12:00:00.000Z',
                groupBy: 'day',
            }),
        }));
    });

    it('applies matching templates preserving coordinates when rows already fit', () => {
        const dashboard = makeDashboard({
            id: 'dashboard-target',
            aspect: '16:9',
            rows: 12,
            widgets: [makeWidget({ id: 'existing-widget', title: 'Viejo widget' })],
            layout: [makeLayout({ widgetId: 'existing-widget', x: 0, y: 0, w: 2, h: 2 })],
        });
        const template = makeTemplate({
            id: 'template-match',
            aspect: '16:9',
            rows: 12,
            widgetPresets: [makeWidget({ id: 'preset-1', title: 'Nuevo widget' })],
            layoutPreset: [makeLayout({ widgetId: 'preset-1', x: 3, y: 4, w: 5, h: 6 })],
        });

        const applied = dashboardStorage.applyTemplate(dashboard, template);

        expect(applied.layout).toEqual([
            expect.objectContaining({ x: 3, y: 4, w: 5, h: 6 }),
        ]);
        expect(applied.widgets).toHaveLength(1);
        expect(applied.widgets[0]?.title).toBe('Nuevo widget');
        expect(applied.widgets[0]?.id).not.toBe('existing-widget');
    });

    it('applies matching templates clamping coordinates when dashboard rows differ', () => {
        const dashboard = makeDashboard({
            id: 'dashboard-target',
            aspect: '16:9',
            cols: 20,
            rows: 6,
            widgets: [makeWidget({ id: 'existing-widget', title: 'Viejo widget' })],
            layout: [makeLayout({ widgetId: 'existing-widget', x: 0, y: 0, w: 2, h: 2 })],
        });
        const template = makeTemplate({
            id: 'template-match-rows',
            aspect: '16:9',
            rows: 12,
            widgetPresets: [makeWidget({ id: 'preset-1', title: 'Nuevo widget' })],
            layoutPreset: [makeLayout({ widgetId: 'preset-1', x: 18, y: 10, w: 4, h: 3 })],
        });

        const applied = dashboardStorage.applyTemplate(dashboard, template);

        expect(applied.rows).toBe(6);
        expect(applied.layout).toEqual([
            expect.objectContaining({ x: 16, y: 3, w: 4, h: 3 }),
        ]);
    });

    it('throws TemplateAspectMismatchError before copying widgets when template aspect mismatches', () => {
        const dashboard = makeDashboard({
            id: 'dashboard-target',
            aspect: '16:9',
            rows: 12,
            widgets: [makeWidget({ id: 'existing-widget', title: 'Viejo widget' })],
            layout: [makeLayout({ widgetId: 'existing-widget', x: 1, y: 2, w: 3, h: 4 })],
        });
        const template = makeTemplate({
            id: 'template-mismatch',
            aspect: '21:9',
            rows: 12,
            widgetPresets: [makeWidget({ id: 'preset-1', title: 'Nuevo widget' })],
            layoutPreset: [makeLayout({ widgetId: 'preset-1', x: 3, y: 4, w: 5, h: 6 })],
        });

        expect(() => dashboardStorage.applyTemplate(dashboard, template)).toThrowError(
            new TemplateAspectMismatchError({
                templateAspect: '21:9',
                dashboardAspect: '16:9',
                message: buildTemplateAspectMismatchMessage('21:9', '16:9'),
            }),
        );
        expect(dashboard.widgets).toEqual([expect.objectContaining({ id: 'existing-widget', title: 'Viejo widget' })]);
        expect(dashboard.layout).toEqual([expect.objectContaining({ widgetId: 'existing-widget', x: 1, y: 2, w: 3, h: 4 })]);
    });

    it('deletes matching dashboards and leaves the list unchanged for unknown ids', async () => {
        const dashboards = [
            makeDashboard({ id: 'dashboard-a', name: 'A' }),
            makeDashboard({ id: 'dashboard-b', name: 'B' }),
        ];
        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify(dashboards));

        await dashboardStorage.deleteDashboard('dashboard-a');

        expect(readStoredDashboards()).toEqual([
            expect.objectContaining({ id: 'dashboard-b', name: 'B' }),
        ]);

        const afterDelete = localStorage.getItem(DASHBOARDS_STORAGE_KEY);

        await dashboardStorage.deleteDashboard('dashboard-unknown');

        expect(localStorage.getItem(DASHBOARDS_STORAGE_KEY)).toBe(afterDelete);
    });

    it('reorders dashboards by known ids, ignores unknown ids, and appends missing dashboards', async () => {
        const dashboards = [
            makeDashboard({ id: 'dashboard-a', name: 'A' }),
            makeDashboard({ id: 'dashboard-b', name: 'B' }),
            makeDashboard({ id: 'dashboard-c', name: 'C' }),
        ];
        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify(dashboards));

        const reordered = await dashboardStorage.reorderDashboards(['dashboard-c', 'dashboard-unknown', 'dashboard-a']);

        expect(reordered.map(dashboard => dashboard.id)).toEqual([
            'dashboard-c',
            'dashboard-a',
            'dashboard-b',
        ]);
        expect(readStoredDashboards().map((dashboard: { id: string }) => dashboard.id)).toEqual([
            'dashboard-c',
            'dashboard-a',
            'dashboard-b',
        ]);
    });

    it('returns null when duplicating an unknown dashboard', async () => {
        const duplicatePromise = dashboardStorage.duplicateDashboard('missing-dashboard');

        await vi.advanceTimersByTimeAsync(200);
        const duplicate = await duplicatePromise;

        expect(duplicate).toBeNull();
    });

    it('duplicates dashboards with fresh ids, explicit names, and fallback layout widget ids', async () => {
        const original = makeDashboard({
            id: 'dashboard-duplicate-source',
            name: 'Original dashboard',
            ownerNodeId: 'node-1',
            widgets: [
                makeWidget({ id: 'widget-a', title: 'Widget A' }),
                makeWidget({ id: 'widget-b', title: 'Widget B' }),
            ],
            layout: [
                makeLayout({ widgetId: 'widget-a', x: 1, y: 2, w: 3, h: 4 }),
                makeLayout({ widgetId: 'missing-widget-layout', x: 5, y: 6, w: 7, h: 8 }),
            ],
            headerConfig: {
                title: 'Original header',
                subtitle: 'Original subtitle',
            },
        });

        const savePromise = dashboardStorage.saveDashboard(original);
        await vi.advanceTimersByTimeAsync(400);
        await savePromise;

        const duplicatePromise = dashboardStorage.duplicateDashboard(original.id, 'Explicit duplicate');

        await vi.advanceTimersByTimeAsync(600);
        const duplicate = await duplicatePromise;

        expect(duplicate).toEqual(expect.objectContaining({
            id: expect.stringMatching(/^dash-/),
            name: 'Explicit duplicate',
            status: 'draft',
            version: 1,
            isTemplate: false,
            ownerNodeId: undefined,
            headerConfig: expect.objectContaining({
                title: 'Explicit duplicate',
                subtitle: 'Original subtitle',
            }),
        }));
        expect(duplicate?.id).not.toBe(original.id);
        expect(duplicate?.widgets).toHaveLength(2);
        expect(duplicate?.widgets[0]?.id).toMatch(/^widget-a-dup-/);
        expect(duplicate?.widgets[1]?.id).toMatch(/^widget-b-dup-/);
        expect(duplicate?.widgets[0]?.id).not.toBe('widget-a');
        expect(duplicate?.widgets[1]?.id).not.toBe('widget-b');
        expect(duplicate?.layout).toEqual([
            expect.objectContaining({ widgetId: duplicate?.widgets[0]?.id, x: 1, y: 2, w: 3, h: 4 }),
            expect.objectContaining({ widgetId: 'missing-widget-layout', x: 5, y: 6, w: 7, h: 8 }),
        ]);
    });

    it('uses the fallback copy name when duplicating without an explicit name', async () => {
        const original = makeDashboard({
            id: 'dashboard-copy-name-source',
            name: 'Base dashboard',
            widgets: [makeWidget({ id: 'widget-copy' })],
        });

        const savePromise = dashboardStorage.saveDashboard(original);
        await vi.advanceTimersByTimeAsync(400);
        await savePromise;

        const duplicatePromise = dashboardStorage.duplicateDashboard(original.id);

        await vi.advanceTimersByTimeAsync(600);
        const duplicate = await duplicatePromise;

        expect(duplicate?.name).toBe('Base dashboard (Copia)');
        expect(duplicate?.headerConfig?.title).toBe('Base dashboard (Copia)');
    });

    it('returns null when discarding changes for an unknown dashboard', async () => {
        const discardPromise = dashboardStorage.discardChanges('missing-dashboard');

        await vi.advanceTimersByTimeAsync(200);
        const discarded = await discardPromise;

        expect(discarded).toBeNull();
    });

    it('returns dashboards unchanged when discarding changes without a published snapshot', async () => {
        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify([
            {
                ...makeDashboard({
                    id: 'dashboard-null-snapshot',
                    name: 'Null snapshot',
                    status: 'draft',
                }),
                publishedSnapshot: null,
            },
        ]));

        const discardPromise = dashboardStorage.discardChanges('dashboard-null-snapshot');

        await vi.advanceTimersByTimeAsync(200);
        const discarded = await discardPromise;

        expect(discarded).toEqual(expect.objectContaining({
            id: 'dashboard-null-snapshot',
            name: 'Null snapshot',
            publishedSnapshot: null,
        }));
        expect(readStoredDashboards()[0]).toEqual(expect.objectContaining({
            id: 'dashboard-null-snapshot',
            publishedSnapshot: null,
        }));
    });

    it('restores snapshots with headerConfig when discarding published changes', async () => {
        const dashboard = makeDashboard({
            id: 'dashboard-discard-header',
            name: 'Header restore',
            status: 'published',
            ownerNodeId: 'node-1',
            aspect: '21:9',
            cols: 24,
            rows: 18,
            widgets: [makeWidget({ id: 'widget-live', title: 'Edited widget' })],
            layout: [makeLayout({ widgetId: 'widget-live', x: 9, y: 9, w: 3, h: 2 })],
            headerConfig: {
                title: 'Edited title',
                subtitle: 'Edited subtitle',
                widgetSlots: [{ widgetId: 'widget-live', column: 2 }],
            },
            publishedSnapshot: {
                aspect: '16:9',
                cols: 40,
                rows: 24,
                widgets: [makeWidget({ id: 'widget-published', title: 'Published widget' })],
                layout: [makeLayout({ widgetId: 'widget-published', x: 1, y: 1, w: 4, h: 3 })],
                headerConfig: {
                    title: 'Published title',
                    subtitle: 'Published subtitle',
                    widgetSlots: [{ widgetId: 'widget-published', column: 0 }],
                },
                publishedAt: '2026-04-01T00:00:00.000Z',
            },
        });

        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify([dashboard]));

        const discardPromise = dashboardStorage.discardChanges('dashboard-discard-header');

        await vi.advanceTimersByTimeAsync(600);
        const discarded = await discardPromise;

        expect(discarded).toMatchObject({
            aspect: '16:9',
            cols: 40,
            rows: 24,
            widgets: [{ id: 'widget-published', title: 'Published widget' }],
            layout: [{ widgetId: 'widget-published', x: 1, y: 1, w: 4, h: 3 }],
            headerConfig: {
                title: 'Published title',
                subtitle: 'Published subtitle',
                widgetSlots: [{ widgetId: 'widget-published', column: 0 }],
            },
            lastUpdateAt: '2026-04-16T15:00:00.600Z',
        });
    });

    it('clears headerConfig when the published snapshot has none during discard', async () => {
        const dashboard = makeDashboard({
            id: 'dashboard-discard-no-header',
            name: 'No header snapshot',
            status: 'published',
            ownerNodeId: 'node-1',
            headerConfig: {
                title: 'Edited title',
                widgetSlots: [{ widgetId: 'widget-edit', column: 1 }],
            },
            publishedSnapshot: {
                aspect: '16:9',
                cols: 40,
                rows: 24,
                widgets: [makeWidget({ id: 'widget-published' })],
                layout: [makeLayout({ widgetId: 'widget-published' })],
                publishedAt: '2026-04-02T00:00:00.000Z',
            },
        });

        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify([dashboard]));

        const discardPromise = dashboardStorage.discardChanges('dashboard-discard-no-header');

        await vi.advanceTimersByTimeAsync(600);
        const discarded = await discardPromise;

        expect(discarded?.headerConfig).toBeUndefined();
        expect(readStoredDashboards()[0].headerConfig).toBeUndefined();
    });
});
