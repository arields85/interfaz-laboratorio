import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { AnalyticsDataMode } from '../../domain/analyticsDataMode.types';
import AnalyticsDataModeDot from './AnalyticsDataModeDot';

// =============================================================================
// WidgetHeader
//
// Header estándar del sistema de widgets con ícono.
// Implementa la referencia visual canónica derivada de KpiWidget y MetricCard:
//   - Título a la izquierda (10px, black, uppercase, muted)
//   - Subtítulo opcional debajo del título (mismo tamaño, color semántico del ícono)
//   - Ícono a la derecha: size=24, strokeWidth=2, shrink-0, color semántico
//   - Trailing content opcional a la derecha del ícono (ej: indicador lumínico)
//
// Conceptos:
//   - `subtitle` (header): texto secundario en el encabezado, junto al título.
//     Toma el color del ícono. Úsalo para contexto de cabecera (ej. unidad, estado).
//   - El `subtext` (footer) es responsabilidad del widget contenedor, no del header.
//
// Uso:
//   <WidgetHeader
//     title="Temperatura"
//     icon={Thermometer}
//     iconColor="var(--color-status-warning)"
//   />
//
//   <WidgetHeader
//     title="Histórico de Alertas"
//     icon={HistoryIcon}
//     iconColor="var(--color-status-normal)"
//     trailing={<StatusDot color="var(--color-status-normal)" />}
//   />
//
// UI Style Guide §15.3 — Arquitectura Técnica v1.3 §9.3
// =============================================================================

export interface WidgetHeaderProps {
    /** Texto principal del header (se renderiza en uppercase) */
    title: string;
    /** Contenido visual opcional renderizado inmediatamente antes del título. */
    titleLeading?: ReactNode;
    /** Modo de fuente veraz renderizado como indicador decorativo compartido. */
    dataMode?: AnalyticsDataMode;
    /** Test id opcional para el indicador de modo de fuente. */
    dataModeTestId?: string;
    /** Ícono Lucide a mostrar en la esquina superior derecha */
    icon?: LucideIcon;
    /**
     * Posición del ícono dentro del header.
     * - `'right'` (default): título a la izquierda, ícono a la derecha — layout canónico original.
     * - `'left'`: ícono a la izquierda del título+subtítulo. Mantiene exactamente el mismo
     *   offset óptico (`alignment='standard'` → `-translate-y-1`) para que la línea de título
     *   quede al mismo nivel vertical que en el layout con ícono a la derecha.
     *
     * El slot `trailing` siempre se renderiza al EXTREMO OPUESTO del ícono, para
     * mantener coherencia visual: info estructural a un lado, contenido accesorio al otro.
     */
    iconPosition?: 'left' | 'right' | 'centered';
    /**
     * Color CSS del ícono y del subtítulo de header.
     * Usar variables semánticas del sistema:
     *   - `var(--color-widget-icon)`          → estado neutro/base
     *   - `var(--color-status-normal)`         → estado operativo normal
     *   - `var(--color-status-warning)`        → advertencia
     *   - `var(--color-status-critical)`       → crítico
     * No pasar valores hex hardcodeados.
     */
    iconColor?: string;
    /**
     * Subtítulo en el header: texto secundario debajo del título.
     * Toma el mismo color que el ícono. Se usa para contexto de cabecera
     * (ej. estado dinámico, unidad de medida).
     * Conceptualmente diferente al `subtext` footer del widget.
     */
    subtitle?: string;
    /**
     * Contenido adicional que se renderiza a la derecha del ícono.
     * Típicamente un indicador lumínico (StatusPulse) o un badge.
     */
    trailing?: ReactNode;
    /** Clases adicionales para el contenedor del header */
    className?: string;
    /** Test id opcional para el ícono */
    iconTestId?: string;
    /**
     * Alineación vertical semántica del bloque de header.
     * - `standard` (default): offset óptico canónico del sistema.
     * - `none`: sin ajuste extra (solo para casos excepcionales).
     */
    alignment?: 'standard' | 'none';
}

interface WidgetHeaderDataModeProps {
    dataMode?: AnalyticsDataMode | null;
    dataModeTestId?: string;
    className?: string;
}

export function WidgetHeaderDataMode({
    dataMode,
    dataModeTestId,
    className = '',
}: WidgetHeaderDataModeProps) {
    if (!dataMode) {
        return null;
    }

    return (
        <AnalyticsDataModeDot
            mode={dataMode}
            testId={dataModeTestId}
            className={className}
        />
    );
}

export default function WidgetHeader({
    title,
    titleLeading,
    dataMode,
    dataModeTestId,
    icon: Icon,
    iconPosition = 'right',
    iconColor = 'var(--color-widget-icon)',
    subtitle,
    trailing,
    className = '',
    iconTestId,
    alignment = 'standard',
}: WidgetHeaderProps) {
    const hasSubtitle = Boolean(subtitle);
    const alignmentClassName = alignment === 'standard' ? '-translate-y-1' : '';
    const centered = iconPosition === 'centered';
    const iconOnLeft = iconPosition === 'left';
    const dataModeNode = dataMode ? (
        <WidgetHeaderDataMode dataMode={dataMode} dataModeTestId={dataModeTestId} />
    ) : null;
    const iconNode = Icon ? (
        <Icon
            size={24}
            strokeWidth={2}
            className={centered
                ? 'shrink-0 opacity-100'
                : 'shrink-0 opacity-70 group-hover:opacity-100 transition-opacity'}
            style={{ color: iconColor }}
            data-testid={iconTestId}
        />
    ) : null;
    const titleNode = (
        <span className={centered
            ? 'min-w-0 text-center uppercase text-industrial-muted group-hover:text-white transition-colors'
            : 'min-w-0 flex-1 truncate uppercase text-industrial-muted group-hover:text-white transition-colors'}>
            {title}
        </span>
    );

    if (centered) {
        const hasTitle = title.trim().length > 0;

        return (
            <div className={`flex flex-col items-center gap-2 ${className}`}>
                {hasTitle ? (
                    titleLeading || dataModeNode ? (
                        <div className="flex min-w-0 items-center gap-2">
                            {titleLeading}
                            {titleNode}
                            {dataModeNode}
                        </div>
                    ) : titleNode
                ) : null}
                {iconNode}
            </div>
        );
    }

    return (
        <div className={`grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto] gap-y-0 ${alignmentClassName} ${className}`}>
            {/* Fila 1: título + bloque derecho. El subtítulo no participa de esta alineación. */}
            <div className="row-start-1 flex items-center justify-between gap-2">
                {iconOnLeft ? (
                    <>
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                            {iconNode}
                            {titleLeading}
                            {dataModeNode}
                            {titleNode}
                        </div>
                        {trailing && (
                            <div className="flex items-center gap-2 shrink-0 leading-none">
                                {trailing}
                            </div>
                        )}
                    </>
                ) : (
                    <>
                        {titleLeading}
                        {titleNode}

                        {(dataModeNode || iconNode || trailing) && (
                            <div className="flex items-center gap-2 shrink-0 leading-none">
                                {dataModeNode}
                                {iconNode}
                                {trailing}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Fila 2 reservada SIEMPRE. Se acerca solo el subtítulo sin mover el título. */}
            <span
                className={`row-start-2 min-w-0 -mt-0.5 truncate uppercase transition-opacity ${hasSubtitle ? '' : 'invisible'}`}
                style={{ color: iconColor }}
                aria-hidden={!hasSubtitle}
            >
                {subtitle ?? '\u00A0'}
            </span>
        </div>
    );
}
