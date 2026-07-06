export interface TravelingTopCapSpeedConfig {
    min?: number;
    max?: number;
}

export const TRAVELING_TOP_CAP_SPEED_SCALE_MIN = 1;
export const TRAVELING_TOP_CAP_SPEED_SCALE_MAX = 10;
export const TRAVELING_TOP_CAP_SPEED_SCALE_STEP = 0.1;
export const TRAVELING_TOP_CAP_SPEED_ACTUAL_MIN_PX_PER_SECOND = 50;
export const TRAVELING_TOP_CAP_SPEED_ACTUAL_MAX_PX_PER_SECOND = 400;
export const DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_SCALE = 3;
export const DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_SCALE = 9;
export const DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_PX_PER_SECOND = resolveActualSpeedFromScale(DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_SCALE);
export const DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_PX_PER_SECOND = resolveActualSpeedFromScale(DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_SCALE);

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function getScalePrecision() {
    const fractionalDigits = TRAVELING_TOP_CAP_SPEED_SCALE_STEP.toString().split('.')[1];

    return fractionalDigits?.length ?? 0;
}

function normalizeScaleValue(value: number) {
    return Number(value.toFixed(getScalePrecision()));
}

export function sanitizeTravelingTopCapSpeedScale(
    value: number | undefined,
    fallback = DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_SCALE,
) {
    if (!Number.isFinite(value)) {
        return normalizeScaleValue(fallback);
    }

    const numericValue = value as number;

    return normalizeScaleValue(clamp(
        numericValue,
        TRAVELING_TOP_CAP_SPEED_SCALE_MIN,
        TRAVELING_TOP_CAP_SPEED_SCALE_MAX,
    ));
}

export function sanitizeTravelingTopCapActualSpeed(
    value: number | undefined,
    fallback = DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_PX_PER_SECOND,
) {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    const numericValue = value as number;

    return clamp(
        numericValue,
        TRAVELING_TOP_CAP_SPEED_ACTUAL_MIN_PX_PER_SECOND,
        TRAVELING_TOP_CAP_SPEED_ACTUAL_MAX_PX_PER_SECOND,
    );
}

export function resolveActualSpeedFromScale(scale: number) {
    const normalizedScale = (sanitizeTravelingTopCapSpeedScale(scale) - TRAVELING_TOP_CAP_SPEED_SCALE_MIN)
        / (TRAVELING_TOP_CAP_SPEED_SCALE_MAX - TRAVELING_TOP_CAP_SPEED_SCALE_MIN);

    return TRAVELING_TOP_CAP_SPEED_ACTUAL_MIN_PX_PER_SECOND
        + ((TRAVELING_TOP_CAP_SPEED_ACTUAL_MAX_PX_PER_SECOND - TRAVELING_TOP_CAP_SPEED_ACTUAL_MIN_PX_PER_SECOND) * normalizedScale);
}

export function resolveScaleFromActualSpeed(speed: number) {
    const normalizedSpeed = (sanitizeTravelingTopCapActualSpeed(speed) - TRAVELING_TOP_CAP_SPEED_ACTUAL_MIN_PX_PER_SECOND)
        / (TRAVELING_TOP_CAP_SPEED_ACTUAL_MAX_PX_PER_SECOND - TRAVELING_TOP_CAP_SPEED_ACTUAL_MIN_PX_PER_SECOND);

    return normalizeScaleValue(
        TRAVELING_TOP_CAP_SPEED_SCALE_MIN
        + ((TRAVELING_TOP_CAP_SPEED_SCALE_MAX - TRAVELING_TOP_CAP_SPEED_SCALE_MIN) * normalizedSpeed),
    );
}

export function resolveStoredTravelingTopCapSpeedScale(
    value: number | undefined,
    fallbackActualSpeed = DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_PX_PER_SECOND,
) {
    if (!Number.isFinite(value)) {
        return resolveScaleFromActualSpeed(fallbackActualSpeed);
    }

    const numericValue = value as number;

    if (numericValue > TRAVELING_TOP_CAP_SPEED_SCALE_MAX) {
        return resolveScaleFromActualSpeed(numericValue);
    }

    return sanitizeTravelingTopCapSpeedScale(numericValue, resolveScaleFromActualSpeed(fallbackActualSpeed));
}

export function resolveStoredTravelingTopCapActualSpeed(
    value: number | undefined,
    fallbackActualSpeed = DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_PX_PER_SECOND,
) {
    if (!Number.isFinite(value)) {
        return fallbackActualSpeed;
    }

    const numericValue = value as number;

    if (numericValue > TRAVELING_TOP_CAP_SPEED_SCALE_MAX) {
        return sanitizeTravelingTopCapActualSpeed(numericValue, fallbackActualSpeed);
    }

    return resolveActualSpeedFromScale(numericValue);
}

export function resolveStoredTravelingTopCapActualSpeedRange(config?: TravelingTopCapSpeedConfig) {
    return {
        min: resolveStoredTravelingTopCapActualSpeed(config?.min, DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_PX_PER_SECOND),
        max: resolveStoredTravelingTopCapActualSpeed(config?.max, DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_PX_PER_SECOND),
    };
}

export function resolveTravelingTopCapSpeedRange(config?: TravelingTopCapSpeedConfig) {
    const resolvedMin = sanitizeTravelingTopCapActualSpeed(config?.min, DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_PX_PER_SECOND);
    const resolvedMax = sanitizeTravelingTopCapActualSpeed(config?.max, DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_PX_PER_SECOND);

    return {
        min: resolvedMin,
        max: resolvedMax,
    };
}

export function resolveTravelingTopCapSpeed(normalizedValue: number, config?: TravelingTopCapSpeedConfig) {
    const { min, max } = resolveTravelingTopCapSpeedRange(config);
    const normalizedProgress = clamp(normalizedValue, 0, 1);

    return min + ((max - min) * normalizedProgress);
}
