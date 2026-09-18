import { create } from 'zustand';

import type { AuthSession, Permission } from '../domain';

export const AUTH_SESSION_STORAGE_KEY = 'hmi-auth-session';

export const UNAUTHENTICATED_SESSION: AuthSession = {
    user: null,
    isAuthenticated: false,
    loginTimestamp: null,
};

export interface AuthStore {
    session: AuthSession;
    isHydrated: boolean;
    isAuthenticating: boolean;
    error: string | null;
    hasPermission: (permission: Permission) => boolean;
}

export const useAuthStore = create<AuthStore>()((_, get) => ({
    session: UNAUTHENTICATED_SESSION,
    isHydrated: false,
    isAuthenticating: false,
    error: null,
    hasPermission: (permission) =>
        get().session.user?.role.permissions.includes(permission) ?? false,
}));
