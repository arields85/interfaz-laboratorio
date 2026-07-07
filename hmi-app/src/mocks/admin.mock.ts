import type { Dashboard } from '../domain/admin.types';

// =============================================================================
// MOCKS: Admin
// Dashboards configurados para el Modo Administrador.
// Proveen datos simulados para el Gestor de Dashboards y el Builder.
//
// CONVENCIÓN DE HEADER:
// Los widgets asignados en `headerConfig.widgetSlots` deben existir en el
// array `widgets` del mismo dashboard. Son EXCLUSIVOS del header y NO se
// incluyen en `layout` (no se renderizan en el grid).
// =============================================================================

export const mockDashboards: Dashboard[] = [
    {
        id: 'dash-global',
        name: 'Dashboard Principal',
        description: 'Visión general de planta y KPIs principales',
        dashboardType: 'global',
        aspect: '16:9',
        cols: 20,
        rows: 12,
        status: 'published',
        isTemplate: false,
        version: 3,
        // Header configurado: título y subtítulo explícitos + sin widget slots
        // (dashboard global sin equipo específico asociado)
        headerConfig: {
            title: 'Dashboard Principal',
            subtitle: 'Visión general de planta · Turno activo',
        },
        layout: [
            { widgetId: 'w-oee', x: 0, y: 0, w: 1, h: 1 },
            { widgetId: 'w-prod', x: 1, y: 0, w: 1, h: 1 },
            { widgetId: 'w-alarms', x: 2, y: 0, w: 1, h: 1 },
            { widgetId: 'w-line-summary', x: 3, y: 0, w: 6, h: 5 },
        ],
        widgets: [
            {
                id: 'w-oee',
                type: 'kpi',
                title: 'OEE GLOBAL',
                position: { x: 0, y: 0 },
                size: { w: 1, h: 1 },
                binding: { mode: 'simulated_value', simulatedValue: 78.4, unit: '%' }
            },
            {
                id: 'w-prod',
                type: 'kpi',
                title: 'PRODUCCIÓN DEL TURNO',
                position: { x: 1, y: 0 },
                size: { w: 1, h: 1 },
                binding: { mode: 'simulated_value', simulatedValue: 142500, formatter: 'number' }
            },
            {
                id: 'w-alarms',
                type: 'kpi',
                title: 'ALARMAS ACTIVAS',
                position: { x: 2, y: 0 },
                size: { w: 1, h: 1 },
                binding: { mode: 'simulated_value', simulatedValue: 3 }
            },
            {
                id: 'w-line-summary',
                type: 'info-card',
                title: 'LINE SUMMARY',
                position: { x: 3, y: 0 },
                size: { w: 6, h: 5 },
                binding: { mode: 'simulated_value', simulatedValue: 0 },
                displayOptions: {
                    subtitle: 'Static summary',
                    helpText: 'Static admin-authored information only.',
                    icon: 'Info',
                    valueFontSize: 35,
                    fields: [
                        { id: 'field-1', label: 'Batch', value: 'B-204' },
                        { id: 'field-2', label: 'Operator', value: 'Ada' },
                    ],
                },
            }
        ]
    },
    {
        id: 'dash-comp-01',
        name: 'Comprimidora FETTE-2090 (Detalle)',
        description: 'Panel de monitoreo detallado para línea de compresión',
        dashboardType: 'equipment',
        aspect: '16:9',
        cols: 20,
        rows: 12,
        status: 'draft',
        isTemplate: false,
        version: 1,
        // Header configurado: título y subtítulo explícitos + dos widgets de estado en el header.
        // w-hdr-status y w-hdr-conn son EXCLUSIVOS del header: no están en `layout`.
        headerConfig: {
            title: 'Comprimidora FETTE-2090',
            subtitle: 'Panel de monitoreo detallado para línea de compresión',
            widgetSlots: [
                { widgetId: 'w-hdr-status' },
                { widgetId: 'w-hdr-conn' },
            ],
        },
        layout: [
            // w-hdr-status y w-hdr-conn NO están aquí — son exclusivos del header
            { widgetId: 'w-eq-rpm', x: 0, y: 0, w: 1, h: 1 },
            { widgetId: 'w-eq-kn', x: 1, y: 0, w: 1, h: 1 },
        ],
        widgets: [
            // Widgets del header (no tienen entrada en layout)
            {
                id: 'w-hdr-status',
                type: 'status',
                title: 'ESTADO EQUIPO',
                position: { x: 0, y: 0 },
                size: { w: 1, h: 1 },
                binding: { mode: 'real_variable', assetId: 'eq-001' }
            },
            {
                id: 'w-hdr-conn',
                type: 'connection-status',
                title: 'CONEXIÓN',
                position: { x: 0, y: 0 },
                size: { w: 1, h: 1 },
                binding: { mode: 'real_variable', assetId: 'eq-001' }
            },
            // Widgets del grid
            {
                id: 'w-eq-rpm',
                type: 'metric-card',
                title: 'VELOCIDAD',
                position: { x: 0, y: 0 },
                size: { w: 1, h: 1 },
                binding: { mode: 'real_variable', assetId: 'eq-001', variableKey: 'Velocidad', unit: 'RPM', catalogVariableId: 'cv-velocidad-rpm' },
                thresholds: [
                    { value: 1900, severity: 'critical' },
                    { value: 1700, severity: 'warning' }
                ]
            },
            {
                id: 'w-eq-kn',
                type: 'metric-card',
                title: 'FUERZA MÁXIMA',
                position: { x: 1, y: 0 },
                size: { w: 1, h: 1 },
                binding: { mode: 'real_variable', assetId: 'eq-001', variableKey: 'Fuerza', unit: 'kN', catalogVariableId: 'cv-fuerza-kn' },
                thresholds: [
                    { value: 32, severity: 'critical' },
                    { value: 28, severity: 'warning' }
                ]
            }
        ]
    }
];
