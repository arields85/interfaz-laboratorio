import type { ReactNode } from 'react';

const PERCENTAGE_TOLERANCE = 0.001;

export type DataTableSortDirection = 'ascending' | 'descending';
export type DataTableAlignment = 'left' | 'center' | 'right';
export type DataTableDensity = 'normal' | 'compact';
export type DataTableScrollMode = 'auto' | 'horizontal';
export type DataTableHeader = Exclude<ReactNode, null | undefined | boolean>;

export interface DataTableHeaderSemantics {
    ariaLabel?: string;
    scope?: 'col' | 'colgroup' | 'row' | 'rowgroup';
}

export interface DataTableCellSemantics {
    ariaHidden?: boolean;
    ariaLabel?: string;
}

export interface DataTableCellContext<Row> {
    column: DataTableDataColumn<Row>;
    row: Row;
    rowIndex: number;
    value: ReactNode;
}

export interface DataTableDataColumn<Row> {
    accessibilityNeutral?: false;
    accessor: (row: Row) => ReactNode;
    align?: DataTableAlignment;
    cell?: (context: DataTableCellContext<Row>) => ReactNode;
    cellSemantics?: (context: DataTableCellContext<Row>) => DataTableCellSemantics | undefined;
    header: DataTableHeader;
    headerSemantics?: DataTableHeaderSemantics;
    id: string;
    widthPercent: number;
}

export interface DataTableReservedColumn {
    accessibilityNeutral: true;
    header: null;
    id: string;
    widthPercent: number;
}

export type DataTableColumn<Row> = DataTableDataColumn<Row> | DataTableReservedColumn;

export function isDataTableDataColumn<Row>(column: DataTableColumn<Row>): column is DataTableDataColumn<Row> {
    return column.accessibilityNeutral !== true;
}

export function validateDataTableColumns<Row>(columns: readonly DataTableColumn<Row>[]): void {
    const ids = new Set<string>();
    let totalWidth = 0;

    for (const column of columns) {
        if (ids.has(column.id)) {
            throw new Error(`DataTable column ids must be unique: ${column.id}`);
        }
        if (!Number.isFinite(column.widthPercent) || column.widthPercent <= 0) {
            throw new Error(`DataTable column width must be positive: ${column.id}`);
        }
        ids.add(column.id);
        totalWidth += column.widthPercent;
    }

    if (Math.abs(totalWidth - 100) > PERCENTAGE_TOLERANCE) {
        throw new Error(`DataTable column widths must total 100%; received ${totalWidth}%`);
    }

}

export function defineDataTableColumns<Row>(columns: readonly DataTableColumn<Row>[]): readonly DataTableColumn<Row>[] {
    validateDataTableColumns(columns);
    return columns;
}

function getReactNodeText(value: ReactNode): string {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
        return String(value);
    }
    if (Array.isArray(value)) {
        return value.map(getReactNodeText).join(' ');
    }
    return '';
}

export function filterAndSortRows<Row>(
    rows: readonly Row[],
    columns: readonly DataTableColumn<Row>[],
    query: string,
    sortColumnId: string,
    direction: DataTableSortDirection,
): Row[] {
    const dataColumns = columns.filter(isDataTableDataColumn);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filteredRows = normalizedQuery.length === 0
        ? [...rows]
        : rows.filter((row) => dataColumns.some((column) => (
            getReactNodeText(column.accessor(row)).toLocaleLowerCase().includes(normalizedQuery)
        )));
    const sortColumn = dataColumns.find((column) => column.id === sortColumnId) ?? dataColumns[0];

    if (!sortColumn) {
        return filteredRows;
    }

    return filteredRows.sort((left, right) => {
        const comparison = getReactNodeText(sortColumn.accessor(left)).localeCompare(
            getReactNodeText(sortColumn.accessor(right)),
            'es',
            { numeric: true, sensitivity: 'base' },
        );
        return direction === 'ascending' ? comparison : -comparison;
    });
}

export function getPageCount(rowCount: number, pageSize: number): number {
    return Math.max(1, Math.ceil(rowCount / pageSize));
}

export function paginateRows<Row>(rows: readonly Row[], page: number, pageSize: number): Row[] {
    const safePage = Math.min(Math.max(1, page), getPageCount(rows.length, pageSize));
    const startIndex = (safePage - 1) * pageSize;
    return rows.slice(startIndex, startIndex + pageSize);
}
