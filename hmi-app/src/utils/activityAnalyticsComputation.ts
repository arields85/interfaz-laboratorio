import type { ShiftDefinition } from '../domain/admin.types';
import type {
    ActivityAnalyticsGroupBy,
    ActivityAnalyticsPoint,
    ActivityAnalyticsWindow,
} from '../domain/activityAnalytics.types';
import {
    buildActivityAnalytics,
    type ActivityAnalyticsResult,
    type ActivityAnalyticsThresholds,
} from './activityAnalytics';
import {
    groupActivityAnalyticsIntervals,
    type ActivityAnalyticsGroupedBucket,
} from './activityAnalyticsGrouping';

interface ComputeActivityAnalyticsOptions {
    series: ActivityAnalyticsPoint[];
    thresholds: ActivityAnalyticsThresholds;
    groupBy: ActivityAnalyticsGroupBy;
    shifts: ShiftDefinition[];
    timezone: string;
    window: Pick<ActivityAnalyticsWindow, 'bucketMs'>;
}

export interface ComputedActivityAnalytics {
    analytics: ActivityAnalyticsResult;
    grouped: ActivityAnalyticsGroupedBucket[];
    timezone: string;
}

export function computeActivityAnalytics(options: ComputeActivityAnalyticsOptions): ComputedActivityAnalytics {
    const analytics = buildActivityAnalytics({
        series: options.series,
        bucketMs: options.window.bucketMs,
        thresholds: options.thresholds,
    });

    const grouped = groupActivityAnalyticsIntervals({
        intervals: analytics.intervals,
        groupBy: options.groupBy,
        timezone: options.timezone,
        shifts: options.shifts,
    });

    return {
        analytics,
        grouped,
        timezone: options.timezone,
    };
}
