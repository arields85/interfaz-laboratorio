import { describe, expect, it } from 'vitest';
import { resolveTabFrameHeight } from './tabFrameHeight';

describe('resolveTabFrameHeight', () => {
    it('never goes below the standard tab height', () => {
        // 12 px title: 12 x 1.1 + 2 x 4.25 = 21.7 < 25.
        expect(resolveTabFrameHeight({ baseHeight: 25, titleFontSize: 12, padY: 4.25 })).toBe(25);
    });

    it('grows with the title: line box (font size x line height) plus the breathing space above and below', () => {
        // 35 x 1.1 + 2 x 4.25 = 47.
        expect(resolveTabFrameHeight({ baseHeight: 25, titleFontSize: 35, padY: 4.25 })).toBe(47);
        expect(resolveTabFrameHeight({ baseHeight: 25, titleFontSize: 60, padY: 4.25 })).toBe(74.5);
    });

    it('takes the vertical space from the token: a bigger pad makes a taller tab', () => {
        expect(resolveTabFrameHeight({ baseHeight: 25, titleFontSize: 35, padY: 8 })).toBe(54.5);
    });

    it('rounds float noise to two decimals', () => {
        expect(resolveTabFrameHeight({ baseHeight: 25, titleFontSize: 33, padY: 4.25 })).toBe(44.8);
    });

    it('never returns NaN: a non-finite title size or padding falls back to the standard tab height', () => {
        expect(resolveTabFrameHeight({ baseHeight: 25, titleFontSize: Number.NaN, padY: 4.25 })).toBe(25);
        expect(resolveTabFrameHeight({ baseHeight: 25, titleFontSize: Number.POSITIVE_INFINITY, padY: 4.25 })).toBe(25);
        expect(resolveTabFrameHeight({ baseHeight: 25, titleFontSize: 35, padY: Number.NaN })).toBe(25);
    });

    it('never returns NaN even when the standard height itself is not finite', () => {
        expect(resolveTabFrameHeight({ baseHeight: Number.NaN, titleFontSize: 35, padY: 4.25 })).toBe(47);
        expect(resolveTabFrameHeight({ baseHeight: Number.NaN, titleFontSize: Number.NaN, padY: 4.25 })).toBe(0);
    });
});
