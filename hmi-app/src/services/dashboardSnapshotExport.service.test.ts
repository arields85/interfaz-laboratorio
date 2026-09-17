import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    exportDashboardSnapshot,
    resetDashboardSnapshotExportStateForTests,
    startDashboardSnapshotExporter,
} from './dashboardSnapshotExport.service';

describe('dashboardSnapshotExport.service', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        resetDashboardSnapshotExportStateForTests();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('posts snapshots only to the fixed same-origin route', async () => {
        const fetchMock = vi.fn(async () => ({ ok: true, status: 202 } as Response));
        vi.stubGlobal('fetch', fetchMock);
        const snapshot = { timestamp: '2026-07-07T10:00:00.000Z', widgets: [] };

        await expect(exportDashboardSnapshot(snapshot)).resolves.toBe(true);

        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/prisma/snapshot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(snapshot),
            signal: expect.any(AbortSignal),
        });
    });

    it('keeps HTTP and network failures nonfatal and observable', async () => {
        const failures: CustomEvent[] = [];
        window.addEventListener('hmi:snapshot-export-failed', (event) => failures.push(event as CustomEvent));
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 } as Response)));

        await expect(exportDashboardSnapshot({ widgets: [] })).resolves.toBe(false);

        expect(failures[0]?.detail).toEqual({
            reason: 'request-failed',
            status: 503,
            url: '/api/prisma/snapshot',
        });
    });

    it('times out and aborts a hanging request', async () => {
        let signal: AbortSignal | undefined;
        vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
            signal = init?.signal;
            return new Promise<Response>((_resolve, reject) => {
                signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            });
        }));
        const request = exportDashboardSnapshot({ widgets: [] });

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
        const stop = startDashboardSnapshotExporter({ intervalMs: 1_000, getSnapshot });

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
        const stop = startDashboardSnapshotExporter({ intervalMs: 1_000, getSnapshot: () => ({ widgets: [] }) });

        await vi.advanceTimersByTimeAsync(1_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(4_500);
        await vi.advanceTimersByTimeAsync(500);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        stop();
    });

    it('replaces the previous exporter and aborts its request', async () => {
        const signals: AbortSignal[] = [];
        vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
            signals.push(init?.signal as AbortSignal);
            return new Promise<Response>(() => undefined);
        }));
        const firstStop = startDashboardSnapshotExporter({ intervalMs: 1_000, getSnapshot: () => ({ first: true }) });
        await vi.advanceTimersByTimeAsync(1_000);

        const secondStop = startDashboardSnapshotExporter({ intervalMs: 1_000, getSnapshot: () => ({ second: true }) });

        expect(signals[0]?.aborted).toBe(true);
        firstStop();
        secondStop();
    });
});
