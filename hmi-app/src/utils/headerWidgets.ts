import type { WidgetConfig, WidgetType } from '../domain/admin.types';

export const HEADER_COMPATIBLE_WIDGET_TYPES = ['status', 'connection-status'] as const;
export const HEADER_WIDGET_SLOT_COUNT = 3;
export const HEADER_WIDGET_SLOT_HEIGHT_PX = 72;

export const HEADER_WIDGET_DRAG_MIME = 'application/x-interfaz-laboratorio-header-widget';

export interface HeaderWidgetDragPayload {
    widgetId: string;
    widgetType: WidgetType;
    source: 'builder-grid' | 'header-canvas';
}

export function isHeaderCompatibleWidgetType(type: WidgetType): type is (typeof HEADER_COMPATIBLE_WIDGET_TYPES)[number] {
    return (HEADER_COMPATIBLE_WIDGET_TYPES as readonly string[]).includes(type);
}

export function isHeaderCompatibleWidget(widget: WidgetConfig): boolean {
    return isHeaderCompatibleWidgetType(widget.type);
}

export function serializeHeaderWidgetDragPayload(payload: HeaderWidgetDragPayload): string {
    return JSON.stringify(payload);
}

export function parseHeaderWidgetDragPayload(value: string): HeaderWidgetDragPayload | null {
    try {
        const parsed = JSON.parse(value) as Partial<HeaderWidgetDragPayload>;

        if (
            typeof parsed.widgetId !== 'string'
            || typeof parsed.widgetType !== 'string'
            || (parsed.source !== 'builder-grid' && parsed.source !== 'header-canvas')
        ) {
            return null;
        }

        return {
            widgetId: parsed.widgetId,
            widgetType: parsed.widgetType as WidgetType,
            source: parsed.source,
        };
    } catch {
        return null;
    }
}

/**
 * Retorna el índice del primer slot libre del header (0, 1 o 2)
 * recorriendo de izquierda a derecha.
 *
 * @param occupiedColumns - Conjunto de columnas ya ocupadas (valores de `column` de los slots).
 * @returns El índice del primer slot libre, o `null` si los 3 están ocupados.
 */
export function getFirstFreeHeaderSlot(occupiedColumns: ReadonlySet<number>): number | null {
    for (let i = 0; i < HEADER_WIDGET_SLOT_COUNT; i++) {
        if (!occupiedColumns.has(i)) return i;
    }
    return null;
}
