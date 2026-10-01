import type { LinkAccentLengths } from '../domain/linkCornerAccents.types';
import { useLinkCornerAccentsStore } from '../store/linkCornerAccents.store';
import { normalizeStepValue } from '../utils/normalizeStepValue';

/**
 * Persistence side of the link corner accents setting ("Esquinas en widgets con enlace",
 * Configuración general -> Tema).
 *
 * Same rule as the rest of the visual configuration: the code default (off) is the source of truth
 * and only the override is stored in `localStorage`. The live value is the Zustand
 * `useLinkCornerAccentsStore`, so a preview from the Tema tab re-renders the viewer grid at once.
 */
export const LINK_CORNER_ACCENTS_STORAGE_KEY = 'hmi-link-corner-accents';

/** A fresh install and anyone who never turns it on keep today's widgets. */
export const DEFAULT_LINK_CORNER_ACCENTS = false;

const STORED_ON_VALUE = 'true';

export function getActiveLinkCornerAccents(): boolean {
    return useLinkCornerAccentsStore.getState().enabled;
}

/** Defaults plus the stored override (anything but the exact stored "on" value resolves to the default). */
export function readStoredLinkCornerAccents(): boolean {
    try {
        return localStorage.getItem(LINK_CORNER_ACCENTS_STORAGE_KEY) === STORED_ON_VALUE ? true : DEFAULT_LINK_CORNER_ACCENTS;
    } catch {
        return DEFAULT_LINK_CORNER_ACCENTS;
    }
}

/** Persists only an override; the default removes the key. */
export function writeStoredLinkCornerAccents(enabled: boolean): void {
    try {
        if (enabled === DEFAULT_LINK_CORNER_ACCENTS) {
            localStorage.removeItem(LINK_CORNER_ACCENTS_STORAGE_KEY);
        } else {
            localStorage.setItem(LINK_CORNER_ACCENTS_STORAGE_KEY, STORED_ON_VALUE);
        }
    } catch { /* ignore unavailable storage */ }
}

/** Makes `enabled` the live value without persisting it. */
export function previewLinkCornerAccents(enabled: boolean): void {
    useLinkCornerAccentsStore.getState().setEnabled(enabled);
}

/** Restores the code default (used by tests and by "restore defaults" paths). */
export function resetLinkCornerAccentsOnDocument(): void {
    previewLinkCornerAccents(DEFAULT_LINK_CORNER_ACCENTS);
}

/** Boot re-apply of the stored override. Call once from `main.tsx` before the app renders. */
export function applyLinkCornerAccentsOverride(): void {
    previewLinkCornerAccents(readStoredLinkCornerAccents());
}

// -----------------------------------------------------------------------------
// Lengths of the accent (the straight tail that continues the corner arc)
//
// Two numeric overrides ("Largo en reposo" / "Largo con el cursor"). Same rule as the other visual
// settings: the `index.css` tokens are the defaults, only the overrides are stored, and the live
// value is the `--link-accent-length-rest` / `-hover` custom property on the document root, written
// only when overridden (the layer in `index.css` is the only CSS consumer).
// -----------------------------------------------------------------------------
export const LINK_ACCENT_LENGTHS_STORAGE_KEY = 'hmi-link-corner-accent-lengths';

/** Keep equal to `--link-accent-length-rest` / `-hover` in `index.css` (a test pins it). */
export const DEFAULT_LINK_ACCENT_LENGTHS: LinkAccentLengths = { restPx: 18, hoverPx: 8 };

export const LINK_ACCENT_LENGTH_LIMITS = { min: 0, max: 40, step: 1 } as const;

const LENGTH_PROPERTIES: Record<keyof LinkAccentLengths, string> = {
    restPx: '--link-accent-length-rest',
    hoverPx: '--link-accent-length-hover',
};

const LENGTH_KEYS = Object.keys(LENGTH_PROPERTIES) as (keyof LinkAccentLengths)[];

/** Defaults plus any valid stored override (out-of-range numbers are clamped, off-step ones snapped, anything else ignored). */
export function readStoredLinkAccentLengths(): LinkAccentLengths {
    const lengths = { ...DEFAULT_LINK_ACCENT_LENGTHS };
    try {
        const raw = localStorage.getItem(LINK_ACCENT_LENGTHS_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (!parsed || typeof parsed !== 'object') {
            return lengths;
        }

        const { min, max, step } = LINK_ACCENT_LENGTH_LIMITS;
        for (const key of LENGTH_KEYS) {
            const value = (parsed as Record<string, unknown>)[key];
            if (typeof value === 'number' && Number.isFinite(value)) {
                lengths[key] = normalizeStepValue(value, min, max, step);
            }
        }
    } catch { /* ignore unavailable or corrupt storage */ }

    return lengths;
}

/** Persists only the values that differ from the defaults; nothing to store removes the key. */
export function writeStoredLinkAccentLengths(lengths: LinkAccentLengths): void {
    const overrides: Partial<LinkAccentLengths> = {};
    for (const key of LENGTH_KEYS) {
        if (lengths[key] !== DEFAULT_LINK_ACCENT_LENGTHS[key]) {
            overrides[key] = lengths[key];
        }
    }

    try {
        if (Object.keys(overrides).length === 0) {
            localStorage.removeItem(LINK_ACCENT_LENGTHS_STORAGE_KEY);
        } else {
            localStorage.setItem(LINK_ACCENT_LENGTHS_STORAGE_KEY, JSON.stringify(overrides));
        }
    } catch { /* ignore unavailable storage */ }
}

/** Makes `lengths` live on the document root; a value at its default removes the property. */
export function applyLinkAccentLengthsToDocument(
    lengths: LinkAccentLengths,
    target: HTMLElement = document.documentElement,
): void {
    for (const key of LENGTH_KEYS) {
        if (lengths[key] === DEFAULT_LINK_ACCENT_LENGTHS[key]) {
            target.style.removeProperty(LENGTH_PROPERTIES[key]);
        } else {
            target.style.setProperty(LENGTH_PROPERTIES[key], `${lengths[key]}px`);
        }
    }
}

/** Removes both custom properties, restoring the `index.css` defaults. */
export function resetLinkAccentLengthsOnDocument(target: HTMLElement = document.documentElement): void {
    applyLinkAccentLengthsToDocument(DEFAULT_LINK_ACCENT_LENGTHS, target);
}

/** Boot re-apply of the stored overrides. Call once from `main.tsx` before the app renders. */
export function applyLinkAccentLengthsOverride(): void {
    applyLinkAccentLengthsToDocument(readStoredLinkAccentLengths());
}
