import { memo, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { TrendingUp } from 'lucide-react';
import { ActivitySeriesAdapterError } from '../../adapters/activitySeries.adapter';
import WidgetCenteredContentLayout from '../../components/ui/WidgetCenteredContentLayout';
import WidgetChartLayout from '../../components/ui/WidgetChartLayout';
import {
    resolveWidgetChartLayoutMetrics,
    WIDGET_CHART_CONTAINER_CLASS,
    WIDGET_CHART_HEADER_CLASS,
} from '../../components/ui/WidgetChartLayout.shared';
import ChartTooltip from '../../components/ui/ChartTooltip';
import type { ChartTooltipSeries } from '../../components/ui/ChartTooltip';
import WidgetHeader from '../../components/ui/WidgetHeader';
import WidgetHeaderTemporalControls from '../../components/ui/WidgetHeaderTemporalControls';
import WidgetRuntimeState from '../../components/ui/WidgetRuntimeState';
import AnalyticsDataModeDot from '../../components/ui/AnalyticsDataModeDot';
import { isDataActivitySeriesEnabled } from '../../config/dataConnection.config';
import type { ProdTrendWidgetConfig, ShiftDefinition } from '../../domain/admin.types';
import type { ConnectionHealth, ContractMachine } from '../../domain/dataContract.types';
import { PROD_TREND_HISTORY_VARIABLE_KEY } from '../../domain/prodTrendDataMode.types';
import { useTemporalSettings } from '../../hooks/useTemporalSettings';
import { useProdTrendDataSource } from '../../queries/useProdTrendDataSource';
import { DataServiceError } from '../../services/dataOverview.service';
import { validateActivityAnalyticsThresholds } from '../../utils/activityAnalytics';
import { computeActivityAnalytics, resolveActivityAnalyticsComparableProductivityRatio } from '../../utils/activityAnalyticsComputation';
import { resolveActivityAnalyticsDisplayRules } from '../../utils/activityAnalyticsDisplayRules';
import { resolveActivityAnalyticsTimezone } from '../../utils/activityAnalyticsGrouping';
import { buildAreaPath, clamp, computeVisibleLabelIndices, getChartLetterSpacingPx, getChartTextFont, measureChartTextWidthPx, measureSmoothPathLength, resolveAnimationDurationSecondsFromPathLength, smoothPath } from '../../utils/chartHelpers';
import { createDefaultProdTrendDisplayOptions, resolveProdTrendDisplayOptions } from '../../utils/prodTrendWidgetDefaults';
import { buildActivityAnalyticsSimulatedHistory } from '../../utils/activityAnalyticsSimulation';

interface ProdTrendWidgetProps {
    widget: ProdTrendWidgetConfig;
    machines?: ContractMachine[];
    connection?: ConnectionHealth;
    isLoadingOverview?: boolean;
    hasOverviewError?: boolean;
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
const LATEST_VALUE_LABEL_TOP_CLAMP_PADDING_PX = 10;
const LATEST_VALUE_LABEL_FLOAT_TRAVEL_PX = 2.75;
const LATEST_VALUE_LABEL_FLOAT_SAFETY_MARGIN_PX = 2;
const LATEST_VALUE_LABEL_FLOAT_CLEARANCE_PX = LATEST_VALUE_LABEL_FLOAT_TRAVEL_PX + LATEST_VALUE_LABEL_FLOAT_SAFETY_MARGIN_PX;
const TRAVELING_GLOW_SPEED_PX_PER_SECOND = 323;
const TRAVELING_GLOW_DURATION_MIN_SECONDS = 0.9;
const TRAVELING_GLOW_DURATION_MAX_SECONDS = 3.2;
const TRAVELING_GLOW_PAUSE_MIN_MS = 8_000;
const TRAVELING_GLOW_PAUSE_MAX_MS = 20_000;
const LINE_GLOW_FILTER_SAFETY_MARGIN_PX = 1;
const DEFAULT_LINE_STROKE_WIDTH = 2.5;
const DEFAULT_LINE_GLOW_BLUR = 3;
const MIN_LINE_STROKE_WIDTH = 0.5;
const MAX_LINE_STROKE_WIDTH = 6;
const MIN_LINE_GLOW_BLUR = 0;
const MAX_LINE_GLOW_BLUR = 8;

// eslint-disable-next-line react-refresh/only-export-components -- test-only helper kept colocated with the widget renderer
export function clampLineStrokeWidth(value: number | undefined): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_LINE_STROKE_WIDTH;
    }

    return clamp(value as number, MIN_LINE_STROKE_WIDTH, MAX_LINE_STROKE_WIDTH);
}

// eslint-disable-next-line react-refresh/only-export-components -- test-only helper kept colocated with the widget renderer
export function clampLineGlowBlur(value: number | undefined): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_LINE_GLOW_BLUR;
    }

    return clamp(value as number, MIN_LINE_GLOW_BLUR, MAX_LINE_GLOW_BLUR);
}

export default function ProdTrendWidget({
    widget,
    machines,
    connection,
    isLoadingOverview = false,
    hasOverviewError = false,
    isLoadingData = false,
    className,
}: ProdTrendWidgetProps) {
    const displayOptions = resolveProdTrendDisplayOptions(widget.displayOptions ?? createDefaultProdTrendDisplayOptions());
    const lineStrokeWidth = clampLineStrokeWidth(widget.displayOptions?.lineStrokeWidth);
    const lineGlowBlur = clampLineGlowBlur(widget.displayOptions?.lineGlowBlur);
    const [runtimeViewState, setRuntimeViewState] = useState<ProdTrendRuntimeViewState>(() => createRuntimeViewState(displayOptions));
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const [bodySize, setBodySize] = useState<{ width: number; height: number } | null>(null);
    const [simulatedNowMs] = useState(() => Date.now());
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
    const isOverviewUnavailable = isActivityOverviewUnavailable({
        connection,
        hasOverviewError,
    });
    const sourceMachineId = machineBinding.status === 'valid' ? machineBinding.machineId : null;
    const simulatedMachineId = typeof widget.binding?.machineId === 'number'
        ? widget.binding.machineId
        : undefined;
    const simulatedMetricKey = widget.binding?.variableKey ?? PROD_TREND_HISTORY_VARIABLE_KEY;
    const simulatedMetric = machines
        ?.find((machine) => machine.unitId === simulatedMachineId)
        ?.values[simulatedMetricKey];
    const { config, shifts } = useTemporalSettings();
    const activitySeriesParams = sourceMachineId != null
        ? {
            machineId: sourceMachineId,
            ...(activeDisplayOptions.range === 'custom'
                ? { range: 'custom' as const, start: activeDisplayOptions.start ?? '', end: activeDisplayOptions.end ?? '' }
                : { range: activeDisplayOptions.range }),
        }
        : null;
    const dataSource = useProdTrendDataSource({
        configuredMode: displayOptions.dataMode,
        params: activitySeriesParams,
    });
    const simulatedActivityData = useMemo(() => {
        if (displayOptions.dataMode !== 'simulated') {
            return null;
        }

        const simulatedHistory = buildActivityAnalyticsSimulatedHistory({
            widgetId: widget.id,
            machineId: simulatedMachineId,
            variableKey: simulatedMetricKey,
            range: activeDisplayOptions.range,
            customWindow: activeDisplayOptions.range === 'custom'
                ? { start: activeDisplayOptions.start ?? '', end: activeDisplayOptions.end ?? '' }
                : undefined,
            baseValue: (activeDisplayOptions.setupThresholdKw + activeDisplayOptions.prodThresholdKw) / 2,
            operatingLevels: {
                stopped: Math.max(activeDisplayOptions.setupThresholdKw * 0.2, 0),
                setup: activeDisplayOptions.setupThresholdKw
                    + ((activeDisplayOptions.prodThresholdKw - activeDisplayOptions.setupThresholdKw) * 0.45),
                production: activeDisplayOptions.prodThresholdKw
                    + Math.max(
                        (activeDisplayOptions.prodThresholdKw - activeDisplayOptions.setupThresholdKw) * 0.35,
                        activeDisplayOptions.prodThresholdKw * 0.08,
                        0.1,
                    ),
            },
            nowMs: simulatedNowMs,
        });

        return {
            ...simulatedHistory,
            unit: simulatedMetric?.unit ?? widget.binding?.unit ?? 'kW',
            purpose: 'activity-analytics' as const,
            window: {
                ...simulatedHistory.window,
                timezone: undefined,
                bucket: 'synthetic',
            },
        };
    }, [activeDisplayOptions.end, activeDisplayOptions.prodThresholdKw, activeDisplayOptions.range, activeDisplayOptions.setupThresholdKw, activeDisplayOptions.start, displayOptions.dataMode, simulatedMachineId, simulatedMetric?.unit, simulatedMetricKey, simulatedNowMs, widget.binding?.unit, widget.id]);
    const activityData = displayOptions.dataMode === 'simulated'
        ? simulatedActivityData
        : dataSource.response;
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
            nowMs: displayOptions.dataMode === 'simulated' ? simulatedNowMs : undefined,
        });
    }, [activeDisplayOptions.prodThresholdKw, activeDisplayOptions.setupThresholdKw, activeGroupBy, activityData, displayOptions.dataMode, displayRules.range, shifts, simulatedNowMs, timezone]);

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

    const dataModeDot = (
        <AnalyticsDataModeDot
            mode={dataSource.effectiveMode}
            testId="prod-trend-widget-data-mode"
        />
    );
    const header = (
        <WidgetHeader
            title={widget.title ?? 'PROD-TREND'}
            titleLeading={dataModeDot}
            icon={TrendingUp}
            iconPosition="left"
            iconTestId="prod-trend-widget-header-icon"
            className={WIDGET_CHART_HEADER_CLASS}
            trailing={(
                <WidgetHeaderTemporalControls
                    variant="pill"
                    testId="prod-trend-widget-runtime-controls"
                    indicatorTestId="prod-trend-widget-runtime-control-indicator"
                    groups={[
                        {
                            testId: 'prod-trend-widget-runtime-range-selector',
                            options: RANGE_OPTIONS,
                            selectedValue: activeDisplayOptions.range,
                            onSelect: (value) => {
                                const nextRange = value as ResolvedProdTrendDisplayOptions['range'];
                                const nextDisplayOptions = {
                                    ...widget.displayOptions,
                                    ...activeDisplayOptions,
                                    range: nextRange,
                                    start: undefined,
                                    end: undefined,
                                } satisfies ResolvedProdTrendDisplayOptions;

                                setRuntimeViewState((current) => ({
                                    ...current,
                                    selectionOverride: nextDisplayOptions,
                                }));
                            },
                        },
                        {
                            testId: 'prod-trend-widget-runtime-group-selector',
                            options: groupBySelectOptions,
                            selectedValue: activeGroupBy,
                            onSelect: (value) => {
                                const nextGroupBy = value as RuntimeProdTrendGroupBy;

                                setRuntimeViewState((current) => ({
                                    ...current,
                                    runtimeGroupBy: nextGroupBy,
                                }));
                            },
                        },
                    ]}
                />
            )}
        />
    );

    if (displayOptions.dataMode === 'real' && machineBinding.status === 'missing') {
        return renderRuntimeState({
            className,
            header,
            label: 'Seleccione una máquina',
            state: 'invalid-config',
        });
    }

    if (displayOptions.dataMode === 'real' && machineBinding.status === 'invalid') {
        if (isLoadingOverview
            && machineBinding.reason === 'machine_lookup_pending_or_missing') {
            return renderRuntimeState({
                className,
                header,
                state: 'loading',
            });
        }

        if (isOverviewUnavailable) {
            return renderRuntimeState({
                className,
                header,
                state: 'disconnected',
            });
        }

        return renderRuntimeState({
            className,
            header,
            label: 'Seleccione una máquina válida',
            state: 'invalid-config',
        });
    }

    if (displayOptions.dataMode !== 'simulated' && !isDataActivitySeriesEnabled()) {
        return renderRuntimeState({
            className,
            header,
            label: 'Endpoint Activity-Series no configurado',
            state: 'invalid-config',
        });
    }

    try {
        validateActivityAnalyticsThresholds({
            setupKw: displayOptions.setupThresholdKw,
            prodKw: displayOptions.prodThresholdKw,
        });
    } catch {
        return renderRuntimeState({
            className,
            header,
            label: 'Configuración de umbrales inválida',
            state: 'invalid-config',
        });
    }

    if (displayOptions.dataMode !== 'simulated' && (isLoadingData || dataSource.isLoading)) {
        return renderRuntimeState({
            className,
            header,
            state: 'loading',
        });
    }

    if (displayOptions.dataMode !== 'simulated' && dataSource.error) {
        return renderRuntimeState({
            className,
            header,
            ...resolveErrorState(dataSource.error),
        });
    }

    if (!activityData || activityData.series.length === 0) {
        return renderRuntimeState({
            className,
            header,
            label: 'Sin datos de actividad',
            state: 'empty',
        });
    }

    try {
        validateComputedAnalytics(computedAnalytics);
    } catch (error) {
        const resolvedState = resolveProcessingErrorState(error);

        return renderRuntimeState({
            className,
            header,
            label: resolvedState.label,
            state: resolvedState.state,
        });
    }

    if (computedAnalytics.grouped.length === 0) {
        return renderRuntimeState({
            className,
            header,
            label: 'Sin grupos para mostrar',
            state: 'empty',
        });
    }

    const chartViewportWidth = Math.max(bodySize?.width ?? 640, CHART_MIN_WIDTH_PX);
    const chartHeight = resolveProdTrendChartHeight(bodySize?.height ?? 180);
    const groupsLayout = resolveGroupsLayout(chartViewportWidth, grouped.length);
    const xAxisModel = resolveXAxisModel({
        grouped,
        width: chartViewportWidth,
        layout: groupsLayout,
    });

    return (
        <div className={`${WIDGET_SHELL_CLASS} ${className ?? ''}`} data-testid="prod-trend-widget-root">
            {header}
            <div className="flex min-h-0 flex-1 flex-col" data-testid="prod-trend-widget-body">
                <div
                    ref={bodyRef}
                    className={WIDGET_CHART_CONTAINER_CLASS}
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
                                key={`${activeDisplayOptions.range}:${activeGroupBy}`}
                                widgetId={widget.id}
                                grouped={grouped}
                                width={xAxisModel.chartWidth}
                                height={chartHeight}
                                lineColors={displayOptions.trendLineColors}
                                lineColorAlphas={displayOptions.trendLineColorAlphas}
                                prodTrendBands={displayOptions.prodTrendBands}
                                lineStrokeWidth={lineStrokeWidth}
                                lineGlowBlur={lineGlowBlur}
                                xAxisModel={xAxisModel}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
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
    widgetId,
    grouped,
    width,
    height,
    lineColors,
    lineColorAlphas,
    prodTrendBands,
    lineStrokeWidth,
    lineGlowBlur,
    xAxisModel,
}: {
    widgetId: string;
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    width: number;
    height: number;
    lineColors: [string, string];
    lineColorAlphas: [number, number];
    prodTrendBands: ReturnType<typeof resolveProdTrendDisplayOptions>['prodTrendBands'];
    lineStrokeWidth: number;
    lineGlowBlur: number;
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
    const { labels, sampleLabels } = xAxisModel;
    const chartFont = getChartTextFont();
    const chartLetterSpacing = getChartLetterSpacingPx();
    const chartLayout = resolveWidgetChartLayoutMetrics({
        width,
        height,
        hasTopAdornments: true,
        firstXAxisLabel: labels[0] ?? '',
        lastXAxisLabel: labels[labels.length - 1] ?? '',
        yAxisTickLabels: ['100', '75', '50', '25', '0'],
        idPrefix: `${widgetId}-${gradientPrefix}`,
        alignPlotAreaToXAxisLabels: true,
    });
    const plotWidth = chartLayout.plotArea.width;
    const plotHeight = chartLayout.plotArea.height;
    const baselineY = chartLayout.plotArea.bottom;
    const lineGlowFilterPadding = Math.ceil(
        (3 * lineGlowBlur) + (lineStrokeWidth / 2) + LINE_GLOW_FILTER_SAFETY_MARGIN_PX,
    );
    const lineGlowFilterRegion = {
        x: chartLayout.plotArea.left - lineGlowFilterPadding,
        y: chartLayout.plotArea.top - lineGlowFilterPadding,
        width: plotWidth + (2 * lineGlowFilterPadding),
        height: plotHeight + (2 * lineGlowFilterPadding),
    };
    const positions = grouped.length > 1
        ? grouped.map((_, index) => chartLayout.xAxisLabels.left + ((chartLayout.xAxisLabels.plotWidth * index) / (grouped.length - 1)))
        : grouped.map(() => chartLayout.xAxisLabels.left + (chartLayout.xAxisLabels.plotWidth / 2));
    const visibleLabelIndices = sampleLabels
        ? computeVisibleLabelIndices(
            labels,
            positions,
            chartFont,
            8,
            chartLayout.xAxisLabels.right,
            chartLetterSpacing,
        )
        : new Set(grouped.map((_, index) => index));
    ensureLastXAxisLabelVisibility({
        visibleLabelIndices,
        labels,
        positions,
        font: chartFont,
        letterSpacing: chartLetterSpacing,
        minGap: 8,
    });
    const renderablePoints = grouped.map((bucket, index) => {
        const productivityRatio = resolveGroupedTrendProductivityRatio(bucket);
        const y = productivityRatio === null
            ? null
            : chartLayout.plotArea.top + plotHeight - (clamp(productivityRatio, 0, 1) * plotHeight);

        return {
            bucketKey: bucket.bucketKey,
            isPartial: bucket.isInProgress || bucket.hasInProgressContribution === true,
            x: positions[index] ?? (chartLayout.plotArea.left + (plotWidth / 2)),
            y,
            markerY: y ?? baselineY,
            valueState: productivityRatio === null ? 'missing' : 'measured',
        };
    });
    const lineSegments = buildLineSegments(renderablePoints);
    const yTicks = Array.from({ length: 5 }, (_, index) => ({
        value: 100 - (index * 25),
        y: chartLayout.plotArea.top + ((index / 4) * plotHeight),
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
    const latestValueLabelPlacement = latestPoint?.y != null
        ? resolveProdTrendLatestValueLabelPlacement({
            latestPointY: latestPoint.y,
            chartTop: chartLayout.plotArea.top,
        })
        : 'above';
    const latestValueLabelY = latestPoint?.y != null
        ? latestValueLabelPlacement === 'below'
            ? latestPoint.y + LATEST_VALUE_LABEL_Y_OFFSET_PX + LATEST_VALUE_LABEL_FLOAT_CLEARANCE_PX
            : Math.max(
                chartLayout.plotArea.top + LATEST_VALUE_LABEL_TOP_CLAMP_PADDING_PX,
                latestPoint.y - LATEST_VALUE_LABEL_Y_OFFSET_PX,
            )
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
        ? Math.max((positions[1] ?? chartLayout.plotArea.left) - (positions[0] ?? chartLayout.plotArea.left), 1)
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
            <WidgetChartLayout
                layout={chartLayout}
                svgTestId="prod-trend-widget-chart"
                overlaySvgTestId="prod-trend-widget-overlay-svg"
                svgProps={{
                    'data-y-domain-min': '0',
                    'data-y-domain-max': '100',
                }}
                renderMain={(layout) => (
                    <>
                        <defs>
                            <linearGradient id={lineGradientId} gradientUnits="userSpaceOnUse" x1={layout.plotArea.left} y1="0" x2={layout.plotArea.right} y2="0">
                        <stop offset="0%" stopColor={gradientStops.startColor} stopOpacity={Math.max(gradientStops.startOpacity, 0.72)} />
                        <stop offset="100%" stopColor={gradientStops.endColor} stopOpacity={Math.max(gradientStops.endOpacity, 0.92)} />
                    </linearGradient>

                    <linearGradient id={areaGradientId} gradientUnits="userSpaceOnUse" x1={layout.plotArea.left} y1="0" x2={layout.plotArea.right} y2="0">
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

                    <filter
                        id={glowId}
                        filterUnits="userSpaceOnUse"
                        x={lineGlowFilterRegion.x}
                        y={lineGlowFilterRegion.y}
                        width={lineGlowFilterRegion.width}
                        height={lineGlowFilterRegion.height}
                    >
                        <feGaussianBlur stdDeviation={lineGlowBlur} result="blur" />
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

                        <g clipPath={`url(#${layout.plotClipPathId})`} data-testid="prod-trend-widget-band-layer" style={{ mixBlendMode: prodTrendBands.blendMode }}>
                    {activeBandIntervals.map((interval) => (
                        <g key={`prod-trend-band-${interval.index}`} data-testid="prod-trend-widget-band-group">
                            <rect
                                x={interval.x}
                                y={layout.plotArea.top}
                                width={interval.width}
                                height={plotHeight}
                                fill={`url(#${bandGradientId})`}
                                data-testid="prod-trend-widget-band"
                            />
                            <line
                                x1={interval.x}
                                x2={interval.x}
                                y1={layout.plotArea.top}
                                y2={baselineY}
                                stroke="var(--color-chart-grid)"
                                strokeOpacity={0.42}
                                strokeWidth={1}
                                strokeDasharray="3 3"
                            />
                            <line
                                x1={interval.x + interval.width}
                                x2={interval.x + interval.width}
                                y1={layout.plotArea.top}
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
                        x1={layout.plotArea.left}
                        x2={layout.plotArea.right}
                        y1={tick.y}
                        y2={tick.y}
                        stroke="var(--color-chart-grid)"
                        strokeDasharray="3 3"
                        data-testid="prod-trend-widget-y-grid-line"
                    />
                        ))}

                        <line x1={layout.plotArea.left} x2={layout.plotArea.right} y1={baselineY} y2={baselineY} stroke="var(--color-industrial-border)" />
                        <line x1={layout.plotArea.left} x2={layout.plotArea.left} y1={layout.plotArea.top} y2={baselineY} stroke="var(--color-industrial-border)" />

                        <text
                            x={layout.yAxisUnitSlot.x}
                            y={layout.yAxisUnitSlot.y}
                            textAnchor={layout.yAxisUnitSlot.textAnchor}
                            fill="var(--color-widget-icon)"
                            style={GENERAL_TYPOGRAPHY_STYLE}
                            data-testid="prod-trend-widget-y-axis-unit"
                        >
                            %
                        </text>

                        {lineSegments.map((segment, index) => {
                    const singlePoint = segment.length === 1 ? segment[0] : null;
                    const linePath = singlePoint
                        ? `M ${singlePoint.x} ${singlePoint.y} L ${singlePoint.x} ${singlePoint.y}`
                        : smoothPath(segment);
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
                                    strokeWidth={lineStrokeWidth}
                                    strokeLinecap="round"
                                    vectorEffect="non-scaling-stroke"
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
                        clipPath={`url(#${layout.plotClipPathId})`}
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

                        {hoveredPoint && (
                    <g pointerEvents="none" data-testid="prod-trend-widget-hover-affordance">
                        <line
                            x1={hoveredPoint.x}
                            x2={hoveredPoint.x}
                            y1={layout.plotArea.top}
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
                        x={layout.plotArea.left - 8}
                        y={tick.y}
                        dy={4}
                        textAnchor="end"
                        fill="var(--color-industrial-muted)"
                        style={CHART_TYPOGRAPHY_STYLE}
                        data-testid="prod-trend-widget-y-axis-tick"
                    >
                        {tick.value}
                    </text>
                        ))}

                        {grouped.map((bucket, index) => {
                    if (!visibleLabelIndices.has(index)) {
                        return null;
                    }

                    const x = positions[index] ?? (layout.plotArea.left + (plotWidth / 2));
                    const label = labels[index] ?? '';

                    return (
                        <text
                            key={`prod-trend-x-tick-${bucket.bucketKey}`}
                            x={x}
                            y={layout.xAxisLabels.y}
                            textAnchor="middle"
                            fill="var(--color-industrial-muted)"
                            style={CHART_TYPOGRAPHY_STYLE}
                            data-testid="prod-trend-widget-x-axis-label"
                        >
                            {label}
                        </text>
                    );
                        })}

                        {grouped.map((bucket, index) => {
                    const centerX = positions[index] ?? (layout.plotArea.left + (plotWidth / 2));
                    const hitWidth = grouped.length > 1 ? hitStep : plotWidth;

                    return (
                        <rect
                            key={`prod-trend-hit-${bucket.bucketKey}`}
                            x={Math.max(centerX - (hitWidth / 2), layout.plotArea.left)}
                            y={layout.plotArea.top}
                            width={Math.min(hitWidth, plotWidth)}
                            height={plotHeight}
                            fill="transparent"
                            cursor="crosshair"
                            data-testid="prod-trend-widget-hit-area"
                            data-productivity-ratio={resolveGroupedTrendProductivityRatio(bucket) ?? ''}
                            data-chart-y={renderablePoints[index]?.y ?? ''}
                            onMouseEnter={() => setHoverInfo({ index, x: centerX })}
                            onMouseLeave={() => setHoverInfo(null)}
                        />
                    );
                        })}
                    </>
                )}
                renderOverlay={() => latestPoint ? (
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
                ) : null}
                />

            {!hasRenderableTrend && (
                <WidgetRuntimeState
                    state={hasLabels ? 'empty-comparable' : 'empty'}
                    className="absolute inset-0"
                    testId="prod-trend-widget-empty"
                />
            )}

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

function resolveProdTrendChartHeight(panelHeight: number) {
    return Math.max(
        Math.round(panelHeight),
        CHART_MARGIN.top + CHART_MARGIN.bottom + STANDARD_CHART_MIN_HEIGHT_PX,
    );
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
}: {
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    width: number;
    layout: { density: 'fit' | 'compress' | 'scroll'; minSlotWidthPx: number; sampleLabels: boolean };
}) {
    const chartWidth = layout.density === 'scroll'
        ? Math.max(width, CHART_MARGIN.left + CHART_MARGIN.right + (grouped.length * layout.minSlotWidthPx))
        : width;
    const labels = grouped.map((bucket) => bucket.label.replace(/\s+\((?:en\s+curso)\)$/i, '').trim());

    return {
        chartWidth,
        labels,
        sampleLabels: layout.sampleLabels,
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
        anchor: 'middle',
    });

    Array.from(visibleLabelIndices)
        .filter((index) => index !== lastIndex)
        .sort((left, right) => right - left)
        .forEach((index) => {
            const width = measureChartTextWidthPx(labels[index] ?? '', font, letterSpacing);
            const bounds = resolveXAxisLabelBounds({
                x: positions[index] ?? 0,
                width,
                anchor: 'middle',
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
    const [travelState, setTravelState] = useState({ cycleKey: 0, progress: 0, isPaused: false });

    useEffect(() => {
        if (!enabled || prefersReducedMotion) {
            return undefined;
        }

        const travelDurationMs = durationSeconds * 1000;
        const pauseMs = Math.round(TRAVELING_GLOW_PAUSE_MIN_MS + (Math.random() * (TRAVELING_GLOW_PAUSE_MAX_MS - TRAVELING_GLOW_PAUSE_MIN_MS)));
        const startTime = performance.now();
        const activeCycleKey = cycleKey;
        let frameId = 0;

        const animate = (now: number) => {
            const nextProgress = clamp(now - startTime, 0, travelDurationMs) / travelDurationMs;
            setTravelState({ cycleKey: activeCycleKey, progress: nextProgress, isPaused: false });

            if (nextProgress < 1) {
                frameId = window.requestAnimationFrame(animate);
            }
        };

        frameId = window.requestAnimationFrame(animate);
        const hideTimerId = window.setTimeout(() => {
            setTravelState({ cycleKey: activeCycleKey, progress: 1, isPaused: true });
        }, travelDurationMs);
        const restartTimerId = window.setTimeout(() => setCycleKey((current) => current + 1), travelDurationMs + pauseMs);

        return () => {
            window.cancelAnimationFrame(frameId);
            window.clearTimeout(hideTimerId);
            window.clearTimeout(restartTimerId);
        };
    }, [cycleKey, durationSeconds, enabled, prefersReducedMotion]);

    const isAnimationDisabled = !enabled || prefersReducedMotion;
    const isCurrentCycleState = travelState.cycleKey === cycleKey;
    const progress = isAnimationDisabled || !isCurrentCycleState ? 0 : travelState.progress;
    const isPaused = isAnimationDisabled || !isCurrentCycleState ? false : travelState.isPaused;

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

// eslint-disable-next-line react-refresh/only-export-components -- test-only helper kept colocated with the widget renderer
export function resolveProdTrendLatestValueLabelPlacement({
    latestPointY,
    chartTop,
}: {
    latestPointY: number;
    chartTop: number;
}): 'above' | 'below' {
    return latestPointY - LATEST_VALUE_LABEL_Y_OFFSET_PX - LATEST_VALUE_LABEL_FLOAT_CLEARANCE_PX
        < chartTop + LATEST_VALUE_LABEL_TOP_CLAMP_PADDING_PX
        ? 'below'
        : 'above';
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
        return { status: 'invalid' as const, machineId: null, reason: 'malformed_binding' as const };
    }

    const selectedMachine = machines?.find((machine) => machine.unitId === machineId);

    if (machines && !selectedMachine) {
        return { status: 'invalid' as const, machineId, reason: 'machine_lookup_pending_or_missing' as const };
    }

    return { status: 'valid' as const, machineId };
}

function isActivityOverviewUnavailable({
    connection,
    hasOverviewError,
}: {
    connection?: ConnectionHealth;
    hasOverviewError: boolean;
}) {
    if (hasOverviewError) {
        return true;
    }

    return connection?.globalStatus === 'offline' || connection?.globalStatus === 'unknown';
}

function resolveErrorState(error: Error | null) {
    if (error instanceof ActivitySeriesAdapterError) {
        return {
            label: 'Activity-Series devolvió datos inválidos',
            state: 'error' as const,
        };
    }

    if (error instanceof DataServiceError) {
        if (typeof error.statusCode === 'number') {
            return {
                label: 'Activity-Series rechazó la consulta',
                state: 'error' as const,
            };
        }

        return {
            label: 'No se pudo conectar con Activity-Series',
            state: 'error' as const,
        };
    }

    return {
        label: 'No se pudo interpretar Activity-Series',
        state: 'error' as const,
    };
}

function resolveProcessingErrorState(error: unknown) {
    if (error instanceof Error && error.message.includes('bucketMs')) {
        return {
            label: 'Ventana temporal inválida',
            state: 'error' as const,
        };
    }

    return resolveErrorState(error instanceof Error ? error : null);
}

function renderRuntimeState({
    className,
    header,
    label,
    state,
}: {
    className?: string;
    header: ReactNode;
    label?: string;
    state: 'loading' | 'disconnected' | 'error' | 'invalid-config' | 'empty';
}) {
    return (
        <div className={`${WIDGET_SHELL_CLASS} ${className ?? ''}`} data-testid="prod-trend-widget-root">
            <WidgetCenteredContentLayout header={header} contentClassName="pt-14">
                <WidgetRuntimeState
                    state={state}
                    labelOverride={label}
                    testId="prod-trend-widget-runtime-state"
                />
            </WidgetCenteredContentLayout>
        </div>
    );
}
