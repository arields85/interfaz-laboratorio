/**
 * Visual style tokens for the HMI's theme engine: widget frame and button
 * appearance, expressed as rest/hover pairs so the CSS engine (see
 * `index.css`) can drive `@property`-based hover transitions.
 *
 * Buttons are modeled here so a full theme (including "Contorno") can be
 * represented end to end; the CSS that consumes `ThemeButtonStyle` lives in
 * `index.css`'s `.theme-button`/`.theme-button-*`/`.admin-accent-ghost`
 * rules, applied by AdminActionButton, AdminIconToolbarButton, HmiButton
 * and the WidgetHeaderTemporalControls pill segments.
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
    /**
     * 0-100. How much each button primitive's own pre-theme color (e.g.
     * today's admin-accent-ghost 20%/30% mix, or the neutral secondary's
     * white/5 background) still shows through under the shared `rest`/
     * `hover` fill/border overlay above -- the button equivalent of
     * `ThemeFrameStyle.baseBackground`, needed because unlike the frame
     * (one shared base for every widget), buttons keep several different
     * "own" bases (neutral, accent, critical) that a single shared overlay
     * percentage cannot reproduce on its own.
     *
     * 100 keeps every variant's own color exactly as it is today (Clasico:
     * combined with `fillPercent`/`borderPercent` at 0, the overlay
     * contributes nothing and the variant's own CSS recipe shows through
     * unchanged). 0 replaces the own color entirely with the shared
     * neutral/accent/critical mix at this theme's fill/border percentages
     * (Contorno's flat outline recipe, uniform across every button group).
     */
    readonly baseStrengthPercent: number;
    /**
     * Icon-only button recipe (AdminIconToolbarButton: catalog rail, builder
     * view toolbar, undo/redo -- every themed button with an icon and no
     * visible text), completely independent from `rest`/`hover`/
     * `baseStrengthPercent` above. User decision (2026-09-28): only
     * icon-only buttons go borderless like Clasico under a theme like
     * Contorno (own color at full strength, radius still follows the
     * theme); every button WITH visible text (AdminActionButton, HmiButton,
     * `.admin-accent-ghost`) and the segmented controls
     * (WidgetHeaderTemporalControls) keep their current bordered Contorno
     * look untouched, driven entirely by `rest`/`hover`/
     * `baseStrengthPercent` above.
     *
     * Optional: a theme without it renders icon-only buttons with the shared
     * `rest`/`hover`/`baseStrengthPercent` recipe above.
     */
    readonly icon?: ThemeButtonIconStyle;
}

/** Icon-only button visual recipe -- see `ThemeButtonStyle.icon`. */
export interface ThemeButtonIconStyle {
    readonly rest: ThemeSurfaceStateStyle;
    readonly hover: ThemeSurfaceStateStyle;
    readonly baseStrengthPercent: number;
}

/** A complete theme: widget frame + button visual style. */
export interface ThemeStyle {
    readonly id: string;
    readonly frame: ThemeFrameStyle;
    readonly button: ThemeButtonStyle;
}
