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
