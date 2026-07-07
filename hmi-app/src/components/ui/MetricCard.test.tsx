import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HierarchyAggregationTrace } from '../../widgets/resolvers/hierarchyResolver';
import MetricCard from './MetricCard';

type RegionName = 'metric-card-header' | 'metric-card-value-row' | 'metric-card-footer' | 'metric-card-card';

type MeasurementProfile = {
    clientHeight?: number;
    offsetHeight?: number;
    compactOffsetHeight?: number;
};

class MockResizeObserver implements ResizeObserver {
    static instances: MockResizeObserver[] = [];

    readonly observedElements = new Set<Element>();

    constructor(private readonly callback: ResizeObserverCallback) {
        MockResizeObserver.instances.push(this);
    }

    observe = (target: Element) => {
        this.observedElements.add(target);
    };

    unobserve = (target: Element) => {
        this.observedElements.delete(target);
    };

    disconnect = () => {
        this.observedElements.clear();
    };

    trigger() {
        this.callback([], this);
    }

    static triggerAll() {
        for (const instance of MockResizeObserver.instances) {
            instance.trigger();
        }
    }

    static reset() {
        MockResizeObserver.instances = [];
    }
}

const originalResizeObserver = globalThis.ResizeObserver;
const originalGetComputedStyle = window.getComputedStyle;
const measurementProfiles = new Map<RegionName, MeasurementProfile>();

function setMeasurementProfile(region: RegionName, profile: MeasurementProfile) {
    measurementProfiles.set(region, profile);
}

function getRegionName(element: Element): RegionName | null {
    const testId = element.getAttribute('data-testid');

    if (testId === 'metric-card-header' || testId === 'metric-card-value-row' || testId === 'metric-card-footer') {
        return testId;
    }

    if (element.classList.contains('glass-panel') || element.classList.contains('widget-state-warning') || element.classList.contains('widget-state-critical')) {
        return 'metric-card-card';
    }

    return null;
}

function isCompactMetricCardElement(element: Element): boolean {
    return element.closest('[data-testid="metric-card-content"]')?.className.includes('mt-1.5') ?? false;
}

beforeEach(() => {
    measurementProfiles.clear();
    MockResizeObserver.reset();
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

    setMeasurementProfile('metric-card-card', { clientHeight: 320 });
    setMeasurementProfile('metric-card-header', { offsetHeight: 40 });
    setMeasurementProfile('metric-card-value-row', { offsetHeight: 32, compactOffsetHeight: 32 });
    setMeasurementProfile('metric-card-footer', { offsetHeight: 20, compactOffsetHeight: 20 });

    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function clientHeightMock(this: HTMLElement) {
        const region = getRegionName(this);
        return region ? measurementProfiles.get(region)?.clientHeight ?? 0 : 0;
    });

    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function offsetHeightMock(this: HTMLElement) {
        const region = getRegionName(this);

        if (!region) {
            return 0;
        }

        const profile = measurementProfiles.get(region);

        if (!profile) {
            return 0;
        }

        if (isCompactMetricCardElement(this)) {
            return profile.compactOffsetHeight ?? profile.offsetHeight ?? 0;
        }

        return profile.offsetHeight ?? 0;
    });

    vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => {
        const computedStyle = originalGetComputedStyle(element);

        return {
            ...computedStyle,
            paddingTop: '20px',
            paddingBottom: '20px',
            getPropertyValue: (property: string) => {
                if (property === 'padding-top') {
                    return '20px';
                }

                if (property === 'padding-bottom') {
                    return '20px';
                }

                return computedStyle.getPropertyValue(property);
            },
        } as CSSStyleDeclaration;
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    globalThis.ResizeObserver = originalResizeObserver;
});

const resolvedTrace: HierarchyAggregationTrace = {
    resolved: { value: 30, unit: '°C', status: 'normal', source: 'real' },
    state: 'resolved',
    catalogVariableId: 'cv-temperature',
    aggregation: 'sum',
    descendantNodeCount: 3,
    scannedDashboardCount: 2,
    included: [
        {
            nodeId: 'node-a',
            nodeName: 'Línea A',
            dashboardId: 'dashboard-a',
            dashboardName: 'Dashboard A',
            widgetId: 'widget-a',
            widgetTitle: 'Temperatura Línea A',
            value: 10,
            unit: '°C',
            status: 'normal',
            source: 'real',
        },
        {
            nodeId: 'node-b',
            nodeName: 'Línea B',
            dashboardId: 'dashboard-b',
            dashboardName: 'Dashboard B',
            widgetId: 'widget-b',
            widgetTitle: 'Temperatura Línea B',
            value: 20,
            unit: '°C',
            status: 'normal',
            source: 'real',
        },
    ],
    excluded: [
        {
            nodeId: 'node-c',
            nodeName: 'Línea C',
            dashboardId: 'dashboard-c',
            dashboardName: 'Dashboard C',
            widgetId: 'widget-c',
            widgetTitle: 'Presión Línea C',
            reason: 'catalog-mismatch',
            value: 99,
            unit: 'bar',
            status: 'normal',
            source: 'simulated',
        },
    ],
};

describe('MetricCard hierarchy trace disclosure', () => {
    it('applies a value font size override only to the runtime metric value row', () => {
        render(
            <MetricCard
                label="Temperatura agregada"
                subtitle="Tanque principal"
                value={30}
                unit="°C"
                valueFontSize={72}
            />,
        );

        expect(screen.getByTestId('metric-card-value-row')).toHaveAttribute('style', expect.stringContaining('font-size: 72px'));
        expect(screen.getByTestId('metric-card-header')).not.toHaveStyle({ fontSize: '72px' });
    });

    it('keeps header content separate from value and footer regions when subtitle and subtext are both configured', () => {
        render(
            <MetricCard
                label="Temperatura agregada"
                subtitle="Tanque principal"
                value={30}
                unit="°C"
                subtext="Límite: 45 °C"
            />,
        );

        const header = screen.getByTestId('metric-card-header');
        const content = screen.getByTestId('metric-card-content');
        const valueRow = screen.getByTestId('metric-card-value-row');
        const footer = screen.getByTestId('metric-card-footer');

        expect(within(header).getByText('Temperatura agregada')).toBeInTheDocument();
        expect(within(header).getByText('Tanque principal')).toBeInTheDocument();
        expect(within(valueRow).getByText('30')).toBeInTheDocument();
        expect(within(valueRow).getByText('°C')).toBeInTheDocument();
        expect(within(footer).getByText('Límite: 45 °C')).toBeInTheDocument();
        expect(content).toContainElement(valueRow);
        expect(content).toContainElement(footer);
        expect(header).not.toContainElement(valueRow);
        expect(header).not.toContainElement(footer);
        expect(footer).not.toContainElement(header);
    });

    it('omits the footer region when only a header subtitle is configured', () => {
        render(
            <MetricCard
                label="Temperatura agregada"
                subtitle="Tanque principal"
                value={30}
                unit="°C"
            />,
        );

        expect(within(screen.getByTestId('metric-card-header')).getByText('Tanque principal')).toBeInTheDocument();
        expect(screen.queryByTestId('metric-card-footer')).not.toBeInTheDocument();
    });

    it('engages compact mode via ResizeObserver measurements and stays compact across repeated tight re-measurements', async () => {
        setMeasurementProfile('metric-card-card', { clientHeight: 200 });
        setMeasurementProfile('metric-card-header', { offsetHeight: 60, compactOffsetHeight: 60 });
        setMeasurementProfile('metric-card-value-row', { offsetHeight: 50, compactOffsetHeight: 40 });
        setMeasurementProfile('metric-card-footer', { offsetHeight: 30, compactOffsetHeight: 20 });

        render(
            <MetricCard
                label="Temperatura agregada"
                subtitle="Tanque principal"
                value={30}
                unit="°C"
                subtext="Límite: 45 °C"
            />,
        );

        const content = screen.getByTestId('metric-card-content');
        const footer = screen.getByTestId('metric-card-footer');

        await waitFor(() => {
            expect(content).toHaveClass('mt-1.5', 'gap-1.5');
            expect(footer).toHaveClass('gap-1.5');
        });

        MockResizeObserver.triggerAll();

        await waitFor(() => {
            expect(content).toHaveClass('mt-1.5', 'gap-1.5');
            expect(footer).toHaveClass('gap-1.5');
        });
    });

    it('keeps the KPI visible and exposes contributor details behind a collapsed disclosure by default', async () => {
        const user = userEvent.setup();

        render(
            <MetricCard
                label="Temperatura agregada"
                value={30}
                unit="°C"
                hierarchyTrace={resolvedTrace}
            />,
        );

        expect(screen.getByText('30')).toBeInTheDocument();
        expect(screen.getByText('°C')).toBeInTheDocument();

        const disclosure = screen.getByRole('button', {
            name: 'Ver detalle de agregación de Temperatura agregada',
        });

        expect(disclosure).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('Temperatura Línea A')).not.toBeInTheDocument();

        await user.click(disclosure);

        expect(disclosure).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Suma actual · 30 °C')).toBeInTheDocument();
        expect(screen.getByText('2 incluidos · 1 excluido · 2 dashboards')).toBeInTheDocument();
        expect(screen.getByText('Temperatura Línea A')).toBeInTheDocument();
        expect(screen.getByText('Temperatura Línea B')).toBeInTheDocument();
        expect(screen.getByText('Presión Línea C')).toBeInTheDocument();
        expect(screen.getByText('Variable distinta')).toBeInTheDocument();
        expect(screen.getByTestId('metric-card-hierarchy-trace')).toHaveClass('hmi-scrollbar');
    });

    it('renders hierarchy empty-state copy after expansion without contributor rows', async () => {
        const user = userEvent.setup();

        render(
            <MetricCard
                label="Temperatura agregada"
                value={null}
                hierarchyTrace={{
                    ...resolvedTrace,
                    resolved: { value: null, status: 'no-data', source: 'error' },
                    state: 'empty',
                    emptyReason: 'no-eligible-contributors',
                    included: [],
                    excluded: [],
                }}
            />,
        );

        const disclosure = screen.getByRole('button', {
            name: 'Ver detalle de agregación de Temperatura agregada',
        });

        await user.click(disclosure);

        expect(screen.getByText('Sin datos elegibles para esta jerarquía.')).toBeInTheDocument();
        expect(screen.getByText('No se encontró ningún contributor numérico para la variable seleccionada.')).toBeInTheDocument();
        expect(screen.queryByText('Incluidos')).not.toBeInTheDocument();
        expect(screen.queryByText('Excluidos')).not.toBeInTheDocument();
    });

    it('toggles the disclosure with keyboard activation and keeps expanded state accurate for assistive tech', async () => {
        const user = userEvent.setup();

        render(
            <MetricCard
                label="Temperatura agregada"
                value={30}
                unit="°C"
                hierarchyTrace={resolvedTrace}
            />,
        );

        const disclosure = screen.getByRole('button', {
            name: 'Ver detalle de agregación de Temperatura agregada',
        });

        disclosure.focus();

        expect(disclosure).toHaveFocus();
        expect(disclosure).toHaveAttribute('aria-expanded', 'false');

        await user.keyboard('{Enter}');

        expect(disclosure).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('Temperatura Línea A')).toBeInTheDocument();

        await user.keyboard(' ');

        expect(disclosure).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('Temperatura Línea A')).not.toBeInTheDocument();
    });
});
