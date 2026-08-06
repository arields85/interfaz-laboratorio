import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ActivitySeriesAdapterError } from '../adapters/activitySeries.adapter';
import type { ShiftDefinition } from '../domain/admin.types';
import type {
    ActivityAnalyticsGroupBy,
    ActivityAnalyticsQueryDraft,
    ActivityAnalyticsResponse,
    ActivityAnalyticsWindow,
} from '../domain/activityAnalytics.types';
import type {
    ProdTrendActivitySeriesIdentity,
    ProdTrendDataModeFailureReason,
    ProdTrendDataModeState,
    ProdTrendDataSource,
} from '../domain/prodTrendDataMode.types';
import { DataServiceError } from '../services/dataOverview.service';
import {
    prodTrendCaptureRepository,
    type ProdTrendCaptureRepository,
    type ProdTrendPackagedSource,
} from '../services/ProdTrendCaptureRepository';
import { createActivitySeriesIdentityKey, prodTrendLastKnownGoodStorage, type ProdTrendLastKnownGoodStorageService } from '../services/ProdTrendLastKnownGoodStorageService';
import { computeActivityAnalytics, type ComputedActivityAnalytics } from '../utils/activityAnalyticsComputation';
import {
    createInitialProdTrendDataModeState,
    resolveProdTrendConfiguredMode,
    transitionProdTrendDataMode,
} from '../widgets/resolvers/prodTrendDataModeResolver';
import { createActivitySeriesQueryKey, useActivitySeries } from './useActivitySeries';
export interface ProdTrendAnalyticsOptions {
    thresholds: { setupKw: number; prodKw: number };
    groupBy: ActivityAnalyticsGroupBy;
    shifts: ShiftDefinition[];
    timezone: string;
    window: Pick<ActivityAnalyticsWindow, 'start' | 'end' | 'bucket' | 'bucketMs'>;
    nowMs?: number;
}
export type ProdTrendVisibleResponse = ActivityAnalyticsResponse | Omit<ActivityAnalyticsResponse, 'variableKey'>;
type Commit = { source: ProdTrendDataSource; response: ProdTrendVisibleResponse; analytics: ComputedActivityAnalytics | null };
type FallbackCommit = Omit<Commit, 'source'> & { source: Exclude<ProdTrendDataSource, 'real'> };
export interface ProdTrendDataSourceController {
    modeState: ProdTrendDataModeState;
    visible: Commit | null;
    lastEventKey: string | null;
    lastError: Error | null;
    identityKey: string;
}
export interface ProdTrendDataSourceObservation {
    eventKey: string;
    configuredMode: unknown;
    identity: ProdTrendActivitySeriesIdentity;
    analyticsOptions?: ProdTrendAnalyticsOptions;
    realResponse?: ActivityAnalyticsResponse | null;
    realError?: Error | null;
    lastKnownGood?: ActivityAnalyticsResponse | null;
    lastRealSuccessAt?: number | null;
    packagedSource?: ProdTrendPackagedSource | null;
}
export interface ProdTrendDataSourceResolution {
    state: ProdTrendDataModeState;
    effectiveMode: ProdTrendDataModeState['effectiveMode'];
    source: ProdTrendDataSource | null;
    response: ProdTrendVisibleResponse | null;
    analytics: ComputedActivityAnalytics | null;
    error: Error | null;
    lastRealSuccessAt: number | null;
    retryRequested: boolean;
    saveLastKnownGood: boolean;
}
export interface UseProdTrendDataSourceOptions extends Omit<ProdTrendDataSourceObservation, 'eventKey'> {
    params: ActivityAnalyticsQueryDraft;
    lastKnownGoodStorage?: ProdTrendLastKnownGoodStorageService;
    packagedCaptureRepository?: ProdTrendCaptureRepository;
}
export type UseProdTrendDataSourceResult = ProdTrendDataSourceResolution & Pick<
    ReturnType<typeof useActivitySeries>, 'isLoading' | 'isFetching' | 'isRefreshing' | 'isEnabled'
>;
export function resolveProdTrendQueryParams(configuredMode: unknown, params: ActivityAnalyticsQueryDraft): ActivityAnalyticsQueryDraft {
    return resolveProdTrendConfiguredMode(configuredMode) === 'simulated' ? null : params;
}
export function createProdTrendDataSourceController(configuredMode: unknown, identity?: ProdTrendActivitySeriesIdentity): ProdTrendDataSourceController {
    return {
        modeState: createInitialProdTrendDataModeState(configuredMode), visible: null, lastEventKey: null, lastError: null,
        identityKey: identity ? createActivitySeriesIdentityKey(identity) : '',
    };
}
export function observeProdTrendDataSource(
    controller: ProdTrendDataSourceController,
    observation: ProdTrendDataSourceObservation,
): { controller: ProdTrendDataSourceController; result: ProdTrendDataSourceResolution } {
    const identityKey = createActivitySeriesIdentityKey(observation.identity);
    const configuredMode = resolveProdTrendConfiguredMode(observation.configuredMode);
    const scopeChanged = controller.identityKey !== identityKey || controller.modeState.configuredMode !== configuredMode;
    if (!scopeChanged && controller.lastEventKey === observation.eventKey) {
        return { controller, result: resolveResult(controller.modeState, controller.visible, controller.lastError, observation.lastRealSuccessAt ?? null, false, false) };
    }

    let state = scopeChanged ? createInitialProdTrendDataModeState(observation.configuredMode) : controller.modeState;
    let visible = scopeChanged ? null : controller.visible;
    let error: Error | null = null;
    let retryRequested = false;
    let saveLastKnownGood = false;
    const wasFallback = state.phase === 'fallback';
    const real = observation.realResponse ?? null;
    const realMatchesIdentity = real === null || matchesIdentity(observation.identity, real);
    const realError = observation.realError ?? (real && !realMatchesIdentity
        ? new Error('Activity-series response identity does not match the requested identity')
        : null);
    const hasData = real !== null && realMatchesIdentity && real.series.length > 0;

    if (state.configuredMode === 'simulated') {
        visible = null;
    } else if (realError) {
        state = transitionProdTrendDataMode(state, { type: 'real-error', reason: failureReason(realError) });
        if (state.phase === 'fallback') {
            const fallback = selectFallback(observation);
            if (fallback) {
                state = transitionProdTrendDataMode(state, { type: 'fallback-source-selected', source: fallback.source });
                visible = fallback;
            } else {
                visible = null;
                error = new Error('No matching PROD-TREND fallback source is available');
            }
        } else {
            visible = state.configuredMode === 'real' ? null : visible;
            error = realError;
        }
    } else if (real) {
        state = transitionProdTrendDataMode(state, { type: 'real-success', hasData });
        if (state.effectiveMode === 'real' && hasData) {
            visible = commit('real', real, observation.analyticsOptions);
            saveLastKnownGood = true;
        } else if (state.configuredMode === 'real') {
            visible = commit('real', real, observation.analyticsOptions);
        } else if (state.phase === 'fallback') {
            const fallback = selectFallback(observation);
            if (fallback) visible = fallback;
            else if (!wasFallback) {
                visible = null;
                error = new Error('No matching PROD-TREND fallback source is available');
            }
        } else {
            retryRequested = state.configuredMode === 'automatic' && state.emptyStreak === 1 && visible?.source === 'real';
        }
    }

    const next = { modeState: state, visible, lastEventKey: observation.eventKey, lastError: error, identityKey };
    return { controller: next, result: resolveResult(state, visible, error, observation.lastRealSuccessAt ?? null, retryRequested, saveLastKnownGood) };
}
export function useProdTrendDataSource(options: UseProdTrendDataSourceOptions): UseProdTrendDataSourceResult {
    const queryParams = resolveProdTrendQueryParams(options.configuredMode, options.params);
    const realQuery = useActivitySeries(queryParams);
    const queryClient = useQueryClient();
    const storage = options.lastKnownGoodStorage ?? prodTrendLastKnownGoodStorage;
    const captureRepository = options.packagedCaptureRepository ?? prodTrendCaptureRepository;
    const [controller, setController] = useState(() => createProdTrendDataSourceController(options.configuredMode, options.identity));
    const [loadedPackagedSource, setLoadedPackagedSource] = useState<ProdTrendPackagedSource | null>(null);
    const identityKey = useMemo(() => createActivitySeriesIdentityKey(options.identity), [options.identity]);
    // The canonical identity key is the dependency; its object shape is immutable for that key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const identity = useMemo(() => options.identity, [identityKey]);
    const configuredMode = resolveProdTrendConfiguredMode(options.configuredMode);

    useEffect(() => {
        if (configuredMode !== 'automatic') {
            return undefined;
        }

        let cancelled = false;
        void captureRepository.load(identity).then((source) => {
            if (!cancelled) setLoadedPackagedSource(source);
        }).catch(() => {
            if (!cancelled) setLoadedPackagedSource(null);
        });

        return () => {
            cancelled = true;
        };
    }, [captureRepository, configuredMode, identity, identityKey]);

    const packagedSource = options.packagedSource ?? loadedPackagedSource;
    const queryKey = useMemo(() => createActivitySeriesQueryKey(queryParams), [queryParams]);
    const queryState = queryClient.getQueryState(queryKey);
    const lastRealSuccessAt = typeof queryState?.dataUpdatedAt === 'number' && queryState.dataUpdatedAt > 0
        ? queryState.dataUpdatedAt
        : null;
    const completionId = resolveQueryCompletionId(queryState);
    const eventKey = useMemo(() => JSON.stringify({
        mode: configuredMode, queryKey, completionId,
        lastRealSuccessAt,
        packaged: packagedSource ? identityKey : 'none',
    }), [completionId, configuredMode, identityKey, lastRealSuccessAt, packagedSource, queryKey]);
    const current = observeProdTrendDataSource(controller, {
        ...options, eventKey, realResponse: realQuery.data, realError: realQuery.error,
        lastRealSuccessAt,
        lastKnownGood: options.lastKnownGood ?? storage.get(options.identity),
        packagedSource,
    });

    useEffect(() => {
        if (current.controller === controller) return;
        // Query observations are state transitions, not independent rendering state.
        setController(current.controller);
        if (current.result.saveLastKnownGood && realQuery.data) storage.save(options.identity, realQuery.data);
        if (current.result.retryRequested) void queryClient.invalidateQueries({ queryKey });
    }, [controller, current, options.identity, queryClient, queryKey, realQuery.data, storage]);

    return {
        ...current.result,
        isLoading: realQuery.isLoading, isFetching: realQuery.isFetching,
        isRefreshing: realQuery.isRefreshing, isEnabled: realQuery.isEnabled,
    };
}
function selectFallback(observation: ProdTrendDataSourceObservation): FallbackCommit | null {
    const lkg = observation.lastKnownGood;
    if (lkg && matchesIdentity(observation.identity, lkg)) return commit('last-known-good', lkg, observation.analyticsOptions);
    return selectPackaged(observation);
}
function selectPackaged(observation: ProdTrendDataSourceObservation): FallbackCommit | null {
    const packaged = observation.packagedSource;
    if (!packaged || !matchesIdentity(observation.identity, packaged.identity)) return null;
    return { source: 'packaged-capture', response: packaged.response, analytics: packaged.analytics };
}
function commit<S extends ProdTrendDataSource>(source: S, response: ProdTrendVisibleResponse, options?: ProdTrendAnalyticsOptions): Omit<Commit, 'source'> & { source: S } {
    return {
        source, response,
        analytics: options ? computeActivityAnalytics({ series: response.series, thresholds: options.thresholds, groupBy: options.groupBy, shifts: options.shifts, timezone: options.timezone, window: options.window, nowMs: options.nowMs }) : null,
    };
}
function resolveResult(state: ProdTrendDataModeState, visible: Commit | null, error: Error | null, lastRealSuccessAt: number | null, retryRequested: boolean, saveLastKnownGood: boolean): ProdTrendDataSourceResolution {
    return { state, effectiveMode: state.effectiveMode, source: visible?.source ?? null, response: visible?.response ?? null, analytics: visible?.analytics ?? null, error, lastRealSuccessAt, retryRequested, saveLastKnownGood };
}
function matchesIdentity(identity: ProdTrendActivitySeriesIdentity, candidate: ActivityAnalyticsResponse | ProdTrendActivitySeriesIdentity): boolean {
    if (candidate.machineId !== identity.machineId || candidate.range !== identity.range) return false;
    if (identity.range !== 'custom') return true;
    if ('start' in candidate && 'end' in candidate) return candidate.start === identity.start && candidate.end === identity.end;
    return 'window' in candidate && candidate.window.start === identity.start && candidate.window.end === identity.end;
}
function resolveQueryCompletionId(queryState: { status: 'pending' | 'error' | 'success'; dataUpdatedAt: number; errorUpdatedAt: number } | undefined): string {
    if (!queryState) return 'idle';
    if (queryState.status === 'error') return `error:${queryState.errorUpdatedAt}`;
    if (queryState.status === 'success') return `success:${queryState.dataUpdatedAt}`;
    return 'pending';
}
function failureReason(error: Error): ProdTrendDataModeFailureReason {
    if (error instanceof ActivitySeriesAdapterError) return 'invalid-response';
    if (error instanceof DataServiceError && typeof error.statusCode === 'number') return 'http-error';
    if (/timeout|timed out/i.test(error.message)) return 'timeout';
    if (/network/i.test(error.message)) return 'network-error';
    return 'invalid-contract';
}
