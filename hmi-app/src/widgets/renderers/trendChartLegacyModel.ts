import type { ThresholdRule } from '../../domain/admin.types';
import type { DataHistoryResponse, HistoryRange, HistorySummary } from '../../domain/dataContract.types';
import {
    buildAreaPath,
    clamp,
    formatTick,
    smoothPath,
    type Point,
} from '../../utils/chartHelpers';
import { resolveWidgetChartLayoutMetrics } from '../../components/ui/WidgetChartLayout.shared';
import { buildTrendChartVisibleLabelIndices } from './trendChartVisibleLabels';

const LAYOUT_MARGIN = { top: 10, right: 12, bottom: 24, left: 45 } as const;
const MONTH_SHORT_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;

export interface TrendChartLegacyDataPoint {
    time: string;
    value: number;
}

interface BuildTrendChartLegacyModelOptions {
    widgetId: string;
    width: number;
    height: number;
    data: TrendChartLegacyDataPoint[];
    unit?: string;
    summary?: Pick<HistorySummary, 'min' | 'max' | 'avg'>;
    thresholds?: ThresholdRule[];
    font: string;
    letterSpacing: number;
}

export function mapTrendChartLegacyHistory(
    response: DataHistoryResponse,
    range: HistoryRange,
): TrendChartLegacyDataPoint[] {
    return response.series
        .filter((point): point is { timestamp: string; value: number } => point.value !== null)
        .map((point) => ({
            time: formatTrendChartLegacyTimestamp(point.timestamp, range),
            value: point.value,
        }));
}

export function resolveTrendChartLegacyDomain(data: TrendChartLegacyDataPoint[]) {
    const values = data.map((point) => point.value);
    const min = values.length > 0 ? Math.min(...values) : 0;
    const max = values.length > 0 ? Math.max(...values) : 0;
    const padding = values.length > 0 ? (max - min) * 0.2 || 5 : 0;

    return {
        min: values.length > 0 ? Math.floor(min - padding) : 0,
        max: values.length > 0 ? Math.ceil(max + padding) : 0,
    };
}

export function buildTrendChartLegacyModel(options: BuildTrendChartLegacyModelOptions) {
    const domain = resolveTrendChartLegacyDomain(options.data);
    const xLabels = options.data.map((item) => item.time);
    const yTickValues = Array.from({ length: 5 }, (_, index) => (
        domain.max - (((domain.max - domain.min) * index) / 4)
    ));
    const layout = resolveWidgetChartLayoutMetrics({
        width: options.width,
        height: options.height,
        hasTopAdornments: Boolean(options.unit) || Boolean(options.summary),
        firstXAxisLabel: xLabels[0] ?? '',
        lastXAxisLabel: xLabels.at(-1) ?? '',
        yAxisTickLabels: yTickValues.map(formatTick),
        idPrefix: options.widgetId,
        font: options.font,
        letterSpacing: options.letterSpacing,
        baseMargin: LAYOUT_MARGIN,
        topAdornmentReservedHeight: 12,
        topAdornmentOffset: 11,
        alignPlotAreaToXAxisLabels: true,
    });
    const plotWidth = layout.plotArea.width;
    const plotHeight = layout.plotArea.height;
    const step = plotWidth / Math.max(options.data.length - 1, 1);
    const x0 = layout.plotArea.left;
    const valueRange = Math.max(domain.max - domain.min, 1);
    const toY = (value: number) => layout.plotArea.top + plotHeight - (
        clamp((value - domain.min) / valueRange, 0, 1) * plotHeight
    );
    const points: Point[] = options.data.map((item, index) => ({
        x: x0 + (index * step),
        y: toY(item.value),
    }));
    const linePath = smoothPath(points);
    const xPositions = options.data.map((_, index) => x0 + (index * step));
    const summaryLabels = options.summary
        ? {
            min: formatSummarySlotValue(options.summary.min, options.unit),
            max: formatSummarySlotValue(options.summary.max, options.unit),
            avg: formatSummarySlotValue(options.summary.avg, options.unit),
        }
        : null;

    return {
        widgetId: options.widgetId,
        data: options.data,
        domain,
        layout,
        plotWidth,
        plotHeight,
        step,
        x0,
        points,
        linePath,
        areaPath: buildAreaPath(linePath, points, layout.plotArea.bottom),
        lastPoint: points.at(-1) ?? null,
        xLabels,
        xPositions,
        visibleLabelIndices: buildTrendChartVisibleLabelIndices({
            labels: xLabels,
            positions: xPositions,
            plotWidth,
            font: options.font,
            letterSpacing: options.letterSpacing,
            minGap: 8,
        }),
        gridLines: Array.from({ length: 5 }, (_, index) => ({
            y: layout.plotArea.top + ((index / 4) * plotHeight),
        })),
        yTicks: yTickValues.map((value, index) => ({
            value,
            label: formatTick(value),
            y: layout.plotArea.top + ((index / 4) * plotHeight),
        })),
        thresholds: (options.thresholds ?? []).flatMap((threshold, index) => {
            const y = toY(threshold.value);

            return y >= layout.plotArea.top && y <= layout.plotArea.bottom
                ? [{ index, threshold, y }]
                : [];
        }),
        summaryLabels,
        unitLabel: options.unit?.toUpperCase(),
        toY,
    };
}

export function resolveTrendChartLegacyHoverIndex(options: {
    chartX: number;
    x0: number;
    step: number;
    dataLength: number;
}): number | null {
    if (options.dataLength <= 0) {
        return null;
    }

    if (options.dataLength === 1 || options.step <= 0) {
        return 0;
    }

    return Math.max(0, Math.min(
        options.dataLength - 1,
        Math.round((options.chartX - options.x0) / options.step),
    ));
}

function formatTrendChartLegacyTimestamp(timestamp: string, range: HistoryRange): string {
    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
        return '--';
    }

    if (range === 'minuto' || range === 'hora') {
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    if (range === 'dia' || range === 'semana') {
        return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    return MONTH_SHORT_ES[date.getMonth()];
}

function formatSummarySlotValue(value: number | null, unit?: string): string {
    const formattedValue = value === null ? '--' : formatTick(value);
    const normalizedUnit = unit?.trim().toLowerCase();

    return normalizedUnit ? `${formattedValue}${normalizedUnit}` : formattedValue;
}
