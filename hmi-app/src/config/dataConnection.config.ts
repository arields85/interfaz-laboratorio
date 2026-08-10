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
export const DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT = '/api/hmi-data/activity-series';
export const DATA_DEFAULT_VOICE_ENDPOINT = '/hmi/voice/latest';
export const DATA_DEFAULT_PRISMA_CONFIG_ENDPOINT = '/hmi/prisma-config';
export const DATA_DEFAULT_SNAPSHOT_EXPORT_INTERVAL_MS = 5_000;
export const DATA_MIN_SNAPSHOT_EXPORT_INTERVAL_MS = 1_000;
export const DATA_CONNECTION_CONFIG_CHANGED_EVENT = 'hmi:data-connection-config-changed';

const LS_KEY_BASE_URL = 'hmi:node-red-base-url';
const LS_KEY_ENDPOINT = 'hmi:node-red-endpoint';
const LS_KEY_HISTORY_ENDPOINT = 'hmi:data-history-endpoint';
const LS_KEY_ACTIVITY_SERIES_ENDPOINT = 'hmi:activity-series-endpoint';
const LS_KEY_SNAPSHOT_EXPORT_ENDPOINT = 'hmi:snapshot-export-endpoint';
const LS_KEY_SNAPSHOT_EXPORT_ENABLED = 'hmi:snapshot-export-enabled';
const LS_KEY_SNAPSHOT_EXPORT_INTERVAL_MS = 'hmi:snapshot-export-interval-ms';
const LS_KEY_VOICE_ENDPOINT = 'hmi:voice-endpoint';
const LS_KEY_PRISMA_CONFIG_ENDPOINT = 'hmi:prisma-config-endpoint';

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

function normalizeSnapshotExportIntervalMs(intervalMs: number): number {
    if (!Number.isFinite(intervalMs)) {
        return DATA_DEFAULT_SNAPSHOT_EXPORT_INTERVAL_MS;
    }

    return Math.max(DATA_MIN_SNAPSHOT_EXPORT_INTERVAL_MS, Math.trunc(intervalMs));
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
        notifyDataConnectionConfigChanged();
    }
}

export function clearDataBaseUrl(): void {
    localStorage.removeItem(LS_KEY_BASE_URL);
    notifyDataConnectionConfigChanged();
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

export function getDataActivitySeriesEndpoint(): string | null {
    try {
        const stored = localStorage.getItem(LS_KEY_ACTIVITY_SERIES_ENDPOINT);

        if (stored !== null) {
            const trimmed = stored.trim();
            return trimmed === '' ? null : '/' + stripLeadingSlashes(trimmed);
        }
    } catch {
        // localStorage unavailable
    }

    return DATA_DEFAULT_ACTIVITY_SERIES_ENDPOINT;
}

export function saveDataActivitySeriesEndpoint(endpoint: string): void {
    localStorage.setItem(LS_KEY_ACTIVITY_SERIES_ENDPOINT, endpoint.trim());
}

export function clearDataActivitySeriesEndpoint(): void {
    localStorage.removeItem(LS_KEY_ACTIVITY_SERIES_ENDPOINT);
}

export function getSavedDataActivitySeriesEndpoint(): string | null {
    try {
        return localStorage.getItem(LS_KEY_ACTIVITY_SERIES_ENDPOINT);
    } catch {
        return null;
    }
}

export function isDataActivitySeriesEnabled(): boolean {
    return getDataBaseUrl() !== null && getDataActivitySeriesEndpoint() !== null;
}

// --- Voice Endpoint ---

export function getDataVoiceEndpoint(): string | null {
    try {
        const stored = localStorage.getItem(LS_KEY_VOICE_ENDPOINT);

        if (stored !== null) {
            const trimmed = stored.trim();
            return trimmed === '' ? null : '/' + stripLeadingSlashes(trimmed);
        }
    } catch {
        // localStorage unavailable
    }

    return DATA_DEFAULT_VOICE_ENDPOINT;
}

export function saveDataVoiceEndpoint(endpoint: string): void {
    localStorage.setItem(LS_KEY_VOICE_ENDPOINT, endpoint.trim());
    notifyDataConnectionConfigChanged();
}

export function clearDataVoiceEndpoint(): void {
    localStorage.removeItem(LS_KEY_VOICE_ENDPOINT);
    notifyDataConnectionConfigChanged();
}

export function getSavedDataVoiceEndpoint(): string | null {
    try {
        return localStorage.getItem(LS_KEY_VOICE_ENDPOINT);
    } catch {
        return null;
    }
}

// --- Prisma Config Endpoint ---

export function getDataPrismaConfigEndpoint(): string | null {
    try {
        const stored = localStorage.getItem(LS_KEY_PRISMA_CONFIG_ENDPOINT);

        if (stored !== null) {
            const trimmed = stored.trim();
            return trimmed === '' ? null : '/' + stripLeadingSlashes(trimmed);
        }
    } catch {
        // localStorage unavailable
    }

    return DATA_DEFAULT_PRISMA_CONFIG_ENDPOINT;
}

export function saveDataPrismaConfigEndpoint(endpoint: string): void {
    try {
        localStorage.setItem(LS_KEY_PRISMA_CONFIG_ENDPOINT, endpoint.trim());
    } catch {
        // Browser storage may be blocked by policy or privacy mode.
    }
}

export function clearDataPrismaConfigEndpoint(): void {
    try {
        localStorage.removeItem(LS_KEY_PRISMA_CONFIG_ENDPOINT);
    } catch {
        // Browser storage may be blocked by policy or privacy mode.
    }
}

export function getSavedDataPrismaConfigEndpoint(): string | null {
    try {
        return localStorage.getItem(LS_KEY_PRISMA_CONFIG_ENDPOINT);
    } catch {
        return null;
    }
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

export function getDataVoiceUrl(): string | null {
    const base = getDataBaseUrl();
    if (!base) return null;
    const voiceEndpoint = getDataVoiceEndpoint();
    if (!voiceEndpoint) return null;
    return `${base}/${stripLeadingSlashes(voiceEndpoint)}`;
}

export function getDataPrismaConfigUrl(): string | null {
    return buildDataUrl(getDataBaseUrl(), getDataPrismaConfigEndpoint());
}

export function getDataSnapshotExportEndpoint(): string | null {
    try {
        const stored = localStorage.getItem(LS_KEY_SNAPSHOT_EXPORT_ENDPOINT);

        if (stored !== null) {
            const trimmed = stored.trim();
            return trimmed === '' ? null : '/' + stripLeadingSlashes(trimmed);
        }
    } catch {
        // localStorage unavailable
    }

    return null;
}

export function saveDataSnapshotExportEndpoint(endpoint: string): void {
    localStorage.setItem(LS_KEY_SNAPSHOT_EXPORT_ENDPOINT, endpoint.trim());
}

export function clearDataSnapshotExportEndpoint(): void {
    localStorage.removeItem(LS_KEY_SNAPSHOT_EXPORT_ENDPOINT);
}

export function getSavedDataSnapshotExportEndpoint(): string | null {
    try {
        return localStorage.getItem(LS_KEY_SNAPSHOT_EXPORT_ENDPOINT);
    } catch {
        return null;
    }
}

export function getDataSnapshotExportEnabledSetting(): boolean {
    try {
        return localStorage.getItem(LS_KEY_SNAPSHOT_EXPORT_ENABLED) === 'true';
    } catch {
        return false;
    }
}

export function saveDataSnapshotExportEnabledSetting(enabled: boolean): void {
    localStorage.setItem(LS_KEY_SNAPSHOT_EXPORT_ENABLED, String(enabled));
}

export function clearDataSnapshotExportEnabledSetting(): void {
    localStorage.removeItem(LS_KEY_SNAPSHOT_EXPORT_ENABLED);
}

export function getDataSnapshotExportIntervalMs(): number {
    try {
        const stored = localStorage.getItem(LS_KEY_SNAPSHOT_EXPORT_INTERVAL_MS);

        if (stored !== null) {
            const parsed = Number.parseInt(stored, 10);

            if (Number.isFinite(parsed) && parsed > 0) {
                return normalizeSnapshotExportIntervalMs(parsed);
            }
        }
    } catch {
        // localStorage unavailable
    }

    return DATA_DEFAULT_SNAPSHOT_EXPORT_INTERVAL_MS;
}

export function saveDataSnapshotExportIntervalMs(intervalMs: number): void {
    localStorage.setItem(LS_KEY_SNAPSHOT_EXPORT_INTERVAL_MS, String(normalizeSnapshotExportIntervalMs(intervalMs)));
}

export function clearDataSnapshotExportIntervalMs(): void {
    localStorage.removeItem(LS_KEY_SNAPSHOT_EXPORT_INTERVAL_MS);
}

export function isDataSnapshotExportEnabled(): boolean {
    return getDataBaseUrl() !== null
        && getDataSnapshotExportEndpoint() !== null
        && getDataSnapshotExportEnabledSetting();
}

export function getDataSnapshotExportUrl(): string | null {
    const base = getDataBaseUrl();
    if (!base) return null;
    const endpoint = getDataSnapshotExportEndpoint();
    if (!endpoint) return null;
    return `${base}/${stripLeadingSlashes(endpoint)}`;
}
