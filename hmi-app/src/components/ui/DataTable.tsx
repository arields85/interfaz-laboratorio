import type { Key } from 'react';
import {
    isDataTableDataColumn,
    validateDataTableColumns,
    type DataTableColumn,
    type DataTableDensity,
    type DataTableScrollMode,
} from './dataTableModel';

interface DataTableProps<Row> {
    ariaLabel: string;
    columns: readonly DataTableColumn<Row>[];
    density?: DataTableDensity;
    getRowKey: (row: Row, rowIndex: number) => Key;
    minWidth?: number;
    rows: readonly Row[];
    scrollMode?: DataTableScrollMode;
}

export default function DataTable<Row>({
    ariaLabel,
    columns,
    density = 'normal',
    getRowKey,
    minWidth,
    rows,
    scrollMode = 'auto',
}: DataTableProps<Row>) {
    validateDataTableColumns(columns);
    const compact = density === 'compact';
    const tableClassName = [
        'w-full border-collapse text-left font-system',
        compact ? 'min-w-[948px] table-fixed' : 'min-w-[1120px]',
    ].join(' ');
    const scrollClassName = [
        'hmi-scrollbar min-h-0 min-w-0 border-y border-industrial-border',
        scrollMode === 'horizontal'
            ? 'flex-none overflow-x-auto overflow-y-hidden'
            : 'flex-1 overflow-auto',
    ].join(' ');
    const headerClassName = [
        'sticky top-0 z-10 whitespace-nowrap border-b',
        'border-[color-mix(in_srgb,var(--color-industrial-text)_12%,transparent)]',
        'bg-[color-mix(in_srgb,var(--color-industrial-surface)_94%,transparent)]',
        'font-system uppercase text-industrial-muted',
        compact ? 'p-2.5' : 'px-3 py-[11px]',
    ].join(' ');
    const baseCellClassName = [
        'whitespace-nowrap border-b',
        'border-[color-mix(in_srgb,var(--color-industrial-text)_5.5%,transparent)]',
        compact ? 'p-2.5' : 'px-3 py-2.5',
    ].join(' ');

    return (
        <div className={scrollClassName}>
            <table
                aria-label={ariaLabel}
                className={tableClassName}
                style={minWidth === undefined ? undefined : { minWidth }}
            >
                <colgroup>
                    {columns.map((column) => (
                        <col key={column.id} style={{ width: `${column.widthPercent}%` }} />
                    ))}
                </colgroup>
                <thead>
                    <tr>
                        {columns.map((column, columnIndex) => isDataTableDataColumn(column) ? (
                            <th
                                key={column.id}
                                scope={column.headerSemantics?.scope ?? 'col'}
                                aria-label={column.headerSemantics?.ariaLabel}
                                align={column.align}
                                data-column-index={columnIndex}
                                className={headerClassName}
                            >
                                {column.header}
                            </th>
                        ) : (
                            <th key={column.id} aria-hidden="true" className={headerClassName} />
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, rowIndex) => (
                        <tr
                            key={getRowKey(row, rowIndex)}
                            className="transition-colors hover:bg-[color-mix(in_srgb,var(--color-industrial-text)_4%,transparent)] [&:hover>td:not([aria-hidden='true'])]:text-industrial-text"
                        >
                            {columns.map((column, columnIndex) => {
                                if (!isDataTableDataColumn(column)) {
                                    return (
                                        <td
                                            key={column.id}
                                            aria-hidden="true"
                                            className={baseCellClassName}
                                        />
                                    );
                                }

                                const value = column.accessor(row);
                                const context = { column, row, rowIndex, value };
                                const semantics = column.cellSemantics?.(context);
                                return (
                                    <td
                                        key={column.id}
                                        align={column.align}
                                        data-column-index={columnIndex}
                                        aria-hidden={semantics?.ariaHidden}
                                        aria-label={semantics?.ariaLabel}
                                        className={`${baseCellClassName} text-industrial-muted transition-colors`}
                                    >
                                        {column.cell ? column.cell(context) : value}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export type { DataTableProps };
