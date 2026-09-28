import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    applyThemeStyleOverrides,
    applyThemeStyleToDocument,
    CLASSIC_TAG_STYLE,
    CLASSIC_THEME_STYLE,
    CLASSIC_THEME_STYLE_ID,
    getThemeStylePreset,
    INSTRUMENT_THEME_STYLE,
    INSTRUMENT_THEME_STYLE_ID,
    OUTLINE_THEME_STYLE,
    OUTLINE_THEME_STYLE_ID,
    readStoredThemeStylePresetId,
    resetThemeStyleOnDocument,
    setActiveThemeStyle,
    THEME_STYLE_PRESETS,
    THEME_STYLE_STORAGE_KEY,
    themeStyleToCssProperties,
    writeStoredThemeStylePresetId,
} from './themeStyle.service';

function makeTarget(): HTMLElement {
    return document.createElement('div');
}

describe('themeStyle.service presets', () => {
    it('reproduces today\'s "Clasico" glass-panel look exactly', () => {
        expect(CLASSIC_THEME_STYLE.id).toBe(CLASSIC_THEME_STYLE_ID);
        expect(CLASSIC_THEME_STYLE.frame.baseBackground).toBe(
            'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%)',
        );
        expect(CLASSIC_THEME_STYLE.frame.rest).toEqual({
            radiusPx: 24,
            fillPercent: 0,
            borderPercent: 8,
            blurPx: 12,
            accent: { lengthPx: 18, thicknessPx: 1, color: '#ffffff', opacityPercent: 0 },
        });
        expect(CLASSIC_THEME_STYLE.frame.hover).toEqual({
            radiusPx: 24,
            fillPercent: 4,
            borderPercent: 20,
            blurPx: 12,
            accent: { lengthPx: 18, thicknessPx: 1, color: '#ffffff', opacityPercent: 0 },
        });
    });

    it('matches the user\'s "Contorno" values from the style lab', () => {
        expect(OUTLINE_THEME_STYLE.id).toBe(OUTLINE_THEME_STYLE_ID);
        expect(OUTLINE_THEME_STYLE.frame.baseBackground).toBe('transparent');
        expect(OUTLINE_THEME_STYLE.frame.rest).toEqual({
            radiusPx: 0,
            fillPercent: 0,
            borderPercent: 15,
            blurPx: 2,
            accent: { lengthPx: 18, thicknessPx: 1, color: '#ffffff', opacityPercent: 0 },
        });
        expect(OUTLINE_THEME_STYLE.frame.hover).toEqual({
            radiusPx: 0,
            fillPercent: 4,
            borderPercent: 25,
            blurPx: 2,
            accent: { lengthPx: 8, thicknessPx: 1, color: '#ffffff', opacityPercent: 40 },
        });
        expect(OUTLINE_THEME_STYLE.button.rest).toEqual({
            radiusPx: 0,
            fillPercent: 0,
            borderPercent: 22,
            accent: { lengthPx: 8, thicknessPx: 1, color: '#ffffff', opacityPercent: 0 },
        });
        expect(OUTLINE_THEME_STYLE.button.hover).toEqual({
            radiusPx: 0,
            fillPercent: 3,
            borderPercent: 50,
            accent: { lengthPx: 8, thicknessPx: 1, color: '#ffffff', opacityPercent: 0 },
        });
    });

    it('locks text buttons and segmented controls to today\'s bordered Contorno look (P1, user decision 2026-09-28)', () => {
        // `rest`/`hover`/`baseStrengthPercent` drive AdminActionButton, HmiButton,
        // `.admin-accent-ghost` and the WidgetHeaderTemporalControls segmented
        // pill -- these must stay exactly as they were before P1.
        expect(OUTLINE_THEME_STYLE.button.rest).toEqual({
            radiusPx: 0,
            fillPercent: 0,
            borderPercent: 22,
            accent: { lengthPx: 8, thicknessPx: 1, color: '#ffffff', opacityPercent: 0 },
        });
        expect(OUTLINE_THEME_STYLE.button.hover).toEqual({
            radiusPx: 0,
            fillPercent: 3,
            borderPercent: 50,
            accent: { lengthPx: 8, thicknessPx: 1, color: '#ffffff', opacityPercent: 0 },
        });
        expect(OUTLINE_THEME_STYLE.button.baseStrengthPercent).toBe(0);
    });

    it('locks icon-only buttons (AdminIconToolbarButton) borderless like Clasico in Contorno, keeping the theme radius (P1)', () => {
        expect(OUTLINE_THEME_STYLE.button.icon.rest).toEqual({
            radiusPx: 0,
            fillPercent: 0,
            borderPercent: 0,
            accent: { lengthPx: 8, thicknessPx: 1, color: '#ffffff', opacityPercent: 0 },
        });
        expect(OUTLINE_THEME_STYLE.button.icon.hover).toEqual({
            radiusPx: 0,
            fillPercent: 0,
            borderPercent: 0,
            accent: { lengthPx: 8, thicknessPx: 1, color: '#ffffff', opacityPercent: 0 },
        });
        expect(OUTLINE_THEME_STYLE.button.icon.baseStrengthPercent).toBe(100);
    });

    it('keeps Clasico\'s icon-only recipe pixel-identical to its own text-button recipe', () => {
        expect(CLASSIC_THEME_STYLE.button.icon.rest).toEqual(CLASSIC_THEME_STYLE.button.rest);
        expect(CLASSIC_THEME_STYLE.button.icon.hover).toEqual(CLASSIC_THEME_STYLE.button.hover);
        expect(CLASSIC_THEME_STYLE.button.icon.baseStrengthPercent).toBe(CLASSIC_THEME_STYLE.button.baseStrengthPercent);
    });

    it('sets the button base strength so Clasico keeps every variant\'s own color and Contorno replaces it', () => {
        expect(CLASSIC_THEME_STYLE.button.baseStrengthPercent).toBe(100);
        expect(CLASSIC_THEME_STYLE.button.rest.fillPercent).toBe(0);
        expect(CLASSIC_THEME_STYLE.button.rest.borderPercent).toBe(0);
        expect(CLASSIC_THEME_STYLE.button.hover.fillPercent).toBe(0);
        expect(CLASSIC_THEME_STYLE.button.hover.borderPercent).toBe(0);
        expect(CLASSIC_THEME_STYLE.button.rest.radiusPx).toBe(6);
        expect(CLASSIC_THEME_STYLE.button.hover.radiusPx).toBe(6);

        expect(OUTLINE_THEME_STYLE.button.baseStrengthPercent).toBe(0);
    });

    it('falls back to Clasico for an unknown preset id', () => {
        expect(getThemeStylePreset('does-not-exist')).toBe(CLASSIC_THEME_STYLE);
        expect(getThemeStylePreset(OUTLINE_THEME_STYLE_ID)).toBe(OUTLINE_THEME_STYLE);
    });

    it('lists every built-in preset, including the third one (Instrumento, P6)', () => {
        expect(THEME_STYLE_PRESETS.map((preset) => preset.id)).toEqual([
            CLASSIC_THEME_STYLE_ID,
            OUTLINE_THEME_STYLE_ID,
            INSTRUMENT_THEME_STYLE_ID,
        ]);
        expect(getThemeStylePreset(INSTRUMENT_THEME_STYLE_ID)).toBe(INSTRUMENT_THEME_STYLE);
    });
});

describe('themeStyle.service tags (P5, 2026-09-28)', () => {
    it('reproduces today\'s AdminTag look exactly for Clasico (radius 4px, fill 5%, border 40%, no tint, no blur)', () => {
        // "outline", not "glass": AdminTag never had a backdrop blur, and
        // "glass" maps to a 6px blur (bug fix, 2026-09-28 -- Contorno writes
        // this value explicitly instead of resetting to the :root default,
        // so it would have picked up a blur Clasico never had).
        expect(CLASSIC_THEME_STYLE.tag).toEqual({
            style: 'outline',
            radiusPx: 4,
            fillPercent: 5,
            borderPercent: 40,
            tintPercent: 0,
        });
    });

    it('keeps Contorno\'s tags pixel-identical to Clasico\'s (user decision 2026-09-28: tags unchanged by P1-P3)', () => {
        expect(OUTLINE_THEME_STYLE.tag).toEqual(CLASSIC_THEME_STYLE.tag);
    });

    it('exposes the Clasico tag recipe as the documented fallback for a theme without its own tag block', () => {
        expect(CLASSIC_TAG_STYLE).toEqual(CLASSIC_THEME_STYLE.tag);
    });
});

describe('themeStyleToCssProperties', () => {
    it('maps a theme to frame and button custom properties', () => {
        const properties = themeStyleToCssProperties(OUTLINE_THEME_STYLE);

        expect(properties['--frame-base-background']).toBe('transparent');
        expect(properties['--frame-radius-rest']).toBe('0px');
        expect(properties['--frame-radius-hover']).toBe('0px');
        expect(properties['--frame-fill-hover']).toBe('4%');
        expect(properties['--frame-border-rest']).toBe('15%');
        expect(properties['--frame-blur-rest']).toBe('2px');
        expect(properties['--frame-accent-length-rest']).toBe('18px');
        expect(properties['--frame-accent-length-hover']).toBe('8px');
        expect(properties['--frame-accent-opacity-hover']).toBe('40%');
        expect(properties['--button-radius-rest']).toBe('0px');
        expect(properties['--button-border-hover']).toBe('50%');
        expect(properties['--button-base-strength']).toBe('0%');
        expect(properties['--button-icon-radius-rest']).toBe('0px');
        expect(properties['--button-icon-radius-hover']).toBe('0px');
        expect(properties['--button-icon-border-rest']).toBe('0%');
        expect(properties['--button-icon-border-hover']).toBe('0%');
        expect(properties['--button-icon-base-strength']).toBe('100%');
    });

    it('maps the Clasico button base strength to 100%', () => {
        expect(themeStyleToCssProperties(CLASSIC_THEME_STYLE)['--button-base-strength']).toBe('100%');
    });

    it('falls back to the shared button recipe when a theme has no icon-only block', () => {
        const themeWithoutIcon = {
            ...OUTLINE_THEME_STYLE,
            button: {
                rest: OUTLINE_THEME_STYLE.button.rest,
                hover: OUTLINE_THEME_STYLE.button.hover,
                baseStrengthPercent: OUTLINE_THEME_STYLE.button.baseStrengthPercent,
            },
        };

        const properties = themeStyleToCssProperties(themeWithoutIcon);

        expect(properties['--button-icon-radius-rest']).toBe(properties['--button-radius-rest']);
        expect(properties['--button-icon-border-hover']).toBe(properties['--button-border-hover']);
        expect(properties['--button-icon-fill-hover']).toBe(properties['--button-fill-hover']);
        expect(properties['--button-icon-base-strength']).toBe(properties['--button-base-strength']);
        expect(Object.keys(properties).sort()).toEqual(Object.keys(themeStyleToCssProperties(CLASSIC_THEME_STYLE)).sort());
    });

    it('maps the tag recipe to --tag-* custom properties, with no blur for the "outline" style (bug fix: Clasico never had one)', () => {
        const properties = themeStyleToCssProperties(CLASSIC_THEME_STYLE);

        expect(properties['--tag-radius']).toBe('4px');
        expect(properties['--tag-fill']).toBe('5%');
        expect(properties['--tag-border']).toBe('40%');
        expect(properties['--tag-tint']).toBe('0%');
        expect(properties['--tag-base-background']).toBe('transparent');
        expect(properties['--tag-blur']).toBe('0px');
    });

    it('maps a flat tag style to an opaque base background and no blur', () => {
        const flatTagTheme = {
            ...CLASSIC_THEME_STYLE,
            tag: { style: 'flat' as const, radiusPx: 3, fillPercent: 0, borderPercent: 0, tintPercent: 14 },
        };

        const properties = themeStyleToCssProperties(flatTagTheme);

        expect(properties['--tag-radius']).toBe('3px');
        expect(properties['--tag-fill']).toBe('0%');
        expect(properties['--tag-border']).toBe('0%');
        expect(properties['--tag-tint']).toBe('14%');
        expect(properties['--tag-base-background']).toBe('var(--color-industrial-hover)');
        expect(properties['--tag-blur']).toBe('0px');
    });

    it('falls back to the Clasico tag recipe when a theme has no tag block', () => {
        const themeWithoutTag = { ...OUTLINE_THEME_STYLE, tag: undefined };

        const properties = themeStyleToCssProperties(themeWithoutTag);

        expect(properties['--tag-radius']).toBe('4px');
        expect(properties['--tag-fill']).toBe('5%');
        expect(properties['--tag-border']).toBe('40%');
        expect(properties['--tag-tint']).toBe('0%');
        expect(Object.keys(properties).sort()).toEqual(Object.keys(themeStyleToCssProperties(CLASSIC_THEME_STYLE)).sort());
    });

    it('produces the same set of keys for every built-in preset', () => {
        const classicKeys = Object.keys(themeStyleToCssProperties(CLASSIC_THEME_STYLE)).sort();

        for (const preset of THEME_STYLE_PRESETS) {
            expect(Object.keys(themeStyleToCssProperties(preset)).sort()).toEqual(classicKeys);
        }
    });
});

describe('themeStyle.service "Instrumento" preset (P6, user decision 2026-09-28)', () => {
    it('matches the user\'s "Instrumento" values from the theme-polish task', () => {
        expect(INSTRUMENT_THEME_STYLE.id).toBe(INSTRUMENT_THEME_STYLE_ID);
        expect(INSTRUMENT_THEME_STYLE.frame.rest).toEqual({
            radiusPx: 3,
            fillPercent: 0,
            borderPercent: 8,
            blurPx: 3,
            accent: { lengthPx: 20, thicknessPx: 1.5, color: '#ffffff', opacityPercent: 0 },
        });
        expect(INSTRUMENT_THEME_STYLE.frame.hover).toEqual({
            radiusPx: 3,
            fillPercent: 4,
            borderPercent: 20,
            blurPx: 12,
            accent: { lengthPx: 8, thicknessPx: 1, color: '#ffffff', opacityPercent: 60 },
        });
        expect(INSTRUMENT_THEME_STYLE.button.rest).toEqual({
            radiusPx: 3,
            fillPercent: 0,
            borderPercent: 22,
            accent: { lengthPx: 8, thicknessPx: 1, color: '#ffffff', opacityPercent: 0 },
        });
        expect(INSTRUMENT_THEME_STYLE.button.hover).toEqual({
            radiusPx: 3,
            fillPercent: 3,
            borderPercent: 50,
            accent: { lengthPx: 8, thicknessPx: 1, color: '#ffffff', opacityPercent: 0 },
        });
        expect(INSTRUMENT_THEME_STYLE.button.baseStrengthPercent).toBe(0);
    });

    it('locks the icon-only recipe: own color at full strength, borderless in both states', () => {
        expect(INSTRUMENT_THEME_STYLE.button.icon).toEqual({
            rest: { radiusPx: 6, fillPercent: 0, borderPercent: 0, accent: { lengthPx: 16, thicknessPx: 1, color: '#ffffff', opacityPercent: 0 } },
            hover: { radiusPx: 3, fillPercent: 5, borderPercent: 0, accent: { lengthPx: 5, thicknessPx: 1, color: '#ffffff', opacityPercent: 60 } },
            baseStrengthPercent: 100,
        });
    });

    it('locks the tag recipe: flat style, radius 3, no fill/border, 14% tint', () => {
        expect(INSTRUMENT_THEME_STYLE.tag).toEqual({
            style: 'flat',
            radiusPx: 3,
            fillPercent: 0,
            borderPercent: 0,
            tintPercent: 14,
        });
    });
});

describe('applyThemeStyleToDocument / resetThemeStyleOnDocument', () => {
    it('sets every mapped custom property on the target element', () => {
        const target = makeTarget();

        applyThemeStyleToDocument(OUTLINE_THEME_STYLE, target);

        expect(target.style.getPropertyValue('--frame-radius-rest')).toBe('0px');
        expect(target.style.getPropertyValue('--frame-accent-opacity-hover')).toBe('40%');
        expect(target.style.getPropertyValue('--button-border-hover')).toBe('50%');
        expect(target.style.getPropertyValue('--button-icon-border-hover')).toBe('0%');
        expect(target.style.getPropertyValue('--button-icon-base-strength')).toBe('100%');
        expect(target.style.getPropertyValue('--tag-radius')).toBe('4px');
        expect(target.style.getPropertyValue('--tag-border')).toBe('40%');
    });

    it('removes every theme custom property, restoring the CSS defaults', () => {
        const target = makeTarget();
        applyThemeStyleToDocument(OUTLINE_THEME_STYLE, target);

        resetThemeStyleOnDocument(target);

        expect(target.style.getPropertyValue('--frame-radius-rest')).toBe('');
        expect(target.style.getPropertyValue('--frame-accent-opacity-hover')).toBe('');
        expect(target.style.getPropertyValue('--button-icon-border-hover')).toBe('');
        expect(target.style.getPropertyValue('--button-icon-base-strength')).toBe('');
        expect(target.style.getPropertyValue('--tag-radius')).toBe('');
        expect(target.style.getPropertyValue('--tag-tint')).toBe('');
    });
});

describe('theme style persistence', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('round-trips the active preset id through localStorage', () => {
        writeStoredThemeStylePresetId(OUTLINE_THEME_STYLE_ID);

        expect(localStorage.getItem(THEME_STYLE_STORAGE_KEY)).toBe(OUTLINE_THEME_STYLE_ID);
        expect(readStoredThemeStylePresetId()).toBe(OUTLINE_THEME_STYLE_ID);
    });

    it('round-trips the Instrumento preset id through localStorage', () => {
        writeStoredThemeStylePresetId(INSTRUMENT_THEME_STYLE_ID);

        expect(readStoredThemeStylePresetId()).toBe(INSTRUMENT_THEME_STYLE_ID);
    });

    it('returns null when nothing is stored', () => {
        expect(readStoredThemeStylePresetId()).toBeNull();
    });

    it('fails safe when localStorage throws on read', () => {
        const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage unavailable');
        });

        try {
            expect(readStoredThemeStylePresetId()).toBeNull();
        } finally {
            getItemSpy.mockRestore();
        }
    });

    it('fails safe when localStorage throws on write', () => {
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('storage unavailable');
        });

        try {
            expect(() => writeStoredThemeStylePresetId(OUTLINE_THEME_STYLE_ID)).not.toThrow();
        } finally {
            setItemSpy.mockRestore();
        }
    });
});

describe('setActiveThemeStyle', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        resetThemeStyleOnDocument(document.documentElement);
        localStorage.clear();
    });

    it('applies and persists a non-default preset', () => {
        setActiveThemeStyle(OUTLINE_THEME_STYLE_ID);

        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('0px');
        expect(localStorage.getItem(THEME_STYLE_STORAGE_KEY)).toBe(OUTLINE_THEME_STYLE_ID);
    });

    it('resets overrides and persists Clasico', () => {
        setActiveThemeStyle(OUTLINE_THEME_STYLE_ID);

        setActiveThemeStyle(CLASSIC_THEME_STYLE_ID);

        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('');
        expect(localStorage.getItem(THEME_STYLE_STORAGE_KEY)).toBe(CLASSIC_THEME_STYLE_ID);
    });
});

describe('applyThemeStyleOverrides (boot re-apply)', () => {
    beforeEach(() => {
        localStorage.clear();
        resetThemeStyleOnDocument(document.documentElement);
    });

    afterEach(() => {
        resetThemeStyleOnDocument(document.documentElement);
        localStorage.clear();
    });

    it('does nothing when no theme style was ever saved', () => {
        applyThemeStyleOverrides();

        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('');
    });

    it('re-applies the persisted non-default preset on boot', () => {
        writeStoredThemeStylePresetId(OUTLINE_THEME_STYLE_ID);

        applyThemeStyleOverrides();

        expect(document.documentElement.style.getPropertyValue('--frame-border-hover')).toBe('25%');
    });

    it('re-applies the persisted Instrumento preset on boot', () => {
        writeStoredThemeStylePresetId(INSTRUMENT_THEME_STYLE_ID);

        applyThemeStyleOverrides();

        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('3px');
        expect(document.documentElement.style.getPropertyValue('--tag-tint')).toBe('14%');
    });

    it('ignores a corrupt stored preset id and leaves the defaults untouched', () => {
        localStorage.setItem(THEME_STYLE_STORAGE_KEY, 'not-a-real-preset');

        applyThemeStyleOverrides();

        expect(document.documentElement.style.getPropertyValue('--frame-radius-rest')).toBe('');
    });
});
