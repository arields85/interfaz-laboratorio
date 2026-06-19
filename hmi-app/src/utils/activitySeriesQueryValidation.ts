import {
    ACTIVITY_ANALYTICS_PRESET_RANGE_OPTIONS,
    type ActivityAnalyticsPresetQueryParams,
    type ActivityAnalyticsPresetRange,
    type ActivityAnalyticsQueryDraft,
} from '../domain/activityAnalytics.types';

export type ActivitySeriesQueryValidationError = 'invalid-machine-id' | 'invalid-range';

export type ActivitySeriesQueryValidationResult =
    | { ok: true; params: ActivityAnalyticsPresetQueryParams }
    | { ok: false; error: ActivitySeriesQueryValidationError };

const PRESET_RANGES = new Set<string>(ACTIVITY_ANALYTICS_PRESET_RANGE_OPTIONS);

export function validateAndNormalizeActivitySeriesQueryParams(params: ActivityAnalyticsQueryDraft): ActivitySeriesQueryValidationResult {
    if (!params) {
        return { ok: false, error: 'invalid-range' };
    }

    if (!Number.isSafeInteger(params.machineId) || (params.machineId ?? 0) <= 0) {
        return { ok: false, error: 'invalid-machine-id' };
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
