import {
    parseCredentialMetadata,
    parseCredentialMutation,
    parseTelegramAdministrationStatus,
    parseTelegramPassiveHealth,
    validateCredentialSecret,
    type AdminAuthStatus,
    type AdministratorIdentity,
    type CredentialMetadata,
    type CredentialMutationResult,
    type CredentialProvider,
    type TelegramAdministrationStatus,
    type TelegramPassiveHealth,
} from '../domain';

const AUTH_ROOT = '/api/prisma/admin/auth';
const CSRF_TOKEN_LENGTH = 43;
const PUBLIC_ERROR_CODES = new Set([
    'ADMIN_CREDENTIAL_BLANK',
    'ADMIN_CREDENTIAL_TOO_LARGE',
    'AUTH_CONFIGURATION_INVALID',
    'AUTHENTICATION_REQUIRED',
    'AUTH_NOT_CONFIGURED',
    'AUTH_STORAGE_UNAVAILABLE',
    'AUTH_TRANSPORT_REJECTED',
    'CREDENTIAL_PROVIDER_UNSUPPORTED',
    'CREDENTIAL_REQUEST_TOO_LARGE',
    'CREDENTIAL_STORAGE_UNAVAILABLE',
    'CSRF_VALIDATION_FAILED',
    'INVALID_CREDENTIALS',
    'INVALID_CREDENTIAL_REQUEST',
    'INVALID_LOGIN_REQUEST',
    'INVALID_TELEGRAM_APPLY_REQUEST',
    'JSON_REQUIRED',
    'LOGIN_RATE_LIMITED',
    'PRISMA_LOCAL_TELEGRAM_BOT_TOKEN_MISSING',
    'TELEGRAM_CREDENTIAL_MISSING',
    'TELEGRAM_DISABLED',
    'TELEGRAM_POLL_FAILED',
    'TELEGRAM_PREPARATION_FAILED',
    'TELEGRAM_PROVIDER_UNAVAILABLE',
    'TELEGRAM_APPLY_REQUEST_TOO_LARGE',
    'TELEGRAM_STOP_TIMEOUT',
]);

export class AdminAuthError extends Error {
    readonly code: string;
    readonly status: number | null;
    readonly committed: boolean;

    constructor(code: string, status: number | null, committed = false) {
        super(code);
        this.name = 'AdminAuthError';
        this.code = code;
        this.status = status;
        this.committed = committed;
    }
}

interface SessionEnvelope {
    ok: true;
    administrator: { username: string };
    csrfToken: string;
    absoluteExpiresAt: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCanonicalCsrfToken(value: string): boolean {
    if (value.length !== CSRF_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
    try {
        const base64 = `${value.replace(/-/g, '+').replace(/_/g, '/')}=`;
        const decoded = atob(base64);
        if (decoded.length !== 32) return false;
        return btoa(decoded).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === value;
    } catch {
        return false;
    }
}

function parseSessionEnvelope(value: unknown, now: number): SessionEnvelope {
    if (!isObject(value) || value.ok !== true || !isObject(value.administrator)
        || typeof value.administrator.username !== 'string' || !value.administrator.username
        || typeof value.csrfToken !== 'string' || !isCanonicalCsrfToken(value.csrfToken)
        || typeof value.absoluteExpiresAt !== 'number' || !Number.isFinite(value.absoluteExpiresAt)
        || value.absoluteExpiresAt * 1000 <= now) {
        throw new AdminAuthError('AUTH_RESPONSE_INVALID', null);
    }
    return value as unknown as SessionEnvelope;
}

async function readJson(response: Response): Promise<unknown> {
    if (response.status !== 200 || !response.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
        await response.text().catch(() => undefined);
        throw new AdminAuthError('AUTH_RESPONSE_INVALID', response.status);
    }
    try {
        return await response.json();
    } catch {
        throw new AdminAuthError('AUTH_RESPONSE_INVALID', response.status);
    }
}

async function readErrorCode(response: Response): Promise<string> {
    if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
        await response.text().catch(() => undefined);
        return 'AUTH_REQUEST_FAILED';
    }
    try {
        const payload: unknown = await response.json();
        return isObject(payload) && typeof payload.error === 'string' && PUBLIC_ERROR_CODES.has(payload.error)
            ? payload.error
            : 'AUTH_REQUEST_FAILED';
    } catch {
        return 'AUTH_REQUEST_FAILED';
    }
}

export class AdminAuthClient {
    #csrfToken: string | null = null;
    #generation = 0;
    private readonly fetcher: typeof fetch;
    private readonly now: () => number;
    private readonly protectedRequests = new Set<AbortController>();

    // Native fetch must be bound to the global receiver; a bare method call on this
    // instance throws "Illegal invocation" in browsers. Injected fetchers are untouched.
    constructor(fetcher: typeof fetch = fetch.bind(globalThis), now: () => number = Date.now) {
        this.fetcher = fetcher;
        this.now = now;
    }

    clearPrivateSession(): void {
        this.#generation += 1;
        this.#csrfToken = null;
        for (const controller of this.protectedRequests) controller.abort();
        this.protectedRequests.clear();
    }

    async status(signal?: AbortSignal): Promise<AdminAuthStatus> {
        const response = await this.request(`${AUTH_ROOT}/status`, { method: 'GET', signal });
        const payload = await readJson(response);
        if (!isObject(payload) || typeof payload.configured !== 'boolean') {
            throw new AdminAuthError('AUTH_RESPONSE_INVALID', response.status);
        }
        return { configured: payload.configured };
    }

    async login(username: string, password: string, signal?: AbortSignal): Promise<AdministratorIdentity> {
        const generation = this.#generation;
        const response = await this.request(`${AUTH_ROOT}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
            signal,
        });
        return this.acceptSession(await readJson(response), generation);
    }

    async session(signal?: AbortSignal): Promise<AdministratorIdentity> {
        const generation = this.#generation;
        const response = await this.request(`${AUTH_ROOT}/session`, { method: 'GET', signal });
        return this.acceptSession(await readJson(response), generation);
    }

    async logout(signal?: AbortSignal): Promise<void> {
        const csrfToken = this.#csrfToken;
        this.clearPrivateSession();
        if (!csrfToken) throw new AdminAuthError('CSRF_TOKEN_UNAVAILABLE', null);
        const response = await this.request(`${AUTH_ROOT}/logout`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrfToken },
            signal,
        });
        const body = await response.text().catch(() => {
            throw new AdminAuthError('AUTH_RESPONSE_INVALID', response.status);
        });
        if (response.status !== 204 || body !== '') {
            throw new AdminAuthError('AUTH_RESPONSE_INVALID', response.status);
        }
    }

    async credentialMetadata(signal?: AbortSignal): Promise<CredentialMetadata> {
        return this.protectedOperation(false, signal, async (requestSignal) => {
            const response = await this.request('/api/prisma/admin/credentials', {
                method: 'GET', signal: requestSignal,
            });
            return this.parseResponse(response, parseCredentialMetadata);
        });
    }

    async telegramHealth(signal?: AbortSignal): Promise<TelegramPassiveHealth> {
        return this.protectedOperation(false, signal, async (requestSignal) => {
            const response = await this.request('/api/prisma/health', { method: 'GET', signal: requestSignal });
            return this.parseResponse(response, parseTelegramPassiveHealth);
        });
    }

    async saveCredential(
        provider: CredentialProvider,
        secret: string,
        signal?: AbortSignal,
    ): Promise<CredentialMutationResult> {
        validateCredentialSecret(secret);
        return this.protectedOperation(true, signal, async (requestSignal, csrfToken) => {
            const response = await this.request(`/api/prisma/admin/credentials/${provider}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify({ secret }),
                signal: requestSignal,
            });
            return this.parseResponse(response, parseCredentialMutation);
        });
    }

    async deleteCredential(provider: CredentialProvider, signal?: AbortSignal): Promise<void> {
        return this.protectedOperation(true, signal, async (requestSignal, csrfToken) => {
            try {
                const response = await this.request(`/api/prisma/admin/credentials/${provider}`, {
                    method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken }, signal: requestSignal,
                });
                const body = await response.text().catch(() => {
                    throw new AdminAuthError('ADMIN_CREDENTIAL_RESPONSE_INVALID', response.status);
                });
                if (response.status !== 204 || body !== '') {
                    throw new AdminAuthError('ADMIN_CREDENTIAL_RESPONSE_INVALID', response.status);
                }
            } catch (error) {
                if (error instanceof AdminAuthError
                    && error.status === 409 && error.code === 'TELEGRAM_STOP_TIMEOUT') {
                    throw new AdminAuthError(error.code, error.status, true);
                }
                throw error;
            }
        });
    }

    async applyTelegram(signal?: AbortSignal): Promise<TelegramAdministrationStatus> {
        return this.protectedOperation(true, signal, async (requestSignal, csrfToken) => {
            const response = await this.request('/api/prisma/admin/credentials/telegram/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: '{}',
                signal: requestSignal,
            });
            return this.parseResponse(response, parseTelegramAdministrationStatus);
        });
    }

    private acceptSession(payload: unknown, generation: number): AdministratorIdentity {
        const envelope = parseSessionEnvelope(payload, this.now());
        if (generation === this.#generation) this.#csrfToken = envelope.csrfToken;
        return { username: envelope.administrator.username, absoluteExpiresAt: envelope.absoluteExpiresAt };
    }

    private async parseResponse<T>(response: Response, parser: (value: unknown) => T): Promise<T> {
        const payload = await readJson(response);
        try {
            return parser(payload);
        } catch {
            throw new AdminAuthError('ADMIN_CREDENTIAL_RESPONSE_INVALID', response.status);
        }
    }

    private async protectedOperation<T>(
        requireCsrf: boolean,
        signal: AbortSignal | undefined,
        operation: (signal: AbortSignal, csrfToken: string) => Promise<T>,
    ): Promise<T> {
        const generation = this.#generation;
        const csrfToken = this.#csrfToken ?? '';
        if (requireCsrf && !csrfToken) throw new AdminAuthError('CSRF_TOKEN_UNAVAILABLE', null);
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) controller.abort();
        this.protectedRequests.add(controller);
        try {
            const result = await operation(controller.signal, csrfToken);
            if (controller.signal.aborted || generation !== this.#generation) {
                throw new DOMException('The operation was aborted.', 'AbortError');
            }
            return result;
        } catch (error) {
            if (controller.signal.aborted || generation !== this.#generation) {
                throw new DOMException('The operation was aborted.', 'AbortError');
            }
            throw error;
        } finally {
            signal?.removeEventListener('abort', abort);
            this.protectedRequests.delete(controller);
        }
    }

    private async request(path: string, init: RequestInit): Promise<Response> {
        let response: Response;
        try {
            response = await this.fetcher(path, {
                ...init,
                credentials: 'same-origin',
                cache: 'no-store',
                redirect: 'error',
                headers: { Accept: 'application/json', 'Cache-Control': 'no-store', ...init.headers },
            });
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') throw error;
            throw new AdminAuthError('AUTH_TRANSPORT_UNAVAILABLE', null);
        }
        if (!response.ok) {
            throw new AdminAuthError(await readErrorCode(response), response.status);
        }
        return response;
    }
}

export const adminAuthClient = new AdminAuthClient();
