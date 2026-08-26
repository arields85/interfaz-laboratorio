import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AdminTag from '../admin/AdminTag';
import DataTable from './DataTable';
import { defineDataTableColumns } from './dataTableModel';

type TestRow = {
    id: string;
    name: string;
    status: string;
};

const rows: readonly TestRow[] = [
    { id: 'row-1', name: 'Agitador', status: 'Limpio' },
];

const columns = defineDataTableColumns<TestRow>([
    {
        id: 'name',
        header: <span>Nombre visible</span>,
        headerSemantics: { ariaLabel: 'Nombre accesible', scope: 'colgroup' },
        widthPercent: 45,
        align: 'center',
        accessor: (row) => row.name,
        cell: ({ column, row, rowIndex, value }) => `${column.id}:${row.id}:${rowIndex}:${String(value)}`,
        cellSemantics: () => ({ ariaLabel: 'Nombre de equipo' }),
    },
    {
        id: 'reserved-fixed-equipment',
        header: null,
        widthPercent: 10,
        accessibilityNeutral: true,
    },
    {
        id: 'status',
        header: 'Estado',
        widthPercent: 45,
        accessor: (row) => row.status,
        cell: ({ value }) => <AdminTag label={String(value)} variant="green" />,
        cellSemantics: () => ({ ariaHidden: true }),
    },
]);

describe('DataTable', () => {
    it('renders the full semantic column contract and excludes reserved cells from accessibility semantics', () => {
        const { container } = render(
            <DataTable
                ariaLabel="Equipo"
                columns={columns}
                rows={rows}
                getRowKey={(row) => row.id}
            />,
        );

        const table = screen.getByRole('table', { name: 'Equipo' });
        expect(table).toHaveClass('font-system');
        expect(table).not.toHaveClass('font-mono');
        expect(table).toHaveClass('min-w-[1120px]');
        expect(table).not.toHaveClass('table-fixed');
        expect(container.querySelector('.hmi-scrollbar')).toHaveClass('overflow-auto');

        const nameHeader = screen.getByRole('columnheader', { name: 'Nombre accesible' });
        expect(nameHeader).toHaveAttribute('scope', 'colgroup');
        expect(nameHeader).toHaveAttribute('align', 'center');
        expect(nameHeader).toHaveAttribute('data-column-index', '0');
        expect(nameHeader).toHaveClass('sticky', 'top-0');

        const reservedHeader = container.querySelector('th[aria-hidden="true"]');
        const reservedCell = container.querySelector('td[aria-hidden="true"]');
        expect(reservedHeader).toBeInTheDocument();
        expect(reservedCell).toBeInTheDocument();
        expect(reservedHeader).not.toHaveAttribute('data-column-index');
        expect(reservedCell).not.toHaveAttribute('data-column-index');
        expect(container.querySelector('td[data-column-index="2"]')).toHaveAttribute('aria-hidden', 'true');

        const nameCell = screen.getByRole('cell', { name: 'Nombre de equipo' });
        expect(nameCell).toHaveAttribute('align', 'center');
        expect(nameCell).toHaveAttribute('data-column-index', '0');
        expect(nameCell).toHaveTextContent('name:row-1:0:Agitador');
    });

    it('renders compact fixed layout and horizontal-only local overflow', () => {
        const { container } = render(
            <DataTable
                ariaLabel="Equipo compacto"
                columns={columns}
                density="compact"
                scrollMode="horizontal"
                rows={rows}
                getRowKey={(row) => row.id}
            />,
        );

        expect(screen.getByRole('table', { name: 'Equipo compacto' })).toHaveClass(
            'font-system',
            'min-w-[948px]',
            'table-fixed',
        );
        expect(container.querySelector('.hmi-scrollbar')).toHaveClass('flex-none', 'overflow-x-auto', 'overflow-y-hidden');
        expect(screen.getByRole('columnheader', { name: 'Nombre accesible' })).toHaveClass('p-2.5');
    });

    it('transitions the token-derived row background and only non-neutral cell text without changing separators', () => {
        const { container } = render(
            <DataTable
                ariaLabel="Hover contract"
                columns={columns}
                rows={rows}
                getRowKey={(row) => row.id}
            />,
        );

        const bodyRow = within(screen.getByRole('table', { name: 'Hover contract' })).getAllByRole('row')[1];
        expect(bodyRow).toHaveClass(
            'hover:bg-[color-mix(in_srgb,var(--color-industrial-text)_4%,transparent)]',
            "[&:hover>td:not([aria-hidden='true'])]:text-industrial-text",
        );
        expect(bodyRow.className).not.toMatch(/hover:border/);

        const dataCells = container.querySelectorAll('tbody td:not([aria-hidden="true"])');
        expect(dataCells).toHaveLength(1);
        for (const cell of dataCells) {
            expect(cell).toHaveClass(
                'border-[color-mix(in_srgb,var(--color-industrial-text)_5.5%,transparent)]',
                'text-industrial-muted',
                'transition-colors',
            );
        }

        const reservedCell = container.querySelector('tbody td[aria-hidden="true"]');
        expect(reservedCell).toHaveClass('border-[color-mix(in_srgb,var(--color-industrial-text)_5.5%,transparent)]');
        expect(reservedCell).not.toHaveClass('text-industrial-muted');
        expect(screen.getByText('Limpio')).toHaveClass('text-accent-green');
        expect(screen.getByText('Limpio')).toHaveClass('uppercase');
        expect(screen.getByText('Limpio')).not.toHaveClass('font-mono');
        expect(container.querySelector('col:nth-child(2)')).toHaveStyle({ width: '10%' });
    });
});
