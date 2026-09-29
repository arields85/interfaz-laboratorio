import '@testing-library/jest-dom/vitest';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContractMachine } from '../../domain/dataContract.types';
import type { KpiWidgetConfig, MachineActivityWidgetConfig, MetricCardWidgetConfig } from '../../domain/admin.types';
import { ViewerEntranceContext } from '../../hooks/useViewerEntranceCountUp';
import { installEntranceClock, stubReducedMotion } from '../../test/entranceClock';
import KpiWidget from './KpiWidget';
import MachineActivityWidget from './MachineActivityWidget';
import MetricWidget from './MetricWidget';

// The main value of kpi, metric-card and machine-activity counts up from zero on viewer entrance.
// Tokens and clock come from `test/entranceClock.ts`: delay = 700ms * order + 100ms (order 0 -> 100ms),
// duration 1000ms. Outside `ViewerEntranceContext` (builder, other suites) the final value shows at once.

let clock: ReturnType<typeof installEntranceClock>;

beforeEach(() => {
    clock = installEntranceClock();
});

afterEach(() => {
    clock.restore();
});

function inViewer(element: ReactElement, order = 0) {
    return <ViewerEntranceContext.Provider value={order}>{element}</ViewerEntranceContext.Provider>;
}

function machinesWith(value: number | null): ContractMachine[] {
    return [{
        unitId: 101,
        name: 'Extrusora 101',
        status: 'online',
        lastSuccess: '2026-04-23T22:00:00.000Z',
        ageMs: 0,
        values: { activePower: { value, unit: 'kW', timestamp: '2026-04-23T22:00:00.000Z' } },
    }];
}

const kpiWidget: KpiWidgetConfig = {
    id: 'kpi-1',
    type: 'kpi',
    title: 'Potencia',
    position: { x: 0, y: 0 },
    size: { w: 2, h: 2 },
    binding: { mode: 'real_variable', bindingVersion: 'node-red-v1', machineId: 101, variableKey: 'activePower', unit: 'kW' },
    displayOptions: { kpiMode: 'circular', min: 0, max: 100 },
};

function kpiText(container: HTMLElement): string {
    return container.querySelector('span.text-white')?.textContent ?? '';
}

function renderKpi(widget: KpiWidgetConfig, value: number | null, viewer = true) {
    const element = <KpiWidget widget={widget} equipmentMap={new Map()} machines={machinesWith(value)} />;
    return viewer ? inViewer(element) : element;
}

describe('KpiWidget entrance count-up', () => {
    it('shows the final value at once outside the viewer', () => {
        const { container } = render(renderKpi(kpiWidget, 72.4, false));

        expect(kpiText(container)).toBe('72.4');
    });

    it('counts up from zero to the exact formatted value inside the viewer', () => {
        const { container } = render(renderKpi(kpiWidget, 72.4));

        expect(kpiText(container)).toBe('0');
        clock.advance(500);
        const mid = Number(kpiText(container));
        expect(mid).toBeGreaterThan(0);
        expect(mid).toBeLessThan(72.4);
        // Intermediate values keep the target's decimals (one), never a longer tail.
        expect(kpiText(container)).toMatch(/^\d+(\.\d)?$/);

        clock.advance(3000);
        expect(kpiText(container)).toBe('72.4');
    });

    it('does not replay on a data refresh: the value glides from where it was, never from zero', () => {
        const { container, rerender } = render(renderKpi(kpiWidget, 72.4));
        clock.advance(3000);
        expect(kpiText(container)).toBe('72.4');

        rerender(renderKpi(kpiWidget, 80));
        clock.advance(16);

        expect(Number(kpiText(container))).toBeGreaterThan(72);
        clock.advance(3000);
        expect(kpiText(container)).toBe('80');
    });

    it('counts up when the first value arrives during the entrance window', () => {
        const { container, rerender } = render(renderKpi(kpiWidget, null));
        expect(kpiText(container)).toBe('--');
        clock.advance(300);

        rerender(renderKpi(kpiWidget, 50));
        expect(kpiText(container)).toBe('0');
        clock.advance(500);
        expect(Number(kpiText(container))).toBeGreaterThan(0);
        expect(Number(kpiText(container))).toBeLessThan(50);

        clock.advance(2000);
        expect(kpiText(container)).toBe('50');
    });

    it('shows a value that arrives after the entrance window directly', () => {
        const { container, rerender } = render(renderKpi(kpiWidget, null));
        clock.advance(2000);

        rerender(renderKpi(kpiWidget, 50));

        expect(kpiText(container)).toBe('50');
    });

    it('counts the bar mode text as well, and shows the final value with reduced motion', () => {
        const barWidget: KpiWidgetConfig = { ...kpiWidget, displayOptions: { kpiMode: 'bar', min: 0, max: 100 } };
        const { container, unmount } = render(renderKpi(barWidget, 60));
        expect(kpiText(container)).toBe('0');
        clock.advance(3000);
        expect(kpiText(container)).toBe('60');
        unmount();

        stubReducedMotion();
        const reduced = render(renderKpi(barWidget, 60));
        expect(kpiText(reduced.container)).toBe('60');
    });
});

const metricWidget = {
    id: 'metric-1',
    type: 'metric-card',
    title: 'Power',
    position: { x: 0, y: 0 },
    size: { w: 2, h: 2 },
    binding: { mode: 'real_variable', assetId: 'missing-asset', unit: 'kW' },
    displayOptions: {},
} as MetricCardWidgetConfig;

function renderMetric(value: number | string, viewer = true) {
    const binding = { value, unit: 'kW', status: 'normal' as const, source: 'real' as const };
    const element = (
        <MetricWidget
            widget={metricWidget}
            equipmentMap={new Map()}
            presentationData={{ binding, value, unit: 'kW', status: 'normal', source: 'real' }}
        />
    );
    return viewer ? inViewer(element) : element;
}

function metricValueText(): string {
    return screen.getByTestId('metric-card-value-row').childNodes[0].textContent ?? '';
}

describe('MetricWidget entrance count-up', () => {
    it('shows the final value at once outside the viewer', () => {
        render(renderMetric(42, false));

        expect(metricValueText()).toBe('42');
    });

    it('counts up from zero keeping the unit and the value decimals', () => {
        render(renderMetric(12.5));

        expect(metricValueText()).toBe('0');
        expect(screen.getByText('kW')).toBeInTheDocument();
        clock.advance(600);
        expect(metricValueText()).toMatch(/^\d+(\.\d)?$/);
        expect(Number(metricValueText())).toBeGreaterThan(0);
        expect(Number(metricValueText())).toBeLessThan(12.5);

        clock.advance(3000);
        expect(metricValueText()).toBe('12.5');
    });

    it('does not replay on a data refresh', () => {
        const { rerender } = render(renderMetric(42));
        clock.advance(3000);

        rerender(renderMetric(45));

        expect(metricValueText()).toBe('45');
        expect(clock.pendingFrames()).toBe(0);
    });

    it('leaves non-numeric values untouched (no count-up on strings)', () => {
        render(renderMetric('OK'));

        expect(metricValueText()).toBe('OK');
    });

    it('shows the final value at once with reduced motion', () => {
        stubReducedMotion();
        render(renderMetric(42));

        expect(metricValueText()).toBe('42');
    });
});

const machineActivityWidget: MachineActivityWidgetConfig = {
    id: 'machine-activity-1',
    type: 'machine-activity',
    title: 'Actividad de Máquina',
    position: { x: 0, y: 0 },
    size: { w: 2, h: 2 },
    binding: { mode: 'real_variable', bindingVersion: 'node-red-v1', machineId: 101, variableKey: 'activePower', unit: 'kW' },
    displayOptions: { kpiMode: 'circular', showStateSubtitle: true, showPowerSubtext: true, showDynamicColor: true, showStateAnimation: true },
};

function renderActivity(widget: MachineActivityWidgetConfig, activityIndex: number, isValid = true, viewer = true) {
    const element = (
        <MachineActivityWidget
            widget={widget}
            equipmentMap={new Map()}
            presentationData={{
                resolved: { value: isValid ? activityIndex / 100 : null, unit: 'kW', status: 'normal', source: 'real' },
                activity: {
                    activityIndex,
                    productiveState: 'producing',
                    stateLabel: 'Produciendo',
                    stateVisuals: {
                        primary: 'var(--color-status-normal)',
                        gradientColors: ['var(--color-status-normal)', 'var(--color-status-normal)'],
                        glowColor: 'var(--color-status-normal)',
                        animationDuration: 500,
                    },
                    smoothedPower: activityIndex / 100,
                    rawPower: activityIndex / 100,
                    isValid,
                },
                provenance: 'central-read-only',
            }}
        />
    );
    return viewer ? inViewer(element) : element;
}

function activityText(container: HTMLElement, mode: 'circular' | 'bar'): string {
    return container.querySelector(mode === 'circular' ? 'text.text-white' : 'span.text-white')?.textContent ?? '';
}

describe('MachineActivityWidget entrance count-up', () => {
    it('shows the final index at once outside the viewer', () => {
        const { container } = render(renderActivity(machineActivityWidget, 64, true, false));

        expect(activityText(container, 'circular')).toBe('64');
    });

    it('counts the rounded index up from zero in circular and bar modes', () => {
        for (const mode of ['circular', 'bar'] as const) {
            const widget: MachineActivityWidgetConfig = {
                ...machineActivityWidget,
                displayOptions: { ...machineActivityWidget.displayOptions, kpiMode: mode },
            };
            const { container, unmount } = render(renderActivity(widget, 64));

            expect(activityText(container, mode)).toBe('0');
            clock.advance(600);
            expect(activityText(container, mode)).toMatch(/^\d+$/);
            expect(Number(activityText(container, mode))).toBeGreaterThan(0);
            expect(Number(activityText(container, mode))).toBeLessThan(64);

            clock.advance(3000);
            expect(activityText(container, mode)).toBe('64');
            unmount();
        }
    });

    it('counts up a value that arrives late in the window, and never replays afterwards', () => {
        const { container, rerender } = render(renderActivity(machineActivityWidget, 0, false));
        expect(activityText(container, 'circular')).toBe('--');
        clock.advance(300);

        rerender(renderActivity(machineActivityWidget, 64));
        clock.advance(500);
        expect(Number(activityText(container, 'circular'))).toBeGreaterThan(0);
        expect(Number(activityText(container, 'circular'))).toBeLessThan(64);

        clock.advance(3000);
        expect(activityText(container, 'circular')).toBe('64');

        rerender(renderActivity(machineActivityWidget, 64));
        expect(activityText(container, 'circular')).toBe('64');
    });

    it('shows the final index at once with reduced motion', () => {
        stubReducedMotion();
        const { container } = render(renderActivity(machineActivityWidget, 64));

        expect(activityText(container, 'circular')).toBe('64');
    });
});
