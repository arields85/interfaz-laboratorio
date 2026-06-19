import { describe, expect, it } from 'vitest';
import type { HistoryDataPointV2 } from '../domain/dataContract.types';
import {
    buildTrendChartV2Segments,
    resolveTrendChartV2GapThresholdMs,
} from './trendChartV2Segments';

function makePoint(timestamp: string, value: number | null): HistoryDataPointV2 {
    return {
        timestamp,
        timestampMs: Date.parse(timestamp),
        value,
    };
}

describe('trendChartV2Segments', () => {
    it('breaks visual continuity across null points', () => {
        const segments = buildTrendChartV2Segments({
            points: [
                makePoint('2026-06-18T10:00:00.000Z', 10),
                makePoint('2026-06-18T10:01:00.000Z', 12),
                makePoint('2026-06-18T10:02:00.000Z', null),
                makePoint('2026-06-18T10:03:00.000Z', 15),
                makePoint('2026-06-18T10:04:00.000Z', 18),
            ],
            gapThresholdMs: 90_000,
        });

        expect(segments).toHaveLength(2);
        expect(segments[0].map((point) => point.value)).toEqual([10, 12]);
        expect(segments[1].map((point) => point.value)).toEqual([15, 18]);
    });

    it('breaks visual continuity across large timestamp gaps without collapsing them', () => {
        const points = [
            makePoint('2026-06-18T10:00:00.000Z', 10),
            makePoint('2026-06-18T10:01:00.000Z', 11),
            makePoint('2026-06-18T10:05:00.000Z', 15),
            makePoint('2026-06-18T10:06:00.000Z', 16),
        ];

        const gapThresholdMs = resolveTrendChartV2GapThresholdMs({
            bucketMs: 60_000,
            range: '24h',
            points,
        });

        const segments = buildTrendChartV2Segments({ points, gapThresholdMs });

        expect(gapThresholdMs).toBe(90_000);
        expect(segments).toHaveLength(2);
        expect(segments[0].map((point) => point.timestamp)).toEqual([
            '2026-06-18T10:00:00.000Z',
            '2026-06-18T10:01:00.000Z',
        ]);
        expect(segments[1].map((point) => point.timestamp)).toEqual([
            '2026-06-18T10:05:00.000Z',
            '2026-06-18T10:06:00.000Z',
        ]);
    });

    it('uses a representative point cadence instead of the smallest outlier delta so long-range series do not fragment falsely', () => {
        const points = [
            makePoint('2026-06-18T00:00:00.000Z', 10),
            makePoint('2026-06-18T00:05:00.000Z', 11),
            makePoint('2026-06-18T06:05:00.000Z', 15),
            makePoint('2026-06-18T12:05:00.000Z', 16),
            makePoint('2026-06-18T18:05:00.000Z', 18),
        ];

        const gapThresholdMs = resolveTrendChartV2GapThresholdMs({
            bucketMs: undefined,
            range: '7d',
            points,
        });

        const segments = buildTrendChartV2Segments({ points, gapThresholdMs });

        expect(gapThresholdMs).toBeGreaterThan(6 * 60 * 60 * 1000);
        expect(segments).toHaveLength(1);
        expect(segments[0]).toHaveLength(5);
    });

    it('does not trust an unrealistically small backend bucket when observed cadence is much larger', () => {
        const points = [
            makePoint('2026-06-17T00:00:00.000Z', 10),
            makePoint('2026-06-18T00:00:00.000Z', 11),
            makePoint('2026-06-19T00:00:00.000Z', 12),
            makePoint('2026-06-20T00:00:00.000Z', 13),
        ];

        const gapThresholdMs = resolveTrendChartV2GapThresholdMs({
            bucketMs: 60_000,
            range: '7d',
            points,
        });

        const segments = buildTrendChartV2Segments({ points, gapThresholdMs });

        expect(gapThresholdMs).toBeGreaterThan(12 * 60 * 60 * 1000);
        expect(segments).toHaveLength(1);
        expect(segments[0]).toHaveLength(4);
    });

    it('keeps sparse three-point series split when a later real gap is much larger than the initial cadence', () => {
        const points = [
            makePoint('2026-06-01T00:00:00.000Z', 10),
            makePoint('2026-06-02T00:00:00.000Z', 11),
            makePoint('2026-06-10T00:00:00.000Z', 12),
        ];

        const gapThresholdMs = resolveTrendChartV2GapThresholdMs({
            bucketMs: undefined,
            range: '30d',
            points,
        });

        const segments = buildTrendChartV2Segments({ points, gapThresholdMs });

        expect(gapThresholdMs).toBeLessThan(8 * 24 * 60 * 60 * 1000);
        expect(segments).toHaveLength(2);
        expect(segments[0].map((point) => point.timestamp)).toEqual([
            '2026-06-01T00:00:00.000Z',
            '2026-06-02T00:00:00.000Z',
        ]);
        expect(segments[1].map((point) => point.timestamp)).toEqual([
            '2026-06-10T00:00:00.000Z',
        ]);
    });

    it('still avoids false splits for reasonable irregular cadence while using the lower observed cadence as the split anchor', () => {
        const points = [
            makePoint('2026-06-01T00:00:00.000Z', 10),
            makePoint('2026-06-02T00:00:00.000Z', 11),
            makePoint('2026-06-03T12:00:00.000Z', 12),
            makePoint('2026-06-05T00:00:00.000Z', 13),
        ];

        const gapThresholdMs = resolveTrendChartV2GapThresholdMs({
            bucketMs: undefined,
            range: '30d',
            points,
        });

        const segments = buildTrendChartV2Segments({ points, gapThresholdMs });

        expect(gapThresholdMs).toBeGreaterThan(36 * 60 * 60 * 1000);
        expect(segments).toHaveLength(1);
        expect(segments[0]).toHaveLength(4);
    });

    it.each([
        {
            range: '7d' as const,
            points: [
                makePoint('2026-06-14T00:00:00.000Z', 10),
                makePoint('2026-06-15T00:00:00.000Z', 10),
                makePoint('2026-06-16T00:00:00.000Z', 10),
                makePoint('2026-06-17T00:00:00.000Z', 10),
                makePoint('2026-06-18T15:00:00.000Z', 10),
                makePoint('2026-06-19T15:00:00.000Z', 10),
                makePoint('2026-06-20T15:00:00.000Z', 10),
            ],
        },
        {
            range: '30d' as const,
            points: [
                makePoint('2026-06-09T00:00:00.000Z', 10),
                makePoint('2026-06-11T00:00:00.000Z', 10),
                makePoint('2026-06-13T00:00:00.000Z', 10),
                makePoint('2026-06-15T00:00:00.000Z', 10),
                makePoint('2026-06-18T12:00:00.000Z', 10),
                makePoint('2026-06-20T12:00:00.000Z', 10),
                makePoint('2026-06-22T12:00:00.000Z', 10),
            ],
        },
    ])('keeps coarse day-scale $range history connected when one interval modestly stretches beyond the representative cadence', ({ points, range }) => {
        const gapThresholdMs = resolveTrendChartV2GapThresholdMs({
            bucketMs: undefined,
            range,
            points,
        });

        const segments = buildTrendChartV2Segments({ points, gapThresholdMs });

        expect(segments).toHaveLength(1);
        expect(segments[0]).toHaveLength(points.length);
    });

    it.each([
        {
            range: '7d' as const,
            stretchedDeltaMs: 60 * 60 * 1000 * 60,
            points: [
                makePoint('2026-06-12T00:00:00.000Z', 10),
                makePoint('2026-06-13T00:00:00.000Z', 10),
                makePoint('2026-06-14T00:00:00.000Z', 10),
                makePoint('2026-06-15T00:00:00.000Z', 10),
                makePoint('2026-06-17T12:00:00.000Z', 10),
                makePoint('2026-06-18T12:00:00.000Z', 10),
                makePoint('2026-06-19T12:00:00.000Z', 10),
            ],
        },
        {
            range: '30d' as const,
            stretchedDeltaMs: 60 * 60 * 1000 * 120,
            points: [
                makePoint('2026-06-01T00:00:00.000Z', 10),
                makePoint('2026-06-03T00:00:00.000Z', 10),
                makePoint('2026-06-05T00:00:00.000Z', 10),
                makePoint('2026-06-07T00:00:00.000Z', 10),
                makePoint('2026-06-12T00:00:00.000Z', 10),
                makePoint('2026-06-14T00:00:00.000Z', 10),
                makePoint('2026-06-16T00:00:00.000Z', 10),
            ],
        },
    ])('bridges moderately stretched coarse $range cadence that currently reproduces the false live split', ({ points, range, stretchedDeltaMs }) => {
        const gapThresholdMs = resolveTrendChartV2GapThresholdMs({
            bucketMs: undefined,
            range,
            points,
        });

        const segments = buildTrendChartV2Segments({ points, gapThresholdMs });

        expect(gapThresholdMs).toBeGreaterThanOrEqual(stretchedDeltaMs);
        expect(segments).toHaveLength(1);
        expect(segments[0]).toHaveLength(points.length);
    });

    it.each([
        {
            range: '7d' as const,
            points: [
                makePoint('2026-06-12T00:00:00.000Z', 10),
                makePoint('2026-06-13T00:00:00.000Z', 10),
                makePoint('2026-06-14T00:00:00.000Z', 10),
                makePoint('2026-06-15T00:00:00.000Z', 10),
                makePoint('2026-06-19T12:00:00.000Z', 10),
            ],
        },
        {
            range: '30d' as const,
            points: [
                makePoint('2026-06-01T00:00:00.000Z', 10),
                makePoint('2026-06-03T00:00:00.000Z', 10),
                makePoint('2026-06-05T00:00:00.000Z', 10),
                makePoint('2026-06-07T00:00:00.000Z', 10),
                makePoint('2026-06-14T00:00:00.000Z', 10),
            ],
        },
    ])('still splits real coarse $range gaps that are materially larger than the day-scale bridge budget', ({ points, range }) => {
        const gapThresholdMs = resolveTrendChartV2GapThresholdMs({
            bucketMs: undefined,
            range,
            points,
        });

        const segments = buildTrendChartV2Segments({ points, gapThresholdMs });

        expect(segments).toHaveLength(2);
        expect(segments[0]).toHaveLength(points.length - 1);
        expect(segments[1]).toHaveLength(1);
    });

    it('keeps a 7d dense held-value interval connected when a flat 15m cadence stretches to only 1.25h', () => {
        const points = [
            makePoint('2026-06-17T17:00:00.000Z', 0),
            makePoint('2026-06-17T17:15:00.000Z', 0),
            makePoint('2026-06-17T17:30:00.000Z', 0),
            makePoint('2026-06-17T17:45:00.000Z', 0),
            makePoint('2026-06-17T18:00:00.000Z', 0),
            makePoint('2026-06-17T19:15:00.000Z', 0),
            makePoint('2026-06-17T19:30:00.000Z', 0),
            makePoint('2026-06-17T19:45:00.000Z', 0),
        ];

        const gapThresholdMs = resolveTrendChartV2GapThresholdMs({
            bucketMs: 15 * 60 * 1000,
            range: '7d',
            points,
        });

        const segments = buildTrendChartV2Segments({ points, gapThresholdMs });

        expect(gapThresholdMs).toBe(22.5 * 60 * 1000);
        expect(segments).toHaveLength(1);
        expect(segments[0]).toHaveLength(points.length);
    });

    it('keeps a 24h dense held-value interval connected when the same cadence stretch occurs outside 7d', () => {
        const points = [
            makePoint('2026-06-18T10:00:00.000Z', 12),
            makePoint('2026-06-18T10:15:00.000Z', 12),
            makePoint('2026-06-18T10:30:00.000Z', 12),
            makePoint('2026-06-18T10:45:00.000Z', 12),
            makePoint('2026-06-18T11:00:00.000Z', 12),
            makePoint('2026-06-18T12:15:00.000Z', 12),
            makePoint('2026-06-18T12:30:00.000Z', 12),
            makePoint('2026-06-18T12:45:00.000Z', 12),
        ];

        const gapThresholdMs = resolveTrendChartV2GapThresholdMs({
            bucketMs: 15 * 60 * 1000,
            range: '24h',
            points,
        });

        const segments = buildTrendChartV2Segments({ points, gapThresholdMs });

        expect(gapThresholdMs).toBe(22.5 * 60 * 1000);
        expect(segments).toHaveLength(1);
        expect(segments[0]).toHaveLength(points.length);
    });

    it('keeps a 30d same-value interval connected when the stretch is moderate relative to cadence but above the coarse gap threshold', () => {
        const points = [
            makePoint('2026-06-01T00:00:00.000Z', 18),
            makePoint('2026-06-02T00:00:00.000Z', 18),
            makePoint('2026-06-03T00:00:00.000Z', 18),
            makePoint('2026-06-04T00:00:00.000Z', 18),
            makePoint('2026-06-07T12:00:00.000Z', 18),
            makePoint('2026-06-08T12:00:00.000Z', 18),
            makePoint('2026-06-09T12:00:00.000Z', 18),
        ];

        const gapThresholdMs = resolveTrendChartV2GapThresholdMs({
            bucketMs: undefined,
            range: '30d',
            points,
        });

        const segments = buildTrendChartV2Segments({ points, gapThresholdMs });

        expect(gapThresholdMs).toBe(2.5 * 24 * 60 * 60 * 1000);
        expect(segments).toHaveLength(1);
        expect(segments[0]).toHaveLength(points.length);
    });

    it('still splits a materially larger 7d dense-cadence outage even when the held value is unchanged', () => {
        const points = [
            makePoint('2026-06-17T17:00:00.000Z', 0),
            makePoint('2026-06-17T17:15:00.000Z', 0),
            makePoint('2026-06-17T17:30:00.000Z', 0),
            makePoint('2026-06-17T17:45:00.000Z', 0),
            makePoint('2026-06-17T18:00:00.000Z', 0),
            makePoint('2026-06-17T22:00:00.000Z', 0),
            makePoint('2026-06-17T22:15:00.000Z', 0),
            makePoint('2026-06-17T22:30:00.000Z', 0),
        ];

        const gapThresholdMs = resolveTrendChartV2GapThresholdMs({
            bucketMs: 15 * 60 * 1000,
            range: '7d',
            points,
        });

        const segments = buildTrendChartV2Segments({ points, gapThresholdMs });

        expect(segments).toHaveLength(2);
        expect(segments[0].map((point) => point.timestamp)).toEqual([
            '2026-06-17T17:00:00.000Z',
            '2026-06-17T17:15:00.000Z',
            '2026-06-17T17:30:00.000Z',
            '2026-06-17T17:45:00.000Z',
            '2026-06-17T18:00:00.000Z',
        ]);
        expect(segments[1].map((point) => point.timestamp)).toEqual([
            '2026-06-17T22:00:00.000Z',
            '2026-06-17T22:15:00.000Z',
            '2026-06-17T22:30:00.000Z',
        ]);
    });

    it('still splits a changed-value stretched interval even when it stays within the held-value bridge budget', () => {
        const points = [
            makePoint('2026-06-18T10:00:00.000Z', 12),
            makePoint('2026-06-18T10:15:00.000Z', 12),
            makePoint('2026-06-18T10:30:00.000Z', 12),
            makePoint('2026-06-18T10:45:00.000Z', 12),
            makePoint('2026-06-18T11:00:00.000Z', 12),
            makePoint('2026-06-18T12:15:00.000Z', 13),
            makePoint('2026-06-18T12:30:00.000Z', 13),
            makePoint('2026-06-18T12:45:00.000Z', 13),
        ];

        const gapThresholdMs = resolveTrendChartV2GapThresholdMs({
            bucketMs: 15 * 60 * 1000,
            range: '24h',
            points,
        });

        const segments = buildTrendChartV2Segments({ points, gapThresholdMs });

        expect(segments).toHaveLength(2);
        expect(segments[0].map((point) => point.value)).toEqual([12, 12, 12, 12, 12]);
        expect(segments[1].map((point) => point.value)).toEqual([13, 13, 13]);
    });
});
