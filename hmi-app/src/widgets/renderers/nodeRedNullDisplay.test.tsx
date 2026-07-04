import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    ConnectionStatusWidgetConfig,
    KpiWidgetConfig,
    MetricCardWidgetConfig,
    TrendChartWidgetConfig,
} from '../../domain/admin.types';
import type { ConnectionHealth } from '../../domain/dataContract.types';
import type { ContractMachine } from '../../domain/dataContract.types';
import ConnectionStatusWidget from './ConnectionStatusWidget';
import KpiWidget from './KpiWidget';
import MetricWidget from './MetricWidget';
import TrendChartWidget from './TrendChartWidget';
import HeaderWidgetRenderer from '../../components/viewer/HeaderWidgetRenderer';
import { useDataHistory } from '../../queries/useDataHistory';

vi.mock('../../queries/useDataHistory', () => ({
    useDataHistory: vi.fn(),
}));

const equipmentMap = new Map();

function makeMachines(value: number | null): ContractMachine[] {
    return [
        {
            unitId: 101,
            name: 'Extrusora 101',
            status: 'online',
            lastSuccess: '2026-04-21T13:00:00.000Z',
            ageMs: 0,
            values: {
                temperature: {
                    value,
                    unit: '°C',
                    timestamp: '2026-04-21T13:00:00.000Z',
                },
            },
        },
    ];
}

function makeKpiWidget(): KpiWidgetConfig {
    return {
        id: 'kpi-1',
        type: 'kpi',
        title: 'Temperatura',
        position: { x: 0, y: 0 },
        size: { w: 4, h: 3 },
        binding: {
            mode: 'real_variable',
            bindingVersion: 'node-red-v1',
            machineId: 101,
            variableKey: 'temperature',
        },
    };
}

function makeMetricWidget(): MetricCardWidgetConfig {
    return {
        id: 'metric-1',
        type: 'metric-card',
        title: 'Temperatura',
        position: { x: 0, y: 0 },
        size: { w: 4, h: 3 },
        binding: {
            mode: 'real_variable',
            bindingVersion: 'node-red-v1',
            machineId: 101,
            variableKey: 'temperature',
        },
    };
}

function makeTrendWidget(): TrendChartWidgetConfig {
    return {
        id: 'trend-1',
        type: 'trend-chart',
        title: 'Temperatura',
        position: { x: 0, y: 0 },
        size: { w: 6, h: 4 },
        binding: {
            mode: 'real_variable',
            bindingVersion: 'node-red-v1',
            machineId: 101,
            variableKey: 'temperature',
        },
    };
}

function makeConnectionWidget(overrides?: Partial<ConnectionStatusWidgetConfig>): ConnectionStatusWidgetConfig {
    return {
        id: 'connection-1',
        type: 'connection-status',
        title: 'Estado Conexión',
        position: { x: 0, y: 0 },
        size: { w: 4, h: 3 },
        binding: {
            mode: 'real_variable',
        },
        displayOptions: {
            scope: 'global',
            showLastUpdate: true,
        },
        ...overrides,
    };
}

function makeConnection(overrides?: Partial<ConnectionHealth>): ConnectionHealth {
    return {
        globalStatus: 'online',
        lastSuccess: '2026-04-21T13:00:00.000Z',
        ageMs: 5000,
        ...overrides,
    };
}

describe('Node-RED null renderer fallbacks', () => {
    beforeEach(() => {
        vi.mocked(useDataHistory).mockReturnValue({
            data: null,
            isLoading: false,
            isError: false,
            error: null,
            isEnabled: true,
        });
    });

    it('renders -- in KpiWidget when the resolved contract value is null', () => {
        render(
            <KpiWidget
                widget={makeKpiWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(null)}
            />,
        );

        expect(screen.getByText('--')).toBeInTheDocument();
        expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
    });

    it('renders -- in MetricWidget when the resolved contract value is null', () => {
        render(
            <MetricWidget
                widget={makeMetricWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(null)}
            />,
        );

        expect(screen.getByText('--')).toBeInTheDocument();
        expect(screen.queryByText('—')).not.toBeInTheDocument();
    });

    it('renders Sin datos in TrendChartWidget when the resolved contract value is null', () => {
        render(
            <TrendChartWidget
                widget={makeTrendWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(null)}
            />,
        );

        expect(screen.getByText('Sin datos')).toBeInTheDocument();
        expect(screen.queryByText('50')).not.toBeInTheDocument();
    });

    it('keeps simulated KPI values rendering as numbers', () => {
        render(
            <KpiWidget
                widget={{
                    ...makeKpiWidget(),
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 77,
                        unit: '%',
                    },
                }}
                equipmentMap={equipmentMap}
            />,
        );

        expect(screen.getByText('77')).toBeInTheDocument();
        expect(screen.queryByText('--')).not.toBeInTheDocument();
    });

    it('reads global connection status directly from the contract and shows relative freshness from ageMs', () => {
        render(
            <ConnectionStatusWidget
                widget={makeConnectionWidget()}
                equipmentMap={equipmentMap}
                connection={makeConnection({ globalStatus: 'degradado', ageMs: 5000 })}
            />,
        );

        expect(screen.getByText('Degradado')).toBeInTheDocument();
        expect(screen.getByText('5s')).toBeInTheDocument();
    });

    it('reads machine connection status directly from the contract and falls back to HH:mm:ss when ageMs is missing', () => {
        const lastSuccess = '2026-04-21T13:00:00.000Z';
        const expectedTime = new Intl.DateTimeFormat(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }).format(new Date(lastSuccess));

        render(
            <ConnectionStatusWidget
                widget={makeConnectionWidget({
                    binding: { mode: 'real_variable' },
                    displayOptions: {
                        scope: 'machine',
                        machineId: 101,
                        showLastUpdate: true,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(42).map((machine) => ({
                    ...machine,
                    status: 'offline',
                    ageMs: null,
                    lastSuccess,
                }))}
            />,
        );

        expect(screen.getByText('Sin señal')).toBeInTheDocument();
        expect(screen.getByText(expectedTime)).toBeInTheDocument();
    });

    it('hides time text when showLastUpdate is false', () => {
        render(
            <ConnectionStatusWidget
                widget={makeConnectionWidget({
                    displayOptions: {
                        scope: 'global',
                        showLastUpdate: false,
                    },
                })}
                equipmentMap={equipmentMap}
                connection={makeConnection({ ageMs: 1000 })}
            />,
        );

        expect(screen.queryByText(/Actualizado/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Última actualización:/i)).not.toBeInTheDocument();
    });

    it('falls back to unknown without time when contract data is missing or simulated mode is used', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-21T14:00:00.000Z'));

        render(
            <>
                <ConnectionStatusWidget
                    widget={makeConnectionWidget({
                        displayOptions: {
                            scope: 'machine',
                            machineId: 999,
                            showLastUpdate: true,
                        },
                    })}
                    equipmentMap={equipmentMap}
                    machines={makeMachines(42)}
                />
                <ConnectionStatusWidget
                    widget={makeConnectionWidget({
                        binding: {
                            mode: 'simulated_value',
                            simulatedValue: 'online',
                        },
                        displayOptions: {
                            scope: 'global',
                            showLastUpdate: true,
                        },
                    })}
                    equipmentMap={equipmentMap}
                    connection={makeConnection({ ageMs: 1000 })}
                />
            </>,
        );

        expect(screen.getByText('Sin datos')).toBeInTheDocument();
        expect(screen.getByText('Online')).toBeInTheDocument();
        expect(screen.queryByText(/Actualizado/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Última actualización:/i)).not.toBeInTheDocument();

        vi.useRealTimers();
    });

    it('renders header global connection widgets from contract connection health with muted status text, centered content and exact icons', () => {
        const { container } = render(
            <HeaderWidgetRenderer
                widget={makeConnectionWidget()}
                equipmentMap={equipmentMap}
                connection={makeConnection({ globalStatus: 'degradado', ageMs: 0 })}
                align="start"
            />,
        );

        const title = screen.getByText('Estado Conexión');
        const label = screen.getByText('Degradado');
        const freshness = screen.getByText('0s');

        expect(title).toHaveClass('text-center');
        expect(title.parentElement).toHaveClass('w-full');
        expect(label).toHaveClass('uppercase', 'text-industrial-muted');
        expect(freshness.parentElement).toHaveClass('mt-0.5', 'flex', 'items-center', 'justify-center', 'gap-1.5');
        expect(container.firstChild).toHaveClass('flex', 'h-full', 'w-full', 'flex-col');
        expect(label.parentElement).toHaveClass('flex', 'flex-1', 'flex-col', 'items-center', 'justify-center');
        expect(screen.getByText('0s')).toBeInTheDocument();
        expect(screen.queryByText('Sin datos')).not.toBeInTheDocument();
        expect(screen.getByTestId('connection-header-icon-degradado')).toHaveClass('lucide-wifi-high');
    });

    it('renders header machine connection widgets from contract machine status', () => {
        render(
            <HeaderWidgetRenderer
                widget={makeConnectionWidget({
                    displayOptions: {
                        scope: 'machine',
                        machineId: 101,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(42).map((machine) => ({
                    ...machine,
                    status: 'offline',
                }))}
                align="start"
            />,
        );

        expect(screen.getByText('Sin señal')).toBeInTheDocument();
        expect(screen.getByText('Sin señal')).toHaveClass('text-industrial-muted');
        expect(screen.queryByText('Sin datos')).not.toBeInTheDocument();
        expect(screen.getByTestId('connection-header-icon-offline')).toHaveClass('lucide-wifi-off');
    });

    it('renders the redesigned centered layout with muted status typography, exact icons and centered content group', () => {
        const { container, rerender } = render(
            <ConnectionStatusWidget
                widget={makeConnectionWidget({ title: '' })}
                equipmentMap={equipmentMap}
                connection={makeConnection({ globalStatus: 'online', ageMs: 0 })}
            />,
        );

        const onlineLabel = screen.getByText('Online');
        const freshness = screen.getByText('0s');

        expect(container.firstChild).toHaveClass('glass-panel', 'flex', 'h-full', 'w-full', 'flex-col');
        expect(onlineLabel.parentElement).toHaveClass('flex', 'flex-1', 'flex-col', 'items-center', 'justify-center');
        expect(onlineLabel).toHaveClass('uppercase', 'text-industrial-muted');
        expect(freshness.parentElement).toHaveClass('mt-0.5', 'flex', 'items-center', 'justify-center', 'gap-1.5');
        expect(screen.getByTestId('connection-status-icon-online')).toHaveClass('lucide-wifi');

        rerender(
            <ConnectionStatusWidget
                widget={makeConnectionWidget({ title: '' })}
                equipmentMap={equipmentMap}
                connection={makeConnection({ globalStatus: 'offline', ageMs: 0 })}
            />,
        );

        expect(screen.getByText('Sin señal')).toHaveClass('text-industrial-muted');
        expect(screen.getByTestId('connection-status-icon-offline')).toHaveClass('lucide-wifi-off');

        rerender(
            <ConnectionStatusWidget
                widget={makeConnectionWidget({ title: '' })}
                equipmentMap={equipmentMap}
                connection={makeConnection({ globalStatus: 'degradado', ageMs: 0 })}
            />,
        );

        expect(screen.getByText('Degradado')).toHaveClass('text-industrial-muted');
        expect(screen.getByTestId('connection-status-icon-degradado')).toHaveClass('lucide-wifi-high');

        rerender(
            <ConnectionStatusWidget
                widget={makeConnectionWidget()}
                equipmentMap={equipmentMap}
                connection={makeConnection({ globalStatus: 'unknown', ageMs: null, lastSuccess: null })}
            />,
        );

        expect(screen.getByText('Sin datos')).toBeInTheDocument();
        expect(screen.getByText('Sin datos')).toHaveClass('text-industrial-muted');
        expect(screen.getByText('—')).toBeInTheDocument();
        expect(screen.getByTestId('connection-status-icon-unknown')).toHaveClass('lucide-circle-question-mark');
    });

    it('omits the connection header title when the widget title is empty', () => {
        render(
            <HeaderWidgetRenderer
                widget={makeConnectionWidget({ title: '   ' })}
                equipmentMap={equipmentMap}
                connection={makeConnection({ globalStatus: 'online', ageMs: 0 })}
                align="start"
            />,
        );

        expect(screen.queryByText('Estado Conexión')).not.toBeInTheDocument();
        expect(screen.getByText('Online')).toBeInTheDocument();
    });
});
