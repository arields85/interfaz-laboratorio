import { describe, expect, it } from 'vitest';

import {
    HISTORY_MAX_POINTS_MAX,
    HISTORY_MAX_POINTS_MIN,
    HISTORICAL_DENSITY_LABELS,
    HISTORICAL_DENSITY_MAX_POINTS,
    mapHistoricalDensityToMaxPoints,
    normalizeHistoryMaxPoints,
    normalizeHistoricalDensity,
} from './trendChartV2Density';

describe('trendChartV2Density', () => {
    it('normalizes unsupported density values to normal', () => {
        expect(normalizeHistoricalDensity(undefined)).toBe('normal');
        expect(normalizeHistoricalDensity('ultra')).toBe('normal');
        expect(normalizeHistoricalDensity('low')).toBe('low');
    });

    it('maps the supported densities to transport maxPoints hints', () => {
        expect(mapHistoricalDensityToMaxPoints('low')).toBe(400);
        expect(mapHistoricalDensityToMaxPoints('normal')).toBe(800);
        expect(mapHistoricalDensityToMaxPoints('high')).toBe(1500);
        expect(mapHistoricalDensityToMaxPoints('invalid')).toBe(800);
    });

    it('clamps finite maxPoints hints into the documented frontend guardrail', () => {
        expect(normalizeHistoryMaxPoints(50)).toBe(HISTORY_MAX_POINTS_MIN);
        expect(normalizeHistoryMaxPoints(801.8)).toBe(802);
        expect(normalizeHistoryMaxPoints(4000)).toBe(HISTORY_MAX_POINTS_MAX);
        expect(normalizeHistoryMaxPoints(Number.POSITIVE_INFINITY)).toBeNull();
    });

    it('keeps the friendly labels and transport mapping centralized together', () => {
        expect(HISTORICAL_DENSITY_LABELS).toEqual({
            low: 'Baja',
            normal: 'Normal',
            high: 'Alta',
        });
        expect(HISTORICAL_DENSITY_MAX_POINTS).toEqual({
            low: 400,
            normal: 800,
            high: 1500,
        });
    });
});
