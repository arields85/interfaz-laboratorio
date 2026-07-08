import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientContext } from '@tanstack/react-query';
import { ActivitySeriesAdapterError } from '../../adapters/activitySeries.adapter';
import type { ActivityAnalyticsWidgetConfig, WidgetConfig } from '../../domain/admin.types';
import type { ContractMachine } from '../../domain/dataContract.types';
import { isDataActivitySeriesEnabled } from '../../config/dataConnection.config';
import { useTemporalSettings } from '../../hooks/useTemporalSettings';
import { useActivitySeries, type UseActivitySeriesResult } from '../../queries/useActivitySeries';
import { DataServiceError } from '../../services/dataOverview.service';
import { subscribeActivityAnalyticsPerformanceDiagnostics } from '../../utils/activityAnalyticsPerformanceDiagnostics';
import type { ActivityAnalyticsInterval } from '../../utils/activityAnalytics';
import * as activityAnalyticsComputation from '../../utils/activityAnalyticsComputation';
import { groupActivityAnalyticsIntervals } from '../../utils/activityAnalyticsGrouping';
import { buildActivityAnalyticsSummarySegments } from '../../utils/activityAnalyticsSummarySegments';
import { DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_ALPHAS } from '../../utils/activityAnalyticsWidgetDefaults';
import ActivityAnalyticsWidget, { resolveProdTrendLatestValueLabelPlacement, resolveSummaryTravelingTopCapRoute } from './ActivityAnalyticsWidget';

class MockResizeObserver implements ResizeObserver {
    private static instances: MockResizeObserver[] = [];

    private observedTargets: Element[] = [];

    public constructor(private readonly callback: ResizeObserverCallback) {
        MockResizeObserver.instances.push(this);
    }

    public observe(target: Element): void {
        this.observedTargets.push(target);
        this.emit(640, CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX, target);
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
}: {
    bodyWidth: number;
    bodyHeight: number;
}) {
    const observer = MockResizeObserver.latest();

    observer.emit(bodyWidth, bodyHeight);
}

const CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX = 800;
const PROD_TREND_COMPACT_PANEL_TOP_PADDING_PX = 8;
const PROD_TREND_COMPACT_HEADING_ROW_HEIGHT_PX = 18;
const PROD_TREND_COMPACT_SHELL_MARGIN_TOP_PX = 4;
const PROD_TREND_COMPACT_SHELL_PADDING_BOTTOM_PX = 8;
const PROD_TREND_COMPACT_CHROME_BUDGET_PX = PROD_TREND_COMPACT_PANEL_TOP_PADDING_PX
    + PROD_TREND_COMPACT_HEADING_ROW_HEIGHT_PX
    + PROD_TREND_COMPACT_SHELL_MARGIN_TOP_PX
    + PROD_TREND_COMPACT_SHELL_PADDING_BOTTOM_PX;
const PROD_TREND_COMPACT_CHART_MIN_HEIGHT_PX = 34;
const PROD_TREND_COMPACT_PANEL_MIN_HEIGHT_PX = PROD_TREND_COMPACT_CHROME_BUDGET_PX + PROD_TREND_COMPACT_CHART_MIN_HEIGHT_PX;
const GROUPS_COMPACT_TURNO_PANEL_TOP_PADDING_PX = 8;
const GROUPS_COMPACT_TURNO_HEADING_PRIMARY_ROW_HEIGHT_PX = 24;
const GROUPS_COMPACT_TURNO_HEADING_LEGEND_ROW_HEIGHT_PX = 16;
const GROUPS_COMPACT_TURNO_SHELL_MARGIN_TOP_PX = 4;
const GROUPS_COMPACT_TURNO_SHELL_PADDING_BOTTOM_PX = 8;
const GROUPS_COMPACT_TURNO_CHROME_BUDGET_PX = GROUPS_COMPACT_TURNO_PANEL_TOP_PADDING_PX
    + GROUPS_COMPACT_TURNO_HEADING_PRIMARY_ROW_HEIGHT_PX
    + GROUPS_COMPACT_TURNO_HEADING_LEGEND_ROW_HEIGHT_PX
    + GROUPS_COMPACT_TURNO_SHELL_MARGIN_TOP_PX
    + GROUPS_COMPACT_TURNO_SHELL_PADDING_BOTTOM_PX;

vi.mock('../../config/dataConnection.config', () => ({
    isDataActivitySeriesEnabled: vi.fn(),
}));

vi.mock('../../hooks/useTemporalSettings', () => ({
    useTemporalSettings: vi.fn(),
}));

vi.mock('../../queries/useActivitySeries', async () => {
    const actual = await vi.importActual<typeof import('../../queries/useActivitySeries')>('../../queries/useActivitySeries');

    return {
        ...actual,
        useActivitySeries: vi.fn(),
    };
});

vi.mock('../../components/ui/ChartHoverLayer', () => ({
    default: ({ dataLength, x0, marginLeft, plotWidth, highlights, onHoverChange }: {
        dataLength: number;
        x0?: number;
        marginLeft?: number;
        plotWidth?: number;
        highlights?: Array<unknown>;
        onHoverChange: (index: number | null, x?: number) => void;
    }) => (
        <div
            data-testid="hover-layer"
            data-length={dataLength}
            data-x0={x0}
            data-margin-left={marginLeft}
            data-plot-width={plotWidth}
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
    default: ({ label, series, panelClassName, labelClassName }: { label: string; series: Array<{ name: string; value: string; color?: string }>; panelClassName?: string; labelClassName?: string }) => (
        <div data-testid="chart-tooltip" className={panelClassName} data-label-class={labelClassName}>
            {label}::{JSON.stringify(series)}
        </div>
    ),
}));

function readTooltipSeries() {
    const tooltip = screen.getByTestId('chart-tooltip');
    const [, serializedSeries = '[]'] = (tooltip.textContent ?? '').split('::');

    return JSON.parse(serializedSeries) as Array<{ name: string; value: string; color?: string }>;
}

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

const CUSTOM_PROD_TREND_BANDS = {
    colors: ['#112233', '#445566', '#778899'],
    alphas: [12, 68, 24],
    blendMode: 'normal',
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

function topCapHighlightColor(hex: string, mixPercentage: number): string {
    return `color-mix(in srgb, ${hex} ${mixPercentage}%, white)`;
}

const TOP_CAP_HIGHLIGHT_MIX_BY_STATE = {
    prod: 88,
    setup: 84,
    stopped: 80,
} as const;

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

function resolveExpectedGroupedTopCapHeight() {
    return 2;
}

function parseVisibleStrokeLength(strokeDashArray: string | null): number {
    return Number((strokeDashArray ?? '0').split(' ')[0]);
}

function parseStrokeDashOffset(strokeDashOffset: string | null): number {
    return Number(strokeDashOffset ?? '0');
}

function buildRenderedSummarySegmentsFromDom(summarySegments: HTMLElement[]) {
    return summarySegments.map((segment) => ({
        bar: {
            key: segment.getAttribute('data-segment-key') ?? 'stopped',
            label: segment.getAttribute('data-segment-key') ?? 'stopped',
            durationMs: 1,
            color: '',
        },
        dashArray: segment.getAttribute('stroke-dasharray') ?? '0 0',
        dashOffset: Number(segment.getAttribute('stroke-dashoffset') ?? '0'),
    }));
}

function parsePercentHeight(value: string): number {
    return Number.parseFloat(value.replace('%', ''));
}

function parsePxStyle(value: string): number {
    return Number.parseFloat(value.replace('px', ''));
}

function parseNumericCsvAttribute(value: string | null): number[] {
    return (value ?? '')
        .split(',')
        .filter((entry) => entry.length > 0)
        .map((entry) => Number.parseFloat(entry));
}

function getRenderedGroupXAxisLabels() {
    return screen.getAllByTestId('activity-analytics-group-stack')
        .map((stack) => {
            const textNodes = Array.from(stack.querySelectorAll('text'));

            return textNodes.length >= 2 ? textNodes.at(-1)?.textContent ?? null : null;
        })
        .filter((label): label is string => label !== null);
}

function getRenderedGroupXAxisLabelNodes() {
    return screen.getAllByTestId('activity-analytics-group-stack')
        .map((stack) => {
            const textNodes = Array.from(stack.querySelectorAll('text'));

            return textNodes.length >= 2 ? textNodes.at(-1) as SVGTextElement | null : null;
        })
        .filter((label): label is SVGTextElement => label !== null);
}

function createMatchMediaMock(matches: boolean): typeof window.matchMedia {
    return vi.fn().mockImplementation((query: string) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

class MockIntersectionObserver implements IntersectionObserver {
    private static instances: MockIntersectionObserver[] = [];

    private observedTargets: Element[] = [];

    public readonly root = null;

    public readonly rootMargin = '0px';

    public readonly thresholds = [0];

    public constructor(private readonly callback: IntersectionObserverCallback) {
        MockIntersectionObserver.instances.push(this);
    }

    public observe(target: Element): void {
        this.observedTargets.push(target);
    }

    public unobserve(): void {}

    public disconnect(): void {}

    public takeRecords(): IntersectionObserverEntry[] {
        return [];
    }

    public emit(isIntersecting: boolean, target: Element | null = this.observedTargets[0] ?? null): void {
        if (!target) {
            return;
        }

        this.callback([
            {
                target,
                isIntersecting,
                intersectionRatio: isIntersecting ? 1 : 0,
                boundingClientRect: target.getBoundingClientRect(),
                intersectionRect: isIntersecting ? target.getBoundingClientRect() : new DOMRectReadOnly(),
                rootBounds: null,
                time: 0,
            } as IntersectionObserverEntry,
        ], this);
    }

    public static latest(): MockIntersectionObserver {
        const instance = MockIntersectionObserver.instances.at(-1);

        if (!instance) {
            throw new Error('No IntersectionObserver instance was created');
        }

        return instance;
    }

    public static reset(): void {
        MockIntersectionObserver.instances = [];
    }
}

const prefetchQuery = vi.fn<(...args: unknown[]) => Promise<void>>();
const getQueryState = vi.fn();

function renderWithQueryClient(element: Parameters<typeof render>[0]) {
    return render(
        <QueryClientContext.Provider
            value={{
                prefetchQuery,
                getQueryState,
            } as never}
        >
            {element}
        </QueryClientContext.Provider>,
    );
}

function createActivitySeriesResult(overrides?: Partial<UseActivitySeriesResult>): UseActivitySeriesResult {
    return {
        data: null,
        isLoading: false,
        isError: false,
        error: null,
        isEnabled: true,
        isFetching: false,
        isPlaceholderData: false,
        isRefreshing: false,
        ...overrides,
    };
}

function setDocumentVisibilityState(state: DocumentVisibilityState) {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: state,
    });
    Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: state === 'hidden',
    });
}

function installVisibleIntersectionObserver() {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
}

function installImmediateIdleCallback() {
    vi.stubGlobal('requestIdleCallback', ((callback: IdleRequestCallback) => {
        callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
        return 1;
    }) as typeof requestIdleCallback);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
}

function collectPerformanceDiagnostics() {
    const events: Array<{ widgetId: string; event: string; reason?: string; durationMs?: number }> = [];
    const unsubscribe = subscribeActivityAnalyticsPerformanceDiagnostics((event) => {
        events.push(event);
    });

    return { events, unsubscribe };
}

function buildComputedSnapshot(label: string) {
    return {
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
        grouped: [buildGroupedBucket({ bucketKey: label, label, productivityLabel: label })],
        comparison: {
            best: { label, bucketKey: `${label}-best` },
            worst: { label, bucketKey: `${label}-worst` },
        },
        summaryRows: [{ label, productivityLabel: label, bucketKey: `${label}-row` }],
        timezone: 'UTC',
    } as never;
}

describe('ActivityAnalyticsWidget', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        MockResizeObserver.reset();
        MockIntersectionObserver.reset();
    });

    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        setDocumentVisibilityState('visible');
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
            font: '',
            measureText: (text: string) => ({ width: text.length * 8 }),
        } as unknown as CanvasRenderingContext2D);
        vi.mocked(isDataActivitySeriesEnabled).mockReturnValue(true);
        prefetchQuery.mockReset();
        getQueryState.mockReset();
        prefetchQuery.mockResolvedValue(undefined);
        getQueryState.mockReturnValue(undefined);
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: null, shifts: [] },
            shifts: [],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useActivitySeries).mockReturnValue(createActivitySeriesResult());
    });

    it('shows a missing-machine state before querying when the widget has no machine binding', () => {
        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ binding: { mode: 'real_variable', bindingVersion: 'node-red-v1' } })}
                machines={MACHINES}
            />,
        );

        expect(screen.getByText('Seleccione una máquina')).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-widget-runtime-state')).not.toHaveTextContent('Este widget necesita una máquina vinculada para consultar Activity-Series.');
        expect(screen.getByTestId('activity-analytics-widget-runtime-state').querySelector('svg')).toBeNull();
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
        expect(screen.getByTestId('activity-analytics-widget-runtime-state')).not.toHaveTextContent('La máquina configurada ya no coincide con el contrato disponible para Activity-Series.');
        expect(screen.getByTestId('activity-analytics-widget-runtime-state').querySelector('svg')).toBeNull();
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
        expect(within(screen.getByTestId('activity-analytics-summary-bars')).getByText('DISTRIBUCIÓN')).toBeInTheDocument();
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
        expect(screen.getByTestId('activity-analytics-widget-runtime-state').querySelector('svg')).toBeNull();
    });

    it('shows a no-connection fallback instead of invalid-machine when overview is unavailable', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: null,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: false,
        });

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget()}
                machines={[]}
                connection={{ globalStatus: 'unknown', lastSuccess: null, ageMs: null }}
                hasOverviewError
            />,
        );

        expect(screen.getByText('Sin conexión')).toBeInTheDocument();
        expect(screen.queryByText('Seleccione una máquina válida')).not.toBeInTheDocument();
        expect(screen.queryByText('No se pudo validar la máquina porque la fuente de datos no está disponible.')).not.toBeInTheDocument();
        expect(screen.getByText('Sin conexión')).not.toHaveClass('uppercase');
        expect(screen.getByTestId('activity-analytics-widget-runtime-state')).toHaveClass('flex', 'items-center', 'justify-center');
        expect(screen.getByTestId('activity-analytics-widget-runtime-state').querySelector('svg')).toBeNull();
    });

    it('keeps the loading state while overview is still loading and machine validation depends on overview machines', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: null,
            isLoading: false,
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
                        machineId: 'Reiner' as unknown as number,
                    },
                })}
                machines={[]}
                isLoadingOverview
            />,
        );

        expect(screen.getByTestId('activity-analytics-widget-runtime-state')).toHaveTextContent('Cargando_');
        expect(screen.queryByText('Sin conexión')).not.toBeInTheDocument();
        expect(screen.queryByText('Seleccione una máquina válida')).not.toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-widget-runtime-state').querySelector('svg')).toBeNull();
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
        expect(screen.getByTestId('activity-analytics-widget-runtime-state')).not.toHaveTextContent('Configure el endpoint Activity-Series para habilitar este widget.');
        expect(screen.getByTestId('activity-analytics-widget-runtime-state').querySelector('svg')).toBeNull();
    });

    it('shows a loading state while the activity-series query is pending', () => {
        vi.mocked(useActivitySeries).mockReturnValue(createActivitySeriesResult({
            isLoading: true,
        }));

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        expect(screen.getByTestId('activity-analytics-widget-runtime-state')).toHaveTextContent('Cargando_');
        expect(screen.getByTestId('activity-analytics-widget-runtime-state').querySelector('svg')).toBeNull();
    });

    it('keeps the initial loading state when there is no confirmed analytics snapshot yet', () => {
        vi.mocked(useActivitySeries).mockReturnValue(createActivitySeriesResult({
            isLoading: true,
        }));

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '30d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        expect(screen.getByTestId('activity-analytics-widget-runtime-state')).toHaveTextContent('Cargando_');
        expect(screen.queryByText('Mostrando la última vista confirmada')).not.toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('keeps the last confirmed analytics visible and marks them as refreshing while a new range is pending', () => {
        const activitySeriesState = {
            current: createActivitySeriesResult({
                data: POPULATED_ACTIVITY_SERIES,
            }),
        };

        vi.mocked(useActivitySeries).mockImplementation(() => activitySeriesState.current);
        vi.spyOn(activityAnalyticsComputation, 'computeActivityAnalytics').mockImplementation(({ range }) => buildComputedSnapshot(
            range === '7d' ? 'Visible snapshot 7d' : 'Requested snapshot 30d',
        ));

        const { rerender } = render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'shift' } })}
                machines={MACHINES}
            />,
        );

        expect(screen.getAllByText('Visible snapshot 7d').length).toBeGreaterThan(0);

        activitySeriesState.current = createActivitySeriesResult({
            data: POPULATED_ACTIVITY_SERIES,
            isFetching: true,
            isPlaceholderData: true,
            isRefreshing: true,
        });

        rerender(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '30d', groupBy: 'shift' } })}
                machines={MACHINES}
            />,
        );

        expect(screen.getAllByText('Visible snapshot 7d').length).toBeGreaterThan(0);
        expect(screen.queryByText('Requested snapshot 30d')).not.toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Actualizando');
        expect(screen.getByText('Mostrando la última vista confirmada')).toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-widget-runtime-state')).not.toBeInTheDocument();
    });

    it('closes an in-flight transition measurement when the widget identity resets mid-refresh', async () => {
        const diagnostics = collectPerformanceDiagnostics();
        const activitySeriesState = {
            current: createActivitySeriesResult({
                data: POPULATED_ACTIVITY_SERIES,
            }),
        };

        vi.mocked(useActivitySeries).mockImplementation(() => activitySeriesState.current);
        vi.spyOn(activityAnalyticsComputation, 'computeActivityAnalytics').mockImplementation(({ range }) => buildComputedSnapshot(
            range === '7d' ? 'Visible snapshot 7d' : 'Requested snapshot 30d',
        ));

        try {
            const { rerender } = render(
                <ActivityAnalyticsWidget
                    widget={makeWidget({ id: 'activity-analytics-1', displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'shift' } })}
                    machines={MACHINES}
                />,
            );

            activitySeriesState.current = createActivitySeriesResult({
                data: POPULATED_ACTIVITY_SERIES,
                isFetching: true,
                isPlaceholderData: true,
                isRefreshing: true,
            });

            rerender(
                <ActivityAnalyticsWidget
                    widget={makeWidget({ id: 'activity-analytics-1', displayOptions: { ...makeWidget().displayOptions, range: '30d', groupBy: 'shift' } })}
                    machines={MACHINES}
                />,
            );

            rerender(
                <ActivityAnalyticsWidget
                    widget={makeWidget({ id: 'activity-analytics-2', displayOptions: { ...makeWidget().displayOptions, range: '30d', groupBy: 'shift' } })}
                    machines={MACHINES}
                />,
            );

            await waitFor(() => expect(diagnostics.events.some((event) => event.event === 'transition_measured' && event.reason === 'widget_reset')).toBe(true));
        } finally {
            diagnostics.unsubscribe();
        }
    });

    it('keeps the last confirmed analytics visible and shows a refresh-failed alert when the new range fails', () => {
        const activitySeriesState = {
            current: createActivitySeriesResult({
                data: POPULATED_ACTIVITY_SERIES,
            }),
        };

        vi.mocked(useActivitySeries).mockImplementation(() => activitySeriesState.current);
        vi.spyOn(activityAnalyticsComputation, 'computeActivityAnalytics').mockImplementation(({ range }) => buildComputedSnapshot(
            range === '7d' ? 'Visible snapshot 7d' : 'Requested snapshot 30d',
        ));

        const { rerender } = render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'shift' } })}
                machines={MACHINES}
            />,
        );

        expect(screen.getAllByText('Visible snapshot 7d').length).toBeGreaterThan(0);

        activitySeriesState.current = createActivitySeriesResult({
            data: POPULATED_ACTIVITY_SERIES,
            isError: true,
            error: new DataServiceError('Activity-series data is temporarily unavailable', 503),
        });

        rerender(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '30d', groupBy: 'shift' } })}
                machines={MACHINES}
            />,
        );

        expect(screen.getAllByText('Visible snapshot 7d').length).toBeGreaterThan(0);
        expect(screen.queryByText('Requested snapshot 30d')).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('No se pudo actualizar');
        expect(screen.getByText('Se mantiene la última vista confirmada')).toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-widget-runtime-state')).not.toBeInTheDocument();
    });

    it('prefetches at most two preset ranges when the widget is visible and healthy', async () => {
        installVisibleIntersectionObserver();
        installImmediateIdleCallback();

        const diagnostics = collectPerformanceDiagnostics();
        vi.mocked(useActivitySeries).mockReturnValue(createActivitySeriesResult({
            data: POPULATED_ACTIVITY_SERIES,
        }));

        try {
            renderWithQueryClient(
                <ActivityAnalyticsWidget
                    widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'shift' } })}
                    machines={MACHINES}
                />,
            );

            act(() => {
                MockIntersectionObserver.latest().emit(true);
            });

            await waitFor(() => expect(prefetchQuery).toHaveBeenCalledTimes(2));

            expect(prefetchQuery.mock.calls.map(([options]) => (options as { queryKey: readonly unknown[] }).queryKey[3])).toEqual(['30d', '12m']);
            expect(diagnostics.events.filter((event) => event.event === 'prefetch_started')).toHaveLength(2);
        } finally {
            diagnostics.unsubscribe();
        }
    });

    it('keeps temporal interactions on read-only runtime paths while bounding demanded requests to the active selection', async () => {
        const user = userEvent.setup();
        const onPersistDisplayOptions = vi.fn();
        const directFetch = vi.fn();
        const requestedSelections: string[] = [];

        vi.stubGlobal('fetch', directFetch);
        vi.mocked(useActivitySeries).mockImplementation((params) => {
            requestedSelections.push(JSON.stringify(params));

            return createActivitySeriesResult({
                data: POPULATED_ACTIVITY_SERIES,
            });
        });

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
                onPersistDisplayOptions={onPersistDisplayOptions}
            />,
        );

        await user.click(within(screen.getByTestId('activity-analytics-runtime-range-selector')).getByRole('button', { name: '30d' }));
        await user.click(within(screen.getByTestId('activity-analytics-runtime-group-selector')).getByRole('button', { name: 'SEMANA' }));

        expect(onPersistDisplayOptions).toHaveBeenCalledTimes(1);
        expect(onPersistDisplayOptions).toHaveBeenCalledWith({
            range: '30d',
            start: undefined,
            end: undefined,
        });
        expect(Array.from(new Set(requestedSelections))).toEqual([
            JSON.stringify({ machineId: 101, range: '7d' }),
            JSON.stringify({ machineId: 101, range: '30d' }),
        ]);
        expect(directFetch).not.toHaveBeenCalled();
    });

    it('keeps idle prefetch on the read-only query path with a max-two request cap', async () => {
        installVisibleIntersectionObserver();
        installImmediateIdleCallback();

        const directFetch = vi.fn();

        vi.stubGlobal('fetch', directFetch);
        vi.mocked(useActivitySeries).mockReturnValue(createActivitySeriesResult({
            data: POPULATED_ACTIVITY_SERIES,
        }));

        renderWithQueryClient(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'shift' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            MockIntersectionObserver.latest().emit(true);
        });

        await waitFor(() => expect(prefetchQuery).toHaveBeenCalledTimes(2));

        expect(prefetchQuery.mock.calls.map(([options]) => (options as { queryKey: readonly unknown[] }).queryKey)).toEqual([
            ['data', 'activity-series', 101, '30d', null, null],
            ['data', 'activity-series', 101, '12m', null, null],
        ]);
        expect(directFetch).not.toHaveBeenCalled();
    });

    it('never prefetches custom windows even when the widget is visible and healthy', async () => {
        installVisibleIntersectionObserver();
        installImmediateIdleCallback();

        const diagnostics = collectPerformanceDiagnostics();
        vi.mocked(useActivitySeries).mockReturnValue(createActivitySeriesResult({
            data: POPULATED_ACTIVITY_SERIES,
        }));

        try {
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

            act(() => {
                MockIntersectionObserver.latest().emit(true);
            });

            await waitFor(() => expect(diagnostics.events.some((event) => event.reason === 'custom_range')).toBe(true));
            expect(prefetchQuery).not.toHaveBeenCalled();
        } finally {
            diagnostics.unsubscribe();
        }
    });

    it('fails closed when visibility observation is unavailable', async () => {
        const diagnostics = collectPerformanceDiagnostics();
        vi.mocked(useActivitySeries).mockReturnValue(createActivitySeriesResult({
            data: POPULATED_ACTIVITY_SERIES,
        }));

        try {
            render(
                <ActivityAnalyticsWidget
                    widget={makeWidget()}
                    machines={MACHINES}
                />,
            );

            await waitFor(() => expect(diagnostics.events.some((event) => event.reason === 'visibility_unavailable')).toBe(true));
            expect(prefetchQuery).not.toHaveBeenCalled();
        } finally {
            diagnostics.unsubscribe();
        }
    });

    it.each([
        {
            name: 'hidden widgets',
            arrange: () => {
                installVisibleIntersectionObserver();
                installImmediateIdleCallback();
            },
            emitVisibility: false,
            activitySeries: createActivitySeriesResult({ data: POPULATED_ACTIVITY_SERIES }),
            expectedReason: 'hidden',
        },
        {
            name: 'hidden documents',
            arrange: () => {
                installVisibleIntersectionObserver();
                installImmediateIdleCallback();
                setDocumentVisibilityState('hidden');
            },
            emitVisibility: true,
            activitySeries: createActivitySeriesResult({ data: POPULATED_ACTIVITY_SERIES }),
            expectedReason: 'document_hidden',
        },
        {
            name: 'unhealthy connections',
            arrange: () => {
                installVisibleIntersectionObserver();
                installImmediateIdleCallback();
            },
            emitVisibility: true,
            activitySeries: createActivitySeriesResult({ data: POPULATED_ACTIVITY_SERIES }),
            connection: { globalStatus: 'degradado' as const, lastSuccess: '2026-04-21T13:00:00.000Z', ageMs: 0 },
            expectedReason: 'unhealthy',
        },
        {
            name: 'offline connections',
            arrange: () => {
                installVisibleIntersectionObserver();
                installImmediateIdleCallback();
            },
            emitVisibility: true,
            activitySeries: createActivitySeriesResult({ data: POPULATED_ACTIVITY_SERIES }),
            connection: { globalStatus: 'offline' as const, lastSuccess: null, ageMs: null },
            expectedReason: 'offline',
        },
        {
            name: 'loading queries',
            arrange: () => {
                installVisibleIntersectionObserver();
                installImmediateIdleCallback();
            },
            emitVisibility: null,
            activitySeries: createActivitySeriesResult({ isLoading: true }),
            expectedReason: null,
        },
        {
            name: 'errored queries',
            arrange: () => {
                installVisibleIntersectionObserver();
                installImmediateIdleCallback();
            },
            emitVisibility: true,
            activitySeries: createActivitySeriesResult({
                data: POPULATED_ACTIVITY_SERIES,
                isError: true,
                error: new DataServiceError('Activity-series data is temporarily unavailable', 503),
            }),
            expectedReason: 'error',
        },
    ])('suppresses bounded idle prefetch for $name', async ({ arrange, emitVisibility, activitySeries, connection, expectedReason }) => {
        arrange();
        const diagnostics = collectPerformanceDiagnostics();
        vi.mocked(useActivitySeries).mockReturnValue(activitySeries);

        try {
            render(
                <ActivityAnalyticsWidget
                    widget={makeWidget()}
                    machines={MACHINES}
                    connection={connection}
                />,
            );

            if (typeof emitVisibility === 'boolean') {
                act(() => {
                    MockIntersectionObserver.latest().emit(emitVisibility);
                });
            }

            if (expectedReason) {
                await waitFor(() => expect(diagnostics.events.some((event) => event.reason === expectedReason)).toBe(true));
            }
            expect(prefetchQuery).not.toHaveBeenCalled();
        } finally {
            diagnostics.unsubscribe();
        }
    });

    it('suppresses bounded idle prefetch when activity-analytics sibling pressure is high', async () => {
        installVisibleIntersectionObserver();
        installImmediateIdleCallback();

        const diagnostics = collectPerformanceDiagnostics();
        const siblingWidgets: WidgetConfig[] = [
            makeWidget({ id: 'activity-analytics-1' }),
            makeWidget({ id: 'activity-analytics-2' }),
            makeWidget({ id: 'activity-analytics-3' }),
        ];

        vi.mocked(useActivitySeries).mockReturnValue(createActivitySeriesResult({
            data: POPULATED_ACTIVITY_SERIES,
        }));

        try {
            render(
                <ActivityAnalyticsWidget
                    widget={makeWidget()}
                    machines={MACHINES}
                    siblingWidgets={siblingWidgets}
                />,
            );

            act(() => {
                MockIntersectionObserver.latest().emit(true);
            });

            await waitFor(() => expect(diagnostics.events.some((event) => event.reason === 'dashboard_pressure')).toBe(true));
            expect(prefetchQuery).not.toHaveBeenCalled();
        } finally {
            diagnostics.unsubscribe();
        }
    });

    it('counts the current widget when sibling pressure input only contains peer widgets', async () => {
        installVisibleIntersectionObserver();
        installImmediateIdleCallback();

        const diagnostics = collectPerformanceDiagnostics();
        const siblingWidgets: WidgetConfig[] = [
            makeWidget({ id: 'activity-analytics-peer-1' }),
            makeWidget({ id: 'activity-analytics-peer-2' }),
        ];

        vi.mocked(useActivitySeries).mockReturnValue(createActivitySeriesResult({
            data: POPULATED_ACTIVITY_SERIES,
        }));

        try {
            renderWithQueryClient(
                <ActivityAnalyticsWidget
                    widget={makeWidget({ id: 'activity-analytics-self' })}
                    machines={MACHINES}
                    siblingWidgets={siblingWidgets}
                />,
            );

            act(() => {
                MockIntersectionObserver.latest().emit(true);
            });

            await waitFor(() => expect(diagnostics.events.some((event) => event.reason === 'dashboard_pressure')).toBe(true));
            expect(prefetchQuery).not.toHaveBeenCalled();
        } finally {
            diagnostics.unsubscribe();
        }
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
        expect(screen.getByTestId('activity-analytics-widget-runtime-state')).not.toHaveTextContent('Prod. debe ser mayor que Setup para clasificar la actividad.');
        expect(screen.getByTestId('activity-analytics-widget-runtime-state').querySelector('svg')).toBeNull();
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

        expect(screen.getByRole('button', { name: 'TURNO' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getAllByText('Agrupación runtime: shift').length).toBeGreaterThan(0);
        expect(screen.getByTestId('activity-analytics-summary-bars')).toHaveTextContent('88%');
        expect(screen.getByTestId('activity-analytics-comparison')).toHaveTextContent('sin comparación');

        const runtimeGroupSelector = screen.getByTestId('activity-analytics-runtime-group-selector');

        expect(within(runtimeGroupSelector).getByRole('button', { name: 'TURNO' })).toBeInTheDocument();
        expect(within(runtimeGroupSelector).getByRole('button', { name: 'DÍA' })).toBeInTheDocument();
        expect(within(runtimeGroupSelector).getByRole('button', { name: 'SEMANA' })).toBeDisabled();
        expect(within(runtimeGroupSelector).getByRole('button', { name: 'SEMANA' })).toHaveAttribute('aria-disabled', 'true');
        expect(within(runtimeGroupSelector).getByRole('button', { name: 'MES' })).toBeDisabled();

        expect(screen.queryByRole('button', { name: '1h' })).not.toBeInTheDocument();

        expect(screen.getByRole('button', { name: 'TURNO' })).toHaveAttribute('aria-pressed', 'true');
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

        expect(screen.getByRole('button', { name: 'DÍA' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getAllByText('Agrupación runtime: day').length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: 'TURNO' })).toBeInTheDocument();
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

        expect(screen.getByRole('button', { name: 'TURNO' })).toHaveAttribute('aria-pressed', 'true');

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

        expect(screen.getByRole('button', { name: 'TURNO' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'DÍA' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'SEMANA' })).toBeDisabled();
        expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Hasta')).not.toBeInTheDocument();
    });

    it('renders the header icon on the left and keeps range buttons before granularity buttons in a single runtime header row', () => {
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

        const runtimeControls = screen.getByTestId('activity-analytics-runtime-controls');
        const groupSelector = screen.getByTestId('activity-analytics-runtime-group-selector');
        const rangeSelector = screen.getByTestId('activity-analytics-runtime-range-selector');
        const headerIcon = screen.getByTestId('activity-analytics-widget-header-icon');
        const headerTitle = screen.getByText('Análisis de Actividad');

        expect(headerIcon.compareDocumentPosition(headerTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(runtimeControls.className).not.toContain('absolute');
        expect(runtimeControls.children).toHaveLength(2);
        expect(runtimeControls.children[0]).toBe(rangeSelector);
        expect(runtimeControls.children[1]).toBe(groupSelector);
        expect(rangeSelector).toHaveClass('gap-0');
        expect(groupSelector).toHaveClass('gap-0', 'border-industrial-muted/25');
        expect(within(runtimeControls).getAllByRole('button').map((button) => button.textContent)).toEqual([
            '7d',
            '30d',
            '12m',
            'TURNO',
            'DÍA',
            'SEMANA',
            'MES',
        ]);
        expect(within(groupSelector).getByRole('button', { name: 'TURNO' })).toBeInTheDocument();
        expect(within(groupSelector).getByRole('button', { name: 'DÍA' })).toBeInTheDocument();
        expect(within(groupSelector).getByRole('button', { name: 'SEMANA' })).toBeDisabled();
        expect(within(groupSelector).getByRole('button', { name: 'MES' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: '1h' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Custom' })).not.toBeInTheDocument();
    });

    it('renders ACT pill-selected temporal selectors without underline and keeps disabled default cursor', () => {
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

        const activeRangeButton = screen.getByRole('button', { name: '7d' });
        const activeRangeIndicator = within(activeRangeButton).getByTestId('activity-analytics-runtime-control-indicator');
        const activeGroupButton = screen.getByRole('button', { name: 'DÍA' });
        const activeGroupIndicator = within(activeGroupButton).getByTestId('activity-analytics-runtime-control-indicator');
        const disabledGroupButton = screen.getByRole('button', { name: 'SEMANA' });
        const disabledGroupIndicator = within(disabledGroupButton).getByTestId('activity-analytics-runtime-control-indicator');
        const activeRangeLabel = within(activeRangeButton).getByText('7d');
        const activeGroupLabel = within(activeGroupButton).getByText('DÍA');

        expect(activeRangeButton).toHaveClass('group/control', 'rounded-md', 'border-admin-accent/30', 'bg-admin-accent/10', 'px-2', 'py-1', 'text-admin-accent');
        expect(activeRangeButton).not.toHaveClass('text-industrial-text', 'text-industrial-muted');
        expect(activeRangeLabel).toHaveClass('translate-y-[1.5px]');
        expect(activeRangeIndicator).toHaveClass('h-[1.5px]', 'w-1/4', 'min-w-[0.45rem]', 'bg-transparent');
        expect(activeRangeIndicator).not.toHaveClass('bg-current', 'group-hover/control:bg-current', 'group-focus-visible/control:bg-current');
        expect(activeGroupButton).toHaveClass('group/control', 'rounded-md', 'border-admin-accent/30', 'bg-admin-accent/10', 'px-2', 'py-1', 'text-admin-accent');
        expect(activeGroupButton).not.toHaveClass('text-industrial-text', 'text-industrial-muted');
        expect(activeGroupLabel).toHaveClass('translate-y-[1.5px]');
        expect(activeGroupIndicator).toHaveClass('bg-transparent');
        expect(activeGroupIndicator).not.toHaveClass('bg-current', 'group-hover/control:bg-current', 'group-focus-visible/control:bg-current');
        expect(disabledGroupButton).toHaveClass('cursor-default', 'text-industrial-muted/50');
        expect(disabledGroupButton).not.toHaveClass('disabled:cursor-not-allowed');
        expect(disabledGroupIndicator).toHaveClass('bg-transparent');
    });

    it('keeps all granularity buttons visible and disables unavailable ones for each range', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        const { rerender } = render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        const expectAvailability = (expected: Record<'TURNO' | 'DÍA' | 'SEMANA' | 'MES', boolean>) => {
            (Object.entries(expected) as Array<[keyof typeof expected, boolean]>).forEach(([label, enabled]) => {
                const button = screen.getByRole('button', { name: label });

                expect(button).toBeInTheDocument();
                if (enabled) {
                    expect(button).toBeEnabled();
                } else {
                    expect(button).toBeDisabled();
                }
            });
        };

        expectAvailability({ TURNO: true, DÍA: true, SEMANA: false, MES: false });

        rerender(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '30d', groupBy: 'week' } })}
                machines={MACHINES}
            />,
        );

        expectAvailability({ TURNO: true, DÍA: true, SEMANA: true, MES: false });

        rerender(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '12m', groupBy: 'month' } })}
                machines={MACHINES}
            />,
        );

        expectAvailability({ TURNO: true, DÍA: false, SEMANA: false, MES: true });
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

        expect(screen.getAllByText('19/06 · Turno C').length).toBeGreaterThan(0);
        expect(screen.queryByText('20/06 · sin turno')).not.toBeInTheDocument();
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

        expect(screen.getAllByText('19/06 · Turno Tarde').length).toBeGreaterThan(0);
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
                    label: '18/06',
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
                    label: '19/06',
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
                best: { label: '18/06', bucketKey: 'day-1' },
                worst: { label: '19/06', bucketKey: 'day-2' },
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
            emitActivityAnalyticsLayoutSize({ bodyWidth: 520, bodyHeight: CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX });
        });

        expect(within(screen.getByTestId('activity-analytics-summary-bars')).getByText('DISTRIBUCIÓN')).toBeInTheDocument();
        expect(screen.queryByText('Extrusora 101')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-kpis')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('activity-analytics-comparison-bar-track')).toHaveLength(2);
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
        expect(screen.getAllByText('18/06').length).toBeGreaterThan(0);

        const summaryPanel = screen.getByTestId('activity-analytics-summary-bars');
        const comparisonPanel = screen.getByTestId('activity-analytics-comparison');
        const prodTrendPanel = screen.getByTestId('activity-analytics-prod-trend');
        const groupsPanel = screen.getByTestId('activity-analytics-groups');
        const topRegion = screen.getByTestId('activity-analytics-top-region');
        const summarySegments = screen.getAllByTestId('activity-analytics-summary-segment');
        const firstGroupStack = screen.getAllByTestId('activity-analytics-group-stack')[0];
        const groupSegments = within(firstGroupStack).getAllByTestId('activity-analytics-group-segment');
        const topCaps = within(firstGroupStack).queryAllByTestId('activity-analytics-group-top-cap');
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
            { fill: '#94a3b8', segmentKey: 'noData' },
            { fill: /^url\(#.+-stopped-gradient\)$/, segmentKey: 'stopped' },
            { fill: /^url\(#.+-setup-gradient\)$/, segmentKey: 'setup' },
            { fill: /^url\(#.+-prod-gradient\)$/, segmentKey: 'prod' },
        ]);
        expect(topCaps).toHaveLength(0);
        topCaps.forEach((cap) => {
            expect(cap).toHaveAttribute('rx', '0');
            expect(Number(cap.getAttribute('height'))).toBeGreaterThan(0);
            expect(cap.getAttribute('style')).toContain('drop-shadow');
        });
        expect(detailTitles).toEqual([
            'Producción',
            'Setup',
            'Detenida',
            'Cobertura',
        ]);
        const groupsHeaderLegend = within(groupsPanel).getByTestId('activity-analytics-groups-header-legend');
        expect(within(groupsHeaderLegend).getAllByText(/^(Det\.|Setup|Prod\.)$/).map((item) => item.textContent)).toEqual([
            'Det.',
            'Setup',
            'Prod.',
        ]);
        expect(within(groupsPanel).queryByTestId('activity-analytics-panel-heading-value')).not.toBeInTheDocument();
        expect(screen.queryAllByTestId('activity-analytics-summary-segment-label')).toHaveLength(0);
        expect(summaryPanel).toHaveClass('border-industrial-border');
        expect(within(summaryPanel).getByTestId('activity-analytics-summary-coverage')).toHaveTextContent('100%');
        expect(within(summaryPanel).queryByText('% Prod. 57% · Cobertura 100%')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-summary-panel')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('activity-analytics-comparison-percent').map((node) => node.textContent)).toEqual(['60%', '50%']);
        expect(screen.queryByTestId('activity-analytics-comparison-context')).not.toBeInTheDocument();
        expect(comparisonPanel).not.toHaveTextContent('Cobertura completa');
        expect(comparisonPanel).not.toHaveTextContent(/Observado · Cob\./);
        expect(comparisonPanel).toHaveClass('border-industrial-border');
        expect(screen.queryByTestId('activity-analytics-comparison-scale')).not.toBeInTheDocument();
        screen.getAllByTestId('activity-analytics-comparison-bar-track').forEach((track) => {
            expect(track).toHaveClass('bg-white/5');
            expect(track).toHaveClass('rounded-full');
            expect(track).toHaveClass('w-2');
        });
        expect(screen.getAllByTestId('activity-analytics-metric-value').map((node) => node.textContent)).toEqual(['18/06', '19/06']);

        expect(topRegion).toContainElement(summaryPanel);
        expect(topRegion).toContainElement(comparisonPanel);
        expect(topRegion).toHaveAttribute('data-top-layout', 'side-by-side');
        expect(topRegion).toHaveAttribute('data-top-gap-px', '12.00');
        expect(topRegion).toHaveClass('gap-3');
        expect(prodTrendPanel).toHaveTextContent('TENDENCIA % PROD');
        expect(topRegion).not.toContainElement(groupsPanel);
        expect(topRegion.compareDocumentPosition(prodTrendPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(prodTrendPanel.compareDocumentPosition(groupsPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(topRegion.compareDocumentPosition(groupsPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(Number(summaryChart.getAttribute('width'))).toBeLessThan(640);
    });

    it('renders the % PROD trend with a fixed 0-100 domain and keeps groups below it', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'day-1', label: '18/06', productivityRatio: 0.8, productivityLabel: '80%' }),
            buildGroupedBucket({ bucketKey: 'day-2', label: '19/06', productivityRatio: 0.55, productivityLabel: '55%' }),
            buildGroupedBucket({ bucketKey: 'day-3', label: '20/06', productivityRatio: 0.7, productivityLabel: '70%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'day',
                        stateGradients: CUSTOM_STATE_GRADIENTS,
                    },
                })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        const trendChart = screen.getByTestId('activity-analytics-prod-trend-chart');

        expect(trendChart).toHaveAttribute('data-y-domain-min', '0');
        expect(trendChart).toHaveAttribute('data-y-domain-max', '100');
        expect(screen.getAllByTestId('activity-analytics-prod-trend-y-axis-tick').map((node) => node.textContent)).toEqual([
            '100%',
            '75%',
            '50%',
            '25%',
            '0%',
        ]);
        expect(screen.getAllByTestId('activity-analytics-prod-trend-line').length).toBeGreaterThan(0);
        expect(screen.getAllByTestId('activity-analytics-prod-trend-area').length).toBeGreaterThan(0);
        expect(screen.getByTestId('activity-analytics-prod-trend').compareDocumentPosition(screen.getByTestId('activity-analytics-groups')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        expect(parseNumericCsvAttribute(trendChart.getAttribute('data-productivity-ratio'))).toEqual([0.8, 0.55, 0.7]);
        expect(parseNumericCsvAttribute(trendChart.getAttribute('data-renderable-point-y'))).toEqual([7.2, 11.2, 8.8]);
    });

    it('inverts the % PROD trend gradient direction and keeps the endpoint marker family aligned with the line end color', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'day-1', label: '18/06', productivityRatio: 0.8, productivityLabel: '80%' }),
            buildGroupedBucket({ bucketKey: 'day-2', label: '19/06', productivityRatio: 0.55, productivityLabel: '55%' }),
            buildGroupedBucket({ bucketKey: 'day-3', label: '20/06', productivityRatio: 0.7, productivityLabel: '70%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'day',
                        stateGradients: CUSTOM_STATE_GRADIENTS,
                    },
                })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 800 });
        });

        const trendChart = screen.getByTestId('activity-analytics-prod-trend-chart');
        const lineStops = getGradientStopsByIdSuffix(trendChart, 'prod-trend-line-gradient');
        const areaStops = getGradientStopsByIdSuffix(trendChart, 'prod-trend-area-gradient');
        const latestValueLabel = screen.getByTestId('activity-analytics-prod-trend-latest-value-label');
        const latestPointPulse = screen.getByTestId('activity-analytics-prod-trend-final-point-pulse');
        const latestPointAura = screen.getByTestId('activity-analytics-prod-trend-final-point-aura');
        const latestPointHalo = screen.getByTestId('activity-analytics-prod-trend-final-point-halo');
        const latestPointCore = screen.getByTestId('activity-analytics-prod-trend-final-point-core');
        const overlaySvg = screen.getByTestId('activity-analytics-prod-trend-overlay-svg');
        const overlayHeight = Number(trendChart.getAttribute('height')) + 20;

        expect(lineStops.map((stop) => stop.getAttribute('stop-color'))).toEqual(reverseGradientStops(CUSTOM_STATE_GRADIENTS.prod));
        expect(areaStops.map((stop) => stop.getAttribute('stop-color'))).toEqual(reverseGradientStops(CUSTOM_STATE_GRADIENTS.prod));
        expect(overlaySvg).toHaveClass('pointer-events-none', 'absolute', 'left-0');
        expect(overlaySvg).toHaveStyle({ top: '-20px', overflow: 'visible' });
        expect(overlaySvg).toHaveAttribute('viewBox', `0 -20 640 ${overlayHeight}`);
        expect(screen.getByTestId('activity-analytics-prod-trend-latest-point-overlay')).not.toHaveAttribute('clip-path');
        expect(latestPointPulse.closest('svg')).toBe(overlaySvg);
        expect(latestValueLabel.closest('svg')).toBe(overlaySvg);
        expect(latestValueLabel).toHaveAttribute('data-label-placement', 'below');
        expect(Number(latestValueLabel.getAttribute('y'))).toBeGreaterThan(Number(latestPointCore.getAttribute('cy')));
        expect(trendChart).not.toContainElement(latestPointPulse);
        expect(trendChart).not.toContainElement(latestValueLabel);
        expect(latestValueLabel).toHaveAttribute('fill', CUSTOM_STATE_GRADIENTS.prod[0]);
        expect(latestPointPulse).toHaveAttribute('fill', CUSTOM_STATE_GRADIENTS.prod[0]);
        expect(latestPointAura.getAttribute('fill')).toMatch(/^url\(#.+-prod-trend-traveling-glow-aura\)$/);
        expect(latestPointHalo.getAttribute('fill')).toMatch(/^url\(#.+-prod-trend-traveling-glow-aura\)$/);
        expect(latestPointAura).toHaveClass('activity-analytics-prod-trend-final-point-flicker', 'activity-analytics-prod-trend-final-point-flicker-aura');
        expect(latestPointHalo).toHaveClass('activity-analytics-prod-trend-final-point-flicker', 'activity-analytics-prod-trend-final-point-flicker-halo');
        expect(latestPointCore).toHaveAttribute('fill', CUSTOM_STATE_GRADIENTS.prod[0]);
        expect(latestPointCore).toHaveAttribute('stroke', CUSTOM_STATE_GRADIENTS.prod[1]);

        fireEvent.mouseEnter(screen.getAllByTestId('activity-analytics-prod-trend-hit-area')[1]!);

        expect(screen.getByTestId('activity-analytics-prod-trend-hover-point')).toHaveAttribute('fill', CUSTOM_STATE_GRADIENTS.prod[0]);
    });

    it('uses the accepted grouped tooltip glass panel style for the % PROD trend tooltip', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'day-1', label: '2026-06-18', productivityRatio: 0.8, productivityLabel: '80%' }),
            buildGroupedBucket({ bucketKey: 'day-2', label: '2026-06-19', productivityRatio: 0.55, productivityLabel: '55%' }),
            buildGroupedBucket({ bucketKey: 'day-3', label: '2026-06-20', productivityRatio: 0.7, productivityLabel: '70%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'day',
                        stateGradients: CUSTOM_STATE_GRADIENTS,
                    },
                })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        const firstHitArea = screen.getAllByTestId('activity-analytics-prod-trend-hit-area')[0]!;

        expect(firstHitArea).toHaveAttribute('cursor', 'crosshair');

        fireEvent.mouseEnter(firstHitArea);

        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('2026-06-18');
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Prod.');
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('80%');
        expect(screen.getByTestId('activity-analytics-prod-trend-hover-guide')).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-prod-trend-hover-guide')).toHaveAttribute('stroke-dasharray', '4 3');
        expect(screen.getByTestId('activity-analytics-prod-trend-hover-point')).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-prod-trend-hover-point')).toHaveAttribute('data-bucket-key', 'day-1');
        expect(screen.getByTestId('chart-tooltip')).toHaveClass(
            'rounded-lg',
            'border',
            'border-industrial-border',
            'bg-[linear-gradient(135deg,rgba(9,13,22,0.57)_0%,rgba(17,24,39,0.52)_100%)]',
            'px-3',
            'py-2',
            'shadow-lg',
            'backdrop-blur-sm',
        );
        expect(screen.getByTestId('chart-tooltip')).not.toHaveClass('glass-panel');
        expect(screen.getByTestId('chart-tooltip')).toHaveAttribute('data-label-class', 'mb-1 whitespace-nowrap text-industrial-muted');
    });

    it('renders a non-interactive traveling glow that follows the measured % PROD trend path when enough points exist', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'day-1', label: '2026-06-18', productivityRatio: 0.42, productivityLabel: '42%' }),
            buildGroupedBucket({ bucketKey: 'day-2', label: '2026-06-19', productivityRatio: 0.58, productivityLabel: '58%' }),
            buildGroupedBucket({ bucketKey: 'day-3', label: '2026-06-20', productivityRatio: 0.74, productivityLabel: '74%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'day',
                        stateGradients: CUSTOM_STATE_GRADIENTS,
                    },
                })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        const trendLine = screen.getByTestId('activity-analytics-prod-trend-line');
        const travelingGlow = screen.getByTestId('activity-analytics-prod-trend-traveling-glow');
        const travelingGlowAura = screen.getByTestId('activity-analytics-prod-trend-traveling-glow-aura');
        const travelingGlowHalo = screen.getByTestId('activity-analytics-prod-trend-traveling-glow-halo');
        const travelingGlowCore = screen.getByTestId('activity-analytics-prod-trend-traveling-glow-core');
        const latestPointAura = screen.getByTestId('activity-analytics-prod-trend-final-point-aura');
        const latestPointHalo = screen.getByTestId('activity-analytics-prod-trend-final-point-halo');
        const latestPointCore = screen.getByTestId('activity-analytics-prod-trend-final-point-core');

        expect(travelingGlow).toHaveAttribute('pointer-events', 'none');
        expect(travelingGlow).toHaveAttribute('aria-hidden', 'true');
        expect(travelingGlow).toHaveStyle({ mixBlendMode: 'screen' });
        expect(trendLine.getAttribute('id')).toBeTruthy();
        expect(travelingGlow).toHaveAttribute('data-path-id', trendLine.getAttribute('id'));
        expect(travelingGlow).toHaveAttribute('data-cycle-key', '0');
        expect(Number(travelingGlowAura.getAttribute('cx'))).toBeGreaterThan(0);
        expect(Number(travelingGlowAura.getAttribute('cy'))).toBeGreaterThan(0);
        expect(travelingGlowAura.getAttribute('fill')).toMatch(/^url\(#.+-prod-trend-traveling-glow-aura\)$/);
        expect(travelingGlowHalo.getAttribute('fill')).toMatch(/^url\(#.+-prod-trend-traveling-glow-aura\)$/);
        expect(travelingGlowHalo.getAttribute('filter')).toMatch(/^url\(#.+-prod-trend-traveling-glow\)$/);
        expect(latestPointAura.getAttribute('fill')).toBe(travelingGlowAura.getAttribute('fill'));
        expect(latestPointHalo.getAttribute('fill')).toBe(travelingGlowHalo.getAttribute('fill'));
        expect(latestPointHalo.getAttribute('filter')).toBe(travelingGlowHalo.getAttribute('filter'));
        expect(travelingGlowCore).toHaveAttribute('fill', latestPointCore.getAttribute('fill'));
        expect(travelingGlowCore).toHaveAttribute('stroke', latestPointCore.getAttribute('stroke'));
        expect(travelingGlowAura).toHaveAttribute('data-duration', '0.92s');
        expect(travelingGlowHalo).toHaveAttribute('data-motion-duration', '0.92s');
        expect(travelingGlowCore).toHaveAttribute('data-duration', '0.92s');
        expect(Number(travelingGlowAura.getAttribute('data-opacity'))).toBeGreaterThan(0);
        expect(Number(travelingGlowHalo.getAttribute('data-opacity'))).toBeGreaterThan(0);
        expect(Number(travelingGlowCore.getAttribute('data-opacity'))).toBeGreaterThan(0);
    });

    it('clamps the traveling glow duration to the configured maximum for long PROD trend paths', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics(Array.from({ length: 30 }, (_, index) => buildGroupedBucket({
            bucketKey: `day-${index + 1}`,
            label: `2026-06-${String(index + 1).padStart(2, '0')}`,
            productivityRatio: 0.25 + ((index % 5) * 0.15),
            productivityLabel: `${25 + ((index % 5) * 15)}%`,
        })));

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '30d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 848, bodyHeight: 420 });
        });

        const travelingGlowAura = screen.getByTestId('activity-analytics-prod-trend-traveling-glow-aura');
        const travelingGlowHalo = screen.getByTestId('activity-analytics-prod-trend-traveling-glow-halo');
        const travelingGlowCore = screen.getByTestId('activity-analytics-prod-trend-traveling-glow-core');

        expect(travelingGlowAura).toHaveAttribute('data-duration', '3.2s');
        expect(travelingGlowHalo).toHaveAttribute('data-motion-duration', '3.2s');
        expect(travelingGlowCore).toHaveAttribute('data-duration', '3.2s');
    });

    it('shows the traveling glow immediately on mount when a usable PROD trend path exists', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

        const scheduledTimeouts: Array<{ callback: () => void; delay: number }> = [];

        vi.spyOn(window, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number) => {
            if (typeof callback === 'function') {
                scheduledTimeouts.push({
                    callback: callback as () => void,
                    delay: Number(delay ?? 0),
                });
            }

            return scheduledTimeouts.length as unknown as number;
        }) as typeof window.setTimeout);
        vi.spyOn(window, 'clearTimeout').mockImplementation(() => undefined);

        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'day-1', label: '2026-06-18', productivityRatio: 0.42, productivityLabel: '42%' }),
            buildGroupedBucket({ bucketKey: 'day-2', label: '2026-06-19', productivityRatio: 0.58, productivityLabel: '58%' }),
            buildGroupedBucket({ bucketKey: 'day-3', label: '2026-06-20', productivityRatio: 0.74, productivityLabel: '74%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        const travelingGlow = screen.getByTestId('activity-analytics-prod-trend-traveling-glow');
        expect(travelingGlow).toBeInTheDocument();
        expect(Number(screen.getByTestId('activity-analytics-prod-trend-traveling-glow-aura').getAttribute('data-opacity'))).toBeGreaterThan(0);
        expect(scheduledTimeouts.map(({ delay }) => delay)).toContain(920);
        expect(scheduledTimeouts.map(({ delay }) => delay)).toContain(8_920);
    });

    it('stops scheduling when requestAnimationFrame re-enters with a non-advancing timestamp', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'day-1', label: '2026-06-18', productivityRatio: 0.42, productivityLabel: '42%' }),
            buildGroupedBucket({ bucketKey: 'day-2', label: '2026-06-19', productivityRatio: 0.58, productivityLabel: '58%' }),
            buildGroupedBucket({ bucketKey: 'day-3', label: '2026-06-20', productivityRatio: 0.74, productivityLabel: '74%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        expect(screen.getByTestId('activity-analytics-visual-panels')).toBeInTheDocument();
    });

    it('hides the traveling glow after each traversal and restarts it after a per-cycle random pause', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

        const scheduledTimeouts: Array<{ callback: () => void; delay: number }> = [];

        vi.spyOn(window, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number) => {
            if (typeof callback === 'function') {
                scheduledTimeouts.push({
                    callback: callback as () => void,
                    delay: Number(delay ?? 0),
                });
            }

            return scheduledTimeouts.length as unknown as number;
        }) as typeof window.setTimeout);
        vi.spyOn(window, 'clearTimeout').mockImplementation(() => undefined);

        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'day-1', label: '2026-06-18', productivityRatio: 0.42, productivityLabel: '42%' }),
            buildGroupedBucket({ bucketKey: 'day-2', label: '2026-06-19', productivityRatio: 0.58, productivityLabel: '58%' }),
            buildGroupedBucket({ bucketKey: 'day-3', label: '2026-06-20', productivityRatio: 0.74, productivityLabel: '74%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        expect(screen.getByTestId('activity-analytics-prod-trend-traveling-glow')).toHaveAttribute('data-cycle-key', '0');
        expect(scheduledTimeouts.map(({ delay }) => delay)).toContain(920);
        expect(scheduledTimeouts.map(({ delay }) => delay)).toContain(14_920);

        const hideTimeout = scheduledTimeouts.find(({ delay }) => delay === 920);
        const restartTimeout = scheduledTimeouts.find(({ delay }) => delay === 14_920);

        act(() => {
            hideTimeout?.callback();
        });

        expect(screen.queryByTestId('activity-analytics-prod-trend-traveling-glow')).not.toBeInTheDocument();
        expect(restartTimeout).toBeDefined();

        act(() => {
            restartTimeout?.callback();
        });

        expect(screen.getByTestId('activity-analytics-prod-trend-traveling-glow')).toHaveAttribute('data-cycle-key', '1');
    });

    it('renders the traveling glow when reduced motion is not explicitly requested', () => {
        vi.stubGlobal('matchMedia', createMatchMediaMock(false));
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'day-1', label: '2026-06-18', productivityRatio: 0.42, productivityLabel: '42%' }),
            buildGroupedBucket({ bucketKey: 'day-2', label: '2026-06-19', productivityRatio: 0.58, productivityLabel: '58%' }),
            buildGroupedBucket({ bucketKey: 'day-3', label: '2026-06-20', productivityRatio: 0.74, productivityLabel: '74%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        expect(screen.getByTestId('activity-analytics-prod-trend-traveling-glow')).toBeInTheDocument();
    });

    it('does not render or schedule the traveling glow when reduced motion is preferred', () => {
        vi.stubGlobal('matchMedia', createMatchMediaMock(true));

        const randomSpy = vi.spyOn(Math, 'random');
        const setTimeoutSpy = vi.spyOn(window, 'setTimeout');

        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'day-1', label: '2026-06-18', productivityRatio: 0.42, productivityLabel: '42%' }),
            buildGroupedBucket({ bucketKey: 'day-2', label: '2026-06-19', productivityRatio: 0.58, productivityLabel: '58%' }),
            buildGroupedBucket({ bucketKey: 'day-3', label: '2026-06-20', productivityRatio: 0.74, productivityLabel: '74%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        expect(screen.queryByTestId('activity-analytics-prod-trend-traveling-glow')).not.toBeInTheDocument();
        expect(randomSpy).not.toHaveBeenCalled();
        expect(setTimeoutSpy).not.toHaveBeenCalled();
    });

    it('maps one moving donut top-cap cycle across all visible segments with alternating directions and jumped routes', () => {
        const animationFrames: FrameRequestCallback[] = [];
        const runAnimationFrame = (timestamp: number) => {
            const queuedFrames = [...animationFrames];
            animationFrames.length = 0;
            queuedFrames.forEach((callback) => callback(timestamp));
        };

        vi.spyOn(performance, 'now').mockReturnValue(1000);
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
            animationFrames.push(callback);
            return animationFrames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
        vi.spyOn(Math, 'random').mockReturnValue(0.5);

        const scheduledTimeouts: Array<{ callback: () => void; delay: number }> = [];

        vi.spyOn(window, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number) => {
            if (typeof callback === 'function') {
                scheduledTimeouts.push({
                    callback: callback as () => void,
                    delay: Number(delay ?? 0),
                });
            }

            return scheduledTimeouts.length as unknown as number;
        }) as typeof window.setTimeout);
        vi.spyOn(window, 'clearTimeout').mockImplementation(() => undefined);

        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'day-1', label: '2026-06-18', productivityRatio: 0.42, productivityLabel: '42%' }),
            buildGroupedBucket({ bucketKey: 'day-2', label: '2026-06-19', productivityRatio: 0.58, productivityLabel: '58%' }),
            buildGroupedBucket({ bucketKey: 'day-3', label: '2026-06-20', productivityRatio: 0.74, productivityLabel: '74%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'day',
                        stateGradients: CUSTOM_STATE_GRADIENTS,
                    },
                })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 848, bodyHeight: CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX });
        });

        const movingTopCap = screen.getByTestId('activity-analytics-summary-top-cap');
        const movingTopCapAura = within(movingTopCap).getByTestId('activity-analytics-summary-top-cap-aura');
        const movingTopCapHalo = within(movingTopCap).getByTestId('activity-analytics-summary-top-cap-halo');
        const movingTopCapCore = within(movingTopCap).getByTestId('activity-analytics-summary-top-cap-core');
        const movingTopCapCoreHighlight = within(movingTopCap).getByTestId('activity-analytics-summary-top-cap-core-highlight');
        const movingTopCapCoreStroke = within(movingTopCap).getByTestId('activity-analytics-summary-top-cap-core-stroke');
        const summarySegments = screen.getAllByTestId('activity-analytics-summary-segment');
        const renderedSegments = buildRenderedSummarySegmentsFromDom(summarySegments);
        const activeSegment = summarySegments.find((segment) => segment.getAttribute('data-segment-key') === movingTopCap.getAttribute('data-segment-key'));
        const activeKey = movingTopCap.getAttribute('data-segment-key') as keyof typeof CUSTOM_STATE_GRADIENTS;
        const summaryChart = screen.getByTestId('activity-analytics-summary-chart');
        const activeTopCapStops = getGradientStopsByIdSuffix(summaryChart, `${activeKey}-top-cap-gradient`);
        const segmentStrokeWidth = Number(activeSegment?.getAttribute('stroke-width'));
        const segmentVisibleLength = parseVisibleStrokeLength(activeSegment?.getAttribute('stroke-dasharray') ?? null);
        const segmentStart = -parseStrokeDashOffset(activeSegment?.getAttribute('stroke-dashoffset') ?? null);
        const segmentEnd = segmentStart + segmentVisibleLength;
        const capLength = parseVisibleStrokeLength(movingTopCapCore.getAttribute('stroke-dasharray'));
        const firstCycleStart = -parseStrokeDashOffset(movingTopCapCore.getAttribute('stroke-dashoffset'));
        const ringThickness = Number(summarySegments.find((segment) => segment.getAttribute('data-segment-key') !== 'prod')?.getAttribute('stroke-width') ?? '0');
        const prodRingThickness = Number(summarySegments.find((segment) => segment.getAttribute('data-segment-key') === 'prod')?.getAttribute('stroke-width') ?? '0');
        const initialRoute = resolveSummaryTravelingTopCapRoute(renderedSegments, 0, 0, ringThickness, prodRingThickness);

        if (!initialRoute) {
            throw new Error('Expected an initial donut top-cap route');
        }

        const secondRouteProbeProgress = Math.min(initialRoute.stepProgressEnd + 0.0001, 0.999999);
        const secondRoute = resolveSummaryTravelingTopCapRoute(renderedSegments, 0, secondRouteProbeProgress, ringThickness, prodRingThickness);

        if (!secondRoute) {
            throw new Error('Expected a second donut top-cap route');
        }

        const secondRouteProgress = (secondRoute.stepProgressStart + secondRoute.stepProgressEnd) / 2;
        const secondRouteTimestamp = 1000 + (secondRouteProgress * 1460);

        expect(movingTopCap).toHaveAttribute('pointer-events', 'none');
        expect(movingTopCap).toHaveAttribute('aria-hidden', 'true');
        expect(movingTopCap).toHaveAttribute('data-cycle-key', '0');
        expect(movingTopCap).toHaveAttribute('data-route-step', '0');
        expect(movingTopCap).toHaveAttribute('data-route-count', '3');
        expect(movingTopCap).toHaveAttribute('data-direction', 'forward');
        expect(movingTopCap).toHaveAttribute('data-duration', '1.46s');
        expect(movingTopCap).toHaveStyle({ mixBlendMode: 'screen' });
        expect(movingTopCapAura.getAttribute('stroke')).toMatch(/^url\(#.+-top-cap-gradient\)$/);
        expect(movingTopCapHalo.getAttribute('stroke')).toMatch(/^url\(#.+-top-cap-gradient\)$/);
        expect(movingTopCapCore.getAttribute('stroke')).toMatch(/^url\(#.+-top-cap-gradient\)$/);
        expect(movingTopCapAura.getAttribute('filter')).toMatch(/^url\(#.+-summary-top-cap-traveling-glow\)$/);
        expect(movingTopCapHalo.getAttribute('filter')).toMatch(/^url\(#.+-summary-top-cap-traveling-glow\)$/);
        expect(activeTopCapStops.map((stop) => stop.getAttribute('stop-color'))).toEqual([
            topCapHighlightColor(CUSTOM_STATE_GRADIENTS[activeKey][0], TOP_CAP_HIGHLIGHT_MIX_BY_STATE[activeKey]),
            CUSTOM_STATE_GRADIENTS[activeKey][0],
        ]);
        expect(movingTopCapCoreHighlight).toHaveAttribute('stroke', topCapHighlightColor(CUSTOM_STATE_GRADIENTS[activeKey][0], TOP_CAP_HIGHLIGHT_MIX_BY_STATE[activeKey]));
        expect(movingTopCapCoreStroke).toHaveAttribute('stroke', CUSTOM_STATE_GRADIENTS[activeKey][0]);
        expect(movingTopCapCoreStroke.getAttribute('stroke')).not.toBe(CUSTOM_STATE_GRADIENTS[activeKey][1]);
        expect(activeSegment).toBeDefined();
        expect(parseVisibleStrokeLength(movingTopCapCore.getAttribute('stroke-dasharray'))).toBeCloseTo(
            Math.min(
                Math.max(segmentStrokeWidth * 0.3, 1),
                segmentVisibleLength,
            ),
            5,
        );
        expect(Number(movingTopCapCoreStroke.getAttribute('stroke-width'))).toBeCloseTo(
            segmentStrokeWidth * 1.25,
            2,
        );
        expect(firstCycleStart).toBeCloseTo(segmentStart, 5);
        expect(firstCycleStart + capLength).toBeLessThanOrEqual(segmentEnd + 0.001);

        act(() => {
            runAnimationFrame(secondRouteTimestamp);
        });

        const secondRouteTopCap = screen.getByTestId('activity-analytics-summary-top-cap');
        const secondRouteCore = within(secondRouteTopCap).getByTestId('activity-analytics-summary-top-cap-core');
        const secondRouteSegment = screen
            .getAllByTestId('activity-analytics-summary-segment')
            .find((segment) => segment.getAttribute('data-segment-key') === secondRouteTopCap.getAttribute('data-segment-key'));
        const secondRouteSegmentVisibleLength = parseVisibleStrokeLength(secondRouteSegment?.getAttribute('stroke-dasharray') ?? null);
        const secondRouteSegmentStart = -parseStrokeDashOffset(secondRouteSegment?.getAttribute('stroke-dashoffset') ?? null);
        const secondRouteSegmentEnd = secondRouteSegmentStart + secondRouteSegmentVisibleLength;
        const secondRouteCapLength = parseVisibleStrokeLength(secondRouteCore.getAttribute('stroke-dasharray'));
        const secondRouteStart = -parseStrokeDashOffset(secondRouteCore.getAttribute('stroke-dashoffset'));

        expect(secondRouteTopCap).toHaveAttribute('data-route-step', '1');
        expect(secondRouteTopCap).toHaveAttribute('data-route-count', '3');
        expect(secondRouteTopCap).toHaveAttribute('data-direction', 'reverse');
        expect(secondRouteTopCap).not.toHaveAttribute('data-segment-key', activeKey);
        expect(secondRouteStart).toBeGreaterThanOrEqual(secondRouteSegmentStart - 0.001);
        expect(secondRouteStart).toBeLessThanOrEqual(secondRouteSegmentEnd - secondRouteCapLength + 0.01);
        const secondRouteKey = secondRouteTopCap.getAttribute('data-segment-key');
        const thirdRouteProbeProgress = Math.min(secondRoute.stepProgressEnd + 0.0001, 0.999999);
        const thirdRoute = resolveSummaryTravelingTopCapRoute(renderedSegments, 0, thirdRouteProbeProgress, ringThickness, prodRingThickness);

        if (!thirdRoute) {
            throw new Error('Expected a third donut top-cap route');
        }

        const thirdRouteProgress = (thirdRoute.stepProgressStart + thirdRoute.stepProgressEnd) / 2;
        const thirdRouteTimestamp = 1000 + (thirdRouteProgress * 1460);

        act(() => {
            runAnimationFrame(thirdRouteTimestamp);
        });

        const thirdRouteTopCap = screen.getByTestId('activity-analytics-summary-top-cap');
        const thirdRouteCore = within(thirdRouteTopCap).getByTestId('activity-analytics-summary-top-cap-core');
        const thirdRouteSegment = screen
            .getAllByTestId('activity-analytics-summary-segment')
            .find((segment) => segment.getAttribute('data-segment-key') === thirdRouteTopCap.getAttribute('data-segment-key'));
        const thirdRouteSegmentVisibleLength = parseVisibleStrokeLength(thirdRouteSegment?.getAttribute('stroke-dasharray') ?? null);
        const thirdRouteSegmentStart = -parseStrokeDashOffset(thirdRouteSegment?.getAttribute('stroke-dashoffset') ?? null);
        const thirdRouteSegmentEnd = thirdRouteSegmentStart + thirdRouteSegmentVisibleLength;
        const thirdRouteCapLength = parseVisibleStrokeLength(thirdRouteCore.getAttribute('stroke-dasharray'));
        const thirdRouteStart = -parseStrokeDashOffset(thirdRouteCore.getAttribute('stroke-dashoffset'));

        expect(thirdRouteTopCap).toHaveAttribute('data-route-step', '2');
        expect(thirdRouteTopCap).toHaveAttribute('data-route-count', '3');
        expect(thirdRouteTopCap).toHaveAttribute('data-direction', 'forward');
        expect(thirdRouteTopCap).not.toHaveAttribute('data-segment-key', activeKey);
        expect(thirdRouteTopCap.getAttribute('data-segment-key')).not.toBe(secondRouteKey);
        expect(thirdRouteStart).toBeGreaterThanOrEqual(thirdRouteSegmentStart - 0.001);
        expect(thirdRouteStart + thirdRouteCapLength).toBeLessThanOrEqual(thirdRouteSegmentEnd + 0.01);
        expect(screen.queryByTestId('activity-analytics-summary-static-top-cap')).not.toBeInTheDocument();

        const hideTimeout = scheduledTimeouts.find(({ delay }) => delay === 1460);
        const restartTimeout = scheduledTimeouts.find(({ delay }) => delay === 15_460);

        act(() => {
            hideTimeout?.callback();
        });

        expect(screen.queryByTestId('activity-analytics-summary-top-cap')).not.toBeInTheDocument();

        act(() => {
            restartTimeout?.callback();
        });

        const secondCycleTopCap = screen.getByTestId('activity-analytics-summary-top-cap');
        const secondCycleCore = within(secondCycleTopCap).getByTestId('activity-analytics-summary-top-cap-core');
        const secondCycleSegment = screen
            .getAllByTestId('activity-analytics-summary-segment')
            .find((segment) => segment.getAttribute('data-segment-key') === secondCycleTopCap.getAttribute('data-segment-key'));
        const secondCycleSegmentVisibleLength = parseVisibleStrokeLength(secondCycleSegment?.getAttribute('stroke-dasharray') ?? null);
        const secondCycleSegmentStart = -parseStrokeDashOffset(secondCycleSegment?.getAttribute('stroke-dashoffset') ?? null);
        const secondCycleSegmentEnd = secondCycleSegmentStart + secondCycleSegmentVisibleLength;
        const secondCycleCapLength = parseVisibleStrokeLength(secondCycleCore.getAttribute('stroke-dasharray'));
        const secondCycleStart = -parseStrokeDashOffset(secondCycleCore.getAttribute('stroke-dashoffset'));

        expect(secondCycleTopCap).toHaveAttribute('data-cycle-key', '1');
        expect(secondCycleTopCap).toHaveAttribute('data-route-step', '0');
        expect(secondCycleTopCap).toHaveAttribute('data-route-count', '3');
        expect(secondCycleTopCap).toHaveAttribute('data-direction', 'reverse');
        expect(secondCycleStart).toBeCloseTo(secondCycleSegmentEnd - secondCycleCapLength, 5);
        expect(secondCycleStart).toBeGreaterThanOrEqual(secondCycleSegmentStart - 0.001);
    });

    it('hides the moving donut top cap after traversal and restarts it after the random pause', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

        const scheduledTimeouts: Array<{ callback: () => void; delay: number }> = [];

        vi.spyOn(window, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number) => {
            if (typeof callback === 'function') {
                scheduledTimeouts.push({
                    callback: callback as () => void,
                    delay: Number(delay ?? 0),
                });
            }

            return scheduledTimeouts.length as unknown as number;
        }) as typeof window.setTimeout);
        vi.spyOn(window, 'clearTimeout').mockImplementation(() => undefined);

        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'day-1', label: '2026-06-18', productivityRatio: 0.42, productivityLabel: '42%' }),
            buildGroupedBucket({ bucketKey: 'day-2', label: '2026-06-19', productivityRatio: 0.58, productivityLabel: '58%' }),
            buildGroupedBucket({ bucketKey: 'day-3', label: '2026-06-20', productivityRatio: 0.74, productivityLabel: '74%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'day',
                        stateGradients: CUSTOM_STATE_GRADIENTS,
                    },
                })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 848, bodyHeight: CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX });
        });

        expect(screen.getByTestId('activity-analytics-summary-top-cap')).toHaveAttribute('data-cycle-key', '0');
        expect(scheduledTimeouts.map(({ delay }) => delay)).toContain(1460);
        expect(scheduledTimeouts.map(({ delay }) => delay)).toContain(15_460);

        const hideTimeout = scheduledTimeouts.find(({ delay }) => delay === 1460);
        const restartTimeout = scheduledTimeouts.find(({ delay }) => delay === 15_460);

        act(() => {
            hideTimeout?.callback();
        });

        expect(screen.queryByTestId('activity-analytics-summary-top-cap')).not.toBeInTheDocument();

        act(() => {
            restartTimeout?.callback();
        });

        expect(screen.getByTestId('activity-analytics-summary-top-cap')).toHaveAttribute('data-cycle-key', '1');
    });

    it('falls back to static donut top caps and skips motion scheduling when reduced motion is preferred', () => {
        vi.stubGlobal('matchMedia', createMatchMediaMock(true));

        const setTimeoutSpy = vi.spyOn(window, 'setTimeout');

        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'day-1', label: '2026-06-18', productivityRatio: 0.42, productivityLabel: '42%' }),
            buildGroupedBucket({ bucketKey: 'day-2', label: '2026-06-19', productivityRatio: 0.58, productivityLabel: '58%' }),
            buildGroupedBucket({ bucketKey: 'day-3', label: '2026-06-20', productivityRatio: 0.74, productivityLabel: '74%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'day',
                        stateGradients: CUSTOM_STATE_GRADIENTS,
                    },
                })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 848, bodyHeight: CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX });
        });

        expect(screen.queryByTestId('activity-analytics-summary-top-cap')).not.toBeInTheDocument();
        const staticTopCaps = screen.getAllByTestId('activity-analytics-summary-static-top-cap');
        const summaryChart = screen.getByTestId('activity-analytics-summary-chart');
        const summarySegments = screen.getAllByTestId('activity-analytics-summary-segment');
        const summarySegmentByKey = new Map(summarySegments.map((segment) => [segment.getAttribute('data-segment-key') ?? '', segment]));
        expect(staticTopCaps.length).toBeGreaterThan(0);
        staticTopCaps.forEach((cap) => {
            const key = cap.getAttribute('data-segment-key') as keyof typeof CUSTOM_STATE_GRADIENTS;
            const topCapStops = getGradientStopsByIdSuffix(summaryChart, `${key}-top-cap-gradient`);
            const staticTopCapCore = within(cap).getByTestId('activity-analytics-summary-top-cap-core');
            const segment = summarySegmentByKey.get(key);

            expect(segment).toBeDefined();
            expect(cap).toHaveStyle({ mixBlendMode: 'screen' });
            expect(within(cap).getByTestId('activity-analytics-summary-top-cap-aura').getAttribute('filter')).toMatch(/^url\(#.+-summary-top-cap-traveling-glow\)$/);
            expect(within(cap).getByTestId('activity-analytics-summary-top-cap-halo').getAttribute('filter')).toMatch(/^url\(#.+-summary-top-cap-traveling-glow\)$/);
            expect(within(cap).getByTestId('activity-analytics-summary-top-cap-core-highlight')).toHaveAttribute('stroke', topCapHighlightColor(CUSTOM_STATE_GRADIENTS[key][0], TOP_CAP_HIGHLIGHT_MIX_BY_STATE[key]));
            expect(within(cap).getByTestId('activity-analytics-summary-top-cap-core-stroke')).toHaveAttribute('stroke', CUSTOM_STATE_GRADIENTS[key][0]);
            expect(Number(within(cap).getByTestId('activity-analytics-summary-top-cap-core-stroke').getAttribute('stroke-width'))).toBeCloseTo(
                Number(segment?.getAttribute('stroke-width')),
                2,
            );
            expect(parseVisibleStrokeLength(staticTopCapCore.getAttribute('stroke-dasharray'))).toBeCloseTo(
                Math.min(
                    Math.max(Number(segment?.getAttribute('stroke-width')) * 0.2, 1),
                    parseVisibleStrokeLength(segment?.getAttribute('stroke-dasharray') ?? null),
                ),
                5,
            );
            expect(topCapStops.map((stop) => stop.getAttribute('stop-color'))).toEqual([
                topCapHighlightColor(CUSTOM_STATE_GRADIENTS[key][0], TOP_CAP_HIGHLIGHT_MIX_BY_STATE[key]),
                CUSTOM_STATE_GRADIENTS[key][0],
            ]);
        });
        expect(setTimeoutSpy).not.toHaveBeenCalled();
    });

    it('renders alternating soft zebra bands across PROD trend bucket centers behind the foreground trend data', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics(Array.from({ length: 6 }, (_, index) => buildGroupedBucket({
            bucketKey: `day-${index + 1}`,
            label: `2026-06-${String(index + 18).padStart(2, '0')}`,
            productivityRatio: 0.45 + (index * 0.05),
            productivityLabel: `${45 + (index * 5)}%`,
        })));

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        const trendChart = screen.getByTestId('activity-analytics-prod-trend-chart');
        const trendBands = screen.getAllByTestId('activity-analytics-prod-trend-band');
        const trendBandBoundaries = screen.getAllByTestId('activity-analytics-prod-trend-band-boundary');
        const trendLabels = screen.getAllByTestId('activity-analytics-prod-trend-x-axis-label');
        const trendLine = screen.getByTestId('activity-analytics-prod-trend-line');
        const latestPoint = screen.getByTestId('activity-analytics-prod-trend-latest-point');
        const bandGradient = trendChart.querySelector('linearGradient[id$="-prod-trend-band-gradient"]');
        const bandLayer = trendChart.querySelector('[data-testid="activity-analytics-prod-trend-band-layer"]');

        expect(bandGradient).not.toBeNull();
        expect(bandGradient).toHaveAttribute('x1', '0');
        expect(bandGradient).toHaveAttribute('y1', '0');
        expect(bandGradient).toHaveAttribute('x2', '0');
        expect(bandGradient).toHaveAttribute('y2', '1');
        expect(Array.from(bandGradient?.querySelectorAll('stop') ?? []).map((stop) => stop.getAttribute('stop-color'))).toEqual([
            'var(--color-chart-grid)',
            'var(--color-chart-grid)',
            'var(--color-chart-grid)',
        ]);
        expect(Array.from(bandGradient?.querySelectorAll('stop') ?? []).map((stop) => stop.getAttribute('stop-opacity'))).toEqual([
            String(DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_ALPHAS[0] / 100),
            String(DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_ALPHAS[1] / 100),
            String(DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_ALPHAS[2] / 100),
        ]);

        expect(trendBands.map((band) => band.getAttribute('data-interval-index'))).toEqual(['0', '2', '4']);
        expect(trendBandBoundaries).toHaveLength(6);
        expect(trendBandBoundaries.map((line) => [line.getAttribute('data-interval-index'), line.getAttribute('data-boundary')])).toEqual([
            ['0', 'left'],
            ['0', 'right'],
            ['2', 'left'],
            ['2', 'right'],
            ['4', 'left'],
            ['4', 'right'],
        ]);

        const firstBandX = Number(trendBands[0].getAttribute('x'));
        const firstBandWidth = Number(trendBands[0].getAttribute('width'));
        const thirdBandX = Number(trendBands[1].getAttribute('x'));
        const thirdBandWidth = Number(trendBands[1].getAttribute('width'));
        const firstLabelX = Number(trendLabels[0].getAttribute('x'));
        const secondLabelX = Number(trendLabels[1].getAttribute('x'));
        const thirdLabelX = Number(trendLabels[2].getAttribute('x'));
        const fourthLabelX = Number(trendLabels[3].getAttribute('x'));

        expect(firstBandX).toBeCloseTo(firstLabelX, 5);
        expect(firstBandWidth).toBeCloseTo(secondLabelX - firstLabelX, 5);
        expect(thirdBandX).toBeCloseTo(thirdLabelX, 5);
        expect(thirdBandWidth).toBeCloseTo(fourthLabelX - thirdLabelX, 5);

        trendBandBoundaries.forEach((line) => {
            expect(line).toHaveAttribute('stroke', 'var(--color-chart-grid)');
            expect(line).toHaveAttribute('stroke-dasharray', '3 3');
        });

        expect(bandLayer).toHaveStyle({ mixBlendMode: 'overlay' });
        expect(bandLayer?.compareDocumentPosition(trendLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(bandLayer?.compareDocumentPosition(latestPoint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(bandLayer).toContainElement(trendBands[0]);
        expect(trendChart.lastElementChild).not.toBe(bandLayer);
    });

    it('hides PROD trend zebra bands for sparse 7d Turno summary labels', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'shift-1', label: '2026-06-18 · Turno 1', productivityRatio: 0.75, productivityLabel: '75%' }),
            buildGroupedBucket({ bucketKey: 'shift-2', label: '2026-06-18 · Turno 2', productivityRatio: 0.55, productivityLabel: '55%' }),
            buildGroupedBucket({ bucketKey: 'shift-3', label: '2026-06-18 · Turno 3', productivityRatio: 0.7, productivityLabel: '70%' }),
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

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        expect(screen.getAllByTestId('activity-analytics-prod-trend-x-axis-label').map((node) => node.textContent)).toEqual(['Turno 1', 'Turno 2', 'Turno 3']);
        expect(screen.queryAllByTestId('activity-analytics-prod-trend-band')).toHaveLength(0);
        expect(screen.queryAllByTestId('activity-analytics-prod-trend-band-boundary')).toHaveLength(0);
        expect(screen.getAllByTestId('activity-analytics-prod-trend-line').length).toBeGreaterThan(0);
        expect(screen.getAllByTestId('activity-analytics-prod-trend-area').length).toBeGreaterThan(0);
        expect(screen.getByTestId('activity-analytics-prod-trend-latest-point')).toBeInTheDocument();
    });

    it('applies custom prod trend band stop colors, alphas, and blend mode when configured', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics(Array.from({ length: 4 }, (_, index) => buildGroupedBucket({
            bucketKey: `day-${index + 1}`,
            label: `2026-06-${String(index + 18).padStart(2, '0')}`,
            productivityRatio: 0.5 + (index * 0.05),
            productivityLabel: `${50 + (index * 5)}%`,
        })));

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'day',
                        prodTrendBands: CUSTOM_PROD_TREND_BANDS,
                    },
                })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        const trendChart = screen.getByTestId('activity-analytics-prod-trend-chart');
        const bandGradient = trendChart.querySelector('linearGradient[id$="-prod-trend-band-gradient"]');
        const bandLayer = trendChart.querySelector('[data-testid="activity-analytics-prod-trend-band-layer"]');

        expect(Array.from(bandGradient?.querySelectorAll('stop') ?? []).map((stop) => stop.getAttribute('stop-color'))).toEqual(CUSTOM_PROD_TREND_BANDS.colors);
        expect(Array.from(bandGradient?.querySelectorAll('stop') ?? []).map((stop) => stop.getAttribute('stop-opacity'))).toEqual([
            '0.12',
            '0.68',
            '0.24',
        ]);
        expect(bandLayer).toHaveStyle({ mixBlendMode: CUSTOM_PROD_TREND_BANDS.blendMode });
        expect(bandLayer?.compareDocumentPosition(screen.getByTestId('activity-analytics-prod-trend-line')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('budgets top region, trend, and gaps before resolving the Groups height budget', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'day-1', label: '18/06', productivityRatio: 0.67, productivityLabel: '67%' }),
            buildGroupedBucket({ bucketKey: 'day-2', label: '19/06', productivityRatio: 0.5, productivityLabel: '50%' }),
            buildGroupedBucket({ bucketKey: 'day-3', label: '20/06', productivityRatio: 0.75, productivityLabel: '75%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        const visualPanels = screen.getByTestId('activity-analytics-visual-panels');
        const groupsPanel = screen.getByTestId('activity-analytics-groups-panel');
        const resolveRemainingGroupsSpace = () => {
            const chartHeight = Number.parseFloat(visualPanels.getAttribute('data-chart-height-px') ?? '0');
            const topHeight = Number.parseFloat(visualPanels.getAttribute('data-top-region-height-px') ?? '0');
            const trendHeight = Number.parseFloat(visualPanels.getAttribute('data-prod-trend-height-px') ?? '0');
            const fixedGaps = Number.parseFloat(visualPanels.getAttribute('data-fixed-vertical-gaps-px') ?? '0');

            return chartHeight - topHeight - trendHeight - fixedGaps;
        };

        expect(visualPanels).toHaveAttribute('data-top-region-height-px', '224.00');
        expect(visualPanels).toHaveAttribute('data-fixed-vertical-gaps-px', '24.00');
        expect(visualPanels).toHaveAttribute('data-prod-trend-height-px', '72.00');
        expect(visualPanels).toHaveAttribute('data-groups-height-budget-px', '100.00');
        expect(resolveRemainingGroupsSpace()).toBe(100);
        expect(Number.parseFloat(visualPanels.getAttribute('data-groups-height-budget-px') ?? '0')).toBe(resolveRemainingGroupsSpace());
        expect(groupsPanel).toHaveAttribute('data-groups-density', 'fit');
        expect(screen.getByTestId('activity-analytics-groups-chart')).toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-groups-text')).not.toBeInTheDocument();
        expect(groupsPanel).toHaveAttribute('data-chart-chrome-height-px', '60.00');
        expect(groupsPanel).toHaveAttribute('data-chart-height-px', '40.00');
        expect(Number(screen.getByTestId('activity-analytics-groups-chart').getAttribute('height'))).toBe(40);
        expect(Number.parseFloat(groupsPanel.getAttribute('data-chart-height-px') ?? '0')).toBeLessThanOrEqual(
            resolveRemainingGroupsSpace() - Number.parseFloat(groupsPanel.getAttribute('data-chart-chrome-height-px') ?? '0'),
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX });
        });

        expect(visualPanels).toHaveAttribute('data-groups-height-budget-px', '384.00');
        expect(resolveRemainingGroupsSpace()).toBe(384);
        expect(Number.parseFloat(visualPanels.getAttribute('data-groups-height-budget-px') ?? '0')).toBe(resolveRemainingGroupsSpace());
        expect(groupsPanel).toHaveAttribute('data-groups-density', 'fit');

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 360 });
        });

        expect(visualPanels).toHaveAttribute('data-top-region-height-px', '224.00');
        expect(visualPanels).toHaveAttribute('data-fixed-vertical-gaps-px', '24.00');
        expect(visualPanels).toHaveAttribute('data-prod-trend-height-px', '72.00');
        expect(visualPanels).toHaveAttribute('data-groups-height-budget-px', '40.00');
        expect(resolveRemainingGroupsSpace()).toBe(40);
        expect(Number.parseFloat(visualPanels.getAttribute('data-groups-height-budget-px') ?? '0')).toBe(resolveRemainingGroupsSpace());
        expect(screen.getByTestId('activity-analytics-groups-panel')).toHaveAttribute('data-groups-density', 'text-fallback');
    });

    it('keeps 7d Turno groups in chart mode at the common 420px body height by switching to the compact turno chrome', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'shift-a', label: '19/06 · Turno 1', productivityRatio: 0.45, productivityLabel: '45%' }),
            buildGroupedBucket({ bucketKey: 'shift-b', label: '19/06 · Turno 2', productivityRatio: 0.7, productivityLabel: '70%' }),
            buildGroupedBucket({ bucketKey: 'shift-c', label: '20/06 · Turno 3', productivityRatio: 0.62, productivityLabel: '62%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget()}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        const visualPanels = screen.getByTestId('activity-analytics-visual-panels');
        const groupsPanel = screen.getByTestId('activity-analytics-groups-panel');
        const groupsChart = screen.getByTestId('activity-analytics-groups-chart');
        const chartShell = groupsChart.closest('div[data-testid="activity-analytics-groups-chart-shell"]');
        const turnoModeControl = screen.getByTestId('activity-analytics-turno-mode');
        const remainingGroupsSpace = Number.parseFloat(visualPanels.getAttribute('data-groups-height-budget-px') ?? '0');
        const chromeHeight = Number.parseFloat(groupsPanel.getAttribute('data-chart-chrome-height-px') ?? '0');
        const chartHeight = Number.parseFloat(groupsPanel.getAttribute('data-chart-height-px') ?? '0');

        if (!chartShell) {
            throw new Error('Expected the compact Turno chart shell to be rendered');
        }

        expect(visualPanels).toHaveAttribute('data-groups-height-budget-px', '100.00');
        expect(groupsPanel).toHaveAttribute('data-groups-density', 'fit');
        expect(groupsPanel).toHaveAttribute('data-compact-turno-layout', 'true');
        expect(groupsPanel).toHaveAttribute('data-chart-chrome-height-px', `${GROUPS_COMPACT_TURNO_CHROME_BUDGET_PX.toFixed(2)}`);
        expect(groupsPanel).toHaveAttribute('data-chart-height-px', '40.00');
        expect(groupsChart).toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-groups-text')).not.toBeInTheDocument();
        expect(turnoModeControl).toBeInTheDocument();
        expect(within(turnoModeControl).getByRole('button', { name: 'Resumen' })).toHaveAttribute('aria-pressed', 'true');
        expect(chartShell).toHaveClass('mt-1', 'px-4', 'pb-2');
        expect(chartShell).not.toHaveClass('mt-2', 'px-5', 'pb-5');
        expect(chromeHeight + chartHeight).toBe(remainingGroupsSpace);

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 360 });
        });

        expect(screen.getByTestId('activity-analytics-groups-panel')).toHaveAttribute('data-groups-density', 'text-fallback');
    });

    it('keeps compact trend panel height aligned with its chart and chrome budget', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'day-1', label: '18/06', productivityRatio: 0.67, productivityLabel: '67%' }),
            buildGroupedBucket({ bucketKey: 'day-2', label: '19/06', productivityRatio: 0.5, productivityLabel: '50%' }),
            buildGroupedBucket({ bucketKey: 'day-3', label: '20/06', productivityRatio: 0.75, productivityLabel: '75%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        const prodTrendPanel = screen.getByTestId('activity-analytics-prod-trend');
        const prodTrendShell = screen.getByTestId('activity-analytics-prod-trend-shell');
        const panelHeight = Number.parseFloat(prodTrendPanel.getAttribute('data-panel-height-px') ?? '0');
        const chromeHeight = Number.parseFloat(prodTrendPanel.getAttribute('data-chart-chrome-height-px') ?? '0');
        const chartHeight = Number.parseFloat(prodTrendPanel.getAttribute('data-chart-height-px') ?? '0');
        const panelTopPadding = Number.parseFloat(prodTrendPanel.getAttribute('data-compact-panel-top-padding-px') ?? '0');
        const headingRowHeight = Number.parseFloat(prodTrendPanel.getAttribute('data-compact-heading-row-height-px') ?? '0');
        const shellMarginTop = Number.parseFloat(prodTrendPanel.getAttribute('data-compact-shell-margin-top-px') ?? '0');
        const shellPaddingBottom = Number.parseFloat(prodTrendPanel.getAttribute('data-compact-shell-padding-bottom-px') ?? '0');

        expect(prodTrendPanel).toHaveClass('pt-2');
        expect(prodTrendShell).toHaveClass('mt-1', 'pb-2');
        expect(panelTopPadding).toBe(PROD_TREND_COMPACT_PANEL_TOP_PADDING_PX);
        expect(headingRowHeight).toBe(PROD_TREND_COMPACT_HEADING_ROW_HEIGHT_PX);
        expect(shellMarginTop).toBe(PROD_TREND_COMPACT_SHELL_MARGIN_TOP_PX);
        expect(shellPaddingBottom).toBe(PROD_TREND_COMPACT_SHELL_PADDING_BOTTOM_PX);
        expect(panelHeight).toBe(PROD_TREND_COMPACT_PANEL_MIN_HEIGHT_PX);
        expect(chromeHeight).toBe(PROD_TREND_COMPACT_CHROME_BUDGET_PX);
        expect(chartHeight).toBe(PROD_TREND_COMPACT_CHART_MIN_HEIGHT_PX);
        expect(panelHeight).toBeGreaterThanOrEqual(chromeHeight + chartHeight);
        expect(panelHeight).toBe(chromeHeight + chartHeight);
        expect(chromeHeight).toBe(panelTopPadding + headingRowHeight + shellMarginTop + shellPaddingBottom);
    });

    it('updates the % PROD trend labels and plotted values when range and granularity change', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        vi.spyOn(activityAnalyticsComputation, 'computeActivityAnalytics').mockImplementation(({ range, groupBy }) => {
            if (range === '30d' && groupBy === 'week') {
                return {
                    analytics: {
                        durationsMs: { prod: 1, setup: 1, stopped: 1, noData: 0 },
                        stopCount: 1,
                        estimatedKwh: 18.4,
                        utilizationRatio: 4 / 7,
                        coverageRatio: 1,
                        intervals: [],
                    },
                    grouped: [
                        buildGroupedBucket({ bucketKey: 'week-1', label: 'Sem 24', productivityRatio: 0.2, productivityLabel: '20%' }),
                        buildGroupedBucket({ bucketKey: 'week-2', label: 'Sem 25', productivityRatio: 0.9, productivityLabel: '90%' }),
                        buildGroupedBucket({ bucketKey: 'week-3', label: 'Sem 26', productivityRatio: 0.6, productivityLabel: '60%' }),
                    ],
                    comparison: {
                        best: { label: 'Sem 25', bucketKey: 'week-2' },
                        worst: { label: 'Sem 24', bucketKey: 'week-1' },
                    },
                    summaryRows: [],
                    timezone: 'UTC',
                } as never;
            }

            return {
                analytics: {
                    durationsMs: { prod: 1, setup: 1, stopped: 1, noData: 0 },
                    stopCount: 1,
                    estimatedKwh: 18.4,
                    utilizationRatio: 4 / 7,
                    coverageRatio: 1,
                    intervals: [],
                },
                grouped: [
                    buildGroupedBucket({ bucketKey: 'shift-a', label: '19/06 · Turno 1', productivityRatio: 0.45, productivityLabel: '45%' }),
                    buildGroupedBucket({ bucketKey: 'shift-b', label: '19/06 · Turno 2', productivityRatio: 0.7, productivityLabel: '70%' }),
                    buildGroupedBucket({ bucketKey: 'shift-c', label: '20/06 · Turno 3', productivityRatio: 0.62, productivityLabel: '62%' }),
                ],
                comparison: {
                    best: { label: '19/06 · Turno 2', bucketKey: 'shift-b' },
                    worst: { label: '19/06 · Turno 1', bucketKey: 'shift-a' },
                },
                summaryRows: [],
                timezone: 'UTC',
            } as never;
        });

        const { rerender } = render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'shift' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        const initialTrendChart = screen.getByTestId('activity-analytics-prod-trend-chart');

        expect(screen.getAllByTestId('activity-analytics-prod-trend-x-axis-label').map((node) => node.textContent)).toEqual(['Turno 1', 'Turno 2', 'Turno 3']);
        expect(getRenderedGroupXAxisLabels()).toEqual(['Turno 1', 'Turno 2', 'Turno 3']);
        expect(parseNumericCsvAttribute(initialTrendChart.getAttribute('data-productivity-ratio'))).toEqual([0.45, 0.7, 0.62]);
        expect(parseNumericCsvAttribute(initialTrendChart.getAttribute('data-renderable-point-y'))).toEqual([12.8, 8.8, 10.08]);

        rerender(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '30d', groupBy: 'week' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        const updatedTrendChart = screen.getByTestId('activity-analytics-prod-trend-chart');

        expect(screen.getAllByTestId('activity-analytics-prod-trend-x-axis-label').map((node) => node.textContent)).toEqual(['Sem 24', 'Sem 25', 'Sem 26']);
        expect(getRenderedGroupXAxisLabels()).toEqual(['Sem 24', 'Sem 25', 'Sem 26']);
        expect(parseNumericCsvAttribute(updatedTrendChart.getAttribute('data-productivity-ratio'))).toEqual([0.2, 0.9, 0.6]);
        expect(parseNumericCsvAttribute(updatedTrendChart.getAttribute('data-renderable-point-y'))).toEqual([16.8, 5.6, 10.4]);
    });

    it('uses grouped shift bucket labels on the % PROD trend x-axis instead of collapsing to duplicate date labels', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'shift-a', label: '19/06 · Turno 1', productivityRatio: 0.45, productivityLabel: '45%' }),
            buildGroupedBucket({ bucketKey: 'shift-b', label: '19/06 · Turno 2', productivityRatio: 0.7, productivityLabel: '70%' }),
            buildGroupedBucket({ bucketKey: 'shift-c', label: '20/06 · Turno 3', productivityRatio: 0.62, productivityLabel: '62%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'shift' } })}
                machines={MACHINES}
            />,
        );

        expect(screen.getAllByTestId('activity-analytics-prod-trend-x-axis-label').map((node) => node.textContent)).toEqual([
            'Turno 1',
            'Turno 2',
            'Turno 3',
        ]);
        expect(getRenderedGroupXAxisLabels()).toEqual(['Turno 1', 'Turno 2', 'Turno 3']);
    });

    it('renders the latest in-progress trend bucket as a numeric blinking point without an extra partial marker', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'day-1', label: '18/06', productivityRatio: 0.42, productivityLabel: '42%' }),
            buildGroupedBucket({ bucketKey: 'day-2', label: '19/06', productivityRatio: 0.7, productivityLabel: '70%' }),
            buildGroupedBucket({
                bucketKey: 'day-3',
                label: '20/06 (en curso)',
                productivityRatio: null,
                productivityLabel: 'cobertura incompleta',
                durationsMs: {
                    prod: 90 * 60 * 1000,
                    setup: 30 * 60 * 1000,
                    stopped: 60 * 60 * 1000,
                    noData: 90 * 60 * 1000,
                },
                coverageRatio: 0.5,
                expectedDurationMs: 4.5 * 60 * 60 * 1000,
                isInProgress: true,
            }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        const trendChart = screen.getByTestId('activity-analytics-prod-trend-chart');
        const trendLabels = screen.getAllByTestId('activity-analytics-prod-trend-x-axis-label').map((node) => node.textContent);
        const groupLabels = getRenderedGroupXAxisLabels();
        const groupStacks = screen.getAllByTestId('activity-analytics-group-stack');
        const latestPoint = screen.getByTestId('activity-analytics-prod-trend-latest-point');
        const latestValueLabel = screen.getByTestId('activity-analytics-prod-trend-latest-value-label');
        const latestPointPulse = screen.getByTestId('activity-analytics-prod-trend-final-point-pulse');
        const latestPointAura = screen.getByTestId('activity-analytics-prod-trend-final-point-aura');
        const latestPointHalo = screen.getByTestId('activity-analytics-prod-trend-final-point-halo');
        const latestPointCore = screen.getByTestId('activity-analytics-prod-trend-final-point-core');
        const renderablePointY = (trendChart.getAttribute('data-renderable-point-y') ?? '').split(',');

        expect(trendLabels).toEqual(groupLabels);
        expect(trendLabels).toEqual(['18/06', '19/06', '20/06']);
        expect(groupStacks).toHaveLength(3);
        expect((trendChart.getAttribute('data-bucket-keys') ?? '').split(',')).toEqual(['day-1', 'day-2', 'day-3']);
        expect(trendChart).toHaveAttribute('data-productivity-ratio', '0.4200,0.7000,0.5000');
        expect(renderablePointY).toEqual([
            expect.stringMatching(/^[\d.]+$/),
            expect.stringMatching(/^[\d.]+$/),
            expect.stringMatching(/^[\d.]+$/),
        ]);
        expect(trendChart).toHaveAttribute('data-partial-bucket-keys', 'day-3');
        expect(within(groupStacks[2]).getByTestId('activity-analytics-group-partial-outline')).toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-prod-trend-partial-point')).not.toBeInTheDocument();
        expect(latestPoint).toHaveAttribute('data-bucket-key', 'day-3');
        expect(latestPoint).toHaveAttribute('data-partial', 'true');
        expect(latestPoint).toHaveAttribute('data-value-state', 'measured');
        expect(trendChart).toHaveAttribute('data-latest-bucket-key', 'day-3');
        expect(latestValueLabel).toHaveTextContent('50%');
        expect(latestValueLabel).toHaveClass('activity-analytics-prod-trend-latest-value-float');
        expect(latestValueLabel).toHaveAttribute('pointer-events', 'none');
        expect(latestValueLabel).toHaveAttribute('data-label-placement', 'below');
        expect(Number(latestValueLabel.getAttribute('x'))).toBe(Number(latestPointCore.getAttribute('cx')));
        expect(Number(latestValueLabel.getAttribute('y'))).toBeGreaterThan(Number(latestPointCore.getAttribute('cy')));
        expect(Number(latestPointPulse.getAttribute('cx'))).toBe(Number(latestPointCore.getAttribute('cx')));
        expect(Number(latestPointPulse.getAttribute('cy'))).toBe(Number(latestPointCore.getAttribute('cy')));
        expect(Number(latestPointPulse.getAttribute('cy'))).toBeCloseTo(Number.parseFloat(renderablePointY[2] ?? 'NaN'));
        expect(latestPointPulse).toHaveClass('animate-ping');
        expect(Number(latestPointAura.getAttribute('cx'))).toBe(Number(latestPointCore.getAttribute('cx')));
        expect(Number(latestPointAura.getAttribute('cy'))).toBe(Number(latestPointCore.getAttribute('cy')));
        expect(Number(latestPointHalo.getAttribute('cx'))).toBe(Number(latestPointCore.getAttribute('cx')));
        expect(Number(latestPointHalo.getAttribute('cy'))).toBe(Number(latestPointCore.getAttribute('cy')));
        expect(latestPointAura).toHaveClass('activity-analytics-prod-trend-final-point-flicker', 'activity-analytics-prod-trend-final-point-flicker-aura');
        expect(latestPointHalo).toHaveClass('activity-analytics-prod-trend-final-point-flicker', 'activity-analytics-prod-trend-final-point-flicker-halo');
        expect(latestPointCore).toHaveAttribute('stroke-opacity', '0.42');
        expect(screen.queryByTestId('activity-analytics-prod-trend-final-missing-pulse')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-prod-trend-final-missing-core')).not.toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-groups')).toBeInTheDocument();
    });

    it('keeps the latest % PROD label above the endpoint when the float clearance still fits inside the top clamp', () => {
        expect(resolveProdTrendLatestValueLabelPlacement({ latestPointY: 20, chartTop: 8 })).toBe('below');
        expect(resolveProdTrendLatestValueLabelPlacement({ latestPointY: 80, chartTop: 8 })).toBe('above');
    });

    it('renders the latest null productivity bucket as a final missing pulse at the latest x-axis bucket without inventing a numeric point', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'day-1', label: '18/06', productivityRatio: 0.42, productivityLabel: '42%' }),
            buildGroupedBucket({ bucketKey: 'day-2', label: '19/06', productivityRatio: 0.7, productivityLabel: '70%' }),
            buildGroupedBucket({
                bucketKey: 'day-3',
                label: '20/06 (en curso)',
                productivityRatio: null,
                productivityLabel: 'sin datos',
                durationsMs: {
                    prod: 0,
                    setup: 0,
                    stopped: 0,
                    noData: 90 * 60 * 1000,
                },
                coverageRatio: 0.4,
                expectedDurationMs: 4.5 * 60 * 60 * 1000,
                isInProgress: true,
            }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        const trendChart = screen.getByTestId('activity-analytics-prod-trend-chart');
        const trendLabels = screen.getAllByTestId('activity-analytics-prod-trend-x-axis-label').map((node) => node.textContent);
        const groupLabels = getRenderedGroupXAxisLabels();
        const latestPoint = screen.getByTestId('activity-analytics-prod-trend-latest-point');
        const latestMissingPulse = screen.getByTestId('activity-analytics-prod-trend-final-missing-pulse');
        const latestMissingCore = screen.getByTestId('activity-analytics-prod-trend-final-missing-core');
        const renderablePointY = (trendChart.getAttribute('data-renderable-point-y') ?? '').split(',');

        expect(trendLabels).toEqual(groupLabels);
        expect(trendLabels).toEqual(['18/06', '19/06', '20/06']);
        expect((trendChart.getAttribute('data-bucket-keys') ?? '').split(',')).toEqual(['day-1', 'day-2', 'day-3']);
        expect(trendChart).toHaveAttribute('data-productivity-ratio', '0.4200,0.7000,null');
        expect(renderablePointY).toEqual([
            expect.stringMatching(/^[\d.]+$/),
            expect.stringMatching(/^[\d.]+$/),
            'null',
        ]);
        expect(trendChart).toHaveAttribute('data-latest-bucket-key', 'day-3');
        expect(trendChart).toHaveAttribute('data-partial-bucket-keys', 'day-3');
        expect(screen.queryByTestId('activity-analytics-prod-trend-final-point-pulse')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-prod-trend-final-point-core')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-prod-trend-partial-point')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-prod-trend-latest-value-label')).not.toBeInTheDocument();
        expect(latestPoint).toHaveAttribute('data-bucket-key', 'day-3');
        expect(latestPoint).toHaveAttribute('data-partial', 'true');
        expect(latestPoint).toHaveAttribute('data-value-state', 'missing');
        expect(Number(latestMissingPulse.getAttribute('cx'))).toBe(Number(latestMissingCore.getAttribute('cx')));
        expect(Number(latestMissingPulse.getAttribute('cy'))).toBe(Number(latestMissingCore.getAttribute('cy')));
        expect(latestMissingPulse).toHaveClass('animate-pulse');
    });

    it('does not render a stray middle partial or missing marker for 12m + shift whether the latest bucket is measured or fully closed', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'shift-1', label: 'Ene · Turno 1', productivityRatio: 0.44, productivityLabel: '44%' }),
            buildGroupedBucket({ bucketKey: 'shift-2', label: 'May · Turno 2', productivityRatio: null, productivityLabel: 'sin datos', isInProgress: true, coverageRatio: 0.4, durationsMs: { prod: 0, setup: 0, stopped: 0, noData: 1 } }),
            buildGroupedBucket({ bucketKey: 'shift-3', label: 'Jun · Turno 3', productivityRatio: 0.71, productivityLabel: '71%', isInProgress: true }),
        ]);

        const { rerender } = render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '12m', groupBy: 'shift' } })}
                machines={MACHINES}
            />,
        );

        rerender(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '12m', groupBy: 'shift' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        expect(screen.queryByTestId('activity-analytics-prod-trend-partial-point')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-prod-trend-final-missing-pulse')).not.toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-prod-trend-latest-point').getAttribute('data-bucket-key')).not.toBe('shift-2');

        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'shift-1', label: 'Ene · Turno 1', productivityRatio: 0.44, productivityLabel: '44%' }),
            buildGroupedBucket({ bucketKey: 'shift-2', label: 'May · Turno 2', productivityRatio: null, productivityLabel: 'sin datos', isInProgress: true, coverageRatio: 0.4, durationsMs: { prod: 0, setup: 0, stopped: 0, noData: 1 } }),
            buildGroupedBucket({ bucketKey: 'shift-3', label: 'Jun · Turno 3', productivityRatio: 0.71, productivityLabel: '71%', isInProgress: false }),
        ]);

        rerender(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '12m', groupBy: 'shift' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        expect(screen.queryByTestId('activity-analytics-prod-trend-partial-point')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-prod-trend-final-missing-pulse')).not.toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-prod-trend-latest-point').getAttribute('data-bucket-key')).not.toBe('shift-2');
    });

    it.each([
        ['7d', 'shift'],
        ['7d', 'day'],
        ['30d', 'shift'],
        ['30d', 'day'],
        ['30d', 'week'],
        ['12m', 'shift'],
        ['12m', 'month'],
    ] as const)('renders % PROD trend without stray partial or missing markers for %s + %s', (range, groupBy) => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: `${range}-${groupBy}-1`, label: 'Bucket 1', productivityRatio: 0.25, productivityLabel: '25%' }),
            buildGroupedBucket({ bucketKey: `${range}-${groupBy}-2`, label: 'Bucket 2', productivityRatio: null, productivityLabel: 'sin datos', isInProgress: true, coverageRatio: 0.4, durationsMs: { prod: 0, setup: 0, stopped: 0, noData: 1 } }),
            buildGroupedBucket({ bucketKey: `${range}-${groupBy}-3`, label: 'Bucket 3', productivityRatio: 0.6, productivityLabel: '60%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range, groupBy } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        expect(screen.queryByTestId('activity-analytics-prod-trend-partial-point')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-prod-trend-final-missing-pulse')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-prod-trend-final-missing-core')).not.toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-prod-trend-latest-point')).toHaveAttribute('data-bucket-key', `${range}-${groupBy}-3`);
    });

    it.each([
        ['7d', 'day'],
        ['12m', 'shift'],
    ] as const)('aligns trend first and last x-axis labels with Groups for %s + %s', (range, groupBy) => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: `${range}-${groupBy}-1`, label: 'Bucket 1', productivityRatio: 0.3, productivityLabel: '30%' }),
            buildGroupedBucket({ bucketKey: `${range}-${groupBy}-2`, label: 'Bucket 2', productivityRatio: 0.55, productivityLabel: '55%' }),
            buildGroupedBucket({ bucketKey: `${range}-${groupBy}-3`, label: 'Bucket 3', productivityRatio: 0.8, productivityLabel: '80%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range, groupBy } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 640, bodyHeight: 420 });
        });

        const trendLabels = screen.getAllByTestId('activity-analytics-prod-trend-x-axis-label');
        const groupLabels = getRenderedGroupXAxisLabelNodes();

        expect(trendLabels[0]?.getAttribute('x')).toBe(groupLabels[0]?.getAttribute('x'));
        expect(trendLabels.at(-1)?.getAttribute('x')).toBe(groupLabels.at(-1)?.getAttribute('x'));
        expect(trendLabels[0]).toHaveAttribute('text-anchor', 'middle');
        expect(trendLabels.at(-1)).toHaveAttribute('text-anchor', 'middle');
    });

    it('shows the comparable-data empty state for a single trend bucket', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'day-1', label: '18/06', productivityRatio: 0.8, productivityLabel: '80%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        expect(screen.queryByTestId('activity-analytics-prod-trend-line')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-prod-trend-area')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-prod-trend-traveling-glow')).not.toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-prod-trend-empty')).toHaveTextContent('Sin datos comparables');
    });

    it('keeps the trend panel stable when grouped productivity is empty or non-comparable', () => {
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
                label: '18/06',
                coverageRatio: 0.5,
                productivityRatio: null,
                productivityLabel: 'sin datos',
                durationsMs: { prod: 0, setup: 0, stopped: 0, noData: 1 * 60 * 60 * 1000 },
            }),
            buildGroupedBucket({
                bucketKey: 'day-2',
                label: '19/06',
                coverageRatio: 0.25,
                productivityRatio: null,
                productivityLabel: 'sin datos',
                durationsMs: { prod: 0, setup: 0, stopped: 0, noData: 1 * 60 * 60 * 1000 },
            }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        const trendChart = screen.getByTestId('activity-analytics-prod-trend-chart');

        expect(trendChart).toBeInTheDocument();
        expect(trendChart).toHaveAttribute('data-productivity-ratio', 'null,null');
        expect(screen.queryByTestId('activity-analytics-prod-trend-line')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-prod-trend-area')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-prod-trend-traveling-glow')).not.toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-prod-trend-empty')).toHaveTextContent('Sin datos comparables');
    });

    it('keeps Resumen and Mejor/Peor in the same top row at compact supported widths', () => {
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

        expect(screen.getByTestId('activity-analytics-top-region')).toHaveAttribute('data-top-layout', 'side-by-side');
        expect(Number(screen.getByTestId('activity-analytics-top-region').getAttribute('data-top-overlap-px'))).toBe(0);
        expect(screen.getByTestId('activity-analytics-top-region')).toHaveAttribute('data-top-gap-px', '12.00');
        expect(screen.getByTestId('activity-analytics-summary-bars')).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-comparison')).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-comparison-column')).toHaveAttribute('data-comparison-column-width-px', '132.00');
        expect(screen.getByTestId('activity-analytics-summary-column')).toHaveAttribute('data-summary-column-width-px', '376.00');
        expect(screen.queryByTestId('activity-analytics-summary-text')).not.toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-groups-panel')).toHaveAttribute('data-groups-density', 'text-fallback');
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

        const coverageColor = '#5b86ff';
        const widget = makeWidget({
            displayOptions: {
                ...makeWidget().displayOptions,
                range: '7d',
                groupBy: 'day',
                coverageColor,
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
            emitActivityAnalyticsLayoutSize({ bodyWidth: 848, bodyHeight: CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX });
        });

        const summaryChart = screen.getByTestId('activity-analytics-summary-chart');
        const summaryGradients = Array.from(summaryChart.querySelectorAll('linearGradient'))
            .filter((gradient) => !gradient.id.includes('top-cap'));
        const summaryStops = summaryGradients.map((gradient) => Array.from(gradient.querySelectorAll('stop')).map((stop) => stop.getAttribute('stop-color')));
        const detailMarkers = Array.from(screen.getByTestId('activity-analytics-summary-details').querySelectorAll('rect'));
        const groupsChart = screen.getByTestId('activity-analytics-groups-chart');
        const groupGradients = Array.from(groupsChart.querySelectorAll('linearGradient'))
            .filter((gradient) => !gradient.id.includes('group-top-cap'));
        const groupStops = groupGradients.map((gradient) => Array.from(gradient.querySelectorAll('stop')).map((stop) => stop.getAttribute('stop-color')));
        const firstGroupStack = screen.getByTestId('activity-analytics-group-stack');
        const groupSegments = within(firstGroupStack).getAllByTestId('activity-analytics-group-segment');
        const topCaps = within(firstGroupStack).queryAllByTestId('activity-analytics-group-top-cap');
        const legendSwatches = Array.from(screen.getByTestId('activity-analytics-groups-header-legend').querySelectorAll('span[aria-hidden="true"]'));
        const comparisonFills = screen.getAllByTestId('activity-analytics-comparison-bar-fill');

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
            CUSTOM_STATE_GRADIENTS.prod[0],
            CUSTOM_STATE_GRADIENTS.setup[1],
            CUSTOM_STATE_GRADIENTS.stopped[0],
        ]);
        expect(groupSegments.map((segment) => segment.getAttribute('fill'))).toEqual([
            coverageColor,
            expect.stringMatching(/^url\(#.+-stopped-gradient\)$/),
            expect.stringMatching(/^url\(#.+-setup-gradient\)$/),
            expect.stringMatching(/^url\(#.+-prod-gradient\)$/),
        ]);
        expect(legendSwatches.map((swatch) => (swatch as HTMLElement).style.backgroundColor)).toEqual([
            hexToRgbCss(CUSTOM_STATE_GRADIENTS.stopped[0]),
            hexToRgbCss(CUSTOM_STATE_GRADIENTS.setup[1]),
            hexToRgbCss(CUSTOM_STATE_GRADIENTS.prod[0]),
            hexToRgbCss(coverageColor),
        ]);
        expect(detailMarkers[1]?.getAttribute('fill')).toBe(CUSTOM_STATE_GRADIENTS.setup[1]);
        expect((legendSwatches[1] as HTMLElement | undefined)?.style.backgroundColor).toBe(hexToRgbCss(detailMarkers[1]?.getAttribute('fill') ?? ''));
        expect(screen.getByTestId('activity-analytics-groups-header-legend')).toHaveTextContent('Cob. incompleta');
        expect(topCaps).toHaveLength(0);
        comparisonFills.forEach((segment) => {
            expect(parsePercentHeight((segment as HTMLElement).style.height)).toBeCloseTo((2 / 3) * 100, 5);
            expect(segment.getAttribute('style')).toContain(`linear-gradient(to top, ${hexToRgbCss(CUSTOM_STATE_GRADIENTS.prod[0])} 0%, ${hexToRgbCss(CUSTOM_STATE_GRADIENTS.prod[1])} 100%)`);
        });

        await user.click(screen.getByRole('button', { name: 'Hover first bucket' }));

        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent(CUSTOM_STATE_GRADIENTS.prod[0]);
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent(CUSTOM_STATE_GRADIENTS.setup[0]);
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent(CUSTOM_STATE_GRADIENTS.stopped[0]);
        expect(screen.getByTestId('hover-layer')).toHaveAttribute(
            'data-highlight-colors',
            [
                coverageColor,
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
        expect(screen.getByTestId('activity-analytics-comparison')).toHaveTextContent('60%');
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
            emitActivityAnalyticsLayoutSize({ bodyWidth: 848, bodyHeight: CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX });
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
        const comparisonFills = screen.getAllByTestId('activity-analytics-comparison-bar-fill');
        const movingSummaryTopCap = screen.getByTestId('activity-analytics-summary-top-cap');

        expect(summaryBodyStops.map((stop) => stop.getAttribute('stop-opacity'))).toEqual([
            '0.55', '0.2',
            '0.65', '0.5',
            '0.35', '0.75',
        ]);
        expect(summaryTopCapStops.map((stop) => stop.getAttribute('stop-color'))).toEqual([
            topCapHighlightColor(CUSTOM_STATE_GRADIENTS.stopped[0], TOP_CAP_HIGHLIGHT_MIX_BY_STATE.stopped),
            CUSTOM_STATE_GRADIENTS.stopped[0],
            topCapHighlightColor(CUSTOM_STATE_GRADIENTS.setup[0], TOP_CAP_HIGHLIGHT_MIX_BY_STATE.setup),
            CUSTOM_STATE_GRADIENTS.setup[0],
            topCapHighlightColor(CUSTOM_STATE_GRADIENTS.prod[0], TOP_CAP_HIGHLIGHT_MIX_BY_STATE.prod),
            CUSTOM_STATE_GRADIENTS.prod[0],
        ]);
        expect(summaryTopCapStops.map((stop) => stop.getAttribute('stop-opacity'))).toEqual([
            '1', '1',
            '1', '1',
            '1', '1',
        ]);
        expect(detailMarkers.map((marker) => marker.getAttribute('fill'))).toEqual([
            hexToRgbaCss(CUSTOM_STATE_GRADIENTS.prod[0], CUSTOM_STATE_GRADIENT_ALPHAS.prod[0]),
            hexToRgbaCss(CUSTOM_STATE_GRADIENTS.setup[1], CUSTOM_STATE_GRADIENT_ALPHAS.setup[1]),
            hexToRgbaCss(CUSTOM_STATE_GRADIENTS.stopped[0], CUSTOM_STATE_GRADIENT_ALPHAS.stopped[0]),
        ]);
        expect(summarySegments.every((segment) => segment.getAttribute('filter')?.includes('summary-glow'))).toBe(true);
        const summaryGlowFilter = summaryChart.querySelector('filter[id$="-summary-glow"]');

        expect(summaryGlowFilter).not.toBeNull();
        expect(summaryGlowFilter).toHaveAttribute('x', '-60%');
        expect(summaryGlowFilter).toHaveAttribute('y', '-60%');
        expect(summaryGlowFilter).toHaveAttribute('width', '220%');
        expect(summaryGlowFilter).toHaveAttribute('height', '220%');
        expect(summaryGlowFilter?.innerHTML).toContain('surface-core-blur');
        expect(summaryGlowFilter?.innerHTML).toContain('surface-aura-blur');
        expect(summaryGlowFilter?.innerHTML).toContain('surface-core-glow');
        expect(summaryGlowFilter?.innerHTML).toContain('surface-aura-glow');
        expect(summaryGlowFilter?.innerHTML).toContain('feMerge');
        expect(summaryGlowFilter?.querySelector('feGaussianBlur[result="surface-core-blur"]')).toHaveAttribute('stdDeviation', '4.26');
        expect(summaryGlowFilter?.querySelector('feGaussianBlur[result="surface-aura-blur"]')).toHaveAttribute('stdDeviation', '6.32');
        expect(summaryGlowFilter?.querySelector('feColorMatrix[result="surface-core-glow"]')).toHaveAttribute('values', '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1.43 0');
        expect(summaryGlowFilter?.querySelector('feColorMatrix[result="surface-aura-glow"]')).toHaveAttribute('values', '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0.3 0');
        const movingSummaryTopCapAura = within(movingSummaryTopCap).getByTestId('activity-analytics-summary-top-cap-aura');
        const movingSummaryTopCapHalo = within(movingSummaryTopCap).getByTestId('activity-analytics-summary-top-cap-halo');
        const movingSummaryTopCapCore = within(movingSummaryTopCap).getByTestId('activity-analytics-summary-top-cap-core');
        expect(movingSummaryTopCap).toHaveStyle({ mixBlendMode: 'screen' });
        expect(movingSummaryTopCapAura.getAttribute('stroke')).toContain('-top-cap-gradient');
        expect(movingSummaryTopCapHalo.getAttribute('stroke')).toContain('-top-cap-gradient');
        expect(movingSummaryTopCapCore.getAttribute('stroke')).toContain('-top-cap-gradient');
        expect(movingSummaryTopCapAura.getAttribute('filter')).toMatch(/^url\(#.+-summary-top-cap-traveling-glow\)$/);
        expect(movingSummaryTopCapHalo.getAttribute('filter')).toMatch(/^url\(#.+-summary-top-cap-traveling-glow\)$/);
        expect(summarySegments.map((segment) => Number(segment.getAttribute('stroke-width')))).toContainEqual(expect.any(Number));
        expect(Number(movingSummaryTopCapCore.getAttribute('stroke-width'))).toBeGreaterThanOrEqual(Number(summarySegments.find((segment) => segment.getAttribute('data-segment-key') === movingSummaryTopCap.getAttribute('data-segment-key'))?.getAttribute('stroke-width')));
        expect(groupSegments.filter((segment) => segment.getAttribute('data-segment-key') !== 'noData').every((segment) => segment.getAttribute('filter')?.includes('grouped-glow'))).toBe(true);
        const groupedChart = screen.getByTestId('activity-analytics-groups-chart');
        const groupedGlowFilter = groupedChart.querySelector('filter[id$="-grouped-glow"]');

        expect(groupedGlowFilter).not.toBeNull();
        expect(groupedGlowFilter).toHaveAttribute('x', '-60%');
        expect(groupedGlowFilter).toHaveAttribute('y', '-60%');
        expect(groupedGlowFilter).toHaveAttribute('width', '220%');
        expect(groupedGlowFilter).toHaveAttribute('height', '220%');
        expect(groupedGlowFilter?.innerHTML).toContain('surface-core-blur');
        expect(groupedGlowFilter?.innerHTML).toContain('surface-aura-blur');
        expect(groupedGlowFilter?.innerHTML).toContain('surface-core-glow');
        expect(groupedGlowFilter?.innerHTML).toContain('surface-aura-glow');
        expect(Number.parseFloat(groupedGlowFilter?.querySelector('feGaussianBlur[result="surface-core-blur"]')?.getAttribute('stdDeviation') ?? '0')).toBeGreaterThan(2.3);
        expect(Number.parseFloat(groupedGlowFilter?.querySelector('feGaussianBlur[result="surface-aura-blur"]')?.getAttribute('stdDeviation') ?? '0')).toBeGreaterThan(6.5);
        expect(screen.queryByTestId('activity-analytics-group-top-cap')).not.toBeInTheDocument();
        expect(legendSwatches.map((swatch) => (swatch as HTMLElement).style.backgroundColor)).toEqual([
            hexToRgbaCss(CUSTOM_STATE_GRADIENTS.stopped[0], CUSTOM_STATE_GRADIENT_ALPHAS.stopped[0]),
            hexToRgbaCss(CUSTOM_STATE_GRADIENTS.setup[1], CUSTOM_STATE_GRADIENT_ALPHAS.setup[1]),
            hexToRgbaCss(CUSTOM_STATE_GRADIENTS.prod[0], CUSTOM_STATE_GRADIENT_ALPHAS.prod[0]),
            hexToRgbCss('#94a3b8'),
        ]);
        expect(detailMarkers[1]?.getAttribute('fill')).toBe(hexToRgbaCss(CUSTOM_STATE_GRADIENTS.setup[1], CUSTOM_STATE_GRADIENT_ALPHAS.setup[1]));
        expect((legendSwatches[1] as HTMLElement | undefined)?.style.backgroundColor).toBe(detailMarkers[1]?.getAttribute('fill'));
        expect(screen.getByTestId('activity-analytics-groups-header-legend')).toHaveTextContent('Cob. incompleta');
        comparisonFills.forEach((segment) => {
            expect(segment.getAttribute('style')).toContain(`linear-gradient(to top, ${hexToRgbaCss(CUSTOM_STATE_GRADIENTS.prod[0], CUSTOM_STATE_GRADIENT_ALPHAS.prod[0])} 0%, ${hexToRgbaCss(CUSTOM_STATE_GRADIENTS.prod[1], CUSTOM_STATE_GRADIENT_ALPHAS.prod[1])} 100%)`);
        });

        await user.click(screen.getByRole('button', { name: 'Hover first bucket' }));

        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent(hexToRgbaCss(CUSTOM_STATE_GRADIENTS.prod[0], CUSTOM_STATE_GRADIENT_ALPHAS.prod[0]));
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent(hexToRgbaCss(CUSTOM_STATE_GRADIENTS.setup[0], CUSTOM_STATE_GRADIENT_ALPHAS.setup[0]));
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent(hexToRgbaCss(CUSTOM_STATE_GRADIENTS.stopped[0], CUSTOM_STATE_GRADIENT_ALPHAS.stopped[0]));
        expect(screen.getByTestId('hover-layer')).toHaveAttribute(
            'data-highlight-colors',
            [
                '#94a3b8',
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
                                glow: 100,
                                topCap: true,
                                topCapGlow: 95,
                            },
                            donut: {
                                ...CUSTOM_VISUAL_EFFECTS.donut,
                                glow: 100,
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
        expect(screen.getByTestId('activity-analytics-comparison')).toHaveTextContent('60%');
        const strongSummaryGlowFilter = screen.getByTestId('activity-analytics-summary-chart').querySelector('filter[id$="-summary-glow"]');
        const strongGroupedGlowFilter = screen.getByTestId('activity-analytics-groups-chart').querySelector('filter[id$="-grouped-glow"]');
        expect(Number.parseFloat(strongSummaryGlowFilter?.querySelector('feGaussianBlur[result="surface-core-blur"]')?.getAttribute('stdDeviation') ?? '0')).toBeGreaterThan(5.4);
        expect(Number.parseFloat(strongSummaryGlowFilter?.querySelector('feGaussianBlur[result="surface-aura-blur"]')?.getAttribute('stdDeviation') ?? '0')).toBeGreaterThan(12.5);
        expect(strongSummaryGlowFilter?.querySelector('feColorMatrix[result="surface-core-glow"]')?.getAttribute('values')).toContain('2.1');
        expect(strongSummaryGlowFilter?.querySelector('feColorMatrix[result="surface-aura-glow"]')?.getAttribute('values')).toContain('0.9');
        expect(Number.parseFloat(strongGroupedGlowFilter?.querySelector('feGaussianBlur[result="surface-core-blur"]')?.getAttribute('stdDeviation') ?? '0')).toBeGreaterThan(2.1);
        expect(Number.parseFloat(strongGroupedGlowFilter?.querySelector('feGaussianBlur[result="surface-aura-blur"]')?.getAttribute('stdDeviation') ?? '0')).toBeGreaterThan(7.2);
        expect(strongGroupedGlowFilter?.querySelector('feColorMatrix[result="surface-core-glow"]')?.getAttribute('values')).toContain('2');
        expect(strongGroupedGlowFilter?.querySelector('feColorMatrix[result="surface-aura-glow"]')?.getAttribute('values')).toContain('0.9');
        const groupedTopCaps = screen.getAllByTestId('activity-analytics-group-top-cap');
        expect(groupedTopCaps).toHaveLength(3);
        expect(groupedTopCaps.at(-1)).toHaveAttribute('fill', topCapHighlightColor(CUSTOM_STATE_GRADIENTS.prod[0], TOP_CAP_HIGHLIGHT_MIX_BY_STATE.prod));
        expect(groupedTopCaps.at(-1)?.getAttribute('style')).toContain(`drop-shadow(0 0 5.8px ${CUSTOM_STATE_GRADIENTS.prod[0]})`);
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
        expect(screen.getByTestId('activity-analytics-top-region')).toHaveAttribute('data-top-gap-px', '12.00');
        expect(chartWidth).toBe(176);
        expect(within(summaryChart).queryAllByTestId('activity-analytics-summary-segment-label')).toHaveLength(0);
    });

    it('never stacks the top region and keeps the A/B widths side-by-side without overlap as the widget narrows', () => {
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

        const compactTopRegion = screen.getByTestId('activity-analytics-top-region');
        const compactSummaryWidth = Number(screen.getByTestId('activity-analytics-summary-column').getAttribute('data-summary-column-width-px'));
        const compactComparisonWidth = Number(screen.getByTestId('activity-analytics-comparison-column').getAttribute('data-comparison-column-width-px'));

        expect(compactTopRegion).toHaveAttribute('data-top-layout', 'side-by-side');
        expect(Number(compactTopRegion.getAttribute('data-top-overlap-px'))).toBe(0);
        expect(Number(compactTopRegion.getAttribute('data-top-gap-px'))).toBe(12);
        expect(compactSummaryWidth + compactComparisonWidth + Number(compactTopRegion.getAttribute('data-top-gap-px'))).toBeCloseTo(520, 1);

        act(() => {
            MockResizeObserver.latest().emit(847, 360);
        });

        const wideTopRegion = screen.getByTestId('activity-analytics-top-region');
        const wideSummaryWidth = Number(screen.getByTestId('activity-analytics-summary-column').getAttribute('data-summary-column-width-px'));
        const wideComparisonWidth = Number(screen.getByTestId('activity-analytics-comparison-column').getAttribute('data-comparison-column-width-px'));

        expect(wideTopRegion).toHaveAttribute('data-top-layout', 'side-by-side');
        expect(Number(wideTopRegion.getAttribute('data-top-overlap-px'))).toBe(0);
        expect(wideSummaryWidth + wideComparisonWidth + Number(wideTopRegion.getAttribute('data-top-gap-px'))).toBeCloseTo(847, 1);
    });

    it('keeps Panel B at its content-min width until the donut has used the available top-row width, then caps its growth at wider widths', () => {
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
            emitActivityAnalyticsLayoutSize({ bodyWidth: 420, bodyHeight: 420 });
        });

        const summaryChart = screen.getByTestId('activity-analytics-summary-chart');
        const summaryColumn = screen.getByTestId('activity-analytics-summary-column');
        const comparisonColumn = screen.getByTestId('activity-analytics-comparison-column');
        const comparisonWidthAt420 = Number(comparisonColumn.getAttribute('data-comparison-column-width-px'));
        const summaryWidthAt420 = Number(summaryColumn.getAttribute('data-summary-column-width-px'));

        expect(screen.getByTestId('activity-analytics-top-region')).toHaveAttribute('data-top-layout', 'side-by-side');
        expect(screen.getByTestId('activity-analytics-top-region')).toHaveAttribute('data-top-gap-px', '12.00');
        expect(comparisonWidthAt420).toBe(132);
        expect(summaryWidthAt420).toBe(276);
        expect(Number(summaryChart.getAttribute('width'))).toBeCloseTo(summaryWidthAt420, 0);
        expect(Number(summaryChart.getAttribute('width'))).toBeLessThanOrEqual(480);

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 1260, bodyHeight: 420 });
        });

        const comparisonWidthAt1260 = Number(comparisonColumn.getAttribute('data-comparison-column-width-px'));
        const summaryChartWidthAt1260 = Number(screen.getByTestId('activity-analytics-summary-chart').getAttribute('width'));
        const summaryWidthAt1260 = Number(summaryColumn.getAttribute('data-summary-column-width-px'));

        expect(comparisonWidthAt1260).toBe(208);
        expect(summaryWidthAt1260 + comparisonWidthAt1260 + Number(screen.getByTestId('activity-analytics-top-region').getAttribute('data-top-gap-px'))).toBeCloseTo(1260, 1);
        expect(summaryChartWidthAt1260).toBe(480);
        expect(summaryChartWidthAt1260).toBeLessThanOrEqual(480);

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 603, bodyHeight: 420 });
        });

        const widthAt603 = Number(summaryColumn.getAttribute('data-summary-column-width-px'));
        const comparisonWidthAt603 = Number(comparisonColumn.getAttribute('data-comparison-column-width-px'));

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 520, bodyHeight: 420 });
        });

        const widthAt520 = Number(summaryColumn.getAttribute('data-summary-column-width-px'));
        const comparisonWidthAt520 = Number(comparisonColumn.getAttribute('data-comparison-column-width-px'));

        expect(comparisonWidthAt603).toBe(132);
        expect(widthAt603 + comparisonWidthAt603 + Number(screen.getByTestId('activity-analytics-top-region').getAttribute('data-top-gap-px'))).toBeCloseTo(603, 1);
        expect(widthAt520).toBeLessThan(widthAt603);
        expect(comparisonWidthAt520).toBe(132);
        expect(widthAt520 + comparisonWidthAt520 + Number(screen.getByTestId('activity-analytics-top-region').getAttribute('data-top-gap-px'))).toBeCloseTo(520, 1);
        expect(screen.getByTestId('activity-analytics-top-region')).toHaveAttribute('data-top-layout', 'side-by-side');
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
        expect(detailSections).toHaveLength(4);
        expect(detailSections.map((section) => within(section).getByTestId('activity-analytics-summary-detail-title').textContent)).toEqual([
            'Producción',
            'Setup',
            'Detenida',
            'Cobertura',
        ]);
        expect(detailSections.map((section) => (
            within(section).queryByTestId('activity-analytics-summary-detail-value')
            ?? within(section).queryByTestId('activity-analytics-summary-coverage')
        )?.textContent)).toEqual([
            '57%',
            '29%',
            '14%',
            '100%',
        ]);
    });

    it('keeps runtime granularity controls visible and disables unavailable options by range', async () => {
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
        expect(screen.getByRole('button', { name: 'TURNO' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'DÍA' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'SEMANA' })).toBeDisabled();

        await user.click(screen.getByRole('button', { name: '30d' }));

        expect(screen.getByRole('button', { name: 'TURNO' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'DÍA' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'SEMANA' })).toBeEnabled();
        expect(screen.queryByTestId('activity-analytics-turno-mode')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '1h' })).not.toBeInTheDocument();
        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(3);
        expect(screen.getAllByText('Turno 1').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Turno 2').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Turno 3').length).toBeGreaterThan(0);
        expect(screen.queryByText('2026-06-19 · Turno 1 (en curso)')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-group-partial-outline')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '12m' }));

        expect(screen.getByRole('button', { name: 'TURNO' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'DÍA' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'SEMANA' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'MES' })).toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-turno-mode')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(3);
        expect(screen.getAllByText('Turno 1').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Turno 2').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Turno 3').length).toBeGreaterThan(0);
        expect(screen.queryByText('2026-06-19 · Turno 1 (en curso)')).not.toBeInTheDocument();
        expect(screen.queryByTestId('activity-analytics-group-partial-outline')).not.toBeInTheDocument();
    });

    it('updates the Groups title to describe the active range and bucket granularity', async () => {
        const user = userEvent.setup();
        const expectGroupsTitle = (title: string) => {
            expect(screen.getByText((_, element) => element?.textContent === title)).toBeInTheDocument();
        };

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

        expectGroupsTitle('RENDIMIENTO POR TURNO (ÚLTIMOS 7 DÍAS)');

        await user.click(screen.getByRole('button', { name: 'Detalle' }));
        expectGroupsTitle('RENDIMIENTO POR TURNO (ÚLTIMOS 7 DÍAS)');

        await user.click(screen.getByRole('button', { name: 'DÍA' }));
        expectGroupsTitle('RENDIMIENTO DIARIO (ÚLTIMOS 7 DÍAS)');

        await user.click(screen.getByRole('button', { name: '30d' }));
        expectGroupsTitle('RENDIMIENTO DIARIO (ÚLTIMOS 30 DÍAS)');

        await user.click(screen.getByRole('button', { name: 'TURNO' }));
        expectGroupsTitle('RENDIMIENTO POR TURNO (ÚLTIMOS 30 DÍAS)');

        await user.click(screen.getByRole('button', { name: 'SEMANA' }));
        expectGroupsTitle('RENDIMIENTO SEMANAL (ÚLTIMOS 30 DÍAS)');

        await user.click(screen.getByRole('button', { name: '12m' }));
        expectGroupsTitle('RENDIMIENTO POR TURNO (ÚLTIMOS 12 MESES)');

        await user.click(screen.getByRole('button', { name: 'MES' }));
        expectGroupsTitle('RENDIMIENTO MENSUAL (ÚLTIMOS 12 MESES)');
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
        expect(screen.getByRole('button', { name: 'TURNO' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'DÍA' })).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-turno-mode')).toBeInTheDocument();
    });

    it('does not allow selecting a disabled granularity option', async () => {
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

        const disabledWeekButton = screen.getByRole('button', { name: 'SEMANA' });
        const disabledMonthButton = screen.getByRole('button', { name: 'MES' });

        expect(disabledWeekButton).toBeDisabled();
        expect(disabledMonthButton).toBeDisabled();
        expect(screen.getByRole('button', { name: 'DÍA' })).toHaveAttribute('aria-pressed', 'true');

        await user.click(disabledWeekButton);
        await user.click(disabledMonthButton);

        expect(screen.getByRole('button', { name: 'DÍA' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'SEMANA' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'MES' })).toHaveAttribute('aria-pressed', 'false');
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
        const groupsChart = screen.getByTestId('activity-analytics-groups-chart');

        expect(groupStacks).toHaveLength(4);
        expect(within(groupsChart).getAllByText('2026-06-19 · Turno 1').length).toBeGreaterThan(0);
        expect(within(groupsChart).queryByText('2026-06-19 · Turno 1 (en curso)')).not.toBeInTheDocument();
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
        expect(within(screen.getByTestId('activity-analytics-summary-bars')).getByText('DISTRIBUCIÓN')).toBeInTheDocument();
        expect(screen.queryByText('% Prod. 57% · Cobertura 100%')).not.toBeInTheDocument();
        expect(yAxisTicks).toContain('4h');
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

        const groupsChart = screen.getByTestId('activity-analytics-groups-chart');

        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(1);
        expect(within(groupsChart).getByText('Turno 1')).toBeInTheDocument();
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
            MockResizeObserver.latest().emit(520, CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX);
        });

        const groupsChart = screen.getByTestId('activity-analytics-groups-chart');
        const firstDateLabel = Array.from(groupsChart.querySelectorAll('text')).find((node) => node.textContent === '2026-06-18');
        const firstYAxisTick = screen.getAllByTestId('activity-analytics-y-axis-tick')[0];
        const hoverLayer = screen.getByTestId('hover-layer');
        const chartShell = screen.getByTestId('activity-analytics-groups-chart-shell');
        const chartViewport = screen.getByTestId('activity-analytics-groups-chart-viewport');
        const marginLeft = Number(hoverLayer.getAttribute('data-margin-left'));

        expect(screen.getByTestId('activity-analytics-groups-panel')).toHaveAttribute('data-groups-density', 'compress');
        expect(screen.queryByTestId('activity-analytics-groups-scroll-region')).not.toBeInTheDocument();
        expect(groupsChart).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-groups')).toHaveClass('px-0', 'pb-0', 'pt-2');
        expect(screen.getByTestId('activity-analytics-groups')).not.toHaveClass('-mb-5');
        expect(screen.getByTestId('activity-analytics-groups')).not.toHaveClass('-mx-5');
        expect(chartShell).toHaveClass('mt-2', 'flex', 'min-h-0', 'flex-1', 'flex-col', 'px-5', 'pb-5');
        expect(chartViewport).toHaveClass('relative', 'flex-1', 'min-h-0', '-mx-3', '-mb-3', 'flex', 'items-end');
        expect(groupsChart.parentElement).toHaveClass('self-end');
        expect(groupsChart.parentElement?.parentElement).toBe(chartViewport);
        expect(Number(firstYAxisTick.getAttribute('x'))).toBe(marginLeft - 8);
        expect(Number(groupsChart.getAttribute('height')) - Number(firstDateLabel?.getAttribute('y'))).toBe(8);
        expect(hoverLayer).toHaveAttribute('data-margin-left', '38');
    });

    it('compresses grouped inter-bar spacing as the widget narrows and re-expands it when width returns', () => {
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

        const readGap = () => {
            const stacks = screen.getAllByTestId('activity-analytics-group-stack');
            const firstVisible = within(stacks[0] as HTMLElement)
                .getAllByTestId('activity-analytics-group-segment')
                .find((segment) => Number(segment.getAttribute('height')) > 0);
            const secondVisible = within(stacks[1] as HTMLElement)
                .getAllByTestId('activity-analytics-group-segment')
                .find((segment) => Number(segment.getAttribute('height')) > 0);

            if (!firstVisible || !secondVisible) {
                throw new Error('Missing visible grouped segments for spacing assertion');
            }

            const firstMetrics = parseRectMetrics(firstVisible);
            const secondMetrics = parseRectMetrics(secondVisible);

            return secondMetrics.x - (firstMetrics.x + firstMetrics.width);
        };

        act(() => {
            MockResizeObserver.latest().emit(760, CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX);
        });
        const wideGap = readGap();

        act(() => {
            MockResizeObserver.latest().emit(520, CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX);
        });
        const narrowGap = readGap();

        act(() => {
            MockResizeObserver.latest().emit(760, CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX);
        });
        const wideGapAgain = readGap();

        expect(narrowGap).toBeLessThan(wideGap);
        expect(wideGapAgain).toBeCloseTo(wideGap, 1);
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
            MockResizeObserver.latest().emit(480, CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX);
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
            MockResizeObserver.latest().emit(320, CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX);
        });

        const scrollRegion = screen.getByTestId('activity-analytics-groups-scroll-region');
        const groupsChart = screen.getByTestId('activity-analytics-groups-chart');
        const dateLabel = Array.from(groupsChart.querySelectorAll('text')).find((node) => node.textContent === '2026-06-18');
        const firstYAxisTick = screen.getAllByTestId('activity-analytics-y-axis-tick')[0];
        const hoverLayer = screen.getByTestId('hover-layer');
        const chartShell = screen.getByTestId('activity-analytics-groups-chart-shell');
        const marginLeft = Number(hoverLayer.getAttribute('data-margin-left'));

        expect(chartShell).toHaveClass('mt-2', 'flex', 'min-h-0', 'flex-1', 'flex-col', 'px-5', 'pb-5');
        expect(scrollRegion).toHaveClass('relative', 'flex-1', 'min-h-0', '-mx-3', '-mb-3', 'flex', 'items-end', 'hmi-scrollbar');
        expect(scrollRegion.className).not.toContain('pb-2');
        expect(screen.getByTestId('activity-analytics-groups-panel')).toHaveAttribute('data-groups-density', 'scroll');
        expect(screen.getByTestId('activity-analytics-groups')).not.toHaveClass('-mb-5');
        expect(screen.getByTestId('activity-analytics-groups')).not.toHaveClass('-mx-5');
        expect(groupsChart).toBeInTheDocument();
        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(6);
        expect(screen.getAllByTestId('activity-analytics-group-segment')).toHaveLength(24);
        expect(screen.getAllByTestId('activity-analytics-group-productivity')).toHaveLength(6);
        expect(groupsChart.parentElement).toHaveClass('self-end');
        expect(dateLabel).toBeTruthy();
        expect(dateLabel?.getAttribute('style')).toContain('var(--font-chart)');
        expect(Number(groupsChart.getAttribute('height')) - Number(dateLabel?.getAttribute('y'))).toBe(8);
        expect(Number(firstYAxisTick.getAttribute('x'))).toBe(marginLeft - 8);
        expect(hoverLayer).toHaveAttribute('data-margin-left', '38');
        expect(screen.getAllByText('2026-06-18').length).toBeGreaterThan(0);
        expect(screen.getAllByText('2026-06-23').length).toBeGreaterThan(0);

        await user.click(screen.getByRole('button', { name: 'Hover first bucket' }));

        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('2026-06-18');
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Prod.');
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Setup');
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Detenida');
        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('Cobertura incompleta');
        expect(screen.getByTestId('chart-tooltip')).toHaveClass(
            'rounded-lg',
            'border',
            'border-industrial-border',
            'bg-[linear-gradient(135deg,rgba(9,13,22,0.57)_0%,rgba(17,24,39,0.52)_100%)]',
            'px-3',
            'py-2',
            'shadow-lg',
            'backdrop-blur-sm',
        );
        expect(screen.getByTestId('chart-tooltip')).not.toHaveClass('glass-panel');
        expect(screen.getByTestId('chart-tooltip')).toHaveAttribute('data-label-class', 'mb-1 whitespace-nowrap text-industrial-muted');
        expect(screen.getByTestId('hover-layer')).toHaveAttribute('data-highlights', '4');
    });

    it('formats grouped rendimiento tooltip rows as percentage-only legend values with grouped legend order and colors', async () => {
        const user = userEvent.setup();
        const coverageColor = '#5b86ff';

        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        mockComputedAnalytics(Array.from({ length: 6 }, (_, index) => buildGroupedBucket({
            bucketKey: `day-${index + 1}`,
            label: `2026-06-${String(18 + index).padStart(2, '0')}`,
            durationsMs: index === 0
                ? {
                    prod: 4 * 60 * 60 * 1000,
                    setup: 1 * 60 * 60 * 1000,
                    stopped: 3 * 60 * 60 * 1000,
                    noData: 2 * 60 * 60 * 1000,
                }
                : {
                    prod: 3 * 60 * 60 * 1000,
                    setup: 1 * 60 * 60 * 1000,
                    stopped: 1 * 60 * 60 * 1000,
                    noData: 0,
                },
            expectedDurationMs: 10 * 60 * 60 * 1000,
            productivityRatio: index === 0 ? 0.5 : 0.6,
            productivityLabel: index === 0 ? '50%' : '60%',
            coverageRatio: index === 0 ? 0.8 : 1,
        })));

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'day',
                        coverageColor,
                        stateGradients: CUSTOM_STATE_GRADIENTS,
                        stateGradientAlphas: CUSTOM_STATE_GRADIENT_ALPHAS,
                    },
                })}
                machines={MACHINES}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Hover first bucket' }));

        const tooltip = screen.getByTestId('chart-tooltip');
        const series = readTooltipSeries();

        expect(tooltip).toHaveTextContent('2026-06-18');
        expect(series).toEqual([
            { name: 'Detenida', value: '38%', color: hexToRgbaCss(CUSTOM_STATE_GRADIENTS.stopped[0], CUSTOM_STATE_GRADIENT_ALPHAS.stopped[0]), shape: 'square' },
            { name: 'Setup', value: '13%', color: hexToRgbaCss(CUSTOM_STATE_GRADIENTS.setup[0], CUSTOM_STATE_GRADIENT_ALPHAS.setup[0]), shape: 'square' },
            { name: 'Prod.', value: '50%', color: hexToRgbaCss(CUSTOM_STATE_GRADIENTS.prod[0], CUSTOM_STATE_GRADIENT_ALPHAS.prod[0]), shape: 'square' },
            { name: 'Cobertura incompleta', value: '20%', color: coverageColor, shape: 'square' },
        ]);
        expect(tooltip).not.toHaveTextContent(' h');
        expect(tooltip).not.toHaveTextContent('cob.');
    });

    it('keeps grouped tooltip in-progress labels lowercase', async () => {
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
            label: index === 0 ? '2026-06-18 (EN CURSO)' : `2026-06-${String(19 + index).padStart(2, '0')}`,
            isInProgress: index === 0,
        })));

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Hover first bucket' }));

        expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('2026-06-18 (en curso)');
    });

    it('keeps 30d day PROD trend clipped and horizontally synchronized with Groups scroll mode', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics(Array.from({ length: 30 }, (_, index) => buildGroupedBucket({
            bucketKey: `day-${index + 1}`,
            label: `2026-06-${String(index + 1).padStart(2, '0')}`,
            durationsMs: {
                prod: (4 + (index % 5)) * 60 * 60 * 1000,
                setup: 1 * 60 * 60 * 1000,
                stopped: index % 3 === 0 ? 1 * 60 * 60 * 1000 : 0,
                noData: 0,
            },
            expectedDurationMs: 8 * 60 * 60 * 1000,
            productivityRatio: 0.45 + ((index % 4) * 0.1),
            productivityLabel: `${45 + ((index % 4) * 10)}%`,
        })));

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '30d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            MockResizeObserver.latest().emit(640, CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX);
        });

        const groupsScrollRegion = screen.getByTestId('activity-analytics-groups-scroll-region');
        const groupsChart = screen.getByTestId('activity-analytics-groups-chart');
        const trendViewport = screen.getByTestId('activity-analytics-prod-trend-viewport');
        const trendContent = screen.getByTestId('activity-analytics-prod-trend-content');
        const trendChart = screen.getByTestId('activity-analytics-prod-trend-chart');
        const latestValueLabel = screen.getByTestId('activity-analytics-prod-trend-latest-value-label');

        expect(screen.getByTestId('activity-analytics-groups-panel')).toHaveAttribute('data-groups-density', 'scroll');
        expect(trendViewport).toHaveAttribute('data-scroll-mode', 'scroll');
        expect(trendViewport).toHaveClass('overflow-x-hidden', 'overflow-y-hidden');
        expect(trendContent).toHaveClass('relative', 'shrink-0', 'self-end');
        expect(trendChart).not.toHaveAttribute('width', '640');
        expect(Number(trendViewport.getAttribute('data-content-width-px'))).toBe(Number(groupsChart.getAttribute('width')));
        expect(trendContent).toHaveStyle({ width: `${groupsChart.getAttribute('width')}px` });
        expect(trendChart).toHaveAttribute('width', groupsChart.getAttribute('width') ?? '');
        expect(trendChart.parentElement).toBe(trendContent);
        expect(latestValueLabel).toHaveStyle({
            fontFamily: 'var(--font-widget-value-activity-analytics-prod-trend)',
            fontWeight: 'var(--font-weight-widget-value-activity-analytics-prod-trend)',
            fontSize: 'var(--font-size-widget-value-activity-analytics-prod-trend)',
            letterSpacing: 'var(--tracking-widget-value-activity-analytics-prod-trend)',
            transformBox: 'fill-box',
            transformOrigin: 'center bottom',
        });

        const trendBands = screen.getAllByTestId('activity-analytics-prod-trend-band');
        expect(trendBands.length).toBe(15);
        trendBands.forEach((band, index) => {
            expect(band.getAttribute('data-interval-index')).toBe(String(index * 2));
            expect(trendContent).toContainElement(band);
            expect(trendViewport).toContainElement(band);
        });

        const trendXAxisLabels = screen.getAllByTestId('activity-analytics-prod-trend-x-axis-label');
        const sampledIndices = [0, Math.floor(trendXAxisLabels.length / 2), trendXAxisLabels.length - 1];

        sampledIndices.forEach((index) => {
            const trendLabel = trendXAxisLabels[index];
            const trendX = Number(trendLabel?.getAttribute('x') ?? Number.NaN);
            const groupLabel = Array.from(groupsChart.querySelectorAll('text')).find((node) => (
                node.textContent === trendLabel?.textContent
                && node.getAttribute('y') === `${Number(groupsChart.getAttribute('height')) - 8}`
            ));

            expect(groupLabel).toBeTruthy();
            expect(trendX).toBeCloseTo(Number(groupLabel?.getAttribute('x') ?? Number.NaN), 5);
        });

        act(() => {
            groupsScrollRegion.scrollLeft = 164;
            fireEvent.scroll(groupsScrollRegion);
        });

        expect(trendViewport.scrollLeft).toBe(164);
    });

    it('keeps non-scroll PROD trend modes static without synchronized scroll viewport behavior', () => {
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
            MockResizeObserver.latest().emit(520, CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX);
        });

        expect(screen.queryByTestId('activity-analytics-groups-scroll-region')).not.toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-prod-trend-viewport')).toHaveAttribute('data-scroll-mode', 'static');
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
            { fill: '#94a3b8', segmentKey: 'noData' },
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
            expect(capMetrics.height).toBeCloseTo(resolveExpectedGroupedTopCapHeight(), 5);
            expect(capMetrics.height).toBeLessThan(segmentMetrics.height);
        });
        expect(partialOutline).not.toBeInTheDocument();
    });

    it('uses a fixed 2px grouped top-cap height', () => {
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
                    setup: 5 * 60 * 1000,
                    stopped: 0,
                    noData: 0,
                },
                expectedDurationMs: 24 * 60 * 60 * 1000,
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
        const segmentByKey = new Map(segments.map((segment) => [segment.getAttribute('data-segment-key') ?? '', segment]));
        const capByKey = new Map(topCaps.map((cap) => [cap.getAttribute('data-segment-key') ?? '', cap]));

        expect(Number(capByKey.get('prod')?.getAttribute('height'))).toBeCloseTo(2, 5);

        topCaps.forEach((cap) => {
            const key = cap.getAttribute('data-segment-key') ?? '';
            const segment = segmentByKey.get(key);

            expect(segment).toBeDefined();
            expect(Number(cap.getAttribute('height'))).toBeCloseTo(
                resolveExpectedGroupedTopCapHeight(),
                5,
            );
            expect(Number(cap.getAttribute('height'))).toBe(2);
        });
    });

    it('keeps static donut top caps at 20% of stroke width while giving the moving top cap a 0.3x arc and 25% thicker stroke', () => {
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
            emitActivityAnalyticsLayoutSize({ bodyWidth: 848, bodyHeight: CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX });
        });

        const summarySegments = screen.getAllByTestId('activity-analytics-summary-segment');
        const movingSummaryTopCap = screen.getByTestId('activity-analytics-summary-top-cap');
        const movingSummaryTopCapAura = within(movingSummaryTopCap).getByTestId('activity-analytics-summary-top-cap-aura');
        const movingSummaryTopCapHalo = within(movingSummaryTopCap).getByTestId('activity-analytics-summary-top-cap-halo');
        const movingSummaryTopCapCore = within(movingSummaryTopCap).getByTestId('activity-analytics-summary-top-cap-core');
        const movingSummaryTopCapCoreHighlight = within(movingSummaryTopCap).getByTestId('activity-analytics-summary-top-cap-core-highlight');
        const movingSummaryTopCapCoreStroke = within(movingSummaryTopCap).getByTestId('activity-analytics-summary-top-cap-core-stroke');
        const activeSegment = summarySegments.find((candidate) => candidate.getAttribute('data-segment-key') === movingSummaryTopCap.getAttribute('data-segment-key'));

        expect(activeSegment).toBeDefined();

        const segmentStrokeWidth = Number(activeSegment?.getAttribute('stroke-width'));
        const capStrokeWidth = Number(movingSummaryTopCapCoreStroke.getAttribute('stroke-width'));
        const visibleSegmentLength = parseVisibleStrokeLength(activeSegment?.getAttribute('stroke-dasharray') ?? null);
        const capLength = parseVisibleStrokeLength(movingSummaryTopCapCore.getAttribute('stroke-dasharray'));
        const expectedMovingCapLength = Math.min(Math.max(segmentStrokeWidth * 0.3, 1), visibleSegmentLength);

        expect(capStrokeWidth).toBeCloseTo(segmentStrokeWidth * 1.25, 2);
        expect(capLength).toBeCloseTo(expectedMovingCapLength, 5);
        expect(Number(movingSummaryTopCapAura.getAttribute('stroke-opacity'))).toBeGreaterThanOrEqual(0.3);
        expect(Number(movingSummaryTopCapHalo.getAttribute('stroke-opacity'))).toBeGreaterThan(Number(movingSummaryTopCapAura.getAttribute('stroke-opacity')));
        expect(Number(movingSummaryTopCapCoreHighlight.getAttribute('stroke-width'))).toBeLessThan(capStrokeWidth);
        expect(Number(movingSummaryTopCapCoreHighlight.getAttribute('opacity'))).toBeGreaterThan(Number(movingSummaryTopCapCoreStroke.getAttribute('stroke-opacity')));
        expect(Number(movingSummaryTopCapCoreStroke.getAttribute('stroke-opacity'))).toBeGreaterThan(0.59);
        expect(activeSegment?.compareDocumentPosition(movingSummaryTopCap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        const firstGroupStack = screen.getByTestId('activity-analytics-group-stack');
        const groupSegments = within(firstGroupStack).getAllByTestId('activity-analytics-group-segment');
        const groupTopCaps = within(firstGroupStack).getAllByTestId('activity-analytics-group-top-cap');
        const groupSegmentByKey = new Map(groupSegments.map((segment) => [segment.getAttribute('data-segment-key') ?? '', segment]));

        groupTopCaps.forEach((cap) => {
            const key = cap.getAttribute('data-segment-key') ?? '';
            const segment = groupSegmentByKey.get(key);

            expect(segment).toBeDefined();
            expect(Number(cap.getAttribute('height'))).toBeCloseTo(
                resolveExpectedGroupedTopCapHeight(),
                5,
            );
        });
    });

    it('keeps grouped prod/stopped top caps on their existing non-final color source', () => {
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

        expect(stoppedTopCap).toHaveAttribute('fill', topCapHighlightColor(CUSTOM_STATE_GRADIENTS.stopped[0], TOP_CAP_HIGHLIGHT_MIX_BY_STATE.stopped));
        expect(stoppedTopCap?.getAttribute('style')).toContain(CUSTOM_STATE_GRADIENTS.stopped[0]);
        expect(stoppedTopCap?.getAttribute('style')).not.toContain(CUSTOM_STATE_GRADIENTS.stopped[1]);
        expect(prodTopCap).toHaveAttribute('fill', topCapHighlightColor(CUSTOM_STATE_GRADIENTS.prod[0], TOP_CAP_HIGHLIGHT_MIX_BY_STATE.prod));
        expect(prodTopCap?.getAttribute('style')).toContain(CUSTOM_STATE_GRADIENTS.prod[0]);
        expect(prodTopCap?.getAttribute('style')).not.toContain(CUSTOM_STATE_GRADIENTS.prod[1]);
    });

    it('uses the configured final setup color for the Distribución marker and grouped legend dot while keeping donut top caps on the initial color', () => {
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
                        stateGradientAlphas: CUSTOM_STATE_GRADIENT_ALPHAS,
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

        const legendSwatches = Array.from(screen.getByTestId('activity-analytics-groups-header-legend').querySelectorAll('span[aria-hidden="true"]'));
        const setupLegendSwatch = legendSwatches[1] as HTMLElement | undefined;
        const detailMarkers = Array.from(screen.getByTestId('activity-analytics-summary-details').querySelectorAll('rect'));
        const setupDetailMarker = detailMarkers[1];
        const setupTopCap = screen.getAllByTestId('activity-analytics-group-top-cap')
            .find((cap) => cap.getAttribute('data-segment-key') === 'setup');
        const summaryTopCapStops = ['stopped-top-cap-gradient', 'setup-top-cap-gradient', 'prod-top-cap-gradient']
            .flatMap((gradientIdSuffix) => getGradientStopsByIdSuffix(screen.getByTestId('activity-analytics-summary-chart'), gradientIdSuffix));
        expect(setupDetailMarker?.getAttribute('fill')).toBe(hexToRgbaCss(CUSTOM_STATE_GRADIENTS.setup[1], CUSTOM_STATE_GRADIENT_ALPHAS.setup[1]));
        expect(setupLegendSwatch?.style.backgroundColor).toBe(hexToRgbaCss(CUSTOM_STATE_GRADIENTS.setup[1], CUSTOM_STATE_GRADIENT_ALPHAS.setup[1]));
        expect(setupLegendSwatch?.style.backgroundColor).toBe(setupDetailMarker?.getAttribute('fill'));
        expect(setupTopCap).toHaveAttribute('fill', topCapHighlightColor(CUSTOM_STATE_GRADIENTS.setup[1], TOP_CAP_HIGHLIGHT_MIX_BY_STATE.setup));
        expect(setupTopCap?.getAttribute('style')).toContain(CUSTOM_STATE_GRADIENTS.setup[1]);
        expect(setupTopCap?.getAttribute('style')).not.toContain(CUSTOM_STATE_GRADIENTS.setup[0]);
        expect(summaryTopCapStops.map((stop) => stop.getAttribute('stop-color'))).toEqual([
            topCapHighlightColor(CUSTOM_STATE_GRADIENTS.stopped[0], TOP_CAP_HIGHLIGHT_MIX_BY_STATE.stopped),
            CUSTOM_STATE_GRADIENTS.stopped[0],
            topCapHighlightColor(CUSTOM_STATE_GRADIENTS.setup[0], TOP_CAP_HIGHLIGHT_MIX_BY_STATE.setup),
            CUSTOM_STATE_GRADIENTS.setup[0],
            topCapHighlightColor(CUSTOM_STATE_GRADIENTS.prod[0], TOP_CAP_HIGHLIGHT_MIX_BY_STATE.prod),
            CUSTOM_STATE_GRADIENTS.prod[0],
        ]);
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
                groupBarWidths: {
                    day: 1,
                },
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
                            groupBarWidths: {
                                day: factor,
                            },
                        },
                    }}
                    machines={MACHINES}
                />,
            );

            act(() => {
                MockResizeObserver.latest().emit(480, CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX);
            });

            await user.click(screen.getByRole('button', { name: 'Hover first bucket' }));

            const firstStack = screen.getAllByTestId('activity-analytics-group-stack')[0];
            const lastStack = screen.getAllByTestId('activity-analytics-group-stack').at(-1);
            const firstStackSegments = within(firstStack).getAllByTestId('activity-analytics-group-segment');
            const lastStackSegments = lastStack ? within(lastStack).getAllByTestId('activity-analytics-group-segment') : [];
            const chartWidth = Number(screen.getByTestId('activity-analytics-groups-chart').getAttribute('width'));
            const lastVisibleSegment = [...lastStackSegments]
                .reverse()
                .find((segment) => Number(segment.getAttribute('height')) > 0);

            if (!lastVisibleSegment) {
                throw new Error('Missing last visible grouped segment');
            }

            const lastVisibleMetrics = parseRectMetrics(lastVisibleSegment);

            return {
                tooltip: screen.getByTestId('chart-tooltip').textContent,
                comparison: screen.getByTestId('activity-analytics-comparison').textContent,
                coverage: screen.getByTestId('activity-analytics-summary-coverage').textContent,
                stackCount: screen.getAllByTestId('activity-analytics-group-stack').length,
                productivityLabels: screen.getAllByTestId('activity-analytics-group-productivity').map((node) => node.textContent),
                metrics: firstStackSegments.map(parseRectMetrics),
                rightGap: chartWidth - (lastVisibleMetrics.x + lastVisibleMetrics.width),
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

        expect(narrow.metrics[0]?.width).toBeLessThan(medium.metrics[0]?.width ?? 0);
        expect(medium.metrics[0]?.width).toBeLessThan(wide.metrics[0]?.width ?? 0);
        expect(narrow.metrics[0]?.centerX).toBeLessThan(medium.metrics[0]?.centerX ?? 0);
        expect(medium.metrics[0]?.centerX).toBeLessThan(wide.metrics[0]?.centerX ?? 0);
        expect(narrow.rightGap).toBeGreaterThan(0);
        expect(medium.rightGap).toBeGreaterThan(0);
        expect(wide.rightGap).toBeGreaterThan(0);
    });

    it('uses the active group width and preserves legacy global fallback', () => {
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
                stopped: 0,
                noData: 0,
            },
            productivityLabel: `${60 + index}%`,
        })));

        const { rerender } = render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'day',
                        groupBarWidth: 1.2,
                        groupBarWidths: {
                            shift: 0.2,
                            day: 0.3,
                            week: 1.4,
                            month: 1.1,
                        },
                    },
                })}
                machines={MACHINES}
            />,
        );

        act(() => {
            MockResizeObserver.latest().emit(480, CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX);
        });

        const perGroupWidth = parseRectMetrics(screen.getAllByTestId('activity-analytics-group-segment')[0]).width;

        rerender(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '7d',
                        groupBy: 'day',
                        groupBarWidth: 1.2,
                    },
                })}
                machines={MACHINES}
            />,
        );

        act(() => {
            MockResizeObserver.latest().emit(480, CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX);
        });

        const legacyWidth = parseRectMetrics(screen.getAllByTestId('activity-analytics-group-segment')[0]).width;

        expect(perGroupWidth).toBeLessThan(legacyWidth);
    });

    it('honors the active day bar width lower boundary of 0.1 in the rendered groups chart', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics(Array.from({ length: 2 }, (_, index) => buildGroupedBucket({
            bucketKey: `day-${index + 1}`,
            label: `2026-06-${18 + index}`,
            expectedDurationMs: 5 * 60 * 60 * 1000,
            durationsMs: {
                prod: (index + 2) * 60 * 60 * 1000,
                setup: 1 * 60 * 60 * 1000,
                stopped: 0,
                noData: 0,
            },
            productivityLabel: `${60 + index}%`,
        })));

        const widget = makeWidget({
            displayOptions: {
                ...makeWidget().displayOptions,
                range: '7d',
                groupBy: 'day',
                groupBarWidth: 1.4,
                groupBarWidths: {
                    day: 0.1,
                },
            },
        });

        const { rerender } = render(
            <ActivityAnalyticsWidget
                widget={widget}
                machines={MACHINES}
            />,
        );

        act(() => {
            MockResizeObserver.latest().emit(1200, CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX);
        });

        const lowerBoundaryWidth = parseRectMetrics(screen.getAllByTestId('activity-analytics-group-segment')[0]).width;

        rerender(
            <ActivityAnalyticsWidget
                widget={{
                    ...widget,
                    displayOptions: {
                        ...widget.displayOptions,
                        groupBarWidths: {
                            day: 0.5,
                        },
                    },
                }}
                machines={MACHINES}
            />,
        );

        act(() => {
            MockResizeObserver.latest().emit(1200, CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX);
        });

        const previousLowerBoundaryWidth = parseRectMetrics(screen.getAllByTestId('activity-analytics-group-segment')[0]).width;

        expect(lowerBoundaryWidth).toBeLessThan(previousLowerBoundaryWidth);
        expect(lowerBoundaryWidth / previousLowerBoundaryWidth).toBeCloseTo(0.2, 2);
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

    it('lets Mejor/Peor auto-size when Resumen falls back to text mode instead of reusing donut band height and padding', () => {
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

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 360, bodyHeight: 210 });
        });

        const comparisonPanel = screen.getByTestId('activity-analytics-comparison');
        const comparisonGrid = screen.getByTestId('activity-analytics-comparison-grid');

        expect(screen.getByTestId('activity-analytics-summary-text')).toBeInTheDocument();
        expect(comparisonPanel.style.height).toBe('');
        expect(comparisonGrid.style.paddingTop).toBe('');
        expect(comparisonGrid.style.paddingBottom).toBe('');
        expect(comparisonGrid.style.alignSelf).toBe('center');
        expect(within(comparisonPanel).getByText('2026-06-18')).toBeInTheDocument();
        expect(within(comparisonPanel).getByText('2026-06-19')).toBeInTheDocument();
        expect(within(comparisonPanel).queryByTestId('activity-analytics-comparison-context')).not.toBeInTheDocument();
        expect(comparisonPanel).not.toHaveTextContent('Cobertura completa');
        expect(comparisonPanel).not.toHaveTextContent(/Observado · Cob\./);
    });

    it('shows observed production percent for incomplete coverage while preserving en curso, sin turno, and sin comparación', async () => {
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

        const groupsChart = screen.getByTestId('activity-analytics-groups-chart');

        expect(screen.queryByText('cobertura incompleta')).not.toBeInTheDocument();
        expect(screen.getAllByText('100%').length).toBeGreaterThan(0);
        expect(screen.getAllByText('en curso').length).toBeGreaterThan(0);
        expect(within(groupsChart).getByText('2026-06-18 · Turno Noche')).toBeInTheDocument();
        expect(within(groupsChart).queryByText('2026-06-18 · Turno Noche (en curso)')).not.toBeInTheDocument();
        expect(within(groupsChart).getByText('2026-06-19 · Turno Tarde')).toBeInTheDocument();
        expect(within(groupsChart).getByText('2026-06-20 · sin turno')).toBeInTheDocument();
        expect(screen.getByTestId('activity-analytics-comparison')).toHaveTextContent('sin comparación');

        act(() => {
            MockResizeObserver.latest().emit(360, 210);
        });

        expect(screen.getByTestId('activity-analytics-groups-text')).toBeInTheDocument();
        expect(screen.getAllByText('cobertura incompleta').length).toBeGreaterThan(0);
        expect(screen.getAllByText('100%').length).toBeGreaterThan(0);
        expect(screen.getAllByText('en curso').length).toBeGreaterThan(0);
        expect(screen.getByText('2026-06-18 · Turno Noche (en curso)')).toBeInTheDocument();
        expect(screen.getAllByText('2026-06-19 · Turno Tarde').length).toBeGreaterThan(0);
        expect(screen.getAllByText('2026-06-20 · sin turno').length).toBeGreaterThan(0);
        expect(screen.getByTestId('activity-analytics-comparison')).toHaveTextContent('sin comparación');
    });

    it('ranks closed high-coverage incomplete Turno buckets without rendering comparison context text in Mejor/Peor', async () => {
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
        expect(comparisonPanel).toHaveTextContent('92%');
        expect(comparisonPanel).toHaveTextContent('50%');
        expect(comparisonPanel).not.toHaveTextContent('Observado · Cobertura 95%');
        expect(comparisonPanel).not.toHaveTextContent('Cobertura completa');
        expect(within(comparisonPanel).queryByTestId('activity-analytics-comparison-context')).not.toBeInTheDocument();
        expect(comparisonPanel).not.toHaveTextContent('sin comparación');
    });

    it('uses the computed full-coverage productivity ratio for Mejor bar height instead of the rounded label text', async () => {
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
                    prod: 6 * 60 * 60 * 1000,
                    setup: 3 * 60 * 60 * 1000,
                    stopped: 0,
                    noData: 0,
                },
                stopCount: 0,
                estimatedKwh: 0,
                utilizationRatio: 2 / 3,
                coverageRatio: 1,
                intervals: [],
            },
            grouped: [
                buildGroupedBucket({
                    bucketKey: 'day-1',
                    label: '19/06',
                    productivityRatio: 2 / 3,
                    productivityLabel: '67%',
                    coverageRatio: 1,
                    isInProgress: false,
                }),
                buildGroupedBucket({
                    bucketKey: 'day-2',
                    label: '2026-06-20',
                    productivityRatio: 0.5,
                    productivityLabel: '50%',
                    coverageRatio: 1,
                    isInProgress: false,
                }),
            ],
            comparison: {
                best: { label: '2026-06-19', bucketKey: 'day-1' },
                worst: { label: '2026-06-20', bucketKey: 'day-2' },
            },
            summaryRows: [],
            timezone: 'UTC',
        } as never);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        groupBy: 'day',
                    },
                })}
                machines={MACHINES}
            />,
        );

        const comparisonFills = screen.getAllByTestId('activity-analytics-comparison-bar-fill');

        expect(screen.getAllByTestId('activity-analytics-comparison-percent').map((node) => node.textContent)).toEqual(['67%', '50%']);
        expect(parsePercentHeight((comparisonFills[0] as HTMLElement).style.height)).toBeCloseTo((2 / 3) * 100, 5);
        expect((comparisonFills[0] as HTMLElement).style.height).not.toBe('67%');
        expect(parsePercentHeight((comparisonFills[1] as HTMLElement).style.height)).toBeCloseTo(50, 5);
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

        const groupsChart = screen.getByTestId('activity-analytics-groups-chart');

        expect(screen.getByTestId('activity-analytics-group-partial-outline')).toBeInTheDocument();
        expect(screen.getByText('24h')).toBeInTheDocument();
        expect(screen.getByText('18h')).toBeInTheDocument();
        expect(screen.getByText('12h')).toBeInTheDocument();
        expect(screen.getByText('6h')).toBeInTheDocument();
        expect(screen.queryByText('10.0 h')).not.toBeInTheDocument();
        expect(screen.getAllByText('25%').length).toBeGreaterThan(0);
        expect(within(groupsChart).getByText('2026-06-19')).toBeInTheDocument();
        expect(within(groupsChart).queryByText('2026-06-19 (en curso)')).not.toBeInTheDocument();
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
        expect(screen.queryByText('La respuesta recibida no cumple el contrato esperado para esta analítica.')).not.toBeInTheDocument();
        expect(screen.queryByText('No fue posible calcular la analítica de actividad.')).not.toBeInTheDocument();
    });

    it('uses compact chart typography for Mejor/Peor instead of KPI-scale values', () => {
        vi.mocked(isDataActivitySeriesEnabled).mockReturnValue(false);

        const dayGroupedWidget = makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } });
        const { rerender } = render(<ActivityAnalyticsWidget widget={dayGroupedWidget} machines={MACHINES} />);

        expect(screen.getByTestId('activity-analytics-widget-runtime-state').querySelector('.font-system')).toHaveTextContent('Endpoint Activity-Series no configurado');

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

    it('uses semantic typography for summary values/details and keeps the donut center label block grouped around the donut center', () => {
        const actualGetComputedStyle = window.getComputedStyle.bind(window);
        const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => {
            const computedStyle = actualGetComputedStyle(element);
            const testId = element.getAttribute('data-testid');

            if (testId === 'activity-analytics-summary-total-value' || testId === 'activity-analytics-summary-total-label') {
                const fontSize = testId === 'activity-analytics-summary-total-value' ? '32px' : '12px';
                const mockedStyle = Object.create(computedStyle) as CSSStyleDeclaration;
                Object.defineProperty(mockedStyle, 'fontSize', {
                    configurable: true,
                    value: fontSize,
                });

                return mockedStyle;
            }

            return computedStyle;
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
        const donutCenterGroup = screen.getByTestId('activity-analytics-summary-center-label-group');
        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 848, bodyHeight: 420 });
        });

        const narrowSummaryHeight = Number(screen.getByTestId('activity-analytics-summary-chart').getAttribute('height'));
        const narrowSegments = screen.getAllByTestId('activity-analytics-summary-segment');
        const narrowProdStrokeWidth = Number(narrowSegments.find((segment) => segment.getAttribute('data-segment-key') === 'prod')?.getAttribute('stroke-width'));
        const narrowSetupStrokeWidth = Number(narrowSegments.find((segment) => segment.getAttribute('data-segment-key') === 'setup')?.getAttribute('stroke-width'));

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 1260, bodyHeight: 420 });
        });

        const wideSummaryHeight = Number(screen.getByTestId('activity-analytics-summary-chart').getAttribute('height'));
        const wideSegments = screen.getAllByTestId('activity-analytics-summary-segment');
        const wideProdStrokeWidth = Number(wideSegments.find((segment) => segment.getAttribute('data-segment-key') === 'prod')?.getAttribute('stroke-width'));
        const wideSetupStrokeWidth = Number(wideSegments.find((segment) => segment.getAttribute('data-segment-key') === 'setup')?.getAttribute('stroke-width'));
        const summaryChart = screen.getByTestId('activity-analytics-summary-chart');
        const donutCenterX = Number(summaryChart.getAttribute('data-donut-center-x-px'));
        const donutCenterY = Number(summaryChart.getAttribute('data-donut-center-y-px'));
        const donutMarginTop = Number(summaryChart.getAttribute('data-donut-margin-top-px'));
        const donutRegionHeight = Number(summaryChart.getAttribute('data-donut-region-height-px'));
        const donutCenterValueY = Number(donutCenterValue.getAttribute('y'));
        const donutCenterLabelY = Number(donutCenterLabel.getAttribute('y'));

        getComputedStyleSpy.mockRestore();

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
        expect(detailTitle.getAttribute('y')).toBe(detailValue.getAttribute('y'));
        expect(coverageValue).toHaveTextContent('100%');
        expect(coverageValue).toHaveStyle({
            fontFamily: 'var(--font-mono)',
            fontWeight: 'var(--font-weight-mono)',
            fontSize: 'var(--font-size-mono)',
            letterSpacing: 'var(--tracking-mono)',
        });
        expect(donutCenterValue).toHaveTextContent('57%');
        expect(donutCenterValue).toHaveStyle({
            fontFamily: 'var(--font-widget-value-gauge)',
            fontWeight: 'var(--font-weight-widget-value-gauge)',
            fontSize: '40px',
            letterSpacing: 'var(--tracking-widget-value-gauge)',
        });
        expect(donutCenterLabel).toHaveTextContent('PROD');
        expect(donutCenterLabel).toHaveStyle({
            fontFamily: 'var(--font-system)',
            fontWeight: 'var(--font-weight-system)',
            fontSize: 'var(--font-size-system)',
            letterSpacing: 'var(--tracking-system)',
        });
        expect(donutCenterGroup).toHaveAttribute('transform', `translate(${donutCenterX} ${donutCenterY})`);
        expect(donutCenterValue).toHaveAttribute('x', '0');
        expect(donutCenterLabel).toHaveAttribute('x', '0');
        expect(donutCenterValue).toHaveAttribute('dominant-baseline', 'middle');
        expect(donutCenterLabel).toHaveAttribute('dominant-baseline', 'middle');
        expect(donutCenterValueY).toBeLessThan(0);
        expect(donutCenterLabelY).toBeGreaterThan(0);
        expect(Math.abs(donutCenterLabelY)).toBeGreaterThan(Math.abs(donutCenterValueY));
        expect(summaryPanel).toHaveClass('items-center', 'justify-center');
        expect(donutCenterY).toBeCloseTo(donutMarginTop + (donutRegionHeight / 2), 2);
        expect(narrowSummaryHeight).toBeCloseTo(wideSummaryHeight, 5);
        expect(narrowProdStrokeWidth / narrowSetupStrokeWidth).toBeCloseTo(1.75, 5);
        expect(wideProdStrokeWidth / wideSetupStrokeWidth).toBeCloseTo(1.75, 5);
        expect(donutCenterValue).not.toHaveTextContent('7.0 h');
        expect(donutCenterLabel).not.toHaveTextContent('Total');
    });

    it('uses the per-widget donut center value font size override and falls back to 40px when absent', () => {
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

        const { rerender } = render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        donutCenterValueFontSize: 72,
                    },
                })}
                machines={MACHINES}
            />,
        );

        expect(screen.getByTestId('activity-analytics-summary-total-value')).toHaveStyle({
            fontSize: '72px',
        });
        expect(screen.getByTestId('activity-analytics-summary-total-label')).toHaveStyle({
            fontSize: 'var(--font-size-system)',
        });

        rerender(
            <ActivityAnalyticsWidget
                widget={makeWidget()}
                machines={MACHINES}
            />,
        );

        expect(screen.getByTestId('activity-analytics-summary-total-value')).toHaveStyle({
            fontSize: '40px',
        });
    });

    it('renders Cobertura as a fourth summary detail row without a marker while keeping muted aligned text', () => {
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

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 1260, bodyHeight: 420 });
        });

        const summaryPanel = screen.getByTestId('activity-analytics-summary-bars');
        const detailBlock = screen.getByTestId('activity-analytics-summary-details');
        const detailSections = within(detailBlock).getAllByTestId('activity-analytics-summary-detail-section');
        const detailTitles = within(detailBlock).getAllByTestId('activity-analytics-summary-detail-title');
        const coverageSection = detailSections.at(-1);

        if (!coverageSection) {
            throw new Error('Missing coverage summary detail section');
        }

        const coverageTitle = within(coverageSection).getByTestId('activity-analytics-summary-detail-title');

        expect(within(summaryPanel).queryByText('Cobertura 100%')).not.toBeInTheDocument();
        expect(within(summaryPanel).queryByText(/\d+\.\d h/)).not.toBeInTheDocument();
        expect(coverageTitle).toHaveTextContent('Cobertura');
        expect(within(summaryPanel).getByTestId('activity-analytics-summary-coverage')).toHaveTextContent('100%');
        expect(coverageSection.querySelector('rect')).toBeNull();
        expect(coverageTitle).toHaveAttribute('fill', 'var(--color-industrial-muted)');
        expect(coverageTitle.getAttribute('x')).toBe(detailTitles[0]?.getAttribute('x'));
    });

    it('shows the donut center production percent for incomplete coverage when observed duration exists and keeps coverage in the detail row', () => {
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
                    prod: 6 * 60 * 60 * 1000,
                    setup: 2 * 60 * 60 * 1000,
                    stopped: 1 * 60 * 60 * 1000,
                    noData: 15 * 60 * 60 * 1000,
                },
                stopCount: 0,
                estimatedKwh: 18.4,
                utilizationRatio: 6 / 9,
                coverageRatio: 9 / 24,
                intervals: [],
            },
            grouped: [
                buildGroupedBucket({
                    bucketKey: 'day-1',
                    label: '2026-06-18',
                    durationsMs: { prod: 6 * 60 * 60 * 1000, setup: 2 * 60 * 60 * 1000, stopped: 1 * 60 * 60 * 1000, noData: 15 * 60 * 60 * 1000 },
                    expectedDurationMs: 24 * 60 * 60 * 1000,
                    utilizationRatio: 6 / 9,
                    coverageRatio: 9 / 24,
                    productivityRatio: null,
                    productivityLabel: 'cobertura incompleta',
                }),
            ],
            comparison: {
                best: { label: '2026-06-18', bucketKey: 'day-1' },
                worst: { label: '2026-06-18', bucketKey: 'day-1' },
            },
            summaryRows: [{ label: '2026-06-18', productivityLabel: 'cobertura incompleta', bucketKey: 'day-1' }],
            timezone: 'UTC',
        } as never);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 1260, bodyHeight: 420 });
        });

        const summaryPanel = screen.getByTestId('activity-analytics-summary-bars');

        expect(screen.getByTestId('activity-analytics-summary-total-value')).toHaveTextContent('67%');
        expect(screen.getByTestId('activity-analytics-summary-total-value')).not.toHaveTextContent('cobertura incompleta');
        expect(within(summaryPanel).getByTestId('activity-analytics-summary-coverage')).toHaveTextContent('38%');
        expect(within(summaryPanel).getByText('Cobertura')).toBeInTheDocument();
    });

    it('keeps Mejor/Peor track height stable across wide and narrow top-row widths', () => {
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

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 1260, bodyHeight: 420 });
        });

        const comparisonPanel = screen.getByTestId('activity-analytics-comparison');
        const summaryPanel = screen.getByTestId('activity-analytics-summary-bars');
        const comparisonGrid = screen.getByTestId('activity-analytics-comparison-grid');
        const comparisonTrackRegions = screen.getAllByTestId('activity-analytics-comparison-track-region');
        const comparisonRows = screen.getAllByTestId('activity-analytics-comparison-row');
        const chartHeight = Number.parseFloat(comparisonPanel.style.height);
        const summaryPanelHeight = Number.parseFloat(summaryPanel.style.height);
        const summaryChartHeight = Number(screen.getByTestId('activity-analytics-summary-chart').getAttribute('height'));
        const wideTopRegionSharedHeight = Number(screen.getByTestId('activity-analytics-top-region').getAttribute('data-top-shared-height-px'));
        const wideTrackHeight = parsePxStyle((comparisonTrackRegions[0] as HTMLElement).style.height);

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 520, bodyHeight: 420 });
        });

        const narrowTrackRegions = screen.getAllByTestId('activity-analytics-comparison-track-region');
        const narrowTrackHeight = parsePxStyle((narrowTrackRegions[0] as HTMLElement).style.height);

        expect(chartHeight).toBeCloseTo(224, 5);
        expect(summaryPanelHeight).toBeCloseTo(chartHeight, 5);
        expect(summaryChartHeight).toBeCloseTo(chartHeight - 10, 5);
        expect(wideTopRegionSharedHeight).toBeCloseTo(chartHeight, 5);
        expect(comparisonPanel).toHaveClass('items-center', 'justify-center', 'p-0');
        expect(comparisonGrid.style.paddingTop).toBe('');
        expect(comparisonGrid.style.paddingBottom).toBe('');
        expect(comparisonGrid.className).toContain('content-center');
        expect(Math.abs(wideTrackHeight - narrowTrackHeight)).toBeLessThanOrEqual(4);
        comparisonRows.forEach((row) => {
            expect(row.className).toContain('justify-center');
            expect(row.className).not.toContain('justify-start');
        });
        comparisonTrackRegions.forEach((trackRegion) => {
            expect(trackRegion.className).not.toContain('flex-1');
            expect(trackRegion).toHaveStyle({ height: '112px' });
        });
        narrowTrackRegions.forEach((trackRegion) => {
            expect(trackRegion.className).not.toContain('flex-1');
            expect(trackRegion).toHaveStyle({ height: '112px' });
        });
    });

    it('keeps the summary and comparison containers on the same fixed shared height while widths stay responsive', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({ bucketKey: 'day-1', label: '2026-06-18' }),
            buildGroupedBucket({ bucketKey: 'day-2', label: '2026-06-19', productivityRatio: 0.5, productivityLabel: '50%' }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })}
                machines={MACHINES}
            />,
        );

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 760, bodyHeight: 420 });
        });

        const intermediateSummaryPanelHeight = Number.parseFloat(screen.getByTestId('activity-analytics-summary-bars').style.height);
        const intermediateSummaryChartHeight = Number(screen.getByTestId('activity-analytics-summary-chart').getAttribute('height'));
        const intermediateComparisonHeight = Number.parseFloat(screen.getByTestId('activity-analytics-comparison').style.height);
        const intermediateSummaryWidth = Number(screen.getByTestId('activity-analytics-summary-column').getAttribute('data-summary-column-width-px'));
        const intermediateGroupsHeight = screen.getByTestId('activity-analytics-groups').getBoundingClientRect().height;

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 1260, bodyHeight: 420 });
        });

        const wideSummaryPanelHeight = Number.parseFloat(screen.getByTestId('activity-analytics-summary-bars').style.height);
        const wideSummaryChartHeight = Number(screen.getByTestId('activity-analytics-summary-chart').getAttribute('height'));
        const wideComparisonHeight = Number.parseFloat(screen.getByTestId('activity-analytics-comparison').style.height);
        const wideSummaryWidth = Number(screen.getByTestId('activity-analytics-summary-column').getAttribute('data-summary-column-width-px'));
        const wideGroupsHeight = screen.getByTestId('activity-analytics-groups').getBoundingClientRect().height;

        expect(intermediateSummaryPanelHeight).toBeCloseTo(intermediateComparisonHeight, 5);
        expect(wideSummaryPanelHeight).toBeCloseTo(wideComparisonHeight, 5);
        expect(intermediateSummaryChartHeight).toBeCloseTo(intermediateComparisonHeight - 10, 5);
        expect(wideSummaryChartHeight).toBeCloseTo(wideComparisonHeight - 10, 5);
        expect(intermediateSummaryPanelHeight).toBeCloseTo(224, 5);
        expect(wideSummaryPanelHeight).toBeCloseTo(224, 5);
        expect(wideGroupsHeight).toBeCloseTo(intermediateGroupsHeight, 5);
        expect(wideSummaryWidth).toBeGreaterThan(intermediateSummaryWidth);
        expect(screen.getByTestId('activity-analytics-summary-chart')).toHaveClass('block');
        expect(screen.getByTestId('activity-analytics-top-region')).toHaveAttribute('data-top-layout', 'side-by-side');
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

    it('allocates donut route progress proportionally to each segment travel length instead of equal step counts', () => {
        const ringThickness = 10;
        const prodRingThickness = 14;
        const segments = buildActivityAnalyticsSummarySegments({
            bars: [
                { key: 'stopped', label: 'Detenida', durationMs: 1, color: 'red' },
                { key: 'setup', label: 'Setup', durationMs: 2, color: 'yellow' },
                { key: 'prod', label: 'Prod.', durationMs: 3, color: 'green' },
            ],
            circumference: 150,
            gapLength: 6,
        });

        const firstRoute = resolveSummaryTravelingTopCapRoute(segments, 0, 0, ringThickness, prodRingThickness);

        if (!firstRoute) {
            throw new Error('Expected a first donut top-cap route');
        }

        const secondRoute = resolveSummaryTravelingTopCapRoute(
            segments,
            0,
            Math.min(firstRoute.stepProgressEnd + 0.0001, 0.999999),
            ringThickness,
            prodRingThickness,
        );

        if (!secondRoute) {
            throw new Error('Expected a second donut top-cap route');
        }

        const thirdRoute = resolveSummaryTravelingTopCapRoute(
            segments,
            0,
            Math.min(secondRoute.stepProgressEnd + 0.0001, 0.999999),
            ringThickness,
            prodRingThickness,
        );

        if (!thirdRoute) {
            throw new Error('Expected a third donut top-cap route');
        }

        const routeSteps = [firstRoute, secondRoute, thirdRoute];

        const orderedRoutes = routeSteps.filter((route): route is NonNullable<typeof route> => route !== null)
            .sort((left, right) => left.routeStep - right.routeStep);

        expect(orderedRoutes).toHaveLength(3);

        const totalTravelLength = orderedRoutes.reduce((total, route) => total + route.travelLength, 0);
        const expectedFirstBoundary = orderedRoutes[0]!.travelLength / totalTravelLength;
        const expectedSecondBoundary = (orderedRoutes[0]!.travelLength + orderedRoutes[1]!.travelLength) / totalTravelLength;

        expect(orderedRoutes[0]!.stepProgressStart).toBeCloseTo(0, 6);
        expect(orderedRoutes[0]!.stepProgressEnd).toBeCloseTo(expectedFirstBoundary, 6);
        expect(orderedRoutes[1]!.stepProgressStart).toBeCloseTo(expectedFirstBoundary, 6);
        expect(orderedRoutes[1]!.stepProgressEnd).toBeCloseTo(expectedSecondBoundary, 6);
        expect(orderedRoutes[2]!.stepProgressStart).toBeCloseTo(expectedSecondBoundary, 6);
        expect(orderedRoutes[2]!.stepProgressEnd).toBeCloseTo(1, 6);
        expect(orderedRoutes[0]!.stepProgressEnd).not.toBeCloseTo(1 / 3, 2);
        expect(orderedRoutes[1]!.stepProgressEnd).not.toBeCloseTo(2 / 3, 3);
    });

    it('renders compact Mejor/Peor bars from the visible grouped data and tightens spacing as the widget narrows', () => {
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
        const comparisonGrid = screen.getByTestId('activity-analytics-comparison-grid');

        act(() => {
            emitActivityAnalyticsLayoutSize({
                bodyWidth: 760,
                bodyHeight: 420,
            });
        });

        const wideGap = Number.parseFloat(comparisonGrid.style.columnGap);

        act(() => {
            emitActivityAnalyticsLayoutSize({
                bodyWidth: 590,
                bodyHeight: 420,
            });
        });

        const narrowGap = Number.parseFloat(comparisonGrid.style.columnGap);

        act(() => {
            emitActivityAnalyticsLayoutSize({
                bodyWidth: 520,
                bodyHeight: 420,
            });
        });

        const compactGap = Number.parseFloat(comparisonGrid.style.columnGap);
        const compactTopRegion = screen.getByTestId('activity-analytics-top-region');
        const comparisonRows = screen.getAllByTestId('activity-analytics-comparison-row');

        expect(within(comparisonPanel).getByText('2026-06-18')).toBeInTheDocument();
        expect(within(comparisonPanel).getByText('60%')).toBeInTheDocument();
        expect(within(comparisonPanel).getByText('2026-06-19')).toBeInTheDocument();
        expect(within(comparisonPanel).getByText('50%')).toBeInTheDocument();
        expect(comparisonPanel).toHaveClass('justify-center');
        expect(comparisonPanel).toHaveClass('items-center');
        comparisonRows.forEach((row) => {
            expect(row).toHaveClass('justify-center');
            expect(row).not.toHaveClass('justify-start');
        });
        expect(comparisonGrid).toHaveClass('w-fit');
        expect(comparisonGrid.style.alignSelf).toBe('center');
        expect(compactTopRegion).toHaveAttribute('data-top-layout', 'side-by-side');
        expect(Number(compactTopRegion.getAttribute('data-top-overlap-px'))).toBe(0);
        expect(wideGap).toBeGreaterThanOrEqual(narrowGap);
        expect(narrowGap).toBeGreaterThanOrEqual(compactGap);
        expect(compactGap).toBeGreaterThanOrEqual(10);
    });

    it('exposes the Mejor/Peor centering layout contract across wide intermediate and narrow widths', () => {
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
        const comparisonGrid = screen.getByTestId('activity-analytics-comparison-grid');
        const comparisonColumn = screen.getByTestId('activity-analytics-comparison-column');
        const comparisonRows = screen.getAllByTestId('activity-analytics-comparison-row');

        const assertCenteringContract = (expectedBodyWidth: number) => {
            expect(comparisonPanel).toHaveClass('items-center');
            expect(comparisonPanel).toHaveClass('justify-center');
            comparisonRows.forEach((row) => {
                expect(row).toHaveClass('justify-center');
                expect(row).not.toHaveClass('justify-start');
            });
            expect(comparisonPanel.style.height).toBeTruthy();
            expect(comparisonGrid).toHaveClass('w-fit');
            expect(comparisonGrid).toHaveClass('justify-items-center');
            expect(comparisonGrid.style.alignSelf).toBe('center');
            expect(comparisonGrid).not.toHaveAttribute('data-content-center-delta');
            expect(Number.parseFloat(comparisonColumn.getAttribute('data-comparison-column-width-px') ?? '0')).toBeGreaterThan(0);
            expect(screen.getByTestId('activity-analytics-top-region')).toHaveAttribute('data-top-layout', 'side-by-side');
            expect(expectedBodyWidth).toBeGreaterThan(0);
        };

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 847, bodyHeight: 420 });
        });
        assertCenteringContract(847);

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 603, bodyHeight: 420 });
        });
        assertCenteringContract(603);

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 520, bodyHeight: 420 });
        });
        assertCenteringContract(520);
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

        expect(within(comparisonPanel).getAllByText('sin comparación')).toHaveLength(2);
        expect(within(comparisonPanel).getByText('25%')).toBeInTheDocument();
        expect(within(comparisonPanel).getByText('2026-06-18')).toBeInTheDocument();
        expect(within(comparisonPanel).queryByText('2026-06-19 (en curso)')).not.toBeInTheDocument();
        expect(within(comparisonPanel).queryByTestId('activity-analytics-comparison-context')).not.toBeInTheDocument();
        expect(comparisonPanel).not.toHaveTextContent('Cobertura completa');
        expect(comparisonPanel).not.toHaveTextContent(/Observado · Cob\./);
    });

    it('moves grouped productivity labels above the bars and removes the total-hours top labels', () => {
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
        ]);

        render(<ActivityAnalyticsWidget widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })} machines={MACHINES} />);

        const groupStack = screen.getByTestId('activity-analytics-group-stack');
        const visibleSegments = within(groupStack)
            .getAllByTestId('activity-analytics-group-segment')
            .filter((segment) => Number(segment.getAttribute('height')) > 0);
        const productivityLabel = within(groupStack).getByTestId('activity-analytics-group-productivity');
        const dateLabel = within(groupStack).getByText('2026-06-18');
        const topSegmentY = Math.min(...visibleSegments.map((segment) => Number(segment.getAttribute('y'))));
        const baselineY = Math.max(...visibleSegments.map((segment) => Number(segment.getAttribute('y')) + Number(segment.getAttribute('height'))));
        const chartHeight = Number(screen.getByTestId('activity-analytics-groups-chart').getAttribute('height'));
        const firstYAxisTick = screen.getAllByTestId('activity-analytics-y-axis-tick')[0];
        const hoverLayer = screen.getByTestId('hover-layer');
        const marginLeft = Number(hoverLayer.getAttribute('data-margin-left'));

        expect(Number(productivityLabel.getAttribute('y'))).toBeLessThan(topSegmentY);
        expect(productivityLabel).toHaveAttribute('fill', 'var(--color-industrial-text)');
        expect(productivityLabel.getAttribute('style')).toContain('var(--font-chart)');
        expect(Number(firstYAxisTick.getAttribute('x'))).toBe(marginLeft - 8);
        expect(chartHeight - baselineY).toBe(24);
        expect(Number(dateLabel.getAttribute('y'))).toBe(baselineY + 16);
        expect(chartHeight - Number(dateLabel.getAttribute('y'))).toBe(8);
        expect(dateLabel.getAttribute('style')).toContain('var(--font-chart)');
        expect(screen.queryByText('24.0 h')).not.toBeInTheDocument();
    });

    it('pins the en curso grouped label to the top row and renders a track-height traveling top cap only on the current partial bucket', () => {
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
                durationsMs: { prod: 4 * 60 * 60 * 1000, setup: 1 * 60 * 60 * 1000, stopped: 1 * 60 * 60 * 1000, noData: 0 },
                expectedDurationMs: 6 * 60 * 60 * 1000,
                productivityRatio: 4 / 6,
                productivityLabel: '67%',
            }),
            buildGroupedBucket({
                bucketKey: 'day-2',
                label: '2026-06-19',
                durationsMs: { prod: 5 * 60 * 60 * 1000, setup: 1 * 60 * 60 * 1000, stopped: 0, noData: 0 },
                expectedDurationMs: 6 * 60 * 60 * 1000,
                productivityRatio: 5 / 6,
                productivityLabel: '83%',
            }),
            buildGroupedBucket({
                bucketKey: 'day-3',
                label: '2026-06-20 (en curso)',
                durationsMs: { prod: 0, setup: 0, stopped: 0, noData: 60 * 60 * 1000 },
                expectedDurationMs: 6 * 60 * 60 * 1000,
                productivityRatio: null,
                productivityLabel: 'en curso',
                coverageRatio: 1 / 6,
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

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 848, bodyHeight: CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX });
        });

        const stacks = screen.getAllByTestId('activity-analytics-group-stack');
        const previousLabel = within(stacks[1]).getByTestId('activity-analytics-group-productivity');
        const currentLabel = within(stacks[2]).getByTestId('activity-analytics-group-productivity');
        const currentOutline = within(stacks[2]).getByTestId('activity-analytics-group-partial-outline');
        const currentTravelingTopCap = within(stacks[2]).getByTestId('activity-analytics-group-current-top-cap');
        const currentTravelingTopCapAura = within(currentTravelingTopCap).getByTestId('activity-analytics-group-current-top-cap-aura');
        const currentTravelingTopCapHalo = within(currentTravelingTopCap).getByTestId('activity-analytics-group-current-top-cap-halo');
        const currentTravelingTopCapCore = within(currentTravelingTopCap).getByTestId('activity-analytics-group-current-top-cap-core-stroke');
        const currentVisibleSegments = within(stacks[2])
            .getAllByTestId('activity-analytics-group-segment')
            .filter((segment) => Number(segment.getAttribute('height')) > 0);
        const visibleFilledHeight = currentVisibleSegments.reduce((total, segment) => total + Number(segment.getAttribute('height')), 0);
        const currentTopCapMetrics = parseRectMetrics(currentTravelingTopCapCore);
        const outlineMetrics = parseRectMetrics(currentOutline);

        expect(currentLabel).toHaveTextContent('en curso');
        expect(currentLabel).toHaveAttribute('data-label-placement', 'top-row');
        expect(Number(currentLabel.getAttribute('y'))).toBeLessThan(Math.min(...currentVisibleSegments.map((segment) => Number(segment.getAttribute('y')))));
        expect(Number(currentLabel.getAttribute('y'))).toBeLessThanOrEqual(Number(previousLabel.getAttribute('y')));
        expect(within(stacks[0]).queryByTestId('activity-analytics-group-current-top-cap')).not.toBeInTheDocument();
        expect(within(stacks[1]).queryByTestId('activity-analytics-group-current-top-cap')).not.toBeInTheDocument();
        expect(within(stacks[2]).queryByTestId('activity-analytics-group-top-cap')).not.toBeInTheDocument();
        expect(currentTravelingTopCap).toHaveAttribute('data-motion', 'traveling');
        expect(currentTravelingTopCap).toHaveAttribute('data-direction', 'bottom-to-top');
        expect(currentTravelingTopCap).toHaveAttribute('data-segment-key', 'prod');
        expect(currentTravelingTopCapAura.getAttribute('fill')).toContain('-group-top-cap-gradient');
        expect(currentTravelingTopCapHalo.getAttribute('fill')).toContain('-group-top-cap-gradient');
        expect(currentTravelingTopCapCore).toHaveAttribute('fill', CUSTOM_STATE_GRADIENTS.prod[0]);
        expect(Number(currentTravelingTopCap.getAttribute('data-track-height'))).toBeCloseTo(outlineMetrics.height, 2);
        expect(Number(currentTravelingTopCap.getAttribute('data-track-height'))).toBeGreaterThan(visibleFilledHeight);
        expect(currentTopCapMetrics.height).toBe(2);
        expect(currentTopCapMetrics.y).toBeGreaterThanOrEqual(outlineMetrics.y);
        expect(currentTopCapMetrics.y + currentTopCapMetrics.height).toBeLessThanOrEqual(outlineMetrics.y + outlineMetrics.height + 0.05);
    });

    it('falls back to a static current grouped top cap when reduced motion is enabled', () => {
        vi.stubGlobal('matchMedia', createMatchMediaMock(true));
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({
                bucketKey: 'day-3',
                label: '2026-06-20 (en curso)',
                durationsMs: { prod: 90 * 60 * 1000, setup: 30 * 60 * 1000, stopped: 0, noData: 0 },
                expectedDurationMs: 6 * 60 * 60 * 1000,
                productivityRatio: null,
                productivityLabel: 'en curso',
                coverageRatio: 2 / 6,
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

        act(() => {
            emitActivityAnalyticsLayoutSize({ bodyWidth: 848, bodyHeight: CHART_ELIGIBLE_GROUPS_BODY_HEIGHT_PX });
        });

        expect(screen.getByTestId('activity-analytics-group-current-top-cap')).toHaveAttribute('data-motion', 'static');
    });

    it('shows a production percent above incomplete grouped bars instead of cobertura incompleta', () => {
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
                durationsMs: { prod: 6 * 60 * 60 * 1000, setup: 2 * 60 * 60 * 1000, stopped: 1 * 60 * 60 * 1000, noData: 15 * 60 * 60 * 1000 },
                expectedDurationMs: 24 * 60 * 60 * 1000,
                utilizationRatio: 6 / 9,
                coverageRatio: 9 / 24,
                productivityRatio: null,
                productivityLabel: 'cobertura incompleta',
            }),
        ]);

        render(<ActivityAnalyticsWidget widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'day' } })} machines={MACHINES} />);

        const productivityLabel = screen.getByTestId('activity-analytics-group-productivity');

        expect(productivityLabel).toHaveTextContent('67%');
        expect(productivityLabel).not.toHaveTextContent('cobertura incompleta');
    });

    it('compares aggregated 12m Turno summary buckets by visible productivity and scales the bars to visible duration', () => {
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: null, shifts: [] },
            shifts: [
                { id: 'shift-a', label: 'Turno 1', start: '06:00', end: '14:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
                { id: 'shift-b', label: 'Turno 2', start: '14:00', end: '22:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
                { id: 'shift-c', label: 'Turno 3', start: '22:00', end: '06:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] },
            ],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useActivitySeries).mockReturnValue({
            data: { ...POPULATED_ACTIVITY_SERIES, range: '12m' },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([
            buildGroupedBucket({
                bucketKey: 'shift:shift-a:2026-01',
                label: '2026-01 · Turno 1',
                durationsMs: { prod: 4 * 60 * 60 * 1000, setup: 1 * 60 * 60 * 1000, stopped: 1 * 60 * 60 * 1000, noData: 2 * 60 * 60 * 1000 },
                expectedDurationMs: 31 * 8 * 60 * 60 * 1000,
                coverageRatio: 6 / (31 * 8),
                productivityRatio: null,
                productivityLabel: 'cobertura incompleta',
            }),
            buildGroupedBucket({
                bucketKey: 'shift:shift-a:2026-02',
                label: '2026-02 · Turno 1',
                durationsMs: { prod: 5 * 60 * 60 * 1000, setup: 1 * 60 * 60 * 1000, stopped: 1 * 60 * 60 * 1000, noData: 3 * 60 * 60 * 1000 },
                expectedDurationMs: 28 * 8 * 60 * 60 * 1000,
                coverageRatio: 7 / (28 * 8),
                productivityRatio: null,
                productivityLabel: 'cobertura incompleta',
            }),
            buildGroupedBucket({
                bucketKey: 'shift:shift-b:2026-01',
                label: '2026-01 · Turno 2',
                durationsMs: { prod: 3 * 60 * 60 * 1000, setup: 2 * 60 * 60 * 1000, stopped: 1 * 60 * 60 * 1000, noData: 2 * 60 * 60 * 1000 },
                expectedDurationMs: 31 * 8 * 60 * 60 * 1000,
                coverageRatio: 6 / (31 * 8),
                productivityRatio: null,
                productivityLabel: 'cobertura incompleta',
            }),
            buildGroupedBucket({
                bucketKey: 'shift:shift-b:2026-02',
                label: '2026-02 · Turno 2',
                durationsMs: { prod: 3 * 60 * 60 * 1000, setup: 2 * 60 * 60 * 1000, stopped: 1 * 60 * 60 * 1000, noData: 4 * 60 * 60 * 1000 },
                expectedDurationMs: 28 * 8 * 60 * 60 * 1000,
                coverageRatio: 6 / (28 * 8),
                productivityRatio: null,
                productivityLabel: 'cobertura incompleta',
            }),
            buildGroupedBucket({
                bucketKey: 'shift:shift-c:2026-01',
                label: '2026-01 · Turno 3',
                durationsMs: { prod: 1 * 60 * 60 * 1000, setup: 2 * 60 * 60 * 1000, stopped: 3 * 60 * 60 * 1000, noData: 2 * 60 * 60 * 1000 },
                expectedDurationMs: 31 * 8 * 60 * 60 * 1000,
                coverageRatio: 6 / (31 * 8),
                productivityRatio: null,
                productivityLabel: 'cobertura incompleta',
            }),
            buildGroupedBucket({
                bucketKey: 'shift:shift-c:2026-02',
                label: '2026-02 · Turno 3',
                durationsMs: { prod: 2 * 60 * 60 * 1000, setup: 2 * 60 * 60 * 1000, stopped: 2 * 60 * 60 * 1000, noData: 6 * 60 * 60 * 1000 },
                expectedDurationMs: 28 * 8 * 60 * 60 * 1000,
                coverageRatio: 6 / (28 * 8),
                productivityRatio: null,
                productivityLabel: 'cobertura incompleta',
            }),
        ]);

        render(
            <ActivityAnalyticsWidget
                widget={makeWidget({
                    displayOptions: {
                        ...makeWidget().displayOptions,
                        range: '12m',
                        groupBy: 'shift',
                    },
                })}
                machines={MACHINES}
            />,
        );

        const comparisonPanel = screen.getByTestId('activity-analytics-comparison');
        const yAxisTicks = screen.getAllByTestId('activity-analytics-y-axis-tick').map((tick) => tick.textContent);

        expect(within(comparisonPanel).getByText('Turno 1')).toBeInTheDocument();
        expect(within(comparisonPanel).getByText('Turno 3')).toBeInTheDocument();
        expect(comparisonPanel).toHaveTextContent('69%');
        expect(comparisonPanel).toHaveTextContent('25%');
        expect(within(comparisonPanel).queryAllByText('sin comparación')).toHaveLength(0);
        expect(yAxisTicks[0]).toBe('20h');
        expect(yAxisTicks).not.toContain('2088h');
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

        const groupsChart = screen.getByTestId('activity-analytics-groups-chart');

        expect(screen.getAllByTestId('activity-analytics-group-stack')).toHaveLength(2);
        expect(within(groupsChart).getAllByText('Turno 1').length).toBeGreaterThan(0);
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
        expect(screen.getByTestId('activity-analytics-summary-bars')).toHaveClass('border-industrial-border');
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

    it('records one completed refresh transition while keeping request pressure bounded to the new demanded range', async () => {
        const diagnostics = collectPerformanceDiagnostics();
        const requestedSelections: string[] = [];
        const activitySeriesState = {
            current: createActivitySeriesResult({
                data: POPULATED_ACTIVITY_SERIES,
            }),
        };

        vi.mocked(useActivitySeries).mockImplementation((params) => {
            requestedSelections.push(JSON.stringify(params));

            return activitySeriesState.current;
        });
        vi.spyOn(activityAnalyticsComputation, 'computeActivityAnalytics').mockImplementation(({ range }) => buildComputedSnapshot(
            range === '7d' ? 'Visible snapshot 7d' : 'Requested snapshot 30d',
        ));

        try {
            const { rerender } = render(
                <ActivityAnalyticsWidget
                    widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '7d', groupBy: 'shift' } })}
                    machines={MACHINES}
                />,
            );

            activitySeriesState.current = createActivitySeriesResult({
                data: POPULATED_ACTIVITY_SERIES,
                isFetching: true,
                isPlaceholderData: true,
                isRefreshing: true,
            });

            rerender(
                <ActivityAnalyticsWidget
                    widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '30d', groupBy: 'shift' } })}
                    machines={MACHINES}
                />,
            );

            activitySeriesState.current = createActivitySeriesResult({
                data: {
                    ...POPULATED_ACTIVITY_SERIES,
                    range: '30d',
                },
            });

            rerender(
                <ActivityAnalyticsWidget
                    widget={makeWidget({ displayOptions: { ...makeWidget().displayOptions, range: '30d', groupBy: 'shift' } })}
                    machines={MACHINES}
                />,
            );

            await waitFor(() => expect(diagnostics.events.filter((event) => event.event === 'transition_measured')).toHaveLength(1));

            expect(Array.from(new Set(requestedSelections))).toEqual([
                JSON.stringify({ machineId: 101, range: '7d' }),
                JSON.stringify({ machineId: 101, range: '30d' }),
            ]);
        } finally {
            diagnostics.unsubscribe();
        }
    });

    it('keeps reduced shell bottom padding scoped to the widget shell instead of the visual panels stack', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: POPULATED_ACTIVITY_SERIES,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
        mockComputedAnalytics([buildGroupedBucket()]);

        const { container } = render(<ActivityAnalyticsWidget widget={makeWidget()} machines={MACHINES} className="initial" />);

        const widgetShell = container.firstElementChild;
        const visualPanels = screen.getByTestId('activity-analytics-visual-panels');

        expect(widgetShell).toHaveClass('glass-panel', 'px-5', 'pt-5', 'pb-3', 'initial');
        expect(widgetShell).not.toHaveClass('p-5');
        expect(visualPanels).toHaveClass('gap-3');
        expect(visualPanels).not.toHaveClass('pb-3');
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
