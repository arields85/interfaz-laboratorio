import type { ShiftDefinition, TrendChartV2ShiftDisplayMode } from '../domain/admin.types';
import type { HistoryDataPointV2 } from '../domain/dataContract.types';

const DAY_MS = 24 * 60 * 60 * 1000;

export type TrendChartV2ResolvedShiftDisplayMode = 'bands' | 'lines';

export const TREND_CHART_V2_SHIFT_DISPLAY_MODE_LABELS: Record<TrendChartV2ShiftDisplayMode, string> = {
    auto: 'Auto',
    bands: 'Bandas',
    lines: 'Líneas',
};

export interface TrendChartV2ShiftInterval {
    shiftId: string;
    label: string;
    startMs: number;
    endMs: number;
}

export interface TrendChartV2VisibleShiftSummary {
    shiftId: string;
    label: string;
    count: number;
    last: number;
    min: number;
    max: number;
    avg: number;
}

interface BuildTrendChartV2ShiftIntervalsOptions {
    shifts: ShiftDefinition[];
    timezone: string;
    visibleStartMs: number;
    visibleEndMs: number;
}

interface ResolveTrendChartV2ShiftDisplayModeOptions {
    displayMode: TrendChartV2ShiftDisplayMode;
    intervalCount: number;
    visibleDurationMs: number;
}

interface ResolveTrendChartV2TooltipShiftLabelOptions {
    timestampMs: number;
    shifts: ShiftDefinition[];
    timezone: string;
}

interface BuildTrendChartV2VisibleShiftSummaryOptions {
    points: HistoryDataPointV2[];
    shifts: ShiftDefinition[];
    timezone: string;
}

export function buildTrendChartV2ShiftIntervals({
    shifts,
    timezone,
    visibleStartMs,
    visibleEndMs,
}: BuildTrendChartV2ShiftIntervalsOptions): TrendChartV2ShiftInterval[] {
    if (shifts.length === 0 || visibleEndMs <= visibleStartMs) {
        return [];
    }

    const localDates = collectVisibleLocalDates(visibleStartMs, visibleEndMs, timezone);
    const intervals = localDates.flatMap((localDate) => {
        return shifts.flatMap((shift) => {
            const localStart = buildLocalDateTimeParts(localDate, shift.start);
            const localEnd = buildLocalDateTimeParts(localDate, shift.end);
            const startMs = zonedLocalDateTimeToUtcMs(localStart, timezone);
            const endLocalDate = compareLocalDateTime(localEnd, localStart) <= 0
                ? addLocalDays(localEnd, 1)
                : localEnd;
            const endMs = zonedLocalDateTimeToUtcMs(endLocalDate, timezone);
            const clippedStartMs = Math.max(startMs, visibleStartMs);
            const clippedEndMs = Math.min(endMs, visibleEndMs);

            if (clippedEndMs <= clippedStartMs) {
                return [];
            }

            return [{
                shiftId: shift.id,
                label: shift.label,
                startMs: clippedStartMs,
                endMs: clippedEndMs,
            }];
        });
    });

    return intervals.sort((left, right) => left.startMs - right.startMs);
}

export function resolveTrendChartV2ShiftDisplayMode({
    displayMode,
    intervalCount,
    visibleDurationMs,
}: ResolveTrendChartV2ShiftDisplayModeOptions): TrendChartV2ResolvedShiftDisplayMode {
    if (displayMode !== 'auto') {
        return displayMode;
    }

    if (intervalCount > 12 || visibleDurationMs > (7 * DAY_MS)) {
        return 'lines';
    }

    return 'bands';
}

export function normalizeTrendChartV2ShiftDisplayMode(value: unknown): TrendChartV2ShiftDisplayMode {
    return value === 'bands' || value === 'lines' || value === 'auto'
        ? value
        : 'auto';
}

export function resolveTrendChartV2TooltipShiftLabel({
    timestampMs,
    shifts,
    timezone,
}: ResolveTrendChartV2TooltipShiftLabelOptions): string | null {
    const assignment = resolveShiftAssignment(timestampMs, shifts, timezone);
    return assignment?.label ?? null;
}

export function buildTrendChartV2VisibleShiftSummary({
    points,
    shifts,
    timezone,
}: BuildTrendChartV2VisibleShiftSummaryOptions): TrendChartV2VisibleShiftSummary[] {
    const summaries = new Map<string, TrendChartV2VisibleShiftSummary>();

    for (const point of points) {
        if (typeof point.value !== 'number' || !Number.isFinite(point.value)) {
            continue;
        }

        const assignment = resolveShiftAssignment(point.timestampMs, shifts, timezone);

        if (!assignment) {
            continue;
        }

        const current = summaries.get(assignment.shiftId);

        if (!current) {
            summaries.set(assignment.shiftId, {
                shiftId: assignment.shiftId,
                label: assignment.label,
                count: 1,
                last: point.value,
                min: point.value,
                max: point.value,
                avg: point.value,
            });
            continue;
        }

        const total = (current.avg * current.count) + point.value;
        current.count += 1;
        current.last = point.value;
        current.min = Math.min(current.min, point.value);
        current.max = Math.max(current.max, point.value);
        current.avg = roundToTwoDecimals(total / current.count);
    }

    return Array.from(summaries.values());
}

function resolveShiftAssignment(timestampMs: number, shifts: ShiftDefinition[], timezone: string): { shiftId: string; label: string } | null {
    if (shifts.length === 0) {
        return null;
    }

    const localParts = getZonedDateTimeParts(timestampMs, timezone);
    const localMinutes = (localParts.hour * 60) + localParts.minute;

    for (const shift of shifts) {
        const startMinutes = parseShiftMinutes(shift.start);
        const endMinutes = parseShiftMinutes(shift.end);

        if (startMinutes === null || endMinutes === null) {
            continue;
        }

        const containsPoint = startMinutes < endMinutes
            ? localMinutes >= startMinutes && localMinutes < endMinutes
            : localMinutes >= startMinutes || localMinutes < endMinutes;

        if (containsPoint) {
            return { shiftId: shift.id, label: shift.label };
        }
    }

    return null;
}

function collectVisibleLocalDates(visibleStartMs: number, visibleEndMs: number, timezone: string): Array<{ year: number; month: number; day: number }> {
    const uniqueDates = new Map<string, { year: number; month: number; day: number }>();

    for (let cursor = visibleStartMs - DAY_MS; cursor <= visibleEndMs + DAY_MS; cursor += 12 * 60 * 60 * 1000) {
        const parts = getZonedDateTimeParts(cursor, timezone);
        const key = `${parts.year}-${parts.month}-${parts.day}`;

        if (!uniqueDates.has(key)) {
            uniqueDates.set(key, { year: parts.year, month: parts.month, day: parts.day });
        }
    }

    return Array.from(uniqueDates.values()).sort((left, right) => (
        Date.UTC(left.year, left.month - 1, left.day) - Date.UTC(right.year, right.month - 1, right.day)
    ));
}

function parseShiftMinutes(value: string): number | null {
    const [hours, minutes] = value.split(':').map(Number);

    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
        return null;
    }

    return (hours * 60) + minutes;
}

function buildLocalDateTimeParts(
    localDate: { year: number; month: number; day: number },
    time: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
    const [hour, minute] = time.split(':').map(Number);

    return {
        ...localDate,
        hour,
        minute,
    };
}

function zonedLocalDateTimeToUtcMs(localDateTime: { year: number; month: number; day: number; hour: number; minute: number }, timezone: string): number {
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

function getZonedDateTimeParts(timestampMs: number, timezone: string): { year: number; month: number; day: number; hour: number; minute: number } {
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

function addLocalDays(localDateTime: { year: number; month: number; day: number; hour: number; minute: number }, days: number) {
    const date = new Date(Date.UTC(localDateTime.year, localDateTime.month - 1, localDateTime.day + days, localDateTime.hour, localDateTime.minute));
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: localDateTime.hour,
        minute: localDateTime.minute,
    };
}

function compareLocalDateTime(
    left: { year: number; month: number; day: number; hour: number; minute: number },
    right: { year: number; month: number; day: number; hour: number; minute: number },
) {
    return Date.UTC(left.year, left.month - 1, left.day, left.hour, left.minute)
        - Date.UTC(right.year, right.month - 1, right.day, right.hour, right.minute);
}

function roundToTwoDecimals(value: number): number {
    return Math.round(value * 100) / 100;
}
