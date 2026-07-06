import type { KpiFixedTopCapBlinkMode, KpiFixedTopCapEffects, KpiTopCapShape, KpiTravelingTopCapEffects } from '../domain/admin.types';

export const KPI_TOP_CAP_EFFECT_MIN = 0;
export const KPI_TOP_CAP_EFFECT_MAX = 100;
export const KPI_TOP_CAP_EFFECT_STEP = 1;
export const KPI_FIXED_TOP_CAP_PULSE_INTENSITY_MAX = 200;
export const KPI_FIXED_TOP_CAP_PULSE_SPEED_MAX = 200;
export const KPI_FIXED_TOP_CAP_PULSE_IRREGULARITY_MAX = 100;
export const KPI_FIXED_TOP_CAP_PULSE_STABILITY_MAX = 300;
export const MACHINE_ACTIVITY_FIXED_TOP_CAP_PULSE_STABILITY_MAX = 700;
export const MACHINE_ACTIVITY_FIXED_TOP_CAP_PULSE_STABILITY_VISUAL_MAX = 100;

export const DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS: Required<KpiFixedTopCapEffects> = {
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
};

export const DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS: Required<KpiTravelingTopCapEffects> = {
    auraIntensity: 45,
    haloIntensity: 76,
    highlightIntensity: 55,
    blur: 2,
    extension: 66,
    thickness: 20,
};

export const DEFAULT_KPI_FIXED_TOP_CAP_SHAPE: Required<KpiTopCapShape> = {
    pill: true,
};

export const DEFAULT_KPI_TRAVELING_TOP_CAP_SHAPE: Required<KpiTopCapShape> = {
    pill: true,
};

type KpiTravelingTopCapLengthLayer = 'aura' | 'halo' | 'highlight';
type KpiTravelingTopCapThicknessLayer = 'aura' | 'halo' | 'core' | 'highlight' | 'coreStroke';

const KPI_TRAVELING_TOP_CAP_MAX_LENGTH_MULTIPLIERS: Record<KpiTravelingTopCapLengthLayer, number> = {
    aura: 2.7,
    halo: 2.05,
    highlight: 0.82,
};

const KPI_TRAVELING_TOP_CAP_MIN_THICKNESS_MULTIPLIERS: Record<KpiTravelingTopCapThicknessLayer, number> = {
    aura: 0.08,
    halo: 0.06,
    core: 0.04,
    highlight: 0.025,
    coreStroke: 0,
};

function clampEffectValue(value: number | undefined, fallback: number) {
    const resolvedValue = typeof value === 'number' && Number.isFinite(value)
        ? value
        : fallback;

    return Math.min(KPI_TOP_CAP_EFFECT_MAX, Math.max(KPI_TOP_CAP_EFFECT_MIN, Math.round(resolvedValue)));
}

function clampPulseEffectValue(value: number | undefined, fallback: number, maximum: number) {
    const resolvedValue = typeof value === 'number' && Number.isFinite(value)
        ? value
        : fallback;

    return Math.min(maximum, Math.max(KPI_TOP_CAP_EFFECT_MIN, Math.round(resolvedValue)));
}

export function resolveMachineActivityPulseStabilityVisualValue(value: number | undefined) {
    const resolvedValue = clampPulseEffectValue(
        value,
        DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseStability,
        MACHINE_ACTIVITY_FIXED_TOP_CAP_PULSE_STABILITY_MAX,
    );

    return Math.round((resolvedValue / MACHINE_ACTIVITY_FIXED_TOP_CAP_PULSE_STABILITY_MAX) * MACHINE_ACTIVITY_FIXED_TOP_CAP_PULSE_STABILITY_VISUAL_MAX);
}

export function resolveMachineActivityPulseStabilityRuntimeValue(value: number | undefined) {
    const visualValue = clampPulseEffectValue(
        value,
        DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseStability,
        MACHINE_ACTIVITY_FIXED_TOP_CAP_PULSE_STABILITY_VISUAL_MAX,
    );

    return Math.round((visualValue / MACHINE_ACTIVITY_FIXED_TOP_CAP_PULSE_STABILITY_VISUAL_MAX) * MACHINE_ACTIVITY_FIXED_TOP_CAP_PULSE_STABILITY_MAX);
}

function resolveFixedTopCapBlinkMode(mode: KpiFixedTopCapBlinkMode | undefined): KpiFixedTopCapBlinkMode {
    return mode === 'off-with-flashes' ? mode : DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.mode;
}

export function resolveKpiTravelingTopCapMaximumLength(
    layer: KpiTravelingTopCapLengthLayer,
    capLength: number,
    strokeWidth: number,
) {
    const layerMultiplier = KPI_TRAVELING_TOP_CAP_MAX_LENGTH_MULTIPLIERS[layer];
    const strokeWidthMaximum = strokeWidth * layerMultiplier;
    const capLengthMaximum = layer === 'highlight'
        ? capLength * layerMultiplier
        : capLength;

    return Number(Math.max(capLengthMaximum, strokeWidthMaximum).toFixed(2));
}

export function resolveKpiTravelingTopCapMinimumThickness(
    layer: KpiTravelingTopCapThicknessLayer,
    strokeWidth: number,
) {
    return Number((strokeWidth * KPI_TRAVELING_TOP_CAP_MIN_THICKNESS_MULTIPLIERS[layer]).toFixed(2));
}

export function resolveKpiFixedTopCapEffects(
    effects?: KpiFixedTopCapEffects,
    pulseStabilityMax: number = KPI_FIXED_TOP_CAP_PULSE_STABILITY_MAX,
): Required<KpiFixedTopCapEffects> {
    return {
        mode: resolveFixedTopCapBlinkMode(effects?.mode),
        auraIntensity: clampEffectValue(effects?.auraIntensity, DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.auraIntensity),
        haloIntensity: clampEffectValue(effects?.haloIntensity, DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.haloIntensity),
        highlightIntensity: clampEffectValue(effects?.highlightIntensity, DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.highlightIntensity),
        blur: clampEffectValue(effects?.blur, DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.blur),
        extension: clampEffectValue(effects?.extension, DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.extension),
        thickness: clampEffectValue(effects?.thickness, DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.thickness),
        pulseIntensity: clampPulseEffectValue(
            effects?.pulseIntensity,
            DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseIntensity,
            KPI_FIXED_TOP_CAP_PULSE_INTENSITY_MAX,
        ),
        pulseSpeed: clampPulseEffectValue(
            effects?.pulseSpeed,
            DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseSpeed,
            KPI_FIXED_TOP_CAP_PULSE_SPEED_MAX,
        ),
        pulseIrregularity: clampPulseEffectValue(
            effects?.pulseIrregularity,
            DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseIrregularity,
            KPI_FIXED_TOP_CAP_PULSE_IRREGULARITY_MAX,
        ),
        pulseStability: clampPulseEffectValue(
            effects?.pulseStability,
            DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseStability,
            pulseStabilityMax,
        ),
    };
}

export function resolveMachineActivityFixedTopCapEffects(
    effects?: KpiFixedTopCapEffects,
): Required<KpiFixedTopCapEffects> {
    const resolvedEffects = resolveKpiFixedTopCapEffects(effects, MACHINE_ACTIVITY_FIXED_TOP_CAP_PULSE_STABILITY_MAX);

    return {
        ...resolvedEffects,
        mode: 'on-with-failures',
        pulseIntensity: KPI_FIXED_TOP_CAP_PULSE_INTENSITY_MAX,
    };
}

export function resolveKpiFixedTopCapPulseDurationSeconds(pulseSpeed: number) {
    const normalizedSpeed = clampPulseEffectValue(
        pulseSpeed,
        DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseSpeed,
        KPI_FIXED_TOP_CAP_PULSE_SPEED_MAX,
    ) / KPI_FIXED_TOP_CAP_PULSE_SPEED_MAX;

    return Number((2.4 - (normalizedSpeed * 2.15)).toFixed(2));
}

export function resolveKpiFixedTopCapBlinkDurationSeconds(
    pulseSpeed: number,
    pulseIrregularity: number,
    pulseStability: number = DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseStability,
    pulseStabilityMax: number = KPI_FIXED_TOP_CAP_PULSE_STABILITY_MAX,
) {
    const normalizedSpeed = clampPulseEffectValue(
        pulseSpeed,
        DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseSpeed,
        KPI_FIXED_TOP_CAP_PULSE_SPEED_MAX,
    ) / KPI_FIXED_TOP_CAP_PULSE_SPEED_MAX;
    const normalizedIrregularity = clampPulseEffectValue(
        pulseIrregularity,
        DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseIrregularity,
        KPI_FIXED_TOP_CAP_PULSE_IRREGULARITY_MAX,
    ) / KPI_FIXED_TOP_CAP_PULSE_IRREGULARITY_MAX;
    const normalizedStability = clampPulseEffectValue(
        pulseStability,
        DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseStability,
        pulseStabilityMax,
    ) / pulseStabilityMax;

    return Number((
        4.2
        - (normalizedSpeed * 1.9)
        - (normalizedIrregularity * 1.1)
        + (normalizedStability * 2.2)
    ).toFixed(2));
}

export function resolveMachineActivityTravelCompletionBlinkDurationSeconds(
    pulseStability: number = DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseStability,
    pulseStabilityMax: number = MACHINE_ACTIVITY_FIXED_TOP_CAP_PULSE_STABILITY_MAX,
) {
    if (!Number.isFinite(pulseStabilityMax) || pulseStabilityMax <= 0) {
        return 0;
    }

    const normalizedStability = clampPulseEffectValue(
        pulseStability,
        DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseStability,
        pulseStabilityMax,
    ) / pulseStabilityMax;

    return Number((normalizedStability * 5).toFixed(2));
}

function clampUnit(value: number, minimum = 0, maximum = 1) {
    return Math.min(maximum, Math.max(minimum, Number(value.toFixed(3))));
}

export function resolveKpiFixedTopCapBlinkProfile(
    mode: KpiFixedTopCapBlinkMode,
    pulseIntensity: number,
    pulseSpeed: number,
    pulseIrregularity: number,
    pulseStability: number = DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseStability,
    pulseStabilityMax: number = KPI_FIXED_TOP_CAP_PULSE_STABILITY_MAX,
) {
    const normalizedIntensity = clampPulseEffectValue(
        pulseIntensity,
        DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseIntensity,
        KPI_FIXED_TOP_CAP_PULSE_INTENSITY_MAX,
    ) / KPI_FIXED_TOP_CAP_PULSE_INTENSITY_MAX;
    const normalizedSpeed = clampPulseEffectValue(
        pulseSpeed,
        DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseSpeed,
        KPI_FIXED_TOP_CAP_PULSE_SPEED_MAX,
    ) / KPI_FIXED_TOP_CAP_PULSE_SPEED_MAX;
    const normalizedIrregularity = clampPulseEffectValue(
        pulseIrregularity,
        DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseIrregularity,
        KPI_FIXED_TOP_CAP_PULSE_IRREGULARITY_MAX,
    ) / KPI_FIXED_TOP_CAP_PULSE_IRREGULARITY_MAX;
    const normalizedStability = clampPulseEffectValue(
        pulseStability,
        DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseStability,
        pulseStabilityMax,
    ) / pulseStabilityMax;

    const stabilityOffset = normalizedStability * 0.18;
    const burstScale = 1 - (normalizedStability * 0.55);
    const gapScale = 1 - (normalizedStability * 0.35);
    const firstBurstBaseStart = 0.3 - (normalizedIrregularity * 0.08);
    const secondBurstBaseStart = 0.69 - (normalizedIrregularity * 0.12);
    const firstStep = clampUnit((0.055 - (normalizedSpeed * 0.03)) * burstScale, 0.018, 0.08);
    const firstGap = clampUnit((0.03 - (normalizedSpeed * 0.015)) * gapScale, 0.01, 0.05);
    const secondStep = clampUnit((0.065 - (normalizedSpeed * 0.038)) * burstScale, 0.02, 0.09);
    const secondGap = clampUnit((0.034 - (normalizedSpeed * 0.018)) * gapScale, 0.012, 0.06);

    const firstBurstStart = clampUnit(firstBurstBaseStart + stabilityOffset, 0.08, 0.62);
    const firstBurstRecoverAt = clampUnit(firstBurstStart + firstStep);
    const firstBurstDipAt = clampUnit(firstBurstRecoverAt + firstGap);
    const firstBurstEndAt = clampUnit(firstBurstDipAt + firstStep);
    const secondBurstStart = clampUnit(
        Math.max(
            secondBurstBaseStart + (stabilityOffset * 1.35),
            firstBurstEndAt + 0.14 + (normalizedStability * 0.08),
        ),
        firstBurstEndAt + 0.06,
        0.9,
    );
    const secondBurstRecoverAt = clampUnit(secondBurstStart + secondStep);
    const secondBurstDipAt = clampUnit(secondBurstRecoverAt + secondGap);
    const secondBurstEndAt = clampUnit(secondBurstDipAt + secondStep, secondBurstDipAt, 0.98);

    if (mode === 'off-with-flashes') {
        const baseOpacity = Number(Math.max(0.04, 1 - (normalizedIntensity * 0.92)).toFixed(3));
        const flashOpacity = Number(Math.min(1, baseOpacity + (normalizedIntensity * 0.9)).toFixed(3));
        const reboundOpacity = Number(Math.min(1, baseOpacity + (normalizedIntensity * 0.58)).toFixed(3));
        const peakFlashOpacity = Number(Math.min(1, baseOpacity + (normalizedIntensity * (0.96 + (normalizedIrregularity * 0.04)))).toFixed(3));

        return {
            values: [
                baseOpacity,
                flashOpacity,
                baseOpacity,
                reboundOpacity,
                baseOpacity,
                peakFlashOpacity,
                reboundOpacity,
                flashOpacity,
                baseOpacity,
                baseOpacity,
            ].join(';'),
            keyTimes: [
                0,
                firstBurstStart,
                firstBurstRecoverAt,
                firstBurstDipAt,
                firstBurstEndAt,
                secondBurstStart,
                secondBurstRecoverAt,
                secondBurstDipAt,
                secondBurstEndAt,
                1,
            ].join(';'),
        };
    }

    const cutOpacity = Number(Math.max(0, 1 - (normalizedIntensity * 0.92)).toFixed(3));
    const softRecoverOpacity = Number(Math.max(0, 1 - (normalizedIntensity * 0.18)).toFixed(3));
    const reboundOpacity = Number(Math.max(0, 1 - (normalizedIntensity * 0.4)).toFixed(3));
    const deepCutOpacity = Number(Math.max(0, 1 - (normalizedIntensity * (1.02 + (normalizedIrregularity * 0.08)))).toFixed(3));

    return {
        values: [
            1,
            cutOpacity,
            softRecoverOpacity,
            reboundOpacity,
            1,
            deepCutOpacity,
            softRecoverOpacity,
            cutOpacity,
            1,
            1,
        ].join(';'),
        keyTimes: [
            0,
            firstBurstStart,
            firstBurstRecoverAt,
            firstBurstDipAt,
            firstBurstEndAt,
            secondBurstStart,
            secondBurstRecoverAt,
            secondBurstDipAt,
            secondBurstEndAt,
            1,
        ].join(';'),
    };
}

export function resolveKpiFixedTopCapPulseProfile(pulseIntensity: number, pulseIrregularity: number) {
    const normalizedIntensity = clampPulseEffectValue(
        pulseIntensity,
        DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseIntensity,
        KPI_FIXED_TOP_CAP_PULSE_INTENSITY_MAX,
    ) / KPI_FIXED_TOP_CAP_PULSE_INTENSITY_MAX;
    const normalizedIrregularity = clampPulseEffectValue(
        pulseIrregularity,
        DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseIrregularity,
        KPI_FIXED_TOP_CAP_PULSE_IRREGULARITY_MAX,
    ) / KPI_FIXED_TOP_CAP_PULSE_IRREGULARITY_MAX;
    const regularSecondaryOpacity = Number((1 - (normalizedIntensity * 0.28)).toFixed(3));
    const regularMinimumOpacity = Number((1 - (normalizedIntensity * 0.82)).toFixed(3));

    if (normalizedIrregularity === 0) {
        return {
            values: `1;${regularSecondaryOpacity};${regularMinimumOpacity};1`,
            keyTimes: '0;0.2;0.45;1',
        };
    }

    const failingDipOpacity = Number(Math.max(0, 1 - (normalizedIntensity * (0.42 + (normalizedIrregularity * 0.48)))).toFixed(3));
    const reboundOpacity = Number(Math.max(0, 1 - (normalizedIntensity * (0.08 + (normalizedIrregularity * 0.05)))).toFixed(3));
    const deepDipOpacity = Number(Math.max(0, 1 - (normalizedIntensity * (0.58 + (normalizedIrregularity * 0.62)))).toFixed(3));
    const lateFlashOpacity = Number(Math.max(0, 1 - (normalizedIntensity * (0.14 + (normalizedIrregularity * 0.06)))).toFixed(3));

    return {
        values: `1;${failingDipOpacity};${reboundOpacity};${deepDipOpacity};${lateFlashOpacity};${regularMinimumOpacity};1`,
        keyTimes: '0;0.08;0.16;0.31;0.43;0.68;1',
    };
}

export function resolveKpiTravelingTopCapEffects(
    effects?: KpiTravelingTopCapEffects,
): Required<KpiTravelingTopCapEffects> {
    return {
        auraIntensity: clampEffectValue(effects?.auraIntensity, DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS.auraIntensity),
        haloIntensity: clampEffectValue(effects?.haloIntensity, DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS.haloIntensity),
        highlightIntensity: clampEffectValue(effects?.highlightIntensity, DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS.highlightIntensity),
        blur: clampEffectValue(effects?.blur, DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS.blur),
        extension: clampEffectValue(effects?.extension, DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS.extension),
        thickness: clampEffectValue(effects?.thickness, DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS.thickness),
    };
}

function resolveKpiTopCapShape(
    shape: KpiTopCapShape | undefined,
    fallback: Required<KpiTopCapShape>,
): Required<KpiTopCapShape> {
    return {
        pill: typeof shape?.pill === 'boolean' ? shape.pill : fallback.pill,
    };
}

export function resolveKpiFixedTopCapShape(shape?: KpiTopCapShape): Required<KpiTopCapShape> {
    return resolveKpiTopCapShape(shape, DEFAULT_KPI_FIXED_TOP_CAP_SHAPE);
}

export function resolveKpiTravelingTopCapShape(shape?: KpiTopCapShape): Required<KpiTopCapShape> {
    void shape;

    return {
        pill: DEFAULT_KPI_TRAVELING_TOP_CAP_SHAPE.pill,
    };
}
