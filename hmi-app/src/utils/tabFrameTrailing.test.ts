import { describe, expect, it } from 'vitest';
import { resolveTabFrameStripExtent, resolveTabFrameTrailing, type TabFrameTrailingInput } from './tabFrameTrailing';

// Chart widgets put the header's trailing content (the period selector) in the top strip, left of
// the icon: the title tab stops before it and is hidden when it cannot keep a minimal label.
const INPUT: TabFrameTrailingInput = {
    frameWidth: 460,
    baseReserve: 29.6,
    right: 0,
    hostWidth: 157,
    gap: 15,
    tabCut: 19,
    padStart: 10,
    padEnd: 4.8,
    minTitle: 12,
};

describe('resolveTabFrameTrailing', () => {
    it('reserves the host, its right offset and the gap on top of the tab: the tab ends one gap before the selector', () => {
        const layout = resolveTabFrameTrailing(INPUT);

        expect(layout.reserve).toBe(172);
        expect(layout.titleRoom).toBe(460 - 172 - 19 - 10 - 4.8);
        expect(layout.titleHidden).toBe(false);
    });

    it('never reserves less than what the icon or the body chamfer already reserve', () => {
        expect(resolveTabFrameTrailing({ ...INPUT, baseReserve: 400 }).reserve).toBe(400);
    });

    it('leaves a frame without trailing content exactly as it was (no reserve change, never hidden)', () => {
        const layout = resolveTabFrameTrailing({ ...INPUT, hostWidth: 0, frameWidth: 20 });

        expect(layout.reserve).toBe(29.6);
        expect(layout.titleHidden).toBe(false);
    });

    it('hides the title tab when the room left for the label is under the minimum', () => {
        // 460 wide with a 157 px host leaves 254.2; shrink the frame until 11.9 px remain.
        const width = 172 + 19 + 10 + 4.8 + 11.9;

        expect(resolveTabFrameTrailing({ ...INPUT, frameWidth: width }).titleHidden).toBe(true);
    });

    it('keeps the title tab at exactly the minimum room', () => {
        const width = 172 + 19 + 10 + 4.8 + 12;

        expect(resolveTabFrameTrailing({ ...INPUT, frameWidth: width }).titleHidden).toBe(false);
    });

    it('does not hide anything before the frame is measured', () => {
        expect(resolveTabFrameTrailing({ ...INPUT, frameWidth: 0 }).titleHidden).toBe(false);
    });

    it('sanitizes non-finite inputs instead of returning NaN', () => {
        const layout = resolveTabFrameTrailing({ ...INPUT, hostWidth: Number.NaN, gap: Number.NaN });

        expect(Number.isFinite(layout.reserve)).toBe(true);
        expect(Number.isFinite(layout.titleRoom)).toBe(true);
    });
});

describe('resolveTabFrameStripExtent', () => {
    it('is the scaled icon plus one gap when the icon sits in the strip (the selector stops one gap before it)', () => {
        expect(resolveTabFrameStripExtent({ inStrip: true, iconSize: 21.6, gap: 15 })).toBe(36.6);
    });

    it('is zero when the icon is lower, inside the body chamfer', () => {
        expect(resolveTabFrameStripExtent({ inStrip: false, iconSize: 21.6, gap: 15 })).toBe(0);
    });
});
