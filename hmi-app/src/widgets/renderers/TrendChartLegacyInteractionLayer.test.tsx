import { useMemo, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TrendChartLegacyInteractionLayer from './TrendChartLegacyInteractionLayer';

function Harness({
    onHoverChange,
    pointCount = 5,
}: {
    onHoverChange: (index: number | null, x?: number) => void;
    pointCount?: number;
}) {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const step = pointCount === 5 ? 25 : 1;
    const data = useMemo(
        () => Array.from({ length: pointCount }, (_, index) => ({ time: `T${index}`, value: index })),
        [pointCount],
    );
    const points = useMemo(
        () => data.map((_, index) => ({ x: 10 + (index * step), y: 40 - index })),
        [data, step],
    );

    return (
        <svg>
            <TrendChartLegacyInteractionLayer
                data={data}
                points={points}
                x0={10}
                step={step}
                plotTop={5}
                plotLeft={10}
                plotWidth={Math.max((pointCount - 1) * step, 1)}
                plotHeight={40}
                hoveredIndex={hoveredIndex}
                onHoverChange={(index, x) => {
                    if (index === null) {
                        onHoverChange(null);
                    } else {
                        onHoverChange(index, x);
                    }
                    setHoveredIndex(index);
                }}
                indicatorColor="var(--color-industrial-muted)"
                highlightColor="var(--color-widget-gradient-to)"
                highlightBorderColor="var(--color-industrial-bg)"
            />
        </svg>
    );
}

describe('TrendChartLegacyInteractionLayer', () => {
    it.each([24, 1000, 10_000])('renders exactly one interactive overlay for %i points', (pointCount) => {
        const onHoverChange = vi.fn();
        const { container } = render(<Harness pointCount={pointCount} onHoverChange={onHoverChange} />);

        expect(screen.getAllByTestId('trend-chart-legacy-interaction-overlay')).toHaveLength(1);
        expect(container.querySelectorAll('rect[fill="transparent"]')).toHaveLength(1);
    });

    it('emits exactly six callbacks for 600 movements distributed over six unique indices', () => {
        const onHoverChange = vi.fn();
        render(<Harness pointCount={1000} onHoverChange={onHoverChange} />);
        const overlay = screen.getByTestId('trend-chart-legacy-interaction-overlay');
        const targetIndices = [0, 200, 400, 600, 800, 999];
        Object.defineProperty(overlay, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
                x: 100,
                y: 0,
                width: 999,
                height: 40,
                top: 0,
                left: 100,
                right: 1099,
                bottom: 40,
                toJSON: () => ({}),
            }),
        });

        targetIndices.forEach((targetIndex) => {
            for (let repetition = 0; repetition < 100; repetition += 1) {
                fireEvent.mouseMove(overlay, { clientX: 100 + targetIndex, clientY: 20 });
            }
        });

        expect(onHoverChange).toHaveBeenCalledTimes(6);
        expect(onHoverChange.mock.calls.map(([index]) => index)).toEqual(targetIndices);
    });

    it('uses one overlay, clamps pointer coordinates, preserves later-point ties, and suppresses duplicate callbacks', () => {
        const onHoverChange = vi.fn();
        render(<Harness onHoverChange={onHoverChange} />);
        const overlay = screen.getByTestId('trend-chart-legacy-interaction-overlay');
        Object.defineProperty(overlay, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
                x: 100,
                y: 0,
                width: 200,
                height: 40,
                top: 0,
                left: 100,
                right: 300,
                bottom: 40,
                toJSON: () => ({}),
            }),
        });

        for (let index = 0; index < 100; index += 1) {
            fireEvent.mouseMove(overlay, { clientX: 125, clientY: 20 });
        }

        expect(onHoverChange).toHaveBeenCalledTimes(1);
        expect(onHoverChange).toHaveBeenLastCalledWith(1, 35);

        fireEvent.mouseMove(overlay, { clientX: -100, clientY: 20 });
        expect(onHoverChange).toHaveBeenLastCalledWith(0, 10);
        fireEvent.mouseMove(overlay, { clientX: 1000, clientY: 20 });
        expect(onHoverChange).toHaveBeenLastCalledWith(4, 110);

        fireEvent.mouseLeave(overlay);
        fireEvent.mouseLeave(overlay);
        expect(onHoverChange.mock.calls.filter(([value]) => value === null)).toHaveLength(1);
        expect(document.querySelectorAll('rect[fill="transparent"]')).toHaveLength(1);
    });

    it('exposes a valid first-point aria value initially, while selected, and after Escape without an initial visual hover', () => {
        const onHoverChange = vi.fn();
        render(<Harness onHoverChange={onHoverChange} />);
        const overlay = screen.getByTestId('trend-chart-legacy-interaction-overlay');

        expect(overlay).toHaveAttribute('role', 'slider');
        expect(overlay).toHaveAttribute('tabindex', '0');
        expect(overlay).toHaveAttribute('aria-valuenow', '1');
        expect(overlay).toHaveAttribute('aria-valuetext', 'T0: 0');
        expect(document.querySelector('circle')).not.toBeInTheDocument();

        fireEvent.keyDown(overlay, { key: 'ArrowRight' });
        expect(onHoverChange).toHaveBeenLastCalledWith(1, 35);
        expect(overlay).toHaveAttribute('aria-valuenow', '2');
        expect(overlay).toHaveAttribute('aria-valuetext', 'T1: 1');
        expect(document.querySelector('circle')).toBeInTheDocument();

        fireEvent.keyDown(overlay, { key: 'End' });
        expect(onHoverChange).toHaveBeenLastCalledWith(4, 110);
        fireEvent.keyDown(overlay, { key: 'ArrowLeft' });
        expect(onHoverChange).toHaveBeenLastCalledWith(3, 85);
        fireEvent.keyDown(overlay, { key: 'Home' });
        expect(onHoverChange).toHaveBeenLastCalledWith(0, 10);
        fireEvent.keyDown(overlay, { key: 'Escape' });
        expect(onHoverChange).toHaveBeenLastCalledWith(null);
        expect(overlay).toHaveAttribute('aria-valuenow', '1');
        expect(overlay).toHaveAttribute('aria-valuetext', 'T0: 0');
        expect(document.querySelector('circle')).not.toBeInTheDocument();
    });
});
