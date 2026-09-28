import type { WidgetLayout } from '../domain/admin.types';

export type ResizeDirection = 'nw' | 'ne' | 'sw' | 'se';
export type WidgetInteractionType = 'move' | `resize-${ResizeDirection}`;

export function isResizeInteraction(type: WidgetInteractionType): boolean {
    return type.startsWith('resize-');
}

export function resizeCursor(type: WidgetInteractionType): string {
    switch (type) {
        case 'resize-se': return 'se-resize';
        case 'resize-ne': return 'ne-resize';
        case 'resize-nw': return 'nw-resize';
        case 'resize-sw': return 'sw-resize';
        default: return 'grabbing';
    }
}

export interface WidgetInteractionMetrics {
    cellWidth: number;
    rowHeight: number;
}

export interface WidgetPixelBounds {
    left: number;
    top: number;
    width: number;
    height: number;
}

export function layoutToPixelBounds(
    layout: Pick<WidgetLayout, 'x' | 'y' | 'w' | 'h'>,
    metrics: WidgetInteractionMetrics,
): WidgetPixelBounds {
    return {
        left: layout.x * metrics.cellWidth,
        top: layout.y * metrics.rowHeight,
        width: layout.w * metrics.cellWidth,
        height: layout.h * metrics.rowHeight,
    };
}

/**
 * G13(a): a pure field-rename between `WidgetPixelBounds` (`left/top/width/height`) and the
 * generic `{x,y,w,h}` rect shape used by unit-agnostic geometry helpers (e.g.
 * `clampGroupResizeToMembers` in `utils/groupWidget.ts`) — no unit conversion, unlike
 * `layoutToPixelBounds`/`pixelBoundsToGridBounds` above. Lets a PIXEL-space rect reuse the same
 * "grow to stay a superset" clamp math already written for grid-space rects, so a locked group's
 * live resize preview can be clamped to its members' pixel bounds directly, without round-tripping
 * through the grid (which is what made the preview jump cell-by-cell instead of following the
 * pointer smoothly).
 */
export function pixelBoundsToRect(bounds: WidgetPixelBounds): Pick<WidgetLayout, 'x' | 'y' | 'w' | 'h'> {
    return { x: bounds.left, y: bounds.top, w: bounds.width, h: bounds.height };
}

export function rectToPixelBounds(rect: Pick<WidgetLayout, 'x' | 'y' | 'w' | 'h'>): WidgetPixelBounds {
    return { left: rect.x, top: rect.y, width: rect.w, height: rect.h };
}

export function pixelBoundsToGridBounds(
    bounds: WidgetPixelBounds,
    metrics: WidgetInteractionMetrics,
): Pick<WidgetLayout, 'x' | 'y' | 'w' | 'h'> {
    return {
        x: metrics.cellWidth > 0 ? Math.round(bounds.left / metrics.cellWidth) : 0,
        y: metrics.rowHeight > 0 ? Math.round(bounds.top / metrics.rowHeight) : 0,
        w: metrics.cellWidth > 0 ? Math.round(bounds.width / metrics.cellWidth) : 1,
        h: metrics.rowHeight > 0 ? Math.round(bounds.height / metrics.rowHeight) : 1,
    };
}

export function applyPointerDeltaToPixelBounds(
    type: WidgetInteractionType,
    startBounds: WidgetPixelBounds,
    deltaX: number,
    deltaY: number,
): WidgetPixelBounds {
    if (type === 'move') {
        return {
            left: startBounds.left + deltaX,
            top: startBounds.top + deltaY,
            width: startBounds.width,
            height: startBounds.height,
        };
    }

    switch (type) {
        case 'resize-se':
            return {
                left: startBounds.left,
                top: startBounds.top,
                width: Math.max(1, startBounds.width + deltaX),
                height: Math.max(1, startBounds.height + deltaY),
            };
        case 'resize-ne':
            return {
                left: startBounds.left,
                top: startBounds.top + deltaY,
                width: Math.max(1, startBounds.width + deltaX),
                height: Math.max(1, startBounds.height - deltaY),
            };
        case 'resize-nw':
            return {
                left: startBounds.left + deltaX,
                top: startBounds.top + deltaY,
                width: Math.max(1, startBounds.width - deltaX),
                height: Math.max(1, startBounds.height - deltaY),
            };
        case 'resize-sw':
            return {
                left: startBounds.left + deltaX,
                top: startBounds.top,
                width: Math.max(1, startBounds.width - deltaX),
                height: Math.max(1, startBounds.height + deltaY),
            };
    }
}
