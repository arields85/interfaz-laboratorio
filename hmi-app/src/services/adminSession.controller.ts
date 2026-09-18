import type { AdministratorIdentity, AuthResult, AuthSession, Permission } from '../domain';
import { UNAUTHENTICATED_SESSION, useAuthStore, type AuthStore } from '../store/auth.store';
import { AdminAuthError, adminAuthClient } from './adminAuth.service';
import {
    ADMIN_EXIT_INTENT_KEY,
    ADMIN_REVOCATION_EVENT_KEY,
    SafeAdminStorage,
    createBrowserAdminStorage,
} from './adminAuth.storage';

export { ADMIN_EXIT_INTENT_KEY, ADMIN_REVOCATION_EVENT_KEY } from './adminAuth.storage';

const UNCONFIRMED_LOGOUT_MESSAGE = 'No se pudo confirmar el cierre remoto de la sesión.';

export interface AdminAuthGateway {
    clearPrivateSession(): void;
    login(username: string, password: string, signal?: AbortSignal): Promise<AdministratorIdentity>;
    session(signal?: AbortSignal): Promise<AdministratorIdentity>;
    logout(signal?: AbortSignal): Promise<void>;
}

export interface AuthStatePort {
    get(): AuthStore;
    set(state: Partial<AuthStore>): void;
}

export function createZustandAuthStatePort(): AuthStatePort {
    return {
        get: () => useAuthStore.getState(),
        set: (state) => useAuthStore.setState(state),
    };
}

export function createMemoryAuthStatePort(): AuthStatePort {
    let state: AuthStore = {
        session: UNAUTHENTICATED_SESSION,
        isHydrated: false,
        isAuthenticating: false,
        error: null,
        hasPermission: (permission: Permission) =>
            state.session.user?.role.permissions.includes(permission) ?? false,
    };
    return {
        get: () => state,
        set: (next) => { state = { ...state, ...next }; },
    };
}

function toSession(identity: AdministratorIdentity): AuthSession {
    return {
        user: {
            id: `administrator:${identity.username}`,
            username: identity.username,
            displayName: identity.username,
            role: { id: 'role-admin', name: 'Admin', permissions: ['viewer:access', 'admin:access'] },
        },
        isAuthenticated: true,
        loginTimestamp: new Date().toISOString(),
        absoluteExpiresAt: identity.absoluteExpiresAt,
    };
}

function errorMessage(error: unknown): string {
    if (error instanceof AdminAuthError) {
        return {
            AUTH_NOT_CONFIGURED: 'El acceso administrador requiere aprovisionamiento local.',
            INVALID_CREDENTIALS: 'Credenciales inválidas.',
            LOGIN_RATE_LIMITED: 'Demasiados intentos. Intentá nuevamente más tarde.',
            AUTH_TRANSPORT_UNAVAILABLE: 'No se pudo confirmar la sesión con el servicio local.',
            AUTH_STORAGE_UNAVAILABLE: 'El servicio de autenticación no está disponible.',
        }[error.code] ?? 'No se pudo validar la sesión de administrador.';
    }
    return 'No se pudo validar la sesión de administrador.';
}

function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

export class AdminSessionController {
    private readonly client: AdminAuthGateway;
    private readonly storage: SafeAdminStorage;
    private readonly eventTarget: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
    private readonly now: () => number;
    private readonly state: AuthStatePort;
    private epoch = 0;
    private activeRequest: AbortController | null = null;
    private activeAuthentication: Promise<void> | null = null;
    private bootstrapPromise: Promise<void> | null = null;
    private logoutPromise: Promise<void> = Promise.resolve();
    private pendingExitMutation: Promise<void> | null = null;
    private exitPromise: Promise<void> | null = null;
    private expiryTimer: ReturnType<typeof setTimeout> | null = null;
    private started = false;

    constructor(
        client: AdminAuthGateway,
        storage: SafeAdminStorage | Storage | null = createBrowserAdminStorage(),
        eventTarget: Pick<Window, 'addEventListener' | 'removeEventListener'> | null =
            typeof window === 'undefined' ? null : window,
        now: () => number = Date.now,
        state: AuthStatePort = createZustandAuthStatePort(),
    ) {
        this.client = client;
        this.storage = storage instanceof SafeAdminStorage ? storage : new SafeAdminStorage(storage);
        this.eventTarget = eventTarget;
        this.now = now;
        this.state = state;
    }

    start(): void {
        if (this.started) return;
        this.started = true;
        this.storage.cleanupLegacyAuthority();
        this.eventTarget?.addEventListener('storage', this.handleStorage as EventListener);
        this.eventTarget?.addEventListener('focus', this.handleFocus as EventListener);
        void this.bootstrap().finally(() => {
            if (this.started && !this.state.get().isHydrated) void this.bootstrap();
        });
    }

    stop(): void {
        if (!this.started) return;
        this.started = false;
        this.eventTarget?.removeEventListener('storage', this.handleStorage as EventListener);
        this.eventTarget?.removeEventListener('focus', this.handleFocus as EventListener);
        this.cancelRequest();
        this.clearExpiryTimer();
    }

    bootstrap(): Promise<void> {
        if (this.bootstrapPromise) return this.bootstrapPromise;
        const task = this.bootstrapInternal().finally(() => {
            if (this.bootstrapPromise === task) this.bootstrapPromise = null;
        });
        this.bootstrapPromise = task;
        return task;
    }

    async login(username: string, password: string): Promise<AuthResult> {
        const invocationEpoch = this.epoch;
        await this.logoutPromise;
        await this.pendingExitMutation;
        if (invocationEpoch !== this.epoch) {
            return { ok: false, error: 'La solicitud fue cancelada.' };
        }
        const { epoch, signal } = this.beginRequest();
        this.client.clearPrivateSession();
        this.state.set({ isAuthenticating: true, error: null });
        const request = this.client.login(username, password, signal);
        const settlement = request.then(() => undefined, () => undefined);
        this.activeAuthentication = settlement;
        try {
            const identity = await request;
            if (!this.isCurrent(epoch)) return { ok: false, error: 'La solicitud fue cancelada.' };
            this.storage.clearForFreshLogin();
            this.applyIdentity(identity);
            return { ok: true, user: this.state.get().session.user! };
        } catch (error) {
            if (!this.isCurrent(epoch) || isAbort(error)) return { ok: false, error: 'La solicitud fue cancelada.' };
            const message = errorMessage(error);
            this.suspend(message, true);
            return { ok: false, error: message };
        } finally {
            if (this.activeAuthentication === settlement) this.activeAuthentication = null;
        }
    }

    refresh(): Promise<void> {
        if (this.state.get().isAuthenticating || !this.state.get().session.isAuthenticated || this.storage.hasExitIntent()) {
            return Promise.resolve();
        }
        return this.validateSession();
    }

    async handleProtectedRequestError(error: unknown): Promise<void> {
        if (!(error instanceof AdminAuthError)) return;
        if (error.status === 401) {
            this.cancelRequest();
            this.client.clearPrivateSession();
            this.suspend(null, true);
            return;
        }
        if (error.status === 403) await this.validateSession();
    }

    exit(): Promise<void> {
        if (this.exitPromise) return this.exitPromise;
        const pendingAuthentication = this.activeAuthentication;
        const immediateLogout = pendingAuthentication ? null : this.client.logout();
        this.cancelRequest();
        this.suspend(null, true);
        this.storage.markExitIntent();
        this.storage.notifyRevocation();
        this.logoutPromise = this.logoutPromise
            .then(() => this.revoke(immediateLogout, pendingAuthentication))
            .catch(() => undefined);
        const task = this.logoutPromise.finally(() => {
            if (this.exitPromise === task) this.exitPromise = null;
        });
        this.exitPromise = task;
        return task;
    }

    private async bootstrapInternal(): Promise<void> {
        if (this.storage.hasExitIntent()) {
            if (this.storage.requiresRemoteRevocation()) {
                await this.finishPendingExit();
            } else {
                this.suspend(null, true);
            }
            this.state.set({ isHydrated: true });
            return;
        }
        await this.validateSession();
    }

    private async validateSession(): Promise<void> {
        const { epoch, signal } = this.beginRequest();
        try {
            const identity = await this.client.session(signal);
            if (this.isCurrent(epoch) && !this.storage.hasExitIntent()) this.applyIdentity(identity);
        } catch (error) {
            if (!this.isCurrent(epoch) || isAbort(error)) return;
            this.suspend(error instanceof AdminAuthError && error.status === 401 ? null : errorMessage(error), true);
        } finally {
            if (this.isCurrent(epoch)) this.state.set({ isHydrated: true, isAuthenticating: false });
        }
    }

    private async finishPendingExit(): Promise<void> {
        const { epoch, signal } = this.beginRequest();
        try {
            await this.client.session(signal);
            if (!this.isCurrent(epoch)) return;
        } catch (error) {
            if (!this.isCurrent(epoch) || isAbort(error)) return;
            this.state.set({ error: UNCONFIRMED_LOGOUT_MESSAGE });
            this.suspend(this.state.get().error, true);
            return;
        }

        const task = this.completePendingExitLogout(epoch, signal);
        this.pendingExitMutation = task;
        try {
            await task;
        } finally {
            if (this.pendingExitMutation === task) this.pendingExitMutation = null;
        }
    }

    private async completePendingExitLogout(epoch: number, signal: AbortSignal): Promise<void> {
        try {
            await this.client.logout(signal);
            if (this.isCurrent(epoch)) this.storage.confirmRemoteRevocation();
        } catch {
            if (this.isCurrent(epoch)) this.state.set({ error: UNCONFIRMED_LOGOUT_MESSAGE });
        } finally {
            if (this.isCurrent(epoch)) this.suspend(this.state.get().error, true);
        }
    }

    private async revoke(
        immediateLogout: Promise<void> | null,
        pendingAuthentication: Promise<void> | null,
    ): Promise<void> {
        try {
            if (pendingAuthentication) {
                await pendingAuthentication;
                await this.client.session();
                await this.client.logout();
            } else {
                await immediateLogout;
            }
            this.storage.confirmRemoteRevocation();
        } catch (error) {
            if (error instanceof AdminAuthError && error.status === 403) {
                await this.reconcileCsrfOnce();
            } else {
                this.state.set({ error: UNCONFIRMED_LOGOUT_MESSAGE });
            }
        }
    }

    private async reconcileCsrfOnce(): Promise<void> {
        try {
            await this.client.session();
            await this.client.logout();
            this.storage.confirmRemoteRevocation();
        } catch {
            this.state.set({ error: UNCONFIRMED_LOGOUT_MESSAGE });
        }
    }

    private applyIdentity(identity: AdministratorIdentity): void {
        if (identity.absoluteExpiresAt * 1000 <= this.now()) {
            this.suspend('La sesión de administrador expiró.', true);
            return;
        }
        this.state.set({ session: toSession(identity), isHydrated: true, isAuthenticating: false, error: null });
        this.armExpiry(identity.absoluteExpiresAt);
    }

    private armExpiry(unixSeconds: number): void {
        this.clearExpiryTimer();
        const schedule = () => {
            const remaining = unixSeconds * 1000 - this.now();
            if (remaining <= 0) {
                this.cancelRequest();
                this.suspend('La sesión de administrador expiró.', true);
                return;
            }
            this.expiryTimer = setTimeout(schedule, Math.min(remaining, 2_147_000_000));
        };
        schedule();
    }

    private suspend(error: string | null, hydrated: boolean): void {
        this.client.clearPrivateSession();
        this.clearExpiryTimer();
        this.state.set({ session: UNAUTHENTICATED_SESSION, isHydrated: hydrated, isAuthenticating: false, error });
    }

    private beginRequest(): { epoch: number; signal: AbortSignal } {
        this.cancelRequest();
        const controller = new AbortController();
        this.activeRequest = controller;
        return { epoch: this.epoch, signal: controller.signal };
    }

    private cancelRequest(): void {
        this.epoch += 1;
        this.activeRequest?.abort();
        this.activeRequest = null;
    }

    private isCurrent(epoch: number): boolean {
        return epoch === this.epoch;
    }

    private clearExpiryTimer(): void {
        if (this.expiryTimer) clearTimeout(this.expiryTimer);
        this.expiryTimer = null;
    }

    private handleStorage = (event: Event): void => {
        const storageEvent = event as StorageEvent;
        const isRevocationNotice = storageEvent.key === ADMIN_REVOCATION_EVENT_KEY && storageEvent.newValue !== null;
        const isExitIntentSet = storageEvent.key === ADMIN_EXIT_INTENT_KEY && storageEvent.newValue !== null;
        if (!isRevocationNotice && !isExitIntentSet) return;
        this.cancelRequest();
        this.storage.observeExitIntent(storageEvent.newValue ?? '1');
        this.suspend(null, true);
    };

    private handleFocus = (): void => { void this.refresh(); };
}

export const adminSessionController = new AdminSessionController(adminAuthClient);
