import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VoiceEvent } from '../domain/voice.types';
import type { PrismaVoiceAudioEngineContract, PrismaVoiceAudioSource, VoicePlaybackLifecycle } from '../services/prismaVoiceAudioEngine';
import type { PrismaVoiceAudioSourceFactory } from '../services/prismaVoiceTtsAudioSource';
import type { LedaOrbElement } from '../vendor/leda-orb.js';
import { PRISMA_ORB_FADE_DURATION_MS, usePrismaOrbPresentation } from './usePrismaOrbPresentation';

const EVENT: VoiceEvent = {
    id: 'voice-1',
    timestamp: '2026-08-27T12:00:00.000Z',
    text: 'Unified response',
    question: 'Unified question',
};
const SOURCE: PrismaVoiceAudioSource = { playbackTransport: 'progressive', openLive: vi.fn() };

function createEngine(): PrismaVoiceAudioEngineContract {
    return { play: vi.fn(), stop: vi.fn(), dispose: vi.fn() };
}

function attachOrb(result: { current: { orbRef: { current: LedaOrbElement | null } } }): void {
    result.current.orbRef.current = { level: 0, setSpeaking: vi.fn() } as unknown as LedaOrbElement;
}

describe('usePrismaOrbPresentation', () => {
    afterEach(() => vi.useRealTimers());

    it('creates one progressive source request without endpoint or mode fields', () => {
        const factory = vi.fn<PrismaVoiceAudioSourceFactory>(() => SOURCE);
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine: createEngine(), audioSourceFactory: factory }));

        act(() => result.current.presentVoiceEvent(EVENT));

        expect(factory).toHaveBeenCalledWith({ text: 'Unified response', eventId: 'voice-1' });
        expect(result.current.phase).toBe('visible');
    });

    it('preserves optional Telegram identity normalization', () => {
        const factory = vi.fn<PrismaVoiceAudioSourceFactory>(() => SOURCE);
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine: createEngine(), audioSourceFactory: factory }));

        act(() => result.current.presentVoiceEvent({ ...EVENT, telegramChatId: -100123 }));

        expect(factory).toHaveBeenCalledWith({ text: EVENT.text, eventId: EVENT.id, telegramChatId: -100123 });
    });

    it('fades once after progressive playback ends', () => {
        vi.useFakeTimers();
        const lifecycle: Array<{ onEnded?: () => void }> = [];
        const engine: PrismaVoiceAudioEngineContract = {
            play: vi.fn((_source, _target, next) => lifecycle.push(next)),
            stop: vi.fn(),
            dispose: vi.fn(),
        };
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));
        attachOrb(result);

        act(() => result.current.presentVoiceEvent(EVENT));
        act(() => {
            lifecycle[0]?.onEnded?.();
            lifecycle[0]?.onEnded?.();
        });
        expect(result.current.phase).toBe('fading');
        act(() => vi.advanceTimersByTime(PRISMA_ORB_FADE_DURATION_MS));
        expect(result.current.phase).toBe('hidden');
    });

    it('uses the same fade cleanup after a controlled playback error', () => {
        vi.useFakeTimers();
        const lifecycle: VoicePlaybackLifecycle[] = [];
        const engine: PrismaVoiceAudioEngineContract = {
            play: vi.fn((_source, _target, next) => lifecycle.push(next)),
            stop: vi.fn(),
            dispose: vi.fn(),
        };
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));
        attachOrb(result);
        act(() => result.current.presentVoiceEvent(EVENT));

        act(() => lifecycle[0]?.onError?.(new Error('Playback failed')));
        expect(result.current.phase).toBe('fading');
        act(() => vi.advanceTimersByTime(PRISMA_ORB_FADE_DURATION_MS));

        expect(result.current.phase).toBe('hidden');
    });

    it('ignores stale terminal callbacks after a newer event', () => {
        const lifecycle: Array<{ onEnded?: () => void }> = [];
        const engine: PrismaVoiceAudioEngineContract = {
            play: vi.fn((_source, _target, next) => lifecycle.push(next)),
            stop: vi.fn(),
            dispose: vi.fn(),
        };
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory: () => SOURCE }));
        attachOrb(result);

        act(() => result.current.presentVoiceEvent(EVENT));
        act(() => result.current.presentVoiceEvent({ ...EVENT, id: 'voice-2' }));
        act(() => lifecycle[0]?.onEnded?.());

        expect(result.current.phase).toBe('visible');
    });

    it('disposes the engine on unmount', () => {
        const engine = createEngine();
        const { unmount } = renderHook(() => usePrismaOrbPresentation({ engine }));

        unmount();

        expect(engine.dispose).toHaveBeenCalledTimes(1);
    });
});
