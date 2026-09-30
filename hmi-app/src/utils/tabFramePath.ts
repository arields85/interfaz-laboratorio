// =============================================================================
// Tab frame silhouette
//
// Pure geometry of the tab frame shape ("Forma del marco" = Pestaña) in pixels. CSS `clip-path:
// polygon()` cannot round corners, so every layer that draws the shape uses a real path
// (`clip-path: path()` or an SVG stroke) built here from the measured box and the `--tab-frame-*`
// tokens: the frame clip, its border, the alert glow, the builder selection ring and ghosts and the
// viewer entrance flash and outline (a stroke that traces itself, `pathLength="1"`).
//
// The silhouette runs clockwise from the top-left corner: the tab (top edge, right side cut by
// `tabCut`), the body top edge, the body's top-right chamfer (`bodyCut`), the right side and the
// bottom edge. ONE path serves every layer that draws the shape (frame clip, border, glow, builder
// rings, entrance flash and outline); every corner takes `radius`. `tabWidth` is the tab's width at
// its base.
// =============================================================================

/**
 * Tab width REPORTED by a frame (`TabFrameReporter`) that is the tab shape but has hidden its title
 * tab because its strip content (a chart's selector and icon) leaves the title no room. `0` keeps
 * meaning "tab shape, not measured yet"; a positive width is the measured tab. The silhouette of a
 * hidden tab is `TabFramePathGeometry.tabWidth = 0`.
 */
export const TAB_FRAME_TITLE_HIDDEN = -1;

export interface TabFramePathGeometry {
    /** Frame box size. */
    width: number;
    height: number;
    /**
     * Tab width measured at its base (the cut side included). `0` = no title tab: the silhouette
     * starts at the body's top line (its top-left corner stays a convex rounded corner).
     */
    tabWidth: number;
    tabHeight: number;
    /** Horizontal size of the tab's right-side cut. */
    tabCut: number;
    /** Size of the body's top-right chamfer. */
    bodyCut: number;
    /** Radius of every corner (the frame radius of the active preset). */
    radius: number;
    /** Spread (px) of the warning/critical glow around the silhouette; absent = no glow. */
    glowSpread?: number;
}

interface Point {
    x: number;
    y: number;
}

function format(value: number): string {
    return String(Number(value.toFixed(3)));
}

function samePoint(a: Point, b: Point): boolean {
    return a.x === b.x && a.y === b.y;
}

/**
 * Insets a clockwise (screen coordinates) polygon by `distance`: each edge moves along its inward
 * normal and every vertex becomes the intersection of its two neighbouring offset edges.
 */
function insetPolygon(points: Point[], distance: number): Point[] {
    const count = points.length;

    return points.map((point, index) => {
        const previous = points[(index - 1 + count) % count];
        const next = points[(index + 1) % count];
        const incoming = { x: point.x - previous.x, y: point.y - previous.y };
        const outgoing = { x: next.x - point.x, y: next.y - point.y };
        const incomingLength = Math.hypot(incoming.x, incoming.y);
        const outgoingLength = Math.hypot(outgoing.x, outgoing.y);
        const u1 = { x: incoming.x / incomingLength, y: incoming.y / incomingLength };
        const u2 = { x: outgoing.x / outgoingLength, y: outgoing.y / outgoingLength };
        // Inward normal of a clockwise polygon in screen coordinates: (-dy, dx).
        const a = { x: point.x - u1.y * distance, y: point.y + u1.x * distance };
        const b = { x: point.x - u2.y * distance, y: point.y + u2.x * distance };
        const cross = u1.x * u2.y - u1.y * u2.x;

        if (Math.abs(cross) < 1e-9) {
            return a;
        }

        // Intersection of a + s * u1 and b + t * u2.
        const s = ((b.x - a.x) * u2.y - (b.y - a.y) * u2.x) / cross;

        return { x: a.x + s * u1.x, y: a.y + s * u1.y };
    });
}

/**
 * Rounds a clockwise polygon: every vertex becomes an arc tangent to its two edges. `radiusFor`
 * gives the radius of each vertex (convex or concave); the tangent distance is capped at half of the
 * shorter adjacent edge so neighbouring arcs never overlap. Collinear vertices stay plain points.
 */
function roundedPolygonPath(points: Point[], radiusFor: (convex: boolean) => number): string {
    const count = points.length;
    const corners = points.map((point, index) => {
        const previous = points[(index - 1 + count) % count];
        const next = points[(index + 1) % count];
        const incoming = { x: point.x - previous.x, y: point.y - previous.y };
        const outgoing = { x: next.x - point.x, y: next.y - point.y };
        const incomingLength = Math.hypot(incoming.x, incoming.y);
        const outgoingLength = Math.hypot(outgoing.x, outgoing.y);
        const u1 = { x: incoming.x / incomingLength, y: incoming.y / incomingLength };
        const u2 = { x: outgoing.x / outgoingLength, y: outgoing.y / outgoingLength };
        const cross = u1.x * u2.y - u1.y * u2.x;
        const dot = u1.x * u2.x + u1.y * u2.y;
        const turn = Math.atan2(Math.abs(cross), dot);
        // Clockwise polygon in screen coordinates: a positive cross is a convex vertex.
        const radius = radiusFor(cross > 0);

        if (turn < 1e-6 || radius <= 0) {
            return { point, start: point, end: point, radius: 0, sweep: 0 };
        }

        const distance = Math.min(radius * Math.tan(turn / 2), incomingLength / 2, outgoingLength / 2);

        return {
            point,
            start: { x: point.x - u1.x * distance, y: point.y - u1.y * distance },
            end: { x: point.x + u2.x * distance, y: point.y + u2.y * distance },
            radius: distance / Math.tan(turn / 2),
            sweep: cross > 0 ? 1 : 0,
        };
    });

    const arc = (corner: (typeof corners)[number]) => {
        if (corner.radius === 0) {
            return [];
        }

        const r = format(corner.radius);

        return [`A ${r} ${r} 0 0 ${corner.sweep} ${format(corner.end.x)} ${format(corner.end.y)}`];
    };
    const first = corners[0];
    const commands = [`M ${format(first.end.x)} ${format(first.end.y)}`];

    for (const corner of corners.slice(1)) {
        commands.push(`L ${format(corner.start.x)} ${format(corner.start.y)}`, ...arc(corner));
    }

    if (first.radius > 0) {
        commands.push(`L ${format(first.start.x)} ${format(first.start.y)}`, ...arc(first));
    }

    return `${commands.join(' ')} Z`;
}

/**
 * SVG path (`d`) of the unified tab + body silhouette: EVERY corner (the tab's two free corners,
 * the concave junction where the tab diagonal meets the body top, both vertices of the body's
 * diagonal cut and the bottom/left corners) is rounded with `geometry.radius`. `inset` moves the
 * outline toward the inside by that many pixels (negative = outward): convex corners follow the
 * offset curve (`radius - inset`), the concave junction grows (`radius + inset`).
 */
export function buildTabFramePath(geometry: TabFramePathGeometry, inset = 0): string {
    const { width, height, radius } = geometry;
    // The chamfer fits the box, and the tab never takes the vertical room the chamfer needs: with a
    // tab taller than `height - bodyCut` the polygon would fold over itself.
    const bodyCut = Number.isFinite(geometry.bodyCut) ? Math.max(0, Math.min(geometry.bodyCut, width, height)) : 0;
    const tabHeight = Number.isFinite(geometry.tabHeight) ? Math.max(0, Math.min(geometry.tabHeight, height - bodyCut)) : 0;
    // The tab can never run past the start of the body chamfer, and its cut never exceeds its width.
    const tabWidth = Math.max(0, Math.min(geometry.tabWidth, width - bodyCut));
    const tabCut = Math.max(0, Math.min(geometry.tabCut, tabWidth));

    // Without a title tab the outline starts at the body's top-left corner instead of running up to the top edge.
    const tabPoints: Point[] = tabWidth > 0
        ? [{ x: 0, y: 0 }, { x: tabWidth - tabCut, y: 0 }, { x: tabWidth, y: tabHeight }]
        : [{ x: 0, y: tabHeight }];
    const raw: Point[] = [
        ...tabPoints,
        { x: width - bodyCut, y: tabHeight },
        { x: width, y: tabHeight + bodyCut },
        { x: width, y: height },
        { x: 0, y: height },
    ];
    // Zero-length edges (a clamped tab) would make the corner maths degenerate: merge them first.
    const deduped = raw.filter((point, index) => !samePoint(point, raw[(index - 1 + raw.length) % raw.length]));
    const points = inset === 0 ? deduped : insetPolygon(deduped, inset);
    const baseRadius = Math.max(0, radius);

    return roundedPolygonPath(points, (convex) => Math.max(0, convex ? baseRadius - inset : baseRadius + inset));
}

/** Ink margin (px) of the glow clip: further than the glow blur can reach. */
export const TAB_FRAME_GLOW_CLIP_MARGIN_PX = 64;

/**
 * Even-odd `clip-path: path(evenodd, ...)` for the alert glow: a rectangle `margin` px larger than
 * the frame on every side with the silhouette punched out, so only what lies OUTSIDE the shape
 * survives (the glow of the standard frame is a `box-shadow`, which is never painted inside).
 */
export function buildTabFrameGlowClipPath(geometry: TabFramePathGeometry, margin: number): string {
    const right = format(geometry.width + margin);
    const bottom = format(geometry.height + margin);
    const start = format(-margin);

    return `M ${start} ${start} H ${right} V ${bottom} H ${start} Z ${buildTabFramePath(geometry)}`;
}

/**
 * Resolves a computed CSS length (`px` or `rem`) to pixels. Anything else (calc, var, keywords,
 * empty) resolves to 0 rather than a guess.
 */
export function parseCssLengthPx(value: string, rootFontSizePx: number): number {
    const trimmed = value.trim();

    if (trimmed === '0') {
        return 0;
    }

    const match = /^(-?\d*\.?\d+)(px|rem)$/.exec(trimmed);

    if (!match) {
        return 0;
    }

    const amount = Number(match[1]);

    return match[2] === 'rem' ? amount * rootFontSizePx : amount;
}
