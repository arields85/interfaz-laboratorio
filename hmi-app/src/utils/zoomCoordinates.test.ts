import { afterEach, describe, expect, it } from 'vitest';
import { getEffectiveZoom, visualToLayoutPx } from './zoomCoordinates';

afterEach(() => {
    document.documentElement.style.removeProperty('--viewport-zoom');
});

describe('getEffectiveZoom', () => {
    it('defaults to 1 when no zoom is applied anywhere', () => {
        expect(getEffectiveZoom()).toBe(1);
    });

    it('reads the zoom mirrored on documentElement via --viewport-zoom', () => {
        document.documentElement.style.setProperty('--viewport-zoom', '1.25');

        expect(getEffectiveZoom()).toBe(1.25);
    });

    it('falls back to 1 when --viewport-zoom is not a finite positive number', () => {
        document.documentElement.style.setProperty('--viewport-zoom', 'not-a-number');
        expect(getEffectiveZoom()).toBe(1);

        document.documentElement.style.setProperty('--viewport-zoom', '0');
        expect(getEffectiveZoom()).toBe(1);

        document.documentElement.style.setProperty('--viewport-zoom', '-2');
        expect(getEffectiveZoom()).toBe(1);
    });

    it('prefers element.currentCSSZoom over the mirrored root value when present', () => {
        document.documentElement.style.setProperty('--viewport-zoom', '1.25');
        const element = document.createElement('div') as Element & { currentCSSZoom?: number };
        element.currentCSSZoom = 1.6;

        expect(getEffectiveZoom(element)).toBe(1.6);
    });

    it('ignores a non-finite or non-positive element.currentCSSZoom and falls back to the root value', () => {
        document.documentElement.style.setProperty('--viewport-zoom', '1.25');
        const element = document.createElement('div') as Element & { currentCSSZoom?: number };
        element.currentCSSZoom = 0;

        expect(getEffectiveZoom(element)).toBe(1.25);
    });
});

describe('visualToLayoutPx', () => {
    it('divides a visual px value by the given zoom', () => {
        expect(visualToLayoutPx(125, 1.25)).toBe(100);
    });

    it('is a no-op at zoom 1', () => {
        expect(visualToLayoutPx(48, 1)).toBe(48);
    });

    it('defaults the zoom to the current effective zoom when not provided', () => {
        document.documentElement.style.setProperty('--viewport-zoom', '2');

        expect(visualToLayoutPx(80)).toBe(40);
    });

    it('returns the input unchanged when zoom is not finite or not positive', () => {
        expect(visualToLayoutPx(80, 0)).toBe(80);
        expect(visualToLayoutPx(80, Number.NaN)).toBe(80);
    });
});
