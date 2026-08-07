import type { DataHistoryResponse, HistoryRange } from '../domain/dataContract.types';
import {
    buildTrendChartLegacyModel,
    mapTrendChartLegacyHistory,
    resolveTrendChartLegacyDomain,
    resolveTrendChartLegacyHoverIndex,
    type TrendChartLegacyDataPoint,
} from '../widgets/renderers/trendChartLegacyModel';

const ITERATIONS = 5;
const ALGORITHM_LOOKUPS = 600;
const WIDTH = 640;
const HEIGHT = 300;
const CHART_FONT = '400 12px monospace';
const CHART_LETTER_SPACING = 0;
const GOLDENS = {
    24: {
        staticOutputHash: '52da9e1670e4dc0b5be766adbf74f30fd504fd0a746b18fbf5a2cf46bbf26d74',
        confirmedContinuityHash: 'b4241bc98ea29f91629a33c421dbc4c44b14046ce1e6f0974cf538d93c07881b',
        reinterpretedPlaceholderHash: '53926785d282600f5e67bbfa67c817c32da1b2bf6d601f87b9d131815462a8b4',
    },
    1000: {
        staticOutputHash: '68fe9a24056b00908ce8145c8a3115ec61e382cb1a5e4fbec587cdebb1aa1192',
        confirmedContinuityHash: 'b9bf9b67f9751da7d04631e80c5fdab879809f7142296743051c28798ac3f28f',
        reinterpretedPlaceholderHash: '82a038993a3e05550d5008e93a1afcb0c5b497f20b2c6e924e244842eb617a8c',
    },
    10_000: {
        staticOutputHash: '21330517aab213e5e4778ec4c269adddbf17abb7a3002743dc9c2f32cc4f8f81',
        confirmedContinuityHash: '2828d8eee7a25d51e0d963b0afc77120a42bf9808e81143b4a6150e1551ee219',
        reinterpretedPlaceholderHash: '2d6ec6bcbc46016319f4f0cc1cd50754a0411830896e46db7a7c22a9a98bbc7e',
    },
} as const;

for (const pointCount of [24, 1000, 10_000] as const) {
    const response = buildResponse(pointCount, 'semana');
    const confirmedData = mapTrendChartLegacyHistory(response, 'semana');
    const staticOutput = buildStaticOutput(confirmedData);
    const goldenOutput = JSON.stringify(staticOutput);
    const staticOutputHash = await createSha256(JSON.stringify(staticOutput));
    const placeholderData = mapTrendChartLegacyHistory(response, 'mes');
    const placeholderOutput = buildStaticOutput(placeholderData);
    const confirmedContinuityHash = await createSha256(JSON.stringify({
        range: 'semana',
        labels: confirmedData.map((point) => point.time),
        domain: staticOutput.domain,
        summary: response.summary,
    }));
    const reinterpretedPlaceholderHash = await createSha256(JSON.stringify({
        range: 'mes',
        labels: placeholderData.map((point) => point.time),
        domain: placeholderOutput.domain,
        summary: response.summary,
    }));

    assertGolden(pointCount, 'staticOutputHash', staticOutputHash);
    assertGolden(pointCount, 'confirmedContinuityHash', confirmedContinuityHash);
    assertGolden(pointCount, 'reinterpretedPlaceholderHash', reinterpretedPlaceholderHash);
    const verifyStaticOutput = (candidate: ReturnType<typeof buildStaticOutput>) => {
        if (JSON.stringify(candidate) !== goldenOutput) {
            throw new Error(`Legacy Trend Chart ${pointCount}-point sample diverged from its verified PRE output`);
        }
    };
    const confirmedDataOutput = JSON.stringify(confirmedData);

    report(pointCount, 'mapping', () => mapTrendChartLegacyHistory(response, 'semana'), (candidate) => {
        if (JSON.stringify(candidate) !== confirmedDataOutput) {
            throw new Error(`Legacy Trend Chart ${pointCount}-point mapping sample diverged`);
        }
    });
    report(pointCount, 'domain', () => resolveTrendChartLegacyDomain(confirmedData), (candidate) => {
        if (JSON.stringify(candidate) !== JSON.stringify(staticOutput.domain)) {
            throw new Error(`Legacy Trend Chart ${pointCount}-point domain sample diverged`);
        }
    });
    report(pointCount, 'static-model', () => buildStaticOutput(confirmedData), verifyStaticOutput);

    const targetIndices = Array.from({ length: 6 }, (_, index) => (
        Math.round((index * (confirmedData.length - 1)) / 5)
    ));
    const resolvedIndices = new Set<number>();
    let algorithmLookupMs = 0;
    for (let index = 0; index < ALGORITHM_LOOKUPS; index += 1) {
        const targetIndex = targetIndices[Math.floor(index / 100)] ?? 0;
        const lookupStartedAt = performance.now();
        const resolvedIndex = resolveTrendChartLegacyHoverIndex({
            chartX: staticOutput.points[targetIndex]?.x ?? 0,
            x0: staticOutput.points[0]?.x ?? 0,
            step: staticOutput.points.length > 1
                ? (staticOutput.points[1]?.x ?? 0) - (staticOutput.points[0]?.x ?? 0)
                : 0,
            dataLength: confirmedData.length,
        });
        algorithmLookupMs += performance.now() - lookupStartedAt;

        if (resolvedIndex !== targetIndex) {
            throw new Error(`Legacy Trend Chart ${pointCount}-point O(1) hover lookup diverged`);
        }

        if (resolvedIndex !== null) {
            resolvedIndices.add(resolvedIndex);
        }
    }

    console.log(JSON.stringify({
        pointCount,
        staticOutputHash,
        mappedPointCount: confirmedData.length,
        algorithmLookups: ALGORITHM_LOOKUPS,
        algorithmLookupMs: Number(algorithmLookupMs.toFixed(3)),
        algorithmUniqueIndices: resolvedIndices.size,
        confirmedContinuityHash,
        reinterpretedPlaceholderHash,
    }));
}

function buildStaticOutput(data: TrendChartLegacyDataPoint[]) {
    const model = buildTrendChartLegacyModel({
        widgetId: 'trend-legacy-benchmark',
        width: WIDTH,
        height: HEIGHT,
        data,
        unit: '°C',
        summary: { min: null, max: null, avg: null },
        font: CHART_FONT,
        letterSpacing: CHART_LETTER_SPACING,
    });

    return {
        domain: model.domain,
        layout: model.layout,
        points: model.points,
        paths: {
            linePath: model.linePath,
            areaPath: model.areaPath,
        },
        xLabels: model.xLabels,
        visibleLabelIndices: model.visibleLabelIndices,
        yTicks: model.yTicks,
    };
}

function buildResponse(pointCount: number, range: HistoryRange): DataHistoryResponse {
    const startMs = new Date(2026, 0, 15, 12, 0, 0, 0).getTime();
    const bucketMs = 5 * 60 * 1000;
    const series = Array.from({ length: pointCount }, (_, index) => {
        const timestampMs = startMs + (index * bucketMs);
        return {
            timestamp: new Date(timestampMs).toISOString(),
            value: 50 + (Math.sin(index / 13) * 8) + ((index % 17) * 0.1),
        };
    });

    return {
        contractVersion: '1.0.0',
        machineId: 101,
        variableKey: 'temperature',
        range,
        unit: '°C',
        series,
        summary: { last: null, min: null, max: null, avg: null },
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

async function createSha256(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function assertGolden(
    pointCount: keyof typeof GOLDENS,
    key: keyof (typeof GOLDENS)[keyof typeof GOLDENS],
    actual: string,
): void {
    const expected = GOLDENS[pointCount][key];

    if (actual !== expected) {
        throw new Error(`Legacy Trend Chart ${pointCount}-point ${key} changed: expected ${expected}, received ${actual}`);
    }
}
