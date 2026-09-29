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
// =============================================================================

interface ViewerEntranceFrameOverlaysProps {
    widgetId: string;
    /** Same value as the surface padding (`resolveWidgetSurfaceInset`). */
    inset: string;
}

export default function ViewerEntranceFrameOverlays({ widgetId, inset }: ViewerEntranceFrameOverlaysProps) {
    return (
        <>
            <div
                data-testid={`dashboard-viewer-entrance-flash-${widgetId}`}
                aria-hidden="true"
                className="hmi-viewer-entrance-flash"
                style={{ inset }}
            />
            {/* A replaced element (svg) does not stretch between insets, so a div carries the inset. */}
            <div
                data-testid={`dashboard-viewer-entrance-outline-${widgetId}`}
                aria-hidden="true"
                className="hmi-viewer-entrance-outline"
                style={{ inset }}
            >
                <svg className="hmi-viewer-entrance-outline-svg">
                    {/* pathLength=1 normalizes the dash keyframes: the same 1 -> 0 offset traces any size. */}
                    <rect className="hmi-viewer-entrance-outline-rect" x="0" y="0" width="100%" height="100%" pathLength="1" />
                </svg>
            </div>
        </>
    );
}
