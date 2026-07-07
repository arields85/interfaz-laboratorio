import type {
    AlertHistoryWidgetConfig,
    Dashboard,
    HierarchyNode,
    InfoCardWidgetConfig,
    MachineActivityWidgetConfig,
    WidgetConfig,
    WidgetLayout,
} from '../domain/admin.types';
import type { AlertHistoryEntry } from '../domain/alertHistory.types';
import type { ConnectionHealth, ContractMachine, ContractStatus } from '../domain/dataContract.types';
import type { EquipmentStatus, EquipmentSummary } from '../domain/equipment.types';
import { alertHistoryStorage } from './AlertHistoryStorageService';
import { resolveBinding } from '../widgets/resolvers/bindingResolver';
import { normalizeSimulatedToContractStatus } from '../utils/connectionWidget';
import { formatAlertHistoryAge, formatAlertHistoryValue, resolveAlertHistoryLevel } from '../utils/alertHistoryFormatting';
import { resolveInfoCardFieldContent, resolveInfoCardFields } from '../utils/infoCardDisplayOptions';
import { normalizeSimulatedEquipmentStatus } from '../utils/statusWidget';
import {
    initializeMachineActivityState,
    resolveMachineActivitySnapshotResult,
    resolveMachineActivityUnits,
} from '../widgets/utils/machineActivityRuntime';

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
    const snapshotTime = new Date(timestamp).getTime();

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
        widgets: dashboard.widgets.map((widget) => buildSnapshotWidget(widget, layoutByWidgetId, equipmentMap, machines, connection, snapshotTime)),
    };
}

function buildSnapshotWidget(
    widget: WidgetConfig,
    layoutByWidgetId: Map<string, WidgetLayout>,
    equipmentMap: Map<string, EquipmentSummary>,
    machines: ContractMachine[],
    connection?: ConnectionHealth,
    snapshotTime?: number,
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

    if (widget.type === 'machine-activity') {
        const machineActivitySnapshot = resolveMachineActivitySnapshot(widget, equipmentMap, machines);

        if (machineActivitySnapshot !== null) {
            return {
                ...baseWidget,
                value: machineActivitySnapshot.value,
                unit: machineActivitySnapshot.unit,
                data: machineActivitySnapshot.data,
                dataSummary: {
                    exportKind,
                    source: machineActivitySnapshot.source,
                    state: machineActivitySnapshot.data.estadoActividad,
                },
            };
        }

        return {
            ...baseWidget,
            dataSummary: {
                exportKind,
                reason: 'runtime-data-not-available-in-builder',
            },
        };
    }

    if (widget.type === 'alert-history') {
        return {
            ...baseWidget,
            data: resolveAlertHistorySnapshot(widget, snapshotTime),
            dataSummary: {
                exportKind,
                source: 'alert-history-storage',
            },
        };
    }

    if (widget.type === 'info-card') {
        const infoCardData = resolveInfoCardSnapshot(widget);

        return {
            ...baseWidget,
            data: infoCardData,
            dataSummary: {
                exportKind,
                fieldCount: infoCardData.fields.length,
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

function resolveMachineActivitySnapshot(
    widget: MachineActivityWidgetConfig,
    equipmentMap: Map<string, EquipmentSummary>,
    machines: ContractMachine[],
): { value: number; unit: string; source: string; data: Record<string, unknown> } | null {
    const resolved = resolveBinding(widget, equipmentMap, machines);
    const opts = widget.displayOptions ?? {};
    const isSimulatedBinding = widget.binding?.mode === 'simulated_value';
    const activity = isSimulatedBinding
        ? initializeMachineActivityState(resolved.value, opts, { simulated: true }).result
        : resolveMachineActivitySnapshotResult(resolved.value, opts);

    if (!activity.isValid) {
        return null;
    }

    const { realUnit } = resolveMachineActivityUnits({
        isSimulatedBinding,
        resolvedUnit: resolved.unit,
        bindingUnit: widget.binding?.unit,
        customUnit: opts.unit,
        unitOverride: opts.unitOverride,
    });

    return {
        value: activity.activityIndex,
        unit: '%',
        source: resolved.source,
        data: {
            estadoActividad: activity.stateLabel,
            actividadPorcentaje: activity.activityIndex,
            potencia: activity.smoothedPower,
            potenciaUnit: realUnit,
        },
    };
}

function resolveAlertHistorySnapshot(widget: AlertHistoryWidgetConfig, snapshotTime?: number): { count: number; items: Array<Record<string, unknown>> } {
    const dashboardId = typeof widget.displayOptions?.dashboardId === 'string'
        ? widget.displayOptions.dashboardId
        : 'unknown';
    const maxVisible = typeof widget.displayOptions?.maxVisible === 'number'
        ? widget.displayOptions.maxVisible
        : 5;
    const entries = alertHistoryStorage.getEntries(dashboardId);

    return {
        count: entries.length,
        items: entries.slice(0, Math.max(0, maxVisible)).map((entry) => serializeAlertHistoryEntry(entry, snapshotTime)),
    };
}

function serializeAlertHistoryEntry(entry: AlertHistoryEntry, snapshotTime?: number) {
    return {
        level: resolveAlertHistoryLevel(entry.toStatus),
        title: entry.widgetTitle,
        age: formatAlertHistoryAge(entry.detectedAt, snapshotTime),
        value: formatAlertHistoryValue(entry.value, entry.unit),
    };
}

interface SnapshotInfoCardField {
    id: string;
    label: string;
    text: string;
    subtext: string;
    tag: string | undefined;
}

interface SnapshotInfoCardData {
    producto?: string;
    orden?: string;
    cliente?: string;
    fields: SnapshotInfoCardField[];
    valuesByFieldId: Record<string, string>;
}

const INFO_CARD_SEMANTIC_TOKEN_MATCHERS: Record<'producto' | 'orden' | 'cliente', ReadonlyArray<(token: string) => boolean>> = {
    producto: [
        (token) => token.includes('producto'),
        (token) => token.includes('receta'),
    ],
    orden: [
        (token) => token.includes('orden'),
        (token) => token === 'op',
        (token) => token.startsWith('op-'),
        (token) => token.includes('lote'),
    ],
    cliente: [
        (token) => token.includes('cliente'),
        (token) => token.includes('customer'),
    ],
};

function hasSemanticToken(
    tokens: string[],
    semanticKey: keyof typeof INFO_CARD_SEMANTIC_TOKEN_MATCHERS,
): boolean {
    return tokens.some((token) => INFO_CARD_SEMANTIC_TOKEN_MATCHERS[semanticKey].some((matches) => matches(token)));
}

function resolveInfoCardSnapshot(widget: InfoCardWidgetConfig): SnapshotInfoCardData {
    const fields = resolveInfoCardFields(widget.displayOptions).map((field) => {
        const content = resolveInfoCardFieldContent(field);

        return {
            id: field.id,
            label: field.label,
            text: content.text ?? '',
            subtext: content.subtext,
            tag: content.tag,
        };
    });

    const valuesByFieldId = Object.fromEntries(fields.map((field) => [field.id, field.text]));
    const semanticValues = Object.fromEntries(
        fields
            .map((field) => {
                const semanticKey = resolveInfoCardSemanticKey(widget, field);

                return semanticKey ? [semanticKey, field.text] : null;
            })
            .filter((entry): entry is [string, string] => entry !== null),
    );

    return {
        ...semanticValues,
        fields,
        valuesByFieldId,
    };
}

function resolveInfoCardSemanticKey(
    widget: InfoCardWidgetConfig,
    field: SnapshotInfoCardField,
): 'producto' | 'orden' | 'cliente' | null {
    const exportId = widget.exportId?.trim();
    const searchTokens = [field.id, field.label, field.subtext, field.tag]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map(normalizeSemanticToken);

    if (exportId === 'producto_receta') {
        if (hasSemanticToken(searchTokens, 'producto')) {
            return 'producto';
        }

        if (hasSemanticToken(searchTokens, 'orden')) {
            return 'orden';
        }

        if (hasSemanticToken(searchTokens, 'cliente')) {
            return 'cliente';
        }
    }

    return null;
}

function normalizeSemanticToken(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function uniqueNumbers(values: Array<number | undefined>): number[] {
    return Array.from(new Set(values.filter((value): value is number => value !== undefined)));
}

function uniqueStrings(values: Array<string | undefined>): string[] {
    return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
