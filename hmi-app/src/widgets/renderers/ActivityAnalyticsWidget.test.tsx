import '@testing-library/jest-dom/vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivitySeriesAdapterError } from '../../adapters/activitySeries.adapter';
import type { ActivityAnalyticsWidgetConfig } from '../../domain/admin.types';
import type { ContractMachine } from '../../domain/dataContract.types';
import { isDataActivitySeriesEnabled } from '../../config/dataConnection.config';
import { useTemporalSettings } from '../../hooks/useTemporalSettings';
import { useActivitySeries } from '../../queries/useActivitySeries';
import { DataServiceError } from '../../services/dataOverview.service';
import * as activityAnalyticsComputation from '../../utils/activityAnalyticsComputation';
import ActivityAnalyticsWidget from './ActivityAnalyticsWidget';

class MockResizeObserver implements ResizeObserver {
    private static instances: MockResizeObserver[] = [];

    private observedTarget: Element | null = null;

    public constructor(private readonly callback: ResizeObserverCallback) {
        MockResizeObserver.instances.push(this);
    }

    public observe(target: Element): void {
        this.observedTarget = target;
        this.emit(640, 420, target);
    }

    public unobserve(): void {}

    public disconnect(): void {}

    public emit(width: number, height: number, target: Element | null = this.observedTarget): void {
        if (!target) {
            return;
        }

        this.callback([
            {
                target,
                contentRect: {
                    width,
                    height,
                    top: 0,
                    left: 0,
                    bottom: height,
                    right: width,
                    x: 0,
                    y: 0,
                    toJSON: () => ({}),
                },
            } as ResizeObserverEntry,
        ], this);
    }

    public static latest(): MockResizeObserver {
        const instance = MockResizeObserver.instances.at(-1);

        if (!instance) {
            throw new Error('No ResizeObserver instance was created');
        }

        return instance;
    }

    public static reset(): void {
        MockResizeObserver.instances = [];
    }
}

vi.mock('../../config/dataConnection.config', () => ({
    isDataActivitySeriesEnabled: vi.fn(),
}));

vi.mock('../../hooks/useTemporalSettings', () => ({
    useTemporalSettings: vi.fn(),
}));

vi.mock('../../queries/useActivitySeries', () => ({
    useActivitySeries: vi.fn(),
}));

vi.mock('../../components/ui/ChartHoverLayer', () => ({
    default: ({ dataLength, highlights, onHoverChange }: {
        dataLength: number;
        highlights?: Array<unknown>;
        onHoverChange: (index: number | null, x?: number) => void;
    }) => (
        <div data-testid="hover-layer" data-length={dataLength} data-highlights={highlights?.length ?? 0}>
            <button type="button" onClick={() => onHoverChange(0, 120)}>
                Hover first bucket
            </button>
            <button type="button" onClick={() => onHoverChange(null)}>
                Clear hover
            </button>
        </div>
    ),
}));

vi.mock('../../components/ui/ChartTooltip', () => ({
    default: ({ label, series }: { label: string; series: Array<{ name: string; value: string }> }) => (
        <div data-testid="chart-tooltip">
            {label}::{JSON.stringify(series)}
        </div>
    ),
}));

function makeWidget(overrides?: Partial<ActivityAnalyticsWidgetConfig>): ActivityAnalyticsWidgetConfig {
    return {
        id: 'activity-analytics-1',
        type: 'activity-analytics',
        title: 'Análisis de Actividad',
        position: { x: 0, y: 0 },
        size: { w: 11, h: 9 },
        binding: {
            mode: 'real_variable',
            bindingVersion: 'node-red-v1',
            machineId: 101,
        },
        displayOptions: {
            range: '24h',
            groupBy: 'day',
            setupThresholdKw: 0.15,
            prodThresholdKw: 0.25,
            displayMode: 'kpis-and-bars',
        },
        ...overrides,
    };
}

const MACHINES: ContractMachine[] = [{
    unitId: 101,
    name: 'Extrusora 101',
    status: 'online',
    lastSuccess: '2026-04-21T13:00:00.000Z',
    ageMs: 0,
    values: {},
}];

const POPULATED_ACTIVITY_SERIES = {
    contractVersion: '1.0.0',
    machineId: 101,
    variableKey: 'Total kW',
    range: '24h' as const,
    unit: 'kW',
    purpose: 'activity-analytics' as const,
    window: {
        start: '2026-06-18T12:00:00.000Z',
        end: '2026-06-18T13:00:00.000Z',
        timezone: 'UTC',
        bucket: '5m',
        bucketMs: 300000,
    },
    series: [{
        timestamp: '2026-06-18T12:00:00.000Z',
        timestampMs: Date.parse('2026-06-18T12:00:00.000Z'),
        value: 0.3,
    }],
    summary: { hidden: true },
};

function buildGroupedBucket(overrides?: Partial<ReturnType<typeof activityAnalyticsComputation.computeActivityAnalytics>['grouped'][number]>) {
    return {
        bucketKey: 'bucket-1',
        label: '2026-06-18 · Turno 1',
        startMs: 0,
        endMs: 1,
        durationsMs: {
            prod: 2 * 60 * 60 * 1000,
            setup: 1 * 60 * 60 * 1000,
            stopped: 0,
            noData: 0,
        },
        estimatedKwh: 0,
        stopCount: 0,
        utilizationRatio: 2 / 3,
        coverageRatio: 1,
        expectedDurationMs: 3 * 60 * 60 * 1000,
        productivityRatio: 2 / 3,
        productivityLabel: '67%',
        isInProgress: false,
        ...overrides,
    };
}

function mockComputedAnalytics(grouped: Array<ReturnType<typeof activityAnalyticsComputation.computeActivityAnalytics>['grouped'][number]>) {
    vi.spyOn(activityAnalyticsComputation, 'computeActivityAnalytics').mockReturnValue({
        analytics: {
            durationsMs: {
                prod: 4 * 60 * 60 * 1000,
                setup: 2 * 60 * 60 * 1000,
                stopped: 1 * 60 * 60 * 1000,
                noData: 0,
            },
            stopCount: 1,
            estimatedKwh: 18.4,
            utilizationRatio: 4 / 7,
            coverageRatio: 1,
            intervals: [],
        },
        grouped,
        comparison: {
            best: { label: grouped[0]?.label ?? 'sin datos', bucketKey: grouped[0]?.bucketKey ?? 'best' },
            worst: { label: grouped.at(-1)?.label ?? 'sin datos', bucketKey: grouped.at(-1)?.bucketKey ?? 'worst' },
        },
        summaryRows: grouped.map((bucket) => ({ label: bucket.label, productivityLabel: bucket.productivityLabel, bucketKey: bucket.bucketKey })),
        timezone: 'UTC',
    } as never);
}

describe('ActivityAnalyticsWidget', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        MockResizeObserver.reset();
    });

    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
            font: '',
            measureText: (text: string) => ({ width: text.length * 8 }),
        } as unknown as CanvasRenderingContext2D);
        vi.mocked(isDataActivitySeriesEnabled).mockReturnValue(true);
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: null, shifts: [] },
            shifts: [],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useActivitySeries).mockReturnValue({
            data: null,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
    });

    it('shows a missing-machine state before querying when the widget has no machine binding', () => {
        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ binding: { mode: 'real_variable', bindingVersion: 'node-red-v1' } })}
                machines={MACHINES}
            />,
        );

        expect(screen.getByText('Seleccione una máquina')).toBeInTheDocument();
    });

    it('shows an invalid-machine state before loading when the binding stores a non-numeric equipment key', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: null,
            isLoading: true,
            isError: false,
            error: null,
            isEnabled: false,
        });

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    binding: {
                        mode: 'real_variable',
                        bindingVersion: 'node-red-v1',
                        machineId: 'FT2000' as unknown as number,
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(screen.getByText('Seleccione una máquina válida')).toBeInTheDocument();
        expect(screen.queryByText('Cargando actividad…')).not.toBeInTheDocument();
    });

    it('resolves legacy machine-name bindings to the contract unit id before querying', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    binding: {
                        mode: 'real_variable',
                        bindingVersion: 'node-red-v1',
                        machineId: 'Reiner' as unknown as number,
                    },
                })}
                machines={[{
                    unitId: 202,
                    name: 'Reiner',
                    status: 'online',
                    lastSuccess: '2026-04-21T13:00:00.000Z',
                    ageMs: 0,
                    values: {},
                }]}
            />,
        );

        expect(vi.mocked(useActivitySeries)).toHaveBeenCalledWith({ machineId: 202, range: '24h' });
        expect(screen.getByText('Reiner')).toBeInTheDocument();
        expect(screen.queryByText('Seleccione una máquina válida')).not.toBeInTheDocument();
    });

    it('shows an invalid-machine state before loading when the binding points to a machine outside the contract', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: null,
            isLoading: true,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    binding: {
                        mode: 'real_variable',
                        bindingVersion: 'node-red-v1',
                        machineId: 999,
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(screen.getByText('Seleccione una máquina válida')).toBeInTheDocument();
        expect(screen.queryByText('Cargando actividad…')).not.toBeInTheDocument();
    });

    it('shows an endpoint-not-configured state when activity-series is disabled', () => {
        vi.mocked(isDataActivitySeriesEnabled).mockReturnValue(false);

        render(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} />);

        expect(screen.getByText('Endpoint Activity-Series no configurado')).toBeInTheDocument();
    });

    it('shows a loading state while the activity-series query is pending', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: null,
            isLoading: true,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} />);

        expect(screen.getByText('Cargando actividad…')).toBeInTheDocument();
    });

    it('shows a clear invalid-threshold state for legacy invalid configs', () => {
        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        range: '24h',
                        groupBy: 'day',
                        setupThresholdKw: 0.3,
                        prodThresholdKw: 0.2,
                        displayMode: 'kpis-and-bars',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(screen.getByText('Configuración de umbrales inválida')).toBeInTheDocument();
    });

    it('keeps persisted custom windows internal while still querying with explicit bounds', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        range: 'custom',
                        start: '2026-06-18T10:00:00.000Z',
                        end: '2026-06-18T12:00:00.000Z',
                        groupBy: 'shift',
                        setupThresholdKw: 0.15,
                        prodThresholdKw: 0.25,
                        displayMode: 'kpis-and-bars',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(vi.mocked(useActivitySeries)).toHaveBeenCalledWith({
            machineId: 101,
            range: 'custom',
            start: '2026-06-18T10:00:00.000Z',
            end: '2026-06-18T12:00:00.000Z',
        });
        expect(screen.queryByRole('button', { name: 'Custom' })).not.toBeInTheDocument();
        expect(screen.queryByText('Ventana personalizada')).not.toBeInTheDocument();
    });

    it('keeps persisted custom support across builder refreshes without exposing runtime custom controls', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        const { rerender } = render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        range: 'custom',
                        start: '2026-06-18T10:00:00.000Z',
                        end: '2026-06-18T12:00:00.000Z',
                        groupBy: 'shift',
                        setupThresholdKw: 0.15,
                        prodThresholdKw: 0.25,
                        displayMode: 'kpis-and-bars',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(vi.mocked(useActivitySeries)).toHaveBeenLastCalledWith({
            machineId: 101,
            range: 'custom',
            start: '2026-06-18T10:00:00.000Z',
            end: '2026-06-18T12:00:00.000Z',
        });
        expect(screen.queryByRole('button', { name: 'Custom' })).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Hasta')).not.toBeInTheDocument();

        rerender(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        range: 'custom',
                        start: '2026-06-20T08:00:00.000Z',
                        end: '2026-06-20T10:00:00.000Z',
                        groupBy: 'week',
                        setupThresholdKw: 0.15,
                        prodThresholdKw: 0.25,
                        displayMode: 'kpis-and-bars',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(vi.mocked(useActivitySeries)).toHaveBeenLastCalledWith({
            machineId: 101,
            range: 'custom',
            start: '2026-06-20T08:00:00.000Z',
            end: '2026-06-20T10:00:00.000Z',
        });
        expect(screen.queryByRole('button', { name: 'Custom' })).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Hasta')).not.toBeInTheDocument();
    });

    it('clamps persisted invalid grouping to the shared rules contract, keeps runtime overrides local, and preserves the hero summary while only detail layers change', async () => {
        const user = userEvent.setup();
        const onPersistDisplayOptions = vi.fn();

        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        vi.spyOn(activityAnalyticsComputation, 'computeActivityAnalytics').mockImplementation(({ groupBy }) => ({
            analytics: {
                durationsMs: {
                    prod: 7 * 60 * 60 * 1000,
                    setup: 1 * 60 * 60 * 1000,
                    stopped: 0,
                    noData: 0,
                },
                stopCount: 0,
                estimatedKwh: 0,
                utilizationRatio: 7 / 8,
                coverageRatio: 1,
                intervals: [],
            },
            grouped: [{
                bucketKey: `bucket-${groupBy}`,
                label: `Agrupación runtime: ${groupBy}`,
                startMs: 0,
                endMs: 1,
                durationsMs: { prod: 2 * 60 * 60 * 1000, setup: 0, stopped: 0, noData: 0 },
                estimatedKwh: 0,
                stopCount: 0,
                utilizationRatio: 1,
                coverageRatio: 1,
                expectedDurationMs: 8,
                productivityRatio: 1,
                productivityLabel: '100%',
                isInProgress: false,
            }],
            comparison: {
                best: { label: `Best ${groupBy}`, bucketKey: `best-${groupBy}` },
                worst: { label: `Worst ${groupBy}`, bucketKey: `worst-${groupBy}` },
            },
            summaryRows: [{ label: `Agrupación runtime: ${groupBy}`, productivityLabel: '100%', bucketKey: `row-${groupBy}` }],
            timezone: 'UTC',
        }) as never);

        const initialWidget = makeWidget({
            displayOptions: {
                range: '24h',
                groupBy: 'week',
                setupThresholdKw: 0.15,
                prodThresholdKw: 0.25,
                displayMode: 'kpis-and-bars',
            },
        });

        const { rerender } = render(
            <ActivityAnalyticsWidget
                widget={initialWidget}
                machines={MACHINES}
                onPersistDisplayOptions={onPersistDisplayOptions}
            />,
        );

        expect(screen.getByRole('button', { name: 'Día' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getAllByText('Agrupación runtime: day').length).toBeGreaterThan(0);
        expect(screen.getByTestId('activity-analytics-summary-bars')).toHaveTextContent('7.0 h');
        expect(screen.getByTestId('activity-analytics-comparison')).toHaveTextContent('Best day');

        const runtimeGroupSelector = screen.getByTestId('activity-analytics-runtime-group-selector');

        expect(within(runtimeGroupSelector).getByRole('button', { name: 'Turno' })).toBeInTheDocument();
        expect(within(runtimeGroupSelector).getByRole('button', { name: 'Día' })).toBeInTheDocument();
        expect(within(runtimeGroupSelector).queryByRole('button', { name: 'Semana' })).not.toBeInTheDocument();
        expect(within(runtimeGroupSelector).queryByRole('button', { name: 'Mes' })).not.toBeInTheDocument();

        expect(screen.queryByRole('button', { name: '1h' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Turno' }));

        expect(screen.getByRole('button', { name: 'Turno' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getAllByText('Agrupación runtime: shift').length).toBeGreaterThan(0);
        expect(screen.getByTestId('activity-analytics-summary-bars')).toHaveTextContent('7.0 h');
        expect(screen.getByTestId('activity-analytics-comparison')).toHaveTextContent('Best shift');
        expect(screen.getByTestId('activity-analytics-comparison')).not.toHaveTextContent('Best day');
        expect(onPersistDisplayOptions).not.toHaveBeenCalled();

        rerender(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        range: '30d',
                        groupBy: 'day',
                        setupThresholdKw: 0.15,
                        prodThresholdKw: 0.25,
                        displayMode: 'kpis-and-bars',
                    },
                })}
                machines={MACHINES}
                onPersistDisplayOptions={onPersistDisplayOptions}
            />,
        );

        expect(screen.getByRole('button', { name: 'Día' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getAllByText('Agrupación runtime: day').length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: 'Turno' })).toBeInTheDocument();
    });

    it('restores persisted custom grouping defaults when the builder refreshes custom display options', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        vi.spyOn(activityAnalyticsComputation, 'computeActivityAnalytics').mockImplementation(({ groupBy }) => ({
            analytics: {
                durationsMs: { prod: 2, setup: 0, stopped: 0, noData: 0 },
                stopCount: 0,
                estimatedKwh: 0,
                utilizationRatio: 1,
                coverageRatio: 1,
                intervals: [],
            },
            grouped: [{
                bucketKey: `bucket-${groupBy}`,
                label: `Agrupación runtime: ${groupBy}`,
                startMs: 0,
                endMs: 1,
                durationsMs: { prod: 2, setup: 0, stopped: 0, noData: 0 },
                estimatedKwh: 0,
                stopCount: 0,
                utilizationRatio: 1,
                coverageRatio: 1,
                expectedDurationMs: 8,
                productivityRatio: 1,
                productivityLabel: '100%',
                isInProgress: false,
            }],
            comparison: {
                best: { label: `Best ${groupBy}`, bucketKey: `best-${groupBy}` },
                worst: { label: `Worst ${groupBy}`, bucketKey: `worst-${groupBy}` },
            },
            summaryRows: [{ label: `Agrupación runtime: ${groupBy}`, productivityLabel: '100%', bucketKey: `row-${groupBy}` }],
            timezone: 'UTC',
        }) as never);

        const { rerender } = render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        range: 'custom',
                        start: '2026-06-18T10:00:00.000Z',
                        end: '2026-06-18T12:00:00.000Z',
                        groupBy: 'shift',
                        setupThresholdKw: 0.15,
                        prodThresholdKw: 0.25,
                        displayMode: 'kpis-and-bars',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Hasta')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Custom' })).not.toBeInTheDocument();

        expect(screen.getByRole('button', { name: 'Turno' })).toHaveAttribute('aria-pressed', 'true');

        rerender(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        range: 'custom',
                        start: '2026-06-20T08:00:00.000Z',
                        end: '2026-06-20T10:00:00.000Z',
                        groupBy: 'week',
                        setupThresholdKw: 0.15,
                        prodThresholdKw: 0.25,
                        displayMode: 'kpis-and-bars',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(screen.getByRole('button', { name: 'Día' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByRole('button', { name: 'Semana' })).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Hasta')).not.toBeInTheDocument();
    });

    it('keeps the runtime grouping selector focused on visible group controls only', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} />);

        const runtimeRow = screen.getByTestId('activity-analytics-runtime-secondary-controls');
        const groupSelector = screen.getByTestId('activity-analytics-runtime-group-selector');
        expect(runtimeRow.children).toHaveLength(1);
        expect(runtimeRow.children[0]).toBe(groupSelector);
        expect(within(groupSelector).getByRole('button', { name: 'Turno' })).toBeInTheDocument();
        expect(within(groupSelector).getByRole('button', { name: 'Día' })).toBeInTheDocument();
        expect(within(groupSelector).queryByRole('button', { name: 'Semana' })).not.toBeInTheDocument();
        expect(within(groupSelector).queryByRole('button', { name: 'Mes' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '1h' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Custom' })).not.toBeInTheDocument();
    });

    it('renders shared Friday-night rollover and Sunday sin turno labels from the global weekly schedule in Turno Detalle', async () => {
        const user = userEvent.setup();

        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'UTC',
                shifts: [
                    { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00', weekdays: ['fri'] },
                ],
            },
            shifts: [
                { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00', weekdays: ['fri'] },
            ],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useActivitySeries).mockReturnValue({
            data: {
                ...POPULATED_ACTIVITY_SERIES,
                window: {
                    start: '2026-06-19T22:00:00.000Z',
                    end: '2026-06-21T11:00:00.000Z',
                    timezone: 'UTC',
                    bucket: '1h',
                    bucketMs: 60 * 60 * 1000,
                },
                series: [
                    {
                        timestamp: '2026-06-19T23:00:00.000Z',
                        timestampMs: Date.parse('2026-06-19T23:00:00.000Z'),
                        value: 0.3,
                    },
                    {
                        timestamp: '2026-06-21T10:00:00.000Z',
                        timestampMs: Date.parse('2026-06-21T10:00:00.000Z'),
                        value: 0.2,
                    },
                ],
            },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        range: '24h',
                        groupBy: 'shift',
                        setupThresholdKw: 0.15,
                        prodThresholdKw: 0.25,
                        displayMode: 'kpis-and-bars',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(screen.getByText('Turno C')).toBeInTheDocument();
        expect(screen.getByText('sin turno')).toBeInTheDocument();
        expect(screen.queryByText('2026-06-19 · Turno C')).not.toBeInTheDocument();

        await user.click(within(screen.getByTestId('activity-analytics-turno-mode')).getByRole('button', { name: 'Detalle' }));

        expect(screen.getAllByText('2026-06-19 · Turno C').length).toBeGreaterThan(0);
        expect(screen.getAllByText('2026-06-20 · sin turno').length).toBeGreaterThan(0);
    });

    it('re-renders grouped detail labels when the global timezone changes', async () => {
        const user = userEvent.setup();

        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'UTC',
                shifts: [
                    { id: 'shift-evening', label: 'Turno Tarde', start: '20:00', end: '23:30', weekdays: ['fri'] },
                ],
            },
            shifts: [
                { id: 'shift-evening', label: 'Turno Tarde', start: '20:00', end: '23:30', weekdays: ['fri'] },
            ],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useActivitySeries).mockReturnValue({
            data: {
                ...POPULATED_ACTIVITY_SERIES,
                window: {
                    start: '2026-06-20T00:00:00.000Z',
                    end: '2026-06-20T01:00:00.000Z',
                    timezone: 'UTC',
                    bucket: '30m',
                    bucketMs: 30 * 60 * 1000,
                },
                series: [
                    {
                        timestamp: '2026-06-20T00:30:00.000Z',
                        timestampMs: Date.parse('2026-06-20T00:30:00.000Z'),
                        value: 0.3,
                    },
                ],
            },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        const widget = makeWidget({
            displayOptions: {
                range: '24h',
                groupBy: 'shift',
                setupThresholdKw: 0.15,
                prodThresholdKw: 0.25,
                displayMode: 'kpis-and-bars',
            },
        });

        const { rerender } = render(<ActivityAnalyticsWidget widget={widget} machines={MACHINES} />);

        await user.click(within(screen.getByTestId('activity-analytics-turno-mode')).getByRole('button', { name: 'Detalle' }));

        expect(screen.getAllByText('2026-06-20 · sin turno').length).toBeGreaterThan(0);

        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'America/Argentina/Buenos_Aires',
                shifts: [
                    { id: 'shift-evening', label: 'Turno Tarde', start: '20:00', end: '23:30', weekdays: ['fri'] },
                ],
            },
            shifts: [
                { id: 'shift-evening', label: 'Turno Tarde', start: '20:00', end: '23:30', weekdays: ['fri'] },
            ],
            resolvedTimezone: 'America/Argentina/Buenos_Aires',
        });

        rerender(<ActivityAnalyticsWidget widget={widget} machines={MACHINES} />);

        await user.click(within(screen.getByTestId('activity-analytics-turno-mode')).getByRole('button', { name: 'Detalle' }));

        expect(screen.getAllByText('2026-06-19 · Turno Tarde').length).toBeGreaterThan(0);
    });

    it('renders Resumen as one real axis chart with three duration bars ahead of comparison and Grupos', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        vi.spyOn(activityAnalyticsComputation, 'computeActivityAnalytics').mockReturnValue({
            analytics: {
                durationsMs: {
                    prod: 4 * 60 * 60 * 1000,
                    setup: 2 * 60 * 60 * 1000,
                    stopped: 1 * 60 * 60 * 1000,
                    noData: 0,
                },
                stopCount: 2,
                estimatedKwh: 18.4,
                utilizationRatio: 4 / 7,
                coverageRatio: 1,
                intervals: [],
            },
            grouped: [
                {
                    bucketKey: 'day-1',
                    label: '2026-06-18',
                    startMs: 0,
                    endMs: 1,
                    durationsMs: {
                        prod: 3 * 60 * 60 * 1000,
                        setup: 1 * 60 * 60 * 1000,
                        stopped: 1 * 60 * 60 * 1000,
                        noData: 0,
                    },
                    estimatedKwh: 9.2,
                    stopCount: 1,
                    utilizationRatio: 0.6,
                    coverageRatio: 1,
                    expectedDurationMs: 5 * 60 * 60 * 1000,
                    productivityRatio: 0.6,
                    productivityLabel: '60%',
                    isInProgress: false,
                },
                {
                    bucketKey: 'day-2',
                    label: '2026-06-19',
                    startMs: 1,
                    endMs: 2,
                    durationsMs: {
                        prod: 1 * 60 * 60 * 1000,
                        setup: 1 * 60 * 60 * 1000,
                        stopped: 0,
                        noData: 0,
                    },
                    estimatedKwh: 4.1,
                    stopCount: 1,
                    utilizationRatio: 0.5,
                    coverageRatio: 1,
                    expectedDurationMs: 2 * 60 * 60 * 1000,
                    productivityRatio: 0.5,
                    productivityLabel: '50%',
                    isInProgress: false,
                },
            ],
            comparison: {
                best: { label: '2026-06-18', bucketKey: 'best' },
                worst: { label: '2026-06-19', bucketKey: 'worst' },
            },
            summaryRows: [],
            timezone: 'UTC',
        } as never);

        render(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} />);

        expect(screen.queryByTestId('activity-analytics-kpis')).not.toBeInTheDocument();
        expect(screen.queryAllByTestId('activity-analytics-vertical-bar-track')).toHaveLength(0);
        expect(screen.getByTestId('activity-analytics-summary-chart')).toBeInTheDocument();
        expect(screen.getAllByTestId('activity-analytics-summary-bar')).toHaveLength(3);
        expect(screen.getByText('Prod.')).toBeInTheDocument();
        expect(screen.getByText('Setup')).toBeInTheDocument();
        expect(screen.getByText('Detenida')).toBeInTheDocument();
        expect(screen.getAllByTestId('activity-analytics-y-axis-tick').length).toBeGreaterThan(2);
        expect(screen.getAllByText('4.0 h').length).toBeGreaterThan(0);
        expect(screen.getByTestId('activity-analytics-comparison')).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-groups-chart')).toBeInTheDocument();
        expect(screen.queryByText('kWh est.')).not.toBeInTheDocument();
        expect(screen.queryByText('Paradas')).not.toBeInTheDocument();
        expect(screen.getAllByText('60%').length).toBeGreaterThan(0);
        expect(screen.getAllByText('2026-06-18').length).toBeGreaterThan(0);

        const summaryPanel = screen.getByTestId('activity-analytics-summary-bars');
        const comparisonPanel = screen.getByTestId('activity-analytics-comparison');
        const groupsPanel = screen.getByTestId('activity-analytics-groups');

        expect(summaryPanel.compareDocumentPosition(comparisonPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(comparisonPanel.compareDocumentPosition(groupsPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('keeps Turno visible for 30d and 12m while exposing Resumen/Detalle only for 24h and 7d runtime shift grouping', async () => {
        const user = userEvent.setup();

        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'shift-1', label: '2026-06-18 · Turno 1' }),
            buildGroupedBucket({ bucketKey: 'shift-2', label: '2026-06-18 · Turno 2' }),
            buildGroupedBucket({ bucketKey: 'shift-3', label: '2026-06-18 · Turno 3' }),
            buildGroupedBucket({ bucketKey: 'shift-4', label: '2026-06-19 · Turno 1' }),
        ]);

        render(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} />);

        expect(screen.queryByTestId('activity-analytics-turno-mode')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Turno' }));

        expect(screen.getByTestId('activity-analytics-turno-mode')).toBeInTheDocument();
        expect(within(screen.getByTestId('activity-analytics-turno-mode')).getByRole('button', { name: 'Resumen' })).toHaveAttribute('aria-pressed', 'true');
        expect(within(screen.getByTestId('activity-analytics-turno-mode')).getByRole('button', { name: 'Detalle' })).toHaveAttribute('aria-pressed', 'false');

        await user.click(screen.getByRole('button', { name: '7d' }));

        expect(screen.getByTestId('activity-analytics-turno-mode')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '30d' }));

        expect(screen.getByRole('button', { name: 'Turno' })).toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-turno-mode')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '1h' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Turno' }));

        expect(screen.getByRole('button', { name: 'Turno' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByTestId('activity-analytics-turno-mode')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '12m' }));

        expect(screen.getByRole('button', { name: 'Turno' })).toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-turno-mode')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '24h' }));
        await user.click(screen.getByRole('button', { name: 'Día' }));

        expect(screen.queryByTestId('activity-analytics-turno-mode')).not.toBeInTheDocument();
    });

    it('keeps Turno Resumen aggregated to three bars and switches to chronological partial-detail bars on demand', async () => {
        const user = userEvent.setup();

        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'shift-1', label: '2026-06-18 · Turno 1', productivityLabel: '75%' }),
            buildGroupedBucket({ bucketKey: 'shift-2', label: '2026-06-18 · Turno 2', productivityLabel: '55%' }),
            buildGroupedBucket({ bucketKey: 'shift-3', label: '2026-06-18 · Turno 3', productivityLabel: '70%' }),
            buildGroupedBucket({
                bucketKey: 'shift-4',
                label: '2026-06-19 · Turno 1 (en curso)',
                durationsMs: { prod: 90 * 60 * 1000, setup: 30 * 60 * 1000, stopped: 0, noData: 0 },
                expectedDurationMs: 8 * 60 * 60 * 1000,
                productivityRatio: null,
                productivityLabel: 'sin datos',
                isInProgress: true,
            }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        groupBy: 'shift',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(3);
        expect(screen.getAllByText('Turno 1').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Turno 2').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Turno 3').length).toBeGreaterThan(0);
        expect(screen.queryByText('2026-06-19 · Turno 1 (en curso)')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-group-partial-outline')).not.toBeInTheDocument();

        await user.click(within(screen.getByTestId('activity-analytics-turno-mode')).getByRole('button', { name: 'Detalle' }));

        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(4);
        expect(screen.getAllByText('2026-06-19 · Turno 1 (en curso)').length).toBeGreaterThan(0);
        expect(screen.getByTestId('activity-analytics-group-partial-outline')).toBeInTheDocument();
    });

    it('aggregates Turno Resumen by stable shift identity even when admin labels are free text', () => {
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: null, shifts: [] },
            shifts: [
                { id: 'shift-a', label: 'Mañana', start: '06:00', end: '14:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
                { id: 'shift-b', label: 'Tarde', start: '14:00', end: '22:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
                { id: 'shift-c', label: 'Noche', start: '22:00', end: '06:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
            ],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'shift:shift-a:2026-06-18', label: '2026-06-18 · Mañana', productivityLabel: '75%' }),
            buildGroupedBucket({ bucketKey: 'shift:shift-b:2026-06-18', label: '2026-06-18 · Tarde', productivityLabel: '55%' }),
            buildGroupedBucket({ bucketKey: 'shift:shift-c:2026-06-18', label: '2026-06-18 · Noche', productivityLabel: '70%' }),
            buildGroupedBucket({ bucketKey: 'shift:shift-a:2026-06-19', label: '2026-06-19 · Mañana (en curso)', isInProgress: true, productivityRatio: null, productivityLabel: 'sin datos' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        groupBy: 'shift',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(3);
        expect(screen.getAllByText('Mañana').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Tarde').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Noche').length).toBeGreaterThan(0);
        expect(screen.queryByText('2026-06-19 · Mañana (en curso)')).not.toBeInTheDocument();
    });

    it('keeps Turno summary aggregated when only one or two shift types are visible', () => {
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: null, shifts: [] },
            shifts: [
                { id: 'shift-a', label: 'A', start: '06:00', end: '14:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
                { id: 'shift-c', label: 'C', start: '22:00', end: '06:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
            ],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useActivitySeries).mockReturnValue({
            data: { ...POPULATED_ACTIVITY_SERIES, range: '30d' },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'shift:shift-a:2026-06-18', label: '2026-06-18 · A', productivityLabel: '75%' }),
            buildGroupedBucket({ bucketKey: 'shift:shift-c:2026-06-18', label: '2026-06-18 · C', productivityLabel: '55%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '30d',
                        groupBy: 'shift',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(2);
        expect(screen.getAllByText('A').length).toBeGreaterThan(0);
        expect(screen.getAllByText('C').length).toBeGreaterThan(0);
        expect(screen.queryByText('2026-06-18 · A')).not.toBeInTheDocument();
        expect(screen.queryByText('2026-06-18 · C')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-turno-mode')).not.toBeInTheDocument();
    });

    it('keeps custom shift windows locked to Turno Resumen without exposing Detalle', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'shift-1', label: '2026-06-18 · Turno 1', productivityLabel: '75%' }),
            buildGroupedBucket({ bucketKey: 'shift-2', label: '2026-06-18 · Turno 2', productivityLabel: '55%' }),
            buildGroupedBucket({ bucketKey: 'shift-3', label: '2026-06-18 · Turno 3', productivityLabel: '70%' }),
            buildGroupedBucket({ bucketKey: 'shift-4', label: '2026-06-19 · Turno 1 (en curso)', isInProgress: true, productivityRatio: null, productivityLabel: 'sin datos' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        range: 'custom',
                        start: '2026-06-18T10:00:00.000Z',
                        end: '2026-06-18T12:00:00.000Z',
                        groupBy: 'shift',
                        setupThresholdKw: 0.15,
                        prodThresholdKw: 0.25,
                        displayMode: 'kpis-and-bars',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(screen.queryByTestId('activity-analytics-turno-mode')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(3);
        expect(screen.queryByText('2026-06-19 · Turno 1 (en curso)')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-group-partial-outline')).not.toBeInTheDocument();
    });

    it('compresses grouped bars before enabling horizontal scroll', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics(Array.from({ length: 6 }, (_, index) => buildGroupedBucket({
            bucketKey: `day-${index + 1}`,
            label: `2026-06-${18 + index}`,
        })));

        render(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} />);

        act(() => {
            MockResizeObserver.latest().emit(520, 360);
        });

        expect(screen.getByTestId('activity-analytics-groups-panel')).toHaveAttribute('data-groups-density', 'compress');
        expect(screen.queryByTestId('activity-analytics-groups-scroll-region')).not.toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-groups-chart')).toBeInTheDocument();
    });

    it('renders Grupos as stacked duration bars and scrolls only after compression is exhausted', async () => {
        const user = userEvent.setup();

        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        vi.spyOn(activityAnalyticsComputation, 'computeActivityAnalytics').mockReturnValue({
            analytics: {
                durationsMs: {
                    prod: 4 * 60 * 60 * 1000,
                    setup: 2 * 60 * 60 * 1000,
                    stopped: 1 * 60 * 60 * 1000,
                    noData: 0,
                },
                stopCount: 2,
                estimatedKwh: 18.4,
                utilizationRatio: 4 / 7,
                coverageRatio: 1,
                intervals: [],
            },
            grouped: Array.from({ length: 6 }, (_, index) => ({
                bucketKey: `day-${index + 1}`,
                label: `2026-06-${18 + index}`,
                startMs: index,
                endMs: index + 1,
                durationsMs: {
                    prod: (index + 2) * 60 * 60 * 1000,
                    setup: 1 * 60 * 60 * 1000,
                    stopped: index % 2 === 0 ? 1 * 60 * 60 * 1000 : 0,
                    noData: 0,
                },
                estimatedKwh: 9.2,
                stopCount: 1,
                utilizationRatio: 0.6,
                coverageRatio: 1,
                expectedDurationMs: 5 * 60 * 60 * 1000,
                productivityRatio: 0.6,
                productivityLabel: '60%',
                isInProgress: false,
            })),
            comparison: {
                best: { label: '2026-06-18', bucketKey: 'best' },
                worst: { label: '2026-06-23', bucketKey: 'worst' },
            },
            summaryRows: [],
            timezone: 'UTC',
        } as never);

        render(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} />);

        act(() => {
            MockResizeObserver.latest().emit(480, 360);
        });

        expect(screen.getByTestId('activity-analytics-groups-scroll-region')).toHaveClass('hmi-scrollbar');
        expect(screen.getByTestId('activity-analytics-groups-panel')).toHaveAttribute('data-groups-density', 'scroll');
        expect(screen.getByTestId('activity-analytics-groups-chart')).toBeInTheDocument();
        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(6);
        expect(screen.getAllByTestId('activity-analytics-group-segment')).toHaveLength(18);
        expect(screen.getAllByTestId('activity-analytics-group-productivity')).toHaveLength(6);
        expect(screen.getAllByText('2026-06-18').length).toBeGreaterThan(0);
        expect(screen.getAllByText('2026-06-23').length).toBeGreaterThan(0);

        await user.click(screen.getByRole('button', { name: 'Hover first bucket' }));

        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('2026-06-18');
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Prod.');
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Setup');
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Detenida');
        expect(screen.getByTestId('hover-layer')).toHaveAttribute('data-highlights', '3');
    });

    it('falls back to truthful text cards on tight sizes instead of compressed horizontal bars', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        vi.spyOn(activityAnalyticsComputation, 'computeActivityAnalytics').mockReturnValue({
            analytics: {
                durationsMs: {
                    prod: 4 * 60 * 60 * 1000,
                    setup: 2 * 60 * 60 * 1000,
                    stopped: 1 * 60 * 60 * 1000,
                    noData: 0,
                },
                stopCount: 2,
                estimatedKwh: 18.4,
                utilizationRatio: 4 / 7,
                coverageRatio: 1,
                intervals: [],
            },
            grouped: [{
                bucketKey: 'day-1',
                label: '2026-06-18',
                startMs: 0,
                endMs: 1,
                durationsMs: {
                    prod: 3 * 60 * 60 * 1000,
                    setup: 1 * 60 * 60 * 1000,
                    stopped: 1 * 60 * 60 * 1000,
                    noData: 0,
                },
                estimatedKwh: 9.2,
                stopCount: 1,
                utilizationRatio: 0.6,
                coverageRatio: 1,
                expectedDurationMs: 5 * 60 * 60 * 1000,
                productivityRatio: 0.6,
                productivityLabel: '60%',
                isInProgress: false,
            }],
            comparison: {
                best: { label: '2026-06-18', bucketKey: 'best' },
                worst: { label: 'sin datos', bucketKey: 'worst' },
            },
            summaryRows: [],
            timezone: 'UTC',
        } as never);

        render(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} />);

        act(() => {
            MockResizeObserver.latest().emit(360, 210);
        });

        expect(screen.getByTestId('activity-analytics-summary-text')).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-groups-text')).toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-stacked-bar')).not.toBeInTheDocument();
        expect(screen.getAllByText('4.0 h').length).toBeGreaterThan(0);
        expect(screen.getAllByText('60%').length).toBeGreaterThan(0);
    });

    it('preserves sin datos, sin turno, and in-progress labeling in Turno Detalle vertical and fallback views', async () => {
        const user = userEvent.setup();

        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        vi.spyOn(activityAnalyticsComputation, 'computeActivityAnalytics').mockReturnValue({
            analytics: {
                durationsMs: {
                    prod: 2 * 60 * 60 * 1000,
                    setup: 1 * 60 * 60 * 1000,
                    stopped: 0,
                    noData: 4 * 60 * 60 * 1000,
                },
                stopCount: 0,
                estimatedKwh: 6,
                utilizationRatio: 2 / 3,
                coverageRatio: 0.42,
                intervals: [],
            },
            grouped: [
                {
                    bucketKey: 'shift-1',
                    label: '2026-06-18 · Turno Noche (en curso)',
                    startMs: 0,
                    endMs: 1,
                    durationsMs: {
                        prod: 2 * 60 * 60 * 1000,
                        setup: 0,
                        stopped: 0,
                        noData: 0,
                    },
                    estimatedKwh: 3,
                    stopCount: 0,
                    utilizationRatio: 1,
                    coverageRatio: 1,
                    expectedDurationMs: 8 * 60 * 60 * 1000,
                    productivityRatio: null,
                    productivityLabel: 'sin datos',
                    isInProgress: true,
                },
                {
                    bucketKey: 'shift-2',
                    label: '2026-06-20 · sin turno',
                    startMs: 1,
                    endMs: 2,
                    durationsMs: {
                        prod: 0,
                        setup: 1 * 60 * 60 * 1000,
                        stopped: 0,
                        noData: 0,
                    },
                    estimatedKwh: 3,
                    stopCount: 0,
                    utilizationRatio: 0,
                    coverageRatio: 1,
                    expectedDurationMs: 1 * 60 * 60 * 1000,
                    productivityRatio: null,
                    productivityLabel: 'sin datos',
                    isInProgress: false,
                },
            ],
            comparison: {
                best: { label: 'sin datos', bucketKey: 'best' },
                worst: { label: 'sin datos', bucketKey: 'worst' },
            },
            summaryRows: [],
            timezone: 'UTC',
        } as never);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        groupBy: 'shift',
                    },
                })}
                machines={MACHINES}
            />,
        );

        await user.click(within(screen.getByTestId('activity-analytics-turno-mode')).getByRole('button', { name: 'Detalle' }));

        expect(screen.getAllByText('sin datos').length).toBeGreaterThan(0);
        expect(screen.getByText('2026-06-18 · Turno Noche (en curso)')).toBeInTheDocument();
        expect(screen.getByText('2026-06-20 · sin turno')).toBeInTheDocument();

        act(() => {
            MockResizeObserver.latest().emit(360, 210);
        });

        expect(screen.getByTestId('activity-analytics-groups-text')).toBeInTheDocument();
        expect(screen.getAllByText('sin datos').length).toBeGreaterThan(0);
        expect(screen.getByText('2026-06-18 · Turno Noche (en curso)')).toBeInTheDocument();
        expect(screen.getByText('2026-06-20 · sin turno')).toBeInTheDocument();
    });

    it('shows an empty-series state when the endpoint returns no points', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: {
                contractVersion: '1.0.0',
                machineId: 101,
                variableKey: 'Total kW',
                range: '24h',
                unit: 'kW',
                purpose: 'activity-analytics',
                window: {
                    start: '2026-06-18T12:00:00.000Z',
                    end: '2026-06-18T14:00:00.000Z',
                    timezone: 'UTC',
                    bucket: '5m',
                    bucketMs: 300000,
                },
                series: [],
                summary: { hidden: true },
            },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} />);

        expect(screen.getByText('Sin datos de actividad')).toBeInTheDocument();
    });

    it('shows a sanitized connection-focused error state', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: null,
            isLoading: false,
            isError: true,
            error: new DataServiceError('Network error fetching activity-series: ECONNRESET from upstream', undefined),
            isEnabled: true,
        });

        render(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} />);

        expect(screen.getByText('No se pudo conectar con Activity-Series')).toBeInTheDocument();
        expect(screen.queryByText(/ECONNRESET/i)).not.toBeInTheDocument();
    });

    it('shows a sanitized backend error state without exposing backend summary data', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: null,
            isLoading: false,
            isError: true,
            error: new DataServiceError('Activity-series request could not be completed', 400),
            isEnabled: true,
        });

        render(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} />);

        expect(screen.getByText('Activity-Series rechazó la consulta')).toBeInTheDocument();
        expect(screen.queryByText('summary')).not.toBeInTheDocument();
    });

    it('shows a contract-focused error state when the activity-series payload is invalid for analytics', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: null,
            isLoading: false,
            isError: true,
            error: new ActivitySeriesAdapterError('Activity-series response window is invalid'),
            isEnabled: true,
        });

        render(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} />);

        expect(screen.getByText('Activity-Series devolvió datos inválidos')).toBeInTheDocument();
        expect(screen.getByText('La respuesta recibida no cumple el contrato esperado para esta analítica.')).toBeInTheDocument();
        expect(screen.queryByText('No fue posible calcular la analítica de actividad.')).not.toBeInTheDocument();
    });

    it('uses compact chart typography for Mejor/Peor instead of KPI-scale values', () => {
        vi.mocked(isDataActivitySeriesEnabled).mockReturnValue(false);

        const { rerender } = render(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} />);

        expect(screen.getByText('Endpoint Activity-Series no configurado')).toHaveStyle({
            fontFamily: 'var(--font-system)',
            fontWeight: 'var(--font-weight-system)',
            fontSize: 'var(--font-size-system)',
            letterSpacing: 'var(--tracking-system)',
        });

        vi.mocked(isDataActivitySeriesEnabled).mockReturnValue(true);
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        rerender(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} />);

        expect(screen.getByText('Mejor')).toHaveStyle({
            fontFamily: 'var(--font-chart)',
            fontWeight: 'var(--font-weight-chart)',
            fontSize: 'var(--font-size-chart)',
            letterSpacing: 'var(--tracking-chart)',
        });

        const metricCard = screen.getByText('Mejor').parentElement;
        const metricValue = within(metricCard as HTMLElement).getByTestId('activity-analytics-metric-value');

        expect(metricValue).toHaveStyle({
            fontFamily: 'var(--font-mono)',
            fontWeight: 'var(--font-weight-mono)',
            fontSize: 'var(--font-size-mono)',
            letterSpacing: 'var(--tracking-mono)',
        });
    });

    it('renders compact Mejor/Peor rows from the visible grouped data with productivity and duration context', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({
                bucketKey: 'day-1',
                label: '2026-06-18',
                durationsMs: { prod: 3 * 60 * 60 * 1000, setup: 1 * 60 * 60 * 1000, stopped: 1 * 60 * 60 * 1000, noData: 0 },
                productivityRatio: 0.6,
                productivityLabel: '60%',
                expectedDurationMs: 5 * 60 * 60 * 1000,
            }),
            buildGroupedBucket({
                bucketKey: 'day-2',
                label: '2026-06-19',
                durationsMs: { prod: 1 * 60 * 60 * 1000, setup: 1 * 60 * 60 * 1000, stopped: 0, noData: 0 },
                productivityRatio: 0.5,
                productivityLabel: '50%',
                expectedDurationMs: 2 * 60 * 60 * 1000,
            }),
        ]);

        render(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} />);

        const comparisonPanel = screen.getByTestId('activity-analytics-comparison');

        expect(within(comparisonPanel).getByText('2026-06-18')).toBeInTheDocument();
        expect(within(comparisonPanel).getByText('% Prod. 60% · 5.0 h')).toBeInTheDocument();
        expect(within(comparisonPanel).getByText('2026-06-19')).toBeInTheDocument();
        expect(within(comparisonPanel).getByText('% Prod. 50% · 2.0 h')).toBeInTheDocument();
    });

    it('uses semantic surface tokens for analytics cards instead of hardcoded black/white utilities', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} />);

        expect(screen.getByTestId('activity-analytics-groups')).toHaveClass('border-industrial-border');
        expect(screen.getByTestId('activity-analytics-comparison')).toHaveClass('border-industrial-border');
        expect(screen.getByTestId('activity-analytics-summary-bars')).toHaveClass('border-industrial-border');
        expect(screen.getAllByTestId('activity-analytics-summary-bar').length).toBeGreaterThan(0);
    });

    it('does not recompute analytics when unrelated builder props change', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        const computeSpy = vi.spyOn(activityAnalyticsComputation, 'computeActivityAnalytics');

        const { rerender } = render(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} className="initial" />);

        expect(computeSpy).toHaveBeenCalledTimes(1);

        rerender(
            <ActivityAnalyticsWidget
                widget={makeWidget({ title: 'Otro título', size: { w: 8, h: 6 }, position: { x: 4, y: 3 } })}
                machines={MACHINES}
                className="updated"
            />,
        );

        expect(computeSpy).toHaveBeenCalledTimes(1);
    });

    it('recomputes analytics when calculation inputs change', () => {
        const computeSpy = vi.spyOn(activityAnalyticsComputation, 'computeActivityAnalytics');
        const shiftsA = [{ id: 'a', label: 'A', start: '06:00', end: '14:00' }];
        const shiftsB = [{ id: 'b', label: 'B', start: '14:00', end: '22:00' }];
        const dataA = POPULATED_ACTIVITY_SERIES;
        const dataB = {
            ...POPULATED_ACTIVITY_SERIES,
            window: {
                ...POPULATED_ACTIVITY_SERIES.window,
                start: '2026-06-18T11:00:00.000Z',
                end: '2026-06-18T13:30:00.000Z',
                bucketMs: 600000,
            },
            series: [
                ...POPULATED_ACTIVITY_SERIES.series,
                {
                    timestamp: '2026-06-18T12:05:00.000Z',
                    timestampMs: Date.parse('2026-06-18T12:05:00.000Z'),
                    value: 0.1,
                },
            ],
        };

        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: 'UTC', shifts: shiftsA },
            shifts: shiftsA,
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useActivitySeries).mockReturnValue({
            data: dataA,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        const { rerender } = render(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} />);
        const initialCalls = computeSpy.mock.calls.length;

        expect(initialCalls).toBeGreaterThan(0);

        rerender(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        range: '24h',
                        groupBy: 'shift',
                        setupThresholdKw: 0.2,
                        prodThresholdKw: 0.3,
                        displayMode: 'kpis-and-bars',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(computeSpy.mock.calls.length).toBe(initialCalls + 1);

        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: 'America/Argentina/Buenos_Aires', shifts: shiftsB },
            shifts: shiftsB,
            resolvedTimezone: 'America/Argentina/Buenos_Aires',
        });
        vi.mocked(useActivitySeries).mockReturnValue({
            data: dataB,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        rerender(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} />);

        expect(computeSpy.mock.calls.length).toBe(initialCalls + 2);
    });
});
