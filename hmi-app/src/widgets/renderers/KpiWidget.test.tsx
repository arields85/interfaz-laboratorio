import '@testing-library/jest-dom/vitest';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractMachine } from '../../domain/dataContract.types';
import type { KpiWidgetConfig } from '../../domain/admin.types';
import { STATIC_TOP_CAP_FULL_INTENSITY_PROGRESS } from '../../components/ui/GaugeDisplay';
import { DEFAULT_GAUGE_VALUE_FONT_SIZE } from '../../utils/activityAnalyticsWidgetDefaults';
import {
    DEFAULT_CIRCULAR_ARC_GLOW_INTENSITY,
    DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS,
    DEFAULT_KPI_FIXED_TOP_CAP_SHAPE,
    DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS,
    DEFAULT_KPI_TRAVELING_TOP_CAP_SHAPE,
    FIXED_TOP_CAP_TRAVEL_COMPLETION_PULSE_STABILITY_MAX,
    KPI_FIXED_TOP_CAP_PULSE_INTENSITY_MAX,
    resolveFixedTopCapTravelCompletionBlinkDurationSeconds,
    resolveKpiFixedTopCapEffects,
} from '../../utils/kpiTopCapEffects';
import { resolveTravelingTopCapSpeed } from '../../utils/travelingTopCapSpeed';
import KpiWidget from './KpiWidget';

const equipmentMap = new Map();
const CIRCULAR_RADIUS = 60;
const CIRCUMFERENCE = 2 * Math.PI * CIRCULAR_RADIUS;
const SEGMENT_COUNT = 90;
const SEGMENT_OVERLAP = 0.75;

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

function getShapeCenter(element: Element) {
    if (element.tagName.toLowerCase() === 'rect') {
        return {
            x: Number(element.getAttribute('x')) + (Number(element.getAttribute('width')) / 2),
            y: Number(element.getAttribute('y')) + (Number(element.getAttribute('height')) / 2),
        };
    }

    return {
        x: (Number(element.getAttribute('x1')) + Number(element.getAttribute('x2'))) / 2,
        y: (Number(element.getAttribute('y1')) + Number(element.getAttribute('y2'))) / 2,
    };
}

function resolveKpiVisualAnimationDuration(delta: number) {
    const normalizedDelta = Math.min(Math.abs(delta), 100);

    return Math.round(280 + (normalizedDelta * 7.2));
}

function formatDisplayedKpiValue(value: number) {
    return value % 1 !== 0 ? value.toFixed(1) : String(value);
}

describe('KpiWidget', () => {
    let mediaQueryMatches = false;
    let animationFrameId = 0;
    let animationFrameCallbacks = new Map<number, FrameRequestCallback>();

    beforeEach(() => {
        vi.useFakeTimers();
        mediaQueryMatches = false;
        animationFrameId = 0;
        animationFrameCallbacks = new Map<number, FrameRequestCallback>();

        vi.spyOn(performance, 'now').mockReturnValue(1_000);
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
            animationFrameId += 1;
            animationFrameCallbacks.set(animationFrameId, callback);
            return animationFrameId;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
            animationFrameCallbacks.delete(id);
        }));
        vi.stubGlobal('matchMedia', vi.fn(() => ({
            matches: mediaQueryMatches,
            media: '(prefers-reduced-motion: reduce)',
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    function runNextAnimationFrame(now: number) {
        const nextFrame = Array.from(animationFrameCallbacks.entries()).at(-1);

        expect(nextFrame).toBeDefined();

        const [frameId, callback] = nextFrame!;
        animationFrameCallbacks.delete(frameId);

        act(() => {
            callback(now);
        });
    }

    function runPendingAnimationFrames(now: number) {
        const pendingFrames = Array.from(animationFrameCallbacks.entries());

        expect(pendingFrames.length).toBeGreaterThan(0);

        animationFrameCallbacks.clear();

        act(() => {
            pendingFrames.forEach(([, callback]) => {
                callback(now);
            });
        });
    }

    function expectCircularTweenSync(startValue: number, targetValue: number) {
        const delta = targetValue - startValue;
        const duration = resolveKpiVisualAnimationDuration(delta);
        const halfProgressValue = startValue + (delta * (1 - Math.pow(1 - 0.5, 2)));
        const expectedNormalized = halfProgressValue / 100;
        const expectedAngle = expectedNormalized * 360;

        const { rerender } = render(
            <KpiWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'circular',
                        min: 0,
                        max: 100,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(startValue)}
            />,
        );

        expect(screen.getByText(String(startValue))).toBeInTheDocument();
        vi.mocked(requestAnimationFrame).mockClear();
        animationFrameCallbacks.clear();

        rerender(
            <KpiWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'circular',
                        min: 0,
                        max: 100,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(targetValue)}
            />,
        );

        expect(requestAnimationFrame).toHaveBeenCalled();

        runPendingAnimationFrames(1_000 + (duration / 2));

        expect(screen.getByText(formatDisplayedKpiValue(halfProgressValue))).toBeInTheDocument();
        expect(screen.queryByText(String(startValue))).not.toBeInTheDocument();
        expect(Number(screen.getByTestId('gauge-circular-static-top-cap').getAttribute('data-cap-angle'))).toBeCloseTo(expectedAngle, 2);
        expect(Number(screen.getByTestId('gauge-circular-static-top-cap').getAttribute('data-cap-angle')) / 360).toBeCloseTo(expectedNormalized, 2);
    }

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
        expect(screen.getByText('Potencia')).toBeInTheDocument();
        expect(container.querySelector('.text-status-normal')).toBeInTheDocument();
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
        expect(screen.getByTestId('gauge-circular-static-top-cap')).toBeInTheDocument();
        const movingTopCap = screen.getByTestId('gauge-circular-top-cap');
        const staticTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        expect(movingTopCap).toBeInTheDocument();
        expect(movingTopCap).not.toHaveAttribute('data-route-step');
        expect(movingTopCap).not.toHaveAttribute('data-route-count');
        expect(screen.getAllByTestId('gauge-circular-arc-segment')[0]).toHaveAttribute('stroke-linecap', 'butt');

        const topCapCore = within(movingTopCap).getByTestId('gauge-circular-top-cap-core');
        const firstSegment = screen.getAllByTestId('gauge-circular-arc-segment')[0];
        const expectedFullCircleSegmentLength = (CIRCUMFERENCE / SEGMENT_COUNT) + SEGMENT_OVERLAP;
        const expectedVisibleArcLength = 0.11 * CIRCUMFERENCE;
        const expectedStaticCapAngleDegrees = (expectedVisibleArcLength * 360) / CIRCUMFERENCE;
        const expectedStaticCapX = 70 + (Math.cos((expectedStaticCapAngleDegrees * Math.PI) / 180) * CIRCULAR_RADIUS);
        const expectedStaticCapY = 70 + (Math.sin((expectedStaticCapAngleDegrees * Math.PI) / 180) * CIRCULAR_RADIUS);

        expect(movingTopCap).toHaveAttribute('data-progress', '0.0000');
        expect(topCapCore.tagName.toLowerCase()).toBe('rect');
        expect(getShapeCenter(topCapCore).x).toBeCloseTo(Number(movingTopCap.getAttribute('data-cap-x')), 2);
        expect(getShapeCenter(topCapCore).y).toBeCloseTo(Number(movingTopCap.getAttribute('data-cap-y')), 2);
        expect(staticTopCap).toHaveAttribute('data-intensity-progress', String(STATIC_TOP_CAP_FULL_INTENSITY_PROGRESS));
        expect(Number(staticTopCap.getAttribute('data-cap-angle'))).toBeCloseTo(expectedStaticCapAngleDegrees, 2);
        expect(Number(staticTopCap.getAttribute('data-cap-x'))).toBeCloseTo(expectedStaticCapX, 2);
        expect(Number(staticTopCap.getAttribute('data-cap-y'))).toBeCloseTo(expectedStaticCapY, 2);
        expect(within(staticTopCap).queryByTestId('gauge-circular-static-top-cap-base')).not.toBeInTheDocument();
        expect(Number(staticTopCap.getAttribute('data-cap-length'))).toBeCloseTo(4, 2);
        expect(Number(staticTopCap.getAttribute('data-cap-thickness'))).toBeCloseTo(8, 2);
        expect(firstSegment).toHaveAttribute(
            'stroke-dasharray',
            `${expectedFullCircleSegmentLength} ${CIRCUMFERENCE - expectedFullCircleSegmentLength}`,
        );
    });

    it('animates 20 to 80 with synced circular number and arc', () => {
        expectCircularTweenSync(20, 80);
    });

    it('animates 80 to 20 with synced circular number and arc', () => {
        expectCircularTweenSync(80, 20);
    });

    it('animates 60 to 0 as a normal circular tween', () => {
        expectCircularTweenSync(60, 0);
    });

    it('animates 0 to 60 as a normal circular tween', () => {
        expectCircularTweenSync(0, 60);
    });

    it('skips circular KPI tweening under reduced motion and jumps straight to the target value', () => {
        mediaQueryMatches = true;

        const { rerender } = render(
            <KpiWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'circular',
                        min: 0,
                        max: 100,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(0)}
            />,
        );

        expect(screen.getByText('0')).toBeInTheDocument();

        rerender(
            <KpiWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'circular',
                        min: 0,
                        max: 100,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(60)}
            />,
        );

        expect(requestAnimationFrame).not.toHaveBeenCalled();
        expect(screen.getByText('60')).toBeInTheDocument();
        expect(screen.queryByText('0')).not.toBeInTheDocument();
        expect(screen.getByTestId('gauge-circular-static-top-cap')).toHaveAttribute('data-cap-angle', '216.00');
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

    it('passes fixed top-cap effects to the static circular cap while ignoring legacy base rect rendering', () => {
        render(
            <KpiWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'circular',
                        min: 0,
                        max: 10,
                        fixedTopCapBase: {
                            length: 75,
                            thickness: 20,
                            alpha: 45,
                        },
                        fixedTopCapEffects: {
                            ...DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS,
                            auraIntensity: 35,
                            haloIntensity: 45,
                            highlightIntensity: 55,
                            blur: 65,
                            extension: 75,
                            thickness: 85,
                        },
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1.1)}
            />,
        );

        const staticTopCap = screen.getByTestId('gauge-circular-static-top-cap');

        expect(staticTopCap).toHaveAttribute('data-effect-aura', '35');
        expect(staticTopCap).toHaveAttribute('data-effect-halo', '45');
        expect(staticTopCap).toHaveAttribute('data-effect-highlight', '55');
        expect(staticTopCap).toHaveAttribute('data-effect-blur', '65');
        expect(staticTopCap).toHaveAttribute('data-effect-extension', '75');
        expect(staticTopCap).toHaveAttribute('data-effect-thickness', '85');
        expect(within(staticTopCap).queryByTestId('gauge-circular-static-top-cap-base')).not.toBeInTheDocument();
        expect(Number(staticTopCap.getAttribute('data-cap-length'))).toBeCloseTo(4, 2);
        expect(Number(staticTopCap.getAttribute('data-cap-thickness'))).toBeCloseTo(8, 2);
    });

    it('passes isolated traveling top-cap effects to the moving circular cap', () => {
        render(
            <KpiWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'circular',
                        min: 0,
                        max: 10,
                        fixedTopCapBase: {
                            length: 75,
                            thickness: 20,
                            alpha: 45,
                        },
                        fixedTopCapEffects: {
                            ...DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS,
                            auraIntensity: 35,
                            haloIntensity: 45,
                            highlightIntensity: 55,
                            blur: 65,
                            extension: 75,
                            thickness: 85,
                        },
                        travelingTopCapEffects: {
                            ...DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS,
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
                machines={makeMachines(1.1)}
            />,
        );

        const staticTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        const movingTopCap = screen.getByTestId('gauge-circular-top-cap');

        expect(staticTopCap).toHaveAttribute('data-effect-aura', '35');
        expect(staticTopCap).toHaveAttribute('data-effect-extension', '75');
        expect(movingTopCap).toHaveAttribute('data-effect-aura', '10');
        expect(movingTopCap).toHaveAttribute('data-effect-halo', '20');
        expect(movingTopCap).toHaveAttribute('data-effect-highlight', '30');
        expect(movingTopCap).toHaveAttribute('data-effect-blur', '40');
        expect(movingTopCap).toHaveAttribute('data-effect-extension', '50');
        expect(movingTopCap).toHaveAttribute('data-effect-thickness', '60');
        expect(within(staticTopCap).getByTestId('gauge-circular-static-top-cap-aura').getAttribute('filter')).toMatch(/^url\(#.+-static-top-cap-glow\)$/);
        expect(within(movingTopCap).getByTestId('gauge-circular-top-cap-aura').getAttribute('filter')).toMatch(/^url\(#.+-traveling-top-cap-glow\)$/);
    });

    it('forces legacy KPI fixed blink mode/intensity to the simplified travel-completion runtime contract while preserving speed/irregularity/stability as duration', () => {
        render(
            <KpiWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'circular',
                        min: 0,
                        max: 10,
                        circularArcGlowIntensity: 0,
                        travelingTopCapMinSpeed: 1,
                        travelingTopCapMaxSpeed: 10,
                        fixedTopCapEffects: {
                            ...DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS,
                            mode: 'off-with-flashes',
                            pulseIntensity: 0,
                            pulseSpeed: 61,
                            pulseIrregularity: 47,
                            pulseStability: 700,
                        },
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1.1)}
            />,
        );

        const staticBlinkStack = screen.getByTestId('gauge-circular-static-top-cap-blink-stack');
        const movingTopCap = screen.getByTestId('gauge-circular-top-cap');

        expect(screen.getAllByTestId('gauge-circular-arc-segment').every((segment) => !segment.hasAttribute('filter'))).toBe(true);
        expect(staticBlinkStack).toHaveAttribute('data-blink-mode', 'on-with-failures');
        expect(staticBlinkStack).toHaveAttribute('data-blink-intensity', String(KPI_FIXED_TOP_CAP_PULSE_INTENSITY_MAX));
        expect(staticBlinkStack).toHaveAttribute('data-blink-speed', '61');
        expect(staticBlinkStack).toHaveAttribute('data-blink-irregularity', '47');
        expect(staticBlinkStack).toHaveAttribute('data-blink-stability', '700');
        expect(staticBlinkStack).toHaveAttribute('data-blink-trigger', 'travel-completion');
        expect(staticBlinkStack).toHaveAttribute('data-blink-duration', String(resolveFixedTopCapTravelCompletionBlinkDurationSeconds(
            FIXED_TOP_CAP_TRAVEL_COMPLETION_PULSE_STABILITY_MAX,
            FIXED_TOP_CAP_TRAVEL_COMPLETION_PULSE_STABILITY_MAX,
        )));
        expect(staticBlinkStack).toHaveAttribute('data-burst-active', 'false');
        expect(staticBlinkStack.querySelector('animate')).toBeNull();
        expect(movingTopCap).toHaveAttribute(
            'data-speed',
            resolveTravelingTopCapSpeed(0.11, { min: 50, max: 400 }).toFixed(2),
        );

        const travelDurationMs = Number.parseFloat(movingTopCap.getAttribute('data-duration') ?? '0') * 1000;

        act(() => {
            vi.advanceTimersByTime(Math.ceil(travelDurationMs) + 1);
        });

        expect(screen.getByTestId('gauge-circular-static-top-cap-blink-stack')).toHaveAttribute('data-burst-active', 'true');
    });

    it('keeps KPI fixed top-cap duration at zero with legacy zero stability so traveling completion does not create a visible burst', () => {
        render(
            <KpiWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'circular',
                        min: 0,
                        max: 10,
                        fixedTopCapEffects: {
                            ...DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS,
                            pulseStability: 0,
                        },
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1.1)}
            />,
        );

        const movingTopCap = screen.getByTestId('gauge-circular-top-cap');
        const travelDurationMs = Number.parseFloat(movingTopCap.getAttribute('data-duration') ?? '0') * 1000;

        act(() => {
            vi.advanceTimersByTime(Math.ceil(travelDurationMs) + 1);
        });

        const staticBlinkStack = screen.getByTestId('gauge-circular-static-top-cap-blink-stack');

        expect(staticBlinkStack).toHaveAttribute('data-blink-trigger', 'travel-completion');
        expect(staticBlinkStack).toHaveAttribute('data-blink-duration', '0');
        expect(staticBlinkStack).toHaveAttribute('data-burst-active', 'false');
    });

    it('enables simplified fixed blink defaults for KPI circular widgets when legacy configs omit mode and intensity', () => {
        render(
            <KpiWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'circular',
                        min: 0,
                        max: 10,
                        fixedTopCapEffects: {
                            pulseSpeed: 72,
                            pulseIrregularity: 44,
                        },
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1.1)}
            />,
        );

        const staticBlinkStack = screen.getByTestId('gauge-circular-static-top-cap-blink-stack');

        expect(staticBlinkStack).toHaveAttribute('data-blink-mode', 'on-with-failures');
        expect(staticBlinkStack).toHaveAttribute('data-blink-intensity', String(KPI_FIXED_TOP_CAP_PULSE_INTENSITY_MAX));
        expect(staticBlinkStack).toHaveAttribute('data-blink-speed', '72');
        expect(staticBlinkStack).toHaveAttribute('data-blink-irregularity', '44');
        expect(staticBlinkStack).toHaveAttribute('data-blink-enabled', 'true');
        expect(staticBlinkStack).toHaveAttribute('data-blink-trigger', 'travel-completion');
        expect(staticBlinkStack).toHaveAttribute('data-blink-trigger-key', '0');
        expect(staticBlinkStack).toHaveAttribute('data-blink-duration', String(resolveFixedTopCapTravelCompletionBlinkDurationSeconds(
            DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS.pulseStability,
            FIXED_TOP_CAP_TRAVEL_COMPLETION_PULSE_STABILITY_MAX,
        )));
        expect(staticBlinkStack).toHaveAttribute('data-burst-active', 'false');
        expect(staticBlinkStack.querySelector('animate')).toBeNull();
    });

    it('uses requested circular defaults when KPI display options omit top-cap and arc glow values', () => {
        const expectedFixedTopCapEffects = resolveKpiFixedTopCapEffects();
        const expectedArcGlowOpacity = String(Number((DEFAULT_CIRCULAR_ARC_GLOW_INTENSITY / 100).toFixed(2)));

        render(
            <KpiWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
                machines={makeMachines(1.1)}
            />,
        );

        const staticTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        const movingTopCap = screen.getByTestId('gauge-circular-top-cap');
        const blinkStack = within(staticTopCap).getByTestId('gauge-circular-static-top-cap-blink-stack');
        const arcGlowSegment = screen.getAllByTestId('gauge-circular-arc-glow-segment')[0];

        expect(staticTopCap).toHaveAttribute('data-shape-pill', 'true');
        expect(staticTopCap).toHaveAttribute('data-effect-aura', String(expectedFixedTopCapEffects.auraIntensity));
        expect(staticTopCap).toHaveAttribute('data-effect-halo', String(expectedFixedTopCapEffects.haloIntensity));
        expect(staticTopCap).toHaveAttribute('data-effect-blur', String(expectedFixedTopCapEffects.blur));
        expect(staticTopCap).toHaveAttribute('data-effect-extension', String(expectedFixedTopCapEffects.extension));
        expect(staticTopCap).toHaveAttribute('data-effect-thickness', String(expectedFixedTopCapEffects.thickness));
        expect(staticTopCap).toHaveAttribute('data-effect-pulse-speed', String(expectedFixedTopCapEffects.pulseSpeed));
        expect(staticTopCap).toHaveAttribute('data-effect-pulse-irregularity', String(expectedFixedTopCapEffects.pulseIrregularity));
        expect(staticTopCap).toHaveAttribute('data-effect-pulse-stability', String(expectedFixedTopCapEffects.pulseStability));
        expect(blinkStack).toHaveAttribute('data-blink-duration', String(resolveFixedTopCapTravelCompletionBlinkDurationSeconds(
            expectedFixedTopCapEffects.pulseStability,
            FIXED_TOP_CAP_TRAVEL_COMPLETION_PULSE_STABILITY_MAX,
        )));
        expect(movingTopCap).toHaveAttribute(
            'data-speed',
            resolveTravelingTopCapSpeed(0.11).toFixed(2),
        );
        expect(arcGlowSegment).toHaveStyle({ opacity: expectedArcGlowOpacity });
    });

    it('keeps the fixed top-cap shape configurable while forcing the traveling top cap to pill', () => {
        render(
            <KpiWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'circular',
                        min: 0,
                        max: 10,
                        fixedTopCapBase: {
                            length: 0,
                            thickness: 0,
                            alpha: 45,
                        },
                        fixedTopCapShape: {
                            ...DEFAULT_KPI_FIXED_TOP_CAP_SHAPE,
                            pill: true,
                        },
                        fixedTopCapEffects: DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS,
                        travelingTopCapShape: {
                            ...DEFAULT_KPI_TRAVELING_TOP_CAP_SHAPE,
                            pill: false,
                        },
                        travelingTopCapEffects: DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1.1)}
            />,
        );

        const staticTopCap = screen.getByTestId('gauge-circular-static-top-cap');
        const staticAura = within(staticTopCap).getByTestId('gauge-circular-static-top-cap-aura');
        const movingTopCap = screen.getByTestId('gauge-circular-top-cap');
        const movingAura = within(movingTopCap).getByTestId('gauge-circular-top-cap-aura');

        expect(staticTopCap).toHaveAttribute('data-shape-pill', 'true');
        expect(movingTopCap).toHaveAttribute('data-shape-pill', 'true');
        expect(within(staticTopCap).queryByTestId('gauge-circular-static-top-cap-base')).not.toBeInTheDocument();
        expect(Number(staticAura.getAttribute('rx'))).toBeGreaterThan(0);
        expect(Number(movingAura.getAttribute('rx'))).toBeGreaterThan(0);
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

    it('uses the per-widget numeric value size override and falls back to 60 when absent', () => {
        const { rerender } = render(
            <KpiWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'circular',
                        min: 0,
                        max: 10,
                        valueFontSize: 72,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1.1)}
            />,
        );

        expect(screen.getByText('1.1')).toHaveStyle({
            fontSize: '72px',
        });
        expect(screen.getByText('kW')).toHaveStyle({
            fontSize: 'var(--font-size-widget-unit-gauge)',
        });

        rerender(
            <KpiWidget
                widget={makeWidget({
                    displayOptions: {
                        kpiMode: 'bar',
                        min: 0,
                        max: 10,
                    },
                })}
                equipmentMap={equipmentMap}
                machines={makeMachines(1.1)}
            />,
        );

        expect(screen.getByText('1.1')).toHaveStyle({
            fontSize: `${DEFAULT_GAUGE_VALUE_FONT_SIZE}px`,
        });
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
