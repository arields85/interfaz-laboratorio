import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import { parseCssLengthPx } from '../utils/tabFramePath';
import { resolveTabFrameIconPlacement, TAB_FRAME_ICON_SIZE_PX, type TabFrameIconPlacement } from '../utils/tabFrameIcon';

function isSamePlacement(a: TabFrameIconPlacement | null, b: TabFrameIconPlacement | null): boolean {
    if (a === null || b === null) {
        return a === b;
    }

    return a.top === b.top && a.right === b.right && a.inStrip === b.inStrip && a.reserve === b.reserve;
}

/**
 * Placement of the header icon of the tab frame in `ref` (the shell), computed from the
 * `--tab-frame-*` tokens (the icon rule depends on tokens only, never on the widget size). `null`
 * until measured and while the tab shape is inactive. It measures in a layout effect and re-measures
 * when the document style changes (a theme preview rewrites the frame tokens there).
 */
export function useTabFrameIconPlacement(
    ref: RefObject<HTMLElement | null>,
    active: boolean,
): TabFrameIconPlacement | null {
    const [placement, setPlacement] = useState<TabFrameIconPlacement | null>(null);

    useLayoutEffect(() => {
        const element = ref.current;

        if (!active || !element) {
            return undefined;
        }

        const measure = () => {
            const style = window.getComputedStyle(element);
            const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
            const token = (name: string) => parseCssLengthPx(style.getPropertyValue(name), rootFontSize);
            // The host scales the icon toward its top-right corner, so the rule uses the drawn size.
            const scale = Number.parseFloat(style.getPropertyValue('--tab-frame-icon-scale'));
            const iconSize = TAB_FRAME_ICON_SIZE_PX * (Number.isFinite(scale) && scale > 0 ? scale : 1);
            const next = resolveTabFrameIconPlacement({
                tabHeight: token('--tab-frame-height'),
                bodyCut: token('--tab-frame-body-cut'),
                right: token('--tab-frame-icon-right'),
                gap: token('--tab-frame-icon-gap'),
                clearance: token('--tab-frame-icon-clearance'),
                minTop: token('--tab-frame-icon-min-top'),
                tabGap: token('--tab-frame-icon-tab-gap'),
            }, iconSize);

            setPlacement((current) => (isSamePlacement(current, next) ? current : next));
        };

        measure();

        const mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(measure);
        mutationObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

        return () => mutationObserver?.disconnect();
    }, [ref, active]);

    return active ? placement : null;
}
