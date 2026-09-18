export type Permission = 'viewer:access' | 'admin:access' | (string & {});

export interface Role {
    id: string;
    name: string;
    permissions: Permission[];
}

export interface AuthUser {
    id: string;
    username: string;
    displayName: string;
    role: Role;
}

export interface AuthSession {
    user: AuthUser | null;
    isAuthenticated: boolean;
    loginTimestamp: string | null;
    absoluteExpiresAt?: number | null;
}

export type AuthResult =
    | { ok: true; user: AuthUser }
    | { ok: false; error: string };

export interface AdministratorIdentity {
    username: string;
    absoluteExpiresAt: number;
}

export interface AdminAuthStatus {
    configured: boolean;
}
