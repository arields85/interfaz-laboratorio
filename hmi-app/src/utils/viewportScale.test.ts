import { describe, expect, it } from 'vitest';
import {
    computeDampedViewportZoom,
    MIN_LAYOUT_WIDTH_PX,
    VIEWPORT_SCALE_DAMPING_EXPONENT,
    VIEWPORT_SCALE_REFERENCE_WIDTH_PX,
} from './viewportScale';

describe('computeDampedViewportZoom', () => {
    it('returns exactly 1 at the 1920px design reference width (structural no-op)', () => {
        expect(computeDampedViewportZoom(VIEWPORT_SCALE_REFERENCE_WIDTH_PX)).toBe(1);
    });

    it('floors the zoom at a 1440px viewport (laptop) so the layout width never drops below MIN_LAYOUT_WIDTH_PX (PW-007 T5b)', () => {
        // Pure damped curve alone would be ~0.8414 (below), but the minimum
        // layout width floor caps it lower: zoom = 1440 / MIN_LAYOUT_WIDTH_PX.
        const pureDampedZoom = (1440 / VIEWPORT_SCALE_REFERENCE_WIDTH_PX) ** VIEWPORT_SCALE_DAMPING_EXPONENT;
        const zoom = computeDampedViewportZoom(1440);

        expect(zoom).toBeLessThan(pureDampedZoom);
        expect(zoom).toBeCloseTo(1440 / MIN_LAYOUT_WIDTH_PX, 5);
        expect(1440 / zoom).toBeCloseTo(MIN_LAYOUT_WIDTH_PX, 5);
    });

    it('returns a damped zoom above 1 for a 2560px viewport (~1.19, unaffected by the floor)', () => {
        expect(computeDampedViewportZoom(2560)).toBeCloseTo(1.1884, 3);
    });

    it('floors the zoom at a 1280px viewport (TV) so the layout width never drops below MIN_LAYOUT_WIDTH_PX (PW-007 T5b)', () => {
        const zoom = computeDampedViewportZoom(1280);

        expect(zoom).toBeCloseTo(1280 / MIN_LAYOUT_WIDTH_PX, 5);
        expect(1280 / zoom).toBeCloseTo(MIN_LAYOUT_WIDTH_PX, 5);
    });

    it('never applies the floor at or above the 1920px design reference width', () => {
        expect(computeDampedViewportZoom(VIEWPORT_SCALE_REFERENCE_WIDTH_PX)).toBe(1);
        expect(computeDampedViewportZoom(2560)).toBeGreaterThan(1);
    });

    it('exposes MIN_LAYOUT_WIDTH_PX as a single named constant below the design reference width', () => {
        expect(MIN_LAYOUT_WIDTH_PX).toBeGreaterThan(0);
        expect(MIN_LAYOUT_WIDTH_PX).toBeLessThan(VIEWPORT_SCALE_REFERENCE_WIDTH_PX);
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
        // 2560px is unaffected by the minimum layout width floor, so this
        // isolates pure factor multiplication on top of the damped curve.
        const baseline = computeDampedViewportZoom(2560);
        expect(computeDampedViewportZoom(2560, 1.1)).toBeCloseTo(baseline * 1.1, 10);
    });

    it('clamps a fine-tune factor by the minimum layout width floor so the floor stays a hard guarantee (PW-007 T5b + T4)', () => {
        // At 1440px the floor is already active. A factor > 1 would shrink
        // the layout width further (viewportWidth / zoom) if it were applied
        // after the floor instead of before it — the floor must still cap the
        // final result, regardless of the fine-tune factor dialed in.
        const withoutFactor = computeDampedViewportZoom(1440);
        const withFactor = computeDampedViewportZoom(1440, 1.5);

        expect(withFactor).toBe(withoutFactor);
        expect(1440 / withFactor).toBeCloseTo(MIN_LAYOUT_WIDTH_PX, 5);
    });

    it('ignores an invalid factor and falls back to factor = 1', () => {
        expect(computeDampedViewportZoom(1440, 0)).toBeCloseTo(computeDampedViewportZoom(1440), 10);
        expect(computeDampedViewportZoom(1440, Number.NaN)).toBeCloseTo(computeDampedViewportZoom(1440), 10);
    });
});
