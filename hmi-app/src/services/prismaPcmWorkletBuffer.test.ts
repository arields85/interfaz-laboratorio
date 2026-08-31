import { describe, expect, it } from 'vitest';

import { PrismaPcmWorkletBuffer } from './prismaPcmWorkletBuffer';

describe('PrismaPcmWorkletBuffer', () => {
    it('preserves queue order across dynamic render block lengths and ends once after drain', () => {
        const buffer = new PrismaPcmWorkletBuffer();
        buffer.enqueue(Float32Array.from([0.1, 0.2]));
        buffer.enqueue(Float32Array.from([0.3, 0.4, 0.5]));
        buffer.end();
        buffer.start();

        const firstOutput = new Float32Array(3);
        expect(buffer.render(firstOutput)).toEqual(['started']);
        expect(Array.from(firstOutput)).toEqual([
            expect.closeTo(0.1),
            expect.closeTo(0.2),
            expect.closeTo(0.3),
        ]);

        const finalOutput = new Float32Array(5);
        expect(buffer.render(finalOutput)).toEqual(['ended']);
        expect(Array.from(finalOutput)).toEqual([
            expect.closeTo(0.4),
            expect.closeTo(0.5),
            0,
            0,
            0,
        ]);
        expect(buffer.render(new Float32Array(7))).toEqual([]);
    });

    it('reports pre-EOF underflow as failure instead of normal completion', () => {
        const buffer = new PrismaPcmWorkletBuffer();
        buffer.enqueue(Float32Array.from([0.25]));
        buffer.start();

        expect(buffer.render(new Float32Array(4))).toEqual(['started', 'underflow']);
        expect(buffer.render(new Float32Array(4))).not.toContain('ended');
    });

    it('resets queued state and permits a clean fresh sequence', () => {
        const buffer = new PrismaPcmWorkletBuffer();
        buffer.enqueue(Float32Array.from([0.1, 0.2]));
        buffer.start();
        buffer.reset();

        const silentOutput = Float32Array.from([1, 1]);
        expect(buffer.render(silentOutput)).toEqual([]);
        expect(Array.from(silentOutput)).toEqual([0, 0]);

        buffer.enqueue(Float32Array.from([0.75]));
        buffer.end();
        buffer.start();
        const freshOutput = new Float32Array(2);
        expect(buffer.render(freshOutput)).toEqual(['started', 'ended']);
        expect(Array.from(freshOutput)).toEqual([0.75, 0]);
    });
});
