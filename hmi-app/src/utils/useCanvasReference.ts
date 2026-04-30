import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { DEFAULT_COLS, DEFAULT_ROWS, getRowHeight } from './gridConfig';

export interface CanvasReferenceMetrics {
    width: number;
    height: number;
    cols: number;
    rows: number;
    rowHeight: number;
    offsetX: number;
    offsetY: number;
    cellWidth: number;
}

export interface UseCanvasReferenceOptions {
    cols?: number;
    rows?: number;
}

export interface UseCanvasReferenceResult extends CanvasReferenceMetrics {
    containerRef: RefObject<HTMLDivElement | null>;
    hasFirstValidMeasurement: boolean;
}

export function computeCanvasMetrics(input: {
    width: number;
    height: number;
    cols?: number;
    rows?: number;
    offsetX?: number;
    offsetY?: number;
}): CanvasReferenceMetrics {
    const width = Math.max(0, input.width);
    const height = Math.max(0, input.height);
    const cols = Math.max(1, input.cols ?? DEFAULT_COLS);
    const rows = Math.max(1, input.rows ?? DEFAULT_ROWS);

    return {
        width,
        height,
        cols,
        rows,
        rowHeight: getRowHeight(height, rows),
        offsetX: input.offsetX ?? 0,
        offsetY: input.offsetY ?? 0,
        cellWidth: cols > 0 ? width / cols : 0,
    };
}

function getInitialMetrics(cols?: number, rows?: number): CanvasReferenceMetrics {
    return computeCanvasMetrics({ width: 0, height: 0, cols, rows });
}

function isValidMeasurement(width: number, height: number): boolean {
    return width > 0 && height > 0;
}

export function useCanvasReference(options: UseCanvasReferenceOptions = {}): UseCanvasReferenceResult {
    const { cols = DEFAULT_COLS, rows = DEFAULT_ROWS } = options;

    const containerRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<number | null>(null);
    const hasReceivedValidRef = useRef(false);
    const [metrics, setMetrics] = useState<CanvasReferenceMetrics>(() => getInitialMetrics(cols, rows));
    const [hasFirstValidMeasurement, setHasFirstValidMeasurement] = useState(false);

    useEffect(() => {
        const cancelScheduledFrame = () => {
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
        };

        const scheduleMetricsUpdate = (nextMetrics: CanvasReferenceMetrics) => {
            cancelScheduledFrame();
            frameRef.current = requestAnimationFrame(() => {
                if (!hasReceivedValidRef.current) {
                    hasReceivedValidRef.current = true;
                    setHasFirstValidMeasurement(true);
                }

                setMetrics(nextMetrics);
                frameRef.current = null;
            });
        };

        const container = containerRef.current;
        if (!container) {
            return cancelScheduledFrame;
        }

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) {
                return;
            }

            if (!isValidMeasurement(entry.contentRect.width, entry.contentRect.height)) {
                return;
            }

            scheduleMetricsUpdate(computeCanvasMetrics({
                width: entry.contentRect.width,
                height: entry.contentRect.height,
                cols,
                rows,
                offsetX: 0,
                offsetY: 0,
            }));
        });

        observer.observe(container);

        return () => {
            cancelScheduledFrame();
            observer.disconnect();
        };
    }, [cols, rows]);

    return {
        containerRef,
        hasFirstValidMeasurement,
        ...metrics,
    };
}
