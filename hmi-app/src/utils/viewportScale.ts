// =============================================================================
// Viewport Scale — automatic damped zoom curve
//
// PW-007 T3: the HMI was designed for a 1920px-wide CSS viewport. Below or
// above that reference width, the whole app is scaled with the standardized
// CSS `zoom` property (Chromium 128+, Firefox 126+) using a damped power
// curve, not pure proportional scaling.
//
// Rationale (PW-007 T2, decided by the user): the OS display scale already
// compensates for physical pixel density and viewing distance, so CSS px
// arrive pre-corrected. Pure proportional scaling (zoom = width / 1920)
// over-corrects; a damped exponent < 1 matches what users picked manually
// via browser zoom on a 14" 1440x900 laptop and a 32" 2560x1440 monitor.
//
// PW-007 T5b: below the reference width, the damped curve alone can shrink
// the LAYOUT-space viewport (viewportWidth / zoom — see ../utils/zoomCoordinates.ts
// for the same real/layout distinction) below what fixed-width text (widget
// titles, group headings) needs to avoid truncating or wrapping mid-word.
// Measured at a real 1280x720 CSS viewport (Windows 150% scale TV): the
// damped-only curve produced a ~1633px layout width and truncated widget
// titles; a 1714px layout width (measured on a 1440x900 laptop) rendered
// clean apart from the unrelated T5c overlap defect. `MIN_LAYOUT_WIDTH_PX` is
// a hard floor on the layout width the curve is allowed to produce, applied
// as a zoom cap: `zoom <= viewportWidth / MIN_LAYOUT_WIDTH_PX`, so
// `layoutWidth = viewportWidth / zoom >= MIN_LAYOUT_WIDTH_PX` always holds
// once the floor is active. Calibrated empirically with headless-Chrome
// screenshots at 1280/1440/1920/2560 CSS px (see PW-007 T5b tracker entry).
//
// Pure utility: no side effects, no DOM access. See ../hooks/useAutomaticViewportZoom.ts
// for the application point (root `<html>` element, recomputed on resize).
// =============================================================================

/** Design reference CSS viewport width, in px, where zoom is exactly 1 (structural no-op). */
export const VIEWPORT_SCALE_REFERENCE_WIDTH_PX = 1920;

/**
 * Damping exponent for the zoom curve: `zoom = (width / reference) ^ k`.
 * Calibrated during PW-007 T5 manual acceptance; kept as a single named
 * constant so recalibration never requires touching call sites.
 */
export const VIEWPORT_SCALE_DAMPING_EXPONENT = 0.6;

/**
 * Minimum LAYOUT-space viewport width (`viewportWidth / zoom`) the automatic
 * zoom curve is allowed to produce, in px. Below the reference width the
 * damped curve alone can shrink the layout width enough to truncate or wrap
 * fixed-width widget text; below this floor, zoom is capped instead of
 * following the pure damped curve. Never applies at or above
 * `VIEWPORT_SCALE_REFERENCE_WIDTH_PX` (zoom stays exactly 1 at 1920px).
 * See the module header for the calibration evidence.
 */
export const MIN_LAYOUT_WIDTH_PX = 1760;

/** Fallback zoom used whenever the input width cannot produce a sane curve value. */
const FALLBACK_ZOOM = 1;

/**
 * Computes the automatic damped zoom multiplier for a given CSS viewport width.
 *
 * `factor` is an optional multiplier (default 1) reserved for the PW-007 T4
 * per-device fine-tune: `finalZoom = computeDampedViewportZoom(width) * factor`
 * can be composed later without reworking this function's contract. It is
 * applied to the damped curve BEFORE the `MIN_LAYOUT_WIDTH_PX` floor caps the
 * result, so the floor stays a hard guarantee on the resulting layout width
 * (`viewportWidth / zoom`) regardless of what fine-tune factor is dialed in —
 * a factor that would otherwise shrink the layout width below the floor gets
 * clamped by it, the same as the undamped curve is.
 *
 * Returns 1 (no-op) when `viewportWidth` is not a finite positive number, or
 * when `factor` is not a finite positive number (factor then falls back to 1
 * rather than invalidating the whole computation).
 */
export function computeDampedViewportZoom(viewportWidth: number, factor: number = 1): number {
    if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
        return FALLBACK_ZOOM;
    }

    const normalizedFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
    const widthRatio = viewportWidth / VIEWPORT_SCALE_REFERENCE_WIDTH_PX;
    const dampedZoom = (widthRatio ** VIEWPORT_SCALE_DAMPING_EXPONENT) * normalizedFactor;
    const minLayoutWidthZoomCap = viewportWidth / MIN_LAYOUT_WIDTH_PX;

    return Math.min(dampedZoom, minLayoutWidthZoomCap);
}
