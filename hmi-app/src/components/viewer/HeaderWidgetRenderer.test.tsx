import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HeaderWidgetRenderer from './HeaderWidgetRenderer';
import { makeWidget } from '../../test/fixtures/dashboard.fixture';
import type { ConnectionHealth, ContractMachine } from '../../domain/dataContract.types';
import type { EquipmentSummary } from '../../domain/equipment.types';

function makeEquipmentSummary(overrides: Partial<EquipmentSummary> = {}): EquipmentSummary {
    return {
        id: 'asset-1',
        name: 'Mixer 1',
        type: 'mezcladora',
        status: 'running',
        primaryMetrics: [],
        connectionState: 'online',
        ...overrides,
    };
}

describe('HeaderWidgetRenderer', () => {
    it('renders status widgets from simulated bindings, real equipment, and unknown fallback', () => {
        const { rerender } = render(
            <HeaderWidgetRenderer
                widget={makeWidget({
                    id: 'status-simulated',
                    type: 'status',
                    title: 'Simulated status',
                    binding: { mode: 'simulated_value', simulatedValue: 'warning' },
                })}
                equipmentMap={new Map()}
                align="start"
            />,
        );

        expect(screen.getByText('Advertencia')).toBeInTheDocument();

        rerender(
            <HeaderWidgetRenderer
                widget={makeWidget({
                    id: 'status-real',
                    type: 'status',
                    title: 'Real status',
                    binding: { mode: 'real_variable', assetId: 'asset-1' },
                })}
                equipmentMap={new Map([['asset-1', makeEquipmentSummary({ status: 'running' })]])}
                align="start"
            />,
        );

        expect(screen.getByText('En Producción')).toBeInTheDocument();

        rerender(
            <HeaderWidgetRenderer
                widget={makeWidget({
                    id: 'status-unknown',
                    type: 'status',
                    title: 'Unknown status',
                    binding: { mode: 'real_variable', assetId: 'missing-asset' },
                })}
                equipmentMap={new Map()}
                align="start"
            />,
        );

        expect(screen.getByText('Desconocido')).toBeInTheDocument();
    });

    it('renders a global connection widget with relative freshness', () => {
        const connection: ConnectionHealth = {
            globalStatus: 'degradado',
            lastSuccess: '2026-04-21T13:00:00.000Z',
            ageMs: 65_000,
        };

        render(
            <HeaderWidgetRenderer
                widget={makeWidget({
                    id: 'connection-global',
                    type: 'connection-status',
                    title: 'Global connection',
                })}
                equipmentMap={new Map()}
                connection={connection}
            />,
        );

        expect(screen.getByText('Global connection')).toBeInTheDocument();
        expect(screen.getByText('Degradado')).toBeInTheDocument();
        expect(screen.getByText('1min')).toBeInTheDocument();
        expect(screen.getByTestId('connection-header-icon-degradado')).toBeInTheDocument();
    });

    it('renders machine-scoped connection widgets for real, simulated, and missing machine states', () => {
        const machines: ContractMachine[] = [{
            unitId: 101,
            name: 'Extrusora 101',
            status: 'offline',
            lastSuccess: '2026-04-21T13:00:00.000Z',
            ageMs: 0,
            values: {},
        }];

        const { rerender } = render(
            <HeaderWidgetRenderer
                widget={makeWidget({
                    id: 'connection-machine',
                    type: 'connection-status',
                    title: 'Machine connection',
                    displayOptions: { scope: 'machine', machineId: 101 },
                })}
                equipmentMap={new Map()}
                machines={machines}
            />,
        );

        expect(screen.getByText('Sin señal')).toBeInTheDocument();
        expect(screen.getByText('0s')).toBeInTheDocument();
        expect(screen.getByTestId('connection-header-icon-offline')).toBeInTheDocument();

        rerender(
            <HeaderWidgetRenderer
                widget={makeWidget({
                    id: 'connection-simulated',
                    type: 'connection-status',
                    title: 'Simulated connection',
                    binding: { mode: 'simulated_value', simulatedValue: true },
                })}
                equipmentMap={new Map()}
                machines={machines}
            />,
        );

        expect(screen.getByText('Online')).toBeInTheDocument();
        expect(screen.getByTestId('connection-header-icon-online')).toBeInTheDocument();

        rerender(
            <HeaderWidgetRenderer
                widget={makeWidget({
                    id: 'connection-missing-machine',
                    type: 'connection-status',
                    title: 'Missing machine connection',
                    displayOptions: { scope: 'machine', machineId: 999 },
                })}
                equipmentMap={new Map()}
                machines={machines}
            />,
        );

        expect(screen.getByText('Sin datos')).toBeInTheDocument();
        expect(screen.getByText('—')).toBeInTheDocument();
        expect(screen.getByTestId('connection-header-icon-unknown')).toBeInTheDocument();
    });

    it('hides connection freshness when showLastUpdate is false', () => {
        render(
            <HeaderWidgetRenderer
                widget={makeWidget({
                    id: 'connection-no-update',
                    type: 'connection-status',
                    title: 'Connection without timestamp',
                    displayOptions: { showLastUpdate: false },
                })}
                equipmentMap={new Map()}
                connection={{ globalStatus: 'online', lastSuccess: '2026-04-21T13:00:00.000Z', ageMs: 10_000 }}
            />,
        );

        expect(screen.getByText('Online')).toBeInTheDocument();
        expect(screen.queryByText('10s')).not.toBeInTheDocument();
        expect(screen.queryByText('—')).not.toBeInTheDocument();
    });

    it('renders an unsupported widget fallback', () => {
        render(
            <HeaderWidgetRenderer
                widget={makeWidget({ id: 'metric-card', type: 'metric-card', title: 'Metric card' })}
                equipmentMap={new Map()}
            />,
        );

        expect(screen.getByText('Widget no soportado en header')).toBeInTheDocument();
        expect(screen.getByText('metric-card')).toBeInTheDocument();
    });
});
