export type LoaderProfileId = 'long' | 'short';

export interface LoaderOption {
    enabled: boolean;
    durationSeconds: number;
}

export interface LoaderOptionsConfig {
    long: LoaderOption;
    short: LoaderOption;
}

export interface RuntimeLoaderRequest {
    profileId: LoaderProfileId;
    enabled: boolean;
    durationSeconds: number;
    minVisibleMs: number;
}

export const LOADER_OPTIONS_STORAGE_KEY = 'hmi:loader-options';
export const LOADER_OPTIONS_MIN_SECONDS = 0.2;
export const LOADER_OPTIONS_MAX_SECONDS = 15;
export const LOADER_OPTIONS_DEFAULTS: LoaderOptionsConfig = {
    long: { enabled: true, durationSeconds: 8 },
    short: { enabled: true, durationSeconds: 2 },
};

function cloneLoaderOption(option: LoaderOption): LoaderOption {
    return { ...option };
}

export function getDefaultLoaderOptionsConfig(): LoaderOptionsConfig {
    return {
        long: cloneLoaderOption(LOADER_OPTIONS_DEFAULTS.long),
        short: cloneLoaderOption(LOADER_OPTIONS_DEFAULTS.short),
    };
}

function normalizeDurationSeconds(profileId: LoaderProfileId, value: unknown): number {
    if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
        return LOADER_OPTIONS_DEFAULTS[profileId].durationSeconds;
    }

    if (value < LOADER_OPTIONS_MIN_SECONDS) {
        return LOADER_OPTIONS_DEFAULTS[profileId].durationSeconds;
    }

    return Math.min(value, LOADER_OPTIONS_MAX_SECONDS);
}

function normalizeLoaderOption(profileId: LoaderProfileId, value: unknown): LoaderOption {
    const candidate = typeof value === 'object' && value !== null ? value as Partial<LoaderOption> : {};
    const defaultOption = LOADER_OPTIONS_DEFAULTS[profileId];

    return {
        enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : defaultOption.enabled,
        durationSeconds: normalizeDurationSeconds(profileId, candidate.durationSeconds),
    };
}

export function normalizeLoaderOptionsConfig(value: unknown): LoaderOptionsConfig {
    const candidate = typeof value === 'object' && value !== null ? value as Partial<Record<LoaderProfileId, unknown>> : {};

    return {
        long: normalizeLoaderOption('long', candidate.long),
        short: normalizeLoaderOption('short', candidate.short),
    };
}

export function readLoaderOptionsConfig(): LoaderOptionsConfig {
    try {
        const stored = localStorage.getItem(LOADER_OPTIONS_STORAGE_KEY);

        if (!stored) {
            return getDefaultLoaderOptionsConfig();
        }

        return normalizeLoaderOptionsConfig(JSON.parse(stored));
    } catch {
        return getDefaultLoaderOptionsConfig();
    }
}

export function saveLoaderOptionsConfig(config: LoaderOptionsConfig): void {
    const normalized = normalizeLoaderOptionsConfig(config);
    localStorage.setItem(LOADER_OPTIONS_STORAGE_KEY, JSON.stringify(normalized));
}

export function clearLoaderOptionsConfig(): void {
    localStorage.removeItem(LOADER_OPTIONS_STORAGE_KEY);
}

export function toLoaderDurationMs(durationSeconds: number): number {
    return Math.round(durationSeconds * 1_000);
}

export function resolveRuntimeLoaderRequest(profileId: LoaderProfileId): RuntimeLoaderRequest {
    const option = readLoaderOptionsConfig()[profileId];

    return {
        profileId,
        enabled: option.enabled,
        durationSeconds: option.durationSeconds,
        minVisibleMs: option.enabled ? toLoaderDurationMs(option.durationSeconds) : 0,
    };
}
