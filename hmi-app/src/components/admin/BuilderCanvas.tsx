import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Trash2, ArrowUp, LayoutDashboard } from 'lucide-react';
import type { WidgetConfig, WidgetLayout } from '../../domain/admin.types';
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
import type { TrendChartV2RenderContext } from '../../widgets/renderers/trendChartV2RenderContext';
import WidgetPresentationBoundary from '../viewer/WidgetPresentationBoundary';

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
    onWidgetDragChange,
    headerWidgetIds,
    headerOccupiedSlotCount = 0,
    onPromoteToHeader,
    cols = DEFAULT_COLS,
    rows = DEFAULT_ROWS,
}: BuilderCanvasProps) {
    const getWidgetCornerRadius = (type: WidgetConfig['type']) => (type === 'text-title' ? '0px' : '1.5rem');
    const widgetMap = new Map(widgets.map((widget) => [widget.id, widget]));
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

            const deltaX = moveEvent.clientX - currentInteraction.startPointer.x;
            const deltaY = moveEvent.clientY - currentInteraction.startPointer.y;
            const distance = Math.hypot(deltaX, deltaY);
            const hasExceededThreshold = isResizeInteraction(currentInteraction.type)
                ? true
                : currentInteraction.hasExceededThreshold || distance > DRAG_THRESHOLD_PX;

            const tentativeBounds = currentInteraction.type === 'move' && !hasExceededThreshold
                ? currentInteraction.startBounds
                : applyPointerDeltaToPixelBounds(
                    currentInteraction.type,
                    currentInteraction.startBounds,
                    deltaX,
                    deltaY,
                );

            const nextInteraction: InteractionState = {
                ...currentInteraction,
                currentPointer: { x: moveEvent.clientX, y: moveEvent.clientY },
                tentativeBounds,
                hasExceededThreshold,
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

            commitLayout(
                currentInteraction.widgetId,
                resolveCommittedLayout({
                    interaction: currentInteraction,
                    metrics,
                    cols,
                    rows,
                }),
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
        ? resolveCommittedLayout({ interaction, metrics, cols, rows })
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
                        const activeInteraction = interaction?.widgetId === widget.id ? interaction : null;
                        const itemStyle = activeInteraction
                            ? {
                                position: 'absolute' as const,
                                left: `${activeInteraction.tentativeBounds.left}px`,
                                top: `${activeInteraction.tentativeBounds.top}px`,
                                width: `${activeInteraction.tentativeBounds.width}px`,
                                height: `${activeInteraction.tentativeBounds.height}px`,
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

                                {isSelected && (
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
                                x={interaction.currentPointer.x}
                                y={interaction.currentPointer.y}
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
