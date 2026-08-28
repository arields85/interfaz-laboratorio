import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makeWidget } from '../../test/fixtures/dashboard.fixture';
import { DashboardPresentationFrameProvider, useDashboardPresentationFrame } from '../../services/dashboardPresentationFrame.service';
import WidgetPresentationBoundary from './WidgetPresentationBoundary';
import HeaderWidgetRenderer from './HeaderWidgetRenderer';

vi.mock('../../queries/useDataHistory', () => ({
    useDataHistory: vi.fn(() => ({
        data: null,
        isLoading: false,
        isError: false,
        error: null,
        isEnabled: false,
    })),
    createDataHistoryQueryOptions: vi.fn(),
}));

vi.mock('../../queries/useActivitySeries', () => ({
    useActivitySeries: vi.fn(() => ({ data: null, isLoading: false, isError: false, error: null, isEnabled: false, isFetching: false, isPlaceholderData: false, isRefreshing: false })),
}));
vi.mock('../../queries/useProdTrendDataSource', () => ({
    useProdTrendDataSource: vi.fn(() => ({ configuredMode: 'real', effectiveMode: 'real', source: null, response: null, error: null, isLoading: false, isFetching: false, isRefreshing: false, isEnabled: false })),
}));

function FrameProbe({ widgetId }: { widgetId: string }) {
    const frame = useDashboardPresentationFrame();
    const entry = frame.entries.get(widgetId);
    return <output data-testid="frame-state">{entry ? `${frame.ready}:${entry === frame.entries.get(widgetId)}:${Object.isFrozen(entry)}` : 'missing'}</output>;
}

describe('WidgetPresentationBoundary', () => {
    it.each([
        ['metric-card', 'scalar'], ['kpi', 'scalar'], ['status', 'status'], ['connection-status', 'connection'],
        ['trend-chart', 'trend-chart'], ['trend-chart-v2', 'trend-chart-v2'], ['prod-history', 'production-history'],
        ['machine-activity', 'machine-activity'], ['activity-analytics', 'activity-analytics'], ['prod-trend', 'prod-trend'],
        ['alert-history', 'alert-history'], ['text-title', 'static'], ['info-card', 'static'],
    ] as const)('registers and renders the %s capability route', (type, capability) => {
        const widget = makeWidget({ id: `route-${type}`, type: type as never });

        function CapabilityProbe() {
            const frame = useDashboardPresentationFrame();
            const registeredEntry = frame.entries.get(widget.id);

            return <output data-testid="identity-state">{`${frame.ready}:${registeredEntry?.capability}`}</output>;
        }

        render(<DashboardPresentationFrameProvider dashboardId="dashboard-routes" viewId="view-routes" profileRevision={3} expectedWidgetIds={[widget.id]}>
                <WidgetPresentationBoundary widget={widget} equipmentMap={new Map()} />
                <CapabilityProbe />
            </DashboardPresentationFrameProvider>);

        expect(screen.getByTestId('identity-state')).toHaveTextContent(`true:${capability}`);
    });

    it('renders published static, status, metric, and KPI widgets through their canonical renderers', () => {
        const widgets = [
            makeWidget({ id: 'published-title', type: 'text-title', title: 'Published title' }),
            makeWidget({
                id: 'published-info',
                type: 'info-card',
                title: 'Published info',
                displayOptions: { fields: [{ id: 'batch', label: 'Batch', value: 'B-204' }] },
            }),
            makeWidget({
                id: 'published-status',
                type: 'status',
                title: 'Published status',
                binding: { mode: 'simulated_value', simulatedValue: 'warning' },
            }),
            makeWidget({
                id: 'published-metric',
                type: 'metric-card',
                title: 'Published metric',
                binding: { mode: 'simulated_value', simulatedValue: 42, unit: 'kW' },
            }),
            makeWidget({
                id: 'published-kpi',
                type: 'kpi',
                title: 'Published KPI',
                binding: { mode: 'simulated_value', simulatedValue: 42, unit: '%' },
            }),
        ];

        render(
            <DashboardPresentationFrameProvider
                dashboardId="dashboard-published"
                viewId="view-published"
                profileRevision={1}
                expectedWidgetIds={widgets.map((widget) => widget.id)}
            >
                {widgets.map((widget) => (
                    <WidgetPresentationBoundary key={widget.id} widget={widget} equipmentMap={new Map()} />
                ))}
            </DashboardPresentationFrameProvider>,
        );

        expect(screen.getByText('Published title')).not.toHaveClass('glass-panel');
        expect(screen.getByTestId('info-card-header')).toBeInTheDocument();
        expect(screen.getByText('Advertencia')).toBeInTheDocument();
        expect(screen.getByTestId('metric-card-header')).toBeInTheDocument();
        expect(screen.getByTestId('metric-card-value-row')).toHaveTextContent('42');
        expect(screen.getByTestId('gauge-circular')).toBeInTheDocument();
        expect(screen.queryByTestId('presentation-widget-published-title')).not.toBeInTheDocument();
    });

    it('feeds compact header widgets from the same controller entry into HeaderWidgetRenderer', () => {
        const widget = makeWidget({
            id: 'published-header-status',
            type: 'connection-status',
            title: 'Header connection',
        });

        render(
            <DashboardPresentationFrameProvider dashboardId="dashboard-header" viewId="view-header" profileRevision={1} expectedWidgetIds={[widget.id]}>
                <WidgetPresentationBoundary
                    widget={widget}
                    equipmentMap={new Map()}
                    connection={{ globalStatus: 'degradado', lastSuccess: '2026-04-21T13:00:00.000Z', ageMs: 65_000 }}
                    renderEntry={(entry) => (
                        <HeaderWidgetRenderer
                            widget={widget}
                            equipmentMap={new Map()}
                            align="start"
                            presentationData={entry.payload}
                        />
                    )}
                />
            </DashboardPresentationFrameProvider>,
        );

        expect(screen.getByText('Degradado')).toBeInTheDocument();
        expect(screen.getByText('1min')).toBeInTheDocument();
        expect(screen.getByTestId('connection-header-icon-degradado')).toBeInTheDocument();
        expect(screen.queryByTestId('presentation-widget-published-header-status')).not.toBeInTheDocument();
    });

    it('removes stale registrations when the dashboard revision changes', () => {
        const firstWidget = makeWidget({ id: 'first-revision' });
        const { rerender } = render(<DashboardPresentationFrameProvider dashboardId="dashboard-revision" viewId="view-one" profileRevision={1} expectedWidgetIds={[firstWidget.id]}>
                <WidgetPresentationBoundary widget={firstWidget} equipmentMap={new Map()} />
                <FrameProbe widgetId={firstWidget.id} />
            </DashboardPresentationFrameProvider>);

        expect(screen.getByTestId('frame-state')).toHaveTextContent('true:true:true');

        rerender(<DashboardPresentationFrameProvider dashboardId="dashboard-revision" viewId="view-two" profileRevision={2} expectedWidgetIds={[]}>
                <FrameProbe widgetId={firstWidget.id} />
            </DashboardPresentationFrameProvider>);

        expect(screen.getByTestId('frame-state')).toHaveTextContent('missing');
    });
    it('keeps an unsupported visible widget non-fatal and emits one diagnostic per frame revision', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        render(<DashboardPresentationFrameProvider dashboardId="d" viewId="v" profileRevision={1} expectedWidgetIds={['unsupported-1']}>
            <WidgetPresentationBoundary widget={makeWidget({ id: 'unsupported-1', type: 'badge' })} equipmentMap={new Map()} />
            <FrameProbe widgetId="unsupported-1" />
        </DashboardPresentationFrameProvider>);
        expect(screen.getByTestId('frame-state')).toHaveTextContent('true:true:true');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unsupported presentation capability'), expect.objectContaining({ widgetId: 'unsupported-1' }));
        warnSpy.mockRestore();
    });
});
