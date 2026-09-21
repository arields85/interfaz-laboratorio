import { act, cleanup, fireEvent, render as renderTestingLibrary, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PRISMA_ORB_STORAGE_KEY, readPrismaOrbVisualConfig } from '../../config/prismaOrb.config';
import { createDefaultPrismaVoiceConfig } from '../../domain/prismaVoiceConfig';
import VoiceSettingsTab from './VoiceSettingsTab';
import { UNAUTHENTICATED_SESSION, useAuthStore } from '../../store/auth.store';
import { adminAuthClient } from '../../services/adminAuth.service';

const { setSpeakingMock, refused } = vi.hoisted(() => {
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
    return { setSpeakingMock: vi.fn<(speaking: boolean) => void>(), refused: [] as string[] };
});
// Prevent captured module singletons from escaping the per-test fake fetch.
vi.mock('../../services/adminAuth.service', async () => {
    const actual = await vi.importActual<typeof import('../../services/adminAuth.service')>('../../services/adminAuth.service');
    return { ...actual, adminAuthClient: new actual.AdminAuthClient(async (path) => {
        refused.push(String(path));
        throw new Error('TEST_NETWORK_REFUSED');
    }) };
});

afterAll(() => vi.unstubAllGlobals());

vi.mock('../../vendor/leda-orb.js', () => ({}));

class MockLedaOrb extends HTMLElement {
    public level = 0;
    public setSpeaking(speaking: boolean): void {
        setSpeakingMock(speaking);
    }
}

if (!customElements.get('leda-orb')) customElements.define('leda-orb', MockLedaOrb);

function render(element: ReactElement, strictMode = false) {
    const injected = fetch;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (path, init) => {
        if (path !== '/api/prisma/voice-config' || !['GET', 'PUT'].includes(init?.method ?? 'GET')) {
            refused.push(`${init?.method ?? 'GET'} ${String(path)}`);
            throw new Error('TEST_NETWORK_REFUSED');
        }
        return injected(path, init);
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const view = <QueryClientProvider client={client}>{element}</QueryClientProvider>;
    return renderTestingLibrary(strictMode ? <StrictMode>{view}</StrictMode> : view);
}

function configEnvelope(config = createDefaultPrismaVoiceConfig()): Response {
    return {
        ok: true,
        status: 200,
        json: async () => ({ config, sync: { configured: false, verified: false } }),
    } as Response;
}

describe('VoiceSettingsTab', () => {
    beforeEach(() => {
        localStorage.clear();
        setSpeakingMock.mockClear();
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    });

    afterEach(() => {
        cleanup();
        expect(refused).toEqual([]);
        const unexpected = vi.mocked(fetch).mock.calls.filter(([path]) => path !== '/api/prisma/voice-config');
        expect(unexpected).toEqual([]);
        localStorage.clear();
        vi.useRealTimers();
        // Keep the injected storage installed throughout this file.
    });

    it('mounts the real name section before credentials and saves locally when active', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => configEnvelope()));
        useAuthStore.setState({
            isHydrated: true,
            session: { isAuthenticated: true, loginTimestamp: '2026-01-01T00:00:00Z',
                user: { id: 'test-admin', username: 'admin', displayName: 'Admin',
                    role: { id: 'admin', name: 'Admin', permissions: ['admin:access'] } } },
        });
        const metadata = vi.spyOn(adminAuthClient, 'credentialMetadata').mockResolvedValue({
            gemini: { configured: false }, telegram: { configured: false }, telegram_channel_a: { configured: false },
        });
        const health = vi.spyOn(adminAuthClient, 'telegramHealth').mockResolvedValue({
            enabled: true, configured: false, running: false, verified: false,
            configurationError: 'TELEGRAM_CREDENTIAL_MISSING', lastError: null,
            desiredGeneration: 1, appliedGeneration: 1, restartRequired: false,
        });
        try {
            const onDirtyChange = vi.fn();
            const view = render(<VoiceSettingsTab credentialControlsActive={false} onDirtyChange={onDirtyChange} />);
            const name = screen.getByLabelText('Nombre de esta HMI');
            const credential = screen.getByLabelText('Credencial Gemini');
            expect(name).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Guardar nombre' })).toBeDisabled();
            expect(name.compareDocumentPosition(credential) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            view.unmount();
            render(<VoiceSettingsTab credentialControlsActive onDirtyChange={onDirtyChange} />);
            onDirtyChange.mockClear();
            fireEvent.change(screen.getByLabelText('Nombre de esta HMI'), { target: { value: 'Panel recepción' } });
            fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }));
            expect(await screen.findByText('Nombre guardado en este navegador')).toBeInTheDocument();
            expect(localStorage.getItem('hmi:prisma-hmi-name')).toBe(JSON.stringify({ version: 1, name: 'Panel recepción' }));
            expect(onDirtyChange).not.toHaveBeenCalledWith(true);
            expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
        } finally {
            cleanup();
            useAuthStore.setState({ session: UNAUTHENTICATED_SESSION, isHydrated: false });
            metadata.mockRestore();
            health.mockRestore();
        }
    });

    it('ignores legacy routing preferences and renders only retained effect and orb settings', () => {
        localStorage.setItem('hmi:prisma-runtime-mode', 'local');
        localStorage.setItem('hmi:voice-endpoint', 'https://legacy.invalid/voice');
        localStorage.setItem('hmi:prisma-config-endpoint', 'https://legacy.invalid/config');
        localStorage.setItem('hmi:prisma-voice-tts-service-url', 'https://legacy.invalid/tts');

        render(<VoiceSettingsTab />);

        expect(screen.queryByRole('button', { name: 'Modo de ejecución de Prisma' })).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Endpoint Voz HMI')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Endpoint Configuración Prisma')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('URL Servicio Voz Prisma')).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Efectos de voz de Prisma' })).toBeInTheDocument();
        expect(screen.getByTestId('prisma-orb-preview-stage')).toBeInTheDocument();
        expect(localStorage.getItem('hmi:prisma-runtime-mode')).toBe('local');
        expect(localStorage.getItem('hmi:voice-endpoint')).toBe('https://legacy.invalid/voice');
        expect(localStorage.getItem('hmi:prisma-config-endpoint')).toBe('https://legacy.invalid/config');
        expect(localStorage.getItem('hmi:prisma-voice-tts-service-url')).toBe('https://legacy.invalid/tts');
    });

    it('renders credential administration without joining the shared Voice save draft', async () => {
        const user = userEvent.setup();
        vi.stubGlobal('fetch', vi.fn(async () => configEnvelope()));
        const onDirtyChange = vi.fn();
        render(<VoiceSettingsTab onDirtyChange={onDirtyChange} />);

        expect(await screen.findByRole('heading', { name: 'Credenciales de proveedores' })).toBeInTheDocument();
        onDirtyChange.mockClear();
        await user.type(screen.getByLabelText('Credencial Gemini'), 'synthetic-canary-secret');

        expect(onDirtyChange).not.toHaveBeenCalledWith(true);
        expect(localStorage.getItem('synthetic-canary-secret')).toBeNull();
        expect(sessionStorage.getItem('synthetic-canary-secret')).toBeNull();
    });

    it('loads the runtime envelope into effect controls without dirtying the tab', async () => {
        const config = createDefaultPrismaVoiceConfig();
        config.effectIntensity = 42;
        const fetchMock = vi.fn(async () => configEnvelope(config));
        vi.stubGlobal('fetch', fetchMock);
        const onDirtyChange = vi.fn();

        render(<VoiceSettingsTab onDirtyChange={onDirtyChange} />);

        await waitFor(() => expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('42'));
        expect(fetchMock).toHaveBeenCalledWith('/api/prisma/voice-config', expect.objectContaining({ method: 'GET' }));
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it('keeps defaults usable and reports an unavailable runtime nonfatally', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

        render(<VoiceSettingsTab />);

        expect(await screen.findByText('No se pudo cargar la configuración de Prisma. Se mantienen los valores actuales.'))
            .toHaveAttribute('aria-live', 'polite');
        expect(screen.getByRole('checkbox', { name: 'Efecto robótico' })).toBeChecked();
    });

    it('marks effect edits dirty without PUT until shared Save', async () => {
        const fetchMock = vi.fn(async () => configEnvelope());
        vi.stubGlobal('fetch', fetchMock);
        const onSaveStatusChange = vi.fn();
        render(<VoiceSettingsTab onSaveStatusChange={onSaveStatusChange} />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());

        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), { target: { value: '65' } });

        expect(onSaveStatusChange).toHaveBeenLastCalledWith('dirty');
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
    });

    it('sends exactly one PUT per Save and commits the normalized response', async () => {
        const initial = createDefaultPrismaVoiceConfig();
        const normalized = createDefaultPrismaVoiceConfig();
        normalized.effectIntensity = 64;
        const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(
            init?.method === 'PUT' ? configEnvelope(normalized) : configEnvelope(initial),
        ));
        vi.stubGlobal('fetch', fetchMock);
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        const onSaveStatusChange = vi.fn();
        render(<VoiceSettingsTab saveRef={saveRef} onSaveStatusChange={onSaveStatusChange} />, true);
        await waitFor(() => expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('100'));
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), { target: { value: '65' } });

        await act(async () => saveRef.current?.());

        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
        expect(fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')?.[0]).toBe('/api/prisma/voice-config');
        expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('64');
        expect(onSaveStatusChange).toHaveBeenLastCalledWith('saved');
    });

    it('uses read-after-write confirmation when the PUT response is lost', async () => {
        let sent = createDefaultPrismaVoiceConfig();
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'PUT') {
                sent = JSON.parse(init.body as string) as typeof sent;
                return { ok: true, status: 204, json: async () => { throw new SyntaxError('lost'); } } as Response;
            }
            return configEnvelope(sent);
        });
        vi.stubGlobal('fetch', fetchMock);
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        render(<VoiceSettingsTab saveRef={saveRef} />);
        await waitFor(() => expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('100'));
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), { target: { value: '65' } });
        const readsBefore = fetchMock.mock.calls.filter(([, init]) => init?.method === 'GET').length;

        await act(async () => saveRef.current?.());

        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(readsBefore + 1);
    });

    it('keeps a failed save dirty and editable', async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
            init?.method === 'PUT' ? ({ ok: false, status: 503 } as Response) : configEnvelope()
        ));
        vi.stubGlobal('fetch', fetchMock);
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        const onSaveStatusChange = vi.fn();
        render(<VoiceSettingsTab saveRef={saveRef} onSaveStatusChange={onSaveStatusChange} />);
        await waitFor(() => expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('100'));
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), { target: { value: '65' } });

        await act(async () => saveRef.current?.());

        expect(onSaveStatusChange).toHaveBeenLastCalledWith('error');
        expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('65');
    });

    it('blocks Save while an effect field is invalid', async () => {
        const user = userEvent.setup();
        const initial = createDefaultPrismaVoiceConfig();
        initial.effectIntensity = 42;
        const fetchMock = vi.fn(async () => configEnvelope(initial));
        vi.stubGlobal('fetch', fetchMock);
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        const onSaveStatusChange = vi.fn();
        render(<VoiceSettingsTab saveRef={saveRef} onSaveStatusChange={onSaveStatusChange} />);
        await waitFor(() => expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('42'));

        await user.click(screen.getByRole('button', { name: 'Avanzado' }));
        const modulationInput = screen.getByLabelText('Frecuencia de modulación');
        await user.clear(modulationInput);
        await user.type(modulationInput, '0');
        let savePromise: void | Promise<void>;
        act(() => {
            fireEvent.blur(modulationInput);
            savePromise = saveRef.current?.();
        });
        await act(async () => { await savePromise; });

        expect(modulationInput).toHaveAttribute('aria-invalid', 'true');
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
        expect(onSaveStatusChange).toHaveBeenLastCalledWith('error');
    });

    it('preserves an invalid advanced edit made while a PUT is pending', async () => {
        const user = userEvent.setup();
        let resolvePut!: (response: Response) => void;
        const initial = createDefaultPrismaVoiceConfig();
        initial.effectIntensity = 42;
        const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
            init?.method === 'PUT'
                ? new Promise<Response>((resolve) => { resolvePut = resolve; })
                : Promise.resolve(configEnvelope(initial))
        ));
        vi.stubGlobal('fetch', fetchMock);
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        const onSaveStatusChange = vi.fn();
        render(<VoiceSettingsTab saveRef={saveRef} onSaveStatusChange={onSaveStatusChange} />);
        await waitFor(() => expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('42'));
        await user.click(screen.getByRole('button', { name: 'Avanzado' }));
        const modulationInput = screen.getByLabelText('Frecuencia de modulación');
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), { target: { value: '65' } });
        let savePromise: void | Promise<void>;
        act(() => { savePromise = saveRef.current?.(); });
        await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1));

        await user.clear(modulationInput);
        await user.type(modulationInput, '0');
        act(() => {
            fireEvent.blur(modulationInput);
            const remote = createDefaultPrismaVoiceConfig();
            remote.effectIntensity = 65;
            resolvePut(configEnvelope(remote));
        });
        await act(async () => { await savePromise; });

        expect(modulationInput).toHaveValue('0');
        expect(modulationInput).toHaveAttribute('aria-invalid', 'true');
        expect(onSaveStatusChange).toHaveBeenLastCalledWith('dirty');
    });

    it('rebases edits made while a save is pending onto the remote response', async () => {
        let resolvePut!: (response: Response) => void;
        const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
            init?.method === 'PUT'
                ? new Promise<Response>((resolve) => { resolvePut = resolve; })
                : Promise.resolve(configEnvelope())
        ));
        vi.stubGlobal('fetch', fetchMock);
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        render(<VoiceSettingsTab saveRef={saveRef} />);
        await waitFor(() => expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('100'));
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), { target: { value: '65' } });
        let savePromise: void | Promise<void>;
        act(() => { savePromise = saveRef.current?.(); });
        await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), { target: { value: '70' } });
        const remote = createDefaultPrismaVoiceConfig();
        remote.effectIntensity = 65;

        await act(async () => { resolvePut(configEnvelope(remote)); await savePromise; });

        expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('70');
    });

    it('persists orb visual settings through the shared Save action', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => configEnvelope()));
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        render(<VoiceSettingsTab saveRef={saveRef} />);
        const hex = screen.getByLabelText('Hex del núcleo');
        fireEvent.change(hex, { target: { value: '1240c8' } });

        await act(async () => saveRef.current?.());

        expect(localStorage.getItem(PRISMA_ORB_STORAGE_KEY)).not.toBeNull();
        expect(readPrismaOrbVisualConfig().core).toBe('#1240c8');
    });

    it('keeps preview-only controls transient and clean', async () => {
        const user = userEvent.setup();
        const initial = createDefaultPrismaVoiceConfig();
        initial.effectIntensity = 42;
        vi.stubGlobal('fetch', vi.fn(async () => configEnvelope(initial)));
        const onDirtyChange = vi.fn();
        render(<VoiceSettingsTab onDirtyChange={onDirtyChange} />);
        await waitFor(() => expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('42'));
        onDirtyChange.mockClear();

        await user.click(screen.getByRole('checkbox', { name: 'Mostrar deslizador' }));
        await user.click(screen.getByRole('checkbox', { name: 'Demo automática' }));
        await user.click(screen.getByRole('checkbox', { name: 'Hablando' }));
        await user.click(screen.getByRole('button', { name: 'Fondo de la vista previa' }));
        await user.click(screen.getByRole('button', { name: 'Panel claro' }));

        expect(screen.queryByRole('slider', { name: 'Penetración de haces' })).not.toBeInTheDocument();
        expect(setSpeakingMock).toHaveBeenLastCalledWith(true);
        expect(screen.getByTestId('prisma-orb-preview-stage')).toHaveClass('bg-industrial-text/90');
        expect(onDirtyChange).not.toHaveBeenCalled();
        expect(localStorage.getItem(PRISMA_ORB_STORAGE_KEY)).toBeNull();
    });

    it('runs the preview demo cadence and clears its timer on unmount', () => {
        vi.useFakeTimers();
        const { unmount } = render(<VoiceSettingsTab />);
        setSpeakingMock.mockClear();

        act(() => vi.advanceTimersByTime(2_200));
        expect(setSpeakingMock).toHaveBeenLastCalledWith(true);
        act(() => vi.advanceTimersByTime(2_600));
        expect(setSpeakingMock).toHaveBeenLastCalledWith(false);
        expect(vi.getTimerCount()).toBe(1);

        unmount();

        expect(vi.getTimerCount()).toBe(0);
        expect(setSpeakingMock).toHaveBeenLastCalledWith(false);
    });

    it('keeps manual speaking authoritative while auto demo is disabled', () => {
        vi.useFakeTimers();
        const { unmount } = render(<VoiceSettingsTab />);
        setSpeakingMock.mockClear();

        fireEvent.click(screen.getByRole('checkbox', { name: 'Demo automática' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Hablando' }));
        expect(setSpeakingMock).toHaveBeenLastCalledWith(true);
        const callCount = setSpeakingMock.mock.calls.length;
        act(() => vi.advanceTimersByTime(10_000));

        expect(setSpeakingMock).toHaveBeenCalledTimes(callCount);
        expect(setSpeakingMock).toHaveBeenLastCalledWith(true);
        unmount();
        expect(setSpeakingMock).toHaveBeenLastCalledWith(false);
    });

    it('coalesces duplicate Save calls while one PUT is pending', async () => {
        let resolvePut!: (response: Response) => void;
        const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
            init?.method === 'PUT'
                ? new Promise<Response>((resolve) => { resolvePut = resolve; })
                : Promise.resolve(configEnvelope())
        ));
        vi.stubGlobal('fetch', fetchMock);
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        render(<VoiceSettingsTab saveRef={saveRef} />);
        await waitFor(() => expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('100'));
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), { target: { value: '65' } });

        let first: void | Promise<void>;
        let second: void | Promise<void>;
        act(() => {
            first = saveRef.current?.();
            second = saveRef.current?.();
        });
        await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1));
        await act(async () => {
            resolvePut(configEnvelope());
            await Promise.all([first, second]);
        });

        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
    });
});
