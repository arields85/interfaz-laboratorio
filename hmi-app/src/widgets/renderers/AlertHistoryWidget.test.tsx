import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertHistoryEntry, WidgetStateSnapshot } from '../../domain/alertHistory.types';
import type { AlertHistoryWidgetConfig } from '../../domain/admin.types';
import AlertHistoryWidget from './AlertHistoryWidget';

const alertHistoryMock = vi.hoisted(() => {
    const state = {
        entries: [] as AlertHistoryEntry[],
        severity: 'normal' as 'normal' | 'warning' | 'critical',
        snapshots: {} as Record<string, WidgetStateSnapshot>,
    };

    return {
        state,
        getEntries: vi.fn((dashboardId: string) => {
            void dashboardId;
            return state.entries;
        }),
        getActiveAlertSeverity: vi.fn((dashboardId: string) => {
            void dashboardId;
            return state.severity;
        }),
        clearEntries: vi.fn((dashboardId: string) => {
            void dashboardId;
            state.entries = [];
        }),
        getWidgetSnapshot: vi.fn((dashboardId: string, widgetId: string) => {
            void dashboardId;
            return state.snapshots[widgetId] ?? null;
        }),
    };
});

const evaluatorMock = vi.hoisted(() => ({
    evaluateDashboardWidgets: vi.fn(),
}));

vi.mock('../../services/AlertHistoryStorageService', () => ({
    alertHistoryStorage: {
        getEntries: alertHistoryMock.getEntries,
        getActiveAlertSeverity: alertHistoryMock.getActiveAlertSeverity,
        clearEntries: alertHistoryMock.clearEntries,
        getWidgetSnapshot: alertHistoryMock.getWidgetSnapshot,
    },
}));

vi.mock('../resolvers/alertHistoryEvaluator', () => ({
    evaluateDashboardWidgets: evaluatorMock.evaluateDashboardWidgets,
}));

const resizeObserverCallbacks = new Set<ResizeObserverCallback>();

class MockResizeObserver implements ResizeObserver {
    public constructor(callback: ResizeObserverCallback) {
        resizeObserverCallbacks.add(callback);
    }

    public observe(_target: Element): void {}

    public unobserve(): void {}

    public disconnect(): void {}
}

const equipmentMap = new Map();
const FIXED_NOW = new Date('2026-06-17T12:00:00.000Z').getTime();

function makeWidget(overrides?: Partial<AlertHistoryWidgetConfig>): AlertHistoryWidgetConfig {
    return {
        id: 'alert-history-1',
        type: 'alert-history',
        title: 'Alert History',
        position: { x: 0, y: 0 },
        size: { w: 4, h: 3 },
        displayOptions: {
            dashboardId: 'dashboard-a',
            pollInterval: 10_000,
        },
        ...overrides,
    };
}

describe('AlertHistoryWidget', () => {
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
        alertHistoryMock.state.entries = [];
        alertHistoryMock.state.severity = 'normal';
        alertHistoryMock.state.snapshots = {};
        resizeObserverCallbacks.clear();
        evaluatorMock.evaluateDashboardWidgets.mockReset();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('renders the empty state and disables the clear history action when no entries exist', () => {
        render(
            <AlertHistoryWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
            />,
        );

        expect(screen.getByText('Sin alertas recientes')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Limpiar historial visible' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Ver historial completo (funcionalidad pendiente)' })).toHaveAttribute('tabindex', '-1');
    });

    it('renders warning and critical entries with formatted timestamps and values', async () => {
        alertHistoryMock.state.entries = [
            makeEntry({
                id: 'critical-entry',
                widgetId: 'critical-widget',
                widgetTitle: 'Pressure',
                toStatus: 'critical',
                value: 110,
                unit: 'bar',
                detectedAt: '2026-06-17T11:59:00.000Z',
            }),
            makeEntry({
                id: 'warning-entry',
                widgetId: 'warning-widget',
                widgetTitle: 'Temperature',
                toStatus: 'warning',
                value: 92.456,
                unit: '°C',
                detectedAt: '2026-06-17T11:58:00.000Z',
            }),
        ];
        alertHistoryMock.state.severity = 'critical';

        render(
            <AlertHistoryWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('Crítica')).toBeInTheDocument();
        });

        expect(screen.getByText('Advertencia')).toBeInTheDocument();
        expect(screen.getByText('PRESSURE')).toBeInTheDocument();
        expect(screen.getByText('TEMPERATURE')).toBeInTheDocument();
        expect(screen.getByText('Valor: 110 bar')).toBeInTheDocument();
        expect(screen.getByText('Valor: 92.46 °C')).toBeInTheDocument();
        expect(screen.getByText((_, element) => element?.tagName === 'SPAN' && element.textContent === '· hace 1 min')).toBeInTheDocument();
        expect(screen.getByText((_, element) => element?.tagName === 'SPAN' && element.textContent === '· hace 2 min')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Limpiar historial visible' })).toBeEnabled();
    });

    it('clears only visible history while keeping the active severity styling', async () => {
        alertHistoryMock.state.entries = [
            makeEntry({
                id: 'warning-entry',
                widgetId: 'widget-a',
                widgetTitle: 'Temperature',
                toStatus: 'warning',
                value: 91,
                unit: '°C',
            }),
        ];
        alertHistoryMock.state.severity = 'warning';
        alertHistoryMock.state.snapshots = {
            'widget-a': {
                widgetId: 'widget-a',
                lastStatus: 'warning',
                lastCheckedAt: '2026-06-17T12:00:00.000Z',
            },
        };

        const { container } = render(
            <AlertHistoryWidget
                widget={makeWidget()}
                equipmentMap={equipmentMap}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('TEMPERATURE')).toBeInTheDocument();
        });

        expect(container.firstChild).toHaveClass('glass-panel-warning');

        fireEvent.click(screen.getByRole('button', { name: 'Limpiar historial visible' }));

        await waitFor(() => {
            expect(screen.getByText('Sin alertas recientes')).toBeInTheDocument();
        });

        expect(alertHistoryMock.clearEntries).toHaveBeenCalledWith('dashboard-a');
        expect(container.firstChild).toHaveClass('glass-panel-warning');
        expect(alertHistoryMock.getWidgetSnapshot('dashboard-a', 'widget-a')).toEqual({
            widgetId: 'widget-a',
            lastStatus: 'warning',
            lastCheckedAt: '2026-06-17T12:00:00.000Z',
        });
    });

    it('respects the configured maxVisible limit when more entries are available', async () => {
        alertHistoryMock.state.entries = [
            makeEntry({ id: 'entry-1', widgetId: 'widget-c', widgetTitle: 'Flow', toStatus: 'warning', value: 40, unit: 'L/min' }),
            makeEntry({ id: 'entry-2', widgetId: 'widget-b', widgetTitle: 'Pressure', toStatus: 'critical', value: 110, unit: 'bar' }),
            makeEntry({ id: 'entry-3', widgetId: 'widget-a', widgetTitle: 'Temperature', toStatus: 'warning', value: 91, unit: '°C' }),
        ];

        render(
            <AlertHistoryWidget
                widget={makeWidget({
                    displayOptions: {
                        dashboardId: 'dashboard-a',
                        maxVisible: 2,
                        pollInterval: 10_000,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('FLOW')).toBeInTheDocument();
        });

        expect(screen.getByText('PRESSURE')).toBeInTheDocument();
        expect(screen.queryByText('TEMPERATURE')).not.toBeInTheDocument();
    });

    it('limits rendered entries by the measured visible row count', async () => {
        alertHistoryMock.state.entries = [
            makeEntry({ id: 'entry-1', widgetId: 'widget-d', widgetTitle: 'Flow', toStatus: 'warning', value: 40, unit: 'L/min' }),
            makeEntry({ id: 'entry-2', widgetId: 'widget-c', widgetTitle: 'Pressure', toStatus: 'critical', value: 110, unit: 'bar' }),
            makeEntry({ id: 'entry-3', widgetId: 'widget-b', widgetTitle: 'Temperature', toStatus: 'warning', value: 91, unit: '°C' }),
            makeEntry({ id: 'entry-4', widgetId: 'widget-a', widgetTitle: 'Speed', toStatus: 'warning', value: 1200, unit: 'RPM' }),
        ];

        render(
            <AlertHistoryWidget
                widget={makeWidget({
                    displayOptions: {
                        dashboardId: 'dashboard-a',
                        maxVisible: 5,
                        pollInterval: 10_000,
                    },
                })}
                equipmentMap={equipmentMap}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText('FLOW')).toBeInTheDocument();
        });

        const firstRow = screen.getAllByRole('listitem')[0];
        const list = firstRow?.parentElement;
        expect(firstRow).toBeDefined();
        expect(list).not.toBeNull();

        Object.defineProperty(list, 'clientHeight', { configurable: true, value: 100 });
        Object.defineProperty(firstRow, 'offsetHeight', { configurable: true, value: 44 });

        await act(async () => {
            resizeObserverCallbacks.forEach((callback) => callback([], {} as ResizeObserver));
        });

        expect(screen.getByText('FLOW')).toBeInTheDocument();
        expect(screen.getByText('PRESSURE')).toBeInTheDocument();
        expect(screen.queryByText('TEMPERATURE')).not.toBeInTheDocument();
        expect(screen.queryByText('SPEED')).not.toBeInTheDocument();
    });
});

function makeEntry(overrides: Partial<AlertHistoryEntry>): AlertHistoryEntry {
    return {
        id: overrides.id ?? 'entry-id',
        dashboardId: 'dashboard-a',
        widgetId: overrides.widgetId ?? 'widget-id',
        widgetTitle: overrides.widgetTitle ?? 'Widget',
        toStatus: overrides.toStatus ?? 'warning',
        fromStatus: overrides.fromStatus ?? 'normal',
        value: overrides.value,
        unit: overrides.unit,
        detectedAt: overrides.detectedAt ?? '2026-06-17T12:00:00.000Z',
    };
}
