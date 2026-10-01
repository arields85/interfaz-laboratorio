/** Lengths (px) of the link corner accents, measured from the middle of the corner arc: at rest and while the widget is hovered. */
export interface LinkAccentLengths {
    restPx: number;
    hoverPx: number;
}

/** Geometry of the link corner accents' outer frame: distance to the widget frame and corner radius. */
export interface LinkAccentGeometry {
    offsetPx: number;
    /** Radius (px) of the accent frame's corners. */
    radiusPx: number;
}
