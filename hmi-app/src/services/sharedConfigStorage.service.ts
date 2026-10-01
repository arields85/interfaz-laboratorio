import {
    MAX_SHARED_CONFIG_BATCH_OPERATIONS,
    MAX_SHARED_CONFIG_REQUEST_BYTES,
    SHARED_CONFIG_PERMANENT_ERROR_CODES,
    isSharedConfigValueWithinLimit,
    isValidSharedConfigKey,
    parseSharedConfigCache,
    parseSharedConfigDocument,
    parseSharedConfigRevision,
    SHARED_CONFIG_CACHE_VERSION,
    type SharedConfigBatch,
    type SharedConfigChange,
    type SharedConfigDocument,
    type SharedConfigSaveError,
    type SharedConfigSource,
    type SharedConfigStatus,
} from '../domain/sharedConfig.types';
import { AdminAuthError, adminAuthClient, type AdminAuthClient } from './adminAuth.service';

// =============================================================================
// sharedConfigStorage
// Synchronous getItem/setItem/removeItem over an in-memory copy of the shared HMI
// configuration document that lives on the Prisma runtime. Reads never wait; writes
// update memory at once and reach the server in debounced admin batches (session +
// CSRF). A revision poll replaces memory when another browser changed the document.
// localStorage keeps only a cache copy of the last server document, used when the
// server cannot be reached at boot. This is the HMI's own configuration, never a
// command toward the plant.
// =============================================================================

export const SHARED_CONFIG_CACHE_KEY = 'hmi:shared-config-cache';
export const SHARED_CONFIG_POLL_INTERVAL_MS = 10_000;
const SHARED_CONFIG_DEBOUNCE_MS = 300;
const SHARED_CONFIG_LOAD_TIMEOUT_MS = 5_000;
const DOCUMENT_ROUTE = '/api/prisma/hmi-config';
const REVISION_ROUTE = '/api/prisma/hmi-config/revision';

export interface SharedConfigCachePort {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export interface SharedConfigStorageOptions {
    fetcher?: typeof fetch;
    adminClient?: Pick<AdminAuthClient, 'writeSharedConfig'>;
    /** Cache copy store; `null` disables the cache. Defaults to localStorage. */
    cache?: SharedConfigCachePort | null;
    pollIntervalMs?: number;
    debounceMs?: number;
    loadTimeoutMs?: number;
}

type ChangeListener = (change: SharedConfigChange) => void;

function createBrowserCache(): SharedConfigCachePort {
    return {
        getItem(key) {
            try { return localStorage.getItem(key); } catch { return null; }
        },
        setItem(key, value) {
            try { localStorage.setItem(key, value); } catch { /* the cache is best effort */ }
        },
    };
}

function toSaveError(error: unknown): SharedConfigSaveError {
    if (error instanceof AdminAuthError) return { code: error.code, status: error.status };
    return { code: 'SHARED_CONFIG_SAVE_FAILED', status: null };
}

const encoder = new TextEncoder();
// `{"set":{},"delete":[]}`
const EMPTY_WIRE_BYTES = 23;

function jsonBytes(text: string): number {
    return encoder.encode(JSON.stringify(text)).length;
}

function toWire(chunk: ReadonlyMap<string, string | null>): SharedConfigBatch {
    const wire: SharedConfigBatch = { set: {}, delete: [] };
    for (const [key, value] of chunk) {
        if (value === null) wire.delete.push(key);
        else wire.set[key] = value;
    }
    return wire;
}

/** Splits staged edits so every request respects the server's operation and size bounds. */
function splitIntoChunks(batch: ReadonlyMap<string, string | null>): Array<Map<string, string | null>> {
    const chunks: Array<Map<string, string | null>> = [];
    let current = new Map<string, string | null>();
    let bytes = EMPTY_WIRE_BYTES;
    for (const [key, value] of batch) {
        // key + colon/comma, plus the value for a set.
        const entryBytes = jsonBytes(key) + 2 + (value === null ? 0 : jsonBytes(value));
        const full = current.size >= MAX_SHARED_CONFIG_BATCH_OPERATIONS
            || (current.size > 0 && bytes + entryBytes > MAX_SHARED_CONFIG_REQUEST_BYTES);
        if (full) {
            chunks.push(current);
            current = new Map();
            bytes = EMPTY_WIRE_BYTES;
        }
        current.set(key, value);
        bytes += entryBytes;
    }
    if (current.size > 0) chunks.push(current);
    return chunks;
}

export class SharedConfigStorage {
    private readonly fetcher: typeof fetch;
    private readonly adminClient: Pick<AdminAuthClient, 'writeSharedConfig'>;
    private readonly cache: SharedConfigCachePort | null;
    private readonly pollIntervalMs: number;
    private readonly debounceMs: number;
    private readonly loadTimeoutMs: number;

    private serverItems = new Map<string, string>();
    // Local edits not yet acknowledged: value, or null for a deletion.
    private pending = new Map<string, string | null>();
    private inFlight: Map<string, string | null> | null = null;
    private revision: number | null = null;
    private source: SharedConfigSource | null = null;
    private saveError: SharedConfigSaveError | null = null;
    private loadPromise: Promise<void> | null = null;
    private flushPromise: Promise<void> | null = null;
    private refreshPromise: Promise<void> | null = null;
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private pollTimer: ReturnType<typeof setTimeout> | null = null;
    private polling = false;
    private status: SharedConfigStatus;
    private readonly changeListeners = new Set<ChangeListener>();
    private readonly statusListeners = new Set<() => void>();

    constructor(options: SharedConfigStorageOptions = {}) {
        // Native fetch must keep the global receiver; injected fetchers are untouched.
        this.fetcher = options.fetcher ?? fetch.bind(globalThis);
        this.adminClient = options.adminClient ?? adminAuthClient;
        this.cache = options.cache === undefined ? createBrowserCache() : options.cache;
        this.pollIntervalMs = options.pollIntervalMs ?? SHARED_CONFIG_POLL_INTERVAL_MS;
        this.debounceMs = options.debounceMs ?? SHARED_CONFIG_DEBOUNCE_MS;
        this.loadTimeoutMs = options.loadTimeoutMs ?? SHARED_CONFIG_LOAD_TIMEOUT_MS;
        this.status = this.buildStatus();
    }

    /** Boot load: server document, else the cache copy, else an empty document. Never rejects. */
    load(): Promise<void> {
        this.loadPromise ??= this.performLoad();
        return this.loadPromise;
    }

    getItem(key: string): string | null {
        return this.effectiveValue(key);
    }

    setItem(key: string, value: string): void {
        if (!isValidSharedConfigKey(key)) {
            this.setSaveError({ code: 'SHARED_CONFIG_INVALID_KEY', status: null });
            return;
        }
        if (!isSharedConfigValueWithinLimit(value)) {
            this.setSaveError({ code: 'SHARED_CONFIG_VALUE_TOO_LARGE', status: null });
            return;
        }
        this.stage(key, value);
    }

    removeItem(key: string): void {
        if (this.effectiveValue(key) === null) return;
        this.stage(key, null);
    }

    getStatus(): SharedConfigStatus {
        return this.status;
    }

    /** Notified when another browser's change replaced part of the document. */
    subscribe(listener: ChangeListener): () => void {
        this.changeListeners.add(listener);
        return () => { this.changeListeners.delete(listener); };
    }

    /** Notified when loading, saving or the save-error state changes. */
    subscribeStatus(listener: () => void): () => void {
        this.statusListeners.add(listener);
        return () => { this.statusListeners.delete(listener); };
    }

    /** Resends every unsaved edit now; with nothing to resend it clears a stale error. */
    async retrySave(): Promise<void> {
        this.clearFlushTimer();
        if (this.pending.size === 0 && this.inFlight === null) {
            if (this.saveError !== null) this.setSaveError(null);
            return;
        }
        await this.flushNow();
    }

    startPolling(): void {
        if (this.polling) return;
        this.polling = true;
        this.schedulePoll();
    }

    stopPolling(): void {
        this.polling = false;
        if (this.pollTimer !== null) clearTimeout(this.pollTimer);
        this.pollTimer = null;
    }

    private async performLoad(): Promise<void> {
        try {
            const document = parseSharedConfigDocument(await this.fetchJson(DOCUMENT_ROUTE, this.loadTimeoutMs));
            this.adoptDocument(document);
        } catch {
            const cached = this.readCache();
            this.serverItems = new Map(Object.entries(cached?.items ?? {}));
            this.revision = cached?.revision ?? null;
            this.source = cached ? 'cache' : 'empty';
        }
        this.updateStatus();
    }

    private async fetchJson(path: string, timeoutMs: number): Promise<unknown> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await this.fetcher(path, {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { Accept: 'application/json' },
                signal: controller.signal,
            });
            if (!response.ok) throw new Error(`shared config request failed (${response.status})`);
            return await response.json();
        } finally {
            clearTimeout(timer);
        }
    }

    private readCache(): SharedConfigDocument | null {
        return this.cache ? parseSharedConfigCache(this.cache.getItem(SHARED_CONFIG_CACHE_KEY)) : null;
    }

    private persistCache(): void {
        if (!this.cache || this.revision === null) return;
        this.cache.setItem(SHARED_CONFIG_CACHE_KEY, JSON.stringify({
            version: SHARED_CONFIG_CACHE_VERSION,
            revision: this.revision,
            items: Object.fromEntries(this.serverItems),
        }));
    }

    private adoptDocument(document: SharedConfigDocument): void {
        this.serverItems = new Map(Object.entries(document.items));
        this.revision = document.revision;
        this.source = 'server';
        this.persistCache();
    }

    private effectiveValue(key: string): string | null {
        if (this.pending.has(key)) return this.pending.get(key) ?? null;
        if (this.inFlight?.has(key)) return this.inFlight.get(key) ?? null;
        return this.serverItems.get(key) ?? null;
    }

    private isOverlaid(key: string): boolean {
        return this.pending.has(key) || (this.inFlight?.has(key) ?? false);
    }

    private stage(key: string, value: string | null): void {
        if (this.effectiveValue(key) === value) return;
        this.pending.set(key, value);
        this.updateStatus();
        this.scheduleFlush();
    }

    private clearFlushTimer(): void {
        if (this.flushTimer !== null) clearTimeout(this.flushTimer);
        this.flushTimer = null;
    }

    private flushNow(): Promise<void> {
        if (this.flushPromise) return this.flushPromise;
        if (this.pending.size === 0) return Promise.resolve();
        this.flushPromise = this.performFlush().finally(() => { this.flushPromise = null; });
        return this.flushPromise;
    }

    private async performFlush(): Promise<void> {
        const batch = this.pending;
        this.pending = new Map();
        this.inFlight = batch;
        this.updateStatus();
        const chunks = splitIntoChunks(batch);
        let failure: SharedConfigSaveError | null = null;
        let rejected: SharedConfigSaveError | null = null;
        const droppedKeys: string[] = [];
        for (const [index, chunk] of chunks.entries()) {
            try {
                const result = await this.adminClient.writeSharedConfig(toWire(chunk));
                this.acknowledge(chunk, result.revision);
            } catch (error) {
                const saveError = toSaveError(error);
                if (SHARED_CONFIG_PERMANENT_ERROR_CODES.has(saveError.code)) {
                    // Resending cannot fix it: drop the chunk so it does not poison later saves.
                    rejected = saveError;
                    for (const key of chunk.keys()) {
                        this.inFlight?.delete(key);
                        droppedKeys.push(key);
                    }
                    continue;
                }
                // Transient (network, 5xx, session): keep this and every unsent chunk for a retry.
                failure = saveError;
                for (const rest of chunks.slice(index)) {
                    for (const [key, value] of rest) {
                        if (!this.pending.has(key)) this.pending.set(key, value);
                    }
                }
                break;
            }
        }
        this.inFlight = null;
        if (failure !== null) this.saveError = failure;
        else if (rejected !== null) this.saveError = rejected;
        else if (!this.hasPermanentError()) this.saveError = null;
        this.updateStatus();
        const reverted = droppedKeys.filter((key) => !this.isOverlaid(key));
        if (reverted.length > 0) this.notifyChange({ changedKeys: reverted });
        if (failure === null && this.pending.size > 0) this.scheduleFlush();
    }

    private hasPermanentError(): boolean {
        return this.saveError !== null && SHARED_CONFIG_PERMANENT_ERROR_CODES.has(this.saveError.code);
    }

    private acknowledge(chunk: ReadonlyMap<string, string | null>, revision: number): void {
        const expected = this.revision === null ? null : this.revision + 1;
        for (const [key, value] of chunk) {
            if (value === null) this.serverItems.delete(key);
            else this.serverItems.set(key, value);
            this.inFlight?.delete(key);
        }
        this.revision = revision;
        // Own echo: the next revision is ours and needs no reload. Anything else means
        // another writer landed in between (or the document was never loaded).
        const isOwnEcho = expected === revision && this.source === 'server';
        if (isOwnEcho) this.persistCache();
        else void this.refresh();
    }

    private scheduleFlush(): void {
        this.clearFlushTimer();
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            void this.flushNow();
        }, this.debounceMs);
    }

    private schedulePoll(): void {
        this.pollTimer = setTimeout(() => {
            this.pollTimer = null;
            void this.pollOnce().finally(() => {
                if (this.polling) this.schedulePoll();
            });
        }, this.pollIntervalMs);
    }

    private async pollOnce(): Promise<void> {
        if (this.inFlight !== null) return;
        try {
            const revision = parseSharedConfigRevision(await this.fetchJson(REVISION_ROUTE, this.loadTimeoutMs));
            if (revision !== this.revision || this.source !== 'server') await this.refresh();
        } catch {
            // Unreachable or malformed: keep serving the current document and try again.
        }
    }

    private refresh(): Promise<void> {
        this.refreshPromise ??= this.performRefresh().finally(() => { this.refreshPromise = null; });
        return this.refreshPromise;
    }

    private async performRefresh(): Promise<void> {
        let document: SharedConfigDocument;
        try {
            document = parseSharedConfigDocument(await this.fetchJson(DOCUMENT_ROUTE, this.loadTimeoutMs));
        } catch {
            return;
        }
        // A write acknowledged while this request was in flight already moved us past it.
        if (this.source === 'server' && this.revision !== null && document.revision < this.revision) return;
        const previous = this.serverItems;
        this.adoptDocument(document);
        const changedKeys = [...new Set([...previous.keys(), ...this.serverItems.keys()])]
            .filter((key) => previous.get(key) !== this.serverItems.get(key) && !this.isOverlaid(key));
        this.updateStatus();
        if (changedKeys.length > 0) this.notifyChange({ changedKeys });
    }

    private setSaveError(error: SharedConfigSaveError | null): void {
        this.saveError = error;
        this.updateStatus();
    }

    private buildStatus(): SharedConfigStatus {
        return {
            loaded: this.source !== null,
            source: this.source,
            revision: this.revision,
            saving: this.inFlight !== null,
            unsavedKeyCount: new Set([...this.pending.keys(), ...(this.inFlight?.keys() ?? [])]).size,
            saveError: this.saveError,
        };
    }

    private updateStatus(): void {
        const next = this.buildStatus();
        const previous = this.status;
        if (
            previous.loaded === next.loaded && previous.source === next.source
            && previous.revision === next.revision && previous.saving === next.saving
            && previous.unsavedKeyCount === next.unsavedKeyCount && previous.saveError === next.saveError
        ) return;
        this.status = next;
        for (const listener of [...this.statusListeners]) {
            try { listener(); } catch { /* one subscriber must not block the others or the save flow */ }
        }
    }

    private notifyChange(change: SharedConfigChange): void {
        for (const listener of [...this.changeListeners]) {
            try { listener(change); } catch { /* one subscriber must not block the others */ }
        }
    }
}

export function createSharedConfigStorage(options: SharedConfigStorageOptions = {}): SharedConfigStorage {
    return new SharedConfigStorage(options);
}

export const sharedConfigStorage = createSharedConfigStorage();
