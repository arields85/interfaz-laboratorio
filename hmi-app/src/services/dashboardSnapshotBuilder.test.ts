import { afterEach, describe, expect, it } from 'vitest';

import { alertHistoryStorage } from './AlertHistoryStorageService';
import type { ContractMachine, ConnectionHealth } from '../domain/dataContract.types';
import type { EquipmentSummary } from '../domain/equipment.types';
import { makeDashboard, makeLayout, makeWidget } from '../test/fixtures/dashboard.fixture';
import { buildDashboardSnapshot } from './dashboardSnapshotBuilder';

function makeMachines(): ContractMachine[] {
    return [{
        unitId: 101,
        name: 'Extrusora 101',
        status: 'online',
        lastSuccess: '2026-07-07T10:00:00.000Z',
        ageMs: 0,
        values: {
            oee: {
                value: 91.2,
                unit: '%',
                timestamp: '2026-07-07T10:00:00.000Z',
            },
        },
    }];
}

function makeEquipmentMap(): Map<string, EquipmentSummary> {
    return new Map([
        ['asset-press-1', {
            id: 'asset-press-1',
            name: 'Prensa 1',
            type: 'comprimidora',
            status: 'running',
            connectionState: 'online',
            lastUpdateAt: '2026-07-07T10:00:00.000Z',
            primaryMetrics: [{
                label: 'temperature',
                value: 42,
                unit: '°C',
            }],
        }],
    ]);
}

const connection: ConnectionHealth = {
    globalStatus: 'online',
    lastSuccess: '2026-07-07T10:00:00.000Z',
    ageMs: 0,
};

describe('buildDashboardSnapshot', () => {
    afterEach(() => {
        localStorage.clear();
    });

    it('uses exportId as the external widget id and resolves metric + status widgets', () => {
        const dashboard = makeDashboard({
            id: 'dashboard-main',
            name: 'Producción principal',
            dashboardType: 'line',
            ownerNodeId: 'line-1',
            activeViewId: 'view-main',
            widgets: [
                makeWidget({
                    id: 'widget-status',
                    title: 'Estado máquina',
                    type: 'status',
                    exportId: 'estado_maquina',
                    binding: {
                        mode: 'real_variable',
                        assetId: 'asset-press-1',
                    },
                }),
                makeWidget({
                    id: 'widget-oee',
                    title: 'OEE',
                    exportId: 'oee',
                    binding: {
                        mode: 'real_variable',
                        bindingVersion: 'real-variable-v1',
                        machineId: 101,
                        variableKey: 'oee',
                    },
                }),
            ],
            layout: [
                makeLayout({ widgetId: 'widget-status', x: 1, y: 2, w: 5, h: 3 }),
                makeLayout({ widgetId: 'widget-oee', x: 6, y: 2, w: 5, h: 3 }),
            ],
        });

        const snapshot = buildDashboardSnapshot({
            dashboard,
            connection,
            machines: makeMachines(),
            equipmentMap: makeEquipmentMap(),
            hierarchyNodes: [
                { id: 'plant-1', name: 'Planta Norte', type: 'plant', parentId: null, order: 0 },
                { id: 'line-1', name: 'Línea 1', type: 'line', parentId: 'plant-1', order: 1 },
            ],
            timestamp: '2026-07-07T10:00:05.000Z',
        });

        expect(snapshot).toMatchObject({
            timestamp: '2026-07-07T10:00:05.000Z',
            screen: {
                id: 'dashboard-main',
                name: 'Producción principal',
                ownerNodeId: 'line-1',
                ownerNodeName: 'Línea 1',
                activeViewId: 'view-main',
            },
            machine: {
                machineId: 101,
                name: 'Extrusora 101',
            },
            dashboard: {
                id: 'dashboard-main',
                widgetCount: 2,
            },
        });

        expect(snapshot.widgets).toEqual([
            expect.objectContaining({
                id: 'estado_maquina',
                widgetId: 'widget-status',
                title: 'Estado máquina',
                type: 'status',
                placement: { x: 1, y: 2, w: 5, h: 3 },
                value: 'running',
            }),
            expect.objectContaining({
                id: 'oee',
                widgetId: 'widget-oee',
                title: 'OEE',
                type: 'metric-card',
                placement: { x: 6, y: 2, w: 5, h: 3 },
                value: 91.2,
                unit: '%',
            }),
        ]);
    });

    it('falls back to widget.id and preserves unsupported widgets with null value plus summary metadata', () => {
        const dashboard = makeDashboard({
            widgets: [
                makeWidget({
                    id: 'widget-trend',
                    type: 'trend-chart',
                    title: 'Tendencia',
                }),
            ],
            layout: [makeLayout({ widgetId: 'widget-trend', x: 0, y: 0, w: 8, h: 4 })],
        });

        const snapshot = buildDashboardSnapshot({
            dashboard,
            connection,
            machines: [],
            equipmentMap: new Map(),
            hierarchyNodes: [],
            timestamp: '2026-07-07T10:05:00.000Z',
        });

        expect(snapshot.widgets).toEqual([
            expect.objectContaining({
                id: 'widget-trend',
                widgetId: 'widget-trend',
                value: null,
                unit: null,
                dataSummary: expect.objectContaining({
                    exportKind: 'generic-widget',
                    reason: 'runtime-data-not-available-in-builder',
                }),
            }),
        ]);
    });

    it('exports machine activity widgets with activity label, percent, and power details when binding data resolves', () => {
        const dashboard = makeDashboard({
            widgets: [
                makeWidget({
                    id: 'widget-machine-activity',
                    type: 'machine-activity',
                    title: 'Actividad de Máquina',
                    exportId: 'actividad_maquina',
                    binding: {
                        mode: 'real_variable',
                        bindingVersion: 'real-variable-v1',
                        machineId: 101,
                        variableKey: 'power',
                    },
                    displayOptions: {
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                    },
                }),
            ],
        });

        const snapshot = buildDashboardSnapshot({
            dashboard,
            connection,
            machines: [{
                ...makeMachines()[0],
                values: {
                    power: {
                        value: 0.04,
                        unit: 'kW',
                        timestamp: '2026-07-07T10:00:00.000Z',
                    },
                },
            }],
            equipmentMap: makeEquipmentMap(),
            hierarchyNodes: [],
            timestamp: '2026-07-07T10:05:00.000Z',
        });

        expect(snapshot.widgets).toEqual([
            expect.objectContaining({
                id: 'actividad_maquina',
                widgetId: 'widget-machine-activity',
                title: 'Actividad de Máquina',
                type: 'machine-activity',
                value: 0,
                unit: '%',
                data: {
                    estadoActividad: 'Detenida',
                    actividadPorcentaje: 0,
                    potencia: 0.04,
                    potenciaUnit: 'kW',
                },
            }),
        ]);
    });

    it('exports real machine activity snapshots as producing on the first sample when power is above the producing threshold', () => {
        const dashboard = makeDashboard({
            widgets: [
                makeWidget({
                    id: 'widget-machine-activity-producing',
                    type: 'machine-activity',
                    title: 'Actividad de Máquina',
                    exportId: 'actividad_maquina',
                    binding: {
                        mode: 'real_variable',
                        bindingVersion: 'real-variable-v1',
                        machineId: 101,
                        variableKey: 'power',
                    },
                    displayOptions: {
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                    },
                }),
            ],
        });

        const snapshot = buildDashboardSnapshot({
            dashboard,
            connection,
            machines: [{
                ...makeMachines()[0],
                values: {
                    power: {
                        value: 0.62,
                        unit: 'kW',
                        timestamp: '2026-07-07T10:00:00.000Z',
                    },
                },
            }],
            equipmentMap: makeEquipmentMap(),
            hierarchyNodes: [],
            timestamp: '2026-07-07T10:05:00.000Z',
        });

        expect(snapshot.widgets).toEqual([
            expect.objectContaining({
                id: 'actividad_maquina',
                value: 62,
                unit: '%',
                data: {
                    estadoActividad: 'Produciendo',
                    actividadPorcentaje: 62,
                    potencia: 0.62,
                    potenciaUnit: 'kW',
                },
            }),
        ]);
    });

    it('exports real machine activity snapshots as setup on the first sample when power is between stopped and producing thresholds', () => {
        const dashboard = makeDashboard({
            widgets: [
                makeWidget({
                    id: 'widget-machine-activity-setup',
                    type: 'machine-activity',
                    title: 'Actividad de Máquina',
                    exportId: 'actividad_maquina_setup',
                    binding: {
                        mode: 'real_variable',
                        bindingVersion: 'real-variable-v1',
                        machineId: 101,
                        variableKey: 'power',
                    },
                    displayOptions: {
                        thresholdStopped: 0.15,
                        thresholdProducing: 0.25,
                        powerMin: 0,
                        powerMax: 1,
                    },
                }),
            ],
        });

        const snapshot = buildDashboardSnapshot({
            dashboard,
            connection,
            machines: [{
                ...makeMachines()[0],
                values: {
                    power: {
                        value: 0.2,
                        unit: 'kW',
                        timestamp: '2026-07-07T10:00:00.000Z',
                    },
                },
            }],
            equipmentMap: makeEquipmentMap(),
            hierarchyNodes: [],
            timestamp: '2026-07-07T10:05:00.000Z',
        });

        expect(snapshot.widgets).toEqual([
            expect.objectContaining({
                id: 'actividad_maquina_setup',
                value: 20,
                unit: '%',
                data: {
                    estadoActividad: 'Setup',
                    actividadPorcentaje: 20,
                    potencia: 0.2,
                    potenciaUnit: 'kW',
                },
            }),
        ]);
    });

    it('formats alert history ages relative to the explicit snapshot timestamp', () => {
        const dashboardId = 'dashboard-alert-history';
        const snapshotTimestamp = '2026-07-07T11:00:00.000Z';
        const oneHourAgo = '2026-07-07T10:00:00.000Z';
        alertHistoryStorage.clearHistory(dashboardId);
        localStorage.setItem(`hmi_alert_history_v1_${dashboardId}`, JSON.stringify({
            dashboardId,
            entries: [{
                id: 'ah-oee-1',
                dashboardId,
                widgetId: 'widget-oee',
                widgetTitle: 'OEE',
                toStatus: 'warning',
                fromStatus: 'normal',
                value: 88.6,
                unit: '%',
                detectedAt: oneHourAgo,
            }, {
                id: 'ah-temp-1',
                dashboardId,
                widgetId: 'widget-temp',
                widgetTitle: 'Temperatura',
                toStatus: 'critical',
                fromStatus: 'warning',
                value: 122,
                unit: '°C',
                detectedAt: oneHourAgo,
            }, {
                id: 'ah-speed-1',
                dashboardId,
                widgetId: 'widget-speed',
                widgetTitle: 'Velocidad',
                toStatus: 'warning',
                fromStatus: 'normal',
                value: 15,
                unit: 'rpm',
                detectedAt: oneHourAgo,
            }],
            widgetSnapshots: {},
            lastUpdatedAt: oneHourAgo,
        }));

        const dashboard = makeDashboard({
            widgets: [
                makeWidget({
                    id: 'widget-alert-history',
                    type: 'alert-history',
                    title: 'Histórico de alertas',
                    exportId: 'historico_alertas',
                    displayOptions: {
                        dashboardId,
                        maxVisible: 1,
                    },
                }),
            ],
        });

        const snapshot = buildDashboardSnapshot({
            dashboard,
            connection,
            machines: [],
            equipmentMap: makeEquipmentMap(),
            timestamp: snapshotTimestamp,
        });

        expect(snapshot.widgets).toEqual([
            expect.objectContaining({
                id: 'historico_alertas',
                type: 'alert-history',
                data: {
                    count: 3,
                    items: [{
                        level: 'advertencia',
                        title: 'OEE',
                        age: 'hace 1h',
                        value: '88.60 %',
                    }],
                },
            }),
        ]);

        alertHistoryStorage.clearHistory(dashboardId);
    });

    it('uses the provided snapshot timestamp even when it is different from the wall clock', () => {
        const dashboardId = 'dashboard-alert-history-clock-skew';
        alertHistoryStorage.clearHistory(dashboardId);
        localStorage.setItem(`hmi_alert_history_v1_${dashboardId}`, JSON.stringify({
            dashboardId,
            entries: [{
                id: 'ah-oee-1',
                dashboardId,
                widgetId: 'widget-oee',
                widgetTitle: 'OEE',
                toStatus: 'warning',
                fromStatus: 'normal',
                value: 88.6,
                unit: '%',
                detectedAt: '2026-07-07T10:59:30.000Z',
            }],
            widgetSnapshots: {},
            lastUpdatedAt: '2026-07-07T10:59:30.000Z',
        }));

        const dashboard = makeDashboard({
            widgets: [
                makeWidget({
                    id: 'widget-alert-history',
                    type: 'alert-history',
                    title: 'Histórico de alertas',
                    exportId: 'historico_alertas',
                    displayOptions: {
                        dashboardId,
                        maxVisible: 1,
                    },
                }),
            ],
        });

        const snapshot = buildDashboardSnapshot({
            dashboard,
            connection,
            machines: [],
            equipmentMap: makeEquipmentMap(),
            timestamp: '2026-07-07T11:00:20.000Z',
        });

        expect(snapshot.widgets).toEqual([
            expect.objectContaining({
                id: 'historico_alertas',
                data: {
                    count: 1,
                    items: [{
                        level: 'advertencia',
                        title: 'OEE',
                        age: 'hace un momento',
                        value: '88.60 %',
                    }],
                },
            }),
        ]);

        alertHistoryStorage.clearHistory(dashboardId);
    });

    it('exports producto_receta info cards with semantic keys plus resolved field content', () => {
        const dashboard = makeDashboard({
            widgets: [
                makeWidget({
                    id: 'widget-producto-receta',
                    type: 'info-card',
                    title: 'Producto/receta',
                    exportId: 'producto_receta',
                    displayOptions: {
                        fields: [
                            { id: 'producto', label: 'Producto', value: 'Paracetamol 500 mg' },
                            { id: 'orden', label: 'Orden', value: 'OP-45821' },
                            { id: 'cliente', label: 'Cliente', value: 'FarmaSalud' },
                        ],
                    },
                }),
            ],
        });

        const snapshot = buildDashboardSnapshot({
            dashboard,
            connection,
            machines: [],
            equipmentMap: makeEquipmentMap(),
        });

        expect(snapshot.widgets).toEqual([
            expect.objectContaining({
                id: 'producto_receta',
                type: 'info-card',
                data: expect.objectContaining({
                    producto: 'Paracetamol 500 mg',
                    orden: 'OP-45821',
                    cliente: 'FarmaSalud',
                    fields: [
                        { id: 'producto', label: 'Producto', text: 'Paracetamol 500 mg', subtext: 'Producto', tag: undefined },
                        { id: 'orden', label: 'Orden', text: 'OP-45821', subtext: 'Orden', tag: undefined },
                        { id: 'cliente', label: 'Cliente', text: 'FarmaSalud', subtext: 'Cliente', tag: undefined },
                    ],
                }),
            }),
        ]);
    });

    it('keeps machine activity generic when binding data is truly unavailable', () => {
        const dashboard = makeDashboard({
            widgets: [
                makeWidget({
                    id: 'widget-machine-activity',
                    type: 'machine-activity',
                    title: 'Actividad de Máquina',
                    binding: {
                        mode: 'real_variable',
                        bindingVersion: 'real-variable-v1',
                        machineId: 999,
                        variableKey: 'power',
                    },
                }),
            ],
        });

        const snapshot = buildDashboardSnapshot({
            dashboard,
            connection,
            machines: makeMachines(),
            equipmentMap: makeEquipmentMap(),
        });

        expect(snapshot.widgets).toEqual([
            expect.objectContaining({
                id: 'widget-machine-activity',
                value: null,
                unit: null,
                dataSummary: expect.objectContaining({
                    reason: 'runtime-data-not-available-in-builder',
                }),
            }),
        ]);
    });
});
