import type {
    ActivityAnalyticsDurationsMs,
    ActivityAnalyticsInterval,
} from './activityAnalytics';

export interface ActivityAnalyticsShiftSweepBucket {
    startMs: number;
    endMs: number;
}

export interface ActivityAnalyticsShiftBucketAccumulation {
    durationsMs: ActivityAnalyticsDurationsMs;
    estimatedKwh: number;
    stopCount: number;
}

export interface ActivityAnalyticsShiftSweepDiagnostics {
    bucketVisits: number;
    intervalOrderChecks: number;
    intervalVisits: number;
    intersections: number;
    sortedInputCopies: number;
}

export function createActivityAnalyticsShiftSweepDiagnostics(): ActivityAnalyticsShiftSweepDiagnostics {
    return {
        bucketVisits: 0,
        intervalOrderChecks: 0,
        intervalVisits: 0,
        intersections: 0,
        sortedInputCopies: 0,
    };
}

/** @internal Intersection accumulator used by top-level Turno grouping. */
export function accumulateActivityAnalyticsShiftIntersections(options: {
    buckets: readonly ActivityAnalyticsShiftSweepBucket[];
    intervals: readonly ActivityAnalyticsInterval[];
    diagnostics?: ActivityAnalyticsShiftSweepDiagnostics;
}): ActivityAnalyticsShiftBucketAccumulation[] {
    if (options.buckets.length === 0) {
        return [];
    }

    const orderedIntervals = resolveOrderedIntervals(options.intervals, options.diagnostics);
    const accumulations = options.buckets.map(() => createAccumulation());
    let intervalCursor = 0;
    let activeIntervals: ActivityAnalyticsInterval[] = [];

    for (let bucketIndex = 0; bucketIndex < options.buckets.length; bucketIndex += 1) {
        const bucket = options.buckets[bucketIndex];
        const accumulation = accumulations[bucketIndex];

        if (!bucket || !accumulation) {
            continue;
        }

        if (options.diagnostics) {
            options.diagnostics.bucketVisits += 1;
        }

        while (
            intervalCursor < orderedIntervals.length
            && (orderedIntervals[intervalCursor]?.timestampMs ?? Number.POSITIVE_INFINITY) < bucket.endMs
        ) {
            const interval = orderedIntervals[intervalCursor];
            intervalCursor += 1;

            if (interval) {
                activeIntervals.push(interval);
            }
        }

        const nextBucketStartMs = options.buckets[bucketIndex + 1]?.startMs ?? Number.POSITIVE_INFINITY;
        const nextActiveIntervals: ActivityAnalyticsInterval[] = [];

        for (const interval of activeIntervals) {
            if (options.diagnostics) {
                options.diagnostics.intervalVisits += 1;
            }

            const overlapStartMs = Math.max(interval.timestampMs, bucket.startMs);
            const overlapEndMs = Math.min(interval.endTimestampMs, bucket.endMs);
            const overlapDurationMs = overlapEndMs - overlapStartMs;

            if (overlapDurationMs > 0) {
                if (options.diagnostics) {
                    options.diagnostics.intersections += 1;
                }

                addIntersection(accumulation, interval, bucket, overlapDurationMs);
            }

            if (interval.endTimestampMs > nextBucketStartMs) {
                nextActiveIntervals.push(interval);
            }
        }

        activeIntervals = nextActiveIntervals;
    }

    return accumulations;
}

function resolveOrderedIntervals(
    intervals: readonly ActivityAnalyticsInterval[],
    diagnostics: ActivityAnalyticsShiftSweepDiagnostics | undefined,
): readonly ActivityAnalyticsInterval[] {
    for (let index = 1; index < intervals.length; index += 1) {
        if (diagnostics) {
            diagnostics.intervalOrderChecks += 1;
        }

        const previous = intervals[index - 1];
        const current = intervals[index];

        if (previous && current && current.timestampMs < previous.timestampMs) {
            if (diagnostics) {
                diagnostics.sortedInputCopies += 1;
            }

            return [...intervals].sort((left, right) => left.timestampMs - right.timestampMs);
        }
    }

    return intervals;
}

function createAccumulation(): ActivityAnalyticsShiftBucketAccumulation {
    return {
        durationsMs: {
            prod: 0,
            setup: 0,
            stopped: 0,
            noData: 0,
        },
        estimatedKwh: 0,
        stopCount: 0,
    };
}

function addIntersection(
    accumulation: ActivityAnalyticsShiftBucketAccumulation,
    interval: ActivityAnalyticsInterval,
    bucket: ActivityAnalyticsShiftSweepBucket,
    overlapDurationMs: number,
): void {
    const durationKey = interval.state === 'no-data' ? 'noData' : interval.state;
    accumulation.durationsMs[durationKey] += overlapDurationMs;
    accumulation.estimatedKwh += interval.estimatedKwh * (overlapDurationMs / interval.durationMs);

    if (interval.stopCountContribution > 0 && interval.timestampMs >= bucket.startMs && interval.timestampMs < bucket.endMs) {
        accumulation.stopCount += interval.stopCountContribution;
    }
}
