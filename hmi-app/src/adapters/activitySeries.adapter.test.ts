import { describe, expect, it } from 'vitest';

import { ActivitySeriesAdapterError, adaptActivitySeries } from './activitySeries.adapter';

describe('activitySeries.adapter', () => {
    it('preserves purpose, window metadata, derives missing timestampMs, and sorts the series chronologically', () => {
        expect(
            adaptActivitySeries({
                contractVersion: '1.0.0',
                machineId: 7,
                variableKey: 'Total kW',
                range: '24h',
                unit: 'kW',
                purpose: 'activity-analytics',
                window: {
                    start: '2026-06-18T10:00:00.000Z',
                    end: '2026-06-19T10:00:00.000Z',
                    timezone: 'America/Argentina/Buenos_Aires',
                    bucket: '5m',
                    bucketMs: 300000,
                },
                series: [
                    { timestamp: '2026-06-18T10:10:00.000Z', value: 9 },
                    { timestamp: '2026-06-18T10:00:00.000Z', timestampMs: 1750240800000, value: 12 },
                ],
                summary: { prodPct: 75 },
            })
        ).toMatchObject({
            purpose: 'activity-analytics',
            window: {
                bucket: '5m',
                bucketMs: 300000,
            },
            series: [
                { timestamp: '2026-06-18T10:00:00.000Z', timestampMs: 1750240800000, value: 12 },
                { timestamp: '2026-06-18T10:10:00.000Z', timestampMs: Date.parse('2026-06-18T10:10:00.000Z'), value: 9 },
            ],
        });
    });

    it('rejects payloads with the wrong purpose', () => {
        expect(() =>
            adaptActivitySeries({
                purpose: 'history',
                window: {
                    start: '2026-06-18T10:00:00.000Z',
                    end: '2026-06-19T10:00:00.000Z',
                    bucket: '5m',
                    bucketMs: 300000,
                },
                series: [],
            })
        ).toThrowError(new ActivitySeriesAdapterError('Activity-series response purpose must be "activity-analytics"'));
    });

    it('rejects payloads with invalid window metadata', () => {
        expect(() =>
            adaptActivitySeries({
                purpose: 'activity-analytics',
                machineId: 7,
                range: '24h',
                window: {
                    start: '2026-06-19T10:00:00.000Z',
                    end: '2026-06-18T10:00:00.000Z',
                    bucket: '',
                    bucketMs: 0,
                },
                series: [],
            })
        ).toThrowError(new ActivitySeriesAdapterError('Activity-series response window is invalid'));
    });

    it('rejects window timestamps without an explicit UTC or offset designator', () => {
        expect(() =>
            adaptActivitySeries({
                purpose: 'activity-analytics',
                machineId: 7,
                range: '24h',
                window: {
                    start: '2026-06-18T10:00:00',
                    end: '2026-06-19T10:00:00Z',
                    bucket: '5m',
                    bucketMs: 300000,
                },
                series: [],
            })
        ).toThrowError(new ActivitySeriesAdapterError('Activity-series response window is invalid'));
    });

    it('rejects malformed response identity instead of silently defaulting machineId or range', () => {
        expect(() =>
            adaptActivitySeries({
                purpose: 'activity-analytics',
                machineId: undefined,
                range: 'year-to-date',
                window: {
                    start: '2026-06-18T10:00:00.000Z',
                    end: '2026-06-19T10:00:00.000Z',
                    bucket: '5m',
                    bucketMs: 300000,
                },
                series: [],
            })
        ).toThrowError(new ActivitySeriesAdapterError('Activity-series response identity is invalid'));
    });

    it('rejects non-integer machine ids even when they are finite positive numbers', () => {
        expect(() =>
            adaptActivitySeries({
                purpose: 'activity-analytics',
                machineId: 7.5,
                range: '24h',
                window: {
                    start: '2026-06-18T10:00:00.000Z',
                    end: '2026-06-19T10:00:00.000Z',
                    bucket: '5m',
                    bucketMs: 300000,
                },
                series: [],
            })
        ).toThrowError(new ActivitySeriesAdapterError('Activity-series response identity is invalid'));
    });

    it('wraps malformed series entries in an ActivitySeriesAdapterError', () => {
        expect(() =>
            adaptActivitySeries({
                purpose: 'activity-analytics',
                machineId: 7,
                range: '24h',
                window: {
                    start: '2026-06-18T10:00:00.000Z',
                    end: '2026-06-19T10:00:00.000Z',
                    bucket: '5m',
                    bucketMs: 300000,
                },
                series: [null, 3],
            })
        ).toThrowError(new ActivitySeriesAdapterError('Activity-series response contains an invalid series point'));
    });

    it('rejects series timestamps without an explicit UTC or offset designator', () => {
        expect(() =>
            adaptActivitySeries({
                purpose: 'activity-analytics',
                machineId: 7,
                range: '24h',
                window: {
                    start: '2026-06-18T10:00:00.000Z',
                    end: '2026-06-19T10:00:00.000Z',
                    bucket: '5m',
                    bucketMs: 300000,
                },
                series: [{ timestamp: '2026-06-18T10:00:00', timestampMs: 1750240800000, value: 12 }],
            })
        ).toThrowError(new ActivitySeriesAdapterError('Activity-series response contains an invalid series point'));
    });
});
