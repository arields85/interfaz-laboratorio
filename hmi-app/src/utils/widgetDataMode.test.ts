import { describe, expect, it } from 'vitest';

import type { WidgetConfig } from '../domain/admin.types';
import { resolveWidgetDataMode } from './widgetDataMode';

function makeWidget(overrides: Partial<WidgetConfig>): WidgetConfig {
    return {
        id: 'widget-1',
        type: 'metric-card',
        title: 'Widget',
        position: { x: 0, y: 0 },
        size: { w: 2, h: 2 },
        ...overrides,
    } as WidgetConfig;
}

describe('resolveWidgetDataMode', () => {
    it.each(['metric-card', 'kpi', 'machine-activity', 'trend-chart', 'trend-chart-v2', 'status', 'connection-status'] as const)(
        'maps configured bindings for %s without consulting runtime source fallbacks',
        (type) => {
            expect(resolveWidgetDataMode(makeWidget({
                type,
                binding: { mode: 'real_variable' },
            }))).toBe('real');
            expect(resolveWidgetDataMode(makeWidget({
                type,
                binding: { mode: 'simulated_value', simulatedValue: 42 },
            }))).toBe('simulated');
        },
    );

    it('uses normalized analytics configuration defaults', () => {
        expect(resolveWidgetDataMode(makeWidget({ type: 'activity-analytics' }))).toBe('real');
        expect(resolveWidgetDataMode(makeWidget({
            type: 'activity-analytics',
            displayOptions: { dataMode: 'simulated' },
        }))).toBe('simulated');
        expect(resolveWidgetDataMode(makeWidget({ type: 'prod-trend' }))).toBe('real');
        expect(resolveWidgetDataMode(makeWidget({
            type: 'prod-trend',
            displayOptions: { dataMode: 'simulated' },
        }))).toBe('simulated');
    });

    it.each(['info-card', 'text-title', 'alert-history', 'prod-history'] as const)(
        'does not invent a source mode for %s',
        (type) => {
            expect(resolveWidgetDataMode(makeWidget({
                type,
                binding: { mode: 'simulated_value', simulatedValue: 42 },
            }))).toBeNull();
        },
    );

    it('omits absent bindings, hierarchy aggregation, and unsupported widgets', () => {
        expect(resolveWidgetDataMode(makeWidget({ type: 'metric-card' }))).toBeNull();
        expect(resolveWidgetDataMode(makeWidget({
            type: 'metric-card',
            hierarchyMode: true,
            binding: { mode: 'real_variable' },
        }))).toBeNull();
        expect(resolveWidgetDataMode(makeWidget({
            type: 'unsupported-widget',
            binding: { mode: 'real_variable' },
        }))).toBeNull();
    });
});
