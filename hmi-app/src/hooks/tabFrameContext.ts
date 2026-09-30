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
    /** Alert state of the widget frame (`widget-state-*`): the tab title takes its color. */
    alertState: TabFrameAlertState | null;
    /**
     * Font size (px) of a title that has its own typography (the `text-title` one, `group` widget), or
     * null for the standard tab title. The tab is then as tall as that title needs (`useTabFrameHeight`).
     */
    titleFontSize: number | null;
}

export type TabFrameAlertState = 'warning' | 'critical';

/** `null` whenever the enclosing frame is not the tab shape: headers then render as today. */
export const TabFrameContext = createContext<TabFrameContextValue | null>(null);

/**
 * Receives the width of the tab (px, at its base) of the enclosing `WidgetFrame` while it renders
 * the tab shape, and `null` when it stops (standard shape, unmount). The grids provide one per
 * widget so sibling layers that cannot see the tab (builder selection ring, placement ghost, viewer
 * entrance overlays, hover actions) can follow the tab + body silhouette. A frame whose tab is
 * taller than the standard one (a title with its own size) passes the effective tab height (px) as
 * the second argument; without it the layers read `--tab-frame-height`.
 */
export type TabFrameReporter = (tabWidthPx: number | null, tabHeightPx?: number) => void;

export const TabFrameReporterContext = createContext<TabFrameReporter | null>(null);
