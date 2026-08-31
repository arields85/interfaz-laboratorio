import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    PrismaOrbAudioTarget,
    PrismaVoiceAudioDiagnostic,
    PrismaVoiceAudioSource,
    VoicePlaybackLifecycle,
} from './prismaVoiceAudioEngine';
import { PrismaVoiceAudioEngine } from './prismaVoiceAudioEngine';
import { PRISMA_PCM_AUDIO_FORMAT } from './prismaPcmAudioFormat';

interface WorkletRecord {
    node: AudioWorkletNode;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    postMessage: ReturnType<typeof vi.fn>;
    emitMessage(type: 'started' | 'ended' | 'underflow'): void;
    emitProcessorError(): void;
}

function deferred<Value>() {
    let resolve!: (value: Value) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function pcmBytes(sampleCount: number, value = 16_384): Uint8Array {
    const bytes = new Uint8Array(sampleCount * Int16Array.BYTES_PER_ELEMENT);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < sampleCount; index += 1) {
        view.setInt16(index * Int16Array.BYTES_PER_ELEMENT, value, true);
    }
    return bytes;
}

function createTarget(): PrismaOrbAudioTarget {
    return { level: 0, setSpeaking: vi.fn() };
}

function createFrameHarness() {
    let nextId = 1;
    const callbacks = new Map<number, FrameRequestCallback>();
    return {
        request: vi.fn((callback: FrameRequestCallback) => {
            const id = nextId;
            nextId += 1;
            callbacks.set(id, callback);
            return id;
        }),
        cancel: vi.fn((id: number) => callbacks.delete(id)),
        runNext: () => {
            const next = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
            if (!next) throw new Error('No animation frame is queued');
            callbacks.delete(next[0]);
            next[1](16);
        },
        count: () => callbacks.size,
    };
}

function createHarness(sampleRate = PRISMA_PCM_AUDIO_FORMAT.sampleRate) {
    let analyserSamples: readonly number[] = [0, 0, 0, 0];
    const processorListeners = new Map<AudioWorkletNode, EventListener>();
    const worklets: WorkletRecord[] = [];
    const addModule = vi.fn(async () => undefined);
    const createBufferSource = vi.fn();
    const analyser = {
        fftSize: 4,
        smoothingTimeConstant: 0,
        connect: vi.fn(),
        disconnect: vi.fn(),
        getFloatTimeDomainData: vi.fn((target: Float32Array<ArrayBuffer>) => {
            target.forEach((_, index) => {
                target[index] = analyserSamples[index] ?? 0;
            });
        }),
    } as unknown as AnalyserNode;
    const context = {
        state: 'running',
        currentTime: 1,
        sampleRate,
        destination: {} as AudioDestinationNode,
        audioWorklet: { addModule },
        createAnalyser: vi.fn(() => analyser),
        createBufferSource,
        close: vi.fn(async () => undefined),
    } as unknown as AudioContext;
    const createAudioContext = vi.fn((options?: AudioContextOptions) => {
        void options;
        return context;
    });

    const createAudioWorkletNode = vi.fn(() => {
        const connect = vi.fn();
        const disconnect = vi.fn();
        const postMessage = vi.fn();
        const port = {
            onmessage: null,
            postMessage,
        } as unknown as MessagePort;
        const node = {
            port,
            connect,
            disconnect,
            addEventListener: vi.fn((type: string, listener: EventListener) => {
                if (type === 'processorerror') processorListeners.set(node, listener);
            }),
            removeEventListener: vi.fn((type: string) => {
                if (type === 'processorerror') processorListeners.delete(node);
            }),
        } as unknown as AudioWorkletNode;
        const record: WorkletRecord = {
            node,
            connect,
            disconnect,
            postMessage,
            emitMessage(type) {
                port.onmessage?.(new MessageEvent('message', { data: { type } }));
            },
            emitProcessorError() {
                processorListeners.get(node)?.(new Event('processorerror'));
            },
        };
        worklets.push(record);
        return node;
    });

    return {
        context,
        analyser,
        addModule,
        createAudioContext,
        createBufferSource,
        createAudioWorkletNode,
        worklets,
        setAnalyserSamples(samples: readonly number[]) {
            analyserSamples = samples;
        },
    };
}

function createDeferredSource(
    reads: Array<ReturnType<typeof deferred<ReadableStreamReadResult<Uint8Array>>>>,
) {
    let index = 0;
    const reader = {
        read: vi.fn(() => reads[index++]?.promise ?? Promise.resolve({ done: true, value: undefined })),
        cancel: vi.fn(async () => undefined),
        releaseLock: vi.fn(),
    } as unknown as ReadableStreamDefaultReader<Uint8Array> & {
        cancel: ReturnType<typeof vi.fn>;
    };
    let signal: AbortSignal | undefined;
    const source: PrismaVoiceAudioSource = {
        playbackTransport: 'buffer-before-playback',
        openLive: vi.fn(async (nextSignal) => {
            signal = nextSignal;
            return {
                reader,
                sampleRate: PRISMA_PCM_AUDIO_FORMAT.sampleRate,
                channels: PRISMA_PCM_AUDIO_FORMAT.channels,
            };
        }),
    };
    return { source, reader, signal: () => signal };
}

async function settle(rounds = 20): Promise<void> {
    for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

describe('PrismaVoiceAudioEngine Local AudioWorklet playback', () => {
    let harness: ReturnType<typeof createHarness>;
    let frames: ReturnType<typeof createFrameHarness>;
    let now: number;
    let diagnostics: PrismaVoiceAudioDiagnostic[];

    beforeEach(() => {
        harness = createHarness();
        frames = createFrameHarness();
        now = 0;
        diagnostics = [];
    });

    function createEngine(): PrismaVoiceAudioEngine {
        return new PrismaVoiceAudioEngine({
            createAudioContext: harness.createAudioContext,
            createAudioWorkletNode: harness.createAudioWorkletNode,
            requestAnimationFrame: frames.request,
            cancelAnimationFrame: frames.cancel,
            now: () => now,
            onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
            warn: vi.fn(),
        });
    }

    it('requests and accepts the canonical render rate so one second of source PCM spans one render second', async () => {
        const reads = Array.from({ length: 2 }, () => deferred<ReadableStreamReadResult<Uint8Array>>());
        const { source } = createDeferredSource(reads);
        const lifecycle: VoicePlaybackLifecycle = { onError: vi.fn() };

        createEngine().play(source, createTarget(), lifecycle);
        await settle();
        reads[0]?.resolve({
            done: false,
            value: pcmBytes(PRISMA_PCM_AUDIO_FORMAT.sampleRate),
        });
        await settle(40);
        reads[1]?.resolve({ done: true, value: undefined });
        await settle(40);

        expect(harness.createAudioContext).toHaveBeenCalledExactlyOnceWith({
            sampleRate: PRISMA_PCM_AUDIO_FORMAT.sampleRate,
        });
        expect(harness.context.sampleRate).toBe(PRISMA_PCM_AUDIO_FORMAT.sampleRate);
        expect(harness.worklets).toHaveLength(1);
        const enqueueMessage = harness.worklets[0]?.postMessage.mock.calls.find(
            ([message]) => message.type === 'enqueue',
        )?.[0] as { samples: Float32Array } | undefined;
        expect(enqueueMessage?.samples).toHaveLength(PRISMA_PCM_AUDIO_FORMAT.sampleRate);
        expect((enqueueMessage?.samples.length ?? 0) / harness.context.sampleRate).toBe(1);
        expect(lifecycle.onError).not.toHaveBeenCalled();
    });

    it('rejects a mismatching render clock before creating or starting a worklet node', async () => {
        harness = createHarness(48_000);
        const reads = [deferred<ReadableStreamReadResult<Uint8Array>>()];
        const { source, reader } = createDeferredSource(reads);
        const lifecycle: VoicePlaybackLifecycle = {
            onStarted: vi.fn(),
            onError: vi.fn(),
        };

        createEngine().play(source, createTarget(), lifecycle);
        await settle(40);

        expect(harness.addModule).not.toHaveBeenCalled();
        expect(harness.createAudioWorkletNode).not.toHaveBeenCalled();
        expect(harness.worklets).toHaveLength(0);
        expect(harness.createAudioContext).toHaveBeenCalledExactlyOnceWith({
            sampleRate: PRISMA_PCM_AUDIO_FORMAT.sampleRate,
        });
        expect(lifecycle.onStarted).not.toHaveBeenCalled();
        expect(lifecycle.onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            message: expect.stringContaining('48000'),
        }));
        expect(reader.cancel).toHaveBeenCalledTimes(1);
    });

    it('starts once at exactly 2.5 seconds despite long TTFB and keeps enqueueing through EOF', async () => {
        const reads = Array.from({ length: 4 }, () => deferred<ReadableStreamReadResult<Uint8Array>>());
        const { source } = createDeferredSource(reads);
        const target = createTarget();
        const lifecycle: VoicePlaybackLifecycle = {
            onStarted: vi.fn(),
            onEnded: vi.fn(),
            onError: vi.fn(),
        };
        const engine = createEngine();

        engine.play(source, target, lifecycle);
        await settle();
        now = 120_000;
        reads[0]?.resolve({ done: false, value: pcmBytes(59_999) });
        await settle(40);

        expect(harness.worklets).toHaveLength(1);
        expect(harness.createBufferSource).not.toHaveBeenCalled();
        expect(harness.worklets[0]?.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
            'enqueue',
        ]);
        expect(lifecycle.onStarted).not.toHaveBeenCalled();

        now = 180_000;
        reads[1]?.resolve({ done: false, value: pcmBytes(1) });
        await settle(40);
        expect(harness.worklets[0]?.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
            'enqueue',
            'enqueue',
            'start',
        ]);
        expect(lifecycle.onStarted).not.toHaveBeenCalled();
        expect(target.setSpeaking).not.toHaveBeenCalledWith(true);

        harness.worklets[0]?.emitMessage('started');
        harness.worklets[0]?.emitMessage('started');
        expect(lifecycle.onStarted).toHaveBeenCalledTimes(1);
        expect(target.setSpeaking).toHaveBeenCalledWith(true);
        expect(harness.worklets[0]?.connect).toHaveBeenCalledExactlyOnceWith(harness.analyser);
        expect(harness.analyser.connect).toHaveBeenCalledExactlyOnceWith(harness.context.destination);

        harness.setAnalyserSamples([0.5, -0.5, 0.5, -0.5]);
        frames.runNext();
        expect(target.level).toBeGreaterThan(0);

        now = 181_000;
        reads[2]?.resolve({ done: false, value: pcmBytes(24_000) });
        await settle(40);
        expect(harness.worklets[0]?.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
            'enqueue',
            'enqueue',
            'start',
            'enqueue',
        ]);
        expect(harness.worklets[0]?.postMessage.mock.calls.filter(
            ([message]) => message.type === 'start',
        )).toHaveLength(1);

        harness.worklets[0]?.emitMessage('ended');
        harness.worklets[0]?.emitMessage('ended');
        expect(lifecycle.onEnded).not.toHaveBeenCalled();

        reads[3]?.resolve({ done: true, value: undefined });
        await settle(40);
        expect(harness.worklets[0]?.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
            'enqueue',
            'enqueue',
            'start',
            'enqueue',
            'end',
        ]);
        expect(harness.worklets[0]?.postMessage.mock.calls.filter(
            ([message]) => message.type === 'end',
        )).toHaveLength(1);

        harness.worklets[0]?.emitMessage('ended');
        harness.worklets[0]?.emitMessage('ended');
        expect(lifecycle.onEnded).toHaveBeenCalledTimes(1);
        expect(lifecycle.onError).not.toHaveBeenCalled();
        expect(target.setSpeaking).toHaveBeenLastCalledWith(false);
        expect(frames.count()).toBe(0);
        expect(diagnostics.filter(({ record_type }) => record_type === 'playback-started')).toEqual([
            expect.objectContaining({
                payload: expect.objectContaining({ underflow_count: 0 }),
            }),
        ]);
        expect(diagnostics.filter(({ record_type }) => record_type === 'playback-ended')).toEqual([
            expect.objectContaining({
                payload: expect.objectContaining({ underflow_count: 0 }),
            }),
        ]);
    });

    it('starts once at EOF when valid queued audio remains below 2.5 seconds', async () => {
        const reads = Array.from({ length: 2 }, () => deferred<ReadableStreamReadResult<Uint8Array>>());
        const { source } = createDeferredSource(reads);
        const lifecycle: VoicePlaybackLifecycle = {
            onStarted: vi.fn(),
            onEnded: vi.fn(),
        };
        const engine = createEngine();

        engine.play(source, createTarget(), lifecycle);
        await settle();
        now = 60_000;
        reads[0]?.resolve({ done: false, value: pcmBytes(24_000) });
        await settle(40);
        expect(harness.worklets[0]?.postMessage.mock.calls.map(([message]) => message.type)).toEqual(['enqueue']);

        reads[1]?.resolve({ done: true, value: undefined });
        await settle(40);
        expect(harness.worklets[0]?.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
            'enqueue',
            'end',
            'start',
        ]);
        expect(harness.createBufferSource).not.toHaveBeenCalled();
        expect(lifecycle.onStarted).not.toHaveBeenCalled();

        harness.worklets[0]?.emitMessage('started');
        harness.worklets[0]?.emitMessage('started');
        expect(lifecycle.onStarted).toHaveBeenCalledTimes(1);
        harness.worklets[0]?.emitMessage('ended');
        harness.worklets[0]?.emitMessage('ended');
        expect(lifecycle.onEnded).toHaveBeenCalledTimes(1);
    });

    it('flushes below-threshold audio on replacement without starting or accepting stale messages', async () => {
        const firstReads = Array.from({ length: 2 }, () => deferred<ReadableStreamReadResult<Uint8Array>>());
        const first = createDeferredSource(firstReads);
        const firstLifecycle: VoicePlaybackLifecycle = {
            onStarted: vi.fn(),
            onEnded: vi.fn(),
            onError: vi.fn(),
        };
        const engine = createEngine();
        engine.play(first.source, createTarget(), firstLifecycle);
        await settle();
        now = 120_000;
        firstReads[0]?.resolve({ done: false, value: pcmBytes(59_999) });
        await settle(40);
        expect(harness.worklets[0]?.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
            'enqueue',
        ]);
        const staleMessage = harness.worklets[0]?.node.port.onmessage;

        const replacementReads = [deferred<ReadableStreamReadResult<Uint8Array>>()];
        const replacement = createDeferredSource(replacementReads);
        engine.play(replacement.source, createTarget(), {});
        await settle(40);

        expect(first.signal()?.aborted).toBe(true);
        expect(first.reader.cancel).toHaveBeenCalledTimes(1);
        expect(harness.worklets[0]?.postMessage).toHaveBeenLastCalledWith({ type: 'reset' });
        expect(harness.worklets[0]?.postMessage.mock.calls.some(
            ([message]) => message.type === 'start',
        )).toBe(false);
        expect(harness.worklets[0]?.disconnect).toHaveBeenCalledTimes(1);
        expect(harness.worklets).toHaveLength(2);

        staleMessage?.(new MessageEvent('message', { data: { type: 'started' } }));
        staleMessage?.(new MessageEvent('message', { data: { type: 'ended' } }));
        expect(firstLifecycle.onStarted).not.toHaveBeenCalled();
        expect(firstLifecycle.onEnded).not.toHaveBeenCalled();
        expect(firstLifecycle.onError).not.toHaveBeenCalled();
    });

    it('turns processorerror into one typed Local failure and cleans permanent silence', async () => {
        const reads = [deferred<ReadableStreamReadResult<Uint8Array>>()];
        const { source, reader } = createDeferredSource(reads);
        const lifecycle: VoicePlaybackLifecycle = { onError: vi.fn() };
        const target = createTarget();

        createEngine().play(source, target, lifecycle);
        await settle(40);
        harness.worklets[0]?.emitProcessorError();
        harness.worklets[0]?.emitProcessorError();

        expect(lifecycle.onError).toHaveBeenCalledTimes(1);
        expect(lifecycle.onError).toHaveBeenCalledWith(expect.objectContaining({
            name: 'PrismaLocalPlaybackError',
            code: 'audio-worklet-processor-error',
        }));
        expect(reader.cancel).toHaveBeenCalledTimes(1);
        expect(harness.worklets[0]?.postMessage).toHaveBeenLastCalledWith({ type: 'reset' });
        expect(harness.worklets[0]?.disconnect).toHaveBeenCalledTimes(1);
        expect(target.setSpeaking).toHaveBeenLastCalledWith(false);
    });

    it('reports an actual pre-EOF underflow as a count-bearing failure', async () => {
        const reads = Array.from({ length: 2 }, () => deferred<ReadableStreamReadResult<Uint8Array>>());
        const { source } = createDeferredSource(reads);
        const lifecycle: VoicePlaybackLifecycle = {
            onStarted: vi.fn(),
            onEnded: vi.fn(),
            onError: vi.fn(),
        };

        createEngine().play(source, createTarget(), lifecycle);
        await settle(40);
        reads[0]?.resolve({ done: false, value: pcmBytes(60_000) });
        await settle(40);
        expect(harness.worklets[0]?.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
            'enqueue',
            'start',
        ]);
        harness.worklets[0]?.emitMessage('started');
        harness.worklets[0]?.emitMessage('underflow');
        harness.worklets[0]?.emitMessage('underflow');

        expect(lifecycle.onStarted).toHaveBeenCalledTimes(1);
        expect(lifecycle.onEnded).not.toHaveBeenCalled();
        expect(lifecycle.onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            name: 'PrismaLocalPlaybackError',
            code: 'audio-worklet-underflow',
        }));
        expect(diagnostics.filter(({ record_type }) => record_type === 'underflow')).toEqual([
            expect.objectContaining({ payload: { underflow_count: 1 } }),
        ]);
        expect(harness.worklets[0]?.postMessage).toHaveBeenLastCalledWith({ type: 'reset' });
        expect(harness.worklets[0]?.disconnect).toHaveBeenCalledTimes(1);
    });
});
