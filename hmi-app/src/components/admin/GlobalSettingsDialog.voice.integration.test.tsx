import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    PRISMA_RUNTIME_MODE_CHANGED_EVENT,
    readPrismaRuntimeMode,
    savePrismaRuntimeMode,
} from '../../config/prismaRuntime.config';
import { createDefaultPrismaVoiceConfig } from '../../domain/prismaVoiceConfig';
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

if (!customElements.get('leda-orb')) {
    customElements.define('leda-orb', MockLedaOrb);
}

function renderDialog() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });

    return render(
        <QueryClientProvider client={queryClient}>
            <GlobalSettingsDialog open onClose={vi.fn()} />
        </QueryClientProvider>,
    );
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
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <DialogHarness />
        </QueryClientProvider>,
    );
}

function successfulConfigResponse(input?: RequestInfo | URL): Response {
    const config = createDefaultPrismaVoiceConfig();
    config.effectIntensity = 42;
    const isLocal = String(input).startsWith('http://127.0.0.1:5057/');
    return {
        ok: true,
        status: 200,
        json: async () => isLocal
            ? {
                config,
                sync: {
                    centralUrlConfigured: false,
                    lastSyncAt: null,
                    lastSyncError: "RuntimeError('PRISMA_CONFIG_URL_MISSING')",
                    source: 'local_fallback',
                },
            }
            : config,
    } as Response;
}

describe('GlobalSettingsDialog voice integration', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('hmi-global-settings-tab', 'voice');
        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://node-red.local');
    });

    afterEach(() => {
        localStorage.clear();
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it.each([
        ['Server', 'central', 'https://node-red.local/hmi/prisma-config'],
        ['Local', 'local', 'http://127.0.0.1:5057/hmi/prisma-config'],
    ] as const)('enables Save for an editable %s voice draft and disables it after persistence', async (_label, mode, expectedUrl) => {
        if (mode === 'local') savePrismaRuntimeMode('local');
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => successfulConfigResponse(input));
        vi.stubGlobal('fetch', fetchMock);
        renderDialog();

        const saveButton = screen.getByRole('button', { name: 'Guardar' });
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
            expectedUrl,
            expect.objectContaining({ method: 'GET' }),
        ));
        await waitFor(() => expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }))
            .toHaveValue('42'));
        expect(screen.queryByText(/No se pudo cargar la configuración .* de Prisma/i)).not.toBeInTheDocument();
        expect(saveButton).toBeDisabled();

        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), {
            target: { value: '65' },
        });

        await waitFor(() => expect(saveButton).toBeEnabled());
        fireEvent.click(saveButton);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
            expectedUrl,
            expect.objectContaining({ method: 'PUT' }),
        ));
        await waitFor(() => expect(saveButton).toBeDisabled());
        expect(screen.getByText('Guardado')).toBeInTheDocument();
    });

    it('sends exactly one Local PUT for one Save click while the real dialog request is pending and after it resolves', async () => {
        savePrismaRuntimeMode('local');
        const loadedConfig = createDefaultPrismaVoiceConfig();
        loadedConfig.effectIntensity = 42;
        let resolvePut!: (response: Response) => void;
        const pendingPut = new Promise<Response>((resolve) => {
            resolvePut = resolve;
        });
        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'PUT') return pendingPut;
            return Promise.resolve(successfulConfigResponse(input));
        });
        vi.stubGlobal('fetch', fetchMock);
        const user = userEvent.setup();
        renderDialog();

        await waitFor(() => expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }))
            .toHaveValue('42'));
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), {
            target: { value: '81' },
        });

        await user.click(screen.getByRole('button', { name: 'Guardar' }));

        const putCallsWhilePending = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
        expect(putCallsWhilePending).toHaveLength(1);
        expect(putCallsWhilePending[0]?.[0]).toBe('http://127.0.0.1:5057/hmi/prisma-config');
        expect(JSON.parse(putCallsWhilePending[0]?.[1]?.body as string).effectIntensity).toBe(81);
        expect(screen.getByText('Guardando...')).toBeInTheDocument();

        const persistedConfig = createDefaultPrismaVoiceConfig();
        persistedConfig.effectIntensity = 81;
        await act(async () => resolvePut({
            ok: true,
            status: 200,
            json: async () => ({
                config: persistedConfig,
                sync: {
                    centralUrlConfigured: false,
                    lastSyncAt: null,
                    lastSyncError: null,
                    source: 'local',
                },
            }),
        } as Response));

        await waitFor(() => expect(screen.getByText('Guardado')).toBeInTheDocument());
        await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled());
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
    });

    it.each([
        ['Server → Local', 'central', 'Server (Node-RED)', 'Local (presentations)'],
        ['Local → Server', 'local', 'Local (presentations)', 'Server (Node-RED)'],
    ] as const)('commits runtime mode transactionally for %s', async (_case, initialMode, initialLabel, nextLabel) => {
        if (initialMode === 'local') savePrismaRuntimeMode('local');
        const runtimeEventSpy = vi.fn();
        window.addEventListener(PRISMA_RUNTIME_MODE_CHANGED_EVENT, runtimeEventSpy);
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => successfulConfigResponse(input));
        vi.stubGlobal('fetch', fetchMock);
        const user = userEvent.setup();
        renderDialog();
        const saveButton = screen.getByRole('button', { name: 'Guardar' });
        const selector = screen.getByRole('button', { name: 'Modo de ejecución de Prisma' });
        await waitFor(() => expect(selector).toHaveTextContent(initialLabel));
        expect(saveButton).toBeDisabled();

        await user.click(selector);
        await user.click(screen.getByRole('button', { name: nextLabel }));

        expect(selector).toHaveTextContent(nextLabel);
        expect(saveButton).toBeEnabled();
        expect(readPrismaRuntimeMode()).toBe(initialMode);
        expect(runtimeEventSpy).not.toHaveBeenCalled();

        await user.click(selector);
        await user.click(screen.getByRole('button', { name: initialLabel }));

        expect(saveButton).toBeDisabled();
        expect(screen.queryByText('Cambios sin guardar')).not.toBeInTheDocument();
        expect(readPrismaRuntimeMode()).toBe(initialMode);

        await user.click(selector);
        await user.click(screen.getByRole('button', { name: nextLabel }));
        await user.click(saveButton);

        await waitFor(() => expect(readPrismaRuntimeMode()).not.toBe(initialMode));
        await waitFor(() => expect(saveButton).toBeDisabled());
        expect(runtimeEventSpy).toHaveBeenCalledTimes(1);
        expect(runtimeEventSpy.mock.calls[0]?.[0]).toMatchObject({
            detail: expect.objectContaining({ mode: initialMode === 'central' ? 'local' : 'central' }),
        });
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
        window.removeEventListener(PRISMA_RUNTIME_MODE_CHANGED_EVENT, runtimeEventSpy);
    });

    it.each([
        ['Server → Local', 'central', 'Local (presentations)'],
        ['Local → Server', 'local', 'Server (Node-RED)'],
    ] as const)('discards an unsaved runtime mode draft on close for %s', async (_case, initialMode, nextLabel) => {
        if (initialMode === 'local') savePrismaRuntimeMode('local');
        const runtimeEventSpy = vi.fn();
        window.addEventListener(PRISMA_RUNTIME_MODE_CHANGED_EVENT, runtimeEventSpy);
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => successfulConfigResponse(input)));
        const user = userEvent.setup();
        renderDialogHarness();
        const selector = screen.getByRole('button', { name: 'Modo de ejecución de Prisma' });

        await user.click(selector);
        await user.click(screen.getByRole('button', { name: nextLabel }));
        expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
        await user.click(screen.getByRole('button', { name: 'Cerrar' }));

        expect(readPrismaRuntimeMode()).toBe(initialMode);
        expect(runtimeEventSpy).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Reopen' }));
        expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Modo de ejecución de Prisma' }))
            .toHaveTextContent(initialMode === 'central' ? 'Server (Node-RED)' : 'Local (presentations)');
        window.removeEventListener(PRISMA_RUNTIME_MODE_CHANGED_EVENT, runtimeEventSpy);
    });
});
