import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    DATA_CONNECTION_CONFIG_CHANGED_EVENT,
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

describe('VoiceSettingsTab', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://node-red.local');
        setSpeakingMock.mockClear();
    });

    afterEach(() => {
        localStorage.clear();
        vi.unstubAllEnvs();
    });

    it('renders the canonical endpoint default and required help text', () => {
        render(<VoiceSettingsTab />);

        expect(screen.getByLabelText('Endpoint Voz HMI')).toHaveValue(DATA_DEFAULT_VOICE_ENDPOINT);
        expect(screen.getByText('Ruta del endpoint de respuestas del asistente de voz. Dejar vacío para deshabilitar el canal de voz de la HMI.')).toBeInTheDocument();
        expect(screen.getByLabelText('URL Servicio Voz Prisma')).toHaveValue(PRISMA_VOICE_TTS_DEFAULT_SERVICE_URL);
        expect(screen.getByText('URL del servicio TTS utilizado por Prisma para generar la voz Leda. Dejar vacío para deshabilitar la reproducción de voz en la interfaz.')).toBeInTheDocument();
        expect(screen.getByLabelText('Endpoint Voz HMI').compareDocumentPosition(
            screen.getByLabelText('URL Servicio Voz Prisma'),
        )).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(screen.getByLabelText('URL Servicio Voz Prisma').compareDocumentPosition(
            screen.getByTestId('prisma-orb-preview-stage'),
        )).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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
        expect(screen.queryByRole('button', { name: /reset/i })).not.toBeInTheDocument();
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

    it('persists a custom endpoint through the shared dialog save contract', () => {
        const onDirtyChange = vi.fn();
        const saveRef = { current: null as null | (() => void) };

        render(<VoiceSettingsTab onDirtyChange={onDirtyChange} saveRef={saveRef} />);

        fireEvent.change(screen.getByLabelText('Endpoint Voz HMI'), {
            target: { value: '/custom/voice' },
        });
        saveRef.current?.();

        expect(localStorage.getItem('hmi:voice-endpoint')).toBe('/custom/voice');
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it('saves listener endpoint, TTS URL and visual config atomically and updates the visible global orb', () => {
        const onDirtyChange = vi.fn();
        const saveRef = { current: null as null | (() => void) };
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

        act(() => saveRef.current?.());

        expect(localStorage.getItem('hmi:voice-endpoint')).toBe('/voice/prisma');
        expect(readPrismaVoiceTtsServiceUrl()).toBe('https://tts.example.test/prisma/speak');
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

    it('persists an empty endpoint so the voice channel remains disabled', () => {
        const saveRef = { current: null as null | (() => void) };

        render(<VoiceSettingsTab saveRef={saveRef} />);
        fireEvent.change(screen.getByLabelText('Endpoint Voz HMI'), {
            target: { value: '' },
        });
        saveRef.current?.();

        expect(localStorage.getItem('hmi:voice-endpoint')).toBe('');
    });

    it('persists an empty TTS URL explicitly and marks only saved values clean', () => {
        const onDirtyChange = vi.fn();
        const saveRef = { current: null as null | (() => void) };
        render(<VoiceSettingsTab onDirtyChange={onDirtyChange} saveRef={saveRef} />);
        onDirtyChange.mockClear();

        fireEvent.change(screen.getByLabelText('URL Servicio Voz Prisma'), { target: { value: '' } });

        expect(onDirtyChange).toHaveBeenLastCalledWith(true);
        expect(localStorage.getItem(PRISMA_VOICE_TTS_STORAGE_KEY)).toBeNull();
        saveRef.current?.();
        expect(localStorage.getItem(PRISMA_VOICE_TTS_STORAGE_KEY)).toBe('');
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it('does not emit a listener restart when only the TTS URL is saved', () => {
        const saveRef = { current: null as null | (() => void) };
        const listenerConfigSpy = vi.fn();
        window.addEventListener(DATA_CONNECTION_CONFIG_CHANGED_EVENT, listenerConfigSpy);
        render(<VoiceSettingsTab saveRef={saveRef} />);

        fireEvent.change(screen.getByLabelText('URL Servicio Voz Prisma'), {
            target: { value: 'https://tts.example.test/only-tts-changed' },
        });
        act(() => saveRef.current?.());

        expect(listenerConfigSpy).not.toHaveBeenCalled();
        window.removeEventListener(DATA_CONNECTION_CONFIG_CHANGED_EVENT, listenerConfigSpy);
    });

    it('keeps the previous runtime URL when an invalid TTS draft is saved', () => {
        savePrismaVoiceTtsServiceUrl('https://tts.example.test/persisted');
        const saveRef = { current: null as null | (() => void) };
        render(<VoiceSettingsTab saveRef={saveRef} />);

        fireEvent.change(screen.getByLabelText('URL Servicio Voz Prisma'), { target: { value: '/invalid' } });
        act(() => saveRef.current?.());

        expect(readPrismaVoiceTtsServiceUrl()).toBe('https://tts.example.test/persisted');
        expect(screen.getByLabelText('URL Servicio Voz Prisma')).toHaveValue('https://tts.example.test/persisted');
    });
});
