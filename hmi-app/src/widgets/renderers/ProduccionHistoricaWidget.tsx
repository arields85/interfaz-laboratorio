import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Activity,
    Droplet,
    Eye,
    EyeOff,
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
import WidgetSegmentedControl from '../../components/ui/WidgetSegmentedControl';
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
    barWidthFactor,
    productionDomain,
    oeeDomain,
    productionUnit,
    hoveredIndex,
    onHoverChange,
}: ProdHistoryBarsSvgProps) {
    if (width <= 0 || height <= 0 || data.length < 2) return null;

    const showRightAxis = showOee && useSecondaryAxis;
    const margin = { top: 28, right: showRightAxis ? 48 : 16, bottom: 30, left: 48 } as const;
    const plotWidth = Math.max(width - margin.left - margin.right, 1);
    const plotHeight = Math.max(height - margin.top - margin.bottom, 1);
    const safeBarFactor = clamp(barWidthFactor, 0.5, 1.5);
    const barW = Math.max((plotWidth / Math.max(data.length, 1)) * 0.35 * safeBarFactor, 6);
    const padX = barW * 1.0;
    const usableW = Math.max(plotWidth - (2 * padX), 1);
    const step = data.length > 1 ? usableW / (data.length - 1) : 0;
    const x0 = margin.left + padX;

    const productionRange = Math.max(productionDomain[1] - productionDomain[0], 1);
    const oeeRenderDomain = showOee && useSecondaryAxis ? oeeDomain : productionDomain;
    const oeeRange = Math.max(oeeRenderDomain[1] - oeeRenderDomain[0], 1);

    const toProductionY = (value: number) => {
        const ratio = clamp((value - productionDomain[0]) / productionRange, 0, 1);
        return margin.top + plotHeight - (ratio * plotHeight);
    };

    const toOeeY = (value: number) => {
        const ratio = clamp((value - oeeRenderDomain[0]) / oeeRange, 0, 1);
        return margin.top + plotHeight - (ratio * plotHeight);
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
    const productionAreaPath = buildAreaPath(productionPath, productionPoints, margin.top + plotHeight);
    const oeePath = smoothPath(oeePoints);
    const oeeAreaPath = buildAreaPath(oeePath, oeePoints, margin.top + plotHeight);
    const productionPing = productionPoints[productionPoints.length - 1];
    const oeePing = oeePoints[oeePoints.length - 1];

    const productionTicks = Array.from({ length: 5 }, (_, index) => ({
        value: productionDomain[1] - (((productionDomain[1] - productionDomain[0]) * index) / 4),
        y: margin.top + ((index / 4) * plotHeight),
    }));

    const oeeTicks = Array.from({ length: 5 }, (_, index) => ({
        value: oeeDomain[1] - (((oeeDomain[1] - oeeDomain[0]) * index) / 4),
        y: margin.top + ((index / 4) * plotHeight),
    }));

    const gridLines = Array.from({ length: 5 }, (_, index) => ({
        y: margin.top + ((index / 4) * plotHeight),
    }));

    const prodBarGradientId = `prod-bar-grad-${widgetId}`;
    const prodAreaGradientId = `prod-area-grad-${widgetId}`;
    const oeeGradientId = `oee-grad-${widgetId}`;
    const oeeClipId = `oee-clip-${widgetId}`;
    const prodGlowId = `prod-glow-${widgetId}`;
    const oeeGlowId = `oee-glow-${widgetId}`;

    return (
        <svg width={width} height={height}>
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
                <clipPath id={oeeClipId}>
                    <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} />
                </clipPath>
                <filter id={prodGlowId} x="-20%" y="-50%" width="140%" height="200%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
                <filter id={oeeGlowId} x="-20%" y="-50%" width="140%" height="200%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
            </defs>

            {showGrid && gridLines.map(({ y }) => (
                <line
                    key={`grid-${y}`}
                    x1={margin.left}
                    x2={margin.left + plotWidth}
                    y1={y}
                    y2={y}
                    stroke={TOKEN.grid}
                    strokeDasharray="3 3"
                />
            ))}

            <text
                x={margin.left - 18}
                y={margin.top - 12}
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

            {showOee && oeeShowArea && oeeAreaPath.length > 0 && (
                <path d={oeeAreaPath} fill={`url(#${oeeGradientId})`} clipPath={`url(#${oeeClipId})`} />
            )}

            {productionMode === 'bars'
                ? data.map((item, index) => {
                    const cx = x0 + (index * step);
                    const barTop = toProductionY(item.production);
                    const barBase = margin.top + plotHeight;
                    const barHeight = Math.max(barBase - barTop, 0);
                    const barX = cx - (barW / 2);
                    const capHeight = Math.min(5, barHeight);

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
                    strokeWidth={2.5}
                    fill="none"
                    filter={`url(#${prodGlowId})`}
                />
            )}

            {showOee && oeePath.length > 0 && (
                <path
                    d={oeePath}
                    stroke={TOKEN.oee}
                    strokeWidth={2.5}
                    fill="none"
                    clipPath={`url(#${oeeClipId})`}
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

            {productionPing && (
                <g>
                    <circle
                        cx={productionPing.x}
                        cy={productionPing.y}
                        r={9}
                        fill={TOKEN.production}
                        fillOpacity={0.4}
                        className="animate-ping"
                        style={{ animationDuration: '2s', transformOrigin: `${productionPing.x}px ${productionPing.y}px` }}
                    />
                    <circle
                        cx={productionPing.x}
                        cy={productionPing.y}
                        r={4}
                        fill={TOKEN.production}
                        stroke={TOKEN.background}
                        strokeWidth={1.5}
                    />
                </g>
            )}

            {showOee && oeePing && (
                <g>
                    <circle
                        cx={oeePing.x}
                        cy={oeePing.y}
                        r={9}
                        fill={TOKEN.oee}
                        fillOpacity={0.4}
                        className="animate-ping"
                        style={{ animationDuration: '2s', transformOrigin: `${oeePing.x}px ${oeePing.y}px` }}
                    />
                    <circle
                        cx={oeePing.x}
                        cy={oeePing.y}
                        r={4}
                        fill={TOKEN.oee}
                        stroke={TOKEN.background}
                        strokeWidth={1.5}
                    />
                </g>
            )}

            {(() => {
                const xLabels = data.map((item) => item.label);
                const xPositions = data.map((_, index) => x0 + (index * step));
                const visibleIndices = computeVisibleLabelIndices(
                    xLabels,
                    xPositions,
                    getChartTextFont(),
                    8,
                    margin.left + plotWidth,
                    getChartLetterSpacingPx(),
                );
                return data.map((item, index) => {
                    if (!visibleIndices.has(index)) return null;
                    return (
                        <text
                            key={`x-label-${item.bucketKey}`}
                            x={x0 + (index * step)}
                            y={margin.top + plotHeight + 16}
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
                });
            })()}

            {productionTicks.map((tick, index) => (
                <text
                    key={`production-tick-${index}`}
                    x={margin.left - 8}
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

            {showRightAxis && oeeTicks.map((tick, index) => (
                <text
                    key={`oee-tick-${index}`}
                    x={margin.left + plotWidth + 8}
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
                marginTop={margin.top}
                marginLeft={margin.left}
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
        </svg>
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
}: ProdHistoryWidgetProps) {
    const displayOptions = widget.displayOptions;
    const chartTitle = widget.title ?? displayOptions?.chartTitle ?? 'PRODUCCIÓN HISTÓRICA';
    const productionBaseLabel = displayOptions?.productionLabel ?? 'Producción';
    const productionUnit: ProductionUnit = displayOptions?.productionUnit ?? 'unidades';
    const productionLabel = `${productionBaseLabel} (${productionUnit})`;
    const oeeLabel = displayOptions?.oeeLabel ?? 'OEE (%)';
    const productionChartMode = displayOptions?.productionChartMode ?? 'bars';
    const useSecondaryAxis = displayOptions?.useSecondaryAxis ?? true;
    const autoScale = displayOptions?.autoScale ?? true;
    const showGrid = displayOptions?.showGrid ?? true;
    const oeeShowArea = displayOptions?.oeeShowArea ?? false;
    const oeeShowPoints = displayOptions?.oeeShowPoints ?? false;
    const barWidthFactor = clamp(displayOptions?.productionBarWidth ?? 1, 0.5, 1.5);
    const HeaderIcon = resolveHeaderIcon(displayOptions?.icon);

    const [bucket, setBucket] = useState<TemporalBucket>(() => displayOptions?.defaultTemporalGrouping ?? 'hour');
    const [showOee, setShowOee] = useState<boolean>(() => displayOptions?.defaultShowOee ?? true);
    const rawSeries = useMemo(() => generateHistoricalSeries(bucket, new Date()), [bucket]);

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
                <div className="animate-pulse text-industrial-muted uppercase">
                    Cargando datos...
                </div>
            </div>
        );
    }

    return (
        <div className={`glass-panel group relative w-full h-full p-5 flex flex-col ${className ?? ''}`}>
            {/* Widget-local controls overlay — positioned absolutely relative to the
                glass-panel container. Separate layer from the WidgetHeader. */}
            <WidgetSegmentedControl
                options={GROUPING_OPTIONS}
                value={bucket}
                onChange={setBucket}
            >
                <button
                    type="button"
                    onClick={() => setShowOee((current) => !current)}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 uppercase transition-colors ${showOee
                        ? 'border-admin-accent/30 bg-admin-accent/10 text-admin-accent'
                        : 'border-industrial-border text-industrial-muted hover:text-industrial-text'
                        }`}
                >
                    {showOee ? <Eye size={12} /> : <EyeOff size={12} />}
                    OEE
                </button>
            </WidgetSegmentedControl>

            <WidgetHeader
                title={chartTitle}
                icon={HeaderIcon ?? undefined}
                iconColor={TOKEN.icon}
                iconPosition="left"
                className="mb-3 shrink-0 min-w-0 max-w-[calc(100%-220px)]"
            />

            <div className="mb-3 flex items-center gap-4">
                <div className="flex items-center gap-1">
                    <span className={`h-2 w-2 shrink-0 ${productionChartMode === 'bars' ? 'rounded-[2px]' : 'rounded-full'}`} style={{ backgroundColor: TOKEN.production }} />
                    <span className="uppercase text-industrial-muted">{productionLabel}</span>
                </div>

                {showOee && (
                    <div className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: TOKEN.oee }} />
                        <span className="uppercase text-industrial-muted">{oeeLabel}</span>
                    </div>
                )}
            </div>

            <div className="min-h-0 flex-1 -mx-2 -mb-2">
                <ProdHistoryBarsContainer
                    widgetId={widget.id}
                    data={groupedData}
                    productionMode={productionChartMode}
                    showOee={showOee}
                    useSecondaryAxis={useSecondaryAxis}
                    showGrid={showGrid}
                    oeeShowArea={oeeShowArea}
                    oeeShowPoints={oeeShowPoints}
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
