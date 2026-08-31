import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    PrismaOrbAudioTarget,
    PrismaVoiceAudioDiagnostic,
    PrismaVoiceAudioSource,
    PrismaVoicePcmStream,
    VoicePlaybackLifecycle,
} from './prismaVoiceAudioEngine';
import {
    PRISMA_PCM_BLOCK_SAMPLES,
    PRISMA_PCM_SAMPLE_RATE,
    PcmS16LeBlockAssembler,
    PrismaVoiceAudioEngine,
} from './prismaVoiceAudioEngine';

interface SourceRecord {
    node: AudioBufferSourceNode;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
}

interface WorkletRecord {
    node: AudioWorkletNode;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    postMessage: ReturnType<typeof vi.fn>;
    emitMessage(type: 'started' | 'ended' | 'underflow'): void;
}

interface AudioHarness {
    context: AudioContext;
    createAudioContext: ReturnType<typeof vi.fn<(options?: AudioContextOptions) => AudioContext>>;
    analyser: AnalyserNode;
    sources: SourceRecord[];
    worklets: WorkletRecord[];
    buffers: Array<{ samples: Float32Array; sampleRate: number }>;
    analyserConnect: ReturnType<typeof vi.fn>;
    analyserDisconnect: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    decodeAudioData: ReturnType<typeof vi.fn>;
    createAudioWorkletNode: (
        context: AudioContext,
        name: string,
        options: AudioWorkletNodeOptions,
    ) => AudioWorkletNode;
    setCurrentTime: (time: number) => void;
    setTimeDomainData: (samples: readonly number[]) => void;
}

function createAudioHarness(initialState: AudioContextState = 'running'): AudioHarness {
    let state = initialState;
    let currentTime = 1;
    let timeDomainData: readonly number[] = [0, 0, 0, 0];
    const destination = {} as AudioDestinationNode;
    const analyserConnect = vi.fn();
    const analyserDisconnect = vi.fn();
    const resume = vi.fn(async () => {
        state = 'running';
    });
    const close = vi.fn(async () => undefined);
    const decodeAudioData = vi.fn(async () => ({ duration: 0.5 }) as AudioBuffer);
    const sources: SourceRecord[] = [];
    const worklets: WorkletRecord[] = [];
    const buffers: Array<{ samples: Float32Array; sampleRate: number }> = [];
    const analyser = {
        fftSize: 4,
        smoothingTimeConstant: 0,
        connect: analyserConnect,
        disconnect: analyserDisconnect,
        getFloatTimeDomainData: vi.fn((target: Float32Array<ArrayBuffer>) => {
            target.forEach((_, index) => {
                target[index] = timeDomainData[index] ?? 0;
            });
        }),
    } as unknown as AnalyserNode;
    const context = {
        get state() {
            return state;
        },
        get currentTime() {
            return currentTime;
        },
        sampleRate: PRISMA_PCM_SAMPLE_RATE,
        destination,
        audioWorklet: { addModule: vi.fn(async () => undefined) },
        createAnalyser: vi.fn(() => analyser),
        createBuffer: vi.fn((_channels: number, length: number, sampleRate: number) => {
            const record = { samples: new Float32Array(length), sampleRate };
            buffers.push(record);
            return {
                duration: length / sampleRate,
                copyToChannel: (samples: Float32Array) => record.samples.set(samples),
            } as unknown as AudioBuffer;
        }),
        createBufferSource: vi.fn(() => {
            const connect = vi.fn();
            const disconnect = vi.fn();
            const start = vi.fn();
            const stop = vi.fn();
            const node = {
                buffer: null,
                onended: null,
                connect,
                disconnect,
                start,
                stop,
            } as unknown as AudioBufferSourceNode;
            sources.push({ node, connect, disconnect, start, stop });
            return node;
        }),
        decodeAudioData,
        resume,
        close,
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
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        } as unknown as AudioWorkletNode;
        worklets.push({
            node,
            connect,
            disconnect,
            postMessage,
            emitMessage(type) {
                port.onmessage?.(new MessageEvent('message', { data: { type } }));
            },
        });
        return node;
    });

    return {
        context,
        createAudioContext,
        analyser,
        sources,
        worklets,
        buffers,
        analyserConnect,
        analyserDisconnect,
        resume,
        close,
        decodeAudioData,
        createAudioWorkletNode,
        setCurrentTime: (time) => {
            currentTime = time;
        },
        setTimeDomainData: (samples) => {
            timeDomainData = samples;
        },
    };
}

function createFrameHarness() {
    let nextId = 1;
    const frames = new Map<number, FrameRequestCallback>();

    return {
        request: vi.fn((callback: FrameRequestCallback) => {
            const id = nextId++;
            frames.set(id, callback);
            return id;
        }),
        cancel: vi.fn((id: number) => {
            frames.delete(id);
        }),
        runNext: () => {
            const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
            if (!next) throw new Error('No animation frame is queued');
            frames.delete(next[0]);
            next[1](16);
        },
        count: () => frames.size,
    };
}

function createTimerHarness() {
    let nextId = 1;
    const timers = new Map<number, { callback: () => void; delay: number }>();

    return {
        set: vi.fn((callback: () => void, delay: number) => {
            const id = nextId++;
            timers.set(id, { callback, delay });
            return id;
        }),
        clear: vi.fn((id: number) => {
            timers.delete(id);
        }),
        runNext: () => {
            const next = timers.entries().next().value as [number, { callback: () => void }] | undefined;
            if (!next) throw new Error('No timer is queued');
            timers.delete(next[0]);
            next[1].callback();
        },
        count: () => timers.size,
        delays: () => Array.from(timers.values(), ({ delay }) => delay),
    };
}

function createTarget(): PrismaOrbAudioTarget {
    return { level: 0, setSpeaking: vi.fn() };
}

function pcmBytes(sampleCount: number, value = 16_384): Uint8Array {
    const bytes = new Uint8Array(sampleCount * 2);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < sampleCount; index += 1) {
        view.setInt16(index * 2, value, true);
    }
    return bytes;
}

function createReader(
    results: Array<ReadableStreamReadResult<Uint8Array>>,
): ReadableStreamDefaultReader<Uint8Array> & { cancel: ReturnType<typeof vi.fn> } {
    let index = 0;
    return {
        read: vi.fn(async () => results[index++] ?? { done: true, value: undefined }),
        cancel: vi.fn(async () => undefined),
    } as unknown as ReadableStreamDefaultReader<Uint8Array> & { cancel: ReturnType<typeof vi.fn> };
}

function createLiveSource(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    loadWav?: PrismaVoiceAudioSource['loadWav'],
    playbackTransport: 'progressive' | 'buffer-before-playback' = 'progressive',
): PrismaVoiceAudioSource {
    return {
        playbackTransport,
        openLive: vi.fn(async (): Promise<PrismaVoicePcmStream> => ({
            reader,
            sampleRate: 24_000,
            channels: 1,
        })),
        loadWav,
    };
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

async function settlePlayback(rounds = 12): Promise<void> {
    for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

describe('PcmS16LeBlockAssembler', () => {
    it('decodes signed little-endian PCM and carries a split sample between chunks', () => {
        const assembler = new PcmS16LeBlockAssembler(4);

        expect(assembler.push(Uint8Array.from([0x00]))).toEqual([]);
        const blocks = assembler.push(Uint8Array.from([
            0x80, 0xff, 0xff, 0x00, 0x00, 0xff, 0x7f,
        ]));

        expect(Array.from(blocks[0] ?? [])).toEqual([
            -1,
            -1 / 32_768,
            0,
            32_767 / 32_768,
        ]);
    });

    it('emits fixed blocks, flushes the final partial block, and drops odd EOF carry', () => {
        const assembler = new PcmS16LeBlockAssembler(3);

        const blocks = assembler.push(Uint8Array.from([
            ...pcmBytes(3, 1_000),
            ...pcmBytes(2, -1_000),
            0x55,
        ]));

        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toHaveLength(3);
        expect(assembler.finish()).toHaveLength(2);
        expect(assembler.finish()).toBeNull();
    });
});

describe('PrismaVoiceAudioEngine', () => {
    let audio: AudioHarness;
    let frames: ReturnType<typeof createFrameHarness>;
    let timers: ReturnType<typeof createTimerHarness>;
    let warn: ReturnType<typeof vi.fn>;
    let log: ReturnType<typeof vi.fn>;
    let now: number;
    let diagnostics: PrismaVoiceAudioDiagnostic[];

    beforeEach(() => {
        audio = createAudioHarness();
        frames = createFrameHarness();
        timers = createTimerHarness();
        warn = vi.fn();
        log = vi.fn();
        now = 100;
        diagnostics = [];
    });

    function createEngine(): PrismaVoiceAudioEngine {
        return new PrismaVoiceAudioEngine({
            createAudioContext: audio.createAudioContext,
            createAudioWorkletNode: audio.createAudioWorkletNode,
            requestAnimationFrame: frames.request,
            cancelAnimationFrame: frames.cancel,
            setTimeout: timers.set,
            clearTimeout: timers.clear,
            now: () => now,
            warn,
            log,
            onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        });
    }

    it('schedules 75 ms PCM blocks contiguously through one analyser and completes on the final source end', async () => {
        const reader = createReader([
            { done: false, value: pcmBytes(PRISMA_PCM_BLOCK_SAMPLES * 2) },
            { done: true, value: undefined },
        ]);
        const target = createTarget();
        const lifecycle: VoicePlaybackLifecycle = { onStarted: vi.fn(), onEnded: vi.fn() };
        const engine = createEngine();

        engine.play(createLiveSource(reader), target, lifecycle);
        now = 142;
        await settlePlayback();

        expect(audio.buffers.map(({ samples, sampleRate }) => [samples.length, sampleRate])).toEqual([
            [1_800, 24_000],
            [1_800, 24_000],
        ]);
        expect(audio.sources[0]?.start).toHaveBeenCalledWith(1.025);
        expect(audio.sources[1]?.start.mock.calls[0]?.[0]).toBeCloseTo(1.1);
        expect(audio.sources.every(({ connect }) => connect.mock.calls[0]?.[0] === audio.analyser)).toBe(true);
        expect(audio.analyserConnect).toHaveBeenCalledTimes(1);
        expect(audio.analyserConnect).toHaveBeenCalledWith(audio.context.destination);
        expect(audio.createAudioContext.mock.calls).toEqual([[]]);
        expect(target.setSpeaking).not.toHaveBeenCalledWith(true);
        expect(log).toHaveBeenCalledWith('Prisma Live request started');
        expect(log).toHaveBeenCalledWith('Prisma Live first audio: 42 ms');
        expect(log).toHaveBeenCalledWith('Prisma Live stream completed');
        expect(timers.delays()[0]).toBeCloseTo(25);
        expect(diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({
                record_type: 'canonical-decode',
                payload: expect.objectContaining({ transport: 'progressive' }),
            }),
            expect.objectContaining({
                record_type: 'eof',
                payload: expect.objectContaining({
                    transport: 'progressive',
                    pcm_bytes: PRISMA_PCM_BLOCK_SAMPLES * 2 * 2,
                }),
            }),
        ]));

        timers.runNext();
        expect(target.setSpeaking).toHaveBeenCalledWith(true);
        expect(lifecycle.onStarted).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith('Prisma Live playback started');

        audio.setTimeDomainData([0.5, -0.5, 0.5, -0.5]);
        frames.runNext();
        expect(target.level).toBeGreaterThan(0);

        audio.sources[0]?.node.onended?.(new Event('ended'));
        expect(lifecycle.onEnded).not.toHaveBeenCalled();
        audio.sources[1]?.node.onended?.(new Event('ended'));

        expect(target.level).toBe(0);
        expect(target.setSpeaking).toHaveBeenLastCalledWith(false);
        expect(lifecycle.onEnded).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith('Prisma Live playback completed');
        expect(frames.count()).toBe(0);
    });

    it('starts Local at the fixed target regardless of delivery rate and drains one worklet exactly once', async () => {
        const reads = Array.from({ length: 5 }, () => (
            deferred<ReadableStreamReadResult<Uint8Array>>()
        ));
        let readIndex = 0;
        const reader = {
            read: vi.fn(() => reads[readIndex++]!.promise),
            cancel: vi.fn(async () => undefined),
            releaseLock: vi.fn(),
        } as unknown as ReadableStreamDefaultReader<Uint8Array> & {
            cancel: ReturnType<typeof vi.fn>;
        };
        const target = createTarget();
        const lifecycle: VoicePlaybackLifecycle = {
            onStarted: vi.fn(),
            onEnded: vi.fn(),
            onError: vi.fn(),
        };
        const engine = createEngine();
        const chunk = pcmBytes(18_000);

        engine.play(
            createLiveSource(reader, undefined, 'buffer-before-playback'),
            target,
            lifecycle,
        );
        await settlePlayback();

        const deliveryTimes = [1, 5, 9, 13];
        const diagnosticTimes = [827.584, 4_827.584, 8_827.584, 13_096.815];
        for (let index = 0; index < 4; index += 1) {
            audio.setCurrentTime(deliveryTimes[index]!);
            now = diagnosticTimes[index]!;
            reads[index]!.resolve({ done: false, value: chunk });
            await settlePlayback(30);
            expect(audio.sources).toHaveLength(0);
            expect(audio.worklets).toHaveLength(1);
            expect(audio.worklets[0]?.postMessage.mock.calls.map(([message]) => message.type)).toEqual(
                index === 3
                    ? ['enqueue', 'enqueue', 'enqueue', 'enqueue', 'start']
                    : Array.from({ length: index + 1 }, () => 'enqueue'),
            );
            expect(target.setSpeaking).not.toHaveBeenCalledWith(true);
            expect(lifecycle.onStarted).not.toHaveBeenCalled();
        }

        reads[4]!.resolve({ done: true, value: undefined });
        await settlePlayback(30);

        expect(audio.buffers).toHaveLength(0);
        expect(audio.sources).toHaveLength(0);
        expect(audio.worklets).toHaveLength(1);
        expect(audio.worklets[0]?.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
            'enqueue',
            'enqueue',
            'enqueue',
            'enqueue',
            'start',
            'end',
        ]);
        expect(audio.worklets[0]?.connect).toHaveBeenCalledExactlyOnceWith(audio.analyser);
        expect(audio.analyserConnect).toHaveBeenCalledExactlyOnceWith(audio.context.destination);
        expect(target.setSpeaking).toHaveBeenCalledExactlyOnceWith(false);
        expect(lifecycle.onStarted).not.toHaveBeenCalled();

        audio.worklets[0]?.emitMessage('started');
        expect(target.setSpeaking).toHaveBeenNthCalledWith(2, true);
        expect(lifecycle.onStarted).toHaveBeenCalledTimes(1);
        expect(lifecycle.onError).not.toHaveBeenCalled();
        expect(diagnostics).toHaveLength(6);
        expect(diagnostics[0]).toMatchObject({
            schema_version: '1',
            layer: 'browser',
            record_type: 'request-start',
        });
        expect(diagnostics[1]).toMatchObject({
            schema_version: '1',
            layer: 'browser',
            record_type: 'first-readable-audio',
            payload: { elapsed_ms: 727.584, pcm_bytes: 36_000 },
        });
        expect(diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({
                schema_version: '1',
                layer: 'browser',
                record_type: 'eof',
                payload: {
                    transport: 'buffer-before-playback',
                    elapsed_ms: 12_996.815,
                    pcm_bytes: 144_000,
                    pcm_duration_seconds: 3,
                },
            }),
            expect.objectContaining({
                schema_version: '1',
                layer: 'browser',
                record_type: 'canonical-decode',
                payload: expect.objectContaining({
                    transport: 'buffer-before-playback',
                }),
            }),
        ]));
        expect(diagnostics.find(({ record_type }) => record_type === 'buffering-complete')).toMatchObject({
            schema_version: '1',
            layer: 'browser',
            record_type: 'buffering-complete',
            payload: {
                elapsed_ms: 12_996.815,
                pcm_bytes: 144_000,
                pcm_duration_seconds: 3,
            },
        });
        expect(diagnostics.find(({ record_type }) => record_type === 'playback-started')).toMatchObject({
            schema_version: '1',
            layer: 'browser',
            record_type: 'playback-started',
            payload: {
                elapsed_ms: 12_996.815,
                transport: 'buffer-before-playback',
                pcm_bytes: 144_000,
                pcm_duration_seconds: 3,
                underflow_count: 0,
            },
        });

        now = 16_096.815;
        audio.worklets[0]?.emitMessage('ended');
        audio.worklets[0]?.emitMessage('ended');

        expect(lifecycle.onEnded).toHaveBeenCalledTimes(1);
        expect(target.setSpeaking.mock.calls).toEqual([[false], [true], [false]]);
        expect(diagnostics.at(-1)).toMatchObject({
            schema_version: '1',
            layer: 'browser',
            record_type: 'playback-ended',
            payload: {
                elapsed_ms: 15_996.815,
                transport: 'buffer-before-playback',
                pcm_bytes: 144_000,
                pcm_duration_seconds: 3,
                underflow_count: 0,
            },
        });
    });

    it('records positive underflow evidence when the audio clock outruns the scheduled block', async () => {
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: pcmBytes(PRISMA_PCM_BLOCK_SAMPLES) })
                .mockImplementationOnce(async () => {
                    audio.setCurrentTime(2);
                    return { done: false, value: pcmBytes(PRISMA_PCM_BLOCK_SAMPLES) };
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            cancel: vi.fn(async () => undefined),
        } as unknown as ReadableStreamDefaultReader<Uint8Array>;
        const engine = createEngine();

        engine.play(createLiveSource(reader), createTarget(), {});
        await settlePlayback(30);
        timers.runNext();

        expect(diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({
                record_type: 'playback-started',
                payload: expect.objectContaining({ transport: 'progressive', underflow_count: 1 }),
            }),
        ]));

        audio.sources.forEach(({ node }) => node.onended?.(new Event('ended')));
        expect(diagnostics.at(-1)).toMatchObject({
            record_type: 'playback-ended',
            payload: expect.objectContaining({ transport: 'progressive', underflow_count: 1 }),
        });
    });

    it('preserves exact PCM samples when Local chunk boundaries split 16-bit values', async () => {
        const bytes = pcmBytes(5, -12_345);
        const reader = createReader([
            { done: false, value: bytes.slice(0, 1) },
            { done: false, value: bytes.slice(1, 4) },
            { done: false, value: bytes.slice(4, 9) },
            { done: false, value: bytes.slice(9) },
            { done: true, value: undefined },
        ]);

        createEngine().play(
            createLiveSource(reader, undefined, 'buffer-before-playback'),
            createTarget(),
            {},
        );
        await settlePlayback(30);

        expect(audio.buffers).toHaveLength(0);
        expect(audio.sources).toHaveLength(0);
        expect(audio.worklets).toHaveLength(1);
        const enqueuedSamples = audio.worklets[0]?.postMessage.mock.calls.flatMap(
            ([message]: [{ type: string; samples?: Float32Array }]) => (
                message.type === 'enqueue' ? Array.from(message.samples ?? []) : []
            ),
        ) ?? [];
        expect(enqueuedSamples).toEqual(
            Array.from({ length: 5 }, () => -12_345 / 32_768),
        );
        expect(audio.worklets[0]?.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
            'enqueue',
            'enqueue',
            'enqueue',
            'end',
            'start',
        ]);
    });

    it('cancels Local fetch and reader during buffering without orphan callbacks, then remains reusable', async () => {
        const pendingRead = deferred<ReadableStreamReadResult<Uint8Array>>();
        const reader = {
            read: vi.fn(() => pendingRead.promise),
            cancel: vi.fn(async () => undefined),
        } as unknown as ReadableStreamDefaultReader<Uint8Array> & {
            cancel: ReturnType<typeof vi.fn>;
        };
        let signal: AbortSignal | undefined;
        const source = {
            playbackTransport: 'buffer-before-playback',
            openLive: vi.fn(async (nextSignal: AbortSignal) => {
                signal = nextSignal;
                return { reader, sampleRate: 24_000, channels: 1 };
            }),
        } as unknown as PrismaVoiceAudioSource;
        const lifecycle: VoicePlaybackLifecycle = {
            onStarted: vi.fn(),
            onEnded: vi.fn(),
            onError: vi.fn(),
        };
        const engine = createEngine();

        engine.play(source, createTarget(), lifecycle);
        await settlePlayback();
        engine.stop();
        pendingRead.resolve({ done: false, value: pcmBytes(10) });
        await settlePlayback();

        expect(signal?.aborted).toBe(true);
        expect(reader.cancel).toHaveBeenCalledTimes(1);
        expect(audio.sources).toHaveLength(0);
        expect(audio.worklets[0]?.postMessage).toHaveBeenLastCalledWith({ type: 'reset' });
        expect(audio.worklets[0]?.disconnect).toHaveBeenCalledTimes(1);
        expect(lifecycle.onStarted).not.toHaveBeenCalled();
        expect(lifecycle.onEnded).not.toHaveBeenCalled();
        expect(lifecycle.onError).not.toHaveBeenCalled();

        engine.play(
            createLiveSource(
                createReader([
                    { done: false, value: pcmBytes(10) },
                    { done: true, value: undefined },
                ]),
                undefined,
                'buffer-before-playback',
            ),
            createTarget(),
            {},
        );
        await settlePlayback(30);

        expect(audio.sources).toHaveLength(0);
        expect(audio.worklets).toHaveLength(2);
        expect(audio.worklets[1]?.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
            'enqueue',
            'end',
            'start',
        ]);
    });

    it.each([
        ['empty stream', () => ({
            reader: createReader([{ done: true, value: undefined }]),
            sampleRate: 24_000,
            channels: 1,
        })],
        ['invalid metadata', () => ({
            reader: createReader([{ done: true, value: undefined }]),
            sampleRate: 16_000,
            channels: 1,
        })],
        ['odd trailing PCM byte', () => ({
            reader: createReader([
                { done: false, value: Uint8Array.from([0x00]) },
                { done: true, value: undefined },
            ]),
            sampleRate: 24_000,
            channels: 1,
        })],
        ['Local PCM limit exceeded', () => ({
            reader: createReader([
                { done: false, value: new Uint8Array(5_760_001) },
                { done: true, value: undefined },
            ]),
            sampleRate: 24_000,
            channels: 1,
        })],
    ])('treats %s as non-fatal before playback and accepts a later event', async (_case, openStream) => {
        const failingLifecycle: VoicePlaybackLifecycle = {
            onStarted: vi.fn(),
            onEnded: vi.fn(),
            onError: vi.fn(),
        };
        const failingStream = openStream();
        const failingTarget = createTarget();
        const failingSource = {
            playbackTransport: 'buffer-before-playback',
            openLive: vi.fn(async () => failingStream),
        } as unknown as PrismaVoiceAudioSource;
        const engine = createEngine();

        engine.play(failingSource, failingTarget, failingLifecycle);
        await settlePlayback(50);

        expect(audio.sources).toHaveLength(0);
        expect(failingTarget.setSpeaking).not.toHaveBeenCalledWith(true);
        expect(failingStream.reader.cancel).toHaveBeenCalledTimes(1);
        expect(failingLifecycle.onStarted).not.toHaveBeenCalled();
        expect(failingLifecycle.onEnded).not.toHaveBeenCalled();
        expect(failingLifecycle.onError).toHaveBeenCalledTimes(1);

        engine.play(
            createLiveSource(
                createReader([
                    { done: false, value: pcmBytes(10) },
                    { done: true, value: undefined },
                ]),
                undefined,
                'buffer-before-playback',
            ),
            createTarget(),
            {},
        );
        await settlePlayback(30);

        expect(audio.sources).toHaveLength(0);
        expect(audio.worklets.at(-1)?.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
            'enqueue',
            'end',
            'start',
        ]);
    });

    it('flushes a final partial block without manufacturing an odd trailing sample', async () => {
        const bytes = new Uint8Array([...pcmBytes(2), 0x7f]);
        const reader = createReader([
            { done: false, value: bytes },
            { done: true, value: undefined },
        ]);

        createEngine().play(createLiveSource(reader), createTarget(), {});
        await settlePlayback();

        expect(audio.buffers).toHaveLength(1);
        expect(audio.buffers[0]?.samples).toHaveLength(2);
    });

    it('uses the WAV fallback once when Live fails before playback starts', async () => {
        const loadWav = vi.fn(async () => new ArrayBuffer(16));
        const source: PrismaVoiceAudioSource = {
            playbackTransport: 'progressive',
            openLive: vi.fn(async () => { throw new Error('Live unavailable'); }),
            loadWav,
        };
        const lifecycle: VoicePlaybackLifecycle = { onStarted: vi.fn(), onError: vi.fn() };

        createEngine().play(source, createTarget(), lifecycle);
        await settlePlayback();

        expect(loadWav).toHaveBeenCalledTimes(1);
        expect(audio.decodeAudioData).toHaveBeenCalledTimes(1);
        expect(audio.sources).toHaveLength(1);
        expect(audio.sources[0]?.start).toHaveBeenCalledTimes(1);
        expect(audio.createAudioContext.mock.calls).toEqual([[]]);
        expect(lifecycle.onStarted).toHaveBeenCalledTimes(1);
        expect(lifecycle.onError).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith('Prisma Live failed, using WAV fallback');
    });

    it('stops scheduled Live blocks before using fallback when the stream fails during the lead buffer', async () => {
        const secondRead = deferred<ReadableStreamReadResult<Uint8Array>>();
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: pcmBytes(PRISMA_PCM_BLOCK_SAMPLES) })
                .mockImplementationOnce(() => secondRead.promise),
            cancel: vi.fn(async () => undefined),
        } as unknown as ReadableStreamDefaultReader<Uint8Array>;
        const loadWav = vi.fn(async () => new ArrayBuffer(16));

        createEngine().play(createLiveSource(reader, loadWav), createTarget(), {});
        await settlePlayback();
        secondRead.reject(new Error('stream failed before playback'));
        await settlePlayback();

        expect(audio.sources[0]?.stop).toHaveBeenCalledTimes(1);
        expect(audio.sources[0]?.disconnect).toHaveBeenCalledTimes(1);
        expect(loadWav).toHaveBeenCalledTimes(1);
        expect(audio.decodeAudioData).toHaveBeenCalledTimes(1);
        expect(audio.sources[1]?.start).toHaveBeenCalledTimes(1);
        expect(timers.count()).toBe(0);
    });

    it('does not fallback or replay when Live fails after real playback starts', async () => {
        const secondRead = deferred<ReadableStreamReadResult<Uint8Array>>();
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: pcmBytes(PRISMA_PCM_BLOCK_SAMPLES) })
                .mockImplementationOnce(() => secondRead.promise),
            cancel: vi.fn(async () => undefined),
        } as unknown as ReadableStreamDefaultReader<Uint8Array>;
        const loadWav = vi.fn(async () => new ArrayBuffer(16));
        const lifecycle: VoicePlaybackLifecycle = { onError: vi.fn() };
        const target = createTarget();

        createEngine().play(createLiveSource(reader, loadWav), target, lifecycle);
        await settlePlayback();
        timers.runNext();
        secondRead.reject(new Error('stream disconnected'));
        await settlePlayback();

        expect(loadWav).not.toHaveBeenCalled();
        expect(audio.sources[0]?.stop).toHaveBeenCalledTimes(1);
        expect(target.setSpeaking).toHaveBeenLastCalledWith(false);
        expect(lifecycle.onError).toHaveBeenCalledTimes(1);
        expect(diagnostics.at(-1)).toMatchObject({
            record_type: 'error',
            payload: { error_code: 'audio-failure' },
        });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(log).not.toHaveBeenCalledWith('Prisma Live failed, using WAV fallback');
    });

    it('does not fallback when the audio clock passed start before the speaking timer ran', async () => {
        const secondRead = deferred<ReadableStreamReadResult<Uint8Array>>();
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: pcmBytes(PRISMA_PCM_BLOCK_SAMPLES) })
                .mockImplementationOnce(() => secondRead.promise),
            cancel: vi.fn(async () => undefined),
        } as unknown as ReadableStreamDefaultReader<Uint8Array>;
        const loadWav = vi.fn(async () => new ArrayBuffer(16));
        const lifecycle: VoicePlaybackLifecycle = { onError: vi.fn() };

        createEngine().play(createLiveSource(reader, loadWav), createTarget(), lifecycle);
        await settlePlayback();
        audio.setCurrentTime(1.03);
        secondRead.reject(new Error('stream disconnected after audio start'));
        await settlePlayback();

        expect(loadWav).not.toHaveBeenCalled();
        expect(lifecycle.onError).toHaveBeenCalledTimes(1);
        expect(log).not.toHaveBeenCalledWith('Prisma Live failed, using WAV fallback');
    });

    it('aborts a pending Live fetch without fallback when stopped', async () => {
        const opened = deferred<PrismaVoicePcmStream>();
        let signal: AbortSignal | undefined;
        const loadWav = vi.fn(async () => new ArrayBuffer(16));
        const source: PrismaVoiceAudioSource = {
            playbackTransport: 'progressive',
            openLive: vi.fn((nextSignal) => {
                signal = nextSignal;
                return opened.promise;
            }),
            loadWav,
        };
        const lifecycle: VoicePlaybackLifecycle = { onError: vi.fn() };
        const engine = createEngine();

        engine.play(source, createTarget(), lifecycle);
        engine.stop();
        await settlePlayback();

        expect(signal?.aborted).toBe(true);
        expect(loadWav).not.toHaveBeenCalled();
        expect(lifecycle.onError).not.toHaveBeenCalled();
        expect(diagnostics.at(-1)).toMatchObject({
            record_type: 'cancel',
        });
        expect(log).toHaveBeenCalledWith('Prisma Live cancelled');
    });

    it('cancels the reader and every scheduled or playing source on replacement', async () => {
        const pendingRead = deferred<ReadableStreamReadResult<Uint8Array>>();
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: pcmBytes(PRISMA_PCM_BLOCK_SAMPLES * 2) })
                .mockImplementationOnce(() => pendingRead.promise),
            cancel: vi.fn(async () => undefined),
        } as unknown as ReadableStreamDefaultReader<Uint8Array> & { cancel: ReturnType<typeof vi.fn> };
        const firstTarget = createTarget();
        const firstLifecycle: VoicePlaybackLifecycle = { onEnded: vi.fn(), onError: vi.fn() };
        const engine = createEngine();

        engine.play(createLiveSource(reader), firstTarget, firstLifecycle);
        await settlePlayback();
        timers.runNext();
        const staleOnEnded = audio.sources[1]?.node.onended;
        engine.play(createLiveSource(createReader([{ done: true, value: undefined }])), createTarget(), {});
        await settlePlayback();

        expect(reader.cancel).toHaveBeenCalledTimes(1);
        expect(audio.sources[0]?.stop).toHaveBeenCalledTimes(1);
        expect(audio.sources[1]?.stop).toHaveBeenCalledTimes(1);
        expect(audio.sources[0]?.disconnect).toHaveBeenCalledTimes(1);
        expect(audio.sources[1]?.disconnect).toHaveBeenCalledTimes(1);
        expect(firstTarget.setSpeaking).toHaveBeenLastCalledWith(false);
        expect(frames.count()).toBe(0);
        staleOnEnded?.(new Event('ended'));
        expect(firstLifecycle.onEnded).not.toHaveBeenCalled();
        expect(firstLifecycle.onError).not.toHaveBeenCalled();
    });

    it('cancels a reader before any block is scheduled and ignores its stale completion', async () => {
        const pendingRead = deferred<ReadableStreamReadResult<Uint8Array>>();
        const reader = {
            read: vi.fn(() => pendingRead.promise),
            cancel: vi.fn(async () => undefined),
        } as unknown as ReadableStreamDefaultReader<Uint8Array> & { cancel: ReturnType<typeof vi.fn> };
        const lifecycle: VoicePlaybackLifecycle = { onEnded: vi.fn(), onError: vi.fn() };
        const engine = createEngine();

        engine.play(createLiveSource(reader), createTarget(), lifecycle);
        await settlePlayback();
        engine.stop();
        pendingRead.resolve({ done: true, value: undefined });
        await settlePlayback();

        expect(reader.cancel).toHaveBeenCalledTimes(1);
        expect(audio.sources).toHaveLength(0);
        expect(lifecycle.onEnded).not.toHaveBeenCalled();
        expect(lifecycle.onError).not.toHaveBeenCalled();
    });

    it('cancels scheduled audio before its playback timer can mark the orb speaking', async () => {
        const pendingRead = deferred<ReadableStreamReadResult<Uint8Array>>();
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: pcmBytes(PRISMA_PCM_BLOCK_SAMPLES) })
                .mockImplementationOnce(() => pendingRead.promise),
            cancel: vi.fn(async () => undefined),
        } as unknown as ReadableStreamDefaultReader<Uint8Array> & { cancel: ReturnType<typeof vi.fn> };
        const target = createTarget();
        const engine = createEngine();

        engine.play(createLiveSource(reader), target, {});
        await settlePlayback();
        expect(timers.count()).toBe(1);
        engine.stop();

        expect(reader.cancel).toHaveBeenCalledTimes(1);
        expect(audio.sources[0]?.stop).toHaveBeenCalledTimes(1);
        expect(timers.count()).toBe(0);
        expect(target.setSpeaking).not.toHaveBeenCalledWith(true);
        expect(target.setSpeaking).toHaveBeenLastCalledWith(false);
    });

    it('disposes reader, nodes, timer, RAF, analyser, and AudioContext', async () => {
        const pendingRead = deferred<ReadableStreamReadResult<Uint8Array>>();
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: pcmBytes(PRISMA_PCM_BLOCK_SAMPLES) })
                .mockImplementationOnce(() => pendingRead.promise),
            cancel: vi.fn(async () => undefined),
        } as unknown as ReadableStreamDefaultReader<Uint8Array> & { cancel: ReturnType<typeof vi.fn> };
        const target = createTarget();
        const engine = createEngine();
        engine.play(createLiveSource(reader), target, {});
        await settlePlayback();
        timers.runNext();
        target.level = 0.8;

        engine.dispose();

        expect(reader.cancel).toHaveBeenCalledTimes(1);
        expect(audio.sources[0]?.stop).toHaveBeenCalledTimes(1);
        expect(audio.sources[0]?.disconnect).toHaveBeenCalledTimes(1);
        expect(audio.analyserDisconnect).toHaveBeenCalledTimes(1);
        expect(timers.count()).toBe(0);
        expect(frames.count()).toBe(0);
        expect(target.level).toBe(0);
        expect(target.setSpeaking).toHaveBeenLastCalledWith(false);
        expect(audio.close).toHaveBeenCalledTimes(1);
    });
});
