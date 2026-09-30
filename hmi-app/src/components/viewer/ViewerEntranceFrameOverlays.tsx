import { useRef } from 'react';
import type { CSSProperties } from 'react';
import { useTabFrameGeometry } from '../../hooks/useTabFrameGeometry';
import { buildTabFramePath } from '../../utils/tabFramePath';

// =============================================================================
// ViewerEntranceFrameOverlays
// Two decorative layers drawn over a widget frame while the viewer dashboard
// enters: a background flash (V6) and a perimeter outline that traces itself
// (V7). They are siblings of the widget inside the item surface, NOT part of
// any renderer, so they never collide with `.glass-panel::after` (corner
// accents) or `.glass-panel-group::before` (group fill). The surface inset is
// the same one the surface uses as padding, so the layers match the frame box.
// All motion lives in `index.css` under `[data-viewer-entrance='true']`
// (timings: `--viewer-entrance-*` tokens); this component only supplies the
// elements, and is only rendered by the viewer.
//
// Tab frame shape ("Forma del marco" = Pestaña): `tabWidth !== null` means the widget's frame IS the
// tab shape (0 = its tab is not measured yet). Both layers then draw the SAME unified rounded path
// as the frame (`buildTabFramePath`): the flash is clipped to it (`clip-path: path()`) and the
// outline traces it (a `<path>` sharing the rect's animated stroke rule, so timings, fade and
// reduced motion need no second copy). Until the tab width and the box are measured the layers draw
// NOTHING -- a tab-shape widget never shows the rectangle. The standard shape is unchanged.
// =============================================================================

interface ViewerEntranceFrameOverlaysProps {
    widgetId: string;
    /** Same value as the surface padding (`resolveWidgetSurfaceInset`). */
    inset: string;
    /** Tab width (px) of the widget's tab frame, when it is the tab shape. */
    tabWidth?: number | null;
    /** Effective tab height (px) of a taller tab (title with its own size); absent = `--tab-frame-height`. */
    tabHeight?: number;
}

export default function ViewerEntranceFrameOverlays({ widgetId, inset, tabWidth = null, tabHeight }: ViewerEntranceFrameOverlaysProps) {
    const outlineRef = useRef<HTMLDivElement>(null);
    const tabGeometry = useTabFrameGeometry(outlineRef, tabWidth, tabHeight);
    const isTabShape = tabWidth !== null;
    const silhouette = tabGeometry ? buildTabFramePath(tabGeometry) : null;
    const flashStyle: CSSProperties = silhouette ? { inset, clipPath: `path('${silhouette}')` } : { inset };

    return (
        <>
            {(!isTabShape || silhouette) && (
                <div
                    data-testid={`dashboard-viewer-entrance-flash-${widgetId}`}
                    aria-hidden="true"
                    className="hmi-viewer-entrance-flash"
                    style={flashStyle}
                />
            )}
            {/* A replaced element (svg) does not stretch between insets, so a div carries the inset.
                In the tab shape the div also carries the frame radius the geometry hook reads. */}
            <div
                ref={outlineRef}
                data-testid={`dashboard-viewer-entrance-outline-${widgetId}`}
                aria-hidden="true"
                className="hmi-viewer-entrance-outline"
                style={isTabShape ? { inset, borderRadius: 'var(--frame-radius-rest)' } : { inset }}
            >
                <svg className="hmi-viewer-entrance-outline-svg">
                    {/* pathLength=1 normalizes the dash keyframes: the same 1 -> 0 offset traces any size. */}
                    {silhouette ? (
                        <path
                            className="hmi-viewer-entrance-outline-rect hmi-viewer-entrance-outline-path"
                            d={silhouette}
                            pathLength="1"
                        />
                    ) : !isTabShape ? (
                        <rect className="hmi-viewer-entrance-outline-rect" x="0" y="0" width="100%" height="100%" pathLength="1" />
                    ) : null}
                </svg>
            </div>
        </>
    );
}
