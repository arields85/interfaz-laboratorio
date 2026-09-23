import { describe, expect, it } from 'vitest';
import {
    computeDampedViewportZoom,
    VIEWPORT_SCALE_DAMPING_EXPONENT,
    VIEWPORT_SCALE_REFERENCE_WIDTH_PX,
} from './viewportScale';

describe('computeDampedViewportZoom', () => {
    it('returns exactly 1 at the 1920px design reference width (structural no-op)', () => {
        expect(computeDampedViewportZoom(VIEWPORT_SCALE_REFERENCE_WIDTH_PX)).toBe(1);
    });

    it('returns a damped zoom below 1 for a 1440px viewport (~0.84)', () => {
        expect(computeDampedViewportZoom(1440)).toBeCloseTo(0.8414, 3);
    });

    it('returns a damped zoom above 1 for a 2560px viewport (~1.19)', () => {
        expect(computeDampedViewportZoom(2560)).toBeCloseTo(1.1884, 3);
    });

    it('is monotonically increasing with viewport width', () => {
        const widths = [1024, 1280, 1366, 1440, 1600, 1920, 2048, 2560, 3440];
        const zooms = widths.map((width) => computeDampedViewportZoom(width));

        for (let index = 1; index < zooms.length; index += 1) {
            expect(zooms[index]).toBeGreaterThan(zooms[index - 1]);
        }
    });

    it('uses the documented reference width and damping exponent constants', () => {
        expect(VIEWPORT_SCALE_REFERENCE_WIDTH_PX).toBe(1920);
        expect(VIEWPORT_SCALE_DAMPING_EXPONENT).toBe(0.6);
    });

    it('falls back to 1 for a zero width', () => {
        expect(computeDampedViewportZoom(0)).toBe(1);
    });

    it('falls back to 1 for a negative width', () => {
        expect(computeDampedViewportZoom(-100)).toBe(1);
    });

    it('falls back to 1 for a NaN width', () => {
        expect(computeDampedViewportZoom(Number.NaN)).toBe(1);
    });

    it('falls back to 1 for an infinite width', () => {
        expect(computeDampedViewportZoom(Number.POSITIVE_INFINITY)).toBe(1);
    });

    it('composes an optional fine-tune factor for later per-device calibration (PW-007 T4)', () => {
        const baseline = computeDampedViewportZoom(1440);
        expect(computeDampedViewportZoom(1440, 1.1)).toBeCloseTo(baseline * 1.1, 10);
    });

    it('ignores an invalid factor and falls back to factor = 1', () => {
        expect(computeDampedViewportZoom(1440, 0)).toBeCloseTo(computeDampedViewportZoom(1440), 10);
        expect(computeDampedViewportZoom(1440, Number.NaN)).toBeCloseTo(computeDampedViewportZoom(1440), 10);
    });
});
