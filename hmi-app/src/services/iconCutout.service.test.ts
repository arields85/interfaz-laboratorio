import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    applyIconCutoutOverride,
    DEFAULT_ICON_CUTOUT,
    getActiveIconCutout,
    ICON_CUTOUT_STORAGE_KEY,
    previewIconCutout,
    readStoredIconCutout,
    resetIconCutoutOnDocument,
    writeStoredIconCutout,
} from './iconCutout.service';
import {
    CLASSIC_THEME_STYLE_ID,
    INSTRUMENT_THEME_STYLE_ID,
    previewThemeStyleOnDocument,
    resetThemeStyleOnDocument,
} from './themeStyle.service';
import { useThemeStylePresetStore } from '../store/themeStylePreset.store';

describe('iconCutout.service', () => {
    beforeEach(() => {
        localStorage.clear();
        resetIconCutoutOnDocument();
    });

    afterEach(() => {
        localStorage.clear();
        resetIconCutoutOnDocument();
        vi.restoreAllMocks();
    });

    it('defaults to off on a fresh install', () => {
        expect(DEFAULT_ICON_CUTOUT).toBe(false);
        expect(readStoredIconCutout()).toBe(false);
        expect(getActiveIconCutout()).toBe(false);
    });

    it('stores only the override: on writes the key, off removes it', () => {
        writeStoredIconCutout(true);
        expect(localStorage.getItem(ICON_CUTOUT_STORAGE_KEY)).toBe('true');
        expect(readStoredIconCutout()).toBe(true);

        writeStoredIconCutout(false);
        expect(localStorage.getItem(ICON_CUTOUT_STORAGE_KEY)).toBeNull();
        expect(readStoredIconCutout()).toBe(false);
    });

    it.each(['', 'yes', '1', 'TRUE', 'null', '{"a":1}'])('ignores the invalid stored value %j and falls back to off', (raw) => {
        localStorage.setItem(ICON_CUTOUT_STORAGE_KEY, raw);

        expect(readStoredIconCutout()).toBe(false);
    });

    it('survives unavailable storage on read and write', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });

        expect(readStoredIconCutout()).toBe(false);
        expect(() => writeStoredIconCutout(true)).not.toThrow();
        expect(() => writeStoredIconCutout(false)).not.toThrow();
    });

    it('previews the live value without persisting it', () => {
        previewIconCutout(true);

        expect(getActiveIconCutout()).toBe(true);
        expect(localStorage.getItem(ICON_CUTOUT_STORAGE_KEY)).toBeNull();
    });

    it('re-applies the stored override at boot', () => {
        writeStoredIconCutout(true);

        applyIconCutoutOverride();

        expect(getActiveIconCutout()).toBe(true);
    });
});

describe('active theme preset tracking', () => {
    afterEach(() => {
        resetThemeStyleOnDocument(document.documentElement);
        useThemeStylePresetStore.getState().setClassic(true);
    });

    it('reports Clasico by default', () => {
        expect(useThemeStylePresetStore.getState().classic).toBe(true);
    });

    it('follows the preset previewed on the document', () => {
        previewThemeStyleOnDocument(INSTRUMENT_THEME_STYLE_ID);
        expect(useThemeStylePresetStore.getState().classic).toBe(false);

        previewThemeStyleOnDocument(CLASSIC_THEME_STYLE_ID);
        expect(useThemeStylePresetStore.getState().classic).toBe(true);
    });

    it('ignores a preview scoped to another element (a preset card)', () => {
        previewThemeStyleOnDocument(INSTRUMENT_THEME_STYLE_ID, document.createElement('div'));

        expect(useThemeStylePresetStore.getState().classic).toBe(true);
    });
});
