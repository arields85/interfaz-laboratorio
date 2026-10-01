/** Lengths (px) of the link corner accents' straight tail: at rest and while the widget is hovered. */
export interface LinkAccentLengths {
    restPx: number;
    hoverPx: number;
}

/** Geometry of the link corner accents' outer frame: distance to the widget frame and corner radius (null = automatic). */
export interface LinkAccentGeometry {
    offsetPx: number;
    /** Absolute radius (px) of the accent frame; `null` = frame radius + distance. */
    radiusPx: number | null;
}
