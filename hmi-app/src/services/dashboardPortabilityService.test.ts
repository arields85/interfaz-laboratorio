import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogVariable } from '../domain';
import { makeDashboard, makeLayout, makeWidget } from '../test/fixtures/dashboard.fixture';
import { DASHBOARDS_STORAGE_KEY, VARIABLE_CATALOG_STORAGE_KEY } from '../utils/legacyStorageCleanup';
import {
    type DashboardImportResult,
    DashboardPortabilityValidationError,
    type PortableDashboardFileV1,
    dashboardPortabilityService,
} from './dashboardPortabilityService';

function makeVariable(overrides: Partial<CatalogVariable> = {}): CatalogVariable {
    return {
        id: 'cv-rotor-speed-rpm',
        name: 'Rotor speed',
        unit: 'RPM',
        description: 'Main rotor speed',
        ...overrides,
    };
}

function makePortableFile(overrides: Partial<PortableDashboardFileV1> = {}): PortableDashboardFileV1 {
    return {
        schemaVersion: 1,
        exportedAt: '2026-06-30T12:34:56.000Z',
        origin: {
            app: 'interfaz-laboratorio',
            dashboardId: 'source-dashboard',
            dashboardName: 'Portable dashboard',
        },
        dashboard: {
            id: 'source-dashboard',
            name: 'Portable dashboard',
            description: 'Portable description',
            dashboardType: 'line',
            aspect: '21:9',
            cols: 24,
            rows: 12,
            widgets: [],
            layout: [],
            headerConfig: undefined,
            ...overrides.dashboard,
        },
        referencedCatalogVariables: [],
        ...overrides,
    };
}

describe('dashboardPortabilityService.exportDashboard', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-30T12:34:56.000Z'));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('exports a versioned portable file that preserves dashboard structure fields', async () => {
        const dashboard = makeDashboard({
            id: 'dashboard-export-source',
            name: 'Compression line',
            description: 'Main monitoring view',
            dashboardType: 'equipment',
            aspect: '21:9',
            cols: 24,
            rows: 18,
            ownerNodeId: 'node-7',
            templateId: 'template-9',
            status: 'published',
            version: 5,
            widgets: [
                makeWidget({
                    id: 'widget-speed',
                    binding: { mode: 'real_variable', catalogVariableId: 'cv-rotor-speed-rpm' },
                }),
            ],
            layout: [makeLayout({ widgetId: 'widget-speed', x: 2, y: 3, w: 5, h: 4 })],
            headerConfig: {
                title: 'Compression line header',
                widgetSlots: [{ widgetId: 'widget-speed', column: 1 }],
            },
            publishedSnapshot: {
                aspect: '21:9',
                cols: 24,
                rows: 18,
                widgets: [makeWidget({ id: 'snapshot-widget' })],
                layout: [makeLayout({ widgetId: 'snapshot-widget' })],
                publishedAt: '2026-01-01T00:00:00.000Z',
            },
        });

        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify([
            makeVariable(),
        ]));

        const exportPromise = dashboardPortabilityService.exportDashboard(dashboard);

        await vi.advanceTimersByTimeAsync(200);
        const exportResult = await exportPromise;
        const portableFile = JSON.parse(exportResult.json) as PortableDashboardFileV1;

        expect(exportResult.fileName).toBe('interfaz-laboratorio-dashboard-compression-line-20260630-1234.json');
        expect(exportResult.issues).toEqual([]);
        expect(portableFile).toEqual({
            schemaVersion: 1,
            exportedAt: '2026-06-30T12:34:56.000Z',
            origin: {
                app: 'interfaz-laboratorio',
                dashboardId: 'dashboard-export-source',
                dashboardName: 'Compression line',
            },
            dashboard: {
                id: 'dashboard-export-source',
                name: 'Compression line',
                description: 'Main monitoring view',
                dashboardType: 'equipment',
                aspect: '21:9',
                cols: 24,
                rows: 18,
                widgets: [
                    expect.objectContaining({
                        id: 'widget-speed',
                        binding: { mode: 'real_variable', catalogVariableId: 'cv-rotor-speed-rpm' },
                    }),
                ],
                layout: [expect.objectContaining({ widgetId: 'widget-speed', x: 2, y: 3, w: 5, h: 4 })],
                headerConfig: {
                    title: 'Compression line header',
                    widgetSlots: [{ widgetId: 'widget-speed', column: 1 }],
                },
            },
            referencedCatalogVariables: [makeVariable()],
        });
        expect(portableFile.dashboard).not.toHaveProperty('ownerNodeId');
        expect(portableFile.dashboard).not.toHaveProperty('templateId');
        expect(portableFile.dashboard).not.toHaveProperty('publishedSnapshot');
        expect(portableFile.dashboard).not.toHaveProperty('status');
        expect(portableFile.dashboard).not.toHaveProperty('version');
    });

    it('deduplicates referenced catalog variables while preserving widget bindings', async () => {
        const dashboard = makeDashboard({
            id: 'dashboard-duplicate-bindings',
            name: 'Shared variables',
            widgets: [
                makeWidget({
                    id: 'widget-speed-1',
                    binding: { mode: 'real_variable', catalogVariableId: 'cv-rotor-speed-rpm' },
                }),
                makeWidget({
                    id: 'widget-speed-2',
                    binding: { mode: 'real_variable', catalogVariableId: 'cv-rotor-speed-rpm' },
                }),
                makeWidget({
                    id: 'widget-pressure',
                    binding: { mode: 'real_variable', catalogVariableId: 'cv-hydraulic-pressure-bar' },
                }),
            ],
        });

        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify([
            makeVariable(),
            makeVariable({
                id: 'cv-hydraulic-pressure-bar',
                name: 'Hydraulic pressure',
                unit: 'bar',
                description: 'Hydraulic circuit pressure',
            }),
        ]));

        const exportPromise = dashboardPortabilityService.exportDashboard(dashboard);

        await vi.advanceTimersByTimeAsync(200);
        const exportResult = await exportPromise;
        const portableFile = JSON.parse(exportResult.json) as PortableDashboardFileV1;

        expect(portableFile.referencedCatalogVariables).toEqual([
            makeVariable(),
            makeVariable({
                id: 'cv-hydraulic-pressure-bar',
                name: 'Hydraulic pressure',
                unit: 'bar',
                description: 'Hydraulic circuit pressure',
            }),
        ]);
        expect(portableFile.dashboard.widgets).toEqual([
            expect.objectContaining({ binding: { mode: 'real_variable', catalogVariableId: 'cv-rotor-speed-rpm' } }),
            expect.objectContaining({ binding: { mode: 'real_variable', catalogVariableId: 'cv-rotor-speed-rpm' } }),
            expect.objectContaining({ binding: { mode: 'real_variable', catalogVariableId: 'cv-hydraulic-pressure-bar' } }),
        ]);
    });
});

describe('dashboardPortabilityService.importDashboard', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-01T10:00:00.000Z'));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('rejects unsupported schema versions without mutating stored dashboards', async () => {
        const existingDashboards = [makeDashboard({ id: 'existing-dashboard', name: 'Existing dashboard' })];
        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify(existingDashboards));

        const importPromise = dashboardPortabilityService.importDashboard(JSON.stringify(makePortableFile({
            schemaVersion: 99 as 1,
        })));
        const rejection = expect(importPromise).rejects.toMatchObject({
            issues: [expect.objectContaining({ code: 'unsupported_schema_version', severity: 'error' })],
        });

        await vi.advanceTimersByTimeAsync(1000);

        await rejection;
        expect(JSON.parse(localStorage.getItem(DASHBOARDS_STORAGE_KEY) ?? '[]')).toEqual(existingDashboards);
    });

    it('rejects malformed JSON without mutating dashboard or catalog storage', async () => {
        const existingDashboards = [makeDashboard({ id: 'existing-dashboard', name: 'Existing dashboard' })];
        const existingVariables = [makeVariable({ id: 'existing-variable', name: 'Existing variable', unit: 'RPM' })];

        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify(existingDashboards));
        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify(existingVariables));

        const importPromise = dashboardPortabilityService.importDashboard('{"schemaVersion": 1');
        const rejection = expect(importPromise).rejects.toMatchObject({
            issues: [expect.objectContaining({ code: 'malformed_json', severity: 'error' })],
        });

        await vi.advanceTimersByTimeAsync(1000);

        await rejection;
        expect(JSON.parse(localStorage.getItem(DASHBOARDS_STORAGE_KEY) ?? '[]')).toEqual(existingDashboards);
        expect(JSON.parse(localStorage.getItem(VARIABLE_CATALOG_STORAGE_KEY) ?? '[]')).toEqual(existingVariables);
    });

    it('rejects broken layout and header references before persistence', async () => {
        const existingDashboards = [makeDashboard({ id: 'existing-dashboard', name: 'Existing dashboard' })];
        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify(existingDashboards));

        const importPromise = dashboardPortabilityService.importDashboard(JSON.stringify(makePortableFile({
            dashboard: {
                id: 'source-dashboard',
                name: 'Broken portable dashboard',
                description: 'Broken portable description',
                dashboardType: 'equipment',
                aspect: '16:9',
                cols: 16,
                rows: 10,
                widgets: [
                    makeWidget({ id: 'widget-grid', title: 'Grid widget' }),
                    makeWidget({ id: 'widget-header', type: 'status', title: 'Header widget' }),
                    makeWidget({ id: 'widget-not-header-compatible', title: 'Not header compatible' }),
                ],
                layout: [
                    makeLayout({ widgetId: 'widget-grid', x: 0, y: 0, w: 4, h: 3 }),
                    makeLayout({ widgetId: 'widget-missing', x: 4, y: 0, w: 4, h: 3 }),
                ],
                headerConfig: {
                    title: 'Broken header',
                    widgetSlots: [
                        { widgetId: 'widget-header', column: 0 },
                        { widgetId: 'widget-missing-header', column: 1 },
                        { widgetId: 'widget-not-header-compatible', column: 2 },
                        { widgetId: 'widget-grid', column: 3 },
                    ],
                },
            },
        })));
        const instanceCheck = expect(importPromise).rejects.toBeInstanceOf(DashboardPortabilityValidationError);
        const rejection = expect(importPromise).rejects.toMatchObject({
            issues: expect.arrayContaining([
                expect.objectContaining({ code: 'invalid_layout_widget_reference' }),
                expect.objectContaining({ code: 'header_slot_limit_exceeded' }),
                expect.objectContaining({ code: 'invalid_header_widget_reference' }),
                expect.objectContaining({ code: 'invalid_header_widget_type' }),
                expect.objectContaining({ code: 'invalid_header_widget_column' }),
            ]),
        });

        await vi.advanceTimersByTimeAsync(1000);

        await instanceCheck;
        await rejection;
        expect(JSON.parse(localStorage.getItem(DASHBOARDS_STORAGE_KEY) ?? '[]')).toEqual(existingDashboards);
    });

    it('reports missing required top-level collections instead of throwing a runtime error', async () => {
        const existingDashboards = [makeDashboard({ id: 'existing-dashboard', name: 'Existing dashboard' })];
        const existingVariables = [makeVariable({ id: 'existing-variable', name: 'Existing variable', unit: 'RPM' })];

        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify(existingDashboards));
        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify(existingVariables));

        const importPromise = dashboardPortabilityService.importDashboard(JSON.stringify({
            schemaVersion: 1,
            exportedAt: '2026-06-30T12:34:56.000Z',
            origin: {
                app: 'interfaz-laboratorio',
                dashboardId: 'source-dashboard',
                dashboardName: 'Broken dashboard',
            },
            dashboard: {
                id: 'source-dashboard',
                name: 'Broken dashboard',
                description: 'Missing required arrays',
                dashboardType: 'line',
                aspect: '21:9',
                cols: 24,
                rows: 12,
            },
        }));
        const instanceCheck = expect(importPromise).rejects.toBeInstanceOf(DashboardPortabilityValidationError);
        const rejection = expect(importPromise).rejects.toMatchObject({
            issues: expect.arrayContaining([
                expect.objectContaining({ code: 'missing_referenced_catalog_variables', path: 'referencedCatalogVariables' }),
                expect.objectContaining({ code: 'missing_dashboard_widgets', path: 'dashboard.widgets' }),
                expect.objectContaining({ code: 'missing_dashboard_layout', path: 'dashboard.layout' }),
            ]),
        });

        await vi.advanceTimersByTimeAsync(1000);

        await instanceCheck;
        await rejection;
        expect(JSON.parse(localStorage.getItem(DASHBOARDS_STORAGE_KEY) ?? '[]')).toEqual(existingDashboards);
        expect(JSON.parse(localStorage.getItem(VARIABLE_CATALOG_STORAGE_KEY) ?? '[]')).toEqual(existingVariables);
    });

    it('imports a valid file as a remapped draft with guarded catalog reconciliation', async () => {
        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify([
            makeDashboard({ id: 'existing-dashboard', name: 'Existing dashboard' }),
        ]));
        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify([
            makeVariable({ id: 'local-speed-rpm', name: 'Rotor speed', unit: 'RPM' }),
            makeVariable({ id: 'local-pressure-kpa', name: 'Line pressure', unit: 'kPa' }),
        ]));

        const importPromise = dashboardPortabilityService.importDashboard(JSON.stringify(makePortableFile({
            dashboard: {
                id: 'source-dashboard',
                name: 'Imported dashboard',
                description: 'Imported from another HMI',
                dashboardType: 'line',
                aspect: '21:9',
                cols: 30,
                rows: 14,
                widgets: [
                    makeWidget({
                        id: 'widget-speed',
                        title: 'Rotor speed widget',
                        binding: { mode: 'real_variable', catalogVariableId: 'source-speed' },
                    }),
                    makeWidget({
                        id: 'widget-pressure',
                        title: 'Line pressure widget',
                        binding: { mode: 'real_variable', catalogVariableId: 'source-pressure' },
                    }),
                    makeWidget({
                        id: 'widget-header',
                        type: 'status',
                        title: 'Header status widget',
                    }),
                    {
                        ...makeWidget({
                            id: 'widget-alert-self',
                            title: 'Self alert widget',
                        }),
                        type: 'alert-history',
                        displayOptions: { dashboardId: 'source-dashboard', maxVisible: 10 },
                    },
                    {
                        ...makeWidget({
                            id: 'widget-alert-external',
                            title: 'External alert widget',
                        }),
                        type: 'alert-history',
                        displayOptions: { dashboardId: 'external-dashboard', maxVisible: 5 },
                    },
                ],
                layout: [
                    makeLayout({ widgetId: 'widget-speed', x: 0, y: 0, w: 5, h: 4 }),
                    makeLayout({ widgetId: 'widget-pressure', x: 5, y: 0, w: 5, h: 4 }),
                    makeLayout({ widgetId: 'widget-alert-self', x: 0, y: 4, w: 8, h: 4 }),
                    makeLayout({ widgetId: 'widget-alert-external', x: 8, y: 4, w: 8, h: 4 }),
                ],
                headerConfig: {
                    title: 'Imported header',
                    widgetSlots: [{ widgetId: 'widget-header', column: 1 }],
                },
            },
            referencedCatalogVariables: [
                makeVariable({ id: 'source-speed', name: 'Rotor speed', unit: 'RPM' }),
                makeVariable({ id: 'source-pressure', name: 'Line pressure', unit: 'bar' }),
            ],
        })));

        await vi.advanceTimersByTimeAsync(2000);
        const result = await importPromise as DashboardImportResult;

        expect(result.dashboard.id).not.toBe('source-dashboard');
        expect(result.dashboard.dashboardType).toBe('line');
        expect(result.dashboard.aspect).toBe('21:9');
        expect(result.dashboard.cols).toBe(30);
        expect(result.dashboard.rows).toBe(14);
        expect(result.dashboard.status).toBe('draft');
        expect(result.dashboard.version).toBe(1);
        expect(result.dashboard.ownerNodeId).toBeUndefined();
        expect(result.dashboard.templateId).toBeUndefined();
        expect(result.dashboard.publishedSnapshot).toBeUndefined();

        const widgetsByTitle = new Map(result.dashboard.widgets.map((widget) => [widget.title, widget]));
        const speedWidget = widgetsByTitle.get('Rotor speed widget');
        const pressureWidget = widgetsByTitle.get('Line pressure widget');
        const headerWidget = widgetsByTitle.get('Header status widget');
        const selfAlertWidget = widgetsByTitle.get('Self alert widget');
        const externalAlertWidget = widgetsByTitle.get('External alert widget');
        const createdPressureVariableId = result.createdCatalogVariables[0]?.id;

        expect(speedWidget?.id).not.toBe('widget-speed');
        expect(speedWidget?.binding?.catalogVariableId).toBe('local-speed-rpm');
        expect(createdPressureVariableId).toBeTruthy();
        expect(pressureWidget?.binding?.catalogVariableId).toBe(createdPressureVariableId);
        expect(pressureWidget?.binding?.catalogVariableId).not.toBe('local-pressure-kpa');
        expect(headerWidget?.id).not.toBe('widget-header');
        expect(result.dashboard.headerConfig?.widgetSlots).toEqual([{ widgetId: headerWidget?.id, column: 1 }]);
        expect(result.dashboard.layout.map((item) => item.widgetId)).toEqual([
            speedWidget?.id,
            pressureWidget?.id,
            selfAlertWidget?.id,
            externalAlertWidget?.id,
        ]);
        expect((selfAlertWidget as { displayOptions?: { dashboardId?: string } } | undefined)?.displayOptions?.dashboardId).toBe(result.dashboard.id);
        expect((externalAlertWidget as { displayOptions?: { dashboardId?: string } } | undefined)?.displayOptions?.dashboardId).toBeUndefined();
        expect(result.createdCatalogVariables).toEqual([
            expect.objectContaining({ id: createdPressureVariableId, name: 'Line pressure', unit: 'bar' }),
        ]);
        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'external_dashboard_reference_cleared', severity: 'warning' }),
        ]));

        const storedDashboards = JSON.parse(localStorage.getItem(DASHBOARDS_STORAGE_KEY) ?? '[]');
        expect(storedDashboards).toHaveLength(2);
        expect(storedDashboards[1]).toMatchObject({
            id: result.dashboard.id,
            name: 'Imported dashboard',
            dashboardType: 'line',
            aspect: '21:9',
            cols: 30,
            rows: 14,
            status: 'draft',
            version: 1,
        });

        const storedVariables = JSON.parse(localStorage.getItem(VARIABLE_CATALOG_STORAGE_KEY) ?? '[]');
        expect(storedVariables).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'local-speed-rpm', name: 'Rotor speed', unit: 'RPM' }),
            expect.objectContaining({ id: 'local-pressure-kpa', name: 'Line pressure', unit: 'kPa' }),
            expect.objectContaining({ id: createdPressureVariableId, name: 'Line pressure', unit: 'bar' }),
        ]));
    });
});
