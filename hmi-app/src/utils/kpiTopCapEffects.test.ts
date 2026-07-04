import { describe, expect, it } from 'vitest';
import {
    DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS,
    DEFAULT_KPI_FIXED_TOP_CAP_SHAPE,
    DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS,
    DEFAULT_KPI_TRAVELING_TOP_CAP_SHAPE,
    resolveKpiTravelingTopCapMaximumLength,
    resolveKpiTravelingTopCapMinimumThickness,
    resolveKpiFixedTopCapEffects,
    resolveKpiFixedTopCapShape,
    resolveKpiTravelingTopCapEffects,
    resolveKpiTravelingTopCapShape,
} from './kpiTopCapEffects';

describe('kpiTopCapEffects', () => {
    it('uses the screenshot defaults for top-cap effects and shapes', () => {
        expect(DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS).toEqual({
            auraIntensity: 90,
            haloIntensity: 0,
            highlightIntensity: 68,
            blur: 37,
            extension: 11,
            thickness: 61,
        });
        expect(DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS).toEqual({
            auraIntensity: 45,
            haloIntensity: 76,
            highlightIntensity: 55,
            blur: 2,
            extension: 66,
            thickness: 20,
        });
        expect(DEFAULT_KPI_FIXED_TOP_CAP_SHAPE).toEqual({
            pill: true,
        });
        expect(DEFAULT_KPI_TRAVELING_TOP_CAP_SHAPE).toEqual({
            pill: true,
        });
    });

    it('keeps effect defaults resolved independently from base defaults', () => {
        expect(resolveKpiFixedTopCapEffects()).toEqual(DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS);
        expect(resolveKpiTravelingTopCapEffects()).toEqual(DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS);
        expect(resolveKpiFixedTopCapShape()).toEqual(DEFAULT_KPI_FIXED_TOP_CAP_SHAPE);
        expect(resolveKpiTravelingTopCapShape()).toEqual(DEFAULT_KPI_TRAVELING_TOP_CAP_SHAPE);
    });

    it('resolves traveling effects separately from fixed effect defaults', () => {
        expect(resolveKpiTravelingTopCapEffects({ auraIntensity: 35, blur: 45 })).toEqual({
            ...DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS,
            auraIntensity: 35,
            blur: 45,
        });
        expect(resolveKpiTravelingTopCapEffects({ extension: 150, thickness: -20 })).toEqual({
            ...DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS,
            extension: 100,
            thickness: 0,
        });
    });

    it('boosts traveling extension ceilings without changing the fixed 0-100 slider contract', () => {
        expect(resolveKpiTravelingTopCapMaximumLength('aura', 1.6, 8)).toBe(21.6);
        expect(resolveKpiTravelingTopCapMaximumLength('halo', 1.6, 8)).toBe(16.4);
        expect(resolveKpiTravelingTopCapMaximumLength('highlight', 1.6, 8)).toBeCloseTo(6.56, 2);
    });

    it('lets traveling thickness collapse near zero at slider value 0 without changing fixed mappings', () => {
        expect(resolveKpiTravelingTopCapMinimumThickness('aura', 8)).toBe(0.64);
        expect(resolveKpiTravelingTopCapMinimumThickness('halo', 8)).toBe(0.48);
        expect(resolveKpiTravelingTopCapMinimumThickness('core', 8)).toBe(0.32);
        expect(resolveKpiTravelingTopCapMinimumThickness('highlight', 8)).toBe(0.2);
        expect(resolveKpiTravelingTopCapMinimumThickness('coreStroke', 8)).toBe(0);
    });

    it('keeps the fixed shape configurable while forcing the traveling shape to pill for backward compatibility', () => {
        expect(resolveKpiFixedTopCapShape({ pill: true })).toEqual({ pill: true });
        expect(resolveKpiFixedTopCapShape({})).toEqual(DEFAULT_KPI_FIXED_TOP_CAP_SHAPE);
        expect(resolveKpiTravelingTopCapShape({ pill: false })).toEqual(DEFAULT_KPI_TRAVELING_TOP_CAP_SHAPE);
        expect(resolveKpiTravelingTopCapShape({})).toEqual(DEFAULT_KPI_TRAVELING_TOP_CAP_SHAPE);
    });
});
