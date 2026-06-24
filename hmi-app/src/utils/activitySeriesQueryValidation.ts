import {
    ACTIVITY_ANALYTICS_PRESET_RANGE_OPTIONS,
    type ActivityAnalyticsCustomQueryParams,
    type ActivityAnalyticsQueryParams,
    type ActivityAnalyticsPresetRange,
    type ActivityAnalyticsQueryDraft,
} from '../domain/activityAnalytics.types';

export const CUSTOM_ACTIVITY_SERIES_MAX_DURATION_DAYS = 30;
export const CUSTOM_ACTIVITY_SERIES_MAX_DURATION_MS = CUSTOM_ACTIVITY_SERIES_MAX_DURATION_DAYS * 24 * 60 * 60 * 1000;

const STRICT_ISO_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type ActivitySeriesQueryValidationError =
    | 'invalid-machine-id'
    | 'invalid-range'
    | 'invalid-timestamp'
    | 'start-not-before-end'
    | 'duration-too-large';

export type ActivitySeriesQueryValidationResult =
    | { ok: true; params: ActivityAnalyticsQueryParams }
    | { ok: false; error: ActivitySeriesQueryValidationError };

export type CustomActivitySeriesWindowValidationResult =
    | { ok: true; startMs: number; endMs: number }
    | { ok: false; error: Extract<ActivitySeriesQueryValidationError, 'invalid-timestamp' | 'start-not-before-end' | 'duration-too-large'> };

const PRESET_RANGES = new Set<string>(ACTIVITY_ANALYTICS_PRESET_RANGE_OPTIONS);

export function validateCustomActivitySeriesWindow(start: string, end: string): CustomActivitySeriesWindowValidationResult {
    if (!isStrictIsoUtcTimestamp(start) || !isStrictIsoUtcTimestamp(end)) {
        return { ok: false, error: 'invalid-timestamp' };
    }

    const startMs = Date.parse(start);
    const endMs = Date.parse(end);

    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        return { ok: false, error: 'invalid-timestamp' };
    }

    if (startMs >= endMs) {
        return { ok: false, error: 'start-not-before-end' };
    }

    if ((endMs - startMs) > CUSTOM_ACTIVITY_SERIES_MAX_DURATION_MS) {
        return { ok: false, error: 'duration-too-large' };
    }

    return { ok: true, startMs, endMs };
}

export function validateAndNormalizeActivitySeriesQueryParams(params: ActivityAnalyticsQueryDraft): ActivitySeriesQueryValidationResult {
    if (!params) {
        return { ok: false, error: 'invalid-range' };
    }

    if (!Number.isSafeInteger(params.machineId) || (params.machineId ?? 0) <= 0) {
        return { ok: false, error: 'invalid-machine-id' };
    }

    if (params.range === 'custom') {
        if (typeof params.start !== 'string' || typeof params.end !== 'string') {
            return { ok: false, error: 'invalid-timestamp' };
        }

        const customWindowValidation = validateCustomActivitySeriesWindow(params.start, params.end);

        if (!customWindowValidation.ok) {
            return customWindowValidation;
        }

        return {
            ok: true,
            params: {
                machineId: params.machineId as number,
                range: 'custom',
                start: params.start,
                end: params.end,
            } satisfies ActivityAnalyticsCustomQueryParams,
        };
    }

    if (!params.range || !PRESET_RANGES.has(params.range)) {
        return { ok: false, error: 'invalid-range' };
    }

    const machineId = params.machineId as number;
    const range = params.range as ActivityAnalyticsPresetRange;

    return {
        ok: true,
        params: {
            machineId,
            range,
        },
    };
}

export function isValidActivitySeriesQueryParams(params: ActivityAnalyticsQueryDraft): boolean {
    return validateAndNormalizeActivitySeriesQueryParams(params).ok;
}

function isStrictIsoUtcTimestamp(value: string): boolean {
    if (!STRICT_ISO_UTC_TIMESTAMP_PATTERN.test(value)) {
        return false;
    }

    const timestampMs = Date.parse(value);

    if (Number.isNaN(timestampMs)) {
        return false;
    }

    return new Date(timestampMs).toISOString() === value;
}
