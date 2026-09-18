import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CredentialAdministrationClient, CredentialAdministrationController } from './usePrismaCredentialAdministration';
import { PRISMA_CREDENTIAL_METADATA_QUERY_KEY, usePrismaCredentialAdministration } from './usePrismaCredentialAdministration';
import { AdminAuthClient, AdminAuthError } from '../services/adminAuth.service';
import { useAuthStore } from '../store/auth.store';
import RequirePermission from '../components/auth/RequirePermission';

const metadata = { gemini: { configured: false }, telegram: { configured: true } };
const health = {
    enabled: true, configured: true, running: true, verified: false,
    desiredGeneration: 2, appliedGeneration: 1, restartRequired: true,
    configurationError: null, lastError: null,
} as const;
const applied = {
    source: 'protected', enabled: true, configured: true,
    desiredGeneration: 2, appliedGeneration: 2, running: true,
    verified: true, restartRequired: false, lastError: null,
} as const;

function authenticated() {
    useAuthStore.setState({
        session: {
            user: { id: 'administrator:admin', username: 'admin', displayName: 'admin', role: { id: 'admin', name: 'Admin', permissions: ['admin:access'] } },
            isAuthenticated: true,
            loginTimestamp: new Date().toISOString(),
            absoluteExpiresAt: Math.floor(Date.now() / 1_000) + 600,
        },
        isHydrated: true,
        isAuthenticating: false,
        error: null,
    });
}

function setup(clientOverrides: Partial<CredentialAdministrationClient> = {}) {
    const client: CredentialAdministrationClient = {
        credentialMetadata: vi.fn(async () => metadata),
        telegramHealth: vi.fn(async () => health),
        saveCredential: vi.fn(async () => ({ provider: 'gemini', configured: true })),
        deleteCredential: vi.fn(async () => undefined),
        applyTelegram: vi.fn(async () => applied),
        ...clientOverrides,
    };
    const controller: CredentialAdministrationController = { handleProtectedRequestError: vi.fn(async () => undefined) };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
        () => usePrismaCredentialAdministration({ client, controller, active: true }),
        { wrapper },
    );
    return { ...hook, client, controller, queryClient };
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function healthResponse(): Response {
    return jsonResponse({
        ok: true,
        telegramEnabled: true,
        telegramConfigured: true,
        telegramConnected: true,
        telegramVerified: false,
        telegramConfigurationError: null,
        telegramLastError: null,
        telegramDesiredGeneration: 2,
        telegramAppliedGeneration: 1,
        telegramRestartRequired: true,
    });
}

function CredentialRouteProbe({ client }: { client: AdminAuthClient }) {
    const administration = usePrismaCredentialAdministration({
        client,
        controller: { handleProtectedRequestError: async () => undefined },
        active: true,
    });
    return (
        <>
            <span>{administration.data ? `gemini:${administration.data.credentials.gemini.configured}` : 'loading'}</span>
            <button type="button" onClick={() => void administration.refresh()}>Refresh protected metadata</button>
        </>
    );
}

function ViewerRoute() {
    const navigate = useNavigate();
    return (
        <>
            <span>Viewer route</span>
            <button type="button" onClick={() => { authenticated(); navigate('/admin'); }}>Return to admin</button>
        </>
    );
}

describe('usePrismaCredentialAdministration', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        authenticated();
    });

    it('keeps only metadata in Query and never stores the submitted secret', async () => {
        const secret = '  synthetic-secret\n';
        const { result, client, queryClient } = setup();
        await waitFor(() => expect(result.current.data).toEqual({ credentials: metadata, telegram: health }));

        await act(async () => { await result.current.saveCredential('gemini', secret); });

        expect(client.saveCredential).toHaveBeenCalledWith('gemini', secret, expect.any(AbortSignal));
        expect(JSON.stringify(queryClient.getQueryCache().getAll().map((query) => query.state.data))).not.toContain(secret);
        expect(JSON.stringify(queryClient.getMutationCache().getAll())).not.toContain(secret);
        expect(JSON.stringify(useAuthStore.getState())).not.toContain(secret);
        expect(JSON.stringify(localStorage)).not.toContain(secret);
        expect(JSON.stringify(sessionStorage)).not.toContain(secret);
    });

    it('blocks duplicate operations and aborts pending work when authority is revoked', async () => {
        let signal: AbortSignal | undefined;
        const pending = new Promise<unknown>(() => undefined);
        const { result, client, queryClient } = setup({
            saveCredential: vi.fn((_provider, _secret, requestSignal) => {
                signal = requestSignal;
                return pending;
            }),
        });
        await waitFor(() => expect(result.current.data).not.toBeNull());

        let first!: Promise<unknown>;
        act(() => { first = result.current.saveCredential('gemini', 'synthetic-secret'); });
        await waitFor(() => expect(result.current.pendingAction).toBe('save-gemini'));
        await expect(result.current.saveCredential('gemini', 'second')).rejects.toThrow('ADMIN_CREDENTIAL_OPERATION_PENDING');

        act(() => { useAuthStore.setState((state) => ({ session: { ...state.session, user: null, isAuthenticated: false } })); });
        await waitFor(() => expect(signal?.aborted).toBe(true));
        expect(client.saveCredential).toHaveBeenCalledTimes(1);
        expect(queryClient.getQueryData(PRISMA_CREDENTIAL_METADATA_QUERY_KEY)).toBeUndefined();
        void first.catch(() => undefined);
    });

    it('treats Telegram stop timeout as committed deletion and refreshes passive truth without auto-apply', async () => {
        const deleteCredential = vi.fn(async () => {
            throw new AdminAuthError('TELEGRAM_STOP_TIMEOUT', 409, true);
        });
        const { result, client, controller } = setup({ deleteCredential });
        await waitFor(() => expect(result.current.data).not.toBeNull());

        let outcome!: Awaited<ReturnType<typeof result.current.deleteCredential>>;
        await act(async () => { outcome = await result.current.deleteCredential('telegram'); });

        expect(outcome).toEqual({ committed: true, stopUnconfirmed: true });
        expect(client.credentialMetadata).toHaveBeenCalledTimes(2);
        expect(client.telegramHealth).toHaveBeenCalledTimes(2);
        expect(client.applyTelegram).not.toHaveBeenCalled();
        expect(controller.handleProtectedRequestError).not.toHaveBeenCalled();
    });

    it('forwards current authorization errors for centralized reconciliation without replaying mutations', async () => {
        const error = new AdminAuthError('CSRF_VALIDATION_FAILED', 403);
        const saveCredential = vi.fn(async () => { throw error; });
        const { result, controller } = setup({ saveCredential });
        await waitFor(() => expect(result.current.data).not.toBeNull());

        await act(async () => {
            await expect(result.current.saveCredential('gemini', 'synthetic-secret')).rejects.toBe(error);
        });

        expect(saveCredential).toHaveBeenCalledTimes(1);
        expect(controller.handleProtectedRequestError).toHaveBeenCalledWith(error);
    });

    it('does not let a stale metadata success repopulate protected Query data after logout', async () => {
        let release!: (value: typeof metadata) => void;
        const deferred = new Promise<typeof metadata>((resolve) => { release = resolve; });
        const credentialMetadata = vi.fn(() => deferred);
        const { result, queryClient } = setup({ credentialMetadata });
        await waitFor(() => expect(credentialMetadata).toHaveBeenCalledTimes(1));

        act(() => {
            useAuthStore.setState((state) => ({
                session: { ...state.session, user: null, isAuthenticated: false },
            }));
        });
        await act(async () => { release(metadata); await deferred; });

        await waitFor(() => {
            expect(result.current.data).toBeNull();
            expect(queryClient.getQueryData(PRISMA_CREDENTIAL_METADATA_QUERY_KEY)).toBeUndefined();
        });
    });

    it('sanitizes an actual client error before TanStack Query retains it', async () => {
        const canary = 'synthetic-secret-canary';
        const fetcher = vi.fn<typeof fetch>(async (path) => path === '/api/prisma/admin/credentials'
            ? jsonResponse({ ok: false, error: canary, details: { cause: canary }, extra: canary }, 500)
            : healthResponse());
        const client = new AdminAuthClient(fetcher);
        const controller: CredentialAdministrationController = {
            handleProtectedRequestError: vi.fn(async () => undefined),
        };
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const wrapper = ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        renderHook(() => usePrismaCredentialAdministration({ client, controller, active: true }), { wrapper });

        await waitFor(() => expect(queryClient.getQueryCache().find({
            queryKey: PRISMA_CREDENTIAL_METADATA_QUERY_KEY,
            exact: true,
        })?.state.error).toMatchObject({ code: 'AUTH_REQUEST_FAILED', status: 500 }));

        const protectedQuery = queryClient.getQueryCache().find({
            queryKey: PRISMA_CREDENTIAL_METADATA_QUERY_KEY,
            exact: true,
        });
        expect(JSON.stringify(protectedQuery?.state.error)).not.toContain(canary);
        expect(JSON.stringify(protectedQuery?.state.data) ?? '').not.toContain(canary);
        expect(JSON.stringify(queryClient.getMutationCache().getAll())).not.toContain(canary);
    });

    it('purges protected metadata when RequirePermission unmounts before an unauthenticated hook render', async () => {
        const user = userEvent.setup();
        let metadataRequest = 0;
        let releaseLate!: (response: Response) => void;
        const lateMetadata = new Promise<Response>((resolve) => { releaseLate = resolve; });
        const fetcher = vi.fn<typeof fetch>((path) => {
            if (path === '/api/prisma/health') return Promise.resolve(healthResponse());
            if (path === '/api/prisma/admin/credentials') {
                metadataRequest += 1;
                if (metadataRequest === 1) {
                    return Promise.resolve(jsonResponse({
                        ok: true,
                        providers: { gemini: { configured: false }, telegram: { configured: true } },
                    }));
                }
                if (metadataRequest === 2) return lateMetadata;
                return Promise.resolve(jsonResponse({
                    ok: true,
                    providers: { gemini: { configured: true }, telegram: { configured: true } },
                }));
            }
            throw new Error(`Unexpected path: ${String(path)}`);
        });
        const client = new AdminAuthClient(fetcher);
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={['/admin']}>
                    <Routes>
                        <Route path="/" element={<ViewerRoute />} />
                        <Route path="/admin" element={(
                            <RequirePermission permission="admin:access">
                                <CredentialRouteProbe client={client} />
                            </RequirePermission>
                        )} />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>,
        );
        expect(await screen.findByText('gemini:false')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Refresh protected metadata' }));
        await waitFor(() => expect(metadataRequest).toBe(2));

        act(() => {
            useAuthStore.setState((state) => ({
                session: { ...state.session, user: null, isAuthenticated: false },
            }));
        });
        expect(await screen.findByText('Viewer route')).toBeInTheDocument();
        await act(async () => {
            releaseLate(jsonResponse({
                ok: true,
                providers: { gemini: { configured: false }, telegram: { configured: true } },
            }));
            await lateMetadata;
        });

        expect(queryClient.getQueryData(PRISMA_CREDENTIAL_METADATA_QUERY_KEY)).toBeUndefined();
        expect(queryClient.getQueryCache().find({
            queryKey: PRISMA_CREDENTIAL_METADATA_QUERY_KEY,
            exact: true,
        })).toBeUndefined();

        await user.click(screen.getByRole('button', { name: 'Return to admin' }));
        expect(await screen.findByText('gemini:true')).toBeInTheDocument();
        expect(metadataRequest).toBe(3);
    });

    it('rejects a stale successful operation after panel deactivation even when the client ignores abort', async () => {
        let releaseSave!: () => void;
        const pendingSave = new Promise<void>((resolve) => { releaseSave = resolve; });
        const client: CredentialAdministrationClient = {
            credentialMetadata: vi.fn(async () => metadata),
            telegramHealth: vi.fn(async () => health),
            saveCredential: vi.fn(() => pendingSave),
            deleteCredential: vi.fn(async () => undefined),
            applyTelegram: vi.fn(async () => applied),
        };
        const controller: CredentialAdministrationController = { handleProtectedRequestError: vi.fn(async () => undefined) };
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const wrapper = ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        const hook = renderHook(
            ({ active }) => usePrismaCredentialAdministration({ client, controller, active }),
            { wrapper, initialProps: { active: true } },
        );
        await waitFor(() => expect(hook.result.current.data).not.toBeNull());
        let operation!: Promise<void>;
        act(() => { operation = hook.result.current.saveCredential('gemini', 'synthetic-secret'); });
        await waitFor(() => expect(hook.result.current.pendingAction).toBe('save-gemini'));

        hook.rerender({ active: false });
        await waitFor(() => expect(hook.result.current.pendingAction).toBeNull());
        hook.rerender({ active: true });
        releaseSave();

        await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    });
});
