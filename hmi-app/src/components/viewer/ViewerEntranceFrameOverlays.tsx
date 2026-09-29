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
// Tab frame shape ("Forma del marco" = Pestaña): when the widget reports the width of its tab
// (`tabWidth`), the flash is clipped to the tab + chamfered body silhouette (CSS polygon over the
// `--tab-frame-*` tokens, the tab width in a custom property) and the outline traces a `<path>` of
// that silhouette instead of the rect. The path takes the SAME animated stroke rule as the rect
// (`hmi-viewer-entrance-outline-rect`), so the timings, the fade and the reduced-motion handling
// need no second copy. The standard shape is unchanged.
// =============================================================================

interface ViewerEntranceFrameOverlaysProps {
    widgetId: string;
    /** Same value as the surface padding (`resolveWidgetSurfaceInset`). */
    inset: string;
    /** Tab width (px) of the widget's tab frame, when it is the tab shape. */
    tabWidth?: number | null;
}

type FlashStyle = CSSProperties & { '--tab-frame-tab-width'?: string };

export default function ViewerEntranceFrameOverlays({ widgetId, inset, tabWidth = null }: ViewerEntranceFrameOverlaysProps) {
    const outlineRef = useRef<HTMLDivElement>(null);
    const tabGeometry = useTabFrameGeometry(outlineRef, tabWidth);
    const flashStyle: FlashStyle = tabWidth === null
        ? { inset }
        : { inset, '--tab-frame-tab-width': `${tabWidth}px` };

    return (
        <>
            <div
                data-testid={`dashboard-viewer-entrance-flash-${widgetId}`}
                aria-hidden="true"
                className={tabWidth === null ? 'hmi-viewer-entrance-flash' : 'hmi-viewer-entrance-flash hmi-viewer-entrance-flash-tab'}
                style={flashStyle}
            />
            {/* A replaced element (svg) does not stretch between insets, so a div carries the inset.
                In the tab shape the div also carries the frame radius the geometry hook reads. */}
            <div
                ref={outlineRef}
                data-testid={`dashboard-viewer-entrance-outline-${widgetId}`}
                aria-hidden="true"
                className="hmi-viewer-entrance-outline"
                style={tabWidth === null ? { inset } : { inset, borderRadius: 'var(--frame-radius-rest)' }}
            >
                <svg className="hmi-viewer-entrance-outline-svg">
                    {/* pathLength=1 normalizes the dash keyframes: the same 1 -> 0 offset traces any size. */}
                    {tabGeometry ? (
                        <path
                            className="hmi-viewer-entrance-outline-rect hmi-viewer-entrance-outline-path"
                            d={buildTabFramePath(tabGeometry)}
                            pathLength="1"
                        />
                    ) : (
                        <rect className="hmi-viewer-entrance-outline-rect" x="0" y="0" width="100%" height="100%" pathLength="1" />
                    )}
                </svg>
            </div>
        </>
    );
}
