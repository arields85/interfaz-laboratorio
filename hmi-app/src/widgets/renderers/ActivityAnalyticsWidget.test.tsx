import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivitySeriesAdapterError } from '../../adapters/activitySeries.adapter';
import type { ActivityAnalyticsWidgetConfig } from '../../domain/admin.types';
import type { ContractMachine } from '../../domain/dataContract.types';
import { isDataActivitySeriesEnabled } from '../../config/dataConnection.config';
import { useTemporalSettings } from '../../hooks/useTemporalSettings';
import { useActivitySeries } from '../../queries/useActivitySeries';
import { DataServiceError } from '../../services/dataOverview.service';
import * as activityAnalyticsComputation from '../../utils/activityAnalyticsComputation';
import ActivityAnalyticsWidget from './ActivityAnalyticsWidget';

vi.mock('../../config/dataConnection.config', () => ({
    isDataActivitySeriesEnabled: vi.fn(),
}));

vi.mock('../../hooks/useTemporalSettings', () => ({
    useTemporalSettings: vi.fn(),
}));

vi.mock('../../queries/useActivitySeries', () => ({
    useActivitySeries: vi.fn(),
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

describe('ActivityAnalyticsWidget', () => {
    beforeEach(() => {
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

    it('applies builder typography tokens to warning panels and widget metric content', () => {
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

        expect(screen.getByText('% Prod.')).toHaveStyle({
            fontFamily: 'var(--font-mono)',
            fontWeight: 'var(--font-weight-mono)',
            fontSize: 'var(--font-size-mono)',
            letterSpacing: 'var(--tracking-mono)',
        });

        const prodCard = screen.getByText('% Prod.').parentElement;
        const prodValue = within(prodCard as HTMLElement).getByTestId('activity-analytics-metric-value');

        expect(prodValue).toHaveStyle({
            fontFamily: 'var(--font-widget-value)',
            fontWeight: 'var(--font-weight-widget-value)',
            fontSize: 'var(--font-size-widget-value)',
            letterSpacing: 'var(--tracking-widget-value)',
        });
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
        expect(screen.getByText('% Prod.').parentElement).toHaveClass('border-industrial-border');
        expect(screen.getByText('2026-06-18').closest('.rounded-xl')).toHaveClass('border-industrial-border');
        expect(screen.getByTestId('activity-analytics-stacked-bar')).toHaveClass('bg-industrial-hover');
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
