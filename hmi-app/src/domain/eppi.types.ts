export type EppiScreenId =
    | 'orders'
    | 'tools'
    | 'locations'
    | 'logbook'
    | 'users'
    | 'clients'
    | 'products'
    | 'processes'
    | 'production'
    | 'pharma-trials'
    | 'statistics'
    | 'audit'
    | 'devices'
    | 'access-control'
    | 'documentation';

export type EppiStatus =
    | 'Activo'
    | 'En curso'
    | 'En proceso'
    | 'En proceso (en campaña)'
    | 'Limpio'
    | 'Para limpiar'
    | 'Pendiente'
    | 'Sin asignar'
    | 'Verificado';

export interface EppiTableDataColumnDefinition {
    accessibilityNeutral?: false;
    id: string;
    label: string;
    status?: boolean;
    widthPercent: number;
}

export interface EppiTableReservedColumnDefinition {
    accessibilityNeutral: true;
    id: string;
    label: null;
    widthPercent: number;
}

export type EppiTableColumnDefinition = EppiTableDataColumnDefinition | EppiTableReservedColumnDefinition;

export interface EppiTableRow {
    id: string;
    cells: Readonly<Record<string, string>>;
}

export interface EppiCapturedPage {
    page: number;
    sourceArtifact: string;
    rows: readonly EppiTableRow[];
}

export interface EppiUnavailablePageRange {
    from: number;
    to: number;
}

export interface EppiCapturedPagination {
    advertisedPageCount: number;
    visiblePageLabels: readonly string[];
    pages: readonly EppiCapturedPage[];
    unavailableRanges: readonly EppiUnavailablePageRange[];
}

export interface EppiTableDefinition {
    ariaLabel: string;
    columns: readonly EppiTableColumnDefinition[];
    minWidth?: number;
    pageSize: number;
    pagination?: EppiCapturedPagination;
    rows: readonly EppiTableRow[];
}
