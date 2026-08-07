import type { ShiftDefinition } from '../domain/admin.types';
import type {
    ActivityAnalyticsGroupBy,
    ActivityAnalyticsPoint,
    ActivityAnalyticsRange,
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

export const MIN_ACTIVITY_ANALYTICS_COMPARABLE_COVERAGE_RATIO = 0.95;

interface ComputeActivityAnalyticsOptions {
    series: ActivityAnalyticsPoint[];
    thresholds: ActivityAnalyticsThresholds;
    range?: ActivityAnalyticsRange;
    groupBy: ActivityAnalyticsGroupBy;
    shifts: ShiftDefinition[];
    timezone: string;
    window: Pick<ActivityAnalyticsWindow, 'start' | 'end' | 'bucketMs'>;
    nowMs?: number;
}

export interface ActivityAnalyticsComparisonEntry {
    bucketKey: string;
    label: string;
}

export interface ActivityAnalyticsSummaryRow {
    bucketKey: string;
    label: string;
    productivityLabel: string;
}

export interface ComputedActivityAnalytics {
    analytics: ActivityAnalyticsResult;
    grouped: ActivityAnalyticsGroupedBucket[];
    comparison: {
        best: ActivityAnalyticsComparisonEntry | null;
        worst: ActivityAnalyticsComparisonEntry | null;
    };
    summaryRows: ActivityAnalyticsSummaryRow[];
    timezone: string;
}

export interface GroupedActivityAnalytics {
    analytics: ActivityAnalyticsResult;
    grouped: ActivityAnalyticsGroupedBucket[];
    timezone: string;
}

export interface GroupBuiltActivityAnalyticsOptions extends Pick<
    ComputeActivityAnalyticsOptions,
    'range' | 'groupBy' | 'shifts' | 'timezone' | 'window' | 'nowMs'
> {
    analytics: ActivityAnalyticsResult;
}

export function computeActivityAnalytics(options: ComputeActivityAnalyticsOptions): ComputedActivityAnalytics {
    const analytics = buildActivityAnalytics({
        series: options.series,
        bucketMs: options.window.bucketMs,
        thresholds: options.thresholds,
    });

    return deriveComputedActivityAnalytics(groupBuiltActivityAnalytics({
        analytics,
        range: options.range,
        groupBy: options.groupBy,
        shifts: options.shifts,
        timezone: options.timezone,
        window: options.window,
        nowMs: options.nowMs,
    }));
}

export function groupBuiltActivityAnalytics(options: GroupBuiltActivityAnalyticsOptions): GroupedActivityAnalytics {
    const shouldApplyRollingCalendarWindowBehavior = shouldApplyRollingCalendarWindowBehaviorForRange(
        options.range,
        options.groupBy,
    );
    const shouldTrimLeadingPartialShiftBucket = shouldTrimLeadingPartialShiftBucketForRange(
        options.range,
        options.groupBy,
    );

    const grouped = groupActivityAnalyticsIntervals({
        intervals: options.analytics.intervals,
        groupBy: options.groupBy,
        timezone: options.timezone,
        shifts: options.shifts,
        windowStartMs: Date.parse(options.window.start),
        windowEndMs: Date.parse(options.window.end),
        nowMs: options.nowMs,
        trimLeadingPartialBucket: shouldApplyRollingCalendarWindowBehavior,
        markTrailingCurrentBucketInProgress: shouldApplyRollingCalendarWindowBehavior,
        trimLeadingPartialShiftBucket: shouldTrimLeadingPartialShiftBucket,
    });

    return {
        analytics: options.analytics,
        grouped,
        timezone: options.timezone,
    };
}

export function deriveComputedActivityAnalytics(groupedAnalytics: GroupedActivityAnalytics): ComputedActivityAnalytics {
    const comparison = resolveActivityAnalyticsComparison(groupedAnalytics.grouped);
    const summaryRows = groupedAnalytics.grouped.map((bucket) => ({
        bucketKey: bucket.bucketKey,
        label: bucket.label,
        productivityLabel: bucket.productivityLabel,
    }));

    return {
        analytics: groupedAnalytics.analytics,
        grouped: groupedAnalytics.grouped,
        comparison,
        summaryRows,
        timezone: groupedAnalytics.timezone,
    };
}

function shouldApplyRollingCalendarWindowBehaviorForRange(
    range: ActivityAnalyticsRange | undefined,
    groupBy: ActivityAnalyticsGroupBy,
): boolean {
    return (range === '7d' && groupBy === 'day')
        || (range === '30d' && groupBy === 'day')
        || (range === '30d' && groupBy === 'week')
        || (range === '12m' && groupBy === 'month');
}

function shouldTrimLeadingPartialShiftBucketForRange(
    range: ActivityAnalyticsRange | undefined,
    groupBy: ActivityAnalyticsGroupBy,
): boolean {
    return groupBy === 'shift' && (range === '24h' || range === '7d');
}

export function resolveActivityAnalyticsComparableProductivityRatio(bucket: ActivityAnalyticsGroupedBucket): number | null {
    if (bucket.isInProgress || bucket.hasInProgressContribution === true) {
        return null;
    }

    if (bucket.productivityRatio === null && isCalendarGroupedBucket(bucket.bucketKey)) {
        return null;
    }

    const observedDurationMs = bucket.durationsMs.prod + bucket.durationsMs.setup + bucket.durationsMs.stopped;

    if (observedDurationMs <= 0) {
        return null;
    }

    if (bucket.coverageRatio < 1 && bucket.coverageRatio < MIN_ACTIVITY_ANALYTICS_COMPARABLE_COVERAGE_RATIO) {
        return null;
    }

    return bucket.durationsMs.prod / observedDurationMs;
}

function isCalendarGroupedBucket(bucketKey: string): boolean {
    return bucketKey.startsWith('day:') || bucketKey.startsWith('week:') || bucketKey.startsWith('month:');
}

export function resolveActivityAnalyticsComparison(grouped: ActivityAnalyticsGroupedBucket[]): ComputedActivityAnalytics['comparison'] {
    const comparableBuckets = grouped
        .map((bucket) => ({
            bucket,
            comparableProductivityRatio: resolveActivityAnalyticsComparableProductivityRatio(bucket),
        }))
        .filter((entry) => entry.comparableProductivityRatio !== null);

    if (comparableBuckets.length < 2) {
        return {
            best: { bucketKey: 'best', label: 'sin comparación' },
            worst: { bucketKey: 'worst', label: 'sin comparación' },
        };
    }

    const sorted = [...comparableBuckets].sort(
        (left, right) => (right.comparableProductivityRatio ?? 0) - (left.comparableProductivityRatio ?? 0),
    );
    const best = sorted[0]?.bucket;
    const worst = sorted[sorted.length - 1]?.bucket;
    const bestComparableRatio = sorted[0]?.comparableProductivityRatio ?? null;
    const worstComparableRatio = sorted[sorted.length - 1]?.comparableProductivityRatio ?? null;

    if (!best || !worst || bestComparableRatio === null || worstComparableRatio === null || bestComparableRatio === worstComparableRatio) {
        return {
            best: { bucketKey: 'best', label: 'sin comparación' },
            worst: { bucketKey: 'worst', label: 'sin comparación' },
        };
    }

    return {
        best: { bucketKey: best.bucketKey, label: best.label },
        worst: { bucketKey: worst.bucketKey, label: worst.label },
    };
}
