import { describe, expect, it } from 'vitest';

import type { DataContractResponse } from '../domain';
import { adaptDataOverview } from './dataOverview.adapter';

describe('dataOverview.adapter', () => {
    it('returns safe defaults for nullish or malformed payloads', () => {
        expect(adaptDataOverview(null)).toEqual({
            connection: { globalStatus: 'unknown', lastSuccess: null, ageMs: null },
            machines: [],
        });

        expect(adaptDataOverview('invalid payload')).toEqual({
            connection: { globalStatus: 'unknown', lastSuccess: null, ageMs: null },
            machines: [],
        });
    });

    it('preserves contract machines with values records', () => {
        const raw: DataContractResponse = {
            contractVersion: '1.0.0',
            timestamp: '2026-04-21T15:00:00Z',
            connection: { globalStatus: 'online', lastSuccess: '2026-04-21T15:00:00Z', ageMs: 0 },
            machines: [
                {
                    unitId: 7,
                    name: 'Compresor 7',
                    status: 'online',
                    lastSuccess: '2026-04-21T15:00:00Z',
                    ageMs: 0,
                    values: {
                        pressure: { value: 12.4, unit: 'bar', timestamp: '2026-04-21T15:00:00Z' },
                    },
                },
            ],
        };

        expect(adaptDataOverview(raw)).toEqual({
            connection: { globalStatus: 'online', lastSuccess: '2026-04-21T15:00:00Z', ageMs: 0 },
            machines: [
                {
                    unitId: 7,
                    name: 'Compresor 7',
                    status: 'online',
                    lastSuccess: '2026-04-21T15:00:00Z',
                    ageMs: 0,
                    values: {
                        pressure: {
                            value: 12.4,
                            unit: 'bar',
                            timestamp: '2026-04-21T15:00:00Z',
                        },
                    },
                },
            ],
        });
    });

    it('normalizes invalid connection and machine statuses, filters invalid machines, and adapts record values', () => {
        const raw = {
            connection: { globalStatus: 'BROKEN', lastSuccess: undefined, ageMs: undefined },
            machines: [
                {
                    unitId: 11,
                    name: 'Boiler 11',
                    status: ' BAD ',
                    values: {
                        pressure: {
                            value: '42.5',
                            unit: 'bar',
                            timestamp: '2026-04-21T15:00:00Z',
                            displayName: 'Pressure',
                        },
                        flow: {
                            value: 'not-a-number',
                            unit: undefined,
                            timestamp: undefined,
                        },
                        level: {
                            value: null,
                            unit: 'm',
                            timestamp: '2026-04-21T15:05:00Z',
                        },
                    },
                },
                {
                    unitId: null,
                    name: 'Missing id',
                    status: 'online',
                },
                {
                    unitId: 12,
                    name: '',
                    status: 'offline',
                },
            ],
        };

        expect(adaptDataOverview(raw as unknown as DataContractResponse)).toEqual({
            connection: { globalStatus: 'unknown', lastSuccess: null, ageMs: null },
            machines: [
                {
                    unitId: 11,
                    name: 'Boiler 11',
                    status: 'unknown',
                    lastSuccess: null,
                    ageMs: null,
                    values: {
                        pressure: {
                            value: 42.5,
                            unit: 'bar',
                            timestamp: '2026-04-21T15:00:00Z',
                            displayName: 'Pressure',
                        },
                        flow: {
                            value: null,
                            unit: null,
                            timestamp: null,
                            displayName: undefined,
                        },
                        level: {
                            value: null,
                            unit: 'm',
                            timestamp: '2026-04-21T15:05:00Z',
                            displayName: undefined,
                        },
                    },
                },
            ],
        });
    });

    it('returns empty values when a valid machine has no values object', () => {
        const raw = {
            contractVersion: '1.0.0',
            timestamp: '2026-04-21T15:00:00Z',
            connection: { globalStatus: 'online', lastSuccess: '2026-04-21T15:00:00Z', ageMs: 0 },
            machines: [
                {
                    unitId: 3,
                    name: 'Chiller 3',
                    status: 'online',
                    lastSuccess: '2026-04-21T15:00:00Z',
                    ageMs: 0,
                    values: undefined,
                },
            ],
        } as unknown as DataContractResponse;

        expect(adaptDataOverview(raw).machines).toEqual([
            {
                unitId: 3,
                name: 'Chiller 3',
                status: 'online',
                lastSuccess: '2026-04-21T15:00:00Z',
                ageMs: 0,
                values: {},
            },
        ]);
    });

    it('falls back to legacy variables arrays and skips entries without keys', () => {
        const raw = {
            connection: { globalStatus: 'degradado', lastSuccess: null, ageMs: 5000 },
            machines: [
                {
                    unitId: 21,
                    name: 'Legacy Pump',
                    status: 'offline',
                    lastSuccess: null,
                    ageMs: 15000,
                    variables: [
                        { key: 'temperature', value: '18.2', unit: 'C', timestamp: '2026-04-21T15:10:00Z' },
                        { key: 'vibration', value: null, unit: 'mm/s' },
                        { key: 'quality', value: 'bad-value' },
                        { key: '', value: 99 },
                    ],
                },
            ],
        };

        expect(adaptDataOverview(raw as unknown as DataContractResponse)).toEqual({
            connection: { globalStatus: 'degradado', lastSuccess: null, ageMs: 5000 },
            machines: [
                {
                    unitId: 21,
                    name: 'Legacy Pump',
                    status: 'offline',
                    lastSuccess: null,
                    ageMs: 15000,
                    values: {
                        temperature: {
                            value: 18.2,
                            unit: 'C',
                            timestamp: '2026-04-21T15:10:00Z',
                        },
                        vibration: {
                            value: null,
                            unit: 'mm/s',
                            timestamp: null,
                        },
                        quality: {
                            value: null,
                            unit: null,
                            timestamp: null,
                        },
                    },
                },
            ],
        });
    });

    it('returns an empty list when the overview has no machines array or a non-array machines value', () => {
        expect(adaptDataOverview({ machines: [] } as unknown as DataContractResponse).machines).toEqual([]);
        expect(adaptDataOverview({} as DataContractResponse).machines).toEqual([]);
        expect(adaptDataOverview({ machines: {} } as unknown as DataContractResponse).machines).toEqual([]);
    });
});
