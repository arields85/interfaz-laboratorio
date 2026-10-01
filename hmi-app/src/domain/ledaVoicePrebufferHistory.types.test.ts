import { describe, expect, it } from 'vitest';

import { isLedaVoicePrebufferMeasurement } from './ledaVoicePrebufferHistory.types';

describe('isLedaVoicePrebufferMeasurement', () => {
    it('accepts a measurement with finite non-negative fields', () => {
        expect(isLedaVoicePrebufferMeasurement({ neededPrebufferMs: 225, recordedAtMs: 1_700_000_000_000 })).toBe(true);
    });

    it('accepts zero for both fields', () => {
        expect(isLedaVoicePrebufferMeasurement({ neededPrebufferMs: 0, recordedAtMs: 0 })).toBe(true);
    });

    it('rejects a negative neededPrebufferMs', () => {
        expect(isLedaVoicePrebufferMeasurement({ neededPrebufferMs: -1, recordedAtMs: 1_000 })).toBe(false);
    });

    it('rejects a negative recordedAtMs', () => {
        expect(isLedaVoicePrebufferMeasurement({ neededPrebufferMs: 200, recordedAtMs: -1 })).toBe(false);
    });

    it('rejects non-finite numbers (Infinity, NaN)', () => {
        expect(isLedaVoicePrebufferMeasurement({ neededPrebufferMs: Infinity, recordedAtMs: 1_000 })).toBe(false);
        expect(isLedaVoicePrebufferMeasurement({ neededPrebufferMs: NaN, recordedAtMs: 1_000 })).toBe(false);
    });

    it('rejects non-numeric fields', () => {
        expect(isLedaVoicePrebufferMeasurement({ neededPrebufferMs: '200', recordedAtMs: 1_000 })).toBe(false);
    });

    it('rejects a missing field', () => {
        expect(isLedaVoicePrebufferMeasurement({ neededPrebufferMs: 200 })).toBe(false);
    });

    it('rejects null, arrays and primitives', () => {
        expect(isLedaVoicePrebufferMeasurement(null)).toBe(false);
        expect(isLedaVoicePrebufferMeasurement([1, 2])).toBe(false);
        expect(isLedaVoicePrebufferMeasurement('not an object')).toBe(false);
        expect(isLedaVoicePrebufferMeasurement(undefined)).toBe(false);
    });
});
