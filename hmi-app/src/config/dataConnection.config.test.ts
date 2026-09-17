import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    DATA_CONNECTION_CONFIG_CHANGED_EVENT,
    DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT,
    DATA_DEFAULT_ENDPOINT,
    DATA_DEFAULT_HISTORY_ENDPOINT,
    buildDataUrl,
    clearDataActivitySeriesEndpoint,
    clearDataBaseUrl,
    clearDataEndpoint,
    clearDataHistoryEndpoint,
    getDataActivitySeriesUrl,
    getDataBaseUrl,
    getDataEndpoint,
    getDataFullUrl,
    getDataHistoryUrl,
    saveDataActivitySeriesEndpoint,
    saveDataBaseUrl,
    saveDataEndpoint,
    saveDataHistoryEndpoint,
} from './dataConnection.config';

describe('dataConnection.config industrial telemetry settings', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://sample.example.invalid');
    });

    afterEach(() => {
        localStorage.clear();
        vi.unstubAllEnvs();
    });

    it('retains overview, history, and activity defaults', () => {
        expect(getDataBaseUrl()).toBe('https://sample.example.invalid');
        expect(getDataEndpoint()).toBe(DATA_DEFAULT_ENDPOINT);
        expect(getDataFullUrl()).toBe('https://sample.example.invalid/api/hmi-data');
        expect(getDataHistoryUrl()).toBe('https://sample.example.invalid/api/hmi-data/history');
        expect(getDataActivitySeriesUrl()).toBe('https://sample.example.invalid/api/hmi-data/activity-series');
    });

    it('persists and clears industrial telemetry settings without touching legacy Prisma keys', () => {
        localStorage.setItem('hmi:prisma-runtime-mode', 'local');
        localStorage.setItem('hmi:voice-endpoint', 'https://legacy.invalid/voice');
        localStorage.setItem('hmi:prisma-config-endpoint', 'https://legacy.invalid/config');
        localStorage.setItem('hmi:snapshot-export-endpoint', '/legacy-snapshot');
        localStorage.setItem('hmi:prisma-voice-tts-service-url', 'https://legacy.invalid/tts');

        saveDataBaseUrl(' https://sample.example.invalid/root/ ');
        saveDataEndpoint('/overview');
        saveDataHistoryEndpoint('/history');
        saveDataActivitySeriesEndpoint('/activity');

        expect(getDataFullUrl()).toBe('https://sample.example.invalid/root/overview');
        expect(getDataHistoryUrl()).toBe('https://sample.example.invalid/root/history');
        expect(getDataActivitySeriesUrl()).toBe('https://sample.example.invalid/root/activity');

        clearDataBaseUrl();
        clearDataEndpoint();
        clearDataHistoryEndpoint();
        clearDataActivitySeriesEndpoint();

        expect(localStorage.getItem('hmi:prisma-runtime-mode')).toBe('local');
        expect(localStorage.getItem('hmi:voice-endpoint')).toBe('https://legacy.invalid/voice');
        expect(localStorage.getItem('hmi:prisma-config-endpoint')).toBe('https://legacy.invalid/config');
        expect(localStorage.getItem('hmi:snapshot-export-endpoint')).toBe('/legacy-snapshot');
        expect(localStorage.getItem('hmi:prisma-voice-tts-service-url')).toBe('https://legacy.invalid/tts');
    });

    it('keeps the connection change event for the telemetry base URL', () => {
        const listener = vi.fn();
        window.addEventListener(DATA_CONNECTION_CONFIG_CHANGED_EVENT, listener);

        saveDataBaseUrl('https://sample.example.invalid');
        clearDataBaseUrl();

        expect(listener).toHaveBeenCalledTimes(2);
        window.removeEventListener(DATA_CONNECTION_CONFIG_CHANGED_EVENT, listener);
    });

    it('keeps generic URL composition and nullable activity behavior', () => {
        expect(buildDataUrl(' https://sample.example.invalid/// ', ' ///custom '))
            .toBe('https://sample.example.invalid/custom');
        expect(buildDataUrl(null, '/custom')).toBeNull();

        saveDataActivitySeriesEndpoint('');
        expect(getDataActivitySeriesUrl()).toBeNull();
        clearDataActivitySeriesEndpoint();
        expect(DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT).toBe('/api/hmi-data/activity-series');
        expect(DATA_DEFAULT_HISTORY_ENDPOINT).toBe('/api/hmi-data/history');
    });
});
