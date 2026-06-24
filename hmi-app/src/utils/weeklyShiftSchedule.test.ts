import { describe, expect, it } from 'vitest';

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
            },
        ]);
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
