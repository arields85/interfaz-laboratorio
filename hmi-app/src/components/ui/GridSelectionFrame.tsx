import { useRef } from 'react';
import { useTabFrameGeometry } from '../../hooks/useTabFrameGeometry';
import { buildTabFramePath } from '../../utils/tabFramePath';

interface GridSelectionFrameProps {
    isSelected: boolean;
    isHighlighted?: boolean;
    /**
     * Border-radius del widget subyacente, como longitud CSS. Por defecto el token de tema activo
     * `--frame-radius-rest` (ver `services/themeStyle.service.ts` / `.glass-panel` en index.css);
     * un widget sin frame (p.ej. TextTitle) pasa un literal `'0px'`.
     */
    radius?: string;
    className?: string;
    /**
     * Separación entre el frame de selección y el borde del grid item. Por defecto coincide con el
     * inset visual estándar de cualquier widget (`--widget-spacing`); un contenedor de grupo (G9)
     * pasa `0px` para que el anillo de selección coincida con su propio frame, que ya no usa ese
     * inset.
     */
    inset?: string;
    /**
     * Tab width (px) of the widget's tab frame, when its frame is the tab shape ("Forma del marco"
     * = Pestaña; reported by `WidgetFrame` through `useTabFrameWidths`). The rings then trace the
     * tab + chamfered body silhouette instead of the rounded rect; `null`/absent keeps the rect.
     */
    tabWidth?: number | null;
}

const GRID_RADIUS_DELTA_PX = 0;
// Grosor visual del anillo de foco seleccionado (en px).
const GRID_BORDER_WIDTH_PX = 2;

// Radio del outer edge del frame, expresado con calc() para quedar "vivo" con el custom property
// de tema en vez de un número calculado una vez en JS: si el tema cambia (o transiciona entre
// rest/hover en el propio elemento), el navegador recalcula esta longitud solo.
function outerRingRadius(radius: string, deltaPx: number): string {
    return `calc(${radius} + ${deltaPx}px)`;
}

// Radio del centro del stroke SVG (rx/ry): outer edge menos la mitad del grosor del trazo.
// max(0px, ...) evita un radio negativo cuando el tema activo tiene radio 0 (p.ej. "Contorno")
// y el offset de concentricidad no alcanza a compensar el grosor del trazo.
function strokeCenterRadius(radius: string, deltaPx: number, halfStrokePx: number): string {
    return `max(0px, calc(${radius} + ${deltaPx}px - ${halfStrokePx}px))`;
}

export default function GridSelectionFrame({
    isSelected,
    isHighlighted = false,
    radius = 'var(--frame-radius-rest)',
    className = '',
    inset = 'var(--widget-spacing)',
    tabWidth = null,
}: GridSelectionFrameProps) {
    const frameRef = useRef<HTMLDivElement>(null);
    const tabGeometry = useTabFrameGeometry(frameRef, tabWidth);
    const outerRadius = outerRingRadius(radius, GRID_RADIUS_DELTA_PX);
    // rx/ry del hover-rect (trazo de 1px, centrado 0.5px hacia adentro del outer edge).
    const hoverRingRadius = strokeCenterRadius(radius, GRID_RADIUS_DELTA_PX, 0.5);
    // rx/ry del focus-rect (trazo de GRID_BORDER_WIDTH_PX, centrado a la mitad de su grosor).
    const focusRingRadius = strokeCenterRadius(radius, GRID_RADIUS_DELTA_PX, GRID_BORDER_WIDTH_PX / 2);

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
            ref={frameRef}
            data-testid="grid-selection-frame"
            className={`pointer-events-none absolute z-10 ${className}`}
            style={{
                inset,
                borderRadius: outerRadius,
                // Limitar transiciones a las propiedades reales que cambian.
                // transition-all anima 'display' y otras propiedades no interpolables,
                // causando frames intermedios blancos. border-radius transiciona junto con
                // --frame-radius del widget para que el anillo siga su cambio de tema.
                transition: 'opacity 150ms ease, border-radius 0.2s ease',
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
                {tabGeometry ? (
                    <>
                        {/* Pestaña: mismos dos anillos (hover y foco) sobre la silueta pestaña + cuerpo. */}
                        <path
                            data-ring="hover"
                            d={buildTabFramePath(tabGeometry, 0.5)}
                            fill={isHighlighted ? 'color-mix(in srgb, var(--color-admin-accent) 10%, transparent)' : 'none'}
                            stroke="white"
                            strokeWidth={1}
                            strokeOpacity={isHighlighted ? 0.18 : 0}
                            style={{
                                transition: 'stroke-opacity 120ms ease, fill-opacity 120ms ease',
                            }}
                        />
                        <path
                            data-ring="focus"
                            d={buildTabFramePath(tabGeometry, GRID_BORDER_WIDTH_PX / 2)}
                            fill="none"
                            stroke="var(--color-admin-accent)"
                            strokeWidth={GRID_BORDER_WIDTH_PX}
                            strokeOpacity={isSelected ? 1 : 0}
                            style={{
                                transition: 'stroke-opacity 150ms ease, filter 150ms ease',
                                filter: isSelected
                                    ? [
                                        'drop-shadow(0 0 8px color-mix(in srgb, var(--color-admin-accent) 40%, transparent))',
                                        'drop-shadow(0 0 3px color-mix(in srgb, var(--color-admin-accent) 30%, transparent))',
                                      ].join(' ')
                                    : 'none',
                            }}
                        />
                    </>
                ) : (
                    <>
                        {/* hover-rect: borde sutil visible durante drag-over (isHighlighted).
                            Stroke blanco semitransparente, solo el grosor de 1px. */}
                        <rect
                            x={0.5}
                            y={0.5}
                            width="calc(100% - 1px)"
                            height="calc(100% - 1px)"
                            fill={isHighlighted ? 'color-mix(in srgb, var(--color-admin-accent) 10%, transparent)' : 'none'}
                            stroke="white"
                            strokeWidth={1}
                            strokeOpacity={isHighlighted ? 0.18 : 0}
                            style={{
                                rx: hoverRingRadius,
                                ry: hoverRingRadius,
                                transition: 'stroke-opacity 120ms ease, fill-opacity 120ms ease, rx 0.2s ease, ry 0.2s ease',
                            }}
                        />

                        {/* focus-rect: anillo al seleccionar, en el color de acento admin editable desde
                            la pestaña Diseño (--color-admin-accent) — el mismo token que colorea los
                            botones primarios (.admin-accent-ghost). Antes usaba
                            --color-admin-selection-from/-to, que no es editable ahí. Color sólido: un
                            degradado de dos paradas del MISMO token no aportaría variación visual.
                            stroke centrado sobre el borde del rect; x/y = BORDER/2 para no recortar. */}
                        <rect
                            x={GRID_BORDER_WIDTH_PX / 2}
                            y={GRID_BORDER_WIDTH_PX / 2}
                            width={`calc(100% - ${GRID_BORDER_WIDTH_PX}px)`}
                            height={`calc(100% - ${GRID_BORDER_WIDTH_PX}px)`}
                            fill="none"
                            stroke="var(--color-admin-accent)"
                            strokeWidth={GRID_BORDER_WIDTH_PX}
                            strokeOpacity={isSelected ? 1 : 0}
                            style={{
                                rx: focusRingRadius,
                                ry: focusRingRadius,
                                transition: 'stroke-opacity 150ms ease, filter 150ms ease, rx 0.2s ease, ry 0.2s ease',
                                filter: isSelected
                                    ? [
                                        'drop-shadow(0 0 8px color-mix(in srgb, var(--color-admin-accent) 40%, transparent))',
                                        'drop-shadow(0 0 3px color-mix(in srgb, var(--color-admin-accent) 30%, transparent))',
                                      ].join(' ')
                                    : 'none',
                            }}
                        />
                    </>
                )}
            </svg>
        </div>
    );
}
