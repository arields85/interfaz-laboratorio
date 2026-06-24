import type { ShiftDefinition, WeekdayKey } from '../domain/admin.types';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export const ALL_WEEKDAY_KEYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const UNCOVERED_SHIFT_ID = 'sin-turno';
export const UNCOVERED_SHIFT_LABEL = 'sin turno';

export interface WeeklyShiftAssignment {
    shiftId: string;
    label: string;
    bucketKey: string;
    startMs: number;
    endMs: number;
}

export interface WeeklyShiftInterval {
    shiftId: string;
    label: string;
    bucketKey: string;
    startMs: number;
    endMs: number;
}

export function normalizeWeekdays(value: unknown): WeekdayKey[] {
    if (value === undefined) {
        return [...ALL_WEEKDAY_KEYS];
    }

    if (!Array.isArray(value)) {
        return [];
    }

    const normalized = value.filter((entry): entry is WeekdayKey => ALL_WEEKDAY_KEYS.includes(entry as WeekdayKey));
    return ALL_WEEKDAY_KEYS.filter((weekday) => normalized.includes(weekday));
}

export function normalizeShiftDefinitionWithWeekdays(shift: ShiftDefinition): ShiftDefinition {
    return {
        ...shift,
        weekdays: normalizeWeekdays(shift.weekdays),
    };
}

export function validateWeeklyShiftSchedule(shifts: ShiftDefinition[]): { ok: true } | { ok: false; error: string } {
    const normalized = shifts.map(normalizeShiftDefinitionWithWeekdays);

    if (normalized.some((shift) => (shift.weekdays?.length ?? 0) === 0)) {
        return { ok: false, error: 'Each shift must apply to at least one weekday.' };
    }

    const segments = normalized.flatMap((shift) => buildWeeklyValidationSegments(shift));
    const sorted = segments.sort((left, right) => left.startMinute - right.startMinute);

    for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const current = sorted[index];

        if (previous && current && current.startMinute < previous.endMinute) {
            return { ok: false, error: 'Shift windows cannot overlap after weekly expansion.' };
        }
    }

    return { ok: true };
}

export function resolveWeeklyShiftAssignment(options: {
    timestampMs: number;
    shifts: ShiftDefinition[];
    timezone: string;
}): WeeklyShiftAssignment {
    const { timestampMs, timezone } = options;
    const shifts = options.shifts.map(normalizeShiftDefinitionWithWeekdays);
    const localParts = getZonedDateTimeParts(timestampMs, timezone);
    const localMinutes = (localParts.hour * 60) + localParts.minute;
    const localDateKey = formatDateKey(localParts.year, localParts.month, localParts.day);
    const localTimeKey = `${pad(localParts.hour)}:${pad(localParts.minute)}`;
    const localWeekday = WEEKDAY_INDEX_TO_KEY[localParts.weekday];
    const previousLocalDate = addLocalDays({ ...localParts, hour: 0, minute: 0 }, -1);
    const previousWeekday = WEEKDAY_INDEX_TO_KEY[(localParts.weekday + 6) % 7];

    for (const shift of shifts) {
        const startMinutes = parseShiftMinutes(shift.start);
        const endMinutes = parseShiftMinutes(shift.end);

        if (startMinutes === null || endMinutes === null) {
            continue;
        }

        const weekdays = shift.weekdays ?? [];
        const crossesMidnight = startMinutes >= endMinutes;

        if (!crossesMidnight && weekdays.includes(localWeekday) && localMinutes >= startMinutes && localMinutes < endMinutes) {
            const anchorDate = { ...localParts, hour: 0, minute: 0 };
            return buildAssignment({ shift, anchorDate, timezone, crossesMidnight: false });
        }

        if (!crossesMidnight) {
            continue;
        }

        if (localMinutes >= startMinutes && weekdays.includes(localWeekday)) {
            const anchorDate = { ...localParts, hour: 0, minute: 0 };
            return buildAssignment({ shift, anchorDate, timezone, crossesMidnight: true });
        }

        if (localMinutes < endMinutes && weekdays.includes(previousWeekday)) {
            return buildAssignment({ shift, anchorDate: previousLocalDate, timezone, crossesMidnight: true });
        }
    }

    return {
        shiftId: UNCOVERED_SHIFT_ID,
        label: UNCOVERED_SHIFT_LABEL,
        bucketKey: `${UNCOVERED_SHIFT_ID}:${localDateKey}T${localTimeKey}`,
        startMs: timestampMs,
        endMs: timestampMs,
    };
}

export function buildWeeklyShiftIntervals(options: {
    shifts: ShiftDefinition[];
    timezone: string;
    visibleStartMs: number;
    visibleEndMs: number;
}): WeeklyShiftInterval[] {
    const { timezone, visibleStartMs, visibleEndMs } = options;

    if (visibleEndMs <= visibleStartMs) {
        return [];
    }

    const shifts = options.shifts.map(normalizeShiftDefinitionWithWeekdays);
    const localDates = collectVisibleLocalDates(visibleStartMs, visibleEndMs, timezone);

    return localDates
        .flatMap((localDate) => {
            const weekday = WEEKDAY_INDEX_TO_KEY[getLocalWeekdayIndex(localDate)];

            return shifts.flatMap((shift) => {
                if (!(shift.weekdays ?? []).includes(weekday)) {
                    return [];
                }

                const assignment = buildAssignment({
                    shift,
                    anchorDate: { ...localDate, hour: 0, minute: 0 },
                    timezone,
                    crossesMidnight: parseShiftMinutes(shift.start)! >= parseShiftMinutes(shift.end)!,
                });
                const clippedStartMs = Math.max(assignment.startMs, visibleStartMs);
                const clippedEndMs = Math.min(assignment.endMs, visibleEndMs);

                if (clippedEndMs <= clippedStartMs) {
                    return [];
                }

                return [{
                    shiftId: assignment.shiftId,
                    label: assignment.label,
                    bucketKey: assignment.bucketKey,
                    startMs: clippedStartMs,
                    endMs: clippedEndMs,
                }];
            });
        })
        .sort((left, right) => left.startMs - right.startMs);
}

function buildAssignment(options: {
    shift: ShiftDefinition;
    anchorDate: { year: number; month: number; day: number; hour: number; minute: number };
    timezone: string;
    crossesMidnight: boolean;
}): WeeklyShiftAssignment {
    const { shift, anchorDate, timezone, crossesMidnight } = options;
    const [startHour, startMinute] = shift.start.split(':').map(Number);
    const [endHour, endMinute] = shift.end.split(':').map(Number);
    const start = { ...anchorDate, hour: startHour, minute: startMinute };
    const end = crossesMidnight
        ? addLocalDays({ ...anchorDate, hour: endHour, minute: endMinute }, 1)
        : { ...anchorDate, hour: endHour, minute: endMinute };
    const keyDate = formatDateKey(anchorDate.year, anchorDate.month, anchorDate.day);

    return {
        shiftId: shift.id,
        label: shift.label,
        bucketKey: `shift:${shift.id}:${keyDate}`,
        startMs: zonedLocalDateTimeToUtcMs(start, timezone),
        endMs: zonedLocalDateTimeToUtcMs(end, timezone),
    };
}

function buildWeeklyValidationSegments(shift: ShiftDefinition): Array<{ startMinute: number; endMinute: number }> {
    const startMinutes = parseShiftMinutes(shift.start);
    const endMinutes = parseShiftMinutes(shift.end);

    if (startMinutes === null || endMinutes === null) {
        return [];
    }

    const crossesMidnight = startMinutes >= endMinutes;

    return (shift.weekdays ?? []).flatMap((weekday) => {
        const dayStartMinute = ALL_WEEKDAY_KEYS.indexOf(weekday) * 24 * 60;
        const startMinute = dayStartMinute + startMinutes;
        const rawEndMinute = dayStartMinute + endMinutes + (crossesMidnight ? 24 * 60 : 0);

        if (rawEndMinute <= (7 * 24 * 60)) {
            return [{ startMinute, endMinute: rawEndMinute }];
        }

        return [
            { startMinute, endMinute: 7 * 24 * 60 },
            { startMinute: 0, endMinute: rawEndMinute - (7 * 24 * 60) },
        ];
    });
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

function getLocalWeekdayIndex(localDate: { year: number; month: number; day: number }): number {
    return (new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day)).getUTCDay() + 6) % 7;
}

const WEEKDAY_INDEX_TO_KEY: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function parseShiftMinutes(value: string): number | null {
    const [hours, minutes] = value.split(':').map(Number);

    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
        return null;
    }

    return (hours * 60) + minutes;
}

function formatDateKey(year: number, month: number, day: number): string {
    return `${year}-${pad(month)}-${pad(day)}`;
}

function pad(value: number): string {
    return value.toString().padStart(2, '0');
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

function getZonedDateTimeParts(timestampMs: number, timezone: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });

    const parts = formatter.formatToParts(new Date(timestampMs));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';

    return {
        year: Number(get('year')),
        month: Number(get('month')),
        day: Number(get('day')),
        hour: Number(get('hour')),
        minute: Number(get('minute')),
        weekday: SHORT_WEEKDAY_TO_INDEX[get('weekday')] ?? 0,
    };
}

const SHORT_WEEKDAY_TO_INDEX: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
};

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

void WEEK_MS;
