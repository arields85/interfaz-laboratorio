import { useId } from 'react';

interface GridSelectionFrameProps {
    isSelected: boolean;
    isHighlighted?: boolean;
    /** Border-radius del widget subyacente. Debe coincidir con .glass-panel en index.css. */
    radius?: string;
    className?: string;
    /**
     * Separación entre el frame de selección y el borde del grid item. Por defecto coincide con el
     * inset visual estándar de cualquier widget (`--widget-spacing`); un contenedor de grupo (G9)
     * pasa `0px` para que el anillo de selección coincida con su propio frame, que ya no usa ese
     * inset.
     */
    inset?: string;
}

const GRID_RADIUS_DELTA_PX = 0;
// Grosor visual del anillo de foco seleccionado (en px).
const GRID_BORDER_WIDTH_PX = 2;

// Convierte un valor CSS de radio a px para atributos SVG (rx, ry).
// Solo maneja rem y px — suficiente para los valores que pasan los callers actuales.
function radiusToPx(value: string): number {
    if (value.endsWith('rem')) return parseFloat(value) * 16;
    if (value.endsWith('px'))  return parseFloat(value);
    return parseFloat(value);
}

// Debe mantenerse sincronizado con `.glass-panel { border-radius: 1.5rem }` en hmi-app/src/index.css
export default function GridSelectionFrame({
    isSelected,
    isHighlighted = false,
    radius = '1.5rem',
    className = '',
    inset = 'var(--widget-spacing)',
}: GridSelectionFrameProps) {
    // useId garantiza un ID de gradiente único por instancia — evita colisiones de <defs> SVG en el DOM.
    const gradientId = useId();

    const radiusPx = radiusToPx(radius);
    // Radio del outer edge del frame: widget_radius + delta de concentricidad
    const outerRadiusPx = radiusPx + GRID_RADIUS_DELTA_PX;
    // Radio del centro del stroke SVG: outer - mitad del grosor
    const rectRxPx = outerRadiusPx - GRID_BORDER_WIDTH_PX / 2;

    // ─── Árbol DOM estable ──────────────────────────────────────────────────────
    // Un único div + SVG siempre montados. El estado visual cambia solo via
    // atributos SVG (strokeOpacity, filter) — React actualiza atributos sin
    // desmontar/montar nodos, eliminando el blink blanco al seleccionar.
    //
    // Dos rectángulos SVG superpuestos:
    //   hover-rect  → borde sutil blanco durante drag-hover (isHighlighted)
    //   focus-rect  → anillo de gradiente azul→violeta al seleccionar (isSelected)
    // ───────────────────────────────────────────────────────────────────────────
    return (
        <div
            data-testid="grid-selection-frame"
            className={`pointer-events-none absolute z-10 ${className}`}
            style={{
                inset,
                borderRadius: `${outerRadiusPx}px`,
                // Limitar transiciones a las propiedades reales que cambian.
                // transition-all anima 'display' y otras propiedades no interpolables,
                // causando frames intermedios blancos.
                transition: 'opacity 150ms ease',
            }}
        >
            <svg
                aria-hidden="true"
                style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    overflow: 'visible',
                }}
            >
                <defs>
                    {/* stopColor vía style para respetar los tokens CSS del sistema de diseño */}
                    <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%"   style={{ stopColor: 'var(--color-admin-selection-from)' }} />
                        <stop offset="100%" style={{ stopColor: 'var(--color-admin-selection-to)' }} />
                    </linearGradient>
                </defs>

                {/* hover-rect: borde sutil visible durante drag-over (isHighlighted).
                    Stroke blanco semitransparente, solo el grosor de 1px. */}
                <rect
                    x={0.5}
                    y={0.5}
                    width="calc(100% - 1px)"
                    height="calc(100% - 1px)"
                    rx={outerRadiusPx - 0.5}
                    ry={outerRadiusPx - 0.5}
                    fill={isHighlighted ? 'color-mix(in srgb, var(--color-admin-selection-from) 10%, transparent)' : 'none'}
                    stroke="white"
                    strokeWidth={1}
                    strokeOpacity={isHighlighted ? 0.18 : 0}
                    style={{ transition: 'stroke-opacity 120ms ease, fill-opacity 120ms ease' }}
                />

                {/* focus-rect: anillo de gradiente al seleccionar.
                    stroke centrado sobre el borde del rect; x/y = BORDER/2 para no recortar. */}
                <rect
                    x={GRID_BORDER_WIDTH_PX / 2}
                    y={GRID_BORDER_WIDTH_PX / 2}
                    width={`calc(100% - ${GRID_BORDER_WIDTH_PX}px)`}
                    height={`calc(100% - ${GRID_BORDER_WIDTH_PX}px)`}
                    rx={rectRxPx}
                    ry={rectRxPx}
                    fill="none"
                    stroke={`url(#${gradientId})`}
                    strokeWidth={GRID_BORDER_WIDTH_PX}
                    strokeOpacity={isSelected ? 1 : 0}
                    style={{
                        transition: 'stroke-opacity 150ms ease, filter 150ms ease',
                        filter: isSelected
                            ? [
                                'drop-shadow(0 0 8px color-mix(in srgb, var(--color-admin-selection-to) 40%, transparent))',
                                'drop-shadow(0 0 3px color-mix(in srgb, var(--color-admin-selection-from) 30%, transparent))',
                              ].join(' ')
                            : 'none',
                    }}
                />
            </svg>
        </div>
    );
}
