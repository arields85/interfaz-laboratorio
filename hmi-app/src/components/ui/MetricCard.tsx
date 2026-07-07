import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { HierarchyAggregationTrace } from '../../widgets/resolvers/hierarchyResolver';
import {
    getHierarchyAggregationModeLabel,
    getHierarchyTraceEmptyStateMessage,
    getHierarchyTraceExclusionReasonLabel,
} from '../../widgets/resolvers/hierarchyResolver';
import WidgetHeader from './WidgetHeader';

// =============================================================================
// MetricCard
// Card de métrica reutilizable. Implementa los 5 estados mínimos del sistema:
// loading, normal, warning, error, no-data.
// Arquitectura Técnica v1.3 §9.3 — UI Style Guide §15.3
// =============================================================================

interface MetricCardProps {
    label: string;
    value: number | string | null | undefined;
    valueFontSize?: number;
    unit?: string;
    /** Estado semántico que modifica borde y textura de la card */
    status?: 'normal' | 'warning' | 'critical';
    icon?: LucideIcon;
    /** Override semántico para color del ícono del header. */
    iconColor?: string;
    /**
     * Subtítulo en el HEADER (debajo del título, mismo color que el ícono).
     * Concepto diferente a `subtext` — subtitle = cabecera, subtext = footer.
     */
    subtitle?: string;
    /** Texto de contexto secundario en el FOOTER (ej. "Límite: 45.0 °C") */
    subtext?: string;
    /** Si true, muestra skeleton de carga */
    isLoading?: boolean;
    /** Si true, muestra estado de error */
    isError?: boolean;
    hierarchyTrace?: HierarchyAggregationTrace;
    className?: string;
}

const COMPACT_EXIT_BUFFER_PX = 8;

const STATUS_STYLES = {
    normal: {
        card: 'glass-panel',
        color: 'var(--color-widget-icon)',
        valueColor: undefined as string | undefined, // white by default
    },
    warning: {
        card: 'widget-state-warning',
        color: 'var(--color-status-warning)',
        valueColor: 'var(--color-status-warning)',
    },
    critical: {
        card: 'widget-state-critical',
        color: 'var(--color-status-critical)',
        valueColor: 'var(--color-status-critical)',
    },
};

export default function MetricCard({
    label,
    value,
    valueFontSize,
    unit,
    status = 'normal',
    icon: Icon,
    iconColor,
    subtitle,
    subtext,
    isLoading = false,
    isError = false,
    hierarchyTrace,
    className = '',
}: MetricCardProps) {
    const [isHierarchyDetailOpen, setIsHierarchyDetailOpen] = useState(false);
    const [isCompact, setIsCompact] = useState(false);
    const cardRef = useRef<HTMLDivElement | null>(null);
    const headerRef = useRef<HTMLDivElement | null>(null);
    const valueRowRef = useRef<HTMLDivElement | null>(null);
    const footerRef = useRef<HTMLDivElement | null>(null);
    const compactStateRef = useRef(false);
    const compactReleaseHeightRef = useRef<number | null>(null);
    const hierarchyRegionId = useId();
    const styles = STATUS_STYLES[status];
    const hasHierarchyTrace = hierarchyTrace !== undefined;
    const hasFooterContent = Boolean(subtext) || hasHierarchyTrace;

    useEffect(() => {
        const card = cardRef.current;
        const header = headerRef.current;
        const valueRow = valueRowRef.current;

        if (!card || !header || !valueRow || typeof ResizeObserver === 'undefined') {
            return;
        }

        const measureLayout = () => {
            const computedStyle = window.getComputedStyle(card);
            const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
            const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
            const availableHeight = card.clientHeight - paddingTop - paddingBottom;
            const footerHeight = footerRef.current?.offsetHeight ?? 0;
            const normalGapHeight = hasFooterContent ? 24 : 12;
            const requiredHeight = header.offsetHeight + valueRow.offsetHeight + footerHeight + normalGapHeight;

            if (compactStateRef.current) {
                compactReleaseHeightRef.current = Math.max(
                    compactReleaseHeightRef.current ?? 0,
                    requiredHeight + COMPACT_EXIT_BUFFER_PX,
                );

                const shouldRemainCompact = availableHeight < compactReleaseHeightRef.current;

                if (!shouldRemainCompact) {
                    compactStateRef.current = false;
                    compactReleaseHeightRef.current = null;
                    setIsCompact(false);
                }

                return;
            }

            if (requiredHeight > availableHeight) {
                compactStateRef.current = true;
                compactReleaseHeightRef.current = requiredHeight + COMPACT_EXIT_BUFFER_PX;
                setIsCompact(true);
            }
        };

        measureLayout();

        const resizeObserver = new ResizeObserver(measureLayout);
        resizeObserver.observe(card);
        resizeObserver.observe(header);
        resizeObserver.observe(valueRow);

        if (footerRef.current) {
            resizeObserver.observe(footerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
        };
    }, [hasFooterContent, isHierarchyDetailOpen, subtext]);

    if (isLoading) {
        return (
            <div className={`p-5 rounded-3xl bg-industrial-surface border border-industrial-border animate-pulse ${className}`}>
                <div className="h-3 w-24 bg-industrial-hover rounded mb-4" />
                <div className="h-10 w-20 bg-industrial-hover rounded mb-3" />
                <div className="h-2 w-32 bg-industrial-hover rounded" />
            </div>
        );
    }

    if (isError) {
        return (
            <div className={`p-5 rounded-3xl bg-industrial-surface border border-accent-ruby/20 flex flex-col justify-center items-center gap-2 ${className}`}>
                <span className="uppercase text-slate-500">{label}</span>
                <span style={{ color: 'var(--color-status-critical)' }}>Error de lectura</span>
            </div>
        );
    }

    const displayValue = value === null || value === undefined ? '--' : value;
    const isNoData = value === null || value === undefined;
    const valueTypographyStyle = {
        fontFamily: 'var(--font-widget-value)',
        fontWeight: 'var(--font-weight-widget-value)',
        fontSize: valueFontSize !== undefined ? `${valueFontSize}px` : 'var(--font-size-widget-value)',
        letterSpacing: 'var(--tracking-widget-value)',
        ...(!isNoData && styles.valueColor ? { color: styles.valueColor } : {}),
    };
    const unitTypographyStyle = {
        fontFamily: 'var(--font-widget-value)',
        fontWeight: 'var(--font-weight-widget-value)',
        fontSize: 'var(--font-size-widget-unit)',
        letterSpacing: 'var(--tracking-widget-value)',
    };

    const contentSpacingClassName = isCompact ? 'mt-1.5 gap-1.5' : 'mt-3 gap-3';
    const footerSpacingClassName = isCompact ? 'gap-1.5' : 'gap-3';

    return (
        <div ref={cardRef} className={`p-5 flex flex-col w-full h-full min-h-0 transition-colors duration-300 group ${styles.card} ${className}`}>
            {/* Header — usa WidgetHeader estándar del sistema */}
            <div ref={headerRef} data-testid="metric-card-header" className="shrink-0">
                <WidgetHeader
                    title={label}
                    icon={Icon}
                    iconColor={iconColor ?? styles.color}
                    subtitle={subtitle}
                />
            </div>

            <div data-testid="metric-card-content" className={`min-h-0 flex flex-1 flex-col ${contentSpacingClassName}`}>
                <div className="flex min-h-0 flex-1 items-center">
                    {/* Valor principal */}
                    <div
                        ref={valueRowRef}
                        data-testid="metric-card-value-row"
                        className={`flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 ${isNoData ? 'text-slate-600' : ''}`}
                        style={valueTypographyStyle}
                    >
                        {displayValue}
                        {unit && !isNoData && (
                            <span className="text-slate-400" style={unitTypographyStyle}>{unit}</span>
                        )}
                    </div>
                </div>

                {hasFooterContent && (
                    <div ref={footerRef} data-testid="metric-card-footer" className={`shrink-0 flex flex-col ${footerSpacingClassName}`}>
                        {/* Subtext */}
                        {subtext && (
                            <div className="uppercase text-slate-400">
                                {subtext}
                            </div>
                        )}

                        {hasHierarchyTrace && (
                            <div className="flex min-h-0 flex-col gap-3">
                                <button
                                    type="button"
                                    aria-expanded={isHierarchyDetailOpen}
                                    aria-controls={hierarchyRegionId}
                                    aria-label={`Ver detalle de agregación de ${label}`}
                                    data-widget-navigation-ignore="true"
                                    className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-left text-xs uppercase tracking-wide text-industrial-muted transition-colors hover:text-white"
                                    onClick={() => setIsHierarchyDetailOpen((current) => !current)}
                                >
                                    <span>Detalle de agregación</span>
                                    <ChevronDown
                                        aria-hidden="true"
                                        className={`h-4 w-4 transition-transform ${isHierarchyDetailOpen ? 'rotate-180' : ''}`}
                                    />
                                </button>

                                {isHierarchyDetailOpen && (
                                    <div
                                        id={hierarchyRegionId}
                                        data-testid="metric-card-hierarchy-trace"
                                        data-widget-navigation-ignore="true"
                                        className="hmi-scrollbar flex max-h-44 min-h-0 flex-col gap-3 overflow-y-auto rounded-md border border-white/10 bg-black/20 px-3 py-3"
                                    >
                                        {hierarchyTrace.state === 'resolved' ? (
                                            <div className="flex flex-col gap-1">
                                                <span className="text-sm text-white">
                                                    {`${getHierarchyAggregationModeLabel(hierarchyTrace.aggregation)} actual · ${formatHierarchyTraceValue(hierarchyTrace.resolved.value, hierarchyTrace.resolved.unit)}`}
                                                </span>
                                                <span className="text-xs text-industrial-muted">
                                                    {`${hierarchyTrace.included.length} ${hierarchyTrace.included.length === 1 ? 'incluido' : 'incluidos'} · ${hierarchyTrace.excluded.length} ${hierarchyTrace.excluded.length === 1 ? 'excluido' : 'excluidos'} · ${hierarchyTrace.scannedDashboardCount} ${hierarchyTrace.scannedDashboardCount === 1 ? 'dashboard' : 'dashboards'}`}
                                                </span>
                                            </div>
                                        ) : hierarchyTrace.emptyReason ? (
                                            (() => {
                                                const message = getHierarchyTraceEmptyStateMessage(hierarchyTrace.emptyReason);
                                                return (
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-sm text-white">{message.title}</span>
                                                        <span className="text-xs text-industrial-muted">{message.description}</span>
                                                    </div>
                                                );
                                            })()
                                        ) : null}

                                        {hierarchyTrace.included.length > 0 && (
                                            <div className="flex flex-col gap-2">
                                                <span className="text-[11px] uppercase tracking-wide text-industrial-muted">Incluidos</span>
                                                <div className="flex flex-col gap-2">
                                                    {hierarchyTrace.included.map((entry) => (
                                                        <div key={`${entry.nodeId}-${entry.widgetId}`} className="rounded border border-white/5 bg-white/5 px-2 py-2">
                                                            <div className="text-sm text-white">{entry.widgetTitle}</div>
                                                            <div className="text-xs text-industrial-muted">
                                                                {`${entry.nodeName} · ${formatHierarchyTraceValue(entry.value, entry.unit)}`}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {hierarchyTrace.excluded.length > 0 && (
                                            <div className="flex flex-col gap-2">
                                                <span className="text-[11px] uppercase tracking-wide text-industrial-muted">Excluidos</span>
                                                <div className="flex flex-col gap-2">
                                                    {hierarchyTrace.excluded.map((entry, index) => (
                                                        <div key={`${entry.nodeId}-${entry.widgetId ?? entry.dashboardId ?? index}`} className="rounded border border-white/5 bg-white/5 px-2 py-2">
                                                            <div className="text-sm text-white">{entry.widgetTitle ?? entry.dashboardName ?? entry.nodeName}</div>
                                                            <div className="text-xs text-industrial-muted">
                                                                {getHierarchyTraceExclusionReasonLabel(entry.reason)}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function formatHierarchyTraceValue(value: number | string | null | undefined, unit?: string): string {
    if (value == null || value === '') {
        return '—';
    }

    return unit ? `${value} ${unit}` : String(value);
}
