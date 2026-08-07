import type { ShiftDefinition } from '../domain/admin.types';
import type { ActivityAnalyticsGroupBy, ActivityAnalyticsRange, ActivityAnalyticsWindow } from '../domain/activityAnalytics.types';
import { buildActivityAnalytics } from './activityAnalytics';
import {
    computeActivityAnalytics,
    deriveComputedActivityAnalytics,
    groupBuiltActivityAnalytics,
} from './activityAnalyticsComputation';
import { buildActivityAnalyticsSimulatedHistory } from './activityAnalyticsSimulation';

const ITERATIONS = 7;
const NOW_MS = Date.parse('2026-06-19T12:00:00.000Z');
const THRESHOLDS = { setupKw: 3, prodKw: 8 };
const SHIFTS: ShiftDefinition[] = [
    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
    { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
];
const SCENARIOS: Array<{ range: Extract<ActivityAnalyticsRange, '7d' | '30d' | '12m'>; groupBy: ActivityAnalyticsGroupBy }> = [
    { range: '7d', groupBy: 'day' },
    { range: '30d', groupBy: 'week' },
    { range: '12m', groupBy: 'month' },
];

for (const scenario of SCENARIOS) {
    const history = buildActivityAnalyticsSimulatedHistory({
        widgetId: `prod-trend-benchmark-${scenario.range}`,
        machineId: 101,
        variableKey: 'Total kW',
        range: scenario.range,
        baseValue: 5,
        operatingLevels: { stopped: 0.5, setup: 5, production: 10 },
        nowMs: NOW_MS,
    });
    const window = requireWindow(history.window, scenario.range);
    const monolithic = () => computeActivityAnalytics({
        series: history.series,
        thresholds: THRESHOLDS,
        range: scenario.range,
        groupBy: scenario.groupBy,
        shifts: SHIFTS,
        timezone: 'UTC',
        window,
        nowMs: NOW_MS,
    });
    const split = () => {
        const base = buildActivityAnalytics({
            series: history.series,
            bucketMs: window.bucketMs,
            thresholds: THRESHOLDS,
        });

        return deriveComputedActivityAnalytics(groupBuiltActivityAnalytics({
            analytics: base,
            range: scenario.range,
            groupBy: scenario.groupBy,
            shifts: SHIFTS,
            timezone: 'UTC',
            window,
            nowMs: NOW_MS,
        }));
    };
    const monolithicResult = monolithic();
    const splitResult = split();

    if (JSON.stringify(monolithicResult) !== JSON.stringify(splitResult)) {
        throw new Error(`PROD-TREND split pipeline output changed for ${scenario.range}/${scenario.groupBy}`);
    }

    report(`${scenario.range}/${scenario.groupBy}`, 'monolithic', history.series.length, monolithic);
    report(`${scenario.range}/${scenario.groupBy}`, 'split', history.series.length, split);
}

const groupChangeHistory = buildActivityAnalyticsSimulatedHistory({
    widgetId: 'prod-trend-benchmark-group-change',
    machineId: 101,
    variableKey: 'Total kW',
    range: '7d',
    baseValue: 5,
    operatingLevels: { stopped: 0.5, setup: 5, production: 10 },
    nowMs: NOW_MS,
});
const groupChangeWindow = requireWindow(groupChangeHistory.window, '7d');

report('7d day->shift', 'monolithic-transition', groupChangeHistory.series.length, () => {
    for (const groupBy of ['day', 'shift'] as const) {
        computeActivityAnalytics({
            series: groupChangeHistory.series,
            thresholds: THRESHOLDS,
            range: '7d',
            groupBy,
            shifts: SHIFTS,
            timezone: 'UTC',
            window: groupChangeWindow,
            nowMs: NOW_MS,
        });
    }
});

report('7d day->shift', 'split-transition', groupChangeHistory.series.length, () => {
    const base = buildActivityAnalytics({
        series: groupChangeHistory.series,
        bucketMs: groupChangeWindow.bucketMs,
        thresholds: THRESHOLDS,
    });

    for (const groupBy of ['day', 'shift'] as const) {
        deriveComputedActivityAnalytics(groupBuiltActivityAnalytics({
            analytics: base,
            range: '7d',
            groupBy,
            shifts: SHIFTS,
            timezone: 'UTC',
            window: groupChangeWindow,
            nowMs: NOW_MS,
        }));
    }
});

function report(name: string, mode: string, points: number, run: () => unknown): void {
    run();
    const samplesMs = Array.from({ length: ITERATIONS }, () => {
        const startedAt = performance.now();
        run();
        return performance.now() - startedAt;
    });
    const sorted = [...samplesMs].sort((left, right) => left - right);
    const meanMs = samplesMs.reduce((sum, sample) => sum + sample, 0) / ITERATIONS;
    const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);

    console.log(JSON.stringify({
        name,
        mode,
        points,
        iterations: ITERATIONS,
        warmupIterations: 1,
        samplesMs: samplesMs.map((sample) => Number(sample.toFixed(3))),
        medianMs: Number((sorted[Math.floor(ITERATIONS / 2)] ?? 0).toFixed(3)),
        meanMs: Number(meanMs.toFixed(3)),
        p95Ms: Number((sorted[p95Index] ?? 0).toFixed(3)),
        invocations: mode === 'monolithic-transition'
            ? { build: 2, group: 2, derive: 2 }
            : mode === 'split-transition'
                ? { build: 1, group: 2, derive: 2 }
                : { build: 1, group: 1, derive: 1 },
    }));
}

function requireWindow(
    window: Partial<ActivityAnalyticsWindow> | undefined,
    range: ActivityAnalyticsRange,
): Pick<ActivityAnalyticsWindow, 'start' | 'end' | 'bucketMs'> {
    if (!window?.start || !window.end || typeof window.bucketMs !== 'number') {
        throw new Error(`Missing PROD-TREND benchmark window for ${range}`);
    }

    return { start: window.start, end: window.end, bucketMs: window.bucketMs };
}
