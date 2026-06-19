import { useMemo, useState } from 'react';

interface TrendChartV2InteractionPoint {
    timestampMs: number;
    x: number;
    y: number;
}

interface TrendChartV2InteractionLayerProps {
    plotLeft: number;
    plotTop: number;
    plotWidth: number;
    plotHeight: number;
    domainStartMs: number;
    domainEndMs: number;
    points: TrendChartV2InteractionPoint[];
    hoveredTimestampMs: number | null;
    onHoverChange: (timestampMs: number | null) => void;
    onZoomSelection: (selection: { startMs: number; endMs: number }) => void;
    onInvalidSelection?: (reason: 'too-small') => void;
    minimumSelectionWidthPx?: number;
}

export default function TrendChartV2InteractionLayer({
    plotLeft,
    plotTop,
    plotWidth,
    plotHeight,
    domainStartMs,
    domainEndMs,
    points,
    hoveredTimestampMs,
    onHoverChange,
    onZoomSelection,
    onInvalidSelection,
    minimumSelectionWidthPx = 12,
}: TrendChartV2InteractionLayerProps) {
    const [dragStartX, setDragStartX] = useState<number | null>(null);
    const [dragCurrentX, setDragCurrentX] = useState<number | null>(null);

    const hoveredPoint = useMemo(
        () => points.find((point) => point.timestampMs === hoveredTimestampMs) ?? null,
        [hoveredTimestampMs, points],
    );

    const selectionRect = dragStartX !== null && dragCurrentX !== null
        ? {
            x: Math.min(dragStartX, dragCurrentX),
            width: Math.abs(dragCurrentX - dragStartX),
        }
        : null;

    const handleMouseMove = (event: React.MouseEvent<SVGRectElement>) => {
        const x = getRelativeX(event.currentTarget, event.clientX, plotLeft, plotWidth);

        if (dragStartX !== null) {
            setDragCurrentX(x);
            return;
        }

        const hoveredTime = scaleXToTimestamp(x, plotLeft, plotWidth, domainStartMs, domainEndMs);
        const nearestPoint = getNearestTimestampPoint(points, hoveredTime);
        onHoverChange(nearestPoint?.timestampMs ?? null);
    };

    const handleMouseDown = (event: React.MouseEvent<SVGRectElement>) => {
        const x = getRelativeX(event.currentTarget, event.clientX, plotLeft, plotWidth);
        setDragStartX(x);
        setDragCurrentX(x);
    };

    const handleMouseUp = () => {
        if (dragStartX === null || dragCurrentX === null) {
            return;
        }

        const selectionWidth = Math.abs(dragCurrentX - dragStartX);

        if (selectionWidth >= minimumSelectionWidthPx) {
            const startMs = scaleXToTimestamp(Math.min(dragStartX, dragCurrentX), plotLeft, plotWidth, domainStartMs, domainEndMs);
            const endMs = scaleXToTimestamp(Math.max(dragStartX, dragCurrentX), plotLeft, plotWidth, domainStartMs, domainEndMs);
            onZoomSelection({ startMs, endMs });
        } else {
            onInvalidSelection?.('too-small');
        }

        setDragStartX(null);
        setDragCurrentX(null);
    };

    return (
        <g>
            {hoveredPoint && (
                <g pointerEvents="none">
                    <line
                        x1={hoveredPoint.x}
                        x2={hoveredPoint.x}
                        y1={plotTop}
                        y2={plotTop + plotHeight}
                        stroke="var(--color-industrial-muted)"
                        strokeWidth={1}
                        strokeDasharray="4 3"
                        opacity={0.7}
                    />
                    <circle
                        cx={hoveredPoint.x}
                        cy={hoveredPoint.y}
                        r={4}
                        fill="var(--color-widget-gradient-to)"
                        stroke="var(--color-industrial-bg)"
                        strokeWidth={2}
                    />
                </g>
            )}

            {selectionRect && (
                <rect
                    x={selectionRect.x}
                    y={plotTop}
                    width={selectionRect.width}
                    height={plotHeight}
                    fill="var(--color-widget-gradient-to)"
                    fillOpacity={0.12}
                    stroke="var(--color-widget-gradient-to)"
                    strokeOpacity={0.4}
                    pointerEvents="none"
                />
            )}

            <rect
                data-testid="trend-chart-v2-interaction-overlay"
                x={plotLeft}
                y={plotTop}
                width={plotWidth}
                height={plotHeight}
                fill="transparent"
                pointerEvents="all"
                cursor="crosshair"
                onMouseMove={handleMouseMove}
                onMouseLeave={() => {
                    setDragStartX(null);
                    setDragCurrentX(null);
                    onHoverChange(null);
                }}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
            />
        </g>
    );
}

function getRelativeX(element: SVGRectElement, clientX: number, plotLeft: number, plotWidth: number): number {
    const rect = element.getBoundingClientRect();
    const relativeX = plotLeft + (clientX - rect.left);
    return Math.max(plotLeft, Math.min(plotLeft + plotWidth, relativeX));
}

function scaleXToTimestamp(x: number, plotLeft: number, plotWidth: number, domainStartMs: number, domainEndMs: number): number {
    const ratio = (x - plotLeft) / Math.max(plotWidth, 1);
    return Math.round(domainStartMs + ((domainEndMs - domainStartMs) * ratio));
}

function getNearestTimestampPoint(points: TrendChartV2InteractionPoint[], targetTimestampMs: number): TrendChartV2InteractionPoint | null {
    if (points.length === 0) {
        return null;
    }

    return points.reduce((nearest, point) => {
        if (!nearest) {
            return point;
        }

        const nearestDistance = Math.abs(nearest.timestampMs - targetTimestampMs);
        const pointDistance = Math.abs(point.timestampMs - targetTimestampMs);
        return pointDistance < nearestDistance ? point : nearest;
    }, null as TrendChartV2InteractionPoint | null);
}
