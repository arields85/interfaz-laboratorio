import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminAuthError } from './adminAuth.service';
import {
    SHARED_CONFIG_CACHE_KEY,
    SHARED_CONFIG_POLL_INTERVAL_MS,
    createSharedConfigStorage,
} from './sharedConfigStorage.service';
import {
    MAX_SHARED_CONFIG_BATCH_OPERATIONS,
    MAX_SHARED_CONFIG_VALUE_BYTES,
    SHARED_CONFIG_KEYS,
    type SharedConfigBatch,
} from '../domain/sharedConfig.types';

const DEBOUNCE_MS = 50;
const LOAD_TIMEOUT_MS = 1_000;

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function createMemoryCache(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
        data,
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => { data.set(key, value); },
    };
}

function createHarness(options: {
    items?: Record<string, string>;
    revision?: number;
    cache?: Record<string, string>;
    legacy?: Record<string, string>;
} = {}) {
    const server = {
        revision: options.revision ?? 0,
        items: { ...(options.items ?? {}) } as Record<string, string>,
        reachable: true,
        hang: false,
        writeError: null as AdminAuthError | null,
        gate: null as Promise<void> | null,
    };
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
        const path = String(input);
        if (server.hang) {
            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            });
        }
        if (!server.reachable) throw new TypeError('network down');
        if (path === '/api/leda/hmi-config/revision') return jsonResponse({ ok: true, revision: server.revision });
        if (path === '/api/leda/hmi-config') {
            return jsonResponse({ ok: true, revision: server.revision, items: server.items });
        }
        throw new Error(`unexpected request ${path}`);
    });
    const writeSharedConfig = vi.fn(async (batch: SharedConfigBatch) => {
        if (server.gate) await server.gate;
        if (server.writeError) throw server.writeError;
        Object.assign(server.items, batch.set);
        for (const key of batch.delete) delete server.items[key];
        server.revision += 1;
        return { revision: server.revision };
    });
    const cache = createMemoryCache(options.cache);
    const legacy = createMemoryCache(options.legacy);
    const storage = createSharedConfigStorage({
        fetcher,
        adminClient: { writeSharedConfig },
        cache,
        legacyStorage: legacy,
        pollIntervalMs: SHARED_CONFIG_POLL_INTERVAL_MS,
        debounceMs: DEBOUNCE_MS,
        loadTimeoutMs: LOAD_TIMEOUT_MS,
    });
    return { server, fetcher, writeSharedConfig, cache, legacy, storage };
}

function documentFetches(fetcher: ReturnType<typeof createHarness>['fetcher']): number {
    return fetcher.mock.calls.filter(([path]) => String(path) === '/api/leda/hmi-config').length;
}

describe('sharedConfigStorage', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    describe('load', () => {
        it('reads the server document and records the source, revision and cache copy', async () => {
            const { storage, cache } = createHarness({ items: { 'hmi:a': '1' }, revision: 4 });

            await storage.load();

            expect(storage.getItem('hmi:a')).toBe('1');
            expect(storage.getItem('hmi:missing')).toBeNull();
            expect(storage.getStatus()).toMatchObject({ loaded: true, source: 'server', revision: 4, saveError: null });
            expect(JSON.parse(cache.data.get(SHARED_CONFIG_CACHE_KEY) ?? 'null')).toEqual({
                version: 1, revision: 4, items: { 'hmi:a': '1' },
            });
        });

        it('falls back to the cached copy when the server is unreachable', async () => {
            const cached = JSON.stringify({ version: 1, revision: 7, items: { 'hmi:a': 'cached' } });
            const { storage, server } = createHarness({ cache: { [SHARED_CONFIG_CACHE_KEY]: cached } });
            server.reachable = false;

            await storage.load();

            expect(storage.getItem('hmi:a')).toBe('cached');
            expect(storage.getStatus()).toMatchObject({ loaded: true, source: 'cache', revision: 7 });
        });

        it('falls back to the cache when the server answers with an invalid payload', async () => {
            const cached = JSON.stringify({ version: 1, revision: 2, items: { 'hmi:a': 'cached' } });
            const harness = createHarness({ cache: { [SHARED_CONFIG_CACHE_KEY]: cached } });
            harness.fetcher.mockResolvedValueOnce(jsonResponse({ ok: true, revision: 'x', items: {} }));

            await harness.storage.load();

            expect(harness.storage.getStatus().source).toBe('cache');
            expect(harness.storage.getItem('hmi:a')).toBe('cached');
        });

        it('falls back to the cache when the server hangs past the load timeout', async () => {
            const cached = JSON.stringify({ version: 1, revision: 2, items: { 'hmi:a': 'cached' } });
            const { storage, server } = createHarness({ cache: { [SHARED_CONFIG_CACHE_KEY]: cached } });
            server.hang = true;

            const loading = storage.load();
            await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
            await loading;

            expect(storage.getStatus().source).toBe('cache');
        });

        it('starts empty when the server is down and there is no usable cache', async () => {
            const { storage, server, cache } = createHarness({ cache: { [SHARED_CONFIG_CACHE_KEY]: '{not json' } });
            server.reachable = false;

            await storage.load();

            expect(storage.getItem('hmi:a')).toBeNull();
            expect(storage.getStatus()).toMatchObject({ loaded: true, source: 'empty', revision: null });
            expect(cache.data.get(SHARED_CONFIG_CACHE_KEY)).toBe('{not json');
        });
    });

    describe('synchronous adapter', () => {
        it('reflects local writes immediately, before the server answers', async () => {
            const { storage } = createHarness({ items: { 'hmi:a': '1' } });
            await storage.load();

            storage.setItem('hmi:a', '2');
            storage.setItem('hmi:b', '3');
            expect(storage.getItem('hmi:a')).toBe('2');
            expect(storage.getItem('hmi:b')).toBe('3');

            storage.removeItem('hmi:a');
            expect(storage.getItem('hmi:a')).toBeNull();
            expect(storage.getStatus().unsavedKeyCount).toBe(2);
        });

        it('rejects keys and values the server would refuse, surfacing a save error', async () => {
            const { storage, writeSharedConfig } = createHarness();
            await storage.load();

            storage.setItem('bad key', '1');
            expect(storage.getStatus().saveError).toMatchObject({ code: 'SHARED_CONFIG_INVALID_KEY' });
            expect(storage.getItem('bad key')).toBeNull();

            storage.setItem('hmi:big', 'x'.repeat(MAX_SHARED_CONFIG_VALUE_BYTES + 1));
            expect(storage.getStatus().saveError).toMatchObject({ code: 'SHARED_CONFIG_VALUE_TOO_LARGE' });
            expect(storage.getItem('hmi:big')).toBeNull();

            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
            expect(writeSharedConfig).not.toHaveBeenCalled();
        });

        it('rejects a value whose escaped form would exceed the request bound, before queueing it', async () => {
            const { storage, writeSharedConfig } = createHarness();
            await storage.load();

            // Under the raw value limit, but every control character escapes to six bytes.
            const escapeHeavy = '\u0001'.repeat(MAX_SHARED_CONFIG_VALUE_BYTES);
            storage.setItem('hmi:escaped', escapeHeavy);

            expect(storage.getStatus().saveError).toMatchObject({ code: 'SHARED_CONFIG_VALUE_TOO_LARGE' });
            expect(storage.getItem('hmi:escaped')).toBeNull();
            expect(storage.getStatus().unsavedKeyCount).toBe(0);
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
            expect(writeSharedConfig).not.toHaveBeenCalled();
        });
    });

    describe('writes', () => {
        it('batches consecutive writes into one request where the last write per key wins', async () => {
            const { storage, writeSharedConfig, server } = createHarness({ items: { 'hmi:keep': 'k', 'hmi:gone': 'g' }, revision: 1 });
            await storage.load();

            storage.setItem('hmi:a', '1');
            storage.setItem('hmi:a', '2');
            storage.setItem('hmi:tmp', 'x');
            storage.removeItem('hmi:tmp');
            storage.removeItem('hmi:gone');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

            expect(writeSharedConfig).toHaveBeenCalledTimes(1);
            expect(writeSharedConfig).toHaveBeenCalledWith({
                set: { 'hmi:a': '2' },
                delete: expect.arrayContaining(['hmi:tmp', 'hmi:gone']),
            });
            expect(server.items).toEqual({ 'hmi:keep': 'k', 'hmi:a': '2' });
            expect(storage.getStatus()).toMatchObject({ saving: false, unsavedKeyCount: 0, saveError: null, revision: 2 });
        });

        it('updates the cache copy only after the server acknowledged the write', async () => {
            const { storage, cache } = createHarness({ items: { 'hmi:a': '1' }, revision: 1 });
            await storage.load();

            storage.setItem('hmi:a', '2');
            expect(JSON.parse(cache.data.get(SHARED_CONFIG_CACHE_KEY) ?? '{}').items).toEqual({ 'hmi:a': '1' });

            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
            expect(JSON.parse(cache.data.get(SHARED_CONFIG_CACHE_KEY) ?? '{}')).toMatchObject({
                revision: 2, items: { 'hmi:a': '2' },
            });
        });

        it('surfaces a failed save, keeps the value visible and resends it on retry', async () => {
            const { storage, server, writeSharedConfig } = createHarness({ revision: 1 });
            await storage.load();
            const statuses: Array<string | null> = [];
            storage.subscribeStatus(() => statuses.push(storage.getStatus().saveError?.code ?? null));
            server.writeError = new AdminAuthError('CSRF_VALIDATION_FAILED', 403);

            storage.setItem('hmi:a', '1');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

            expect(storage.getStatus().saveError).toEqual({ code: 'CSRF_VALIDATION_FAILED', status: 403 });
            expect(storage.getStatus()).toMatchObject({ saving: false, unsavedKeyCount: 1 });
            expect(storage.getItem('hmi:a')).toBe('1');
            expect(statuses).toContain('CSRF_VALIDATION_FAILED');

            server.writeError = null;
            await storage.retrySave();

            expect(writeSharedConfig).toHaveBeenCalledTimes(2);
            expect(server.items).toEqual({ 'hmi:a': '1' });
            expect(storage.getStatus()).toMatchObject({ saveError: null, unsavedKeyCount: 0 });
        });

        it('reports an unavailable server as a save error without losing the value', async () => {
            const { storage, server } = createHarness();
            await storage.load();
            server.writeError = new AdminAuthError('AUTH_TRANSPORT_UNAVAILABLE', null);

            storage.setItem('hmi:a', '1');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

            expect(storage.getStatus().saveError).toEqual({ code: 'AUTH_TRANSPORT_UNAVAILABLE', status: null });
            expect(storage.getItem('hmi:a')).toBe('1');
        });

        it('does not let a failed batch overwrite a newer local write of the same key', async () => {
            const { storage, server } = createHarness();
            await storage.load();
            let release!: () => void;
            server.gate = new Promise<void>((resolve) => { release = resolve; });
            server.writeError = new AdminAuthError('AUTH_TRANSPORT_UNAVAILABLE', null);

            storage.setItem('hmi:a', 'old');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
            storage.setItem('hmi:a', 'new');
            release();
            await vi.advanceTimersByTimeAsync(0);
            expect(storage.getItem('hmi:a')).toBe('new');

            server.writeError = null;
            await storage.retrySave();
            expect(server.items).toEqual({ 'hmi:a': 'new' });
        });
    });

    describe('batch splitting and permanent rejections', () => {
        const operations = (batch: SharedConfigBatch) => Object.keys(batch.set).length + batch.delete.length;

        it('splits an outgoing batch to respect the operation bound', async () => {
            const { storage, writeSharedConfig, server } = createHarness();
            await storage.load();
            const total = MAX_SHARED_CONFIG_BATCH_OPERATIONS + 50;

            for (let index = 0; index < total; index += 1) storage.setItem(`hmi:k${index}`, String(index));
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

            expect(writeSharedConfig.mock.calls.map(([batch]) => operations(batch))).toEqual([MAX_SHARED_CONFIG_BATCH_OPERATIONS, 50]);
            expect(Object.keys(server.items)).toHaveLength(total);
            expect(storage.getStatus()).toMatchObject({ unsavedKeyCount: 0, saveError: null });
        });

        it('splits an outgoing batch to respect the request size bound', async () => {
            const { storage, writeSharedConfig } = createHarness();
            await storage.load();
            const big = 'x'.repeat(MAX_SHARED_CONFIG_VALUE_BYTES);

            for (let index = 0; index < 5; index += 1) storage.setItem(`hmi:big${index}`, big);
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

            expect(writeSharedConfig.mock.calls.map(([batch]) => operations(batch))).toEqual([3, 2]);
            expect(storage.getStatus()).toMatchObject({ unsavedKeyCount: 0, saveError: null });
        });

        it.each([
            ['HMI_CONFIG_DOCUMENT_TOO_LARGE', 413],
            ['HMI_CONFIG_REQUEST_TOO_LARGE', 413],
            ['HMI_CONFIG_VALUE_TOO_LARGE', 413],
            ['HMI_CONFIG_INVALID_REQUEST', 400],
        ])('drops a batch rejected as %s, keeps the error visible and lets later writes flow', async (code, status) => {
            const { storage, writeSharedConfig, server } = createHarness({ items: { 'hmi:a': 'server' }, revision: 1 });
            await storage.load();
            const changes: string[][] = [];
            storage.subscribe((change) => changes.push([...change.changedKeys]));
            server.writeError = new AdminAuthError(code, status);

            storage.setItem('hmi:a', 'poison');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

            expect(storage.getStatus().saveError).toEqual({ code, status });
            expect(storage.getStatus()).toMatchObject({ saving: false, unsavedKeyCount: 0 });
            expect(storage.getItem('hmi:a')).toBe('server');
            expect(changes).toEqual([['hmi:a']]);

            server.writeError = null;
            storage.setItem('hmi:b', 'later');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

            expect(server.items).toEqual({ 'hmi:a': 'server', 'hmi:b': 'later' });
            expect(storage.getStatus()).toMatchObject({ unsavedKeyCount: 0, saveError: { code } });
            expect(writeSharedConfig).toHaveBeenCalledTimes(2);

            await storage.retrySave();
            expect(storage.getStatus().saveError).toBeNull();
            expect(writeSharedConfig).toHaveBeenCalledTimes(2);
        });

        it('keeps sending the remaining chunks after one chunk is permanently rejected', async () => {
            const { storage, writeSharedConfig, server } = createHarness();
            await storage.load();
            writeSharedConfig.mockImplementationOnce(async () => {
                throw new AdminAuthError('HMI_CONFIG_INVALID_REQUEST', 400);
            });

            for (let index = 0; index < MAX_SHARED_CONFIG_BATCH_OPERATIONS + 10; index += 1) {
                storage.setItem(`hmi:k${index}`, String(index));
            }
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

            expect(writeSharedConfig).toHaveBeenCalledTimes(2);
            expect(Object.keys(server.items)).toHaveLength(10);
            expect(storage.getStatus()).toMatchObject({ unsavedKeyCount: 0, saveError: { code: 'HMI_CONFIG_INVALID_REQUEST' } });
        });

        it('keeps retrying transient failures, including a 5xx from the runtime', async () => {
            const { storage, server, writeSharedConfig } = createHarness();
            await storage.load();
            server.writeError = new AdminAuthError('HMI_CONFIG_UNAVAILABLE', 503);

            storage.setItem('hmi:a', '1');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
            expect(storage.getStatus()).toMatchObject({ unsavedKeyCount: 1, saveError: { code: 'HMI_CONFIG_UNAVAILABLE' } });

            server.writeError = null;
            await storage.retrySave();
            expect(writeSharedConfig).toHaveBeenCalledTimes(2);
            expect(server.items).toEqual({ 'hmi:a': '1' });
            expect(storage.getStatus()).toMatchObject({ unsavedKeyCount: 0, saveError: null });
        });
    });

    it('isolates a throwing status listener from the save flow and the other listeners', async () => {
        const { storage, server } = createHarness();
        await storage.load();
        const healthy = vi.fn();
        storage.subscribeStatus(() => { throw new Error('listener bug'); });
        storage.subscribeStatus(healthy);

        storage.setItem('hmi:a', '1');
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

        expect(server.items).toEqual({ 'hmi:a': '1' });
        expect(storage.getStatus()).toMatchObject({ saving: false, unsavedKeyCount: 0 });
        expect(healthy).toHaveBeenCalled();
    });

    describe('revision poll', () => {
        it('does nothing visible while the revision is unchanged', async () => {
            const { storage, fetcher } = createHarness({ items: { 'hmi:a': '1' }, revision: 3 });
            await storage.load();
            const listener = vi.fn();
            storage.subscribe(listener);
            storage.startPolling();

            await vi.advanceTimersByTimeAsync(SHARED_CONFIG_POLL_INTERVAL_MS * 2);

            expect(fetcher.mock.calls.filter(([path]) => String(path) === '/api/leda/hmi-config/revision')).toHaveLength(2);
            expect(documentFetches(fetcher)).toBe(1);
            expect(listener).not.toHaveBeenCalled();
        });

        it('refetches on a revision change, replaces memory, refreshes the cache and notifies subscribers', async () => {
            const { storage, server, cache } = createHarness({ items: { 'hmi:a': '1', 'hmi:b': 'b' }, revision: 3 });
            await storage.load();
            const listener = vi.fn();
            storage.subscribe(listener);
            storage.startPolling();

            server.items = { 'hmi:a': '2', 'hmi:c': 'c' };
            server.revision = 4;
            await vi.advanceTimersByTimeAsync(SHARED_CONFIG_POLL_INTERVAL_MS);

            expect(storage.getItem('hmi:a')).toBe('2');
            expect(storage.getItem('hmi:b')).toBeNull();
            expect(storage.getItem('hmi:c')).toBe('c');
            expect(storage.getStatus().revision).toBe(4);
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0]?.[0].changedKeys.slice().sort()).toEqual(['hmi:a', 'hmi:b', 'hmi:c']);
            expect(JSON.parse(cache.data.get(SHARED_CONFIG_CACHE_KEY) ?? '{}')).toMatchObject({ revision: 4 });
        });

        it('keeps unsaved local writes on top of a remote replacement', async () => {
            const { storage, server } = createHarness({ items: { 'hmi:a': '1' }, revision: 1 });
            await storage.load();
            const listener = vi.fn();
            storage.subscribe(listener);
            storage.startPolling();
            server.writeError = new AdminAuthError('AUTH_TRANSPORT_UNAVAILABLE', null);
            storage.setItem('hmi:a', 'local');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

            server.items = { 'hmi:a': 'remote', 'hmi:b': 'b' };
            server.revision = 2;
            await vi.advanceTimersByTimeAsync(SHARED_CONFIG_POLL_INTERVAL_MS);

            expect(storage.getItem('hmi:a')).toBe('local');
            expect(storage.getItem('hmi:b')).toBe('b');
            expect(listener.mock.calls[0]?.[0].changedKeys).toEqual(['hmi:b']);
        });

        it('ignores the echo of its own write', async () => {
            const { storage, fetcher } = createHarness({ items: { 'hmi:a': '1' }, revision: 1 });
            await storage.load();
            const listener = vi.fn();
            storage.subscribe(listener);
            storage.startPolling();

            storage.setItem('hmi:a', '2');
            await vi.advanceTimersByTimeAsync(SHARED_CONFIG_POLL_INTERVAL_MS * 2);

            expect(documentFetches(fetcher)).toBe(1);
            expect(storage.getItem('hmi:a')).toBe('2');
            expect(listener).not.toHaveBeenCalled();
        });

        it('refetches when another writer landed between its own revisions', async () => {
            const { storage, server, fetcher } = createHarness({ items: { 'hmi:a': '1' }, revision: 1 });
            await storage.load();
            const listener = vi.fn();
            storage.subscribe(listener);

            server.items['hmi:other'] = 'o';
            server.revision = 2;
            storage.setItem('hmi:a', '2');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

            expect(server.revision).toBe(3);
            expect(documentFetches(fetcher)).toBe(2);
            expect(storage.getItem('hmi:other')).toBe('o');
            expect(listener.mock.calls[0]?.[0].changedKeys).toEqual(['hmi:other']);
        });

        it('recovers from the cache source once the server answers again', async () => {
            const cached = JSON.stringify({ version: 1, revision: 5, items: { 'hmi:a': 'cached' } });
            const { storage, server } = createHarness({ items: { 'hmi:a': 'fresh' }, revision: 6, cache: { [SHARED_CONFIG_CACHE_KEY]: cached } });
            server.reachable = false;
            await storage.load();
            storage.startPolling();

            await vi.advanceTimersByTimeAsync(SHARED_CONFIG_POLL_INTERVAL_MS);
            expect(storage.getItem('hmi:a')).toBe('cached');

            server.reachable = true;
            await vi.advanceTimersByTimeAsync(SHARED_CONFIG_POLL_INTERVAL_MS);
            expect(storage.getItem('hmi:a')).toBe('fresh');
            expect(storage.getStatus()).toMatchObject({ source: 'server', revision: 6 });
        });

        it('stops polling and unsubscribes cleanly', async () => {
            const { storage, server, fetcher } = createHarness({ revision: 1 });
            await storage.load();
            const listener = vi.fn();
            const unsubscribe = storage.subscribe(listener);
            storage.startPolling();
            storage.stopPolling();

            server.revision = 2;
            await vi.advanceTimersByTimeAsync(SHARED_CONFIG_POLL_INTERVAL_MS * 3);
            expect(fetcher).toHaveBeenCalledTimes(1);

            unsubscribe();
            storage.startPolling();
            await vi.advanceTimersByTimeAsync(SHARED_CONFIG_POLL_INTERVAL_MS);
            expect(listener).not.toHaveBeenCalled();
            storage.stopPolling();
        });
    });

    describe('local bootstrap fallback', () => {
        const [DASHBOARDS, TEMPLATES] = SHARED_CONFIG_KEYS;
        const PER_BROWSER_KEY = 'hmi-global-settings-tab';

        it('reads the shared keys from this browser while the server was never written', async () => {
            const { storage, legacy, writeSharedConfig, cache } = createHarness({
                legacy: { [DASHBOARDS]: '[1]', [PER_BROWSER_KEY]: 'theme' },
            });

            await storage.load();

            expect(storage.getItem(DASHBOARDS)).toBe('[1]');
            expect(storage.getItem(TEMPLATES)).toBeNull();
            expect(storage.getItem(PER_BROWSER_KEY)).toBeNull();
            expect(storage.getStatus()).toMatchObject({ source: 'server', revision: 0, bootstrap: 'local-fallback' });
            expect(writeSharedConfig).not.toHaveBeenCalled();
            expect(legacy.data.get(DASHBOARDS)).toBe('[1]');
            expect(cache.data.has(SHARED_CONFIG_CACHE_KEY)).toBe(false);
        });

        it('never falls back once the server holds a revision, even for keys it lacks', async () => {
            const { storage } = createHarness({
                revision: 3,
                items: { [TEMPLATES]: '[2]' },
                legacy: { [DASHBOARDS]: '[stale]' },
            });

            await storage.load();

            expect(storage.getItem(DASHBOARDS)).toBeNull();
            expect(storage.getItem(TEMPLATES)).toBe('[2]');
            expect(storage.getStatus().bootstrap).toBeNull();
        });

        it('does not fall back when the server is unreachable', async () => {
            const { storage, server } = createHarness({ legacy: { [DASHBOARDS]: '[1]' } });
            server.reachable = false;

            await storage.load();

            expect(storage.getItem(DASHBOARDS)).toBeNull();
            expect(storage.getStatus().bootstrap).toBeNull();
        });

        it('leaves the fallback and notifies subscribers when the poll sees the first revision', async () => {
            const { storage, server } = createHarness({ legacy: { [DASHBOARDS]: '[local]', [TEMPLATES]: '[t]' } });
            await storage.load();
            const changes: string[][] = [];
            storage.subscribe(({ changedKeys }) => { changes.push([...changedKeys]); });
            storage.startPolling();

            server.revision = 1;
            server.items = { [DASHBOARDS]: '[remote]' };
            await vi.advanceTimersByTimeAsync(SHARED_CONFIG_POLL_INTERVAL_MS);

            expect(storage.getItem(DASHBOARDS)).toBe('[remote]');
            expect(storage.getItem(TEMPLATES)).toBeNull();
            expect(storage.getStatus().bootstrap).toBeNull();
            expect(changes).toHaveLength(1);
            expect(changes[0]).toEqual(expect.arrayContaining([DASHBOARDS, TEMPLATES]));
            storage.stopPolling();
        });

        it('carries the other local shared values along with the first save so none disappear', async () => {
            const { storage, server, writeSharedConfig } = createHarness({
                legacy: { [DASHBOARDS]: '[d]', [TEMPLATES]: '[t]' },
            });
            await storage.load();

            storage.setItem(TEMPLATES, '[t2]');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

            expect(writeSharedConfig).toHaveBeenCalledTimes(1);
            expect(server.items).toEqual({ [DASHBOARDS]: '[d]', [TEMPLATES]: '[t2]' });
            expect(storage.getItem(DASHBOARDS)).toBe('[d]');
            expect(storage.getStatus()).toMatchObject({ revision: 1, bootstrap: null });
        });
        it('skips an oversized legacy value when seeding and reports its key without sending it', async () => {
            const [, , THIRD] = SHARED_CONFIG_KEYS;
            const { storage, server, writeSharedConfig } = createHarness({
                legacy: {
                    [DASHBOARDS]: 'x'.repeat(MAX_SHARED_CONFIG_VALUE_BYTES + 1),
                    [TEMPLATES]: '[t]',
                },
            });
            await storage.load();

            storage.setItem(THIRD, 'v');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

            expect(writeSharedConfig).toHaveBeenCalledTimes(1);
            expect(server.items).toEqual({ [TEMPLATES]: '[t]', [THIRD]: 'v' });
            expect(storage.getStatus().saveError).toMatchObject({
                code: 'SHARED_CONFIG_VALUE_TOO_LARGE',
                keys: [DASHBOARDS],
            });
        });

        it('skips a legacy value whose escaped form exceeds one request when seeding', async () => {
            const { storage, server } = createHarness({
                legacy: { [DASHBOARDS]: '\u0001'.repeat(MAX_SHARED_CONFIG_VALUE_BYTES), [TEMPLATES]: '[t]' },
            });
            await storage.load();

            storage.setItem(TEMPLATES, '[t2]');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

            expect(server.items).toEqual({ [TEMPLATES]: '[t2]' });
            expect(storage.getStatus().saveError).toMatchObject({ keys: [DASHBOARDS] });
        });

        it('does not seed when another browser wrote the server first, and adopts its document', async () => {
            const { storage, server, writeSharedConfig, fetcher } = createHarness({
                legacy: { [DASHBOARDS]: '[local]', [TEMPLATES]: '[t-local]' },
            });
            await storage.load();
            // Another browser seeded the server after this one loaded.
            server.revision = 1;
            server.items = { [DASHBOARDS]: '[remote]' };

            storage.setItem(TEMPLATES, '[t2]');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

            expect(fetcher.mock.calls.map(([path]) => String(path))).toContain('/api/leda/hmi-config/revision');
            expect(writeSharedConfig).toHaveBeenCalledTimes(1);
            expect(writeSharedConfig.mock.calls[0][0].set).toEqual({ [TEMPLATES]: '[t2]' });
            expect(server.items).toEqual({ [DASHBOARDS]: '[remote]', [TEMPLATES]: '[t2]' });
            expect(storage.getItem(DASHBOARDS)).toBe('[remote]');
            expect(storage.getStatus().bootstrap).toBeNull();
        });

        it('keeps the edit pending with a save error when the revision re-check fails', async () => {
            const { storage, server, writeSharedConfig } = createHarness({ legacy: { [DASHBOARDS]: '[d]' } });
            await storage.load();
            server.reachable = false;

            storage.setItem(TEMPLATES, '[t]');
            await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

            expect(writeSharedConfig).not.toHaveBeenCalled();
            expect(storage.getStatus().saveError).not.toBeNull();
            expect(storage.getItem(TEMPLATES)).toBe('[t]');

            server.reachable = true;
            await storage.retrySave();
            expect(server.items).toEqual({ [DASHBOARDS]: '[d]', [TEMPLATES]: '[t]' });
        });
    });
});
