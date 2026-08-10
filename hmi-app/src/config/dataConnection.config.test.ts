import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT,
    DATA_DEFAULT_PRISMA_CONFIG_ENDPOINT,
    DATA_DEFAULT_SNAPSHOT_EXPORT_INTERVAL_MS,
    DATA_DEFAULT_VOICE_ENDPOINT,
    DATA_MIN_SNAPSHOT_EXPORT_INTERVAL_MS,
    buildDataUrl,
    clearDataActivitySeriesEndpoint,
    clearDataPrismaConfigEndpoint,
    clearDataSnapshotExportEndpoint,
    clearDataSnapshotExportEnabledSetting,
    clearDataSnapshotExportIntervalMs,
    clearDataVoiceEndpoint,
    getDataActivitySeriesEndpoint,
    getDataActivitySeriesUrl,
    getDataPrismaConfigEndpoint,
    getDataPrismaConfigUrl,
    getDataSnapshotExportEndpoint,
    getDataSnapshotExportIntervalMs,
    getDataSnapshotExportUrl,
    getDataVoiceEndpoint,
    getDataVoiceUrl,
    getSavedDataVoiceEndpoint,
    getSavedDataPrismaConfigEndpoint,
    isDataActivitySeriesEnabled,
    isDataSnapshotExportEnabled,
    saveDataActivitySeriesEndpoint,
    saveDataPrismaConfigEndpoint,
    saveDataSnapshotExportEnabledSetting,
    saveDataSnapshotExportEndpoint,
    saveDataSnapshotExportIntervalMs,
    saveDataVoiceEndpoint,
} from './dataConnection.config';

describe('dataConnection.config activity-series helpers', () => {
    afterEach(() => {
        localStorage.clear();
        vi.unstubAllEnvs();
    });

    it('defaults the activity-series endpoint and composes the final GET url', () => {
        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://node-red.local///');

        expect(getDataActivitySeriesEndpoint()).toBe(DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT);
        expect(getDataActivitySeriesUrl()).toBe('https://node-red.local/api/hmi-data/activity-series');
        expect(isDataActivitySeriesEnabled()).toBe(true);
    });

    it('allows an empty saved activity-series endpoint to disable the feature intentionally', () => {
        localStorage.setItem('hmi:activity-series-endpoint', '');
        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://node-red.local');

        expect(getDataActivitySeriesEndpoint()).toBeNull();
        expect(getDataActivitySeriesUrl()).toBeNull();
        expect(isDataActivitySeriesEnabled()).toBe(false);
    });

    it('persists and clears a custom activity-series endpoint without affecting slash normalization', () => {
        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://node-red.local/');

        saveDataActivitySeriesEndpoint('activity/custom-series');
        expect(getDataActivitySeriesEndpoint()).toBe('/activity/custom-series');
        expect(getDataActivitySeriesUrl()).toBe('https://node-red.local/activity/custom-series');

        clearDataActivitySeriesEndpoint();
        expect(getDataActivitySeriesEndpoint()).toBe(DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT);
    });
});

describe('dataConnection.config dashboard snapshot export helpers', () => {
    afterEach(() => {
        localStorage.clear();
        vi.unstubAllEnvs();
    });

    it('keeps snapshot export opt-in by default until an admin explicitly enables it', () => {
        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://node-red.local///');

        expect(getDataSnapshotExportEndpoint()).toBeNull();
        expect(getDataSnapshotExportIntervalMs()).toBe(DATA_DEFAULT_SNAPSHOT_EXPORT_INTERVAL_MS);
        expect(getDataSnapshotExportUrl()).toBeNull();
        expect(isDataSnapshotExportEnabled()).toBe(false);
    });

    it('supports disabling snapshot export without affecting the shared Node-RED base url', () => {
        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://node-red.local');

        saveDataSnapshotExportEnabledSetting(false);
        saveDataSnapshotExportEndpoint('');

        expect(getDataSnapshotExportEndpoint()).toBeNull();
        expect(getDataSnapshotExportUrl()).toBeNull();
        expect(isDataSnapshotExportEnabled()).toBe(false);
    });

    it('persists custom snapshot export endpoint + interval and clears them back to the blank endpoint + default interval', () => {
        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://node-red.local/');

        saveDataSnapshotExportEndpoint('exports/current-dashboard');
        saveDataSnapshotExportIntervalMs(12_000);

        expect(getDataSnapshotExportEndpoint()).toBe('/exports/current-dashboard');
        expect(getDataSnapshotExportUrl()).toBe('https://node-red.local/exports/current-dashboard');
        expect(getDataSnapshotExportIntervalMs()).toBe(12_000);

        clearDataSnapshotExportEndpoint();
        clearDataSnapshotExportIntervalMs();
        clearDataSnapshotExportEnabledSetting();

        expect(getDataSnapshotExportEndpoint()).toBeNull();
        expect(getDataSnapshotExportIntervalMs()).toBe(DATA_DEFAULT_SNAPSHOT_EXPORT_INTERVAL_MS);
        expect(isDataSnapshotExportEnabled()).toBe(false);
    });

    it('enables snapshot export only after the admin saves the opt-in toggle explicitly', () => {
        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://node-red.local');

        saveDataSnapshotExportEnabledSetting(true);
        saveDataSnapshotExportEndpoint('hmi/current-snapshot');

        expect(isDataSnapshotExportEnabled()).toBe(true);
    });

    it('clamps too-small snapshot export intervals to the safer minimum', () => {
        saveDataSnapshotExportIntervalMs(250);

        expect(localStorage.getItem('hmi:snapshot-export-interval-ms')).toBe(String(DATA_MIN_SNAPSHOT_EXPORT_INTERVAL_MS));
        expect(getDataSnapshotExportIntervalMs()).toBe(DATA_MIN_SNAPSHOT_EXPORT_INTERVAL_MS);
    });

    it('falls back to the default snapshot export interval for invalid saved values', () => {
        localStorage.setItem('hmi:snapshot-export-interval-ms', 'not-a-number');

        expect(getDataSnapshotExportIntervalMs()).toBe(DATA_DEFAULT_SNAPSHOT_EXPORT_INTERVAL_MS);
    });
});

describe('dataConnection.config voice helpers', () => {
    afterEach(() => {
        localStorage.clear();
        vi.unstubAllEnvs();
    });

    it('defaults the voice endpoint and composes it with the normalized Node-RED base url', () => {
        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://node-red.local///');

        expect(getSavedDataVoiceEndpoint()).toBeNull();
        expect(getDataVoiceEndpoint()).toBe(DATA_DEFAULT_VOICE_ENDPOINT);
        expect(getDataVoiceUrl()).toBe('https://node-red.local/hmi/voice/latest');
    });

    it('persists a custom endpoint and normalizes duplicate joining slashes', () => {
        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://node-red.local///');

        saveDataVoiceEndpoint('///custom/voice');

        expect(getSavedDataVoiceEndpoint()).toBe('///custom/voice');
        expect(getDataVoiceEndpoint()).toBe('/custom/voice');
        expect(getDataVoiceUrl()).toBe('https://node-red.local/custom/voice');
    });

    it('preserves an empty saved endpoint as an explicit disabled state', () => {
        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://node-red.local');

        saveDataVoiceEndpoint('   ');

        expect(getSavedDataVoiceEndpoint()).toBe('');
        expect(getDataVoiceEndpoint()).toBeNull();
        expect(getDataVoiceUrl()).toBeNull();
    });

    it('clears the saved override back to the canonical default', () => {
        saveDataVoiceEndpoint('/custom/voice');

        clearDataVoiceEndpoint();

        expect(getSavedDataVoiceEndpoint()).toBeNull();
        expect(getDataVoiceEndpoint()).toBe(DATA_DEFAULT_VOICE_ENDPOINT);
    });
});

describe('dataConnection.config Prisma config endpoint helpers', () => {
    afterEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('uses the canonical Prisma config endpoint when no browser override exists', () => {
        expect(getSavedDataPrismaConfigEndpoint()).toBeNull();
        expect(getDataPrismaConfigEndpoint()).toBe(DATA_DEFAULT_PRISMA_CONFIG_ENDPOINT);
    });

    it('reads a saved Prisma config endpoint with canonical leading-slash normalization', () => {
        localStorage.setItem('hmi:prisma-config-endpoint', '///custom/prisma-config');

        expect(getSavedDataPrismaConfigEndpoint()).toBe('///custom/prisma-config');
        expect(getDataPrismaConfigEndpoint()).toBe('/custom/prisma-config');
    });

    it.each([
        ['https://node-red.local', '/hmi/prisma-config'],
        ['https://node-red.local/', '/hmi/prisma-config'],
        ['https://node-red.local', 'hmi/prisma-config'],
        ['https://node-red.local/', 'hmi/prisma-config'],
    ])('composes base %s and endpoint %s without duplicate joining slashes', (baseUrl, endpoint) => {
        vi.stubEnv('VITE_NODE_RED_BASE_URL', baseUrl);
        localStorage.setItem('hmi:prisma-config-endpoint', endpoint);

        expect(getDataPrismaConfigUrl()).toBe('https://node-red.local/hmi/prisma-config');
    });

    it('builds a URL from an explicit draft endpoint with canonical slash handling', () => {
        expect(buildDataUrl(' https://node-red.local/// ', ' ///custom/prisma-config '))
            .toBe('https://node-red.local/custom/prisma-config');
        expect(buildDataUrl(null, '/custom/prisma-config')).toBeNull();
        expect(buildDataUrl('https://node-red.local', '   ')).toBeNull();
    });

    it('does not compose a Prisma config URL without a base or with a disabled endpoint', () => {
        vi.stubEnv('VITE_NODE_RED_BASE_URL', '');
        expect(getDataPrismaConfigUrl()).toBeNull();

        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://node-red.local');
        localStorage.setItem('hmi:prisma-config-endpoint', '');
        expect(getDataPrismaConfigUrl()).toBeNull();
    });

    it('preserves an empty saved Prisma config endpoint as an explicit disabled state', () => {
        saveDataPrismaConfigEndpoint('   ');

        expect(getSavedDataPrismaConfigEndpoint()).toBe('');
        expect(getDataPrismaConfigEndpoint()).toBeNull();
    });

    it('persists and clears the Prisma config endpoint through its own storage key', () => {
        saveDataPrismaConfigEndpoint('  /custom/prisma-config  ');

        expect(localStorage.getItem('hmi:prisma-config-endpoint')).toBe('/custom/prisma-config');
        expect(localStorage.getItem('hmi:voice-endpoint')).toBeNull();

        clearDataPrismaConfigEndpoint();

        expect(getSavedDataPrismaConfigEndpoint()).toBeNull();
        expect(getDataPrismaConfigEndpoint()).toBe(DATA_DEFAULT_PRISMA_CONFIG_ENDPOINT);
    });

    it('falls back safely when browser storage is blocked', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage blocked');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('storage blocked');
        });
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('storage blocked');
        });

        expect(getSavedDataPrismaConfigEndpoint()).toBeNull();
        expect(getDataPrismaConfigEndpoint()).toBe(DATA_DEFAULT_PRISMA_CONFIG_ENDPOINT);
        expect(() => saveDataPrismaConfigEndpoint('/custom/prisma-config')).not.toThrow();
        expect(() => clearDataPrismaConfigEndpoint()).not.toThrow();
    });
});
