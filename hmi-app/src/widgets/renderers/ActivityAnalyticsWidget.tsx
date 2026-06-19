import { memo, useMemo, type CSSProperties } from 'react';
import { BarChart2, Loader2, AlertTriangle, PlugZap } from 'lucide-react';
import { ActivitySeriesAdapterError } from '../../adapters/activitySeries.adapter';
import type { ActivityAnalyticsWidgetConfig } from '../../domain/admin.types';
import type { ContractMachine } from '../../domain/dataContract.types';
import { isDataActivitySeriesEnabled } from '../../config/dataConnection.config';
import WidgetCenteredContentLayout from '../../components/ui/WidgetCenteredContentLayout';
import WidgetHeader from '../../components/ui/WidgetHeader';
import { useTemporalSettings } from '../../hooks/useTemporalSettings';
import { useActivitySeries } from '../../queries/useActivitySeries';
import { DataServiceError } from '../../services/dataOverview.service';
import { validateActivityAnalyticsThresholds } from '../../utils/activityAnalytics';
import { computeActivityAnalytics } from '../../utils/activityAnalyticsComputation';
import { resolveActivityAnalyticsTimezone } from '../../utils/activityAnalyticsGrouping';
import { resolveActivityAnalyticsDisplayOptions } from '../../utils/activityAnalyticsWidgetDefaults';

interface ActivityAnalyticsWidgetProps {
    widget: ActivityAnalyticsWidgetConfig;
    machines?: ContractMachine[];
    isLoadingData?: boolean;
    className?: string;
}

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

const WIDGET_VALUE_TYPOGRAPHY_STYLE: CSSProperties = {
    fontFamily: 'var(--font-widget-value)',
    fontWeight: 'var(--font-weight-widget-value)',
    fontSize: 'var(--font-size-widget-value)',
    letterSpacing: 'var(--tracking-widget-value)',
};

const ANALYTICS_PANEL_CLASS = 'rounded-2xl border border-industrial-border bg-[color:color-mix(in_srgb,var(--color-industrial-hover)_72%,transparent)]';
const ANALYTICS_CARD_CLASS = 'rounded-2xl border border-industrial-border bg-[color:color-mix(in_srgb,var(--color-industrial-surface)_88%,var(--color-industrial-hover))]';

export default function ActivityAnalyticsWidget({
    widget,
    machines,
    isLoadingData = false,
    className,
}: ActivityAnalyticsWidgetProps) {
    const displayOptions = resolveActivityAnalyticsDisplayOptions(widget.displayOptions);
    const machineBinding = resolveActivityAnalyticsMachineBinding(widget.binding?.machineId, machines);
    const { config, shifts } = useTemporalSettings();
    const activitySeries = useActivitySeries(machineBinding.machineId != null ? {
        machineId: machineBinding.machineId,
        range: displayOptions.range,
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
                setupKw: displayOptions.setupThresholdKw,
                prodKw: displayOptions.prodThresholdKw,
            },
            groupBy: displayOptions.groupBy,
            shifts,
            timezone: resolvedTimezone,
            window: activityData.window,
        });
    }, [
        activityData,
        displayOptions.groupBy,
        displayOptions.setupThresholdKw,
        displayOptions.prodThresholdKw,
        resolvedTimezone,
        shifts,
    ]);

    const header = (
        <div className="px-5 pt-5">
            <WidgetHeader
                title={widget.title ?? 'Análisis de Actividad'}
                icon={BarChart2}
                iconColor="var(--color-widget-icon)"
                subtitle={machineBinding.selectedMachine?.name ?? 'Activity-Series'}
            />
        </div>
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
        <div className={`h-full rounded-3xl border border-industrial-border bg-industrial-surface ${className ?? ''}`}>
            <WidgetCenteredContentLayout
                header={header}
                contentClassName="px-5 pt-16 pb-5"
            >
                <div className="flex h-full w-full flex-col gap-4">
                    <MetricsGrid analytics={computedAnalytics.analytics} />
                    <GroupedAnalyticsPanel grouped={computedAnalytics.grouped} />
                </div>
            </WidgetCenteredContentLayout>
        </div>
    );
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
        <div className={`h-full rounded-3xl border border-industrial-border bg-industrial-surface ${className ?? ''}`}>
            <WidgetCenteredContentLayout header={header} contentClassName="px-5 pt-16 pb-5">
                <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
                    {icon}
                    <div className="uppercase text-industrial-text" style={GENERAL_TYPOGRAPHY_STYLE}>{title}</div>
                    <div className="text-industrial-muted" style={GENERAL_TYPOGRAPHY_STYLE}>{message}</div>
                </div>
            </WidgetCenteredContentLayout>
        </div>
    );
}

function MetricCard({ label, value }: { label: string; value: string }) {
    return (
        <div className={`${ANALYTICS_CARD_CLASS} p-3`}>
            <div className="uppercase text-industrial-muted" style={TECHNICAL_TYPOGRAPHY_STYLE}>{label}</div>
            <div className="mt-1 text-industrial-text" style={WIDGET_VALUE_TYPOGRAPHY_STYLE} data-testid="activity-analytics-metric-value">{value}</div>
        </div>
    );
}

const MetricsGrid = memo(function MetricsGrid({
    analytics,
}: {
    analytics: ReturnType<typeof computeActivityAnalytics>['analytics'];
}) {
    return (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="activity-analytics-kpis">
            <MetricCard label="% Prod." value={formatPercent(analytics.utilizationRatio)} />
            <MetricCard label="Setup" value={formatDurationHours(analytics.durationsMs.setup)} />
            <MetricCard label="Detenida" value={formatDurationHours(analytics.durationsMs.stopped)} />
            <MetricCard label="kWh est." value={formatKwh(analytics.estimatedKwh)} />
            <MetricCard label="Paradas" value={String(analytics.stopCount)} />
            <MetricCard label="Cobertura" value={formatPercent(analytics.coverageRatio)} />
        </div>
    );
});

const GroupedAnalyticsPanel = memo(function GroupedAnalyticsPanel({
    grouped,
}: {
    grouped: ReturnType<typeof computeActivityAnalytics>['grouped'];
}) {
    return (
        <div className={`${ANALYTICS_PANEL_CLASS} flex min-h-0 flex-1 flex-col p-3`} data-testid="activity-analytics-groups">
            <div className="mb-2 flex items-center justify-between gap-2 uppercase text-industrial-muted">
                <span style={CHART_TYPOGRAPHY_STYLE}>Grupos</span>
                <span style={CHART_TYPOGRAPHY_STYLE}>{grouped.length}</span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto hmi-scrollbar pr-1">
                {grouped.map((bucket) => (
                    <GroupedAnalyticsRow key={bucket.bucketKey} bucket={bucket} />
                ))}
            </div>
        </div>
    );
});

const GroupedAnalyticsRow = memo(function GroupedAnalyticsRow({
    bucket,
}: {
    bucket: ReturnType<typeof computeActivityAnalytics>['grouped'][number];
}) {
    const total = bucket.durationsMs.prod + bucket.durationsMs.setup + bucket.durationsMs.stopped;

    return (
        <div className={`${ANALYTICS_CARD_CLASS} rounded-xl px-3 py-2`}>
            <div className="flex items-center justify-between gap-2">
                <span className="truncate text-industrial-text" style={CHART_TYPOGRAPHY_STYLE}>{bucket.label}</span>
                <span className="uppercase text-industrial-muted" style={CHART_TYPOGRAPHY_STYLE}>{formatPercent(bucket.utilizationRatio)}</span>
            </div>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-industrial-hover" data-testid="activity-analytics-stacked-bar">
                <BarSegment value={bucket.durationsMs.prod} total={total} color="var(--color-status-normal)" />
                <BarSegment value={bucket.durationsMs.setup} total={total} color="var(--color-status-warning)" />
                <BarSegment value={bucket.durationsMs.stopped} total={total} color="var(--color-status-critical)" />
            </div>
            <div className="mt-1 text-industrial-muted" style={TECHNICAL_TYPOGRAPHY_STYLE}>
                {formatDurationHours(bucket.durationsMs.prod)} prod · {formatDurationHours(bucket.durationsMs.setup)} setup · {formatDurationHours(bucket.durationsMs.stopped)} stop
            </div>
        </div>
    );
});

function BarSegment({ value, total, color }: { value: number; total: number; color: string }) {
    if (value <= 0 || total <= 0) {
        return null;
    }

    return <div style={{ width: `${(value / total) * 100}%`, backgroundColor: color }} />;
}

function formatPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
}

function formatDurationHours(durationMs: number): string {
    return `${(durationMs / (60 * 60 * 1000)).toFixed(1)} h`;
}

function formatKwh(value: number): string {
    return `${value.toFixed(1)} kWh`;
}

function validateComputedAnalytics(result: ReturnType<typeof computeActivityAnalytics> | null): asserts result is ReturnType<typeof computeActivityAnalytics> {
    if (!result || !Array.isArray(result.grouped)) {
        throw new Error('Activity analytics computation result is invalid');
    }
}
