import {
    parseChannelAAdministrationStatus,
    parseChannelAVerificationResult,
    parseCredentialMetadata,
    parseCredentialMutation,
    parseGeminiVerificationResult,
    parseSharedConfigWriteResult,
    parseTelegramAdministrationStatus,
    parseTelegramPassiveHealth,
    parseTelegramVerificationResult,
    validateCredentialSecret,
    type AdminAuthStatus,
    type AdministratorIdentity,
    type ChannelAAdministrationStatus,
    type CredentialMetadata,
    type CredentialMutationResult,
    type CredentialProvider,
    type GeminiCredentialProviderMetadata,
    type SharedConfigBatch,
    type SharedConfigWriteResult,
    type TelegramAdministrationStatus,
    type TelegramFamilyCredentialProviderMetadata,
    type TelegramPassiveHealth,
} from '../domain';

const AUTH_ROOT = '/api/leda/admin/auth';
const CHANNEL_A_STATUS_ROUTE = '/api/leda/admin/credentials/telegram_channel_a/status';
const CHANNEL_A_APPLY_ROUTE = '/api/leda/admin/credentials/telegram_channel_a/apply';
const GEMINI_VERIFY_ROUTE = '/api/leda/admin/credentials/gemini/verify';
const TELEGRAM_VERIFY_ROUTE = '/api/leda/admin/credentials/telegram/verify';
const CHANNEL_A_VERIFY_ROUTE = '/api/leda/admin/credentials/telegram_channel_a/verify';
const SHARED_CONFIG_WRITE_ROUTE = '/api/leda/admin/hmi-config';
const CSRF_TOKEN_LENGTH = 43;
export interface AdminLoginOptions {
    signal?: AbortSignal;
    takeover?: boolean;
}

export const SESSION_REPLACED_CODE = 'ADMIN_SESSION_REPLACED';
export const SESSION_ACTIVE_ELSEWHERE_CODE = 'ADMIN_SESSION_ACTIVE_ELSEWHERE';
const PUBLIC_ERROR_CODES = new Set([
    'ADMIN_CREDENTIAL_BLANK',
    'ADMIN_CREDENTIAL_TOO_LARGE',
    'AUTH_CONFIGURATION_INVALID',
    SESSION_ACTIVE_ELSEWHERE_CODE,
    SESSION_REPLACED_CODE,
    'AUTHENTICATION_REQUIRED',
    'AUTH_NOT_CONFIGURED',
    'AUTH_STORAGE_UNAVAILABLE',
    'AUTH_TRANSPORT_REJECTED',
    'CREDENTIAL_PROVIDER_UNSUPPORTED',
    'CREDENTIAL_REQUEST_TOO_LARGE',
    'CREDENTIAL_STORAGE_UNAVAILABLE',
    'CSRF_VALIDATION_FAILED',
    'GEMINI_VERIFICATION_IN_PROGRESS',
    'GEMINI_VERIFICATION_UNAVAILABLE',
    'HMI_CONFIG_DOCUMENT_TOO_LARGE',
    'HMI_CONFIG_INVALID_REQUEST',
    'HMI_CONFIG_REQUEST_TOO_LARGE',
    'HMI_CONFIG_UNAVAILABLE',
    'HMI_CONFIG_VALUE_TOO_LARGE',
    'INVALID_CREDENTIALS',
    'INVALID_CREDENTIAL_REQUEST',
    'INVALID_CURRENT_PASSWORD',
    'INVALID_LOGIN_REQUEST',
    'INVALID_PASSWORD_CHANGE_REQUEST',
    'INVALID_TELEGRAM_APPLY_REQUEST',
    'JSON_REQUIRED',
    'LOGIN_RATE_LIMITED',
    'LEDA_CHANNEL_A_CONFIGURATION_INVALID',
    'LEDA_CHANNEL_A_CONFIGURATION_UNAVAILABLE',
    'LEDA_CHANNEL_A_CREDENTIAL_MISSING',
    'LEDA_CHANNEL_A_CREDENTIAL_UNAVAILABLE',
    'LEDA_CHANNEL_A_LIFECYCLE_UNAVAILABLE',
    'LEDA_CHANNEL_A_MANAGER_BUSY',
    'LEDA_CHANNEL_A_MANAGER_UNAVAILABLE',
    'LEDA_CHANNEL_A_RESTART_REQUIRED',
    'LEDA_CHANNEL_A_STOP_UNCONFIRMED',
    'LEDA_CHANNEL_A_VERIFICATION_IN_PROGRESS',
    'LEDA_CHANNEL_A_VERIFICATION_UNAVAILABLE',
    'LEDA_LOCAL_TELEGRAM_BOT_TOKEN_MISSING',
    'PASSWORD_CHANGE_REQUEST_TOO_LARGE',
    'PASSWORD_POLICY_REJECTED',
    'PASSWORD_UNCHANGED',
    'TELEGRAM_CREDENTIAL_MISSING',
    'TELEGRAM_DISABLED',
    'TELEGRAM_POLL_FAILED',
    'TELEGRAM_PREPARATION_FAILED',
    'TELEGRAM_PROVIDER_UNAVAILABLE',
    'TELEGRAM_APPLY_REQUEST_TOO_LARGE',
    'TELEGRAM_BOT_IDENTITY_RESERVED',
    'TELEGRAM_STOP_TIMEOUT',
    'TELEGRAM_VERIFICATION_IN_PROGRESS',
    'TELEGRAM_VERIFICATION_UNAVAILABLE',
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
    private readonly sessionReplacedListeners = new Set<() => void>();

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

    // Any request (session refresh, credentials, shared-config writes) can learn that another login
    // displaced this session; subscribers are told once per such response.
    onSessionReplaced(listener: () => void): () => void {
        this.sessionReplacedListeners.add(listener);
        return () => { this.sessionReplacedListeners.delete(listener); };
    }

    async status(signal?: AbortSignal): Promise<AdminAuthStatus> {
        const response = await this.request(`${AUTH_ROOT}/status`, { method: 'GET', signal });
        const payload = await readJson(response);
        if (!isObject(payload) || typeof payload.configured !== 'boolean') {
            throw new AdminAuthError('AUTH_RESPONSE_INVALID', response.status);
        }
        return { configured: payload.configured };
    }

    // The runtime keeps one administrator session: `takeover` confirms closing the one open elsewhere.
    async login(
        username: string,
        password: string,
        { signal, takeover = false }: AdminLoginOptions = {},
    ): Promise<AdministratorIdentity> {
        const generation = this.#generation;
        const response = await this.request(`${AUTH_ROOT}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(takeover ? { username, password, takeover: true } : { username, password }),
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

    // The administrator changes their own password. The server keeps this session and ends every
    // other one, so the private CSRF token stays valid. A wrong current password answers 401
    // INVALID_CURRENT_PASSWORD, which callers must not treat as a lost session.
    async changePassword(currentPassword: string, newPassword: string, signal?: AbortSignal): Promise<void> {
        return this.protectedOperation(true, signal, async (requestSignal, csrfToken) => {
            const response = await this.request(`${AUTH_ROOT}/password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify({ currentPassword, newPassword }),
                signal: requestSignal,
            });
            const payload = await readJson(response);
            if (!isObject(payload) || payload.ok !== true) throw new AdminAuthError('AUTH_RESPONSE_INVALID', response.status);
        });
    }

    async credentialMetadata(signal?: AbortSignal): Promise<CredentialMetadata> {
        return this.protectedOperation(false, signal, async (requestSignal) => {
            const response = await this.request('/api/leda/admin/credentials', {
                method: 'GET', signal: requestSignal,
            });
            return this.parseResponse(response, parseCredentialMetadata);
        });
    }

    async telegramHealth(signal?: AbortSignal): Promise<TelegramPassiveHealth> {
        return this.protectedOperation(false, signal, async (requestSignal) => {
            const response = await this.request('/api/leda/health', { method: 'GET', signal: requestSignal });
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
            const response = await this.request(`/api/leda/admin/credentials/${provider}`, {
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
                const response = await this.request(`/api/leda/admin/credentials/${provider}`, {
                    method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken }, signal: requestSignal,
                });
                const body = await response.text().catch(() => {
                    throw new AdminAuthError('ADMIN_CREDENTIAL_RESPONSE_INVALID', response.status);
                });
                if (response.status !== 204 || body !== '') {
                    throw new AdminAuthError('ADMIN_CREDENTIAL_RESPONSE_INVALID', response.status);
                }
            } catch (error) {
                if (error instanceof AdminAuthError && error.status === 409) {
                    const stopUnconfirmed = (provider === 'telegram' && error.code === 'TELEGRAM_STOP_TIMEOUT')
                        || (provider === 'telegram_channel_a'
                            && error.code === 'LEDA_CHANNEL_A_STOP_UNCONFIRMED');
                    if (stopUnconfirmed) throw new AdminAuthError(error.code, error.status, true);
                }
                throw error;
            }
        });
    }

    // Shared HMI configuration: the HMI's own settings, written to its own server
    // (never to the plant). Same session cookie and CSRF contract as the credential routes.
    async writeSharedConfig(batch: SharedConfigBatch, signal?: AbortSignal): Promise<SharedConfigWriteResult> {
        return this.protectedOperation(true, signal, async (requestSignal, csrfToken) => {
            const response = await this.request(SHARED_CONFIG_WRITE_ROUTE, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify(batch),
                signal: requestSignal,
            });
            return this.parseResponse(response, parseSharedConfigWriteResult);
        });
    }

    async applyTelegram(signal?: AbortSignal): Promise<TelegramAdministrationStatus> {
        return this.protectedOperation(true, signal, async (requestSignal, csrfToken) => {
            const response = await this.request('/api/leda/admin/credentials/telegram/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: '{}',
                signal: requestSignal,
            });
            return this.parseResponse(response, parseTelegramAdministrationStatus);
        });
    }

    async verifyGemini(signal?: AbortSignal): Promise<GeminiCredentialProviderMetadata> {
        return this.protectedOperation(true, signal, async (requestSignal, csrfToken) => {
            const response = await this.request(GEMINI_VERIFY_ROUTE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: '{}',
                signal: requestSignal,
            });
            return this.parseResponse(response, parseGeminiVerificationResult);
        });
    }

    // T13: non-sending bot token verification (one getMe call, never a send
    // or getUpdates) -- same empty-JSON-body/CSRF pattern as verifyGemini.
    async verifyTelegram(signal?: AbortSignal): Promise<TelegramFamilyCredentialProviderMetadata> {
        return this.protectedOperation(true, signal, async (requestSignal, csrfToken) => {
            const response = await this.request(TELEGRAM_VERIFY_ROUTE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: '{}',
                signal: requestSignal,
            });
            return this.parseResponse(response, parseTelegramVerificationResult);
        });
    }

    async verifyChannelA(signal?: AbortSignal): Promise<TelegramFamilyCredentialProviderMetadata> {
        return this.protectedOperation(true, signal, async (requestSignal, csrfToken) => {
            const response = await this.request(CHANNEL_A_VERIFY_ROUTE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: '{}',
                signal: requestSignal,
            });
            return this.parseResponse(response, parseChannelAVerificationResult);
        });
    }

    async channelAStatus(signal?: AbortSignal): Promise<ChannelAAdministrationStatus> {
        return this.protectedOperation(false, signal, async (requestSignal) => {
            const response = await this.request(CHANNEL_A_STATUS_ROUTE, {
                method: 'GET', signal: requestSignal,
            });
            return this.parseResponse(response, parseChannelAAdministrationStatus);
        });
    }

    async applyChannelA(signal?: AbortSignal): Promise<ChannelAAdministrationStatus> {
        return this.protectedOperation(true, signal, async (requestSignal, csrfToken) => {
            const response = await this.request(CHANNEL_A_APPLY_ROUTE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: '{}',
                signal: requestSignal,
            });
            return this.parseResponse(response, parseChannelAAdministrationStatus);
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
            const code = await readErrorCode(response);
            if (code === SESSION_REPLACED_CODE) {
                for (const listener of [...this.sessionReplacedListeners]) listener();
            }
            throw new AdminAuthError(code, response.status);
        }
        return response;
    }
}

export const adminAuthClient = new AdminAuthClient();
