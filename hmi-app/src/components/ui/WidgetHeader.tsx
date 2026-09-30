import { useContext, useLayoutEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import type { AnalyticsDataMode } from '../../domain/analyticsDataMode.types';
import AnalyticsDataModeDot from './AnalyticsDataModeDot';
import { TabFrameContext, TabFrameStripContext, type TabFrameAlertState } from '../../hooks/tabFrameContext';
import { buildDashboardTitleTypography } from '../../utils/dashboardTitleTypography';
import { TAB_FRAME_ICON_SIZE_PX } from '../../utils/tabFrameIcon';

// =============================================================================
// WidgetHeader
//
// Header estándar del sistema de widgets con ícono.
// Implementa la referencia visual canónica derivada de KpiWidget y MetricCard:
//   - Título a la izquierda (10px, black, uppercase, muted)
//   - Subtítulo opcional debajo del título (mismo tamaño, color semántico del ícono)
//   - Ícono a la derecha: size=24, strokeWidth=2, shrink-0, color semántico
//   - Trailing content opcional a la derecha del ícono (ej: indicador lumínico)
//   - Forma Pestaña: el título (y el punto de modo) va en la pestaña del marco y el ícono en la esquina
//     superior derecha; el trailing (ej. el selector de escala de un gráfico) sube a la franja superior,
//     a la izquierda del ícono, y entonces la fila del header no ocupa altura (ver `WidgetFrame`).
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

/**
 * Tab title colors (tab frame shape, including the title with its own typography): the SAME
 * behavior as the standard title (muted, white while the widget is hovered, `transition-colors`)
 * but through the `--tab-frame-text` / `-hover` tokens so the tab color can be tuned in one place.
 * Full class names so Tailwind finds them.
 */
const TAB_TITLE_COLOR_CLASSES = 'text-(color:--tab-frame-text) group-hover:text-(color:--tab-frame-text-hover) transition-colors';

/** In an alert state the tab title is the alert color at 100 % (no hover change). */
const TAB_TITLE_ALERT_CLASSES: Record<TabFrameAlertState, string> = {
    warning: 'text-status-warning',
    critical: 'text-status-critical',
};

/**
 * The title of the tab frame. With `fontSize` (a title with its own typography) it also carries its
 * vertical breathing space as padding (`--tab-frame-title-pad-y`, the same token that sizes the tab),
 * so `truncate`'s clipping never shaves the ascenders or descenders of a line box tighter than the glyphs.
 */
function TabFrameTitle({ title, alertState, fontSize }: {
    title: string;
    alertState: TabFrameAlertState | null;
    fontSize: number | null;
}) {
    const ownTypography = fontSize !== null;
    const colorClasses = alertState ? TAB_TITLE_ALERT_CLASSES[alertState] : TAB_TITLE_COLOR_CLASSES;
    const style: CSSProperties | undefined = ownTypography
        ? {
            ...buildDashboardTitleTypography(fontSize),
            paddingTop: 'var(--tab-frame-title-pad-y)',
            paddingBottom: 'var(--tab-frame-title-pad-y)',
        }
        : undefined;

    return (
        <span className={`min-w-0 truncate ${ownTypography ? '' : 'uppercase '}${colorClasses}`} style={style}>
            {title}
        </span>
    );
}

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
    withLeadingSeparator?: boolean;
    /** Dot drawn on the light tab of the tab frame shape. */
    onTab?: boolean;
}

export function WidgetHeaderDataMode({
    dataMode,
    dataModeTestId,
    withLeadingSeparator = false,
    onTab = false,
}: WidgetHeaderDataModeProps) {
    if (!dataMode) {
        return null;
    }

    const dot = (
        <AnalyticsDataModeDot mode={dataMode} testId={dataModeTestId} onTab={onTab} />
    );

    return withLeadingSeparator
        ? <span className="flex items-center border-l border-industrial-muted/25 pl-2">{dot}</span>
        : dot;
}

/**
 * The header's trailing content in a tab frame, in the strip or in the body row. It reports its
 * INTRINSIC width (`w-max`, `shrink-0`: the same wherever it is rendered, never the room it is given) to
 * the frame, which decides the placement from it; 0 when it goes away.
 */
function TabFrameTrailingSlot({ onWidth, children }: { onWidth: (widthPx: number) => void; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const element = ref.current;

        if (!element) {
            return undefined;
        }

        const measure = () => onWidth(element.offsetWidth);
        measure();

        const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
        resizeObserver?.observe(element);

        return () => {
            resizeObserver?.disconnect();
            onWidth(0);
        };
    }, [onWidth]);

    return (
        <div
            ref={ref}
            data-tab-frame-slot="trailing"
            className="flex w-max shrink-0 items-center gap-2 whitespace-nowrap leading-none"
        >
            {children}
        </div>
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
    const tabFrame = useContext(TabFrameContext);
    const hasSubtitle = Boolean(subtitle);
    const alignmentClassName = alignment === 'standard' ? '-translate-y-1' : '';
    const centered = iconPosition === 'centered';
    const iconOnLeft = iconPosition === 'left';
    // Tab frame shape: the title (and its data-mode dot) live in the tab and the icon in the top-right
    // corner (whatever its position in the standard header). Without trailing content the title row
    // keeps its height so the subtitle and the content below never move; WITH trailing content (a chart's
    // selector) everything lives in the strip and the row only keeps the clearance under it. That is only
    // for the chart types that opt in, while their content fits in the frame (`trailingPlacement`, decided
    // by `WidgetFrame`); otherwise the trailing content stays in the row, right-aligned like the standard frame.
    const inTab = tabFrame !== null && !centered;
    const trailingInStrip = inTab && Boolean(trailing) && tabFrame.trailingPlacement === 'strip';
    const reportTrailingWidth = tabFrame?.reportTrailingWidth;
    // A chart whose selector does not fit in the strip: its body row starts under the strip, like the lab's alternative A.
    const rowBelowStrip = inTab && Boolean(trailing) && tabFrame.trailingBelowStrip;
    const trailingSlot = inTab && trailing && reportTrailingWidth
        ? <TabFrameTrailingSlot onWidth={reportTrailingWidth}>{trailing}</TabFrameTrailingSlot>
        : null;
    const dataModeNode = dataMode ? (
        <WidgetHeaderDataMode dataMode={dataMode} dataModeTestId={dataModeTestId} onTab={inTab} />
    ) : null;
    const iconNode = Icon ? (
        <Icon
            size={TAB_FRAME_ICON_SIZE_PX}
            strokeWidth={2}
            className={centered
                ? 'shrink-0 opacity-100'
                : 'shrink-0 opacity-70 group-hover:opacity-100 transition-opacity'}
            style={{ color: iconColor }}
            data-testid={iconTestId}
        />
    ) : null;
    const titleNode = inTab ? (
        <TabFrameTitle title={title} alertState={tabFrame.alertState} fontSize={tabFrame.titleFontSize} />
    ) : (
        <span className={centered
            ? 'min-w-0 text-center uppercase text-industrial-muted group-hover:text-white transition-colors'
            : 'min-w-0 flex-1 truncate uppercase text-industrial-muted group-hover:text-white transition-colors'}>
            {title}
        </span>
    );

    // Everything the tab frame hosts outside the header row: title, icon and trailing content.
    const tabPortals = inTab ? (
        <>
            {tabFrame.titleHost && createPortal(
                <>
                    {titleLeading}
                    {dataModeNode}
                    {titleNode}
                </>,
                tabFrame.titleHost,
            )}

            {/* El ícono se dibuja en el anfitrión del marco (`WidgetFrame`); en el header queda, según el
                caso, un hueco invisible del mismo tamaño para que la fila conserve su alto y su ancho. */}
            {iconNode && tabFrame.iconHost && createPortal(
                <span data-tab-frame-slot="icon" className="hmi-tab-frame-icon flex items-center">
                    {iconNode}
                </span>,
                tabFrame.iconHost,
            )}

            {trailingInStrip && tabFrame.trailingHost && createPortal(
                <TabFrameStripContext.Provider value>
                    {trailingSlot}
                </TabFrameStripContext.Provider>,
                tabFrame.trailingHost,
            )}
        </>
    ) : null;

    if (centered) {
        const hasTitle = title.trim().length > 0;

        return (
            <div className={`flex flex-col items-center gap-2 ${className}`}>
                {hasTitle ? (
                    titleLeading || dataModeNode ? (
                        <div className="flex min-w-0 items-center gap-2">
                            {titleLeading}
                            {dataModeNode}
                            {titleNode}
                        </div>
                    ) : titleNode
                ) : null}
                {iconNode}
            </div>
        );
    }

    if (trailingInStrip) {
        return (
            <div className={`grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto] gap-y-0 ${className}`}>
                {tabPortals}
                {/* Título, ícono y trailing viven en la franja: la fila 1 solo deja libre la franja (el gráfico gana el resto). */}
                <div aria-hidden="true" className="row-start-1 hmi-tab-frame-header-clearance" />
                {hasSubtitle && (
                    <span className="row-start-2 min-w-0 truncate uppercase" style={{ color: iconColor }}>
                        {subtitle}
                    </span>
                )}
            </div>
        );
    }

    return (
        <div
            className={`grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto] gap-y-0 ${alignmentClassName} ${className}`}
            style={rowBelowStrip ? { marginTop: 'var(--tab-frame-header-clearance, 0px)' } : undefined}
        >
            {tabPortals}
            {/* Fila 1: título + bloque derecho. El subtítulo no participa de esta alineación. */}
            <div className="row-start-1 flex items-center justify-between gap-2">
                {inTab ? (
                    <>
                        {/* Pestaña: el título va en la pestaña del marco; este espaciador invisible
                            conserva la altura de la fila para que nada debajo se mueva. */}
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span aria-hidden="true" className="invisible min-w-0 flex-1 truncate uppercase">{'\u00A0'}</span>
                        </div>

                        {(iconNode || trailingSlot) && (
                            <div className="flex min-w-0 items-center gap-2 leading-none">
                                {iconNode && !rowBelowStrip && (
                                    <span
                                        data-tab-frame-slot="icon-placeholder"
                                        aria-hidden="true"
                                        className="invisible shrink-0"
                                        style={{ width: TAB_FRAME_ICON_SIZE_PX, height: TAB_FRAME_ICON_SIZE_PX }}
                                    />
                                )}
                                {/* Trailing in the body row: it never pushes out of the frame, it scrolls inside the row. */}
                                {trailingSlot && (
                                    <div className="min-w-0 overflow-x-auto overflow-y-hidden hmi-scrollbar">
                                        {trailingSlot}
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                ) : iconOnLeft ? (
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
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                            {titleLeading}
                            {dataModeNode}
                            {titleNode}
                        </div>

                        {(iconNode || trailing) && (
                            <div className="flex items-center gap-2 shrink-0 leading-none">
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
