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
//     descendants stay anchored to the true viewport and
//     getBoundingClientRect()/getClientRects() report already-scaled,
//     viewport-relative coordinates (CSS Viewport Module Level 1,
//     https://drafts.csswg.org/css-viewport/#zoom-property; corroborated by
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
//   - `height:/width: 100%`, `inset-0`, and percentage-based layout (the
//     fluid widget grid, `h-full`/`w-full` canvases) are NOT affected by the
//     zoom pre-multiplication (percentages and `auto` are excluded per spec),
//     so they keep resolving proportionally against their already-correct
//     zoomed ancestor box — no changes needed there.
//   - `vh`/`vw`/`h-screen`/`w-screen`/`min-h-screen` ARE plain lengths, so
//     they DO get pre-multiplied by the effective zoom; because they resolve
//     against the true (unzoomed) viewport first and are then divided back
//     out again when the zoomed subtree is painted, a `100vh` element still
//     visually fills exactly the real viewport height at any zoom level. This
//     is the documented purpose of the property (replacing `transform:scale()`
//     hacks that break `vh`/`vw` and fixed positioning) but is not spelled
//     out verbatim as a worked example in the spec text itself — verify
//     visually at all three PW-007 T5 viewports.
//   - `getBoundingClientRect()`-based pointer/positioning code (AnchoredOverlay,
//     HoverTooltip, BuilderCanvas drag/resize via widgetInteraction.ts) needs
//     no manual zoom-factor correction: PointerEvent.clientX/clientY and
//     getBoundingClientRect() both report the same already-scaled,
//     viewport-relative coordinate space under standardized zoom.
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
        };

        applyZoom();
        window.addEventListener('resize', applyZoom);

        return () => {
            window.removeEventListener('resize', applyZoom);
            root.style.removeProperty('zoom');
        };
    }, [factor]);
}
