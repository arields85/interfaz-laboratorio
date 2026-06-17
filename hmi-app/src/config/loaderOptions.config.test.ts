import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    LOADER_OPTIONS_DEFAULTS,
    LOADER_OPTIONS_MAX_SECONDS,
    LOADER_OPTIONS_MIN_SECONDS,
    clearLoaderOptionsConfig,
    getDefaultLoaderOptionsConfig,
    readLoaderOptionsConfig,
    resolveRuntimeLoaderRequest,
    saveLoaderOptionsConfig,
} from './loaderOptions.config';

describe('loaderOptions.config', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('returns the default enabled loader options and default runtime durations', () => {
        expect(readLoaderOptionsConfig()).toEqual(LOADER_OPTIONS_DEFAULTS);
        expect(getDefaultLoaderOptionsConfig()).toEqual(LOADER_OPTIONS_DEFAULTS);
        expect(resolveRuntimeLoaderRequest('short')).toMatchObject({
            profileId: 'short',
            enabled: true,
            durationSeconds: LOADER_OPTIONS_DEFAULTS.short.durationSeconds,
            minVisibleMs: 2_000,
        });
        expect(resolveRuntimeLoaderRequest('long')).toMatchObject({
            profileId: 'long',
            enabled: true,
            durationSeconds: LOADER_OPTIONS_DEFAULTS.long.durationSeconds,
            minVisibleMs: 8_000,
        });
    });

    it('keeps valid saved values and clamps persisted durations to the allowed bounds', () => {
        saveLoaderOptionsConfig({
            short: { enabled: true, durationSeconds: 1.5 },
            long: { enabled: true, durationSeconds: 99 },
        });

        expect(readLoaderOptionsConfig()).toEqual({
            short: { enabled: true, durationSeconds: 1.5 },
            long: { enabled: true, durationSeconds: LOADER_OPTIONS_MAX_SECONDS },
        });
        expect(resolveRuntimeLoaderRequest('short').minVisibleMs).toBe(1_500);
        expect(resolveRuntimeLoaderRequest('long').minVisibleMs).toBe(15_000);
    });

    it('falls back to defaults when storage is corrupt or values are missing, non-numeric, or below the minimum', () => {
        localStorage.setItem('hmi:loader-options', JSON.stringify({
            short: { enabled: 'yes', durationSeconds: 'fast' },
            long: { enabled: false, durationSeconds: -1 },
        }));

        expect(readLoaderOptionsConfig()).toEqual({
            short: LOADER_OPTIONS_DEFAULTS.short,
            long: { enabled: false, durationSeconds: LOADER_OPTIONS_DEFAULTS.long.durationSeconds },
        });

        localStorage.setItem('hmi:loader-options', '{invalid-json');

        expect(readLoaderOptionsConfig()).toEqual(LOADER_OPTIONS_DEFAULTS);
        expect(resolveRuntimeLoaderRequest('short').minVisibleMs).toBe(2_000);
        expect(resolveRuntimeLoaderRequest('long').enabled).toBe(true);
        expect(LOADER_OPTIONS_MIN_SECONDS).toBe(0.2);
    });

    it('clears persisted values back to defaults and keeps persistence UI-local', () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        saveLoaderOptionsConfig({
            short: { enabled: false, durationSeconds: 3 },
            long: { enabled: true, durationSeconds: 9 },
        });

        expect(localStorage.getItem('hmi:loader-options')).toContain('"durationSeconds":3');
        expect(resolveRuntimeLoaderRequest('short')).toMatchObject({
            profileId: 'short',
            enabled: false,
            durationSeconds: 3,
            minVisibleMs: 0,
        });
        expect(fetchSpy).not.toHaveBeenCalled();

        clearLoaderOptionsConfig();

        expect(readLoaderOptionsConfig()).toEqual(LOADER_OPTIONS_DEFAULTS);
    });
});
