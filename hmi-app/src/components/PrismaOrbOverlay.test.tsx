import '@testing-library/jest-dom/vitest';
import { StrictMode, createRef, forwardRef, useImperativeHandle } from 'react';
import type { RefObject } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VoiceEvent } from '../domain/voice.types';
import type { PrismaVoiceAudioEngineContract, PrismaVoiceAudioSource, VoicePlaybackLifecycle } from '../services/prismaVoiceAudioEngine';
import type { PrismaVoiceAudioSourceFactory } from '../services/prismaVoiceTtsAudioSource';
import { PRISMA_ORB_VISUAL_DEFAULTS, savePrismaOrbVisualConfig } from '../config/prismaOrb.config';
import { PRISMA_ORB_FADE_DURATION_MS, usePrismaOrbPresentation } from '../hooks/usePrismaOrbPresentation';
import { usePrismaOrbVisualConfig } from '../hooks/usePrismaOrbVisualConfig';
import PrismaOrbOverlay from './PrismaOrbOverlay';

vi.mock('../vendor/leda-orb.js', () => ({}));

class MockLedaOrb extends HTMLElement {
    public level = 0;
    public setSpeaking = vi.fn();
}

if (!customElements.get('leda-orb')) customElements.define('leda-orb', MockLedaOrb);

const EVENT: VoiceEvent = { id: 'voice-2', timestamp: '2026-08-06T12:00:01.000Z', text: 'Current response', question: 'Current question' };
const SOURCE: PrismaVoiceAudioSource = { playbackTransport: 'progressive', openLive: vi.fn() };

interface HarnessHandle { presentVoiceEvent: (event: VoiceEvent) => void }

function createEngine() {
    const lifecycles: VoicePlaybackLifecycle[] = [];
    const engine: PrismaVoiceAudioEngineContract = {
        play: vi.fn((_source, _target, lifecycle) => lifecycles.push(lifecycle)),
        stop: vi.fn(),
        dispose: vi.fn(),
    };
    return { engine, lifecycles };
}

const Harness = forwardRef<HarnessHandle, {
    engine: PrismaVoiceAudioEngineContract;
    factory?: PrismaVoiceAudioSourceFactory;
}>(function Harness({ engine, factory = () => SOURCE }, ref) {
    const presentation = usePrismaOrbPresentation({ engine, audioSourceFactory: factory });
    const config = usePrismaOrbVisualConfig();
    useImperativeHandle(ref, () => ({ presentVoiceEvent: presentation.presentVoiceEvent }), [presentation.presentVoiceEvent]);
    return <PrismaOrbOverlay phase={presentation.phase} orbRef={presentation.orbRef} config={config} />;
});

function emit(ref: RefObject<HarnessHandle | null>): void {
    act(() => ref.current?.presentVoiceEvent(EVENT));
}

describe('PrismaOrbOverlay', () => {
    beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
    afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

    it('stays unmounted without a voice event', () => {
        const { engine } = createEngine();
        render(<Harness ref={createRef<HarnessHandle>()} engine={engine} />);
        expect(screen.queryByTestId('prisma-orb-overlay')).not.toBeInTheDocument();
        expect(engine.play).not.toHaveBeenCalled();
    });

    it('starts exactly one progressive presentation in StrictMode', () => {
        const { engine } = createEngine();
        const ref = createRef<HarnessHandle>();
        render(<StrictMode><Harness ref={ref} engine={engine} /></StrictMode>);

        emit(ref);

        expect(engine.play).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('prisma-orb-overlay')).toHaveAttribute('data-phase', 'visible');
    });

    it('fades only after the playback terminal callback', () => {
        const { engine, lifecycles } = createEngine();
        const ref = createRef<HarnessHandle>();
        render(<Harness ref={ref} engine={engine} />);
        emit(ref);

        expect(screen.getByTestId('prisma-orb-overlay')).toHaveClass('opacity-100');
        act(() => lifecycles[0]?.onEnded?.());
        expect(screen.getByTestId('prisma-orb-overlay')).toHaveClass('opacity-0');
        act(() => vi.advanceTimersByTime(PRISMA_ORB_FADE_DURATION_MS));
        expect(screen.queryByTestId('prisma-orb-overlay')).not.toBeInTheDocument();
    });

    it('forwards normalized event identity to the source factory', () => {
        const { engine } = createEngine();
        const factory = vi.fn<PrismaVoiceAudioSourceFactory>(() => SOURCE);
        const ref = createRef<HarnessHandle>();
        render(<Harness ref={ref} engine={engine} factory={factory} />);

        emit(ref);

        expect(factory).toHaveBeenCalledWith({ text: EVENT.text, eventId: EVENT.id });
    });

    it('uses the controlled fade path after playback failure', () => {
        const { engine, lifecycles } = createEngine();
        const ref = createRef<HarnessHandle>();
        render(<Harness ref={ref} engine={engine} />);
        emit(ref);

        act(() => lifecycles[0]?.onError?.(new Error('Autoplay blocked')));
        expect(screen.getByTestId('prisma-orb-overlay')).toHaveClass('opacity-0');
        act(() => vi.advanceTimersByTime(PRISMA_ORB_FADE_DURATION_MS));

        expect(screen.queryByTestId('prisma-orb-overlay')).not.toBeInTheDocument();
    });

    it('keeps fixed transparent geometry and reduced-motion fade classes', () => {
        const { engine } = createEngine();
        const ref = createRef<HarnessHandle>();
        render(<Harness ref={ref} engine={engine} />);
        emit(ref);

        const overlay = screen.getByTestId('prisma-orb-overlay');
        expect(overlay).toHaveClass(
            'fixed',
            'left-1/2',
            'top-[46px]',
            'z-[100]',
            '-translate-x-1/2',
            'pointer-events-none',
            'bg-transparent',
            'motion-reduce:transition-none',
            'motion-reduce:duration-0',
        );
        expect(overlay).toHaveStyle('--prisma-orb-size: 290px');
        expect(overlay.querySelector('leda-orb')).toHaveAttribute('rays', String(PRISMA_ORB_VISUAL_DEFAULTS.rays));
        expect(overlay.querySelector('iframe, button, input, textarea, select')).toBeNull();
    });

    it('updates visual configuration during playback without restarting audio', () => {
        const { engine } = createEngine();
        const ref = createRef<HarnessHandle>();
        render(<Harness ref={ref} engine={engine} />);
        emit(ref);
        const overlay = screen.getByTestId('prisma-orb-overlay');

        act(() => {
            savePrismaOrbVisualConfig({
                ...PRISMA_ORB_VISUAL_DEFAULTS,
                rays: 0.8,
                speed: 1.5,
                intensity: 1.4,
                size: 640,
                core: '#1240c8',
                glow: '#bfe9ff',
            });
        });

        expect(overlay.querySelector('leda-orb')).toHaveAttribute('rays', '0.8');
        expect(overlay).toHaveStyle('--prisma-orb-size: 640px');
        expect(engine.play).toHaveBeenCalledTimes(1);
        act(() => vi.advanceTimersByTime(10_000));
        expect(screen.getByTestId('prisma-orb-overlay')).toHaveClass('opacity-100');
        expect(engine.play).toHaveBeenCalledTimes(1);
    });
});
