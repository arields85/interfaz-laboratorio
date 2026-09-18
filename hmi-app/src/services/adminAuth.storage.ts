import { AUTH_SESSION_STORAGE_KEY } from '../store/auth.store';

export const ADMIN_EXIT_INTENT_KEY = 'hmi-admin-exit-pending';
export const ADMIN_REVOCATION_EVENT_KEY = 'hmi-admin-revoked';

const PENDING_REVOCATION_VALUE = '1';
const MANUAL_LOGIN_REQUIRED_VALUE = 'manual-login-required';

type ExitBarrierState = 'none' | 'revocation-pending' | 'manual-login-required';

type StorageSource = Storage | (() => Storage) | null;

let notificationSequence = 0;

function notificationId(): string {
    notificationSequence += 1;
    try {
        return `${crypto.randomUUID()}:${notificationSequence}`;
    } catch {
        return `${Date.now()}:${notificationSequence}:${Math.random().toString(36).slice(2)}`;
    }
}

export class SafeAdminStorage {
    private readonly source: StorageSource;
    private storage: Storage | null | undefined;
    private exitBarrierState: ExitBarrierState | null = null;

    constructor(source: StorageSource) {
        this.source = source;
    }

    cleanupLegacyAuthority(): void {
        try {
            this.resolve()?.removeItem(AUTH_SESSION_STORAGE_KEY);
        } catch {
            // Public viewer startup must not depend on browser storage availability.
        }
    }

    hasExitIntent(): boolean {
        return this.getExitBarrierState() !== 'none';
    }

    requiresRemoteRevocation(): boolean {
        return this.getExitBarrierState() === 'revocation-pending';
    }

    markExitIntent(): void {
        this.exitBarrierState = 'revocation-pending';
        try {
            this.resolve()?.setItem(ADMIN_EXIT_INTENT_KEY, PENDING_REVOCATION_VALUE);
        } catch {
            // The in-memory fence still prevents authority restoration in this document.
        }
    }

    observeExitIntent(value: string): void {
        this.exitBarrierState = value === MANUAL_LOGIN_REQUIRED_VALUE
            ? 'manual-login-required'
            : 'revocation-pending';
    }

    confirmRemoteRevocation(): void {
        this.exitBarrierState = 'manual-login-required';
        try {
            this.resolve()?.setItem(ADMIN_EXIT_INTENT_KEY, MANUAL_LOGIN_REQUIRED_VALUE);
        } catch {
            // This document still requires a fresh login; a new document fails closed if storage is unavailable.
        }
    }

    clearForFreshLogin(): void {
        this.exitBarrierState = 'none';
        try {
            this.resolve()?.removeItem(ADMIN_EXIT_INTENT_KEY);
        } catch {
            // The validated login explicitly supersedes exit intent in this document only.
        }
    }

    notifyRevocation(): void {
        try {
            this.resolve()?.setItem(ADMIN_REVOCATION_EVENT_KEY, notificationId());
        } catch {
            // Cross-tab notification is best effort; local suspension is authoritative.
        }
    }

    private resolve(): Storage | null {
        if (this.storage !== undefined) return this.storage;
        this.storage = typeof this.source === 'function' ? this.source() : this.source;
        return this.storage;
    }

    private getExitBarrierState(): ExitBarrierState {
        if (this.exitBarrierState !== null) return this.exitBarrierState;
        try {
            const value = this.resolve()?.getItem(ADMIN_EXIT_INTENT_KEY);
            this.exitBarrierState = value === null || value === undefined
                ? 'none'
                : value === MANUAL_LOGIN_REQUIRED_VALUE
                    ? 'manual-login-required'
                    : 'revocation-pending';
        } catch {
            this.exitBarrierState = 'revocation-pending';
        }
        return this.exitBarrierState;
    }
}

export function createBrowserAdminStorage(): SafeAdminStorage {
    return new SafeAdminStorage(() => window.localStorage);
}
