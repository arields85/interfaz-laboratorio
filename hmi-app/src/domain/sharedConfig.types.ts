// Shared HMI configuration: the document every browser reads from the runtime and
// that the administrator writes back in batches. Wire contract and bounds mirror
// services/prisma-runtime/src/prisma_runtime/hmi_config_store.py.

export const SHARED_CONFIG_CACHE_VERSION = 1;
export const MAX_SHARED_CONFIG_KEY_LENGTH = 128;
export const MAX_SHARED_CONFIG_VALUE_BYTES = 1024 * 1024;

const SHARED_CONFIG_KEY_PATTERN = /^[A-Za-z0-9:._-]+$/;

export type SharedConfigSource = 'server' | 'cache' | 'empty';

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

function isRecord(value: unknown): value is Record<string, unknown> {
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
