import { DASHBOARD_TITLE_LINE_HEIGHT } from './dashboardTitleTypography';

// =============================================================================
// Tab frame height for a title with its own size
//
// A title with the typography of the `text-title` widget (the `group` widget) makes the tab as tall
// as its line box plus the vertical breathing space (`--tab-frame-title-pad-y`) above and below, but
// never shorter than the standard tab (`--tab-frame-height`). The tab grows downward, into the
// widget: the outer size of the frame never changes, the body's top line moves down with the tab.
// All measures are pixels.
// =============================================================================

export interface TabFrameHeightInput {
    /** Standard tab height (`--tab-frame-height`): the floor. */
    baseHeight: number;
    /** Title font size in px. */
    titleFontSize: number;
    /** Breathing space above and below the title's line box (`--tab-frame-title-pad-y`). */
    padY: number;
}

export function resolveTabFrameHeight({ baseHeight, titleFontSize, padY }: TabFrameHeightInput): number {
    const titleHeight = titleFontSize * DASHBOARD_TITLE_LINE_HEIGHT + 2 * padY;
    // Never NaN: whatever is not finite drops out, and a title that cannot be measured leaves the base height.
    const floor = Number.isFinite(baseHeight) ? baseHeight : 0;
    const height = Number.isFinite(titleHeight) ? Math.max(floor, titleHeight) : floor;

    return Math.round(height * 100) / 100;
}

export interface TabFrameHeightCapInput {
    /** Tab height (px) the title asks for. */
    tabHeight: number;
    /** Height (px) of the frame's box. */
    frameHeight: number;
    /** Size (px) of the body's top-right chamfer (`--tab-frame-body-cut`). */
    bodyCut: number;
    /** Corner radius (px) of the frame. */
    radius: number;
}

/**
 * Caps the tab so the widget keeps a minimal body: the tab never takes more than the frame height
 * minus the body chamfer minus room for the rounded bottom corners (2 x radius). Without the cap a
 * tall title on a short widget would invert the silhouette. Never NaN: a non-finite frame measure
 * leaves the requested height as it was; the result is never negative.
 */
export function capTabFrameHeight({ tabHeight, frameHeight, bodyCut, radius }: TabFrameHeightCapInput): number {
    const requested = Number.isFinite(tabHeight) ? Math.max(0, tabHeight) : 0;
    const available = frameHeight - bodyCut - 2 * radius;
    const capped = Number.isFinite(available) ? Math.max(0, Math.min(requested, available)) : requested;

    return Math.round(capped * 100) / 100;
}

export interface TabFrameCutInput {
    /** Slanted-side cut (px) of the standard tab (`--tab-frame-tab-cut`). */
    baseCut: number;
    /** Standard tab height (px, `--tab-frame-height`) that `baseCut` belongs to. */
    baseHeight: number;
    /** Effective tab height (px): the standard one, a taller one, or a capped one. */
    tabHeight: number;
}

/**
 * Cut (px) of the tab's slanted side for an effective tab height: the side keeps the angle of the
 * standard tab (`baseCut` over `baseHeight`), so a taller tab is not steeper. The ONE place that
 * derives it: the frame publishes it for the CSS tab and the silhouette, and the layers outside the
 * frame (`useTabFrameGeometry`) derive the same value from the reported height. Never NaN and never
 * negative: a base height that cannot scale (zero, negative, non-finite) or a non-finite tab height
 * leaves the token cut as it is.
 */
export function scaleTabFrameCut({ baseCut, baseHeight, tabHeight }: TabFrameCutInput): number {
    const cut = Number.isFinite(baseCut) ? Math.max(0, baseCut) : 0;

    if (!(Number.isFinite(baseHeight) && baseHeight > 0 && Number.isFinite(tabHeight))) {
        return cut;
    }

    return Math.round(cut * (Math.max(0, tabHeight) / baseHeight) * 100) / 100;
}
