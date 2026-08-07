import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ShiftDefinition, TemporalSettingsConfig } from '../domain/admin.types';
import type { ActivityAnalyticsInterval } from './activityAnalytics';
import {
    groupActivityAnalyticsIntervals,
    resolveActivityAnalyticsTimezone,
} from './activityAnalyticsGrouping';

const UTC = 'UTC';
const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

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
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('constructs one timezone formatter for a calendar grouping invocation', () => {
        const NativeDateTimeFormat = Intl.DateTimeFormat;
        const formatToPartsSpy = vi.fn((formatter: Intl.DateTimeFormat, value?: Date | number) => (
            formatter.formatToParts(value)
        ));
        function DateTimeFormatMock(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
            const formatter = new NativeDateTimeFormat(locales, options);

            return {
                formatToParts: (value?: Date | number) => formatToPartsSpy(formatter, value),
            } as Intl.DateTimeFormat;
        }
        const formatterSpy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(DateTimeFormatMock);
        const startMs = Date.parse('2026-06-18T00:00:00.000Z');

        groupActivityAnalyticsIntervals({
            intervals: Array.from({ length: 48 }, (_, index) => (
                interval(new Date(startMs + (index * 30 * 60 * 1000)).toISOString(), 30 * 60 * 1000, 'prod')
            )),
            groupBy: 'day',
            timezone: UTC,
            shifts: SHIFTS,
            nowMs: Date.parse('2026-06-20T00:00:00.000Z'),
        });

        expect(formatterSpy).toHaveBeenCalledTimes(1);
        expect(formatToPartsSpy).toHaveBeenCalledTimes(3);
    });

    it('constructs one shared timezone formatter for a top-level shift grouping invocation', () => {
        const NativeDateTimeFormat = Intl.DateTimeFormat;
        function DateTimeFormatMock(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
            return new NativeDateTimeFormat(locales, options);
        }
        const formatterSpy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(DateTimeFormatMock);
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-18T22:30:00.000Z', 30 * 60 * 1000, 'prod'),
                interval('2026-06-19T01:30:00.000Z', 30 * 60 * 1000, 'setup'),
            ],
            groupBy: 'shift',
            timezone: UTC,
            shifts: SHIFTS,
            nowMs: Date.parse('2026-06-20T00:00:00.000Z'),
        });

        expect(formatterSpy).toHaveBeenCalledTimes(1);
        expect(grouped).toMatchObject([{
            bucketKey: 'shift:shift-c:2026-06-18',
            label: '18/06 · Turno C',
            durationsMs: {
                prod: 30 * 60 * 1000,
                setup: 30 * 60 * 1000,
                stopped: 0,
                noData: 0,
            },
        }]);
    });

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
            label: '18/06 · Turno C',
            durationsMs: {
                prod: 30 * 60 * 1000,
                setup: 30 * 60 * 1000,
                stopped: 0,
                noData: 0,
            },
        });
    });

    it('sweeps one interval across multiple exact shift boundaries and assigns its stop once', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [interval('2026-06-18T13:00:00.000Z', 18 * 60 * 60 * 1000, 'stopped')],
            groupBy: 'shift',
            timezone: UTC,
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: ALL_DAYS },
                { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00', weekdays: ALL_DAYS },
                { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00', weekdays: ALL_DAYS },
            ],
            nowMs: Date.parse('2026-06-20T00:00:00.000Z'),
        });

        expect(grouped.map((bucket) => ({
            bucketKey: bucket.bucketKey,
            stopped: bucket.durationsMs.stopped,
            estimatedKwh: bucket.estimatedKwh,
            stopCount: bucket.stopCount,
        }))).toEqual([
            { bucketKey: 'shift:shift-a:2026-06-18', stopped: 60 * 60 * 1000, estimatedKwh: 10, stopCount: 1 },
            { bucketKey: 'shift:shift-b:2026-06-18', stopped: 8 * 60 * 60 * 1000, estimatedKwh: 80, stopCount: 0 },
            { bucketKey: 'shift:shift-c:2026-06-18', stopped: 8 * 60 * 60 * 1000, estimatedKwh: 80, stopCount: 0 },
            { bucketKey: 'shift:shift-a:2026-06-19', stopped: 60 * 60 * 1000, estimatedKwh: 10, stopCount: 0 },
        ]);
    });

    it('preserves unordered overlapping interval contributions across a shift boundary', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-18T14:00:00.000Z', 30 * 60 * 1000, 'stopped'),
                interval('2026-06-18T13:00:00.000Z', 2 * 60 * 60 * 1000, 'prod'),
                interval('2026-06-18T13:30:00.000Z', 60 * 60 * 1000, 'setup'),
            ],
            groupBy: 'shift',
            timezone: UTC,
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: ALL_DAYS },
                { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00', weekdays: ALL_DAYS },
            ],
            nowMs: Date.parse('2026-06-20T00:00:00.000Z'),
        });

        expect(grouped).toMatchObject([
            {
                bucketKey: 'shift:shift-a:2026-06-18',
                durationsMs: {
                    prod: 60 * 60 * 1000,
                    setup: 30 * 60 * 1000,
                    stopped: 0,
                    noData: 0,
                },
                estimatedKwh: 15,
                stopCount: 0,
            },
            {
                bucketKey: 'shift:shift-b:2026-06-18',
                durationsMs: {
                    prod: 60 * 60 * 1000,
                    setup: 30 * 60 * 1000,
                    stopped: 30 * 60 * 1000,
                    noData: 0,
                },
                estimatedKwh: 20,
                stopCount: 1,
            },
        ]);
    });

    it('preserves top-level shift durations across DST forward and backward', () => {
        const shifts: ShiftDefinition[] = [
            { id: 'shift-dst', label: 'Turno DST', start: '00:00', end: '04:00', weekdays: ['sun'] },
        ];
        const springForward = groupActivityAnalyticsIntervals({
            intervals: [interval('2026-03-08T05:00:00.000Z', 3 * 60 * 60 * 1000, 'prod')],
            groupBy: 'shift',
            timezone: 'America/New_York',
            shifts,
            nowMs: Date.parse('2026-03-09T12:00:00.000Z'),
        });
        const fallBackward = groupActivityAnalyticsIntervals({
            intervals: [interval('2026-11-01T04:00:00.000Z', 5 * 60 * 60 * 1000, 'setup')],
            groupBy: 'shift',
            timezone: 'America/New_York',
            shifts,
            nowMs: Date.parse('2026-11-02T12:00:00.000Z'),
        });

        expect(springForward).toMatchObject([{
            bucketKey: 'shift:shift-dst:2026-03-08',
            expectedDurationMs: 3 * 60 * 60 * 1000,
            durationsMs: { prod: 3 * 60 * 60 * 1000 },
        }]);
        expect(fallBackward).toMatchObject([{
            bucketKey: 'shift:shift-dst:2026-11-01',
            expectedDurationMs: 5 * 60 * 60 * 1000,
            durationsMs: { setup: 5 * 60 * 60 * 1000 },
        }]);
    });

    it('keeps shift grouping clipped to the visible slice while preserving the semantic current-shift state', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-18T06:00:00.000Z', 2 * 60 * 60 * 1000, 'prod'),
            ],
            groupBy: 'shift',
            timezone: UTC,
            shifts: SHIFTS,
            windowStartMs: Date.parse('2026-06-18T06:00:00.000Z'),
            windowEndMs: Date.parse('2026-06-18T08:00:00.000Z'),
            nowMs: Date.parse('2026-06-18T09:00:00.000Z'),
        });

        expect(grouped).toHaveLength(1);
        expect(grouped[0]).toMatchObject({
            bucketKey: 'shift:shift-a:2026-06-18',
            label: '18/06 · Turno A (en curso)',
            expectedDurationMs: 8 * 60 * 60 * 1000,
            isInProgress: true,
            durationsMs: {
                prod: 2 * 60 * 60 * 1000,
                setup: 0,
                stopped: 0,
                noData: 0,
            },
            productivityRatio: null,
            productivityLabel: 'en curso',
        });
    });

    it('keeps closed incomplete shift buckets on the prior sin datos contract', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-18T06:00:00.000Z', 2 * 60 * 60 * 1000, 'prod'),
            ],
            groupBy: 'shift',
            timezone: UTC,
            shifts: SHIFTS,
            windowStartMs: Date.parse('2026-06-18T06:00:00.000Z'),
            windowEndMs: Date.parse('2026-06-18T14:00:00.000Z'),
            nowMs: Date.parse('2026-06-18T15:00:00.000Z'),
        });

        expect(grouped).toHaveLength(1);
        expect(grouped[0]).toMatchObject({
            bucketKey: 'shift:shift-a:2026-06-18',
            label: '18/06 · Turno A',
            isInProgress: false,
            coverageRatio: 0.25,
            productivityRatio: null,
            productivityLabel: 'sin datos',
        });
    });

    it('keeps overnight shift labels and expected duration clipped to the visible shift slice', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-19T01:30:00.000Z', 30 * 60 * 1000, 'prod'),
            ],
            groupBy: 'shift',
            timezone: UTC,
            shifts: SHIFTS,
            windowStartMs: Date.parse('2026-06-19T00:30:00.000Z'),
            windowEndMs: Date.parse('2026-06-19T03:00:00.000Z'),
            nowMs: Date.parse('2026-06-19T01:45:00.000Z'),
        });

        expect(grouped).toHaveLength(1);
        expect(grouped[0]).toMatchObject({
            bucketKey: 'shift:shift-c:2026-06-18',
            label: '19/06 · Turno C (en curso)',
            startMs: Date.parse('2026-06-19T00:30:00.000Z'),
            endMs: Date.parse('2026-06-19T03:00:00.000Z'),
            expectedDurationMs: 8 * 60 * 60 * 1000,
            isInProgress: true,
        });
    });

    it('keeps the current shift in progress when the runtime clock passes the visible window end but remains inside the semantic shift', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-18T06:00:00.000Z', 2 * 60 * 60 * 1000, 'prod'),
            ],
            groupBy: 'shift',
            timezone: UTC,
            shifts: [{ id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }],
            windowStartMs: Date.parse('2026-06-18T06:00:00.000Z'),
            windowEndMs: Date.parse('2026-06-18T08:00:00.000Z'),
            nowMs: Date.parse('2026-06-18T09:00:00.000Z'),
        });

        expect(grouped).toHaveLength(1);
        expect(grouped[0]).toMatchObject({
            bucketKey: 'shift:shift-a:2026-06-18',
            label: '18/06 · Turno A (en curso)',
            startMs: Date.parse('2026-06-18T06:00:00.000Z'),
            endMs: Date.parse('2026-06-18T08:00:00.000Z'),
            expectedDurationMs: 8 * 60 * 60 * 1000,
            isInProgress: true,
            productivityRatio: null,
            productivityLabel: 'en curso',
        });
    });

    it('drops the clipped leading shift bucket for rolling Turno detail while keeping only the trailing current shift partial', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-18T09:00:00.000Z', 25 * 60 * 60 * 1000, 'prod'),
            ],
            groupBy: 'shift',
            timezone: UTC,
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
                { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
                { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
            ],
            windowStartMs: Date.parse('2026-06-18T09:00:00.000Z'),
            windowEndMs: Date.parse('2026-06-19T10:00:00.000Z'),
            nowMs: Date.parse('2026-06-19T10:00:00.000Z'),
            trimLeadingPartialShiftBucket: true,
        });

        expect(grouped.map((bucket) => bucket.bucketKey)).toEqual([
            'shift:shift-b:2026-06-18',
            'shift:shift-c:2026-06-18',
            'shift:shift-a:2026-06-19',
        ]);
        expect(grouped[0]).toMatchObject({
            bucketKey: 'shift:shift-b:2026-06-18',
            label: '18/06 · Turno B',
            startMs: Date.parse('2026-06-18T14:00:00.000Z'),
            endMs: Date.parse('2026-06-18T22:00:00.000Z'),
            isInProgress: false,
        });
        expect(grouped.at(-1)).toMatchObject({
            bucketKey: 'shift:shift-a:2026-06-19',
            label: '19/06 · Turno A (en curso)',
            startMs: Date.parse('2026-06-19T06:00:00.000Z'),
            endMs: Date.parse('2026-06-19T10:00:00.000Z'),
            isInProgress: true,
        });
    });

    it('preserves the clipped leading shift bucket when Turno rolling trimming is disabled', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-18T09:00:00.000Z', 25 * 60 * 60 * 1000, 'prod'),
            ],
            groupBy: 'shift',
            timezone: UTC,
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
                { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
                { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
            ],
            windowStartMs: Date.parse('2026-06-18T09:00:00.000Z'),
            windowEndMs: Date.parse('2026-06-19T10:00:00.000Z'),
            nowMs: Date.parse('2026-06-19T10:00:00.000Z'),
        });

        expect(grouped[0]).toMatchObject({
            bucketKey: 'shift:shift-a:2026-06-18',
            label: '18/06 · Turno A',
            startMs: Date.parse('2026-06-18T09:00:00.000Z'),
            endMs: Date.parse('2026-06-18T14:00:00.000Z'),
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
            nowMs: Date.parse('2026-08-01T00:00:00.000Z'),
        });

        expect(grouped).toHaveLength(2);
        expect(grouped).toMatchObject([
            {
                bucketKey: 'day:2026-06-18',
                durationsMs: {
                    prod: 0,
                    setup: 0,
                    stopped: 30 * 60 * 1000,
                    noData: (24 * 60 * 60 * 1000) - (30 * 60 * 1000),
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
                    noData: (24 * 60 * 60 * 1000) - (30 * 60 * 1000),
                },
                estimatedKwh: 5,
                stopCount: 0,
            },
        ]);
    });

    it('preserves 23-hour and 25-hour local days across DST transitions', () => {
        const springForward = groupActivityAnalyticsIntervals({
            intervals: [interval('2026-03-08T05:00:00.000Z', 23 * 60 * 60 * 1000, 'prod')],
            groupBy: 'day',
            timezone: 'America/New_York',
            shifts: SHIFTS,
            nowMs: Date.parse('2026-03-10T00:00:00.000Z'),
        });
        const fallBackward = groupActivityAnalyticsIntervals({
            intervals: [interval('2026-11-01T04:00:00.000Z', 25 * 60 * 60 * 1000, 'prod')],
            groupBy: 'day',
            timezone: 'America/New_York',
            shifts: SHIFTS,
            nowMs: Date.parse('2026-11-03T00:00:00.000Z'),
        });

        expect(springForward).toMatchObject([{
            bucketKey: 'day:2026-03-08',
            startMs: Date.parse('2026-03-08T05:00:00.000Z'),
            endMs: Date.parse('2026-03-09T04:00:00.000Z'),
            expectedDurationMs: 23 * 60 * 60 * 1000,
            durationsMs: { prod: 23 * 60 * 60 * 1000, setup: 0, stopped: 0, noData: 0 },
            coverageRatio: 1,
            productivityRatio: 1,
        }]);
        expect(fallBackward).toMatchObject([{
            bucketKey: 'day:2026-11-01',
            startMs: Date.parse('2026-11-01T04:00:00.000Z'),
            endMs: Date.parse('2026-11-02T05:00:00.000Z'),
            expectedDurationMs: 25 * 60 * 60 * 1000,
            durationsMs: { prod: 25 * 60 * 60 * 1000, setup: 0, stopped: 0, noData: 0 },
            coverageRatio: 1,
            productivityRatio: 1,
        }]);
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

    it('sorts calendar input and preserves duplicate contributions deterministically', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-19T01:00:00.000Z', 60 * 60 * 1000, 'setup'),
                interval('2026-06-18T01:00:00.000Z', 60 * 60 * 1000, 'prod'),
                interval('2026-06-18T01:00:00.000Z', 60 * 60 * 1000, 'prod'),
            ],
            groupBy: 'day',
            timezone: UTC,
            shifts: SHIFTS,
            nowMs: Date.parse('2026-06-21T00:00:00.000Z'),
        });

        expect(grouped).toMatchObject([
            {
                bucketKey: 'day:2026-06-18',
                durationsMs: { prod: 2 * 60 * 60 * 1000, setup: 0, stopped: 0, noData: 22 * 60 * 60 * 1000 },
                estimatedKwh: 20,
                stopCount: 0,
            },
            {
                bucketKey: 'day:2026-06-19',
                durationsMs: { prod: 0, setup: 60 * 60 * 1000, stopped: 0, noData: 23 * 60 * 60 * 1000 },
                estimatedKwh: 10,
                stopCount: 0,
            },
        ]);
    });

    it('formats compact display labels for day, week, month, and shift buckets without changing semantic keys', () => {
        const dayBuckets = groupActivityAnalyticsIntervals({
            intervals: [interval('2026-06-18T08:00:00.000Z', 30 * 60 * 1000, 'prod')],
            groupBy: 'day',
            timezone: UTC,
            shifts: SHIFTS,
            nowMs: Date.parse('2026-08-01T00:00:00.000Z'),
        });

        const weekBuckets = groupActivityAnalyticsIntervals({
            intervals: [interval('2026-06-18T08:00:00.000Z', 30 * 60 * 1000, 'prod')],
            groupBy: 'week',
            timezone: UTC,
            shifts: SHIFTS,
            nowMs: Date.parse('2026-08-01T00:00:00.000Z'),
        });

        const monthBuckets = groupActivityAnalyticsIntervals({
            intervals: [interval('2026-06-18T08:00:00.000Z', 30 * 60 * 1000, 'prod')],
            groupBy: 'month',
            timezone: UTC,
            shifts: SHIFTS,
            nowMs: Date.parse('2026-08-01T00:00:00.000Z'),
        });

        const shiftBuckets = groupActivityAnalyticsIntervals({
            intervals: [interval('2026-06-18T06:30:00.000Z', 30 * 60 * 1000, 'prod')],
            groupBy: 'shift',
            timezone: UTC,
            shifts: SHIFTS,
            nowMs: Date.parse('2026-08-01T00:00:00.000Z'),
        });

        expect(dayBuckets[0]).toMatchObject({ bucketKey: 'day:2026-06-18', label: '18/06' });
        expect(weekBuckets[0]).toMatchObject({ bucketKey: 'week:2026-06-15', label: '15/06' });
        expect(monthBuckets[0]).toMatchObject({ bucketKey: 'month:2026-06', label: 'jun 26' });
        expect(shiftBuckets[0]).toMatchObject({ bucketKey: 'shift:shift-a:2026-06-18', label: '18/06 · Turno A' });
    });

    it('splits a single interval across a week boundary and assigns the stop transition only once', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-21T23:30:00.000Z', 2 * 60 * 60 * 1000, 'stopped'),
            ],
            groupBy: 'week',
            timezone: UTC,
            shifts: SHIFTS,
            nowMs: Date.parse('2026-08-01T00:00:00.000Z'),
        });

        expect(grouped).toHaveLength(2);
        expect(grouped).toMatchObject([
            {
                bucketKey: 'week:2026-06-15',
                durationsMs: {
                    prod: 0,
                    setup: 0,
                    stopped: 30 * 60 * 1000,
                    noData: (7 * 24 * 60 * 60 * 1000) - (30 * 60 * 1000),
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
                    noData: (7 * 24 * 60 * 60 * 1000) - (90 * 60 * 1000),
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
            nowMs: Date.parse('2026-08-01T00:00:00.000Z'),
        });

        expect(grouped).toHaveLength(2);
        expect(grouped).toMatchObject([
            {
                bucketKey: 'month:2026-06',
                durationsMs: {
                    prod: 0,
                    setup: 0,
                    stopped: 30 * 60 * 1000,
                    noData: (30 * 24 * 60 * 60 * 1000) - (30 * 60 * 1000),
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
                    noData: (31 * 24 * 60 * 60 * 1000) - (60 * 60 * 1000),
                },
                estimatedKwh: 10,
                stopCount: 0,
            },
        ]);
    });

    it('splits a month bucket across the year boundary without changing labels or stop attribution', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [interval('2026-12-31T23:30:00.000Z', 90 * 60 * 1000, 'stopped')],
            groupBy: 'month',
            timezone: UTC,
            shifts: SHIFTS,
            nowMs: Date.parse('2027-02-01T00:00:00.000Z'),
        });

        expect(grouped).toMatchObject([
            {
                bucketKey: 'month:2026-12',
                label: 'dic 26',
                durationsMs: { stopped: 30 * 60 * 1000 },
                estimatedKwh: 5,
                stopCount: 1,
            },
            {
                bucketKey: 'month:2027-01',
                label: 'ene 27',
                durationsMs: { stopped: 60 * 60 * 1000 },
                estimatedKwh: 10,
                stopCount: 0,
            },
        ]);
    });

    it('labels closed incomplete calendar buckets as cobertura incompleta while filling the missing duration with noData', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-18T06:00:00.000Z', 6 * 60 * 60 * 1000, 'prod'),
                interval('2026-06-18T12:00:00.000Z', 3 * 60 * 60 * 1000, 'setup'),
            ],
            groupBy: 'day',
            timezone: UTC,
            shifts: SHIFTS,
            windowStartMs: Date.parse('2026-06-18T00:00:00.000Z'),
            windowEndMs: Date.parse('2026-06-19T00:00:00.000Z'),
            nowMs: Date.parse('2026-06-20T00:00:00.000Z'),
        });

        expect(grouped).toHaveLength(1);
        expect(grouped[0]).toMatchObject({
            bucketKey: 'day:2026-06-18',
            expectedDurationMs: 24 * 60 * 60 * 1000,
            isInProgress: false,
            durationsMs: {
                prod: 6 * 60 * 60 * 1000,
                setup: 3 * 60 * 60 * 1000,
                stopped: 0,
                noData: 15 * 60 * 60 * 1000,
            },
            productivityRatio: null,
            productivityLabel: 'cobertura incompleta',
        });
    });

    it('clips calendar noData backfill to the visible window start while preserving telemetry gaps inside the visible slice', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-18T12:00:00.000Z', 60 * 60 * 1000, 'prod'),
                interval('2026-06-18T13:00:00.000Z', 2 * 60 * 60 * 1000, 'no-data'),
            ],
            groupBy: 'day',
            timezone: UTC,
            shifts: SHIFTS,
            windowStartMs: Date.parse('2026-06-18T12:00:00.000Z'),
            windowEndMs: Date.parse('2026-06-19T00:00:00.000Z'),
            nowMs: Date.parse('2026-06-20T00:00:00.000Z'),
        });

        expect(grouped).toHaveLength(1);
        expect(grouped[0]).toMatchObject({
            bucketKey: 'day:2026-06-18',
            isInProgress: false,
            durationsMs: {
                prod: 60 * 60 * 1000,
                setup: 0,
                stopped: 0,
                noData: 11 * 60 * 60 * 1000,
            },
            coverageRatio: 1 / 12,
            productivityRatio: null,
            productivityLabel: 'cobertura incompleta',
        });
    });

    it('marks open calendar buckets as in progress and only fills elapsed time', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-18T00:00:00.000Z', 4 * 60 * 60 * 1000, 'prod'),
                interval('2026-06-18T04:00:00.000Z', 2 * 60 * 60 * 1000, 'setup'),
            ],
            groupBy: 'day',
            timezone: UTC,
            shifts: SHIFTS,
            windowStartMs: Date.parse('2026-06-18T00:00:00.000Z'),
            windowEndMs: Date.parse('2026-06-18T10:00:00.000Z'),
            nowMs: Date.parse('2026-06-18T10:00:00.000Z'),
            markTrailingCurrentBucketInProgress: true,
        });

        expect(grouped).toHaveLength(1);
        expect(grouped[0]).toMatchObject({
            bucketKey: 'day:2026-06-18',
            label: '18/06 (en curso)',
            expectedDurationMs: 24 * 60 * 60 * 1000,
            isInProgress: true,
            durationsMs: {
                prod: 4 * 60 * 60 * 1000,
                setup: 2 * 60 * 60 * 1000,
                stopped: 0,
                noData: 4 * 60 * 60 * 1000,
            },
            coverageRatio: 0.6,
            productivityRatio: null,
            productivityLabel: 'en curso',
        });
    });

    it('keeps the current calendar bucket in progress when the rolling window end lags the client clock slightly', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-18T00:00:00.000Z', 4 * 60 * 60 * 1000, 'prod'),
                interval('2026-06-18T04:00:00.000Z', 6 * 60 * 60 * 1000, 'setup'),
            ],
            groupBy: 'day',
            timezone: UTC,
            shifts: SHIFTS,
            windowStartMs: Date.parse('2026-06-18T00:00:00.000Z'),
            windowEndMs: Date.parse('2026-06-18T10:00:00.000Z'),
            nowMs: Date.parse('2026-06-18T10:05:00.000Z'),
            markTrailingCurrentBucketInProgress: true,
        });

        expect(grouped).toHaveLength(1);
        expect(grouped[0]).toMatchObject({
            bucketKey: 'day:2026-06-18',
            label: '18/06 (en curso)',
            isInProgress: true,
            durationsMs: {
                prod: 4 * 60 * 60 * 1000,
                setup: 6 * 60 * 60 * 1000,
                stopped: 0,
                noData: 0,
            },
            coverageRatio: 1,
            productivityRatio: null,
            productivityLabel: 'en curso',
        });
    });

    it('keeps the current calendar bucket in progress at exactly the 15-minute lag boundary', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-18T00:00:00.000Z', 4 * 60 * 60 * 1000, 'prod'),
                interval('2026-06-18T04:00:00.000Z', 6 * 60 * 60 * 1000, 'setup'),
            ],
            groupBy: 'day',
            timezone: UTC,
            shifts: SHIFTS,
            windowStartMs: Date.parse('2026-06-18T00:00:00.000Z'),
            windowEndMs: Date.parse('2026-06-18T10:00:00.000Z'),
            nowMs: Date.parse('2026-06-18T10:15:00.000Z'),
            markTrailingCurrentBucketInProgress: true,
        });

        expect(grouped).toHaveLength(1);
        expect(grouped[0]).toMatchObject({
            bucketKey: 'day:2026-06-18',
            label: '18/06 (en curso)',
            isInProgress: true,
            productivityRatio: null,
            productivityLabel: 'en curso',
        });
    });

    it('closes the current calendar bucket once the rolling window end lags by more than 15 minutes', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-18T00:00:00.000Z', 4 * 60 * 60 * 1000, 'prod'),
                interval('2026-06-18T04:00:00.000Z', 6 * 60 * 60 * 1000, 'setup'),
            ],
            groupBy: 'day',
            timezone: UTC,
            shifts: SHIFTS,
            windowStartMs: Date.parse('2026-06-18T00:00:00.000Z'),
            windowEndMs: Date.parse('2026-06-18T10:00:00.000Z'),
            nowMs: Date.parse('2026-06-18T10:15:00.001Z'),
            markTrailingCurrentBucketInProgress: true,
        });

        expect(grouped).toHaveLength(1);
        expect(grouped[0]).toMatchObject({
            bucketKey: 'day:2026-06-18',
            label: '18/06',
            isInProgress: false,
            productivityRatio: null,
            productivityLabel: 'cobertura incompleta',
        });
    });

    it('drops the clipped leading bucket from rolling 7d Día windows while keeping the current day in progress', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-11T10:00:00.000Z', 7 * 24 * 60 * 60 * 1000, 'prod'),
            ],
            groupBy: 'day',
            timezone: UTC,
            shifts: SHIFTS,
            windowStartMs: Date.parse('2026-06-11T10:00:00.000Z'),
            windowEndMs: Date.parse('2026-06-18T10:00:00.000Z'),
            nowMs: Date.parse('2026-06-18T10:00:00.000Z'),
            trimLeadingPartialBucket: true,
            markTrailingCurrentBucketInProgress: true,
        });

        expect(grouped.map((bucket) => bucket.bucketKey)).toEqual([
            'day:2026-06-12',
            'day:2026-06-13',
            'day:2026-06-14',
            'day:2026-06-15',
            'day:2026-06-16',
            'day:2026-06-17',
            'day:2026-06-18',
        ]);
        expect(grouped.at(-1)).toMatchObject({
            bucketKey: 'day:2026-06-18',
            label: '18/06 (en curso)',
            isInProgress: true,
            productivityLabel: 'en curso',
        });
    });

    it('drops the clipped leading bucket from rolling 30d Semana windows while keeping the current week in progress', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-10T12:00:00.000Z', 30 * 24 * 60 * 60 * 1000, 'prod'),
            ],
            groupBy: 'week',
            timezone: UTC,
            shifts: SHIFTS,
            windowStartMs: Date.parse('2026-06-10T12:00:00.000Z'),
            windowEndMs: Date.parse('2026-07-10T12:00:00.000Z'),
            nowMs: Date.parse('2026-07-10T12:00:00.000Z'),
            trimLeadingPartialBucket: true,
            markTrailingCurrentBucketInProgress: true,
        });

        expect(grouped.map((bucket) => bucket.bucketKey)).toEqual([
            'week:2026-06-15',
            'week:2026-06-22',
            'week:2026-06-29',
            'week:2026-07-06',
        ]);
        expect(grouped.at(-1)).toMatchObject({
            bucketKey: 'week:2026-07-06',
            label: '06/07 (en curso)',
            isInProgress: true,
            productivityLabel: 'en curso',
        });
    });

    it('drops the clipped leading bucket from rolling 12m Mes windows while keeping the current month in progress', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2025-07-15T00:00:00.000Z', 365 * 24 * 60 * 60 * 1000, 'prod'),
            ],
            groupBy: 'month',
            timezone: UTC,
            shifts: SHIFTS,
            windowStartMs: Date.parse('2025-07-15T00:00:00.000Z'),
            windowEndMs: Date.parse('2026-07-15T00:00:00.000Z'),
            nowMs: Date.parse('2026-07-15T00:00:00.000Z'),
            trimLeadingPartialBucket: true,
            markTrailingCurrentBucketInProgress: true,
        });

        expect(grouped.map((bucket) => bucket.bucketKey)).toEqual([
            'month:2025-08',
            'month:2025-09',
            'month:2025-10',
            'month:2025-11',
            'month:2025-12',
            'month:2026-01',
            'month:2026-02',
            'month:2026-03',
            'month:2026-04',
            'month:2026-05',
            'month:2026-06',
            'month:2026-07',
        ]);
        expect(grouped.at(-1)).toMatchObject({
            bucketKey: 'month:2026-07',
            label: 'jul 26 (en curso)',
            isInProgress: true,
            productivityLabel: 'en curso',
        });
    });

    it('does not mark calendar buckets as in progress after the selected window already ended inside the same bucket', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-18T00:00:00.000Z', 4 * 60 * 60 * 1000, 'prod'),
                interval('2026-06-18T04:00:00.000Z', 6 * 60 * 60 * 1000, 'setup'),
            ],
            groupBy: 'day',
            timezone: UTC,
            shifts: SHIFTS,
            windowStartMs: Date.parse('2026-06-18T00:00:00.000Z'),
            windowEndMs: Date.parse('2026-06-18T10:00:00.000Z'),
            nowMs: Date.parse('2026-06-18T18:00:00.000Z'),
            markTrailingCurrentBucketInProgress: true,
        });

        expect(grouped).toHaveLength(1);
        expect(grouped[0]).toMatchObject({
            bucketKey: 'day:2026-06-18',
            label: '18/06',
            isInProgress: false,
            durationsMs: {
                prod: 4 * 60 * 60 * 1000,
                setup: 6 * 60 * 60 * 1000,
                stopped: 0,
                noData: 0,
            },
            coverageRatio: 1,
            productivityRatio: null,
            productivityLabel: 'cobertura incompleta',
        });
    });

    it('keeps the leading clipped bucket for custom mid-bucket calendar windows', () => {
        const grouped = groupActivityAnalyticsIntervals({
            intervals: [
                interval('2026-06-11T10:00:00.000Z', 48 * 60 * 60 * 1000, 'prod'),
            ],
            groupBy: 'day',
            timezone: UTC,
            shifts: SHIFTS,
            windowStartMs: Date.parse('2026-06-11T10:00:00.000Z'),
            windowEndMs: Date.parse('2026-06-13T10:00:00.000Z'),
            nowMs: Date.parse('2026-06-13T10:00:00.000Z'),
        });

        expect(grouped.map((bucket) => bucket.bucketKey)).toEqual([
            'day:2026-06-11',
            'day:2026-06-12',
            'day:2026-06-13',
        ]);
        expect(grouped[0]).toMatchObject({
            bucketKey: 'day:2026-06-11',
            label: '11/06',
            isInProgress: false,
        });
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
                label: '19/06 · Turno C',
            },
            {
                bucketKey: 'sin-turno:2026-06-20T06:00',
                label: '20/06 · sin turno',
            },
        ]);
        expect(grouped[0]?.expectedDurationMs).toBe(8 * 60 * 60 * 1000);
    });
});
