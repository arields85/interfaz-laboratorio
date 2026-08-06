import { describe, expect, it } from 'vitest';

import { computeActivityAnalytics } from './activityAnalyticsComputation';
import {
    buildTrendChartV2SimulatedHistory,
} from './trendChartV2Simulation';

const NOW_MS = Date.parse('2026-06-19T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const LARGE_DAILY_CHANGE = 0.2;

const OPERATING_LEVELS = {
    stopped: 2,
    setup: 30,
    production: 80,
};

function buildHistory(range: '24h' | '7d' | '30d' | '12m') {
    return buildTrendChartV2SimulatedHistory({
        widgetId: 'trend-v2-simulated',
        machineId: 101,
        variableKey: 'temperature',
        range,
        baseValue: 50,
        operatingLevels: OPERATING_LEVELS,
        nowMs: NOW_MS,
    });
}

function resolveCompleteDailyProductionRatios(history: ReturnType<typeof buildHistory>) {
    if (!history.window) {
        throw new Error('Simulated history requires a window');
    }

    return computeActivityAnalytics({
        series: history.series,
        thresholds: { setupKw: 15, prodKw: 60 },
        range: history.range,
        groupBy: 'day',
        shifts: [],
        timezone: 'UTC',
        window: history.window,
        nowMs: NOW_MS,
    }).grouped
        .filter((bucket) => bucket.expectedDurationMs === DAY_MS && !bucket.isInProgress)
        .map((bucket) => ({
            startMs: bucket.startMs,
            ratio: bucket.productivityRatio ?? 0,
        }));
}

function resolveUtilizationShapeMetrics(ratios: number[]) {
    const changes = ratios.slice(1).map((ratio, index) => ratio - ratios[index]);
    const directions = changes
        .filter((change) => Math.abs(change) >= 0.03)
        .map((change) => Math.sign(change));
    const reversals = directions.slice(1).filter((direction, index) => direction !== directions[index]).length;
    let longestMonotonicRun = 1;
    let currentMonotonicRun = 1;
    let previousDirection = 0;

    changes.forEach((change) => {
        const direction = Math.abs(change) < 0.03 ? 0 : Math.sign(change);

        if (direction === 0) {
            currentMonotonicRun = 1;
            previousDirection = 0;
        } else if (direction === previousDirection) {
            currentMonotonicRun += 1;
        } else {
            currentMonotonicRun = 2;
            previousDirection = direction;
        }

        longestMonotonicRun = Math.max(longestMonotonicRun, currentMonotonicRun);
    });

    return {
        minimum: Math.min(...ratios),
        maximum: Math.max(...ratios),
        span: Math.max(...ratios) - Math.min(...ratios),
        largeRises: changes.filter((change) => change >= LARGE_DAILY_CHANGE).length,
        largeFalls: changes.filter((change) => change <= -LARGE_DAILY_CHANGE).length,
        reversals,
        longestMonotonicRun,
        lowEvents: ratios.filter((ratio) => ratio <= 0.2).length,
        highEvents: ratios.filter((ratio) => ratio >= 0.65).length,
        hasIsolatedShutdownRecovery: ratios.some((ratio, index) => (
            index > 0
            && index < ratios.length - 1
            && ratio <= 0.05
            && ratios[index - 1] >= 0.2
            && ratios[index + 1] >= 0.3
        )),
    };
}

describe('trendChartV2Simulation', () => {
    it('generates deterministic history for the same widget and range inputs', () => {
        const first = buildTrendChartV2SimulatedHistory({
            widgetId: 'trend-v2-simulated',
            machineId: 101,
            variableKey: 'temperature',
            range: '24h',
            baseValue: 50,
            nowMs: Date.parse('2026-06-19T00:00:00.000Z'),
        });

        const second = buildTrendChartV2SimulatedHistory({
            widgetId: 'trend-v2-simulated',
            machineId: 101,
            variableKey: 'temperature',
            range: '24h',
            baseValue: 50,
            nowMs: Date.parse('2026-06-19T00:00:00.000Z'),
        });

        expect(second).toEqual(first);
        expect(first.series.length).toBeGreaterThan(100);
    });

    it('preserves the same synthetic facts at overlapping canonical timestamps', () => {
        const shortRange = buildHistory('7d');
        const longRange = buildHistory('30d');
        const shortValuesByTimestamp = new Map(shortRange.series.map((point) => [point.timestampMs, point.value]));
        const overlappingLongRangePoints = longRange.series.filter((point) => shortValuesByTimestamp.has(point.timestampMs));

        expect(shortRange.window?.start).toBe('2026-06-12T00:00:00.000Z');
        expect(shortRange.window?.end).toBe('2026-06-19T00:00:00.000Z');
        expect(longRange.window?.start).toBe('2026-05-20T00:00:00.000Z');
        expect(longRange.window?.end).toBe('2026-06-19T00:00:00.000Z');
        expect(overlappingLongRangePoints.length).toBeGreaterThan(500);
        expect(overlappingLongRangePoints.every((point) => shortValuesByTimestamp.get(point.timestampMs) === point.value)).toBe(true);

        const shortDailyRatios = resolveCompleteDailyProductionRatios(shortRange);
        const longDailyRatios = new Map(resolveCompleteDailyProductionRatios(longRange).map((day) => [day.startMs, day.ratio]));
        const cadenceTolerance = ((longRange.window?.bucketMs ?? 0) * 4) / DAY_MS;

        expect(shortDailyRatios).toHaveLength(7);
        expect(shortDailyRatios.every((day) => (
            Math.abs(day.ratio - (longDailyRatios.get(day.startMs) ?? Number.POSITIVE_INFINITY)) <= cadenceTolerance
        ))).toBe(true);
    });

    it('models correlated operating phases with setup, production, stops, and microstops', () => {
        const history = buildHistory('7d');
        const states = history.series.map((point) => {
            if ((point.value ?? 0) >= 60) return 'production';
            if ((point.value ?? 0) >= 15) return 'setup';
            return 'stopped';
        });
        const hasProductionMicrostop = states.some((state, index) => {
            if (state !== 'production') return false;

            const nextProductionOffset = states.slice(index + 1, index + 6).findIndex((nextState) => nextState === 'production');
            return nextProductionOffset > 0
                && states.slice(index + 1, index + nextProductionOffset + 1).every((nextState) => nextState === 'stopped');
        });
        const productionValues = history.series
            .filter((point) => (point.value ?? 0) >= 60)
            .map((point) => point.value ?? 0);
        const largestAdjacentProductionChange = productionValues.slice(1).reduce(
            (largest, value, index) => Math.max(largest, Math.abs(value - productionValues[index])),
            0,
        );

        expect(new Set(states)).toEqual(new Set(['stopped', 'setup', 'production']));
        expect(hasProductionMicrostop).toBe(true);
        expect(largestAdjacentProductionChange).toBeLessThan(12);
    });

    it('creates irregular analytics-derived daily utilization over 30 days and 7 days', () => {
        const thirtyDayRatios = resolveCompleteDailyProductionRatios(buildHistory('30d')).map((day) => day.ratio);
        const sevenDayRatios = resolveCompleteDailyProductionRatios(buildHistory('7d')).map((day) => day.ratio);
        const thirtyDayMetrics = resolveUtilizationShapeMetrics(thirtyDayRatios);
        const sevenDayMetrics = resolveUtilizationShapeMetrics(sevenDayRatios);

        console.info('PROD_TREND_SIMULATION_EVIDENCE', JSON.stringify({ thirtyDayMetrics, sevenDayMetrics }));

        expect(thirtyDayRatios).toHaveLength(30);
        expect(thirtyDayMetrics.largeRises).toBeGreaterThanOrEqual(4);
        expect(thirtyDayMetrics.largeFalls).toBeGreaterThanOrEqual(4);
        expect(thirtyDayMetrics.reversals).toBeGreaterThanOrEqual(8);
        expect(thirtyDayMetrics.lowEvents).toBeGreaterThanOrEqual(5);
        expect(thirtyDayMetrics.highEvents).toBeGreaterThanOrEqual(5);
        expect(thirtyDayMetrics.longestMonotonicRun).toBeLessThanOrEqual(4);
        expect(thirtyDayMetrics.hasIsolatedShutdownRecovery).toBe(true);

        expect(sevenDayRatios).toHaveLength(7);
        expect(sevenDayMetrics.span).toBeGreaterThanOrEqual(0.35);
        expect(sevenDayMetrics.largeRises).toBeGreaterThanOrEqual(1);
        expect(sevenDayMetrics.largeFalls).toBeGreaterThanOrEqual(1);
    });

    it('bounds annual history while retaining regular analytics coverage', () => {
        const annual = buildHistory('12m');

        expect(annual.series.length).toBeGreaterThan(4_000);
        expect(annual.series.length).toBeLessThanOrEqual(6_002);
        expect(annual.series[0].timestamp).toBe(annual.window.start);
        expect(annual.series.at(-1)?.timestamp).toBe(annual.window.end);
        expect(annual.series.slice(1).every((point, index) => (
            point.timestampMs - annual.series[index].timestampMs <= annual.window.bucketMs
        ))).toBe(true);
        expect(new Set(annual.series.map((point) => point.value)).size).toBeGreaterThan(20);
    });

    it('supports custom windows and stable seed inputs without raw randomness drift', () => {
        const custom = buildTrendChartV2SimulatedHistory({
            widgetId: 'trend-v2-simulated',
            machineId: 101,
            variableKey: 'temperature',
            range: 'custom',
            customWindow: {
                start: '2026-06-18T08:00:00.000Z',
                end: '2026-06-18T12:00:00.000Z',
            },
            baseValue: 50,
            operatingLevels: OPERATING_LEVELS,
            nowMs: NOW_MS,
        });

        expect(custom.window).toEqual({
            start: '2026-06-18T08:00:00.000Z',
            end: '2026-06-18T12:00:00.000Z',
            bucketMs: 5 * 60 * 1000,
        });
        expect(custom.series[0].timestamp).toBe('2026-06-18T08:00:00.000Z');
        expect(custom.series.at(-1)?.timestamp).toBe('2026-06-18T12:00:00.000Z');
        expect(custom.summary.last).not.toBeNull();
    });
});
