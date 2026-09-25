import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import type { PrismaAudioMetricPhase } from '../domain/prismaAudioMetric.types';
import type { VoiceEvent } from '../domain/voice.types';
import { usePrismaVoiceConfig } from '../queries/usePrismaVoiceConfig';
import { PrismaVoiceAudioEngine } from '../services/prismaVoiceAudioEngine';
import type {
    PrismaOrbAudioTarget,
    PrismaVoiceAudioEngineContract,
} from '../services/prismaVoiceAudioEngine';
import { prismaSessionClient } from '../services/prismaSessionClient';
import { createBrowserPrismaVoiceConfiguredPrebufferPolicy } from '../services/prismaVoicePrebufferController';
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

// T17b: duration of the overlay's very first appearance (fully invisible ->
// the "thinking" look), fired once per hidden -> thinking mount. Chosen
// mid-range of the user-agreed 250-300 ms window: quicker than the 400 ms
// grow (an entrance only crosses opacity, not scale+opacity, so it reads
// complete sooner) while still long enough to read as a fade instead of a
// pop. PrismaOrbOverlay.tsx reads this directly, same single-source-of-truth
// reason as the two constants above.
export const PRISMA_ORB_ENTRY_DURATION_MS = 250;

// T17: bounded ceiling for the thinking phase when playback never starts
// (`onStarted` never fires -- a stale discard, a provider error surfaced
// only as a stream failure, or a hang). Chosen from the ~8-10 s range
// agreed with the user: comfortably above every first-chunk time observed
// live (T13 evidence: 0.6-2.1 s typical on the current TTS model, up to
// ~8.7 s stream end recorded earlier on the retired model) while staying
// bounded, so the orb never waits in "thinking" forever.
export const PRISMA_ORB_THINKING_TIMEOUT_MS = 9_000;

// V3 (voice-overlap): bounded FIFO depth for voice events that arrive while
// the current one is still being presented (thinking or visibly speaking --
// see isActiveRef below). Generous for the real scenario this fixes (a
// couple of consecutive/overlapping Channel A voice notes for the same HMI
// session): only a sustained burst beyond this depth ever drops the newest
// overflow event instead of growing the queue without bound.
export const PRISMA_ORB_VOICE_EVENT_QUEUE_LIMIT = 4;

// voice-ux U1: bounds how long the orb can wait in "thinking" for the real
// answer event after a signal-only "thinking" event (Channel A voice-note
// receipt, before download/transcription) -- distinct from
// PRISMA_ORB_THINKING_TIMEOUT_MS above, which bounds the wait for playback
// to actually start once engine.play() has already been called for a real
// answer. Chosen comfortably above the backend's own worst-case round-trip
// ceiling (VOICE_TRANSCRIPTION_REQUEST_TIMEOUT_SECONDS = 25 s in
// local_presentation.py) so the orb is never hidden out from under a
// transcription that is still legitimately in flight, while staying bounded
// per the requirement ("never stay stuck in thinking").
export const PRISMA_ORB_THINKING_SIGNAL_TIMEOUT_MS = 30_000;

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

interface DeferredOrbAudioTarget extends PrismaOrbAudioTarget {
    /** Wires a now-mounted real orb to receive every future update, and
     * immediately replays whatever level/speaking value was buffered so
     * far. */
    attach(orb: PrismaOrbAudioTarget): void;
}

// T21: `engine.play()` now starts at voice-event receipt, before the orb
// overlay has necessarily mounted its `<leda-orb>` DOM node (mounting it is
// gated behind a React commit, which `presentVoiceEvent` below no longer
// waits on). This stands in for the real orb as the engine's audio target
// until the real orb attaches (see the `orbRef` accessor below): `level`
// writes and `setSpeaking()` calls are buffered and, once `attach()` runs,
// replayed immediately and then forwarded live for every update after that.
function createDeferredOrbAudioTarget(): DeferredOrbAudioTarget {
    let orb: PrismaOrbAudioTarget | null = null;
    let pendingLevel = 0;
    let pendingSpeaking = false;
    // Only replay a value on attach if this target actually received one
    // before the real orb was available -- otherwise `attach()` would fire
    // a spurious `setSpeaking(false)`/`level = 0` for a request whose
    // engine callback simply hasn't run yet, which is not this hook's call
    // to make (driving the orb stays the engine's responsibility).
    let levelTouched = false;
    let speakingTouched = false;
    return {
        get level() {
            return orb ? orb.level : pendingLevel;
        },
        set level(value: number) {
            pendingLevel = value;
            levelTouched = true;
            if (orb) {
                orb.level = value;
            }
        },
        setSpeaking(speaking: boolean) {
            pendingSpeaking = speaking;
            speakingTouched = true;
            orb?.setSpeaking(speaking);
        },
        attach(target: PrismaOrbAudioTarget) {
            orb = target;
            if (levelTouched) {
                target.level = pendingLevel;
            }
            if (speakingTouched) {
                target.setSpeaking(pendingSpeaking);
            }
        },
    };
}

export function usePrismaOrbPresentation(
    options: PrismaOrbPresentationOptions = {},
): PrismaOrbPresentation {
    const [phase, setPhase] = useState<PrismaOrbPresentationPhase>('hidden');
    const orbNodeRef = useRef<LedaOrbElement | null>(null);
    const deferredTargetRef = useRef<DeferredOrbAudioTarget | null>(null);
    // T21: a plain `useRef<LedaOrbElement>(null)` (the previous shape) only
    // stores the node -- it cannot notice the moment the orb actually
    // mounts. This accessor object is structurally still a
    // `RefObject<LedaOrbElement | null>` (React assigns `ref.current = node`
    // as an ordinary property write, so a `get`/`set` pair intercepts it
    // exactly like a plain field would), but its setter also attaches the
    // node to whichever deferred target is currently pending -- the instant
    // React commits the DOM node, not on some later, possibly-skipped
    // effect tick.
    const orbRefHolder = useRef<RefObject<LedaOrbElement | null> | undefined>(undefined);
    if (!orbRefHolder.current) {
        orbRefHolder.current = {
            get current() {
                return orbNodeRef.current;
            },
            set current(node: LedaOrbElement | null) {
                orbNodeRef.current = node;
                if (node) {
                    deferredTargetRef.current?.attach(node);
                }
            },
        };
    }
    const orbRef = orbRefHolder.current;
    const engineRef = useRef<PrismaVoiceAudioEngineContract | null>(null);
    const audioSourceFactoryRef = useRef(options.audioSourceFactory ?? createPrismaVoiceTtsAudioSource);
    const generationRef = useRef(0);
    const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const thinkingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // V3 (voice-overlap): true from the moment an event starts being
    // presented (thinking) until its own terminal fires (onStarted's answer
    // finishing, onError, or the bounded thinking timeout) -- NOT until the
    // cosmetic fade/hidden transition completes, since by the time the
    // terminal fires the answer has already fully played and the fade is
    // pure UI wind-down. A new event arriving while this is true is queued
    // (pendingQueueRef) instead of aborting the in-progress answer.
    const isActiveRef = useRef(false);
    const pendingQueueRef = useRef<VoiceEvent[]>([]);
    // voice-ux U1: true from a signal-only "thinking" event (Channel A voice
    // note accepted, before download/transcription) until either the real
    // answer event arrives, an explicit "cancel" signal arrives, or the
    // bounded signalTimeoutRef below fires -- never while isActiveRef is
    // true (a thinking/cancel signal is a no-op while an answer is actively
    // being presented, per the user's explicit requirement).
    const awaitingSignalAnswerRef = useRef(false);
    const signalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // T4: the shared Prisma voice config carries the user's Automatic/Manual
    // mode choice (`playbackBuffer`). This is the viewer's only current
    // reader of the config query (previously read only by the admin Prisma
    // tab) -- calling it here, in the same hook that already owns the
    // engine/prebuffer-policy wiring, keeps that concern local instead of
    // threading a config prop down from `App.tsx`. `voiceConfigRef` is kept
    // current on every render (a plain "latest ref" write, not an effect)
    // so the policy below -- built once, for the engine's whole lifetime --
    // reads the *current* value at `resolvePrebufferMs()` call time instead
    // of a stale snapshot from whenever the engine happened to be built.
    const voiceConfigQuery = usePrismaVoiceConfig();
    const voiceConfigRef = useRef(voiceConfigQuery.data);
    voiceConfigRef.current = voiceConfigQuery.data;

    if (engineRef.current === null) {
        // T3/T4: production answers resolve the prebuffer through a
        // browser-backed policy that picks Automatic (T2's continuous
        // estimator + localStorage history) or Manual (the configured
        // seconds) per answer, from the current voice config read above.
        // Unavailable/loading/failed config (`null`) falls back to
        // Automatic.
        engineRef.current = options.engine
            ?? new PrismaVoiceAudioEngine({
                prebufferPolicy: createBrowserPrismaVoiceConfiguredPrebufferPolicy(
                    () => voiceConfigRef.current?.playbackBuffer ?? null,
                ),
            });
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

    // voice-ux U1: bounds how long the orb can wait for a real answer after
    // a signal-only "thinking" event -- cleared once the real answer
    // arrives, an explicit cancel arrives, or this timeout itself fires.
    const clearSignalTimeout = (): void => {
        if (signalTimeoutRef.current !== null) {
            clearTimeout(signalTimeoutRef.current);
            signalTimeoutRef.current = null;
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
    //
    // T21: `engine.play()` (and so `source.openLive()`, the speak-live
    // fetch) now starts synchronously, right here, instead of from a
    // `useLayoutEffect` gated on `orbRef.current` being non-null. The audio
    // fetch/decode never needed the orb DOM -- only the visual level/
    // speaking target did -- so this call no longer waits for React to
    // commit and mount (and the `<leda-orb>` custom element to construct)
    // before the request can begin. The deferred target below stands in for
    // the real orb until it mounts; `orbRef`'s setter (above) attaches it
    // the instant the DOM node commits.
    // V3 (voice-overlap): the actual presentation start, extracted from the
    // old presentVoiceEvent body unchanged -- only ever called either
    // directly (nothing else is active) or from beginFade below (dequeuing
    // the next queued event the moment the current one's own terminal
    // fires).
    const beginPresenting = (event: VoiceEvent): void => {
        const eventId = event.id?.trim();
        if (!eventId) return;
        isActiveRef.current = true;
        generationRef.current += 1;
        const generation = generationRef.current;
        clearFadeTimer();
        clearThinkingTimeout();
        const audioSource = audioSourceFactoryRef.current({ eventId });
        updatePhase('thinking');

        const deferredTarget = createDeferredOrbAudioTarget();
        deferredTargetRef.current = deferredTarget;
        // The orb overlay may already be mounted (e.g. a new question
        // arriving while a previous answer is still visible/fading) --
        // attach immediately rather than waiting for a commit that will
        // not reattach an already-mounted node.
        if (orbNodeRef.current) {
            deferredTarget.attach(orbNodeRef.current);
        }

        let terminalCallbackHandled = false;
        const beginFade = (): void => {
            if (generationRef.current !== generation || terminalCallbackHandled) return;
            terminalCallbackHandled = true;
            // V3: the answer this generation was presenting has now fully
            // finished (played to completion, errored, or timed out waiting
            // to start) -- no longer "active" for queueing purposes, even
            // though the cosmetic fade/hidden transition below has not run
            // yet. If another voice event queued up while this one was
            // active, start it immediately instead of fading: the fade is
            // pure UI wind-down with no audio behind it, so skipping it here
            // never drops or overlaps any answer.
            isActiveRef.current = false;
            const next = pendingQueueRef.current.shift();
            if (next) {
                beginPresenting(next);
                return;
            }
            clearFadeTimer();
            clearThinkingTimeout();
            updatePhase('fading');
            fadeTimerRef.current = setTimeout(() => {
                if (generationRef.current !== generation) return;
                fadeTimerRef.current = null;
                updatePhase('hidden');
            }, PRISMA_ORB_FADE_DURATION_MS);
        };
        // T17: never stay in "thinking" forever -- if onStarted never fires
        // (stale discard, an error surfaced only as a stream failure, a
        // hang), fade out on this bounded timeout instead.
        thinkingTimeoutRef.current = setTimeout(() => {
            thinkingTimeoutRef.current = null;
            beginFade();
        }, PRISMA_ORB_THINKING_TIMEOUT_MS);

        engineRef.current?.play(audioSource, deferredTarget, {
            onStarted: () => {
                if (generationRef.current !== generation || terminalCallbackHandled) return;
                clearThinkingTimeout();
                updatePhase('visible');
            },
            onEnded: beginFade,
            onError: beginFade,
        });
    };

    // voice-ux U1: shows "thinking" for a signal-only event (no answer,
    // never played) and starts a bounded wait for the real answer that
    // should follow. Only ever called while no answer is currently active
    // (presentVoiceEvent below guards that) -- a thinking signal must never
    // abort an answer already playing.
    const beginThinkingSignal = (): void => {
        generationRef.current += 1;
        const generation = generationRef.current;
        clearFadeTimer();
        clearThinkingTimeout();
        clearSignalTimeout();
        awaitingSignalAnswerRef.current = true;
        updatePhase('thinking');
        signalTimeoutRef.current = setTimeout(() => {
            signalTimeoutRef.current = null;
            if (generationRef.current !== generation || !awaitingSignalAnswerRef.current) return;
            awaitingSignalAnswerRef.current = false;
            updatePhase('hidden');
        }, PRISMA_ORB_THINKING_SIGNAL_TIMEOUT_MS);
    };

    // V3 (voice-overlap): every new voice event still reaches this same
    // public entry point. One arriving while the previous answer is still
    // actively being presented (thinking or visibly speaking) is queued
    // (bounded FIFO) instead of aborting the in-progress playback --
    // consecutive/overlapping answers for the same HMI session must each
    // play, in order, never dropped. One arriving during the previous
    // answer's cosmetic fade-out still starts immediately, unchanged from
    // before: by then the previous answer has already fully played.
    //
    // voice-ux U1: event.kind branches before any of that. "thinking"/
    // "cancel" are signal-only (see voice.types.ts) -- while an answer is
    // currently active, either kind is silently dropped (never aborts it;
    // a real answer arriving during that window still queues, unchanged
    // above). While nothing is active, "thinking" shows the thinking phase
    // and awaits the real answer (beginThinkingSignal); "cancel" clears that
    // wait and hides immediately, and is otherwise a no-op.
    const presentVoiceEvent = (event: VoiceEvent): void => {
        const eventId = event.id?.trim();
        if (!eventId) return;
        if (event.kind === 'thinking') {
            if (isActiveRef.current) return;
            beginThinkingSignal();
            return;
        }
        if (event.kind === 'cancel') {
            if (isActiveRef.current || !awaitingSignalAnswerRef.current) return;
            generationRef.current += 1;
            clearSignalTimeout();
            awaitingSignalAnswerRef.current = false;
            updatePhase('hidden');
            return;
        }
        // A real answer event always clears any pending signal-only wait --
        // it is either about to start playing (below) or about to queue
        // behind an answer already active, in which case the signal wait was
        // already impossible (isActiveRef and awaitingSignalAnswerRef are
        // never both true).
        awaitingSignalAnswerRef.current = false;
        clearSignalTimeout();
        if (isActiveRef.current) {
            if (pendingQueueRef.current.length < PRISMA_ORB_VOICE_EVENT_QUEUE_LIMIT) {
                pendingQueueRef.current.push(event);
            }
            return;
        }
        beginPresenting(event);
    };

    useLayoutEffect(() => () => {
        generationRef.current += 1;
        clearFadeTimer();
        clearThinkingTimeout();
        clearSignalTimeout();
        isActiveRef.current = false;
        awaitingSignalAnswerRef.current = false;
        pendingQueueRef.current = [];
        engineRef.current?.dispose();
    }, []);

    useLayoutEffect(() => prismaSessionClient.subscribeToReset(() => {
        generationRef.current += 1;
        clearFadeTimer();
        clearThinkingTimeout();
        clearSignalTimeout();
        isActiveRef.current = false;
        awaitingSignalAnswerRef.current = false;
        pendingQueueRef.current = [];
        engineRef.current?.stop();
        updatePhase('hidden');
    }), []);

    // T21: browser autoplay policy generally allows an AudioContext to
    // start/resume only after a user gesture. Warm it up on the page's
    // first pointer/keyboard/touch interaction -- well before any voice
    // event -- so a real answer's own warm-up (`PrismaVoiceAudioEngine.play`)
    // usually finds the context already running. Best-effort and silent:
    // `warmAudioContext()` never throws, and a failed/suspended resume here
    // simply falls back to the ordinary per-playback resume path.
    useLayoutEffect(() => {
        const engine = engineRef.current;
        if (!engine) return undefined;

        const interactionEvents = ['pointerdown', 'keydown', 'touchstart'] as const;
        const options: AddEventListenerOptions = { passive: true };

        // Arrow function expressions (not hoisted `function` declarations)
        // so TypeScript narrows the `const engine` above to non-null inside
        // them; `warmUp` referencing `removeListeners` ahead of its own
        // declaration is safe -- neither body runs until a real user
        // interaction fires, by which point both are initialized.
        const warmUp = (): void => {
            engine.warmAudioContext();
            removeListeners();
        };

        const removeListeners = (): void => {
            for (const type of interactionEvents) {
                window.removeEventListener(type, warmUp, options);
            }
        };

        for (const type of interactionEvents) {
            window.addEventListener(type, warmUp, options);
        }
        return removeListeners;
    }, []);

    return { phase, orbRef, presentVoiceEvent };
}
