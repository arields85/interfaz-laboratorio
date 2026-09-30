import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';
import {
    ICON_CUTOUT_ICON_ATTRIBUTE,
    clearIconCutout,
    measureIconCutout,
    writeIconCutout,
} from '../utils/iconCutout';

const ICON_SELECTOR = `[${ICON_CUTOUT_ICON_ATTRIBUTE}]`;

/**
 * While `active`, centers the frame's icon cutout on its header icon: finds the icon, measures it and
 * publishes the opt-in attribute plus the center / half-size custom properties on the frame (see
 * `utils/iconCutout.ts`). A frame without a (visible) icon is never opted in, so it keeps today's
 * look. It re-measures, before paint, when the frame or the icon change size and when the frame's
 * content changes (the icon moves with the header layout); unchanged measures publish nothing.
 * Turning `active` off (or unmounting) restores the frame.
 */
export function useIconCutoutGeometry(frameRef: RefObject<HTMLElement | null>, active: boolean): void {
    useLayoutEffect(() => {
        const frame = frameRef.current;

        if (!active || !frame) {
            return undefined;
        }

        const target: HTMLElement = frame;
        const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => update());
        let observedIcon: Element | null = null;
        let published = '';

        function update() {
            const icon = target.querySelector(ICON_SELECTOR);
            const measure = icon ? measureIconCutout(target, icon) : null;

            if (icon !== observedIcon) {
                if (observedIcon) {
                    resizeObserver?.unobserve(observedIcon);
                }
                if (icon) {
                    resizeObserver?.observe(icon);
                }
                observedIcon = icon;
            }

            if (!measure) {
                if (published !== '') {
                    clearIconCutout(target);
                    published = '';
                }
                return;
            }

            const key = `${measure.x}|${measure.y}|${measure.half}`;

            if (key !== published) {
                writeIconCutout(target, measure);
                published = key;
            }
        }

        resizeObserver?.observe(target);
        const mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update);
        mutationObserver?.observe(target, { childList: true, subtree: true, characterData: true });
        update();

        return () => {
            resizeObserver?.disconnect();
            mutationObserver?.disconnect();
            clearIconCutout(target);
        };
    }, [frameRef, active]);
}
