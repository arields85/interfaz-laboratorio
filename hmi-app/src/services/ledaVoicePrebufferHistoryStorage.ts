/**
 * Safe `localStorage` wrapper for the Leda voice prebuffer measurement
 * history (odd/tasks/leda-adaptive-voice-buffer.md, Design item 3). The
 * learned window describes this machine and its network, so it lives in the
 * browser, never sent anywhere.
 *
 * Follows the `SafeAdminStorage` pattern (`services/adminAuth.storage.ts`):
 * the storage source is injectable (a real `Storage`, a lazily-resolved
 * factory for `window.localStorage`, or `null`), every access is wrapped in
 * try/catch, and unavailable or corrupted storage never throws -- it is
 * simply treated as an empty history so the estimator falls back to its
 * default.
 */
import {
    isLedaVoicePrebufferMeasurement,
    type LedaVoicePrebufferHistory,
} from '../domain/ledaVoicePrebufferHistory.types';

export const LEDA_VOICE_PREBUFFER_HISTORY_STORAGE_KEY = 'hmi-leda-voice-prebuffer-history';

type StorageSource = Storage | (() => Storage) | null;

export class LedaVoicePrebufferHistoryStorage {
    private readonly source: StorageSource;
    private storage: Storage | null | undefined;

    public constructor(source: StorageSource) {
        this.source = source;
    }

    /**
     * Reads the persisted history. Unparseable JSON or a non-array payload
     * is treated as a fully corrupted read (empty history): there is no
     * partial list to salvage. Within a valid array, individual entries
     * that fail the strict shape guard are dropped rather than discarding
     * the whole history -- a single malformed entry (e.g. from a future
     * schema change or manual tampering) should not throw away otherwise
     * valid, recent measurements sitting next to it.
     */
    public read(): LedaVoicePrebufferHistory {
        try {
            const raw = this.resolve()?.getItem(LEDA_VOICE_PREBUFFER_HISTORY_STORAGE_KEY);
            if (raw === null || raw === undefined) {
                return [];
            }

            const parsed: unknown = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed.filter(isLedaVoicePrebufferMeasurement);
        } catch {
            return [];
        }
    }

    /** Persists the given history. Write failures are swallowed. */
    public write(history: LedaVoicePrebufferHistory): void {
        try {
            this.resolve()?.setItem(LEDA_VOICE_PREBUFFER_HISTORY_STORAGE_KEY, JSON.stringify(history));
        } catch {
            // Best effort; a machine without usable storage keeps using the
            // in-memory default estimate only, which is safe.
        }
    }

    private resolve(): Storage | null {
        if (this.storage !== undefined) return this.storage;
        this.storage = typeof this.source === 'function' ? this.source() : this.source;
        return this.storage;
    }
}

export function createBrowserLedaVoicePrebufferHistoryStorage(): LedaVoicePrebufferHistoryStorage {
    return new LedaVoicePrebufferHistoryStorage(() => window.localStorage);
}
