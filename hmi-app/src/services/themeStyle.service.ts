import type {
    ThemeButtonStyle,
    ThemeFrameStyle,
    ThemeGroupStateStyle,
    ThemeGroupStyle,
    ThemeStyle,
    ThemeSurfaceStateStyle,
    ThemeTagStyle,
} from '../domain/themeStyle.types';
import { useThemeStylePresetStore } from '../store/themeStylePreset.store';
import { normalizeStepValue } from '../utils/normalizeStepValue';

export const THEME_STYLE_STORAGE_KEY = 'hmi-theme-style';

/**
 * Per-preset override of the widget frame corner radius, edited from Configuracion general -> Tema.
 * Stored as `{ [presetId]: radiusPx }` holding only the radii that differ from their preset
 * (absent = the preset's own radius), like the rest of the visual configuration.
 */
export const FRAME_RADIUS_STORAGE_KEY = 'hmi-theme-frame-radius';

export const FRAME_RADIUS_LIMITS = { min: 0, max: 24, step: 1 } as const;

export const CLASSIC_THEME_STYLE_ID = 'classic';
export const OUTLINE_THEME_STYLE_ID = 'outline';
export const INSTRUMENT_THEME_STYLE_ID = 'instrument';

const WHITE = '#ffffff';

/**
 * "Clasico" reproduces today's `AdminTag` look exactly: 0.25rem (4px)
 * radius, `bg-white/5` (5% white fill, no tint from the tag's own color),
 * and each variant's own color mixed into the border at 40% -- see
 * `AdminTag.tsx`'s `BASE_CLS`/`VARIANT_CLS`. Exported so a theme without its
 * own `tag` block can fall back to it explicitly (mirrors
 * `ThemeButtonStyle.icon`'s fallback pattern).
 */
export const CLASSIC_TAG_STYLE: ThemeTagStyle = {
    // "outline", not "glass": AdminTag never had a backdrop blur, and
    // "glass" maps to a 6px blur (see `TAG_STYLE_BLUR_PX` below). Bug fix,
    // 2026-09-28: Contorno reuses this same object and writes its properties
    // explicitly (it doesn't reset to the :root default like Clasico does),
    // so it had picked up a blur Clasico's tags never had.
    style: 'outline',
    radiusPx: 4,
    fillPercent: 5,
    borderPercent: 40,
    tintPercent: 0,
};

/**
 * Group container (`GroupWidget`) background recipe (P7, 2026-09-28): the
 * user's tuned values from the style lab, applied identically to all three
 * built-in presets (the group widget has no legacy look to preserve in
 * Clasico/Contorno). Exported as the fallback for a theme without its own
 * `group` block (mirrors `CLASSIC_TAG_STYLE`).
 */
export const DEFAULT_GROUP_STYLE: ThemeGroupStyle = {
    rest: { baseOpacityPercent: 20, fillPercent: 0 },
    hover: { baseOpacityPercent: 40, fillPercent: 0 },
};

/**
 * "Clasico" reproduces today's `.glass-panel` look exactly: 1.5rem (24px)
 * radius, 12px blur, the existing 135deg gradient base with a +4% white
 * overlay on hover, and no visible corner accent.
 */
export const CLASSIC_THEME_STYLE: ThemeStyle = {
    id: CLASSIC_THEME_STYLE_ID,
    frame: {
        baseBackground: 'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%)',
        rest: {
            radiusPx: 24,
            fillPercent: 0,
            borderPercent: 8,
            blurPx: 12,
            accent: { lengthPx: 18, thicknessPx: 1, color: WHITE, opacityPercent: 0 },
        },
        hover: {
            radiusPx: 24,
            fillPercent: 4,
            borderPercent: 20,
            blurPx: 12,
            accent: { lengthPx: 18, thicknessPx: 1, color: WHITE, opacityPercent: 0 },
        },
    },
    button: {
        rest: {
            radiusPx: 6,
            fillPercent: 0,
            borderPercent: 0,
            accent: { lengthPx: 8, thicknessPx: 1, color: WHITE, opacityPercent: 0 },
        },
        hover: {
            radiusPx: 6,
            fillPercent: 0,
            borderPercent: 0,
            accent: { lengthPx: 8, thicknessPx: 1, color: WHITE, opacityPercent: 0 },
        },
        // 0% fill/border overlay + full (100%) own-color strength: every
        // button primitive's own CSS recipe (see index.css `.theme-button-*`)
        // shows through completely unchanged.
        baseStrengthPercent: 100,
        // Icon-only buttons (AdminIconToolbarButton) already have no border
        // and a 0.375rem radius at 0%/0% overlay + 100% strength -- same
        // numbers as `rest`/`hover` above, kept as its own explicit block
        // (P1, 2026-09-28) so Contorno can diverge here without touching
        // text buttons or the segmented controls.
        icon: {
            rest: { radiusPx: 6, fillPercent: 0, borderPercent: 0, accent: { lengthPx: 8, thicknessPx: 1, color: WHITE, opacityPercent: 0 } },
            hover: { radiusPx: 6, fillPercent: 0, borderPercent: 0, accent: { lengthPx: 8, thicknessPx: 1, color: WHITE, opacityPercent: 0 } },
            baseStrengthPercent: 100,
        },
    },
    tag: CLASSIC_TAG_STYLE,
    group: DEFAULT_GROUP_STYLE,
};

/**
 * "Contorno": the user's theme from the style lab (2026-09-27, Engram
 * `backlog/hmi-theme-styles`). Outline base with a transparent frame fill.
 */
export const OUTLINE_THEME_STYLE: ThemeStyle = {
    id: OUTLINE_THEME_STYLE_ID,
    frame: {
        baseBackground: 'transparent',
        rest: {
            radiusPx: 0,
            fillPercent: 0,
            borderPercent: 15,
            blurPx: 2,
            accent: { lengthPx: 18, thicknessPx: 1, color: WHITE, opacityPercent: 0 },
        },
        hover: {
            radiusPx: 0,
            fillPercent: 4,
            borderPercent: 25,
            blurPx: 2,
            accent: { lengthPx: 8, thicknessPx: 1, color: WHITE, opacityPercent: 40 },
        },
    },
    button: {
        rest: {
            radiusPx: 0,
            fillPercent: 0,
            borderPercent: 22,
            accent: { lengthPx: 8, thicknessPx: 1, color: WHITE, opacityPercent: 0 },
        },
        hover: {
            radiusPx: 0,
            fillPercent: 3,
            borderPercent: 50,
            accent: { lengthPx: 8, thicknessPx: 1, color: WHITE, opacityPercent: 0 },
        },
        // 0% own-color strength: every button primitive's own base color
        // fades out entirely, leaving the flat rest/hover outline recipe
        // above (mixed against each variant's own hue) as the only visual.
        baseStrengthPercent: 0,
        // P1 (2026-09-28, user decision): icon-only buttons go borderless
        // like Clasico under Contorno (100% own strength, 0% overlay) but
        // keep the theme's radius (0) -- independent from `rest`/`hover`
        // above, which stay bordered for text buttons and segmented
        // controls.
        icon: {
            rest: { radiusPx: 0, fillPercent: 0, borderPercent: 0, accent: { lengthPx: 8, thicknessPx: 1, color: WHITE, opacityPercent: 0 } },
            hover: { radiusPx: 0, fillPercent: 0, borderPercent: 0, accent: { lengthPx: 8, thicknessPx: 1, color: WHITE, opacityPercent: 0 } },
            baseStrengthPercent: 100,
        },
    },
    // Tags are untouched by P1-P3's Contorno corrections (user decision,
    // 2026-09-28): same recipe as Clasico until the user asks for a themed
    // look (see P5/P6 in odd/tasks/theme-polish.md).
    tag: CLASSIC_TAG_STYLE,
    // Group container background (P7, 2026-09-28): same tuned recipe as the
    // other two presets -- the group widget has no legacy look to preserve.
    group: DEFAULT_GROUP_STYLE,
};

/**
 * "Instrumento": the user's third style from the lab (2026-09-28, P6 in
 * odd/tasks/theme-polish.md). Sober glass widgets with barely-rounded
 * corners and fine detail, an outline recipe for text buttons (like
 * Contorno) and Clasico-strength icon-only buttons, plus a flat tag look.
 */
export const INSTRUMENT_THEME_STYLE: ThemeStyle = {
    id: INSTRUMENT_THEME_STYLE_ID,
    frame: {
        baseBackground: 'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%)',
        rest: {
            radiusPx: 5,
            fillPercent: 0,
            borderPercent: 12,
            blurPx: 3,
            accent: { lengthPx: 25, thicknessPx: 1.5, color: WHITE, opacityPercent: 0 },
        },
        hover: {
            radiusPx: 5,
            fillPercent: 4,
            borderPercent: 20,
            blurPx: 12,
            accent: { lengthPx: 8, thicknessPx: 1, color: WHITE, opacityPercent: 60 },
        },
    },
    button: {
        rest: {
            radiusPx: 3,
            fillPercent: 0,
            borderPercent: 22,
            accent: { lengthPx: 8, thicknessPx: 1, color: WHITE, opacityPercent: 0 },
        },
        hover: {
            radiusPx: 3,
            fillPercent: 3,
            borderPercent: 50,
            accent: { lengthPx: 8, thicknessPx: 1, color: WHITE, opacityPercent: 0 },
        },
        // Outline recipe for text buttons, same base-strength handling as
        // Contorno's text buttons: the shared fill/border overlay above
        // replaces each variant's own color entirely.
        baseStrengthPercent: 0,
        // Icon-only buttons keep their own color at full strength (like
        // Contorno's icon block), only the shape (radius/fill/border/accent)
        // is themed.
        icon: {
            rest: { radiusPx: 6, fillPercent: 0, borderPercent: 0, accent: { lengthPx: 16, thicknessPx: 1, color: WHITE, opacityPercent: 0 } },
            hover: { radiusPx: 3, fillPercent: 5, borderPercent: 0, accent: { lengthPx: 5, thicknessPx: 1, color: WHITE, opacityPercent: 60 } },
            baseStrengthPercent: 100,
        },
    },
    tag: {
        style: 'flat',
        radiusPx: 3,
        fillPercent: 0,
        borderPercent: 0,
        tintPercent: 14,
    },
    group: DEFAULT_GROUP_STYLE,
};

export const THEME_STYLE_PRESETS: readonly ThemeStyle[] = [CLASSIC_THEME_STYLE, OUTLINE_THEME_STYLE, INSTRUMENT_THEME_STYLE];

export function getThemeStylePreset(id: string): ThemeStyle {
    return THEME_STYLE_PRESETS.find((preset) => preset.id === id) ?? CLASSIC_THEME_STYLE;
}

function pxToken(valuePx: number): string {
    return `${valuePx}px`;
}

function percentToken(valuePercent: number): string {
    return `${valuePercent}%`;
}

function surfaceStateToCssProperties(
    prefix: string,
    suffix: 'rest' | 'hover',
    state: ThemeSurfaceStateStyle,
): Record<string, string> {
    return {
        [`--${prefix}-radius-${suffix}`]: pxToken(state.radiusPx),
        [`--${prefix}-fill-${suffix}`]: percentToken(state.fillPercent),
        [`--${prefix}-border-${suffix}`]: percentToken(state.borderPercent),
        [`--${prefix}-accent-length-${suffix}`]: pxToken(state.accent.lengthPx),
        [`--${prefix}-accent-thickness-${suffix}`]: pxToken(state.accent.thicknessPx),
        [`--${prefix}-accent-color-${suffix}`]: state.accent.color,
        [`--${prefix}-accent-opacity-${suffix}`]: percentToken(state.accent.opacityPercent),
    };
}

function frameStyleToCssProperties(frame: ThemeFrameStyle): Record<string, string> {
    return {
        '--frame-base-background': frame.baseBackground,
        ...surfaceStateToCssProperties('frame', 'rest', frame.rest),
        [`--frame-blur-rest`]: pxToken(frame.rest.blurPx),
        ...surfaceStateToCssProperties('frame', 'hover', frame.hover),
        [`--frame-blur-hover`]: pxToken(frame.hover.blurPx),
    };
}

function buttonStyleToCssProperties(button: ThemeButtonStyle): Record<string, string> {
    // A theme without its own icon-only block reuses the shared button recipe,
    // so every theme always emits the full --button-icon-* token set.
    const icon = button.icon ?? {
        rest: button.rest,
        hover: button.hover,
        baseStrengthPercent: button.baseStrengthPercent,
    };

    return {
        ...surfaceStateToCssProperties('button', 'rest', button.rest),
        ...surfaceStateToCssProperties('button', 'hover', button.hover),
        '--button-base-strength': percentToken(button.baseStrengthPercent),
        // Icon-only buttons read their own token set (see `.theme-button-
        // icon-neutral` in index.css) so they can go borderless under
        // Contorno without touching the shared --button-* tokens above.
        ...surfaceStateToCssProperties('button-icon', 'rest', icon.rest),
        ...surfaceStateToCssProperties('button-icon', 'hover', icon.hover),
        '--button-icon-base-strength': percentToken(icon.baseStrengthPercent),
    };
}

// Base surface behind the tag fill/tint overlays, per `ThemeTagStyle.style`
// (see `.theme-tag` in index.css): "glass" and "outline" are transparent
// (only the fill/tint mix shows), "flat" is an opaque dark surface -- the
// closest existing design token to the style lab's raw `#1a2029` (AGENTS.md:
// no hardcoded colors when a token exists).
const TAG_STYLE_BASE_BACKGROUND: Record<ThemeTagStyle['style'], string> = {
    glass: 'transparent',
    flat: 'var(--color-industrial-hover)',
    outline: 'transparent',
};

// Only "glass" gets the small backdrop blur described in P5.
const TAG_STYLE_BLUR_PX: Record<ThemeTagStyle['style'], number> = {
    glass: 6,
    flat: 0,
    outline: 0,
};

function tagStyleToCssProperties(tag: ThemeTagStyle): Record<string, string> {
    return {
        '--tag-radius': pxToken(tag.radiusPx),
        '--tag-fill': percentToken(tag.fillPercent),
        '--tag-border': percentToken(tag.borderPercent),
        '--tag-tint': percentToken(tag.tintPercent),
        '--tag-base-background': TAG_STYLE_BASE_BACKGROUND[tag.style],
        '--tag-blur': pxToken(TAG_STYLE_BLUR_PX[tag.style]),
    };
}

// Group container background (P7, 2026-09-28): its own rest/hover pair of
// "base opacity" (of the frame's own base background) and "fill" (white
// overlay), independent from the frame's own fill/border/blur/accent, which
// the group container keeps unchanged from `--frame-*` like every widget.
function groupStateToCssProperties(suffix: 'rest' | 'hover', state: ThemeGroupStateStyle): Record<string, string> {
    return {
        [`--group-base-${suffix}`]: percentToken(state.baseOpacityPercent),
        [`--group-fill-${suffix}`]: percentToken(state.fillPercent),
    };
}

function groupStyleToCssProperties(group: ThemeGroupStyle): Record<string, string> {
    return {
        ...groupStateToCssProperties('rest', group.rest),
        ...groupStateToCssProperties('hover', group.hover),
    };
}

/** Maps a full theme to the CSS custom properties the theme engine reads (see `index.css`). */
export function themeStyleToCssProperties(style: ThemeStyle): Record<string, string> {
    return {
        ...frameStyleToCssProperties(style.frame),
        ...buttonStyleToCssProperties(style.button),
        ...tagStyleToCssProperties(style.tag ?? CLASSIC_TAG_STYLE),
        ...groupStyleToCssProperties(style.group ?? DEFAULT_GROUP_STYLE),
    };
}

/**
 * Keeps the Clasico flag (`themeStylePreset.store`) in step with the preset on the document root. Every
 * path that changes the root tokens goes through `applyThemeStyleToDocument` / `resetThemeStyleOnDocument`,
 * so this is the one place that writes it (a preset card applies its tokens on its own element: no sync).
 */
function syncActivePreset(target: HTMLElement, classic: boolean): void {
    if (target === document.documentElement) {
        useThemeStylePresetStore.getState().setClassic(classic);
    }
}

/** Sets every custom property of `style` on `target` (defaults to the document root). */
export function applyThemeStyleToDocument(style: ThemeStyle, target: HTMLElement = document.documentElement): void {
    syncActivePreset(target, style.id === CLASSIC_THEME_STYLE_ID);
    const properties = themeStyleToCssProperties(style);
    for (const [name, value] of Object.entries(properties)) {
        target.style.setProperty(name, value);
    }
}

/** Removes every theme custom property from `target`, restoring the CSS `:root` defaults. */
export function resetThemeStyleOnDocument(target: HTMLElement = document.documentElement): void {
    syncActivePreset(target, true);
    const properties = themeStyleToCssProperties(CLASSIC_THEME_STYLE);
    for (const name of Object.keys(properties)) {
        target.style.removeProperty(name);
    }
}

export function readStoredThemeStylePresetId(): string | null {
    try {
        return localStorage.getItem(THEME_STYLE_STORAGE_KEY);
    } catch {
        return null;
    }
}

export function writeStoredThemeStylePresetId(id: string): void {
    try {
        localStorage.setItem(THEME_STYLE_STORAGE_KEY, id);
    } catch { /* ignore unavailable storage */ }
}

/** Frame radius tokens a radius override writes (rest and hover share the same value). */
const FRAME_RADIUS_TOKENS = ['--frame-radius-rest', '--frame-radius-hover'] as const;

/** Sets both frame radius tokens to `radiusPx` on `target`. */
function applyFrameRadiusToDocument(radiusPx: number, target: HTMLElement): void {
    for (const name of FRAME_RADIUS_TOKENS) {
        target.style.setProperty(name, pxToken(radiusPx));
    }
}

function snapRadiusToLimits(value: number): number {
    const { min, max, step } = FRAME_RADIUS_LIMITS;

    return normalizeStepValue(value, min, max, step);
}

/**
 * Valid stored radius overrides by preset id (out-of-range clamped, off-step snapped, unknown presets dropped, and a
 * value that lands on the preset's own radius dropped: that is no override).
 */
export function readStoredFrameRadiusOverrides(): Record<string, number> {
    try {
        const raw = localStorage.getItem(FRAME_RADIUS_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }

        const overrides: Record<string, number> = {};
        for (const preset of THEME_STYLE_PRESETS) {
            const value = (parsed as Record<string, unknown>)[preset.id];
            if (typeof value === 'number' && Number.isFinite(value)) {
                const radiusPx = snapRadiusToLimits(value);
                // A value equal to the preset's own radius is no override (same rule as the write path).
                if (radiusPx !== preset.frame.rest.radiusPx) {
                    overrides[preset.id] = radiusPx;
                }
            }
        }

        return overrides;
    } catch {
        return {};
    }
}

/** Persists only the radii that differ from their preset's own; nothing to store removes the key. */
export function writeStoredFrameRadiusOverrides(overrides: Readonly<Record<string, number>>): void {
    const stored: Record<string, number> = {};
    for (const preset of THEME_STYLE_PRESETS) {
        const value = overrides[preset.id];
        if (value !== undefined && value !== preset.frame.rest.radiusPx) {
            stored[preset.id] = value;
        }
    }

    try {
        if (Object.keys(stored).length === 0) {
            localStorage.removeItem(FRAME_RADIUS_STORAGE_KEY);
        } else {
            localStorage.setItem(FRAME_RADIUS_STORAGE_KEY, JSON.stringify(stored));
        }
    } catch { /* ignore unavailable storage */ }
}

/**
 * Applies the given preset on `target` without persisting it -- Clasico
 * resets to the CSS `:root` defaults instead of writing its (identical)
 * values explicitly, matching `setActiveThemeStyle`'s own rule. Route this
 * from the Tema tab's live preview and its revert. `frameRadiusPx` (the
 * preset's radius override, when it has one) replaces the rest AND hover frame
 * radius tokens; every element that derives from the frame radius reads them.
 */
export function previewThemeStyleOnDocument(
    id: string,
    target: HTMLElement = document.documentElement,
    frameRadiusPx?: number,
): void {
    const preset = getThemeStylePreset(id);
    if (preset.id === CLASSIC_THEME_STYLE_ID) {
        resetThemeStyleOnDocument(target);
    } else {
        applyThemeStyleToDocument(preset, target);
    }

    if (frameRadiusPx !== undefined) {
        applyFrameRadiusToDocument(frameRadiusPx, target);
    }
}

/**
 * Applies and persists the given preset (its radius override, if any, is only applied here; the
 * overrides are persisted with `writeStoredFrameRadiusOverrides`). Routed from the Tema tab (TH4).
 */
export function setActiveThemeStyle(
    id: string,
    target: HTMLElement = document.documentElement,
    frameRadiusPx?: number,
): void {
    previewThemeStyleOnDocument(id, target, frameRadiusPx);
    writeStoredThemeStylePresetId(getThemeStylePreset(id).id);
}

/**
 * Boot re-apply, mirrors `applyThemeOverrides` from `DesignSettingsTab.tsx`.
 * Call once from `main.tsx` before the app renders.
 */
export function applyThemeStyleOverrides(): void {
    const storedId = readStoredThemeStylePresetId();
    // Nothing applied below leaves the root on the Clasico defaults.
    syncActivePreset(document.documentElement, true);
    const preset = storedId ? THEME_STYLE_PRESETS.find((candidate) => candidate.id === storedId) : undefined;
    if (storedId && !preset) {
        return;
    }

    const presetId = preset?.id ?? CLASSIC_THEME_STYLE_ID;
    const frameRadiusPx = readStoredFrameRadiusOverrides()[presetId];
    if (presetId === CLASSIC_THEME_STYLE_ID && frameRadiusPx === undefined) {
        return;
    }

    previewThemeStyleOnDocument(presetId, document.documentElement, frameRadiusPx);
}
