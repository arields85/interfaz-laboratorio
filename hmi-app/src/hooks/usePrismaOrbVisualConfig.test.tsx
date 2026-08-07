import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
    PRISMA_ORB_STORAGE_KEY,
    PRISMA_ORB_VISUAL_DEFAULTS,
    savePrismaOrbVisualConfig,
} from '../config/prismaOrb.config';
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

    it('reacts only to the stable storage key across tabs', () => {
        const { result } = renderHook(() => usePrismaOrbVisualConfig());
        const crossTabConfig = { ...PRISMA_ORB_VISUAL_DEFAULTS, rays: 0.72, size: 760 };

        act(() => {
            window.dispatchEvent(new StorageEvent('storage', {
                key: 'unrelated',
                newValue: JSON.stringify(crossTabConfig),
            }));
        });
        expect(result.current).toEqual(PRISMA_ORB_VISUAL_DEFAULTS);

        act(() => {
            window.dispatchEvent(new StorageEvent('storage', {
                key: PRISMA_ORB_STORAGE_KEY,
                newValue: JSON.stringify(crossTabConfig),
            }));
        });
        expect(result.current).toEqual(crossTabConfig);

        act(() => {
            window.dispatchEvent(new StorageEvent('storage', {
                key: PRISMA_ORB_STORAGE_KEY,
                newValue: null,
            }));
        });
        expect(result.current).toEqual(PRISMA_ORB_VISUAL_DEFAULTS);
    });

    it('restores defaults when another tab clears local storage', () => {
        localStorage.setItem(PRISMA_ORB_STORAGE_KEY, JSON.stringify({
            ...PRISMA_ORB_VISUAL_DEFAULTS,
            intensity: 1.6,
        }));
        const { result } = renderHook(() => usePrismaOrbVisualConfig());

        expect(result.current.intensity).toBe(1.6);

        act(() => {
            localStorage.clear();
            window.dispatchEvent(new StorageEvent('storage', {
                key: null,
                newValue: null,
            }));
        });

        expect(result.current).toEqual(PRISMA_ORB_VISUAL_DEFAULTS);
    });
});
