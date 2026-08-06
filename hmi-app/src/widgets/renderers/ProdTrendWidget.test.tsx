import '@testing-library/jest-dom/vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProdTrendWidgetConfig } from '../../domain/admin.types';
import type { ContractMachine } from '../../domain/dataContract.types';
import { isDataActivitySeriesEnabled } from '../../config/dataConnection.config';
import { useTemporalSettings } from '../../hooks/useTemporalSettings';
import { useActivitySeries } from '../../queries/useActivitySeries';
import { useProdTrendDataSource, type UseProdTrendDataSourceResult } from '../../queries/useProdTrendDataSource';
import {
    resolveWidgetChartLayoutMetrics,
    WIDGET_CHART_CONTAINER_CLASS,
    WIDGET_CHART_HEADER_CLASS,
} from '../../components/ui/WidgetChartLayout.shared';
import ProdTrendWidget, { clampLineGlowBlur, clampLineStrokeWidth, resolveProdTrendLatestValueLabelPlacement } from './ProdTrendWidget';

function expectRuntimeControlIndicator(button: HTMLElement, expectedClasses: string[], unexpectedClasses: string[] = []) {
    const indicator = within(button).getByTestId('prod-trend-widget-runtime-control-indicator');

    expect(indicator).toHaveClass('w-1/4', 'min-w-[0.45rem]', 'h-[1.5px]');
    expect(indicator).toHaveClass(...expectedClasses);

    unexpectedClasses.forEach((className) => {
        expect(indicator).not.toHaveClass(className);
    });
}

class MockResizeObserver implements ResizeObserver {
    public constructor(private readonly callback: ResizeObserverCallback) {}
    public observe(target: Element): void {
        this.callback([{ target, contentRect: { width: 640, height: 180, top: 0, left: 0, bottom: 180, right: 640, x: 0, y: 0, toJSON: () => ({}) } as ResizeObserverEntry['contentRect'] } as ResizeObserverEntry], this);
    }
    public unobserve(): void {}
    public disconnect(): void {}
}

vi.mock('../../config/dataConnection.config', () => ({ isDataActivitySeriesEnabled: vi.fn() }));
vi.mock('../../hooks/useTemporalSettings', () => ({ useTemporalSettings: vi.fn() }));
vi.mock('../../queries/useActivitySeries', () => ({ useActivitySeries: vi.fn() }));
vi.mock('../../queries/useProdTrendDataSource', () => ({ useProdTrendDataSource: vi.fn() }));
vi.mock('../../components/ui/ChartTooltip', () => ({ default: () => null }));
vi.mock('../../components/ui/AnchoredOverlay', () => ({
    default: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));

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

function makeWidget(overrides?: Partial<ProdTrendWidgetConfig>): ProdTrendWidgetConfig {
    return {
        id: 'prod-trend-1',
        type: 'prod-trend',
        title: 'PROD-TREND',
        position: { x: 0, y: 0 },
        size: { w: 11, h: 4 },
        binding: { mode: 'real_variable', bindingVersion: 'node-red-v1', machineId: 101 },
        displayOptions: { range: '7d', groupBy: 'day', setupThresholdKw: 0.15, prodThresholdKw: 0.25 },
        ...overrides,
    };
}

function resolveExpectedProdTrendLayout(firstLabel: string, lastLabel: string) {
    return resolveWidgetChartLayoutMetrics({
        width: 640,
        height: 180,
        hasTopAdornments: true,
        firstXAxisLabel: firstLabel,
        lastXAxisLabel: lastLabel,
        yAxisTickLabels: ['100', '75', '50', '25', '0'],
        idPrefix: 'prod-trend-test-layout',
        alignPlotAreaToXAxisLabels: true,
    });
}

function buildDenseActivitySeries(startIso: string, points: number, bucketMs: number, value: number) {
    const startMs = Date.parse(startIso);

    return Array.from({ length: points }, (_, index) => {
        const timestampMs = startMs + (index * bucketMs);
        const timestamp = new Date(timestampMs).toISOString();

        return {
            timestamp,
            timestampMs,
            value,
        };
    });
}

const MACHINES: ContractMachine[] = [{ unitId: 101, name: 'Extrusora 101', status: 'online', lastSuccess: '2026-06-18T12:00:00.000Z', ageMs: 0, values: {} }];
const DENSE_ACTIVITY_SERIES = buildDenseActivitySeries('2026-06-18T00:00:00.000Z', 864, 300000, 0.4);

function makeDataSourceResult(overrides: Partial<UseProdTrendDataSourceResult> = {}): UseProdTrendDataSourceResult {
    return {
        state: {
            configuredMode: 'real',
            effectiveMode: 'real',
            phase: 'active',
            emptyStreak: 0,
            successStreak: 0,
            committedSource: 'real',
            fallbackReason: null,
        },
        effectiveMode: 'real',
        source: 'real',
        response: {
            contractVersion: '1.0.0',
            machineId: 101,
            variableKey: 'Total kW',
            range: '7d',
            unit: 'kW',
            purpose: 'activity-analytics',
            window: { start: '2026-06-18T00:00:00.000Z', end: '2026-06-20T23:55:00.000Z', timezone: 'UTC', bucket: '5m', bucketMs: 300000 },
            series: DENSE_ACTIVITY_SERIES,
            summary: null,
        },
        analytics: null,
        error: null,
        retryRequested: false,
        saveLastKnownGood: false,
        lastRealSuccessAt: null,
        isLoading: false,
        isFetching: false,
        isRefreshing: false,
        isEnabled: true,
        ...overrides,
    };
}

describe('ProdTrendWidget', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    beforeEach(() => {
        global.ResizeObserver = MockResizeObserver;
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
            font: '',
            measureText: (text: string) => ({ width: text.length * 8 }),
        } as unknown as CanvasRenderingContext2D);
        vi.mocked(isDataActivitySeriesEnabled).mockReturnValue(true);
        vi.mocked(useTemporalSettings).mockReturnValue({ config: { plantTimezone: 'UTC' }, shifts: [] } as never);
        vi.mocked(useActivitySeries).mockReturnValue({
            data: null,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
            isFetching: false,
            isPlaceholderData: false,
            isRefreshing: false,
        });
        vi.mocked(useProdTrendDataSource).mockImplementation(({ configuredMode, params }) => {
            const query = vi.mocked(useActivitySeries)(params);
            const response = query.data;
            const effectiveMode = configuredMode === 'automatic' ? 'real' : configuredMode;

            return makeDataSourceResult({
                state: {
                    configuredMode: effectiveMode,
                    effectiveMode,
                    phase: 'active',
                    emptyStreak: 0,
                    successStreak: 0,
                    committedSource: response ? 'real' : null,
                    fallbackReason: null,
                },
                effectiveMode,
                source: response ? 'real' : null,
                response,
                error: query.error,
                isLoading: query.isLoading,
                isFetching: query.isFetching,
                isRefreshing: query.isRefreshing,
                isEnabled: query.isEnabled,
            });
        });
    });

    it('renders the standalone trend with the standard header, scales, and no extra inner panel', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: {
                contractVersion: '1.0.0',
                machineId: 101,
                variableKey: 'Total kW',
                range: '7d',
                unit: 'kW',
                purpose: 'activity-analytics',
                window: { start: '2026-06-18T00:00:00.000Z', end: '2026-06-20T23:55:00.000Z', timezone: 'UTC', bucket: '5m', bucketMs: 300000 },
                series: DENSE_ACTIVITY_SERIES,
                summary: null,
            },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<ProdTrendWidget widget={makeWidget()} machines={MACHINES} />);

        const chart = screen.getByTestId('prod-trend-widget-chart');

        expect(screen.getByText('PROD-TREND')).toBeInTheDocument();
        expect(screen.getByTestId('prod-trend-widget-data-mode')).toHaveTextContent('REAL');
        expect(screen.getByTestId('prod-trend-widget-header-icon')).toBeInTheDocument();
        expect(screen.getByTestId('prod-trend-widget-runtime-controls')).toHaveClass('flex', 'items-center', 'gap-2.5');
        expect(screen.getByTestId('prod-trend-widget-runtime-range-selector')).toBeInTheDocument();
        expect(screen.getByTestId('prod-trend-widget-runtime-group-selector')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'DÍA' })).toBeInTheDocument();
        expect(chart).toHaveAttribute('data-y-domain-min', '0');
        expect(chart).toHaveAttribute('data-y-domain-max', '100');
        expect(screen.queryByTestId('prod-trend-widget-panel')).not.toBeInTheDocument();
        expect(screen.getByTestId('prod-trend-widget-chart-shell')).toBeInTheDocument();
        expect(screen.getByText('PROD-TREND').closest(`.${WIDGET_CHART_HEADER_CLASS.split(' ').join('.')}`)).toHaveClass(...WIDGET_CHART_HEADER_CLASS.split(' '));
        expect(screen.getByTestId('prod-trend-widget-chart-shell')).toHaveClass(...WIDGET_CHART_CONTAINER_CLASS.split(' '));
        expect(screen.getByTestId('prod-trend-widget-y-axis-unit')).toHaveTextContent('%');
        expect(screen.getAllByTestId('prod-trend-widget-y-axis-tick').map((node) => node.textContent)).toEqual([
            '100',
            '75',
            '50',
            '25',
            '0',
        ]);
        const xAxisLabels = screen.getAllByTestId('prod-trend-widget-x-axis-label');
        const expectedLayout = resolveExpectedProdTrendLayout(
            xAxisLabels[0]?.textContent ?? '',
            xAxisLabels.at(-1)?.textContent ?? '',
        );
        xAxisLabels.forEach((label) => {
            expect(label).toHaveAttribute('text-anchor', 'middle');
        });
        expect(xAxisLabels[0]).toHaveAttribute('x', String(expectedLayout.xAxisLabels.left));
        expect(xAxisLabels.at(-1)).toHaveAttribute('x', String(expectedLayout.xAxisLabels.right));
        expect(screen.getByTestId('prod-trend-widget-final-point-pulse')).toBeInTheDocument();
        expect(screen.getByTestId('prod-trend-widget-final-point-aura')).toHaveClass(
            'activity-analytics-prod-trend-final-point-flicker',
            'activity-analytics-prod-trend-final-point-flicker-aura',
        );
        const chartSvg = screen.getByTestId('prod-trend-widget-chart');
        const overlaySvg = screen.getByTestId('prod-trend-widget-overlay-svg');
        const pulse = screen.getByTestId('prod-trend-widget-final-point-pulse');
        const latestValueLabel = screen.getByTestId('prod-trend-widget-latest-value-label');

        expect(overlaySvg).toHaveClass('pointer-events-none', 'absolute', 'left-0');
        expect(overlaySvg).toHaveStyle({ top: '-20px', overflow: 'visible' });
        expect(overlaySvg).toHaveAttribute('viewBox', '0 -20 660 200');
        expect(screen.getByTestId('prod-trend-widget-latest-point-overlay')).not.toHaveAttribute('clip-path');
        expect(pulse.closest('svg')).toBe(overlaySvg);
        expect(latestValueLabel.closest('svg')).toBe(overlaySvg);
        expect(chartSvg).not.toContainElement(pulse);
        expect(chartSvg).not.toContainElement(latestValueLabel);
        expect(latestValueLabel).toHaveAttribute(
            'x',
            pulse.getAttribute('cx') ?? '',
        );
        expect(pulse).toHaveAttribute('cx', String(expectedLayout.plotArea.right));
        expect(latestValueLabel).toHaveAttribute('text-anchor', 'middle');
        expect(screen.getByTestId('prod-trend-widget-traveling-glow')).toBeInTheDocument();
        expect(screen.getByTestId('prod-trend-widget-chart-shell')).toHaveClass('-mx-3', '-mb-3');
        expect(screen.getByTestId('prod-trend-widget-chart-shell')).not.toHaveClass('mt-2');
        expect(screen.getByTestId('prod-trend-widget-viewport')).toHaveClass('overflow-hidden');
        expect(screen.getByTestId('prod-trend-widget-viewport')).not.toHaveClass('hmi-scrollbar', 'overflow-x-auto');
    });

    it('announces fallback state and source-specific accessible detail without mixing sources', () => {
        const fallbackResponse = {
            contractVersion: '1.0.0',
            machineId: 101,
            variableKey: undefined,
            range: '7d' as const,
            unit: 'kW',
            purpose: 'activity-analytics' as const,
            window: { start: '2026-06-18T00:00:00.000Z', end: '2026-06-20T23:55:00.000Z', timezone: 'UTC', bucket: '5m', bucketMs: 300000 },
            series: DENSE_ACTIVITY_SERIES.map((point) => ({ ...point, value: 0.8 })),
            summary: null,
        };
        vi.mocked(useProdTrendDataSource).mockReturnValue(makeDataSourceResult({
            effectiveMode: 'fallback',
            source: 'last-known-good',
            response: fallbackResponse,
            state: {
                configuredMode: 'automatic',
                effectiveMode: 'fallback',
                phase: 'fallback',
                emptyStreak: 0,
                successStreak: 0,
                committedSource: 'last-known-good',
                fallbackReason: 'network-error',
            },
        }));

        render(<ProdTrendWidget widget={makeWidget({ displayOptions: { dataMode: 'automatic', range: '7d', groupBy: 'day' } })} machines={MACHINES} />);

        const indicator = screen.getByTestId('prod-trend-widget-data-mode');
        const detail = screen.getByTestId('prod-trend-widget-data-mode-detail');
        expect(indicator).toHaveTextContent('FALLBACK');
        expect(indicator).toHaveAttribute('role', 'status');
        expect(indicator).toHaveAttribute('aria-describedby', detail.id);
        expect(detail).toHaveTextContent('historial real no está disponible temporalmente');
        expect(detail).toHaveTextContent('respaldo histórico confiable');
        expect(detail).toHaveTextContent('último éxito real');
        expect(detail).toHaveTextContent('último dato real válido');
        expect(detail).toHaveTextContent('Razón de respaldo: network-error');
        expect(screen.getByTestId('prod-trend-widget-line')).toBeInTheDocument();
    });

    it('renders simulated data without querying real history or claiming fallback provenance', async () => {
        const user = userEvent.setup();
        vi.mocked(useProdTrendDataSource).mockReturnValue(makeDataSourceResult({
            effectiveMode: 'simulated',
            source: null,
            response: null,
            state: {
                configuredMode: 'simulated',
                effectiveMode: 'simulated',
                phase: 'active',
                emptyStreak: 0,
                successStreak: 0,
                committedSource: null,
                fallbackReason: null,
            },
        }));
        vi.mocked(useActivitySeries).mockClear();
        vi.mocked(isDataActivitySeriesEnabled).mockClear();

        render(<ProdTrendWidget widget={makeWidget({ displayOptions: { dataMode: 'simulated', range: '7d', groupBy: 'day' } })} machines={MACHINES} />);

        expect(screen.getByTestId('prod-trend-widget-data-mode')).toHaveTextContent('SIMULADO');
        expect(screen.getByTestId('prod-trend-widget-chart')).toBeInTheDocument();
        expect(screen.queryByTestId('prod-trend-widget-data-mode-detail')).not.toBeInTheDocument();
        expect(screen.queryByText(/plantilla histórica/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/respaldo histórico/i)).not.toBeInTheDocument();
        expect(vi.mocked(useActivitySeries)).not.toHaveBeenCalled();
        expect(vi.mocked(isDataActivitySeriesEnabled)).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: '30d' }));
        await user.click(screen.getByRole('button', { name: '12m' }));

        expect(screen.getByRole('button', { name: '12m' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('prod-trend-widget-chart')).toBeInTheDocument();
    });

    it('matches Real 7D day temporal visualization while disconnected', () => {
        vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-19T12:00:00.000Z'));
        vi.mocked(useProdTrendDataSource).mockReturnValue(makeDataSourceResult({
            effectiveMode: 'simulated',
            source: null,
            response: null,
            error: null,
            isLoading: true,
            state: {
                configuredMode: 'simulated',
                effectiveMode: 'simulated',
                phase: 'active',
                emptyStreak: 0,
                successStreak: 0,
                committedSource: null,
                fallbackReason: null,
            },
        }));

        render(
            <ProdTrendWidget
                widget={makeWidget({ displayOptions: { dataMode: 'simulated', range: '7d', groupBy: 'day' } })}
                machines={[]}
                connection={{ globalStatus: 'unknown', lastSuccess: null, ageMs: null }}
                isLoadingOverview
                hasOverviewError
                isLoadingData
            />,
        );

        expect(screen.getByTestId('prod-trend-widget-data-mode')).toHaveTextContent('SIMULADO');
        expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'DÍA' })).toHaveAttribute('aria-pressed', 'true');
        const displayPoints = screen.getAllByTestId('prod-trend-widget-hit-area');
        const xAxisLabels = screen.getAllByTestId('prod-trend-widget-x-axis-label').map((label) => label.textContent);
        const productivityValues = displayPoints.map((point) => Number(point.getAttribute('data-productivity-ratio')));
        const chartYValues = displayPoints.map((point) => Number(point.getAttribute('data-chart-y')));
        const linePath = screen.getByTestId('prod-trend-widget-line').getAttribute('d');
        const areaPath = screen.getByTestId('prod-trend-widget-area').getAttribute('d');

        expect(displayPoints).toHaveLength(7);
        expect(screen.getAllByTestId('prod-trend-widget-band-group')).toHaveLength(3);
        expect(xAxisLabels).toEqual(['13/06', '14/06', '15/06', '16/06', '17/06', '18/06', '19/06']);
        expect(xAxisLabels.every((label) => !/^\d{2}:\d{2}$/.test(label ?? ''))).toBe(true);
        expect(displayPoints.every((point) => point.getAttribute('data-productivity-ratio') !== '')).toBe(true);
        expect(productivityValues.every(Number.isFinite)).toBe(true);
        expect(new Set(productivityValues).size).toBeGreaterThanOrEqual(2);
        expect(displayPoints.every((point) => point.getAttribute('data-chart-y') !== '')).toBe(true);
        expect(chartYValues.every(Number.isFinite)).toBe(true);
        expect(new Set(chartYValues).size).toBeGreaterThanOrEqual(2);
        expect(linePath).toBeTruthy();
        expect(areaPath).toBeTruthy();
        expect(screen.queryByTestId('prod-trend-widget-empty')).not.toBeInTheDocument();
        expect(screen.queryByTestId('prod-trend-widget-runtime-state')).not.toBeInTheDocument();
        expect(screen.queryByText('Respaldo histórico confiable no disponible')).not.toBeInTheDocument();
        expect(screen.queryByText('Sin conexión')).not.toBeInTheDocument();
        expect(screen.queryByTestId('prod-trend-widget-data-mode-detail')).not.toBeInTheDocument();
    });

    it('keeps Real mode on the disconnected runtime state when overview connectivity is unavailable', () => {
        vi.mocked(useProdTrendDataSource).mockReturnValue(makeDataSourceResult({
            source: null,
            response: null,
            error: null,
        }));

        render(
            <ProdTrendWidget
                widget={makeWidget({ displayOptions: { dataMode: 'real', range: '7d', groupBy: 'day' } })}
                machines={[]}
                connection={{ globalStatus: 'offline', lastSuccess: null, ageMs: null }}
                hasOverviewError
            />,
        );

        expect(screen.getByText('Sin conexión')).toBeInTheDocument();
        expect(screen.queryByText('Respaldo histórico confiable no disponible')).not.toBeInTheDocument();
        expect(screen.queryByTestId('prod-trend-widget-line')).not.toBeInTheDocument();
    });

    it('renders an available Automatic trusted fallback without mixing it with the disconnected overview state', () => {
        vi.mocked(useProdTrendDataSource).mockReturnValue(makeDataSourceResult({
            effectiveMode: 'fallback',
            source: 'packaged-capture',
            state: {
                configuredMode: 'automatic',
                effectiveMode: 'fallback',
                phase: 'fallback',
                emptyStreak: 0,
                successStreak: 0,
                committedSource: 'packaged-capture',
                fallbackReason: 'network-error',
            },
            response: {
                ...makeDataSourceResult().response!,
                variableKey: undefined,
                series: DENSE_ACTIVITY_SERIES.map((point) => ({ ...point, value: 0.8 })),
            } as never,
        }));

        render(
            <ProdTrendWidget
                widget={makeWidget({ displayOptions: { dataMode: 'automatic', range: '7d', groupBy: 'day' } })}
                machines={[]}
                connection={{ globalStatus: 'unknown', lastSuccess: null, ageMs: null }}
                hasOverviewError
            />,
        );

        expect(screen.getByTestId('prod-trend-widget-data-mode')).toHaveTextContent('FALLBACK');
        expect(screen.getByTestId('prod-trend-widget-line')).toBeInTheDocument();
        expect(screen.queryByText('Sin conexión')).not.toBeInTheDocument();
        expect(screen.queryByText('Respaldo histórico confiable no disponible')).not.toBeInTheDocument();
    });

    it('states that Automatic has no trusted backup when the packaged manifest is empty', () => {
        vi.mocked(useProdTrendDataSource).mockReturnValue(makeDataSourceResult({
            effectiveMode: 'fallback',
            source: null,
            response: null,
            error: new Error('No matching PROD-TREND fallback source is available'),
            state: {
                configuredMode: 'automatic',
                effectiveMode: 'fallback',
                phase: 'fallback',
                emptyStreak: 2,
                successStreak: 0,
                committedSource: null,
                fallbackReason: 'repeated-empty-series',
            },
        }));

        render(
            <ProdTrendWidget
                widget={makeWidget({ displayOptions: { dataMode: 'automatic', range: '7d', groupBy: 'day' } })}
                machines={[]}
                connection={{ globalStatus: 'unknown', lastSuccess: null, ageMs: null }}
                hasOverviewError
            />,
        );

        expect(screen.getByText('Respaldo histórico confiable no disponible')).toBeInTheDocument();
        expect(screen.getByTestId('prod-trend-widget-data-mode-detail')).toHaveTextContent('Fuente: ninguna');
        expect(screen.queryByText('Sin conexión')).not.toBeInTheDocument();
        expect(screen.queryByTestId('prod-trend-widget-line')).not.toBeInTheDocument();
    });

    it('explains packaged fallback as a historical template for assistive technology', () => {
        vi.mocked(useProdTrendDataSource).mockReturnValue(makeDataSourceResult({
            effectiveMode: 'fallback',
            source: 'packaged-capture',
            state: {
                configuredMode: 'automatic',
                effectiveMode: 'fallback',
                phase: 'fallback',
                emptyStreak: 0,
                successStreak: 0,
                committedSource: 'packaged-capture',
                fallbackReason: 'network-error',
            },
        }));

        render(<ProdTrendWidget widget={makeWidget({ displayOptions: { dataMode: 'automatic', range: '7d', groupBy: 'day' } })} machines={MACHINES} />);

        expect(screen.getByTestId('prod-trend-widget-data-mode-detail')).toHaveTextContent('plantilla histórica');
        expect(screen.getByTestId('prod-trend-widget-data-mode-detail')).toHaveTextContent('historical-template');
        expect(screen.getByTestId('prod-trend-widget-data-mode-detail')).toHaveTextContent('Último éxito real: no disponible');
        expect(screen.getByTestId('prod-trend-widget-data-mode-detail')).toHaveTextContent('Razón de respaldo: network-error');
    });

    it('announces last real success availability when fallback has no local source', () => {
        vi.mocked(useProdTrendDataSource).mockReturnValue({
            ...makeDataSourceResult({
                effectiveMode: 'fallback',
                source: null,
                response: null,
                state: {
                    configuredMode: 'automatic',
                    effectiveMode: 'fallback',
                    phase: 'fallback',
                    emptyStreak: 2,
                    successStreak: 0,
                    committedSource: null,
                    fallbackReason: 'repeated-empty-series',
                },
            }),
            lastRealSuccessAt: Date.parse('2026-06-18T12:34:56.000Z'),
        });

        render(<ProdTrendWidget widget={makeWidget({ displayOptions: { dataMode: 'automatic', range: '7d', groupBy: 'day' } })} machines={MACHINES} />);

        const detail = screen.getByTestId('prod-trend-widget-data-mode-detail');
        expect(detail).toHaveTextContent('Último éxito real:');
        expect(detail).not.toHaveTextContent('no disponible');
        expect(detail).toHaveTextContent('Razón de respaldo: repeated-empty-series');
        expect(detail).toHaveTextContent('Fuente: ninguna');
        expect(detail).toHaveTextContent('respaldo histórico confiable disponible');
    });

    it('states when last real success is unavailable in no-source fallback detail', () => {
        vi.mocked(useProdTrendDataSource).mockReturnValue(makeDataSourceResult({
            effectiveMode: 'fallback',
            source: null,
            response: null,
            state: {
                configuredMode: 'automatic',
                effectiveMode: 'fallback',
                phase: 'fallback',
                emptyStreak: 0,
                successStreak: 0,
                committedSource: null,
                fallbackReason: 'network-error',
            },
        }));

        render(<ProdTrendWidget widget={makeWidget({ displayOptions: { dataMode: 'automatic', range: '7d', groupBy: 'day' } })} machines={MACHINES} />);

        expect(screen.getByTestId('prod-trend-widget-data-mode-detail')).toHaveTextContent('Último éxito real: no disponible');
    });

    it('applies the PROD-TREND temporal header selectors to range and grouping at runtime', async () => {
        const user = userEvent.setup();

        vi.mocked(useActivitySeries).mockReturnValue({
            data: {
                contractVersion: '1.0.0',
                machineId: 101,
                variableKey: 'Total kW',
                range: '7d',
                unit: 'kW',
                purpose: 'activity-analytics',
                window: { start: '2026-06-18T00:00:00.000Z', end: '2026-06-20T23:55:00.000Z', timezone: 'UTC', bucket: '5m', bucketMs: 300000 },
                series: DENSE_ACTIVITY_SERIES,
                summary: null,
            },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<ProdTrendWidget widget={makeWidget({ displayOptions: { range: '7d', groupBy: 'day', setupThresholdKw: 0.15, prodThresholdKw: 0.25 } })} machines={MACHINES} />);

        const groupSelector = screen.getByTestId('prod-trend-widget-runtime-group-selector');
        const getGroupButton = (name: string) => within(groupSelector).getByRole('button', { name });
        const initialRangeButton = screen.getByRole('button', { name: '7d' });
        const initialRangeLabel = within(initialRangeButton).getByText('7d');
        const initialGroupLabel = within(getGroupButton('DÍA')).getByText('DÍA');

        expect(getGroupButton('SEMANA')).toBeDisabled();
        expect(getGroupButton('MES')).toBeDisabled();
        expect(getGroupButton('SEMANA')).toHaveClass('cursor-default');
        expect(getGroupButton('SEMANA')).not.toHaveClass('disabled:cursor-not-allowed');
        expect(initialRangeButton).toHaveClass('group/control', 'rounded-md', 'border-admin-accent/30', 'bg-admin-accent/10', 'text-admin-accent');
        expect(initialRangeButton).not.toHaveClass('text-industrial-text', 'text-industrial-muted', 'hover:text-industrial-text');
        expect(initialRangeLabel).toHaveClass('translate-y-[1.5px]');
        expectRuntimeControlIndicator(initialRangeButton, ['bg-transparent'], ['bg-current', 'group-hover/control:bg-current', 'group-hover:bg-current', 'bg-industrial-muted']);
        expect(getGroupButton('DÍA')).toHaveClass('group/control', 'rounded-md', 'border-admin-accent/30', 'bg-admin-accent/10', 'text-admin-accent');
        expect(getGroupButton('DÍA')).not.toHaveClass('text-industrial-text', 'text-industrial-muted', 'hover:text-industrial-text');
        expect(initialGroupLabel).toHaveClass('translate-y-[1.5px]');
        expectRuntimeControlIndicator(getGroupButton('DÍA'), ['bg-transparent'], ['bg-current', 'group-hover/control:bg-current', 'group-hover:bg-current', 'bg-industrial-muted']);

        await user.click(screen.getByRole('button', { name: '30d' }));

        expect(screen.getByRole('button', { name: '30d' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: '30d' })).toHaveClass('rounded-md', 'border-admin-accent/30', 'bg-admin-accent/10', 'text-admin-accent');
        expect(screen.getByRole('button', { name: '30d' })).not.toHaveClass('text-industrial-text', 'text-industrial-muted', 'hover:text-industrial-text');
        expectRuntimeControlIndicator(screen.getByRole('button', { name: '30d' }), ['bg-transparent'], ['bg-current', 'group-hover/control:bg-current', 'group-hover:bg-current', 'bg-industrial-muted']);
        expect(screen.getByRole('button', { name: '7d' })).toHaveClass('text-industrial-muted', 'hover:text-industrial-text');
        expect(screen.getByRole('button', { name: '7d' })).not.toHaveClass('rounded-md', 'border-admin-accent/30', 'bg-admin-accent/10', 'text-admin-accent');
        expectRuntimeControlIndicator(screen.getByRole('button', { name: '7d' }), ['bg-transparent'], ['bg-current', 'group-hover/control:bg-current', 'group-hover:bg-current']);
        expect(vi.mocked(useActivitySeries)).toHaveBeenLastCalledWith({ machineId: 101, range: '30d' });
        expect(getGroupButton('DÍA')).toHaveAttribute('aria-pressed', 'true');

        await user.click(screen.getByRole('button', { name: '12m' }));

        expect(screen.getByRole('button', { name: '12m' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: '12m' })).toHaveClass('rounded-md', 'border-admin-accent/30', 'bg-admin-accent/10', 'text-admin-accent');
        expect(screen.getByRole('button', { name: '12m' })).not.toHaveClass('text-industrial-text', 'text-industrial-muted', 'hover:text-industrial-text');
        expectRuntimeControlIndicator(screen.getByRole('button', { name: '12m' }), ['bg-transparent'], ['bg-current', 'group-hover/control:bg-current', 'group-hover:bg-current', 'bg-industrial-muted']);
        expect(vi.mocked(useActivitySeries)).toHaveBeenLastCalledWith({ machineId: 101, range: '12m' });
        expect(getGroupButton('TURNO')).toHaveAttribute('aria-pressed', 'true');
        expect(getGroupButton('TURNO')).toHaveClass('rounded-md', 'border-admin-accent/30', 'bg-admin-accent/10', 'text-admin-accent');
        expect(getGroupButton('TURNO')).not.toHaveClass('text-industrial-text', 'text-industrial-muted', 'hover:text-industrial-text');
        expectRuntimeControlIndicator(getGroupButton('TURNO'), ['bg-transparent'], ['bg-current', 'group-hover/control:bg-current', 'group-hover:bg-current', 'bg-industrial-muted']);
        expect(getGroupButton('SEMANA')).toBeDisabled();
        expect(getGroupButton('MES')).toBeEnabled();
        expect(getGroupButton('SEMANA')).toHaveClass('cursor-default', 'text-industrial-muted/50');
        expectRuntimeControlIndicator(getGroupButton('SEMANA'), ['bg-transparent'], ['group-hover/control:bg-current', 'group-hover:bg-current', 'bg-current', 'bg-industrial-muted']);

        await user.click(getGroupButton('MES'));

        expect(getGroupButton('MES')).toHaveAttribute('aria-pressed', 'true');
        expect(getGroupButton('MES')).toHaveClass('rounded-md', 'border-admin-accent/30', 'bg-admin-accent/10', 'text-admin-accent');
        expect(getGroupButton('MES')).not.toHaveClass('text-industrial-text', 'text-industrial-muted', 'hover:text-industrial-text');
        expectRuntimeControlIndicator(getGroupButton('MES'), ['bg-transparent'], ['bg-current', 'group-hover/control:bg-current', 'group-hover:bg-current', 'bg-industrial-muted']);
        expect(getGroupButton('TURNO')).toHaveClass('text-industrial-muted', 'hover:text-industrial-text');
        expect(getGroupButton('TURNO')).not.toHaveClass('rounded-md', 'border-admin-accent/30', 'bg-admin-accent/10', 'text-admin-accent');
        expectRuntimeControlIndicator(getGroupButton('TURNO'), ['bg-transparent'], ['bg-current', 'group-hover/control:bg-current', 'group-hover:bg-current']);
    });

    it('renders temporal controls in one horizontal row with the separator restored', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: {
                contractVersion: '1.0.0',
                machineId: 101,
                variableKey: 'Total kW',
                range: '7d',
                unit: 'kW',
                purpose: 'activity-analytics',
                window: { start: '2026-06-18T00:00:00.000Z', end: '2026-06-20T23:55:00.000Z', timezone: 'UTC', bucket: '5m', bucketMs: 300000 },
                series: DENSE_ACTIVITY_SERIES,
                summary: null,
            },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<ProdTrendWidget widget={makeWidget()} machines={MACHINES} />);

        const runtimeControls = screen.getByTestId('prod-trend-widget-runtime-controls');
        const rangeSelector = screen.getByTestId('prod-trend-widget-runtime-range-selector');
        const groupSelector = screen.getByTestId('prod-trend-widget-runtime-group-selector');

        expect(runtimeControls.children).toHaveLength(2);
        expect(runtimeControls.children[0]).toBe(rangeSelector);
        expect(runtimeControls.children[1]).toBe(groupSelector);
        expect(groupSelector).toHaveClass('border-l', 'border-industrial-muted/25', 'pl-2.5');
        expect(within(rangeSelector).getAllByRole('button').map((button) => button.textContent)).toEqual(['7d', '30d', '12m']);
        expect(within(groupSelector).getAllByRole('button').map((button) => button.textContent)).toEqual(['TURNO', 'DÍA', 'SEMANA', 'MES']);
        within(rangeSelector).getAllByRole('button').forEach((button) => {
            expect(button).toHaveClass('px-2', 'py-1');
            expect(button).not.toHaveClass('px-2.5');
        });
        within(groupSelector).getAllByRole('button').forEach((button) => {
            expect(button).toHaveClass('px-2', 'py-1');
            expect(button).not.toHaveClass('px-2.5');
        });
        expect(screen.getAllByTestId('prod-trend-widget-runtime-control-indicator')).toHaveLength(7);
    });

    it('restores the traveling glow after each pause cycle without affecting the final endpoint overlay', () => {
        vi.stubGlobal('matchMedia', createMatchMediaMock(false));
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
        vi.spyOn(Math, 'random').mockReturnValue(0.5);

        const scheduledTimeouts: Array<{ callback: () => void; delay: number }> = [];
        vi.spyOn(window, 'setTimeout').mockImplementation(((callback: TimerHandler, delay?: number) => {
            if (typeof callback === 'function') {
                scheduledTimeouts.push({ callback, delay: Number(delay ?? 0) });
            }

            return scheduledTimeouts.length as ReturnType<typeof window.setTimeout>;
        }) as typeof window.setTimeout);
        vi.spyOn(window, 'clearTimeout').mockImplementation(() => undefined);

        vi.mocked(useActivitySeries).mockReturnValue({
            data: {
                contractVersion: '1.0.0',
                machineId: 101,
                variableKey: 'Total kW',
                range: '7d',
                unit: 'kW',
                purpose: 'activity-analytics',
                window: { start: '2026-06-18T00:00:00.000Z', end: '2026-06-20T23:55:00.000Z', timezone: 'UTC', bucket: '5m', bucketMs: 300000 },
                series: DENSE_ACTIVITY_SERIES,
                summary: null,
            },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<ProdTrendWidget widget={makeWidget()} machines={MACHINES} />);

        expect(screen.getByTestId('prod-trend-widget-traveling-glow')).toHaveAttribute('data-cycle-key', '0');

        const orderedTimeouts = [...scheduledTimeouts].sort((left, right) => left.delay - right.delay);
        const hideTimeout = orderedTimeouts[0];
        const restartTimeout = orderedTimeouts[1];

        expect(hideTimeout).toBeDefined();
        expect(restartTimeout).toBeDefined();
        expect(hideTimeout?.delay).toBeGreaterThanOrEqual(900);
        expect(restartTimeout?.delay).toBeGreaterThan(hideTimeout?.delay ?? 0);

        act(() => {
            hideTimeout?.callback();
        });

        expect(screen.queryByTestId('prod-trend-widget-traveling-glow')).not.toBeInTheDocument();
        expect(screen.getByTestId('prod-trend-widget-final-point-pulse')).toBeInTheDocument();

        act(() => {
            restartTimeout?.callback();
        });

        expect(screen.getByTestId('prod-trend-widget-traveling-glow')).toHaveAttribute('data-cycle-key', '1');
        expect(screen.getByTestId('prod-trend-widget-final-point-pulse')).toBeInTheDocument();
    });

    it('keeps the latest PROD-TREND label above by default, but flips below when float clearance would collide with the top clamp', () => {
        expect(resolveProdTrendLatestValueLabelPlacement({ latestPointY: 20, chartTop: 8 })).toBe('below');
        expect(resolveProdTrendLatestValueLabelPlacement({ latestPointY: 80, chartTop: 8 })).toBe('above');
    });

    it('renders the default PROD-TREND gradient from the inverted resolved theme colors when no explicit widget colors are saved', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: {
                contractVersion: '1.0.0',
                machineId: 101,
                variableKey: 'Total kW',
                range: '7d',
                unit: 'kW',
                purpose: 'activity-analytics',
                window: { start: '2026-06-18T00:00:00.000Z', end: '2026-06-20T23:55:00.000Z', timezone: 'UTC', bucket: '5m', bucketMs: 300000 },
                series: DENSE_ACTIVITY_SERIES,
                summary: null,
            },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<ProdTrendWidget widget={makeWidget({ displayOptions: undefined })} machines={MACHINES} />);

        const chart = screen.getByTestId('prod-trend-widget-chart');
        const lineGradient = chart.querySelector('linearGradient[id$="-line-gradient"]');
        const lineStops = Array.from(lineGradient?.querySelectorAll('stop') ?? []).map((stop) => stop.getAttribute('stop-color'));

        expect(lineStops).toEqual([
            'var(--color-widget-gradient-from)',
            'var(--color-widget-gradient-to)',
        ]);
    });

    it('keeps explicit PROD-TREND line colors above the general widget gradient defaults', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: {
                contractVersion: '1.0.0',
                machineId: 101,
                variableKey: 'Total kW',
                range: '7d',
                unit: 'kW',
                purpose: 'activity-analytics',
                window: { start: '2026-06-18T12:00:00.000Z', end: '2026-06-20T12:00:00.000Z', timezone: 'UTC', bucket: '5m', bucketMs: 300000 },
                series: [
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 0.3 },
                    { timestamp: '2026-06-19T12:00:00.000Z', timestampMs: Date.parse('2026-06-19T12:00:00.000Z'), value: 0.05 },
                ],
                summary: null,
            },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<ProdTrendWidget widget={makeWidget({ displayOptions: { trendLineColors: ['#123456', '#654321'] } })} machines={MACHINES} />);

        const chart = screen.getByTestId('prod-trend-widget-chart');
        const lineGradient = chart.querySelector('linearGradient[id$="-line-gradient"]');
        const lineStops = Array.from(lineGradient?.querySelectorAll('stop') ?? []).map((stop) => stop.getAttribute('stop-color'));

        expect(lineStops).toEqual(['#654321', '#123456']);
    });

    it('uses PROD-TREND line style display options with clamped fallbacks', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: {
                contractVersion: '1.0.0',
                machineId: 101,
                variableKey: 'Total kW',
                range: '7d',
                unit: 'kW',
                purpose: 'activity-analytics',
                window: { start: '2026-06-18T12:00:00.000Z', end: '2026-06-20T12:00:00.000Z', timezone: 'UTC', bucket: '5m', bucketMs: 300000 },
                series: [
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 0.3 },
                    { timestamp: '2026-06-19T12:00:00.000Z', timestampMs: Date.parse('2026-06-19T12:00:00.000Z'), value: 0.05 },
                ],
                summary: null,
            },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        const { rerender, container } = render(<ProdTrendWidget widget={makeWidget()} machines={MACHINES} />);

        const getBlur = () => container.querySelector('filter feGaussianBlur');

        expect(clampLineStrokeWidth(undefined)).toBe(2.5);
        expect(clampLineStrokeWidth(4.1)).toBe(4.1);
        expect(clampLineStrokeWidth(Number.NaN)).toBe(2.5);
        expect(getBlur()).toHaveAttribute('stdDeviation', '3');

        rerender(<ProdTrendWidget widget={makeWidget({ displayOptions: { range: '7d', groupBy: 'day', setupThresholdKw: 0.15, prodThresholdKw: 0.25, lineStrokeWidth: 4.1, lineGlowBlur: 5.4 } })} machines={MACHINES} />);

        expect(clampLineStrokeWidth(4.1)).toBe(4.1);
        expect(getBlur()).toHaveAttribute('stdDeviation', '5.4');

        rerender(<ProdTrendWidget widget={makeWidget({ displayOptions: { range: '7d', groupBy: 'day', setupThresholdKw: 0.15, prodThresholdKw: 0.25, lineStrokeWidth: Number.NaN, lineGlowBlur: -2 } })} machines={MACHINES} />);

        expect(clampLineStrokeWidth(Number.NaN)).toBe(2.5);
        expect(clampLineGlowBlur(-2)).toBe(0);
        expect(getBlur()).toHaveAttribute('stdDeviation', '0');
    });

    it('keeps the PROD-TREND glow filter unclipped across flat selector states', async () => {
        const user = userEvent.setup();
        const configuredLineStrokeWidth = 4.3;
        const configuredLineGlowBlur = 5.4;
        const allDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        const initialNowMs = Date.parse('2026-06-19T12:00:00.000Z');
        let nowCallCount = 0;

        vi.stubGlobal('matchMedia', createMatchMediaMock(true));
        vi.spyOn(Date, 'now').mockImplementation(() => initialNowMs + (nowCallCount++ * 31 * 24 * 60 * 60 * 1000));
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: 'UTC' },
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '00:00', end: '08:00', weekdays: allDays },
                { id: 'shift-b', label: 'Turno B', start: '08:00', end: '16:00', weekdays: allDays },
                { id: 'shift-c', label: 'Turno C', start: '16:00', end: '00:00', weekdays: allDays },
            ],
        } as never);

        render(
            <ProdTrendWidget
                widget={makeWidget({
                    displayOptions: {
                        dataMode: 'simulated',
                        range: '7d',
                        groupBy: 'day',
                        setupThresholdKw: 0.15,
                        prodThresholdKw: 0.25,
                        lineStrokeWidth: configuredLineStrokeWidth,
                        lineGlowBlur: configuredLineGlowBlur,
                    },
                })}
                machines={MACHINES}
            />,
        );

        const captureLineContract = () => {
            const displayPoints = screen.getAllByTestId('prod-trend-widget-hit-area');
            const linePaths = screen.getAllByTestId('prod-trend-widget-line');
            const plotRect = linePaths[0]?.ownerSVGElement?.querySelector('clipPath rect');
            const plotX = Number(plotRect?.getAttribute('x'));
            const plotY = Number(plotRect?.getAttribute('y'));
            const plotWidth = Number(plotRect?.getAttribute('width'));
            const plotHeight = Number(plotRect?.getAttribute('height'));
            const expectedPadding = Math.ceil((3 * configuredLineGlowBlur) + (configuredLineStrokeWidth / 2) + 1);

            expect(displayPoints.length).toBeGreaterThan(0);
            expect(linePaths.length).toBeGreaterThan(0);
            expect(plotRect).not.toBeNull();
            return linePaths.map((path) => {
                const geometry = path.getAttribute('d') ?? '';
                const filterReference = path.getAttribute('filter') ?? '';
                const filterId = /^url\(#(.+)\)$/.exec(filterReference)?.[1] ?? '';
                const filter = Array.from(path.ownerSVGElement?.querySelectorAll('filter') ?? [])
                    .find((candidate) => candidate.id === filterId);
                const filterX = Number(filter?.getAttribute('x'));
                const filterY = Number(filter?.getAttribute('y'));
                const filterWidth = Number(filter?.getAttribute('width'));
                const filterHeight = Number(filter?.getAttribute('height'));

                expect(geometry.length).toBeGreaterThan(0);
                expect(path).toHaveAttribute('stroke-width', String(configuredLineStrokeWidth));
                expect(path).toHaveAttribute('stroke-linecap', 'round');
                expect(path).toHaveAttribute('vector-effect', 'non-scaling-stroke');
                expect(filterReference).toMatch(/^url\(#.+\)$/);
                expect(filter).toHaveAttribute('filterUnits', 'userSpaceOnUse');
                expect(filter?.querySelector('feGaussianBlur')).toHaveAttribute('stdDeviation', String(configuredLineGlowBlur));
                expect(filterX).toBeCloseTo(plotX - expectedPadding);
                expect(filterY).toBeCloseTo(plotY - expectedPadding);
                expect(filterWidth).toBeCloseTo(plotWidth + (2 * expectedPadding));
                expect(filterHeight).toBeCloseTo(plotHeight + (2 * expectedPadding));
                expect(filterWidth).toBeGreaterThan(0);
                expect(filterHeight).toBeGreaterThan(0);
                expect(filterX).toBeLessThan(plotX);
                expect(filterY).toBeLessThan(plotY);
                expect(filterX + filterWidth).toBeGreaterThan(plotX + plotWidth);
                expect(filterY + filterHeight).toBeGreaterThan(plotY + plotHeight);

                return {
                    geometry,
                    strokeWidth: path.getAttribute('stroke-width'),
                    strokeLinecap: path.getAttribute('stroke-linecap'),
                    vectorEffect: path.getAttribute('vector-effect'),
                    filterBlur: filter?.querySelector('feGaussianBlur')?.getAttribute('stdDeviation') ?? null,
                    filterUnits: filter?.getAttribute('filterUnits'),
                    filterRegion: { x: filterX, y: filterY, width: filterWidth, height: filterHeight },
                };
            });
        };

        expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'DÍA' })).toHaveAttribute('aria-pressed', 'true');
        captureLineContract();

        await user.click(screen.getByRole('button', { name: '30d' }));
        await user.click(screen.getByRole('button', { name: 'TURNO' }));
        expect(screen.getByRole('button', { name: '30d' })).toHaveAttribute('aria-pressed', 'true');
        const first30dShift = captureLineContract();

        await user.click(screen.getByRole('button', { name: '12m' }));
        expect(screen.getByRole('button', { name: 'TURNO' })).toHaveAttribute('aria-pressed', 'true');
        const first12mShift = captureLineContract();

        await user.click(screen.getByRole('button', { name: '7d' }));
        expect(screen.getByRole('button', { name: 'TURNO' })).toHaveAttribute('aria-pressed', 'true');
        captureLineContract();

        await user.click(screen.getByRole('button', { name: 'DÍA' }));
        await user.click(screen.getByRole('button', { name: '12m' }));
        expect(screen.getByRole('button', { name: 'TURNO' })).toHaveAttribute('aria-pressed', 'true');
        expect(captureLineContract()).toEqual(first12mShift);

        await user.click(screen.getByRole('button', { name: '30d' }));
        expect(screen.getByRole('button', { name: 'TURNO' })).toHaveAttribute('aria-pressed', 'true');
        expect(captureLineContract()).toEqual(first30dShift);
    });

    it('keeps the final sampled X-axis label visible and centered on the safe plot boundary', () => {
        vi.mocked(useActivitySeries).mockReturnValue({
            data: {
                contractVersion: '1.0.0',
                machineId: 101,
                variableKey: 'Total kW',
                range: '30d',
                unit: 'kW',
                purpose: 'activity-analytics',
                window: { start: '2026-06-18T12:00:00.000Z', end: '2026-06-30T12:00:00.000Z', timezone: 'UTC', bucket: '5m', bucketMs: 300000 },
                series: Array.from({ length: 13 }, (_, index) => {
                    const day = 18 + index;
                    const timestamp = `2026-06-${String(day).padStart(2, '0')}T12:00:00.000Z`;

                    return {
                        timestamp,
                        timestampMs: Date.parse(timestamp),
                        value: index % 2 === 0 ? 0.35 : 0.18,
                    };
                }),
                summary: null,
            },
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<ProdTrendWidget widget={makeWidget({ displayOptions: { range: '30d', groupBy: 'day', setupThresholdKw: 0.15, prodThresholdKw: 0.25 } })} machines={MACHINES} />);

        const xAxisLabels = screen.getAllByTestId('prod-trend-widget-x-axis-label');
        const lastXAxisLabel = xAxisLabels.at(-1);
        const expectedLayout = resolveExpectedProdTrendLayout(
            xAxisLabels[0]?.textContent ?? '',
            lastXAxisLabel?.textContent ?? '',
        );
        const finalPointPulse = screen.getByTestId('prod-trend-widget-final-point-pulse');

        expect(xAxisLabels.length).toBeLessThan(13);
        expect(lastXAxisLabel).toHaveTextContent('30/06');
        xAxisLabels.forEach((label) => {
            expect(label).toHaveAttribute('text-anchor', 'middle');
            expect(label).not.toHaveAttribute('text-anchor', 'start');
            expect(label).not.toHaveAttribute('text-anchor', 'end');
        });
        expect(lastXAxisLabel).toHaveAttribute('x', String(expectedLayout.xAxisLabels.right));
        expect(finalPointPulse).toHaveAttribute('cx', String(expectedLayout.plotArea.right));
        expect(lastXAxisLabel).toHaveAttribute('x', finalPointPulse.getAttribute('cx') ?? '');
    });

    it('shows the missing-machine fallback when no machine is configured', () => {
        vi.mocked(useActivitySeries).mockReturnValue({ data: null, isLoading: false, isError: false, error: null, isEnabled: false });

        render(<ProdTrendWidget widget={makeWidget({ binding: { mode: 'real_variable', bindingVersion: 'node-red-v1' } })} machines={MACHINES} />);

        expect(screen.getByText('Seleccione una máquina')).toBeInTheDocument();
        expect(screen.getByTestId('prod-trend-widget-runtime-state')).not.toHaveTextContent('Este widget necesita una máquina vinculada para consultar Activity-Series.');
        expect(screen.getByTestId('prod-trend-widget-runtime-state').querySelector('svg')).toBeNull();
    });

    it('shows a no-connection fallback instead of invalid-machine when overview is unavailable', () => {
        vi.mocked(useActivitySeries).mockReturnValue({ data: null, isLoading: false, isError: false, error: null, isEnabled: false });

        render(
            <ProdTrendWidget
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
        expect(screen.getByTestId('prod-trend-widget-runtime-state')).toHaveClass('flex', 'items-center', 'justify-center');
        expect(screen.getByTestId('prod-trend-widget-runtime-state').querySelector('svg')).toBeNull();
        expect(screen.getByTestId('prod-trend-widget-root')).toHaveClass('glass-panel', 'group', 'relative', 'flex', 'h-full', 'w-full', 'flex-col', 'overflow-hidden', 'p-5');
    });

    it('keeps the loading state while overview is still loading and machine validation depends on overview machines', () => {
        vi.mocked(useActivitySeries).mockReturnValue({ data: null, isLoading: false, isError: false, error: null, isEnabled: false });

        render(
            <ProdTrendWidget
                widget={makeWidget()}
                machines={[]}
                isLoadingOverview
            />,
        );

        expect(screen.getByTestId('prod-trend-widget-runtime-state')).toHaveTextContent('Cargando_');
        expect(screen.queryByText('Sin conexión')).not.toBeInTheDocument();
        expect(screen.queryByText('Seleccione una máquina válida')).not.toBeInTheDocument();
        expect(screen.getByTestId('prod-trend-widget-runtime-state').querySelector('svg')).toBeNull();
    });

    it('keeps the invalid-machine fallback when the contract is available but the configured machine is missing', () => {
        vi.mocked(useActivitySeries).mockReturnValue({ data: null, isLoading: false, isError: false, error: null, isEnabled: false });

        render(
            <ProdTrendWidget
                widget={makeWidget({
                    binding: {
                        mode: 'real_variable',
                        bindingVersion: 'node-red-v1',
                        machineId: 999,
                    },
                })}
                machines={MACHINES}
                connection={{ globalStatus: 'online', lastSuccess: '2026-06-18T12:00:00.000Z', ageMs: 0 }}
            />,
        );

        expect(screen.getByText('Seleccione una máquina válida')).toBeInTheDocument();
        expect(screen.queryByText('Sin conexión')).not.toBeInTheDocument();
        expect(screen.getByTestId('prod-trend-widget-runtime-state')).not.toHaveTextContent('La máquina configurada ya no coincide con el contrato disponible para Activity-Series.');
        expect(screen.getByTestId('prod-trend-widget-runtime-state').querySelector('svg')).toBeNull();
    });
});
