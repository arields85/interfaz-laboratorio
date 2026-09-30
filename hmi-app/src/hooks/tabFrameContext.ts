import { createContext } from 'react';

/**
 * True inside a dashboard grid (viewer and builder canvas). The tab frame shape only applies to
 * widgets rendered there; the same renderers used by pages or other surfaces keep the standard
 * frame (see `WidgetFrame`).
 */
export const GridFrameScopeContext = createContext(false);

/** Provided by `WidgetFrame` to its children while it renders the tab shape. */
export interface TabFrameContextValue {
    /** The tab element that receives the header title (null until it is mounted). */
    titleHost: HTMLElement | null;
    /** The shell element that receives the header icon (null until it is mounted). */
    iconHost: HTMLElement | null;
    /**
     * The shell element in the top strip, left of the icon, that receives the header's trailing
     * content (a chart's period selector; null until it is mounted).
     */
    trailingHost: HTMLElement | null;
    /**
     * Where the header's `trailing` content lives: `strip` (the top strip, `trailingHost`) only for the
     * chart widgets that opt in (`supportsTabFrameTrailingStrip`) while it fits in the frame; `body`
     * (the header row of the body, like the standard frame) for every other widget and for a chart
     * whose selector is wider than the frame.
     */
    trailingPlacement: 'strip' | 'body';
    /**
     * True for a chart whose selector fell back to the header row because it does not fit in the strip:
     * that row starts under the strip (`--tab-frame-header-clearance`) and has no slot for the icon.
     * A widget that never opted in keeps its row exactly where it is.
     */
    trailingBelowStrip: boolean;
    /**
     * The header reports the INTRINSIC width (px) of its trailing content (0 when it has none), measured
     * wherever it is rendered; `WidgetFrame` decides the placement from it.
     */
    reportTrailingWidth: (widthPx: number) => void;
    /** Alert state of the widget frame (`widget-state-*`): the tab title takes its color. */
    alertState: TabFrameAlertState | null;
    /**
     * Font size (px) of a title that has its own typography (the `text-title` one, `group` widget), or
     * null for the standard tab title. The tab is then as tall as that title needs (`useTabFrameHeight`).
     */
    titleFontSize: number | null;
}

export type TabFrameAlertState = 'warning' | 'critical';

/**
 * True inside the trailing host of a tab frame (the top strip). Controls that have a strip look
 * (the period selector's `underline` variant) read it to pick it in ONE place instead of each
 * widget repeating the condition.
 */
export const TabFrameStripContext = createContext(false);

/** `null` whenever the enclosing frame is not the tab shape: headers then render as today. */
export const TabFrameContext = createContext<TabFrameContextValue | null>(null);

/**
 * Receives the width of the tab (px, at its base) of the enclosing `WidgetFrame` while it renders
 * the tab shape, and `null` when it stops (standard shape, unmount). The grids provide one per
 * widget so sibling layers that cannot see the tab (builder selection ring, placement ghost, viewer
 * entrance overlays, hover actions) can follow the tab + body silhouette. A frame whose tab is
 * taller than the standard one (a title with its own size) passes the effective tab height (px) as
 * the second argument; without it the layers read `--tab-frame-height`. `0` means the tab is not
 * measured yet; `TAB_FRAME_TITLE_HIDDEN` (`utils/tabFramePath.ts`) means the frame hid its title tab
 * (a chart whose selector leaves the title no room): the silhouette then has no tab.
 */
export type TabFrameReporter = (tabWidthPx: number | null, tabHeightPx?: number) => void;

export const TabFrameReporterContext = createContext<TabFrameReporter | null>(null);
