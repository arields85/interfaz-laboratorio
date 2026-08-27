import { useEffect, useMemo, type ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { ConnectionHealth, ContractMachine, HistoryQueryParams, HistoryQueryParamsV2 } from '../../domain/dataContract.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import type { WidgetConfig } from '../../domain/admin.types';
import { createPresentationEntry, type PresentationCapability, type PresentationPayload, type WidgetPresentationEntry } from '../../domain/dashboardPresentation.types';
import { usePresentationRegistration, useDashboardPresentationFrame } from '../../services/dashboardPresentationFrame.service';
import { resolveBinding } from '../resolvers/bindingResolver';
import { createDataHistoryQueryOptions, useDataHistory } from '../../queries/useDataHistory';
import { normalizeSimulatedEquipmentStatus } from '../../utils/statusWidget';
import { normalizeSimulatedToContractStatus } from '../../utils/connectionWidget';
import { resolveInfoCardFieldContent, resolveInfoCardFields } from '../../utils/infoCardDisplayOptions';

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
    const payloadKey = JSON.stringify(payload);
    const entry = useMemo(() => createPresentationEntry({ widget, capability, revisionKey: frame.revisionKey, payload: JSON.parse(payloadKey) as PresentationPayload }), [capability, frame.revisionKey, payloadKey, widget]);
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
