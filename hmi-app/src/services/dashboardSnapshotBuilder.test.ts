import { describe, expect, it } from 'vitest';

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
});
