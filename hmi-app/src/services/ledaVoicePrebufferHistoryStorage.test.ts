import { beforeEach, describe, expect, it } from 'vitest';

import {
    LEDA_VOICE_PREBUFFER_HISTORY_STORAGE_KEY,
    LedaVoicePrebufferHistoryStorage,
} from './ledaVoicePrebufferHistoryStorage';

function throwingStorage(): Storage {
    return {
        getItem: () => { throw new Error('storage denied'); },
        setItem: () => { throw new Error('storage denied'); },
        removeItem: () => { throw new Error('storage denied'); },
        clear: () => { throw new Error('storage denied'); },
        key: () => { throw new Error('storage denied'); },
        length: 0,
    };
}

describe('LedaVoicePrebufferHistoryStorage', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns an empty history when nothing was ever written', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(localStorage);

        expect(storage.read()).toEqual([]);
    });

    it('round-trips a written history', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(localStorage);
        const history = [
            { neededPrebufferMs: 200, recordedAtMs: 1_000 },
            { neededPrebufferMs: 350, recordedAtMs: 2_000 },
        ];

        storage.write(history);

        expect(storage.read()).toEqual(history);
    });

    it('persists under the documented storage key', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(localStorage);
        storage.write([{ neededPrebufferMs: 200, recordedAtMs: 1_000 }]);

        expect(localStorage.getItem(LEDA_VOICE_PREBUFFER_HISTORY_STORAGE_KEY)).not.toBeNull();
    });

    it('treats unparseable JSON as an empty history', () => {
        localStorage.setItem(LEDA_VOICE_PREBUFFER_HISTORY_STORAGE_KEY, '{not json');
        const storage = new LedaVoicePrebufferHistoryStorage(localStorage);

        expect(storage.read()).toEqual([]);
    });

    it('treats a non-array JSON value as an empty history', () => {
        localStorage.setItem(LEDA_VOICE_PREBUFFER_HISTORY_STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
        const storage = new LedaVoicePrebufferHistoryStorage(localStorage);

        expect(storage.read()).toEqual([]);
    });

    it('drops individually invalid entries but keeps the valid ones in an otherwise-array payload', () => {
        localStorage.setItem(LEDA_VOICE_PREBUFFER_HISTORY_STORAGE_KEY, JSON.stringify([
            { neededPrebufferMs: 200, recordedAtMs: 1_000 },
            { neededPrebufferMs: -5, recordedAtMs: 2_000 },
            { neededPrebufferMs: 300 },
            'not an object',
            { neededPrebufferMs: 400, recordedAtMs: 4_000 },
        ]));
        const storage = new LedaVoicePrebufferHistoryStorage(localStorage);

        expect(storage.read()).toEqual([
            { neededPrebufferMs: 200, recordedAtMs: 1_000 },
            { neededPrebufferMs: 400, recordedAtMs: 4_000 },
        ]);
    });

    it('treats a null source as unavailable storage (empty history, no throw)', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(null);

        expect(storage.read()).toEqual([]);
        expect(() => storage.write([{ neededPrebufferMs: 200, recordedAtMs: 1_000 }])).not.toThrow();
    });

    it('never throws when the underlying storage throws on read', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(throwingStorage());

        expect(storage.read()).toEqual([]);
    });

    it('never throws when the underlying storage throws on write', () => {
        const storage = new LedaVoicePrebufferHistoryStorage(throwingStorage());

        expect(() => storage.write([{ neededPrebufferMs: 200, recordedAtMs: 1_000 }])).not.toThrow();
    });

    it('accepts a storage factory function, resolved lazily and only once', () => {
        let calls = 0;
        const storage = new LedaVoicePrebufferHistoryStorage(() => {
            calls += 1;
            return localStorage;
        });

        storage.read();
        storage.write([{ neededPrebufferMs: 200, recordedAtMs: 1_000 }]);
        storage.read();

        expect(calls).toBe(1);
    });
});
