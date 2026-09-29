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
}

/** `null` whenever the enclosing frame is not the tab shape: headers then render as today. */
export const TabFrameContext = createContext<TabFrameContextValue | null>(null);

/**
 * Receives the width of the tab (px, at its base) of the enclosing `WidgetFrame` while it renders
 * the tab shape, and `null` when it stops (standard shape, unmount). The grids provide one per
 * widget so sibling layers that cannot see the tab (builder selection ring, placement ghost, viewer
 * entrance overlays) can follow the tab + body silhouette.
 */
export type TabFrameReporter = (tabWidthPx: number | null) => void;

export const TabFrameReporterContext = createContext<TabFrameReporter | null>(null);
