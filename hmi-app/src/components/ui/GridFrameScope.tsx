import type { ReactNode } from 'react';
import {
    GridFrameScopeContext,
    TabFrameReporterContext,
    type TabFrameReporter,
} from '../../hooks/tabFrameContext';

interface GridFrameScopeProps {
    children: ReactNode;
    /**
     * Receives the tab width of the widget rendered inside (see `TabFrameReporter`). Grids pass one
     * per widget (`useTabFrameWidths().reporterFor(id)`) for the layers that follow the silhouette.
     */
    onTabWidth?: TabFrameReporter;
}

/**
 * Marks its subtree as a dashboard grid so `WidgetFrame` may apply the active frame shape
 * (Configuración general -> Tema -> "Forma del marco"). Rendered by `DashboardViewer` and
 * `BuilderCanvas` around their widgets.
 */
export function GridFrameScope({ children, onTabWidth }: GridFrameScopeProps) {
    return (
        <GridFrameScopeContext.Provider value={true}>
            <TabFrameReporterContext.Provider value={onTabWidth ?? null}>{children}</TabFrameReporterContext.Provider>
        </GridFrameScopeContext.Provider>
    );
}
