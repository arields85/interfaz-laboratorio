import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    applyLinkAccentLengthsOverride,
    applyLinkAccentLengthsToDocument,
    DEFAULT_LINK_ACCENT_LENGTHS,
    LINK_ACCENT_LENGTH_LIMITS,
    LINK_ACCENT_LENGTHS_STORAGE_KEY,
    readStoredLinkAccentLengths,
    resetLinkAccentLengthsOnDocument,
    writeStoredLinkAccentLengths,
} from './linkCornerAccents.service';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(currentDir, '../index.css'), 'utf-8');
const root = () => document.documentElement.style;

describe('link corner accent lengths', () => {
    beforeEach(() => {
        localStorage.clear();
        resetLinkAccentLengthsOnDocument();
    });

    afterEach(() => {
        localStorage.clear();
        resetLinkAccentLengthsOnDocument();
        vi.restoreAllMocks();
    });

    it('defaults equal the index.css tokens (30 px rest, 22 px hover) and the range is 0-60 px, step 1', () => {
        expect(DEFAULT_LINK_ACCENT_LENGTHS).toEqual({ restPx: 30, hoverPx: 22 });
        expect(indexCss).toMatch(/--link-accent-length-rest: 30px;/);
        expect(indexCss).toMatch(/--link-accent-length-hover: 22px;/);
        expect(LINK_ACCENT_LENGTH_LIMITS).toEqual({ min: 0, max: 60, step: 1 });
    });

    it('reads the defaults on a fresh install', () => {
        expect(readStoredLinkAccentLengths()).toEqual(DEFAULT_LINK_ACCENT_LENGTHS);
    });

    it('stores only the overrides and removes the key when nothing differs', () => {
        writeStoredLinkAccentLengths({ restPx: 24, hoverPx: 22 });
        expect(JSON.parse(localStorage.getItem(LINK_ACCENT_LENGTHS_STORAGE_KEY) ?? '')).toEqual({ restPx: 24 });
        expect(readStoredLinkAccentLengths()).toEqual({ restPx: 24, hoverPx: 22 });

        writeStoredLinkAccentLengths({ restPx: 30, hoverPx: 22 });
        expect(localStorage.getItem(LINK_ACCENT_LENGTHS_STORAGE_KEY)).toBeNull();
    });

    it('clamps out-of-range numbers and snaps off-step ones', () => {
        localStorage.setItem(LINK_ACCENT_LENGTHS_STORAGE_KEY, JSON.stringify({ restPx: 99, hoverPx: -5 }));
        expect(readStoredLinkAccentLengths()).toEqual({ restPx: 60, hoverPx: 0 });

        localStorage.setItem(LINK_ACCENT_LENGTHS_STORAGE_KEY, JSON.stringify({ restPx: 15.4 }));
        expect(readStoredLinkAccentLengths()).toEqual({ restPx: 15, hoverPx: 22 });
    });

    it.each(['', 'nope', 'null', '5', '[1]', '{"restPx":"9"}', '{"restPx":null,"hoverPx":{}}'])(
        'falls back to the defaults for the invalid stored value %j',
        (raw) => {
            localStorage.setItem(LINK_ACCENT_LENGTHS_STORAGE_KEY, raw);

            expect(readStoredLinkAccentLengths()).toEqual(DEFAULT_LINK_ACCENT_LENGTHS);
        },
    );

    it('keeps the valid field when the other one is invalid', () => {
        localStorage.setItem(LINK_ACCENT_LENGTHS_STORAGE_KEY, JSON.stringify({ restPx: 'x', hoverPx: 12 }));

        expect(readStoredLinkAccentLengths()).toEqual({ restPx: 30, hoverPx: 12 });
    });

    it('survives unavailable storage on read and write', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });

        expect(readStoredLinkAccentLengths()).toEqual(DEFAULT_LINK_ACCENT_LENGTHS);
        expect(() => writeStoredLinkAccentLengths({ restPx: 1, hoverPx: 2 })).not.toThrow();
        expect(() => writeStoredLinkAccentLengths(DEFAULT_LINK_ACCENT_LENGTHS)).not.toThrow();
    });

    it('writes the root custom properties only for overridden values', () => {
        applyLinkAccentLengthsToDocument({ restPx: 24, hoverPx: 22 });

        expect(root().getPropertyValue('--link-accent-length-rest')).toBe('24px');
        expect(root().getPropertyValue('--link-accent-length-hover')).toBe('');
    });

    it('removes the properties when a value returns to its default or on reset', () => {
        applyLinkAccentLengthsToDocument({ restPx: 24, hoverPx: 12 });
        applyLinkAccentLengthsToDocument(DEFAULT_LINK_ACCENT_LENGTHS);
        expect(root().getPropertyValue('--link-accent-length-rest')).toBe('');
        expect(root().getPropertyValue('--link-accent-length-hover')).toBe('');

        applyLinkAccentLengthsToDocument({ restPx: 24, hoverPx: 12 });
        resetLinkAccentLengthsOnDocument();
        expect(root().getPropertyValue('--link-accent-length-rest')).toBe('');
        expect(root().getPropertyValue('--link-accent-length-hover')).toBe('');
    });

    it('re-applies the stored overrides at boot', () => {
        writeStoredLinkAccentLengths({ restPx: 36, hoverPx: 4 });

        applyLinkAccentLengthsOverride();

        expect(root().getPropertyValue('--link-accent-length-rest')).toBe('36px');
        expect(root().getPropertyValue('--link-accent-length-hover')).toBe('4px');
    });
});
