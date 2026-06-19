import type { DataHistoryResponseV2, HistoryRangeV2 } from '../domain/dataContract.types';

const RANGE_DURATION_MS: Record<Exclude<HistoryRangeV2, 'custom'>, number> = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '12m': 365 * 24 * 60 * 60 * 1000,
};

const RANGE_POINT_COUNT: Record<HistoryRangeV2, number> = {
    '1h': 13,
    '24h': 25,
    '7d': 29,
    '30d': 31,
    '12m': 13,
    custom: 41,
};

interface TrendChartV2SimulatedHistoryOptions {
    widgetId: string;
    machineId?: number;
    variableKey?: string;
    range: HistoryRangeV2;
    customWindow?: {
        start: string;
        end: string;
    };
    baseValue: number;
    nowMs?: number;
}

const DEFAULT_SIMULATED_NOW_MS = Date.parse('2026-01-01T12:00:00.000Z');

export function resolveTrendChartV2SimulationPointCount(range: HistoryRangeV2): number {
    return RANGE_POINT_COUNT[range];
}

export function buildTrendChartV2SimulatedHistory({
    widgetId,
    machineId,
    variableKey,
    range,
    customWindow,
    baseValue,
    nowMs = resolveTrendChartV2SimulatedNowMs({ range, customWindow }),
}: TrendChartV2SimulatedHistoryOptions): DataHistoryResponseV2 {
    const window = resolveSimulationWindow(range, customWindow, nowMs);
    const pointCount = resolveTrendChartV2SimulationPointCount(range);
    const bucketMs = Math.max(Math.round((window.endMs - window.startMs) / Math.max(pointCount - 1, 1)), 1);
    const seed = hashSeed(`${widgetId}|${machineId ?? 'na'}|${variableKey ?? 'na'}|${range}|${window.start}|${window.end}|${baseValue}`);
    const random = createMulberry32(seed);
    const amplitude = Math.max(Math.abs(baseValue) * 0.12, 4);

    const series = Array.from({ length: pointCount }, (_, index) => {
        const timestampMs = window.startMs + (bucketMs * index);
        const boundedTimestampMs = index === pointCount - 1 ? window.endMs : timestampMs;
        const primaryWave = Math.sin((index / Math.max(pointCount - 1, 1)) * Math.PI * 2);
        const secondaryWave = Math.cos((index / Math.max(pointCount - 1, 1)) * Math.PI * 5);
        const drift = (random() - 0.5) * amplitude * 0.35;
        const value = roundToTwoDecimals(baseValue + (primaryWave * amplitude) + (secondaryWave * amplitude * 0.22) + drift);

        return {
            timestamp: new Date(boundedTimestampMs).toISOString(),
            timestampMs: boundedTimestampMs,
            value,
        };
    });

    const values = series.map((point) => point.value).filter((value): value is number => typeof value === 'number');

    return {
        contractVersion: 'simulated-v2',
        machineId: machineId ?? 0,
        variableKey: variableKey ?? 'simulated',
        range,
        unit: null,
        window: {
            start: window.start,
            end: window.end,
            bucketMs,
        },
        series,
        summary: {
            last: values.at(-1) ?? null,
            min: values.length > 0 ? Math.min(...values) : null,
            max: values.length > 0 ? Math.max(...values) : null,
            avg: values.length > 0 ? roundToTwoDecimals(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
        },
    };
}

export function resolveTrendChartV2SimulatedNowMs({
    range,
    customWindow,
    nowMs,
}: Pick<TrendChartV2SimulatedHistoryOptions, 'range' | 'customWindow' | 'nowMs'>): number {
    if (typeof nowMs === 'number' && Number.isFinite(nowMs)) {
        return nowMs;
    }

    if (range === 'custom' && customWindow) {
        const endMs = Date.parse(customWindow.end);

        if (Number.isFinite(endMs)) {
            return endMs;
        }
    }

    return DEFAULT_SIMULATED_NOW_MS;
}

function resolveSimulationWindow(range: HistoryRangeV2, customWindow: TrendChartV2SimulatedHistoryOptions['customWindow'], nowMs: number) {
    if (range === 'custom' && customWindow) {
        const startMs = Date.parse(customWindow.start);
        const endMs = Date.parse(customWindow.end);

        if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
            return {
                startMs,
                endMs,
                start: new Date(startMs).toISOString(),
                end: new Date(endMs).toISOString(),
            };
        }
    }

    const durationMs = range === 'custom' ? RANGE_DURATION_MS['24h'] : RANGE_DURATION_MS[range];
    const startMs = nowMs - durationMs;
    const endMs = nowMs;

    return {
        startMs,
        endMs,
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
    };
}

function createMulberry32(seed: number): () => number {
    let current = seed >>> 0;

    return () => {
        current += 0x6D2B79F5;
        let t = current;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hashSeed(value: string): number {
    let hash = 2166136261;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
}

function roundToTwoDecimals(value: number): number {
    return Math.round(value * 100) / 100;
}
