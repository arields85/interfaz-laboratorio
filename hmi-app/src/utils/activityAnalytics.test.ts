import { describe, expect, it } from 'vitest';

import {
    buildActivityAnalytics,
    classifyActivityAnalyticsPoint,
    validateActivityAnalyticsThresholds,
} from './activityAnalytics';

const THRESHOLDS = {
    setupKw: 3,
    prodKw: 8,
} as const;

function point(timestamp: string, value: number | null) {
    return {
        timestamp,
        timestampMs: Date.parse(timestamp),
        value,
    };
}

describe('activityAnalytics', () => {
    it('normalizes negative values and classifies stopped/setup/prod boundaries', () => {
        expect(classifyActivityAnalyticsPoint({ value: -5, thresholds: THRESHOLDS })).toEqual({
            normalizedValue: 0,
            state: 'stopped',
        });

        expect(classifyActivityAnalyticsPoint({ value: 3, thresholds: THRESHOLDS })).toEqual({
            normalizedValue: 3,
            state: 'setup',
        });

        expect(classifyActivityAnalyticsPoint({ value: 8, thresholds: THRESHOLDS })).toEqual({
            normalizedValue: 8,
            state: 'prod',
        });
    });

    it('rejects invalid thresholds when prod is not greater than setup', () => {
        expect(() => validateActivityAnalyticsThresholds({ setupKw: 5, prodKw: 5 })).toThrowError(
            'Activity analytics requires prodThresholdKw to be greater than setupThresholdKw'
        );
    });

    it('accumulates durations by timestamp deltas and caps the last point at bucketMs * 1.5', () => {
        const analytics = buildActivityAnalytics({
            series: [
                point('2026-06-18T10:00:00.000Z', 10),
                point('2026-06-18T10:05:00.000Z', 5),
                point('2026-06-18T10:10:00.000Z', 0),
            ],
            bucketMs: 5 * 60 * 1000,
            thresholds: THRESHOLDS,
        });

        expect(analytics.durationsMs).toEqual({
            prod: 5 * 60 * 1000,
            setup: 5 * 60 * 1000,
            stopped: 7.5 * 60 * 1000,
            noData: 0,
        });
        expect(analytics.stopCount).toBe(1);
        expect(analytics.coverageRatio).toBe(1);
        expect(analytics.utilizationRatio).toBeCloseTo(0.285714, 6);
        expect(analytics.intervals.map((interval) => ({ state: interval.state, durationMs: interval.durationMs }))).toEqual([
            { state: 'prod', durationMs: 5 * 60 * 1000 },
            { state: 'setup', durationMs: 5 * 60 * 1000 },
            { state: 'stopped', durationMs: 7.5 * 60 * 1000 },
        ]);
    });

    it('treats large gaps as no-data, excludes them from utilization, and blocks stop counts across the gap', () => {
        const analytics = buildActivityAnalytics({
            series: [
                point('2026-06-18T10:00:00.000Z', 10),
                point('2026-06-18T10:05:00.000Z', 5),
                point('2026-06-18T10:20:00.000Z', 0),
            ],
            bucketMs: 5 * 60 * 1000,
            thresholds: THRESHOLDS,
        });

        expect(analytics.durationsMs).toEqual({
            prod: 5 * 60 * 1000,
            setup: 0,
            stopped: 7.5 * 60 * 1000,
            noData: 15 * 60 * 1000,
        });
        expect(analytics.stopCount).toBe(0);
        expect(analytics.utilizationRatio).toBeCloseTo(0.4, 6);
        expect(analytics.coverageRatio).toBeCloseTo(12.5 / 27.5, 6);
        expect(analytics.intervals.map((interval) => interval.state)).toEqual(['prod', 'no-data', 'stopped']);
    });

    it('integrates normalized kW into estimated kWh using only data-backed durations', () => {
        const analytics = buildActivityAnalytics({
            series: [
                point('2026-06-18T10:00:00.000Z', -2),
                point('2026-06-18T10:05:00.000Z', 12),
                point('2026-06-18T10:10:00.000Z', 6),
            ],
            bucketMs: 5 * 60 * 1000,
            thresholds: THRESHOLDS,
        });

        expect(analytics.estimatedKwh).toBeCloseTo(1.75, 6);
        expect(analytics.coverageRatio).toBe(1);
    });

    it('keeps an exact bucketMs * 2 delta as data-backed instead of treating it as a gap', () => {
        const analytics = buildActivityAnalytics({
            series: [
                point('2026-06-18T10:00:00.000Z', 10),
                point('2026-06-18T10:10:00.000Z', 0),
            ],
            bucketMs: 5 * 60 * 1000,
            thresholds: THRESHOLDS,
        });

        expect(analytics.durationsMs).toEqual({
            prod: 10 * 60 * 1000,
            setup: 0,
            stopped: 7.5 * 60 * 1000,
            noData: 0,
        });
        expect(analytics.stopCount).toBe(1);
        expect(analytics.intervals.map((interval) => interval.state)).toEqual(['prod', 'stopped']);
    });

    it('treats null and non-finite point values as no-data instead of stopped runtime', () => {
        const analytics = buildActivityAnalytics({
            series: [
                point('2026-06-18T10:00:00.000Z', null),
                point('2026-06-18T10:05:00.000Z', Number.NaN),
                point('2026-06-18T10:10:00.000Z', 9),
            ],
            bucketMs: 5 * 60 * 1000,
            thresholds: THRESHOLDS,
        });

        expect(analytics.durationsMs).toEqual({
            prod: 7.5 * 60 * 1000,
            setup: 0,
            stopped: 0,
            noData: 10 * 60 * 1000,
        });
        expect(analytics.coverageRatio).toBeCloseTo(7.5 / 17.5, 6);
        expect(analytics.intervals.map((interval) => interval.state)).toEqual(['no-data', 'no-data', 'prod']);
    });

    it('returns an empty result for an empty series', () => {
        expect(buildActivityAnalytics({
            series: [],
            bucketMs: 5 * 60 * 1000,
            thresholds: THRESHOLDS,
        })).toEqual({
            durationsMs: {
                prod: 0,
                setup: 0,
                stopped: 0,
                noData: 0,
            },
            stopCount: 0,
            estimatedKwh: 0,
            utilizationRatio: 0,
            coverageRatio: 0,
            intervals: [],
        });
    });

    it('rejects non-positive bucket sizes before deriving trailing or gap durations', () => {
        expect(() => buildActivityAnalytics({
            series: [point('2026-06-18T10:00:00.000Z', 10)],
            bucketMs: 0,
            thresholds: THRESHOLDS,
        })).toThrowError('Activity analytics requires bucketMs to be greater than zero');

        expect(() => buildActivityAnalytics({
            series: [point('2026-06-18T10:00:00.000Z', 10)],
            bucketMs: -5 * 60 * 1000,
            thresholds: THRESHOLDS,
        })).toThrowError('Activity analytics requires bucketMs to be greater than zero');
    });
});
