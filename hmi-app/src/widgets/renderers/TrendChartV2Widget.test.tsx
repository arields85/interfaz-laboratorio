import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClientContext } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrendChartV2WidgetConfig } from '../../domain/admin.types';
import type { DataHistoryResponseV2 } from '../../domain/dataContract.types';
import { WIDGET_CHART_CONTAINER_CLASS, WIDGET_CHART_HEADER_CLASS } from '../../components/ui/WidgetChartLayout.shared';
import { isDataHistoryEnabled } from '../../config/dataConnection.config';
import { useTemporalSettings } from '../../hooks/useTemporalSettings';
import { useDataHistory } from '../../queries/useDataHistory';
import * as dataHistoryService from '../../services/dataHistory.service';
import { DataHistoryServiceError } from '../../services/dataHistory.service';
import { isDataHistoryResponseV2 } from '../../utils/dataHistoryResponseV2';
import * as dataHistoryResponseV2 from '../../utils/dataHistoryResponseV2';
import * as chartHelpers from '../../utils/chartHelpers';
import { getChartLetterSpacingPx, getChartTextFont, measureChartTextWidthPx } from '../../utils/chartHelpers';
import {
    clearTrendChartV2PerformanceDiagnosticsSnapshot,
    getTrendChartV2PerformanceDiagnosticsSnapshot,
    subscribeTrendChartV2PerformanceDiagnostics,
} from '../../utils/trendChartV2PerformanceDiagnostics';
import TrendChartV2Widget from './TrendChartV2Widget';

const RESIZE_SETTLE_DELAY_MS = 120;

let rafIdSequence = 0;
let pendingAnimationFrameCallbacks = new Map<number, FrameRequestCallback>();
let cancelAnimationFrameSpy: ReturnType<typeof vi.fn>;
let nextObservedMeasurements: Array<{ width: number; height: number }> = [];
const prefetchQuery = vi.fn<(...args: unknown[]) => Promise<void>>();
const getQueryState = vi.fn();
const cancelQueries = vi.fn();
const isFetching = vi.fn();

class MockIntersectionObserver implements IntersectionObserver {
    private static instances: MockIntersectionObserver[] = [];

    private observedTarget: Element | null = null;

    public readonly root = null;

    public readonly rootMargin = '0px';

    public readonly thresholds = [0];

    public constructor(private readonly callback: IntersectionObserverCallback) {
        MockIntersectionObserver.instances.push(this);
    }

    public observe(target: Element): void {
        this.observedTarget = target;
    }

    public unobserve(): void {}

    public disconnect(): void {}

    public takeRecords(): IntersectionObserverEntry[] {
        return [];
    }

    public emit(isIntersecting: boolean, target: Element | null = this.observedTarget): void {
        if (!target) {
            return;
        }

        this.callback([
            {
                target,
                isIntersecting,
                intersectionRatio: isIntersecting ? 1 : 0,
                boundingClientRect: target.getBoundingClientRect(),
                intersectionRect: isIntersecting ? target.getBoundingClientRect() : new DOMRectReadOnly(),
                rootBounds: null,
                time: 0,
            } as IntersectionObserverEntry,
        ], this);
    }

    public static latest(): MockIntersectionObserver {
        const instance = MockIntersectionObserver.instances.at(-1);

        if (!instance) {
            throw new Error('No IntersectionObserver instance was created');
        }

        return instance;
    }

    public static reset(): void {
        MockIntersectionObserver.instances = [];
    }
}

function renderWithQueryClient(element: Parameters<typeof render>[0]) {
    return render(
        <QueryClientContext.Provider
            value={{
                prefetchQuery,
                getQueryState,
                cancelQueries,
                isFetching,
            } as never}
        >
            {element}
        </QueryClientContext.Provider>,
    );
}

function setDocumentVisibilityState(state: DocumentVisibilityState) {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: state,
    });
    Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: state === 'hidden',
    });
}

function installImmediateIdleCallback() {
    vi.stubGlobal('requestIdleCallback', ((callback: IdleRequestCallback) => {
        callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
        return 1;
    }) as typeof requestIdleCallback);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
}

function collectPerformanceDiagnostics() {
    const events: Array<{ widgetId: string; event: string; reason?: string; durationMs?: number }> = [];
    const unsubscribe = subscribeTrendChartV2PerformanceDiagnostics((event) => {
        events.push(event);
    });

    return { events, unsubscribe };
}

function createUseDataHistoryResult(overrides?: Partial<ReturnType<typeof useDataHistory>>): ReturnType<typeof useDataHistory> {
    return {
        data: makeHistoryResponse(),
        isLoading: false,
        isError: false,
        error: null,
        isEnabled: true,
        isFetching: false,
        isPlaceholderData: false,
        isRefreshing: false,
        ...overrides,
    } as ReturnType<typeof useDataHistory>;
}

function flushAnimationFrame(callbackTime = 16) {
    const callbacks = [...pendingAnimationFrameCallbacks.entries()];
    pendingAnimationFrameCallbacks = new Map();

    for (const [, callback] of callbacks) {
        callback(callbackTime);
    }
}

vi.mock('../../config/dataConnection.config', () => ({
    isDataHistoryEnabled: vi.fn(),
}));

vi.mock('../../queries/useDataHistory', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../queries/useDataHistory')>();

    return {
        ...actual,
        useDataHistory: vi.fn(),
    };
});

vi.mock('../../hooks/useTemporalSettings', () => ({
    useTemporalSettings: vi.fn(),
}));

class MockResizeObserver implements ResizeObserver {
    private static instances: MockResizeObserver[] = [];

    private observedTarget: Element | null = null;

    public constructor(private readonly callback: ResizeObserverCallback) {
        MockResizeObserver.instances.push(this);
    }

    public observe(target: Element): void {
        this.observedTarget = target;
        const nextMeasurement = nextObservedMeasurements.shift() ?? { width: 320, height: 180 };
        this.emit(nextMeasurement.width, nextMeasurement.height, target);
    }

    public unobserve(): void {}

    public disconnect(): void {}

    public emit(width: number, height: number, target: Element | null = this.observedTarget): void {
        if (!target) {
            return;
        }

        this.callback([
            {
                target,
                contentRect: {
                    width,
                    height,
                    top: 0,
                    left: 0,
                    bottom: height,
                    right: width,
                    x: 0,
                    y: 0,
                    toJSON: () => ({}),
                },
            } as ResizeObserverEntry,
        ], this);
    }

    public static latest(): MockResizeObserver {
        const instance = MockResizeObserver.instances.at(-1);

        if (!instance) {
            throw new Error('No ResizeObserver instance was created');
        }

        return instance;
    }

    public static reset(): void {
        MockResizeObserver.instances = [];
    }
}

function makeWidget(displayOptions: TrendChartV2WidgetConfig['displayOptions'] = { historicalDensity: 'high' }): TrendChartV2WidgetConfig {
    return {
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
            unit: '°C',
        },
        displayOptions,
    };
}

function makeHistoryResponse(overrides?: Partial<DataHistoryResponseV2>): DataHistoryResponseV2 {
    return {
        contractVersion: '1.1.0',
        machineId: 101,
        variableKey: 'temperature',
        range: '24h',
        unit: '°C',
        window: {
            start: '2026-06-18T12:00:00.000Z',
            end: '2026-06-18T14:00:00.000Z',
            timezone: 'America/Argentina/Buenos_Aires',
            bucketMs: 60_000,
        },
        series: [
            { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 45 },
            { timestamp: '2026-06-18T12:30:00.000Z', timestampMs: Date.parse('2026-06-18T12:30:00.000Z'), value: 47 },
            { timestamp: '2026-06-18T13:30:00.000Z', timestampMs: Date.parse('2026-06-18T13:30:00.000Z'), value: 52 },
            { timestamp: '2026-06-18T13:31:00.000Z', timestampMs: Date.parse('2026-06-18T13:31:00.000Z'), value: 53 },
        ],
        summary: {
            last: 53,
            min: 45,
            max: 53,
            avg: 49.25,
        },
        ...overrides,
    };
}

function makeLegacyHistoryResponse() {
    return {
        contractVersion: '1.0.0',
        machineId: 101,
        variableKey: 'temperature',
        range: 'hora' as const,
        unit: '°C',
        series: [
            { timestamp: '2026-06-18T12:00:00.000Z', value: 45 },
            { timestamp: '2026-06-18T12:30:00.000Z', value: 47 },
            { timestamp: '2026-06-18T13:30:00.000Z', value: 52 },
        ],
        summary: {
            last: 52,
            min: 45,
            max: 52,
            avg: 48,
        },
    };
}

function makeDenseHistoryResponse(pointCount: number, overrides?: Partial<DataHistoryResponseV2>): DataHistoryResponseV2 {
    const startMs = Date.parse('2026-06-18T00:00:00.000Z');
    const bucketMs = 60_000;

    return makeHistoryResponse({
        window: {
            start: new Date(startMs).toISOString(),
            end: new Date(startMs + ((pointCount - 1) * bucketMs)).toISOString(),
            timezone: 'UTC',
            bucketMs,
        },
        series: Array.from({ length: pointCount }, (_, index) => {
            const timestampMs = startMs + (index * bucketMs);
            return {
                timestamp: new Date(timestampMs).toISOString(),
                timestampMs,
                value: 40 + Math.sin(index / 11),
            };
        }),
        ...overrides,
    });
}

function makeSiblingWidgets(count: number): TrendChartV2WidgetConfig[] {
    return Array.from({ length: count }, (_, index) => makeWidget({
        id: `trend-v2-${index + 1}`,
        title: `Trend Chart V2 ${index + 1}`,
    }));
}

describe('TrendChartV2Widget', () => {
    beforeEach(() => {
        pendingAnimationFrameCallbacks = new Map();
        rafIdSequence = 0;
        nextObservedMeasurements = [];
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
            rafIdSequence += 1;
            pendingAnimationFrameCallbacks.set(rafIdSequence, callback);
            return rafIdSequence;
        }) as typeof requestAnimationFrame);
        cancelAnimationFrameSpy = vi.fn((id: number) => {
            pendingAnimationFrameCallbacks.delete(id);
        });
        vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameSpy as typeof cancelAnimationFrame);
        setDocumentVisibilityState('visible');
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        clearTrendChartV2PerformanceDiagnosticsSnapshot();
        prefetchQuery.mockReset();
        getQueryState.mockReset();
        cancelQueries.mockReset();
        isFetching.mockReset();
        prefetchQuery.mockResolvedValue(undefined);
        getQueryState.mockReturnValue(undefined);
        cancelQueries.mockResolvedValue(undefined);
        isFetching.mockReturnValue(0);
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: 'UTC', shifts: [] },
            shifts: [],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useDataHistory).mockImplementation((params) => createUseDataHistoryResult({
            data: params?.range === 'custom'
                ? makeHistoryResponse({
                    range: 'custom',
                    window: undefined,
                })
                : makeHistoryResponse(),
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
        MockResizeObserver.reset();
        MockIntersectionObserver.reset();
    });

    it('preserves the last confirmed chart under a non-blocking refresh overlay', () => {
        const diagnostics = collectPerformanceDiagnostics();
        vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

        vi.mocked(useDataHistory).mockReturnValue(createUseDataHistoryResult({
            isFetching: true,
            isPlaceholderData: true,
            isRefreshing: true,
        }));

        try {
            render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

            const refreshingNotice = screen.getByTestId('trend-chart-v2-historical-notice');
            const chartShell = screen.getByTestId('trend-chart-v2-chart-shell');
            expect(refreshingNotice).toHaveTextContent('Actualizando_');
            expect(refreshingNotice).toHaveAttribute('role', 'status');
            expect(refreshingNotice).toHaveClass('absolute', 'inset-0', 'pointer-events-none');
            expect(chartShell).toHaveClass('relative');
            expect(refreshingNotice.parentElement).toBe(chartShell);
            expect(screen.getByTestId('trend-chart-v2-svg')).toBeInTheDocument();
            expect(screen.getByTestId('trend-chart-v2-interaction-overlay')).toBeInTheDocument();
            expect(diagnostics.events.some((event) => event.event === 'transition_measured')).toBe(false);
        } finally {
            diagnostics.unsubscribe();
        }
    });

    it('rejects an incompatible placeholder before coercion and preserves owner-scoped confirmed labels until the final response', () => {
        const historyState = { current: createUseDataHistoryResult({ data: makeHistoryResponse() }) };
        vi.mocked(useDataHistory).mockImplementation(() => historyState.current);
        const coerceSpy = vi.spyOn(dataHistoryResponseV2, 'coerceDataHistoryResponseForTrendChartV2');
        const { rerender } = render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getByText('12:00')).toBeInTheDocument();
        expect(screen.getByText('14:00')).toBeInTheDocument();
        coerceSpy.mockClear();

        historyState.current = createUseDataHistoryResult({
            data: makeHistoryResponse(),
            isFetching: true,
            isPlaceholderData: true,
            isRefreshing: true,
        });
        fireEvent.click(screen.getByRole('button', { name: '7d' }));

        expect(screen.getByTestId('trend-chart-v2-historical-notice')).toHaveTextContent('Actualizando_');
        expect(screen.getByText('12:00')).toBeInTheDocument();
        expect(screen.getByText('14:00')).toBeInTheDocument();
        expect(coerceSpy).not.toHaveBeenCalled();

        historyState.current = createUseDataHistoryResult({
            data: makeHistoryResponse({
                range: '7d',
                window: {
                    start: '2026-06-14T00:00:00.000Z',
                    end: '2026-06-20T00:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 24 * 60 * 60 * 1000,
                },
                series: [
                    { timestamp: '2026-06-14T00:00:00.000Z', timestampMs: Date.parse('2026-06-14T00:00:00.000Z'), value: 41 },
                    { timestamp: '2026-06-20T00:00:00.000Z', timestampMs: Date.parse('2026-06-20T00:00:00.000Z'), value: 49 },
                ],
            }),
        });
        rerender(<TrendChartV2Widget widget={{ ...makeWidget(), title: 'Trend Chart V2 final' }} equipmentMap={new Map()} machines={[]} />);

        expect(screen.queryByTestId('trend-chart-v2-historical-notice')).not.toBeInTheDocument();
        expect(screen.getByText('14/06')).toBeInTheDocument();
        expect(screen.getByText('20/06')).toBeInTheDocument();
        expect(coerceSpy).toHaveBeenCalledTimes(1);
    });

    it('does not leak a confirmed snapshot across variable owners', () => {
        const historyState = { current: createUseDataHistoryResult({ data: makeHistoryResponse() }) };
        vi.mocked(useDataHistory).mockImplementation(() => historyState.current);
        const { rerender } = render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        historyState.current = createUseDataHistoryResult({
            data: makeHistoryResponse(),
            isFetching: true,
            isPlaceholderData: true,
            isRefreshing: true,
        });
        rerender(<TrendChartV2Widget
            widget={{
                ...makeWidget(),
                binding: { ...makeWidget().binding, variableKey: 'pressure' },
            }}
            equipmentMap={new Map()}
            machines={[]}
        />);

        expect(screen.queryByTestId('trend-chart-v2-svg')).not.toBeInTheDocument();
        expect(screen.getByTestId('trend-chart-v2-state')).toBeInTheDocument();
    });

    it('coerces each response identity once and keeps static paths and formatters stable across 100 hovers', () => {
        const response = makeDenseHistoryResponse(150);
        vi.mocked(useDataHistory).mockReturnValue(createUseDataHistoryResult({ data: response }));
        const coerceSpy = vi.spyOn(dataHistoryResponseV2, 'coerceDataHistoryResponseForTrendChartV2');
        const smoothPathSpy = vi.spyOn(chartHelpers, 'smoothPath');
        const areaPathSpy = vi.spyOn(chartHelpers, 'buildAreaPath');
        const NativeDateTimeFormat = Intl.DateTimeFormat;
        function DateTimeFormatMock(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
            return new NativeDateTimeFormat(locales, options);
        }
        const formatterSpy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(DateTimeFormatMock);

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);
        const overlay = screen.getByTestId('trend-chart-v2-interaction-overlay');
        const overlayX = Number(overlay.getAttribute('x'));
        const overlayWidth = Number(overlay.getAttribute('width'));
        Object.defineProperty(overlay, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
                x: overlayX,
                y: 0,
                width: overlayWidth,
                height: 180,
                top: 0,
                left: overlayX,
                right: overlayX + overlayWidth,
                bottom: 180,
                toJSON: () => ({}),
            }),
        });
        smoothPathSpy.mockClear();
        areaPathSpy.mockClear();
        formatterSpy.mockClear();

        for (let index = 0; index < 100; index += 1) {
            fireEvent.mouseMove(overlay, {
                clientX: overlayX + ((overlayWidth * index) / 99),
                clientY: 60,
            });
        }
        MockResizeObserver.latest().emit(320, 180);

        expect(coerceSpy).toHaveBeenCalledTimes(1);
        expect(smoothPathSpy).not.toHaveBeenCalled();
        expect(areaPathSpy).not.toHaveBeenCalled();
        expect(formatterSpy).not.toHaveBeenCalled();
    });

    it('keeps the last confirmed chart visible under a stale overlay and records diagnostics', () => {
        const diagnostics = collectPerformanceDiagnostics();
        const { rerender } = render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        vi.mocked(useDataHistory).mockReturnValue(createUseDataHistoryResult({
            isError: true,
            error: new DataHistoryServiceError('Data history request could not be completed', 'http', 422),
        }));

        try {
            rerender(<TrendChartV2Widget widget={makeWidget({ historicalDensity: 'high' })} equipmentMap={new Map()} machines={[]} />);

            const staleNotice = screen.getByTestId('trend-chart-v2-historical-notice');
            expect(staleNotice).toHaveTextContent('Desactualizado');
            expect(staleNotice).toHaveAttribute('role', 'status');
            expect(staleNotice.querySelector('.widget-runtime-state-caret')).toBeNull();
            expect(staleNotice.parentElement).toBe(screen.getByTestId('trend-chart-v2-chart-shell'));
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(screen.queryByText('No se pudo actualizar')).not.toBeInTheDocument();
            expect(screen.queryByText('Se mantiene la última vista confirmada')).not.toBeInTheDocument();
            expect(screen.getByTestId('trend-chart-v2-svg')).toBeInTheDocument();
            expect(diagnostics.events).toContainEqual(expect.objectContaining({
                widgetId: 'trend-v2-1',
                event: 'refresh_failed',
            }));
        } finally {
            diagnostics.unsubscribe();
        }
    });

    it('prefetches exactly one adjacent preset range through the read-only query path when the viewer widget is visible and safe', async () => {
        installImmediateIdleCallback();
        vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
        const fetchDataHistorySpy = vi.spyOn(dataHistoryService, 'fetchDataHistory').mockResolvedValue(makeHistoryResponse());
        const siblingWidgets = makeSiblingWidgets(2);

        renderWithQueryClient(
            <TrendChartV2Widget widget={siblingWidgets[0]} siblingWidgets={siblingWidgets} equipmentMap={new Map()} machines={[]} />,
        );

        act(() => {
            MockIntersectionObserver.latest().emit(true);
        });

        expect(prefetchQuery).toHaveBeenCalledTimes(1);
        expect(prefetchQuery.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
            queryKey: ['data', 'history', 101, 'temperature', '7d', null, null, 800],
        }));

        const scheduledPrefetch = prefetchQuery.mock.calls[0]?.[0] as { queryFn?: (context?: { signal?: AbortSignal }) => Promise<unknown> };
        const signal = new AbortController().signal;

        await expect(scheduledPrefetch.queryFn?.({ signal })).resolves.toEqual(expect.objectContaining({
            machineId: 101,
            variableKey: 'temperature',
        }));
        expect(fetchDataHistorySpy).toHaveBeenCalledWith({
            machineId: 101,
            variableKey: 'temperature',
            range: '7d',
            maxPoints: 800,
        }, signal);
    });

    it('fails closed for custom windows and dashboard pressure, recording denial diagnostics and canceling pending prefetch work', () => {
        const diagnostics = collectPerformanceDiagnostics();
        const cancelIdleCallback = vi.fn();
        vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
        vi.stubGlobal('requestIdleCallback', vi.fn(() => 7) as typeof requestIdleCallback);
        vi.stubGlobal('cancelIdleCallback', cancelIdleCallback as typeof cancelIdleCallback);

        try {
            const scheduled = renderWithQueryClient(
                <TrendChartV2Widget
                    widget={makeWidget()}
                    siblingWidgets={makeSiblingWidgets(2)}
                    equipmentMap={new Map()}
                    machines={[]}
                />,
            );

            act(() => {
                MockIntersectionObserver.latest().emit(true);
            });

            scheduled.unmount();

            expect(cancelIdleCallback).toHaveBeenCalled();
            expect(cancelQueries).toHaveBeenCalled();

            const pressured = renderWithQueryClient(
                <div>
                    <TrendChartV2Widget
                        widget={makeWidget()}
                        siblingWidgets={makeSiblingWidgets(13)}
                        equipmentMap={new Map()}
                        machines={[]}
                    />
                </div>,
            );

            act(() => {
                MockIntersectionObserver.latest().emit(true);
            });

            expect(prefetchQuery).not.toHaveBeenCalled();
            expect(diagnostics.events).toContainEqual(expect.objectContaining({
                widgetId: 'trend-v2-1',
                event: 'prefetch_denied',
                reason: 'dashboard_pressure',
            }));

            const overlay = screen.getByTestId('trend-chart-v2-interaction-overlay');
            const overlayX = Number(overlay.getAttribute('x'));
            const overlayWidth = Number(overlay.getAttribute('width'));
            Object.defineProperty(overlay, 'getBoundingClientRect', {
                configurable: true,
                value: () => ({
                    x: overlayX,
                    y: 0,
                    width: overlayWidth,
                    height: 180,
                    top: 0,
                    left: overlayX,
                    right: overlayX + overlayWidth,
                    bottom: 180,
                    toJSON: () => ({}),
                }),
            });

            fireEvent.mouseDown(overlay, { clientX: 92, clientY: 60 });
            fireEvent.mouseMove(overlay, { clientX: 227, clientY: 60 });
            fireEvent.mouseUp(overlay, { clientX: 227, clientY: 60 });

            expect(diagnostics.events).toContainEqual(expect.objectContaining({
                widgetId: 'trend-v2-1',
                event: 'prefetch_denied',
                reason: 'custom_range',
            }));

            pressured.unmount();
        } finally {
            diagnostics.unsubscribe();
        }
    });

    it('keeps measured and render sizes separate during builder transient resize and commits the final size once the interaction ends', () => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });

        const { rerender } = render(
            <TrendChartV2Widget
                widget={makeWidget()}
                equipmentMap={new Map()}
                machines={[]}
                renderContext={{ surface: 'builder', isTransientResizeActive: false }}
            />,
        );

        const observer = MockResizeObserver.latest();
        const initialRoot = screen.getByText('Trend Chart V2').closest('[data-resize-surface]');

        if (!initialRoot) {
            throw new Error('TrendChartV2 root was not rendered.');
        }

        expect(screen.getByTestId('trend-chart-v2-svg')).toHaveAttribute('width', '320');
        expect(initialRoot).toHaveAttribute('data-measured-width', '320');
        expect(initialRoot).toHaveAttribute('data-render-width', '320');

        rerender(
            <TrendChartV2Widget
                widget={makeWidget()}
                equipmentMap={new Map()}
                machines={[]}
                renderContext={{ surface: 'builder', isTransientResizeActive: true }}
            />,
        );

        act(() => {
            observer.emit(640, 300);
        });

        const transientRoot = screen.getByText('Trend Chart V2').closest('[data-resize-surface]');

        if (!transientRoot) {
            throw new Error('Transient TrendChartV2 root was not rendered.');
        }

        expect(screen.getByTestId('trend-chart-v2-svg')).toHaveAttribute('width', '320');
        expect(transientRoot).toHaveAttribute('data-measured-width', '640');
        expect(transientRoot).toHaveAttribute('data-render-width', '320');

        act(() => {
            rerender(
                <TrendChartV2Widget
                    widget={makeWidget()}
                    equipmentMap={new Map()}
                    machines={[]}
                    renderContext={{ surface: 'builder', isTransientResizeActive: false }}
                />,
            );
            vi.advanceTimersByTime(RESIZE_SETTLE_DELAY_MS);
            flushAnimationFrame();
        });

        const committedRoot = screen.getByText('Trend Chart V2').closest('[data-resize-surface]');

        if (!committedRoot) {
            throw new Error('Committed TrendChartV2 root was not rendered.');
        }

        expect(screen.getByTestId('trend-chart-v2-svg')).toHaveAttribute('width', '640');
        expect(committedRoot).toHaveAttribute('data-render-width', '640');
        expect(getTrendChartV2PerformanceDiagnosticsSnapshot().some((event) => event.event === 'resize_settled_committed')).toBe(true);
    });

    it('suppresses equivalent resize measurements and records a no-op diagnostic instead of recomputing', () => {
        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const observer = MockResizeObserver.latest();

        observer.emit(320, 180);

        expect(getTrendChartV2PerformanceDiagnosticsSnapshot()).toContainEqual(expect.objectContaining({
            widgetId: 'trend-v2-1',
            event: 'resize_noop_suppressed',
        }));
        expect(screen.getByTestId('trend-chart-v2-svg')).toHaveAttribute('width', '320');
    });

    it('preserves the last valid render size and records diagnostics when a transient invalid measurement arrives', () => {
        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const observer = MockResizeObserver.latest();
        const root = screen.getByText('Trend Chart V2').closest('[data-resize-surface]');

        if (!root) {
            throw new Error('TrendChartV2 root was not rendered.');
        }

        observer.emit(Number.NaN, 0);

        expect(screen.getByTestId('trend-chart-v2-svg')).toHaveAttribute('width', '320');
        expect(root).toHaveAttribute('data-render-width', '320');
        expect(getTrendChartV2PerformanceDiagnosticsSnapshot()).toContainEqual(expect.objectContaining({
            widgetId: 'trend-v2-1',
            event: 'invalid_measurement_preserved',
        }));
    });

    it('cancels stale resize work without dropping the fresh post-generation measurement commit', () => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
        nextObservedMeasurements = [
            { width: 320, height: 180 },
            { width: 640, height: 300 },
        ];

        const { rerender } = render(
            <TrendChartV2Widget
                widget={makeWidget()}
                equipmentMap={new Map()}
                machines={[]}
                renderContext={{ surface: 'builder', isTransientResizeActive: false }}
            />,
        );

        const observer = MockResizeObserver.latest();

        act(() => {
            observer.emit(640, 300);
            vi.advanceTimersByTime(RESIZE_SETTLE_DELAY_MS);
        });

        const pendingFrameIds = [...pendingAnimationFrameCallbacks.keys()];

        expect(pendingFrameIds).toHaveLength(1);

        const [pendingFrameId] = pendingFrameIds;

        rerender(
            <TrendChartV2Widget
                widget={{ ...makeWidget(), id: 'trend-v2-2', title: 'Trend Chart V2 B' }}
                equipmentMap={new Map()}
                machines={[]}
                renderContext={{ surface: 'builder', isTransientResizeActive: false }}
            />,
        );

        expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(pendingFrameId);
        expect(pendingAnimationFrameCallbacks.size).toBe(0);

        act(() => {
            vi.runOnlyPendingTimers();
            flushAnimationFrame();
        });

        expect(screen.getByTestId('trend-chart-v2-svg')).toHaveAttribute('width', '640');
        expect(getTrendChartV2PerformanceDiagnosticsSnapshot().some((event) => (
            event.widgetId === 'trend-v2-1' && event.event === 'resize_settled_committed'
        ))).toBe(false);
    });

    it('preserves gap segmentation, visible-window bounds, density maxPoints, and final interaction geometry across resize commit', () => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });

        const { rerender } = render(
            <TrendChartV2Widget
                widget={makeWidget({ historicalDensity: 'high' })}
                equipmentMap={new Map()}
                machines={[]}
                renderContext={{ surface: 'builder', isTransientResizeActive: false }}
            />,
        );

        const observer = MockResizeObserver.latest();
        const beforeSegments = screen.getAllByTestId('trend-chart-v2-segment').length;
        const beforeOverlayWidth = Number(screen.getByTestId('trend-chart-v2-interaction-overlay').getAttribute('width'));
        const beforeFinalPoint = screen.getByTestId('trend-chart-v2-final-point-core');
        const beforeFinalPointCx = Number(beforeFinalPoint.getAttribute('cx'));
        const beforeFinalPointCy = Number(beforeFinalPoint.getAttribute('cy'));

        expect(screen.getByText('12:00')).toBeInTheDocument();
        expect(screen.getByText('14:00')).toBeInTheDocument();
        expect(useDataHistory).toHaveBeenLastCalledWith(expect.objectContaining({ maxPoints: 1500 }));

        rerender(
            <TrendChartV2Widget
                widget={makeWidget({ historicalDensity: 'high' })}
                equipmentMap={new Map()}
                machines={[]}
                renderContext={{ surface: 'builder', isTransientResizeActive: true }}
            />,
        );

        act(() => {
            observer.emit(640, 300);
        });

        rerender(
            <TrendChartV2Widget
                widget={makeWidget({ historicalDensity: 'high' })}
                equipmentMap={new Map()}
                machines={[]}
                renderContext={{ surface: 'builder', isTransientResizeActive: false }}
            />,
        );

        act(() => {
            vi.advanceTimersByTime(RESIZE_SETTLE_DELAY_MS);
            flushAnimationFrame();
        });

        const afterFinalPoint = screen.getByTestId('trend-chart-v2-final-point-core');

        expect(screen.getAllByTestId('trend-chart-v2-segment')).toHaveLength(beforeSegments);
        expect(screen.getByText('12:00')).toBeInTheDocument();
        expect(screen.getByText('14:00')).toBeInTheDocument();
        expect(useDataHistory).toHaveBeenLastCalledWith(expect.objectContaining({ maxPoints: 1500 }));
        expect(Number(screen.getByTestId('trend-chart-v2-interaction-overlay').getAttribute('width'))).toBeGreaterThan(beforeOverlayWidth);
        expect(Number(afterFinalPoint.getAttribute('cx'))).toBeGreaterThan(beforeFinalPointCx);
        expect(Number(afterFinalPoint.getAttribute('cy'))).not.toBe(beforeFinalPointCy);
    });

    it('shows the canonical loading legend while chart layout is still not renderable', () => {
        class ZeroFirstResizeObserver extends MockResizeObserver {
            public observe(target: Element): void {
                this.emit(0, 0, target);
            }
        }

        vi.stubGlobal('ResizeObserver', ZeroFirstResizeObserver);

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const state = screen.getByTestId('trend-chart-v2-state');

        expect(state).toHaveTextContent('Cargando_');
        expect(state.querySelector('.widget-runtime-state-caret')).not.toBeNull();
        expect(screen.queryByText('Preparing chart...')).not.toBeInTheDocument();
        expect(screen.queryByText('Drag on the chart to zoom into a custom window.')).not.toBeInTheDocument();
        expect(screen.queryByTestId('trend-chart-v2-svg')).not.toBeInTheDocument();
    });

    it('uses the canonical loading legend and cursor styling while keeping the widget shell stable', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: undefined,
            isLoading: true,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const loader = screen.getByTestId('trend-chart-v2-state');

        expect(loader).toHaveTextContent('Cargando_');
        expect(loader.querySelector('.font-system')).toHaveTextContent('Cargando_');
        expect(loader.querySelector('.font-system')).not.toHaveClass('animate-pulse');
        expect(loader.querySelector('.widget-runtime-state-caret')).toBeInTheDocument();
        expect(screen.queryByText('Loading history...')).not.toBeInTheDocument();
        expect(screen.queryByText('Cargando datos...')).not.toBeInTheDocument();
    });

    it('maps data-history connection failures to the canonical disconnected legend', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: true,
            error: new DataHistoryServiceError('Data history request timed out', 'timeout'),
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const state = screen.getByTestId('trend-chart-v2-state');

        expect(state).toHaveTextContent('Sin conexión');
        expect(state).not.toHaveTextContent('No se pudieron cargar los datos');
    });

    it('replaces raw backend error copy with the canonical data-load failure legend', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: true,
            error: new DataHistoryServiceError('Data history request could not be completed', 'http', 422),
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const state = screen.getByTestId('trend-chart-v2-state');

        expect(state).toHaveTextContent('No se pudieron cargar los datos');
        expect(state).not.toHaveTextContent('--');
        expect(screen.queryByTestId('trend-chart-v2-historical-notice')).not.toBeInTheDocument();
        expect(screen.queryByTestId('trend-chart-v2-svg')).not.toBeInTheDocument();
        expect(screen.queryByText('Error loading history')).not.toBeInTheDocument();
    });

    it('keeps operator/dashboard rendering free from historical density controls', () => {
        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getByText('Trend Chart V2')).toBeInTheDocument();
        expect(screen.queryByText('Densidad histórica')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Alta' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Normal' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Baja' })).not.toBeInTheDocument();
        expect(useDataHistory).toHaveBeenLastCalledWith({
            machineId: 101,
            variableKey: 'temperature',
            range: '24h',
            maxPoints: 1500,
        });
    });

    it('uses backend window labels and splits line segments across nulls and large gaps', () => {
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: 'UTC', shifts: [] },
            shifts: [],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                window: {
                    start: '2026-06-18T12:00:00.000Z',
                    end: '2026-06-18T14:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 60_000,
                },
                series: [
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 41 },
                    { timestamp: '2026-06-18T12:01:00.000Z', timestampMs: Date.parse('2026-06-18T12:01:00.000Z'), value: 42 },
                    { timestamp: '2026-06-18T12:02:00.000Z', timestampMs: Date.parse('2026-06-18T12:02:00.000Z'), value: null },
                    { timestamp: '2026-06-18T13:00:00.000Z', timestampMs: Date.parse('2026-06-18T13:00:00.000Z'), value: 45 },
                    { timestamp: '2026-06-18T13:01:00.000Z', timestampMs: Date.parse('2026-06-18T13:01:00.000Z'), value: 46 },
                    { timestamp: '2026-06-18T13:10:00.000Z', timestampMs: Date.parse('2026-06-18T13:10:00.000Z'), value: 48 },
                    { timestamp: '2026-06-18T13:11:00.000Z', timestampMs: Date.parse('2026-06-18T13:11:00.000Z'), value: 49 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getByText('12:00')).toBeInTheDocument();
        expect(screen.getByText('14:00')).toBeInTheDocument();
        expect(screen.getAllByTestId('trend-chart-v2-segment')).toHaveLength(3);
    });

    it('keeps first and last x-axis labels centered while distributing visible ticks from start to end', () => {
        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const labels = screen.getAllByTestId('trend-chart-v2-x-axis-label');
        const xPositions = labels.map((label) => Number(label.getAttribute('x')));
        const gaps = xPositions.slice(1).map((x, index) => x - xPositions[index]);
        const smallestGap = Math.min(...gaps);
        const largestGap = Math.max(...gaps);
        const lastLabel = labels[labels.length - 1];
        const expectedRightEdge = 320 - Math.ceil((measureChartTextWidthPx('14:00', getChartTextFont(), getChartLetterSpacingPx()) / 2) + 2);

        expect(labels.length).toBeGreaterThanOrEqual(2);
        expect(labels[0]).toHaveTextContent('12:00');
        expect(lastLabel).toHaveTextContent('14:00');
        labels.forEach((label) => {
            expect(label).toHaveAttribute('text-anchor', 'middle');
        });
        expect(largestGap).toBeLessThanOrEqual(smallestGap * 2);
        expect(Number(lastLabel.getAttribute('x'))).toBeCloseTo(expectedRightEdge, 3);
    });

    it('aligns the final point with the last x-axis label when the latest sample reaches the visible window end', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                series: [
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 45 },
                    { timestamp: '2026-06-18T13:00:00.000Z', timestampMs: Date.parse('2026-06-18T13:00:00.000Z'), value: 47 },
                    { timestamp: '2026-06-18T14:00:00.000Z', timestampMs: Date.parse('2026-06-18T14:00:00.000Z'), value: 53 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const labels = screen.getAllByTestId('trend-chart-v2-x-axis-label');
        const lastLabel = labels[labels.length - 1];
        const finalPoint = screen.getByTestId('trend-chart-v2-final-point-core');

        expect(lastLabel).toHaveTextContent('14:00');
        expect(Number(finalPoint.getAttribute('cx'))).toBeCloseTo(Number(lastLabel.getAttribute('x')), 3);
    });

    it('keeps 1h and 7d preset lines renderable when backend bucket metadata is much smaller than the observed cadence', () => {
        vi.mocked(useDataHistory).mockImplementation((params) => ({
            data: params?.range === '7d'
                ? makeHistoryResponse({
                    range: '7d',
                    window: {
                        start: '2026-06-17T00:00:00.000Z',
                        end: '2026-06-20T00:00:00.000Z',
                        timezone: 'UTC',
                        bucketMs: 60_000,
                    },
                    series: [
                        { timestamp: '2026-06-17T00:00:00.000Z', timestampMs: Date.parse('2026-06-17T00:00:00.000Z'), value: 10 },
                        { timestamp: '2026-06-18T00:00:00.000Z', timestampMs: Date.parse('2026-06-18T00:00:00.000Z'), value: 11 },
                        { timestamp: '2026-06-19T00:00:00.000Z', timestampMs: Date.parse('2026-06-19T00:00:00.000Z'), value: 12 },
                        { timestamp: '2026-06-20T00:00:00.000Z', timestampMs: Date.parse('2026-06-20T00:00:00.000Z'), value: 13 },
                    ],
                })
                : makeHistoryResponse({
                    range: '1h',
                    window: {
                        start: '2026-06-18T12:00:00.000Z',
                        end: '2026-06-18T13:00:00.000Z',
                        timezone: 'UTC',
                        bucketMs: 60_000,
                    },
                    series: [
                        { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 10 },
                        { timestamp: '2026-06-18T12:15:00.000Z', timestampMs: Date.parse('2026-06-18T12:15:00.000Z'), value: 10 },
                        { timestamp: '2026-06-18T12:30:00.000Z', timestampMs: Date.parse('2026-06-18T12:30:00.000Z'), value: 10 },
                        { timestamp: '2026-06-18T12:45:00.000Z', timestampMs: Date.parse('2026-06-18T12:45:00.000Z'), value: 10 },
                    ],
                }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        }));

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        fireEvent.click(screen.getByRole('button', { name: '1h' }));
        expect(screen.getAllByTestId('trend-chart-v2-line-segment')).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: '7d' }));
        expect(screen.getAllByTestId('trend-chart-v2-line-segment')).toHaveLength(1);
    });

    it.each([
        {
            rangeLabel: '7d',
            response: makeHistoryResponse({
                range: '7d',
                window: {
                    start: '2026-06-14T00:00:00.000Z',
                    end: '2026-06-20T15:00:00.000Z',
                    timezone: 'UTC',
                },
                series: [
                    { timestamp: '2026-06-14T00:00:00.000Z', timestampMs: Date.parse('2026-06-14T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-15T00:00:00.000Z', timestampMs: Date.parse('2026-06-15T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-16T00:00:00.000Z', timestampMs: Date.parse('2026-06-16T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-17T00:00:00.000Z', timestampMs: Date.parse('2026-06-17T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-18T15:00:00.000Z', timestampMs: Date.parse('2026-06-18T15:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-19T15:00:00.000Z', timestampMs: Date.parse('2026-06-19T15:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-20T15:00:00.000Z', timestampMs: Date.parse('2026-06-20T15:00:00.000Z'), value: 10 },
                ],
            }),
        },
        {
            rangeLabel: '30d',
            response: makeHistoryResponse({
                range: '30d',
                window: {
                    start: '2026-06-09T00:00:00.000Z',
                    end: '2026-06-22T12:00:00.000Z',
                    timezone: 'UTC',
                },
                series: [
                    { timestamp: '2026-06-09T00:00:00.000Z', timestampMs: Date.parse('2026-06-09T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-11T00:00:00.000Z', timestampMs: Date.parse('2026-06-11T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-13T00:00:00.000Z', timestampMs: Date.parse('2026-06-13T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-15T00:00:00.000Z', timestampMs: Date.parse('2026-06-15T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-20T12:00:00.000Z', timestampMs: Date.parse('2026-06-20T12:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-22T12:00:00.000Z', timestampMs: Date.parse('2026-06-22T12:00:00.000Z'), value: 10 },
                ],
            }),
        },
    ])('renders a matching stroke for continuous coarse day-scale $rangeLabel history without introducing a false gap', ({ rangeLabel, response }) => {
        vi.mocked(useDataHistory).mockImplementation((params) => ({
            data: params?.range === rangeLabel ? response : makeHistoryResponse(),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        }));

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        fireEvent.click(screen.getByRole('button', { name: rangeLabel }));

        expect(screen.getAllByTestId('trend-chart-v2-segment')).toHaveLength(1);
        expect(screen.getAllByTestId('trend-chart-v2-line-segment')).toHaveLength(1);
        expect(screen.queryByTestId('trend-chart-v2-single-point')).not.toBeInTheDocument();
        expect(screen.getByTestId('trend-chart-v2-final-point-core')).toBeInTheDocument();
    });

    it.each([
        {
            rangeLabel: '7d',
            response: makeHistoryResponse({
                range: '7d',
                window: {
                    start: '2026-06-12T00:00:00.000Z',
                    end: '2026-06-19T12:00:00.000Z',
                    timezone: 'UTC',
                },
                series: [
                    { timestamp: '2026-06-12T00:00:00.000Z', timestampMs: Date.parse('2026-06-12T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-13T00:00:00.000Z', timestampMs: Date.parse('2026-06-13T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-14T00:00:00.000Z', timestampMs: Date.parse('2026-06-14T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-15T00:00:00.000Z', timestampMs: Date.parse('2026-06-15T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-17T12:00:00.000Z', timestampMs: Date.parse('2026-06-17T12:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-19T12:00:00.000Z', timestampMs: Date.parse('2026-06-19T12:00:00.000Z'), value: 10 },
                ],
            }),
        },
        {
            rangeLabel: '30d',
            response: makeHistoryResponse({
                range: '30d',
                window: {
                    start: '2026-06-01T00:00:00.000Z',
                    end: '2026-06-16T00:00:00.000Z',
                    timezone: 'UTC',
                },
                series: [
                    { timestamp: '2026-06-01T00:00:00.000Z', timestampMs: Date.parse('2026-06-01T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-03T00:00:00.000Z', timestampMs: Date.parse('2026-06-03T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-05T00:00:00.000Z', timestampMs: Date.parse('2026-06-05T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-07T00:00:00.000Z', timestampMs: Date.parse('2026-06-07T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-12T00:00:00.000Z', timestampMs: Date.parse('2026-06-12T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-14T00:00:00.000Z', timestampMs: Date.parse('2026-06-14T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-16T00:00:00.000Z', timestampMs: Date.parse('2026-06-16T00:00:00.000Z'), value: 10 },
                ],
            }),
        },
    ])('renders one continuous SVG path for live-like coarse $rangeLabel history that should not split', ({ rangeLabel, response }) => {
        vi.mocked(useDataHistory).mockImplementation((params) => ({
            data: params?.range === rangeLabel ? response : makeHistoryResponse(),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        }));

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        fireEvent.click(screen.getByRole('button', { name: rangeLabel }));

        expect(screen.getAllByTestId('trend-chart-v2-segment')).toHaveLength(1);
        expect(screen.getAllByTestId('trend-chart-v2-line-segment')).toHaveLength(1);
        expect(screen.queryByTestId('trend-chart-v2-single-point')).not.toBeInTheDocument();
        expect(screen.getByTestId('trend-chart-v2-final-point-core')).toBeInTheDocument();
    });

    it('uses the full 12m plot width when backend metadata adds padded empty time around a continuous finite series', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                range: '12m',
                unit: 'W',
                window: {
                    start: '2026-05-01T00:00:00.000Z',
                    end: '2026-07-15T00:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 30 * 24 * 60 * 60 * 1000,
                },
                series: [
                    { timestamp: '2026-06-01T00:00:00.000Z', timestampMs: Date.parse('2026-06-01T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-15T00:00:00.000Z', timestampMs: Date.parse('2026-06-15T00:00:00.000Z'), value: 11 },
                    { timestamp: '2026-06-30T00:00:00.000Z', timestampMs: Date.parse('2026-06-30T00:00:00.000Z'), value: 12 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        fireEvent.click(screen.getByRole('button', { name: '12m' }));

        const firstLineSegment = screen.getByTestId('trend-chart-v2-line-segment');

        expect(firstLineSegment.getAttribute('d')).toMatch(/^M 38 /);
        expect(firstLineSegment.getAttribute('d')).toMatch(/307 /);
    });

    it('starts the connected 12m line at plot-left when a leading edge singleton is suppressed', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                range: '12m',
                window: {
                    start: '2026-05-01T00:00:00.000Z',
                    end: '2026-07-15T00:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 30 * 24 * 60 * 60 * 1000,
                },
                series: [
                    { timestamp: '2026-06-01T00:00:00.000Z', timestampMs: Date.parse('2026-06-01T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-15T00:00:00.000Z', timestampMs: Date.parse('2026-06-15T00:00:00.000Z'), value: null },
                    { timestamp: '2026-06-30T00:00:00.000Z', timestampMs: Date.parse('2026-06-30T00:00:00.000Z'), value: 12 },
                    { timestamp: '2026-07-10T00:00:00.000Z', timestampMs: Date.parse('2026-07-10T00:00:00.000Z'), value: 13 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        fireEvent.click(screen.getByRole('button', { name: '12m' }));

        const lineSegment = screen.getByTestId('trend-chart-v2-line-segment');

        expect(screen.queryByTestId('trend-chart-v2-single-point')).not.toBeInTheDocument();
        expect(lineSegment.getAttribute('d')).toMatch(/^M 38 /);
        expect(screen.getByTestId('trend-chart-v2-final-point-core')).toBeInTheDocument();
    });

    it('keeps legitimate single-point rendering when the entire visible dataset has only one finite point', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                range: '12m',
                window: {
                    start: '2026-05-01T00:00:00.000Z',
                    end: '2026-07-15T00:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 30 * 24 * 60 * 60 * 1000,
                },
                series: [
                    { timestamp: '2026-06-01T00:00:00.000Z', timestampMs: Date.parse('2026-06-01T00:00:00.000Z'), value: null },
                    { timestamp: '2026-06-15T00:00:00.000Z', timestampMs: Date.parse('2026-06-15T00:00:00.000Z'), value: 12 },
                    { timestamp: '2026-06-30T00:00:00.000Z', timestampMs: Date.parse('2026-06-30T00:00:00.000Z'), value: null },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        fireEvent.click(screen.getByRole('button', { name: '12m' }));

        expect(screen.getByTestId('trend-chart-v2-single-point')).toBeInTheDocument();
        expect(screen.queryByTestId('trend-chart-v2-line-segment')).not.toBeInTheDocument();
        expect(screen.getByTestId('trend-chart-v2-final-point-core')).toBeInTheDocument();
    });

    it('renders the unit as an independent svg label centered over the y-axis tick-label block instead of the widget header subtitle', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                range: '12m',
                unit: 'W',
                window: undefined,
                series: [
                    { timestamp: '2026-06-15T00:00:00.000Z', timestampMs: Date.parse('2026-06-15T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-30T00:00:00.000Z', timestampMs: Date.parse('2026-06-30T00:00:00.000Z'), value: 12 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        fireEvent.click(screen.getByRole('button', { name: '12m' }));

        const unitLabel = screen.getByTestId('trend-chart-v2-unit-label');
        const headerSubtitle = document.querySelector('.row-start-2');
        const yTickLabels = screen.getAllByTestId('trend-chart-v2-y-tick-label');
        const yTickLabelRightEdge = Number(yTickLabels[0].getAttribute('x'));
        const expectedCenterX = yTickLabelRightEdge - (
            Math.max(
                ...yTickLabels.map((label) => measureChartTextWidthPx(
                    label.textContent ?? '',
                    getChartTextFont(),
                    getChartLetterSpacingPx(),
                )),
            ) / 2
        );

        expect(unitLabel).toHaveTextContent('W');
        expect(unitLabel).toHaveAttribute('text-anchor', 'middle');
        expect(Number(unitLabel.getAttribute('x'))).toBeCloseTo(expectedCenterX, 3);
        expect(unitLabel).toHaveAttribute('y', '8');
        expect(unitLabel).toHaveAttribute('font-size', 'var(--font-size-system)');
        expect(unitLabel).toHaveAttribute('font-family', 'var(--font-system)');
        expect(unitLabel).toHaveAttribute('font-weight', 'var(--font-weight-system)');
        expect(unitLabel).toHaveAttribute('letter-spacing', 'var(--tracking-system)');
        expect(unitLabel).toHaveAttribute('fill', 'var(--color-widget-icon)');
        expect(headerSubtitle).toHaveAttribute('aria-hidden', 'true');
        expect(headerSubtitle).not.toHaveTextContent('W');
    });

    it('keeps wider units inside the svg instead of the widget header subtitle', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                range: '12m',
                unit: 'KW',
                window: undefined,
                series: [
                    { timestamp: '2026-06-15T00:00:00.000Z', timestampMs: Date.parse('2026-06-15T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-30T00:00:00.000Z', timestampMs: Date.parse('2026-06-30T00:00:00.000Z'), value: 12 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        fireEvent.click(screen.getByRole('button', { name: '12m' }));

        const unitLabel = screen.getByTestId('trend-chart-v2-unit-label');

        expect(unitLabel).toHaveTextContent('KW');
        expect(unitLabel.closest('svg')).not.toBeNull();
        expect(document.querySelector('.row-start-2')).not.toHaveTextContent('KW');
    });

    it('keeps the top y-axis tick inside the svg while lifting the independent unit label above it', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                range: '12m',
                unit: 'KW',
                window: undefined,
                series: [
                    { timestamp: '2026-06-15T00:00:00.000Z', timestampMs: Date.parse('2026-06-15T00:00:00.000Z'), value: -1 },
                    { timestamp: '2026-06-22T00:00:00.000Z', timestampMs: Date.parse('2026-06-22T00:00:00.000Z'), value: 0.6 },
                    { timestamp: '2026-06-30T00:00:00.000Z', timestampMs: Date.parse('2026-06-30T00:00:00.000Z'), value: 2.2 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        fireEvent.click(screen.getByRole('button', { name: '12m' }));

        const unitLabel = screen.getByTestId('trend-chart-v2-unit-label');
        const topTickLabel = screen.getAllByTestId('trend-chart-v2-y-tick-label')[0];
        const topTickX = Number(topTickLabel.getAttribute('x'));
        const topTickY = Number(topTickLabel.getAttribute('y'));
        const unitLabelY = Number(unitLabel.getAttribute('y'));

        expect(unitLabel).toHaveTextContent('KW');
        expect(topTickLabel).toHaveTextContent('3.2');
        expect(unitLabel.closest('svg')).not.toBeNull();
        expect(topTickLabel.closest('svg')).not.toBeNull();
        expect(topTickLabel.getAttribute('text-anchor')).toBe('end');
        expect(topTickX).toBe(30);
        expect(topTickY).toBe(19);
        expect(unitLabelY).toBe(8);
        expect(unitLabelY).toBeLessThan(topTickY);
    });

    it('preserves tooltip unit rendering after moving the axis unit label out of the header', () => {
        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const overlay = screen.getByTestId('trend-chart-v2-interaction-overlay');
        Object.defineProperty(overlay, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
                x: 38,
                y: 19,
                width: 270,
                height: 137,
                top: 19,
                left: 38,
                right: 308,
                bottom: 156,
                toJSON: () => ({}),
            }),
        });

        fireEvent.mouseMove(overlay, { clientX: 128, clientY: 60 });

        expect(screen.getByText('47 °C')).toBeInTheDocument();
    });

    it('restores chart polish with y-axis ticks, scoped gradients, and a pulsing final-point marker', () => {
        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getAllByTestId('trend-chart-v2-y-tick-label')).toHaveLength(5);
        expect(screen.getAllByTestId('trend-chart-v2-y-grid-line')).toHaveLength(5);
        const pulse = screen.getByTestId('trend-chart-v2-final-point-pulse');
        const finalPoint = screen.getByTestId('trend-chart-v2-final-point-core');
        const overlaySvg = screen.getByTestId('trend-chart-v2-overlay-svg');

        expect(pulse).toBeInTheDocument();
        expect(finalPoint).toBeInTheDocument();
        expect(overlaySvg).toHaveAttribute('viewBox', '0 -20 340 200');
        expect(pulse.closest('svg')).toBe(overlaySvg);
        expect(finalPoint.closest('svg')).toBe(overlaySvg);

        const svg = screen.getByTestId('trend-chart-v2-svg');
        expect(svg?.innerHTML).toContain('trend-v2-1-line-gradient');
        expect(svg?.innerHTML).toContain('trend-v2-1-area-gradient');
        expect(svg?.innerHTML).toContain('trend-v2-1-line-glow');
        expect(svg?.innerHTML).toContain('gradientUnits="userSpaceOnUse"');
    });

    it('uses trend-chart-v2 line style display options with clamped fallbacks', () => {
        const { rerender } = render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const getLines = () => screen.getAllByTestId('trend-chart-v2-line-segment');
        const getBlur = () => document.querySelector('filter feGaussianBlur');

        getLines().forEach((line) => {
            expect(line).toHaveAttribute('stroke-width', '2.5');
        });
        expect(getBlur()).toHaveAttribute('stdDeviation', '3');

        rerender(<TrendChartV2Widget widget={makeWidget({ historicalDensity: 'high', lineStrokeWidth: 4.1, lineGlowBlur: 5.4 })} equipmentMap={new Map()} machines={[]} />);

        getLines().forEach((line) => {
            expect(line).toHaveAttribute('stroke-width', '4.1');
        });
        expect(getBlur()).toHaveAttribute('stdDeviation', '5.4');

        rerender(<TrendChartV2Widget widget={makeWidget({ historicalDensity: 'high', lineStrokeWidth: Number.NaN, lineGlowBlur: -2 })} equipmentMap={new Map()} machines={[]} />);

        getLines().forEach((line) => {
            expect(line).toHaveAttribute('stroke-width', '2.5');
        });
        expect(getBlur()).toHaveAttribute('stdDeviation', '0');
    });

    it('uses the shared left-aligned widget header primitive and preserves trend-chart-v2 icon configurability', () => {
        const widget: TrendChartV2WidgetConfig = {
            ...makeWidget(),
            displayOptions: {
                historicalDensity: 'high',
                icon: 'LineChart',
            },
        };

        render(<TrendChartV2Widget widget={widget} equipmentMap={new Map()} machines={[]} />);

        const icon = screen.getByTestId('trend-chart-v2-header-icon');
        const iconRow = icon.parentElement;

        expect(icon).toHaveClass('lucide-chart-line');
        expect(iconRow?.innerHTML.indexOf('svg')).toBeLessThan(iconRow?.innerHTML.indexOf('Trend Chart V2') ?? Number.MAX_SAFE_INTEGER);
    });

    it('applies only a tiny negative top offset on the chart container to tighten the external header gap', () => {
        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const header = screen.getByText('Trend Chart V2').closest('div[class*="grid-cols"]');
        const chartContainer = screen.getByTestId('trend-chart-v2-svg').parentElement;

        expect(header).toHaveClass(...WIDGET_CHART_HEADER_CLASS.split(' '));
        expect(chartContainer).toHaveClass(...WIDGET_CHART_CONTAINER_CLASS.split(' '));
    });

    it('removes isolated one-point artifacts inside multi-segment series while keeping the final marker only', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                window: {
                    start: '2026-06-18T12:00:00.000Z',
                    end: '2026-06-18T14:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 60_000,
                },
                series: [
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 41 },
                    { timestamp: '2026-06-18T12:01:00.000Z', timestampMs: Date.parse('2026-06-18T12:01:00.000Z'), value: 42 },
                    { timestamp: '2026-06-18T12:30:00.000Z', timestampMs: Date.parse('2026-06-18T12:30:00.000Z'), value: 45 },
                    { timestamp: '2026-06-18T13:20:00.000Z', timestampMs: Date.parse('2026-06-18T13:20:00.000Z'), value: 47 },
                    { timestamp: '2026-06-18T13:21:00.000Z', timestampMs: Date.parse('2026-06-18T13:21:00.000Z'), value: 48 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        const { container } = render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getAllByTestId('trend-chart-v2-segment')).toHaveLength(2);
        expect(container.querySelectorAll('circle')).toHaveLength(2);
    });

    it('renders a single finite point from series extent padding instead of falling back to misleading empty state', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                range: '24h',
                window: undefined,
                series: [
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 41 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.queryByText('Sin datos')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('trend-chart-v2-segment').length).toBeGreaterThan(0);
        expect(document.querySelector('circle')).toBeTruthy();
    });

    it('falls back to the resolved temporal timezone when backend window timezone is invalid', () => {
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: 'Invalid/Admin-Timezone', shifts: [] },
            shifts: [],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                window: {
                    start: '2026-06-18T12:00:00.000Z',
                    end: '2026-06-18T14:00:00.000Z',
                    timezone: 'Invalid/Backend-Timezone',
                    bucketMs: 60_000,
                },
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getByText('12:00')).toBeInTheDocument();
        expect(screen.getByText('14:00')).toBeInTheDocument();
        expect(screen.queryByText('Sin datos')).not.toBeInTheDocument();
    });

    it('converts drag selections into custom history queries and allows reset back to the preset', () => {
        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const overlay = screen.getByTestId('trend-chart-v2-interaction-overlay');
        const overlayX = Number(overlay.getAttribute('x'));
        const overlayWidth = Number(overlay.getAttribute('width'));
        const domainStartMs = Date.parse('2026-06-18T12:00:00.000Z');
        const domainEndMs = Date.parse('2026-06-18T14:00:00.000Z');
        const domainDurationMs = domainEndMs - domainStartMs;
        const selectionStartRatio = (92 - overlayX) / overlayWidth;
        const selectionEndRatio = (227 - overlayX) / overlayWidth;
        const expectedStartIso = new Date(domainStartMs + (domainDurationMs * selectionStartRatio)).toISOString();
        const expectedEndIso = new Date(domainStartMs + (domainDurationMs * selectionEndRatio)).toISOString();
        Object.defineProperty(overlay, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
                x: overlayX,
                y: 0,
                width: overlayWidth,
                height: 180,
                top: 0,
                left: overlayX,
                right: overlayX + overlayWidth,
                bottom: 180,
                toJSON: () => ({}),
            }),
        });

        fireEvent.mouseDown(overlay, { clientX: 92, clientY: 60 });
        fireEvent.mouseMove(overlay, { clientX: 227, clientY: 60 });
        fireEvent.mouseUp(overlay, { clientX: 227, clientY: 60 });

        expect(useDataHistory).toHaveBeenLastCalledWith({
            machineId: 101,
            variableKey: 'temperature',
            range: 'custom',
            start: expectedStartIso,
            end: expectedEndIso,
            maxPoints: 1500,
        });
        expect(screen.getByRole('button', { name: 'Back to preset' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Back to preset' }));

        expect(useDataHistory).toHaveBeenLastCalledWith({
            machineId: 101,
            variableKey: 'temperature',
            range: '24h',
            maxPoints: 1500,
        });
    });

    it('renders compatible legacy history responses and stays visible after preset changes', () => {
        vi.mocked(useDataHistory).mockImplementation((params) => ({
            data: makeLegacyHistoryResponse(),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: params !== null,
        }));

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.queryByText('Sin datos')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('trend-chart-v2-segment').length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: '7d' }));

        expect(useDataHistory).toHaveBeenLastCalledWith({
            machineId: 101,
            variableKey: 'temperature',
            range: '7d',
            maxPoints: 1500,
        });
        expect(screen.queryByText('Sin datos')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('trend-chart-v2-segment').length).toBeGreaterThan(0);
    });

    it('shows lowercase summary stats with a lowercase unit suffix and right-aligns them to the safe plot-right edge', () => {
        const widget: TrendChartV2WidgetConfig = {
            ...makeWidget(),
            displayOptions: {
                historicalDensity: 'high',
                showShifts: true,
            },
        };

        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'UTC',
                shifts: [
                    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
                ],
            },
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
            ],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                series: [
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 42 },
                    { timestamp: '2026-06-18T12:30:00.000Z', timestampMs: Date.parse('2026-06-18T12:30:00.000Z'), value: 50 },
                    { timestamp: '2026-06-18T13:00:00.000Z', timestampMs: Date.parse('2026-06-18T13:00:00.000Z'), value: 46 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={widget} equipmentMap={new Map()} machines={[]} />);

        const summary = screen.getByTestId('trend-chart-v2-summary');
        const unitLabel = screen.getByTestId('trend-chart-v2-unit-label');
        const expectedSummaryX = 320 - Math.ceil((measureChartTextWidthPx('14:00', getChartTextFont(), getChartLetterSpacingPx()) / 2) + 2);

        expect(screen.getByTestId('trend-chart-v2-summary-min')).toHaveTextContent('min 45°c');
        expect(screen.getByTestId('trend-chart-v2-summary-max')).toHaveTextContent('max 53°c');
        expect(screen.getByTestId('trend-chart-v2-summary-avg')).toHaveTextContent('avg 49°c');
        expect(summary).toHaveAttribute('text-anchor', 'end');
        expect(Number(summary.getAttribute('x'))).toBeCloseTo(expectedSummaryX, 3);
        expect(summary.getAttribute('y')).toBe(unitLabel.getAttribute('y'));
        expect(summary).toHaveAttribute('font-size', 'var(--font-size-system)');
        expect(summary).toHaveAttribute('font-family', 'var(--font-system)');
        expect(summary).toHaveAttribute('font-weight', 'var(--font-weight-system)');
        expect(summary).toHaveAttribute('letter-spacing', 'var(--tracking-system)');
        expect(summary).toHaveAttribute('fill', 'var(--color-industrial-muted)');
        expect(screen.queryByText(/^LAST /)).not.toBeInTheDocument();
        expect(screen.queryByText('Turno A')).not.toBeInTheDocument();
    });

    it('keeps the compact top plot offset whenever summary adornments exist even if the backend unit is empty', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                unit: '',
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const summary = screen.getByTestId('trend-chart-v2-summary');
        const overlay = screen.getByTestId('trend-chart-v2-interaction-overlay');

        expect(screen.queryByTestId('trend-chart-v2-unit-label')).not.toBeInTheDocument();
        expect(summary).toHaveAttribute('y', '8');
        expect(Number(overlay.getAttribute('y'))).toBe(19);
    });

    it('keeps rendering legacy-compatible preset payloads whose timestamps are far from the current client time', () => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
        vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeLegacyHistoryResponse(),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.queryByText('Sin datos')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('trend-chart-v2-segment').length).toBeGreaterThan(0);
    });

    it('uses the recovered plot space to render a taller chart area closer to legacy height', () => {
        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const overlay = screen.getByTestId('trend-chart-v2-interaction-overlay');

        expect(Number(overlay.getAttribute('height'))).toBeGreaterThanOrEqual(120);
        expect(Number(overlay.getAttribute('y'))).toBe(19);
    });

    it('preserves the last valid chart dimensions when ResizeObserver emits a transient zero measurement', () => {
        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getAllByTestId('trend-chart-v2-segment').length).toBeGreaterThan(0);

        const observer = MockResizeObserver.latest();
        observer.emit(0, 0);

        const svg = screen.getByTestId('trend-chart-v2-svg');

        expect(svg).toHaveAttribute('width', '320');
        expect(svg).toHaveAttribute('height', '180');
        expect(screen.getAllByTestId('trend-chart-v2-segment').length).toBeGreaterThan(0);
        expect(screen.queryByText('Preparing chart...')).not.toBeInTheDocument();
    });

    it('defaults to continuous-chart parity by hiding shift overlays and summary cards', () => {
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'UTC',
                shifts: [
                    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
                ],
            },
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
            ],
            resolvedTimezone: 'UTC',
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.queryByTestId('trend-chart-v2-shift-band')).not.toBeInTheDocument();
        expect(screen.queryByTestId('trend-chart-v2-shift-line')).not.toBeInTheDocument();
        expect(screen.queryByText('Turno A')).not.toBeInTheDocument();
        expect(screen.queryByText('Turno B')).not.toBeInTheDocument();
    });

    it('renders overnight shift overlays with the same date-aware Friday rollover label used by activity analytics', () => {
        const widget: TrendChartV2WidgetConfig = {
            ...makeWidget(),
            displayOptions: {
                historicalDensity: 'high',
                showShifts: true,
            },
        };

        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'UTC',
                shifts: [
                    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
                    { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00' },
                ],
            },
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
                { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00' },
            ],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                window: {
                    start: '2026-06-18T21:00:00.000Z',
                    end: '2026-06-19T03:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 60 * 60 * 1000,
                },
                series: [
                    { timestamp: '2026-06-18T21:30:00.000Z', timestampMs: Date.parse('2026-06-18T21:30:00.000Z'), value: 20 },
                    { timestamp: '2026-06-18T22:30:00.000Z', timestampMs: Date.parse('2026-06-18T22:30:00.000Z'), value: 30 },
                    { timestamp: '2026-06-19T01:00:00.000Z', timestampMs: Date.parse('2026-06-19T01:00:00.000Z'), value: 26 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={widget} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getAllByTestId('trend-chart-v2-shift-band')).not.toHaveLength(0);

        const overlay = screen.getByTestId('trend-chart-v2-interaction-overlay');
        Object.defineProperty(overlay, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
                x: 38,
                y: 0,
                width: 320,
                height: 180,
                top: 0,
                left: 38,
                right: 358,
                bottom: 180,
                toJSON: () => ({}),
            }),
        });

        fireEvent.mouseMove(overlay, { clientX: 252, clientY: 60 });

        expect(screen.getByText('Shift: 2026-06-18 · Turno C')).toBeInTheDocument();
    });

    it('shows sin turno in the tooltip when the shared weekly schedule leaves Sunday uncovered', () => {
        const widget: TrendChartV2WidgetConfig = {
            ...makeWidget(),
            displayOptions: {
                historicalDensity: 'high',
                showShifts: true,
            },
        };

        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'UTC',
                shifts: [
                    { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00', weekdays: ['fri'] },
                ],
            },
            shifts: [
                { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00', weekdays: ['fri'] },
            ],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                window: {
                    start: '2026-06-21T09:00:00.000Z',
                    end: '2026-06-21T11:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 60 * 60 * 1000,
                },
                series: [
                    { timestamp: '2026-06-21T10:00:00.000Z', timestampMs: Date.parse('2026-06-21T10:00:00.000Z'), value: 30 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={widget} equipmentMap={new Map()} machines={[]} />);

        const overlay = screen.getByTestId('trend-chart-v2-interaction-overlay');
        Object.defineProperty(overlay, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
                x: 38,
                y: 0,
                width: 320,
                height: 180,
                top: 0,
                left: 38,
                right: 358,
                bottom: 180,
                toJSON: () => ({}),
            }),
        });

        fireEvent.mouseMove(overlay, { clientX: 198, clientY: 60 });

        expect(screen.getByText('Shift: 2026-06-21 · sin turno')).toBeInTheDocument();
    });

    it('re-renders tooltip shift semantics when the global timezone changes', () => {
        const widget: TrendChartV2WidgetConfig = {
            ...makeWidget(),
            displayOptions: {
                historicalDensity: 'high',
                showShifts: true,
            },
        };

        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'UTC',
                shifts: [
                    { id: 'shift-evening', label: 'Turno Tarde', start: '20:00', end: '23:30', weekdays: ['fri'] },
                ],
            },
            shifts: [
                { id: 'shift-evening', label: 'Turno Tarde', start: '20:00', end: '23:30', weekdays: ['fri'] },
            ],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                window: {
                    start: '2026-06-20T00:00:00.000Z',
                    end: '2026-06-20T01:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 30 * 60 * 1000,
                },
                series: [
                    { timestamp: '2026-06-20T00:30:00.000Z', timestampMs: Date.parse('2026-06-20T00:30:00.000Z'), value: 30 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        const { rerender } = render(<TrendChartV2Widget widget={widget} equipmentMap={new Map()} machines={[]} />);

        const overlay = screen.getByTestId('trend-chart-v2-interaction-overlay');
        Object.defineProperty(overlay, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
                x: 38,
                y: 0,
                width: 320,
                height: 180,
                top: 0,
                left: 38,
                right: 358,
                bottom: 180,
                toJSON: () => ({}),
            }),
        });

        fireEvent.mouseMove(overlay, { clientX: 198, clientY: 60 });
        expect(screen.getByText('Shift: 2026-06-20 · sin turno')).toBeInTheDocument();

        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'America/Argentina/Buenos_Aires',
                shifts: [
                    { id: 'shift-evening', label: 'Turno Tarde', start: '20:00', end: '23:30', weekdays: ['fri'] },
                ],
            },
            shifts: [
                { id: 'shift-evening', label: 'Turno Tarde', start: '20:00', end: '23:30', weekdays: ['fri'] },
            ],
            resolvedTimezone: 'America/Argentina/Buenos_Aires',
        });

        rerender(<TrendChartV2Widget widget={widget} equipmentMap={new Map()} machines={[]} />);
        fireEvent.mouseMove(screen.getByTestId('trend-chart-v2-interaction-overlay'), { clientX: 198, clientY: 60 });

        expect(screen.getByText('Shift: 2026-06-19 · Turno Tarde')).toBeInTheDocument();
    });

    it('suppresses shift labels and summary when shift visibility remains disabled', () => {
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'UTC',
                shifts: [
                    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                ],
            },
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
            ],
            resolvedTimezone: 'UTC',
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const overlay = screen.getByTestId('trend-chart-v2-interaction-overlay');
        Object.defineProperty(overlay, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
                x: 38,
                y: 0,
                width: 320,
                height: 180,
                top: 0,
                left: 38,
                right: 358,
                bottom: 180,
                toJSON: () => ({}),
            }),
        });

        fireEvent.mouseMove(overlay, { clientX: 120, clientY: 60 });

        expect(screen.queryByText(/Shift:/)).not.toBeInTheDocument();
        expect(screen.queryByText('Turno A')).not.toBeInTheDocument();
    });

    it('can show shift guides without rendering the summary cards', () => {
        const widget: TrendChartV2WidgetConfig = {
            ...makeWidget(),
            displayOptions: {
                historicalDensity: 'high',
                showShifts: true,
                shiftDisplayMode: 'lines',
            },
        };

        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'UTC',
                shifts: [
                    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
                ],
            },
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
            ],
            resolvedTimezone: 'UTC',
        });

        render(<TrendChartV2Widget widget={widget} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getAllByTestId('trend-chart-v2-shift-line')).not.toHaveLength(0);
        expect(screen.queryByText(/^LAST /)).not.toBeInTheDocument();
        expect(screen.getByTestId('trend-chart-v2-summary-min')).toHaveTextContent('min 45°c');
    });

    it('renders configured shift lines instead of bands when the widget requests line mode', () => {
        const widget: TrendChartV2WidgetConfig = {
            ...makeWidget(),
            displayOptions: {
                historicalDensity: 'high',
                showShifts: true,
                shiftDisplayMode: 'lines',
            },
        };

        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'UTC',
                shifts: [
                    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
                ],
            },
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
            ],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                window: {
                    start: '2026-06-18T12:00:00.000Z',
                    end: '2026-06-18T18:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 60 * 60 * 1000,
                },
                series: [
                    { timestamp: '2026-06-18T12:30:00.000Z', timestampMs: Date.parse('2026-06-18T12:30:00.000Z'), value: 45 },
                    { timestamp: '2026-06-18T15:30:00.000Z', timestampMs: Date.parse('2026-06-18T15:30:00.000Z'), value: 47 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={widget} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getAllByTestId('trend-chart-v2-shift-line')).not.toHaveLength(0);
        expect(screen.queryByTestId('trend-chart-v2-shift-band')).not.toBeInTheDocument();
    });

    it('renders configured shift bands when the widget requests band mode', () => {
        const widget: TrendChartV2WidgetConfig = {
            ...makeWidget(),
            displayOptions: {
                historicalDensity: 'high',
                showShifts: true,
                shiftDisplayMode: 'bands',
            },
        };

        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'UTC',
                shifts: [
                    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
                ],
            },
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
            ],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                window: {
                    start: '2026-06-18T12:00:00.000Z',
                    end: '2026-06-18T18:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 60 * 60 * 1000,
                },
                series: [
                    { timestamp: '2026-06-18T12:30:00.000Z', timestampMs: Date.parse('2026-06-18T12:30:00.000Z'), value: 45 },
                    { timestamp: '2026-06-18T15:30:00.000Z', timestampMs: Date.parse('2026-06-18T15:30:00.000Z'), value: 47 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={widget} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getAllByTestId('trend-chart-v2-shift-band')).not.toHaveLength(0);
        expect(screen.queryByTestId('trend-chart-v2-shift-line')).not.toBeInTheDocument();
    });

    it('ignores invalid or too-small drag selections', () => {
        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const overlay = screen.getByTestId('trend-chart-v2-interaction-overlay');
        Object.defineProperty(overlay, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
                x: 38,
                y: 0,
                width: 320,
                height: 180,
                top: 0,
                left: 38,
                right: 358,
                bottom: 180,
                toJSON: () => ({}),
            }),
        });

        fireEvent.mouseDown(overlay, { clientX: 100, clientY: 60 });
        fireEvent.mouseMove(overlay, { clientX: 105, clientY: 60 });
        fireEvent.mouseUp(overlay, { clientX: 105, clientY: 60 });

        expect(useDataHistory).toHaveBeenLastCalledWith({
            machineId: 101,
            variableKey: 'temperature',
            range: '24h',
            maxPoints: 1500,
        });
        expect(screen.getByText('Selection too small to zoom. Drag a wider time window.')).toBeInTheDocument();
        expect(screen.queryByText('Drag on the chart to zoom into a custom window.')).not.toBeInTheDocument();
    });

    it('renders deterministic simulated history for simulated bindings without querying real history', () => {
        const simulatedWidget: TrendChartV2WidgetConfig = {
            ...makeWidget(),
            id: 'trend-v2-simulated',
            binding: {
                mode: 'simulated_value',
                simulatedValue: 50,
                unit: '°C',
            },
        };

        render(<TrendChartV2Widget widget={simulatedWidget} equipmentMap={new Map()} machines={[]} />);

        expect(useDataHistory).toHaveBeenLastCalledWith(null);
        expect(screen.queryByText('Sin datos')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('trend-chart-v2-segment')).not.toHaveLength(0);
        expect(screen.getByText('24h')).toBeInTheDocument();
    });

    it('keeps simulated visible output stable across fresh renders even if Date.now changes', () => {
        const simulatedWidget: TrendChartV2WidgetConfig = {
            ...makeWidget(),
            id: 'trend-v2-simulated-stable',
            binding: {
                mode: 'simulated_value',
                simulatedValue: 50,
                unit: '°C',
            },
        };

        const firstNowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-18T12:00:00.000Z'));
        const firstRender = render(<TrendChartV2Widget widget={simulatedWidget} equipmentMap={new Map()} machines={[]} />);
        const firstPath = firstRender.container.querySelector('[data-testid="trend-chart-v2-line-segment"]')?.getAttribute('d');
        const firstTicks = Array.from(firstRender.container.querySelectorAll('text')).map((node) => node.textContent);
        firstRender.unmount();
        firstNowSpy.mockRestore();

        const secondNowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-01T12:00:00.000Z'));
        const secondRender = render(<TrendChartV2Widget widget={simulatedWidget} equipmentMap={new Map()} machines={[]} />);
        const secondPath = secondRender.container.querySelector('[data-testid="trend-chart-v2-line-segment"]')?.getAttribute('d');
        const secondTicks = Array.from(secondRender.container.querySelectorAll('text')).map((node) => node.textContent);
        secondNowSpy.mockRestore();

        expect(firstPath).toBeTruthy();
        expect(firstPath).toBe(secondPath);
        expect(firstTicks).toEqual(secondTicks);
    });

    it('rejects legacy history responses in the V2 type guard while accepting V2 points with finite timestampMs', () => {
        expect(isDataHistoryResponseV2({
            contractVersion: '1.0.0',
            machineId: 101,
            variableKey: 'temperature',
            range: 'hora',
            unit: '°C',
            series: [{ timestamp: '2026-06-18T12:00:00.000Z', value: 42 }],
            summary: { last: 42, min: 42, max: 42, avg: 42 },
        })).toBe(false);

        expect(isDataHistoryResponseV2({
            contractVersion: '1.1.0',
            machineId: 101,
            variableKey: 'temperature',
            range: '24h',
            unit: '°C',
            window: {
                start: '2026-06-18T12:00:00.000Z',
                end: '2026-06-18T14:00:00.000Z',
            },
            series: [{ timestamp: '2026-06-18T12:00:00.000Z', timestampMs: 1, value: 42 }],
            summary: { last: 42, min: 42, max: 42, avg: 42 },
        })).toBe(true);
    });
});
