import { describe, expect, it } from 'vitest';
import type { WidgetType } from '../domain/admin.types';
import {
    getWidgetCapabilities,
    getDefaultIcon,
    getDefaultSize,
    hasNestedInteractiveNavigation,
    supportsCatalogVariable,
    supportsHierarchy,
    supportsTabFrame,
} from './widgetCapabilities';

describe('widgetCapabilities', () => {
    it('marks info-card as a static read-only widget without bindings', () => {
        const widgetType: WidgetType = 'info-card';

        expect(getWidgetCapabilities(widgetType)).toEqual({
            catalogVariable: false,
            hierarchy: false,
            nestedInteractiveNavigation: false,
            defaultSize: { w: 6, h: 5 },
            defaultIcon: 'Info',
        });
        expect(hasNestedInteractiveNavigation(widgetType)).toBe(false);
        expect(supportsCatalogVariable(widgetType)).toBe(false);
        expect(supportsHierarchy(widgetType)).toBe(false);
    });

    it('marks text-title as non-catalog and non-hierarchical', () => {
        const widgetType: WidgetType = 'text-title';

        expect(getWidgetCapabilities(widgetType)).toEqual({
            catalogVariable: false,
            hierarchy: false,
            nestedInteractiveNavigation: false,
            defaultSize: { w: 5, h: 2 },
            defaultIcon: null,
        });
        expect(hasNestedInteractiveNavigation(widgetType)).toBe(false);
        expect(supportsCatalogVariable(widgetType)).toBe(false);
        expect(supportsHierarchy(widgetType)).toBe(false);
    });

    it('marks machine-activity as non-catalog and non-hierarchical', () => {
        expect(getWidgetCapabilities('machine-activity')).toEqual({
            catalogVariable: false,
            hierarchy: false,
            nestedInteractiveNavigation: false,
            defaultSize: { w: 6, h: 10 },
            defaultIcon: 'HeartPulse',
        });
        expect(hasNestedInteractiveNavigation('machine-activity')).toBe(false);
        expect(supportsCatalogVariable('machine-activity')).toBe(false);
        expect(supportsHierarchy('machine-activity')).toBe(false);
    });

    it('marks activity-analytics as non-catalog and non-hierarchical', () => {
        expect(getWidgetCapabilities('activity-analytics')).toEqual({
            catalogVariable: false,
            hierarchy: false,
            nestedInteractiveNavigation: true,
            defaultSize: { w: 15, h: 24 },
            defaultIcon: null,
        });
        expect(hasNestedInteractiveNavigation('activity-analytics')).toBe(true);
        expect(supportsCatalogVariable('activity-analytics')).toBe(false);
        expect(supportsHierarchy('activity-analytics')).toBe(false);
    });

    it('marks prod-trend as non-catalog and non-hierarchical', () => {
        expect(getWidgetCapabilities('prod-trend')).toEqual({
            catalogVariable: false,
            hierarchy: false,
            nestedInteractiveNavigation: false,
            defaultSize: { w: 11, h: 9 },
            defaultIcon: 'TrendingUp',
        });
        expect(hasNestedInteractiveNavigation('prod-trend')).toBe(false);
        expect(supportsCatalogVariable('prod-trend')).toBe(false);
        expect(supportsHierarchy('prod-trend')).toBe(false);
    });

    it('marks widgets with runtime controls as nested-interactive navigation surfaces', () => {
        expect(hasNestedInteractiveNavigation('alert-history')).toBe(true);
        expect(hasNestedInteractiveNavigation('prod-history')).toBe(true);
        expect(hasNestedInteractiveNavigation('trend-chart-v2')).toBe(true);
        expect(hasNestedInteractiveNavigation('trend-chart')).toBe(false);
    });

    it('returns configured default sizes per widget type', () => {
        expect(getDefaultSize('kpi')).toEqual({ w: 6, h: 10 });
        expect(getDefaultSize('metric-card')).toEqual({ w: 6, h: 5 });
        expect(getDefaultSize('trend-chart')).toEqual({ w: 11, h: 9 });
        expect(getDefaultSize('trend-chart-v2')).toEqual({ w: 11, h: 9 });
        expect(getDefaultSize('activity-analytics')).toEqual({ w: 15, h: 24 });
        expect(getDefaultSize('prod-trend')).toEqual({ w: 11, h: 9 });
        expect(getDefaultSize('prod-history')).toEqual({ w: 11, h: 9 });
        expect(getDefaultSize('status')).toEqual({ w: 4, h: 4 });
        expect(getDefaultSize('connection-status')).toEqual({ w: 5, h: 5 });
        expect(getDefaultSize('alert-history')).toEqual({ w: 8, h: 8 });
        expect(getDefaultSize('text-title')).toEqual({ w: 5, h: 2 });
        expect(getDefaultSize('info-card')).toEqual({ w: 6, h: 5 });
    });

    it('marks group as a static container without catalog, hierarchy or nested navigation', () => {
        const widgetType: WidgetType = 'group';

        // G9 (user request, 2026-09-28): no default icon — a new container starts with neither
        // title nor icon, so its header row renders empty (GroupWidget.tsx).
        expect(getWidgetCapabilities(widgetType)).toEqual({
            catalogVariable: false,
            hierarchy: false,
            nestedInteractiveNavigation: false,
            defaultSize: { w: 10, h: 10 },
            defaultIcon: null,
        });
        expect(hasNestedInteractiveNavigation(widgetType)).toBe(false);
        expect(supportsCatalogVariable(widgetType)).toBe(false);
        expect(supportsHierarchy(widgetType)).toBe(false);
    });

    it('falls back to 4×3 for unknown widget types', () => {
        expect(getDefaultSize('unknown-widget')).toEqual({ w: 4, h: 3 });
    });

    it('returns the default icon configured for each widget type', () => {
        expect(getDefaultIcon('kpi')).toBe('Gauge');
        expect(getDefaultIcon('machine-activity')).toBe('HeartPulse');
        expect(getDefaultIcon('metric-card')).toBe('BarChart2');
        expect(getDefaultIcon('trend-chart')).toBe('TrendingUp');
        expect(getDefaultIcon('trend-chart-v2')).toBe('TrendingUp');
        expect(getDefaultIcon('activity-analytics')).toBeNull();
        expect(getDefaultIcon('prod-trend')).toBe('TrendingUp');
        expect(getDefaultIcon('prod-history')).toBe('LineChart');
        expect(getDefaultIcon('alert-history')).toBe('Siren');
        expect(getDefaultIcon('status')).toBeNull();
        expect(getDefaultIcon('connection-status')).toBeNull();
        expect(getDefaultIcon('text-title')).toBeNull();
        expect(getDefaultIcon('info-card')).toBe('Info');
    });

    it('returns null as the default icon for unknown widget types', () => {
        expect(getDefaultIcon('unknown-widget')).toBeNull();
    });
});

describe('widgetCapabilities tab frame eligibility', () => {
    it.each(['machine-activity', 'kpi', 'metric-card', 'info-card', 'group'])(
        'lets %s use the tab frame shape',
        (widgetType) => {
            expect(supportsTabFrame(widgetType)).toBe(true);
        },
    );

    it.each([
        'activity-analytics',
        'prod-trend',
        'prod-history',
        'trend-chart',
        'trend-chart-v2',
        'status',
        'text-title',
        'connection-status',
        'alert-history',
        'not-a-widget-type',
    ])('keeps %s on the standard frame', (widgetType) => {
        expect(supportsTabFrame(widgetType)).toBe(false);
    });
});
