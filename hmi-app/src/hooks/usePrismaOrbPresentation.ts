import { startTransition, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { resolvePrismaTtsUrl } from '../config/prismaAssistant.config';
import type { VoiceEvent } from '../domain/voice.types';
import { normalizeTelegramChatId } from '../domain/voice';
import { readPrismaVoiceTtsServiceUrl } from '../config/prismaVoiceTts.config';
import {
    PrismaVoiceAudioEngine,
} from '../services/prismaVoiceAudioEngine';
import type {
    PrismaVoiceAudioEngineContract,
    PrismaVoiceAudioSource,
} from '../services/prismaVoiceAudioEngine';
import {
    createPrismaVoiceTtsAudioSource,
} from '../services/prismaVoiceTtsAudioSource';
import type {
    PrismaVoiceAudioSourceFactory,
} from '../services/prismaVoiceTtsAudioSource';
import type { LedaOrbElement } from '../vendor/leda-orb.js';
import { usePrismaRuntimeProfile } from './usePrismaRuntimeProfile';

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
    getServiceUrl?: () => string;
}

interface PlaybackRequest {
    generation: number;
    audioSource: PrismaVoiceAudioSource;
}

interface FadeTimerRef {
    current: ReturnType<typeof setTimeout> | null;
}

function clearFadeTimer(timerRef: FadeTimerRef): void {
    if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
    }
}

export function usePrismaOrbPresentation(
    options: PrismaOrbPresentationOptions = {},
): PrismaOrbPresentation {
    const [phase, setPhase] = useState<PrismaOrbPresentationPhase>('hidden');
    const [request, setRequest] = useState<PlaybackRequest | null>(null);
    const orbRef = useRef<LedaOrbElement>(null);
    const engineRef = useRef<PrismaVoiceAudioEngineContract | null>(null);
    const runtimeProfile = usePrismaRuntimeProfile();
    const profileRevisionRef = useRef(runtimeProfile.revision);
    const audioSourceFactoryRef = useRef<PrismaVoiceAudioSourceFactory>(
        options.audioSourceFactory ?? createPrismaVoiceTtsAudioSource,
    );
    const getServiceUrlRef = useRef(options.getServiceUrl ?? readPrismaVoiceTtsServiceUrl);
    const generationRef = useRef(0);
    const startedGenerationRef = useRef(0);
    const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    if (engineRef.current === null) {
        engineRef.current = options.engine ?? new PrismaVoiceAudioEngine();
    }

    useLayoutEffect(() => {
        if (profileRevisionRef.current === runtimeProfile.revision) {
            return;
        }

        profileRevisionRef.current = runtimeProfile.revision;
        generationRef.current += 1;
        const resetGeneration = generationRef.current;
        clearFadeTimer(fadeTimerRef);
        engineRef.current?.stop();
        if (profileRevisionRef.current !== runtimeProfile.revision
            || generationRef.current !== resetGeneration) {
            return;
        }

        startTransition(() => {
            setRequest(null);
            setPhase('hidden');
        });
    }, [runtimeProfile.revision]);

    const presentVoiceEvent = (event: VoiceEvent): void => {
        generationRef.current += 1;
        clearFadeTimer(fadeTimerRef);
        const telegramChatId = normalizeTelegramChatId(event.telegramChatId);
        const audioSource = audioSourceFactoryRef.current({
            serviceUrl: resolvePrismaTtsUrl(
                runtimeProfile.mode,
                getServiceUrlRef.current(),
            ),
            fallbackPolicy: runtimeProfile.mode === 'local' ? 'none' : 'legacy-wav',
            playbackTransport: runtimeProfile.mode === 'local'
                ? 'buffer-before-playback'
                : 'progressive',
            text: event.text,
            ...(event.id === undefined ? {} : { eventId: event.id }),
            ...(telegramChatId === undefined ? {} : { telegramChatId }),
        });
        if (!audioSource) {
            startedGenerationRef.current = generationRef.current;
            engineRef.current?.stop();
            setRequest(null);
            setPhase('hidden');
            return;
        }

        setPhase(runtimeProfile.mode === 'local' ? 'buffering' : 'visible');
        setRequest({ generation: generationRef.current, audioSource });
    };

    useLayoutEffect(() => {
        const engine = engineRef.current;
        const orb = orbRef.current;
        if (!request || !engine || !orb
            || startedGenerationRef.current === request.generation) {
            return;
        }

        startedGenerationRef.current = request.generation;
        let terminalCallbackHandled = false;
        const beginFade = (): void => {
            if (generationRef.current !== request.generation) {
                return;
            }

            if (terminalCallbackHandled) {
                return;
            }

            terminalCallbackHandled = true;

            clearFadeTimer(fadeTimerRef);
            setPhase('fading');
            fadeTimerRef.current = setTimeout(() => {
                if (generationRef.current !== request.generation) {
                    return;
                }

                fadeTimerRef.current = null;
                setPhase('hidden');
                setRequest(null);
            }, PRISMA_ORB_FADE_DURATION_MS);
        };
        const hideAfterError = (): void => {
            if (generationRef.current !== request.generation || terminalCallbackHandled) {
                return;
            }

            terminalCallbackHandled = true;
            clearFadeTimer(fadeTimerRef);
            setPhase('hidden');
            setRequest(null);
        };
        const handleStarted = (): void => {
            if (generationRef.current !== request.generation || terminalCallbackHandled) {
                return;
            }

            if (request.audioSource.playbackTransport === 'buffer-before-playback') {
                setPhase('visible');
            }
        };
        engine.play(request.audioSource, orb, {
            onStarted: handleStarted,
            onEnded: beginFade,
            onError: request.audioSource.playbackTransport === 'buffer-before-playback'
                ? hideAfterError
                : beginFade,
        });
    }, [request]);

    useLayoutEffect(() => () => {
        generationRef.current += 1;
        clearFadeTimer(fadeTimerRef);
        engineRef.current?.dispose();
    }, []);

    return {
        phase,
        orbRef,
        presentVoiceEvent,
    };
}
