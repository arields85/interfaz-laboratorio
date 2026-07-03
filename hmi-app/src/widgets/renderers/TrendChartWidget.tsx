import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EquipmentSummary } from '../../domain/equipment.types';
import {
    HISTORY_RANGES,
    HISTORY_RANGE_LABELS,
    type ContractMachine,
    type HistoryRange,
} from '../../domain/dataContract.types';
import { TrendingUp } from 'lucide-react';
import type { TrendChartDisplayOptions, TrendChartWidgetConfig, ThresholdRule } from '../../domain/admin.types';
import { isDataHistoryEnabled } from '../../config/dataConnection.config';
import { useDataHistory } from '../../queries/useDataHistory';
import { resolveBinding } from '../resolvers/bindingResolver';
import { generateTrendData } from '../../utils/trendDataGenerator';
import {
    smoothPath,
    buildAreaPath,
    formatTick,
    clamp,
    getChartLetterSpacingPx,
    getChartTextFont,
    type Point,
} from '../../utils/chartHelpers';
import WidgetHeader from '../../components/ui/WidgetHeader';
import WidgetHeaderTemporalControls from '../../components/ui/WidgetHeaderTemporalControls';
import ChartTooltip from '../../components/ui/ChartTooltip';
import type { ChartTooltipSeries } from '../../components/ui/ChartTooltip';
import ChartHoverLayer from '../../components/ui/ChartHoverLayer';
import WidgetRuntimeState from '../../components/ui/WidgetRuntimeState';
import WidgetChartLayout from '../../components/ui/WidgetChartLayout';
import {
    resolveWidgetChartLayoutMetrics,
    WIDGET_CHART_CONTAINER_CLASS,
    WIDGET_CHART_HEADER_CLASS,
} from '../../components/ui/WidgetChartLayout.shared';
import { isDataHistoryConnectionError } from '../../services/dataHistory.service';
import { buildTrendChartVisibleLabelIndices } from './trendChartVisibleLabels';

const SYSTEM_TEXT_STYLE = {
    fontSize: 'var(--font-size-system)',
    fontFamily: 'var(--font-system)',
    fontWeight: 'var(--font-weight-system)',
    letterSpacing: 'var(--tracking-system)',
} as const;

// =============================================================================
// TrendChartWidget
// Renderer para widgets de tipo 'trend-chart'.
// Renderiza un gráfico de tendencia temporal en SVG puro.
//
// Datos: consume histórico real cuando está disponible y conserva
// generateTrendData como fallback visual para bindings sin endpoint.
//
// Estética: Dark Industrial Theme con gradientes del sistema de tokens.
// Colores: NUNCA hardcodeados — siempre via var(--color-*) del @theme {}.
// =============================================================================

const TOKEN = {
    gradientFrom: 'var(--color-widget-gradient-from)',
    gradientTo: 'var(--color-widget-gradient-to)',
    lineGlow: 'drop-shadow(0 0 18px color-mix(in srgb, var(--color-widget-gradient-from) 55%, transparent))',
    statusCritical: 'var(--color-status-critical)',
    statusWarning: 'var(--color-status-warning)',
    background: 'var(--color-industrial-bg)',
    border: 'var(--color-industrial-border)',
    muted: 'var(--color-industrial-muted)',
    grid: 'var(--color-chart-grid)',
    icon: 'var(--color-widget-icon)',
} as const;

const TREND_CHART_LAYOUT_MARGIN = {
    top: 10,
    right: 12,
    bottom: 24,
    left: 45,
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

interface TrendChartWidgetProps {
    widget: TrendChartWidgetConfig;
    equipmentMap: Map<string, EquipmentSummary>;
    machines?: ContractMachine[];
    isLoadingData?: boolean;
    className?: string;
}

interface TrendChartSvgProps {
    widgetId: string;
    width: number;
    height: number;
    data: Array<{ time: string; value: number }>;
    domainMin: number;
    domainMax: number;
    unit?: string;
    summary?: {
        min: number | null;
        max: number | null;
        avg: number | null;
    };
    thresholds?: ThresholdRule[];
    lineStrokeWidth: number;
    lineGlowBlur: number;
    hoveredIndex: number | null;
    onHoverChange: (index: number | null, x?: number) => void;
}

interface TrendChartContainerProps {
    widgetId: string;
    data: Array<{ time: string; value: number }>;
    domainMin: number;
    domainMax: number;
    thresholds?: ThresholdRule[];
    seriesName: string;
    unit?: string;
    summary?: {
        min: number | null;
        max: number | null;
        avg: number | null;
    };
    lineStrokeWidth: number;
    lineGlowBlur: number;
}

const MONTH_SHORT_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;

const HISTORY_RANGE_OPTIONS = HISTORY_RANGES.map((range) => ({
    value: range,
    label: HISTORY_RANGE_LABELS[range],
}));

/**
 * Formatea un timestamp ISO UTC a hora local del browser.
 * Usa Date.getHours/getMinutes/etc. que SIEMPRE devuelven hora local,
 * sin depender de Intl.DateTimeFormat ni de la detección de timezone.
 */
function formatHistoryTimestamp(timestamp: string, range: HistoryRange): string {
    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
        return '--';
    }

    if (range === 'minuto' || range === 'hora') {
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
    }

    if (range === 'dia' || range === 'semana') {
        const dd = String(date.getDate()).padStart(2, '0');
        const mo = String(date.getMonth() + 1).padStart(2, '0');
        return `${dd}/${mo}`;
    }

    return MONTH_SHORT_ES[date.getMonth()];
}

function formatSummaryValue(value: number | null): string {
    return value === null ? '--' : formatTick(value);
}

function formatSummarySlotValue(value: number | null, unit?: string): string {
    const formattedValue = formatSummaryValue(value);
    const normalizedUnit = unit?.trim().toLowerCase();

    return normalizedUnit ? `${formattedValue}${normalizedUnit}` : formattedValue;
}

function TrendChartSvg({
    widgetId,
    width,
    height,
    data,
    domainMin,
    domainMax,
    unit,
    summary,
    thresholds,
    lineStrokeWidth,
    lineGlowBlur,
    hoveredIndex,
    onHoverChange,
}: TrendChartSvgProps) {
    if (width <= 0 || height <= 0 || data.length === 0) return null;

    const xLabels = data.map((item) => item.time);
    const chartFont = getChartTextFont();
    const chartLetterSpacing = getChartLetterSpacingPx();
    const hasUnit = Boolean(unit);
    const hasSummary = Boolean(summary);
    const yTicks = Array.from({ length: 5 }, (_, index) => ({
        value: domainMax - (((domainMax - domainMin) * index) / 4),
    }));
    const chartLayout = resolveWidgetChartLayoutMetrics({
        width,
        height,
        hasTopAdornments: hasUnit || hasSummary,
        firstXAxisLabel: xLabels[0] ?? '',
        lastXAxisLabel: xLabels[xLabels.length - 1] ?? '',
        yAxisTickLabels: yTicks.map((tick) => formatTick(tick.value)),
        idPrefix: widgetId,
        font: chartFont,
        letterSpacing: chartLetterSpacing,
        baseMargin: TREND_CHART_LAYOUT_MARGIN,
        topAdornmentReservedHeight: 12,
        topAdornmentOffset: 11,
        alignPlotAreaToXAxisLabels: true,
    });
    const plotWidth = chartLayout.plotArea.width;
    const plotHeight = chartLayout.plotArea.height;
    const step = plotWidth / Math.max(data.length - 1, 1);
    const x0 = chartLayout.plotArea.left;

    const range = Math.max(domainMax - domainMin, 1);
    const toY = (value: number) => {
        const ratio = clamp((value - domainMin) / range, 0, 1);
        return chartLayout.plotArea.top + plotHeight - (ratio * plotHeight);
    };

    const points: Point[] = data.map((item, index) => ({
        x: x0 + (index * step),
        y: toY(item.value),
    }));

    const linePath = smoothPath(points);
    const areaPath = buildAreaPath(linePath, points, chartLayout.plotArea.bottom);
    const lastPoint = points[points.length - 1];

    const gridLines = Array.from({ length: 5 }, (_, index) => ({
        y: chartLayout.plotArea.top + ((index / 4) * plotHeight),
    }));

    const resolvedYTicks = yTicks.map((tick, index) => ({
        ...tick,
        y: chartLayout.plotArea.top + ((index / 4) * plotHeight),
    }));

    const lineGradientId = `trend-line-grad-${widgetId}`;
    const colorGradientId = `trend-color-grad-${widgetId}`;
    const fadeGradientId = `trend-fade-grad-${widgetId}`;
    const maskId = `trend-mask-${widgetId}`;
    const glowId = `trend-glow-${widgetId}`;

    return (
        <WidgetChartLayout
            layout={chartLayout}
            svgTestId="trend-chart-svg"
            overlaySvgTestId="trend-chart-overlay-svg"
            renderMain={(layout) => {
                const xPositions = data.map((_, index) => x0 + (index * step));
                const visibleIndices = new Set(buildTrendChartVisibleLabelIndices({
                    labels: xLabels,
                    positions: xPositions,
                    plotWidth,
                    font: chartFont,
                    letterSpacing: chartLetterSpacing,
                    minGap: 8,
                }));

                return (
                    <>
                        <defs>
                            <linearGradient id={lineGradientId} x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stopColor={TOKEN.gradientFrom} stopOpacity={0.7} />
                                <stop offset="100%" stopColor={TOKEN.gradientTo} stopOpacity={0.7} />
                            </linearGradient>

                            <linearGradient id={colorGradientId} x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stopColor={TOKEN.gradientFrom} />
                                <stop offset="100%" stopColor={TOKEN.gradientTo} />
                            </linearGradient>

                            <linearGradient id={fadeGradientId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="white" stopOpacity={0.7} />
                                <stop offset="100%" stopColor="white" stopOpacity={0} />
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
                                data-testid="trend-chart-y-axis-unit"
                                x={layout.yAxisUnitSlot.x}
                                y={layout.yAxisUnitSlot.y}
                                textAnchor={layout.yAxisUnitSlot.textAnchor}
                                fill={TOKEN.icon}
                                fontSize={SYSTEM_TEXT_STYLE.fontSize}
                                fontFamily={SYSTEM_TEXT_STYLE.fontFamily}
                                fontWeight={SYSTEM_TEXT_STYLE.fontWeight}
                                letterSpacing={SYSTEM_TEXT_STYLE.letterSpacing}
                            >
                                {unit?.toUpperCase()}
                            </text>
                        )}

                        {summary && (
                            <text
                                data-testid="trend-chart-summary"
                                x={layout.topMetaSlot.x}
                                y={layout.topMetaSlot.y}
                                textAnchor={layout.topMetaSlot.textAnchor}
                                fill={TOKEN.muted}
                                fontSize={SYSTEM_TEXT_STYLE.fontSize}
                                fontFamily={SYSTEM_TEXT_STYLE.fontFamily}
                                fontWeight={SYSTEM_TEXT_STYLE.fontWeight}
                                letterSpacing={SYSTEM_TEXT_STYLE.letterSpacing}
                            >
                                <tspan data-testid="trend-chart-summary-min">
                                    {`min ${formatSummarySlotValue(summary.min, unit)}`}
                                </tspan>
                                <tspan data-testid="trend-chart-summary-max" dx="12">
                                    {`max ${formatSummarySlotValue(summary.max, unit)}`}
                                </tspan>
                                <tspan data-testid="trend-chart-summary-avg" dx="12">
                                    {`avg ${formatSummarySlotValue(summary.avg, unit)}`}
                                </tspan>
                            </text>
                        )}

                        {gridLines.map(({ y }) => (
                            <line
                                key={y}
                                x1={layout.plotArea.left}
                                x2={layout.plotArea.right}
                                y1={y}
                                y2={y}
                                stroke={TOKEN.grid}
                                strokeDasharray="3 3"
                            />
                        ))}

                        <line
                            x1={layout.plotArea.left}
                            y1={layout.plotArea.top}
                            x2={layout.plotArea.left}
                            y2={layout.plotArea.bottom}
                            stroke={TOKEN.border}
                        />
                        <line
                            x1={layout.plotArea.left}
                            y1={layout.plotArea.bottom}
                            x2={layout.plotArea.right}
                            y2={layout.plotArea.bottom}
                            stroke={TOKEN.border}
                        />

                        {thresholds?.map((t, idx) => {
                            const ty = toY(t.value);
                            if (ty < layout.plotArea.top || ty > layout.plotArea.bottom) return null;
                            const color = t.severity === 'critical' ? TOKEN.statusCritical : TOKEN.statusWarning;

                            return (
                                <g key={`threshold-${idx}`}>
                                    <line
                                        x1={layout.plotArea.left}
                                        x2={layout.plotArea.right}
                                        y1={ty}
                                        y2={ty}
                                        stroke={color}
                                        strokeDasharray="6 3"
                                        strokeWidth={1.5}
                                    />
                                    <text
                                        x={layout.plotArea.right - 4}
                                        y={ty - 6}
                                        textAnchor="end"
                                        fill={color}
                                        fontSize="var(--font-size-chart)"
                                        fontFamily="var(--font-chart)"
                                        fontWeight="var(--font-weight-chart)"
                                        letterSpacing="var(--tracking-chart)"
                                    >
                                        {t.label || (t.severity === 'critical' ? 'CRIT' : 'WARN')}
                                    </text>
                                </g>
                            );
                        })}

                        <g clipPath={`url(#${layout.plotClipPathId})`}>
                            {areaPath.length > 0 && (
                                <path
                                    d={areaPath}
                                    fill={`url(#${colorGradientId})`}
                                    mask={`url(#${maskId})`}
                                />
                            )}

                            {linePath.length > 0 && (
                                <path
                                    d={linePath}
                                    stroke={`url(#${lineGradientId})`}
                                    strokeWidth={lineStrokeWidth}
                                    fill="none"
                                    filter={`url(#${glowId})`}
                                />
                            )}
                        </g>

                        {data.map((item, index) => {
                            if (!visibleIndices.has(index)) return null;
                            return (
                                <text
                                    key={`x-label-${index}`}
                                    data-testid="trend-chart-x-axis-label"
                                    x={x0 + (index * step)}
                                    y={layout.xAxisLabels.y}
                                    textAnchor="middle"
                                    fill={TOKEN.muted}
                                    fontSize="var(--font-size-chart)"
                                    fontFamily="var(--font-chart)"
                                    fontWeight="var(--font-weight-chart)"
                                    letterSpacing="var(--tracking-chart)"
                                >
                                    {item.time}
                                </text>
                            );
                        })}

                        {resolvedYTicks.map((tick, index) => (
                            <text
                                key={`y-tick-${index}`}
                                x={layout.plotArea.left - 8}
                                y={tick.y}
                                dy={4}
                                textAnchor="end"
                                fill={TOKEN.muted}
                                fontSize="var(--font-size-chart)"
                                fontFamily="var(--font-chart)"
                                fontWeight="var(--font-weight-chart)"
                                letterSpacing="var(--tracking-chart)"
                            >
                                {formatTick(tick.value)}
                            </text>
                        ))}

                        <ChartHoverLayer
                            dataLength={data.length}
                            x0={x0}
                            step={step}
                            marginTop={layout.plotArea.top}
                            marginLeft={layout.plotArea.left}
                            plotWidth={plotWidth}
                            plotHeight={plotHeight}
                            hoveredIndex={hoveredIndex}
                            onHoverChange={onHoverChange}
                            indicatorColor={TOKEN.muted}
                            highlightBorderColor={TOKEN.background}
                            highlights={hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < data.length
                                ? [{ x: points[hoveredIndex].x, y: points[hoveredIndex].y, color: TOKEN.gradientTo }]
                                : undefined}
                        />
                    </>
                );
            }}
            renderOverlay={() => lastPoint ? (
                <g pointerEvents="none">
                    <circle
                        data-testid="trend-chart-final-point-pulse"
                        cx={lastPoint.x}
                        cy={lastPoint.y}
                        r={9}
                        fill={TOKEN.gradientTo}
                        fillOpacity={0.45}
                        className="animate-ping"
                        style={{ animationDuration: '2s', transformOrigin: `${lastPoint.x}px ${lastPoint.y}px` }}
                    />
                    <circle
                        data-testid="trend-chart-final-point-core"
                        cx={lastPoint.x}
                        cy={lastPoint.y}
                        r={4}
                        fill={TOKEN.gradientTo}
                        stroke={TOKEN.background}
                        strokeWidth={1.5}
                    />
                </g>
            ) : null}
        />
    );
}

function TrendChartContainer({
    widgetId,
    data,
    domainMin,
    domainMax,
    thresholds,
    seriesName,
    unit,
    summary,
    lineStrokeWidth,
    lineGlowBlur,
}: TrendChartContainerProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [hoverInfo, setHoverInfo] = useState<{ index: number; x: number } | null>(null);

    const handleHoverChange = useCallback((index: number | null, x?: number) => {
        setHoveredIndex(index);
        setHoverInfo(index !== null && x !== undefined ? { index, x } : null);
    }, []);

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            setDimensions({ width, height });
        });

        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={ref} className="h-full w-full relative">
            <TrendChartSvg
                widgetId={widgetId}
                width={dimensions.width}
                height={dimensions.height}
                data={data}
                domainMin={domainMin}
                domainMax={domainMax}
                unit={unit}
                summary={summary}
                thresholds={thresholds}
                lineStrokeWidth={lineStrokeWidth}
                lineGlowBlur={lineGlowBlur}
                hoveredIndex={hoveredIndex}
                onHoverChange={handleHoverChange}
            />

            {hoverInfo && hoverInfo.index >= 0 && hoverInfo.index < data.length && (() => {
                const point = data[hoverInfo.index];
                const series: ChartTooltipSeries[] = [{
                    name: seriesName,
                    value: `${point.value}${unit ? ` ${unit}` : ''}`,
                    color: TOKEN.gradientTo,
                }];

                return (
                    <ChartTooltip
                        label={point.time}
                        series={series}
                        x={hoverInfo.x}
                        containerWidth={dimensions.width}
                    />
                );
            })()}
        </div>
    );
}

export default function TrendChartWidget({
    widget,
    equipmentMap,
    machines,
    isLoadingData = false,
    className,
}: TrendChartWidgetProps) {
    const [range, setRange] = useState<HistoryRange>('hora');
    const resolved = resolveBinding(widget, equipmentMap, machines);
    const isSimulated = widget.binding?.mode === 'simulated_value';
    const bindingMachineId = widget.binding?.machineId;
    const bindingVariableKey = widget.binding?.variableKey;
    const historyEnabled = isDataHistoryEnabled();

    // Solo consultar histórico cuando el origen es real (no simulado)
    const historyParams = !isSimulated && bindingMachineId !== undefined && bindingVariableKey && historyEnabled
        ? { machineId: bindingMachineId, variableKey: bindingVariableKey, range }
        : null;
    const {
        data: historyData,
        isLoading: isLoadingHistory,
        isError: isHistoryError,
        error: historyError,
    } = useDataHistory(historyParams);

    const baseValue = resolved.value == null
        ? null
        : typeof resolved.value === 'number'
            ? resolved.value
            : typeof resolved.value === 'string'
                ? (() => {
                    const parsed = parseFloat(resolved.value);
                    return Number.isNaN(parsed) ? 50 : parsed;
                })()
                : 50;

    // Datos simulados: solo cuando el binding está en modo simulado
    const trendData = useMemo(
        () => isSimulated && baseValue !== null ? generateTrendData(baseValue, undefined, 24) : [],
        [baseValue, isSimulated],
    );

    const historyTrendData = useMemo(
        () => historyData?.series
            ?.filter((point): point is { timestamp: string; value: number } => point.value !== null)
            .map((point) => ({
                time: formatHistoryTimestamp(point.timestamp, range),
                value: point.value,
            })) ?? [],
        [historyData?.series, range],
    );

    // Modo simulado → trendData; Modo real → historyTrendData (puede estar vacío)
    const chartData = isSimulated
        ? trendData
        : historyTrendData;

    const yValues = chartData.map((d) => d.value);
    const yMin = yValues.length > 0 ? Math.min(...yValues) : 0;
    const yMax = yValues.length > 0 ? Math.max(...yValues) : 0;
    const yPadding = yValues.length > 0 ? (yMax - yMin) * 0.2 || 5 : 0;
    const domainMin = yValues.length > 0 ? Math.floor(yMin - yPadding) : 0;
    const domainMax = yValues.length > 0 ? Math.ceil(yMax + yPadding) : 0;
    const resolvedUnit = historyData?.unit ?? (resolved.unit ? String(resolved.unit) : undefined);
    const hasBinding = bindingMachineId !== undefined && Boolean(bindingVariableKey);
    const chartSummary = historyData?.summary && chartData === historyTrendData && historyTrendData.length > 0
        ? historyData.summary
        : undefined;
    const noDataRuntimeState = isHistoryError
        ? (isDataHistoryConnectionError(historyError) ? 'disconnected' : 'error')
        : 'empty';
    const displayOptions = widget.displayOptions as TrendChartDisplayOptions | undefined;
    const lineStrokeWidth = clampLineStrokeWidth(displayOptions?.lineStrokeWidth);
    const lineGlowBlur = clampLineGlowBlur(displayOptions?.lineGlowBlur);

    // Modo real cargando → skeleton; Modo simulado no muestra loading por histórico
    const isRealLoading = !isSimulated && historyParams !== null && isLoadingHistory;
    // Sin datos: modo real sin serie + sin error, o simulado sin binding
    const isNoData = isSimulated
        ? (chartData.length === 0 && (!hasBinding || baseValue === null))
        : (!isLoadingHistory && chartData.length === 0);

    if (isLoadingData || isRealLoading) {
        return (
            <div className={`glass-panel p-5 w-full h-full flex items-center justify-center ${className ?? ''}`}>
                <WidgetRuntimeState state="loading" testId="trend-chart-widget-loading" />
            </div>
        );
    }

    return (
        <div className={`glass-panel group relative p-5 overflow-hidden w-full h-full flex flex-col ${className ?? ''}`}>
            <WidgetHeader
                title={widget.title ?? 'Trend Chart'}
                icon={TrendingUp}
                iconColor={TOKEN.icon}
                iconPosition="left"
                className={WIDGET_CHART_HEADER_CLASS}
                trailing={(
                    <WidgetHeaderTemporalControls
                        variant="pill"
                        testId="trend-chart-widget-runtime-controls"
                        indicatorTestId="trend-chart-widget-runtime-control-indicator"
                        groups={[
                            {
                                testId: 'trend-chart-widget-runtime-range-selector',
                                options: HISTORY_RANGE_OPTIONS,
                                selectedValue: range,
                                onSelect: (value) => setRange(value as HistoryRange),
                            },
                        ]}
                    />
                )}
            />

            <div className={WIDGET_CHART_CONTAINER_CLASS}>
                {isNoData ? (
                    !isSimulated ? (
                        <WidgetRuntimeState
                            state={noDataRuntimeState}
                            testId="trend-chart-widget-state"
                        />
                    ) : null
                ) : (
                    <TrendChartContainer
                        widgetId={widget.id}
                        data={chartData}
                        domainMin={domainMin}
                        domainMax={domainMax}
                        thresholds={widget.thresholds}
                        seriesName={widget.title ?? 'Valor'}
                        unit={resolvedUnit}
                        summary={chartSummary}
                        lineStrokeWidth={lineStrokeWidth}
                        lineGlowBlur={lineGlowBlur}
                    />
                )}
            </div>

        </div>
    );
}
