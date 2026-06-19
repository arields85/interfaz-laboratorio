import type { HistoricalDensity } from '../domain/admin.types';

export const HISTORICAL_DENSITY_LABELS: Record<HistoricalDensity, string> = {
    low: 'Baja',
    normal: 'Normal',
    high: 'Alta',
};

export const HISTORICAL_DENSITY_MAX_POINTS: Record<HistoricalDensity, number> = {
    low: 400,
    normal: 800,
    high: 1500,
};

export const HISTORY_MAX_POINTS_MIN = 100;
export const HISTORY_MAX_POINTS_MAX = 2000;

export function normalizeHistoricalDensity(value: unknown): HistoricalDensity {
    return value === 'low' || value === 'normal' || value === 'high' ? value : 'normal';
}

export function mapHistoricalDensityToMaxPoints(value: unknown): number {
    return HISTORICAL_DENSITY_MAX_POINTS[normalizeHistoricalDensity(value)];
}

export function normalizeHistoryMaxPoints(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }

    return Math.min(
        HISTORY_MAX_POINTS_MAX,
        Math.max(HISTORY_MAX_POINTS_MIN, Math.round(value))
    );
}
