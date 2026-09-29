import { DEFAULT_FRAME_SHAPE, isFrameShape } from '../domain/frameShape.types';
import type { FrameShape } from '../domain/frameShape.types';
import { useFrameShapeStore } from '../store/frameShape.store';

/**
 * Persistence and document side of the active widget frame shape ("Forma del marco",
 * Configuración general -> Tema).
 *
 * It follows the rule of the rest of the visual configuration: the code default
 * (`standard`, today's frames) is the source of truth and only the override is
 * stored in `localStorage`. The live value is the Zustand `useFrameShapeStore`
 * (components read it with `useFrameShape`), so a preview from the Tema tab
 * re-renders every framed widget immediately. It is also mirrored on the document
 * element as `data-frame-shape` (set only for non-default shapes) so CSS and tests
 * can read it without React.
 */
export const FRAME_SHAPE_STORAGE_KEY = 'hmi-frame-shape';
export const FRAME_SHAPE_ATTRIBUTE = 'data-frame-shape';

export function getActiveFrameShape(): FrameShape {
    return useFrameShapeStore.getState().shape;
}

function setActiveFrameShape(shape: FrameShape, target: HTMLElement): void {
    if (shape === DEFAULT_FRAME_SHAPE) {
        target.removeAttribute(FRAME_SHAPE_ATTRIBUTE);
    } else {
        target.setAttribute(FRAME_SHAPE_ATTRIBUTE, shape);
    }

    useFrameShapeStore.getState().setShape(shape);
}

/** Defaults plus the stored override (anything unknown resolves to the default). */
export function readStoredFrameShape(): FrameShape {
    try {
        const raw = localStorage.getItem(FRAME_SHAPE_STORAGE_KEY);

        return isFrameShape(raw) ? raw : DEFAULT_FRAME_SHAPE;
    } catch {
        return DEFAULT_FRAME_SHAPE;
    }
}

/** Persists only an override; the default shape removes the key. */
export function writeStoredFrameShape(shape: FrameShape): void {
    try {
        if (shape === DEFAULT_FRAME_SHAPE) {
            localStorage.removeItem(FRAME_SHAPE_STORAGE_KEY);
        } else {
            localStorage.setItem(FRAME_SHAPE_STORAGE_KEY, shape);
        }
    } catch { /* ignore unavailable storage */ }
}

/** Makes `shape` the live shape of the whole document without persisting it. */
export function previewFrameShape(shape: FrameShape, target: HTMLElement = document.documentElement): void {
    setActiveFrameShape(shape, target);
}

/** Restores the code default (used by tests and by "restore defaults" paths). */
export function resetFrameShapeOnDocument(target: HTMLElement = document.documentElement): void {
    setActiveFrameShape(DEFAULT_FRAME_SHAPE, target);
}

/** Boot re-apply of the stored override. Call once from `main.tsx` before the app renders. */
export function applyFrameShapeOverrides(): void {
    previewFrameShape(readStoredFrameShape());
}
