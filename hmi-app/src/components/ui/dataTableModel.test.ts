import { describe, expect, it } from 'vitest';
import {
    defineDataTableColumns,
    filterAndSortRows,
    getPageCount,
    paginateRows,
    validateDataTableColumns,
} from './dataTableModel';

type TestRow = {
    id: string;
    name: string;
    status: string;
};

const rows: readonly TestRow[] = [
    { id: 'row-2', name: 'Mezclador', status: 'Limpio' },
    { id: 'row-1', name: 'Agitador', status: 'Para limpiar' },
    { id: 'row-3', name: 'Compresora', status: 'Limpio' },
];

const columns = defineDataTableColumns<TestRow>([
    { id: 'name', header: 'Nombre', widthPercent: 60, accessor: (row) => row.name },
    { id: 'status', header: 'Estado', widthPercent: 40, accessor: (row) => row.status },
]);

describe('data table model', () => {
    it('validates reusable column contracts', () => {
        expect(() => defineDataTableColumns([
            { id: 'duplicate', header: 'A', widthPercent: 50, accessor: () => 'A' },
            { id: 'duplicate', header: 'B', widthPercent: 50, accessor: () => 'B' },
        ])).toThrow(/unique/i);
        expect(() => defineDataTableColumns([
            { id: 'only', header: 'A', widthPercent: 60, accessor: () => 'A' },
        ])).toThrow(/100%/i);
        expect(() => defineDataTableColumns([
            { id: 'invalid', header: 'A', widthPercent: 0, accessor: () => 'A' },
            { id: 'remaining', header: 'B', widthPercent: 100, accessor: () => 'B' },
        ])).toThrow(/positive/i);

        expect(() => validateDataTableColumns([
            { id: 'name', header: ['Nombre'], widthPercent: 90, accessor: () => 'A' },
            { id: 'reserved', header: null, widthPercent: 10, accessibilityNeutral: true },
        ])).not.toThrow();
    });

    it('filters all visible values case-insensitively and sorts by the selected column', () => {
        expect(filterAndSortRows(rows, columns, 'limpio', 'name', 'ascending').map((row) => row.id)).toEqual([
            'row-3',
            'row-2',
        ]);
        expect(filterAndSortRows(rows, columns, '', 'name', 'descending').map((row) => row.id)).toEqual([
            'row-2',
            'row-3',
            'row-1',
        ]);
    });

    it('paginates without exposing an invalid page', () => {
        expect(getPageCount(3, 2)).toBe(2);
        expect(paginateRows(rows, 2, 2).map((row) => row.id)).toEqual(['row-3']);
        expect(paginateRows(rows, 99, 2).map((row) => row.id)).toEqual(['row-3']);
    });
});
