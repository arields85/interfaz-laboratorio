import type { ReactNode } from 'react';
import { GridFrameScopeContext } from '../../hooks/tabFrameContext';

/**
 * Marks its subtree as a dashboard grid so `WidgetFrame` may apply the active frame shape
 * (Configuración general -> Tema -> "Forma del marco"). Rendered by `DashboardViewer` and
 * `BuilderCanvas` around their widgets.
 */
export function GridFrameScope({ children }: { children: ReactNode }) {
    return <GridFrameScopeContext.Provider value={true}>{children}</GridFrameScopeContext.Provider>;
}
