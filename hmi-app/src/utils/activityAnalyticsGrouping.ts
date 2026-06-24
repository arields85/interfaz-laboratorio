import type { ShiftDefinition, TemporalSettingsConfig } from '../domain/admin.types';
import type { ActivityAnalyticsGroupBy } from '../domain/activityAnalytics.types';
import {
    isValidTimeZone,
    TEMPORAL_SETTINGS_FALLBACK_TIMEZONE,
} from '../config/temporalSettings.config';
import type { ActivityAnalyticsDurationsMs, ActivityAnalyticsInterval } from './activityAnalytics';
import {
    buildWeeklyShiftIntervals,
    UNCOVERED_SHIFT_ID,
    UNCOVERED_SHIFT_LABEL,
} from './weeklyShiftSchedule';

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
}

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
}: GroupActivityAnalyticsIntervalsOptions): ActivityAnalyticsGroupedBucket[] {
    if (groupBy === 'shift') {
        return groupShiftIntervals({ intervals, timezone, shifts, windowStartMs, windowEndMs, nowMs });
    }

    const grouped = new Map<string, ActivityAnalyticsGroupedBucket>();

    for (const interval of intervals) {
        const segments = splitIntervalAcrossBuckets({ interval, groupBy, timezone, shifts });

        for (const segment of segments) {
            const current = grouped.get(segment.bucket.bucketKey);

            if (!current) {
                grouped.set(segment.bucket.bucketKey, {
                    bucketKey: segment.bucket.bucketKey,
                    label: segment.bucket.label,
                    startMs: segment.bucket.startMs,
                    endMs: segment.bucket.endMs,
                    durationsMs: createEmptyDurations(),
                    estimatedKwh: 0,
                    stopCount: 0,
                    utilizationRatio: 0,
                    coverageRatio: 0,
                    expectedDurationMs: segment.bucket.endMs - segment.bucket.startMs,
                    productivityRatio: 0,
                    productivityLabel: '0%',
                    isInProgress: false,
                });
            }

            const target = grouped.get(segment.bucket.bucketKey);

            if (!target) {
                continue;
            }

            const durationKey = interval.state === 'no-data' ? 'noData' : interval.state;
            target.durationsMs[durationKey] += segment.durationMs;
            target.estimatedKwh += segment.estimatedKwh;
            target.stopCount += segment.stopCountContribution;
        }
    }

    return Array.from(grouped.values())
        .sort((left, right) => left.startMs - right.startMs)
        .map((bucket) => ({
            ...bucket,
            utilizationRatio: resolveUtilizationRatio(bucket.durationsMs),
            coverageRatio: resolveCoverageRatio(bucket.durationsMs),
            productivityRatio: bucket.expectedDurationMs > 0 ? bucket.durationsMs.prod / bucket.expectedDurationMs : 0,
            productivityLabel: formatProductivityLabel(bucket.expectedDurationMs > 0 ? bucket.durationsMs.prod / bucket.expectedDurationMs : 0),
        }));
}

function groupShiftIntervals(options: {
    intervals: ActivityAnalyticsInterval[];
    timezone: string;
    shifts: ShiftDefinition[];
    windowStartMs?: number;
    windowEndMs?: number;
    nowMs?: number;
}): ActivityAnalyticsGroupedBucket[] {
    if (options.intervals.length === 0) {
        return [];
    }

    const startMs = options.windowStartMs ?? Math.min(...options.intervals.map((interval) => interval.timestampMs));
    const endMs = options.windowEndMs ?? Math.max(...options.intervals.map((interval) => interval.endTimestampMs));
    const resolvedNowMs = options.nowMs ?? Date.now();
    const shiftIntervals = buildWeeklyShiftIntervals({
        shifts: options.shifts,
        timezone: options.timezone,
        visibleStartMs: startMs,
        visibleEndMs: endMs,
    });

    const timeline = new Array<{ bucketKey: string; label: string; startMs: number; endMs: number; expectedDurationMs: number; isInProgress: boolean }>();
    let cursorMs = startMs;

    for (const interval of shiftIntervals) {
        if (interval.startMs > cursorMs) {
            timeline.push(buildUncoveredBucket(cursorMs, interval.startMs, options.timezone));
        }

        const isInProgress = resolvedNowMs >= interval.startMs && resolvedNowMs < interval.endMs;
        const labelBase = `${formatLocalDate(interval.startMs, options.timezone)} · ${interval.label}`;

        timeline.push({
            bucketKey: interval.bucketKey,
            label: isInProgress ? `${labelBase} (en curso)` : labelBase,
            startMs: interval.startMs,
            endMs: interval.endMs,
            expectedDurationMs: interval.endMs - interval.startMs,
            isInProgress,
        });
        cursorMs = Math.max(cursorMs, interval.endMs);
    }

    if (cursorMs < endMs) {
        timeline.push(buildUncoveredBucket(cursorMs, endMs, options.timezone));
    }

    return timeline
        .filter((bucket) => bucket.endMs > bucket.startMs)
        .map((bucket) => {
            const durationsMs = createEmptyDurations();
            let estimatedKwh = 0;
            let stopCount = 0;

            for (const interval of options.intervals) {
                const overlapStartMs = Math.max(interval.timestampMs, bucket.startMs);
                const overlapEndMs = Math.min(interval.endTimestampMs, bucket.endMs);
                const overlapDurationMs = overlapEndMs - overlapStartMs;

                if (overlapDurationMs <= 0) {
                    continue;
                }

                const durationKey = interval.state === 'no-data' ? 'noData' : interval.state;
                durationsMs[durationKey] += overlapDurationMs;
                estimatedKwh += interval.estimatedKwh * (overlapDurationMs / interval.durationMs);

                if (interval.stopCountContribution > 0 && interval.timestampMs >= bucket.startMs && interval.timestampMs < bucket.endMs) {
                    stopCount += interval.stopCountContribution;
                }
            }

            const coverageRatio = resolveCoverageRatioForExpectedDuration(durationsMs, bucket.expectedDurationMs);
            const productivityRatio = bucket.isInProgress || coverageRatio < 1
                ? null
                : durationsMs.prod / bucket.expectedDurationMs;

            return {
                bucketKey: bucket.bucketKey,
                label: bucket.label,
                startMs: bucket.startMs,
                endMs: bucket.endMs,
                durationsMs,
                estimatedKwh,
                stopCount,
                utilizationRatio: resolveUtilizationRatio(durationsMs),
                coverageRatio,
                expectedDurationMs: bucket.expectedDurationMs,
                productivityRatio,
                productivityLabel: formatProductivityLabel(productivityRatio),
                isInProgress: bucket.isInProgress,
            };
        })
        .sort((left, right) => left.startMs - right.startMs);
}

function resolveGroupingBucket(options: {
    timestampMs: number;
    groupBy: ActivityAnalyticsGroupBy;
    timezone: string;
    shifts: ShiftDefinition[];
}): { bucketKey: string; label: string; startMs: number; endMs: number } | null {
    const localParts = getZonedDateTimeParts(options.timestampMs, options.timezone);

    switch (options.groupBy) {
    case 'shift':
        return null;
    case 'day': {
        const key = formatDateKey(localParts.year, localParts.month, localParts.day);
        const startMs = zonedLocalDateTimeToUtcMs({ ...localParts, hour: 0, minute: 0 }, options.timezone);
        const endMs = zonedLocalDateTimeToUtcMs(addLocalDays({ ...localParts, hour: 0, minute: 0 }, 1), options.timezone);
        return { bucketKey: `day:${key}`, label: key, startMs, endMs };
    }
    case 'week': {
        const weekStart = resolveWeekStart(localParts);
        const key = formatDateKey(weekStart.year, weekStart.month, weekStart.day);
        const startMs = zonedLocalDateTimeToUtcMs({ ...weekStart, hour: 0, minute: 0 }, options.timezone);
        const endMs = zonedLocalDateTimeToUtcMs(addLocalDays({ ...weekStart, hour: 0, minute: 0 }, 7), options.timezone);
        return { bucketKey: `week:${key}`, label: `Week ${key}`, startMs, endMs };
    }
    case 'month': {
        const key = `${localParts.year}-${pad(localParts.month)}`;
        const start = { year: localParts.year, month: localParts.month, day: 1, hour: 0, minute: 0 };
        const end = localParts.month === 12
            ? { year: localParts.year + 1, month: 1, day: 1, hour: 0, minute: 0 }
            : { year: localParts.year, month: localParts.month + 1, day: 1, hour: 0, minute: 0 };
        return {
            bucketKey: `month:${key}`,
            label: key,
            startMs: zonedLocalDateTimeToUtcMs(start, options.timezone),
            endMs: zonedLocalDateTimeToUtcMs(end, options.timezone),
        };
    }
    }
}

function splitIntervalAcrossBuckets(options: {
    interval: ActivityAnalyticsInterval;
    groupBy: ActivityAnalyticsGroupBy;
    timezone: string;
    shifts: ShiftDefinition[];
}): Array<{
    bucket: { bucketKey: string; label: string; startMs: number; endMs: number };
    durationMs: number;
    estimatedKwh: number;
    stopCountContribution: number;
}> {
    const { interval, groupBy, timezone, shifts } = options;
    const segments: Array<{
        bucket: { bucketKey: string; label: string; startMs: number; endMs: number };
        durationMs: number;
        estimatedKwh: number;
        stopCountContribution: number;
    }> = [];

    if (interval.durationMs <= 0) {
        return segments;
    }

    let segmentStartMs = interval.timestampMs;
    let isFirstSegment = true;

    while (segmentStartMs < interval.endTimestampMs) {
        const bucket = resolveGroupingBucket({
            timestampMs: segmentStartMs,
            groupBy,
            timezone,
            shifts,
        });

        if (!bucket || bucket.endMs <= segmentStartMs) {
            break;
        }

        const segmentEndMs = Math.min(interval.endTimestampMs, bucket.endMs);
        const durationMs = segmentEndMs - segmentStartMs;

        if (durationMs <= 0) {
            break;
        }

        segments.push({
            bucket,
            durationMs,
            estimatedKwh: interval.estimatedKwh * (durationMs / interval.durationMs),
            stopCountContribution: isFirstSegment ? interval.stopCountContribution : 0,
        });

        segmentStartMs = segmentEndMs;
        isFirstSegment = false;
    }

    return segments;
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

function resolveCoverageRatio(durationsMs: ActivityAnalyticsDurationsMs): number {
    const total = durationsMs.prod + durationsMs.setup + durationsMs.stopped + durationsMs.noData;
    return total > 0 ? (total - durationsMs.noData) / total : 0;
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

function buildUncoveredBucket(startMs: number, endMs: number, timezone: string) {
    return {
        bucketKey: `${UNCOVERED_SHIFT_ID}:${formatLocalDateTime(startMs, timezone)}`,
        label: `${formatLocalDate(startMs, timezone)} · ${UNCOVERED_SHIFT_LABEL}`,
        startMs,
        endMs,
        expectedDurationMs: endMs - startMs,
        isInProgress: false,
    };
}

function formatProductivityLabel(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
        return 'sin datos';
    }

    return `${Math.round(value * 100)}%`;
}

function formatLocalDate(timestampMs: number, timezone: string): string {
    const parts = getZonedDateTimeParts(timestampMs, timezone);
    return formatDateKey(parts.year, parts.month, parts.day);
}

function formatLocalDateTime(timestampMs: number, timezone: string): string {
    const parts = getZonedDateTimeParts(timestampMs, timezone);
    return `${formatDateKey(parts.year, parts.month, parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function formatDateKey(year: number, month: number, day: number): string {
    return `${year}-${pad(month)}-${pad(day)}`;
}

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
    timezone: string,
): number {
    let guessMs = Date.UTC(localDateTime.year, localDateTime.month - 1, localDateTime.day, localDateTime.hour, localDateTime.minute, 0, 0);

    for (let iteration = 0; iteration < 4; iteration += 1) {
        const actual = getZonedDateTimeParts(guessMs, timezone);
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

function getZonedDateTimeParts(timestampMs: number, timezone: string): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
} {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    const parts = formatter.formatToParts(new Date(timestampMs));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');

    return {
        year: get('year'),
        month: get('month'),
        day: get('day'),
        hour: get('hour'),
        minute: get('minute'),
    };
}
