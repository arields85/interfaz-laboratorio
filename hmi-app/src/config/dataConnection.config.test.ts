import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT,
    clearDataActivitySeriesEndpoint,
    getDataActivitySeriesEndpoint,
    getDataActivitySeriesUrl,
    isDataActivitySeriesEnabled,
    saveDataActivitySeriesEndpoint,
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
