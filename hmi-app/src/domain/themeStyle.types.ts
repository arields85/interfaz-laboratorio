/**
 * Visual style tokens for the HMI's theme engine: widget frame and button
 * appearance, expressed as rest/hover pairs so the CSS engine (see
 * `index.css`) can drive `@property`-based hover transitions.
 *
 * Buttons are modeled here so a full theme (including "Contorno") can be
 * represented end to end, but the CSS that consumes `ThemeButtonStyle` is
 * wired in a later task; until then the values are only mapped to unused
 * CSS custom properties.
 */

/** Corner-accent geometry and color for one interaction state (rest or hover). */
export interface ThemeAccentStyle {
    /** Corner accent segment length, in pixels. */
    readonly lengthPx: number;
    /** Corner accent segment thickness, in pixels. */
    readonly thicknessPx: number;
    /** Corner accent color (any valid CSS color value). */
    readonly color: string;
    /**
     * Corner accent opacity, 0-100. An accent is considered hidden when this
     * is 0 -- there is no separate "visible" flag, so a hidden accent still
     * carries its own length/thickness/color as the start of the rest ->
     * hover transition.
     */
    readonly opacityPercent: number;
}

/** Shared surface visuals for one interaction state (rest or hover). */
export interface ThemeSurfaceStateStyle {
    /** Corner radius, in pixels. */
    readonly radiusPx: number;
    /** White overlay mixed into the surface base, 0-100. */
    readonly fillPercent: number;
    /** White overlay mixed into the border color, 0-100. */
    readonly borderPercent: number;
    readonly accent: ThemeAccentStyle;
}

/** Widget frame surface visuals for one interaction state, with backdrop blur. */
export interface ThemeFrameStateStyle extends ThemeSurfaceStateStyle {
    /** Backdrop blur, in pixels. */
    readonly blurPx: number;
}

export interface ThemeFrameStyle {
    /**
     * Frame background shown under the fill overlay (e.g. today's 135deg
     * gradient for "Clasico", transparent for "Contorno"). Any valid CSS
     * `background-image`/`background` value.
     */
    readonly baseBackground: string;
    readonly rest: ThemeFrameStateStyle;
    readonly hover: ThemeFrameStateStyle;
}

export interface ThemeButtonStyle {
    readonly rest: ThemeSurfaceStateStyle;
    readonly hover: ThemeSurfaceStateStyle;
}

/** A complete theme: widget frame + button visual style. */
export interface ThemeStyle {
    readonly id: string;
    readonly frame: ThemeFrameStyle;
    readonly button: ThemeButtonStyle;
}
