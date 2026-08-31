import {
    PRISMA_PCM_WORKLET_PROCESSOR_NAME,
    PrismaPcmWorkletBuffer,
} from './prismaPcmWorkletBuffer';

interface PrismaPcmWorkletCommand {
    type: 'enqueue' | 'start' | 'end' | 'reset';
    samples?: Float32Array;
}

declare abstract class AudioWorkletProcessor {
    public readonly port: MessagePort;

    public abstract process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>,
    ): boolean;
}

declare function registerProcessor(
    name: string,
    processorCtor: new () => AudioWorkletProcessor,
): void;

class PrismaPcmAudioWorkletProcessor extends AudioWorkletProcessor {
    private readonly buffer = new PrismaPcmWorkletBuffer();

    public constructor() {
        super();
        this.port.onmessage = (event: MessageEvent<PrismaPcmWorkletCommand>) => {
            const command = event.data;
            if (command.type === 'enqueue' && command.samples instanceof Float32Array) {
                this.buffer.enqueue(command.samples);
            } else if (command.type === 'start') {
                this.buffer.start();
            } else if (command.type === 'end') {
                this.buffer.end();
            } else if (command.type === 'reset') {
                this.buffer.reset();
            }
        };
    }

    public process(
        _inputs: Float32Array[][],
        outputs: Float32Array[][],
    ): boolean {
        const output = outputs[0]?.[0];
        if (!output) {
            return true;
        }

        for (const type of this.buffer.render(output)) {
            this.port.postMessage({ type });
        }
        return true;
    }
}

registerProcessor(
    PRISMA_PCM_WORKLET_PROCESSOR_NAME,
    PrismaPcmAudioWorkletProcessor,
);
