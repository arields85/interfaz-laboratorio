import { useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ArrowDownUp, Download, Plus, Search } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { EppiTableDefinition, EppiTableRow } from '../../../domain';
import AdminActionButton from '../../admin/AdminActionButton';
import DataTable from '../../ui/DataTable';
import HmiButton from '../../ui/HmiButton';
import {
    defineDataTableColumns,
    filterAndSortRows,
    getPageCount,
    paginateRows,
    type DataTableColumn,
    type DataTableDensity,
    type DataTableScrollMode,
    type DataTableSortDirection,
} from '../../ui/dataTableModel';
import { preserveEppiEntryState } from './eppiRouting';
import EppiLabelDialog, { type EppiLabelKind } from './EppiLabelDialog';
import EppiStatusValue from './EppiStatusValue';

interface EppiTablePanelProps {
    definition: EppiTableDefinition;
    density?: DataTableDensity;
    emptyMessage?: string;
    heading?: ReactNode;
    scrollMode?: DataTableScrollMode;
    showToolbar?: boolean;
    variant?: 'clients' | 'default' | 'equipment' | 'locations' | 'logbook' | 'orders' | 'users';
}

function suppressUnavailableClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
}

function suppressUnavailableKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
    }
}

export default function EppiTablePanel({
    definition,
    density = 'normal',
    emptyMessage = 'No se encontraron resultados',
    heading,
    scrollMode = 'auto',
    showToolbar = true,
    variant = 'default',
}: EppiTablePanelProps) {
    const location = useLocation();
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [sortDirection, setSortDirection] = useState<DataTableSortDirection>('descending');
    const [labelDialogKind, setLabelDialogKind] = useState<EppiLabelKind | 'select' | null>(null);
    const columns = useMemo(() => defineDataTableColumns<EppiTableRow>(
        definition.columns.map((column): DataTableColumn<EppiTableRow> => {
            if (column.accessibilityNeutral) {
                return {
                    id: column.id,
                    header: null,
                    widthPercent: column.widthPercent,
                    accessibilityNeutral: true,
                };
            }

            return {
                id: column.id,
                header: column.label,
                widthPercent: column.widthPercent,
                accessor: (currentRow) => currentRow.cells[column.id] ?? '',
                cell: variant === 'logbook' && column.id === 'label'
                    ? ({ value }) => (
                        <button
                            type="button"
                            className="border-0 bg-transparent p-0 text-inherit"
                            aria-label={String(value)}
                            onClick={() => setLabelDialogKind(String(value) as EppiLabelKind)}
                        >
                            <EppiStatusValue value={String(value)} />
                        </button>
                    )
                    : variant === 'logbook' && column.id === 'date'
                        ? ({ value }) => <span className="whitespace-pre-line">{value}</span>
                        : column.status
                            ? ({ value }) => <EppiStatusValue value={String(value)} />
                            : undefined,
                cellSemantics: column.status ? ({ value }) => (
                    value === 'En proceso (en campaña)' ? { ariaLabel: String(value) } : undefined
                ) : undefined,
            };
        }),
    ), [definition.columns, variant]);
    const requestedPage = Number(new URLSearchParams(location.search).get('page')) || 1;
    const capturePage = definition.pagination
        ? Math.min(Math.max(1, requestedPage), definition.pagination.advertisedPageCount)
        : requestedPage;
    const capturedPage = definition.pagination?.pages.find((page) => page.page === capturePage);
    const sourceRows = useMemo(
        () => definition.pagination ? capturedPage?.rows ?? [] : definition.rows,
        [capturedPage, definition.pagination, definition.rows],
    );
    const isUnavailablePage = definition.pagination !== undefined && capturedPage === undefined;
    const usesCapturedTableChrome = variant === 'clients'
        || variant === 'locations'
        || variant === 'logbook'
        || variant === 'orders'
        || variant === 'users';
    const hasCapturedClientTransform = showToolbar && !usesCapturedTableChrome;
    const filteredRows = useMemo(() => hasCapturedClientTransform
        ? filterAndSortRows(
            sourceRows,
            columns,
            query,
            columns[0]?.id ?? '',
            sortDirection,
        )
        : [...sourceRows], [columns, hasCapturedClientTransform, query, sortDirection, sourceRows]);
    const localPageCount = getPageCount(filteredRows.length, definition.pageSize);
    const currentPage = definition.pagination
        ? capturePage
        : Math.min(Math.max(1, requestedPage), localPageCount);
    const visibleRows = definition.pagination
        ? filteredRows
        : paginateRows(filteredRows, currentPage, definition.pageSize);
    const paginationLabels = definition.pagination?.visiblePageLabels
        ?? Array.from({ length: localPageCount }, (_, index) => String(index + 1));

    const navigateToPage = (page: number) => {
        const searchParams = new URLSearchParams(location.search);
        if (page === 1) {
            searchParams.delete('page');
        } else {
            searchParams.set('page', String(page));
        }
        const search = searchParams.toString();
        navigate(`${location.pathname}${search ? `?${search}` : ''}`, {
            state: preserveEppiEntryState(location.state),
        });
    };

    return (
        <>
        <article
            className={`glass-panel group flex min-h-0 min-w-0 flex-col ${
                variant === 'equipment'
                    ? 'w-full flex-none p-5'
                    : usesCapturedTableChrome
                        ? 'flex-1 p-[19px]'
                        : 'flex-1 p-5'
            }`}
            data-testid={variant === 'equipment' ? 'eppi-equipment-panel' : undefined}
        >
            {heading}
            {showToolbar ? (
                <div className={`flex flex-none items-center justify-between gap-3 ${usesCapturedTableChrome ? 'pb-3.5' : 'pb-3'}`}>
                    <label className={`flex items-center gap-2 rounded-2xl border border-industrial-border bg-industrial-hover px-3 text-industrial-muted focus-within:border-admin-accent ${
                        usesCapturedTableChrome
                            ? 'h-[34px] w-[min(20rem,35vw)]'
                            : 'h-9 w-[min(20rem,45vw)]'
                    }`}>
                        <Search size={16} aria-hidden="true" />
                        <span className="sr-only">Buscar en {definition.ariaLabel}</span>
                        <input
                            type="search"
                            value={query}
                            aria-label={`Buscar en ${definition.ariaLabel}`}
                            placeholder="Buscar..."
                            className="min-w-0 flex-1 border-0 bg-transparent font-system text-industrial-text outline-none placeholder:text-industrial-muted"
                            onChange={(event) => {
                                setQuery(event.target.value);
                                if (!definition.pagination && currentPage !== 1) {
                                    navigateToPage(1);
                                }
                            }}
                        />
                    </label>
                    <div className="flex items-center gap-2">
                        {variant === 'orders' ? (
                            <>
                                <HmiButton
                                    size="sm"
                                    variant="secondary"
                                    className="size-[30px] p-1"
                                    aria-label="Ordenar"
                                >
                                    <ArrowDownUp size={16} strokeWidth={2} aria-hidden="true" />
                                </HmiButton>
                                <HmiButton
                                    size="sm"
                                    variant="secondary"
                                    className="size-[30px] p-1"
                                    aria-label="Exportar"
                                    aria-disabled="true"
                                    data-unavailable="true"
                                    title="Exportar"
                                    onClick={suppressUnavailableClick}
                                    onKeyDown={suppressUnavailableKey}
                                    onKeyUp={suppressUnavailableKey}
                                >
                                    <Download size={16} strokeWidth={2} aria-hidden="true" />
                                </HmiButton>
                                <AdminActionButton
                                    variant="primary"
                                    aria-disabled="true"
                                    data-unavailable="true"
                                    title="No disponible en modo de consulta"
                                    onClick={suppressUnavailableClick}
                                    onKeyDown={suppressUnavailableKey}
                                    onKeyUp={suppressUnavailableKey}
                                >
                                    <Plus size={14} strokeWidth={2} aria-hidden="true" />
                                    Cargar nueva
                                </AdminActionButton>
                            </>
                        ) : variant === 'users' ? (
                            <>
                                <HmiButton
                                    size="sm"
                                    variant="secondary"
                                    className="size-[30px] p-1"
                                    aria-label="Ordenar"
                                >
                                    <ArrowDownUp size={16} strokeWidth={2} aria-hidden="true" />
                                </HmiButton>
                                <AdminActionButton
                                    variant="primary"
                                    aria-disabled="true"
                                    data-unavailable="true"
                                    title="No disponible en modo de consulta"
                                    onClick={suppressUnavailableClick}
                                    onKeyDown={suppressUnavailableKey}
                                    onKeyUp={suppressUnavailableKey}
                                >
                                    <Plus size={14} strokeWidth={2} aria-hidden="true" />
                                    Crear nuevo
                                </AdminActionButton>
                            </>
                        ) : variant === 'clients' ? (
                            <AdminActionButton
                                variant="primary"
                                aria-disabled="true"
                                data-unavailable="true"
                                title="No disponible en modo de consulta"
                                onClick={suppressUnavailableClick}
                                onKeyDown={suppressUnavailableKey}
                                onKeyUp={suppressUnavailableKey}
                            >
                                <Plus size={14} strokeWidth={2} aria-hidden="true" />
                                Crear nuevo
                            </AdminActionButton>
                        ) : variant === 'locations' ? (
                            <AdminActionButton
                                variant="primary"
                                aria-disabled="true"
                                data-unavailable="true"
                                title="No disponible en modo de consulta"
                                onClick={suppressUnavailableClick}
                                onKeyDown={suppressUnavailableKey}
                                onKeyUp={suppressUnavailableKey}
                            >
                                <Plus size={14} strokeWidth={2} aria-hidden="true" />
                                Cargar nuevo
                            </AdminActionButton>
                        ) : variant === 'logbook' ? (
                            <>
                                <HmiButton
                                    size="sm"
                                    variant="secondary"
                                    className="size-[30px] p-1"
                                    aria-label="Ordenar"
                                >
                                    <ArrowDownUp size={16} strokeWidth={2} aria-hidden="true" />
                                </HmiButton>
                                <HmiButton
                                    size="sm"
                                    variant="secondary"
                                    className="size-[30px] p-1"
                                    aria-label="Exportar"
                                    aria-disabled="true"
                                    data-unavailable="true"
                                    title="Exportar"
                                    onClick={suppressUnavailableClick}
                                    onKeyDown={suppressUnavailableKey}
                                    onKeyUp={suppressUnavailableKey}
                                >
                                    <Download size={16} strokeWidth={2} aria-hidden="true" />
                                </HmiButton>
                                <AdminActionButton
                                    variant="primary"
                                    onClick={() => setLabelDialogKind('select')}
                                >
                                    <Plus size={14} strokeWidth={2} aria-hidden="true" />
                                    Generar rótulo
                                </AdminActionButton>
                            </>
                        ) : (
                            <HmiButton
                                size="sm"
                                variant="secondary"
                                disabled={isUnavailablePage}
                                aria-label={sortDirection === 'ascending' ? 'Orden descendente' : 'Orden ascendente'}
                                title={sortDirection === 'ascending' ? 'Orden descendente' : 'Orden ascendente'}
                                onClick={() => setSortDirection((current) => current === 'ascending' ? 'descending' : 'ascending')}
                            >
                                <ArrowDownUp size={16} aria-hidden="true" />
                            </HmiButton>
                        )}
                    </div>
                </div>
            ) : null}

            {isUnavailablePage ? (
                <div className="flex min-h-0 flex-1 items-center justify-center text-center text-industrial-muted" role="status">
                    La página {currentPage} no está disponible porque no fue capturada.
                </div>
            ) : visibleRows.length > 0 ? (
                <DataTable
                    ariaLabel={definition.ariaLabel}
                    columns={columns}
                    density={density}
                    rows={visibleRows}
                    minWidth={definition.minWidth}
                    scrollMode={scrollMode}
                    getRowKey={(currentRow) => currentRow.id}
                />
            ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center text-center text-industrial-muted" role="status">
                    {emptyMessage}
                </div>
            )}

            {paginationLabels.length > 1 || variant === 'clients' || variant === 'locations' ? (
                <nav className="flex flex-none justify-end gap-1 pt-3" aria-label={`Paginación de ${definition.ariaLabel}`}>
                    {paginationLabels.map((label, index) => {
                        if (label === '...') {
                            return <span key={`ellipsis-${index}`} className="px-2 py-1 text-industrial-muted" aria-hidden="true">…</span>;
                        }

                        const page = Number(label);
                        const isCaptured = definition.pagination?.pages.some((captured) => captured.page === page) ?? true;
                        const ariaLabel = isCaptured ? `Página ${page}` : `Página ${page} no disponible`;

                        return (
                            <HmiButton
                                key={page}
                                size="sm"
                                variant={page === currentPage ? 'primary' : 'secondary'}
                                className="h-7 min-w-7 px-1 py-0"
                                disabled={!isCaptured}
                                aria-label={ariaLabel}
                                aria-current={page === currentPage ? 'page' : undefined}
                                title={isCaptured ? undefined : 'Esta página no fue capturada'}
                                onClick={() => navigateToPage(page)}
                            >
                                {page}
                            </HmiButton>
                        );
                    })}
                </nav>
            ) : null}
        </article>
        <EppiLabelDialog
            kind={labelDialogKind}
            onClose={() => setLabelDialogKind(null)}
            onSelect={setLabelDialogKind}
        />
        </>
    );
}
