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

export const DATA_HISTORY_REQUEST_TIMEOUT_MS = 10_000;

const DATA_HISTORY_NETWORK_ERROR_MESSAGE = 'Network error fetching data history';
const DATA_HISTORY_TIMEOUT_ERROR_MESSAGE = 'Data history request timed out';
const DATA_HISTORY_CLIENT_ERROR_MESSAGE = 'Data history request could not be completed';
const DATA_HISTORY_SERVER_ERROR_MESSAGE = 'Data history data is temporarily unavailable';

export type DataHistoryServiceErrorKind = 'network' | 'timeout' | 'http';

export class DataHistoryServiceError extends DataServiceError {
    public readonly kind: DataHistoryServiceErrorKind;

    constructor(message: string, kind: DataHistoryServiceErrorKind, statusCode?: number) {
        super(message, statusCode);
        this.name = 'DataHistoryServiceError';
        this.kind = kind;
    }
}

export function isDataHistoryConnectionError(error: unknown): error is DataHistoryServiceError {
    return error instanceof DataHistoryServiceError
        && (error.kind === 'network' || error.kind === 'timeout');
}

/**
 * Fetch crudo al endpoint de histórico.
 * Devuelve el JSON tal cual viene — sin transformar ni validar.
 * El adapter downstream es responsable de mapear al dominio.
 */
export async function fetchDataHistory(params: HistoryQueryParamsAny, externalSignal?: AbortSignal): Promise<unknown> {
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
    const abortController = new AbortController();
    const removeExternalAbortListener = bindExternalAbortSignal(externalSignal, abortController);
    let didTimeout = false;
    const timeoutId = setTimeout(() => {
        didTimeout = true;
        abortController.abort();
    }, DATA_HISTORY_REQUEST_TIMEOUT_MS);

    try {
        response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                Accept: 'application/json',
            },
            signal: abortController.signal,
        });
    } catch {
        if (didTimeout) {
            throw new DataHistoryServiceError(DATA_HISTORY_TIMEOUT_ERROR_MESSAGE, 'timeout');
        }

        if (externalSignal?.aborted) {
            throw externalSignal.reason instanceof Error
                ? externalSignal.reason
                : createAbortError();
        }

        throw new DataHistoryServiceError(DATA_HISTORY_NETWORK_ERROR_MESSAGE, 'network');
    } finally {
        clearTimeout(timeoutId);
        removeExternalAbortListener();
    }

    if (!response.ok) {
        throw new DataHistoryServiceError(
            getSanitizedDataHistoryHttpMessage(response.status),
            'http',
            response.status
        );
    }

    return response.json();
}

function bindExternalAbortSignal(externalSignal: AbortSignal | undefined, abortController: AbortController): () => void {
    if (!externalSignal) {
        return () => {};
    }

    if (externalSignal.aborted) {
        abortController.abort(externalSignal.reason);

        return () => {};
    }

    const handleAbort = () => {
        abortController.abort(externalSignal.reason);
    };

    externalSignal.addEventListener('abort', handleAbort, { once: true });

    return () => {
        externalSignal.removeEventListener('abort', handleAbort);
    };
}

function createAbortError(): Error {
    if (typeof DOMException === 'function') {
        return new DOMException('The operation was aborted.', 'AbortError');
    }

    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
}

function getSanitizedDataHistoryHttpMessage(statusCode: number): string {
    if (statusCode >= 500) {
        return DATA_HISTORY_SERVER_ERROR_MESSAGE;
    }

    if (statusCode >= 400) {
        return DATA_HISTORY_CLIENT_ERROR_MESSAGE;
    }

    return `Data history request failed with status ${statusCode}`;
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
