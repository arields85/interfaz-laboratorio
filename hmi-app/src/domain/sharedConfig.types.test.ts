import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    DASHBOARDS_STORAGE_KEY,
    HIERARCHY_STORAGE_KEY,
    NODE_TYPES_STORAGE_KEY,
    TEMPLATES_STORAGE_KEY,
    VARIABLE_CATALOG_STORAGE_KEY,
} from '../utils/legacyStorageCleanup';

import {
    MAX_SHARED_CONFIG_BATCH_OPERATIONS,
    MAX_SHARED_CONFIG_KEY_LENGTH,
    MAX_SHARED_CONFIG_REQUEST_BYTES,
    MAX_SHARED_CONFIG_VALUE_BYTES,
    SHARED_CONFIG_KEYS,
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

    it('keeps its bounds identical to the runtime store and route', () => {
        const here = path.dirname(fileURLToPath(import.meta.url));
        const runtime = path.resolve(here, '../../../services/prisma-runtime/src/prisma_runtime');
        const store = readFileSync(path.join(runtime, 'hmi_config_store.py'), 'utf-8');
        const route = readFileSync(path.join(runtime, 'admin_http.py'), 'utf-8');
        const mib = (source: string, name: string): number => {
            const match = new RegExp(`^${name} = (\\d+) \\* 1024 \\* 1024`, 'm').exec(source);
            if (!match) throw new Error(`missing ${name}`);
            return Number(match[1]) * 1024 * 1024;
        };
        const count = (source: string, name: string): number => {
            const match = new RegExp(`^${name} = (\\d+)`, 'm').exec(source);
            if (!match) throw new Error(`missing ${name}`);
            return Number(match[1]);
        };

        expect(MAX_SHARED_CONFIG_VALUE_BYTES).toBe(mib(store, 'MAX_VALUE_BYTES'));
        expect(MAX_SHARED_CONFIG_KEY_LENGTH).toBe(count(store, 'MAX_KEY_LENGTH'));
        expect(MAX_SHARED_CONFIG_BATCH_OPERATIONS).toBe(count(store, 'MAX_BATCH_OPERATIONS'));
        expect(MAX_SHARED_CONFIG_REQUEST_BYTES).toBe(mib(route, 'MAX_HMI_CONFIG_REQUEST_BYTES'));
        expect(MAX_SHARED_CONFIG_VALUE_BYTES).toBe(4 * 1024 * 1024);
    });

    it('lists exactly the content stores as shared keys, never per-browser state', () => {
        expect([...SHARED_CONFIG_KEYS].sort()).toEqual([
            DASHBOARDS_STORAGE_KEY,
            HIERARCHY_STORAGE_KEY,
            NODE_TYPES_STORAGE_KEY,
            TEMPLATES_STORAGE_KEY,
            VARIABLE_CATALOG_STORAGE_KEY,
        ].sort());
        for (const key of SHARED_CONFIG_KEYS) expect(isValidSharedConfigKey(key)).toBe(true);
        for (const local of [
            'hmi:shared-config-cache',
            'laboratorio_hmi_hierarchy_expanded_v1',
            'hmi-global-settings-tab',
            'hmi-auth-session',
            'hmi-prisma-voice-prebuffer-history',
        ]) {
            expect(SHARED_CONFIG_KEYS).not.toContain(local);
        }
    });
});
