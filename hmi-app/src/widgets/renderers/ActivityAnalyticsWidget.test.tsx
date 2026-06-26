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
import type { ActivityAnalyticsInterval } from '../../utils/activityAnalytics';
import * as activityAnalyticsComputation from '../../utils/activityAnalyticsComputation';
import { groupActivityAnalyticsIntervals } from '../../utils/activityAnalyticsGrouping';
import { buildActivityAnalyticsSummarySegments } from '../../utils/activityAnalyticsSummarySegments';
import ActivityAnalyticsWidget from './ActivityAnalyticsWidget';

class MockResizeObserver implements ResizeObserver {
    private static instances: MockResizeObserver[] = [];

    private observedTargets: Element[] = [];

    public constructor(private readonly callback: ResizeObserverCallback) {
        MockResizeObserver.instances.push(this);
    }

    public observe(target: Element): void {
        this.observedTargets.push(target);
        this.emit(640, 420, target);
    }

    public unobserve(): void {}

    public disconnect(): void {}

    public emit(width: number, height: number, target: Element | null = this.observedTargets[0] ?? null): void {
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

    public emitObservedTarget(testId: string, width: number, height: number): void {
        const target = this.observedTargets.find((element) => element instanceof HTMLElement && element.getAttribute('data-testid') === testId) ?? null;

        if (!target) {
            throw new Error(`No observed target found for test id "${testId}"`);
        }

        this.emit(width, height, target);
    }

    public static reset(): void {
        MockResizeObserver.instances = [];
    }
}

function emitActivityAnalyticsLayoutSize({
    bodyWidth,
    bodyHeight,
    summaryColumnWidth,
}: {
    bodyWidth: number;
    bodyHeight: number;
    summaryColumnWidth?: number;
}) {
    const observer = MockResizeObserver.latest();

    observer.emit(bodyWidth, bodyHeight);

    if (typeof summaryColumnWidth === 'number') {
        observer.emitObservedTarget('activity-analytics-summary-column', summaryColumnWidth, bodyHeight);
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
        <div
            data-testid="hover-layer"
            data-length={dataLength}
            data-highlights={highlights?.length ?? 0}
            data-highlight-colors={Array.isArray(highlights)
                ? highlights
                    .map((highlight) => (typeof highlight === 'object' && highlight !== null && 'color' in highlight
                        ? String(highlight.color)
                        : ''))
                    .join('|')
                : ''}
        >
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
            range: '7d',
            groupBy: 'shift',
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
    range: '7d' as const,
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

const CUSTOM_STATE_GRADIENTS = {
    prod: ['#112233', '#445566'],
    setup: ['#778899', '#aabbcc'],
    stopped: ['#ddee00', '#ff00aa'],
} as const;

const UPDATED_STATE_GRADIENTS = {
    prod: ['#334455', '#667788'],
    setup: ['#99aabb', '#ccddee'],
    stopped: ['#550000', '#aa0000'],
} as const;

const CUSTOM_STATE_GRADIENT_ALPHAS = {
    prod: [35, 75],
    setup: [50, 65],
    stopped: [20, 55],
} as const;

const CUSTOM_VISUAL_EFFECTS = {
    groupedBars: {
        glow: 82,
        blur: 1.5,
        topCap: false,
        topCapGlow: 18,
    },
    donut: {
        glow: 40,
        blur: 4,
        topCap: true,
        topCapGlow: 60,
    },
} as const;

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

function buildInterval(start: string, durationMs: number, state: ActivityAnalyticsInterval['state']): ActivityAnalyticsInterval {
    const timestampMs = Date.parse(start);

    return {
        timestamp: start,
        timestampMs,
        endTimestamp: new Date(timestampMs + durationMs).toISOString(),
        endTimestampMs: timestampMs + durationMs,
        durationMs,
        state,
        normalizedKw: state === 'no-data' ? null : 10,
        estimatedKwh: state === 'no-data' ? 0 : 10 * (durationMs / (60 * 60 * 1000)),
        stopCountContribution: state === 'stopped' ? 1 : 0,
        isDataBacked: state !== 'no-data',
    };
}

function expectVisibleRectStackSemantics(
    segments: HTMLElement[],
    expectedOrder: Array<{ fill: string | RegExp; segmentKey: string }>,
) {
    expect(segments).toHaveLength(expectedOrder.length);

    const yPositions = segments.map((segment) => Number(segment.getAttribute('y')));
    expect(yPositions).toEqual([...yPositions].sort((left, right) => right - left));

    expectedOrder.forEach((expected, index) => {
        const fill = segments[index].getAttribute('fill') ?? '';

        if (expected.fill instanceof RegExp) {
            expect(fill).toMatch(expected.fill);
        } else {
            expect(segments[index]).toHaveAttribute('fill', expected.fill);
        }

        expect(segments[index]).toHaveAttribute('data-segment-key', expected.segmentKey);
        expect(segments[index]).toHaveAttribute('rx', '0');
    });
}

function parseRectMetrics(segment: HTMLElement) {
    const x = Number(segment.getAttribute('x'));
    const y = Number(segment.getAttribute('y'));
    const width = Number(segment.getAttribute('width'));
    const height = Number(segment.getAttribute('height'));

    return {
        x,
        y,
        width,
        height,
        centerX: x + (width / 2),
    };
}

function hexToRgbCss(hex: string): string {
    const normalized = hex.replace('#', '');
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);

    return `rgb(${red}, ${green}, ${blue})`;
}

function hexToRgbaCss(hex: string, alphaPercentage: number): string {
    const normalized = hex.replace('#', '');
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);

    return `rgba(${red}, ${green}, ${blue}, ${alphaPercentage / 100})`;
}

function reverseGradientStops<TGradient extends readonly [string, string]>(gradient: TGradient): [string, string] {
    return [gradient[1], gradient[0]];
}

function getGradientStopsByIdSuffix(container: HTMLElement, idSuffix: string) {
    const gradient = container.querySelector(`linearGradient[id$="${idSuffix}"]`);

    if (!gradient) {
        throw new Error(`Missing gradient with id suffix "${idSuffix}"`);
    }

    return Array.from(gradient.querySelectorAll('stop'));
}

function resolveExpectedGroupedTopCapHeight(segmentHeight: number) {
    return Math.min(5, Math.max(Math.min(segmentHeight - 0.75, segmentHeight * 0.2), 0));
}

function parseVisibleStrokeLength(strokeDashArray: string | null): number {
    return Number((strokeDashArray ?? '0').split(' ')[0]);
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

        expect(vi.mocked(useActivitySeries)).toHaveBeenCalledWith({ machineId: 202, range: '7d' });
        expect(screen.getByText('Distribución')).toBeInTheDocument();
        expect(screen.queryByText('Reiner')).not.toBeInTheDocument();
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

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

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

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        expect(screen.getByText('Cargando actividad…')).toBeInTheDocument();
    });

    it('shows a clear invalid-threshold state for legacy invalid configs', () => {
        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        range: '7d',
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
                range: '7d',
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

        expect(screen.getByRole('button', { name: 'Turno' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getAllByText('Agrupación runtime: shift').length).toBeGreaterThan(0);
        expect(screen.getByTestId('activity-analytics-summary-bars')).toHaveTextContent('88%');
        expect(screen.getByTestId('activity-analytics-comparison')).toHaveTextContent('sin comparación');

        const runtimeGroupSelector = screen.getByTestId('activity-analytics-runtime-group-selector');

        expect(within(runtimeGroupSelector).getByRole('button', { name: 'Turno' })).toBeInTheDocument();
        expect(within(runtimeGroupSelector).getByRole('button', { name: 'Día' })).toBeInTheDocument();
        expect(within(runtimeGroupSelector).queryByRole('button', { name: 'Semana' })).not.toBeInTheDocument();
        expect(within(runtimeGroupSelector).queryByRole('button', { name: 'Mes' })).not.toBeInTheDocument();

        expect(screen.queryByRole('button', { name: '1h' })).not.toBeInTheDocument();

        expect(screen.getByRole('button', { name: 'Turno' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getAllByText('Agrupación runtime: shift').length).toBeGreaterThan(0);
        expect(screen.getByTestId('activity-analytics-summary-bars')).toHaveTextContent('88%');
        expect(screen.getByTestId('activity-analytics-comparison')).toHaveTextContent('sin comparación');
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
        expect(screen.queryByTestId('activity-analytics-turno-mode')).not.toBeInTheDocument();
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

        expect(screen.getByRole('button', { name: 'Turno' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Día' })).toBeInTheDocument();
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

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

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

    it('renders shared Friday-night rollover labels while hiding Sunday sin turno in Turno Detalle', async () => {
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
                        range: '7d',
                        groupBy: 'shift',
                        setupThresholdKw: 0.15,
                        prodThresholdKw: 0.25,
                        displayMode: 'kpis-and-bars',
                    },
                })}
                machines={MACHINES}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Detalle' }));

        expect(screen.getAllByText('2026-06-19 · Turno C').length).toBeGreaterThan(0);
        expect(screen.queryByText('2026-06-20 · sin turno')).not.toBeInTheDocument();
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
                range: '7d',
                groupBy: 'shift',
                setupThresholdKw: 0.15,
                prodThresholdKw: 0.25,
                displayMode: 'kpis-and-bars',
            },
        });

        const { rerender } = render(<ActivityAnalyticsWidget widget={widget} machines={MACHINES} />);

        await user.click(screen.getByRole('button', { name: 'Detalle' }));

        expect(screen.queryByText('Sin grupos para mostrar')).not.toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-summary-bars')).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-groups-empty')).toHaveTextContent('Todos los grupos de esta ventana corresponden a sin turno y se ocultan en esta vista.');
        expect(screen.getByTestId('activity-analytics-comparison')).toHaveTextContent('sin comparación');

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

        expect(screen.getAllByText('2026-06-19 · Turno Tarde').length).toBeGreaterThan(0);
    });

    it('renders the refreshed Distribución header and removes KPI/framed summary chrome while preserving grouped semantics', () => {
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

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 848, bodyHeight: 420, summaryColumnWidth: 320 });
        });

        expect(screen.getByText('Distribución')).toBeInTheDocument();
        expect(screen.queryByText('Extrusora 101')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-kpis')).not.toBeInTheDocument();
        expect(screen.queryAllByTestId('activity-analytics-vertical-bar-track')).toHaveLength(0);
        expect(screen.getByTestId('activity-analytics-summary-chart')).toBeInTheDocument();
        expect(screen.getAllByTestId('activity-analytics-summary-stack')).toHaveLength(1);
        expect(screen.queryByTestId('activity-analytics-summary-bar')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('activity-analytics-y-axis-tick').length).toBeGreaterThan(2);
        expect(screen.getAllByText('57%').length).toBeGreaterThan(0);
        expect(screen.getByTestId('activity-analytics-comparison')).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-groups-chart')).toBeInTheDocument();
        expect(screen.queryByText('kWh est.')).not.toBeInTheDocument();
        expect(screen.queryByText('Paradas')).not.toBeInTheDocument();
        expect(screen.getAllByText('60%').length).toBeGreaterThan(0);
        expect(screen.getAllByText('2026-06-18').length).toBeGreaterThan(0);

        const summaryPanel = screen.getByTestId('activity-analytics-summary-bars');
        const comparisonPanel = screen.getByTestId('activity-analytics-comparison');
        const groupsPanel = screen.getByTestId('activity-analytics-groups');
        const topRegion = screen.getByTestId('activity-analytics-top-region');
        const summarySegments = screen.getAllByTestId('activity-analytics-summary-segment');
        const firstGroupStack = screen.getAllByTestId('activity-analytics-group-stack')[0];
        const groupSegments = within(firstGroupStack).getAllByTestId('activity-analytics-group-segment');
        const topCaps = within(firstGroupStack).getAllByTestId('activity-analytics-group-top-cap');
        const detailTitles = screen.getAllByTestId('activity-analytics-summary-detail-title').map((item) => item.textContent?.replace(/\s+/g, ' ').trim());
        const summaryChart = screen.getByTestId('activity-analytics-summary-chart');

        expect(summarySegments).toHaveLength(3);
        expect(summarySegments.map((segment) => segment.tagName)).toEqual(['circle', 'circle', 'circle']);
        expect(summarySegments.map((segment) => segment.getAttribute('data-segment-key'))).toEqual(['stopped', 'setup', 'prod']);
        summarySegments.forEach((segment) => {
            expect(segment.getAttribute('stroke')).toMatch(/^url\(#.+-gradient\)$/);
            expect(segment.getAttribute('stroke-linecap')).toBe('butt');
            expect(segment.getAttribute('filter')).toMatch(/^url\(#.+-summary-glow\)$/);
        });
        expect(within(summaryChart).queryAllByTestId('activity-analytics-y-axis-tick')).toHaveLength(0);
        expect(summaryChart.innerHTML).toContain('linearGradient');
        expect(summaryChart.innerHTML).toContain('summary-glow');
        expectVisibleRectStackSemantics(groupSegments, [
            { fill: 'var(--color-industrial-muted)', segmentKey: 'noData' },
            { fill: /^url\(#.+-stopped-gradient\)$/, segmentKey: 'stopped' },
            { fill: /^url\(#.+-setup-gradient\)$/, segmentKey: 'setup' },
            { fill: /^url\(#.+-prod-gradient\)$/, segmentKey: 'prod' },
        ]);
        expect(topCaps.map((cap) => cap.getAttribute('data-segment-key'))).toEqual(['stopped', 'setup', 'prod']);
        topCaps.forEach((cap) => {
            expect(cap).toHaveAttribute('rx', '0');
            expect(Number(cap.getAttribute('height'))).toBeGreaterThan(0);
            expect(cap.getAttribute('style')).toContain('drop-shadow');
        });
        expect(detailTitles).toEqual([
            'Producción',
            'Setup',
            'Detenida',
        ]);
        const groupsHeaderLegend = within(groupsPanel).getByTestId('activity-analytics-groups-header-legend');
        expect(within(groupsHeaderLegend).getAllByText(/^(Detenida|Setup|Prod\.)$/).map((item) => item.textContent)).toEqual([
            'Detenida',
            'Setup',
            'Prod.',
        ]);
        expect(within(groupsPanel).queryByTestId('activity-analytics-panel-heading-value')).not.toBeInTheDocument();
        expect(screen.queryAllByTestId('activity-analytics-summary-segment-label')).toHaveLength(0);
        expect(summaryPanel).not.toHaveClass('border-industrial-border');
        expect(within(summaryPanel).getByTestId('activity-analytics-summary-coverage')).toHaveTextContent('Cobertura 100%');
        expect(within(summaryPanel).queryByText('% Prod. 57% · Cob. 100%')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-summary-panel')).not.toBeInTheDocument();

        expect(topRegion).toContainElement(summaryPanel);
        expect(topRegion).toContainElement(comparisonPanel);
        expect(topRegion).toHaveAttribute('data-top-layout', 'side-by-side');
        expect(topRegion).not.toContainElement(groupsPanel);
        expect(topRegion.compareDocumentPosition(groupsPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(Number(summaryChart.getAttribute('width'))).toBeLessThan(640);
    });

    it('intentionally stacks Resumen over Mejor/Peor at compact supported widths instead of wrapping them unpredictably', () => {
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

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'day',
                    },
                })}
                machines={MACHINES}
            />,
        );

        act(() => {
            MockResizeObserver.latest().emit(520, 360);
        });

        expect(screen.getByTestId('activity-analytics-top-region')).toHaveAttribute('data-top-layout', 'stacked');
        expect(screen.getByTestId('activity-analytics-summary-bars')).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-comparison')).toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-summary-text')).not.toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-groups-panel')).toHaveAttribute('data-groups-density', 'compress');
    });

    it('applies resolved state gradients across approved renderer surfaces without recomputing analytics for palette-only changes', async () => {
        const user = userEvent.setup();
        const onPersistDisplayOptions = vi.fn();
        const computeSpy = vi.spyOn(activityAnalyticsComputation, 'computeActivityAnalytics').mockReturnValue({
            analytics: {
                durationsMs: {
                    prod: 4 * 60 * 60 * 1000,
                    setup: 2 * 60 * 60 * 1000,
                    stopped: 1 * 60 * 60 * 1000,
                    noData: 30 * 60 * 1000,
                },
                stopCount: 1,
                estimatedKwh: 18.4,
                utilizationRatio: 4 / 7,
                coverageRatio: 1,
                intervals: [],
            },
            grouped: [buildGroupedBucket({
                bucketKey: 'day-1',
                label: '2026-06-18',
                durationsMs: {
                    prod: 3 * 60 * 60 * 1000,
                    setup: 2 * 60 * 60 * 1000,
                    stopped: 1 * 60 * 60 * 1000,
                    noData: 30 * 60 * 1000,
                },
                expectedDurationMs: 6.5 * 60 * 60 * 1000,
                productivityLabel: '60%',
            })],
            comparison: {
                best: { label: '2026-06-18', bucketKey: 'day-1' },
                worst: { label: '2026-06-18', bucketKey: 'day-1' },
            },
            summaryRows: [{ label: '2026-06-18', productivityLabel: '60%', bucketKey: 'day-1' }],
            timezone: 'UTC',
        } as never);
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        const widget = makeWidget({
            displayOptions: {
                ...makeWidget().displayOptions,
                range: '7d',
                groupBy: 'day',
                stateGradients: CUSTOM_STATE_GRADIENTS,
            },
        });

        const { rerender } = render(
            <ActivityAnalyticsWidget
                widget={widget}
                machines={MACHINES}
                onPersistDisplayOptions={onPersistDisplayOptions}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 848, bodyHeight: 420, summaryColumnWidth: 320 });
        });

        const summaryChart = screen.getByTestId('activity-analytics-summary-chart');
        const summaryGradients = Array.from(summaryChart.querySelectorAll('linearGradient'))
            .filter((gradient) => !gradient.id.includes('top-cap'));
        const summaryStops = summaryGradients.map((gradient) => Array.from(gradient.querySelectorAll('stop')).map((stop) => stop.getAttribute('stop-color')));
        const detailMarkers = Array.from(screen.getByTestId('activity-analytics-summary-details').querySelectorAll('rect'));
        const groupsChart = screen.getByTestId('activity-analytics-groups-chart');
        const groupGradients = Array.from(groupsChart.querySelectorAll('linearGradient'));
        const groupStops = groupGradients.map((gradient) => Array.from(gradient.querySelectorAll('stop')).map((stop) => stop.getAttribute('stop-color')));
        const firstGroupStack = screen.getByTestId('activity-analytics-group-stack');
        const groupSegments = within(firstGroupStack).getAllByTestId('activity-analytics-group-segment');
        const topCaps = within(firstGroupStack).getAllByTestId('activity-analytics-group-top-cap');
        const legendSwatches = Array.from(screen.getByTestId('activity-analytics-groups-header-legend').querySelectorAll('span[aria-hidden="true"]'));
        const comparisonSegments = Array.from(screen.getByTestId('activity-analytics-comparison').querySelectorAll('div[aria-hidden="true"] > div'));

        expect(summaryStops).toEqual([
            reverseGradientStops(CUSTOM_STATE_GRADIENTS.stopped),
            reverseGradientStops(CUSTOM_STATE_GRADIENTS.setup),
            [...CUSTOM_STATE_GRADIENTS.prod],
        ]);
        expect(groupStops).toEqual([
            reverseGradientStops(CUSTOM_STATE_GRADIENTS.prod),
            reverseGradientStops(CUSTOM_STATE_GRADIENTS.setup),
            reverseGradientStops(CUSTOM_STATE_GRADIENTS.stopped),
        ]);
        expect(detailMarkers.map((marker) => marker.getAttribute('fill'))).toEqual([
            CUSTOM_STATE_GRADIENTS.prod[1],
            CUSTOM_STATE_GRADIENTS.setup[1],
            CUSTOM_STATE_GRADIENTS.stopped[1],
        ]);
        expect(groupSegments.map((segment) => segment.getAttribute('fill'))).toEqual([
            'var(--color-industrial-muted)',
            expect.stringMatching(/^url\(#.+-stopped-gradient\)$/),
            expect.stringMatching(/^url\(#.+-setup-gradient\)$/),
            expect.stringMatching(/^url\(#.+-prod-gradient\)$/),
        ]);
        expect(legendSwatches.map((swatch) => (swatch as HTMLElement).style.backgroundColor)).toEqual([
            hexToRgbCss(CUSTOM_STATE_GRADIENTS.stopped[1]),
            hexToRgbCss(CUSTOM_STATE_GRADIENTS.setup[1]),
            hexToRgbCss(CUSTOM_STATE_GRADIENTS.prod[1]),
        ]);
        expect(topCaps.map((cap) => cap.getAttribute('fill'))).toEqual([
            `color-mix(in srgb, ${CUSTOM_STATE_GRADIENTS.stopped[1]} 80%, white)`,
            `color-mix(in srgb, ${CUSTOM_STATE_GRADIENTS.setup[1]} 84%, white)`,
            `color-mix(in srgb, ${CUSTOM_STATE_GRADIENTS.prod[1]} 88%, white)`,
        ]);
        expect(topCaps[0]?.getAttribute('style')).toContain(`drop-shadow(0 0 6px ${CUSTOM_STATE_GRADIENTS.stopped[1]})`);
        expect(topCaps.at(-1)?.getAttribute('style')).toContain(`drop-shadow(0 0 6px ${CUSTOM_STATE_GRADIENTS.prod[1]})`);
        expect(comparisonSegments.map((segment) => (segment as HTMLElement).style.backgroundColor).slice(0, 4)).toEqual([
            'var(--color-industrial-muted)',
            hexToRgbCss(CUSTOM_STATE_GRADIENTS.prod[1]),
            hexToRgbCss(CUSTOM_STATE_GRADIENTS.setup[1]),
            hexToRgbCss(CUSTOM_STATE_GRADIENTS.stopped[1]),
        ]);

        await user.click(screen.getByRole('button', { name: 'Hover first bucket' }));

        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent(CUSTOM_STATE_GRADIENTS.prod[1]);
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent(CUSTOM_STATE_GRADIENTS.setup[1]);
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent(CUSTOM_STATE_GRADIENTS.stopped[1]);
        expect(screen.getByTestId('hover-layer')).toHaveAttribute(
            'data-highlight-colors',
            [
                'var(--color-industrial-muted)',
                CUSTOM_STATE_GRADIENTS.prod[1],
                CUSTOM_STATE_GRADIENTS.setup[1],
                CUSTOM_STATE_GRADIENTS.stopped[1],
            ].join('|'),
        );
        expect(groupsChart.innerHTML).toContain(CUSTOM_STATE_GRADIENTS.prod[0]);
        expect(groupsChart.innerHTML).toContain(CUSTOM_STATE_GRADIENTS.stopped[1]);

        rerender(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...widget.displayOptions,
                        stateGradients: UPDATED_STATE_GRADIENTS,
                    },
                })}
                machines={MACHINES}
                onPersistDisplayOptions={onPersistDisplayOptions}
            />,
        );

        expect(computeSpy).toHaveBeenCalledTimes(1);
        expect(onPersistDisplayOptions).not.toHaveBeenCalled();
        expect(screen.getByTestId('activity-analytics-summary-total-value')).toHaveTextContent('57%');
        expect(screen.getByTestId('activity-analytics-comparison')).toHaveTextContent('% Prod. 60% · 6.5 h');
    });

    it('applies resolved alpha and surface-specific visual effects without changing analytics results', async () => {
        const user = userEvent.setup();
        const computeSpy = vi.spyOn(activityAnalyticsComputation, 'computeActivityAnalytics').mockReturnValue({
            analytics: {
                durationsMs: {
                    prod: 4 * 60 * 60 * 1000,
                    setup: 2 * 60 * 60 * 1000,
                    stopped: 1 * 60 * 60 * 1000,
                    noData: 30 * 60 * 1000,
                },
                stopCount: 1,
                estimatedKwh: 18.4,
                utilizationRatio: 4 / 7,
                coverageRatio: 1,
                intervals: [],
            },
            grouped: [buildGroupedBucket({
                bucketKey: 'day-1',
                label: '2026-06-18',
                durationsMs: {
                    prod: 3 * 60 * 60 * 1000,
                    setup: 2 * 60 * 60 * 1000,
                    stopped: 1 * 60 * 60 * 1000,
                    noData: 30 * 60 * 1000,
                },
                expectedDurationMs: 6.5 * 60 * 60 * 1000,
                productivityLabel: '60%',
            })],
            comparison: {
                best: { label: '2026-06-18', bucketKey: 'day-1' },
                worst: { label: '2026-06-18', bucketKey: 'day-1' },
            },
            summaryRows: [{ label: '2026-06-18', productivityLabel: '60%', bucketKey: 'day-1' }],
            timezone: 'UTC',
        } as never);
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        const widget = makeWidget({
            displayOptions: {
                ...makeWidget().displayOptions,
                range: '7d',
                groupBy: 'day',
                stateGradients: CUSTOM_STATE_GRADIENTS,
                stateGradientAlphas: CUSTOM_STATE_GRADIENT_ALPHAS,
                visualEffects: CUSTOM_VISUAL_EFFECTS,
            },
        });

        const { rerender } = render(
            <ActivityAnalyticsWidget
                widget={widget}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 848, bodyHeight: 420, summaryColumnWidth: 320 });
        });

        const summaryChart = screen.getByTestId('activity-analytics-summary-chart');
        const summaryBodyStops = ['stopped-gradient', 'setup-gradient', 'prod-gradient']
            .flatMap((gradientIdSuffix) => getGradientStopsByIdSuffix(summaryChart, gradientIdSuffix));
        const summaryTopCapStops = ['stopped-top-cap-gradient', 'setup-top-cap-gradient', 'prod-top-cap-gradient']
            .flatMap((gradientIdSuffix) => getGradientStopsByIdSuffix(summaryChart, gradientIdSuffix));
        const detailMarkers = Array.from(screen.getByTestId('activity-analytics-summary-details').querySelectorAll('rect'));
        const summarySegments = screen.getAllByTestId('activity-analytics-summary-segment');
        const groupSegments = within(screen.getByTestId('activity-analytics-group-stack')).getAllByTestId('activity-analytics-group-segment');
        const legendSwatches = Array.from(screen.getByTestId('activity-analytics-groups-header-legend').querySelectorAll('span[aria-hidden="true"]'));
        const comparisonSegments = Array.from(screen.getByTestId('activity-analytics-comparison').querySelectorAll('div[aria-hidden="true"] > div'));
        const summaryTopCaps = screen.getAllByTestId('activity-analytics-summary-top-cap');

        expect(summaryBodyStops.map((stop) => stop.getAttribute('stop-opacity'))).toEqual([
            '0.55', '0.2',
            '0.65', '0.5',
            '0.35', '0.75',
        ]);
        expect(summaryTopCapStops.map((stop) => stop.getAttribute('stop-color'))).toEqual([
            ...reverseGradientStops(CUSTOM_STATE_GRADIENTS.stopped),
            ...reverseGradientStops(CUSTOM_STATE_GRADIENTS.setup),
            ...CUSTOM_STATE_GRADIENTS.prod,
        ]);
        expect(summaryTopCapStops.map((stop) => stop.getAttribute('stop-opacity'))).toEqual([
            '1', '1',
            '1', '1',
            '1', '1',
        ]);
        expect(detailMarkers.map((marker) => marker.getAttribute('fill'))).toEqual([
            hexToRgbaCss(CUSTOM_STATE_GRADIENTS.prod[1], CUSTOM_STATE_GRADIENT_ALPHAS.prod[1]),
            hexToRgbaCss(CUSTOM_STATE_GRADIENTS.setup[1], CUSTOM_STATE_GRADIENT_ALPHAS.setup[1]),
            hexToRgbaCss(CUSTOM_STATE_GRADIENTS.stopped[1], CUSTOM_STATE_GRADIENT_ALPHAS.stopped[1]),
        ]);
        expect(summarySegments.every((segment) => segment.getAttribute('filter')?.includes('summary-glow'))).toBe(true);
        expect(summaryChart.innerHTML).toContain('stdDeviation="4"');
        expect(summaryTopCaps.length).toBeGreaterThan(0);
        expect(summaryTopCaps.every((cap) => (cap.getAttribute('style') ?? '').includes('drop-shadow'))).toBe(true);
        expect(summaryTopCaps.every((cap) => (cap.getAttribute('stroke') ?? '').includes('-top-cap-gradient'))).toBe(true);
        expect(summaryTopCaps.every((cap) => (cap.getAttribute('style') ?? '').includes(CUSTOM_STATE_GRADIENTS[cap.getAttribute('data-segment-key') as keyof typeof CUSTOM_STATE_GRADIENTS][1]))).toBe(true);
        expect(summaryTopCaps.every((cap) => !(cap.getAttribute('style') ?? '').includes('rgba('))).toBe(true);
        expect(summaryTopCaps.map((cap) => cap.getAttribute('stroke-width'))).toEqual(summarySegments.map((segment) => segment.getAttribute('stroke-width')));
        expect(groupSegments.filter((segment) => segment.getAttribute('data-segment-key') !== 'noData').every((segment) => segment.getAttribute('filter')?.includes('grouped-glow'))).toBe(true);
        expect(screen.queryByTestId('activity-analytics-group-top-cap')).not.toBeInTheDocument();
        expect(legendSwatches.map((swatch) => (swatch as HTMLElement).style.backgroundColor)).toEqual([
            hexToRgbaCss(CUSTOM_STATE_GRADIENTS.stopped[1], CUSTOM_STATE_GRADIENT_ALPHAS.stopped[1]),
            hexToRgbaCss(CUSTOM_STATE_GRADIENTS.setup[1], CUSTOM_STATE_GRADIENT_ALPHAS.setup[1]),
            hexToRgbaCss(CUSTOM_STATE_GRADIENTS.prod[1], CUSTOM_STATE_GRADIENT_ALPHAS.prod[1]),
        ]);
        expect(comparisonSegments.map((segment) => (segment as HTMLElement).style.backgroundColor).slice(0, 4)).toEqual([
            'var(--color-industrial-muted)',
            hexToRgbaCss(CUSTOM_STATE_GRADIENTS.prod[1], CUSTOM_STATE_GRADIENT_ALPHAS.prod[1]),
            hexToRgbaCss(CUSTOM_STATE_GRADIENTS.setup[1], CUSTOM_STATE_GRADIENT_ALPHAS.setup[1]),
            hexToRgbaCss(CUSTOM_STATE_GRADIENTS.stopped[1], CUSTOM_STATE_GRADIENT_ALPHAS.stopped[1]),
        ]);

        await user.click(screen.getByRole('button', { name: 'Hover first bucket' }));

        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent(hexToRgbaCss(CUSTOM_STATE_GRADIENTS.prod[1], CUSTOM_STATE_GRADIENT_ALPHAS.prod[1]));
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent(hexToRgbaCss(CUSTOM_STATE_GRADIENTS.setup[1], CUSTOM_STATE_GRADIENT_ALPHAS.setup[1]));
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent(hexToRgbaCss(CUSTOM_STATE_GRADIENTS.stopped[1], CUSTOM_STATE_GRADIENT_ALPHAS.stopped[1]));
        expect(screen.getByTestId('hover-layer')).toHaveAttribute(
            'data-highlight-colors',
            [
                'var(--color-industrial-muted)',
                hexToRgbaCss(CUSTOM_STATE_GRADIENTS.prod[1], CUSTOM_STATE_GRADIENT_ALPHAS.prod[1]),
                hexToRgbaCss(CUSTOM_STATE_GRADIENTS.setup[1], CUSTOM_STATE_GRADIENT_ALPHAS.setup[1]),
                hexToRgbaCss(CUSTOM_STATE_GRADIENTS.stopped[1], CUSTOM_STATE_GRADIENT_ALPHAS.stopped[1]),
            ].join('|'),
        );

        rerender(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...widget.displayOptions,
                        visualEffects: {
                            groupedBars: {
                                ...CUSTOM_VISUAL_EFFECTS.groupedBars,
                                topCap: true,
                                topCapGlow: 95,
                            },
                            donut: {
                                ...CUSTOM_VISUAL_EFFECTS.donut,
                                topCapGlow: 25,
                            },
                        },
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(computeSpy).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('activity-analytics-summary-total-value')).toHaveTextContent('57%');
        expect(screen.getByTestId('activity-analytics-comparison')).toHaveTextContent('% Prod. 60% · 6.5 h');
        const groupedTopCaps = screen.getAllByTestId('activity-analytics-group-top-cap');
        expect(groupedTopCaps).toHaveLength(3);
        expect(groupedTopCaps.at(-1)).toHaveAttribute('fill', `color-mix(in srgb, ${CUSTOM_STATE_GRADIENTS.prod[1]} 88%, white)`);
        expect(groupedTopCaps.at(-1)?.getAttribute('style')).toContain(`drop-shadow(0 0 5.8px ${CUSTOM_STATE_GRADIENTS.prod[1]})`);
        expect(groupedTopCaps.every((cap) => !cap.hasAttribute('opacity'))).toBe(true);
    });

    it('keeps the distribution donut free of external callout labels at the minimum chart width', () => {
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

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            MockResizeObserver.latest().emit(320, 360);
        });

        const summaryChart = screen.getByTestId('activity-analytics-summary-chart');
        const chartWidth = Number(summaryChart.getAttribute('width'));
        expect(chartWidth).toBe(320);
        expect(within(summaryChart).queryAllByTestId('activity-analytics-summary-segment-label')).toHaveLength(0);
    });

    it('stacks the top region at intermediate widths and keeps side-by-side only once the 3-block layout fits', () => {
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

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            MockResizeObserver.latest().emit(520, 360);
        });

        expect(screen.getByTestId('activity-analytics-top-region')).toHaveAttribute('data-top-layout', 'stacked');

        act(() => {
            MockResizeObserver.latest().emit(847, 360);
        });

        expect(screen.getByTestId('activity-analytics-top-region')).toHaveAttribute('data-top-layout', 'side-by-side');
        expect(screen.getByTestId('activity-analytics-top-region')).toHaveStyle({
            gridTemplateColumns: 'minmax(20rem,1.1fr) minmax(16rem,0.9fr)',
        });
    });

    it('uses the measured summary column width for the donut when side-by-side layout is active', () => {
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

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 848, bodyHeight: 420, summaryColumnWidth: 336 });
        });

        const summaryChart = screen.getByTestId('activity-analytics-summary-chart');
        const intermediateWidth = Number(summaryChart.getAttribute('width'));

        expect(screen.getByTestId('activity-analytics-top-region')).toHaveAttribute('data-top-layout', 'side-by-side');
        expect(intermediateWidth).toBe(336);
        expect(intermediateWidth).toBeLessThanOrEqual(480);

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 1260, bodyHeight: 420, summaryColumnWidth: 456 });
        });

        expect(Number(screen.getByTestId('activity-analytics-summary-chart').getAttribute('width'))).toBeGreaterThan(intermediateWidth);
        expect(Number(screen.getByTestId('activity-analytics-summary-chart').getAttribute('width'))).toBe(456);
        expect(Number(screen.getByTestId('activity-analytics-summary-chart').getAttribute('width'))).toBeLessThanOrEqual(480);
    });

    it('renders ordered inline summary details in one vertically centered block', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([buildGroupedBucket({ bucketKey: 'day-1', label: '2026-06-18' })]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        const detailBlock = screen.getByTestId('activity-analytics-summary-details');
        const detailSections = within(detailBlock).getAllByTestId('activity-analytics-summary-detail-section');

        expect(detailBlock).toHaveAttribute('data-layout', 'centered-column');
        expect(detailSections).toHaveLength(3);
        expect(detailSections.map((section) => within(section).getByTestId('activity-analytics-summary-detail-title').textContent)).toEqual([
            'Producción',
            'Setup',
            'Detenida',
        ]);
        expect(detailSections.map((section) => within(section).getByTestId('activity-analytics-summary-detail-value').textContent)).toEqual([
            '57% - 4.0 h',
            '29% - 2.0 h',
            '14% - 1.0 h',
        ]);
    });

    it('shows only the remaining runtime range options and keeps the 7d Turno toggle', async () => {
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
            buildGroupedBucket({
                bucketKey: 'shift-4',
                label: '2026-06-19 · Turno 1 (en curso)',
                durationsMs: { prod: 90 * 60 * 1000, setup: 30 * 60 * 1000, stopped: 0, noData: 0 },
                expectedDurationMs: 8 * 60 * 60 * 1000,
                productivityRatio: null,
                productivityLabel: 'en curso',
                isInProgress: true,
            }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'shift',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(screen.queryByRole('button', { name: '24h' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: '30d' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '12m' })).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-turno-mode')).toBeInTheDocument();
        expect(within(screen.getByTestId('activity-analytics-turno-mode')).getByRole('button', { name: 'Resumen' })).toHaveAttribute('aria-pressed', 'true');
        expect(within(screen.getByTestId('activity-analytics-turno-mode')).getByRole('button', { name: 'Detalle' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Turno' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Día' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '30d' }));

        expect(screen.getByRole('button', { name: 'Turno' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Día' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Semana' })).toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-turno-mode')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '1h' })).not.toBeInTheDocument();
        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(3);
        expect(screen.getAllByText('Turno 1').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Turno 2').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Turno 3').length).toBeGreaterThan(0);
        expect(screen.queryByText('2026-06-19 · Turno 1 (en curso)')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-group-partial-outline')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '12m' }));

        expect(screen.getByRole('button', { name: 'Turno' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Día' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Semana' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Mes' })).toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-turno-mode')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(3);
        expect(screen.getAllByText('Turno 1').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Turno 2').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Turno 3').length).toBeGreaterThan(0);
        expect(screen.queryByText('2026-06-19 · Turno 1 (en curso)')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-group-partial-outline')).not.toBeInTheDocument();
    });

    it('normalizes legacy 24h configs to the 7d runtime scale and valid grouped controls', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([buildGroupedBucket({ bucketKey: 'shift-1', label: '2026-06-18 · Turno 1' })]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '24h',
                        groupBy: 'shift',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(vi.mocked(useActivitySeries)).toHaveBeenCalledWith({ machineId: 101, range: '7d' });
        expect(screen.queryByRole('button', { name: '24h' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Turno' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Día' })).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-turno-mode')).toBeInTheDocument();
    });

    it('keeps the last 7d Día bucket outlined as en curso when the live window end lags slightly', () => {
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: 'UTC', shifts: [] },
            shifts: [],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useActivitySeries).mockReturnValue({
            data: {
                ...POPULATED_ACTIVITY_SERIES,
                range: '7d',
                window: {
                    start: '2026-06-18T00:00:00.000Z',
                    end: '2026-06-18T10:00:00.000Z',
                    timezone: 'UTC',
                    bucket: '1h',
                    bucketMs: 60 * 60 * 1000,
                },
                series: [
                    { timestamp: '2026-06-18T00:00:00.000Z', timestampMs: Date.parse('2026-06-18T00:00:00.000Z'), value: 0.3 },
                    { timestamp: '2026-06-18T04:00:00.000Z', timestampMs: Date.parse('2026-06-18T04:00:00.000Z'), value: 0.2 },
                ],
            },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        vi.spyOn(activityAnalyticsComputation, 'computeActivityAnalytics').mockImplementation((options) => {
            const grouped = groupActivityAnalyticsIntervals({
                intervals: [
                    buildInterval('2026-06-18T00:00:00.000Z', 4 * 60 * 60 * 1000, 'prod'),
                    buildInterval('2026-06-18T04:00:00.000Z', 6 * 60 * 60 * 1000, 'setup'),
                ],
                groupBy: options.groupBy,
                timezone: options.timezone,
                shifts: options.shifts,
                windowStartMs: Date.parse(options.window.start),
                windowEndMs: Date.parse(options.window.end),
                nowMs: Date.parse('2026-06-18T10:05:00.000Z'),
                markTrailingCurrentBucketInProgress: options.range === '7d' && options.groupBy === 'day',
            });

            return {
                analytics: {
                    durationsMs: {
                        prod: 4 * 60 * 60 * 1000,
                        setup: 6 * 60 * 60 * 1000,
                        stopped: 0,
                        noData: 0,
                    },
                    stopCount: 0,
                    estimatedKwh: 20,
                    utilizationRatio: 0.4,
                    coverageRatio: 1,
                    intervals: [],
                },
                grouped,
                comparison: {
                    best: { label: 'sin datos', bucketKey: 'best' },
                    worst: { label: 'sin datos', bucketKey: 'worst' },
                },
                summaryRows: grouped.map((bucket) => ({ label: bucket.label, productivityLabel: bucket.productivityLabel, bucketKey: bucket.bucketKey })),
                timezone: options.timezone,
            } as never;
        });

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'day',
                    },
                })}
                machines={MACHINES}
            />,
        );

        const groupStack = screen.getByTestId('activity-analytics-group-stack');

        expect(screen.getByText('2026-06-18 (en curso)')).toBeInTheDocument();
        expect(within(groupStack).getByTestId('activity-analytics-group-partial-outline')).toBeInTheDocument();
    });

    it('keeps 7d Turno Resumen aggregated to three bars and switches to chronological partial-detail bars on demand', async () => {
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
                productivityLabel: 'en curso',
                isInProgress: true,
            }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
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

        const groupStacks = screen.getAllByTestId('activity-analytics-group-stack');

        expect(groupStacks).toHaveLength(4);
        expect(screen.getAllByText('2026-06-19 · Turno 1 (en curso)').length).toBeGreaterThan(0);
        expect(screen.getAllByTestId('activity-analytics-group-productivity').map((node) => node.textContent)).toContain('en curso');

        const currentShiftStack = groupStacks[3];
        const outline = within(currentShiftStack).getByTestId('activity-analytics-group-partial-outline');
        const outlineY = Number(outline.getAttribute('y') ?? '0');
        const outlineHeight = Number(outline.getAttribute('height') ?? '0');
        const segmentHeights = within(currentShiftStack)
            .getAllByTestId('activity-analytics-group-segment')
            .map((segment) => Number(segment.getAttribute('height') ?? '0'));
        const chart = screen.getByTestId('activity-analytics-groups-chart');
        const verticalAxis = Array.from(chart.querySelectorAll('line')).find((line) => line.getAttribute('x1') === line.getAttribute('x2'));

        expect(outline).toBeInTheDocument();
        expect(verticalAxis).not.toBeNull();

        const plotTop = Number(verticalAxis?.getAttribute('y1') ?? '0');
        const plotBottom = Number(verticalAxis?.getAttribute('y2') ?? '0');

        expect(outlineY).toBe(plotTop);
        expect(outlineHeight).toBe(plotBottom - plotTop);
        expect(outlineHeight).toBeGreaterThan(segmentHeights.reduce((sum, value) => sum + value, 0));
    });

    it('hides sin turno from 7d Turno Resumen bars and Mejor/Peor without changing internal summary coverage', () => {
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
                    noData: 24 * 60 * 60 * 1000,
                },
                stopCount: 1,
                estimatedKwh: 18.4,
                utilizationRatio: 4 / 7,
                coverageRatio: 1,
                intervals: [],
            },
            grouped: [
                buildGroupedBucket({
                    bucketKey: 'shift:shift-a:2026-06-18',
                    label: '2026-06-18 · Turno 1',
                    durationsMs: { prod: 2 * 60 * 60 * 1000, setup: 1 * 60 * 60 * 1000, stopped: 1 * 60 * 60 * 1000, noData: 0 },
                    expectedDurationMs: 4 * 60 * 60 * 1000,
                    productivityRatio: 0.5,
                    productivityLabel: '50%',
                }),
                buildGroupedBucket({
                    bucketKey: 'shift:shift-b:2026-06-18',
                    label: '2026-06-18 · Turno 2',
                    durationsMs: { prod: 3 * 60 * 60 * 1000, setup: 1 * 60 * 60 * 1000, stopped: 0, noData: 0 },
                    expectedDurationMs: 4 * 60 * 60 * 1000,
                    productivityRatio: 0.75,
                    productivityLabel: '75%',
                }),
                buildGroupedBucket({
                    bucketKey: 'shift:shift-c:2026-06-18',
                    label: '2026-06-18 · Turno 3',
                    durationsMs: { prod: 1 * 60 * 60 * 1000, setup: 1 * 60 * 60 * 1000, stopped: 2 * 60 * 60 * 1000, noData: 0 },
                    expectedDurationMs: 4 * 60 * 60 * 1000,
                    productivityRatio: 0.25,
                    productivityLabel: '25%',
                }),
                buildGroupedBucket({
                    bucketKey: 'sin-turno:2026-06-22T00:00:00.000Z',
                    label: '2026-06-22 · sin turno',
                    durationsMs: { prod: 0, setup: 0, stopped: 0, noData: 24 * 60 * 60 * 1000 },
                    expectedDurationMs: 24 * 60 * 60 * 1000,
                    productivityRatio: 0,
                    productivityLabel: '0%',
                }),
            ],
            comparison: {
                best: { label: '2026-06-22 · sin turno', bucketKey: 'sin-turno:2026-06-22T00:00:00.000Z' },
                worst: { label: '2026-06-18 · Turno 3', bucketKey: 'shift:shift-c:2026-06-18' },
            },
            summaryRows: [],
            timezone: 'UTC',
        } as never);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'shift',
                    },
                })}
                machines={MACHINES}
            />,
        );

        const comparisonPanel = screen.getByTestId('activity-analytics-comparison');
        const yAxisTicks = screen.getAllByTestId('activity-analytics-y-axis-tick').map((tick) => tick.textContent);

        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(3);
        expect(screen.queryByText('sin turno')).not.toBeInTheDocument();
        expect(within(comparisonPanel).getByText('Turno 2')).toBeInTheDocument();
        expect(within(comparisonPanel).getByText('Turno 3')).toBeInTheDocument();
        expect(within(comparisonPanel).queryByText('2026-06-22 · sin turno')).not.toBeInTheDocument();
        expect(screen.getByText(/Distribución/i)).toBeInTheDocument();
        expect(screen.queryByText('% Prod. 57% · Cob. 100%')).not.toBeInTheDocument();
        expect(yAxisTicks).toContain('4.0h');
        expect(yAxisTicks).not.toContain('24.0h');
    });

    it('keeps the 7d Turno Resumen shell alive when the only summary bucket becomes turno-summary:sin-turno', () => {
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: null, shifts: [] },
            shifts: [],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useActivitySeries).mockReturnValue({
            data: { ...POPULATED_ACTIVITY_SERIES, range: '7d' },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({
                bucketKey: 'sin-turno:2026-06-22T00:00:00.000Z',
                label: '2026-06-22 · sin turno',
                durationsMs: { prod: 0, setup: 0, stopped: 0, noData: 24 * 60 * 60 * 1000 },
                expectedDurationMs: 24 * 60 * 60 * 1000,
                productivityRatio: null,
                productivityLabel: 'sin datos',
            }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'shift',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(screen.queryByText('Sin grupos para mostrar')).not.toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-summary-bars')).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-turno-mode')).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-comparison')).toHaveTextContent('sin comparación');
        expect(screen.getByTestId('activity-analytics-groups-empty')).toHaveTextContent('Todos los grupos de esta ventana corresponden a sin turno y se ocultan en esta vista.');
        expect(screen.queryByText('sin turno')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-groups-chart')).not.toBeInTheDocument();
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
                        range: '7d',
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
            data: { ...POPULATED_ACTIVITY_SERIES, range: '7d' },
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
                        range: '7d',
                        groupBy: 'shift',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(2);
        expect(screen.getAllByText(/^A$/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/^C$/).length).toBeGreaterThan(0);
        expect(screen.queryByText('2026-06-18 · A')).not.toBeInTheDocument();
        expect(screen.queryByText('2026-06-18 · C')).not.toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-turno-mode')).toBeInTheDocument();
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

    it('never renders the detail-only in-progress outline when Turno Resumen collapses to a single current shift bucket', () => {
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: null, shifts: [] },
            shifts: [
                { id: 'shift-a', label: 'Turno 1', start: '06:00', end: '14:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
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
            buildGroupedBucket({
                bucketKey: 'shift:shift-a:2026-06-19',
                label: '2026-06-19 · Turno 1 (en curso)',
                durationsMs: { prod: 2 * 60 * 60 * 1000, setup: 1 * 60 * 60 * 1000, stopped: 1 * 60 * 60 * 1000, noData: 0 },
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
                        range: '7d',
                        groupBy: 'shift',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(1);
        expect(screen.getByText('Turno 1')).toBeInTheDocument();
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

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            MockResizeObserver.latest().emit(520, 360);
        });

        expect(screen.getByTestId('activity-analytics-groups-panel')).toHaveAttribute('data-groups-density', 'compress');
        expect(screen.queryByTestId('activity-analytics-groups-scroll-region')).not.toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-groups-chart')).toBeInTheDocument();
    });

    it('samples only truthful labels from real rendered groups while keeping every bucket stack reachable', async () => {
        const user = userEvent.setup();

        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        const labels = Array.from({ length: 6 }, (_, index) => `2026-06-${18 + index}`);
        mockComputedAnalytics(labels.map((label, index) => buildGroupedBucket({
            bucketKey: `day-${index + 1}`,
            label,
        })));

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            MockResizeObserver.latest().emit(480, 360);
        });

        expect(screen.getByTestId('activity-analytics-groups-panel')).toHaveAttribute('data-groups-density', 'compress');
        expect(screen.getByTestId('hover-layer')).toHaveAttribute('data-length', '6');
        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(6);

        const groupsChart = screen.getByTestId('activity-analytics-groups-chart');
        const visibleSecondaryLabels = labels.filter((label) => within(groupsChart).queryAllByText(label).length > 0);

        expect(visibleSecondaryLabels.length).toBeGreaterThan(0);
        expect(visibleSecondaryLabels.length).toBeLessThan(labels.length);
        expect(visibleSecondaryLabels.every((label) => labels.includes(label))).toBe(true);
        expect(within(groupsChart).queryAllByText('2026-06-24')).toHaveLength(0);

        await user.click(screen.getByRole('button', { name: 'Hover first bucket' }));

        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('2026-06-18');
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

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            MockResizeObserver.latest().emit(320, 360);
        });

        expect(screen.getByTestId('activity-analytics-groups-scroll-region')).toHaveClass('hmi-scrollbar');
        expect(screen.getByTestId('activity-analytics-groups-panel')).toHaveAttribute('data-groups-density', 'scroll');
        expect(screen.getByTestId('activity-analytics-groups-chart')).toBeInTheDocument();
        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(6);
        expect(screen.getAllByTestId('activity-analytics-group-segment')).toHaveLength(24);
        expect(screen.getAllByTestId('activity-analytics-group-productivity')).toHaveLength(6);
        expect(screen.getAllByText('2026-06-18').length).toBeGreaterThan(0);
        expect(screen.getAllByText('2026-06-23').length).toBeGreaterThan(0);

        await user.click(screen.getByRole('button', { name: 'Hover first bucket' }));

        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('2026-06-18');
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Prod.');
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Setup');
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Detenida');
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Sin datos');
        expect(screen.getByTestId('hover-layer')).toHaveAttribute('data-highlights', '4');
    });

    it('renders grouped bars with flat stacked bodies and top-cap highlights on each visible state segment', () => {
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
                durationsMs: {
                    prod: 3 * 60 * 60 * 1000,
                    setup: 2 * 60 * 60 * 1000,
                    stopped: 1 * 60 * 60 * 1000,
                    noData: 30 * 60 * 1000,
                },
                expectedDurationMs: 6.5 * 60 * 60 * 1000,
            }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'day',
                        visualEffects: {
                            groupedBars: {
                                ...CUSTOM_VISUAL_EFFECTS.groupedBars,
                                topCap: true,
                            },
                            donut: {
                                ...CUSTOM_VISUAL_EFFECTS.donut,
                                topCap: true,
                            },
                        },
                    },
                })}
                machines={MACHINES}
            />,
        );

        const stack = screen.getByTestId('activity-analytics-group-stack');
        const segments = within(stack).getAllByTestId('activity-analytics-group-segment');
        const topCaps = within(stack).getAllByTestId('activity-analytics-group-top-cap');
        const partialOutline = within(stack).queryByTestId('activity-analytics-group-partial-outline');
        const segmentByKey = new Map(segments.map((segment) => [segment.getAttribute('data-segment-key') ?? '', segment]));

        expectVisibleRectStackSemantics(segments, [
            { fill: 'var(--color-industrial-muted)', segmentKey: 'noData' },
            { fill: /^url\(#.+-stopped-gradient\)$/, segmentKey: 'stopped' },
            { fill: /^url\(#.+-setup-gradient\)$/, segmentKey: 'setup' },
            { fill: /^url\(#.+-prod-gradient\)$/, segmentKey: 'prod' },
        ]);
        expect(topCaps.map((cap) => cap.getAttribute('data-segment-key'))).toEqual(['stopped', 'setup', 'prod']);
        topCaps.forEach((cap) => {
            const key = cap.getAttribute('data-segment-key') ?? '';
            const segment = segmentByKey.get(key);
            expect(segment).toBeDefined();

            const capMetrics = parseRectMetrics(cap);
            const segmentMetrics = parseRectMetrics(segment!);

            expect(capMetrics.centerX).toBeCloseTo(segmentMetrics.centerX, 5);
            expect(capMetrics.width).toBeCloseTo(segmentMetrics.width, 5);
            expect(capMetrics.y).toBe(segmentMetrics.y);
            expect(capMetrics.height).toBeCloseTo(resolveExpectedGroupedTopCapHeight(segmentMetrics.height), 5);
            expect(capMetrics.height).toBeLessThan(segmentMetrics.height);
        });
        expect(partialOutline).not.toBeInTheDocument();
    });

    it('keeps donut top-cap stroke width aligned with the segment thickness while deriving its visible arc length from 20% of the stroke width', () => {
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
            }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'day',
                        visualEffects: {
                            groupedBars: {
                                ...CUSTOM_VISUAL_EFFECTS.groupedBars,
                                topCap: true,
                            },
                            donut: {
                                ...CUSTOM_VISUAL_EFFECTS.donut,
                                topCap: true,
                            },
                        },
                    },
                })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 848, bodyHeight: 420, summaryColumnWidth: 320 });
        });

        const summarySegments = screen.getAllByTestId('activity-analytics-summary-segment');
        const summaryTopCaps = screen.getAllByTestId('activity-analytics-summary-top-cap');
        let foundCapUsingVisibleLengthClamp = false;

        summaryTopCaps.forEach((cap) => {
            const key = cap.getAttribute('data-segment-key');
            const segment = summarySegments.find((candidate) => candidate.getAttribute('data-segment-key') === key);
            expect(segment).toBeDefined();

            const segmentStrokeWidth = Number(segment?.getAttribute('stroke-width'));
            const capStrokeWidth = Number(cap.getAttribute('stroke-width'));
            const visibleSegmentLength = parseVisibleStrokeLength(segment?.getAttribute('stroke-dasharray') ?? null);
            const capLength = parseVisibleStrokeLength(cap.getAttribute('stroke-dasharray'));
            const expectedCapLength = Math.min(Math.max(segmentStrokeWidth * 0.2, 1), visibleSegmentLength);

            expect(capStrokeWidth).toBeCloseTo(segmentStrokeWidth, 5);
            expect(capLength).toBeLessThan(segmentStrokeWidth);
            expect(capLength).toBeCloseTo(expectedCapLength, 5);

            if (expectedCapLength === visibleSegmentLength) {
                foundCapUsingVisibleLengthClamp = true;
            }
        });

        expect(foundCapUsingVisibleLengthClamp).toBe(false);

        const firstGroupStack = screen.getByTestId('activity-analytics-group-stack');
        const groupSegments = within(firstGroupStack).getAllByTestId('activity-analytics-group-segment');
        const groupTopCaps = within(firstGroupStack).getAllByTestId('activity-analytics-group-top-cap');
        const groupSegmentByKey = new Map(groupSegments.map((segment) => [segment.getAttribute('data-segment-key') ?? '', segment]));

        groupTopCaps.forEach((cap) => {
            const key = cap.getAttribute('data-segment-key') ?? '';
            const segment = groupSegmentByKey.get(key);

            expect(segment).toBeDefined();
            expect(Number(cap.getAttribute('height'))).toBeCloseTo(
                resolveExpectedGroupedTopCapHeight(Number(segment?.getAttribute('height'))),
                5,
            );
        });
    });

    it('uses the final stopped color for grouped top caps', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({
                durationsMs: {
                    prod: 2 * 60 * 60 * 1000,
                    setup: 1 * 60 * 60 * 1000,
                    stopped: 1 * 60 * 60 * 1000,
                    noData: 0,
                },
                expectedDurationMs: 4 * 60 * 60 * 1000,
            }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'day',
                        stateGradients: CUSTOM_STATE_GRADIENTS,
                        visualEffects: {
                            groupedBars: {
                                ...CUSTOM_VISUAL_EFFECTS.groupedBars,
                                topCap: true,
                            },
                            donut: CUSTOM_VISUAL_EFFECTS.donut,
                        },
                    },
                })}
                machines={MACHINES}
            />,
        );

        const stack = screen.getByTestId('activity-analytics-group-stack');
        const stoppedTopCap = within(stack)
            .getAllByTestId('activity-analytics-group-top-cap')
            .find((cap) => cap.getAttribute('data-segment-key') === 'stopped');
        const prodTopCap = within(stack)
            .getAllByTestId('activity-analytics-group-top-cap')
            .find((cap) => cap.getAttribute('data-segment-key') === 'prod');

        expect(stoppedTopCap).toHaveAttribute('fill', `color-mix(in srgb, ${CUSTOM_STATE_GRADIENTS.stopped[1]} 80%, white)`);
        expect(stoppedTopCap?.getAttribute('style')).toContain(CUSTOM_STATE_GRADIENTS.stopped[1]);
        expect(prodTopCap).toHaveAttribute('fill', `color-mix(in srgb, ${CUSTOM_STATE_GRADIENTS.prod[1]} 88%, white)`);
        expect(prodTopCap?.getAttribute('style')).toContain(CUSTOM_STATE_GRADIENTS.prod[1]);
    });

    it('matches production-history width math while keeping analytics, stacks, and tooltips invariant across valid bar-width factors', async () => {
        const user = userEvent.setup();

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
            expectedDurationMs: 5 * 60 * 60 * 1000,
            durationsMs: {
                prod: (index + 2) * 60 * 60 * 1000,
                setup: 1 * 60 * 60 * 1000,
                stopped: index % 2 === 0 ? 1 * 60 * 60 * 1000 : 0,
                noData: 0,
            },
            productivityLabel: `${60 + index}%`,
        })));

        const widget = makeWidget({
            displayOptions: {
                ...makeWidget().displayOptions,
                range: '7d',
                groupBy: 'day',
                groupBarWidth: 1,
            },
        });

        const { rerender } = render(
            <ActivityAnalyticsWidget
                widget={widget}
                machines={MACHINES}
            />,
        );

        const renderFactor = async (factor: 0.5 | 1 | 1.5) => {
            rerender(
                <ActivityAnalyticsWidget
                    widget={{
                        ...widget,
                        displayOptions: {
                            ...widget.displayOptions,
                            groupBarWidth: factor,
                        },
                    }}
                    machines={MACHINES}
                />,
            );

            act(() => {
                MockResizeObserver.latest().emit(480, 360);
            });

            await user.click(screen.getByRole('button', { name: 'Hover first bucket' }));

            const firstStack = screen.getAllByTestId('activity-analytics-group-stack')[0];
            const firstStackSegments = within(firstStack).getAllByTestId('activity-analytics-group-segment');

            return {
                tooltip: screen.getByTestId('chart-tooltip').textContent,
                comparison: screen.getByTestId('activity-analytics-comparison').textContent,
                coverage: screen.getByTestId('activity-analytics-summary-coverage').textContent,
                stackCount: screen.getAllByTestId('activity-analytics-group-stack').length,
                productivityLabels: screen.getAllByTestId('activity-analytics-group-productivity').map((node) => node.textContent),
                metrics: firstStackSegments.map(parseRectMetrics),
            };
        };

        const narrow = await renderFactor(0.5);
        const medium = await renderFactor(1);
        const wide = await renderFactor(1.5);

        expect(narrow.stackCount).toBe(6);
        expect(medium.stackCount).toBe(6);
        expect(wide.stackCount).toBe(6);
        expect(narrow.tooltip).toBe(medium.tooltip);
        expect(medium.tooltip).toBe(wide.tooltip);
        expect(narrow.comparison).toBe(medium.comparison);
        expect(medium.comparison).toBe(wide.comparison);
        expect(narrow.coverage).toBe(medium.coverage);
        expect(medium.coverage).toBe(wide.coverage);
        expect(narrow.productivityLabels).toEqual(medium.productivityLabels);
        expect(medium.productivityLabels).toEqual(wide.productivityLabels);
        expect(narrow.metrics.map(({ y, height }) => ({ y, height }))).toEqual(medium.metrics.map(({ y, height }) => ({ y, height })));
        expect(medium.metrics.map(({ y, height }) => ({ y, height }))).toEqual(wide.metrics.map(({ y, height }) => ({ y, height })));

        expect(narrow.metrics[0]?.width).toBeCloseTo(12.19, 1);
        expect(medium.metrics[0]?.width).toBeCloseTo(24.38, 1);
        expect(wide.metrics[0]?.width).toBeCloseTo(36.57, 1);
        expect(narrow.metrics[0]?.centerX).toBeCloseTo(62.19, 1);
        expect(medium.metrics[0]?.centerX).toBeCloseTo(74.38, 1);
        expect(wide.metrics[0]?.centerX).toBeCloseTo(86.57, 1);
    });

    it('falls back to truthful text cards on tight sizes and keeps grouped cards on full bucket duration semantics', () => {
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
                    prod: 4 * 60 * 60 * 1000,
                    setup: 1 * 60 * 60 * 1000,
                    stopped: 0,
                    noData: 4 * 60 * 60 * 1000,
                },
                estimatedKwh: 9.2,
                stopCount: 1,
                utilizationRatio: 4 / 9,
                coverageRatio: 1,
                expectedDurationMs: 9 * 60 * 60 * 1000,
                productivityRatio: 4 / 9,
                productivityLabel: '44%',
                isInProgress: false,
            }],
            comparison: {
                best: { label: '2026-06-18', bucketKey: 'best' },
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
                        range: '7d',
                        groupBy: 'shift',
                    },
                })}
                machines={MACHINES}
            />,
        );

        act(() => {
            MockResizeObserver.latest().emit(360, 210);
        });

        expect(screen.getByTestId('activity-analytics-summary-text')).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-groups-text')).toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-stacked-bar')).not.toBeInTheDocument();
        expect(screen.getAllByText('44%').length).toBeGreaterThan(0);
        expect(within(screen.getByTestId('activity-analytics-summary-text')).getAllByText(/^(Producción|Setup|Detenida)$/).map((item) => item.textContent)).toEqual([
            'Producción',
            'Setup',
            'Detenida',
        ]);

        const groupedCard = within(screen.getByTestId('activity-analytics-groups-text')).getByText('2026-06-18').parentElement as HTMLElement;

        expect(within(groupedCard).getByText('9.0 h')).toBeInTheDocument();
    });

    it('shows cobertura incompleta for incomplete coverage while preserving en curso, sin turno, and sin comparación', async () => {
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
                    productivityLabel: 'en curso',
                    isInProgress: true,
                },
                {
                    bucketKey: 'shift-2',
                    label: '2026-06-19 · Turno Tarde',
                    startMs: 1,
                    endMs: 2,
                    durationsMs: {
                        prod: 1 * 60 * 60 * 1000,
                        setup: 0,
                        stopped: 0,
                        noData: 3 * 60 * 60 * 1000,
                    },
                    estimatedKwh: 2,
                    stopCount: 0,
                    utilizationRatio: 1,
                    coverageRatio: 0.25,
                    expectedDurationMs: 4 * 60 * 60 * 1000,
                    productivityRatio: null,
                    productivityLabel: 'cobertura incompleta',
                    isInProgress: false,
                },
                {
                    bucketKey: 'shift-3',
                    label: '2026-06-20 · sin turno',
                    startMs: 2,
                    endMs: 3,
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
                best: { label: 'sin comparación', bucketKey: 'best' },
                worst: { label: 'sin comparación', bucketKey: 'worst' },
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

        await user.click(screen.getByRole('button', { name: 'Detalle' }));

        expect(screen.getAllByText('cobertura incompleta').length).toBeGreaterThan(0);
        expect(screen.getAllByText('en curso').length).toBeGreaterThan(0);
        expect(screen.getByText('2026-06-18 · Turno Noche (en curso)')).toBeInTheDocument();
        expect(screen.getByText('2026-06-19 · Turno Tarde')).toBeInTheDocument();
        expect(screen.getByText('2026-06-20 · sin turno')).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-comparison')).toHaveTextContent('sin comparación');

        act(() => {
            MockResizeObserver.latest().emit(360, 210);
        });

        expect(screen.getByTestId('activity-analytics-groups-text')).toBeInTheDocument();
        expect(screen.getAllByText('cobertura incompleta').length).toBeGreaterThan(0);
        expect(screen.getAllByText('en curso').length).toBeGreaterThan(0);
        expect(screen.getByText('2026-06-18 · Turno Noche (en curso)')).toBeInTheDocument();
        expect(screen.getByText('2026-06-19 · Turno Tarde')).toBeInTheDocument();
        expect(screen.getByText('2026-06-20 · sin turno')).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-comparison')).toHaveTextContent('sin comparación');
    });

    it('ranks closed high-coverage incomplete Turno buckets and discloses observed coverage in Mejor/Peor', async () => {
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
                    prod: 11 * 60 * 60 * 1000,
                    setup: 4.6 * 60 * 60 * 1000,
                    stopped: 0,
                    noData: 0.4 * 60 * 60 * 1000,
                },
                stopCount: 0,
                estimatedKwh: 12,
                utilizationRatio: 11 / 15.6,
                coverageRatio: 0.975,
                intervals: [],
            },
            grouped: [
                buildGroupedBucket({
                    bucketKey: 'shift-1',
                    label: '2026-06-19 · Turno 1',
                    durationsMs: {
                        prod: 7 * 60 * 60 * 1000,
                        setup: 0.6 * 60 * 60 * 1000,
                        stopped: 0,
                        noData: 0.4 * 60 * 60 * 1000,
                    },
                    utilizationRatio: 7 / 7.6,
                    coverageRatio: 0.95,
                    expectedDurationMs: 8 * 60 * 60 * 1000,
                    productivityRatio: null,
                    productivityLabel: 'cobertura incompleta',
                    isInProgress: false,
                }),
                buildGroupedBucket({
                    bucketKey: 'shift-2',
                    label: '2026-06-19 · Turno 2',
                    durationsMs: {
                        prod: 4 * 60 * 60 * 1000,
                        setup: 4 * 60 * 60 * 1000,
                        stopped: 0,
                        noData: 0,
                    },
                    utilizationRatio: 0.5,
                    coverageRatio: 1,
                    expectedDurationMs: 8 * 60 * 60 * 1000,
                    productivityRatio: 0.5,
                    productivityLabel: '50%',
                    isInProgress: false,
                }),
            ],
            comparison: {
                best: { label: 'sin comparación', bucketKey: 'best' },
                worst: { label: 'sin comparación', bucketKey: 'worst' },
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

        await user.click(screen.getByRole('button', { name: 'Detalle' }));

        const comparisonPanel = screen.getByTestId('activity-analytics-comparison');

        expect(within(comparisonPanel).getByText('2026-06-19 · Turno 1')).toBeInTheDocument();
        expect(within(comparisonPanel).getByText('2026-06-19 · Turno 2')).toBeInTheDocument();
        expect(comparisonPanel).toHaveTextContent('Prod. observada 92% · Cob. 95% · 8.0 h');
        expect(comparisonPanel).toHaveTextContent('% Prod. 50% · 8.0 h');
        expect(comparisonPanel).not.toHaveTextContent('sin comparación');
    });

    it('renders calendar grouped buckets against full expected duration semantics and outlines in-progress buckets', () => {
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
                durationsMs: { prod: 6 * 60 * 60 * 1000, setup: 3 * 60 * 60 * 1000, stopped: 0, noData: 15 * 60 * 60 * 1000 },
                expectedDurationMs: 24 * 60 * 60 * 1000,
                productivityRatio: 0.25,
                productivityLabel: '25%',
                isInProgress: false,
            }),
            buildGroupedBucket({
                bucketKey: 'day-2',
                label: '2026-06-19 (en curso)',
                durationsMs: { prod: 4 * 60 * 60 * 1000, setup: 2 * 60 * 60 * 1000, stopped: 0, noData: 4 * 60 * 60 * 1000 },
                expectedDurationMs: 24 * 60 * 60 * 1000,
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
                        range: '7d',
                        groupBy: 'day',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(screen.getByTestId('activity-analytics-group-partial-outline')).toBeInTheDocument();
        expect(screen.getByText('24.0h')).toBeInTheDocument();
        expect(screen.getByText('18.0h')).toBeInTheDocument();
        expect(screen.getByText('12.0h')).toBeInTheDocument();
        expect(screen.getByText('6.0h')).toBeInTheDocument();
        expect(screen.getAllByText('10.0 h').length).toBeGreaterThan(0);
    });

    it('shows an empty-series state when the endpoint returns no points', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: {
                contractVersion: '1.0.0',
                machineId: 101,
                variableKey: 'Total kW',
                range: '7d',
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

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'shift',
                    },
                })}
                machines={MACHINES}
            />,
        );

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

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'shift',
                    },
                })}
                machines={MACHINES}
            />,
        );

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

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

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

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        expect(screen.getByText('Activity-Series devolvió datos inválidos')).toBeInTheDocument();
        expect(screen.getByText('La respuesta recibida no cumple el contrato esperado para esta analítica.')).toBeInTheDocument();
        expect(screen.queryByText('No fue posible calcular la analítica de actividad.')).not.toBeInTheDocument();
    });

    it('uses compact chart typography for Mejor/Peor instead of KPI-scale values', () => {
        vi.mocked(isDataActivitySeriesEnabled).mockReturnValue(false);

        const dayGroupedWidget = makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } });
        const { rerender } = render(<ActivityAnalyticsWidget widget={dayGroupedWidget} machines={MACHINES} />);

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

        rerender(<ActivityAnalyticsWidget widget={dayGroupedWidget} machines={MACHINES} />);

        expect(screen.getByText('Mejor')).toHaveStyle({
            fontFamily: 'var(--font-system)',
            fontWeight: 'var(--font-weight-system)',
            fontSize: 'var(--font-size-system)',
            letterSpacing: 'var(--tracking-system)',
        });
        expect(screen.getByText('Peor')).toHaveStyle({
            fontFamily: 'var(--font-system)',
            fontWeight: 'var(--font-weight-system)',
            fontSize: 'var(--font-size-system)',
            letterSpacing: 'var(--tracking-system)',
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

    it('uses semantic typography for summary values/details and scales donut thickness responsively while preserving center semantics', () => {
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
            }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        const summaryPanel = screen.getByTestId('activity-analytics-summary-bars');
        const detailBlock = screen.getByTestId('activity-analytics-summary-details');
        const detailTitle = within(detailBlock).getAllByTestId('activity-analytics-summary-detail-title')[0];
        const detailValue = within(detailBlock).getAllByTestId('activity-analytics-summary-detail-value')[0];
        const coverageValue = within(summaryPanel).getByTestId('activity-analytics-summary-coverage');
        const donutCenterValue = screen.getByTestId('activity-analytics-summary-total-value');
        const donutCenterLabel = screen.getByTestId('activity-analytics-summary-total-label');
        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 848, bodyHeight: 420, summaryColumnWidth: 240 });
        });

        const narrowSegments = screen.getAllByTestId('activity-analytics-summary-segment');
        const narrowProdStrokeWidth = Number(narrowSegments.find((segment) => segment.getAttribute('data-segment-key') === 'prod')?.getAttribute('stroke-width'));
        const narrowSetupStrokeWidth = Number(narrowSegments.find((segment) => segment.getAttribute('data-segment-key') === 'setup')?.getAttribute('stroke-width'));

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 1260, bodyHeight: 420, summaryColumnWidth: 456 });
        });

        const wideSegments = screen.getAllByTestId('activity-analytics-summary-segment');
        const wideProdStrokeWidth = Number(wideSegments.find((segment) => segment.getAttribute('data-segment-key') === 'prod')?.getAttribute('stroke-width'));
        const wideSetupStrokeWidth = Number(wideSegments.find((segment) => segment.getAttribute('data-segment-key') === 'setup')?.getAttribute('stroke-width'));

        expect(detailTitle).toHaveStyle({
            fontFamily: 'var(--font-system)',
            fontWeight: 'var(--font-weight-system)',
            fontSize: 'var(--font-size-system)',
            letterSpacing: 'var(--tracking-system)',
        });
        expect(detailValue).toHaveStyle({
            fontFamily: 'var(--font-mono)',
            fontWeight: 'var(--font-weight-mono)',
            fontSize: 'var(--font-size-mono)',
            letterSpacing: 'var(--tracking-mono)',
        });
        expect(coverageValue).toHaveTextContent('Cobertura 100%');
        expect(coverageValue).toHaveStyle({
            fontFamily: 'var(--font-mono)',
            fontWeight: 'var(--font-weight-mono)',
            fontSize: 'var(--font-size-mono)',
            letterSpacing: 'var(--tracking-mono)',
        });
        expect(donutCenterValue).toHaveTextContent('57%');
        expect(donutCenterValue).toHaveStyle({
            fontFamily: 'var(--font-widget-value-activity-analytics)',
            fontWeight: 'var(--font-weight-widget-value-activity-analytics)',
            fontSize: 'var(--font-size-widget-value-activity-analytics)',
            letterSpacing: 'var(--tracking-widget-value-activity-analytics)',
        });
        expect(donutCenterLabel).toHaveTextContent('PROD');
        expect(donutCenterLabel).toHaveStyle({
            fontFamily: 'var(--font-system)',
            fontWeight: 'var(--font-weight-system)',
            fontSize: 'var(--font-size-system)',
            letterSpacing: 'var(--tracking-system)',
        });
        expect(narrowSetupStrokeWidth).toBe(6);
        expect(narrowProdStrokeWidth).toBe(9);
        expect(wideSetupStrokeWidth).toBe(12);
        expect(wideProdStrokeWidth).toBe(18);
        expect(donutCenterValue).not.toHaveTextContent('7.0 h');
        expect(donutCenterLabel).not.toHaveTextContent('Total');
    });

    it('builds summary donut segments without mutable render-time offsets', () => {
        const segments = buildActivityAnalyticsSummarySegments({
            bars: [
                { key: 'stopped', label: 'Detenida', durationMs: 1, color: 'red' },
                { key: 'setup', label: 'Setup', durationMs: 2, color: 'yellow' },
                { key: 'prod', label: 'Prod.', durationMs: 3, color: 'green' },
            ],
            circumference: 120,
            gapLength: 6,
        });

        expect(segments).toHaveLength(3);
        expect(segments.map((segment) => segment.bar.key)).toEqual(['stopped', 'setup', 'prod']);
        expect(segments[0]?.dashOffset).toBe(-3);
        expect(segments[1]?.dashOffset).toBeLessThan(segments[0]?.dashOffset ?? 0);
        expect(segments[2]?.dashOffset).toBeLessThan(segments[1]?.dashOffset ?? 0);
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

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        const comparisonPanel = screen.getByTestId('activity-analytics-comparison');

        expect(within(comparisonPanel).getByText('2026-06-18')).toBeInTheDocument();
        expect(within(comparisonPanel).getByText('% Prod. 60% · 5.0 h')).toBeInTheDocument();
        expect(within(comparisonPanel).getByText('2026-06-19')).toBeInTheDocument();
        expect(within(comparisonPanel).getByText('% Prod. 50% · 2.0 h')).toBeInTheDocument();
    });

    it('uses full grouped bucket duration in Mejor/Peor metadata and ignores in-progress entries', () => {
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
                durationsMs: { prod: 6 * 60 * 60 * 1000, setup: 3 * 60 * 60 * 1000, stopped: 0, noData: 15 * 60 * 60 * 1000 },
                expectedDurationMs: 24 * 60 * 60 * 1000,
                productivityRatio: 0.25,
                productivityLabel: '25%',
            }),
            buildGroupedBucket({
                bucketKey: 'day-2',
                label: '2026-06-19 (en curso)',
                durationsMs: { prod: 4 * 60 * 60 * 1000, setup: 2 * 60 * 60 * 1000, stopped: 0, noData: 4 * 60 * 60 * 1000 },
                expectedDurationMs: 24 * 60 * 60 * 1000,
                productivityRatio: null,
                productivityLabel: 'sin datos',
                isInProgress: true,
            }),
        ]);

        render(<ActivityAnalyticsWidget widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })} machines={MACHINES} />);

        const comparisonPanel = screen.getByTestId('activity-analytics-comparison');

        expect(within(comparisonPanel).getByText('sin comparación')).toBeInTheDocument();
        expect(within(comparisonPanel).getByText('% Prod. 25% · 24.0 h')).toBeInTheDocument();
    });

    it('shows sin comparación for aggregated Turno Resumen comparisons when productivity ties make ranking meaningless', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({
                bucketKey: 'shift-1',
                label: '2026-06-18 · Turno 1',
                durationsMs: { prod: 4 * 60 * 60 * 1000, setup: 2 * 60 * 60 * 1000, stopped: 2 * 60 * 60 * 1000, noData: 0 },
                expectedDurationMs: 8 * 60 * 60 * 1000,
                productivityRatio: 0.5,
                productivityLabel: '50%',
            }),
            buildGroupedBucket({
                bucketKey: 'shift-2',
                label: '2026-06-19 · Turno 1',
                durationsMs: { prod: 2 * 60 * 60 * 1000, setup: 1 * 60 * 60 * 1000, stopped: 1 * 60 * 60 * 1000, noData: 0 },
                expectedDurationMs: 4 * 60 * 60 * 1000,
                productivityRatio: 0.5,
                productivityLabel: '50%',
            }),
            buildGroupedBucket({
                bucketKey: 'shift-3',
                label: '2026-06-18 · Turno 2',
                durationsMs: { prod: 3 * 60 * 60 * 1000, setup: 2 * 60 * 60 * 1000, stopped: 1 * 60 * 60 * 1000, noData: 0 },
                expectedDurationMs: 6 * 60 * 60 * 1000,
                productivityRatio: 0.5,
                productivityLabel: '50%',
            }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'shift',
                    },
                })}
                machines={MACHINES}
            />,
        );

        const comparisonPanel = screen.getByTestId('activity-analytics-comparison');

        expect(within(comparisonPanel).getAllByText('sin comparación')).toHaveLength(4);
    });

    it('does not rank aggregated Turno Resumen buckets as closed when any contributing shift is still in progress', () => {
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: null, shifts: [] },
            shifts: [
                { id: 'shift-a', label: 'Turno 1', start: '06:00', end: '14:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
                { id: 'shift-b', label: 'Turno 2', start: '14:00', end: '22:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
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
            buildGroupedBucket({
                bucketKey: 'shift:shift-a:2026-06-18',
                label: '2026-06-18 · Turno 1',
                durationsMs: { prod: 4 * 60 * 60 * 1000, setup: 2 * 60 * 60 * 1000, stopped: 2 * 60 * 60 * 1000, noData: 0 },
                expectedDurationMs: 8 * 60 * 60 * 1000,
                productivityRatio: 0.5,
                productivityLabel: '50%',
            }),
            buildGroupedBucket({
                bucketKey: 'shift:shift-a:2026-06-19',
                label: '2026-06-19 · Turno 1 (en curso)',
                durationsMs: { prod: 2 * 60 * 60 * 1000, setup: 1 * 60 * 60 * 1000, stopped: 1 * 60 * 60 * 1000, noData: 0 },
                expectedDurationMs: 4 * 60 * 60 * 1000,
                productivityRatio: null,
                productivityLabel: 'sin datos',
                isInProgress: true,
            }),
            buildGroupedBucket({
                bucketKey: 'shift:shift-b:2026-06-18',
                label: '2026-06-18 · Turno 2',
                durationsMs: { prod: 3 * 60 * 60 * 1000, setup: 3 * 60 * 60 * 1000, stopped: 2 * 60 * 60 * 1000, noData: 0 },
                expectedDurationMs: 8 * 60 * 60 * 1000,
                productivityRatio: 0.375,
                productivityLabel: '38%',
            }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'shift',
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(2);
        expect(screen.queryByText('2026-06-19 · Turno 1 (en curso)')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-group-partial-outline')).not.toBeInTheDocument();

        const comparisonPanel = screen.getByTestId('activity-analytics-comparison');

        expect(within(comparisonPanel).queryByText('Turno 1')).not.toBeInTheDocument();
        expect(within(comparisonPanel).getAllByText('sin comparación')).toHaveLength(4);
    });

    it('uses semantic surface tokens for analytics cards instead of hardcoded black/white utilities', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        expect(screen.getByTestId('activity-analytics-groups')).toHaveClass('border-industrial-border');
        expect(screen.getByTestId('activity-analytics-comparison')).toHaveClass('border-industrial-border');
        expect(screen.getByTestId('activity-analytics-summary-bars')).not.toHaveClass('border-industrial-border');
        expect(screen.getAllByTestId('activity-analytics-summary-stack')).toHaveLength(1);
        expect(screen.getAllByTestId('activity-analytics-summary-segment').length).toBeGreaterThan(0);
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
                        range: '30d',
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
