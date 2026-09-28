import type { StatusDisplayOptions } from '../domain/admin.types';
import type { EquipmentStatus } from '../domain/equipment.types';

export const EQUIPMENT_STATUS_VALUES: EquipmentStatus[] = [
    'running',
    'idle',
    'warning',
    'critical',
    'offline',
    'maintenance',
    'unknown',
];

export const DEFAULT_STATUS_LABELS: Record<EquipmentStatus, string> = {
    running: 'En Producción',
    idle: 'Stand-by',
    warning: 'Advertencia',
    critical: 'Crítico',
    offline: 'Offline',
    maintenance: 'Mantenimiento',
    unknown: 'Desconocido',
};

/**
 * Only the string-valued `StatusDisplayOptions` keys used for per-status
 * custom labels. Narrower than `keyof StatusDisplayOptions` on purpose --
 * that interface also carries non-string options (e.g. `showFrame: boolean`,
 * P2 2026-09-28), and widening this map to the full `keyof` would make every
 * `options?.[optionKey]` read below resolve to `string | boolean`.
 */
type StatusTextOptionKey = 'runningText' | 'idleText' | 'warningText' | 'criticalText' | 'offlineText' | 'maintenanceText' | 'unknownText';

export const STATUS_TEXT_OPTION_KEY: Record<EquipmentStatus, StatusTextOptionKey> = {
    running: 'runningText',
    idle: 'idleText',
    warning: 'warningText',
    critical: 'criticalText',
    offline: 'offlineText',
    maintenance: 'maintenanceText',
    unknown: 'unknownText',
};

export function createDefaultStatusDisplayOptions(): StatusDisplayOptions {
    return EQUIPMENT_STATUS_VALUES.reduce<StatusDisplayOptions>((acc, status) => {
        acc[STATUS_TEXT_OPTION_KEY[status]] = DEFAULT_STATUS_LABELS[status];
        return acc;
    }, {});
}

export function normalizeSimulatedEquipmentStatus(value: number | string | boolean | undefined): EquipmentStatus {
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (EQUIPMENT_STATUS_VALUES.includes(normalized as EquipmentStatus)) {
            return normalized as EquipmentStatus;
        }
        if (normalized === '1' || normalized === 'true') return 'running';
        if (normalized === '0' || normalized === 'false') return 'unknown';
        return 'unknown';
    }

    if (typeof value === 'number') {
        if (value === 1) return 'running';
        if (value === 0) return 'unknown';
    }

    if (typeof value === 'boolean') {
        return value ? 'running' : 'unknown';
    }

    return 'unknown';
}

export function resolveStatusLabel(status: EquipmentStatus, options?: StatusDisplayOptions): string {
    const optionKey = STATUS_TEXT_OPTION_KEY[status];
    const customText = optionKey ? options?.[optionKey] : undefined;
    return customText?.trim() || DEFAULT_STATUS_LABELS[status];
}
