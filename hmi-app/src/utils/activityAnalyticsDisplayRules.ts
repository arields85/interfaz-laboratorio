import type { ActivityAnalyticsGroupBy, ActivityAnalyticsRange } from '../domain/activityAnalytics.types';

export type ActivityAnalyticsSupportedRange = Exclude<ActivityAnalyticsRange, '1h'>;

interface ActivityAnalyticsDisplayRuleInput {
    range?: string;
    start?: string;
    end?: string;
    groupBy?: string;
}

export interface ActivityAnalyticsDisplayRules {
    range: ActivityAnalyticsSupportedRange;
    allowedGroups: ActivityAnalyticsGroupBy[];
    fallbackGroup: ActivityAnalyticsGroupBy;
    groupBy: ActivityAnalyticsGroupBy;
    turnoDetailEligible: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const FALLBACK_GROUP_PREFERENCE: ActivityAnalyticsGroupBy[] = ['day', 'week', 'month', 'shift'];

export const ACTIVITY_ANALYTICS_RUNTIME_RANGE_OPTIONS: ActivityAnalyticsSupportedRange[] = ['24h', '7d', '30d', '12m'];

export function normalizeActivityAnalyticsRange(range?: string): ActivityAnalyticsSupportedRange {
    switch (range) {
    case '24h':
    case '7d':
    case '30d':
    case '12m':
    case 'custom':
        return range;
    case '1h':
    default:
        return '24h';
    }
}

export function resolveActivityAnalyticsDisplayRules({
    range,
    start,
    end,
    groupBy,
}: ActivityAnalyticsDisplayRuleInput): ActivityAnalyticsDisplayRules {
    const normalizedRange = normalizeActivityAnalyticsRange(range);
    const effectiveDurationMs = normalizedRange === 'custom' ? resolveCustomDurationMs(start, end) : null;
    const allowedGroups = resolveAllowedGroups(normalizedRange, effectiveDurationMs);
    const fallbackGroup = resolveFallbackGroup(allowedGroups);
    const resolvedGroupBy = isActivityAnalyticsGroupBy(groupBy) && allowedGroups.includes(groupBy)
        ? groupBy
        : fallbackGroup;

    return {
        range: normalizedRange,
        allowedGroups,
        fallbackGroup,
        groupBy: resolvedGroupBy,
        turnoDetailEligible: resolvedGroupBy === 'shift' && (normalizedRange === '24h' || normalizedRange === '7d'),
    };
}

function resolveAllowedGroups(
    range: ActivityAnalyticsSupportedRange,
    customDurationMs: number | null,
): ActivityAnalyticsGroupBy[] {
    switch (range) {
    case '24h':
        return ['shift', 'day'];
    case '7d':
        return ['shift', 'day', 'week'];
    case '30d':
        return ['shift', 'day', 'week', 'month'];
    case '12m':
        return ['shift', 'week', 'month'];
    case 'custom':
        if (customDurationMs === null) {
            return ['day'];
        }

        if (customDurationMs <= DAY_MS) {
            return ['shift', 'day'];
        }

        if (customDurationMs <= WEEK_MS) {
            return ['shift', 'day', 'week'];
        }

        return ['shift', 'day', 'week', 'month'];
    }
}

function resolveFallbackGroup(allowedGroups: ActivityAnalyticsGroupBy[]) {
    return FALLBACK_GROUP_PREFERENCE.find((groupBy) => allowedGroups.includes(groupBy)) ?? allowedGroups[0];
}

function isActivityAnalyticsGroupBy(groupBy?: string): groupBy is ActivityAnalyticsGroupBy {
    return groupBy === 'shift' || groupBy === 'day' || groupBy === 'week' || groupBy === 'month';
}

function resolveCustomDurationMs(start?: string, end?: string): number | null {
    if (!start || !end) {
        return null;
    }

    const startMs = Date.parse(start);
    const endMs = Date.parse(end);

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return null;
    }

    return endMs - startMs;
}
