import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PRISMA_ORB_STORAGE_KEY } from '../../config/prismaOrb.config';
import { createDefaultPrismaVoiceConfig } from '../../domain/prismaVoiceConfig';
import { adminAuthClient } from '../../services/adminAuth.service';
import { UNAUTHENTICATED_SESSION, useAuthStore } from '../../store/auth.store';
import GlobalSettingsDialog from './GlobalSettingsDialog';

vi.mock('./ConnectionSettingsTab', () => ({ default: () => null }));
vi.mock('./DesignSettingsTab', () => ({ default: () => null }));
vi.mock('./LoaderOptionsSettingsTab', () => ({ default: () => null }));
vi.mock('./TemporalSettingsTab', () => ({ default: () => null }));
vi.mock('../../vendor/leda-orb.js', () => ({}));

class MockLedaOrb extends HTMLElement {
    public level = 0;
    public setSpeaking(): void {}
}
if (!customElements.get('leda-orb')) customElements.define('leda-orb', MockLedaOrb);

function envelope(config = createDefaultPrismaVoiceConfig()): Response {
    return { ok: true, status: 200, json: async () => ({ config, sync: { configured: false, verified: false } }) } as Response;
}

function renderDialog() {
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    return render(<QueryClientProvider client={client}><DialogHarness /></QueryClientProvider>);
}

describe('GlobalSettingsDialog unified voice integration', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('hmi-global-settings-tab', 'voice');
    });
    afterEach(() => {
        adminAuthClient.clearPrivateSession();
        useAuthStore.setState({ session: UNAUTHENTICATED_SESSION, isHydrated: false, isAuthenticating: false, error: null });
        localStorage.clear();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
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

    it('keeps credential drafts outside global Save and clears them when the dialog closes', async () => {
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
        const input = await screen.findByLabelText('Credencial Gemini');
        await waitFor(() => expect(input).toBeEnabled());

        await user.type(input, 'synthetic-secret');
        expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'Cerrar' }));
        await user.click(screen.getByRole('button', { name: 'Reopen' }));

        expect(await screen.findByLabelText('Credencial Gemini')).toHaveValue('');
    });
});
