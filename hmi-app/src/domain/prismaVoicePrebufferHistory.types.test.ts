import { describe, expect, it } from 'vitest';

import { isPrismaVoicePrebufferMeasurement } from './prismaVoicePrebufferHistory.types';

describe('isPrismaVoicePrebufferMeasurement', () => {
    it('accepts a measurement with finite non-negative fields', () => {
        expect(isPrismaVoicePrebufferMeasurement({ neededPrebufferMs: 225, recordedAtMs: 1_700_000_000_000 })).toBe(true);
    });

    it('accepts zero for both fields', () => {
        expect(isPrismaVoicePrebufferMeasurement({ neededPrebufferMs: 0, recordedAtMs: 0 })).toBe(true);
    });

    it('rejects a negative neededPrebufferMs', () => {
        expect(isPrismaVoicePrebufferMeasurement({ neededPrebufferMs: -1, recordedAtMs: 1_000 })).toBe(false);
    });

    it('rejects a negative recordedAtMs', () => {
        expect(isPrismaVoicePrebufferMeasurement({ neededPrebufferMs: 200, recordedAtMs: -1 })).toBe(false);
    });

    it('rejects non-finite numbers (Infinity, NaN)', () => {
        expect(isPrismaVoicePrebufferMeasurement({ neededPrebufferMs: Infinity, recordedAtMs: 1_000 })).toBe(false);
        expect(isPrismaVoicePrebufferMeasurement({ neededPrebufferMs: NaN, recordedAtMs: 1_000 })).toBe(false);
    });

    it('rejects non-numeric fields', () => {
        expect(isPrismaVoicePrebufferMeasurement({ neededPrebufferMs: '200', recordedAtMs: 1_000 })).toBe(false);
    });

    it('rejects a missing field', () => {
        expect(isPrismaVoicePrebufferMeasurement({ neededPrebufferMs: 200 })).toBe(false);
    });

    it('rejects null, arrays and primitives', () => {
        expect(isPrismaVoicePrebufferMeasurement(null)).toBe(false);
        expect(isPrismaVoicePrebufferMeasurement([1, 2])).toBe(false);
        expect(isPrismaVoicePrebufferMeasurement('not an object')).toBe(false);
        expect(isPrismaVoicePrebufferMeasurement(undefined)).toBe(false);
    });
});
