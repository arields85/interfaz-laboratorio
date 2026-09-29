import type { ViewerEntranceSettings } from '../domain/viewerEntrance.types';

/**
 * User-adjustable values of the viewer entrance animation (V9), edited from
 * Configuración general -> Tema. They are global (not per theme preset) and
 * follow the same rule as the rest of the visual configuration: code defaults
 * are the source of truth and only the overrides are stored in `localStorage`.
 * Applied values reach the viewer as the `--viewer-entrance-*` custom
 * properties of the single `:root` block in `index.css`, which stays the only
 * CSS consumer.
 */
export const VIEWER_ENTRANCE_STORAGE_KEY = 'hmi-viewer-entrance';

/** Keep equal to the `--viewer-entrance-*` values in `index.css` (a test pins it). */
export const DEFAULT_VIEWER_ENTRANCE_SETTINGS: ViewerEntranceSettings = {
    outlineWidthPx: 1,
    outlineOpacityPercent: 100,
    flashIntensityPercent: 16,
};

export const VIEWER_ENTRANCE_LIMITS: Record<keyof ViewerEntranceSettings, { min: number; max: number; step: number }> = {
    outlineWidthPx: { min: 0.5, max: 3, step: 0.25 },
    outlineOpacityPercent: { min: 0, max: 100, step: 5 },
    flashIntensityPercent: { min: 0, max: 50, step: 1 },
};

const SETTING_KEYS = Object.keys(DEFAULT_VIEWER_ENTRANCE_SETTINGS) as (keyof ViewerEntranceSettings)[];

function fractionToken(percent: number): string {
    return String(Number((percent / 100).toFixed(4)));
}

/** Maps the settings to the custom properties of the `:root` entrance block. */
export function viewerEntranceSettingsToCssProperties(settings: ViewerEntranceSettings): Record<string, string> {
    return {
        '--viewer-entrance-outline-width': `${settings.outlineWidthPx}px`,
        '--viewer-entrance-outline-opacity': fractionToken(settings.outlineOpacityPercent),
        '--viewer-entrance-flash-peak': fractionToken(settings.flashIntensityPercent),
    };
}

const DEFAULT_CSS_PROPERTIES = viewerEntranceSettingsToCssProperties(DEFAULT_VIEWER_ENTRANCE_SETTINGS);

function clampToLimits(key: keyof ViewerEntranceSettings, value: number): number {
    const { min, max } = VIEWER_ENTRANCE_LIMITS[key];

    return Math.min(max, Math.max(min, value));
}

function readOverrides(): Partial<ViewerEntranceSettings> {
    try {
        const raw = localStorage.getItem(VIEWER_ENTRANCE_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (!parsed || typeof parsed !== 'object') {
            return {};
        }

        const overrides: Partial<ViewerEntranceSettings> = {};
        for (const key of SETTING_KEYS) {
            const value = (parsed as Record<string, unknown>)[key];
            if (typeof value === 'number' && Number.isFinite(value)) {
                overrides[key] = clampToLimits(key, value);
            }
        }

        return overrides;
    } catch {
        return {};
    }
}

/** Defaults plus any valid stored override (out-of-range numbers are clamped). */
export function readStoredViewerEntranceSettings(): ViewerEntranceSettings {
    return { ...DEFAULT_VIEWER_ENTRANCE_SETTINGS, ...readOverrides() };
}

/** Persists only the values that differ from the defaults; nothing to store removes the key. */
export function writeStoredViewerEntranceSettings(settings: ViewerEntranceSettings): void {
    const overrides: Partial<ViewerEntranceSettings> = {};
    for (const key of SETTING_KEYS) {
        if (settings[key] !== DEFAULT_VIEWER_ENTRANCE_SETTINGS[key]) {
            overrides[key] = settings[key];
        }
    }

    try {
        if (Object.keys(overrides).length === 0) {
            localStorage.removeItem(VIEWER_ENTRANCE_STORAGE_KEY);
        } else {
            localStorage.setItem(VIEWER_ENTRANCE_STORAGE_KEY, JSON.stringify(overrides));
        }
    } catch { /* ignore unavailable storage */ }
}

/**
 * Sets the custom property only for overridden values; a value at its default
 * removes the property so the `index.css` `:root` default applies (no inline
 * duplicate of the default).
 */
export function applyViewerEntranceSettingsToDocument(
    settings: ViewerEntranceSettings,
    target: HTMLElement = document.documentElement,
): void {
    const properties = viewerEntranceSettingsToCssProperties(settings);
    for (const [name, value] of Object.entries(properties)) {
        if (value === DEFAULT_CSS_PROPERTIES[name]) {
            target.style.removeProperty(name);
        } else {
            target.style.setProperty(name, value);
        }
    }
}

/** Removes every entrance custom property from `target`, restoring the CSS `:root` defaults. */
export function resetViewerEntranceSettingsOnDocument(target: HTMLElement = document.documentElement): void {
    for (const name of Object.keys(DEFAULT_CSS_PROPERTIES)) {
        target.style.removeProperty(name);
    }
}

/** Boot re-apply of the stored overrides. Call once from `main.tsx` before the app renders. */
export function applyViewerEntranceOverrides(): void {
    applyViewerEntranceSettingsToDocument(readStoredViewerEntranceSettings());
}
