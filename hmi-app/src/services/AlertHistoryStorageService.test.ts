import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alertHistoryStorage } from './AlertHistoryStorageService';

describe('AlertHistoryStorageService', () => {
    let dateNowSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-17T12:00:00.000Z'));
        dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_717_171_717_171);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('returns empty history and null snapshot when dashboard storage is missing', () => {
        const history = alertHistoryStorage.getHistory('dashboard-a');

        expect(history).toEqual({
            dashboardId: 'dashboard-a',
            entries: [],
            widgetSnapshots: {},
            lastUpdatedAt: '2026-06-17T12:00:00.000Z',
        });
        expect(alertHistoryStorage.getEntries('dashboard-a')).toEqual([]);
        expect(alertHistoryStorage.getWidgetSnapshot('dashboard-a', 'widget-a')).toBeNull();
    });

    it('returns empty history when persisted JSON is corrupted', () => {
        localStorage.setItem('hmi_alert_history_v1_dashboard-a', '{bad-json');

        expect(alertHistoryStorage.getHistory('dashboard-a')).toEqual({
            dashboardId: 'dashboard-a',
            entries: [],
            widgetSnapshots: {},
            lastUpdatedAt: '2026-06-17T12:00:00.000Z',
        });
    });

    it('records visible entries only for warning and critical transitions', () => {
        const warningEntry = alertHistoryStorage.recordStateChange(
            'dashboard-a',
            'widget-a',
            'Temperature',
            'warning',
            92.4,
            '°C',
        );

        expect(warningEntry).toEqual({
            id: expect.stringMatching(/^ah-widget-a-/),
            dashboardId: 'dashboard-a',
            widgetId: 'widget-a',
            widgetTitle: 'Temperature',
            toStatus: 'warning',
            fromStatus: 'normal',
            value: 92.4,
            unit: '°C',
            detectedAt: '2026-06-17T12:00:00.000Z',
        });

        vi.setSystemTime(new Date('2026-06-17T12:05:00.000Z'));

        const noVisibleEntry = alertHistoryStorage.recordStateChange(
            'dashboard-a',
            'widget-a',
            'Temperature',
            'normal',
            81.1,
            '°C',
        );

        expect(noVisibleEntry).toBeNull();
        expect(alertHistoryStorage.getEntries('dashboard-a')).toEqual([warningEntry]);
        expect(alertHistoryStorage.getWidgetSnapshot('dashboard-a', 'widget-a')).toEqual({
            widgetId: 'widget-a',
            lastStatus: 'normal',
            lastCheckedAt: '2026-06-17T12:05:00.000Z',
        });
    });

    it('skips persistence when the status does not change', () => {
        alertHistoryStorage.recordStateChange('dashboard-a', 'widget-a', 'Temperature', 'warning');
        const persistedBefore = localStorage.getItem('hmi_alert_history_v1_dashboard-a');

        vi.setSystemTime(new Date('2026-06-17T12:10:00.000Z'));

        const duplicateEntry = alertHistoryStorage.recordStateChange(
            'dashboard-a',
            'widget-a',
            'Temperature',
            'warning',
        );

        expect(duplicateEntry).toBeNull();
        expect(localStorage.getItem('hmi_alert_history_v1_dashboard-a')).toBe(persistedBefore);
    });

    it('keeps the newest 200 entries and orders them first-to-last', () => {
        for (let index = 0; index < 201; index += 1) {
            vi.setSystemTime(new Date(`2026-06-17T12:${String(index % 60).padStart(2, '0')}:00.000Z`));
            dateNowSpy.mockReturnValue(1_717_171_717_171 + index);

            alertHistoryStorage.recordStateChange(
                'dashboard-a',
                `widget-${index}`,
                `Widget ${index}`,
                'critical',
                index,
            );
        }

        const entries = alertHistoryStorage.getEntries('dashboard-a');

        expect(entries).toHaveLength(200);
        expect(entries[0]).toEqual(expect.objectContaining({ widgetId: 'widget-200', value: 200 }));
        expect(entries.at(-1)).toEqual(expect.objectContaining({ widgetId: 'widget-1', value: 1 }));
        expect(entries.find(entry => entry.widgetId === 'widget-0')).toBeUndefined();
    });

    it('prioritizes warning over critical when resolving active severity', () => {
        alertHistoryStorage.recordStateChange('dashboard-a', 'widget-warning', 'Warning widget', 'warning');
        alertHistoryStorage.recordStateChange('dashboard-a', 'widget-critical', 'Critical widget', 'critical');

        expect(alertHistoryStorage.getActiveAlertSeverity('dashboard-a')).toBe('warning');

        alertHistoryStorage.recordStateChange('dashboard-a', 'widget-warning', 'Warning widget', 'normal');

        expect(alertHistoryStorage.getActiveAlertSeverity('dashboard-a')).toBe('critical');

        alertHistoryStorage.recordStateChange('dashboard-a', 'widget-critical', 'Critical widget', 'stale');

        expect(alertHistoryStorage.getActiveAlertSeverity('dashboard-a')).toBe('normal');
    });

    it('clears only visible entries while preserving widget snapshots', () => {
        alertHistoryStorage.recordStateChange('dashboard-a', 'widget-a', 'Temperature', 'warning');

        alertHistoryStorage.clearEntries('dashboard-a');

        expect(alertHistoryStorage.getEntries('dashboard-a')).toEqual([]);
        expect(alertHistoryStorage.getWidgetSnapshot('dashboard-a', 'widget-a')).toEqual({
            widgetId: 'widget-a',
            lastStatus: 'warning',
            lastCheckedAt: '2026-06-17T12:00:00.000Z',
        });
    });

    it('removes widget snapshots explicitly and by orphan cleanup', () => {
        alertHistoryStorage.recordStateChange('dashboard-a', 'widget-a', 'Temperature', 'warning');
        alertHistoryStorage.recordStateChange('dashboard-a', 'widget-b', 'Pressure', 'critical');

        alertHistoryStorage.removeWidgetSnapshot('dashboard-a', 'widget-a');

        expect(alertHistoryStorage.getWidgetSnapshot('dashboard-a', 'widget-a')).toBeNull();
        expect(alertHistoryStorage.getWidgetSnapshot('dashboard-a', 'widget-b')).not.toBeNull();

        alertHistoryStorage.removeOrphanedSnapshots('dashboard-a', new Set(['widget-c']));

        expect(alertHistoryStorage.getWidgetSnapshot('dashboard-a', 'widget-b')).toBeNull();
        expect(alertHistoryStorage.getActiveAlertSeverity('dashboard-a')).toBe('normal');
    });

    it('does not rewrite storage when orphan cleanup finds no removed snapshots', () => {
        alertHistoryStorage.recordStateChange('dashboard-a', 'widget-a', 'Temperature', 'warning');
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

        alertHistoryStorage.removeOrphanedSnapshots('dashboard-a', new Set(['widget-a']));

        expect(setItemSpy).not.toHaveBeenCalled();
    });

    it('swallows storage write failures and still returns the new entry', () => {
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('Quota exceeded');
        });

        const entry = alertHistoryStorage.recordStateChange('dashboard-a', 'widget-a', 'Temperature', 'critical');

        expect(entry).toMatchObject({
            dashboardId: 'dashboard-a',
            widgetId: 'widget-a',
            widgetTitle: 'Temperature',
            toStatus: 'critical',
            fromStatus: 'normal',
        });
        expect(setItemSpy).toHaveBeenCalled();
    });

    it('clears dashboard history storage completely', () => {
        alertHistoryStorage.recordStateChange('dashboard-a', 'widget-a', 'Temperature', 'warning');

        alertHistoryStorage.clearHistory('dashboard-a');

        expect(localStorage.getItem('hmi_alert_history_v1_dashboard-a')).toBeNull();
    });
});
