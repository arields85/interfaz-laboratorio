import type { KpiFixedTopCapEffects, KpiTopCapShape, KpiTravelingTopCapEffects } from '../domain/admin.types';

export const KPI_TOP_CAP_EFFECT_MIN = 0;
export const KPI_TOP_CAP_EFFECT_MAX = 100;
export const KPI_TOP_CAP_EFFECT_STEP = 1;

export const DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS: Required<KpiFixedTopCapEffects> = {
    auraIntensity: 90,
    haloIntensity: 0,
    highlightIntensity: 68,
    blur: 37,
    extension: 11,
    thickness: 61,
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
): Required<KpiFixedTopCapEffects> {
    return {
        auraIntensity: clampEffectValue(effects?.auraIntensity, DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.auraIntensity),
        haloIntensity: clampEffectValue(effects?.haloIntensity, DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.haloIntensity),
        highlightIntensity: clampEffectValue(effects?.highlightIntensity, DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.highlightIntensity),
        blur: clampEffectValue(effects?.blur, DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.blur),
        extension: clampEffectValue(effects?.extension, DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.extension),
        thickness: clampEffectValue(effects?.thickness, DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.thickness),
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
