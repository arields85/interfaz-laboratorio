import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientContext } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractMachine, DataHistoryResponseV2 } from '../domain/dataContract.types';
import type {
    ActivityAnalyticsWidgetConfig,
    AlertHistoryWidgetConfig,
    InfoCardWidgetConfig,
    MachineActivityWidgetConfig,
    MetricCardWidgetConfig,
    ProdTrendWidgetConfig,
    ProdHistoryWidgetConfig,
    TrendChartV2WidgetConfig,
} from '../domain/admin.types';
import type { HierarchyContext } from './resolvers/hierarchyResolver';
import { isDataHistoryEnabled } from '../config/dataConnection.config';
import { useTemporalSettings } from '../hooks/useTemporalSettings';
import { useActivitySeries } from '../queries/useActivitySeries';
import { useDataHistory } from '../queries/useDataHistory';
import { subscribeActivityAnalyticsPerformanceDiagnostics } from '../utils/activityAnalyticsPerformanceDiagnostics';
import WidgetRenderer from './WidgetRenderer';

const trendChartV2RendererSpy = vi.fn();

vi.mock('./renderers/TrendChartV2Widget', () => ({
    default: (props: {
        widget: { id: string; title?: string };
        renderContext?: { surface?: string; isTransientResizeActive?: boolean };
    }) => {
        trendChartV2RendererSpy(props);

        return (
            <div
                data-testid="trend-chart-v2-renderer-spy"
                data-render-surface={props.renderContext?.surface ?? 'none'}
                data-resize-active={props.renderContext?.isTransientResizeActive === true ? 'true' : 'false'}
            >
                {props.widget.title ?? props.widget.id}
            </div>
        );
    },
}));

class MockResizeObserver implements ResizeObserver {
    public constructor(private readonly callback: ResizeObserverCallback) {}

    public observe(target: Element): void {
        this.callback([
            {
                target,
                contentRect: {
                    width: 320,
                    height: 180,
                    top: 0,
                    left: 0,
                    bottom: 180,
                    right: 320,
                    x: 0,
                    y: 0,
                    toJSON: () => ({}),
                },
            } as ResizeObserverEntry,
        ], this);
    }

    public unobserve(): void {}

    public disconnect(): void {}
}

vi.mock('../config/dataConnection.config', () => ({
    isDataHistoryEnabled: vi.fn(),
    isDataActivitySeriesEnabled: vi.fn(() => true),
}));

vi.mock('../queries/useDataHistory', () => ({
    useDataHistory: vi.fn(),
}));

vi.mock('../queries/useActivitySeries', async () => {
    const actual = await vi.importActual<typeof import('../queries/useActivitySeries')>('../queries/useActivitySeries');

    return {
        ...actual,
        useActivitySeries: vi.fn(),
    };
});

vi.mock('../hooks/useTemporalSettings', () => ({
    useTemporalSettings: vi.fn(),
}));

const equipmentMap = new Map();

function renderWithQueryClient(element: Parameters<typeof render>[0], overrides?: { getQueryState?: ReturnType<typeof vi.fn>; prefetchQuery?: ReturnType<typeof vi.fn> }) {
    return render(
        <QueryClientContext.Provider
            value={{
                getQueryState: overrides?.getQueryState ?? vi.fn(),
                prefetchQuery: overrides?.prefetchQuery ?? vi.fn().mockResolvedValue(undefined),
            } as never}
        >
            {element}
        </QueryClientContext.Provider>,
    );
}

const widget: MachineActivityWidgetConfig = {
    id: 'machine-activity-1',
    type: 'machine-activity',
    title: 'Actividad de Máquina',
    position: { x: 0, y: 0 },
    size: { w: 1, h: 2 },
    binding: {
        mode: 'real_variable',
        bindingVersion: 'node-red-v1',
        machineId: 101,
        variableKey: 'activePower',
        unit: 'kW',
    },
    displayOptions: {
        icon: 'Activity',
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
        labelStopped: 'Detenida',
        labelCalibrating: 'Setup',
        labelProducing: 'Produciendo',
    },
};

const machines: ContractMachine[] = [{
    unitId: 101,
    name: 'Extrusora 101',
    status: 'online',
    lastSuccess: '2026-04-23T22:00:00.000Z',
    ageMs: 0,
    values: {
        activePower: {
            value: 0.35,
            unit: 'kW',
            timestamp: '2026-04-23T22:00:00.000Z',
        },
    },
}];

function makeMetricCardWidget(overrides?: Partial<MetricCardWidgetConfig>): MetricCardWidgetConfig {
    return {
        id: 'metric-card-1',
        type: 'metric-card',
        title: 'Potencia agregada',
        position: { x: 0, y: 0 },
        size: { w: 6, h: 5 },
        binding: {
            mode: 'real_variable',
            bindingVersion: 'node-red-v1',
            catalogVariableId: 'cv-active-power',
            unit: 'kW',
        },
        displayOptions: {},
        ...overrides,
    };
}

const hierarchyMetricCardContext: HierarchyContext = {
    currentNodeId: 'node-root',
    allNodes: [
        { id: 'node-root', name: 'Planta', parentId: null },
        { id: 'node-linea-a', name: 'Línea A', parentId: 'node-root', linkedDashboardId: 'dashboard-linea-a' },
    ],
    allDashboards: [
        {
            id: 'dashboard-linea-a',
            name: 'Dashboard Línea A',
            status: 'published',
            widgets: [
                {
                    id: 'metric-card-child',
                    type: 'metric-card',
                    title: 'Potencia Línea A',
                    position: { x: 0, y: 0 },
                    size: { w: 4, h: 3 },
                    binding: {
                        mode: 'real_variable',
                        bindingVersion: 'node-red-v1',
                        machineId: 101,
                        variableKey: 'activePower',
                        catalogVariableId: 'cv-active-power',
                        unit: 'kW',
                    },
                    displayOptions: {},
                },
            ],
            layout: [],
        },
    ],
};

function makeTrendChartV2Response(): DataHistoryResponseV2 {
    return {
        contractVersion: '1.1.0',
        machineId: 101,
        variableKey: 'temperature',
        range: '24h',
        unit: '°C',
        window: {
            start: '2026-06-18T12:00:00.000Z',
            end: '2026-06-18T14:00:00.000Z',
            timezone: 'UTC',
            bucketMs: 60_000,
        },
        series: [
            { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 45 },
            { timestamp: '2026-06-18T13:00:00.000Z', timestampMs: Date.parse('2026-06-18T13:00:00.000Z'), value: 52 },
        ],
        summary: {
            last: 52,
            min: 45,
            max: 52,
            avg: 48.5,
        },
    };
}

describe('WidgetRenderer', () => {
    beforeEach(() => {
        trendChartV2RendererSpy.mockReset();
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: 'UTC', shifts: [] },
            shifts: [],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeTrendChartV2Response(),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        vi.mocked(useActivitySeries).mockReturnValue({
            data: null,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
    });

    it('dispatches machine-activity widgets to the dedicated renderer', () => {
        render(
            <WidgetRenderer
                widget={widget}
                equipmentMap={equipmentMap}
                machines={machines}
                isLoadingData={false}
            />,
        );

        expect(screen.getByText('Actividad de Máquina')).toBeInTheDocument();
        expect(screen.getByText('0')).toBeInTheDocument();
        expect(screen.getByText('0.35 kW')).toBeInTheDocument();
        expect(screen.getByTestId('gauge-circular')).toBeInTheDocument();
    });

    it('uses the simple unsupported widget runtime legend without exposing internal type details', () => {
        render(
            <WidgetRenderer
                widget={{
                    id: 'unsupported-1',
                    type: 'future-widget' as never,
                    title: 'Future Widget',
                    position: { x: 0, y: 0 },
                    size: { w: 2, h: 2 },
                    displayOptions: {},
                }}
                equipmentMap={equipmentMap}
            />,
        );

        const state = screen.getByTestId('unsupported-widget-future-widget');

        expect(state).toHaveTextContent('Widget no soportado');
        expect(screen.queryByText('type: future-widget')).not.toBeInTheDocument();
        expect(screen.queryByText('Future Widget')).not.toBeInTheDocument();
    });

    it('navigates non-text-title widgets through the shared viewer wrapper when configured', async () => {
        const user = userEvent.setup();
        const onNavigateDashboard = vi.fn();

        render(
            <WidgetRenderer
                widget={{
                    ...widget,
                    navigationTargetDashboardId: 'dashboard-linea-a',
                }}
                equipmentMap={equipmentMap}
                machines={machines}
                isLoadingData={false}
                onNavigateDashboard={onNavigateDashboard}
            />,
        );

        const surface = screen.getByRole('button', { name: 'Actividad de Máquina' });

        await user.click(surface);
        fireEvent.keyDown(surface, { key: 'Enter' });

        expect(onNavigateDashboard).toHaveBeenNthCalledWith(1, 'dashboard-linea-a');
        expect(onNavigateDashboard).toHaveBeenNthCalledWith(2, 'dashboard-linea-a');
    });

    it('keeps hierarchy metric-card disclosure interactions from navigating while preserving card-surface pointer navigation', async () => {
        const user = userEvent.setup();
        const onNavigateDashboard = vi.fn();

        render(
            <WidgetRenderer
                widget={makeMetricCardWidget({
                    hierarchyMode: true,
                    navigationTargetDashboardId: 'dashboard-linea-a',
                })}
                equipmentMap={equipmentMap}
                machines={machines}
                hierarchyContext={hierarchyMetricCardContext}
                onNavigateDashboard={onNavigateDashboard}
            />,
        );

        expect(screen.queryByRole('button', { name: 'Potencia agregada' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Ver detalle de agregación de Potencia agregada' }));

        expect(onNavigateDashboard).not.toHaveBeenCalled();
        expect(screen.getByText('Potencia Línea A')).toBeInTheDocument();

        await user.click(screen.getByText('Potencia agregada'));

        expect(onNavigateDashboard).toHaveBeenCalledWith('dashboard-linea-a');
    });

    it('keeps hierarchy detail interactions informational and read-only across pointer and keyboard use', async () => {
        const user = userEvent.setup();
        const onNavigateDashboard = vi.fn();

        render(
            <WidgetRenderer
                widget={makeMetricCardWidget({
                    hierarchyMode: true,
                    navigationTargetDashboardId: 'dashboard-linea-a',
                })}
                equipmentMap={equipmentMap}
                machines={machines}
                hierarchyContext={hierarchyMetricCardContext}
                onNavigateDashboard={onNavigateDashboard}
            />,
        );

        const disclosure = screen.getByRole('button', {
            name: 'Ver detalle de agregación de Potencia agregada',
        });

        disclosure.focus();

        expect(disclosure).toHaveFocus();
        expect(disclosure).toHaveAttribute('aria-expanded', 'false');

        await user.click(disclosure);

        expect(onNavigateDashboard).not.toHaveBeenCalled();
        expect(disclosure).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Potencia Línea A')).toBeInTheDocument();

        await user.keyboard(' ');

        expect(onNavigateDashboard).not.toHaveBeenCalled();
        expect(disclosure).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('Potencia Línea A')).not.toBeInTheDocument();
    });

    it('keeps non-hierarchy metric-cards on the shared keyboard-navigation wrapper', async () => {
        const user = userEvent.setup();
        const onNavigateDashboard = vi.fn();

        render(
            <WidgetRenderer
                widget={makeMetricCardWidget({
                    navigationTargetDashboardId: 'dashboard-linea-a',
                })}
                equipmentMap={equipmentMap}
                machines={machines}
                onNavigateDashboard={onNavigateDashboard}
            />,
        );

        const surface = screen.getByRole('button', { name: 'Potencia agregada' });

        expect(screen.queryByRole('button', { name: 'Ver detalle de agregación de Potencia agregada' })).not.toBeInTheDocument();

        await user.click(surface);
        fireEvent.keyDown(surface, { key: 'Enter' });

        expect(onNavigateDashboard).toHaveBeenNthCalledWith(1, 'dashboard-linea-a');
        expect(onNavigateDashboard).toHaveBeenNthCalledWith(2, 'dashboard-linea-a');
    });

    it('does not expose shared navigation semantics when no target dashboard is configured', () => {
        render(
            <WidgetRenderer
                widget={widget}
                equipmentMap={equipmentMap}
                machines={machines}
                isLoadingData={false}
                onNavigateDashboard={vi.fn()}
            />,
        );

        expect(screen.queryByRole('button', { name: 'Actividad de Máquina' })).not.toBeInTheDocument();
    });

    it('keeps pointer navigation for widgets with internal controls without adding a button-like parent wrapper', async () => {
        const user = userEvent.setup();
        const onNavigateDashboard = vi.fn();
        const alertHistoryWidget: AlertHistoryWidgetConfig = {
            id: 'alert-history-1',
            type: 'alert-history',
            title: 'Alert History',
            position: { x: 0, y: 0 },
            size: { w: 8, h: 8 },
            navigationTargetDashboardId: 'dashboard-linea-a',
            displayOptions: {
                dashboardId: 'dashboard-alert-history-navigation-test',
            },
        };

        render(
            <WidgetRenderer
                widget={alertHistoryWidget}
                equipmentMap={equipmentMap}
                machines={machines}
                isLoadingData={false}
                onNavigateDashboard={onNavigateDashboard}
                siblingWidgets={[]}
            />,
        );

        expect(screen.queryByRole('button', { name: 'Alert History' })).not.toBeInTheDocument();

        const internalControl = screen.getByRole('button', { name: 'Ver historial completo (funcionalidad pendiente)' });

        expect(internalControl.closest('[role="button"]')).toBeNull();

        await user.click(internalControl);

        expect(onNavigateDashboard).not.toHaveBeenCalled();

        await user.click(screen.getByText('Alert History'));

        expect(onNavigateDashboard).toHaveBeenCalledWith('dashboard-linea-a');
    });

    it('keeps prod-history pointer navigation without adding shared button semantics around its internal controls', async () => {
        const user = userEvent.setup();
        const onNavigateDashboard = vi.fn();
        const prodHistoryWidget: ProdHistoryWidgetConfig = {
            id: 'prod-history-1',
            type: 'prod-history',
            title: 'Producción histórica',
            position: { x: 0, y: 0 },
            size: { w: 11, h: 9 },
            navigationTargetDashboardId: 'dashboard-linea-a',
            displayOptions: {
                chartTitle: 'Producción histórica',
            },
        };

        render(
            <WidgetRenderer
                widget={prodHistoryWidget}
                equipmentMap={equipmentMap}
                isLoadingData={false}
                onNavigateDashboard={onNavigateDashboard}
            />,
        );

        expect(screen.queryByRole('button', { name: 'Producción histórica' })).not.toBeInTheDocument();

        const oeeToggle = screen.getByRole('checkbox', { name: 'Mostrar OEE (%)' });

        expect(oeeToggle.closest('[role="button"]')).toBeNull();

        await user.click(oeeToggle);

        expect(onNavigateDashboard).not.toHaveBeenCalled();

        await user.click(screen.getByText('Producción histórica'));

        expect(onNavigateDashboard).toHaveBeenCalledWith('dashboard-linea-a');
    });

    it('dispatches trend-chart-v2 widgets to the dedicated timestamp renderer without breaking legacy types', () => {
        const trendChartV2Widget: TrendChartV2WidgetConfig = {
            id: 'trend-v2-1',
            type: 'trend-chart-v2',
            title: 'Trend Chart V2',
            position: { x: 0, y: 0 },
            size: { w: 11, h: 9 },
            binding: {
                mode: 'real_variable',
                bindingVersion: 'node-red-v1',
                machineId: 101,
                variableKey: 'temperature',
            },
            displayOptions: { historicalDensity: 'normal' },
        };

        render(
            <WidgetRenderer
                widget={trendChartV2Widget}
                equipmentMap={equipmentMap}
                machines={machines}
                isLoadingData={false}
            />,
        );

        expect(screen.getByTestId('trend-chart-v2-renderer-spy')).toHaveTextContent('Trend Chart V2');
        expect(trendChartV2RendererSpy).toHaveBeenCalledWith(expect.objectContaining({
            widget: expect.objectContaining({ id: 'trend-v2-1' }),
        }));
    });

    it('forwards render context only to trend-chart-v2 widgets', () => {
        const renderContext = { surface: 'builder' as const, isTransientResizeActive: true };
        const trendChartV2Widget: TrendChartV2WidgetConfig = {
            id: 'trend-v2-1',
            type: 'trend-chart-v2',
            title: 'Trend Chart V2',
            position: { x: 0, y: 0 },
            size: { w: 11, h: 9 },
            binding: {
                mode: 'real_variable',
                bindingVersion: 'node-red-v1',
                machineId: 101,
                variableKey: 'temperature',
            },
            displayOptions: { historicalDensity: 'normal' },
        };

        const { rerender } = render(
            <WidgetRenderer
                widget={trendChartV2Widget}
                equipmentMap={equipmentMap}
                machines={machines}
                renderContext={renderContext}
            />,
        );

        expect(screen.getByTestId('trend-chart-v2-renderer-spy')).toHaveAttribute('data-render-surface', 'builder');
        expect(screen.getByTestId('trend-chart-v2-renderer-spy')).toHaveAttribute('data-resize-active', 'true');
        expect(trendChartV2RendererSpy).toHaveBeenLastCalledWith(expect.objectContaining({ renderContext }));

        rerender(
            <WidgetRenderer
                widget={widget}
                equipmentMap={equipmentMap}
                machines={machines}
                renderContext={renderContext}
            />,
        );

        expect(screen.queryByTestId('trend-chart-v2-renderer-spy')).not.toBeInTheDocument();
        expect(trendChartV2RendererSpy).toHaveBeenCalledTimes(1);
    });

    it('dispatches activity-analytics widgets to the dedicated runtime renderer and preserves the editable widget title in the header', () => {
        const activityAnalyticsWidget: ActivityAnalyticsWidgetConfig = {
            id: 'activity-analytics-1',
            type: 'activity-analytics',
            title: 'prueba',
            position: { x: 0, y: 0 },
            size: { w: 11, h: 9 },
            binding: {
                mode: 'real_variable',
                bindingVersion: 'node-red-v1',
                machineId: 101,
            },
            displayOptions: {
                range: '24h',
                groupBy: 'day',
                setupThresholdKw: 0.15,
                prodThresholdKw: 0.25,
                displayMode: 'kpis-and-bars',
            },
        };

        vi.mocked(useActivitySeries).mockReturnValue({
            data: {
                contractVersion: '1.0.0',
                machineId: 101,
                variableKey: 'Total kW',
                range: '24h',
                unit: 'kW',
                purpose: 'activity-analytics',
                window: {
                    start: '2026-06-18T12:00:00.000Z',
                    end: '2026-06-18T14:00:00.000Z',
                    timezone: 'UTC',
                    bucket: '5m',
                    bucketMs: 300000,
                },
                series: [
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 0.3 },
                    { timestamp: '2026-06-18T13:00:00.000Z', timestampMs: Date.parse('2026-06-18T13:00:00.000Z'), value: 0.05 },
                ],
                summary: { hidden: true },
            },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(
            <WidgetRenderer
                widget={activityAnalyticsWidget}
                equipmentMap={equipmentMap}
                machines={machines}
                isLoadingData={false}
            />,
        );

        expect(screen.getByText('prueba')).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-summary-text')).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-runtime-controls')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'SEMANA' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'MES' })).toBeDisabled();
        expect(screen.queryByText('hidden')).not.toBeInTheDocument();
    });

    it('dispatches prod-trend widgets to the dedicated standalone trend renderer', () => {
        const prodTrendWidget: ProdTrendWidgetConfig = {
            id: 'prod-trend-1',
            type: 'prod-trend',
            title: 'PROD-TREND',
            position: { x: 0, y: 0 },
            size: { w: 11, h: 4 },
            binding: {
                mode: 'real_variable',
                bindingVersion: 'node-red-v1',
                machineId: 101,
            },
            displayOptions: {
                range: '7d',
                groupBy: 'day',
                setupThresholdKw: 0.15,
                prodThresholdKw: 0.25,
            },
        };

        vi.mocked(useActivitySeries).mockReturnValue({
            data: {
                contractVersion: '1.0.0',
                machineId: 101,
                variableKey: 'Total kW',
                range: '7d',
                unit: 'kW',
                purpose: 'activity-analytics',
                window: {
                    start: '2026-06-18T12:00:00.000Z',
                    end: '2026-06-18T14:00:00.000Z',
                    timezone: 'UTC',
                    bucket: '5m',
                    bucketMs: 300000,
                },
                series: [
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 0.3 },
                    { timestamp: '2026-06-18T13:00:00.000Z', timestampMs: Date.parse('2026-06-18T13:00:00.000Z'), value: 0.05 },
                ],
                summary: { hidden: true },
            },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(
            <WidgetRenderer
                widget={prodTrendWidget}
                equipmentMap={equipmentMap}
                machines={machines}
                isLoadingData={false}
            />,
        );

        expect(screen.getByTestId('prod-trend-widget-root')).toBeInTheDocument();
        expect(screen.getByTestId('prod-trend-widget-chart')).toHaveAttribute('data-y-domain-max', '100');
    });

    it('forwards activity-analytics persistence callbacks to the dedicated runtime renderer', () => {
        const onPersistWidgetDisplayOptions = vi.fn();
        const activityAnalyticsWidget: ActivityAnalyticsWidgetConfig = {
            id: 'activity-analytics-1',
            type: 'activity-analytics',
            title: 'ACT-ANALYTICS',
            position: { x: 0, y: 0 },
            size: { w: 11, h: 9 },
            binding: {
                mode: 'real_variable',
                bindingVersion: 'node-red-v1',
                machineId: 101,
            },
            displayOptions: {
                range: 'custom',
                start: '2026-06-18T10:00:00.000Z',
                end: '2026-06-18T12:00:00.000Z',
                groupBy: 'shift',
                setupThresholdKw: 0.15,
                prodThresholdKw: 0.25,
                displayMode: 'kpis-and-bars',
            },
        };

        vi.mocked(useActivitySeries).mockReturnValue({
            data: {
                contractVersion: '1.0.0',
                machineId: 101,
                variableKey: 'Total kW',
                range: 'custom',
                unit: 'kW',
                purpose: 'activity-analytics',
                window: {
                    start: '2026-06-18T10:00:00.000Z',
                    end: '2026-06-18T12:00:00.000Z',
                    timezone: 'UTC',
                    bucket: '5m',
                    bucketMs: 300000,
                },
                series: [
                    { timestamp: '2026-06-18T10:00:00.000Z', timestampMs: Date.parse('2026-06-18T10:00:00.000Z'), value: 0.3 },
                ],
                summary: { hidden: true },
            },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(
            <WidgetRenderer
                widget={activityAnalyticsWidget}
                equipmentMap={equipmentMap}
                machines={machines}
                isLoadingData={false}
                onPersistWidgetDisplayOptions={onPersistWidgetDisplayOptions}
            />,
        );

        expect(screen.getByText('ACT-ANALYTICS')).toBeInTheDocument();

        expect(screen.queryByRole('button', { name: 'Custom' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'TURNO' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('keeps runtime grouping local in the dispatched activity-analytics renderer while preserving the runtime control row', async () => {
        const user = userEvent.setup();
        const onPersistWidgetDisplayOptions = vi.fn();
        const activityAnalyticsWidget: ActivityAnalyticsWidgetConfig = {
            id: 'activity-analytics-1',
            type: 'activity-analytics',
            title: 'Análisis de Actividad',
            position: { x: 0, y: 0 },
            size: { w: 11, h: 9 },
            binding: {
                mode: 'real_variable',
                bindingVersion: 'node-red-v1',
                machineId: 101,
            },
            displayOptions: {
                range: '24h',
                groupBy: 'week',
                setupThresholdKw: 0.15,
                prodThresholdKw: 0.25,
                displayMode: 'kpis-and-bars',
            },
        };

        vi.mocked(useActivitySeries).mockReturnValue({
            data: {
                contractVersion: '1.0.0',
                machineId: 101,
                variableKey: 'Total kW',
                range: '24h',
                unit: 'kW',
                purpose: 'activity-analytics',
                window: {
                    start: '2026-06-18T12:00:00.000Z',
                    end: '2026-06-18T14:00:00.000Z',
                    timezone: 'UTC',
                    bucket: '5m',
                    bucketMs: 300000,
                },
                series: [
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 0.3 },
                    { timestamp: '2026-06-18T13:00:00.000Z', timestampMs: Date.parse('2026-06-18T13:00:00.000Z'), value: 0.05 },
                ],
                summary: { hidden: true },
            },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(
            <WidgetRenderer
                widget={activityAnalyticsWidget}
                equipmentMap={equipmentMap}
                machines={machines}
                isLoadingData={false}
                onPersistWidgetDisplayOptions={onPersistWidgetDisplayOptions}
            />,
        );

        expect(screen.getByRole('button', { name: 'SEMANA' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'MES' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Custom' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'DÍA' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'SEMANA' })).toHaveAttribute('aria-pressed', 'false');

        await user.click(screen.getByRole('button', { name: 'TURNO' }));

        expect(screen.getByRole('button', { name: 'TURNO' })).toHaveAttribute('aria-pressed', 'true');
        expect(onPersistWidgetDisplayOptions).not.toHaveBeenCalled();
    });

    it('forwards sibling widgets through the real activity-analytics render path so dashboard pressure suppresses prefetch', async () => {
        class VisibleIntersectionObserver implements IntersectionObserver {
            public readonly root = null;
            public readonly rootMargin = '0px';
            public readonly thresholds = [0];

            public constructor(private readonly callback: IntersectionObserverCallback) {}

            public observe(target: Element): void {
                this.callback([
                    {
                        target,
                        isIntersecting: true,
                        intersectionRatio: 1,
                        boundingClientRect: target.getBoundingClientRect(),
                        intersectionRect: target.getBoundingClientRect(),
                        rootBounds: null,
                        time: 0,
                    } as IntersectionObserverEntry,
                ], this);
            }

            public unobserve(): void {}
            public disconnect(): void {}
            public takeRecords(): IntersectionObserverEntry[] { return []; }
        }

        const activityAnalyticsWidget: ActivityAnalyticsWidgetConfig = {
            id: 'activity-analytics-1',
            type: 'activity-analytics',
            title: 'ACT-ANALYTICS',
            position: { x: 0, y: 0 },
            size: { w: 11, h: 9 },
            binding: {
                mode: 'real_variable',
                bindingVersion: 'node-red-v1',
                machineId: 101,
            },
            displayOptions: {
                range: '7d',
                groupBy: 'shift',
                setupThresholdKw: 0.15,
                prodThresholdKw: 0.25,
                displayMode: 'kpis-and-bars',
            },
        };
        const siblingWidgets = [
            activityAnalyticsWidget,
            { ...activityAnalyticsWidget, id: 'activity-analytics-2' },
            { ...activityAnalyticsWidget, id: 'activity-analytics-3' },
        ];
        const prefetchQuery = vi.fn().mockResolvedValue(undefined);
        const diagnostics: Array<{ widgetId: string; event: string; reason?: string }> = [];
        const unsubscribe = subscribeActivityAnalyticsPerformanceDiagnostics((event) => {
            diagnostics.push(event);
        });

        vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
        vi.stubGlobal('requestIdleCallback', ((callback: IdleRequestCallback) => {
            callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
            return 1;
        }) as typeof requestIdleCallback);
        vi.stubGlobal('cancelIdleCallback', vi.fn());
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });

        vi.mocked(useActivitySeries).mockReturnValue({
            data: {
                contractVersion: '1.0.0',
                machineId: 101,
                variableKey: 'Total kW',
                range: '7d',
                unit: 'kW',
                purpose: 'activity-analytics',
                window: {
                    start: '2026-06-18T12:00:00.000Z',
                    end: '2026-06-18T14:00:00.000Z',
                    timezone: 'UTC',
                    bucket: '5m',
                    bucketMs: 300000,
                },
                series: [
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 0.3 },
                ],
                summary: { hidden: true },
            },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
            isFetching: false,
            isPlaceholderData: false,
            isRefreshing: false,
        });

        try {
            renderWithQueryClient(
                <WidgetRenderer
                    widget={activityAnalyticsWidget}
                    equipmentMap={equipmentMap}
                    machines={machines}
                    siblingWidgets={siblingWidgets}
                />,
                { prefetchQuery },
            );

            await waitFor(() => expect(diagnostics.some((event) => event.reason === 'dashboard_pressure')).toBe(true));

            expect(prefetchQuery).not.toHaveBeenCalled();
        } finally {
            unsubscribe();
        }
    });

    it('routes info-card widgets to the static renderer without unsupported or control UI', () => {
        const infoCardWidget: InfoCardWidgetConfig = {
            id: 'info-card-renderer-1',
            type: 'info-card',
            title: 'Static Lab Context',
            position: { x: 0, y: 0 },
            size: { w: 6, h: 5 },
            displayOptions: {
                fields: [
                    { id: 'sample', label: 'Sample', value: 'QA-17' },
                ],
            },
        };

        render(<WidgetRenderer widget={infoCardWidget} equipmentMap={equipmentMap} />);

        expect(screen.getByText('Static Lab Context')).toBeInTheDocument();
        expect(screen.getByText('Sample')).toBeInTheDocument();
        expect(screen.getByText('QA-17')).toBeInTheDocument();
        expect(screen.queryByText('Widget no soportado')).not.toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
});
