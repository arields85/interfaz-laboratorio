import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { EquipmentSummary } from '../../domain/equipment.types';
import type { StatusWidgetConfig } from '../../domain/admin.types';
import StatusWidget from './StatusWidget';

function makeWidget(overrides?: Partial<StatusWidgetConfig>): StatusWidgetConfig {
    return {
        id: 'status-1',
        type: 'status',
        title: 'Estado',
        position: { x: 0, y: 0 },
        size: { w: 2, h: 1 },
        binding: {
            mode: 'real_variable',
            assetId: 'asset-1',
        },
        displayOptions: {},
        ...overrides,
    };
}

function makeEquipment(status: EquipmentSummary['status']): EquipmentSummary {
    return {
        id: 'asset-1',
        name: 'Extruder 1',
        type: 'extruder',
        status,
        primaryMetrics: [],
        connectionState: 'online',
    };
}

describe('StatusWidget', () => {
    it('resolves the status from equipmentMap for real bindings', () => {
        const equipmentMap = new Map([[ 'asset-1', makeEquipment('warning') ]]);

        render(<StatusWidget widget={makeWidget()} equipmentMap={equipmentMap} />);

        const label = screen.getByText('Advertencia');
        expect(label).toBeInTheDocument();
        expect(label).toHaveClass('text-accent-amber');
    });

    it('falls back to unknown when the asset is missing or there is no binding', () => {
        const { rerender } = render(
            <StatusWidget widget={makeWidget()} equipmentMap={new Map()} />,
        );

        let label = screen.getByText('Desconocido');
        expect(label).toBeInTheDocument();
        expect(label).toHaveClass('text-industrial-muted');

        rerender(<StatusWidget widget={makeWidget({ binding: undefined })} equipmentMap={new Map()} />);

        label = screen.getByText('Desconocido');
        expect(label).toBeInTheDocument();
    });

    it('uses normalized simulated values before rendering the badge label', () => {
        const { rerender } = render(
            <StatusWidget
                widget={makeWidget({
                    binding: { mode: 'simulated_value', simulatedValue: ' maintenance ' },
                })}
                equipmentMap={new Map()}
            />,
        );

        expect(screen.getByText('Mantenimiento')).toBeInTheDocument();

        rerender(
            <StatusWidget
                widget={makeWidget({
                    binding: { mode: 'simulated_value', simulatedValue: 1 },
                })}
                equipmentMap={new Map()}
            />,
        );

        expect(screen.getByText('En Producción')).toBeInTheDocument();

        rerender(
            <StatusWidget
                widget={makeWidget({
                    binding: { mode: 'simulated_value', simulatedValue: false },
                })}
                equipmentMap={new Map()}
            />,
        );

        expect(screen.getByText('Desconocido')).toBeInTheDocument();
    });

    it('uses custom labels and falls back when the custom label is blank', () => {
        const { rerender } = render(
            <StatusWidget
                widget={makeWidget({
                    binding: { mode: 'simulated_value', simulatedValue: 'running' },
                    displayOptions: { runningText: '  Operating  ' },
                })}
                equipmentMap={new Map()}
            />,
        );

        expect(screen.getByText('Operating')).toBeInTheDocument();

        rerender(
            <StatusWidget
                widget={makeWidget({
                    binding: { mode: 'simulated_value', simulatedValue: 'offline' },
                    displayOptions: { offlineText: '   ' },
                })}
                equipmentMap={new Map()}
            />,
        );

        expect(screen.getByText('Offline')).toBeInTheDocument();
    });

    it('hides the visible label in compact mode', () => {
        render(
            <StatusWidget
                widget={makeWidget({
                    binding: { mode: 'simulated_value', simulatedValue: 'critical' },
                })}
                equipmentMap={new Map()}
                compact
            />,
        );

        expect(screen.queryByText('Crítico')).not.toBeInTheDocument();
    });
});
