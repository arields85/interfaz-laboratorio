import '@testing-library/jest-dom/vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractMachine } from '../../domain/dataContract.types';
import type { MachineActivityWidgetConfig } from '../../domain/admin.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import MachineActivityWidget from './MachineActivityWidget';

const equipmentMap = new Map<string, EquipmentSummary>();

class MockResizeObserver implements ResizeObserver {
    public constructor(private readonly callback: ResizeObserverCallback) {}

    public observe(target: Element) {
        this.callback([
            {
                target,
                contentRect: {
                    width: 200,
                    height: 200,
                    x: 0,
                    y: 0,
                    top: 0,
                    left: 0,
                    right: 200,
                    bottom: 200,
                    toJSON: () => ({}),
                },
            } as ResizeObserverEntry,
        ], this);
    }

    public unobserve() {}

    public disconnect() {}
}

function makeWidget(overrides?: Partial<MachineActivityWidgetConfig>): MachineActivityWidgetConfig {
    return {
        id: 'machine-activity-1',
        type: 'machine-activity',
        title: 'Actividad de Máquina',
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
            showStateSubtitle: true,
            showPowerSubtext: true,
            showDynamicColor: true,
            showStateAnimation: true,
        },
        ...overrides,
    };
}

function makeMachines(value: number | null): ContractMachine[] {
    return [{
        unitId: 101,
        name: 'Extrusora 101',
        status: 'online',
        lastSuccess: '2026-04-23T22:00:00.000Z',
        ageMs: 0,
        values: {
            activePower: {
                value,
                unit: 'kW',
                timestamp: '2026-04-23T22:00:00.000Z',
            },
        },
    }];
}

function makeEquipmentMap(): Map<string, EquipmentSummary> {
    return new Map<string, EquipmentSummary>([[
        'asset-1',
        {
            id: 'asset-1',
            name: 'Extrusora 101',
            type: 'extrusora',
            status: 'running',
            connectionState: 'online',
            primaryMetrics: [{
                label: 'activePower',
                value: 0.62,
                unit: 'MW',
            }],
        },
    ]]);
}

describe('MachineActivityWidget', () => {
    beforeEach(() => {
        document.documentElement.style.removeProperty('--font-size-widget-value-gauge');
        document.documentElement.style.removeProperty('--font-size-widget-unit-gauge');
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('renders with valid power data', () => {
        render(
            <MachineActivityWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(0.1)}
            />,
        );

        expect(screen.getByText('Actividad de Máquina')).toBeInTheDocument();
        expect(screen.getByText('0')).toBeInTheDocument();
        expect(screen.getByText('0.10 kW')).toBeInTheDocument();
        expect(screen.getByText('Detenida')).toBeInTheDocument();
        const gauge = screen.getByTestId('gauge-circular');
        const value = screen.getByText('0');
        const unit = screen.getByText('kW');
        const gaugeLayer = gauge.parentElement;
        const centerContent = screen.getByTestId('gauge-circular-center-content');

        expect(gauge).toBeInTheDocument();
        expect(gaugeLayer).toHaveClass('relative', 'flex', 'flex-1', 'items-center', 'justify-center', 'w-full', 'h-full', 'min-h-0');
        expect(centerContent.tagName.toLowerCase()).toBe('g');
        expect(gauge).toContainElement(centerContent);
        expect(value.tagName.toLowerCase()).toBe('text');
        expect(unit.tagName.toLowerCase()).toBe('text');
        expect(gauge).toHaveClass('w-full', 'h-full');
        expect(gauge.style.width).toBe('');
        expect(gauge.style.height).toBe('');
    });

    it('renders invalid/no data state', () => {
        render(
            <MachineActivityWidget
                widget={makeWidget({ binding: undefined })}
                equipmentMap={equipmentMap}
                machines={makeMachines(null)}
            />,
        );

        expect(screen.getByText('Actividad de Máquina')).toBeInTheDocument();
        expect(screen.getByText('--')).toBeInTheDocument();
        expect(screen.getByText('Sin datos')).toBeInTheDocument();
        expect(screen.getByText('-- kW')).toBeInTheDocument();
    });

    it('renders no-data fallback when the real binding machine cannot be resolved', () => {
        render(
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'real_variable',
                        bindingVersion: 'node-red-v1',
                        machineId: 999,
                        variableKey: 'activePower',
                        unit: 'kW',
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(0.4)}
            />,
        );

        expect(screen.getByText('--')).toBeInTheDocument();
        expect(screen.getByText('Sin datos')).toBeInTheDocument();
        expect(screen.getByText('-- kW')).toBeInTheDocument();
    });

    it('renders loading and loaded states as separate mounts', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const loadingView = render(
            <MachineActivityWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(0.1)}
                isLoadingData
            />,
        );

        expect(screen.getByText((_, element) => element?.className.includes('animate-pulse') ?? false)).toBeInTheDocument();

        loadingView.unmount();

        expect(() => render(
            <MachineActivityWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(0.3)}
                isLoadingData={false}
            />,
        )).not.toThrow();

        expect(screen.getByText('Actividad de Máquina')).toBeInTheDocument();
        expect(screen.getByText('0')).toBeInTheDocument();
        expect(consoleError).not.toHaveBeenCalled();

        consoleError.mockRestore();
    });

    it('uses the custom unit only for the center value when unitOverride is enabled', () => {
        render(
            <MachineActivityWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateSubtitle: true,
                        showPowerSubtext: true,
                        showDynamicColor: true,
                        showStateAnimation: true,
                        unitOverride: true,
                        unit: '%',
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(0.1)}
            />,
        );

        expect(screen.getByText('%')).toBeInTheDocument();
        expect(screen.getByText('0.10 kW')).toBeInTheDocument();
        expect(screen.queryByText('0.10 %')).not.toBeInTheDocument();
    });

    it('refreshes the live unit when the bound variable changes and unitOverride is disabled', () => {
        const { rerender } = render(
            <MachineActivityWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'circular',
                        unitOverride: false,
                        unit: '%',
                    },
                })}
                equipmentMap={equipmentMap}
                machines={[{
                    unitId: 101,
                    name: 'Extrusora 101',
                    status: 'online',
                    lastSuccess: '2026-04-23T22:00:00.000Z',
                    ageMs: 0,
                    values: {
                        activePower: {
                            value: 0.1,
                            unit: 'kW',
                            timestamp: '2026-04-23T22:00:00.000Z',
                        },
                        frequency: {
                            value: 0.1,
                            unit: 'Hz',
                            timestamp: '2026-04-23T22:00:00.000Z',
                        },
                    },
                }]}
            />,
        );

        expect(screen.getByText('kW')).toBeInTheDocument();

        rerender(
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'real_variable',
                        bindingVersion: 'node-red-v1',
                        machineId: 101,
                        variableKey: 'frequency',
                        unit: 'kW',
                    },
                    displayOptions: {
                        kpiMode: 'circular',
                        unitOverride: false,
                        unit: '%',
                    },
                })}
                equipmentMap={equipmentMap}
                machines={[{
                    unitId: 101,
                    name: 'Extrusora 101',
                    status: 'online',
                    lastSuccess: '2026-04-23T22:00:00.000Z',
                    ageMs: 0,
                    values: {
                        activePower: {
                            value: 0.1,
                            unit: 'kW',
                            timestamp: '2026-04-23T22:00:00.000Z',
                        },
                        frequency: {
                            value: 0.1,
                            unit: 'Hz',
                            timestamp: '2026-04-23T22:00:00.000Z',
                        },
                    },
                }]}
            />,
        );

        expect(screen.getByText('Hz')).toBeInTheDocument();
        expect(screen.queryByText('%')).not.toBeInTheDocument();
    });

    it('uses the simulated binding unit for both center and subtext even if a stale custom unit exists', () => {
        render(
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 0.12,
                        machineId: 101,
                        variableKey: 'activePower',
                        bindingVersion: 'node-red-v1',
                        unit: '%',
                    },
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateSubtitle: true,
                        showPowerSubtext: true,
                        showDynamicColor: true,
                        showStateAnimation: true,
                        unitOverride: true,
                        unit: 'kW',
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(0.1)}
            />,
        );

        expect(screen.getAllByText('%')).toHaveLength(1);
        expect(screen.getByText('0.12 %')).toBeInTheDocument();
        expect(screen.queryByText('0.12 kW')).not.toBeInTheDocument();
        expect(screen.queryByText('kW')).not.toBeInTheDocument();
    });

    it('resolves live data from the equipment map in bar mode and hides optional text rows when disabled', async () => {
        render(
            <MachineActivityWidget
                widget={makeWidget({
                    title: undefined,
                    binding: {
                        mode: 'real_variable',
                        bindingVersion: 'node-red-v1',
                        assetId: 'asset-1',
                        variableKey: 'activePower',
                        unit: 'kW',
                    },
                    displayOptions: {
                        kpiMode: 'bar',
                        showStateSubtitle: false,
                        showPowerSubtext: false,
                        showDynamicColor: false,
                        showStateAnimation: true,
                        confirmationTime: 0,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                    },
                })}
                equipmentMap={makeEquipmentMap()}
            />,
        );

        expect(screen.getByText('Actividad de Máquina')).toBeInTheDocument();
        expect(screen.queryByText('Produciendo')).not.toBeInTheDocument();
        expect(screen.queryByText('0.62 MW')).not.toBeInTheDocument();

        await waitFor(() => {
            expect(screen.getByText('62')).toBeInTheDocument();
            expect(screen.getByTestId('gauge-bar-fill')).toHaveStyle({ width: '62%' });
            expect(screen.getByText('Actividad de Máquina').closest('[data-state]')).toHaveAttribute('data-state', 'producing');
        });

        expect(screen.getByText('MW')).toBeInTheDocument();
    });

    it('renders simulated stopped, calibrating, and producing states immediately', () => {
        const { rerender } = render(
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 0.1,
                        unit: 'kW',
                        machineId: 101,
                        variableKey: 'activePower',
                        bindingVersion: 'node-red-v1',
                    },
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateSubtitle: true,
                        showPowerSubtext: true,
                        showDynamicColor: true,
                        showStateAnimation: true,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                        labelStopped: 'Parada',
                        labelCalibrating: 'Ajuste',
                        labelProducing: 'En marcha',
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        expect(screen.getByText('Parada')).toBeInTheDocument();
        expect(screen.getByText('Actividad de Máquina').closest('[data-state]')).toHaveAttribute('data-state', 'stopped');

        rerender(
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 0.2,
                        unit: 'kW',
                        machineId: 101,
                        variableKey: 'activePower',
                        bindingVersion: 'node-red-v1',
                    },
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateSubtitle: true,
                        showPowerSubtext: true,
                        showDynamicColor: true,
                        showStateAnimation: true,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                        labelStopped: 'Parada',
                        labelCalibrating: 'Ajuste',
                        labelProducing: 'En marcha',
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        expect(screen.getByText('Ajuste')).toBeInTheDocument();
        expect(screen.getByText('20')).toBeInTheDocument();
        expect(screen.getByText('Actividad de Máquina').closest('[data-state]')).toHaveAttribute('data-state', 'calibrating');

        rerender(
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 0.3,
                        unit: 'kW',
                        machineId: 101,
                        variableKey: 'activePower',
                        bindingVersion: 'node-red-v1',
                    },
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateSubtitle: true,
                        showPowerSubtext: true,
                        showDynamicColor: true,
                        showStateAnimation: true,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                        labelStopped: 'Parada',
                        labelCalibrating: 'Ajuste',
                        labelProducing: 'En marcha',
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        expect(screen.getByText('En marcha')).toBeInTheDocument();
        expect(screen.getByText('30')).toBeInTheDocument();
        expect(screen.getByText('Actividad de Máquina').closest('[data-state]')).toHaveAttribute('data-state', 'producing');
    });

    it('resets machine activity processing when switching from a real binding to a simulated value', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-24T12:30:00.000Z'));

        const { rerender } = render(
            <MachineActivityWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateSubtitle: true,
                        showPowerSubtext: true,
                        showDynamicColor: true,
                        showStateAnimation: true,
                        powerMin: 0,
                        powerMax: 40,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1)}
            />, 
        );

        rerender(
            <MachineActivityWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateSubtitle: true,
                        showPowerSubtext: true,
                        showDynamicColor: true,
                        showStateAnimation: true,
                        powerMin: 0,
                        powerMax: 40,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1)}
            />,
        );

        act(() => {
            vi.advanceTimersByTime(2000);
        });

        rerender(
            <MachineActivityWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateSubtitle: true,
                        showPowerSubtext: true,
                        showDynamicColor: true,
                        showStateAnimation: true,
                        powerMin: 0,
                        powerMax: 40,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1)}
            />,
        );

        expect(screen.getByText('3')).toBeInTheDocument();

        rerender(
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 30,
                        unit: '°F',
                        machineId: 101,
                        variableKey: 'activePower',
                        bindingVersion: 'node-red-v1',
                    },
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateSubtitle: true,
                        showPowerSubtext: true,
                        showDynamicColor: true,
                        showStateAnimation: true,
                        powerMin: 0,
                        powerMax: 40,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1)}
            />,
        );

        expect(screen.getByText('75')).toBeInTheDocument();
        expect(screen.getByText('30.00 °F')).toBeInTheDocument();
        expect(screen.getByText('°F')).toBeInTheDocument();
    });

    it('updates circular gauge text sizing when the shared gauge font variables change', async () => {
        render(
            <MachineActivityWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(0.1)}
            />,
        );

        const gauge = screen.getByTestId('gauge-circular');
        const [valueText, unitText] = Array.from(gauge.querySelectorAll('text'));

        expect(valueText).not.toHaveAttribute('font-size');
        expect(unitText).not.toHaveAttribute('font-size');

        act(() => {
            document.documentElement.style.setProperty('--font-size-widget-value-gauge', '76px');
            document.documentElement.style.setProperty('--font-size-widget-unit-gauge', '26px');
        });

        await waitFor(() => {
            expect(valueText).toHaveAttribute('font-size', '76');
            expect(unitText).toHaveAttribute('font-size', '26');
        });
    });

    it('renders circular mode even when resize and mutation observers are unavailable', () => {
        vi.stubGlobal('ResizeObserver', undefined);
        vi.stubGlobal('MutationObserver', undefined);

        render(
            <MachineActivityWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(0.1)}
            />,
        );

        expect(screen.getByTestId('gauge-circular')).toBeInTheDocument();
        expect(screen.getByText('Detenida')).toBeInTheDocument();
    });
});
