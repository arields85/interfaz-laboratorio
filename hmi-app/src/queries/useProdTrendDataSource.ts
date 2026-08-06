import type { ActivityAnalyticsQueryDraft, ActivityAnalyticsResponse } from '../domain/activityAnalytics.types';
import type { ProdTrendConfiguredMode, ProdTrendDataSource } from '../domain/prodTrendDataMode.types';
import { resolveProdTrendConfiguredMode } from '../utils/prodTrendDataMode';
import { useActivitySeries } from './useActivitySeries';

export interface UseProdTrendDataSourceOptions {
    configuredMode: unknown;
    params: ActivityAnalyticsQueryDraft;
}

export type UseProdTrendDataSourceResult = Pick<
    ReturnType<typeof useActivitySeries>,
    'isLoading' | 'isFetching' | 'isRefreshing' | 'isEnabled'
> & {
    configuredMode: ProdTrendConfiguredMode;
    effectiveMode: ProdTrendConfiguredMode;
    source: ProdTrendDataSource | null;
    response: ActivityAnalyticsResponse | null;
    error: Error | null;
};

export function resolveProdTrendQueryParams(
    configuredMode: unknown,
    params: ActivityAnalyticsQueryDraft,
): ActivityAnalyticsQueryDraft {
    return resolveProdTrendConfiguredMode(configuredMode) === 'simulated' ? null : params;
}

export function useProdTrendDataSource(options: UseProdTrendDataSourceOptions): UseProdTrendDataSourceResult {
    const configuredMode = resolveProdTrendConfiguredMode(options.configuredMode);
    const realQuery = useActivitySeries(resolveProdTrendQueryParams(configuredMode, options.params));
    const isReal = configuredMode === 'real';
    const hasMatchingResponse = realQuery.data === null || matchesParams(options.params, realQuery.data);
    const response = isReal && hasMatchingResponse ? realQuery.data : null;
    const identityError = isReal && !hasMatchingResponse
        ? new Error('Activity-series response identity does not match the requested identity')
        : null;

    return {
        configuredMode,
        effectiveMode: configuredMode,
        source: response ? 'real' : null,
        response,
        error: isReal ? identityError ?? realQuery.error : null,
        isLoading: realQuery.isLoading,
        isFetching: realQuery.isFetching,
        isRefreshing: realQuery.isRefreshing,
        isEnabled: realQuery.isEnabled,
    };
}

function matchesParams(params: ActivityAnalyticsQueryDraft, response: ActivityAnalyticsResponse): boolean {
    if (!params || params.machineId !== response.machineId || params.range !== response.range) {
        return false;
    }

    return params.range !== 'custom'
        || (params.start === response.window.start && params.end === response.window.end);
}
