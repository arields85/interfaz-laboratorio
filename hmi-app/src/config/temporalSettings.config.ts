import type { ShiftDefinition, TemporalSettingsConfig } from '../domain/admin.types';

export const TEMPORAL_SETTINGS_STORAGE_KEY = 'hmi:temporal-settings';
export const TEMPORAL_SETTINGS_CHANGED_EVENT = 'hmi:temporal-settings-changed';
export const TEMPORAL_SETTINGS_FALLBACK_TIMEZONE = 'America/Argentina/Buenos_Aires';

export type TemporalSettingsSaveResult =
    | { ok: true; config: TemporalSettingsConfig }
    | { ok: false; config: TemporalSettingsConfig; error: Error };

const SHIFT_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function getDefaultTemporalSettingsConfig(): TemporalSettingsConfig {
    return {
        plantTimezone: null,
        shifts: [],
    };
}

export function normalizeTemporalSettingsConfig(value: unknown): TemporalSettingsConfig {
    const candidate = typeof value === 'object' && value !== null
        ? (value as Partial<TemporalSettingsConfig>)
        : {};

    return {
        plantTimezone: normalizePlantTimezone(candidate.plantTimezone),
        shifts: normalizeShifts(candidate.shifts),
    };
}

export function readTemporalSettingsConfig(): TemporalSettingsConfig {
    try {
        const stored = localStorage.getItem(TEMPORAL_SETTINGS_STORAGE_KEY);

        if (!stored) {
            return getDefaultTemporalSettingsConfig();
        }

        return normalizeTemporalSettingsConfig(JSON.parse(stored));
    } catch {
        return getDefaultTemporalSettingsConfig();
    }
}

export function saveTemporalSettingsConfig(config: TemporalSettingsConfig): TemporalSettingsSaveResult {
    const normalized = normalizeTemporalSettingsConfig(config);

    try {
        localStorage.setItem(TEMPORAL_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
        document.dispatchEvent(new CustomEvent<TemporalSettingsConfig>(TEMPORAL_SETTINGS_CHANGED_EVENT, {
            detail: normalized,
        }));

        return { ok: true, config: normalized };
    } catch (error) {
        return {
            ok: false,
            config: normalized,
            error: error instanceof Error ? error : new Error('Unknown temporal settings save error'),
        };
    }
}

export function clearTemporalSettingsConfig(): void {
    localStorage.removeItem(TEMPORAL_SETTINGS_STORAGE_KEY);
    document.dispatchEvent(new CustomEvent<TemporalSettingsConfig>(TEMPORAL_SETTINGS_CHANGED_EVENT, {
        detail: getDefaultTemporalSettingsConfig(),
    }));
}

export function resolveTemporalSettingsTimezone(config: TemporalSettingsConfig): string {
    return normalizePlantTimezone(config.plantTimezone)
        ?? getBrowserTimeZone()
        ?? TEMPORAL_SETTINGS_FALLBACK_TIMEZONE;
}

export function isValidTimeZone(value: unknown): value is string {
    if (typeof value !== 'string') {
        return false;
    }

    const trimmed = value.trim();

    if (trimmed === '') {
        return false;
    }

    try {
        new Intl.DateTimeFormat('en-GB', { timeZone: trimmed }).format(new Date(0));
        return true;
    } catch {
        return false;
    }
}

function normalizePlantTimezone(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return isValidTimeZone(trimmed) ? trimmed : null;
}

function normalizeShifts(value: unknown): ShiftDefinition[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((entry) => normalizeShiftDefinition(entry))
        .filter((entry): entry is ShiftDefinition => entry !== null);
}

function normalizeShiftDefinition(value: unknown): ShiftDefinition | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Partial<ShiftDefinition>;
    const id = normalizeRequiredText(candidate.id);
    const label = normalizeRequiredText(candidate.label);
    const start = normalizeShiftTime(candidate.start);
    const end = normalizeShiftTime(candidate.end);

    if (!id || !label || !start || !end) {
        return null;
    }

    return { id, label, start, end };
}

function normalizeRequiredText(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

function normalizeShiftTime(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return SHIFT_TIME_PATTERN.test(trimmed) ? trimmed : null;
}

function getBrowserTimeZone(): string | null {
    try {
        const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
        return normalizePlantTimezone(resolved);
    } catch {
        return null;
    }
}
