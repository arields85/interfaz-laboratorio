import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AlertTriangle, BarChart2, Loader2, PlugZap } from 'lucide-react';
import { ActivitySeriesAdapterError } from '../../adapters/activitySeries.adapter';
import type { ActivityAnalyticsPersistedDisplayPatch, ActivityAnalyticsWidgetConfig, ShiftDefinition } from '../../domain/admin.types';
import type { ContractMachine } from '../../domain/dataContract.types';
import { isDataActivitySeriesEnabled } from '../../config/dataConnection.config';
import WidgetCenteredContentLayout from '../../components/ui/WidgetCenteredContentLayout';
import ChartHoverLayer from '../../components/ui/ChartHoverLayer';
import ChartTooltip from '../../components/ui/ChartTooltip';
import type { ChartTooltipSeries } from '../../components/ui/ChartTooltip';
import WidgetHeader from '../../components/ui/WidgetHeader';
import WidgetSegmentedControl from '../../components/ui/WidgetSegmentedControl';
import { useTemporalSettings } from '../../hooks/useTemporalSettings';
import { useActivitySeries } from '../../queries/useActivitySeries';
import { DataServiceError } from '../../services/dataOverview.service';
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
import { resolveActivityAnalyticsDisplayOptions } from '../../utils/activityAnalyticsWidgetDefaults';
import { computeVisibleLabelIndices, getChartLetterSpacingPx, getChartTextFont } from '../../utils/chartHelpers';

interface ActivityAnalyticsWidgetProps {
    widget: ActivityAnalyticsWidgetConfig;
    machines?: ContractMachine[];
    isLoadingData?: boolean;
    className?: string;
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

const RANGE_OPTIONS: Array<{ value: ResolvedActivityAnalyticsDisplayOptions['range']; label: string }> = [
    { value: '24h', label: '24h' },
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
    { value: '12m', label: '12m' },
];

const GROUP_BY_OPTIONS: Array<{ value: ResolvedActivityAnalyticsDisplayOptions['groupBy']; label: string }> = [
    { value: 'shift', label: 'Turno' },
    { value: 'day', label: 'Día' },
    { value: 'week', label: 'Semana' },
    { value: 'month', label: 'Mes' },
];

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

const WIDGET_SHELL_CLASS = 'glass-panel group flex h-full w-full flex-col overflow-hidden p-5';
const ANALYTICS_PANEL_CLASS = 'rounded-2xl border border-industrial-border bg-[color:color-mix(in_srgb,var(--color-industrial-hover)_72%,transparent)]';
const ANALYTICS_CARD_CLASS = 'rounded-2xl border border-industrial-border bg-[color:color-mix(in_srgb,var(--color-industrial-surface)_88%,var(--color-industrial-hover))]';
const SUMMARY_BAR_COLORS = {
    prod: 'var(--color-status-normal)',
    setup: 'var(--color-status-warning)',
    stopped: 'var(--color-status-critical)',
    noData: 'var(--color-industrial-muted)',
} as const;
const COMPARISON_PANEL_TARGET_WIDTH_PX = 272;
const SUMMARY_CHART_MIN_WIDTH_PX = 320;
const SUMMARY_CHART_MAX_WIDTH_PX = 440;
const TOP_REGION_STACK_BREAKPOINT_PX = SUMMARY_CHART_MIN_WIDTH_PX + 256 + 16;
const COMPARISON_FALLBACK_LABEL = 'sin comparación';
const INCOMPLETE_COVERAGE_LABEL = 'cobertura incompleta';

export default function ActivityAnalyticsWidget({
    widget,
    machines,
    isLoadingData = false,
    className,
    onPersistDisplayOptions,
}: ActivityAnalyticsWidgetProps) {
    const displayOptions = resolveActivityAnalyticsDisplayOptions(widget.displayOptions);
    const [runtimeViewState, setRuntimeViewState] = useState<ActivityAnalyticsRuntimeViewState>(() => createRuntimeViewState(displayOptions));
    const [analyticsBodySize, setAnalyticsBodySize] = useState<{ width: number; height: number } | null>(null);
    const analyticsBodyRef = useRef<HTMLDivElement | null>(null);
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
    const activeGroupBy = activeDisplayRules.groupBy;
    const forceTurnoDetail = activeGroupBy === 'shift' && activeDisplayRules.range === '24h';
    const showTurnoModeControl = activeGroupBy === 'shift' && activeDisplayRules.range === '7d';
    const activeTurnoMode = forceTurnoDetail
        ? 'detail'
        : activeDisplayRules.turnoDetailEligible ? runtimeViewState.turnoMode : 'summary';

    if (runtimeGroupBy !== null && runtimeGroupBy !== activeGroupBy) {
        setRuntimeViewState((current) => ({
            ...current,
            runtimeGroupBy: activeGroupBy,
            turnoMode: activeDisplayRules.turnoDetailEligible ? current.turnoMode : 'summary',
        }));
    }
    const machineBinding = resolveActivityAnalyticsMachineBinding(widget.binding?.machineId, machines);
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
    }, [activityData, activeDisplayOptions.prodThresholdKw, activeDisplayOptions.setupThresholdKw, activeGroupBy, resolvedTimezone, shifts]);
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
            ? resolveActivityAnalyticsComparison(displayGrouped)
            : computedAnalytics.comparison;
    }, [activeGroupBy, computedAnalytics, displayGrouped]);
    const groupedCount = displayGrouped.length;

    useEffect(() => {
        if (typeof ResizeObserver === 'undefined' || !analyticsBodyRef.current) {
            return undefined;
        }

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];

            if (!entry) {
                return;
            }

            const nextWidth = Math.round(entry.contentRect.width);
            const nextHeight = Math.round(entry.contentRect.height);

            if (nextWidth <= 0 || nextHeight <= 0) {
                return;
            }

            setAnalyticsBodySize((current) => (current?.width === nextWidth && current?.height === nextHeight)
                ? current
                : { width: nextWidth, height: nextHeight });
        });

        observer.observe(analyticsBodyRef.current);

        return () => {
            observer.disconnect();
        };
    }, [groupedCount]);

    const visualLayout = resolveActivityAnalyticsVisualLayout({
        width: analyticsBodySize?.width ?? 640,
        height: analyticsBodySize?.height ?? 420,
        groupCount: groupedCount,
        groupBy: activeGroupBy,
        range: activeDisplayOptions.range,
        turnoMode: activeTurnoMode,
    });

    const header = (
        <WidgetHeader
            title={widget.title ?? 'Análisis de Actividad'}
            icon={BarChart2}
            iconColor="var(--color-widget-icon)"
            iconPosition="right"
            subtitle={machineBinding.selectedMachine?.name ?? 'Activity-Series'}
            className="min-w-0 shrink-0"
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
            setupKw: activeDisplayOptions.setupThresholdKw,
            prodKw: activeDisplayOptions.prodThresholdKw,
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
        return renderStateCard({
            className,
            header,
            ...resolveErrorState(activitySeries.error),
        });
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
        return renderStateCard({
            className,
            header,
            ...resolveProcessingErrorState(error),
        });
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

    return (
        <div className={`${WIDGET_SHELL_CLASS} ${className ?? ''}`}>
            <WidgetSegmentedControl
                options={RANGE_OPTIONS}
                value={activeDisplayOptions.range}
                onChange={(nextRange) => {
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
                }}
            >
                <div
                    data-testid="activity-analytics-runtime-secondary-controls"
                    className="flex max-w-full flex-wrap items-center justify-end gap-2"
                >
                    <div
                        data-testid="activity-analytics-runtime-group-selector"
                        className="flex flex-wrap items-center gap-0.5"
                    >
                        {GROUP_BY_OPTIONS.filter((option) => activeDisplayRules.allowedGroups.includes(option.value)).map((option) => {
                            const isActive = option.value === activeGroupBy;

                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    aria-pressed={isActive}
                                    onClick={() => setRuntimeViewState((current) => ({
                                        ...current,
                                        runtimeGroupBy: option.value,
                                        turnoMode: option.value === 'shift' ? current.turnoMode : 'summary',
                                    }))}
                                    className={getRuntimeControlButtonClass(isActive)}
                                >
                                    {option.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </WidgetSegmentedControl>

            {header}

            <div ref={analyticsBodyRef} className="mt-3 flex min-h-0 flex-1 flex-col gap-4">
                <AnalyticsVisualPanels
                    analytics={computedAnalytics.analytics}
                    comparison={displayComparison}
                    grouped={displayGrouped}
                    visualLayout={visualLayout}
                chartWidth={analyticsBodySize?.width ?? 640}
                showTurnoModeControl={showTurnoModeControl}
                turnoMode={activeTurnoMode}
                onTurnoModeChange={(nextTurnoMode) => setRuntimeViewState((current) => ({ ...current, turnoMode: nextTurnoMode }))}
                emptyMessage={hasHiddenOnlyTurnoGroups
                    ? 'Todos los grupos de esta ventana corresponden a sin turno y se ocultan en esta vista.'
                    : null}
            />
            </div>
        </div>
    );
}

function getRuntimeControlButtonClass(isActive: boolean) {
    return isActive
        ? 'rounded-md border border-admin-accent/30 bg-admin-accent/10 px-2.5 py-1 uppercase text-admin-accent transition-colors'
        : 'rounded-md px-2.5 py-1 uppercase text-industrial-muted transition-colors hover:text-industrial-text';
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
    }

    if (machineId === null) {
        return {
            status: 'invalid' as const,
            machineId: null,
            selectedMachine: undefined,
        };
    }

    const selectedMachine = machines?.find((machine) => machine.unitId === machineId);

    if (machines && selectedMachine === undefined) {
        return {
            status: 'invalid' as const,
            machineId: null,
            selectedMachine: undefined,
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

function renderStateCard({
    className,
    header,
    title,
    message,
    icon,
}: {
    className?: string;
    header: React.ReactNode;
    title: string;
    message: string;
    icon: React.ReactNode;
}) {
    return (
        <div className={`${WIDGET_SHELL_CLASS} ${className ?? ''}`}>
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

const ComparisonPanel = memo(function ComparisonPanel({
    comparison,
    grouped,
}: {
    comparison: ReturnType<typeof computeActivityAnalytics>['comparison'];
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
}) {
    const entries = [
        createComparisonEntry('Mejor', comparison.best, grouped),
        createComparisonEntry('Peor', comparison.worst, grouped),
    ];

    return (
        <div className={`${ANALYTICS_PANEL_CLASS} grid grid-cols-1 gap-2 p-3`} data-testid="activity-analytics-comparison">
            {entries.map((entry) => (
                <ComparisonRow key={entry.heading} entry={entry} />
            ))}
        </div>
    );
});

const AnalyticsVisualPanels = memo(function AnalyticsVisualPanels({
    analytics,
    comparison,
    grouped,
    visualLayout,
    chartWidth,
    showTurnoModeControl,
    turnoMode,
    onTurnoModeChange,
    emptyMessage,
}: {
    analytics: ReturnType<typeof computeActivityAnalytics>['analytics'];
    comparison: ReturnType<typeof computeActivityAnalytics>['comparison'];
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    visualLayout: ActivityAnalyticsVisualLayout;
    chartWidth: number;
    showTurnoModeControl: boolean;
    turnoMode: 'summary' | 'detail';
    onTurnoModeChange: (nextTurnoMode: 'summary' | 'detail') => void;
    emptyMessage: string | null;
}) {
    const stackTopRegion = chartWidth < TOP_REGION_STACK_BREAKPOINT_PX;
    const summaryChartWidth = Math.min(
        chartWidth,
        SUMMARY_CHART_MAX_WIDTH_PX,
        stackTopRegion
            ? chartWidth
            : Math.max(chartWidth - COMPARISON_PANEL_TARGET_WIDTH_PX, SUMMARY_CHART_MIN_WIDTH_PX),
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div
                className={stackTopRegion ? 'flex flex-col gap-4' : 'flex flex-wrap items-start gap-4'}
                data-testid="activity-analytics-top-region"
                data-top-layout={stackTopRegion ? 'stacked' : 'side-by-side'}
            >
                <div className={stackTopRegion ? 'min-w-0' : 'min-w-0 flex-[1.4_1_20rem]'}>
                    <SummaryPanel analytics={analytics} summaryLayout={visualLayout.summary} chartWidth={summaryChartWidth} />
                </div>
                <div className={stackTopRegion ? 'min-w-0' : 'min-w-[16rem] flex-1 basis-[16rem] self-stretch'}>
                    <ComparisonPanel comparison={comparison} grouped={grouped} />
                </div>
            </div>
            <GroupedAnalyticsPanel
                grouped={grouped}
                groupsLayout={visualLayout.groups}
                chartWidth={chartWidth}
                showTurnoModeControl={showTurnoModeControl}
                turnoMode={turnoMode}
                onTurnoModeChange={onTurnoModeChange}
                emptyMessage={emptyMessage}
            />
        </div>
    );
});

const SummaryPanel = memo(function SummaryPanel({
    analytics,
    summaryLayout,
    chartWidth,
}: {
    analytics: ReturnType<typeof computeActivityAnalytics>['analytics'];
    summaryLayout: ActivityAnalyticsSummaryLayout;
    chartWidth: number;
}) {
    const sectionProductivity = analytics.coverageRatio < 1
        ? INCOMPLETE_COVERAGE_LABEL
        : formatPercent(analytics.utilizationRatio);
    const coverageLabel = formatPercent(analytics.coverageRatio);
    const stackedBars = [
        { key: 'stopped', label: 'Detenida', durationMs: analytics.durationsMs.stopped, color: SUMMARY_BAR_COLORS.stopped },
        { key: 'setup', label: 'Setup', durationMs: analytics.durationsMs.setup, color: SUMMARY_BAR_COLORS.setup },
        { key: 'prod', label: 'Prod.', durationMs: analytics.durationsMs.prod, color: SUMMARY_BAR_COLORS.prod },
    ] as const;
    const textFallbackMetrics = [
        { key: 'prod', label: 'Prod.', durationMs: analytics.durationsMs.prod },
        { key: 'setup', label: 'Setup', durationMs: analytics.durationsMs.setup },
        { key: 'stopped', label: 'Detenida', durationMs: analytics.durationsMs.stopped },
    ] as const;

    if (summaryLayout.mode === 'text-fallback') {
        return (
            <div className={`${ANALYTICS_PANEL_CLASS} p-3`} data-testid="activity-analytics-summary-text">
                <PanelHeading title="Resumen" value={`% Prod. ${sectionProductivity} · Cob. ${coverageLabel}`} />
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {textFallbackMetrics.map((metric) => (
                        <TextMetricCard key={metric.key} label={metric.label} durationMs={metric.durationMs} productivityLabel={sectionProductivity} />
                    ))}
                </div>
            </div>
        );
    }

    const chartHeight = summaryLayout.mode === 'compact-axis-bars' ? 224 : 252;

    return (
        <div className={`${ANALYTICS_PANEL_CLASS} flex min-h-0 flex-col p-3`} data-testid="activity-analytics-summary-bars">
            <PanelHeading title="Resumen" value={`% Prod. ${sectionProductivity} · Cob. ${coverageLabel}`} />
            <div className="mt-3" data-testid="activity-analytics-summary-panel">
                <SummaryBarsChart bars={stackedBars} width={chartWidth} height={chartHeight} density={summaryLayout.density} />
            </div>
        </div>
    );
});

const GroupedAnalyticsPanel = memo(function GroupedAnalyticsPanel({
    grouped,
    groupsLayout,
    chartWidth,
    showTurnoModeControl,
    turnoMode,
    onTurnoModeChange,
    emptyMessage,
}: {
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    groupsLayout: ActivityAnalyticsGroupsLayout;
    chartWidth: number;
    showTurnoModeControl: boolean;
    turnoMode: 'summary' | 'detail';
    onTurnoModeChange: (nextTurnoMode: 'summary' | 'detail') => void;
    emptyMessage: string | null;
}) {
    if (grouped.length === 0 && emptyMessage) {
        return (
            <div className={`${ANALYTICS_PANEL_CLASS} flex min-h-0 flex-1 flex-col p-3`} data-testid="activity-analytics-groups">
                <div data-testid="activity-analytics-groups-panel" data-groups-density={groupsLayout.density} className="contents">
                    <PanelHeading title="Grupos" value="0" />
                    {showTurnoModeControl && (
                        <TurnoModeControl turnoMode={turnoMode} onTurnoModeChange={onTurnoModeChange} />
                    )}
                    <div
                        className="mt-3 flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-industrial-border px-4 py-6 text-center text-industrial-muted"
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
            <div className={`${ANALYTICS_PANEL_CLASS} flex min-h-0 flex-1 flex-col p-3`} data-testid="activity-analytics-groups">
                <div data-testid="activity-analytics-groups-panel" data-groups-density={groupsLayout.density} className="contents">
                <PanelHeading title="Grupos" value={String(grouped.length)} />
                {showTurnoModeControl && (
                    <TurnoModeControl turnoMode={turnoMode} onTurnoModeChange={onTurnoModeChange} />
                )}
                <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto hmi-scrollbar pr-1" data-testid="activity-analytics-groups-text">
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

    const chart = <GroupedStackedBarsChart grouped={grouped} width={chartWidth} layout={groupsLayout} />;

    return (
        <div className={`${ANALYTICS_PANEL_CLASS} flex min-h-0 flex-1 flex-col p-3`} data-testid="activity-analytics-groups">
            <div data-testid="activity-analytics-groups-panel" data-groups-density={groupsLayout.density} className="contents">
                <PanelHeading title="Grupos" value={String(grouped.length)} />
                {showTurnoModeControl && (
                    <TurnoModeControl turnoMode={turnoMode} onTurnoModeChange={onTurnoModeChange} />
                )}
                {groupsLayout.density === 'scroll'
                    ? (
                        <div
                            className="mt-3 min-h-0 flex-1 overflow-x-auto overflow-y-hidden hmi-scrollbar pb-2"
                            data-testid="activity-analytics-groups-scroll-region"
                        >
                            {chart}
                        </div>
                    )
                    : <div className="mt-3 min-h-0 flex-1">{chart}</div>}
            </div>
        </div>
    );
});

const TurnoModeControl = memo(function TurnoModeControl({
    turnoMode,
    onTurnoModeChange,
}: {
    turnoMode: 'summary' | 'detail';
    onTurnoModeChange: (nextTurnoMode: 'summary' | 'detail') => void;
}) {
    return (
        <div className="mt-3 flex items-center gap-1" data-testid="activity-analytics-turno-mode">
            <button
                type="button"
                aria-pressed={turnoMode === 'summary'}
                onClick={() => onTurnoModeChange('summary')}
                className={getRuntimeControlButtonClass(turnoMode === 'summary')}
            >
                Resumen
            </button>
            <button
                type="button"
                aria-pressed={turnoMode === 'detail'}
                onClick={() => onTurnoModeChange('detail')}
                className={getRuntimeControlButtonClass(turnoMode === 'detail')}
            >
                Detalle
            </button>
        </div>
    );
});

const PanelHeading = memo(function PanelHeading({ title, value }: { title: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-2 uppercase text-industrial-muted">
            <span style={CHART_TYPOGRAPHY_STYLE}>{title}</span>
            <span style={CHART_TYPOGRAPHY_STYLE}>{value}</span>
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

function formatPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
}

function formatDurationHours(durationMs: number): string {
    return `${(durationMs / (60 * 60 * 1000)).toFixed(1)} h`;
}

function formatHoursTick(durationMs: number): string {
    return `${(durationMs / (60 * 60 * 1000)).toFixed(1)}h`;
}

function SummaryBarsChart({
    bars,
    width,
    height,
    density,
}: {
    bars: ReadonlyArray<{ key: string; label: string; durationMs: number; color: string }>;
    width: number;
    height: number;
    density: ActivityAnalyticsSummaryLayout['density'];
}) {
    const totalDurationMs = Math.max(bars.reduce((total, bar) => total + bar.durationMs, 0), 1);
    const margin = density === 'compress'
        ? { top: 18, right: 12, bottom: 86, left: 50 } as const
        : { top: 18, right: 18, bottom: 92, left: 58 } as const;
    const plotWidth = Math.max(width - margin.left - margin.right, 1);
    const plotHeight = Math.max(height - margin.top - margin.bottom, 1);
    const maxDurationMs = totalDurationMs;
    const barWidth = Math.min(plotWidth * (density === 'compress' ? 0.3 : 0.24), density === 'compress' ? 92 : 104);
    const stackX = margin.left + ((plotWidth - barWidth) / 2);
    const axisTicks = Array.from({ length: 5 }, (_, index) => ({
        value: maxDurationMs - ((maxDurationMs * index) / 4),
        y: margin.top + ((index / 4) * plotHeight),
    }));

    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} data-testid="activity-analytics-summary-chart">
            {axisTicks.map((tick, index) => (
                <g key={`summary-tick-${index}`}>
                    <line x1={margin.left} x2={margin.left + plotWidth} y1={tick.y} y2={tick.y} stroke="var(--color-industrial-border)" strokeDasharray="3 3" opacity={0.65} />
                    <text
                        x={margin.left - 8}
                        y={tick.y}
                        dy={4}
                        textAnchor="end"
                        fill="var(--color-industrial-muted)"
                        style={CHART_TYPOGRAPHY_STYLE}
                        data-testid="activity-analytics-y-axis-tick"
                    >
                        {formatHoursTick(tick.value)}
                    </text>
                </g>
            ))}

            <line x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + plotHeight} stroke="var(--color-industrial-border)" />
            <line x1={margin.left} x2={margin.left + plotWidth} y1={margin.top + plotHeight} y2={margin.top + plotHeight} stroke="var(--color-industrial-border)" />

            <g data-testid="activity-analytics-summary-stack">
                {(() => {
                    let currentY = margin.top + plotHeight;

                    return (
                        <>
                            {bars.map((bar, index) => {
                                const barHeight = (bar.durationMs / maxDurationMs) * plotHeight;
                                currentY -= barHeight;

                                return (
                                    <rect
                                        key={bar.key}
                                        x={stackX}
                                        y={currentY}
                                        width={barWidth}
                                        height={barHeight}
                                        rx={index === bars.length - 1 ? 8 : 0}
                                        fill={bar.color}
                                        opacity={0.92}
                                        data-testid="activity-analytics-summary-segment"
                                    />
                                );
                            })}

                            <text
                                x={stackX + (barWidth / 2)}
                                y={Math.max(currentY - 8, margin.top + 10)}
                                textAnchor="middle"
                                fill="var(--color-industrial-text)"
                                style={TECHNICAL_TYPOGRAPHY_STYLE}
                            >
                                {formatDurationHours(totalDurationMs)}
                            </text>
                            <text
                                x={stackX + (barWidth / 2)}
                                y={margin.top + plotHeight + 20}
                                textAnchor="middle"
                                fill="var(--color-industrial-text)"
                                style={CHART_TYPOGRAPHY_STYLE}
                            >
                                Total
                            </text>
                        </>
                    );
                })()}
            </g>

            {bars.map((bar, index) => {
                const legendX = margin.left + ((index + 0.5) * (plotWidth / bars.length));

                return (
                    <g key={`summary-legend-${bar.key}`} data-testid="activity-analytics-summary-legend-item">
                        <rect
                            x={legendX - 26}
                            y={margin.top + plotHeight + 34}
                            width={10}
                            height={10}
                            rx={3}
                            fill={bar.color}
                            opacity={0.92}
                        />
                        <text
                            x={legendX - 10}
                            y={margin.top + plotHeight + 43}
                            textAnchor="start"
                            fill="var(--color-industrial-text)"
                            style={CHART_TYPOGRAPHY_STYLE}
                        >
                            {bar.label}
                        </text>
                        <text
                            x={legendX}
                            y={margin.top + plotHeight + 59}
                            textAnchor="middle"
                            fill="var(--color-industrial-muted)"
                            style={TECHNICAL_TYPOGRAPHY_STYLE}
                        >
                            {formatDurationHours(bar.durationMs)}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

function GroupedStackedBarsChart({
    grouped,
    width,
    layout,
}: {
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    width: number;
    layout: ActivityAnalyticsGroupsLayout;
}) {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [hoverInfo, setHoverInfo] = useState<{ index: number; x: number } | null>(null);
    const height = layout.density === 'compress' ? 276 : 292;
    const margin = layout.density === 'compress'
        ? { top: 18, right: 12, bottom: 68, left: 50 } as const
        : { top: 18, right: 18, bottom: 76, left: 58 } as const;
    const minimumBucketWidth = layout.minSlotWidthPx;
    const chartWidth = layout.density === 'scroll'
        ? Math.max(width, margin.left + margin.right + (grouped.length * minimumBucketWidth))
        : width;
    const plotWidth = Math.max(chartWidth - margin.left - margin.right, 1);
    const plotHeight = Math.max(height - margin.top - margin.bottom, 1);
    const maxDurationMs = Math.max(...grouped.map((bucket) => bucket.expectedDurationMs), 1);
    const step = plotWidth / Math.max(grouped.length, 1);
    const barWidth = Math.min(step * (layout.density === 'compress' ? 0.7 : 0.56), layout.density === 'compress' ? 48 : 56);
    const axisTicks = Array.from({ length: 5 }, (_, index) => ({
        value: maxDurationMs - ((maxDurationMs * index) / 4),
        y: margin.top + ((index / 4) * plotHeight),
    }));
    const positions = grouped.map((_, index) => margin.left + (step * index) + (step / 2));
    const visibleLabelIndices = layout.sampleLabels
        ? computeVisibleLabelIndices(
            grouped.map((bucket) => bucket.label),
            positions,
            getChartTextFont(),
            8,
            margin.left + plotWidth,
            getChartLetterSpacingPx(),
        )
        : new Set(grouped.map((_, index) => index));

    const handleHoverChange = (index: number | null, x?: number) => {
        setHoveredIndex(index);
        setHoverInfo(index !== null && x !== undefined ? { index, x } : null);
    };

    return (
        <div className="relative h-full min-h-[18.25rem]" style={{ width: `${chartWidth}px` }}>
            <svg width={chartWidth} height={height} viewBox={`0 0 ${chartWidth} ${height}`} data-testid="activity-analytics-groups-chart">
                {axisTicks.map((tick, index) => (
                    <g key={`groups-tick-${index}`}>
                        <line x1={margin.left} x2={margin.left + plotWidth} y1={tick.y} y2={tick.y} stroke="var(--color-industrial-border)" strokeDasharray="3 3" opacity={0.65} />
                        <text x={margin.left - 8} y={tick.y} dy={4} textAnchor="end" fill="var(--color-industrial-muted)" style={CHART_TYPOGRAPHY_STYLE} data-testid="activity-analytics-y-axis-tick">
                            {formatHoursTick(tick.value)}
                        </text>
                    </g>
                ))}

                <line x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + plotHeight} stroke="var(--color-industrial-border)" />
                <line x1={margin.left} x2={margin.left + plotWidth} y1={margin.top + plotHeight} y2={margin.top + plotHeight} stroke="var(--color-industrial-border)" />

                {grouped.map((bucket, index) => {
                    const x = margin.left + (step * index) + ((step - barWidth) / 2);
                    const segments = [
                        { key: 'noData', value: bucket.durationsMs.noData, color: SUMMARY_BAR_COLORS.noData, opacity: 0.5 },
                        { key: 'stopped', value: bucket.durationsMs.stopped, color: SUMMARY_BAR_COLORS.stopped },
                        { key: 'setup', value: bucket.durationsMs.setup, color: SUMMARY_BAR_COLORS.setup },
                        { key: 'prod', value: bucket.durationsMs.prod, color: SUMMARY_BAR_COLORS.prod },
                    ] as const;
                    let currentY = margin.top + plotHeight;

                    return (
                        <g key={bucket.bucketKey} data-testid="activity-analytics-group-stack">
                            {bucket.isInProgress && bucket.expectedDurationMs > 0 && (
                                <rect
                                    x={x}
                                    y={margin.top + plotHeight - ((bucket.expectedDurationMs / maxDurationMs) * plotHeight)}
                                    width={barWidth}
                                    height={(bucket.expectedDurationMs / maxDurationMs) * plotHeight}
                                    rx={8}
                                    fill="none"
                                    stroke="var(--color-industrial-muted)"
                                    strokeDasharray="4 4"
                                    opacity={0.8}
                                    data-testid="activity-analytics-group-partial-outline"
                                />
                            )}
                            {segments.map((segment) => {
                                const segmentHeight = (segment.value / maxDurationMs) * plotHeight;
                                currentY -= segmentHeight;
                                return (
                                    <rect
                                        key={`${bucket.bucketKey}-${segment.key}`}
                                        x={x}
                                        y={currentY}
                                        width={barWidth}
                                        height={segmentHeight}
                                        rx={segment.key === 'prod' ? 8 : 0}
                                        fill={segment.color}
                                        opacity={segment.opacity ?? 0.92}
                                        data-testid="activity-analytics-group-segment"
                                    />
                                );
                            })}

                            <text x={x + (barWidth / 2)} y={margin.top + plotHeight + 20} textAnchor="middle" fill="var(--color-industrial-text)" style={CHART_TYPOGRAPHY_STYLE} data-testid="activity-analytics-group-productivity">
                                {bucket.productivityLabel}
                            </text>
                            {visibleLabelIndices.has(index) && (
                                <text x={x + (barWidth / 2)} y={margin.top + plotHeight + 42} textAnchor="middle" fill="var(--color-industrial-muted)" style={TECHNICAL_TYPOGRAPHY_STYLE}>
                                    {bucket.label}
                                </text>
                            )}
                            <text x={x + (barWidth / 2)} y={Math.max(currentY - 8, margin.top + 10)} textAnchor="middle" fill="var(--color-industrial-text)" style={TECHNICAL_TYPOGRAPHY_STYLE}>
                                {formatDurationHours(resolveGroupedVisibleDurationMs(bucket))}
                            </text>
                        </g>
                    );
                })}

                <ChartHoverLayer
                    dataLength={grouped.length}
                    x0={margin.left + (step / 2)}
                    step={step}
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
                            x: margin.left + (step * hoveredIndex) + (step / 2),
                            top: margin.top,
                            plotHeight,
                            maxDurationMs,
                        })
                        : undefined}
                />
            </svg>

            {hoverInfo && hoverInfo.index < grouped.length && (() => {
                const bucket = grouped[hoverInfo.index];
                const series: ChartTooltipSeries[] = [
                    { name: 'Prod.', value: formatDurationHours(bucket.durationsMs.prod), color: SUMMARY_BAR_COLORS.prod, shape: 'square' },
                    { name: 'Setup', value: formatDurationHours(bucket.durationsMs.setup), color: SUMMARY_BAR_COLORS.setup, shape: 'square' },
                    { name: 'Detenida', value: formatDurationHours(bucket.durationsMs.stopped), color: SUMMARY_BAR_COLORS.stopped, shape: 'square' },
                    { name: 'Sin datos', value: formatDurationHours(bucket.durationsMs.noData), color: SUMMARY_BAR_COLORS.noData, shape: 'square' },
                ];

                return (
                    <ChartTooltip label={bucket.label} series={series} x={hoverInfo.x} containerWidth={chartWidth} />
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
}: {
    bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number];
    x: number;
    top: number;
    plotHeight: number;
    maxDurationMs: number;
}) {
    const scaleY = (value: number) => top + plotHeight - ((value / maxDurationMs) * plotHeight);
    const noDataTop = scaleY(bucket.durationsMs.noData);
    const stoppedTop = scaleY(bucket.durationsMs.noData + bucket.durationsMs.stopped);
    const setupTop = scaleY(bucket.durationsMs.noData + bucket.durationsMs.stopped + bucket.durationsMs.setup);
    const prodTop = scaleY(bucket.durationsMs.noData + bucket.durationsMs.stopped + bucket.durationsMs.setup + bucket.durationsMs.prod);

    return [
        { x, y: noDataTop, color: SUMMARY_BAR_COLORS.noData },
        { x, y: prodTop, color: SUMMARY_BAR_COLORS.prod },
        { x, y: setupTop, color: SUMMARY_BAR_COLORS.setup },
        { x, y: stoppedTop, color: SUMMARY_BAR_COLORS.stopped },
    ];
}

interface ComparisonEntry {
    label: string;
    heading: string;
    metadata: string;
    totalDurationMs: number;
    durationsMs: {
        prod: number;
        setup: number;
        stopped: number;
        noData: number;
    };
    isEmpty: boolean;
}

const ComparisonRow = memo(function ComparisonRow({ entry }: { entry: ComparisonEntry }) {
    const totalDurationMs = Math.max(entry.totalDurationMs, 1);
    const segments = [
        { key: 'noData', value: entry.durationsMs.noData, color: SUMMARY_BAR_COLORS.noData, opacity: 0.5 },
        { key: 'prod', value: entry.durationsMs.prod, color: SUMMARY_BAR_COLORS.prod },
        { key: 'setup', value: entry.durationsMs.setup, color: SUMMARY_BAR_COLORS.setup },
        { key: 'stopped', value: entry.durationsMs.stopped, color: SUMMARY_BAR_COLORS.stopped },
    ] as const;

    return (
        <div className={`${ANALYTICS_CARD_CLASS} rounded-xl p-3`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="uppercase text-industrial-muted" style={CHART_TYPOGRAPHY_STYLE}>{entry.heading}</div>
                    <div className="mt-1 truncate text-industrial-text" style={TECHNICAL_TYPOGRAPHY_STYLE} data-testid="activity-analytics-metric-value">{entry.label}</div>
                    <div className="mt-1 text-industrial-muted" style={CHART_TYPOGRAPHY_STYLE}>{entry.metadata}</div>
                </div>
                {!entry.isEmpty && (
                    <div className="mt-1 flex w-24 overflow-hidden rounded-full border border-industrial-border bg-industrial-hover" aria-hidden="true">
                        {segments.map((segment) => (
                            <div
                                key={`${entry.heading}-${segment.key}`}
                                style={{
                                    width: `${(segment.value / totalDurationMs) * 100}%`,
                                    backgroundColor: segment.color,
                                    minWidth: segment.value > 0 ? '0.375rem' : '0',
                                    height: '0.5rem',
                                    opacity: segment.opacity ?? 0.9,
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
});

function createComparisonEntry(
    heading: 'Mejor' | 'Peor',
    target: { bucketKey: string; label: string } | null | undefined,
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'],
): ComparisonEntry {
    const fallback: ComparisonEntry = {
        heading,
        label: target?.label ?? COMPARISON_FALLBACK_LABEL,
        metadata: COMPARISON_FALLBACK_LABEL,
        totalDurationMs: 0,
        durationsMs: { prod: 0, setup: 0, stopped: 0, noData: 0 },
        isEmpty: true,
    };

    if (!target) {
        return fallback;
    }

    const matchedBucket = grouped.find((bucket) => bucket.bucketKey === target.bucketKey)
        ?? grouped.find((bucket) => bucket.label === target.label);

    const comparableProductivityRatio = matchedBucket
        ? resolveActivityAnalyticsComparableProductivityRatio(matchedBucket)
        : null;

    if (!matchedBucket || comparableProductivityRatio === null) {
        return fallback;
    }

    const totalDurationMs = resolveGroupedVisibleDurationMs(matchedBucket);
    const metadata = matchedBucket.coverageRatio < 1
        ? `Prod. observada ${formatPercent(comparableProductivityRatio)} · Cob. ${formatPercent(matchedBucket.coverageRatio)} · ${formatDurationHours(totalDurationMs)}`
        : `% Prod. ${matchedBucket.productivityLabel} · ${formatDurationHours(totalDurationMs)}`;

    return {
        heading,
        label: matchedBucket.label,
        metadata,
        totalDurationMs,
        durationsMs: {
            prod: matchedBucket.durationsMs.prod,
            setup: matchedBucket.durationsMs.setup,
            stopped: matchedBucket.durationsMs.stopped,
            noData: matchedBucket.durationsMs.noData,
        },
        isEmpty: false,
    };
}

function resolveGroupedVisibleDurationMs(bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number]) {
    return bucket.durationsMs.prod + bucket.durationsMs.setup + bucket.durationsMs.stopped + bucket.durationsMs.noData;
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
    const normalizedLabel = rawTurnoLabel.replace(/\s+\(en curso\)$/i, '').trim();

    return normalizedLabel.length > 0 ? normalizedLabel : null;
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
