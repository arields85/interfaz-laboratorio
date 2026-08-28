import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makeWidget } from '../../test/fixtures/dashboard.fixture';
import { useDataHistory } from '../../queries/useDataHistory';
import { useActivitySeries } from '../../queries/useActivitySeries';
import { DashboardPresentationFrameProvider } from '../../services/dashboardPresentationFrame.service';
import {
    ActivityAnalyticsPresentationController,
    ScalarPresentationController,
    TrendChartV2Controller,
} from './PresentationControllers';

vi.mock('../../queries/useDataHistory', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../queries/useDataHistory')>(),
    useDataHistory: vi.fn(() => ({
        data: { machineId: 101, variableKey: 'temperature', range: 'hora', unit: '°C', points: [] },
        isLoading: false,
        isError: false,
        error: null,
        isEnabled: true,
        isFetching: false,
        isPlaceholderData: false,
        isRefreshing: false,
    })),
}));

vi.mock('../../queries/useActivitySeries', () => ({
    useActivitySeries: vi.fn(() => ({ data: null, isLoading: false, isError: false, error: null, isEnabled: true, isFetching: false, isPlaceholderData: false, isRefreshing: false })),
    createActivitySeriesQueryOptions: vi.fn(({ machineId, range }: { machineId: number; range: string }) => ({ queryKey: ['data', 'activity-series', machineId, range, null, null] })),
}));

describe('presentation controllers', () => {
    it('runs the scalar binding seam before rendering', () => {
        render(
            <ScalarPresentationController
                widget={makeWidget({ id: 'scalar-2', binding: { mode: 'simulated_value', simulatedValue: 42 } })}
                equipmentMap={new Map()}
                render={(entry) => <output data-testid="entry">{String(entry.payload.value)}</output>}
            />,
        );

        expect(screen.getByTestId('entry')).toHaveTextContent('42');
    });

    it('keeps trend V2 prefetch ownership in its controller seam', () => {
        const prefetchQuery = vi.fn().mockResolvedValue(undefined);
        const widget = { ...makeWidget({ id: 'trend-v2' }), type: 'trend-chart-v2' as const, binding: { mode: 'real_variable' as const, machineId: 101, variableKey: 'temperature' } };
        render(
            <TrendChartV2Controller
                widget={widget}
                equipmentMap={new Map()}
                queryClient={{ prefetchQuery } as never}
                render={(entry) => <output data-testid="entry">{entry.capability}</output>}
            />,
        );

        expect(screen.getByTestId('entry')).toHaveTextContent('trend-chart-v2');
        expect(useDataHistory).toHaveBeenCalledTimes(1);
        expect(prefetchQuery).toHaveBeenCalledTimes(1);
        expect(prefetchQuery.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ queryKey: ['data', 'history', 101, 'temperature', '24h', null, null, null] }));
    });

    it('does not prefetch without a real binding', () => {
        const prefetchQuery = vi.fn();
        render(<TrendChartV2Controller widget={{ ...makeWidget({ id: 'trend-v2-sim', type: 'trend-chart-v2', binding: { mode: 'simulated_value', simulatedValue: 1 } }) }} equipmentMap={new Map()} queryClient={{ prefetchQuery } as never} render={() => null} />);
        expect(prefetchQuery).not.toHaveBeenCalled();
    });

    it('schedules the Activity-Series prefetch and cancels it when the frame revision changes', () => {
        let resolveOldPrefetch: (() => void) | undefined;
        const prefetchQuery = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
            resolveOldPrefetch = resolve;
        }));
        const scheduled: IdleRequestCallback[] = [];
        const cancelIdleCallback = vi.fn();
        const setQueryData = vi.fn();
        vi.stubGlobal('requestIdleCallback', ((callback: IdleRequestCallback) => {
            scheduled.push(callback);
            return scheduled.length;
        }) as typeof requestIdleCallback);
        vi.stubGlobal('cancelIdleCallback', cancelIdleCallback);

        const widget = makeWidget({ id: 'activity-revision', type: 'activity-analytics', binding: { mode: 'real_variable', machineId: 101 } });
        const renderFrame = (profileRevision: number) => (
            <DashboardPresentationFrameProvider dashboardId="dashboard" viewId="view" profileRevision={profileRevision} expectedWidgetIds={[widget.id]}>
                <div data-testid="revision-root">
                    <ActivityAnalyticsPresentationController
                        widget={widget}
                        machines={[{ unitId: 101, name: 'Extrusora 101', status: 'online', lastSuccess: null, ageMs: null, values: {} }]}
                        queryClient={{ prefetchQuery, setQueryData } as never}
                        render={(entry) => <output data-testid="entry">{entry.revisionKey}:{String((entry.payload.data as { provenance?: string } | undefined)?.provenance)}</output>}
                    />
                </div>
            </DashboardPresentationFrameProvider>
        );
        const { rerender } = render(
            renderFrame(1),
        );

        expect(prefetchQuery).not.toHaveBeenCalled();
        expect(scheduled).toHaveLength(1);
        expect(useActivitySeries).toHaveBeenCalledWith({ machineId: 101, range: '7d' });

        act(() => scheduled[0]?.({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline));
        expect(prefetchQuery).toHaveBeenCalledTimes(1);
        expect(prefetchQuery.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ queryKey: ['data', 'activity-series', 101, '30d', null, null] }));

        rerender(
            renderFrame(2),
        );

        act(() => resolveOldPrefetch?.());

        expect(cancelIdleCallback).toHaveBeenCalledWith(1);
        expect(prefetchQuery).toHaveBeenCalledTimes(1);
        expect(setQueryData).not.toHaveBeenCalled();
        expect(screen.getByTestId('entry')).toHaveTextContent('dashboard:view:2:deterministic-fixture');
    });

});
