import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClientContext, type QueryClient } from '@tanstack/react-query';
import type { ConnectionHealth, ContractMachine, HistoryQueryParams, HistoryQueryParamsV2 } from '../../domain/dataContract.types';
import type { ActivityAnalyticsGroupBy, ActivityAnalyticsRange, ActivityAnalyticsResponse } from '../../domain/activityAnalytics.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import type { ActivityAnalyticsWidgetConfig, ProdTrendWidgetConfig, WidgetConfig } from '../../domain/admin.types';
import { createPresentationEntry, type PresentationCapability, type WidgetPresentationEntry } from '../../domain/dashboardPresentation.types';
import { usePresentationRegistration, useDashboardPresentationFrame } from '../../services/dashboardPresentationFrame.service';
import { resolveBinding } from '../resolvers/bindingResolver';
import { createDataHistoryQueryOptions, useDataHistory } from '../../queries/useDataHistory';
import { createActivitySeriesQueryOptions, isActivitySeriesResponseCompatible, useActivitySeries } from '../../queries/useActivitySeries';
import { useProdTrendDataSource } from '../../queries/useProdTrendDataSource';
import { resolveActivityAnalyticsDisplayOptions } from '../../utils/activityAnalyticsWidgetDefaults';
import { resolveProdTrendDisplayOptions } from '../../utils/prodTrendWidgetDefaults';
import { normalizeSimulatedEquipmentStatus } from '../../utils/statusWidget';
import { normalizeSimulatedToContractStatus } from '../../utils/connectionWidget';
import { resolveInfoCardFieldContent, resolveInfoCardFields } from '../../utils/infoCardDisplayOptions';
import { buildActivityAnalyticsSimulatedHistory } from '../../utils/activityAnalyticsSimulation';

function createActivityFixture(widgetId: string, machineId: number | undefined, range: ActivityAnalyticsRange, setupThresholdKw: number, prodThresholdKw: number, nowMs: number, customWindow?: { start: string; end: string }) {
    const history = buildActivityAnalyticsSimulatedHistory({ widgetId, machineId, variableKey: 'Total kW', range, customWindow, baseValue: (setupThresholdKw + prodThresholdKw) / 2, operatingLevels: { stopped: setupThresholdKw * 0.2, setup: setupThresholdKw, production: prodThresholdKw }, nowMs });
    return { ...history, contractVersion: 'presentation-fixture', unit: 'kW', purpose: 'activity-analytics' as const, window: { ...history.window, timezone: 'UTC', bucket: 'synthetic' } } as ActivityAnalyticsResponse;
}
function resolvePresentationValue<T>(configured: boolean, response: T | null | undefined, fixture: T) {
    return configured ? { value: fixture, provenance: 'configured' as const } : response ? { value: response, provenance: 'central-read-only' as const } : { value: fixture, provenance: 'deterministic-fixture' as const };
}

export interface PresentationControllerProps {
    widget: WidgetConfig;
    equipmentMap: Map<string, EquipmentSummary>;
    machines?: ContractMachine[];
    connection?: ConnectionHealth;
    queryClient?: QueryClient;
    render: (entry: WidgetPresentationEntry) => ReactNode;
}

function useEntry(widget: WidgetConfig, capability: PresentationCapability, payload: Parameters<typeof createPresentationEntry>[0]['payload']) {
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
    const entry = useEntry(widget, 'scalar', { value: resolved.value, unit: resolved.unit, dataSummary: { status: resolved.status, source: resolved.source } });
    return <>{render(entry)}</>;
}

export function StatusPresentationController({ widget, equipmentMap, render }: PresentationControllerProps) {
    const status = widget.binding?.mode === 'simulated_value'
        ? normalizeSimulatedEquipmentStatus(widget.binding.simulatedValue)
        : equipmentMap.get(widget.binding?.assetId ?? '')?.status ?? 'unknown';
    const entry = useEntry(widget, 'status', { value: typeof status === 'string' ? status : null, dataSummary: { source: 'equipment-status' } });
    return <>{render(entry)}</>;
}

export function ConnectionPresentationController({ widget, connection, machines, render }: PresentationControllerProps) {
    const options = widget.displayOptions as { scope?: 'global' | 'machine'; machineId?: number } | undefined;
    const machine = options?.scope === 'machine' ? machines?.find((item) => item.unitId === options.machineId) : undefined;
    const status = widget.binding?.mode === 'simulated_value'
        ? normalizeSimulatedToContractStatus(widget.binding.simulatedValue)
        : machine?.status ?? connection?.globalStatus ?? 'unknown';
    const entry = useEntry(widget, 'connection', { value: typeof status === 'string' ? status : null, dataSummary: { source: machine ? 'machine' : 'global' } });
    return <>{render(entry)}</>;
}

export function TrendChartController({ widget, render }: PresentationControllerProps) {
    const params = useMemo<HistoryQueryParams | null>(() => widget.binding?.mode === 'real_variable' && widget.binding.machineId !== undefined && widget.binding.variableKey
        ? { machineId: widget.binding.machineId, variableKey: widget.binding.variableKey, range: 'hora' } : null, [widget.binding]);
    const history = useDataHistory(params);
    const entry = useEntry(widget, 'trend-chart', { data: history.data, dataSummary: { isLoading: history.isLoading, isError: history.isError } });
    return <>{render(entry)}</>;
}

export function TrendChartV2Controller({ widget, queryClient, render }: PresentationControllerProps) {
    const params = useMemo<HistoryQueryParamsV2 | null>(() => widget.binding?.mode === 'real_variable' && widget.binding.machineId !== undefined && widget.binding.variableKey
        ? { machineId: widget.binding.machineId, variableKey: widget.binding.variableKey, range: '24h' } : null, [widget.binding]);
    const history = useDataHistory(params);
    useEffect(() => {
        if (params && queryClient) void queryClient.prefetchQuery(createDataHistoryQueryOptions(params));
    }, [params, queryClient]);
    const entry = useEntry(widget, 'trend-chart-v2', { data: history.data, dataSummary: { isLoading: history.isLoading, isError: history.isError } });
    return <>{render(entry)}</>;
}

export function ActivityAnalyticsPresentationController({ widget, machines, queryClient, render }: PresentationControllerProps) {
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
    useEffect(() => {
        if (!client || !activitySeries.isEnabled || options.dataMode === 'simulated' || machineId === undefined || range === '12m') return;
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
    }, [activitySeries.isEnabled, client, frame.revisionKey, machineId, options.dataMode, range]);
    const activeOptions = useMemo(() => ({ ...options, range, groupBy }), [groupBy, options, range]);
    const entry = useEntry(widget, 'activity-analytics', { data: { activitySeries: presentationActivitySeries, displayOptions: activeOptions, turnoMode, onRangeChange: setRange, onGroupByChange: setGroupBy, onTurnoModeChange: setTurnoMode, provenance: resolvedActivity.provenance } });
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
    const entry = useEntry(widget, 'prod-trend', { data: { dataSource: presentationDataSource, displayOptions: { ...resolvedOptions, range, groupBy }, onRangeChange: setRange, onGroupByChange: setGroupBy, provenance: resolvedData.provenance } });
    return <>{render(entry)}</>;
}

export function StaticPresentationController({ widget, render }: PresentationControllerProps) {
    const data = widget.type === 'info-card'
        ? { fields: resolveInfoCardFields(widget.displayOptions).map((field) => ({ ...field, ...resolveInfoCardFieldContent(field) })) }
        : undefined;
    const entry = useEntry(widget, 'static', { value: widget.title ?? null, data });
    return <>{render(entry)}</>;
}

export function LegacyPresentationController({ widget, render }: PresentationControllerProps) {
    const entry = useEntry(widget, 'legacy-presentation', {});
    return <>{render(entry)}</>;
}

export function UnsupportedPresentationController({ widget, render }: PresentationControllerProps) {
    const entry = useEntry(widget, 'unsupported', { dataSummary: { reason: 'unsupported-presentation-capability' } });
    return <>{render(entry)}</>;
}
