import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityAnalyticsResponse } from '../domain/activityAnalytics.types';
import { useActivitySeries } from './useActivitySeries';
import { useProdTrendDataSource } from './useProdTrendDataSource';

vi.mock('./useActivitySeries', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./useActivitySeries')>();

    return {
        ...actual,
        useActivitySeries: vi.fn(),
    };
});

const params = { machineId: 7, range: '24h' as const };
const response: ActivityAnalyticsResponse = {
    contractVersion: '1.0.0',
    machineId: 7,
    variableKey: 'Total kW',
    range: '24h',
    unit: 'kW',
    purpose: 'activity-analytics',
    window: { start: '2026-06-18T10:00:00.000Z', end: '2026-06-19T10:00:00.000Z', bucket: '1h', bucketMs: 3_600_000 },
    series: [],
    summary: null,
};

function queryResult(data: ActivityAnalyticsResponse | null, error: Error | null = null) {
    return {
        data,
        isLoading: false,
        isError: error !== null,
        error,
        isEnabled: true,
        isFetching: false,
        isPlaceholderData: false,
        isRefreshing: false,
    };
}

describe('useProdTrendDataSource', () => {
    afterEach(() => vi.clearAllMocks());

    it('keeps simulated mode synthetic-only and disables the real query', () => {
        vi.mocked(useActivitySeries).mockReturnValue(queryResult(null));

        const { result } = renderHook(() => useProdTrendDataSource({ configuredMode: 'simulated', params }));

        expect(useActivitySeries).toHaveBeenCalledWith(null);
        expect(result.current).toMatchObject({
            configuredMode: 'simulated',
            effectiveMode: 'simulated',
            source: null,
            response: null,
            error: null,
        });
    });

    it('normalizes legacy automatic to real without fallback behavior', () => {
        vi.mocked(useActivitySeries).mockReturnValue(queryResult(response));

        const { result } = renderHook(() => useProdTrendDataSource({ configuredMode: 'automatic', params }));

        expect(useActivitySeries).toHaveBeenCalledWith(params);
        expect(result.current).toMatchObject({
            configuredMode: 'real',
            effectiveMode: 'real',
            source: 'real',
            response,
            error: null,
        });
        expect(result.current).not.toHaveProperty('state');
        expect(result.current).not.toHaveProperty('retryRequested');
        expect(result.current).not.toHaveProperty('saveLastKnownGood');
    });

    it('keeps real errors real without selecting a hidden source', () => {
        const error = new Error('network unavailable');
        vi.mocked(useActivitySeries).mockReturnValue(queryResult(null, error));

        const { result } = renderHook(() => useProdTrendDataSource({ configuredMode: 'real', params }));

        expect(result.current).toMatchObject({
            configuredMode: 'real',
            effectiveMode: 'real',
            source: null,
            response: null,
            error,
        });
    });

    it('rejects a real response that does not match the requested machine', () => {
        vi.mocked(useActivitySeries).mockReturnValue(queryResult({ ...response, machineId: 8 }));

        const { result } = renderHook(() => useProdTrendDataSource({ configuredMode: 'real', params }));

        expect(result.current.source).toBeNull();
        expect(result.current.response).toBeNull();
        expect(result.current.error).toHaveProperty(
            'message',
            'Activity-series response identity does not match the requested identity',
        );
    });

    it('treats previous-key placeholder data as an in-flight refresh instead of an identity error', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            ...queryResult(response),
            isFetching: true,
            isPlaceholderData: true,
            isRefreshing: true,
        });

        const { result } = renderHook(() => useProdTrendDataSource({
            configuredMode: 'real',
            params: { machineId: 7, range: '30d' },
        }));

        expect(result.current).toMatchObject({
            source: null,
            response: null,
            error: null,
            isFetching: true,
            isRefreshing: true,
        });
    });

    it('matches custom response windows by instant rather than offset spelling', () => {
        vi.mocked(useActivitySeries).mockReturnValue(queryResult({
            ...response,
            range: 'custom',
            window: {
                ...response.window,
                start: '2026-06-18T07:00:00.000-03:00',
                end: '2026-06-19T07:00:00.000-03:00',
            },
        }));

        const { result } = renderHook(() => useProdTrendDataSource({
            configuredMode: 'real',
            params: {
                machineId: 7,
                range: 'custom',
                start: '2026-06-18T10:00:00.000Z',
                end: '2026-06-19T10:00:00.000Z',
            },
        }));

        expect(result.current.response).not.toBeNull();
        expect(result.current.error).toBeNull();
    });
});
