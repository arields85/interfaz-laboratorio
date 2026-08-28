import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makeWidget } from '../../test/fixtures/dashboard.fixture';
import { DashboardPresentationFrameProvider, useDashboardPresentationFrame } from '../../services/dashboardPresentationFrame.service';
import WidgetPresentationBoundary from './WidgetPresentationBoundary';

const rendererEntries = new Map<string, unknown>();

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

vi.mock('../../widgets/WidgetRenderer', () => ({
    default: ({ widget, presentationEntry }: { widget: { id: string }; presentationEntry?: unknown }) => {
        rendererEntries.set(widget.id, presentationEntry);
        return <div data-testid={`rendered-${widget.id}`} />;
    },
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

        function IdentityProbe() {
            const frame = useDashboardPresentationFrame();
            const registeredEntry = frame.entries.get(widget.id);
            const rendererEntry = rendererEntries.get(widget.id);

            return <output data-testid="identity-state">{`${frame.ready}:${registeredEntry?.capability}:${rendererEntry === registeredEntry}`}</output>;
        }

        render(<DashboardPresentationFrameProvider dashboardId="dashboard-routes" viewId="view-routes" profileRevision={3} expectedWidgetIds={[widget.id]}>
                <WidgetPresentationBoundary widget={widget} equipmentMap={new Map()} />
                <IdentityProbe />
            </DashboardPresentationFrameProvider>);

        expect(screen.getByTestId('identity-state')).toHaveTextContent(`true:${capability}:true`);
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
