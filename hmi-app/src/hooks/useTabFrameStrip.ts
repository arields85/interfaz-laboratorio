import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import { parseCssLengthPx } from '../utils/tabFramePath';
import { TAB_FRAME_ICON_SIZE_PX, type TabFrameIconPlacement } from '../utils/tabFrameIcon';
import { resolveTabFrameStripExtent, resolveTabFrameTrailing } from '../utils/tabFrameTrailing';

/** What a frame with strip content (a chart's period selector) publishes on its shell. */
export interface TabFrameStripLayout {
    /** Space (px) the tab leaves free at the right of the frame; null = no strip content, tokens untouched. */
    reserve: number | null;
    /** Space (px) the trailing host keeps free at its end for the icon (icon width + gap), 0 when there is none. */
    iconExtent: number;
    /** True when the title tab has no room for its label and must not be shown. */
    titleHidden: boolean;
    /**
     * Height (px) the header keeps at the top of the content so it starts under the strip: the tab height
     * minus the padding and border above the header.
     */
    clearance: number;
}

function isSameLayout(a: TabFrameStripLayout | null, b: TabFrameStripLayout): boolean {
    return a !== null
        && a.reserve === b.reserve
        && a.iconExtent === b.iconExtent
        && a.titleHidden === b.titleHidden
        && a.clearance === b.clearance;
}

interface TabFrameStripOptions {
    /** The shell of the tab frame (its size and tokens are read here). */
    shellRef: RefObject<HTMLElement | null>;
    /** The trailing host of the shell (null until mounted). */
    trailingHost: HTMLElement | null;
    /** The content element (its padding and border are what the header clearance compensates). */
    content: HTMLElement | null;
    active: boolean;
    /** Effective tab height (px) of a tab with its own size; without it `--tab-frame-height` applies. */
    tabHeight?: number;
    /** Placement of the header icon (`useTabFrameIconPlacement`); the strip content sits next to it. */
    iconPlacement: TabFrameIconPlacement | null;
}

/**
 * Layout of the top strip of a tab frame that holds trailing header content: where the tab must stop
 * (`reserve`), how much room the selector leaves for the icon, whether the title tab has to be hidden
 * (`utils/tabFrameTrailing.ts`) and the clearance of the header row. Sizes come from the measured shell
 * and trailing host and from the `--tab-frame-*` tokens; it measures in a layout effect (the first
 * paint already has it) and re-measures when the shell or the host is resized (the selector grows
 * with its options) and when the document style changes (a theme preview rewrites the tokens).
 * `null` until measured and while the tab shape is inactive.
 */
export function useTabFrameStrip({
    shellRef,
    trailingHost,
    content,
    active,
    tabHeight,
    iconPlacement,
}: TabFrameStripOptions): TabFrameStripLayout | null {
    const [layout, setLayout] = useState<TabFrameStripLayout | null>(null);
    const baseReserve = iconPlacement?.reserve ?? 0;
    const iconInStrip = iconPlacement?.inStrip ?? false;

    useLayoutEffect(() => {
        const shell = shellRef.current;

        if (!active || !shell) {
            return undefined;
        }

        const measure = () => {
            const style = window.getComputedStyle(shell);
            const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
            const token = (name: string) => parseCssLengthPx(style.getPropertyValue(name), rootFontSize);
            const gap = token('--tab-frame-trailing-gap');
            const scale = Number.parseFloat(style.getPropertyValue('--tab-frame-icon-scale'));
            const iconSize = TAB_FRAME_ICON_SIZE_PX * (Number.isFinite(scale) && scale > 0 ? scale : 1);
            const trailing = resolveTabFrameTrailing({
                frameWidth: shell.clientWidth,
                baseReserve,
                right: token('--tab-frame-icon-right'),
                hostWidth: trailingHost?.offsetWidth ?? 0,
                gap,
                tabCut: token('--tab-frame-tab-cut'),
                padStart: token('--tab-frame-pad-start'),
                padEnd: token('--tab-frame-pad-end'),
                minTitle: token('--tab-frame-min-title'),
            });
            const hasTrailing = (trailingHost?.offsetWidth ?? 0) > 0;
            // Only a frame with strip content clears its header row under the strip.
            const contentStyle = hasTrailing && content ? window.getComputedStyle(content) : null;
            const above = contentStyle
                ? parseCssLengthPx(contentStyle.paddingTop, rootFontSize) + parseCssLengthPx(contentStyle.borderTopWidth, rootFontSize)
                : 0;
            const next: TabFrameStripLayout = {
                reserve: hasTrailing ? trailing.reserve : null,
                iconExtent: hasTrailing ? resolveTabFrameStripExtent({ inStrip: iconInStrip, iconSize, gap }) : 0,
                titleHidden: trailing.titleHidden,
                clearance: Math.max(0, Math.round(((tabHeight ?? token('--tab-frame-height')) - above) * 100) / 100),
            };

            setLayout((current) => (isSameLayout(current, next) ? current : next));
        };

        measure();

        const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
        resizeObserver?.observe(shell);

        if (trailingHost) {
            resizeObserver?.observe(trailingHost);
        }

        const mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(measure);
        mutationObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

        return () => {
            resizeObserver?.disconnect();
            mutationObserver?.disconnect();
        };
    }, [shellRef, trailingHost, content, active, tabHeight, baseReserve, iconInStrip]);

    return active ? layout : null;
}
