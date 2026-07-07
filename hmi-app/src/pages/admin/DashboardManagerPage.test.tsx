import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardManagerPage from './DashboardManagerPage';
import { makeDashboard, makeTemplate } from '../../test/fixtures/dashboard.fixture';

const {
    mockNavigate,
    dashboardStorageMock,
    templateStorageMock,
    hierarchyStorageMock,
    dashboardPortabilityServiceMock,
    loadNodeTypeLabelsMock,
    resolveTypeLabelMock,
} = vi.hoisted(() => ({
    mockNavigate: vi.fn(),
    dashboardStorageMock: {
        getDashboards: vi.fn(),
        createEmptyDashboard: vi.fn(),
        deleteDashboard: vi.fn(),
        duplicateDashboard: vi.fn(),
        reorderDashboards: vi.fn(),
    },
    templateStorageMock: {
        getTemplates: vi.fn(),
        createFromDashboard: vi.fn(),
        deleteTemplate: vi.fn(),
        saveTemplate: vi.fn(),
    },
    hierarchyStorageMock: {
        getNodes: vi.fn(),
    },
    dashboardPortabilityServiceMock: {
        exportDashboard: vi.fn(),
        importDashboard: vi.fn(),
    },
    loadNodeTypeLabelsMock: vi.fn(),
    resolveTypeLabelMock: vi.fn((type: string) => type),
}));

vi.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
}));

vi.mock('../../services/DashboardStorageService', () => ({
    dashboardStorage: dashboardStorageMock,
}));

vi.mock('../../services/TemplateStorageService', () => ({
    templateStorage: templateStorageMock,
}));

vi.mock('../../services/HierarchyStorageService', () => ({
    hierarchyStorage: hierarchyStorageMock,
}));

vi.mock('../../services/dashboardPortabilityService', () => ({
    buildPortableDashboardFileName: (dashboardName: string) => `portable-${dashboardName.toLocaleLowerCase()}.json`,
    sanitizePortableDashboardFileName: (fileName: string) => `${fileName.trim().replace(/[^a-z0-9.-]+/gi, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'dashboard'}.json`.replace(/\.json\.json$/i, '.json'),
    dashboardPortabilityService: dashboardPortabilityServiceMock,
}));

vi.mock('../../utils/nodeTypeLabels', () => ({
    loadNodeTypeLabels: loadNodeTypeLabelsMock,
    resolveTypeLabel: resolveTypeLabelMock,
}));

vi.mock('../../components/admin/AdminWorkspaceLayout', () => ({
    default: ({
        contextBar,
        rail,
        sidePanel,
        children,
    }: {
        contextBar: ReactNode;
        rail?: ReactNode;
        sidePanel?: ReactNode;
        children: ReactNode;
    }) => (
        <div>
            <div data-testid="context-bar">{contextBar}</div>
            <div data-testid="workspace-rail">{rail}</div>
            <div data-testid="workspace-side-panel">{sidePanel}</div>
            <div data-testid="workspace-content">{children}</div>
        </div>
    ),
}));

describe('DashboardManagerPage', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockNavigate.mockReset();
        dashboardStorageMock.getDashboards.mockReset();
        dashboardStorageMock.createEmptyDashboard.mockReset();
        dashboardStorageMock.deleteDashboard.mockReset();
        dashboardStorageMock.duplicateDashboard.mockReset();
        dashboardStorageMock.reorderDashboards.mockReset();
        templateStorageMock.getTemplates.mockReset();
        templateStorageMock.createFromDashboard.mockReset();
        templateStorageMock.deleteTemplate.mockReset();
        templateStorageMock.saveTemplate.mockReset();
        hierarchyStorageMock.getNodes.mockReset();
        dashboardPortabilityServiceMock.exportDashboard.mockReset();
        dashboardPortabilityServiceMock.importDashboard.mockReset();
        dashboardStorageMock.getDashboards.mockResolvedValue([
            makeDashboard({
                id: 'dashboard-1',
                name: 'Principal',
                description: 'Resumen general',
                ownerNodeId: 'node-1',
            }),
        ]);
        templateStorageMock.getTemplates.mockResolvedValue([
            makeTemplate({
                id: 'template-1',
                name: 'Plantilla base',
                dashboardType: 'cell',
            }),
        ]);
        hierarchyStorageMock.getNodes.mockResolvedValue([
            { id: 'node-1', name: 'Línea 1', type: 'cell', parentId: null },
        ]);
        loadNodeTypeLabelsMock.mockResolvedValue(undefined);
    });

    it('shows the initial view explicitly from the first ordered internal view in the dashboard row', async () => {
        dashboardStorageMock.getDashboards.mockResolvedValue([
            makeDashboard({
                id: 'dashboard-1',
                name: 'Principal',
                description: 'Resumen general',
                ownerNodeId: 'node-1',
                views: [
                    {
                        id: 'view-technical',
                        name: 'Técnica',
                        order: 1,
                        widgets: [],
                        layout: [],
                    },
                    {
                        id: 'view-production',
                        name: 'Producción',
                        order: 0,
                        widgets: [],
                        layout: [],
                    },
                ],
                activeViewId: 'view-technical',
            }),
        ]);

        render(<DashboardManagerPage />);

        expect(await screen.findByText('Vista inicial: Producción')).toBeInTheDocument();
        expect(screen.getByText('Resumen general')).toBeInTheDocument();
    });

    it('shows hover tooltips for dashboard rail and icon-only actions', async () => {
        const user = userEvent.setup();

        render(<DashboardManagerPage />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Nuevo dashboard' })).toBeInTheDocument();
        });

        const tooltipAssertions = [
            'Nuevo dashboard',
            'Eliminar template',
            'Editar en Builder',
            'Duplicar',
            'Guardar como Template',
            'Eliminar',
        ] as const;

        for (const label of tooltipAssertions) {
            const button = screen.getByRole('button', { name: label });

            await user.hover(button);
            expect(await screen.findByRole('tooltip')).toHaveTextContent(label);
            await user.unhover(button);

            await waitFor(() => {
                expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
            });
        }
    });

    it('exports one dashboard from the row action and triggers the file download', async () => {
        const user = userEvent.setup();
        const importInputClickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
        const createObjectURLMock = vi.fn(() => 'blob:portable-dashboard');
        const revokeObjectURLMock = vi.fn();
        const clickedDownloads: string[] = [];
        const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
            clickedDownloads.push(this.download);
        });

        Object.assign(URL, {
            createObjectURL: createObjectURLMock,
            revokeObjectURL: revokeObjectURLMock,
        });

        dashboardPortabilityServiceMock.exportDashboard.mockResolvedValue({
            fileName: 'portable-dashboard.json',
            json: '{"schemaVersion":1}',
            portableFile: { schemaVersion: 1 },
            issues: [],
        });

        render(<DashboardManagerPage />);

        const importButton = await screen.findByRole('button', { name: 'Importar Dashboard' });
        const exportButton = await screen.findByRole('button', { name: 'Exportar Principal' });

        expect(importButton.querySelector('svg')).toHaveClass('lucide-download');
        expect(exportButton.querySelector('svg')).toHaveClass('lucide-upload');

        await user.click(importButton);
        expect(importInputClickSpy).toHaveBeenCalledTimes(1);

        await user.click(exportButton);

        const exportDialog = await screen.findByRole('dialog', { name: 'Exportar dashboard' });
        const fileNameInput = within(exportDialog).getByLabelText('Nombre del archivo');

        expect(fileNameInput).toHaveValue('portable-principal.json');
        expect(dashboardPortabilityServiceMock.exportDashboard).not.toHaveBeenCalled();

        await user.clear(fileNameInput);
        await user.type(fileNameInput, '  principal/editado  ');
        await user.click(within(exportDialog).getByRole('button', { name: 'Confirmar exportación' }));

        await waitFor(() => {
            expect(dashboardPortabilityServiceMock.exportDashboard).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'dashboard-1', name: 'Principal' }),
            );
        });

        expect(createObjectURLMock).toHaveBeenCalledWith(expect.any(Blob));
        expect(anchorClickSpy).toHaveBeenCalledTimes(1);
        expect(clickedDownloads).toEqual(['principal-editado.json']);
        expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:portable-dashboard');
    });

    it('cancels export from the filename dialog without calling the portability service or starting a download', async () => {
        const user = userEvent.setup();
        const createObjectURLMock = vi.fn(() => 'blob:portable-dashboard');
        const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

        Object.assign(URL, {
            createObjectURL: createObjectURLMock,
        });

        render(<DashboardManagerPage />);

        const exportButton = await screen.findByRole('button', { name: 'Exportar Principal' });
        await user.click(exportButton);

        const exportDialog = await screen.findByRole('dialog', { name: 'Exportar dashboard' });
        await user.click(within(exportDialog).getByRole('button', { name: 'Cancelar exportación' }));

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: 'Exportar dashboard' })).not.toBeInTheDocument();
        });

        expect(dashboardPortabilityServiceMock.exportDashboard).not.toHaveBeenCalled();
        expect(createObjectURLMock).not.toHaveBeenCalled();
        expect(anchorClickSpy).not.toHaveBeenCalled();
    });

    it('imports a portable dashboard, refreshes the list, and shows a success summary', async () => {
        const user = userEvent.setup();
        const importedDashboard = makeDashboard({
            id: 'dashboard-imported',
            name: 'Importado',
            ownerNodeId: undefined,
        });

        dashboardStorageMock.getDashboards
            .mockResolvedValueOnce([
                makeDashboard({
                    id: 'dashboard-1',
                    name: 'Principal',
                    description: 'Resumen general',
                    ownerNodeId: 'node-1',
                }),
            ])
            .mockResolvedValueOnce([
                makeDashboard({
                    id: 'dashboard-1',
                    name: 'Principal',
                    description: 'Resumen general',
                    ownerNodeId: 'node-1',
                }),
                importedDashboard,
            ]);
        dashboardPortabilityServiceMock.importDashboard.mockResolvedValue({
            dashboard: importedDashboard,
            issues: [
                {
                    code: 'external_dashboard_reference_cleared',
                    path: 'dashboard.widgets[alert-1].displayOptions.dashboardId',
                    message: 'A cross-environment dashboard reference was cleared during import.',
                    severity: 'warning',
                },
            ],
            createdCatalogVariables: [
                { id: 'cv-pressure-bar', name: 'Pressure', unit: 'bar', description: 'Pressure line' },
            ],
        });

        render(<DashboardManagerPage />);

        const importInput = await screen.findByLabelText('Seleccionar archivo portable de dashboard');
        await user.upload(
            importInput,
            new File(['{"schemaVersion":1,"dashboard":{"name":"Importado"}}'], 'portable-dashboard.json', {
                type: 'application/json',
            }),
        );

        await waitFor(() => {
            expect(dashboardPortabilityServiceMock.importDashboard).toHaveBeenCalledWith(
                '{"schemaVersion":1,"dashboard":{"name":"Importado"}}',
            );
        });

        expect(await screen.findByRole('dialog', { name: 'Importación completada' })).toBeInTheDocument();
        expect(screen.getAllByText('Importado')).toHaveLength(2);
        expect(screen.getByText(/Se creó 1 variable nueva/)).toBeInTheDocument();
        expect(screen.getByText('A cross-environment dashboard reference was cleared during import.')).toBeInTheDocument();
        expect(dashboardStorageMock.getDashboards).toHaveBeenCalledTimes(2);
        expect(await screen.findAllByText('Importado')).toHaveLength(2);
    });

    it('shows actionable import validation errors and does not refresh dashboards after rejection', async () => {
        const user = userEvent.setup();

        dashboardPortabilityServiceMock.importDashboard.mockRejectedValue(
            Object.assign(new Error('Import failed'), {
                issues: [
                    {
                        code: 'unsupported_schema_version',
                        path: 'schemaVersion',
                        message: 'Portable dashboard schema version "7" is not supported.',
                        severity: 'error',
                    },
                ],
            }),
        );

        render(<DashboardManagerPage />);

        const importInput = await screen.findByLabelText('Seleccionar archivo portable de dashboard');
        await user.upload(
            importInput,
            new File(['{"schemaVersion":7}'], 'portable-dashboard.json', { type: 'application/json' }),
        );

        expect(await screen.findByRole('dialog', { name: 'No pudimos importar el dashboard' })).toBeInTheDocument();
        expect(screen.getByText('Portable dashboard schema version "7" is not supported.')).toBeInTheDocument();
        expect(dashboardStorageMock.getDashboards).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Importado')).not.toBeInTheDocument();
    });
});
