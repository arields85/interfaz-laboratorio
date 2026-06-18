import { useRef, useState, useEffect } from 'react';
import { computeGridCols, computeViewerReferenceWidth, MIN_COLS } from './gridConfig';

// =============================================================================
// useGridCols — ResizeObserver-based dynamic column count hook
//
// Observes the element attached via containerRef and recomputes the number of
// grid columns whenever the container width changes.
//
// When useViewerReference = true, columns are computed from the viewer's
// reference width (viewport minus main layout padding) instead of the
// container's own width. This ensures the builder and viewer always produce
// the same column count regardless of chrome (rail, panels, etc.).
// =============================================================================

interface UseGridColsResult {
    containerRef: React.RefObject<HTMLDivElement | null>;
    cols: number;
    containerWidth: number;
}

/**
 * Measures the width of a container element and returns the number of grid
 * columns that fit, computed via computeGridCols.
 *
 * @param _gap              - Preserved for caller compatibility; grid gaps are resolved by computeGridCols.
 * @param useViewerReference - When true, compute cols from the viewer reference width
 *                             (viewport minus main layout padding) instead of the
 *                             container's measured width.
 */
export function useGridCols(_gap: number, useViewerReference = false): UseGridColsResult {
    const containerRef = useRef<HTMLDivElement>(null);
    const [cols, setCols] = useState(MIN_COLS);
    const [containerWidth, setContainerWidth] = useState(0);

    useEffect(() => {
        if (useViewerReference) {
            const update = () => {
                const refWidth = computeViewerReferenceWidth();
                setContainerWidth(refWidth);
                setCols(computeGridCols(refWidth));
            };
            update();
            window.addEventListener('resize', update);
            return () => window.removeEventListener('resize', update);
        }

        const el = containerRef.current;
        if (!el) return;

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            const width = entry.contentRect.width;
            setContainerWidth(width);
            setCols(computeGridCols(width));
        });

        observer.observe(el);
        return () => observer.disconnect();
    }, [useViewerReference]);

    return { containerRef, cols, containerWidth };
}
