import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrendChartV2WidgetConfig } from '../../domain/admin.types';
import type { DataHistoryResponseV2 } from '../../domain/dataContract.types';
import { isDataHistoryEnabled } from '../../config/dataConnection.config';
import { useTemporalSettings } from '../../hooks/useTemporalSettings';
import { useDataHistory } from '../../queries/useDataHistory';
import { isDataHistoryResponseV2 } from '../../utils/dataHistoryResponseV2';
import TrendChartV2Widget from './TrendChartV2Widget';

vi.mock('../../config/dataConnection.config', () => ({
    isDataHistoryEnabled: vi.fn(),
}));

vi.mock('../../queries/useDataHistory', () => ({
    useDataHistory: vi.fn(),
}));

vi.mock('../../hooks/useTemporalSettings', () => ({
    useTemporalSettings: vi.fn(),
}));

class MockResizeObserver implements ResizeObserver {
    private static instances: MockResizeObserver[] = [];

    private observedTarget: Element | null = null;

    public constructor(private readonly callback: ResizeObserverCallback) {
        MockResizeObserver.instances.push(this);
    }

    public observe(target: Element): void {
        this.observedTarget = target;
        this.emit(320, 180, target);
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

function makeWidget(): TrendChartV2WidgetConfig {
    return {
        id: 'trend-v2-1',
        type: 'trend-chart-v2',
        title: 'Trend Chart V2',
        position: { x: 0, y: 0 },
        size: { w: 11, h: 9 },
        binding: {
            mode: 'real_variable',
            bindingVersion: 'node-red-v1',
            machineId: 101,
            variableKey: 'temperature',
            unit: '°C',
        },
        displayOptions: { historicalDensity: 'high' },
    };
}

function makeHistoryResponse(overrides?: Partial<DataHistoryResponseV2>): DataHistoryResponseV2 {
    return {
        contractVersion: '1.1.0',
        machineId: 101,
        variableKey: 'temperature',
        range: '24h',
        unit: '°C',
        window: {
            start: '2026-06-18T12:00:00.000Z',
            end: '2026-06-18T14:00:00.000Z',
            timezone: 'America/Argentina/Buenos_Aires',
            bucketMs: 60_000,
        },
        series: [
            { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 45 },
            { timestamp: '2026-06-18T12:30:00.000Z', timestampMs: Date.parse('2026-06-18T12:30:00.000Z'), value: 47 },
            { timestamp: '2026-06-18T13:30:00.000Z', timestampMs: Date.parse('2026-06-18T13:30:00.000Z'), value: 52 },
            { timestamp: '2026-06-18T13:31:00.000Z', timestampMs: Date.parse('2026-06-18T13:31:00.000Z'), value: 53 },
        ],
        summary: {
            last: 53,
            min: 45,
            max: 53,
            avg: 49.25,
        },
        ...overrides,
    };
}

function makeLegacyHistoryResponse() {
    return {
        contractVersion: '1.0.0',
        machineId: 101,
        variableKey: 'temperature',
        range: 'hora' as const,
        unit: '°C',
        series: [
            { timestamp: '2026-06-18T12:00:00.000Z', value: 45 },
            { timestamp: '2026-06-18T12:30:00.000Z', value: 47 },
            { timestamp: '2026-06-18T13:30:00.000Z', value: 52 },
        ],
        summary: {
            last: 52,
            min: 45,
            max: 52,
            avg: 48,
        },
    };
}

describe('TrendChartV2Widget', () => {
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.mocked(isDataHistoryEnabled).mockReturnValue(true);
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: 'UTC', shifts: [] },
            shifts: [],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useDataHistory).mockImplementation((params) => ({
            data: params?.range === 'custom'
                ? makeHistoryResponse({
                    range: 'custom',
                    window: undefined,
                })
                : makeHistoryResponse(),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
        MockResizeObserver.reset();
    });

    it('shows an explicit chart sizing state when valid data exists before a non-zero measurement is available', () => {
        class ZeroFirstResizeObserver extends MockResizeObserver {
            public observe(target: Element): void {
                this.emit(0, 0, target);
            }
        }

        vi.stubGlobal('ResizeObserver', ZeroFirstResizeObserver);

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getByText('Preparing chart...')).toBeInTheDocument();
        expect(screen.queryByText('Drag on the chart to zoom into a custom window.')).not.toBeInTheDocument();
        expect(screen.queryByTestId('trend-chart-v2-svg')).not.toBeInTheDocument();
    });

    it('matches the legacy loader copy and pulse styling while keeping the widget shell stable', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: undefined,
            isLoading: true,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const loader = screen.getByText('Cargando datos...');

        expect(loader).toBeInTheDocument();
        expect(loader).toHaveClass('animate-pulse', 'text-industrial-muted', 'uppercase');
        expect(screen.queryByText('Loading history...')).not.toBeInTheDocument();
    });

    it('keeps operator/dashboard rendering free from historical density controls', () => {
        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getByText('Trend Chart V2')).toBeInTheDocument();
        expect(screen.queryByText('Densidad histórica')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Alta' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Normal' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Baja' })).not.toBeInTheDocument();
        expect(useDataHistory).toHaveBeenLastCalledWith({
            machineId: 101,
            variableKey: 'temperature',
            range: '24h',
            maxPoints: 1500,
        });
    });

    it('uses backend window labels and splits line segments across nulls and large gaps', () => {
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: 'UTC', shifts: [] },
            shifts: [],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                window: {
                    start: '2026-06-18T12:00:00.000Z',
                    end: '2026-06-18T14:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 60_000,
                },
                series: [
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 41 },
                    { timestamp: '2026-06-18T12:01:00.000Z', timestampMs: Date.parse('2026-06-18T12:01:00.000Z'), value: 42 },
                    { timestamp: '2026-06-18T12:02:00.000Z', timestampMs: Date.parse('2026-06-18T12:02:00.000Z'), value: null },
                    { timestamp: '2026-06-18T13:00:00.000Z', timestampMs: Date.parse('2026-06-18T13:00:00.000Z'), value: 45 },
                    { timestamp: '2026-06-18T13:01:00.000Z', timestampMs: Date.parse('2026-06-18T13:01:00.000Z'), value: 46 },
                    { timestamp: '2026-06-18T13:10:00.000Z', timestampMs: Date.parse('2026-06-18T13:10:00.000Z'), value: 48 },
                    { timestamp: '2026-06-18T13:11:00.000Z', timestampMs: Date.parse('2026-06-18T13:11:00.000Z'), value: 49 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getByText('12:00')).toBeInTheDocument();
        expect(screen.getByText('14:00')).toBeInTheDocument();
        expect(screen.getAllByTestId('trend-chart-v2-segment')).toHaveLength(3);
    });

    it('keeps 1h and 7d preset lines renderable when backend bucket metadata is much smaller than the observed cadence', () => {
        vi.mocked(useDataHistory).mockImplementation((params) => ({
            data: params?.range === '7d'
                ? makeHistoryResponse({
                    range: '7d',
                    window: {
                        start: '2026-06-17T00:00:00.000Z',
                        end: '2026-06-20T00:00:00.000Z',
                        timezone: 'UTC',
                        bucketMs: 60_000,
                    },
                    series: [
                        { timestamp: '2026-06-17T00:00:00.000Z', timestampMs: Date.parse('2026-06-17T00:00:00.000Z'), value: 10 },
                        { timestamp: '2026-06-18T00:00:00.000Z', timestampMs: Date.parse('2026-06-18T00:00:00.000Z'), value: 11 },
                        { timestamp: '2026-06-19T00:00:00.000Z', timestampMs: Date.parse('2026-06-19T00:00:00.000Z'), value: 12 },
                        { timestamp: '2026-06-20T00:00:00.000Z', timestampMs: Date.parse('2026-06-20T00:00:00.000Z'), value: 13 },
                    ],
                })
                : makeHistoryResponse({
                    range: '1h',
                    window: {
                        start: '2026-06-18T12:00:00.000Z',
                        end: '2026-06-18T13:00:00.000Z',
                        timezone: 'UTC',
                        bucketMs: 60_000,
                    },
                    series: [
                        { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 10 },
                        { timestamp: '2026-06-18T12:15:00.000Z', timestampMs: Date.parse('2026-06-18T12:15:00.000Z'), value: 10 },
                        { timestamp: '2026-06-18T12:30:00.000Z', timestampMs: Date.parse('2026-06-18T12:30:00.000Z'), value: 10 },
                        { timestamp: '2026-06-18T12:45:00.000Z', timestampMs: Date.parse('2026-06-18T12:45:00.000Z'), value: 10 },
                    ],
                }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        }));

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        fireEvent.click(screen.getByRole('button', { name: '1h' }));
        expect(screen.getAllByTestId('trend-chart-v2-line-segment')).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: '7d' }));
        expect(screen.getAllByTestId('trend-chart-v2-line-segment')).toHaveLength(1);
    });

    it.each([
        {
            rangeLabel: '7d',
            response: makeHistoryResponse({
                range: '7d',
                window: {
                    start: '2026-06-14T00:00:00.000Z',
                    end: '2026-06-20T15:00:00.000Z',
                    timezone: 'UTC',
                },
                series: [
                    { timestamp: '2026-06-14T00:00:00.000Z', timestampMs: Date.parse('2026-06-14T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-15T00:00:00.000Z', timestampMs: Date.parse('2026-06-15T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-16T00:00:00.000Z', timestampMs: Date.parse('2026-06-16T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-17T00:00:00.000Z', timestampMs: Date.parse('2026-06-17T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-18T15:00:00.000Z', timestampMs: Date.parse('2026-06-18T15:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-19T15:00:00.000Z', timestampMs: Date.parse('2026-06-19T15:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-20T15:00:00.000Z', timestampMs: Date.parse('2026-06-20T15:00:00.000Z'), value: 10 },
                ],
            }),
        },
        {
            rangeLabel: '30d',
            response: makeHistoryResponse({
                range: '30d',
                window: {
                    start: '2026-06-09T00:00:00.000Z',
                    end: '2026-06-22T12:00:00.000Z',
                    timezone: 'UTC',
                },
                series: [
                    { timestamp: '2026-06-09T00:00:00.000Z', timestampMs: Date.parse('2026-06-09T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-11T00:00:00.000Z', timestampMs: Date.parse('2026-06-11T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-13T00:00:00.000Z', timestampMs: Date.parse('2026-06-13T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-15T00:00:00.000Z', timestampMs: Date.parse('2026-06-15T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-20T12:00:00.000Z', timestampMs: Date.parse('2026-06-20T12:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-22T12:00:00.000Z', timestampMs: Date.parse('2026-06-22T12:00:00.000Z'), value: 10 },
                ],
            }),
        },
    ])('renders a matching stroke for continuous coarse day-scale $rangeLabel history without introducing a false gap', ({ rangeLabel, response }) => {
        vi.mocked(useDataHistory).mockImplementation((params) => ({
            data: params?.range === rangeLabel ? response : makeHistoryResponse(),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        }));

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        fireEvent.click(screen.getByRole('button', { name: rangeLabel }));

        expect(screen.getAllByTestId('trend-chart-v2-segment')).toHaveLength(1);
        expect(screen.getAllByTestId('trend-chart-v2-line-segment')).toHaveLength(1);
        expect(screen.queryByTestId('trend-chart-v2-single-point')).not.toBeInTheDocument();
        expect(screen.getByTestId('trend-chart-v2-final-point-core')).toBeInTheDocument();
    });

    it.each([
        {
            rangeLabel: '7d',
            response: makeHistoryResponse({
                range: '7d',
                window: {
                    start: '2026-06-12T00:00:00.000Z',
                    end: '2026-06-19T12:00:00.000Z',
                    timezone: 'UTC',
                },
                series: [
                    { timestamp: '2026-06-12T00:00:00.000Z', timestampMs: Date.parse('2026-06-12T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-13T00:00:00.000Z', timestampMs: Date.parse('2026-06-13T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-14T00:00:00.000Z', timestampMs: Date.parse('2026-06-14T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-15T00:00:00.000Z', timestampMs: Date.parse('2026-06-15T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-17T12:00:00.000Z', timestampMs: Date.parse('2026-06-17T12:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-19T12:00:00.000Z', timestampMs: Date.parse('2026-06-19T12:00:00.000Z'), value: 10 },
                ],
            }),
        },
        {
            rangeLabel: '30d',
            response: makeHistoryResponse({
                range: '30d',
                window: {
                    start: '2026-06-01T00:00:00.000Z',
                    end: '2026-06-16T00:00:00.000Z',
                    timezone: 'UTC',
                },
                series: [
                    { timestamp: '2026-06-01T00:00:00.000Z', timestampMs: Date.parse('2026-06-01T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-03T00:00:00.000Z', timestampMs: Date.parse('2026-06-03T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-05T00:00:00.000Z', timestampMs: Date.parse('2026-06-05T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-07T00:00:00.000Z', timestampMs: Date.parse('2026-06-07T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-12T00:00:00.000Z', timestampMs: Date.parse('2026-06-12T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-14T00:00:00.000Z', timestampMs: Date.parse('2026-06-14T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-16T00:00:00.000Z', timestampMs: Date.parse('2026-06-16T00:00:00.000Z'), value: 10 },
                ],
            }),
        },
    ])('renders one continuous SVG path for live-like coarse $rangeLabel history that should not split', ({ rangeLabel, response }) => {
        vi.mocked(useDataHistory).mockImplementation((params) => ({
            data: params?.range === rangeLabel ? response : makeHistoryResponse(),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        }));

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        fireEvent.click(screen.getByRole('button', { name: rangeLabel }));

        expect(screen.getAllByTestId('trend-chart-v2-segment')).toHaveLength(1);
        expect(screen.getAllByTestId('trend-chart-v2-line-segment')).toHaveLength(1);
        expect(screen.queryByTestId('trend-chart-v2-single-point')).not.toBeInTheDocument();
        expect(screen.getByTestId('trend-chart-v2-final-point-core')).toBeInTheDocument();
    });

    it('uses the full 12m plot width when backend metadata adds padded empty time around a continuous finite series', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                range: '12m',
                unit: 'W',
                window: {
                    start: '2026-05-01T00:00:00.000Z',
                    end: '2026-07-15T00:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 30 * 24 * 60 * 60 * 1000,
                },
                series: [
                    { timestamp: '2026-06-01T00:00:00.000Z', timestampMs: Date.parse('2026-06-01T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-15T00:00:00.000Z', timestampMs: Date.parse('2026-06-15T00:00:00.000Z'), value: 11 },
                    { timestamp: '2026-06-30T00:00:00.000Z', timestampMs: Date.parse('2026-06-30T00:00:00.000Z'), value: 12 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        fireEvent.click(screen.getByRole('button', { name: '12m' }));

        const firstLineSegment = screen.getByTestId('trend-chart-v2-line-segment');

        expect(firstLineSegment.getAttribute('d')).toMatch(/^M 38 /);
        expect(firstLineSegment.getAttribute('d')).toMatch(/308 /);
    });

    it('starts the connected 12m line at plot-left when a leading edge singleton is suppressed', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                range: '12m',
                window: {
                    start: '2026-05-01T00:00:00.000Z',
                    end: '2026-07-15T00:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 30 * 24 * 60 * 60 * 1000,
                },
                series: [
                    { timestamp: '2026-06-01T00:00:00.000Z', timestampMs: Date.parse('2026-06-01T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-15T00:00:00.000Z', timestampMs: Date.parse('2026-06-15T00:00:00.000Z'), value: null },
                    { timestamp: '2026-06-30T00:00:00.000Z', timestampMs: Date.parse('2026-06-30T00:00:00.000Z'), value: 12 },
                    { timestamp: '2026-07-10T00:00:00.000Z', timestampMs: Date.parse('2026-07-10T00:00:00.000Z'), value: 13 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        fireEvent.click(screen.getByRole('button', { name: '12m' }));

        const lineSegment = screen.getByTestId('trend-chart-v2-line-segment');

        expect(screen.queryByTestId('trend-chart-v2-single-point')).not.toBeInTheDocument();
        expect(lineSegment.getAttribute('d')).toMatch(/^M 38 /);
        expect(screen.getByTestId('trend-chart-v2-final-point-core')).toBeInTheDocument();
    });

    it('keeps legitimate single-point rendering when the entire visible dataset has only one finite point', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                range: '12m',
                window: {
                    start: '2026-05-01T00:00:00.000Z',
                    end: '2026-07-15T00:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 30 * 24 * 60 * 60 * 1000,
                },
                series: [
                    { timestamp: '2026-06-01T00:00:00.000Z', timestampMs: Date.parse('2026-06-01T00:00:00.000Z'), value: null },
                    { timestamp: '2026-06-15T00:00:00.000Z', timestampMs: Date.parse('2026-06-15T00:00:00.000Z'), value: 12 },
                    { timestamp: '2026-06-30T00:00:00.000Z', timestampMs: Date.parse('2026-06-30T00:00:00.000Z'), value: null },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        fireEvent.click(screen.getByRole('button', { name: '12m' }));

        expect(screen.getByTestId('trend-chart-v2-single-point')).toBeInTheDocument();
        expect(screen.queryByTestId('trend-chart-v2-line-segment')).not.toBeInTheDocument();
        expect(screen.getByTestId('trend-chart-v2-final-point-core')).toBeInTheDocument();
    });

    it('renders the unit through the shared widget header subtitle', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                range: '12m',
                unit: 'W',
                window: undefined,
                series: [
                    { timestamp: '2026-06-15T00:00:00.000Z', timestampMs: Date.parse('2026-06-15T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-30T00:00:00.000Z', timestampMs: Date.parse('2026-06-30T00:00:00.000Z'), value: 12 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        fireEvent.click(screen.getByRole('button', { name: '12m' }));

        const allUnitLabels = screen.getAllByText(/^W$/);

        expect(screen.queryByTestId('trend-chart-v2-unit-label')).not.toBeInTheDocument();
        expect(allUnitLabels).toHaveLength(1);
        expect(allUnitLabels[0].closest('svg')).toBeNull();
    });

    it('keeps a wider unit label in the shared widget header subtitle', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                range: '12m',
                unit: 'KW',
                window: undefined,
                series: [
                    { timestamp: '2026-06-15T00:00:00.000Z', timestampMs: Date.parse('2026-06-15T00:00:00.000Z'), value: 10 },
                    { timestamp: '2026-06-30T00:00:00.000Z', timestampMs: Date.parse('2026-06-30T00:00:00.000Z'), value: 12 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        fireEvent.click(screen.getByRole('button', { name: '12m' }));

        const unitLabel = screen.getByText('KW');

        expect(screen.queryByTestId('trend-chart-v2-unit-label')).not.toBeInTheDocument();
        expect(unitLabel.closest('svg')).toBeNull();
    });

    it('keeps the top y-axis tick inside the svg while the unit remains in the header', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                range: '12m',
                unit: 'KW',
                window: undefined,
                series: [
                    { timestamp: '2026-06-15T00:00:00.000Z', timestampMs: Date.parse('2026-06-15T00:00:00.000Z'), value: -1 },
                    { timestamp: '2026-06-22T00:00:00.000Z', timestampMs: Date.parse('2026-06-22T00:00:00.000Z'), value: 0.6 },
                    { timestamp: '2026-06-30T00:00:00.000Z', timestampMs: Date.parse('2026-06-30T00:00:00.000Z'), value: 2.2 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        fireEvent.click(screen.getByRole('button', { name: '12m' }));

        const unitLabel = screen.getByText('KW');
        const topTickLabel = screen.getAllByTestId('trend-chart-v2-y-tick-label')[0];
        const topTickX = Number(topTickLabel.getAttribute('x'));

        expect(unitLabel).toHaveTextContent('KW');
        expect(topTickLabel).toHaveTextContent('3.2');
        expect(unitLabel.closest('svg')).toBeNull();
        expect(topTickLabel.closest('svg')).not.toBeNull();
        expect(topTickLabel.getAttribute('text-anchor')).toBe('end');
        expect(topTickX).toBe(30);
    });

    it('restores chart polish with y-axis ticks, scoped gradients, and a pulsing final-point marker', () => {
        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getAllByTestId('trend-chart-v2-y-tick-label')).toHaveLength(5);
        expect(screen.getAllByTestId('trend-chart-v2-y-grid-line')).toHaveLength(5);
        expect(screen.getByTestId('trend-chart-v2-final-point-pulse')).toBeInTheDocument();
        expect(screen.getByTestId('trend-chart-v2-final-point-core')).toBeInTheDocument();

        const svg = screen.getByTestId('trend-chart-v2-svg');
        expect(svg?.innerHTML).toContain('trend-v2-1-line-gradient');
        expect(svg?.innerHTML).toContain('trend-v2-1-area-gradient');
        expect(svg?.innerHTML).toContain('trend-v2-1-line-glow');
        expect(svg?.innerHTML).toContain('gradientUnits="userSpaceOnUse"');
    });

    it('uses the shared left-aligned widget header primitive and preserves trend-chart-v2 icon configurability', () => {
        const widget: TrendChartV2WidgetConfig = {
            ...makeWidget(),
            displayOptions: {
                historicalDensity: 'high',
                icon: 'LineChart',
            },
        };

        render(<TrendChartV2Widget widget={widget} equipmentMap={new Map()} machines={[]} />);

        const icon = screen.getByTestId('trend-chart-v2-header-icon');
        const iconRow = icon.parentElement;

        expect(icon).toHaveClass('lucide-chart-line');
        expect(iconRow?.innerHTML.indexOf('svg')).toBeLessThan(iconRow?.innerHTML.indexOf('Trend Chart V2') ?? Number.MAX_SAFE_INTEGER);
    });

    it('removes isolated one-point artifacts inside multi-segment series while keeping the final marker only', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                window: {
                    start: '2026-06-18T12:00:00.000Z',
                    end: '2026-06-18T14:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 60_000,
                },
                series: [
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 41 },
                    { timestamp: '2026-06-18T12:01:00.000Z', timestampMs: Date.parse('2026-06-18T12:01:00.000Z'), value: 42 },
                    { timestamp: '2026-06-18T12:30:00.000Z', timestampMs: Date.parse('2026-06-18T12:30:00.000Z'), value: 45 },
                    { timestamp: '2026-06-18T13:20:00.000Z', timestampMs: Date.parse('2026-06-18T13:20:00.000Z'), value: 47 },
                    { timestamp: '2026-06-18T13:21:00.000Z', timestampMs: Date.parse('2026-06-18T13:21:00.000Z'), value: 48 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        const { container } = render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getAllByTestId('trend-chart-v2-segment')).toHaveLength(2);
        expect(container.querySelectorAll('circle')).toHaveLength(2);
    });

    it('renders a single finite point from series extent padding instead of falling back to misleading empty state', () => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                range: 'custom',
                window: undefined,
                series: [
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 41 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.queryByText('Sin datos')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('trend-chart-v2-segment').length).toBeGreaterThan(0);
        expect(document.querySelector('circle')).toBeTruthy();
    });

    it('falls back to the resolved temporal timezone when backend window timezone is invalid', () => {
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: { plantTimezone: 'Invalid/Admin-Timezone', shifts: [] },
            shifts: [],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                window: {
                    start: '2026-06-18T12:00:00.000Z',
                    end: '2026-06-18T14:00:00.000Z',
                    timezone: 'Invalid/Backend-Timezone',
                    bucketMs: 60_000,
                },
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getByText('12:00')).toBeInTheDocument();
        expect(screen.getByText('14:00')).toBeInTheDocument();
        expect(screen.queryByText('Sin datos')).not.toBeInTheDocument();
    });

    it('converts drag selections into custom history queries and allows reset back to the preset', () => {
        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const overlay = screen.getByTestId('trend-chart-v2-interaction-overlay');
        Object.defineProperty(overlay, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
                x: 38,
                y: 0,
                width: 320,
                height: 180,
                top: 0,
                left: 38,
                right: 358,
                bottom: 180,
                toJSON: () => ({}),
            }),
        });

        fireEvent.mouseDown(overlay, { clientX: 92, clientY: 60 });
        fireEvent.mouseMove(overlay, { clientX: 227, clientY: 60 });
        fireEvent.mouseUp(overlay, { clientX: 227, clientY: 60 });

        expect(useDataHistory).toHaveBeenLastCalledWith({
            machineId: 101,
            variableKey: 'temperature',
            range: 'custom',
            start: '2026-06-18T12:24:00.000Z',
            end: '2026-06-18T13:24:00.000Z',
            maxPoints: 1500,
        });
        expect(screen.getByRole('button', { name: 'Back to preset' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Back to preset' }));

        expect(useDataHistory).toHaveBeenLastCalledWith({
            machineId: 101,
            variableKey: 'temperature',
            range: '24h',
            maxPoints: 1500,
        });
    });

    it('renders compatible legacy history responses and stays visible after preset changes', () => {
        vi.mocked(useDataHistory).mockImplementation((params) => ({
            data: makeLegacyHistoryResponse(),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: params !== null,
        }));

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.queryByText('Sin datos')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('trend-chart-v2-segment').length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: '7d' }));

        expect(useDataHistory).toHaveBeenLastCalledWith({
            machineId: 101,
            variableKey: 'temperature',
            range: '7d',
            maxPoints: 1500,
        });
        expect(screen.queryByText('Sin datos')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('trend-chart-v2-segment').length).toBeGreaterThan(0);
    });

    it('shows legacy-style backend min max avg summary for presets without the shift-summary cards', () => {
        const widget: TrendChartV2WidgetConfig = {
            ...makeWidget(),
            displayOptions: {
                historicalDensity: 'high',
                showShifts: true,
            },
        };

        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'UTC',
                shifts: [
                    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
                ],
            },
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
            ],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                series: [
                    { timestamp: '2026-06-18T12:00:00.000Z', timestampMs: Date.parse('2026-06-18T12:00:00.000Z'), value: 42 },
                    { timestamp: '2026-06-18T12:30:00.000Z', timestampMs: Date.parse('2026-06-18T12:30:00.000Z'), value: 50 },
                    { timestamp: '2026-06-18T13:00:00.000Z', timestampMs: Date.parse('2026-06-18T13:00:00.000Z'), value: 46 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={widget} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getByText('Min 45')).toBeInTheDocument();
        expect(screen.getByText('Max 53')).toBeInTheDocument();
        expect(screen.getByText('Avg 49')).toBeInTheDocument();
        expect(screen.queryByText(/^LAST /)).not.toBeInTheDocument();
        expect(screen.queryByText('Turno A')).not.toBeInTheDocument();
    });

    it('keeps rendering legacy-compatible preset payloads whose timestamps are far from the current client time', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeLegacyHistoryResponse(),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.queryByText('Sin datos')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('trend-chart-v2-segment').length).toBeGreaterThan(0);
    });

    it('uses the recovered plot space to render a taller chart area closer to legacy height', () => {
        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const overlay = screen.getByTestId('trend-chart-v2-interaction-overlay');

        expect(Number(overlay.getAttribute('height'))).toBeGreaterThanOrEqual(120);
        expect(Number(overlay.getAttribute('y'))).toBeLessThanOrEqual(10);
    });

    it('preserves the last valid chart dimensions when ResizeObserver emits a transient zero measurement', () => {
        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getAllByTestId('trend-chart-v2-segment').length).toBeGreaterThan(0);

        const observer = MockResizeObserver.latest();
        observer.emit(0, 0);

        const svg = screen.getByTestId('trend-chart-v2-svg');

        expect(svg).toHaveAttribute('width', '320');
        expect(svg).toHaveAttribute('height', '180');
        expect(screen.getAllByTestId('trend-chart-v2-segment').length).toBeGreaterThan(0);
        expect(screen.queryByText('Preparing chart...')).not.toBeInTheDocument();
    });

    it('defaults to continuous-chart parity by hiding shift overlays and summary cards', () => {
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'UTC',
                shifts: [
                    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
                ],
            },
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
            ],
            resolvedTimezone: 'UTC',
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        expect(screen.queryByTestId('trend-chart-v2-shift-band')).not.toBeInTheDocument();
        expect(screen.queryByTestId('trend-chart-v2-shift-line')).not.toBeInTheDocument();
        expect(screen.queryByText('Turno A')).not.toBeInTheDocument();
        expect(screen.queryByText('Turno B')).not.toBeInTheDocument();
    });

    it('renders overnight shift overlays and tooltip labels when enabled', () => {
        const widget: TrendChartV2WidgetConfig = {
            ...makeWidget(),
            displayOptions: {
                historicalDensity: 'high',
                showShifts: true,
            },
        };

        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'UTC',
                shifts: [
                    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
                    { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00' },
                ],
            },
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
                { id: 'shift-c', label: 'Turno C', start: '22:00', end: '06:00' },
            ],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                window: {
                    start: '2026-06-18T21:00:00.000Z',
                    end: '2026-06-19T03:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 60 * 60 * 1000,
                },
                series: [
                    { timestamp: '2026-06-18T21:30:00.000Z', timestampMs: Date.parse('2026-06-18T21:30:00.000Z'), value: 20 },
                    { timestamp: '2026-06-18T22:30:00.000Z', timestampMs: Date.parse('2026-06-18T22:30:00.000Z'), value: 30 },
                    { timestamp: '2026-06-19T01:00:00.000Z', timestampMs: Date.parse('2026-06-19T01:00:00.000Z'), value: 26 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={widget} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getAllByTestId('trend-chart-v2-shift-band')).not.toHaveLength(0);

        const overlay = screen.getByTestId('trend-chart-v2-interaction-overlay');
        Object.defineProperty(overlay, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
                x: 38,
                y: 0,
                width: 320,
                height: 180,
                top: 0,
                left: 38,
                right: 358,
                bottom: 180,
                toJSON: () => ({}),
            }),
        });

        fireEvent.mouseMove(overlay, { clientX: 252, clientY: 60 });

        expect(screen.getByText('Shift: Turno C')).toBeInTheDocument();
    });

    it('suppresses shift labels and summary when shift visibility remains disabled', () => {
        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'UTC',
                shifts: [
                    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                ],
            },
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
            ],
            resolvedTimezone: 'UTC',
        });

        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const overlay = screen.getByTestId('trend-chart-v2-interaction-overlay');
        Object.defineProperty(overlay, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
                x: 38,
                y: 0,
                width: 320,
                height: 180,
                top: 0,
                left: 38,
                right: 358,
                bottom: 180,
                toJSON: () => ({}),
            }),
        });

        fireEvent.mouseMove(overlay, { clientX: 120, clientY: 60 });

        expect(screen.queryByText(/Shift:/)).not.toBeInTheDocument();
        expect(screen.queryByText('Turno A')).not.toBeInTheDocument();
    });

    it('can show shift guides without rendering the summary cards', () => {
        const widget: TrendChartV2WidgetConfig = {
            ...makeWidget(),
            displayOptions: {
                historicalDensity: 'high',
                showShifts: true,
                shiftDisplayMode: 'lines',
            },
        };

        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'UTC',
                shifts: [
                    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
                ],
            },
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
            ],
            resolvedTimezone: 'UTC',
        });

        render(<TrendChartV2Widget widget={widget} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getAllByTestId('trend-chart-v2-shift-line')).not.toHaveLength(0);
        expect(screen.queryByText(/^LAST /)).not.toBeInTheDocument();
        expect(screen.getByText('Min 45')).toBeInTheDocument();
    });

    it('renders configured shift lines instead of bands when the widget requests line mode', () => {
        const widget: TrendChartV2WidgetConfig = {
            ...makeWidget(),
            displayOptions: {
                historicalDensity: 'high',
                showShifts: true,
                shiftDisplayMode: 'lines',
            },
        };

        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'UTC',
                shifts: [
                    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
                ],
            },
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
            ],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                window: {
                    start: '2026-06-18T12:00:00.000Z',
                    end: '2026-06-18T18:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 60 * 60 * 1000,
                },
                series: [
                    { timestamp: '2026-06-18T12:30:00.000Z', timestampMs: Date.parse('2026-06-18T12:30:00.000Z'), value: 45 },
                    { timestamp: '2026-06-18T15:30:00.000Z', timestampMs: Date.parse('2026-06-18T15:30:00.000Z'), value: 47 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={widget} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getAllByTestId('trend-chart-v2-shift-line')).not.toHaveLength(0);
        expect(screen.queryByTestId('trend-chart-v2-shift-band')).not.toBeInTheDocument();
    });

    it('renders configured shift bands when the widget requests band mode', () => {
        const widget: TrendChartV2WidgetConfig = {
            ...makeWidget(),
            displayOptions: {
                historicalDensity: 'high',
                showShifts: true,
                shiftDisplayMode: 'bands',
            },
        };

        vi.mocked(useTemporalSettings).mockReturnValue({
            config: {
                plantTimezone: 'UTC',
                shifts: [
                    { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                    { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
                ],
            },
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                { id: 'shift-b', label: 'Turno B', start: '14:00', end: '22:00' },
            ],
            resolvedTimezone: 'UTC',
        });
        vi.mocked(useDataHistory).mockReturnValue({
            data: makeHistoryResponse({
                window: {
                    start: '2026-06-18T12:00:00.000Z',
                    end: '2026-06-18T18:00:00.000Z',
                    timezone: 'UTC',
                    bucketMs: 60 * 60 * 1000,
                },
                series: [
                    { timestamp: '2026-06-18T12:30:00.000Z', timestampMs: Date.parse('2026-06-18T12:30:00.000Z'), value: 45 },
                    { timestamp: '2026-06-18T15:30:00.000Z', timestampMs: Date.parse('2026-06-18T15:30:00.000Z'), value: 47 },
                ],
            }),
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });

        render(<TrendChartV2Widget widget={widget} equipmentMap={new Map()} machines={[]} />);

        expect(screen.getAllByTestId('trend-chart-v2-shift-band')).not.toHaveLength(0);
        expect(screen.queryByTestId('trend-chart-v2-shift-line')).not.toBeInTheDocument();
    });

    it('ignores invalid or too-small drag selections', () => {
        render(<TrendChartV2Widget widget={makeWidget()} equipmentMap={new Map()} machines={[]} />);

        const overlay = screen.getByTestId('trend-chart-v2-interaction-overlay');
        Object.defineProperty(overlay, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
                x: 38,
                y: 0,
                width: 320,
                height: 180,
                top: 0,
                left: 38,
                right: 358,
                bottom: 180,
                toJSON: () => ({}),
            }),
        });

        fireEvent.mouseDown(overlay, { clientX: 100, clientY: 60 });
        fireEvent.mouseMove(overlay, { clientX: 105, clientY: 60 });
        fireEvent.mouseUp(overlay, { clientX: 105, clientY: 60 });

        expect(useDataHistory).toHaveBeenLastCalledWith({
            machineId: 101,
            variableKey: 'temperature',
            range: '24h',
            maxPoints: 1500,
        });
        expect(screen.getByText('Selection too small to zoom. Drag a wider time window.')).toBeInTheDocument();
        expect(screen.queryByText('Drag on the chart to zoom into a custom window.')).not.toBeInTheDocument();
    });

    it('renders deterministic simulated history for simulated bindings without querying real history', () => {
        const simulatedWidget: TrendChartV2WidgetConfig = {
            ...makeWidget(),
            id: 'trend-v2-simulated',
            binding: {
                mode: 'simulated_value',
                simulatedValue: 50,
                unit: '°C',
            },
        };

        render(<TrendChartV2Widget widget={simulatedWidget} equipmentMap={new Map()} machines={[]} />);

        expect(useDataHistory).toHaveBeenLastCalledWith(null);
        expect(screen.queryByText('Sin datos')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('trend-chart-v2-segment')).not.toHaveLength(0);
        expect(screen.getByText('24h')).toBeInTheDocument();
    });

    it('keeps simulated visible output stable across fresh renders even if Date.now changes', () => {
        const simulatedWidget: TrendChartV2WidgetConfig = {
            ...makeWidget(),
            id: 'trend-v2-simulated-stable',
            binding: {
                mode: 'simulated_value',
                simulatedValue: 50,
                unit: '°C',
            },
        };

        const firstNowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-18T12:00:00.000Z'));
        const firstRender = render(<TrendChartV2Widget widget={simulatedWidget} equipmentMap={new Map()} machines={[]} />);
        const firstPath = firstRender.container.querySelector('[data-testid="trend-chart-v2-line-segment"]')?.getAttribute('d');
        const firstTicks = Array.from(firstRender.container.querySelectorAll('text')).map((node) => node.textContent);
        firstRender.unmount();
        firstNowSpy.mockRestore();

        const secondNowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-01T12:00:00.000Z'));
        const secondRender = render(<TrendChartV2Widget widget={simulatedWidget} equipmentMap={new Map()} machines={[]} />);
        const secondPath = secondRender.container.querySelector('[data-testid="trend-chart-v2-line-segment"]')?.getAttribute('d');
        const secondTicks = Array.from(secondRender.container.querySelectorAll('text')).map((node) => node.textContent);
        secondNowSpy.mockRestore();

        expect(firstPath).toBeTruthy();
        expect(firstPath).toBe(secondPath);
        expect(firstTicks).toEqual(secondTicks);
    });

    it('rejects legacy history responses in the V2 type guard while accepting V2 points with finite timestampMs', () => {
        expect(isDataHistoryResponseV2({
            contractVersion: '1.0.0',
            machineId: 101,
            variableKey: 'temperature',
            range: 'hora',
            unit: '°C',
            series: [{ timestamp: '2026-06-18T12:00:00.000Z', value: 42 }],
            summary: { last: 42, min: 42, max: 42, avg: 42 },
        })).toBe(false);

        expect(isDataHistoryResponseV2({
            contractVersion: '1.1.0',
            machineId: 101,
            variableKey: 'temperature',
            range: '24h',
            unit: '°C',
            window: {
                start: '2026-06-18T12:00:00.000Z',
                end: '2026-06-18T14:00:00.000Z',
            },
            series: [{ timestamp: '2026-06-18T12:00:00.000Z', timestampMs: 1, value: 42 }],
            summary: { last: 42, min: 42, max: 42, avg: 42 },
        })).toBe(true);
    });
});
