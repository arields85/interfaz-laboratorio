import type {
    ThemeButtonStyle,
    ThemeFrameStyle,
    ThemeStyle,
    ThemeSurfaceStateStyle,
} from '../domain/themeStyle.types';

export const THEME_STYLE_STORAGE_KEY = 'hmi-theme-style';

export const CLASSIC_THEME_STYLE_ID = 'classic';
export const OUTLINE_THEME_STYLE_ID = 'outline';

const WHITE = '#ffffff';

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
};

export const THEME_STYLE_PRESETS: readonly ThemeStyle[] = [CLASSIC_THEME_STYLE, OUTLINE_THEME_STYLE];

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

/** Maps a full theme to the CSS custom properties the theme engine reads (see `index.css`). */
export function themeStyleToCssProperties(style: ThemeStyle): Record<string, string> {
    return {
        ...frameStyleToCssProperties(style.frame),
        ...buttonStyleToCssProperties(style.button),
    };
}

/** Sets every custom property of `style` on `target` (defaults to the document root). */
export function applyThemeStyleToDocument(style: ThemeStyle, target: HTMLElement = document.documentElement): void {
    const properties = themeStyleToCssProperties(style);
    for (const [name, value] of Object.entries(properties)) {
        target.style.setProperty(name, value);
    }
}

/** Removes every theme custom property from `target`, restoring the CSS `:root` defaults. */
export function resetThemeStyleOnDocument(target: HTMLElement = document.documentElement): void {
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

/**
 * Applies the given preset on `target` without persisting it -- Clasico
 * resets to the CSS `:root` defaults instead of writing its (identical)
 * values explicitly, matching `setActiveThemeStyle`'s own rule. Route this
 * from the Tema tab's live preview and its revert.
 */
export function previewThemeStyleOnDocument(id: string, target: HTMLElement = document.documentElement): void {
    const preset = getThemeStylePreset(id);
    if (preset.id === CLASSIC_THEME_STYLE_ID) {
        resetThemeStyleOnDocument(target);
    } else {
        applyThemeStyleToDocument(preset, target);
    }
}

/** Applies and persists the given preset. Routed from the Tema tab (TH4). */
export function setActiveThemeStyle(id: string, target: HTMLElement = document.documentElement): void {
    previewThemeStyleOnDocument(id, target);
    writeStoredThemeStylePresetId(getThemeStylePreset(id).id);
}

/**
 * Boot re-apply, mirrors `applyThemeOverrides` from `DesignSettingsTab.tsx`.
 * Call once from `main.tsx` before the app renders.
 */
export function applyThemeStyleOverrides(): void {
    const storedId = readStoredThemeStylePresetId();
    if (!storedId || storedId === CLASSIC_THEME_STYLE_ID) {
        return;
    }
    const preset = THEME_STYLE_PRESETS.find((candidate) => candidate.id === storedId);
    if (!preset) {
        return;
    }
    applyThemeStyleToDocument(preset);
}
