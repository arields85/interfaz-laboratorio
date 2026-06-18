import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hierarchyStorage } from './HierarchyStorageService';
import { HIERARCHY_STORAGE_KEY } from '../utils/legacyStorageCleanup';
import type { HierarchyNode } from '../domain/admin.types';
import { mockHierarchyNodes } from '../mocks/hierarchy.mock';

const seedNodes = (nodes: HierarchyNode[]) => {
    localStorage.setItem(HIERARCHY_STORAGE_KEY, JSON.stringify(nodes));
};

const readStoredNodes = (): HierarchyNode[] => {
    const stored = localStorage.getItem(HIERARCHY_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
};

const sampleNodes: HierarchyNode[] = [
    {
        id: 'root',
        name: 'Plant Demo',
        type: 'plant',
        parentId: null,
        order: 0,
    },
    {
        id: 'child',
        name: 'Compression',
        type: 'area',
        parentId: 'root',
        order: 0,
    },
    {
        id: 'grandchild',
        name: 'Line 1',
        type: 'line',
        parentId: 'child',
        order: 0,
    },
    {
        id: 'sibling',
        name: 'Packaging',
        type: 'area',
        parentId: 'root',
        order: 1,
    },
];

describe('HierarchyStorageService', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reads hierarchy nodes from HIERARCHY_STORAGE_KEY', async () => {
        const nodes: HierarchyNode[] = [
            {
                id: 'node-1',
                name: 'Planta Demo',
                type: 'plant',
                parentId: null,
                order: 0,
            },
        ];

        localStorage.setItem(HIERARCHY_STORAGE_KEY, JSON.stringify(nodes));

        await expect(hierarchyStorage.getNodes()).resolves.toEqual(nodes);
    });

    it('seeds storage with mock hierarchy when it starts empty', async () => {
        await expect(hierarchyStorage.getNodes()).resolves.toEqual(mockHierarchyNodes);
        expect(readStoredNodes()).toEqual(mockHierarchyNodes);
    });

    it('returns an empty list if storage is unavailable after initialization', async () => {
        vi.spyOn(Storage.prototype, 'getItem')
            .mockReturnValueOnce(null)
            .mockReturnValueOnce(null);

        await expect(hierarchyStorage.getNodes()).resolves.toEqual([]);
    });

    it('inserts new nodes and updates existing nodes on save', async () => {
        seedNodes(sampleNodes);

        const insertedNode: HierarchyNode = {
            id: 'new-node',
            name: 'Box A',
            type: 'box',
            parentId: 'grandchild',
            order: 0,
        };

        await hierarchyStorage.saveNode(insertedNode);
        expect(readStoredNodes()).toContainEqual(insertedNode);

        const updatedNode: HierarchyNode = {
            ...insertedNode,
            name: 'Box A Updated',
            order: 3,
        };

        await hierarchyStorage.saveNode(updatedNode);
        expect(readStoredNodes().filter(node => node.id === 'new-node')).toEqual([updatedNode]);
    });

    it('prevents deleting parents with children and deletes leaf nodes', async () => {
        seedNodes(sampleNodes);

        await expect(hierarchyStorage.deleteNode('root')).resolves.toBe(false);
        await expect(hierarchyStorage.deleteNode('grandchild')).resolves.toBe(true);
        expect(readStoredNodes().map(node => node.id)).toEqual(['root', 'child', 'sibling']);
    });

    it('returns a matching node or null when looking up a node by id', async () => {
        seedNodes(sampleNodes);

        await expect(hierarchyStorage.getNode('child')).resolves.toEqual(sampleNodes[1]);
        await expect(hierarchyStorage.getNode('missing')).resolves.toBeNull();
    });

    it('creates nodes with the requested parent, next order, and default null parent', async () => {
        seedNodes(sampleNodes);
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(1234567890)
            .mockReturnValueOnce(1234567891);

        const createdChild = await hierarchyStorage.createNode('Utilities', 'area', 'root');
        const createdRoot = await hierarchyStorage.createNode('Standalone Plant', 'plant');

        expect(createdChild).toMatchObject({
            id: 'hier-kf12oi',
            name: 'Utilities',
            type: 'area',
            parentId: 'root',
            order: 2,
        });
        expect(createdRoot).toMatchObject({
            id: 'hier-kf12oj',
            name: 'Standalone Plant',
            type: 'plant',
            parentId: null,
            order: 1,
        });
        expect(readStoredNodes()).toEqual([...sampleNodes, createdChild, createdRoot]);
    });

    it('starts child ordering at one when a parent has no existing children', async () => {
        seedNodes(sampleNodes);
        vi.spyOn(Date, 'now').mockReturnValueOnce(1234567892);

        const createdNode = await hierarchyStorage.createNode('First Packaging Line', 'line', 'sibling');

        expect(createdNode).toMatchObject({
            id: 'hier-kf12ok',
            parentId: 'sibling',
            order: 1,
        });
    });

    it('updates partial node fields and returns null for missing nodes', async () => {
        seedNodes(sampleNodes);

        await expect(
            hierarchyStorage.updateNode('child', { name: 'Compression Updated', order: 4 })
        ).resolves.toEqual({
            ...sampleNodes[1],
            name: 'Compression Updated',
            order: 4,
        });
        await expect(hierarchyStorage.updateNode('missing', { name: 'Nope' })).resolves.toBeNull();
    });

    it('rejects invalid parent moves and allows valid node moves', async () => {
        seedNodes(sampleNodes);

        await expect(hierarchyStorage.updateNodeParent('child', 'child')).resolves.toBe(false);
        await expect(hierarchyStorage.updateNodeParent('child', 'grandchild')).resolves.toBe(false);
        await expect(hierarchyStorage.updateNodeParent('child', 'missing-parent')).resolves.toBe(false);
        await expect(hierarchyStorage.updateNodeParent('missing-node', 'root')).resolves.toBe(false);
        await expect(hierarchyStorage.updateNodeParent('grandchild', 'sibling')).resolves.toBe(true);
        await expect(hierarchyStorage.updateNodeParent('grandchild', null)).resolves.toBe(true);

        expect(readStoredNodes().find(node => node.id === 'grandchild')?.parentId).toBeNull();
    });
});
