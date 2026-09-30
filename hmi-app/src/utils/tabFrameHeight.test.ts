import { describe, expect, it } from 'vitest';
import { capTabFrameHeight, resolveTabFrameHeight, scaleTabFrameCut } from './tabFrameHeight';

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

describe('capTabFrameHeight', () => {
    // Minimum body = the body chamfer plus room for the rounded bottom corners (2 x radius).
    it('keeps a tab that leaves the minimum body free', () => {
        expect(capTabFrameHeight({ tabHeight: 47, frameHeight: 200, bodyCut: 0, radius: 4 })).toBe(47);
    });

    it('caps the tab to the frame height minus the minimum body (chamfer + 2 x radius)', () => {
        expect(capTabFrameHeight({ tabHeight: 228.5, frameHeight: 60, bodyCut: 0, radius: 4 })).toBe(52);
        expect(capTabFrameHeight({ tabHeight: 228.5, frameHeight: 60, bodyCut: 10, radius: 4 })).toBe(42);
    });

    it('never goes below zero', () => {
        expect(capTabFrameHeight({ tabHeight: 47, frameHeight: 5, bodyCut: 50, radius: 24 })).toBe(0);
    });

    it('never returns NaN: a non-finite input leaves the tab height as it was', () => {
        expect(capTabFrameHeight({ tabHeight: 47, frameHeight: Number.NaN, bodyCut: 0, radius: 4 })).toBe(47);
        expect(capTabFrameHeight({ tabHeight: 47, frameHeight: 200, bodyCut: Number.NaN, radius: 4 })).toBe(47);
        expect(capTabFrameHeight({ tabHeight: Number.NaN, frameHeight: 200, bodyCut: 0, radius: 4 })).toBe(0);
    });
});

describe('scaleTabFrameCut', () => {
    // The slanted side keeps the angle of the standard tab: cut 19 over height 25.
    it('keeps the token cut for the standard tab height', () => {
        expect(scaleTabFrameCut({ baseCut: 19, baseHeight: 25, tabHeight: 25 })).toBe(19);
    });

    it('scales the cut with the tab height so the angle never changes', () => {
        expect(scaleTabFrameCut({ baseCut: 19, baseHeight: 25, tabHeight: 47 })).toBe(35.72);
        expect(scaleTabFrameCut({ baseCut: 19, baseHeight: 25, tabHeight: 74.5 })).toBe(56.62);
        expect(19 / 25).toBeCloseTo(35.72 / 47, 10);
    });

    it('scales the capped height like any other, down to nothing for a tab with no height', () => {
        expect(scaleTabFrameCut({ baseCut: 19, baseHeight: 25, tabHeight: 52 })).toBe(39.52);
        expect(scaleTabFrameCut({ baseCut: 19, baseHeight: 25, tabHeight: 0 })).toBe(0);
    });

    it('follows the tokens: another slope keeps its own angle', () => {
        expect(scaleTabFrameCut({ baseCut: 10, baseHeight: 20, tabHeight: 40 })).toBe(20);
    });

    it('falls back to the token cut when the base height cannot scale (zero, negative or non-finite)', () => {
        for (const baseHeight of [0, -25, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(scaleTabFrameCut({ baseCut: 19, baseHeight, tabHeight: 47 })).toBe(19);
        }
    });

    it('falls back to the token cut when the tab height is not finite', () => {
        expect(scaleTabFrameCut({ baseCut: 19, baseHeight: 25, tabHeight: Number.NaN })).toBe(19);
        expect(scaleTabFrameCut({ baseCut: 19, baseHeight: 25, tabHeight: Number.POSITIVE_INFINITY })).toBe(19);
    });

    it('never returns NaN or a negative cut', () => {
        expect(scaleTabFrameCut({ baseCut: Number.NaN, baseHeight: 25, tabHeight: 47 })).toBe(0);
        expect(scaleTabFrameCut({ baseCut: 19, baseHeight: 25, tabHeight: -10 })).toBe(0);
    });
});
