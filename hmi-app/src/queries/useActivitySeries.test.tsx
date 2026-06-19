import { afterEach, describe, expect, it, vi } from 'vitest';

import { useQuery } from '@tanstack/react-query';
import { ActivitySeriesAdapterError, adaptActivitySeries } from '../adapters/activitySeries.adapter';
import { isDataActivitySeriesEnabled } from '../config/dataConnection.config';
import { DataServiceError } from '../services/dataOverview.service';
import { fetchActivitySeries } from '../services/activitySeries.service';
import { ACTIVITY_SERIES_QUERY_KEY_PREFIX, useActivitySeries } from './useActivitySeries';

vi.mock('@tanstack/react-query', () => ({
    useQuery: vi.fn(),
}));

vi.mock('../config/dataConnection.config', () => ({
    isDataActivitySeriesEnabled: vi.fn(),
}));

vi.mock('../services/activitySeries.service', () => ({
    fetchActivitySeries: vi.fn(),
}));

vi.mock('../adapters/activitySeries.adapter', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../adapters/activitySeries.adapter')>();

    return {
        ...actual,
        adaptActivitySeries: vi.fn(),
    };
});

describe('useActivitySeries', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('disables the query when machineId is missing or the endpoint is disabled', () => {
        vi.mocked(isDataActivitySeriesEnabled).mockReturnValue(false);
        vi.mocked(useQuery).mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: false,
            error: null,
        } as never);

        const result = useActivitySeries({ machineId: undefined, range: '24h' });

        expect(ACTIVITY_SERIES_QUERY_KEY_PREFIX).toEqual(['data', 'activity-series']);
        expect(vi.mocked(useQuery).mock.calls[0]?.[0]).toEqual(
            expect.objectContaining({
                queryKey: [...ACTIVITY_SERIES_QUERY_KEY_PREFIX, null, null, null, null],
                enabled: false,
            })
        );
        expect(fetchActivitySeries).not.toHaveBeenCalled();
        expect(result.isEnabled).toBe(false);
    });

    it('never reports loading when the query is disabled by invalid params even if react-query stays pending', () => {
        vi.mocked(isDataActivitySeriesEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: undefined,
            isLoading: true,
            isError: false,
            error: null,
        } as never);

        const result = useActivitySeries({ machineId: 'FT2000' as unknown as number, range: '24h' });

        expect(vi.mocked(useQuery).mock.calls[0]?.[0]).toEqual(
            expect.objectContaining({
                queryKey: [...ACTIVITY_SERIES_QUERY_KEY_PREFIX, null, null, null, null],
                enabled: false,
            }),
        );
        expect(result.isEnabled).toBe(false);
        expect(result.isLoading).toBe(false);
    });

    it('builds the expected query key and adapts the fetched activity payload', async () => {
        vi.mocked(isDataActivitySeriesEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: { purpose: 'activity-analytics' },
            isLoading: false,
            isError: false,
            error: null,
        } as never);

        const params = { machineId: 7, range: '24h' as const };
        const raw = { ok: true };
        const adapted = { purpose: 'activity-analytics', window: { bucketMs: 300000 }, series: [] };

        vi.mocked(fetchActivitySeries).mockResolvedValue(raw);
        vi.mocked(adaptActivitySeries).mockReturnValue(adapted as never);

        const result = useActivitySeries(params);
        const queryOptions = vi.mocked(useQuery).mock.calls[0]?.[0];

        expect(queryOptions).toEqual(
            expect.objectContaining({
                queryKey: ['data', 'activity-series', 7, '24h', null, null],
                enabled: true,
            })
        );

        await expect(queryOptions?.queryFn?.()).resolves.toEqual(adapted);
        expect(fetchActivitySeries).toHaveBeenCalledWith(params);
        expect(adaptActivitySeries).toHaveBeenCalledWith(raw);
        expect(result.isEnabled).toBe(true);
    });

    it('sanitizes ui-facing query errors before returning them to consumers', () => {
        vi.mocked(isDataActivitySeriesEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: true,
            error: new DataServiceError('InfluxDB timeout from Node-RED stack trace', 500),
        } as never);

        const result = useActivitySeries({ machineId: 7, range: '24h' });

        expect(result.error).toEqual(new DataServiceError('Activity-series data is temporarily unavailable', 500));
    });

    it('does not retry sanitized backend validation errors that should surface immediately', () => {
        vi.mocked(isDataActivitySeriesEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: false,
            error: null,
        } as never);

        useActivitySeries({ machineId: 7, range: '24h' });
        const queryOptions = vi.mocked(useQuery).mock.calls[0]?.[0];

        expect(queryOptions?.retry?.(0, new DataServiceError('Activity-series request could not be completed', 400))).toBe(false);
        expect(queryOptions?.retry?.(0, new DataServiceError('Activity-series data is temporarily unavailable', 500))).toBe(true);
        expect(queryOptions?.retry?.(0, new Error('Activity-series response window is invalid'))).toBe(true);
    });

    it('does not retry adapter contract failures so the widget can surface the error immediately', () => {
        vi.mocked(isDataActivitySeriesEnabled).mockReturnValue(true);
        vi.mocked(useQuery).mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: false,
            error: null,
        } as never);

        useActivitySeries({ machineId: 7, range: '24h' });
        const queryOptions = vi.mocked(useQuery).mock.calls[0]?.[0];

        expect(queryOptions?.retry?.(0, new ActivitySeriesAdapterError('Activity-series response purpose must be "activity-analytics"'))).toBe(false);
    });
});
