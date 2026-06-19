import type { DataHistoryResponseAny, DataHistoryResponseV2, HistoryDataPointV2, HistoryRangeV2, HistorySummary } from '../domain/dataContract.types';

const EMPTY_SUMMARY: HistorySummary = {
    last: null,
    min: null,
    max: null,
    avg: null,
};

export function isDataHistoryResponseV2(data: unknown): data is DataHistoryResponseV2 {
    if (typeof data !== 'object' || data === null) {
        return false;
    }

    const candidate = data as Partial<DataHistoryResponseV2> & { summary?: unknown; unit?: unknown };

    if (
        !isHistoryRangeV2(candidate.range)
        || typeof candidate.contractVersion !== 'string'
        || typeof candidate.machineId !== 'number'
        || !Number.isFinite(candidate.machineId)
        || typeof candidate.variableKey !== 'string'
        || (candidate.unit !== null && typeof candidate.unit !== 'string')
        || !Array.isArray(candidate.series)
        || !isHistorySummary(candidate.summary)
    ) {
        return false;
    }

    if (candidate.window !== undefined && !isHistoryWindow(candidate.window)) {
        return false;
    }

    return candidate.series.every((point) => isHistoryDataPointV2(point));
}

export function coerceDataHistoryResponseForTrendChartV2(
    data: DataHistoryResponseAny | unknown,
    fallbackRange: HistoryRangeV2,
): DataHistoryResponseV2 | null {
    if (isDataHistoryResponseV2(data)) {
        return data;
    }

    if (typeof data !== 'object' || data === null) {
        return null;
    }

    const candidate = data as Partial<DataHistoryResponseV2> & {
        range?: unknown;
        series?: unknown;
        summary?: unknown;
        window?: unknown;
    };

    if (
        typeof candidate.contractVersion !== 'string'
        || typeof candidate.machineId !== 'number'
        || !Number.isFinite(candidate.machineId)
        || typeof candidate.variableKey !== 'string'
        || (candidate.unit !== null && candidate.unit !== undefined && typeof candidate.unit !== 'string')
    ) {
        return null;
    }

    const series = adaptHistorySeriesV2(candidate.series);

    return {
        contractVersion: candidate.contractVersion,
        machineId: candidate.machineId,
        variableKey: candidate.variableKey,
        range: isHistoryRangeV2(candidate.range) ? candidate.range : fallbackRange,
        unit: candidate.unit ?? null,
        window: isHistoryWindow(candidate.window) ? candidate.window : undefined,
        series,
        summary: adaptHistorySummary(candidate.summary),
    };
}

function isHistoryRangeV2(range: unknown): range is HistoryRangeV2 {
    return range === '1h'
        || range === '24h'
        || range === '7d'
        || range === '30d'
        || range === '12m'
        || range === 'custom';
}

function isHistoryDataPointV2(point: unknown): point is HistoryDataPointV2 {
    if (typeof point !== 'object' || point === null) {
        return false;
    }

    const candidate = point as Partial<HistoryDataPointV2>;

    return typeof candidate.timestamp === 'string'
        && typeof candidate.timestampMs === 'number'
        && Number.isFinite(candidate.timestampMs)
        && (candidate.value === null || (typeof candidate.value === 'number' && Number.isFinite(candidate.value)));
}

function adaptHistorySeriesV2(series: unknown): HistoryDataPointV2[] {
    if (!Array.isArray(series)) {
        return [];
    }

    return series
        .map((point) => adaptHistoryDataPointV2(point))
        .filter((point): point is HistoryDataPointV2 => point !== null);
}

function adaptHistoryDataPointV2(point: unknown): HistoryDataPointV2 | null {
    if (typeof point !== 'object' || point === null) {
        return null;
    }

    const candidate = point as Partial<HistoryDataPointV2>;

    if (typeof candidate.timestamp !== 'string') {
        return null;
    }

    const timestampMs = typeof candidate.timestampMs === 'number' && Number.isFinite(candidate.timestampMs)
        ? candidate.timestampMs
        : Date.parse(candidate.timestamp);

    if (!Number.isFinite(timestampMs)) {
        return null;
    }

    if (candidate.value !== null && candidate.value !== undefined && (typeof candidate.value !== 'number' || !Number.isFinite(candidate.value))) {
        return null;
    }

    return {
        timestamp: candidate.timestamp,
        timestampMs,
        value: candidate.value ?? null,
    };
}

function isHistorySummary(summary: unknown): boolean {
    if (typeof summary !== 'object' || summary === null) {
        return false;
    }

    const candidate = summary as Record<string, unknown>;
    return ['last', 'min', 'max', 'avg'].every((key) => (
        candidate[key] === null || (typeof candidate[key] === 'number' && Number.isFinite(candidate[key] as number))
    ));
}

function adaptHistorySummary(summary: unknown): HistorySummary {
    if (typeof summary !== 'object' || summary === null) {
        return EMPTY_SUMMARY;
    }

    const candidate = summary as Record<string, unknown>;

    return {
        last: toNullableFiniteNumber(candidate.last),
        min: toNullableFiniteNumber(candidate.min),
        max: toNullableFiniteNumber(candidate.max),
        avg: toNullableFiniteNumber(candidate.avg),
    };
}

function isHistoryWindow(window: unknown): boolean {
    if (typeof window !== 'object' || window === null) {
        return false;
    }

    const candidate = window as Record<string, unknown>;

    return typeof candidate.start === 'string'
        && typeof candidate.end === 'string'
        && (candidate.timezone === undefined || typeof candidate.timezone === 'string')
        && (candidate.bucket === undefined || typeof candidate.bucket === 'string')
        && (candidate.bucketMs === undefined || (typeof candidate.bucketMs === 'number' && Number.isFinite(candidate.bucketMs)));
}

function toNullableFiniteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
