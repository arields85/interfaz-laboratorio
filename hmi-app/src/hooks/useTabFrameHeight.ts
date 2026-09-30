import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import { parseCssLengthPx } from '../utils/tabFramePath';
import { capTabFrameHeight, resolveTabFrameHeight } from '../utils/tabFrameHeight';

/**
 * Effective tab height (px) for a title that has its own font size (`titleFontSize`, the `group`
 * widget): its line box plus `--tab-frame-title-pad-y` above and below, never below the standard
 * `--tab-frame-height` (see `utils/tabFrameHeight.ts`), and never more than the frame at `frameRef`
 * (the shell) can give while keeping a minimal body (`capTabFrameHeight`: body chamfer + 2 x the
 * frame radius). The tokens are read from the document root, where they are defined, NOT from the
 * frame: the frame publishes the result as its own `--tab-frame-height`, so reading it there would
 * feed back. `null` when there is no own size (every other tab keeps the token untouched) or before
 * the first measure. It measures in a layout effect and re-measures when the frame is resized and
 * when the document style changes (a theme preview rewrites the frame tokens there). A frame that is
 * not laid out yet (height 0) is not capped.
 */
export function useTabFrameHeight(
    titleFontSize: number | null | undefined,
    frameRef: RefObject<HTMLElement | null>,
): number | null {
    const [height, setHeight] = useState<number | null>(null);

    useLayoutEffect(() => {
        if (titleFontSize === null || titleFontSize === undefined) {
            return undefined;
        }

        const frame = frameRef.current;

        const measure = () => {
            const rootStyle = window.getComputedStyle(document.documentElement);
            const rootFontSize = Number.parseFloat(rootStyle.fontSize) || 16;
            const token = (name: string) => parseCssLengthPx(rootStyle.getPropertyValue(name), rootFontSize);
            const requested = resolveTabFrameHeight({
                baseHeight: token('--tab-frame-height'),
                titleFontSize,
                padY: token('--tab-frame-title-pad-y'),
            });
            const frameHeight = frame?.clientHeight ?? 0;

            setHeight(frame && frameHeight > 0
                ? capTabFrameHeight({
                    tabHeight: requested,
                    frameHeight,
                    bodyCut: token('--tab-frame-body-cut'),
                    radius: parseCssLengthPx(window.getComputedStyle(frame).borderTopLeftRadius, rootFontSize),
                })
                : requested);
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

    return titleFontSize === null || titleFontSize === undefined ? null : height;
}
