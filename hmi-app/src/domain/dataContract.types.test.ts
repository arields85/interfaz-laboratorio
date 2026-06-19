import { describe, expect, it } from 'vitest';
import {
    type DataHistoryResponseV2,
    HISTORY_RANGE_V2_LABELS,
    HISTORY_RANGES_V2,
    type HistoryQueryParamsV2,
} from './dataContract.types';

describe('dataContract.types V2 history contract', () => {
    it('exposes the supported V2 history ranges and labels including custom', () => {
        expect(HISTORY_RANGES_V2).toEqual(['1h', '24h', '7d', '30d', '12m', 'custom']);
        expect(HISTORY_RANGE_V2_LABELS).toEqual({
            '1h': '1h',
            '24h': '24h',
            '7d': '7d',
            '30d': '30d',
            '12m': '12m',
            custom: 'Custom',
        });
    });

    it('supports preset queries without forcing custom window boundaries', () => {
        const query: HistoryQueryParamsV2 = {
            machineId: 101,
            variableKey: 'temperature',
            range: '24h',
            maxPoints: 800,
        };

        expect(query.range).toBe('24h');
        expect('start' in query).toBe(false);
        expect('end' in query).toBe(false);
        expect(query.maxPoints).toBe(800);
    });

    it('supports custom query params with explicit window boundaries and maxPoints', () => {
        const query: HistoryQueryParamsV2 = {
            machineId: 101,
            variableKey: 'temperature',
            range: 'custom',
            start: '2026-06-18T10:00:00.000Z',
            end: '2026-06-18T12:00:00.000Z',
            maxPoints: 800,
        };

        expect(query.range).toBe('custom');
        expect(query.start).toBe('2026-06-18T10:00:00.000Z');
        expect(query.end).toBe('2026-06-18T12:00:00.000Z');
        expect(query.maxPoints).toBe(800);
    });

    it('keeps V2-only window metadata and timestampMs out of the legacy runtime response contract', () => {
        const presetQuery = {
            machineId: 101,
            variableKey: 'temperature',
            range: '7d',
        } satisfies HistoryQueryParamsV2;

        const customQuery = {
            machineId: 101,
            variableKey: 'temperature',
            range: 'custom',
            start: '2026-06-18T10:00:00.000Z',
            end: '2026-06-18T12:00:00.000Z',
        } satisfies HistoryQueryParamsV2;

        expect(presetQuery.range).toBe('7d');
        expect(customQuery.range).toBe('custom');
    });

    it('requires start and end when typing a custom query', () => {
        const invalidCustomQuery = {
            machineId: 101,
            variableKey: 'temperature',
            range: 'custom',
            maxPoints: 400,
        } as const;

        // @ts-expect-error custom queries must include start and end
        const typedInvalidQuery: HistoryQueryParamsV2 = invalidCustomQuery;

        expect(invalidCustomQuery.range).toBe('custom');
        expect(typedInvalidQuery.maxPoints).toBe(400);
    });

    it('preserves window metadata and timestampMs only for the dedicated V2 historical response contract', () => {
        const response: DataHistoryResponseV2 = {
            contractVersion: '1.1.0',
            machineId: 101,
            variableKey: 'temperature',
            range: '24h',
            unit: '°C',
            window: {
                start: '2026-06-17T12:00:00.000Z',
                end: '2026-06-18T12:00:00.000Z',
                timezone: 'America/Argentina/Buenos_Aires',
                bucket: '5m',
                bucketMs: 300000,
            },
            series: [
                { timestamp: '2026-06-18T11:55:00.000Z', timestampMs: 1750247700000, value: 42 },
                { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: 1750248000000, value: null },
            ],
            summary: {
                last: 42,
                min: 42,
                max: 42,
                avg: 42,
            },
        };

        expect(response.range).toBe('24h');
        expect(response.window?.timezone).toBe('America/Argentina/Buenos_Aires');
        expect(response.series[0]?.timestampMs).toBe(1750247700000);
        expect(response.series[1]?.value).toBeNull();
    });
});
