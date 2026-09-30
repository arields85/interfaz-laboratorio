// =============================================================================
// Tab frame trailing content
//
// Chart widgets carry a period selector in the header (`WidgetHeader.trailing`). In the tab frame
// shape it moves up into the top strip, right side, immediately left of the header icon, and the
// title tab stops before it: the tab's reserve is the selector's width plus its right offset plus
// one gap (`--tab-frame-trailing-gap`). When the room left for the title label (the tab minus its
// slanted side and paddings) is under `--tab-frame-min-title`, the title tab is hidden cleanly
// instead of being drawn under the selector.
//
// Pure pixel maths; `WidgetFrame` measures the shell and the trailing host and reads the tokens.
// =============================================================================

export interface TabFrameTrailingInput {
    /** Width of the frame (shell). 0 = not measured yet. */
    frameWidth: number;
    /** Space the tab already leaves at the right for the icon or the body chamfer (`resolveTabFrameIconPlacement`). */
    baseReserve: number;
    /** Fixed distance of the strip content from the frame's right edge (`--tab-frame-icon-right`). */
    right: number;
    /** Measured width of the trailing host, its icon offset included. 0 = no trailing content. */
    hostWidth: number;
    /** Gap between the elements of the strip (`--tab-frame-trailing-gap`). */
    gap: number;
    /** Horizontal size of the tab's slanted side. */
    tabCut: number;
    /** Tab paddings around the label. */
    padStart: number;
    padEnd: number;
    /** Least room (px) the title label needs to be shown (`--tab-frame-min-title`). */
    minTitle: number;
}

export interface TabFrameTrailingLayout {
    /** Space (px) the tab leaves free at the right of the frame. */
    reserve: number;
    /** Room (px) left for the title label; may be negative. */
    titleRoom: number;
    /** True when the title tab must not be shown. */
    titleHidden: boolean;
}

function finite(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

export function resolveTabFrameTrailing(input: TabFrameTrailingInput): TabFrameTrailingLayout {
    const baseReserve = finite(input.baseReserve);
    const hostWidth = Math.max(0, finite(input.hostWidth));
    const hasTrailing = hostWidth > 0;
    const reserve = hasTrailing
        ? Math.max(baseReserve, finite(input.right) + hostWidth + Math.max(0, finite(input.gap)))
        : baseReserve;
    const frameWidth = finite(input.frameWidth);
    const titleRoom = frameWidth - reserve - finite(input.tabCut) - finite(input.padStart) - finite(input.padEnd);

    return {
        reserve,
        titleRoom,
        // Only a frame with strip content hides its title, and only once it has been measured.
        titleHidden: hasTrailing && frameWidth > 0 && titleRoom < finite(input.minTitle),
    };
}

/**
 * Space (px) the trailing host keeps free at its right for the header icon: the scaled icon plus
 * one gap when the icon occupies the strip, nothing when it sits lower (inside the body chamfer).
 */
export function resolveTabFrameStripExtent({ inStrip, iconSize, gap }: {
    inStrip: boolean;
    iconSize: number;
    gap: number;
}): number {
    return inStrip ? Math.round((finite(iconSize) + Math.max(0, finite(gap))) * 100) / 100 : 0;
}
