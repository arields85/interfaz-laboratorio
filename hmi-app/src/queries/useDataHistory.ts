// =============================================================================
// Query: useDataHistory
// Hook centralizado para consumir la capa de datos históricos bajo demanda.
//
// Este es el ÚNICO punto de entrada para leer histórico real.
// Ningún componente debe hacer fetch directo — todos consumen desde aquí.
//
// Expone:
//   - data: respuesta histórica ya adaptada al dominio
//   - isLoading, isError, error, isEnabled
//
// Contrato oficial: docs/DATA_CONTRACT.md
// =============================================================================

import { keepPreviousData, useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { adaptDataHistory } from '../adapters/dataHistory.adapter';
import { isDataHistoryEnabled } from '../config/dataConnection.config';
import {
    HISTORY_RANGES_V2,
    type DataHistoryResponse,
    type DataHistoryResponseAny,
    type DataHistoryResponseV2,
    type HistoryQueryParams,
    type HistoryQueryParamsAny,
    type HistoryQueryParamsV2,
    type HistoryRangeV2,
} from '../domain/dataContract.types';
import { fetchDataHistory } from '../services/dataHistory.service';
import { validateAndNormalizeHistoryQueryParams } from '../utils/historyQueryValidation';

export const DATA_HISTORY_QUERY_KEY_PREFIX = ['data', 'history'] as const;
type DataHistoryQueryKey = ReturnType<typeof createDataHistoryQueryKey>;
type DataHistoryQueryOptions = Pick<UseQueryOptions<DataHistoryResponseAny, Error, DataHistoryResponseAny, DataHistoryQueryKey>, 'queryKey' | 'queryFn' | 'placeholderData' | 'staleTime' | 'retry' | 'refetchOnWindowFocus'> & {
    enabled: boolean;
};

export interface UseDataHistoryResult<TData extends DataHistoryResponseAny = DataHistoryResponseAny> {
    data: TData | null;
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
    isEnabled: boolean;
    isFetching: boolean;
    isPlaceholderData: boolean;
    isRefreshing: boolean;
}

export function useDataHistory(params: HistoryQueryParams | null): UseDataHistoryResult<DataHistoryResponse>;
export function useDataHistory(params: HistoryQueryParamsV2 | null): UseDataHistoryResult<DataHistoryResponseV2>;
export function useDataHistory(params: HistoryQueryParamsAny | null): UseDataHistoryResult<DataHistoryResponseAny>;
export function useDataHistory(params: HistoryQueryParamsAny | null): UseDataHistoryResult<DataHistoryResponseAny> {
    const queryOptions = createDataHistoryQueryOptions(params);
    const query = useQuery<DataHistoryResponseAny, Error, DataHistoryResponseAny, DataHistoryQueryKey>(queryOptions);
    const isFetching = queryOptions.enabled ? query.isFetching === true : false;
    const isPlaceholderData = queryOptions.enabled ? query.isPlaceholderData === true : false;

    return {
        data: query.data ?? null,
        isLoading: queryOptions.enabled ? query.isLoading : false,
        isError: queryOptions.enabled ? query.isError : false,
        error: queryOptions.enabled ? query.error ?? null : null,
        isEnabled: queryOptions.enabled,
        isFetching,
        isPlaceholderData,
        isRefreshing: isFetching && isPlaceholderData,
    };
}

export function createDataHistoryQueryKey(params: HistoryQueryParamsAny | null) {
    const normalizedParams = normalizeHistoryQueryParams(params);

    return buildDataHistoryQueryKey(normalizedParams);
}

export function isDataHistoryResponseCompatible(
    params: HistoryQueryParamsAny | null,
    response: Pick<DataHistoryResponseAny, 'machineId' | 'variableKey' | 'range'> & {
        window?: { start: string; end: string };
    },
): boolean {
    const normalizedParams = normalizeHistoryQueryParams(params);

    if (
        normalizedParams === null
        || response.machineId !== normalizedParams.machineId
        || response.variableKey !== normalizedParams.variableKey
    ) {
        return false;
    }

    if (normalizedParams.range === 'custom') {
        return response.range === 'custom'
            && response.window !== undefined
            && isSameInstant(normalizedParams.start, response.window.start)
            && isSameInstant(normalizedParams.end, response.window.end);
    }

    const requestUsesV2Range = HISTORY_RANGES_V2.includes(normalizedParams.range as HistoryRangeV2);
    const responseUsesV2Range = HISTORY_RANGES_V2.includes(response.range as HistoryRangeV2);

    if (!requestUsesV2Range) {
        return response.range === normalizedParams.range;
    }

    return !responseUsesV2Range || response.range === normalizedParams.range;
}

export function createDataHistoryQueryOptions(params: HistoryQueryParamsAny | null): DataHistoryQueryOptions {
    const normalizedParams = normalizeHistoryQueryParams(params);
    const enabled = normalizedParams !== null && isDataHistoryEnabled();

    return {
        queryKey: buildDataHistoryQueryKey(normalizedParams),
        queryFn: async (context) => {
            if (!normalizedParams) {
                throw new Error('History query params are required');
            }

            const signal = context?.signal;
            const raw = await fetchDataHistory(normalizedParams, signal);
            return adaptDataHistory(raw);
        },
        enabled,
        placeholderData: keepPreviousData,
        staleTime: 30_000,
        retry: 2,
        refetchOnWindowFocus: true,
    };
}

function normalizeHistoryQueryParams(params: HistoryQueryParamsAny | null): HistoryQueryParamsAny | null {
    const validation = validateAndNormalizeHistoryQueryParams(params);

    if (!validation.ok) {
        return null;
    }

    return validation.params;
}

function isSameInstant(left: string, right: string): boolean {
    const leftMs = Date.parse(left);
    const rightMs = Date.parse(right);

    return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

function buildDataHistoryQueryKey(normalizedParams: ReturnType<typeof normalizeHistoryQueryParams>) {
    return [
        ...DATA_HISTORY_QUERY_KEY_PREFIX,
        normalizedParams?.machineId ?? null,
        normalizedParams?.variableKey ?? null,
        normalizedParams?.range ?? null,
        normalizedParams && 'start' in normalizedParams ? normalizedParams.start : null,
        normalizedParams && 'end' in normalizedParams ? normalizedParams.end : null,
        normalizedParams && 'maxPoints' in normalizedParams ? normalizedParams.maxPoints ?? null : null,
    ] as const;
}
