import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminAuthClient, AdminAuthError } from './adminAuth.service';
import {
    AdminSessionController,
    ADMIN_EXIT_INTENT_KEY,
    createMemoryAuthStatePort,
} from './adminSession.controller';
import { SafeAdminStorage } from './adminAuth.storage';
import { useAuthStore } from '../store/auth.store';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}

const SESSION = {
    ok: true,
    administrator: { username: 'admin' },
    csrfToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    absoluteExpiresAt: 2_000_000_000,
};

const FRESH_SESSION = {
    ...SESSION,
    csrfToken: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
};

describe('AdminAuthClient', () => {
    beforeEach(() => {
        localStorage.clear();
        useAuthStore.setState({
            session: { user: null, isAuthenticated: false, loginTimestamp: null },
            isHydrated: false,
            isAuthenticating: false,
            error: null,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function receiverSensitiveGlobalFetch(
        this: Window & typeof globalThis,
        path: RequestInfo | URL,
    ): Promise<Response> {
        if (this !== undefined && this !== globalThis && this !== window) {
            throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
        }
        if (path === '/api/prisma/admin/auth/session') return Promise.resolve(jsonResponse(SESSION));
        if (path === '/api/prisma/admin/auth/login') return Promise.resolve(jsonResponse(FRESH_SESSION));
        return Promise.reject(new Error(`Unexpected path: ${String(path)}`));
    }

    it('invokes the default global fetch with an acceptable receiver for session bootstrap and login', async () => {
        const fetchSpy = vi.fn(receiverSensitiveGlobalFetch);
        vi.stubGlobal('fetch', fetchSpy);
        const client = new AdminAuthClient();

        await expect(client.session()).resolves.toEqual({ username: 'admin', absoluteExpiresAt: 2_000_000_000 });
        await expect(client.login('admin', 'password')).resolves.toEqual({
            username: 'admin',
            absoluteExpiresAt: FRESH_SESSION.absoluteExpiresAt,
        });
        expect(fetchSpy.mock.calls.map(([path]) => path)).toEqual([
            '/api/prisma/admin/auth/session',
            '/api/prisma/admin/auth/login',
        ]);
        for (const [, init] of fetchSpy.mock.calls) {
            expect(init).toEqual(expect.objectContaining({
                credentials: 'same-origin',
                cache: 'no-store',
                redirect: 'error',
            }));
        }
    });

    it('wraps a default-transport invocation failure as AUTH_TRANSPORT_UNAVAILABLE', async () => {
        const rejectingFetch = function (this: unknown): Promise<Response> {
            throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
        };
        vi.stubGlobal('fetch', rejectingFetch);
        const client = new AdminAuthClient();

        await expect(client.session()).rejects.toMatchObject({ code: 'AUTH_TRANSPORT_UNAVAILABLE' });
    });

    it('preserves exact password bytes and uses bounded same-origin transport', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(SESSION));
        const client = new AdminAuthClient(fetcher);

        await client.login('admin', '  exact password\n', undefined);

        expect(fetcher).toHaveBeenCalledWith('/api/prisma/admin/auth/login', expect.objectContaining({
            method: 'POST', credentials: 'same-origin', cache: 'no-store',
            body: JSON.stringify({ username: 'admin', password: '  exact password\n' }),
        }));
        const headers = fetcher.mock.calls[0]?.[1]?.headers as Record<string, string>;
        expect(headers.Origin).toBeUndefined();
        expect(headers['X-Prisma-Session-Capability']).toBeUndefined();
    });

    it('keeps CSRF private and sends it only on logout', async () => {
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse(SESSION))
            .mockResolvedValueOnce(new Response(null, { status: 204 }));
        const client = new AdminAuthClient(fetcher);

        expect(await client.session()).toEqual({ username: 'admin', absoluteExpiresAt: 2_000_000_000 });
        await client.logout();

        expect(fetcher.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({ 'X-CSRF-Token': SESSION.csrfToken }),
        }));
    });

    it('rejects malformed success responses without creating identity', async () => {
        const client = new AdminAuthClient(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
            ok: true, administrator: { username: 'admin', role: 'Admin' }, csrfToken: '', absoluteExpiresAt: 'later',
        })));

        await expect(client.session()).rejects.toEqual(expect.objectContaining<Partial<AdminAuthError>>({
            code: 'AUTH_RESPONSE_INVALID',
        }));
    });

    it('preserves stable backend error codes and authoritative status', async () => {
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse({ configured: false }))
            .mockResolvedValueOnce(jsonResponse({ ok: false, error: 'AUTHENTICATION_REQUIRED' }, 401));
        const client = new AdminAuthClient(fetcher);

        await expect(client.status()).resolves.toEqual({ configured: false });
        await expect(client.session()).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED', status: 401 });
    });

    it('replaces unknown backend error payloads with a fixed public code before constructing the error', async () => {
        const canary = 'synthetic-secret-canary';
        const client = new AdminAuthClient(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
            ok: false,
            error: canary,
            details: { cause: canary },
            extra: canary,
        }, 500)));

        let failure: unknown;
        try {
            await client.credentialMetadata();
        } catch (error) {
            failure = error;
        }

        expect(failure).toMatchObject({ code: 'AUTH_REQUEST_FAILED', status: 500 });
        expect(failure).toBeInstanceOf(AdminAuthError);
        expect((failure as Error).message).toBe('AUTH_REQUEST_FAILED');
        expect(JSON.stringify(failure)).not.toContain(canary);
    });

    it.each([
        ['AUTHENTICATION_REQUIRED', 401],
        ['CSRF_VALIDATION_FAILED', 403],
        ['CREDENTIAL_STORAGE_UNAVAILABLE', 503],
        ['TELEGRAM_STOP_TIMEOUT', 409],
    ])('preserves allowlisted public backend code %s with status %s', async (code, status) => {
        const client = new AdminAuthClient(
            vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: false, error: code }, status)),
        );

        await expect(client.credentialMetadata()).rejects.toMatchObject({ code, status });
    });

    it('uses the active private CSRF for exact credential routes without changing secret bytes', async () => {
        const secret = '  synthetic-secret\n';
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse(SESSION))
            .mockResolvedValueOnce(jsonResponse({
                ok: true,
                providers: { gemini: { configured: false }, telegram: { configured: true } },
            }))
            .mockResolvedValueOnce(jsonResponse({ ok: true, provider: 'gemini', configured: true }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
            .mockResolvedValueOnce(jsonResponse({
                ok: true,
                telegram: {
                    source: 'protected', enabled: true, configured: true,
                    desiredGeneration: 2, appliedGeneration: 2, running: true,
                    verified: true, restartRequired: false, lastError: null,
                },
            }));
        const client = new AdminAuthClient(fetcher);
        await client.session();

        await expect(client.credentialMetadata()).resolves.toMatchObject({
            gemini: { configured: false }, telegram: { configured: true },
        });
        await client.saveCredential('gemini', secret);
        await client.deleteCredential('gemini');
        await client.applyTelegram();

        expect(fetcher.mock.calls.slice(1).map(([path, init]) => [path, init?.method])).toEqual([
            ['/api/prisma/admin/credentials', 'GET'],
            ['/api/prisma/admin/credentials/gemini', 'PUT'],
            ['/api/prisma/admin/credentials/gemini', 'DELETE'],
            ['/api/prisma/admin/credentials/telegram/apply', 'POST'],
        ]);
        const put = fetcher.mock.calls[2]?.[1];
        expect(put?.body).toBe(JSON.stringify({ secret }));
        expect(put?.headers).toEqual(expect.objectContaining({
            'X-CSRF-Token': SESSION.csrfToken,
            'Content-Type': 'application/json',
        }));
        expect(fetcher.mock.calls[4]?.[1]?.body).toBe('{}');
    });

    it('fences protected response bodies after logout invalidates the auth generation', async () => {
        let releaseMetadata!: (response: Response) => void;
        const pendingMetadata = new Promise<Response>((resolve) => { releaseMetadata = resolve; });
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse(SESSION))
            .mockImplementationOnce(() => pendingMetadata);
        const client = new AdminAuthClient(fetcher);
        await client.session();

        const metadata = client.credentialMetadata();
        client.clearPrivateSession();
        releaseMetadata(jsonResponse({
            ok: true,
            providers: { gemini: { configured: true }, telegram: { configured: true } },
        }));

        await expect(metadata).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('reads only passive Telegram health metadata from the fixed same-origin route', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
            ok: true,
            service: 'prisma-local-presentation',
            telegramEnabled: true,
            telegramConfigured: true,
            telegramConnected: false,
            telegramVerified: false,
            telegramConfigurationError: null,
            telegramLastError: 'TELEGRAM_POLL_FAILED',
            telegramDesiredGeneration: 3,
            telegramAppliedGeneration: 3,
            telegramRestartRequired: false,
        }));
        const client = new AdminAuthClient(fetcher);

        await expect(client.telegramHealth()).resolves.toMatchObject({
            enabled: true, configured: true, running: false, lastError: 'TELEGRAM_POLL_FAILED',
        });
        expect(fetcher).toHaveBeenCalledWith('/api/prisma/health', expect.objectContaining({
            method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        }));
    });

    it('marks Telegram stop timeout as a committed deletion without replaying it', async () => {
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse(SESSION))
            .mockResolvedValueOnce(jsonResponse({ ok: false, error: 'TELEGRAM_STOP_TIMEOUT' }, 409));
        const client = new AdminAuthClient(fetcher);
        await client.session();

        await expect(client.deleteCredential('telegram')).rejects.toMatchObject({
            code: 'TELEGRAM_STOP_TIMEOUT', status: 409, committed: true,
        });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it.each([
        'x',
        'é'.repeat(43),
        'A'.repeat(42),
        'A'.repeat(44),
        '___________________________________________',
    ])('rejects malformed or noncanonical CSRF token %s', async (csrfToken) => {
        const client = new AdminAuthClient(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ...SESSION, csrfToken })));

        await expect(client.session()).rejects.toMatchObject({ code: 'AUTH_RESPONSE_INVALID' });
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, 1_000])(
        'rejects non-future expiration %s before granting identity',
        async (absoluteExpiresAt) => {
            const client = new AdminAuthClient(
                vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ...SESSION, absoluteExpiresAt })),
            );
            await expect(client.session()).rejects.toMatchObject({ code: 'AUTH_RESPONSE_INVALID' });
        },
    );

    it.each([
        jsonResponse({ ok: true }, 200),
        new Response('<html>SPA fallback</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    ])('requires exact empty 204 logout instead of accepting arbitrary 2xx', async (logoutResponse) => {
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse(SESSION))
            .mockResolvedValueOnce(logoutResponse);
        const client = new AdminAuthClient(fetcher);
        await client.session();

        await expect(client.logout()).rejects.toMatchObject({ code: 'AUTH_RESPONSE_INVALID' });
        expect(fetcher.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ redirect: 'error' }));
    });

    it('keeps pending exit when the actual client receives a successful SPA fallback on logout', async () => {
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse(SESSION))
            .mockResolvedValueOnce(new Response('<html>SPA fallback</html>', {
                status: 200,
                headers: { 'Content-Type': 'text/html' },
            }));
        const controller = new AdminSessionController(new AdminAuthClient(fetcher), localStorage, window);
        await controller.bootstrap();

        await controller.exit();

        expect(localStorage.getItem(ADMIN_EXIT_INTENT_KEY)).toBe('1');
        expect(useAuthStore.getState().session.isAuthenticated).toBe(false);
        expect(useAuthStore.getState().error).toBe('No se pudo confirmar el cierre remoto de la sesión.');
    });

    it('fences private CSRF against a delayed login response after exit even when fetch ignores abort', async () => {
        const reconciledSession = {
            ...SESSION,
            csrfToken: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
        };
        let releaseLogin!: (response: Response) => void;
        const loginResponse = new Promise<Response>((resolve) => { releaseLogin = resolve; });
        const fetcher = vi.fn<typeof fetch>((path) => {
            if (path === '/api/prisma/admin/auth/login') return loginResponse;
            if (path === '/api/prisma/admin/auth/session') {
                return Promise.resolve(jsonResponse(reconciledSession));
            }
            return Promise.resolve(new Response(null, { status: 204 }));
        });
        const client = new AdminAuthClient(fetcher);
        const controller = new AdminSessionController(client, localStorage, window, () => 1_000);
        useAuthStore.setState({ session: { user: null, isAuthenticated: false, loginTimestamp: null }, isHydrated: true });

        const login = controller.login('admin', 'password');
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith(
            '/api/prisma/admin/auth/login', expect.any(Object),
        ));
        const exiting = controller.exit();
        releaseLogin(jsonResponse(SESSION));
        await Promise.all([login, exiting]);

        const logoutCalls = fetcher.mock.calls.filter(([path]) => path === '/api/prisma/admin/auth/logout');
        expect(logoutCalls).toHaveLength(1);
        expect((logoutCalls[0]?.[1]?.headers as Record<string, string>)['X-CSRF-Token'])
            .toBe(reconciledSession.csrfToken);
        expect(localStorage.getItem(ADMIN_EXIT_INTENT_KEY)).not.toBeNull();
        await expect(client.logout()).rejects.toMatchObject({ code: 'CSRF_TOKEN_UNAVAILABLE' });
    });

    it('keeps exit intent across repeated 401 reloads until a late server login is revoked', async () => {
        let serverCookie = false;
        let completeServerLogin!: () => void;
        const fetcher = vi.fn<typeof fetch>((path, init) => {
            if (path === '/api/prisma/admin/auth/login') {
                return new Promise<Response>((_resolve, reject) => {
                    completeServerLogin = () => { serverCookie = true; };
                    init?.signal?.addEventListener('abort', () => {
                        reject(new DOMException('Aborted', 'AbortError'));
                    }, { once: true });
                });
            }
            if (path === '/api/prisma/admin/auth/session') {
                return Promise.resolve(serverCookie
                    ? jsonResponse(SESSION)
                    : jsonResponse({ ok: false, error: 'AUTHENTICATION_REQUIRED' }, 401));
            }
            if (path === '/api/prisma/admin/auth/logout') {
                serverCookie = false;
                return Promise.resolve(new Response(null, { status: 204 }));
            }
            throw new Error(`Unexpected path: ${String(path)}`);
        });
        const storage = new SafeAdminStorage(localStorage);
        const controller = new AdminSessionController(
            new AdminAuthClient(fetcher), storage, window, () => 1_000, createMemoryAuthStatePort(),
        );

        const login = controller.login('admin', 'password');
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith(
            '/api/prisma/admin/auth/login', expect.any(Object),
        ));
        await Promise.all([login, controller.exit()]);

        expect(localStorage.getItem(ADMIN_EXIT_INTENT_KEY)).toBe('1');
        expect(serverCookie).toBe(false);

        for (let reload = 0; reload < 2; reload += 1) {
            const state = createMemoryAuthStatePort();
            await new AdminSessionController(
                new AdminAuthClient(fetcher), new SafeAdminStorage(localStorage), window, () => 1_000, state,
            ).bootstrap();
            expect(state.get().session.isAuthenticated).toBe(false);
            expect(localStorage.getItem(ADMIN_EXIT_INTENT_KEY)).toBe('1');
        }

        completeServerLogin();
        expect(serverCookie).toBe(true);
        const finalState = createMemoryAuthStatePort();
        await new AdminSessionController(
            new AdminAuthClient(fetcher), new SafeAdminStorage(localStorage), window, () => 1_000, finalState,
        ).bootstrap();

        expect(finalState.get().session.isAuthenticated).toBe(false);
        expect(serverCookie).toBe(false);
        expect(localStorage.getItem(ADMIN_EXIT_INTENT_KEY)).not.toBeNull();
    });

    it('keeps explicit exit durable when old-cookie logout 204 precedes a late aborted login cookie', async () => {
        let serverCookie: 'A' | 'B' | 'fresh' | null = 'A';
        let loginAttempt = 0;
        let completeAbortedServerLogin!: () => void;
        const fetcher = vi.fn<typeof fetch>((path, init) => {
            if (path === '/api/prisma/admin/auth/login') {
                loginAttempt += 1;
                if (loginAttempt === 1) {
                    return new Promise<Response>((_resolve, reject) => {
                        completeAbortedServerLogin = () => { serverCookie = 'B'; };
                        init?.signal?.addEventListener('abort', () => {
                            reject(new DOMException('Aborted', 'AbortError'));
                        }, { once: true });
                    });
                }
                serverCookie = 'fresh';
                return Promise.resolve(jsonResponse(FRESH_SESSION));
            }
            if (path === '/api/prisma/admin/auth/session') {
                if (serverCookie === null) {
                    return Promise.resolve(jsonResponse({ ok: false, error: 'AUTHENTICATION_REQUIRED' }, 401));
                }
                return Promise.resolve(jsonResponse(serverCookie === 'A' ? SESSION : FRESH_SESSION));
            }
            if (path === '/api/prisma/admin/auth/logout') {
                serverCookie = null;
                return Promise.resolve(new Response(null, { status: 204 }));
            }
            throw new Error(`Unexpected path: ${String(path)}`);
        });
        const state = createMemoryAuthStatePort();
        const controller = new AdminSessionController(
            new AdminAuthClient(fetcher), new SafeAdminStorage(localStorage), window, () => 1_000, state,
        );

        const login = controller.login('admin', 'password');
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith(
            '/api/prisma/admin/auth/login', expect.any(Object),
        ));
        await Promise.all([login, controller.exit()]);

        expect(serverCookie).toBeNull();
        expect(localStorage.getItem(ADMIN_EXIT_INTENT_KEY)).not.toBeNull();
        expect(state.get().error).toBeNull();

        completeAbortedServerLogin();
        expect(serverCookie).toBe('B');

        let reloadController!: AdminSessionController;
        for (let reload = 0; reload < 2; reload += 1) {
            const reloadState = createMemoryAuthStatePort();
            reloadController = new AdminSessionController(
                new AdminAuthClient(fetcher), new SafeAdminStorage(localStorage), window, () => 1_000, reloadState,
            );
            await reloadController.bootstrap();
            expect(reloadState.get().session.isAuthenticated).toBe(false);
            expect(reloadState.get().error).toBeNull();
            expect(localStorage.getItem(ADMIN_EXIT_INTENT_KEY)).not.toBeNull();
        }

        expect(serverCookie).toBe('B');
        expect((await reloadController.login('admin', 'password')).ok).toBe(true);
        expect(localStorage.getItem(ADMIN_EXIT_INTENT_KEY)).toBeNull();
        expect(serverCookie).toBe('fresh');

        const restoredState = createMemoryAuthStatePort();
        await new AdminSessionController(
            new AdminAuthClient(fetcher), new SafeAdminStorage(localStorage), window, () => 1_000, restoredState,
        ).bootstrap();
        expect(restoredState.get().session.isAuthenticated).toBe(true);
    });

    it('keeps an ordinary exact-204 exit signed out without a false error until explicit login', async () => {
        let serverCookie = true;
        const fetcher = vi.fn<typeof fetch>((path) => {
            if (path === '/api/prisma/admin/auth/session') {
                return Promise.resolve(serverCookie
                    ? jsonResponse(SESSION)
                    : jsonResponse({ ok: false, error: 'AUTHENTICATION_REQUIRED' }, 401));
            }
            if (path === '/api/prisma/admin/auth/logout') {
                serverCookie = false;
                return Promise.resolve(new Response(null, { status: 204 }));
            }
            if (path === '/api/prisma/admin/auth/login') {
                serverCookie = true;
                return Promise.resolve(jsonResponse(FRESH_SESSION));
            }
            throw new Error(`Unexpected path: ${String(path)}`);
        });
        const firstState = createMemoryAuthStatePort();
        const first = new AdminSessionController(
            new AdminAuthClient(fetcher), new SafeAdminStorage(localStorage), window, () => 1_000, firstState,
        );
        await first.bootstrap();

        await first.exit();

        expect(firstState.get().session.isAuthenticated).toBe(false);
        expect(firstState.get().error).toBeNull();
        expect(localStorage.getItem(ADMIN_EXIT_INTENT_KEY)).not.toBeNull();

        const reloadState = createMemoryAuthStatePort();
        const reload = new AdminSessionController(
            new AdminAuthClient(fetcher), new SafeAdminStorage(localStorage), window, () => 1_000, reloadState,
        );
        await reload.bootstrap();
        expect(reloadState.get().session.isAuthenticated).toBe(false);
        expect(reloadState.get().error).toBeNull();

        expect((await reload.login('admin', 'password')).ok).toBe(true);
        expect(reloadState.get().session.isAuthenticated).toBe(true);
        expect(localStorage.getItem(ADMIN_EXIT_INTENT_KEY)).toBeNull();
    });

    it('ignores an obsolete pending-exit GET after a fresh login and retains the fresh private CSRF', async () => {
        localStorage.setItem(ADMIN_EXIT_INTENT_KEY, '1');
        let releaseOldSession!: (response: Response) => void;
        const oldSession = new Promise<Response>((resolve) => { releaseOldSession = resolve; });
        const fetcher = vi.fn<typeof fetch>((path) => {
            if (path === '/api/prisma/admin/auth/session') return oldSession;
            if (path === '/api/prisma/admin/auth/login') return Promise.resolve(jsonResponse(FRESH_SESSION));
            if (path === '/api/prisma/admin/auth/logout') return Promise.resolve(new Response(null, { status: 204 }));
            throw new Error(`Unexpected path: ${String(path)}`);
        });
        const client = new AdminAuthClient(fetcher);
        const state = createMemoryAuthStatePort();
        const controller = new AdminSessionController(
            client, new SafeAdminStorage(localStorage), window, () => 1_000, state,
        );

        const bootstrap = controller.bootstrap();
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith(
            '/api/prisma/admin/auth/session', expect.any(Object),
        ));
        const login = await controller.login('admin', 'password');
        expect(login.ok).toBe(true);
        expect(state.get().session.isAuthenticated).toBe(true);

        releaseOldSession(jsonResponse(SESSION));
        await bootstrap;

        expect(state.get().session.isAuthenticated).toBe(true);
        await client.logout();
        const logoutCall = fetcher.mock.calls.find(([path]) => path === '/api/prisma/admin/auth/logout');
        expect((logoutCall?.[1]?.headers as Record<string, string>)['X-CSRF-Token'])
            .toBe(FRESH_SESSION.csrfToken);
    });

    it('serializes a pending exit logout before committing a fresh login and CSRF', async () => {
        localStorage.setItem(ADMIN_EXIT_INTENT_KEY, '1');
        let serverCookie = true;
        let releaseLogout!: () => void;
        const pendingLogout = new Promise<Response>((resolve) => {
            releaseLogout = () => {
                serverCookie = false;
                resolve(new Response(null, { status: 204 }));
            };
        });
        const fetcher = vi.fn<typeof fetch>((path) => {
            if (path === '/api/prisma/admin/auth/session') return Promise.resolve(jsonResponse(SESSION));
            if (path === '/api/prisma/admin/auth/logout') return pendingLogout;
            if (path === '/api/prisma/admin/auth/login') {
                serverCookie = true;
                return Promise.resolve(jsonResponse(FRESH_SESSION));
            }
            throw new Error(`Unexpected path: ${String(path)}`);
        });
        const client = new AdminAuthClient(fetcher);
        const state = createMemoryAuthStatePort();
        const controller = new AdminSessionController(
            client, new SafeAdminStorage(localStorage), window, () => 1_000, state,
        );

        const bootstrap = controller.bootstrap();
        await vi.waitFor(() => expect(fetcher.mock.calls.some(
            ([path]) => path === '/api/prisma/admin/auth/logout',
        )).toBe(true));
        const login = controller.login('admin', 'password');
        await Promise.resolve();
        expect(fetcher.mock.calls.some(([path]) => path === '/api/prisma/admin/auth/login')).toBe(false);

        releaseLogout();
        await bootstrap;
        const result = await login;

        expect(result.ok).toBe(true);
        expect(serverCookie).toBe(true);
        expect(state.get().session.isAuthenticated).toBe(true);
        await client.logout();
        const logoutCalls = fetcher.mock.calls.filter(([path]) => path === '/api/prisma/admin/auth/logout');
        expect((logoutCalls.at(-1)?.[1]?.headers as Record<string, string>)['X-CSRF-Token'])
            .toBe(FRESH_SESSION.csrfToken);
    });
});
