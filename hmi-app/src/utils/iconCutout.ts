// =============================================================================
// Icon cutout ("Calado del ícono")
//
// With the Clasico preset and the Estandar frame shape, a widget frame of a dashboard grid may show
// its background (fill, blur, border, corner accent) transparent inside a circle centered on the
// header icon. The circle is a CSS mask (`index.css`, `[data-icon-cutout]`); this module is the
// measuring side: where the icon is, relative to the frame, and the custom properties that carry it.
// The radius (half the icon + `--icon-cutout-margin`) and the feather, ring and margin tokens live in CSS.
// =============================================================================

/** Opt-in attribute of a frame that has the cutout; `index.css` only reacts to it. */
export const ICON_CUTOUT_ATTRIBUTE = 'data-icon-cutout';

/** Marks the header icon element `WidgetHeader` draws: the one the cutout is centered on. */
export const ICON_CUTOUT_ICON_ATTRIBUTE = 'data-header-icon';

/** Custom properties published on the frame (px, relative to its border box). */
export const ICON_CUTOUT_PROPERTIES = {
    x: '--icon-cutout-x',
    y: '--icon-cutout-y',
    half: '--icon-cutout-half',
} as const;

export interface IconCutoutMeasure {
    /** Icon center, from the frame's left border edge. */
    x: number;
    /** Icon center, from the frame's top border edge. */
    y: number;
    /** Half the icon's rendered size. */
    half: number;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * Measures `icon` inside `frame` in layout pixels (the frame's border box is the origin), or null when
 * either has no box. A scaled frame (the builder's zoom) is converted back to layout pixels from the
 * ratio of its rendered width to its `offsetWidth`.
 */
export function measureIconCutout(frame: HTMLElement, icon: Element): IconCutoutMeasure | null {
    const frameRect = frame.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();

    if (frameRect.width <= 0 || frameRect.height <= 0 || iconRect.width <= 0 || iconRect.height <= 0) {
        return null;
    }

    const scale = frame.offsetWidth > 0 ? frameRect.width / frame.offsetWidth : 1;

    return {
        x: round2((iconRect.left + iconRect.width / 2 - frameRect.left) / scale),
        y: round2((iconRect.top + iconRect.height / 2 - frameRect.top) / scale),
        half: round2(Math.max(iconRect.width, iconRect.height) / 2 / scale),
    };
}

export function writeIconCutout(frame: HTMLElement, measure: IconCutoutMeasure): void {
    frame.setAttribute(ICON_CUTOUT_ATTRIBUTE, 'true');
    frame.style.setProperty(ICON_CUTOUT_PROPERTIES.x, `${measure.x}px`);
    frame.style.setProperty(ICON_CUTOUT_PROPERTIES.y, `${measure.y}px`);
    frame.style.setProperty(ICON_CUTOUT_PROPERTIES.half, `${measure.half}px`);
}

export function clearIconCutout(frame: HTMLElement): void {
    frame.removeAttribute(ICON_CUTOUT_ATTRIBUTE);
    for (const name of Object.values(ICON_CUTOUT_PROPERTIES)) {
        frame.style.removeProperty(name);
    }
}
