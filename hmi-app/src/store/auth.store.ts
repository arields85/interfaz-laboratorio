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
    // True when this browser's administrator session was closed because another login took over.
    // Separate from `error`: that one is only visible while the login overlay is open, which a
    // plain viewer (hidden access) rarely has.
    sessionReplaced: boolean;
    hasPermission: (permission: Permission) => boolean;
}

export const useAuthStore = create<AuthStore>()((_, get) => ({
    session: UNAUTHENTICATED_SESSION,
    isHydrated: false,
    isAuthenticating: false,
    error: null,
    sessionReplaced: false,
    hasPermission: (permission) =>
        get().session.user?.role.permissions.includes(permission) ?? false,
}));
