import {
    DEFAULT_AUDIO_LEVEL_POLICY,
    calculateRms,
    normalizeAudioLevel,
} from './audioLevel';
import type { AudioLevelPolicy } from './audioLevel';

export const PRISMA_PCM_SAMPLE_RATE = 24_000;
export const PRISMA_PCM_BLOCK_SAMPLES = 1_800;
const PRISMA_PCM_PLAYBACK_LEAD_SECONDS = 0.025;

export interface PrismaOrbAudioTarget {
    level: number;
    setSpeaking(speaking: boolean): void;
}

export interface PrismaVoicePcmStream {
    reader: ReadableStreamDefaultReader<Uint8Array>;
    sampleRate: number;
    channels: number;
}

export interface PrismaVoiceAudioSource {
    openLive(signal: AbortSignal): Promise<PrismaVoicePcmStream>;
    loadWav?: (signal: AbortSignal) => Promise<ArrayBuffer>;
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
    setTimeout?: (callback: () => void, delay: number) => number;
    clearTimeout?: (handle: number) => void;
    now?: () => number;
    log?: (message: string) => void;
    warn?: (message: string, error: unknown) => void;
    levelPolicy?: AudioLevelPolicy;
}

interface ActivePlayback {
    generation: number;
    abortController: AbortController;
    target: PrismaOrbAudioTarget;
    lifecycle: VoicePlaybackLifecycle;
    reader: ReadableStreamDefaultReader<Uint8Array> | null;
    sourceNodes: Set<AudioBufferSourceNode>;
    analyser: AnalyserNode | null;
    animationFrame: number | null;
    playbackTimer: number | null;
    firstPlaybackTime: number | null;
    nextPlaybackTime: number;
    streamCompleted: boolean;
    playbackStarted: boolean;
    firstAudioReceived: boolean;
    liveRequestStarted: boolean;
    mode: 'live' | 'fallback';
}

export class PcmS16LeBlockAssembler {
    private readonly blockSamples: number;
    private pending: Float32Array<ArrayBuffer>;
    private pendingLength = 0;
    private carry: number | null = null;

    public constructor(blockSamples = PRISMA_PCM_BLOCK_SAMPLES) {
        this.blockSamples = blockSamples;
        this.pending = new Float32Array(blockSamples);
    }

    public push(chunk: Uint8Array): Float32Array<ArrayBuffer>[] {
        const blocks: Float32Array<ArrayBuffer>[] = [];
        let byteIndex = 0;

        if (this.carry !== null && chunk.length > 0) {
            this.appendSample(this.decodeSample(this.carry, chunk[0] as number), blocks);
            this.carry = null;
            byteIndex = 1;
        }

        while (byteIndex + 1 < chunk.length) {
            this.appendSample(
                this.decodeSample(chunk[byteIndex] as number, chunk[byteIndex + 1] as number),
                blocks,
            );
            byteIndex += 2;
        }

        if (byteIndex < chunk.length) {
            this.carry = chunk[byteIndex] as number;
        }

        return blocks;
    }

    public finish(): Float32Array<ArrayBuffer> | null {
        this.carry = null;
        if (this.pendingLength === 0) {
            return null;
        }

        const finalBlock = this.pending.slice(0, this.pendingLength);
        this.pending = new Float32Array(this.blockSamples);
        this.pendingLength = 0;
        return finalBlock;
    }

    private decodeSample(lowByte: number, highByte: number): number {
        const unsigned = lowByte | (highByte << 8);
        const signed = unsigned >= 0x8000 ? unsigned - 0x1_0000 : unsigned;
        return signed / 32_768;
    }

    private appendSample(sample: number, blocks: Float32Array<ArrayBuffer>[]): void {
        this.pending[this.pendingLength] = sample;
        this.pendingLength += 1;
        if (this.pendingLength !== this.blockSamples) {
            return;
        }

        blocks.push(this.pending);
        this.pending = new Float32Array(this.blockSamples);
        this.pendingLength = 0;
    }
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
        // A node may already be disconnected after natural end or cancellation.
    }
}

function safeStop(node: AudioBufferSourceNode): void {
    try {
        node.stop();
    } catch {
        // stop() throws when a source never started or already ended.
    }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array> | null): void {
    if (!reader) {
        return;
    }

    try {
        void reader.cancel().catch(() => undefined);
    } catch {
        // Reader cancellation may race with stream closure.
    }
}

function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
    try {
        reader.releaseLock?.();
    } catch {
        // A cancelled or errored stream may already have released its lock.
    }
}

function isAudioContextRunning(context: AudioContext): boolean {
    return context.state === 'running';
}

export class PrismaVoiceAudioEngine implements PrismaVoiceAudioEngineContract {
    private readonly createAudioContext: () => AudioContext;
    private readonly requestFrame: (callback: FrameRequestCallback) => number;
    private readonly cancelFrame: (handle: number) => void;
    private readonly setTimer: (callback: () => void, delay: number) => number;
    private readonly clearTimer: (handle: number) => void;
    private readonly now: () => number;
    private readonly log: (message: string) => void;
    private readonly warn: (message: string, error: unknown) => void;
    private readonly levelPolicy: AudioLevelPolicy;
    private context: AudioContext | null = null;
    private active: ActivePlayback | null = null;
    private generation = 0;

    public constructor(dependencies: PrismaVoiceAudioEngineDependencies = {}) {
        this.createAudioContext = dependencies.createAudioContext ?? createBrowserAudioContext;
        this.requestFrame = dependencies.requestAnimationFrame
            ?? ((callback) => window.requestAnimationFrame(callback));
        this.cancelFrame = dependencies.cancelAnimationFrame
            ?? ((handle) => window.cancelAnimationFrame(handle));
        this.setTimer = dependencies.setTimeout
            ?? ((callback, delay) => window.setTimeout(callback, delay));
        this.clearTimer = dependencies.clearTimeout
            ?? ((handle) => window.clearTimeout(handle));
        this.now = dependencies.now ?? (() => performance.now());
        this.log = dependencies.log ?? ((message) => console.log(message));
        this.warn = dependencies.warn ?? ((message, error) => console.warn(message, error));
        this.levelPolicy = dependencies.levelPolicy ?? DEFAULT_AUDIO_LEVEL_POLICY;
    }

    public play(
        source: PrismaVoiceAudioSource,
        target: PrismaOrbAudioTarget,
        lifecycle: VoicePlaybackLifecycle,
    ): void {
        this.generation += 1;
        this.cleanupActive('cancel', true);

        const active: ActivePlayback = {
            generation: this.generation,
            abortController: new AbortController(),
            target,
            lifecycle,
            reader: null,
            sourceNodes: new Set(),
            analyser: null,
            animationFrame: null,
            playbackTimer: null,
            firstPlaybackTime: null,
            nextPlaybackTime: 0,
            streamCompleted: false,
            playbackStarted: false,
            firstAudioReceived: false,
            liveRequestStarted: false,
            mode: 'live',
        };
        target.level = 0;
        target.setSpeaking(false);
        this.active = active;

        void this.startPlayback(source, active);
    }

    public stop(): void {
        this.generation += 1;
        this.cleanupActive('cancel', true);
    }

    public dispose(): void {
        this.stop();
        const context = this.context;
        this.context = null;

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
        source: PrismaVoiceAudioSource,
        active: ActivePlayback,
    ): Promise<void> {
        try {
            await this.playLive(source, active);
        } catch (error) {
            if (!this.isCurrent(active)) {
                return;
            }

            if (!this.hasLivePlaybackBegun(active) && source.loadWav) {
                this.log('Prisma Live failed, using WAV fallback');
                this.prepareFallback(active);
                try {
                    await this.playWavFallback(source.loadWav, active);
                    return;
                } catch (fallbackError) {
                    if (this.isCurrent(active)) {
                        this.failActive(active, fallbackError);
                    }
                    return;
                }
            }

            this.failActive(active, error);
        }
    }

    private async playLive(source: PrismaVoiceAudioSource, active: ActivePlayback): Promise<void> {
        const requestStartedAt = this.now();
        active.liveRequestStarted = true;
        this.log('Prisma Live request started');
        const stream = await source.openLive(active.abortController.signal);
        if (!this.isCurrent(active)) {
            cancelReader(stream.reader);
            return;
        }

        active.reader = stream.reader;
        if (stream.sampleRate !== PRISMA_PCM_SAMPLE_RATE || stream.channels !== 1) {
            throw new Error('Prisma Live stream has unsupported PCM metadata');
        }

        const assembler = new PcmS16LeBlockAssembler();
        let scheduledSamples = 0;
        while (this.isCurrent(active)) {
            const result = await stream.reader.read();
            if (!this.isCurrent(active)) {
                return;
            }
            if (result.done) {
                break;
            }

            for (const block of assembler.push(result.value)) {
                if (!active.firstAudioReceived) {
                    active.firstAudioReceived = true;
                    this.log(`Prisma Live first audio: ${Math.round(this.now() - requestStartedAt)} ms`);
                }
                await this.schedulePcmBlock(block, stream.sampleRate, active);
                scheduledSamples += block.length;
            }
        }

        const finalBlock = assembler.finish();
        if (finalBlock && this.isCurrent(active)) {
            if (!active.firstAudioReceived) {
                active.firstAudioReceived = true;
                this.log(`Prisma Live first audio: ${Math.round(this.now() - requestStartedAt)} ms`);
            }
            await this.schedulePcmBlock(finalBlock, stream.sampleRate, active);
            scheduledSamples += finalBlock.length;
        }
        if (!this.isCurrent(active)) {
            return;
        }
        if (scheduledSamples === 0) {
            throw new Error('Prisma Live stream contained no complete PCM samples');
        }

        active.reader = null;
        releaseReader(stream.reader);
        active.streamCompleted = true;
        this.log('Prisma Live stream completed');
        this.completeLiveIfFinished(active);
    }

    private async schedulePcmBlock(
        samples: Float32Array<ArrayBuffer>,
        sampleRate: number,
        active: ActivePlayback,
    ): Promise<void> {
        const context = this.getAudioContext();
        await this.ensureContextRunning(context);
        if (!this.isCurrent(active)) {
            return;
        }

        const analyser = this.getAnalyser(context, active);
        const audioBuffer = context.createBuffer(1, samples.length, sampleRate);
        audioBuffer.copyToChannel(samples, 0);
        const sourceNode = context.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.connect(analyser);
        const startTime = Math.max(
            active.nextPlaybackTime,
            context.currentTime + PRISMA_PCM_PLAYBACK_LEAD_SECONDS,
        );
        active.firstPlaybackTime ??= startTime;
        active.nextPlaybackTime = startTime + audioBuffer.duration;
        active.sourceNodes.add(sourceNode);
        sourceNode.onended = () => {
            if (!this.isCurrent(active)) {
                return;
            }

            active.sourceNodes.delete(sourceNode);
            safeDisconnect(sourceNode);
            this.completeLiveIfFinished(active);
        };

        try {
            sourceNode.start(startTime);
        } catch (error) {
            active.sourceNodes.delete(sourceNode);
            sourceNode.onended = null;
            safeDisconnect(sourceNode);
            throw error;
        }

        if (active.playbackTimer === null && !active.playbackStarted) {
            const delay = Math.max(0, (startTime - context.currentTime) * 1_000);
            active.playbackTimer = this.setTimer(() => {
                active.playbackTimer = null;
                if (!this.isCurrent(active) || active.playbackStarted) {
                    return;
                }

                active.playbackStarted = true;
                active.target.setSpeaking(true);
                active.lifecycle.onStarted?.();
                this.log('Prisma Live playback started');
                this.scheduleAnalysis(active);
            }, delay);
        }
    }

    private async playWavFallback(
        loadWav: (signal: AbortSignal) => Promise<ArrayBuffer>,
        active: ActivePlayback,
    ): Promise<void> {
        const context = this.getAudioContext();
        const encodedAudio = await loadWav(active.abortController.signal);
        if (!this.isCurrent(active)) {
            return;
        }
        const audioBuffer = await context.decodeAudioData(encodedAudio.slice(0));
        if (!this.isCurrent(active)) {
            return;
        }
        await this.ensureContextRunning(context);
        if (!this.isCurrent(active)) {
            return;
        }

        const analyser = this.getAnalyser(context, active);
        const sourceNode = context.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.connect(analyser);
        active.sourceNodes.add(sourceNode);
        sourceNode.onended = () => {
            if (!this.isCurrent(active)) {
                return;
            }

            active.sourceNodes.delete(sourceNode);
            safeDisconnect(sourceNode);
            this.cleanupActive('complete', false);
            active.lifecycle.onEnded?.();
        };
        sourceNode.start();
        active.playbackStarted = true;
        active.target.setSpeaking(true);
        active.lifecycle.onStarted?.();
        this.scheduleAnalysis(active);
    }

    private prepareFallback(active: ActivePlayback): void {
        active.mode = 'fallback';
        active.abortController.abort();
        active.abortController = new AbortController();
        cancelReader(active.reader);
        active.reader = null;
        this.clearPlaybackResources(active, true);
        active.streamCompleted = false;
        active.firstAudioReceived = false;
        active.firstPlaybackTime = null;
        active.nextPlaybackTime = 0;
        active.target.level = 0;
        active.target.setSpeaking(false);
    }

    private getAudioContext(): AudioContext {
        if (!this.context || this.context.state === 'closed') {
            this.context = this.createAudioContext();
        }

        return this.context;
    }

    private async ensureContextRunning(context: AudioContext): Promise<void> {
        if (isAudioContextRunning(context)) {
            return;
        }

        await context.resume();
        if (!isAudioContextRunning(context)) {
            throw new Error('AudioContext remained suspended after resume');
        }
    }

    private getAnalyser(context: AudioContext, active: ActivePlayback): AnalyserNode {
        if (active.analyser) {
            return active.analyser;
        }

        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0;
        analyser.connect(context.destination);
        active.analyser = analyser;
        return analyser;
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

    private completeLiveIfFinished(active: ActivePlayback): void {
        if (!this.isCurrent(active) || !active.streamCompleted || active.sourceNodes.size > 0) {
            return;
        }

        this.log('Prisma Live playback completed');
        this.cleanupActive('complete', false);
        active.lifecycle.onEnded?.();
    }

    private failActive(active: ActivePlayback, error: unknown): void {
        this.cleanupActive('error', true);
        this.warn('Prisma voice audio playback failed.', error);
        active.lifecycle.onError?.(error);
    }

    private isCurrent(active: ActivePlayback): boolean {
        return this.active === active && this.generation === active.generation;
    }

    private hasLivePlaybackBegun(active: ActivePlayback): boolean {
        return active.playbackStarted
            || (active.firstPlaybackTime !== null
                && this.context !== null
                && this.context.currentTime >= active.firstPlaybackTime);
    }

    private clearPlaybackResources(active: ActivePlayback, stopSources: boolean): void {
        if (active.playbackTimer !== null) {
            this.clearTimer(active.playbackTimer);
            active.playbackTimer = null;
        }
        if (active.animationFrame !== null) {
            this.cancelFrame(active.animationFrame);
            active.animationFrame = null;
        }
        for (const sourceNode of active.sourceNodes) {
            sourceNode.onended = null;
            if (stopSources) {
                safeStop(sourceNode);
            }
            safeDisconnect(sourceNode);
        }
        active.sourceNodes.clear();
        safeDisconnect(active.analyser);
        active.analyser = null;
    }

    private cleanupActive(
        reason: 'cancel' | 'complete' | 'error',
        stopSources: boolean,
    ): void {
        const active = this.active;
        if (!active) {
            return;
        }

        this.active = null;
        active.abortController.abort();
        cancelReader(active.reader);
        active.reader = null;
        this.clearPlaybackResources(active, stopSources);
        active.target.level = 0;
        active.target.setSpeaking(false);
        if (reason === 'cancel' && active.mode === 'live' && active.liveRequestStarted) {
            this.log('Prisma Live cancelled');
        }
    }
}
