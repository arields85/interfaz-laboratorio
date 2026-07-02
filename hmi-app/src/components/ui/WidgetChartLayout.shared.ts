import { getChartLetterSpacingPx, getChartTextFont, measureChartTextWidthPx } from '../../utils/chartHelpers';

export const WIDGET_CHART_LAYOUT_BASE_MARGIN = { top: 8, right: 12, bottom: 24, left: 38 } as const;
export const WIDGET_CHART_LAYOUT_TOP_ADORNMENT_OFFSET = 11;
export const WIDGET_CHART_LAYOUT_TOP_ADORNMENT_RESERVED_HEIGHT = WIDGET_CHART_LAYOUT_TOP_ADORNMENT_OFFSET;
export const WIDGET_CHART_LAYOUT_MIN_RENDERABLE_SIZE = {
    width: WIDGET_CHART_LAYOUT_BASE_MARGIN.left + WIDGET_CHART_LAYOUT_BASE_MARGIN.right + 24,
    height: WIDGET_CHART_LAYOUT_BASE_MARGIN.top + WIDGET_CHART_LAYOUT_BASE_MARGIN.bottom + 24,
} as const;
export const WIDGET_CHART_HEADER_CLASS = 'mb-0 shrink-0 min-w-0';
export const WIDGET_CHART_CONTAINER_CLASS = 'relative -mt-1 flex-1 min-h-0 -mx-3 -mb-3';

interface WidgetChartLayoutMargin {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

const DEFAULT_OVERLAY_TOP_PADDING_PX = 20;
const DEFAULT_OVERLAY_RIGHT_PADDING_PX = 20;

export interface WidgetChartLayoutMetrics {
    dimensions: {
        width: number;
        height: number;
    };
    chartMargin: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
    plotArea: {
        left: number;
        right: number;
        top: number;
        bottom: number;
        width: number;
        height: number;
    };
    xAxisLabels: {
        left: number;
        right: number;
        plotWidth: number;
        y: number;
    };
    yAxisUnitSlot: {
        x: number;
        y: number;
        textAnchor: 'middle';
    };
    topMetaSlot: {
        x: number;
        y: number;
        textAnchor: 'end';
    };
    overlay: {
        width: number;
        height: number;
        top: number;
        rightPadding: number;
        topPadding: number;
        viewBox: string;
    };
    plotClipPathId: string;
}

interface ResolveWidgetChartLayoutMetricsOptions {
    width: number;
    height: number;
    hasTopAdornments: boolean;
    firstXAxisLabel: string;
    lastXAxisLabel: string;
    yAxisTickLabels: string[];
    idPrefix: string;
    font?: string;
    letterSpacing?: number;
    overlayTopPadding?: number;
    overlayRightPadding?: number;
    baseMargin?: Partial<WidgetChartLayoutMargin>;
    topAdornmentReservedHeight?: number;
    topAdornmentOffset?: number;
    alignPlotAreaToXAxisLabels?: boolean;
}

export function resolveWidgetChartLayoutMetrics({
    width,
    height,
    hasTopAdornments,
    firstXAxisLabel,
    lastXAxisLabel,
    yAxisTickLabels,
    idPrefix,
    font = getChartTextFont(),
    letterSpacing = getChartLetterSpacingPx(),
    overlayTopPadding = DEFAULT_OVERLAY_TOP_PADDING_PX,
    overlayRightPadding = DEFAULT_OVERLAY_RIGHT_PADDING_PX,
    baseMargin,
    topAdornmentReservedHeight = WIDGET_CHART_LAYOUT_TOP_ADORNMENT_RESERVED_HEIGHT,
    topAdornmentOffset = WIDGET_CHART_LAYOUT_TOP_ADORNMENT_OFFSET,
    alignPlotAreaToXAxisLabels = false,
}: ResolveWidgetChartLayoutMetricsOptions): WidgetChartLayoutMetrics {
    const resolvedBaseMargin = {
        top: baseMargin?.top ?? WIDGET_CHART_LAYOUT_BASE_MARGIN.top,
        right: baseMargin?.right ?? WIDGET_CHART_LAYOUT_BASE_MARGIN.right,
        bottom: baseMargin?.bottom ?? WIDGET_CHART_LAYOUT_BASE_MARGIN.bottom,
        left: baseMargin?.left ?? WIDGET_CHART_LAYOUT_BASE_MARGIN.left,
    };
    const chartMargin = {
        top: hasTopAdornments
            ? resolvedBaseMargin.top + topAdornmentReservedHeight
            : resolvedBaseMargin.top,
        right: resolvedBaseMargin.right,
        bottom: resolvedBaseMargin.bottom,
        left: resolvedBaseMargin.left,
    };
    const firstLabelWidth = measureChartTextWidthPx(firstXAxisLabel, font, letterSpacing);
    const lastLabelWidth = measureChartTextWidthPx(lastXAxisLabel, font, letterSpacing);
    const xAxisLeft = Math.max(chartMargin.left, Math.ceil((firstLabelWidth / 2) + 2));
    const xAxisRight = Math.min(width - chartMargin.right, width - Math.ceil((lastLabelWidth / 2) + 2));
    const plotLeft = alignPlotAreaToXAxisLabels ? xAxisLeft : chartMargin.left;
    const plotRight = Math.max(xAxisRight, plotLeft + 1);
    const plotBottom = Math.max(height - chartMargin.bottom, chartMargin.top + 1);
    const plotHeight = Math.max(plotBottom - chartMargin.top, 1);
    const plotWidth = Math.max(plotRight - plotLeft, 1);
    const yAxisTickLabelRightEdge = plotLeft - 8;
    const maxYTickLabelWidth = Math.max(
        ...yAxisTickLabels.map((label) => measureChartTextWidthPx(label, font, letterSpacing)),
        0,
    );
    const topAdornmentY = chartMargin.top - topAdornmentOffset;

    return {
        dimensions: { width, height },
        chartMargin,
        plotArea: {
            left: plotLeft,
            right: plotRight,
            top: chartMargin.top,
            bottom: plotBottom,
            width: plotWidth,
            height: plotHeight,
        },
        xAxisLabels: {
            left: xAxisLeft,
            right: xAxisRight,
            plotWidth: Math.max(xAxisRight - xAxisLeft, 1),
            y: height - 8,
        },
        yAxisUnitSlot: {
            x: yAxisTickLabelRightEdge - (maxYTickLabelWidth / 2),
            y: topAdornmentY,
            textAnchor: 'middle',
        },
        topMetaSlot: {
            x: plotRight,
            y: topAdornmentY,
            textAnchor: 'end',
        },
        overlay: {
            width: width + overlayRightPadding,
            height: height + overlayTopPadding,
            top: -overlayTopPadding,
            rightPadding: overlayRightPadding,
            topPadding: overlayTopPadding,
            viewBox: `0 ${-overlayTopPadding} ${width + overlayRightPadding} ${height + overlayTopPadding}`,
        },
        plotClipPathId: `${idPrefix}-plot-clip`,
    };
}
