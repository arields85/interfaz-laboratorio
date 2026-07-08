import { afterEach, describe, expect, it, vi } from 'vitest';

import * as dataConnectionConfig from '../config/dataConnection.config';
import type { DataHistoryResponse, DataHistoryResponseV2 } from '../domain/dataContract.types';
import { DataServiceError } from './dataOverview.service';
import {
    DATA_HISTORY_REQUEST_TIMEOUT_MS,
    DataHistoryServiceError,
    fetchDataHistory,
} from './dataHistory.service';

describe('dataHistory.service', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('throws a typed error when the history url is not configured', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(null);

        await expect(
            fetchDataHistory({ machineId: 7, variableKey: 'pressure', range: 'hora' })
        ).rejects.toEqual(new DataServiceError('Data history URL is not configured'));
    });

    it('preserves legacy ranges in transport queries while preserving the configured endpoint', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(
            'https://api.local/api/hmi/history'
        );

        const payload: DataHistoryResponse = {
            contractVersion: '1.0.0',
            machineId: 7,
            variableKey: 'flow rate',
            range: 'hora',
            unit: 'L/min',
            series: [{ timestamp: '2026-04-22T10:00:00Z', value: 12.5 }],
            summary: { last: 12.5, min: 10, max: 13, avg: 11.8 },
        };

        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue(payload),
        });

        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchDataHistory({ machineId: 7, variableKey: 'flow rate', range: 'hora' })
        ).resolves.toEqual(payload);

        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.local/api/hmi/history?machineId=7&variableKey=flow+rate&range=hora',
            expect.objectContaining({
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: expect.any(AbortSignal),
            })
        );
    });

    it('preserves V2 preset ranges as V2 transport queries', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(
            'https://api.local/api/hmi/history'
        );

        const payload: DataHistoryResponseV2 = {
            contractVersion: '1.1.0',
            machineId: 7,
            variableKey: 'flow rate',
            range: '24h',
            unit: 'L/min',
            series: [{ timestamp: '2026-06-18T10:00:00.000Z', timestampMs: 1750240800000, value: 12.5 }],
            summary: { last: 12.5, min: 10, max: 13, avg: 11.8 },
        };

        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue(payload),
        });

        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchDataHistory({ machineId: 7, variableKey: 'flow rate', range: '24h', maxPoints: 2500 })
        ).resolves.toEqual(payload);

        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.local/api/hmi/history?machineId=7&variableKey=flow+rate&range=24h&maxPoints=2000',
            expect.objectContaining({
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: expect.any(AbortSignal),
            })
        );
    });

    it('serializes V2 custom query params as read-only GET requests with explicit boundaries', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(
            'https://api.local/api/hmi/history'
        );

        const payload: DataHistoryResponseV2 = {
            contractVersion: '1.1.0',
            machineId: 7,
            variableKey: 'flow rate',
            range: 'custom',
            unit: 'L/min',
            window: {
                start: '2026-06-18T10:00:00.000Z',
                end: '2026-06-18T12:00:00.000Z',
            },
            series: [{ timestamp: '2026-06-18T10:00:00.000Z', timestampMs: 1750240800000, value: 12.5 }],
            summary: { last: 12.5, min: 10, max: 13, avg: 11.8 },
        };

        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue(payload),
        });

        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchDataHistory({
                machineId: 7,
                variableKey: 'flow rate',
                range: 'custom',
                start: '2026-06-18T10:00:00.000Z',
                end: '2026-06-18T12:00:00.000Z',
                maxPoints: 50,
            })
        ).resolves.toEqual(payload);

        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.local/api/hmi/history?machineId=7&variableKey=flow+rate&range=custom&start=2026-06-18T10%3A00%3A00.000Z&end=2026-06-18T12%3A00%3A00.000Z&maxPoints=100',
            expect.objectContaining({
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: expect.any(AbortSignal),
            })
        );
    });

    it('forwards an optional external AbortSignal while preserving the GET-only request shape', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(
            'https://api.local/api/hmi/history'
        );

        const externalAbortController = new AbortController();
        const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
        }));

        vi.stubGlobal('fetch', fetchMock);

        const request = fetchDataHistory({ machineId: 7, variableKey: 'flow rate', range: '24h' }, externalAbortController.signal);

        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.local/api/hmi/history?machineId=7&variableKey=flow+rate&range=24h',
            expect.objectContaining({
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: expect.any(AbortSignal),
            })
        );
        const passedSignal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
        expect(passedSignal.aborted).toBe(false);

        externalAbortController.abort();

        expect(passedSignal.aborted).toBe(true);
        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('keeps every history transport path strictly read-only with no request body', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(
            'https://api.local/api/hmi/history'
        );

        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ contractVersion: '1.1.0', machineId: 7, variableKey: 'flow rate', range: '24h', unit: 'L/min', series: [], summary: { last: null, min: null, max: null, avg: null } }),
        });

        vi.stubGlobal('fetch', fetchMock);

        await fetchDataHistory({ machineId: 7, variableKey: 'flow rate', range: '24h', maxPoints: 250 });

        const init = fetchMock.mock.calls[0]?.[1] as RequestInit;

        expect(init.method).toBe('GET');
        expect(init.body).toBeUndefined();
        expect(init.headers).toEqual({ Accept: 'application/json' });
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('rejects invalid machine ids before a backend request is sent', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(
            'https://api.local/api/hmi/history'
        );

        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchDataHistory({ machineId: -1, variableKey: 'flow rate', range: '24h' })
        ).rejects.toEqual(new DataServiceError('History query must use a non-negative integer machineId'));

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects invalid variable keys before a backend request is sent', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(
            'https://api.local/api/hmi/history'
        );

        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchDataHistory({ machineId: 7, variableKey: '  ', range: '24h' })
        ).rejects.toEqual(new DataServiceError('History query must use a safe non-empty variableKey'));

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects invalid non-custom ranges before a backend request is sent', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(
            'https://api.local/api/hmi/history'
        );

        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchDataHistory({ machineId: 7, variableKey: 'flow rate', range: 'invalid-range' as never })
        ).rejects.toEqual(new DataServiceError('History query must use a supported range'));

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('trims safe variable keys before backend serialization', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(
            'https://api.local/api/hmi/history'
        );

        const payload: DataHistoryResponseV2 = {
            contractVersion: '1.1.0',
            machineId: 7,
            variableKey: 'flow rate',
            range: '24h',
            unit: 'L/min',
            series: [{ timestamp: '2026-06-18T10:00:00.000Z', timestampMs: 1750240800000, value: 12.5 }],
            summary: { last: 12.5, min: 10, max: 13, avg: 11.8 },
        };

        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue(payload),
        });

        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchDataHistory({ machineId: 7, variableKey: '  flow rate  ', range: '24h' })
        ).resolves.toEqual(payload);

        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.local/api/hmi/history?machineId=7&variableKey=flow+rate&range=24h',
            expect.objectContaining({
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: expect.any(AbortSignal),
            })
        );
    });

    it('rejects invalid custom timestamps before a backend request is sent', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(
            'https://api.local/api/hmi/history'
        );

        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchDataHistory({
                machineId: 7,
                variableKey: 'flow rate',
                range: 'custom',
                start: 'not-a-date',
                end: '2026-06-18T12:00:00.000Z',
            })
        ).rejects.toEqual(new DataServiceError('Custom history window must use valid timestamps'));

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects Date.parse-permissive custom timestamps before a backend request is sent', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(
            'https://api.local/api/hmi/history'
        );

        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchDataHistory({
                machineId: 7,
                variableKey: 'flow rate',
                range: 'custom',
                start: '06/18/2026 10:00',
                end: '2026-06-18T12:00:00.000Z',
            })
        ).rejects.toEqual(new DataServiceError('Custom history window must use valid timestamps'));

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects impossible ISO-looking custom timestamps before a backend request is sent', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(
            'https://api.local/api/hmi/history'
        );

        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchDataHistory({
                machineId: 7,
                variableKey: 'flow rate',
                range: 'custom',
                start: '2026-02-30T00:00:00.000Z',
                end: '2026-03-02T00:00:00.000Z',
            })
        ).rejects.toEqual(new DataServiceError('Custom history window must use valid timestamps'));

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects custom windows where start is not before end', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(
            'https://api.local/api/hmi/history'
        );

        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchDataHistory({
                machineId: 7,
                variableKey: 'flow rate',
                range: 'custom',
                start: '2026-06-18T12:00:00.000Z',
                end: '2026-06-18T12:00:00.000Z',
            })
        ).rejects.toEqual(new DataServiceError('Custom history window must have start before end'));

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects custom windows longer than the 12-month frontend guardrail', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(
            'https://api.local/api/hmi/history'
        );

        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchDataHistory({
                machineId: 7,
                variableKey: 'flow rate',
                range: 'custom',
                start: '2025-01-01T00:00:00.000Z',
                end: '2026-01-02T00:00:00.000Z',
            })
        ).rejects.toEqual(new DataServiceError('Custom history window must be 365 days or less'));

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('wraps network failures in a typed service error', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(
            'https://api.local/api/hmi/history'
        );
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')));

        await expect(
            fetchDataHistory({ machineId: 7, variableKey: 'pressure', range: 'hora' })
        ).rejects.toEqual(
            new DataHistoryServiceError('Network error fetching data history', 'network')
        );
    });

    it('aborts unreachable requests and classifies them as timeout errors', async () => {
        vi.useFakeTimers();
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(
            'https://api.local/api/hmi/history'
        );
        vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })));

        const request = fetchDataHistory({ machineId: 7, variableKey: 'pressure', range: 'hora' });
        const expectation = expect(request).rejects.toEqual(
            new DataHistoryServiceError('Data history request timed out', 'timeout')
        );

        await vi.advanceTimersByTimeAsync(DATA_HISTORY_REQUEST_TIMEOUT_MS);

        await expectation;
    });

    it('exposes the upstream status code when the history fetch fails', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(
            'https://api.local/api/hmi/history'
        );
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable',
            })
        );

        await expect(
            fetchDataHistory({ machineId: 7, variableKey: 'pressure', range: 'hora' })
        ).rejects.toEqual(new DataHistoryServiceError('Data history data is temporarily unavailable', 'http', 503));
    });

    it('sanitizes 4xx history failures into a generic client error', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataHistoryUrl').mockReturnValue(
            'https://api.local/api/hmi/history'
        );
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: false,
                status: 422,
                statusText: 'Unprocessable Entity',
            })
        );

        await expect(
            fetchDataHistory({ machineId: 7, variableKey: 'pressure', range: 'hora' })
        ).rejects.toEqual(new DataHistoryServiceError('Data history request could not be completed', 'http', 422));
    });
});
