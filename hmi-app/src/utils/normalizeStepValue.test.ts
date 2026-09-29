import { describe, expect, it } from 'vitest';
import { normalizeStepValue } from './normalizeStepValue';

describe('normalizeStepValue', () => {
    it('clamps to the range', () => {
        expect(normalizeStepValue(-5, 0, 100, 5)).toBe(0);
        expect(normalizeStepValue(500, 0, 100, 5)).toBe(100);
    });

    it('snaps to the nearest step counted from min, without float noise', () => {
        expect(normalizeStepValue(47, 0, 100, 5)).toBe(45);
        expect(normalizeStepValue(1.13, 0.5, 3, 0.25)).toBe(1.25);
        expect(normalizeStepValue(0.7, 0, 1, 0.1)).toBe(0.7);
    });

    it('keeps a value already on a step', () => {
        expect(normalizeStepValue(2.25, 0.5, 3, 0.25)).toBe(2.25);
    });
});
