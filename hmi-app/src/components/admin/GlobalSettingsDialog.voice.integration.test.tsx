import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PRISMA_ORB_STORAGE_KEY } from '../../config/prismaOrb.config';
import { createDefaultPrismaVoiceConfig } from '../../domain/prismaVoiceConfig';
import { adminAuthClient, AdminAuthClient } from '../../services/adminAuth.service';
import { UNAUTHENTICATED_SESSION, useAuthStore } from '../../store/auth.store';
import GlobalSettingsDialog from './GlobalSettingsDialog';

const nameBoundary = vi.hoisted(() => {
    const storage = (): Storage => {
        const bytes = new Map<string, string>();
        return {
            get length() { return bytes.size; }, clear: () => bytes.clear(),
            key: (index) => [...bytes.keys()][index] ?? null,
            getItem: (key) => bytes.get(key) ?? null,
            setItem: (key, value) => { bytes.set(key, value); },
            removeItem: (key) => { bytes.delete(key); },
        };
    };
    vi.stubGlobal('localStorage', storage());
    vi.stubGlobal('sessionStorage', storage());
    return { refused: [] as string[] };
});

afterAll(() => vi.unstubAllGlobals());

vi.mock('./ConnectionSettingsTab', () => ({ default: () => null }));
vi.mock('./DesignSettingsTab', () => ({ default: () => null }));
vi.mock('./LoaderOptionsSettingsTab', () => ({ default: () => null }));
vi.mock('./TemporalSettingsTab', () => ({ default: () => null }));
vi.mock('../../vendor/leda-orb.js', () => ({}));

// adminAuth.service binds `fetch` while the module is being imported, so a later
// `vi.stubGlobal('fetch', ...)` can never intercept the module singleton. Bind the
// singleton to a controllable dispatcher instead: it records every call, answers
// only the paths a test wires on purpose, and refuses anything else without
// touching the network. Every refusal -- whether there is no handler at all or a
// configured handler rejects an unexpected path -- is recorded here, before the
// rejection propagates, so production catches cannot hide it. Refusals are
// asserted in afterEach, outside every component and provider catch, so an
// unexpected dispatch cannot pass silently.
const singletonNetwork = vi.hoisted(() => {
    const refusableError = 'TEST_SINGLETON_FETCH_REFUSED';
    const requests: string[] = [];
    const refusals: string[] = [];
    let handler: ((path: string, init?: RequestInit) => Promise<Response>) | null = null;
    const fetcher = (async (path: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const key = `${init?.method ?? 'GET'} ${String(path)}`;
        requests.push(key);
        if (!handler) {
            refusals.push(key);
            throw new Error(refusableError);
        }
        try {
            return await handler(String(path), init);
        } catch (error) {
            // A configured handler refuses an unwired route by rejecting with the
            // fixed refusal error. Record it here, once, before it reaches the
            // production catch that would otherwise swallow it.
            if (error instanceof Error && error.message === refusableError) refusals.push(key);
            throw error;
        }
    }) as typeof fetch;
    return {
        requests,
        refusals,
        fetcher,
        setHandler(next: ((path: string, init?: RequestInit) => Promise<Response>) | null): void {
            handler = next;
        },
        reset(): void {
            requests.length = 0;
            refusals.length = 0;
            handler = null;
        },
    };
});

vi.mock('../../services/adminAuth.service', async () => {
    const actual = await vi.importActual<typeof import('../../services/adminAuth.service')>('../../services/adminAuth.service');
    return {
        ...actual,
        // Real client class and real service path, fed by an injected fake transport.
        adminAuthClient: new actual.AdminAuthClient(singletonNetwork.fetcher),
    };
});

class MockLedaOrb extends HTMLElement {
    public level = 0;
    public setSpeaking(): void {}
}
if (!customElements.get('leda-orb')) customElements.define('leda-orb', MockLedaOrb);

function envelope(config = createDefaultPrismaVoiceConfig()): Response {
    return { ok: true, status: 200, json: async () => ({ config, sync: { configured: false, verified: false } }) } as Response;
}

function guardInjectedFetch() {
    const injected = fetch;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (path, init) => {
        const route = `${init?.method ?? 'GET'} ${String(path)}`;
        if (!['GET /api/prisma/voice-config', 'PUT /api/prisma/voice-config',
            'GET /api/prisma/admin/credentials', 'GET /api/prisma/health'].includes(route)) {
            nameBoundary.refused.push(route);
            throw new Error('TEST_NETWORK_REFUSED');
        }
        return injected(path, init);
    }));
}

function renderDialog() {
    guardInjectedFetch();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    return render(<QueryClientProvider client={client}><GlobalSettingsDialog open onClose={vi.fn()} /></QueryClientProvider>);
}

function DialogHarness() {
    const [open, setOpen] = useState(true);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Reopen</button>
            <GlobalSettingsDialog open={open} onClose={() => setOpen(false)} />
        </>
    );
}

function renderDialogHarness() {
    guardInjectedFetch();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    return render(<QueryClientProvider client={client}><DialogHarness /></QueryClientProvider>);
}

describe('GlobalSettingsDialog unified voice integration', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('hmi-global-settings-tab', 'voice');
    });
    afterEach(() => {
        cleanup();
        try {
            expect(nameBoundary.refused).toEqual([]);
            if (vi.isMockFunction(fetch)) {
                expect(vi.mocked(fetch).mock.calls.filter(([path]) => ![
                    '/api/prisma/voice-config', '/api/prisma/admin/credentials', '/api/prisma/health',
                ].includes(String(path)))).toEqual([]);
            }
            // External assertion: an unexpected singleton dispatch is a hard failure
            // instead of a silently swallowed request.
            expect(singletonNetwork.refusals).toEqual([]);
        } finally {
            adminAuthClient.clearPrivateSession();
            singletonNetwork.reset();
            useAuthStore.setState({ session: UNAUTHENTICATED_SESSION, isHydrated: false, isAuthenticating: false, error: null });
            localStorage.clear();
            // Injected storage remains installed until this isolated file ends.
            vi.restoreAllMocks();
        }
    });

    it('saves the HMI name from Prisma independently of DSP, credentials and the footer', async () => {
        useAuthStore.setState({
            isHydrated: true,
            session: { isAuthenticated: true, loginTimestamp: '2026-01-01T00:00:00Z',
                user: { id: 'test-admin', username: 'admin', displayName: 'Admin',
                    role: { id: 'admin', name: 'Admin', permissions: ['admin:access'] } } },
        });
        vi.spyOn(adminAuthClient, 'credentialMetadata').mockResolvedValue({
            gemini: { configured: false }, telegram: { configured: false }, telegram_channel_a: { configured: false },
        });
        vi.spyOn(adminAuthClient, 'telegramHealth').mockResolvedValue({
            enabled: true, configured: false, running: false, verified: false,
            configurationError: 'TELEGRAM_CREDENTIAL_MISSING', lastError: null,
            desiredGeneration: 1, appliedGeneration: 1, restartRequired: false,
        });
        const fetchMock = vi.fn(async () => envelope());
        vi.stubGlobal('fetch', fetchMock);
        localStorage.setItem('hmi-global-settings-tab', 'connection');
        renderDialogHarness();
        fireEvent.click(screen.getByRole('button', { name: 'Prisma' }));
        const input = await screen.findByLabelText('Nombre de esta HMI');
        expect(input).toBeEnabled();
        fireEvent.change(input, { target: { value: 'Panel recepción' } });
        expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }));
        expect(await screen.findByText('Nombre guardado en este navegador')).toBeInTheDocument();
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
        expect(singletonNetwork.requests).toEqual([]);
        expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
        // Preserve B's existing Apply; naming must not add another Apply.
        expect(screen.getAllByRole('button', { name: /^Aplicar/ })).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Aplicar cambio' })).toBeDisabled();
        expect(localStorage.getItem('hmi:prisma-hmi-name')).toBe(JSON.stringify({ version: 1, name: 'Panel recepción' }));
        fireEvent.change(input, { target: { value: 'Discard on tab switch' } });
        fireEvent.click(screen.getByRole('button', { name: 'Conexion' }));
        fireEvent.click(screen.getByRole('button', { name: 'Prisma' }));
        expect(screen.getByLabelText('Nombre de esta HMI')).toHaveValue('Panel recepción');
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
        fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
        expect(await screen.findByLabelText('Nombre de esta HMI')).toHaveValue('Panel recepción');
    });

    it('enables shared Save for an effect edit and persists one fixed-route PUT', async () => {
        const fetchMock = vi.fn(async () => envelope());
        vi.stubGlobal('fetch', fetchMock);
        renderDialog();
        const save = screen.getByRole('button', { name: 'Guardar' });
        await waitFor(() => expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('100'));
        expect(save).toBeDisabled();

        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), { target: { value: '65' } });
        await waitFor(() => expect(save).toBeEnabled());
        await userEvent.click(save);

        await waitFor(() => expect(screen.getByText('Guardado')).toBeInTheDocument());
        const puts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
        expect(puts).toHaveLength(1);
        expect(puts[0]?.[0]).toBe('/api/prisma/voice-config');
    });

    it('keeps Save pending until the one PUT resolves', async () => {
        let resolvePut!: (response: Response) => void;
        const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
            init?.method === 'PUT'
                ? new Promise<Response>((resolve) => { resolvePut = resolve; })
                : Promise.resolve(envelope())
        ));
        vi.stubGlobal('fetch', fetchMock);
        renderDialog();
        await waitFor(() => expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('100'));
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), { target: { value: '81' } });

        await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        expect(screen.getByText('Guardando...')).toBeInTheDocument();
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);

        const persisted = createDefaultPrismaVoiceConfig();
        persisted.effectIntensity = 81;
        await act(async () => resolvePut(envelope(persisted)));
        await waitFor(() => expect(screen.getByText('Guardado')).toBeInTheDocument());
    });

    it('does not render a replacement runtime or endpoint selector', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => envelope()));
        renderDialog();
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Efectos de voz de Prisma' })).toBeInTheDocument());

        expect(screen.queryByRole('button', { name: 'Modo de ejecución de Prisma' })).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Endpoint Voz HMI')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Endpoint Configuración Prisma')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('URL Servicio Voz Prisma')).not.toBeInTheDocument();
    });

    it('discards unsaved effect, orb, and preview-only drafts when Close unmounts the tab', async () => {
        const initial = createDefaultPrismaVoiceConfig();
        initial.effectIntensity = 42;
        const fetchMock = vi.fn(async () => envelope(initial));
        vi.stubGlobal('fetch', fetchMock);
        const user = userEvent.setup();
        renderDialogHarness();
        await waitFor(() => expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('42'));

        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), { target: { value: '65' } });
        fireEvent.change(screen.getByRole('slider', { name: 'Velocidad' }), { target: { value: '1.5' } });
        await user.click(screen.getByRole('checkbox', { name: 'Mostrar deslizador' }));
        expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
        await user.click(screen.getByRole('button', { name: 'Cerrar' }));

        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
        expect(localStorage.getItem(PRISMA_ORB_STORAGE_KEY)).toBeNull();
        await user.click(screen.getByRole('button', { name: 'Reopen' }));

        await waitFor(() => expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('42'));
        expect(screen.getByRole('slider', { name: 'Velocidad' })).toHaveValue('1');
        expect(screen.getByRole('slider', { name: 'Penetración de haces' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    });

    it('surfaces the real client channel identity collision as the exact usage message', async () => {
        useAuthStore.setState({
            session: {
                user: { id: 'administrator:admin', username: 'admin', displayName: 'admin', role: { id: 'admin', name: 'Admin', permissions: ['admin:access'] } },
                isAuthenticated: true,
                loginTimestamp: new Date().toISOString(),
                absoluteExpiresAt: Math.floor(Date.now() / 1_000) + 600,
            },
            isHydrated: true,
        });
        const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
        });
        const csrfToken = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

        // The real client class is still exercised through an injected fake fetch,
        // so the parser/allowlist/route contract is asserted on real service code.
        const contractTransport = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(json({
                ok: true,
                administrator: { username: 'admin' },
                csrfToken,
                absoluteExpiresAt: 2_000_000_000,
            }, 200))
            .mockResolvedValueOnce(json({ ok: false, error: 'TELEGRAM_BOT_IDENTITY_RESERVED' }, 409));
        const contractClient = new AdminAuthClient(contractTransport);
        await contractClient.session();
        await expect(contractClient.applyTelegram()).rejects.toMatchObject({
            code: 'TELEGRAM_BOT_IDENTITY_RESERVED', status: 409, committed: false,
        });
        expect(adminAuthClient).toBeInstanceOf(AdminAuthClient);

        singletonNetwork.setHandler(async (path, init) => {
            if (path === '/api/prisma/admin/auth/session') {
                return json({ ok: true, administrator: { username: 'admin' }, csrfToken, absoluteExpiresAt: 2_000_000_000 }, 200);
            }
            if (path === '/api/prisma/admin/credentials') {
                return json({
                    ok: true,
                    providers: {
                        gemini: { configured: false },
                        telegram: { configured: true },
                        telegram_channel_a: { configured: false },
                    },
                }, 200);
            }
            if (path === '/api/prisma/health') {
                return json({
                    ok: true,
                    telegramEnabled: true,
                    telegramConfigured: true,
                    telegramConnected: false,
                    telegramVerified: false,
                    telegramConfigurationError: null,
                    telegramLastError: null,
                    telegramDesiredGeneration: 2,
                    telegramAppliedGeneration: 0,
                    telegramRestartRequired: true,
                }, 200);
            }
            if (path === '/api/prisma/admin/credentials/telegram/apply' && init?.method === 'POST') {
                return json({ ok: false, error: 'TELEGRAM_BOT_IDENTITY_RESERVED' }, 409);
            }
            // Any other path stays refused and is asserted in afterEach.
            throw new Error('TEST_SINGLETON_FETCH_REFUSED');
        });
        await adminAuthClient.session();
        vi.stubGlobal('fetch', vi.fn(async () => envelope()));
        renderDialog();
        const apply = await screen.findByRole('button', { name: 'Aplicar cambio' });
        await waitFor(() => expect(apply).toBeEnabled());

        await userEvent.click(apply);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Este bot ya está en uso por el otro canal. Configurá un bot distinto.',
        );
        expect(screen.queryByText('Cambio de Telegram aplicado y estado actualizado.')).not.toBeInTheDocument();
        // A collision is a plain failure, not a committed deletion awaiting a retry.
        expect(screen.queryByRole('button', { name: 'Reintentar detención' })).not.toBeInTheDocument();
        expect(singletonNetwork.requests).toContain('GET /api/prisma/admin/auth/session');
        expect(singletonNetwork.requests).toContain('GET /api/prisma/admin/credentials');
        expect(singletonNetwork.requests).toContain('GET /api/prisma/health');
        expect(singletonNetwork.requests).toContain('POST /api/prisma/admin/credentials/telegram/apply');
        expect(singletonNetwork.refusals).toEqual([]);
    });

    it('keeps per-provider credential drafts outside global Save and clears them when the dialog closes', async () => {
        useAuthStore.setState({
            session: {
                user: { id: 'administrator:admin', username: 'admin', displayName: 'admin', role: { id: 'admin', name: 'Admin', permissions: ['admin:access'] } },
                isAuthenticated: true,
                loginTimestamp: new Date().toISOString(),
                absoluteExpiresAt: Math.floor(Date.now() / 1_000) + 600,
            },
            isHydrated: true,
        });
        vi.spyOn(adminAuthClient, 'credentialMetadata').mockResolvedValue({
            gemini: { configured: false },
            telegram: { configured: false },
            telegram_channel_a: { configured: false },
        });
        vi.spyOn(adminAuthClient, 'telegramHealth').mockResolvedValue({
            enabled: true,
            configured: false,
            running: false,
            verified: false,
            configurationError: 'TELEGRAM_CREDENTIAL_MISSING',
            lastError: null,
            desiredGeneration: 1,
            appliedGeneration: 1,
            restartRequired: false,
        });
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            if (input === '/api/prisma/admin/credentials') {
                return new Response(JSON.stringify({
                    ok: true,
                    providers: {
                        gemini: { configured: false },
                        telegram: { configured: false },
                        telegram_channel_a: { configured: false },
                    },
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (input === '/api/prisma/health') {
                return new Response(JSON.stringify({
                    ok: true,
                    telegramEnabled: true,
                    telegramConfigured: false,
                    telegramConnected: false,
                    telegramVerified: false,
                    telegramConfigurationError: 'TELEGRAM_CREDENTIAL_MISSING',
                    telegramLastError: null,
                    telegramDesiredGeneration: 1,
                    telegramAppliedGeneration: 1,
                    telegramRestartRequired: false,
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return envelope();
        }));
        const user = userEvent.setup();
        renderDialogHarness();
        const geminiInput = await screen.findByLabelText('Credencial Gemini');
        const channelAInput = screen.getByLabelText('Credencial Telegram (Canal A)');
        await waitFor(() => expect(geminiInput).toBeEnabled());

        await user.type(geminiInput, 'synthetic-secret');
        await user.type(channelAInput, 'synthetic-channel-a-secret');
        expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'Cerrar' }));
        await user.click(screen.getByRole('button', { name: 'Reopen' }));

        expect(await screen.findByLabelText('Credencial Gemini')).toHaveValue('');
        expect(screen.getByLabelText('Credencial Telegram (Canal A)')).toHaveValue('');
    });

    it('records every refused singleton dispatch exactly once, including a configured handler refusal', async () => {
        // No handler: the missing-handler branch refuses and records without ever
        // consulting the network.
        await singletonNetwork.fetcher('/api/prisma/admin/unmapped').catch(() => undefined);
        expect(singletonNetwork.requests).toEqual(['GET /api/prisma/admin/unmapped']);
        expect(singletonNetwork.refusals).toEqual(['GET /api/prisma/admin/unmapped']);

        // A configured handler that refuses an unexpected route must be recorded
        // too: production code swallows the rejection, so only the injected
        // transport can report the unexpected dispatch to the external afterEach
        // assertion.
        singletonNetwork.setHandler(async () => {
            throw new Error('TEST_SINGLETON_FETCH_REFUSED');
        });
        await singletonNetwork.fetcher('/api/prisma/admin/unmapped/configured', { method: 'POST' }).catch(() => undefined);

        expect(singletonNetwork.requests).toEqual([
            'GET /api/prisma/admin/unmapped',
            'POST /api/prisma/admin/unmapped/configured',
        ]);
        expect(singletonNetwork.refusals).toEqual([
            'GET /api/prisma/admin/unmapped',
            'POST /api/prisma/admin/unmapped/configured',
        ]);
        // The deliberate refusals are consumed here; the shared afterEach keeps
        // guarding every other test with its empty expectation.
        singletonNetwork.reset();
    });
});
