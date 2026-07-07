import type {
    Dashboard,
    InfoCardWidgetConfig,
    MetricCardWidgetConfig,
    Template,
    WidgetConfig,
    WidgetLayout,
} from '../../domain/admin.types';
import { DEFAULT_INFO_CARD_VALUE_FONT_SIZE } from '../../utils/infoCardDisplayOptions';

export function makeLayout(overrides: Partial<WidgetLayout> = {}): WidgetLayout {
    return {
        widgetId: 'widget-1',
        x: 0,
        y: 0,
        w: 4,
        h: 3,
        ...overrides,
    };
}

export function makeWidget(overrides: Partial<MetricCardWidgetConfig> = {}): WidgetConfig {
    const widget: MetricCardWidgetConfig = {
        id: 'widget-1',
        type: 'metric-card',
        title: 'Test Widget',
        position: { x: 0, y: 0 },
        size: { w: 4, h: 3 },
        ...overrides,
    };

    return widget;
}

export function makeInfoCardWidget(overrides: Partial<InfoCardWidgetConfig> = {}): InfoCardWidgetConfig {
    return {
        id: 'info-card-1',
        type: 'info-card',
        title: 'INFO-CARD',
        position: { x: 0, y: 0 },
        size: { w: 6, h: 5 },
        binding: { mode: 'simulated_value', simulatedValue: 0 },
        displayOptions: {
            subtitle: 'Static summary',
            icon: 'Info',
            valueFontSize: DEFAULT_INFO_CARD_VALUE_FONT_SIZE,
            fields: [
                { id: 'field-1', label: 'Batch', value: 'B-204', helpText: 'Static admin-authored information only.' },
                { id: 'field-2', label: 'Operator', value: 'Ada' },
            ],
            ...overrides.displayOptions,
        },
        ...overrides,
    };
}

export function makeDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
    return {
        id: 'dashboard-1',
        name: 'Test Dashboard',
        dashboardType: 'free',
        aspect: '16:9',
        cols: 40,
        rows: 24,
        layout: [],
        widgets: [],
        isTemplate: false,
        version: 1,
        status: 'draft',
        ...overrides,
    };
}

export function makeTemplate(overrides: Partial<Template> = {}): Template {
    return {
        id: 'template-1',
        name: 'Test Template',
        type: 'dashboard',
        aspect: '16:9',
        cols: 40,
        rows: 24,
        status: 'active',
        widgetPresets: [],
        layoutPreset: [],
        ...overrides,
    };
}
