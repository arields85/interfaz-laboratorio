import type {
    ActivityAnalyticsResponse,
} from '../domain/activityAnalytics.types';
import type {
    ProdTrendActivitySeriesIdentity,
    ProdTrendLastKnownGoodRecord,
} from '../domain/prodTrendDataMode.types';

export const PROD_TREND_LKG_STORAGE_KEY = 'hmi_prod_trend_lkg_v1';
export const PROD_TREND_LKG_MAX_ENTRIES = 4;
export const PROD_TREND_LKG_MAX_ENTRY_BYTES = 1024 * 1024;
export const PROD_TREND_LKG_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
export const PROD_TREND_LKG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

interface Options {
    storage?: StorageLike;
    now?: () => number;
    maxEntries?: number;
    maxEntryBytes?: number;
    maxTotalBytes?: number;
    maxAgeMs?: number;
}

export function createActivitySeriesIdentityKey(identity: ProdTrendActivitySeriesIdentity): string {
    if (identity.range === 'custom') {
        return `${identity.machineId}|custom|${identity.start}|${identity.end}`;
    }

    return `${identity.machineId}|${identity.range}`;
}

export class ProdTrendLastKnownGoodStorageService {
    private readonly storage: StorageLike | null;
    private readonly now: () => number;
    private readonly maxEntries: number;
    private readonly maxEntryBytes: number;
    private readonly maxTotalBytes: number;
    private readonly maxAgeMs: number;

    constructor(options: Options = {}) {
        this.storage = options.storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
        this.now = options.now ?? Date.now;
        this.maxEntries = options.maxEntries ?? PROD_TREND_LKG_MAX_ENTRIES;
        this.maxEntryBytes = options.maxEntryBytes ?? PROD_TREND_LKG_MAX_ENTRY_BYTES;
        this.maxTotalBytes = options.maxTotalBytes ?? PROD_TREND_LKG_MAX_TOTAL_BYTES;
        this.maxAgeMs = options.maxAgeMs ?? PROD_TREND_LKG_MAX_AGE_MS;
    }

    get(identity: ProdTrendActivitySeriesIdentity, nowMs = this.now()): ActivityAnalyticsResponse | null {
        const key = createActivitySeriesIdentityKey(identity);
        return this.read(nowMs).find((entry) => entry.identityKey === key)?.response ?? null;
    }

    save(identity: ProdTrendActivitySeriesIdentity, response: ActivityAnalyticsResponse): boolean {
        const identityKey = createActivitySeriesIdentityKey(identity);
        if (response.machineId !== identity.machineId || response.range !== identity.range) {
            return false;
        }
        if (identity.range === 'custom' && (response.window.start !== identity.start || response.window.end !== identity.end)) {
            return false;
        }

        const capturedAt = this.now();
        const nextEntry: ProdTrendLastKnownGoodRecord = { identityKey, capturedAt, response };
        if (this.entryBytes(nextEntry) > this.maxEntryBytes) {
            return false;
        }

        const records = this.read(capturedAt)
            .filter((entry) => entry.identityKey !== identityKey)
            .concat(nextEntry)
            .sort((left, right) => left.capturedAt - right.capturedAt);
        const bounded = this.bound(records);

        if (this.write(bounded)) {
            return true;
        }

        const retry = bounded.length > 1 ? bounded.slice(1) : bounded;
        return this.write(retry);
    }

    private read(nowMs: number): ProdTrendLastKnownGoodRecord[] {
        if (!this.storage) {
            return [];
        }

        try {
            const raw = this.storage.getItem(PROD_TREND_LKG_STORAGE_KEY);
            const parsed: unknown = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(parsed)) {
                return [];
            }

            const validEntries = parsed.filter((entry): entry is ProdTrendLastKnownGoodRecord => {
                if (!entry || typeof entry !== 'object') return false;
                const candidate = entry as Partial<ProdTrendLastKnownGoodRecord>;
                return typeof candidate.identityKey === 'string'
                    && typeof candidate.capturedAt === 'number'
                    && Number.isFinite(candidate.capturedAt)
                    && nowMs - candidate.capturedAt <= this.maxAgeMs
                    && this.entryBytes(candidate as ProdTrendLastKnownGoodRecord) <= this.maxEntryBytes;
            });

            return this.bound(validEntries);
        } catch {
            return [];
        }
    }

    private bound(records: ProdTrendLastKnownGoodRecord[]): ProdTrendLastKnownGoodRecord[] {
        const bounded = [...records].sort((left, right) => left.capturedAt - right.capturedAt);
        while (bounded.length > this.maxEntries || this.totalBytes(bounded) > this.maxTotalBytes) {
            bounded.shift();
        }
        return bounded;
    }

    private write(records: ProdTrendLastKnownGoodRecord[]): boolean {
        if (!this.storage) return false;
        try {
            this.storage.setItem(PROD_TREND_LKG_STORAGE_KEY, JSON.stringify(records));
            return true;
        } catch {
            return false;
        }
    }

    private totalBytes(records: ProdTrendLastKnownGoodRecord[]): number {
        return records.reduce((total, entry) => total + this.entryBytes(entry), 0);
    }

    private entryBytes(entry: ProdTrendLastKnownGoodRecord): number {
        return new TextEncoder().encode(JSON.stringify(entry)).byteLength;
    }
}

export const prodTrendLastKnownGoodStorage = new ProdTrendLastKnownGoodStorageService();
