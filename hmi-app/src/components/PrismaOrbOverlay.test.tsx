import '@testing-library/jest-dom/vitest';
import { StrictMode, createRef, forwardRef, useImperativeHandle } from 'react';
import type { RefObject } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VoiceEvent } from '../domain/voice.types';
import type { PrismaVoiceAudioEngineContract, PrismaVoiceAudioSource, VoicePlaybackLifecycle } from '../services/prismaVoiceAudioEngine';
import type { PrismaVoiceAudioSourceFactory } from '../services/prismaVoiceTtsAudioSource';
import { PRISMA_ORB_VISUAL_DEFAULTS, savePrismaOrbVisualConfig } from '../config/prismaOrb.config';
import {
    PRISMA_ORB_ENTRY_DURATION_MS,
    PRISMA_ORB_FADE_DURATION_MS,
    PRISMA_ORB_GROW_DURATION_MS,
    usePrismaOrbPresentation,
} from '../hooks/usePrismaOrbPresentation';
import { usePrismaOrbVisualConfig } from '../hooks/usePrismaOrbVisualConfig';
import PrismaOrbOverlay from './PrismaOrbOverlay';

vi.mock('../vendor/leda-orb.js', () => ({}));
// T4: `usePrismaOrbPresentation` now reads the shared Prisma voice config
// (for the Automatic/Manual playback-buffer mode) via `usePrismaVoiceConfig`,
// a TanStack Query hook. This suite has no `QueryClientProvider` in its tree
// and is not exercising config-driven prebuffer selection (every test here
// injects a fake `engine`, so the real prebuffer policy is never built) --
// mock the query hook itself rather than adding a provider this file
// otherwise has no use for.
vi.mock('../queries/usePrismaVoiceConfig', () => ({
    usePrismaVoiceConfig: () => ({ data: null, error: null, isEnabled: true, isLoading: false }),
}));

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
        warmAudioContext: vi.fn(),
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
    flushEntryAnimationFrame();
}

// T17b: the overlay's entry look (opacity 0 at the thinking scale) flips to
// the real phase look via a double `requestAnimationFrame`, not a timer --
// see PrismaOrbOverlay.tsx's `PrismaOrbOverlayVisible`. `vi.useFakeTimers()`
// (enabled in this file's beforeEach) fakes `requestAnimationFrame` too, so
// advancing by two simulated frames' worth of time flushes both rAF calls.
function flushEntryAnimationFrame(): void {
    act(() => { vi.advanceTimersByTime(32); });
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

    it('starts exactly one progressive presentation in StrictMode and shows the thinking look', () => {
        const { engine } = createEngine();
        const ref = createRef<HarnessHandle>();
        render(<StrictMode><Harness ref={ref} engine={engine} /></StrictMode>);

        emit(ref);

        expect(engine.play).toHaveBeenCalledTimes(1);
        const overlay = screen.getByTestId('prisma-orb-overlay');
        expect(overlay).toHaveAttribute('data-phase', 'thinking');
        expect(overlay).toHaveClass('scale-75', 'opacity-60');
    });

    it('grows to the visible/speaking look once the engine reports playback started', () => {
        const { engine, lifecycles } = createEngine();
        const ref = createRef<HarnessHandle>();
        render(<Harness ref={ref} engine={engine} />);
        emit(ref);

        expect(screen.getByTestId('prisma-orb-overlay')).toHaveClass('scale-75', 'opacity-60');

        act(() => lifecycles[0]?.onStarted?.());

        const overlay = screen.getByTestId('prisma-orb-overlay');
        expect(overlay).toHaveAttribute('data-phase', 'visible');
        expect(overlay).toHaveClass('scale-100', 'opacity-100');
    });

    it('fades smoothly after the playback terminal callback, staying mounted until the fade completes', () => {
        const { engine, lifecycles } = createEngine();
        const ref = createRef<HarnessHandle>();
        render(<Harness ref={ref} engine={engine} />);
        emit(ref);
        act(() => lifecycles[0]?.onStarted?.());

        act(() => lifecycles[0]?.onEnded?.());
        const overlay = screen.getByTestId('prisma-orb-overlay');
        expect(overlay).toHaveAttribute('data-phase', 'fading');
        expect(overlay).toHaveClass('opacity-0');
        // Still mounted right up to the fade duration.
        act(() => vi.advanceTimersByTime(PRISMA_ORB_FADE_DURATION_MS - 1));
        expect(screen.getByTestId('prisma-orb-overlay')).toBeInTheDocument();
        act(() => vi.advanceTimersByTime(1));
        expect(screen.queryByTestId('prisma-orb-overlay')).not.toBeInTheDocument();
    });

    it('forwards normalized event identity to the source factory', () => {
        const { engine } = createEngine();
        const factory = vi.fn<PrismaVoiceAudioSourceFactory>(() => SOURCE);
        const ref = createRef<HarnessHandle>();
        render(<Harness ref={ref} engine={engine} factory={factory} />);

        emit(ref);

        expect(factory).toHaveBeenCalledWith({ eventId: EVENT.id });
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

    it('keeps fixed transparent geometry and reduced-motion transition classes in every visible phase', () => {
        const { engine, lifecycles } = createEngine();
        const ref = createRef<HarnessHandle>();
        render(<Harness ref={ref} engine={engine} />);
        emit(ref);

        const assertBaseClasses = (): void => {
            const overlay = screen.getByTestId('prisma-orb-overlay');
            expect(overlay).toHaveClass(
                'fixed',
                'left-1/2',
                'top-[46px]',
                'z-[100]',
                '-translate-x-1/2',
                'pointer-events-none',
                'bg-transparent',
                'transition-[opacity,scale]',
                'motion-reduce:transition-none',
                'motion-reduce:duration-0',
            );
            expect(overlay).toHaveStyle('--prisma-orb-size: 290px');
            expect(overlay.querySelector('leda-orb')).toHaveAttribute('rays', String(PRISMA_ORB_VISUAL_DEFAULTS.rays));
            expect(overlay.querySelector('iframe, button, input, textarea, select')).toBeNull();
        };

        // thinking
        assertBaseClasses();
        act(() => lifecycles[0]?.onStarted?.());
        // visible
        assertBaseClasses();
        act(() => lifecycles[0]?.onEnded?.());
        // fading
        assertBaseClasses();
    });

    it('restarts at the thinking look when a new event arrives mid-fade, without unmounting', () => {
        const { engine, lifecycles } = createEngine();
        const ref = createRef<HarnessHandle>();
        render(<Harness ref={ref} engine={engine} />);
        emit(ref);
        act(() => lifecycles[0]?.onStarted?.());
        act(() => lifecycles[0]?.onEnded?.());
        expect(screen.getByTestId('prisma-orb-overlay')).toHaveAttribute('data-phase', 'fading');

        act(() => ref.current?.presentVoiceEvent({ ...EVENT, id: 'voice-3' }));

        const overlay = screen.getByTestId('prisma-orb-overlay');
        expect(overlay).toHaveAttribute('data-phase', 'thinking');
        expect(overlay).toHaveClass('scale-75', 'opacity-60');
    });

    it('updates visual configuration during playback without restarting audio', () => {
        const { engine, lifecycles } = createEngine();
        const ref = createRef<HarnessHandle>();
        render(<Harness ref={ref} engine={engine} />);
        emit(ref);
        act(() => lifecycles[0]?.onStarted?.());
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

    // T17b: root cause 2 (the overlay mounted directly in its target look,
    // with nothing to transition from). This test intentionally does NOT
    // flush the entry rAF, so it observes exactly the one frame the browser
    // actually paints before the flip.
    it('mounts one invisible frame before flipping to the thinking look, so the entry has a "from" state', () => {
        const { engine } = createEngine();
        const ref = createRef<HarnessHandle>();
        render(<Harness ref={ref} engine={engine} />);

        act(() => ref.current?.presentVoiceEvent(EVENT));

        const overlay = screen.getByTestId('prisma-orb-overlay');
        expect(overlay).toHaveAttribute('data-phase', 'thinking');
        expect(overlay).toHaveClass('scale-75', 'opacity-0');
        expect(overlay).not.toHaveClass('opacity-60');
        expect(overlay.style.transitionDuration).toBe(`${PRISMA_ORB_ENTRY_DURATION_MS}ms`);

        act(() => { vi.advanceTimersByTime(32); });

        expect(overlay).toHaveClass('scale-75', 'opacity-60');
        // T17b: the flip itself (entering -> thinking) also uses the entry
        // duration, not the 400 ms grow duration -- the grow duration is
        // reserved for the later thinking -> visible transition below.
        expect(overlay.style.transitionDuration).toBe(`${PRISMA_ORB_ENTRY_DURATION_MS}ms`);
    });

    it('uses the grow duration for thinking -> visible and the fade duration for visible -> fading, once entered', () => {
        const { engine, lifecycles } = createEngine();
        const ref = createRef<HarnessHandle>();
        render(<Harness ref={ref} engine={engine} />);
        emit(ref);
        const overlay = screen.getByTestId('prisma-orb-overlay');

        act(() => lifecycles[0]?.onStarted?.());
        expect(overlay).toHaveAttribute('data-phase', 'visible');
        expect(overlay.style.transitionDuration).toBe(`${PRISMA_ORB_GROW_DURATION_MS}ms`);

        act(() => lifecycles[0]?.onEnded?.());
        expect(overlay).toHaveAttribute('data-phase', 'fading');
        expect(overlay.style.transitionDuration).toBe(`${PRISMA_ORB_FADE_DURATION_MS}ms`);
    });
});
