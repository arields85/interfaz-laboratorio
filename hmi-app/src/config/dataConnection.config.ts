import { sharedConfigStorage } from '../services/sharedConfigStorage.service';

// =============================================================================
// Config: Data Connection
// Configuración de conexión con la capa de datos en tiempo real.
//
// La HMI no sabe ni le importa si detrás hay Node-RED, RabbitMQ u otra cosa.
// Solo conoce: baseUrl + endpoint → URL final.
//
// Persistido en la configuración compartida del servidor. Las claves se mantienen por
// compatibilidad con configs guardadas existentes. Si se renombran, se pierde su config.
//
// Contrato oficial: docs/DATA_CONTRACT.md §4
// =============================================================================

export const DATA_DEFAULT_REFETCH_INTERVAL = 5_000;
export const DATA_DEFAULT_STALE_TIME = 4_000;
export const DATA_DEFAULT_ENDPOINT = '/api/hmi-data';
export const DATA_DEFAULT_HISTORY_ENDPOINT = '/api/hmi-data/history';
export const DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT = '/api/hmi-data/activity-series';
export const DATA_CONNECTION_CONFIG_CHANGED_EVENT = 'hmi:data-connection-config-changed';

export const BASE_URL_STORAGE_KEY = 'hmi:node-red-base-url';
export const ENDPOINT_STORAGE_KEY = 'hmi:node-red-endpoint';
export const HISTORY_ENDPOINT_STORAGE_KEY = 'hmi:data-history-endpoint';
export const ACTIVITY_SERIES_ENDPOINT_STORAGE_KEY = 'hmi:activity-series-endpoint';

function stripTrailingSlashes(raw: string): string {
    return raw.replace(/\/+$/, '');
}

function stripLeadingSlashes(raw: string): string {
    return raw.replace(/^\/+/, '');
}

function normalizeUrl(raw: string | null | undefined): string | null {
    if (!raw || raw.trim() === '') return null;
    return stripTrailingSlashes(raw.trim());
}

export function buildDataUrl(
    baseUrl: string | null | undefined,
    endpoint: string | null | undefined,
): string | null {
    const base = normalizeUrl(baseUrl);
    const normalizedEndpoint = endpoint?.trim();
    if (!base || !normalizedEndpoint) return null;
    return `${base}/${stripLeadingSlashes(normalizedEndpoint)}`;
}

function notifyDataConnectionConfigChanged(): void {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
        return;
    }

    window.dispatchEvent(new Event(DATA_CONNECTION_CONFIG_CHANGED_EVENT));
}

// --- Base URL ---

export function getDataBaseUrl(): string | null {
    try {
        const stored = sharedConfigStorage.getItem(BASE_URL_STORAGE_KEY);
        const fromStorage = normalizeUrl(stored);
        if (fromStorage) return fromStorage;
    } catch {
        // shared configuration unavailable
    }

    const fromEnv = import.meta.env.VITE_NODE_RED_BASE_URL as string | undefined;
    return normalizeUrl(fromEnv);
}

export function isDataConnectionEnabled(): boolean {
    return getDataBaseUrl() !== null;
}

export function saveDataBaseUrl(url: string): void {
    const normalized = normalizeUrl(url);
    if (normalized) {
        sharedConfigStorage.setItem(BASE_URL_STORAGE_KEY, normalized);
        notifyDataConnectionConfigChanged();
    }
}

export function clearDataBaseUrl(): void {
    sharedConfigStorage.removeItem(BASE_URL_STORAGE_KEY);
    notifyDataConnectionConfigChanged();
}

export function getSavedDataBaseUrl(): string {
    try {
        return sharedConfigStorage.getItem(BASE_URL_STORAGE_KEY) ?? '';
    } catch {
        return '';
    }
}

// --- Endpoint ---

export function getDataEndpoint(): string {
    try {
        const stored = sharedConfigStorage.getItem(ENDPOINT_STORAGE_KEY);
        if (stored && stored.trim() !== '') {
            return '/' + stripLeadingSlashes(stored.trim());
        }
    } catch {
        // shared configuration unavailable
    }
    return DATA_DEFAULT_ENDPOINT;
}

export function saveDataEndpoint(endpoint: string): void {
    const trimmed = endpoint.trim();
    if (trimmed) {
        sharedConfigStorage.setItem(ENDPOINT_STORAGE_KEY, trimmed);
    }
}

export function clearDataEndpoint(): void {
    sharedConfigStorage.removeItem(ENDPOINT_STORAGE_KEY);
}

export function getSavedDataEndpoint(): string {
    try {
        return sharedConfigStorage.getItem(ENDPOINT_STORAGE_KEY) ?? '';
    } catch {
        return '';
    }
}

// --- History Endpoint ---

export function getDataHistoryEndpoint(): string | null {
    try {
        const stored = sharedConfigStorage.getItem(HISTORY_ENDPOINT_STORAGE_KEY);
        if (stored && stored.trim() !== '') {
            return '/' + stripLeadingSlashes(stored.trim());
        }
    } catch {
        // shared configuration unavailable
    }
    return DATA_DEFAULT_HISTORY_ENDPOINT;
}

export function saveDataHistoryEndpoint(endpoint: string): void {
    const trimmed = endpoint.trim();
    if (trimmed) {
        sharedConfigStorage.setItem(HISTORY_ENDPOINT_STORAGE_KEY, trimmed);
    }
}

export function clearDataHistoryEndpoint(): void {
    sharedConfigStorage.removeItem(HISTORY_ENDPOINT_STORAGE_KEY);
}

export function getSavedDataHistoryEndpoint(): string {
    try {
        return sharedConfigStorage.getItem(HISTORY_ENDPOINT_STORAGE_KEY) ?? '';
    } catch {
        return '';
    }
}

export function isDataHistoryEnabled(): boolean {
    return getDataBaseUrl() !== null && getDataHistoryEndpoint() !== null;
}

export function getDataActivitySeriesEndpoint(): string | null {
    try {
        const stored = sharedConfigStorage.getItem(ACTIVITY_SERIES_ENDPOINT_STORAGE_KEY);

        if (stored !== null) {
            const trimmed = stored.trim();
            return trimmed === '' ? null : '/' + stripLeadingSlashes(trimmed);
        }
    } catch {
        // shared configuration unavailable
    }

    return DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT;
}

export function saveDataActivitySeriesEndpoint(endpoint: string): void {
    sharedConfigStorage.setItem(ACTIVITY_SERIES_ENDPOINT_STORAGE_KEY, endpoint.trim());
}

export function clearDataActivitySeriesEndpoint(): void {
    sharedConfigStorage.removeItem(ACTIVITY_SERIES_ENDPOINT_STORAGE_KEY);
}

export function getSavedDataActivitySeriesEndpoint(): string | null {
    try {
        return sharedConfigStorage.getItem(ACTIVITY_SERIES_ENDPOINT_STORAGE_KEY);
    } catch {
        return null;
    }
}

export function isDataActivitySeriesEnabled(): boolean {
    return getDataBaseUrl() !== null && getDataActivitySeriesEndpoint() !== null;
}

// --- Full URLs ---

export function getDataFullUrl(): string | null {
    const base = getDataBaseUrl();
    if (!base) return null;
    const endpoint = getDataEndpoint();
    return `${base}/${stripLeadingSlashes(endpoint)}`;
}

export function getDataHistoryUrl(): string | null {
    const base = getDataBaseUrl();
    if (!base) return null;
    const historyEndpoint = getDataHistoryEndpoint();
    if (!historyEndpoint) return null;
    return `${base}/${stripLeadingSlashes(historyEndpoint)}`;
}

export function getDataActivitySeriesUrl(): string | null {
    const base = getDataBaseUrl();
    if (!base) return null;
    const activitySeriesEndpoint = getDataActivitySeriesEndpoint();
    if (!activitySeriesEndpoint) return null;
    return `${base}/${stripLeadingSlashes(activitySeriesEndpoint)}`;
}
