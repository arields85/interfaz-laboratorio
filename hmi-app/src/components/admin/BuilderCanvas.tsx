import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Trash2, ArrowUp, LayoutDashboard, Lock, LockOpen } from 'lucide-react';
import { isGroupWidget, type GroupWidgetConfig, type WidgetConfig, type WidgetLayout } from '../../domain/admin.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import type { ContractMachine, ConnectionHealth } from '../../domain/dataContract.types';
import type { HierarchyContext } from '../../widgets/resolvers/hierarchyResolver';
import GridSelectionFrame from '../ui/GridSelectionFrame';
import WidgetHoverActions from '../ui/WidgetHoverActions';
import CursorTooltip from '../ui/CursorTooltip';
import {
    HEADER_WIDGET_SLOT_COUNT,
    type HeaderWidgetDragPayload,
    isHeaderCompatibleWidget,
} from '../../utils/headerWidgets';
import AdminEmptyState from './AdminEmptyState';
import { useCanvasReference } from '../../utils/useCanvasReference';
import { clampWidgetBounds, DEFAULT_COLS, DEFAULT_ROWS, getGridTemplateStyle } from '../../utils/gridConfig';
import { useUIStore } from '../../store/ui.store';
import {
    applyPointerDeltaToPixelBounds,
    isResizeInteraction,
    layoutToPixelBounds,
    pixelBoundsToGridBounds,
    resizeCursor,
    type ResizeDirection,
    type WidgetInteractionMetrics,
    type WidgetInteractionType,
    type WidgetPixelBounds,
} from '../../utils/widgetInteraction';
import {
    clampGroupMoveDelta,
    clampGroupResizeToMembers,
    computeMembersBoundingBox,
    sanitizeGroupMemberIds,
    type LayoutRect,
} from '../../utils/groupWidget';
import type { TrendChartV2RenderContext } from '../../widgets/renderers/trendChartV2RenderContext';
import WidgetPresentationBoundary from '../viewer/WidgetPresentationBoundary';
import { getEffectiveZoom, visualToLayoutPx } from '../../utils/zoomCoordinates';

interface BuilderCanvasProps {
    widgets: WidgetConfig[];
    layout: WidgetLayout[];
    equipmentMap: Map<string, EquipmentSummary>;
    connection?: ConnectionHealth;
    machines?: ContractMachine[];
    hierarchyContext?: HierarchyContext;
    onWidgetSelect?: (widgetId: string | undefined) => void;
    selectedWidgetId?: string;
    onResize?: (widgetId: string, w: number, h: number) => void;
    onLayoutCommit?: (layout: WidgetLayout) => void;
    onDelete?: (widgetId: string) => void;
    onDuplicate?: (widgetId: string) => void;
    onToggleGroupLock?: (widgetId: string) => void;
    onGroupLayoutCommit?: (layouts: WidgetLayout[]) => void;
    onWidgetDragChange?: (payload: HeaderWidgetDragPayload | null) => void;
    headerWidgetIds?: Set<string>;
    headerOccupiedSlotCount?: number;
    onPromoteToHeader?: (widgetId: string) => void;
    cols?: number;
    rows?: number;
}

const DRAG_THRESHOLD_PX = 3;
const RESIZE_TOOLTIP_OFFSET_PX = 12;
const GRID_MAJOR_INTERVAL_CELLS = 2;
const GRID_MAJOR_DASH_LENGTH_PX = 8;
const GRID_MAJOR_DASH_GAP_PX = 6;

interface InteractionState {
    widgetId: string;
    type: WidgetInteractionType;
    startPointer: { x: number; y: number };
    currentPointer: { x: number; y: number };
    startLayout: Pick<WidgetLayout, 'x' | 'y' | 'w' | 'h'>;
    startBounds: WidgetPixelBounds;
    tentativeBounds: WidgetPixelBounds;
    hasExceededThreshold: boolean;
    /** True when `widgetId` is a member of a currently locked group: selectable, never draggable/resizable (G2). */
    isLockedMember: boolean;
    /** Sanitized member ids of the group being dragged, when `widgetId` is a locked group container (G3). Empty otherwise. */
    groupMemberIds: string[];
    /** Members' pre-drag layout, aligned by index with `groupMemberIds`. */
    groupMemberStartLayouts: Pick<WidgetLayout, 'x' | 'y' | 'w' | 'h'>[];
    /** Live preview pixel bounds per member id while dragging a locked group container. */
    groupMemberBounds: Record<string, WidgetPixelBounds>;
}

/** Live drag preview: shifts every member's start bounds by the container's tentative delta (G3). */
function buildGroupMemberPixelBounds(
    interaction: InteractionState,
    tentativeBounds: WidgetPixelBounds,
    metrics: WidgetInteractionMetrics,
): Record<string, WidgetPixelBounds> {
    const deltaLeft = tentativeBounds.left - interaction.startBounds.left;
    const deltaTop = tentativeBounds.top - interaction.startBounds.top;

    return interaction.groupMemberIds.reduce<Record<string, WidgetPixelBounds>>((acc, memberId, index) => {
        const memberStartLayout = interaction.groupMemberStartLayouts[index];
        const memberStartBounds = layoutToPixelBounds(memberStartLayout, metrics);

        acc[memberId] = {
            left: memberStartBounds.left + deltaLeft,
            top: memberStartBounds.top + deltaTop,
            width: memberStartBounds.width,
            height: memberStartBounds.height,
        };

        return acc;
    }, {});
}

function isFiniteLayout(layout: Pick<WidgetLayout, 'x' | 'y' | 'w' | 'h'>): boolean {
    return [layout.x, layout.y, layout.w, layout.h].every((value) => Number.isFinite(value));
}

function resolveCommittedLayout(args: {
    interaction: InteractionState;
    metrics: WidgetInteractionMetrics;
    cols: number;
    rows: number;
}): Pick<WidgetLayout, 'x' | 'y' | 'w' | 'h'> {
    const tentativeLayout = pixelBoundsToGridBounds(args.interaction.tentativeBounds, args.metrics);

    if (!isFiniteLayout(tentativeLayout)) {
        return clampWidgetBounds(args.interaction.startLayout, args.cols, args.rows);
    }

    if (isResizeInteraction(args.interaction.type)) {
        const start = args.interaction.startLayout;
        const dir = args.interaction.type.slice('resize-'.length) as 'se' | 'ne' | 'nw' | 'sw';
        const anchorLeft = dir === 'se' || dir === 'ne';
        const anchorTop = dir === 'se' || dir === 'sw';

        if (anchorLeft && anchorTop) {
            const x = Math.min(Math.max(start.x, 0), args.cols - 1);
            const y = Math.min(Math.max(start.y, 0), args.rows - 1);
            return { x, y, w: Math.min(Math.max(tentativeLayout.w, 1), args.cols - x), h: Math.min(Math.max(tentativeLayout.h, 1), args.rows - y) };
        }
        if (anchorLeft && !anchorTop) {
            const x = Math.min(Math.max(start.x, 0), args.cols - 1);
            const bottomEdge = start.y + start.h;
            const h = Math.min(Math.max(tentativeLayout.h, 1), bottomEdge);
            return { x, y: bottomEdge - h, w: Math.min(Math.max(tentativeLayout.w, 1), args.cols - x), h };
        }
        if (!anchorLeft && anchorTop) {
            const y = Math.min(Math.max(start.y, 0), args.rows - 1);
            const rightEdge = start.x + start.w;
            const w = Math.min(Math.max(tentativeLayout.w, 1), rightEdge);
            return { x: rightEdge - w, y, w, h: Math.min(Math.max(tentativeLayout.h, 1), args.rows - y) };
        }
        const rightEdge = start.x + start.w;
        const bottomEdge = start.y + start.h;
        const w = Math.min(Math.max(tentativeLayout.w, 1), rightEdge);
        const h = Math.min(Math.max(tentativeLayout.h, 1), bottomEdge);
        return { x: rightEdge - w, y: bottomEdge - h, w, h };
    }

    return clampWidgetBounds(tentativeLayout, args.cols, args.rows);
}

const RESIZE_HANDLE_CONFIGS: Record<ResizeDirection, {
    cursor: string;
    position: React.CSSProperties;
    align: string;
    clipPath: string;
}> = {
    se: { cursor: 'se-resize', position: { bottom: 0, right: 0 }, align: 'items-end justify-end', clipPath: 'polygon(100% 0, 0% 100%, 100% 100%)' },
    ne: { cursor: 'ne-resize', position: { top: 0, right: 0 }, align: 'items-start justify-end', clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%)' },
    nw: { cursor: 'nw-resize', position: { top: 0, left: 0 }, align: 'items-start justify-start', clipPath: 'polygon(0% 0%, 100% 0%, 0% 100%)' },
    sw: { cursor: 'sw-resize', position: { bottom: 0, left: 0 }, align: 'items-end justify-start', clipPath: 'polygon(0% 0%, 0% 100%, 100% 100%)' },
};

function ResizeHandle({
    widgetId,
    direction,
    onPointerDown,
}: {
    widgetId: string;
    direction: ResizeDirection;
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
    const config = RESIZE_HANDLE_CONFIGS[direction];
    return (
        <div
            data-testid={`builder-canvas-resize-handle-${direction}-${widgetId}`}
            onPointerDown={onPointerDown}
            className={`absolute z-20 flex h-6 w-6 p-1.5 opacity-0 transition-opacity drop-shadow-md group-hover:opacity-100 ${config.align}`}
            style={{ cursor: config.cursor, ...config.position }}
        >
            <div className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--color-admin-selection-to)', clipPath: config.clipPath }} />
        </div>
    );
}

export default function BuilderCanvas({
    widgets,
    layout,
    equipmentMap,
    connection,
    machines,
    hierarchyContext,
    onWidgetSelect,
    selectedWidgetId,
    onResize,
    onLayoutCommit,
    onDelete,
    onDuplicate,
    onToggleGroupLock,
    onGroupLayoutCommit,
    onWidgetDragChange,
    headerWidgetIds,
    headerOccupiedSlotCount = 0,
    onPromoteToHeader,
    cols = DEFAULT_COLS,
    rows = DEFAULT_ROWS,
}: BuilderCanvasProps) {
    const getWidgetCornerRadius = (type: WidgetConfig['type']) => (type === 'text-title' ? '0px' : '1.5rem');
    const widgetMap = new Map(widgets.map((widget) => [widget.id, widget]));
    // Sanitized member ids of a locked group, minus any header-promoted id (G4): a widget
    // promoted to the header never lives on the canvas, so it can never be dragged/resized as
    // part of the group nor block its own individual interaction.
    const resolveVisibleGroupMemberIds = useCallback((group: GroupWidgetConfig) => (
        sanitizeGroupMemberIds(group.memberWidgetIds, group.id, widgets).filter((memberId) => !headerWidgetIds?.has(memberId))
    ), [widgets, headerWidgetIds]);
    // Ids of widgets that are members of a currently locked group (D1/G2): selectable, but
    // never draggable or resizable individually while their container stays locked.
    const lockedMemberIds = useMemo(() => {
        const ids = new Set<string>();
        widgets.filter(isGroupWidget).filter((widget) => widget.locked).forEach((widget) => {
            resolveVisibleGroupMemberIds(widget).forEach((memberId) => ids.add(memberId));
        });
        return ids;
    }, [widgets, resolveVisibleGroupMemberIds]);
    const rightEdgeUsesMajorLine = cols % GRID_MAJOR_INTERVAL_CELLS === 0;
    const bottomEdgeUsesMajorLine = rows % GRID_MAJOR_INTERVAL_CELLS === 0;
    const isGridVisible = useUIStore((state) => state.isGridVisible);
    const { containerRef, width, height, rowHeight, cellWidth, hasFirstValidMeasurement } = useCanvasReference({
        cols,
        rows,
    });

    const metrics: WidgetInteractionMetrics = { cellWidth, rowHeight };
    const [interaction, setInteraction] = useState<InteractionState | null>(null);
    const [bodyCursor, setBodyCursor] = useState<string | null>(null);

    const interactionRef = useRef<InteractionState | null>(null);
    const interactionCleanupRef = useRef<(() => void) | null>(null);

    const clearInteraction = useCallback(() => {
        interactionCleanupRef.current?.();
        interactionCleanupRef.current = null;
        interactionRef.current = null;
        setInteraction(null);
        setBodyCursor(null);
    }, []);

    useEffect(() => {
        const previousCursor = document.body.style.getPropertyValue('cursor');

        if (bodyCursor) {
            document.body.style.setProperty('cursor', bodyCursor);
        }
        else {
            document.body.style.removeProperty('cursor');
        }

        return () => {
            if (previousCursor) {
                document.body.style.setProperty('cursor', previousCursor);
            }
            else {
                document.body.style.removeProperty('cursor');
            }
        };
    }, [bodyCursor]);

    useEffect(() => () => {
        clearInteraction();
    }, [clearInteraction]);

    const commitLayout = (widgetId: string, nextLayout: Pick<WidgetLayout, 'x' | 'y' | 'w' | 'h'>) => {
        onLayoutCommit?.({ widgetId, ...nextLayout });

        if (!onLayoutCommit && onResize) {
            onResize(widgetId, nextLayout.w, nextLayout.h);
        }
    };

    // Resize of a locked group container (G3) must never shrink below its members' bounding box
    // and must keep containing it; every other interaction resolves exactly as before.
    const resolveCommittedLayoutForCommit = (currentInteraction: InteractionState): Pick<WidgetLayout, 'x' | 'y' | 'w' | 'h'> => {
        const baseLayout = resolveCommittedLayout({ interaction: currentInteraction, metrics, cols, rows });

        if (!isResizeInteraction(currentInteraction.type)) {
            return baseLayout;
        }

        const widget = widgetMap.get(currentInteraction.widgetId);
        if (!widget || !isGroupWidget(widget) || !widget.locked) {
            return baseLayout;
        }

        const memberIds = resolveVisibleGroupMemberIds(widget);
        const membersBoundingBox = computeMembersBoundingBox(memberIds, layout);

        return clampGroupResizeToMembers(baseLayout, membersBoundingBox);
    };

    // Group move (G3): resolve one shared, clamped grid delta from the container's tentative
    // bounds, then commit the container and every member in a single array (one history step).
    const commitGroupMove = (currentInteraction: InteractionState) => {
        const rawDeltaXCells = metrics.cellWidth > 0
            ? Math.round((currentInteraction.tentativeBounds.left - currentInteraction.startBounds.left) / metrics.cellWidth)
            : 0;
        const rawDeltaYCells = metrics.rowHeight > 0
            ? Math.round((currentInteraction.tentativeBounds.top - currentInteraction.startBounds.top) / metrics.rowHeight)
            : 0;

        const groupRects: LayoutRect[] = [currentInteraction.startLayout, ...currentInteraction.groupMemberStartLayouts];
        const { dx, dy } = clampGroupMoveDelta(groupRects, rawDeltaXCells, rawDeltaYCells, cols, rows);

        const nextLayouts: WidgetLayout[] = [
            {
                widgetId: currentInteraction.widgetId,
                x: currentInteraction.startLayout.x + dx,
                y: currentInteraction.startLayout.y + dy,
                w: currentInteraction.startLayout.w,
                h: currentInteraction.startLayout.h,
            },
            ...currentInteraction.groupMemberIds.map((memberId, index) => {
                const memberStartLayout = currentInteraction.groupMemberStartLayouts[index];
                return {
                    widgetId: memberId,
                    x: memberStartLayout.x + dx,
                    y: memberStartLayout.y + dy,
                    w: memberStartLayout.w,
                    h: memberStartLayout.h,
                };
            }),
        ];

        onGroupLayoutCommit?.(nextLayouts);
    };

    const beginInteraction = (
        event: React.PointerEvent<HTMLDivElement>,
        item: WidgetLayout,
        type: WidgetInteractionType,
    ) => {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        if (isResizeInteraction(type)) {
            event.stopPropagation();
        }

        const draggedWidget = widgetMap.get(item.widgetId);
        const isLockedMember = lockedMemberIds.has(item.widgetId);
        // Narrowed once into a typed variable (rather than a boolean flag) so the group-member
        // resolution below keeps `GroupWidgetConfig` typing instead of the wider `WidgetConfig`.
        const draggedLockedGroup: GroupWidgetConfig | undefined = type === 'move'
            && draggedWidget !== undefined
            && isGroupWidget(draggedWidget)
            && draggedWidget.locked === true
            ? draggedWidget
            : undefined;
        // G3/G4: only members that actually resolve to a layout entry ride along with the
        // container — an id without one (malformed data, or a header-promoted widget slipping
        // through) is skipped entirely instead of moving a fabricated {w:0,h:0} placeholder.
        const resolvedGroupMembers = draggedLockedGroup
            ? resolveVisibleGroupMemberIds(draggedLockedGroup)
                .map((memberId) => {
                    const memberLayout = layout.find((entry) => entry.widgetId === memberId);
                    return memberLayout ? { memberId, memberLayout } : null;
                })
                .filter((entry): entry is { memberId: string; memberLayout: WidgetLayout } => entry !== null)
            : [];
        const groupMemberIds = resolvedGroupMembers.map((entry) => entry.memberId);
        const groupMemberStartLayouts = resolvedGroupMembers.map((entry) => (
            { x: entry.memberLayout.x, y: entry.memberLayout.y, w: entry.memberLayout.w, h: entry.memberLayout.h }
        ));

        const startLayout = { x: item.x, y: item.y, w: item.w, h: item.h };
        const startBounds = layoutToPixelBounds(startLayout, metrics);
        const initialInteraction: InteractionState = {
            widgetId: item.widgetId,
            type,
            startPointer: { x: event.clientX, y: event.clientY },
            currentPointer: { x: event.clientX, y: event.clientY },
            startLayout,
            startBounds,
            tentativeBounds: startBounds,
            hasExceededThreshold: false,
            isLockedMember,
            groupMemberIds,
            groupMemberStartLayouts,
            groupMemberBounds: {},
        };

        interactionRef.current = initialInteraction;
        setInteraction(initialInteraction);
        setBodyCursor(isLockedMember ? null : resizeCursor(type));
        onWidgetDragChange?.(null);

        const handlePointerMove = (moveEvent: PointerEvent) => {
            const currentInteraction = interactionRef.current;

            if (!currentInteraction) {
                return;
            }

            // Locked members are selectable but never draggable/resizable individually (D1/G2):
            // pointer movement never starts a visual drag, so release always resolves as a select.
            if (currentInteraction.isLockedMember) {
                const nextInteraction: InteractionState = {
                    ...currentInteraction,
                    currentPointer: { x: moveEvent.clientX, y: moveEvent.clientY },
                };
                interactionRef.current = nextInteraction;
                setInteraction(nextInteraction);
                return;
            }

            // clientX/clientY are REAL/visual px (see ../../utils/zoomCoordinates.ts);
            // the threshold check below compares the physical pointer-movement
            // distance against a fixed px tolerance, so it stays in real space
            // (independent of app zoom, matching actual mouse precision).
            const deltaX = moveEvent.clientX - currentInteraction.startPointer.x;
            const deltaY = moveEvent.clientY - currentInteraction.startPointer.y;
            const distance = Math.hypot(deltaX, deltaY);
            const hasExceededThreshold = isResizeInteraction(currentInteraction.type)
                ? true
                : currentInteraction.hasExceededThreshold || distance > DRAG_THRESHOLD_PX;

            // startBounds/cellWidth/rowHeight are LAYOUT-space (ResizeObserver
            // contentRect, see ../../utils/useCanvasReference.ts), so the
            // real-space pointer delta must be converted before combining with
            // them (PW-007 T3b) — otherwise dragging overshoots the pointer at
            // zoom > 1 and undershoots it at zoom < 1.
            const zoom = getEffectiveZoom();
            const layoutDeltaX = visualToLayoutPx(deltaX, zoom);
            const layoutDeltaY = visualToLayoutPx(deltaY, zoom);

            const tentativeBounds = currentInteraction.type === 'move' && !hasExceededThreshold
                ? currentInteraction.startBounds
                : applyPointerDeltaToPixelBounds(
                    currentInteraction.type,
                    currentInteraction.startBounds,
                    layoutDeltaX,
                    layoutDeltaY,
                );

            // Group move (G3): while dragging a locked container, shift every member's preview
            // bounds by the same live delta so they visibly follow instead of jumping on commit.
            const groupMemberBounds = currentInteraction.groupMemberIds.length > 0 && hasExceededThreshold
                ? buildGroupMemberPixelBounds(currentInteraction, tentativeBounds, metrics)
                : currentInteraction.groupMemberBounds;

            const nextInteraction: InteractionState = {
                ...currentInteraction,
                currentPointer: { x: moveEvent.clientX, y: moveEvent.clientY },
                tentativeBounds,
                hasExceededThreshold,
                groupMemberBounds,
            };

            interactionRef.current = nextInteraction;
            setInteraction(nextInteraction);
        };

        const handlePointerUp = () => {
            const currentInteraction = interactionRef.current;

            if (!currentInteraction) {
                clearInteraction();
                return;
            }

            if (currentInteraction.type === 'move' && !currentInteraction.hasExceededThreshold) {
                onWidgetSelect?.(currentInteraction.widgetId);
                clearInteraction();
                return;
            }

            // Group move (G3): one commit moves the container and every member together, clamped
            // as a rigid body so none of them crosses the grid edge.
            if (currentInteraction.type === 'move' && currentInteraction.groupMemberIds.length > 0) {
                commitGroupMove(currentInteraction);
                clearInteraction();
                return;
            }

            commitLayout(
                currentInteraction.widgetId,
                resolveCommittedLayoutForCommit(currentInteraction),
            );

            clearInteraction();
        };

        const handlePointerCancel = () => {
            clearInteraction();
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerCancel);
        interactionCleanupRef.current = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerCancel);
        };
    };

    const resizeTooltipLayout = interaction && isResizeInteraction(interaction.type) && interaction.hasExceededThreshold
        ? resolveCommittedLayoutForCommit(interaction)
        : null;
    const activeResizeWidgetId = interaction && isResizeInteraction(interaction.type)
        ? interaction.widgetId
        : null;

    const visibleLayout = layout.filter((item) => !headerWidgetIds?.has(item.widgetId));

    return (
        <div
            ref={containerRef}
            data-testid="builder-canvas-root"
            tabIndex={0}
            onPointerDown={(event) => {
                if (event.button === 0 && !(event.target as Element).closest('[data-testid^="builder-canvas-item-"]')) {
                    event.currentTarget.focus();
                    onWidgetSelect?.(undefined);
                }
            }}
            className="flex h-full min-h-0 min-w-0 w-full items-start justify-start overflow-visible"
            style={{
                outline: 'none',
            }}
        >
            {hasFirstValidMeasurement ? (
                <div
                    data-testid="builder-canvas-frame"
                    className="relative shrink-0"
                    style={{
                        width: `${width}px`,
                        height: `${height}px`,
                    }}
                >
                    <div
                        data-testid="builder-canvas-grid-overlay"
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 transition-opacity"
                        style={{
                            opacity: isGridVisible ? 1 : 0,
                            ['--canvas-cols' as string]: String(cols),
                            ['--canvas-rows' as string]: String(rows),
                            ['--cell-width-px' as string]: `${cellWidth}px`,
                            ['--row-height-px' as string]: `${rowHeight}px`,
                            ['--canvas-major-interval-cols' as string]: String(GRID_MAJOR_INTERVAL_CELLS),
                            ['--canvas-major-dash-length' as string]: `${GRID_MAJOR_DASH_LENGTH_PX}px`,
                            ['--canvas-major-dash-gap' as string]: `${GRID_MAJOR_DASH_GAP_PX}px`,
                        }}
                    >
                        <div
                            data-testid="builder-canvas-grid-minor-overlay"
                            className="absolute inset-0"
                            style={{
                                backgroundImage: [
                                    'repeating-linear-gradient(to right, var(--color-canvas-grid-minor) 0px, var(--color-canvas-grid-minor) 1px, transparent 1px, transparent var(--cell-width-px))',
                                    'repeating-linear-gradient(to bottom, var(--color-canvas-grid-minor) 0px, var(--color-canvas-grid-minor) 1px, transparent 1px, transparent var(--row-height-px))',
                                ].join(', '),
                                opacity: isGridVisible ? 1 : 0,
                            }}
                        />

                        <div
                            data-testid="builder-canvas-grid-major-eraser-overlay"
                            className="absolute inset-0"
                            style={{
                                opacity: isGridVisible ? 1 : 0,
                            }}
                        >
                            <div
                                data-testid="builder-canvas-grid-major-eraser-vertical-overlay"
                                className="absolute inset-0"
                                style={{
                                    backgroundImage: 'repeating-linear-gradient(to right, var(--color-canvas-bg) 0px, var(--color-canvas-bg) 1px, transparent 1px, transparent calc(var(--cell-width-px) * var(--canvas-major-interval-cols)))',
                                }}
                            />
                            <div
                                data-testid="builder-canvas-grid-major-eraser-horizontal-overlay"
                                className="absolute inset-0"
                                style={{
                                    backgroundImage: 'repeating-linear-gradient(to bottom, var(--color-canvas-bg) 0px, var(--color-canvas-bg) 1px, transparent 1px, transparent calc(var(--row-height-px) * var(--canvas-major-interval-cols)))',
                                }}
                            />
                        </div>

                        <div
                            data-testid="builder-canvas-grid-major-overlay"
                            className="absolute inset-0"
                            style={{
                                opacity: isGridVisible ? 1 : 0,
                            }}
                        >
                            <div
                                data-testid="builder-canvas-grid-major-vertical-overlay"
                                className="absolute inset-0"
                                style={{
                                    backgroundImage: 'repeating-linear-gradient(to right, var(--color-canvas-grid-major) 0px, var(--color-canvas-grid-major) 1px, transparent 1px, transparent calc(var(--cell-width-px) * var(--canvas-major-interval-cols)))',
                                    maskImage: 'repeating-linear-gradient(to bottom, #000 0px, #000 var(--canvas-major-dash-length), transparent var(--canvas-major-dash-length), transparent calc(var(--canvas-major-dash-length) + var(--canvas-major-dash-gap)))',
                                    WebkitMaskImage: 'repeating-linear-gradient(to bottom, #000 0px, #000 var(--canvas-major-dash-length), transparent var(--canvas-major-dash-length), transparent calc(var(--canvas-major-dash-length) + var(--canvas-major-dash-gap)))',
                                }}
                            />
                            <div
                                data-testid="builder-canvas-grid-major-horizontal-overlay"
                                className="absolute inset-0"
                                style={{
                                    backgroundImage: 'repeating-linear-gradient(to bottom, var(--color-canvas-grid-major) 0px, var(--color-canvas-grid-major) 1px, transparent 1px, transparent calc(var(--row-height-px) * var(--canvas-major-interval-cols)))',
                                    maskImage: 'repeating-linear-gradient(to right, #000 0px, #000 var(--canvas-major-dash-length), transparent var(--canvas-major-dash-length), transparent calc(var(--canvas-major-dash-length) + var(--canvas-major-dash-gap)))',
                                    WebkitMaskImage: 'repeating-linear-gradient(to right, #000 0px, #000 var(--canvas-major-dash-length), transparent var(--canvas-major-dash-length), transparent calc(var(--canvas-major-dash-length) + var(--canvas-major-dash-gap)))',
                                }}
                            />
                        </div>

                        <div
                            aria-hidden="true"
                            className="pointer-events-none absolute top-0 right-0 h-full w-px"
                            style={{
                                opacity: isGridVisible ? 1 : 0,
                                backgroundColor: rightEdgeUsesMajorLine
                                    ? 'var(--color-canvas-grid-major)'
                                    : 'var(--color-canvas-grid-minor)',
                                maskImage: rightEdgeUsesMajorLine
                                    ? 'repeating-linear-gradient(to bottom, #000 0px, #000 var(--canvas-major-dash-length), transparent var(--canvas-major-dash-length), transparent calc(var(--canvas-major-dash-length) + var(--canvas-major-dash-gap)))'
                                    : undefined,
                                WebkitMaskImage: rightEdgeUsesMajorLine
                                    ? 'repeating-linear-gradient(to bottom, #000 0px, #000 var(--canvas-major-dash-length), transparent var(--canvas-major-dash-length), transparent calc(var(--canvas-major-dash-length) + var(--canvas-major-dash-gap)))'
                                    : undefined,
                            }}
                        />

                        <div
                            aria-hidden="true"
                            className="pointer-events-none absolute right-0 bottom-0 left-0 h-px"
                            style={{
                                opacity: isGridVisible ? 1 : 0,
                                backgroundColor: bottomEdgeUsesMajorLine
                                    ? 'var(--color-canvas-grid-major)'
                                    : 'var(--color-canvas-grid-minor)',
                                maskImage: bottomEdgeUsesMajorLine
                                    ? 'repeating-linear-gradient(to right, #000 0px, #000 var(--canvas-major-dash-length), transparent var(--canvas-major-dash-length), transparent calc(var(--canvas-major-dash-length) + var(--canvas-major-dash-gap)))'
                                    : undefined,
                                WebkitMaskImage: bottomEdgeUsesMajorLine
                                    ? 'repeating-linear-gradient(to right, #000 0px, #000 var(--canvas-major-dash-length), transparent var(--canvas-major-dash-length), transparent calc(var(--canvas-major-dash-length) + var(--canvas-major-dash-gap)))'
                                    : undefined,
                            }}
                        />
                    </div>

                    <div
                        className="relative z-10 grid h-full w-full"
                        style={{
                            ...getGridTemplateStyle(cols),
                            gridTemplateRows: `repeat(${rows}, ${rowHeight}px)`,
                            gap: 0,
                        }}
                    >
                        {visibleLayout.map((item) => {
                        if (headerWidgetIds?.has(item.widgetId)) {
                            return null;
                        }

                        const widget = widgetMap.get(item.widgetId);
                        if (!widget) {
                            return null;
                        }

                        const isSelected = selectedWidgetId === widget.id;
                        const isLockedMemberWidget = lockedMemberIds.has(widget.id);
                        // A locked member's own interaction never previews a visual drag (D1/G2):
                        // it only tracks pointer position toward a plain click-to-select release.
                        const activeInteraction = interaction?.widgetId === widget.id && !interaction.isLockedMember
                            ? interaction
                            : null;
                        // Group move (G3): while a locked container is being dragged, its members
                        // preview at the same live delta instead of jumping only on commit.
                        const groupPreviewBounds = interaction?.groupMemberBounds[widget.id];
                        // G5b (R3-resize-preview-commit-mismatch): resizing a locked group
                        // container clamps the LIVE preview with the same members-bounding-box
                        // clamp the commit uses, so the rect never renders smaller than what gets
                        // saved and then snaps back on release.
                        const resizePreviewBounds = activeInteraction && isResizeInteraction(activeInteraction.type) && isGroupWidget(widget) && widget.locked
                            ? layoutToPixelBounds(resolveCommittedLayoutForCommit(activeInteraction), metrics)
                            : null;
                        const itemStyle = activeInteraction
                            ? {
                                position: 'absolute' as const,
                                left: `${(resizePreviewBounds ?? activeInteraction.tentativeBounds).left}px`,
                                top: `${(resizePreviewBounds ?? activeInteraction.tentativeBounds).top}px`,
                                width: `${(resizePreviewBounds ?? activeInteraction.tentativeBounds).width}px`,
                                height: `${(resizePreviewBounds ?? activeInteraction.tentativeBounds).height}px`,
                                zIndex: 20,
                              }
                            : groupPreviewBounds
                                ? {
                                    position: 'absolute' as const,
                                    left: `${groupPreviewBounds.left}px`,
                                    top: `${groupPreviewBounds.top}px`,
                                    width: `${groupPreviewBounds.width}px`,
                                    height: `${groupPreviewBounds.height}px`,
                                    zIndex: 20,
                                  }
                                : {
                                    gridColumnStart: item.x + 1,
                                    gridColumnEnd: `span ${item.w}`,
                                    gridRowStart: item.y + 1,
                                    gridRowEnd: `span ${item.h}`,
                                  };
                        const renderContext: TrendChartV2RenderContext | undefined = widget.type === 'trend-chart-v2' && activeResizeWidgetId === widget.id
                            ? {
                                surface: 'builder',
                                isTransientResizeActive: true,
                            }
                            : undefined;

                        return (
                            <div
                                key={widget.id}
                                data-testid={`builder-canvas-item-${widget.id}`}
                                className={`relative group ${isLockedMemberWidget ? 'cursor-default' : 'cursor-grab'} transition-opacity duration-200 ${widget.type === 'text-title' ? 'rounded-none' : 'rounded-xl'}`}
                                style={itemStyle}
                                onPointerDown={(event) => beginInteraction(event, item, 'move')}
                            >
                                <GridSelectionFrame
                                    isSelected={isSelected}
                                    isHighlighted={false}
                                    radius={getWidgetCornerRadius(widget.type)}
                                />

                                <WidgetHoverActions
                                    actions={[
                                        ...(isHeaderCompatibleWidget(widget) && headerOccupiedSlotCount < HEADER_WIDGET_SLOT_COUNT
                                            ? [{
                                                label: 'Subir al header',
                                                icon: ArrowUp,
                                                onClick: () => onPromoteToHeader?.(widget.id),
                                              }]
                                            : []),
                                        ...(isGroupWidget(widget)
                                            ? [{
                                                label: widget.locked ? 'Desagrupar widgets' : 'Agrupar widgets',
                                                icon: widget.locked ? LockOpen : Lock,
                                                onClick: () => onToggleGroupLock?.(widget.id),
                                              }]
                                            : []),
                                        {
                                            label: 'Duplicar widget',
                                            icon: Copy,
                                            onClick: () => onDuplicate?.(widget.id),
                                        },
                                        {
                                            label: 'Eliminar widget',
                                            icon: Trash2,
                                            onClick: () => onDelete?.(widget.id),
                                        },
                                    ]}
                                />

                                {isSelected && !isLockedMemberWidget && (
                                    (['se', 'ne', 'nw', 'sw'] as const).map((dir) => (
                                        <ResizeHandle
                                            key={dir}
                                            widgetId={widget.id}
                                            direction={dir}
                                            onPointerDown={(event) => beginInteraction(event, item, `resize-${dir}`)}
                                        />
                                    ))
                                )}

                                <div
                                    data-testid={`builder-canvas-item-surface-${widget.id}`}
                                    className="pointer-events-none relative z-0 h-full w-full box-border"
                                    style={{ padding: 'var(--widget-spacing)' }}
                                >
                                    <WidgetPresentationBoundary
                                        widget={widget}
                                        equipmentMap={equipmentMap}
                                        connection={connection}
                                        machines={machines}
                                        isLoadingData={false}
                                        siblingWidgets={widgets}
                                        hierarchyContext={hierarchyContext}
                                        renderContext={renderContext}
                                        className="h-full w-full"
                                    />
                                </div>
                            </div>
                        );
                        })}
                    </div>

                    {resizeTooltipLayout && interaction && (() => {
                        const isLeftHandle = interaction.type === 'resize-nw' || interaction.type === 'resize-sw';
                        const isTopHandle = interaction.type === 'resize-nw' || interaction.type === 'resize-ne';
                        return (
                            <CursorTooltip
                                data-testid="builder-canvas-resize-tooltip"
                                data-offset-px={RESIZE_TOOLTIP_OFFSET_PX}
                                label={`${resizeTooltipLayout.w} × ${resizeTooltipLayout.h}`}
                                // CursorTooltip writes x/y straight into a
                                // `position: fixed` CSS length; currentPointer
                                // is raw (real-space) clientX/clientY, so it
                                // must be converted first (PW-007 T3b).
                                x={visualToLayoutPx(interaction.currentPointer.x)}
                                y={visualToLayoutPx(interaction.currentPointer.y)}
                                anchor={isLeftHandle ? (isTopHandle ? 'nw' : 'sw') : (isTopHandle ? 'ne' : 'se')}
                            />
                        );
                    })()}
                </div>
            ) : null}

            {visibleLayout.length === 0 && (
                <div className="w-full px-6" data-testid="builder-canvas-empty-shell">
                    <AdminEmptyState
                        icon={LayoutDashboard}
                        message="El dashboard está vacío"
                    />
                </div>
            )}
        </div>
    );
}
