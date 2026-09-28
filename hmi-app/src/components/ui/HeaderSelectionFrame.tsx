interface HeaderSelectionFrameProps {
    isSelected: boolean;
    /**
     * Border-radius del widget subyacente, como longitud CSS. Por defecto el token de tema activo
     * `--frame-radius-rest` (ver `services/themeStyle.service.ts` / `.glass-panel` en index.css).
     */
    radius?: string;
    className?: string;
}

const HEADER_FRAME_OFFSET_PX = 3;
const HEADER_RADIUS_DELTA_PX = 1.5;
// Grosor visual del anillo de foco seleccionado (en px).
const HEADER_BORDER_WIDTH_PX = 2;

// Radio del outer edge del frame, expresado con calc() para quedar "vivo" con el custom property
// de tema en vez de un número calculado una vez en JS: si el tema cambia (o transiciona entre
// rest/hover en el propio elemento), el navegador recalcula esta longitud solo.
function outerRingRadius(radius: string, deltaPx: number): string {
    return `calc(${radius} + ${deltaPx}px)`;
}

// Radio del centro del stroke SVG (rx/ry): outer edge menos la mitad del grosor del trazo.
// max(0px, ...) evita un radio negativo cuando el tema activo tiene radio 0 (p.ej. "Contorno").
function strokeCenterRadius(radius: string, deltaPx: number, halfStrokePx: number): string {
    return `max(0px, calc(${radius} + ${deltaPx}px - ${halfStrokePx}px))`;
}

// Debe mantenerse sincronizado con `.glass-panel { border-radius: var(--frame-radius) }` en
// hmi-app/src/index.css (el default `radius` es el mismo token de tema, `--frame-radius-rest`).
export default function HeaderSelectionFrame({
    isSelected,
    radius = 'var(--frame-radius-rest)',
    className = '',
}: HeaderSelectionFrameProps) {
    const outerRadius = outerRingRadius(radius, HEADER_RADIUS_DELTA_PX);
    const focusRingRadius = strokeCenterRadius(radius, HEADER_RADIUS_DELTA_PX, HEADER_BORDER_WIDTH_PX / 2);

    // ─── Árbol DOM estable ──────────────────────────────────────────────────────
    // Un único div + SVG siempre montados. El estado visual cambia solo via
    // atributos SVG (strokeOpacity, filter) — React actualiza atributos sin
    // desmontar/montar nodos, eliminando el blink blanco al seleccionar.
    //
    // HeaderSelectionFrame no tiene estado isHighlighted (el header no tiene
    // drag-over con hover highlight), por lo que solo tiene el focus-rect.
    // ───────────────────────────────────────────────────────────────────────────
    return (
        <div
            className={`pointer-events-none absolute z-10 ${className}`}
            style={{
                inset: `-${HEADER_FRAME_OFFSET_PX}px`,
                borderRadius: outerRadius,
                // Limitar transiciones a las propiedades reales que cambian. border-radius
                // transiciona junto con --frame-radius del widget para que el anillo siga su
                // cambio de tema.
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
                {/* focus-rect: selection ring in the Design tab admin accent
                    (--color-admin-accent), the same token as GridSelectionFrame and the
                    primary buttons, so every builder selection follows one editable color.
                    stroke centrado sobre el borde del rect; x/y = BORDER/2 para no recortar. */}
                <rect
                    x={HEADER_BORDER_WIDTH_PX / 2}
                    y={HEADER_BORDER_WIDTH_PX / 2}
                    width={`calc(100% - ${HEADER_BORDER_WIDTH_PX}px)`}
                    height={`calc(100% - ${HEADER_BORDER_WIDTH_PX}px)`}
                    fill="none"
                    stroke="var(--color-admin-accent)"
                    strokeWidth={HEADER_BORDER_WIDTH_PX}
                    strokeOpacity={isSelected ? 1 : 0}
                    style={{
                        rx: focusRingRadius,
                        ry: focusRingRadius,
                        transition: 'stroke-opacity 150ms ease, filter 150ms ease, rx 0.2s ease, ry 0.2s ease',
                        filter: isSelected
                            ? [
                                'drop-shadow(0 0 6px color-mix(in srgb, var(--color-admin-accent) 38%, transparent))',
                                'drop-shadow(0 0 2px color-mix(in srgb, var(--color-admin-accent) 28%, transparent))',
                              ].join(' ')
                            : 'none',
                    }}
                />
            </svg>
        </div>
    );
}
