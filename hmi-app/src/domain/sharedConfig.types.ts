// Shared HMI configuration: the document every browser reads from the runtime and
// that the administrator writes back in batches. Wire contract and bounds mirror
// services/prisma-runtime/src/prisma_runtime/hmi_config_store.py.

export const SHARED_CONFIG_CACHE_VERSION = 1;
export const MAX_SHARED_CONFIG_KEY_LENGTH = 128;
export const MAX_SHARED_CONFIG_VALUE_BYTES = 4 * 1024 * 1024;
export const MAX_SHARED_CONFIG_BATCH_OPERATIONS = 200;
export const MAX_SHARED_CONFIG_REQUEST_BYTES = 16 * 1024 * 1024;

// Rejections that resending the same batch cannot fix: it is dropped instead of retried.
export const SHARED_CONFIG_PERMANENT_ERROR_CODES: ReadonlySet<string> = new Set([
    'HMI_CONFIG_DOCUMENT_TOO_LARGE',
    'HMI_CONFIG_REQUEST_TOO_LARGE',
    'HMI_CONFIG_VALUE_TOO_LARGE',
    'HMI_CONFIG_INVALID_REQUEST',
    'SHARED_CONFIG_INVALID_KEY',
    'SHARED_CONFIG_VALUE_TOO_LARGE',
]);

// The single list of localStorage keys that belong to the shared configuration: the five
// content stores plus the HMI configuration (data connection, name, loader and temporal
// options, Prisma orb, theme, design and shader). A pinning test ties it to the modules'
// own key constants. Per-browser state must never be added here: hierarchy expanded nodes,
// dialog tab, ui store, voice prebuffer, auth keys, alert history, the hidden-access flag,
// the adapter cache and the device-level exporter and runtime-mode keys.
export const SHARED_CONFIG_KEYS: readonly string[] = [
    'laboratorio_hmi_dashboards_v1',
    'laboratorio_hmi_templates_v1',
    'laboratorio_hmi_variable_catalog_v1',
    'laboratorio_hmi_hierarchy_v1',
    'laboratorio_hmi_node_types_v1',
    'hmi:node-red-base-url',
    'hmi:node-red-endpoint',
    'hmi:data-history-endpoint',
    'hmi:activity-series-endpoint',
    'hmi:prisma-hmi-name',
    'hmi:loader-options',
    'hmi:temporal-settings',
    'hmi:prisma-orb-visual-config',
    'hmi-theme-style',
    'hmi-theme-frame-radius',
    'hmi-viewer-entrance',
    'hmi-frame-shape',
    'hmi-icon-cutout',
    'hmi-link-corner-accents',
    'hmi-link-corner-accent-lengths',
    'hmi-link-corner-accent-geometry',
    'hmi-theme-fonts',
    'hmi-theme-colors',
    'hmi-shader-params',
];

export function isSharedConfigKey(key: string): boolean {
    return SHARED_CONFIG_KEYS.includes(key);
}

const SHARED_CONFIG_KEY_PATTERN = /^[A-Za-z0-9:._-]+$/;

/** Synchronous key/value surface the content stores persist through (the shared adapter, or a fake). */
export interface ConfigStoragePort {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export type SharedConfigSource = 'server' | 'cache' | 'empty';

/** `local-fallback`: the server document was never written, so shared keys read this browser's own copy. */
export type SharedConfigBootstrap = 'local-fallback' | null;

export interface SharedConfigDocument {
    revision: number;
    items: Record<string, string>;
}

export interface SharedConfigBatch {
    set: Record<string, string>;
    delete: string[];
}

export interface SharedConfigWriteResult {
    revision: number;
}

export interface SharedConfigSaveError {
    code: string;
    status: number | null;
}

export interface SharedConfigStatus {
    loaded: boolean;
    source: SharedConfigSource | null;
    revision: number | null;
    bootstrap: SharedConfigBootstrap;
    saving: boolean;
    unsavedKeyCount: number;
    saveError: SharedConfigSaveError | null;
}

export interface SharedConfigChange {
    changedKeys: readonly string[];
}

export function isValidSharedConfigKey(key: string): boolean {
    return key.length > 0 && key.length <= MAX_SHARED_CONFIG_KEY_LENGTH && SHARED_CONFIG_KEY_PATTERN.test(key);
}

export function isSharedConfigValueWithinLimit(value: string): boolean {
    return new TextEncoder().encode(value).length <= MAX_SHARED_CONFIG_VALUE_BYTES;
}

/** True for a plain JSON object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRevision(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseItems(value: unknown): Record<string, string> {
    if (!isRecord(value)) throw new Error('invalid shared config items');
    const items: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) {
        if (!isValidSharedConfigKey(key) || typeof item !== 'string') throw new Error('invalid shared config item');
        items[key] = item;
    }
    return items;
}

export function parseSharedConfigDocument(value: unknown): SharedConfigDocument {
    if (!isRecord(value) || value.ok !== true || !isRevision(value.revision)) {
        throw new Error('invalid shared config document');
    }
    return { revision: value.revision, items: parseItems(value.items) };
}

export function parseSharedConfigRevision(value: unknown): number {
    if (!isRecord(value) || value.ok !== true || !isRevision(value.revision)) {
        throw new Error('invalid shared config revision');
    }
    return value.revision;
}

export function parseSharedConfigWriteResult(value: unknown): SharedConfigWriteResult {
    return { revision: parseSharedConfigRevision(value) };
}

/** Parses the localStorage cache copy; any malformed copy is treated as absent. */
export function parseSharedConfigCache(raw: string | null): SharedConfigDocument | null {
    if (raw === null) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed) || parsed.version !== SHARED_CONFIG_CACHE_VERSION || !isRevision(parsed.revision)) {
            return null;
        }
        return { revision: parsed.revision, items: parseItems(parsed.items) };
    } catch {
        return null;
    }
}
