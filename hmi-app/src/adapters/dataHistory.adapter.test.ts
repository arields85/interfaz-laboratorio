import { describe, expect, it } from 'vitest';

import { adaptDataHistory } from './dataHistory.adapter';

describe('dataHistory.adapter', () => {
    it('adapts a valid history payload, preserves null values, and filters empty timestamps', () => {
        expect(
            adaptDataHistory({
                contractVersion: '1.0.0',
                machineId: 7,
                variableKey: 'pressure',
                range: 'hora',
                unit: 'bar',
                series: [
                    { timestamp: '2026-04-22T10:00:00Z', value: 11.2 },
                    { timestamp: '2026-04-22T10:05:00Z', value: null },
                    { timestamp: '', value: 14.2 },
                    { value: 15.1 },
                ],
                summary: { last: 11.2, min: 9.8, max: 14.1, avg: 12 },
            })
        ).toEqual({
            contractVersion: '1.0.0',
            machineId: 7,
            variableKey: 'pressure',
            range: 'hora',
            unit: 'bar',
            series: [
                { timestamp: '2026-04-22T10:00:00Z', value: 11.2 },
                { timestamp: '2026-04-22T10:05:00Z', value: null },
            ],
            summary: { last: 11.2, min: 9.8, max: 14.1, avg: 12 },
        });
    });

    it('returns safe defaults when fields are missing or malformed', () => {
        expect(adaptDataHistory({ machineId: '7', range: 'invalid', summary: { max: 'x' } })).toEqual({
            contractVersion: '1.0.0',
            machineId: 0,
            variableKey: '',
            range: 'hora',
            unit: null,
            series: [],
            summary: { last: null, min: null, max: null, avg: null },
        });
    });

    it('returns safe defaults for null payloads and invalid summaries', () => {
        expect(adaptDataHistory(null)).toEqual({
            contractVersion: '1.0.0',
            machineId: 0,
            variableKey: '',
            range: 'hora',
            unit: null,
            series: [],
            summary: { last: null, min: null, max: null, avg: null },
        });

        expect(adaptDataHistory({ summary: null }).summary).toEqual({
            last: null,
            min: null,
            max: null,
            avg: null,
        });
    });

    it('normalizes parseable numeric values and malformed ranges', () => {
        expect(
            adaptDataHistory({
                range: 24,
                series: [
                    { timestamp: '2026-04-22T10:00:00Z', value: '11.2' },
                    { timestamp: '2026-04-22T10:05:00Z', value: '' },
                    { timestamp: '2026-04-22T10:10:00Z', value: Infinity },
                ],
                summary: {
                    last: '18.4',
                    min: '',
                    max: Infinity,
                    avg: '17',
                },
            })
        ).toEqual({
            contractVersion: '1.0.0',
            machineId: 0,
            variableKey: '',
            range: 'hora',
            unit: null,
            series: [
                { timestamp: '2026-04-22T10:00:00Z', value: 11.2 },
                { timestamp: '2026-04-22T10:05:00Z', value: null },
                { timestamp: '2026-04-22T10:10:00Z', value: null },
            ],
            summary: {
                last: 18.4,
                min: null,
                max: null,
                avg: 17,
            },
        });
    });
});
