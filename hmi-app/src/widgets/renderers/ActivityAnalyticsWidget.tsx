import { memo, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { BarChart2 } from 'lucide-react';
import { ActivitySeriesAdapterError } from '../../adapters/activitySeries.adapter';
import type { ActivityAnalyticsPersistedDisplayPatch, ActivityAnalyticsWidgetConfig, ShiftDefinition, WidgetConfig } from '../../domain/admin.types';
import type { ConnectionHealth, ContractMachine } from '../../domain/dataContract.types';
import { isDataActivitySeriesEnabled } from '../../config/dataConnection.config';
import WidgetCenteredContentLayout from '../../components/ui/WidgetCenteredContentLayout';
import ChartHoverLayer from '../../components/ui/ChartHoverLayer';
import ChartTooltip from '../../components/ui/ChartTooltip';
import type { ChartTooltipSeries } from '../../components/ui/ChartTooltip';
import WidgetHeader from '../../components/ui/WidgetHeader';
import WidgetHeaderTemporalControls from '../../components/ui/WidgetHeaderTemporalControls';
import WidgetRuntimeState from '../../components/ui/WidgetRuntimeState';
import { useTemporalSettings } from '../../hooks/useTemporalSettings';
import { createActivitySeriesQueryKey, createActivitySeriesQueryOptions, useActivitySeries } from '../../queries/useActivitySeries';
import { DataServiceError } from '../../services/dataOverview.service';
import {
    recordActivityAnalyticsPerformanceDiagnostic,
    startActivityAnalyticsPerformanceTransition,
} from '../../utils/activityAnalyticsPerformanceDiagnostics';
import { validateActivityAnalyticsThresholds } from '../../utils/activityAnalytics';
import {
    computeActivityAnalytics,
    resolveActivityAnalyticsComparableProductivityRatio,
    resolveActivityAnalyticsComparison,
} from '../../utils/activityAnalyticsComputation';
import {
    resolveActivityAnalyticsDisplayRules,
} from '../../utils/activityAnalyticsDisplayRules';
import { resolveActivityAnalyticsTimezone } from '../../utils/activityAnalyticsGrouping';
import {
    resolveActivityAnalyticsVisualLayout,
    type ActivityAnalyticsVisualLayout,
    type ActivityAnalyticsGroupsLayout,
    type ActivityAnalyticsSummaryLayout,
} from '../../utils/activityAnalyticsVisualLayout';
import {
    DEFAULT_ACTIVITY_ANALYTICS_DONUT_CENTER_VALUE_FONT_SIZE,
    clampActivityAnalyticsGroupBarWidth,
    resolveActivityAnalyticsDonutCenterValueFontSize,
    resolveActivityAnalyticsGroupBarWidthForGroup,
    resolveActivityAnalyticsDisplayOptions,
    type ResolvedActivityAnalyticsVisualEffects,
} from '../../utils/activityAnalyticsWidgetDefaults';
import { DEFAULT_ACTIVITY_ANALYTICS_TITLE } from '../../utils/activityAnalyticsTitle';
import { buildActivityAnalyticsSummarySegments, type ActivityAnalyticsSummarySegmentBar } from '../../utils/activityAnalyticsSummarySegments';
import {
    buildAreaPath,
    computeVisibleLabelIndices,
    getChartLetterSpacingPx,
    getChartTextFont,
    measureSmoothPathLength,
    resolveAnimationDurationSecondsFromPathLength,
    smoothPath,
} from '../../utils/chartHelpers';

interface ActivityAnalyticsWidgetProps {
    widget: ActivityAnalyticsWidgetConfig;
    machines?: ContractMachine[];
    connection?: ConnectionHealth;
    isLoadingOverview?: boolean;
    hasOverviewError?: boolean;
    isLoadingData?: boolean;
    className?: string;
    siblingWidgets?: WidgetConfig[];
    onPersistDisplayOptions?: (displayOptions: ActivityAnalyticsPersistedDisplayPatch) => void;
}

type ResolvedActivityAnalyticsDisplayOptions = ReturnType<typeof resolveActivityAnalyticsDisplayOptions>;
type RuntimeActivityAnalyticsGroupBy = ResolvedActivityAnalyticsDisplayOptions['groupBy'] | null;
interface ActivityAnalyticsRuntimeViewState {
    sourceDisplayKey: string;
    sourceGroupBy: ResolvedActivityAnalyticsDisplayOptions['groupBy'];
    selectionOverride: ResolvedActivityAnalyticsDisplayOptions | null;
    runtimeGroupBy: RuntimeActivityAnalyticsGroupBy;
    turnoMode: 'summary' | 'detail';
}

interface ActivityAnalyticsGroupsTitleInput {
    range: ResolvedActivityAnalyticsDisplayOptions['range'];
    groupBy: ResolvedActivityAnalyticsDisplayOptions['groupBy'];
}

interface ActivityAnalyticsGroupsChartLayout {
    chartHeight: number;
    chromeHeight: number;
    compactTurnoLayout: boolean;
    chartMargin: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
    productivityLabelClearanceTop: number;
}

interface ActivityAnalyticsRenderSnapshot {
    snapshotKey: string;
    analytics: ReturnType<typeof computeActivityAnalytics>['analytics'];
    comparison: ReturnType<typeof computeActivityAnalytics>['comparison'];
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    visualPalette: ActivityAnalyticsVisualPalette;
    donutCenterValueFontSize?: number;
    prodTrendBands: ResolvedActivityAnalyticsDisplayOptions['prodTrendBands'];
    visualEffects: ResolvedActivityAnalyticsVisualEffects;
    barWidthFactor: number;
    title: string;
    showTurnoModeControl: boolean;
    turnoMode: 'summary' | 'detail';
    emptyMessage: string | null;
}

const RANGE_OPTIONS: Array<{ value: ResolvedActivityAnalyticsDisplayOptions['range']; label: string }> = [
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
    { value: '12m', label: '12m' },
];

const GROUP_BY_OPTIONS: Array<{ value: ResolvedActivityAnalyticsDisplayOptions['groupBy']; label: string }> = [
    { value: 'shift', label: 'TURNO' },
    { value: 'day', label: 'DÍA' },
    { value: 'week', label: 'SEMANA' },
    { value: 'month', label: 'MES' },
];
const PREFETCHABLE_ACTIVITY_ANALYTICS_RANGES: Array<Exclude<ResolvedActivityAnalyticsDisplayOptions['range'], 'custom'>> = ['7d', '30d', '12m'];

const GENERAL_TYPOGRAPHY_STYLE: CSSProperties = {
    fontFamily: 'var(--font-system)',
    fontWeight: 'var(--font-weight-system)',
    fontSize: 'var(--font-size-system)',
    letterSpacing: 'var(--tracking-system)',
};

const TECHNICAL_TYPOGRAPHY_STYLE: CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontWeight: 'var(--font-weight-mono)',
    fontSize: 'var(--font-size-mono)',
    letterSpacing: 'var(--tracking-mono)',
};

const CHART_TYPOGRAPHY_STYLE: CSSProperties = {
    fontFamily: 'var(--font-chart)',
    fontWeight: 'var(--font-weight-chart)',
    fontSize: 'var(--font-size-chart)',
    letterSpacing: 'var(--tracking-chart)',
};

const WIDGET_VALUE_TEXT_STYLE: CSSProperties = {
    fontFamily: 'var(--font-widget-value-gauge)',
    fontWeight: 'var(--font-weight-widget-value-gauge)',
    fontSize: 'var(--font-size-widget-value-gauge)',
    letterSpacing: 'var(--tracking-widget-value-gauge)',
};

const PROD_TREND_LATEST_VALUE_TEXT_STYLE: CSSProperties = {
    fontFamily: 'var(--font-widget-value-activity-analytics-prod-trend)',
    fontWeight: 'var(--font-weight-widget-value-activity-analytics-prod-trend)',
    fontSize: 'var(--font-size-widget-value-activity-analytics-prod-trend)',
    letterSpacing: 'var(--tracking-widget-value-activity-analytics-prod-trend)',
};

const WIDGET_SHELL_CLASS = 'glass-panel group flex h-full w-full flex-col overflow-hidden px-5 pt-5 pb-3';
const GROUPED_TOOLTIP_PANEL_CLASS = 'rounded-lg border border-industrial-border bg-[linear-gradient(135deg,rgba(9,13,22,0.57)_0%,rgba(17,24,39,0.52)_100%)] px-3 py-2 shadow-lg backdrop-blur-sm';
const GROUPED_TOOLTIP_LABEL_CLASS = 'mb-1 whitespace-nowrap text-industrial-muted';
const ANALYTICS_PANEL_CLASS = 'rounded-2xl border border-industrial-border';
const ANALYTICS_CARD_CLASS = 'rounded-2xl border border-industrial-border';
const GROUPS_PANEL_CLASS = `${ANALYTICS_PANEL_CLASS} flex min-h-0 flex-1 flex-col px-0 pb-0 pt-2`;
const GROUPS_CHART_AREA_SHELL_CLASS = 'mt-2 flex min-h-0 flex-1 flex-col px-5 pb-5';
const GROUPS_CHART_VIEWPORT_CLASS = 'relative flex-1 min-h-0 -mx-3 -mb-3';
const PROD_TREND_PANEL_CLASS = `${ANALYTICS_PANEL_CLASS} flex shrink-0 flex-col px-0 pb-0 pt-2`;
const PROD_TREND_PANEL_HEIGHT_PX = 168;
const PROD_TREND_CHART_HEIGHT_PX = 118;
const PROD_TREND_CHART_MIN_HEIGHT_PX = 24;
const PROD_TREND_COMPACT_PANEL_BREAKPOINT_PX = 96;
const PROD_TREND_COMPACT_CHROME_HEIGHT_PX = {
    panelTopPadding: 8,
    headingRow: 18,
    chartGapAboveViewport: 4,
    chartShellBottomPadding: 8,
} as const;
const PROD_TREND_COMPACT_CHART_MIN_HEIGHT_PX = 34;
const PROD_TREND_COMPACT_CHROME_BUDGET_PX = PROD_TREND_COMPACT_CHROME_HEIGHT_PX.panelTopPadding
    + PROD_TREND_COMPACT_CHROME_HEIGHT_PX.headingRow
    + PROD_TREND_COMPACT_CHROME_HEIGHT_PX.chartGapAboveViewport
    + PROD_TREND_COMPACT_CHROME_HEIGHT_PX.chartShellBottomPadding;
const PROD_TREND_PANEL_MIN_HEIGHT_PX = PROD_TREND_COMPACT_CHROME_BUDGET_PX + PROD_TREND_COMPACT_CHART_MIN_HEIGHT_PX;
const PROD_TREND_PANEL_CHROME_HEIGHT_PX = PROD_TREND_PANEL_HEIGHT_PX - PROD_TREND_CHART_HEIGHT_PX;
const PROD_TREND_CHART_MARGIN = { top: 8, right: 12, bottom: 24, left: 38 } as const;
const PROD_TREND_COMPACT_CHART_MARGIN = { top: 4, right: 10, bottom: 14, left: 32 } as const;
const PROD_TREND_OVERLAY_TOP_PADDING_PX = 20;
const PROD_TREND_LATEST_VALUE_LABEL_Y_OFFSET_PX = 16;
const PROD_TREND_LATEST_VALUE_LABEL_EDGE_PADDING_PX = 28;
const PROD_TREND_LATEST_VALUE_LABEL_TOP_CLAMP_PADDING_PX = 10;
const PROD_TREND_LATEST_VALUE_LABEL_FLOAT_TRAVEL_PX = 2.75;
const PROD_TREND_LATEST_VALUE_LABEL_FLOAT_SAFETY_MARGIN_PX = 2;
const PROD_TREND_LATEST_VALUE_LABEL_FLOAT_CLEARANCE_PX = PROD_TREND_LATEST_VALUE_LABEL_FLOAT_TRAVEL_PX + PROD_TREND_LATEST_VALUE_LABEL_FLOAT_SAFETY_MARGIN_PX;
const PROD_TREND_TRAVELING_GLOW_SPEED_PX_PER_SECOND = 323;
const PROD_TREND_TRAVELING_GLOW_DURATION_MIN_SECONDS = 0.9;
const PROD_TREND_TRAVELING_GLOW_DURATION_MAX_SECONDS = 3.2;
const PROD_TREND_TRAVELING_GLOW_PAUSE_MIN_MS = 8_000;
const PROD_TREND_TRAVELING_GLOW_PAUSE_MAX_MS = 20_000;
const ACTIVITY_ANALYTICS_STATE_KEYS = ['prod', 'setup', 'stopped'] as const;
const SUMMARY_CHART_MAX_WIDTH_PX = 480;
const COMPARISON_FALLBACK_LABEL = 'sin comparación';
const INCOMPLETE_COVERAGE_LABEL = 'cobertura incompleta';
const SUMMARY_RING_PROD_THICKNESS_MULTIPLIER = 1.75;
const SUMMARY_RING_MIN_THICKNESS = 6;
const SUMMARY_RING_MAX_THICKNESS = 12;
const SUMMARY_DONUT_TOP_CAP_LENGTH_MULTIPLIER = 0.2;
const SUMMARY_DONUT_TRAVELING_TOP_CAP_LENGTH_MULTIPLIER = 0.3;
const SUMMARY_DONUT_TRAVELING_TOP_CAP_THICKNESS_MULTIPLIER = 1.25;
const SUMMARY_DONUT_TOP_CAP_MIN_LENGTH = 1;
const GROUPED_STATIC_TOP_CAP_HEIGHT_PX = 2;
const GROUPED_MOVING_TOP_CAP_HEIGHT_PX = 2;
const GROUPED_CURRENT_BAR_TOP_LABEL_OFFSET_PX = 8;
const SUMMARY_DONUT_GEOMETRY_RULES = {
    chartHeightPx: {
        compactAxisBars: 236,
        standard: 276,
    },
    segmentGap: {
        circumferenceRatio: 0.014,
        maxPx: {
            compress: 6,
            default: 8,
        },
    },
    innerClearancePx: 6,
    minimumOuterRadiusPx: 32,
    detailMarkerLabelGapPx: 8,
    detail: {
        markerSizePx: 10,
        markerOffsetYPx: 3,
        titleBaselineYPx: 12,
    },
    density: {
        compress: {
            marginPx: { top: 12, right: 12, bottom: 12, left: 12 },
            detailGapPx: 12,
            detailPanelWidthRatio: 0.31,
            detailPanelWidthMinPx: 124,
            detailPanelWidthMaxPx: 136,
            centerYRatio: 0.5,
            outerRadiusInsetPx: 4,
            outerRadiusMaxPx: 88,
            detailValueBaselineYPx: 12,
            detailSectionHeightPx: 22,
            detailSectionGapPx: 6,
        },
        default: {
            marginPx: { top: 14, right: 18, bottom: 14, left: 18 },
            detailGapPx: 18,
            detailPanelWidthRatio: 0.33,
            detailPanelWidthMinPx: 124,
            detailPanelWidthMaxPx: 152,
            centerYRatio: 0.5,
            outerRadiusInsetPx: 8,
            outerRadiusMaxPx: 104,
            detailValueBaselineYPx: 12,
            detailSectionHeightPx: 24,
            detailSectionGapPx: 8,
        },
    },
} as const;
const SUMMARY_DONUT_CENTER_VALUE_FONT_SIZE_FALLBACK_PX = DEFAULT_ACTIVITY_ANALYTICS_DONUT_CENTER_VALUE_FONT_SIZE;
const SUMMARY_DONUT_CENTER_LABEL_FONT_SIZE_FALLBACK_PX = 11;
const SUMMARY_DONUT_CENTER_LABEL_GAP_RATIO = 0.45;
const TOP_REGION_SHARED_HEIGHT_RULES = {
    heightRatio: 0.66,
    fixedPx: 224,
} as const;
const TOP_REGION_COLUMN_GAP_PX = 12;
const ANALYTICS_VERTICAL_PANEL_GAP_PX = 12;
const ANALYTICS_FIXED_VERTICAL_GAPS_PX = ANALYTICS_VERTICAL_PANEL_GAP_PX * 2;
const COMPACT_GROUPS_PRIORITY_HEIGHT_PX = 124;
const COMPACT_STACK_PRIORITY_BREAKPOINT_PX = PROD_TREND_PANEL_HEIGHT_PX + COMPACT_GROUPS_PRIORITY_HEIGHT_PX;
const GROUPS_PANEL_STANDARD_CHROME_HEIGHT_PX = {
    panelTopPadding: 8,
    headingRow: 24,
    chartGapAboveViewport: 8,
    chartShellBottomPadding: 20,
    turnoControl: 32,
} as const;
const GROUPS_PANEL_COMPACT_TURNO_CHROME_HEIGHT_PX = {
    panelTopPadding: 8,
    headingPrimaryRow: 24,
    headingLegendRow: 16,
    chartGapAboveViewport: 4,
    chartShellBottomPadding: 8,
} as const;
const GROUPS_PANEL_STANDARD_CHROME_BUDGET_PX = GROUPS_PANEL_STANDARD_CHROME_HEIGHT_PX.panelTopPadding
    + GROUPS_PANEL_STANDARD_CHROME_HEIGHT_PX.headingRow
    + GROUPS_PANEL_STANDARD_CHROME_HEIGHT_PX.chartGapAboveViewport
    + GROUPS_PANEL_STANDARD_CHROME_HEIGHT_PX.chartShellBottomPadding;
const GROUPS_PANEL_COMPACT_TURNO_CHROME_BUDGET_PX = GROUPS_PANEL_COMPACT_TURNO_CHROME_HEIGHT_PX.panelTopPadding
    + GROUPS_PANEL_COMPACT_TURNO_CHROME_HEIGHT_PX.headingPrimaryRow
    + GROUPS_PANEL_COMPACT_TURNO_CHROME_HEIGHT_PX.headingLegendRow
    + GROUPS_PANEL_COMPACT_TURNO_CHROME_HEIGHT_PX.chartGapAboveViewport
    + GROUPS_PANEL_COMPACT_TURNO_CHROME_HEIGHT_PX.chartShellBottomPadding;
const SUMMARY_PANEL_HEIGHT_CHROME_PX = 10;
const COMPARISON_BAR_WIDTH_CLASS = 'w-2';
const COMPARISON_LAYOUT_RULES = {
    gridGapPx: {
        min: 10,
        max: 18,
    },
    externalWidthPx: {
        min: 132,
        max: 208,
    },
    widthPx: {
        compact: 104,
        expanded: 220,
    },
    trackHeightPx: 112,
} as const;
const GROUPED_EDGE_PADDING_MIN_PX = 6;
const GROUPED_EDGE_PADDING_FACTORS = {
    compress: 0.42,
    scroll: 0.48,
    default: 0.54,
} as const;
const GROUPED_BAR_WIDTH_RATIO = {
    fit: 0.68,
    compress: 0.62,
    scroll: 0.56,
} as const;
const GROUPED_BAR_GAP_RULES = {
    fit: { min: 18, max: 30, ratio: 0.26 },
    compress: { min: 10, max: 20, ratio: 0.2 },
    scroll: { min: 8, max: 16, ratio: 0.16 },
} as const;
const GROUPED_CHART_GEOMETRY = {
    compress: {
        maxHeight: 276,
        chartMargin: { top: 8, right: 12, bottom: 24, left: 38 },
        productivityLabelClearanceTop: 22,
    },
    default: {
        maxHeight: 292,
        chartMargin: { top: 8, right: 12, bottom: 24, left: 38 },
        productivityLabelClearanceTop: 22,
    },
} as const;
const GROUPED_CHART_MIN_HEIGHT_PX = {
    fit: 40,
    compress: 36,
    scroll: 36,
} as const;
const GROUPS_MIN_CHART_MODE_HEIGHT_PX = {
    fit: GROUPED_CHART_MIN_HEIGHT_PX.fit + GROUPS_PANEL_STANDARD_CHROME_BUDGET_PX,
    compress: GROUPED_CHART_MIN_HEIGHT_PX.compress + GROUPS_PANEL_STANDARD_CHROME_BUDGET_PX,
    scroll: GROUPED_CHART_MIN_HEIGHT_PX.scroll + GROUPS_PANEL_STANDARD_CHROME_BUDGET_PX,
} as const;
const GROUPS_MIN_VISUAL_HEIGHT_RULES = {
    minPx: 56,
    maxPx: 88,
    heightRatio: 0.16,
} as const;
type SummaryDetailKey = 'prod' | 'setup' | 'stopped' | 'coverage';
type ActivityAnalyticsGradientStateKey = typeof ACTIVITY_ANALYTICS_STATE_KEYS[number];
type ActivityAnalyticsVisualPaletteEntry = Readonly<{
    gradient: readonly [string, string];
    gradientAlpha: readonly [number, number];
    initialSolid: string;
    solid: string;
    highlight: string;
    topCapSolid: string;
    topCapHighlight: string;
    donutTopCapSolid: string;
    donutTopCapHighlight: string;
}>;
type ActivityAnalyticsVisualPalette = Readonly<Record<ActivityAnalyticsGradientStateKey, ActivityAnalyticsVisualPaletteEntry> & {
    noData: Readonly<{
        solid: string;
        highlight: string;
    }>;
}>;
type SummaryDetailRow = Readonly<{
    key: SummaryDetailKey;
    title: 'Producción' | 'Setup' | 'Detenida' | 'Cobertura';
    valueLabel: string;
    markerFill: string;
    showMarker?: boolean;
    titleFill?: string;
}>;
type SummaryDonutGeometry = Readonly<{
    chartHeight: number;
    margin: Readonly<{
        top: number;
        right: number;
        bottom: number;
        left: number;
    }>;
    detailGap: number;
    detailPanelWidth: number;
    donutRegionWidth: number;
    donutRegionHeight: number;
    centerX: number;
    centerY: number;
    ringThickness: number;
    prodRingThickness: number;
    outerRadius: number;
    radius: number;
    detailBlockTop: number;
    detailSectionSpacing: number;
    detailSectionHeight: number;
    detailMarkerSize: number;
    detailMarkerOffsetY: number;
    detailTitleBaselineY: number;
    detailValueBaselineY: number;
    donutBandTopY: number;
    donutBandBottomY: number;
}>;

export default function ActivityAnalyticsWidget({
    widget,
    machines,
    connection,
    isLoadingOverview = false,
    hasOverviewError = false,
    isLoadingData = false,
    className,
    siblingWidgets,
    onPersistDisplayOptions,
}: ActivityAnalyticsWidgetProps) {
    const queryClient = useContext(QueryClientContext);
    const displayOptions = resolveActivityAnalyticsDisplayOptions(widget.displayOptions);
    const [runtimeViewState, setRuntimeViewState] = useState<ActivityAnalyticsRuntimeViewState>(() => createRuntimeViewState(displayOptions));
    const [analyticsBodySize, setAnalyticsBodySize] = useState<{ width: number; height: number } | null>(null);
    const [lastSuccessfulSnapshotState, setLastSuccessfulSnapshotState] = useState<{
        ownerKey: string;
        snapshot: ActivityAnalyticsRenderSnapshot;
    } | null>(null);
    const [widgetVisibilityState, setWidgetVisibilityState] = useState<{
        ownerKey: string;
        value: boolean | null;
    } | null>(null);
    const analyticsBodyRef = useRef<HTMLDivElement | null>(null);
    const widgetRootRef = useRef<HTMLDivElement | null>(null);
    const transitionStopRef = useRef<((reason?: string) => number) | null>(null);
    const lastRefreshFailureKeyRef = useRef<string | null>(null);
    const lastPrefetchDecisionKeyRef = useRef<string | null>(null);
    const displayKey = createDisplayOptionsSyncKey(displayOptions);

    if (runtimeViewState.sourceDisplayKey !== displayKey || runtimeViewState.sourceGroupBy !== displayOptions.groupBy) {
        setRuntimeViewState((current) => ({
            sourceDisplayKey: displayKey,
            sourceGroupBy: displayOptions.groupBy,
            selectionOverride: current.sourceDisplayKey === displayKey ? current.selectionOverride : null,
            runtimeGroupBy: current.sourceDisplayKey === displayKey && current.sourceGroupBy === displayOptions.groupBy
                ? current.runtimeGroupBy
                : null,
            turnoMode: current.sourceDisplayKey === displayKey && current.sourceGroupBy === displayOptions.groupBy ? current.turnoMode : 'summary',
        }));
    }

    const { selectionOverride, runtimeGroupBy } = runtimeViewState;
    const selectedDisplayOptions = selectionOverride ?? displayOptions;
    const activeDisplayRules = resolveActivityAnalyticsDisplayRules({
        range: selectedDisplayOptions.range,
        start: selectedDisplayOptions.start,
        end: selectedDisplayOptions.end,
        groupBy: runtimeGroupBy ?? selectedDisplayOptions.groupBy,
    });
    const activeDisplayOptions = {
        ...selectedDisplayOptions,
        range: activeDisplayRules.range,
        groupBy: activeDisplayRules.groupBy,
    };
    const visualPalette = createActivityAnalyticsVisualPalette(
        selectedDisplayOptions.stateGradients as Record<ActivityAnalyticsGradientStateKey, readonly [string, string]>,
        selectedDisplayOptions.stateGradientAlphas as Record<ActivityAnalyticsGradientStateKey, readonly [number, number]>,
        selectedDisplayOptions.coverageColor,
    );
    const activeGroupBy = activeDisplayRules.groupBy;
    const activeGroupBarWidth = resolveActivityAnalyticsGroupBarWidthForGroup(
        activeGroupBy,
        selectedDisplayOptions.groupBarWidths,
        selectedDisplayOptions.groupBarWidth,
    );
    const showTurnoModeControl = activeGroupBy === 'shift' && activeDisplayRules.range === '7d';
    const activeTurnoMode = activeDisplayRules.turnoDetailEligible ? runtimeViewState.turnoMode : 'summary';
    const groupsTitle = resolveActivityAnalyticsGroupsTitle({
        range: activeDisplayRules.range,
        groupBy: activeGroupBy,
    });

    if (runtimeGroupBy !== null && runtimeGroupBy !== activeGroupBy) {
        setRuntimeViewState((current) => ({
            ...current,
            runtimeGroupBy: activeGroupBy,
            turnoMode: activeDisplayRules.turnoDetailEligible ? current.turnoMode : 'summary',
        }));
    }
    const machineBinding = resolveActivityAnalyticsMachineBinding(widget.binding?.machineId, machines);
    const runtimeScopeKey = `${widget.id}|${machineBinding.machineId ?? 'none'}`;
    const lastSuccessfulSnapshot = lastSuccessfulSnapshotState?.ownerKey === runtimeScopeKey
        ? lastSuccessfulSnapshotState.snapshot
        : null;
    const isWidgetVisible = widgetVisibilityState?.ownerKey === runtimeScopeKey
        ? widgetVisibilityState.value
        : null;
    const isOverviewUnavailable = isActivityOverviewUnavailable({
        connection,
        hasOverviewError,
    });
    const { config, shifts } = useTemporalSettings();

    const activitySeries = useActivitySeries(machineBinding.machineId != null ? {
        machineId: machineBinding.machineId,
        ...(activeDisplayOptions.range === 'custom'
            ? {
                range: 'custom' as const,
                start: activeDisplayOptions.start ?? '',
                end: activeDisplayOptions.end ?? '',
            }
            : {
                range: activeDisplayOptions.range,
            }),
    } : null);
    const activityData = activitySeries.data;
    const resolvedTimezone = useMemo(() => resolveActivityAnalyticsTimezone({
        temporalSettings: { plantTimezone: config.plantTimezone },
        windowTimezone: activityData?.window.timezone,
    }), [config.plantTimezone, activityData?.window.timezone]);
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
            range: activeDisplayOptions.range,
            groupBy: activeGroupBy,
            shifts,
            timezone: resolvedTimezone,
            window: activityData.window,
        });
    }, [
        activityData,
        activeDisplayOptions.prodThresholdKw,
        activeDisplayOptions.range,
        activeDisplayOptions.setupThresholdKw,
        activeGroupBy,
        resolvedTimezone,
        shifts,
    ]);
    const displayGrouped = useMemo(() => {
        if (!computedAnalytics) {
            return [];
        }

        const resolvedGrouped = (() => {
            if (activeGroupBy !== 'shift') {
                return computedAnalytics.grouped;
            }

            if (activeTurnoMode === 'detail') {
                return computedAnalytics.grouped;
            }

            const turnoSummaryBuckets = buildTurnoSummaryBuckets(computedAnalytics.grouped, shifts);

            return turnoSummaryBuckets.length > 0 ? turnoSummaryBuckets : computedAnalytics.grouped;
        })();

        return activeGroupBy === 'shift'
            ? resolvedGrouped.filter((bucket) => !isTurnoVisualHiddenBucket(bucket))
            : resolvedGrouped;
    }, [activeGroupBy, activeTurnoMode, computedAnalytics, shifts]);
    const hasHiddenOnlyTurnoGroups = activeGroupBy === 'shift'
        && computedAnalytics !== null
        && computedAnalytics.grouped.length > 0
        && displayGrouped.length === 0;
    const displayComparison = useMemo(() => {
        if (!computedAnalytics) {
            return {
                best: { bucketKey: 'best', label: COMPARISON_FALLBACK_LABEL },
                worst: { bucketKey: 'worst', label: COMPARISON_FALLBACK_LABEL },
            };
        }

        return activeGroupBy === 'shift'
            ? resolveTurnoDisplayComparison(displayGrouped)
            : computedAnalytics.comparison;
    }, [activeGroupBy, computedAnalytics, displayGrouped]);
    const groupedCount = displayGrouped.length;
    const requestedSelectionKey = `${machineBinding.machineId ?? 'none'}|${activeDisplayOptions.range}|${activeGroupBy}|${activeTurnoMode}|${activeDisplayOptions.start ?? ''}|${activeDisplayOptions.end ?? ''}`;
    const validatedProcessingErrorState = (() => {
        if (!activityData || !computedAnalytics) {
            return null;
        }

        try {
            validateComputedAnalytics(computedAnalytics);
            return null;
        } catch (error) {
            return resolveProcessingErrorState(error);
        }
    })();
    const currentRenderSnapshot = activityData && computedAnalytics && validatedProcessingErrorState === null && computedAnalytics.grouped.length > 0
        ? {
            snapshotKey: `${requestedSelectionKey}|${activityData.window.start}|${activityData.window.end}|${activityData.series.length}`,
            analytics: computedAnalytics.analytics,
            comparison: displayComparison,
            grouped: displayGrouped,
            visualPalette,
            donutCenterValueFontSize: displayOptions.donutCenterValueFontSize,
            prodTrendBands: selectedDisplayOptions.prodTrendBands,
            visualEffects: selectedDisplayOptions.visualEffects as ResolvedActivityAnalyticsVisualEffects,
            barWidthFactor: activeGroupBarWidth,
            title: groupsTitle,
            showTurnoModeControl,
            turnoMode: activeTurnoMode,
            emptyMessage: hasHiddenOnlyTurnoGroups
                ? 'Todos los grupos de esta ventana corresponden a sin turno y se ocultan en esta vista.'
                : null,
        } satisfies ActivityAnalyticsRenderSnapshot
        : null;
    const isShowingRefreshingSnapshot = activitySeries.isRefreshing && lastSuccessfulSnapshot !== null;
    const isShowingRefreshFailedSnapshot = activitySeries.isError && lastSuccessfulSnapshot !== null;
    const visibleSnapshot = isShowingRefreshingSnapshot || isShowingRefreshFailedSnapshot
        ? lastSuccessfulSnapshot
        : currentRenderSnapshot;

    useEffect(() => {
        transitionStopRef.current?.('widget_reset');
        transitionStopRef.current = null;
        lastRefreshFailureKeyRef.current = null;
        lastPrefetchDecisionKeyRef.current = null;
    }, [widget.id, machineBinding.machineId]);

    useEffect(() => {
        if (!currentRenderSnapshot || activitySeries.isRefreshing || activitySeries.isError) {
            return;
        }

        // eslint-disable-next-line react-hooks/set-state-in-effect -- continuity snapshot must update after the finalized render snapshot is known.
        setLastSuccessfulSnapshotState((current) => {
            if (current?.ownerKey === runtimeScopeKey && current.snapshot.snapshotKey === currentRenderSnapshot.snapshotKey) {
                return current;
            }

            return {
                ownerKey: runtimeScopeKey,
                snapshot: currentRenderSnapshot,
            };
        });
        lastRefreshFailureKeyRef.current = null;
    }, [activitySeries.isError, activitySeries.isRefreshing, currentRenderSnapshot, runtimeScopeKey]);

    useEffect(() => {
        if (!lastSuccessfulSnapshot) {
            return;
        }

        if (activitySeries.isRefreshing) {
            if (!transitionStopRef.current) {
                transitionStopRef.current = startActivityAnalyticsPerformanceTransition(widget.id);
            }

            return;
        }

        if (transitionStopRef.current && currentRenderSnapshot) {
            transitionStopRef.current();
            transitionStopRef.current = null;
        }
    }, [activitySeries.isRefreshing, currentRenderSnapshot, lastSuccessfulSnapshot, widget.id]);

    useEffect(() => {
        if (!lastSuccessfulSnapshot || !activitySeries.isError) {
            return;
        }

        if (lastRefreshFailureKeyRef.current === requestedSelectionKey) {
            return;
        }

        transitionStopRef.current?.();
        transitionStopRef.current = null;
        lastRefreshFailureKeyRef.current = requestedSelectionKey;
        recordActivityAnalyticsPerformanceDiagnostic({
            widgetId: widget.id,
            event: 'refresh_failed',
            reason: requestedSelectionKey,
        });
    }, [activitySeries.isError, lastSuccessfulSnapshot, requestedSelectionKey, widget.id]);

    useEffect(() => {
        if (!widgetRootRef.current) {
            return;
        }

        if (typeof IntersectionObserver === 'undefined') {
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            const entry = entries[0];
            const nextVisibility = entry?.isIntersecting ?? false;

            setWidgetVisibilityState((current) => {
                if (current?.ownerKey === runtimeScopeKey && current.value === nextVisibility) {
                    return current;
                }

                return {
                    ownerKey: runtimeScopeKey,
                    value: nextVisibility,
                };
            });
        });

        observer.observe(widgetRootRef.current);

        return () => {
            observer.disconnect();
        };
    }, [runtimeScopeKey, widget.id]);

    useEffect(() => {
        const widgetId = widget.id;
        const recordPrefetchDecision = (decisionKey: string, event: 'prefetch_started' | 'prefetch_suppressed' | 'prefetch_failed', reason?: string) => {
            if (lastPrefetchDecisionKeyRef.current === decisionKey) {
                return;
            }

            lastPrefetchDecisionKeyRef.current = decisionKey;
            recordActivityAnalyticsPerformanceDiagnostic({
                widgetId,
                event,
                reason,
            });
        };

        const suppress = (reason: string) => {
            recordPrefetchDecision(`${requestedSelectionKey}:suppressed:${reason}`, 'prefetch_suppressed', reason);
            return undefined;
        };

        if (activeDisplayOptions.range === 'custom') {
            return suppress('custom_range');
        }

        if (typeof IntersectionObserver === 'undefined' || isWidgetVisible === null) {
            return suppress('visibility_unavailable');
        }

        if (isWidgetVisible === false) {
            return suppress('hidden');
        }

        if (document.hidden || document.visibilityState === 'hidden') {
            return suppress('document_hidden');
        }

        const activityAnalyticsWidgetIds = new Set<string>([widget.id]);

        siblingWidgets?.forEach((candidate) => {
            if (candidate.type === 'activity-analytics') {
                activityAnalyticsWidgetIds.add(candidate.id);
            }
        });

        if (activityAnalyticsWidgetIds.size > 2) {
            return suppress('dashboard_pressure');
        }

        if (connection?.globalStatus === 'offline') {
            return suppress('offline');
        }

        if (connection && connection.globalStatus !== 'online') {
            return suppress('unhealthy');
        }

        if (isLoadingData || activitySeries.isLoading || activitySeries.isFetching || activitySeries.isRefreshing || currentRenderSnapshot === null) {
            return suppress('loading');
        }

        if (activitySeries.isError) {
            return suppress('error');
        }

        if (machineBinding.machineId == null) {
            return suppress('invalid_machine');
        }

        if (!queryClient) {
            return suppress('query_client_unavailable');
        }

        const rangesToPrefetch = PREFETCHABLE_ACTIVITY_ANALYTICS_RANGES
            .filter((range) => range !== activeDisplayOptions.range)
            .slice(0, 2)
            .filter((range) => {
                const queryKey = createActivitySeriesQueryKey({
                    machineId: machineBinding.machineId,
                    range,
                });
                const queryState = queryClient.getQueryState(queryKey);

                return !(queryState && (queryState.status === 'success' || queryState.fetchStatus === 'fetching'));
            });

        if (rangesToPrefetch.length === 0) {
            return suppress('already_cached');
        }

        const scheduleIdle = typeof requestIdleCallback === 'function'
            ? requestIdleCallback
            : ((callback: IdleRequestCallback) => window.setTimeout(() => callback({
                didTimeout: false,
                timeRemaining: () => 0,
            } as IdleDeadline), 0));
        const cancelIdle = typeof cancelIdleCallback === 'function'
            ? cancelIdleCallback
            : window.clearTimeout;
        const handle = scheduleIdle(() => {
            void Promise.all(rangesToPrefetch.map(async (range) => {
                try {
                    await queryClient.prefetchQuery(createActivitySeriesQueryOptions({
                        machineId: machineBinding.machineId!,
                        range,
                    }));
                    recordPrefetchDecision(`${requestedSelectionKey}:started:${range}`, 'prefetch_started', range);
                } catch {
                    recordPrefetchDecision(`${requestedSelectionKey}:failed:${range}`, 'prefetch_failed', range);
                }
            }));
        });

        return () => {
            cancelIdle(handle as never);
        };
    }, [
        activeDisplayOptions.range,
        activitySeries.isError,
        activitySeries.isFetching,
        activitySeries.isLoading,
        activitySeries.isRefreshing,
        connection,
        currentRenderSnapshot,
        isLoadingData,
        isWidgetVisible,
        machineBinding.machineId,
        queryClient,
        requestedSelectionKey,
        siblingWidgets,
        widget.id,
    ]);

    useEffect(() => {
        if (typeof ResizeObserver === 'undefined' || !analyticsBodyRef.current) {
            return undefined;
        }

        const analyticsBodyElement = analyticsBodyRef.current;
        const observer = new ResizeObserver((entries) => {
            entries.forEach((entry) => {
                const nextWidth = Math.round(entry.contentRect.width);

                if (nextWidth <= 0) {
                    return;
                }

                if (entry.target === analyticsBodyElement) {
                    const nextHeight = Math.round(entry.contentRect.height);

                    if (nextHeight <= 0) {
                        return;
                    }

                    setAnalyticsBodySize((current) => (current?.width === nextWidth && current?.height === nextHeight)
                        ? current
                        : { width: nextWidth, height: nextHeight });
                }
            });
        });

        observer.observe(analyticsBodyElement);

        return () => {
            observer.disconnect();
        };
    }, [groupedCount]);

    const analyticsBodyWidth = analyticsBodySize?.width ?? 640;
    const analyticsBodyHeight = analyticsBodySize?.height ?? 420;
    const topRegionSharedHeight = resolveTopRegionSharedHeight({
        containerHeight: analyticsBodyHeight,
    });
    const prodTrendPanelHeight = resolveProdTrendPanelHeight({
        containerHeight: analyticsBodyHeight,
        topRegionHeight: topRegionSharedHeight,
    });
    const groupsHeightBudget = resolveGroupsHeightBudget({
        containerHeight: analyticsBodyHeight,
        topRegionHeight: topRegionSharedHeight,
        prodTrendPanelHeight,
    });
    const summaryVisualLayout = resolveActivityAnalyticsVisualLayout({
        width: analyticsBodyWidth,
        height: analyticsBodyHeight,
        groupCount: groupedCount,
        groupBy: activeGroupBy,
        range: activeDisplayOptions.range,
        turnoMode: activeTurnoMode,
    });
    const groupsVisualLayout = resolveGroupsVisualLayout({
        width: analyticsBodyWidth,
        height: groupsHeightBudget,
        groupCount: groupedCount,
        groupBy: activeGroupBy,
        range: activeDisplayOptions.range,
        turnoMode: activeTurnoMode,
    });
    const groupsChartLayout = resolveGroupsChartLayout({
        panelHeight: groupsHeightBudget,
        density: groupsVisualLayout.density,
        showTurnoModeControl,
    });
    const visualLayout: ActivityAnalyticsVisualLayout = {
        ...summaryVisualLayout,
        groups: groupsVisualLayout,
    };

    const header = (
        <WidgetHeader
            title={widget.title?.trim() || DEFAULT_ACTIVITY_ANALYTICS_TITLE}
            icon={BarChart2}
            iconPosition="left"
            iconTestId="activity-analytics-widget-header-icon"
            className="min-w-0 shrink-0"
            trailing={(
                <WidgetHeaderTemporalControls
                    variant="pill"
                    testId="activity-analytics-runtime-controls"
                    indicatorTestId="activity-analytics-runtime-control-indicator"
                    groups={[
                        {
                            testId: 'activity-analytics-runtime-range-selector',
                            options: RANGE_OPTIONS,
                            selectedValue: activeDisplayOptions.range,
                            onSelect: (value) => {
                                const nextRange = value as ResolvedActivityAnalyticsDisplayOptions['range'];
                                const nextDisplayOptions = {
                                    ...widget.displayOptions,
                                    ...activeDisplayOptions,
                                    range: nextRange,
                                    start: undefined,
                                    end: undefined,
                                } satisfies ResolvedActivityAnalyticsDisplayOptions;

                                setRuntimeViewState((current) => ({
                                    ...current,
                                    selectionOverride: nextDisplayOptions,
                                    turnoMode: 'summary',
                                }));
                                onPersistDisplayOptions?.({
                                    range: nextRange,
                                    start: undefined,
                                    end: undefined,
                                });
                            },
                        },
                        {
                            testId: 'activity-analytics-runtime-group-selector',
                            options: GROUP_BY_OPTIONS.map((option) => ({
                                ...option,
                                disabled: !activeDisplayRules.allowedGroups.includes(option.value),
                            })),
                            selectedValue: activeGroupBy,
                            onSelect: (value) => {
                                const nextGroupBy = value as RuntimeActivityAnalyticsGroupBy;

                                setRuntimeViewState((current) => ({
                                    ...current,
                                    runtimeGroupBy: nextGroupBy,
                                    turnoMode: nextGroupBy === 'shift' ? current.turnoMode : 'summary',
                                }));
                            },
                        },
                    ]}
                />
            )}
        />
    );

    if (machineBinding.status === 'missing') {
        return renderRuntimeState({
            className,
            header,
            label: 'Seleccione una máquina',
            state: 'invalid-config',
        });
    }

    if (machineBinding.status === 'invalid') {
        if (isLoadingOverview && machineBinding.reason === 'machine_lookup_pending_or_missing') {
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

    if (!isDataActivitySeriesEnabled()) {
        return renderRuntimeState({
            className,
            header,
            label: 'Endpoint Activity-Series no configurado',
            state: 'invalid-config',
        });
    }

    try {
        validateActivityAnalyticsThresholds({
            setupKw: activeDisplayOptions.setupThresholdKw,
            prodKw: activeDisplayOptions.prodThresholdKw,
        });
    } catch {
        return renderRuntimeState({
            className,
            header,
            label: 'Configuración de umbrales inválida',
            state: 'invalid-config',
        });
    }

    if ((isLoadingData || activitySeries.isLoading) && visibleSnapshot === null) {
        return renderRuntimeState({
            className,
            header,
            state: 'loading',
        });
    }

    if (activitySeries.isError && visibleSnapshot === null) {
        return renderRuntimeState({
            className,
            header,
            ...resolveErrorState(activitySeries.error),
        });
    }

    if ((!activityData || activityData.series.length === 0) && visibleSnapshot === null) {
        return renderRuntimeState({
            className,
            header,
            label: 'Sin datos de actividad',
            state: 'empty',
        });
    }

    if (validatedProcessingErrorState !== null && visibleSnapshot === null) {
        return renderRuntimeState({
            className,
            header,
            ...validatedProcessingErrorState,
        });
    }

    if ((computedAnalytics?.grouped.length ?? 0) === 0 && visibleSnapshot === null) {
        return renderRuntimeState({
            className,
            header,
            label: 'Sin grupos para mostrar',
            state: 'empty',
        });
    }

    return (
        <div ref={widgetRootRef} className={`${WIDGET_SHELL_CLASS} ${className ?? ''}`}>
            {header}

            {isShowingRefreshingSnapshot ? (
                <div role="status" className="mt-2 rounded-xl border border-industrial-border bg-industrial-bg/40 px-3 py-2 text-industrial-muted">
                    <span className="uppercase">Actualizando</span>
                    <span className="ml-2">Mostrando la última vista confirmada</span>
                </div>
            ) : null}

            {isShowingRefreshFailedSnapshot ? (
                <div role="alert" className="mt-2 rounded-xl border border-status-critical/30 bg-status-critical/10 px-3 py-2 text-industrial-text">
                    <span className="uppercase">No se pudo actualizar</span>
                    <span className="ml-2">Se mantiene la última vista confirmada</span>
                </div>
            ) : null}

            <div ref={analyticsBodyRef} className="mt-1 flex min-h-0 flex-1 flex-col gap-3">
                <AnalyticsVisualPanels
                    analytics={visibleSnapshot!.analytics}
                    comparison={visibleSnapshot!.comparison}
                    grouped={visibleSnapshot!.grouped}
                    visualPalette={visibleSnapshot!.visualPalette}
                    donutCenterValueFontSize={visibleSnapshot!.donutCenterValueFontSize}
                    prodTrendBands={visibleSnapshot!.prodTrendBands}
                    visualEffects={visibleSnapshot!.visualEffects}
                    visualLayout={visualLayout}
                    groupsChartLayout={groupsChartLayout}
                    chartWidth={analyticsBodyWidth}
                    chartHeight={analyticsBodyHeight}
                    topRegionSharedHeight={topRegionSharedHeight}
                    prodTrendPanelHeight={prodTrendPanelHeight}
                    groupsHeightBudget={groupsHeightBudget}
                    barWidthFactor={visibleSnapshot!.barWidthFactor}
                    title={visibleSnapshot!.title}
                    showTurnoModeControl={visibleSnapshot!.showTurnoModeControl}
                    turnoMode={visibleSnapshot!.turnoMode}
                    onTurnoModeChange={(nextTurnoMode) => setRuntimeViewState((current) => ({ ...current, turnoMode: nextTurnoMode }))}
                    emptyMessage={visibleSnapshot!.emptyMessage}
                />
            </div>
        </div>
    );
}

function getRuntimeControlButtonClass(isActive: boolean, isDisabled = false, compact = false) {
    const baseClassName = 'rounded-md uppercase transition-colors';
    const compactSpacingClassName = 'px-2 py-0.5';
    const defaultSpacingClassName = 'px-2.5 py-1';
    const spacingClassName = compact ? compactSpacingClassName : defaultSpacingClassName;

    if (isDisabled) {
        return `${baseClassName} border border-industrial-border bg-industrial-bg/40 ${spacingClassName} text-industrial-muted/50 disabled:cursor-not-allowed`;
    }

    return isActive
        ? `${baseClassName} border border-admin-accent/30 bg-admin-accent/10 ${spacingClassName} text-admin-accent`
        : `${baseClassName} ${spacingClassName} text-industrial-muted hover:text-industrial-text`;
}

function resolveActivityAnalyticsGroupsTitle({
    range,
    groupBy,
}: ActivityAnalyticsGroupsTitleInput): string {
    const timeWindowLabel = (() => {
        switch (range) {
        case '7d':
            return 'ÚLTIMOS 7 DÍAS';
        case '30d':
            return 'ÚLTIMOS 30 DÍAS';
        case '12m':
            return 'ÚLTIMOS 12 MESES';
        case 'custom':
            return 'PERÍODO SELECCIONADO';
        default:
            return 'VENTANA SELECCIONADA';
        }
    })();

    const granularityLabel = (() => {
        switch (groupBy) {
        case 'day':
            return 'RENDIMIENTO DIARIO';
        case 'week':
            return 'RENDIMIENTO SEMANAL';
        case 'month':
            return 'RENDIMIENTO MENSUAL';
        case 'shift':
        default:
            return 'RENDIMIENTO POR TURNO';
        }
    })();

    return `${granularityLabel} (${timeWindowLabel})`;
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

function resolveActivityAnalyticsMachineBinding(rawMachineId: unknown, machines?: ContractMachine[]) {
    if (rawMachineId == null || rawMachineId === '') {
        return {
            status: 'missing' as const,
            machineId: null,
            selectedMachine: undefined,
        };
    }

    const machineId = toPositiveInteger(rawMachineId);

    if (machineId === null && typeof rawMachineId === 'string') {
        const selectedMachine = findMachineByLegacyName(rawMachineId, machines);

        if (selectedMachine) {
            return {
                status: 'valid' as const,
                machineId: selectedMachine.unitId,
                selectedMachine,
            };
        }

        return {
            status: 'invalid' as const,
            machineId: null,
            selectedMachine: undefined,
            reason: 'machine_lookup_pending_or_missing' as const,
        };
    }

    if (machineId === null) {
        return {
            status: 'invalid' as const,
            machineId: null,
            selectedMachine: undefined,
            reason: 'malformed_binding' as const,
        };
    }

    const selectedMachine = machines?.find((machine) => machine.unitId === machineId);

    if (machines && selectedMachine === undefined) {
        return {
            status: 'invalid' as const,
            machineId: null,
            selectedMachine: undefined,
            reason: 'machine_lookup_pending_or_missing' as const,
        };
    }

    return {
        status: 'valid' as const,
        machineId,
        selectedMachine,
    };
}

function findMachineByLegacyName(rawMachineId: string, machines?: ContractMachine[]) {
    const normalizedBinding = rawMachineId.trim().toLocaleLowerCase();

    if (!normalizedBinding || !machines) {
        return undefined;
    }

    return machines.find((machine) => machine.name.trim().toLocaleLowerCase() === normalizedBinding);
}

function toPositiveInteger(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value > 0 ? value : null;
    }

    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    }

    return null;
}

function renderRuntimeState({
    className,
    header,
    label,
    state,
}: {
    className?: string;
    header: React.ReactNode;
    label?: string;
    state: 'loading' | 'disconnected' | 'error' | 'invalid-config' | 'empty';
}) {
    return (
        <div className={`${WIDGET_SHELL_CLASS} ${className ?? ''}`}>
            <WidgetCenteredContentLayout header={header} contentClassName="pt-14">
                <WidgetRuntimeState
                    state={state}
                    labelOverride={label}
                    testId="activity-analytics-widget-runtime-state"
                />
            </WidgetCenteredContentLayout>
        </div>
    );
}

const ComparisonPanel = memo(function ComparisonPanel({
    comparison,
    grouped,
    visualPalette,
    panelHeight,
    comparisonColumnWidth,
}: {
    comparison: ReturnType<typeof computeActivityAnalytics>['comparison'];
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    visualPalette: ActivityAnalyticsVisualPalette;
    panelHeight?: number;
    comparisonColumnWidth: number;
}) {
    const entries = [
        createComparisonEntry('Mejor', comparison.best, grouped),
        createComparisonEntry('Peor', comparison.worst, grouped),
    ];
    const columnGapPx = resolveComparisonGridColumnGap(comparisonColumnWidth);

    return (
        <div
            className={`${ANALYTICS_PANEL_CLASS} flex min-h-0 flex-col items-center justify-center p-0`}
            style={typeof panelHeight === 'number' ? { height: `${panelHeight}px` } : undefined}
            data-testid="activity-analytics-comparison"
        >
            <div
                className="grid h-full w-fit max-w-full flex-1 grid-cols-2 items-stretch justify-items-center content-center box-border"
                style={{
                    alignSelf: 'center',
                    columnGap: `${columnGapPx}px`,
                }}
                data-testid="activity-analytics-comparison-grid"
            >
                {entries.map((entry) => (
                    <ComparisonRow key={entry.heading} entry={entry} visualPalette={visualPalette} />
                ))}
            </div>
        </div>
    );
});

const AnalyticsVisualPanels = memo(function AnalyticsVisualPanels({
    analytics,
    comparison,
    grouped,
    visualPalette,
    donutCenterValueFontSize,
    prodTrendBands,
    visualEffects,
    visualLayout,
    groupsChartLayout,
    chartWidth,
    chartHeight,
    topRegionSharedHeight,
    prodTrendPanelHeight,
    groupsHeightBudget,
    barWidthFactor,
    title,
    showTurnoModeControl,
    turnoMode,
    onTurnoModeChange,
    emptyMessage,
}: {
    analytics: ReturnType<typeof computeActivityAnalytics>['analytics'];
    comparison: ReturnType<typeof computeActivityAnalytics>['comparison'];
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    visualPalette: ActivityAnalyticsVisualPalette;
    donutCenterValueFontSize?: number;
    prodTrendBands: ResolvedActivityAnalyticsDisplayOptions['prodTrendBands'];
    visualEffects: ResolvedActivityAnalyticsVisualEffects;
    visualLayout: ActivityAnalyticsVisualLayout;
    groupsChartLayout: ActivityAnalyticsGroupsChartLayout;
    chartWidth: number;
    chartHeight: number;
    topRegionSharedHeight: number;
    prodTrendPanelHeight: number;
    groupsHeightBudget: number;
    barWidthFactor: number;
    title: string;
    showTurnoModeControl: boolean;
    turnoMode: 'summary' | 'detail';
    onTurnoModeChange: (nextTurnoMode: 'summary' | 'detail') => void;
    emptyMessage: string | null;
}) {
    const groupsScrollRegionRef = useRef<HTMLDivElement | null>(null);
    const trendScrollViewportRef = useRef<HTMLDivElement | null>(null);
    const syncingScrollRef = useRef(false);
    const topRegionColumnGapPx = TOP_REGION_COLUMN_GAP_PX;
    const topRegionContentWidth = Math.max(chartWidth - topRegionColumnGapPx, 0);
    const comparisonColumnWidth = resolveTopRegionComparisonColumnWidth(topRegionContentWidth);
    const resolvedSummaryColumnWidth = Math.max(topRegionContentWidth - comparisonColumnWidth, 0);
    const comparisonGapDriverWidth = comparisonColumnWidth;
    const summaryChartWidth = Math.min(
        resolvedSummaryColumnWidth,
        SUMMARY_CHART_MAX_WIDTH_PX,
    );
    const topRegionJoinOffsetPx = resolvedSummaryColumnWidth - (topRegionContentWidth / 2);
    const summaryChartHeight = Math.max(topRegionSharedHeight - SUMMARY_PANEL_HEIGHT_CHROME_PX, 0);

    useEffect(() => {
        if (visualLayout.groups.density !== 'scroll') {
            if (trendScrollViewportRef.current) {
                trendScrollViewportRef.current.scrollLeft = 0;
            }

            return;
        }

        const groupsScrollRegion = groupsScrollRegionRef.current;
        const trendScrollViewport = trendScrollViewportRef.current;

        if (!groupsScrollRegion || !trendScrollViewport) {
            return;
        }

        syncingScrollRef.current = true;
        trendScrollViewport.scrollLeft = groupsScrollRegion.scrollLeft;
        syncingScrollRef.current = false;
    }, [barWidthFactor, chartWidth, grouped, visualLayout.groups.density]);

    const handleGroupsScroll = () => {
        const groupsScrollRegion = groupsScrollRegionRef.current;
        const trendScrollViewport = trendScrollViewportRef.current;

        if (!groupsScrollRegion || !trendScrollViewport || syncingScrollRef.current) {
            return;
        }

        syncingScrollRef.current = true;
        trendScrollViewport.scrollLeft = groupsScrollRegion.scrollLeft;
        syncingScrollRef.current = false;
    };

    return (
        <div
            className="flex min-h-0 flex-1 flex-col gap-3"
            data-testid="activity-analytics-visual-panels"
            data-chart-height-px={chartHeight.toFixed(2)}
            data-top-region-height-px={topRegionSharedHeight.toFixed(2)}
            data-prod-trend-height-px={prodTrendPanelHeight.toFixed(2)}
            data-groups-height-budget-px={groupsHeightBudget.toFixed(2)}
            data-fixed-vertical-gaps-px={ANALYTICS_FIXED_VERTICAL_GAPS_PX.toFixed(2)}
        >
            <div
                className="flex min-h-0 items-stretch gap-3 overflow-visible"
                data-testid="activity-analytics-top-region"
                data-top-layout="side-by-side"
                data-top-overlap-px="0.00"
                data-top-gap-px={topRegionColumnGapPx.toFixed(2)}
                data-top-shared-height-px={topRegionSharedHeight.toFixed(2)}
                data-top-join-offset-px={topRegionJoinOffsetPx.toFixed(2)}
            >
                <div
                    className="relative z-[1] min-w-0 shrink-0"
                    style={{ width: `${resolvedSummaryColumnWidth}px` }}
                    data-testid="activity-analytics-summary-column"
                    data-summary-column-width-px={resolvedSummaryColumnWidth.toFixed(2)}
                >
                    <SummaryPanel analytics={analytics} summaryLayout={visualLayout.summary} chartWidth={summaryChartWidth} chartHeight={summaryChartHeight} panelHeight={topRegionSharedHeight} visualPalette={visualPalette} donutEffects={visualEffects.donut} donutCenterValueFontSize={donutCenterValueFontSize} />
                </div>
                <div
                    className="relative z-[2] min-w-0 shrink-0 self-stretch"
                    style={{ width: `${comparisonColumnWidth}px` }}
                    data-testid="activity-analytics-comparison-column"
                    data-comparison-column-width-px={comparisonColumnWidth.toFixed(2)}
                >
                    <ComparisonPanel
                        comparison={comparison}
                        grouped={grouped}
                        visualPalette={visualPalette}
                        panelHeight={visualLayout.summary.mode === 'text-fallback' ? undefined : topRegionSharedHeight}
                        comparisonColumnWidth={comparisonGapDriverWidth}
                    />
                </div>
            </div>
            <ProdTrendPanel
                grouped={grouped}
                visualPalette={visualPalette}
                prodTrendBands={prodTrendBands}
                chartWidth={chartWidth}
                panelHeight={prodTrendPanelHeight}
                groupsLayout={visualLayout.groups}
                groupsChartMargin={groupsChartLayout.chartMargin}
                barWidthFactor={barWidthFactor}
                scrollViewportRef={trendScrollViewportRef}
            />
            <GroupedAnalyticsPanel
                grouped={grouped}
                visualPalette={visualPalette}
                groupedEffects={visualEffects.groupedBars}
                groupsLayout={visualLayout.groups}
                groupsChartLayout={groupsChartLayout}
                chartWidth={chartWidth}
                barWidthFactor={barWidthFactor}
                title={title}
                showTurnoModeControl={showTurnoModeControl}
                turnoMode={turnoMode}
                onTurnoModeChange={onTurnoModeChange}
                emptyMessage={emptyMessage}
                scrollRegionRef={groupsScrollRegionRef}
                onScroll={handleGroupsScroll}
            />
        </div>
    );
});

const ProdTrendPanel = memo(function ProdTrendPanel({
    grouped,
    visualPalette,
    prodTrendBands,
    chartWidth,
    panelHeight,
    groupsLayout,
    groupsChartMargin,
    barWidthFactor,
    scrollViewportRef,
}: {
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    visualPalette: ActivityAnalyticsVisualPalette;
    prodTrendBands: ResolvedActivityAnalyticsDisplayOptions['prodTrendBands'];
    chartWidth: number;
    panelHeight: number;
    groupsLayout: ActivityAnalyticsGroupsLayout;
    groupsChartMargin: ActivityAnalyticsGroupsChartLayout['chartMargin'];
    barWidthFactor: number;
    scrollViewportRef: RefObject<HTMLDivElement | null>;
}) {
    const trendChartLayout = resolveProdTrendChartLayout(panelHeight);
    const trendContentWidth = resolveGroupedXAxisModel({
        grouped,
        width: chartWidth,
        layout: groupsLayout,
        chartMargin: {
            left: groupsChartMargin.left,
            right: groupsChartMargin.right,
        },
        barWidthFactor,
    }).chartWidth;

    return (
        <div
            className={PROD_TREND_PANEL_CLASS}
            style={{ height: `${panelHeight}px` }}
            data-testid="activity-analytics-prod-trend"
            data-panel-height-px={panelHeight.toFixed(2)}
            data-chart-chrome-height-px={trendChartLayout.chromeHeight.toFixed(2)}
            data-chart-height-px={trendChartLayout.chartHeight.toFixed(2)}
            data-compact-panel-top-padding-px={trendChartLayout.compactChromeBreakdown?.panelTopPadding.toFixed(2)}
            data-compact-heading-row-height-px={trendChartLayout.compactChromeBreakdown?.headingRow.toFixed(2)}
            data-compact-shell-margin-top-px={trendChartLayout.compactChromeBreakdown?.chartGapAboveViewport.toFixed(2)}
            data-compact-shell-padding-bottom-px={trendChartLayout.compactChromeBreakdown?.chartShellBottomPadding.toFixed(2)}
        >
            <div className="px-3">
                <PanelHeading title="TENDENCIA % PROD" />
            </div>
            <div
                className={trendChartLayout.compact
                    ? 'mt-1 flex min-h-0 flex-1 flex-col px-4 pb-2'
                    : 'mt-2 flex min-h-0 flex-1 flex-col px-5 pb-3'}
                data-testid="activity-analytics-prod-trend-shell"
            >
                <div
                    className={trendChartLayout.compact
                        ? 'relative flex-1 min-h-0 overflow-x-hidden overflow-y-hidden -mx-2 -mb-2'
                        : 'relative flex-1 min-h-0 overflow-x-hidden overflow-y-hidden -mx-3 -mb-3'}
                    data-testid="activity-analytics-prod-trend-viewport"
                    data-scroll-mode={groupsLayout.density === 'scroll' ? 'scroll' : 'static'}
                    data-content-width-px={trendContentWidth.toFixed(2)}
                    ref={scrollViewportRef}
                >
                    <div className="relative shrink-0 self-end" style={{ width: `${trendContentWidth}px` }} data-testid="activity-analytics-prod-trend-content">
                        <ProdTrendChart
                            grouped={grouped}
                            width={trendContentWidth}
                            height={trendChartLayout.chartHeight}
                            chartMargin={trendChartLayout.chartMargin}
                            visualPalette={visualPalette}
                            prodTrendBands={prodTrendBands}
                            groupsLayout={groupsLayout}
                            groupsChartMargin={groupsChartMargin}
                            barWidthFactor={barWidthFactor}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
});

function ProdTrendChart({
    grouped,
    width,
    height,
    chartMargin,
    visualPalette,
    prodTrendBands,
    groupsLayout,
    groupsChartMargin,
    barWidthFactor,
}: {
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    width: number;
    height: number;
    chartMargin: { top: number; right: number; bottom: number; left: number };
    visualPalette: ActivityAnalyticsVisualPalette;
    prodTrendBands: ResolvedActivityAnalyticsDisplayOptions['prodTrendBands'];
    groupsLayout: ActivityAnalyticsGroupsLayout;
    groupsChartMargin: ActivityAnalyticsGroupsChartLayout['chartMargin'];
    barWidthFactor: number;
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
    const xAxisModel = resolveGroupedXAxisModel({
        grouped,
        width,
        layout: groupsLayout,
        chartMargin: {
            left: groupsChartMargin.left,
            right: groupsChartMargin.right,
        },
        barWidthFactor,
    });
    const { positions, labels, visibleLabelIndices } = xAxisModel;
    const renderablePoints = grouped.map((bucket, index) => {
        const productivityRatio = resolveGroupedTrendProductivityRatio(bucket);
        const y = productivityRatio === null
            ? null
            : chartMargin.top + plotHeight - (clamp(productivityRatio, 0, 1) * plotHeight);

        return {
            bucketKey: bucket.bucketKey,
            isPartial: isGroupedBucketPartial(bucket),
            x: positions[index] ?? (chartMargin.left + (plotWidth / 2)),
            y,
            markerY: y ?? baselineY,
            valueState: productivityRatio === null ? 'missing' : 'measured',
        };
    });
    const lineSegments = buildProdTrendLineSegments(renderablePoints);
    const yTicks = Array.from({ length: 5 }, (_, index) => ({
        value: 100 - (index * 25),
        y: chartMargin.top + ((index / 4) * plotHeight),
    }));
    const hasRenderableTrend = lineSegments.some((segment) => segment.length >= 2);
    const hasLabels = labels.some((label) => label.length > 0);
    const prodGradientStops = getVisualGradientStops(visualPalette.prod.gradient, visualPalette.prod.gradientAlpha);
    const prodTrendBandStopColors = prodTrendBands.colors.map((color) => color ?? 'var(--color-chart-grid)') as [string, string, string];
    const prodTrendBandStopOpacities = prodTrendBands.alphas.map((alpha) => alpha / 100) as [number, number, number];
    const latestPoint = renderablePoints.at(-1) ?? null;
    const latestValueLabel = latestPoint && latestPoint.y !== null
        ? formatPercent(resolveGroupedTrendProductivityRatio(grouped.at(-1) ?? null) ?? 0)
        : null;
    const latestValueLabelAnchor = latestPoint
        ? latestPoint.x >= width - chartMargin.right - PROD_TREND_LATEST_VALUE_LABEL_EDGE_PADDING_PX
            ? 'end'
            : latestPoint.x <= chartMargin.left + PROD_TREND_LATEST_VALUE_LABEL_EDGE_PADDING_PX
                ? 'start'
                : 'middle'
        : 'middle';
    const latestValueLabelX = latestPoint
        ? clamp(latestPoint.x, chartMargin.left + 4, width - chartMargin.right - 4)
        : 0;
    const latestValueLabelPlacement = latestPoint?.y !== null && latestPoint?.y !== undefined
        ? resolveProdTrendLatestValueLabelPlacement({
            latestPointY: latestPoint.y,
            chartTop: chartMargin.top,
        })
        : 'above';
    const latestValueLabelY = latestPoint?.y !== null && latestPoint?.y !== undefined
        ? latestValueLabelPlacement === 'below'
            ? latestPoint.y + PROD_TREND_LATEST_VALUE_LABEL_Y_OFFSET_PX + PROD_TREND_LATEST_VALUE_LABEL_FLOAT_CLEARANCE_PX
            : Math.max(
                chartMargin.top + PROD_TREND_LATEST_VALUE_LABEL_TOP_CLAMP_PADDING_PX,
                latestPoint.y - PROD_TREND_LATEST_VALUE_LABEL_Y_OFFSET_PX,
            )
        : 0;
    const overlayHeight = height + PROD_TREND_OVERLAY_TOP_PADDING_PX;
    const overlayViewBox = `0 -${PROD_TREND_OVERLAY_TOP_PADDING_PX} ${width} ${overlayHeight}`;
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
    const travelingGlowTarget = resolveProdTrendTravelingGlowTarget(lineSegments);
    const travelingGlowSegment = travelingGlowTarget ? lineSegments[travelingGlowTarget.index] ?? null : null;
    const travelingGlowPathId = travelingGlowTarget ? `${gradientPrefix}-prod-trend-motion-path-${travelingGlowTarget.index}` : null;
    const travelingGlowDurationSeconds = resolveProdTrendTravelingGlowDurationSeconds(travelingGlowSegment);
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
    const travelingGlowFrame = resolveProdTrendTravelingGlowFrame(travelingGlowSegment, travelingGlowProgress);
    const showTravelingGlow = travelingGlowPathId !== null
        && !prefersReducedMotion
        && !isTravelingGlowPaused
        && travelingGlowFrame !== null;
    const activeTravelingGlowFrame = showTravelingGlow ? travelingGlowFrame : null;

    return (
        <>
            <svg
                width={width}
                height={height}
                viewBox={`0 0 ${width} ${height}`}
                data-testid="activity-analytics-prod-trend-chart"
                data-y-domain-min="0"
                data-y-domain-max="100"
                data-renderable-point-y={renderablePoints.map((point) => point.y === null ? 'null' : point.y.toFixed(2)).join(',')}
                data-bucket-keys={grouped.map((bucket) => bucket.bucketKey).join(',')}
                data-x-axis-labels={labels.join('|')}
                data-partial-bucket-keys={grouped.filter((bucket) => isGroupedBucketPartial(bucket)).map((bucket) => bucket.bucketKey).join(',')}
                data-latest-bucket-key={latestPoint?.bucketKey ?? ''}
                data-productivity-ratio={grouped.map((bucket) => {
                    const productivityRatio = resolveGroupedTrendProductivityRatio(bucket);

                    return productivityRatio === null ? 'null' : productivityRatio.toFixed(4);
                }).join(',')}
            >
                <defs>
                <linearGradient id={lineGradientId} gradientUnits="userSpaceOnUse" x1={chartMargin.left} y1="0" x2={chartMargin.left + plotWidth} y2="0">
                    <stop offset="0%" stopColor={prodGradientStops.startColor} stopOpacity={Math.max(prodGradientStops.startOpacity, 0.72)} />
                    <stop offset="100%" stopColor={prodGradientStops.endColor} stopOpacity={Math.max(prodGradientStops.endOpacity, 0.92)} />
                </linearGradient>

                <linearGradient id={areaGradientId} gradientUnits="userSpaceOnUse" x1={chartMargin.left} y1="0" x2={chartMargin.left + plotWidth} y2="0">
                    <stop offset="0%" stopColor={prodGradientStops.startColor} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={prodGradientStops.endColor} stopOpacity={0.46} />
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
                    <stop offset="0%" stopColor={prodGradientStops.endColor} stopOpacity={0.96} />
                    <stop offset="34%" stopColor={prodGradientStops.endColor} stopOpacity={0.52} />
                    <stop offset="72%" stopColor={prodGradientStops.startColor} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={prodGradientStops.startColor} stopOpacity={0} />
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

            <g
                clipPath={`url(#${plotClipPathId})`}
                data-testid="activity-analytics-prod-trend-band-layer"
                style={{ mixBlendMode: prodTrendBands.blendMode }}
            >
                {activeBandIntervals.map((interval) => (
                    <g key={`prod-trend-band-${interval.index}`} data-testid="activity-analytics-prod-trend-band-group">
                        <rect
                            x={interval.x}
                            y={chartMargin.top}
                            width={interval.width}
                            height={plotHeight}
                            fill={`url(#${bandGradientId})`}
                            data-testid="activity-analytics-prod-trend-band"
                            data-interval-index={interval.index}
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
                            data-testid="activity-analytics-prod-trend-band-boundary"
                            data-interval-index={interval.index}
                            data-boundary="left"
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
                            data-testid="activity-analytics-prod-trend-band-boundary"
                            data-interval-index={interval.index}
                            data-boundary="right"
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
                    data-testid="activity-analytics-prod-trend-y-grid-line"
                />
            ))}

            <line
                x1={chartMargin.left}
                x2={chartMargin.left + plotWidth}
                y1={baselineY}
                y2={baselineY}
                stroke="var(--color-industrial-border)"
            />
            <line
                x1={chartMargin.left}
                x2={chartMargin.left}
                y1={chartMargin.top}
                y2={baselineY}
                stroke="var(--color-industrial-border)"
            />

            {lineSegments.map((segment, index) => {
                const linePath = segment.length >= 2 ? smoothPath(segment) : '';
                const areaPath = segment.length >= 2 ? buildAreaPath(linePath, segment, baselineY) : '';

                return (
                    <g key={`prod-trend-segment-${index}`} data-testid="activity-analytics-prod-trend-segment">
                        {areaPath.length > 0 && (
                            <path
                                d={areaPath}
                                fill={`url(#${areaGradientId})`}
                                mask={`url(#${maskId})`}
                                data-testid="activity-analytics-prod-trend-area"
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
                                data-testid="activity-analytics-prod-trend-line"
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
                    data-testid="activity-analytics-prod-trend-traveling-glow"
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
                        data-opacity={activeTravelingGlowFrame.auraOpacity.toFixed(3)}
                        data-testid="activity-analytics-prod-trend-traveling-glow-aura"
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
                        data-opacity={activeTravelingGlowFrame.haloOpacity.toFixed(3)}
                        data-testid="activity-analytics-prod-trend-traveling-glow-halo"
                        data-motion-duration={travelingGlowDuration}
                    />
                    <circle
                        cx={activeTravelingGlowFrame.x}
                        cy={activeTravelingGlowFrame.y}
                        r={activeTravelingGlowFrame.coreRadius}
                        fill={prodGradientStops.endColor}
                        opacity={activeTravelingGlowFrame.coreOpacity}
                        stroke={prodGradientStops.startColor}
                        strokeOpacity={0.42}
                        strokeWidth={0.9}
                        data-duration={travelingGlowDuration}
                        data-opacity={activeTravelingGlowFrame.coreOpacity.toFixed(3)}
                        data-testid="activity-analytics-prod-trend-traveling-glow-core"
                    />
                </g>
            )}

            {hoveredPoint && (
                <g pointerEvents="none" data-testid="activity-analytics-prod-trend-hover-affordance">
                    <line
                        x1={hoveredPoint.x}
                        x2={hoveredPoint.x}
                        y1={chartMargin.top}
                        y2={baselineY}
                        stroke="var(--color-industrial-muted)"
                        strokeWidth={1}
                        strokeDasharray="4 3"
                        opacity={0.7}
                        data-testid="activity-analytics-prod-trend-hover-guide"
                    />
                    {hoveredPoint.y !== null && (
                        <circle
                            cx={hoveredPoint.x}
                            cy={hoveredPoint.y}
                            r={4}
                            fill={prodGradientStops.endColor}
                            stroke="var(--color-industrial-bg)"
                            strokeWidth={2}
                            data-testid="activity-analytics-prod-trend-hover-point"
                            data-bucket-key={hoveredPoint.bucketKey}
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
                    data-testid="activity-analytics-prod-trend-y-axis-tick"
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
                return (
                    <text
                        key={`prod-trend-x-tick-${bucket.bucketKey}`}
                        x={x}
                        y={height - 8}
                        textAnchor="middle"
                        fill="var(--color-industrial-muted)"
                        style={CHART_TYPOGRAPHY_STYLE}
                        data-testid="activity-analytics-prod-trend-x-axis-label"
                    >
                        {label}
                    </text>
                );
            })}

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
                            data-testid="activity-analytics-prod-trend-hit-area"
                            data-bucket-key={bucket.bucketKey}
                            onMouseEnter={() => setHoverInfo({ index, x: centerX })}
                            onMouseLeave={() => setHoverInfo(null)}
                        />
                    );
                })}
            </svg>

            {latestPoint && (
                <svg
                    width={width}
                    height={overlayHeight}
                    viewBox={overlayViewBox}
                    className="pointer-events-none absolute left-0"
                    style={{ top: `-${PROD_TREND_OVERLAY_TOP_PADDING_PX}px`, overflow: 'visible' }}
                    aria-hidden="true"
                    data-testid="activity-analytics-prod-trend-overlay-svg"
                >
                    <g
                        data-testid="activity-analytics-prod-trend-latest-point-overlay"
                    >
                        <g
                            data-testid="activity-analytics-prod-trend-latest-point"
                            data-bucket-key={latestPoint.bucketKey}
                            data-partial={latestPoint.isPartial ? 'true' : 'false'}
                            data-value-state={latestPoint.valueState}
                        >
                            {latestValueLabel && latestPoint.y !== null && (
                                <text
                                    x={latestValueLabelX}
                                    y={latestValueLabelY}
                                    textAnchor={latestValueLabelAnchor}
                                    fill={prodGradientStops.endColor}
                                    className="activity-analytics-prod-trend-latest-value-float"
                                style={{
                                    ...PROD_TREND_LATEST_VALUE_TEXT_STYLE,
                                    transformBox: 'fill-box',
                                    transformOrigin: 'center bottom',
                                }}
                                pointerEvents="none"
                                data-testid="activity-analytics-prod-trend-latest-value-label"
                                data-label-placement={latestValueLabelPlacement}
                            >
                                {latestValueLabel}
                            </text>
                            )}
                            {latestPoint.y !== null ? (
                                <g pointerEvents="none" style={{ mixBlendMode: 'screen' }}>
                                    <circle
                                        data-testid="activity-analytics-prod-trend-final-point-pulse"
                                        cx={latestPoint.x}
                                        cy={latestPoint.y}
                                        r={9}
                                        fill={prodGradientStops.endColor}
                                        fillOpacity={0.45}
                                        className="animate-ping"
                                        style={{ animationDuration: '2s', transformOrigin: `${latestPoint.x}px ${latestPoint.y}px` }}
                                    />
                                    <circle
                                        data-testid="activity-analytics-prod-trend-final-point-aura"
                                        cx={latestPoint.x}
                                        cy={latestPoint.y}
                                        r={13.5}
                                        fill={`url(#${travelingGlowAuraGradientId})`}
                                        fillOpacity={0.3}
                                        filter={`url(#${travelingGlowFilterId})`}
                                        className="activity-analytics-prod-trend-final-point-flicker activity-analytics-prod-trend-final-point-flicker-aura"
                                    />
                                    <circle
                                        data-testid="activity-analytics-prod-trend-final-point-halo"
                                        cx={latestPoint.x}
                                        cy={latestPoint.y}
                                        r={8.75}
                                        fill={`url(#${travelingGlowAuraGradientId})`}
                                        fillOpacity={0.48}
                                        filter={`url(#${travelingGlowFilterId})`}
                                        className="activity-analytics-prod-trend-final-point-flicker activity-analytics-prod-trend-final-point-flicker-halo"
                                    />
                                    <circle
                                        data-testid="activity-analytics-prod-trend-final-point-core"
                                        cx={latestPoint.x}
                                        cy={latestPoint.y}
                                        r={3}
                                        fill={prodGradientStops.endColor}
                                        stroke={prodGradientStops.startColor}
                                        strokeOpacity={0.42}
                                        strokeWidth={0.9}
                                    />
                                </g>
                            ) : (
                                <>
                                    <circle
                                        data-testid="activity-analytics-prod-trend-final-missing-pulse"
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
                                        data-testid="activity-analytics-prod-trend-final-missing-core"
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
                </svg>
            )}

            {!hasRenderableTrend && (
                <WidgetRuntimeState
                    state={hasLabels ? 'empty-comparable' : 'empty'}
                    className="absolute inset-0"
                    testId="activity-analytics-prod-trend-empty"
                />
            )}

            {hoverInfo && hoverInfo.index < grouped.length && (
                <ChartTooltip
                    label={resolveGroupedTooltipLabel(grouped[hoverInfo.index]?.label ?? '')}
                    series={buildProdTrendTooltipSeries(grouped[hoverInfo.index], visualPalette)}
                    x={hoverInfo.x}
                    containerWidth={width}
                    panelClassName={GROUPED_TOOLTIP_PANEL_CLASS}
                    labelClassName={GROUPED_TOOLTIP_LABEL_CLASS}
                />
            )}
        </>
    );
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

function buildProdTrendLineSegments(points: Array<{ x: number; y: number | null }>) {
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

function resolveProdTrendTravelingGlowTarget(segments: Array<Array<{ x: number; y: number }>>) {
    return segments.reduce<{ index: number; length: number } | null>((best, segment, index) => {
        if (segment.length < 2) {
            return best;
        }

        if (!best || segment.length >= best.length) {
            return { index, length: segment.length };
        }

        return best;
    }, null);
}

function resolveProdTrendTravelingGlowDurationSeconds(segment: Array<{ x: number; y: number }> | null) {
    if (!segment || segment.length < 2) {
        return PROD_TREND_TRAVELING_GLOW_DURATION_MIN_SECONDS;
    }

    const pathLength = measureSmoothPathLength(segment);
    return resolveTravelingEffectDurationSeconds(pathLength);
}

function resolveTravelingEffectDurationSeconds(pathLength: number) {
    return resolveAnimationDurationSecondsFromPathLength(
        pathLength,
        PROD_TREND_TRAVELING_GLOW_SPEED_PX_PER_SECOND,
        PROD_TREND_TRAVELING_GLOW_DURATION_MIN_SECONDS,
        PROD_TREND_TRAVELING_GLOW_DURATION_MAX_SECONDS,
    );
}

function resolveTravelingEffectPauseMs(randomValue = Math.random()) {
    return Math.round(
        PROD_TREND_TRAVELING_GLOW_PAUSE_MIN_MS
        + (randomValue * (PROD_TREND_TRAVELING_GLOW_PAUSE_MAX_MS - PROD_TREND_TRAVELING_GLOW_PAUSE_MIN_MS)),
    );
}

function resolveProdTrendTravelingGlowFrame(segment: Array<{ x: number; y: number }> | null, progress: number) {
    if (!segment || segment.length < 2) {
        return null;
    }

    const point = samplePointAlongSmoothSegment(segment, progress);

    return {
        x: point.x,
        y: point.y,
        auraOpacity: interpolateTravelingGlowValue(progress, [0, 0.08, 0.7, 0.9, 1], [0.12, 0.28, 0.34, 0.14, 0]),
        auraFillOpacity: interpolateTravelingGlowValue(progress, [0, 0.14, 0.72, 0.9, 1], [0.18, 0.26, 0.3, 0.12, 0]),
        auraRadius: interpolateTravelingGlowValue(progress, [0, 0.14, 0.72, 0.9, 1], [10.5, 14.25, 13.75, 11.5, 10.5]),
        haloOpacity: interpolateTravelingGlowValue(progress, [0, 0.08, 0.72, 0.9, 1], [0.32, 0.68, 0.7, 0.22, 0]),
        haloFillOpacity: interpolateTravelingGlowValue(progress, [0, 0.14, 0.72, 0.9, 1], [0.24, 0.42, 0.48, 0.18, 0]),
        haloRadius: interpolateTravelingGlowValue(progress, [0, 0.14, 0.72, 0.9, 1], [6.25, 9.35, 8.9, 6.75, 6.25]),
        coreOpacity: interpolateTravelingGlowValue(progress, [0, 0.08, 0.72, 0.9, 1], [0.62, 0.98, 1, 0.28, 0]),
        coreRadius: interpolateTravelingGlowValue(progress, [0, 0.14, 0.72, 0.9, 1], [2.35, 3.25, 3.05, 2.55, 2.35]),
    };
}

function interpolateTravelingGlowValue(progress: number, keyTimes: number[], values: number[]) {
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

function samplePointAlongSmoothSegment(segment: Array<{ x: number; y: number }>, progress: number) {
    const clampedProgress = clamp(progress, 0, 1);
    const startPoint = segment[0];

    if (!startPoint) {
        return { x: 0, y: 0 };
    }

    const sampledPoints = buildTravelingGlowSamplePoints(segment);
    const totalLength = sampledPoints.at(-1)?.distance ?? 0;

    if (totalLength <= 0) {
        return startPoint;
    }

    const targetDistance = totalLength * clampedProgress;

    for (let index = 1; index < sampledPoints.length; index += 1) {
        const previousSample = sampledPoints[index - 1];
        const currentSample = sampledPoints[index];

        if (!previousSample || !currentSample || targetDistance > currentSample.distance) {
            continue;
        }

        const distanceBetweenSamples = currentSample.distance - previousSample.distance;
        const distanceProgress = distanceBetweenSamples <= 0
            ? 1
            : (targetDistance - previousSample.distance) / distanceBetweenSamples;

        return {
            x: previousSample.x + ((currentSample.x - previousSample.x) * clamp(distanceProgress, 0, 1)),
            y: previousSample.y + ((currentSample.y - previousSample.y) * clamp(distanceProgress, 0, 1)),
        };
    }

    const lastSample = sampledPoints.at(-1);

    return lastSample ? { x: lastSample.x, y: lastSample.y } : startPoint;
}

function buildTravelingGlowSamplePoints(segment: Array<{ x: number; y: number }>) {
    const samples = [{ ...segment[0], distance: 0 }];
    let totalDistance = 0;

    for (let segmentIndex = 1; segmentIndex < segment.length; segmentIndex += 1) {
        const start = segment[segmentIndex - 1];
        const end = segment[segmentIndex];

        if (!start || !end) {
            continue;
        }

        const controlX = (start.x + end.x) / 2;
        const control1 = { x: controlX, y: start.y };
        const control2 = { x: controlX, y: end.y };
        let previousPoint = start;

        for (let sampleIndex = 1; sampleIndex <= 24; sampleIndex += 1) {
            const point = sampleTravelingGlowBezierPoint(start, control1, control2, end, sampleIndex / 24);

            totalDistance += Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
            samples.push({ ...point, distance: totalDistance });
            previousPoint = point;
        }
    }

    return samples;
}

function sampleTravelingGlowBezierPoint(
    start: { x: number; y: number },
    control1: { x: number; y: number },
    control2: { x: number; y: number },
    end: { x: number; y: number },
    t: number,
) {
    const oneMinusT = 1 - t;
    const oneMinusTSquared = oneMinusT * oneMinusT;
    const tSquared = t * t;
    const coefficient0 = oneMinusTSquared * oneMinusT;
    const coefficient1 = 3 * oneMinusTSquared * t;
    const coefficient2 = 3 * oneMinusT * tSquared;
    const coefficient3 = tSquared * t;

    return {
        x: (coefficient0 * start.x) + (coefficient1 * control1.x) + (coefficient2 * control2.x) + (coefficient3 * end.x),
        y: (coefficient0 * start.y) + (coefficient1 * control1.y) + (coefficient2 * control2.y) + (coefficient3 * end.y),
    };
}

function usePrefersReducedMotion() {
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return false;
        }

        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    });

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return undefined;
        }

        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        const handleChange = (event: MediaQueryListEvent) => {
            setPrefersReducedMotion(event.matches);
        };

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', handleChange);

            return () => {
                mediaQuery.removeEventListener('change', handleChange);
            };
        }

        mediaQuery.addListener(handleChange);

        return () => {
            mediaQuery.removeListener(handleChange);
        };
    }, []);

    return prefersReducedMotion;
}

function useTravelingEffectCycle({
    enabled,
    durationSeconds,
}: {
    enabled: boolean;
    durationSeconds: number;
}) {
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
        const randomPauseMs = resolveTravelingEffectPauseMs();
        const travelStartTime = performance.now();
        let isAnimatingFrame = false;
        let animationFrameId = 0;

        setProgress(0);
        setIsPaused(false);

        const animateTravelingEffect = (now: number) => {
            if (isAnimatingFrame) {
                setProgress(1);
                setIsPaused(true);
                return;
            }

            isAnimatingFrame = true;

            try {
                const nextProgress = clamp(now - travelStartTime, 0, travelDurationMs) / travelDurationMs;

                setProgress(nextProgress);

                if (nextProgress < 1) {
                    animationFrameId = window.requestAnimationFrame(animateTravelingEffect);
                }
            } finally {
                isAnimatingFrame = false;
            }
        };

        animationFrameId = window.requestAnimationFrame(animateTravelingEffect);

        const hideTimerId = window.setTimeout(() => {
            setProgress(1);
            setIsPaused(true);
        }, travelDurationMs);
        const restartTimerId = window.setTimeout(() => {
            setCycleKey((current) => current + 1);
        }, travelDurationMs + randomPauseMs);

        return () => {
            window.cancelAnimationFrame(animationFrameId);
            window.clearTimeout(hideTimerId);
            window.clearTimeout(restartTimerId);
        };
    }, [cycleKey, durationSeconds, enabled, prefersReducedMotion]);

    return {
        prefersReducedMotion,
        cycleKey,
        progress,
        isPaused,
    };
}

function resolveGroupedXAxisModel({
    grouped,
    width,
    layout,
    chartMargin,
    barWidthFactor,
}: {
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    width: number;
    layout: ActivityAnalyticsGroupsLayout;
    chartMargin: { left: number; right: number };
    barWidthFactor: number;
}) {
    const minimumBucketWidth = layout.minSlotWidthPx;
    const chartWidth = layout.density === 'scroll'
        ? Math.max(width, chartMargin.left + chartMargin.right + (grouped.length * minimumBucketWidth))
        : width;
    const plotWidth = Math.max(chartWidth - chartMargin.left - chartMargin.right, 1);
    const safeBarWidthFactor = clampActivityAnalyticsGroupBarWidth(barWidthFactor);
    const groupedDensity = layout.density === 'fit'
        ? 'fit'
        : layout.density === 'scroll'
            ? 'scroll'
            : 'compress';
    const slotWidth = Math.max(plotWidth / Math.max(grouped.length, 1), 1);
    const targetGap = resolveGroupedBarGap(slotWidth, groupedDensity);
    const baseBarWidth = Math.max(
        Math.min(slotWidth * GROUPED_BAR_WIDTH_RATIO[groupedDensity], slotWidth - targetGap),
        6,
    );
    const barWidth = clamp(
        baseBarWidth * safeBarWidthFactor,
        6,
        Math.max(slotWidth - 4, 6),
    );
    const horizontalPadding = resolveGroupedChartEdgePadding(barWidth, layout.density);
    const usablePlotWidth = Math.max(plotWidth - (2 * horizontalPadding), 1);
    const usableSlotWidth = grouped.length > 0 ? usablePlotWidth / grouped.length : usablePlotWidth;
    const positions = grouped.length > 1
        ? grouped.map((_, index) => chartMargin.left + horizontalPadding + (usableSlotWidth * index) + (usableSlotWidth / 2))
        : grouped.map(() => chartMargin.left + horizontalPadding + (usablePlotWidth / 2));
    const labels = grouped.map((bucket) => resolveGroupedAxisLabel(bucket.label));
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

    return {
        chartWidth,
        plotWidth,
        positions,
        labels,
        visibleLabelIndices,
    };
}

function isGroupedBucketPartial(bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number]) {
    return bucket.isInProgress || bucket.hasInProgressContribution === true;
}

function isGroupedBucketMarkedInProgress(bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number]) {
    return /\(\s*en curso\s*\)/i.test(bucket.label);
}

function resolveTopRegionComparisonColumnWidth(containerWidth: number): number {
    const { min, max } = COMPARISON_LAYOUT_RULES.externalWidthPx;
    const summaryPriorityWidth = Math.min(containerWidth, SUMMARY_CHART_MAX_WIDTH_PX);
    const spareWidthAfterSummaryPriority = Math.max(containerWidth - summaryPriorityWidth, 0);

    if (spareWidthAfterSummaryPriority <= min) {
        return Math.min(containerWidth, min);
    }

    if (spareWidthAfterSummaryPriority >= max) {
        return max;
    }

    const progress = normalizeRange(spareWidthAfterSummaryPriority, min, max);

    return Number((min + ((max - min) * progress)).toFixed(2));
}

function resolveComparisonGridColumnGap(containerWidth: number): number {
    const widthRange = COMPARISON_LAYOUT_RULES.widthPx.expanded - COMPARISON_LAYOUT_RULES.widthPx.compact;

    if (widthRange <= 0) {
        return COMPARISON_LAYOUT_RULES.gridGapPx.min;
    }

    const normalizedWidth = Math.min(
        Math.max(containerWidth, COMPARISON_LAYOUT_RULES.widthPx.compact),
        COMPARISON_LAYOUT_RULES.widthPx.expanded,
    );
    const progress = (normalizedWidth - COMPARISON_LAYOUT_RULES.widthPx.compact) / widthRange;

    return Number((
        COMPARISON_LAYOUT_RULES.gridGapPx.min
        + ((COMPARISON_LAYOUT_RULES.gridGapPx.max - COMPARISON_LAYOUT_RULES.gridGapPx.min) * progress)
    ).toFixed(2));
}

function resolveTopRegionSharedHeight({
    containerHeight,
}: {
    containerHeight: number;
}): number {
    const heightDrivenCap = Math.min(
        containerHeight * TOP_REGION_SHARED_HEIGHT_RULES.heightRatio,
        TOP_REGION_SHARED_HEIGHT_RULES.fixedPx,
    );

    return Math.max(Math.round(heightDrivenCap), 0);
}

function resolveProdTrendPanelHeight({
    containerHeight,
    topRegionHeight,
}: {
    containerHeight: number;
    topRegionHeight: number;
}): number {
    const stackHeightBelowTopRegion = Math.max(containerHeight - topRegionHeight - ANALYTICS_FIXED_VERTICAL_GAPS_PX, 0);
    const reservedGroupsHeight = stackHeightBelowTopRegion <= COMPACT_STACK_PRIORITY_BREAKPOINT_PX
        ? Math.max(resolveGroupsMinimumVisualHeight(containerHeight), COMPACT_GROUPS_PRIORITY_HEIGHT_PX)
        : resolveGroupsMinimumVisualHeight(containerHeight);
    const availableTrendHeight = stackHeightBelowTopRegion - reservedGroupsHeight;

    return Math.round(clamp(availableTrendHeight, PROD_TREND_PANEL_MIN_HEIGHT_PX, PROD_TREND_PANEL_HEIGHT_PX));
}

function resolveGroupsMinimumVisualHeight(containerHeight: number): number {
    return Math.round(clamp(
        containerHeight * GROUPS_MIN_VISUAL_HEIGHT_RULES.heightRatio,
        GROUPS_MIN_VISUAL_HEIGHT_RULES.minPx,
        GROUPS_MIN_VISUAL_HEIGHT_RULES.maxPx,
    ));
}

function resolveGroupsHeightBudget({
    containerHeight,
    topRegionHeight,
    prodTrendPanelHeight,
}: {
    containerHeight: number;
    topRegionHeight: number;
    prodTrendPanelHeight: number;
}): number {
    const availableGroupsHeight = Math.max(
        containerHeight - topRegionHeight - prodTrendPanelHeight - ANALYTICS_FIXED_VERTICAL_GAPS_PX,
        0,
    );

    return Math.round(clamp(
        availableGroupsHeight,
        0,
        availableGroupsHeight,
    ));
}

function resolveGroupsVisualLayout({
    width,
    height,
    groupCount,
    groupBy,
    range,
    turnoMode,
}: {
    width: number;
    height: number;
    groupCount: number;
    groupBy: ResolvedActivityAnalyticsDisplayOptions['groupBy'];
    range: ResolvedActivityAnalyticsDisplayOptions['range'];
    turnoMode: 'summary' | 'detail';
}): ActivityAnalyticsGroupsLayout {
    const turnoDetailEligible = groupBy === 'shift' && (range === '24h' || range === '7d');
    const showTurnoModeControl = groupBy === 'shift' && range === '7d';
    const minSlotWidthPx = turnoDetailEligible && turnoMode === 'detail' ? 28 : 42;

    if (width < 320) {
        return {
            mode: 'text-fallback',
            density: 'text-fallback',
            minSlotWidthPx,
            sampleLabels: true,
        };
    }

    const effectiveGroupCount = turnoDetailEligible && turnoMode === 'summary'
        ? Math.min(Math.max(groupCount, 1), 3)
        : groupCount;
    const safeGroupCount = Math.max(effectiveGroupCount, 1);
    const groupsPlotWidth = Math.max(width - 76, 1);
    const slotWidth = groupsPlotWidth / safeGroupCount;
    const density = slotWidth >= 76
        ? 'fit'
        : slotWidth >= minSlotWidthPx
            ? 'compress'
            : 'scroll';
    const minimumChartModeHeight = resolveGroupsChartModeMinimumHeight({
        panelHeight: height,
        density,
        showTurnoModeControl,
    });

    if (height < minimumChartModeHeight) {
        return {
            mode: 'text-fallback',
            density: 'text-fallback',
            minSlotWidthPx,
            sampleLabels: true,
        };
    }

    return {
        mode: 'axis-stacked',
        density,
        minSlotWidthPx,
        sampleLabels: density !== 'fit',
    };
}

function resolveGroupsChartModeMinimumHeight({
    panelHeight,
    density,
    showTurnoModeControl,
}: {
    panelHeight: number;
    density: 'fit' | 'compress' | 'scroll';
    showTurnoModeControl: boolean;
}): number {
    const chartMinimumHeight = GROUPED_CHART_MIN_HEIGHT_PX[density];

    if (showTurnoModeControl && panelHeight < GROUPS_MIN_CHART_MODE_HEIGHT_PX[density] + GROUPS_PANEL_STANDARD_CHROME_HEIGHT_PX.turnoControl) {
        return chartMinimumHeight + GROUPS_PANEL_COMPACT_TURNO_CHROME_BUDGET_PX;
    }

    return GROUPS_MIN_CHART_MODE_HEIGHT_PX[density] + (showTurnoModeControl ? GROUPS_PANEL_STANDARD_CHROME_HEIGHT_PX.turnoControl : 0);
}

function resolveGroupsChartLayout({
    panelHeight,
    density,
    showTurnoModeControl,
}: {
    panelHeight: number;
    density: ActivityAnalyticsGroupsLayout['density'];
    showTurnoModeControl: boolean;
}): ActivityAnalyticsGroupsChartLayout {
    const resolvedDensity = density === 'text-fallback' ? 'fit' : density;
    const geometry = resolvedDensity === 'compress'
        ? GROUPED_CHART_GEOMETRY.compress
        : GROUPED_CHART_GEOMETRY.default;
    const compactTurnoLayout = showTurnoModeControl
        && panelHeight < (GROUPS_MIN_CHART_MODE_HEIGHT_PX[resolvedDensity] + GROUPS_PANEL_STANDARD_CHROME_HEIGHT_PX.turnoControl);
    const chromeHeight = compactTurnoLayout
        ? GROUPS_PANEL_COMPACT_TURNO_CHROME_BUDGET_PX
        : GROUPS_PANEL_STANDARD_CHROME_BUDGET_PX + (showTurnoModeControl ? GROUPS_PANEL_STANDARD_CHROME_HEIGHT_PX.turnoControl : 0);
    const availableChartHeight = Math.max(panelHeight - chromeHeight, 0);
    const chartHeight = Math.round(clamp(
        availableChartHeight,
        GROUPED_CHART_MIN_HEIGHT_PX[resolvedDensity],
        geometry.maxHeight,
    ));

    return {
        chartHeight,
        chromeHeight,
        compactTurnoLayout,
        chartMargin: {
            top: Math.round(clamp(chartHeight * 0.08, 4, compactTurnoLayout ? 6 : geometry.chartMargin.top)),
            right: geometry.chartMargin.right,
            bottom: Math.round(clamp(chartHeight * 0.18, compactTurnoLayout ? 12 : 14, compactTurnoLayout ? 20 : geometry.chartMargin.bottom)),
            left: geometry.chartMargin.left,
        },
        productivityLabelClearanceTop: Math.round(clamp(chartHeight * 0.2, compactTurnoLayout ? 8 : 10, geometry.productivityLabelClearanceTop)),
    };
}

function resolveProdTrendChartLayout(panelHeight: number) {
    const compact = panelHeight <= PROD_TREND_COMPACT_PANEL_BREAKPOINT_PX;
    const chartMargin = compact ? PROD_TREND_COMPACT_CHART_MARGIN : PROD_TREND_CHART_MARGIN;
    const compactChromeBreakdown = compact ? PROD_TREND_COMPACT_CHROME_HEIGHT_PX : null;
    const chromeHeight = compact ? PROD_TREND_COMPACT_CHROME_BUDGET_PX : PROD_TREND_PANEL_CHROME_HEIGHT_PX;
    const minChartHeight = compact ? PROD_TREND_COMPACT_CHART_MIN_HEIGHT_PX : PROD_TREND_CHART_MIN_HEIGHT_PX;

    return {
        compact,
        compactChromeBreakdown,
        chromeHeight,
        chartMargin,
        chartHeight: Math.round(clamp(
            panelHeight - chromeHeight,
            minChartHeight,
            PROD_TREND_CHART_HEIGHT_PX,
        )),
    };
}

function resolveSummarySegmentGapLength({
    circumference,
    density,
    segmentCount,
}: {
    circumference: number;
    density: ActivityAnalyticsSummaryLayout['density'];
    segmentCount: number;
}): number {
    if (segmentCount <= 1) {
        return 0;
    }

    const maxGapPx = density === 'compress'
        ? SUMMARY_DONUT_GEOMETRY_RULES.segmentGap.maxPx.compress
        : SUMMARY_DONUT_GEOMETRY_RULES.segmentGap.maxPx.default;

    return Math.min(circumference * SUMMARY_DONUT_GEOMETRY_RULES.segmentGap.circumferenceRatio, maxGapPx);
}

const SummaryPanel = memo(function SummaryPanel({
    analytics,
    summaryLayout,
    chartWidth,
    chartHeight,
    panelHeight,
    visualPalette,
    donutEffects,
    donutCenterValueFontSize,
}: {
    analytics: ReturnType<typeof computeActivityAnalytics>['analytics'];
    summaryLayout: ActivityAnalyticsSummaryLayout;
    chartWidth: number;
    chartHeight: number;
    panelHeight: number;
    visualPalette: ActivityAnalyticsVisualPalette;
    donutEffects: ResolvedActivityAnalyticsVisualEffects['donut'];
    donutCenterValueFontSize?: number;
}) {
    const summaryDisplay = createSummaryDisplayModel(analytics, visualPalette);
    if (summaryLayout.mode === 'text-fallback') {
        return (
            <div className={`${ANALYTICS_PANEL_CLASS} p-1`} data-testid="activity-analytics-summary-text">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {summaryDisplay.detailRows.map((detailRow) => (
                        <SummaryDetailTextCard key={detailRow.key} detailRow={detailRow} />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div
            className={`${ANALYTICS_PANEL_CLASS} relative flex min-h-0 flex-col items-center justify-center p-1`}
            style={{ height: `${panelHeight}px` }}
            data-testid="activity-analytics-summary-bars"
        >
            <div className="pointer-events-none absolute inset-x-0 top-2 px-3">
                <PanelHeading title="DISTRIBUCIÓN" />
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center self-stretch">
                <SummaryBarsChart
                    bars={summaryDisplay.stackedBars}
                    width={chartWidth}
                    height={chartHeight}
                    density={summaryLayout.density}
                    centerValue={summaryDisplay.sectionProductivityLabel}
                    centerLabel="PROD"
                    detailRows={summaryDisplay.detailRows}
                    visualPalette={visualPalette}
                    donutEffects={donutEffects}
                    donutCenterValueFontSize={donutCenterValueFontSize}
                />
            </div>
        </div>
    );
});

type ActivityAnalyticsSummaryData = ReturnType<typeof computeActivityAnalytics>['analytics'];

type SummaryCenterLabelLayout = {
    valueY: number;
    labelY: number;
};

function createSummaryDisplayModel(
    analytics: ActivityAnalyticsSummaryData,
    visualPalette: ActivityAnalyticsVisualPalette,
) {
    const observedDurationMs = analytics.durationsMs.prod + analytics.durationsMs.setup + analytics.durationsMs.stopped;
    const sectionProductivityLabel = observedDurationMs > 0
        ? formatPercent(analytics.utilizationRatio)
        : INCOMPLETE_COVERAGE_LABEL;

    return {
        sectionProductivityLabel,
        stackedBars: [
            { key: 'stopped', label: 'Detenida', durationMs: analytics.durationsMs.stopped, color: visualPalette.stopped.solid },
            { key: 'setup', label: 'Setup', durationMs: analytics.durationsMs.setup, color: visualPalette.setup.solid },
            { key: 'prod', label: 'Prod.', durationMs: analytics.durationsMs.prod, color: visualPalette.prod.solid },
        ] as const,
        detailRows: createSummaryDetailRows(analytics, visualPalette),
    };
}

function createSummaryDetailRows(
    analytics: ActivityAnalyticsSummaryData,
    visualPalette: ActivityAnalyticsVisualPalette,
): readonly SummaryDetailRow[] {
    const totalDurationMs = analytics.durationsMs.prod + analytics.durationsMs.setup + analytics.durationsMs.stopped;

    const buildDetailRow = (
        key: Extract<SummaryDetailKey, 'prod' | 'setup' | 'stopped'>,
        title: Extract<SummaryDetailRow['title'], 'Producción' | 'Setup' | 'Detenida'>,
        durationMs: number,
        markerFill: string,
    ): SummaryDetailRow => {
        const percentLabel = totalDurationMs > 0 ? formatPercent(durationMs / totalDurationMs) : '0%';

        return {
            key,
            title,
            valueLabel: percentLabel,
            markerFill,
        };
    };

    return [
        buildDetailRow('prod', 'Producción', analytics.durationsMs.prod, visualPalette.prod.initialSolid),
        buildDetailRow('setup', 'Setup', analytics.durationsMs.setup, visualPalette.setup.solid),
        buildDetailRow('stopped', 'Detenida', analytics.durationsMs.stopped, visualPalette.stopped.initialSolid),
        {
            key: 'coverage',
            title: 'Cobertura',
            valueLabel: formatPercent(analytics.coverageRatio),
            markerFill: visualPalette.noData.solid,
            showMarker: false,
            titleFill: 'var(--color-industrial-muted)',
        },
    ] as const;
}

const GroupedAnalyticsPanel = memo(function GroupedAnalyticsPanel({
    grouped,
    visualPalette,
    groupedEffects,
    groupsLayout,
    groupsChartLayout,
    chartWidth,
    barWidthFactor,
    title,
    showTurnoModeControl,
    turnoMode,
    onTurnoModeChange,
    emptyMessage,
    scrollRegionRef,
    onScroll,
}: {
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    visualPalette: ActivityAnalyticsVisualPalette;
    groupedEffects: ResolvedActivityAnalyticsVisualEffects['groupedBars'];
    groupsLayout: ActivityAnalyticsGroupsLayout;
    groupsChartLayout: ActivityAnalyticsGroupsChartLayout;
    chartWidth: number;
    barWidthFactor: number;
    title: string;
    showTurnoModeControl: boolean;
    turnoMode: 'summary' | 'detail';
    onTurnoModeChange: (nextTurnoMode: 'summary' | 'detail') => void;
    emptyMessage: string | null;
    scrollRegionRef: RefObject<HTMLDivElement | null>;
    onScroll: () => void;
}) {
    if (grouped.length === 0 && emptyMessage) {
        return (
            <div className={GROUPS_PANEL_CLASS} data-testid="activity-analytics-groups">
                <div data-testid="activity-analytics-groups-panel" data-groups-density={groupsLayout.density} className="contents">
                    <div className="px-3">
                        <PanelHeading title={title} endContent={<GroupStatusLegend visualPalette={visualPalette} />} />
                    </div>
                    {showTurnoModeControl && (
                        <div className="px-3 pt-2">
                            <TurnoModeControl turnoMode={turnoMode} onTurnoModeChange={onTurnoModeChange} />
                        </div>
                    )}
                    <div
                        className="mt-2 flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-industrial-border mx-3 px-4 py-6 text-center text-industrial-muted"
                        style={GENERAL_TYPOGRAPHY_STYLE}
                        data-testid="activity-analytics-groups-empty"
                    >
                        {emptyMessage}
                    </div>
                </div>
            </div>
        );
    }

    if (groupsLayout.mode === 'text-fallback') {
        return (
            <div className={GROUPS_PANEL_CLASS} data-testid="activity-analytics-groups">
                <div data-testid="activity-analytics-groups-panel" data-groups-density={groupsLayout.density} className="contents">
                    <div className="px-3">
                        <PanelHeading title={title} endContent={<GroupStatusLegend visualPalette={visualPalette} />} />
                    </div>
                    {showTurnoModeControl && (
                        <div className="px-3 pt-2">
                            <TurnoModeControl turnoMode={turnoMode} onTurnoModeChange={onTurnoModeChange} />
                        </div>
                    )}
                    <div className="mt-2 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto hmi-scrollbar px-3 pb-3" data-testid="activity-analytics-groups-text">
                        {grouped.map((bucket) => (
                            <TextMetricCard
                                key={bucket.bucketKey}
                                label={bucket.label}
                                durationMs={resolveGroupedVisibleDurationMs(bucket)}
                                productivityLabel={bucket.productivityLabel}
                            />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    const chart = <GroupedStackedBarsChart grouped={grouped} width={chartWidth} layout={groupsLayout} chartLayout={groupsChartLayout} barWidthFactor={barWidthFactor} visualPalette={visualPalette} groupedEffects={groupedEffects} />;

    return (
        <div className={GROUPS_PANEL_CLASS} data-testid="activity-analytics-groups">
            <div
                data-testid="activity-analytics-groups-panel"
                data-groups-density={groupsLayout.density}
                data-chart-height-px={groupsChartLayout.chartHeight.toFixed(2)}
                data-chart-chrome-height-px={groupsChartLayout.chromeHeight.toFixed(2)}
                data-compact-turno-layout={groupsChartLayout.compactTurnoLayout ? 'true' : 'false'}
                className="contents"
            >
                {groupsChartLayout.compactTurnoLayout
                    ? (
                        <div className="px-3">
                            <div className="flex items-start justify-between gap-2 uppercase text-industrial-muted">
                                <span className="min-w-0 flex-1 truncate" style={GENERAL_TYPOGRAPHY_STYLE}>{title}</span>
                                <TurnoModeControl compact turnoMode={turnoMode} onTurnoModeChange={onTurnoModeChange} />
                            </div>
                            <div className="mt-1 flex min-w-0 justify-end overflow-hidden">
                                <GroupStatusLegend compact visualPalette={visualPalette} />
                            </div>
                        </div>
                    )
                    : (
                        <>
                            <div className="px-3">
                                <PanelHeading title={title} endContent={<GroupStatusLegend visualPalette={visualPalette} />} />
                            </div>
                            {showTurnoModeControl && (
                                <div className="px-3 pt-2">
                                    <TurnoModeControl turnoMode={turnoMode} onTurnoModeChange={onTurnoModeChange} />
                                </div>
                            )}
                        </>
                    )}
                <div className={groupsChartLayout.compactTurnoLayout ? 'mt-1 flex min-h-0 flex-1 flex-col px-4 pb-2' : GROUPS_CHART_AREA_SHELL_CLASS} data-testid="activity-analytics-groups-chart-shell">
                    {groupsLayout.density === 'scroll'
                        ? (
                            <div
                                className={`${GROUPS_CHART_VIEWPORT_CLASS} flex items-end overflow-x-auto overflow-y-hidden hmi-scrollbar`}
                                data-testid="activity-analytics-groups-scroll-region"
                                onScroll={onScroll}
                                ref={scrollRegionRef}
                            >
                                {chart}
                            </div>
                        )
                        : (
                            <div className={`${GROUPS_CHART_VIEWPORT_CLASS} flex items-end`} data-testid="activity-analytics-groups-chart-viewport">
                                {chart}
                            </div>
                        )}
                </div>
            </div>
        </div>
    );
});

const TurnoModeControl = memo(function TurnoModeControl({
    compact = false,
    turnoMode,
    onTurnoModeChange,
}: {
    compact?: boolean;
    turnoMode: 'summary' | 'detail';
    onTurnoModeChange: (nextTurnoMode: 'summary' | 'detail') => void;
}) {
    return (
        <div className={compact ? 'flex items-center gap-0.5' : 'flex items-center gap-1'} data-testid="activity-analytics-turno-mode">
            <button
                type="button"
                aria-pressed={turnoMode === 'summary'}
                onClick={() => onTurnoModeChange('summary')}
                className={getRuntimeControlButtonClass(turnoMode === 'summary', false, compact)}
            >
                Resumen
            </button>
            <button
                type="button"
                aria-pressed={turnoMode === 'detail'}
                onClick={() => onTurnoModeChange('detail')}
                className={getRuntimeControlButtonClass(turnoMode === 'detail', false, compact)}
            >
                Detalle
            </button>
        </div>
    );
});

const GroupStatusLegend = memo(function GroupStatusLegend({
    visualPalette,
    compact = false,
}: {
    visualPalette: ActivityAnalyticsVisualPalette;
    compact?: boolean;
}) {
    return (
        <div className={compact ? 'flex items-center gap-2 normal-case' : 'flex items-center gap-3 normal-case'} data-testid="activity-analytics-groups-header-legend">
                {[
                    { key: 'stopped' as const, label: 'Det.', color: visualPalette.stopped.initialSolid },
                    { key: 'setup' as const, label: 'Setup', color: visualPalette.setup.solid },
                    { key: 'prod' as const, label: 'Prod.', color: visualPalette.prod.initialSolid },
                    { key: 'noData' as const, label: 'Cob. incompleta', color: visualPalette.noData.solid },
                ].map((item) => (
                <span key={item.key} className={compact ? 'flex items-center gap-1 whitespace-nowrap text-industrial-text' : 'flex items-center gap-1.5 whitespace-nowrap text-industrial-text'}>
                    <span
                        aria-hidden="true"
                        className={compact ? 'h-2 w-2 rounded-[3px]' : 'h-2.5 w-2.5 rounded-[3px]'}
                        style={{ backgroundColor: item.color }}
                    />
                    <span style={CHART_TYPOGRAPHY_STYLE}>{item.label}</span>
                </span>
            ))}
        </div>
    );
});

const PanelHeading = memo(function PanelHeading({
    title,
    value,
    endContent,
}: {
    title: string;
    value?: string;
    endContent?: ReactNode;
}) {
    return (
        <div className="flex items-center justify-between gap-2 uppercase text-industrial-muted">
            <span style={GENERAL_TYPOGRAPHY_STYLE}>{title}</span>
            {endContent ?? (value ? <span data-testid="activity-analytics-panel-heading-value" style={CHART_TYPOGRAPHY_STYLE}>{value}</span> : null)}
        </div>
    );
});

const TextMetricCard = memo(function TextMetricCard({
    label,
    durationMs,
    productivityLabel,
}: {
    label: string;
    durationMs: number;
    productivityLabel: string;
}) {
    return (
        <div className={`${ANALYTICS_CARD_CLASS} rounded-xl p-3`}>
            <div className="text-industrial-text" style={CHART_TYPOGRAPHY_STYLE}>{label}</div>
            <div className="mt-2 text-industrial-muted" style={TECHNICAL_TYPOGRAPHY_STYLE}>{formatDurationHours(durationMs)}</div>
            <div className="mt-1 uppercase text-industrial-muted" style={TECHNICAL_TYPOGRAPHY_STYLE}>{productivityLabel}</div>
        </div>
    );
});

const SummaryDetailTextCard = memo(function SummaryDetailTextCard({
    detailRow,
}: {
    detailRow: SummaryDetailRow;
}) {
    return (
        <div className={`${ANALYTICS_CARD_CLASS} rounded-xl p-3`} data-testid="activity-analytics-summary-detail-section">
            <div className="flex items-baseline justify-between gap-3">
                <div className="text-industrial-text" style={GENERAL_TYPOGRAPHY_STYLE} data-testid="activity-analytics-summary-detail-title">{detailRow.title}</div>
                <div className="text-industrial-muted" style={TECHNICAL_TYPOGRAPHY_STYLE} data-testid="activity-analytics-summary-detail-value">
                    {detailRow.valueLabel}
                </div>
            </div>
        </div>
    );
});

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

// eslint-disable-next-line react-refresh/only-export-components -- test-only helper kept colocated with the widget renderer
export function resolveProdTrendLatestValueLabelPlacement({
    latestPointY,
    chartTop,
}: {
    latestPointY: number;
    chartTop: number;
}): 'above' | 'below' {
    return latestPointY - PROD_TREND_LATEST_VALUE_LABEL_Y_OFFSET_PX - PROD_TREND_LATEST_VALUE_LABEL_FLOAT_CLEARANCE_PX
        < chartTop + PROD_TREND_LATEST_VALUE_LABEL_TOP_CLAMP_PADDING_PX
        ? 'below'
        : 'above';
}

function normalizeRange(value: number, min: number, max: number): number {
    if (max <= min) {
        return 1;
    }

    return clamp((value - min) / (max - min), 0, 1);
}

function formatPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
}

function formatPercentRatio(value: number, total: number): string {
    if (total <= 0) {
        return '0%';
    }

    return formatPercent(clamp(value / total, 0, 1));
}

function formatDurationHours(durationMs: number): string {
    return `${(durationMs / (60 * 60 * 1000)).toFixed(1)} h`;
}

function formatHoursTick(durationMs: number): string {
    const hours = durationMs / (60 * 60 * 1000);
    const formattedHours = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);

    return `${formattedHours}h`;
}

function createActivityAnalyticsVisualPalette(
    stateGradients: Record<ActivityAnalyticsGradientStateKey, readonly [string, string]>,
    stateGradientAlphas: Record<ActivityAnalyticsGradientStateKey, readonly [number, number]>,
    coverageColor: string,
): ActivityAnalyticsVisualPalette {
    return {
        prod: createActivityAnalyticsPaletteEntry(stateGradients.prod, stateGradientAlphas.prod, 88),
        setup: createActivityAnalyticsPaletteEntry(stateGradients.setup, stateGradientAlphas.setup, 84),
        stopped: createActivityAnalyticsPaletteEntry(stateGradients.stopped, stateGradientAlphas.stopped, 80),
        noData: {
            solid: coverageColor,
            highlight: `color-mix(in srgb, ${coverageColor} 82%, white)`,
        },
    };
}

function createActivityAnalyticsPaletteEntry(
    gradient: readonly [string, string],
    gradientAlpha: readonly [number, number],
    highlightMixPercent: number,
): ActivityAnalyticsVisualPaletteEntry {
    const [start, end] = gradient;
    const solid = withAlpha(end, gradientAlpha[1]);
    const topCapSolid = end;
    const topCapHighlight = `color-mix(in srgb, ${end} ${highlightMixPercent}%, white)`;
    const donutTopCapSolid = start;
    const donutTopCapHighlight = `color-mix(in srgb, ${start} ${highlightMixPercent}%, white)`;

    return {
        gradient,
        gradientAlpha,
        initialSolid: withAlpha(gradient[0], gradientAlpha[0]),
        solid,
        highlight: `color-mix(in srgb, ${solid} ${highlightMixPercent}%, white)`,
        topCapSolid,
        topCapHighlight,
        donutTopCapSolid,
        donutTopCapHighlight,
    };
}

function resolveGroupedTopCapSolid(
    stateKey: ActivityAnalyticsGradientStateKey,
    paletteEntry: ActivityAnalyticsVisualPaletteEntry,
): string {
    return stateKey === 'setup' ? paletteEntry.topCapSolid : paletteEntry.donutTopCapSolid;
}

function resolveGroupedTopCapHighlight(
    stateKey: ActivityAnalyticsGradientStateKey,
    paletteEntry: ActivityAnalyticsVisualPaletteEntry,
): string {
    return stateKey === 'setup' ? paletteEntry.topCapHighlight : paletteEntry.donutTopCapHighlight;
}

function getVisualGradientStops(
    gradient: readonly [string, string],
    gradientAlpha: readonly [number, number],
): Readonly<{
    startColor: string;
    startOpacity: number;
    endColor: string;
    endOpacity: number;
}> {
    return {
        startColor: gradient[1],
        startOpacity: gradientAlpha[1] / 100,
        endColor: gradient[0],
        endOpacity: gradientAlpha[0] / 100,
    };
}

function SummaryBarsChart({
    bars,
    width,
    height,
    density,
    centerValue,
    centerLabel,
    detailRows,
    visualPalette,
    donutEffects,
    donutCenterValueFontSize,
}: {
    bars: ReadonlyArray<ActivityAnalyticsSummarySegmentBar>;
    width: number;
    height: number;
    density: ActivityAnalyticsSummaryLayout['density'];
    centerValue: string;
    centerLabel: string;
    detailRows: readonly SummaryDetailRow[];
    visualPalette: ActivityAnalyticsVisualPalette;
    donutEffects: ResolvedActivityAnalyticsVisualEffects['donut'];
    donutCenterValueFontSize?: number;
}) {
    const gradientPrefix = useId().replace(/:/g, '-');
    const glowFilterId = `${gradientPrefix}-summary-glow`;
    const travelingTopCapGlowFilterId = `${gradientPrefix}-summary-top-cap-traveling-glow`;
    const geometry = resolveSummaryDonutGeometry({
        width,
        height,
        density,
        detailRowCount: detailRows.length,
    });
    const {
        margin,
        detailGap,
        detailPanelWidth,
        donutRegionWidth,
        centerX,
        centerY,
        ringThickness,
        prodRingThickness,
        radius,
        detailBlockTop,
        detailSectionSpacing,
        detailMarkerSize,
        detailMarkerOffsetY,
        detailTitleBaselineY,
        detailValueBaselineY,
    } = geometry;
    const circumference = 2 * Math.PI * radius;
    const nonZeroBars = bars.filter((bar) => bar.durationMs > 0);
    const gapLength = resolveSummarySegmentGapLength({
        circumference,
        density,
        segmentCount: nonZeroBars.length,
    });
    const renderedSegments = buildActivityAnalyticsSummarySegments({
        bars: nonZeroBars,
        circumference,
        gapLength,
    });
    const detailPanelX = margin.left + donutRegionWidth + detailGap;
    const staticDonutTopCaps = donutEffects.topCap
        ? renderedSegments
            .map(({ bar, dashArray, dashOffset }) => createSummaryTopCapSegment({
                bar,
                dashArray,
                dashOffset,
                strokeWidth: bar.key === 'prod' ? prodRingThickness : ringThickness,
            }))
            .filter((segment): segment is NonNullable<typeof segment> => segment !== null)
        : [];
    const donutTravelingTopCapDurationSeconds = resolveTravelingEffectDurationSeconds(circumference);
    const {
        prefersReducedMotion,
        cycleKey: donutTravelingTopCapCycleKey,
        progress: donutTravelingTopCapProgress,
        isPaused: isDonutTravelingTopCapPaused,
    } = useTravelingEffectCycle({
        enabled: donutEffects.topCap && renderedSegments.length > 0,
        durationSeconds: donutTravelingTopCapDurationSeconds,
    });
    const movingDonutTopCap = resolveSummaryTravelingTopCapFrame({
        renderedSegments,
        cycleKey: donutTravelingTopCapCycleKey,
        progress: donutTravelingTopCapProgress,
        ringThickness,
        prodRingThickness,
    });
    const staticDonutTopCapFrame = useMemo(() => resolveSummaryStaticTopCapGlowFrame(), []);
    const showMovingDonutTopCap = donutEffects.topCap
        && !prefersReducedMotion
        && !isDonutTravelingTopCapPaused
        && movingDonutTopCap !== null;
    const centerValueRef = useRef<SVGTextElement | null>(null);
    const centerLabelRef = useRef<SVGTextElement | null>(null);
    const [centerLabelLayout, setCenterLabelLayout] = useState<SummaryCenterLabelLayout>(() => resolveSummaryCenterLabelLayout({
        valueFontSizePx: donutCenterValueFontSize ?? SUMMARY_DONUT_CENTER_VALUE_FONT_SIZE_FALLBACK_PX,
        labelFontSizePx: SUMMARY_DONUT_CENTER_LABEL_FONT_SIZE_FALLBACK_PX,
    }));
    const centerValueTextStyle = useMemo<CSSProperties>(() => {
        const resolvedFontSize = resolveActivityAnalyticsDonutCenterValueFontSize(donutCenterValueFontSize);

        return resolvedFontSize === undefined
            ? {
                ...WIDGET_VALUE_TEXT_STYLE,
                fontSize: `${SUMMARY_DONUT_CENTER_VALUE_FONT_SIZE_FALLBACK_PX}px`,
            }
            : {
                ...WIDGET_VALUE_TEXT_STYLE,
                fontSize: `${resolvedFontSize}px`,
            };
    }, [donutCenterValueFontSize]);

    useLayoutEffect(() => {
        const nextLayout = resolveSummaryCenterLabelLayout({
            valueFontSizePx: readSvgTextFontSizePx(
                centerValueRef.current,
                donutCenterValueFontSize ?? SUMMARY_DONUT_CENTER_VALUE_FONT_SIZE_FALLBACK_PX,
            ),
            labelFontSizePx: readSvgTextFontSizePx(centerLabelRef.current, SUMMARY_DONUT_CENTER_LABEL_FONT_SIZE_FALLBACK_PX),
        });

        setCenterLabelLayout((currentLayout) => areSummaryCenterLabelLayoutsEqual(currentLayout, nextLayout) ? currentLayout : nextLayout);
    }, [donutCenterValueFontSize]);

    return (
        <svg
            className="block"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            data-testid="activity-analytics-summary-chart"
            data-donut-center-y-px={geometry.centerY.toFixed(2)}
            data-donut-margin-top-px={geometry.margin.top.toFixed(2)}
            data-donut-region-width-px={geometry.donutRegionWidth.toFixed(2)}
            data-donut-region-height-px={geometry.donutRegionHeight.toFixed(2)}
            data-detail-panel-width-px={geometry.detailPanelWidth.toFixed(2)}
            data-donut-center-x-px={geometry.centerX.toFixed(2)}
        >
            <defs>
                {renderSurfaceEffectsFilter({
                    id: glowFilterId,
                    glow: donutEffects.glow,
                    blur: donutEffects.blur,
                    bounds: { x: '-60%', y: '-60%', width: '220%', height: '220%' },
                    profile: 'layered-aura',
                })}
                <filter id={travelingTopCapGlowFilterId} x="-140%" y="-140%" width="380%" height="380%">
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
                {bars.map((bar) => {
                    const gradientStops = visualPalette[bar.key as ActivityAnalyticsGradientStateKey].gradient;
                    const gradientAlpha = visualPalette[bar.key as ActivityAnalyticsGradientStateKey].gradientAlpha;
                    const visualGradientStops = bar.key === 'prod'
                        ? {
                            startColor: gradientStops[0],
                            startOpacity: gradientAlpha[0] / 100,
                            endColor: gradientStops[1],
                            endOpacity: gradientAlpha[1] / 100,
                        }
                        : getVisualGradientStops(gradientStops, gradientAlpha);

                    return (
                        <linearGradient key={bar.key} id={`${gradientPrefix}-${bar.key}-gradient`} x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stopColor={visualGradientStops.startColor} stopOpacity={visualGradientStops.startOpacity} />
                            <stop offset="100%" stopColor={visualGradientStops.endColor} stopOpacity={visualGradientStops.endOpacity} />
                        </linearGradient>
                    );
                })}
                {bars.map((bar) => {
                    const topCapPalette = visualPalette[bar.key as ActivityAnalyticsGradientStateKey];

                    return (
                        <linearGradient key={`${bar.key}-top-cap`} id={`${gradientPrefix}-${bar.key}-top-cap-gradient`} x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stopColor={topCapPalette.donutTopCapHighlight} stopOpacity={1} />
                            <stop offset="100%" stopColor={topCapPalette.donutTopCapSolid} stopOpacity={1} />
                        </linearGradient>
                    );
                })}
            </defs>

            <circle
                cx={centerX}
                cy={centerY}
                r={radius}
                fill="none"
                stroke="color-mix(in srgb, var(--color-industrial-border) 76%, transparent)"
                strokeWidth={ringThickness}
            />

            <g data-testid="activity-analytics-summary-stack">
                {renderedSegments.map(({ bar, dashArray, dashOffset }) => {
                    return (
                        <circle
                            key={bar.key}
                            cx={centerX}
                            cy={centerY}
                            r={radius}
                            fill="none"
                            stroke={`url(#${gradientPrefix}-${bar.key}-gradient)`}
                            strokeWidth={bar.key === 'prod' ? prodRingThickness : ringThickness}
                            strokeDasharray={dashArray}
                            strokeDashoffset={dashOffset}
                            strokeLinecap="butt"
                            filter={donutEffects.glow > 0 || donutEffects.blur > 0 ? `url(#${glowFilterId})` : undefined}
                            transform={`rotate(-90 ${centerX} ${centerY})`}
                            data-testid="activity-analytics-summary-segment"
                            data-segment-key={bar.key}
                        />
                    );
                })}
                {!showMovingDonutTopCap && prefersReducedMotion && staticDonutTopCaps.map((segment) => (
                    <g
                        key={`summary-static-top-cap-${segment.key}`}
                        pointerEvents="none"
                        aria-hidden="true"
                        data-testid="activity-analytics-summary-static-top-cap"
                        data-segment-key={segment.key}
                        style={{ mixBlendMode: 'screen' }}
                    >
                        {renderSummaryTopCapGlowStack({
                            centerX,
                            centerY,
                            radius,
                            gradientPrefix,
                            segment,
                            frame: staticDonutTopCapFrame,
                            filterId: travelingTopCapGlowFilterId,
                            solidColor: visualPalette[segment.key].donutTopCapSolid,
                            highlightColor: visualPalette[segment.key].donutTopCapHighlight,
                        })}
                    </g>
                ))}
                {showMovingDonutTopCap && movingDonutTopCap ? (
                    <g
                        key={`summary-traveling-top-cap-${donutTravelingTopCapCycleKey}`}
                        pointerEvents="none"
                        aria-hidden="true"
                        data-testid="activity-analytics-summary-top-cap"
                        data-segment-key={movingDonutTopCap.key}
                        data-direction={movingDonutTopCap.direction}
                        data-route-step={movingDonutTopCap.routeStep}
                        data-route-count={movingDonutTopCap.routeCount}
                        data-route-index={movingDonutTopCap.routeIndex}
                        data-cycle-key={donutTravelingTopCapCycleKey}
                        data-duration={`${donutTravelingTopCapDurationSeconds}s`}
                        style={{ mixBlendMode: 'screen' }}
                    >
                        {renderSummaryTopCapGlowStack({
                            centerX,
                            centerY,
                            radius,
                            gradientPrefix,
                            segment: movingDonutTopCap,
                            frame: movingDonutTopCap.frame,
                            filterId: travelingTopCapGlowFilterId,
                            solidColor: visualPalette[movingDonutTopCap.key].donutTopCapSolid,
                            highlightColor: visualPalette[movingDonutTopCap.key].donutTopCapHighlight,
                        })}
                    </g>
                ) : null}

                <circle
                    cx={centerX}
                    cy={centerY}
                    r={Math.max(radius - (prodRingThickness / 2) - SUMMARY_DONUT_GEOMETRY_RULES.innerClearancePx, 1)}
                    fill="transparent"
                />
                <g
                    data-testid="activity-analytics-summary-center-label-group"
                    transform={`translate(${centerX} ${centerY})`}
                >
                    <text
                        ref={centerValueRef}
                        x={0}
                        y={centerLabelLayout.valueY}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="var(--color-industrial-text)"
                        style={centerValueTextStyle}
                        data-testid="activity-analytics-summary-total-value"
                    >
                        {centerValue}
                    </text>
                    <text
                        ref={centerLabelRef}
                        x={0}
                        y={centerLabelLayout.labelY}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="var(--color-industrial-muted)"
                        style={GENERAL_TYPOGRAPHY_STYLE}
                        data-testid="activity-analytics-summary-total-label"
                    >
                        {centerLabel}
                    </text>
                </g>
            </g>

            <g data-testid="activity-analytics-summary-details" data-layout="centered-column" transform={`translate(${detailPanelX} ${detailBlockTop})`}>
                {detailRows.map((detailRow, index) => {
                    const sectionY = index * detailSectionSpacing;

                    return (
                        <g key={`summary-detail-${detailRow.key}`} data-testid="activity-analytics-summary-detail-section">
                            {detailRow.showMarker !== false ? (
                                <rect
                                    x={0}
                                    y={sectionY + detailMarkerOffsetY}
                                    width={detailMarkerSize}
                                    height={detailMarkerSize}
                                    rx={3}
                                    fill={detailRow.markerFill}
                                />
                            ) : null}
                            <text
                                x={detailMarkerSize + SUMMARY_DONUT_GEOMETRY_RULES.detailMarkerLabelGapPx}
                                y={sectionY + detailTitleBaselineY}
                                textAnchor="start"
                                fill={detailRow.titleFill ?? 'var(--color-industrial-text)'}
                                style={GENERAL_TYPOGRAPHY_STYLE}
                                data-testid="activity-analytics-summary-detail-title"
                            >
                                {detailRow.title}
                            </text>
                            <text
                                x={detailMarkerSize + SUMMARY_DONUT_GEOMETRY_RULES.detailMarkerLabelGapPx}
                                y={sectionY + detailValueBaselineY}
                                textAnchor="end"
                                fill="var(--color-industrial-muted)"
                                style={TECHNICAL_TYPOGRAPHY_STYLE}
                                dx={detailPanelWidth - detailMarkerSize - SUMMARY_DONUT_GEOMETRY_RULES.detailMarkerLabelGapPx}
                                data-testid={detailRow.key === 'coverage' ? 'activity-analytics-summary-coverage' : 'activity-analytics-summary-detail-value'}
                            >
                                {detailRow.valueLabel}
                            </text>
                        </g>
                    );
                })}
            </g>
        </svg>
    );
}

function readSvgTextFontSizePx(element: SVGTextElement | null, fallbackPx: number): number {
    if (!element || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
        return fallbackPx;
    }

    const computedFontSize = window.getComputedStyle(element).fontSize;
    const parsedFontSize = Number.parseFloat(computedFontSize);

    return Number.isFinite(parsedFontSize) && parsedFontSize > 0 ? parsedFontSize : fallbackPx;
}

function resolveSummaryCenterLabelLayout({
    valueFontSizePx,
    labelFontSizePx,
}: {
    valueFontSizePx: number;
    labelFontSizePx: number;
}): SummaryCenterLabelLayout {
    const gapPx = Math.max(2, labelFontSizePx * SUMMARY_DONUT_CENTER_LABEL_GAP_RATIO);

    return {
        valueY: -((labelFontSizePx + gapPx) / 2),
        labelY: (valueFontSizePx + gapPx) / 2,
    };
}

function areSummaryCenterLabelLayoutsEqual(
    currentLayout: SummaryCenterLabelLayout,
    nextLayout: SummaryCenterLabelLayout,
): boolean {
    return Math.abs(currentLayout.valueY - nextLayout.valueY) < 0.01
        && Math.abs(currentLayout.labelY - nextLayout.labelY) < 0.01;
}

function GroupedStackedBarsChart({
    grouped,
    width,
    layout,
    chartLayout,
    barWidthFactor,
    visualPalette,
    groupedEffects,
}: {
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    width: number;
    layout: ActivityAnalyticsGroupsLayout;
    chartLayout: ActivityAnalyticsGroupsChartLayout;
    barWidthFactor: number;
    visualPalette: ActivityAnalyticsVisualPalette;
    groupedEffects: ResolvedActivityAnalyticsVisualEffects['groupedBars'];
}) {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [hoverInfo, setHoverInfo] = useState<{ index: number; x: number } | null>(null);
    const gradientPrefix = useId().replace(/:/g, '-');
    const groupedGlowFilterId = `${gradientPrefix}-grouped-glow`;
    const groupedTravelingTopCapGlowFilterId = `${gradientPrefix}-grouped-current-top-cap-traveling-glow`;
    const { chartHeight: height, chartMargin, productivityLabelClearanceTop } = chartLayout;
    const margin = {
        top: chartMargin.top + productivityLabelClearanceTop,
        right: chartMargin.right,
        bottom: chartMargin.bottom,
        left: chartMargin.left,
    };
    const xAxisModel = resolveGroupedXAxisModel({
        grouped,
        width,
        layout,
        chartMargin: { left: margin.left, right: margin.right },
        barWidthFactor,
    });
    const { chartWidth, plotWidth, positions, visibleLabelIndices } = xAxisModel;
    const plotHeight = Math.max(height - margin.top - margin.bottom, 1);
    const maxDurationMs = Math.max(...grouped.map(resolveGroupedChartDomainDurationMs), 1);
    const safeBarWidthFactor = clampActivityAnalyticsGroupBarWidth(barWidthFactor);
    const groupedDensity = layout.density === 'fit'
        ? 'fit'
        : layout.density === 'scroll'
            ? 'scroll'
            : 'compress';
    const slotWidth = Math.max(plotWidth / Math.max(grouped.length, 1), 1);
    const targetGap = resolveGroupedBarGap(slotWidth, groupedDensity);
    const baseBarWidth = Math.max(
        Math.min(slotWidth * GROUPED_BAR_WIDTH_RATIO[groupedDensity], slotWidth - targetGap),
        6,
    );
    const barWidth = clamp(
        baseBarWidth * safeBarWidthFactor,
        6,
        Math.max(slotWidth - 4, 6),
    );
    const axisTicks = Array.from({ length: 5 }, (_, index) => ({
        value: maxDurationMs - ((maxDurationMs * index) / 4),
        y: margin.top + ((index / 4) * plotHeight),
    }));
    const horizontalPadding = resolveGroupedChartEdgePadding(barWidth, layout.density);
    const usablePlotWidth = Math.max(plotWidth - (2 * horizontalPadding), 1);
    const usableSlotWidth = grouped.length > 0 ? usablePlotWidth / grouped.length : usablePlotWidth;
    const centerStep = usableSlotWidth;
    const currentPartialBucketKey = useMemo(() => {
        for (let index = grouped.length - 1; index >= 0; index -= 1) {
            const bucket = grouped[index];

            if (isGroupedBucketPartial(bucket) && isGroupedBucketMarkedInProgress(bucket)) {
                return bucket.bucketKey;
            }
        }

        return null;
    }, [grouped]);
    const currentPartialTrackHeight = useMemo(() => {
        if (!currentPartialBucketKey) {
            return 0;
        }

        const currentPartialBucket = grouped.find((bucket) => bucket.bucketKey === currentPartialBucketKey);

        if (!currentPartialBucket) {
            return 0;
        }

        const trackDurationMs = currentPartialBucket.expectedDurationMs > 0
            ? currentPartialBucket.expectedDurationMs
            : resolveGroupedChartDomainDurationMs(currentPartialBucket);

        return (trackDurationMs / maxDurationMs) * plotHeight;
    }, [currentPartialBucketKey, grouped, maxDurationMs, plotHeight]);
    const groupedTravelingTopCapDurationSeconds = resolveTravelingEffectDurationSeconds(Math.max(currentPartialTrackHeight, 1));
    const {
        prefersReducedMotion,
        cycleKey: groupedTravelingTopCapCycleKey,
        progress: groupedTravelingTopCapProgress,
        isPaused: isGroupedTravelingTopCapPaused,
    } = useTravelingEffectCycle({
        enabled: groupedEffects.topCap && currentPartialBucketKey !== null && currentPartialTrackHeight > 0,
        durationSeconds: groupedTravelingTopCapDurationSeconds,
    });
    const staticGroupedTopCapFrame = useMemo(() => resolveSummaryStaticTopCapGlowFrame(), []);

    const handleHoverChange = (index: number | null, x?: number) => {
        setHoveredIndex(index);
        setHoverInfo(index !== null && x !== undefined ? { index, x } : null);
    };

    return (
        <div className="relative shrink-0 self-end" style={{ width: `${chartWidth}px` }}>
            <svg width={chartWidth} height={height} viewBox={`0 0 ${chartWidth} ${height}`} data-testid="activity-analytics-groups-chart">
                <defs>
                    {renderSurfaceEffectsFilter({
                        id: groupedGlowFilterId,
                        glow: groupedEffects.glow,
                        blur: groupedEffects.blur,
                        bounds: { x: '-60%', y: '-60%', width: '220%', height: '220%' },
                        profile: 'layered-aura',
                    })}
                    {ACTIVITY_ANALYTICS_STATE_KEYS.map((stateKey) => {
                        const visualGradientStops = getVisualGradientStops(
                            visualPalette[stateKey].gradient,
                            visualPalette[stateKey].gradientAlpha,
                        );

                        return (
                            <linearGradient key={stateKey} id={`${gradientPrefix}-${stateKey}-gradient`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={visualGradientStops.startColor} stopOpacity={visualGradientStops.startOpacity} />
                                <stop offset="100%" stopColor={visualGradientStops.endColor} stopOpacity={visualGradientStops.endOpacity} />
                            </linearGradient>
                        );
                    })}
                    <filter id={groupedTravelingTopCapGlowFilterId} x="-140%" y="-140%" width="380%" height="380%">
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
                    {ACTIVITY_ANALYTICS_STATE_KEYS.map((stateKey) => {
                        const topCapPalette = visualPalette[stateKey];

                        return (
                            <linearGradient key={`${stateKey}-group-top-cap`} id={`${gradientPrefix}-${stateKey}-group-top-cap-gradient`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={resolveGroupedTopCapHighlight(stateKey, topCapPalette)} stopOpacity={1} />
                                <stop offset="100%" stopColor={resolveGroupedTopCapSolid(stateKey, topCapPalette)} stopOpacity={1} />
                            </linearGradient>
                        );
                    })}
                </defs>
                {axisTicks.map((tick, index) => (
                    <g key={`groups-tick-${index}`}>
                        <line x1={margin.left} x2={margin.left + plotWidth} y1={tick.y} y2={tick.y} stroke="var(--color-industrial-border)" strokeDasharray="3 3" opacity={0.65} />
                        <text x={chartMargin.left - 8} y={tick.y} dy={4} textAnchor="end" fill="var(--color-industrial-muted)" style={CHART_TYPOGRAPHY_STYLE} data-testid="activity-analytics-y-axis-tick">
                            {formatHoursTick(tick.value)}
                        </text>
                    </g>
                ))}

                <line x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + plotHeight} stroke="var(--color-industrial-border)" />
                <line x1={margin.left} x2={margin.left + plotWidth} y1={margin.top + plotHeight} y2={margin.top + plotHeight} stroke="var(--color-industrial-border)" />

                {grouped.map((bucket, index) => {
                    const x = positions[index] - (barWidth / 2);
                    const segments: ReadonlyArray<{ key: string; value: number; fill: string; solidColor: string; opacity?: number }> = [
                        { key: 'noData', value: bucket.durationsMs.noData, fill: visualPalette.noData.solid, solidColor: visualPalette.noData.solid, opacity: 0.5 },
                        { key: 'stopped', value: bucket.durationsMs.stopped, fill: `url(#${gradientPrefix}-stopped-gradient)`, solidColor: visualPalette.stopped.solid },
                        { key: 'setup', value: bucket.durationsMs.setup, fill: `url(#${gradientPrefix}-setup-gradient)`, solidColor: visualPalette.setup.solid },
                        { key: 'prod', value: bucket.durationsMs.prod, fill: `url(#${gradientPrefix}-prod-gradient)`, solidColor: visualPalette.prod.solid },
                    ];
                    let currentY = margin.top + plotHeight;
                    const renderedSegments = segments.map((segment) => {
                        const segmentHeight = (segment.value / maxDurationMs) * plotHeight;
                        currentY -= segmentHeight;

                        return {
                            ...segment,
                            y: currentY,
                            height: segmentHeight,
                        };
                    });
                    const topCapWidth = barWidth;
                    const topCapX = x;
                    const topCapSegments = renderedSegments
                        .filter((segment) => segment.key !== 'noData' && segment.value > 0)
                        .map((segment) => ({
                            ...segment,
                            topCapHeight: GROUPED_STATIC_TOP_CAP_HEIGHT_PX,
                        }))
                        .filter((segment) => segment.topCapHeight > 0);
                    const isCurrentPartialBucket = bucket.bucketKey === currentPartialBucketKey;
                    const groupedTravelingTopCap = isCurrentPartialBucket
                        ? resolveGroupedTravelingTopCapFrame({
                            bucket,
                            renderedSegments,
                            x,
                            barWidth,
                            plotHeight,
                            plotTop: margin.top,
                            maxDurationMs,
                            cycleKey: groupedTravelingTopCapCycleKey,
                            progress: groupedTravelingTopCapProgress,
                        })
                        : null;
                    const showMovingGroupedTopCap = isCurrentPartialBucket
                        && groupedEffects.topCap
                        && !prefersReducedMotion
                        && !isGroupedTravelingTopCapPaused
                        && groupedTravelingTopCap !== null;
                    const showStaticGroupedTopCap = isCurrentPartialBucket
                        && groupedEffects.topCap
                        && prefersReducedMotion
                        && groupedTravelingTopCap !== null;
                    const productivityLabelY = isCurrentPartialBucket
                        ? Math.max(margin.top - GROUPED_CURRENT_BAR_TOP_LABEL_OFFSET_PX, 14)
                        : Math.max(currentY - 8, 14);

                    return (
                        <g key={bucket.bucketKey} data-testid="activity-analytics-group-stack">
                            {bucket.isInProgress && bucket.expectedDurationMs > 0 && (
                                <rect
                                    x={x}
                                    y={margin.top + plotHeight - ((bucket.expectedDurationMs / maxDurationMs) * plotHeight)}
                                    width={barWidth}
                                    height={(bucket.expectedDurationMs / maxDurationMs) * plotHeight}
                                    rx={0}
                                    fill="none"
                                    stroke="var(--color-industrial-muted)"
                                    strokeDasharray="4 4"
                                    opacity={0.8}
                                    data-testid="activity-analytics-group-partial-outline"
                                />
                            )}
                            {renderedSegments.map((segment) => (
                                <rect
                                    key={`${bucket.bucketKey}-${segment.key}`}
                                    x={x}
                                    y={segment.y}
                                    width={barWidth}
                                    height={segment.height}
                                    rx={0}
                                    fill={segment.fill}
                                    opacity={segment.opacity ?? 0.92}
                                    filter={segment.key !== 'noData' && (groupedEffects.glow > 0 || groupedEffects.blur > 0)
                                        ? `url(#${groupedGlowFilterId})`
                                        : undefined}
                                    data-testid="activity-analytics-group-segment"
                                    data-segment-key={segment.key}
                                />
                            ))}
                            {groupedEffects.topCap && !isCurrentPartialBucket && topCapSegments.map((segment) => (
                                <rect
                                    key={`${bucket.bucketKey}-${segment.key}-top-cap`}
                                    x={topCapX}
                                    y={segment.y}
                                    width={topCapWidth}
                                    height={segment.topCapHeight}
                                    rx={0}
                                    fill={resolveGroupedTopCapHighlight(
                                        segment.key as ActivityAnalyticsGradientStateKey,
                                        visualPalette[segment.key as ActivityAnalyticsGradientStateKey],
                                    )}
                                    style={{ filter: buildTopCapDropShadow(
                                        resolveGroupedTopCapSolid(
                                            segment.key as ActivityAnalyticsGradientStateKey,
                                            visualPalette[segment.key as ActivityAnalyticsGradientStateKey],
                                        ),
                                        groupedEffects.topCapGlow,
                                    ) }}
                                    data-testid="activity-analytics-group-top-cap"
                                    data-segment-key={segment.key}
                                />
                            ))}
                            {showStaticGroupedTopCap && groupedTravelingTopCap ? (
                                <g
                                    pointerEvents="none"
                                    aria-hidden="true"
                                    data-testid="activity-analytics-group-current-top-cap"
                                    data-segment-key={groupedTravelingTopCap.key}
                                    data-direction="bottom-to-top"
                                    data-motion="static"
                                    data-track-y={groupedTravelingTopCap.trackY.toFixed(2)}
                                    data-track-height={groupedTravelingTopCap.trackHeight.toFixed(2)}
                                    data-cap-height={groupedTravelingTopCap.height.toFixed(2)}
                                    style={{ mixBlendMode: 'screen' }}
                                >
                                    {renderGroupedTopCapGlowStack({
                                        gradientPrefix,
                                        segment: groupedTravelingTopCap,
                                        frame: staticGroupedTopCapFrame,
                                        filterId: groupedTravelingTopCapGlowFilterId,
                                        solidColor: resolveGroupedTopCapSolid(groupedTravelingTopCap.key, visualPalette[groupedTravelingTopCap.key]),
                                        highlightColor: resolveGroupedTopCapHighlight(groupedTravelingTopCap.key, visualPalette[groupedTravelingTopCap.key]),
                                    })}
                                </g>
                            ) : null}
                            {showMovingGroupedTopCap && groupedTravelingTopCap ? (
                                <g
                                    key={`group-traveling-top-cap-${bucket.bucketKey}-${groupedTravelingTopCapCycleKey}`}
                                    pointerEvents="none"
                                    aria-hidden="true"
                                    data-testid="activity-analytics-group-current-top-cap"
                                    data-segment-key={groupedTravelingTopCap.key}
                                    data-direction="bottom-to-top"
                                    data-motion="traveling"
                                    data-cycle-key={groupedTravelingTopCapCycleKey}
                                    data-duration={`${groupedTravelingTopCapDurationSeconds}s`}
                                    data-track-y={groupedTravelingTopCap.trackY.toFixed(2)}
                                    data-track-height={groupedTravelingTopCap.trackHeight.toFixed(2)}
                                    data-cap-height={groupedTravelingTopCap.height.toFixed(2)}
                                    style={{ mixBlendMode: 'screen' }}
                                >
                                    {renderGroupedTopCapGlowStack({
                                        gradientPrefix,
                                        segment: groupedTravelingTopCap,
                                        frame: groupedTravelingTopCap.frame,
                                        filterId: groupedTravelingTopCapGlowFilterId,
                                        solidColor: resolveGroupedTopCapSolid(groupedTravelingTopCap.key, visualPalette[groupedTravelingTopCap.key]),
                                        highlightColor: resolveGroupedTopCapHighlight(groupedTravelingTopCap.key, visualPalette[groupedTravelingTopCap.key]),
                                    })}
                                </g>
                            ) : null}

                            <text
                                x={x + (barWidth / 2)}
                                y={productivityLabelY}
                                textAnchor="middle"
                                fill="var(--color-industrial-text)"
                                style={CHART_TYPOGRAPHY_STYLE}
                                data-testid="activity-analytics-group-productivity"
                                data-label-placement={isCurrentPartialBucket ? 'top-row' : 'bar-top'}
                            >
                            {resolveGroupedVisibleProductivityLabel(bucket)}
                            </text>
                            {visibleLabelIndices.has(index) && (
                                <text x={x + (barWidth / 2)} y={height - 8} textAnchor="middle" fill="var(--color-industrial-muted)" style={CHART_TYPOGRAPHY_STYLE}>
                                    {resolveGroupedAxisLabel(bucket.label)}
                                </text>
                            )}
                        </g>
                    );
                })}

                <ChartHoverLayer
                    dataLength={grouped.length}
                    x0={positions[0] ?? (margin.left + (plotWidth / 2))}
                    step={centerStep}
                    marginTop={margin.top}
                    marginLeft={margin.left}
                    plotWidth={plotWidth}
                    plotHeight={plotHeight}
                    hoveredIndex={hoveredIndex}
                    onHoverChange={handleHoverChange}
                    indicatorColor="var(--color-industrial-muted)"
                    highlightBorderColor="var(--color-industrial-bg)"
                    highlights={hoveredIndex !== null && grouped[hoveredIndex]
                        ? buildGroupHighlights({
                            bucket: grouped[hoveredIndex],
                            x: positions[hoveredIndex] ?? (margin.left + (plotWidth / 2)),
                            top: margin.top,
                            plotHeight,
                            maxDurationMs,
                            visualPalette,
                        })
                        : undefined}
                />
            </svg>

            {hoverInfo && hoverInfo.index < grouped.length && (() => {
                const bucket = grouped[hoverInfo.index];
                const series: ChartTooltipSeries[] = buildGroupedTooltipSeries(bucket, visualPalette);

                return (
                    <ChartTooltip
                        label={resolveGroupedTooltipLabel(bucket.label)}
                        series={series}
                        x={hoverInfo.x}
                        containerWidth={chartWidth}
                        panelClassName={GROUPED_TOOLTIP_PANEL_CLASS}
                        labelClassName={GROUPED_TOOLTIP_LABEL_CLASS}
                    />
                );
            })()}
        </div>
    );
}

function buildGroupHighlights({
    bucket,
    x,
    top,
    plotHeight,
    maxDurationMs,
    visualPalette,
}: {
    bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number];
    x: number;
    top: number;
    plotHeight: number;
    maxDurationMs: number;
    visualPalette: ActivityAnalyticsVisualPalette;
}) {
    const scaleY = (value: number) => top + plotHeight - ((value / maxDurationMs) * plotHeight);
    const noDataTop = scaleY(bucket.durationsMs.noData);
    const stoppedTop = scaleY(bucket.durationsMs.noData + bucket.durationsMs.stopped);
    const setupTop = scaleY(bucket.durationsMs.noData + bucket.durationsMs.stopped + bucket.durationsMs.setup);
    const prodTop = scaleY(bucket.durationsMs.noData + bucket.durationsMs.stopped + bucket.durationsMs.setup + bucket.durationsMs.prod);

    return [
        { x, y: noDataTop, color: visualPalette.noData.solid },
        { x, y: prodTop, color: visualPalette.prod.solid },
        { x, y: setupTop, color: visualPalette.setup.solid },
        { x, y: stoppedTop, color: visualPalette.stopped.solid },
    ];
}

function resolveGroupedChartEdgePadding(barWidth: number, density: ActivityAnalyticsGroupsLayout['density']): number {
    const densityFactor = density === 'compress'
        ? GROUPED_EDGE_PADDING_FACTORS.compress
        : density === 'scroll'
            ? GROUPED_EDGE_PADDING_FACTORS.scroll
            : GROUPED_EDGE_PADDING_FACTORS.default;

    return Math.max(barWidth * densityFactor, GROUPED_EDGE_PADDING_MIN_PX);
}

function resolveGroupedBarGap(slotWidth: number, density: keyof typeof GROUPED_BAR_GAP_RULES): number {
    const rules = GROUPED_BAR_GAP_RULES[density];

    return clamp(slotWidth * rules.ratio, rules.min, rules.max);
}

interface ComparisonEntry {
    label: string;
    heading: string;
    productivityLabel: string;
    productivityRatio: number | null;
    isEmpty: boolean;
}

const ComparisonRow = memo(function ComparisonRow({
    entry,
    visualPalette,
}: {
    entry: ComparisonEntry;
    visualPalette: ActivityAnalyticsVisualPalette;
}) {
    const fillHeight = entry.productivityRatio === null ? 0 : clamp(entry.productivityRatio * 100, 0, 100);

    return (
        <div className="flex h-full min-h-0 flex-col items-center justify-center gap-1 text-center" data-testid="activity-analytics-comparison-row">
            <div className="text-industrial-text" style={TECHNICAL_TYPOGRAPHY_STYLE} data-testid="activity-analytics-comparison-percent">{entry.productivityLabel}</div>
            <div
                className="flex shrink-0 items-end justify-center self-stretch"
                style={{ height: `${COMPARISON_LAYOUT_RULES.trackHeightPx}px` }}
                data-testid="activity-analytics-comparison-track-region"
            >
                <div
                    className={`relative flex h-full ${COMPARISON_BAR_WIDTH_CLASS} items-end overflow-hidden rounded-full bg-white/5`}
                    data-testid="activity-analytics-comparison-bar-track"
                    aria-hidden="true"
                >
                    <div
                        className="absolute inset-x-0 bottom-0 rounded-full transition-all duration-500 ease-out"
                        data-testid="activity-analytics-comparison-bar-fill"
                        style={{
                            height: `${fillHeight}%`,
                            background: `linear-gradient(to top, ${visualPalette.prod.initialSolid} 0%, ${visualPalette.prod.solid} 100%)`,
                            boxShadow: `0 0 15px ${visualPalette.prod.highlight}`,
                            opacity: entry.isEmpty ? 0.2 : 1,
                        }}
                    />
                </div>
            </div>
            <div className="uppercase text-industrial-muted" style={GENERAL_TYPOGRAPHY_STYLE}>{entry.heading}</div>
            <div className="text-industrial-muted" style={TECHNICAL_TYPOGRAPHY_STYLE} data-testid="activity-analytics-metric-value">{entry.label}</div>
        </div>
    );
});

function parsePercentLabel(value: string): number | null {
    const match = value.match(/^(\d+)%$/);

    if (!match) {
        return null;
    }

    return Number(match[1]) / 100;
}

function createComparisonEntry(
    heading: 'Mejor' | 'Peor',
    target: { bucketKey: string; label: string } | null | undefined,
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'],
): ComparisonEntry {
    const matchedBucket = target
        ? grouped.find((bucket) => bucket.bucketKey === target.bucketKey)
            ?? grouped.find((bucket) => bucket.label === target.label)
        : undefined;
    const fallbackEntry: ComparisonEntry = {
        heading,
        label: COMPARISON_FALLBACK_LABEL,
        productivityLabel: COMPARISON_FALLBACK_LABEL,
        productivityRatio: null,
        isEmpty: true,
    };

    if (!matchedBucket) {
        return fallbackEntry;
    }

    const comparableProductivityRatio = resolveActivityAnalyticsComparableProductivityRatio(matchedBucket);
    const visibleProductivityRatio = resolveGroupedVisibleProductivityRatio(matchedBucket);
    const shouldUseTurnoSummaryVisibleProductivity = isTurnoSummaryBucket(matchedBucket)
        && matchedBucket.isInProgress !== true
        && matchedBucket.hasInProgressContribution !== true
        && visibleProductivityRatio !== null;

    if (comparableProductivityRatio === null && !shouldUseTurnoSummaryVisibleProductivity) {
        return fallbackEntry;
    }

    const resolvedProductivityRatio = shouldUseTurnoSummaryVisibleProductivity
        ? visibleProductivityRatio
        : matchedBucket.coverageRatio < 1
            ? comparableProductivityRatio
            : matchedBucket.productivityRatio ?? parsePercentLabel(matchedBucket.productivityLabel);
    const resolvedProductivityLabel = shouldUseTurnoSummaryVisibleProductivity
        ? resolveGroupedVisibleProductivityLabel(matchedBucket)
        : matchedBucket.coverageRatio < 1
            ? formatPercent(comparableProductivityRatio ?? 0)
            : matchedBucket.productivityLabel;
    return {
        heading,
        label: matchedBucket.label,
        productivityLabel: resolvedProductivityLabel,
        productivityRatio: resolvedProductivityRatio,
        isEmpty: resolvedProductivityRatio === null,
    };
}

function withAlpha(hex: string, alphaPercentage: number): string {
    if (alphaPercentage >= 100) {
        return hex;
    }

    const normalized = hex.replace('#', '');
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);

    return `rgba(${red}, ${green}, ${blue}, ${alphaPercentage / 100})`;
}

function resolveSummaryDonutGeometry({
    width,
    height,
    density,
    detailRowCount,
}: {
    width: number;
    height: number;
    density: ActivityAnalyticsSummaryLayout['density'];
    detailRowCount: number;
}): SummaryDonutGeometry {
    const densityGeometry = density === 'compress'
        ? SUMMARY_DONUT_GEOMETRY_RULES.density.compress
        : SUMMARY_DONUT_GEOMETRY_RULES.density.default;
    const margin = densityGeometry.marginPx;
    const detailGap = densityGeometry.detailGapPx;
    const detailPanelWidth = Math.min(
        Math.max(width * densityGeometry.detailPanelWidthRatio, densityGeometry.detailPanelWidthMinPx),
        densityGeometry.detailPanelWidthMaxPx,
    );
    const donutRegionWidth = Math.max(width - margin.left - margin.right - detailGap - detailPanelWidth, 1);
    const donutRegionHeight = Math.max(height - margin.top - margin.bottom, 1);
    const centerX = margin.left + (donutRegionWidth / 2);
    const centerY = margin.top + (donutRegionHeight * densityGeometry.centerYRatio);
    const safeReferenceSize = Math.min(donutRegionWidth, donutRegionHeight);
    const ringThickness = clamp(
        safeReferenceSize * 0.06,
        SUMMARY_RING_MIN_THICKNESS,
        SUMMARY_RING_MAX_THICKNESS,
    );
    const prodRingThickness = ringThickness * SUMMARY_RING_PROD_THICKNESS_MULTIPLIER;
    const outerRadius = Math.max(
        Math.min((safeReferenceSize / 2) - densityGeometry.outerRadiusInsetPx, densityGeometry.outerRadiusMaxPx),
        SUMMARY_DONUT_GEOMETRY_RULES.minimumOuterRadiusPx,
    );
    const radius = Math.max(outerRadius - (prodRingThickness / 2), 1);
    const detailMarkerSize = SUMMARY_DONUT_GEOMETRY_RULES.detail.markerSizePx;
    const detailMarkerOffsetY = SUMMARY_DONUT_GEOMETRY_RULES.detail.markerOffsetYPx;
    const detailTitleBaselineY = SUMMARY_DONUT_GEOMETRY_RULES.detail.titleBaselineYPx;
    const detailValueBaselineY = densityGeometry.detailValueBaselineYPx;
    const detailSectionHeight = densityGeometry.detailSectionHeightPx;
    const detailSectionGap = detailRowCount > 3
        ? Math.min(densityGeometry.detailSectionGapPx, 8)
        : densityGeometry.detailSectionGapPx;
    const detailSectionSpacing = detailSectionHeight + detailSectionGap;
    const detailBlockHeight = detailSectionHeight + ((Math.max(detailRowCount - 1, 0)) * detailSectionSpacing);
    const detailBlockTop = centerY - (detailBlockHeight / 2);
    const donutBandRadius = radius + (prodRingThickness / 2);

    return {
        chartHeight: height,
        margin,
        detailGap,
        detailPanelWidth,
        donutRegionWidth,
        donutRegionHeight,
        centerX,
        centerY,
        ringThickness,
        prodRingThickness,
        outerRadius,
        radius,
        detailBlockTop,
        detailSectionSpacing,
        detailSectionHeight,
        detailMarkerSize,
        detailMarkerOffsetY,
        detailTitleBaselineY,
        detailValueBaselineY,
        donutBandTopY: centerY - donutBandRadius,
        donutBandBottomY: centerY + donutBandRadius,
    };
}

function buildTopCapDropShadow(color: string, intensity: number): string | undefined {
    if (intensity <= 0) {
        return undefined;
    }

    return `drop-shadow(0 0 ${2 + (intensity / 25)}px ${color})`;
}

type SurfaceEffectsFilterProfile = 'standard' | 'layered-aura';

function renderSurfaceEffectsFilter({
    id,
    glow,
    blur,
    bounds,
    profile = 'standard',
}: {
    id: string;
    glow: number;
    blur: number;
    bounds: { x: string; y: string; width: string; height: string };
    profile?: SurfaceEffectsFilterProfile;
}) {
    if (glow <= 0 && blur <= 0) {
        return null;
    }

    if (profile === 'layered-aura' && glow > 0) {
        const normalizedGlow = glow / 100;
        const effectiveBlur = Math.max(blur, 0.35);
        const strongGlowBoost = Math.max(0, normalizedGlow - 0.55);
        const coreBlur = Number((
            effectiveBlur
            + (normalizedGlow * 0.65)
            + (Math.pow(strongGlowBoost, 1.35) * 2.4)
        ).toFixed(2));
        const auraBlur = Number((
            effectiveBlur
            + 1
            + (Math.pow(normalizedGlow, 1.4) * 4.75)
            + (Math.pow(strongGlowBoost, 1.6) * 10.5)
        ).toFixed(2));
        const coreAlpha = Number((
            1.05
            + (normalizedGlow * 0.95)
            + (Math.pow(strongGlowBoost, 1.25) * 0.42)
        ).toFixed(2));
        const auraAlpha = Number((
            0.08
            + (Math.pow(normalizedGlow, 1.3) * 0.72)
            + (Math.pow(strongGlowBoost, 1.45) * 0.42)
        ).toFixed(2));

        return (
            <filter id={id} x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height}>
                <feGaussianBlur in="SourceGraphic" stdDeviation={coreBlur} result="surface-core-blur" />
                <feColorMatrix
                    in="surface-core-blur"
                    result="surface-core-glow"
                    type="matrix"
                    values={`1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 ${coreAlpha} 0`}
                />
                <feGaussianBlur in="SourceGraphic" stdDeviation={auraBlur} result="surface-aura-blur" />
                <feColorMatrix
                    in="surface-aura-blur"
                    result="surface-aura-glow"
                    type="matrix"
                    values={`1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 ${auraAlpha} 0`}
                />
                <feMerge result="surface-glow">
                    <feMergeNode in="surface-aura-glow" />
                    <feMergeNode in="surface-core-glow" />
                </feMerge>
                <feComposite in="SourceGraphic" in2="surface-glow" operator="over" />
            </filter>
        );
    }

    return (
        <filter id={id} x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height}>
            <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="surface-blur" />
            <feColorMatrix
                in="surface-blur"
                result="surface-glow"
                type="matrix"
                values={`1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 ${1 + (glow / 100)} 0`}
            />
            <feComposite in="SourceGraphic" in2="surface-glow" operator="over" />
        </filter>
    );
}

function createSummaryTopCapSegment({
    bar,
    dashArray,
    dashOffset,
    strokeWidth,
}: {
    bar: ActivityAnalyticsSummarySegmentBar;
    dashArray: string;
    dashOffset: number;
    strokeWidth: number;
}) {
    const visibleLength = Number.parseFloat(dashArray.split(' ')[0] ?? '0');

    if (!Number.isFinite(visibleLength) || visibleLength <= 0) {
        return null;
    }

    const capLength = Math.min(
        Math.max(strokeWidth * SUMMARY_DONUT_TOP_CAP_LENGTH_MULTIPLIER, SUMMARY_DONUT_TOP_CAP_MIN_LENGTH),
        visibleLength,
    );

    return {
        key: bar.key as ActivityAnalyticsGradientStateKey,
        dashArray: `${capLength} 9999`,
        dashOffset: dashOffset - Math.max(visibleLength - capLength, 0),
        strokeWidth,
    };
}

function renderSummaryTopCapGlowStack({
    centerX,
    centerY,
    radius,
    gradientPrefix,
    segment,
    frame,
    filterId,
    solidColor,
    highlightColor,
}: {
    centerX: number;
    centerY: number;
    radius: number;
    gradientPrefix: string;
    segment: {
        key: ActivityAnalyticsGradientStateKey;
        dashArray: string;
        dashOffset: number;
        strokeWidth: number;
    };
    frame: {
        auraOpacity: number;
        auraFillOpacity: number;
        auraRadius: number;
        haloOpacity: number;
        haloFillOpacity: number;
        haloRadius: number;
        coreOpacity: number;
        coreRadius: number;
    };
    filterId: string;
    solidColor: string;
    highlightColor: string;
}) {
    const auraStrokeWidth = Number((segment.strokeWidth + ((frame.auraRadius - frame.coreRadius) * 0.9)).toFixed(2));
    const haloStrokeWidth = Number((segment.strokeWidth + ((frame.haloRadius - frame.coreRadius) * 1.05)).toFixed(2));
    const coreStrokeWidth = Number((segment.strokeWidth + Math.max(frame.coreRadius - 1.8, 0)).toFixed(2));
    const coreHighlightStrokeWidth = Number((Math.max(segment.strokeWidth * 0.38, 1.2)).toFixed(2));
    const coreStrokeOpacity = Number((0.6 + (Math.max(frame.coreOpacity - 0.62, 0) * 0.24)).toFixed(3));
    const auraStrokeOpacity = Number(Math.min(frame.auraFillOpacity + 0.12, 0.52).toFixed(3));
    const haloStrokeOpacity = Number(Math.min(frame.haloFillOpacity + 0.16, 0.72).toFixed(3));
    const coreHighlightOpacity = Number(Math.min(0.82 + (Math.max(frame.coreOpacity - 0.78, 0) * 0.22), 0.96).toFixed(3));

    return (
        <>
            <circle
                cx={centerX}
                cy={centerY}
                r={radius}
                fill="none"
                stroke={`url(#${gradientPrefix}-${segment.key}-top-cap-gradient)`}
                strokeWidth={auraStrokeWidth}
                strokeDasharray={segment.dashArray}
                strokeDashoffset={segment.dashOffset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${centerX} ${centerY})`}
                opacity={frame.auraOpacity}
                strokeOpacity={auraStrokeOpacity}
                filter={`url(#${filterId})`}
                data-testid="activity-analytics-summary-top-cap-aura"
            />
            <circle
                cx={centerX}
                cy={centerY}
                r={radius}
                fill="none"
                stroke={`url(#${gradientPrefix}-${segment.key}-top-cap-gradient)`}
                strokeWidth={haloStrokeWidth}
                strokeDasharray={segment.dashArray}
                strokeDashoffset={segment.dashOffset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${centerX} ${centerY})`}
                opacity={frame.haloOpacity}
                strokeOpacity={haloStrokeOpacity}
                filter={`url(#${filterId})`}
                data-testid="activity-analytics-summary-top-cap-halo"
            />
            <circle
                cx={centerX}
                cy={centerY}
                r={radius}
                fill="none"
                stroke={`url(#${gradientPrefix}-${segment.key}-top-cap-gradient)`}
                strokeWidth={coreStrokeWidth}
                strokeDasharray={segment.dashArray}
                strokeDashoffset={segment.dashOffset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${centerX} ${centerY})`}
                opacity={frame.coreOpacity}
                strokeOpacity={1}
                data-testid="activity-analytics-summary-top-cap-core"
            />
            <circle
                cx={centerX}
                cy={centerY}
                r={radius}
                fill="none"
                stroke={highlightColor}
                strokeWidth={coreHighlightStrokeWidth}
                strokeDasharray={segment.dashArray}
                strokeDashoffset={segment.dashOffset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${centerX} ${centerY})`}
                opacity={coreHighlightOpacity}
                strokeOpacity={1}
                data-testid="activity-analytics-summary-top-cap-core-highlight"
            />
            <circle
                cx={centerX}
                cy={centerY}
                r={radius}
                fill="none"
                stroke={solidColor}
                strokeWidth={Math.max(segment.strokeWidth, 1.15)}
                strokeDasharray={segment.dashArray}
                strokeDashoffset={segment.dashOffset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${centerX} ${centerY})`}
                opacity={frame.coreOpacity}
                strokeOpacity={coreStrokeOpacity}
                data-testid="activity-analytics-summary-top-cap-core-stroke"
            />
        </>
    );
}

function renderGroupedTopCapGlowStack({
    gradientPrefix,
    segment,
    frame,
    filterId,
    solidColor,
    highlightColor,
}: {
    gradientPrefix: string;
    segment: {
        key: ActivityAnalyticsGradientStateKey;
        x: number;
        y: number;
        width: number;
        height: number;
    };
    frame: {
        auraOpacity: number;
        auraFillOpacity: number;
        auraRadius: number;
        haloOpacity: number;
        haloFillOpacity: number;
        haloRadius: number;
        coreOpacity: number;
        coreRadius: number;
    };
    filterId: string;
    solidColor: string;
    highlightColor: string;
}) {
    const auraInsetX = Math.max((frame.auraRadius - frame.coreRadius) * 0.45, 0);
    const auraHeight = Number((segment.height + ((frame.auraRadius - frame.coreRadius) * 0.9)).toFixed(2));
    const haloInsetX = Math.max((frame.haloRadius - frame.coreRadius) * 0.38, 0);
    const haloHeight = Number((segment.height + ((frame.haloRadius - frame.coreRadius) * 1.05)).toFixed(2));
    const coreHeight = Number((segment.height + Math.max(frame.coreRadius - 1.8, 0)).toFixed(2));
    const coreHighlightHeight = Number(Math.max(segment.height * 0.38, 1.2).toFixed(2));
    const coreStrokeOpacity = Number((0.6 + (Math.max(frame.coreOpacity - 0.62, 0) * 0.24)).toFixed(3));
    const auraFillOpacity = Number(Math.min(frame.auraFillOpacity + 0.12, 0.52).toFixed(3));
    const haloFillOpacity = Number(Math.min(frame.haloFillOpacity + 0.16, 0.72).toFixed(3));
    const coreHighlightOpacity = Number(Math.min(0.82 + (Math.max(frame.coreOpacity - 0.78, 0) * 0.22), 0.96).toFixed(3));
    const centeredRectY = (targetHeight: number) => Number((segment.y - ((targetHeight - segment.height) / 2)).toFixed(2));
    const centeredRectX = (insetX: number) => Number((segment.x - insetX).toFixed(2));
    const expandedWidth = (insetX: number) => Number((segment.width + (insetX * 2)).toFixed(2));
    const topCapGradientId = `${gradientPrefix}-${segment.key}-group-top-cap-gradient`;

    return (
        <>
            <rect
                x={centeredRectX(auraInsetX)}
                y={centeredRectY(auraHeight)}
                width={expandedWidth(auraInsetX)}
                height={auraHeight}
                rx={0}
                fill={`url(#${topCapGradientId})`}
                opacity={frame.auraOpacity}
                fillOpacity={auraFillOpacity}
                filter={`url(#${filterId})`}
                data-testid="activity-analytics-group-current-top-cap-aura"
            />
            <rect
                x={centeredRectX(haloInsetX)}
                y={centeredRectY(haloHeight)}
                width={expandedWidth(haloInsetX)}
                height={haloHeight}
                rx={0}
                fill={`url(#${topCapGradientId})`}
                opacity={frame.haloOpacity}
                fillOpacity={haloFillOpacity}
                filter={`url(#${filterId})`}
                data-testid="activity-analytics-group-current-top-cap-halo"
            />
            <rect
                x={segment.x}
                y={centeredRectY(coreHeight)}
                width={segment.width}
                height={coreHeight}
                rx={0}
                fill={`url(#${topCapGradientId})`}
                opacity={frame.coreOpacity}
                data-testid="activity-analytics-group-current-top-cap-core"
            />
            <rect
                x={segment.x}
                y={centeredRectY(coreHighlightHeight)}
                width={segment.width}
                height={coreHighlightHeight}
                rx={0}
                fill={highlightColor}
                opacity={coreHighlightOpacity}
                data-testid="activity-analytics-group-current-top-cap-core-highlight"
            />
            <rect
                x={segment.x}
                y={segment.y}
                width={segment.width}
                height={segment.height}
                rx={0}
                fill={solidColor}
                opacity={frame.coreOpacity}
                fillOpacity={coreStrokeOpacity}
                data-testid="activity-analytics-group-current-top-cap-core-stroke"
            />
        </>
    );
}

function resolveSummaryTravelingTopCapFrame({
    renderedSegments,
    cycleKey,
    progress,
    ringThickness,
    prodRingThickness,
}: {
    renderedSegments: ReturnType<typeof buildActivityAnalyticsSummarySegments>;
    cycleKey: number;
    progress: number;
    ringThickness: number;
    prodRingThickness: number;
}) {
    if (renderedSegments.length === 0) {
        return null;
    }

    const route = resolveSummaryTravelingTopCapRoute(
        renderedSegments,
        cycleKey,
        progress,
        ringThickness,
        prodRingThickness,
    );

    if (route === null) {
        return null;
    }

    const {
        segment,
        routeIndex,
        routeStep,
        routeCount,
        direction,
        segmentStart,
        segmentEnd,
        localProgress,
    } = route;
    const { baseStrokeWidth, capLength } = route;
    const travelStart = direction === 'forward'
        ? segmentStart
        : Math.max(segmentEnd - capLength, segmentStart);
    const travelEnd = direction === 'forward'
        ? Math.max(segmentEnd - capLength, segmentStart)
        : segmentStart;
    const capStartDistance = travelStart + ((travelEnd - travelStart) * localProgress);

    return {
        key: segment.bar.key as ActivityAnalyticsGradientStateKey,
        dashArray: `${capLength} 9999`,
        dashOffset: -capStartDistance,
        strokeWidth: Number((baseStrokeWidth * SUMMARY_DONUT_TRAVELING_TOP_CAP_THICKNESS_MULTIPLIER).toFixed(2)),
        direction,
        routeStep,
        routeCount,
        routeIndex,
        frame: resolveSummaryTopCapGlowFrame(localProgress),
    };
}

function resolveGroupedTravelingTopCapFrame({
    bucket,
    renderedSegments,
    x,
    barWidth,
    plotHeight,
    plotTop,
    maxDurationMs,
    cycleKey,
    progress,
}: {
    bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number];
    renderedSegments: ReadonlyArray<{ key: string; y: number; height: number }>;
    x: number;
    barWidth: number;
    plotHeight: number;
    plotTop: number;
    maxDurationMs: number;
    cycleKey: number;
    progress: number;
}) {
    const trackDurationMs = bucket.expectedDurationMs > 0
        ? bucket.expectedDurationMs
        : resolveGroupedChartDomainDurationMs(bucket);
    const trackHeight = Math.max((trackDurationMs / maxDurationMs) * plotHeight, 0);

    if (trackHeight <= 0) {
        return null;
    }

    const trackY = plotTop + plotHeight - trackHeight;
    const key = resolveGroupedTravelingTopCapStateKey(renderedSegments);
    const height = Math.min(
        GROUPED_MOVING_TOP_CAP_HEIGHT_PX,
        trackHeight,
    );
    const travelDistance = Math.max(trackHeight - height, 0);
    const localProgress = clamp(progress, 0, 1);
    const y = Number((trackY + ((1 - localProgress) * travelDistance)).toFixed(2));

    return {
        key,
        x,
        y,
        width: barWidth,
        height: Number(height.toFixed(2)),
        trackY: Number(trackY.toFixed(2)),
        trackHeight: Number(trackHeight.toFixed(2)),
        frame: resolveSummaryTopCapGlowFrame(clamp((cycleKey % 2 === 0 ? progress : 1 - progress), 0, 1)),
    };
}

function resolveGroupedTravelingTopCapStateKey(renderedSegments: ReadonlyArray<{ key: string; height: number }>): ActivityAnalyticsGradientStateKey {
    const topVisibleSegment = [...renderedSegments]
        .reverse()
        .find((segment) => segment.key !== 'noData' && segment.height > 0);

    if (topVisibleSegment?.key === 'setup' || topVisibleSegment?.key === 'stopped' || topVisibleSegment?.key === 'prod') {
        return topVisibleSegment.key;
    }

    return 'prod';
}

// eslint-disable-next-line react-refresh/only-export-components -- test-only helper kept colocated with the widget renderer
export function resolveSummaryTravelingTopCapRoute(
    renderedSegments: ReturnType<typeof buildActivityAnalyticsSummarySegments>,
    cycleKey: number,
    progress: number,
    ringThickness: number,
    prodRingThickness: number,
) {
    const visibleSegments = renderedSegments
        .map((segment, index) => {
            const visibleLength = parseSummaryVisibleStrokeLength(segment.dashArray);

            if (!Number.isFinite(visibleLength) || visibleLength <= 0) {
                return null;
            }

            const segmentStart = Math.max(0, -segment.dashOffset);
            const baseStrokeWidth = segment.bar.key === 'prod' ? prodRingThickness : ringThickness;
            const capLength = Math.min(
                Math.max(baseStrokeWidth * SUMMARY_DONUT_TRAVELING_TOP_CAP_LENGTH_MULTIPLIER, SUMMARY_DONUT_TOP_CAP_MIN_LENGTH),
                visibleLength,
            );
            const travelLength = Math.max(visibleLength - capLength, 0);

            return {
                segment,
                routeIndex: index,
                visibleLength,
                baseStrokeWidth,
                capLength,
                travelLength,
                progressWeight: travelLength > 0 ? travelLength : visibleLength,
                segmentStart,
                segmentEnd: segmentStart + visibleLength,
            };
        })
        .filter((segment): segment is NonNullable<typeof segment> => segment !== null);

    if (visibleSegments.length === 0) {
        return null;
    }

    const normalizedCycleKey = Math.max(Math.trunc(cycleKey), 0);
    const routeCount = visibleSegments.length;
    const normalizedProgress = clamp(progress, 0, 1);
    const anchorIndex = resolveDeterministicSegmentIndex(normalizedCycleKey, routeCount);
    const routeStride = resolveSummaryTravelingRouteStride(routeCount, normalizedCycleKey);
    const orderedRouteSegments = Array.from({ length: routeCount }, (_, routeStep) => {
        const selectedVisibleIndex = routeCount > 1
            ? (anchorIndex + (routeStep * routeStride)) % routeCount
            : anchorIndex;

        return visibleSegments[selectedVisibleIndex];
    });
    const totalProgressWeight = orderedRouteSegments.reduce((total, segment) => total + segment.progressWeight, 0);
    let accumulatedProgress = 0;
    const routedSegments = orderedRouteSegments.map((segment, routeStep) => {
        const intervalLength = totalProgressWeight <= 0
            ? 1 / routeCount
            : segment.progressWeight / totalProgressWeight;
        const stepProgressStart = accumulatedProgress;
        const stepProgressEnd = routeStep === routeCount - 1
            ? 1
            : accumulatedProgress + intervalLength;
        accumulatedProgress = stepProgressEnd;

        return {
            ...segment,
            routeStep,
            stepProgressStart,
            stepProgressEnd,
        };
    });
    const selectedRoute = routedSegments.find((segment) => normalizedProgress < segment.stepProgressEnd) ?? routedSegments.at(-1);

    if (!selectedRoute) {
        return null;
    }

    const localProgress = clamp(
        (normalizedProgress - selectedRoute.stepProgressStart)
        / Math.max(selectedRoute.stepProgressEnd - selectedRoute.stepProgressStart, Number.EPSILON),
        0,
        1,
    );
    const direction = (normalizedCycleKey + selectedRoute.routeStep) % 2 === 0 ? 'forward' : 'reverse';

    return {
        ...selectedRoute,
        routeCount,
        localProgress,
        direction,
    };
}

function resolveDeterministicSegmentIndex(cycleKey: number, segmentCount: number) {
    if (segmentCount <= 1) {
        return 0;
    }

    const hashedCycleKey = (Math.imul(cycleKey + 1, 1103515245) + 12345) >>> 0;

    return hashedCycleKey % segmentCount;
}

function resolveSummaryTravelingRouteStride(segmentCount: number, cycleKey: number) {
    if (segmentCount <= 2) {
        return 1;
    }

    const preferredStride = Math.floor(segmentCount / 2) + 1 + (Math.max(Math.trunc(cycleKey), 0) % Math.max(segmentCount - 2, 1));

    for (let offset = 0; offset < segmentCount; offset += 1) {
        const candidate = ((preferredStride + offset - 1) % (segmentCount - 1)) + 1;

        if (greatestCommonDivisor(candidate, segmentCount) === 1) {
            return candidate;
        }
    }

    return 1;
}

function greatestCommonDivisor(a: number, b: number): number {
    let left = Math.abs(Math.trunc(a));
    let right = Math.abs(Math.trunc(b));

    while (right !== 0) {
        const remainder = left % right;
        left = right;
        right = remainder;
    }

    return Math.max(left, 1);
}

function resolveSummaryTopCapGlowFrame(progress: number) {
    const trendFrame = resolveProdTrendTravelingGlowFrame([{ x: 0, y: 0 }, { x: 1, y: 0 }], progress);

    return trendFrame ?? resolveSummaryStaticTopCapGlowFrame();
}

function resolveSummaryStaticTopCapGlowFrame() {
    return resolveProdTrendTravelingGlowFrame([{ x: 0, y: 0 }, { x: 1, y: 0 }], 0.72) ?? {
        x: 0,
        y: 0,
        auraOpacity: 0.34,
        auraFillOpacity: 0.3,
        auraRadius: 13.75,
        haloOpacity: 0.7,
        haloFillOpacity: 0.48,
        haloRadius: 8.9,
        coreOpacity: 1,
        coreRadius: 3.05,
    };
}

function parseSummaryVisibleStrokeLength(dashArray: string) {
    return Number.parseFloat(dashArray.split(' ')[0] ?? '0');
}

function resolveGroupedVisibleDurationMs(bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number]) {
    return bucket.durationsMs.prod + bucket.durationsMs.setup + bucket.durationsMs.stopped + bucket.durationsMs.noData;
}

function buildGroupedTooltipSeries(
    bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number],
    visualPalette: ActivityAnalyticsVisualPalette,
): ChartTooltipSeries[] {
    const observedDurationMs = bucket.durationsMs.prod + bucket.durationsMs.setup + bucket.durationsMs.stopped;
    const visibleDurationMs = observedDurationMs + bucket.durationsMs.noData;

    return [
        {
            name: 'Detenida',
            value: formatPercentRatio(bucket.durationsMs.stopped, observedDurationMs),
            color: visualPalette.stopped.initialSolid,
            shape: 'square',
        },
        {
            name: 'Setup',
            value: formatPercentRatio(bucket.durationsMs.setup, observedDurationMs),
            color: visualPalette.setup.initialSolid,
            shape: 'square',
        },
        {
            name: 'Prod.',
            value: formatPercentRatio(bucket.durationsMs.prod, observedDurationMs),
            color: visualPalette.prod.initialSolid,
            shape: 'square',
        },
        {
            name: 'Cobertura incompleta',
            value: formatPercentRatio(bucket.durationsMs.noData, visibleDurationMs),
            color: visualPalette.noData.solid,
            shape: 'square',
        },
    ];
}

function buildProdTrendTooltipSeries(
    bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number],
    visualPalette: ActivityAnalyticsVisualPalette,
): ChartTooltipSeries[] {
    return [{
        name: 'Prod.',
        value: resolveGroupedVisibleProductivityLabel(bucket),
        color: visualPalette.prod.initialSolid,
        shape: 'square',
    }];
}

function resolveGroupedTooltipLabel(label: string) {
    return label.replace(/\(\s*en curso\s*\)/i, '(en curso)');
}

function resolveGroupedVisibleProductivityLabel(bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number]) {
    const productivityRatio = resolveGroupedVisibleProductivityRatio(bucket);

    if (productivityRatio !== null) {
        return formatPercent(productivityRatio);
    }

    return bucket.productivityLabel;
}

function resolveGroupedVisibleProductivityRatio(bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number]) {
    if (bucket.coverageRatio < 1) {
        const comparableProductivityRatio = resolveActivityAnalyticsComparableProductivityRatio(bucket);
        const productiveDurationMs = bucket.durationsMs.prod + bucket.durationsMs.setup + bucket.durationsMs.stopped;

        if (comparableProductivityRatio !== null) {
            return clamp(comparableProductivityRatio, 0, 1);
        }

        if (productiveDurationMs > 0) {
            return clamp(bucket.durationsMs.prod / productiveDurationMs, 0, 1);
        }
    }

    const resolvedProductivityRatio = bucket.productivityRatio ?? parsePercentLabel(bucket.productivityLabel);

    return resolvedProductivityRatio === null ? null : clamp(resolvedProductivityRatio, 0, 1);
}

function resolveGroupedChartDomainDurationMs(bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number]) {
    const visibleDurationMs = resolveGroupedVisibleDurationMs(bucket);

    if (bucket.isInProgress) {
        return Math.max(bucket.expectedDurationMs, visibleDurationMs, 1);
    }

    return Math.max(visibleDurationMs, bucket.expectedDurationMs > 0 && visibleDurationMs <= 0 ? bucket.expectedDurationMs : 0, 1);
}

function isTurnoSummaryBucket(bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number]) {
    return bucket.bucketKey.startsWith('turno-summary:');
}

function resolveTurnoDisplayComparison(
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'],
): ReturnType<typeof computeActivityAnalytics>['comparison'] {
    return grouped.some(isTurnoSummaryBucket)
        ? resolveTurnoSummaryVisibleComparison(grouped)
        : resolveActivityAnalyticsComparison(grouped);
}

function resolveTurnoSummaryVisibleComparison(
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'],
): ReturnType<typeof computeActivityAnalytics>['comparison'] {
    const comparableBuckets = grouped
        .map((bucket) => ({
            bucket,
            visibleProductivityRatio: isTurnoSummaryBucket(bucket)
                && bucket.isInProgress !== true
                && bucket.hasInProgressContribution !== true
                ? resolveGroupedVisibleProductivityRatio(bucket)
                : null,
        }))
        .filter((entry) => entry.visibleProductivityRatio !== null);

    if (comparableBuckets.length < 2) {
        return {
            best: { bucketKey: 'best', label: COMPARISON_FALLBACK_LABEL },
            worst: { bucketKey: 'worst', label: COMPARISON_FALLBACK_LABEL },
        };
    }

    const sorted = [...comparableBuckets].sort(
        (left, right) => (right.visibleProductivityRatio ?? 0) - (left.visibleProductivityRatio ?? 0),
    );
    const best = sorted[0]?.bucket;
    const worst = sorted[sorted.length - 1]?.bucket;
    const bestVisibleRatio = sorted[0]?.visibleProductivityRatio ?? null;
    const worstVisibleRatio = sorted[sorted.length - 1]?.visibleProductivityRatio ?? null;

    if (!best || !worst || bestVisibleRatio === null || worstVisibleRatio === null || bestVisibleRatio === worstVisibleRatio) {
        return {
            best: { bucketKey: 'best', label: COMPARISON_FALLBACK_LABEL },
            worst: { bucketKey: 'worst', label: COMPARISON_FALLBACK_LABEL },
        };
    }

    return {
        best: { bucketKey: best.bucketKey, label: best.label },
        worst: { bucketKey: worst.bucketKey, label: worst.label },
    };
}

function resolveGroupedTrendProductivityRatio(bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number] | null | undefined) {
    if (!bucket) {
        return null;
    }

    const resolvedProductivityRatio = resolveGroupedVisibleProductivityRatio(bucket);

    if (resolvedProductivityRatio !== null) {
        return resolvedProductivityRatio;
    }

    const observedDurationMs = bucket.durationsMs.prod + bucket.durationsMs.setup + bucket.durationsMs.stopped;

    if (observedDurationMs > 0) {
        return clamp(bucket.durationsMs.prod / observedDurationMs, 0, 1);
    }

    return null;
}

function isTurnoVisualHiddenBucket(bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number]) {
    const normalizedBucketKey = bucket.bucketKey.toLocaleLowerCase('en-US');

    return normalizedBucketKey.startsWith('sin-turno:') || normalizedBucketKey === 'turno-summary:sin-turno';
}

function buildTurnoSummaryBuckets(
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'],
    shifts: ShiftDefinition[],
) {
    const shiftBuckets = new Map<string, {
        bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number];
        sortOrder: number;
    }>();
    const shiftOrderById = new Map(shifts.map((shift, index) => [shift.id, index]));
    const shiftLabelById = new Map(shifts.map((shift) => [shift.id, shift.label.trim()]));
    let fallbackSortOrder = shifts.length;

    for (const bucket of grouped) {
        const turnoIdentity = resolveTurnoSummaryIdentity({
            bucket,
            shiftOrderById,
            shiftLabelById,
            fallbackSortOrder,
        });

        if (!turnoIdentity) {
            continue;
        }

        fallbackSortOrder = turnoIdentity.nextFallbackSortOrder;

        const current = shiftBuckets.get(turnoIdentity.key);

        if (!current) {
            shiftBuckets.set(turnoIdentity.key, {
                bucket: {
                    ...bucket,
                    bucketKey: `turno-summary:${turnoIdentity.key}`,
                    label: turnoIdentity.label,
                    isInProgress: false,
                    hasInProgressContribution: bucket.isInProgress,
                },
                sortOrder: turnoIdentity.sortOrder,
            });
            continue;
        }

        const currentBucket = current.bucket;
        const durationsMs = {
            prod: currentBucket.durationsMs.prod + bucket.durationsMs.prod,
            setup: currentBucket.durationsMs.setup + bucket.durationsMs.setup,
            stopped: currentBucket.durationsMs.stopped + bucket.durationsMs.stopped,
            noData: currentBucket.durationsMs.noData + bucket.durationsMs.noData,
        };
        const expectedDurationMs = currentBucket.expectedDurationMs + bucket.expectedDurationMs;
        const coverageRatio = expectedDurationMs > 0
            ? Math.min((durationsMs.prod + durationsMs.setup + durationsMs.stopped) / expectedDurationMs, 1)
            : 0;
        const productiveDurationMs = durationsMs.prod + durationsMs.setup + durationsMs.stopped;
        const productivityRatio = coverageRatio < 1 || productiveDurationMs <= 0
            ? null
            : durationsMs.prod / productiveDurationMs;

        shiftBuckets.set(turnoIdentity.key, {
            ...current,
            bucket: {
                ...currentBucket,
                label: turnoIdentity.label,
                durationsMs,
                estimatedKwh: currentBucket.estimatedKwh + bucket.estimatedKwh,
                stopCount: currentBucket.stopCount + bucket.stopCount,
                startMs: Math.min(currentBucket.startMs, bucket.startMs),
                endMs: Math.max(currentBucket.endMs, bucket.endMs),
                expectedDurationMs,
                coverageRatio,
                utilizationRatio: productiveDurationMs <= 0 ? 0 : durationsMs.prod / productiveDurationMs,
                productivityRatio,
                productivityLabel: coverageRatio < 1
                    ? INCOMPLETE_COVERAGE_LABEL
                    : productivityRatio === null
                        ? 'sin datos'
                        : formatPercent(productivityRatio),
                isInProgress: false,
                hasInProgressContribution: currentBucket.hasInProgressContribution === true || bucket.isInProgress,
            },
        });
    }

    return Array.from(shiftBuckets.values())
        .sort((left, right) => left.sortOrder - right.sortOrder || left.bucket.startMs - right.bucket.startMs)
        .map((entry) => entry.bucket);
}

function resolveTurnoSummaryIdentity(options: {
    bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number];
    shiftOrderById: Map<string, number>;
    shiftLabelById: Map<string, string>;
    fallbackSortOrder: number;
}): { key: string; label: string; sortOrder: number; nextFallbackSortOrder: number } | null {
    const { bucket, shiftOrderById, shiftLabelById } = options;
    const shiftId = resolveTurnoShiftId(bucket.bucketKey);

    if (shiftId) {
        const configuredLabel = shiftLabelById.get(shiftId);

        return {
            key: shiftId,
            label: configuredLabel && configuredLabel.length > 0 ? configuredLabel : resolveTurnoSummaryLabel(bucket.label) ?? shiftId,
            sortOrder: shiftOrderById.get(shiftId) ?? options.fallbackSortOrder,
            nextFallbackSortOrder: shiftOrderById.has(shiftId) ? options.fallbackSortOrder : options.fallbackSortOrder + 1,
        };
    }

    if (bucket.bucketKey.startsWith('sin-turno:')) {
        return {
            key: 'sin-turno',
            label: 'sin turno',
            sortOrder: Number.MAX_SAFE_INTEGER,
            nextFallbackSortOrder: options.fallbackSortOrder,
        };
    }

    const fallbackLabel = resolveTurnoSummaryLabel(bucket.label);

    if (!fallbackLabel) {
        return null;
    }

    return {
        key: fallbackLabel.toLocaleLowerCase('es'),
        label: fallbackLabel,
        sortOrder: options.fallbackSortOrder,
        nextFallbackSortOrder: options.fallbackSortOrder + 1,
    };
}

function resolveTurnoShiftId(bucketKey: string): string | null {
    const shiftKeyMatch = bucketKey.match(/^shift:([^:]+):/i);

    return shiftKeyMatch?.[1] ?? null;
}

function resolveTurnoSummaryLabel(label: string): string | null {
    const labelParts = label.split('·').map((part) => part.trim()).filter((part) => part.length > 0);
    const rawTurnoLabel = labelParts.length >= 2
        ? (labelParts.at(-1) ?? '')
        : (/^Turno\s+/i.test(label) ? label : '');
    const normalizedLabel = resolveGroupedAxisLabel(rawTurnoLabel);

    return normalizedLabel.length > 0 ? normalizedLabel : null;
}

function resolveGroupedAxisLabel(label: string): string {
    return label.replace(/\s+\((?:en\s+curso)\)$/i, '').trim();
}

function validateComputedAnalytics(result: ReturnType<typeof computeActivityAnalytics> | null): asserts result is ReturnType<typeof computeActivityAnalytics> {
    if (!result || !Array.isArray(result.grouped)) {
        throw new Error('Activity analytics computation result is invalid');
    }
}

function createRuntimeViewState(displayOptions: ResolvedActivityAnalyticsDisplayOptions): ActivityAnalyticsRuntimeViewState {
    return {
        sourceDisplayKey: createDisplayOptionsSyncKey(displayOptions),
        sourceGroupBy: displayOptions.groupBy,
        selectionOverride: null,
        runtimeGroupBy: null,
        turnoMode: 'summary',
    };
}

function createDisplayOptionsSyncKey(displayOptions: ResolvedActivityAnalyticsDisplayOptions) {
    return `${displayOptions.range}|${displayOptions.start ?? ''}|${displayOptions.end ?? ''}`;
}
