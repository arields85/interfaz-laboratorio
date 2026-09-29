import { describe, expect, it } from 'vitest';
import { resolveTabFrameIconPlacement, TAB_FRAME_ICON_SIZE_PX, type TabFrameIconTokens } from './tabFrameIcon';

const TOKENS: TabFrameIconTokens = {
    tabHeight: 25,
    bodyCut: 50,
    right: 7,
    gap: 4,
    clearance: 3,
    minTop: 1,
    tabGap: 8,
};

describe('resolveTabFrameIconPlacement', () => {
    it('sits at the preferred top (tab height + gap) when the cut triangle is large enough for the icon', () => {
        const placement = resolveTabFrameIconPlacement({ ...TOKENS, bodyCut: 100 });

        expect(placement.top).toBe(29);
        expect(placement.inStrip).toBe(false);
        // Nothing lies in the tab strip: the tab only stops at the start of the body chamfer.
        expect(placement.reserve).toBe(100);
    });

    it('moves up just enough to fit inside the cut triangle when the body cut is small', () => {
        // maxTop = tabHeight + bodyCut - right - 2 * iconSize - clearance = 25 + 50 - 7 - 48 - 3
        const placement = resolveTabFrameIconPlacement(TOKENS);

        expect(placement.top).toBe(TOKENS.tabHeight + TOKENS.bodyCut - TOKENS.right - 2 * TAB_FRAME_ICON_SIZE_PX - TOKENS.clearance);
        expect(placement.top).toBe(17);
        expect(placement.inStrip).toBe(true);
    });

    it('is clamped at the widget top edge (min top) when there is no body cut at all', () => {
        const placement = resolveTabFrameIconPlacement({ ...TOKENS, bodyCut: 0 });

        expect(placement.top).toBe(TOKENS.minTop);
        expect(placement.inStrip).toBe(true);
    });

    it('never rises above the top edge, however negative the fit becomes', () => {
        for (const bodyCut of [0, 5, 20, 33]) {
            expect(resolveTabFrameIconPlacement({ ...TOKENS, bodyCut }).top).toBeGreaterThanOrEqual(TOKENS.minTop);
        }
    });

    it('keeps the fixed right distance in every case (never past the right edge)', () => {
        for (const bodyCut of [0, 50, 100, 300]) {
            expect(resolveTabFrameIconPlacement({ ...TOKENS, bodyCut }).right).toBe(TOKENS.right);
        }
    });

    it('reserves the icon width plus a gap in the tab strip when the icon occupies it and there is no chamfer', () => {
        const placement = resolveTabFrameIconPlacement({ ...TOKENS, bodyCut: 0 });

        expect(placement.reserve).toBe(TOKENS.right + TAB_FRAME_ICON_SIZE_PX + TOKENS.tabGap);
    });

    it('keeps the larger of the chamfer and the icon reservation', () => {
        // Icon in the strip (top 17) at right 7 + 24 + 8 = 39, chamfer 50: the chamfer already clears it.
        expect(resolveTabFrameIconPlacement(TOKENS).reserve).toBe(50);
        // A wide gap token makes the icon the limit.
        expect(resolveTabFrameIconPlacement({ ...TOKENS, tabGap: 30 }).reserve).toBe(7 + 24 + 30);
    });

    it('treats an icon whose top is exactly at the tab height as outside the strip', () => {
        // gap 0 and a big cut: preferred top == tab height.
        const placement = resolveTabFrameIconPlacement({ ...TOKENS, bodyCut: 200, gap: 0 });

        expect(placement.top).toBe(TOKENS.tabHeight);
        expect(placement.inStrip).toBe(false);
    });
});
