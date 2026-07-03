import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
    Activity,
    Droplet,
    Fan,
    FoldVertical,
    Gauge,
    HeartPulse,
    History,
    LineChart,
    BarChart2,
    Siren,
    Settings,
    Thermometer,
    TrendingUp,
    Wifi,
    Wind,
    Zap,
    type LucideIcon,
} from 'lucide-react';
import type {
    ProductionChartMode,
    ProductionUnit,
    ProdHistoryWidgetConfig,
    TemporalBucket,
    ProdHistoryPersistedDisplayPatch,
} from '../../domain/admin.types';
import WidgetHeader from '../../components/ui/WidgetHeader';
import type { EquipmentSummary } from '../../domain/equipment.types';
import {
    groupByTemporalBucket,
    type TemporalGroupedPoint,
    type TemporalTrendPoint,
} from '../../utils/temporalGrouping';
import ChartTooltip from '../../components/ui/ChartTooltip';
import type { ChartTooltipSeries } from '../../components/ui/ChartTooltip';
import ChartHoverLayer from '../../components/ui/ChartHoverLayer';
import WidgetHeaderTemporalControls from '../../components/ui/WidgetHeaderTemporalControls';
import WidgetRuntimeCheckbox from '../../components/ui/WidgetRuntimeCheckbox';
import WidgetRuntimeToggle from '../../components/ui/WidgetRuntimeToggle';
import WidgetRuntimeState from '../../components/ui/WidgetRuntimeState';
import WidgetChartLayout from '../../components/ui/WidgetChartLayout';
import {
    resolveWidgetChartLayoutMetrics,
    WIDGET_CHART_CONTAINER_CLASS,
    WIDGET_CHART_HEADER_CLASS,
} from '../../components/ui/WidgetChartLayout.shared';
import {
    smoothPath,
    buildAreaPath,
    formatTick,
    clamp,
    round2,
    computeVisibleLabelIndices,
    getChartLetterSpacingPx,
    getChartTextFont,
} from '../../utils/chartHelpers';

const PROD_HISTORY_LAYOUT_BASE_MARGIN = { top: 17, right: 16, bottom: 30, left: 48 } as const;
const PROD_HISTORY_RIGHT_AXIS_MARGIN_RIGHT = 48;
const PROD_HISTORY_TOP_ADORNMENT_RESERVED_HEIGHT = 11;
const PROD_HISTORY_TOP_ADORNMENT_OFFSET = 12;
const PROD_HISTORY_TOP_CAP_HEIGHT_PX = 2;
const DEFAULT_OEE_LINE_STROKE_WIDTH = 2.5;
const DEFAULT_OEE_LINE_GLOW_BLUR = 3;
const DEFAULT_PRODUCTION_LINE_STROKE_WIDTH = 2.5;
const DEFAULT_PRODUCTION_LINE_GLOW_BLUR = 3;
const MIN_LINE_STROKE_WIDTH = 0.5;
const MAX_LINE_STROKE_WIDTH = 6;
const MIN_LINE_GLOW_BLUR = 0;
const MAX_LINE_GLOW_BLUR = 8;

// Resolución de ícono del header por nombre declarado en `displayOptions.icon`.
// El set disponible coincide con el selector de íconos del PropertyDock, así que
// lo que el usuario elige en el dock siempre resuelve a un componente válido.
// `null` explícito = sin ícono. `undefined` = default semántico del widget (History).
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
    History,
    HeartPulse,
    Siren,
    Wifi,
    BarChart2,
    LineChart,
};

function resolveHeaderIcon(iconName: string | null | undefined): LucideIcon | null {
    if (iconName === null) return null;
    if (iconName === undefined || iconName === '') return History;
    return HEADER_ICON_MAP[iconName] ?? History;
}

function toSentenceCase(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) return trimmed;

    return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1).toLowerCase()}`;
}

const TOKEN = {
    production: 'var(--color-widget-gradient-to)',
    oee: 'var(--color-widget-gradient-from)',
    icon: 'var(--color-widget-icon)',
    background: 'var(--color-industrial-bg)',
    muted: 'var(--color-industrial-muted)',
    grid: 'var(--color-chart-grid)',
} as const;

const GROUPING_OPTIONS: Array<{ value: TemporalBucket; label: string }> = [
    { value: 'hour', label: 'Hora' },
    { value: 'shift', label: 'Turno' },
    { value: 'day', label: 'Día' },
    { value: 'month', label: 'Mes' },
];

const WINDOW_SIZE: Record<TemporalBucket, number> = {
    hour: 24,
    shift: 15,
    day: 14,
    month: 12,
};

interface ProdHistoryWidgetProps {
    widget: ProdHistoryWidgetConfig;
    equipmentMap: Map<string, EquipmentSummary>;
    isLoadingData?: boolean;
    className?: string;
    onPersistDisplayOptions?: (displayOptions: ProdHistoryPersistedDisplayPatch) => void;
}

interface ManualBounds {
    productionAxisMin?: number;
    productionAxisMax?: number;
    oeeAxisMin?: number;
    oeeAxisMax?: number;
}

interface ProdHistoryBarsSvgProps {
    widgetId: string;
    width: number;
    height: number;
    data: TemporalGroupedPoint[];
    productionMode: ProductionChartMode;
    showOee: boolean;
    useSecondaryAxis: boolean;
    showGrid: boolean;
    oeeShowArea: boolean;
    oeeShowPoints: boolean;
    productionLineStrokeWidth: number;
    productionLineGlowBlur: number;
    oeeLineStrokeWidth: number;
    oeeLineGlowBlur: number;
    barWidthFactor: number;
    productionDomain: [number, number];
    oeeDomain: [number, number];
    productionLabel: string;
    oeeLabel: string;
    productionUnit: ProductionUnit;
    hoveredIndex: number | null;
    onHoverChange: (index: number | null, x?: number) => void;
}

type ProdHistoryBarsContainerProps = Omit<ProdHistoryBarsSvgProps, 'width' | 'height' | 'hoveredIndex' | 'onHoverChange'>;

function stepBackByBucket(now: Date, bucket: TemporalBucket, steps: number): Date {
    const date = new Date(now.getTime());

    switch (bucket) {
        case 'hour':
            date.setHours(date.getHours() - steps);
            return date;
        case 'shift':
            date.setHours(date.getHours() - (steps * 8));
            return date;
        case 'day':
            date.setDate(date.getDate() - steps);
            return date;
        case 'month':
            date.setMonth(date.getMonth() - steps);
            return date;
    }
}

function generateHistoricalSeries(bucket: TemporalBucket, reference: Date): TemporalTrendPoint[] {
    const total = WINDOW_SIZE[bucket];

    return Array.from({ length: total }, (_, index) => {
        const stepsFromNow = total - 1 - index;
        const timestamp = stepBackByBucket(reference, bucket, stepsFromNow);
        const seasonal = Math.sin((index / Math.max(total - 1, 1)) * Math.PI * 2);
        const microNoise = Math.sin(index * 0.61) * 1.9;
        const trendDrift = Math.cos(index * 0.27) * 0.8;

        const oee = clamp(74 + seasonal * 8 + microNoise + trendDrift, 58, 93);
        const production = Math.max(90, (oee * 2.15) + 32 + seasonal * 9 + (Math.cos(index * 0.35) * 11));

        return {
            timestamp: timestamp.toISOString(),
            production: round2(production),
            oee: round2(oee),
        };
    });
}

function resolveAutoDomain(values: number[], minPadding: number, maxClamp?: number): [number, number] {
    if (values.length === 0) {
        return [0, maxClamp ?? 100];
    }

    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const padding = Math.max((maxValue - minValue) * 0.2, minPadding);

    const nextMin = Math.max(0, Math.floor(minValue - padding));
    const unclampedMax = Math.ceil(maxValue + padding);
    const nextMax = maxClamp === undefined ? unclampedMax : Math.min(maxClamp, unclampedMax);

    if (nextMin >= nextMax) {
        return [0, maxClamp ?? Math.max(100, unclampedMax + 10)];
    }

    return [nextMin, nextMax];
}

function resolveManualDomain(min?: number, max?: number): [number, number] | null {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === undefined || max === undefined || min >= max) {
        return null;
    }

    return [min, max];
}

function resolveDomains(
    points: TemporalGroupedPoint[],
    autoScale: boolean,
    showOee: boolean,
    manualBounds: ManualBounds,
): { productionDomain: [number, number]; oeeDomain: [number, number] } {
    const productionAuto = resolveAutoDomain(points.map((point) => point.production), 10);
    const oeeAuto = showOee
        ? resolveAutoDomain(points.map((point) => point.oee), 3, 100)
        : [0, 100] as [number, number];
    const productionManual = !autoScale
        ? resolveManualDomain(manualBounds.productionAxisMin, manualBounds.productionAxisMax)
        : null;
    const oeeManual = !autoScale
        ? resolveManualDomain(manualBounds.oeeAxisMin, manualBounds.oeeAxisMax)
        : null;

    const productionDomain = productionManual ?? productionAuto;

    const oeeDomain = oeeManual ?? oeeAuto;

    return { productionDomain, oeeDomain };
}

function clampLineStrokeWidth(value: number | undefined, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return clamp(value as number, MIN_LINE_STROKE_WIDTH, MAX_LINE_STROKE_WIDTH);
}

function clampLineGlowBlur(value: number | undefined, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return clamp(value as number, MIN_LINE_GLOW_BLUR, MAX_LINE_GLOW_BLUR);
}

function ProdHistoryBarsSvg({
    widgetId,
    width,
    height,
    data,
    productionMode,
    showOee,
    useSecondaryAxis,
    showGrid,
    oeeShowArea,
    oeeShowPoints,
    productionLineStrokeWidth,
    productionLineGlowBlur,
    oeeLineStrokeWidth,
    oeeLineGlowBlur,
    barWidthFactor,
    productionDomain,
    oeeDomain,
    productionUnit,
    hoveredIndex,
    onHoverChange,
}: ProdHistoryBarsSvgProps) {
    const layoutId = useId().replace(/:/g, '-');

    if (width <= 0 || height <= 0 || data.length < 2) return null;
    const showRightAxis = showOee && useSecondaryAxis;
    const productionTicks = Array.from({ length: 5 }, (_, index) => ({
        value: productionDomain[1] - (((productionDomain[1] - productionDomain[0]) * index) / 4),
    }));
    const oeeTicks = Array.from({ length: 5 }, (_, index) => ({
        value: oeeDomain[1] - (((oeeDomain[1] - oeeDomain[0]) * index) / 4),
    }));
    const chartLayout = resolveWidgetChartLayoutMetrics({
        width,
        height,
        hasTopAdornments: true,
        firstXAxisLabel: data[0]?.label ?? '',
        lastXAxisLabel: data[data.length - 1]?.label ?? '',
        yAxisTickLabels: productionTicks.map((tick) => formatTick(tick.value)),
        idPrefix: `${widgetId}-${layoutId}`,
        font: getChartTextFont(),
        letterSpacing: getChartLetterSpacingPx(),
        baseMargin: {
            ...PROD_HISTORY_LAYOUT_BASE_MARGIN,
            right: showRightAxis ? PROD_HISTORY_RIGHT_AXIS_MARGIN_RIGHT : PROD_HISTORY_LAYOUT_BASE_MARGIN.right,
        },
        topAdornmentReservedHeight: PROD_HISTORY_TOP_ADORNMENT_RESERVED_HEIGHT,
        topAdornmentOffset: PROD_HISTORY_TOP_ADORNMENT_OFFSET,
        alignPlotAreaToXAxisLabels: true,
    });
    const plotWidth = chartLayout.plotArea.width;
    const plotHeight = chartLayout.plotArea.height;
    const safeBarFactor = clamp(barWidthFactor, 0.5, 1.5);
    const baseStep = data.length > 1 ? Math.max(chartLayout.xAxisLabels.plotWidth / (data.length - 1), 1) : chartLayout.xAxisLabels.plotWidth;
    const barW = Math.max(baseStep * 0.35 * safeBarFactor, 6);
    const padX = barW * 1.0;
    const usableW = Math.max(plotWidth - (2 * padX), 1);
    const step = data.length > 1 ? usableW / (data.length - 1) : 0;
    const x0 = chartLayout.plotArea.left + padX;

    const productionRange = Math.max(productionDomain[1] - productionDomain[0], 1);
    const oeeRenderDomain = showOee && useSecondaryAxis ? oeeDomain : productionDomain;
    const oeeRange = Math.max(oeeRenderDomain[1] - oeeRenderDomain[0], 1);

    const toProductionY = (value: number) => {
        const ratio = clamp((value - productionDomain[0]) / productionRange, 0, 1);
        return chartLayout.plotArea.top + plotHeight - (ratio * plotHeight);
    };

    const toOeeY = (value: number) => {
        const ratio = clamp((value - oeeRenderDomain[0]) / oeeRange, 0, 1);
        return chartLayout.plotArea.top + plotHeight - (ratio * plotHeight);
    };

    const productionPoints = data.map((item, index) => ({
        x: x0 + (index * step),
        y: toProductionY(item.production),
    }));

    const oeePoints = data.map((item, index) => ({
        x: x0 + (index * step),
        y: toOeeY(item.oee),
    }));

    const productionPath = smoothPath(productionPoints);
    const productionAreaPath = buildAreaPath(productionPath, productionPoints, chartLayout.plotArea.bottom);
    const oeePath = smoothPath(oeePoints);
    const oeeAreaPath = buildAreaPath(oeePath, oeePoints, chartLayout.plotArea.bottom);
    const productionPing = productionPoints[productionPoints.length - 1];
    const oeePing = oeePoints[oeePoints.length - 1];

    const resolvedProductionTicks = productionTicks.map((tick, index) => ({
        ...tick,
        y: chartLayout.plotArea.top + ((index / 4) * plotHeight),
    }));

    const resolvedOeeTicks = oeeTicks.map((tick, index) => ({
        ...tick,
        y: chartLayout.plotArea.top + ((index / 4) * plotHeight),
    }));

    const gridLines = Array.from({ length: 5 }, (_, index) => ({
        y: chartLayout.plotArea.top + ((index / 4) * plotHeight),
    }));

    const prodBarGradientId = `prod-bar-grad-${widgetId}`;
    const prodAreaGradientId = `prod-area-grad-${widgetId}`;
    const oeeGradientId = `oee-grad-${widgetId}`;
    const prodGlowId = `prod-glow-${widgetId}`;
    const oeeGlowId = `oee-glow-${widgetId}`;
    const productionPingY = productionPing?.y ?? null;
    const oeePingY = oeePing?.y ?? null;

    return (
        <WidgetChartLayout
            layout={chartLayout}
            svgTestId="prod-history-widget-chart"
            overlaySvgTestId="prod-history-widget-overlay-svg"
            renderMain={(layout) => {
                const xLabels = data.map((item) => item.label);
                const xPositions = productionPoints.map((point) => point.x);
                const visibleIndices = computeVisibleLabelIndices(
                    xLabels,
                    xPositions,
                    getChartTextFont(),
                    8,
                    layout.plotArea.right,
                    getChartLetterSpacingPx(),
                );

                return (
                    <>
                        <defs>
                            <linearGradient id={prodBarGradientId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={TOKEN.production} stopOpacity={0.55} />
                                <stop offset="100%" stopColor={TOKEN.production} stopOpacity={0.10} />
                            </linearGradient>
                            <linearGradient id={prodAreaGradientId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={TOKEN.production} stopOpacity={0.30} />
                                <stop offset="95%" stopColor={TOKEN.production} stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id={oeeGradientId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={TOKEN.oee} stopOpacity={0.30} />
                                <stop offset="95%" stopColor={TOKEN.oee} stopOpacity={0} />
                            </linearGradient>
                            <filter id={prodGlowId} x="-20%" y="-50%" width="140%" height="200%">
                                <feGaussianBlur stdDeviation={productionLineGlowBlur} result="blur" />
                                <feMerge>
                                    <feMergeNode in="blur" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                            <filter id={oeeGlowId} x="-20%" y="-50%" width="140%" height="200%">
                                <feGaussianBlur stdDeviation={oeeLineGlowBlur} result="blur" />
                                <feMerge>
                                    <feMergeNode in="blur" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                        </defs>

                        {showGrid && gridLines.map(({ y }) => (
                            <line
                                key={`grid-${y}`}
                                x1={layout.plotArea.left}
                                x2={layout.plotArea.right}
                                y1={y}
                                y2={y}
                                stroke={TOKEN.grid}
                                strokeDasharray="3 3"
                            />
                        ))}

                        <text
                            data-testid="prod-history-widget-y-axis-unit"
                            x={layout.plotArea.left - 18}
                            y={layout.plotArea.top - 12}
                            textAnchor="middle"
                            fill={TOKEN.muted}
                            fontSize="var(--font-size-chart)"
                            fontFamily="var(--font-chart)"
                            fontWeight="var(--font-weight-chart)"
                            letterSpacing="var(--tracking-chart)"
                            opacity={0.8}
                        >
                            {productionUnit}
                        </text>

                        <g clipPath={`url(#${layout.plotClipPathId})`}>
                            {showOee && oeeShowArea && oeeAreaPath.length > 0 && (
                                <path d={oeeAreaPath} fill={`url(#${oeeGradientId})`} />
                            )}

                            {productionMode === 'bars'
                                ? data.map((item, index) => {
                                    const cx = x0 + (index * step);
                                    const barTop = toProductionY(item.production);
                                    const barBase = chartLayout.plotArea.bottom;
                                    const barHeight = Math.max(barBase - barTop, 0);
                                    const barX = cx - (barW / 2);
                                    const capHeight = Math.min(PROD_HISTORY_TOP_CAP_HEIGHT_PX, barHeight);

                                    return (
                                        <g key={item.bucketKey}>
                                            <rect x={barX} y={barTop} width={barW} height={barHeight} fill={`url(#${prodBarGradientId})`} />
                                            <rect
                                                x={barX}
                                                y={barTop}
                                                width={barW}
                                                height={capHeight}
                                                fill={TOKEN.production}
                                                style={{ filter: `drop-shadow(0 0 6px ${TOKEN.production})` }}
                                            />
                                        </g>
                                    );
                                })
                                : productionAreaPath.length > 0 && (
                                    <path d={productionAreaPath} fill={`url(#${prodAreaGradientId})`} />
                                )}

                            {productionMode === 'area' && productionPath.length > 0 && (
                                <path
                                    d={productionPath}
                                    stroke={TOKEN.production}
                                    strokeWidth={productionLineStrokeWidth}
                                    fill="none"
                                    filter={`url(#${prodGlowId})`}
                                />
                            )}

                            {showOee && oeePath.length > 0 && (
                                <path
                                    d={oeePath}
                                    stroke={TOKEN.oee}
                                    strokeWidth={oeeLineStrokeWidth}
                                    fill="none"
                                    filter={`url(#${oeeGlowId})`}
                                />
                            )}

                            {showOee && oeeShowPoints && oeePoints.map((point, index) => (
                                <circle
                                    key={`oee-point-${data[index].bucketKey}`}
                                    cx={point.x}
                                    cy={point.y}
                                    r={3}
                                    fill={TOKEN.oee}
                                    stroke={TOKEN.background}
                                    strokeWidth={1}
                                />
                            ))}
                        </g>

                        {data.map((item, index) => {
                            if (!visibleIndices.has(index)) return null;
                            return (
                                <text
                                    key={`x-label-${item.bucketKey}`}
                                    data-testid="prod-history-widget-x-axis-label"
                                    x={xPositions[index]}
                                    y={layout.xAxisLabels.y}
                                    textAnchor="middle"
                                    fill={TOKEN.muted}
                                    fontSize="var(--font-size-chart)"
                                    fontFamily="var(--font-chart)"
                                    fontWeight="var(--font-weight-chart)"
                                    letterSpacing="var(--tracking-chart)"
                                >
                                    {item.label}
                                </text>
                            );
                        })}

                        {resolvedProductionTicks.map((tick, index) => (
                            <text
                                key={`production-tick-${index}`}
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

                        {showRightAxis && resolvedOeeTicks.map((tick, index) => (
                            <text
                                data-testid="prod-history-widget-right-axis-tick"
                                key={`oee-tick-${index}`}
                                x={layout.plotArea.right + 8}
                                y={tick.y}
                                dy={4}
                                textAnchor="start"
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
                                ? [
                                    { x: productionPoints[hoveredIndex].x, y: productionPoints[hoveredIndex].y, color: TOKEN.production },
                                    ...(showOee ? [{ x: oeePoints[hoveredIndex].x, y: oeePoints[hoveredIndex].y, color: TOKEN.oee }] : []),
                                ]
                                : undefined
                            }
                        />
                    </>
                );
            }}
            renderOverlay={() => (productionPing || (showOee && oeePing)) ? (
                <g data-testid="prod-history-widget-latest-overlay" pointerEvents="none">
                    {productionPing && productionPingY !== null && (
                        <g>
                            <circle
                                cx={productionPing.x}
                                cy={productionPingY}
                                r={9}
                                fill={TOKEN.production}
                                fillOpacity={0.4}
                                className="animate-ping"
                                style={{ animationDuration: '2s', transformOrigin: `${productionPing.x}px ${productionPingY}px` }}
                            />
                            <circle
                                cx={productionPing.x}
                                cy={productionPingY}
                                r={4}
                                fill={TOKEN.production}
                                stroke={TOKEN.background}
                                strokeWidth={1.5}
                            />
                        </g>
                    )}

                    {showOee && oeePing && oeePingY !== null && (
                        <g>
                            <circle
                                cx={oeePing.x}
                                cy={oeePingY}
                                r={9}
                                fill={TOKEN.oee}
                                fillOpacity={0.4}
                                className="animate-ping"
                                style={{ animationDuration: '2s', transformOrigin: `${oeePing.x}px ${oeePingY}px` }}
                            />
                            <circle
                                cx={oeePing.x}
                                cy={oeePingY}
                                r={4}
                                fill={TOKEN.oee}
                                stroke={TOKEN.background}
                                strokeWidth={1.5}
                            />
                        </g>
                    )}
                </g>
            ) : null}
        />
    );
}

function ProdHistoryBarsContainer(props: ProdHistoryBarsContainerProps) {
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
            <ProdHistoryBarsSvg
                {...props}
                width={dimensions.width}
                height={dimensions.height}
                hoveredIndex={hoveredIndex}
                onHoverChange={handleHoverChange}
            />

            {hoverInfo && hoverInfo.index < props.data.length && (() => {
                const item = props.data[hoverInfo.index];
                const series: ChartTooltipSeries[] = [
                    {
                        name: props.productionLabel,
                        value: `${item.production.toFixed(1)} ${props.productionUnit}`,
                        color: TOKEN.production,
                        shape: props.productionMode === 'bars' ? 'square' : 'circle',
                    },
                    ...(props.showOee ? [{
                        name: props.oeeLabel,
                        value: `${item.oee.toFixed(1)}%`,
                        color: TOKEN.oee,
                    }] : []),
                ];

                return (
                    <ChartTooltip
                        label={item.label}
                        series={series}
                        x={hoverInfo.x}
                        containerWidth={dimensions.width}
                    />
                );
            })()}
        </div>
    );
}

export default function ProdHistoryWidget({
    widget,
    isLoadingData = false,
    className,
    onPersistDisplayOptions,
}: ProdHistoryWidgetProps) {
    const displayOptions = widget.displayOptions;
    const chartTitle = widget.title ?? displayOptions?.chartTitle ?? 'PRODUCCIÓN HISTÓRICA';
    const productionBaseLabel = displayOptions?.productionLabel ?? 'Producción';
    const productionUnit: ProductionUnit = displayOptions?.productionUnit ?? 'unidades';
    const productionLabel = `${toSentenceCase(productionBaseLabel)} (${productionUnit})`;
    const oeeLabel = displayOptions?.oeeLabel ?? 'OEE (%)';
    const [productionChartMode, setProductionChartMode] = useState<ProductionChartMode>(() => displayOptions?.productionChartMode ?? 'bars');
    const useSecondaryAxis = displayOptions?.useSecondaryAxis ?? true;
    const autoScale = displayOptions?.autoScale ?? true;
    const showGrid = displayOptions?.showGrid ?? true;
    const oeeShowPoints = displayOptions?.oeeShowPoints ?? false;
    const productionLineStrokeWidth = clampLineStrokeWidth(
        displayOptions?.productionLineStrokeWidth,
        DEFAULT_PRODUCTION_LINE_STROKE_WIDTH,
    );
    const productionLineGlowBlur = clampLineGlowBlur(
        displayOptions?.productionLineGlowBlur,
        DEFAULT_PRODUCTION_LINE_GLOW_BLUR,
    );
    const oeeLineStrokeWidth = clampLineStrokeWidth(
        displayOptions?.oeeLineStrokeWidth,
        DEFAULT_OEE_LINE_STROKE_WIDTH,
    );
    const oeeLineGlowBlur = clampLineGlowBlur(
        displayOptions?.oeeLineGlowBlur,
        DEFAULT_OEE_LINE_GLOW_BLUR,
    );
    const barWidthFactor = clamp(displayOptions?.productionBarWidth ?? 1, 0.5, 1.5);
    const HeaderIcon = resolveHeaderIcon(displayOptions?.icon);

    const [bucket, setBucket] = useState<TemporalBucket>(() => displayOptions?.defaultTemporalGrouping ?? 'hour');
    const [showOee, setShowOee] = useState<boolean>(() => displayOptions?.defaultShowOee ?? true);
    const rawSeries = useMemo(() => generateHistoricalSeries(bucket, new Date()), [bucket]);

    useEffect(() => {
        setProductionChartMode(displayOptions?.productionChartMode ?? 'bars');
    }, [displayOptions?.productionChartMode]);

    const effectiveProductionChartMode = productionChartMode;
    const effectiveShowOee = showOee;

    const handleProductionModeToggle = useCallback((checked: boolean) => {
        const nextMode: ProductionChartMode = checked ? 'area' : 'bars';
        setProductionChartMode(nextMode);
        onPersistDisplayOptions?.({ productionChartMode: nextMode });
    }, [onPersistDisplayOptions]);

    const handleOeeCheckedChange = useCallback((checked: boolean) => {
        setShowOee(checked);
    }, []);

    const groupedData = useMemo(() => groupByTemporalBucket(rawSeries, bucket), [rawSeries, bucket]);

    const { productionDomain, oeeDomain } = useMemo(() => resolveDomains(
        groupedData,
        autoScale,
        showOee,
        {
            productionAxisMin: displayOptions?.productionAxisMin,
            productionAxisMax: displayOptions?.productionAxisMax,
            oeeAxisMin: displayOptions?.oeeAxisMin,
            oeeAxisMax: displayOptions?.oeeAxisMax,
        },
    ), [
        autoScale,
        displayOptions?.oeeAxisMax,
        displayOptions?.oeeAxisMin,
        displayOptions?.productionAxisMax,
        displayOptions?.productionAxisMin,
        groupedData,
        showOee,
    ]);

    if (isLoadingData) {
        return (
            <div className={`glass-panel p-5 w-full h-full flex items-center justify-center ${className ?? ''}`}>
                <WidgetRuntimeState state="loading" testId="prod-history-widget-loading" />
            </div>
        );
    }

    return (
        <div className={`glass-panel group relative w-full h-full p-5 flex flex-col ${className ?? ''}`}>
            <div className={WIDGET_CHART_HEADER_CLASS} data-testid="prod-history-widget-header-area">
                <WidgetHeader
                    title={chartTitle}
                    icon={HeaderIcon ?? undefined}
                    iconTestId="prod-history-widget-header-icon"
                    iconColor={TOKEN.icon}
                    iconPosition="left"
                    className="min-w-0"
                    trailing={(
                        <WidgetHeaderTemporalControls
                            variant="pill"
                            testId="prod-history-widget-runtime-controls"
                            indicatorTestId="prod-history-widget-runtime-control-indicator"
                            groups={[
                                {
                                    testId: 'prod-history-widget-runtime-group-selector',
                                    options: GROUPING_OPTIONS,
                                    selectedValue: bucket,
                                    onSelect: (value) => setBucket(value as TemporalBucket),
                                },
                            ]}
                        />
                    )}
                />

                <div className="flex justify-end" data-testid="prod-history-widget-legend-controls">
                    <div className="flex items-center gap-4" data-testid="prod-history-widget-legend-controls-group">
                        <div className="flex items-center gap-1">
                            <span className={`h-2 w-2 shrink-0 ${effectiveProductionChartMode === 'bars' ? 'rounded-[2px]' : 'rounded-full'}`} style={{ backgroundColor: TOKEN.production }} />
                            <span className="text-industrial-muted">{productionLabel}</span>
                        </div>

                        <label className="flex items-center gap-2 text-industrial-muted cursor-pointer">
                            <span className="flex items-center gap-1">
                                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: TOKEN.oee }} />
                                <span>{oeeLabel}</span>
                            </span>
                            <WidgetRuntimeCheckbox
                                ariaLabel="Mostrar OEE (%)"
                                checked={effectiveShowOee}
                                onCheckedChange={handleOeeCheckedChange}
                                visualTestId="prod-history-widget-oee-checkbox-visual"
                                checkTestId="prod-history-widget-oee-checkbox-check"
                            />
                        </label>

                        <div className="flex items-center gap-2 text-industrial-muted">
                            <span>Barras/Area</span>
                            <WidgetRuntimeToggle
                                ariaLabel="Cambiar modo de producción entre barras y área"
                                title={effectiveProductionChartMode === 'area' ? 'Modo área activado' : 'Modo barras activado'}
                                checked={effectiveProductionChartMode === 'area'}
                                onCheckedChange={handleProductionModeToggle}
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className={WIDGET_CHART_CONTAINER_CLASS} data-testid="prod-history-widget-chart-shell">
                <ProdHistoryBarsContainer
                    widgetId={widget.id}
                    data={groupedData}
                    productionMode={effectiveProductionChartMode}
                    showOee={effectiveShowOee}
                    useSecondaryAxis={useSecondaryAxis}
                    showGrid={showGrid}
                    oeeShowArea={displayOptions?.oeeShowArea ?? false}
                    oeeShowPoints={oeeShowPoints}
                    productionLineStrokeWidth={productionLineStrokeWidth}
                    productionLineGlowBlur={productionLineGlowBlur}
                    oeeLineStrokeWidth={oeeLineStrokeWidth}
                    oeeLineGlowBlur={oeeLineGlowBlur}
                    barWidthFactor={barWidthFactor}
                    productionDomain={productionDomain}
                    oeeDomain={oeeDomain}
                    productionLabel={productionLabel}
                    oeeLabel={oeeLabel}
                    productionUnit={productionUnit}
                />
            </div>
        </div>
    );
}
