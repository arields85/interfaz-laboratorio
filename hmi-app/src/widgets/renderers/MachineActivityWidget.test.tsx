import '@testing-library/jest-dom/vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractMachine } from '../../domain/dataContract.types';
import type { MachineActivityWidgetConfig } from '../../domain/admin.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import MachineActivityWidget, { resolveActivityVisualAnimationDuration } from './MachineActivityWidget';
import {
    DEFAULT_CIRCULAR_ARC_GLOW_INTENSITY,
    FIXED_TOP_CAP_TRAVEL_COMPLETION_PULSE_STABILITY_MAX,
    KPI_FIXED_TOP_CAP_PULSE_INTENSITY_MAX,
    resolveKpiFixedTopCapBlinkProfile,
    resolveMachineActivityFixedTopCapEffects,
    resolveMachineActivityTravelCompletionBlinkDurationSeconds,
} from '../../utils/kpiTopCapEffects';
import { resolveTravelingTopCapSpeed } from '../../utils/travelingTopCapSpeed';

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

function makeMachinesWithUnit(value: number | null, unit?: string): ContractMachine[] {
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
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    function createAnimationFrameController() {
        let animationFrameId = 0;
        const animationFrameCallbacks = new Map<number, FrameRequestCallback>();

        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
            animationFrameId += 1;
            animationFrameCallbacks.set(animationFrameId, callback);
            return animationFrameId;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
            animationFrameCallbacks.delete(id);
        }));

        return {
            runNextFrame(now: number) {
                const nextFrame = Array.from(animationFrameCallbacks.entries()).at(-1);

                expect(nextFrame).toBeDefined();

                const [frameId, callback] = nextFrame!;
                animationFrameCallbacks.delete(frameId);

                act(() => {
                    callback(now);
                });
            },
            runAllFrames(now: number, maxFrames = 10) {
                let framesRun = 0;

                while (animationFrameCallbacks.size > 0 && framesRun < maxFrames) {
                    framesRun += 1;
                    this.runNextFrame(now);
                }
            },
            runFrameBatch(now: number, iterations = 5) {
                for (let iteration = 0; iteration < iterations; iteration += 1) {
                    const pendingFrames = Array.from(animationFrameCallbacks.entries());

                    if (pendingFrames.length === 0) {
                        return;
                    }

                    for (const [frameId, callback] of pendingFrames) {
                        animationFrameCallbacks.delete(frameId);

                        act(() => {
                            callback(now);
                        });
                    }
                }
            },
        };
    }

    function expectCircularArcToMatchPercent(percent: number) {
        const staticTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        const expectedAngle = percent * 3.6;

        expect(Number.parseFloat(staticTopCap.getAttribute('data-cap-angle') ?? '0')).toBeCloseTo(expectedAngle, 1);
    }

    function expectCircularArcToApproximateDisplayedPercent(percent: number) {
        const staticTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        const actualPercent = Number.parseFloat(staticTopCap.getAttribute('data-cap-angle') ?? '0') / 3.6;

        expect(actualPercent).toBeCloseTo(percent, 0);
    }

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
        expect(screen.getAllByTestId('gauge-circular-arc-segment')[0]).toHaveAttribute('stroke-linecap', 'butt');
        expect(screen.queryByTestId('gauge-circular-static-top-cap')).not.toBeInTheDocument();
        expect(screen.queryByTestId('gauge-circular-top-cap')).not.toBeInTheDocument();
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

        const loadingState = screen.getByTestId('machine-activity-widget-loading');

        expect(loadingState).toHaveTextContent('Cargando_');
        expect(loadingState.querySelector('.widget-runtime-state-caret')).not.toBeNull();

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

    it('preserves the setup-to-stopped transition state across an in-place loading rerender', () => {
        const requestAnimationFrameSpy = vi.fn(() => 1);
        const cancelAnimationFrameSpy = vi.fn();
        vi.stubGlobal('requestAnimationFrame', requestAnimationFrameSpy);
        vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameSpy);

        const renderWidget = (simulatedValue: number, isLoadingData = false) => (
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue,
                        unit: 'kW',
                        machineId: 101,
                        variableKey: 'activePower',
                        bindingVersion: 'node-red-v1',
                    },
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateAnimation: true,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                    },
                })}
                equipmentMap={equipmentMap}
                isLoadingData={isLoadingData}
            />
        );

        const readArcSignature = (sequence: Array<{ simulatedValue: number; isLoadingData?: boolean }>) => {
            const { rerender, unmount } = render(
                renderWidget(sequence[0]?.simulatedValue ?? 0.1, sequence[0]?.isLoadingData ?? false),
            );

            sequence.slice(1).forEach(({ simulatedValue, isLoadingData }) => {
                rerender(renderWidget(simulatedValue, isLoadingData ?? false));
            });

            const signature = screen
                .getAllByTestId('gauge-circular-arc-segment')
                .map((segment) => segment.getAttribute('stroke-dasharray') ?? '')
                .join('|');

            unmount();
            return signature;
        };

        const stoppedFromFreshRenderSignature = readArcSignature([{ simulatedValue: 0.1 }]);
        const loadingTransitionSignature = readArcSignature([
            { simulatedValue: 0.2 },
            { simulatedValue: 0.2, isLoadingData: true },
            { simulatedValue: 0.1 },
        ]);

        expect(loadingTransitionSignature).not.toBe(stoppedFromFreshRenderSignature);
        expect(requestAnimationFrameSpy).toHaveBeenCalled();
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

    it('keeps the real power fallback unit visible when the live binding provides no unit metadata', () => {
        render(
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'real_variable',
                        bindingVersion: 'node-red-v1',
                        machineId: 101,
                        variableKey: 'activePower',
                    },
                    displayOptions: {
                        kpiMode: 'circular',
                        unitOverride: false,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachinesWithUnit(0.1)}
            />,
        );

        expect(screen.getByText('kW')).toBeInTheDocument();
        expect(screen.getByText('0.10 kW')).toBeInTheDocument();
        expect(screen.queryByText('%')).not.toBeInTheDocument();
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
        const animationFrames = createAnimationFrameController();
        vi.spyOn(performance, 'now').mockReturnValue(1_000);

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
            expect(screen.getByText('Actividad de Máquina').closest('[data-state]')).toHaveAttribute('data-state', 'producing');
        });

        animationFrames.runFrameBatch(2_100);

        expect(screen.getByText('62')).toBeInTheDocument();
        expect(Number.parseFloat(screen.getByTestId('gauge-bar-fill').style.width)).toBeCloseTo(62, 0);

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
        expect(screen.getByText('Actividad de Máquina').closest('[data-state]')).toHaveAttribute('data-state', 'producing');
    });

    it('keeps the displayed value and bar gauge fill synchronized during in-state activity animation', () => {
        const animationFrames = createAnimationFrameController();
        vi.spyOn(performance, 'now').mockReturnValue(1_000);

        const { rerender } = render(
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 0.4,
                        unit: 'kW',
                        machineId: 101,
                        variableKey: 'activePower',
                        bindingVersion: 'node-red-v1',
                    },
                    displayOptions: {
                        kpiMode: 'bar',
                        showStateAnimation: true,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        expect(screen.getByText('40')).toBeInTheDocument();
        expect(screen.getByTestId('gauge-bar-fill')).toHaveStyle({ width: '40%' });

        rerender(
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 0.6,
                        unit: 'kW',
                        machineId: 101,
                        variableKey: 'activePower',
                        bindingVersion: 'node-red-v1',
                    },
                    displayOptions: {
                        kpiMode: 'bar',
                        showStateAnimation: true,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        animationFrames.runNextFrame(1_180);

        expect(screen.getByText('55')).toBeInTheDocument();
        expect(Number.parseFloat(screen.getByTestId('gauge-bar-fill').style.width)).toBeCloseTo(55, 5);

        animationFrames.runNextFrame(1_360);

        expect(screen.getByText('60')).toBeInTheDocument();
        expect(Number.parseFloat(screen.getByTestId('gauge-bar-fill').style.width)).toBeCloseTo(60, 5);
    });

    it('keeps the displayed value and circular arc synchronized during in-state activity animation', () => {
        const animationFrames = createAnimationFrameController();
        vi.spyOn(performance, 'now').mockReturnValue(1_000);

        const { rerender } = render(
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 0.4,
                        unit: 'kW',
                        machineId: 101,
                        variableKey: 'activePower',
                        bindingVersion: 'node-red-v1',
                    },
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateAnimation: true,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        expect(screen.getByText('40')).toBeInTheDocument();
        expectCircularArcToMatchPercent(40);

        rerender(
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 0.6,
                        unit: 'kW',
                        machineId: 101,
                        variableKey: 'activePower',
                        bindingVersion: 'node-red-v1',
                    },
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateAnimation: true,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        animationFrames.runNextFrame(1_180);

        expect(screen.getByText('55')).toBeInTheDocument();
        expectCircularArcToMatchPercent(55);

        animationFrames.runNextFrame(1_360);

        expect(screen.getByText('60')).toBeInTheDocument();
    });

    it('animates the circular value and arc together when crossing from producing into setup', () => {
        const animationFrames = createAnimationFrameController();
        vi.spyOn(performance, 'now').mockReturnValue(1_000);

        const { rerender } = render(
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 0.6,
                        unit: 'kW',
                        machineId: 101,
                        variableKey: 'activePower',
                        bindingVersion: 'node-red-v1',
                    },
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateAnimation: true,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        expect(screen.getByText('60')).toBeInTheDocument();

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
                        showStateAnimation: true,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        animationFrames.runNextFrame(1_240);

        expect(screen.getByText('34')).toBeInTheDocument();
        expectCircularArcToApproximateDisplayedPercent(34);

        animationFrames.runNextFrame(1_640);

        expect(screen.getByText('20')).toBeInTheDocument();
        expectCircularArcToMatchPercent(20);
    });

    it('animates the circular value and arc together when crossing from setup into producing', () => {
        const animationFrames = createAnimationFrameController();
        vi.spyOn(performance, 'now').mockReturnValue(1_000);

        const { rerender } = render(
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
                        showStateAnimation: true,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        expect(screen.getByText('20')).toBeInTheDocument();
        expectCircularArcToMatchPercent(20);

        rerender(
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 0.6,
                        unit: 'kW',
                        machineId: 101,
                        variableKey: 'activePower',
                        bindingVersion: 'node-red-v1',
                    },
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateAnimation: true,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        animationFrames.runNextFrame(1_240);

        expect(screen.getByText('46')).toBeInTheDocument();
        expectCircularArcToApproximateDisplayedPercent(46);

        animationFrames.runNextFrame(1_640);

        expect(screen.getByText('60')).toBeInTheDocument();
    });

    it('animates the circular value and arc together when crossing from producing into stopped', () => {
        const animationFrames = createAnimationFrameController();
        vi.spyOn(performance, 'now').mockReturnValue(1_000);

        const { rerender } = render(
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 0.6,
                        unit: 'kW',
                        machineId: 101,
                        variableKey: 'activePower',
                        bindingVersion: 'node-red-v1',
                    },
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateAnimation: true,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        expect(screen.getByText('60')).toBeInTheDocument();
        expectCircularArcToMatchPercent(60);

        rerender(
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
                        showStateAnimation: true,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        animationFrames.runNextFrame(1_210);

        expect(screen.getByText('34')).toBeInTheDocument();
        expectCircularArcToApproximateDisplayedPercent(34);
        expect(screen.getByTestId('gauge-circular-static-top-cap')).toBeInTheDocument();

        animationFrames.runNextFrame(1_840);

        expect(screen.getByText('0')).toBeInTheDocument();
        expect(screen.queryByTestId('gauge-circular-static-top-cap')).not.toBeInTheDocument();
    });

    it('animates the circular value and arc together when crossing from stopped into producing', () => {
        const animationFrames = createAnimationFrameController();
        vi.spyOn(performance, 'now').mockReturnValue(1_000);

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
                        showStateAnimation: true,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        expect(screen.getByText('0')).toBeInTheDocument();
        expect(screen.queryByTestId('gauge-circular-static-top-cap')).not.toBeInTheDocument();

        rerender(
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 0.6,
                        unit: 'kW',
                        machineId: 101,
                        variableKey: 'activePower',
                        bindingVersion: 'node-red-v1',
                    },
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateAnimation: true,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        animationFrames.runNextFrame(1_210);

        expect(screen.getByText('26')).toBeInTheDocument();
        expectCircularArcToApproximateDisplayedPercent(26);
        expect(screen.getByTestId('gauge-circular-static-top-cap')).toBeInTheDocument();

        animationFrames.runFrameBatch(2_100);

        expect(screen.getByText('60')).toBeInTheDocument();
        expectCircularArcToApproximateDisplayedPercent(60);
    });

    it('caps the visual activity animation duration while keeping larger deltas slower than smaller ones', () => {
        expect(resolveActivityVisualAnimationDuration(5)).toBe(300);
        expect(resolveActivityVisualAnimationDuration(20)).toBe(360);
        expect(resolveActivityVisualAnimationDuration(100)).toBe(1200);
    });

    it('resets machine activity processing when switching from a real binding to a simulated value', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-24T12:30:00.000Z'));
        const animationFrames = createAnimationFrameController();
        vi.spyOn(performance, 'now').mockReturnValue(1_000);

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

        animationFrames.runNextFrame(1_300);

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

        act(() => {
            vi.advanceTimersByTime(2_000);
        });

        animationFrames.runFrameBatch(2_100);

        expect(screen.getByText('75')).toBeInTheDocument();
        expect(screen.getByText('30.00 °F')).toBeInTheDocument();
        expect(screen.getByText('°F')).toBeInTheDocument();
    });

    it('keeps the default circular value size and still updates the shared unit size when gauge font variables change', async () => {
        render(
            <MachineActivityWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(0.1)}
            />,
        );

        const gauge = screen.getByTestId('gauge-circular');
        const [valueText, unitText] = Array.from(gauge.querySelectorAll('text'));

        expect(Number.parseFloat(valueText.getAttribute('font-size') ?? '0')).toBeGreaterThan(0);
        expect(unitText).not.toHaveAttribute('font-size');

        act(() => {
            document.documentElement.style.setProperty('--font-size-widget-value-gauge', '76px');
            document.documentElement.style.setProperty('--font-size-widget-unit-gauge', '26px');
        });

        await waitFor(() => {
            expect(Number.parseFloat(valueText.getAttribute('font-size') ?? '0')).toBeGreaterThan(0);
            expect(unitText).toHaveAttribute('font-size', '26');
        });
    });

    it('uses the per-widget numeric value size override and falls back to 60 when absent', async () => {
        act(() => {
            document.documentElement.style.setProperty('--font-size-widget-value-gauge', '76px');
            document.documentElement.style.setProperty('--font-size-widget-unit-gauge', '26px');
        });

        const { rerender } = render(
            <MachineActivityWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateSubtitle: true,
                        showPowerSubtext: true,
                        showDynamicColor: true,
                        showStateAnimation: true,
                        valueFontSize: 88,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(0.1)}
            />,
        );

        let gauge = screen.getByTestId('gauge-circular');
        let [valueText, unitText] = Array.from(gauge.querySelectorAll('text'));
        let overrideFontSize = 0;

        await waitFor(() => {
            overrideFontSize = Number.parseFloat(valueText.getAttribute('font-size') ?? '0');
            expect(overrideFontSize).toBeGreaterThan(0);
            expect(Number.parseFloat(unitText.getAttribute('font-size') ?? '0')).toBeGreaterThan(0);
        });

        rerender(
            <MachineActivityWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(0.1)}
            />,
        );

        gauge = screen.getByTestId('gauge-circular');
        [valueText, unitText] = Array.from(gauge.querySelectorAll('text'));

        await waitFor(() => {
            expect(Number.parseFloat(valueText.getAttribute('font-size') ?? '0')).toBeLessThan(overrideFontSize);
            expect(Number.parseFloat(unitText.getAttribute('font-size') ?? '0')).toBeGreaterThan(0);
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

    it('defaults machine-activity fixed blink to on-with-failures at max intensity', () => {
        const expectedFixedTopCapEffects = resolveMachineActivityFixedTopCapEffects();
        const expectedArcGlowOpacity = String(Number((DEFAULT_CIRCULAR_ARC_GLOW_INTENSITY / 100).toFixed(2)));

        render(
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
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(0.3)}
            />,
        );

        const staticTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        const movingTopCap = screen.getByTestId('gauge-circular-top-cap');
        const blinkStack = within(staticTopCap).getByTestId('gauge-circular-static-top-cap-blink-stack');

        expect(staticTopCap).toHaveAttribute('data-effect-blink-mode', 'on-with-failures');
        expect(staticTopCap).toHaveAttribute('data-effect-pulse-intensity', String(KPI_FIXED_TOP_CAP_PULSE_INTENSITY_MAX));
        expect(staticTopCap).toHaveAttribute('data-effect-aura', String(expectedFixedTopCapEffects.auraIntensity));
        expect(staticTopCap).toHaveAttribute('data-effect-halo', String(expectedFixedTopCapEffects.haloIntensity));
        expect(staticTopCap).toHaveAttribute('data-effect-blur', String(expectedFixedTopCapEffects.blur));
        expect(staticTopCap).toHaveAttribute('data-effect-extension', String(expectedFixedTopCapEffects.extension));
        expect(staticTopCap).toHaveAttribute('data-effect-thickness', String(expectedFixedTopCapEffects.thickness));
        expect(staticTopCap).toHaveAttribute('data-effect-pulse-speed', String(expectedFixedTopCapEffects.pulseSpeed));
        expect(staticTopCap).toHaveAttribute('data-effect-pulse-irregularity', String(expectedFixedTopCapEffects.pulseIrregularity));
        expect(staticTopCap).toHaveAttribute('data-effect-pulse-stability', String(expectedFixedTopCapEffects.pulseStability));
        expect(blinkStack).toHaveAttribute('data-blink-enabled', 'true');
        expect(blinkStack).toHaveAttribute('data-blink-trigger', 'travel-completion');
        expect(blinkStack).toHaveAttribute('data-blink-duration', String(resolveMachineActivityTravelCompletionBlinkDurationSeconds(
            expectedFixedTopCapEffects.pulseStability,
            FIXED_TOP_CAP_TRAVEL_COMPLETION_PULSE_STABILITY_MAX,
        )));
        expect(movingTopCap).toHaveAttribute(
            'data-speed',
            resolveTravelingTopCapSpeed(0.3).toFixed(2),
        );
        expect(blinkStack.querySelector('animate')).toBeNull();

        const arcGlowSegment = screen.getAllByTestId('gauge-circular-arc-glow-segment')[0];
        expect(arcGlowSegment).toHaveStyle({ opacity: expectedArcGlowOpacity });
    });

    it('triggers the machine-activity fixed blink burst only after the traveling top cap completes its route', () => {
        vi.useFakeTimers();
        const animationFrames = createAnimationFrameController();
        const expectedProfile = resolveKpiFixedTopCapBlinkProfile('on-with-failures', KPI_FIXED_TOP_CAP_PULSE_INTENSITY_MAX, 72, 44, 0);
        const expectedBurstOpacities = expectedProfile.values.split(';');

        render(
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
                        fixedTopCapEffects: {
                            pulseSpeed: 72,
                            pulseIrregularity: 44,
                            pulseStability: 64,
                        },
                        travelingTopCapMinSpeed: 200,
                        travelingTopCapMaxSpeed: 200,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(0.3)}
            />,
        );

        const initialBlinkStack = within(screen.getByTestId('gauge-circular-static-top-cap'))
            .getByTestId('gauge-circular-static-top-cap-blink-stack');
        const movingTopCap = screen.getByTestId('gauge-circular-top-cap');
        const travelDurationMs = Number.parseFloat(movingTopCap.getAttribute('data-duration') ?? '0') * 1000;

        expect(initialBlinkStack).toHaveAttribute('data-blink-trigger-key', '0');
        expect(initialBlinkStack).toHaveAttribute('data-burst-active', 'false');
        expect(initialBlinkStack.querySelector('animate')).toBeNull();

        animationFrames.runNextFrame(1_000);

        act(() => {
            vi.advanceTimersByTime(Math.ceil(travelDurationMs) + 1);
        });

        const triggeredBlinkStack = within(screen.getByTestId('gauge-circular-static-top-cap'))
            .getByTestId('gauge-circular-static-top-cap-blink-stack');

        expect(screen.queryByTestId('gauge-circular-top-cap')).not.toBeInTheDocument();
        expect(triggeredBlinkStack).toHaveAttribute('data-blink-trigger-key', '1');
        expect(triggeredBlinkStack).toHaveAttribute('data-burst-active', 'true');
        expect(triggeredBlinkStack).toHaveAttribute('data-burst-key', '1');
        expect(triggeredBlinkStack).toHaveAttribute('data-burst-opacity', expectedBurstOpacities[1] ?? '1');
        expect(triggeredBlinkStack.querySelector('animate')).toBeNull();
    });

    it('keeps the machine-activity travel-completion blink inactive when pulse stability resolves to zero duration', () => {
        vi.useFakeTimers();
        const animationFrames = createAnimationFrameController();
        const inactiveProfile = resolveKpiFixedTopCapBlinkProfile('on-with-failures', KPI_FIXED_TOP_CAP_PULSE_INTENSITY_MAX, 72, 44, 0);
        const inactiveOpacity = inactiveProfile.values.split(';')[0] ?? '1';

        render(
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
                        fixedTopCapEffects: {
                            pulseSpeed: 72,
                            pulseIrregularity: 44,
                            pulseStability: 0,
                        },
                        travelingTopCapMinSpeed: 200,
                        travelingTopCapMaxSpeed: 200,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(0.3)}
            />,
        );

        const movingTopCap = screen.getByTestId('gauge-circular-top-cap');
        const travelDurationMs = Number.parseFloat(movingTopCap.getAttribute('data-duration') ?? '0') * 1000;

        animationFrames.runNextFrame(1_000);

        act(() => {
            vi.advanceTimersByTime(Math.ceil(travelDurationMs) + 1);
        });

        const blinkStack = within(screen.getByTestId('gauge-circular-static-top-cap'))
            .getByTestId('gauge-circular-static-top-cap-blink-stack');

        expect(screen.queryByTestId('gauge-circular-top-cap')).not.toBeInTheDocument();
        expect(blinkStack).toHaveAttribute('data-blink-trigger-key', '1');
        expect(blinkStack).toHaveAttribute('data-blink-duration', '0');
        expect(blinkStack).toHaveAttribute('data-burst-active', 'false');
        expect(blinkStack).toHaveAttribute('data-burst-opacity', inactiveOpacity);
        expect(blinkStack.querySelector('animate')).toBeNull();
    });

    it('keeps the fixed top-cap shape configurable while forcing machine-activity blink mode/intensity and traveling pill shape', () => {
        render(
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
                        fixedTopCapShape: {
                            pill: false,
                        },
                        fixedTopCapEffects: {
                            mode: 'off-with-flashes',
                            auraIntensity: 35,
                            haloIntensity: 45,
                            highlightIntensity: 55,
                            blur: 65,
                            extension: 75,
                            thickness: 85,
                            pulseIntensity: 28,
                            pulseSpeed: 72,
                            pulseStability: 64,
                        },
                        travelingTopCapShape: {
                            pill: false,
                        },
                        travelingTopCapEffects: {
                            auraIntensity: 10,
                            haloIntensity: 20,
                            highlightIntensity: 30,
                            blur: 40,
                            extension: 50,
                            thickness: 60,
                        },
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(0.3)}
            />,
        );

        const staticTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        const movingTopCap = screen.getByTestId('gauge-circular-top-cap');

        expect(staticTopCap).toHaveAttribute('data-shape-pill', 'false');
        expect(staticTopCap).toHaveAttribute('data-effect-aura', '35');
        expect(staticTopCap).toHaveAttribute('data-effect-extension', '75');
        expect(staticTopCap).toHaveAttribute('data-effect-blink-mode', 'on-with-failures');
        expect(staticTopCap).toHaveAttribute('data-effect-pulse-intensity', String(KPI_FIXED_TOP_CAP_PULSE_INTENSITY_MAX));
        expect(staticTopCap).toHaveAttribute('data-effect-pulse-speed', '72');
        expect(staticTopCap).toHaveAttribute('data-effect-pulse-stability', '64');
        expect(within(staticTopCap).getByTestId('gauge-circular-static-top-cap-blink-stack')).toHaveAttribute('data-blink-enabled', 'true');
        expect(within(staticTopCap).getByTestId('gauge-circular-static-top-cap-blink-stack').querySelector('animate')).toBeNull();
        expect(movingTopCap).toHaveAttribute('data-shape-pill', 'true');
        expect(movingTopCap).toHaveAttribute('data-effect-aura', '10');
        expect(movingTopCap).toHaveAttribute('data-effect-halo', '20');
        expect(movingTopCap).toHaveAttribute('data-effect-highlight', '30');
        expect(movingTopCap).toHaveAttribute('data-effect-blur', '40');
        expect(movingTopCap).toHaveAttribute('data-effect-extension', '50');
        expect(movingTopCap).toHaveAttribute('data-effect-thickness', '60');
        expect(movingTopCap).toHaveAttribute('data-effect-pulse-intensity', '0');
        expect(within(staticTopCap).getByTestId('gauge-circular-static-top-cap-core')).toHaveAttribute('rx', '0');
        expect(Number(within(movingTopCap).getByTestId('gauge-circular-top-cap-core').getAttribute('rx'))).toBeGreaterThan(0);
        expect(within(staticTopCap).getByTestId('gauge-circular-static-top-cap-aura').getAttribute('filter')).toMatch(/^url\(#.+-static-top-cap-glow\)$/);
        expect(within(movingTopCap).getByTestId('gauge-circular-top-cap-aura').getAttribute('filter')).toMatch(/^url\(#.+-traveling-top-cap-glow\)$/);
    });

    it('passes configured equal traveling top-cap speeds down to the gauge runtime without reintroducing the old duration floor', () => {
        render(
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 0.15,
                        unit: 'kW',
                        machineId: 101,
                        variableKey: 'activePower',
                        bindingVersion: 'node-red-v1',
                    },
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateAnimation: true,
                        travelingTopCapMinSpeed: 200,
                        travelingTopCapMaxSpeed: 200,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(0.15)}
            />,
        );

        const movingTopCap = screen.getByTestId('gauge-circular-top-cap');

        expect(movingTopCap).toHaveAttribute('data-speed', '200.00');
        expect(Number.parseFloat(movingTopCap.getAttribute('data-duration') ?? '0')).toBeCloseTo(0.28, 2);
        expect(Number.parseFloat(movingTopCap.getAttribute('data-duration') ?? '0')).toBeLessThan(0.9);
    });

    it('passes the machine-activity arc glow intensity through to the circular gauge runtime', () => {
        render(
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
                        showStateAnimation: true,
                        circularArcGlowIntensity: 0,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(0.3)}
            />,
        );

        expect(screen.getAllByTestId('gauge-circular-arc-segment').every((segment) => !segment.hasAttribute('filter'))).toBe(true);
        expect(screen.queryByTestId('gauge-circular-arc-glow')).not.toBeInTheDocument();
    });

    it('converts the stored 1..10 top-cap speed scale into actual gauge runtime speeds', () => {
        render(
            <MachineActivityWidget
                widget={makeWidget({
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 1,
                        unit: 'kW',
                        machineId: 101,
                        variableKey: 'activePower',
                        bindingVersion: 'node-red-v1',
                    },
                    displayOptions: {
                        kpiMode: 'circular',
                        showStateAnimation: true,
                        travelingTopCapMinSpeed: 1,
                        travelingTopCapMaxSpeed: 10,
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                        confirmationTime: 99999,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1)}
            />,
        );

        const movingTopCap = screen.getByTestId('gauge-circular-top-cap');

        expect(movingTopCap).toHaveAttribute('data-speed', '400.00');
    });
});
