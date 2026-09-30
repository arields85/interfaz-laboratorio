import { useLayoutEffect, useState } from 'react';
import { parseCssLengthPx } from '../utils/tabFramePath';
import { resolveTabFrameHeight } from '../utils/tabFrameHeight';

/**
 * Effective tab height (px) for a title that has its own font size (`titleFontSize`, the `group`
 * widget): its line box plus `--tab-frame-title-pad-y` above and below, never below the standard
 * `--tab-frame-height` (see `utils/tabFrameHeight.ts`). The tokens are read from the document root,
 * where they are defined, NOT from the frame: the frame publishes the result as its own
 * `--tab-frame-height`, so reading it there would feed back. `null` when there is no own size (every
 * other tab keeps the token untouched) or before the first measure. It measures in a layout effect
 * and re-measures when the document style changes (a theme preview rewrites the frame tokens there).
 */
export function useTabFrameHeight(titleFontSize: number | null | undefined): number | null {
    const [height, setHeight] = useState<number | null>(null);

    useLayoutEffect(() => {
        if (titleFontSize === null || titleFontSize === undefined) {
            return undefined;
        }

        const measure = () => {
            const rootStyle = window.getComputedStyle(document.documentElement);
            const rootFontSize = Number.parseFloat(rootStyle.fontSize) || 16;
            const token = (name: string) => parseCssLengthPx(rootStyle.getPropertyValue(name), rootFontSize);

            setHeight(resolveTabFrameHeight({
                baseHeight: token('--tab-frame-height'),
                titleFontSize,
                padY: token('--tab-frame-title-pad-y'),
            }));
        };

        measure();

        const mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(measure);
        mutationObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

        return () => mutationObserver?.disconnect();
    }, [titleFontSize]);

    return titleFontSize === null || titleFontSize === undefined ? null : height;
}
