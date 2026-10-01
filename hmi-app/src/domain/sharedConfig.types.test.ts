import { describe, expect, it } from 'vitest';

import {
    MAX_SHARED_CONFIG_KEY_LENGTH,
    MAX_SHARED_CONFIG_VALUE_BYTES,
    isSharedConfigValueWithinLimit,
    isValidSharedConfigKey,
    parseSharedConfigCache,
    parseSharedConfigDocument,
    parseSharedConfigRevision,
} from './sharedConfig.types';

describe('shared config domain', () => {
    it('accepts the existing localStorage key shapes and rejects unsafe keys', () => {
        for (const key of ['hmi:prisma-hmi-name', 'hmi-theme-colors', 'a.b_c:1']) {
            expect(isValidSharedConfigKey(key)).toBe(true);
        }
        for (const key of ['', 'with space', 'slash/key', 'é', 'k'.repeat(MAX_SHARED_CONFIG_KEY_LENGTH + 1)]) {
            expect(isValidSharedConfigKey(key)).toBe(false);
        }
    });

    it('bounds values by their UTF-8 size', () => {
        expect(isSharedConfigValueWithinLimit('x'.repeat(MAX_SHARED_CONFIG_VALUE_BYTES))).toBe(true);
        expect(isSharedConfigValueWithinLimit('x'.repeat(MAX_SHARED_CONFIG_VALUE_BYTES + 1))).toBe(false);
        expect(isSharedConfigValueWithinLimit('é'.repeat(MAX_SHARED_CONFIG_VALUE_BYTES / 2 + 1))).toBe(false);
    });

    it('parses the wire document and revision and rejects malformed payloads', () => {
        expect(parseSharedConfigDocument({ ok: true, revision: 2, items: { 'hmi:a': '1' } }))
            .toEqual({ revision: 2, items: { 'hmi:a': '1' } });
        expect(parseSharedConfigRevision({ ok: true, revision: 0 })).toBe(0);
        for (const bad of [
            null, [], { revision: 1, items: {} }, { ok: true, revision: -1, items: {} },
            { ok: true, revision: 1.5, items: {} }, { ok: true, revision: 1, items: [] },
            { ok: true, revision: 1, items: { 'hmi:a': 1 } }, { ok: true, revision: 1, items: { 'bad key': 'x' } },
        ]) {
            expect(() => parseSharedConfigDocument(bad)).toThrow();
        }
        expect(() => parseSharedConfigRevision({ ok: true, revision: '1' })).toThrow();
    });

    it('treats an absent, foreign or malformed cache copy as absent', () => {
        expect(parseSharedConfigCache(null)).toBeNull();
        expect(parseSharedConfigCache('{nope')).toBeNull();
        expect(parseSharedConfigCache(JSON.stringify({ version: 2, revision: 1, items: {} }))).toBeNull();
        expect(parseSharedConfigCache(JSON.stringify({ version: 1, revision: 1, items: { 'hmi:a': 3 } }))).toBeNull();
        expect(parseSharedConfigCache(JSON.stringify({ version: 1, revision: 3, items: { 'hmi:a': 'x' } })))
            .toEqual({ revision: 3, items: { 'hmi:a': 'x' } });
    });
});
