import { describe, expect, it } from 'vitest';

import {
    isValidActivitySeriesQueryParams,
    validateCustomActivitySeriesWindow,
    validateAndNormalizeActivitySeriesQueryParams,
} from './activitySeriesQueryValidation';

describe('activitySeriesQueryValidation', () => {
    it('accepts strict ISO UTC custom timestamps up to 30 days', () => {
        expect(
            validateCustomActivitySeriesWindow('2026-06-01T00:00:00.000Z', '2026-06-30T23:59:59.999Z'),
        ).toEqual({
            ok: true,
            startMs: Date.parse('2026-06-01T00:00:00.000Z'),
            endMs: Date.parse('2026-06-30T23:59:59.999Z'),
        });
    });

    it('rejects invalid custom timestamps, reversed bounds, and oversized windows', () => {
        expect(
            validateCustomActivitySeriesWindow('06/18/2026 10:00', '2026-06-18T12:00:00.000Z'),
        ).toEqual({ ok: false, error: 'invalid-timestamp' });

        expect(
            validateCustomActivitySeriesWindow('2026-06-18T12:00:00.000Z', '2026-06-18T10:00:00.000Z'),
        ).toEqual({ ok: false, error: 'start-not-before-end' });

        expect(
            validateCustomActivitySeriesWindow('2026-06-01T00:00:00.000Z', '2026-07-02T00:00:00.001Z'),
        ).toEqual({ ok: false, error: 'duration-too-large' });
    });

    it('normalizes supported custom queries without attaching schedule metadata', () => {
        expect(
            validateAndNormalizeActivitySeriesQueryParams({
                machineId: 7,
                range: 'custom',
                start: '2026-06-18T10:00:00.000Z',
                end: '2026-06-18T12:00:00.000Z',
            }),
        ).toEqual({
            ok: true,
            params: {
                machineId: 7,
                range: 'custom',
                start: '2026-06-18T10:00:00.000Z',
                end: '2026-06-18T12:00:00.000Z',
            },
        });
    });

    it('disables invalid custom query params before the service boundary', () => {
        expect(
            isValidActivitySeriesQueryParams({
                machineId: 7,
                range: 'custom',
                start: '2026-06-18T12:00:00.000Z',
                end: '2026-06-18T10:00:00.000Z',
            }),
        ).toBe(false);
    });
});
