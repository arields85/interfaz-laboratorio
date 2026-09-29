import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Trash2, ArrowUp, LayoutDashboard, Lock, LockOpen, Pencil } from 'lucide-react';
import { isGroupWidget, type GroupWidgetConfig, type WidgetConfig, type WidgetLayout } from '../../domain/admin.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import type { ContractMachine, ConnectionHealth } from '../../domain/dataContract.types';
import type { HierarchyContext } from '../../widgets/resolvers/hierarchyResolver';
import GridSelectionFrame from '../ui/GridSelectionFrame';
import WidgetHoverActions from '../ui/WidgetHoverActions';
import { GridFrameScope } from '../ui/GridFrameScope';
import CursorTooltip from '../ui/CursorTooltip';
import {
    HEADER_WIDGET_SLOT_COUNT,
    type HeaderWidgetDragPayload,
    isHeaderCompatibleWidget,
} from '../../utils/headerWidgets';
import AdminEmptyState from './AdminEmptyState';
import { CLASSIC_THEME_STYLE } from '../../services/themeStyle.service';
import { useCanvasReference } from '../../utils/useCanvasReference';
import { clampWidgetBounds, DEFAULT_COLS, DEFAULT_ROWS, getGridTemplateStyle } from '../../utils/gridConfig';
import { useUIStore } from '../../store/ui.store';
import {
    applyPointerDeltaToPixelBounds,
    isResizeInteraction,
    layoutToPixelBounds,
    pixelBoundsToGridBounds,
    pixelBoundsToRect,
    rectToPixelBounds,
    resizeCursor,
    type ResizeDirection,
    type WidgetInteractionMetrics,
    type WidgetInteractionType,
    type WidgetPixelBounds,
} from '../../utils/widgetInteraction';
import {
    clampGroupMoveDelta,
    clampGroupResizeToMembers,
    clampRectInsideContainer,
    clampResizeRectInsideContainer,
    computeMembersBoundingBox,
    findOwningLockedGroup,
    orderRenderItemsWithGroupsFirst,
    resolveEffectiveInteractionTarget,
    resolveWidgetSurfaceInset,
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
    /** D6: the id of the locked group currently in pencil edit mode, if any. */
    editingGroupId?: string;
    /** D6: toggles pencil edit mode for a locked group container. */
    onToggleGroupEditMode?: (widgetId: string) => void;
    /** D6: exits pencil edit mode (click outside the group, Escape, unlock/delete). */
    onExitGroupEditMode?: () => void;
    /**
     * P8: the id of the widget currently being placed (its copy is following the pointer,
     * snapped to the grid, waiting for a click to drop it). `undefined` when no placement is
     * active. Controlled by the parent so the SAME placement can also be started from
     * PropertyDock's duplicate action, not only this canvas's own hover action.
     */
    placementSourceWidgetId?: string;
    /**
     * P8: fired when a click on the canvas (empty space, or on top of any widget — overlap is
     * allowed) drops the pending copy at this already-clamped grid position.
     */
    onDuplicatePlacementCommit?: (target: { x: number; y: number }) => void;
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

/** P8: strips a clamped rect down to its top-left — the contract `onDuplicatePlacementCommit` expects. */
function toGridPosition(rect: Pick<WidgetLayout, 'x' | 'y'>): { x: number; y: number } {
    return { x: rect.x, y: rect.y };
}

/**
 * P8/R3-001: the ONE place that turns a raw pointer client position into the clamped grid cell
 * the placement ghost occupies. Shared by the continuous pointermove tracking and the pointerdown
 * commit so both always agree on the same cell — a click/tap with no prior move (touch, pen, or a
 * pointerdown at a new location) must land where the pointer actually is, not wherever the ghost
 * was last drawn.
 */
function resolvePointerGridCell(args: {
    clientX: number;
    clientY: number;
    container: Element;
    // Kept as separate primitives (not one `metrics` object) so a caller's `useEffect` can list
    // exactly `cellWidth`/`rowHeight` in its dependency array, matching the granular deps it
    // already tracks instead of forcing the whole (per-render-new) metrics object in.
    cellWidth: number;
    rowHeight: number;
    size: { w: number; h: number };
    cols: number;
    rows: number;
}): { x: number; y: number } {
    const rect = args.container.getBoundingClientRect();
    const zoom = getEffectiveZoom();
    const localX = visualToLayoutPx(args.clientX - rect.left, zoom);
    const localY = visualToLayoutPx(args.clientY - rect.top, zoom);
    const gridX = Math.floor(localX / args.cellWidth);
    const gridY = Math.floor(localY / args.rowHeight);

    return toGridPosition(clampWidgetBounds(
        { x: gridX, y: gridY, w: args.size.w, h: args.size.h },
        args.cols,
        args.rows,
    ));
}

// TextTitle no tiene frame (sin .glass-panel); el resto sigue el radio de tema activo
// (--frame-radius-rest, ver services/themeStyle.service.ts) en vez de un valor fijo.
function getWidgetCornerRadius(type: WidgetConfig['type']): string {
    return type === 'text-title' ? '0px' : 'var(--frame-radius-rest)';
}

/**
 * P8/R3-003: one placement-ghost rect — the container's own ghost and each member's ghost are
 * otherwise identical markup (an absolutely positioned box holding a `GridSelectionFrame` sized
 * and rounded to its OWN widget type), so this is the single place that draws either.
 */
function PlacementGhostRect({
    testId,
    px,
    widgetType,
}: {
    testId: string;
    px: WidgetPixelBounds;
    widgetType: WidgetConfig['type'];
}) {
    return (
        <div
            data-testid={testId}
            className="absolute"
            style={{
                left: `${px.left}px`,
                top: `${px.top}px`,
                width: `${px.width}px`,
                height: `${px.height}px`,
            }}
        >
            <GridSelectionFrame
                isSelected={false}
                isHighlighted
                radius={getWidgetCornerRadius(widgetType)}
                inset={resolveWidgetSurfaceInset({ type: widgetType })}
            />
        </div>
    );
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
    verticalEdge: 'top' | 'bottom';
    horizontalEdge: 'left' | 'right';
    align: string;
    clipPath: string;
}> = {
    se: { cursor: 'se-resize', verticalEdge: 'bottom', horizontalEdge: 'right', align: 'items-end justify-end', clipPath: 'polygon(100% 0, 0% 100%, 100% 100%)' },
    ne: { cursor: 'ne-resize', verticalEdge: 'top', horizontalEdge: 'right', align: 'items-start justify-end', clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%)' },
    nw: { cursor: 'nw-resize', verticalEdge: 'top', horizontalEdge: 'left', align: 'items-start justify-start', clipPath: 'polygon(0% 0%, 100% 0%, 0% 100%)' },
    sw: { cursor: 'sw-resize', verticalEdge: 'bottom', horizontalEdge: 'left', align: 'items-end justify-start', clipPath: 'polygon(0% 0%, 0% 100%, 100% 100%)' },
};

/**
 * Radius Clasico uses, read from its single source of truth (`CLASSIC_THEME_STYLE.frame.rest
 * .radiusPx` in themeStyle.service.ts) instead of a copied literal, so this stays correct if that
 * preset's radius ever changes — the reference the P3 radius compensation below keeps
 * pixel-identical: today's Clasico look must not change.
 */
const CLASSIC_FRAME_RADIUS = `${CLASSIC_THEME_STYLE.frame.rest.radiusPx}px`;

/**
 * A rounded corner of radius R visually recedes from the box's exact geometric corner by
 * R * (1 - cos 45deg) along the diagonal a resize handle sits on. `1 - Math.SQRT1_2` derives that
 * ratio exactly instead of a manually rounded literal.
 */
const CORNER_RECESSION_RATIO = (1 - Math.SQRT1_2).toFixed(4);

/**
 * G13(b) (live check 4): a resize handle must sit OUTSIDE the widget's own visible frame, at the
 * same visual offset for every widget type — the gap between the outer grid-cell box (where the
 * handle is positioned, `top/left/bottom/right: 0`) and the frame drawn inset from it by
 * `resolveWidgetSurfaceInset`. A normal widget's frame is inset by `--widget-spacing`, so its
 * handle (at the outer edge) already sits exactly that far outside the frame. A group container's
 * frame has NO inset (G9: it reaches the grid line), so positioning its handle at the same outer
 * edge lands it ON the frame instead of outside it. Pushing the handle out by
 * `--widget-spacing - inset` restores the same visual relationship for every widget: 0 for a
 * normal widget (unchanged), and a full `--widget-spacing` PAST the grid line for a group.
 *
 * P3 (2026-09-28): that inset-only offset keeps the same RAW pixel gap to the frame's bounding
 * box in any theme, but it ignores the frame's own corner radius. Clasico's default 1.5rem radius
 * visually recedes the frame's actual rounded corner further inward from that bounding box — that
 * recession is what already makes the handle look clear of the corner in Clasico today. A theme
 * with a smaller/0 radius (Contorno) has no such recession, so the same raw gap left the handle
 * glued to the sharp corner. Adding back exactly the recession Clasico's own radius contributes —
 * `max(0px, ...)` guards against a future theme with a LARGER radius pulling the handle inward —
 * keeps the same apparent gap in every theme while leaving Clasico's own computed offset (radius
 * = Clasico's own, term = 0px) unchanged. The whole expression stays a live `calc()` referencing
 * `var(--frame-radius-rest)` (not a value computed once in JS) so it recomputes automatically on
 * a theme switch, the same technique `GridSelectionFrame` already uses.
 */
function resolveResizeHandlePosition(direction: ResizeDirection, widgetInset: string): React.CSSProperties {
    const { verticalEdge, horizontalEdge } = RESIZE_HANDLE_CONFIGS[direction];
    const radiusCompensation = `max(0px, calc((${CLASSIC_FRAME_RADIUS} - var(--frame-radius-rest)) * ${CORNER_RECESSION_RATIO}))`;
    const offset = `calc(${widgetInset} - var(--widget-spacing) + ${radiusCompensation})`;

    return { [verticalEdge]: offset, [horizontalEdge]: offset };
}

function ResizeHandle({
    widgetId,
    direction,
    widgetInset,
    onPointerDown,
}: {
    widgetId: string;
    direction: ResizeDirection;
    widgetInset: string;
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
    const config = RESIZE_HANDLE_CONFIGS[direction];
    return (
        <div
            data-testid={`builder-canvas-resize-handle-${direction}-${widgetId}`}
            onPointerDown={onPointerDown}
            className={`absolute z-20 flex h-6 w-6 p-1.5 opacity-0 transition-opacity drop-shadow-md group-hover:opacity-100 ${config.align}`}
            style={{ cursor: config.cursor, ...resolveResizeHandlePosition(direction, widgetInset) }}
        >
            {/* G14: the handle color follows the Design tab's "Acento Admin" token
                (--color-admin-accent) — the old --color-admin-selection-to was not editable there. */}
            <div className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--color-admin-accent)', clipPath: config.clipPath }} />
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
    editingGroupId,
    onToggleGroupEditMode,
    onExitGroupEditMode,
    placementSourceWidgetId,
    onDuplicatePlacementCommit,
    cols = DEFAULT_COLS,
    rows = DEFAULT_ROWS,
}: BuilderCanvasProps) {
    const widgetMap = new Map(widgets.map((widget) => [widget.id, widget]));
    // Sanitized member ids of a locked group, minus any header-promoted id (G4): a widget
    // promoted to the header never lives on the canvas, so it can never be dragged/resized as
    // part of the group nor block its own individual interaction.
    const resolveVisibleGroupMemberIds = useCallback((group: GroupWidgetConfig) => (
        sanitizeGroupMemberIds(group.memberWidgetIds, group.id, widgets).filter((memberId) => !headerWidgetIds?.has(memberId))
    ), [widgets, headerWidgetIds]);
    // Ids of widgets that are members of a currently locked group (D1/G2). Outside edit mode
    // (D6) these act as part of ONE widget — the container: selection and drag redirect to it,
    // and no individual resize handles render for them.
    const lockedMemberIds = useMemo(() => {
        const ids = new Set<string>();
        widgets.filter(isGroupWidget).filter((widget) => widget.locked).forEach((widget) => {
            resolveVisibleGroupMemberIds(widget).forEach((memberId) => ids.add(memberId));
        });
        return ids;
    }, [widgets, resolveVisibleGroupMemberIds]);
    // D6 pencil edit mode: members of the group CURRENTLY being edited are excluded from the
    // "acts as one widget" redirect above — they become individually selectable/draggable/
    // resizable again (clamped to the container's bounds).
    const editingGroupMemberIds = useMemo(() => {
        if (!editingGroupId) {
            return new Set<string>();
        }
        const editingGroup = widgets.find((widget) => widget.id === editingGroupId);
        if (!editingGroup || !isGroupWidget(editingGroup) || editingGroup.locked !== true) {
            return new Set<string>();
        }
        return new Set(resolveVisibleGroupMemberIds(editingGroup));
    }, [widgets, editingGroupId, resolveVisibleGroupMemberIds]);
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

    // P8: click-to-place duplicate. `placementPointer` is the raw (real/visual px) pointer
    // position, used only to anchor the visible cursor hint; `placementGridPosition` is the
    // already-clamped grid cell the ghost (and an eventual drop) sits at — the single source of
    // truth for both rendering the ghost and committing the copy.
    const [placementPointer, setPlacementPointer] = useState<{ x: number; y: number } | null>(null);
    const [placementGridPosition, setPlacementGridPosition] = useState<{ x: number; y: number } | null>(null);
    // Tracks the PREVIOUS `placementSourceWidgetId` as state (not a ref — refs may not be read or
    // written during render) so the seeding below can detect a genuine transition.
    const [previousPlacementSourceWidgetId, setPreviousPlacementSourceWidgetId] = useState<string | undefined>(undefined);

    // Resolves what the ghost looks like: the source widget's own size, plus — for a locked
    // group — every visible member's rect expressed as an offset RELATIVE to the container, so
    // the whole thing translates together as one rigid ghost (D5/D6). An unlocked group (D5: its
    // copy is an empty container) or a plain widget never has member ghosts.
    const placementSource = useMemo(() => {
        if (!placementSourceWidgetId) {
            return null;
        }

        const sourceWidget = widgets.find((item) => item.id === placementSourceWidgetId);
        const sourceLayout = layout.find((item) => item.widgetId === placementSourceWidgetId);

        if (!sourceWidget || !sourceLayout) {
            return null;
        }

        const memberGhosts = isGroupWidget(sourceWidget) && sourceWidget.locked
            ? resolveVisibleGroupMemberIds(sourceWidget)
                .map((memberId) => {
                    const memberLayout = layout.find((item) => item.widgetId === memberId);
                    const memberWidget = widgets.find((item) => item.id === memberId);
                    return memberLayout && memberWidget ? { memberLayout, memberWidget } : null;
                })
                .filter((entry): entry is { memberLayout: WidgetLayout; memberWidget: WidgetConfig } => entry !== null)
                .map(({ memberLayout, memberWidget }) => ({
                    id: memberLayout.widgetId,
                    type: memberWidget.type,
                    relX: memberLayout.x - sourceLayout.x,
                    relY: memberLayout.y - sourceLayout.y,
                    w: memberLayout.w,
                    h: memberLayout.h,
                }))
            : [];

        return { type: sourceWidget.type, w: sourceLayout.w, h: sourceLayout.h, memberGhosts };
    }, [placementSourceWidgetId, widgets, layout, resolveVisibleGroupMemberIds]);

    // Seeds the ghost at the SOURCE WIDGET'S OWN position the instant placement starts (or a
    // different widget's placement replaces it), so it never flashes at (0,0) before the first
    // pointer move. This is the React-documented "adjust state when a prop changes" pattern
    // (https://react.dev/reference/react/useState#storing-information-from-previous-renders) —
    // a synchronous derived-state adjustment during render, guarded by the previous-id state so it
    // only runs on a genuine transition, NOT an effect (which would cascade an extra render for
    // no benefit here, since there is no external system to synchronize with).
    if (placementSourceWidgetId !== previousPlacementSourceWidgetId) {
        setPreviousPlacementSourceWidgetId(placementSourceWidgetId);

        if (!placementSourceWidgetId) {
            setPlacementPointer(null);
            setPlacementGridPosition(null);
        }
        else {
            const sourceLayout = layout.find((item) => item.widgetId === placementSourceWidgetId);
            setPlacementGridPosition(sourceLayout ? toGridPosition(clampWidgetBounds(sourceLayout, cols, rows)) : null);
        }
    }

    // Tracks the pointer the whole time placement is active (no button needs to stay held — this
    // is a MODE, not a drag) and snaps the ghost's top-left to the grid cell under it, clamped
    // inside the grid bounds (P8: also the fix for the pre-existing bug where a duplicate could
    // land outside/below the grid).
    useEffect(() => {
        if (!placementSourceWidgetId || !placementSource) {
            return;
        }

        const handlePointerMove = (event: PointerEvent) => {
            setPlacementPointer({ x: event.clientX, y: event.clientY });

            const container = containerRef.current;
            if (!container || metrics.cellWidth <= 0 || metrics.rowHeight <= 0) {
                return;
            }

            setPlacementGridPosition(resolvePointerGridCell({
                clientX: event.clientX,
                clientY: event.clientY,
                container,
                cellWidth: metrics.cellWidth,
                rowHeight: metrics.rowHeight,
                size: { w: placementSource.w, h: placementSource.h },
                cols,
                rows,
            }));
        };

        window.addEventListener('pointermove', handlePointerMove);
        return () => window.removeEventListener('pointermove', handlePointerMove);
    }, [placementSourceWidgetId, placementSource, cols, rows, metrics.cellWidth, metrics.rowHeight, containerRef]);

    // A click anywhere on the canvas — empty space, or on top of any widget, overlap is allowed —
    // drops the pending copy instead of selecting/dragging whatever was clicked. Returns whether
    // it consumed the pointerdown, so callers skip their normal handling when it did.
    //
    // R3-001: commits the cell under THIS pointerdown's own clientX/clientY (via the same
    // `resolvePointerGridCell` helper the pointermove tracking uses), never the last-tracked
    // `placementGridPosition` state — a click/tap with no prior pointermove (touch, pen, or a
    // pointerdown at a new location) would otherwise drop the copy at a stale cell.
    const commitPlacementAt = (event: React.PointerEvent<HTMLDivElement>): boolean => {
        if (!placementSourceWidgetId || !placementSource || event.button !== 0) {
            return false;
        }

        const container = containerRef.current;
        if (!container || metrics.cellWidth <= 0 || metrics.rowHeight <= 0) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();
        onDuplicatePlacementCommit?.(resolvePointerGridCell({
            clientX: event.clientX,
            clientY: event.clientY,
            container,
            cellWidth: metrics.cellWidth,
            rowHeight: metrics.rowHeight,
            size: { w: placementSource.w, h: placementSource.h },
            cols,
            rows,
        }));
        return true;
    };

    const clearInteraction = useCallback(() => {
        interactionCleanupRef.current?.();
        interactionCleanupRef.current = null;
        interactionRef.current = null;
        setInteraction(null);
        setBodyCursor(null);
    }, []);

    // P8: while placing a copy (and no other interaction — e.g. a resize — is overriding the
    // cursor already), the body cursor shows the 'copy' feedback instead of the default arrow.
    const effectiveBodyCursor = bodyCursor ?? (placementSourceWidgetId ? 'copy' : null);

    useEffect(() => {
        const previousCursor = document.body.style.getPropertyValue('cursor');

        if (effectiveBodyCursor) {
            document.body.style.setProperty('cursor', effectiveBodyCursor);
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
    }, [effectiveBodyCursor]);

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
    // and must keep containing it. Move/resize of a member of the group CURRENTLY in edit mode
    // (D6) must never leave the container's bounds. Every other interaction resolves as before.
    const resolveCommittedLayoutForCommit = (currentInteraction: InteractionState): Pick<WidgetLayout, 'x' | 'y' | 'w' | 'h'> => {
        const baseLayout = resolveCommittedLayout({ interaction: currentInteraction, metrics, cols, rows });
        const widget = widgetMap.get(currentInteraction.widgetId);

        if (isResizeInteraction(currentInteraction.type) && widget && isGroupWidget(widget) && widget.locked) {
            const memberIds = resolveVisibleGroupMemberIds(widget);
            const membersBoundingBox = computeMembersBoundingBox(memberIds, layout);

            return clampGroupResizeToMembers(baseLayout, membersBoundingBox);
        }

        if (widget && editingGroupMemberIds.has(widget.id)) {
            const containerLayout = layout.find((item) => item.widgetId === editingGroupId);
            if (containerLayout) {
                // G9 review fix (R3-clamp-resize-translates-member): a RESIZE must shrink the
                // member from the edge the handle actually drags, keeping the opposite corner
                // fixed — `clampRectInsideContainer` (translate-based) is for MOVE only.
                return isResizeInteraction(currentInteraction.type)
                    ? clampResizeRectInsideContainer(
                        baseLayout,
                        containerLayout,
                        currentInteraction.type.slice('resize-'.length) as ResizeDirection,
                    )
                    : clampRectInsideContainer(baseLayout, containerLayout);
            }
        }

        return baseLayout;
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
        clickedItem: WidgetLayout,
        type: WidgetInteractionType,
    ) => {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        if (isResizeInteraction(type)) {
            event.stopPropagation();
        }

        // D6: exit pencil edit mode on any pointer down that lands outside the group being
        // edited — its container, or one of ITS members. A click on a different widget (plain,
        // or belonging to another locked group) always exits first, before that click is
        // otherwise handled below.
        if (editingGroupId) {
            const clickedWidget = widgetMap.get(clickedItem.widgetId);
            const clickedGroupScope = clickedWidget && isGroupWidget(clickedWidget)
                ? clickedWidget.id
                : findOwningLockedGroup(clickedItem.widgetId, widgets)?.id;
            if (clickedGroupScope !== editingGroupId) {
                onExitGroupEditMode?.();
            }
        }

        // D6: outside edit mode, a locked group acts as ONE widget — a pointer interaction that
        // starts on a member actually targets the container (selection, and a 'move' drag).
        const effectiveWidgetId = resolveEffectiveInteractionTarget(clickedItem.widgetId, widgets, editingGroupId);
        const item = type === 'move' && effectiveWidgetId !== clickedItem.widgetId
            ? (layout.find((entry) => entry.widgetId === effectiveWidgetId) ?? clickedItem)
            : clickedItem;

        const draggedWidget = widgetMap.get(item.widgetId);
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
            groupMemberIds,
            groupMemberStartLayouts,
            groupMemberBounds: {},
        };

        interactionRef.current = initialInteraction;
        setInteraction(initialInteraction);
        setBodyCursor(resizeCursor(type));
        onWidgetDragChange?.(null);

        const handlePointerMove = (moveEvent: PointerEvent) => {
            const currentInteraction = interactionRef.current;

            if (!currentInteraction) {
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

    // G7(b): render order is owned by `orderRenderItemsWithGroupsFirst`, not by `layout` array
    // order — a group container must ALWAYS paint beneath every other widget, locked or not.
    const visibleLayout = orderRenderItemsWithGroupsFirst(
        layout.filter((item) => !headerWidgetIds?.has(item.widgetId)),
        widgets,
    );

    return (
        <div
            ref={containerRef}
            data-testid="builder-canvas-root"
            tabIndex={0}
            onPointerDown={(event) => {
                if (commitPlacementAt(event)) {
                    return;
                }
                if (event.button === 0 && !(event.target as Element).closest('[data-testid^="builder-canvas-item-"]')) {
                    event.currentTarget.focus();
                    onWidgetSelect?.(undefined);
                    // D6: a click on empty canvas space is a click outside every group.
                    onExitGroupEditMode?.();
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
                        // D6: a member of a locked group NOT currently in edit mode acts as part
                        // of the container — no individual resize handles.
                        const isLockedMemberWidget = lockedMemberIds.has(widget.id) && !editingGroupMemberIds.has(widget.id);
                        const activeInteraction = interaction?.widgetId === widget.id ? interaction : null;
                        // Group move (G3/D6): while a locked container (or a member redirected to
                        // it) is being dragged, every member previews at the same live delta
                        // instead of jumping only on commit.
                        const groupPreviewBounds = interaction?.groupMemberBounds[widget.id];
                        // G13(a) (live check 4): a locked container's live resize preview must
                        // follow the pointer SMOOTHLY in raw pixels, exactly like every other
                        // resize (including an unlocked container's) — only the commit snaps to
                        // the grid. The members-bounding-box floor from G5b
                        // (R3-resize-preview-commit-mismatch) still applies, but now clamped in
                        // PIXELS directly against `tentativeBounds`, instead of round-tripping the
                        // preview through the grid (`resolveCommittedLayoutForCommit`), which is
                        // what made it jump cell-by-cell instead of tracking the pointer. D6: an
                        // editable member's own move/resize preview is still clamped to the
                        // container bounds via the grid-space commit resolver, matching what will
                        // actually be committed.
                        const resizePreviewBounds = (() => {
                            if (!activeInteraction) {
                                return null;
                            }

                            if (isResizeInteraction(activeInteraction.type) && isGroupWidget(widget) && widget.locked) {
                                const memberIds = resolveVisibleGroupMemberIds(widget);
                                const membersBoundingBox = computeMembersBoundingBox(memberIds, layout);
                                if (!membersBoundingBox) {
                                    return activeInteraction.tentativeBounds;
                                }
                                const membersBoundingBoxPx = layoutToPixelBounds(membersBoundingBox, metrics);
                                const clampedRect = clampGroupResizeToMembers(
                                    pixelBoundsToRect(activeInteraction.tentativeBounds),
                                    pixelBoundsToRect(membersBoundingBoxPx),
                                );
                                return rectToPixelBounds(clampedRect);
                            }

                            if (editingGroupMemberIds.has(widget.id)) {
                                return layoutToPixelBounds(resolveCommittedLayoutForCommit(activeInteraction), metrics);
                            }

                            return null;
                        })();
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
                                className={`relative group cursor-grab transition-opacity duration-200 ${widget.type === 'text-title' ? 'rounded-none' : 'rounded-xl'}`}
                                style={itemStyle}
                                onPointerDown={(event) => {
                                    // P8: overlap is allowed while placing — a click on top of an
                                    // existing widget drops the copy there instead of
                                    // selecting/dragging that widget.
                                    if (commitPlacementAt(event)) {
                                        return;
                                    }
                                    beginInteraction(event, item, 'move');
                                }}
                            >
                                <GridSelectionFrame
                                    isSelected={isSelected}
                                    isHighlighted={false}
                                    radius={getWidgetCornerRadius(widget.type)}
                                    inset={resolveWidgetSurfaceInset(widget)}
                                />

                                <WidgetHoverActions
                                    // G9: keep the hover actions centered on the widget's own
                                    // visible top border — a group container's border now sits
                                    // at the grid line (no inset), so its actions must not use
                                    // the standard --widget-spacing offset either.
                                    top={resolveWidgetSurfaceInset(widget)}
                                    // D6: a member of a locked group NOT in edit mode acts as
                                    // part of the container — it gets no hover actions of its
                                    // own; the container's own actions (copy/delete/lock/pencil,
                                    // rendered on the container's own item) are the group's.
                                    actions={isLockedMemberWidget ? [] : [
                                        ...(isHeaderCompatibleWidget(widget) && headerOccupiedSlotCount < HEADER_WIDGET_SLOT_COUNT
                                            ? [{
                                                label: 'Subir al header',
                                                icon: ArrowUp,
                                                onClick: () => onPromoteToHeader?.(widget.id),
                                              }]
                                            : []),
                                        ...(isGroupWidget(widget)
                                            ? [{
                                                // G7(a): the icon shows the current STATE, not the
                                                // action the click performs — locked -> closed
                                                // lock, unlocked -> open lock.
                                                label: widget.locked ? 'Desagrupar widgets' : 'Agrupar widgets',
                                                icon: widget.locked ? Lock : LockOpen,
                                                onClick: () => onToggleGroupLock?.(widget.id),
                                              }]
                                            : []),
                                        // D6 pencil edit mode: only offered on a LOCKED container.
                                        ...(isGroupWidget(widget) && widget.locked
                                            ? [{
                                                label: 'Editar contenido',
                                                icon: Pencil,
                                                onClick: () => onToggleGroupEditMode?.(widget.id),
                                                isActive: editingGroupId === widget.id,
                                              }]
                                            : []),
                                        {
                                            label: 'Duplicar widget',
                                            icon: Copy,
                                            onClick: () => onDuplicate?.(widget.id),
                                            // P8: pressed while THIS widget's copy is the one
                                            // currently being placed — clicking it again is one
                                            // of the documented cancel paths (the parent toggles
                                            // it off when the id matches).
                                            isActive: placementSourceWidgetId === widget.id,
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
                                            widgetInset={resolveWidgetSurfaceInset(widget)}
                                            onPointerDown={(event) => {
                                                // P8: a resize handle sits above the ghost's own
                                                // pointer-events-none overlay, so without this
                                                // guard it would start a resize instead of
                                                // dropping the copy while placing.
                                                if (commitPlacementAt(event)) {
                                                    return;
                                                }
                                                beginInteraction(event, item, `resize-${dir}`);
                                            }}
                                        />
                                    ))
                                )}

                                <div
                                    data-testid={`builder-canvas-item-surface-${widget.id}`}
                                    className="pointer-events-none relative z-0 h-full w-full box-border"
                                    style={{ padding: resolveWidgetSurfaceInset(widget) }}
                                >
                                    <GridFrameScope>
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
                                    </GridFrameScope>
                                </div>
                            </div>
                        );
                        })}
                    </div>

                    {/* P8: the placement ghost — same look as the selection/drag preview
                        (GridSelectionFrame's existing `isHighlighted` look, previously unused in
                        the builder), snapped to the grid, clamped inside it. For a locked group
                        it is the container plus one rect per visible member, translated together
                        as one rigid ghost. */}
                    {placementSourceWidgetId && placementSource && placementGridPosition && (() => {
                        const containerPx = layoutToPixelBounds(
                            {
                                x: placementGridPosition.x,
                                y: placementGridPosition.y,
                                w: placementSource.w,
                                h: placementSource.h,
                            },
                            metrics,
                        );
                        return (
                            <div
                                data-testid="builder-canvas-placement-ghost"
                                aria-hidden="true"
                                className="pointer-events-none absolute inset-0 z-30"
                            >
                                <PlacementGhostRect
                                    testId="builder-canvas-placement-ghost-source"
                                    px={containerPx}
                                    widgetType={placementSource.type}
                                />
                                {placementSource.memberGhosts.map((member) => {
                                    const memberPx = layoutToPixelBounds(
                                        {
                                            x: placementGridPosition.x + member.relX,
                                            y: placementGridPosition.y + member.relY,
                                            w: member.w,
                                            h: member.h,
                                        },
                                        metrics,
                                    );
                                    return (
                                        <PlacementGhostRect
                                            key={member.id}
                                            testId={`builder-canvas-placement-ghost-member-${member.id}`}
                                            px={memberPx}
                                            widgetType={member.type}
                                        />
                                    );
                                })}
                            </div>
                        );
                    })()}

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

                    {/* P8: visible copy of the aria-live hint rendered below (last child of the
                        root), purely decorative — the sr-only region already owns the accessible
                        announcement. */}
                    {placementSourceWidgetId && placementPointer && (
                        <CursorTooltip
                            data-testid="builder-canvas-placement-cursor-hint"
                            aria-hidden="true"
                            label="Haga clic para ubicar la copia. Escape para cancelar."
                            x={visualToLayoutPx(placementPointer.x)}
                            y={visualToLayoutPx(placementPointer.y)}
                            anchor="se"
                        />
                    )}
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

            {/* P8: always mounted (last child, so it never disturbs `firstElementChild`-based
                measurement assertions) so screen readers announce the moment placement starts,
                not only once the ghost has a first pointer position to render at. */}
            <div data-testid="builder-canvas-placement-hint" role="status" aria-live="polite" className="sr-only">
                {placementSourceWidgetId ? 'Haga clic para ubicar la copia. Escape para cancelar.' : ''}
            </div>
        </div>
    );
}
