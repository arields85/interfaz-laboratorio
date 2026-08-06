import { act, renderHook } from '@testing-library/react';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivitySeriesAdapterError } from '../adapters/activitySeries.adapter';
import type { ActivityAnalyticsResponse } from '../domain/activityAnalytics.types';
import { DataServiceError } from '../services/dataOverview.service';
import { ProdTrendCaptureRepository, prodTrendCaptureRepository } from '../services/ProdTrendCaptureRepository';
import { useActivitySeries } from './useActivitySeries';
import {
    createProdTrendDataSourceController,
    observeProdTrendDataSource,
    useProdTrendDataSource,
    type ProdTrendPackagedSource,
} from './useProdTrendDataSource';

vi.mock('@tanstack/react-query', async (importOriginal) => ({ ...(await importOriginal<typeof import('@tanstack/react-query')>()), useQueryClient: vi.fn() }));
vi.mock('./useActivitySeries', () => ({ useActivitySeries: vi.fn(), createActivitySeriesQueryKey: (params: unknown) => ['data', 'activity-series', params] }));
const identity = { machineId: 7, range: '24h' as const };
const identityOther = { machineId: 8, range: '24h' as const };
const analyticsOptions = {
    thresholds: { setupKw: 5, prodKw: 15 }, groupBy: 'shift' as const, shifts: [], timezone: 'UTC',
    window: { start: '2026-06-18T10:00:00.000Z', end: '2026-06-19T10:00:00.000Z', bucket: '1h', bucketMs: 3600000 },
};
function response(value: number | null = 20): ActivityAnalyticsResponse {
    return {
        contractVersion: '1.0.0', machineId: 7, variableKey: 'not-an-identity-field', range: '24h', unit: 'kW', purpose: 'activity-analytics',
        window: analyticsOptions.window, series: [{ timestamp: analyticsOptions.window.start, timestampMs: Date.parse(analyticsOptions.window.start), value }], summary: { stale: true },
    };
}
function packaged(): ProdTrendPackagedSource {
    return { identity, source: 'packaged-capture', response: { ...response(12), variableKey: undefined } as never, analytics: { packaged: true } as never };
}
function observe(controller: ReturnType<typeof createProdTrendDataSourceController>, input: Partial<Parameters<typeof observeProdTrendDataSource>[1]> & { eventKey: string }) {
    return observeProdTrendDataSource(controller, {
        configuredMode: 'automatic', identity, analyticsOptions, realResponse: null, realError: null, lastKnownGood: null, packagedSource: null, ...input,
    });
}
type QueryState = ReturnType<typeof useActivitySeries>;
const queryState = (data: ActivityAnalyticsResponse | null, error: Error | null = null, isFetching = false): QueryState => ({
    data, isLoading: false, isError: error !== null, error, isEnabled: true, isFetching, isPlaceholderData: false, isRefreshing: false,
});
function paramsFor(currentIdentity: typeof identity) {
    return { machineId: currentIdentity.machineId, range: currentIdentity.range };
}
function storageStub(value: ActivityAnalyticsResponse | null = null) {
    return { get: vi.fn(() => value), save: vi.fn(() => true) } as never;
}
function mockQueryClient() {
    let generation = 0;
    const client = { getQueryState: vi.fn(() => ({ status: 'success' as const, dataUpdatedAt: generation, errorUpdatedAt: generation })), invalidateQueries: vi.fn() };
    vi.mocked(useQueryClient).mockReturnValue(client as never);
    return { client, complete: () => { generation += 1; } };
}
describe('useProdTrendDataSource orchestration', () => {
    afterEach(() => vi.clearAllMocks());

    it('passes null to unchanged useActivitySeries in simulated mode', () => {
        mockQueryClient();
        vi.mocked(useActivitySeries).mockReturnValue({ data: null, isLoading: false, isError: false, error: null, isEnabled: false, isFetching: false, isPlaceholderData: false, isRefreshing: false });
        const { result } = renderHook(() => useProdTrendDataSource({ configuredMode: 'simulated', params: identity, identity, analyticsOptions }));
        expect(vi.mocked(useActivitySeries)).toHaveBeenCalledWith(null);
        expect(result.current).toMatchObject({ isEnabled: false, source: null });
    });

    it('selects matching LKG before packaged capture, then packaged capture, without mixing', () => {
        const lkg = response(11);
        const fromLkg = observe(createProdTrendDataSourceController('automatic'), { eventKey: 'network', realError: new Error('network unavailable'), lastKnownGood: lkg, packagedSource: packaged() });
        const fromPackaged = observe(createProdTrendDataSourceController('automatic'), { eventKey: 'http', realError: new Error('HTTP 503'), packagedSource: packaged() });
        const missing = observe(createProdTrendDataSourceController('automatic'), { eventKey: 'missing', realError: new Error('HTTP 503') });
        expect(fromLkg.result).toMatchObject({ effectiveMode: 'fallback', source: 'last-known-good', response: lkg });
        expect(fromPackaged.result).toMatchObject({ effectiveMode: 'fallback', source: 'packaged-capture', response: packaged().response });
        expect(missing.result.error).toHaveProperty('message', 'No matching PROD-TREND fallback source is available');
    });

    it.each([
        [new Error('network unavailable'), 'network-error'],
        [new Error('request timed out'), 'timeout'],
        [new DataServiceError('HTTP 503', 503), 'http-error'],
        [new ActivitySeriesAdapterError('invalid response'), 'invalid-response'],
        [new Error('unexpected contract'), 'invalid-contract'],
    ] as const)('exposes the contracted fallback reason for %s', (error, reason) => {
        const result = observe(createProdTrendDataSourceController('automatic'), {
            eventKey: `reason-${reason}`,
            realError: error,
        });

        expect(result.result.state.fallbackReason).toBe(reason);
    });

    it('uses the packaged repository only for Automatic fallback when a capture is available', async () => {
        mockQueryClient();
        vi.mocked(useActivitySeries).mockReturnValue({ data: null, isLoading: false, isError: true, error: new Error('network unavailable'), isEnabled: true, isFetching: false, isPlaceholderData: false, isRefreshing: false });
        const source = packaged();
        const repository = { load: vi.fn(async () => source) } as unknown as ProdTrendCaptureRepository;

        const { result } = renderHook(() => useProdTrendDataSource({
            configuredMode: 'automatic',
            params: identity,
            identity,
            analyticsOptions,
            packagedCaptureRepository: repository,
        }));

        await vi.waitFor(() => expect(repository.load).toHaveBeenCalledWith(identity));
        await vi.waitFor(() => {
            expect(result.current.source).toBe('packaged-capture');
            expect(result.current.response).toBe(source.response);
        });
    });

    it('keeps Simulated synthetic-only while Automatic uses the machine 11 packaged capture and Real stays disconnected', async () => {
        const machine11 = { machineId: 11, range: '24h' as const };
        const packagedSource = await prodTrendCaptureRepository.load(machine11);
        expect(packagedSource?.response.series).toHaveLength(979);

        const simulated = observeProdTrendDataSource(createProdTrendDataSourceController('simulated'), {
            eventKey: 'simulated-disconnected',
            configuredMode: 'simulated',
            identity: machine11,
            realError: new Error('network unavailable'),
            packagedSource,
        });
        const automatic = observeProdTrendDataSource(createProdTrendDataSourceController('automatic'), {
            eventKey: 'automatic-disconnected',
            configuredMode: 'automatic',
            identity: machine11,
            realError: new Error('network unavailable'),
            packagedSource,
        });
        const real = observeProdTrendDataSource(createProdTrendDataSourceController('real'), {
            eventKey: 'real-disconnected',
            configuredMode: 'real',
            identity: machine11,
            realError: new Error('network unavailable'),
            packagedSource,
        });

        expect(simulated.result).toMatchObject({
            effectiveMode: 'simulated',
            source: null,
            response: null,
            error: null,
        });
        expect(automatic.result).toMatchObject({
            effectiveMode: 'fallback',
            source: 'packaged-capture',
            response: { series: packagedSource?.response.series },
        });
        expect(real.result).toMatchObject({ effectiveMode: 'real', source: null, response: null });
    });

    it('keeps Automatic honestly unavailable for an uncovered identity without consuming synthetic data', () => {
        const result = observeProdTrendDataSource(createProdTrendDataSourceController('automatic'), {
            eventKey: 'automatic-uncovered',
            configuredMode: 'automatic',
            identity: { machineId: 999, range: '7d' },
            realError: new Error('network unavailable'),
            packagedSource: null,
        });

        expect(result.result).toMatchObject({
            effectiveMode: 'fallback',
            source: null,
            response: null,
        });
        expect(result.result.error).toHaveProperty('message', 'No matching PROD-TREND fallback source is available');
    });
    it('does not process a cached empty payload again when only fetching changes', () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const queryKey = ['data', 'activity-series', paramsFor(identity)] as const;
        const initial = response(20);
        queryClient.setQueryData(queryKey, initial);
        let currentQuery = queryState(initial);
        const empty = { ...response(), series: [] };
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        vi.mocked(useQueryClient).mockReturnValue(queryClient as never);
        vi.mocked(useActivitySeries).mockImplementation(() => currentQuery);
        const { result, rerender } = renderHook(() => useProdTrendDataSource({ configuredMode: 'automatic', params: paramsFor(identity), identity, analyticsOptions, lastKnownGoodStorage: storageStub(response(20)) }));

        act(() => { queryClient.setQueryData(queryKey, empty); currentQuery = queryState(empty); rerender(); });
        act(() => { queryClient.setQueryData(queryKey, empty); currentQuery = queryState(empty); rerender(); });

        expect(result.current).toMatchObject({
            effectiveMode: 'fallback',
            source: 'last-known-good',
            state: { fallbackReason: 'repeated-empty-series' },
        });
        expect(invalidate).toHaveBeenCalledTimes(1);
    });
    it('clears committed visibility when mode and authoritative identity change', () => {
        let currentQuery = queryState(response(20));
        mockQueryClient();
        vi.mocked(useActivitySeries).mockImplementation(() => currentQuery);
        const { result, rerender } = renderHook(({ mode, currentIdentity }: { mode: 'real' | 'simulated'; currentIdentity: typeof identity }) => useProdTrendDataSource({ configuredMode: mode, params: paramsFor(currentIdentity), identity: currentIdentity, analyticsOptions }), { initialProps: { mode: 'real' as const, currentIdentity: identity } });

        act(() => { currentQuery = queryState(null); rerender({ mode: 'simulated', currentIdentity: identityOther }); });

        expect(result.current).toMatchObject({ effectiveMode: 'simulated', source: null });
        expect(result.current.error).toBeNull();
    });
    it('rejects mismatched real responses before visibility or LKG save', () => {
        const storage = storageStub();
        const currentQuery = queryState({ ...response(20), machineId: 8 });
        mockQueryClient();
        vi.mocked(useActivitySeries).mockImplementation(() => currentQuery);
        const { result } = renderHook(() => useProdTrendDataSource({ configuredMode: 'real', params: paramsFor(identity), identity, analyticsOptions, lastKnownGoodStorage: storage }));

        expect(result.current.source).toBeNull();
        expect(result.current.error).toHaveProperty('message', 'Activity-series response identity does not match the requested identity');
        expect(storage.save).not.toHaveBeenCalled();
    });
    it('preserves Real empty behavior without retrying or retaining stale data', () => {
        let currentQuery = queryState(response(20));
        const query = mockQueryClient();
        vi.mocked(useActivitySeries).mockImplementation(() => currentQuery);
        const { result, rerender } = renderHook(() => useProdTrendDataSource({ configuredMode: 'real', params: paramsFor(identity), identity, analyticsOptions }));

        act(() => { query.complete(); currentQuery = queryState({ ...response(), series: [] }); rerender(); });

        expect(result.current).toMatchObject({ source: 'real', retryRequested: false });
        expect(result.current.response?.series).toEqual([]);
        expect(query.client.invalidateQueries).not.toHaveBeenCalled();
    });
    it('clears Real visibility when a cached-data background error has no matching fallback source', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const queryKey = ['data', 'activity-series', paramsFor(identity)] as const;
        const initial = response(20);
        queryClient.setQueryData(queryKey, initial);
        let currentQuery = queryState(initial);
        vi.mocked(useQueryClient).mockReturnValue(queryClient as never);
        vi.mocked(useActivitySeries).mockImplementation(() => currentQuery);
        const { result, rerender } = renderHook(() => useProdTrendDataSource({ configuredMode: 'automatic', params: paramsFor(identity), identity, analyticsOptions, lastKnownGoodStorage: storageStub() }));

        const backgroundError = new Error('network unavailable');
        await act(async () => {
            await expect(queryClient.fetchQuery({ queryKey, queryFn: async () => { throw backgroundError; }, retry: false })).rejects.toThrow(backgroundError);
            currentQuery = queryState(initial, backgroundError);
            rerender();
        });
        rerender();

        expect(result.current.source).toBeNull();
        expect(result.current.error).toHaveProperty('message', 'No matching PROD-TREND fallback source is available');
    });
    it('counts recovery successes by payload, not fetching transitions or repeated shape', () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const queryKey = ['data', 'activity-series', paramsFor(identity)] as const;
        let currentQuery = queryState(null, new Error('timeout'));
        const success = response(20);
        const lkg = storageStub(response(10));
        vi.mocked(useQueryClient).mockReturnValue(queryClient as never);
        vi.mocked(useActivitySeries).mockImplementation(() => currentQuery);
        const { result, rerender } = renderHook(() => useProdTrendDataSource({ configuredMode: 'automatic', params: paramsFor(identity), identity, analyticsOptions, lastKnownGoodStorage: lkg }));

        act(() => { queryClient.setQueryData(queryKey, success); currentQuery = queryState(success); rerender(); });
        expect(result.current.source).toBe('last-known-good');
        act(() => { queryClient.setQueryData(queryKey, success); currentQuery = queryState(success); rerender(); });

        expect(result.current.source).toBe('real');
        expect(lkg.save).toHaveBeenCalledTimes(1);
    });
});
