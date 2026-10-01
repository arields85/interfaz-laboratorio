import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    applyLinkCornerAccentsOverride,
    DEFAULT_LINK_CORNER_ACCENTS,
    getActiveLinkCornerAccents,
    LINK_CORNER_ACCENTS_STORAGE_KEY,
    previewLinkCornerAccents,
    readStoredLinkCornerAccents,
    resetLinkCornerAccentsOnDocument,
    writeStoredLinkCornerAccents,
} from './linkCornerAccents.service';

describe('linkCornerAccents.service', () => {
    beforeEach(() => {
        localStorage.clear();
        resetLinkCornerAccentsOnDocument();
    });

    afterEach(() => {
        localStorage.clear();
        resetLinkCornerAccentsOnDocument();
        vi.restoreAllMocks();
    });

    it('defaults to off on a fresh install', () => {
        expect(DEFAULT_LINK_CORNER_ACCENTS).toBe(false);
        expect(readStoredLinkCornerAccents()).toBe(false);
        expect(getActiveLinkCornerAccents()).toBe(false);
    });

    it('stores only the override: on writes the key, off removes it', () => {
        writeStoredLinkCornerAccents(true);
        expect(localStorage.getItem(LINK_CORNER_ACCENTS_STORAGE_KEY)).toBe('true');
        expect(readStoredLinkCornerAccents()).toBe(true);

        writeStoredLinkCornerAccents(false);
        expect(localStorage.getItem(LINK_CORNER_ACCENTS_STORAGE_KEY)).toBeNull();
        expect(readStoredLinkCornerAccents()).toBe(false);
    });

    it.each(['', 'yes', '1', 'TRUE', 'null', '{"a":1}'])('ignores the invalid stored value %j and falls back to off', (raw) => {
        localStorage.setItem(LINK_CORNER_ACCENTS_STORAGE_KEY, raw);

        expect(readStoredLinkCornerAccents()).toBe(false);
    });

    it('survives unavailable storage on read and write', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });

        expect(readStoredLinkCornerAccents()).toBe(false);
        expect(() => writeStoredLinkCornerAccents(true)).not.toThrow();
        expect(() => writeStoredLinkCornerAccents(false)).not.toThrow();
    });

    it('previews the live value without persisting it', () => {
        previewLinkCornerAccents(true);

        expect(getActiveLinkCornerAccents()).toBe(true);
        expect(localStorage.getItem(LINK_CORNER_ACCENTS_STORAGE_KEY)).toBeNull();
    });

    it('re-applies the stored override at boot', () => {
        writeStoredLinkCornerAccents(true);

        applyLinkCornerAccentsOverride();

        expect(getActiveLinkCornerAccents()).toBe(true);
    });
});
