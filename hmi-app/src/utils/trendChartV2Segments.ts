import type { HistoryDataPointV2, HistoryRangeV2 } from '../domain/dataContract.types';

interface ResolveTrendChartV2GapThresholdMsOptions {
    bucketMs?: number;
    range: HistoryRangeV2;
    points: HistoryDataPointV2[];
}

interface BuildTrendChartV2SegmentsOptions {
    points: HistoryDataPointV2[];
    gapThresholdMs: number;
}

const RANGE_FALLBACK_BUCKET_MS: Record<HistoryRangeV2, number> = {
    '1h': 5 * 60 * 1000,
    '24h': 60 * 60 * 1000,
    '7d': 6 * 60 * 60 * 1000,
    '30d': 24 * 60 * 60 * 1000,
    '12m': 30 * 24 * 60 * 60 * 1000,
    custom: 60 * 60 * 1000,
};

const GAP_THRESHOLD_MULTIPLIER = 1.5;
const COARSE_DAY_SCALE_GAP_THRESHOLD_MULTIPLIER = 2.5;
const COARSE_DAY_SCALE_MIN_CADENCE_MS = 12 * 60 * 60 * 1000;
const DENSE_HELD_VALUE_BRIDGE_MAX_CADENCE_MS = 30 * 60 * 1000;
const MODERATE_HELD_VALUE_BRIDGE_MAX_CADENCE_MS = 24 * 60 * 60 * 1000;
const DENSE_HELD_VALUE_BRIDGE_MAX_CADENCE_STEPS = 5;
const MODERATE_HELD_VALUE_BRIDGE_MAX_CADENCE_STEPS = 3.5;

function resolveHeldValueBridgeBudgetMs(representativeDeltaMs: number | undefined): number | undefined {
    if (representativeDeltaMs === undefined) {
        return undefined;
    }

    if (representativeDeltaMs <= DENSE_HELD_VALUE_BRIDGE_MAX_CADENCE_MS) {
        return representativeDeltaMs * DENSE_HELD_VALUE_BRIDGE_MAX_CADENCE_STEPS;
    }

    if (representativeDeltaMs <= MODERATE_HELD_VALUE_BRIDGE_MAX_CADENCE_MS) {
        return representativeDeltaMs * MODERATE_HELD_VALUE_BRIDGE_MAX_CADENCE_STEPS;
    }

    return undefined;
}

function resolvePositiveDeltas(points: HistoryDataPointV2[]): number[] {
    return points
        .slice(1)
        .map((point, index) => point.timestampMs - points[index].timestampMs)
        .filter((delta) => Number.isFinite(delta) && delta > 0)
        .sort((left, right) => left - right);
}

function resolveRepresentativeCadenceDeltaMs(positiveDeltas: number[]): number | undefined {
    if (positiveDeltas.length === 0) {
        return undefined;
    }

    if (positiveDeltas.length === 2) {
        return positiveDeltas[0];
    }

    return positiveDeltas[Math.floor(positiveDeltas.length / 2)];
}

function resolveGapThresholdMultiplier(range: HistoryRangeV2, representativeDelta: number | undefined): number {
    if (
        representativeDelta !== undefined
        && representativeDelta >= COARSE_DAY_SCALE_MIN_CADENCE_MS
        && (range === '7d' || range === '30d')
    ) {
        return COARSE_DAY_SCALE_GAP_THRESHOLD_MULTIPLIER;
    }

    return GAP_THRESHOLD_MULTIPLIER;
}

export function resolveTrendChartV2GapThresholdMs({
    bucketMs,
    range,
    points,
}: ResolveTrendChartV2GapThresholdMsOptions): number {
    const positiveDeltas = resolvePositiveDeltas(points);

    const representativeDelta = resolveRepresentativeCadenceDeltaMs(positiveDeltas);
    const gapThresholdMultiplier = resolveGapThresholdMultiplier(range, representativeDelta);

    const bucketThresholdMs = typeof bucketMs === 'number' && Number.isFinite(bucketMs) && bucketMs > 0
        ? Math.round(bucketMs * gapThresholdMultiplier)
        : undefined;

    if (bucketThresholdMs !== undefined && representativeDelta) {
        return Math.max(bucketThresholdMs, Math.round(representativeDelta * gapThresholdMultiplier));
    }

    if (bucketThresholdMs !== undefined) {
        return bucketThresholdMs;
    }

    if (representativeDelta) {
        return Math.round(representativeDelta * gapThresholdMultiplier);
    }

    return Math.round(RANGE_FALLBACK_BUCKET_MS[range] * gapThresholdMultiplier);
}

function shouldBridgeHeldValueGap(options: {
    previousPoint: HistoryDataPointV2;
    point: HistoryDataPointV2;
    gapMs: number;
    gapThresholdMs: number;
    representativeDeltaMs: number | undefined;
}): boolean {
    const { previousPoint, point, gapMs, gapThresholdMs, representativeDeltaMs } = options;

    if (
        representativeDeltaMs === undefined
        || previousPoint.value !== point.value
    ) {
        return false;
    }

    const heldValueBridgeBudgetMs = resolveHeldValueBridgeBudgetMs(representativeDeltaMs);

    if (heldValueBridgeBudgetMs === undefined) {
        return false;
    }

    const heldValueBridgeThresholdMs = Math.max(
        gapThresholdMs,
        heldValueBridgeBudgetMs,
    );

    return gapMs <= heldValueBridgeThresholdMs;
}

export function buildTrendChartV2Segments({ points, gapThresholdMs }: BuildTrendChartV2SegmentsOptions): HistoryDataPointV2[][] {
    const segments: HistoryDataPointV2[][] = [];
    let currentSegment: HistoryDataPointV2[] = [];
    let previousNumericPoint: HistoryDataPointV2 | null = null;
    const representativeDeltaMs = resolveRepresentativeCadenceDeltaMs(resolvePositiveDeltas(points));

    for (const point of points) {
        if (typeof point.value !== 'number' || !Number.isFinite(point.value)) {
            if (currentSegment.length > 0) {
                segments.push(currentSegment);
                currentSegment = [];
            }
            previousNumericPoint = null;
            continue;
        }

        const gapMs = previousNumericPoint === null ? 0 : point.timestampMs - previousNumericPoint.timestampMs;
        const hasLargeGap = previousNumericPoint !== null
            && gapMs > gapThresholdMs
            && !shouldBridgeHeldValueGap({
                previousPoint: previousNumericPoint,
                point,
                gapMs,
                gapThresholdMs,
                representativeDeltaMs,
            });

        if (hasLargeGap && currentSegment.length > 0) {
            segments.push(currentSegment);
            currentSegment = [];
        }

        currentSegment.push(point);
        previousNumericPoint = point;
    }

    if (currentSegment.length > 0) {
        segments.push(currentSegment);
    }

    return segments;
}
