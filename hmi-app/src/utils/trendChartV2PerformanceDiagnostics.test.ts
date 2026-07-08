import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    clearTrendChartV2PerformanceDiagnosticsSnapshot,
    getTrendChartV2PerformanceDiagnosticsSnapshot,
    recordTrendChartV2PerformanceDiagnostic,
    startTrendChartV2PerformanceTransition,
    subscribeTrendChartV2PerformanceDiagnostics,
} from './trendChartV2PerformanceDiagnostics';

describe('trendChartV2PerformanceDiagnostics', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        clearTrendChartV2PerformanceDiagnosticsSnapshot();
    });

    it('notifies subscribers for typed diagnostics events and stops after unsubscribe', () => {
        const received: Array<{ widgetId: string; event: string; reason?: string; durationMs?: number }> = [];
        const unsubscribe = subscribeTrendChartV2PerformanceDiagnostics((event) => {
            received.push(event);
        });

        recordTrendChartV2PerformanceDiagnostic({
            widgetId: 'trend-chart-v2-widget-1',
            event: 'resize_noop_suppressed',
            reason: 'rounded_dimensions_unchanged',
        });

        unsubscribe();

        recordTrendChartV2PerformanceDiagnostic({
            widgetId: 'trend-chart-v2-widget-1',
            event: 'resize_settled_committed',
        });

        expect(received).toEqual([
            {
                widgetId: 'trend-chart-v2-widget-1',
                event: 'resize_noop_suppressed',
                reason: 'rounded_dimensions_unchanged',
            },
        ]);
    });

    it('measures transitions with guarded performance APIs and emits duration diagnostics', () => {
        const mark = vi.fn();
        const measure = vi.fn();
        const clearMarks = vi.fn();
        const clearMeasures = vi.fn();
        const now = vi.fn<[void], number>()
            .mockReturnValueOnce(100)
            .mockReturnValueOnce(160);
        const received: Array<{ widgetId: string; event: string; reason?: string; durationMs?: number }> = [];

        vi.stubGlobal('performance', { mark, measure, clearMarks, clearMeasures, now });

        const unsubscribe = subscribeTrendChartV2PerformanceDiagnostics((event) => {
            received.push(event);
        });

        const finish = startTrendChartV2PerformanceTransition('trend-chart-v2-widget-2');
        finish();
        unsubscribe();

        expect(mark).toHaveBeenNthCalledWith(1, 'trend-chart-v2:trend-chart-v2-widget-2:start');
        expect(mark).toHaveBeenNthCalledWith(2, 'trend-chart-v2:trend-chart-v2-widget-2:end');
        expect(measure).toHaveBeenCalledWith(
            'trend-chart-v2:trend-chart-v2-widget-2',
            'trend-chart-v2:trend-chart-v2-widget-2:start',
            'trend-chart-v2:trend-chart-v2-widget-2:end',
        );
        expect(clearMarks).toHaveBeenCalledWith('trend-chart-v2:trend-chart-v2-widget-2:start');
        expect(clearMarks).toHaveBeenCalledWith('trend-chart-v2:trend-chart-v2-widget-2:end');
        expect(clearMeasures).toHaveBeenCalledWith('trend-chart-v2:trend-chart-v2-widget-2');
        expect(received).toEqual([
            {
                widgetId: 'trend-chart-v2-widget-2',
                event: 'transition_measured',
                durationMs: 60,
            },
        ]);
    });

    it('keeps a bounded in-memory diagnostics snapshot with no external telemetry dependency', () => {
        const directFetch = vi.fn();
        vi.stubGlobal('fetch', directFetch);

        for (let index = 0; index < 60; index += 1) {
            recordTrendChartV2PerformanceDiagnostic({
                widgetId: `trend-chart-v2-widget-${index}`,
                event: 'prefetch_denied',
                reason: `reason-${index}`,
            });
        }

        const snapshot = getTrendChartV2PerformanceDiagnosticsSnapshot();

        expect(snapshot).toHaveLength(50);
        expect(snapshot[0]).toEqual({
            widgetId: 'trend-chart-v2-widget-10',
            event: 'prefetch_denied',
            reason: 'reason-10',
        });
        expect(snapshot.at(-1)).toEqual({
            widgetId: 'trend-chart-v2-widget-59',
            event: 'prefetch_denied',
            reason: 'reason-59',
        });
        expect(directFetch).not.toHaveBeenCalled();
    });
});
