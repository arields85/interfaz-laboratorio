import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import { parseCssLengthPx } from '../utils/tabFramePath';
import { capTabFrameHeight, resolveTabFrameHeight, scaleTabFrameCut } from '../utils/tabFrameHeight';

/** Effective size of a tab with its own title size: its height and the cut of its slanted side (px). */
export interface TabFrameOwnSize {
    height: number;
    /** `--tab-frame-tab-cut` scaled by `height` over the standard height: the slanted side keeps its angle. */
    tabCut: number;
}

function isSameSize(a: TabFrameOwnSize | null, b: TabFrameOwnSize): boolean {
    return a !== null && a.height === b.height && a.tabCut === b.tabCut;
}

/**
 * Effective tab size (px) for a title that has its own font size (`titleFontSize`, the `group`
 * widget): its line box plus `--tab-frame-title-pad-y` above and below, never below the standard
 * `--tab-frame-height` (see `utils/tabFrameHeight.ts`), and never more than the frame at `frameRef`
 * (the shell) can give while keeping a minimal body (`capTabFrameHeight`: body chamfer + 2 x the
 * frame radius). The tokens are read from the document root, where they are defined, NOT from the
 * frame: the frame publishes the result as its own `--tab-frame-height`, so reading it there would
 * feed back. Together with the height it returns the cut of the slanted side scaled to it
 * (`scaleTabFrameCut`), so the tab keeps the angle of the standard one. `null` when there is no own size (every other tab keeps the token untouched) or before
 * the first measure. It measures in a layout effect and re-measures when the frame is resized and
 * when the document style changes (a theme preview rewrites the frame tokens there). A frame that is
 * not laid out yet (height 0) is not capped.
 */
export function useTabFrameHeight(
    titleFontSize: number | null | undefined,
    frameRef: RefObject<HTMLElement | null>,
): TabFrameOwnSize | null {
    const [size, setSize] = useState<TabFrameOwnSize | null>(null);

    useLayoutEffect(() => {
        if (titleFontSize === null || titleFontSize === undefined) {
            return undefined;
        }

        const frame = frameRef.current;

        const measure = () => {
            const rootStyle = window.getComputedStyle(document.documentElement);
            const rootFontSize = Number.parseFloat(rootStyle.fontSize) || 16;
            const token = (name: string) => parseCssLengthPx(rootStyle.getPropertyValue(name), rootFontSize);
            const baseHeight = token('--tab-frame-height');
            const requested = resolveTabFrameHeight({
                baseHeight,
                titleFontSize,
                padY: token('--tab-frame-title-pad-y'),
            });
            const frameHeight = frame?.clientHeight ?? 0;

            const height = frame && frameHeight > 0
                ? capTabFrameHeight({
                    tabHeight: requested,
                    frameHeight,
                    bodyCut: token('--tab-frame-body-cut'),
                    radius: parseCssLengthPx(window.getComputedStyle(frame).borderTopLeftRadius, rootFontSize),
                })
                : requested;
            const next = { height, tabCut: scaleTabFrameCut({ baseCut: token('--tab-frame-tab-cut'), baseHeight, tabHeight: height }) };

            setSize((current) => (isSameSize(current, next) ? current : next));
        };

        measure();

        const mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(measure);
        mutationObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

        const resizeObserver = frame && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        if (frame) {
            resizeObserver?.observe(frame);
        }

        return () => {
            mutationObserver?.disconnect();
            resizeObserver?.disconnect();
        };
    }, [titleFontSize, frameRef]);

    return titleFontSize === null || titleFontSize === undefined ? null : size;
}
