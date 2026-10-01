import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
    PRISMA_ORB_STORAGE_KEY,
    PRISMA_ORB_VISUAL_DEFAULTS,
    savePrismaOrbVisualConfig,
} from '../config/prismaOrb.config';
import { localStorageSharedConfig } from '../test/localStorageSharedConfig';
import { usePrismaOrbVisualConfig } from './usePrismaOrbVisualConfig';

describe('usePrismaOrbVisualConfig', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('reads storage initially and reacts to same-document saves', () => {
        localStorage.setItem(PRISMA_ORB_STORAGE_KEY, JSON.stringify({
            ...PRISMA_ORB_VISUAL_DEFAULTS,
            size: 420,
        }));
        const { result } = renderHook(() => usePrismaOrbVisualConfig());

        expect(result.current.size).toBe(420);

        act(() => {
            savePrismaOrbVisualConfig({ ...result.current, speed: 1.5 });
        });

        expect(result.current.speed).toBe(1.5);
    });

    it('reacts only to the orb key when another browser changes the shared configuration', () => {
        const { result } = renderHook(() => usePrismaOrbVisualConfig());
        const remoteConfig = { ...PRISMA_ORB_VISUAL_DEFAULTS, rays: 0.72, size: 760 };

        act(() => {
            localStorage.setItem(PRISMA_ORB_STORAGE_KEY, JSON.stringify(remoteConfig));
            localStorageSharedConfig.emitChange(['unrelated']);
        });
        expect(result.current).toEqual(PRISMA_ORB_VISUAL_DEFAULTS);

        act(() => {
            localStorageSharedConfig.emitChange([PRISMA_ORB_STORAGE_KEY]);
        });
        expect(result.current).toEqual(remoteConfig);

        act(() => {
            localStorage.removeItem(PRISMA_ORB_STORAGE_KEY);
            localStorageSharedConfig.emitChange([PRISMA_ORB_STORAGE_KEY]);
        });
        expect(result.current).toEqual(PRISMA_ORB_VISUAL_DEFAULTS);
    });
});
