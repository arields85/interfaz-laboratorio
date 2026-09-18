import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '../store/auth.store';
import { AdminAuthError } from './adminAuth.service';
import {
    ADMIN_EXIT_INTENT_KEY,
    ADMIN_REVOCATION_EVENT_KEY,
    AdminSessionController,
    createMemoryAuthStatePort,
    type AdminAuthGateway,
} from './adminSession.controller';
import { SafeAdminStorage } from './adminAuth.storage';

const IDENTITY = { username: 'admin', absoluteExpiresAt: 2_000_000_000 };

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((accept) => { resolve = accept; });
    return { promise, resolve };
}

function gateway(overrides: Partial<AdminAuthGateway> = {}): AdminAuthGateway {
    return {
        clearPrivateSession: vi.fn(),
        login: vi.fn().mockResolvedValue(IDENTITY),
        session: vi.fn().mockResolvedValue(IDENTITY),
        logout: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

describe('AdminSessionController', () => {
    beforeEach(() => {
        localStorage.clear();
        useAuthStore.setState({
            session: { user: null, isAuthenticated: false, loginTimestamp: null },
            isHydrated: false,
            isAuthenticating: false,
            error: null,
        });
    });

    it('bootstraps authority only from a validated backend session', async () => {
        const client = gateway();
        await new AdminSessionController(client, localStorage, window, () => 1_000).bootstrap();

        expect(useAuthStore.getState().session.user?.role.permissions).toEqual(['viewer:access', 'admin:access']);
        expect(useAuthStore.getState().session.user?.username).toBe('admin');
        expect(useAuthStore.getState().isHydrated).toBe(true);
    });

    it('never lets a stale login restore authority after exit intent', async () => {
        const pending = deferred<typeof IDENTITY>();
        const client = gateway({ login: vi.fn(() => pending.promise) });
        const controller = new AdminSessionController(client, localStorage, window, () => 1_000);

        const login = controller.login('admin', 'password');
        const exiting = controller.exit();
        pending.resolve(IDENTITY);
        await Promise.all([login, exiting]);

        expect(useAuthStore.getState().session.isAuthenticated).toBe(false);
        expect(client.logout).toHaveBeenCalledTimes(1);
    });

    it('probes only to finish pending logout on reload and never grants admin', async () => {
        localStorage.setItem(ADMIN_EXIT_INTENT_KEY, '1');
        const client = gateway();

        await new AdminSessionController(client, localStorage, window, () => 1_000).bootstrap();

        expect(client.session).toHaveBeenCalledTimes(1);
        expect(client.logout).toHaveBeenCalledTimes(1);
        expect(useAuthStore.getState().session.isAuthenticated).toBe(false);
        expect(localStorage.getItem(ADMIN_EXIT_INTENT_KEY)).not.toBeNull();
        expect(useAuthStore.getState().error).toBeNull();
    });

    it('drops authority at absolute expiry without a heartbeat', async () => {
        vi.useFakeTimers();
        const now = 1_000_000;
        vi.setSystemTime(now);
        const client = gateway({ session: vi.fn().mockResolvedValue({ username: 'admin', absoluteExpiresAt: 1_001 }) });
        const controller = new AdminSessionController(client, localStorage, window, Date.now);
        await controller.bootstrap();

        vi.advanceTimersByTime(1_000);

        expect(useAuthStore.getState().session.isAuthenticated).toBe(false);
        expect(client.session).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    it('treats cross-tab data only as revocation and never as an authority payload', async () => {
        const client = gateway();
        const controller = new AdminSessionController(client, localStorage, window, () => 1_000);
        await controller.bootstrap();
        controller.start();

        localStorage.setItem(ADMIN_EXIT_INTENT_KEY, '1');
        window.dispatchEvent(new StorageEvent('storage', {
            key: ADMIN_REVOCATION_EVENT_KEY,
            newValue: JSON.stringify({ role: 'Admin', csrfToken: 'leak' }),
        }));

        expect(useAuthStore.getState().session.isAuthenticated).toBe(false);
        expect(localStorage.getItem(ADMIN_EXIT_INTENT_KEY)).toBe('1');
        controller.stop();
    });

    it('keeps viewer usable when bootstrap transport is unavailable', async () => {
        const client = gateway({
            session: vi.fn().mockRejectedValue(new AdminAuthError('AUTH_TRANSPORT_UNAVAILABLE', null)),
        });

        await new AdminSessionController(client, localStorage, window).bootstrap();

        expect(useAuthStore.getState().isHydrated).toBe(true);
        expect(useAuthStore.getState().session.isAuthenticated).toBe(false);
        expect(useAuthStore.getState().error).toMatch(/servicio local/i);
    });

    it('ignores exit-marker removal events and does not recreate markers or revoke a fresh login', async () => {
        const firstState = createMemoryAuthStatePort();
        const secondState = createMemoryAuthStatePort();
        const first = new AdminSessionController(
            gateway(), new SafeAdminStorage(localStorage), window, () => 1_000, firstState,
        );
        const second = new AdminSessionController(
            gateway(), new SafeAdminStorage(localStorage), window, () => 1_000, secondState,
        );
        const storageWrites = vi.spyOn(Storage.prototype, 'setItem');
        first.start();
        second.start();
        await Promise.all([first.bootstrap(), second.bootstrap()]);

        await first.exit();
        const result = await first.login('admin', 'password');
        const writesBeforeRemoval = storageWrites.mock.calls.length;

        window.dispatchEvent(new StorageEvent('storage', { key: ADMIN_EXIT_INTENT_KEY, oldValue: '1', newValue: null }));

        expect(result.ok).toBe(true);
        expect(localStorage.getItem(ADMIN_EXIT_INTENT_KEY)).toBeNull();
        expect(firstState.get().session.isAuthenticated).toBe(true);
        expect(storageWrites.mock.calls).toHaveLength(writesBeforeRemoval);
        first.stop();
        second.stop();
        storageWrites.mockRestore();
    });

    it('uses unique revocation notifications and never broadcasts authority data', async () => {
        const controller = new AdminSessionController(gateway(), localStorage, window, () => 1_000);
        await controller.bootstrap();
        await controller.exit();
        const firstNotice = localStorage.getItem(ADMIN_REVOCATION_EVENT_KEY);
        await controller.login('admin', 'password');
        await controller.exit();
        const secondNotice = localStorage.getItem(ADMIN_REVOCATION_EVENT_KEY);

        expect(secondNotice).not.toBe(firstNotice);
        expect(secondNotice).not.toMatch(/admin|csrf|role/i);
    });

    it('fails closed for admin but keeps viewer boot usable when storage methods throw', async () => {
        const storage = {
            getItem: vi.fn(() => { throw new Error('storage denied'); }),
            setItem: vi.fn(() => { throw new Error('storage denied'); }),
            removeItem: vi.fn(() => { throw new Error('storage denied'); }),
        };
        const client = gateway({ session: vi.fn().mockRejectedValue(new AdminAuthError('AUTHENTICATION_REQUIRED', 401)) });
        const controller = new AdminSessionController(client, storage, window);

        await expect(controller.bootstrap()).resolves.toBeUndefined();
        await expect(controller.exit()).resolves.toBeUndefined();

        expect(useAuthStore.getState().isHydrated).toBe(true);
        expect(useAuthStore.getState().session.isAuthenticated).toBe(false);
        expect(client.logout).toHaveBeenCalled();
    });

    it('handles a throwing browser storage getter without restoring cookie authority', async () => {
        const client = gateway({ session: vi.fn().mockRejectedValue(new AdminAuthError('AUTHENTICATION_REQUIRED', 401)) });
        const controller = new AdminSessionController(
            client,
            new SafeAdminStorage(() => { throw new Error('storage getter denied'); }),
            window,
        );

        await expect(controller.bootstrap()).resolves.toBeUndefined();

        expect(useAuthStore.getState().session.isAuthenticated).toBe(false);
        expect(useAuthStore.getState().isHydrated).toBe(true);
    });

    it('removes legacy persisted authority through the nonthrowing lifecycle storage boundary', async () => {
        localStorage.setItem('hmi-auth-session', JSON.stringify({ role: 'Admin' }));
        const controller = new AdminSessionController(gateway(), localStorage, window);

        controller.start();
        await controller.bootstrap();

        expect(localStorage.getItem('hmi-auth-session')).toBeNull();
        controller.stop();
    });

    it('suspends stale admin authority and reports safe error after failed focus revalidation', async () => {
        const client = gateway();
        const controller = new AdminSessionController(client, localStorage, window);
        await controller.bootstrap();
        vi.mocked(client.session).mockRejectedValueOnce(new AdminAuthError('AUTH_TRANSPORT_UNAVAILABLE', null));

        await controller.refresh();

        expect(useAuthStore.getState().session.isAuthenticated).toBe(false);
        expect(useAuthStore.getState().error).toMatch(/servicio local/i);
    });

    it('suspends current authority on protected 401 and reconciles protected 403 without replay', async () => {
        const client = gateway();
        const controller = new AdminSessionController(client, localStorage, window, () => 1_000);
        await controller.bootstrap();

        await controller.handleProtectedRequestError(new AdminAuthError('AUTHENTICATION_REQUIRED', 401));
        expect(useAuthStore.getState().session.isAuthenticated).toBe(false);

        await controller.login('admin', 'password');
        const loginCalls = vi.mocked(client.login).mock.calls.length;
        await controller.handleProtectedRequestError(new AdminAuthError('CSRF_VALIDATION_FAILED', 403));

        expect(useAuthStore.getState().session.isAuthenticated).toBe(true);
        expect(client.session).toHaveBeenCalledTimes(2);
        expect(client.login).toHaveBeenCalledTimes(loginCalls);
    });

    it('does not let focus cancel an active login or leave authentication stuck', async () => {
        const pending = deferred<typeof IDENTITY>();
        const client = gateway({ login: vi.fn(() => pending.promise) });
        const controller = new AdminSessionController(client, localStorage, window);
        const login = controller.login('admin', 'password');

        await controller.refresh();
        pending.resolve(IDENTITY);
        await login;

        expect(useAuthStore.getState().session.isAuthenticated).toBe(true);
        expect(useAuthStore.getState().isAuthenticating).toBe(false);
    });

    it.each([
        new AdminAuthError('AUTH_TRANSPORT_UNAVAILABLE', null),
        new AdminAuthError('CSRF_VALIDATION_FAILED', 403),
        new AdminAuthError('AUTH_RESPONSE_INVALID', 200),
    ])('retains pending exit and reports unconfirmed revocation for %s', async (failure) => {
        localStorage.setItem(ADMIN_EXIT_INTENT_KEY, '1');
        const client = gateway({ session: vi.fn().mockRejectedValue(failure) });
        const controller = new AdminSessionController(client, localStorage, window);

        await controller.bootstrap();

        expect(localStorage.getItem(ADMIN_EXIT_INTENT_KEY)).toBe('1');
        expect(useAuthStore.getState().error).toBe('No se pudo confirmar el cierre remoto de la sesión.');
    });
});
