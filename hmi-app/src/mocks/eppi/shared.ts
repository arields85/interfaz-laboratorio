import type {
    EppiCapturedPage,
    EppiTableColumnDefinition,
    EppiTableDefinition,
    EppiTableRow,
} from '../../domain';

export type CapturedTableRow = readonly string[];

export function createRows(
    sourceKey: string,
    columns: readonly EppiTableColumnDefinition[],
    rows: readonly CapturedTableRow[],
): readonly EppiTableRow[] {
    const dataColumns = columns.filter((column) => column.accessibilityNeutral !== true);
    return rows.map((values, rowIndex) => ({
        id: `${sourceKey}-${rowIndex + 1}`,
        cells: Object.fromEntries(dataColumns.map((column, columnIndex) => [
            column.id,
            values[columnIndex] ?? '',
        ])),
    }));
}

export function createTableDefinition(
    sourceKey: string,
    ariaLabel: string,
    columns: readonly EppiTableColumnDefinition[],
    rows: readonly CapturedTableRow[],
    options: Pick<EppiTableDefinition, 'minWidth' | 'pagination'> = {},
): EppiTableDefinition {
    return {
        ariaLabel,
        columns,
        minWidth: options.minWidth,
        pageSize: Math.max(rows.length, 1),
        pagination: options.pagination,
        rows: createRows(sourceKey, columns, rows),
    };
}

export function createCapturedPage(
    page: number,
    sourceArtifact: string,
    sourceKey: string,
    columns: readonly EppiTableColumnDefinition[],
    rows: readonly CapturedTableRow[],
): EppiCapturedPage {
    return {
        page,
        sourceArtifact,
        rows: createRows(sourceKey, columns, rows),
    };
}
