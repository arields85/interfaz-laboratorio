import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardBuilderPage from './DashboardBuilderPage';
import { makeDashboard, makeLayout, makeWidget } from '../../test/fixtures/dashboard.fixture';
import { createDefaultDashboardView } from '../../utils/dashboardViews';
import { useUIStore } from '../../store/ui.store';
import type { ConnectionHealth, ContractMachine } from '../../domain/dataContract.types';
import { HEADER_WIDGET_DRAG_MIME } from '../../utils/headerWidgets';
import type { Dashboard, HierarchyNode } from '../../domain/admin.types';

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
        statefulDashboard?: Dashboard;
    },
) {
    if (options?.statefulDashboard) {
        const state = options.statefulDashboard;
        dashboardStorageMock.getDashboard.mockImplementation(async (dashboardId: string) => (
            state.id === dashboardId ? structuredClone(state) : null
        ));
        dashboardStorageMock.getDashboards.mockImplementation(async () => {
            const dashboards = options.allDashboards ?? [state];
            return dashboards.map((item) => (item.id === state.id ? structuredClone(state) : structuredClone(item)));
        });
        dashboardStorageMock.saveDashboard.mockImplementation(async (nextDashboard: Dashboard) => {
            Object.assign(state, structuredClone(nextDashboard));
        });
        dashboardStorageMock.publishDashboard.mockImplementation(async (dashboardId: string) => {
            expect(dashboardId).toBe(state.id);
            state.status = 'published';
            state.publishedSnapshot = {
                aspect: state.aspect,
                cols: state.cols,
                rows: state.rows,
                views: structuredClone(state.views),
                activeViewId: state.activeViewId,
                widgets: structuredClone(state.widgets),
                layout: structuredClone(state.layout),
                headerConfig: structuredClone(state.headerConfig),
                publishedAt: '2026-07-04T12:30:00.000Z',
            };
            return structuredClone(state);
        });
    } else {
        dashboardStorageMock.getDashboard.mockResolvedValue(dashboard);
        dashboardStorageMock.getDashboards.mockResolvedValue(options?.allDashboards ?? [dashboard]);
    }
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

function getLatestPropertyDockProps() {
    return propertyDockMock.mock.calls.at(-1)?.[0] as {
        onDuplicate?: () => void;
    } | undefined;
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
        onSelectView,
        activeViewId,
        ...props
    }: {
        dashboard: {
            headerConfig?: { widgetSlots?: Array<{ widgetId: string; column?: number }> };
            views?: Array<{ id: string; name: string }>;
        };
        onAddHeaderWidget?: (type: 'status', slotIndex: number) => void;
        onSelectView?: (viewId: string) => void;
        activeViewId?: string;
        connection?: ConnectionHealth;
        machines?: ContractMachine[];
    }) => (
        (() => {
            dashboardHeaderMock({ dashboard, onAddHeaderWidget, onSelectView, activeViewId, ...props });
            return (
                <div data-testid="dashboard-header" data-header-slot-count={dashboard.headerConfig?.widgetSlots?.length ?? 0}>
                    <div data-testid="dashboard-header-view-actions">
                        {dashboard.views?.map((view) => (
                            <button
                                key={view.id}
                                type="button"
                                aria-label={view.name}
                                aria-pressed={view.id === activeViewId}
                                onClick={() => onSelectView?.(view.id)}
                            >
                                {view.id === activeViewId ? 'active' : 'inactive'}
                            </button>
                        ))}
                    </div>
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

    it('moves the grid toggle into view actions while keeping its persisted preference', async () => {
        const user = userEvent.setup();
        const firstRender = await renderBuilderPage();
        const viewport = screen.getByTestId('dashboard-builder-canvas-viewport');
        const contextBarPanel = screen.getByTestId('context-bar-panel');
        const viewActions = screen.getByTestId('dashboard-builder-view-actions');

        expect(viewport.parentElement).toHaveClass('flex', 'h-full', 'min-h-0', 'flex-col');
        expect(contextBarPanel).toContainElement(screen.getByRole('button', { name: 'Volver' }));
        expect(contextBarPanel).not.toContainElement(screen.getByRole('button', { name: 'Ocultar grid' }));
        expect(Array.from(viewActions.querySelectorAll('button')).map((button) => button.getAttribute('aria-label'))).toEqual([
            'Nueva vista',
            'Renombrar',
            'Reordenar vista a la izquierda',
            'Reordenar vista a la derecha',
            'Eliminar vista',
            'Ocultar grid',
        ]);

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

    it('shows hover tooltips for the grid action from the internal view-actions group', async () => {
        const user = userEvent.setup();

        await renderBuilderPage();

        expect(screen.getByTestId('dashboard-builder-view-actions')).toContainElement(
            screen.getByRole('button', { name: 'Ocultar grid' }),
        );

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

    it('allows the active view to place a header widget in a column occupied by another view', async () => {
        const user = userEvent.setup();
        await renderBuilderPage(makeDashboard({
            id: 'dashboard-1',
            widgets: [makeWidget({ id: 'widget-status-a', type: 'status', title: 'Estado A' })],
            layout: [],
            views: [
                createDefaultDashboardView({
                    id: 'view-a',
                    name: 'Producción',
                    order: 0,
                    widgets: [makeWidget({ id: 'widget-status-a', type: 'status', title: 'Estado A' })],
                    layout: [],
                }),
                createDefaultDashboardView({
                    id: 'view-b',
                    name: 'Técnica',
                    order: 1,
                    widgets: [makeWidget({ id: 'widget-status-b', type: 'status', title: 'Estado B' })],
                    layout: [makeLayout({ widgetId: 'widget-status-b', x: 0, y: 0, w: 1, h: 1 })],
                }),
            ],
            activeViewId: 'view-a',
            headerConfig: {
                title: 'Demo',
                widgetSlots: [{ widgetId: 'widget-status-a', column: 0 }],
            },
        }));

        await user.click(screen.getByRole('button', { name: 'Técnica' }));

        await waitFor(() => {
            expect(dashboardHeaderMock.mock.calls.at(-1)?.[0]).toMatchObject({ activeViewId: 'view-b' });
        });

        const latestHeaderProps = dashboardHeaderMock.mock.calls.at(-1)?.[0] as {
            onDropWidgetAtSlot?: (widgetId: string, slotIndex: number) => void;
        };

        await act(async () => {
            latestHeaderProps.onDropWidgetAtSlot?.('widget-status-b', 0);
        });

        await waitFor(() => {
            const rerenderedHeaderProps = dashboardHeaderMock.mock.calls.at(-1)?.[0] as {
                dashboard: { headerConfig?: { widgetSlots?: Array<{ widgetId: string; column?: number }> } };
            };

            expect(rerenderedHeaderProps.dashboard.headerConfig?.widgetSlots).toEqual([
                { widgetId: 'widget-status-a', column: 0 },
                { widgetId: 'widget-status-b', column: 0 },
            ]);
        });

        const headerPropsAfterPlacement = dashboardHeaderMock.mock.calls.at(-1)?.[0] as {
            onMoveHeaderWidget?: (widgetId: string, targetColumn: number) => void;
        };

        await act(async () => {
            headerPropsAfterPlacement.onMoveHeaderWidget?.('widget-status-b', 1);
        });

        await waitFor(() => {
            const rerenderedHeaderProps = dashboardHeaderMock.mock.calls.at(-1)?.[0] as {
                dashboard: { headerConfig?: { widgetSlots?: Array<{ widgetId: string; column?: number }> } };
            };

            expect(rerenderedHeaderProps.dashboard.headerConfig?.widgetSlots).toEqual([
                { widgetId: 'widget-status-a', column: 0 },
                { widgetId: 'widget-status-b', column: 1 },
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

    it('creates, selects, renames, reorders, and deletes internal views without allowing the final view to disappear', async () => {
        const user = userEvent.setup();

        await renderBuilderPage(makeDashboard({
            id: 'dashboard-views',
            ownerNodeId: 'node-1',
            views: [
                createDefaultDashboardView({
                    id: 'view-production',
                    name: 'Production',
                    widgets: [makeWidget({ id: 'widget-production', title: 'Production widget' })],
                    layout: [makeLayout({ widgetId: 'widget-production', x: 0, y: 0, w: 4, h: 3 })],
                }),
                createDefaultDashboardView({
                    id: 'view-technical',
                    name: 'Technical',
                    order: 1,
                    widgets: [makeWidget({ id: 'widget-technical', title: 'Technical widget' })],
                    layout: [makeLayout({ widgetId: 'widget-technical', x: 4, y: 0, w: 4, h: 3 })],
                }),
            ],
            activeViewId: 'view-production',
            widgets: [makeWidget({ id: 'widget-production', title: 'Production widget' })],
            layout: [makeLayout({ widgetId: 'widget-production', x: 0, y: 0, w: 4, h: 3 })],
        }));

        expect(getBuilderCanvasSnapshot().widgetIds).toEqual(['widget-production']);

        await user.click(screen.getByRole('button', { name: 'Nueva vista' }));
        await user.type(screen.getByPlaceholderText('Nombre de la vista'), 'Maintenance');
        await user.click(screen.getByRole('button', { name: 'Crear' }));

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Maintenance' })).toHaveAttribute('aria-pressed', 'true');
            expect(getBuilderCanvasSnapshot().widgetIds).toEqual([]);
        });

        await user.click(screen.getByRole('button', { name: 'Renombrar' }));
        const renameInput = screen.getByPlaceholderText('Nombre de la vista');
        await user.clear(renameInput);
        await user.type(renameInput, 'Maintenance East');
        await user.click(screen.getByRole('button', { name: 'Guardar' }));

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Maintenance East' })).toHaveAttribute('aria-pressed', 'true');
        });

        await user.click(screen.getByRole('button', { name: 'Reordenar vista a la izquierda' }));

        await waitFor(() => {
            expect(screen.getAllByTestId('dashboard-header-view-actions')[0].querySelectorAll('button')).toHaveLength(3);
            expect(Array.from(screen.getAllByTestId('dashboard-header-view-actions')[0].querySelectorAll('button')).map((button) => button.getAttribute('aria-label'))).toEqual(['Production', 'Maintenance East', 'Technical']);
        });

        await user.click(screen.getByRole('button', { name: 'Eliminar vista' }));

        await waitFor(() => {
            expect(screen.queryByRole('button', { name: 'Maintenance East' })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Production' })).toHaveAttribute('aria-pressed', 'true');
        });

        await user.click(screen.getByRole('button', { name: 'Technical' }));
        await waitFor(() => {
            expect(getBuilderCanvasSnapshot().widgetIds).toEqual(['widget-technical']);
        });

        await user.click(screen.getByRole('button', { name: 'Eliminar vista' }));
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: 'Technical' })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Production' })).toHaveAttribute('aria-pressed', 'true');
        });

        await user.click(screen.getByRole('button', { name: 'Eliminar vista' }));

        expect(await screen.findByText('No se puede eliminar la última vista del dashboard.')).toBeInTheDocument();
        expect(Array.from(screen.getAllByTestId('dashboard-header-view-actions')[0].querySelectorAll('button')).map((button) => button.getAttribute('aria-label'))).toEqual(['Production']);
    });

    it('lets the builder set and update persisted internal-view icon keys from a closed selector', async () => {
        const user = userEvent.setup();

        await renderBuilderPage(makeDashboard({
            id: 'dashboard-view-icons',
            ownerNodeId: 'node-1',
            views: [
                createDefaultDashboardView({ id: 'view-production', name: 'Production' }),
                createDefaultDashboardView({ id: 'view-technical', name: 'Technical', order: 1 }),
            ],
            activeViewId: 'view-production',
        }));

        await user.click(screen.getByRole('button', { name: 'Nueva vista' }));
        await user.type(screen.getByPlaceholderText('Nombre de la vista'), 'Maintenance');
        await user.click(screen.getByRole('button', { name: 'Automático' }));
        await user.click(screen.getByRole('button', { name: 'Predeterminado' }));
        await user.click(screen.getByRole('button', { name: 'Crear' }));

        await waitFor(() => {
            const latestHeaderProps = dashboardHeaderMock.mock.calls.at(-1)?.[0] as {
                dashboard: { views?: Array<{ id: string; name: string; iconKey?: string }> };
            };
            expect(latestHeaderProps.dashboard.views).toEqual(expect.arrayContaining([
                expect.objectContaining({ name: 'Maintenance', iconKey: 'default' }),
            ]));
        });

        await user.click(screen.getByRole('button', { name: 'Renombrar' }));
        const renameInput = screen.getByPlaceholderText('Nombre de la vista');
        await user.clear(renameInput);
        await user.type(renameInput, 'Maintenance East');
        await user.click(screen.getByRole('button', { name: 'Predeterminado' }));
        await user.click(screen.getByRole('button', { name: 'Mantenimiento' }));
        await user.click(screen.getByRole('button', { name: 'Guardar' }));

        await waitFor(() => {
            const latestHeaderProps = dashboardHeaderMock.mock.calls.at(-1)?.[0] as {
                dashboard: { views?: Array<{ id: string; name: string; iconKey?: string }> };
            };
            expect(latestHeaderProps.dashboard.views).toEqual(expect.arrayContaining([
                expect.objectContaining({ name: 'Maintenance East', iconKey: 'maintenance' }),
            ]));
        });
    });

    it('moves internal-view management controls into the context bar and keeps a stable trailing slot while dirty state moves onto the save button', async () => {
        const user = userEvent.setup();

        await renderBuilderPage(makeDashboard({
            id: 'dashboard-toolbar',
            name: 'Toolbar dashboard',
            ownerNodeId: 'node-1',
            views: [
                createDefaultDashboardView({ id: 'view-production', name: 'Production' }),
                createDefaultDashboardView({ id: 'view-technical', name: 'Technical', order: 1 }),
            ],
            activeViewId: 'view-production',
            widgets: [],
            layout: [],
        }));

        const contextBar = screen.getByTestId('context-bar');
        const createButton = screen.getByRole('button', { name: 'Nueva vista' });
        const renameButton = screen.getByRole('button', { name: 'Renombrar' });
        const moveLeftButton = screen.getByRole('button', { name: 'Reordenar vista a la izquierda' });
        const moveRightButton = screen.getByRole('button', { name: 'Reordenar vista a la derecha' });
        const deleteButton = screen.getByRole('button', { name: 'Eliminar vista' });

        expect(contextBar).toContainElement(createButton);
        expect(contextBar).toContainElement(renameButton);
        expect(contextBar).toContainElement(moveLeftButton);
        expect(contextBar).toContainElement(moveRightButton);
        expect(contextBar).toContainElement(deleteButton);
        expect(contextBar).toContainElement(screen.getByRole('button', { name: 'Guardar Draft' }));

        expect(createButton).not.toHaveTextContent('Nueva vista');
        expect(renameButton).not.toHaveTextContent('Renombrar');
        expect(moveLeftButton).not.toHaveTextContent('Reordenar');
        expect(moveRightButton).not.toHaveTextContent('Reordenar');
        expect(deleteButton).not.toHaveTextContent('Eliminar vista');

        const warningSlot = screen.getByTestId('dashboard-builder-unsaved-slot');
        expect(warningSlot).toBeInTheDocument();
        expect(warningSlot).not.toHaveTextContent('Cambios sin guardar');
        expect(screen.queryByText('Cambios sin guardar')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Nueva vista' }));
        await user.type(screen.getByPlaceholderText('Nombre de la vista'), 'Maintenance');
        await user.click(screen.getByRole('button', { name: 'Crear' }));

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Guardar Draft' })).toBeEnabled();
        });

        expect(screen.queryByText('Cambios sin guardar')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Guardar Draft' }).className).toContain('border-status-warning');
        expect(screen.getByRole('button', { name: 'Guardar Draft' }).className).toContain('text-status-warning');
        expect(screen.getByRole('button', { name: 'Guardar Draft' }).className).toContain('bg-[color:color-mix(in_srgb,var(--color-status-warning)_10%,transparent)]');
        expect(screen.getByTestId('dashboard-builder-unsaved-slot')).toBeEmptyDOMElement();
    });

    it('uses the existing tooltip primitive with icon-only internal-view management buttons and shared reorder copy', async () => {
        const user = userEvent.setup();

        await renderBuilderPage(makeDashboard({
            id: 'dashboard-toolbar-tooltips',
            ownerNodeId: 'node-1',
            views: [
                createDefaultDashboardView({ id: 'view-production', name: 'Production' }),
                createDefaultDashboardView({ id: 'view-technical', name: 'Technical', order: 1 }),
            ],
            activeViewId: 'view-production',
        }));

        await user.hover(screen.getByRole('button', { name: 'Nueva vista' }));
        expect(await screen.findByRole('tooltip')).toHaveTextContent('Nueva vista');
        await user.unhover(screen.getByRole('button', { name: 'Nueva vista' }));

        await waitFor(() => {
            expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        });

        await user.hover(screen.getByRole('button', { name: 'Reordenar vista a la izquierda' }));
        expect(await screen.findByRole('tooltip')).toHaveTextContent('Reordenar');
        await user.unhover(screen.getByRole('button', { name: 'Reordenar vista a la izquierda' }));

        await waitFor(() => {
            expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
        });

        await user.hover(screen.getByRole('button', { name: 'Reordenar vista a la derecha' }));
        expect(await screen.findByRole('tooltip')).toHaveTextContent('Reordenar');
    });

    it('renders recognizable lucide svg icons for internal-view management buttons at the shared icon-only size', async () => {
        await renderBuilderPage(makeDashboard({
            id: 'dashboard-toolbar-icons',
            ownerNodeId: 'node-1',
            views: [
                createDefaultDashboardView({ id: 'view-production', name: 'Production' }),
                createDefaultDashboardView({ id: 'view-technical', name: 'Technical', order: 1 }),
            ],
            activeViewId: 'view-production',
        }));

        const createButton = screen.getByRole('button', { name: 'Nueva vista' });
        const renameButton = screen.getByRole('button', { name: 'Renombrar' });
        const moveLeftButton = screen.getByRole('button', { name: 'Reordenar vista a la izquierda' });
        const moveRightButton = screen.getByRole('button', { name: 'Reordenar vista a la derecha' });
        const deleteButton = screen.getByRole('button', { name: 'Eliminar vista' });

        expect(createButton.querySelector('.lucide-plus')).toHaveAttribute('width', '16');
        expect(createButton.querySelector('.lucide-plus')).toHaveAttribute('height', '16');
        expect(renameButton.querySelector('.lucide-pencil')).toHaveAttribute('width', '16');
        expect(renameButton.querySelector('.lucide-pencil')).toHaveAttribute('height', '16');
        expect(moveLeftButton.querySelector('.lucide-chevron-left')).toHaveAttribute('width', '16');
        expect(moveLeftButton.querySelector('.lucide-chevron-left')).toHaveAttribute('height', '16');
        expect(moveRightButton.querySelector('.lucide-chevron-right')).toHaveAttribute('width', '16');
        expect(moveRightButton.querySelector('.lucide-chevron-right')).toHaveAttribute('height', '16');
        expect(deleteButton.querySelector('.lucide-trash-2')).toHaveAttribute('width', '16');
        expect(deleteButton.querySelector('.lucide-trash-2')).toHaveAttribute('height', '16');
    });

    it('keeps disabled reorder controls tooltip-driven while preserving their directional accessible labels', async () => {
        const user = userEvent.setup();

        await renderBuilderPage(makeDashboard({
            id: 'dashboard-toolbar-shared-style',
            ownerNodeId: 'node-1',
            views: [
                createDefaultDashboardView({ id: 'view-production', name: 'Production' }),
                createDefaultDashboardView({ id: 'view-technical', name: 'Technical', order: 1 }),
            ],
            activeViewId: 'view-production',
        }));

        const createButton = screen.getByRole('button', { name: 'Nueva vista' });
        const renameButton = screen.getByRole('button', { name: 'Renombrar' });
        const moveLeftButton = screen.getByRole('button', { name: 'Reordenar vista a la izquierda' });
        const moveRightButton = screen.getByRole('button', { name: 'Reordenar vista a la derecha' });
        const deleteButton = screen.getByRole('button', { name: 'Eliminar vista' });

        expect(createButton).toBeEnabled();
        expect(renameButton).toBeEnabled();
        expect(moveLeftButton).toBeDisabled();
        expect(moveRightButton).toBeEnabled();
        expect(deleteButton).toBeEnabled();

        await user.hover(moveLeftButton);
        expect(await screen.findByRole('tooltip')).toHaveTextContent('Reordenar');
    });

    it('keeps disabled reorder controls recognizable by preserving their svg icon render', async () => {
        await renderBuilderPage(makeDashboard({
            id: 'dashboard-toolbar-disabled-icons',
            ownerNodeId: 'node-1',
            views: [
                createDefaultDashboardView({ id: 'view-production', name: 'Production' }),
                createDefaultDashboardView({ id: 'view-technical', name: 'Technical', order: 1 }),
            ],
            activeViewId: 'view-production',
        }));

        const moveLeftButton = screen.getByRole('button', { name: 'Reordenar vista a la izquierda' });

        expect(moveLeftButton).toBeDisabled();
        expect(moveLeftButton.querySelector('.lucide-chevron-left')).toHaveAttribute('width', '16');
        expect(moveLeftButton.querySelector('.lucide-chevron-left')).toHaveAttribute('height', '16');
    });

    it('uses the first ordered internal view as the builder default while keeping exploration local until a real edit', async () => {
        const user = userEvent.setup();

        const dashboardState = makeDashboard({
            id: 'dashboard-1',
            name: 'Builder dashboard',
            ownerNodeId: 'node-1',
            status: 'published',
            views: [
                createDefaultDashboardView({
                    id: 'view-technical',
                    name: 'Technical',
                    order: 1,
                    widgets: [makeWidget({ id: 'widget-technical', title: 'Technical widget' })],
                    layout: [makeLayout({ widgetId: 'widget-technical', x: 4, y: 0, w: 4, h: 3 })],
                }),
                createDefaultDashboardView({
                    id: 'view-production',
                    name: 'Production',
                    order: 0,
                    widgets: [makeWidget({ id: 'widget-production', title: 'Production widget' })],
                    layout: [makeLayout({ widgetId: 'widget-production', x: 0, y: 0, w: 4, h: 3 })],
                }),
            ],
            activeViewId: 'view-technical',
            widgets: [makeWidget({ id: 'widget-technical', title: 'Technical widget' })],
            layout: [makeLayout({ widgetId: 'widget-technical', x: 4, y: 0, w: 4, h: 3 })],
        });

        await renderBuilderPage(dashboardState, {
            allDashboards: [dashboardState],
            statefulDashboard: dashboardState,
        });

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Production' })).toHaveAttribute('aria-pressed', 'true');
        });

        expect(getBuilderCanvasSnapshot().widgetIds).toEqual(['widget-production']);
        expect(screen.queryByText('Cambios sin guardar')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Technical' }));

        await waitFor(() => {
            expect(getBuilderCanvasSnapshot().widgetIds).toEqual(['widget-technical']);
        });

        expect(screen.queryByText('Cambios sin guardar')).not.toBeInTheDocument();
    });

    it('keeps builder internal-view switching inside the header instead of rendering text tabs above the title', async () => {
        const user = userEvent.setup();

        await renderBuilderPage(makeDashboard({
            id: 'dashboard-view-header-placement',
            name: 'Builder dashboard',
            ownerNodeId: 'node-1',
            views: [
                createDefaultDashboardView({ id: 'view-production', name: 'Production' }),
                createDefaultDashboardView({ id: 'view-technical', name: 'Technical', order: 1 }),
            ],
            activeViewId: 'view-production',
        }));

        expect(screen.queryByTestId('dashboard-view-tabs')).not.toBeInTheDocument();

        const headerActions = screen.getByTestId('dashboard-header-view-actions');
        const productionButton = screen.getByRole('button', { name: 'Production' });
        const technicalButton = screen.getByRole('button', { name: 'Technical' });

        expect(headerActions).toContainElement(productionButton);
        expect(headerActions).toContainElement(technicalButton);
        expect(productionButton).toHaveAttribute('aria-pressed', 'true');
        expect(technicalButton).toHaveAttribute('aria-pressed', 'false');

        await user.click(technicalButton);

        expect(screen.getByRole('button', { name: 'Technical' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('treats internal-view tab switching as local navigation and keeps the persisted default view unchanged until a real edit is saved', async () => {
        const user = userEvent.setup();

        const dashboardState = makeDashboard({
            id: 'dashboard-1',
            name: 'Builder dashboard',
            ownerNodeId: 'node-1',
            status: 'published',
            views: [
                createDefaultDashboardView({
                    id: 'view-production',
                    name: 'Production',
                    widgets: [makeWidget({ id: 'widget-production', title: 'Production widget' })],
                    layout: [makeLayout({ widgetId: 'widget-production', x: 0, y: 0, w: 4, h: 3 })],
                }),
                createDefaultDashboardView({
                    id: 'view-technical',
                    name: 'Technical',
                    order: 1,
                    widgets: [makeWidget({ id: 'widget-technical', title: 'Technical widget' })],
                    layout: [makeLayout({ widgetId: 'widget-technical', x: 4, y: 0, w: 4, h: 3 })],
                }),
            ],
            activeViewId: 'view-production',
            widgets: [makeWidget({ id: 'widget-production', title: 'Production widget' })],
            layout: [makeLayout({ widgetId: 'widget-production', x: 0, y: 0, w: 4, h: 3 })],
            publishedSnapshot: {
                aspect: '16:9',
                cols: 40,
                rows: 24,
                views: [
                    createDefaultDashboardView({
                        id: 'view-production',
                        name: 'Production',
                        widgets: [makeWidget({ id: 'widget-production', title: 'Production widget' })],
                        layout: [makeLayout({ widgetId: 'widget-production', x: 0, y: 0, w: 4, h: 3 })],
                    }),
                    createDefaultDashboardView({
                        id: 'view-technical',
                        name: 'Technical',
                        order: 1,
                        widgets: [makeWidget({ id: 'widget-technical', title: 'Technical widget' })],
                        layout: [makeLayout({ widgetId: 'widget-technical', x: 4, y: 0, w: 4, h: 3 })],
                    }),
                ],
                activeViewId: 'view-production',
                widgets: [makeWidget({ id: 'widget-production', title: 'Production widget' })],
                layout: [makeLayout({ widgetId: 'widget-production', x: 0, y: 0, w: 4, h: 3 })],
                publishedAt: '2026-07-04T12:00:00.000Z',
            },
        });

        await renderBuilderPage(dashboardState, {
            allDashboards: [dashboardState],
            statefulDashboard: dashboardState,
        });

        expect(screen.getByRole('button', { name: 'Guardar Cambios' })).toBeDisabled();

        await user.click(screen.getByRole('button', { name: 'Technical' }));

        await waitFor(() => {
            expect(getBuilderCanvasSnapshot().widgetIds).toEqual(['widget-technical']);
        });

        expect(screen.queryByText('Cambios sin guardar')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Guardar Cambios' })).toBeDisabled();
        expect(dashboardStorageMock.saveDashboard).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Agregar KPI' }));

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Guardar Cambios' })).toBeEnabled();
        });

        expect(screen.queryByText('Cambios sin guardar')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Guardar Cambios' }).className).toContain('border-status-warning');
        expect(screen.getByRole('button', { name: 'Guardar Cambios' }).className).toContain('text-status-warning');

        await user.click(screen.getByRole('button', { name: 'Guardar Cambios' }));

        await waitFor(() => {
            expect(dashboardStorageMock.saveDashboard).toHaveBeenCalledTimes(1);
        });

        const savedDashboard = dashboardStorageMock.saveDashboard.mock.calls.at(-1)?.[0] as Dashboard;
        expect(savedDashboard.activeViewId).toBe('view-production');
        expect(savedDashboard.views?.find((view) => view.id === 'view-production')?.widgets).toEqual([
            expect.objectContaining({ id: 'widget-production', title: 'Production widget' }),
        ]);
        expect(savedDashboard.views?.find((view) => view.id === 'view-technical')?.widgets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'widget-technical', title: 'Technical widget' }),
            ]),
        );
        expect(savedDashboard.views?.find((view) => view.id === 'view-technical')?.widgets).toHaveLength(2);
    });

    it('targets widget duplicate, save, and publish operations to the active internal view without any control HTTP mutations', async () => {
        const user = userEvent.setup();
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);

        const dashboardState = makeDashboard({
            id: 'dashboard-1',
            name: 'Builder dashboard',
            ownerNodeId: 'node-1',
            status: 'published',
            views: [
                createDefaultDashboardView({
                    id: 'view-production',
                    name: 'Production',
                    widgets: [makeWidget({ id: 'widget-production', title: 'Production widget' })],
                    layout: [makeLayout({ widgetId: 'widget-production', x: 0, y: 0, w: 4, h: 3 })],
                }),
                createDefaultDashboardView({
                    id: 'view-technical',
                    name: 'Technical',
                    order: 1,
                    widgets: [makeWidget({ id: 'widget-technical', title: 'Technical widget' })],
                    layout: [makeLayout({ widgetId: 'widget-technical', x: 4, y: 0, w: 4, h: 3 })],
                }),
            ],
            activeViewId: 'view-production',
            widgets: [makeWidget({ id: 'widget-production', title: 'Production widget' })],
            layout: [makeLayout({ widgetId: 'widget-production', x: 0, y: 0, w: 4, h: 3 })],
            publishedSnapshot: {
                aspect: '16:9',
                cols: 40,
                rows: 24,
                views: [
                    createDefaultDashboardView({
                        id: 'view-production',
                        name: 'Production',
                        widgets: [makeWidget({ id: 'widget-production', title: 'Production widget' })],
                        layout: [makeLayout({ widgetId: 'widget-production', x: 0, y: 0, w: 4, h: 3 })],
                    }),
                    createDefaultDashboardView({
                        id: 'view-technical',
                        name: 'Technical',
                        order: 1,
                        widgets: [makeWidget({ id: 'widget-technical', title: 'Technical widget' })],
                        layout: [makeLayout({ widgetId: 'widget-technical', x: 4, y: 0, w: 4, h: 3 })],
                    }),
                ],
                activeViewId: 'view-production',
                widgets: [makeWidget({ id: 'widget-production', title: 'Production widget' })],
                layout: [makeLayout({ widgetId: 'widget-production', x: 0, y: 0, w: 4, h: 3 })],
                publishedAt: '2026-07-04T12:00:00.000Z',
            },
        });

        await renderBuilderPage(dashboardState, {
            allDashboards: [dashboardState],
            statefulDashboard: dashboardState,
        });

        await user.click(screen.getByRole('button', { name: 'Technical' }));
        await waitFor(() => {
            expect(getBuilderCanvasSnapshot().widgetIds).toEqual(['widget-technical']);
        });

        await user.click(screen.getByRole('button', { name: 'Agregar KPI' }));
        await waitFor(() => {
            expect(getBuilderCanvasSnapshot().widgetIds).toHaveLength(2);
        });

        await user.click(screen.getByRole('button', { name: 'Seleccionar Technical widget' }));
        await act(async () => {
            getLatestPropertyDockProps()?.onDuplicate?.();
        });

        await waitFor(() => {
            expect(getBuilderCanvasSnapshot().widgetIds).toHaveLength(3);
        });

        await user.click(screen.getByRole('button', { name: 'Guardar Cambios' }));

        await waitFor(() => {
            expect(dashboardStorageMock.saveDashboard).toHaveBeenCalled();
        });

        const savedDashboard = dashboardStorageMock.saveDashboard.mock.calls.at(-1)?.[0] as Dashboard;
        expect(savedDashboard.activeViewId).toBe('view-production');
        expect(savedDashboard.widgets.map((widget) => widget.id)).toEqual(expect.arrayContaining(['widget-production']));
        expect(savedDashboard.views?.find((view) => view.id === 'view-production')?.widgets).toEqual([
            expect.objectContaining({ id: 'widget-production', title: 'Production widget' }),
        ]);
        expect(savedDashboard.views?.find((view) => view.id === 'view-technical')?.widgets).toHaveLength(3);

        await user.click(screen.getByRole('button', { name: 'Publicar' }));

        await waitFor(() => {
            expect(dashboardStorageMock.publishDashboard).toHaveBeenCalledWith('dashboard-1');
        });

        expect(fetchSpy).not.toHaveBeenCalled();
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
