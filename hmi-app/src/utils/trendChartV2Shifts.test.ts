import { describe, expect, it } from 'vitest';

import type { HistoryDataPointV2 } from '../domain/dataContract.types';
import type { ShiftDefinition } from '../domain/admin.types';
import {
    buildTrendChartV2ShiftIntervals,
    buildTrendChartV2VisibleShiftSummary,
    type TrendChartV2VisibleShiftSummary,
    resolveTrendChartV2ShiftDisplayMode,
    resolveTrendChartV2TooltipShiftLabel,
} from './trendChartV2Shifts';

const UTC = 'UTC';

const SHIFTS: ShiftDefinition[] = [
    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
    { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00' },
];

function point(timestamp: string, value: number | null): HistoryDataPointV2 {
    return {
        timestamp,
        timestampMs: Date.parse(timestamp),
        value,
    };
}

describe('trendChartV2Shifts', () => {
    it('builds visible shift intervals across midnight for overnight shifts', () => {
        const intervals = buildTrendChartV2ShiftIntervals({
            shifts: SHIFTS,
            timezone: UTC,
            visibleStartMs: Date.parse('2026-06-18T21:00:00.000Z'),
            visibleEndMs: Date.parse('2026-06-19T07:00:00.000Z'),
        });

        expect(intervals.map((interval) => ({
            label: interval.label,
            startMs: interval.startMs,
            endMs: interval.endMs,
        }))).toEqual([
            {
                label: 'Turno B',
                startMs: Date.parse('2026-06-18T21:00:00.000Z'),
                endMs: Date.parse('2026-06-18T22:00:00.000Z'),
            },
            {
                label: 'Turno C',
                startMs: Date.parse('2026-06-18T22:00:00.000Z'),
                endMs: Date.parse('2026-06-19T06:00:00.000Z'),
            },
            {
                label: 'Turno A',
                startMs: Date.parse('2026-06-19T06:00:00.000Z'),
                endMs: Date.parse('2026-06-19T07:00:00.000Z'),
            },
        ]);
    });

    it('keeps auto display mode visual-only by switching to lines for dense ranges', () => {
        expect(resolveTrendChartV2ShiftDisplayMode({
            displayMode: 'auto',
            intervalCount: 3,
            visibleDurationMs: 24 * 60 * 60 * 1000,
        })).toBe('bands');

        expect(resolveTrendChartV2ShiftDisplayMode({
            displayMode: 'auto',
            intervalCount: 20,
            visibleDurationMs: 30 * 24 * 60 * 60 * 1000,
        })).toBe('lines');

        expect(resolveTrendChartV2ShiftDisplayMode({
            displayMode: 'bands',
            intervalCount: 20,
            visibleDurationMs: 30 * 24 * 60 * 60 * 1000,
        })).toBe('bands');
    });

    it('resolves tooltip shift labels and per-shift summaries from visible points only', () => {
        const visiblePoints = [
            point('2026-06-18T06:15:00.000Z', 10),
            point('2026-06-18T07:30:00.000Z', 14),
            point('2026-06-18T15:00:00.000Z', 20),
            point('2026-06-18T16:00:00.000Z', 24),
            point('2026-06-18T22:30:00.000Z', 30),
            point('2026-06-19T01:00:00.000Z', 26),
        ];

        expect(resolveTrendChartV2TooltipShiftLabel({
            timestampMs: Date.parse('2026-06-19T01:00:00.000Z'),
            shifts: SHIFTS,
            timezone: UTC,
        })).toBe('Turno C');

        expect(buildTrendChartV2VisibleShiftSummary({
            points: visiblePoints,
            shifts: SHIFTS,
            timezone: UTC,
        })).toEqual([
            {
                shiftId: 'shift-a',
                label: 'Turno A',
                count: 2,
                last: 14,
                min: 10,
                max: 14,
                avg: 12,
            },
            {
                shiftId: 'shift-b',
                label: 'Turno B',
                count: 2,
                last: 24,
                min: 20,
                max: 24,
                avg: 22,
            },
            {
                shiftId: 'shift-c',
                label: 'Turno C',
                count: 2,
                last: 26,
                min: 26,
                max: 30,
                avg: 28,
            },
        ]);
    });

    it('treats adjacent shift boundaries as belonging to the next shift start', () => {
        expect(resolveTrendChartV2TooltipShiftLabel({
            timestampMs: Date.parse('2026-06-18T14:00:00.000Z'),
            shifts: SHIFTS,
            timezone: UTC,
        })).toBe('Turno B');

        expect(resolveTrendChartV2TooltipShiftLabel({
            timestampMs: Date.parse('2026-06-18T22:00:00.000Z'),
            shifts: SHIFTS,
            timezone: UTC,
        })).toBe('Turno C');
    });

    it('returns no intervals or summaries when shift configuration is empty', () => {
        expect(buildTrendChartV2ShiftIntervals({
            shifts: [],
            timezone: UTC,
            visibleStartMs: Date.parse('2026-06-18T21:00:00.000Z'),
            visibleEndMs: Date.parse('2026-06-18T23:00:00.000Z'),
        })).toEqual([]);

        expect(buildTrendChartV2VisibleShiftSummary({
            points: [point('2026-06-18T21:30:00.000Z', 20)],
            shifts: [],
            timezone: UTC,
        })).toEqual<TrendChartV2VisibleShiftSummary[]>([]);
    });

    it('ignores null-only inputs and still keeps one-point summaries when a shift has a single finite value', () => {
        expect(buildTrendChartV2VisibleShiftSummary({
            points: [
                point('2026-06-18T06:15:00.000Z', null),
                point('2026-06-18T06:45:00.000Z', 14),
                point('2026-06-18T07:15:00.000Z', null),
            ],
            shifts: SHIFTS,
            timezone: UTC,
        })).toEqual([
            {
                shiftId: 'shift-a',
                label: 'Turno A',
                count: 1,
                last: 14,
                min: 14,
                max: 14,
                avg: 14,
            },
        ]);
    });
});
