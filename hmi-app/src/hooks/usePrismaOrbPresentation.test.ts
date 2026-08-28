import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { savePrismaRuntimeMode } from '../config/prismaRuntime.config';
import type { VoiceEvent } from '../domain/voice.types';
import type { PrismaVoiceAudioEngineContract, PrismaVoiceAudioSource } from '../services/prismaVoiceAudioEngine';
import type { PrismaVoiceAudioSourceFactory } from '../services/prismaVoiceTtsAudioSource';
import { usePrismaOrbPresentation } from './usePrismaOrbPresentation';

const EVENT: VoiceEvent = { id: 'voice-local-1', timestamp: '2026-08-27T12:00:00.000Z', text: 'Local response', question: 'Local question' };

const SOURCE: PrismaVoiceAudioSource = { openLive: vi.fn() };

function createEngine(): PrismaVoiceAudioEngineContract {
    return { play: vi.fn(), stop: vi.fn(), dispose: vi.fn() };
}

describe('usePrismaOrbPresentation', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('routes TTS source creation to the fixed local service URL', () => {
        savePrismaRuntimeMode('local');
        const engine = createEngine();
        const audioSourceFactory = vi.fn<PrismaVoiceAudioSourceFactory>(() => SOURCE);
        const { result } = renderHook(() => usePrismaOrbPresentation({ engine, audioSourceFactory }));

        act(() => result.current.presentVoiceEvent(EVENT));

        expect(audioSourceFactory).toHaveBeenCalledWith({
            serviceUrl: 'http://127.0.0.1:5056/prisma/speak-live',
            text: 'Local response',
            eventId: 'voice-local-1',
        });
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
});
