import { useEffect, useEffectEvent, useRef, useState, useMemo, forwardRef } from 'react';
import { AlertTriangle, AlertCircle, Clock, History, Gauge, Activity, Thermometer, Zap, Droplet, Wind, Settings, Fan, FoldVertical, HelpCircle, Trash2, HeartPulse, Siren, Wifi, BarChart2, LineChart, type LucideIcon } from 'lucide-react';
import type { AlertHistoryWidgetConfig, WidgetConfig } from '../../domain/admin.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import type { ContractMachine } from '../../domain/dataContract.types';
import type { AlertHistoryEntry } from '../../domain/alertHistory.types';
import { formatAlertHistoryAge, formatAlertHistoryValue } from '../../utils/alertHistoryFormatting';
import WidgetHeader from '../../components/ui/WidgetHeader';
import {
    clearAlertHistoryEntries,
    subscribeAlertHistory,
} from './alertHistoryCoordinator';

// =============================================================================
// AlertHistoryWidget
// Renderer para widgets de tipo 'alert-history'.
//
// Responsabilidades:
// - Disparar la evaluación periódica de widgets hermanos del mismo dashboard.
// - Leer el histórico de eventos desde AlertHistoryStorageService.
// - Renderizar la lista de eventos con estilo premium/industrial.
//
// Props especiales (via widget.displayOptions):
//   dashboardId  {string}  - ID del dashboard que se monitorea (requerido)
//   pollInterval {number}  - Intervalo de polling en ms (default: 10000)
//
// La UI se inspira en el widget "Critical Events" de la referencia de diseño:
//   - Header con título y punto de estado pulsante
//   - Lista de eventos con badge de severidad y timestamp relativo
//   - Botón "Ver historial completo" (decorativo — sin navegación real aún)
//
// Arquitectura Técnica v1.3 §16 (renderers layer)
// =============================================================================

interface AlertHistoryWidgetProps {
    widget: AlertHistoryWidgetConfig;
    equipmentMap: Map<string, EquipmentSummary>;
    machines?: ContractMachine[];
    /** Lista de todos los widgets del mismo dashboard (para evaluar hermanos). */
    siblingWidgets?: WidgetConfig[];
    className?: string;
}

// Intervalo de polling default: 10 segundos
const DEFAULT_POLL_INTERVAL = 10_000;


// Mapa de íconos disponibles para el header (mismo catálogo que los demás widgets + History)
const ICON_MAP: Record<string, LucideIcon> = {
    History,
    Gauge,
    Activity,
    Thermometer,
    Zap,
    Droplet,
    Wind,
    Settings,
    Fan,
    FoldVertical,
    HeartPulse,
    Siren,
    Wifi,
    BarChart2,
    LineChart,
};

export default function AlertHistoryWidget({
    widget,
    equipmentMap,
    machines,
    siblingWidgets = [],
    className,
}: AlertHistoryWidgetProps) {
    const dashboardId = widget.displayOptions?.dashboardId ?? 'unknown';
    const maxVisible = widget.displayOptions?.maxVisible ?? 5;
    const pollInterval = widget.displayOptions?.pollInterval ?? DEFAULT_POLL_INTERVAL;

    // El ícono del header es NEUTRAL (no dinámico). El único elemento dinámico
    // es el punto lumínico pulsante. El ícono toma el color del título (muted).
    const iconSetting = widget.displayOptions?.icon;
    const isPendingIconSelection = iconSetting === undefined;
    const isNoIconSelection = iconSetting === null;
    const configuredIcon = typeof iconSetting === 'string' ? ICON_MAP[iconSetting] : undefined;
    const isInvalidConfiguredIcon = typeof iconSetting === 'string' && configuredIcon === undefined;

    const HeaderIcon = isPendingIconSelection
        ? HelpCircle
        : isNoIconSelection
          ? undefined
          : configuredIcon ?? HelpCircle;

    // -------------------------------------------------------------------------
    // Estado separado: historial visible vs severidad activa del panel
    // -------------------------------------------------------------------------
    // `entries`         → eventos históricos pasados (para la lista).
    // `activeSeverity`  → severidad activa AHORA (para el fondo del panel).
    //
    // Son independientes por diseño:
    //   - El historial puede tener entries críticos del pasado mientras el
    //     estado actual es normal → el fondo debe ser normal.
    //   - La severidad activa se obtiene de los widgetSnapshots del storage,
    //     que reflejan el último MetricStatus evaluado de cada widget hermano.
    //
    // Prioridad de fondo: warning > critical > normal.
    //   Si hay warning activo (con o sin critical) → fondo warning.
    //   Si solo hay critical activo → fondo critical (danger).
    //   Sin alertas activas → fondo estándar.
    // -------------------------------------------------------------------------

    const [entries, setEntries] = useState<AlertHistoryEntry[]>([]);
    const [activeSeverity, setActiveSeverity] = useState<'normal' | 'warning' | 'critical'>('normal');
    const [visibleCount, setVisibleCount] = useState(5);
    const listRef = useRef<HTMLDivElement>(null);
    const entryRef = useRef<HTMLDivElement>(null);
    const getEvaluationContext = useEffectEvent(() => ({
        widgets: siblingWidgets,
        equipmentMap,
        machines,
    }));
    const applyCoordinatorState = useEffectEvent((state: {
        entries: AlertHistoryEntry[];
        activeSeverity: 'normal' | 'warning' | 'critical';
    }) => {
        setEntries(state.entries);
        setActiveSeverity(state.activeSeverity);
    });

    // El coordinator mantiene una sola evaluación y un solo timer por dashboard.
    useEffect(() => {
        return subscribeAlertHistory({
            dashboardId,
            pollInterval,
            getContext: getEvaluationContext,
            onState: applyCoordinatorState,
        });
    }, [dashboardId, pollInterval]);

    // ResizeObserver: calcula cuántas filas caben en el contenedor sin scroll
    useEffect(() => {
        const listEl = listRef.current;
        if (!listEl) return;

        const observer = new ResizeObserver(() => {
            const containerHeight = listEl.clientHeight;
            const entryEl = entryRef.current;
            const entryHeight = entryEl?.offsetHeight ?? 80; // fallback solo en el primer render
            const gap = 6; // gap-1.5 = 6px — constante estructural del token Tailwind
            const count = Math.max(1, Math.floor(containerHeight / (entryHeight + gap)));
            setVisibleCount(count);
        });
        observer.observe(listEl);
        return () => observer.disconnect();
    }, []);

    // -------------------------------------------------------------------------
    // Clases del panel: fondo basado en activeSeverity (estado activo presente)
    // Regla: warning > critical > normal (warning tiene mayor prioridad visual)
    // -------------------------------------------------------------------------
    const panelStateClass =
        activeSeverity === 'warning'
            ? ' glass-panel-warning'
            : activeSeverity === 'critical'
              ? ' glass-panel-danger'
              : '';

    const statusDotColor =
        activeSeverity === 'warning'
            ? 'var(--color-status-warning)'
            : activeSeverity === 'critical'
              ? 'var(--color-status-critical)'
              : 'var(--color-status-normal)';

    return (
        <div
            className={`p-5 pb-2 glass-panel group${panelStateClass} flex flex-col w-full h-full overflow-hidden ${className ?? ''}`}
        >
            {/* ── Header — usa WidgetHeader estándar del sistema ── */}
            {/* El ícono retoma color dinámico, pero con 50% de transparencia para
                no competir visualmente con el punto lumínico pulsante. */}
            <WidgetHeader
                title={widget.title ?? 'Histórico de Alertas'}
                icon={HeaderIcon}
                iconPosition="left"
                iconColor={isPendingIconSelection || isInvalidConfiguredIcon || activeSeverity === 'normal'
                    ? 'var(--color-industrial-muted)'
                    : statusDotColor}
                trailing={
                    <div className="relative flex items-center justify-center w-3 h-3">
                        <span
                            className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping"
                            style={{ backgroundColor: statusDotColor, animationDuration: '2s' }}
                        />
                        <span
                            className="relative inline-flex rounded-full h-2 w-2"
                            style={{ backgroundColor: statusDotColor }}
                        />
                    </div>
                }
                className="shrink-0"
            />

            {/* ── Lista de eventos ── */}
            <div ref={listRef} role={entries.length > 0 ? 'list' : undefined} className="flex-1 overflow-hidden flex flex-col gap-1.5 min-h-0 justify-center">
                {entries.length === 0 ? (
                    <EmptyState />
                ) : (
                    entries.slice(0, Math.min(visibleCount, maxVisible)).map((entry, i) => (
                        <AlertEntryRow key={entry.id} entry={entry} ref={i === 0 ? entryRef : undefined} />
                    ))
                )}
            </div>

            {/* ── Footer: Ver historial completo + limpiar entries ── */}
            <div className="mt-auto border-t border-[var(--color-industrial-border)] -mx-5 px-5 pt-2 flex items-center justify-between">
                <button
                    type="button"
                    className="text-industrial-muted hover:text-industrial-text transition-colors duration-200 cursor-default"
                    aria-label="Ver historial completo (funcionalidad pendiente)"
                    tabIndex={-1}
                >
                    Ver historial completo
                </button>
                <button
                    type="button"
                    aria-label="Limpiar historial visible"
                    disabled={entries.length === 0}
                    className={entries.length === 0 ? 'text-industrial-muted/30 cursor-not-allowed' : 'text-industrial-muted hover:text-white transition-colors cursor-pointer'}
                    onClick={() => {
                        clearAlertHistoryEntries(dashboardId);
                    }}
                >
                    <Trash2 size={14} aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}

// =============================================================================
// AlertEntryRow — fila individual de un evento del histórico
// =============================================================================
const AlertEntryRow = forwardRef<HTMLDivElement, { entry: AlertHistoryEntry }>(
function AlertEntryRow({ entry }, ref) {
    const isCritical = entry.toStatus === 'critical';

    const accentColor = isCritical
        ? 'var(--color-status-critical)'
        : 'var(--color-status-warning)';

    const bgStyle: React.CSSProperties = isCritical
        ? {
              background:
                  'linear-gradient(90deg, color-mix(in srgb, var(--color-dynamic-critical-from) 12%, transparent), transparent)',
              borderLeft: `2px solid ${accentColor}`,
          }
        : {
              background:
                  'linear-gradient(90deg, color-mix(in srgb, var(--color-dynamic-warning-from) 10%, transparent), transparent)',
              borderLeft: `2px solid ${accentColor}`,
          };

    return (
        <div
            ref={ref}
            role="listitem"
            className="rounded-xl px-3 py-1.5 flex flex-col gap-0.5"
            style={bgStyle}
        >
            {/* Badge de severidad + timestamp */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                    {isCritical ? (
                        <AlertCircle
                            size={10}
                            strokeWidth={2.5}
                            style={{ color: accentColor, flexShrink: 0 }}
                        />
                    ) : (
                        <AlertTriangle
                            size={10}
                            strokeWidth={2.5}
                            style={{ color: accentColor, flexShrink: 0 }}
                        />
                    )}
                    <span
                        className="uppercase"
                        style={{ color: accentColor }}
                    >
                        {isCritical ? 'Crítica' : 'Advertencia'}
                    </span>
                    <span style={{ color: 'var(--color-industrial-muted)' }}>
                        · <RelativeTime iso={entry.detectedAt} />
                    </span>
                </div>
            </div>

            {/* Título del widget que disparó la alerta */}
            <span className="leading-tight text-industrial-text truncate">
                {entry.widgetTitle.toUpperCase()}
            </span>

            {/* Valor en el momento del evento */}
            {entry.value !== undefined && entry.value !== null && (
                <div className="flex items-center gap-1 mt-0.5">
                    <Clock
                        size={8}
                        style={{ color: 'var(--color-industrial-muted)', flexShrink: 0 }}
                    />
                    <span
                        className="font-mono"
                        style={{ color: 'var(--color-industrial-muted)' }}
                    >
                        Valor: {formatAlertHistoryValue(entry.value, entry.unit)}
                    </span>
                </div>
            )}
        </div>
    );
});

// =============================================================================
// EmptyState — cuando no hay eventos históricos registrados
// =============================================================================
function EmptyState() {
    return (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 py-6">
            <AlertTriangle
                size={20}
                strokeWidth={1.5}
                style={{ color: 'var(--color-industrial-muted)', opacity: 0.4 }}
            />
            <span
                className="uppercase text-center"
                style={{ color: 'var(--color-industrial-muted)', opacity: 0.6 }}
            >
                Sin alertas recientes
            </span>
        </div>
    );
}

// =============================================================================
// RelativeTime — timestamp relativo tipo "hace 5 min"
// =============================================================================
function RelativeTime({ iso }: { iso: string }) {
    const [refreshTick, setRefreshTick] = useState(0);
    const label = useMemo(() => {
        void refreshTick;
        return formatAlertHistoryAge(iso);
    }, [iso, refreshTick]);

    useEffect(() => {
        const timer = setInterval(() => setRefreshTick((tick) => tick + 1), 30_000);
        return () => clearInterval(timer);
    }, [iso]);

    return <>{label}</>;
}
