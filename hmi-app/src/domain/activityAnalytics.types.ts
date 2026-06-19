export type ActivityAnalyticsRange = '1h' | '24h' | '7d' | '30d' | '12m' | 'custom';
export type ActivityAnalyticsPresetRange = Exclude<ActivityAnalyticsRange, 'custom'>;
export type ActivityAnalyticsGroupBy = 'shift' | 'day' | 'week' | 'month';
export type ActivityAnalyticsState = 'prod' | 'setup' | 'stopped' | 'no-data';
export type ActivityAnalyticsDisplayMode = 'kpis-and-bars';

export const ACTIVITY_ANALYTICS_RANGE_OPTIONS: ActivityAnalyticsRange[] = ['1h', '24h', '7d', '30d', '12m', 'custom'];
export const ACTIVITY_ANALYTICS_PRESET_RANGE_OPTIONS: ActivityAnalyticsPresetRange[] = ['1h', '24h', '7d', '30d', '12m'];
export const ACTIVITY_ANALYTICS_GROUP_BY_OPTIONS: ActivityAnalyticsGroupBy[] = ['shift', 'day', 'week', 'month'];
export const ACTIVITY_ANALYTICS_DISPLAY_MODE_OPTIONS: ActivityAnalyticsDisplayMode[] = ['kpis-and-bars'];

export interface ActivityAnalyticsWindow {
    start: string;
    end: string;
    timezone?: string;
    bucket: string;
    bucketMs: number;
}

export interface ActivityAnalyticsPoint {
    timestamp: string;
    timestampMs: number;
    value: number | null;
}

export interface ActivityAnalyticsResponse {
    contractVersion: string;
    machineId: number;
    variableKey: string;
    range: ActivityAnalyticsRange;
    unit: string | null;
    purpose: 'activity-analytics';
    window: ActivityAnalyticsWindow;
    series: ActivityAnalyticsPoint[];
    summary: unknown;
}

export interface ActivityAnalyticsPresetQueryParams {
    machineId: number;
    range: ActivityAnalyticsPresetRange;
}

export interface ActivityAnalyticsCustomQueryParams {
    machineId: number;
    range: 'custom';
    start: string;
    end: string;
}

export type ActivityAnalyticsQueryParams = ActivityAnalyticsPresetQueryParams | ActivityAnalyticsCustomQueryParams;
export type ActivityAnalyticsQueryDraft = {
    machineId?: number;
    range?: ActivityAnalyticsRange;
    start?: string;
    end?: string;
} | null;
