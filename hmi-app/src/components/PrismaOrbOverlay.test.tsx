import '@testing-library/jest-dom/vitest';
import { StrictMode, createRef, forwardRef, useImperativeHandle } from 'react';
import type { RefObject } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PRISMA_ORB_VISUAL_DEFAULTS, savePrismaOrbVisualConfig } from '../config/prismaOrb.config';
import type { VoiceEvent } from '../domain/voice.types';
import type {
    PrismaOrbAudioTarget,
    PrismaVoiceAudioEngineContract,
    VoicePlaybackLifecycle,
} from '../services/prismaVoiceAudioEngine';
import type { PrismaVoiceAudioSourceFactory } from '../services/prismaVoiceTtsAudioSource';

vi.mock('../vendor/leda-orb.js', () => ({}));

import {
    PRISMA_ORB_FADE_DURATION_MS,
    usePrismaOrbPresentation,
} from '../hooks/usePrismaOrbPresentation';
import { usePrismaOrbVisualConfig } from '../hooks/usePrismaOrbVisualConfig';
import PrismaOrbOverlay from './PrismaOrbOverlay';

class MockLedaOrb extends HTMLElement {
    public level = 0;
    public setSpeaking = vi.fn<(speaking: boolean) => void>();
}

if (!customElements.get('leda-orb')) {
    customElements.define('leda-orb', MockLedaOrb);
}

const FIRST_EVENT: VoiceEvent = {
    id: 'voice-2',
    timestamp: '2026-08-06T12:00:01.000Z',
    text: 'Current response',
    question: 'Current question',
};

interface OrbHarnessHandle {
    presentVoiceEvent: (event: VoiceEvent) => void;
}

function createEngineMock() {
    const plays: Array<{
        source: Parameters<PrismaVoiceAudioEngineContract['play']>[0];
        target: PrismaOrbAudioTarget;
        lifecycle: VoicePlaybackLifecycle;
    }> = [];
    const engine: PrismaVoiceAudioEngineContract = {
        play: vi.fn((source, target, lifecycle) => {
            plays.push({ source, target, lifecycle });
        }),
        stop: vi.fn(),
        dispose: vi.fn(),
    };

    return { engine, plays };
}

const TEST_AUDIO_SOURCE = { load: vi.fn(async () => new ArrayBuffer(8)) };

interface OrbHarnessProps {
    engine: PrismaVoiceAudioEngineContract;
    audioSourceFactory?: PrismaVoiceAudioSourceFactory;
    getServiceUrl?: () => string;
}

const OrbHarness = forwardRef<OrbHarnessHandle, OrbHarnessProps>(function OrbHarness({
    engine,
    audioSourceFactory = () => TEST_AUDIO_SOURCE,
    getServiceUrl = () => 'https://tts.example.test/prisma/speak',
}, ref) {
    const presentation = usePrismaOrbPresentation({ engine, audioSourceFactory, getServiceUrl });
    const config = usePrismaOrbVisualConfig();
    useImperativeHandle(ref, () => ({
        presentVoiceEvent: presentation.presentVoiceEvent,
    }), [presentation.presentVoiceEvent]);

    return <PrismaOrbOverlay phase={presentation.phase} orbRef={presentation.orbRef} config={config} />;
});

function emitVoiceEvent(harnessRef: RefObject<OrbHarnessHandle | null>, event: VoiceEvent): void {
    act(() => {
        harnessRef.current?.presentVoiceEvent(event);
    });
}

describe('PrismaOrbOverlay', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('stays unmounted without a new voice event', () => {
        const { engine } = createEngineMock();
        render(<OrbHarness ref={createRef<OrbHarnessHandle>()} engine={engine} />);

        expect(screen.queryByTestId('prisma-orb-overlay')).not.toBeInTheDocument();
        expect(engine.play).not.toHaveBeenCalled();
    });

    it('does not duplicate playback when mounted in React StrictMode', () => {
        const { engine } = createEngineMock();
        const harnessRef = createRef<OrbHarnessHandle>();
        render(
            <StrictMode>
                <OrbHarness ref={harnessRef} engine={engine} />
            </StrictMode>,
        );

        emitVoiceEvent(harnessRef, FIRST_EVENT);

        expect(engine.play).toHaveBeenCalledTimes(1);
    });

    it('stays visible for real playback and fades only after natural end', () => {
        const { engine, plays } = createEngineMock();
        const harnessRef = createRef<OrbHarnessHandle>();
        render(<OrbHarness ref={harnessRef} engine={engine} />);
        emitVoiceEvent(harnessRef, FIRST_EVENT);

        const overlay = screen.getByTestId('prisma-orb-overlay');
        expect(overlay).toHaveClass('opacity-100', 'transition-opacity');
        expect(engine.play).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);

        act(() => {
            vi.advanceTimersByTime(12_440);
        });
        expect(screen.getByTestId('prisma-orb-overlay')).toBeInTheDocument();

        act(() => plays[0]?.lifecycle.onEnded?.());
        expect(screen.getByTestId('prisma-orb-overlay')).toHaveClass('opacity-0');
        expect(vi.getTimerCount()).toBe(1);

        act(() => vi.advanceTimersByTime(PRISMA_ORB_FADE_DURATION_MS));
        expect(screen.queryByTestId('prisma-orb-overlay')).not.toBeInTheDocument();
    });

    it('creates a dynamic source for every event from the current saved URL and VoiceEvent.text', () => {
        const { engine } = createEngineMock();
        const sourceFactory = vi.fn<PrismaVoiceAudioSourceFactory>(() => TEST_AUDIO_SOURCE);
        let serviceUrl = 'https://tts.example.test/first';
        const harnessRef = createRef<OrbHarnessHandle>();
        render(
            <OrbHarness
                ref={harnessRef}
                engine={engine}
                audioSourceFactory={sourceFactory}
                getServiceUrl={() => serviceUrl}
            />,
        );

        emitVoiceEvent(harnessRef, FIRST_EVENT);
        serviceUrl = 'https://tts.example.test/second';
        emitVoiceEvent(harnessRef, {
            ...FIRST_EVENT,
            id: 'voice-3',
            text: 'Latest response text',
            question: 'This must not be spoken',
        });

        expect(sourceFactory).toHaveBeenNthCalledWith(1, {
            serviceUrl: 'https://tts.example.test/first',
            text: 'Current response',
        });
        expect(sourceFactory).toHaveBeenNthCalledWith(2, {
            serviceUrl: 'https://tts.example.test/second',
            text: 'Latest response text',
        });
        expect(engine.play).toHaveBeenCalledTimes(2);
    });

    it('stops active playback and hides without fetching when a newer event finds audio disabled', () => {
        const { engine } = createEngineMock();
        const sourceFactory = vi.fn<PrismaVoiceAudioSourceFactory>(({ serviceUrl }) => (
            serviceUrl === '' ? null : TEST_AUDIO_SOURCE
        ));
        let serviceUrl = 'https://tts.example.test/prisma/speak';
        const harnessRef = createRef<OrbHarnessHandle>();
        render(
            <OrbHarness
                ref={harnessRef}
                engine={engine}
                audioSourceFactory={sourceFactory}
                getServiceUrl={() => serviceUrl}
            />,
        );
        emitVoiceEvent(harnessRef, FIRST_EVENT);
        expect(screen.getByTestId('prisma-orb-overlay')).toBeInTheDocument();

        serviceUrl = '';
        emitVoiceEvent(harnessRef, { ...FIRST_EVENT, id: 'voice-3', text: 'Disabled audio' });

        expect(engine.stop).toHaveBeenCalledTimes(1);
        expect(engine.play).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('prisma-orb-overlay')).not.toBeInTheDocument();
    });

    it('cancels load/play/fade and stale callbacks cannot hide the latest playback', () => {
        const { engine, plays } = createEngineMock();
        const harnessRef = createRef<OrbHarnessHandle>();
        render(<OrbHarness ref={harnessRef} engine={engine} />);
        emitVoiceEvent(harnessRef, FIRST_EVENT);
        const firstLifecycle = plays[0]?.lifecycle;

        emitVoiceEvent(harnessRef, { ...FIRST_EVENT, id: 'voice-3' });
        expect(engine.play).toHaveBeenCalledTimes(2);
        act(() => firstLifecycle?.onEnded?.());
        expect(screen.getByTestId('prisma-orb-overlay')).toHaveClass('opacity-100');

        const secondLifecycle = plays[1]?.lifecycle;
        act(() => secondLifecycle?.onEnded?.());
        expect(screen.getByTestId('prisma-orb-overlay')).toHaveClass('opacity-0');

        emitVoiceEvent(harnessRef, { ...FIRST_EVENT, id: 'voice-4' });
        expect(screen.getByTestId('prisma-orb-overlay')).toHaveClass('opacity-100');
        expect(engine.play).toHaveBeenCalledTimes(3);
        act(() => vi.advanceTimersByTime(PRISMA_ORB_FADE_DURATION_MS));
        expect(screen.getByTestId('prisma-orb-overlay')).toBeInTheDocument();
    });

    it('uses the same fade cleanup for a controlled playback failure', () => {
        const { engine, plays } = createEngineMock();
        const harnessRef = createRef<OrbHarnessHandle>();
        render(<OrbHarness ref={harnessRef} engine={engine} />);
        emitVoiceEvent(harnessRef, FIRST_EVENT);

        act(() => plays[0]?.lifecycle.onError?.(new Error('autoplay blocked')));
        expect(screen.getByTestId('prisma-orb-overlay')).toHaveClass('opacity-0');
        act(() => vi.advanceTimersByTime(PRISMA_ORB_FADE_DURATION_MS));
        expect(screen.queryByTestId('prisma-orb-overlay')).not.toBeInTheDocument();
    });

    it('disposes playback on unmount', () => {
        const { engine } = createEngineMock();
        const harnessRef = createRef<OrbHarnessHandle>();
        const { unmount } = render(<OrbHarness ref={harnessRef} engine={engine} />);
        emitVoiceEvent(harnessRef, FIRST_EVENT);

        unmount();

        expect(engine.dispose).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps fixed transparent global geometry and supports reduced-motion fade', () => {
        const { engine } = createEngineMock();
        const harnessRef = createRef<OrbHarnessHandle>();
        render(<OrbHarness ref={harnessRef} engine={engine} />);
        emitVoiceEvent(harnessRef, FIRST_EVENT);

        const overlay = screen.getByTestId('prisma-orb-overlay');
        const orb = overlay.querySelector('leda-orb');
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
        expect(orb).toHaveAttribute('rays', String(PRISMA_ORB_VISUAL_DEFAULTS.rays));
        expect(overlay.querySelector('iframe, button, input, textarea, select')).toBeNull();
    });

    it('updates visual config during playback without restarting audio or creating a timer', () => {
        const { engine } = createEngineMock();
        const harnessRef = createRef<OrbHarnessHandle>();
        render(<OrbHarness ref={harnessRef} engine={engine} />);
        emitVoiceEvent(harnessRef, FIRST_EVENT);
        const overlay = screen.getByTestId('prisma-orb-overlay');
        const orb = overlay.querySelector('leda-orb');

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

        expect(orb).toHaveAttribute('rays', '0.8');
        expect(overlay).toHaveStyle('--prisma-orb-size: 640px');
        expect(engine.play).toHaveBeenCalledTimes(1);
        act(() => vi.advanceTimersByTime(10_000));
        expect(screen.getByTestId('prisma-orb-overlay')).toHaveClass('opacity-100');
        expect(engine.play).toHaveBeenCalledTimes(1);
    });
});
