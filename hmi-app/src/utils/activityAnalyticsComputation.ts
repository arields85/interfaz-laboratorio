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
        windowStartMs: Date.parse(options.window.start),
        windowEndMs: Date.parse(options.window.end),
        nowMs: options.nowMs,
    });

    const comparison = resolveActivityAnalyticsComparison(grouped);
    const summaryRows = grouped.map((bucket) => ({
        bucketKey: bucket.bucketKey,
        label: bucket.label,
        productivityLabel: bucket.productivityLabel,
    }));

    return {
        analytics,
        grouped,
        comparison,
        summaryRows,
        timezone: options.timezone,
    };
}

function resolveActivityAnalyticsComparison(grouped: ActivityAnalyticsGroupedBucket[]): ComputedActivityAnalytics['comparison'] {
    const comparableBuckets = grouped.filter((bucket) => bucket.productivityRatio !== null);

    if (comparableBuckets.length < 2) {
        return {
            best: { bucketKey: 'best', label: 'sin datos' },
            worst: { bucketKey: 'worst', label: 'sin datos' },
        };
    }

    const sorted = [...comparableBuckets].sort((left, right) => (right.productivityRatio ?? 0) - (left.productivityRatio ?? 0));
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    if (!best || !worst || best.productivityRatio === null || worst.productivityRatio === null || best.productivityRatio === worst.productivityRatio) {
        return {
            best: { bucketKey: 'best', label: 'sin datos' },
            worst: { bucketKey: 'worst', label: 'sin datos' },
        };
    }

    return {
        best: { bucketKey: best.bucketKey, label: best.label },
        worst: { bucketKey: worst.bucketKey, label: worst.label },
    };
}
