// =============================================================================
// Zoom Coordinates — visual (real, zoomed) px <-> layout (pre-zoom) px
//
// PW-007 T3b (measured in headless Chrome, zoom 1.25 on <html>, window
// 1600x900, 2026-09-23): standardized CSS `zoom` produces exactly two
// coordinate spaces, not the "vh is divided back out" single space T3
// originally (and incorrectly) assumed:
//
//   - REAL/VISUAL space: what a ruler on the screen would measure.
//     getBoundingClientRect(), PointerEvent.clientX/clientY/pageX/pageY,
//     window.innerWidth/innerHeight and document.documentElement.clientWidth/
//     clientHeight (the root only) all report this space and can be freely
//     compared/subtracted/added to each other with no conversion — a
//     `position: fixed; top: 100px` element's rect.top reports 125 at zoom
//     1.25, the same "real px from the viewport's top-left" unit
//     window.innerHeight is measured in.
//   - LAYOUT space: the pre-zoom-multiplication CSS length a descendant
//     element resolves against before the browser scales its rendering by
//     the effective zoom. clientWidth/offsetWidth/offsetHeight and
//     ResizeObserver's contentRect/borderBoxSize of any element OTHER than
//     documentElement report this smaller space (verified: a percentage-
//     sized `inset-0` box paints at the true/real viewport size but reports
//     clientWidth = realViewport / zoom, because its own rendering is
//     magnified by zoom like everything else in the zoomed subtree).
//
// A REAL-space value written straight into a CSS length property (an inline
// `style.top`, a React style prop, an SVG coordinate whose viewBox is sized
// in LAYOUT-space units, a value added to a LAYOUT-space measurement) gets
// multiplied by zoom AGAIN on paint — that double multiplication is the bug
// T3 missed. Convert with `visualToLayoutPx` before writing such a value
// back. Arithmetic entirely within one space (a real/real ratio, a physical
// pointer-movement distance compared against a px threshold) needs no
// conversion: the zoom factor cancels or was never meant to scale.
// =============================================================================

/**
 * Reads the effective (accumulated) CSS zoom for `element` — its own zoom
 * combined with every ancestor's, per the CSS Viewport Module Level 1
 * `currentCSSZoom` definition. Falls back to the value the app's automatic
 * zoom hook mirrors on `document.documentElement` via the `--viewport-zoom`
 * custom property (see ../hooks/useAutomaticViewportZoom.ts) when
 * `currentCSSZoom` is unavailable (jsdom, older browsers) or not yet a sane
 * positive number, and finally to 1 (no-op) when neither source is usable.
 */
export function getEffectiveZoom(element: Element = document.documentElement): number {
    const zoomAware = element as Element & { currentCSSZoom?: number };

    if (
        typeof zoomAware.currentCSSZoom === 'number'
        && Number.isFinite(zoomAware.currentCSSZoom)
        && zoomAware.currentCSSZoom > 0
    ) {
        return zoomAware.currentCSSZoom;
    }

    const rootZoom = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--viewport-zoom'),
    );

    return Number.isFinite(rootZoom) && rootZoom > 0 ? rootZoom : 1;
}

/**
 * Converts a REAL/visual px value (getBoundingClientRect(), pointer
 * coordinates, window.innerWidth/innerHeight) into LAYOUT px, so writing the
 * result into a CSS length property (or combining it with a
 * clientWidth/offsetHeight/ResizeObserver-measured value) reproduces the
 * original real px value once the browser's own zoom pre-multiplication is
 * applied at paint time.
 */
export function visualToLayoutPx(visualPx: number, zoom: number = getEffectiveZoom()): number {
    return Number.isFinite(zoom) && zoom > 0 ? visualPx / zoom : visualPx;
}
