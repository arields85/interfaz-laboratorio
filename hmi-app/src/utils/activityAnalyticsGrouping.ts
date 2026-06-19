import type { ShiftDefinition, TemporalSettingsConfig } from '../domain/admin.types';
import type { ActivityAnalyticsGroupBy } from '../domain/activityAnalytics.types';
import {
    isValidTimeZone,
    TEMPORAL_SETTINGS_FALLBACK_TIMEZONE,
} from '../config/temporalSettings.config';
import type { ActivityAnalyticsDurationsMs, ActivityAnalyticsInterval } from './activityAnalytics';

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
}: GroupActivityAnalyticsIntervalsOptions): ActivityAnalyticsGroupedBucket[] {
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
        }));
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
            return resolveShiftBucket(options.shifts, options.timezone, localParts);
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

function resolveShiftBucket(
    shifts: ShiftDefinition[],
    timezone: string,
    localParts: { year: number; month: number; day: number; hour: number; minute: number },
): { bucketKey: string; label: string; startMs: number; endMs: number } | null {
    const localMinutes = (localParts.hour * 60) + localParts.minute;

    for (const shift of shifts) {
        const startMinutes = parseShiftMinutes(shift.start);
        const endMinutes = parseShiftMinutes(shift.end);

        if (startMinutes === null || endMinutes === null) {
            continue;
        }

        const crossesMidnight = startMinutes >= endMinutes;
        const containsPoint = crossesMidnight
            ? localMinutes >= startMinutes || localMinutes < endMinutes
            : localMinutes >= startMinutes && localMinutes < endMinutes;

        if (!containsPoint) {
            continue;
        }

        const anchorDate = crossesMidnight && localMinutes < endMinutes
            ? addLocalDays({ ...localParts, hour: 0, minute: 0 }, -1)
            : { ...localParts, hour: 0, minute: 0 };
        const [startHour, startMinute] = shift.start.split(':').map(Number);
        const [endHour, endMinute] = shift.end.split(':').map(Number);
        const start = { ...anchorDate, hour: startHour, minute: startMinute };
        const endBase = { ...anchorDate, hour: endHour, minute: endMinute };
        const end = crossesMidnight ? addLocalDays(endBase, 1) : endBase;
        const keyDate = formatDateKey(anchorDate.year, anchorDate.month, anchorDate.day);

        return {
            bucketKey: `shift:${shift.id}:${keyDate}`,
            label: shift.label,
            startMs: zonedLocalDateTimeToUtcMs(start, timezone),
            endMs: zonedLocalDateTimeToUtcMs(end, timezone),
        };
    }

    return null;
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

function createEmptyDurations(): ActivityAnalyticsDurationsMs {
    return {
        prod: 0,
        setup: 0,
        stopped: 0,
        noData: 0,
    };
}

function parseShiftMinutes(value: string): number | null {
    const [hour, minute] = value.split(':').map(Number);
    return Number.isInteger(hour) && Number.isInteger(minute) ? (hour * 60) + minute : null;
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
