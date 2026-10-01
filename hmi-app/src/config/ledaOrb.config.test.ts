import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    LEDA_ORB_CONFIG_CHANGED_EVENT,
    LEDA_ORB_STORAGE_KEY,
    LEDA_ORB_VISUAL_DEFAULTS,
    getDefaultLedaOrbVisualConfig,
    normalizeLedaOrbVisualConfig,
    readLedaOrbVisualConfig,
    saveLedaOrbVisualConfig,
} from './ledaOrb.config';

describe('ledaOrb.config', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('pins the tuned orb visual defaults captured from the reference setup', () => {
        expect(LEDA_ORB_VISUAL_DEFAULTS).toEqual({
            rays: 0.45,
            speed: 1.85,
            intensity: 0.8,
            size: 290,
            core: '#1b6ee0',
            glow: '#8ff0ff',
        });
    });

    it('returns independent HMI defaults for empty or corrupt storage', () => {
        expect(readLedaOrbVisualConfig()).toEqual(LEDA_ORB_VISUAL_DEFAULTS);

        const defaults = getDefaultLedaOrbVisualConfig();
        defaults.rays = 0;
        expect(getDefaultLedaOrbVisualConfig()).toEqual(LEDA_ORB_VISUAL_DEFAULTS);

        localStorage.setItem(LEDA_ORB_STORAGE_KEY, '{corrupt');
        expect(readLedaOrbVisualConfig()).toEqual(LEDA_ORB_VISUAL_DEFAULTS);
    });

    it('clamps, snaps and validates every persisted visual value', () => {
        expect(normalizeLedaOrbVisualConfig(LEDA_ORB_VISUAL_DEFAULTS).size).toBe(290);

        expect(normalizeLedaOrbVisualConfig({
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
            glow: LEDA_ORB_VISUAL_DEFAULTS.glow,
        });

        expect(normalizeLedaOrbVisualConfig({
            rays: -2,
            speed: 99,
            intensity: Number.NaN,
            size: 10_000,
            core: '#12345',
            glow: '#DFF6FF',
        })).toEqual({
            rays: 0,
            speed: 2,
            intensity: LEDA_ORB_VISUAL_DEFAULTS.intensity,
            size: 1200,
            core: LEDA_ORB_VISUAL_DEFAULTS.core,
            glow: '#dff6ff',
        });
    });

    it('saves normalized config, reads it back and emits the same-document event', () => {
        const listener = vi.fn();
        document.addEventListener(LEDA_ORB_CONFIG_CHANGED_EVENT, listener);

        const saved = saveLedaOrbVisualConfig({
            rays: 0.8,
            speed: 1.5,
            intensity: 1.4,
            size: 640,
            core: '#1240c8',
            glow: '#bfe9ff',
        });

        expect(readLedaOrbVisualConfig()).toEqual(saved);
        expect(JSON.parse(localStorage.getItem(LEDA_ORB_STORAGE_KEY) ?? '')).toEqual(saved);
        expect(listener).toHaveBeenCalledTimes(1);
        expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual(saved);

        document.removeEventListener(LEDA_ORB_CONFIG_CHANGED_EVENT, listener);
    });

    it('preserves the 290px HMI default when saving an untouched config', () => {
        const saved = saveLedaOrbVisualConfig(getDefaultLedaOrbVisualConfig());

        expect(saved.size).toBe(290);
        expect(readLedaOrbVisualConfig().size).toBe(290);
    });
});
