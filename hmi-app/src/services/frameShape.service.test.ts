import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FRAME_SHAPE } from '../domain/frameShape.types';
import {
    applyFrameShapeOverrides,
    FRAME_SHAPE_ATTRIBUTE,
    FRAME_SHAPE_STORAGE_KEY,
    getActiveFrameShape,
    previewFrameShape,
    readStoredFrameShape,
    resetFrameShapeOnDocument,
    writeStoredFrameShape,
} from './frameShape.service';
import { useFrameShapeStore } from '../store/frameShape.store';

const root = document.documentElement;

describe('frameShape.service', () => {
    beforeEach(() => {
        localStorage.clear();
        resetFrameShapeOnDocument(root);
    });

    afterEach(() => {
        localStorage.clear();
        resetFrameShapeOnDocument(root);
    });

    it('defaults to the standard frame on a fresh install', () => {
        expect(DEFAULT_FRAME_SHAPE).toBe('standard');
        expect(readStoredFrameShape()).toBe('standard');
        expect(getActiveFrameShape()).toBe('standard');
    });

    it('stores only the override: picking the tab shape writes it, returning to standard removes the key', () => {
        writeStoredFrameShape('tab');
        expect(localStorage.getItem(FRAME_SHAPE_STORAGE_KEY)).toBe('tab');
        expect(readStoredFrameShape()).toBe('tab');

        writeStoredFrameShape('standard');
        expect(localStorage.getItem(FRAME_SHAPE_STORAGE_KEY)).toBeNull();
        expect(readStoredFrameShape()).toBe('standard');
    });

    it('ignores an unknown stored value and falls back to standard', () => {
        localStorage.setItem(FRAME_SHAPE_STORAGE_KEY, 'hexagon');

        expect(readStoredFrameShape()).toBe('standard');
    });

    it('survives unavailable storage on read and write', () => {
        const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage unavailable');
        });
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('storage unavailable');
        });

        expect(readStoredFrameShape()).toBe('standard');
        expect(() => writeStoredFrameShape('tab')).not.toThrow();

        getItem.mockRestore();
        setItem.mockRestore();
    });

    it('previews a shape on the document attribute and the active store, without persisting', () => {
        previewFrameShape('tab');

        expect(getActiveFrameShape()).toBe('tab');
        expect(root.getAttribute(FRAME_SHAPE_ATTRIBUTE)).toBe('tab');
        expect(localStorage.getItem(FRAME_SHAPE_STORAGE_KEY)).toBeNull();
    });

    it('does not leave a data attribute behind for the standard shape', () => {
        previewFrameShape('tab');
        previewFrameShape('standard');

        expect(getActiveFrameShape()).toBe('standard');
        expect(root.hasAttribute(FRAME_SHAPE_ATTRIBUTE)).toBe(false);
    });

    it('notifies store subscribers only when the shape really changes, and stops after unsubscribe', () => {
        const listener = vi.fn();
        const unsubscribe = useFrameShapeStore.subscribe(listener);

        previewFrameShape('tab');
        previewFrameShape('tab');
        expect(listener).toHaveBeenCalledTimes(1);

        previewFrameShape('standard');
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
        previewFrameShape('tab');
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('re-applies the stored override at boot', () => {
        localStorage.setItem(FRAME_SHAPE_STORAGE_KEY, 'tab');

        applyFrameShapeOverrides();

        expect(getActiveFrameShape()).toBe('tab');
        expect(root.getAttribute(FRAME_SHAPE_ATTRIBUTE)).toBe('tab');
    });

    it('resets the store and the attribute', () => {
        previewFrameShape('tab');

        resetFrameShapeOnDocument(root);

        expect(getActiveFrameShape()).toBe('standard');
        expect(root.hasAttribute(FRAME_SHAPE_ATTRIBUTE)).toBe(false);
    });
});
