import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TrendChartV2InteractionLayer from './TrendChartV2InteractionLayer';

function mockRect(element: Element, width: number, height: number, left: number = 0) {
    Object.defineProperty(element, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
            x: left,
            y: 0,
            width,
            height,
            top: 0,
            left,
            right: left + width,
            bottom: height,
            toJSON: () => ({}),
        }),
    });
}

describe('TrendChartV2InteractionLayer', () => {
    it('selects the nearest point by timestamp instead of uniform index spacing', () => {
        const onHoverChange = vi.fn();

        render(
            <svg>
                <TrendChartV2InteractionLayer
                    plotLeft={10}
                    plotTop={5}
                    plotWidth={100}
                    plotHeight={40}
                    domainStartMs={0}
                    domainEndMs={1000}
                    points={[
                        { timestampMs: 0, x: 10, y: 20 },
                        { timestampMs: 100, x: 20, y: 18 },
                        { timestampMs: 900, x: 100, y: 12 },
                    ]}
                    hoveredTimestampMs={null}
                    onHoverChange={onHoverChange}
                    onZoomSelection={() => undefined}
                />
            </svg>,
        );

        const overlay = screen.getByTestId('trend-chart-v2-interaction-overlay');
        mockRect(overlay, 120, 60, 10);

        expect(overlay).toHaveAttribute('fill', 'transparent');
        expect(overlay).toHaveAttribute('pointer-events', 'all');
        expect(overlay).toHaveAttribute('cursor', 'crosshair');

        fireEvent.mouseMove(overlay, { clientX: 65, clientY: 20 });

        expect(onHoverChange).toHaveBeenCalledWith(900);
    });

    it('converts drag selection into sorted timestamp bounds and ignores too-small drags', () => {
        const onZoomSelection = vi.fn();

        render(
            <svg>
                <TrendChartV2InteractionLayer
                    plotLeft={10}
                    plotTop={5}
                    plotWidth={100}
                    plotHeight={40}
                    domainStartMs={0}
                    domainEndMs={1000}
                    points={[]}
                    hoveredTimestampMs={null}
                    onHoverChange={() => undefined}
                    onZoomSelection={onZoomSelection}
                    minimumSelectionWidthPx={10}
                />
            </svg>,
        );

        const overlay = screen.getByTestId('trend-chart-v2-interaction-overlay');
        mockRect(overlay, 120, 60, 10);

        fireEvent.mouseDown(overlay, { clientX: 90, clientY: 20 });
        fireEvent.mouseMove(overlay, { clientX: 30, clientY: 20 });
        fireEvent.mouseUp(overlay, { clientX: 30, clientY: 20 });

        expect(onZoomSelection).toHaveBeenCalledWith({ startMs: 200, endMs: 800 });

        onZoomSelection.mockClear();

        fireEvent.mouseDown(overlay, { clientX: 50, clientY: 20 });
        fireEvent.mouseMove(overlay, { clientX: 55, clientY: 20 });
        fireEvent.mouseUp(overlay, { clientX: 55, clientY: 20 });

        expect(onZoomSelection).not.toHaveBeenCalled();
    });
});
