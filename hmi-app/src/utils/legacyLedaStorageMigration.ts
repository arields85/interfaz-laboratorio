// One-time browser migration for the Prisma -> Leda rename: the assistant's localStorage keys
// changed name, so a value saved under the old key is copied to the new one before anything
// reads it. The old key is always removed afterwards; an existing new value is never
// overwritten. Runs at boot, before the shared configuration loads (its local fallback reads
// the new keys). It is the only place that still names the old keys.

export interface LegacyStoragePort {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export const LEGACY_PRISMA_STORAGE_KEY_RENAMES: ReadonlyArray<readonly [oldKey: string, newKey: string]> = [
    ['hmi:prisma-hmi-name', 'hmi:leda-hmi-name'],
    ['hmi:prisma-orb-visual-config', 'hmi:leda-orb-visual-config'],
    ['hmi-prisma-voice-prebuffer-history', 'hmi-leda-voice-prebuffer-history'],
];

function browserStorage(): LegacyStoragePort | null {
    try {
        return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
        return null;
    }
}

/** Returns how many values were copied to a new key. Never throws: storage is best effort. */
export function migrateLegacyLedaStorageKeys(storage: LegacyStoragePort | null = browserStorage()): number {
    if (storage === null) return 0;
    let copied = 0;
    for (const [oldKey, newKey] of LEGACY_PRISMA_STORAGE_KEY_RENAMES) {
        try {
            const oldValue = storage.getItem(oldKey);
            if (oldValue === null) continue;
            if (storage.getItem(newKey) === null) {
                storage.setItem(newKey, oldValue);
                copied += 1;
            }
            storage.removeItem(oldKey);
        } catch {
            // Storage denied or full: leave the old key in place and keep booting.
        }
    }
    return copied;
}
