import { describe, expect, it } from 'vitest';

import type { PrismaVoicePrebufferHistory } from '../domain/prismaVoicePrebufferHistory.types';
import {
    appendPrismaVoicePrebufferMeasurement,
    estimateNextPrismaVoicePrebufferMs,
    PRISMA_PREBUFFER_ESTIMATE_DEFAULT_MS,
    PRISMA_PREBUFFER_ESTIMATE_MAX_MS,
    PRISMA_PREBUFFER_ESTIMATE_MIN_MS,
    PRISMA_PREBUFFER_ESTIMATE_SAFETY_MS,
    PRISMA_PREBUFFER_HISTORY_MAX_AGE_MS,
    PRISMA_PREBUFFER_HISTORY_WINDOW_SIZE,
} from './prismaVoicePrebufferEstimator';

function measurement(neededPrebufferMs: number, recordedAtMs: number) {
    return { neededPrebufferMs, recordedAtMs };
}

describe('estimateNextPrismaVoicePrebufferMs', () => {
    it('returns the default when the history is empty', () => {
        expect(estimateNextPrismaVoicePrebufferMs([], 1_000_000)).toBe(PRISMA_PREBUFFER_ESTIMATE_DEFAULT_MS);
    });

    it('returns clamp(max(window) + safety, min, max) for an ordinary history', () => {
        const history: PrismaVoicePrebufferHistory = [
            measurement(150, 1_000),
            measurement(400, 2_000),
            measurement(300, 3_000),
        ];

        expect(estimateNextPrismaVoicePrebufferMs(history, 3_000)).toBe(400 + PRISMA_PREBUFFER_ESTIMATE_SAFETY_MS);
    });

    it('raises the value on the very next call after one high measurement', () => {
        const before = estimateNextPrismaVoicePrebufferMs([measurement(150, 1_000)], 1_000);
        const after = estimateNextPrismaVoicePrebufferMs(
            [measurement(150, 1_000), measurement(900, 2_000)],
            2_000,
        );

        expect(before).toBe(150 + PRISMA_PREBUFFER_ESTIMATE_SAFETY_MS);
        expect(after).toBe(900 + PRISMA_PREBUFFER_ESTIMATE_SAFETY_MS);
        expect(after).toBeGreaterThan(before);
    });

    it('only falls once the high measurement leaves the 10-item window', () => {
        const now = 100_000;
        // A high measurement (900) at the front, followed by exactly
        // PRISMA_PREBUFFER_HISTORY_WINDOW_SIZE low ones (100). While the
        // high one is still inside the last-10 window, it must dominate.
        const historyWithHighStillInWindow: PrismaVoicePrebufferHistory = [
            measurement(900, now - 9_000),
            ...Array.from({ length: PRISMA_PREBUFFER_HISTORY_WINDOW_SIZE - 1 }, (_, i) => measurement(100, now - (8_000 - i * 500))),
        ];
        expect(historyWithHighStillInWindow).toHaveLength(PRISMA_PREBUFFER_HISTORY_WINDOW_SIZE);
        expect(estimateNextPrismaVoicePrebufferMs(historyWithHighStillInWindow, now))
            .toBe(900 + PRISMA_PREBUFFER_ESTIMATE_SAFETY_MS);

        // One more low measurement pushes the high one out of the last-10
        // window (the caller trims with appendPrismaVoicePrebufferMeasurement
        // before persisting, but the estimator itself also only looks at the
        // most recent WINDOW_SIZE entries defensively).
        const historyWithHighPushedOut: PrismaVoicePrebufferHistory = [
            ...historyWithHighStillInWindow,
            measurement(100, now),
        ];
        expect(estimateNextPrismaVoicePrebufferMs(historyWithHighPushedOut, now))
            .toBe(100 + PRISMA_PREBUFFER_ESTIMATE_SAFETY_MS);
    });

    it('discards measurements older than 12 hours relative to now', () => {
        const now = 100_000_000;
        const staleHigh = measurement(900, now - PRISMA_PREBUFFER_HISTORY_MAX_AGE_MS - 1);
        const freshLow = measurement(120, now - 1_000);

        expect(estimateNextPrismaVoicePrebufferMs([staleHigh, freshLow], now))
            .toBe(120 + PRISMA_PREBUFFER_ESTIMATE_SAFETY_MS);
    });

    it('keeps a measurement exactly at the 12h boundary', () => {
        const now = 100_000_000;
        const atBoundary = measurement(900, now - PRISMA_PREBUFFER_HISTORY_MAX_AGE_MS);

        expect(estimateNextPrismaVoicePrebufferMs([atBoundary], now))
            .toBe(900 + PRISMA_PREBUFFER_ESTIMATE_SAFETY_MS);
    });

    it('falls back to the default once every measurement is stale', () => {
        const now = 100_000_000;
        const history: PrismaVoicePrebufferHistory = [
            measurement(900, now - PRISMA_PREBUFFER_HISTORY_MAX_AGE_MS - 1),
            measurement(600, now - PRISMA_PREBUFFER_HISTORY_MAX_AGE_MS - 5_000),
        ];

        expect(estimateNextPrismaVoicePrebufferMs(history, now)).toBe(PRISMA_PREBUFFER_ESTIMATE_DEFAULT_MS);
    });

    it('clamps at the minimum for a very low measurement', () => {
        const history: PrismaVoicePrebufferHistory = [measurement(10, 1_000)];

        expect(estimateNextPrismaVoicePrebufferMs(history, 1_000)).toBe(PRISMA_PREBUFFER_ESTIMATE_MIN_MS);
    });

    it('clamps at the maximum for a very high measurement', () => {
        const history: PrismaVoicePrebufferHistory = [measurement(10_000, 1_000)];

        expect(estimateNextPrismaVoicePrebufferMs(history, 1_000)).toBe(PRISMA_PREBUFFER_ESTIMATE_MAX_MS);
    });

    it('does not clamp exactly at the min/max edges themselves', () => {
        const atMin = PRISMA_PREBUFFER_ESTIMATE_MIN_MS - PRISMA_PREBUFFER_ESTIMATE_SAFETY_MS;
        const atMax = PRISMA_PREBUFFER_ESTIMATE_MAX_MS - PRISMA_PREBUFFER_ESTIMATE_SAFETY_MS;

        expect(estimateNextPrismaVoicePrebufferMs([measurement(atMin, 1_000)], 1_000))
            .toBe(PRISMA_PREBUFFER_ESTIMATE_MIN_MS);
        expect(estimateNextPrismaVoicePrebufferMs([measurement(atMax, 1_000)], 1_000))
            .toBe(PRISMA_PREBUFFER_ESTIMATE_MAX_MS);
    });
});

describe('appendPrismaVoicePrebufferMeasurement', () => {
    it('appends to an empty history', () => {
        const result = appendPrismaVoicePrebufferMeasurement([], measurement(200, 1_000));

        expect(result).toEqual([measurement(200, 1_000)]);
    });

    it('keeps only the last N=10 measurements, dropping the oldest first', () => {
        const history: PrismaVoicePrebufferHistory = Array.from(
            { length: PRISMA_PREBUFFER_HISTORY_WINDOW_SIZE },
            (_, i) => measurement(100 + i, i),
        );

        const result = appendPrismaVoicePrebufferMeasurement(history, measurement(999, 10_000));

        expect(result).toHaveLength(PRISMA_PREBUFFER_HISTORY_WINDOW_SIZE);
        expect(result[0]).toEqual(measurement(101, 1));
        expect(result.at(-1)).toEqual(measurement(999, 10_000));
    });

    it('does not mutate the input history', () => {
        const history: PrismaVoicePrebufferHistory = [measurement(100, 1)];
        const result = appendPrismaVoicePrebufferMeasurement(history, measurement(200, 2));

        expect(history).toHaveLength(1);
        expect(result).not.toBe(history);
    });
});
