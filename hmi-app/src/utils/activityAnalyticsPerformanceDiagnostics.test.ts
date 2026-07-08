import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    clearActivityAnalyticsPerformanceDiagnosticsSnapshot,
    getActivityAnalyticsPerformanceDiagnosticsSnapshot,
    recordActivityAnalyticsPerformanceDiagnostic,
    startActivityAnalyticsPerformanceTransition,
    subscribeActivityAnalyticsPerformanceDiagnostics,
} from './activityAnalyticsPerformanceDiagnostics';

describe('activityAnalyticsPerformanceDiagnostics', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        clearActivityAnalyticsPerformanceDiagnosticsSnapshot();
    });

    it('notifies subscribers for typed diagnostics events and stops after unsubscribe', () => {
        const received: Array<{ widgetId: string; event: string; reason?: string; durationMs?: number }> = [];
        const unsubscribe = subscribeActivityAnalyticsPerformanceDiagnostics((event) => {
            received.push(event);
        });

        recordActivityAnalyticsPerformanceDiagnostic({
            widgetId: 'activity-widget-1',
            event: 'prefetch_suppressed',
            reason: 'visibility_unavailable',
        });

        unsubscribe();

        recordActivityAnalyticsPerformanceDiagnostic({
            widgetId: 'activity-widget-1',
            event: 'prefetch_started',
        });

        expect(received).toEqual([
            {
                widgetId: 'activity-widget-1',
                event: 'prefetch_suppressed',
                reason: 'visibility_unavailable',
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
            .mockReturnValueOnce(165);
        const received: Array<{ widgetId: string; event: string; reason?: string; durationMs?: number }> = [];

        vi.stubGlobal('performance', { mark, measure, clearMarks, clearMeasures, now });

        const unsubscribe = subscribeActivityAnalyticsPerformanceDiagnostics((event) => {
            received.push(event);
        });

        const finish = startActivityAnalyticsPerformanceTransition('activity-widget-2');
        finish();
        unsubscribe();

        expect(mark).toHaveBeenNthCalledWith(1, 'activity-analytics:activity-widget-2:start');
        expect(mark).toHaveBeenNthCalledWith(2, 'activity-analytics:activity-widget-2:end');
        expect(measure).toHaveBeenCalledWith(
            'activity-analytics:activity-widget-2',
            'activity-analytics:activity-widget-2:start',
            'activity-analytics:activity-widget-2:end',
        );
        expect(clearMarks).toHaveBeenCalledWith('activity-analytics:activity-widget-2:start');
        expect(clearMarks).toHaveBeenCalledWith('activity-analytics:activity-widget-2:end');
        expect(clearMeasures).toHaveBeenCalledWith('activity-analytics:activity-widget-2');
        expect(received).toEqual([
            {
                widgetId: 'activity-widget-2',
                event: 'transition_measured',
                durationMs: 65,
            },
        ]);
    });

    it('still emits transition diagnostics when performance mark/measure APIs are unavailable', () => {
        const now = vi.fn<[void], number>()
            .mockReturnValueOnce(25)
            .mockReturnValueOnce(55);
        const received: Array<{ widgetId: string; event: string; reason?: string; durationMs?: number }> = [];

        vi.stubGlobal('performance', { now });

        const unsubscribe = subscribeActivityAnalyticsPerformanceDiagnostics((event) => {
            received.push(event);
        });

        const finish = startActivityAnalyticsPerformanceTransition('activity-widget-3');
        finish();
        unsubscribe();

        expect(received).toEqual([
            {
                widgetId: 'activity-widget-3',
                event: 'transition_measured',
                durationMs: 30,
            },
        ]);
    });

    it('keeps a bounded in-memory diagnostics snapshot for production-safe inspection', () => {
        for (let index = 0; index < 60; index += 1) {
            recordActivityAnalyticsPerformanceDiagnostic({
                widgetId: `activity-widget-${index}`,
                event: 'prefetch_suppressed',
                reason: `reason-${index}`,
            });
        }

        const snapshot = getActivityAnalyticsPerformanceDiagnosticsSnapshot();

        expect(snapshot).toHaveLength(50);
        expect(snapshot[0]).toEqual({
            widgetId: 'activity-widget-10',
            event: 'prefetch_suppressed',
            reason: 'reason-10',
        });
        expect(snapshot.at(-1)).toEqual({
            widgetId: 'activity-widget-59',
            event: 'prefetch_suppressed',
            reason: 'reason-59',
        });
    });

    it('falls back safely when the global performance binding is fully absent', () => {
        const originalPerformance = globalThis.performance;
        const received: Array<{ widgetId: string; event: string; reason?: string; durationMs?: number }> = [];

        try {
            // @ts-expect-error -- test intentionally removes the global binding to cover runtimes without performance.
            delete globalThis.performance;

            const unsubscribe = subscribeActivityAnalyticsPerformanceDiagnostics((event) => {
                received.push(event);
            });

            const finish = startActivityAnalyticsPerformanceTransition('activity-widget-4');
            const durationMs = finish();
            unsubscribe();

            expect(durationMs).toBeGreaterThanOrEqual(0);
            expect(received).toEqual([
                {
                    widgetId: 'activity-widget-4',
                    event: 'transition_measured',
                    durationMs,
                },
            ]);
        } finally {
            Object.defineProperty(globalThis, 'performance', {
                configurable: true,
                writable: true,
                value: originalPerformance,
            });
        }
    });

    it('records an optional reason when a transition is closed early', () => {
        const received: Array<{ widgetId: string; event: string; reason?: string; durationMs?: number }> = [];
        const unsubscribe = subscribeActivityAnalyticsPerformanceDiagnostics((event) => {
            received.push(event);
        });

        const finish = startActivityAnalyticsPerformanceTransition('activity-widget-5');
        finish('widget_reset');
        unsubscribe();

        expect(received).toHaveLength(1);
        expect(received[0]).toMatchObject({
            widgetId: 'activity-widget-5',
            event: 'transition_measured',
            reason: 'widget_reset',
        });
    });
});
