import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardBuilderPage from './DashboardBuilderPage';
import { makeDashboard, makeLayout, makeWidget } from '../../test/fixtures/dashboard.fixture';
import { useUIStore } from '../../store/ui.store';
import type { ConnectionHealth, ContractMachine } from '../../domain/dataContract.types';
import { HEADER_WIDGET_DRAG_MIME } from '../../utils/headerWidgets';
import type { HierarchyNode } from '../../domain/admin.types';

type ResizeObserverCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

const resizeCallbacks = new Map<Element, Set<ResizeObserverCallback>>();
const {
    mockNavigate,
    dashboardStorageMock,
    templateStorageMock,
    hierarchyStorageMock,
    variableCatalogStorageMock,
    loadNodeTypeLabelsMock,
    resolveTypeLabelMock,
    migrateLegacyBindingsMock,
    useDataOverviewMock,
    propertyDockMock,
    dashboardHeaderMock,
    builderCanvasMock,
} = vi.hoisted(() => ({
    mockNavigate: vi.fn(),
    dashboardStorageMock: {
        getDashboard: vi.fn(),
        getDashboards: vi.fn(),
        saveDashboard: vi.fn(),
        publishDashboard: vi.fn(),
        applyTemplate: vi.fn(),
    },
    templateStorageMock: {
        getTemplates: vi.fn(),
    },
    hierarchyStorageMock: {
        getNodes: vi.fn(),
    },
    variableCatalogStorageMock: {
        getAll: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
        getAffectedDashboards: vi.fn(),
    },
    loadNodeTypeLabelsMock: vi.fn(),
    resolveTypeLabelMock: vi.fn((type: string) => type),
    migrateLegacyBindingsMock: vi.fn(),
    useDataOverviewMock: vi.fn(),
    propertyDockMock: vi.fn(),
    dashboardHeaderMock: vi.fn(),
    builderCanvasMock: vi.fn(),
}));

class MockResizeObserver implements ResizeObserver {
    public readonly boxOptions = '';
    private readonly observedElements = new Set<Element>();
    private readonly callback: ResizeObserverCallback;

    public constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
    }

    public observe(target: Element): void {
        this.observedElements.add(target);
        const callbacks = resizeCallbacks.get(target) ?? new Set<ResizeObserverCallback>();
        callbacks.add(this.callback);
        resizeCallbacks.set(target, callbacks);
    }

    public unobserve(target: Element): void {
        this.observedElements.delete(target);
        const callbacks = resizeCallbacks.get(target);
        callbacks?.delete(this.callback);
        if (callbacks?.size === 0) {
            resizeCallbacks.delete(target);
        }
    }

    public disconnect(): void {
        for (const element of this.observedElements) {
            this.unobserve(element);
        }
    }
}

function emitResize(target: Element, width: number, height: number) {
    const callbacks = resizeCallbacks.get(target);

    if (!callbacks || callbacks.size === 0) {
        throw new Error('No ResizeObserver registered for the target element.');
    }

    const entry = {
        target,
        contentRect: { width, height },
    } as ResizeObserverEntry;

    for (const callback of callbacks) {
        callback([entry], {} as ResizeObserver);
    }
}

async function syncViewportResize(target: Element, width: number, height: number) {
    if ((resizeCallbacks.get(target)?.size ?? 0) === 0) {
        return;
    }

    await act(async () => {
        emitResize(target, width, height);
    });
}

async function renderBuilderPage(
    dashboard = makeDashboard({
        id: 'dashboard-1',
        cols: 20,
        rows: 12,
        widgets: [makeWidget({ id: 'widget-1', title: 'Widget 1' })],
        layout: [makeLayout({ widgetId: 'widget-1', x: 0, y: 0, w: 4, h: 3 })],
    }),
    options?: {
        allDashboards?: ReturnType<typeof makeDashboard>[];
        allNodes?: HierarchyNode[];
    },
) {
    dashboardStorageMock.getDashboard.mockResolvedValue(dashboard);
    dashboardStorageMock.getDashboards.mockResolvedValue(options?.allDashboards ?? [dashboard]);
    dashboardStorageMock.applyTemplate.mockImplementation((currentDashboard, template) => ({
        ...currentDashboard,
        widgets: template.widgetPresets ?? [],
        layout: template.layoutPreset ?? [],
    }));
    if (!templateStorageMock.getTemplates.getMockImplementation()) {
        templateStorageMock.getTemplates.mockResolvedValue([]);
    }
    hierarchyStorageMock.getNodes.mockResolvedValue(options?.allNodes ?? []);
    variableCatalogStorageMock.getAll.mockResolvedValue([]);
    variableCatalogStorageMock.getAffectedDashboards.mockResolvedValue([]);
    loadNodeTypeLabelsMock.mockResolvedValue(undefined);
    migrateLegacyBindingsMock.mockResolvedValue([]);

    const view = render(<DashboardBuilderPage />);

    await waitFor(() => {
        expect(screen.getByRole('button', { name: /grid/i })).toBeInTheDocument();
    });

    const viewport = screen.getByTestId('dashboard-builder-canvas-viewport');
    await syncViewportResize(viewport, 1200, 675);

    return view;
}

function getBuilderCanvasSnapshot() {
    const node = screen.getByTestId('builder-canvas-props');
    return {
        cols: Number(node.getAttribute('data-cols')),
        rows: Number(node.getAttribute('data-rows')),
        widgetIds: JSON.parse(node.getAttribute('data-widget-ids') ?? '[]') as string[],
        layout: JSON.parse(node.getAttribute('data-layout') ?? '[]') as Array<{ widgetId: string; x: number; y: number; w: number; h: number }>,
    };
}

vi.mock('react-router-dom', () => ({
    useParams: () => ({ id: 'dashboard-1' }),
    useNavigate: () => mockNavigate,
    useBlocker: () => ({ state: 'unblocked', reset: vi.fn(), proceed: vi.fn() }),
}));

vi.mock('../../services/DashboardStorageService', () => ({
    dashboardStorage: dashboardStorageMock,
}));

vi.mock('../../services/HierarchyStorageService', () => ({
    hierarchyStorage: hierarchyStorageMock,
}));

vi.mock('../../services/TemplateStorageService', () => ({
    templateStorage: templateStorageMock,
}));

vi.mock('../../services/VariableCatalogStorageService', () => ({
    variableCatalogStorage: variableCatalogStorageMock,
}));

vi.mock('../../utils/nodeTypeLabels', () => ({
    loadNodeTypeLabels: loadNodeTypeLabelsMock,
    resolveTypeLabel: resolveTypeLabelMock,
}));

vi.mock('../../utils/catalogMigration', () => ({
    migrateLegacyBindings: migrateLegacyBindingsMock,
}));

vi.mock('../../components/admin/AdminWorkspaceLayout', () => ({
    default: ({
        contextBarPanel,
        contextBar,
        rail,
        sidePanel,
        children,
    }: {
        contextBarPanel?: ReactNode;
        contextBar: ReactNode;
        rail?: ReactNode;
        sidePanel?: ReactNode;
        children: ReactNode;
    }) => (
        <div>
            <div data-testid="context-bar-panel">{contextBarPanel}</div>
            <div data-testid="context-bar">{contextBar}</div>
            <div data-testid="workspace-rail">{rail}</div>
            <div data-testid="workspace-side-panel">{sidePanel}</div>
            <div data-testid="workspace-content">{children}</div>
        </div>
    ),
}));

vi.mock('../../components/admin/WidgetCatalogRail', () => ({
    default: ({ onAddWidget }: { onAddWidget: (type: 'kpi' | 'metric-card' | 'machine-activity' | 'trend-chart' | 'trend-chart-v2' | 'activity-analytics' | 'prod-trend') => void }) => (
        <div data-testid="widget-catalog-rail">
            <button type="button" onClick={() => onAddWidget('kpi')}>
                Agregar KPI
            </button>
            <button type="button" onClick={() => onAddWidget('metric-card')}>
                Agregar Métrica
            </button>
            <button type="button" onClick={() => onAddWidget('machine-activity')}>
                Agregar Actividad de Máquina
            </button>
            <button type="button" onClick={() => onAddWidget('trend-chart')}>
                Agregar Gráfico de Tendencia
            </button>
            <button type="button" onClick={() => onAddWidget('trend-chart-v2')}>
                Agregar Trend Chart V2
            </button>
            <button type="button" onClick={() => onAddWidget('activity-analytics')}>
                Agregar Análisis de Actividad
            </button>
            <button type="button" onClick={() => onAddWidget('prod-trend')}>
                Agregar PROD-TREND
            </button>
        </div>
    ),
}));

vi.mock('../../components/admin/PropertyDock', () => ({
    default: (props: unknown) => {
        propertyDockMock(props);
        return <div data-testid="property-dock" />;
    },
}));

vi.mock('../../queries/useDataOverview', () => ({
    useDataOverview: () => useDataOverviewMock(),
}));

vi.mock('../../components/viewer/DashboardHeader', () => ({
    default: ({
        dashboard,
        onAddHeaderWidget,
        ...props
    }: {
        dashboard: { headerConfig?: { widgetSlots?: Array<{ widgetId: string; column?: number }> } };
        onAddHeaderWidget?: (type: 'status', slotIndex: number) => void;
        connection?: ConnectionHealth;
        machines?: ContractMachine[];
    }) => (
        (() => {
            dashboardHeaderMock({ dashboard, onAddHeaderWidget, ...props });
            return (
                <div data-testid="dashboard-header" data-header-slot-count={dashboard.headerConfig?.widgetSlots?.length ?? 0}>
                    <button type="button" onClick={() => onAddHeaderWidget?.('status', 0)}>
                        Agregar widget header
                    </button>
                </div>
            );
        })()
    ),
}));

vi.mock('../../components/admin/BuilderCanvas', () => ({
    default: ({
        cols,
        rows,
        layout,
        widgets,
        onWidgetSelect,
    }: {
        cols: number;
        rows: number;
        layout: Array<{ widgetId: string; x: number; y: number; w: number; h: number }>;
        widgets: Array<{ id: string; type: string; title?: string }>;
        onWidgetSelect?: (widgetId: string | undefined) => void;
    }) => (
        builderCanvasMock({ cols, rows, layout, widgets, onWidgetSelect }),
        <div
            data-testid="builder-canvas-props"
            data-cols={cols}
            data-rows={rows}
            data-layout={JSON.stringify(layout)}
            data-widget-ids={JSON.stringify(widgets.map((widget) => widget.id))}
        >
            {widgets.map((widget) => (
                <button
                    key={widget.id}
                    type="button"
                    onClick={() => onWidgetSelect?.(widget.id)}
                >
                    Seleccionar {widget.title ?? widget.id}
                </button>
            ))}
        </div>
    ),
}));

describe('DashboardBuilderPage', () => {
    beforeEach(() => {
        resizeCallbacks.clear();
        mockNavigate.mockReset();
        localStorage.clear();
        useUIStore.setState(useUIStore.getInitialState());
        templateStorageMock.getTemplates.mockReset();
        useDataOverviewMock.mockReset();
        useDataOverviewMock.mockReturnValue({
            connection: { globalStatus: 'unknown', lastSuccess: null, ageMs: null },
            machines: [],
            isLoading: false,
            isError: false,
            error: null,
            dataUpdatedAt: 0,
            isEnabled: true,
        });
        propertyDockMock.mockReset();
        builderCanvasMock.mockReset();
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        resizeCallbacks.clear();
        useUIStore.setState(useUIStore.getInitialState());
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it('passes contract connection and machines to the preview header', async () => {
        const connection: ConnectionHealth = {
            globalStatus: 'degradado',
            lastSuccess: '2026-04-21T13:00:00.000Z',
            ageMs: 5000,
        };
        const machines: ContractMachine[] = [{
            unitId: 101,
            name: 'Extrusora 101',
            status: 'online',
            lastSuccess: '2026-04-21T13:00:00.000Z',
            ageMs: 0,
            values: {},
        }];

        useDataOverviewMock.mockReturnValue({
            connection,
            machines,
            isLoading: false,
            isError: false,
            error: null,
            dataUpdatedAt: 0,
            isEnabled: true,
        });

        await renderBuilderPage();

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-header')).toBeInTheDocument();
        });

        expect(dashboardHeaderMock).toHaveBeenCalledWith(
            expect.objectContaining({
                connection,
                machines,
            }),
        );
    });

    it('keeps only the grid toggle next to Volver and persists its preference', async () => {
        const user = userEvent.setup();
        const firstRender = await renderBuilderPage();
        const viewport = screen.getByTestId('dashboard-builder-canvas-viewport');

        expect(viewport.parentElement).toHaveClass('flex', 'h-full', 'min-h-0', 'flex-col');

        const gridButton = screen.getByRole('button', { name: 'Ocultar grid' });
        expect(gridButton).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByRole('button', { name: 'Aplicar template' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Configurar dashboard' })).not.toBeInTheDocument();

        await user.click(gridButton);

        expect(useUIStore.getState().isGridVisible).toBe(false);
        expect(screen.getByRole('button', { name: 'Mostrar grid' })).toHaveAttribute('aria-pressed', 'false');
        expect(localStorage.getItem('interfaz-laboratorio-ui')).toBe(
            JSON.stringify({ state: { isGridVisible: false }, version: 0 }),
        );

        firstRender.unmount();
        useUIStore.setState(useUIStore.getInitialState());
        localStorage.setItem(
            'interfaz-laboratorio-ui',
            JSON.stringify({ state: { isGridVisible: false }, version: 0 }),
        );
        await act(async () => {
            await useUIStore.persist.rehydrate();
        });

        await renderBuilderPage();

        expect(screen.getByRole('button', { name: 'Mostrar grid' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('shows hover tooltips only for the remaining grid action', async () => {
        const user = userEvent.setup();

        await renderBuilderPage();

        await user.hover(screen.getByRole('button', { name: 'Ocultar grid' }));
        expect(await screen.findByRole('tooltip')).toHaveTextContent('Ocultar grid');

        await user.unhover(screen.getByRole('button', { name: 'Ocultar grid' }));
        await waitFor(() => {
            expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        });
    });

    it('keeps the builder surface stretchable so sidebar and header widget additions can become visible', async () => {
        const user = userEvent.setup();
        await renderBuilderPage(makeDashboard({
            id: 'dashboard-1',
            cols: 20,
            rows: 12,
            widgets: [],
            layout: [],
            headerConfig: { title: 'Demo', widgetSlots: [] },
        }));

        const viewport = screen.getByTestId('dashboard-builder-canvas-viewport');
        expect(viewport.parentElement).toHaveClass('flex', 'h-full', 'min-h-0', 'flex-col');

        await user.click(screen.getByRole('button', { name: 'Agregar KPI' }));

        await waitFor(() => {
            const snapshot = getBuilderCanvasSnapshot();
            expect(snapshot.layout).toHaveLength(1);
            expect(snapshot.widgetIds).toHaveLength(1);
            expect(snapshot.layout[0]).toMatchObject({ x: 0, y: 0, w: 6, h: 10 });
        });

        await user.click(screen.getByRole('button', { name: 'Agregar widget header' }));

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-header')).toHaveAttribute('data-header-slot-count', '1');
        });
    });

    it('adds machine-activity widgets with KPI-sized layout and default display options', async () => {
        const user = userEvent.setup();

        await renderBuilderPage(makeDashboard({
            id: 'dashboard-1',
            cols: 20,
            rows: 12,
            widgets: [],
            layout: [],
        }));

        await user.click(screen.getByRole('button', { name: 'Agregar Actividad de Máquina' }));

        await waitFor(() => {
            const snapshot = getBuilderCanvasSnapshot();
            expect(snapshot.layout).toHaveLength(1);
            expect(snapshot.layout[0]).toMatchObject({ x: 0, y: 0, w: 6, h: 10 });
        });

        await waitFor(() => {
            expect(propertyDockMock).toHaveBeenCalled();
            expect(propertyDockMock.mock.calls.at(-1)?.[0]).toMatchObject({
                selectedWidget: {
                    type: 'machine-activity',
                    title: 'Actividad de Máquina',
                    size: { w: 6, h: 10 },
                    binding: { mode: 'simulated_value', simulatedValue: 0 },
                    displayOptions: {
                        icon: 'HeartPulse',
                        kpiMode: 'circular',
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        hysteresis: 0.05,
                        confirmationTime: 2000,
                        smoothingWindow: 5,
                        powerMin: 0,
                        powerMax: 1,
                        showStateSubtitle: true,
                        showPowerSubtext: true,
                        showDynamicColor: true,
                        showStateAnimation: true,
                        unitOverride: true,
                        unit: '%',
                        labelStopped: 'Detenida',
                        labelCalibrating: 'Setup',
                        labelProducing: 'Produciendo',
                    },
                },
            });
        });
    });

    it('adds kpi widgets with default icon and unitOverride disabled by default', async () => {
        const user = userEvent.setup();

        await renderBuilderPage(makeDashboard({
            id: 'dashboard-1',
            cols: 20,
            rows: 12,
            widgets: [],
            layout: [],
        }));

        await user.click(screen.getByRole('button', { name: 'Agregar KPI' }));

        await waitFor(() => {
            expect(propertyDockMock).toHaveBeenCalled();
            expect(propertyDockMock.mock.calls.at(-1)?.[0]).toMatchObject({
                selectedWidget: {
                    type: 'kpi',
                    displayOptions: {
                        icon: 'Gauge',
                        unitOverride: false,
                    },
                },
            });
        });
    });

    it('adds metric-card widgets with the configured default icon', async () => {
        const user = userEvent.setup();

        await renderBuilderPage(makeDashboard({
            id: 'dashboard-1',
            cols: 20,
            rows: 12,
            widgets: [],
            layout: [],
        }));

        await user.click(screen.getByRole('button', { name: 'Agregar Métrica' }));

        await waitFor(() => {
            expect(propertyDockMock).toHaveBeenCalled();
            expect(propertyDockMock.mock.calls.at(-1)?.[0]).toMatchObject({
                selectedWidget: {
                    type: 'metric-card',
                    displayOptions: {
                        icon: 'BarChart2',
                    },
                },
            });
        });
    });

    it('adds trend-chart-v2 widgets with normal historical density while keeping legacy trend-chart untouched', async () => {
        const user = userEvent.setup();

        await renderBuilderPage(makeDashboard({
            id: 'dashboard-1',
            cols: 20,
            rows: 12,
            widgets: [makeWidget({ id: 'legacy-trend', type: 'trend-chart', title: 'Legacy Trend' })],
            layout: [{ widgetId: 'legacy-trend', x: 1, y: 1, w: 11, h: 9 }],
        }));

        await user.click(screen.getByRole('button', { name: 'Agregar Trend Chart V2' }));

        await waitFor(() => {
            const snapshot = getBuilderCanvasSnapshot();
            expect(snapshot.layout).toHaveLength(2);
            expect(snapshot.layout[1]).toMatchObject({ x: 0, y: 0, w: 11, h: 9 });
        });

        await waitFor(() => {
            expect(propertyDockMock).toHaveBeenCalled();
            expect(propertyDockMock.mock.calls.at(-1)?.[0]).toMatchObject({
                selectedWidget: {
                    type: 'trend-chart-v2',
                    title: 'Trend Chart V2',
                    size: { w: 11, h: 9 },
                    binding: { mode: 'simulated_value', simulatedValue: 50 },
                    displayOptions: {
                        historicalDensity: 'normal',
                    },
                },
            });
        });
    });

    it('adds legacy trend-chart widgets without unsupported icon display options', async () => {
        const user = userEvent.setup();

        await renderBuilderPage(makeDashboard());

        await user.click(screen.getByRole('button', { name: 'Agregar Gráfico de Tendencia' }));

        await waitFor(() => {
            expect(propertyDockMock).toHaveBeenCalled();
            expect(propertyDockMock.mock.calls.at(-1)?.[0]).toMatchObject({
                selectedWidget: {
                    type: 'trend-chart',
                    title: 'Trend Chart',
                    size: { w: 11, h: 9 },
                    binding: { mode: 'simulated_value', simulatedValue: 50 },
                },
            });
            expect(propertyDockMock.mock.calls.at(-1)?.[0].selectedWidget.displayOptions).toBeUndefined();
        });
    });

    it('adds activity-analytics widgets with activity-series defaults for slice 3', async () => {
        const user = userEvent.setup();

        await renderBuilderPage(makeDashboard({
            id: 'dashboard-1',
            cols: 20,
            rows: 12,
            widgets: [],
            layout: [],
        }));

        await user.click(screen.getByRole('button', { name: 'Agregar Análisis de Actividad' }));

        await waitFor(() => {
            const snapshot = getBuilderCanvasSnapshot();
            expect(snapshot.layout).toHaveLength(1);
            expect(snapshot.layout[0]).toMatchObject({ x: 0, y: 0, w: 15, h: 24 });
        });

        await waitFor(() => {
            expect(propertyDockMock).toHaveBeenCalled();
            expect(propertyDockMock.mock.calls.at(-1)?.[0]).toMatchObject({
                selectedWidget: {
                    type: 'activity-analytics',
                    title: 'ACT-ANALYTICS',
                    size: { w: 15, h: 24 },
                    binding: {
                        mode: 'real_variable',
                        bindingVersion: 'node-red-v1',
                    },
                    displayOptions: {
                        range: '7d',
                        groupBy: 'shift',
                        setupThresholdKw: 0.15,
                        prodThresholdKw: 0.25,
                        displayMode: 'kpis-and-bars',
                        groupBarWidth: 0.2,
                        groupBarWidths: {
                            shift: 0.2,
                            day: 0.3,
                            week: 0.2,
                            month: 0.2,
                        },
                        coverageColor: '#94a3b8',
                        stateGradients: {
                            prod: ['#ff9f65', '#e25290'],
                            setup: ['#5250e2', '#d470e0'],
                            stopped: ['#69a2ef', '#746be2'],
                        },
                        stateGradientAlphas: {
                            prod: [100, 100],
                            setup: [100, 100],
                            stopped: [100, 100],
                        },
                        prodTrendBands: {
                            colors: ['#ff9f65', '#ff9f65', '#ff9f65'],
                            alphas: [0, 15, 0],
                            blendMode: 'normal',
                        },
                        visualEffects: {
                            groupedBars: {
                                glow: 72,
                                blur: 0,
                                topCap: true,
                                topCapGlow: 100,
                            },
                            donut: {
                                glow: 75,
                                blur: 0,
                                topCap: true,
                                topCapGlow: 100,
                            },
                        },
                    },
                },
            });
        });
    });

    it('adds prod-trend widgets with activity-series trend defaults', async () => {
        const user = userEvent.setup();

        await renderBuilderPage(makeDashboard({
            id: 'dashboard-1',
            cols: 20,
            rows: 12,
            widgets: [],
            layout: [],
        }));

        await user.click(screen.getByRole('button', { name: 'Agregar PROD-TREND' }));

        await waitFor(() => {
            const snapshot = getBuilderCanvasSnapshot();
            expect(snapshot.layout).toHaveLength(1);
            expect(snapshot.layout[0]).toMatchObject({ x: 0, y: 0, w: 11, h: 9 });
        });

        await waitFor(() => {
            expect(propertyDockMock).toHaveBeenCalled();
            expect(propertyDockMock.mock.calls.at(-1)?.[0]).toMatchObject({
                selectedWidget: {
                    type: 'prod-trend',
                    title: 'PROD-TREND',
                    size: { w: 11, h: 9 },
                    binding: {
                        mode: 'real_variable',
                        bindingVersion: 'node-red-v1',
                    },
                    displayOptions: {
                        range: '7d',
                        groupBy: 'shift',
                        setupThresholdKw: 0.15,
                        prodThresholdKw: 0.25,
                    },
                },
            });
        });
    });

    it('moves an existing header widget to the exact empty slot column when requested by the header canvas', async () => {
        await renderBuilderPage(makeDashboard({
            id: 'dashboard-1',
            widgets: [
                makeWidget({ id: 'widget-status-a', type: 'status', title: 'Estado A' }),
                makeWidget({ id: 'widget-status-b', type: 'status', title: 'Estado B' }),
            ],
            headerConfig: {
                title: 'Demo',
                widgetSlots: [
                    { widgetId: 'widget-status-a', column: 0 },
                    { widgetId: 'widget-status-b', column: 1 },
                ],
            },
        }));

        await waitFor(() => {
            expect(dashboardHeaderMock).toHaveBeenCalled();
        });

        const latestHeaderProps = dashboardHeaderMock.mock.calls.at(-1)?.[0] as {
            onDropWidgetAtSlot?: (widgetId: string, slotIndex: number) => void;
        };

        latestHeaderProps.onDropWidgetAtSlot?.('widget-status-a', 2);

        await waitFor(() => {
            const rerenderedHeaderProps = dashboardHeaderMock.mock.calls.at(-1)?.[0] as {
                dashboard: { headerConfig?: { widgetSlots?: Array<{ widgetId: string; column?: number }> } };
            };

            expect(rerenderedHeaderProps.dashboard.headerConfig?.widgetSlots).toEqual([
                { widgetId: 'widget-status-a', column: 2 },
                { widgetId: 'widget-status-b', column: 1 },
            ]);
        });
    });

    it('persists the first free header column when a builder-grid drop lands on the header canvas', async () => {
        await renderBuilderPage(makeDashboard({
            id: 'dashboard-1',
            widgets: [
                makeWidget({ id: 'widget-status-a', type: 'status', title: 'Estado A' }),
                makeWidget({ id: 'widget-status-b', type: 'status', title: 'Estado B' }),
            ],
            headerConfig: {
                title: 'Demo',
                widgetSlots: [{ widgetId: 'widget-status-a', column: 1 }],
            },
        }));

        await waitFor(() => {
            expect(dashboardHeaderMock).toHaveBeenCalled();
        });

        const latestHeaderProps = dashboardHeaderMock.mock.calls.at(-1)?.[0] as {
            onHeaderDrop?: (event: DragEvent<HTMLDivElement>) => void;
        };

        await act(async () => {
            latestHeaderProps.onHeaderDrop?.({
                preventDefault: vi.fn(),
                dataTransfer: {
                    getData: vi.fn((type: string) => (
                        type === HEADER_WIDGET_DRAG_MIME
                            ? JSON.stringify({ widgetId: 'widget-status-b', widgetType: 'status', source: 'builder-grid' })
                            : ''
                    )),
                },
            } as unknown as DragEvent<HTMLDivElement>);
        });

        await waitFor(() => {
            const rerenderedHeaderProps = dashboardHeaderMock.mock.calls.at(-1)?.[0] as {
                dashboard: { headerConfig?: { widgetSlots?: Array<{ widgetId: string; column?: number }> } };
            };

            expect(rerenderedHeaderProps.dashboard.headerConfig?.widgetSlots).toEqual([
                { widgetId: 'widget-status-a', column: 1 },
                { widgetId: 'widget-status-b', column: 0 },
            ]);
        });
    });

    it('swaps header widget columns when the header canvas requests an arrow move', async () => {
        await renderBuilderPage(makeDashboard({
            id: 'dashboard-1',
            widgets: [
                makeWidget({ id: 'widget-status-a', type: 'status', title: 'Estado A' }),
                makeWidget({ id: 'widget-status-b', type: 'status', title: 'Estado B' }),
            ],
            headerConfig: {
                title: 'Demo',
                widgetSlots: [
                    { widgetId: 'widget-status-a', column: 0 },
                    { widgetId: 'widget-status-b', column: 1 },
                ],
            },
        }));

        await waitFor(() => {
            expect(dashboardHeaderMock).toHaveBeenCalled();
        });

        const latestHeaderProps = dashboardHeaderMock.mock.calls.at(-1)?.[0] as {
            onMoveHeaderWidget?: (widgetId: string, targetColumn: number) => void;
        };

        await act(async () => {
            latestHeaderProps.onMoveHeaderWidget?.('widget-status-a', 1);
        });

        await waitFor(() => {
            const rerenderedHeaderProps = dashboardHeaderMock.mock.calls.at(-1)?.[0] as {
                dashboard: { headerConfig?: { widgetSlots?: Array<{ widgetId: string; column?: number }> } };
            };

            expect(rerenderedHeaderProps.dashboard.headerConfig?.widgetSlots).toEqual([
                { widgetId: 'widget-status-a', column: 1 },
                { widgetId: 'widget-status-b', column: 0 },
            ]);
        });
    });

    it('passes Node-RED overview props to PropertyDock', async () => {
        useDataOverviewMock.mockReturnValue({
            connection: { globalStatus: 'online', lastSuccess: '2026-04-21T13:00:00.000Z', ageMs: 0 },
            machines: [{ unitId: 101, name: 'Extrusora 101', status: 'online', lastSuccess: '2026-04-21T13:00:00.000Z', ageMs: 0, values: {} }],
            isLoading: true,
            isError: true,
            error: new Error('boom'),
            dataUpdatedAt: 123,
            isEnabled: true,
        });

        await renderBuilderPage();

        expect(propertyDockMock).toHaveBeenCalled();
        expect(propertyDockMock.mock.calls.at(-1)?.[0]).toMatchObject({
            machines: [{ unitId: 101, name: 'Extrusora 101', status: 'online', lastSuccess: '2026-04-21T13:00:00.000Z', ageMs: 0, values: {} }],
            dataLoading: true,
            dataError: true,
        });
    });

    it('passes hierarchy trace only for the selected hierarchy metric-card', async () => {
        const user = userEvent.setup();
        const hierarchyWidget = makeWidget({
            id: 'widget-hierarchy',
            title: 'Jerarquía temperatura',
            hierarchyMode: true,
            aggregation: 'sum',
            binding: { mode: 'real_variable', catalogVariableId: 'cv-temperature', unit: '°C' },
        });
        const plainWidget = makeWidget({
            id: 'widget-plain',
            title: 'Temperatura local',
            hierarchyMode: false,
            binding: { mode: 'simulated_value', simulatedValue: 5, catalogVariableId: 'cv-temperature', unit: '°C' },
        });
        const dashboard = makeDashboard({
            id: 'dashboard-1',
            ownerNodeId: 'root',
            widgets: [hierarchyWidget, plainWidget],
            layout: [
                makeLayout({ widgetId: 'widget-hierarchy', x: 0, y: 0, w: 6, h: 5 }),
                makeLayout({ widgetId: 'widget-plain', x: 6, y: 0, w: 6, h: 5 }),
            ],
        });
        const childDashboard = makeDashboard({
            id: 'dashboard-child',
            status: 'published',
            widgets: [
                makeWidget({
                    id: 'child-widget',
                    title: 'Descendiente 1',
                    binding: { mode: 'simulated_value', simulatedValue: 21, catalogVariableId: 'cv-temperature', unit: '°C' },
                }),
            ],
        });

        await renderBuilderPage(dashboard, {
            allDashboards: [dashboard, childDashboard],
            allNodes: [
                { id: 'root', name: 'Root', type: 'plant', parentId: null, order: 0 },
                { id: 'child-a', name: 'Child A', type: 'line', parentId: 'root', order: 0, linkedDashboardId: 'dashboard-child' },
            ],
        });

        await user.click(screen.getByRole('button', { name: 'Seleccionar Jerarquía temperatura' }));

        await waitFor(() => {
            expect(propertyDockMock.mock.calls.at(-1)?.[0]).toMatchObject({
                selectedWidget: expect.objectContaining({ id: 'widget-hierarchy' }),
                hierarchyTrace: expect.objectContaining({
                    state: 'resolved',
                    included: [expect.objectContaining({ widgetId: 'child-widget', value: 21 })],
                }),
            });
        });

        await user.click(screen.getByRole('button', { name: 'Seleccionar Temperatura local' }));

        await waitFor(() => {
            expect(propertyDockMock.mock.calls.at(-1)?.[0]).toMatchObject({
                selectedWidget: expect.objectContaining({ id: 'widget-plain' }),
                hierarchyTrace: undefined,
            });
        });
    });

    it('forwards top-level hierarchy empty state from the trace to PropertyDock', async () => {
        const user = userEvent.setup();
        const hierarchyWidget = makeWidget({
            id: 'widget-hierarchy-empty',
            title: 'Jerarquía vacía',
            hierarchyMode: true,
            aggregation: 'sum',
            binding: { mode: 'real_variable', catalogVariableId: 'cv-temperature', unit: '°C' },
        });
        const dashboard = makeDashboard({
            id: 'dashboard-1',
            ownerNodeId: 'root',
            widgets: [hierarchyWidget],
            layout: [makeLayout({ widgetId: 'widget-hierarchy-empty', x: 0, y: 0, w: 6, h: 5 })],
        });

        await renderBuilderPage(dashboard, {
            allDashboards: [dashboard],
            allNodes: [
                { id: 'root', name: 'Root', type: 'plant', parentId: null, order: 0 },
                { id: 'child-a', name: 'Child A', type: 'line', parentId: 'root', order: 0, linkedDashboardId: 'dashboard-missing' },
            ],
        });

        await user.click(screen.getByRole('button', { name: 'Seleccionar Jerarquía vacía' }));

        await waitFor(() => {
            expect(propertyDockMock.mock.calls.at(-1)?.[0]).toMatchObject({
                hierarchyTrace: expect.objectContaining({
                    state: 'empty',
                    emptyReason: 'no-eligible-contributors',
                }),
            });
        });
    });

    it('anchors the header title preview and builder canvas inside the same content column', async () => {
        await renderBuilderPage(makeDashboard({
            id: 'dashboard-1',
            cols: 20,
            rows: 12,
            widgets: [makeWidget({ id: 'widget-1', title: 'Widget 1' })],
            layout: [makeLayout({ widgetId: 'widget-1', x: 0, y: 0, w: 4, h: 3 })],
            headerConfig: { title: 'Planta Demo', widgetSlots: [] },
        }));

        const contentColumn = screen.getByTestId('dashboard-builder-content-column');
        const header = screen.getByTestId('dashboard-header');
        const viewport = screen.getByTestId('dashboard-builder-canvas-viewport');

        expect(contentColumn).toContainElement(header);
        expect(contentColumn).toContainElement(viewport);
        expect(header.closest('[data-testid="dashboard-builder-content-column"]')).toBe(contentColumn);
        expect(viewport.parentElement).toBe(contentColumn);
        expect(contentColumn).toHaveClass('px-8');
    });

    it('uses a clipped builder viewport shell so the measured canvas stays fully contained', async () => {
        await renderBuilderPage();

        const viewport = screen.getByTestId('dashboard-builder-canvas-viewport');

        expect(viewport).toHaveClass('overflow-hidden');
        expect(viewport).not.toHaveClass('overflow-x-auto');
        expect(viewport).not.toHaveClass('overflow-y-auto');
        expect(viewport).toHaveClass('pb-3');
        expect(viewport).toHaveClass('pt-2');
    });

    it('renders canonical 40x24 bounds when the dashboard omits persisted grid dimensions', async () => {
        await renderBuilderPage(makeDashboard({
            id: 'dashboard-1',
            cols: undefined as unknown as number,
            rows: undefined as unknown as number,
        }));

        await waitFor(() => {
            expect(getBuilderCanvasSnapshot()).toMatchObject({
                cols: 40,
                rows: 24,
            });
        });
    });
});
