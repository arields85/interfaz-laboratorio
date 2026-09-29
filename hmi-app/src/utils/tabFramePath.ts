// =============================================================================
// Tab frame silhouette
//
// Pure geometry of the tab frame shape ("Forma del marco" = Pestaña) in pixels, for the layers that
// need a real path instead of the CSS `clip-path` polygons of the live frame: the builder selection
// ring and the viewer entrance outline (a stroke that traces itself, `pathLength="1"`).
//
// The silhouette runs clockwise from the top-left corner: the tab (top edge, right side cut by
// `tabCut`), the body top edge, the body's top-right chamfer (`bodyCut`), the right side and the
// bottom edge, whose two corners keep the preset radius. `tabWidth` is the tab's width at its base.
// =============================================================================

export interface TabFramePathGeometry {
    /** Frame box size. */
    width: number;
    height: number;
    /** Tab width measured at its base (the cut side included). */
    tabWidth: number;
    tabHeight: number;
    /** Horizontal size of the tab's right-side cut. */
    tabCut: number;
    /** Size of the body's top-right chamfer. */
    bodyCut: number;
    /** Radius of the two bottom corners. */
    radius: number;
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
 * SVG path (`d`) of the tab silhouette. `inset` moves the outline toward the inside by that many
 * pixels (a stroke centered `inset` px inside the frame edge, like the builder's selection ring).
 */
export function buildTabFramePath(geometry: TabFramePathGeometry, inset = 0): string {
    const { width, height, tabHeight, bodyCut, radius } = geometry;
    // The tab can never run past the start of the body chamfer, and its cut never exceeds its width.
    const tabWidth = Math.max(0, Math.min(geometry.tabWidth, width - bodyCut));
    const tabCut = Math.max(0, Math.min(geometry.tabCut, tabWidth));

    const raw: Point[] = [
        { x: 0, y: 0 },
        { x: tabWidth - tabCut, y: 0 },
        { x: tabWidth, y: tabHeight },
        { x: width - bodyCut, y: tabHeight },
        { x: width, y: tabHeight + bodyCut },
        { x: width, y: height },
        { x: 0, y: height },
    ];

    let points = raw;
    let cornerRadius = Math.max(0, radius);

    if (inset > 0) {
        // Zero-length edges (a clamped tab) would make the offset lines degenerate: merge them first.
        const deduped = raw.filter((point, index) => index === 0 || !samePoint(point, raw[index - 1]));
        points = insetPolygon(deduped, inset);
        cornerRadius = Math.max(0, cornerRadius - inset);
    }

    const bottomRight = points[points.length - 2];
    const bottomLeft = points[points.length - 1];
    const upper = points.slice(0, -2);
    const commands = upper.map((point, index) => `${index === 0 ? 'M' : 'L'} ${format(point.x)} ${format(point.y)}`);

    if (cornerRadius > 0) {
        const r = format(cornerRadius);
        commands.push(
            `L ${format(bottomRight.x)} ${format(bottomRight.y - cornerRadius)}`,
            `A ${r} ${r} 0 0 1 ${format(bottomRight.x - cornerRadius)} ${format(bottomRight.y)}`,
            `L ${format(bottomLeft.x + cornerRadius)} ${format(bottomLeft.y)}`,
            `A ${r} ${r} 0 0 1 ${format(bottomLeft.x)} ${format(bottomLeft.y - cornerRadius)}`,
        );
    } else {
        commands.push(
            `L ${format(bottomRight.x)} ${format(bottomRight.y)}`,
            `L ${format(bottomLeft.x)} ${format(bottomLeft.y)}`,
        );
    }

    return `${commands.join(' ')} Z`;
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
