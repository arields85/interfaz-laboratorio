import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
    LEDA_ORB_STORAGE_KEY,
    LEDA_ORB_VISUAL_DEFAULTS,
    saveLedaOrbVisualConfig,
} from '../config/ledaOrb.config';
import { localStorageSharedConfig } from '../test/localStorageSharedConfig';
import { useLedaOrbVisualConfig } from './useLedaOrbVisualConfig';

describe('useLedaOrbVisualConfig', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('reads storage initially and reacts to same-document saves', () => {
        localStorage.setItem(LEDA_ORB_STORAGE_KEY, JSON.stringify({
            ...LEDA_ORB_VISUAL_DEFAULTS,
            size: 420,
        }));
        const { result } = renderHook(() => useLedaOrbVisualConfig());

        expect(result.current.size).toBe(420);

        act(() => {
            saveLedaOrbVisualConfig({ ...result.current, speed: 1.5 });
        });

        expect(result.current.speed).toBe(1.5);
    });

    it('reacts only to the orb key when another browser changes the shared configuration', () => {
        const { result } = renderHook(() => useLedaOrbVisualConfig());
        const remoteConfig = { ...LEDA_ORB_VISUAL_DEFAULTS, rays: 0.72, size: 760 };

        act(() => {
            localStorage.setItem(LEDA_ORB_STORAGE_KEY, JSON.stringify(remoteConfig));
            localStorageSharedConfig.emitChange(['unrelated']);
        });
        expect(result.current).toEqual(LEDA_ORB_VISUAL_DEFAULTS);

        act(() => {
            localStorageSharedConfig.emitChange([LEDA_ORB_STORAGE_KEY]);
        });
        expect(result.current).toEqual(remoteConfig);

        act(() => {
            localStorage.removeItem(LEDA_ORB_STORAGE_KEY);
            localStorageSharedConfig.emitChange([LEDA_ORB_STORAGE_KEY]);
        });
        expect(result.current).toEqual(LEDA_ORB_VISUAL_DEFAULTS);
    });
});
