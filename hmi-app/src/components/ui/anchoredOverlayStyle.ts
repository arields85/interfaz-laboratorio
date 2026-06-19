import type { AnchoredOverlayAlign } from './AnchoredOverlay';

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

    const base: ResolvedAnchoredOverlayStyle = {
        position: 'fixed',
        left: clampedLeft,
        zIndex: 9999,
        minWidth: resolvedMinWidth,
        maxWidth: `calc(100vw - ${viewportPadding * 2}px)`,
    };

    if (spaceBelow < estimatedHeight + gap) {
        return { ...base, bottom: window.innerHeight - rect.top + gap };
    }

    return { ...base, top: rect.bottom + gap };
}
