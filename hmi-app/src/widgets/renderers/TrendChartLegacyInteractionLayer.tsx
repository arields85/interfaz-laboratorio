import { useEffect, useRef } from 'react';
import { clamp, type Point } from '../../utils/chartHelpers';
import {
    resolveTrendChartLegacyHoverIndex,
    type TrendChartLegacyDataPoint,
} from './trendChartLegacyModel';

interface TrendChartLegacyInteractionLayerProps {
    data: TrendChartLegacyDataPoint[];
    points: Point[];
    x0: number;
    step: number;
    plotTop: number;
    plotLeft: number;
    plotWidth: number;
    plotHeight: number;
    hoveredIndex: number | null;
    onHoverChange: (index: number | null, x?: number) => void;
    indicatorColor: string;
    highlightColor: string;
    highlightBorderColor: string;
}

export default function TrendChartLegacyInteractionLayer({
    data,
    points,
    x0,
    step,
    plotTop,
    plotLeft,
    plotWidth,
    plotHeight,
    hoveredIndex,
    onHoverChange,
    indicatorColor,
    highlightColor,
    highlightBorderColor,
}: TrendChartLegacyInteractionLayerProps) {
    const lastEmittedIndexRef = useRef<number | null>(hoveredIndex);
    const hoveredPoint = hoveredIndex !== null ? points[hoveredIndex] : undefined;
    const accessibilityIndex = hoveredIndex ?? 0;
    const accessibilityData = data[accessibilityIndex];

    useEffect(() => {
        lastEmittedIndexRef.current = hoveredIndex;
    }, [hoveredIndex]);

    const emitIndex = (index: number | null) => {
        if (lastEmittedIndexRef.current === index) {
            return;
        }

        lastEmittedIndexRef.current = index;
        if (index === null) {
            onHoverChange(null);
        } else {
            onHoverChange(index, x0 + (index * step));
        }
    };

    const handlePointerX = (element: SVGRectElement, clientX: number) => {
        const rect = element.getBoundingClientRect();
        const ratio = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
        const chartX = plotLeft + (ratio * plotWidth);
        emitIndex(resolveTrendChartLegacyHoverIndex({ chartX, x0, step, dataLength: data.length }));
    };

    const handleKeyDown = (event: React.KeyboardEvent<SVGRectElement>) => {
        let nextIndex: number | null | undefined;

        if (event.key === 'ArrowRight') {
            nextIndex = Math.min(accessibilityIndex + 1, data.length - 1);
        } else if (event.key === 'ArrowLeft') {
            nextIndex = Math.max(accessibilityIndex - 1, 0);
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = data.length - 1;
        } else if (event.key === 'Escape') {
            nextIndex = null;
        }

        if (nextIndex !== undefined) {
            event.preventDefault();
            emitIndex(nextIndex);
        }
    };

    return (
        <g>
            {hoveredPoint && (
                <g pointerEvents="none">
                    <line
                        x1={hoveredPoint.x}
                        y1={plotTop}
                        x2={hoveredPoint.x}
                        y2={plotTop + plotHeight}
                        stroke={indicatorColor}
                        strokeWidth={1}
                        strokeDasharray="4 3"
                        opacity={0.6}
                    />
                    <circle
                        cx={hoveredPoint.x}
                        cy={hoveredPoint.y}
                        r={5}
                        fill={highlightColor}
                        stroke={highlightBorderColor}
                        strokeWidth={2}
                    />
                </g>
            )}

            <rect
                data-testid="trend-chart-legacy-interaction-overlay"
                x={plotLeft}
                y={plotTop}
                width={plotWidth}
                height={plotHeight}
                fill="transparent"
                pointerEvents="all"
                cursor="crosshair"
                role="slider"
                tabIndex={0}
                aria-label="Trend chart data point"
                aria-valuemin={1}
                aria-valuemax={data.length}
                aria-valuenow={accessibilityIndex + 1}
                aria-valuetext={accessibilityData ? `${accessibilityData.time}: ${accessibilityData.value}` : undefined}
                onMouseEnter={(event) => handlePointerX(event.currentTarget, event.clientX)}
                onMouseMove={(event) => handlePointerX(event.currentTarget, event.clientX)}
                onMouseLeave={() => emitIndex(null)}
                onBlur={() => emitIndex(null)}
                onKeyDown={handleKeyDown}
            />
        </g>
    );
}
