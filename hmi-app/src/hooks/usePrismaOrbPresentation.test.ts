import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { savePrismaRuntimeMode } from '../config/prismaRuntime.config';
import type { VoiceEvent } from '../domain/voice.types';
import type { PrismaVoiceAudioEngineContract, PrismaVoiceAudioSource } from '../services/prismaVoiceAudioEngine';
import type { PrismaVoiceAudioSourceFactory } from '../services/prismaVoiceTtsAudioSource';
import type { LedaOrbElement } from '../vendor/leda-orb.js';
import { PRISMA_ORB_FADE_DURATION_MS, usePrismaOrbPresentation } from './usePrismaOrbPresentation';

const EVENT: VoiceEvent = { id: 'voice-local-1', timestamp: '2026-08-27T12:00:00.000Z', text: 'Local response', question: 'Local question' };

const SOURCE: PrismaVoiceAudioSource = {
    playbackTransport: 'progressive',
    openLive: vi.fn(),
} as unknown as PrismaVoiceAudioSource;

const LOCAL_SOURCE: PrismaVoiceAudioSource = {
    playbackTransport: 'buffer-before-playback',
    openLive: vi.fn(),
} as unknown as PrismaVoiceAudioSource;

const LEGACY_DASHBOARD_SNAPSHOT: VoiceEvent = {
    timestamp: '2026-08-27T12:04:00.000Z',
    text: 'Legacy dashboard response',
    question: 'What remains visible?',
};

function createEngine(): PrismaVoiceAudioEngineContract {
    return { play: vi.fn(), stop: vi.fn(), dispose: vi.fn() };
}

function attachOrb(result: { current: { orbRef: { current: LedaOrbElement | null } } }): void {
    result.current.orbRef.current = {
        level: 0,
        setSpeaking: vi.fn(),
    } as unknown as LedaOrbElement;
}

describe('usePrismaOrbPresentation', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('routes TTS source creation to the fixed local service URL', () => {
        savePrismaRuntimeMode('local');
        const engine = createEngine();
        const audioSourceFactory = vi.fn<PrismaVoiceAudioSourceFactory>(() => SOURCE);
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory }));

        act(() => result.current.presentVoiceEvent(EVENT));

        expect(audioSourceFactory).toHaveBeenCalledWith({
            serviceUrl: 'http://127.0.0.1:5056/prisma/speak-live',
            fallbackPolicy: 'none',
            playbackTransport: 'buffer-before-playback',
            text: 'Local response',
            eventId: 'voice-local-1',
        });
    });

    it('retains the Legacy WAV fallback capability for Server source creation', () => {
        const engine = createEngine();
        const audioSourceFactory = vi.fn<PrismaVoiceAudioSourceFactory>(() => SOURCE);
        const { result } = renderHook(() => usePrismaOrbPresentation({
            engine,
            audioSourceFactory,
            getServiceUrl: () => 'https://server.example/prisma/speak-live',
        }));

        act(() => result.current.presentVoiceEvent(EVENT));

        expect(audioSourceFactory).toHaveBeenCalledWith({
            serviceUrl: 'https://server.example/prisma/speak-live',
            fallbackPolicy: 'legacy-wav',
            playbackTransport: 'progressive',
            text: 'Local response',
            eventId: 'voice-local-1',
        });
    });

    it('preserves the Legacy dashboard snapshot when creating its presentation request', () => {
        const audioSourceFactory = vi.fn<PrismaVoiceAudioSourceFactory>(() => SOURCE);
        const { result } = renderHook(() => usePrismaOrbPresentation({
            engine: createEngine(),
            audioSourceFactory,
            getServiceUrl: () => 'https://server.example/prisma/speak-live',
        }));

        act(() => result.current.presentVoiceEvent(LEGACY_DASHBOARD_SNAPSHOT));

        expect(audioSourceFactory).toHaveBeenCalledWith({
            serviceUrl: 'https://server.example/prisma/speak-live',
            fallbackPolicy: 'legacy-wav',
            playbackTransport: 'progressive',
            text: 'Legacy dashboard response',
        });
    });

    it('keeps the Legacy presentation timing through its terminal callback', () => {
        vi.useFakeTimers();
        const lifecycle: Array<{ onStarted?: () => void; onEnded?: () => void }> = [];
        const engine: PrismaVoiceAudioEngineContract = {
            play: vi.fn((_source, _target, nextLifecycle) => lifecycle.push(nextLifecycle)),
            stop: vi.fn(),
            dispose: vi.fn(),
        };
        const { result } = renderHook(() => usePrismaOrbPresentation({
            engine,
            audioSourceFactory: () => SOURCE,
            getServiceUrl: () => 'https://server.example/prisma/speak-live',
        }));
        attachOrb(result);

        act(() => result.current.presentVoiceEvent(LEGACY_DASHBOARD_SNAPSHOT));
        expect(result.current.phase).toBe('visible');
        act(() => lifecycle[0]?.onStarted?.());
        expect(result.current.phase).toBe('visible');
        act(() => lifecycle[0]?.onEnded?.());
        expect(result.current.phase).toBe('fading');
        act(() => vi.advanceTimersByTime(PRISMA_ORB_FADE_DURATION_MS - 1));
        expect(result.current.phase).toBe('fading');
        act(() => vi.advanceTimersByTime(1));
        expect(result.current.phase).toBe('hidden');
    });

    it('stops active TTS before replacing it after a profile switch', () => {
        const engine = createEngine();
        const { result } = renderHook(() => usePrismaOrbPresentation({
            engine,
            audioSourceFactory: () => SOURCE,
            getServiceUrl: () => 'https://node-red.local/prisma/speak-live',
        }));

        act(() => result.current.presentVoiceEvent(EVENT));
        act(() => savePrismaRuntimeMode('local'));

        expect(engine.stop).toHaveBeenCalledTimes(1);
    });

    it('keeps Local buffering mounted but hidden until onStarted, then fades once after onEnded', () => {
        vi.useFakeTimers();
        savePrismaRuntimeMode('local');
        const lifecycle: Array<{ onStarted?: () => void; onEnded?: () => void; onError?: (error: unknown) => void }> = [];
        const engine: PrismaVoiceAudioEngineContract = {
            play: vi.fn((_source, _target, nextLifecycle) => lifecycle.push(nextLifecycle)),
            stop: vi.fn(),
            dispose: vi.fn(),
        };
        const { result } = renderHook(() => usePrismaOrbPresentation({
            engine,
            audioSourceFactory: () => LOCAL_SOURCE,
        }));
        attachOrb(result);

        act(() => result.current.presentVoiceEvent(EVENT));
        expect(result.current.phase).toBe('buffering');
        act(() => lifecycle[0]?.onStarted?.());
        expect(result.current.phase).toBe('visible');

        act(() => {
            lifecycle[0]?.onEnded?.();
            lifecycle[0]?.onEnded?.();
        });
        expect(result.current.phase).toBe('fading');
        act(() => vi.advanceTimersByTime(PRISMA_ORB_FADE_DURATION_MS));
        expect(result.current.phase).toBe('hidden');
    });

    it.each([
        ['an error', (next: { onError?: (error: unknown) => void }) => next.onError?.(new Error('test'))],
        ['cancellation by profile switch', undefined],
    ])('keeps Local hidden after %s and ignores stale onStarted', (_case, trigger) => {
        savePrismaRuntimeMode('local');
        const lifecycle: Array<{ onStarted?: () => void; onError?: (error: unknown) => void }> = [];
        const engine: PrismaVoiceAudioEngineContract = {
            play: vi.fn((_source, _target, nextLifecycle) => lifecycle.push(nextLifecycle)),
            stop: vi.fn(),
            dispose: vi.fn(),
        };
        const { result } = renderHook(() => usePrismaOrbPresentation({
            engine,
            audioSourceFactory: () => LOCAL_SOURCE,
        }));
        attachOrb(result);

        act(() => result.current.presentVoiceEvent(EVENT));
        if (trigger) {
            act(() => trigger(lifecycle[0] ?? {}));
        } else {
            act(() => savePrismaRuntimeMode('central'));
        }
        expect(result.current.phase).toBe('hidden');
        act(() => lifecycle[0]?.onStarted?.());
        expect(result.current.phase).toBe('hidden');
    });

    it('ignores a stale Local onStarted after event replacement', () => {
        savePrismaRuntimeMode('local');
        const lifecycle: Array<{ onStarted?: () => void }> = [];
        const engine: PrismaVoiceAudioEngineContract = {
            play: vi.fn((_source, _target, nextLifecycle) => lifecycle.push(nextLifecycle)),
            stop: vi.fn(),
            dispose: vi.fn(),
        };
        const { result } = renderHook(() => usePrismaOrbPresentation({
            engine,
            audioSourceFactory: () => LOCAL_SOURCE,
        }));
        attachOrb(result);

        act(() => result.current.presentVoiceEvent(EVENT));
        act(() => result.current.presentVoiceEvent({ ...EVENT, id: 'voice-local-2' }));
        act(() => lifecycle[0]?.onStarted?.());
        expect(result.current.phase).toBe('buffering');
        act(() => lifecycle[1]?.onStarted?.());
        expect(result.current.phase).toBe('visible');
    });
});
