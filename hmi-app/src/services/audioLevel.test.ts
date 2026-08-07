import { describe, expect, it } from 'vitest';

import { calculateRms, normalizeAudioLevel } from './audioLevel';

const DIRECT_POLICY = {
    noiseFloor: 0,
    gain: 2,
    attack: 1,
    release: 1,
};

describe('audio level calculation', () => {
    it('returns zero for silence and non-finite samples', () => {
        expect(calculateRms(new Float32Array([0, 0, 0]))).toBe(0);
        expect(calculateRms(new Float32Array([Number.NaN, Number.POSITIVE_INFINITY]))).toBe(0);
        expect(normalizeAudioLevel(Number.NaN, 0, DIRECT_POLICY)).toBe(0);
    });

    it('calculates RMS from a known temporal signal', () => {
        expect(calculateRms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
    });

    it('normalizes, smooths, and clamps the result to 0..1', () => {
        expect(normalizeAudioLevel(0.25, 0, DIRECT_POLICY)).toBeCloseTo(0.5);
        expect(normalizeAudioLevel(4, 0, DIRECT_POLICY)).toBe(1);
        expect(normalizeAudioLevel(-1, 0, DIRECT_POLICY)).toBe(0);
        expect(normalizeAudioLevel(0, 0.8, { ...DIRECT_POLICY, release: 0.25 })).toBeCloseTo(0.6);
    });
});
