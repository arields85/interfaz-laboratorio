export const PRISMA_PCM_WORKLET_PROCESSOR_NAME = 'prisma-pcm-stream-processor';

export type PrismaPcmWorkletEvent = 'started' | 'ended' | 'underflow';

export class PrismaPcmWorkletBuffer {
    private readonly chunks: Float32Array[] = [];
    private headOffset = 0;
    private queuedSamples = 0;
    private playing = false;
    private endOfStream = false;
    private startedReported = false;
    private endedReported = false;
    private failed = false;

    public enqueue(samples: Float32Array): void {
        if (this.endOfStream || this.endedReported || this.failed || samples.length === 0) {
            return;
        }
        this.chunks.push(samples);
        this.queuedSamples += samples.length;
    }

    public start(): void {
        if (!this.endedReported && !this.failed) {
            this.playing = true;
        }
    }

    public end(): void {
        this.endOfStream = true;
    }

    public reset(): void {
        this.chunks.length = 0;
        this.headOffset = 0;
        this.queuedSamples = 0;
        this.playing = false;
        this.endOfStream = false;
        this.startedReported = false;
        this.endedReported = false;
        this.failed = false;
    }

    public render(output: Float32Array): PrismaPcmWorkletEvent[] {
        output.fill(0);
        if (!this.playing || this.endedReported || this.failed) {
            return [];
        }

        const events: PrismaPcmWorkletEvent[] = [];
        const renderedSamples = this.dequeueInto(output);
        if (renderedSamples > 0 && !this.startedReported) {
            this.startedReported = true;
            events.push('started');
        }

        if (this.queuedSamples === 0 && this.endOfStream) {
            this.endedReported = true;
            this.playing = false;
            events.push('ended');
        } else if (renderedSamples < output.length && !this.endOfStream) {
            this.failed = true;
            this.playing = false;
            events.push('underflow');
        }

        return events;
    }

    private dequeueInto(output: Float32Array): number {
        let outputOffset = 0;
        while (outputOffset < output.length && this.chunks.length > 0) {
            const head = this.chunks[0] as Float32Array;
            const available = head.length - this.headOffset;
            const requested = output.length - outputOffset;
            const copied = Math.min(available, requested);
            output.set(
                head.subarray(this.headOffset, this.headOffset + copied),
                outputOffset,
            );
            outputOffset += copied;
            this.headOffset += copied;
            this.queuedSamples -= copied;

            if (this.headOffset === head.length) {
                this.chunks.shift();
                this.headOffset = 0;
            }
        }
        return outputOffset;
    }
}
