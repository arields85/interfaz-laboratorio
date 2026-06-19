import type { ActivityAnalyticsPoint, ActivityAnalyticsResponse, ActivityAnalyticsWindow } from '../domain/activityAnalytics.types';

interface RawActivitySeriesPoint {
    timestamp?: unknown;
    timestampMs?: unknown;
    value?: unknown;
}

interface RawActivitySeriesResponse {
    contractVersion?: unknown;
    machineId?: unknown;
    variableKey?: unknown;
    range?: unknown;
    unit?: unknown;
    purpose?: unknown;
    window?: unknown;
    series?: unknown;
    summary?: unknown;
}

const DEFAULT_CONTRACT_VERSION = '1.0.0';
const DEFAULT_VARIABLE_KEY = 'Total kW';
const ISO_TIMESTAMP_WITH_OFFSET_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export class ActivitySeriesAdapterError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ActivitySeriesAdapterError';
    }
}

export function adaptActivitySeries(raw: unknown): ActivityAnalyticsResponse {
    const response = (raw ?? {}) as RawActivitySeriesResponse;

    if (response.purpose !== 'activity-analytics') {
        throw new ActivitySeriesAdapterError('Activity-series response purpose must be "activity-analytics"');
    }

    const machineId = toPositiveInteger(response.machineId);
    const range = toSupportedRange(response.range);

    if (machineId === null || machineId <= 0 || range === null) {
        throw new ActivitySeriesAdapterError('Activity-series response identity is invalid');
    }

    return {
        contractVersion: toNonEmptyString(response.contractVersion) ?? DEFAULT_CONTRACT_VERSION,
        machineId,
        variableKey: toNonEmptyString(response.variableKey) ?? DEFAULT_VARIABLE_KEY,
        range,
        unit: toNonEmptyString(response.unit),
        purpose: 'activity-analytics',
        window: adaptWindow(response.window),
        series: adaptSeries(response.series),
        summary: response.summary ?? null,
    };
}

function adaptWindow(raw: unknown): ActivityAnalyticsWindow {
    if (!raw || typeof raw !== 'object') {
        throw new ActivitySeriesAdapterError('Activity-series response window is invalid');
    }

    const window = raw as Record<string, unknown>;
    const start = toNonEmptyString(window.start);
    const end = toNonEmptyString(window.end);
    const bucket = toNonEmptyString(window.bucket);
    const bucketMs = toFiniteNumber(window.bucketMs);

    if (!isOffsetBearingIsoTimestamp(start) || !isOffsetBearingIsoTimestamp(end) || !bucket || bucketMs === null || bucketMs <= 0) {
        throw new ActivitySeriesAdapterError('Activity-series response window is invalid');
    }

    const startMs = Date.parse(start);
    const endMs = Date.parse(end);

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
        throw new ActivitySeriesAdapterError('Activity-series response window is invalid');
    }

    return {
        start,
        end,
        timezone: toNonEmptyString(window.timezone) ?? undefined,
        bucket,
        bucketMs,
    };
}

function adaptSeries(raw: unknown): ActivityAnalyticsPoint[] {
    if (!Array.isArray(raw)) {
        throw new ActivitySeriesAdapterError('Activity-series response series must be an array');
    }

    return raw
        .map((point) => {
            if (!point || typeof point !== 'object') {
                throw new ActivitySeriesAdapterError('Activity-series response contains an invalid series point');
            }

            return adaptPoint(point as RawActivitySeriesPoint);
        })
        .sort((left, right) => left.timestampMs - right.timestampMs);
}

function adaptPoint(raw: RawActivitySeriesPoint): ActivityAnalyticsPoint {
    const timestamp = toNonEmptyString(raw.timestamp);
    const timestampMs = toTimestampMs(raw.timestampMs, timestamp);

    if (!isOffsetBearingIsoTimestamp(timestamp) || timestampMs === null) {
        throw new ActivitySeriesAdapterError('Activity-series response contains an invalid series point');
    }

    return {
        timestamp,
        timestampMs,
        value: toNumericOrNull(raw.value),
    };
}

function toSupportedRange(raw: unknown): ActivityAnalyticsResponse['range'] | null {
    switch (raw) {
    case '1h':
    case '24h':
    case '7d':
    case '30d':
    case '12m':
    case 'custom':
        return raw;
    default:
        return null;
    }
}

function toPositiveInteger(raw: unknown): number | null {
    const value = toFiniteNumber(raw);

    if (value === null || !Number.isInteger(value) || value <= 0) {
        return null;
    }

    return value;
}

function toFiniteNumber(raw: unknown): number | null {
    if (typeof raw === 'number') {
        return Number.isFinite(raw) ? raw : null;
    }

    if (typeof raw === 'string' && raw.trim() !== '') {
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

function toNumericOrNull(raw: unknown): number | null {
    if (raw === null || raw === undefined) {
        return null;
    }

    return toFiniteNumber(raw);
}

function toTimestampMs(raw: unknown, fallbackTimestamp: string | null): number | null {
    const parsed = toFiniteNumber(raw);

    if (parsed !== null) {
        return parsed;
    }

    if (!fallbackTimestamp) {
        return null;
    }

    const fallbackMs = Date.parse(fallbackTimestamp);
    return Number.isFinite(fallbackMs) ? fallbackMs : null;
}

function toNonEmptyString(raw: unknown): string | null {
    if (typeof raw !== 'string') {
        return null;
    }

    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
}

function isOffsetBearingIsoTimestamp(value: string | null): value is string {
    return typeof value === 'string' && ISO_TIMESTAMP_WITH_OFFSET_REGEX.test(value);
}
