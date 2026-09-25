import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CredentialAdministrationClient, CredentialAdministrationController } from './usePrismaCredentialAdministration';
import { PRISMA_CHANNEL_A_STATUS_QUERY_KEY, PRISMA_CREDENTIAL_METADATA_QUERY_KEY, usePrismaCredentialAdministration } from './usePrismaCredentialAdministration';
import { AdminAuthClient, AdminAuthError } from '../services/adminAuth.service';
import type { ChannelAAdministrationStatus, GeminiCredentialProviderMetadata } from '../domain';
import { useAuthStore } from '../store/auth.store';
import RequirePermission from '../components/auth/RequirePermission';

const GEMINI_MODEL = 'gemini-3.1-flash-tts-preview';
const GEMINI_NOT_CHECKED = {
    configured: false, verified: false, verification: { state: 'not_checked', checkedAt: null }, model: GEMINI_MODEL,
} as const;
const TELEGRAM_TOKEN_NOT_CHECKED = { state: 'not_checked', checkedAt: null, username: null } as const;
const metadata = {
    gemini: GEMINI_NOT_CHECKED,
    telegram: { configured: true, verified: false, verification: TELEGRAM_TOKEN_NOT_CHECKED },
    telegram_channel_a: { configured: false, verified: false, verification: TELEGRAM_TOKEN_NOT_CHECKED },
};
const health = {
    enabled: true, configured: true, running: true, verified: false,
    desiredGeneration: 2, appliedGeneration: 1, restartRequired: true,
    configurationError: null, lastError: null, botUsername: null,
} as const;
const applied = {
    source: 'protected', enabled: true, configured: true,
    desiredGeneration: 2, appliedGeneration: 2, running: true,
    verified: true, restartRequired: false, lastError: null, botUsername: null,
} as const;
// Canonical seven-key channel A status (T10 adds botUsername) with nullable
// generations/activation and lowercase backend phases; mirrors the frozen
// domain parser contract.
const channelAIdle = {
    configured: false,
    desiredGeneration: 1,
    appliedGeneration: null,
    activationEpoch: null,
    activation: null,
    lastError: null,
    botUsername: null,
    paired: false,
} as const;
const channelARunning = {
    configured: true,
    desiredGeneration: 4,
    appliedGeneration: 4,
    activationEpoch: 2,
    activation: { phase: 'running', reason: null, quiescent: false, restartRequired: false },
    lastError: null,
    botUsername: 'prisma_channel_a_bot',
    paired: false,
} as const;
const geminiVerified = {
    configured: true, verified: true, verification: { state: 'verified', checkedAt: 1_700_000_000 },
} as const;
const telegramVerified = {
    configured: true, verified: true,
    verification: { state: 'verified', checkedAt: 1_700_000_000, username: 'prisma_bot' },
} as const;
const channelAVerified = {
    configured: true, verified: true,
    verification: { state: 'verified', checkedAt: 1_700_000_001, username: 'prisma_channel_a_bot' },
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
        channelAStatus: vi.fn(async () => channelAIdle),
        applyChannelA: vi.fn(async () => channelARunning),
        verifyGemini: vi.fn(async () => geminiVerified),
        verifyTelegram: vi.fn(async () => telegramVerified),
        verifyChannelA: vi.fn(async () => channelAVerified),
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

// Same client/controller defaults as setup, but the hook renders with a mutable
// active flag so tests can deactivate the panel and observe cancellation.
function setupWithActiveFlag(clientOverrides: Partial<CredentialAdministrationClient> = {}) {
    const client: CredentialAdministrationClient = {
        credentialMetadata: vi.fn(async () => metadata),
        telegramHealth: vi.fn(async () => health),
        saveCredential: vi.fn(async () => ({ provider: 'gemini', configured: true })),
        deleteCredential: vi.fn(async () => undefined),
        applyTelegram: vi.fn(async () => applied),
        channelAStatus: vi.fn(async () => channelAIdle),
        applyChannelA: vi.fn(async () => channelARunning),
        verifyGemini: vi.fn(async () => geminiVerified),
        verifyTelegram: vi.fn(async () => telegramVerified),
        verifyChannelA: vi.fn(async () => channelAVerified),
        ...clientOverrides,
    };
    const controller: CredentialAdministrationController = { handleProtectedRequestError: vi.fn(async () => undefined) };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
        ({ active }) => usePrismaCredentialAdministration({ client, controller, active }),
        { wrapper, initialProps: { active: true } },
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
        telegramBotUsername: null,
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

    it('forwards the channel A credential save and delete to the injected client without applying Telegram', async () => {
        const secret = 'synthetic-channel-a-secret';
        const saveCredential = vi.fn(async () => ({ provider: 'telegram_channel_a' as const, configured: true }));
        const deleteCredential = vi.fn(async () => undefined);
        const { result, client } = setup({ saveCredential, deleteCredential });
        await waitFor(() => expect(result.current.data).not.toBeNull());

        await act(async () => { await result.current.saveCredential('telegram_channel_a', secret); });
        await act(async () => { await result.current.deleteCredential('telegram_channel_a'); });

        expect(saveCredential).toHaveBeenCalledWith('telegram_channel_a', secret, expect.any(AbortSignal));
        expect(deleteCredential).toHaveBeenCalledWith('telegram_channel_a', expect.any(AbortSignal));
        expect(client.applyTelegram).not.toHaveBeenCalled();
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
        await waitFor(() => expect(result.current.pendingActions.gemini).toBe('save-gemini'));
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

    it('keeps a channel identity collision as an uncommitted apply failure without refreshing metadata', async () => {
        const collision = new AdminAuthError('TELEGRAM_BOT_IDENTITY_RESERVED', 409, false);
        const applyTelegram = vi.fn(async () => { throw collision; });
        const { result, client, controller } = setup({ applyTelegram });
        await waitFor(() => expect(result.current.data).not.toBeNull());

        await act(async () => {
            await expect(result.current.applyTelegram()).rejects.toBe(collision);
        });

        expect(applyTelegram).toHaveBeenCalledTimes(1);
        expect(client.credentialMetadata).toHaveBeenCalledTimes(1);
        expect(client.telegramHealth).toHaveBeenCalledTimes(1);
        expect(client.deleteCredential).not.toHaveBeenCalled();
        expect(client.saveCredential).not.toHaveBeenCalled();
        expect(controller.handleProtectedRequestError).toHaveBeenCalledWith(collision);
        expect(result.current.pendingActions.telegram).toBeNull();
        expect(result.current.error).toBeNull();
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

    it('does not start the channel A status refresh after authority is revoked mid-refresh', async () => {
        let releaseSecondMetadata!: (value: typeof metadata) => void;
        const heldSecondMetadata = new Promise<typeof metadata>((resolve) => { releaseSecondMetadata = resolve; });
        let metadataRequest = 0;
        const credentialMetadata = vi.fn((): Promise<typeof metadata> => {
            metadataRequest += 1;
            return metadataRequest === 1 ? Promise.resolve(metadata) : heldSecondMetadata;
        });
        const channelAStatus = vi.fn(async () => channelAIdle);
        const { result, queryClient } = setup({ credentialMetadata, channelAStatus });
        await waitFor(() => expect(result.current.data).not.toBeNull());

        let refreshPromise!: Promise<void>;
        act(() => { refreshPromise = result.current.refresh(); });
        await waitFor(() => expect(credentialMetadata).toHaveBeenCalledTimes(2));
        // Captured dynamically before logout so a valid parallel refresh that
        // already initiated the A query while still authorized can also pass.
        const channelAStatusCallsAtLogout = channelAStatus.mock.calls.length;

        act(() => {
            useAuthStore.setState((state) => ({
                session: { ...state.session, user: null, isAuthenticated: false },
            }));
        });

        // Failsafe settlement: the awaited metadata refetch may already have
        // been cancelled by the logout purge, and releasing the held deferred
        // must never hang this test.
        await act(async () => {
            releaseSecondMetadata(metadata);
            await refreshPromise.catch(() => undefined);
        });

        expect(channelAStatus.mock.calls.length).toBe(channelAStatusCallsAtLogout);
        expect(queryClient.getQueryData(PRISMA_CHANNEL_A_STATUS_QUERY_KEY)).toBeUndefined();
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
            if (path === '/api/prisma/admin/credentials/telegram_channel_a/status') {
                return Promise.resolve(jsonResponse({ ok: true, channelA: channelAIdle }));
            }
            if (path === '/api/prisma/admin/credentials') {
                metadataRequest += 1;
                if (metadataRequest === 1) {
                    return Promise.resolve(jsonResponse({
                        ok: true,
                        providers: {
                            gemini: GEMINI_NOT_CHECKED,
                            telegram: { configured: true, verified: false, verification: TELEGRAM_TOKEN_NOT_CHECKED },
                            telegram_channel_a: { configured: false, verified: false, verification: TELEGRAM_TOKEN_NOT_CHECKED },
                        },
                    }));
                }
                if (metadataRequest === 2) return lateMetadata;
                return Promise.resolve(jsonResponse({
                    ok: true,
                    providers: {
                        gemini: { ...GEMINI_NOT_CHECKED, configured: true },
                        telegram: { configured: true, verified: false, verification: TELEGRAM_TOKEN_NOT_CHECKED },
                        telegram_channel_a: { configured: false, verified: false, verification: TELEGRAM_TOKEN_NOT_CHECKED },
                    },
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
                providers: {
                    gemini: GEMINI_NOT_CHECKED,
                    telegram: { configured: true, verified: false, verification: TELEGRAM_TOKEN_NOT_CHECKED },
                    telegram_channel_a: { configured: false, verified: false, verification: TELEGRAM_TOKEN_NOT_CHECKED },
                },
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
            channelAStatus: vi.fn(async () => channelAIdle),
            applyChannelA: vi.fn(async () => channelARunning),
        verifyGemini: vi.fn(async () => geminiVerified),
        verifyTelegram: vi.fn(async () => telegramVerified),
        verifyChannelA: vi.fn(async () => channelAVerified),
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
        await waitFor(() => expect(hook.result.current.pendingActions.gemini).toBe('save-gemini'));

        hook.rerender({ active: false });
        await waitFor(() => expect(hook.result.current.pendingActions.gemini).toBeNull());
        hook.rerender({ active: true });
        releaseSave();

        await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('resolves the channel A status into its own query key and returned fields', async () => {
        const channelAStatus = vi.fn(async () => channelARunning);
        const { result, client, queryClient } = setup({ channelAStatus });

        await waitFor(() => expect(result.current.channelA).toEqual(channelARunning));

        expect(result.current.channelAError).toBeNull();
        expect(result.current.isChannelALoading).toBe(false);
        expect(channelAStatus).toHaveBeenCalledWith(expect.any(AbortSignal));
        expect(queryClient.getQueryData(PRISMA_CHANNEL_A_STATUS_QUERY_KEY)).toEqual(channelARunning);
        expect(client.applyChannelA).not.toHaveBeenCalled();
    });

    it('enables the channel A status query only for an active authenticated admin', async () => {
        act(() => {
            useAuthStore.setState((state) => ({ session: { ...state.session, user: null, isAuthenticated: false } }));
        });
        const { result, client } = setup();
        await act(async () => {});
        expect(client.channelAStatus).not.toHaveBeenCalled();

        act(() => { authenticated(); });

        await waitFor(() => expect(result.current.channelA).toEqual(channelAIdle));
        expect(client.channelAStatus).toHaveBeenCalledTimes(1);
    });

    it('cancels the in-flight channel A status query when the panel deactivates', async () => {
        let signal: AbortSignal | undefined;
        const channelAStatus = vi.fn((requestSignal?: AbortSignal): Promise<ChannelAAdministrationStatus> => {
            if (requestSignal) signal = requestSignal;
            return new Promise<ChannelAAdministrationStatus>(() => undefined);
        });
        const { rerender } = setupWithActiveFlag({ channelAStatus });
        await waitFor(() => expect(signal).toBeDefined());

        rerender({ active: false });

        await waitFor(() => expect(signal?.aborted).toBe(true));
    });

    it('isolates a channel A status failure so the existing Gemini/B metadata stays usable', async () => {
        const failure = new AdminAuthError('PRISMA_CHANNEL_A_MANAGER_UNAVAILABLE', 503, false);
        const { result } = setup({ channelAStatus: vi.fn(async () => { throw failure; }) });

        await waitFor(() => expect(result.current.channelAError).toBe(failure));

        expect(result.current.data).toEqual({ credentials: metadata, telegram: health });
        expect(result.current.error).toBeNull();
        expect(result.current.channelA).toBeNull();
    });

    it('makes the manual refresh fetch the channel A status alongside Gemini/B metadata', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.channelA).toEqual(channelAIdle));

        await act(async () => { await result.current.refresh(); });

        expect(client.credentialMetadata).toHaveBeenCalledTimes(2);
        expect(client.telegramHealth).toHaveBeenCalledTimes(2);
        expect(client.channelAStatus).toHaveBeenCalledTimes(2);
    });

    it('reconciles channel A metadata and status after an A save without auto-applying', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.data).not.toBeNull());

        await act(async () => { await result.current.saveCredential('telegram_channel_a', 'synthetic-secret'); });

        expect(client.credentialMetadata).toHaveBeenCalledTimes(2);
        expect(client.telegramHealth).toHaveBeenCalledTimes(2);
        expect(client.channelAStatus).toHaveBeenCalledTimes(2);
        expect(client.applyChannelA).not.toHaveBeenCalled();
        expect(client.applyTelegram).not.toHaveBeenCalled();
    });

    it('reconciles the channel A status after an explicit A apply without touching Telegram apply', async () => {
        const { result, client } = setup({ channelAStatus: vi.fn(async () => channelARunning) });
        await waitFor(() => expect(result.current.channelA).toEqual(channelARunning));

        await act(async () => { await result.current.applyChannelA(); });

        expect(client.applyChannelA).toHaveBeenCalledWith(expect.any(AbortSignal));
        expect(client.applyTelegram).not.toHaveBeenCalled();
        expect(client.channelAStatus).toHaveBeenCalledTimes(2);
        expect(client.credentialMetadata).toHaveBeenCalledTimes(2);
    });

    it('verifies the Gemini credential through its own per-provider in-flight flag and refreshes metadata', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.data).not.toBeNull());

        let operation!: Promise<void>;
        act(() => { operation = result.current.verifyGemini(); });
        await waitFor(() => expect(result.current.verifyingProviders.gemini).toBe(true));
        // T15: verification never touches the per-provider mutation lock --
        // it must never disable this (or another) row's Save/Delete/Verify.
        expect(result.current.pendingActions.gemini).toBeNull();
        await act(async () => { await operation; });

        expect(client.verifyGemini).toHaveBeenCalledWith(expect.any(AbortSignal));
        expect(client.credentialMetadata).toHaveBeenCalledTimes(2);
        expect(result.current.verifyingProviders.gemini).toBe(false);
    });

    it('rejects a second concurrent Gemini verification while one is already pending', async () => {
        const pending = new Promise<GeminiCredentialProviderMetadata>(() => undefined);
        const { result } = setup({ verifyGemini: vi.fn(() => pending) });
        await waitFor(() => expect(result.current.data).not.toBeNull());

        let first!: Promise<void>;
        act(() => { first = result.current.verifyGemini(); });
        await waitFor(() => expect(result.current.verifyingProviders.gemini).toBe(true));

        await expect(result.current.verifyGemini()).rejects.toThrow('ADMIN_CREDENTIAL_VERIFY_OPERATION_PENDING');
        void first.catch(() => undefined);
    });

    it('propagates a Gemini verification failure without refreshing metadata', async () => {
        const failure = new AdminAuthError('GEMINI_VERIFICATION_IN_PROGRESS', 409, false);
        const verifyGemini = vi.fn(async () => { throw failure; });
        const { result, client } = setup({ verifyGemini });
        await waitFor(() => expect(result.current.data).not.toBeNull());

        await act(async () => {
            await expect(result.current.verifyGemini()).rejects.toBe(failure);
        });

        expect(client.credentialMetadata).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['telegram', 'verifyTelegram'] as const,
        ['telegram_channel_a', 'verifyChannelA'] as const,
    ])('verifies the %s bot token through its own per-provider in-flight flag and refreshes metadata', async (
        provider, method,
    ) => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.data).not.toBeNull());

        let operation!: Promise<unknown>;
        act(() => { operation = result.current[method](); });
        await waitFor(() => expect(result.current.verifyingProviders[provider]).toBe(true));
        // T15: another row's verify (Gemini here) must stay usable while
        // this one is in flight -- no shared/global in-flight flag.
        expect(result.current.verifyingProviders.gemini).toBe(false);
        expect(result.current.pendingActions[provider]).toBeNull();
        await act(async () => { await operation; });

        expect(client[method]).toHaveBeenCalledWith(expect.any(AbortSignal));
        expect(client.credentialMetadata).toHaveBeenCalledTimes(2);
        expect(result.current.verifyingProviders[provider]).toBe(false);
    });

    it.each([
        ['telegram', 'verifyTelegram'] as const,
        ['telegram_channel_a', 'verifyChannelA'] as const,
    ])('rejects a second concurrent %s verification while one is already pending', async (provider, method) => {
        const pending = new Promise<never>(() => undefined);
        const { result } = setup({ [method]: vi.fn(() => pending) });
        await waitFor(() => expect(result.current.data).not.toBeNull());

        let first!: Promise<unknown>;
        act(() => { first = result.current[method](); });
        await waitFor(() => expect(result.current.verifyingProviders[provider]).toBe(true));

        await expect(result.current[method]()).rejects.toThrow('ADMIN_CREDENTIAL_VERIFY_OPERATION_PENDING');
        void first.catch(() => undefined);
    });

    it('verifying one provider never disables another row\'s save/delete (no shared global lock)', async () => {
        const pending = new Promise<never>(() => undefined);
        const { result } = setup({ verifyChannelA: vi.fn(() => pending) });
        await waitFor(() => expect(result.current.data).not.toBeNull());

        let verifying!: Promise<unknown>;
        act(() => { verifying = result.current.verifyChannelA(); });
        await waitFor(() => expect(result.current.verifyingProviders.telegram_channel_a).toBe(true));

        // The per-provider mutation lock (pendingActions, used by
        // save/delete/apply) stays untouched by a verify, so another row's
        // save/delete is free -- and, per T15/F4, so is every OTHER row's
        // mutation lock, since save/delete are now scoped per provider too.
        expect(result.current.pendingActions.telegram_channel_a).toBeNull();
        expect(result.current.pendingActions.gemini).toBeNull();
        await act(async () => { await result.current.saveCredential('gemini', 'unrelated-secret'); });

        void verifying.catch(() => undefined);
    });

    // F4 regression (2026-09-25 live test): saveCredential/deleteCredential
    // used one single GLOBAL operationRef/pendingAction shared by every
    // provider (unlike verify, already scoped per provider since T15), so
    // saving or deleting one row's credential blocked every OTHER row's
    // save/delete/verify too. Scoped exactly like T15 scoped verify.
    it('saving one provider never blocks another provider\'s save/delete (no shared global mutation lock)', async () => {
        const pending = new Promise<never>(() => undefined);
        // Provider-aware: only the channel A save hangs, so the later
        // gemini/telegram calls below can actually resolve and prove they
        // were never blocked by channel A's still-pending save.
        const saveCredential = vi.fn((provider: string) => (provider === 'telegram_channel_a'
            ? pending
            : Promise.resolve({ provider, configured: true })));
        const { result } = setup({ saveCredential });
        await waitFor(() => expect(result.current.data).not.toBeNull());

        let saving!: Promise<unknown>;
        act(() => { saving = result.current.saveCredential('telegram_channel_a', 'channel-a-secret'); });
        await waitFor(() => expect(result.current.pendingActions.telegram_channel_a).toBe('save-telegram_channel_a'));

        // Every other provider's own operation slot stays completely free.
        expect(result.current.pendingActions.gemini).toBeNull();
        expect(result.current.pendingActions.telegram).toBeNull();
        await act(async () => { await result.current.deleteCredential('gemini'); });
        await act(async () => { await result.current.saveCredential('telegram', 'telegram-token'); });

        void saving.catch(() => undefined);
    });

    it('deleting one provider never blocks another provider\'s save/delete', async () => {
        const pending = new Promise<never>(() => undefined);
        const { result } = setup({ deleteCredential: vi.fn(() => pending) });
        await waitFor(() => expect(result.current.data).not.toBeNull());

        let deleting!: Promise<unknown>;
        act(() => { deleting = result.current.deleteCredential('telegram'); });
        await waitFor(() => expect(result.current.pendingActions.telegram).toBe('delete-telegram'));

        expect(result.current.pendingActions.gemini).toBeNull();
        expect(result.current.pendingActions.telegram_channel_a).toBeNull();
        await act(async () => { await result.current.saveCredential('gemini', 'gemini-secret'); });

        void deleting.catch(() => undefined);
    });

    it('rejects a second concurrent save on the SAME provider while one is already pending (unchanged same-row guard)', async () => {
        const pending = new Promise<never>(() => undefined);
        const { result } = setup({ saveCredential: vi.fn(() => pending) });
        await waitFor(() => expect(result.current.data).not.toBeNull());

        let first!: Promise<unknown>;
        act(() => { first = result.current.saveCredential('telegram', 'first-token'); });
        await waitFor(() => expect(result.current.pendingActions.telegram).toBe('save-telegram'));

        await expect(result.current.saveCredential('telegram', 'second-token'))
            .rejects.toThrow('ADMIN_CREDENTIAL_OPERATION_PENDING');
        void first.catch(() => undefined);
    });

    it.each([
        ['telegram', 'verifyTelegram', 'TELEGRAM_VERIFICATION_IN_PROGRESS'] as const,
        ['telegram_channel_a', 'verifyChannelA', 'PRISMA_CHANNEL_A_VERIFICATION_IN_PROGRESS'] as const,
    ])('propagates a %s verification failure without refreshing metadata', async (_provider, method, code) => {
        const failure = new AdminAuthError(code, 409, false);
        const { result, client } = setup({ [method]: vi.fn(async () => { throw failure; }) });
        await waitFor(() => expect(result.current.data).not.toBeNull());

        await act(async () => {
            await expect(result.current[method]()).rejects.toBe(failure);
        });

        expect(client.credentialMetadata).toHaveBeenCalledTimes(1);
    });

    it('discards a same-row verify result that resolves after a save has already reset it (T15 staleness guard)', async () => {
        let releaseVerify!: (value: typeof channelAVerified) => void;
        const pendingVerify = new Promise<typeof channelAVerified>((resolve) => { releaseVerify = resolve; });
        const verifyChannelA = vi.fn(() => pendingVerify);
        const { result } = setup({ verifyChannelA });
        await waitFor(() => expect(result.current.data).not.toBeNull());

        let verifying!: Promise<unknown>;
        act(() => { verifying = result.current.verifyChannelA(); });
        await waitFor(() => expect(result.current.verifyingProviders.telegram_channel_a).toBe(true));
        void verifying.catch(() => undefined);

        // Allowed: a same-row save while its own verify is still in flight.
        await act(async () => { await result.current.saveCredential('telegram_channel_a', 'new-channel-a-secret'); });

        // The verify call now resolves late; its result must never be applied.
        await act(async () => { releaseVerify(channelAVerified); });

        await expect(verifying).rejects.toMatchObject({ name: 'AbortError' });
        expect(result.current.verifyingProviders.telegram_channel_a).toBe(false);
    });

    it('treats a committed channel A stop-unconfirmed deletion as committed and refreshes without auto-apply', async () => {
        const deleteCredential = vi.fn(async () => {
            throw new AdminAuthError('PRISMA_CHANNEL_A_STOP_UNCONFIRMED', 409, true);
        });
        const { result, client, controller } = setup({ deleteCredential });
        await waitFor(() => expect(result.current.data).not.toBeNull());

        let outcome!: Awaited<ReturnType<typeof result.current.deleteCredential>>;
        await act(async () => { outcome = await result.current.deleteCredential('telegram_channel_a'); });

        expect(outcome).toEqual({ committed: true, stopUnconfirmed: true });
        expect(client.credentialMetadata).toHaveBeenCalledTimes(2);
        expect(client.telegramHealth).toHaveBeenCalledTimes(2);
        expect(client.channelAStatus).toHaveBeenCalledTimes(2);
        expect(client.applyChannelA).not.toHaveBeenCalled();
        expect(controller.handleProtectedRequestError).not.toHaveBeenCalled();
    });

    it('keeps an uncommitted channel A conflict as a plain failure without posing as a committed deletion', async () => {
        const conflict = new AdminAuthError('PRISMA_CHANNEL_A_STOP_UNCONFIRMED', 409, false);
        const deleteCredential = vi.fn(async () => { throw conflict; });
        const { result, client } = setup({ deleteCredential });
        await waitFor(() => expect(result.current.data).not.toBeNull());

        await act(async () => {
            await expect(result.current.deleteCredential('telegram_channel_a')).rejects.toBe(conflict);
        });

        expect(client.credentialMetadata).toHaveBeenCalledTimes(1);
        expect(client.telegramHealth).toHaveBeenCalledTimes(1);
        expect(client.channelAStatus).toHaveBeenCalledTimes(1);
    });

    it('purges the channel A status cache on logout and never restores a stale late status result', async () => {
        let release!: (value: ChannelAAdministrationStatus) => void;
        const pending = new Promise<ChannelAAdministrationStatus>((resolve) => { release = resolve; });
        const { result, queryClient } = setup({ channelAStatus: vi.fn(() => pending) });
        await waitFor(() => expect(result.current.data).not.toBeNull());

        act(() => {
            useAuthStore.setState((state) => ({ session: { ...state.session, user: null, isAuthenticated: false } }));
        });
        await act(async () => { release(channelARunning); await pending; });

        await waitFor(() => {
            expect(result.current.channelA).toBeNull();
            expect(queryClient.getQueryData(PRISMA_CHANNEL_A_STATUS_QUERY_KEY)).toBeUndefined();
        });
    });
});
