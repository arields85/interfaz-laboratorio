import type { WidgetConfig, WidgetType } from './admin.types';
import type { ContractStatus } from './dataContract.types';
import type { ConnectionState, EquipmentStatus } from './equipment.types';
import type { MetricStatus, ResolvedBinding } from './widget.types';

export type PresentationCapability =
    | 'scalar'
    | 'status'
    | 'connection'
    | 'trend-chart'
    | 'trend-chart-v2'
    | 'production-history'
    | 'machine-activity'
    | 'alert-history'
    | 'static'
    | 'activity-analytics'
    | 'prod-trend'
    | 'unsupported';

export type PresentationScalar = number | string | boolean | null;

export interface PresentationPayload {
    value?: PresentationScalar;
    unit?: string | null;
    data?: unknown;
    dataSummary?: Record<string, unknown> | null;
    binding?: ResolvedBinding;
    status?: MetricStatus | EquipmentStatus | ContractStatus;
    lastUpdateAt?: string;
    connectionState?: ConnectionState;
    lastSuccess?: string | null;
    ageMs?: number | null;
    source?: ResolvedBinding['source'];
}

export interface ScalarPresentationPayload extends PresentationPayload {
    value?: PresentationScalar;
    unit?: string | null;
    binding?: ResolvedBinding;
    status?: MetricStatus;
    lastUpdateAt?: string;
    connectionState?: ConnectionState;
    source?: ResolvedBinding['source'];
}

export interface StatusPresentationPayload extends PresentationPayload {
    value?: EquipmentStatus;
    status?: EquipmentStatus;
    source?: ResolvedBinding['source'];
}

export interface ConnectionPresentationPayload extends PresentationPayload {
    value?: ContractStatus;
    status?: ContractStatus;
    lastSuccess?: string | null;
    ageMs?: number | null;
    source?: ResolvedBinding['source'];
}

export interface StaticPresentationPayload extends PresentationPayload {
    value?: string | null;
    data?: {
        fields: ReadonlyArray<{
            id: string;
            label?: string;
            text: string;
            subtext?: string;
            tag?: string;
        }>;
    };
}

export interface WidgetPresentationPayloadByCapability {
    scalar: ScalarPresentationPayload;
    status: StatusPresentationPayload;
    connection: ConnectionPresentationPayload;
    static: StaticPresentationPayload;
    'trend-chart': PresentationPayload;
    'trend-chart-v2': PresentationPayload;
    'production-history': PresentationPayload;
    'machine-activity': PresentationPayload;
    'alert-history': PresentationPayload;
    'activity-analytics': PresentationPayload;
    'prod-trend': PresentationPayload;
    unsupported: PresentationPayload;
}

export interface WidgetPresentationEntry<C extends PresentationCapability = PresentationCapability> {
    widgetId: string; widgetType: WidgetType; capability: C; revisionKey: string;
    widget: WidgetConfig; payload: Readonly<WidgetPresentationPayloadByCapability[C]>;
}

export interface DashboardPresentationFrame {
    dashboardId: string; viewId: string; profileRevision: number; revisionKey: string;
    expectedWidgetIds: readonly string[]; entries: ReadonlyMap<string, WidgetPresentationEntry>; ready: boolean;
}

export function createPresentationEntry<C extends PresentationCapability>(input: {
    widget: WidgetConfig;
    capability: C;
    revisionKey?: string;
    profileRevision?: number;
    payload: WidgetPresentationPayloadByCapability[C];
}): WidgetPresentationEntry<C> {
    const revisionKey = input.revisionKey ?? `profile:${input.profileRevision ?? 0}`;
    return Object.freeze({
        widgetId: input.widget.id,
        widgetType: input.widget.type,
        capability: input.capability,
        revisionKey,
        widget: input.widget,
        payload: Object.freeze({ ...input.payload }),
    });
}
