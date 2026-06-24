import { describe, expect, it } from 'vitest';

import type { ShiftDefinition, TemporalSettingsConfig } from '../domain/admin.types';
import type { ActivityAnalyticsInterval } from './activityAnalytics';
import {
    groupActivityAnalyticsIntervals,
    resolveActivityAnalyticsTimezone,
} from './activityAnalyticsGrouping';

const UTC = 'UTC';

const SHIFTS: ShiftDefinition[] = [
    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
    { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
];

function interval(start: string, durationMs: number, state: ActivityAnalyticsInterval['state']): ActivityAnalyticsInterval {
    const timestampMs = Date.parse(start);

    return {
        timestamp: start,
        timestampMs,
        endTimestamp: new Date(timestampMs + durationMs).toISOString(),
        endTimestampMs: timestampMs + durationMs,
        durationMs,
        state,
        normalizedKw: state === 'no-data' ? null : 10,
        estimatedKwh: state === 'no-data' ? 0 : 10 * (durationMs / (60 * 60 * 1000)),
        stopCountContribution: state === 'stopped' ? 1 : 0,
        isDataBacked: state !== 'no-data',
    };
}

describe('activityAnalyticsGrouping', () => {
    it('groups overnight shifts into one logical shift bucket across midnight', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-18T22:30:00.000Z', 30 * 60 * 1000, 'prod'),
                interval('2026-06-19T01:30:00.000Z', 30 * 60 * 1000, 'setup'),
            ],
            groupBy: 'shift',
            timezone: UTC,
            shifts: SHIFTS,
        });

        expect(grouped).toHaveLength(1);
        expect(grouped[0]).toMatchObject({
            bucketKey: 'shift:shift-c:2026-06-18',
            label: '2026-06-18 · Turno C',
            durationsMs: {
                prod: 30 * 60 * 1000,
                setup: 30 * 60 * 1000,
                stopped: 0,
                noData: 0,
            },
        });
    });

    it('uses the resolved timezone for day boundaries instead of incidental browser-local grouping', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-19T02:30:00.000Z', 30 * 60 * 1000, 'prod'),
                interval('2026-06-19T03:30:00.000Z', 30 * 60 * 1000, 'setup'),
            ],
            groupBy: 'day',
            timezone: 'America/Argentina/Buenos_Aires',
            shifts: SHIFTS,
        });

        expect(grouped.map((bucket) => bucket.bucketKey)).toEqual([
            'day:2026-06-18',
            'day:2026-06-19',
        ]);
    });

    it('splits a single interval across a local day boundary and apportions metrics by segment duration', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-19T02:30:00.000Z', 60 * 60 * 1000, 'stopped'),
            ],
            groupBy: 'day',
            timezone: 'America/Argentina/Buenos_Aires',
            shifts: SHIFTS,
        });

        expect(grouped).toHaveLength(2);
        expect(grouped).toMatchObject([
            {
                bucketKey: 'day:2026-06-18',
                durationsMs: {
                    prod: 0,
                    setup: 0,
                    stopped: 30 * 60 * 1000,
                    noData: 0,
                },
                estimatedKwh: 5,
                stopCount: 1,
            },
            {
                bucketKey: 'day:2026-06-19',
                durationsMs: {
                    prod: 0,
                    setup: 0,
                    stopped: 30 * 60 * 1000,
                    noData: 0,
                },
                estimatedKwh: 5,
                stopCount: 0,
            },
        ]);
    });

    it('groups weeks and months with deterministic local calendar keys', () => {
        const intervals = [
            interval('2026-06-15T08:00:00.000Z', 30 * 60 * 1000, 'prod'),
            interval('2026-06-17T08:00:00.000Z', 30 * 60 * 1000, 'setup'),
            interval('2026-06-22T08:00:00.000Z', 30 * 60 * 1000, 'stopped'),
            interval('2026-07-01T08:00:00.000Z', 30 * 60 * 1000, 'prod'),
        ];

        expect(groupActivityAnalyticsIntervals({
            intervals,
            groupBy: 'week',
            timezone: UTC,
            shifts: SHIFTS,
        }).map((bucket) => bucket.bucketKey)).toEqual([
            'week:2026-06-15',
            'week:2026-06-22',
            'week:2026-06-29',
        ]);

        expect(groupActivityAnalyticsIntervals({
            intervals,
            groupBy: 'month',
            timezone: UTC,
            shifts: SHIFTS,
        }).map((bucket) => bucket.bucketKey)).toEqual([
            'month:2026-06',
            'month:2026-07',
        ]);
    });

    it('splits a single interval across a week boundary and assigns the stop transition only once', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-21T23:30:00.000Z', 2 * 60 * 60 * 1000, 'stopped'),
            ],
            groupBy: 'week',
            timezone: UTC,
            shifts: SHIFTS,
        });

        expect(grouped).toHaveLength(2);
        expect(grouped).toMatchObject([
            {
                bucketKey: 'week:2026-06-15',
                durationsMs: {
                    prod: 0,
                    setup: 0,
                    stopped: 30 * 60 * 1000,
                    noData: 0,
                },
                estimatedKwh: 5,
                stopCount: 1,
            },
            {
                bucketKey: 'week:2026-06-22',
                durationsMs: {
                    prod: 0,
                    setup: 0,
                    stopped: 90 * 60 * 1000,
                    noData: 0,
                },
                estimatedKwh: 15,
                stopCount: 0,
            },
        ]);
    });

    it('splits a single interval across a month boundary and apportions metrics by segment duration', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-30T23:30:00.000Z', 90 * 60 * 1000, 'stopped'),
            ],
            groupBy: 'month',
            timezone: UTC,
            shifts: SHIFTS,
        });

        expect(grouped).toHaveLength(2);
        expect(grouped).toMatchObject([
            {
                bucketKey: 'month:2026-06',
                durationsMs: {
                    prod: 0,
                    setup: 0,
                    stopped: 30 * 60 * 1000,
                    noData: 0,
                },
                estimatedKwh: 5,
                stopCount: 1,
            },
            {
                bucketKey: 'month:2026-07',
                durationsMs: {
                    prod: 0,
                    setup: 0,
                    stopped: 60 * 60 * 1000,
                    noData: 0,
                },
                estimatedKwh: 10,
                stopCount: 0,
            },
        ]);
    });

    it('falls back deterministically to America/Argentina/Buenos_Aires only when no global timezone exists', () => {
        const temporalSettings: TemporalSettingsConfig = {
            plantTimezone: null,
            shifts: SHIFTS,
        };

        expect(resolveActivityAnalyticsTimezone({
            temporalSettings,
            windowTimezone: undefined,
        })).toBe('America/Argentina/Buenos_Aires');

        expect(resolveActivityAnalyticsTimezone({
            temporalSettings: {
                ...temporalSettings,
                plantTimezone: 'Europe/Madrid',
            },
            windowTimezone: 'America/Argentina/Buenos_Aires',
        })).toBe('Europe/Madrid');
    });

    it('splits an interval at an overnight shift boundary without duplicating stop transitions', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-18T21:30:00.000Z', 90 * 60 * 1000, 'stopped'),
            ],
            groupBy: 'shift',
            timezone: UTC,
            shifts: SHIFTS,
        });

        expect(grouped).toHaveLength(2);
        expect(grouped).toMatchObject([
            {
                bucketKey: 'shift:shift-b:2026-06-18',
                durationsMs: {
                    prod: 0,
                    setup: 0,
                    stopped: 30 * 60 * 1000,
                    noData: 0,
                },
                estimatedKwh: 5,
                stopCount: 1,
            },
            {
                bucketKey: 'shift:shift-c:2026-06-18',
                durationsMs: {
                    prod: 0,
                    setup: 0,
                    stopped: 60 * 60 * 1000,
                    noData: 0,
                },
                estimatedKwh: 10,
                stopCount: 0,
            },
        ]);
    });

    it('labels shift groups with the local date, keeps friday overnight continuity, and emits sin turno gaps', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-19T23:00:00.000Z', 60 * 60 * 1000, 'prod'),
                interval('2026-06-21T10:00:00.000Z', 30 * 60 * 1000, 'setup'),
            ],
            groupBy: 'shift',
            timezone: UTC,
            shifts: [
                { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00', weekdays: ['fri'] },
            ],
            windowStartMs: Date.parse('2026-06-19T22:00:00.000Z'),
            windowEndMs: Date.parse('2026-06-21T11:00:00.000Z'),
        });

        expect(grouped.map((bucket) => ({ bucketKey: bucket.bucketKey, label: bucket.label }))).toEqual([
            {
                bucketKey: 'shift:shift-c:2026-06-19',
                label: '2026-06-19 · Turno C',
            },
            {
                bucketKey: 'sin-turno:2026-06-20T06:00',
                label: '2026-06-20 · sin turno',
            },
        ]);
        expect(grouped[0]?.expectedDurationMs).toBe(8 * 60 * 60 * 1000);
    });
});
