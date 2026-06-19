import { describe, expect, it } from 'vitest';

import type { ShiftDefinition } from '../domain/admin.types';
import { computeActivityAnalytics } from './activityAnalyticsComputation';

const THRESHOLDS = {
    setupKw: 3,
    prodKw: 8,
} as const;

const SHIFTS: ShiftDefinition[] = [
    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
    { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00' },
];

function point(timestamp: string, value: number | null) {
    return {
        timestamp,
        timestampMs: Date.parse(timestamp),
        value,
    };
}

describe('computeActivityAnalytics', () => {
    it('returns analytics and grouped buckets for representative activity-series inputs', () => {
        const result = computeActivityAnalytics({
            series: [
                point('2026-06-18T21:30:00.000Z', 10),
                point('2026-06-18T22:00:00.000Z', 5),
                point('2026-06-18T22:30:00.000Z', 0),
            ],
            thresholds: THRESHOLDS,
            groupBy: 'shift',
            shifts: SHIFTS,
            timezone: 'UTC',
            window: {
                start: '2026-06-18T21:30:00.000Z',
                end: '2026-06-18T22:30:00.000Z',
                timezone: 'UTC',
                bucket: '30m',
                bucketMs: 30 * 60 * 1000,
            },
        });

        expect(result.analytics.durationsMs).toEqual({
            prod: 30 * 60 * 1000,
            setup: 30 * 60 * 1000,
            stopped: 45 * 60 * 1000,
            noData: 0,
        });
        expect(result.analytics.stopCount).toBe(1);
        expect(result.grouped).toHaveLength(2);
        expect(result.grouped.map((bucket) => bucket.bucketKey)).toEqual([
            'shift:shift-b:2026-06-18',
            'shift:shift-c:2026-06-18',
        ]);
    });

    it('recomputes grouped outputs when thresholds, grouping, timezone, shifts, or window change', () => {
        const series = [
            point('2026-06-19T02:30:00.000Z', 10),
            point('2026-06-19T03:30:00.000Z', 5),
            point('2026-06-19T04:30:00.000Z', 0),
        ];

        const dayResult = computeActivityAnalytics({
            series,
            thresholds: THRESHOLDS,
            groupBy: 'day',
            shifts: SHIFTS,
            timezone: 'UTC',
            window: {
                start: '2026-06-19T02:30:00.000Z',
                end: '2026-06-19T04:30:00.000Z',
                timezone: 'UTC',
                bucket: '1h',
                bucketMs: 60 * 60 * 1000,
            },
        });

        const shiftResult = computeActivityAnalytics({
            series,
            thresholds: { setupKw: 6, prodKw: 9 },
            groupBy: 'shift',
            shifts: [{ id: 'overnight', label: 'Noche', start: '00:00', end: '08:00' }],
            timezone: 'America/Argentina/Buenos_Aires',
            window: {
                start: '2026-06-19T02:30:00.000Z',
                end: '2026-06-19T05:30:00.000Z',
                timezone: 'America/Argentina/Buenos_Aires',
                bucket: '1h',
                bucketMs: 90 * 60 * 1000,
            },
        });

        expect(dayResult.analytics.durationsMs).not.toEqual(shiftResult.analytics.durationsMs);
        expect(dayResult.grouped.map((bucket) => bucket.bucketKey)).not.toEqual(
            shiftResult.grouped.map((bucket) => bucket.bucketKey),
        );
        expect(dayResult.timezone).toBe('UTC');
        expect(shiftResult.timezone).toBe('America/Argentina/Buenos_Aires');
    });
});
