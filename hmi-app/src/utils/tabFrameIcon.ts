// =============================================================================
// Tab frame header icon placement
//
// In the tab frame shape the header icon keeps a fixed distance from the widget's right edge (never
// past it). Its preferred top is just below the body's top line (the bottom of the tab strip); when
// the body chamfer is too small for the icon to fit inside the cut triangle there, it moves up just
// enough (into the tab strip if needed) and never above the widget's top edge. When the icon
// occupies the strip, the tab (and its truncating title) must stop before it.
//
// All measures are pixels in the frame's border box, from the `--tab-frame-*` tokens.
// =============================================================================

/** Rendered size of the header icon (`WidgetHeader` draws it at 24). */
export const TAB_FRAME_ICON_SIZE_PX = 24;

export interface TabFrameIconTokens {
    /** Height of the tab strip. */
    tabHeight: number;
    /** Size of the body's top-right chamfer. */
    bodyCut: number;
    /** Fixed distance from the widget's right edge. */
    right: number;
    /** Preferred distance below the body's top line. */
    gap: number;
    /** Clearance kept from the chamfer diagonal (covers the stroke and the rounded vertex). */
    clearance: number;
    /** Lowest allowed top: the icon never rises above the widget's top edge. */
    minTop: number;
    /** Space kept between the end of the tab and the icon when the icon occupies the strip. */
    tabGap: number;
}

export interface TabFrameIconPlacement {
    top: number;
    right: number;
    /** True when the icon overlaps the tab strip vertically. */
    inStrip: boolean;
    /** Space (px) the tab leaves free at the right of the widget: the chamfer, or the icon when it sits in the strip. */
    reserve: number;
}

export function resolveTabFrameIconPlacement(
    tokens: TabFrameIconTokens,
    iconSize = TAB_FRAME_ICON_SIZE_PX,
): TabFrameIconPlacement {
    const { tabHeight, bodyCut, right, gap, clearance, minTop, tabGap } = tokens;
    const preferred = tabHeight + gap;
    // Inside the cut triangle: (x - (W - bodyCut)) >= (y - tabHeight) + clearance at the icon's bottom-left.
    const maxTop = tabHeight + bodyCut - right - 2 * iconSize - clearance;
    const top = Math.max(minTop, Math.min(preferred, maxTop));
    const inStrip = top < tabHeight;
    const reserve = inStrip ? Math.max(bodyCut, right + iconSize + tabGap) : bodyCut;

    return { top, right, inStrip, reserve };
}
