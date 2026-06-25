import type { ActivityAnalyticsDisplayOptions } from '../domain/admin.types';
import {
    ACTIVITY_ANALYTICS_DISPLAY_MODE_OPTIONS,
    type ActivityAnalyticsDisplayMode,
} from '../domain/activityAnalytics.types';
import {
    resolveActivityAnalyticsDisplayRules,
} from './activityAnalyticsDisplayRules';

export const DEFAULT_ACTIVITY_ANALYTICS_RANGE = '7d' as const;
export const DEFAULT_ACTIVITY_ANALYTICS_GROUP_BY = 'shift' as const;
export const DEFAULT_ACTIVITY_ANALYTICS_SETUP_THRESHOLD_KW = 0.15;
export const DEFAULT_ACTIVITY_ANALYTICS_PROD_THRESHOLD_KW = 0.25;
export const DEFAULT_ACTIVITY_ANALYTICS_DISPLAY_MODE = 'kpis-and-bars' as const;

export { ACTIVITY_ANALYTICS_DISPLAY_MODE_OPTIONS };

function normalizeActivityAnalyticsDisplayMode(
    displayMode?: string,
): ActivityAnalyticsDisplayMode {
    return ACTIVITY_ANALYTICS_DISPLAY_MODE_OPTIONS.includes(displayMode as ActivityAnalyticsDisplayMode)
        ? displayMode as ActivityAnalyticsDisplayMode
        : DEFAULT_ACTIVITY_ANALYTICS_DISPLAY_MODE;
}

export function createDefaultActivityAnalyticsDisplayOptions(): ActivityAnalyticsDisplayOptions {
    return {
        range: DEFAULT_ACTIVITY_ANALYTICS_RANGE,
        groupBy: DEFAULT_ACTIVITY_ANALYTICS_GROUP_BY,
        setupThresholdKw: DEFAULT_ACTIVITY_ANALYTICS_SETUP_THRESHOLD_KW,
        prodThresholdKw: DEFAULT_ACTIVITY_ANALYTICS_PROD_THRESHOLD_KW,
        displayMode: normalizeActivityAnalyticsDisplayMode(),
    };
}

export function resolveActivityAnalyticsDisplayOptions(
    displayOptions?: ActivityAnalyticsDisplayOptions,
): Required<Pick<ActivityAnalyticsDisplayOptions, 'range' | 'groupBy' | 'setupThresholdKw' | 'prodThresholdKw' | 'displayMode'>> & Pick<ActivityAnalyticsDisplayOptions, 'start' | 'end'> {
    const displayRules = resolveActivityAnalyticsDisplayRules({
        range: displayOptions?.range,
        start: displayOptions?.start,
        end: displayOptions?.end,
        groupBy: displayOptions?.groupBy,
    });

    return {
        range: displayRules.range,
        start: displayOptions?.start,
        end: displayOptions?.end,
        groupBy: displayRules.groupBy,
        setupThresholdKw: displayOptions?.setupThresholdKw ?? DEFAULT_ACTIVITY_ANALYTICS_SETUP_THRESHOLD_KW,
        prodThresholdKw: displayOptions?.prodThresholdKw ?? DEFAULT_ACTIVITY_ANALYTICS_PROD_THRESHOLD_KW,
        displayMode: normalizeActivityAnalyticsDisplayMode(displayOptions?.displayMode),
    };
}
