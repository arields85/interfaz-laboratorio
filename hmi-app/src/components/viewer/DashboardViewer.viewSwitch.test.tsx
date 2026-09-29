import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardViewer from './DashboardViewer';
import { makeLayout, makeWidget } from '../../test/fixtures/dashboard.fixture';

// The entrance key remounts the whole widget subtree on a dashboard/view switch (user decision:
// the entrance replays). This suite proves that remount costs no network: widgets that mount with
// data already cached (same query key, inside the 30 s staleTime) are served from the TanStack
// cache. It drives the real DashboardViewer frame key, the real `useDataHistory` /
// `useActivitySeries` hooks and a real QueryClient; only the HTTP services are mocked.

const { fetchDataHistoryMock, fetchActivitySeriesMock } = vi.hoisted(() => ({
    fetchDataHistoryMock: vi.fn(),
    fetchActivitySeriesMock: vi.fn(),
}));

vi.mock('../../config/dataConnection.config', () => ({
    isDataHistoryEnabled: () => true,
    isDataActivitySeriesEnabled: () => true,
}));

vi.mock('../../services/dataHistory.service', () => ({ fetchDataHistory: fetchDataHistoryMock }));
vi.mock('../../services/activitySeries.service', () => ({ fetchActivitySeries: fetchActivitySeriesMock }));

// Boundary shaping only: the adapters validate the wire format, which this suite does not exercise.
vi.mock('../../adapters/dataHistory.adapter', () => ({ adaptDataHistory: (raw: unknown) => raw }));
vi.mock('../../adapters/activitySeries.adapter', () => ({
    adaptActivitySeries: (raw: unknown) => raw,
    ActivitySeriesAdapterError: class ActivitySeriesAdapterError extends Error {},
}));

// Each stubbed widget reads history and activity like the chart widgets do (mount-time queries).
vi.mock('./WidgetPresentationBoundary', async () => {
    const { useDataHistory } = await import('../../queries/useDataHistory');
    const { useActivitySeries } = await import('../../queries/useActivitySeries');

    function WidgetStub(props: { widget: { id: string; title?: string } }) {
        // The widget title carries the machine, so tests can make two widgets ask for different data.
        const machineId = Number(props.widget.title ?? 1);
        useDataHistory({ machineId, variableKey: 'temperature', range: '24h', maxPoints: 200 });
        useActivitySeries({ machineId, range: '24h' });
        return <div data-testid={`widget-renderer-${props.widget.id}`} />;
    }

    return { default: WidgetStub };
});

type ResizeCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;
const resizeCallbacks = new Map<Element, Set<ResizeCallback>>();

class MockResizeObserver implements ResizeObserver {
    public constructor(private readonly callback: ResizeCallback) {}

    public observe(target: Element): void {
        const callbacks = resizeCallbacks.get(target) ?? new Set<ResizeCallback>();
        callbacks.add(this.callback);
        resizeCallbacks.set(target, callbacks);
    }

    public unobserve(): void {}

    public disconnect(): void {}
}

function measure(container: HTMLElement) {
    const root = container.querySelector('[data-testid="dashboard-viewer-root"]');
    if (!root) {
        throw new Error('Dashboard viewer root was not rendered.');
    }
    const entry = { target: root, contentRect: { width: 1200, height: 675 } } as ResizeObserverEntry;
    act(() => {
        for (const callback of resizeCallbacks.get(root) ?? []) {
            callback([entry], {} as ResizeObserver);
        }
    });
}

async function flushQueries() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

function viewer(widgetId: string, machine: string, entranceKey: string) {
    return (
        <DashboardViewer
            widgets={[makeWidget({ id: widgetId, title: machine })]}
            layout={[makeLayout({ widgetId, x: 0, y: 0 })]}
            equipmentMap={new Map()}
            cols={24}
            rows={12}
            entranceKey={entranceKey}
        />
    );
}

describe('DashboardViewer view switch (frame remount) and the query cache', () => {
    let queryClient: QueryClient;

    const renderWithClient = (ui: React.ReactElement) => (
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    );

    beforeEach(() => {
        resizeCallbacks.clear();
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        fetchDataHistoryMock.mockResolvedValue({ points: [] });
        fetchActivitySeriesMock.mockResolvedValue({ buckets: [] });
        queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
        queryClient.clear();
    });

    it('issues no extra history or activity request when a view switch remounts widgets over cached data', async () => {
        const { container, rerender } = render(renderWithClient(viewer('a1', '1', 'dash:view-a')));
        measure(container);
        await flushQueries();
        expect(fetchDataHistoryMock).toHaveBeenCalledTimes(1);
        expect(fetchActivitySeriesMock).toHaveBeenCalledTimes(1);
        const before = screen.getByTestId('widget-renderer-a1');

        // Another view: new key, another widget id, same machine/variable/range.
        rerender(renderWithClient(viewer('b1', '1', 'dash:view-b')));
        await flushQueries();

        expect(screen.queryByTestId('widget-renderer-a1')).not.toBeInTheDocument();
        expect(screen.getByTestId('widget-renderer-b1')).toBeInTheDocument();
        expect(before).not.toBeInTheDocument();
        expect(fetchDataHistoryMock).toHaveBeenCalledTimes(1);
        expect(fetchActivitySeriesMock).toHaveBeenCalledTimes(1);

        // And back again.
        rerender(renderWithClient(viewer('a1', '1', 'dash:view-a')));
        await flushQueries();
        expect(fetchDataHistoryMock).toHaveBeenCalledTimes(1);
        expect(fetchActivitySeriesMock).toHaveBeenCalledTimes(1);
    });

    it('does not refetch when the SAME widget id remounts under a new key (state is lost, data is not)', async () => {
        const { container, rerender } = render(renderWithClient(viewer('a1', '1', 'dash:view-a')));
        measure(container);
        await flushQueries();
        const before = screen.getByTestId('widget-renderer-a1');

        rerender(renderWithClient(viewer('a1', '1', 'dash:view-b')));
        await flushQueries();

        expect(screen.getByTestId('widget-renderer-a1')).not.toBe(before);
        expect(fetchDataHistoryMock).toHaveBeenCalledTimes(1);
        expect(fetchActivitySeriesMock).toHaveBeenCalledTimes(1);
    });

    it('still fetches for data that is not cached yet (the counters are live)', async () => {
        const { container, rerender } = render(renderWithClient(viewer('a1', '1', 'dash:view-a')));
        measure(container);
        await flushQueries();

        rerender(renderWithClient(viewer('b1', '2', 'dash:view-b')));
        await flushQueries();

        expect(fetchDataHistoryMock).toHaveBeenCalledTimes(2);
        expect(fetchActivitySeriesMock).toHaveBeenCalledTimes(2);
    });
});
