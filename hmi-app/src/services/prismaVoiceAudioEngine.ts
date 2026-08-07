import {
    DEFAULT_AUDIO_LEVEL_POLICY,
    calculateRms,
    normalizeAudioLevel,
} from './audioLevel';
import type { AudioLevelPolicy } from './audioLevel';

export interface PrismaOrbAudioTarget {
    level: number;
    setSpeaking(speaking: boolean): void;
}

export interface PrismaVoiceAudioSource {
    cacheKey?: string;
    load(signal: AbortSignal): Promise<ArrayBuffer>;
}

export interface VoicePlaybackLifecycle {
    onStarted?: () => void;
    onEnded?: () => void;
    onError?: (error: unknown) => void;
}

export interface PrismaVoiceAudioEngineContract {
    play(
        source: PrismaVoiceAudioSource,
        target: PrismaOrbAudioTarget,
        lifecycle: VoicePlaybackLifecycle,
    ): void;
    stop(): void;
    dispose(): void;
}

interface PrismaVoiceAudioEngineDependencies {
    createAudioContext?: () => AudioContext;
    requestAnimationFrame?: (callback: FrameRequestCallback) => number;
    cancelAnimationFrame?: (handle: number) => void;
    warn?: (message: string, error: unknown) => void;
    levelPolicy?: AudioLevelPolicy;
}

interface ActivePlayback {
    generation: number;
    abortController: AbortController;
    target: PrismaOrbAudioTarget;
    sourceNode: AudioBufferSourceNode | null;
    analyser: AnalyserNode | null;
    animationFrame: number | null;
}

function createBrowserAudioContext(): AudioContext {
    if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') {
        throw new Error('Web Audio API is unavailable');
    }

    return new window.AudioContext();
}

function safeDisconnect(node: AudioNode | null): void {
    try {
        node?.disconnect();
    } catch {
        // A node may already be disconnected by a browser after natural end.
    }
}

function isAudioContextRunning(context: AudioContext): boolean {
    return context.state === 'running';
}

export class PrismaVoiceAudioEngine implements PrismaVoiceAudioEngineContract {
    private readonly createAudioContext: () => AudioContext;
    private readonly requestFrame: (callback: FrameRequestCallback) => number;
    private readonly cancelFrame: (handle: number) => void;
    private readonly warn: (message: string, error: unknown) => void;
    private readonly levelPolicy: AudioLevelPolicy;
    private readonly decodedBuffers = new Map<string, AudioBuffer>();
    private context: AudioContext | null = null;
    private active: ActivePlayback | null = null;
    private generation = 0;

    public constructor(dependencies: PrismaVoiceAudioEngineDependencies = {}) {
        this.createAudioContext = dependencies.createAudioContext ?? createBrowserAudioContext;
        this.requestFrame = dependencies.requestAnimationFrame
            ?? ((callback) => window.requestAnimationFrame(callback));
        this.cancelFrame = dependencies.cancelAnimationFrame
            ?? ((handle) => window.cancelAnimationFrame(handle));
        this.warn = dependencies.warn
            ?? ((message, error) => console.warn(message, error));
        this.levelPolicy = dependencies.levelPolicy ?? DEFAULT_AUDIO_LEVEL_POLICY;
    }

    public play(
        source: PrismaVoiceAudioSource,
        target: PrismaOrbAudioTarget,
        lifecycle: VoicePlaybackLifecycle,
    ): void {
        this.generation += 1;
        this.cleanupActive(true);

        const active: ActivePlayback = {
            generation: this.generation,
            abortController: new AbortController(),
            target,
            sourceNode: null,
            analyser: null,
            animationFrame: null,
        };
        target.level = 0;
        target.setSpeaking(false);
        this.active = active;

        void this.startPlayback(source, lifecycle, active);
    }

    public stop(): void {
        this.generation += 1;
        this.cleanupActive(true);
    }

    public dispose(): void {
        this.stop();
        const context = this.context;
        this.context = null;
        this.decodedBuffers.clear();

        if (context && context.state !== 'closed') {
            try {
                void context.close().catch((error: unknown) => {
                    this.warn('Prisma voice AudioContext close failed.', error);
                });
            } catch (error) {
                this.warn('Prisma voice AudioContext close failed.', error);
            }
        }
    }

    private async startPlayback(
        audioSource: PrismaVoiceAudioSource,
        lifecycle: VoicePlaybackLifecycle,
        active: ActivePlayback,
    ): Promise<void> {
        try {
            const context = this.getAudioContext();
            const cacheKey = audioSource.cacheKey;
            let audioBuffer = cacheKey ? this.decodedBuffers.get(cacheKey) : undefined;

            if (!audioBuffer) {
                const encodedAudio = await audioSource.load(active.abortController.signal);
                if (!this.isCurrent(active)) {
                    return;
                }

                audioBuffer = await context.decodeAudioData(encodedAudio.slice(0));
                if (!this.isCurrent(active)) {
                    return;
                }
                if (cacheKey) {
                    this.decodedBuffers.set(cacheKey, audioBuffer);
                }
            }

            if (!isAudioContextRunning(context)) {
                await context.resume();
                if (!this.isCurrent(active)) {
                    return;
                }
                if (!isAudioContextRunning(context)) {
                    throw new Error('AudioContext remained suspended after resume');
                }
            }

            const analyser = context.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0;
            const sourceNode = context.createBufferSource();
            sourceNode.buffer = audioBuffer;
            sourceNode.connect(analyser);
            analyser.connect(context.destination);
            active.sourceNode = sourceNode;
            active.analyser = analyser;
            sourceNode.onended = () => {
                if (!this.isCurrent(active)) {
                    return;
                }

                this.cleanupActive(false);
                lifecycle.onEnded?.();
            };

            sourceNode.start();
            if (!this.isCurrent(active)) {
                return;
            }
            active.target.setSpeaking(true);
            lifecycle.onStarted?.();
            this.scheduleAnalysis(active);
        } catch (error) {
            if (!this.isCurrent(active)) {
                return;
            }

            this.cleanupActive(true);
            this.warn('Prisma voice audio playback failed.', error);
            lifecycle.onError?.(error);
        }
    }

    private getAudioContext(): AudioContext {
        if (!this.context || this.context.state === 'closed') {
            this.context = this.createAudioContext();
            this.decodedBuffers.clear();
        }

        return this.context;
    }

    private scheduleAnalysis(active: ActivePlayback): void {
        const analyser = active.analyser;
        if (!analyser) {
            return;
        }

        const samples = new Float32Array(analyser.fftSize);
        const analyze = () => {
            if (!this.isCurrent(active)) {
                return;
            }

            analyser.getFloatTimeDomainData(samples);
            active.target.level = normalizeAudioLevel(
                calculateRms(samples),
                active.target.level,
                this.levelPolicy,
            );
            active.animationFrame = this.requestFrame(analyze);
        };

        active.animationFrame = this.requestFrame(analyze);
    }

    private isCurrent(active: ActivePlayback): boolean {
        return this.active === active && this.generation === active.generation;
    }

    private cleanupActive(stopSource: boolean): void {
        const active = this.active;
        if (!active) {
            return;
        }

        this.active = null;
        active.abortController.abort();
        if (active.animationFrame !== null) {
            this.cancelFrame(active.animationFrame);
            active.animationFrame = null;
        }
        if (active.sourceNode) {
            active.sourceNode.onended = null;
            if (stopSource) {
                try {
                    active.sourceNode.stop();
                } catch {
                    // stop() throws when playback never started or already ended.
                }
            }
        }
        safeDisconnect(active.sourceNode);
        safeDisconnect(active.analyser);
        active.target.level = 0;
        active.target.setSpeaking(false);
    }
}
