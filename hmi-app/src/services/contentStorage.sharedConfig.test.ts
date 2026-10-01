import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConfigStoragePort } from '../domain/sharedConfig.types';
import { makeDashboard, makeTemplate, makeWidget } from '../test/fixtures/dashboard.fixture';
import {
    DASHBOARDS_STORAGE_KEY,
    HIERARCHY_EXPANDED_STORAGE_KEY,
    HIERARCHY_STORAGE_KEY,
    NODE_TYPES_STORAGE_KEY,
    TEMPLATES_STORAGE_KEY,
    VARIABLE_CATALOG_STORAGE_KEY,
} from '../utils/legacyStorageCleanup';
import { DashboardStorageService } from './DashboardStorageService';
import { DEFAULT_NODE_TYPES, NodeTypeStorageService } from './NodeTypeStorageService';
import { HierarchyStorageService } from './HierarchyStorageService';
import { TemplateStorageService } from './TemplateStorageService';
import { VariableCatalogStorageService } from './VariableCatalogStorageService';

// The content stores persist through an injected port (the shared adapter in the app).
// A memory fake proves they go through it and never touch the browser's localStorage.
function createMemoryPort() {
    const data = new Map<string, string>();
    const port: ConfigStoragePort = {
        getItem: vi.fn((key: string) => data.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
        removeItem: vi.fn((key: string) => { data.delete(key); }),
    };
    return { data, port };
}

describe('content stores over the shared configuration port', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('persists dashboards through the port, never through localStorage', async () => {
        const { data, port } = createMemoryPort();
        const service = new DashboardStorageService(port);
        const localSetItem = vi.spyOn(Storage.prototype, 'setItem');

        const save = service.saveDashboard(makeDashboard({ id: 'dashboard-port' }));
        await vi.advanceTimersByTimeAsync(400);
        await save;

        expect(JSON.parse(data.get(DASHBOARDS_STORAGE_KEY) ?? '[]')).toEqual([
            expect.objectContaining({ id: 'dashboard-port' }),
        ]);
        expect(localSetItem).not.toHaveBeenCalled();
        expect(localStorage.length).toBe(0);
    });

    it('picks up a dashboard changed behind its back by reading the port again', async () => {
        const { data, port } = createMemoryPort();
        const service = new DashboardStorageService(port);
        data.set(DASHBOARDS_STORAGE_KEY, JSON.stringify([makeDashboard({ id: 'dashboard-remote', name: 'Remote' })]));

        const read = service.getDashboard('dashboard-remote');
        await vi.advanceTimersByTimeAsync(300);

        await expect(read).resolves.toEqual(expect.objectContaining({ name: 'Remote' }));
    });

    it('persists templates through the port and reads without writing', async () => {
        const { data, port } = createMemoryPort();
        const service = new TemplateStorageService(port);

        const empty = service.getTemplates();
        await vi.advanceTimersByTimeAsync(200);
        await expect(empty).resolves.toEqual([]);
        expect(port.setItem).not.toHaveBeenCalled();

        const save = service.saveTemplate(makeTemplate({ id: 'template-port' }));
        await vi.advanceTimersByTimeAsync(300);
        await save;

        expect(JSON.parse(data.get(TEMPLATES_STORAGE_KEY) ?? '[]')).toEqual([
            expect.objectContaining({ id: 'template-port' }),
        ]);
        expect(localStorage.length).toBe(0);
    });

    it('persists the hierarchy through the port and keeps the expanded nodes out of it', async () => {
        const { data, port } = createMemoryPort();
        const service = new HierarchyStorageService(port);

        const create = service.createNode('Planta', 'plant');
        await vi.advanceTimersByTimeAsync(300);
        await create;

        expect(JSON.parse(data.get(HIERARCHY_STORAGE_KEY) ?? '[]')).toEqual([expect.objectContaining({ name: 'Planta' })]);
        expect([...data.keys()]).not.toContain(HIERARCHY_EXPANDED_STORAGE_KEY);
        expect(localStorage.length).toBe(0);
    });

    it('serves the default node types without writing and persists edits through the port', async () => {
        const { data, port } = createMemoryPort();
        const service = new NodeTypeStorageService(port);

        await expect(service.getAll()).resolves.toEqual(DEFAULT_NODE_TYPES);
        expect(port.setItem).not.toHaveBeenCalled();

        const edited = [{ key: 'plant', label: 'Planta', icon: 'factory', color: 'text-accent-cyan' }];
        await service.save(edited);

        expect(JSON.parse(data.get(NODE_TYPES_STORAGE_KEY) ?? '[]')).toEqual(edited);
        await expect(service.getAll()).resolves.toEqual(edited);
        expect(localStorage.length).toBe(0);
    });

    it('persists the variable catalog through the port and finds affected dashboards in it', async () => {
        const { data, port } = createMemoryPort();
        const service = new VariableCatalogStorageService(port);

        const created = service.create({ id: 'var-1', name: 'Temperatura', unit: '°C' } as never);
        await vi.advanceTimersByTimeAsync(0);
        await created;
        data.set(DASHBOARDS_STORAGE_KEY, JSON.stringify([
            makeDashboard({
                id: 'dashboard-uses-var',
                name: 'Usa variable',
                widgets: [makeWidget({ id: 'widget-uses-var', binding: { catalogVariableId: 'var-1' } as never })],
            }),
            makeDashboard({ id: 'dashboard-other', name: 'Sin variable' }),
        ]));

        expect(JSON.parse(data.get(VARIABLE_CATALOG_STORAGE_KEY) ?? '[]')).toEqual([expect.objectContaining({ id: 'var-1' })]);
        await expect(service.getAffectedDashboards('var-1')).resolves.toEqual([{ id: 'dashboard-uses-var', name: 'Usa variable' }]);
        expect(localStorage.length).toBe(0);
    });
});
