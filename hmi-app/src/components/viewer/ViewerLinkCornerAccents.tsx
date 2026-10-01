// =============================================================================
// ViewerLinkCornerAccents
// Decorative layer of the "Esquinas en widgets con enlace" setting: the four corner brackets of the
// Contorno frame accent, drawn a few pixels OUTSIDE the widget frame of a widget that navigates on
// click. It is a sibling of the widget inside the item surface (like `ViewerEntranceFrameOverlays`),
// never part of the clipped frame, so it cannot collide with `.glass-panel::after`. The surface
// inset is the same one the surface uses as padding; the layer sits that inset minus
// `--link-accent-offset` from the item edge. Hover animation, sizes and reduced motion live in
// `index.css` (`.hmi-link-accents`, driven by the hovered `.hmi-link-accents-host` item).
// =============================================================================

interface ViewerLinkCornerAccentsProps {
    widgetId: string;
    /** Same value as the surface padding (`resolveWidgetSurfaceInset`). */
    inset: string;
}

export default function ViewerLinkCornerAccents({ widgetId, inset }: ViewerLinkCornerAccentsProps) {
    return (
        <div
            data-testid={`dashboard-viewer-link-accents-${widgetId}`}
            aria-hidden="true"
            className="hmi-link-accents"
            style={{ inset: `calc(${inset} - var(--link-accent-offset))` }}
        />
    );
}
