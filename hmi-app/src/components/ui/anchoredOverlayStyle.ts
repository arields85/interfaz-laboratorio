import type { AnchoredOverlayAlign } from './AnchoredOverlay';
import { getEffectiveZoom, visualToLayoutPx } from '../../utils/zoomCoordinates';

export interface ResolvedAnchoredOverlayStyle {
    position: 'fixed';
    left: number;
    zIndex: number;
    minWidth: number | string;
    maxWidth: number | string;
    top?: number;
    bottom?: number;
}

export function resolveAnchoredOverlayStyle(
    trigger: HTMLElement,
    estimatedHeight: number,
    minWidth: number | 'trigger',
    align: AnchoredOverlayAlign,
    gap: number,
): ResolvedAnchoredOverlayStyle {
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const viewportPadding = 8;

    let left: number;
    if (align === 'start') {
        left = rect.left;
    } else if (align === 'end') {
        const overlayWidth = typeof minWidth === 'number' ? minWidth : rect.width;
        left = rect.right - overlayWidth;
    } else {
        const overlayWidth = typeof minWidth === 'number' ? minWidth : rect.width;
        left = rect.left + rect.width / 2 - overlayWidth / 2;
    }

    const resolvedMinWidth = minWidth === 'trigger' ? rect.width : minWidth;
    const overlayWidth = typeof resolvedMinWidth === 'number' ? resolvedMinWidth : rect.width;
    const clampedLeft = Math.min(
        Math.max(left, viewportPadding),
        window.innerWidth - overlayWidth - viewportPadding,
    );

    // Every value above is REAL/visual px (getBoundingClientRect() and
    // window.innerWidth/innerHeight all share that space, see
    // ../../utils/zoomCoordinates.ts) — consistent to compare/combine
    // directly. AnchoredOverlay writes the fields below straight into
    // `element.style.{left,top,bottom,minWidth}` as CSS lengths, which the
    // browser's own zoom pre-multiplies again on paint (PW-007 T3b), so they
    // must be converted to layout px here first.
    const zoom = getEffectiveZoom();

    const base: ResolvedAnchoredOverlayStyle = {
        position: 'fixed',
        left: visualToLayoutPx(clampedLeft, zoom),
        zIndex: 9999,
        minWidth: visualToLayoutPx(resolvedMinWidth, zoom),
        maxWidth: `calc(var(--viewport-width) - ${viewportPadding * 2}px)`,
    };

    if (spaceBelow < estimatedHeight + gap) {
        return { ...base, bottom: visualToLayoutPx(window.innerHeight - rect.top + gap, zoom) };
    }

    return { ...base, top: visualToLayoutPx(rect.bottom + gap, zoom) };
}
