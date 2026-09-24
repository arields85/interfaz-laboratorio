import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VoiceEvent } from '../domain/voice.types';
import type { PrismaVoiceAudioEngineContract, PrismaVoiceAudioSource, VoicePlaybackLifecycle } from '../services/prismaVoiceAudioEngine';
import type { PrismaVoiceAudioSourceFactory } from '../services/prismaVoiceTtsAudioSource';
import { prismaSessionClient } from '../services/prismaSessionClient';
import { PRISMA_BROWSER_METRIC_EVENT } from '../services/prismaVoiceMetrics';
import type { LedaOrbElement } from '../vendor/leda-orb.js';
import {
    PRISMA_ORB_FADE_DURATION_MS,
    PRISMA_ORB_THINKING_TIMEOUT_MS,
    usePrismaOrbPresentation,
} from './usePrismaOrbPresentation';

function collectOrbPhaseRecords(run: () => void): string[] {
    const phases: string[] = [];
    const listener = (event: Event) => {
        const detail = (event as CustomEvent<{ record_type: string; payload: { phase: string } }>).detail;
        if (detail.record_type === 'orb-phase') {
            phases.push(detail.payload.phase);
        }
    };
    window.addEventListener(PRISMA_BROWSER_METRIC_EVENT, listener);
    try {
        run();
    } finally {
        window.removeEventListener(PRISMA_BROWSER_METRIC_EVENT, listener);
    }
    return phases;
}

const EVENT: VoiceEvent = {
    id: 'voice-1',
    timestamp: '2026-08-27T12:00:00.000Z',
    text: 'Unified response',
    question: 'Unified question',
};
const SOURCE: PrismaVoiceAudioSource = { playbackTransport: 'progressive', openLive: vi.fn() };

interface FakeOrbAudioTarget { level: number; setSpeaking: ReturnType<typeof vi.fn> }

function createEngine(): {
    engine: PrismaVoiceAudioEngineContract;
    lifecycles: VoicePlaybackLifecycle[];
    targets: FakeOrbAudioTarget[];
} {
    const lifecycles: VoicePlaybackLifecycle[] = [];
    const targets: FakeOrbAudioTarget[] = [];
    const engine: PrismaVoiceAudioEngineContract = {
        play: vi.fn((_source, target, lifecycle) => {
            lifecycles.push(lifecycle);
            targets.push(target as unknown as FakeOrbAudioTarget);
        }),
        warmAudioContext: vi.fn(),
        stop: vi.fn(),
        dispose: vi.fn(),
    };
    return { engine, lifecycles, targets };
}

function attachOrb(result: { current: { orbRef: { current: LedaOrbElement | null } } }): FakeOrbAudioTarget {
    const orb = { level: 0, setSpeaking: vi.fn() };
    result.current.orbRef.current = orb as unknown as LedaOrbElement;
    return orb;
}

describe('usePrismaOrbPresentation', () => {
    afterEach(() => vi.useRealTimers());

    it('creates one progressive source request and enters the thinking phase', () => {
        const factory = vi.fn<PrismaVoiceAudioSourceFactory>(() => SOURCE);
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine: createEngine().engine, audioSourceFactory: factory }));

        act(() => result.current.presentVoiceEvent(EVENT));

        expect(factory).toHaveBeenCalledWith({ eventId: 'voice-1' });
        expect(result.current.phase).toBe('thinking');
    });

    it('never forwards Telegram identity or transcript', () => {
        const factory = vi.fn<PrismaVoiceAudioSourceFactory>(() => SOURCE);
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine: createEngine().engine, audioSourceFactory: factory }));

        act(() => result.current.presentVoiceEvent({ ...EVENT, telegramChatId: -100123 }));

        expect(factory).toHaveBeenCalledWith({ eventId: EVENT.id });
    });

    it('moves to visible once the engine reports playback started', () => {
        const { engine, lifecycles } = createEngine();
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));
        attachOrb(result);

        act(() => result.current.presentVoiceEvent(EVENT));
        expect(result.current.phase).toBe('thinking');

        act(() => lifecycles[0]?.onStarted?.());
        expect(result.current.phase).toBe('visible');
    });

    it('fades once after progressive playback ends', () => {
        vi.useFakeTimers();
        const { engine, lifecycles } = createEngine();
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));
        attachOrb(result);

        act(() => result.current.presentVoiceEvent(EVENT));
        act(() => lifecycles[0]?.onStarted?.());
        act(() => {
            lifecycles[0]?.onEnded?.();
            lifecycles[0]?.onEnded?.();
        });
        expect(result.current.phase).toBe('fading');
        act(() => vi.advanceTimersByTime(PRISMA_ORB_FADE_DURATION_MS));
        expect(result.current.phase).toBe('hidden');
    });

    it('uses the same fade cleanup after a controlled playback error', () => {
        vi.useFakeTimers();
        const { engine, lifecycles } = createEngine();
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));
        attachOrb(result);
        act(() => result.current.presentVoiceEvent(EVENT));

        act(() => lifecycles[0]?.onError?.(new Error('Playback failed')));
        expect(result.current.phase).toBe('fading');
        act(() => vi.advanceTimersByTime(PRISMA_ORB_FADE_DURATION_MS));

        expect(result.current.phase).toBe('hidden');
    });

    it('fades out after the bounded thinking timeout when onStarted never fires', () => {
        vi.useFakeTimers();
        const { engine } = createEngine();
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));
        attachOrb(result);

        act(() => result.current.presentVoiceEvent(EVENT));
        expect(result.current.phase).toBe('thinking');

        act(() => vi.advanceTimersByTime(PRISMA_ORB_THINKING_TIMEOUT_MS));
        expect(result.current.phase).toBe('fading');

        act(() => vi.advanceTimersByTime(PRISMA_ORB_FADE_DURATION_MS));
        expect(result.current.phase).toBe('hidden');
    });

    it('clears the thinking timeout once playback actually starts', () => {
        vi.useFakeTimers();
        const { engine, lifecycles } = createEngine();
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));
        attachOrb(result);

        act(() => result.current.presentVoiceEvent(EVENT));
        act(() => lifecycles[0]?.onStarted?.());

        act(() => vi.advanceTimersByTime(PRISMA_ORB_THINKING_TIMEOUT_MS));
        expect(result.current.phase).toBe('visible');
    });

    it('ignores stale terminal callbacks after a newer event', () => {
        const { engine, lifecycles } = createEngine();
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));
        attachOrb(result);

        act(() => result.current.presentVoiceEvent(EVENT));
        act(() => result.current.presentVoiceEvent({ ...EVENT, id: 'voice-2' }));
        act(() => lifecycles[0]?.onEnded?.());

        expect(result.current.phase).toBe('thinking');
    });

    it('restarts at thinking when a new event arrives while the previous answer is fading', () => {
        vi.useFakeTimers();
        const { engine, lifecycles } = createEngine();
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));
        attachOrb(result);

        act(() => result.current.presentVoiceEvent(EVENT));
        act(() => lifecycles[0]?.onStarted?.());
        act(() => lifecycles[0]?.onEnded?.());
        expect(result.current.phase).toBe('fading');

        act(() => result.current.presentVoiceEvent({ ...EVENT, id: 'voice-2' }));
        expect(result.current.phase).toBe('thinking');

        // The superseded fade timer must not fire "hidden" for the new request.
        act(() => vi.advanceTimersByTime(PRISMA_ORB_FADE_DURATION_MS));
        expect(result.current.phase).toBe('thinking');
    });

    it('disposes the engine on unmount', () => {
        const { engine } = createEngine();
        const { unmount } = renderHook(() => usePrismaOrbPresentation({ engine }));

        unmount();

        expect(engine.dispose).toHaveBeenCalledTimes(1);
    });

    it('stops buffered playback when the local document session resets', () => {
        const { engine } = createEngine();
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));
        attachOrb(result);
        act(() => result.current.presentVoiceEvent(EVENT));

        act(() => prismaSessionClient.reset({ close: false }));

        expect(engine.stop).toHaveBeenCalledTimes(1);
        expect(result.current.phase).toBe('hidden');
    });

    it('records a T16 orb-phase timeline entry for a full thinking-to-hidden lifecycle', () => {
        vi.useFakeTimers();
        const { engine, lifecycles } = createEngine();
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));
        attachOrb(result);

        const phases = collectOrbPhaseRecords(() => {
            act(() => result.current.presentVoiceEvent(EVENT));
            act(() => lifecycles[0]?.onStarted?.());
            act(() => lifecycles[0]?.onEnded?.());
            act(() => vi.advanceTimersByTime(PRISMA_ORB_FADE_DURATION_MS));
        });

        expect(phases).toEqual(['thinking', 'visible', 'fading', 'hidden']);
    });

    it('records thinking then fading then hidden when playback ends without ever starting', () => {
        vi.useFakeTimers();
        const { engine, lifecycles } = createEngine();
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));
        attachOrb(result);

        const phases = collectOrbPhaseRecords(() => {
            act(() => result.current.presentVoiceEvent(EVENT));
            act(() => lifecycles[0]?.onError?.(new Error('never started')));
            act(() => vi.advanceTimersByTime(PRISMA_ORB_FADE_DURATION_MS));
        });

        expect(phases).toEqual(['thinking', 'fading', 'hidden']);
    });

    it('records a hidden orb-phase entry when the session resets mid-playback', () => {
        const { engine } = createEngine();
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));
        attachOrb(result);
        act(() => result.current.presentVoiceEvent(EVENT));

        const phases = collectOrbPhaseRecords(() => {
            act(() => prismaSessionClient.reset({ close: false }));
        });

        expect(phases).toEqual(['hidden']);
    });

    it('keeps the engine speaking contract untouched: play still receives exactly the three lifecycle callbacks', () => {
        const { engine, lifecycles } = createEngine();
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));
        attachOrb(result);

        act(() => result.current.presentVoiceEvent(EVENT));

        expect(engine.play).toHaveBeenCalledTimes(1);
        expect(Object.keys(lifecycles[0] ?? {}).sort()).toEqual(['onEnded', 'onError', 'onStarted']);
    });

    it('never calls setSpeaking itself; that stays the engine\'s responsibility', () => {
        const { engine, lifecycles } = createEngine();
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));
        const orb = attachOrb(result);

        act(() => result.current.presentVoiceEvent(EVENT));
        act(() => lifecycles[0]?.onStarted?.());
        act(() => lifecycles[0]?.onEnded?.());

        expect(orb.setSpeaking).not.toHaveBeenCalled();
    });

    describe('T21: decoupled from the orb overlay mount', () => {
        it('starts the engine synchronously on event receipt even when the orb has not mounted yet', () => {
            const { engine } = createEngine();
            const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));
            // Deliberately no attachOrb(result) -- orbRef.current stays null.

            act(() => result.current.presentVoiceEvent(EVENT));

            expect(engine.play).toHaveBeenCalledTimes(1);
            expect(result.current.phase).toBe('thinking');
        });

        it('buffers level/speaking updates on the deferred target and replays them once the orb mounts', () => {
            const { engine, targets } = createEngine();
            const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));

            act(() => result.current.presentVoiceEvent(EVENT));
            const target = targets[0];
            expect(target).toBeDefined();

            // The engine drives the target exactly as it would a real orb,
            // before any orb DOM node exists.
            target.setSpeaking(true);
            target.level = 0.42;

            const orb = attachOrb(result);

            expect(orb.setSpeaking).toHaveBeenCalledWith(true);
            expect(orb.level).toBe(0.42);
        });

        it('forwards further updates live once the orb has attached', () => {
            const { engine, targets } = createEngine();
            const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));

            act(() => result.current.presentVoiceEvent(EVENT));
            const orb = attachOrb(result);
            const target = targets[0];

            target.setSpeaking(true);
            target.level = 0.9;

            expect(orb.setSpeaking).toHaveBeenLastCalledWith(true);
            expect(orb.level).toBe(0.9);
        });

        it('attaches immediately when the orb is already mounted from a previous answer', () => {
            const { engine, targets } = createEngine();
            const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));
            const orb = attachOrb(result);

            act(() => result.current.presentVoiceEvent(EVENT));
            targets[0].setSpeaking(true);

            expect(orb.setSpeaking).toHaveBeenCalledWith(true);
        });
    });
});
