export function getNearestTimestampPoint<TPoint extends { timestampMs: number }>(
    points: readonly TPoint[],
    targetTimestampMs: number,
    diagnostics?: { comparisons: number },
): TPoint | null {
    if (points.length === 0) {
        return null;
    }

    let low = 0;
    let high = points.length;

    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        const point = points[middle];

        if (diagnostics) {
            diagnostics.comparisons += 1;
        }

        if (point && point.timestampMs < targetTimestampMs) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }

    const right = points[low] ?? null;
    const left = points[low - 1] ?? null;

    if (!left) {
        return right;
    }

    if (!right) {
        return left;
    }

    return Math.abs(right.timestampMs - targetTimestampMs) < Math.abs(left.timestampMs - targetTimestampMs)
        ? right
        : left;
}
