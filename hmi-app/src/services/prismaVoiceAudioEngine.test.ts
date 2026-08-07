import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    PrismaOrbAudioTarget,
    PrismaVoiceAudioSource,
    VoicePlaybackLifecycle,
} from './prismaVoiceAudioEngine';
import { PrismaVoiceAudioEngine } from './prismaVoiceAudioEngine';

interface AudioHarness {
    context: AudioContext;
    analyser: AnalyserNode;
    sources: AudioBufferSourceNode[];
    sourceConnect: ReturnType<typeof vi.fn>;
    analyserConnect: ReturnType<typeof vi.fn>;
    sourceDisconnect: ReturnType<typeof vi.fn>;
    analyserDisconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    decodeAudioData: ReturnType<typeof vi.fn>;
    setTimeDomainData: (samples: readonly number[]) => void;
    setState: (state: AudioContextState) => void;
}

function createAudioHarness(initialState: AudioContextState = 'running'): AudioHarness {
    let state = initialState;
    let timeDomainData: readonly number[] = [0, 0, 0, 0];
    const destination = {} as AudioDestinationNode;
    const sourceConnect = vi.fn();
    const analyserConnect = vi.fn();
    const sourceDisconnect = vi.fn();
    const analyserDisconnect = vi.fn();
    const start = vi.fn();
    const stop = vi.fn();
    const resume = vi.fn(async () => {
        state = 'running';
    });
    const close = vi.fn(async () => undefined);
    const decodedBuffer = {} as AudioBuffer;
    const decodeAudioData = vi.fn(async () => decodedBuffer);
    const sources: AudioBufferSourceNode[] = [];
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
        destination,
        createAnalyser: vi.fn(() => analyser),
        createBufferSource: vi.fn(() => {
            const source = {
                buffer: null,
                onended: null,
                connect: sourceConnect,
                disconnect: sourceDisconnect,
                start,
                stop,
            } as unknown as AudioBufferSourceNode;
            sources.push(source);
            return source;
        }),
        decodeAudioData,
        resume,
        close,
    } as unknown as AudioContext;

    return {
        context,
        analyser,
        sources,
        sourceConnect,
        analyserConnect,
        sourceDisconnect,
        analyserDisconnect,
        start,
        stop,
        resume,
        close,
        decodeAudioData,
        setTimeDomainData: (samples) => {
            timeDomainData = samples;
        },
        setState: (nextState) => {
            state = nextState;
        },
    };
}

function createTarget(): PrismaOrbAudioTarget {
    return {
        level: 0,
        setSpeaking: vi.fn(),
    };
}

function createSource(cacheKey = 'local-test'): PrismaVoiceAudioSource {
    return {
        cacheKey,
        load: vi.fn(async () => new ArrayBuffer(8)),
    };
}

function createDynamicSource(): PrismaVoiceAudioSource {
    return {
        load: vi.fn(async () => new ArrayBuffer(8)),
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
            if (!next) {
                throw new Error('No animation frame is queued');
            }
            frames.delete(next[0]);
            next[1](16);
        },
        count: () => frames.size,
    };
}

async function settlePlayback(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('PrismaVoiceAudioEngine', () => {
    let audio: AudioHarness;
    let frames: ReturnType<typeof createFrameHarness>;
    let warn: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        audio = createAudioHarness();
        frames = createFrameHarness();
        warn = vi.fn();
    });

    function createEngine(): PrismaVoiceAudioEngine {
        return new PrismaVoiceAudioEngine({
            createAudioContext: () => audio.context,
            requestAnimationFrame: frames.request,
            cancelAnimationFrame: frames.cancel,
            warn,
        });
    }

    it('connects source to analyser to audible destination and drives real deterministic frames', async () => {
        const target = createTarget();
        const lifecycle: VoicePlaybackLifecycle = { onStarted: vi.fn() };
        const engine = createEngine();

        engine.play(createSource(), target, lifecycle);
        await settlePlayback();

        expect(audio.sourceConnect).toHaveBeenCalledWith(audio.analyser);
        expect(audio.analyserConnect).toHaveBeenCalledWith(audio.context.destination);
        expect(audio.start).toHaveBeenCalledTimes(1);
        expect(target.setSpeaking).toHaveBeenCalledWith(true);
        expect(lifecycle.onStarted).toHaveBeenCalledTimes(1);

        audio.setTimeDomainData([0.5, -0.5, 0.5, -0.5]);
        frames.runNext();

        expect(target.level).toBeGreaterThan(0);
        expect(target.level).toBeLessThanOrEqual(1);
        expect(frames.count()).toBe(1);
    });

    it('resets speaking and level and ends only when the audio source ends naturally', async () => {
        const target = createTarget();
        const lifecycle: VoicePlaybackLifecycle = { onEnded: vi.fn() };
        const engine = createEngine();

        engine.play(createSource(), target, lifecycle);
        await settlePlayback();
        target.level = 0.7;

        audio.sources[0]?.onended?.(new Event('ended'));

        expect(target.level).toBe(0);
        expect(target.setSpeaking).toHaveBeenLastCalledWith(false);
        expect(lifecycle.onEnded).toHaveBeenCalledTimes(1);
        expect(audio.sourceDisconnect).toHaveBeenCalled();
        expect(audio.analyserDisconnect).toHaveBeenCalled();
        expect(frames.count()).toBe(0);
    });

    it('cancels load and playback generations so only the latest operation can finish', async () => {
        let resolveFirst: ((value: ArrayBuffer) => void) | undefined;
        let firstSignal: AbortSignal | undefined;
        const firstSource: PrismaVoiceAudioSource = {
            cacheKey: 'first',
            load: vi.fn((signal) => {
                firstSignal = signal;
                return new Promise<ArrayBuffer>((resolve) => {
                    resolveFirst = resolve;
                });
            }),
        };
        const secondSource = createSource('second');
        const firstTarget = createTarget();
        const secondTarget = createTarget();
        const firstLifecycle: VoicePlaybackLifecycle = { onEnded: vi.fn(), onError: vi.fn() };
        const secondLifecycle: VoicePlaybackLifecycle = { onEnded: vi.fn() };
        const engine = createEngine();

        engine.play(firstSource, firstTarget, firstLifecycle);
        engine.play(secondSource, secondTarget, secondLifecycle);
        resolveFirst?.(new ArrayBuffer(8));
        await settlePlayback();

        expect(firstSignal?.aborted).toBe(true);
        expect(audio.start).toHaveBeenCalledTimes(1);
        expect(firstTarget.setSpeaking).not.toHaveBeenCalledWith(true);
        expect(firstLifecycle.onError).not.toHaveBeenCalled();

        const staleOnEnded = audio.sources[0]?.onended;
        engine.play(createSource('third'), createTarget(), { onEnded: vi.fn() });
        await settlePlayback();
        staleOnEnded?.(new Event('ended'));

        expect(secondLifecycle.onEnded).not.toHaveBeenCalled();
        expect(audio.stop).toHaveBeenCalled();
    });

    it('reuses a decoded local buffer without coupling cancellation to old promises', async () => {
        const source = createSource();
        const engine = createEngine();

        engine.play(source, createTarget(), {});
        await settlePlayback();
        audio.sources[0]?.onended?.(new Event('ended'));
        engine.play(source, createTarget(), {});
        await settlePlayback();

        expect(source.load).toHaveBeenCalledTimes(1);
        expect(audio.decodeAudioData).toHaveBeenCalledTimes(1);
        expect(audio.start).toHaveBeenCalledTimes(2);
    });

    it('does not retain decoded buffers for dynamic TTS sources without a cache key', async () => {
        const firstSource = createDynamicSource();
        const secondSource = createDynamicSource();
        const engine = createEngine();

        engine.play(firstSource, createTarget(), {});
        await settlePlayback();
        audio.sources[0]?.onended?.(new Event('ended'));
        engine.play(secondSource, createTarget(), {});
        await settlePlayback();

        expect(firstSource.load).toHaveBeenCalledTimes(1);
        expect(secondSource.load).toHaveBeenCalledTimes(1);
        expect(audio.decodeAudioData).toHaveBeenCalledTimes(2);
    });

    it('closes the context and synchronously resets the orb on unmount cleanup', async () => {
        const target = createTarget();
        const engine = createEngine();
        engine.play(createSource(), target, {});
        await settlePlayback();
        target.level = 0.8;

        engine.dispose();

        expect(target.level).toBe(0);
        expect(target.setSpeaking).toHaveBeenLastCalledWith(false);
        expect(audio.stop).toHaveBeenCalled();
        expect(audio.close).toHaveBeenCalledTimes(1);
        expect(frames.count()).toBe(0);
    });

    it.each(['load', 'decode', 'resume', 'start'] as const)(
        'contains %s failures, resets the orb, and reports one controlled warning',
        async (failure) => {
            audio = createAudioHarness(failure === 'resume' ? 'suspended' : 'running');
            const source = createSource();
            if (failure === 'load') {
                vi.mocked(source.load).mockRejectedValueOnce(new Error('fetch failed'));
            } else if (failure === 'decode') {
                audio.decodeAudioData.mockRejectedValueOnce(new Error('decode failed'));
            } else if (failure === 'resume') {
                audio.resume.mockRejectedValueOnce(new Error('autoplay blocked'));
            } else {
                audio.start.mockImplementationOnce(() => {
                    throw new Error('start failed');
                });
            }
            const target = createTarget();
            target.level = 0.5;
            const lifecycle: VoicePlaybackLifecycle = { onError: vi.fn() };
            const engine = createEngine();

            engine.play(source, target, lifecycle);
            await settlePlayback();

            expect(target.level).toBe(0);
            expect(target.setSpeaking).toHaveBeenLastCalledWith(false);
            expect(lifecycle.onError).toHaveBeenCalledTimes(1);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(frames.count()).toBe(0);
        },
    );

    it('treats a still-suspended context after resume as autoplay failure', async () => {
        audio = createAudioHarness('suspended');
        audio.resume.mockImplementationOnce(async () => undefined);
        audio.setState('suspended');
        const lifecycle: VoicePlaybackLifecycle = { onError: vi.fn() };
        const engine = createEngine();

        engine.play(createSource(), createTarget(), lifecycle);
        await settlePlayback();

        expect(audio.start).not.toHaveBeenCalled();
        expect(lifecycle.onError).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledTimes(1);
    });
});
