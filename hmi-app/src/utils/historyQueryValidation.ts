import type { HistoryQueryParamsAny } from '../domain/dataContract.types';
import { normalizeHistoryMaxPoints } from './trendChartV2Density';

export const CUSTOM_HISTORY_MAX_DURATION_DAYS = 365;
export const CUSTOM_HISTORY_MAX_DURATION_MS = CUSTOM_HISTORY_MAX_DURATION_DAYS * 24 * 60 * 60 * 1000;
const STRICT_ISO_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const VARIABLE_KEY_MAX_LENGTH = 200;
const LEGACY_HISTORY_RANGES = new Set(['minuto', 'hora', 'dia', 'semana', 'mes']);
const V2_PRESET_HISTORY_RANGES = new Set(['1h', '24h', '7d', '30d', '12m']);

export type CustomHistoryWindowValidationError =
    | 'invalid-timestamp'
    | 'start-not-before-end'
    | 'duration-too-large';

export type HistoryQueryValidationError =
    | 'invalid-machine-id'
    | 'invalid-variable-key'
    | 'invalid-range'
    | CustomHistoryWindowValidationError;

export type HistoryQueryValidationResult =
    | {
        ok: true;
        params: HistoryQueryParamsAny;
    }
    | {
        ok: false;
        error: HistoryQueryValidationError;
    };

export type CustomHistoryWindowValidationResult =
    | {
        ok: true;
        startMs: number;
        endMs: number;
    }
    | {
        ok: false;
        error: CustomHistoryWindowValidationError;
    };

export function validateCustomHistoryWindow(start: string, end: string): CustomHistoryWindowValidationResult {
    if (!isStrictIsoUtcTimestamp(start) || !isStrictIsoUtcTimestamp(end)) {
        return { ok: false, error: 'invalid-timestamp' };
    }

    const startMs = Date.parse(start);
    const endMs = Date.parse(end);

    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        return { ok: false, error: 'invalid-timestamp' };
    }

    if (startMs >= endMs) {
        return { ok: false, error: 'start-not-before-end' };
    }

    if (endMs - startMs > CUSTOM_HISTORY_MAX_DURATION_MS) {
        return { ok: false, error: 'duration-too-large' };
    }

    return { ok: true, startMs, endMs };
}

export function validateAndNormalizeHistoryQueryParams(params: HistoryQueryParamsAny | null): HistoryQueryValidationResult {
    if (!params) {
        return { ok: false, error: 'invalid-range' };
    }

    if (!Number.isSafeInteger(params.machineId) || params.machineId < 0) {
        return { ok: false, error: 'invalid-machine-id' };
    }

    const variableKey = normalizeVariableKey(params.variableKey);

    if (variableKey === null) {
        return { ok: false, error: 'invalid-variable-key' };
    }

    if (params.range === 'custom') {
        const customWindowValidation = validateCustomHistoryWindow(params.start, params.end);

        if (!customWindowValidation.ok) {
            return customWindowValidation;
        }

        return {
            ok: true,
            params: {
                machineId: params.machineId,
                variableKey,
                range: 'custom',
                start: params.start,
                end: params.end,
                maxPoints: normalizeHistoryMaxPoints(params.maxPoints) ?? undefined,
            },
        };
    }

    if (!LEGACY_HISTORY_RANGES.has(params.range) && !V2_PRESET_HISTORY_RANGES.has(params.range)) {
        return { ok: false, error: 'invalid-range' };
    }

    const normalizedMaxPoints = 'maxPoints' in params
        ? normalizeHistoryMaxPoints(params.maxPoints)
        : null;

    if (V2_PRESET_HISTORY_RANGES.has(params.range)) {
        return {
            ok: true,
            params: {
                machineId: params.machineId,
                variableKey,
                range: params.range,
                maxPoints: normalizedMaxPoints ?? undefined,
            },
        };
    }

    return {
        ok: true,
        params: {
            machineId: params.machineId,
            variableKey,
            range: params.range,
        },
    };
}

function isStrictIsoUtcTimestamp(value: string): boolean {
    if (!STRICT_ISO_UTC_TIMESTAMP_PATTERN.test(value)) {
        return false;
    }

    const timestampMs = Date.parse(value);

    if (Number.isNaN(timestampMs)) {
        return false;
    }

    return new Date(timestampMs).toISOString() === value;
}

export function isValidHistoryQueryParams(params: HistoryQueryParamsAny | null): boolean {
    return validateAndNormalizeHistoryQueryParams(params).ok;
}

function normalizeVariableKey(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    if (trimmed.length === 0 || trimmed.length > VARIABLE_KEY_MAX_LENGTH || hasControlCharacters(trimmed)) {
        return null;
    }

    return trimmed;
}

function hasControlCharacters(value: string): boolean {
    return Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127;
    });
}
