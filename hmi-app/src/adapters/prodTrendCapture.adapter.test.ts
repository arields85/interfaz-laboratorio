import { describe, expect, it } from 'vitest';
import {
    adaptProdTrendCapture,
    adaptRawProdTrendHistoryResponse,
    createProdTrendCaptureChecksum,
    rehydrateProdTrendCapture,
} from './prodTrendCapture.adapter';

const identity = {
    machineId: 7,
    range: 'custom' as const,
    start: '2026-06-18T10:00:00.000Z',
    end: '2026-06-18T10:03:00.000Z',
};

const baseCapture = {
    schemaVersion: '1',
    provenance: {
        purpose: 'activity-analytics',
        contractVersion: '1.0.0',
        capturedAt: '2026-06-19T10:00:00.000Z',
    },
    identity,
    window: { ...identity, bucket: '1m', bucketMs: 60000 },
    unit: 'kW',
    variableKey: 'must-not-be-used',
    points: [
        { offsetMs: 120000, value: 20 },
        { offsetMs: 0, value: null },
        { offsetMs: 60000, value: 12 },
    ],
};

async function signedCapture(overrides: Record<string, unknown> = {}) {
    const payload = { ...baseCapture, ...overrides };
    return { ...payload, checksum: await createProdTrendCaptureChecksum(payload) };
}

describe('prodTrendCapture.adapter', () => {
    it('adapts a genuine history response without changing point values or order', () => {
        const history = {
            contractVersion: '1.1',
            machineId: 11,
            variableKey: 'Total kW',
            range: '24h',
            unit: 'kW',
            window: {
                start: '2026-08-05T10:00:00.000Z',
                end: '2026-08-06T10:00:00.000Z',
                bucket: '1m',
                bucketMs: 60000,
                timezone: 'America/Argentina/Buenos_Aires',
            },
            series: [
                { timestamp: '2026-08-05T10:00:30.000Z', value: 0 },
                { timestamp: '2026-08-05T10:01:40.000Z', value: 1.284 },
                { timestamp: '2026-08-06T10:00:00.000Z', value: -0.003 },
            ],
            summary: { last: 999, min: 999, max: 999, avg: 999 },
        };

        const capture = adaptRawProdTrendHistoryResponse(history, {
            schemaVersion: '2',
            capturedAt: '2026-08-06T12:30:00.000Z',
        });

        expect(capture).toMatchObject({
            schemaVersion: '2',
            identity: { machineId: 11, range: '24h' },
            provenance: {
                purpose: 'history',
                endpoint: '/api/hmi-data/history',
                variableKey: 'Total kW',
                contractVersion: '1.1',
                capturedAt: '2026-08-06T12:30:00.000Z',
            },
        });
        expect(capture.points).toEqual([
            { offsetMs: 30000, value: 0 },
            { offsetMs: 100000, value: 1.284 },
            { offsetMs: 86400000, value: -0.003 },
        ]);
    });

    it.each([
        ['wrong variable', { variableKey: 'Pressure' }],
        ['missing contract', { contractVersion: '' }],
        ['invalid value', { series: [{ timestamp: '2026-08-05T10:00:30.000Z', value: Number.NaN }] }],
        ['duplicate timestamp', { series: [
            { timestamp: '2026-08-05T10:00:30.000Z', value: 1 },
            { timestamp: '2026-08-05T10:00:30.000Z', value: 2 },
        ] }],
        ['reordered timestamps', { series: [
            { timestamp: '2026-08-05T10:01:30.000Z', value: 1 },
            { timestamp: '2026-08-05T10:00:30.000Z', value: 2 },
        ] }],
    ])('rejects malformed or mismatched history input: %s', (_label, override) => {
        const history = {
            contractVersion: '1.1',
            machineId: 11,
            variableKey: 'Total kW',
            range: '24h',
            unit: 'kW',
            window: {
                start: '2026-08-05T10:00:00.000Z',
                end: '2026-08-06T10:00:00.000Z',
                bucket: '1m',
                bucketMs: 60000,
            },
            series: [{ timestamp: '2026-08-05T10:00:30.000Z', value: 1 }],
            ...override,
        };

        expect(() => adaptRawProdTrendHistoryResponse(history, {
            schemaVersion: '2',
            capturedAt: '2026-08-06T12:30:00.000Z',
        })).toThrow();
    });

    it('validates provenance and canonical identity, filters invalid points, sorts, preserves values, and converts offsets', async () => {
        const capture = await adaptProdTrendCapture(await signedCapture(), identity);

        expect(capture.provenance).toMatchObject({
            purpose: 'activity-analytics',
            contractVersion: '1.0.0',
            capturedAt: '2026-06-19T10:00:00.000Z',
        });
        expect(capture.identity).toEqual(identity);
        expect(capture).not.toHaveProperty('variableKey');
        expect(capture.points).toEqual([
            { offsetMs: 0, value: null },
            { offsetMs: 60000, value: 12 },
            { offsetMs: 120000, value: 20 },
        ]);
        expect(capture.checksum).toMatch(/^[a-f0-9]{64}$/);
    });

    it('rejects invalid Activity-Series provenance', async () => {
        await expect(adaptProdTrendCapture(await signedCapture({
            provenance: { ...baseCapture.provenance, purpose: 'history' },
        }), identity)).rejects.toThrow('provenance');
        await expect(adaptProdTrendCapture(await signedCapture({
            provenance: { ...baseCapture.provenance, capturedAt: 'not-a-timestamp' },
        }), identity)).rejects.toThrow('provenance');
    });

    it('rejects identity mismatch and incomplete bucket coverage', async () => {
        await expect(adaptProdTrendCapture(await signedCapture(), { ...identity, machineId: 8 })).rejects.toThrow('identity');
        await expect(adaptProdTrendCapture(await signedCapture({
            identity: { machineId: 7, range: '24h' },
        }), identity)).rejects.toThrow('identity');
        await expect(adaptProdTrendCapture(await signedCapture({
            window: { ...baseCapture.window, start: '2026-06-18T10:01:00.000Z' },
        }), identity)).rejects.toThrow('identity');
        const missingBucket = await signedCapture({
            points: baseCapture.points.filter((point) => point.offsetMs !== 60000),
        });
        await expect(adaptProdTrendCapture(missingBucket, identity)).rejects.toThrow('coverage');
    });

    it('rejects unverifiable checksums', async () => {
        const capture = await signedCapture();
        capture.checksum = '0'.repeat(64);

        await expect(adaptProdTrendCapture(capture, identity)).rejects.toThrow('checksum');
    });

    it('excludes variableKey from checksum identity', async () => {
        expect(await createProdTrendCaptureChecksum(baseCapture)).toBe(
            await createProdTrendCaptureChecksum({ ...baseCapture, variableKey: 'another-key' }),
        );
    });

    it('matches an independently known SHA-256 digest', async () => {
        expect(await createProdTrendCaptureChecksum({ b: 'two', a: 1 })).toBe(
            'f15bfc93d70801047473922f67fed863ecc7f82f0677ebb7122923aee81e0f97',
        );
    });

    it('rehydrates near the requested end, recomputes analytics, and never mixes another source', async () => {
        const capture = await adaptProdTrendCapture(await signedCapture(), identity);
        const rehydrated = rehydrateProdTrendCapture(capture, {
            window: {
                start: '2026-06-19T11:00:00.000Z',
                end: '2026-06-19T11:03:00.000Z',
                bucket: '1m',
                bucketMs: 60000,
            },
            thresholds: { setupKw: 5, prodKw: 15 },
            groupBy: 'shift',
            shifts: [],
            timezone: 'UTC',
        });

        expect(rehydrated.source).toBe('packaged-capture');
        expect(rehydrated.response).not.toHaveProperty('variableKey');
        expect(rehydrated.response.window.start).toBe('2026-06-19T11:00:00.000Z');
        expect(rehydrated.response.window.end).toBe('2026-06-19T11:03:00.000Z');
        expect(rehydrated.response.series).toEqual([
            { timestamp: '2026-06-19T11:00:00.000Z', timestampMs: Date.parse('2026-06-19T11:00:00.000Z'), value: null },
            { timestamp: '2026-06-19T11:01:00.000Z', timestampMs: Date.parse('2026-06-19T11:01:00.000Z'), value: 12 },
            { timestamp: '2026-06-19T11:02:00.000Z', timestampMs: Date.parse('2026-06-19T11:02:00.000Z'), value: 20 },
        ]);
        expect(rehydrated.response.summary).not.toEqual({ stale: true });
        expect(rehydrated.analytics.analytics.durationsMs.prod).toBeGreaterThan(0);
    });
});
