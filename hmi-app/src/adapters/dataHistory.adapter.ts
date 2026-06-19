// =============================================================================
// Adapter: Data History
// Anti-corruption layer entre la respuesta cruda del endpoint y el dominio.
//
// Este adapter valida el shape general de la respuesta, normaliza campos
// faltantes con defaults seguros y conserva gaps (`value: null`) para que
// la capa de visualización pueda renderizar huecos reales en la serie.
//
// Contrato oficial: docs/DATA_CONTRACT.md
// =============================================================================

import {
    HISTORY_RANGES_V2,
    HISTORY_RANGES,
    type DataHistoryResponseAny,
    type DataHistoryResponseV2,
    type HistoryDataPoint,
    type HistoryDataPointV2,
    type HistoryRange,
    type HistoryRangeV2,
    type HistorySummary,
    type HistoryWindow,
} from '../domain/dataContract.types';

interface RawHistoryPoint {
    timestamp?: unknown;
    timestampMs?: unknown;
    value?: unknown;
}

interface RawHistorySummary {
    last?: unknown;
    min?: unknown;
    max?: unknown;
    avg?: unknown;
}

interface RawHistoryResponse {
    contractVersion?: unknown;
    machineId?: unknown;
    variableKey?: unknown;
    range?: unknown;
    unit?: unknown;
    window?: unknown;
    series?: unknown;
    summary?: unknown;
}

const DEFAULT_HISTORY_RANGE: HistoryRange = 'hora';
const DEFAULT_HISTORY_RANGE_V2: HistoryRangeV2 = '24h';
const DEFAULT_CONTRACT_VERSION = '1.0.0';
const DEFAULT_SUMMARY: HistorySummary = {
    last: null,
    min: null,
    max: null,
    avg: null,
};

/**
 * Adapta la respuesta cruda del endpoint de histórico al dominio tipado.
 */
export function adaptDataHistory(raw: unknown): DataHistoryResponseAny {
    const response = (raw ?? {}) as RawHistoryResponse;
    const range = toHistoryRangeAny(response.range);
    const summary = adaptSummary(response.summary);
    const unit = toNullableString(response.unit);
    const contractVersion = toNonEmptyString(response.contractVersion) ?? DEFAULT_CONTRACT_VERSION;
    const machineId = toMachineId(response.machineId);
    const variableKey = toNonEmptyString(response.variableKey) ?? '';

    if (isHistoryRangeV2(range)) {
        return {
            contractVersion,
            machineId,
            variableKey,
            range,
            unit,
            window: adaptWindow(response.window),
            series: adaptSeriesV2(response.series),
            summary,
        } satisfies DataHistoryResponseV2;
    }

    return {
        contractVersion,
        machineId,
        variableKey,
        range,
        unit,
        series: adaptSeries(response.series),
        summary,
    };
}

function adaptSeries(raw: unknown): HistoryDataPoint[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    return raw
        .map((point) => adaptPoint(point as RawHistoryPoint))
        .filter((point): point is HistoryDataPoint => point !== null);
}

function adaptPoint(raw: RawHistoryPoint): HistoryDataPoint | null {
    const timestamp = toNonEmptyString(raw.timestamp);

    if (!timestamp) {
        return null;
    }

    return {
        timestamp,
        value: toNumericOrNull(raw.value),
    };
}

function adaptSeriesV2(raw: unknown): HistoryDataPointV2[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    return raw
        .map((point) => adaptPointV2(point as RawHistoryPoint))
        .filter((point): point is HistoryDataPointV2 => point !== null);
}

function adaptPointV2(raw: RawHistoryPoint): HistoryDataPointV2 | null {
    const point = adaptPoint(raw);

    if (!point) {
        return null;
    }

    const timestampMs = toTimestampMs(raw.timestampMs, point.timestamp);

    if (timestampMs === null) {
        return null;
    }

    return {
        ...point,
        timestampMs,
    };
}

function adaptSummary(raw: unknown): HistorySummary {
    if (!raw || typeof raw !== 'object') {
        return DEFAULT_SUMMARY;
    }

    const summary = raw as RawHistorySummary;

    return {
        last: toNumericOrNull(summary.last),
        min: toNumericOrNull(summary.min),
        max: toNumericOrNull(summary.max),
        avg: toNumericOrNull(summary.avg),
    };
}

function toHistoryRangeV2(raw: unknown): HistoryRangeV2 {
    if (typeof raw !== 'string') {
        return DEFAULT_HISTORY_RANGE_V2;
    }

    return HISTORY_RANGES_V2.includes(raw as HistoryRangeV2)
        ? (raw as HistoryRangeV2)
        : DEFAULT_HISTORY_RANGE_V2;
}

function toHistoryRangeAny(raw: unknown): HistoryRange | HistoryRangeV2 {
    if (typeof raw !== 'string') {
        return DEFAULT_HISTORY_RANGE;
    }

    if (HISTORY_RANGES.includes(raw as HistoryRange)) {
        return raw as HistoryRange;
    }

    if (HISTORY_RANGES_V2.includes(raw as HistoryRangeV2)) {
        return toHistoryRangeV2(raw);
    }

    return DEFAULT_HISTORY_RANGE;
}

function isHistoryRangeV2(range: HistoryRange | HistoryRangeV2): range is HistoryRangeV2 {
    return HISTORY_RANGES_V2.includes(range as HistoryRangeV2);
}

function toMachineId(raw: unknown): number {
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

function toFiniteNumber(raw: unknown): number | null {
    if (typeof raw === 'number') {
        return Number.isFinite(raw) ? raw : null;
    }

    if (typeof raw === 'string' && raw.trim() !== '') {
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

function toNumericOrNull(raw: unknown): number | null {
    if (raw === null || raw === undefined) {
        return null;
    }

    return toFiniteNumber(raw);
}

function toTimestampMs(raw: unknown, fallbackTimestamp: string): number | null {
    const parsed = toFiniteNumber(raw);

    if (parsed !== null) {
        return parsed;
    }

    const fallbackMs = Date.parse(fallbackTimestamp);
    return Number.isFinite(fallbackMs) ? fallbackMs : null;
}

function toNonEmptyString(raw: unknown): string | null {
    if (typeof raw !== 'string') {
        return null;
    }

    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
}

function toNullableString(raw: unknown): string | null {
    return toNonEmptyString(raw);
}

function adaptWindow(raw: unknown): HistoryWindow | undefined {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }

    const window = raw as Record<string, unknown>;
    const start = toNonEmptyString(window.start);
    const end = toNonEmptyString(window.end);

    if (!start || !end) {
        return undefined;
    }

    return {
        start,
        end,
        timezone: toNullableString(window.timezone) ?? undefined,
        bucket: toNullableString(window.bucket) ?? undefined,
        bucketMs: toFiniteNumber(window.bucketMs) ?? undefined,
    };
}
