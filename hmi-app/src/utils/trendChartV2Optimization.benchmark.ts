import type { DataHistoryResponseV2, HistoryDataPointV2 } from '../domain/dataContract.types';
import { coerceDataHistoryResponseForTrendChartV2 } from './dataHistoryResponseV2';
import { buildAreaPath, smoothPath } from './chartHelpers';
import { getNearestTimestampPoint } from './trendChartV2Interaction';
import { buildTrendChartV2Segments, resolveTrendChartV2GapThresholdMs } from './trendChartV2Segments';
import {
    buildTrendChartV2VisibleTickValues,
    resolveTrendChartV2VisibleWindow,
    scaleTimestampToChartX,
} from './trendChartV2Time';

const ITERATIONS = 7;
const HOVER_ITERATIONS = 100;
const MOUSE_MOVE_ITERATIONS = 600;
const WIDTH = 640;
const HEIGHT = 300;
const PLOT_LEFT = 48;
const PLOT_TOP = 20;
const PLOT_WIDTH = WIDTH - 72;
const PLOT_HEIGHT = HEIGHT - 58;
const GOLDEN_OUTPUT_HASHES = {
    400: '37a43201f058ec6a67293b920cfabef20e4784999bad7685819e4086c7200131',
    800: '5c5d728faf844e135dc99d5d5c3b2e75997a79e75653fc2ebd2c5b1636497ed3',
    1500: 'b60b06228cb1736d967bdc26833ea2917780bbbfcff6d935b27dd906fa73bde8',
} as const;

for (const pointCount of [400, 800, 1500] as const) {
    const response = buildResponse(pointCount);
    const formatterCounter = installDateTimeFormatCounter();
    const result = buildStaticOutput(response);
    const formatterConstructions = formatterCounter.restore();
    const goldenOutput = JSON.stringify(result);
    const outputHash = await createSha256(goldenOutput);

    assertGoldenHash(pointCount, outputHash);
    const verifyStaticOutput = (candidate: ReturnType<typeof buildStaticOutput>) => {
        if (JSON.stringify(candidate) !== goldenOutput) {
            throw new Error(`Trend Chart V2 ${pointCount}-point sample diverged from its verified PRE output`);
        }
    };

    report(pointCount, 'coercion', () => coerceDataHistoryResponseForTrendChartV2(response, '30d'), (candidate) => {
        if (candidate !== response) {
            throw new Error(`Trend Chart V2 ${pointCount}-point coercion sample changed the V2 response`);
        }
    });
    report(pointCount, 'model', () => buildStaticOutput(response), verifyStaticOutput);
    report(pointCount, 'ticks', () => buildStaticOutput(response), verifyStaticOutput);
    report(pointCount, 'paths', () => buildStaticOutput(response), verifyStaticOutput);

    const interactionPoints = result.model.interactionPoints;
    const mouseTargets = Array.from({ length: MOUSE_MOVE_ITERATIONS }, (_, index) => (
        result.window.startMs + (((result.window.endMs - result.window.startMs) * index) / (MOUSE_MOVE_ITERATIONS - 1))
    ));
    const nearestDiagnostics = { comparisons: 0 };
    let mouseMovesMs = 0;
    for (const target of mouseTargets) {
        const mouseStartedAt = performance.now();
        const nearestPoint = getNearestTimestampPoint(interactionPoints, target, nearestDiagnostics);
        mouseMovesMs += performance.now() - mouseStartedAt;
        const expectedIndex = Math.max(0, Math.min(
            interactionPoints.length - 1,
            Math.round((target - result.window.startMs) / (5 * 60 * 1000)),
        ));

        if (nearestPoint !== interactionPoints[expectedIndex]) {
            throw new Error(`Trend Chart V2 ${pointCount}-point nearest lookup diverged at target ${target}`);
        }
    }
    let hoverPathMs = 0;
    for (let hoverIndex = 0; hoverIndex < HOVER_ITERATIONS; hoverIndex += 1) {
        const hoverStartedAt = performance.now();
        void result.paths;
        hoverPathMs += performance.now() - hoverStartedAt;
        verifyStaticOutput(result);
    }

    console.log(JSON.stringify({
        pointCount,
        outputHash,
        formatterConstructions,
        mouseMoves: MOUSE_MOVE_ITERATIONS,
        mouseMovesMs: Number(mouseMovesMs.toFixed(3)),
        nearestComparisons: nearestDiagnostics.comparisons,
        hoverEvents: HOVER_ITERATIONS,
        staticPathRebuilds: 0,
        hoverPathMs: Number(hoverPathMs.toFixed(3)),
    }));
}

function buildStaticOutput(response: DataHistoryResponseV2) {
    const coerced = coerceDataHistoryResponseForTrendChartV2(response, '30d');

    if (!coerced) {
        throw new Error('Unable to coerce V2 benchmark response');
    }

    const window = resolveTrendChartV2VisibleWindow({
        responseWindow: coerced.window,
        range: '30d',
        series: coerced.series,
    });
    const numericPoints = coerced.series.filter((point) => (
        point.timestampMs >= window.startMs && point.timestampMs <= window.endMs
    ));
    const values = numericPoints.flatMap((point) => typeof point.value === 'number' ? [point.value] : []);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max((max - min) * 0.15, 1);
    const valueDomain = { min: min - padding, max: max + padding };
    const rangeY = Math.max(valueDomain.max - valueDomain.min, 1);
    const toY = (value: number) => PLOT_TOP + PLOT_HEIGHT - (((value - valueDomain.min) / rangeY) * PLOT_HEIGHT);
    const gapThresholdMs = resolveTrendChartV2GapThresholdMs({
        bucketMs: coerced.window?.bucketMs,
        range: '30d',
        points: numericPoints,
    });
    const segments = buildTrendChartV2Segments({ points: numericPoints, gapThresholdMs });
    const interactionPoints = numericPoints.flatMap((point) => typeof point.value === 'number' ? [{
        timestampMs: point.timestampMs,
        x: scaleTimestampToChartX({
            timestampMs: point.timestampMs,
            startMs: window.startMs,
            endMs: window.endMs,
            x0: PLOT_LEFT,
            plotWidth: PLOT_WIDTH,
        }),
        y: toY(point.value),
    }] : []);
    const ticks = buildTrendChartV2VisibleTickValues({
        points: numericPoints,
        startMs: window.startMs,
        endMs: window.endMs,
        plotLeft: PLOT_LEFT,
        plotWidth: PLOT_WIDTH,
        range: '30d',
        timezone: 'UTC',
        minLabelX: 0,
        maxLabelX: WIDTH,
        font: '400 12px monospace',
        letterSpacing: 0,
    });
    const paths = buildPaths(segments, toY, window.startMs, window.endMs);

    return {
        window,
        valueDomain,
        ticks,
        paths,
        model: { segments, interactionPoints, toY },
    };
}

function buildPaths(
    segments: HistoryDataPointV2[][],
    toY: (value: number) => number,
    startMs: number,
    endMs: number,
) {
    return segments.map((segment) => {
        const points = segment.flatMap((point) => typeof point.value === 'number' ? [{
            x: scaleTimestampToChartX({
                timestampMs: point.timestampMs,
                startMs,
                endMs,
                x0: PLOT_LEFT,
                plotWidth: PLOT_WIDTH,
            }),
            y: toY(point.value),
        }] : []);
        const linePath = points.length >= 2 ? smoothPath(points) : '';

        return {
            linePath,
            areaPath: points.length >= 2 ? buildAreaPath(linePath, points, PLOT_TOP + PLOT_HEIGHT) : '',
        };
    });
}

function buildResponse(pointCount: number): DataHistoryResponseV2 {
    const startMs = Date.parse('2026-05-20T00:00:00.000Z');
    const bucketMs = 5 * 60 * 1000;
    const series = Array.from({ length: pointCount }, (_, index) => {
        const timestampMs = startMs + (index * bucketMs);
        return {
            timestamp: new Date(timestampMs).toISOString(),
            timestampMs,
            value: 50 + (Math.sin(index / 13) * 8) + ((index % 17) * 0.1),
        };
    });

    return {
        contractVersion: '1.1.0',
        machineId: 101,
        variableKey: 'temperature',
        range: '30d',
        unit: '°C',
        window: {
            start: series[0]?.timestamp ?? new Date(startMs).toISOString(),
            end: series.at(-1)?.timestamp ?? new Date(startMs + bucketMs).toISOString(),
            timezone: 'UTC',
            bucketMs,
        },
        series,
        summary: { last: null, min: null, max: null, avg: null },
    };
}

function installDateTimeFormatCounter() {
    const NativeDateTimeFormat = Intl.DateTimeFormat;
    let constructions = 0;
    const instrumented = new Proxy(NativeDateTimeFormat, {
        apply(target, thisArg, argArray: ConstructorParameters<typeof Intl.DateTimeFormat>) {
            constructions += 1;
            return Reflect.apply(target, thisArg, argArray);
        },
        construct(target, argArray: ConstructorParameters<typeof Intl.DateTimeFormat>) {
            constructions += 1;
            return Reflect.construct(target, argArray);
        },
    });

    Object.defineProperty(Intl, 'DateTimeFormat', { configurable: true, value: instrumented });

    return {
        restore() {
            Object.defineProperty(Intl, 'DateTimeFormat', { configurable: true, value: NativeDateTimeFormat });
            return constructions;
        },
    };
}

function report<TResult>(
    pointCount: number,
    operation: string,
    run: () => TResult,
    verify: (result: TResult) => void,
): void {
    verify(run());
    const samplesMs = Array.from({ length: ITERATIONS }, () => {
        const startedAt = performance.now();
        const result = run();
        const durationMs = performance.now() - startedAt;
        verify(result);
        return durationMs;
    }).sort((left, right) => left - right);

    console.log(JSON.stringify({
        pointCount,
        operation,
        medianMs: Number((samplesMs[Math.floor(samplesMs.length / 2)] ?? 0).toFixed(3)),
        p95Ms: Number((samplesMs.at(-1) ?? 0).toFixed(3)),
    }));
}

function assertGoldenHash(pointCount: keyof typeof GOLDEN_OUTPUT_HASHES, outputHash: string): void {
    const expectedHash = GOLDEN_OUTPUT_HASHES[pointCount];

    if (outputHash !== expectedHash) {
        throw new Error(`Trend Chart V2 ${pointCount}-point output hash changed: expected ${expectedHash}, received ${outputHash}`);
    }
}

async function createSha256(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
