// =============================================================================
// Config: Data Connection
// Configuración de conexión con la capa de datos en tiempo real.
//
// La HMI no sabe ni le importa si detrás hay Node-RED, RabbitMQ u otra cosa.
// Solo conoce: baseUrl + endpoint → URL final.
//
// Las claves de localStorage se mantienen por compatibilidad con configs
// guardadas existentes. Si se renombran, los usuarios pierden su config.
//
// Contrato oficial: docs/DATA_CONTRACT.md §4
// =============================================================================

export const DATA_DEFAULT_REFETCH_INTERVAL = 5_000;
export const DATA_DEFAULT_STALE_TIME = 4_000;
export const DATA_DEFAULT_ENDPOINT = '/api/hmi-data';
export const DATA_DEFAULT_HISTORY_ENDPOINT = '/api/hmi-data/history';

const LS_KEY_BASE_URL = 'hmi:node-red-base-url';
const LS_KEY_ENDPOINT = 'hmi:node-red-endpoint';
const LS_KEY_HISTORY_ENDPOINT = 'hmi:data-history-endpoint';

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

// --- Base URL ---

export function getDataBaseUrl(): string | null {
    try {
        const stored = localStorage.getItem(LS_KEY_BASE_URL);
        const fromStorage = normalizeUrl(stored);
        if (fromStorage) return fromStorage;
    } catch {
        // localStorage unavailable
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
        localStorage.setItem(LS_KEY_BASE_URL, normalized);
    }
}

export function clearDataBaseUrl(): void {
    localStorage.removeItem(LS_KEY_BASE_URL);
}

export function getSavedDataBaseUrl(): string {
    try {
        return localStorage.getItem(LS_KEY_BASE_URL) ?? '';
    } catch {
        return '';
    }
}

// --- Endpoint ---

export function getDataEndpoint(): string {
    try {
        const stored = localStorage.getItem(LS_KEY_ENDPOINT);
        if (stored && stored.trim() !== '') {
            return '/' + stripLeadingSlashes(stored.trim());
        }
    } catch {
        // localStorage unavailable
    }
    return DATA_DEFAULT_ENDPOINT;
}

export function saveDataEndpoint(endpoint: string): void {
    const trimmed = endpoint.trim();
    if (trimmed) {
        localStorage.setItem(LS_KEY_ENDPOINT, trimmed);
    }
}

export function clearDataEndpoint(): void {
    localStorage.removeItem(LS_KEY_ENDPOINT);
}

export function getSavedDataEndpoint(): string {
    try {
        return localStorage.getItem(LS_KEY_ENDPOINT) ?? '';
    } catch {
        return '';
    }
}

// --- History Endpoint ---

export function getDataHistoryEndpoint(): string | null {
    try {
        const stored = localStorage.getItem(LS_KEY_HISTORY_ENDPOINT);
        if (stored && stored.trim() !== '') {
            return '/' + stripLeadingSlashes(stored.trim());
        }
    } catch {
        // localStorage unavailable
    }
    return DATA_DEFAULT_HISTORY_ENDPOINT;
}

export function saveDataHistoryEndpoint(endpoint: string): void {
    const trimmed = endpoint.trim();
    if (trimmed) {
        localStorage.setItem(LS_KEY_HISTORY_ENDPOINT, trimmed);
    }
}

export function clearDataHistoryEndpoint(): void {
    localStorage.removeItem(LS_KEY_HISTORY_ENDPOINT);
}

export function getSavedDataHistoryEndpoint(): string {
    try {
        return localStorage.getItem(LS_KEY_HISTORY_ENDPOINT) ?? '';
    } catch {
        return '';
    }
}

export function isDataHistoryEnabled(): boolean {
    return getDataBaseUrl() !== null && getDataHistoryEndpoint() !== null;
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
