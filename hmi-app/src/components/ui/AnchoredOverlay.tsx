import { useCallback, useRef, useEffect, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { resolveAnchoredOverlayStyle } from './anchoredOverlayStyle';

// =============================================================================
// AnchoredOverlay — primitive reutilizable para menús flotantes / overlays
//
// Encapsula:
//   - createPortal → escapa cualquier overflow:hidden / stacking context
//   - Posicionamiento fixed anclado al trigger (getBoundingClientRect)
//   - Posicionamiento inteligente: arriba o abajo según espacio disponible
//   - Alineación horizontal: start (izq) | end (der) | center relativo al trigger
//   - Cierre por click afuera
//
// Uso:
//   <AnchoredOverlay
//     triggerRef={myButtonRef}
//     isOpen={open}
//     onClose={() => setOpen(false)}
//     estimatedHeight={180}
//   >
//     <div>Contenido del overlay</div>
//   </AnchoredOverlay>
//
// Regla: TODO menú flotante, dropdown o popover contextual debe usar esta
// primitive. No reimplementar portal/posicionamiento ad-hoc.
// =============================================================================

export type AnchoredOverlayAlign = 'start' | 'end' | 'center';

export interface AnchoredOverlayProps {
    /** Ref del elemento que actúa como anchor/trigger */
    triggerRef: RefObject<HTMLElement | null>;
    /** Controla la visibilidad del overlay */
    isOpen: boolean;
    /** Callback cuando el overlay debe cerrarse (click afuera, Escape) */
    onClose: () => void;
    /** Estimación de altura del contenido para calcular si hay espacio abajo */
    estimatedHeight?: number;
    /** Ancho mínimo del overlay. Por defecto adopta el ancho del trigger. */
    minWidth?: number | 'trigger';
    /** Alineación horizontal respecto al trigger. Default: 'start' */
    align?: AnchoredOverlayAlign;
    /** Gap entre el trigger y el overlay en px. Default: 4 */
    gap?: number;
    /** Contenido del overlay */
    children: ReactNode;
}

export default function AnchoredOverlay({
    triggerRef,
    isOpen,
    onClose,
    estimatedHeight = 200,
    minWidth = 'trigger',
    align = 'start',
    gap = 4,
    children,
}: AnchoredOverlayProps) {
    const overlayRef = useRef<HTMLDivElement>(null);
    const applyResolvedStyle = useCallback((element: HTMLDivElement | null) => {
        if (!element || !isOpen || !triggerRef.current) {
            return;
        }

        const resolvedStyle = resolveAnchoredOverlayStyle(triggerRef.current, estimatedHeight, minWidth, align, gap);
        element.style.position = resolvedStyle.position;
        element.style.left = `${resolvedStyle.left}px`;
        element.style.zIndex = String(resolvedStyle.zIndex);
        element.style.minWidth = typeof resolvedStyle.minWidth === 'number' ? `${resolvedStyle.minWidth}px` : resolvedStyle.minWidth;
        element.style.maxWidth = String(resolvedStyle.maxWidth);

        if (resolvedStyle.top !== undefined) {
            element.style.top = `${resolvedStyle.top}px`;
            element.style.bottom = '';
        } else if (resolvedStyle.bottom !== undefined) {
            element.style.top = '';
            element.style.bottom = `${resolvedStyle.bottom}px`;
        } else {
            element.style.top = '';
            element.style.bottom = '';
        }

        element.style.visibility = 'visible';
    }, [align, estimatedHeight, gap, isOpen, minWidth, triggerRef]);

    // Cerrar al hacer click afuera o presionar Escape
    useEffect(() => {
        if (!isOpen) return;

        const handleClick = (e: MouseEvent) => {
            const target = e.target as Node;
            if (triggerRef.current?.contains(target)) return;
            if (overlayRef.current?.contains(target)) return;
            onClose();
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };

        // Registrar después del click actual para no disparar en el mismo evento de apertura
        const id = setTimeout(() => {
            document.addEventListener('click', handleClick);
            document.addEventListener('keydown', handleKeyDown);
        }, 0);

        return () => {
            clearTimeout(id);
            document.removeEventListener('click', handleClick);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, triggerRef, onClose]);

    if (!isOpen) return null;

    return createPortal(
        <div
            ref={(node) => {
                overlayRef.current = node;
                applyResolvedStyle(node);
            }}
            style={{ position: 'fixed', left: 0, zIndex: 9999, visibility: 'hidden' }}
        >
            {children}
        </div>,
        document.body,
    );
}
