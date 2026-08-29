import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    DEFAULT_PRISMA_RUNTIME_MODE,
    PRISMA_RUNTIME_MODE_STORAGE_KEY,
    getPrismaRuntimeProfile,
    readPrismaRuntimeMode,
    resolvePrismaRuntimeProfile,
    savePrismaRuntimeMode,
} from './prismaRuntime.config';
import {
    DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT,
    DATA_DEFAULT_ENDPOINT,
    DATA_DEFAULT_HISTORY_ENDPOINT,
    DATA_DEFAULT_SNAPSHOT_EXPORT_INTERVAL_MS,
    DATA_DEFAULT_VOICE_ENDPOINT,
    getDataActivitySeriesEndpoint,
    getDataEndpoint,
    getDataHistoryEndpoint,
    getDataSnapshotExportIntervalMs,
    getDataVoiceEndpoint,
} from './dataConnection.config';
const preservedKeys = [
    'hmi:node-red-base-url',
    'hmi:node-red-endpoint',
    'hmi:data-history-endpoint',
    'hmi:activity-series-endpoint',
    'hmi:voice-endpoint',
    'hmi:prisma-config-endpoint',
    'hmi:snapshot-export-endpoint',
    'hmi:snapshot-export-enabled',
    'hmi:snapshot-export-interval-ms',
    'hmi:prisma-voice-tts-service-url',
] as const;
describe('prismaRuntime.config', () => {
    afterEach(() => {
        localStorage.clear();
        vi.unstubAllEnvs();
    });
    it('defaults to central mode and persists only guarded runtime values', () => {
        expect(readPrismaRuntimeMode()).toBe(DEFAULT_PRISMA_RUNTIME_MODE);

        savePrismaRuntimeMode('local');
        expect(readPrismaRuntimeMode()).toBe('local');

        savePrismaRuntimeMode('central');
        expect(readPrismaRuntimeMode()).toBe('central');
        expect(localStorage.getItem(PRISMA_RUNTIME_MODE_STORAGE_KEY)).toBe('central');
    });
    it('ignores invalid persisted mode writes instead of replacing a valid selection', () => {
        localStorage.setItem(PRISMA_RUNTIME_MODE_STORAGE_KEY, 'local');

        savePrismaRuntimeMode('LOCAL');

        expect(readPrismaRuntimeMode()).toBe('local');
        expect(localStorage.getItem(PRISMA_RUNTIME_MODE_STORAGE_KEY)).toBe('local');
    });
    it('uses one decoded, case-sensitive local query override without persisting it', () => {
        localStorage.setItem(PRISMA_RUNTIME_MODE_STORAGE_KEY, 'central');

        expect(resolvePrismaRuntimeProfile('?prismaMode=%6Cocal')).toMatchObject({
            mode: 'local',
            isTemporaryOverride: true,
        });
        expect(localStorage.getItem(PRISMA_RUNTIME_MODE_STORAGE_KEY)).toBe('central');
    });
    it.each([
        ['repeated', '?prismaMode=local&prismaMode=local'],
        ['empty', '?prismaMode='],
        ['non-local', '?prismaMode=Local'],
        ['wrong-case key', '?PRISMAMODE=local'],
        ['malformed value', '?prismaMode=%6ocal'],
    ])('ignores %s query values and keeps the persisted profile', (_case, search) => {
        localStorage.setItem(PRISMA_RUNTIME_MODE_STORAGE_KEY, 'central');

        expect(resolvePrismaRuntimeProfile(search)).toMatchObject({
            mode: 'central',
            isTemporaryOverride: false,
        });
        expect(localStorage.getItem(PRISMA_RUNTIME_MODE_STORAGE_KEY)).toBe('central');
    });
    it('increments the central profile revision when the persisted mode changes', () => {
        const first = getPrismaRuntimeProfile('');

        savePrismaRuntimeMode('local');
        const second = getPrismaRuntimeProfile('');

        expect(second.mode).toBe('local');
        expect(second.revision).toBeGreaterThan(first.revision);
    });
    it('preserves all central connection and assistant keys while selecting local mode', () => {
        const values = Object.fromEntries(preservedKeys.map((key, index) => [key, `preserved-${index}`]));
        for (const [key, value] of Object.entries(values)) {
            localStorage.setItem(key, value);
        }

        savePrismaRuntimeMode('local');

        for (const key of preservedKeys) {
            expect(localStorage.getItem(key)).toBe(values[key]);
        }
    });
    it('restores Server after a Local round-trip without changing any Server preference', () => {
        const values = Object.fromEntries(preservedKeys.map((key, index) => [key, `server-${index}`]));
        for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);

        savePrismaRuntimeMode('local');
        savePrismaRuntimeMode('central');

        for (const key of preservedKeys) expect(localStorage.getItem(key)).toBe(values[key]);
        expect(readPrismaRuntimeMode()).toBe('central');
    });
    it('leaves industrial route helpers on their central defaults', () => {
        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://node-red.local');

        savePrismaRuntimeMode('local');

        expect(getDataEndpoint()).toBe(DATA_DEFAULT_ENDPOINT);
        expect(getDataHistoryEndpoint()).toBe(DATA_DEFAULT_HISTORY_ENDPOINT);
        expect(getDataActivitySeriesEndpoint()).toBe(DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT);
        expect(getDataVoiceEndpoint()).toBe(DATA_DEFAULT_VOICE_ENDPOINT);
        expect(getDataSnapshotExportIntervalMs()).toBe(DATA_DEFAULT_SNAPSHOT_EXPORT_INTERVAL_MS);
    });
});
