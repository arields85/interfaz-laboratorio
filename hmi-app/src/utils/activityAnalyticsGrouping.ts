import type { ShiftDefinition, TemporalSettingsConfig } from '../domain/admin.types';
import type { ActivityAnalyticsGroupBy } from '../domain/activityAnalytics.types';
import {
    isValidTimeZone,
    TEMPORAL_SETTINGS_FALLBACK_TIMEZONE,
} from '../config/temporalSettings.config';
import type { ActivityAnalyticsDurationsMs, ActivityAnalyticsInterval } from './activityAnalytics';
import { accumulateActivityAnalyticsShiftIntersections } from './activityAnalyticsShiftSweep';
import {
    buildWeeklyShiftIntervalsWithTimezoneContext,
    UNCOVERED_SHIFT_ID,
    UNCOVERED_SHIFT_LABEL,
} from './weeklyShiftSchedule';
import {
    createTimezoneOperationContext,
    getZonedDateTimeParts,
    type TimezoneOperationContext,
} from './timezoneOperationContext';

export interface ActivityAnalyticsGroupedBucket {
    bucketKey: string;
    label: string;
    startMs: number;
    endMs: number;
    durationsMs: ActivityAnalyticsDurationsMs;
    estimatedKwh: number;
    stopCount: number;
    utilizationRatio: number;
    coverageRatio: number;
    expectedDurationMs: number;
    productivityRatio: number | null;
    productivityLabel: string;
    isInProgress: boolean;
    hasInProgressContribution?: boolean;
}

const LIVE_CALENDAR_WINDOW_END_TOLERANCE_MS = 15 * 60 * 1000;

interface ResolveActivityAnalyticsTimezoneOptions {
    temporalSettings: Pick<TemporalSettingsConfig, 'plantTimezone'> | null | undefined;
    windowTimezone?: string;
}

interface GroupActivityAnalyticsIntervalsOptions {
    intervals: ActivityAnalyticsInterval[];
    groupBy: ActivityAnalyticsGroupBy;
    timezone: string;
    shifts: ShiftDefinition[];
    windowStartMs?: number;
    windowEndMs?: number;
    nowMs?: number;
    trimLeadingPartialBucket?: boolean;
    markTrailingCurrentBucketInProgress?: boolean;
    trimLeadingPartialShiftBucket?: boolean;
}

type CalendarActivityAnalyticsGroupBy = Exclude<ActivityAnalyticsGroupBy, 'shift'>;

interface CalendarGroupingBucket {
    bucketKey: string;
    label: string;
    startMs: number;
    endMs: number;
}

export function resolveActivityAnalyticsTimezone({ temporalSettings, windowTimezone }: ResolveActivityAnalyticsTimezoneOptions): string {
    const plantTimezone = temporalSettings?.plantTimezone;

    if (isValidTimeZone(plantTimezone)) {
        return plantTimezone.trim();
    }

    if (isValidTimeZone(windowTimezone)) {
        return windowTimezone.trim();
    }

    return TEMPORAL_SETTINGS_FALLBACK_TIMEZONE;
}

export function groupActivityAnalyticsIntervals({
    intervals,
    groupBy,
    timezone,
    shifts,
    windowStartMs,
    windowEndMs,
    nowMs,
    trimLeadingPartialBucket,
    markTrailingCurrentBucketInProgress,
    trimLeadingPartialShiftBucket,
}: GroupActivityAnalyticsIntervalsOptions): ActivityAnalyticsGroupedBucket[] {
    if (groupBy === 'shift') {
        return groupShiftIntervals({
            intervals,
            timezone,
            shifts,
            windowStartMs,
            windowEndMs,
            nowMs,
            trimLeadingPartialShiftBucket,
        });
    }

    if (intervals.length === 0) {
        return [];
    }

    const grouped = new Map<string, ActivityAnalyticsGroupedBucket>();
    const resolvedNowMs = nowMs ?? Date.now();
    const timezoneContext = createTimezoneOperationContext(timezone);
    const orderedIntervals = [...intervals].sort((left, right) => left.timestampMs - right.timestampMs);
    let activeBucket: CalendarGroupingBucket | null = null;

    for (const interval of orderedIntervals) {
        if (interval.durationMs <= 0) {
            continue;
        }

        let segmentStartMs = interval.timestampMs;
        let isFirstSegment = true;

        while (segmentStartMs < interval.endTimestampMs) {
            if (!activeBucket || segmentStartMs < activeBucket.startMs || segmentStartMs >= activeBucket.endMs) {
                activeBucket = resolveGroupingBucket({
                    timestampMs: segmentStartMs,
                    groupBy,
                    timezoneContext,
                });
            }

            if (activeBucket.endMs <= segmentStartMs) {
                break;
            }

            const segmentEndMs = Math.min(interval.endTimestampMs, activeBucket.endMs);
            const segmentDurationMs = segmentEndMs - segmentStartMs;

            if (segmentDurationMs <= 0) {
                break;
            }

            if (!grouped.has(activeBucket.bucketKey)) {
                grouped.set(activeBucket.bucketKey, {
                    bucketKey: activeBucket.bucketKey,
                    label: activeBucket.label,
                    startMs: activeBucket.startMs,
                    endMs: activeBucket.endMs,
                    durationsMs: createEmptyDurations(),
                    estimatedKwh: 0,
                    stopCount: 0,
                    utilizationRatio: 0,
                    coverageRatio: 0,
                    expectedDurationMs: activeBucket.endMs - activeBucket.startMs,
                    productivityRatio: 0,
                    productivityLabel: '0%',
                    isInProgress: false,
                });
            }

            const target = grouped.get(activeBucket.bucketKey);

            if (!target) {
                break;
            }

            const durationKey = interval.state === 'no-data' ? 'noData' : interval.state;
            target.durationsMs[durationKey] += segmentDurationMs;
            target.estimatedKwh += interval.estimatedKwh * (segmentDurationMs / interval.durationMs);
            target.stopCount += isFirstSegment ? interval.stopCountContribution : 0;

            segmentStartMs = segmentEndMs;
            isFirstSegment = false;
        }
    }

    return trimLeadingPartialCalendarBuckets({
        buckets: Array.from(grouped.values()).sort((left, right) => left.startMs - right.startMs),
        windowStartMs,
        trimLeadingPartialBucket,
    })
        .map((bucket) => finalizeCalendarBucket({
            bucket,
            windowStartMs,
            windowEndMs,
            nowMs: resolvedNowMs,
            markTrailingCurrentBucketInProgress,
        }));
}

function trimLeadingPartialCalendarBuckets(options: {
    buckets: ActivityAnalyticsGroupedBucket[];
    windowStartMs?: number;
    trimLeadingPartialBucket?: boolean;
}): ActivityAnalyticsGroupedBucket[] {
    const { buckets, windowStartMs, trimLeadingPartialBucket = false } = options;

    if (!trimLeadingPartialBucket || windowStartMs === undefined || buckets.length <= 1) {
        return buckets;
    }

    const [firstBucket] = buckets;

    if (!firstBucket) {
        return buckets;
    }

    const windowStartsInsideFirstBucket = windowStartMs > firstBucket.startMs && windowStartMs < firstBucket.endMs;

    if (!windowStartsInsideFirstBucket) {
        return buckets;
    }

    return buckets.slice(1);
}

function finalizeCalendarBucket(options: {
    bucket: ActivityAnalyticsGroupedBucket;
    windowStartMs?: number;
    windowEndMs?: number;
    nowMs: number;
    markTrailingCurrentBucketInProgress?: boolean;
}): ActivityAnalyticsGroupedBucket {
    const { bucket, windowStartMs, windowEndMs, nowMs, markTrailingCurrentBucketInProgress = false } = options;
    const visibleWindowEndMs = windowEndMs ?? nowMs;
    const visibleStartMs = Math.max(bucket.startMs, windowStartMs ?? bucket.startMs);
    const visibleEndMs = Math.min(nowMs, visibleWindowEndMs, bucket.endMs);
    const isInProgress = resolveCalendarBucketInProgress({
        bucket,
        visibleWindowEndMs,
        nowMs,
        markTrailingCurrentBucketInProgress,
    });
    const trackedDurationMs = bucket.durationsMs.prod + bucket.durationsMs.setup + bucket.durationsMs.stopped + bucket.durationsMs.noData;
    const visibleDurationMs = Math.max(0, visibleEndMs - visibleStartMs);
    const durationsMs = {
        ...bucket.durationsMs,
        noData: bucket.durationsMs.noData + Math.max(0, visibleDurationMs - trackedDurationMs),
    };
    const productiveDurationMs = durationsMs.prod + durationsMs.setup + durationsMs.stopped;
    const coverageRatio = visibleDurationMs > 0
        ? Math.min(1, productiveDurationMs / visibleDurationMs)
        : 0;
    const hasIncompleteCoverage = visibleEndMs < bucket.endMs || coverageRatio < 1;
    const productivityRatio = isInProgress || hasIncompleteCoverage
        ? null
        : bucket.expectedDurationMs > 0
            ? durationsMs.prod / bucket.expectedDurationMs
            : 0;

    return {
        ...bucket,
        label: isInProgress ? `${bucket.label} (en curso)` : bucket.label,
        durationsMs,
        utilizationRatio: resolveUtilizationRatio(durationsMs),
        coverageRatio,
        productivityRatio,
        productivityLabel: formatProductivityLabel(productivityRatio, {
            isInProgress,
            hasIncompleteCoverage: !isInProgress && hasIncompleteCoverage,
        }),
        isInProgress,
    };
}

function resolveCalendarBucketInProgress(options: {
    bucket: ActivityAnalyticsGroupedBucket;
    visibleWindowEndMs: number;
    nowMs: number;
    markTrailingCurrentBucketInProgress: boolean;
}): boolean {
    const { bucket, visibleWindowEndMs, nowMs, markTrailingCurrentBucketInProgress } = options;

    if (!markTrailingCurrentBucketInProgress) {
        return false;
    }

    if (nowMs < bucket.startMs || nowMs >= bucket.endMs) {
        return false;
    }

    if (visibleWindowEndMs >= nowMs) {
        return true;
    }

    const isWindowEndInsideSameBucket = visibleWindowEndMs >= bucket.startMs && visibleWindowEndMs < bucket.endMs;

    return isWindowEndInsideSameBucket && (nowMs - visibleWindowEndMs) <= LIVE_CALENDAR_WINDOW_END_TOLERANCE_MS;
}

function groupShiftIntervals(options: {
    intervals: ActivityAnalyticsInterval[];
    timezone: string;
    shifts: ShiftDefinition[];
    windowStartMs?: number;
    windowEndMs?: number;
    nowMs?: number;
    trimLeadingPartialShiftBucket?: boolean;
}): ActivityAnalyticsGroupedBucket[] {
    if (options.intervals.length === 0) {
        return [];
    }

    const timezoneContext = createTimezoneOperationContext(options.timezone);
    const startMs = options.windowStartMs ?? Math.min(...options.intervals.map((interval) => interval.timestampMs));
    const endMs = options.windowEndMs ?? Math.max(...options.intervals.map((interval) => interval.endTimestampMs));
    const resolvedNowMs = options.nowMs ?? Date.now();
    const shiftIntervals = buildWeeklyShiftIntervalsWithTimezoneContext({
        shifts: options.shifts,
        visibleStartMs: startMs,
        visibleEndMs: endMs,
        timezoneContext,
    });

    const timeline = new Array<{
        bucketKey: string;
        label: string;
        startMs: number;
        endMs: number;
        expectedDurationMs: number;
        isInProgress: boolean;
        semanticStartMs: number;
        semanticEndMs: number;
    }>();
    let cursorMs = startMs;

    for (const interval of shiftIntervals) {
        if (interval.startMs > cursorMs) {
            timeline.push(buildUncoveredBucket(cursorMs, interval.startMs, timezoneContext));
        }

        const isInProgress = resolvedNowMs >= interval.semanticStartMs && resolvedNowMs < interval.semanticEndMs;
        const labelBase = `${formatCompactLocalDate(interval.startMs, timezoneContext)} · ${interval.label}`;

        timeline.push({
            bucketKey: interval.bucketKey,
            label: isInProgress ? `${labelBase} (en curso)` : labelBase,
            startMs: interval.startMs,
            endMs: interval.endMs,
            expectedDurationMs: isInProgress
                ? interval.semanticEndMs - interval.semanticStartMs
                : interval.endMs - interval.startMs,
            isInProgress,
            semanticStartMs: interval.semanticStartMs,
            semanticEndMs: interval.semanticEndMs,
        });
        cursorMs = Math.max(cursorMs, interval.endMs);
    }

    if (cursorMs < endMs) {
        timeline.push(buildUncoveredBucket(cursorMs, endMs, timezoneContext));
    }

    const visibleBuckets = trimLeadingPartialShiftBuckets({
        buckets: timeline,
        windowStartMs: options.windowStartMs,
        trimLeadingPartialShiftBucket: options.trimLeadingPartialShiftBucket,
    })
        .filter((bucket) => bucket.endMs > bucket.startMs);
    const accumulations = accumulateActivityAnalyticsShiftIntersections({
        buckets: visibleBuckets,
        intervals: options.intervals,
    });

    return visibleBuckets
        .map((bucket, index) => {
            const accumulation = accumulations[index];

            if (!accumulation) {
                throw new Error('Missing Turno bucket accumulation');
            }

            const coverageRatio = resolveCoverageRatioForExpectedDuration(accumulation.durationsMs, bucket.expectedDurationMs);
            const productivityRatio = bucket.isInProgress || coverageRatio < 1
                ? null
                : accumulation.durationsMs.prod / bucket.expectedDurationMs;

            return {
                bucketKey: bucket.bucketKey,
                label: bucket.label,
                startMs: bucket.startMs,
                endMs: bucket.endMs,
                durationsMs: accumulation.durationsMs,
                estimatedKwh: accumulation.estimatedKwh,
                stopCount: accumulation.stopCount,
                utilizationRatio: resolveUtilizationRatio(accumulation.durationsMs),
                coverageRatio,
                expectedDurationMs: bucket.expectedDurationMs,
                productivityRatio,
                productivityLabel: formatProductivityLabel(productivityRatio, {
                    isInProgress: bucket.isInProgress,
                }),
                isInProgress: bucket.isInProgress,
            };
        })
        .sort((left, right) => left.startMs - right.startMs);
}

function trimLeadingPartialShiftBuckets(options: {
    buckets: Array<{
        bucketKey: string;
        label: string;
        startMs: number;
        endMs: number;
        expectedDurationMs: number;
        isInProgress: boolean;
        semanticStartMs: number;
        semanticEndMs: number;
    }>;
    windowStartMs?: number;
    trimLeadingPartialShiftBucket?: boolean;
}): Array<{
    bucketKey: string;
    label: string;
    startMs: number;
    endMs: number;
    expectedDurationMs: number;
    isInProgress: boolean;
    semanticStartMs: number;
    semanticEndMs: number;
}> {
    const { buckets, windowStartMs, trimLeadingPartialShiftBucket = false } = options;

    if (!trimLeadingPartialShiftBucket || windowStartMs === undefined || buckets.length <= 1) {
        return buckets;
    }

    const [firstBucket] = buckets;

    if (!firstBucket) {
        return buckets;
    }

    const windowStartsInsideFirstBucket = windowStartMs > firstBucket.semanticStartMs && windowStartMs < firstBucket.semanticEndMs;

    if (!windowStartsInsideFirstBucket) {
        return buckets;
    }

    return buckets.slice(1);
}

function resolveGroupingBucket(options: {
    timestampMs: number;
    groupBy: CalendarActivityAnalyticsGroupBy;
    timezoneContext: TimezoneOperationContext;
}): CalendarGroupingBucket {
    const localParts = getZonedDateTimeParts(options.timestampMs, options.timezoneContext);

    switch (options.groupBy) {
    case 'day': {
        const key = formatDateKey(localParts.year, localParts.month, localParts.day);
        const startMs = zonedLocalDateTimeToUtcMs({ ...localParts, hour: 0, minute: 0 }, options.timezoneContext);
        const endMs = zonedLocalDateTimeToUtcMs(addLocalDays({ ...localParts, hour: 0, minute: 0 }, 1), options.timezoneContext);
        return { bucketKey: `day:${key}`, label: formatCompactDate(localParts.day, localParts.month), startMs, endMs };
    }
    case 'week': {
        const weekStart = resolveWeekStart(localParts);
        const key = formatDateKey(weekStart.year, weekStart.month, weekStart.day);
        const startMs = zonedLocalDateTimeToUtcMs({ ...weekStart, hour: 0, minute: 0 }, options.timezoneContext);
        const endMs = zonedLocalDateTimeToUtcMs(addLocalDays({ ...weekStart, hour: 0, minute: 0 }, 7), options.timezoneContext);
        return { bucketKey: `week:${key}`, label: formatCompactDate(weekStart.day, weekStart.month), startMs, endMs };
    }
    case 'month': {
        const key = `${localParts.year}-${pad(localParts.month)}`;
        const start = { year: localParts.year, month: localParts.month, day: 1, hour: 0, minute: 0 };
        const end = localParts.month === 12
            ? { year: localParts.year + 1, month: 1, day: 1, hour: 0, minute: 0 }
            : { year: localParts.year, month: localParts.month + 1, day: 1, hour: 0, minute: 0 };
        return {
            bucketKey: `month:${key}`,
            label: formatCompactMonthYear(localParts.month, localParts.year),
            startMs: zonedLocalDateTimeToUtcMs(start, options.timezoneContext),
            endMs: zonedLocalDateTimeToUtcMs(end, options.timezoneContext),
        };
    }
    }
}

function resolveWeekStart(localParts: { year: number; month: number; day: number }) {
    const utcMidnight = Date.UTC(localParts.year, localParts.month - 1, localParts.day);
    const day = new Date(utcMidnight).getUTCDay();
    const diffToMonday = (day + 6) % 7;
    return addLocalDays({ ...localParts, hour: 0, minute: 0 }, -diffToMonday);
}

function resolveUtilizationRatio(durationsMs: ActivityAnalyticsDurationsMs): number {
    const denominator = durationsMs.prod + durationsMs.setup + durationsMs.stopped;
    return denominator > 0 ? durationsMs.prod / denominator : 0;
}

function resolveCoverageRatioForExpectedDuration(durationsMs: ActivityAnalyticsDurationsMs, expectedDurationMs: number): number {
    if (expectedDurationMs <= 0) {
        return 0;
    }

    const backedDuration = durationsMs.prod + durationsMs.setup + durationsMs.stopped;
    return Math.min(1, backedDuration / expectedDurationMs);
}

function createEmptyDurations(): ActivityAnalyticsDurationsMs {
    return {
        prod: 0,
        setup: 0,
        stopped: 0,
        noData: 0,
    };
}

function buildUncoveredBucket(startMs: number, endMs: number, timezoneContext: TimezoneOperationContext) {
    return {
        bucketKey: `${UNCOVERED_SHIFT_ID}:${formatLocalDateTime(startMs, timezoneContext)}`,
        label: `${formatCompactLocalDate(startMs, timezoneContext)} · ${UNCOVERED_SHIFT_LABEL}`,
        startMs,
        endMs,
        expectedDurationMs: endMs - startMs,
        isInProgress: false,
        semanticStartMs: startMs,
        semanticEndMs: endMs,
    };
}

function formatProductivityLabel(value: number | null, options?: {
    isInProgress?: boolean;
    hasIncompleteCoverage?: boolean;
}): string {
    const { isInProgress = false, hasIncompleteCoverage = false } = options ?? {};

    if (value === null || !Number.isFinite(value)) {
        if (isInProgress) {
            return 'en curso';
        }

        if (hasIncompleteCoverage) {
            return 'cobertura incompleta';
        }

        return 'sin datos';
    }

    if (isInProgress) {
        return 'en curso';
    }

    return `${Math.round(value * 100)}%`;
}

function formatCompactLocalDate(timestampMs: number, timezoneContext: TimezoneOperationContext): string {
    const parts = getZonedDateTimeParts(timestampMs, timezoneContext);
    return formatCompactDate(parts.day, parts.month);
}

function formatLocalDateTime(timestampMs: number, timezoneContext: TimezoneOperationContext): string {
    const parts = getZonedDateTimeParts(timestampMs, timezoneContext);
    return `${formatDateKey(parts.year, parts.month, parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function formatDateKey(year: number, month: number, day: number): string {
    return `${year}-${pad(month)}-${pad(day)}`;
}

function formatCompactDate(day: number, month: number): string {
    return `${pad(day)}/${pad(month)}`;
}

function formatCompactMonthYear(month: number, year: number): string {
    return `${SPANISH_SHORT_MONTH_NAMES[month - 1] ?? pad(month)} ${pad(year % 100)}`;
}

const SPANISH_SHORT_MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;

function pad(value: number): string {
    return value.toString().padStart(2, '0');
}

function addLocalDays(
    localDateTime: { year: number; month: number; day: number; hour: number; minute: number },
    days: number,
): { year: number; month: number; day: number; hour: number; minute: number } {
    const date = new Date(Date.UTC(localDateTime.year, localDateTime.month - 1, localDateTime.day + days, 0, 0, 0, 0));
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: localDateTime.hour,
        minute: localDateTime.minute,
    };
}

function zonedLocalDateTimeToUtcMs(
    localDateTime: { year: number; month: number; day: number; hour: number; minute: number },
    timezoneContext: TimezoneOperationContext,
): number {
    let guessMs = Date.UTC(localDateTime.year, localDateTime.month - 1, localDateTime.day, localDateTime.hour, localDateTime.minute, 0, 0);

    for (let iteration = 0; iteration < 4; iteration += 1) {
        const actual = getZonedDateTimeParts(guessMs, timezoneContext);
        const diffMinutes = (
            Date.UTC(localDateTime.year, localDateTime.month - 1, localDateTime.day, localDateTime.hour, localDateTime.minute)
            - Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute)
        ) / (60 * 1000);

        if (diffMinutes === 0) {
            return guessMs;
        }

        guessMs += diffMinutes * 60 * 1000;
    }

    return guessMs;
}
