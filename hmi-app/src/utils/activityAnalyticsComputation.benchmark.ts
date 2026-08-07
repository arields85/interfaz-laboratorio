import type { ShiftDefinition } from '../domain/admin.types';
import type { ActivityAnalyticsGroupBy, ActivityAnalyticsRange } from '../domain/activityAnalytics.types';
import { computeActivityAnalytics } from './activityAnalyticsComputation';
import { buildActivityAnalyticsSimulatedHistory } from './activityAnalyticsSimulation';

const ITERATIONS = 7;
const DEFAULT_NOW_MS = Date.parse('2026-06-19T12:00:00.000Z');
const SHIFTS: ShiftDefinition[] = [
    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
    { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
];
const SCENARIOS: Array<{
    name: string;
    range: ActivityAnalyticsRange;
    groupBy: ActivityAnalyticsGroupBy;
    timezone: string;
    nowMs: number;
    expectedOutputHash: string;
}> = [
    { name: '7d/day', range: '7d', groupBy: 'day', timezone: 'UTC', nowMs: DEFAULT_NOW_MS, expectedOutputHash: '9736bb75578e37352e769244fcf76a54c1d0d86cb7b16fcd33b4d2d18fb5068b' },
    { name: '30d/week', range: '30d', groupBy: 'week', timezone: 'UTC', nowMs: DEFAULT_NOW_MS, expectedOutputHash: '818b6162750795deb66a2ff70208223066a2d82f610fe96ed0a0c8cfdc9156e6' },
    { name: '12m/month', range: '12m', groupBy: 'month', timezone: 'UTC', nowMs: DEFAULT_NOW_MS, expectedOutputHash: '3dcf26378f8538e4b6eb689caf2656dfd8cdd550dfd9b4a4a9d227d3ed5b9d98' },
    { name: '7d/day DST forward', range: '7d', groupBy: 'day', timezone: 'America/New_York', nowMs: Date.parse('2026-03-10T12:00:00.000Z'), expectedOutputHash: '3f4797575abe0daa4efb766f255acc6c4cf5c60e8acaa93ffae3282996c0096b' },
    { name: '7d/day DST backward', range: '7d', groupBy: 'day', timezone: 'America/New_York', nowMs: Date.parse('2026-11-03T12:00:00.000Z'), expectedOutputHash: 'ffc358277aee0e62f7ab3acc546cace07b40210b402f3c637a49157f9719ba5d' },
    { name: '7d/shift', range: '7d', groupBy: 'shift', timezone: 'UTC', nowMs: DEFAULT_NOW_MS, expectedOutputHash: 'f99f83395e04f3d20471334df019ff73441a2e70a58ed18dfd8bb904cec77ad1' },
    { name: '30d/shift', range: '30d', groupBy: 'shift', timezone: 'UTC', nowMs: DEFAULT_NOW_MS, expectedOutputHash: '26d883063aa4c3f85344af39d7129561ed363c3a40de975d474dd0da97f824f7' },
    { name: '12m/shift', range: '12m', groupBy: 'shift', timezone: 'UTC', nowMs: DEFAULT_NOW_MS, expectedOutputHash: 'b400b3e21f993fe8a3b761eb119c6ad8594b9398de7aca4a99250826e200f51b' },
];

for (const scenario of SCENARIOS) {
    const history = buildActivityAnalyticsSimulatedHistory({
        widgetId: 'stage1-benchmark',
        machineId: 101,
        variableKey: 'Total kW',
        range: scenario.range,
        baseValue: 5,
        operatingLevels: {
            stopped: 0.5,
            setup: 5,
            production: 10,
        },
        nowMs: scenario.nowMs,
    });
    const window = history.window;

    if (!window?.start || !window.end || typeof window.bucketMs !== 'number') {
        throw new Error(`Missing benchmark window for ${scenario.range}/${scenario.groupBy}`);
    }

    const benchmarkWindow = {
        start: window.start,
        end: window.end,
        bucketMs: window.bucketMs,
    };

    const run = () => computeActivityAnalytics({
        series: history.series,
        thresholds: { setupKw: 3, prodKw: 8 },
        range: scenario.range,
        groupBy: scenario.groupBy,
        shifts: SHIFTS,
        timezone: scenario.timezone,
        window: benchmarkWindow,
        nowMs: scenario.nowMs,
    });

    const warmupResult = run();

    const samplesMs: number[] = [];
    const outputHashes: string[] = [];

    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
        const startedAt = performance.now();
        const result = run();
        samplesMs.push(performance.now() - startedAt);
        outputHashes.push(await createSha256(JSON.stringify(result)));
    }

    if (outputHashes.some((outputHash) => outputHash !== scenario.expectedOutputHash)) {
        throw new Error(JSON.stringify({
            range: scenario.range,
            groupBy: scenario.groupBy,
            expectedOutputHash: scenario.expectedOutputHash,
            outputHashes,
        }));
    }

    const sortedSamples = [...samplesMs].sort((left, right) => left - right);
    const meanMs = samplesMs.reduce((sum, sample) => sum + sample, 0) / ITERATIONS;
    const p95Index = Math.min(sortedSamples.length - 1, Math.ceil(sortedSamples.length * 0.95) - 1);

    console.log(JSON.stringify({
        name: scenario.name,
        range: scenario.range,
        groupBy: scenario.groupBy,
        timezone: scenario.timezone,
        points: history.series.length,
        bucketCount: warmupResult.grouped.length,
        iterations: ITERATIONS,
        warmupIterations: 1,
        samplesMs: samplesMs.map((sample) => Number(sample.toFixed(3))),
        medianMs: Number((sortedSamples[Math.floor(ITERATIONS / 2)] ?? 0).toFixed(3)),
        meanMs: Number(meanMs.toFixed(3)),
        p95Ms: Number((sortedSamples[p95Index] ?? 0).toFixed(3)),
        expectedOutputHash: scenario.expectedOutputHash,
        outputHashes,
    }));
}

async function createSha256(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));

    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
