import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT,
    DATA_DEFAULT_SNAPSHOT_EXPORT_INTERVAL_MS,
    DATA_DEFAULT_VOICE_ENDPOINT,
    DATA_MIN_SNAPSHOT_EXPORT_INTERVAL_MS,
    clearDataActivitySeriesEndpoint,
    clearDataSnapshotExportEndpoint,
    clearDataSnapshotExportEnabledSetting,
    clearDataSnapshotExportIntervalMs,
    clearDataVoiceEndpoint,
    getDataActivitySeriesEndpoint,
    getDataActivitySeriesUrl,
    getDataSnapshotExportEndpoint,
    getDataSnapshotExportIntervalMs,
    getDataSnapshotExportUrl,
    getDataVoiceEndpoint,
    getDataVoiceUrl,
    getSavedDataVoiceEndpoint,
    isDataActivitySeriesEnabled,
    isDataSnapshotExportEnabled,
    saveDataActivitySeriesEndpoint,
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
