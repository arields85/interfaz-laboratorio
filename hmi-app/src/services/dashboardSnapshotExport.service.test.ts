import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    exportDashboardSnapshot,
    exportPrismaLocalSnapshot,
    resetDashboardSnapshotExportStateForTests,
    startPrismaLocalSnapshotExporter,
} from './dashboardSnapshotExport.service';

const {
    getDataSnapshotExportUrlMock,
    isDataSnapshotExportEnabledMock,
} = vi.hoisted(() => ({
    getDataSnapshotExportUrlMock: vi.fn(),
    isDataSnapshotExportEnabledMock: vi.fn(),
}));

vi.mock('../config/dataConnection.config', () => ({
    getDataSnapshotExportUrl: getDataSnapshotExportUrlMock,
    isDataSnapshotExportEnabled: isDataSnapshotExportEnabledMock,
}));

describe('exportDashboardSnapshot', () => {
    const fetchMock = vi.fn();
    const failureEvents: CustomEvent[] = [];
    const handleFailureEvent = (event: Event) => {
        failureEvents.push(event as CustomEvent);
    };

    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', fetchMock);
        isDataSnapshotExportEnabledMock.mockReturnValue(true);
        getDataSnapshotExportUrlMock.mockReturnValue('https://node-red.local/hmi/current-snapshot');
        failureEvents.length = 0;
        window.addEventListener('hmi:snapshot-export-failed', handleFailureEvent as EventListener);
    });

    afterEach(() => {
        resetDashboardSnapshotExportStateForTests();
        window.removeEventListener('hmi:snapshot-export-failed', handleFailureEvent as EventListener);
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        fetchMock.mockReset();
        getDataSnapshotExportUrlMock.mockReset();
        isDataSnapshotExportEnabledMock.mockReset();
    });

    it('posts the snapshot JSON to the configured Node-RED url', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 202,
        });

        const snapshot = { timestamp: '2026-07-07T10:00:00.000Z', widgets: [] };

        await expect(exportDashboardSnapshot(snapshot)).resolves.toBe(true);

        expect(fetchMock).toHaveBeenCalledWith(
            'https://node-red.local/hmi/current-snapshot',
            expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(snapshot),
                signal: expect.any(AbortSignal),
            }),
        );
    });

    it('warns and skips the request when snapshot export is disabled or unconfigured', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        isDataSnapshotExportEnabledMock.mockReturnValue(false);
        getDataSnapshotExportUrlMock.mockReturnValue(null);

        await expect(exportDashboardSnapshot({ timestamp: '2026-07-07T10:00:00.000Z', widgets: [] })).resolves.toBe(false);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(
            '[dashboard-snapshot-export] Snapshot export skipped: feature disabled or endpoint missing.',
        );
        expect(failureEvents).toHaveLength(1);
        expect(failureEvents[0]).toMatchObject({
            type: 'hmi:snapshot-export-failed',
            detail: {
                reason: 'disabled-missing-endpoint',
                status: null,
                url: null,
            },
        });
    });

    it('warns and swallows network failures so the viewer never breaks', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        fetchMock.mockRejectedValue(new Error('network down'));

        await expect(exportDashboardSnapshot({ timestamp: '2026-07-07T10:00:00.000Z', widgets: [] })).resolves.toBe(false);

        expect(warnSpy).toHaveBeenCalledWith(
            '[dashboard-snapshot-export] Snapshot export failed.',
            expect.any(Error),
        );
        expect(failureEvents[0]).toMatchObject({
            type: 'hmi:snapshot-export-failed',
            detail: {
                reason: 'request-failed',
                status: null,
                url: 'https://node-red.local/hmi/current-snapshot',
            },
        });
    });

    it('times out a slow export with a controlled warning and no throw', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        fetchMock.mockImplementation((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'));
            });
        }));

        const exportPromise = exportDashboardSnapshot({ timestamp: '2026-07-07T10:00:00.000Z', widgets: [] });

        await vi.advanceTimersByTimeAsync(4_500);

        await expect(exportPromise).resolves.toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(
            '[dashboard-snapshot-export] Snapshot export timed out.',
            expect.objectContaining({ name: 'AbortError' }),
        );
        expect(failureEvents[0]).toMatchObject({
            type: 'hmi:snapshot-export-failed',
            detail: {
                reason: 'timeout',
                status: null,
                url: 'https://node-red.local/hmi/current-snapshot',
            },
        });
    });

    it('classifies custom abort reasons triggered by the timeout watchdog as timeouts', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        fetchMock.mockImplementation((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
                reject(init.signal?.reason ?? new Error('aborted'));
            });
        }));

        const exportPromise = exportDashboardSnapshot({ timestamp: '2026-07-07T10:00:00.000Z', widgets: [] });

        await vi.advanceTimersByTimeAsync(4_500);

        await expect(exportPromise).resolves.toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(
            '[dashboard-snapshot-export] Snapshot export timed out.',
            expect.any(Error),
        );
        expect(failureEvents[0]).toMatchObject({
            type: 'hmi:snapshot-export-failed',
            detail: {
                reason: 'timeout',
                status: null,
                url: 'https://node-red.local/hmi/current-snapshot',
            },
        });
    });

    it('includes the HTTP status in the failure event when the export endpoint rejects the request', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        fetchMock.mockResolvedValue({
            ok: false,
            status: 503,
        });

        await expect(exportDashboardSnapshot({ timestamp: '2026-07-07T10:00:00.000Z', widgets: [] })).resolves.toBe(false);

        expect(warnSpy).toHaveBeenCalledWith(
            '[dashboard-snapshot-export] Snapshot export failed.',
            expect.objectContaining({ status: 503 }),
        );
        expect(failureEvents[0]).toMatchObject({
            type: 'hmi:snapshot-export-failed',
            detail: {
                reason: 'request-failed',
                status: 503,
                url: 'https://node-red.local/hmi/current-snapshot',
            },
        });
    });

    it('keeps only one export request active until the first unresolved request finishes', async () => {
        let resolveFetch: ((value: { ok: boolean; status: number }) => void) | null = null;
        fetchMock.mockImplementation(() => new Promise((resolve) => {
            resolveFetch = resolve;
        }));

        const firstExportPromise = exportDashboardSnapshot({ timestamp: '2026-07-07T10:00:00.000Z', widgets: [] });

        await Promise.resolve();

        await expect(exportDashboardSnapshot({ timestamp: '2026-07-07T10:00:01.000Z', widgets: [] })).resolves.toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        resolveFetch?.({ ok: true, status: 202 });
        await expect(firstExportPromise).resolves.toBe(true);

        fetchMock.mockResolvedValueOnce({ ok: true, status: 202 });
        await expect(exportDashboardSnapshot({ timestamp: '2026-07-07T10:00:02.000Z', widgets: [] })).resolves.toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('releases the in-flight guard after the timeout fallback even when fetch never settles', async () => {
        const originalAbortController = globalThis.AbortController;
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        vi.stubGlobal('AbortController', undefined);
        fetchMock.mockImplementation(() => new Promise(() => undefined));

        const firstExportPromise = exportDashboardSnapshot({ timestamp: '2026-07-07T10:00:00.000Z', widgets: [] });

        await vi.advanceTimersByTimeAsync(4_500);
        await expect(firstExportPromise).resolves.toBe(false);

        fetchMock.mockResolvedValueOnce({ ok: true, status: 202 });
        await expect(exportDashboardSnapshot({ timestamp: '2026-07-07T10:00:01.000Z', widgets: [] })).resolves.toBe(true);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(warnSpy).toHaveBeenCalledWith(
            '[dashboard-snapshot-export] Snapshot export timed out.',
            expect.any(Error),
        );

        vi.stubGlobal('AbortController', originalAbortController);
    });

    it('posts local snapshots to the exact loopback endpoint even when central export is disabled', async () => {
        isDataSnapshotExportEnabledMock.mockReturnValue(false);
        getDataSnapshotExportUrlMock.mockReturnValue(null);
        fetchMock.mockResolvedValue({ ok: true, status: 202 });

        const snapshot = { timestamp: '2026-07-07T10:00:00.000Z', widgets: [{ id: 'current-widget' }] };

        await expect(exportPrismaLocalSnapshot(snapshot)).resolves.toBe(true);

        expect(fetchMock).toHaveBeenCalledWith(
            'http://127.0.0.1:5057/hmi/current-snapshot',
            expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(snapshot),
                signal: expect.any(AbortSignal),
            }),
        );
        expect(getDataSnapshotExportUrlMock).not.toHaveBeenCalled();
    });

    it('keeps local non-202 responses non-fatal and retryable', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 503 });

        await expect(exportPrismaLocalSnapshot({ timestamp: '2026-07-07T10:00:00.000Z', widgets: [] })).resolves.toBe(false);

        expect(failureEvents).toHaveLength(1);
        expect(failureEvents[0]).toMatchObject({
            type: 'hmi:snapshot-export-failed',
            detail: {
                reason: 'request-failed',
                status: 503,
                url: 'http://127.0.0.1:5057/hmi/current-snapshot',
            },
        });
    });

    it('times out a hanging local request without blocking the next scheduled retry', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        fetchMock.mockImplementation((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }));

        const stop = startPrismaLocalSnapshotExporter({
            revision: 3,
            getSnapshot: () => ({ timestamp: '2026-07-07T10:00:00.000Z', widgets: [] }),
        });

        await vi.advanceTimersByTimeAsync(5_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(4_500);

        expect(warnSpy).toHaveBeenCalledWith(
            '[dashboard-snapshot-export] Snapshot export timed out.',
            expect.objectContaining({ name: 'AbortError' }),
        );

        await vi.advanceTimersByTimeAsync(5_000);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        stop();
    });

    it('owns one five-second schedule and aborts the previous request before replacement', async () => {
        let resolveFetch: ((value: { ok: boolean; status: number }) => void) | null = null;
        fetchMock.mockImplementation((_url: string, init?: RequestInit) => new Promise((resolve) => {
            resolveFetch = resolve;
            init?.signal?.addEventListener('abort', () => undefined);
        }));

        const getFirstSnapshot = vi.fn(() => ({ timestamp: '2026-07-07T10:00:00.000Z', widgets: [{ id: 'first' }] }));
        const stopFirst = startPrismaLocalSnapshotExporter({ revision: 1, getSnapshot: getFirstSnapshot });

        await vi.advanceTimersByTimeAsync(4_999);
        expect(fetchMock).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const firstSignal = (fetchMock.mock.calls[0]?.[1] as RequestInit).signal;

        const getSecondSnapshot = vi.fn(() => ({ timestamp: '2026-07-07T10:00:05.000Z', widgets: [{ id: 'second' }] }));
        const stopSecond = startPrismaLocalSnapshotExporter({ revision: 2, getSnapshot: getSecondSnapshot });

        expect(firstSignal?.aborted).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        resolveFetch?.({ ok: true, status: 202 });
        await Promise.resolve();

        await vi.advanceTimersByTimeAsync(5_000);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string)).toEqual({
            timestamp: '2026-07-07T10:00:05.000Z',
            widgets: [{ id: 'second' }],
        });

        stopFirst();
        stopSecond();
        expect((fetchMock.mock.calls[1]?.[1] as RequestInit).signal?.aborted).toBe(true);
    });
});
