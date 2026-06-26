import { memo, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
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
import {
    clampActivityAnalyticsGroupBarWidth,
    resolveActivityAnalyticsDisplayOptions,
    type ResolvedActivityAnalyticsVisualEffects,
} from '../../utils/activityAnalyticsWidgetDefaults';
import { buildActivityAnalyticsSummarySegments, type ActivityAnalyticsSummarySegmentBar } from '../../utils/activityAnalyticsSummarySegments';
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

const WIDGET_VALUE_TEXT_STYLE: CSSProperties = {
    fontFamily: 'var(--font-widget-value-activity-analytics)',
    fontWeight: 'var(--font-weight-widget-value-activity-analytics)',
    fontSize: 'var(--font-size-widget-value-activity-analytics)',
    letterSpacing: 'var(--tracking-widget-value-activity-analytics)',
};

const WIDGET_SHELL_CLASS = 'glass-panel group flex h-full w-full flex-col overflow-hidden p-5';
const ANALYTICS_PANEL_CLASS = 'rounded-2xl border border-industrial-border';
const ANALYTICS_CARD_CLASS = 'rounded-2xl border border-industrial-border';
const NO_DATA_STATE_COLOR = 'var(--color-industrial-muted)';
const ACTIVITY_ANALYTICS_STATE_KEYS = ['prod', 'setup', 'stopped'] as const;
const SUMMARY_CHART_MIN_WIDTH_PX = 320;
const SUMMARY_CHART_MAX_WIDTH_PX = 480;
const ROOT_REM_PX = 16;
const TOP_REGION_COLUMN_GAP_REM = 1;
const TOP_REGION_COLUMN_GAP_PX = TOP_REGION_COLUMN_GAP_REM * ROOT_REM_PX;
const TOP_REGION_GRID_TRACKS = [
    { minWidthRem: 20, fraction: 1.1 },
    { minWidthRem: 16, fraction: 0.9 },
] as const;
const [
    TOP_REGION_SUMMARY_COLUMN,
    TOP_REGION_COMPARISON_COLUMN,
] = TOP_REGION_GRID_TRACKS;
const TOP_REGION_GRID_TEMPLATE_COLUMNS = TOP_REGION_GRID_TRACKS
    .map(({ minWidthRem, fraction }) => `minmax(${minWidthRem}rem,${fraction}fr)`)
    .join(' ');
const TOP_REGION_MIN_TRACK_WIDTH_PX = TOP_REGION_GRID_TRACKS
    .reduce((total, { minWidthRem }) => total + (minWidthRem * ROOT_REM_PX), 0);
const TOP_REGION_SUMMARY_COLUMN_MIN_WIDTH_PX = TOP_REGION_SUMMARY_COLUMN.minWidthRem * ROOT_REM_PX;
const TOP_REGION_SUMMARY_COLUMN_FRACTION = TOP_REGION_SUMMARY_COLUMN.fraction;
const TOP_REGION_COMPARISON_COLUMN_FRACTION = TOP_REGION_COMPARISON_COLUMN.fraction;
const TOP_REGION_TOTAL_COLUMN_FRACTION =
    TOP_REGION_SUMMARY_COLUMN_FRACTION
    + TOP_REGION_COMPARISON_COLUMN_FRACTION;
const TOP_REGION_STACK_BREAKPOINT_PX =
    TOP_REGION_MIN_TRACK_WIDTH_PX
    + (TOP_REGION_COLUMN_GAP_PX * (TOP_REGION_GRID_TRACKS.length - 1));
const COMPARISON_FALLBACK_LABEL = 'sin comparación';
const INCOMPLETE_COVERAGE_LABEL = 'cobertura incompleta';
const SUMMARY_RING_PROD_THICKNESS_MULTIPLIER = 1.5;
const SUMMARY_RING_MIN_THICKNESS = 6;
const SUMMARY_RING_MAX_THICKNESS = 12;
const SUMMARY_DONUT_TOP_CAP_LENGTH_MULTIPLIER = 0.2;
const SUMMARY_DONUT_TOP_CAP_MIN_LENGTH = 1;
type SummaryDetailKey = 'prod' | 'setup' | 'stopped';
type ActivityAnalyticsGradientStateKey = typeof ACTIVITY_ANALYTICS_STATE_KEYS[number];
type ActivityAnalyticsVisualPaletteEntry = Readonly<{
    gradient: readonly [string, string];
    gradientAlpha: readonly [number, number];
    solid: string;
    highlight: string;
    topCapSolid: string;
    topCapHighlight: string;
}>;
type ActivityAnalyticsVisualPalette = Readonly<Record<ActivityAnalyticsGradientStateKey, ActivityAnalyticsVisualPaletteEntry> & {
    noData: Readonly<{
        solid: string;
        highlight: string;
    }>;
}>;
type SummaryDetailRow = Readonly<{
    key: SummaryDetailKey;
    title: 'Producción' | 'Setup' | 'Detenida';
    durationMs: number;
    percentLabel: string;
    hoursLabel: string;
    valueLabel: `${string} - ${string}`;
}>;

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
    const [summaryColumnWidth, setSummaryColumnWidth] = useState<number | null>(null);
    const analyticsBodyRef = useRef<HTMLDivElement | null>(null);
    const summaryColumnRef = useRef<HTMLDivElement | null>(null);
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
    );
    const activeGroupBy = activeDisplayRules.groupBy;
    const showTurnoModeControl = activeGroupBy === 'shift' && activeDisplayRules.range === '7d';
    const activeTurnoMode = activeDisplayRules.turnoDetailEligible ? runtimeViewState.turnoMode : 'summary';

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
            ? resolveActivityAnalyticsComparison(displayGrouped)
            : computedAnalytics.comparison;
    }, [activeGroupBy, computedAnalytics, displayGrouped]);
    const groupedCount = displayGrouped.length;

    useEffect(() => {
        if (typeof ResizeObserver === 'undefined' || !analyticsBodyRef.current) {
            return undefined;
        }

        const analyticsBodyElement = analyticsBodyRef.current;
        const summaryColumnElement = summaryColumnRef.current;

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
                    return;
                }

                if (summaryColumnElement && entry.target === summaryColumnElement) {
                    setSummaryColumnWidth((current) => (current === nextWidth ? current : nextWidth));
                }
            });
        });

        observer.observe(analyticsBodyElement);

        if (summaryColumnElement) {
            observer.observe(summaryColumnElement);
        }

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
            subtitle="Distribución"
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
                    visualPalette={visualPalette}
                    visualEffects={selectedDisplayOptions.visualEffects as ResolvedActivityAnalyticsVisualEffects}
                    visualLayout={visualLayout}
                    chartWidth={analyticsBodySize?.width ?? 640}
                    barWidthFactor={activeDisplayOptions.groupBarWidth}
                    measuredSummaryColumnWidth={summaryColumnWidth}
                    summaryColumnRef={summaryColumnRef}
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
    visualPalette,
}: {
    comparison: ReturnType<typeof computeActivityAnalytics>['comparison'];
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    visualPalette: ActivityAnalyticsVisualPalette;
}) {
    const entries = [
        createComparisonEntry('Mejor', comparison.best, grouped),
        createComparisonEntry('Peor', comparison.worst, grouped),
    ];

    return (
        <div className={`${ANALYTICS_PANEL_CLASS} grid grid-cols-1 gap-2 p-3`} data-testid="activity-analytics-comparison">
            {entries.map((entry) => (
                <ComparisonRow key={entry.heading} entry={entry} visualPalette={visualPalette} />
            ))}
        </div>
    );
});

const AnalyticsVisualPanels = memo(function AnalyticsVisualPanels({
    analytics,
    comparison,
    grouped,
    visualPalette,
    visualEffects,
    visualLayout,
    chartWidth,
    barWidthFactor,
    measuredSummaryColumnWidth,
    summaryColumnRef,
    showTurnoModeControl,
    turnoMode,
    onTurnoModeChange,
    emptyMessage,
}: {
    analytics: ReturnType<typeof computeActivityAnalytics>['analytics'];
    comparison: ReturnType<typeof computeActivityAnalytics>['comparison'];
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    visualPalette: ActivityAnalyticsVisualPalette;
    visualEffects: ResolvedActivityAnalyticsVisualEffects;
    visualLayout: ActivityAnalyticsVisualLayout;
    chartWidth: number;
    barWidthFactor: number;
    measuredSummaryColumnWidth: number | null;
    summaryColumnRef: RefObject<HTMLDivElement | null>;
    showTurnoModeControl: boolean;
    turnoMode: 'summary' | 'detail';
    onTurnoModeChange: (nextTurnoMode: 'summary' | 'detail') => void;
    emptyMessage: string | null;
}) {
    const stackTopRegion = chartWidth < TOP_REGION_STACK_BREAKPOINT_PX;
    const resolvedSummaryColumnWidth = stackTopRegion
        ? chartWidth
        : measuredSummaryColumnWidth ?? resolveTopRegionCenterColumnWidth(chartWidth);
    const summaryChartWidth = Math.min(
        chartWidth,
        SUMMARY_CHART_MAX_WIDTH_PX,
        resolvedSummaryColumnWidth,
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div
                className={stackTopRegion
                    ? 'flex flex-col gap-4'
                    : 'grid items-start gap-4'}
                style={stackTopRegion ? undefined : { gridTemplateColumns: TOP_REGION_GRID_TEMPLATE_COLUMNS }}
                data-testid="activity-analytics-top-region"
                data-top-layout={stackTopRegion ? 'stacked' : 'side-by-side'}
            >
                <div ref={summaryColumnRef} className="min-w-0" data-testid="activity-analytics-summary-column">
                    <SummaryPanel analytics={analytics} summaryLayout={visualLayout.summary} chartWidth={summaryChartWidth} visualPalette={visualPalette} donutEffects={visualEffects.donut} />
                </div>
                <div className="min-w-0 self-stretch">
                    <ComparisonPanel comparison={comparison} grouped={grouped} visualPalette={visualPalette} />
                </div>
            </div>
            <GroupedAnalyticsPanel
                grouped={grouped}
                visualPalette={visualPalette}
                groupedEffects={visualEffects.groupedBars}
                groupsLayout={visualLayout.groups}
                chartWidth={chartWidth}
                barWidthFactor={barWidthFactor}
                showTurnoModeControl={showTurnoModeControl}
                turnoMode={turnoMode}
                onTurnoModeChange={onTurnoModeChange}
                emptyMessage={emptyMessage}
            />
        </div>
    );
});

function resolveTopRegionCenterColumnWidth(containerWidth: number): number {
    const totalGapWidth = TOP_REGION_COLUMN_GAP_PX * (TOP_REGION_GRID_TRACKS.length - 1);
    const availableTrackWidth = Math.max(containerWidth - totalGapWidth, 0);
    const minimumTrackWidth = TOP_REGION_MIN_TRACK_WIDTH_PX;

    if (availableTrackWidth <= minimumTrackWidth) {
        return SUMMARY_CHART_MIN_WIDTH_PX;
    }

    const distributableWidth = availableTrackWidth - minimumTrackWidth;
    const centerColumnWidth = TOP_REGION_SUMMARY_COLUMN_MIN_WIDTH_PX
        + (distributableWidth * (TOP_REGION_SUMMARY_COLUMN_FRACTION / TOP_REGION_TOTAL_COLUMN_FRACTION));

    return Math.max(centerColumnWidth, SUMMARY_CHART_MIN_WIDTH_PX);
}

const SummaryPanel = memo(function SummaryPanel({
    analytics,
    summaryLayout,
    chartWidth,
    visualPalette,
    donutEffects,
}: {
    analytics: ReturnType<typeof computeActivityAnalytics>['analytics'];
    summaryLayout: ActivityAnalyticsSummaryLayout;
    chartWidth: number;
    visualPalette: ActivityAnalyticsVisualPalette;
    donutEffects: ResolvedActivityAnalyticsVisualEffects['donut'];
}) {
    const summaryDisplay = createSummaryDisplayModel(analytics, visualPalette);
    const coverageSummary = `Cobertura ${summaryDisplay.coverageLabel}`;

    if (summaryLayout.mode === 'text-fallback') {
        return (
            <div className="p-1" data-testid="activity-analytics-summary-text">
                <div className="text-industrial-muted" style={TECHNICAL_TYPOGRAPHY_STYLE} data-testid="activity-analytics-summary-coverage">
                    {coverageSummary}
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {summaryDisplay.detailRows.map((detailRow) => (
                        <SummaryDetailTextCard key={detailRow.key} detailRow={detailRow} />
                    ))}
                </div>
            </div>
        );
    }

    const chartHeight = summaryLayout.mode === 'compact-axis-bars' ? 236 : 276;

    return (
        <div className="flex min-h-0 flex-col p-1" data-testid="activity-analytics-summary-bars">
            <div className="text-industrial-muted" style={TECHNICAL_TYPOGRAPHY_STYLE} data-testid="activity-analytics-summary-coverage">
                {coverageSummary}
            </div>
            <div className="mt-2">
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
                />
            </div>
        </div>
    );
});

type ActivityAnalyticsSummaryData = ReturnType<typeof computeActivityAnalytics>['analytics'];

function createSummaryDisplayModel(
    analytics: ActivityAnalyticsSummaryData,
    visualPalette: ActivityAnalyticsVisualPalette,
) {
    const sectionProductivityLabel = analytics.coverageRatio < 1
        ? INCOMPLETE_COVERAGE_LABEL
        : formatPercent(analytics.utilizationRatio);
    const coverageLabel = formatPercent(analytics.coverageRatio);

    return {
        sectionProductivityLabel,
        coverageLabel,
        stackedBars: [
            { key: 'stopped', label: 'Detenida', durationMs: analytics.durationsMs.stopped, color: visualPalette.stopped.solid },
            { key: 'setup', label: 'Setup', durationMs: analytics.durationsMs.setup, color: visualPalette.setup.solid },
            { key: 'prod', label: 'Prod.', durationMs: analytics.durationsMs.prod, color: visualPalette.prod.solid },
        ] as const,
        detailRows: createSummaryDetailRows(analytics),
    };
}

function createSummaryDetailRows(analytics: ActivityAnalyticsSummaryData): readonly SummaryDetailRow[] {
    const totalDurationMs = analytics.durationsMs.prod + analytics.durationsMs.setup + analytics.durationsMs.stopped;

    const buildDetailRow = (key: SummaryDetailKey, title: SummaryDetailRow['title'], durationMs: number): SummaryDetailRow => {
        const percentLabel = totalDurationMs > 0 ? formatPercent(durationMs / totalDurationMs) : '0%';
        const hoursLabel = formatDurationHours(durationMs);

        return {
            key,
            title,
            durationMs,
            percentLabel,
            hoursLabel,
            valueLabel: `${percentLabel} - ${hoursLabel}`,
        };
    };

    return [
        buildDetailRow('prod', 'Producción', analytics.durationsMs.prod),
        buildDetailRow('setup', 'Setup', analytics.durationsMs.setup),
        buildDetailRow('stopped', 'Detenida', analytics.durationsMs.stopped),
    ] as const;
}

const GroupedAnalyticsPanel = memo(function GroupedAnalyticsPanel({
    grouped,
    visualPalette,
    groupedEffects,
    groupsLayout,
    chartWidth,
    barWidthFactor,
    showTurnoModeControl,
    turnoMode,
    onTurnoModeChange,
    emptyMessage,
}: {
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    visualPalette: ActivityAnalyticsVisualPalette;
    groupedEffects: ResolvedActivityAnalyticsVisualEffects['groupedBars'];
    groupsLayout: ActivityAnalyticsGroupsLayout;
    chartWidth: number;
    barWidthFactor: number;
    showTurnoModeControl: boolean;
    turnoMode: 'summary' | 'detail';
    onTurnoModeChange: (nextTurnoMode: 'summary' | 'detail') => void;
    emptyMessage: string | null;
}) {
    if (grouped.length === 0 && emptyMessage) {
        return (
            <div className={`${ANALYTICS_PANEL_CLASS} flex min-h-0 flex-1 flex-col p-3`} data-testid="activity-analytics-groups">
                <div data-testid="activity-analytics-groups-panel" data-groups-density={groupsLayout.density} className="contents">
                    <PanelHeading title="Grupos" endContent={<GroupStatusLegend visualPalette={visualPalette} />} />
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
                <PanelHeading title="Grupos" endContent={<GroupStatusLegend visualPalette={visualPalette} />} />
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

    const chart = <GroupedStackedBarsChart grouped={grouped} width={chartWidth} layout={groupsLayout} barWidthFactor={barWidthFactor} visualPalette={visualPalette} groupedEffects={groupedEffects} />;

    return (
        <div className={`${ANALYTICS_PANEL_CLASS} flex min-h-0 flex-1 flex-col p-3`} data-testid="activity-analytics-groups">
            <div data-testid="activity-analytics-groups-panel" data-groups-density={groupsLayout.density} className="contents">
                <PanelHeading title="Grupos" endContent={<GroupStatusLegend visualPalette={visualPalette} />} />
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

const GroupStatusLegend = memo(function GroupStatusLegend({ visualPalette }: { visualPalette: ActivityAnalyticsVisualPalette }) {
    return (
        <div className="flex items-center gap-3 normal-case" data-testid="activity-analytics-groups-header-legend">
            {[
                { key: 'stopped' as const, label: 'Detenida', color: visualPalette.stopped.solid },
                { key: 'setup' as const, label: 'Setup', color: visualPalette.setup.solid },
                { key: 'prod' as const, label: 'Prod.', color: visualPalette.prod.solid },
            ].map((item) => (
                <span key={item.key} className="flex items-center gap-1.5 whitespace-nowrap text-industrial-text">
                    <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 rounded-[3px]"
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
            <div className="text-industrial-text" style={GENERAL_TYPOGRAPHY_STYLE} data-testid="activity-analytics-summary-detail-title">{detailRow.title}</div>
            <div className="mt-2 text-industrial-muted" style={TECHNICAL_TYPOGRAPHY_STYLE} data-testid="activity-analytics-summary-detail-value">
                {detailRow.valueLabel}
            </div>
        </div>
    );
});

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function formatPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
}

function formatDurationHours(durationMs: number): string {
    return `${(durationMs / (60 * 60 * 1000)).toFixed(1)} h`;
}

function formatHoursTick(durationMs: number): string {
    return `${(durationMs / (60 * 60 * 1000)).toFixed(1)}h`;
}

function createActivityAnalyticsVisualPalette(
    stateGradients: Record<ActivityAnalyticsGradientStateKey, readonly [string, string]>,
    stateGradientAlphas: Record<ActivityAnalyticsGradientStateKey, readonly [number, number]>,
): ActivityAnalyticsVisualPalette {
    return {
        prod: createActivityAnalyticsPaletteEntry(stateGradients.prod, stateGradientAlphas.prod, 88),
        setup: createActivityAnalyticsPaletteEntry(stateGradients.setup, stateGradientAlphas.setup, 84),
        stopped: createActivityAnalyticsPaletteEntry(stateGradients.stopped, stateGradientAlphas.stopped, 80),
        noData: {
            solid: NO_DATA_STATE_COLOR,
            highlight: `color-mix(in srgb, ${NO_DATA_STATE_COLOR} 82%, white)`,
        },
    };
}

function createActivityAnalyticsPaletteEntry(
    gradient: readonly [string, string],
    gradientAlpha: readonly [number, number],
    highlightMixPercent: number,
): ActivityAnalyticsVisualPaletteEntry {
    const [, end] = gradient;
    const solid = withAlpha(end, gradientAlpha[1]);

    return {
        gradient,
        gradientAlpha,
        solid,
        highlight: `color-mix(in srgb, ${solid} ${highlightMixPercent}%, white)`,
        topCapSolid: end,
        topCapHighlight: `color-mix(in srgb, ${end} ${highlightMixPercent}%, white)`,
    };
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
}) {
    const gradientPrefix = useId().replace(/:/g, '-');
    const glowFilterId = `${gradientPrefix}-summary-glow`;
    const margin = density === 'compress'
        ? { top: 12, right: 12, bottom: 12, left: 12 } as const
        : { top: 14, right: 18, bottom: 14, left: 18 } as const;
    const detailGap = density === 'compress' ? 12 : 18;
    const detailPanelWidth = Math.min(Math.max(width * (density === 'compress' ? 0.31 : 0.33), 124), density === 'compress' ? 136 : 152);
    const donutRegionWidth = Math.max(width - margin.left - margin.right - detailGap - detailPanelWidth, 1);
    const donutRegionHeight = Math.max(height - margin.top - margin.bottom, 1);
    const centerX = margin.left + (donutRegionWidth / 2);
    const centerY = margin.top + (donutRegionHeight / 2);
    const safeReferenceSize = Math.min(donutRegionWidth, donutRegionHeight);
    const ringThickness = clamp(
        safeReferenceSize * 0.06,
        SUMMARY_RING_MIN_THICKNESS,
        SUMMARY_RING_MAX_THICKNESS,
    );
    const prodRingThickness = ringThickness * SUMMARY_RING_PROD_THICKNESS_MULTIPLIER;
    const minimumOuterRadius = 32;
    const outerRadius = Math.max(Math.min((safeReferenceSize / 2) - (density === 'compress' ? 4 : 8), density === 'compress' ? 88 : 104), minimumOuterRadius);
    const radius = Math.max(outerRadius - (prodRingThickness / 2), 1);
    const circumference = 2 * Math.PI * radius;
    const nonZeroBars = bars.filter((bar) => bar.durationMs > 0);
    const gapLength = nonZeroBars.length > 1 ? Math.min(circumference * 0.014, density === 'compress' ? 6 : 8) : 0;
    const renderedSegments = buildActivityAnalyticsSummarySegments({
        bars: nonZeroBars,
        circumference,
        gapLength,
    });
    const detailPanelX = margin.left + donutRegionWidth + detailGap;
    const detailMarkerSize = 10;
    const detailMarkerOffsetY = 3;
    const detailTitleBaselineY = 12;
    const detailValueBaselineY = density === 'compress' ? 32 : 34;
    const detailSectionHeight = density === 'compress' ? 42 : 46;
    const detailSectionGap = density === 'compress' ? 14 : 18;
    const detailSectionSpacing = detailSectionHeight + detailSectionGap;
    const detailBlockHeight = detailSectionHeight + ((Math.max(detailRows.length - 1, 0)) * detailSectionSpacing);
    const detailBlockTop = centerY - (detailBlockHeight / 2);
    const donutTopCaps = donutEffects.topCap
        ? renderedSegments
            .map(({ bar, dashArray, dashOffset }) => createSummaryTopCapSegment({
                bar,
                dashArray,
                dashOffset,
                strokeWidth: bar.key === 'prod' ? prodRingThickness : ringThickness,
            }))
            .filter((segment): segment is NonNullable<typeof segment> => segment !== null)
        : [];

    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} data-testid="activity-analytics-summary-chart">
            <defs>
                {renderSurfaceEffectsFilter({
                    id: glowFilterId,
                    glow: donutEffects.glow,
                    blur: donutEffects.blur,
                    bounds: { x: '-18%', y: '-18%', width: '136%', height: '136%' },
                })}
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
                    const gradientStops = visualPalette[bar.key as ActivityAnalyticsGradientStateKey].gradient;
                    const visualGradientStops = bar.key === 'prod'
                        ? {
                            startColor: gradientStops[0],
                            startOpacity: 1,
                            endColor: gradientStops[1],
                            endOpacity: 1,
                        }
                        : getVisualGradientStops(gradientStops, [100, 100]);

                    return (
                        <linearGradient key={`${bar.key}-top-cap`} id={`${gradientPrefix}-${bar.key}-top-cap-gradient`} x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stopColor={visualGradientStops.startColor} stopOpacity={1} />
                            <stop offset="100%" stopColor={visualGradientStops.endColor} stopOpacity={1} />
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
                {donutTopCaps.map((segment) => (
                    <circle
                        key={`summary-top-cap-${segment.key}`}
                        cx={centerX}
                        cy={centerY}
                        r={radius}
                        fill="none"
                        stroke={`url(#${gradientPrefix}-${segment.key}-top-cap-gradient)`}
                        strokeWidth={segment.key === 'prod' ? prodRingThickness : ringThickness}
                        strokeDasharray={segment.dashArray}
                        strokeDashoffset={segment.dashOffset}
                        strokeLinecap="butt"
                        transform={`rotate(-90 ${centerX} ${centerY})`}
                        style={{ filter: buildTopCapDropShadow(visualPalette[segment.key].topCapSolid, donutEffects.topCapGlow) }}
                        data-testid="activity-analytics-summary-top-cap"
                        data-segment-key={segment.key}
                    />
                ))}

                <circle
                    cx={centerX}
                    cy={centerY}
                    r={Math.max(radius - (prodRingThickness / 2) - 6, 1)}
                    fill="transparent"
                />
                <text
                    x={centerX}
                    y={centerY - 4}
                    textAnchor="middle"
                    fill="var(--color-industrial-text)"
                    style={WIDGET_VALUE_TEXT_STYLE}
                    data-testid="activity-analytics-summary-total-value"
                >
                    {centerValue}
                </text>
                <text
                    x={centerX}
                    y={centerY + 15}
                    textAnchor="middle"
                    fill="var(--color-industrial-muted)"
                    style={GENERAL_TYPOGRAPHY_STYLE}
                    data-testid="activity-analytics-summary-total-label"
                >
                    {centerLabel}
                </text>
            </g>

            <g data-testid="activity-analytics-summary-details" data-layout="centered-column" transform={`translate(${detailPanelX} ${detailBlockTop})`}>
                {detailRows.map((detailRow, index) => {
                    const sectionY = index * detailSectionSpacing;

                    return (
                        <g key={`summary-detail-${detailRow.key}`} data-testid="activity-analytics-summary-detail-section">
                            <rect
                                x={0}
                                y={sectionY + detailMarkerOffsetY}
                                width={detailMarkerSize}
                                height={detailMarkerSize}
                                rx={3}
                                fill={visualPalette[detailRow.key].solid}
                            />
                            <text
                                x={detailMarkerSize + 8}
                                y={sectionY + detailTitleBaselineY}
                                textAnchor="start"
                                fill="var(--color-industrial-text)"
                                style={GENERAL_TYPOGRAPHY_STYLE}
                                data-testid="activity-analytics-summary-detail-title"
                            >
                                {detailRow.title}
                            </text>
                            <text
                                x={detailMarkerSize + 8}
                                y={sectionY + detailValueBaselineY}
                                textAnchor="start"
                                fill="var(--color-industrial-muted)"
                                style={TECHNICAL_TYPOGRAPHY_STYLE}
                                data-testid="activity-analytics-summary-detail-value"
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

function GroupedStackedBarsChart({
    grouped,
    width,
    layout,
    barWidthFactor,
    visualPalette,
    groupedEffects,
}: {
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
    width: number;
    layout: ActivityAnalyticsGroupsLayout;
    barWidthFactor: number;
    visualPalette: ActivityAnalyticsVisualPalette;
    groupedEffects: ResolvedActivityAnalyticsVisualEffects['groupedBars'];
}) {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [hoverInfo, setHoverInfo] = useState<{ index: number; x: number } | null>(null);
    const gradientPrefix = useId().replace(/:/g, '-');
    const groupedGlowFilterId = `${gradientPrefix}-grouped-glow`;
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
    const safeBarWidthFactor = clampActivityAnalyticsGroupBarWidth(barWidthFactor);
    const barWidth = Math.max((plotWidth / Math.max(grouped.length, 1)) * 0.35 * safeBarWidthFactor, 6);
    const horizontalPadding = barWidth;
    const usablePlotWidth = Math.max(plotWidth - (2 * horizontalPadding), 1);
    const centerStep = grouped.length > 1 ? usablePlotWidth / (grouped.length - 1) : 0;
    const axisTicks = Array.from({ length: 5 }, (_, index) => ({
        value: maxDurationMs - ((maxDurationMs * index) / 4),
        y: margin.top + ((index / 4) * plotHeight),
    }));
    const positions = grouped.length > 1
        ? grouped.map((_, index) => margin.left + horizontalPadding + (index * centerStep))
        : grouped.map(() => margin.left + (plotWidth / 2));
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
                <defs>
                    {renderSurfaceEffectsFilter({
                        id: groupedGlowFilterId,
                        glow: groupedEffects.glow,
                        blur: groupedEffects.blur,
                        bounds: { x: '-20%', y: '-20%', width: '140%', height: '140%' },
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
                </defs>
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
                            topCapHeight: Math.min(5, Math.max(Math.min(segment.height - 0.75, segment.height * 0.2), 0)),
                        }))
                        .filter((segment) => segment.topCapHeight > 0);

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
                            {groupedEffects.topCap && topCapSegments.map((segment) => (
                                <rect
                                    key={`${bucket.bucketKey}-${segment.key}-top-cap`}
                                    x={topCapX}
                                    y={segment.y}
                                    width={topCapWidth}
                                    height={segment.topCapHeight}
                                    rx={0}
                                    fill={visualPalette[segment.key as ActivityAnalyticsGradientStateKey].topCapHighlight}
                                    style={{ filter: buildTopCapDropShadow(
                                        visualPalette[segment.key as ActivityAnalyticsGradientStateKey].topCapSolid,
                                        groupedEffects.topCapGlow,
                                    ) }}
                                    data-testid="activity-analytics-group-top-cap"
                                    data-segment-key={segment.key}
                                />
                            ))}

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
                const series: ChartTooltipSeries[] = [
                    { name: 'Prod.', value: formatDurationHours(bucket.durationsMs.prod), color: visualPalette.prod.solid, shape: 'square' },
                    { name: 'Setup', value: formatDurationHours(bucket.durationsMs.setup), color: visualPalette.setup.solid, shape: 'square' },
                    { name: 'Detenida', value: formatDurationHours(bucket.durationsMs.stopped), color: visualPalette.stopped.solid, shape: 'square' },
                    { name: 'Sin datos', value: formatDurationHours(bucket.durationsMs.noData), color: visualPalette.noData.solid, shape: 'square' },
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

const ComparisonRow = memo(function ComparisonRow({
    entry,
    visualPalette,
}: {
    entry: ComparisonEntry;
    visualPalette: ActivityAnalyticsVisualPalette;
}) {
    const totalDurationMs = Math.max(entry.totalDurationMs, 1);
    const segments: ReadonlyArray<{ key: string; value: number; color: string; opacity?: number }> = [
        { key: 'noData', value: entry.durationsMs.noData, color: visualPalette.noData.solid, opacity: 0.5 },
        { key: 'prod', value: entry.durationsMs.prod, color: visualPalette.prod.solid },
        { key: 'setup', value: entry.durationsMs.setup, color: visualPalette.setup.solid },
        { key: 'stopped', value: entry.durationsMs.stopped, color: visualPalette.stopped.solid },
    ];

    return (
        <div className={`${ANALYTICS_CARD_CLASS} rounded-xl p-3`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="uppercase text-industrial-muted" style={GENERAL_TYPOGRAPHY_STYLE}>{entry.heading}</div>
                    <div className="mt-1 truncate text-industrial-text" style={TECHNICAL_TYPOGRAPHY_STYLE} data-testid="activity-analytics-metric-value">{entry.label}</div>
                    <div className="mt-1 text-industrial-muted" style={CHART_TYPOGRAPHY_STYLE}>{entry.metadata}</div>
                </div>
                {!entry.isEmpty && (
                    <div className="mt-1 flex w-24 overflow-hidden rounded-full border border-industrial-border" aria-hidden="true">
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

function buildTopCapDropShadow(color: string, intensity: number): string | undefined {
    if (intensity <= 0) {
        return undefined;
    }

    return `drop-shadow(0 0 ${2 + (intensity / 25)}px ${color})`;
}

function renderSurfaceEffectsFilter({
    id,
    glow,
    blur,
    bounds,
}: {
    id: string;
    glow: number;
    blur: number;
    bounds: { x: string; y: string; width: string; height: string };
}) {
    if (glow <= 0 && blur <= 0) {
        return null;
    }

    return (
        <filter id={id} x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height}>
            <feGaussianBlur stdDeviation={blur} result="surface-blur" />
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
