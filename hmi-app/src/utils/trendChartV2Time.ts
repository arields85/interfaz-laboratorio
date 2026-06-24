import type { HistoryDataPointV2, HistoryRangeV2, HistoryWindow } from '../domain/dataContract.types';
import {
    isValidTimeZone,
    TEMPORAL_SETTINGS_FALLBACK_TIMEZONE,
} from '../config/temporalSettings.config';
import {
    computeVisibleLabelIndices,
    getChartLetterSpacingPx,
    getChartTextFont,
} from './chartHelpers';

const PRESET_DURATION_MS: Record<Exclude<HistoryRangeV2, 'custom'>, number> = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '12m': 365 * 24 * 60 * 60 * 1000,
};

export interface TrendChartV2CustomWindow {
    start: string;
    end: string;
}

export interface TrendChartV2VisibleWindowResult {
    startMs: number;
    endMs: number;
    source: 'response-window' | 'custom-query' | 'preset' | 'series-extent';
}

const SINGLE_POINT_WINDOW_PADDING_MS = 60 * 1000;
const PRESET_RESPONSE_WINDOW_SERIES_EXTENT_RATIO_THRESHOLD = 3;
const MAX_VISIBLE_TICK_COUNT = 8;

interface ResolveTrendChartV2VisibleWindowOptions {
    responseWindow?: HistoryWindow;
    customWindow?: TrendChartV2CustomWindow;
    range: HistoryRangeV2;
    nowMs?: number;
    series: HistoryDataPointV2[];
}

interface ScaleTimestampToChartXOptions {
    timestampMs: number;
    startMs: number;
    endMs: number;
    x0: number;
    plotWidth: number;
}

interface FormatTrendChartV2TimestampOptions {
    timestampMs: number;
    range: HistoryRangeV2;
    timezone: string;
}

interface BuildTrendChartV2VisibleTickValuesOptions {
    points: HistoryDataPointV2[];
    startMs: number;
    endMs: number;
    plotLeft: number;
    plotWidth: number;
    range: HistoryRangeV2;
    timezone: string;
}

export function resolveTrendChartV2VisibleWindow({
    responseWindow,
    customWindow,
    range,
    nowMs = Date.now(),
    series,
}: ResolveTrendChartV2VisibleWindowOptions): TrendChartV2VisibleWindowResult {
    const responseStartMs = parseFiniteTimestamp(responseWindow?.start);
    const responseEndMs = parseFiniteTimestamp(responseWindow?.end);
    const seriesExtent = resolveSeriesExtent(series);

    if (responseStartMs !== null && responseEndMs !== null && responseStartMs < responseEndMs) {
        if (
            range !== 'custom'
            && seriesExtent
            && shouldPreferSeriesExtentOverPresetWindow({
                range,
                responseStartMs,
                responseEndMs,
                seriesStartMs: seriesExtent.startMs,
                seriesEndMs: seriesExtent.endMs,
            })
        ) {
            return {
                startMs: seriesExtent.startMs,
                endMs: seriesExtent.endMs,
                source: 'series-extent',
            };
        }

        return {
            startMs: responseStartMs,
            endMs: responseEndMs,
            source: 'response-window',
        };
    }

    const customStartMs = parseFiniteTimestamp(customWindow?.start);
    const customEndMs = parseFiniteTimestamp(customWindow?.end);

    if (customStartMs !== null && customEndMs !== null && customStartMs < customEndMs) {
        return {
            startMs: customStartMs,
            endMs: customEndMs,
            source: 'custom-query',
        };
    }

    if (seriesExtent) {
        return {
            startMs: seriesExtent.startMs,
            endMs: seriesExtent.endMs,
            source: 'series-extent',
        };
    }

    if (range !== 'custom') {
        const durationMs = PRESET_DURATION_MS[range];

        return {
            startMs: nowMs - durationMs,
            endMs: nowMs,
            source: 'preset',
        };
    }

    return {
        startMs: nowMs - PRESET_DURATION_MS['24h'],
        endMs: nowMs,
        source: 'preset',
    };
}

export function resolveTrendChartV2Timezone(windowTimezone: string | undefined, plantTimezone: string): string {
    if (isValidTimeZone(plantTimezone)) {
        return plantTimezone.trim();
    }

    if (isValidTimeZone(windowTimezone)) {
        return windowTimezone.trim();
    }

    return TEMPORAL_SETTINGS_FALLBACK_TIMEZONE;
}

export function scaleTimestampToChartX({ timestampMs, startMs, endMs, x0, plotWidth }: ScaleTimestampToChartXOptions): number {
    const durationMs = Math.max(endMs - startMs, 1);
    const ratio = (timestampMs - startMs) / durationMs;
    return x0 + (Math.max(0, Math.min(1, ratio)) * plotWidth);
}

export function formatTrendChartV2Timestamp({ timestampMs, range, timezone }: FormatTrendChartV2TimestampOptions): string {
    const date = new Date(timestampMs);

    if (Number.isNaN(date.getTime())) {
        return '--';
    }

    const displayTimezone = isValidTimeZone(timezone)
        ? timezone.trim()
        : TEMPORAL_SETTINGS_FALLBACK_TIMEZONE;

    const options: Intl.DateTimeFormatOptions = range === '12m'
        ? { month: 'short', timeZone: displayTimezone }
        : range === '7d' || range === '30d'
            ? { day: '2-digit', month: '2-digit', timeZone: displayTimezone }
            : { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: displayTimezone };

    return new Intl.DateTimeFormat('en-GB', options).format(date);
}

export function buildTrendChartV2TickValues(startMs: number, endMs: number, count: number = 5): number[] {
    if (count <= 1 || startMs >= endMs) {
        return [startMs, endMs];
    }

    return Array.from({ length: count }, (_, index) => {
        const ratio = index / (count - 1);
        return Math.round(startMs + ((endMs - startMs) * ratio));
    });
}

export function buildTrendChartV2VisibleTickValues({
    points,
    startMs,
    endMs,
    plotLeft,
    plotWidth,
    range,
    timezone,
}: BuildTrendChartV2VisibleTickValuesOptions): number[] {
    const finitePoints = points.filter((point) => Number.isFinite(point.timestampMs));
    const anchorTicks = finitePoints.length > 0
        ? dedupeSortedTimestamps([startMs, ...finitePoints.map((point) => point.timestampMs), endMs])
        : [startMs, endMs];
    const widestLabelPx = Math.max(
        ...anchorTicks.map((timestampMs) => estimateLabelWidthPx(formatTrendChartV2Timestamp({ timestampMs, range, timezone }))),
        1,
    );
    const estimatedMaxTickCount = Math.max(
        2,
        Math.min(MAX_VISIBLE_TICK_COUNT, Math.floor(plotWidth / Math.max(widestLabelPx + 12, 1)) + 1),
    );

    for (let count = estimatedMaxTickCount; count >= 2; count -= 1) {
        const candidates = buildTrendChartV2TickValues(startMs, endMs, count);
        const labels = candidates.map((timestampMs) => formatTrendChartV2Timestamp({ timestampMs, range, timezone }));
        const positions = candidates.map((timestampMs) => scaleTimestampToChartX({
            timestampMs,
            startMs,
            endMs,
            x0: plotLeft,
            plotWidth,
        }));
        const adjustedPositions = positions.map((position, index) => {
            const halfWidth = estimateLabelWidthPx(labels[index]) / 2;

            if (index === 0) {
                return position + halfWidth;
            }

            if (index === candidates.length - 1) {
                return position - halfWidth;
            }

            return position;
        });
        const visibleIndices = computeVisibleLabelIndices(
            labels,
            adjustedPositions,
            getChartTextFont(),
            8,
            plotLeft + plotWidth,
            getChartLetterSpacingPx(),
        );

        if (visibleIndices.size === candidates.length) {
            return candidates;
        }
    }

    return buildTrendChartV2TickValues(startMs, endMs, 2);
}

function shouldPreferSeriesExtentOverPresetWindow(options: {
    range: Exclude<HistoryRangeV2, 'custom'>;
    responseStartMs: number;
    responseEndMs: number;
    seriesStartMs: number;
    seriesEndMs: number;
}): boolean {
    const responseDurationMs = options.responseEndMs - options.responseStartMs;
    const seriesDurationMs = options.seriesEndMs - options.seriesStartMs;

    if (responseDurationMs <= 0 || seriesDurationMs <= 0) {
        return false;
    }

    if (responseDurationMs > (seriesDurationMs * PRESET_RESPONSE_WINDOW_SERIES_EXTENT_RATIO_THRESHOLD)) {
        return true;
    }

    if (options.range === '12m') {
        return options.responseStartMs < options.seriesStartMs || options.responseEndMs > options.seriesEndMs;
    }

    return false;
}

function resolveSeriesExtent(series: HistoryDataPointV2[]): { startMs: number; endMs: number } | null {
    const timestamps = series
        .filter((point) => Number.isFinite(point.timestampMs) && typeof point.value === 'number' && Number.isFinite(point.value))
        .map((point) => point.timestampMs)
        .sort((left, right) => left - right);

    if (timestamps.length === 0) {
        return null;
    }

    const startMs = timestamps[0];
    const endMs = timestamps[timestamps.length - 1];

    if (startMs === endMs) {
        return {
            startMs: startMs - SINGLE_POINT_WINDOW_PADDING_MS,
            endMs: endMs + SINGLE_POINT_WINDOW_PADDING_MS,
        };
    }

    return {
        startMs,
        endMs,
    };
}

function parseFiniteTimestamp(value: string | undefined): number | null {
    if (!value) {
        return null;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function dedupeSortedTimestamps(values: number[]): number[] {
    const uniqueValues: number[] = [];

    for (const value of values) {
        if (!Number.isFinite(value)) {
            continue;
        }

        if (uniqueValues.at(-1) !== value) {
            uniqueValues.push(value);
        }
    }

    return uniqueValues;
}

function estimateLabelWidthPx(label: string): number {
    return Math.max(label.length * 7, 0);
}
