import { describe, expect, it } from 'vitest';

import {
    isValidHistoryQueryParams,
    validateCustomHistoryWindow,
} from './historyQueryValidation';

describe('historyQueryValidation', () => {
    it('accepts strict ISO UTC custom timestamps', () => {
        expect(
            validateCustomHistoryWindow('2026-06-18T10:00:00.000Z', '2026-06-18T12:00:00.000Z')
        ).toEqual({
            ok: true,
            startMs: Date.parse('2026-06-18T10:00:00.000Z'),
            endMs: Date.parse('2026-06-18T12:00:00.000Z'),
        });
    });

    it('rejects Date.parse-permissive custom timestamps that are not strict ISO UTC strings', () => {
        expect(
            validateCustomHistoryWindow('06/18/2026 10:00', '2026-06-18T12:00:00.000Z')
        ).toEqual({
            ok: false,
            error: 'invalid-timestamp',
        });
    });

    it('rejects impossible ISO-looking dates instead of accepting normalized values', () => {
        expect(
            validateCustomHistoryWindow('2026-02-30T00:00:00.000Z', '2026-03-02T00:00:00.000Z')
        ).toEqual({
            ok: false,
            error: 'invalid-timestamp',
        });
    });

    it('preserves the max duration guardrail for strict ISO UTC strings', () => {
        expect(
            validateCustomHistoryWindow('2025-01-01T00:00:00.000Z', '2026-01-01T00:00:00.001Z')
        ).toEqual({
            ok: false,
            error: 'duration-too-large',
        });
    });

    it('disables custom query params when start or end are not strict ISO UTC timestamps', () => {
        expect(
            isValidHistoryQueryParams({
                machineId: 7,
                variableKey: 'pressure',
                range: 'custom',
                start: '06/18/2026 10:00',
                end: '2026-06-18T12:00:00.000Z',
                maxPoints: 800,
            })
        ).toBe(false);
    });
});
