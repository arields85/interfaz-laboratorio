import {
    formatBucketLabel,
    groupByTemporalBucket,
    resolveOperationalDayAnchor,
    resolveOperationalWeekAnchor,
    resolveShiftAnchor,
} from './temporalGrouping';

function expectLocalDateParts(
    date: Date,
    expected: { year: number; month: number; day: number; hours: number; minutes?: number },
) {
    expect(date.getFullYear()).toBe(expected.year);
    expect(date.getMonth()).toBe(expected.month);
    expect(date.getDate()).toBe(expected.day);
    expect(date.getHours()).toBe(expected.hours);
    expect(date.getMinutes()).toBe(expected.minutes ?? 0);
    expect(date.getSeconds()).toBe(0);
    expect(date.getMilliseconds()).toBe(0);
}

describe('resolveOperationalDayAnchor', () => {
    it('keeps timestamps at or after 06:00 on the same operational day', () => {
        const anchor = resolveOperationalDayAnchor(new Date(2024, 0, 2, 6, 45, 18, 12));

        expectLocalDateParts(anchor, { year: 2024, month: 0, day: 2, hours: 6 });
    });

    it('moves timestamps before 06:00 to the previous operational day', () => {
        const anchor = resolveOperationalDayAnchor(new Date(2024, 0, 2, 5, 59, 59, 999));

        expectLocalDateParts(anchor, { year: 2024, month: 0, day: 1, hours: 6 });
    });
});

describe('resolveOperationalWeekAnchor', () => {
    it('keeps monday timestamps on the same operational week anchor', () => {
        const anchor = resolveOperationalWeekAnchor(new Date(2024, 0, 1, 9, 0, 0, 0));

        expectLocalDateParts(anchor, { year: 2024, month: 0, day: 1, hours: 6 });
    });

    it('moves sunday timestamps back to the monday of the same operational week', () => {
        const anchor = resolveOperationalWeekAnchor(new Date(2024, 0, 7, 18, 0, 0, 0));

        expectLocalDateParts(anchor, { year: 2024, month: 0, day: 1, hours: 6 });
    });
});

describe('resolveShiftAnchor', () => {
    it('assigns first shift for timestamps between 06:00 and 13:59', () => {
        const result = resolveShiftAnchor(new Date(2024, 0, 2, 8, 30, 0, 0));

        expect(result.shift).toBe(1);
        expectLocalDateParts(result.anchor, { year: 2024, month: 0, day: 2, hours: 6 });
    });

    it('assigns second shift for timestamps between 14:00 and 21:59', () => {
        const result = resolveShiftAnchor(new Date(2024, 0, 2, 18, 10, 0, 0));

        expect(result.shift).toBe(2);
        expectLocalDateParts(result.anchor, { year: 2024, month: 0, day: 2, hours: 14 });
    });

    it('assigns third shift after 22:00 on the same day', () => {
        const result = resolveShiftAnchor(new Date(2024, 0, 2, 23, 45, 0, 0));

        expect(result.shift).toBe(3);
        expectLocalDateParts(result.anchor, { year: 2024, month: 0, day: 2, hours: 22 });
    });

    it('assigns third shift before 06:00 using the previous day anchor', () => {
        const result = resolveShiftAnchor(new Date(2024, 0, 2, 3, 15, 0, 0));

        expect(result.shift).toBe(3);
        expectLocalDateParts(result.anchor, { year: 2024, month: 0, day: 1, hours: 22 });
    });
});

describe('formatBucketLabel', () => {
    it('formats hour, shift, day, and month labels from the resolved anchors', () => {
        expect(formatBucketLabel(new Date(2024, 0, 2, 8, 0, 0, 0), 'hour')).toBe('08:00');
        expect(formatBucketLabel(new Date(2024, 0, 2, 6, 0, 0, 0), 'shift', 2)).toBe('Mar-T2');
        expect(formatBucketLabel(new Date(2024, 0, 2, 6, 0, 0, 0), 'day')).toBe('02 Ene');
        expect(formatBucketLabel(new Date(2024, 0, 1, 0, 0, 0, 0), 'month')).toBe('Ene 2024');
    });

    it('defaults to shift 1 when a shift label is requested without an explicit shift', () => {
        expect(formatBucketLabel(new Date(2024, 0, 2, 6, 0, 0, 0), 'shift')).toBe('Mar-T1');
    });
});

describe('groupByTemporalBucket', () => {
    it('returns an empty array when there are no points', () => {
        expect(groupByTemporalBucket([], 'hour')).toEqual([]);
    });

    it('groups hour buckets, sorts them, and rounds aggregate values', () => {
        const grouped = groupByTemporalBucket([
            { timestamp: new Date(2024, 0, 2, 9, 25, 0, 0).toISOString(), production: 10.111, oee: 80 },
            { timestamp: new Date(2024, 0, 2, 8, 40, 0, 0).toISOString(), production: 5.111, oee: 50 },
            { timestamp: new Date(2024, 0, 2, 8, 5, 0, 0).toISOString(), production: 3.335, oee: 100 },
        ], 'hour');

        expect(grouped).toHaveLength(2);
        expect(grouped.map((entry) => entry.label)).toEqual(['08:00', '09:00']);

        expect(grouped[0]).toMatchObject({
            sampleCount: 2,
            production: 8.45,
            oee: 75,
        });
        expect(new Date(grouped[0].startAt).getHours()).toBe(8);
        expect(new Date(grouped[0].endAt).getHours()).toBe(9);

        expect(grouped[1]).toMatchObject({
            sampleCount: 1,
            production: 10.11,
            oee: 80,
        });
    });

    it('groups shift buckets across all three shift branches with distinct keys', () => {
        const grouped = groupByTemporalBucket([
            { timestamp: new Date(2024, 0, 1, 23, 15, 0, 0).toISOString(), production: 4, oee: 90 },
            { timestamp: new Date(2024, 0, 2, 3, 30, 0, 0).toISOString(), production: 6, oee: 70 },
            { timestamp: new Date(2024, 0, 2, 7, 0, 0, 0).toISOString(), production: 8, oee: 60 },
            { timestamp: new Date(2024, 0, 2, 16, 0, 0, 0).toISOString(), production: 10, oee: 50 },
        ], 'shift');

        expect(grouped).toHaveLength(3);

        expect(grouped[0]).toMatchObject({ label: 'Lun-T3', sampleCount: 2, production: 10, oee: 80 });
        expect(grouped[1]).toMatchObject({ label: 'Mar-T1', sampleCount: 1, production: 8, oee: 60 });
        expect(grouped[2]).toMatchObject({ label: 'Mar-T2', sampleCount: 1, production: 10, oee: 50 });

        expect(grouped[0].bucketKey).toContain(':3');
        expect(grouped[1].bucketKey).toContain(':1');
        expect(grouped[2].bucketKey).toContain(':2');

        expect(new Date(grouped[0].startAt).getHours()).toBe(22);
        expect(new Date(grouped[0].endAt).getHours()).toBe(6);
    });

    it('groups day buckets using operational days starting at 06:00', () => {
        const grouped = groupByTemporalBucket([
            { timestamp: new Date(2024, 0, 2, 5, 30, 0, 0).toISOString(), production: 2, oee: 40 },
            { timestamp: new Date(2024, 0, 2, 7, 0, 0, 0).toISOString(), production: 3, oee: 60 },
            { timestamp: new Date(2024, 0, 2, 23, 0, 0, 0).toISOString(), production: 5, oee: 80 },
        ], 'day');

        expect(grouped).toHaveLength(2);
        expect(grouped[0]).toMatchObject({ label: '01 Ene', sampleCount: 1, production: 2, oee: 40 });
        expect(grouped[1]).toMatchObject({ label: '02 Ene', sampleCount: 2, production: 8, oee: 70 });

        expectLocalDateParts(new Date(grouped[0].startAt), { year: 2024, month: 0, day: 1, hours: 6 });
        expectLocalDateParts(new Date(grouped[1].startAt), { year: 2024, month: 0, day: 2, hours: 6 });
        expectLocalDateParts(new Date(grouped[1].endAt), { year: 2024, month: 0, day: 3, hours: 6 });
    });

    it('groups month buckets using the operational day month anchor', () => {
        const grouped = groupByTemporalBucket([
            { timestamp: new Date(2024, 1, 1, 3, 0, 0, 0).toISOString(), production: 2, oee: 20 },
            { timestamp: new Date(2024, 1, 1, 8, 0, 0, 0).toISOString(), production: 6, oee: 60 },
            { timestamp: new Date(2024, 1, 15, 12, 0, 0, 0).toISOString(), production: 4, oee: 80 },
        ], 'month');

        expect(grouped).toHaveLength(2);
        expect(grouped[0]).toMatchObject({
            bucketKey: 'month:2024-01',
            label: 'Ene 2024',
            sampleCount: 1,
            production: 2,
            oee: 20,
        });
        expect(grouped[1]).toMatchObject({
            bucketKey: 'month:2024-02',
            label: 'Feb 2024',
            sampleCount: 2,
            production: 10,
            oee: 70,
        });

        expectLocalDateParts(new Date(grouped[0].startAt), { year: 2024, month: 0, day: 1, hours: 0 });
        expectLocalDateParts(new Date(grouped[1].endAt), { year: 2024, month: 2, day: 1, hours: 0 });
    });
});
