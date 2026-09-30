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
