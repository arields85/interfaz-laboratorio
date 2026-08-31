import { describe, expect, it } from 'vitest';

import {
    PRISMA_LOCAL_BUFFERING_POLICY,
    PcmS16LeChunkParser,
    decidePrismaLocalPlaybackStart,
} from './prismaLocalAudioPlayback';

describe('PcmS16LeChunkParser', () => {
    it('decodes signed little-endian samples while carrying one split byte', () => {
        const parser = new PcmS16LeChunkParser();

        expect(parser.push(Uint8Array.from([0x00]))).toBeNull();
        expect(Array.from(parser.push(Uint8Array.from([
            0x80,
            0xff, 0xff,
            0x00, 0x00,
            0xff, 0x7f,
        ])) ?? [])).toEqual([
            -1,
            -1 / 32_768,
            0,
            32_767 / 32_768,
        ]);
        expect(parser.finish()).toBe(4);
    });

    it('rejects an incomplete final PCM sample', () => {
        const parser = new PcmS16LeChunkParser();
        parser.push(Uint8Array.from([0x7f]));

        expect(() => parser.finish()).toThrow('incomplete-pcm-sample');
    });
});

describe('decidePrismaLocalPlaybackStart', () => {
    const sampleRate = 24_000;
    const targetSamples = sampleRate * PRISMA_LOCAL_BUFFERING_POLICY.targetBufferSeconds;

    it('defines exactly one named initial target at 2.5 seconds', () => {
        expect(PRISMA_LOCAL_BUFFERING_POLICY).toEqual({ targetBufferSeconds: 2.5 });
        expect(targetSamples).toBe(60_000);
    });

    it('continues buffering below the fixed target', () => {
        expect(decidePrismaLocalPlaybackStart({
            bufferedSamples: targetSamples - 1,
            endOfStream: false,
            sampleRate,
        })).toBe('continue-buffering');
    });

    it.each([targetSamples, targetSamples + 1])(
        'starts at the target as soon as %i samples are queued',
        (bufferedSamples) => {
            expect(decidePrismaLocalPlaybackStart({
                bufferedSamples,
                endOfStream: false,
                sampleRate,
            })).toBe('start-at-target');
        },
    );

    it('starts at EOF with valid audio below the target', () => {
        expect(decidePrismaLocalPlaybackStart({
            bufferedSamples: sampleRate,
            endOfStream: true,
            sampleRate,
        })).toBe('start-at-eof');
    });

    it('does not start an empty stream at EOF', () => {
        expect(decidePrismaLocalPlaybackStart({
            bufferedSamples: 0,
            endOfStream: true,
            sampleRate,
        })).toBe('continue-buffering');
    });
});
