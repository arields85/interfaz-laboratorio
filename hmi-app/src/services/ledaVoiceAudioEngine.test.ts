import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    LedaOrbAudioTarget,
    LedaVoiceAudioDiagnostic,
    LedaVoiceAudioEngineDependencies,
    LedaVoiceAudioSource,
    LedaVoicePcmStream,
    LedaVoicePrebufferPolicy,
    LedaVoicePrebufferResolution,
    VoicePlaybackLifecycle,
} from './ledaVoiceAudioEngine';
import {
    LEDA_PCM_BLOCK_SAMPLES,
    LEDA_PCM_SAMPLE_RATE,
    PcmS16LeBlockAssembler,
    LedaVoiceAudioEngine,
} from './ledaVoiceAudioEngine';

interface SourceRecord {
    node: AudioBufferSourceNode;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
}

interface AudioHarness {
    context: AudioContext;
    createAudioContext: ReturnType<typeof vi.fn<(options?: AudioContextOptions) => AudioContext>>;
    analyser: AnalyserNode;
    sources: SourceRecord[];
    buffers: Array<{ samples: Float32Array; sampleRate: number }>;
    analyserConnect: ReturnType<typeof vi.fn>;
    analyserDisconnect: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    decodeAudioData: ReturnType<typeof vi.fn>;
    setCurrentTime: (time: number) => void;
    setTimeDomainData: (samples: readonly number[]) => void;
    setState: (next: AudioContextState) => void;
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
        sampleRate: LEDA_PCM_SAMPLE_RATE,
        destination,
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

    return {
        context,
        createAudioContext,
        analyser,
        sources,
        buffers,
        analyserConnect,
        analyserDisconnect,
        resume,
        close,
        decodeAudioData,
        setCurrentTime: (time) => {
            currentTime = time;
        },
        setTimeDomainData: (samples) => {
            timeDomainData = samples;
        },
        setState: (next) => {
            state = next;
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

function createTarget(): LedaOrbAudioTarget {
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
    loadWav?: LedaVoiceAudioSource['loadWav'],
): LedaVoiceAudioSource {
    return {
        openLive: vi.fn(async (): Promise<LedaVoicePcmStream> => ({
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

describe('LedaVoiceAudioEngine', () => {
    let audio: AudioHarness;
    let frames: ReturnType<typeof createFrameHarness>;
    let timers: ReturnType<typeof createTimerHarness>;
    let warn: ReturnType<typeof vi.fn>;
    let log: ReturnType<typeof vi.fn>;
    let now: number;
    let diagnostics: LedaVoiceAudioDiagnostic[];

    beforeEach(() => {
        audio = createAudioHarness();
        frames = createFrameHarness();
        timers = createTimerHarness();
        warn = vi.fn();
        log = vi.fn();
        now = 100;
        diagnostics = [];
    });

    function createEngine(overrides: Partial<LedaVoiceAudioEngineDependencies> = {}): LedaVoiceAudioEngine {
        return new LedaVoiceAudioEngine({
            createAudioContext: audio.createAudioContext,
            requestAnimationFrame: frames.request,
            cancelAnimationFrame: frames.cancel,
            setTimeout: timers.set,
            clearTimeout: timers.clear,
            now: () => now,
            warn,
            log,
            onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
            ...overrides,
        });
    }

    function createFakePrebufferPolicy(
        resolution: LedaVoicePrebufferResolution = { prebufferMs: 500, mode: 'automatic' },
    ): LedaVoicePrebufferPolicy & {
        resolvePrebufferMs: ReturnType<typeof vi.fn<() => LedaVoicePrebufferResolution>>;
        recordNeededPrebufferMs: ReturnType<typeof vi.fn<(neededPrebufferMs: number) => void>>;
    } {
        return {
            resolvePrebufferMs: vi.fn(() => resolution),
            recordNeededPrebufferMs: vi.fn(),
        };
    }

    it('schedules 75 ms PCM blocks contiguously through one analyser and completes on the final source end', async () => {
        const reader = createReader([
            { done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES * 2) },
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
        expect(audio.sources[0]?.start).toHaveBeenCalledWith(1.2);
        expect(audio.sources[1]?.start.mock.calls[0]?.[0]).toBeCloseTo(1.275);
        expect(audio.sources.every(({ connect }) => connect.mock.calls[0]?.[0] === audio.analyser)).toBe(true);
        expect(audio.analyserConnect).toHaveBeenCalledTimes(1);
        expect(audio.analyserConnect).toHaveBeenCalledWith(audio.context.destination);
        expect(audio.createAudioContext.mock.calls).toEqual([[{ latencyHint: 'playback' }]]);
        expect(target.setSpeaking).not.toHaveBeenCalledWith(true);
        expect(log).toHaveBeenCalledWith('Leda Live request started');
        expect(log).toHaveBeenCalledWith('Leda Live first audio: 42 ms');
        expect(log).toHaveBeenCalledWith('Leda Live stream completed');
        expect(timers.delays()[0]).toBeCloseTo(200);
        expect(diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({
                record_type: 'canonical-decode',
                payload: expect.objectContaining({ transport: 'progressive' }),
            }),
            expect.objectContaining({
                record_type: 'eof',
                payload: expect.objectContaining({
                    transport: 'progressive',
                    pcm_bytes: LEDA_PCM_BLOCK_SAMPLES * 2 * 2,
                }),
            }),
        ]));

        timers.runNext();
        expect(target.setSpeaking).toHaveBeenCalledWith(true);
        expect(lifecycle.onStarted).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith('Leda Live playback started');

        audio.setTimeDomainData([0.5, -0.5, 0.5, -0.5]);
        frames.runNext();
        expect(target.level).toBeGreaterThan(0);

        audio.sources[0]?.node.onended?.(new Event('ended'));
        expect(lifecycle.onEnded).not.toHaveBeenCalled();
        audio.sources[1]?.node.onended?.(new Event('ended'));

        expect(target.level).toBe(0);
        expect(target.setSpeaking).toHaveBeenLastCalledWith(false);
        expect(lifecycle.onEnded).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith('Leda Live playback completed');
        expect(frames.count()).toBe(0);
    });

    it('T16: records audio-context-state before and after a resume, only when one was needed', async () => {
        audio = createAudioHarness('suspended');
        // T21: play() now warms the AudioContext immediately (in parallel
        // with the live request) instead of only discovering the suspended
        // state once the first PCM block is ready. Hold that warm-up resume
        // open (a real resume genuinely takes time) so this test can still
        // exercise ensureContextRunning's own "still suspended when the
        // first block wants to schedule" diagnostic path.
        const resumeGate = deferred<void>();
        audio.resume.mockImplementationOnce(() => resumeGate.promise.then(() => {
            audio.setState('running');
        }));
        const reader = createReader([
            { done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) },
            { done: true, value: undefined },
        ]);
        const target = createTarget();
        const engine = createEngine();

        engine.play(createLiveSource(reader), target, { onStarted: vi.fn(), onEnded: vi.fn() });
        await settlePlayback();
        resumeGate.resolve();
        await settlePlayback();

        expect(audio.resume).toHaveBeenCalledTimes(1);
        const contextStateRecords = diagnostics.filter((diagnostic) => diagnostic.record_type === 'audio-context-state');
        expect(contextStateRecords).toEqual([
            expect.objectContaining({ record_type: 'audio-context-state', payload: { state: 'suspended', when: 'at-play' } }),
            expect.objectContaining({ record_type: 'audio-context-state', payload: { state: 'running', when: 'after-resume' } }),
        ]);
    });

    it('T16: never records audio-context-state when the context is already running', async () => {
        const reader = createReader([
            { done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) },
            { done: true, value: undefined },
        ]);
        const target = createTarget();
        const engine = createEngine();

        engine.play(createLiveSource(reader), target, { onStarted: vi.fn(), onEnded: vi.fn() });
        await settlePlayback();

        expect(audio.resume).not.toHaveBeenCalled();
        expect(diagnostics.some((diagnostic) => diagnostic.record_type === 'audio-context-state')).toBe(false);
    });

    it('T21: warmAudioContext() resumes a suspended context ahead of any playback', () => {
        audio = createAudioHarness('suspended');
        const engine = createEngine();

        engine.warmAudioContext();

        expect(audio.createAudioContext).toHaveBeenCalledTimes(1);
        expect(audio.resume).toHaveBeenCalledTimes(1);
    });

    it('T21: warmAudioContext() is a no-op when the context is already running', () => {
        const engine = createEngine();

        engine.warmAudioContext();

        expect(audio.resume).not.toHaveBeenCalled();
    });

    it('T21: play() warms the AudioContext in parallel with the live request, not after the first chunk', async () => {
        audio = createAudioHarness('suspended');
        const { promise: openLivePromise, resolve: resolveOpenLive } = deferred<LedaVoicePcmStream>();
        const openLive = vi.fn(() => openLivePromise);
        const source: LedaVoiceAudioSource = { openLive };
        const target = createTarget();
        const engine = createEngine();

        engine.play(source, target, { onStarted: vi.fn(), onEnded: vi.fn() });
        await settlePlayback();

        // The warm-up resume already ran even though the live request has
        // not resolved yet -- it runs in parallel with openLive(), not
        // sequentially after it.
        expect(openLive).toHaveBeenCalledTimes(1);
        expect(audio.resume).toHaveBeenCalledTimes(1);

        const reader = createReader([
            { done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) },
            { done: true, value: undefined },
        ]);
        resolveOpenLive({ reader, sampleRate: LEDA_PCM_SAMPLE_RATE, channels: 1 });
        await settlePlayback();

        // Scheduling the first block reused the already-settled warm-up
        // resume instead of issuing a second, fresh one.
        expect(audio.resume).toHaveBeenCalledTimes(1);
        expect(audio.sources[0]?.start).toHaveBeenCalled();
    });

    it('T21: a rejected warm-up resume falls back safely to an ordinary resume when scheduling audio', async () => {
        audio = createAudioHarness('suspended');
        audio.resume.mockRejectedValueOnce(new Error('NotAllowedError'));
        const reader = createReader([
            { done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) },
            { done: true, value: undefined },
        ]);
        const target = createTarget();
        const lifecycle: VoicePlaybackLifecycle = { onStarted: vi.fn(), onEnded: vi.fn(), onError: vi.fn() };
        const engine = createEngine();

        engine.play(createLiveSource(reader), target, lifecycle);
        await settlePlayback();

        // First call (the warm-up at play()) rejected; ensureContextRunning
        // made its own resume attempt when the first block was ready to
        // schedule, which this harness's default implementation resolves.
        expect(audio.resume).toHaveBeenCalledTimes(2);
        expect(warn).toHaveBeenCalled();
        expect(lifecycle.onError).not.toHaveBeenCalled();
        expect(audio.sources[0]?.start).toHaveBeenCalled();
    });

    it('plays a block that arrives late but before its scheduled time right after the previous one', async () => {
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) })
                .mockImplementationOnce(async () => {
                    // 100 ms after the first block: later than its 75 ms predecessor, but still
                    // well inside the 200 ms prebuffer, so it must not open a gap.
                    audio.setCurrentTime(1.1);
                    return { done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) };
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            cancel: vi.fn(async () => undefined),
        } as unknown as ReadableStreamDefaultReader<Uint8Array>;

        createEngine().play(createLiveSource(reader), createTarget(), {});
        await settlePlayback(30);
        timers.runNext();

        expect(audio.sources[0]?.start).toHaveBeenCalledWith(1.2);
        expect(audio.sources[1]?.start.mock.calls[0]?.[0]).toBeCloseTo(1.275);
        audio.sources.forEach(({ node }) => node.onended?.(new Event('ended')));
        expect(diagnostics.at(-1)).toMatchObject({
            record_type: 'playback-ended',
            payload: expect.objectContaining({ underflow_count: 0 }),
        });
    });

    it('re-primes with the prebuffer after a block misses its scheduled time', async () => {
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) })
                .mockImplementationOnce(async () => {
                    // 1.26 + 25 ms scheduling margin is past the 1.275 slot: a real underflow.
                    audio.setCurrentTime(1.26);
                    return { done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) };
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            cancel: vi.fn(async () => undefined),
        } as unknown as ReadableStreamDefaultReader<Uint8Array>;

        createEngine().play(createLiveSource(reader), createTarget(), {});
        await settlePlayback(30);
        timers.runNext();

        expect(audio.sources[1]?.start.mock.calls[0]?.[0]).toBeCloseTo(1.46);
        audio.sources.forEach(({ node }) => node.onended?.(new Event('ended')));
        expect(diagnostics.at(-1)).toMatchObject({
            record_type: 'playback-ended',
            payload: expect.objectContaining({ underflow_count: 1 }),
        });
    });

    it('records positive underflow evidence when the audio clock outruns the scheduled block', async () => {
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) })
                .mockImplementationOnce(async () => {
                    audio.setCurrentTime(2);
                    return { done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) };
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
            payload: expect.objectContaining({
                transport: 'progressive',
                underflow_count: 1,
                prebuffer_mode: 'fixed',
                prebuffer_ms: expect.any(Number),
                needed_prebuffer_ms: expect.any(Number),
            }),
        });
    });

    it('measures the needed prebuffer independent of the fixed lead and logs it in progressive playback-ended', async () => {
        // Block 1 arrives at t0 = 1_000 (deficit 0 by construction). Block 2
        // arrives at 1_115, 40 ms after block 1's own 75 ms audio duration
        // would have been consumed by gap-free playback (deficit 40). The
        // measured need is independent of the fixed 200 ms lead actually
        // used to schedule this answer.
        const reader = {
            read: vi.fn()
                .mockImplementationOnce(async () => {
                    now = 1_000;
                    return { done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) };
                })
                .mockImplementationOnce(async () => {
                    now = 1_115;
                    return { done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) };
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            cancel: vi.fn(async () => undefined),
        } as unknown as ReadableStreamDefaultReader<Uint8Array>;
        const engine = createEngine();

        engine.play(createLiveSource(reader), createTarget(), {});
        await settlePlayback(30);
        audio.sources.forEach(({ node }) => node.onended?.(new Event('ended')));

        expect(diagnostics.at(-1)).toMatchObject({
            record_type: 'playback-ended',
            payload: {
                transport: 'progressive',
                prebuffer_ms: 200,
                needed_prebuffer_ms: 65,
                prebuffer_mode: 'fixed',
            },
        });
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
        const source: LedaVoiceAudioSource = {
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
        expect(audio.createAudioContext.mock.calls).toEqual([[{ latencyHint: 'playback' }]]);
        expect(lifecycle.onStarted).toHaveBeenCalledTimes(1);
        expect(lifecycle.onError).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith('Leda Live failed, using WAV fallback');
    });

    it('stops scheduled Live blocks before using fallback when the stream fails during the lead buffer', async () => {
        const secondRead = deferred<ReadableStreamReadResult<Uint8Array>>();
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) })
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
                .mockResolvedValueOnce({ done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) })
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
        expect(log).not.toHaveBeenCalledWith('Leda Live failed, using WAV fallback');
    });

    it('does not fallback when the audio clock passed start before the speaking timer ran', async () => {
        const secondRead = deferred<ReadableStreamReadResult<Uint8Array>>();
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) })
                .mockImplementationOnce(() => secondRead.promise),
            cancel: vi.fn(async () => undefined),
        } as unknown as ReadableStreamDefaultReader<Uint8Array>;
        const loadWav = vi.fn(async () => new ArrayBuffer(16));
        const lifecycle: VoicePlaybackLifecycle = { onError: vi.fn() };

        createEngine().play(createLiveSource(reader, loadWav), createTarget(), lifecycle);
        await settlePlayback();
        audio.setCurrentTime(1.21);
        secondRead.reject(new Error('stream disconnected after audio start'));
        await settlePlayback();

        expect(loadWav).not.toHaveBeenCalled();
        expect(lifecycle.onError).toHaveBeenCalledTimes(1);
        expect(log).not.toHaveBeenCalledWith('Leda Live failed, using WAV fallback');
    });

    it('aborts a pending Live fetch without fallback when stopped', async () => {
        const opened = deferred<LedaVoicePcmStream>();
        let signal: AbortSignal | undefined;
        const loadWav = vi.fn(async () => new ArrayBuffer(16));
        const source: LedaVoiceAudioSource = {
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
        expect(log).toHaveBeenCalledWith('Leda Live cancelled');
    });

    it('cancels the reader and every scheduled or playing source on replacement', async () => {
        const pendingRead = deferred<ReadableStreamReadResult<Uint8Array>>();
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES * 2) })
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
                .mockResolvedValueOnce({ done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) })
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
                .mockResolvedValueOnce({ done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) })
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

    describe('T3: per-answer prebuffer policy', () => {
        it('uses the resolved per-answer prebuffer for the first block and reports it as automatic', async () => {
            const policy = createFakePrebufferPolicy({ prebufferMs: 500, mode: 'automatic' });
            const reader = createReader([
                { done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) },
                { done: true, value: undefined },
            ]);
            const engine = createEngine({ prebufferPolicy: policy });

            engine.play(createLiveSource(reader), createTarget(), {});
            await settlePlayback();

            expect(audio.sources[0]?.start).toHaveBeenCalledWith(1.5);
            expect(timers.delays()[0]).toBeCloseTo(500);

            audio.sources.forEach(({ node }) => node.onended?.(new Event('ended')));

            expect(diagnostics.at(-1)).toMatchObject({
                record_type: 'playback-ended',
                payload: expect.objectContaining({
                    transport: 'progressive',
                    prebuffer_ms: 500,
                    prebuffer_mode: 'automatic',
                }),
            });
        });

        it('snapshots the resolved prebuffer once per answer, even across several blocks', async () => {
            const policy = createFakePrebufferPolicy({ prebufferMs: 300, mode: 'automatic' });
            const reader = createReader([
                { done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES * 2) },
                { done: true, value: undefined },
            ]);
            const engine = createEngine({ prebufferPolicy: policy });

            engine.play(createLiveSource(reader), createTarget(), {});
            await settlePlayback();

            expect(audio.buffers.length).toBeGreaterThan(1);
            expect(policy.resolvePrebufferMs).toHaveBeenCalledTimes(1);
        });

        it('records the measured needed prebuffer exactly once when a progressive answer ends normally', async () => {
            // Same arrival timeline as the "measures the needed prebuffer..."
            // test above: block 1 at t0 = 1_000 (deficit 0), block 2 at
            // 1_115 (40 ms after block 1's own 75 ms would have been
            // consumed), margin 25 ms -> needed 65 ms.
            const policy = createFakePrebufferPolicy();
            const reader = {
                read: vi.fn()
                    .mockImplementationOnce(async () => {
                        now = 1_000;
                        return { done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) };
                    })
                    .mockImplementationOnce(async () => {
                        now = 1_115;
                        return { done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) };
                    })
                    .mockResolvedValueOnce({ done: true, value: undefined }),
                cancel: vi.fn(async () => undefined),
            } as unknown as ReadableStreamDefaultReader<Uint8Array>;
            const engine = createEngine({ prebufferPolicy: policy });

            engine.play(createLiveSource(reader), createTarget(), {});
            await settlePlayback(30);
            audio.sources.forEach(({ node }) => node.onended?.(new Event('ended')));

            expect(policy.recordNeededPrebufferMs).toHaveBeenCalledTimes(1);
            expect(policy.recordNeededPrebufferMs).toHaveBeenCalledWith(65);
            expect(diagnostics.at(-1)).toMatchObject({
                record_type: 'playback-ended',
                payload: expect.objectContaining({ needed_prebuffer_ms: 65 }),
            });
        });

        it('never records the needed prebuffer when playback is stopped before the answer completes', async () => {
            const pendingRead = deferred<ReadableStreamReadResult<Uint8Array>>();
            const reader = {
                read: vi.fn()
                    .mockResolvedValueOnce({ done: false, value: pcmBytes(LEDA_PCM_BLOCK_SAMPLES) })
                    .mockImplementationOnce(() => pendingRead.promise),
                cancel: vi.fn(async () => undefined),
            } as unknown as ReadableStreamDefaultReader<Uint8Array>;
            const policy = createFakePrebufferPolicy();
            const engine = createEngine({ prebufferPolicy: policy });

            engine.play(createLiveSource(reader), createTarget(), {});
            await settlePlayback();
            engine.stop();
            await settlePlayback();

            expect(policy.recordNeededPrebufferMs).not.toHaveBeenCalled();
        });

        it('never records the needed prebuffer when Live fails and falls back to WAV', async () => {
            const loadWav = vi.fn(async () => new ArrayBuffer(16));
            const source: LedaVoiceAudioSource = {
                openLive: vi.fn(async () => { throw new Error('Live unavailable'); }),
                loadWav,
            };
            const policy = createFakePrebufferPolicy();
            const engine = createEngine({ prebufferPolicy: policy });

            engine.play(source, createTarget(), { onStarted: vi.fn(), onError: vi.fn() });
            await settlePlayback();

            expect(loadWav).toHaveBeenCalledTimes(1);
            expect(policy.recordNeededPrebufferMs).not.toHaveBeenCalled();
        });
    });
});
