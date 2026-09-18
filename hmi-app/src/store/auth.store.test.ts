import { beforeEach, describe, expect, it, vi } from 'vitest';

const AUTH_STORAGE_KEY = 'hmi-auth-session';

async function loadFreshAuthStore() {
    vi.resetModules();
    return import('./auth.store');
}

describe('useAuthStore', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules();
    });

    it('starts pending and unauthenticated without persistent middleware', async () => {
        const { useAuthStore } = await loadFreshAuthStore();

        expect(useAuthStore.getState().session).toEqual({
            user: null,
            isAuthenticated: false,
            loginTimestamp: null,
        });
        expect(useAuthStore.getState().isHydrated).toBe(false);
        expect('persist' in useAuthStore).toBe(false);
    });

    it('never hydrates unsafe legacy authority before lifecycle cleanup', async () => {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ role: 'Admin' }));

        const { useAuthStore } = await loadFreshAuthStore();

        expect(localStorage.getItem(AUTH_STORAGE_KEY)).not.toBeNull();
        expect(useAuthStore.getState().session.isAuthenticated).toBe(false);
    });

    it('derives permissions only from current in-memory verified identity', async () => {
        const { useAuthStore } = await loadFreshAuthStore();
        useAuthStore.setState({
            session: {
                user: {
                    id: 'administrator:admin',
                    username: 'admin',
                    displayName: 'admin',
                    role: { id: 'role-admin', name: 'Admin', permissions: ['viewer:access', 'admin:access'] },
                },
                isAuthenticated: true,
                loginTimestamp: '2026-09-18T00:00:00.000Z',
                absoluteExpiresAt: 2_000_000_000,
            },
        });

        expect(useAuthStore.getState().hasPermission('admin:access')).toBe(true);
        expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    });

    it('never grants authority from storage events', async () => {
        const { useAuthStore } = await loadFreshAuthStore();
        window.dispatchEvent(new StorageEvent('storage', {
            key: AUTH_STORAGE_KEY,
            newValue: JSON.stringify({ role: 'Admin', csrfToken: 'secret' }),
        }));

        expect(useAuthStore.getState().session.isAuthenticated).toBe(false);
    });

    it('does not break public viewer import when legacy storage cleanup throws', async () => {
        vi.stubGlobal('localStorage', {
            removeItem: () => { throw new Error('storage denied'); },
        });

        await expect(loadFreshAuthStore()).resolves.toBeDefined();

        vi.unstubAllGlobals();
    });
});
