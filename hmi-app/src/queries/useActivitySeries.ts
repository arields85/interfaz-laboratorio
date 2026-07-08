import { keepPreviousData, useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { adaptActivitySeries } from '../adapters/activitySeries.adapter';
import { ActivitySeriesAdapterError } from '../adapters/activitySeries.adapter';
import { isDataActivitySeriesEnabled } from '../config/dataConnection.config';
import type { ActivityAnalyticsQueryDraft, ActivityAnalyticsResponse } from '../domain/activityAnalytics.types';
import { DataServiceError } from '../services/dataOverview.service';
import { fetchActivitySeries } from '../services/activitySeries.service';
import { validateAndNormalizeActivitySeriesQueryParams } from '../utils/activitySeriesQueryValidation';

export const ACTIVITY_SERIES_QUERY_KEY_PREFIX = ['data', 'activity-series'] as const;
type ActivitySeriesQueryKey = ReturnType<typeof createActivitySeriesQueryKey>;
type ActivitySeriesQueryOptions = Pick<UseQueryOptions<ActivityAnalyticsResponse, Error, ActivityAnalyticsResponse, ActivitySeriesQueryKey>, 'queryKey' | 'queryFn' | 'placeholderData' | 'staleTime' | 'retry' | 'refetchOnWindowFocus'> & {
    enabled: boolean;
};

export interface UseActivitySeriesResult {
    data: ActivityAnalyticsResponse | null;
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
    isEnabled: boolean;
    isFetching: boolean;
    isPlaceholderData: boolean;
    isRefreshing: boolean;
}

export function useActivitySeries(params: ActivityAnalyticsQueryDraft): UseActivitySeriesResult {
    const queryOptions = createActivitySeriesQueryOptions(params);
    const query = useQuery<ActivityAnalyticsResponse, Error, ActivityAnalyticsResponse, ActivitySeriesQueryKey>(queryOptions);
    const isFetching = queryOptions.enabled ? query.isFetching : false;
    const isPlaceholderData = queryOptions.enabled ? query.isPlaceholderData : false;

    return {
        data: query.data ?? null,
        isLoading: queryOptions.enabled ? query.isLoading : false,
        isError: queryOptions.enabled ? query.isError : false,
        error: queryOptions.enabled ? toActivitySeriesUiError(query.error) : null,
        isEnabled: queryOptions.enabled,
        isFetching,
        isPlaceholderData,
        isRefreshing: isFetching && isPlaceholderData,
    };
}

export function createActivitySeriesQueryKey(params: ActivityAnalyticsQueryDraft) {
    const normalizedParams = normalizeActivitySeriesQueryParams(params);

    return buildActivitySeriesQueryKey(normalizedParams);
}

export function createActivitySeriesQueryOptions(params: ActivityAnalyticsQueryDraft): ActivitySeriesQueryOptions {
    const normalizedParams = normalizeActivitySeriesQueryParams(params);
    const enabled = normalizedParams !== null && isDataActivitySeriesEnabled();

    return {
        queryKey: buildActivitySeriesQueryKey(normalizedParams),
        queryFn: async () => {
            if (!normalizedParams) {
                throw new Error('Activity-series query params are required');
            }

            const raw = await fetchActivitySeries(normalizedParams);
            return adaptActivitySeries(raw);
        },
        enabled,
        placeholderData: keepPreviousData,
        staleTime: 30_000,
        retry: (failureCount, error) => shouldRetryActivitySeriesQuery(failureCount, error),
        refetchOnWindowFocus: true,
    };
}

function buildActivitySeriesQueryKey(normalizedParams: ReturnType<typeof normalizeActivitySeriesQueryParams>) {
    return [
        ...ACTIVITY_SERIES_QUERY_KEY_PREFIX,
        normalizedParams?.machineId ?? null,
        normalizedParams?.range ?? null,
        normalizedParams?.range === 'custom' ? normalizedParams.start : null,
        normalizedParams?.range === 'custom' ? normalizedParams.end : null,
    ] as const;
}

function normalizeActivitySeriesQueryParams(params: ActivityAnalyticsQueryDraft) {
    const validation = validateAndNormalizeActivitySeriesQueryParams(params);
    return validation.ok ? validation.params : null;
}

function toActivitySeriesUiError(error: Error | null): Error | null {
    if (!error) {
        return null;
    }

    if (error instanceof DataServiceError) {
        if (typeof error.statusCode === 'number' && error.statusCode >= 500) {
            return new DataServiceError('Activity-series data is temporarily unavailable', error.statusCode);
        }

        if (typeof error.statusCode === 'number' && error.statusCode >= 400) {
            return new DataServiceError('Activity-series request could not be completed', error.statusCode);
        }
    }

    return error;
}

function shouldRetryActivitySeriesQuery(failureCount: number, error: Error | null): boolean {
    if (error instanceof ActivitySeriesAdapterError) {
        return false;
    }

    if (error instanceof DataServiceError && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
        return false;
    }

    return failureCount < 2;
}
