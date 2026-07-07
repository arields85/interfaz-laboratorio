import type { Dashboard, HierarchyNode, WidgetConfig, WidgetLayout } from '../domain/admin.types';
import type { ConnectionHealth, ContractMachine, ContractStatus } from '../domain/dataContract.types';
import type { EquipmentStatus, EquipmentSummary } from '../domain/equipment.types';
import { resolveBinding } from '../widgets/resolvers/bindingResolver';
import { normalizeSimulatedToContractStatus } from '../utils/connectionWidget';
import { normalizeSimulatedEquipmentStatus } from '../utils/statusWidget';

export interface DashboardSnapshotPlacement {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface DashboardSnapshotWidget {
    id: string;
    widgetId: string;
    title: string | null;
    type: WidgetConfig['type'];
    placement: DashboardSnapshotPlacement;
    value: number | string | boolean | null;
    unit: string | null;
    data?: unknown;
    dataSummary?: Record<string, unknown> | null;
}

export interface DashboardSnapshot {
    timestamp: string;
    screen: {
        id: string;
        name: string;
        ownerNodeId?: string;
        ownerNodeName?: string | null;
        ownerNodeType?: string | null;
        activeViewId?: string | null;
        activeViewName?: string | null;
    };
    machine: {
        machineId?: number;
        assetId?: string;
        name: string;
    } | null;
    dashboard: {
        id: string;
        name: string;
        type: Dashboard['dashboardType'];
        aspect: Dashboard['aspect'];
        cols: number;
        rows: number;
        status: Dashboard['status'];
        ownerNodeId?: string;
        activeViewId?: string | null;
        activeViewName?: string | null;
        widgetCount: number;
    };
    widgets: DashboardSnapshotWidget[];
}

export interface BuildDashboardSnapshotInput {
    dashboard: Dashboard;
    connection?: ConnectionHealth;
    machines?: ContractMachine[];
    equipmentMap: Map<string, EquipmentSummary>;
    hierarchyNodes?: HierarchyNode[];
    timestamp?: string;
}

const RUNTIME_ONLY_WIDGET_TYPES = new Set<WidgetConfig['type']>([
    'trend-chart',
    'trend-chart-v2',
    'prod-history',
    'alert-history',
    'machine-activity',
    'activity-analytics',
    'prod-trend',
]);

export function buildDashboardSnapshot({
    dashboard,
    connection,
    machines = [],
    equipmentMap,
    hierarchyNodes = [],
    timestamp = new Date().toISOString(),
}: BuildDashboardSnapshotInput): DashboardSnapshot {
    const layoutByWidgetId = new Map(dashboard.layout.map((layout) => [layout.widgetId, layout]));
    const hierarchyById = new Map(hierarchyNodes.map((node) => [node.id, node]));
    const ownerNode = dashboard.ownerNodeId ? hierarchyById.get(dashboard.ownerNodeId) : undefined;
    const activeView = dashboard.views?.find((view) => view.id === dashboard.activeViewId);

    return {
        timestamp,
        screen: {
            id: dashboard.id,
            name: dashboard.name,
            ownerNodeId: ownerNode?.id,
            ownerNodeName: ownerNode?.name ?? null,
            ownerNodeType: ownerNode?.type ?? null,
            activeViewId: dashboard.activeViewId ?? null,
            activeViewName: activeView?.name ?? null,
        },
        machine: resolveSnapshotMachine(dashboard.widgets, machines, equipmentMap),
        dashboard: {
            id: dashboard.id,
            name: dashboard.name,
            type: dashboard.dashboardType,
            aspect: dashboard.aspect,
            cols: dashboard.cols,
            rows: dashboard.rows,
            status: dashboard.status,
            ownerNodeId: dashboard.ownerNodeId,
            activeViewId: dashboard.activeViewId ?? null,
            activeViewName: activeView?.name ?? null,
            widgetCount: dashboard.widgets.length,
        },
        widgets: dashboard.widgets.map((widget) => buildSnapshotWidget(widget, layoutByWidgetId, equipmentMap, machines, connection)),
    };
}

function buildSnapshotWidget(
    widget: WidgetConfig,
    layoutByWidgetId: Map<string, WidgetLayout>,
    equipmentMap: Map<string, EquipmentSummary>,
    machines: ContractMachine[],
    connection?: ConnectionHealth,
): DashboardSnapshotWidget {
    const placement = resolvePlacement(widget, layoutByWidgetId.get(widget.id));
    const stableExportId = widget.exportId?.trim() || widget.id;
    const exportKind = widget.exportId?.trim() || 'generic-widget';
    const baseWidget: DashboardSnapshotWidget = {
        id: stableExportId,
        widgetId: widget.id,
        title: widget.title?.trim() || null,
        type: widget.type,
        placement,
        value: null,
        unit: null,
    };

    if (stableExportId === 'estado_maquinas') {
        const machineStatuses = resolveMachineStatuses(widget, machines, equipmentMap);

        return {
            ...baseWidget,
            value: machineStatuses.length === 1 ? machineStatuses[0]?.status ?? null : null,
            data: machineStatuses,
            dataSummary: {
                exportKind: stableExportId,
                machineCount: machineStatuses.length,
            },
        };
    }

    if (widget.type === 'status' || stableExportId === 'estado_maquina') {
        const status = resolveEquipmentStatus(widget, equipmentMap);

        return {
            ...baseWidget,
            value: status,
            dataSummary: {
                exportKind,
                source: 'equipment-status',
            },
        };
    }

    if (widget.type === 'connection-status') {
        const resolvedConnectionStatus = resolveConnectionStatus(widget, machines, connection);

        return {
            ...baseWidget,
            value: resolvedConnectionStatus.status,
            dataSummary: {
                exportKind,
                source: resolvedConnectionStatus.source,
                lastSuccess: resolvedConnectionStatus.lastSuccess,
                ageMs: resolvedConnectionStatus.ageMs,
            },
        };
    }

    if (widget.type === 'info-card') {
        const fields = Array.isArray(widget.displayOptions?.fields) ? widget.displayOptions.fields : [];

        return {
            ...baseWidget,
            data: fields,
            dataSummary: {
                exportKind,
                fieldCount: fields.length,
            },
        };
    }

    if (widget.type === 'text-title') {
        return {
            ...baseWidget,
            value: baseWidget.title,
            dataSummary: {
                exportKind,
                source: 'text-config',
            },
        };
    }

    if (RUNTIME_ONLY_WIDGET_TYPES.has(widget.type)) {
        return {
            ...baseWidget,
            dataSummary: {
                exportKind,
                reason: 'runtime-data-not-available-in-builder',
            },
        };
    }

    const resolvedBinding = resolveBinding(widget, equipmentMap, machines);

    return {
        ...baseWidget,
        value: normalizeSnapshotValue(resolvedBinding.value),
        unit: resolvedBinding.unit ?? null,
        dataSummary: {
            exportKind,
            status: resolvedBinding.status,
            source: resolvedBinding.source,
            lastUpdateAt: resolvedBinding.lastUpdateAt ?? null,
            connectionState: resolvedBinding.connectionState ?? null,
        },
    };
}

function resolveSnapshotMachine(
    widgets: WidgetConfig[],
    machines: ContractMachine[],
    equipmentMap: Map<string, EquipmentSummary>,
): DashboardSnapshot['machine'] {
    const machineIds = uniqueNumbers(widgets.map((widget) => widget.binding?.machineId));

    if (machineIds.length === 1) {
        const machine = machines.find((candidate) => candidate.unitId === machineIds[0]);

        if (machine) {
            return {
                machineId: machine.unitId,
                name: machine.name,
            };
        }
    }

    const assetIds = uniqueStrings(widgets.map((widget) => widget.binding?.assetId));

    if (assetIds.length === 1) {
        const equipment = equipmentMap.get(assetIds[0]);

        if (equipment) {
            return {
                assetId: equipment.id,
                name: equipment.name,
            };
        }
    }

    return null;
}

function resolvePlacement(widget: WidgetConfig, layout?: WidgetLayout): DashboardSnapshotPlacement {
    return layout
        ? { x: layout.x, y: layout.y, w: layout.w, h: layout.h }
        : {
            x: widget.position.x,
            y: widget.position.y,
            w: widget.size.w,
            h: widget.size.h,
        };
}

function resolveMachineStatuses(
    widget: WidgetConfig,
    machines: ContractMachine[],
    equipmentMap: Map<string, EquipmentSummary>,
) {
    const boundMachineId = widget.binding?.machineId;

    if (boundMachineId !== undefined) {
        const machine = machines.find((candidate) => candidate.unitId === boundMachineId);

        return machine ? [{ machineId: machine.unitId, name: machine.name, status: machine.status }] : [];
    }

    const boundAssetId = widget.binding?.assetId;

    if (!boundAssetId) {
        return machines.map((machine) => ({ machineId: machine.unitId, name: machine.name, status: machine.status }));
    }

    const equipment = equipmentMap.get(boundAssetId);

    return equipment
        ? [{ assetId: equipment.id, name: equipment.name, status: equipment.status }]
        : [];
}

function resolveEquipmentStatus(
    widget: WidgetConfig,
    equipmentMap: Map<string, EquipmentSummary>,
): EquipmentStatus {
    if (widget.binding?.mode === 'simulated_value') {
        return normalizeSimulatedEquipmentStatus(widget.binding.simulatedValue);
    }

    const equipment = widget.binding?.assetId ? equipmentMap.get(widget.binding.assetId) : undefined;
    return equipment?.status ?? 'unknown';
}

function resolveConnectionStatus(
    widget: WidgetConfig,
    machines: ContractMachine[],
    connection?: ConnectionHealth,
): { status: ContractStatus; source: 'machine' | 'global' | 'simulated'; lastSuccess: string | null; ageMs: number | null } {
    if (widget.binding?.mode === 'simulated_value') {
        return {
            status: normalizeSimulatedToContractStatus(widget.binding.simulatedValue),
            source: 'simulated',
            lastSuccess: null,
            ageMs: null,
        };
    }

    const boundMachineId = widget.binding?.machineId;

    if (boundMachineId !== undefined) {
        const machine = machines.find((candidate) => candidate.unitId === boundMachineId);

        if (machine) {
            return {
                status: machine.status,
                source: 'machine',
                lastSuccess: machine.lastSuccess,
                ageMs: machine.ageMs,
            };
        }
    }

    return {
        status: connection?.globalStatus ?? 'unknown',
        source: 'global',
        lastSuccess: connection?.lastSuccess ?? null,
        ageMs: connection?.ageMs ?? null,
    };
}

function normalizeSnapshotValue(value: number | string | null): number | string | boolean | null {
    return value;
}

function uniqueNumbers(values: Array<number | undefined>): number[] {
    return Array.from(new Set(values.filter((value): value is number => value !== undefined)));
}

function uniqueStrings(values: Array<string | undefined>): string[] {
    return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
