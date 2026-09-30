import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import { parseCssLengthPx, type TabFramePathGeometry } from '../utils/tabFramePath';

function isSameGeometry(a: TabFramePathGeometry | null, b: TabFramePathGeometry | null): boolean {
    if (a === null || b === null) {
        return a === b;
    }

    return a.width === b.width
        && a.height === b.height
        && a.tabWidth === b.tabWidth
        && a.tabHeight === b.tabHeight
        && a.tabCut === b.tabCut
        && a.bodyCut === b.bodyCut
        && a.radius === b.radius
        && a.glowSpread === b.glowSpread;
}

/**
 * Pixel geometry of the tab frame silhouette for the layer rendered in `ref` (a box that has the
 * frame's size): its measured size, the tab width reported by the frame, the `--tab-frame-*` tokens
 * and the corner radius (`border-radius` of `ref`, so callers decide which radius applies).
 * `null` while there is no tab (`tabWidth` null), its width is still unknown (`<= 0`, the frame has
 * not measured its title yet) or the box has not been laid out yet. Callers that know the frame IS
 * the tab shape (`tabWidth !== null`) draw nothing meanwhile rather than a rectangle. It measures in a
 * layout effect so the first paint already has the silhouette. It re-measures on resize and when the document style changes (a
 * theme preview rewrites the frame tokens there).
 *
 * `tabHeight` is the effective tab height (px) of a frame whose tab is taller than the standard one
 * (a title with its own size, reported by its `WidgetFrame`); without it the `--tab-frame-height`
 * token applies. Layers outside the frame's shell cannot read the frame's own override, so they pass it.
 */
export function useTabFrameGeometry(
    ref: RefObject<HTMLElement | null>,
    tabWidth: number | null,
    tabHeight?: number,
): TabFramePathGeometry | null {
    const [geometry, setGeometry] = useState<TabFramePathGeometry | null>(null);

    useLayoutEffect(() => {
        const element = ref.current;

        if (tabWidth === null || tabWidth <= 0 || !element) {
            return undefined;
        }

        const measure = () => {
            const width = element.clientWidth;
            const height = element.clientHeight;

            if (!(width > 0 && height > 0)) {
                setGeometry(null);
                return;
            }

            const style = window.getComputedStyle(element);
            const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
            const token = (name: string) => parseCssLengthPx(style.getPropertyValue(name), rootFontSize);
            const next: TabFramePathGeometry = {
                width,
                height,
                tabWidth,
                tabHeight: tabHeight ?? token('--tab-frame-height'),
                tabCut: token('--tab-frame-tab-cut'),
                bodyCut: token('--tab-frame-body-cut'),
                radius: parseCssLengthPx(style.borderTopLeftRadius, rootFontSize),
                glowSpread: token('--tab-frame-glow-spread'),
            };

            setGeometry((current) => (isSameGeometry(current, next) ? current : next));
        };

        measure();

        const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
        resizeObserver?.observe(element);

        const mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(measure);
        mutationObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

        return () => {
            resizeObserver?.disconnect();
            mutationObserver?.disconnect();
        };
    }, [ref, tabWidth, tabHeight]);

    // Without a tab there is no silhouette, whatever was measured before.
    return tabWidth === null || tabWidth <= 0 ? null : geometry;
}
