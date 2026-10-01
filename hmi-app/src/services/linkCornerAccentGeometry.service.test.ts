import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    applyLinkAccentGeometryOverride,
    applyLinkAccentGeometryToDocument,
    DEFAULT_LINK_ACCENT_GEOMETRY,
    LINK_ACCENT_GEOMETRY_STORAGE_KEY,
    LINK_ACCENT_OFFSET_LIMITS,
    LINK_ACCENT_RADIUS_LIMITS,
    readStoredLinkAccentGeometry,
    resetLinkAccentGeometryOnDocument,
    writeStoredLinkAccentGeometry,
} from './linkCornerAccents.service';

const rootValue = (name: string) => document.documentElement.style.getPropertyValue(name);

describe('link corner accent geometry (distance and radius)', () => {
    beforeEach(() => {
        localStorage.clear();
        resetLinkAccentGeometryOnDocument();
    });

    afterEach(() => {
        localStorage.clear();
        resetLinkAccentGeometryOnDocument();
        vi.restoreAllMocks();
    });

    it('defaults to a 5 px distance and a 5 px radius, with the documented ranges', () => {
        expect(DEFAULT_LINK_ACCENT_GEOMETRY).toEqual({ offsetPx: 5, radiusPx: 5 });
        expect(LINK_ACCENT_OFFSET_LIMITS).toEqual({ min: 0, max: 16, step: 1 });
        expect(LINK_ACCENT_RADIUS_LIMITS).toEqual({ min: 0, max: 48, step: 1 });
        expect(readStoredLinkAccentGeometry()).toEqual(DEFAULT_LINK_ACCENT_GEOMETRY);
    });

    it('stores only the overrides and removes the key when nothing differs', () => {
        writeStoredLinkAccentGeometry({ offsetPx: 8, radiusPx: 5 });
        expect(JSON.parse(localStorage.getItem(LINK_ACCENT_GEOMETRY_STORAGE_KEY) ?? '')).toEqual({ offsetPx: 8 });

        writeStoredLinkAccentGeometry({ offsetPx: 5, radiusPx: 20 });
        expect(JSON.parse(localStorage.getItem(LINK_ACCENT_GEOMETRY_STORAGE_KEY) ?? '')).toEqual({ radiusPx: 20 });
        expect(readStoredLinkAccentGeometry()).toEqual({ offsetPx: 5, radiusPx: 20 });

        writeStoredLinkAccentGeometry(DEFAULT_LINK_ACCENT_GEOMETRY);
        expect(localStorage.getItem(LINK_ACCENT_GEOMETRY_STORAGE_KEY)).toBeNull();
    });

    it('clamps out-of-range numbers and snaps off-step ones', () => {
        localStorage.setItem(LINK_ACCENT_GEOMETRY_STORAGE_KEY, JSON.stringify({ offsetPx: 99, radiusPx: -3 }));
        expect(readStoredLinkAccentGeometry()).toEqual({ offsetPx: 16, radiusPx: 0 });

        localStorage.setItem(LINK_ACCENT_GEOMETRY_STORAGE_KEY, JSON.stringify({ offsetPx: 7.4, radiusPx: 99 }));
        expect(readStoredLinkAccentGeometry()).toEqual({ offsetPx: 7, radiusPx: 48 });
    });

    it.each(['', 'nope', 'null', '5', '[1]', '{"offsetPx":"9"}', '{"offsetPx":null,"radiusPx":{}}'])(
        'falls back to the defaults for the invalid stored value %j',
        (raw) => {
            localStorage.setItem(LINK_ACCENT_GEOMETRY_STORAGE_KEY, raw);

            expect(readStoredLinkAccentGeometry()).toEqual(DEFAULT_LINK_ACCENT_GEOMETRY);
        },
    );

    it('survives unavailable storage on read and write', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });

        expect(readStoredLinkAccentGeometry()).toEqual(DEFAULT_LINK_ACCENT_GEOMETRY);
        expect(() => writeStoredLinkAccentGeometry({ offsetPx: 1, radiusPx: 2 })).not.toThrow();
        expect(() => writeStoredLinkAccentGeometry(DEFAULT_LINK_ACCENT_GEOMETRY)).not.toThrow();
    });

    it('writes the root custom properties only for overridden values', () => {
        applyLinkAccentGeometryToDocument({ offsetPx: 8, radiusPx: 5 });
        expect(rootValue('--link-accent-offset')).toBe('8px');
        expect(rootValue('--link-accent-radius')).toBe('');

        applyLinkAccentGeometryToDocument({ offsetPx: 5, radiusPx: 0 });
        expect(rootValue('--link-accent-offset')).toBe('');
        expect(rootValue('--link-accent-radius')).toBe('0px');
    });

    it('removes both properties on reset and re-applies the stored overrides at boot', () => {
        writeStoredLinkAccentGeometry({ offsetPx: 10, radiusPx: 24 });
        applyLinkAccentGeometryOverride();
        expect(rootValue('--link-accent-offset')).toBe('10px');
        expect(rootValue('--link-accent-radius')).toBe('24px');

        resetLinkAccentGeometryOnDocument();
        expect(rootValue('--link-accent-offset')).toBe('');
        expect(rootValue('--link-accent-radius')).toBe('');
    });
});
