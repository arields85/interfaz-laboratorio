import { describe, expect, it } from 'vitest';
import {
    eppiAccessControlCapture,
    eppiAuditCapture,
    eppiClientsTable,
    eppiDeviceCards,
    eppiDocumentationCapture,
    eppiEquipmentTable,
    eppiLocationsTable,
    eppiLogbookCapture,
    eppiLogbookTable,
    eppiOrdersCapture,
    eppiOrdersTable,
    eppiPharmaTrialsCapture,
    eppiPharmaTrialsTable,
    eppiProcessCreateCapture,
    eppiProcessesTable,
    eppiProductsCapture,
    eppiProductsTable,
    eppiProductionTable,
    eppiStatisticsCapture,
    eppiToolsTable,
    eppiUsersCapture,
    eppiUsersTable,
} from './index';

function values(table: { rows: readonly { cells: Readonly<Record<string, string>> }[] }, rowIndex: number) {
    return Object.values(table.rows[rowIndex]?.cells ?? {});
}

describe('EPPI captured data provenance', () => {
    it('preserves exact primary table schemas, row counts, order, and representative values', () => {
        expect([eppiOrdersTable.columns.length, eppiOrdersTable.rows.length]).toEqual([9, 50]);
        expect(values(eppiOrdersTable, 0)).toEqual(['23451', 'Victoria Del Rosario', 'A 1', 'Casasco', 'Dilcoran D 160 / 12,5 Mg', 'TN60S', 'Suspensión', 'No', '']);
        expect(values(eppiOrdersTable, 49)[0]).toBe('23402');

        expect([eppiEquipmentTable.columns.length, eppiEquipmentTable.rows.length]).toEqual([8, 3]);
        expect(values(eppiEquipmentTable, 0)).toEqual(['Agitador', 'EP-007', 'Bioamerican', 'Genérico', 'Genérico', 'No', 'N/A', 'Limpio']);
        expect([eppiToolsTable.columns.length, eppiToolsTable.rows.length]).toEqual([8, 3]);
        expect(values(eppiToolsTable, 0)).toEqual(['Malla #14', 'EUP-017', 'Frewitt', 'Genérico', 'Oscilante', 'N/A', 'Limpio']);

        expect([eppiLocationsTable.columns.length, eppiLocationsTable.rows.length]).toEqual([5, 19]);
        expect(values(eppiLocationsTable, 0)[0]).toBe('Calibración y Mezclado III');
        expect(values(eppiLocationsTable, 18)[0]).toBe('Secado III');

        expect([eppiLogbookTable.columns.length, eppiLogbookTable.rows.length]).toEqual([7, 50]);
        expect(values(eppiLogbookTable, 0)).toEqual(['Limpio', 'hace 16 días\n08/08/2026 05:00:00', 'Box M3', 'Antipresol D', '239425', 'Mariano Alberto Suarez', 'Verificado']);

        expect([eppiUsersTable.columns.length, eppiUsersTable.rows.length]).toEqual([7, 50]);
        expect(values(eppiUsersTable, 0)).toEqual(['Adrian Hugo Martinez', 'Operador', '', '23537419', '99', '', 'Activo']);

        expect([eppiClientsTable.columns.length, eppiClientsTable.rows.length]).toEqual([7, 28]);
        expect(values(eppiClientsTable, 0)[0]).toBe('Andrómaco');
        expect(values(eppiClientsTable, 27)[0]).toBe('Weltrap');

        expect([eppiProductsTable.columns.length, eppiProductsTable.rows.length]).toEqual([6, 50]);
        expect(values(eppiProductsTable, 0)).toEqual(['Acenocoumarol', 'Rospaw', 'Comprimido recubierto', '4', 'Miligramo', 'ROS0001']);

        expect([eppiProcessesTable.columns.length, eppiProcessesTable.rows.length]).toEqual([9, 50]);
        expect(values(eppiProcessesTable, 0)).toEqual(['L025M (#1)', 'Compresión (#447)', 'Euretico 50mg', 'Sin box', 'En curso', 'Comprimido', 'Sí', 'Sí', 'No']);

        expect([eppiProductionTable.columns.length, eppiProductionTable.rows.length]).toEqual([8, 19]);
        expect(values(eppiProductionTable, 18)).toEqual(['Secado III', 'Secado III', 'granulacion', 'En proceso', 'Producción', 'ST36M (#22901)', 'Montrate 10 mg', 'En curso']);

        expect([eppiPharmaTrialsTable.columns.length, eppiPharmaTrialsTable.rows.length]).toEqual([9, 50]);
        expect(values(eppiPharmaTrialsTable, 0)[0]).toBe('23399');
        expect(values(eppiPharmaTrialsTable, 49)[0]).toBe('23131');
    });

    it('exposes only captured pagination pages and explicitly marks advertised gaps unavailable', () => {
        const cases = [
            [eppiOrdersCapture, 461, [1, 2], { from: 3, to: 461 }],
            [eppiLogbookCapture, 5918, [1, 2], { from: 3, to: 5918 }],
            [eppiUsersCapture, 3, [1, 2], { from: 3, to: 3 }],
            [eppiProductsCapture, 9, [1, 2], { from: 3, to: 9 }],
            [eppiPharmaTrialsCapture, 81, [1, 2], { from: 3, to: 81 }],
        ] as const;

        for (const [capture, advertisedPageCount, capturedPages, unavailableRange] of cases) {
            expect(capture.advertisedPageCount).toBe(advertisedPageCount);
            expect(capture.pages.map((page) => page.page)).toEqual(capturedPages);
            expect(capture.pages.every((page) => page.rows.length === 50)).toBe(true);
            expect(capture.unavailableRanges).toEqual([unavailableRange]);
        }

        expect(values({ rows: eppiOrdersCapture.pages[1]?.rows ?? [] }, 0)[0]).toBe('23401');
        expect(values({ rows: eppiLogbookCapture.pages[1]?.rows ?? [] }, 49)[2]).toBe('EP-075');
        expect(values({ rows: eppiUsersCapture.pages[1]?.rows ?? [] }, 0)[0]).toBe('Jonathan Andres Monzon');
        expect(values({ rows: eppiProductsCapture.pages[1]?.rows ?? [] }, 49)[0]).toBe('Conductasa');
        expect(values({ rows: eppiPharmaTrialsCapture.pages[1]?.rows ?? [] }, 49)[0]).toBe('22955');
    });

    it('records captured non-table metadata and unavailable boundaries without invention', () => {
        expect(eppiStatisticsCapture.tabs).toEqual(['Lote', 'Producto']);
        expect(eppiStatisticsCapture.searchPlaceholder).toBe('Buscar lote');
        expect(eppiStatisticsCapture.disabledControls).toEqual(['Proceso: Sin asignar', 'Ensayo: Sin asignar']);
        expect(eppiStatisticsCapture.tables).toEqual([]);

        expect(eppiProcessCreateCapture.route).toBe('/app/process/add');
        expect(eppiProcessCreateCapture.productionOrderAndProcessOptions).toHaveLength(403);
        expect(eppiProcessCreateCapture.productionOrderAndProcessOptions[0]).toEqual(['Dilcoran D 160 / 12,5 Mg - Compresión de núcleos', 'Lote UA68S']);

        expect(eppiAccessControlCapture.columns).toEqual(['Tipo', 'Dirección IP / ID del dispositivo', 'Descripción', 'Etiquetas']);
        expect(eppiAccessControlCapture.rows).toEqual([]);
        expect(eppiAccessControlCapture.emptyMessage).toBe('No se encontraron dispositivos');

        expect(eppiDeviceCards).toEqual([
            { label: 'Administrar impresoras', route: '/app/printers', addRoute: '/app/printers/add', addResult: '/403' },
            { label: 'Administrar dispositivos de medición', route: '/app/measurement-devices', addRoute: '/app/measurement-devices/add', addResult: '/403' },
        ]);
        expect(eppiAuditCapture).toMatchObject({
            route: '/403',
            title: 'Acceso no autorizado',
            returnLabel: 'Volver a inicio',
        });
        expect(eppiDocumentationCapture).toMatchObject({
            route: '/app/documentation',
            outerElement: 'iframe',
            contentAvailability: 'unavailable',
        });
    });

    it('contains no invented or sanitized legacy fixture markers', () => {
        const serialized = JSON.stringify({
            eppiOrdersTable,
            eppiEquipmentTable,
            eppiToolsTable,
            eppiLocationsTable,
            eppiLogbookTable,
            eppiUsersTable,
            eppiClientsTable,
            eppiProductsTable,
            eppiProcessesTable,
            eppiProductionTable,
            eppiPharmaTrialsTable,
            eppiDeviceCards,
        });

        for (const marker of ['OP-24021', 'Cliente Alfa', 'Operador 01', 'Producto A', 'LOC-A1', 'Dato omitido', 'Inventario de impresión disponible']) {
            expect(serialized).not.toContain(marker);
        }
    });
});
