import { describe, expect, it } from 'vitest';

import type { ActivityAnalyticsInterval } from './activityAnalytics';
import {
    accumulateActivityAnalyticsShiftIntersections,
    createActivityAnalyticsShiftSweepDiagnostics,
} from './activityAnalyticsShiftSweep';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

describe('activityAnalyticsShiftSweep', () => {
    it('visits each ordered interval only for its real bucket intersection', () => {
        const startMs = Date.parse('2026-06-01T00:00:00.000Z');
        const buckets = Array.from({ length: 20 }, (_, index) => ({
            startMs: startMs + (index * HOUR_MS),
            endMs: startMs + ((index + 1) * HOUR_MS),
        }));
        const intervals = Array.from({ length: 200 }, (_, index) => buildInterval(
            startMs + (index * 6 * MINUTE_MS),
            6 * MINUTE_MS,
        ));
        const diagnostics = createActivityAnalyticsShiftSweepDiagnostics();

        accumulateActivityAnalyticsShiftIntersections({ buckets, intervals, diagnostics });

        expect(diagnostics).toEqual({
            bucketVisits: 20,
            intervalOrderChecks: 199,
            intervalVisits: 200,
            intersections: 200,
            sortedInputCopies: 0,
        });
    });

    it('sorts one defensive copy and keeps overlapping intervals active only across real intersections', () => {
        const startMs = Date.parse('2026-06-01T00:00:00.000Z');
        const buckets = Array.from({ length: 3 }, (_, index) => ({
            startMs: startMs + (index * HOUR_MS),
            endMs: startMs + ((index + 1) * HOUR_MS),
        }));
        const intervals = [
            buildInterval(startMs + (2 * HOUR_MS), HOUR_MS, 'stopped'),
            buildInterval(startMs, 3 * HOUR_MS, 'prod'),
            buildInterval(startMs + HOUR_MS, 30 * MINUTE_MS, 'setup'),
        ];
        const diagnostics = createActivityAnalyticsShiftSweepDiagnostics();

        const accumulated = accumulateActivityAnalyticsShiftIntersections({ buckets, intervals, diagnostics });

        expect(diagnostics).toEqual({
            bucketVisits: 3,
            intervalOrderChecks: 1,
            intervalVisits: 5,
            intersections: 5,
            sortedInputCopies: 1,
        });
        expect(accumulated.map((entry) => entry.durationsMs)).toEqual([
            { prod: HOUR_MS, setup: 0, stopped: 0, noData: 0 },
            { prod: HOUR_MS, setup: 30 * MINUTE_MS, stopped: 0, noData: 0 },
            { prod: HOUR_MS, setup: 0, stopped: HOUR_MS, noData: 0 },
        ]);
    });
});

function buildInterval(
    timestampMs: number,
    durationMs: number,
    state: ActivityAnalyticsInterval['state'] = 'prod',
): ActivityAnalyticsInterval {
    return {
        timestamp: new Date(timestampMs).toISOString(),
        timestampMs,
        endTimestamp: new Date(timestampMs + durationMs).toISOString(),
        endTimestampMs: timestampMs + durationMs,
        durationMs,
        state,
        normalizedKw: 10,
        estimatedKwh: 10 * (durationMs / HOUR_MS),
        stopCountContribution: 0,
        isDataBacked: true,
    };
}
