import type { ActivityAnalyticsQueryDraft, ActivityAnalyticsResponse } from '../domain/activityAnalytics.types';
import type { ProdTrendConfiguredMode, ProdTrendDataSource } from '../domain/prodTrendDataMode.types';
import { resolveProdTrendConfiguredMode } from '../utils/prodTrendDataMode';
import { isActivitySeriesResponseCompatible, useActivitySeries } from './useActivitySeries';

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
    const hasCompatibleResponse = realQuery.data !== null
        && isActivitySeriesResponseCompatible(options.params, realQuery.data);
    const response = isReal && hasCompatibleResponse ? realQuery.data : null;
    const identityError = isReal
        && realQuery.data !== null
        && !hasCompatibleResponse
        && !realQuery.isPlaceholderData
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
