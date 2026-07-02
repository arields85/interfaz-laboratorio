import { memo, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, BarChart2, Loader2, PlugZap, TrendingUp } from 'lucide-react';
import { ActivitySeriesAdapterError } from '../../adapters/activitySeries.adapter';
import WidgetCenteredContentLayout from '../../components/ui/WidgetCenteredContentLayout';
import ChartTooltip from '../../components/ui/ChartTooltip';
import type { ChartTooltipSeries } from '../../components/ui/ChartTooltip';
import WidgetHeader from '../../components/ui/WidgetHeader';
import { isDataActivitySeriesEnabled } from '../../config/dataConnection.config';
import type { ProdTrendWidgetConfig, ShiftDefinition } from '../../domain/admin.types';
import type { ContractMachine } from '../../domain/dataContract.types';
import { useTemporalSettings } from '../../hooks/useTemporalSettings';
import { useActivitySeries } from '../../queries/useActivitySeries';
import { DataServiceError } from '../../services/dataOverview.service';
import { validateActivityAnalyticsThresholds } from '../../utils/activityAnalytics';
import { computeActivityAnalytics, resolveActivityAnalyticsComparableProductivityRatio } from '../../utils/activityAnalyticsComputation';
import { resolveActivityAnalyticsDisplayRules } from '../../utils/activityAnalyticsDisplayRules';
import { resolveActivityAnalyticsTimezone } from '../../utils/activityAnalyticsGrouping';
import { clampActivityAnalyticsGroupBarWidth } from '../../utils/activityAnalyticsWidgetDefaults';
import { buildAreaPath, computeVisibleLabelIndices, getChartLetterSpacingPx, getChartTextFont, measureChartTextWidthPx, measureSmoothPathLength, resolveAnimationDurationSecondsFromPathLength, smoothPath } from '../../utils/chartHelpers';
import { createDefaultProdTrendDisplayOptions, resolveProdTrendDisplayOptions } from '../../utils/prodTrendWidgetDefaults';

interface ProdTrendWidgetProps {
    widget: ProdTrendWidgetConfig;
    machines?: ContractMachine[];
    isLoadingData?: boolean;
    className?: string;
}

type ResolvedProdTrendDisplayOptions = ReturnType<typeof resolveProdTrendDisplayOptions>;
type RuntimeProdTrendGroupBy = ResolvedProdTrendDisplayOptions['groupBy'] | null;

interface ProdTrendRuntimeViewState {
    sourceDisplayKey: string;
    sourceGroupBy: ResolvedProdTrendDisplayOptions['groupBy'];
    selectionOverride: ResolvedProdTrendDisplayOptions | null;
    runtimeGroupBy: RuntimeProdTrendGroupBy;
}

const RANGE_OPTIONS: Array<{ value: ResolvedProdTrendDisplayOptions['range']; label: string }> = [
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
    { value: '12m', label: '12m' },
];

const GROUP_BY_OPTIONS: Array<{ value: ResolvedProdTrendDisplayOptions['groupBy']; label: string }> = [
    { value: 'shift', label: 'TURNO' },
    { value: 'day', label: 'DÍA' },
    { value: 'week', label: 'SEMANA' },
    { value: 'month', label: 'MES' },
];

const GENERAL_TYPOGRAPHY_STYLE: CSSProperties = {
    fontFamily: 'var(--font-system)',
    fontWeight: 'var(--font-weight-system)',
    fontSize: 'var(--font-size-system)',
    letterSpacing: 'var(--tracking-system)',
};

const CHART_TYPOGRAPHY_STYLE: CSSProperties = {
    fontFamily: 'var(--font-chart)',
    fontWeight: 'var(--font-weight-chart)',
    fontSize: 'var(--font-size-chart)',
    letterSpacing: 'var(--tracking-chart)',
};

const PROD_TREND_LATEST_VALUE_TEXT_STYLE: CSSProperties = {
    fontFamily: 'var(--font-widget-value-activity-analytics-prod-trend)',
    fontWeight: 'var(--font-weight-widget-value-activity-analytics-prod-trend)',
    fontSize: 'var(--font-size-widget-value-activity-analytics-prod-trend)',
    letterSpacing: 'var(--tracking-widget-value-activity-analytics-prod-trend)',
};

const WIDGET_SHELL_CLASS = 'glass-panel group relative flex h-full w-full flex-col overflow-hidden p-5';
const GROUPED_TOOLTIP_PANEL_CLASS = 'rounded-lg border border-industrial-border bg-[linear-gradient(135deg,rgba(9,13,22,0.57)_0%,rgba(17,24,39,0.52)_100%)] px-3 py-2 shadow-lg backdrop-blur-sm';
const GROUPED_TOOLTIP_LABEL_CLASS = 'mb-1 whitespace-nowrap text-industrial-muted';
const CHART_MARGIN = { top: 8, right: 12, bottom: 24, left: 38 } as const;
const STANDARD_CHART_MIN_HEIGHT_PX = 24;
const CHART_MIN_WIDTH_PX = CHART_MARGIN.left + CHART_MARGIN.right + 24;
const LATEST_VALUE_LABEL_Y_OFFSET_PX = 16;
const TRAVELING_GLOW_SPEED_PX_PER_SECOND = 323;
const TRAVELING_GLOW_DURATION_MIN_SECONDS = 0.9;
const TRAVELING_GLOW_DURATION_MAX_SECONDS = 3.2;
const TRAVELING_GLOW_PAUSE_MIN_MS = 8_000;
const TRAVELING_GLOW_PAUSE_MAX_MS = 20_000;

export default function ProdTrendWidget({ widget, machines, isLoadingData = false, className }: ProdTrendWidgetProps) {
    const displayOptions = resolveProdTrendDisplayOptions(widget.displayOptions ?? createDefaultProdTrendDisplayOptions());
    const [runtimeViewState, setRuntimeViewState] = useState<ProdTrendRuntimeViewState>(() => createRuntimeViewState(displayOptions));
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const [bodySize, setBodySize] = useState<{ width: number; height: number } | null>(null);
    const displayKey = createDisplayOptionsSyncKey(displayOptions);

    if (runtimeViewState.sourceDisplayKey !== displayKey || runtimeViewState.sourceGroupBy !== displayOptions.groupBy) {
        setRuntimeViewState((current) => ({
            sourceDisplayKey: displayKey,
            sourceGroupBy: displayOptions.groupBy,
            selectionOverride: current.sourceDisplayKey === displayKey ? current.selectionOverride : null,
            runtimeGroupBy: current.sourceDisplayKey === displayKey && current.sourceGroupBy === displayOptions.groupBy
                ? current.runtimeGroupBy
                : null,
        }));
    }

    const { selectionOverride, runtimeGroupBy } = runtimeViewState;
    const selectedDisplayOptions = selectionOverride ?? displayOptions;
    const displayRules = resolveActivityAnalyticsDisplayRules({
        range: selectedDisplayOptions.range,
        start: selectedDisplayOptions.start,
        end: selectedDisplayOptions.end,
        groupBy: runtimeGroupBy ?? selectedDisplayOptions.groupBy,
    });
    const activeDisplayOptions = {
        ...selectedDisplayOptions,
        range: displayRules.range,
        groupBy: displayRules.groupBy,
    };
    const activeGroupBy = displayRules.groupBy;
    const groupBySelectOptions = useMemo(() => GROUP_BY_OPTIONS.map((option) => ({
        ...option,
        disabled: !displayRules.allowedGroups.includes(option.value),
    })), [displayRules.allowedGroups]);

    if (runtimeGroupBy !== null && runtimeGroupBy !== activeGroupBy) {
        setRuntimeViewState((current) => ({
            ...current,
            runtimeGroupBy: activeGroupBy,
        }));
    }

    const machineBinding = resolveMachineBinding(widget.binding?.machineId, machines);
    const { config, shifts } = useTemporalSettings();
    const activitySeries = useActivitySeries(machineBinding.machineId != null
        ? {
            machineId: machineBinding.machineId,
            ...(activeDisplayOptions.range === 'custom'
                ? { range: 'custom' as const, start: activeDisplayOptions.start ?? '', end: activeDisplayOptions.end ?? '' }
                : { range: activeDisplayOptions.range }),
        }
        : null);
    const activityData = activitySeries.data;
    const timezone = useMemo(() => resolveActivityAnalyticsTimezone({
        temporalSettings: { plantTimezone: config.plantTimezone },
        windowTimezone: activityData?.window.timezone,
    }), [activityData?.window.timezone, config.plantTimezone]);
    const computedAnalytics = useMemo(() => {
        if (!activityData) {
            return null;
        }

        return computeActivityAnalytics({
            series: activityData.series,
            thresholds: {
                setupKw: activeDisplayOptions.setupThresholdKw,
                prodKw: activeDisplayOptions.prodThresholdKw,
            },
            range: displayRules.range,
            groupBy: activeGroupBy,
            shifts,
            timezone,
            window: activityData.window,
        });
    }, [activeDisplayOptions.prodThresholdKw, activeDisplayOptions.setupThresholdKw, activeGroupBy, activityData, displayRules.range, shifts, timezone]);

    const grouped = useMemo(() => {
        if (!computedAnalytics) {
            return [];
        }

        if (activeGroupBy !== 'shift') {
            return computedAnalytics.grouped;
        }

        return buildTurnoSummaryBuckets(computedAnalytics.grouped, shifts)
            .filter((bucket) => !isTurnoVisualHiddenBucket(bucket));
    }, [activeGroupBy, computedAnalytics, shifts]);

    useEffect(() => {
        if (typeof ResizeObserver === 'undefined' || !bodyRef.current) {
            return undefined;
        }

        const element = bodyRef.current;
        const observer = new ResizeObserver((entries) => {
            entries.forEach((entry) => {
                const nextWidth = Math.round(entry.contentRect.width);
                const nextHeight = Math.round(entry.contentRect.height);

                if (nextWidth > 0 && nextHeight > 0) {
                    setBodySize((current) => current?.width === nextWidth && current?.height === nextHeight
                        ? current
                        : { width: nextWidth, height: nextHeight });
                }
            });
        });

        observer.observe(element);
        return () => observer.disconnect();
    }, [grouped.length]);

    const header = (
        <WidgetHeader
            title={widget.title ?? 'PROD-TREND'}
            icon={TrendingUp}
            iconPosition="left"
            iconTestId="prod-trend-widget-header-icon"
            className="mb-3 shrink-0 min-w-0"
            trailing={(
                <div
                    data-testid="prod-trend-widget-runtime-controls"
                    className="flex items-center gap-2.5"
                >
                    <div
                        data-testid="prod-trend-widget-runtime-range-selector"
                        className="flex flex-nowrap items-center justify-end gap-0"
                    >
                        {RANGE_OPTIONS.map((option) => {
                            const isActive = option.value === activeDisplayOptions.range;

                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    aria-pressed={isActive}
                                    onClick={() => {
                                        const nextDisplayOptions = {
                                            ...widget.displayOptions,
                                            ...activeDisplayOptions,
                                            range: option.value,
                                            start: undefined,
                                            end: undefined,
                                        } satisfies ResolvedProdTrendDisplayOptions;

                                        setRuntimeViewState((current) => ({
                                            ...current,
                                            selectionOverride: nextDisplayOptions,
                                        }));
                                    }}
                                    className={getRuntimeControlButtonClass(isActive, false, true)}
                                >
                                    <span className="flex flex-col items-center">
                                        <span className="translate-y-[1.5px]">{option.label}</span>
                                        <span
                                            aria-hidden="true"
                                            data-testid="prod-trend-widget-runtime-control-indicator"
                                            className={getRuntimeControlIndicatorClass(isActive)}
                                        />
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <div
                        data-testid="prod-trend-widget-runtime-group-selector"
                        className="flex flex-nowrap items-center justify-end gap-0 border-l border-industrial-muted/25 pl-2.5"
                    >
                        {groupBySelectOptions.map((option) => {
                            const isActive = option.value === activeGroupBy;

                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    aria-pressed={isActive}
                                    disabled={option.disabled}
                                    onClick={() => {
                                        if (option.disabled) {
                                            return;
                                        }

                                        setRuntimeViewState((current) => ({
                                            ...current,
                                            runtimeGroupBy: option.value,
                                        }));
                                    }}
                                    className={getRuntimeControlButtonClass(isActive, option.disabled, true)}
                                >
                                    <span className="flex flex-col items-center">
                                        <span className="translate-y-[1.5px]">{option.label}</span>
                                        <span
                                            aria-hidden="true"
                                            data-testid="prod-trend-widget-runtime-control-indicator"
                                            className={getRuntimeControlIndicatorClass(isActive, option.disabled)}
                                        />
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        />
    );

    if (machineBinding.status === 'missing') {
        return renderStateCard({
            className,
            header,
            title: 'Seleccione una máquina',
            message: 'Este widget necesita una máquina vinculada para consultar Activity-Series.',
            icon: <PlugZap size={20} className="text-industrial-muted" />,
        });
    }

    if (machineBinding.status === 'invalid') {
        return renderStateCard({
            className,
            header,
            title: 'Seleccione una máquina válida',
            message: 'La máquina configurada ya no coincide con el contrato disponible para Activity-Series.',
            icon: <AlertTriangle size={20} className="text-status-warning" />,
        });
    }

    if (!isDataActivitySeriesEnabled()) {
        return renderStateCard({
            className,
            header,
            title: 'Endpoint Activity-Series no configurado',
            message: 'Configure el endpoint Activity-Series para habilitar este widget.',
            icon: <AlertTriangle size={20} className="text-status-warning" />,
        });
    }

    try {
        validateActivityAnalyticsThresholds({
            setupKw: displayOptions.setupThresholdKw,
            prodKw: displayOptions.prodThresholdKw,
        });
    } catch {
        return renderStateCard({
            className,
            header,
            title: 'Configuración de umbrales inválida',
            message: 'Prod. debe ser mayor que Setup para clasificar la actividad.',
            icon: <AlertTriangle size={20} className="text-status-warning" />,
        });
    }

    if (isLoadingData || activitySeries.isLoading) {
        return renderStateCard({
            className,
            header,
            title: 'Cargando actividad…',
            message: 'Consultando la serie de actividad configurada.',
            icon: <Loader2 size={20} className="animate-spin text-industrial-muted" />,
        });
    }

    if (activitySeries.isError) {
        return renderStateCard({ className, header, ...resolveErrorState(activitySeries.error) });
    }

    if (!activityData || activityData.series.length === 0) {
        return renderStateCard({
            className,
            header,
            title: 'Sin datos de actividad',
            message: 'La consulta no devolvió puntos para la ventana seleccionada.',
            icon: <BarChart2 size={20} className="text-industrial-muted" />,
        });
    }

    try {
        validateComputedAnalytics(computedAnalytics);
    } catch (error) {
        return renderStateCard({ className, header, ...resolveProcessingErrorState(error) });
    }

    if (computedAnalytics.grouped.length === 0) {
        return renderStateCard({
            className,
            header,
            title: 'Sin grupos para mostrar',
            message: 'Ajuste la agrupación o los turnos globales para ver resultados agrupados.',
            icon: <AlertTriangle size={20} className="text-status-warning" />,
        });
    }

    const chartViewportWidth = Math.max(bodySize?.width ?? 640, CHART_MIN_WIDTH_PX);
    const chartLayout = resolveProdTrendChartLayout(bodySize?.height ?? 180);
    const groupsLayout = resolveGroupsLayout(chartViewportWidth, grouped.length);
    const barWidthFactor = activeDisplayOptions.groupBarWidths[activeGroupBy] ?? activeDisplayOptions.groupBarWidth;
    const xAxisModel = resolveXAxisModel({
        grouped,
        width: chartViewportWidth,
        layout: groupsLayout,
        chartMargin: {
            left: chartLayout.chartMargin.left,
            right: chartLayout.chartMargin.right,
        },
        barWidthFactor,
    });

    return (
        <div className={`${WIDGET_SHELL_CLASS} ${className ?? ''}`} data-testid="prod-trend-widget-root">
            {header}
            <div className="flex min-h-0 flex-1 flex-col" data-testid="prod-trend-widget-body">
                <div
                    ref={bodyRef}
                    className="relative mt-2 flex min-h-0 flex-1 flex-col"
                    data-testid="prod-trend-widget-chart-shell"
                >
                    <div
                        className="relative flex-1 min-h-0 overflow-hidden"
                        data-testid="prod-trend-widget-viewport"
                    >
                        <div
                            className="relative h-full"
                            style={{ width: `${xAxisModel.chartWidth}px` }}
                            data-testid="prod-trend-widget-content"
                        >
                            <ProdTrendChart
                                grouped={grouped}
                                width={xAxisModel.chartWidth}
                                height={chartLayout.chartHeight}
                                chartMargin={chartLayout.chartMargin}
                                lineColors={displayOptions.trendLineColors}
                                lineColorAlphas={displayOptions.trendLineColorAlphas}
                                prodTrendBands={displayOptions.prodTrendBands}
                                xAxisModel={xAxisModel}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function getRuntimeControlButtonClass(isActive: boolean, isDisabled = false, useCompactHorizontalPadding = false) {
    const baseClassName = 'group/control uppercase transition-colors';
    const spacingClassName = `${useCompactHorizontalPadding ? 'px-2' : 'px-2.5'} py-1`;

    if (isDisabled) {
        return `${baseClassName} ${spacingClassName} cursor-default text-industrial-muted/50`;
    }

    return `${baseClassName} ${spacingClassName} ${isActive ? 'text-industrial-text' : 'text-industrial-muted hover:text-industrial-text focus-visible:text-industrial-text'}`;
}

function getRuntimeControlIndicatorClass(isActive: boolean, isDisabled = false) {
    const baseClassName = 'mt-0.5 block h-[1.5px] w-1/4 min-w-[0.45rem] rounded-full transition-colors';

    if (isDisabled) {
        return `${baseClassName} bg-transparent`;
    }

    return isActive
        ? `${baseClassName} bg-current group-hover/control:bg-current group-focus-visible/control:bg-current`
        : `${baseClassName} bg-transparent group-hover/control:bg-current group-focus-visible/control:bg-current`;
}

function createRuntimeViewState(displayOptions: ResolvedProdTrendDisplayOptions): ProdTrendRuntimeViewState {
    return {
        sourceDisplayKey: createDisplayOptionsSyncKey(displayOptions),
        sourceGroupBy: displayOptions.groupBy,
        selectionOverride: null,
        runtimeGroupBy: null,
    };
}

function createDisplayOptionsSyncKey(displayOptions: ResolvedProdTrendDisplayOptions) {
    return `${displayOptions.range}|${displayOptions.start ?? ''}|${displayOptions.end ?? ''}`;
}

const ProdTrendChart = memo(function ProdTrendChart({
    grouped,
    width,
    height,
    chartMargin,
    lineColors,
    lineColorAlphas,
    prodTrendBands,
    xAxisModel,
}: {
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    width: number;
    height: number;
    chartMargin: { top: number; right: number; bottom: number; left: number };
    lineColors: [string, string];
    lineColorAlphas: [number, number];
    prodTrendBands: ReturnType<typeof resolveProdTrendDisplayOptions>['prodTrendBands'];
    xAxisModel: ReturnType<typeof resolveXAxisModel>;
}) {
    const [hoverInfo, setHoverInfo] = useState<{ index: number; x: number } | null>(null);
    const gradientPrefix = useId().replace(/:/g, '-');
    const lineGradientId = `${gradientPrefix}-prod-trend-line-gradient`;
    const areaGradientId = `${gradientPrefix}-prod-trend-area-gradient`;
    const fadeGradientId = `${gradientPrefix}-prod-trend-area-fade`;
    const maskId = `${gradientPrefix}-prod-trend-area-mask`;
    const glowId = `${gradientPrefix}-prod-trend-line-glow`;
    const travelingGlowFilterId = `${gradientPrefix}-prod-trend-traveling-glow`;
    const bandGradientId = `${gradientPrefix}-prod-trend-band-gradient`;
    const travelingGlowAuraGradientId = `${gradientPrefix}-prod-trend-traveling-glow-aura`;
    const plotClipPathId = `${gradientPrefix}-prod-trend-plot-clip`;
    const yAxisLabelX = chartMargin.left - 8;
    const plotWidth = Math.max(width - chartMargin.left - chartMargin.right, 1);
    const plotHeight = Math.max(height - chartMargin.top - chartMargin.bottom, 1);
    const baselineY = chartMargin.top + plotHeight;
    const { positions, labels, visibleLabelIndices } = xAxisModel;
    const renderablePoints = grouped.map((bucket, index) => {
        const productivityRatio = resolveGroupedTrendProductivityRatio(bucket);
        const y = productivityRatio === null
            ? null
            : chartMargin.top + plotHeight - (clamp(productivityRatio, 0, 1) * plotHeight);

        return {
            bucketKey: bucket.bucketKey,
            isPartial: bucket.isInProgress || bucket.hasInProgressContribution === true,
            x: positions[index] ?? (chartMargin.left + (plotWidth / 2)),
            y,
            markerY: y ?? baselineY,
            valueState: productivityRatio === null ? 'missing' : 'measured',
        };
    });
    const lineSegments = buildLineSegments(renderablePoints);
    const yTicks = Array.from({ length: 5 }, (_, index) => ({
        value: 100 - (index * 25),
        y: chartMargin.top + ((index / 4) * plotHeight),
    }));
    const gradientStops = getVisualGradientStops(lineColors, lineColorAlphas);
    const prodTrendBandStopColors = prodTrendBands.colors.map((color) => color ?? 'var(--color-chart-grid)') as [string, string, string];
    const prodTrendBandStopOpacities = prodTrendBands.alphas.map((alpha) => alpha / 100) as [number, number, number];
    const latestPoint = renderablePoints.at(-1) ?? null;
    const latestValueLabel = latestPoint && latestPoint.y !== null
        ? formatPercent(resolveGroupedTrendProductivityRatio(grouped.at(-1) ?? null) ?? 0)
        : null;
    const latestValueLabelAnchor = 'middle';
    const latestValueLabelX = latestPoint?.x ?? 0;
    const latestValueLabelY = latestPoint?.y != null
        ? Math.max(chartMargin.top + 10, latestPoint.y - LATEST_VALUE_LABEL_Y_OFFSET_PX)
        : 0;
    const hoveredPoint = hoverInfo && hoverInfo.index >= 0 && hoverInfo.index < renderablePoints.length
        ? renderablePoints[hoverInfo.index] ?? null
        : null;
    const showProdTrendBands = visibleLabelIndices.size > 3;
    const activeBandIntervals = showProdTrendBands
        ? positions.slice(0, -1)
            .map((startX, index) => ({
                index,
                x: startX,
                width: Math.max((positions[index + 1] ?? startX) - startX, 0),
            }))
            .filter((interval) => interval.index % 2 === 0 && interval.width > 0)
        : [];
    const hitStep = grouped.length > 1
        ? Math.max((positions[1] ?? chartMargin.left) - (positions[0] ?? chartMargin.left), 1)
        : Math.max(plotWidth, 1);
    const travelingGlowTarget = resolveTravelingGlowTarget(lineSegments);
    const travelingGlowSegment = travelingGlowTarget ? lineSegments[travelingGlowTarget.index] ?? null : null;
    const travelingGlowPathId = travelingGlowTarget ? `${gradientPrefix}-prod-trend-motion-path-${travelingGlowTarget.index}` : null;
    const travelingGlowDurationSeconds = resolveTravelingGlowDurationSeconds(travelingGlowSegment);
    const travelingGlowDuration = `${travelingGlowDurationSeconds}s`;
    const {
        prefersReducedMotion,
        cycleKey: travelingGlowCycleKey,
        progress: travelingGlowProgress,
        isPaused: isTravelingGlowPaused,
    } = useTravelingEffectCycle({
        enabled: travelingGlowPathId !== null,
        durationSeconds: travelingGlowDurationSeconds,
    });
    const travelingGlowFrame = resolveTravelingGlowFrame(travelingGlowSegment, travelingGlowProgress);
    const showTravelingGlow = travelingGlowPathId !== null
        && !prefersReducedMotion
        && !isTravelingGlowPaused
        && travelingGlowFrame !== null;
    const activeTravelingGlowFrame = showTravelingGlow ? travelingGlowFrame : null;
    const hasRenderableTrend = lineSegments.some((segment) => segment.length >= 2);
    const hasLabels = labels.some((label) => label.length > 0);

    return (
        <>
            <svg
                width={width}
                height={height}
                viewBox={`0 0 ${width} ${height}`}
                data-testid="prod-trend-widget-chart"
                data-y-domain-min="0"
                data-y-domain-max="100"
            >
                <defs>
                    <linearGradient id={lineGradientId} gradientUnits="userSpaceOnUse" x1={chartMargin.left} y1="0" x2={chartMargin.left + plotWidth} y2="0">
                        <stop offset="0%" stopColor={gradientStops.startColor} stopOpacity={Math.max(gradientStops.startOpacity, 0.72)} />
                        <stop offset="100%" stopColor={gradientStops.endColor} stopOpacity={Math.max(gradientStops.endOpacity, 0.92)} />
                    </linearGradient>

                    <linearGradient id={areaGradientId} gradientUnits="userSpaceOnUse" x1={chartMargin.left} y1="0" x2={chartMargin.left + plotWidth} y2="0">
                        <stop offset="0%" stopColor={gradientStops.startColor} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={gradientStops.endColor} stopOpacity={0.46} />
                    </linearGradient>

                    <linearGradient id={fadeGradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-industrial-text)" stopOpacity={0.72} />
                        <stop offset="100%" stopColor="var(--color-industrial-text)" stopOpacity={0} />
                    </linearGradient>

                    <linearGradient id={bandGradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={prodTrendBandStopColors[0]} stopOpacity={prodTrendBandStopOpacities[0]} />
                        <stop offset="50%" stopColor={prodTrendBandStopColors[1]} stopOpacity={prodTrendBandStopOpacities[1]} />
                        <stop offset="100%" stopColor={prodTrendBandStopColors[2]} stopOpacity={prodTrendBandStopOpacities[2]} />
                    </linearGradient>

                    <radialGradient id={travelingGlowAuraGradientId} cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor={gradientStops.endColor} stopOpacity={0.96} />
                        <stop offset="34%" stopColor={gradientStops.endColor} stopOpacity={0.52} />
                        <stop offset="72%" stopColor={gradientStops.startColor} stopOpacity={0.18} />
                        <stop offset="100%" stopColor={gradientStops.startColor} stopOpacity={0} />
                    </radialGradient>

                    <mask id={maskId} maskContentUnits="objectBoundingBox">
                        <rect x="0" y="0" width="1" height="1" fill={`url(#${fadeGradientId})`} />
                    </mask>

                    <clipPath id={plotClipPathId}>
                        <rect x={chartMargin.left} y={chartMargin.top} width={plotWidth} height={plotHeight} />
                    </clipPath>

                    <filter id={glowId} x="-20%" y="-50%" width="140%" height="200%">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>

                    <filter id={travelingGlowFilterId} x="-140%" y="-140%" width="380%" height="380%">
                        <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="outer-blur" />
                        <feColorMatrix
                            in="outer-blur"
                            result="outer-bloom"
                            type="matrix"
                            values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1.45 0"
                        />
                        <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="inner-blur" />
                        <feMerge>
                            <feMergeNode in="outer-bloom" />
                            <feMergeNode in="inner-blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                <g clipPath={`url(#${plotClipPathId})`} data-testid="prod-trend-widget-band-layer" style={{ mixBlendMode: prodTrendBands.blendMode }}>
                    {activeBandIntervals.map((interval) => (
                        <g key={`prod-trend-band-${interval.index}`} data-testid="prod-trend-widget-band-group">
                            <rect
                                x={interval.x}
                                y={chartMargin.top}
                                width={interval.width}
                                height={plotHeight}
                                fill={`url(#${bandGradientId})`}
                                data-testid="prod-trend-widget-band"
                            />
                            <line
                                x1={interval.x}
                                x2={interval.x}
                                y1={chartMargin.top}
                                y2={baselineY}
                                stroke="var(--color-chart-grid)"
                                strokeOpacity={0.42}
                                strokeWidth={1}
                                strokeDasharray="3 3"
                            />
                            <line
                                x1={interval.x + interval.width}
                                x2={interval.x + interval.width}
                                y1={chartMargin.top}
                                y2={baselineY}
                                stroke="var(--color-chart-grid)"
                                strokeOpacity={0.42}
                                strokeWidth={1}
                                strokeDasharray="3 3"
                            />
                        </g>
                    ))}
                </g>

                {yTicks.map((tick) => (
                    <line
                        key={`prod-trend-grid-${tick.value}`}
                        x1={chartMargin.left}
                        x2={chartMargin.left + plotWidth}
                        y1={tick.y}
                        y2={tick.y}
                        stroke="var(--color-chart-grid)"
                        strokeDasharray="3 3"
                        data-testid="prod-trend-widget-y-grid-line"
                    />
                ))}

                <line x1={chartMargin.left} x2={chartMargin.left + plotWidth} y1={baselineY} y2={baselineY} stroke="var(--color-industrial-border)" />
                <line x1={chartMargin.left} x2={chartMargin.left} y1={chartMargin.top} y2={baselineY} stroke="var(--color-industrial-border)" />

                {lineSegments.map((segment, index) => {
                    const linePath = segment.length >= 2 ? smoothPath(segment) : '';
                    const areaPath = segment.length >= 2 ? buildAreaPath(linePath, segment, baselineY) : '';

                    return (
                        <g key={`prod-trend-segment-${index}`} data-testid="prod-trend-widget-segment">
                            {areaPath.length > 0 && (
                                <path
                                    d={areaPath}
                                    fill={`url(#${areaGradientId})`}
                                    mask={`url(#${maskId})`}
                                    data-testid="prod-trend-widget-area"
                                />
                            )}
                            {linePath.length > 0 && (
                                <path
                                    id={travelingGlowTarget?.index === index ? travelingGlowPathId ?? undefined : undefined}
                                    d={linePath}
                                    fill="none"
                                    stroke={`url(#${lineGradientId})`}
                                    strokeWidth={2.5}
                                    filter={`url(#${glowId})`}
                                    data-testid="prod-trend-widget-line"
                                />
                            )}
                        </g>
                    );
                })}

                {travelingGlowPathId && activeTravelingGlowFrame && (
                    <g
                        key={`prod-traveling-glow-cycle-${travelingGlowCycleKey}`}
                        clipPath={`url(#${plotClipPathId})`}
                        pointerEvents="none"
                        aria-hidden="true"
                        className="activity-analytics-prod-trend-traveling-glow"
                        data-testid="prod-trend-widget-traveling-glow"
                        data-cycle-key={travelingGlowCycleKey}
                        data-path-id={travelingGlowPathId}
                        style={{ mixBlendMode: 'screen' }}
                    >
                        <circle
                            cx={activeTravelingGlowFrame.x}
                            cy={activeTravelingGlowFrame.y}
                            r={activeTravelingGlowFrame.auraRadius}
                            fill={`url(#${travelingGlowAuraGradientId})`}
                            opacity={activeTravelingGlowFrame.auraOpacity}
                            fillOpacity={activeTravelingGlowFrame.auraFillOpacity}
                            filter={`url(#${travelingGlowFilterId})`}
                            data-duration={travelingGlowDuration}
                            data-testid="prod-trend-widget-traveling-glow-aura"
                        />
                        <circle
                            cx={activeTravelingGlowFrame.x}
                            cy={activeTravelingGlowFrame.y}
                            r={activeTravelingGlowFrame.haloRadius}
                            fill={`url(#${travelingGlowAuraGradientId})`}
                            opacity={activeTravelingGlowFrame.haloOpacity}
                            fillOpacity={activeTravelingGlowFrame.haloFillOpacity}
                            filter={`url(#${travelingGlowFilterId})`}
                            data-duration={travelingGlowDuration}
                            data-motion-duration={travelingGlowDuration}
                            data-testid="prod-trend-widget-traveling-glow-halo"
                        />
                        <circle
                            cx={activeTravelingGlowFrame.x}
                            cy={activeTravelingGlowFrame.y}
                            r={activeTravelingGlowFrame.coreRadius}
                            fill={gradientStops.endColor}
                            opacity={activeTravelingGlowFrame.coreOpacity}
                            stroke={gradientStops.startColor}
                            strokeOpacity={0.42}
                            strokeWidth={0.9}
                            data-duration={travelingGlowDuration}
                            data-testid="prod-trend-widget-traveling-glow-core"
                        />
                    </g>
                )}

                {latestPoint && (
                    <g data-testid="prod-trend-widget-latest-point-overlay" pointerEvents="none">
                        <g data-testid="prod-trend-widget-latest-point" data-bucket-key={latestPoint.bucketKey}>
                        {latestValueLabel && latestPoint.y !== null && (
                            <text
                                x={latestValueLabelX}
                                y={latestValueLabelY}
                                textAnchor={latestValueLabelAnchor}
                                fill={gradientStops.endColor}
                                className="activity-analytics-prod-trend-latest-value-float"
                                style={{
                                    ...PROD_TREND_LATEST_VALUE_TEXT_STYLE,
                                    transformBox: 'fill-box',
                                    transformOrigin: 'center bottom',
                                }}
                                data-testid="prod-trend-widget-latest-value-label"
                            >
                                {latestValueLabel}
                            </text>
                        )}
                        {latestPoint.y !== null ? (
                            <g aria-hidden="true" style={{ mixBlendMode: 'screen' }}>
                                <circle
                                    data-testid="prod-trend-widget-final-point-pulse"
                                    cx={latestPoint.x}
                                    cy={latestPoint.y}
                                    r={9}
                                    fill={gradientStops.endColor}
                                    fillOpacity={0.45}
                                    className="animate-ping"
                                    style={{ animationDuration: '2s', transformOrigin: `${latestPoint.x}px ${latestPoint.y}px` }}
                                />
                                <circle
                                    data-testid="prod-trend-widget-final-point-aura"
                                    cx={latestPoint.x}
                                    cy={latestPoint.y}
                                    r={13.5}
                                    fill={`url(#${travelingGlowAuraGradientId})`}
                                    fillOpacity={0.3}
                                    filter={`url(#${travelingGlowFilterId})`}
                                    className="activity-analytics-prod-trend-final-point-flicker activity-analytics-prod-trend-final-point-flicker-aura"
                                />
                                <circle
                                    data-testid="prod-trend-widget-final-point-halo"
                                    cx={latestPoint.x}
                                    cy={latestPoint.y}
                                    r={8.75}
                                    fill={`url(#${travelingGlowAuraGradientId})`}
                                    fillOpacity={0.48}
                                    filter={`url(#${travelingGlowFilterId})`}
                                    className="activity-analytics-prod-trend-final-point-flicker activity-analytics-prod-trend-final-point-flicker-halo"
                                />
                                <circle
                                    data-testid="prod-trend-widget-final-point-core"
                                    cx={latestPoint.x}
                                    cy={latestPoint.y}
                                    r={3}
                                    fill={gradientStops.endColor}
                                    stroke={gradientStops.startColor}
                                    strokeOpacity={0.42}
                                    strokeWidth={0.9}
                                />
                            </g>
                        ) : (
                            <>
                                <circle
                                    data-testid="prod-trend-widget-final-missing-pulse"
                                    cx={latestPoint.x}
                                    cy={latestPoint.markerY}
                                    r={8}
                                    fill="none"
                                    stroke="var(--color-industrial-muted)"
                                    strokeOpacity={0.7}
                                    strokeWidth={1.5}
                                    className="animate-pulse"
                                    style={{ transformOrigin: `${latestPoint.x}px ${latestPoint.markerY}px` }}
                                />
                                <circle
                                    data-testid="prod-trend-widget-final-missing-core"
                                    cx={latestPoint.x}
                                    cy={latestPoint.markerY}
                                    r={4}
                                    fill="var(--color-industrial-bg)"
                                    stroke="var(--color-industrial-muted)"
                                    strokeDasharray="2 2"
                                    strokeWidth={1.5}
                                />
                            </>
                        )}
                        </g>
                    </g>
                )}

                {hoveredPoint && (
                    <g pointerEvents="none" data-testid="prod-trend-widget-hover-affordance">
                        <line
                            x1={hoveredPoint.x}
                            x2={hoveredPoint.x}
                            y1={chartMargin.top}
                            y2={baselineY}
                            stroke="var(--color-industrial-muted)"
                            strokeWidth={1}
                            strokeDasharray="4 3"
                            opacity={0.7}
                            data-testid="prod-trend-widget-hover-guide"
                        />
                        {hoveredPoint.y !== null && (
                            <circle
                                cx={hoveredPoint.x}
                                cy={hoveredPoint.y}
                                r={4}
                                fill={gradientStops.endColor}
                                stroke="var(--color-industrial-bg)"
                                strokeWidth={2}
                                data-testid="prod-trend-widget-hover-point"
                            />
                        )}
                    </g>
                )}

                {yTicks.map((tick) => (
                    <text
                        key={`prod-trend-y-tick-${tick.value}`}
                        x={yAxisLabelX}
                        y={tick.y}
                        dy={4}
                        textAnchor="end"
                        fill="var(--color-industrial-muted)"
                        style={CHART_TYPOGRAPHY_STYLE}
                        data-testid="prod-trend-widget-y-axis-tick"
                    >
                        {tick.value}%
                    </text>
                ))}

                {grouped.map((bucket, index) => {
                    if (!visibleLabelIndices.has(index)) {
                        return null;
                    }

                    const x = positions[index] ?? (chartMargin.left + (plotWidth / 2));
                    const label = labels[index] ?? '';

                    const lastIndex = grouped.length - 1;

                    return (
                        <text
                            key={`prod-trend-x-tick-${bucket.bucketKey}`}
                            x={x}
                            y={height - 8}
                            textAnchor={index === 0 ? 'start' : index === lastIndex ? 'end' : 'middle'}
                            fill="var(--color-industrial-muted)"
                            style={CHART_TYPOGRAPHY_STYLE}
                            data-testid="prod-trend-widget-x-axis-label"
                        >
                            {label}
                        </text>
                    );
                })}

                {!hasRenderableTrend && (
                    <text
                        x={chartMargin.left + (plotWidth / 2)}
                        y={chartMargin.top + (plotHeight / 2)}
                        textAnchor="middle"
                        fill="var(--color-industrial-muted)"
                        style={GENERAL_TYPOGRAPHY_STYLE}
                        data-testid="prod-trend-widget-empty"
                    >
                        {hasLabels ? 'Sin datos comparables' : 'Sin datos'}
                    </text>
                )}

                {grouped.map((bucket, index) => {
                    const centerX = positions[index] ?? (chartMargin.left + (plotWidth / 2));
                    const hitWidth = grouped.length > 1 ? hitStep : plotWidth;

                    return (
                        <rect
                            key={`prod-trend-hit-${bucket.bucketKey}`}
                            x={Math.max(centerX - (hitWidth / 2), chartMargin.left)}
                            y={chartMargin.top}
                            width={Math.min(hitWidth, plotWidth)}
                            height={plotHeight}
                            fill="transparent"
                            cursor="crosshair"
                            data-testid="prod-trend-widget-hit-area"
                            onMouseEnter={() => setHoverInfo({ index, x: centerX })}
                            onMouseLeave={() => setHoverInfo(null)}
                        />
                    );
                })}
            </svg>

            {hoverInfo && hoverInfo.index < grouped.length && (
                <ChartTooltip
                    label={resolveGroupedTooltipLabel(grouped[hoverInfo.index]?.label ?? '')}
                    series={buildTooltipSeries(grouped[hoverInfo.index], gradientStops.endColor)}
                    x={hoverInfo.x}
                    containerWidth={width}
                    panelClassName={GROUPED_TOOLTIP_PANEL_CLASS}
                    labelClassName={GROUPED_TOOLTIP_LABEL_CLASS}
                />
            )}
        </>
    );
});

function buildTooltipSeries(bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number], color: string): ChartTooltipSeries[] {
    return [{ name: 'Prod.', value: resolveGroupedVisibleProductivityLabel(bucket), color, shape: 'square' }];
}

function resolveProdTrendChartLayout(panelHeight: number) {
    return {
        chartMargin: CHART_MARGIN,
        chartHeight: Math.max(
            Math.round(panelHeight),
            CHART_MARGIN.top + CHART_MARGIN.bottom + STANDARD_CHART_MIN_HEIGHT_PX,
        ),
    };
}

function resolveGroupsLayout(width: number, groupCount: number) {
    const minSlotWidthPx = 42;
    const groupsPlotWidth = Math.max(width - 76, 1);
    const slotWidth = groupsPlotWidth / Math.max(groupCount, 1);
    const density = slotWidth >= 76 ? 'fit' : 'compress';

    return { density, minSlotWidthPx, sampleLabels: density !== 'fit' } as const;
}

function resolveXAxisModel({
    grouped,
    width,
    layout,
    chartMargin,
    barWidthFactor,
}: {
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    width: number;
    layout: { density: 'fit' | 'compress' | 'scroll'; minSlotWidthPx: number; sampleLabels: boolean };
    chartMargin: { left: number; right: number };
    barWidthFactor: number;
}) {
    const chartWidth = layout.density === 'scroll'
        ? Math.max(width, chartMargin.left + chartMargin.right + (grouped.length * layout.minSlotWidthPx))
        : width;
    const plotWidth = Math.max(chartWidth - chartMargin.left - chartMargin.right, 1);
    const safeBarWidthFactor = clampActivityAnalyticsGroupBarWidth(barWidthFactor);
    const slotWidth = Math.max(plotWidth / Math.max(grouped.length, 1), 1);
    const targetGap = clamp(
        slotWidth * (layout.density === 'fit' ? 0.26 : layout.density === 'compress' ? 0.2 : 0.16),
        layout.density === 'fit' ? 18 : layout.density === 'compress' ? 10 : 8,
        layout.density === 'fit' ? 30 : layout.density === 'compress' ? 20 : 16,
    );
    const baseBarWidth = Math.max(
        Math.min(slotWidth * (layout.density === 'fit' ? 0.68 : layout.density === 'compress' ? 0.62 : 0.56), slotWidth - targetGap),
        6,
    );
    const barWidth = clamp(baseBarWidth * safeBarWidthFactor, 6, Math.max(slotWidth - 4, 6));
    const horizontalPadding = Math.max(barWidth * (layout.density === 'fit' ? 0.54 : layout.density === 'compress' ? 0.42 : 0.48), 6);
    const usablePlotWidth = Math.max(plotWidth - (2 * horizontalPadding), 1);
    const positions = grouped.length > 1
        ? grouped.map((_, index) => chartMargin.left + ((plotWidth * index) / (grouped.length - 1)))
        : grouped.map(() => chartMargin.left + horizontalPadding + (usablePlotWidth / 2));
    const labels = grouped.map((bucket) => bucket.label.replace(/\s+\((?:en\s+curso)\)$/i, '').trim());
    const visibleLabelIndices = layout.sampleLabels
        ? computeVisibleLabelIndices(
            labels,
            positions,
            getChartTextFont(),
            8,
            chartMargin.left + plotWidth,
            getChartLetterSpacingPx(),
        )
        : new Set(grouped.map((_, index) => index));
    ensureLastXAxisLabelVisibility({
        visibleLabelIndices,
        labels,
        positions,
        font: getChartTextFont(),
        letterSpacing: getChartLetterSpacingPx(),
        minGap: 8,
    });

    return {
        chartWidth,
        positions,
        labels,
        visibleLabelIndices,
    };
}

function ensureLastXAxisLabelVisibility({
    visibleLabelIndices,
    labels,
    positions,
    font,
    letterSpacing,
    minGap,
}: {
    visibleLabelIndices: Set<number>;
    labels: string[];
    positions: number[];
    font: string;
    letterSpacing: number;
    minGap: number;
}) {
    const count = Math.min(labels.length, positions.length);

    if (count === 0) {
        return;
    }

    const lastIndex = count - 1;
    visibleLabelIndices.add(lastIndex);

    const lastBounds = resolveXAxisLabelBounds({
        x: positions[lastIndex] ?? 0,
        width: measureChartTextWidthPx(labels[lastIndex] ?? '', font, letterSpacing),
        anchor: 'end',
    });

    Array.from(visibleLabelIndices)
        .filter((index) => index !== lastIndex)
        .sort((left, right) => right - left)
        .forEach((index) => {
            const width = measureChartTextWidthPx(labels[index] ?? '', font, letterSpacing);
            const anchor = index === 0 ? 'start' : 'middle';
            const bounds = resolveXAxisLabelBounds({
                x: positions[index] ?? 0,
                width,
                anchor,
            });

            if (bounds.right > lastBounds.left - minGap) {
                visibleLabelIndices.delete(index);
            }
        });
}

function resolveXAxisLabelBounds({
    x,
    width,
    anchor,
}: {
    x: number;
    width: number;
    anchor: 'start' | 'middle' | 'end';
}) {
    if (anchor === 'start') {
        return { left: x, right: x + width };
    }

    if (anchor === 'end') {
        return { left: x - width, right: x };
    }

    return { left: x - (width / 2), right: x + (width / 2) };
}

function buildLineSegments(points: Array<{ x: number; y: number | null }>) {
    const segments: Array<Array<{ x: number; y: number }>> = [];
    let currentSegment: Array<{ x: number; y: number }> = [];

    points.forEach((point) => {
        if (point.y === null) {
            if (currentSegment.length > 0) {
                segments.push(currentSegment);
                currentSegment = [];
            }

            return;
        }

        currentSegment.push({ x: point.x, y: point.y });
    });

    if (currentSegment.length > 0) {
        segments.push(currentSegment);
    }

    return segments;
}

function resolveTravelingGlowTarget(segments: Array<Array<{ x: number; y: number }>>) {
    return segments.reduce<{ index: number; length: number } | null>((best, segment, index) => (
        segment.length < 2
            ? best
            : !best || segment.length >= best.length
                ? { index, length: segment.length }
                : best
    ), null);
}

function resolveTravelingGlowDurationSeconds(segment: Array<{ x: number; y: number }> | null) {
    if (!segment || segment.length < 2) {
        return TRAVELING_GLOW_DURATION_MIN_SECONDS;
    }

    return resolveAnimationDurationSecondsFromPathLength(
        measureSmoothPathLength(segment),
        TRAVELING_GLOW_SPEED_PX_PER_SECOND,
        TRAVELING_GLOW_DURATION_MIN_SECONDS,
        TRAVELING_GLOW_DURATION_MAX_SECONDS,
    );
}

function resolveTravelingGlowFrame(segment: Array<{ x: number; y: number }> | null, progress: number) {
    if (!segment || segment.length < 2) {
        return null;
    }

    const point = samplePoint(segment, progress);

    return {
        x: point.x,
        y: point.y,
        auraOpacity: interpolate(progress, [0, 0.08, 0.7, 0.9, 1], [0.12, 0.28, 0.34, 0.14, 0]),
        auraFillOpacity: interpolate(progress, [0, 0.14, 0.72, 0.9, 1], [0.18, 0.26, 0.3, 0.12, 0]),
        auraRadius: interpolate(progress, [0, 0.14, 0.72, 0.9, 1], [10.5, 14.25, 13.75, 11.5, 10.5]),
        haloOpacity: interpolate(progress, [0, 0.08, 0.72, 0.9, 1], [0.32, 0.68, 0.7, 0.22, 0]),
        haloFillOpacity: interpolate(progress, [0, 0.14, 0.72, 0.9, 1], [0.24, 0.42, 0.48, 0.18, 0]),
        haloRadius: interpolate(progress, [0, 0.14, 0.72, 0.9, 1], [6.25, 9.35, 8.9, 6.75, 6.25]),
        coreOpacity: interpolate(progress, [0, 0.08, 0.72, 0.9, 1], [0.62, 0.98, 1, 0.28, 0]),
        coreRadius: interpolate(progress, [0, 0.14, 0.72, 0.9, 1], [2.35, 3.25, 3.05, 2.55, 2.35]),
    };
}

function interpolate(progress: number, keyTimes: number[], values: number[]) {
    const clampedProgress = clamp(progress, 0, 1);

    for (let index = 1; index < keyTimes.length; index += 1) {
        const startTime = keyTimes[index - 1] ?? 0;
        const endTime = keyTimes[index] ?? 1;

        if (clampedProgress <= endTime) {
            const startValue = values[index - 1] ?? values[0] ?? 0;
            const endValue = values[index] ?? startValue;
            const segmentProgress = endTime === startTime ? 1 : (clampedProgress - startTime) / (endTime - startTime);

            return startValue + ((endValue - startValue) * clamp(segmentProgress, 0, 1));
        }
    }

    return values.at(-1) ?? 0;
}

function samplePoint(segment: Array<{ x: number; y: number }>, progress: number) {
    const sampledPoints = [{ ...segment[0]!, distance: 0 }];
    let totalDistance = 0;

    for (let segmentIndex = 1; segmentIndex < segment.length; segmentIndex += 1) {
        const start = segment[segmentIndex - 1]!;
        const end = segment[segmentIndex]!;
        const controlX = (start.x + end.x) / 2;
        let previousPoint = start;

        for (let sampleIndex = 1; sampleIndex <= 24; sampleIndex += 1) {
            const t = sampleIndex / 24;
            const point = bezier(start, { x: controlX, y: start.y }, { x: controlX, y: end.y }, end, t);
            totalDistance += Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
            sampledPoints.push({ ...point, distance: totalDistance });
            previousPoint = point;
        }
    }

    const targetDistance = (sampledPoints.at(-1)?.distance ?? 0) * clamp(progress, 0, 1);

    for (let index = 1; index < sampledPoints.length; index += 1) {
        const previousPoint = sampledPoints[index - 1]!;
        const currentPoint = sampledPoints[index]!;

        if (targetDistance > currentPoint.distance) {
            continue;
        }

        const distanceProgress = currentPoint.distance === previousPoint.distance
            ? 1
            : (targetDistance - previousPoint.distance) / (currentPoint.distance - previousPoint.distance);

        return {
            x: previousPoint.x + ((currentPoint.x - previousPoint.x) * clamp(distanceProgress, 0, 1)),
            y: previousPoint.y + ((currentPoint.y - previousPoint.y) * clamp(distanceProgress, 0, 1)),
        };
    }

    return segment[0] ?? { x: 0, y: 0 };
}

function bezier(start: { x: number; y: number }, control1: { x: number; y: number }, control2: { x: number; y: number }, end: { x: number; y: number }, t: number) {
    const oneMinusT = 1 - t;
    const oneMinusTSquared = oneMinusT * oneMinusT;
    const tSquared = t * t;

    return {
        x: (oneMinusTSquared * oneMinusT * start.x) + (3 * oneMinusTSquared * t * control1.x) + (3 * oneMinusT * tSquared * control2.x) + (tSquared * t * end.x),
        y: (oneMinusTSquared * oneMinusT * start.y) + (3 * oneMinusTSquared * t * control1.y) + (3 * oneMinusT * tSquared * control2.y) + (tSquared * t * end.y),
    };
}

function usePrefersReducedMotion() {
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => (
        typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ));

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return undefined;
        }

        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        const handleChange = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches);
        mediaQuery.addEventListener?.('change', handleChange);

        return () => mediaQuery.removeEventListener?.('change', handleChange);
    }, []);

    return prefersReducedMotion;
}

function useTravelingEffectCycle({ enabled, durationSeconds }: { enabled: boolean; durationSeconds: number }) {
    const prefersReducedMotion = usePrefersReducedMotion();
    const [cycleKey, setCycleKey] = useState(0);
    const [progress, setProgress] = useState(0);
    const [isPaused, setIsPaused] = useState(false);

    useEffect(() => {
        if (!enabled || prefersReducedMotion) {
            setProgress(0);
            setIsPaused(false);
            return undefined;
        }

        const travelDurationMs = durationSeconds * 1000;
        const pauseMs = Math.round(TRAVELING_GLOW_PAUSE_MIN_MS + (Math.random() * (TRAVELING_GLOW_PAUSE_MAX_MS - TRAVELING_GLOW_PAUSE_MIN_MS)));
        const startTime = performance.now();
        let frameId = 0;

        setProgress(0);
        setIsPaused(false);

        const animate = (now: number) => {
            const nextProgress = clamp(now - startTime, 0, travelDurationMs) / travelDurationMs;
            setProgress(nextProgress);

            if (nextProgress < 1) {
                frameId = window.requestAnimationFrame(animate);
            }
        };

        frameId = window.requestAnimationFrame(animate);
        const hideTimerId = window.setTimeout(() => {
            setProgress(1);
            setIsPaused(true);
        }, travelDurationMs);
        const restartTimerId = window.setTimeout(() => setCycleKey((current) => current + 1), travelDurationMs + pauseMs);

        return () => {
            window.cancelAnimationFrame(frameId);
            window.clearTimeout(hideTimerId);
            window.clearTimeout(restartTimerId);
        };
    }, [cycleKey, durationSeconds, enabled, prefersReducedMotion]);

    return { prefersReducedMotion, cycleKey, progress, isPaused };
}

function resolveGroupedTooltipLabel(label: string) {
    return label.replace(/\(\s*en curso\s*\)/i, '(en curso)');
}

function resolveGroupedVisibleProductivityLabel(bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number]) {
    const ratio = resolveGroupedVisibleProductivityRatio(bucket);
    return ratio !== null ? formatPercent(ratio) : bucket.productivityLabel;
}

function resolveGroupedVisibleProductivityRatio(bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number]) {
    if (bucket.coverageRatio < 1) {
        const comparable = resolveActivityAnalyticsComparableProductivityRatio(bucket);
        const productiveDurationMs = bucket.durationsMs.prod + bucket.durationsMs.setup + bucket.durationsMs.stopped;

        if (comparable !== null) {
            return clamp(comparable, 0, 1);
        }

        if (productiveDurationMs > 0) {
            return clamp(bucket.durationsMs.prod / productiveDurationMs, 0, 1);
        }
    }

    const resolved = bucket.productivityRatio ?? parsePercentLabel(bucket.productivityLabel);
    return resolved === null ? null : clamp(resolved, 0, 1);
}

function resolveGroupedTrendProductivityRatio(bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number] | null | undefined) {
    if (!bucket) {
        return null;
    }

    const resolved = resolveGroupedVisibleProductivityRatio(bucket);

    if (resolved !== null) {
        return resolved;
    }

    const observedDurationMs = bucket.durationsMs.prod + bucket.durationsMs.setup + bucket.durationsMs.stopped;
    return observedDurationMs > 0 ? clamp(bucket.durationsMs.prod / observedDurationMs, 0, 1) : null;
}

function parsePercentLabel(value: string | null | undefined) {
    if (!value) {
        return null;
    }

    const match = value.match(/(-?\d+(?:[.,]\d+)?)\s*%/);

    if (!match) {
        return null;
    }

    const parsed = Number(match[1]?.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed / 100 : null;
}

function formatPercent(value: number) {
    return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function getVisualGradientStops(gradient: readonly [string, string], gradientAlpha: readonly [number, number]) {
    return {
        startColor: gradient[1],
        startOpacity: gradientAlpha[1] / 100,
        endColor: gradient[0],
        endOpacity: gradientAlpha[0] / 100,
    };
}

function isTurnoVisualHiddenBucket(bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number]) {
    const normalizedBucketKey = bucket.bucketKey.toLocaleLowerCase('en-US');
    return normalizedBucketKey.startsWith('sin-turno:') || normalizedBucketKey === 'turno-summary:sin-turno';
}

function buildTurnoSummaryBuckets(grouped: ReturnType<typeof computeActivityAnalytics>['grouped'], shifts: ShiftDefinition[]) {
    const shiftBuckets = new Map<string, { bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number]; sortOrder: number }>();
    const shiftOrderById = new Map(shifts.map((shift, index) => [shift.id, index]));
    const shiftLabelById = new Map(shifts.map((shift) => [shift.id, shift.label.trim()]));
    let fallbackSortOrder = shifts.length;

    for (const bucket of grouped) {
        const shiftKeyMatch = bucket.bucketKey.match(/^shift:([^:]+):/i);
        const shiftId = shiftKeyMatch?.[1] ?? (bucket.bucketKey.startsWith('sin-turno:') ? 'sin-turno' : null);

        if (!shiftId) {
            continue;
        }

        const label = shiftId === 'sin-turno' ? 'sin turno' : (shiftLabelById.get(shiftId) ?? shiftId);
        const sortOrder = shiftId === 'sin-turno'
            ? Number.MAX_SAFE_INTEGER
            : (shiftOrderById.get(shiftId) ?? fallbackSortOrder++);
        const current = shiftBuckets.get(shiftId);

        if (!current) {
            shiftBuckets.set(shiftId, {
                bucket: {
                    ...bucket,
                    bucketKey: `turno-summary:${shiftId}`,
                    label,
                    isInProgress: false,
                    hasInProgressContribution: bucket.isInProgress,
                },
                sortOrder,
            });
            continue;
        }

        const durationsMs = {
            prod: current.bucket.durationsMs.prod + bucket.durationsMs.prod,
            setup: current.bucket.durationsMs.setup + bucket.durationsMs.setup,
            stopped: current.bucket.durationsMs.stopped + bucket.durationsMs.stopped,
            noData: current.bucket.durationsMs.noData + bucket.durationsMs.noData,
        };
        const expectedDurationMs = current.bucket.expectedDurationMs + bucket.expectedDurationMs;
        const coverageRatio = expectedDurationMs > 0
            ? Math.min((durationsMs.prod + durationsMs.setup + durationsMs.stopped) / expectedDurationMs, 1)
            : 0;
        const productiveDurationMs = durationsMs.prod + durationsMs.setup + durationsMs.stopped;
        const productivityRatio = coverageRatio < 1 || productiveDurationMs <= 0
            ? null
            : durationsMs.prod / productiveDurationMs;

        shiftBuckets.set(shiftId, {
            sortOrder,
            bucket: {
                ...current.bucket,
                label,
                durationsMs,
                expectedDurationMs,
                coverageRatio,
                productivityRatio,
                productivityLabel: productivityRatio === null ? current.bucket.productivityLabel : formatPercent(productivityRatio),
                hasInProgressContribution: current.bucket.hasInProgressContribution || bucket.isInProgress || bucket.hasInProgressContribution === true,
            },
        });
    }

    return [...shiftBuckets.values()]
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((entry) => entry.bucket);
}

function validateComputedAnalytics(result: ReturnType<typeof computeActivityAnalytics> | null): asserts result is ReturnType<typeof computeActivityAnalytics> {
    if (!result || !Array.isArray(result.grouped)) {
        throw new Error('Activity analytics computation result is invalid');
    }
}

function resolveMachineBinding(rawMachineId: unknown, machines?: ContractMachine[]) {
    if (rawMachineId == null || rawMachineId === '') {
        return { status: 'missing' as const, machineId: null };
    }

    const machineId = typeof rawMachineId === 'number' && Number.isSafeInteger(rawMachineId) && rawMachineId > 0
        ? rawMachineId
        : typeof rawMachineId === 'string' && /^\d+$/.test(rawMachineId.trim())
            ? Number(rawMachineId)
            : null;

    if (machineId === null) {
        return { status: 'invalid' as const, machineId: null };
    }

    const selectedMachine = machines?.find((machine) => machine.unitId === machineId);

    if (machines && !selectedMachine) {
        return { status: 'invalid' as const, machineId: null };
    }

    return { status: 'valid' as const, machineId };
}

function resolveErrorState(error: Error | null) {
    if (error instanceof ActivitySeriesAdapterError) {
        return {
            title: 'Activity-Series devolvió datos inválidos',
            message: 'La respuesta recibida no cumple el contrato esperado para esta analítica.',
            icon: <AlertTriangle size={20} className="text-status-warning" />,
        };
    }

    if (error instanceof DataServiceError) {
        if (typeof error.statusCode === 'number') {
            return {
                title: 'Activity-Series rechazó la consulta',
                message: error.message,
                icon: <AlertTriangle size={20} className="text-status-warning" />,
            };
        }

        return {
            title: 'No se pudo conectar con Activity-Series',
            message: 'Revise la conectividad con la fuente de datos e intente nuevamente.',
            icon: <PlugZap size={20} className="text-status-warning" />,
        };
    }

    return {
        title: 'No se pudo interpretar Activity-Series',
        message: 'La respuesta recibida no pudo procesarse para esta analítica.',
        icon: <AlertTriangle size={20} className="text-status-warning" />,
    };
}

function resolveProcessingErrorState(error: unknown) {
    if (error instanceof Error && error.message.includes('bucketMs')) {
        return {
            title: 'Ventana temporal inválida',
            message: 'Activity-Series no devolvió una resolución temporal válida para calcular la analítica.',
            icon: <AlertTriangle size={20} className="text-status-warning" />,
        };
    }

    return resolveErrorState(error instanceof Error ? error : null);
}

function renderStateCard({
    className,
    header,
    title,
    message,
    icon,
}: {
    className?: string;
    header: ReactNode;
    title: string;
    message: string;
    icon: ReactNode;
}) {
    return (
        <div className={`${WIDGET_SHELL_CLASS} ${className ?? ''}`} data-testid="prod-trend-widget-root">
            <WidgetCenteredContentLayout header={header} contentClassName="pt-14">
                <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
                    {icon}
                    <div className="uppercase text-industrial-text" style={GENERAL_TYPOGRAPHY_STYLE}>{title}</div>
                    <div className="text-industrial-muted" style={GENERAL_TYPOGRAPHY_STYLE}>{message}</div>
                </div>
            </WidgetCenteredContentLayout>
        </div>
    );
}
