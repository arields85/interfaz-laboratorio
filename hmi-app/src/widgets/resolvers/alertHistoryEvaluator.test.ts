import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateDashboardWidgets } from './alertHistoryEvaluator';
import { alertHistoryStorage } from '../../services/AlertHistoryStorageService';
import { makeWidget } from '../../test/fixtures/dashboard.fixture';

describe('evaluateDashboardWidgets', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-17T12:00:00.000Z'));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('ignores alert-history widgets during evaluation', () => {
        const result = evaluateDashboardWidgets(
            'dashboard-a',
            [{
                ...makeWidget({
                    id: 'history-widget',
                    type: 'alert-history',
                    simulatedValue: 95,
                    thresholds: [{ value: 90, severity: 'warning' }],
                }),
                type: 'alert-history',
            }],
            new Map(),
        );

        expect(result).toEqual({ evaluatedCount: 0, newEntries: [] });
        expect(alertHistoryStorage.getEntries('dashboard-a')).toEqual([]);
        expect(alertHistoryStorage.getWidgetSnapshot('dashboard-a', 'history-widget')).toBeNull();
    });

    it('skips no-data widgets without creating entries or snapshots', () => {
        const result = evaluateDashboardWidgets(
            'dashboard-a',
            [makeWidget({
                id: 'sensor-a',
                thresholds: [{ value: 90, severity: 'warning' }],
            })],
            new Map(),
        );

        expect(result).toEqual({ evaluatedCount: 1, newEntries: [] });
        expect(alertHistoryStorage.getEntries('dashboard-a')).toEqual([]);
        expect(alertHistoryStorage.getWidgetSnapshot('dashboard-a', 'sensor-a')).toBeNull();
    });

    it('records warning and critical threshold transitions as visible history entries', () => {
        const warningWidget = makeWidget({
            id: 'sensor-a',
            title: 'Temperature',
            simulatedValue: 75,
            thresholds: [
                { value: 70, severity: 'warning' },
                { value: 90, severity: 'critical' },
            ],
        });

        const warningPass = evaluateDashboardWidgets('dashboard-a', [warningWidget], new Map());

        vi.setSystemTime(new Date('2026-06-17T12:05:00.000Z'));

        const criticalPass = evaluateDashboardWidgets(
            'dashboard-a',
            [{ ...warningWidget, simulatedValue: 95 }],
            new Map(),
        );

        expect(warningPass.newEntries).toHaveLength(1);
        expect(warningPass.newEntries[0]).toEqual(expect.objectContaining({
            widgetId: 'sensor-a',
            widgetTitle: 'Temperature',
            fromStatus: 'normal',
            toStatus: 'warning',
            value: 75,
        }));

        expect(criticalPass.newEntries).toHaveLength(1);
        expect(criticalPass.newEntries[0]).toEqual(expect.objectContaining({
            widgetId: 'sensor-a',
            fromStatus: 'warning',
            toStatus: 'critical',
            value: 95,
        }));

        expect(alertHistoryStorage.getEntries('dashboard-a')).toHaveLength(2);
    });

    it('uses the fallback title and default deadband to suppress recovery noise', () => {
        const widget = makeWidget({
            id: 'sensor-a',
            title: undefined,
            simulatedValue: 100,
            thresholds: [{ value: 100, severity: 'warning' }],
        });

        const warningPass = evaluateDashboardWidgets('dashboard-a', [widget], new Map());

        vi.setSystemTime(new Date('2026-06-17T12:05:00.000Z'));

        const suppressedRecoveryPass = evaluateDashboardWidgets(
            'dashboard-a',
            [{ ...widget, simulatedValue: 96 }],
            new Map(),
        );

        expect(warningPass.newEntries).toHaveLength(1);
        expect(warningPass.newEntries[0]).toEqual(expect.objectContaining({
            widgetTitle: 'Widget sensor-a',
            toStatus: 'warning',
        }));
        expect(suppressedRecoveryPass).toEqual({ evaluatedCount: 1, newEntries: [] });
        expect(alertHistoryStorage.getWidgetSnapshot('dashboard-a', 'sensor-a')).toEqual({
            widgetId: 'sensor-a',
            lastStatus: 'warning',
            lastCheckedAt: '2026-06-17T12:00:00.000Z',
        });

        vi.setSystemTime(new Date('2026-06-17T12:10:00.000Z'));

        const recoveredPass = evaluateDashboardWidgets(
            'dashboard-a',
            [{ ...widget, simulatedValue: 94 }],
            new Map(),
        );

        expect(recoveredPass).toEqual({ evaluatedCount: 1, newEntries: [] });
        expect(alertHistoryStorage.getWidgetSnapshot('dashboard-a', 'sensor-a')).toEqual({
            widgetId: 'sensor-a',
            lastStatus: 'normal',
            lastCheckedAt: '2026-06-17T12:10:00.000Z',
        });
    });

    it('clears stale snapshots when a widget becomes non-evaluable', () => {
        alertHistoryStorage.recordStateChange('dashboard-a', 'sensor-a', 'Temperature', 'warning', 88, '°C');

        vi.setSystemTime(new Date('2026-06-17T12:05:00.000Z'));

        const result = evaluateDashboardWidgets(
            'dashboard-a',
            [makeWidget({
                id: 'sensor-a',
                title: 'Temperature',
                simulatedValue: 88,
                thresholds: [{ value: 0, severity: 'warning' }],
            })],
            new Map(),
        );

        expect(result).toEqual({ evaluatedCount: 0, newEntries: [] });
        expect(alertHistoryStorage.getEntries('dashboard-a')).toHaveLength(1);
        expect(alertHistoryStorage.getWidgetSnapshot('dashboard-a', 'sensor-a')).toEqual({
            widgetId: 'sensor-a',
            lastStatus: 'normal',
            lastCheckedAt: '2026-06-17T12:05:00.000Z',
        });
    });

    it('purges orphaned widget snapshots that are no longer present on the dashboard', () => {
        alertHistoryStorage.recordStateChange('dashboard-a', 'removed-widget', 'Removed', 'critical', 100, '%');

        const result = evaluateDashboardWidgets(
            'dashboard-a',
            [makeWidget({
                id: 'active-widget',
                title: 'Active',
                simulatedValue: 40,
                thresholds: [{ value: 70, severity: 'warning' }],
            })],
            new Map(),
        );

        expect(result).toEqual({ evaluatedCount: 1, newEntries: [] });
        expect(alertHistoryStorage.getWidgetSnapshot('dashboard-a', 'removed-widget')).toBeNull();
        expect(alertHistoryStorage.getWidgetSnapshot('dashboard-a', 'active-widget')).toBeNull();
    });

    it.each([12, 50])('evaluates %i alerting widgets with one storage read and one write', (widgetCount) => {
        const widgets = Array.from({ length: widgetCount }, (_, index) => makeWidget({
            id: `sensor-${index}`,
            title: `Sensor ${index}`,
            simulatedValue: 100 + index,
            thresholds: [{ value: 90, severity: 'warning' }],
        }));
        const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

        const result = evaluateDashboardWidgets('dashboard-a', widgets, new Map());

        expect(result.evaluatedCount).toBe(widgetCount);
        expect(result.newEntries).toHaveLength(widgetCount);
        expect(getItemSpy).toHaveBeenCalledTimes(1);
        expect(setItemSpy).toHaveBeenCalledTimes(1);

        const history = alertHistoryStorage.getHistory('dashboard-a');
        expect(history.entries).toHaveLength(widgetCount);
        expect(Object.keys(history.widgetSnapshots)).toHaveLength(widgetCount);
        expect(history.entries.map(entry => entry.widgetId)).toEqual(
            Array.from({ length: widgetCount }, (_, index) => `sensor-${widgetCount - index - 1}`),
        );
    });

    it('uses one read and no writes when a 50-widget cycle has no state changes', () => {
        const widgets = Array.from({ length: 50 }, (_, index) => makeWidget({
            id: `sensor-${index}`,
            simulatedValue: 100 + index,
            thresholds: [{ value: 90, severity: 'warning' }],
        }));
        evaluateDashboardWidgets('dashboard-a', widgets, new Map());
        const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

        const result = evaluateDashboardWidgets('dashboard-a', widgets, new Map());

        expect(result).toEqual({ evaluatedCount: 50, newEntries: [] });
        expect(getItemSpy).toHaveBeenCalledTimes(1);
        expect(setItemSpy).not.toHaveBeenCalled();
    });
});
