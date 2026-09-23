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

/** Fallback zoom used whenever the input width cannot produce a sane curve value. */
const FALLBACK_ZOOM = 1;

/**
 * Computes the automatic damped zoom multiplier for a given CSS viewport width.
 *
 * `factor` is an optional multiplier (default 1) reserved for the PW-007 T4
 * per-device fine-tune: `finalZoom = computeDampedViewportZoom(width) * factor`
 * can be composed later without reworking this function's contract.
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

    return (widthRatio ** VIEWPORT_SCALE_DAMPING_EXPONENT) * normalizedFactor;
}
