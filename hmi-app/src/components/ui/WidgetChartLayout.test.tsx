import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import WidgetChartLayout from './WidgetChartLayout';
import {
    resolveWidgetChartLayoutMetrics,
    WIDGET_CHART_CONTAINER_CLASS,
    WIDGET_CHART_HEADER_CLASS,
} from './WidgetChartLayout.shared';

describe('WidgetChartLayout', () => {
    it('computes the accepted safe plot-right boundary, top slots, and dynamic top reservation', () => {
        const withAdornments = resolveWidgetChartLayoutMetrics({
            width: 320,
            height: 180,
            hasTopAdornments: true,
            firstXAxisLabel: '12:00',
            lastXAxisLabel: '14:00',
            yAxisTickLabels: ['53', '51', '49', '47', '45'],
            idPrefix: 'trend-v2-test',
            font: '400 12px monospace',
            letterSpacing: 0,
        });
        const withoutAdornments = resolveWidgetChartLayoutMetrics({
            width: 320,
            height: 180,
            hasTopAdornments: false,
            firstXAxisLabel: '12:00',
            lastXAxisLabel: '14:00',
            yAxisTickLabels: ['53', '51', '49', '47', '45'],
            idPrefix: 'trend-v2-test-empty',
            font: '400 12px monospace',
            letterSpacing: 0,
        });

        expect(withAdornments.plotArea.right).toBe(withAdornments.xAxisLabels.right);
        expect(withAdornments.topMetaSlot.x).toBe(withAdornments.plotArea.right);
        expect(withAdornments.topMetaSlot.y).toBe(8);
        expect(withAdornments.yAxisUnitSlot.y).toBe(8);
        expect(withAdornments.chartMargin.top).toBe(19);
        expect(withoutAdornments.chartMargin.top).toBe(8);
        expect(withoutAdornments.plotArea.height).toBeGreaterThan(withAdornments.plotArea.height);
    });

    it('renders the main svg clip path and the reusable overlay layer with the accepted top/right air', () => {
        const layout = resolveWidgetChartLayoutMetrics({
            width: 320,
            height: 180,
            hasTopAdornments: true,
            firstXAxisLabel: '12:00',
            lastXAxisLabel: '14:00',
            yAxisTickLabels: ['53', '51', '49', '47', '45'],
            idPrefix: 'trend-v2-test',
            font: '400 12px monospace',
            letterSpacing: 0,
        });

        render(
            <WidgetChartLayout
                layout={layout}
                svgTestId="widget-chart-layout-svg"
                overlaySvgTestId="widget-chart-layout-overlay"
                svgProps={{ 'data-chart-role': 'main' }}
                renderMain={(metrics) => (
                    <g data-testid="widget-chart-layout-main" clipPath={`url(#${metrics.plotClipPathId})`}>
                        <rect x={metrics.plotArea.left} y={metrics.plotArea.top} width={metrics.plotArea.width} height={metrics.plotArea.height} />
                    </g>
                )}
                renderOverlay={() => <circle data-testid="widget-chart-layout-overlay-dot" cx="100" cy="50" r="4" />}
            />,
        );

        const mainSvg = screen.getByTestId('widget-chart-layout-svg');
        const overlaySvg = screen.getByTestId('widget-chart-layout-overlay');
        const mainLayer = screen.getByTestId('widget-chart-layout-main');

        expect(mainSvg.querySelector(`#${layout.plotClipPathId}`)).not.toBeNull();
        expect(mainSvg).toHaveAttribute('data-chart-role', 'main');
        expect(mainLayer).toHaveAttribute('clip-path', `url(#${layout.plotClipPathId})`);
        expect(overlaySvg).toHaveClass('pointer-events-none', 'absolute', 'left-0');
        expect(overlaySvg).toHaveStyle({ top: '-20px', overflow: 'visible' });
        expect(overlaySvg).toHaveAttribute('viewBox', '0 -20 340 200');
        expect(screen.getByTestId('widget-chart-layout-overlay-dot').closest('svg')).toBe(overlaySvg);
    });

    it('exports shared external spacing classes for chart widgets', () => {
        expect(WIDGET_CHART_HEADER_CLASS).toBe('mb-0 shrink-0 min-w-0');
        expect(WIDGET_CHART_CONTAINER_CLASS).toBe('relative -mt-1 flex-1 min-h-0 -mx-3 -mb-3');
    });
});
