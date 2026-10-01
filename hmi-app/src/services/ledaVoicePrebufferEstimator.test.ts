import { describe, expect, it } from 'vitest';

import type { LedaVoicePrebufferHistory } from '../domain/ledaVoicePrebufferHistory.types';
import {
    appendLedaVoicePrebufferMeasurement,
    estimateNextLedaVoicePrebufferMs,
    LEDA_PREBUFFER_ESTIMATE_DEFAULT_MS,
    LEDA_PREBUFFER_ESTIMATE_MAX_MS,
    LEDA_PREBUFFER_ESTIMATE_MIN_MS,
    LEDA_PREBUFFER_ESTIMATE_SAFETY_MS,
    LEDA_PREBUFFER_HISTORY_MAX_AGE_MS,
    LEDA_PREBUFFER_HISTORY_WINDOW_SIZE,
} from './ledaVoicePrebufferEstimator';

function measurement(neededPrebufferMs: number, recordedAtMs: number) {
    return { neededPrebufferMs, recordedAtMs };
}

describe('estimateNextLedaVoicePrebufferMs', () => {
    it('returns the default when the history is empty', () => {
        expect(estimateNextLedaVoicePrebufferMs([], 1_000_000)).toBe(LEDA_PREBUFFER_ESTIMATE_DEFAULT_MS);
    });

    it('returns clamp(max(window) + safety, min, max) for an ordinary history', () => {
        const history: LedaVoicePrebufferHistory = [
            measurement(150, 1_000),
            measurement(400, 2_000),
            measurement(300, 3_000),
        ];

        expect(estimateNextLedaVoicePrebufferMs(history, 3_000)).toBe(400 + LEDA_PREBUFFER_ESTIMATE_SAFETY_MS);
    });

    it('raises the value on the very next call after one high measurement', () => {
        const before = estimateNextLedaVoicePrebufferMs([measurement(150, 1_000)], 1_000);
        const after = estimateNextLedaVoicePrebufferMs(
            [measurement(150, 1_000), measurement(900, 2_000)],
            2_000,
        );

        expect(before).toBe(150 + LEDA_PREBUFFER_ESTIMATE_SAFETY_MS);
        expect(after).toBe(900 + LEDA_PREBUFFER_ESTIMATE_SAFETY_MS);
        expect(after).toBeGreaterThan(before);
    });

    it('only falls once the high measurement leaves the 10-item window', () => {
        const now = 100_000;
        // A high measurement (900) at the front, followed by exactly
        // LEDA_PREBUFFER_HISTORY_WINDOW_SIZE low ones (100). While the
        // high one is still inside the last-10 window, it must dominate.
        const historyWithHighStillInWindow: LedaVoicePrebufferHistory = [
            measurement(900, now - 9_000),
            ...Array.from({ length: LEDA_PREBUFFER_HISTORY_WINDOW_SIZE - 1 }, (_, i) => measurement(100, now - (8_000 - i * 500))),
        ];
        expect(historyWithHighStillInWindow).toHaveLength(LEDA_PREBUFFER_HISTORY_WINDOW_SIZE);
        expect(estimateNextLedaVoicePrebufferMs(historyWithHighStillInWindow, now))
            .toBe(900 + LEDA_PREBUFFER_ESTIMATE_SAFETY_MS);

        // One more low measurement pushes the high one out of the last-10
        // window (the caller trims with appendLedaVoicePrebufferMeasurement
        // before persisting, but the estimator itself also only looks at the
        // most recent WINDOW_SIZE entries defensively).
        const historyWithHighPushedOut: LedaVoicePrebufferHistory = [
            ...historyWithHighStillInWindow,
            measurement(100, now),
        ];
        expect(estimateNextLedaVoicePrebufferMs(historyWithHighPushedOut, now))
            .toBe(100 + LEDA_PREBUFFER_ESTIMATE_SAFETY_MS);
    });

    it('discards measurements older than 12 hours relative to now', () => {
        const now = 100_000_000;
        const staleHigh = measurement(900, now - LEDA_PREBUFFER_HISTORY_MAX_AGE_MS - 1);
        const freshLow = measurement(120, now - 1_000);

        expect(estimateNextLedaVoicePrebufferMs([staleHigh, freshLow], now))
            .toBe(120 + LEDA_PREBUFFER_ESTIMATE_SAFETY_MS);
    });

    it('keeps a measurement exactly at the 12h boundary', () => {
        const now = 100_000_000;
        const atBoundary = measurement(900, now - LEDA_PREBUFFER_HISTORY_MAX_AGE_MS);

        expect(estimateNextLedaVoicePrebufferMs([atBoundary], now))
            .toBe(900 + LEDA_PREBUFFER_ESTIMATE_SAFETY_MS);
    });

    it('falls back to the default once every measurement is stale', () => {
        const now = 100_000_000;
        const history: LedaVoicePrebufferHistory = [
            measurement(900, now - LEDA_PREBUFFER_HISTORY_MAX_AGE_MS - 1),
            measurement(600, now - LEDA_PREBUFFER_HISTORY_MAX_AGE_MS - 5_000),
        ];

        expect(estimateNextLedaVoicePrebufferMs(history, now)).toBe(LEDA_PREBUFFER_ESTIMATE_DEFAULT_MS);
    });

    it('clamps at the minimum for a very low measurement', () => {
        const history: LedaVoicePrebufferHistory = [measurement(10, 1_000)];

        expect(estimateNextLedaVoicePrebufferMs(history, 1_000)).toBe(LEDA_PREBUFFER_ESTIMATE_MIN_MS);
    });

    it('clamps at the maximum for a very high measurement', () => {
        const history: LedaVoicePrebufferHistory = [measurement(10_000, 1_000)];

        expect(estimateNextLedaVoicePrebufferMs(history, 1_000)).toBe(LEDA_PREBUFFER_ESTIMATE_MAX_MS);
    });

    it('does not clamp exactly at the min/max edges themselves', () => {
        const atMin = LEDA_PREBUFFER_ESTIMATE_MIN_MS - LEDA_PREBUFFER_ESTIMATE_SAFETY_MS;
        const atMax = LEDA_PREBUFFER_ESTIMATE_MAX_MS - LEDA_PREBUFFER_ESTIMATE_SAFETY_MS;

        expect(estimateNextLedaVoicePrebufferMs([measurement(atMin, 1_000)], 1_000))
            .toBe(LEDA_PREBUFFER_ESTIMATE_MIN_MS);
        expect(estimateNextLedaVoicePrebufferMs([measurement(atMax, 1_000)], 1_000))
            .toBe(LEDA_PREBUFFER_ESTIMATE_MAX_MS);
    });
});

describe('appendLedaVoicePrebufferMeasurement', () => {
    it('appends to an empty history', () => {
        const result = appendLedaVoicePrebufferMeasurement([], measurement(200, 1_000));

        expect(result).toEqual([measurement(200, 1_000)]);
    });

    it('keeps only the last N=10 measurements, dropping the oldest first', () => {
        const history: LedaVoicePrebufferHistory = Array.from(
            { length: LEDA_PREBUFFER_HISTORY_WINDOW_SIZE },
            (_, i) => measurement(100 + i, i),
        );

        const result = appendLedaVoicePrebufferMeasurement(history, measurement(999, 10_000));

        expect(result).toHaveLength(LEDA_PREBUFFER_HISTORY_WINDOW_SIZE);
        expect(result[0]).toEqual(measurement(101, 1));
        expect(result.at(-1)).toEqual(measurement(999, 10_000));
    });

    it('does not mutate the input history', () => {
        const history: LedaVoicePrebufferHistory = [measurement(100, 1)];
        const result = appendLedaVoicePrebufferMeasurement(history, measurement(200, 2));

        expect(history).toHaveLength(1);
        expect(result).not.toBe(history);
    });
});
