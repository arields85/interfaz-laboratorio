import type { ActivityAnalyticsPoint, ActivityAnalyticsState } from '../domain/activityAnalytics.types';

const HOUR_MS = 60 * 60 * 1000;

export interface ActivityAnalyticsThresholds {
    setupKw: number;
    prodKw: number;
}

export interface ActivityAnalyticsInterval {
    timestamp: string;
    timestampMs: number;
    endTimestamp: string;
    endTimestampMs: number;
    durationMs: number;
    state: ActivityAnalyticsState;
    normalizedKw: number | null;
    estimatedKwh: number;
    stopCountContribution: number;
    isDataBacked: boolean;
}

export interface ActivityAnalyticsDurationsMs {
    prod: number;
    setup: number;
    stopped: number;
    noData: number;
}

export interface ActivityAnalyticsResult {
    durationsMs: ActivityAnalyticsDurationsMs;
    stopCount: number;
    estimatedKwh: number;
    utilizationRatio: number;
    coverageRatio: number;
    intervals: ActivityAnalyticsInterval[];
}

interface ClassifyActivityAnalyticsPointOptions {
    value: number | null;
    thresholds: ActivityAnalyticsThresholds;
}

interface BuildActivityAnalyticsOptions {
    series: ActivityAnalyticsPoint[];
    bucketMs: number;
    thresholds: ActivityAnalyticsThresholds;
}

export function validateActivityAnalyticsThresholds(thresholds: ActivityAnalyticsThresholds): ActivityAnalyticsThresholds {
    if (!Number.isFinite(thresholds.setupKw) || !Number.isFinite(thresholds.prodKw) || thresholds.prodKw <= thresholds.setupKw) {
        throw new Error('Activity analytics requires prodThresholdKw to be greater than setupThresholdKw');
    }

    return thresholds;
}

export function classifyActivityAnalyticsPoint({ value, thresholds }: ClassifyActivityAnalyticsPointOptions): {
    normalizedValue: number;
    state: Exclude<ActivityAnalyticsState, 'no-data'>;
} {
    validateActivityAnalyticsThresholds(thresholds);

    const normalizedValue = typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, value)
        : 0;

    if (normalizedValue >= thresholds.prodKw) {
        return { normalizedValue, state: 'prod' };
    }

    if (normalizedValue >= thresholds.setupKw) {
        return { normalizedValue, state: 'setup' };
    }

    return { normalizedValue, state: 'stopped' };
}

export function buildActivityAnalytics({ series, bucketMs, thresholds }: BuildActivityAnalyticsOptions): ActivityAnalyticsResult {
    validateActivityAnalyticsThresholds(thresholds);

    if (!Number.isFinite(bucketMs) || bucketMs <= 0) {
        throw new Error('Activity analytics requires bucketMs to be greater than zero');
    }

    const sortedSeries = [...series].sort((left, right) => left.timestampMs - right.timestampMs);
    const intervals: ActivityAnalyticsInterval[] = [];
    const durationsMs: ActivityAnalyticsDurationsMs = {
        prod: 0,
        setup: 0,
        stopped: 0,
        noData: 0,
    };

    let stopCount = 0;
    let estimatedKwh = 0;
    let previousDataBackedState: Exclude<ActivityAnalyticsState, 'no-data'> | null = null;

    for (let index = 0; index < sortedSeries.length; index += 1) {
        const current = sortedSeries[index];
        const next = sortedSeries[index + 1];
        const rawDurationMs = next
            ? Math.max(0, next.timestampMs - current.timestampMs)
            : Math.max(0, bucketMs * 1.5);
        const durationMs = next ? rawDurationMs : Math.min(rawDurationMs, bucketMs * 1.5);

        if (durationMs <= 0) {
            continue;
        }

        const hasGap = Boolean(next) && rawDurationMs > (bucketMs * 2);
        const hasNumericValue = typeof current.value === 'number' && Number.isFinite(current.value);
        const classified = classifyActivityAnalyticsPoint({ value: current.value, thresholds });
        const state: ActivityAnalyticsState = hasGap || !hasNumericValue ? 'no-data' : classified.state;
        const normalizedKw = state === 'no-data' ? null : classified.normalizedValue;
        const isDataBacked = state !== 'no-data';
        const stopCountContribution = previousDataBackedState !== null
            && (previousDataBackedState === 'prod' || previousDataBackedState === 'setup')
            && state === 'stopped'
            ? 1
            : 0;
        const estimatedIntervalKwh = isDataBacked && normalizedKw !== null
            ? normalizedKw * (durationMs / HOUR_MS)
            : 0;

        intervals.push({
            timestamp: current.timestamp,
            timestampMs: current.timestampMs,
            endTimestamp: new Date(current.timestampMs + durationMs).toISOString(),
            endTimestampMs: current.timestampMs + durationMs,
            durationMs,
            state,
            normalizedKw,
            estimatedKwh: estimatedIntervalKwh,
            stopCountContribution,
            isDataBacked,
        });

        if (state === 'no-data') {
            durationsMs.noData += durationMs;
            previousDataBackedState = null;
            continue;
        }

        durationsMs[state] += durationMs;
        estimatedKwh += estimatedIntervalKwh;
        stopCount += stopCountContribution;
        previousDataBackedState = state;
    }

    const dataBackedDurationMs = durationsMs.prod + durationsMs.setup + durationsMs.stopped;
    const totalDurationMs = dataBackedDurationMs + durationsMs.noData;

    return {
        durationsMs,
        stopCount,
        estimatedKwh,
        utilizationRatio: dataBackedDurationMs > 0 ? durationsMs.prod / dataBackedDurationMs : 0,
        coverageRatio: totalDurationMs > 0 ? dataBackedDurationMs / totalDurationMs : 0,
        intervals,
    };
}
