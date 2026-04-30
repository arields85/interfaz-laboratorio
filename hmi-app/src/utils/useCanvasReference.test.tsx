import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useCanvasReference, computeCanvasMetrics } from './useCanvasReference';
import type { UseCanvasReferenceOptions } from './useCanvasReference';

type ResizeObserverCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

const resizeCallbacks = new Map<Element, Set<ResizeObserverCallback>>();

class MockResizeObserver implements ResizeObserver {
    public readonly boxOptions = '';
    private readonly observedElements = new Set<Element>();

    public constructor(private readonly callback: ResizeObserverCallback) {}

    public observe(target: Element): void {
        this.observedElements.add(target);
        const callbacks = resizeCallbacks.get(target) ?? new Set<ResizeObserverCallback>();
        callbacks.add(this.callback);
        resizeCallbacks.set(target, callbacks);
    }

    public unobserve(target: Element): void {
        this.observedElements.delete(target);
        const callbacks = resizeCallbacks.get(target);
        callbacks?.delete(this.callback);
        if (callbacks?.size === 0) {
            resizeCallbacks.delete(target);
        }
    }

    public disconnect(): void {
        for (const element of this.observedElements) {
            this.unobserve(element);
        }
    }
}

function emitResize(target: Element, width: number, height: number) {
    const callbacks = resizeCallbacks.get(target);

    if (!callbacks || callbacks.size === 0) {
        throw new Error('No ResizeObserver registered for the target element.');
    }

    const entry = {
        target,
        contentRect: { width, height },
    } as ResizeObserverEntry;

    for (const callback of callbacks) {
        callback([entry], {} as ResizeObserver);
    }
}

function setWindowSize(width: number, height: number) {
    Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: width,
        writable: true,
    });

    Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: height,
        writable: true,
    });
}

function readMetric(testId: string, attribute: string): number {
    const value = document.querySelector(`[data-testid="${testId}"]`)?.getAttribute(attribute);

    if (value === null || value === undefined) {
        throw new Error(`Missing attribute ${attribute} on ${testId}.`);
    }

    return Number(value);
}

function HookHarness({ testId, ...options }: UseCanvasReferenceOptions & { testId: string }) {
    const {
        containerRef,
        width,
        height,
        cols,
        rows,
        rowHeight,
        offsetX,
        offsetY,
        cellWidth,
        hasFirstValidMeasurement,
    } = useCanvasReference(options);

    return (
        <div
            ref={containerRef}
            data-testid={testId}
            data-width={width}
            data-height={height}
            data-cols={cols}
            data-rows={rows}
            data-row-height={rowHeight}
            data-offset-x={offsetX}
            data-offset-y={offsetY}
            data-cell-width={cellWidth}
            data-has-first-valid-measurement={hasFirstValidMeasurement ? 'true' : 'false'}
        />
    );
}

describe('computeCanvasMetrics', () => {
    it('derives width, height, cols, rows, rowHeight, and offsets from measured dimensions and explicit cols', () => {
        const result = computeCanvasMetrics({
            width: 900,
            height: 600,
            cols: 18,
            rows: 15,
            offsetX: 12,
            offsetY: 8,
        });

        expect(result).toEqual({
            width: 900,
            height: 600,
            cols: 18,
            rows: 15,
            rowHeight: 40,
            offsetX: 12,
            offsetY: 8,
            cellWidth: 50,
        });
    });

    it('defaults cols and rows to shared dashboard defaults', () => {
        const result = computeCanvasMetrics({ width: 1600, height: 720 });

        expect(result.width).toBe(1600);
        expect(result.height).toBe(720);
        expect(result.cols).toBe(40);
        expect(result.rows).toBe(24);
        expect(result.rowHeight).toBe(30);
        expect(result.offsetX).toBe(0);
        expect(result.offsetY).toBe(0);
        expect(result.cellWidth).toBe(40);
    });
});

describe('useCanvasReference', () => {
    beforeEach(() => {
        resizeCallbacks.clear();
        setWindowSize(1440, 900);
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        cleanup();
        resizeCallbacks.clear();
        vi.unstubAllGlobals();
    });

    it('recomputes shared canvas metrics when the observed container changes size', async () => {
        render(<HookHarness testId="measured-canvas" cols={18} rows={10} />);

        const container = document.querySelector('[data-testid="measured-canvas"]');
        if (!container) {
            throw new Error('Measured canvas harness did not render.');
        }

        act(() => {
            emitResize(container, 720, 400);
        });

        await waitFor(() => {
            expect(readMetric('measured-canvas', 'data-width')).toBe(720);
            expect(readMetric('measured-canvas', 'data-height')).toBe(400);
            expect(readMetric('measured-canvas', 'data-cols')).toBe(18);
            expect(readMetric('measured-canvas', 'data-rows')).toBe(10);
            expect(readMetric('measured-canvas', 'data-row-height')).toBe(40);
            expect(readMetric('measured-canvas', 'data-offset-x')).toBe(0);
            expect(readMetric('measured-canvas', 'data-offset-y')).toBe(0);
            expect(readMetric('measured-canvas', 'data-cell-width')).toBe(40);
            expect(document.querySelector('[data-testid="measured-canvas"]')).toHaveAttribute('data-has-first-valid-measurement', 'true');
        });

        act(() => {
            emitResize(container, 300, 600);
        });

        await waitFor(() => {
            expect(readMetric('measured-canvas', 'data-width')).toBe(300);
            expect(readMetric('measured-canvas', 'data-height')).toBe(600);
            expect(readMetric('measured-canvas', 'data-cols')).toBe(18);
            expect(readMetric('measured-canvas', 'data-row-height')).toBe(60);
            expect(readMetric('measured-canvas', 'data-offset-y')).toBe(0);
            expect(readMetric('measured-canvas', 'data-cell-width')).toBeCloseTo(16.666666666666668);
        });
    });

    it('uses cols and rows from props to compute cell metrics', async () => {
        render(<HookHarness testId="configured-canvas" cols={24} rows={12} />);

        const container = document.querySelector('[data-testid="configured-canvas"]');
        if (!container) {
            throw new Error('Configured canvas harness did not render.');
        }

        act(() => {
            emitResize(container, 1200, 800);
        });

        await waitFor(() => {
            expect(readMetric('configured-canvas', 'data-width')).toBe(1200);
            expect(readMetric('configured-canvas', 'data-height')).toBe(800);
            expect(readMetric('configured-canvas', 'data-cols')).toBe(24);
            expect(readMetric('configured-canvas', 'data-row-height')).toBeCloseTo(66.66666666666667);
            expect(readMetric('configured-canvas', 'data-cell-width')).toBe(50);
            expect(readMetric('configured-canvas', 'data-offset-x')).toBe(0);
            expect(readMetric('configured-canvas', 'data-offset-y')).toBe(0);
        });
    });

    it('retains the last valid metrics when a transient zero measurement arrives and replaces them with the next valid size', async () => {
        render(<HookHarness testId="guarded-canvas" cols={20} rows={10} />);

        const container = document.querySelector('[data-testid="guarded-canvas"]');
        if (!container) {
            throw new Error('Guarded canvas harness did not render.');
        }

        act(() => {
            emitResize(container, 800, 500);
        });

        await waitFor(() => {
            expect(readMetric('guarded-canvas', 'data-width')).toBe(800);
            expect(readMetric('guarded-canvas', 'data-height')).toBe(500);
            expect(readMetric('guarded-canvas', 'data-row-height')).toBe(50);
            expect(readMetric('guarded-canvas', 'data-cell-width')).toBe(40);
            expect(document.querySelector('[data-testid="guarded-canvas"]')).toHaveAttribute('data-has-first-valid-measurement', 'true');
        });

        act(() => {
            emitResize(container, 0, 500);
        });

        await waitFor(() => {
            expect(readMetric('guarded-canvas', 'data-width')).toBe(800);
            expect(readMetric('guarded-canvas', 'data-height')).toBe(500);
            expect(readMetric('guarded-canvas', 'data-row-height')).toBe(50);
            expect(readMetric('guarded-canvas', 'data-cell-width')).toBe(40);
        });

        act(() => {
            emitResize(container, 1000, 600);
        });

        await waitFor(() => {
            expect(readMetric('guarded-canvas', 'data-width')).toBe(1000);
            expect(readMetric('guarded-canvas', 'data-height')).toBe(600);
            expect(readMetric('guarded-canvas', 'data-row-height')).toBe(60);
            expect(readMetric('guarded-canvas', 'data-cell-width')).toBe(50);
        });
    });

    it('keeps the initial zero metrics when the first observed resize is also invalid', async () => {
        render(<HookHarness testId="initial-guarded-canvas" cols={20} rows={10} />);

        const container = document.querySelector('[data-testid="initial-guarded-canvas"]');
        if (!container) {
            throw new Error('Initial guarded canvas harness did not render.');
        }

        act(() => {
            emitResize(container, 0, 0);
        });

        await waitFor(() => {
            expect(readMetric('initial-guarded-canvas', 'data-width')).toBe(0);
            expect(readMetric('initial-guarded-canvas', 'data-height')).toBe(0);
            expect(readMetric('initial-guarded-canvas', 'data-row-height')).toBe(0);
            expect(readMetric('initial-guarded-canvas', 'data-cell-width')).toBe(0);
            expect(document.querySelector('[data-testid="initial-guarded-canvas"]')).toHaveAttribute('data-has-first-valid-measurement', 'false');
        });
    });

    it('starts with first-valid readiness disabled before any valid resize arrives', () => {
        render(<HookHarness testId="first-valid-readiness" cols={20} rows={10} />);

        expect(document.querySelector('[data-testid="first-valid-readiness"]')).toHaveAttribute('data-has-first-valid-measurement', 'false');
    });
});
