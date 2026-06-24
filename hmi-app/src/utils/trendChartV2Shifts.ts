import type { ShiftDefinition, TrendChartV2ShiftDisplayMode } from '../domain/admin.types';
import type { HistoryDataPointV2 } from '../domain/dataContract.types';
import {
    buildWeeklyShiftIntervals,
    resolveWeeklyShiftAssignment,
} from './weeklyShiftSchedule';

const DAY_MS = 24 * 60 * 60 * 1000;

export type TrendChartV2ResolvedShiftDisplayMode = 'bands' | 'lines';

export const TREND_CHART_V2_SHIFT_DISPLAY_MODE_LABELS: Record<TrendChartV2ShiftDisplayMode, string> = {
    auto: 'Auto',
    bands: 'Bandas',
    lines: 'Líneas',
};

export interface TrendChartV2ShiftInterval {
    shiftId: string;
    label: string;
    startMs: number;
    endMs: number;
}

export interface TrendChartV2VisibleShiftSummary {
    shiftId: string;
    label: string;
    count: number;
    last: number;
    min: number;
    max: number;
    avg: number;
}

interface BuildTrendChartV2ShiftIntervalsOptions {
    shifts: ShiftDefinition[];
    timezone: string;
    visibleStartMs: number;
    visibleEndMs: number;
}

interface ResolveTrendChartV2ShiftDisplayModeOptions {
    displayMode: TrendChartV2ShiftDisplayMode;
    intervalCount: number;
    visibleDurationMs: number;
}

interface ResolveTrendChartV2TooltipShiftLabelOptions {
    timestampMs: number;
    shifts: ShiftDefinition[];
    timezone: string;
}

interface BuildTrendChartV2VisibleShiftSummaryOptions {
    points: HistoryDataPointV2[];
    shifts: ShiftDefinition[];
    timezone: string;
}

export function buildTrendChartV2ShiftIntervals({
    shifts,
    timezone,
    visibleStartMs,
    visibleEndMs,
}: BuildTrendChartV2ShiftIntervalsOptions): TrendChartV2ShiftInterval[] {
    if (shifts.length === 0 || visibleEndMs <= visibleStartMs) {
        return [];
    }

    return buildWeeklyShiftIntervals({
        shifts,
        timezone,
        visibleStartMs,
        visibleEndMs,
    }).map((interval) => ({
        shiftId: interval.shiftId,
        label: interval.label,
        startMs: interval.startMs,
        endMs: interval.endMs,
    }));
}

export function resolveTrendChartV2ShiftDisplayMode({
    displayMode,
    intervalCount,
    visibleDurationMs,
}: ResolveTrendChartV2ShiftDisplayModeOptions): TrendChartV2ResolvedShiftDisplayMode {
    if (displayMode !== 'auto') {
        return displayMode;
    }

    if (intervalCount > 12 || visibleDurationMs > (7 * DAY_MS)) {
        return 'lines';
    }

    return 'bands';
}

export function normalizeTrendChartV2ShiftDisplayMode(value: unknown): TrendChartV2ShiftDisplayMode {
    return value === 'bands' || value === 'lines' || value === 'auto'
        ? value
        : 'auto';
}

export function resolveTrendChartV2TooltipShiftLabel({
    timestampMs,
    shifts,
    timezone,
}: ResolveTrendChartV2TooltipShiftLabelOptions): string | null {
    const assignment = resolveWeeklyShiftAssignment({ timestampMs, shifts, timezone });
    return `${formatTrendChartV2ShiftDate(assignment.startMs, timezone)} · ${assignment.label}`;
}

export function buildTrendChartV2VisibleShiftSummary({
    points,
    shifts,
    timezone,
}: BuildTrendChartV2VisibleShiftSummaryOptions): TrendChartV2VisibleShiftSummary[] {
    const summaries = new Map<string, TrendChartV2VisibleShiftSummary>();

    for (const point of points) {
        if (typeof point.value !== 'number' || !Number.isFinite(point.value)) {
            continue;
        }

        const assignment = resolveWeeklyShiftAssignment({ timestampMs: point.timestampMs, shifts, timezone });

        if (assignment.shiftId === 'sin-turno') {
            continue;
        }

        const summaryKey = assignment.bucketKey;
        const displayLabel = `${formatTrendChartV2ShiftDate(assignment.startMs, timezone)} · ${assignment.label}`;
        const current = summaries.get(summaryKey);

        if (!current) {
            summaries.set(summaryKey, {
                shiftId: assignment.shiftId,
                label: displayLabel,
                count: 1,
                last: point.value,
                min: point.value,
                max: point.value,
                avg: point.value,
            });
            continue;
        }

        const total = (current.avg * current.count) + point.value;
        current.count += 1;
        current.last = point.value;
        current.min = Math.min(current.min, point.value);
        current.max = Math.max(current.max, point.value);
        current.avg = roundToTwoDecimals(total / current.count);
    }

    return Array.from(summaries.values());
}

function roundToTwoDecimals(value: number): number {
    return Math.round(value * 100) / 100;
}

function formatTrendChartV2ShiftDate(timestampMs: number, timezone: string): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(timestampMs));
}
