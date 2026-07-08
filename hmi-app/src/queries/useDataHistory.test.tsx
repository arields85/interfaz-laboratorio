import { describe, expect, it, vi, afterEach } from 'vitest';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { adaptDataHistory } from '../adapters/dataHistory.adapter';
import { isDataHistoryEnabled } from '../config/dataConnection.config';
import { fetchDataHistory } from '../services/dataHistory.service';
import {
    DATA_HISTORY_QUERY_KEY_PREFIX,
    createDataHistoryQueryKey,
    createDataHistoryQueryOptions,
    useDataHistory,
} from './useDataHistory';

vi.mock('@tanstack/react-query', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@tanstack/react-query')>();

    return {
        ...actual,
        useQuery: vi.fn(),
    };
});

vi.mock('../config/dataConnection.config', () => ({
    isDataHistoryEnabled: vi.fn(),
}));

vi.mock('../services/dataHistory.service', () => ({
    fetchDataHistory: vi.fn(),
}));

vi.mock('../adapters/dataHistory.adapter', () => ({
    adaptDataHistory: vi.fn(),
}));

describe('useDataHistory', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('disables the query when params are null', () => {
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: false,
            error: null,
        } as never);

        const result = useDataHistory(null);

        expect(DATA_HISTORY_QUERY_KEY_PREFIX).toEqual(['data', 'history']);
        expect(useQuery).toHaveBeenCalledWith(
            expect.objectContaining({
                queryKey: [...DATA_HISTORY_QUERY_KEY_PREFIX, null, null, null, null, null, null],
                enabled: false,
                staleTime: 30_000,
            })
        );
        expect(useQuery).toHaveBeenCalledWith(
            expect.not.objectContaining({
                refetchInterval: expect.anything(),
            })
        );
        expect(result).toEqual({
            data: null,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: false,
            isFetching: false,
            isPlaceholderData: false,
            isRefreshing: false,
        });
    });

    it('builds the expected query and adapts the fetched payload when enabled', async () => {
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: {
                machineId: 7,
                variableKey: 'pressure',
            },
            isLoading: false,
            isError: false,
            error: null,
        } as never);

        const params = { machineId: 7, variableKey: 'pressure', range: 'dia' as const };
        const raw = { raw: true };
        const adapted = {
            contractVersion: '1.0.0',
            machineId: 7,
            variableKey: 'pressure',
            range: 'dia' as const,
            unit: 'bar',
            series: [],
            summary: { last: null, min: null, max: null, avg: null },
        };

        vi.mocked(fetchDataHistory).mockResolvedValue(raw);
        vi.mocked(adaptDataHistory).mockReturnValue(adapted);

        const result = useDataHistory(params);
        const queryOptions = vi.mocked(useQuery).mock.calls[0]?.[0];

        expect(queryOptions).toEqual(
            expect.objectContaining({
                queryKey: ['data', 'history', 7, 'pressure', 'dia', null, null, null],
                enabled: true,
                staleTime: 30_000,
            })
        );

        await expect(queryOptions?.queryFn?.()).resolves.toEqual(adapted);
        expect(fetchDataHistory).toHaveBeenCalledWith(params, undefined);
        expect(adaptDataHistory).toHaveBeenCalledWith(raw);
        expect(result).toEqual({
            data: { machineId: 7, variableKey: 'pressure' },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
            isFetching: false,
            isPlaceholderData: false,
            isRefreshing: false,
        });
    });

    it('reuses exported query helpers and exposes previous-data refresh metadata', () => {
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: { machineId: 7, variableKey: 'pressure', range: '24h' },
            isLoading: false,
            isError: false,
            error: null,
            isFetching: true,
            isPlaceholderData: true,
        } as never);

        const params = { machineId: 7, variableKey: 'pressure', range: '24h' as const, maxPoints: 750 };
        const queryKey = createDataHistoryQueryKey(params);
        const queryOptions = createDataHistoryQueryOptions(params);
        const result = useDataHistory(params);

        expect(queryKey).toEqual(['data', 'history', 7, 'pressure', '24h', null, null, 750]);
        expect(queryOptions).toEqual(expect.objectContaining({
            queryKey,
            enabled: true,
            placeholderData: keepPreviousData,
        }));
        expect(vi.mocked(useQuery).mock.calls[0]?.[0]).toEqual(expect.objectContaining({
            queryKey,
            enabled: true,
            placeholderData: keepPreviousData,
        }));
        expect(result).toMatchObject({
            isFetching: true,
            isPlaceholderData: true,
            isRefreshing: true,
        });
    });

    it('passes react-query abort signals through exported query helpers and does not label finalized data as refreshing', async () => {
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: { machineId: 11, variableKey: 'temperature', range: '24h' },
            isLoading: false,
            isError: false,
            error: null,
            isFetching: true,
            isPlaceholderData: false,
        } as never);

        const params = { machineId: 11, variableKey: 'temperature', range: '24h' as const };
        const raw = { ok: true };
        const adapted = {
            contractVersion: '1.1.0',
            machineId: 11,
            variableKey: 'temperature',
            range: '24h' as const,
            unit: '°C',
            series: [],
            summary: { last: null, min: null, max: null, avg: null },
        };
        const directFetch = vi.fn();
        const signal = new AbortController().signal;

        vi.stubGlobal('fetch', directFetch);
        vi.mocked(fetchDataHistory).mockResolvedValue(raw);
        vi.mocked(adaptDataHistory).mockReturnValue(adapted);

        const queryOptions = createDataHistoryQueryOptions(params);
        const result = useDataHistory(params);

        await expect(queryOptions.queryFn?.({ queryKey: queryOptions.queryKey, signal, meta: undefined, client: undefined as never, pageParam: undefined, direction: 'forward' })).resolves.toEqual(adapted);
        expect(fetchDataHistory).toHaveBeenCalledWith(params, signal);
        expect(directFetch).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            isFetching: true,
            isPlaceholderData: false,
            isRefreshing: false,
        });
    });

    it('preserves stale data metadata on refresh failure without labeling it as a successful refresh', () => {
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: { machineId: 11, variableKey: 'temperature', range: '24h' },
            isLoading: false,
            isError: true,
            error: new Error('refresh failed'),
            isFetching: false,
            isPlaceholderData: false,
        } as never);

        const result = useDataHistory({ machineId: 11, variableKey: 'temperature', range: '24h' });

        expect(result).toMatchObject({
            data: { machineId: 11, variableKey: 'temperature', range: '24h' },
            isError: true,
            isFetching: false,
            isPlaceholderData: false,
            isRefreshing: false,
        });
        expect(result.error).toEqual(new Error('refresh failed'));
    });

    it('separates custom V2 history queries in the cache key and forwards start/end/maxPoints to the service', async () => {
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: {
                machineId: 7,
                variableKey: 'pressure',
                range: 'custom',
            },
            isLoading: false,
            isError: false,
            error: null,
        } as never);

        const params = {
            machineId: 7,
            variableKey: 'pressure',
            range: 'custom' as const,
            start: '2026-06-18T10:00:00.000Z',
            end: '2026-06-18T12:00:00.000Z',
            maxPoints: 1500,
        };
        const raw = { raw: true };
        const adapted = {
            contractVersion: '1.1.0',
            machineId: 7,
            variableKey: 'pressure',
            range: 'custom' as const,
            unit: 'bar',
            window: {
                start: '2026-06-18T10:00:00.000Z',
                end: '2026-06-18T12:00:00.000Z',
            },
            series: [],
            summary: { last: null, min: null, max: null, avg: null },
        };

        vi.mocked(fetchDataHistory).mockResolvedValue(raw);
        vi.mocked(adaptDataHistory).mockReturnValue(adapted as never);

        useDataHistory(params);
        const queryOptions = vi.mocked(useQuery).mock.calls[0]?.[0];

        expect(queryOptions).toEqual(
            expect.objectContaining({
                queryKey: [
                    'data',
                    'history',
                    7,
                    'pressure',
                    'custom',
                    '2026-06-18T10:00:00.000Z',
                    '2026-06-18T12:00:00.000Z',
                    1500,
                ],
                enabled: true,
            })
        );

        await expect(queryOptions?.queryFn?.()).resolves.toEqual(adapted);
        expect(fetchDataHistory).toHaveBeenCalledWith(params, undefined);
        expect(adaptDataHistory).toHaveBeenCalledWith(raw);
    });

    it('normalizes finite maxPoints in the query key before hitting the service boundary', async () => {
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: false,
            error: null,
        } as never);

        const params = {
            machineId: 7,
            variableKey: 'pressure',
            range: '24h' as const,
            maxPoints: 9999,
        };

        useDataHistory(params);
        const queryOptions = vi.mocked(useQuery).mock.calls[0]?.[0];

        expect(queryOptions).toEqual(
            expect.objectContaining({
                queryKey: ['data', 'history', 7, 'pressure', '24h', null, null, 2000],
            })
        );

        await queryOptions?.queryFn?.();
        expect(fetchDataHistory).toHaveBeenCalledWith({
            ...params,
            maxPoints: 2000,
        }, undefined);
    });

    it('disables invalid custom V2 windows before the service boundary', () => {
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: false,
            error: null,
        } as never);

        const result = useDataHistory({
            machineId: 7,
            variableKey: 'pressure',
            range: 'custom',
            start: '2026-06-18T12:00:00.000Z',
            end: '2026-06-18T10:00:00.000Z',
            maxPoints: 1500,
        });

        expect(vi.mocked(useQuery).mock.calls[0]?.[0]).toEqual(
            expect.objectContaining({
                queryKey: [...DATA_HISTORY_QUERY_KEY_PREFIX, null, null, null, null, null, null],
                enabled: false,
            })
        );
        expect(fetchDataHistory).not.toHaveBeenCalled();
        expect(result.isEnabled).toBe(false);
    });

    it('disables Date.parse-permissive custom V2 windows before the service boundary', () => {
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: false,
            error: null,
        } as never);

        const result = useDataHistory({
            machineId: 7,
            variableKey: 'pressure',
            range: 'custom',
            start: '06/18/2026 10:00',
            end: '2026-06-18T12:00:00.000Z',
            maxPoints: 1500,
        });

        expect(vi.mocked(useQuery).mock.calls[0]?.[0]).toEqual(
            expect.objectContaining({
                queryKey: [...DATA_HISTORY_QUERY_KEY_PREFIX, null, null, null, null, null, null],
                enabled: false,
            })
        );
        expect(fetchDataHistory).not.toHaveBeenCalled();
        expect(result.isEnabled).toBe(false);
    });

    it('disables impossible ISO-looking custom V2 windows before the service boundary', () => {
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: false,
            error: null,
        } as never);

        const result = useDataHistory({
            machineId: 7,
            variableKey: 'pressure',
            range: 'custom',
            start: '2026-02-30T00:00:00.000Z',
            end: '2026-03-02T00:00:00.000Z',
            maxPoints: 1500,
        });

        expect(vi.mocked(useQuery).mock.calls[0]?.[0]).toEqual(
            expect.objectContaining({
                queryKey: [...DATA_HISTORY_QUERY_KEY_PREFIX, null, null, null, null, null, null],
                enabled: false,
            })
        );
        expect(fetchDataHistory).not.toHaveBeenCalled();
        expect(result.isEnabled).toBe(false);
    });

    it('disables oversized custom V2 windows before the service boundary', () => {
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: false,
            error: null,
        } as never);

        const result = useDataHistory({
            machineId: 7,
            variableKey: 'pressure',
            range: 'custom',
            start: '2025-01-01T00:00:00.000Z',
            end: '2026-01-02T00:00:00.000Z',
            maxPoints: 1500,
        });

        expect(vi.mocked(useQuery).mock.calls[0]?.[0]).toEqual(
            expect.objectContaining({
                queryKey: [...DATA_HISTORY_QUERY_KEY_PREFIX, null, null, null, null, null, null],
                enabled: false,
            })
        );
        expect(fetchDataHistory).not.toHaveBeenCalled();
        expect(result.isEnabled).toBe(false);
    });

    it('disables invalid machine ids before the service boundary', () => {
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: false,
            error: null,
        } as never);

        const result = useDataHistory({
            machineId: -1,
            variableKey: 'pressure',
            range: '24h',
            maxPoints: 1500,
        });

        expect(vi.mocked(useQuery).mock.calls[0]?.[0]).toEqual(
            expect.objectContaining({
                queryKey: [...DATA_HISTORY_QUERY_KEY_PREFIX, null, null, null, null, null, null],
                enabled: false,
            })
        );
        expect(fetchDataHistory).not.toHaveBeenCalled();
        expect(result.isEnabled).toBe(false);
    });

    it('disables invalid variable keys before the service boundary', () => {
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: false,
            error: null,
        } as never);

        const result = useDataHistory({
            machineId: 7,
            variableKey: 'bad\u0000key',
            range: '24h',
            maxPoints: 1500,
        });

        expect(vi.mocked(useQuery).mock.calls[0]?.[0]).toEqual(
            expect.objectContaining({
                queryKey: [...DATA_HISTORY_QUERY_KEY_PREFIX, null, null, null, null, null, null],
                enabled: false,
            })
        );
        expect(fetchDataHistory).not.toHaveBeenCalled();
        expect(result.isEnabled).toBe(false);
    });

    it('disables invalid non-custom ranges before the service boundary', () => {
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: false,
            error: null,
        } as never);

        const result = useDataHistory({
            machineId: 7,
            variableKey: 'pressure',
            range: 'not-supported' as never,
            maxPoints: 1500,
        });

        expect(vi.mocked(useQuery).mock.calls[0]?.[0]).toEqual(
            expect.objectContaining({
                queryKey: [...DATA_HISTORY_QUERY_KEY_PREFIX, null, null, null, null, null, null],
                enabled: false,
            })
        );
        expect(fetchDataHistory).not.toHaveBeenCalled();
        expect(result.isEnabled).toBe(false);
    });
});
