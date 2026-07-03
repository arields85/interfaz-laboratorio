import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Activity,
    BarChart2,
    Droplet,
    Fan,
    FoldVertical,
    Gauge,
    HeartPulse,
    LineChart,
    Settings,
    Siren,
    Thermometer,
    TrendingUp,
    Wifi,
    Wind,
    Zap,
    type LucideIcon,
} from 'lucide-react';
import type { TrendChartV2WidgetConfig } from '../../domain/admin.types';
import type { ContractMachine, HistoryDataPointV2, HistoryRangeV2 } from '../../domain/dataContract.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import { isDataHistoryEnabled } from '../../config/dataConnection.config';
import { useTemporalSettings } from '../../hooks/useTemporalSettings';
import { useDataHistory } from '../../queries/useDataHistory';
import { resolveBinding } from '../resolvers/bindingResolver';
import { coerceDataHistoryResponseForTrendChartV2 } from '../../utils/dataHistoryResponseV2';
import { mapHistoricalDensityToMaxPoints, normalizeHistoricalDensity } from '../../utils/trendChartV2Density';
import { validateCustomHistoryWindow } from '../../utils/historyQueryValidation';
import { buildTrendChartV2SimulatedHistory } from '../../utils/trendChartV2Simulation';
import { buildTrendChartV2Segments, resolveTrendChartV2GapThresholdMs } from '../../utils/trendChartV2Segments';
import {
    buildTrendChartV2ShiftIntervals,
    normalizeTrendChartV2ShiftDisplayMode,
    resolveTrendChartV2ShiftDisplayMode,
    resolveTrendChartV2TooltipShiftLabel,
} from '../../utils/trendChartV2Shifts';
import {
    buildTrendChartV2VisibleTickValues,
    formatTrendChartV2Timestamp,
    resolveTrendChartV2Timezone,
    resolveTrendChartV2VisibleWindow,
    scaleTimestampToChartX,
} from '../../utils/trendChartV2Time';
import {
    buildAreaPath,
    clamp,
    formatTick,
    getChartLetterSpacingPx,
    getChartTextFont,
    smoothPath,
} from '../../utils/chartHelpers';
import TrendChartV2InteractionLayer from '../../components/ui/TrendChartV2InteractionLayer';
import ChartTooltip from '../../components/ui/ChartTooltip';
import WidgetChartLayout from '../../components/ui/WidgetChartLayout';
import {
    resolveWidgetChartLayoutMetrics,
    WIDGET_CHART_CONTAINER_CLASS,
    WIDGET_CHART_HEADER_CLASS,
    WIDGET_CHART_LAYOUT_MIN_RENDERABLE_SIZE,
} from '../../components/ui/WidgetChartLayout.shared';
import WidgetHeader from '../../components/ui/WidgetHeader';
import WidgetHeaderTemporalControls from '../../components/ui/WidgetHeaderTemporalControls';
import WidgetRuntimeState from '../../components/ui/WidgetRuntimeState';
import { isDataHistoryConnectionError } from '../../services/dataHistory.service';

const SYSTEM_TEXT_STYLE = {
    fontSize: 'var(--font-size-system)',
    fontFamily: 'var(--font-system)',
    fontWeight: 'var(--font-weight-system)',
    letterSpacing: 'var(--tracking-system)',
} as const;

interface TrendChartV2WidgetProps {
    widget: TrendChartV2WidgetConfig;
    equipmentMap: Map<string, EquipmentSummary>;
    machines?: ContractMachine[];
    isLoadingData?: boolean;
    className?: string;
}

interface LeadingEdgeAnchor {
    segmentIndex: number;
    point: HistoryDataPointV2 & { value: number };
}

const RANGE_OPTIONS: Array<{ value: Exclude<HistoryRangeV2, 'custom'>; label: string }> = [
    { value: '1h', label: '1h' },
    { value: '24h', label: '24h' },
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
    { value: '12m', label: '12m' },
];

const TOKEN = {
    gradientFrom: 'var(--color-widget-gradient-from)',
    gradientTo: 'var(--color-widget-gradient-to)',
    background: 'var(--color-industrial-bg)',
    border: 'var(--color-industrial-border)',
    text: 'var(--color-industrial-text)',
    muted: 'var(--color-industrial-muted)',
    grid: 'var(--color-chart-grid)',
    icon: 'var(--color-widget-icon)',
} as const;

const DEFAULT_LINE_STROKE_WIDTH = 2.5;
const DEFAULT_LINE_GLOW_BLUR = 3;
const MIN_LINE_STROKE_WIDTH = 0.5;
const MAX_LINE_STROKE_WIDTH = 6;
const MIN_LINE_GLOW_BLUR = 0;
const MAX_LINE_GLOW_BLUR = 8;

function clampLineStrokeWidth(value: number | undefined): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_LINE_STROKE_WIDTH;
    }

    return clamp(value as number, MIN_LINE_STROKE_WIDTH, MAX_LINE_STROKE_WIDTH);
}

function clampLineGlowBlur(value: number | undefined): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_LINE_GLOW_BLUR;
    }

    return clamp(value as number, MIN_LINE_GLOW_BLUR, MAX_LINE_GLOW_BLUR);
}

function formatTrendChartV2SummaryValue(value: number, unit: string | undefined): string {
    return `${formatTick(value)}${unit ? unit.toLowerCase() : ''}`;
}

const HEADER_ICON_MAP: Record<string, LucideIcon> = {
    Gauge,
    Activity,
    Thermometer,
    Zap,
    Droplet,
    Wind,
    Settings,
    Fan,
    FoldVertical,
    TrendingUp,
    HeartPulse,
    Siren,
    Wifi,
    BarChart2,
    LineChart,
};

function resolveHeaderIcon(iconName: string | null | undefined): LucideIcon | null {
    if (iconName === null) {
        return null;
    }

    if (iconName === undefined || iconName === '') {
        return TrendingUp;
    }

    return HEADER_ICON_MAP[iconName] ?? TrendingUp;
}

function resolveLeadingEdgeAnchor(options: {
    range: HistoryRangeV2;
    visibleWindowSource: 'response-window' | 'custom-query' | 'preset' | 'series-extent';
    visibleWindowStartMs: number;
    segments: HistoryDataPointV2[][];
}): LeadingEdgeAnchor | null {
    if (options.range !== '12m' || options.visibleWindowSource !== 'series-extent' || options.segments.length < 2) {
        return null;
    }

    const leadingSegment = options.segments[0];
    const nextSegment = options.segments[1];
    const leadingPoint = leadingSegment[0];

    if (
        leadingSegment.length !== 1
        || nextSegment.length < 2
        || typeof leadingPoint?.value !== 'number'
        || !Number.isFinite(leadingPoint.value)
        || leadingPoint.timestampMs !== options.visibleWindowStartMs
    ) {
        return null;
    }

    return {
        segmentIndex: 1,
        point: leadingPoint as HistoryDataPointV2 & { value: number },
    };
}

export default function TrendChartV2Widget({
    widget,
    equipmentMap,
    machines,
    isLoadingData = false,
    className,
}: TrendChartV2WidgetProps) {
    const [range, setRange] = useState<Exclude<HistoryRangeV2, 'custom'>>('24h');
    const [customWindow, setCustomWindow] = useState<{ start: string; end: string } | null>(null);
    const [hoveredTimestampMs, setHoveredTimestampMs] = useState<number | null>(null);
    const [zoomMessage, setZoomMessage] = useState<string | null>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const { resolvedTimezone, shifts } = useTemporalSettings();
    const historyEnabled = isDataHistoryEnabled();
    const resolved = resolveBinding(widget, equipmentMap, machines);
    const density = normalizeHistoricalDensity(widget.displayOptions?.historicalDensity);
    const HeaderIcon = resolveHeaderIcon(widget.displayOptions?.icon);
    const shiftDisplayMode = normalizeTrendChartV2ShiftDisplayMode(widget.displayOptions?.shiftDisplayMode);
    const showShifts = widget.displayOptions?.showShifts === true;
    const lineStrokeWidth = clampLineStrokeWidth(widget.displayOptions?.lineStrokeWidth);
    const lineGlowBlur = clampLineGlowBlur(widget.displayOptions?.lineGlowBlur);
    const maxPoints = mapHistoricalDensityToMaxPoints(density);
    const bindingMachineId = widget.binding?.machineId;
    const bindingVariableKey = widget.binding?.variableKey;
    const isRealBinding = widget.binding?.mode === 'real_variable';
    const isSimulatedBinding = widget.binding?.mode === 'simulated_value';

    useEffect(() => {
        const element = containerRef.current;
        if (!element) {
            return;
        }

        const applyDimensions = (width: number, height: number) => {
            if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
                return;
            }

            setDimensions({ width, height });
        };

        const initialRect = element.getBoundingClientRect();
        applyDimensions(initialRect.width, initialRect.height);

        const observer = new ResizeObserver(([entry]) => {
            applyDimensions(entry.contentRect.width, entry.contentRect.height);
        });

        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const historyParams = isRealBinding && bindingMachineId !== undefined && bindingVariableKey && historyEnabled
        ? customWindow
            ? {
                machineId: bindingMachineId,
                variableKey: bindingVariableKey,
                range: 'custom' as const,
                start: customWindow.start,
                end: customWindow.end,
                maxPoints,
            }
            : {
                machineId: bindingMachineId,
                variableKey: bindingVariableKey,
                range,
                maxPoints,
            }
        : null;

    const {
        data: historyData,
        isLoading,
        isError,
        error,
    } = useDataHistory(historyParams);

    const baseValue = resolved.value == null
        ? null
        : typeof resolved.value === 'number'
            ? resolved.value
            : typeof resolved.value === 'string'
                ? Number.parseFloat(resolved.value)
                : Number.NaN;
    const simulatedData = useMemo(() => {
        if (!isSimulatedBinding || !Number.isFinite(baseValue)) {
            return null;
        }

        const finiteBaseValue = baseValue as number;

        return buildTrendChartV2SimulatedHistory({
            widgetId: widget.id,
            machineId: bindingMachineId,
            variableKey: bindingVariableKey,
            range: customWindow ? 'custom' : range,
            customWindow: customWindow ?? undefined,
            baseValue: finiteBaseValue,
        });
    }, [baseValue, bindingMachineId, bindingVariableKey, customWindow, isSimulatedBinding, range, widget.id]);
    const activeRange = customWindow ? 'custom' : range;
    const v2Data = isSimulatedBinding
        ? simulatedData
        : coerceDataHistoryResponseForTrendChartV2(historyData, activeRange);
    const visibleWindow = useMemo(() => resolveTrendChartV2VisibleWindow({
        responseWindow: v2Data?.window,
        customWindow: customWindow ?? undefined,
        range: activeRange,
        series: v2Data?.series ?? [],
    }), [activeRange, customWindow, v2Data?.series, v2Data?.window]);
    const resolvedUnit = v2Data?.unit ?? (resolved.unit ? String(resolved.unit) : undefined);
    const hasUnit = Boolean(resolvedUnit);
    const timezone = resolveTrendChartV2Timezone(v2Data?.window?.timezone, resolvedTimezone);
    const chartFont = getChartTextFont();
    const chartLetterSpacing = getChartLetterSpacingPx();
    const numericPoints = useMemo(() => (v2Data?.series ?? []).filter((point): point is HistoryDataPointV2 => (
        Number.isFinite(point.timestampMs)
        && point.timestampMs >= visibleWindow.startMs
        && point.timestampMs <= visibleWindow.endMs
    )), [v2Data?.series, visibleWindow.endMs, visibleWindow.startMs]);

    const valueDomain = useMemo(() => {
        const values = numericPoints
            .map((point) => point.value)
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

        if (values.length === 0) {
            return { min: 0, max: 1 };
        }

        const min = Math.min(...values);
        const max = Math.max(...values);
        const padding = Math.max((max - min) * 0.15, 1);
        return { min: min - padding, max: max + padding };
    }, [numericPoints]);

    const shiftIntervals = useMemo(() => buildTrendChartV2ShiftIntervals({
        shifts,
        timezone,
        visibleStartMs: visibleWindow.startMs,
        visibleEndMs: visibleWindow.endMs,
    }), [shifts, timezone, visibleWindow.endMs, visibleWindow.startMs]);
    const resolvedShiftDisplayMode = useMemo(() => resolveTrendChartV2ShiftDisplayMode({
        displayMode: shiftDisplayMode,
        intervalCount: shiftIntervals.length,
        visibleDurationMs: visibleWindow.endMs - visibleWindow.startMs,
    }), [shiftDisplayMode, shiftIntervals.length, visibleWindow.endMs, visibleWindow.startMs]);
    const visibleSummary = useMemo(() => {
        if (!customWindow && v2Data?.summary) {
            const { min, max, avg } = v2Data.summary;

            if (min !== null && max !== null && avg !== null) {
                return { min, max, avg };
            }
        }

        const values = numericPoints
            .map((point) => point.value)
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

        if (values.length === 0) {
            return null;
        }

        const total = values.reduce((sum, value) => sum + value, 0);

        return {
            min: Math.min(...values),
            max: Math.max(...values),
            avg: total / values.length,
        };
    }, [customWindow, numericPoints, v2Data]);
    const hasSummary = Boolean(visibleSummary);
    const hasTopChartAdornments = hasUnit || hasSummary;
    const rangeForLabels = customWindow ? 'custom' : range;
    const firstXAxisLabel = useMemo(() => formatTrendChartV2Timestamp({
        timestampMs: visibleWindow.startMs,
        range: rangeForLabels,
        timezone,
    }), [rangeForLabels, timezone, visibleWindow.startMs]);
    const lastXAxisLabel = useMemo(() => formatTrendChartV2Timestamp({
        timestampMs: visibleWindow.endMs,
        range: rangeForLabels,
        timezone,
    }), [rangeForLabels, timezone, visibleWindow.endMs]);
    const valueTickValues = useMemo(() => Array.from({ length: 5 }, (_, index) => (
        valueDomain.max - (((valueDomain.max - valueDomain.min) * index) / 4)
    )), [valueDomain.max, valueDomain.min]);
    const chartLayout = useMemo(() => resolveWidgetChartLayoutMetrics({
        width: dimensions.width,
        height: dimensions.height,
        hasTopAdornments: hasTopChartAdornments,
        firstXAxisLabel,
        lastXAxisLabel,
        yAxisTickLabels: valueTickValues.map((value) => formatTick(value)),
        idPrefix: widget.id,
        font: chartFont,
        letterSpacing: chartLetterSpacing,
    }), [chartFont, chartLetterSpacing, dimensions.height, dimensions.width, firstXAxisLabel, hasTopChartAdornments, lastXAxisLabel, valueTickValues, widget.id]);
    const chartModel = useMemo(() => {
        const plotWidth = chartLayout.plotArea.width;
        const plotHeight = chartLayout.plotArea.height;
        const rangeY = Math.max(valueDomain.max - valueDomain.min, 1);
        const toY = (value: number) => chartLayout.plotArea.top + plotHeight - (((value - valueDomain.min) / rangeY) * plotHeight);
        const gapThresholdMs = resolveTrendChartV2GapThresholdMs({
            bucketMs: v2Data?.window?.bucketMs,
            range: customWindow ? 'custom' : range,
            points: numericPoints,
        });
        const segments = buildTrendChartV2Segments({
            points: numericPoints,
            gapThresholdMs,
        });
        const interactionPoints = numericPoints
            .filter((point): point is HistoryDataPointV2 & { value: number } => typeof point.value === 'number')
            .map((point) => ({
                ...point,
                x: scaleTimestampToChartX({
                    timestampMs: point.timestampMs,
                    startMs: visibleWindow.startMs,
                    endMs: visibleWindow.endMs,
                    x0: chartLayout.plotArea.left,
                    plotWidth,
                }),
                y: toY(point.value),
            }));

        const valueTicks = valueTickValues.map((value, index) => ({
            value,
            y: chartLayout.plotArea.top + ((index / 4) * plotHeight),
        }));

        return {
            plotWidth,
            plotHeight,
            segments,
            interactionPoints,
            toY,
            valueTicks,
        };
    }, [chartLayout.plotArea.height, chartLayout.plotArea.left, chartLayout.plotArea.top, chartLayout.plotArea.width, customWindow, numericPoints, range, v2Data?.window?.bucketMs, valueDomain.max, valueDomain.min, valueTickValues, visibleWindow.endMs, visibleWindow.startMs]);

    const hoveredPoint = hoveredTimestampMs === null
        ? null
        : chartModel.interactionPoints.find((point) => point.timestampMs === hoveredTimestampMs) ?? null;
    const hoveredShiftLabel = showShifts && hoveredPoint
        ? resolveTrendChartV2TooltipShiftLabel({
            timestampMs: hoveredPoint.timestampMs,
            shifts,
            timezone,
        })
        : null;
    const xTickValues = useMemo(() => buildTrendChartV2VisibleTickValues({
        points: numericPoints,
        startMs: visibleWindow.startMs,
        endMs: visibleWindow.endMs,
        plotLeft: chartLayout.xAxisLabels.left,
        plotWidth: chartLayout.xAxisLabels.plotWidth,
        range: customWindow ? 'custom' : range,
        timezone,
        minLabelX: 0,
        maxLabelX: dimensions.width,
        font: chartFont,
        letterSpacing: chartLetterSpacing,
    }), [chartFont, chartLetterSpacing, chartLayout.xAxisLabels.left, chartLayout.xAxisLabels.plotWidth, customWindow, dimensions.width, numericPoints, range, timezone, visibleWindow.endMs, visibleWindow.startMs]);
    const lastRenderablePoint = chartModel.interactionPoints.at(-1) ?? null;
    const leadingEdgeAnchor = useMemo(() => resolveLeadingEdgeAnchor({
        range: activeRange,
        visibleWindowSource: visibleWindow.source,
        visibleWindowStartMs: visibleWindow.startMs,
        segments: chartModel.segments,
    }), [activeRange, chartModel.segments, visibleWindow.source, visibleWindow.startMs]);
    const lineGradientId = `${widget.id}-line-gradient`;
    const areaGradientId = `${widget.id}-area-gradient`;
    const fadeGradientId = `${widget.id}-area-fade`;
    const maskId = `${widget.id}-area-mask`;
    const glowId = `${widget.id}-line-glow`;

    const handleZoomSelection = useCallback((selection: { startMs: number; endMs: number }) => {
        const start = new Date(selection.startMs).toISOString();
        const end = new Date(selection.endMs).toISOString();

        if (!validateCustomHistoryWindow(start, end).ok) {
            setZoomMessage('Unable to apply zoom because the selected window is invalid.');
            return;
        }

        setCustomWindow({ start, end });
        setHoveredTimestampMs(null);
        setZoomMessage(null);
    }, []);

    const handleInvalidZoomSelection = useCallback(() => {
        setZoomMessage('Selection too small to zoom. Drag a wider time window.');
        setHoveredTimestampMs(null);
    }, []);

    const hasData = chartModel.interactionPoints.length > 0;
    const showLoading = isLoadingData || (historyParams !== null && isLoading);
    const hasRenderableDimensions = dimensions.width >= WIDGET_CHART_LAYOUT_MIN_RENDERABLE_SIZE.width
        && dimensions.height >= WIDGET_CHART_LAYOUT_MIN_RENDERABLE_SIZE.height;
    const shouldShowState = showLoading || isError || !hasData || !hasRenderableDimensions;
    const runtimeState = showLoading
        ? 'loading'
        : isError
            ? (isDataHistoryConnectionError(error) ? 'disconnected' : 'error')
            : hasData && !hasRenderableDimensions
                ? 'chart-not-ready'
                : 'empty';

    return (
        <div className={`glass-panel group relative p-5 overflow-hidden w-full h-full flex flex-col ${className ?? ''}`}>
            <WidgetHeader
                title={widget.title || 'Trend Chart V2'}
                icon={HeaderIcon ?? undefined}
                iconColor={TOKEN.icon}
                iconPosition="left"
                iconTestId="trend-chart-v2-header-icon"
                className={WIDGET_CHART_HEADER_CLASS}
                trailing={(
                    <div className="flex items-center gap-2">
                        <WidgetHeaderTemporalControls
                            variant="pill"
                            testId="trend-chart-v2-widget-runtime-controls"
                            indicatorTestId="trend-chart-v2-widget-runtime-control-indicator"
                            groups={[
                                {
                                    testId: 'trend-chart-v2-widget-runtime-range-selector',
                                    options: RANGE_OPTIONS,
                                    selectedValue: range,
                                    onSelect: (value) => {
                                        const nextRange = value as Exclude<HistoryRangeV2, 'custom'>;

                                        setRange(nextRange);
                                        setCustomWindow(null);
                                        setHoveredTimestampMs(null);
                                        setZoomMessage(null);
                                    },
                                },
                            ]}
                        />

                        {customWindow && (
                            <button
                                type="button"
                                onClick={() => {
                                    setCustomWindow(null);
                                    setZoomMessage(null);
                                }}
                                className="rounded-md border border-admin-accent/30 bg-admin-accent/10 px-2.5 py-1 uppercase text-admin-accent"
                            >
                                Back to preset
                            </button>
                        )}
                    </div>
                )}
            />

            {zoomMessage && hasData && hasRenderableDimensions && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] uppercase text-industrial-muted">
                    <span className="text-admin-accent">{zoomMessage}</span>
                </div>
            )}

            <div ref={containerRef} className={WIDGET_CHART_CONTAINER_CLASS}>
                {showLoading ? (
                    <WidgetRuntimeState state={runtimeState} testId="trend-chart-v2-state" />
                ) : shouldShowState ? (
                    <WidgetRuntimeState
                        state={runtimeState}
                        testId="trend-chart-v2-state"
                    />
                ) : (
                    <>
                        <WidgetChartLayout
                            layout={chartLayout}
                            svgTestId="trend-chart-v2-svg"
                            overlaySvgTestId="trend-chart-v2-overlay-svg"
                            renderMain={(layout) => (
                                <>
                                    <defs>
                                    <linearGradient id={lineGradientId} gradientUnits="userSpaceOnUse" x1={layout.plotArea.left} y1="0" x2={layout.plotArea.right} y2="0">
                                    <stop offset="0%" stopColor={TOKEN.gradientFrom} stopOpacity={0.7} />
                                    <stop offset="100%" stopColor={TOKEN.gradientTo} stopOpacity={0.98} />
                                </linearGradient>

                                <linearGradient id={areaGradientId} gradientUnits="userSpaceOnUse" x1={layout.plotArea.left} y1="0" x2={layout.plotArea.right} y2="0">
                                    <stop offset="0%" stopColor={TOKEN.gradientFrom} stopOpacity={0.42} />
                                    <stop offset="100%" stopColor={TOKEN.gradientTo} stopOpacity={0.66} />
                                </linearGradient>

                                <linearGradient id={fadeGradientId} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={TOKEN.text} stopOpacity={0.72} />
                                    <stop offset="100%" stopColor={TOKEN.text} stopOpacity={0} />
                                </linearGradient>

                                <mask id={maskId} maskContentUnits="objectBoundingBox">
                                    <rect x="0" y="0" width="1" height="1" fill={`url(#${fadeGradientId})`} />
                                </mask>

                                <filter id={glowId} x="-20%" y="-50%" width="140%" height="200%">
                                    <feGaussianBlur stdDeviation={lineGlowBlur} result="blur" />
                                    <feMerge>
                                        <feMergeNode in="blur" />
                                        <feMergeNode in="SourceGraphic" />
                                    </feMerge>
                                </filter>
                                    </defs>

                            {hasUnit && (
                                <text
                                    data-testid="trend-chart-v2-unit-label"
                                    x={layout.yAxisUnitSlot.x}
                                    y={layout.yAxisUnitSlot.y}
                                    textAnchor={layout.yAxisUnitSlot.textAnchor}
                                    fill={TOKEN.icon}
                                    fontSize={SYSTEM_TEXT_STYLE.fontSize}
                                    fontFamily={SYSTEM_TEXT_STYLE.fontFamily}
                                    fontWeight={SYSTEM_TEXT_STYLE.fontWeight}
                                    letterSpacing={SYSTEM_TEXT_STYLE.letterSpacing}
                                >
                                    {resolvedUnit?.toUpperCase()}
                                </text>
                            )}

                            {visibleSummary && (
                                <text
                                    data-testid="trend-chart-v2-summary"
                                    x={layout.topMetaSlot.x}
                                    y={layout.topMetaSlot.y}
                                    textAnchor={layout.topMetaSlot.textAnchor}
                                    fill={TOKEN.muted}
                                    fontSize={SYSTEM_TEXT_STYLE.fontSize}
                                    fontFamily={SYSTEM_TEXT_STYLE.fontFamily}
                                    fontWeight={SYSTEM_TEXT_STYLE.fontWeight}
                                    letterSpacing={SYSTEM_TEXT_STYLE.letterSpacing}
                                >
                                    <tspan data-testid="trend-chart-v2-summary-min">
                                        {`min ${formatTrendChartV2SummaryValue(visibleSummary.min, resolvedUnit)}`}
                                    </tspan>
                                    <tspan data-testid="trend-chart-v2-summary-max" dx="12">
                                        {`max ${formatTrendChartV2SummaryValue(visibleSummary.max, resolvedUnit)}`}
                                    </tspan>
                                    <tspan data-testid="trend-chart-v2-summary-avg" dx="12">
                                        {`avg ${formatTrendChartV2SummaryValue(visibleSummary.avg, resolvedUnit)}`}
                                    </tspan>
                                </text>
                            )}

                            {chartModel.valueTicks.map((tick) => (
                                <line
                                    key={`grid-${tick.y}`}
                                    data-testid="trend-chart-v2-y-grid-line"
                                    x1={layout.plotArea.left}
                                    x2={layout.plotArea.right}
                                    y1={tick.y}
                                    y2={tick.y}
                                    stroke={TOKEN.grid}
                                    strokeDasharray="3 3"
                                />
                            ))}

                            <g clipPath={`url(#${layout.plotClipPathId})`}>
                                {showShifts && shiftIntervals.map((interval) => {
                                const x = scaleTimestampToChartX({
                                    timestampMs: interval.startMs,
                                    startMs: visibleWindow.startMs,
                                    endMs: visibleWindow.endMs,
                                    x0: layout.plotArea.left,
                                    plotWidth: chartModel.plotWidth,
                                });
                                const endX = scaleTimestampToChartX({
                                    timestampMs: interval.endMs,
                                    startMs: visibleWindow.startMs,
                                    endMs: visibleWindow.endMs,
                                    x0: layout.plotArea.left,
                                    plotWidth: chartModel.plotWidth,
                                });

                                return resolvedShiftDisplayMode === 'bands'
                                    ? (
                                        <rect
                                            key={`${interval.shiftId}-${interval.startMs}`}
                                              data-testid="trend-chart-v2-shift-band"
                                            x={x}
                                            y={layout.plotArea.top}
                                            width={Math.max(endX - x, 1)}
                                            height={chartModel.plotHeight}
                                            fill="var(--color-admin-accent)"
                                            fillOpacity={0.08}
                                        />
                                    )
                                    : (
                                        <line
                                            key={`${interval.shiftId}-${interval.startMs}`}
                                            data-testid="trend-chart-v2-shift-line"
                                            x1={x}
                                            x2={x}
                                            y1={layout.plotArea.top}
                                            y2={layout.plotArea.top + chartModel.plotHeight}
                                            stroke="var(--color-admin-accent)"
                                            strokeOpacity={0.28}
                                            strokeDasharray="4 4"
                                        />
                                    );
                                })}

                                {chartModel.segments.map((segment, index) => {
                                const anchorPoint = leadingEdgeAnchor?.segmentIndex === index
                                    ? {
                                        x: layout.plotArea.left,
                                        y: chartModel.toY(leadingEdgeAnchor.point.value),
                                    }
                                    : null;
                                const renderablePoints = [
                                    ...(anchorPoint ? [anchorPoint] : []),
                                    ...segment
                                    .filter((point): point is HistoryDataPointV2 & { value: number } => typeof point.value === 'number')
                                    .map((point) => ({
                                        x: scaleTimestampToChartX({
                                            timestampMs: point.timestampMs,
                                            startMs: visibleWindow.startMs,
                                            endMs: visibleWindow.endMs,
                                            x0: layout.plotArea.left,
                                            plotWidth: chartModel.plotWidth,
                                        }),
                                        y: chartModel.toY(point.value),
                                    })),
                                ];
                                const linePath = renderablePoints.length >= 2 ? smoothPath(renderablePoints) : '';
                                const areaPath = renderablePoints.length >= 2
                                    ? buildAreaPath(linePath, renderablePoints, layout.plotArea.top + chartModel.plotHeight)
                                    : '';

                                const isOnlyVisibleFinitePoint = renderablePoints.length === 1
                                    && chartModel.interactionPoints.length === 1;

                                return (
                                    <g key={`segment-${index}`} data-testid="trend-chart-v2-segment">
                                        {areaPath.length > 0 && (
                                            <path
                                                d={areaPath}
                                                fill={`url(#${areaGradientId})`}
                                                mask={`url(#${maskId})`}
                                            />
                                        )}

                                        {renderablePoints.length >= 2 ? (
                                            <path
                                                data-testid="trend-chart-v2-line-segment"
                                                d={linePath}
                                                fill="none"
                                                stroke={`url(#${lineGradientId})`}
                                                strokeWidth={lineStrokeWidth}
                                                filter={`url(#${glowId})`}
                                            />
                                        ) : isOnlyVisibleFinitePoint ? (
                                            <circle
                                                data-testid="trend-chart-v2-single-point"
                                                cx={renderablePoints[0].x}
                                                cy={renderablePoints[0].y}
                                                r={3}
                                                fill={TOKEN.gradientTo}
                                            />
                                        ) : null}
                                    </g>
                                );
                                })}
                            </g>

                            <line x1={layout.plotArea.left} y1={layout.plotArea.top + chartModel.plotHeight} x2={layout.plotArea.right} y2={layout.plotArea.top + chartModel.plotHeight} stroke="var(--color-industrial-border)" />
                            <line x1={layout.plotArea.left} y1={layout.plotArea.top} x2={layout.plotArea.left} y2={layout.plotArea.top + chartModel.plotHeight} stroke="var(--color-industrial-border)" />

                            {xTickValues.map((tickValue) => {
                                return (
                                    <text
                                        data-testid="trend-chart-v2-x-axis-label"
                                        key={tickValue}
                                        x={scaleTimestampToChartX({
                                            timestampMs: tickValue,
                                            startMs: visibleWindow.startMs,
                                            endMs: visibleWindow.endMs,
                                            x0: layout.xAxisLabels.left,
                                            plotWidth: layout.xAxisLabels.plotWidth,
                                        })}
                                        y={layout.xAxisLabels.y}
                                        textAnchor="middle"
                                        fill="var(--color-industrial-muted)"
                                        fontSize="var(--font-size-chart)"
                                        fontFamily="var(--font-chart)"
                                        letterSpacing="var(--tracking-chart)"
                                    >
                                        {formatTrendChartV2Timestamp({
                                            timestampMs: tickValue,
                                            range: customWindow ? 'custom' : range,
                                            timezone,
                                        })}
                                    </text>
                                );
                            })}

                            {chartModel.valueTicks.map((tick, index) => (
                                <text
                                    key={`y-tick-${index}`}
                                    data-testid="trend-chart-v2-y-tick-label"
                                    x={layout.chartMargin.left - 8}
                                    y={tick.y}
                                    dy={4}
                                    textAnchor="end"
                                    fill={TOKEN.muted}
                                    fontSize="var(--font-size-chart)"
                                    fontFamily="var(--font-chart)"
                                >
                                    {formatTick(tick.value)}
                                </text>
                            ))}

                            <TrendChartV2InteractionLayer
                                plotLeft={layout.plotArea.left}
                                plotTop={layout.plotArea.top}
                                plotWidth={chartModel.plotWidth}
                                plotHeight={chartModel.plotHeight}
                                domainStartMs={visibleWindow.startMs}
                                domainEndMs={visibleWindow.endMs}
                                points={chartModel.interactionPoints}
                                hoveredTimestampMs={hoveredTimestampMs}
                                onHoverChange={setHoveredTimestampMs}
                                onZoomSelection={handleZoomSelection}
                                onInvalidSelection={handleInvalidZoomSelection}
                            />
                                </>
                            )}
                            renderOverlay={() => lastRenderablePoint ? (
                                <g pointerEvents="none">
                                    <circle
                                        data-testid="trend-chart-v2-final-point-pulse"
                                        cx={lastRenderablePoint.x}
                                        cy={lastRenderablePoint.y}
                                        r={9}
                                        fill={TOKEN.gradientTo}
                                        fillOpacity={0.45}
                                        className="animate-ping"
                                        style={{ animationDuration: '2s', transformOrigin: `${lastRenderablePoint.x}px ${lastRenderablePoint.y}px` }}
                                    />
                                    <circle
                                        data-testid="trend-chart-v2-final-point-core"
                                        cx={lastRenderablePoint.x}
                                        cy={lastRenderablePoint.y}
                                        r={4}
                                        fill={TOKEN.gradientTo}
                                        stroke={TOKEN.background}
                                        strokeWidth={1.5}
                                    />
                                </g>
                            ) : null}
                        />

                        {hoveredPoint && (
                            <ChartTooltip
                                label={formatTrendChartV2Timestamp({
                                    timestampMs: hoveredPoint.timestampMs,
                                    range: customWindow ? 'custom' : range,
                                    timezone,
                                })}
                                x={hoveredPoint.x}
                                containerWidth={dimensions.width}
                                series={[{
                                    name: widget.title ?? 'Trend Chart V2',
                                    value: `${hoveredPoint.value}${resolvedUnit ? ` ${resolvedUnit}` : ''}`,
                                    color: 'var(--color-widget-gradient-to)',
                                }]}
                            >
                                {hoveredShiftLabel && (
                                    <div className="mt-1 text-industrial-muted">{`Shift: ${hoveredShiftLabel}`}</div>
                                )}
                            </ChartTooltip>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
