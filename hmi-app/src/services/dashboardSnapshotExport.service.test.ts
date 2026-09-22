import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nameBoundary = vi.hoisted(() => {
    const refused: string[] = [];
    const refuseFetch: typeof fetch = async (path) => {
        refused.push(String(path));
        throw new Error('TEST_NETWORK_REFUSED');
    };
    vi.stubGlobal('fetch', refuseFetch);
    return { refused, refuseFetch, read: vi.fn(() => ({ ok: true as const, name: null as string | null })) };
});
// Keep local storage outside exporter tests; capture uses the real exporter and client.
vi.mock('./hmiName.service', () => ({ readHmiName: nameBoundary.read }));

import { prismaSessionClient } from './prismaSessionClient';

import {
    exportDashboardSnapshot,
    resetDashboardSnapshotExportStateForTests,
    startDashboardSnapshotExporter,
} from './dashboardSnapshotExport.service';

describe('dashboardSnapshotExport.service', () => {
    beforeEach(() => {
        nameBoundary.read.mockReset().mockReturnValue({ ok: true, name: null });
        vi.stubGlobal('fetch', nameBoundary.refuseFetch);
        vi.useFakeTimers();
        prismaSessionClient.reset({ close: false });
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        resetDashboardSnapshotExportStateForTests();
        expect(nameBoundary.refused).toEqual([]);
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('attaches the current local name to a copied snapshot at each capture', async () => {
        const snapshot = Object.freeze({ timestamp: '2026-07-07T10:00:00.000Z', widgets: [] });
        const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
        const publish = vi.spyOn(prismaSessionClient, 'publishContext');
        const getSnapshot = vi.fn(() => snapshot);
        nameBoundary.read.mockReturnValue({ ok: true, name: 'Panel recepción' });
        const stop = startDashboardSnapshotExporter({ getSnapshot, fetchImpl: fetchMock });

        await vi.advanceTimersByTimeAsync(5_000);
        const first = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(first).toEqual({
            version: 1, command: 'publish', order: expect.any(Number),
            // One frame per exporter instance, reused across routine ticks.
            frameGeneration: expect.any(Number),
            snapshot: { ...snapshot, hmiName: 'Panel recepción' },
        });
        expect(publish.mock.calls[0]?.[1]).not.toBe(snapshot);
        expect(snapshot).not.toHaveProperty('hmiName');

        nameBoundary.read.mockReturnValue({ ok: true, name: null });
        await vi.advanceTimersByTimeAsync(5_000);
        const cleared = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
        expect(cleared.snapshot).toEqual({ ...snapshot, hmiName: null });
        expect(cleared.order).toBeGreaterThan(first.order);
        expect(getSnapshot).toHaveBeenCalledTimes(2);
        expect(snapshot).not.toHaveProperty('hmiName');
        stop();
    });

    it('posts snapshots only to the fixed same-origin route', async () => {
        const fetchMock = vi.fn<typeof fetch>(async () => ({ ok: true, status: 202 } as Response));
        vi.stubGlobal('fetch', fetchMock);
        const snapshot = { timestamp: '2026-07-07T10:00:00.000Z', widgets: [] };

        await expect(exportDashboardSnapshot(snapshot, undefined, fetchMock)).resolves.toBe(true);

        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/prisma/snapshot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: expect.any(String),
            signal: expect.any(AbortSignal),
        });
        const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(body).toEqual({ version: 1, command: 'publish', order: expect.any(Number), snapshot });
        expect(Number.isSafeInteger(body.order)).toBe(true);
        expect(body.order).toBeGreaterThan(0);
    });

    it('keeps HTTP and network failures nonfatal and observable', async () => {
        const failures: CustomEvent[] = [];
        window.addEventListener('hmi:snapshot-export-failed', (event) => failures.push(event as CustomEvent));
        const fetchMock = vi.fn(async () => ({ ok: false, status: 503 } as Response));

        await expect(exportDashboardSnapshot({ widgets: [] }, undefined, fetchMock)).resolves.toBe(false);

        expect(failures[0]?.detail).toEqual({
            reason: 'request-failed',
            status: 503,
            url: '/api/prisma/snapshot',
        });
    });

    it('times out and aborts a hanging request', async () => {
        let signal: AbortSignal | undefined;
        const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
            signal = init?.signal;
            return new Promise<Response>((_resolve, reject) => {
                signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            });
        });
        const request = exportDashboardSnapshot({ widgets: [] }, undefined, fetchMock);

        await vi.advanceTimersByTimeAsync(4_500);

        await expect(request).resolves.toBe(false);
        expect(signal?.aborted).toBe(true);
    });

    it('keeps one request in flight and retries on the next completed interval', async () => {
        let resolveFirst!: (response: Response) => void;
        const fetchMock = vi.fn()
            .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirst = resolve; }))
            .mockResolvedValue({ ok: true, status: 202 } as Response);
        vi.stubGlobal('fetch', fetchMock);
        const getSnapshot = vi.fn(() => ({ widgets: [] }));
        const stop = startDashboardSnapshotExporter({ intervalMs: 1_000, getSnapshot, fetchImpl: fetchMock });

        await vi.advanceTimersByTimeAsync(2_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        resolveFirst({ ok: true, status: 202 } as Response);
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        stop();
    });

    it('releases scheduled single-flight ownership after timeout and retries on the next interval', async () => {
        const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
            fetchMock.mock.calls.length === 1
                ? new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
                })
                : Promise.resolve({ ok: true, status: 202 } as Response)
        ));
        vi.stubGlobal('fetch', fetchMock);
        const stop = startDashboardSnapshotExporter({ intervalMs: 1_000, getSnapshot: () => ({ widgets: [] }), fetchImpl: fetchMock });

        await vi.advanceTimersByTimeAsync(1_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(4_500);
        await vi.advanceTimersByTimeAsync(500);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        stop();
    });

    it.each(['hidden', 'offline'] as const)('invalidates immediately on %s and recovers only from a new capture', async (reason) => {
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 202 }));
        let value = 'before';
        const getSnapshot = vi.fn(() => ({ widgets: [], value }));
        const stop = startDashboardSnapshotExporter({ getSnapshot, fetchImpl: fetchMock });
        await vi.advanceTimersByTimeAsync(5_000);
        expect(getSnapshot).toHaveBeenCalledOnce();
        const first = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(first.command).toBe('publish');

        if (reason === 'hidden') {
            vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
            document.dispatchEvent(new Event('visibilitychange'));
        } else {
            vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
            window.dispatchEvent(new Event('offline'));
        }
        await vi.advanceTimersByTimeAsync(0);
        const invalidation = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
        expect(invalidation).toEqual({ version: 1, command: 'invalidate', order: first.order + 1 });
        const hiddenCalls = fetchMock.mock.calls.length;
        await vi.advanceTimersByTimeAsync(10_000);
        expect(fetchMock).toHaveBeenCalledTimes(hiddenCalls);
        expect(getSnapshot).toHaveBeenCalledOnce();

        value = 'after';
        if (reason === 'hidden') {
            vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
            document.dispatchEvent(new Event('visibilitychange'));
        } else {
            vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
            window.dispatchEvent(new Event('online'));
        }
        await vi.advanceTimersByTimeAsync(5_000);
        const recovered = fetchMock.mock.calls.slice(hiddenCalls).map(([, init]) => JSON.parse(String(init?.body)));
        expect(recovered.length).toBeGreaterThan(0);
        expect(recovered.every(body => body.command === 'publish' && body.snapshot.value === 'after')).toBe(true);
        expect(recovered[0].order).toBeGreaterThan(invalidation.order);
        stop();
    });

    it('stop invalidation has its own bounded signal and an old stop cannot invalidate its replacement', async () => {
        const fetchMock = vi.fn<typeof fetch>().mockImplementation((_path, init) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }));
        const oldStop = startDashboardSnapshotExporter({ getSnapshot: () => ({ widgets: [], value: 'old' }), fetchImpl: fetchMock });
        await vi.advanceTimersByTimeAsync(5_000);
        const oldPublishSignal = fetchMock.mock.calls[0]?.[1]?.signal;
        const nextStop = startDashboardSnapshotExporter({ getSnapshot: () => ({ widgets: [], value: 'new' }), fetchImpl: fetchMock });
        await vi.advanceTimersByTimeAsync(0);
        expect(oldPublishSignal?.aborted).toBe(true);
        const invalidationCall = fetchMock.mock.calls.find(([, init]) => JSON.parse(String(init?.body)).command === 'invalidate');
        expect(invalidationCall).toBeDefined();
        const invalidationSignal = invalidationCall?.[1]?.signal;
        expect(invalidationSignal).not.toBe(oldPublishSignal);
        expect(invalidationSignal?.aborted).toBe(false);
        const callsBeforeOldStop = fetchMock.mock.calls.length;
        oldStop();
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchMock).toHaveBeenCalledTimes(callsBeforeOldStop);
        await vi.advanceTimersByTimeAsync(4_500);
        expect(invalidationSignal?.aborted).toBe(true);
        await vi.advanceTimersByTimeAsync(500);
        const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
        expect(bodies.at(-1)?.snapshot.value).toBe('new');
        expect(bodies.map(body => body.order)).toEqual([
            bodies[0].order, bodies[0].order + 1, bodies[0].order + 2,
        ]);
        nextStop();
        await vi.advanceTimersByTimeAsync(4_500);
    });

    it('never retries a timed-out body after capture changes', async () => {
        let value = 'old';
        const fetchMock = vi.fn<typeof fetch>().mockImplementation((_path, init) => {
            if (fetchMock.mock.calls.length === 1) {
                return new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
                });
            }
            return Promise.resolve(new Response(null, { status: 202 }));
        });
        const stop = startDashboardSnapshotExporter({ getSnapshot: () => ({ widgets: [], value }), fetchImpl: fetchMock });
        await vi.advanceTimersByTimeAsync(5_000);
        value = 'new';
        await vi.advanceTimersByTimeAsync(5_000);
        const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
        expect(bodies.map(body => body.snapshot.value)).toEqual(['old', 'new']);
        expect(bodies[1].order).toBeGreaterThan(bodies[0].order);
        stop();
    });

    it('reset preserves the session-client order and the next interval captures anew', async () => {
        let value = 'old';
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 202 }));
        const getSnapshot = vi.fn(() => ({ widgets: [], value }));
        const stop = startDashboardSnapshotExporter({ getSnapshot, fetchImpl: fetchMock });
        await vi.advanceTimersByTimeAsync(5_000);
        prismaSessionClient.reset({ close: false });
        value = 'new';
        await vi.advanceTimersByTimeAsync(5_000);
        const published = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
            .filter(body => body.command === 'publish');
        expect(published.map(body => body.snapshot.value)).toEqual(['old', 'new']);
        expect(published[1].order).toBeGreaterThan(published[0].order);
        expect(getSnapshot).toHaveBeenCalledTimes(2);
        stop();
    });

    it.each(['reset', 'replacement'] as const)('drops a capture whose local authority changed during getSnapshot (%s)', async (change) => {
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 202 }));
        let first = true;
        let replacementStop: (() => void) | undefined;
        const stop = startDashboardSnapshotExporter({
            fetchImpl: fetchMock,
            getSnapshot: () => {
                if (!first) return { widgets: [], value: 'fresh' };
                first = false;
                if (change === 'reset') {
                    prismaSessionClient.reset({ close: false });
                } else {
                    replacementStop = startDashboardSnapshotExporter({
                        fetchImpl: fetchMock, getSnapshot: () => ({ widgets: [], value: 'fresh' }),
                    });
                }
                return { widgets: [], value: 'stale-capture' };
            },
        });
        await vi.advanceTimersByTimeAsync(5_000);
        const publications = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
            .filter(body => body.command === 'publish');
        expect(publications()).toEqual([]);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(publications()).toHaveLength(1);
        expect(publications()[0].snapshot.value).toBe('fresh');
        stop();
        replacementStop?.();
    });

    it('reuses one frame generation across ticks and mints a greater one per instance', async () => {
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 202 }));
        let tick = 0;
        const stop = startDashboardSnapshotExporter({
            intervalMs: 5_000,
            getSnapshot: () => ({ widgets: [], tick: tick++ }),
            fetchImpl: fetchMock,
        });
        await vi.advanceTimersByTimeAsync(10_000);
        const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
        expect(bodies).toHaveLength(2);
        expect(bodies[0].frameGeneration).toEqual(expect.any(Number));
        // Different snapshot objects, same visit identity: no per-tick minting.
        expect(bodies[1].frameGeneration).toBe(bodies[0].frameGeneration);
        stop();
        await vi.advanceTimersByTimeAsync(0);

        const nextStop = startDashboardSnapshotExporter({
            intervalMs: 5_000,
            getSnapshot: () => ({ widgets: [], tick: 'next-instance' }),
            fetchImpl: fetchMock,
        });
        await vi.advanceTimersByTimeAsync(5_000);
        const nextBodies = fetchMock.mock.calls.slice(bodies.length + 1)
            .map(([, init]) => JSON.parse(String(init?.body)));
        expect(nextBodies[0].command).toBe('publish');
        expect(nextBodies[0].frameGeneration).toBeGreaterThan(bodies[0].frameGeneration);
        nextStop();
    });

    it('reuses the instance frame after a session reset onto the fresh server document', async () => {
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 202 }));
        let value = 'before';
        const stop = startDashboardSnapshotExporter({
            intervalMs: 5_000,
            getSnapshot: () => ({ widgets: [], value }),
            fetchImpl: fetchMock,
        });
        await vi.advanceTimersByTimeAsync(5_000);
        const first = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        prismaSessionClient.reset({ close: false });
        value = 'after';
        await vi.advanceTimersByTimeAsync(5_000);
        const published = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
            .filter(body => body.command === 'publish');
        expect(published).toHaveLength(2);
        expect(published[1].frameGeneration).toBe(first.frameGeneration);
        stop();
    });

    it('replaces the previous exporter and aborts its request', async () => {
        const signals: AbortSignal[] = [];
        const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
            signals.push(init?.signal as AbortSignal);
            return new Promise<Response>(() => undefined);
        });
        const firstStop = startDashboardSnapshotExporter({ intervalMs: 1_000, getSnapshot: () => ({ first: true }), fetchImpl: fetchMock });
        await vi.advanceTimersByTimeAsync(1_000);

        const secondStop = startDashboardSnapshotExporter({ intervalMs: 1_000, getSnapshot: () => ({ second: true }), fetchImpl: fetchMock });

        expect(signals[0]?.aborted).toBe(true);
        firstStop();
        secondStop();
    });
});
