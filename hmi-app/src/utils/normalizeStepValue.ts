function getStepPrecision(step: number): number {
    const fractionalDigits = step.toString().split('.')[1];

    return fractionalDigits?.length ?? 0;
}

/**
 * Clamps `value` to `[min, max]` and snaps it to the nearest `min + n * step`, rounded to the
 * step's own decimals. Shared by numeric/slider controls and by the stored values they persist.
 */
export function normalizeStepValue(value: number, min: number, max: number, step: number): number {
    const clampedValue = Math.min(max, Math.max(min, value));
    const precision = getStepPrecision(step);
    const steppedValue = min + Math.round((clampedValue - min) / step) * step;

    return Number(steppedValue.toFixed(precision));
}
