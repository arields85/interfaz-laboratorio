import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProdHistoryWidgetConfig } from '../../domain/admin.types';
import {
    resolveWidgetChartLayoutMetrics,
    WIDGET_CHART_CONTAINER_CLASS,
    WIDGET_CHART_HEADER_CLASS,
} from '../../components/ui/WidgetChartLayout.shared';
import ProduccionHistoricaWidget from './ProduccionHistoricaWidget';

const mockState = vi.hoisted(() => ({
    groupedDataByBucket: {
        hour: [
            { bucketKey: 'h-1', label: '06:00', production: 100, oee: 60 },
            { bucketKey: 'h-2', label: '07:00', production: 120, oee: 80 },
            { bucketKey: 'h-3', label: '08:00', production: 110, oee: 70 },
        ],
        shift: [
            { bucketKey: 's-1', label: 'Turno A', production: 140, oee: 75 },
            { bucketKey: 's-2', label: 'Turno B', production: 150, oee: 82 },
        ],
        day: [
            { bucketKey: 'd-1', label: 'Lun', production: 210, oee: 72 },
            { bucketKey: 'd-2', label: 'Mar', production: 235, oee: 78 },
            { bucketKey: 'd-3', label: 'Mié', production: 228, oee: 76 },
        ],
        month: [
            { bucketKey: 'm-1', label: 'Ene', production: 800, oee: 70 },
            { bucketKey: 'm-2', label: 'Feb', production: 860, oee: 83 },
        ],
    } as Record<string, Array<{ bucketKey: string; label: string; production: number; oee: number }>>,
    width: 320,
    height: 180,
}));

vi.mock('../../utils/temporalGrouping', () => ({
    groupByTemporalBucket: vi.fn((_series: unknown, bucket: string) => mockState.groupedDataByBucket[bucket] ?? []),
}));

vi.mock('../../components/ui/ChartHoverLayer', () => ({
    default: ({ dataLength, highlights, onHoverChange }: {
        dataLength: number;
        highlights?: Array<unknown>;
        onHoverChange: (index: number | null, x?: number) => void;
    }) => (
        <div data-testid="hover-layer" data-length={dataLength} data-highlights={highlights?.length ?? 0}>
            <button type="button" onClick={() => onHoverChange(0, 120)}>
                Hover first point
            </button>
            <button type="button" onClick={() => onHoverChange(null)}>
                Clear hover
            </button>
        </div>
    ),
}));

vi.mock('../../components/ui/ChartTooltip', () => ({
    default: ({ label, series }: { label: string; series: Array<{ name: string; value: string; shape?: string }> }) => (
        <div data-testid="chart-tooltip">
            {label}::{JSON.stringify(series)}
        </div>
    ),
}));

class MockResizeObserver implements ResizeObserver {
    public constructor(private readonly callback: ResizeObserverCallback) {}

    public observe(target: Element): void {
        this.callback([
            {
                target,
                contentRect: {
                    width: mockState.width,
                    height: mockState.height,
                    top: 0,
                    left: 0,
                    bottom: mockState.height,
                    right: mockState.width,
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

const equipmentMap = new Map();

function resetMockData(): void {
    mockState.groupedDataByBucket = {
        hour: [
            { bucketKey: 'h-1', label: '06:00', production: 100, oee: 60 },
            { bucketKey: 'h-2', label: '07:00', production: 120, oee: 80 },
            { bucketKey: 'h-3', label: '08:00', production: 110, oee: 70 },
        ],
        shift: [
            { bucketKey: 's-1', label: 'Turno A', production: 140, oee: 75 },
            { bucketKey: 's-2', label: 'Turno B', production: 150, oee: 82 },
        ],
        day: [
            { bucketKey: 'd-1', label: 'Lun', production: 210, oee: 72 },
            { bucketKey: 'd-2', label: 'Mar', production: 235, oee: 78 },
            { bucketKey: 'd-3', label: 'Mié', production: 228, oee: 76 },
        ],
        month: [
            { bucketKey: 'm-1', label: 'Ene', production: 800, oee: 70 },
            { bucketKey: 'm-2', label: 'Feb', production: 860, oee: 83 },
        ],
    };
    mockState.width = 320;
    mockState.height = 180;
}

function makeWidget(overrides?: Partial<ProdHistoryWidgetConfig>): ProdHistoryWidgetConfig {
    const baseDisplayOptions = {
        defaultTemporalGrouping: 'hour',
        defaultShowOee: true,
    };

    return {
        id: 'prod-history-1',
        type: 'prod-history',
        title: 'Producción Histórica',
        position: { x: 0, y: 0 },
        size: { w: 6, h: 4 },
        ...overrides,
        displayOptions: {
            ...baseDisplayOptions,
            ...overrides?.displayOptions,
        },
    };
}

function resolveExpectedProdHistoryLayout(showRightAxis: boolean) {
    return resolveWidgetChartLayoutMetrics({
        width: mockState.width,
        height: mockState.height,
        hasTopAdornments: true,
        firstXAxisLabel: mockState.groupedDataByBucket.hour[0]?.label ?? '',
        lastXAxisLabel: mockState.groupedDataByBucket.hour.at(-1)?.label ?? '',
        yAxisTickLabels: ['130', '120', '110', '100', '90'],
        idPrefix: 'prod-history-test-layout',
        baseMargin: {
            top: 17,
            right: showRightAxis ? 48 : 16,
            bottom: 30,
            left: 48,
        },
        topAdornmentReservedHeight: 11,
        topAdornmentOffset: 12,
        alignPlotAreaToXAxisLabels: true,
    });
}

describe('ProduccionHistoricaWidget', () => {
    beforeEach(() => {
        resetMockData();
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
            font: '',
            measureText: (text: string) => ({ width: text.length * 8 }),
        } as unknown as CanvasRenderingContext2D);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('renders the loading state', () => {
        render(<ProduccionHistoricaWidget widget={makeWidget()} equipmentMap={equipmentMap} isLoadingData />);

        const loadingState = screen.getByTestId('prod-history-widget-loading');

        expect(loadingState).toHaveTextContent('Cargando');
        expect(loadingState.querySelector('.widget-runtime-state-caret')).not.toBeNull();
        expect(screen.queryByTestId('hover-layer')).not.toBeInTheDocument();
    });

    it('uses the configured default grouping and updates the pressed bucket button', () => {
        render(
            <ProduccionHistoricaWidget
                widget={makeWidget({
                    displayOptions: {
                        defaultTemporalGrouping: 'day',
                        defaultShowOee: true,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        expect(screen.getByRole('button', { name: 'Día' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Hora' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByText('Lun')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Turno' }));

        expect(screen.getByRole('button', { name: 'Turno' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('Turno A')).toBeInTheDocument();
    });

    it('uses sentence case for production legend text and keeps OEE uppercase', () => {
        render(<ProduccionHistoricaWidget widget={makeWidget()} equipmentMap={equipmentMap} />);

        expect(screen.getByText('Producción (unidades)')).toBeInTheDocument();
        expect(screen.getByText('OEE (%)')).toBeInTheDocument();
        expect(screen.queryByText('PRODUCCIÓN (UNIDADES)')).not.toBeInTheDocument();
    });

    it('toggles OEE visibility and tooltip series from the legend checkbox', () => {
        render(
            <ProduccionHistoricaWidget
                widget={makeWidget({
                    displayOptions: {
                        defaultTemporalGrouping: 'hour',
                        defaultShowOee: false,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        expect(screen.getByText('OEE (%)')).toBeInTheDocument();
        const oeeToggle = screen.getByRole('checkbox', { name: 'Mostrar OEE (%)' });
        expect(oeeToggle).not.toBeChecked();

        fireEvent.click(oeeToggle);

        expect(oeeToggle).toBeChecked();
        fireEvent.click(screen.getByRole('button', { name: 'Hover first point' }));
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('OEE (%)');
        expect(screen.getByTestId('hover-layer')).toHaveAttribute('data-highlights', '2');

        fireEvent.click(oeeToggle);
        expect(oeeToggle).not.toBeChecked();

        fireEvent.click(screen.getByRole('button', { name: 'Hover first point' }));
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Producción (unidades)');
        expect(screen.getByTestId('chart-tooltip')).not.toHaveTextContent('OEE (%)');
        expect(screen.getByTestId('hover-layer')).toHaveAttribute('data-highlights', '1');
    });

    it('keeps the shell visible when grouped data cannot render a chart', () => {
        mockState.groupedDataByBucket.hour = [];

        const { container } = render(<ProduccionHistoricaWidget widget={makeWidget()} equipmentMap={equipmentMap} />);

        expect(screen.getByText('Producción Histórica')).toBeInTheDocument();
        expect(container.querySelector('svg[width="320"]')).not.toBeInTheDocument();
        expect(screen.queryByTestId('hover-layer')).not.toBeInTheDocument();
    });

    it('renders the header icon before the title', () => {
        render(<ProduccionHistoricaWidget widget={makeWidget()} equipmentMap={equipmentMap} />);

        const icon = screen.getByTestId('prod-history-widget-header-icon');
        const title = screen.getByText('Producción Histórica');
        const titleContainer = title.closest('div');

        expect(titleContainer).not.toBeNull();
        expect(titleContainer?.firstElementChild).toBe(icon);
    });

    it('renders the legend controls grouped below the header controls without a standalone OEE button', () => {
        render(<ProduccionHistoricaWidget widget={makeWidget()} equipmentMap={equipmentMap} />);

        const headerArea = screen.getByTestId('prod-history-widget-header-area');
        const legendControls = screen.getByTestId('prod-history-widget-legend-controls');
        const legendControlsGroup = screen.getByTestId('prod-history-widget-legend-controls-group');
        const runtimeControls = screen.getByTestId('prod-history-widget-runtime-controls');
        const oeeToggle = screen.getByRole('checkbox', { name: 'Mostrar OEE (%)' });

        expect(runtimeControls).not.toContainElement(oeeToggle);
        expect(headerArea).toContainElement(legendControls);
        expect(headerArea.lastElementChild).toBe(legendControls);
        expect(legendControls).toHaveClass('flex', 'justify-end');
        expect(legendControlsGroup).toHaveClass('flex', 'items-center', 'gap-4');
        expect(legendControlsGroup).not.toHaveClass('border', 'rounded-md', 'bg-industrial-panel/40');
        expect(oeeToggle).toBeVisible();
        expect(oeeToggle).not.toHaveClass('sr-only');
        expect(screen.getByTestId('prod-history-widget-oee-checkbox-visual')).toBeInTheDocument();
        expect(screen.getByText('Barras/Area')).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Cambiar modo de producción entre barras y área' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /oee/i })).not.toBeInTheDocument();
        expect(headerArea).toHaveClass(...WIDGET_CHART_HEADER_CLASS.split(' '));
        expect(screen.getByTestId('prod-history-widget-chart-shell')).toHaveClass(...WIDGET_CHART_CONTAINER_CLASS.split(' '));
    });

    it('defaults the runtime toggle to off and renders production bars', () => {
        const { container } = render(
            <ProduccionHistoricaWidget
                widget={makeWidget({
                    displayOptions: {
                        defaultTemporalGrouping: 'hour',
                        defaultShowOee: true,
                        productionChartMode: 'bars',
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        const modeToggle = screen.getByRole('checkbox', { name: 'Cambiar modo de producción entre barras y área' });

        expect(modeToggle).not.toBeChecked();
        expect(modeToggle).toHaveAttribute('title', 'Modo barras activado');
        expect(container.querySelectorAll('g[clip-path] rect')).toHaveLength(6);
    });

    it('uses the runtime toggle to switch production to area mode without forcing OEE', () => {
        const onPersistDisplayOptions = vi.fn();

        const { container } = render(
            <ProduccionHistoricaWidget
                widget={makeWidget({
                    displayOptions: {
                        defaultTemporalGrouping: 'hour',
                        defaultShowOee: true,
                        productionChartMode: 'bars',
                    },
                })}
                equipmentMap={equipmentMap}
                onPersistDisplayOptions={onPersistDisplayOptions}
            />,
        );

        const modeToggle = screen.getByRole('checkbox', { name: 'Cambiar modo de producción entre barras y área' });
        const oeeToggle = screen.getByRole('checkbox', { name: 'Mostrar OEE (%)' });

        expect(modeToggle).not.toBeChecked();
        expect(oeeToggle).toBeChecked();
        expect(container.querySelectorAll('g[clip-path] rect')).toHaveLength(6);

        fireEvent.click(modeToggle);

        expect(modeToggle).toBeChecked();
        expect(modeToggle).toHaveAttribute('title', 'Modo área activado');
        expect(container.querySelectorAll('g[clip-path] rect')).toHaveLength(0);
        expect(oeeToggle).toBeChecked();
        expect(onPersistDisplayOptions).toHaveBeenCalledTimes(1);
        expect(onPersistDisplayOptions).toHaveBeenCalledWith({ productionChartMode: 'area' });

        fireEvent.click(oeeToggle);

        expect(oeeToggle).not.toBeChecked();
        fireEvent.click(screen.getByRole('button', { name: 'Hover first point' }));
        expect(screen.getByTestId('hover-layer')).toHaveAttribute('data-highlights', '1');
    });

    it('persists area mode when the runtime toggle turns on', () => {
        const onPersistDisplayOptions = vi.fn();

        render(
            <ProduccionHistoricaWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                onPersistDisplayOptions={onPersistDisplayOptions}
            />,
        );

        fireEvent.click(screen.getByRole('checkbox', { name: 'Cambiar modo de producción entre barras y área' }));

        expect(onPersistDisplayOptions).toHaveBeenCalledWith({ productionChartMode: 'area' });
    });

    it('persists bars mode when the runtime toggle turns off', () => {
        const onPersistDisplayOptions = vi.fn();

        render(
            <ProduccionHistoricaWidget
                widget={makeWidget({
                    displayOptions: {
                        defaultTemporalGrouping: 'hour',
                        defaultShowOee: true,
                        productionChartMode: 'area',
                    },
                })}
                equipmentMap={equipmentMap}
                onPersistDisplayOptions={onPersistDisplayOptions}
            />,
        );

        const modeToggle = screen.getByRole('checkbox', { name: 'Cambiar modo de producción entre barras y área' });

        expect(modeToggle).toBeChecked();

        fireEvent.click(modeToggle);

        expect(onPersistDisplayOptions).toHaveBeenCalledWith({ productionChartMode: 'bars' });
    });

    it('keeps the OEE checkbox user-controlled in area mode and hides OEE line and area when unchecked', () => {
        const { container } = render(
            <ProduccionHistoricaWidget
                widget={makeWidget({
                    displayOptions: {
                        defaultTemporalGrouping: 'hour',
                        defaultShowOee: true,
                        productionChartMode: 'bars',
                        oeeShowArea: true,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        const modeToggle = screen.getByRole('checkbox', { name: 'Cambiar modo de producción entre barras y área' });
        const oeeToggle = screen.getByRole('checkbox', { name: 'Mostrar OEE (%)' });

        fireEvent.click(modeToggle);

        expect(modeToggle).toBeChecked();
        expect(oeeToggle).toBeChecked();
        expect(container.querySelectorAll('g[clip-path] path')).toHaveLength(4);

        fireEvent.click(screen.getByRole('button', { name: 'Hover first point' }));
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('OEE (%)');
        expect(screen.getByTestId('hover-layer')).toHaveAttribute('data-highlights', '2');

        fireEvent.click(oeeToggle);

        expect(oeeToggle).not.toBeChecked();
        expect(container.querySelectorAll('g[clip-path] path')).toHaveLength(2);

        fireEvent.click(screen.getByRole('button', { name: 'Hover first point' }));
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Producción (unidades)');
        expect(screen.getByTestId('chart-tooltip')).not.toHaveTextContent('OEE (%)');
        expect(screen.getByTestId('hover-layer')).toHaveAttribute('data-highlights', '1');
    });

    it('renders through WidgetChartLayout while preserving the left unit placement and overlay layer', () => {
        render(<ProduccionHistoricaWidget widget={makeWidget()} equipmentMap={equipmentMap} />);

        const layout = resolveExpectedProdHistoryLayout(true);
        const chartSvg = screen.getByTestId('prod-history-widget-chart');
        const overlaySvg = screen.getByTestId('prod-history-widget-overlay-svg');
        const unit = screen.getByTestId('prod-history-widget-y-axis-unit');
        const xAxisLabels = screen.getAllByTestId('prod-history-widget-x-axis-label');
        const allRects = Array.from(chartSvg.querySelectorAll('g[clip-path] rect'));
        const barRects = allRects.filter((_, index) => index % 2 === 0);
        const capRects = allRects.filter((_, index) => index % 2 === 1);

        expect(chartSvg.querySelector('clipPath')).not.toBeNull();
        expect(overlaySvg).toHaveClass('pointer-events-none', 'absolute', 'left-0');
        expect(unit).toHaveTextContent('unidades');
        expect(unit).toHaveAttribute('x', String(layout.plotArea.left - 18));
        expect(unit).toHaveAttribute('y', String(layout.plotArea.top - 12));
        expect(unit).toHaveAttribute('font-family', 'var(--font-chart)');
        expect(unit).toHaveAttribute('letter-spacing', 'var(--tracking-chart)');
        expect(barRects).toHaveLength(3);
        expect(capRects).toHaveLength(3);
        xAxisLabels.forEach((label, index) => {
            const bar = barRects[index];
            const barX = Number(bar?.getAttribute('x'));
            const barWidth = Number(bar?.getAttribute('width'));
            expect(label).toHaveAttribute('x', String(barX + (barWidth / 2)));
        });
        capRects.forEach((cap, index) => {
            expect(cap).toHaveAttribute('height', '2');
            expect(cap).toHaveAttribute('width', barRects[index]?.getAttribute('width') ?? '');
            expect(cap).toHaveAttribute('x', barRects[index]?.getAttribute('x') ?? '');
        });
    });

    it('keeps the OEE legend checkbox visually stable between unchecked and checked states', () => {
        render(
            <ProduccionHistoricaWidget
                widget={makeWidget({
                    displayOptions: {
                        defaultTemporalGrouping: 'hour',
                        defaultShowOee: false,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        const oeeToggle = screen.getByRole('checkbox', { name: 'Mostrar OEE (%)' });
        const oeeCheckboxVisual = screen.getByTestId('prod-history-widget-oee-checkbox-visual');

        expect(oeeToggle).not.toBeChecked();
        expect(oeeToggle).toHaveClass('absolute', 'opacity-0', 'cursor-pointer');
        expect(oeeToggle).not.toHaveClass('sr-only', 'accent-admin-accent', 'accent-blue');
        expect(oeeCheckboxVisual).toHaveClass(
            'h-3.5',
            'w-3.5',
            'border-admin-accent/30',
            'bg-admin-accent/10',
            'text-transparent',
            'group-hover/runtime-checkbox:border-admin-accent',
            'group-hover/runtime-checkbox:bg-admin-accent/20',
            'transition-colors',
        );
        expect(oeeCheckboxVisual).not.toHaveClass('text-admin-accent');
        expect(screen.queryByTestId('prod-history-widget-oee-checkbox-check')).not.toBeInTheDocument();

        fireEvent.click(oeeToggle);

        expect(oeeToggle).toBeChecked();
        expect(oeeCheckboxVisual).toHaveClass(
            'border-admin-accent/30',
            'bg-admin-accent/10',
            'text-admin-accent',
            'group-hover/runtime-checkbox:border-admin-accent',
            'group-hover/runtime-checkbox:bg-admin-accent/20',
        );
        expect(oeeCheckboxVisual).not.toHaveClass('text-transparent');
        expect(screen.getByTestId('prod-history-widget-oee-checkbox-check')).toBeInTheDocument();
    });

    it('uses manual axis bounds when auto scale is disabled with valid values', () => {
        render(
            <ProduccionHistoricaWidget
                widget={makeWidget({
                    displayOptions: {
                        defaultTemporalGrouping: 'hour',
                        defaultShowOee: true,
                        autoScale: false,
                        productionAxisMin: 10,
                        productionAxisMax: 50,
                        oeeAxisMin: 20,
                        oeeAxisMax: 90,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        expect(screen.getByText('50')).toBeInTheDocument();
        expect(screen.getByText('10')).toBeInTheDocument();
        expect(screen.getByText('90')).toBeInTheDocument();
        expect(screen.getAllByText('20')).toHaveLength(2);
    });

    it('shows the right OEE axis only when OEE is active and keeps it aligned to plot right', () => {
        render(
            <ProduccionHistoricaWidget
                widget={makeWidget({
                    displayOptions: {
                        defaultTemporalGrouping: 'hour',
                        defaultShowOee: true,
                        useSecondaryAxis: true,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        const withOeeLayout = resolveExpectedProdHistoryLayout(true);
        const rightAxisTicks = screen.getAllByTestId('prod-history-widget-right-axis-tick');
        expect(rightAxisTicks).toHaveLength(5);
        rightAxisTicks.forEach((tick) => {
            expect(tick).toHaveAttribute('x', String(withOeeLayout.plotArea.right + 8));
        });

        fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar OEE (%)' }));

        expect(screen.queryByTestId('prod-history-widget-right-axis-tick')).not.toBeInTheDocument();
    });

    it('falls back to auto domains when manual bounds are invalid', () => {
        render(
            <ProduccionHistoricaWidget
                widget={makeWidget({
                    displayOptions: {
                        defaultTemporalGrouping: 'hour',
                        defaultShowOee: true,
                        autoScale: false,
                        productionAxisMin: 999,
                        productionAxisMax: 100,
                        oeeAxisMin: 95,
                        oeeAxisMax: 40,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        expect(screen.getByText('130')).toBeInTheDocument();
        expect(screen.getByText('90')).toBeInTheDocument();
        expect(screen.getByText('84')).toBeInTheDocument();
        expect(screen.getByText('56')).toBeInTheDocument();
        expect(screen.queryByText('999')).not.toBeInTheDocument();
    });

    it('renders area mode without grid lines or secondary axis and shows OEE points', () => {
        render(
            <ProduccionHistoricaWidget
                widget={makeWidget({
                    title: undefined,
                    displayOptions: {
                        defaultTemporalGrouping: 'hour',
                        defaultShowOee: true,
                        chartTitle: 'Historical Throughput',
                        productionLabel: 'Output',
                        productionUnit: 'kg',
                        productionChartMode: 'area',
                        useSecondaryAxis: false,
                        showGrid: false,
                        oeeShowArea: true,
                        oeeShowPoints: true,
                        icon: null,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        expect(screen.getByText('Historical Throughput')).toBeInTheDocument();
        expect(screen.getByText('Output (kg)')).toBeInTheDocument();
        expect(screen.getByText('OEE (%)')).toBeInTheDocument();

        const svg = screen.getByTestId('prod-history-widget-chart');
        const overlaySvg = screen.getByTestId('prod-history-widget-overlay-svg');
        expect(svg).toBeInTheDocument();
        expect(svg?.querySelectorAll('line')).toHaveLength(0);
        expect(svg?.querySelectorAll('circle')).toHaveLength(3);
        expect(overlaySvg.querySelectorAll('circle')).toHaveLength(4);
        expect(screen.queryByText('84')).not.toBeInTheDocument();
    });

});
