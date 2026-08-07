import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    PRISMA_ORB_CONFIG_CHANGED_EVENT,
    PRISMA_ORB_STORAGE_KEY,
    PRISMA_ORB_VISUAL_DEFAULTS,
    getDefaultPrismaOrbVisualConfig,
    normalizePrismaOrbVisualConfig,
    readPrismaOrbVisualConfig,
    savePrismaOrbVisualConfig,
} from './prismaOrb.config';

describe('prismaOrb.config', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns independent HMI defaults for empty or corrupt storage', () => {
        expect(readPrismaOrbVisualConfig()).toEqual(PRISMA_ORB_VISUAL_DEFAULTS);

        const defaults = getDefaultPrismaOrbVisualConfig();
        defaults.rays = 0;
        expect(getDefaultPrismaOrbVisualConfig()).toEqual(PRISMA_ORB_VISUAL_DEFAULTS);

        localStorage.setItem(PRISMA_ORB_STORAGE_KEY, '{corrupt');
        expect(readPrismaOrbVisualConfig()).toEqual(PRISMA_ORB_VISUAL_DEFAULTS);
    });

    it('clamps, snaps and validates every persisted visual value', () => {
        expect(normalizePrismaOrbVisualConfig(PRISMA_ORB_VISUAL_DEFAULTS).size).toBe(290);

        expect(normalizePrismaOrbVisualConfig({
            rays: 0.456,
            speed: 1.03,
            intensity: 0.42,
            size: 171,
            core: '#ABCDEF',
            glow: 'invalid',
        })).toEqual({
            rays: 0.46,
            speed: 1.05,
            intensity: 0.4,
            size: 180,
            core: '#abcdef',
            glow: PRISMA_ORB_VISUAL_DEFAULTS.glow,
        });

        expect(normalizePrismaOrbVisualConfig({
            rays: -2,
            speed: 99,
            intensity: Number.NaN,
            size: 10_000,
            core: '#12345',
            glow: '#DFF6FF',
        })).toEqual({
            rays: 0,
            speed: 2,
            intensity: PRISMA_ORB_VISUAL_DEFAULTS.intensity,
            size: 1200,
            core: PRISMA_ORB_VISUAL_DEFAULTS.core,
            glow: '#dff6ff',
        });
    });

    it('saves normalized config, reads it back and emits the same-document event', () => {
        const listener = vi.fn();
        document.addEventListener(PRISMA_ORB_CONFIG_CHANGED_EVENT, listener);

        const saved = savePrismaOrbVisualConfig({
            rays: 0.8,
            speed: 1.5,
            intensity: 1.4,
            size: 640,
            core: '#1240c8',
            glow: '#bfe9ff',
        });

        expect(readPrismaOrbVisualConfig()).toEqual(saved);
        expect(JSON.parse(localStorage.getItem(PRISMA_ORB_STORAGE_KEY) ?? '')).toEqual(saved);
        expect(listener).toHaveBeenCalledTimes(1);
        expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual(saved);

        document.removeEventListener(PRISMA_ORB_CONFIG_CHANGED_EVENT, listener);
    });

    it('preserves the 290px HMI default when saving an untouched config', () => {
        const saved = savePrismaOrbVisualConfig(getDefaultPrismaOrbVisualConfig());

        expect(saved.size).toBe(290);
        expect(readPrismaOrbVisualConfig().size).toBe(290);
    });
});
