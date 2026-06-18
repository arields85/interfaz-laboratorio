import type { ConnectionStatusDisplayOptions } from '../domain/admin.types';
import type { ContractStatus } from '../domain/dataContract.types';

// =============================================================================
// Connection Widget Utilities
// Funciones compartidas para widgets de conexión basados en ContractStatus.
// Contrato oficial: online | degradado | offline | unknown
// =============================================================================

export const CONTRACT_STATUS_VALUES: ContractStatus[] = [
    'online',
    'degradado',
    'offline',
    'unknown',
];

export const DEFAULT_CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
    online: 'Online',
    degradado: 'Degradado',
    offline: 'Sin señal',
    unknown: 'Sin datos',
};

type ConnectionStatusTextKey = 'onlineText' | 'degradadoText' | 'offlineText' | 'unknownText';

const STATUS_TEXT_KEY: Record<ContractStatus, ConnectionStatusTextKey> = {
    online: 'onlineText',
    degradado: 'degradadoText',
    offline: 'offlineText',
    unknown: 'unknownText',
};

/**
 * Normaliza un valor simulado (string, number, boolean) a ContractStatus.
 * Soporta valores legacy (1/0, true/false, connected/disconnected, degraded, stale).
 */
export function normalizeSimulatedToContractStatus(
    value: number | string | boolean | undefined,
): ContractStatus {
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (CONTRACT_STATUS_VALUES.includes(normalized as ContractStatus)) {
            return normalized as ContractStatus;
        }
        if (normalized === '1' || normalized === 'true' || normalized === 'connected' || normalized === 'conectado') {
            return 'online';
        }
        if (normalized === '0' || normalized === 'false' || normalized === 'disconnected' || normalized === 'desconectado') {
            return 'offline';
        }
        // Legacy compat: map old ConnectionState values
        if (normalized === 'degraded') return 'degradado';
        if (normalized === 'stale') return 'degradado';
        return 'unknown';
    }
    if (typeof value === 'number') {
        if (value === 1) return 'online';
        if (value === 0) return 'offline';
        return 'unknown';
    }
    if (typeof value === 'boolean') {
        return value ? 'online' : 'offline';
    }
    return 'unknown';
}

/**
 * Resuelve el label de un ContractStatus usando displayOptions custom o defaults.
 */
export function resolveContractStatusLabel(
    status: ContractStatus,
    options?: ConnectionStatusDisplayOptions,
): string {
    const key = STATUS_TEXT_KEY[status];
    const custom = options?.[key];
    return custom?.trim() || DEFAULT_CONTRACT_STATUS_LABELS[status];
}

export function formatAbsoluteConnectionTime(lastSuccess: string | null): string {
    if (!lastSuccess) {
        return '';
    }

    const parsedDate = new Date(lastSuccess);

    if (Number.isNaN(parsedDate.getTime())) {
        return '';
    }

    return new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(parsedDate);
}

export function formatConnectionFreshness(ageMs: number | null, lastSuccess: string | null): string {
    if (ageMs == null) {
        return formatAbsoluteConnectionTime(lastSuccess);
    }

    const seconds = Math.floor(ageMs / 1000);

    if (seconds < 0) return '';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
    return `${Math.floor(seconds / 3600)}h`;
}

/**
 * Crea displayOptions por defecto para widgets de conexión con los 4 estados del contrato.
 */
export function createDefaultConnectionStatusDisplayOptions(): ConnectionStatusDisplayOptions {
    return CONTRACT_STATUS_VALUES.reduce<ConnectionStatusDisplayOptions>((acc, status) => {
        const key = STATUS_TEXT_KEY[status];
        acc[key] = DEFAULT_CONTRACT_STATUS_LABELS[status];
        return acc;
    }, {});
}
