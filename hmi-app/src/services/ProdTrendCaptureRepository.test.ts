import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import packagedCapture from '../assets/prod-trend-captures/capture-11-24h.json';
import manifest from '../assets/prod-trend-captures/manifest.json';
import {
    adaptProdTrendCapture,
    createProdTrendCaptureChecksum,
} from '../adapters/prodTrendCapture.adapter';
import { ProdTrendCaptureRepository, prodTrendCaptureRepository } from './ProdTrendCaptureRepository';

function sequenceDigest(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

describe('ProdTrendCaptureRepository', () => {
    it('loads the manifest-listed machine 11 capture from the packaged production asset', async () => {
        const identity = { machineId: 11, range: '24h' as const };
        const manifestEntry = manifest.captures.find((entry) => entry.id === 'capture-11-24h');

        expect(manifestEntry).toEqual({
            id: 'capture-11-24h',
            available: true,
            machineId: 11,
            range: '24h',
            file: 'capture-11-24h.json',
        });
        const validated = await adaptProdTrendCapture(packagedCapture, identity);
        const source = await prodTrendCaptureRepository.load(identity);

        expect(validated).toMatchObject({
            identity,
            provenance: {
                purpose: 'history',
                endpoint: '/api/hmi-data/history',
                variableKey: 'Total kW',
                contractVersion: '1.1',
            },
        });
        expect(validated.checksum).toMatch(/^[a-f0-9]{64}$/);
        expect(source).not.toBeNull();
        expect(source?.response.series).toHaveLength(979);
        expect(source?.response.series[0]).toMatchObject({ timestamp: '2026-08-05T12:14:00.000Z', value: 0 });
        expect(source?.response.series.at(-1)).toMatchObject({ timestamp: '2026-08-06T12:13:12.574Z', value: 0.07 });
        expect(sequenceDigest(source?.response.series.map((point) => point.value))).toBe(
            '1007c8776a76faf0c6abc37321bce7cceca6e23fd786e229d6b0bd53e8897c35',
        );
        expect(sequenceDigest(source?.response.series.map((point) => [
            point.timestampMs - Date.parse(source.response.window.start),
            point.value,
        ]))).toBe('f6791b2a77cf26a7a5afe242d52fece03b655301515e7d4a023d13153788e183');
        expect(source?.response.summary).not.toEqual({ last: 0.07, min: -0.02, max: 1.47, avg: 0.496 });
    });

    it('reports an explicit unavailable state when no genuine capture is packaged', () => {
        const repository = new ProdTrendCaptureRepository({
            schemaVersion: 1,
            captures: [],
            unavailable: [{ reason: 'no-genuine-capture' }],
        });

        expect(repository.find({ machineId: 7, range: '24h' })).toEqual({
            available: false,
            reason: 'no-genuine-capture',
        });
    });

    it('matches only the authoritative identity and never variableKey', () => {
        const repository = new ProdTrendCaptureRepository({
            schemaVersion: 1,
            captures: [{
                id: 'capture-7-24h',
                available: true,
                machineId: 7,
                range: '24h',
                file: 'capture.json',
            }],
            unavailable: [],
        });

        expect(repository.find({ machineId: 7, range: '24h' })).toMatchObject({ available: true, file: 'capture.json' });
        expect(repository.find({ machineId: 8, range: '24h' })).toEqual({
            available: false,
            reason: 'capture-missing',
        });
    });

    it('loads a manifest capture through canonical validation and rehydration', async () => {
        const identity = { machineId: 7, range: '24h' as const };
        const payload = {
            schemaVersion: '1',
            provenance: {
                purpose: 'activity-analytics' as const,
                contractVersion: '1.0.0',
                capturedAt: '2026-06-19T10:00:00.000Z',
            },
            identity,
            window: {
                start: '2026-06-18T10:00:00.000Z',
                end: '2026-06-18T11:00:00.000Z',
                bucket: '1h',
                bucketMs: 3_600_000,
            },
            unit: 'kW',
            points: [{ offsetMs: 0, value: 12 }],
        };
        const capture = { ...payload, checksum: await createProdTrendCaptureChecksum(payload) };
        const repository = new ProdTrendCaptureRepository({
            schemaVersion: 1,
            captures: [{ id: 'capture-7-24h', available: true, ...identity, file: 'capture.json' }],
            unavailable: [],
        }, (file) => file === 'capture.json' ? capture : null);

        const source = await repository.load(identity);

        expect(source).toMatchObject({
            source: 'packaged-capture',
            identity,
            response: expect.objectContaining({ machineId: 7, range: '24h' }),
        });
        expect(source?.response).not.toHaveProperty('variableKey');
    });
});
