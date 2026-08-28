import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makeWidget } from '../../test/fixtures/dashboard.fixture';
import { useDataHistory } from '../../queries/useDataHistory';
import { useActivitySeries } from '../../queries/useActivitySeries';
import { DashboardPresentationFrameProvider } from '../../services/dashboardPresentationFrame.service';
import {
    ActivityAnalyticsPresentationController,
    AlertHistoryPresentationController,
    ConnectionPresentationController,
    MachineActivityPresentationController,
    ProductionHistoryPresentationController,
    ScalarPresentationController,
    TrendChartV2Controller,
    generateProductionHistorySeries,
} from './PresentationControllers';

const controllerSeams = vi.hoisted(() => ({
    activityResult: { activityIndex: 64, productiveState: 'producing' as const, stateLabel: 'Producing', stateVisuals: { primary: 'var(--color-status-normal)', gradientColors: ['var(--color-status-normal)', 'var(--color-status-normal)'] as [string, string], glowColor: 'var(--color-status-normal)', animationDuration: 500 }, smoothedPower: 0.64, rawPower: 0.64, isValid: true },
    resolveBinding: vi.fn((widget: { binding?: { simulatedValue?: number | string } }) => ({ value: widget.binding?.simulatedValue ?? 0.64, unit: 'kW', status: 'normal' as const, source: 'real' as const })),
    useMachineActivity: vi.fn(),
    subscribeAlertHistory: vi.fn(),
}));
controllerSeams.useMachineActivity.mockReturnValue(controllerSeams.activityResult);
controllerSeams.subscribeAlertHistory.mockImplementation((subscription: { onState: (state: { entries: never[]; activeSeverity: 'normal' | 'warning' | 'critical' }) => void }) => { subscription.onState({ entries: [], activeSeverity: 'normal' }); return vi.fn(); });

vi.mock('../resolvers/bindingResolver', () => ({
    resolveBinding: controllerSeams.resolveBinding,
}));
vi.mock('../../hooks/useMachineActivity', () => ({
    useMachineActivity: controllerSeams.useMachineActivity,
}));
vi.mock('../renderers/alertHistoryCoordinator', () => ({
    subscribeAlertHistory: controllerSeams.subscribeAlertHistory,
    clearAlertHistoryEntries: vi.fn(),
}));

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

    it('does not leak global freshness into a missing machine connection payload', () => {
        const widget = makeWidget({ id: 'missing-machine-connection', type: 'connection-status', displayOptions: { scope: 'machine', machineId: 999 } });
        render(<ConnectionPresentationController widget={widget} machines={[]} connection={{ globalStatus: 'online', lastSuccess: '2026-04-21T13:00:00.000Z', ageMs: 65_000 }} render={(entry) => <output data-testid="missing-machine-entry">{JSON.stringify(entry.payload)}</output>} />);
        expect(screen.getByTestId('missing-machine-entry')).toHaveTextContent('"lastSuccess":null');
        expect(screen.getByTestId('missing-machine-entry')).toHaveTextContent('"ageMs":null');
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

    it('keeps ProductionHistory generator and session anchor in the controller', () => {
        const widget = makeWidget({ id: 'production-history', type: 'prod-history' });
        render(<DashboardPresentationFrameProvider dashboardId="dashboard" viewId="view" profileRevision={1} expectedWidgetIds={[widget.id]}><ProductionHistoryPresentationController widget={widget} equipmentMap={new Map()} render={(entry) => <output data-testid="production-entry">{JSON.stringify(entry.payload.data)}</output>} /></DashboardPresentationFrameProvider>);
        const payload = JSON.parse(screen.getByTestId('production-entry').textContent ?? '{}') as { data: Array<{ timestamp: string }>; provenance: string; sessionAnchor: number };
        expect(payload.data).toHaveLength(24);
        expect(payload.data[0]?.timestamp).not.toBe(payload.data.at(-1)?.timestamp);
        expect(payload.provenance).toBe('deterministic-fixture');
        expect(payload.sessionAnchor).toBeTypeOf('number');
        expect(generateProductionHistorySeries('day', new Date(payload.sessionAnchor))).toHaveLength(14);
    });

    it('keeps MachineActivity binding resolution and processing in one controller owner', () => {
        const widget = makeWidget({ id: 'machine-activity', type: 'machine-activity', binding: { mode: 'simulated_value', simulatedValue: 0.64, unit: 'kW' } });
        const frame = (revision: number) => <DashboardPresentationFrameProvider dashboardId="dashboard" viewId="view" profileRevision={revision} expectedWidgetIds={[widget.id]}><MachineActivityPresentationController widget={widget} equipmentMap={new Map()} render={(entry) => <output data-testid="machine-entry">{JSON.stringify(entry.payload.data)}</output>} /></DashboardPresentationFrameProvider>;
        const { rerender } = render(frame(1));
        expect(controllerSeams.resolveBinding).toHaveBeenCalledWith(widget, expect.any(Map), undefined);
        expect(controllerSeams.useMachineActivity).toHaveBeenCalledWith(0.64, expect.any(Object), expect.objectContaining({ simulated: true }));
        expect(screen.getByTestId('machine-entry')).toHaveTextContent('64');
        rerender(frame(2));
        expect(controllerSeams.useMachineActivity.mock.calls.at(-1)?.[2]).toEqual(expect.objectContaining({ sourceKey: 'dashboard:view:2:simulated' }));
    });

    it('uses a deterministic machine fixture only after configured and central values are unavailable', () => {
        controllerSeams.resolveBinding.mockReturnValue({ value: null, unit: 'kW', status: 'no-data', source: 'real' });
        const widget = makeWidget({ id: 'machine-activity-fixture', type: 'machine-activity', binding: { mode: 'real_variable', machineId: 101, variableKey: 'activePower' } });
        render(<DashboardPresentationFrameProvider dashboardId="dashboard" viewId="view" profileRevision={1} expectedWidgetIds={[widget.id]}><MachineActivityPresentationController widget={widget} equipmentMap={new Map()} render={(entry) => <output data-testid="machine-fixture-entry">{JSON.stringify(entry.payload.data)}</output>} /></DashboardPresentationFrameProvider>);
        const payload = JSON.parse(screen.getByTestId('machine-fixture-entry').textContent ?? '{}') as { provenance: string };
        expect(payload.provenance).toBe('deterministic-fixture');
        expect(controllerSeams.useMachineActivity.mock.calls.at(-1)?.[0]).toBeGreaterThan(0);
    });

    it('rejects late AlertHistory coordinator callbacks after revision replacement and unmount', () => {
        const callbacks: Array<(state: { entries: never[]; activeSeverity: 'normal' | 'warning' | 'critical' }) => void> = [];
        controllerSeams.subscribeAlertHistory.mockImplementation((subscription: { onState: (state: { entries: never[]; activeSeverity: 'normal' | 'warning' | 'critical' }) => void }) => { callbacks.push(subscription.onState); return vi.fn(); });
        const widget = makeWidget({ id: 'alert-history', type: 'alert-history' });
        const frame = (revision: number) => <DashboardPresentationFrameProvider dashboardId="dashboard" viewId="view" profileRevision={revision} expectedWidgetIds={[widget.id]}><AlertHistoryPresentationController widget={widget} equipmentMap={new Map()} render={(entry) => <output data-testid="alert-entry">{String((entry.payload.data as { activeSeverity: string }).activeSeverity)}</output>} /></DashboardPresentationFrameProvider>;
        const { rerender, unmount } = render(frame(1));

        act(() => callbacks[0]?.({ entries: [], activeSeverity: 'warning' }));
        expect(screen.getByTestId('alert-entry')).toHaveTextContent('warning');

        rerender(frame(2));
        act(() => callbacks[1]?.({ entries: [], activeSeverity: 'critical' }));
        act(() => callbacks[0]?.({ entries: [], activeSeverity: 'warning' }));
        expect(screen.getByTestId('alert-entry')).toHaveTextContent('critical');

        unmount();
        act(() => callbacks[1]?.({ entries: [], activeSeverity: 'warning' }));
    });

});
