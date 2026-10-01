// Hidden access flag: whether this browser shows the users icon and the Prisma control in the
// Topbar. Per browser on purpose (its own localStorage key, never the shared configuration): the
// administrator reveals it where they work, and a plain viewer PC keeps it hidden. Hiding the
// icons is not the security boundary: the admin routes stay protected by the server session.
export const HIDDEN_ACCESS_STORAGE_KEY = 'hmi:hidden-access';

const REVEALED_VALUE = 'on';

const listeners = new Set<() => void>();
// Only used when localStorage is unavailable, so the toggle still works for this page's lifetime.
let memoryRevealed = false;

export function isHiddenAccessRevealed(): boolean {
    try {
        return localStorage.getItem(HIDDEN_ACCESS_STORAGE_KEY) === REVEALED_VALUE;
    } catch {
        return memoryRevealed;
    }
}

function notify(): void {
    for (const listener of [...listeners]) listener();
}

export function setHiddenAccessRevealed(revealed: boolean): void {
    memoryRevealed = revealed;
    try {
        if (revealed) {
            localStorage.setItem(HIDDEN_ACCESS_STORAGE_KEY, REVEALED_VALUE);
        } else {
            localStorage.removeItem(HIDDEN_ACCESS_STORAGE_KEY);
        }
    } catch { /* the flag then lives only for this page */ }
    notify();
}

/** Flips the flag and returns the new state. */
export function toggleHiddenAccess(): boolean {
    const next = !isHiddenAccessRevealed();
    setHiddenAccessRevealed(next);
    return next;
}

/** Notified when the flag changes here or in another tab of this browser. */
export function subscribeHiddenAccess(listener: () => void): () => void {
    listeners.add(listener);
    const handleStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === HIDDEN_ACCESS_STORAGE_KEY) listener();
    };
    window.addEventListener('storage', handleStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', handleStorage);
    };
}
