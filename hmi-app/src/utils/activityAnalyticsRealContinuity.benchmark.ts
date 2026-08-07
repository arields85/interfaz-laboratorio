import type { ShiftDefinition } from '../domain/admin.types';
import type { ActivityAnalyticsRange, ActivityAnalyticsWindow } from '../domain/activityAnalytics.types';
import { buildActivityAnalytics } from './activityAnalytics';
import {
    deriveComputedActivityAnalytics,
    groupBuiltActivityAnalytics,
} from './activityAnalyticsComputation';
import { buildActivityAnalyticsSimulatedHistory } from './activityAnalyticsSimulation';

const ITERATIONS = 7;
const NOW_MS = Date.parse('2026-06-19T12:00:00.000Z');
const MODES = ['pre', 'post'] as const;
const SHIFTS: ShiftDefinition[] = [
    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
    { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
];
const THRESHOLDS = { setupKw: 3, prodKw: 8 };

const sevenDayHistory = buildHistory('7d');
const thirtyDayHistory = buildHistory('30d');
const sevenDayWindow = requireWindow(sevenDayHistory.window, '7d');
const thirtyDayWindow = requireWindow(thirtyDayHistory.window, '30d');
const confirmedSevenDayBase = buildActivityAnalytics({
    series: sevenDayHistory.series,
    bucketMs: sevenDayWindow.bucketMs,
    thresholds: THRESHOLDS,
});

for (const mode of MODES) {
    runTransition(mode);
    const samplesMs = Array.from({ length: ITERATIONS }, () => {
        const startedAt = performance.now();
        runTransition(mode);
        return performance.now() - startedAt;
    });
    const sortedSamples = [...samplesMs].sort((left, right) => left - right);
    const meanMs = samplesMs.reduce((sum, sample) => sum + sample, 0) / ITERATIONS;
    const p95Index = Math.min(sortedSamples.length - 1, Math.ceil(sortedSamples.length * 0.95) - 1);

    console.log(JSON.stringify({
        mode,
        sequence: 'confirmed 7d -> request 30d with 7d placeholder -> final 30d',
        iterations: ITERATIONS,
        warmupIterations: 1,
        samplesMs: samplesMs.map((sample) => Number(sample.toFixed(3))),
        medianMs: Number((sortedSamples[Math.floor(ITERATIONS / 2)] ?? 0).toFixed(3)),
        meanMs: Number(meanMs.toFixed(3)),
        p95Ms: Number((sortedSamples[p95Index] ?? 0).toFixed(3)),
        invocationsPerTransition: {
            buildBase: 1,
            group: mode === 'pre' ? 2 : 1,
            derive: mode === 'pre' ? 2 : 1,
        },
        confirmedPoints: sevenDayHistory.series.length,
        finalPoints: thirtyDayHistory.series.length,
        placeholderPointsProcessed: mode === 'pre' ? confirmedSevenDayBase.intervals.length : 0,
    }));
}

function runTransition(mode: typeof MODES[number]): void {
    if (mode === 'pre') {
        processGroupedAnalytics(confirmedSevenDayBase, '30d', sevenDayWindow);
    }

    const finalBase = buildActivityAnalytics({
        series: thirtyDayHistory.series,
        bucketMs: thirtyDayWindow.bucketMs,
        thresholds: THRESHOLDS,
    });
    processGroupedAnalytics(finalBase, '30d', thirtyDayWindow);
}

function processGroupedAnalytics(
    analytics: ReturnType<typeof buildActivityAnalytics>,
    range: ActivityAnalyticsRange,
    window: Pick<ActivityAnalyticsWindow, 'start' | 'end' | 'bucketMs'>,
): void {
    deriveComputedActivityAnalytics(groupBuiltActivityAnalytics({
        analytics,
        range,
        groupBy: 'shift',
        shifts: SHIFTS,
        timezone: 'UTC',
        window,
        nowMs: NOW_MS,
    }));
}

function buildHistory(range: Extract<ActivityAnalyticsRange, '7d' | '30d'>) {
    return buildActivityAnalyticsSimulatedHistory({
        widgetId: `real-continuity-${range}`,
        machineId: 101,
        variableKey: 'Total kW',
        range,
        baseValue: 5,
        operatingLevels: {
            stopped: 0.5,
            setup: 5,
            production: 10,
        },
        nowMs: NOW_MS,
    });
}

function requireWindow(
    window: Partial<ActivityAnalyticsWindow> | undefined,
    range: ActivityAnalyticsRange,
): Pick<ActivityAnalyticsWindow, 'start' | 'end' | 'bucketMs'> {
    if (!window?.start || !window.end || typeof window.bucketMs !== 'number') {
        throw new Error(`Missing Real continuity benchmark window for ${range}`);
    }

    return {
        start: window.start,
        end: window.end,
        bucketMs: window.bucketMs,
    };
}
