import type { Template } from '../domain/admin.types';

// =============================================================================
// MOCK: Templates
// Template de ejemplo para demostrar el flujo de reutilización.
//
// Especificación Funcional Modo Admin §13
// =============================================================================

export const mockTemplates: Template[] = [
    {
        id: 'tpl-comprimidora-std',
        name: 'Comprimidora Estándar',
        type: 'dashboard',
        aspect: '16:9',
        cols: 40,
        rows: 24,
        dashboardType: 'equipment',
        status: 'active',
        widgetPresets: [
            {
                type: 'status',
                title: 'ESTADO ACTUAL',
                size: { w: 1, h: 1 },
                binding: { mode: 'real_variable' },
            },
            {
                type: 'metric-card',
                title: 'VELOCIDAD',
                size: { w: 1, h: 1 },
                binding: { mode: 'real_variable', variableKey: 'Velocidad', unit: 'RPM' },
                thresholds: [
                    { value: 1900, severity: 'critical' },
                    { value: 1700, severity: 'warning' },
                ],
            },
            {
                type: 'metric-card',
                title: 'FUERZA MÁXIMA',
                size: { w: 1, h: 1 },
                binding: { mode: 'real_variable', variableKey: 'Fuerza', unit: 'kN' },
                thresholds: [
                    { value: 32, severity: 'critical' },
                    { value: 28, severity: 'warning' },
                ],
            },
            {
                type: 'trend-chart',
                title: 'TENDENCIA VELOCIDAD',
                size: { w: 2, h: 1 },
                binding: { mode: 'simulated_value', simulatedValue: 1500, unit: 'RPM' },
            },
            {
                type: 'info-card',
                title: 'LOT INFORMATION',
                size: { w: 6, h: 5 },
                binding: { mode: 'simulated_value', simulatedValue: 0 },
                displayOptions: {
                    subtitle: 'Static summary',
                    helpText: 'Static admin-authored information only.',
                    icon: 'Info',
                    valueFontSize: 35,
                    fields: [
                        { id: 'field-1', label: 'Line', value: 'Compression A' },
                        { id: 'field-2', label: 'Recipe', value: 'Standard' },
                    ],
                },
            },
        ],
        layoutPreset: [
            { widgetId: 'preset-0', x: 0, y: 0, w: 1, h: 1 },
            { widgetId: 'preset-1', x: 1, y: 0, w: 1, h: 1 },
            { widgetId: 'preset-2', x: 2, y: 0, w: 1, h: 1 },
            { widgetId: 'preset-3', x: 0, y: 1, w: 2, h: 1 },
            { widgetId: 'preset-4', x: 2, y: 1, w: 6, h: 5 },
        ],
    },
];
