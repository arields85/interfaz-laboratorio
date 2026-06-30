import { describe, expect, it } from 'vitest';
import { measureSmoothPathLength, resolveAnimationDurationSecondsFromPathLength } from './chartHelpers';

describe('chartHelpers', () => {
    it('measures straight smooth-path segments without inflating their length', () => {
        const points = [
            { x: 10, y: 20 },
            { x: 110, y: 20 },
            { x: 210, y: 20 },
        ];

        expect(measureSmoothPathLength(points)).toBeCloseTo(200, 4);
    });

    it('derives the calibrated PROD trend glow duration from path length and speed', () => {
        expect(resolveAnimationDurationSecondsFromPathLength(483.8955383300781, 323, 0.9, 3.2)).toBe(1.5);
    });

    it('clamps derived animation durations to the configured bounds', () => {
        expect(resolveAnimationDurationSecondsFromPathLength(120, 323, 0.9, 3.2)).toBe(0.9);
        expect(resolveAnimationDurationSecondsFromPathLength(1400, 323, 0.9, 3.2)).toBe(3.2);
    });
});
