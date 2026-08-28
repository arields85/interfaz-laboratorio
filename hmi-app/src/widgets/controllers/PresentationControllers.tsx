/* eslint-disable react-refresh/only-export-components */
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { QueryClientContext, type QueryClient } from '@tanstack/react-query';
import type { ConnectionHealth, ContractMachine, DataHistoryResponse, DataHistoryResponseV2, HistoryQueryParams, HistoryQueryParamsV2, HistoryRange, HistoryRangeV2 } from '../../domain/dataContract.types';
import type { ActivityAnalyticsGroupBy, ActivityAnalyticsRange, ActivityAnalyticsResponse } from '../../domain/activityAnalytics.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import type { ActivityAnalyticsWidgetConfig, AlertHistoryWidgetConfig, MachineActivityWidgetConfig, ProdHistoryWidgetConfig, ProdTrendWidgetConfig, TemporalBucket, WidgetConfig } from '../../domain/admin.types';
import { useMachineActivity, type MachineActivityResult } from '../../hooks/useMachineActivity';
import { createPresentationEntry, type PresentationCapability, type WidgetPresentationEntry, type WidgetPresentationPayloadByCapability } from '../../domain/dashboardPresentation.types';
import { usePresentationRegistration, useDashboardPresentationFrame } from '../../services/dashboardPresentationFrame.service';
import { resolveBinding } from '../resolvers/bindingResolver';
import { createDataHistoryQueryOptions, useDataHistory } from '../../queries/useDataHistory';
import { createActivitySeriesQueryOptions, isActivitySeriesResponseCompatible, useActivitySeries, type UseActivitySeriesResult } from '../../queries/useActivitySeries';
import { useProdTrendDataSource, type UseProdTrendDataSourceResult } from '../../queries/useProdTrendDataSource';
import { resolveActivityAnalyticsDisplayOptions } from '../../utils/activityAnalyticsWidgetDefaults';
import { resolveProdTrendDisplayOptions } from '../../utils/prodTrendWidgetDefaults';
import { normalizeSimulatedEquipmentStatus } from '../../utils/statusWidget';
import { normalizeSimulatedToContractStatus } from '../../utils/connectionWidget';
import { resolveInfoCardFieldContent, resolveInfoCardFields } from '../../utils/infoCardDisplayOptions';
import { buildActivityAnalyticsSimulatedHistory } from '../../utils/activityAnalyticsSimulation';
import { recordActivityAnalyticsPerformanceDiagnostic } from '../../utils/activityAnalyticsPerformanceDiagnostics';
import { subscribeAlertHistory, clearAlertHistoryEntries, type AlertHistoryCoordinatorState } from '../renderers/alertHistoryCoordinator';
import { clamp, round2 } from '../../utils/chartHelpers';
import type { TemporalTrendPoint } from '../../utils/temporalGrouping';
import { getWidgetPresentationCapability } from '../../utils/widgetCapabilities';
import { isDataHistoryEnabled } from '../../config/dataConnection.config';
import { isDataHistoryConnectionError } from '../../services/dataHistory.service';
import { generateTrendData } from '../../utils/trendDataGenerator';
import { isDataHistoryResponseCompatible } from '../../queries/useDataHistory';
import { mapTrendChartLegacyHistory, type TrendChartLegacyDataPoint } from '../renderers/trendChartLegacyModel';
import { coerceDataHistoryResponseForTrendChartV2 } from '../../utils/dataHistoryResponseV2';
import { buildTrendChartV2SimulatedHistory } from '../../utils/trendChartV2Simulation';
import { mapHistoricalDensityToMaxPoints } from '../../utils/trendChartV2Density';
import { recordTrendChartV2PerformanceDiagnostic } from '../../utils/trendChartV2PerformanceDiagnostics';
import type { AlertHistoryEntry } from '../../domain/alertHistory.types';
import type { ResolvedBinding } from '../../domain/widget.types';
import type { TrendChartV2RenderContext } from '../renderers/trendChartV2RenderContext';

const PRODUCTION_HISTORY_WINDOW_SIZE: Record<TemporalBucket, number> = { hour: 24, shift: 15, day: 14, month: 12 };

function stepBackProductionHistoryBucket(now: Date, bucket: TemporalBucket, steps: number): Date { const date = new Date(now.getTime()); switch (bucket) { case 'hour': date.setHours(date.getHours() - steps); break; case 'shift': date.setHours(date.getHours() - (steps * 8)); break; case 'day': date.setDate(date.getDate() - steps); break; case 'month': date.setMonth(date.getMonth() - steps); break; } return date; }

export function generateProductionHistorySeries(bucket: TemporalBucket, reference: Date): TemporalTrendPoint[] {
    const total = PRODUCTION_HISTORY_WINDOW_SIZE[bucket];
    return Array.from({ length: total }, (_, index) => {
        const timestamp = stepBackProductionHistoryBucket(reference, bucket, total - 1 - index);
        const seasonal = Math.sin((index / Math.max(total - 1, 1)) * Math.PI * 2);
        const oee = clamp(74 + seasonal * 8 + Math.sin(index * 0.61) * 1.9 + Math.cos(index * 0.27) * 0.8, 58, 93);
        const production = Math.max(90, (oee * 2.15) + 32 + seasonal * 9 + (Math.cos(index * 0.35) * 11));
        return { timestamp: timestamp.toISOString(), production: round2(production), oee: round2(oee) };
    });
}

function createActivityFixture(widgetId: string, machineId: number | undefined, range: ActivityAnalyticsRange, setupThresholdKw: number, prodThresholdKw: number, nowMs: number, customWindow?: { start: string; end: string }) {
    const history = buildActivityAnalyticsSimulatedHistory({ widgetId, machineId, variableKey: 'Total kW', range, customWindow, baseValue: (setupThresholdKw + prodThresholdKw) / 2, operatingLevels: { stopped: setupThresholdKw * 0.2, setup: setupThresholdKw, production: prodThresholdKw }, nowMs });
    return { ...history, contractVersion: 'presentation-fixture', unit: 'kW', purpose: 'activity-analytics' as const, window: { ...history.window, timezone: 'UTC', bucket: 'synthetic' } } as ActivityAnalyticsResponse;
}
function resolvePresentationValue<T>(configured: boolean, response: T | null | undefined, fixture: T) {
    return configured ? { value: fixture, provenance: 'configured' as const } : response !== null && response !== undefined ? { value: response, provenance: 'central-read-only' as const } : { value: fixture, provenance: 'deterministic-fixture' as const };
}

function resolveMachineActivityFixtureValue(widgetId: string): number {
    const hash = [...widgetId].reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 0);
    return 0.35 + ((hash % 30) / 100);
}

function countActivityAnalyticsWidgets(widgetId: string, siblingWidgets?: WidgetConfig[]): number {
    const activityAnalyticsWidgetIds = new Set<string>([widgetId]);

    siblingWidgets?.forEach((candidate) => {
        if (getWidgetPresentationCapability(candidate.type) === 'activity-analytics') {
            activityAnalyticsWidgetIds.add(candidate.id);
        }
    });

    return activityAnalyticsWidgetIds.size;
}

export interface PresentationControllerProps {
    widget: WidgetConfig;
    equipmentMap: Map<string, EquipmentSummary>;
    machines?: ContractMachine[];
    connection?: ConnectionHealth;
    isLoadingData?: boolean;
    siblingWidgets?: WidgetConfig[];
    queryClient?: QueryClient;
    renderContext?: TrendChartV2RenderContext;
    render: (entry: WidgetPresentationEntry) => ReactNode;
}

export interface TrendChartPresentationData {
    data: TrendChartLegacyDataPoint[];
    response: DataHistoryResponse | null;
    range: HistoryRange;
    unit?: string;
    isSimulated: boolean;
    isRealLoading: boolean;
    isNoData: boolean;
    isShowingRefreshingSnapshot: boolean;
    isShowingRefreshFailedSnapshot: boolean;
    runtimeState: 'disconnected' | 'error' | 'empty';
    onRangeChange: (range: HistoryRange) => void;
}

export interface TrendChartV2PresentationData {
    data: DataHistoryResponseV2 | null;
    displayedRange: HistoryRangeV2;
    displayedCustomWindow: { start: string; end: string } | null;
    isSimulated: boolean;
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
    isFetching: boolean;
    isPlaceholderData: boolean;
    isRefreshing: boolean;
    isLoadingData: boolean;
    isShowingRefreshingSnapshot: boolean;
    isShowingRefreshFailedSnapshot: boolean;
    isNoData: boolean;
    runtimeState: 'loading' | 'disconnected' | 'error' | 'empty';
    onRangeChange: (range: Exclude<HistoryRangeV2, 'custom'>) => void;
    onCustomWindowChange: (window: { start: string; end: string } | null) => void;
}

export type PresentationDataProvenance = 'configured' | 'central-read-only' | 'deterministic-fixture';

export interface ProductionHistoryPresentationData {
    data: TemporalTrendPoint[];
    bucket: TemporalBucket;
    onBucketChange: (bucket: TemporalBucket) => void;
    provenance: 'deterministic-fixture';
    sessionAnchor: number;
}

export interface MachineActivityPresentationData {
    resolved: ResolvedBinding;
    activity: MachineActivityResult;
    sourceKey: string;
    provenance: PresentationDataProvenance;
}

export interface ActivityAnalyticsPresentationData {
    activitySeries: UseActivitySeriesResult;
    displayOptions: ReturnType<typeof resolveActivityAnalyticsDisplayOptions>;
    turnoMode: 'summary' | 'detail';
    onRangeChange: (range: ActivityAnalyticsRange) => void;
    onGroupByChange: (groupBy: ActivityAnalyticsGroupBy) => void;
    onTurnoModeChange: (mode: 'summary' | 'detail') => void;
    provenance: PresentationDataProvenance;
}

export interface ProdTrendPresentationData {
    dataSource: UseProdTrendDataSourceResult;
    displayOptions: ReturnType<typeof resolveProdTrendDisplayOptions>;
    onRangeChange: (range: ActivityAnalyticsRange) => void;
    onGroupByChange: (groupBy: ActivityAnalyticsGroupBy) => void;
    provenance: PresentationDataProvenance;
}

export interface AlertHistoryPresentationData {
    entries: AlertHistoryEntry[];
    activeSeverity: AlertHistoryCoordinatorState['activeSeverity'];
    onClear: () => void;
}

const TREND_V2_PREFETCH_MAX_WIDGETS = 12;
const TREND_V2_PREFETCH_MAX_HISTORY_WIDGETS = 3;

function resolveAdjacentTrendV2Range(range: Exclude<HistoryRangeV2, 'custom'>): Exclude<HistoryRangeV2, 'custom'> | null {
    const ranges: Array<Exclude<HistoryRangeV2, 'custom'>> = ['1h', '24h', '7d', '30d', '12m'];
    const index = ranges.indexOf(range);
    return index < 0 ? null : ranges[index + 1] ?? ranges[index - 1] ?? null;
}

function useEntry<C extends PresentationCapability>(widget: WidgetConfig, capability: C, payload: WidgetPresentationPayloadByCapability[C]): WidgetPresentationEntry<C> {
    const { frame } = useFrameController();
    const payloadKey = JSON.stringify(payload, (_key, value) => typeof value === 'function' ? '[callback]' : value);
    // eslint-disable-next-line react-hooks/preserve-manual-memoization, react-hooks/exhaustive-deps
    const entry = useMemo(() => createPresentationEntry({ widget, capability, revisionKey: frame.revisionKey, payload }), [capability, frame.revisionKey, payloadKey, widget]);
    usePresentationRegistration(entry);
    return entry;
}

function useFrameController() {
    const frame = useDashboardPresentationFrame();
    return { frame };
}

export function ScalarPresentationController({ widget, equipmentMap, machines, render }: PresentationControllerProps) {
    const resolved = resolveBinding(widget, equipmentMap, machines);
    const entry = useEntry(widget, 'scalar', {
        value: resolved.value,
        unit: resolved.unit,
        binding: resolved,
        status: resolved.status,
        lastUpdateAt: resolved.lastUpdateAt,
        connectionState: resolved.connectionState,
        source: resolved.source,
        dataSummary: { status: resolved.status, source: resolved.source },
    });
    return <>{render(entry)}</>;
}

export function StatusPresentationController({ widget, equipmentMap, render }: PresentationControllerProps) {
    const status = widget.binding?.mode === 'simulated_value'
        ? normalizeSimulatedEquipmentStatus(widget.binding.simulatedValue)
        : equipmentMap.get(widget.binding?.assetId ?? '')?.status ?? 'unknown';
    const entry = useEntry(widget, 'status', {
        value: status,
        status,
        source: widget.binding?.mode === 'simulated_value' ? 'simulated' : equipmentMap.has(widget.binding?.assetId ?? '') ? 'real' : 'error',
        dataSummary: { source: 'equipment-status' },
    });
    return <>{render(entry)}</>;
}

export function ConnectionPresentationController({ widget, connection, machines, render }: PresentationControllerProps) {
    const options = widget.displayOptions as { scope?: 'global' | 'machine'; machineId?: number } | undefined;
    const machine = options?.scope === 'machine' ? machines?.find((item) => item.unitId === options.machineId) : undefined;
    const status = widget.binding?.mode === 'simulated_value'
        ? normalizeSimulatedToContractStatus(widget.binding.simulatedValue)
        : machine?.status ?? connection?.globalStatus ?? 'unknown';
    const entry = useEntry(widget, 'connection', {
        value: status,
        status,
        lastSuccess: options?.scope === 'machine' ? machine?.lastSuccess ?? null : connection?.lastSuccess ?? null,
        ageMs: options?.scope === 'machine' ? machine?.ageMs ?? null : connection?.ageMs ?? null,
        source: widget.binding?.mode === 'simulated_value' ? 'simulated' : options?.scope === 'machine' ? machine ? 'real' : 'error' : connection ? 'real' : 'error',
        dataSummary: { source: machine ? 'machine' : 'global' },
    });
    return <>{render(entry)}</>;
}

export function TrendChartController({ widget, equipmentMap, machines, isLoadingData = false, render }: PresentationControllerProps) {
    const [range, setRange] = useState<HistoryRange>('hora');
    const resolved = resolveBinding(widget, equipmentMap, machines);
    const isSimulated = widget.binding?.mode === 'simulated_value';
    const bindingMachineId = widget.binding?.machineId;
    const bindingVariableKey = widget.binding?.variableKey;
    const historyEnabled = isDataHistoryEnabled();
    const historyOwnerKey = `${widget.id}:${widget.binding?.mode ?? 'unbound'}:${bindingMachineId ?? 'none'}:${bindingVariableKey ?? 'none'}`;
    const historyParams = useMemo<HistoryQueryParams | null>(() => (
        !isSimulated && bindingMachineId !== undefined && bindingVariableKey && historyEnabled
            ? { machineId: bindingMachineId, variableKey: bindingVariableKey, range }
            : null
    ), [bindingMachineId, bindingVariableKey, historyEnabled, isSimulated, range]);
    const history = useDataHistory(historyParams);
    const [confirmedHistorySnapshot, setConfirmedHistorySnapshot] = useState<{
        ownerKey: string;
        selectionKey: string;
        revision: string;
        range: HistoryRange;
        data: TrendChartLegacyDataPoint[];
        response: DataHistoryResponse;
    } | null>(null);
    const hasCompatibleHistoryResponse = history.data !== null && isDataHistoryResponseCompatible(historyParams, history.data);
    const requestedSelectionKey = `${bindingMachineId ?? 'none'}:${bindingVariableKey ?? 'none'}:${range}`;
    const currentResponseRevision = history.data !== null && hasCompatibleHistoryResponse ? JSON.stringify(history.data) : null;
    const canReuseConfirmedMapping = currentResponseRevision !== null
        && confirmedHistorySnapshot?.ownerKey === historyOwnerKey
        && confirmedHistorySnapshot.selectionKey === requestedSelectionKey
        && confirmedHistorySnapshot.revision === currentResponseRevision;
    const currentHistoryTrendData = history.data !== null && hasCompatibleHistoryResponse
        ? canReuseConfirmedMapping
            ? confirmedHistorySnapshot.data
            : mapTrendChartLegacyHistory(history.data, range)
        : null;
    const currentHistorySnapshot = history.data !== null && currentHistoryTrendData && currentResponseRevision !== null
        ? {
            ownerKey: historyOwnerKey,
            selectionKey: requestedSelectionKey,
            revision: currentResponseRevision,
            range,
            data: currentHistoryTrendData,
            response: history.data,
        }
        : null;

    if (currentHistorySnapshot && !history.isPlaceholderData && !history.isError && (
        confirmedHistorySnapshot?.ownerKey !== currentHistorySnapshot.ownerKey
        || confirmedHistorySnapshot.selectionKey !== currentHistorySnapshot.selectionKey
        || confirmedHistorySnapshot.revision !== currentHistorySnapshot.revision
    )) {
        setConfirmedHistorySnapshot(currentHistorySnapshot);
    }

    const ownerConfirmedSnapshot = confirmedHistorySnapshot?.ownerKey === historyOwnerKey ? confirmedHistorySnapshot : null;
    const isShowingRefreshingSnapshot = !isSimulated && history.isRefreshing && ownerConfirmedSnapshot !== null;
    const isShowingRefreshFailedSnapshot = !isSimulated && history.isError && ownerConfirmedSnapshot !== null;
    const preserveConfirmedSnapshot = (history.isPlaceholderData || history.isRefreshing || history.isError) && ownerConfirmedSnapshot !== null;
    const visibleHistorySnapshot = preserveConfirmedSnapshot ? ownerConfirmedSnapshot : currentHistorySnapshot;
    const baseValue = resolved.value == null
        ? null
        : typeof resolved.value === 'number'
            ? resolved.value
            : typeof resolved.value === 'string'
                ? Number.parseFloat(resolved.value)
                : null;
    const simulatedData = useMemo(() => isSimulated && baseValue !== null && Number.isFinite(baseValue)
        ? generateTrendData(baseValue, undefined, 24)
        : [], [baseValue, isSimulated]);
    const data = isSimulated ? simulatedData : visibleHistorySnapshot?.data ?? [];
    const isRealLoading = isLoadingData || (!isSimulated && historyParams !== null && history.isLoading && visibleHistorySnapshot === null);
    const hasBinding = bindingMachineId !== undefined && Boolean(bindingVariableKey);
    const isNoData = isSimulated ? data.length === 0 && (!hasBinding || baseValue === null) : !history.isLoading && data.length === 0;
    const runtimeState = history.isError
        ? (isDataHistoryConnectionError(history.error) ? 'disconnected' : 'error')
        : 'empty' as const;
    const entry = useEntry(widget, 'trend-chart', {
        data: {
            data,
            response: isSimulated ? null : visibleHistorySnapshot?.response ?? null,
            range,
            unit: isSimulated ? (resolved.unit ? String(resolved.unit) : undefined) : visibleHistorySnapshot?.response.unit ?? (resolved.unit ? String(resolved.unit) : undefined),
            isSimulated,
            isRealLoading,
            isNoData,
            isShowingRefreshingSnapshot,
            isShowingRefreshFailedSnapshot,
            runtimeState,
            onRangeChange: setRange,
        } satisfies TrendChartPresentationData,
        dataSummary: { isLoading: history.isLoading, isError: history.isError },
    });
    return <>{render(entry)}</>;
}

export function TrendChartV2Controller({ widget, equipmentMap, machines, isLoadingData = false, siblingWidgets, queryClient, render }: PresentationControllerProps) {
    const frame = useDashboardPresentationFrame();
    const [range, setRange] = useState<Exclude<HistoryRangeV2, 'custom'>>('24h');
    const [customWindow, setCustomWindow] = useState<{ start: string; end: string } | null>(null);
    const [confirmedHistorySnapshot, setConfirmedHistorySnapshot] = useState<{
        ownerKey: string;
        selectionKey: string;
        revision: string;
        range: HistoryRangeV2;
        customWindow: { start: string; end: string } | null;
        data: DataHistoryResponseV2;
    } | null>(null);
    const [isWidgetVisible, setIsWidgetVisible] = useState<boolean | null>(null);
    const visibilityObserverRef = useRef<IntersectionObserver | null>(null);
    const contextClient = useContext(QueryClientContext);
    const client = queryClient ?? contextClient;
    const historyEnabled = isDataHistoryEnabled();
    const resolved = resolveBinding(widget, equipmentMap, machines);
    const maxPoints = mapHistoricalDensityToMaxPoints((widget as { displayOptions?: { historicalDensity?: unknown } }).displayOptions?.historicalDensity);
    const isSimulatedBinding = widget.binding?.mode === 'simulated_value';
    const isRealBinding = widget.binding?.mode === 'real_variable';
    const bindingMachineId = widget.binding?.machineId;
    const bindingVariableKey = widget.binding?.variableKey;
    const historyOwnerKey = `${widget.id}:${widget.binding?.mode ?? 'unbound'}:${bindingMachineId ?? 'none'}:${bindingVariableKey ?? 'none'}`;
    const params = useMemo<HistoryQueryParamsV2 | null>(() => isRealBinding && bindingMachineId !== undefined && bindingVariableKey && historyEnabled
        ? customWindow
            ? { machineId: bindingMachineId, variableKey: bindingVariableKey, range: 'custom', start: customWindow.start, end: customWindow.end, maxPoints }
            : { machineId: bindingMachineId, variableKey: bindingVariableKey, range, maxPoints }
        : null, [bindingMachineId, bindingVariableKey, customWindow, historyEnabled, isRealBinding, maxPoints, range]);
    const history = useDataHistory(params);
    const activeRange: HistoryRangeV2 = customWindow ? 'custom' : range;
    const isCompatible = history.data !== null && isDataHistoryResponseCompatible(params, history.data);
    const currentData = isRealBinding && history.data !== null && isCompatible
        ? coerceDataHistoryResponseForTrendChartV2(history.data, activeRange)
        : null;
    const currentSnapshot = currentData ? {
        ownerKey: historyOwnerKey,
        selectionKey: `${activeRange}:${customWindow?.start ?? ''}:${customWindow?.end ?? ''}`,
        revision: JSON.stringify(currentData),
        range: activeRange,
        customWindow,
        data: currentData,
    } : null;

    if (currentSnapshot && !history.isPlaceholderData && !history.isError && (
        confirmedHistorySnapshot?.ownerKey !== currentSnapshot.ownerKey
        || confirmedHistorySnapshot.selectionKey !== currentSnapshot.selectionKey
        || confirmedHistorySnapshot.revision !== currentSnapshot.revision
    )) {
        setConfirmedHistorySnapshot(currentSnapshot);
    }

    const ownerConfirmedSnapshot = confirmedHistorySnapshot?.ownerKey === historyOwnerKey ? confirmedHistorySnapshot : null;
    const shouldPreserveSnapshot = (history.isPlaceholderData || history.isRefreshing || history.isError) && ownerConfirmedSnapshot !== null;
    const visibleSnapshot = shouldPreserveSnapshot ? ownerConfirmedSnapshot : currentSnapshot;
    const baseValue = resolved.value == null ? null : typeof resolved.value === 'number' ? resolved.value : Number.parseFloat(String(resolved.value));
    const simulatedData = useMemo(() => isSimulatedBinding && baseValue !== null && Number.isFinite(baseValue)
        ? buildTrendChartV2SimulatedHistory({ widgetId: widget.id, machineId: bindingMachineId, variableKey: bindingVariableKey, range: customWindow ? 'custom' : range, customWindow: customWindow ?? undefined, baseValue })
        : null, [baseValue, bindingMachineId, bindingVariableKey, customWindow, isSimulatedBinding, range, widget.id]);
    const data = isSimulatedBinding ? simulatedData : visibleSnapshot?.data ?? null;
    const displayedRange = isSimulatedBinding ? activeRange : visibleSnapshot?.range ?? activeRange;
    const displayedCustomWindow = isSimulatedBinding ? customWindow : visibleSnapshot?.customWindow ?? customWindow;
    const isNoData = isSimulatedBinding ? data === null : !history.isLoading && data === null;
    const isRealLoading = !isSimulatedBinding && params !== null && history.isLoading && visibleSnapshot === null;
    const runtimeState: TrendChartV2PresentationData['runtimeState'] = isRealLoading || isLoadingData
        ? 'loading'
        : history.isError
            ? (isDataHistoryConnectionError(history.error) ? 'disconnected' : 'error')
            : 'empty';
    const onVisibilityTargetChange = useCallback((element: HTMLDivElement | null) => {
        visibilityObserverRef.current?.disconnect();
        visibilityObserverRef.current = null;
        if (!element || typeof IntersectionObserver === 'undefined') {
            setIsWidgetVisible(null);
            return;
        }
        const observer = new IntersectionObserver(([intersection]) => setIsWidgetVisible(intersection?.isIntersecting ?? false));
        observer.observe(element);
        visibilityObserverRef.current = observer;
    }, []);

    useEffect(() => () => visibilityObserverRef.current?.disconnect(), []);
    useEffect(() => {
        if (!client || !params || !isWidgetVisible || customWindow || history.isLoading || history.isFetching || history.isRefreshing || history.isPlaceholderData || history.isError || !history.data) return;
        const totalWidgetCount = siblingWidgets?.length ?? 0;
        const heavyHistoryWidgetCount = siblingWidgets?.filter((candidate) => candidate.type === 'trend-chart-v2').length ?? 0;
        const targetRange = resolveAdjacentTrendV2Range(range);
        if (!targetRange || totalWidgetCount === 0 || heavyHistoryWidgetCount === 0 || totalWidgetCount > TREND_V2_PREFETCH_MAX_WIDGETS || heavyHistoryWidgetCount > TREND_V2_PREFETCH_MAX_HISTORY_WIDGETS) return;
        if (typeof document !== 'undefined' && (document.hidden || document.visibilityState === 'hidden')) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        if (typeof client.getQueryState !== 'function' || (typeof client.isFetching === 'function' && client.isFetching() > 0)) return;
        const prefetchParams = { machineId: bindingMachineId as number, variableKey: bindingVariableKey as string, range: targetRange, maxPoints };
        const options = createDataHistoryQueryOptions(prefetchParams);
        const targetState = client.getQueryState(options.queryKey);
        if (targetState && (targetState.status === 'success' || targetState.fetchStatus === 'fetching')) return;
        let cancelled = false;
        const schedule = typeof requestIdleCallback === 'function' ? requestIdleCallback : ((callback: IdleRequestCallback) => window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0));
        const cancel = typeof cancelIdleCallback === 'function' ? cancelIdleCallback : window.clearTimeout;
        const handle = schedule(() => {
            if (cancelled) return;
            void client.prefetchQuery(options).catch((prefetchError: unknown) => {
                if (!(prefetchError instanceof DOMException && prefetchError.name === 'AbortError')) recordTrendChartV2PerformanceDiagnostic({ widgetId: widget.id, event: 'prefetch_denied', reason: 'prefetch_failed' });
            });
        });
        return () => {
            cancelled = true;
            cancel(handle as never);
            if (typeof client.cancelQueries === 'function') void client.cancelQueries({ queryKey: options.queryKey });
        };
    }, [bindingMachineId, bindingVariableKey, client, customWindow, frame.revisionKey, history.data, history.isError, history.isFetching, history.isLoading, history.isPlaceholderData, history.isRefreshing, isWidgetVisible, maxPoints, params, range, siblingWidgets, widget.id, widget.type]);

    const entry = useEntry(widget, 'trend-chart-v2', {
        data: { data, displayedRange, displayedCustomWindow, isSimulated: isSimulatedBinding, isLoading: history.isLoading, isError: history.isError, error: history.error, isFetching: history.isFetching, isPlaceholderData: history.isPlaceholderData, isRefreshing: history.isRefreshing, isLoadingData, isShowingRefreshingSnapshot: !isSimulatedBinding && history.isRefreshing && ownerConfirmedSnapshot !== null, isShowingRefreshFailedSnapshot: !isSimulatedBinding && history.isError && ownerConfirmedSnapshot !== null, isNoData, runtimeState, onRangeChange: setRange, onCustomWindowChange: setCustomWindow },
        dataSummary: { isLoading: history.isLoading, isError: history.isError },
    });
    return <div ref={onVisibilityTargetChange} className="h-full w-full">{render(entry)}</div>;
}

export function ActivityAnalyticsPresentationController({ widget, machines, siblingWidgets, queryClient, render }: PresentationControllerProps) {
    const frame = useDashboardPresentationFrame();
    const options = resolveActivityAnalyticsDisplayOptions((widget as ActivityAnalyticsWidgetConfig).displayOptions);
    const [range, setRange] = useState<ActivityAnalyticsRange>(options.range);
    const [groupBy, setGroupBy] = useState<ActivityAnalyticsGroupBy>(options.groupBy);
    const [turnoMode, setTurnoMode] = useState<'summary' | 'detail'>('summary');
    const [sessionAnchor] = useState(() => Date.now());
    const machineId = typeof widget.binding?.machineId === 'number'
        ? widget.binding.machineId
        : machines?.find((machine) => machine.name === String(widget.binding?.machineId ?? ''))?.unitId;
    const params = options.dataMode === 'simulated' || machineId === undefined ? null : range === 'custom'
        ? { machineId, range, start: options.start ?? '', end: options.end ?? '' }
        : { machineId, range };
    const activitySeries = useActivitySeries(params);
    const fixture = createActivityFixture(widget.id, machineId, range, options.setupThresholdKw, options.prodThresholdKw, sessionAnchor, range === 'custom' ? { start: options.start ?? '', end: options.end ?? '' } : undefined);
    const hasIncompatibleTransientData = !options.dataMode || options.dataMode === 'real'
        ? (activitySeries.isPlaceholderData || activitySeries.isError)
            && activitySeries.data !== null
            && !isActivitySeriesResponseCompatible(params, activitySeries.data)
        : false;
    const centralActivityData = hasIncompatibleTransientData ? undefined : activitySeries.data ?? undefined;
    const resolvedActivity = resolvePresentationValue(options.dataMode === 'simulated', centralActivityData, fixture);
    const presentationActivitySeries = activitySeries.isLoading || activitySeries.isError
        ? { ...activitySeries, data: hasIncompatibleTransientData ? null : activitySeries.data }
        : { ...activitySeries, data: resolvedActivity.value };
    const contextClient = useContext(QueryClientContext);
    const client = queryClient ?? contextClient;
    const activityAnalyticsWidgetCount = countActivityAnalyticsWidgets(widget.id, siblingWidgets);
    const lastPrefetchDecisionKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (!client || !activitySeries.isEnabled || options.dataMode === 'simulated' || machineId === undefined || range === '12m') return;

        if (activityAnalyticsWidgetCount > 2) {
            const decisionKey = `${frame.revisionKey}:${range}:dashboard_pressure`;
            if (lastPrefetchDecisionKeyRef.current !== decisionKey) {
                lastPrefetchDecisionKeyRef.current = decisionKey;
                recordActivityAnalyticsPerformanceDiagnostic({
                    widgetId: widget.id,
                    event: 'prefetch_suppressed',
                    reason: 'dashboard_pressure',
                });
            }
            return;
        }

        const nextRange: ActivityAnalyticsRange = range === '7d' ? '30d' : '7d';
        let cancelled = false;
        const prefetch = () => {
            if (cancelled) return;
            void client.prefetchQuery(createActivitySeriesQueryOptions({ machineId, range: nextRange })).catch(() => undefined);
        };
        if (typeof requestIdleCallback === 'function') {
            const handle = requestIdleCallback(prefetch);
            return () => {
                cancelled = true;
                if (typeof cancelIdleCallback === 'function') {
                    cancelIdleCallback(handle);
                }
            };
        }

        const handle = window.setTimeout(prefetch, 0);
        return () => {
            cancelled = true;
            window.clearTimeout(handle);
        };
    }, [activityAnalyticsWidgetCount, activitySeries.isEnabled, client, frame.revisionKey, machineId, options.dataMode, range, widget.id]);
    const activeOptions = useMemo(() => ({ ...options, range, groupBy }), [groupBy, options, range]);
    const presentationData: ActivityAnalyticsPresentationData = { activitySeries: presentationActivitySeries, displayOptions: activeOptions, turnoMode, onRangeChange: setRange, onGroupByChange: setGroupBy, onTurnoModeChange: setTurnoMode, provenance: resolvedActivity.provenance };
    const entry = useEntry(widget, 'activity-analytics', { data: presentationData });
    return <>{render(entry)}</>;
}

export function ProdTrendPresentationController({ widget, machines, render }: PresentationControllerProps) {
    const options = (widget as ProdTrendWidgetConfig).displayOptions;
    const [range, setRange] = useState<ActivityAnalyticsRange>(options?.range ?? '7d');
    const [groupBy, setGroupBy] = useState<ActivityAnalyticsGroupBy>(options?.groupBy ?? 'day');
    const [sessionAnchor] = useState(() => Date.now());
    const machineId = typeof widget.binding?.machineId === 'number'
        ? widget.binding.machineId
        : machines?.find((machine) => machine.name === String(widget.binding?.machineId ?? ''))?.unitId ?? null;
    const dataSource = useProdTrendDataSource({ configuredMode: options?.dataMode, params: machineId === null ? null : { machineId, range } });
    const resolvedOptions = resolveProdTrendDisplayOptions(options ?? {});
    const fixture = createActivityFixture(widget.id, machineId ?? undefined, range, resolvedOptions.setupThresholdKw, resolvedOptions.prodThresholdKw, sessionAnchor);
    const resolvedData = resolvePresentationValue(options?.dataMode === 'simulated', dataSource.response, fixture);
    const presentationDataSource = dataSource.isLoading || dataSource.error
        ? dataSource
        : { ...dataSource, response: resolvedData.value };
    const presentationData: ProdTrendPresentationData = { dataSource: presentationDataSource, displayOptions: { ...resolvedOptions, range, groupBy }, onRangeChange: setRange, onGroupByChange: setGroupBy, provenance: resolvedData.provenance };
    const entry = useEntry(widget, 'prod-trend', { data: presentationData });
    return <>{render(entry)}</>;
}

export function ProductionHistoryPresentationController({ widget, render }: PresentationControllerProps) { const [bucket, setBucket] = useState<TemporalBucket>((widget as ProdHistoryWidgetConfig).displayOptions?.defaultTemporalGrouping ?? 'hour'); const [sessionAnchor] = useState(() => Date.now()); const data = useMemo(() => generateProductionHistorySeries(bucket, new Date(sessionAnchor)), [bucket, sessionAnchor]); const presentationData: ProductionHistoryPresentationData = { data, bucket, onBucketChange: setBucket, provenance: 'deterministic-fixture', sessionAnchor }; const entry = useEntry(widget, 'production-history', { data: presentationData }); return <>{render(entry)}</>; }

export function MachineActivityPresentationController({ widget, equipmentMap, machines, isLoadingData, render }: PresentationControllerProps) { const frame = useDashboardPresentationFrame(); const options = (widget as MachineActivityWidgetConfig).displayOptions ?? {}; const resolved = resolveBinding(widget, equipmentMap, machines); const isSimulatedBinding = widget.binding?.mode === 'simulated_value'; const activitySourceKey = isSimulatedBinding ? 'simulated' : `${widget.binding?.bindingVersion ?? 'legacy'}:${widget.binding?.assetId ?? ''}:${widget.binding?.machineId ?? ''}:${widget.binding?.variableKey ?? ''}`; const resolvedActivity = isSimulatedBinding && resolved.value !== null ? { value: resolved.value, provenance: 'configured' as const } : resolvePresentationValue(false, resolved.value, resolveMachineActivityFixtureValue(widget.id)); const activity = useMachineActivity(isLoadingData ? null : resolvedActivity.value, options, { simulated: isSimulatedBinding, sourceKey: `${frame.revisionKey}:${activitySourceKey}` }); const presentationData: MachineActivityPresentationData = { resolved, activity, sourceKey: `${frame.revisionKey}:${activitySourceKey}`, provenance: resolvedActivity.provenance }; const entry = useEntry(widget, 'machine-activity', { data: presentationData }); return <>{render(entry)}</>; }

export function AlertHistoryPresentationController({ widget, equipmentMap, machines, siblingWidgets, render }: PresentationControllerProps) {
    const frame = useDashboardPresentationFrame();
    const alertWidget = widget as AlertHistoryWidgetConfig;
    const dashboardId = alertWidget.displayOptions?.dashboardId ?? 'unknown';
    const pollInterval = alertWidget.displayOptions?.pollInterval ?? 10_000;
    const [state, setState] = useState<AlertHistoryCoordinatorState>({ entries: [], activeSeverity: 'normal' });
    const contextRef = useRef({ widgets: siblingWidgets ?? [], equipmentMap, machines });
    useEffect(() => { contextRef.current = { widgets: siblingWidgets ?? [], equipmentMap, machines }; }, [equipmentMap, machines, siblingWidgets]);
    useEffect(() => { const revisionKey = frame.revisionKey; let active = true; const unsubscribe = subscribeAlertHistory({ dashboardId, pollInterval, getContext: () => contextRef.current, onState: (nextState) => { if (active && frame.revisionKey === revisionKey) setState(nextState); } }); return () => { active = false; unsubscribe(); }; }, [dashboardId, frame.revisionKey, pollInterval]);

    const presentationData: AlertHistoryPresentationData = { ...state, onClear: () => clearAlertHistoryEntries(dashboardId) };
    const entry = useEntry(widget, 'alert-history', { data: presentationData });
    return <>{render(entry)}</>;
}

export function StaticPresentationController({ widget, render }: PresentationControllerProps) {
    const data = widget.type === 'info-card'
        ? { fields: resolveInfoCardFields(widget.displayOptions).map((field) => {
            const content = resolveInfoCardFieldContent(field);
            return { id: field.id, label: field.label, ...content, text: content.text ?? '' };
        }) }
        : undefined;
    const entry = useEntry(widget, 'static', { value: widget.title ?? null, data });
    return <>{render(entry)}</>;
}

export function UnsupportedPresentationController({ widget, render }: PresentationControllerProps) {
    const frame = useDashboardPresentationFrame();
    const entry = useEntry(widget, 'unsupported', { dataSummary: { reason: 'unsupported-presentation-capability' } });

    const diagnosticKey = `${frame.revisionKey}:${widget.id}`;
    const lastDiagnosticKey = useRef<string | null>(null);
    useEffect(() => {
        if (lastDiagnosticKey.current === diagnosticKey) {
            return;
        }

        lastDiagnosticKey.current = diagnosticKey;
        console.warn('Unsupported presentation capability', { widgetId: widget.id, widgetType: widget.type });
    }, [diagnosticKey, widget.id, widget.type]);

    return <>{render(entry)}</>;
}
