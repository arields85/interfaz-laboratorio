import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HIERARCHY_EXPANDED_STORAGE_KEY } from '../../utils/legacyStorageCleanup';

const mockedData = vi.hoisted(() => ({
    initialNodes: [
        { id: 'node-plant-01', name: 'Planta Demo', type: 'plant', parentId: null, order: 0 },
        { id: 'node-area-comp', name: 'Área Compresión', type: 'area', parentId: 'node-plant-01', order: 0 },
    ],
    nodes: [
        { id: 'node-plant-01', name: 'Planta Demo', type: 'plant', parentId: null, order: 0 },
        { id: 'node-area-comp', name: 'Área Compresión', type: 'area', parentId: 'node-plant-01', order: 0 },
    ],
    dashboards: [],
    nodeTypes: [
        { key: 'plant', label: 'Planta', icon: 'factory', color: 'text-accent-cyan' },
        { key: 'area', label: 'Área', icon: 'layers', color: 'text-accent-blue' },
    ],
}));

vi.mock('../../services/HierarchyStorageService', () => ({
    hierarchyStorage: {
        getNodes: vi.fn().mockImplementation(async () => mockedData.nodes.map((node) => ({ ...node }))),
        updateNode: vi.fn().mockImplementation(async (id: string, partial: Record<string, unknown>) => {
            mockedData.nodes = mockedData.nodes.map((node) => (
                node.id === id ? { ...node, ...partial } : node
            ));
        }),
    },
}));

vi.mock('../../services/DashboardStorageService', () => ({
    dashboardStorage: {
        getDashboards: vi.fn().mockResolvedValue(mockedData.dashboards),
    },
}));

vi.mock('../../services/NodeTypeStorageService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/NodeTypeStorageService')>();

    return {
        ...actual,
        nodeTypeStorage: {
            getAll: vi.fn().mockResolvedValue(mockedData.nodeTypes),
        },
    };
});

import HierarchyPage from './HierarchyPage';

describe('HierarchyPage', () => {
    beforeEach(() => {
        localStorage.clear();
        mockedData.nodes = mockedData.initialNodes.map((node) => ({ ...node }));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('reads and writes expanded state using HIERARCHY_EXPANDED_STORAGE_KEY', async () => {
        localStorage.setItem(HIERARCHY_EXPANDED_STORAGE_KEY, JSON.stringify(['node-plant-01']));

        const user = userEvent.setup();
        const { container } = render(
            <MemoryRouter>
                <HierarchyPage />
            </MemoryRouter>,
        );

        expect(await screen.findByText('Área Compresión')).toBeInTheDocument();

        const rootExpander = container.querySelector('span.cursor-pointer');

        expect(rootExpander).not.toBeNull();

        await user.click(rootExpander as HTMLSpanElement);

        await waitFor(() => {
            expect(localStorage.getItem(HIERARCHY_EXPANDED_STORAGE_KEY)).toBe(JSON.stringify([]));
        });
    });

    it('starts each name edit session from the current visible node name', async () => {
        const user = userEvent.setup();

        render(
            <MemoryRouter>
                <HierarchyPage />
            </MemoryRouter>,
        );

        const nodeButton = await screen.findByRole('button', { name: /Planta Demo/i });
        await user.click(nodeButton);

        await user.click(screen.getByRole('heading', { name: 'Planta Demo' }));

        const input = screen.getByDisplayValue('Planta Demo');
        await user.clear(input);
        await user.type(input, '  Planta Norte  ');
        await user.tab();

        await screen.findByRole('heading', { name: 'Planta Norte' });

        await user.click(screen.getByRole('heading', { name: 'Planta Norte' }));

        expect(screen.getByDisplayValue('Planta Norte')).toBeInTheDocument();
    });
});
