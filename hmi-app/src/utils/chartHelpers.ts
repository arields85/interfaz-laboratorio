/**
 * Shared SVG chart math utilities.
 *
 * Centraliza helpers reutilizables para trazado de paths, formato de ejes
 * y operaciones numéricas comunes entre renderers SVG de widgets.
 */
export interface Point {
    x: number;
    y: number;
}

export function smoothPath(points: Point[]): string {
    if (points.length === 0) return '';

    let d = `M ${points[0].x} ${points[0].y}`;
    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        const controlX = (previous.x + current.x) / 2;
        d += ` C ${controlX} ${previous.y}, ${controlX} ${current.y}, ${current.x} ${current.y}`;
    }

    return d;
}

export function buildAreaPath(path: string, points: Point[], baselineY: number): string {
    if (points.length === 0 || path.length === 0) return '';

    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    return `${path} L ${lastPoint.x} ${baselineY} L ${firstPoint.x} ${baselineY} Z`;
}

export function formatTick(value: number): string {
    return value >= 10 ? Math.round(value).toString() : value.toFixed(1);
}

export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function round2(value: number): number {
    return Number(value.toFixed(2));
}

function measureLineSegmentLength(start: Point, end: Point): number {
    return Math.hypot(end.x - start.x, end.y - start.y);
}

function resolveSmoothPathBezierControls(start: Point, end: Point) {
    const controlX = (start.x + end.x) / 2;

    return {
        control1: { x: controlX, y: start.y },
        control2: { x: controlX, y: end.y },
    };
}

function sampleCubicBezierPoint(start: Point, control1: Point, control2: Point, end: Point, t: number): Point {
    const oneMinusT = 1 - t;
    const oneMinusTSquared = oneMinusT * oneMinusT;
    const tSquared = t * t;
    const coefficient0 = oneMinusTSquared * oneMinusT;
    const coefficient1 = 3 * oneMinusTSquared * t;
    const coefficient2 = 3 * oneMinusT * tSquared;
    const coefficient3 = tSquared * t;

    return {
        x: (coefficient0 * start.x) + (coefficient1 * control1.x) + (coefficient2 * control2.x) + (coefficient3 * end.x),
        y: (coefficient0 * start.y) + (coefficient1 * control1.y) + (coefficient2 * control2.y) + (coefficient3 * end.y),
    };
}

function measureCubicBezierLength(start: Point, control1: Point, control2: Point, end: Point, samples: number = 24): number {
    let previousPoint = start;
    let length = 0;

    for (let index = 1; index <= samples; index += 1) {
        const point = sampleCubicBezierPoint(start, control1, control2, end, index / samples);
        length += measureLineSegmentLength(previousPoint, point);
        previousPoint = point;
    }

    return length;
}

export function measureSmoothPathLength(points: Point[]): number {
    if (points.length < 2) return 0;

    let length = 0;

    for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1];
        const end = points[index];
        const { control1, control2 } = resolveSmoothPathBezierControls(start, end);

        length += measureCubicBezierLength(start, control1, control2, end);
    }

    return length;
}

export function resolveAnimationDurationSecondsFromPathLength(
    pathLength: number,
    speedPxPerSecond: number,
    minimumSeconds: number,
    maximumSeconds: number,
): number {
    if (!Number.isFinite(pathLength) || pathLength <= 0 || !Number.isFinite(speedPxPerSecond) || speedPxPerSecond <= 0) {
        return Number(minimumSeconds.toFixed(2));
    }

    const duration = clamp(pathLength / speedPxPerSecond, minimumSeconds, maximumSeconds);

    return Number(duration.toFixed(2));
}

/**
 * Lazily-created offscreen canvas context for text measurement.
 * Reused across all calls to avoid allocation overhead.
 */
let measureCtx: CanvasRenderingContext2D | null = null;

function getTextWidth(text: string, font: string): number {
    if (typeof document === 'undefined') return text.length * 7;

    if (!measureCtx) {
        const canvas = document.createElement('canvas');
        measureCtx = canvas.getContext('2d');
    }
    if (!measureCtx) return text.length * 7;

    measureCtx.font = font;
    return measureCtx.measureText(text).width;
}

function getRootCssVariableValue(variableName: string, fallbackValue: string): string {
    if (typeof document === 'undefined') return fallbackValue;

    const resolvedValue = getComputedStyle(document.documentElement)
        .getPropertyValue(variableName)
        .trim();

    return resolvedValue || fallbackValue;
}

export function getChartTextFont(): string {
    const fontWeight = getRootCssVariableValue('--font-weight-chart', '400');
    const fontSize = getRootCssVariableValue('--font-size-chart', '12px');
    const fontFamily = getRootCssVariableValue('--font-chart', '"IBMPlexMono", monospace');

    return `${fontWeight} ${fontSize} ${fontFamily}`;
}

export function getChartFontSizePx(): number {
    const fontSize = getRootCssVariableValue('--font-size-chart', '12px');
    const parsedValue = Number.parseFloat(fontSize);
    return Number.isFinite(parsedValue) ? parsedValue : 12;
}

export function getChartLetterSpacingPx(): number {
    const letterSpacing = getRootCssVariableValue('--tracking-chart', '0px');
    const parsedValue = Number.parseFloat(letterSpacing);
    return Number.isFinite(parsedValue) ? parsedValue : 0;
}

export function measureChartTextWidthPx(
    text: string,
    font: string = getChartTextFont(),
    letterSpacing: number = getChartLetterSpacingPx(),
): number {
    const baseWidth = getTextWidth(text, font);
    const spacingWidth = Math.max(text.length - 1, 0) * letterSpacing;

    return Math.max(baseWidth + spacingWidth, 0);
}

/**
 * Compute which X-axis label indices should be visible to avoid overlap.
 *
 * Measures the actual pixel width of each label string using an offscreen
 * canvas, then greedily selects labels that fit without overlapping.
 * Always includes the first visible label. Includes the last label only
 * if it doesn't overlap with the previously placed label.
 *
 * @param labels     Array of label strings (one per data point)
 * @param positions  Array of X pixel positions (one per data point, center of each label)
 * @param font       CSS font string matching the SVG text style
 * @param minGap     Minimum gap in pixels between label edges (default: 8)
 * @param plotRight  Right edge of the plot area in pixels (optional)
 */
export function computeVisibleLabelIndices(
    labels: string[],
    positions: number[],
    font: string = getChartTextFont(),
    minGap: number = 8,
    plotRight?: number,
    letterSpacing: number = 0,
): Set<number> {
    const count = Math.min(labels.length, positions.length);
    if (count === 0) return new Set();
    if (count === 1) return new Set([0]);

    const widths = labels.slice(0, count).map((label) => {
        const baseWidth = getTextWidth(label, font);
        const spacingWidth = Math.max(label.length - 1, 0) * letterSpacing;
        return Math.max(baseWidth + spacingWidth, 0);
    });
    const visible = new Set<number>();

    // Greedy left-to-right: place a label if its left edge doesn't overlap
    // the right edge of the last placed label + minGap.
    let lastRightEdge = -Infinity;

    for (let index = 0; index < count; index += 1) {
        const halfW = widths[index] / 2;
        const leftEdge = positions[index] - halfW;
        const rightEdge = positions[index] + halfW;

        // Skip if this label would extend past the right plot boundary.
        if (plotRight !== undefined && rightEdge > plotRight + 2) continue;

        if (leftEdge >= lastRightEdge + minGap) {
            visible.add(index);
            lastRightEdge = rightEdge;
        }
    }

    // Try to add the last label if not already included and it fits.
    if (count > 1 && !visible.has(count - 1)) {
        const lastIndex = count - 1;
        const halfW = widths[lastIndex] / 2;
        const leftEdge = positions[lastIndex] - halfW;
        const rightEdge = positions[lastIndex] + halfW;
        const fitsRight = plotRight === undefined || rightEdge <= plotRight + 2;

        if (leftEdge >= lastRightEdge + minGap && fitsRight) {
            visible.add(lastIndex);
        }
    }

    return visible;
}
