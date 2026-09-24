import { useEffect } from 'react';
import { computeDampedViewportZoom } from '../utils/viewportScale';

// =============================================================================
// useAutomaticViewportZoom — PW-007 T3
//
// Applies the damped automatic zoom curve (see ../utils/viewportScale.ts) to
// the document root element (`<html>`), recomputed on every viewport resize.
//
// Application point — resolved named uncertainty (T3):
// Zoom is applied on `document.documentElement`, NOT on an inner app-root
// container, because:
//   - Standardized CSS `zoom` (Chromium 128+, Firefox 126+) pre-multiplies
//     the used value of length properties (including viewport units) by the
//     element's effective (accumulated) zoom, and does not create a new
//     containing block the way `transform` does — so `position: fixed`
//     descendants stay anchored to the true viewport (CSS Viewport Module
//     Level 1, https://drafts.csswg.org/css-viewport/#zoom-property;
//     corroborated by
//     https://developer.mozilla.org/en-US/docs/Web/API/Element/currentCSSZoom,
//     which defines the "effective" zoom as the element's own zoom combined
//     with every ancestor's zoom).
//   - This app renders several overlays via `createPortal(..., document.body)`
//     (AnchoredOverlay, HoverTooltip) and a `position: fixed` WebGL background
//     canvas (EventHorizonBackground). `document.body` is only guaranteed to
//     inherit the zoom scaling when the zoomed element is an ANCESTOR of body
//     — i.e. `<html>`. Zooming an inner div (e.g. an app-root wrapper) would
//     leave portaled content outside the zoomed subtree, rendering it at 1x
//     while the rest of the app is scaled, breaking visual consistency.
//
// PW-007 T3b correction (measured in headless Chrome, zoom 1.25 on <html>,
// window 1600x900, 2026-09-23) — the paragraph this replaced claimed "100vh
// is divided back out" and that getBoundingClientRect()-based code needs no
// correction. Both claims were WRONG; the measured facts:
//   - `height: 100vh` renders at 1001px in an 801px real viewport (overflow):
//     `vh`/`vw` are plain lengths, so they DO get pre-multiplied by the
//     effective zoom, and NOTHING divides that back out. Every `h-screen`/
//     `100vh`/`100vw` length must instead be built from the app's
//     `--viewport-height`/`--viewport-width` tokens (`calc(100vh /
//     var(--viewport-zoom))`, see ../index.css), which this hook maintains by
//     mirroring the applied zoom onto `--viewport-zoom` alongside the `zoom`
//     style below.
//   - `height:/width: 100%`, `inset-0`, and percentage-based layout (the
//     fluid widget grid, `h-full`/`w-full` canvases) are correctly NOT
//     affected the same way (percentages and `auto` are excluded from the
//     pre-multiplication) — verified: `position: fixed; inset: 0` still
//     paints at the exact real viewport size at any zoom. No changes needed
//     there.
//   - `getBoundingClientRect()`, PointerEvent.clientX/clientY/pageX/pageY and
//     window.innerWidth/innerHeight all report the same REAL/visual
//     viewport-relative px space and can be freely compared with each other.
//     But writing one of those REAL-space values straight into a CSS length
//     (an inline style, a React style prop, an SVG coordinate whose viewBox
//     is sized in layout-space units, or combining it with a
//     clientWidth/offsetHeight/ResizeObserver-measured LAYOUT-space value)
//     gets it multiplied by zoom AGAIN on paint (`position: fixed; top:
//     100px` measured at 125px). Code doing this (AnchoredOverlay's
//     anchoredOverlayStyle.ts, HoverTooltip, the trend chart interaction
//     layers, BuilderCanvas drag/resize) must convert with
//     ../utils/zoomCoordinates.ts's `visualToLayoutPx` first.
//
// Recompute trigger: a single `resize` listener covers both real viewport
// resizes and devicePixelRatio/browser-zoom changes, since both change
// `window.innerWidth` and both fire a `resize` event.
// =============================================================================

/**
 * Applies the automatic damped viewport zoom to the document root and keeps
 * it in sync with viewport width changes for the lifetime of the mounted
 * component that calls this hook.
 *
 * `factor` is reserved for the PW-007 T4 per-device fine-tune (default 1,
 * meaning "no fine-tune applied").
 */
export function useAutomaticViewportZoom(factor: number = 1): void {
    useEffect(() => {
        const root = document.documentElement;

        const applyZoom = () => {
            const zoom = computeDampedViewportZoom(window.innerWidth, factor);
            root.style.setProperty('zoom', String(zoom));
            // Mirrored so CSS can derive corrected viewport lengths (see
            // --viewport-height/--viewport-width in ../index.css) and so
            // ../utils/zoomCoordinates.ts can read the applied zoom without a
            // DOM reference of its own.
            root.style.setProperty('--viewport-zoom', String(zoom));
        };

        applyZoom();
        window.addEventListener('resize', applyZoom);

        return () => {
            window.removeEventListener('resize', applyZoom);
            root.style.removeProperty('zoom');
            root.style.removeProperty('--viewport-zoom');
        };
    }, [factor]);
}
