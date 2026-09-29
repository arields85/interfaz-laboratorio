import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { ViewerPersistedWidgetDisplayPatch, WidgetConfig, WidgetLayout } from '../../domain/admin.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import type { ContractMachine, ConnectionHealth } from '../../domain/dataContract.types';
import type { HierarchyContext } from '../../widgets/resolvers/hierarchyResolver';
import { useCanvasReference } from '../../utils/useCanvasReference';
import { DEFAULT_COLS, DEFAULT_ROWS, getGridTemplateStyle } from '../../utils/gridConfig';
import {
    orderRenderItemsWithGroupsFirst,
    resolveEffectiveNavigationTarget,
    resolveHoveredGroupId,
    resolveWidgetSurfaceInset,
} from '../../utils/groupWidget';
import { resolveViewerEntranceOrders } from '../../utils/viewerEntrance';
import WidgetPresentationBoundary from './WidgetPresentationBoundary';
import ViewerEntranceFrameOverlays from './ViewerEntranceFrameOverlays';
import { ViewerEntranceContext } from '../../hooks/useViewerEntranceCountUp';

interface DashboardViewerProps {
    widgets: WidgetConfig[];
    layout: WidgetLayout[];
    equipmentMap: Map<string, EquipmentSummary>;
    machines?: ContractMachine[];
    connection?: ConnectionHealth;
    isLoadingOverview?: boolean;
    hasOverviewError?: boolean;
    /**
     * IDs de widgets asignados al header del dashboard.
     * Estos widgets son EXCLUSIVOS del header y se omiten del grid.
     * Viene de `dashboard.headerConfig.widgetSlots`.
     */
    headerWidgetIds?: Set<string>;
    hierarchyContext?: HierarchyContext;
    cols?: number;
    rows?: number;
    onPersistWidgetDisplayOptions?: (widgetId: string, displayOptions: ViewerPersistedWidgetDisplayPatch) => void;
    onNavigateDashboard?: (dashboardId: string) => void;
    /**
     * Replay key of the entrance animation (see `buildViewerEntranceKey`): dashboard id + active
     * view id. A new key remounts the grid and replays the entrance; a data refresh keeps it.
     * Omit it to render without any entrance animation.
     */
    entranceKey?: string;
    /** Random source of the entrance stagger; injectable so tests are deterministic. */
    entranceRandom?: () => number;
}

type ViewerEntranceItemStyle = CSSProperties & {
    '--viewer-entrance-order'?: number;
};

// =============================================================================
// DashboardViewer
// Renderizador estático para el Visor Público.
// Replica el grid de BuilderCanvas pero elimina toda interacción de
// arrastrar, soltar, seleccionar o reordenar.
//
// Los widgets asignados al header (headerWidgetIds) se excluyen del grid
// para evitar duplicación: el header los renderiza vía DashboardHeader.
//
// La altura de las filas se calcula dinámicamente via ResizeObserver para
// que el grid llene el viewport exactamente — sin scroll (HMI single-screen).
// El número de columnas se calcula via useGridCols sobre el mismo contenedor.
//
// Especificación Funcional Modo Admin §11
// =============================================================================

export default function DashboardViewer({ 
    widgets, 
    layout, 
    equipmentMap,
    machines,
    connection,
    isLoadingOverview = false,
    hasOverviewError = false,
    headerWidgetIds,
    hierarchyContext,
    cols = DEFAULT_COLS,
    rows = DEFAULT_ROWS,
    onPersistWidgetDisplayOptions,
    onNavigateDashboard,
    entranceKey,
    entranceRandom,
}: DashboardViewerProps) {
    const { containerRef, width, height, rowHeight, hasFirstValidMeasurement } = useCanvasReference({
        cols,
        rows,
    });

    const widgetMap = new Map(widgets.map(w => [w.id, w]));

    // G5 group hover: shared state so a locked group's container can show its hover look while
    // the pointer is anywhere over the group (container or any member) — they are sibling grid
    // items, not DOM parent/child, so plain CSS `:hover` can't reach across them on its own.
    // `sourceWidgetId` guards mouseleave: only the item that last set the hover clears it, so a
    // fresh mouseenter on another item is never clobbered by a stale mouseleave.
    const [hoveredGroup, setHoveredGroup] = useState<{ groupId: string; sourceWidgetId: string } | null>(null);

    // G7(b): render order is owned by `orderRenderItemsWithGroupsFirst`, not by `layout` array
    // order — a group container must ALWAYS paint beneath every other widget, locked or not.
    const orderedLayout = orderRenderItemsWithGroupsFirst(layout, widgets);

    // Entrance: the stagger is drawn once per entry (entranceKey) and kept while the key holds, so
    // a data refresh never reshuffles or replays it. It is pure presentation: data queries are not
    // gated by it. Render-phase state adjustment is the sanctioned way to reset state on a new key.
    const [entrance, setEntrance] = useState<{ key: string | undefined; orders: Map<string, number> }>(
        () => ({ key: undefined, orders: new Map() }),
    );
    let entranceOrders = entrance.orders;
    if (entranceKey !== undefined && entrance.key !== entranceKey) {
        const renderedWidgetIds = orderedLayout
            .filter((item) => !headerWidgetIds?.has(item.widgetId) && widgetMap.has(item.widgetId))
            .map((item) => item.widgetId);
        entranceOrders = resolveViewerEntranceOrders(widgets, renderedWidgetIds, entranceRandom);
        setEntrance({ key: entranceKey, orders: entranceOrders });
    }

    return (
        <div
            ref={containerRef}
            data-testid="dashboard-viewer-root"
            className="flex h-full w-full items-center justify-center overflow-hidden"
        >
            {hasFirstValidMeasurement ? (
                <div
                    key={entranceKey}
                    data-testid="dashboard-viewer-frame"
                    data-viewer-entrance={entranceKey !== undefined ? 'true' : undefined}
                    className="grid shrink-0"
                    style={{
                        ...getGridTemplateStyle(cols),
                        gridTemplateRows: `repeat(${rows}, ${rowHeight}px)`,
                        width: `${width}px`,
                        height: `${height}px`,
                        gap: 0,
                    }}
                >
                    {orderedLayout.map((item) => {
                        if (headerWidgetIds?.has(item.widgetId)) return null;

                        const widget = widgetMap.get(item.widgetId);
                        if (!widget) return null;

                        // D3 click priority: a member without its own navigation target
                        // inherits its locked group's target (the member's own target still
                        // wins); resolved once here so the existing generic navigation wrapper
                        // in WidgetRenderer needs no changes at all.
                        const effectiveWidget: WidgetConfig = {
                            ...widget,
                            navigationTargetDashboardId: resolveEffectiveNavigationTarget(widget, widgets),
                        };

                        // G5 group hover: which locked group (if any) hovering THIS item should
                        // mark as hovered — its own id for the container, or its owning group's
                        // id for a member.
                        const hoverGroupIdForThisItem = resolveHoveredGroupId(widget.id, widgets);

                        const entranceStyle: ViewerEntranceItemStyle | undefined = entranceKey !== undefined
                            ? { '--viewer-entrance-order': entranceOrders.get(widget.id) ?? 0 }
                            : undefined;

                        return (
                            <div
                                key={widget.id}
                                data-testid={`dashboard-viewer-item-${widget.id}`}
                                data-group-hover-target={hoveredGroup?.groupId === widget.id ? 'true' : undefined}
                                className={entranceKey !== undefined ? 'h-full relative hmi-viewer-entrance-item' : 'h-full relative'}
                                style={{
                                    ...entranceStyle,
                                    gridColumnStart: item.x + 1,
                                    gridColumnEnd: `span ${item.w}`,
                                    gridRowStart: item.y + 1,
                                    gridRowEnd: `span ${item.h}`,
                                }}
                                onMouseEnter={() => {
                                    if (hoverGroupIdForThisItem) {
                                        setHoveredGroup({ groupId: hoverGroupIdForThisItem, sourceWidgetId: widget.id });
                                    }
                                }}
                                onMouseLeave={() => {
                                    setHoveredGroup((prev) => (prev?.sourceWidgetId === widget.id ? null : prev));
                                }}
                            >
                                <div
                                    data-testid={`dashboard-viewer-item-surface-${widget.id}`}
                                    className="relative z-0 h-full w-full box-border"
                                    style={{ padding: resolveWidgetSurfaceInset(widget) }}
                                >
                                    <ViewerEntranceContext.Provider value={entranceKey !== undefined ? (entranceOrders.get(widget.id) ?? 0) : null}>
                                        <WidgetPresentationBoundary
                                            widget={effectiveWidget}
                                            equipmentMap={equipmentMap}
                                            machines={machines}
                                            connection={connection}
                                            isLoadingOverview={isLoadingOverview}
                                            hasOverviewError={hasOverviewError}
                                            isLoadingData={false}
                                            siblingWidgets={widgets}
                                            hierarchyContext={hierarchyContext}
                                            onPersistWidgetDisplayOptions={onPersistWidgetDisplayOptions}
                                            onNavigateDashboard={onNavigateDashboard}
                                            className="w-full h-full"
                                        />
                                    </ViewerEntranceContext.Provider>
                                    {entranceKey !== undefined && widget.type !== 'text-title' ? (
                                        <ViewerEntranceFrameOverlays
                                            widgetId={widget.id}
                                            inset={resolveWidgetSurfaceInset(widget)}
                                        />
                                    ) : null}
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
