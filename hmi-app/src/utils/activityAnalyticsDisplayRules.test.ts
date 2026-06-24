import { describe, expect, it } from 'vitest';
import {
    ACTIVITY_ANALYTICS_RUNTIME_RANGE_OPTIONS,
    resolveActivityAnalyticsDisplayRules,
} from './activityAnalyticsDisplayRules';

describe('activityAnalyticsDisplayRules', () => {
    it('removes legacy 1h from runtime range options and normalizes it to 24h', () => {
        expect(ACTIVITY_ANALYTICS_RUNTIME_RANGE_OPTIONS).toEqual(['24h', '7d', '30d', '12m']);
        expect(resolveActivityAnalyticsDisplayRules({ range: '1h', groupBy: 'month' })).toEqual({
            range: '24h',
            allowedGroups: ['shift', 'day'],
            fallbackGroup: 'day',
            groupBy: 'day',
            turnoDetailEligible: false,
        });
    });

    it('keeps low-range Turno detail eligible only when the effective group stays in shift', () => {
        expect(resolveActivityAnalyticsDisplayRules({ range: '24h', groupBy: 'shift' })).toEqual({
            range: '24h',
            allowedGroups: ['shift', 'day'],
            fallbackGroup: 'day',
            groupBy: 'shift',
            turnoDetailEligible: true,
        });

        expect(resolveActivityAnalyticsDisplayRules({ range: '7d', groupBy: 'week' })).toEqual({
            range: '7d',
            allowedGroups: ['shift', 'day', 'week'],
            fallbackGroup: 'day',
            groupBy: 'week',
            turnoDetailEligible: false,
        });
    });

    it('keeps Turno available for long-range summaries while preserving stable fallback groups', () => {
        expect(resolveActivityAnalyticsDisplayRules({ range: '30d', groupBy: 'shift' })).toEqual({
            range: '30d',
            allowedGroups: ['shift', 'day', 'week', 'month'],
            fallbackGroup: 'day',
            groupBy: 'shift',
            turnoDetailEligible: false,
        });

        expect(resolveActivityAnalyticsDisplayRules({ range: '12m', groupBy: 'day' })).toEqual({
            range: '12m',
            allowedGroups: ['shift', 'week', 'month'],
            fallbackGroup: 'week',
            groupBy: 'week',
            turnoDetailEligible: false,
        });

        expect(resolveActivityAnalyticsDisplayRules({ range: '12m', groupBy: 'shift' })).toEqual({
            range: '12m',
            allowedGroups: ['shift', 'week', 'month'],
            fallbackGroup: 'week',
            groupBy: 'shift',
            turnoDetailEligible: false,
        });
    });

    it('derives custom compatibility from the effective duration', () => {
        expect(resolveActivityAnalyticsDisplayRules({
            range: 'custom',
            start: '2026-06-18T10:00:00.000Z',
            end: '2026-06-18T22:00:00.000Z',
            groupBy: 'week',
        })).toEqual({
            range: 'custom',
            allowedGroups: ['shift', 'day'],
            fallbackGroup: 'day',
            groupBy: 'day',
            turnoDetailEligible: false,
        });

        expect(resolveActivityAnalyticsDisplayRules({
            range: 'custom',
            start: '2026-06-18T10:00:00.000Z',
            end: '2026-06-22T10:00:00.000Z',
            groupBy: 'shift',
        })).toEqual({
            range: 'custom',
            allowedGroups: ['shift', 'day', 'week'],
            fallbackGroup: 'day',
            groupBy: 'shift',
            turnoDetailEligible: false,
        });

        expect(resolveActivityAnalyticsDisplayRules({
            range: 'custom',
            start: '2026-06-01T10:00:00.000Z',
            end: '2026-06-11T10:00:00.000Z',
            groupBy: 'shift',
        })).toEqual({
            range: 'custom',
            allowedGroups: ['shift', 'day', 'week', 'month'],
            fallbackGroup: 'day',
            groupBy: 'shift',
            turnoDetailEligible: false,
        });
    });
});
