import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ShiftDefinition } from '../domain/admin.types';
import {
    ALL_WEEKDAY_KEYS,
    buildWeeklyShiftIntervals,
    normalizeWeekdays,
    resolveWeeklyShiftAssignment,
    validateWeeklyShiftSchedule,
} from './weeklyShiftSchedule';

const UTC = 'UTC';

describe('weeklyShiftSchedule', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('constructs one timezone formatter for a weekly interval build', () => {
        const NativeDateTimeFormat = Intl.DateTimeFormat;
        function DateTimeFormatMock(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
            return new NativeDateTimeFormat(locales, options);
        }
        const formatterSpy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(DateTimeFormatMock);

        buildWeeklyShiftIntervals({
            shifts: [{ id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: ALL_WEEKDAY_KEYS }],
            timezone: 'America/New_York',
            visibleStartMs: Date.parse('2026-03-01T00:00:00.000Z'),
            visibleEndMs: Date.parse('2026-03-15T00:00:00.000Z'),
        });

        expect(formatterSpy).toHaveBeenCalledTimes(1);
    });

    it('normalizes legacy shifts without weekdays to every weekday in saved order', () => {
        expect(normalizeWeekdays(undefined)).toEqual(ALL_WEEKDAY_KEYS);
    });

    it('rejects schedules with empty weekday applicability or overlapping weekly windows', () => {
        const emptyWeekdays: ShiftDefinition[] = [
            { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: [] },
        ];
        const overlapping: ShiftDefinition[] = [
            { id: 'shift-a', label: 'Turno A', start: '22:00', end: '06:00', weekdays: ['fri'] },
            { id: 'shift-b', label: 'Turno B', start: '04:00', end: '12:00', weekdays: ['sat'] },
        ];

        expect(validateWeeklyShiftSchedule(emptyWeekdays)).toEqual({
            ok: false,
            error: 'Each shift must apply to at least one weekday.',
        });
        expect(validateWeeklyShiftSchedule(overlapping)).toEqual({
            ok: false,
            error: 'Shift windows cannot overlap after weekly expansion.',
        });
    });

    it('keeps Friday overnight shifts continuous into Saturday morning and clips only configured weekdays', () => {
        const shifts: ShiftDefinition[] = [
            { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00', weekdays: ['fri'] },
        ];

        expect(resolveWeeklyShiftAssignment({
            timestampMs: Date.parse('2026-06-20T02:00:00.000Z'),
            shifts,
            timezone: UTC,
        })).toMatchObject({
            shiftId: 'shift-c',
            label: 'Turno C',
            bucketKey: 'shift:shift-c:2026-06-19',
        });

        expect(buildWeeklyShiftIntervals({
            shifts,
            timezone: UTC,
            visibleStartMs: Date.parse('2026-06-19T21:00:00.000Z'),
            visibleEndMs: Date.parse('2026-06-21T08:00:00.000Z'),
        })).toEqual([
            {
                shiftId: 'shift-c',
                label: 'Turno C',
                bucketKey: 'shift:shift-c:2026-06-19',
                startMs: Date.parse('2026-06-19T22:00:00.000Z'),
                endMs: Date.parse('2026-06-20T06:00:00.000Z'),
                semanticStartMs: Date.parse('2026-06-19T22:00:00.000Z'),
                semanticEndMs: Date.parse('2026-06-20T06:00:00.000Z'),
            },
        ]);
    });

    it('clips visible bounds while preserving semantic shift extents for overlapping intervals', () => {
        const shifts: ShiftDefinition[] = [
            { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: ['thu'] },
        ];

        expect(buildWeeklyShiftIntervals({
            shifts,
            timezone: UTC,
            visibleStartMs: Date.parse('2026-06-18T08:00:00.000Z'),
            visibleEndMs: Date.parse('2026-06-18T10:00:00.000Z'),
        })).toEqual([
            {
                shiftId: 'shift-a',
                label: 'Turno A',
                bucketKey: 'shift:shift-a:2026-06-18',
                startMs: Date.parse('2026-06-18T08:00:00.000Z'),
                endMs: Date.parse('2026-06-18T10:00:00.000Z'),
                semanticStartMs: Date.parse('2026-06-18T06:00:00.000Z'),
                semanticEndMs: Date.parse('2026-06-18T14:00:00.000Z'),
            },
        ]);
    });

    it('preserves weekly shift extents across DST forward and backward transitions', () => {
        const shifts: ShiftDefinition[] = [
            { id: 'shift-dst', label: 'Turno DST', start: '00:00', end: '04:00', weekdays: ['sun'] },
        ];
        const springForward = buildWeeklyShiftIntervals({
            shifts,
            timezone: 'America/New_York',
            visibleStartMs: Date.parse('2026-03-08T04:00:00.000Z'),
            visibleEndMs: Date.parse('2026-03-09T05:00:00.000Z'),
        });
        const fallBackward = buildWeeklyShiftIntervals({
            shifts,
            timezone: 'America/New_York',
            visibleStartMs: Date.parse('2026-11-01T03:00:00.000Z'),
            visibleEndMs: Date.parse('2026-11-02T05:00:00.000Z'),
        });

        expect(springForward).toMatchObject([{
            bucketKey: 'shift:shift-dst:2026-03-08',
            semanticStartMs: Date.parse('2026-03-08T05:00:00.000Z'),
            semanticEndMs: Date.parse('2026-03-08T08:00:00.000Z'),
        }]);
        expect(fallBackward).toMatchObject([{
            bucketKey: 'shift:shift-dst:2026-11-01',
            semanticStartMs: Date.parse('2026-11-01T04:00:00.000Z'),
            semanticEndMs: Date.parse('2026-11-01T09:00:00.000Z'),
        }]);
    });

    it('resolves uncovered weekly time to sin turno', () => {
        const shifts: ShiftDefinition[] = [
            { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
        ];

        expect(resolveWeeklyShiftAssignment({
            timestampMs: Date.parse('2026-06-21T10:00:00.000Z'),
            shifts,
            timezone: UTC,
        })).toMatchObject({
            shiftId: 'sin-turno',
            label: 'sin turno',
            bucketKey: 'sin-turno:2026-06-21T10:00',
        });
    });
});
