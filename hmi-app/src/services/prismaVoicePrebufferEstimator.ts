/**
 * Continuous estimator for the Prisma voice prebuffer ("rises fast, falls
 * slowly"): given the recent history of per-answer needed-prebuffer
 * measurements (see `prismaPrebufferNeedTracker.ts`), computes the
 * prebuffer to use for the next answer.
 *
 * Rule (odd/tasks/prisma-adaptive-voice-buffer.md, Design item 2): keep only
 * the last PRISMA_PREBUFFER_HISTORY_WINDOW_SIZE measurements, discard any
 * older than PRISMA_PREBUFFER_HISTORY_MAX_AGE_MS relative to `now`, and the
 * next prebuffer is `clamp(max(window) + safety, min, max)`. With no valid,
 * fresh measurements, use the fixed default (the value proven live by
 * PW-006 T22 before this feature). A single demanding answer therefore
 * raises the estimate on the very next call; it only falls back down once
 * that high measurement ages past the staleness limit or is pushed out of
 * the last-N window by newer measurements.
 *
 * Pure and deterministic: `now` is always passed in by the caller (the
 * engine's injectable clock), never read from `Date.now()` here.
 */
import type { PrismaVoicePrebufferHistory, PrismaVoicePrebufferMeasurement } from '../domain/prismaVoicePrebufferHistory.types';

export const PRISMA_PREBUFFER_HISTORY_WINDOW_SIZE = 10;
export const PRISMA_PREBUFFER_HISTORY_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const PRISMA_PREBUFFER_ESTIMATE_SAFETY_MS = 50;
export const PRISMA_PREBUFFER_ESTIMATE_MIN_MS = 100;
export const PRISMA_PREBUFFER_ESTIMATE_MAX_MS = 3_000;
export const PRISMA_PREBUFFER_ESTIMATE_DEFAULT_MS = 200;

/**
 * Appends one new measurement and trims to the last
 * PRISMA_PREBUFFER_HISTORY_WINDOW_SIZE entries (oldest dropped first). Does
 * not mutate the input history; returns the list the caller should persist.
 */
export function appendPrismaVoicePrebufferMeasurement(
    history: PrismaVoicePrebufferHistory,
    measurement: PrismaVoicePrebufferMeasurement,
): PrismaVoicePrebufferHistory {
    return [...history, measurement].slice(-PRISMA_PREBUFFER_HISTORY_WINDOW_SIZE);
}

/**
 * Computes the prebuffer (ms) to use for the next answer from the given
 * history, evaluated at `nowMs`. Also caps to the last WINDOW_SIZE fresh
 * entries defensively, in case the caller passes a longer, unpruned history
 * (e.g. read from storage before a migration trimmed it).
 */
export function estimateNextPrismaVoicePrebufferMs(
    history: PrismaVoicePrebufferHistory,
    nowMs: number,
): number {
    const freshWindow = history
        .filter((entry) => nowMs - entry.recordedAtMs <= PRISMA_PREBUFFER_HISTORY_MAX_AGE_MS)
        .slice(-PRISMA_PREBUFFER_HISTORY_WINDOW_SIZE);

    if (freshWindow.length === 0) {
        return PRISMA_PREBUFFER_ESTIMATE_DEFAULT_MS;
    }

    const maxMeasuredMs = Math.max(...freshWindow.map((entry) => entry.neededPrebufferMs));
    const candidateMs = maxMeasuredMs + PRISMA_PREBUFFER_ESTIMATE_SAFETY_MS;

    return Math.min(PRISMA_PREBUFFER_ESTIMATE_MAX_MS, Math.max(PRISMA_PREBUFFER_ESTIMATE_MIN_MS, candidateMs));
}
