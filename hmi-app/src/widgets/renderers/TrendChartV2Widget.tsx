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
    buildTrendChartV2TickValues,
    buildTrendChartV2VisibleTickValues,
    formatTrendChartV2Timestamp,
    resolveTrendChartV2Timezone,
    resolveTrendChartV2VisibleWindow,
    scaleTimestampToChartX,
} from '../../utils/trendChartV2Time';
import {
    buildAreaPath,
    formatTick,
    smoothPath,
} from '../../utils/chartHelpers';
import TrendChartV2InteractionLayer from '../../components/ui/TrendChartV2InteractionLayer';
import ChartTooltip from '../../components/ui/ChartTooltip';
import WidgetSegmentedControl from '../../components/ui/WidgetSegmentedControl';
import WidgetHeader from '../../components/ui/WidgetHeader';

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

const MARGIN = { top: 8, right: 12, bottom: 24, left: 38 } as const;
const Y_AXIS_LABEL_X = MARGIN.left - 8;
const MIN_RENDERABLE_CHART_SIZE = {
    width: MARGIN.left + MARGIN.right + 24,
    height: MARGIN.top + MARGIN.bottom + 24,
} as const;
const TOKEN = {
    gradientFrom: 'var(--color-widget-gradient-from)',
    gradientTo: 'var(--color-widget-gradient-to)',
    background: 'var(--color-industrial-bg)',
    border: 'var(--color-industrial-border)',
    text: 'var(--color-industrial-text)',
    muted: 'var(--color-industrial-muted)',
    grid: 'var(--color-chart-grid)',
} as const;

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
    const timezone = resolveTrendChartV2Timezone(v2Data?.window?.timezone, resolvedTimezone);

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

    const chartModel = useMemo(() => {
        const plotWidth = Math.max(dimensions.width - MARGIN.left - MARGIN.right, 1);
        const plotHeight = Math.max(dimensions.height - MARGIN.top - MARGIN.bottom, 1);
        const rangeY = Math.max(valueDomain.max - valueDomain.min, 1);
        const toY = (value: number) => MARGIN.top + plotHeight - (((value - valueDomain.min) / rangeY) * plotHeight);
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
                    x0: MARGIN.left,
                    plotWidth,
                }),
                y: toY(point.value),
            }));

        const valueTicks = Array.from({ length: 5 }, (_, index) => ({
            value: valueDomain.max - (((valueDomain.max - valueDomain.min) * index) / 4),
            y: MARGIN.top + ((index / 4) * plotHeight),
        }));

        return {
            plotWidth,
            plotHeight,
            segments,
            interactionPoints,
            toY,
            tickValues: buildTrendChartV2TickValues(visibleWindow.startMs, visibleWindow.endMs),
            valueTicks,
        };
    }, [customWindow, dimensions.height, dimensions.width, numericPoints, range, v2Data?.window?.bucketMs, valueDomain.max, valueDomain.min, visibleWindow.endMs, visibleWindow.startMs]);

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
        plotLeft: MARGIN.left,
        plotWidth: chartModel.plotWidth,
        range: customWindow ? 'custom' : range,
        timezone,
    }), [chartModel.plotWidth, customWindow, numericPoints, range, timezone, visibleWindow.endMs, visibleWindow.startMs]);
    const resolvedUnit = v2Data?.unit ?? (resolved.unit ? String(resolved.unit) : undefined);
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
    const hasRenderableDimensions = dimensions.width >= MIN_RENDERABLE_CHART_SIZE.width
        && dimensions.height >= MIN_RENDERABLE_CHART_SIZE.height;
    const emptyStateMessage = isError
        ? (error?.message || 'Error loading history')
        : hasData && !hasRenderableDimensions
            ? 'Preparing chart...'
            : 'Sin datos';
    const emptyStateTone = isError ? 'text-admin-accent' : 'text-industrial-muted';
    const shouldShowState = showLoading || isError || !hasData || !hasRenderableDimensions;

    return (
        <div className={`glass-panel group relative p-5 overflow-hidden w-full h-full flex flex-col ${className ?? ''}`}>
            <WidgetSegmentedControl
                options={RANGE_OPTIONS}
                value={range}
                onChange={(nextRange) => {
                    setRange(nextRange);
                    setCustomWindow(null);
                    setHoveredTimestampMs(null);
                    setZoomMessage(null);
                }}
            >
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
            </WidgetSegmentedControl>

            <WidgetHeader
                title={widget.title || 'Trend Chart V2'}
                subtitle={resolvedUnit ? resolvedUnit.toUpperCase() : undefined}
                icon={HeaderIcon ?? undefined}
                iconPosition="left"
                iconTestId="trend-chart-v2-header-icon"
                className="mb-3 shrink-0 min-w-0 max-w-[calc(100%-220px)]"
            />

            {visibleSummary && (
                <div className="mb-2 flex items-center justify-center gap-4 shrink-0">
                    <span className="uppercase text-industrial-muted">Min {formatTick(visibleSummary.min)}</span>
                    <span className="uppercase text-industrial-muted">Max {formatTick(visibleSummary.max)}</span>
                    <span className="uppercase text-industrial-muted">Avg {formatTick(visibleSummary.avg)}</span>
                </div>
            )}

            {zoomMessage && hasData && hasRenderableDimensions && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] uppercase text-industrial-muted">
                    <span className="text-admin-accent">{zoomMessage}</span>
                </div>
            )}

            <div ref={containerRef} className="relative flex-1 min-h-0 -mx-3 -mb-3">
                {showLoading ? (
                    <div className="flex h-full w-full items-center justify-center">
                        <div className="animate-pulse text-industrial-muted uppercase">
                            Cargando datos...
                        </div>
                    </div>
                ) : shouldShowState ? (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-industrial-border bg-industrial-surface/60 px-4 text-center text-sm text-industrial-muted">
                        <span className="text-industrial-text leading-none">--</span>
                        <span className={`uppercase ${emptyStateTone}`}>{emptyStateMessage}</span>
                    </div>
                ) : (
                    <>
                        <svg data-testid="trend-chart-v2-svg" width={dimensions.width} height={dimensions.height} viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}>
                            <defs>
                                <linearGradient id={lineGradientId} gradientUnits="userSpaceOnUse" x1={MARGIN.left} y1="0" x2={MARGIN.left + chartModel.plotWidth} y2="0">
                                    <stop offset="0%" stopColor={TOKEN.gradientFrom} stopOpacity={0.7} />
                                    <stop offset="100%" stopColor={TOKEN.gradientTo} stopOpacity={0.98} />
                                </linearGradient>

                                <linearGradient id={areaGradientId} gradientUnits="userSpaceOnUse" x1={MARGIN.left} y1="0" x2={MARGIN.left + chartModel.plotWidth} y2="0">
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
                                    <feGaussianBlur stdDeviation="3" result="blur" />
                                    <feMerge>
                                        <feMergeNode in="blur" />
                                        <feMergeNode in="SourceGraphic" />
                                    </feMerge>
                                </filter>
                            </defs>

                            {chartModel.valueTicks.map((tick) => (
                                <line
                                    key={`grid-${tick.y}`}
                                    data-testid="trend-chart-v2-y-grid-line"
                                    x1={MARGIN.left}
                                    x2={MARGIN.left + chartModel.plotWidth}
                                    y1={tick.y}
                                    y2={tick.y}
                                    stroke={TOKEN.grid}
                                    strokeDasharray="3 3"
                                />
                            ))}

                            {showShifts && shiftIntervals.map((interval) => {
                                const x = scaleTimestampToChartX({
                                    timestampMs: interval.startMs,
                                    startMs: visibleWindow.startMs,
                                    endMs: visibleWindow.endMs,
                                    x0: MARGIN.left,
                                    plotWidth: chartModel.plotWidth,
                                });
                                const endX = scaleTimestampToChartX({
                                    timestampMs: interval.endMs,
                                    startMs: visibleWindow.startMs,
                                    endMs: visibleWindow.endMs,
                                    x0: MARGIN.left,
                                    plotWidth: chartModel.plotWidth,
                                });

                                return resolvedShiftDisplayMode === 'bands'
                                    ? (
                                        <rect
                                            key={`${interval.shiftId}-${interval.startMs}`}
                                             data-testid="trend-chart-v2-shift-band"
                                            x={x}
                                            y={MARGIN.top}
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
                                            y1={MARGIN.top}
                                            y2={MARGIN.top + chartModel.plotHeight}
                                            stroke="var(--color-admin-accent)"
                                            strokeOpacity={0.28}
                                            strokeDasharray="4 4"
                                        />
                                    );
                            })}

                            <line x1={MARGIN.left} y1={MARGIN.top + chartModel.plotHeight} x2={MARGIN.left + chartModel.plotWidth} y2={MARGIN.top + chartModel.plotHeight} stroke="var(--color-industrial-border)" />
                            <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={MARGIN.top + chartModel.plotHeight} stroke="var(--color-industrial-border)" />

                            {chartModel.segments.map((segment, index) => {
                                const anchorPoint = leadingEdgeAnchor?.segmentIndex === index
                                    ? {
                                        x: MARGIN.left,
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
                                            x0: MARGIN.left,
                                            plotWidth: chartModel.plotWidth,
                                        }),
                                        y: chartModel.toY(point.value),
                                    })),
                                ];
                                const linePath = renderablePoints.length >= 2 ? smoothPath(renderablePoints) : '';
                                const areaPath = renderablePoints.length >= 2
                                    ? buildAreaPath(linePath, renderablePoints, MARGIN.top + chartModel.plotHeight)
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
                                                strokeWidth={2.5}
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

                            {lastRenderablePoint && (
                                <g>
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
                            )}

                            {xTickValues.map((tickValue, index) => {
                                const lastIndex = xTickValues.length - 1;

                                return (
                                    <text
                                        key={tickValue}
                                        x={scaleTimestampToChartX({
                                            timestampMs: tickValue,
                                            startMs: visibleWindow.startMs,
                                            endMs: visibleWindow.endMs,
                                            x0: MARGIN.left,
                                            plotWidth: chartModel.plotWidth,
                                        })}
                                        y={dimensions.height - 8}
                                        textAnchor={index === 0 ? 'start' : index === lastIndex ? 'end' : 'middle'}
                                        fill="var(--color-industrial-muted)"
                                        fontSize="var(--font-size-chart)"
                                        fontFamily="var(--font-chart)"
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
                                    x={Y_AXIS_LABEL_X}
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
                                plotLeft={MARGIN.left}
                                plotTop={MARGIN.top}
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
                        </svg>

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
