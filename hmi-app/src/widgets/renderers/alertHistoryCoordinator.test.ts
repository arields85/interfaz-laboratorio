import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetConfig } from '../../domain/admin.types';
import { makeWidget } from '../../test/fixtures/dashboard.fixture';
import {
    clearAlertHistoryEntries,
    resetAlertHistoryCoordinatorsForTests,
    subscribeAlertHistory,
} from './alertHistoryCoordinator';
import { alertHistoryStorage } from '../../services/AlertHistoryStorageService';

const evaluatorMock = vi.hoisted(() => ({
    evaluateDashboardWidgets: vi.fn(() => ({ evaluatedCount: 0, newEntries: [] })),
}));

vi.mock('../resolvers/alertHistoryEvaluator', () => ({
    evaluateDashboardWidgets: evaluatorMock.evaluateDashboardWidgets,
}));

describe('alertHistoryCoordinator', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
        evaluatorMock.evaluateDashboardWidgets.mockClear();
        resetAlertHistoryCoordinatorsForTests();
    });

    afterEach(() => {
        resetAlertHistoryCoordinatorsForTests();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('shares one immediate evaluation and one timer across dashboard subscribers', async () => {
        const widgets = [makeWidget({ id: 'sensor-a' })];
        const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
        const unsubscribeFirst = subscribe('dashboard-a', widgets);
        const unsubscribeSecond = subscribe('dashboard-a', widgets);

        expect(evaluatorMock.evaluateDashboardWidgets).toHaveBeenCalledTimes(1);
        expect(getItemSpy).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);

        vi.advanceTimersByTime(10_000);

        expect(evaluatorMock.evaluateDashboardWidgets).toHaveBeenCalledTimes(2);
        expect(getItemSpy).toHaveBeenCalledTimes(2);
        unsubscribeFirst();
        expect(vi.getTimerCount()).toBe(1);
        unsubscribeSecond();
        await Promise.resolve();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('survives a StrictMode cleanup and resubscribe without duplicating work', async () => {
        const widgets = [makeWidget({ id: 'sensor-a' })];
        const unsubscribeFirst = subscribe('dashboard-a', widgets);

        unsubscribeFirst();
        const unsubscribeSecond = subscribe('dashboard-a', widgets);
        await Promise.resolve();

        expect(evaluatorMock.evaluateDashboardWidgets).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);

        unsubscribeSecond();
        await Promise.resolve();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reads the latest dashboard context on every polling cycle', () => {
        let widgets = [makeWidget({ id: 'sensor-a' })];
        const unsubscribe = subscribeAlertHistory({
            dashboardId: 'dashboard-a',
            pollInterval: 10_000,
            getContext: () => ({ widgets, equipmentMap: new Map() }),
            onState: vi.fn(),
        });

        widgets = [makeWidget({ id: 'sensor-b' })];
        vi.advanceTimersByTime(10_000);

        expect(evaluatorMock.evaluateDashboardWidgets).toHaveBeenLastCalledWith(
            'dashboard-a',
            [expect.objectContaining({ id: 'sensor-b' })],
            expect.any(Map),
            undefined,
            expect.any(Object),
        );
        unsubscribe();
    });

    it('isolates evaluation and timers between dashboards', () => {
        const unsubscribeA = subscribe('dashboard-a', [makeWidget({ id: 'sensor-a' })]);
        const unsubscribeB = subscribe('dashboard-b', [makeWidget({ id: 'sensor-b' })]);

        expect(evaluatorMock.evaluateDashboardWidgets).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(2);

        vi.advanceTimersByTime(10_000);

        expect(evaluatorMock.evaluateDashboardWidgets).toHaveBeenCalledTimes(4);
        expect(evaluatorMock.evaluateDashboardWidgets.mock.calls.map(call => call[0])).toEqual([
            'dashboard-a',
            'dashboard-b',
            'dashboard-a',
            'dashboard-b',
        ]);

        unsubscribeA();
        unsubscribeB();
    });

    it('clears visible entries for every subscriber without clearing active snapshots', () => {
        alertHistoryStorage.recordStateChange('dashboard-a', 'sensor-a', 'Sensor A', 'warning');
        const onState = vi.fn();
        const unsubscribe = subscribeAlertHistory({
            dashboardId: 'dashboard-a',
            pollInterval: 10_000,
            getContext: () => ({ widgets: [], equipmentMap: new Map() }),
            onState,
        });

        clearAlertHistoryEntries('dashboard-a');

        expect(onState).toHaveBeenLastCalledWith({
            entries: [],
            activeSeverity: 'warning',
        });
        expect(alertHistoryStorage.getWidgetSnapshot('dashboard-a', 'sensor-a')?.lastStatus).toBe('warning');
        unsubscribe();
    });
});

function subscribe(dashboardId: string, widgets: WidgetConfig[]): () => void {
    return subscribeAlertHistory({
        dashboardId,
        pollInterval: 10_000,
        getContext: () => ({ widgets, equipmentMap: new Map() }),
        onState: vi.fn(),
    });
}
