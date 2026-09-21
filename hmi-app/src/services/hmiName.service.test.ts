import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Install storage and refuse transport before consumer evaluation.
const fixture = vi.hoisted(() => {
    const bytes = new Map<string, string>();
    const refused: string[] = [];
    const storage: Storage = {
        get length() { return bytes.size; },
        clear: () => bytes.clear(),
        getItem: vi.fn((key: string) => bytes.get(key) ?? null),
        key: (index) => [...bytes.keys()][index] ?? null,
        removeItem: (key) => { bytes.delete(key); },
        setItem: vi.fn((key: string, value: string) => { bytes.set(key, value); }),
    };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        refused.push(String(input));
        throw new Error('TEST_NETWORK_REFUSED');
    });
    return { bytes, storage, refused };
});

import { readHmiName, saveHmiName } from './hmiName.service';

const KEY = 'hmi:prisma-hmi-name';
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
    fixture.bytes.clear();
    fixture.refused.length = 0;
    fixture.storage.getItem = vi.fn((key) => fixture.bytes.get(key) ?? null);
    fixture.storage.setItem = vi.fn((key, value) => { fixture.bytes.set(key, value); });
});
afterEach(() => expect(fixture.refused).toEqual([]));

describe('browser-local HMI name persistence', () => {
    it('returns unset without fabricating or writing a default', () => {
        expect(readHmiName()).toEqual({ ok: true, name: null });
        expect(fixture.storage.setItem).not.toHaveBeenCalled();
    });

    it('persists a normalized name across module reload without changing unrelated storage', async () => {
        fixture.bytes.set('unrelated', 'keep');
        expect(saveHmiName('  Panel   recepción  ')).toEqual({ ok: true, name: 'Panel recepción' });
        expect(fixture.bytes.get(KEY)).toBe(JSON.stringify({ version: 1, name: 'Panel recepción' }));
        vi.resetModules();
        const reloaded = await import('./hmiName.service');
        expect(reloaded.readHmiName()).toEqual({ ok: true, name: 'Panel recepción' });
        expect(fixture.bytes.get('unrelated')).toBe('keep');
    });

    it('clears a saved name explicitly', () => {
        saveHmiName('Panel');
        expect(saveHmiName('   ')).toEqual({ ok: true, name: null });
        expect(readHmiName()).toEqual({ ok: true, name: null });
    });

    it('rejects an invalid name without changing the saved value', () => {
        fixture.bytes.set(KEY, JSON.stringify({ version: 1, name: 'Panel' }));
        expect(saveHmiName('a\tb')).toEqual({ ok: false, error: 'invalid' });
        expect(fixture.storage.setItem).not.toHaveBeenCalled();
        expect(readHmiName()).toEqual({ ok: true, name: 'Panel' });
    });

    it('reports corrupt storage as unset with an error and preserves its bytes', () => {
        fixture.bytes.set(KEY, '{');
        expect(readHmiName()).toEqual({ ok: false, name: null, error: 'invalid' });
        expect(fixture.bytes.get(KEY)).toBe('{');
        expect(fixture.storage.setItem).not.toHaveBeenCalled();
    });

    it('reports unavailable storage without exposing raw read errors', () => {
        fixture.storage.getItem = vi.fn(() => { throw new Error('private read detail'); });
        expect(readHmiName()).toEqual({ ok: false, name: null, error: 'unavailable' });
    });

    it('reports failed writes without claiming a local save', () => {
        fixture.storage.setItem = vi.fn(() => { throw new Error('private quota detail'); });
        expect(saveHmiName('Panel')).toEqual({ ok: false, error: 'unavailable' });
        expect(readHmiName()).toEqual({ ok: true, name: null });
    });
});
