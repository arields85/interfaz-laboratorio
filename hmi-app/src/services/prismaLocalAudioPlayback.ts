import { PRISMA_PCM_AUDIO_FORMAT } from './prismaPcmAudioFormat';

export const PRISMA_LOCAL_BUFFERING_POLICY = {
    targetBufferSeconds: 2.5,
} as const;

export type PrismaLocalStartDecision =
    | 'continue-buffering'
    | 'start-at-target'
    | 'start-at-eof';

export type PrismaLocalPlaybackErrorCode =
    | 'audio-worklet-unavailable'
    | 'audio-worklet-processor-error'
    | 'audio-worklet-underflow'
    | 'incomplete-pcm-sample';

export class PrismaLocalPlaybackError extends Error {
    public readonly code: PrismaLocalPlaybackErrorCode;

    public constructor(code: PrismaLocalPlaybackErrorCode) {
        super(code);
        this.name = 'PrismaLocalPlaybackError';
        this.code = code;
    }
}

interface PrismaLocalStartObservation {
    bufferedSamples: number;
    endOfStream: boolean;
    sampleRate: number;
}

export function decidePrismaLocalPlaybackStart(
    observation: PrismaLocalStartObservation,
): PrismaLocalStartDecision {
    if (observation.bufferedSamples <= 0) {
        return 'continue-buffering';
    }

    if (observation.endOfStream) {
        return 'start-at-eof';
    }

    const targetSamples = observation.sampleRate
        * PRISMA_LOCAL_BUFFERING_POLICY.targetBufferSeconds;
    if (observation.bufferedSamples < targetSamples) {
        return 'continue-buffering';
    }

    return 'start-at-target';
}

export class PcmS16LeChunkParser {
    private carry: number | null = null;
    private parsedSamples = 0;

    public push(chunk: Uint8Array): Float32Array<ArrayBuffer> | null {
        const completeSampleCount = Math.floor(
            (chunk.byteLength + (this.carry === null ? 0 : 1))
            / PRISMA_PCM_AUDIO_FORMAT.bytesPerSample,
        );
        if (completeSampleCount === 0) {
            if (chunk.byteLength === 1) {
                this.carry = chunk[0] as number;
            }
            return null;
        }

        const samples = new Float32Array(completeSampleCount);
        let chunkIndex = 0;
        let sampleIndex = 0;

        if (this.carry !== null) {
            samples[sampleIndex] = this.decode(this.carry, chunk[chunkIndex] as number);
            this.carry = null;
            chunkIndex += 1;
            sampleIndex += 1;
        }

        while (chunkIndex + 1 < chunk.byteLength) {
            samples[sampleIndex] = this.decode(
                chunk[chunkIndex] as number,
                chunk[chunkIndex + 1] as number,
            );
            chunkIndex += PRISMA_PCM_AUDIO_FORMAT.bytesPerSample;
            sampleIndex += 1;
        }

        if (chunkIndex < chunk.byteLength) {
            this.carry = chunk[chunkIndex] as number;
        }
        this.parsedSamples += samples.length;
        return samples;
    }

    public finish(): number {
        if (this.carry !== null) {
            throw new PrismaLocalPlaybackError('incomplete-pcm-sample');
        }
        return this.parsedSamples;
    }

    private decode(lowByte: number, highByte: number): number {
        const unsigned = lowByte | (highByte << 8);
        const signed = unsigned >= 0x8000 ? unsigned - 0x1_0000 : unsigned;
        return signed / 32_768;
    }
}
