import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProdHistoryWidgetConfig } from '../../domain/admin.types';
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

        expect(screen.getByText('Cargando datos...')).toBeInTheDocument();
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

    it('toggles OEE legend and tooltip series when the control is pressed', () => {
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

        expect(screen.queryByText('OEE (%)')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /oee/i }));

        expect(screen.getByText('OEE (%)')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Hover first point' }));
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('OEE (%)');
        expect(screen.getByTestId('hover-layer')).toHaveAttribute('data-highlights', '2');

        fireEvent.click(screen.getByRole('button', { name: /oee/i }));
        expect(screen.queryByText('OEE (%)')).not.toBeInTheDocument();

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
        const { container } = render(
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

        const svg = container.querySelector('svg[width="320"]');
        expect(svg).toBeInTheDocument();
        expect(svg?.querySelectorAll('line')).toHaveLength(0);
        expect(svg?.querySelectorAll('circle')).toHaveLength(7);
        expect(screen.queryByText('84')).not.toBeInTheDocument();
    });
});
