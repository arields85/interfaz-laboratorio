import { describe, expect, it } from 'vitest';
import {
    createActivitySeriesIdentityKey,
    ProdTrendLastKnownGoodStorageService,
} from './ProdTrendLastKnownGoodStorageService';

const identity = { machineId: 7, range: '24h' as const };
const response = {
    contractVersion: '1.0.0',
    machineId: 7,
    variableKey: 'Total kW',
    range: '24h' as const,
    unit: 'kW',
    purpose: 'activity-analytics' as const,
    window: {
        start: '2026-06-18T10:00:00.000Z',
        end: '2026-06-19T10:00:00.000Z',
        bucket: '5m',
        bucketMs: 300000,
    },
    series: [{ timestamp: '2026-06-18T10:00:00.000Z', timestampMs: Date.parse('2026-06-18T10:00:00.000Z'), value: 12 }],
    summary: { stale: true },
};

function createStorage() {
    return new ProdTrendLastKnownGoodStorageService({
        storage: window.localStorage,
        now: () => Date.parse('2026-06-20T00:00:00.000Z'),
    });
}

describe('ProdTrendLastKnownGoodStorageService', () => {
    it('round-trips a response by machine and range without using variableKey', () => {
        const storage = createStorage();
        storage.save(identity, response);

        expect(storage.get({ ...identity }, Date.parse('2026-06-20T00:00:00.000Z'))).toEqual(response);
        expect(createActivitySeriesIdentityKey({ ...identity, start: 'ignored', end: 'ignored' })).toBe('7|24h');
    });

    it('keeps custom windows in the canonical identity', () => {
        expect(createActivitySeriesIdentityKey({
            machineId: 7,
            range: 'custom',
            start: '2026-06-18T10:00:00.000Z',
            end: '2026-06-18T12:00:00.000Z',
        })).toBe('7|custom|2026-06-18T10:00:00.000Z|2026-06-18T12:00:00.000Z');
    });

    it('rejects a custom response whose window does not match its identity', () => {
        const storage = createStorage();

        expect(storage.save({
            machineId: 7,
            range: 'custom',
            start: '2026-06-18T10:00:00.000Z',
            end: '2026-06-18T12:00:00.000Z',
        }, { ...response, range: 'custom' })).toBe(false);
    });

    it('ignores corrupt and expired entries instead of throwing', () => {
        window.localStorage.setItem('hmi_prod_trend_lkg_v1', '{bad');
        const storage = createStorage();

        expect(storage.get(identity, Date.parse('2026-06-20T00:00:00.000Z'))).toBeNull();
    });

    it('drops entries beyond the declared age bound', () => {
        const storage = new ProdTrendLastKnownGoodStorageService({
            storage: window.localStorage,
            now: () => Date.parse('2026-06-20T00:00:00.000Z'),
            maxAgeMs: 1000,
        });
        storage.save(identity, response);

        expect(storage.get(identity, Date.parse('2026-06-20T00:00:02.000Z'))).toBeNull();
    });

    it('retries one quota failure after evicting the oldest entry', () => {
        let value: string | null = null;
        let writes = 0;
        const quotaStorage = {
            getItem: () => value,
            setItem: (_key: string, next: string) => {
                writes += 1;
                if (writes === 1) throw new Error('quota');
                value = next;
            },
            removeItem: () => { value = null; },
        };
        const storage = new ProdTrendLastKnownGoodStorageService({ storage: quotaStorage, maxEntries: 1 });

        expect(storage.save(identity, response)).toBe(true);
        expect(writes).toBe(2);
    });

    it('evicts the oldest entry when the configured entry bound is exceeded', () => {
        const storage = new ProdTrendLastKnownGoodStorageService({
            storage: window.localStorage,
            now: () => Date.parse('2026-06-20T00:00:00.000Z'),
            maxEntries: 1,
        });
        storage.save({ machineId: 1, range: '24h' }, { ...response, machineId: 1 });
        storage.save({ machineId: 2, range: '24h' }, { ...response, machineId: 2 });

        expect(storage.get({ machineId: 2, range: '24h' }, Date.parse('2026-06-20T00:00:00.000Z'))).toMatchObject({ machineId: 2 });
    });

    it('enforces the total-byte bound when reading persisted entries', () => {
        const first = {
            identityKey: '1|24h',
            capturedAt: 100,
            response: { ...response, machineId: 1 },
        };
        const second = {
            identityKey: '2|24h',
            capturedAt: 200,
            response: { ...response, machineId: 2 },
        };
        const firstBytes = new TextEncoder().encode(JSON.stringify(first)).byteLength;
        window.localStorage.setItem('hmi_prod_trend_lkg_v1', JSON.stringify([first, second]));

        const storage = new ProdTrendLastKnownGoodStorageService({
            storage: window.localStorage,
            maxAgeMs: 10_000,
            maxTotalBytes: firstBytes + 1,
            now: () => 1_000,
        });

        expect(storage.get({ machineId: 1, range: '24h' }, 1_000)).toBeNull();
        expect(storage.get({ machineId: 2, range: '24h' }, 1_000)).toMatchObject({ machineId: 2 });
    });

    it('ignores oversized entries alongside malformed persisted records', () => {
        const valid = {
            identityKey: '7|24h',
            capturedAt: 100,
            response,
        };
        const oversized = {
            identityKey: '8|24h',
            capturedAt: 200,
            response: { ...response, machineId: 8, summary: 'x'.repeat(500) },
        };
        window.localStorage.setItem('hmi_prod_trend_lkg_v1', JSON.stringify([valid, oversized, null, { capturedAt: 'bad' }]));

        const storage = new ProdTrendLastKnownGoodStorageService({
            storage: window.localStorage,
            maxAgeMs: 10_000,
            maxEntryBytes: new TextEncoder().encode(JSON.stringify(valid)).byteLength + 1,
            now: () => 1_000,
        });

        expect(storage.get(identity, 1_000)).toEqual(response);
        expect(storage.get({ machineId: 8, range: '24h' }, 1_000)).toBeNull();
    });
});
