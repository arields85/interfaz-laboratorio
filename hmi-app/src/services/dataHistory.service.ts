// =============================================================================
// Service: Data History
// Capa de acceso HTTP al endpoint de histórico.
//
// Este servicio NO sabe qué hay detrás del endpoint.
// Solo hace GET a la URL configurada y devuelve el JSON crudo.
// El adapter se encarga de mapearlo al dominio.
//
// Contrato oficial: docs/DATA_CONTRACT.md
// =============================================================================

import { getDataHistoryUrl } from '../config/dataConnection.config';
import type { HistoryQueryParamsAny } from '../domain/dataContract.types';
import { validateAndNormalizeHistoryQueryParams } from '../utils/historyQueryValidation';
import { DataServiceError } from './dataOverview.service';

/**
 * Fetch crudo al endpoint de histórico.
 * Devuelve el JSON tal cual viene — sin transformar ni validar.
 * El adapter downstream es responsable de mapear al dominio.
 */
export async function fetchDataHistory(params: HistoryQueryParamsAny): Promise<unknown> {
    const validation = validateAndNormalizeHistoryQueryParams(params);

    if (!validation.ok) {
        throw createHistoryQueryError(validation.error);
    }

    const normalizedParams = validation.params;
    const baseUrl = getDataHistoryUrl();

    if (!baseUrl) {
        throw new DataServiceError('Data history URL is not configured');
    }

    const url = new URL(baseUrl);
    url.searchParams.set('machineId', String(normalizedParams.machineId));
    url.searchParams.set('variableKey', normalizedParams.variableKey);
    url.searchParams.set('range', normalizedParams.range);

    if ('start' in normalizedParams) {
        url.searchParams.set('start', normalizedParams.start);
        url.searchParams.set('end', normalizedParams.end);
    }

    const normalizedMaxPoints = 'maxPoints' in normalizedParams
        ? normalizedParams.maxPoints ?? null
        : null;

    if (normalizedMaxPoints !== null) {
        url.searchParams.set('maxPoints', String(normalizedMaxPoints));
    }

    let response: Response;

    try {
        response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                Accept: 'application/json',
            },
        });
    } catch (error) {
        throw new DataServiceError(
            `Network error fetching data history: ${(error as Error).message}`
        );
    }

    if (!response.ok) {
        throw new DataServiceError(
            `Data history returned ${response.status}: ${response.statusText}`,
            response.status
        );
    }

    return response.json();
}

function createHistoryQueryError(reason: 'invalid-machine-id' | 'invalid-variable-key' | 'invalid-range' | 'invalid-timestamp' | 'start-not-before-end' | 'duration-too-large'): DataServiceError {
    switch (reason) {
    case 'invalid-machine-id':
        return new DataServiceError('History query must use a non-negative integer machineId');
    case 'invalid-variable-key':
        return new DataServiceError('History query must use a safe non-empty variableKey');
    case 'invalid-range':
        return new DataServiceError('History query must use a supported range');
    case 'invalid-timestamp':
        return new DataServiceError('Custom history window must use valid timestamps');
    case 'start-not-before-end':
        return new DataServiceError('Custom history window must have start before end');
    case 'duration-too-large':
        return new DataServiceError('Custom history window must be 365 days or less');
    }
}
