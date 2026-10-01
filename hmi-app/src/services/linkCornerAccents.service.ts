import { useLinkCornerAccentsStore } from '../store/linkCornerAccents.store';

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
