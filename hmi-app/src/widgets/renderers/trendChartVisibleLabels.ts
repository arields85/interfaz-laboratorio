import { getChartLetterSpacingPx, getChartTextFont, measureChartTextWidthPx } from '../../utils/chartHelpers';

function buildEvenlyDistributedIndexCandidates(pointCount: number, visibleCount: number): number[] {
    if (pointCount <= 0 || visibleCount <= 0) {
        return [];
    }

    if (pointCount === 1 || visibleCount === 1) {
        return [0];
    }

    const lastIndex = pointCount - 1;
    const indices = Array.from({ length: visibleCount }, (_, index) => Math.round((index * lastIndex) / (visibleCount - 1)));

    indices[0] = 0;
    indices[indices.length - 1] = lastIndex;

    return Array.from(new Set(indices)).sort((left, right) => left - right);
}

function labelsFitWithoutOverlap({
    candidateIndices,
    labels,
    positions,
    font,
    letterSpacing,
    minGap,
}: {
    candidateIndices: number[];
    labels: string[];
    positions: number[];
    font: string;
    letterSpacing: number;
    minGap: number;
}): boolean {
    if (candidateIndices.length <= 1) {
        return true;
    }

    let previousRightEdge = -Infinity;

    for (const index of candidateIndices) {
        const width = measureChartTextWidthPx(labels[index] ?? '', font, letterSpacing);
        const leftEdge = (positions[index] ?? 0) - (width / 2);
        const rightEdge = (positions[index] ?? 0) + (width / 2);

        if (leftEdge < previousRightEdge + minGap) {
            return false;
        }

        previousRightEdge = rightEdge;
    }

    return true;
}

export function buildTrendChartVisibleLabelIndices({
    labels,
    positions,
    plotWidth,
    font = getChartTextFont(),
    letterSpacing = getChartLetterSpacingPx(),
    minGap = 8,
}: {
    labels: string[];
    positions: number[];
    plotWidth: number;
    font?: string;
    letterSpacing?: number;
    minGap?: number;
}): number[] {
    const count = Math.min(labels.length, positions.length);

    if (count === 0) {
        return [];
    }

    if (count === 1) {
        return [0];
    }

    const widestLabelWidth = Math.max(
        ...labels.slice(0, count).map((label) => measureChartTextWidthPx(label, font, letterSpacing)),
        1,
    );
    const estimatedMaxVisibleCount = Math.max(
        2,
        Math.min(count, Math.floor(plotWidth / Math.max(widestLabelWidth + minGap, 1)) + 1),
    );

    for (let visibleCount = estimatedMaxVisibleCount; visibleCount >= 2; visibleCount -= 1) {
        const candidateIndices = buildEvenlyDistributedIndexCandidates(count, visibleCount);

        if (labelsFitWithoutOverlap({
            candidateIndices,
            labels,
            positions,
            font,
            letterSpacing,
            minGap,
        })) {
            return candidateIndices;
        }
    }

    return [0, count - 1];
}
