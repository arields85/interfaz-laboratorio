import { describe, expect, it } from 'vitest';

import type { ShiftDefinition } from '../domain/admin.types';
import {
    computeActivityAnalytics,
} from './activityAnalyticsComputation';

const THRESHOLDS = {
    setupKw: 3,
    prodKw: 8,
} as const;

const SHIFTS: ShiftDefinition[] = [
    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
    { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
];

const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

const DAILY_SHIFTS: ShiftDefinition[] = [
    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: [...ALL_DAYS] },
    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00', weekdays: [...ALL_DAYS] },
    { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00', weekdays: [...ALL_DAYS] },
];

function point(timestamp: string, value: number | null) {
    return {
        timestamp,
        timestampMs: Date.parse(timestamp),
        value,
    };
}

function buildSeries(start: string, count: number, stepMs: number, value: number | null) {
    const startMs = Date.parse(start);

    return Array.from({ length: count }, (_, index) => point(new Date(startMs + (index * stepMs)).toISOString(), value));
}

function mergeSeries(...parts: ReturnType<typeof buildSeries>[]) {
    return parts.reduce<ReturnType<typeof buildSeries>>((merged, series) => {
        if (series.length === 0) {
            return merged;
        }

        const next = [...merged];

        if (next.at(-1)?.timestamp === series[0]?.timestamp) {
            next.pop();
        }

        next.push(...series);

        return next;
    }, []);
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

    it('routes rolling calendar and Turno detail trimming only to the intended preset and group combinations', () => {
        const daySeries = buildSeries('2026-06-11T10:00:00.000Z', 7, 24 * 60 * 60 * 1000, 10);
        const thirtyDaySeries = buildSeries('2026-05-20T10:00:00.000Z', 30, 24 * 60 * 60 * 1000, 10);
        const weekSeries = buildSeries('2026-06-10T12:00:00.000Z', 30, 24 * 60 * 60 * 1000, 10);
        const monthSeries = buildSeries('2025-07-15T00:00:00.000Z', 365, 24 * 60 * 60 * 1000, 10);
        const shiftDetailSeries = buildSeries('2026-06-18T09:00:00.000Z', 25, 60 * 60 * 1000, 10);
        const sevenDayShiftDetailSeries = buildSeries('2026-06-12T09:00:00.000Z', 170, 60 * 60 * 1000, 10);

        const rollingDayResult = computeActivityAnalytics({
            series: daySeries,
            thresholds: THRESHOLDS,
            range: '7d',
            groupBy: 'day',
            shifts: SHIFTS,
            timezone: 'UTC',
            window: {
                start: '2026-06-11T10:00:00.000Z',
                end: '2026-06-18T10:00:00.000Z',
                timezone: 'UTC',
                bucket: '24h',
                bucketMs: 24 * 60 * 60 * 1000,
            },
            nowMs: Date.parse('2026-06-18T10:00:00.000Z'),
        });
        const rollingWeekResult = computeActivityAnalytics({
            series: weekSeries,
            thresholds: THRESHOLDS,
            range: '30d',
            groupBy: 'week',
            shifts: SHIFTS,
            timezone: 'UTC',
            window: {
                start: '2026-06-10T12:00:00.000Z',
                end: '2026-07-10T12:00:00.000Z',
                timezone: 'UTC',
                bucket: '24h',
                bucketMs: 24 * 60 * 60 * 1000,
            },
            nowMs: Date.parse('2026-07-10T12:00:00.000Z'),
        });
        const rollingThirtyDayResult = computeActivityAnalytics({
            series: thirtyDaySeries,
            thresholds: THRESHOLDS,
            range: '30d',
            groupBy: 'day',
            shifts: SHIFTS,
            timezone: 'UTC',
            window: {
                start: '2026-05-20T10:00:00.000Z',
                end: '2026-06-19T10:00:00.000Z',
                timezone: 'UTC',
                bucket: '24h',
                bucketMs: 24 * 60 * 60 * 1000,
            },
            nowMs: Date.parse('2026-06-19T10:00:00.000Z'),
        });
        const rollingMonthResult = computeActivityAnalytics({
            series: monthSeries,
            thresholds: THRESHOLDS,
            range: '12m',
            groupBy: 'month',
            shifts: SHIFTS,
            timezone: 'UTC',
            window: {
                start: '2025-07-15T00:00:00.000Z',
                end: '2026-07-15T00:00:00.000Z',
                timezone: 'UTC',
                bucket: '24h',
                bucketMs: 24 * 60 * 60 * 1000,
            },
            nowMs: Date.parse('2026-07-15T00:00:00.000Z'),
        });
        const customWindowResult = computeActivityAnalytics({
            series: daySeries.slice(0, 2),
            thresholds: THRESHOLDS,
            range: 'custom',
            groupBy: 'day',
            shifts: SHIFTS,
            timezone: 'UTC',
            window: {
                start: '2026-06-11T10:00:00.000Z',
                end: '2026-06-13T10:00:00.000Z',
                timezone: 'UTC',
                bucket: '24h',
                bucketMs: 24 * 60 * 60 * 1000,
            },
            nowMs: Date.parse('2026-06-13T10:00:00.000Z'),
        });
        const negativePresetGroupResult = computeActivityAnalytics({
            series: daySeries,
            thresholds: THRESHOLDS,
            range: '7d',
            groupBy: 'week',
            shifts: SHIFTS,
            timezone: 'UTC',
            window: {
                start: '2026-06-11T10:00:00.000Z',
                end: '2026-06-18T10:00:00.000Z',
                timezone: 'UTC',
                bucket: '24h',
                bucketMs: 24 * 60 * 60 * 1000,
            },
            nowMs: Date.parse('2026-06-18T10:00:00.000Z'),
        });
        const rollingTwentyFourHourShiftResult = computeActivityAnalytics({
            series: shiftDetailSeries,
            thresholds: THRESHOLDS,
            range: '24h',
            groupBy: 'shift',
            shifts: DAILY_SHIFTS,
            timezone: 'UTC',
            window: {
                start: '2026-06-18T09:00:00.000Z',
                end: '2026-06-19T10:00:00.000Z',
                timezone: 'UTC',
                bucket: '1h',
                bucketMs: 60 * 60 * 1000,
            },
            nowMs: Date.parse('2026-06-19T10:00:00.000Z'),
        });
        const rollingSevenDayShiftResult = computeActivityAnalytics({
            series: sevenDayShiftDetailSeries,
            thresholds: THRESHOLDS,
            range: '7d',
            groupBy: 'shift',
            shifts: DAILY_SHIFTS,
            timezone: 'UTC',
            window: {
                start: '2026-06-12T09:00:00.000Z',
                end: '2026-06-19T10:00:00.000Z',
                timezone: 'UTC',
                bucket: '1h',
                bucketMs: 60 * 60 * 1000,
            },
            nowMs: Date.parse('2026-06-19T10:00:00.000Z'),
        });
        const negativeShiftPresetResult = computeActivityAnalytics({
            series: shiftDetailSeries,
            thresholds: THRESHOLDS,
            range: '30d',
            groupBy: 'shift',
            shifts: DAILY_SHIFTS,
            timezone: 'UTC',
            window: {
                start: '2026-06-18T09:00:00.000Z',
                end: '2026-06-19T10:00:00.000Z',
                timezone: 'UTC',
                bucket: '1h',
                bucketMs: 60 * 60 * 1000,
            },
            nowMs: Date.parse('2026-06-19T10:00:00.000Z'),
        });

        expect(rollingDayResult.grouped[0]?.bucketKey).toBe('day:2026-06-12');
        expect(rollingDayResult.grouped.at(-1)).toMatchObject({
            bucketKey: 'day:2026-06-18',
            label: '2026-06-18 (en curso)',
            isInProgress: true,
        });
        expect(rollingThirtyDayResult.grouped[0]?.bucketKey).toBe('day:2026-05-21');
        expect(rollingThirtyDayResult.grouped.at(-1)).toMatchObject({
            bucketKey: 'day:2026-06-19',
            label: '2026-06-19 (en curso)',
            isInProgress: true,
        });
        expect(rollingWeekResult.grouped[0]?.bucketKey).toBe('week:2026-06-15');
        expect(rollingWeekResult.grouped.at(-1)).toMatchObject({
            bucketKey: 'week:2026-07-06',
            label: 'Week 2026-07-06 (en curso)',
            isInProgress: true,
        });
        expect(rollingMonthResult.grouped[0]?.bucketKey).toBe('month:2025-08');
        expect(rollingMonthResult.grouped.at(-1)).toMatchObject({
            bucketKey: 'month:2026-07',
            label: '2026-07 (en curso)',
            isInProgress: true,
        });
        expect(customWindowResult.grouped[0]?.bucketKey).toBe('day:2026-06-11');
        expect(customWindowResult.grouped[0]).toMatchObject({
            bucketKey: 'day:2026-06-11',
            label: '2026-06-11',
            isInProgress: false,
        });
        expect(customWindowResult.grouped.at(-1)).toMatchObject({
            bucketKey: 'day:2026-06-13',
            label: '2026-06-13',
            isInProgress: false,
            productivityLabel: 'cobertura incompleta',
        });
        expect(negativePresetGroupResult.grouped.at(-1)).toMatchObject({
            bucketKey: 'week:2026-06-15',
            label: 'Week 2026-06-15',
            isInProgress: false,
        });
        expect(rollingTwentyFourHourShiftResult.grouped.map((bucket) => bucket.bucketKey)).toEqual([
            'shift:shift-b:2026-06-18',
            'shift:shift-c:2026-06-18',
            'shift:shift-a:2026-06-19',
        ]);
        expect(rollingTwentyFourHourShiftResult.grouped.at(-1)).toMatchObject({
            bucketKey: 'shift:shift-a:2026-06-19',
            label: '2026-06-19 · Turno A (en curso)',
            isInProgress: true,
        });
        expect(rollingSevenDayShiftResult.grouped).toHaveLength(21);
        expect(rollingSevenDayShiftResult.grouped.slice(0, 3).map((bucket) => bucket.bucketKey)).toEqual([
            'shift:shift-b:2026-06-12',
            'shift:shift-c:2026-06-12',
            'shift:shift-a:2026-06-13',
        ]);
        expect(rollingSevenDayShiftResult.grouped.some((bucket) => bucket.bucketKey === 'shift:shift-a:2026-06-12')).toBe(false);
        expect(rollingSevenDayShiftResult.grouped.at(-1)).toMatchObject({
            bucketKey: 'shift:shift-a:2026-06-19',
            label: '2026-06-19 · Turno A (en curso)',
            startMs: Date.parse('2026-06-19T06:00:00.000Z'),
            endMs: Date.parse('2026-06-19T10:00:00.000Z'),
            isInProgress: true,
        });
        expect(negativeShiftPresetResult.grouped[0]).toMatchObject({
            bucketKey: 'shift:shift-a:2026-06-18',
            label: '2026-06-18 · Turno A',
            startMs: Date.parse('2026-06-18T09:00:00.000Z'),
            endMs: Date.parse('2026-06-18T14:00:00.000Z'),
        });
    });

    it('keeps closed incomplete shift productivity on the prior sin datos contract and avoids false-precision rankings on ties', () => {
        const result = computeActivityAnalytics({
            series: [
                point('2026-06-20T22:00:00.000Z', 10),
                point('2026-06-20T23:00:00.000Z', null),
                point('2026-06-21T06:00:00.000Z', 10),
                point('2026-06-23T22:00:00.000Z', 10),
                point('2026-06-24T06:00:00.000Z', 10),
            ],
            thresholds: THRESHOLDS,
            groupBy: 'shift',
            shifts: [{ id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00', weekdays: ['sat', 'mon'] }],
            timezone: 'UTC',
            window: {
                start: '2026-06-20T22:00:00.000Z',
                end: '2026-06-24T06:00:00.000Z',
                timezone: 'UTC',
                bucket: '1h',
                bucketMs: 60 * 60 * 1000,
            },
            nowMs: Date.parse('2026-06-25T00:00:00.000Z'),
        });

        const shiftRows = result.grouped.filter((bucket) => bucket.label.includes('Turno C'));

        expect(shiftRows).toHaveLength(2);
        expect(shiftRows[0]).toMatchObject({
            label: '2026-06-20 · Turno C',
            productivityLabel: 'sin datos',
        });
        expect(result.comparison.best?.label).toBe('sin comparación');
        expect(result.comparison.worst?.label).toBe('sin comparación');
        expect(result.summaryRows.filter((row) => row.label.includes('Turno C')).map((row) => row.label)).toEqual([
            '2026-06-20 · Turno C',
            '2026-06-22 · Turno C',
        ]);
    });

    it('ranks closed high-coverage incomplete Turno buckets by observed productivity through computeActivityAnalytics', () => {
        const twelveMinutesMs = 12 * 60 * 1000;
        const result = computeActivityAnalytics({
            series: mergeSeries(
                buildSeries('2026-06-18T06:00:00.000Z', 36, twelveMinutesMs, 10),
                buildSeries('2026-06-18T13:00:00.000Z', 4, twelveMinutesMs, 5),
                buildSeries('2026-06-18T13:36:00.000Z', 3, twelveMinutesMs, null),
                buildSeries('2026-06-18T14:00:00.000Z', 21, twelveMinutesMs, 10),
                buildSeries('2026-06-18T18:00:00.000Z', 21, twelveMinutesMs, 5),
                buildSeries('2026-06-18T22:00:00.000Z', 2, twelveMinutesMs, 0),
            ),
            thresholds: THRESHOLDS,
            groupBy: 'shift',
            shifts: DAILY_SHIFTS.slice(0, 2),
            timezone: 'UTC',
            window: {
                start: '2026-06-18T06:00:00.000Z',
                end: '2026-06-18T22:00:00.000Z',
                timezone: 'UTC',
                bucket: '12m',
                bucketMs: twelveMinutesMs,
            },
            nowMs: Date.parse('2026-06-18T23:00:00.000Z'),
        });

        expect(result.grouped).toMatchObject([
            {
                bucketKey: 'shift:shift-a:2026-06-18',
                label: '2026-06-18 · Turno A',
                coverageRatio: 0.95,
                productivityRatio: null,
                productivityLabel: 'sin datos',
            },
            {
                bucketKey: 'shift:shift-b:2026-06-18',
                label: '2026-06-18 · Turno B',
                coverageRatio: 1,
                productivityRatio: 0.5,
                productivityLabel: '50%',
            },
        ]);
        expect(result.comparison).toEqual({
            best: { bucketKey: 'shift:shift-a:2026-06-18', label: '2026-06-18 · Turno A' },
            worst: { bucketKey: 'shift:shift-b:2026-06-18', label: '2026-06-18 · Turno B' },
        });
    });

    it('admits only threshold-equal closed Turno coverage to comparisons through computeActivityAnalytics', () => {
        const twelveMinutesMs = 12 * 60 * 1000;
        const compactShifts: ShiftDefinition[] = [
            { id: 'shift-a', label: 'Turno A', start: '06:00', end: '10:00', weekdays: [...ALL_DAYS] },
            { id: 'shift-b', label: 'Turno B', start: '10:00', end: '14:00', weekdays: [...ALL_DAYS] },
            { id: 'shift-c', label: 'Turno C', start: '14:00', end: '18:00', weekdays: [...ALL_DAYS] },
        ];
        const result = computeActivityAnalytics({
            series: mergeSeries(
                buildSeries('2026-06-18T06:00:00.000Z', 18, twelveMinutesMs, 10),
                buildSeries('2026-06-18T09:24:00.000Z', 2, twelveMinutesMs, 5),
                buildSeries('2026-06-18T09:36:00.000Z', 3, twelveMinutesMs, null),
                buildSeries('2026-06-18T10:00:00.000Z', 18, twelveMinutesMs, 10),
                buildSeries('2026-06-18T13:24:00.000Z', 3, twelveMinutesMs, 5),
                buildSeries('2026-06-18T13:48:00.000Z', 2, twelveMinutesMs, null),
                buildSeries('2026-06-18T14:00:00.000Z', 11, twelveMinutesMs, 10),
                buildSeries('2026-06-18T16:00:00.000Z', 11, twelveMinutesMs, 5),
                buildSeries('2026-06-18T18:00:00.000Z', 2, twelveMinutesMs, 0),
            ),
            thresholds: THRESHOLDS,
            groupBy: 'shift',
            shifts: compactShifts,
            timezone: 'UTC',
            window: {
                start: '2026-06-18T06:00:00.000Z',
                end: '2026-06-18T18:00:00.000Z',
                timezone: 'UTC',
                bucket: '12m',
                bucketMs: twelveMinutesMs,
            },
            nowMs: Date.parse('2026-06-18T19:00:00.000Z'),
        });

        expect(result.grouped).toMatchObject([
            {
                bucketKey: 'shift:shift-a:2026-06-18',
                coverageRatio: 0.9,
                productivityRatio: null,
                productivityLabel: 'sin datos',
            },
            {
                bucketKey: 'shift:shift-b:2026-06-18',
                coverageRatio: 0.95,
                productivityRatio: null,
                productivityLabel: 'sin datos',
            },
            {
                bucketKey: 'shift:shift-c:2026-06-18',
                coverageRatio: 1,
                productivityRatio: 0.5,
                productivityLabel: '50%',
            },
        ]);
        expect(result.comparison).toEqual({
            best: { bucketKey: 'shift:shift-b:2026-06-18', label: '2026-06-18 · Turno B' },
            worst: { bucketKey: 'shift:shift-c:2026-06-18', label: '2026-06-18 · Turno C' },
        });
    });

    it('excludes closed incomplete calendar buckets from comparisons through computeActivityAnalytics even at full visible coverage', () => {
        const twoHoursMs = 2 * 60 * 60 * 1000;
        const result = computeActivityAnalytics({
            series: mergeSeries(
                buildSeries('2026-06-17T00:00:00.000Z', 7, twoHoursMs, 10),
                buildSeries('2026-06-17T12:00:00.000Z', 7, twoHoursMs, 5),
                buildSeries('2026-06-18T00:00:00.000Z', 4, twoHoursMs, 10),
                buildSeries('2026-06-18T06:00:00.000Z', 3, twoHoursMs, 5),
                buildSeries('2026-06-18T10:00:00.000Z', 2, twoHoursMs, 0),
            ),
            thresholds: THRESHOLDS,
            groupBy: 'day',
            shifts: DAILY_SHIFTS,
            timezone: 'UTC',
            window: {
                start: '2026-06-17T00:00:00.000Z',
                end: '2026-06-18T10:00:00.000Z',
                timezone: 'UTC',
                bucket: '2h',
                bucketMs: twoHoursMs,
            },
            nowMs: Date.parse('2026-06-19T00:00:00.000Z'),
        });

        expect(result.grouped).toMatchObject([
            {
                bucketKey: 'day:2026-06-17',
                label: '2026-06-17',
                coverageRatio: 1,
                productivityRatio: 0.5,
                productivityLabel: '50%',
            },
            {
                bucketKey: 'day:2026-06-18',
                label: '2026-06-18',
                coverageRatio: 1,
                productivityRatio: null,
                productivityLabel: 'cobertura incompleta',
            },
        ]);
        expect(result.comparison).toEqual({
            best: { bucketKey: 'best', label: 'sin comparación' },
            worst: { bucketKey: 'worst', label: 'sin comparación' },
        });
    });

    it('excludes in-progress calendar buckets from best and worst comparisons', () => {
        const result = computeActivityAnalytics({
            series: [
                point('2026-06-17T00:00:00.000Z', 10),
                point('2026-06-18T00:00:00.000Z', 10),
                point('2026-06-18T12:00:00.000Z', null),
            ],
            thresholds: THRESHOLDS,
            range: '7d',
            groupBy: 'day',
            shifts: SHIFTS,
            timezone: 'UTC',
            window: {
                start: '2026-06-17T00:00:00.000Z',
                end: '2026-06-18T18:00:00.000Z',
                timezone: 'UTC',
                bucket: '12h',
                bucketMs: 12 * 60 * 60 * 1000,
            },
            nowMs: Date.parse('2026-06-18T18:00:00.000Z'),
        });

        expect(result.grouped.some((bucket) => bucket.label === '2026-06-18 (en curso)' && bucket.isInProgress && bucket.productivityRatio === null)).toBe(true);
        expect(result.grouped.find((bucket) => bucket.label === '2026-06-17')?.productivityRatio).not.toBeNull();
        expect(result.grouped.find((bucket) => bucket.label === '2026-06-18 (en curso)')).toMatchObject({
            label: '2026-06-18 (en curso)',
            isInProgress: true,
            productivityRatio: null,
            productivityLabel: 'en curso',
        });
        expect(result.comparison.best?.label).not.toBe('2026-06-18 (en curso)');
        expect(result.comparison.worst?.label).not.toBe('2026-06-18 (en curso)');
    });
});
