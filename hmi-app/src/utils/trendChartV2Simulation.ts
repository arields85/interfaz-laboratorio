import type { DataHistoryResponseV2, HistoryRangeV2 } from '../domain/dataContract.types';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const BASE_CADENCE_MS = 5 * MINUTE_MS;
const MAX_CANONICAL_INTERVALS = 5_999;

// Durations and smooth plateaus model patterns observed in genuine minute-level history; no captured values are embedded.

const RANGE_DURATION_MS: Record<Exclude<HistoryRangeV2, 'custom'>, number> = {
    '1h': 60 * MINUTE_MS,
    '24h': DAY_MS,
    '7d': 7 * DAY_MS,
    '30d': 30 * DAY_MS,
    '12m': 365 * DAY_MS,
};

type SimulationPhase = 'stopped' | 'setup' | 'production' | 'microstop';
type OperatingLoadRegime = 'shutdown' | 'low' | 'normal' | 'high';

const OPERATING_EPOCH_DAYS = 28;
const OPERATING_EPOCH_DISTRIBUTION: OperatingLoadRegime[] = [
    'shutdown', 'shutdown', 'shutdown',
    'low', 'low', 'low', 'low', 'low', 'low', 'low',
    'normal', 'normal', 'normal', 'normal', 'normal', 'normal', 'normal', 'normal', 'normal',
    'high', 'high', 'high', 'high', 'high', 'high', 'high', 'high', 'high',
];
const FALLBACK_IRREGULAR_EPOCH: OperatingLoadRegime[] = [
    'normal', 'high', 'low', 'normal', 'shutdown', 'high', 'low',
    'high', 'normal', 'low', 'high', 'normal', 'shutdown', 'high',
    'low', 'normal', 'high', 'low', 'normal', 'high', 'normal',
    'shutdown', 'normal', 'high', 'low', 'normal', 'high', 'low',
];

interface SimulatedOperatingLevels {
    stopped: number;
    setup: number;
    production: number;
}

interface TrendChartV2SimulatedHistoryOptions {
    widgetId: string;
    machineId?: number;
    variableKey?: string;
    range: HistoryRangeV2;
    customWindow?: {
        start: string;
        end: string;
    };
    baseValue: number;
    operatingLevels?: SimulatedOperatingLevels;
    nowMs?: number;
}

interface OperatingBlock {
    setupStartMinute: number;
    productionStartMinute: number;
    productionEndMinute: number;
}

interface DailyOperatingPlan {
    blocks: OperatingBlock[];
    microstops: Array<{ startMinute: number; endMinute: number }>;
}

interface SimulationPlanningContext {
    dailyPlans: Map<number, DailyOperatingPlan>;
    epochPlans: Map<number, OperatingLoadRegime[]>;
}

const DEFAULT_SIMULATED_NOW_MS = Date.parse('2026-01-01T12:00:00.000Z');

export function resolveTrendChartV2SimulationPointCount(range: HistoryRangeV2): number {
    const durationMs = range === 'custom' ? RANGE_DURATION_MS['24h'] : RANGE_DURATION_MS[range];
    return Math.floor(durationMs / resolveSimulationCadenceMs(durationMs)) + 1;
}

export function buildTrendChartV2SimulatedHistory({
    widgetId,
    machineId,
    variableKey,
    range,
    customWindow,
    baseValue,
    operatingLevels,
    nowMs = resolveTrendChartV2SimulatedNowMs({ range, customWindow }),
}: TrendChartV2SimulatedHistoryOptions): DataHistoryResponseV2 {
    const window = resolveSimulationWindow(range, customWindow, nowMs);
    const durationMs = window.endMs - window.startMs;
    const bucketMs = resolveSimulationCadenceMs(durationMs);
    const identitySeed = hashSeed(`${widgetId}|${machineId ?? 'na'}|${variableKey ?? 'na'}`);
    const levels = resolveOperatingLevels(baseValue, operatingLevels);
    const timestamps = buildCanonicalTimestamps(window.startMs, window.endMs, bucketMs);
    const planningContext: SimulationPlanningContext = {
        dailyPlans: new Map(),
        epochPlans: new Map(),
    };
    const series = timestamps.map((timestampMs) => ({
        timestamp: new Date(timestampMs).toISOString(),
        timestampMs,
        value: resolveSyntheticValue(timestampMs, identitySeed, levels, planningContext),
    }));
    const values = series.map((point) => point.value);

    return {
        contractVersion: 'simulated-v2',
        machineId: machineId ?? 0,
        variableKey: variableKey ?? 'simulated',
        range,
        unit: null,
        window: {
            start: window.start,
            end: window.end,
            bucketMs,
        },
        series,
        summary: {
            last: values.at(-1) ?? null,
            min: values.length > 0 ? Math.min(...values) : null,
            max: values.length > 0 ? Math.max(...values) : null,
            avg: values.length > 0 ? roundToTwoDecimals(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
        },
    };
}

export function resolveTrendChartV2SimulatedNowMs({
    range,
    customWindow,
    nowMs,
}: Pick<TrendChartV2SimulatedHistoryOptions, 'range' | 'customWindow' | 'nowMs'>): number {
    if (typeof nowMs === 'number' && Number.isFinite(nowMs)) {
        return nowMs;
    }

    if (range === 'custom' && customWindow) {
        const endMs = Date.parse(customWindow.end);

        if (Number.isFinite(endMs)) {
            return endMs;
        }
    }

    return DEFAULT_SIMULATED_NOW_MS;
}

function resolveSimulationCadenceMs(durationMs: number): number {
    const minimumCadenceMs = Math.ceil(durationMs / MAX_CANONICAL_INTERVALS);
    return Math.max(BASE_CADENCE_MS, Math.ceil(minimumCadenceMs / BASE_CADENCE_MS) * BASE_CADENCE_MS);
}

function buildCanonicalTimestamps(startMs: number, endMs: number, cadenceMs: number): number[] {
    const timestamps = new Set<number>([startMs, endMs]);
    const firstCanonicalTimestampMs = Math.ceil(startMs / cadenceMs) * cadenceMs;

    for (let timestampMs = firstCanonicalTimestampMs; timestampMs <= endMs; timestampMs += cadenceMs) {
        timestamps.add(timestampMs);
    }

    return [...timestamps].sort((left, right) => left - right);
}

function resolveSyntheticValue(
    timestampMs: number,
    identitySeed: number,
    levels: SimulatedOperatingLevels,
    planningContext: SimulationPlanningContext,
): number {
    const phase = resolveSimulationPhase(timestampMs, identitySeed, planningContext);
    const target = phase === 'production'
        ? levels.production
        : phase === 'setup'
            ? levels.setup
            : levels.stopped;
    const operatingSpan = Math.max(Math.abs(levels.production - levels.stopped), Math.abs(levels.production) * 0.1, 1);
    const spread = phase === 'production'
        ? operatingSpan * 0.035
        : phase === 'setup'
            ? operatingSpan * 0.025
            : operatingSpan * 0.004;
    const shortDrift = resolveInterpolatedNoise(timestampMs, 30 * MINUTE_MS, identitySeed, 'short');
    const longDrift = resolveInterpolatedNoise(timestampMs, 4 * 60 * MINUTE_MS, identitySeed, 'long');
    const value = target + (spread * ((shortDrift * 0.72) + (longDrift * 0.28)));
    const boundedValue = levels.stopped >= 0 && levels.setup >= 0 && levels.production >= 0
        ? Math.max(0, value)
        : value;

    return roundToTwoDecimals(boundedValue);
}

function resolveSimulationPhase(
    timestampMs: number,
    identitySeed: number,
    planningContext: SimulationPlanningContext,
): SimulationPhase {
    const dayIndex = Math.floor(timestampMs / DAY_MS);
    const minuteOfDay = (timestampMs - (dayIndex * DAY_MS)) / MINUTE_MS;
    let plan = planningContext.dailyPlans.get(dayIndex);

    if (!plan) {
        plan = buildDailyOperatingPlan(dayIndex, identitySeed, planningContext);
        planningContext.dailyPlans.set(dayIndex, plan);
    }

    const activeBlock = plan.blocks.find((block) => (
        minuteOfDay >= block.setupStartMinute && minuteOfDay < block.productionEndMinute
    ));

    if (!activeBlock) {
        return 'stopped';
    }

    if (minuteOfDay < activeBlock.productionStartMinute) {
        return 'setup';
    }

    if (plan.microstops.some((microstop) => (
        minuteOfDay >= microstop.startMinute && minuteOfDay < microstop.endMinute
    ))) {
        return 'microstop';
    }

    return 'production';
}

function buildDailyOperatingPlan(
    dayIndex: number,
    identitySeed: number,
    planningContext: SimulationPlanningContext,
): DailyOperatingPlan {
    const random = createMulberry32(hashSeed(`${identitySeed}|day|${dayIndex}`));
    const regime = resolveOperatingLoadRegime(dayIndex, identitySeed, planningContext);
    const blocks = buildOperatingBlocks(regime, random);
    const microstops = blocks.flatMap((block, index) => buildMicrostops(
        block.productionStartMinute,
        block.productionEndMinute,
        resolveMicrostopCount(regime, block, index),
        random,
    ));

    return {
        blocks,
        microstops,
    };
}

function resolveOperatingLoadRegime(
    dayIndex: number,
    identitySeed: number,
    planningContext: SimulationPlanningContext,
): OperatingLoadRegime {
    const epochIndex = Math.floor(dayIndex / OPERATING_EPOCH_DAYS);
    const epochDayIndex = ((dayIndex % OPERATING_EPOCH_DAYS) + OPERATING_EPOCH_DAYS) % OPERATING_EPOCH_DAYS;
    let epochPlan = planningContext.epochPlans.get(epochIndex);

    if (!epochPlan) {
        epochPlan = buildOperatingEpochPlan(epochIndex, identitySeed);
        planningContext.epochPlans.set(epochIndex, epochPlan);
    }

    return epochPlan[epochDayIndex] ?? 'normal';
}

function buildOperatingEpochPlan(epochIndex: number, identitySeed: number): OperatingLoadRegime[] {
    const firstRegime = resolveEpochBoundaryRegime(epochIndex, identitySeed);
    const nextEpochFirstRegime = resolveEpochBoundaryRegime(epochIndex + 1, identitySeed);

    for (let attempt = 0; attempt < 128; attempt += 1) {
        const random = createMulberry32(hashSeed(`${identitySeed}|epoch|${epochIndex}|attempt|${attempt}`));
        const candidate = buildMixedRegimeCandidate(random);
        moveRegimeToPosition(candidate, firstRegime, 0);

        if (candidate.at(-1) === nextEpochFirstRegime || candidate.at(-1) === 'shutdown') {
            const replacementIndex = candidate.findIndex((regime, index) => (
                index > 0
                && index < candidate.length - 1
                && regime !== nextEpochFirstRegime
                && regime !== 'shutdown'
            ));

            if (replacementIndex > 0) {
                swap(candidate, replacementIndex, candidate.length - 1);
            }
        }

        if (isIrregularEpochPlan(candidate, nextEpochFirstRegime)) {
            return candidate;
        }
    }

    const fallback = [...FALLBACK_IRREGULAR_EPOCH];
    const fallbackVariant = hashSeed(`${identitySeed}|fallback|${epochIndex}`);
    const variedFallback = fallbackVariant % 2 === 0 ? fallback : fallback.reverse();

    return fallbackVariant % 4 < 2
        ? variedFallback
        : variedFallback.map((regime) => regime === 'low' ? 'high' : regime === 'high' ? 'low' : regime);
}

function resolveEpochBoundaryRegime(epochIndex: number, identitySeed: number): Exclude<OperatingLoadRegime, 'shutdown'> {
    const regimes: Array<Exclude<OperatingLoadRegime, 'shutdown'>> = ['low', 'normal', 'high'];
    return regimes[hashSeed(`${identitySeed}|boundary|${epochIndex}`) % regimes.length] ?? 'normal';
}

function shuffleRegimes(regimes: OperatingLoadRegime[], random: () => number): OperatingLoadRegime[] {
    const shuffled = [...regimes];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        swap(shuffled, index, Math.floor(random() * (index + 1)));
    }

    return shuffled;
}

function buildMixedRegimeCandidate(random: () => number): OperatingLoadRegime[] {
    const nonShutdownRegimes = shuffleRegimes(
        OPERATING_EPOCH_DISTRIBUTION.filter((regime) => regime !== 'shutdown'),
        random,
    );
    const shutdownPositions = new Set([
        2 + Math.floor(random() * 4),
        10 + Math.floor(random() * 5),
        20 + Math.floor(random() * 4),
    ]);
    let nonShutdownIndex = 0;

    return Array.from({ length: OPERATING_EPOCH_DAYS }, (_, index) => {
        if (shutdownPositions.has(index)) return 'shutdown';

        const regime = nonShutdownRegimes[nonShutdownIndex] ?? 'normal';
        nonShutdownIndex += 1;
        return regime;
    });
}

function moveRegimeToPosition(regimes: OperatingLoadRegime[], regime: OperatingLoadRegime, targetIndex: number): void {
    const sourceIndex = regimes.findIndex((candidate, index) => index !== targetIndex && candidate === regime);

    if (sourceIndex >= 0) {
        swap(regimes, sourceIndex, targetIndex);
    }
}

function swap<T>(values: T[], leftIndex: number, rightIndex: number): void {
    const leftValue = values[leftIndex];
    values[leftIndex] = values[rightIndex];
    values[rightIndex] = leftValue;
}

function isIrregularEpochPlan(plan: OperatingLoadRegime[], nextEpochFirstRegime: OperatingLoadRegime): boolean {
    const scores = plan.map(resolveRegimeScore);
    const changes = scores.slice(1).map((score, index) => score - scores[index]);
    const directions = changes.filter((change) => change !== 0).map(Math.sign);
    const reversals = directions.slice(1).filter((direction, index) => direction !== directions[index]).length;
    const longestMonotonicRun = resolveLongestMonotonicRun(changes);
    const hasAdjacentShutdowns = plan.some((regime, index) => regime === 'shutdown' && plan[index - 1] === 'shutdown');
    const hasWeakShutdownRecovery = plan.some((regime, index) => (
        regime === 'shutdown'
        && (resolveRegimeScore(plan[index - 1] ?? 'shutdown') < 0.5 || resolveRegimeScore(plan[index + 1] ?? 'shutdown') < 0.5)
    ));
    const hasWeakSevenDayWindow = scores.some((_, startIndex) => {
        const window = scores.slice(startIndex, startIndex + 7);

        if (window.length < 7) return false;

        const windowChanges = window.slice(1).map((score, index) => score - window[index]);
        return Math.max(...window) - Math.min(...window) < 0.45
            || !windowChanges.some((change) => change >= 0.2)
            || !windowChanges.some((change) => change <= -0.2);
    });

    return plan.length === OPERATING_EPOCH_DAYS
        && plan[0] !== 'shutdown'
        && plan.at(-1) !== 'shutdown'
        && plan.at(-1) !== nextEpochFirstRegime
        && !hasAdjacentShutdowns
        && !hasWeakShutdownRecovery
        && !hasWeakSevenDayWindow
        && changes.filter((change) => change >= 0.2).length >= 5
        && changes.filter((change) => change <= -0.2).length >= 5
        && reversals >= 10
        && longestMonotonicRun <= 4;
}

function resolveLongestMonotonicRun(changes: number[]): number {
    let longestRun = 1;
    let currentRun = 1;
    let previousDirection = 0;

    changes.forEach((change) => {
        const direction = Math.sign(change);

        if (direction === 0) {
            currentRun = 1;
            previousDirection = 0;
        } else if (direction === previousDirection) {
            currentRun += 1;
        } else {
            currentRun = 2;
            previousDirection = direction;
        }

        longestRun = Math.max(longestRun, currentRun);
    });

    return longestRun;
}

function resolveRegimeScore(regime: OperatingLoadRegime): number {
    if (regime === 'shutdown') return 0;
    if (regime === 'low') return 0.18;
    if (regime === 'normal') return 0.5;
    return 0.78;
}

function buildOperatingBlocks(regime: OperatingLoadRegime, random: () => number): OperatingBlock[] {
    if (regime === 'shutdown') {
        return [];
    }

    const targetUtilization = regime === 'low'
        ? 0.06 + (random() * 0.14)
        : regime === 'normal'
            ? 0.46 + (random() * 0.08)
            : 0.78 + (random() * 0.06);
    const runCount = regime === 'low'
        ? 1 + Math.floor(random() * 2)
        : regime === 'normal'
            ? 2 + Math.floor(random() * 3)
            : 3 + Math.floor(random() * 3);
    const productionDurations = partitionDuration(targetUtilization * 24 * 60, runCount, random);
    const setupDurations = Array.from({ length: runCount }, () => (
        regime === 'high'
            ? 10 + Math.floor(random() * 11)
            : 15 + Math.floor(random() * 21)
    ));
    const totalSetupMinutes = setupDurations.reduce((sum, duration) => sum + duration, 0);
    const totalProductionMinutes = productionDurations.reduce((sum, duration) => sum + duration, 0);
    const idleDurations = partitionDuration(
        Math.max(0, (24 * 60) - totalSetupMinutes - totalProductionMinutes),
        runCount + 1,
        random,
    );
    const blocks: OperatingBlock[] = [];
    let cursorMinute = idleDurations[0] ?? 0;

    for (let index = 0; index < runCount; index += 1) {
        const setupStartMinute = cursorMinute;
        const productionStartMinute = setupStartMinute + (setupDurations[index] ?? 0);
        const productionEndMinute = productionStartMinute + (productionDurations[index] ?? 0);
        blocks.push({ setupStartMinute, productionStartMinute, productionEndMinute });
        cursorMinute = productionEndMinute + (idleDurations[index + 1] ?? 0);
    }

    return blocks;
}

function partitionDuration(totalMinutes: number, partCount: number, random: () => number): number[] {
    const weights = Array.from({ length: partCount }, () => 0.65 + (random() * 0.7));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map((weight) => totalMinutes * (weight / totalWeight));
}

function resolveMicrostopCount(regime: OperatingLoadRegime, block: OperatingBlock, blockIndex: number): number {
    if (regime === 'shutdown') return 0;

    const durationMinutes = block.productionEndMinute - block.productionStartMinute;
    if (durationMinutes < 75) return 0;

    return regime === 'low' || durationMinutes < 210 || blockIndex % 2 === 1 ? 1 : 2;
}

function buildMicrostops(
    productionStartMinute: number,
    productionEndMinute: number,
    count: number,
    random: () => number,
): Array<{ startMinute: number; endMinute: number }> {
    const durationMinutes = productionEndMinute - productionStartMinute;

    return Array.from({ length: count }, (_, index) => {
        const centerFraction = (index + 1) / (count + 1);
        const jitterMinutes = (random() - 0.5) * Math.min(durationMinutes * 0.08, 24);
        const startMinute = productionStartMinute + (durationMinutes * centerFraction) + jitterMinutes;
        const microstopDurationMinutes = (1 + Math.floor(random() * 3)) * 5;

        return {
            startMinute,
            endMinute: Math.min(startMinute + microstopDurationMinutes, productionEndMinute),
        };
    });
}

function resolveInterpolatedNoise(
    timestampMs: number,
    periodMs: number,
    identitySeed: number,
    stream: string,
): number {
    const anchorIndex = Math.floor(timestampMs / periodMs);
    const progress = (timestampMs - (anchorIndex * periodMs)) / periodMs;
    const smoothProgress = progress * progress * (3 - (2 * progress));
    const startNoise = resolveSeededNoise(identitySeed, stream, anchorIndex);
    const endNoise = resolveSeededNoise(identitySeed, stream, anchorIndex + 1);

    return startNoise + ((endNoise - startNoise) * smoothProgress);
}

function resolveSeededNoise(identitySeed: number, stream: string, anchorIndex: number): number {
    return (hashSeed(`${identitySeed}|${stream}|${anchorIndex}`) / 4294967295) * 2 - 1;
}

function resolveOperatingLevels(baseValue: number, operatingLevels: SimulatedOperatingLevels | undefined): SimulatedOperatingLevels {
    if (operatingLevels && Object.values(operatingLevels).every((value) => Number.isFinite(value))) {
        return operatingLevels;
    }

    const normalizedBaseValue = Number.isFinite(baseValue) ? baseValue : 0;
    return {
        stopped: normalizedBaseValue * 0.08,
        setup: normalizedBaseValue * 0.72,
        production: normalizedBaseValue * 1.2,
    };
}

function resolveSimulationWindow(range: HistoryRangeV2, customWindow: TrendChartV2SimulatedHistoryOptions['customWindow'], nowMs: number) {
    if (range === 'custom' && customWindow) {
        const startMs = Date.parse(customWindow.start);
        const endMs = Date.parse(customWindow.end);

        if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
            return {
                startMs,
                endMs,
                start: new Date(startMs).toISOString(),
                end: new Date(endMs).toISOString(),
            };
        }
    }

    const durationMs = range === 'custom' ? RANGE_DURATION_MS['24h'] : RANGE_DURATION_MS[range];
    const startMs = nowMs - durationMs;
    const endMs = nowMs;

    return {
        startMs,
        endMs,
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
    };
}

function createMulberry32(seed: number): () => number {
    let current = seed >>> 0;

    return () => {
        current += 0x6D2B79F5;
        let t = current;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hashSeed(value: string): number {
    let hash = 2166136261;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
}

function roundToTwoDecimals(value: number): number {
    return Math.round(value * 100) / 100;
}
