import { act, fireEvent, render as renderTestingLibrary, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    DATA_CONNECTION_CONFIG_CHANGED_EVENT,
    DATA_DEFAULT_PRISMA_CONFIG_ENDPOINT,
    DATA_DEFAULT_VOICE_ENDPOINT,
} from '../../config/dataConnection.config';
import {
    PRISMA_VOICE_TTS_DEFAULT_SERVICE_URL,
    PRISMA_VOICE_TTS_STORAGE_KEY,
    readPrismaVoiceTtsServiceUrl,
    savePrismaVoiceTtsServiceUrl,
} from '../../config/prismaVoiceTts.config';
import {
    PRISMA_ORB_CONFIG_CHANGED_EVENT,
    PRISMA_ORB_STORAGE_KEY,
    PRISMA_ORB_VISUAL_DEFAULTS,
    readPrismaOrbVisualConfig,
} from '../../config/prismaOrb.config';
import PrismaOrbOverlay from '../PrismaOrbOverlay';
import { createDefaultPrismaVoiceConfig } from '../../domain/prismaVoiceConfig';
import { usePrismaOrbVisualConfig } from '../../hooks/usePrismaOrbVisualConfig';
import VoiceSettingsTab from './VoiceSettingsTab';

const { setSpeakingMock } = vi.hoisted(() => ({
    setSpeakingMock: vi.fn(),
}));

vi.mock('../../vendor/leda-orb.js', () => ({}));

class MockLedaOrb extends HTMLElement {
    public level = 0;

    public setSpeaking(speaking: boolean): void {
        setSpeakingMock(speaking);
    }
}

if (!customElements.get('leda-orb')) {
    customElements.define('leda-orb', MockLedaOrb);
}

function GlobalOrbHarness() {
    const config = usePrismaOrbVisualConfig();

    return <PrismaOrbOverlay isVisible orbRef={{ current: null }} config={config} />;
}

function getPreviewOrb(): HTMLElement {
    const orb = screen.getByTestId('prisma-orb-preview').querySelector('leda-orb');
    if (!orb) throw new Error('Prisma preview orb was not rendered');
    return orb;
}

function render(element: ReactElement, strictMode = false) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const view = <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>;

    return renderTestingLibrary(strictMode ? <StrictMode>{view}</StrictMode> : view);
}

function validRemoteConfig() {
    const config = createDefaultPrismaVoiceConfig();
    config.effectIntensity = 42;
    config.robotic.modulationHz = 37;
    return config;
}

function successfulConfigResponse(config = validRemoteConfig()): Response {
    return {
        ok: true,
        status: 200,
        json: vi.fn(async () => config),
    } as Response;
}

describe('VoiceSettingsTab', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://node-red.local');
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
        setSpeakingMock.mockClear();
    });

    afterEach(() => {
        localStorage.clear();
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it('renders the canonical endpoint default and required help text', () => {
        render(<VoiceSettingsTab />);

        const voiceEndpoint = screen.getByLabelText('Endpoint Voz HMI');
        const prismaConfigEndpoint = screen.getByLabelText('Endpoint Configuración Prisma');
        const ttsServiceUrl = screen.getByLabelText('URL Servicio Voz Prisma');

        expect(voiceEndpoint).toHaveValue(DATA_DEFAULT_VOICE_ENDPOINT);
        expect(screen.getByText('Ruta del endpoint de respuestas del asistente de voz. Dejar vacío para deshabilitar el canal de voz de la HMI.')).toBeInTheDocument();
        expect(screen.getByText('/hmi/voice/latest → Node-RED, respuestas de voz')).toBeInTheDocument();
        expect(voiceEndpoint).toHaveAttribute(
            'aria-describedby',
            'voice-settings-endpoint-hint voice-settings-endpoint-legend',
        );

        expect(prismaConfigEndpoint).toHaveValue(DATA_DEFAULT_PRISMA_CONFIG_ENDPOINT);
        expect(screen.getByText('/hmi/prisma-config → Node-RED, configuración central de efectos')).toBeInTheDocument();
        expect(prismaConfigEndpoint).toHaveAttribute(
            'aria-describedby',
            'voice-settings-prisma-config-endpoint-legend',
        );

        expect(ttsServiceUrl).toHaveValue(PRISMA_VOICE_TTS_DEFAULT_SERVICE_URL);
        expect(screen.getByText('URL del servicio TTS utilizado por Prisma para generar la voz Leda. Dejar vacío para deshabilitar la reproducción de voz en la interfaz.')).toBeInTheDocument();
        expect(screen.getByText('http://127.0.0.1:5056/prisma/speak-live → servicio local de Prisma que genera y entrega el audio')).toBeInTheDocument();
        expect(ttsServiceUrl).toHaveAttribute(
            'aria-describedby',
            'voice-settings-tts-service-url-hint voice-settings-tts-service-url-legend',
        );

        expect(voiceEndpoint.compareDocumentPosition(
            prismaConfigEndpoint,
        )).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(prismaConfigEndpoint.compareDocumentPosition(
            ttsServiceUrl,
        )).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(ttsServiceUrl.compareDocumentPosition(
            screen.getByTestId('prisma-orb-preview-stage'),
        )).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('renders Prisma voice effects with the approved defaults and preset options', async () => {
        const user = userEvent.setup();
        render(<VoiceSettingsTab />);

        expect(screen.getByRole('heading', { name: 'Efectos de voz de Prisma' })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Efecto robótico' })).toBeChecked();
        expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('100');

        const preset = screen.getByRole('button', { name: 'Preset' });
        expect(preset).toHaveTextContent('Robótico suave');
        await user.click(preset);
        expect(screen.getByRole('button', { name: 'Limpio' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Robótico suave' })).toBeInTheDocument();
    });

    it('loads the persisted central Prisma config into the effect controls without dirtying the tab', async () => {
        const onDirtyChange = vi.fn();
        const fetchMock = vi.fn(async () => successfulConfigResponse());
        vi.stubGlobal('fetch', fetchMock);

        render(<VoiceSettingsTab onDirtyChange={onDirtyChange} />);

        await waitFor(() => {
            expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('42');
        });
        await userEvent.click(screen.getByRole('button', { name: 'Avanzado' }));
        expect(screen.getByLabelText('Frecuencia de modulación')).toHaveValue('37');
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps defaults operational and exposes a polite hint when the central read fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new TypeError('Failed to fetch');
        }));

        render(<VoiceSettingsTab />);

        const hint = await screen.findByText('No se pudo cargar la configuración central de Prisma. Se mantienen los valores actuales.');
        expect(hint).toHaveAttribute('aria-live', 'polite');
        expect(screen.getByRole('checkbox', { name: 'Efecto robótico' })).toBeChecked();
        expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('100');
    });

    it('does not fetch or show a fetch error when the persisted Prisma endpoint is disabled', () => {
        localStorage.setItem('hmi:prisma-config-endpoint', '');
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        render(<VoiceSettingsTab />);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.queryByText(/No se pudo cargar la configuración central/)).not.toBeInTheDocument();
    });

    it('does not fetch an invalid URL and degrades discreetly when the Node-RED base is absent', () => {
        vi.stubEnv('VITE_NODE_RED_BASE_URL', '');
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        render(<VoiceSettingsTab />);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.getByText('Configurá la conexión a Node-RED para cargar la configuración central de Prisma.'))
            .toHaveAttribute('aria-live', 'polite');
    });

    it('does not let a late central response overwrite an effect edit started while loading', async () => {
        let resolveResponse!: (response: Response) => void;
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
            resolveResponse = resolve;
        })));
        render(<VoiceSettingsTab />);

        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), {
            target: { value: '65' },
        });
        await act(async () => resolveResponse(successfulConfigResponse()));

        await waitFor(() => {
            expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('65');
        });
    });

    it('marks every effect edit dirty without PUT until the shared Save action runs', async () => {
        const fetchMock = vi.fn(async () => successfulConfigResponse());
        vi.stubGlobal('fetch', fetchMock);
        const user = userEvent.setup();
        const onSaveStatusChange = vi.fn();
        render(<VoiceSettingsTab onSaveStatusChange={onSaveStatusChange} />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        await user.click(screen.getByRole('checkbox', { name: 'Efecto robótico' }));
        await user.click(screen.getByRole('button', { name: 'Preset' }));
        await user.click(screen.getByRole('button', { name: 'Limpio' }));
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), {
            target: { value: '65' },
        });
        await user.click(screen.getByRole('button', { name: 'Avanzado' }));
        fireEvent.change(screen.getByLabelText('Frecuencia de modulación'), { target: { value: '35' } });
        fireEvent.blur(screen.getByLabelText('Frecuencia de modulación'));

        expect(onSaveStatusChange).toHaveBeenLastCalledWith('dirty');
        expect(screen.queryByText('Cambios sin guardar')).not.toBeInTheDocument();
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
    });

    it('leaves saving and commits a normalized response under StrictMode', async () => {
        let resolvePut!: (response: Response) => void;
        const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'GET') return Promise.resolve(successfulConfigResponse(createDefaultPrismaVoiceConfig()));
            return new Promise<Response>((resolve) => { resolvePut = resolve; });
        });
        vi.stubGlobal('fetch', fetchMock);
        const onDirtyChange = vi.fn();
        const onSaveStatusChange = vi.fn();
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        render(<VoiceSettingsTab onDirtyChange={onDirtyChange} onSaveStatusChange={onSaveStatusChange} saveRef={saveRef} />, true);
        await waitFor(() => expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('100'));
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), {
            target: { value: '65' },
        });
        const normalized = createDefaultPrismaVoiceConfig();
        normalized.effectIntensity = 64;

        let savePromise: void | Promise<void>;
        act(() => { savePromise = saveRef.current?.(); });
        await waitFor(() => expect(onSaveStatusChange).toHaveBeenLastCalledWith('saving'));
        await act(async () => {
            resolvePut(successfulConfigResponse(normalized));
            await savePromise;
        });

        expect(onSaveStatusChange).toHaveBeenLastCalledWith('saved');
        expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('64');
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
    });

    it('leaves saving after exact read-after-write confirmation under StrictMode', async () => {
        let sentConfig = createDefaultPrismaVoiceConfig();
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'PUT') {
                sentConfig = JSON.parse(init.body as string) as typeof sentConfig;
                return {
                    ok: true,
                    status: 204,
                    json: vi.fn(async () => { throw new SyntaxError('Unexpected end of JSON input'); }),
                } as Response;
            }
            return successfulConfigResponse(sentConfig);
        });
        vi.stubGlobal('fetch', fetchMock);
        const onDirtyChange = vi.fn();
        const onSaveStatusChange = vi.fn();
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        render(<VoiceSettingsTab onDirtyChange={onDirtyChange} onSaveStatusChange={onSaveStatusChange} saveRef={saveRef} />, true);
        await waitFor(() => expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('100'));
        await waitFor(() => {
            expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(2);
        });
        const getCountBeforeSave = fetchMock.mock.calls.filter(([, init]) => init?.method === 'GET').length;
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), {
            target: { value: '65' },
        });

        let savePromise: void | Promise<void>;
        act(() => { savePromise = saveRef.current?.(); });
        await waitFor(() => expect(onSaveStatusChange).toHaveBeenLastCalledWith('saving'));
        await act(async () => { await savePromise; });

        expect(onSaveStatusChange).toHaveBeenLastCalledWith('saved');
        expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('65');
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'GET'))
            .toHaveLength(getCountBeforeSave + 1);
    });

    it('keeps the dirty draft usable and reports an error after a failed PUT', async () => {
        const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(
            init?.method === 'PUT'
                ? ({ ok: false, status: 503, json: vi.fn() } as unknown as Response)
                : successfulConfigResponse(createDefaultPrismaVoiceConfig()),
        ));
        vi.stubGlobal('fetch', fetchMock);
        const onDirtyChange = vi.fn();
        const onSaveStatusChange = vi.fn();
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        render(<VoiceSettingsTab onDirtyChange={onDirtyChange} onSaveStatusChange={onSaveStatusChange} saveRef={saveRef} />, true);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), {
            target: { value: '65' },
        });

        await act(async () => { await saveRef.current?.(); });

        expect(onSaveStatusChange).toHaveBeenLastCalledWith('error');
        expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('65');
        expect(onDirtyChange).toHaveBeenLastCalledWith(true);
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), {
            target: { value: '66' },
        });
        expect(onSaveStatusChange).toHaveBeenLastCalledWith('dirty');
    });

    it.each([
        ['missing base', '', DATA_DEFAULT_PRISMA_CONFIG_ENDPOINT],
        ['empty endpoint', 'https://node-red.local', ''],
    ])('does not PUT and reports an error for %s', async (_case, baseUrl, endpoint) => {
        vi.stubEnv('VITE_NODE_RED_BASE_URL', baseUrl);
        if (endpoint === '') localStorage.setItem('hmi:prisma-config-endpoint', '');
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const onSaveStatusChange = vi.fn();
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        render(<VoiceSettingsTab onSaveStatusChange={onSaveStatusChange} saveRef={saveRef} />);
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), {
            target: { value: '65' },
        });

        await act(async () => { await saveRef.current?.(); });

        expect(onSaveStatusChange).toHaveBeenLastCalledWith('error');
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
    });

    it('deduplicates double Save while PUT is in flight', async () => {
        let resolvePut!: (response: Response) => void;
        const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
            init?.method === 'PUT'
                ? new Promise<Response>((resolve) => { resolvePut = resolve; })
                : Promise.resolve(successfulConfigResponse(createDefaultPrismaVoiceConfig()))
        ));
        vi.stubGlobal('fetch', fetchMock);
        const onSaveStatusChange = vi.fn();
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        render(<VoiceSettingsTab onSaveStatusChange={onSaveStatusChange} saveRef={saveRef} />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), {
            target: { value: '65' },
        });

        let first: void | Promise<void>;
        let second: void | Promise<void>;
        act(() => {
            first = saveRef.current?.();
            second = saveRef.current?.();
        });
        await waitFor(() => {
            expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
        });
        await act(async () => {
            resolvePut(successfulConfigResponse());
            await Promise.all([first, second]);
        });
    });

    it('preserves an edit made during PUT and remains dirty after the response', async () => {
        let resolvePut!: (response: Response) => void;
        const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
            init?.method === 'PUT'
                ? new Promise<Response>((resolve) => { resolvePut = resolve; })
                : Promise.resolve(successfulConfigResponse(createDefaultPrismaVoiceConfig()))
        ));
        vi.stubGlobal('fetch', fetchMock);
        const onSaveStatusChange = vi.fn();
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        render(<VoiceSettingsTab onSaveStatusChange={onSaveStatusChange} saveRef={saveRef} />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        const intensity = screen.getByRole('slider', { name: 'Intensidad del efecto robótico' });
        fireEvent.change(intensity, { target: { value: '65' } });
        let savePromise: void | Promise<void>;
        act(() => { savePromise = saveRef.current?.(); });
        fireEvent.change(intensity, { target: { value: '70' } });
        const normalized = createDefaultPrismaVoiceConfig();
        normalized.effectIntensity = 64;

        await waitFor(() => expect(resolvePut).toBeTypeOf('function'));

        await act(async () => {
            resolvePut(successfulConfigResponse(normalized));
            await savePromise;
        });

        expect(intensity).toHaveValue('70');
        expect(onSaveStatusChange).toHaveBeenLastCalledWith('dirty');
    });

    it('blocks PUT when an advanced field contains invalid text', async () => {
        const fetchMock = vi.fn(async () => successfulConfigResponse(validRemoteConfig()));
        vi.stubGlobal('fetch', fetchMock);
        const onSaveStatusChange = vi.fn();
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        render(<VoiceSettingsTab onSaveStatusChange={onSaveStatusChange} saveRef={saveRef} />);
        await waitFor(() => {
            expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('42');
        });
        await userEvent.click(screen.getByRole('button', { name: 'Avanzado' }));
        const modulation = screen.getByLabelText('Frecuencia de modulación');
        fireEvent.change(modulation, { target: { value: '0' } });
        fireEvent.blur(modulation);

        await act(async () => { await saveRef.current?.(); });

        expect(onSaveStatusChange).toHaveBeenLastCalledWith('error');
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
    });

    it('reveals every approved advanced voice parameter with exact defaults', async () => {
        const user = userEvent.setup();
        render(<VoiceSettingsTab />);

        const advanced = screen.getByRole('button', { name: 'Avanzado' });
        expect(advanced).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByLabelText('Frecuencia de modulación')).not.toBeInTheDocument();

        await user.click(advanced);

        expect(advanced).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByLabelText('Frecuencia de modulación')).toHaveValue('30');
        expect(screen.getByLabelText('Ganancia base')).toHaveValue('0.78');
        expect(screen.getByLabelText('Profundidad de modulación')).toHaveValue('0.22');
        expect(screen.getByLabelText('Pasos de cuantización')).toHaveValue('260');
        expect(screen.getByLabelText('Frecuencia componente metálico')).toHaveValue('410');
        expect(screen.getByLabelText('Intensidad componente metálico')).toHaveValue('0.04');
        expect(screen.getByLabelText('Retardo eco 1')).toHaveValue('40');
        expect(screen.getByLabelText('Ganancia eco 1')).toHaveValue('0.22');
        expect(screen.getByLabelText('Retardo eco 2')).toHaveValue('95');
        expect(screen.getByLabelText('Ganancia eco 2')).toHaveValue('0.1');
        expect(screen.getByLabelText('Pico objetivo de normalización')).toHaveValue('29500');
        expect(screen.getByLabelText('Ganancia máxima de normalización')).toHaveValue('1.6');
    });

    it('edits the in-memory voice draft without persisting it to localStorage', async () => {
        const user = userEvent.setup();
        const onDirtyChange = vi.fn();
        render(<VoiceSettingsTab onDirtyChange={onDirtyChange} />);
        onDirtyChange.mockClear();

        await user.click(screen.getByRole('checkbox', { name: 'Efecto robótico' }));
        const preset = screen.getByRole('button', { name: 'Preset' });
        await user.click(preset);
        await user.click(screen.getByRole('button', { name: 'Limpio' }));
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' }), {
            target: { value: '65' },
        });
        await user.click(screen.getByRole('button', { name: 'Avanzado' }));
        const modulation = screen.getByLabelText('Frecuencia de modulación');
        await user.clear(modulation);
        await user.type(modulation, '35');
        await user.tab();

        expect(screen.getByRole('checkbox', { name: 'Efecto robótico' })).not.toBeChecked();
        expect(preset).toHaveTextContent('Limpio');
        expect(screen.getByRole('slider', { name: 'Intensidad del efecto robótico' })).toHaveValue('65');
        expect(screen.getByLabelText('Frecuencia de modulación')).toHaveValue('35');
        expect(onDirtyChange).toHaveBeenLastCalledWith(true);
        expect(localStorage).toHaveLength(0);
    });

    it('renders the real preview and every demo control in the approved order', () => {
        render(<VoiceSettingsTab />);

        const controls = [
            screen.getByRole('slider', { name: 'Haces (rays)' }),
            screen.getByRole('checkbox', { name: 'Mostrar deslizador' }),
            screen.getByRole('checkbox', { name: 'Demo automática' }),
            screen.getByRole('checkbox', { name: 'Hablando' }),
            screen.getByRole('slider', { name: 'Velocidad' }),
            screen.getByRole('slider', { name: 'Intensidad' }),
            screen.getByRole('slider', { name: 'Tamaño (px)' }),
            screen.getByLabelText('Color del núcleo'),
            screen.getByLabelText('Color del halo'),
            screen.getByRole('button', { name: 'Fondo de la vista previa' }),
            screen.getByRole('slider', { name: 'Penetración de haces' }),
        ];

        expect(screen.getByTestId('prisma-orb-preview')).toBeInTheDocument();
        expect(controls[3]).toBeDisabled();
        for (let index = 0; index < controls.length - 1; index += 1) {
            expect(controls[index]?.compareDocumentPosition(controls[index + 1] as Node))
                .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        }
        expect(screen.queryByText('Level')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^reset/i })).not.toBeInTheDocument();
    });

    it('uses the exact approved defaults, ranges and color presets', () => {
        render(<VoiceSettingsTab />);

        expect(screen.getByRole('slider', { name: 'Haces (rays)' })).toHaveAttribute('min', '0');
        expect(screen.getByRole('slider', { name: 'Haces (rays)' })).toHaveAttribute('max', '1');
        expect(screen.getByRole('slider', { name: 'Haces (rays)' })).toHaveAttribute('step', '0.01');
        expect(screen.getByRole('slider', { name: 'Haces (rays)' })).toHaveValue('0.45');
        expect(screen.getByRole('checkbox', { name: 'Mostrar deslizador' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Demo automática' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Hablando' })).not.toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Hablando' })).toBeDisabled();
        expect(screen.getByRole('slider', { name: 'Velocidad' })).toHaveAttribute('min', '0.3');
        expect(screen.getByRole('slider', { name: 'Velocidad' })).toHaveAttribute('max', '2');
        expect(screen.getByRole('slider', { name: 'Velocidad' })).toHaveAttribute('step', '0.05');
        expect(screen.getByRole('slider', { name: 'Velocidad' })).toHaveValue('1');
        expect(screen.getByRole('slider', { name: 'Intensidad' })).toHaveAttribute('min', '0.4');
        expect(screen.getByRole('slider', { name: 'Intensidad' })).toHaveAttribute('max', '2');
        expect(screen.getByRole('slider', { name: 'Intensidad' })).toHaveAttribute('step', '0.05');
        expect(screen.getByRole('slider', { name: 'Intensidad' })).toHaveValue('1');
        expect(screen.getByRole('slider', { name: 'Tamaño (px)' })).toHaveAttribute('min', '160');
        expect(screen.getByRole('slider', { name: 'Tamaño (px)' })).toHaveAttribute('max', '1200');
        expect(screen.getByRole('slider', { name: 'Tamaño (px)' })).toHaveAttribute('step', '20');
        expect(screen.getByRole('slider', { name: 'Tamaño (px)' })).toHaveValue('290');
        expect(screen.getByLabelText('Color del núcleo')).toHaveValue('#1b6ee0');
        expect(screen.getByLabelText('Color del halo')).toHaveValue('#8ff0ff');
        expect(screen.getAllByRole('button', { name: /Usar color de núcleo/ }).map((button) => button.getAttribute('aria-label'))).toEqual([
            'Usar color de núcleo #1b6ee0',
            'Usar color de núcleo #1240c8',
            'Usar color de núcleo #0f8fb8',
            'Usar color de núcleo #3355ff',
        ]);
        expect(screen.getAllByRole('button', { name: /Usar color de halo/ }).map((button) => button.getAttribute('aria-label'))).toEqual([
            'Usar color de halo #8ff0ff',
            'Usar color de halo #bfe9ff',
            'Usar color de halo #5fd2ff',
            'Usar color de halo #dff6ff',
        ]);
        expect(screen.getByRole('button', { name: 'Fondo de la vista previa' })).toHaveTextContent('Vista previa HMI');
        expect(screen.getByRole('slider', { name: 'Penetración de haces' })).toHaveValue('0.45');
    });

    it('updates persisted visual draft attributes and size only in the preview before save', () => {
        const onDirtyChange = vi.fn();
        render(
            <>
                <VoiceSettingsTab onDirtyChange={onDirtyChange} />
                <GlobalOrbHarness />
            </>,
        );
        const globalOrb = screen.getByTestId('prisma-orb-overlay').querySelector('leda-orb');
        onDirtyChange.mockClear();

        fireEvent.change(screen.getByRole('slider', { name: 'Haces (rays)' }), { target: { value: '0.72' } });
        fireEvent.change(screen.getByRole('slider', { name: 'Velocidad' }), { target: { value: '1.5' } });
        fireEvent.change(screen.getByRole('slider', { name: 'Intensidad' }), { target: { value: '1.4' } });
        fireEvent.change(screen.getByRole('slider', { name: 'Tamaño (px)' }), { target: { value: '600' } });
        fireEvent.change(screen.getByLabelText('Color del núcleo'), { target: { value: '#1240c8' } });
        fireEvent.change(screen.getByLabelText('Color del halo'), { target: { value: '#bfe9ff' } });

        expect(getPreviewOrb()).toHaveAttribute('rays', '0.72');
        expect(getPreviewOrb()).toHaveAttribute('speed', '1.5');
        expect(getPreviewOrb()).toHaveAttribute('intensity', '1.4');
        expect(getPreviewOrb()).toHaveAttribute('core', '#1240c8');
        expect(getPreviewOrb()).toHaveAttribute('glow', '#bfe9ff');
        expect(screen.getByTestId('prisma-orb-preview-size')).toHaveStyle('--prisma-orb-size: 600px');
        expect(screen.getByTestId('prisma-orb-preview-size')).toHaveClass(
            'size-[min(var(--prisma-orb-size),100%)]',
        );
        expect(globalOrb).toHaveAttribute('rays', String(PRISMA_ORB_VISUAL_DEFAULTS.rays));
        expect(globalOrb).toHaveAttribute('speed', String(PRISMA_ORB_VISUAL_DEFAULTS.speed));
        expect(localStorage.getItem(PRISMA_ORB_STORAGE_KEY)).toBeNull();
        expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });

    it('operates preview-only controls without dirtying or persisting', async () => {
        const user = userEvent.setup();
        const onDirtyChange = vi.fn();
        render(
            <>
                <VoiceSettingsTab onDirtyChange={onDirtyChange} />
                <GlobalOrbHarness />
            </>,
        );
        onDirtyChange.mockClear();

        await user.click(screen.getByRole('checkbox', { name: 'Mostrar deslizador' }));
        expect(screen.queryByRole('slider', { name: 'Penetración de haces' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('checkbox', { name: 'Demo automática' }));
        const speaking = screen.getByRole('checkbox', { name: 'Hablando' });
        expect(speaking).toBeEnabled();
        await user.click(speaking);
        expect(setSpeakingMock).toHaveBeenLastCalledWith(true);

        const backdropSelector = screen.getByRole('button', { name: 'Fondo de la vista previa' });
        await user.click(backdropSelector);
        await user.click(screen.getByRole('button', { name: 'Panel claro' }));
        expect(screen.getByTestId('prisma-orb-preview-stage')).toHaveClass('bg-industrial-text/90');
        expect(screen.getByTestId('prisma-orb-overlay')).toHaveClass('bg-transparent');

        await user.click(backdropSelector);
        await user.click(screen.getByRole('button', { name: 'Transparente' }));
        expect(screen.getByTestId('prisma-orb-preview-stage')).toHaveClass('bg-transparent');

        await user.click(backdropSelector);
        await user.click(screen.getByRole('button', { name: 'Vista previa HMI' }));
        expect(screen.getByTestId('prisma-orb-preview-stage')).toHaveClass('bg-industrial-bg');
        expect(onDirtyChange).not.toHaveBeenCalled();
        expect(localStorage.getItem(PRISMA_ORB_STORAGE_KEY)).toBeNull();
    });

    it('keeps the penetration slider linked to the same rays draft', () => {
        render(<VoiceSettingsTab />);

        fireEvent.change(screen.getByRole('slider', { name: 'Penetración de haces' }), {
            target: { value: '0.31' },
        });

        expect(screen.getByRole('slider', { name: 'Haces (rays)' })).toHaveValue('0.31');
        expect(getPreviewOrb()).toHaveAttribute('rays', '0.31');
    });

    it('replicates demo speaking timings and clears its timer on unmount', () => {
        vi.useFakeTimers();
        const { unmount } = render(<VoiceSettingsTab />);
        setSpeakingMock.mockClear();

        act(() => vi.advanceTimersByTime(2_199));
        expect(setSpeakingMock).not.toHaveBeenCalledWith(true);
        act(() => vi.advanceTimersByTime(1));
        expect(setSpeakingMock).toHaveBeenLastCalledWith(true);

        act(() => vi.advanceTimersByTime(2_600));
        expect(setSpeakingMock).toHaveBeenLastCalledWith(false);
        act(() => vi.advanceTimersByTime(5_200));
        expect(setSpeakingMock).toHaveBeenLastCalledWith(true);

        expect(vi.getTimerCount()).toBe(1);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
        expect(setSpeakingMock).toHaveBeenLastCalledWith(false);
        vi.useRealTimers();
    });

    it('keeps manual speaking authoritative while auto demo is disabled', () => {
        vi.useFakeTimers();
        const { unmount } = render(<VoiceSettingsTab />);
        setSpeakingMock.mockClear();

        fireEvent.click(screen.getByRole('checkbox', { name: 'Demo automática' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Hablando' }));
        expect(setSpeakingMock).toHaveBeenLastCalledWith(true);
        const callCount = setSpeakingMock.mock.calls.length;

        act(() => vi.advanceTimersByTime(2_200 + 2_600 + 2_600));
        expect(setSpeakingMock).toHaveBeenCalledTimes(callCount);
        expect(setSpeakingMock).toHaveBeenLastCalledWith(true);

        unmount();
        expect(setSpeakingMock).toHaveBeenLastCalledWith(false);
        vi.useRealTimers();
    });

    it('persists a custom endpoint through the shared dialog save contract', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => successfulConfigResponse(createDefaultPrismaVoiceConfig())));
        const onDirtyChange = vi.fn();
        const saveRef = { current: null as null | (() => void | Promise<void>) };

        render(<VoiceSettingsTab onDirtyChange={onDirtyChange} saveRef={saveRef} />);

        fireEvent.change(screen.getByLabelText('Endpoint Voz HMI'), {
            target: { value: '/custom/voice' },
        });
        await act(async () => { await saveRef.current?.(); });

        expect(localStorage.getItem('hmi:voice-endpoint')).toBe('/custom/voice');
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it('tracks and persists the Prisma config endpoint only through the shared dialog save contract', async () => {
        const fetchMock = vi.fn(async () => successfulConfigResponse(createDefaultPrismaVoiceConfig()));
        vi.stubGlobal('fetch', fetchMock);
        const onDirtyChange = vi.fn();
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        render(<VoiceSettingsTab onDirtyChange={onDirtyChange} saveRef={saveRef} />);
        onDirtyChange.mockClear();

        fireEvent.change(screen.getByLabelText('Endpoint Configuración Prisma'), {
            target: { value: '  /custom/prisma-config  ' },
        });

        expect(onDirtyChange).toHaveBeenLastCalledWith(true);
        expect(localStorage.getItem('hmi:prisma-config-endpoint')).toBeNull();

        await act(async () => { await saveRef.current?.(); });

        expect(screen.getByLabelText('Endpoint Configuración Prisma')).toHaveValue('/custom/prisma-config');
        expect(localStorage.getItem('hmi:prisma-config-endpoint')).toBe('/custom/prisma-config');
        expect(localStorage.getItem('hmi:voice-endpoint')).toBeNull();
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        expect(fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')?.[0])
            .toBe('https://node-red.local/custom/prisma-config');
    });

    it('saves listener endpoint, TTS URL and visual config atomically and updates the visible global orb', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => successfulConfigResponse(createDefaultPrismaVoiceConfig())));
        const onDirtyChange = vi.fn();
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        const configEventSpy = vi.fn();
        document.addEventListener(PRISMA_ORB_CONFIG_CHANGED_EVENT, configEventSpy);
        render(
            <>
                <VoiceSettingsTab onDirtyChange={onDirtyChange} saveRef={saveRef} />
                <GlobalOrbHarness />
            </>,
        );
        const globalOrb = screen.getByTestId('prisma-orb-overlay').querySelector('leda-orb');

        fireEvent.change(screen.getByLabelText('Endpoint Voz HMI'), { target: { value: '/voice/prisma' } });
        fireEvent.change(screen.getByLabelText('URL Servicio Voz Prisma'), {
            target: { value: '  https://tts.example.test/prisma/speak  ' },
        });
        fireEvent.change(screen.getByRole('slider', { name: 'Velocidad' }), { target: { value: '1.5' } });
        expect(globalOrb).toHaveAttribute('speed', '1');
        expect(localStorage.getItem(PRISMA_VOICE_TTS_STORAGE_KEY)).toBeNull();

        await act(async () => { await saveRef.current?.(); });

        expect(localStorage.getItem('hmi:voice-endpoint')).toBe('/voice/prisma');
        expect(readPrismaVoiceTtsServiceUrl()).toBe('https://tts.example.test/prisma/speak-live');
        expect(readPrismaOrbVisualConfig().speed).toBe(1.5);
        expect(globalOrb).toHaveAttribute('speed', '1.5');
        expect(configEventSpy).toHaveBeenCalledTimes(1);
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
        document.removeEventListener(PRISMA_ORB_CONFIG_CHANGED_EVENT, configEventSpy);
    });

    it('discards unsaved endpoint, TTS URL, visual draft and transient state when Close unmounts the tab', () => {
        localStorage.setItem('hmi:voice-endpoint', '/persisted/voice');
        savePrismaVoiceTtsServiceUrl('https://tts.example.test/persisted');
        const first = render(<VoiceSettingsTab />);
        fireEvent.change(screen.getByLabelText('Endpoint Voz HMI'), { target: { value: '/unsaved/voice' } });
        fireEvent.change(screen.getByLabelText('URL Servicio Voz Prisma'), {
            target: { value: 'https://tts.example.test/unsaved' },
        });
        fireEvent.change(screen.getByRole('slider', { name: 'Velocidad' }), { target: { value: '1.8' } });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar deslizador' }));
        first.unmount();

        render(<VoiceSettingsTab />);

        expect(screen.getByLabelText('Endpoint Voz HMI')).toHaveValue('/persisted/voice');
        expect(screen.getByLabelText('URL Servicio Voz Prisma')).toHaveValue('https://tts.example.test/persisted');
        expect(screen.getByRole('slider', { name: 'Velocidad' })).toHaveValue('1');
        expect(screen.getByRole('slider', { name: 'Penetración de haces' })).toBeInTheDocument();
        expect(localStorage.getItem(PRISMA_ORB_STORAGE_KEY)).toBeNull();
    });

    it('persists an empty endpoint so the voice channel remains disabled', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => successfulConfigResponse(createDefaultPrismaVoiceConfig())));
        const saveRef = { current: null as null | (() => void | Promise<void>) };

        render(<VoiceSettingsTab saveRef={saveRef} />);
        fireEvent.change(screen.getByLabelText('Endpoint Voz HMI'), {
            target: { value: '' },
        });
        await act(async () => { await saveRef.current?.(); });

        expect(localStorage.getItem('hmi:voice-endpoint')).toBe('');
    });

    it('persists an empty TTS URL explicitly and marks only saved values clean', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => successfulConfigResponse(createDefaultPrismaVoiceConfig())));
        const onDirtyChange = vi.fn();
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        render(<VoiceSettingsTab onDirtyChange={onDirtyChange} saveRef={saveRef} />);
        onDirtyChange.mockClear();

        fireEvent.change(screen.getByLabelText('URL Servicio Voz Prisma'), { target: { value: '' } });

        expect(onDirtyChange).toHaveBeenLastCalledWith(true);
        expect(localStorage.getItem(PRISMA_VOICE_TTS_STORAGE_KEY)).toBeNull();
        await act(async () => { await saveRef.current?.(); });
        expect(localStorage.getItem(PRISMA_VOICE_TTS_STORAGE_KEY)).toBe('');
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it('does not emit a listener restart when only the TTS URL is saved', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => successfulConfigResponse(createDefaultPrismaVoiceConfig())));
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        const listenerConfigSpy = vi.fn();
        window.addEventListener(DATA_CONNECTION_CONFIG_CHANGED_EVENT, listenerConfigSpy);
        render(<VoiceSettingsTab saveRef={saveRef} />);

        fireEvent.change(screen.getByLabelText('URL Servicio Voz Prisma'), {
            target: { value: 'https://tts.example.test/only-tts-changed' },
        });
        await act(async () => { await saveRef.current?.(); });

        expect(listenerConfigSpy).not.toHaveBeenCalled();
        window.removeEventListener(DATA_CONNECTION_CONFIG_CHANGED_EVENT, listenerConfigSpy);
    });

    it('keeps the previous runtime URL when an invalid TTS draft is saved', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => successfulConfigResponse(createDefaultPrismaVoiceConfig())));
        savePrismaVoiceTtsServiceUrl('https://tts.example.test/persisted');
        const saveRef = { current: null as null | (() => void | Promise<void>) };
        render(<VoiceSettingsTab saveRef={saveRef} />);

        fireEvent.change(screen.getByLabelText('URL Servicio Voz Prisma'), { target: { value: '/invalid' } });
        await act(async () => { await saveRef.current?.(); });

        expect(readPrismaVoiceTtsServiceUrl()).toBe('https://tts.example.test/persisted');
        expect(screen.getByLabelText('URL Servicio Voz Prisma')).toHaveValue('https://tts.example.test/persisted');
    });
});
