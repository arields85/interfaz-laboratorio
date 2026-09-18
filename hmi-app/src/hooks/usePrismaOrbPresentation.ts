import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import type { VoiceEvent } from '../domain/voice.types';
import { PrismaVoiceAudioEngine } from '../services/prismaVoiceAudioEngine';
import type { PrismaVoiceAudioEngineContract, PrismaVoiceAudioSource } from '../services/prismaVoiceAudioEngine';
import { prismaSessionClient } from '../services/prismaSessionClient';
import { createPrismaVoiceTtsAudioSource } from '../services/prismaVoiceTtsAudioSource';
import type { PrismaVoiceAudioSourceFactory } from '../services/prismaVoiceTtsAudioSource';
import type { LedaOrbElement } from '../vendor/leda-orb.js';

export const PRISMA_ORB_FADE_DURATION_MS = 200;

export type PrismaOrbPresentationPhase = 'hidden' | 'buffering' | 'visible' | 'fading';

interface PrismaOrbPresentation {
    phase: PrismaOrbPresentationPhase;
    orbRef: RefObject<LedaOrbElement | null>;
    presentVoiceEvent: (event: VoiceEvent) => void;
}

interface PrismaOrbPresentationOptions {
    engine?: PrismaVoiceAudioEngineContract;
    audioSourceFactory?: PrismaVoiceAudioSourceFactory;
}

interface PlaybackRequest {
    generation: number;
    audioSource: PrismaVoiceAudioSource;
}

export function usePrismaOrbPresentation(
    options: PrismaOrbPresentationOptions = {},
): PrismaOrbPresentation {
    const [phase, setPhase] = useState<PrismaOrbPresentationPhase>('hidden');
    const [request, setRequest] = useState<PlaybackRequest | null>(null);
    const orbRef = useRef<LedaOrbElement>(null);
    const engineRef = useRef<PrismaVoiceAudioEngineContract | null>(null);
    const audioSourceFactoryRef = useRef(options.audioSourceFactory ?? createPrismaVoiceTtsAudioSource);
    const generationRef = useRef(0);
    const startedGenerationRef = useRef(0);
    const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    if (engineRef.current === null) {
        engineRef.current = options.engine ?? new PrismaVoiceAudioEngine();
    }

    const clearFadeTimer = (): void => {
        if (fadeTimerRef.current !== null) {
            clearTimeout(fadeTimerRef.current);
            fadeTimerRef.current = null;
        }
    };

    const presentVoiceEvent = (event: VoiceEvent): void => {
        const eventId = event.id?.trim();
        if (!eventId) return;
        generationRef.current += 1;
        clearFadeTimer();
        const audioSource = audioSourceFactoryRef.current({ eventId });
        setPhase('visible');
        setRequest({ generation: generationRef.current, audioSource });
    };

    useLayoutEffect(() => {
        const engine = engineRef.current;
        const orb = orbRef.current;
        if (!request || !engine || !orb || startedGenerationRef.current === request.generation) return;

        startedGenerationRef.current = request.generation;
        let terminalCallbackHandled = false;
        const beginFade = (): void => {
            if (generationRef.current !== request.generation || terminalCallbackHandled) return;
            terminalCallbackHandled = true;
            clearFadeTimer();
            setPhase('fading');
            fadeTimerRef.current = setTimeout(() => {
                if (generationRef.current !== request.generation) return;
                fadeTimerRef.current = null;
                setPhase('hidden');
                setRequest(null);
            }, PRISMA_ORB_FADE_DURATION_MS);
        };
        engine.play(request.audioSource, orb, {
            onStarted: () => undefined,
            onEnded: beginFade,
            onError: beginFade,
        });
    }, [request]);

    useLayoutEffect(() => () => {
        generationRef.current += 1;
        clearFadeTimer();
        engineRef.current?.dispose();
    }, []);

    useLayoutEffect(() => prismaSessionClient.subscribeToReset(() => {
        generationRef.current += 1;
        clearFadeTimer();
        engineRef.current?.stop();
        setRequest(null);
        setPhase('hidden');
    }), []);

    return { phase, orbRef, presentVoiceEvent };
}
