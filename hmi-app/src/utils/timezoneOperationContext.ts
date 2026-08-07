export interface TimezoneOperationContext {
    readonly timezone: string;
    readonly formatter: Intl.DateTimeFormat;
}

export interface ZonedDateTimeParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    weekday: number;
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

export function createTimezoneOperationContext(timezone: string): TimezoneOperationContext {
    return {
        timezone,
        formatter: new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            weekday: 'short',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }),
    };
}

export function getZonedDateTimeParts(timestampMs: number, context: TimezoneOperationContext): ZonedDateTimeParts {
    const parts = context.formatter.formatToParts(new Date(timestampMs));
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
