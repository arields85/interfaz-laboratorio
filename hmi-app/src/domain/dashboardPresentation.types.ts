import type { WidgetConfig, WidgetType } from './admin.types';

export type PresentationCapability =
    | 'scalar'
    | 'status'
    | 'connection'
    | 'trend-chart'
    | 'trend-chart-v2'
    | 'static'
    | 'legacy-presentation'
    | 'unsupported';

export type PresentationScalar = number | string | boolean | null;

export interface PresentationPayload {
    value?: PresentationScalar;
    unit?: string | null;
    data?: unknown;
    dataSummary?: Record<string, unknown> | null;
}

export interface WidgetPresentationEntry {
    widgetId: string; widgetType: WidgetType; capability: PresentationCapability; revisionKey: string;
    widget: WidgetConfig; payload: Readonly<PresentationPayload>;
}

export interface DashboardPresentationFrame {
    dashboardId: string; viewId: string; profileRevision: number; revisionKey: string;
    expectedWidgetIds: readonly string[]; entries: ReadonlyMap<string, WidgetPresentationEntry>; ready: boolean;
}

export function createPresentationEntry(input: {
    widget: WidgetConfig;
    capability: PresentationCapability;
    revisionKey?: string;
    profileRevision?: number;
    payload: PresentationPayload;
}): WidgetPresentationEntry {
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
