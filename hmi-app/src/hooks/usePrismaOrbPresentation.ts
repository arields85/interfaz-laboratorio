import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import type { PrismaAudioMetricPhase } from '../domain/prismaAudioMetric.types';
import type { VoiceEvent } from '../domain/voice.types';
import { PrismaVoiceAudioEngine } from '../services/prismaVoiceAudioEngine';
import type { PrismaVoiceAudioEngineContract, PrismaVoiceAudioSource } from '../services/prismaVoiceAudioEngine';
import { prismaSessionClient } from '../services/prismaSessionClient';
import { recordOrbPhase } from '../services/prismaVoiceTimelineRecorder';
import { createPrismaVoiceTtsAudioSource } from '../services/prismaVoiceTtsAudioSource';
import type { PrismaVoiceAudioSourceFactory } from '../services/prismaVoiceTtsAudioSource';
import type { LedaOrbElement } from '../vendor/leda-orb.js';

// T17: the overlay's smooth fade-out when speech ends, replacing the old
// abrupt 200 ms disappearance. Chosen at the low end of the 600-800 ms
// range agreed with the user -- long enough to read as a fade rather than
// a cut, short enough that the orb does not linger noticeably after the
// answer ends. PrismaOrbOverlay.tsx reads this constant directly (inline
// `transitionDuration`), so there is exactly one source of truth for the
// number.
export const PRISMA_ORB_FADE_DURATION_MS = 700;

// T17: thinking -> speaking transition duration. The overlay grows from
// the thinking scale/opacity to full size while the engine starts voice
// modulation, per the user-agreed design ("~400 ms with an ease curve").
// Also read directly by PrismaOrbOverlay.tsx, same single-source reason as
// the constant above.
export const PRISMA_ORB_GROW_DURATION_MS = 400;

// T17: bounded ceiling for the thinking phase when playback never starts
// (`onStarted` never fires -- a stale discard, a provider error surfaced
// only as a stream failure, or a hang). Chosen from the ~8-10 s range
// agreed with the user: comfortably above every first-chunk time observed
// live (T13 evidence: 0.6-2.1 s typical on the current TTS model, up to
// ~8.7 s stream end recorded earlier on the retired model) while staying
// bounded, so the orb never waits in "thinking" forever.
export const PRISMA_ORB_THINKING_TIMEOUT_MS = 9_000;

// Tied to the generated T16 timeline's own phase enum (schemas/prisma-audio-
// record.v1.schema.json -> prismaAudioMetric.generated.ts) instead of a
// separately hand-maintained union, so the two can never silently drift
// apart -- recordOrbPhase(next) (below) only type-checks because both sides
// agree on the same four values.
export type PrismaOrbPresentationPhase = PrismaAudioMetricPhase;

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
    const thinkingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    if (engineRef.current === null) {
        engineRef.current = options.engine ?? new PrismaVoiceAudioEngine();
    }

    const clearFadeTimer = (): void => {
        if (fadeTimerRef.current !== null) {
            clearTimeout(fadeTimerRef.current);
            fadeTimerRef.current = null;
        }
    };

    // T17: bounds how long the orb can stay in "thinking" -- cleared as soon
    // as playback actually starts (onStarted) or the request is abandoned
    // (fade, unmount, session reset).
    const clearThinkingTimeout = (): void => {
        if (thinkingTimeoutRef.current !== null) {
            clearTimeout(thinkingTimeoutRef.current);
            thinkingTimeoutRef.current = null;
        }
    };

    // T16: every phase transition also lands one orb-phase browser voice
    // timeline record (see prismaVoiceTimelineRecorder.ts), so the parent
    // can read the runtime log for exactly when the orb showed/hid instead
    // of the user copying the browser console.
    const updatePhase = (next: PrismaOrbPresentationPhase): void => {
        recordOrbPhase(next);
        setPhase(next);
    };

    // T17: every new voice event -- including one arriving while the
    // previous answer is still speaking or fading out -- restarts at
    // "thinking" from whatever the overlay currently looks like. There is
    // no explicit visual reset here: the overlay's own CSS transition
    // (PrismaOrbOverlay.tsx) interpolates from the current opacity/scale to
    // the thinking target, so this never produces a hard jump.
    const presentVoiceEvent = (event: VoiceEvent): void => {
        const eventId = event.id?.trim();
        if (!eventId) return;
        generationRef.current += 1;
        clearFadeTimer();
        clearThinkingTimeout();
        const audioSource = audioSourceFactoryRef.current({ eventId });
        updatePhase('thinking');
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
            clearThinkingTimeout();
            updatePhase('fading');
            fadeTimerRef.current = setTimeout(() => {
                if (generationRef.current !== request.generation) return;
                fadeTimerRef.current = null;
                updatePhase('hidden');
                setRequest(null);
            }, PRISMA_ORB_FADE_DURATION_MS);
        };
        // T17: never stay in "thinking" forever -- if onStarted never fires
        // (stale discard, an error surfaced only as a stream failure, a
        // hang), fade out on this bounded timeout instead.
        thinkingTimeoutRef.current = setTimeout(() => {
            thinkingTimeoutRef.current = null;
            beginFade();
        }, PRISMA_ORB_THINKING_TIMEOUT_MS);
        engine.play(request.audioSource, orb, {
            onStarted: () => {
                if (generationRef.current !== request.generation || terminalCallbackHandled) return;
                clearThinkingTimeout();
                updatePhase('visible');
            },
            onEnded: beginFade,
            onError: beginFade,
        });
    }, [request]);

    useLayoutEffect(() => () => {
        generationRef.current += 1;
        clearFadeTimer();
        clearThinkingTimeout();
        engineRef.current?.dispose();
    }, []);

    useLayoutEffect(() => prismaSessionClient.subscribeToReset(() => {
        generationRef.current += 1;
        clearFadeTimer();
        clearThinkingTimeout();
        engineRef.current?.stop();
        setRequest(null);
        updatePhase('hidden');
    }), []);

    return { phase, orbRef, presentVoiceEvent };
}
