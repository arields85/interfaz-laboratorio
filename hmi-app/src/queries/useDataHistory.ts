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

import { useQuery } from '@tanstack/react-query';
import { adaptDataHistory } from '../adapters/dataHistory.adapter';
import { isDataHistoryEnabled } from '../config/dataConnection.config';
import type {
    DataHistoryResponse,
    DataHistoryResponseAny,
    DataHistoryResponseV2,
    HistoryQueryParams,
    HistoryQueryParamsAny,
    HistoryQueryParamsV2,
} from '../domain/dataContract.types';
import { fetchDataHistory } from '../services/dataHistory.service';
import { validateAndNormalizeHistoryQueryParams } from '../utils/historyQueryValidation';

export const DATA_HISTORY_QUERY_KEY_PREFIX = ['data', 'history'] as const;

export interface UseDataHistoryResult<TData extends DataHistoryResponseAny = DataHistoryResponseAny> {
    data: TData | null;
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
    isEnabled: boolean;
}

export function useDataHistory(params: HistoryQueryParams | null): UseDataHistoryResult<DataHistoryResponse>;
export function useDataHistory(params: HistoryQueryParamsV2 | null): UseDataHistoryResult<DataHistoryResponseV2>;
export function useDataHistory(params: HistoryQueryParamsAny | null): UseDataHistoryResult<DataHistoryResponseAny>;
export function useDataHistory(params: HistoryQueryParamsAny | null): UseDataHistoryResult<DataHistoryResponseAny> {
    const normalizedParams = normalizeHistoryQueryParams(params);
    const enabled = normalizedParams !== null && isDataHistoryEnabled();

    const query = useQuery<DataHistoryResponseAny>({
        queryKey: [
            ...DATA_HISTORY_QUERY_KEY_PREFIX,
            normalizedParams?.machineId ?? null,
            normalizedParams?.variableKey ?? null,
            normalizedParams?.range ?? null,
            normalizedParams && 'start' in normalizedParams ? normalizedParams.start : null,
            normalizedParams && 'end' in normalizedParams ? normalizedParams.end : null,
            normalizedParams && 'maxPoints' in normalizedParams ? normalizedParams.maxPoints ?? null : null,
        ],
        queryFn: async () => {
            if (!normalizedParams) {
                throw new Error('History query params are required');
            }

            const raw = await fetchDataHistory(normalizedParams);
            return adaptDataHistory(raw);
        },
        enabled,
        staleTime: 30_000,
        retry: 2,
        refetchOnWindowFocus: true,
    });

    return {
        data: query.data ?? null,
        isLoading: query.isLoading,
        isError: query.isError,
        error: query.error ?? null,
        isEnabled: enabled,
    };
}

function normalizeHistoryQueryParams(params: HistoryQueryParamsAny | null): HistoryQueryParamsAny | null {
    const validation = validateAndNormalizeHistoryQueryParams(params);

    if (!validation.ok) {
        return null;
    }

    return validation.params;
}
