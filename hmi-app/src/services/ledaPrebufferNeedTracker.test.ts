import { describe, expect, it } from 'vitest';

import {
    LEDA_PREBUFFER_SCHEDULING_MARGIN_MS,
    LedaPrebufferNeedTracker,
} from './ledaPrebufferNeedTracker';

describe('LedaPrebufferNeedTracker', () => {
    it('reports only the scheduling margin when no block ever arrives late', () => {
        const tracker = new LedaPrebufferNeedTracker();

        // t0 = 0; every later block arrives well before its cumulative
        // audio duration would demand it, so the worst-case deficit is the
        // first block's own term (always exactly 0 by construction).
        tracker.recordBlockArrival(0, 75);
        tracker.recordBlockArrival(10, 75);
        tracker.recordBlockArrival(20, 75);

        expect(tracker.neededPrebufferMs()).toBe(LEDA_PREBUFFER_SCHEDULING_MARGIN_MS);
    });

    it('measures the largest arrival deficit across all blocks, independent of the prebuffer actually used', () => {
        const tracker = new LedaPrebufferNeedTracker();

        // t0 = 1_000. Block 2 arrives 40 ms after the cumulative duration
        // (75 ms) of the block before it would have been consumed, i.e. a
        // 40 ms gap the current prebuffer would need to absorb. A later,
        // smaller deficit (block 3) must not lower the recorded maximum.
        tracker.recordBlockArrival(1_000, 75); // D_before = 0   -> deficit 0
        tracker.recordBlockArrival(1_115, 75); // D_before = 75  -> deficit 40
        tracker.recordBlockArrival(1_160, 75); // D_before = 150 -> deficit 10

        expect(tracker.neededPrebufferMs()).toBe(40 + LEDA_PREBUFFER_SCHEDULING_MARGIN_MS);
    });

    it('rounds the result and never returns a negative value', () => {
        const tracker = new LedaPrebufferNeedTracker(5);

        tracker.recordBlockArrival(0, 100);
        // Deficit here is -100 + 0.4 = -99.6, still less than the first
        // block's guaranteed 0 term, so the max stays 0 and the result is
        // exactly the (small) scheduling margin, never negative.
        tracker.recordBlockArrival(0.4, 100);

        expect(tracker.neededPrebufferMs()).toBe(5);
    });

    it('measures ~0 (just the scheduling margin) for a cached answer delivered as a single block', () => {
        const tracker = new LedaPrebufferNeedTracker();

        tracker.recordBlockArrival(500, 3_000);

        expect(tracker.neededPrebufferMs()).toBe(LEDA_PREBUFFER_SCHEDULING_MARGIN_MS);
    });

    it('returns 0 when no block was ever recorded', () => {
        const tracker = new LedaPrebufferNeedTracker();

        expect(tracker.neededPrebufferMs()).toBe(0);
    });

    it('uses a custom scheduling margin when provided', () => {
        const tracker = new LedaPrebufferNeedTracker(100);

        tracker.recordBlockArrival(0, 50);

        expect(tracker.neededPrebufferMs()).toBe(100);
    });
});
