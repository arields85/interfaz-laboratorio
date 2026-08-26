import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import EppiViewer from './EppiViewer';

function renderViewer(initialEntry = '/eppi/orders') {
    return render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
                <Route path="/eppi/*" element={<EppiViewer />} />
            </Routes>
            <LocationIndicator />
        </MemoryRouter>,
    );
}

function LocationIndicator() {
    const location = useLocation();
    return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>;
}

function getRowValues(table: HTMLElement, rowIndex: number) {
    const row = within(table).getAllByRole('row')[rowIndex];
    expect(row).toBeDefined();
    return within(row!).getAllByRole('cell', { hidden: true }).map((cell) => cell.textContent);
}

describe('EppiViewer', () => {
    it.each([
        ['/eppi/orders', 'Órdenes de producción'],
        ['/eppi/tools', 'Equipamiento'],
        ['/eppi/locations', 'Locales'],
        ['/eppi/logbook', 'Bitácora'],
        ['/eppi/users', 'Usuarios'],
        ['/eppi/clients', 'Clientes'],
    ])('renders the shared captured page heading and identity for %s', (route, title) => {
        renderViewer(route);

        expect(screen.getByRole('heading', { name: title, level: 1 })).toBeInTheDocument();
        const identity = screen.getByLabelText('Nicolas Martin Viviani');
        expect(within(identity).getByRole('heading', { name: 'Nicolas Martin Viviani', level: 2 })).toBeInTheDocument();
        expect(within(identity).getByText('Jefe')).toBeInTheDocument();
        expect(identity).toHaveTextContent('Internet: ✓ Servidor: ✓ Responde Velocidad: ✓ Estable');
        expect(identity.querySelector('.font-system')).toBeInTheDocument();
        expect(identity.querySelectorAll('.font-mono')).toHaveLength(2);
        expect(identity.querySelector('.led-glow-green')).toHaveClass('size-2', 'bg-status-normal');

        const pageTitle = screen.getByRole('heading', { name: title, level: 1 });
        expect(pageTitle.parentElement).toHaveClass('mb-4', 'min-h-18', 'justify-between', 'gap-6');
        expect(pageTitle).toHaveStyle({
            fontFamily: 'var(--font-dashboard-title)',
            fontSize: 'var(--font-size-dashboard-title)',
            fontWeight: 'var(--font-weight-dashboard-title)',
            letterSpacing: 'var(--tracking-dashboard-title)',
        });
    });

    it.each([
        ['/eppi/orders', 'Cargar nueva', true, true, true],
        ['/eppi/locations', 'Cargar nuevo', false, false, true],
        ['/eppi/logbook', 'Generar rótulo', true, true, false],
        ['/eppi/users', 'Crear nuevo', true, false, true],
        ['/eppi/clients', 'Crear nuevo', false, false, true],
    ] as const)(
        'renders the captured toolbar composition for %s',
        (route, actionLabel, hasSort, hasExport, actionIsUnavailable) => {
            renderViewer(route);

            expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'Buscar...');
            const sortButton = screen.queryByRole('button', { name: /Ordenar|Orden ascendente|Orden descendente/ });
            const exportButton = screen.queryByRole('button', { name: 'Exportar' });
            if (hasSort) {
                expect(sortButton).toBeInTheDocument();
            } else {
                expect(sortButton).not.toBeInTheDocument();
            }
            if (hasExport) {
                expect(exportButton).toBeInTheDocument();
            } else {
                expect(exportButton).not.toBeInTheDocument();
            }

            const action = screen.getByRole('button', { name: actionLabel });
            if (actionIsUnavailable) {
                expect(action).toHaveAttribute('aria-disabled', 'true');
                expect(action).toHaveAttribute('data-unavailable', 'true');
                expect(action).not.toBeDisabled();
            } else {
                expect(action).not.toHaveAttribute('aria-disabled', 'true');
            }
        },
    );

    it('reproduces the exact captured Users pages and read-only controls', async () => {
        const user = userEvent.setup();
        renderViewer('/eppi/users');

        expect(screen.getByRole('heading', { name: 'Usuarios', level: 1 })).toBeInTheDocument();
        expect(screen.getByLabelText('Nicolas Martin Viviani')).toHaveTextContent('Internet: ✓ Servidor: ✓ Responde Velocidad: ✓ Estable');

        const search = screen.getByRole('searchbox', { name: 'Buscar en Usuarios' });
        const toolbar = search.parentElement?.parentElement;
        expect(toolbar).not.toBeNull();
        expect(toolbar).toHaveClass('pb-3.5');
        expect(search.parentElement).toHaveClass('h-[34px]', 'w-[min(20rem,35vw)]');
        expect(within(toolbar!).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim())).toEqual([
            'Ordenar', 'Crear nuevo',
        ]);
        expect(screen.queryByRole('button', { name: 'Exportar' })).not.toBeInTheDocument();

        const sortButton = screen.getByRole('button', { name: 'Ordenar' });
        const createButton = screen.getByRole('button', { name: 'Crear nuevo' });
        expect(sortButton.querySelector('.lucide-arrow-down-up')).toBeInTheDocument();
        expect(createButton.querySelector('.lucide-plus')).toBeInTheDocument();
        expect(sortButton).toHaveClass('border-industrial-border', 'bg-industrial-hover', 'hover:bg-industrial-surface');
        expect(createButton).toHaveClass('admin-accent-ghost');
        expect(createButton).toHaveAttribute('aria-disabled', 'true');
        expect(createButton).toHaveAttribute('data-unavailable', 'true');
        expect(createButton).not.toBeDisabled();

        let table = screen.getByRole('table', { name: 'Usuarios' });
        expect(table.closest('article')).toHaveClass('flex-1', 'p-[19px]');
        expect(table.parentElement).toHaveClass('hmi-scrollbar', 'flex-1', 'overflow-auto');
        expect(within(table).getAllByRole('row')).toHaveLength(51);
        expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
            'Usuario', 'Rol', 'Contacto', 'DNI', 'Legajo', 'Sector', 'Estado',
        ]);
        expect(Array.from(table.querySelectorAll('col')).map((column) => column.getAttribute('style'))).toEqual([
            'width: 22%;', 'width: 15%;', 'width: 14%;', 'width: 13%;', 'width: 12%;', 'width: 12%;', 'width: 12%;',
        ]);
        expect(getRowValues(table, 1)).toEqual([
            'Adrian Hugo Martinez', 'Operador', '', '23537419', '99', '', 'Activo',
        ]);
        expect(getRowValues(table, 50)).toEqual([
            'Jonathan Medrano', 'Operador', '', '36044099', 'TEMP-36044099', 'Producción', 'Activo',
        ]);
        expect(within(table).getAllByText('Activo')[0]).toHaveClass('text-accent-green');
        expect(within(table).getAllByRole('row')[1]).toHaveClass('hover:bg-[color-mix(in_srgb,var(--color-industrial-text)_4%,transparent)]');
        expect(within(table).getAllByRole('columnheader')[0]).toHaveClass('sticky', 'top-0');

        expect(screen.getByRole('button', { name: 'Página 2' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Página 3 no disponible' })).toBeDisabled();

        await user.type(search, 'Sergio Emanuel Quiroga');
        await user.click(sortButton);
        await user.click(createButton);
        createButton.focus();
        await user.keyboard('{Enter}');
        expect(within(table).getAllByRole('row')).toHaveLength(51);
        expect(getRowValues(table, 1)[0]).toBe('Adrian Hugo Martinez');
        expect(screen.getByLabelText('Current location')).toHaveTextContent('/eppi/users');

        await user.click(screen.getByRole('button', { name: 'Página 2' }));
        expect(screen.getByLabelText('Current location')).toHaveTextContent('/eppi/users?page=2');
        table = screen.getByRole('table', { name: 'Usuarios' });
        expect(within(table).getAllByRole('row')).toHaveLength(51);
        expect(getRowValues(table, 1)).toEqual([
            'Jonathan Andres Monzon', 'Operador', '', '36440101', 'TEMP-36440101', 'Producción', 'Activo',
        ]);
        expect(getRowValues(table, 50)).toEqual([
            'Sergio Emanuel Quiroga', 'Operador', '', '44381535', '181', 'Producción', 'Activo',
        ]);
    });

    it('marks uncaptured Users page 3 as unavailable without inventing rows', () => {
        renderViewer('/eppi/users?page=3');

        expect(screen.getByText('La página 3 no está disponible porque no fue capturada.')).toBeInTheDocument();
        expect(screen.queryByRole('table', { name: 'Usuarios' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Página 3 no disponible' })).toHaveAttribute('aria-current', 'page');
    });

    it('reproduces the complete captured Clients table and read-only controls', async () => {
        const user = userEvent.setup();
        renderViewer('/eppi/clients');

        expect(screen.getByRole('heading', { name: 'Clientes', level: 1 })).toBeInTheDocument();
        expect(screen.getByLabelText('Nicolas Martin Viviani')).toHaveTextContent('Internet: ✓ Servidor: ✓ Responde Velocidad: ✓ Estable');

        const search = screen.getByRole('searchbox', { name: 'Buscar en Clientes' });
        const toolbar = search.parentElement?.parentElement;
        expect(toolbar).not.toBeNull();
        expect(toolbar).toHaveClass('pb-3.5');
        expect(search.parentElement).toHaveClass('h-[34px]', 'w-[min(20rem,35vw)]');
        expect(within(toolbar!).getAllByRole('button').map((button) => button.textContent?.trim())).toEqual(['Crear nuevo']);
        expect(screen.queryByRole('button', { name: /Ordenar|Orden ascendente|Orden descendente/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Exportar' })).not.toBeInTheDocument();

        const createButton = screen.getByRole('button', { name: 'Crear nuevo' });
        expect(createButton.querySelector('.lucide-plus')).toBeInTheDocument();
        expect(createButton).toHaveClass('admin-accent-ghost');
        expect(createButton).toHaveAttribute('aria-disabled', 'true');
        expect(createButton).toHaveAttribute('data-unavailable', 'true');
        expect(createButton).not.toBeDisabled();

        const table = screen.getByRole('table', { name: 'Clientes' });
        expect(table.closest('article')).toHaveClass('flex-1', 'p-[19px]');
        expect(table).toHaveStyle({ minWidth: '1240px' });
        expect(table.parentElement).toHaveClass('hmi-scrollbar', 'flex-1', 'overflow-auto');
        expect(within(table).getAllByRole('row')).toHaveLength(29);
        expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
            'Empresa', 'Teléfono', 'Dirección', 'Localidad', 'Provincia', 'País', 'Contactos',
        ]);
        expect(Array.from(table.querySelectorAll('col')).map((column) => column.getAttribute('style'))).toEqual([
            'width: 14%;', 'width: 13%;', 'width: 29%;', 'width: 11%;', 'width: 11%;', 'width: 10%;', 'width: 12%;',
        ]);
        expect(getRowValues(table, 1)).toEqual([
            'Andrómaco', '', 'Av. Ing Huergo 1145, C1107 CABA --', '', '', '', '1 contacto',
        ]);
        expect(getRowValues(table, 19)).toEqual([
            'Roemmers', '011 4346 9744', 'Fray Justo Sarmiento 2350', 'Olivos', 'BUENOS AIRES', 'Argentina', '1 contacto',
        ]);
        expect(getRowValues(table, 28)).toEqual([
            'Weltrap', '', 'Balcarce 1072, Rosario, Santa Fé --', '', '', '', '0 contacto',
        ]);
        expect(within(table).getAllByRole('row')[1]).toHaveClass('hover:bg-[color-mix(in_srgb,var(--color-industrial-text)_4%,transparent)]');
        expect(within(table).getAllByRole('columnheader')[0]).toHaveClass('sticky', 'top-0');

        const pagination = screen.getByRole('navigation', { name: 'Paginación de Clientes' });
        expect(within(pagination).getAllByRole('button')).toHaveLength(1);
        expect(within(pagination).getByRole('button', { name: 'Página 1' })).toHaveAttribute('aria-current', 'page');

        await user.type(search, 'Weltrap');
        await user.click(createButton);
        createButton.focus();
        await user.keyboard('{Enter}');
        expect(within(table).getAllByRole('row')).toHaveLength(29);
        expect(screen.getByLabelText('Current location')).toHaveTextContent('/eppi/clients');
    });

    it('renders exact captured orders and exposes only captured pagination pages', async () => {
        const user = userEvent.setup();
        renderViewer();

        expect(screen.getByRole('heading', { name: 'Órdenes de producción' })).toBeInTheDocument();
        const search = screen.getByRole('searchbox', { name: 'Buscar en Órdenes de producción' });
        const toolbar = search.parentElement?.parentElement;
        expect(toolbar).not.toBeNull();
        expect(toolbar).toHaveClass('pb-3.5');
        expect(search.parentElement).toHaveClass('h-[34px]', 'w-[min(20rem,35vw)]');
        expect(search.parentElement?.querySelector('.lucide-search')).toBeInTheDocument();

        const toolbarButtons = within(toolbar!).getAllByRole('button');
        expect(toolbarButtons.map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim())).toEqual([
            'Ordenar',
            'Exportar',
            'Cargar nueva',
        ]);
        const sort = screen.getByRole('button', { name: 'Ordenar' });
        const exportButton = screen.getByRole('button', { name: 'Exportar' });
        const createButton = screen.getByRole('button', { name: 'Cargar nueva' });
        expect(sort.querySelector('.lucide-arrow-down-up')).toBeInTheDocument();
        expect(exportButton.querySelector('.lucide-download')).toBeInTheDocument();
        expect(createButton.querySelector('.lucide-plus')).toBeInTheDocument();
        expect(sort).toHaveClass('border-industrial-border', 'bg-industrial-hover', 'hover:bg-industrial-surface');
        expect(createButton).toHaveClass('admin-accent-ghost');
        for (const unavailableButton of [exportButton, createButton]) {
            expect(unavailableButton).toHaveAttribute('aria-disabled', 'true');
            expect(unavailableButton).toHaveAttribute('data-unavailable', 'true');
            expect(unavailableButton).not.toBeDisabled();
        }

        expect(screen.getByRole('button', { name: 'Página 2' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Página 3 no disponible' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Página 4 no disponible' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Página 461 no disponible' })).toBeDisabled();
        expect(screen.getByText('…')).toBeInTheDocument();

        let table = screen.getByRole('table', { name: 'Órdenes de producción' });
        expect(table.closest('article')).toHaveClass('flex-1', 'p-[19px]');
        expect(within(table).getAllByRole('row')).toHaveLength(51);
        expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
            'Orden',
            'Responsable',
            'Ubicación',
            'Cliente',
            'Producto',
            'Lote',
            'Forma Farmacéutica',
            'En proceso',
            'Verificada',
        ]);
        expect(Array.from(table.querySelectorAll('col')).map((column) => column.getAttribute('style'))).toEqual([
            'width: 8%;',
            'width: 16%;',
            'width: 8%;',
            'width: 10%;',
            'width: 19%;',
            'width: 9%;',
            'width: 14%;',
            'width: 8%;',
            'width: 8%;',
        ]);
        expect(table).toHaveStyle({ minWidth: '1120px' });
        expect(table.parentElement).toHaveClass('hmi-scrollbar', 'flex-1', 'overflow-auto');
        expect(within(table).getAllByRole('columnheader')[0]).toHaveClass('sticky', 'top-0');
        expect(within(within(table).getAllByRole('row')[1]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
            '23451', 'Victoria Del Rosario', 'A 1', 'Casasco', 'Dilcoran D 160 / 12,5 Mg', 'TN60S', 'Suspensión', 'No', '',
        ]);
        expect(within(within(table).getAllByRole('row')[50]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
            '23402', 'Victoria Del Rosario', 'A 1', 'Casasco', 'Ampliar 40 mg', 'TH21S', 'Suspensión', 'No', '',
        ]);
        expect(screen.queryByText('23401')).not.toBeInTheDocument();

        await user.type(search, '23399');
        await user.click(sort);
        await user.click(exportButton);
        exportButton.focus();
        await user.keyboard('{Enter}');
        await user.click(createButton);
        createButton.focus();
        await user.keyboard('{Enter}');

        table = screen.getByRole('table', { name: 'Órdenes de producción' });
        expect(within(table).getAllByRole('row')).toHaveLength(51);
        expect(within(table).getAllByRole('row')[1]).toHaveTextContent('23451');
        expect(screen.getByLabelText('Current location')).toHaveTextContent('/eppi/orders');

        await user.click(screen.getByRole('button', { name: 'Página 2' }));

        expect(screen.getByLabelText('Current location')).toHaveTextContent('/eppi/orders?page=2');
        table = screen.getByRole('table', { name: 'Órdenes de producción' });
        expect(within(table).getAllByRole('row')).toHaveLength(51);
        expect(within(within(table).getAllByRole('row')[1]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
            '23401', 'Victoria Del Rosario', 'A 1', 'Casasco', 'Ampliar 40 mg', 'TH23M', 'Granulado', 'No', '',
        ]);
        expect(within(within(table).getAllByRole('row')[3]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
            '23399', 'Victoria Del Rosario', 'A 1', 'Casasco', 'Ampliar 40 mg', 'TH21M', 'Granulado', 'Sí', '',
        ]);
        expect(within(within(table).getAllByRole('row')[50]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
            '23352', 'Victoria Del Rosario', 'A 1', 'Casasco', 'Dilcoran 160 mg', 'TC37P', 'Comprimido recubierto', 'No', '',
        ]);
        expect(screen.queryByText('23451')).not.toBeInTheDocument();
    });

    it('marks an uncaptured advertised page as unavailable', () => {
        renderViewer('/eppi/orders?page=3');

        expect(screen.getByText('La página 3 no está disponible porque no fue capturada.')).toBeInTheDocument();
        expect(screen.queryByRole('table', { name: 'Órdenes de producción' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Página 3 no disponible' })).toHaveAttribute('aria-current', 'page');
    });

    it('reproduces the two equipment panels without an invented table toolbar', async () => {
        const user = userEvent.setup();
        renderViewer('/eppi/tools');

        const panels = screen.getAllByTestId('eppi-equipment-panel');
        expect(panels).toHaveLength(2);
        for (const panel of panels) {
            expect(panel).toHaveClass('w-full', 'flex-none', 'p-5');
            expect(panel.querySelector('.hmi-scrollbar')).toHaveClass('flex-none', 'overflow-x-auto', 'overflow-y-hidden');
        }
        for (const [headingName, iconClass] of [['Equipo', '.lucide-settings'], ['Elemento de uso', '.lucide-boxes']] as const) {
            const heading = screen.getByRole('heading', { name: headingName, level: 2 });
            expect(heading.parentElement?.parentElement).toHaveClass('pb-3.5');
            expect(heading.parentElement?.parentElement).not.toHaveClass('pb-3');
            expect(heading.parentElement).toHaveClass('text-industrial-muted', 'group-hover:text-industrial-text');
            expect(heading.parentElement?.querySelector(iconClass)).toBeInTheDocument();
        }
        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Ordenar|Orden ascendente|Orden descendente/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Exportar' })).not.toBeInTheDocument();

        const viewAllButtons = screen.getAllByRole('button', { name: 'Ver todo' });
        const equipmentButton = screen.getByRole('button', { name: 'Equipo' });
        const toolButton = screen.getByRole('button', { name: 'Elemento de uso' });
        expect(viewAllButtons).toHaveLength(2);
        expect(viewAllButtons[0]?.querySelector('.lucide-external-link')).toBeInTheDocument();
        expect(viewAllButtons[1]?.querySelector('.lucide-external-link')).toBeInTheDocument();
        expect(equipmentButton.querySelector('.lucide-plus')).toBeInTheDocument();
        expect(toolButton.querySelector('.lucide-plus')).toBeInTheDocument();
        expect(viewAllButtons[0]).toHaveClass('border-white/10', 'bg-white/5', 'hover:bg-white/10');
        expect(equipmentButton).toHaveClass('admin-accent-ghost');

        expect(within(panels[0]!).getAllByRole('button').map((button) => button.textContent?.trim())).toEqual(['Ver todo', 'Equipo']);
        expect(within(panels[1]!).getAllByRole('button').map((button) => button.textContent?.trim())).toEqual(['Ver todo', 'Elemento de uso']);

        for (const unavailableButton of [...viewAllButtons, equipmentButton, toolButton]) {
            expect(unavailableButton).toHaveAttribute('aria-disabled', 'true');
            expect(unavailableButton).toHaveAttribute('data-unavailable', 'true');
            expect(unavailableButton).not.toBeDisabled();
            await user.click(unavailableButton);
            unavailableButton.focus();
            await user.keyboard('{Enter}');
        }
        expect(screen.getByLabelText('Current location')).toHaveTextContent('/eppi/tools');

        const equipmentTable = screen.getByRole('table', { name: 'Equipo' });
        const toolTable = screen.getByRole('table', { name: 'Elemento de uso' });
        const equipmentRows = within(equipmentTable).getAllByRole('row');
        const toolRows = within(toolTable).getAllByRole('row');
        expect(equipmentRows).toHaveLength(4);
        expect(toolRows).toHaveLength(4);
        expect(getRowValues(equipmentTable, 1)).toEqual(['Agitador', 'EP-007', 'Bioamerican', 'Genérico', 'Genérico', 'No', 'N/A', 'Limpio']);
        expect(getRowValues(equipmentTable, 2)).toEqual(['Agitador', 'EP-054', 'Dlab', 'Genérico', 'OS70PRO', 'No', 'N/A', 'Limpio']);
        expect(getRowValues(equipmentTable, 3)).toEqual(['Agitador', 'EP-021', 'DLab', 'Genérico', 'Genérico', 'No', 'N/A', 'Para limpiar']);
        expect(getRowValues(toolTable, 1)).toEqual(['Malla #14', 'EUP-017', 'Frewitt', 'Genérico', 'Oscilante', '', 'N/A', 'Limpio']);
        expect(getRowValues(toolTable, 2)).toEqual(['Matr. Cetirizina', 'P-04', 'Genérico', 'Genérico', 'Genérico', '', 'N/A', 'Limpio']);
        expect(getRowValues(toolTable, 3)).toEqual(['Matr. Mectin XR 1000', 'P-03', 'Natoli', 'Genérico', 'Genérico', '', 'N/A', 'En proceso(en campaña)']);
        expect(screen.getAllByText('Limpio')[0]).toHaveClass('text-accent-green');
        expect(screen.getByText('Para limpiar')).toHaveClass('text-accent-amber');
        expect(within(toolTable).getByText('En proceso')).toHaveClass('text-accent-cyan');

        expect(equipmentRows[1]).toHaveClass('hover:bg-[color-mix(in_srgb,var(--color-industrial-text)_4%,transparent)]');
        expect(equipmentRows[1]?.querySelector('td')).toHaveClass('text-industrial-muted', 'transition-colors');
        expect(equipmentTable).toHaveClass('table-fixed', 'min-w-[948px]');
        expect(toolTable).toHaveClass('table-fixed', 'min-w-[948px]');
        expect(equipmentTable).toHaveStyle({ minWidth: '948px' });
        expect(toolTable).toHaveStyle({ minWidth: '948px' });

        expect(within(equipmentTable).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
            'Nombre', 'TAG', 'Marca', 'Número de serie', 'Modelo', 'Equipo fijo', 'Observaciones', 'Estado',
        ]);
        expect(Array.from(equipmentTable.querySelectorAll('col')).map((column) => column.getAttribute('style'))).toEqual([
            'width: 17%;', 'width: 8%;', 'width: 10%;', 'width: 13%;', 'width: 10%;', 'width: 10%;', 'width: 12%;', 'width: 20%;',
        ]);

        const toolHeaderCells = within(screen.getByRole('table', { name: 'Elemento de uso' })).getAllByRole('columnheader');
        expect(toolHeaderCells).toHaveLength(7);
        expect(toolHeaderCells.map((header) => header.textContent)).toEqual([
            'Nombre', 'TAG', 'Marca', 'Número de serie', 'Modelo', 'Observaciones', 'Estado',
        ]);
        expect(toolTable.querySelector('th[aria-hidden="true"]')).toBeInTheDocument();
        expect(Array.from(toolTable.querySelectorAll('col')).map((column) => column.getAttribute('style'))).toEqual([
            'width: 17%;', 'width: 8%;', 'width: 10%;', 'width: 13%;', 'width: 10%;', 'width: 10%;', 'width: 12%;', 'width: 20%;',
        ]);
    });

    it('reproduces the exact captured Locations table and controls', async () => {
        const user = userEvent.setup();
        renderViewer('/eppi/locations');

        expect(screen.getByRole('heading', { name: 'Locales', level: 1 })).toBeInTheDocument();
        expect(screen.getByLabelText('Nicolas Martin Viviani')).toHaveTextContent('Internet: ✓ Servidor: ✓ Responde Velocidad: ✓ Estable');

        const search = screen.getByRole('searchbox', { name: 'Buscar en Locales' });
        expect(search).toHaveAttribute('placeholder', 'Buscar...');
        expect(search.parentElement).toHaveClass('h-[34px]', 'w-[min(20rem,35vw)]');
        expect(screen.queryByRole('button', { name: /Ordenar|Orden ascendente|Orden descendente/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Exportar' })).not.toBeInTheDocument();

        const createButton = screen.getByRole('button', { name: 'Cargar nuevo' });
        expect(createButton.querySelector('.lucide-plus')).toBeInTheDocument();
        expect(createButton).toHaveClass('admin-accent-ghost');
        expect(createButton).toHaveAttribute('aria-disabled', 'true');
        expect(createButton).toHaveAttribute('data-unavailable', 'true');
        expect(createButton).not.toBeDisabled();

        const table = screen.getByRole('table', { name: 'Locales' });
        expect(table.closest('article')).toHaveClass('flex-1', 'p-[19px]');
        expect(table.parentElement).toHaveClass('hmi-scrollbar', 'flex-1', 'overflow-auto');
        expect(within(table).getAllByRole('row')).toHaveLength(20);
        expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
            'Nombre', 'TAG', 'Uso', 'Observaciones', 'Estado',
        ]);
        expect(Array.from(table.querySelectorAll('col')).map((column) => column.getAttribute('style'))).toEqual([
            'width: 24%;', 'width: 18%;', 'width: 18%;', 'width: 20%;', 'width: 20%;',
        ]);
        expect(getRowValues(table, 1)).toEqual(['Calibración y Mezclado III', 'Mezclado III', 'granulacion', 'N/A', 'En proceso(en campaña)']);
        expect(getRowValues(table, 11)).toEqual(['Granulación III', 'Granulación III', 'granulacion', 'N/A', 'Para limpiar']);
        expect(getRowValues(table, 19)).toEqual(['Secado III', 'Secado III', 'granulacion', 'N/A', 'En proceso']);
        expect(within(table).getAllByRole('row')[1]).toHaveClass('hover:bg-[color-mix(in_srgb,var(--color-industrial-text)_4%,transparent)]');
        expect(within(table).getAllByRole('columnheader')[0]).toHaveClass('sticky', 'top-0');
        expect(within(table).getAllByText('Limpio')[0]).toHaveClass('text-accent-green');
        expect(within(table).getAllByText('Para limpiar')[0]).toHaveClass('text-accent-amber');

        const pagination = screen.getByRole('navigation', { name: 'Paginación de Locales' });
        expect(within(pagination).getAllByRole('button')).toHaveLength(1);
        expect(within(pagination).getByRole('button', { name: 'Página 1' })).toHaveAttribute('aria-current', 'page');

        await user.type(search, 'Secado III');
        await user.click(createButton);
        createButton.focus();
        await user.keyboard('{Enter}');

        expect(within(table).getAllByRole('row')).toHaveLength(20);
        expect(screen.getByLabelText('Current location')).toHaveTextContent('/eppi/locations');
    });

    it('keeps the captured single-page pagination visible for clients', () => {
        renderViewer('/eppi/clients');

        expect(screen.getByRole('button', { name: 'Página 1' })).toHaveAttribute('aria-current', 'page');
    });

    it('reproduces the exact captured Logbook pages, toolbar and table contract', async () => {
        const user = userEvent.setup();
        renderViewer('/eppi/logbook');

        expect(screen.getByRole('heading', { name: 'Bitácora', level: 1 })).toBeInTheDocument();
        expect(screen.getByLabelText('Nicolas Martin Viviani')).toHaveTextContent('Internet: ✓ Servidor: ✓ Responde Velocidad: ✓ Estable');

        const search = screen.getByRole('searchbox', { name: 'Buscar en Bitácora' });
        const toolbar = search.parentElement?.parentElement;
        expect(toolbar).not.toBeNull();
        expect(toolbar).toHaveClass('pb-3.5');
        expect(search).toHaveAttribute('placeholder', 'Buscar...');
        expect(search.parentElement).toHaveClass('h-[34px]', 'w-[min(20rem,35vw)]');
        expect(within(toolbar!).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim())).toEqual([
            'Ordenar', 'Exportar', 'Generar rótulo',
        ]);

        const sortButton = screen.getByRole('button', { name: 'Ordenar' });
        const exportButton = screen.getByRole('button', { name: 'Exportar' });
        const generateButton = screen.getByRole('button', { name: 'Generar rótulo' });
        expect(sortButton.querySelector('.lucide-arrow-down-up')).toBeInTheDocument();
        expect(exportButton.querySelector('.lucide-download')).toBeInTheDocument();
        expect(generateButton.querySelector('.lucide-plus')).toBeInTheDocument();
        expect(exportButton).toHaveAttribute('aria-disabled', 'true');
        expect(exportButton).toHaveAttribute('data-unavailable', 'true');
        expect(exportButton).not.toBeDisabled();
        expect(generateButton).toHaveClass('admin-accent-ghost');
        expect(generateButton).not.toHaveAttribute('aria-disabled', 'true');

        let table = screen.getByRole('table', { name: 'Bitácora' });
        expect(table.closest('article')).toHaveClass('flex-1', 'p-[19px]');
        expect(table).toHaveStyle({ minWidth: '1050px' });
        expect(table.parentElement).toHaveClass('hmi-scrollbar', 'flex-1', 'overflow-auto');
        expect(within(table).getAllByRole('row')).toHaveLength(51);
        expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
            'Rótulo', 'Fecha/Hora', 'Tag', 'Producto', 'Lote', 'Realizó', 'Verificado',
        ]);
        expect(Array.from(table.querySelectorAll('col')).map((column) => column.getAttribute('style'))).toEqual([
            'width: 16%;', 'width: 18%;', 'width: 12%;', 'width: 16%;', 'width: 11%;', 'width: 17%;', 'width: 10%;',
        ]);
        expect(getRowValues(table, 1)).toEqual([
            'Limpio', 'hace 16 días\n08/08/2026 05:00:00', 'Box M3', 'Antipresol D', '239425', 'Mariano Alberto Suarez', 'Verificado',
        ]);
        expect(getRowValues(table, 50)).toEqual([
            'Para limpiar', 'hace 17 días\n07/08/2026 15:00:51', 'EP-082', 'Dilcoran 80 mg', 'TM55M', 'Gabriel Nicolas Mieres', 'Verificado',
        ]);
        expect(within(table).getAllByRole('row')[1]).toHaveClass('hover:bg-[color-mix(in_srgb,var(--color-industrial-text)_4%,transparent)]');
        expect(within(table).getAllByRole('columnheader')[0]).toHaveClass('sticky', 'top-0');

        const pagination = screen.getByRole('navigation', { name: 'Paginación de Bitácora' });
        expect(within(pagination).getAllByRole('button').map((button) => button.textContent)).toEqual(['1', '2', '3', '4', '5918']);
        expect(within(pagination).getByText('…')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Página 2' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Página 3 no disponible' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Página 4 no disponible' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Página 5918 no disponible' })).toBeDisabled();

        await user.type(search, 'EP-075');
        await user.click(sortButton);
        await user.click(exportButton);
        exportButton.focus();
        await user.keyboard('{Enter}');
        expect(within(table).getAllByRole('row')).toHaveLength(51);
        expect(getRowValues(table, 1)[2]).toBe('Box M3');
        expect(screen.getByLabelText('Current location')).toHaveTextContent('/eppi/logbook');

        await user.click(screen.getByRole('button', { name: 'Página 2' }));
        expect(screen.getByLabelText('Current location')).toHaveTextContent('/eppi/logbook?page=2');
        table = screen.getByRole('table', { name: 'Bitácora' });
        expect(within(table).getAllByRole('row')).toHaveLength(51);
        expect(getRowValues(table, 1)).toEqual([
            'Para limpiar', 'hace 17 días\n07/08/2026 15:00:51', 'EUP-052', 'Dilcoran 80 mg', 'TM55M', 'Gabriel Nicolas Mieres', 'Verificado',
        ]);
        expect(getRowValues(table, 50)).toEqual([
            'En proceso(en campaña)', 'hace 17 días\n07/08/2026 11:30:32', 'EP-075', 'Duflegrip', '196426', 'Hernan Dario Segovia', 'Verificado',
        ]);
    });

    it('marks an uncaptured Logbook page as unavailable without inventing rows', () => {
        renderViewer('/eppi/logbook?page=3');

        expect(screen.getByText('La página 3 no está disponible porque no fue capturada.')).toBeInTheDocument();
        expect(screen.queryByRole('table', { name: 'Bitácora' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Página 3 no disponible' })).toHaveAttribute('aria-current', 'page');
    });

    it('reproduces the captured logbook label dialog states without printing', async () => {
        const user = userEvent.setup();
        renderViewer('/eppi/logbook');

        await user.click(screen.getByRole('button', { name: 'Generar rótulo' }));
        let dialog = screen.getByRole('dialog', { name: 'Seleccionar tipo de rótulo' });
        expect(within(dialog).getByText('Elegí la plantilla que querés completar e imprimir.')).toBeInTheDocument();
        expect(within(dialog).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim())).toEqual([
            'Cerrar', 'Limpio', 'Para limpiar', 'En proceso', 'En proceso (en campaña)',
        ]);
        expect(dialog.querySelector('.hmi-scrollbar')).toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: 'Limpio' }));
        dialog = screen.getByRole('dialog', { name: 'Limpio' });
        for (const field of [
            'Producto anterior',
            'Lote anterior',
            'Orden anterior',
            'Ambiente/Equipo',
            'Tag',
            'Fecha/Hora',
            'Validez',
            'Realizó',
            'Verificó',
            'Observaciones',
        ]) {
            expect(within(dialog).getByLabelText(field)).toBeInTheDocument();
        }
        expect(within(dialog).getByLabelText('Fecha/Hora')).toHaveValue('2026-08-24T10:54');
        expect(within(dialog).getByLabelText('Validez')).toHaveValue('2026-08-27');
        const printButton = within(dialog).getByRole('button', { name: 'Imprimir Rótulo' });
        expect(printButton).toHaveTextContent('Imprimir');
        expect(printButton.querySelector('.lucide-printer')).toBeInTheDocument();
        expect(printButton).toHaveAttribute('aria-disabled', 'true');
        expect(printButton).toHaveAttribute('data-unavailable', 'true');
        expect(printButton).not.toBeDisabled();
        await user.click(printButton);
        printButton.focus();
        await user.keyboard('{Enter}');
        expect(screen.getByRole('dialog', { name: 'Limpio' })).toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
        await user.click(screen.getByRole('button', { name: 'Generar rótulo' }));
        dialog = screen.getByRole('dialog', { name: 'Seleccionar tipo de rótulo' });
        await user.click(within(dialog).getByRole('button', { name: 'Para limpiar' }));
        dialog = screen.getByRole('dialog', { name: 'Para limpiar' });
        expect(Array.from(dialog.querySelectorAll('input, textarea')).map((field) => field.getAttribute('aria-label'))).toEqual([
            'Producto', 'Lote/Partida', 'Orden', 'Ambiente/Equipo', 'Tag', 'Responsable', 'Fecha/Hora', 'Observaciones',
        ]);
        expect(within(dialog).getByLabelText('Fecha/Hora')).toHaveValue('2026-08-24T10:55');
        expect(within(dialog).queryByLabelText('Producto anterior')).not.toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
        await user.click(screen.getByRole('button', { name: 'Generar rótulo' }));
        dialog = screen.getByRole('dialog', { name: 'Seleccionar tipo de rótulo' });
        await user.click(within(dialog).getByRole('button', { name: 'En proceso' }));
        dialog = screen.getByRole('dialog', { name: 'En proceso' });
        expect(Array.from(dialog.querySelectorAll('input, textarea')).map((field) => field.getAttribute('aria-label'))).toEqual([
            'Producto', 'Lote/Partida', 'Orden', 'Ambiente/Equipo', 'Tag', 'Producto anterior', 'Fecha/Hora', 'Realizó', 'Verificó', 'Observaciones',
        ]);
        expect(within(dialog).getByLabelText('Observaciones')).toHaveValue('');

        await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
        await user.click(screen.getByRole('button', { name: 'Generar rótulo' }));
        dialog = screen.getByRole('dialog', { name: 'Seleccionar tipo de rótulo' });
        await user.click(within(dialog).getByRole('button', { name: 'En proceso (en campaña)' }));
        dialog = screen.getByRole('dialog', { name: 'En proceso (en campaña)' });
        expect(within(dialog).getByLabelText('Observaciones')).toHaveValue('Producto en campaña');
    });

    it('opens a captured label state from the logbook status cell', async () => {
        const user = userEvent.setup();
        renderViewer('/eppi/logbook');

        const table = screen.getByRole('table', { name: 'Bitácora' });
        const firstRow = within(table).getAllByRole('row')[1];
        expect(firstRow).toBeDefined();
        expect(firstRow?.querySelector('.whitespace-pre-line')).toHaveTextContent('hace 16 días 08/08/2026 05:00:00');
        await user.click(within(firstRow!).getByRole('button', { name: 'Limpio' }));

        expect(screen.getByRole('dialog', { name: 'Limpio' })).toBeInTheDocument();
    });

    it('keeps permission-blocked audit content explicitly read-only', () => {
        renderViewer('/eppi/audit');

        expect(screen.getByRole('heading', { name: 'Acceso no autorizado' })).toBeInTheDocument();
        expect(screen.getByText(/no tienes permiso/i)).toBeInTheDocument();
    });
});
