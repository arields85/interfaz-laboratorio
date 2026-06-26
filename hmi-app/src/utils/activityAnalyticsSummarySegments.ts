export type ActivityAnalyticsSummarySegmentBar = {
    key: string;
    label: string;
    durationMs: number;
    color: string;
};

export type ActivityAnalyticsSummarySegment = {
    bar: ActivityAnalyticsSummarySegmentBar;
    dashArray: string;
    dashOffset: number;
};

export function buildActivityAnalyticsSummarySegments({
    bars,
    circumference,
    gapLength,
}: {
    bars: ReadonlyArray<ActivityAnalyticsSummarySegmentBar>;
    circumference: number;
    gapLength: number;
}): ActivityAnalyticsSummarySegment[] {
    const totalDurationMs = Math.max(bars.reduce((total, bar) => total + bar.durationMs, 0), 1);
    const availableCircumference = Math.max(circumference - (gapLength * bars.length), 0);

    return bars.reduce<{ segments: ActivityAnalyticsSummarySegment[]; currentOffset: number }>((state, bar) => {
        const arcLength = (bar.durationMs / totalDurationMs) * availableCircumference;
        const nextSegment = {
            bar,
            dashArray: `${arcLength} ${Math.max(circumference - arcLength, 0)}`,
            dashOffset: -(state.currentOffset + (gapLength / 2)),
        };

        return {
            segments: [...state.segments, nextSegment],
            currentOffset: state.currentOffset + arcLength + gapLength,
        };
    }, { segments: [], currentOffset: 0 }).segments;
}
