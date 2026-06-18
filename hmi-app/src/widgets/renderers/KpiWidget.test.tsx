import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ContractMachine } from '../../domain/dataContract.types';
import type { KpiWidgetConfig } from '../../domain/admin.types';
import KpiWidget from './KpiWidget';

const equipmentMap = new Map();

function makeWidget(overrides?: Partial<KpiWidgetConfig>): KpiWidgetConfig {
    return {
        id: 'kpi-1',
        type: 'kpi',
        title: 'Potencia',
        position: { x: 0, y: 0 },
        size: { w: 2, h: 2 },
        binding: {
            mode: 'real_variable',
            bindingVersion: 'node-red-v1',
            machineId: 101,
            variableKey: 'activePower',
            unit: 'kW',
        },
        displayOptions: {
            kpiMode: 'circular',
            min: 0,
            max: 10,
        },
        ...overrides,
    };
}

function makeMachines(value: number | string | null, unit = 'kW'): ContractMachine[] {
    return [{
        unitId: 101,
        name: 'Extrusora 101',
        status: 'online',
        lastSuccess: '2026-04-23T22:00:00.000Z',
        ageMs: 0,
        values: {
            activePower: {
                value,
                unit,
                timestamp: '2026-04-23T22:00:00.000Z',
            },
        },
    }];
}

function makeSimulatedWidget(simulatedValue: number | string | undefined, overrides?: Partial<KpiWidgetConfig>): KpiWidgetConfig {
    return makeWidget({
        binding: {
            mode: 'simulated_value',
            simulatedValue,
            machineId: 101,
            variableKey: 'activePower',
            bindingVersion: 'node-red-v1',
            unit: 'kW',
        },
        ...overrides,
    });
}

describe('KpiWidget', () => {
    it('renders a loading skeleton without gauge or resolved value output', () => {
        const { container } = render(
            <KpiWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(1.1)}
                isLoadingData
            />,
        );

        expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
        expect(screen.queryByText('Potencia')).not.toBeInTheDocument();
        expect(screen.queryByTestId('gauge-circular')).not.toBeInTheDocument();
        expect(screen.queryByTestId('gauge-bar-fill')).not.toBeInTheDocument();
        expect(screen.queryByText('1.1')).not.toBeInTheDocument();
    });

    it('renders circular gauge as a direct sibling of the centered value overlay', () => {
        render(
            <KpiWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(1.1)}
            />,
        );

        const gauge = screen.getByTestId('gauge-circular');
        const value = screen.getByText('1.1');
        const gaugeLayer = gauge.parentElement;
        const valueLayer = value.parentElement;

        expect(gaugeLayer).toHaveClass('relative', 'flex', 'items-center', 'justify-center', 'w-full', 'h-full', 'min-h-[140px]');
        expect(valueLayer).toHaveClass('absolute', 'inset-0', 'flex', 'flex-col', 'items-center', 'justify-center');
        expect(gaugeLayer).toBe(valueLayer?.parentElement);
        expect(gauge).toHaveClass('w-full', 'h-full');
        expect(gauge.style.width).toBe('');
        expect(gauge.style.height).toBe('');
    });

    it('uses the custom unit when unitOverride is enabled', () => {
        render(
            <KpiWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'circular',
                        min: 0,
                        max: 10,
                        unitOverride: true,
                        unit: '%',
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1.1)}
            />,
        );

        expect(screen.getByText('%')).toBeInTheDocument();
        expect(screen.queryByText('kW')).not.toBeInTheDocument();
    });

    it('uses the simulated binding unit for the widget and bar scale labels even if a stale custom unit exists', () => {
        render(
            <KpiWidget
                widget={makeWidget({
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 1200,
                        machineId: 101,
                        variableKey: 'activePower',
                        bindingVersion: 'node-red-v1',
                        unit: 'RPM',
                    },
                    displayOptions: {
                        kpiMode: 'bar',
                        min: 0,
                        max: 2000,
                        unitOverride: true,
                        unit: '°C',
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1.1)}
            />,
        );

        expect(screen.getAllByText('RPM')).toHaveLength(1);
        expect(screen.getByText('0 RPM')).toBeInTheDocument();
        expect(screen.getByText('2000 RPM')).toBeInTheDocument();
        expect(screen.queryByText('°C')).not.toBeInTheDocument();
        expect(screen.queryByText('0 °C')).not.toBeInTheDocument();
    });

    it('clamps bar fill width to 0% and 100% when values fall outside the configured range', () => {
        const { rerender } = render(
            <KpiWidget
                widget={makeWidget({
                    displayOptions: { kpiMode: 'bar', min: 0, max: 10 },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(-5)}
            />,
        );

        expect(screen.getByTestId('gauge-bar-fill')).toHaveStyle({ width: '0%' });

        rerender(
            <KpiWidget
                widget={makeWidget({
                    displayOptions: { kpiMode: 'bar', min: 0, max: 10 },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(15)}
            />,
        );

        expect(screen.getByTestId('gauge-bar-fill')).toHaveStyle({ width: '100%' });
    });

    it('keeps bar fill stable at 0% when min and max are equal', () => {
        render(
            <KpiWidget
                widget={makeWidget({
                    displayOptions: { kpiMode: 'bar', min: 5, max: 5 },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(5)}
            />,
        );

        expect(screen.getByTestId('gauge-bar-fill')).toHaveStyle({ width: '0%' });
    });

    it('renders a fallback placeholder and hides the unit when the resolved value is missing', () => {
        render(
            <KpiWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(null)}
            />,
        );

        expect(screen.getByText('--')).toBeInTheDocument();
        expect(screen.queryByText('kW')).not.toBeInTheDocument();
    });

    it('parses numeric strings and falls back to zero output for non-numeric strings', () => {
        const { rerender } = render(
            <KpiWidget
                widget={makeSimulatedWidget('12.5', {
                    displayOptions: { kpiMode: 'bar', min: 0, max: 20 },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1)}
            />,
        );

        expect(screen.getByText('12.5')).toBeInTheDocument();
        expect(screen.getByText('kW')).toBeInTheDocument();
        expect(screen.getByTestId('gauge-bar-fill')).toHaveStyle({ width: '62.5%' });

        rerender(
            <KpiWidget
                widget={makeSimulatedWidget('not-a-number', {
                    displayOptions: { kpiMode: 'bar', min: 0, max: 20 },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1)}
            />,
        );

        expect(screen.getByText('0')).toBeInTheDocument();
        expect(screen.getByText('kW')).toBeInTheDocument();
        expect(screen.getByTestId('gauge-bar-fill')).toHaveStyle({ width: '0%' });
    });

    it('uses the placeholder icon when icon selection is pending, hides it when null, and mutes invalid icons', () => {
        const { container, rerender } = render(
            <KpiWidget
                widget={makeSimulatedWidget(4, {
                    displayOptions: { kpiMode: 'bar', min: 0, max: 10, icon: undefined },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1)}
            />,
        );

        expect(container.querySelector('svg')).toHaveStyle({ color: 'var(--color-industrial-muted)' });

        rerender(
            <KpiWidget
                widget={makeSimulatedWidget(4, {
                    displayOptions: { kpiMode: 'bar', min: 0, max: 10, icon: null },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1)}
            />,
        );

        expect(container.querySelector('svg')).not.toBeInTheDocument();

        rerender(
            <KpiWidget
                widget={makeSimulatedWidget(4, {
                    displayOptions: { kpiMode: 'bar', min: 0, max: 10, icon: 'DefinitelyNotAnIcon' as 'Gauge' },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1)}
            />,
        );

        expect(container.querySelector('svg')).toHaveStyle({ color: 'var(--color-industrial-muted)' });
    });

    it.each([
        { value: 4, expectedColor: 'var(--color-status-normal)' },
        { value: 6, expectedColor: 'var(--color-status-warning)' },
        { value: 9, expectedColor: 'var(--color-status-critical)' },
    ])('applies dynamic threshold visuals for value $value', ({ value, expectedColor }) => {
        const { container } = render(
            <KpiWidget
                widget={makeSimulatedWidget(value, {
                    thresholds: [
                        { value: 5, severity: 'warning' },
                        { value: 8, severity: 'critical' },
                    ],
                    displayOptions: {
                        kpiMode: 'bar',
                        min: 0,
                        max: 10,
                        dynamicColor: true,
                        icon: 'Gauge',
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1)}
            />,
        );

        expect(container.querySelector('svg')).toHaveStyle({ color: expectedColor });
    });

    it('renders footer subtext only when configured', () => {
        const { rerender } = render(
            <KpiWidget
                widget={makeWidget({
                    displayOptions: { kpiMode: 'circular', min: 0, max: 10, subtext: 'Nominal load' },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1)}
            />,
        );

        expect(screen.getByText('Nominal load')).toBeInTheDocument();

        rerender(
            <KpiWidget
                widget={makeWidget({
                    displayOptions: { kpiMode: 'circular', min: 0, max: 10 },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1)}
            />,
        );

        expect(screen.queryByText('Nominal load')).not.toBeInTheDocument();
    });
});
