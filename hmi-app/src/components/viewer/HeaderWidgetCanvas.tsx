import { useState, useRef, useCallback } from 'react';
import type { DragEvent, KeyboardEvent, ReactNode, RefObject } from 'react';
import { ArrowDown, ChevronLeft, ChevronRight, Plus, Trash2, Activity, Wifi } from 'lucide-react';
import AnchoredOverlay from '../ui/AnchoredOverlay';
import type { WidgetConfig, WidgetType } from '../../domain/admin.types';
import type { ConnectionHealth, ContractMachine } from '../../domain/dataContract.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import type { HierarchyContext } from '../../widgets/resolvers/hierarchyResolver';
import HeaderSelectionFrame from '../ui/HeaderSelectionFrame';
import WidgetHoverActions from '../ui/WidgetHoverActions';
import {
    HEADER_WIDGET_DRAG_MIME,
    HEADER_WIDGET_SLOT_COUNT,
    parseHeaderWidgetDragPayload,
} from '../../utils/headerWidgets';
import HeaderWidgetRenderer from './HeaderWidgetRenderer';

// =============================================================================
// Opciones del menú contextual del slot vacío de header.
// Solo se ofrecen tipos compatibles con header. Creamos un widget nuevo directamente
// (en lugar de requerir que exista en el grid) porque es la UX más directa:
// el usuario hace click → elige tipo → aparece en el header ya configurado.
// =============================================================================
interface HeaderSlotMenuOption {
    type: WidgetType;
    label: string;
    description: string;
    icon: ReactNode;
}

const HEADER_SLOT_OPTIONS: HeaderSlotMenuOption[] = [
    {
        type: 'status',
        label: 'Estado de equipo',
        description: 'Muestra el estado operativo de un activo',
        icon: <Activity size={13} />,
    },
    {
        type: 'connection-status',
        label: 'Estado de conexión',
        description: 'Muestra el estado del enlace de datos',
        icon: <Wifi size={13} />,
    },
];

// =============================================================================
// HeaderSlotContextMenu
// Menú contextual flotante para el slot vacío del header.
// Delega portal + posicionamiento a AnchoredOverlay.
// =============================================================================
interface HeaderSlotContextMenuProps {
    triggerRef: RefObject<HTMLButtonElement | null>;
    isOpen: boolean;
    onClose: () => void;
    onSelect: (type: WidgetType) => void;
}

const HEADER_SLOT_MENU_ESTIMATED_HEIGHT = HEADER_SLOT_OPTIONS.length * 52 + 16;

function HeaderSlotContextMenu({ triggerRef, isOpen, onClose, onSelect }: HeaderSlotContextMenuProps) {
    return (
        <AnchoredOverlay
            triggerRef={triggerRef}
            isOpen={isOpen}
            onClose={onClose}
            estimatedHeight={HEADER_SLOT_MENU_ESTIMATED_HEIGHT}
            minWidth={200}
            align="start"
            gap={4}
        >
            <div
                className="rounded-lg border border-white/10 py-1.5 overflow-hidden"
                style={{
                    background: 'var(--color-industrial-surface)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)',
                }}
            >
                <div className="px-3 pb-1.5 pt-0.5 mb-1 border-b border-white/5">
                    <span className="uppercase text-industrial-muted">
                        Agregar widget de header
                    </span>
                </div>
                {HEADER_SLOT_OPTIONS.map((opt) => (
                    <button
                        key={opt.type}
                        type="button"
                        onClick={() => {
                            onSelect(opt.type);
                            onClose();
                        }}
                        className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/5 group/opt"
                        style={{ color: 'var(--color-industrial-muted)' }}
                    >
                        <span
                            className="mt-0.5 shrink-0 transition-colors group-hover/opt:text-admin-accent"
                            style={{ color: 'var(--color-admin-accent)', opacity: 0.7 }}
                        >
                            {opt.icon}
                        </span>
                        <span className="flex flex-col gap-0.5">
                            <span
                                className="leading-tight transition-colors group-hover/opt:text-white"
                                style={{ color: 'var(--color-industrial-text)' }}
                            >
                                {opt.label}
                            </span>
                            <span className="leading-tight" style={{ color: 'var(--color-industrial-muted)' }}>
                                {opt.description}
                            </span>
                        </span>
                    </button>
                ))}
            </div>
        </AnchoredOverlay>
    );
}

// =============================================================================
// HeaderSlotTrigger
// Botón `+` individual para un slot vacío.
// Mantiene su propio estado de apertura del menú.
// Recibe `slotIndex` para que el handler de inserción ubique el widget en la
// posición exacta del slot, no siempre al final.
// =============================================================================
interface HeaderSlotTriggerProps {
    slotHighlight: boolean;
    slotIndex: number;
    onAddWidget: (type: WidgetType, slotIndex: number) => void;
}

function HeaderSlotTrigger({ slotHighlight, slotIndex, onAddWidget }: HeaderSlotTriggerProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);

    const handleToggle = useCallback(() => {
        setMenuOpen((prev) => !prev);
    }, []);

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                onClick={handleToggle}
                title="Agregar widget al header"
                className={`
                    relative z-[1]
                    flex h-6 w-6 items-center justify-center
                    rounded-full border transition-all
                    focus:outline-none
                    ${slotHighlight
                        ? 'border-admin-accent/40 text-admin-accent bg-admin-accent/10 hover:bg-admin-accent/20 hover:border-admin-accent/60 hover:shadow-[0_0_10px_color-mix(in_srgb,var(--color-admin-accent)_30%,transparent)]'
                        : 'border-white/10 bg-industrial-surface/80 text-industrial-muted hover:text-admin-accent hover:border-admin-accent/40 hover:bg-admin-accent/10 hover:shadow-[0_0_8px_color-mix(in_srgb,var(--color-admin-accent)_20%,transparent)]'
                    }
                    ${menuOpen ? 'border-admin-accent/60 text-admin-accent bg-admin-accent/15 shadow-[0_0_10px_color-mix(in_srgb,var(--color-admin-accent)_25%,transparent)]' : ''}
                `}
            >
                <Plus size={12} />
            </button>

            <HeaderSlotContextMenu
                triggerRef={triggerRef}
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                onSelect={(type) => onAddWidget(type, slotIndex)}
            />
        </>
    );
}

// =============================================================================
// HeaderWidgetCanvas props
// =============================================================================
interface HeaderWidgetCanvasProps {
    widgets: WidgetConfig[];
    /** Mapa widgetId → columna (0-indexed) para posicionamiento explícito en el grid.
     *  Cuando está presente, cada widget se renderiza en su columna exacta con grid-column. */
    widgetColumnMap?: Map<string, number>;
    equipmentMap: Map<string, EquipmentSummary>;
    connection?: ConnectionHealth;
    machines?: ContractMachine[];
    mode?: 'viewer' | 'preview';
    selectedWidgetId?: string;
    onWidgetSelect?: (widgetId: string) => void;
    onNavigateDashboard?: (dashboardId: string) => void;
    onMoveWidget?: (widgetId: string, targetColumn: number) => void;
    onRemoveWidget?: (widgetId: string) => void;
    onDeleteWidget?: (widgetId: string) => void;
    onHeaderDragEnter?: (event: DragEvent<HTMLDivElement>) => void;
    onHeaderDragOver?: (event: DragEvent<HTMLDivElement>) => void;
    onHeaderDragLeave?: (event: DragEvent<HTMLDivElement>) => void;
    onHeaderDrop?: (event: DragEvent<HTMLDivElement>) => void;
    isHeaderDropActive?: boolean;
    canDropHeaderWidget?: boolean;
    /** Callback para crear y asignar un nuevo widget al header desde el menú del slot vacío.
     *  Recibe el tipo elegido y el índice de columna (0-2) donde fue invocado el `+`. */
    onAddHeaderWidget?: (type: WidgetType, slotIndex: number) => void;
    /** Callback para asignar (por drop desde el grid) un widget existente a una columna específica.
     *  Recibe el widgetId y el índice de columna (0-2) objetivo. */
    onDropWidgetAtSlot?: (widgetId: string, slotIndex: number) => void;
    hierarchyContext?: HierarchyContext;
}

export default function HeaderWidgetCanvas({
    widgets,
    widgetColumnMap,
    equipmentMap,
    connection,
    machines,
    mode = 'viewer',
    selectedWidgetId,
    onWidgetSelect,
    onNavigateDashboard,
    onMoveWidget,
    onRemoveWidget,
    onDeleteWidget,
    onHeaderDragEnter,
    onHeaderDragOver,
    onHeaderDragLeave,
    onHeaderDrop,
    isHeaderDropActive,
    canDropHeaderWidget,
    onAddHeaderWidget,
    onDropWidgetAtSlot,
    hierarchyContext,
}: HeaderWidgetCanvasProps) {
    void hierarchyContext;
    const isPreview = mode === 'preview';
    // Debe mantenerse sincronizado con `.glass-panel { border-radius: 1.5rem }` en hmi-app/src/index.css
    const widgetCornerRadius = '1.5rem';
    const emptySlotWidth = '72px';

    // Construir un mapa columna → widget para el renderizado explícito por columna.
    // Si existe widgetColumnMap usamos sus valores; si no, fallback al índice del array.
    const columnToWidget = new Map<number, WidgetConfig>();
    widgets.forEach((widget, idx) => {
        const col = widgetColumnMap?.get(widget.id) ?? idx;
        columnToWidget.set(col, widget);
    });

    const emptySlotCount = Math.max(HEADER_WIDGET_SLOT_COUNT - widgets.length, 0);
    // Índice del slot vacío que está siendo el drop target activo (para resalte individual)
    const [activeEmptySlotIndex, setActiveEmptySlotIndex] = useState<number | null>(null);
    const showAvailableSlotAffordance = isPreview && canDropHeaderWidget && emptySlotCount > 0;

    const getDragPayload = (event: DragEvent<HTMLDivElement>) => {
        const rawPayload = event.dataTransfer.getData(HEADER_WIDGET_DRAG_MIME);
        return rawPayload ? parseHeaderWidgetDragPayload(rawPayload) : null;
    };

    const resolveDisplayTitle = (widget: WidgetConfig) => {
        const title = widget.title?.trim() ?? '';

        if (widget.type === 'status' || widget.type === 'connection-status') {
            return title;
        }

        return title || widget.type;
    };
    const resolveNavigationTarget = (widget: WidgetConfig) => widget.navigationTargetDashboardId?.trim() ?? '';

    const handleSelectByKeyboard = (
        event: KeyboardEvent<HTMLDivElement>,
        widget: WidgetConfig,
    ) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();

            if (isPreview) {
                onWidgetSelect?.(widget.id);
                return;
            }

            const navigationTargetDashboardId = resolveNavigationTarget(widget);
            if (navigationTargetDashboardId !== '') {
                onNavigateDashboard?.(navigationTargetDashboardId);
            }
        }
    };

    const handleCanvasDragOver = (event: DragEvent<HTMLDivElement>) => {
        onHeaderDragOver?.(event);
    };

    const handleCanvasDragLeave = (event: DragEvent<HTMLDivElement>) => {
        // Limpiar resalte de slot individual si el drag abandonó el canvas completo
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setActiveEmptySlotIndex(null);
        }
        onHeaderDragLeave?.(event);
    };

    const handleCanvasDrop = (event: DragEvent<HTMLDivElement>) => {
        onHeaderDrop?.(event);
    };

    const renderWidgetSurface = (widget: WidgetConfig) => {
        const displayTitle = resolveDisplayTitle(widget);
        const hasDisplayTitle = displayTitle.length > 0;
        const navigationTargetDashboardId = resolveNavigationTarget(widget);
        const isNavigable = !isPreview && navigationTargetDashboardId !== '' && Boolean(onNavigateDashboard);
        const isSelectable = isPreview && Boolean(onWidgetSelect);
        const isInteractive = isNavigable || isSelectable;

        return (
            <div
                data-header-widget-surface="true"
                role={isInteractive ? 'button' : undefined}
                tabIndex={isInteractive ? 0 : undefined}
                aria-label={isInteractive ? (displayTitle || widget.type) : undefined}
                draggable={false}
                onClick={() => {
                    if (isPreview) {
                        onWidgetSelect?.(widget.id);
                        return;
                    }

                    if (isNavigable) {
                        onNavigateDashboard?.(navigationTargetDashboardId);
                    }
                }}
                onKeyDown={(event) => handleSelectByKeyboard(event, widget)}
                className="glass-panel relative flex h-full min-h-18 w-full flex-col px-3 py-2 text-left transition-all focus:outline-none md:w-auto"
                style={{
                    borderRadius: widgetCornerRadius,
                    borderColor: 'color-mix(in srgb, var(--color-industrial-border) 85%, transparent)',
                    boxShadow: 'none',
                    transform: 'scale(1)',
                }}
            >
                <div className="flex flex-1 flex-col justify-center gap-1">
                    <div className="flex items-start justify-between gap-2">
                        {hasDisplayTitle ? (
                            <div className="min-w-0 flex-1">
                                <p className="truncate uppercase text-industrial-muted">
                                    {displayTitle}
                                </p>
                            </div>
                        ) : null}
                    </div>

                    <div className={hasDisplayTitle ? 'border-t border-white/6 pt-1' : ''}>
                        <HeaderWidgetRenderer
                            widget={widget}
                            equipmentMap={equipmentMap}
                            connection={connection}
                            machines={machines}
                            align="start"
                        />
                    </div>
                </div>
            </div>
        );
    };

    // ── Handlers para slots vacíos como drop targets reales ──────────────────
    // Un slot vacío es un destino explícito: al soltar aquí, el widget debe
    // quedar exactamente en ese índice de slot, no simplemente appended al array.
    // El `realSlotIndex` es el índice absoluto dentro del array de HEADER_WIDGET_SLOT_COUNT
    // (los primeros `widgets.length` están ocupados; los siguientes son vacíos).

    const handleEmptySlotDragOver = useCallback((
        event: DragEvent<HTMLDivElement>,
        realSlotIndex: number,
    ) => {
        const payload = getDragPayload(event);

        if (!payload) return;
        if (payload?.source === 'header-canvas') return;
        if (!canDropHeaderWidget) return;

        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setActiveEmptySlotIndex(realSlotIndex);
    }, [canDropHeaderWidget]);

    const handleEmptySlotDragLeave = useCallback((
        event: DragEvent<HTMLDivElement>,
    ) => {
        // Solo limpiar si el foco del drag salió del slot, no si entró a un hijo
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setActiveEmptySlotIndex(null);
        }
    }, []);

    const handleEmptySlotDrop = useCallback((
        event: DragEvent<HTMLDivElement>,
        realSlotIndex: number,
    ) => {
        event.preventDefault();
        event.stopPropagation();
        setActiveEmptySlotIndex(null);

        // Intentar extraer el payload del drag (puede venir del grid del builder)
        const rawPayload = event.dataTransfer.getData(HEADER_WIDGET_DRAG_MIME);
        const payload = rawPayload ? parseHeaderWidgetDragPayload(rawPayload) : null;

        if (!canDropHeaderWidget) return;
        if (!payload || payload.source === 'header-canvas') return;

        onDropWidgetAtSlot?.(payload.widgetId, realSlotIndex);
    }, [canDropHeaderWidget, onDropWidgetAtSlot]);

    return (
        <div
            className="min-w-[18rem] rounded-2xl border border-dashed px-3 py-2.5 transition-all"
            style={{
                borderColor: isPreview && isHeaderDropActive
                    ? 'color-mix(in srgb, var(--color-admin-accent) 60%, transparent)'
                    : 'color-mix(in srgb, var(--color-industrial-border) 100%, transparent)',
                background: 'transparent',
                boxShadow: isPreview && isHeaderDropActive
                    ? '0 0 0 1px color-mix(in srgb, var(--color-admin-accent) 20%, transparent), 0 0 24px color-mix(in srgb, var(--color-admin-accent) 12%, transparent)'
                    : 'none',
            }}
            onDragEnter={onHeaderDragEnter}
            onDragOver={handleCanvasDragOver}
            onDragLeave={handleCanvasDragLeave}
            onDrop={handleCanvasDrop}
        >
            {/* ── Layout de slots del header ──────────────────────────────────────
                Iteramos SIEMPRE los 3 slots en orden.
                En desktop usamos flex con `order` explícito para preservar la
                columna lógica de cada slot, pero sin forzar tracks de igual ancho.
                Así los widgets ocupan solo su contenido y los slots vacíos se
                mantienen compactos con ancho fijo.
             ── */}
            <div className="flex flex-col items-end gap-2.5 md:flex-row md:flex-wrap md:justify-end">
                {Array.from({ length: HEADER_WIDGET_SLOT_COUNT }, (_, colIndex) => {
                    const widget = columnToWidget.get(colIndex);

                    if (widget) {
                        // ── Columna ocupada: renderizar widget ──────────────
                        const isSelected = selectedWidgetId === widget.id;

                        return (
                            <div
                                key={widget.id}
                                className="group relative min-w-0 w-full md:w-auto md:max-w-full md:flex-none"
                                style={{
                                    borderRadius: widgetCornerRadius,
                                    order: colIndex,
                                }}
                                data-header-drop-kind="widget"
                                data-widget-id={widget.id}
                                data-testid={`header-widget-slot-${widget.id}`}
                            >
                                <HeaderSelectionFrame
                                    isSelected={isSelected}
                                    radius={widgetCornerRadius}
                                />

                                {isPreview && (
                                    <WidgetHoverActions
                                        actions={[
                                            ...(colIndex > 0 ? [{
                                                label: 'Mover a la izquierda',
                                                icon: ChevronLeft,
                                                onClick: () => onMoveWidget?.(widget.id, colIndex - 1),
                                            }] : []),
                                            ...(colIndex < HEADER_WIDGET_SLOT_COUNT - 1 ? [{
                                                label: 'Mover a la derecha',
                                                icon: ChevronRight,
                                                onClick: () => onMoveWidget?.(widget.id, colIndex + 1),
                                            }] : []),
                                            {
                                                label: 'Devolver widget al grid',
                                                icon: ArrowDown,
                                                onClick: () => onRemoveWidget?.(widget.id),
                                            },
                                            {
                                                label: 'Eliminar widget',
                                                icon: Trash2,
                                                onClick: () => onDeleteWidget?.(widget.id),
                                            },
                                        ]}
                                    />
                                )}

                                <div>
                                    {renderWidgetSurface(widget)}
                                </div>
                            </div>
                        );
                    }

                    // ── Columna vacía: renderizar slot drop target / botón + ──
                    // Solo visible en modo preview. En viewer, columnas vacías no
                    // se renderizan para no mostrar huecos visuales.
                    if (!isPreview) {
                        return (
                            <div
                                key={`header-viewer-slot-spacer-${colIndex}`}
                                aria-hidden="true"
                                data-header-slot-spacer="true"
                                data-slot-index={colIndex}
                                className="hidden md:block md:flex-none"
                                style={{ minHeight: '72px', width: emptySlotWidth, minWidth: emptySlotWidth, order: colIndex }}
                            />
                        );
                    }

                    const isThisSlotDropTarget = activeEmptySlotIndex === colIndex;
                    const slotHighlight = showAvailableSlotAffordance;
                    const slotActive = (slotHighlight && isHeaderDropActive) || isThisSlotDropTarget;

                    return (
                        <div
                            key={`header-empty-slot-${colIndex}`}
                            data-testid={`header-empty-slot-${colIndex}`}
                            data-header-drop-kind="empty-slot"
                            data-slot-index={colIndex}
                            data-drop-active={isThisSlotDropTarget ? 'true' : 'false'}
                            className="relative flex items-center justify-center rounded-xl border border-dashed transition-all"
                            onDragOver={(e) => handleEmptySlotDragOver(e, colIndex)}
                            onDragLeave={handleEmptySlotDragLeave}
                            onDrop={(e) => handleEmptySlotDrop(e, colIndex)}
                            style={{
                                // Misma geometría base que el widget real del header:
                                // min-h-18 (72px) + px-3 py-2 internos.
                                minHeight: '72px',
                                width: emptySlotWidth,
                                minWidth: emptySlotWidth,
                                borderRadius: widgetCornerRadius,
                                order: colIndex,
                                borderColor: isThisSlotDropTarget
                                    ? 'color-mix(in srgb, var(--color-admin-accent) 80%, transparent)'
                                    : slotHighlight
                                        ? 'color-mix(in srgb, var(--color-admin-accent) 58%, transparent)'
                                        : 'color-mix(in srgb, var(--color-industrial-border) 70%, transparent)',
                                background: slotActive
                                    ? `linear-gradient(135deg,
                                        color-mix(in srgb, var(--color-admin-accent) ${isThisSlotDropTarget ? '20%' : '14%'}, transparent) 0%,
                                        color-mix(in srgb, var(--color-admin-accent) ${isThisSlotDropTarget ? '8%' : '5%'}, transparent) 100%)`
                                    : slotHighlight
                                        ? `linear-gradient(135deg,
                                            color-mix(in srgb, var(--color-admin-accent) 9%, transparent) 0%,
                                            color-mix(in srgb, var(--color-admin-accent) 2%, transparent) 100%)`
                                        : 'color-mix(in srgb, var(--color-industrial-surface) 40%, transparent)',
                                boxShadow: isThisSlotDropTarget
                                    ? '0 0 0 2px color-mix(in srgb, var(--color-admin-accent) 30%, transparent), 0 0 28px color-mix(in srgb, var(--color-admin-accent) 20%, transparent)'
                                    : slotHighlight
                                        ? `0 0 0 1px color-mix(in srgb, var(--color-admin-accent) ${slotActive ? '16%' : '10%'}, transparent),
                                            0 0 ${slotActive ? '24px' : '16px'} color-mix(in srgb, var(--color-admin-accent) ${slotActive ? '16%' : '10%'}, transparent)`
                                        : 'none',
                                opacity: 1,
                                transform: isThisSlotDropTarget ? 'scale(1.02)' : 'scale(1)',
                            }}
                        >
                            {/* El + en modo preview es un botón funcional con menú contextual */}
                            {onAddHeaderWidget ? (
                                <HeaderSlotTrigger
                                    slotHighlight={!!slotHighlight}
                                    slotIndex={colIndex}
                                    onAddWidget={onAddHeaderWidget}
                                />
                            ) : (
                                <Plus
                                    size={14}
                                    className={`relative z-[1] transition-all ${slotHighlight ? 'scale-110' : ''}`}
                                    style={{
                                        color: slotHighlight
                                            ? 'color-mix(in srgb, var(--color-admin-accent) 85%, var(--color-industrial-text))'
                                            : 'color-mix(in srgb, var(--color-industrial-muted) 80%, transparent)',
                                        filter: slotHighlight
                                            ? 'drop-shadow(0 0 10px color-mix(in srgb, var(--color-admin-accent) 22%, transparent))'
                                            : 'none',
                                    }}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
