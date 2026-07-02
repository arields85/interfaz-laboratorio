import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrendChartWidgetConfig } from '../../domain/admin.types';
import type { DataHistoryResponse, ContractMachine } from '../../domain/dataContract.types';
import { WIDGET_CHART_CONTAINER_CLASS, WIDGET_CHART_HEADER_CLASS } from '../../components/ui/WidgetChartLayout.shared';
import { isDataHistoryEnabled } from '../../config/dataConnection.config';
import { useDataHistory } from '../../queries/useDataHistory';
import { getChartLetterSpacingPx, getChartTextFont, measureChartTextWidthPx } from '../../utils/chartHelpers';
import TrendChartWidget from './TrendChartWidget';
import { buildTrendChartVisibleLabelIndices } from './trendChartVisibleLabels';

vi.mock('../../config/dataConnection.config', () => ({
    isDataHistoryEnabled: vi.fn(),
}));

vi.mock('../../queries/useDataHistory', () => ({
    useDataHistory: vi.fn(),
}));

class MockResizeObserver implements ResizeObserver {
    public constructor(private readonly callback: ResizeObserverCallback) {}

    public observe(target: Element): void {
        this.callback([
            {
                target,
                contentRect: {
                    width: 320,
                    height: 180,
                    top: 0,
                    left: 0,
                    bottom: 180,
                    right: 320,
                    x: 0,
                    y: 0,
                    toJSON: () => ({}),
                },
            } as ResizeObserverEntry,
        ], this);
    }

    public unobserve(): void {}

    public disconnect(): void {}
}

class MockCanvasRenderingContext2D implements Partial<CanvasRenderingContext2D> {
    public font = '';

    public measureText(text: string): TextMetrics {
        return {
            width: text.length * 8,
        } as TextMetrics;
    }
}

const equipmentMap = new Map();

function makeWidget(binding?: TrendChartWidgetConfig['binding']): TrendChartWidgetConfig {
    return {
        id: 'trend-1',
        type: 'trend-chart',
        title: 'Temperatura',
        position: { x: 0, y: 0 },
        size: { w: 6, h: 4 },
        binding: binding ?? {
            mode: 'real_variable',
            bindingVersion: 'node-red-v1',
            machineId: 101,
            variableKey: 'temperature',
        },
    };
}

function makeMachines(value: number | null): ContractMachine[] {
    return [{
        unitId: 101,
        name: 'Extrusora 101',
        status: 'online',
        lastSuccess: '2026-04-22T12:00:00.000Z',
        ageMs: 0,
        values: {
            temperature: {
                value,
                unit: '°C',
                timestamp: '2026-04-22T12:00:00.000Z',
            },
        },
    }];
}

function makeHistoryResponse(): DataHistoryResponse {
    return {
        contractVersion: '1.0.0',
        machineId: 101,
        variableKey: 'temperature',
        range: 'hora',
        unit: '°C',
        series: [
            { timestamp: '2026-04-22T10:00:00.000Z', value: 45 },
            { timestamp: '2026-04-22T11:00:00.000Z', value: null },
            { timestamp: '2026-04-22T12:00:00.000Z', value: 52 },
        ],
        summary: {
            last: 52,
            min: 45,
            max: 52,
            avg: 48.5,
        },
    };
}

function makeDenseHistoryResponse(): DataHistoryResponse {
    return {
        contractVersion: '1.0.0',
        machineId: 101,
        variableKey: 'temperature',
        range: 'hora',
        unit: '°C',
        series: Array.from({ length: 12 }, (_, index) => ({
            timestamp: `2026-04-22T10:${String(index * 5).padStart(2, '0')}:00.000Z`,
            value: 40 + index,
        })),
        summary: {
            last: 51,
            min: 40,
            max: 51,
            avg: 45.5,
        },
    };
}

function formatLocalHourMinute(timestamp: string): string {
    const date = new Date(timestamp);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

describe('TrendChartWidget', () => {
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new MockCanvasRenderingContext2D() as CanvasRenderingContext2D);
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        vi.mocked(useDataHistory).mockReturnValue({
            data: null,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('renders the range selector and updates the history range query', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse(),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(
            <TrendChartWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(50)}
            />,
        );

        expect(screen.getByRole('button', { name: 'Hora' })).toHaveAttribute('aria-pressed', 'true');
        expect(useDataHistory).toHaveBeenLastCalledWith({
            machineId: 101,
            variableKey: 'temperature',
            range: 'hora',
        });

        fireEvent.click(screen.getByRole('button', { name: 'Día' }));

        expect(useDataHistory).toHaveBeenLastCalledWith({
            machineId: 101,
            variableKey: 'temperature',
            range: 'dia',
        });
        expect(screen.getByRole('button', { name: 'Día' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('reuses the shared compact external spacing classes for the header and chart container', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse(),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(
            <TrendChartWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(50)}
            />,
        );

        const header = screen.getByText('Temperatura').closest('div[class*="grid-cols"]');
        const chartContainer = screen.getByTestId('trend-chart-svg').parentElement?.parentElement;

        expect(header).toHaveClass(...WIDGET_CHART_HEADER_CLASS.split(' '));
        expect(chartContainer).toHaveClass(...WIDGET_CHART_CONTAINER_CLASS.split(' '));
    });

    it('prefers real history data, filters null points, and renders summary in the top meta slot contract', () => {
        vi.mocked(useDataHistory).mockImplementation((params) => ({
            data: params?.range === 'dia'
                ? { ...makeHistoryResponse(), range: 'dia' }
                : makeHistoryResponse(),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        }));

        render(
            <TrendChartWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(50)}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Día' }));

        const summary = screen.getByTestId('trend-chart-summary');
        const unitLabel = screen.getByTestId('trend-chart-y-axis-unit');
        const expectedSummaryX = 320 - Math.ceil((measureChartTextWidthPx('22/04', getChartTextFont(), getChartLetterSpacingPx()) / 2) + 2);

        expect(screen.getAllByText(/22\/04/).length).toBeGreaterThan(0);
        expect(screen.getByTestId('trend-chart-summary-min')).toHaveTextContent('min 45°c');
        expect(screen.getByTestId('trend-chart-summary-max')).toHaveTextContent('max 52°c');
        expect(screen.getByTestId('trend-chart-summary-avg')).toHaveTextContent('avg 49°c');
        expect(summary).toHaveAttribute('text-anchor', 'end');
        expect(Number(summary.getAttribute('x'))).toBeCloseTo(expectedSummaryX, 3);
        expect(summary.getAttribute('y')).toBe(unitLabel.getAttribute('y'));
        expect(summary).toHaveAttribute('fill', 'var(--color-industrial-muted)');
        expect(screen.queryByText('--')).not.toBeInTheDocument();
    });

    it('renders the unit centered over the y-axis label block inside the svg instead of the widget header subtitle', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse(),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        const { container } = render(
            <TrendChartWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(50)}
            />,
        );

        const unitLabel = screen.getByTestId('trend-chart-y-axis-unit');
        const headerSubtitle = container.querySelector('.row-start-2');

        expect(unitLabel).toHaveTextContent('°C');
        expect(unitLabel).toHaveAttribute('text-anchor', 'middle');
        expect(unitLabel).toHaveAttribute('x', '29');
        expect(unitLabel).toHaveAttribute('y', '11');
        expect(unitLabel).toHaveAttribute('font-size', 'var(--font-size-system)');
        expect(unitLabel).toHaveAttribute('font-family', 'var(--font-system)');
        expect(unitLabel).toHaveAttribute('font-weight', 'var(--font-weight-system)');
        expect(unitLabel).toHaveAttribute('letter-spacing', 'var(--tracking-system)');
        expect(headerSubtitle).toHaveAttribute('aria-hidden', 'true');
        expect(headerSubtitle).not.toHaveTextContent('°C');
    });

    it('shows the loading skeleton while history is loading', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: null,
            isLoading: true,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(
            <TrendChartWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(50)}
            />,
        );

        expect(screen.getByText('Cargando datos...')).toBeInTheDocument();
    });

    it('shows empty state when history is disabled and binding is real', () => {
        vi.mocked(isDataHistoryEnabled).mockReturnValue(false);

        render(
            <TrendChartWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(50)}
            />,
        );

        expect(useDataHistory).toHaveBeenCalledWith(null);
        expect(screen.queryByText('Cargando datos...')).not.toBeInTheDocument();
        expect(screen.getByText('--')).toBeInTheDocument();
        expect(screen.getByText('Sin datos')).toBeInTheDocument();
    });

    it('falls back to simulated data when binding mode is simulated_value', () => {
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);

        render(
            <TrendChartWidget
                widget={makeWidget({
                    mode: 'simulated_value',
                    simulatedValue: 50,
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(50)}
            />,
        );

        expect(useDataHistory).toHaveBeenCalledWith(null);
        expect(screen.queryByText('Cargando datos...')).not.toBeInTheDocument();
        expect(screen.queryByText('--')).not.toBeInTheDocument();
        expect(screen.queryByText('Sin datos')).not.toBeInTheDocument();
    });

    it('keeps the first and last x-axis labels visible with middle anchoring', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeDenseHistoryResponse(),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        const { container } = render(
            <TrendChartWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(50)}
            />,
        );

        const xAxisLabels = Array.from(container.querySelectorAll('[data-testid="trend-chart-x-axis-label"]'));
        const denseHistory = makeDenseHistoryResponse();
        const firstExpectedLabel = formatLocalHourMinute(denseHistory.series[0].timestamp);
        const lastExpectedLabel = formatLocalHourMinute(denseHistory.series[denseHistory.series.length - 1].timestamp);

        expect(xAxisLabels.length).toBeGreaterThanOrEqual(2);
        expect(xAxisLabels[0]).toHaveTextContent(firstExpectedLabel);
        expect(xAxisLabels[0]).toHaveAttribute('text-anchor', 'middle');
        expect(xAxisLabels[xAxisLabels.length - 1]).toHaveTextContent(lastExpectedLabel);
        expect(xAxisLabels[xAxisLabels.length - 1]).toHaveAttribute('text-anchor', 'middle');
        xAxisLabels.forEach((label) => {
            expect(label).toHaveAttribute('text-anchor', 'middle');
        });
    });

    it('distributes dense x-axis labels evenly from start to end without a forced trailing gap', () => {
        const denseHistory = makeDenseHistoryResponse();
        const labels = denseHistory.series.map((point) => formatLocalHourMinute(point.timestamp));
        const positions = labels.map((_, index) => 45 + (index * ((320 - 45 - 30) / (labels.length - 1))));
        const visibleIndices = buildTrendChartVisibleLabelIndices({
            labels,
            positions,
            plotWidth: 320 - 45 - 30,
            font: '400 12px monospace',
            letterSpacing: 0,
            minGap: 8,
        });
        const gaps = visibleIndices.slice(1).map((index, gapIndex) => index - visibleIndices[gapIndex]);
        const smallestGap = Math.min(...gaps);
        const largestGap = Math.max(...gaps);

        expect(visibleIndices[0]).toBe(0);
        expect(visibleIndices.at(-1)).toBe(labels.length - 1);
        expect(visibleIndices.length).toBeGreaterThanOrEqual(2);
        expect(largestGap).toBeLessThanOrEqual(smallestGap * 2);
    });

    it('renders the final point pulse and core in the overlay svg instead of the clipped plot layer', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse(),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        const { container } = render(
            <TrendChartWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(50)}
            />,
        );

        const chartSvg = screen.getByTestId('trend-chart-svg');
        const overlaySvg = screen.getByTestId('trend-chart-overlay-svg');
        const pulse = screen.getByTestId('trend-chart-final-point-pulse');
        const core = screen.getByTestId('trend-chart-final-point-core');

        expect(overlaySvg).toHaveAttribute('viewBox', '0 -20 340 200');
        expect(pulse.closest('svg')).toBe(overlaySvg);
        expect(core.closest('svg')).toBe(overlaySvg);
        expect(chartSvg).not.toContainElement(pulse);
        expect(chartSvg).not.toContainElement(core);
        expect(container.querySelector(`[clip-path="url(#trend-1-plot-clip)"]`)).not.toContainElement(pulse);
        expect(container.querySelector(`[clip-path="url(#trend-1-plot-clip)"]`)).not.toContainElement(core);
    });
});
