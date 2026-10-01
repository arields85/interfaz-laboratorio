import type { SharedConfigChange, SharedConfigStatus } from '../domain/sharedConfig.types';

// Test double for the `sharedConfigStorage` singleton: it keeps the same synchronous
// surface but stores in jsdom localStorage, so suites that seed or inspect storage
// directly keep working without a runtime server. Installed globally by setup.ts.
// `emitChange` simulates another browser's change reaching this one.
const IDLE_STATUS: SharedConfigStatus = {
    loaded: true,
    source: 'empty',
    revision: null,
    saving: false,
    unsavedKeyCount: 0,
    saveError: null,
};

export function createLocalStorageSharedConfig() {
    const changeListeners = new Set<(change: SharedConfigChange) => void>();
    return {
        load: async (): Promise<void> => undefined,
        getItem: (key: string): string | null => localStorage.getItem(key),
        setItem: (key: string, value: string): void => { localStorage.setItem(key, value); },
        removeItem: (key: string): void => { localStorage.removeItem(key); },
        getStatus: (): SharedConfigStatus => IDLE_STATUS,
        subscribe: (listener: (change: SharedConfigChange) => void): (() => void) => {
            changeListeners.add(listener);
            return () => { changeListeners.delete(listener); };
        },
        subscribeStatus: (): (() => void) => () => undefined,
        retrySave: async (): Promise<void> => undefined,
        startPolling: (): void => undefined,
        stopPolling: (): void => undefined,
        emitChange: (changedKeys: readonly string[]): void => {
            for (const listener of [...changeListeners]) listener({ changedKeys });
        },
    };
}

export const localStorageSharedConfig = createLocalStorageSharedConfig();
