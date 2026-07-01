import type { WidgetConfig, WidgetType } from '../domain/admin.types';

/**
 * Capability flags available for each widget type.
 *
 * To enable catalog/hierarchy support for a new widget type,
 * add its capabilities here without touching UI consumers.
 */
export interface WidgetCapabilities {
    /** Widget can be assigned a catalog variable for semantic identity. */
    catalogVariable: boolean;
    /** Widget can aggregate values from hierarchy children. */
    hierarchy: boolean;
    /** Widget renders nested runtime controls that must not be wrapped in button semantics. */
    nestedInteractiveNavigation: boolean;
    /** Default grid size (columns × rows) when the widget is first placed. */
    defaultSize: { w: number; h: number };
    /** Default icon name (Lucide string) when the widget is first placed. Null means no icon. */
    defaultIcon: string | null;
}

const WIDGET_CAPABILITIES: Partial<Record<WidgetType, WidgetCapabilities>> = {
    'kpi': { catalogVariable: false, hierarchy: false, nestedInteractiveNavigation: false, defaultSize: { w: 6, h: 10 }, defaultIcon: 'Gauge' },
    'machine-activity': { catalogVariable: false, hierarchy: false, nestedInteractiveNavigation: false, defaultSize: { w: 6, h: 10 }, defaultIcon: 'HeartPulse' },
    'activity-analytics': { catalogVariable: false, hierarchy: false, nestedInteractiveNavigation: true, defaultSize: { w: 11, h: 9 }, defaultIcon: null },
    'metric-card': { catalogVariable: true, hierarchy: true, nestedInteractiveNavigation: false, defaultSize: { w: 6, h: 5 }, defaultIcon: 'BarChart2' },
    'trend-chart': { catalogVariable: false, hierarchy: false, nestedInteractiveNavigation: false, defaultSize: { w: 11, h: 9 }, defaultIcon: 'TrendingUp' },
    'trend-chart-v2': { catalogVariable: false, hierarchy: false, nestedInteractiveNavigation: true, defaultSize: { w: 11, h: 9 }, defaultIcon: 'TrendingUp' },
    'prod-history': { catalogVariable: false, hierarchy: false, nestedInteractiveNavigation: true, defaultSize: { w: 11, h: 9 }, defaultIcon: 'LineChart' },
    'status': { catalogVariable: false, hierarchy: false, nestedInteractiveNavigation: false, defaultSize: { w: 4, h: 4 }, defaultIcon: null },
    'connection-status': { catalogVariable: false, hierarchy: false, nestedInteractiveNavigation: false, defaultSize: { w: 5, h: 5 }, defaultIcon: null },
    'alert-history': { catalogVariable: false, hierarchy: false, nestedInteractiveNavigation: true, defaultSize: { w: 8, h: 8 }, defaultIcon: 'Siren' },
    'text-title': { catalogVariable: false, hierarchy: false, nestedInteractiveNavigation: false, defaultSize: { w: 5, h: 2 }, defaultIcon: null },
};

/** Default capabilities for unknown widget types. */
const DEFAULT_CAPABILITIES: WidgetCapabilities = {
    catalogVariable: false,
    hierarchy: false,
    nestedInteractiveNavigation: false,
    defaultSize: { w: 4, h: 3 },
    defaultIcon: null,
};

/**
 * Returns the capability set for a widget type.
 */
export function getWidgetCapabilities(widgetType: string): WidgetCapabilities {
    return WIDGET_CAPABILITIES[widgetType as WidgetType] ?? DEFAULT_CAPABILITIES;
}

/**
 * Returns true when the widget type supports catalog variable assignment.
 */
export function supportsCatalogVariable(widgetType: string): boolean {
    return getWidgetCapabilities(widgetType).catalogVariable;
}

/**
 * Returns true when the widget type supports hierarchy aggregation.
 */
export function supportsHierarchy(widgetType: string): boolean {
    return getWidgetCapabilities(widgetType).hierarchy;
}

/**
 * Returns true when the widget renders nested controls that block button-like wrappers.
 */
export function hasNestedInteractiveNavigation(widgetType: string): boolean {
    return getWidgetCapabilities(widgetType).nestedInteractiveNavigation;
}

/**
 * Returns true when a concrete widget config needs nested-interactive navigation handling.
 */
export function hasNestedInteractiveNavigationForConfig(widget: Pick<WidgetConfig, 'type' | 'hierarchyMode'>): boolean {
    const capabilities = getWidgetCapabilities(widget.type);

    return capabilities.nestedInteractiveNavigation
        || (capabilities.hierarchy && widget.hierarchyMode === true);
}

/**
 * Returns the default grid size (w × h) for the given widget type.
 */
export function getDefaultSize(widgetType: string): { w: number; h: number } {
    return getWidgetCapabilities(widgetType).defaultSize;
}

/**
 * Returns the default icon for the given widget type.
 */
export function getDefaultIcon(widgetType: string): string | null {
    return getWidgetCapabilities(widgetType).defaultIcon;
}
