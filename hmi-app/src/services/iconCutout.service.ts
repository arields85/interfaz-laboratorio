import { useIconCutoutStore } from '../store/iconCutout.store';

/**
 * Persistence side of the icon cutout setting ("Calado del ícono", Configuración general -> Tema).
 *
 * Same rule as the rest of the visual configuration: the code default (off, today's frames) is the
 * source of truth and only the override is stored in `localStorage`. The live value is the Zustand
 * `useIconCutoutStore`, so a preview from the Tema tab re-renders every framed widget at once.
 */
export const ICON_CUTOUT_STORAGE_KEY = 'hmi-icon-cutout';

/** A fresh install and anyone who never turns it on keep today's frames. */
export const DEFAULT_ICON_CUTOUT = false;

const STORED_ON_VALUE = 'true';

export function getActiveIconCutout(): boolean {
    return useIconCutoutStore.getState().enabled;
}

/** Defaults plus the stored override (anything but the exact stored "on" value resolves to the default). */
export function readStoredIconCutout(): boolean {
    try {
        return localStorage.getItem(ICON_CUTOUT_STORAGE_KEY) === STORED_ON_VALUE ? true : DEFAULT_ICON_CUTOUT;
    } catch {
        return DEFAULT_ICON_CUTOUT;
    }
}

/** Persists only an override; the default removes the key. */
export function writeStoredIconCutout(enabled: boolean): void {
    try {
        if (enabled === DEFAULT_ICON_CUTOUT) {
            localStorage.removeItem(ICON_CUTOUT_STORAGE_KEY);
        } else {
            localStorage.setItem(ICON_CUTOUT_STORAGE_KEY, STORED_ON_VALUE);
        }
    } catch { /* ignore unavailable storage */ }
}

/** Makes `enabled` the live value without persisting it. */
export function previewIconCutout(enabled: boolean): void {
    useIconCutoutStore.getState().setEnabled(enabled);
}

/** Restores the code default (used by tests and by "restore defaults" paths). */
export function resetIconCutoutOnDocument(): void {
    previewIconCutout(DEFAULT_ICON_CUTOUT);
}

/** Boot re-apply of the stored override. Call once from `main.tsx` before the app renders. */
export function applyIconCutoutOverride(): void {
    previewIconCutout(readStoredIconCutout());
}
