import { describe, expect, it } from 'vitest';
import {
    DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS,
    DEFAULT_KPI_FIXED_TOP_CAP_SHAPE,
    DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS,
    DEFAULT_KPI_TRAVELING_TOP_CAP_SHAPE,
    KPI_FIXED_TOP_CAP_PULSE_INTENSITY_MAX,
    KPI_FIXED_TOP_CAP_PULSE_STABILITY_MAX,
    MACHINE_ACTIVITY_FIXED_TOP_CAP_PULSE_STABILITY_MAX,
    resolveMachineActivityPulseStabilityRuntimeValue,
    resolveMachineActivityPulseStabilityVisualValue,
    resolveMachineActivityFixedTopCapEffects,
    resolveKpiFixedTopCapBlinkDurationSeconds,
    resolveKpiFixedTopCapBlinkProfile,
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
            mode: 'on-with-failures',
            auraIntensity: 90,
            haloIntensity: 0,
            highlightIntensity: 68,
            blur: 37,
            extension: 11,
            thickness: 61,
            pulseIntensity: 0,
            pulseSpeed: 35,
            pulseIrregularity: 0,
            pulseStability: 0,
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

    it('forces machine-activity fixed blink to on-with-failures at max intensity for compatibility', () => {
        expect(resolveMachineActivityFixedTopCapEffects({
            mode: 'off-with-flashes',
            pulseIntensity: 22,
            pulseSpeed: 61,
            pulseIrregularity: 47,
            pulseStability: 63,
        })).toEqual({
            ...DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS,
            mode: 'on-with-failures',
            pulseIntensity: KPI_FIXED_TOP_CAP_PULSE_INTENSITY_MAX,
            pulseSpeed: 61,
            pulseIrregularity: 47,
            pulseStability: 63,
        });
    });

    it('maps the machine-activity stability UI scale to the expanded runtime range', () => {
        expect(resolveMachineActivityPulseStabilityRuntimeValue(100)).toBe(MACHINE_ACTIVITY_FIXED_TOP_CAP_PULSE_STABILITY_MAX);
        expect(resolveMachineActivityPulseStabilityVisualValue(MACHINE_ACTIVITY_FIXED_TOP_CAP_PULSE_STABILITY_MAX)).toBe(100);
        expect(resolveMachineActivityFixedTopCapEffects({
            pulseStability: MACHINE_ACTIVITY_FIXED_TOP_CAP_PULSE_STABILITY_MAX,
        }).pulseStability).toBe(MACHINE_ACTIVITY_FIXED_TOP_CAP_PULSE_STABILITY_MAX);
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

    it('extends fixed top-cap stable dwell and total blink duration as stability increases', () => {
        const lowStabilityProfile = resolveKpiFixedTopCapBlinkProfile('on-with-failures', 60, 80, 50, 0);
        const mediumStabilityProfile = resolveKpiFixedTopCapBlinkProfile('on-with-failures', 60, 80, 50, 100);
        const highStabilityProfile = resolveKpiFixedTopCapBlinkProfile('on-with-failures', 60, 80, 50, KPI_FIXED_TOP_CAP_PULSE_STABILITY_MAX);
        const lowStabilityTimes = lowStabilityProfile.keyTimes.split(';').map(Number);
        const mediumStabilityTimes = mediumStabilityProfile.keyTimes.split(';').map(Number);
        const highStabilityTimes = highStabilityProfile.keyTimes.split(';').map(Number);

        expect(KPI_FIXED_TOP_CAP_PULSE_STABILITY_MAX).toBeGreaterThan(100);
        expect(mediumStabilityTimes[1]).toBeGreaterThan(lowStabilityTimes[1]);
        expect(highStabilityTimes[1]).toBeGreaterThan(lowStabilityTimes[1]);
        expect(highStabilityTimes[1]).toBeGreaterThan(mediumStabilityTimes[1]);
        expect(highStabilityTimes[5]).toBeGreaterThan(lowStabilityTimes[5]);
        expect(highStabilityTimes[5]).toBeGreaterThan(mediumStabilityTimes[5]);
        expect(highStabilityTimes[4] - highStabilityTimes[1]).toBeLessThan(lowStabilityTimes[4] - lowStabilityTimes[1]);
        expect(resolveKpiFixedTopCapBlinkDurationSeconds(80, 50, 100)).toBeGreaterThan(
            resolveKpiFixedTopCapBlinkDurationSeconds(80, 50, 0),
        );
        expect(resolveKpiFixedTopCapBlinkDurationSeconds(80, 50, KPI_FIXED_TOP_CAP_PULSE_STABILITY_MAX)).toBeGreaterThan(
            resolveKpiFixedTopCapBlinkDurationSeconds(80, 50, 100),
        );
    });

    it('keeps off-with-flashes base opacity but spaces flash bursts later when stability increases', () => {
        const lowStabilityProfile = resolveKpiFixedTopCapBlinkProfile('off-with-flashes', 60, 80, 50, 0);
        const highStabilityProfile = resolveKpiFixedTopCapBlinkProfile('off-with-flashes', 60, 80, 50, 100);
        const lowStabilityValues = lowStabilityProfile.values.split(';').map(Number);
        const highStabilityValues = highStabilityProfile.values.split(';').map(Number);
        const lowStabilityTimes = lowStabilityProfile.keyTimes.split(';').map(Number);
        const highStabilityTimes = highStabilityProfile.keyTimes.split(';').map(Number);

        expect(highStabilityValues[0]).toBe(lowStabilityValues[0]);
        expect(highStabilityTimes[1]).toBeGreaterThan(lowStabilityTimes[1]);
        expect(highStabilityTimes[5]).toBeGreaterThan(lowStabilityTimes[5]);
    });
});
