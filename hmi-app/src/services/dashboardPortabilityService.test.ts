import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogVariable } from '../domain';
import {
    makeDashboard,
    makeInfoCardWidget,
    makeLayout,
    makeWidget,
} from '../test/fixtures/dashboard.fixture';
import { DASHBOARDS_STORAGE_KEY, VARIABLE_CATALOG_STORAGE_KEY } from '../utils/legacyStorageCleanup';
import {
    type DashboardImportResult,
    DashboardPortabilityValidationError,
    type PortableDashboardFileV1,
    type PortableDashboardFileV2,
    dashboardPortabilityService,
    sanitizePortableDashboardFileName,
} from './dashboardPortabilityService';
import { createDefaultDashboardView } from '../utils/dashboardViews';
import { dashboardStorage } from './DashboardStorageService';
import { variableCatalogStorage } from './VariableCatalogStorageService';

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

function snapshotLocalStorage(): Map<string, string> {
    const snapshot = new Map<string, string>();

    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);

        if (!key) {
            continue;
        }

        const value = localStorage.getItem(key);

        if (value !== null) {
            snapshot.set(key, value);
        }
    }

    return snapshot;
}

describe('dashboardPortabilityService.exportDashboard', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-30T12:34:56.000Z'));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
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
            activeViewId: 'view-production',
            widgets: [
                makeWidget({
                    id: 'widget-speed',
                    binding: { mode: 'real_variable', catalogVariableId: 'cv-rotor-speed-rpm' },
                }),
            ],
            layout: [makeLayout({ widgetId: 'widget-speed', x: 2, y: 3, w: 5, h: 4 })],
            views: [
                createDefaultDashboardView({
                    id: 'view-production',
                    name: 'Production',
                    widgets: [
                        makeWidget({
                            id: 'widget-speed',
                            binding: { mode: 'real_variable', catalogVariableId: 'cv-rotor-speed-rpm' },
                        }),
                    ],
                    layout: [makeLayout({ widgetId: 'widget-speed', x: 2, y: 3, w: 5, h: 4 })],
                }),
            ],
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
            schemaVersion: 2,
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
                activeViewId: 'view-production',
                views: [
                    expect.objectContaining({
                        id: 'view-production',
                        name: 'Production',
                        order: 0,
                        widgets: [
                            expect.objectContaining({
                                id: 'widget-speed',
                                binding: { mode: 'real_variable', catalogVariableId: 'cv-rotor-speed-rpm' },
                            }),
                        ],
                    }),
                ],
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
        expect(portableFile.dashboard).not.toHaveProperty('widgets');
        expect(portableFile.dashboard).not.toHaveProperty('layout');
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
        expect(portableFile.dashboard.views?.[0]?.widgets).toEqual([
            expect.objectContaining({ binding: { mode: 'real_variable', catalogVariableId: 'cv-rotor-speed-rpm' } }),
            expect.objectContaining({ binding: { mode: 'real_variable', catalogVariableId: 'cv-rotor-speed-rpm' } }),
            expect.objectContaining({ binding: { mode: 'real_variable', catalogVariableId: 'cv-hydraulic-pressure-bar' } }),
        ]);
    });

    it('keeps export read-only by avoiding network writes and preserving local configuration storage', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify([
            makeDashboard({ id: 'existing-dashboard', name: 'Existing dashboard' }),
        ]));
        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify([
            makeVariable(),
        ]));
        localStorage.setItem('process-control-shadow', JSON.stringify({ mode: 'read-only' }));

        const beforeExport = snapshotLocalStorage();
        const exportPromise = dashboardPortabilityService.exportDashboard(makeDashboard({
            id: 'dashboard-read-only-export',
            name: 'Read only export',
            widgets: [
                makeWidget({
                    id: 'widget-speed',
                    binding: { mode: 'real_variable', catalogVariableId: 'cv-rotor-speed-rpm' },
                }),
            ],
        }));

        await vi.advanceTimersByTimeAsync(200);
        const exportResult = await exportPromise;

        expect(exportResult.portableFile.schemaVersion).toBe(2);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(snapshotLocalStorage()).toEqual(beforeExport);
    });

    it('round-trips every internal view while preserving a non-first active view and deep widget data', async () => {
        const dashboard = makeDashboard({
            id: 'dashboard-portable-roundtrip',
            name: 'Portable roundtrip',
            description: 'All tabs preserved',
            dashboardType: 'line',
            aspect: '21:9',
            cols: 30,
            rows: 16,
            activeViewId: 'view-technical',
            views: [
                createDefaultDashboardView({
                    id: 'view-production',
                    name: 'Production',
                    order: 0,
                    widgets: [
                        makeInfoCardWidget({
                            id: 'widget-info-production',
                            title: 'Production summary',
                            displayOptions: {
                                subtitle: 'Runtime summary',
                                helpText: 'Preserve all display options.',
                                icon: 'Gauge',
                                valueFontSize: 'lg',
                                fields: [
                                    { id: 'field-batch', label: 'Batch', value: 'B-204' },
                                    { id: 'field-lot', label: 'Lot', value: 'LT-99' },
                                ],
                            },
                        }),
                    ],
                    layout: [
                        makeLayout({ widgetId: 'widget-info-production', x: 1, y: 2, w: 8, h: 5 }),
                    ],
                }),
                createDefaultDashboardView({
                    id: 'view-technical',
                    name: 'Technical',
                    order: 1,
                    widgets: [
                        {
                            ...makeWidget({
                                id: 'widget-alert-technical',
                                title: 'Technical alerts',
                            }),
                            type: 'alert-history' as const,
                            displayOptions: { dashboardId: 'dashboard-portable-roundtrip', maxVisible: 7 },
                        },
                        {
                            ...makeWidget({
                                id: 'widget-header-technical',
                                title: 'Header status',
                            }),
                            type: 'status' as const,
                        },
                    ],
                    layout: [
                        makeLayout({ widgetId: 'widget-alert-technical', x: 6, y: 1, w: 10, h: 4 }),
                    ],
                }),
            ],
            headerConfig: {
                title: 'Portable dashboard header',
                widgetSlots: [{ widgetId: 'widget-header-technical', column: 2 }],
            },
        });

        const exportPromise = dashboardPortabilityService.exportDashboard(dashboard);

        await vi.advanceTimersByTimeAsync(200);
        const exportResult = await exportPromise;
        const portableFile = JSON.parse(exportResult.json) as PortableDashboardFileV2;

        expect(portableFile.dashboard.activeViewId).toBe('view-technical');
        expect(portableFile.dashboard.views).toEqual([
            expect.objectContaining({
                id: 'view-production',
                name: 'Production',
                layout: [expect.objectContaining({ widgetId: 'widget-info-production', x: 1, y: 2, w: 8, h: 5 })],
                widgets: [
                    expect.objectContaining({
                        id: 'widget-info-production',
                        title: 'Production summary',
                        displayOptions: expect.objectContaining({
                            subtitle: 'Runtime summary',
                            helpText: 'Preserve all display options.',
                            icon: 'Gauge',
                            valueFontSize: 'lg',
                            fields: [
                                { id: 'field-batch', label: 'Batch', value: 'B-204' },
                                { id: 'field-lot', label: 'Lot', value: 'LT-99' },
                            ],
                        }),
                    }),
                ],
            }),
            expect.objectContaining({
                id: 'view-technical',
                name: 'Technical',
                layout: [expect.objectContaining({ widgetId: 'widget-alert-technical', x: 6, y: 1, w: 10, h: 4 })],
                widgets: [
                    expect.objectContaining({
                        id: 'widget-alert-technical',
                        title: 'Technical alerts',
                        displayOptions: expect.objectContaining({
                            dashboardId: 'dashboard-portable-roundtrip',
                            maxVisible: 7,
                        }),
                    }),
                    expect.objectContaining({
                        id: 'widget-header-technical',
                        title: 'Header status',
                        type: 'status',
                    }),
                ],
            }),
        ]);
        expect(portableFile.dashboard.headerConfig).toEqual({
            title: 'Portable dashboard header',
            widgetSlots: [{ widgetId: 'widget-header-technical', column: 2 }],
        });

        const importPromise = dashboardPortabilityService.importDashboard(exportResult.json);

        await vi.advanceTimersByTimeAsync(1000);
        const importResult = await importPromise;

        expect(importResult.dashboard.views?.map((view) => view.name)).toEqual(['Production', 'Technical']);
        expect(importResult.dashboard.activeViewId).toBe(importResult.dashboard.views?.[1]?.id);
        expect(importResult.dashboard.widgets).toEqual(importResult.dashboard.views?.[1]?.widgets);
        expect(importResult.dashboard.layout).toEqual(importResult.dashboard.views?.[1]?.layout);
        expect(importResult.dashboard.views?.[0]).toEqual(expect.objectContaining({
            name: 'Production',
            widgets: [
                expect.objectContaining({
                    title: 'Production summary',
                    displayOptions: expect.objectContaining({
                        subtitle: 'Runtime summary',
                        helpText: 'Preserve all display options.',
                        fields: [
                            { id: 'field-batch', label: 'Batch', value: 'B-204' },
                            { id: 'field-lot', label: 'Lot', value: 'LT-99' },
                        ],
                    }),
                }),
            ],
            layout: [expect.objectContaining({ x: 1, y: 2, w: 8, h: 5 })],
        }));
        expect(importResult.dashboard.views?.[1]).toEqual(expect.objectContaining({
            name: 'Technical',
            widgets: expect.arrayContaining([
                expect.objectContaining({
                    title: 'Technical alerts',
                    displayOptions: expect.objectContaining({ maxVisible: 7 }),
                }),
                expect.objectContaining({
                    title: 'Header status',
                    type: 'status',
                }),
            ]),
            layout: [expect.objectContaining({ x: 6, y: 1, w: 10, h: 4 })],
        }));

        const importedTechnicalWidgets = importResult.dashboard.views?.[1]?.widgets ?? [];
        const importedTechnicalHeaderWidget = importedTechnicalWidgets.find((widget) => widget.title === 'Header status');
        expect(importResult.dashboard.headerConfig?.widgetSlots).toEqual([
            { widgetId: importedTechnicalHeaderWidget?.id, column: 2 },
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
        vi.unstubAllGlobals();
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

    it('rejects invalid schema v2 active-view references and duplicate view ids before persistence', async () => {
        const existingDashboards = [makeDashboard({ id: 'existing-dashboard', name: 'Existing dashboard' })];
        const existingVariables = [makeVariable({ id: 'existing-variable', name: 'Existing variable', unit: 'RPM' })];

        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify(existingDashboards));
        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify(existingVariables));

        const importPromise = dashboardPortabilityService.importDashboard(JSON.stringify({
            schemaVersion: 2,
            exportedAt: '2026-07-01T10:00:00.000Z',
            origin: {
                app: 'interfaz-laboratorio',
                dashboardId: 'portable-dashboard',
                dashboardName: 'Portable dashboard',
            },
            dashboard: {
                id: 'portable-dashboard',
                name: 'Portable dashboard',
                description: 'Broken schema v2 shape',
                dashboardType: 'line',
                aspect: '21:9',
                cols: 24,
                rows: 12,
                activeViewId: 'view-missing',
                views: [
                    {
                        id: 'view-duplicate',
                        name: 'Production',
                        order: 0,
                        widgets: [makeWidget({ id: 'widget-production', title: 'Production widget' })],
                        layout: [makeLayout({ widgetId: 'widget-production', x: 0, y: 0, w: 4, h: 4 })],
                    },
                    {
                        id: 'view-duplicate',
                        name: 'Technical',
                        order: 1,
                        widgets: [makeWidget({ id: 'widget-technical', title: 'Technical widget' })],
                        layout: [makeLayout({ widgetId: 'widget-technical', x: 4, y: 0, w: 4, h: 4 })],
                    },
                ],
                headerConfig: undefined,
            },
            referencedCatalogVariables: [],
        })).then(
            (value) => ({ value }),
            (error) => ({ error }),
        );
        await vi.advanceTimersByTimeAsync(1000);

        const result = await importPromise;
        const rejection = 'error' in result ? result.error : undefined;

        expect(rejection).toBeInstanceOf(DashboardPortabilityValidationError);
        expect(rejection).toMatchObject({
            issues: expect.arrayContaining([
                expect.objectContaining({ code: 'invalid_active_view_reference', path: 'dashboard.activeViewId' }),
                expect.objectContaining({ code: 'duplicate_view_id', path: 'dashboard.views[view-duplicate]' }),
            ]),
        });
        expect(JSON.parse(localStorage.getItem(DASHBOARDS_STORAGE_KEY) ?? '[]')).toEqual(existingDashboards);
        expect(JSON.parse(localStorage.getItem(VARIABLE_CATALOG_STORAGE_KEY) ?? '[]')).toEqual(existingVariables);
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

    it('keeps import inside local HMI configuration by mutating only dashboard and catalog storage', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify([
            makeDashboard({ id: 'existing-dashboard', name: 'Existing dashboard' }),
        ]));
        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify([]));
        localStorage.setItem('process-control-shadow', JSON.stringify({ mode: 'read-only' }));

        const beforeImport = snapshotLocalStorage();
        const importPromise = dashboardPortabilityService.importDashboard(JSON.stringify(makePortableFile({
            dashboard: {
                id: 'portable-dashboard-read-only',
                name: 'Imported dashboard',
                description: 'Local configuration only',
                dashboardType: 'line',
                aspect: '21:9',
                cols: 24,
                rows: 12,
                widgets: [
                    makeWidget({
                        id: 'widget-speed',
                        title: 'Rotor speed widget',
                        binding: { mode: 'real_variable', catalogVariableId: 'source-speed' },
                    }),
                ],
                layout: [makeLayout({ widgetId: 'widget-speed', x: 0, y: 0, w: 4, h: 4 })],
                headerConfig: undefined,
            },
            referencedCatalogVariables: [
                makeVariable({ id: 'source-speed', name: 'Rotor speed', unit: 'RPM' }),
            ],
        })));

        await vi.advanceTimersByTimeAsync(1000);
        const importResult = await importPromise;
        const afterImport = snapshotLocalStorage();

        expect(importResult.dashboard.name).toBe('Imported dashboard');
        expect(importResult.createdCatalogVariables).toHaveLength(1);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(afterImport.get('process-control-shadow')).toBe(beforeImport.get('process-control-shadow'));
        expect(afterImport.get(DASHBOARDS_STORAGE_KEY)).not.toBe(beforeImport.get(DASHBOARDS_STORAGE_KEY));
        expect(afterImport.get(VARIABLE_CATALOG_STORAGE_KEY)).not.toBe(beforeImport.get(VARIABLE_CATALOG_STORAGE_KEY));
        expect(Array.from(afterImport.keys()).sort()).toEqual(Array.from(beforeImport.keys()).sort());
    });

    it('rolls back created catalog variables when dashboard persistence fails during import', async () => {
        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify([
            makeDashboard({ id: 'existing-dashboard', name: 'Existing dashboard' }),
        ]));
        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify([]));

        vi.spyOn(dashboardStorage, 'saveDashboard').mockRejectedValue(new Error('Disk full while saving dashboard'));

        const importPromise = dashboardPortabilityService.importDashboard(JSON.stringify(makePortableFile({
            dashboard: {
                id: 'portable-dashboard-compensation',
                name: 'Imported dashboard',
                description: 'Should roll back variable creation',
                dashboardType: 'line',
                aspect: '21:9',
                cols: 24,
                rows: 12,
                widgets: [
                    makeWidget({
                        id: 'widget-speed',
                        title: 'Rotor speed widget',
                        binding: { mode: 'real_variable', catalogVariableId: 'source-speed' },
                    }),
                ],
                layout: [makeLayout({ widgetId: 'widget-speed', x: 0, y: 0, w: 4, h: 4 })],
                headerConfig: undefined,
            },
            referencedCatalogVariables: [
                makeVariable({ id: 'source-speed', name: 'Rotor speed', unit: 'RPM' }),
            ],
        }))).then(
            (value) => ({ value }),
            (error) => ({ error }),
        );

        await vi.advanceTimersByTimeAsync(1000);

        const result = await importPromise;
        expect('error' in result ? result.error : undefined).toBeInstanceOf(Error);
        expect('error' in result ? result.error.message : '').toBe('Disk full while saving dashboard');
        expect(JSON.parse(localStorage.getItem(DASHBOARDS_STORAGE_KEY) ?? '[]')).toEqual([
            expect.objectContaining({ id: 'existing-dashboard', name: 'Existing dashboard' }),
        ]);
        expect(JSON.parse(localStorage.getItem(VARIABLE_CATALOG_STORAGE_KEY) ?? '[]')).toEqual([]);

    });

    it('rolls back already-created catalog variables when reconciliation fails after partial creation', async () => {
        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify([
            makeDashboard({ id: 'existing-dashboard', name: 'Existing dashboard' }),
        ]));
        localStorage.setItem(VARIABLE_CATALOG_STORAGE_KEY, JSON.stringify([]));

        const originalCreate = variableCatalogStorage.create.bind(variableCatalogStorage);
        const createSpy = vi.spyOn(variableCatalogStorage, 'create');
        createSpy.mockImplementationOnce((variable) => originalCreate(variable));
        createSpy.mockRejectedValueOnce(new Error('Catalog storage write failed'));

        const saveDashboardSpy = vi.spyOn(dashboardStorage, 'saveDashboard');

        const importPromise = dashboardPortabilityService.importDashboard(JSON.stringify(makePortableFile({
            dashboard: {
                id: 'portable-dashboard-partial-catalog-failure',
                name: 'Imported dashboard',
                description: 'Should roll back partial catalog reconciliation',
                dashboardType: 'line',
                aspect: '21:9',
                cols: 24,
                rows: 12,
                widgets: [
                    makeWidget({
                        id: 'widget-speed',
                        title: 'Rotor speed widget',
                        binding: { mode: 'real_variable', catalogVariableId: 'source-speed' },
                    }),
                    makeWidget({
                        id: 'widget-pressure',
                        title: 'Hydraulic pressure widget',
                        binding: { mode: 'real_variable', catalogVariableId: 'source-pressure' },
                    }),
                ],
                layout: [
                    makeLayout({ widgetId: 'widget-speed', x: 0, y: 0, w: 4, h: 4 }),
                    makeLayout({ widgetId: 'widget-pressure', x: 4, y: 0, w: 4, h: 4 }),
                ],
                headerConfig: undefined,
            },
            referencedCatalogVariables: [
                makeVariable({ id: 'source-speed', name: 'Rotor speed', unit: 'RPM' }),
                makeVariable({ id: 'source-pressure', name: 'Hydraulic pressure', unit: 'bar' }),
            ],
        }))).then(
            (value) => ({ value }),
            (error) => ({ error }),
        );

        await vi.advanceTimersByTimeAsync(1000);

        const result = await importPromise;
        expect('error' in result ? result.error : undefined).toBeInstanceOf(Error);
        expect('error' in result ? result.error.message : '').toBe('Catalog storage write failed');
        expect(saveDashboardSpy).not.toHaveBeenCalled();
        expect(JSON.parse(localStorage.getItem(DASHBOARDS_STORAGE_KEY) ?? '[]')).toEqual([
            expect.objectContaining({ id: 'existing-dashboard', name: 'Existing dashboard' }),
        ]);
        expect(JSON.parse(localStorage.getItem(VARIABLE_CATALOG_STORAGE_KEY) ?? '[]')).toEqual([]);
    });

    it('imports a legacy schema v1 file as a single default internal view', async () => {
        const importPromise = dashboardPortabilityService.importDashboard(JSON.stringify(makePortableFile({
            dashboard: {
                id: 'legacy-dashboard',
                name: 'Legacy portable dashboard',
                description: 'Legacy single view payload',
                dashboardType: 'equipment',
                aspect: '16:9',
                cols: 20,
                rows: 12,
                widgets: [makeWidget({ id: 'widget-legacy', title: 'Legacy widget' })],
                layout: [makeLayout({ widgetId: 'widget-legacy', x: 1, y: 2, w: 4, h: 3 })],
                headerConfig: { title: 'Legacy header' },
            },
        })));

        await vi.advanceTimersByTimeAsync(1000);
        const result = await importPromise;

        expect(result.dashboard.views).toEqual([
            expect.objectContaining({
                name: 'Default view',
                widgets: [expect.objectContaining({ title: 'Legacy widget' })],
                layout: [expect.objectContaining({ x: 1, y: 2, w: 4, h: 3 })],
            }),
        ]);
        expect(result.dashboard.activeViewId).toBe(result.dashboard.views?.[0]?.id);
    });

    it('preserves and remaps multi-view exports when importing schema v2 files', async () => {
        const importPromise = dashboardPortabilityService.importDashboard(JSON.stringify({
            schemaVersion: 2,
            exportedAt: '2026-07-01T10:00:00.000Z',
            origin: {
                app: 'interfaz-laboratorio',
                dashboardId: 'source-dashboard-v2',
                dashboardName: 'Portable dashboard v2',
            },
            dashboard: {
                id: 'source-dashboard-v2',
                name: 'Portable dashboard v2',
                description: 'Two views',
                dashboardType: 'line',
                aspect: '21:9',
                cols: 24,
                rows: 12,
                activeViewId: 'view-technical',
                views: [
                    {
                        id: 'view-production',
                        name: 'Production',
                        order: 0,
                        widgets: [makeWidget({ id: 'widget-shared', title: 'Production widget' })],
                        layout: [makeLayout({ widgetId: 'widget-shared', x: 0, y: 0, w: 4, h: 4 })],
                    },
                    {
                        id: 'view-technical',
                        name: 'Technical',
                        order: 1,
                        widgets: [
                            makeWidget({ id: 'widget-grid', title: 'Technical grid widget' }),
                            { ...makeWidget({ id: 'widget-header', title: 'Technical header widget' }), type: 'status' as const },
                        ],
                        layout: [makeLayout({ widgetId: 'widget-grid', x: 4, y: 0, w: 4, h: 4 })],
                    },
                ],
                headerConfig: {
                    title: 'Portable dashboard v2',
                    widgetSlots: [{ widgetId: 'widget-header', column: 0 }],
                },
            },
            referencedCatalogVariables: [],
        }));

        await vi.advanceTimersByTimeAsync(1000);
        const result = await importPromise;

        expect(result.dashboard.views).toHaveLength(2);
        expect(result.dashboard.views?.map((view) => view.name)).toEqual(['Production', 'Technical']);
        expect(result.dashboard.views?.map((view) => view.order)).toEqual([0, 1]);
        expect(result.dashboard.views?.[0]?.widgets[0]?.id).not.toBe('widget-shared');
        expect(result.dashboard.views?.[1]?.widgets[0]?.id).not.toBe('widget-shared');
        expect(result.dashboard.views?.[0]?.widgets[0]?.id).not.toBe(result.dashboard.views?.[1]?.widgets[0]?.id);
        expect(result.dashboard.activeViewId).toBe(result.dashboard.views?.[1]?.id);
        expect(result.dashboard.layout).toEqual(result.dashboard.views?.[1]?.layout);
        expect(result.dashboard.widgets).toEqual(result.dashboard.views?.[1]?.widgets);
    });
});

describe('sanitizePortableDashboardFileName', () => {
    it('normalizes edited names into safe json filenames', () => {
        expect(sanitizePortableDashboardFileName('  Principal/edición final  ')).toBe(
            'Principal-edicion-final.json',
        );
    });
});
