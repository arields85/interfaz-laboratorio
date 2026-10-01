import {
    DEFAULT_AUDIO_LEVEL_POLICY,
    calculateRms,
    normalizeAudioLevel,
} from './audioLevel';
import type { AudioLevelPolicy } from './audioLevel';
import {
    createOpaqueBrowserRunId,
    dispatchLedaBrowserMetric,
} from './ledaVoiceMetrics';
import type {
    LedaBrowserMetric,
    LedaBrowserMetricSink,
} from './ledaVoiceMetrics';
import type { LedaAudioMetricPayload } from '../domain/ledaAudioMetric.types';
import { LEDA_PCM_AUDIO_FORMAT } from './ledaPcmAudioFormat';
import { LEDA_PREBUFFER_SCHEDULING_MARGIN_MS, LedaPrebufferNeedTracker } from './ledaPrebufferNeedTracker';
import { LEDA_PREBUFFER_ESTIMATE_DEFAULT_MS } from './ledaVoicePrebufferEstimator';
import type { LedaAudioMetricPrebufferMode } from '../domain/ledaAudioMetric.types';

export const LEDA_PCM_SAMPLE_RATE = LEDA_PCM_AUDIO_FORMAT.sampleRate;
export const LEDA_PCM_BLOCK_SAMPLES = 1_800;
// T3: fallback/default prebuffer (ms), used before the first block (and after
// any underflow) only when no `prebufferPolicy` dependency is injected --
// unit tests, or a caller that has not wired Automatic/Manual mode yet. When
// a policy is injected (production, via useLedaOrbPresentation.ts), each
// answer's own resolved `ActivePlayback.prebufferMs` is used instead (see
// `play()` and `schedulePcmBlock()`). Single source of truth with
// LedaVoicePrebufferEstimator's own no-history default -- both are the
// PW-006 T22 value (200 ms) proven live before this feature.
const LEDA_PCM_PLAYBACK_LEAD_MS = LEDA_PREBUFFER_ESTIMATE_DEFAULT_MS;
// Larger device buffer: voice playback tolerates latency better than render-thread underruns under UI load.
const LEDA_PLAYBACK_CONTEXT_OPTIONS: AudioContextOptions = { latencyHint: 'playback' };

export type LedaVoiceAudioDiagnostic = LedaBrowserMetric;

export interface LedaOrbAudioTarget {
    level: number;
    setSpeaking(speaking: boolean): void;
}

export interface LedaVoicePcmStream {
    reader: ReadableStreamDefaultReader<Uint8Array>;
    sampleRate: number;
    channels: number;
}

export interface LedaVoiceAudioSource {
    openLive(signal: AbortSignal): Promise<LedaVoicePcmStream>;
    loadWav?: (signal: AbortSignal) => Promise<ArrayBuffer>;
}

export interface VoicePlaybackLifecycle {
    onStarted?: () => void;
    onEnded?: () => void;
    onError?: (error: unknown) => void;
}

// T3: 'fixed' is never resolved by a policy -- it is exactly the value the
// engine itself reports when no `prebufferPolicy` dependency is injected
// (see LEDA_PCM_PLAYBACK_LEAD_MS above), so it is excluded here.
export type LedaVoicePrebufferMode = Exclude<LedaAudioMetricPrebufferMode, 'fixed'>;

export interface LedaVoicePrebufferResolution {
    prebufferMs: number;
    mode: LedaVoicePrebufferMode;
}

/**
 * T3: optional engine dependency that feeds the continuous prebuffer
 * estimator (T2, `ledaVoicePrebufferController.ts`) into playback,
 * without the engine itself knowing anything about browser storage or the
 * Automatic/Manual distinction beyond the `mode` label it reports.
 *
 * `resolvePrebufferMs()` is called exactly once per answer, at `play()`
 * time, and its result is snapshotted for that whole answer (no mid-answer
 * changes) -- see `ActivePlayback.prebufferMs`/`prebufferMode`.
 * `recordNeededPrebufferMs()` is called exactly once, only when a
 * progressive answer completes normally (see `completeLiveIfFinished()`):
 * never for a stopped/cancelled/errored answer. The engine never branches on
 * `mode` itself -- a Manual-mode policy (T4) still receives this call
 * ("still measured and logged", per the feature design) and decides
 * internally whether/how to use it.
 */
export interface LedaVoicePrebufferPolicy {
    resolvePrebufferMs(): LedaVoicePrebufferResolution;
    recordNeededPrebufferMs(neededPrebufferMs: number): void;
}

export interface LedaVoiceAudioEngineContract {
    play(
        source: LedaVoiceAudioSource,
        target: LedaOrbAudioTarget,
        lifecycle: VoicePlaybackLifecycle,
    ): void;
    // T21: create/resume the shared AudioContext ahead of any playback --
    // called both at voice-event receipt (in parallel with the live
    // request, from `play()` itself) and as early as the page's first user
    // interaction (`useLedaOrbPresentation.ts`), so a real answer's own
    // `ensureContextRunning` usually finds the context already running
    // instead of paying the resume latency after the first audio chunk.
    // Safe to call at any time, including with no active playback; never
    // throws (a failed/suspended resume is only ever surfaced later, by the
    // ordinary `ensureContextRunning` path at actual scheduling time).
    warmAudioContext(): void;
    stop(): void;
    dispose(): void;
}

export interface LedaVoiceAudioEngineDependencies {
    createAudioContext?: (options?: AudioContextOptions) => AudioContext;
    requestAnimationFrame?: (callback: FrameRequestCallback) => number;
    cancelAnimationFrame?: (handle: number) => void;
    setTimeout?: (callback: () => void, delay: number) => number;
    clearTimeout?: (handle: number) => void;
    now?: () => number;
    log?: (message: string) => void;
    warn?: (message: string, error: unknown) => void;
    onDiagnostic?: LedaBrowserMetricSink;
    levelPolicy?: AudioLevelPolicy;
    prebufferPolicy?: LedaVoicePrebufferPolicy;
}

interface ActivePlayback {
    generation: number;
    runId: string;
    requestStartedAt: number;
    abortController: AbortController;
    target: LedaOrbAudioTarget;
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
    pcmBytes: number;
    pcmDurationSeconds: number;
    underflowCount: number;
    canonicalDecodeEmitted: boolean;
    lastMetricAt: number;
    mode: 'live' | 'fallback';
    metricSequence: number;
    // T1: handleProgressiveBlock calls recordBlockArrival for every block of
    // the (now only) progressive transport.
    prebufferNeedTracker: LedaPrebufferNeedTracker;
    // T3: snapshotted once at play() time from the injected
    // `prebufferPolicy` (or the fixed fallback when none is injected) --
    // never re-read mid-answer. `prebufferMs` is what schedulePcmBlock()
    // actually uses as the lead; `prebufferMode` is reported verbatim on
    // this answer's playback-ended.
    prebufferMs: number;
    prebufferMode: LedaAudioMetricPrebufferMode;
}

export class PcmS16LeBlockAssembler {
    private readonly blockSamples: number;
    private pending: Float32Array<ArrayBuffer>;
    private pendingLength = 0;
    private carry: number | null = null;

    public constructor(blockSamples = LEDA_PCM_BLOCK_SAMPLES) {
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

function createBrowserAudioContext(options?: AudioContextOptions): AudioContext {
    if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') {
        throw new Error('Web Audio API is unavailable');
    }

    return options
        ? new window.AudioContext(options)
        : new window.AudioContext();
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
        void reader.cancel()
            .catch(() => undefined)
            .finally(() => releaseReader(reader));
    } catch {
        // Reader cancellation may race with stream closure.
        releaseReader(reader);
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

export class LedaVoiceAudioEngine implements LedaVoiceAudioEngineContract {
    private readonly createAudioContext: (options?: AudioContextOptions) => AudioContext;
    private readonly requestFrame: (callback: FrameRequestCallback) => number;
    private readonly cancelFrame: (handle: number) => void;
    private readonly setTimer: (callback: () => void, delay: number) => number;
    private readonly clearTimer: (handle: number) => void;
    private readonly now: () => number;
    private readonly log: (message: string) => void;
    private readonly warn: (message: string, error: unknown) => void;
    private readonly onDiagnostic: (diagnostic: LedaVoiceAudioDiagnostic) => void;
    private readonly levelPolicy: AudioLevelPolicy;
    private readonly prebufferPolicy: LedaVoicePrebufferPolicy | null;
    private context: AudioContext | null = null;
    private active: ActivePlayback | null = null;
    private generation = 0;
    // T21: the in-flight (or most recently settled) resume attempt, shared
    // between `warmAudioContext()` and `ensureContextRunning()` so a resume
    // already started at voice-event receipt is awaited once, never
    // re-triggered when the first PCM block is ready to schedule.
    // `contextResumePromiseContext` records which AudioContext instance that
    // promise belongs to, so a resume for a context created after dispose()
    // is never mistakenly reused for a stale, already-closed one.
    private contextResumePromise: Promise<void> | null = null;
    private contextResumePromiseContext: AudioContext | null = null;

    public constructor(dependencies: LedaVoiceAudioEngineDependencies = {}) {
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
        this.log = dependencies.log ?? (() => undefined);
        this.warn = dependencies.warn ?? ((message, error) => console.warn(message, error));
        this.onDiagnostic = dependencies.onDiagnostic ?? dispatchLedaBrowserMetric;
        this.levelPolicy = dependencies.levelPolicy ?? DEFAULT_AUDIO_LEVEL_POLICY;
        this.prebufferPolicy = dependencies.prebufferPolicy ?? null;
    }

    public play(
        source: LedaVoiceAudioSource,
        target: LedaOrbAudioTarget,
        lifecycle: VoicePlaybackLifecycle,
    ): void {
        this.generation += 1;
        this.cleanupActive('cancel', true);

        // T3: snapshotted once per answer, here -- never re-read mid-answer
        // even if resolvePrebufferMs() would return a different value later
        // (e.g. the estimator learning from a concurrent answer, which
        // cannot happen today since play() replaces any in-flight answer,
        // but keeps this call site the single point of resolution).
        const prebufferResolution = this.prebufferPolicy?.resolvePrebufferMs();

        const active: ActivePlayback = {
            generation: this.generation,
            runId: createOpaqueBrowserRunId(),
            requestStartedAt: this.now(),
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
            pcmBytes: 0,
            pcmDurationSeconds: 0,
            underflowCount: 0,
            canonicalDecodeEmitted: false,
            lastMetricAt: -Infinity,
            mode: 'live',
            metricSequence: 0,
            prebufferNeedTracker: new LedaPrebufferNeedTracker(),
            prebufferMs: prebufferResolution?.prebufferMs ?? LEDA_PCM_PLAYBACK_LEAD_MS,
            prebufferMode: prebufferResolution?.mode ?? 'fixed',
        };
        target.level = 0;
        target.setSpeaking(false);
        this.active = active;
        this.emitDiagnostic(active, { record_type: 'request-start', payload: {} });

        // T21: warm the shared AudioContext in parallel with the live
        // request below, instead of only discovering it needs a resume once
        // the first PCM block is ready to schedule (previously ~0.4 s after
        // the first audio chunk on the first answer after startup).
        this.warmAudioContext();

        void this.startPlayback(source, active);
    }

    public warmAudioContext(): void {
        try {
            const context = this.getAudioContext();
            if (isAudioContextRunning(context)) {
                return;
            }
            void this.resumeContext(context);
        } catch (error) {
            this.warn('Leda voice AudioContext warm-up failed.', error);
        }
    }

    public stop(): void {
        this.generation += 1;
        this.cleanupActive('cancel', true);
    }

    public dispose(): void {
        this.stop();
        const context = this.context;
        this.context = null;
        // T21: an in-flight resume belongs to whichever context is being
        // disposed; never reused against a context created after dispose.
        this.contextResumePromise = null;
        this.contextResumePromiseContext = null;

        if (context && context.state !== 'closed') {
            try {
                void context.close().catch((error: unknown) => {
                    this.warn('Leda voice AudioContext close failed.', error);
                });
            } catch (error) {
                this.warn('Leda voice AudioContext close failed.', error);
            }
        }
    }

    private async startPlayback(
        source: LedaVoiceAudioSource,
        active: ActivePlayback,
    ): Promise<void> {
        try {
            await this.playProgressiveLive(source, active);
        } catch (error) {
            if (!this.isCurrent(active)) {
                return;
            }

            if (!this.hasLivePlaybackBegun(active) && source.loadWav) {
                this.log('Leda Live failed, using WAV fallback');
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

    private async playProgressiveLive(
        source: LedaVoiceAudioSource,
        active: ActivePlayback,
    ): Promise<void> {
        const requestStartedAt = this.now();
        active.liveRequestStarted = true;
        this.log('Leda Live request started');
        const stream = await source.openLive(active.abortController.signal);
        if (!this.isCurrent(active)) {
            cancelReader(stream.reader);
            return;
        }

        active.reader = stream.reader;
        if (stream.sampleRate !== LEDA_PCM_SAMPLE_RATE || stream.channels !== 1) {
            throw new Error('Leda Live stream has unsupported PCM metadata');
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

            active.pcmBytes += result.value.byteLength;

            for (const block of assembler.push(result.value)) {
                await this.handleProgressiveBlock(block, stream.sampleRate, active, requestStartedAt);
                scheduledSamples += block.length;
            }
        }

        const finalBlock = assembler.finish();
        if (finalBlock && this.isCurrent(active)) {
            await this.handleProgressiveBlock(finalBlock, stream.sampleRate, active, requestStartedAt);
            scheduledSamples += finalBlock.length;
        }
        if (!this.isCurrent(active)) {
            return;
        }
        if (scheduledSamples === 0) {
            throw new Error('Leda Live stream contained no complete PCM samples');
        }

        this.emitDiagnostic(active, {
            record_type: 'eof',
            payload: {
                elapsed_ms: this.elapsedMs(active),
                transport: 'progressive',
                pcm_bytes: active.pcmBytes,
                pcm_duration_seconds: active.pcmDurationSeconds,
            },
        });
        active.reader = null;
        releaseReader(stream.reader);
        active.streamCompleted = true;
        this.log('Leda Live stream completed');
        this.completeLiveIfFinished(active);
    }

    // T1: shared by both the streaming loop and the final flushed block in
    // playProgressiveLive -- captures the block's arrival (before any
    // scheduling/awaiting can skew the clock reading the prebuffer-need
    // measurement depends on), records first-audio if needed, feeds the
    // tracker, then schedules it.
    private async handleProgressiveBlock(
        block: Float32Array<ArrayBuffer>,
        sampleRate: number,
        active: ActivePlayback,
        requestStartedAt: number,
    ): Promise<void> {
        const blockArrivalMs = this.now();
        if (!active.firstAudioReceived) {
            active.firstAudioReceived = true;
            const elapsedMs = blockArrivalMs - requestStartedAt;
            this.log(`Leda Live first audio: ${Math.round(elapsedMs)} ms`);
            this.emitDiagnostic(active, {
                record_type: 'first-readable-audio',
                payload: { elapsed_ms: elapsedMs, pcm_bytes: active.pcmBytes },
            });
        }
        const blockDurationMs = (block.length / sampleRate) * 1_000;
        active.prebufferNeedTracker.recordBlockArrival(blockArrivalMs, blockDurationMs);
        this.emitCanonicalDecode(active, active.pcmBytes, block.length / sampleRate);
        await this.schedulePcmBlock(block, sampleRate, active);
    }

    private emitCanonicalDecode(
        active: ActivePlayback,
        pcmBytes: number,
        pcmDurationSeconds: number,
    ): void {
        if (active.canonicalDecodeEmitted) {
            return;
        }

        active.canonicalDecodeEmitted = true;
        this.emitDiagnostic(active, {
            record_type: 'canonical-decode',
            payload: {
                elapsed_ms: this.elapsedMs(active),
                transport: 'progressive',
                pcm_bytes: pcmBytes,
                pcm_duration_seconds: pcmDurationSeconds,
            },
        });
    }

    private async schedulePcmBlock(
        samples: Float32Array<ArrayBuffer>,
        sampleRate: number,
        active: ActivePlayback,
    ): Promise<void> {
        const context = this.getAudioContext();
        await this.ensureContextRunning(context, active);
        if (!this.isCurrent(active)) {
            return;
        }

        const analyser = this.getAnalyser(context, active);
        const audioBuffer = context.createBuffer(1, samples.length, sampleRate);
        audioBuffer.copyToChannel(samples, 0);
        const sourceNode = context.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.connect(analyser);
        // The prebuffer only primes playback: before the first block and again after a block
        // misses its slot. Every other block plays right after its predecessor, as long as it
        // arrives within the scheduling margin of that slot.
        const isFirstBlock = active.nextPlaybackTime === 0;
        const missedSlot = !isFirstBlock
            && context.currentTime + LEDA_PREBUFFER_SCHEDULING_MARGIN_MS / 1_000 > active.nextPlaybackTime;
        if (missedSlot) {
            active.underflowCount += 1;
        }
        const startTime = isFirstBlock || missedSlot
            ? context.currentTime + active.prebufferMs / 1_000
            : active.nextPlaybackTime;
        active.firstPlaybackTime ??= startTime;
        active.nextPlaybackTime = startTime + audioBuffer.duration;
        active.pcmDurationSeconds += audioBuffer.duration;
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
                this.log('Leda Live playback started');
                this.emitDiagnostic(active, {
                    record_type: 'playback-started',
                    payload: {
                        elapsed_ms: this.elapsedMs(active),
                        transport: 'progressive',
                        pcm_bytes: active.pcmBytes,
                        pcm_duration_seconds: null,
                        underflow_count: active.underflowCount,
                    },
                });
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
        await this.ensureContextRunning(context, active);
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
        active.pcmDurationSeconds = 0;
        active.underflowCount = 0;
        active.target.level = 0;
        active.target.setSpeaking(false);
    }

    private getAudioContext(): AudioContext {
        if (!this.context || this.context.state === 'closed') {
            this.context = this.createAudioContext(LEDA_PLAYBACK_CONTEXT_OPTIONS);
        }

        return this.context;
    }

    private async ensureContextRunning(context: AudioContext, active: ActivePlayback): Promise<void> {
        if (isAudioContextRunning(context)) {
            return;
        }

        // T16: only observed when a resume is actually needed (autoplay/idle
        // suspension is a first-question-miss candidate) -- this is called
        // on every scheduled PCM block in the progressive path, so recording
        // unconditionally would flood the timeline with "already running".
        this.emitDiagnostic(active, {
            record_type: 'audio-context-state',
            payload: { state: context.state, when: 'at-play' },
        });
        // T21: reuse a resume already started by `warmAudioContext()` (at
        // voice-event receipt or the page's first user interaction) instead
        // of issuing a second, redundant `context.resume()` call here.
        await this.resumeContext(context);
        this.emitDiagnostic(active, {
            record_type: 'audio-context-state',
            payload: { state: context.state, when: 'after-resume' },
        });
        if (!isAudioContextRunning(context)) {
            throw new Error('AudioContext remained suspended after resume');
        }
    }

    // T21: the single place that ever calls `context.resume()`. Both
    // `warmAudioContext()` and `ensureContextRunning()` go through this so a
    // resume already in flight is awaited exactly once, never restarted.
    // Never rejects -- a failed/suspended resume is only surfaced later, by
    // `ensureContextRunning()`'s own post-await state check, exactly as
    // before T21.
    private resumeContext(context: AudioContext): Promise<void> {
        if (this.contextResumePromise && this.contextResumePromiseContext === context) {
            return this.contextResumePromise;
        }

        const resumePromise: Promise<void> = context.resume().catch((error: unknown) => {
            this.warn('Leda voice AudioContext resume failed.', error);
        });
        this.contextResumePromise = resumePromise;
        this.contextResumePromiseContext = context;
        void resumePromise.finally(() => {
            if (this.contextResumePromise === resumePromise) {
                this.contextResumePromise = null;
                this.contextResumePromiseContext = null;
            }
        });
        return resumePromise;
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

        this.log('Leda Live playback completed');
        // T3: the only point where a progressive answer both measures its
        // needed prebuffer for reporting AND (when a policy is injected)
        // feeds that measurement back to the estimator -- this function
        // only ever runs on normal completion (guarded by streamCompleted
        // and an empty sourceNodes set above), never for a
        // stopped/cancelled/errored answer, so recordNeededPrebufferMs is
        // called exactly once per completed answer and never otherwise.
        const neededPrebufferMs = active.prebufferNeedTracker.neededPrebufferMs();
        this.prebufferPolicy?.recordNeededPrebufferMs(neededPrebufferMs);
        this.emitDiagnostic(active, {
            record_type: 'playback-ended',
            payload: {
                elapsed_ms: this.elapsedMs(active),
                transport: 'progressive',
                pcm_bytes: active.pcmBytes,
                pcm_duration_seconds: active.pcmDurationSeconds,
                underflow_count: active.underflowCount,
                // T1/T3: prebuffer_ms/prebuffer_mode are this answer's own
                // snapshotted values (see play()) -- the fixed
                // LEDA_PCM_PLAYBACK_LEAD_MS fallback when no
                // prebufferPolicy is injected, or the policy's resolved
                // value otherwise. needed_prebuffer_ms is measured
                // independently of whichever lead was actually used.
                prebuffer_ms: active.prebufferMs,
                needed_prebuffer_ms: neededPrebufferMs,
                prebuffer_mode: active.prebufferMode,
            },
        });
        this.cleanupActive('complete', false);
        active.lifecycle.onEnded?.();
    }

    private failActive(active: ActivePlayback, error: unknown): void {
        if (!this.isCurrent(active)) {
            return;
        }
        this.cleanupActive('error', true);
        this.warn('Leda voice audio playback failed.', error);
        active.lifecycle.onError?.(error);
    }

    private elapsedMs(active: ActivePlayback): number {
        return Math.max(0, this.now() - active.requestStartedAt);
    }

    private emitDiagnostic(active: ActivePlayback, payload: LedaAudioMetricPayload): void {
        const monotonicMs = Math.max(active.lastMetricAt, this.now());
        active.lastMetricAt = monotonicMs;
        try {
            const metric: LedaBrowserMetric = {
                ...payload,
                schema_version: '1',
                layer: 'browser',
                run_id: active.runId,
                sequence: active.metricSequence,
                monotonic_ms: monotonicMs,
                elapsed_ms: this.elapsedMs(active),
            };
            active.metricSequence += 1;
            this.onDiagnostic(metric);
        } catch {
            // Diagnostics must never change audio playback behavior.
        }
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
        if (reason === 'cancel') {
            this.emitDiagnostic(active, {
                record_type: 'cancel',
                payload: { elapsed_ms: this.elapsedMs(active) },
            });
        }
        if (reason === 'error') {
            this.emitDiagnostic(active, {
                record_type: 'error',
                payload: { elapsed_ms: this.elapsedMs(active), error_code: 'audio-failure' },
            });
        }
        if (reason === 'cancel' && active.mode === 'live' && active.liveRequestStarted) {
            this.log('Leda Live cancelled');
        }
    }
}
