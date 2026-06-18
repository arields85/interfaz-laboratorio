import { describe, expect, it } from 'vitest';
import type { HierarchyNode } from '../domain/admin.types';
import {
    buildTree,
    filterTreeByName,
    findNodeInTree,
    getAncestors,
    treeContainsNodeId,
} from './hierarchyTree';

const flatNodes: HierarchyNode[] = [
    { id: 'child-b', name: 'Packaging', type: 'area', parentId: 'root', order: 2 },
    { id: 'leaf-b', name: 'Mixer', type: 'equipment', parentId: 'child-a', order: 2 },
    { id: 'orphan', name: 'Orphan', type: 'line', parentId: 'missing-parent', order: 0 },
    { id: 'root', name: 'Plant', type: 'plant', parentId: null, order: 0 },
    { id: 'child-a', name: 'Compression', type: 'area', parentId: 'root', order: 1 },
    { id: 'leaf-a', name: 'Tablet Press', type: 'equipment', parentId: 'child-a', order: 1 },
];

describe('hierarchyTree', () => {
    it('builds a nested tree sorted by order and ignores orphan nodes', () => {
        const tree = buildTree(flatNodes);

        expect(tree).toHaveLength(1);
        expect(tree[0].id).toBe('root');
        expect(tree[0].children.map(child => child.id)).toEqual(['child-a', 'child-b']);
        expect(tree[0].children[0].children.map(child => child.id)).toEqual(['leaf-a', 'leaf-b']);
        expect(findNodeInTree(tree, 'orphan')).toBeNull();
    });

    it('returns ancestors from root to target node', () => {
        expect(getAncestors('leaf-a', flatNodes).map(node => node.id)).toEqual(['root', 'child-a', 'leaf-a']);
    });

    it('finds nested nodes in the tree and returns null for missing nodes', () => {
        const tree = buildTree(flatNodes);

        expect(findNodeInTree(tree, 'leaf-b')?.name).toBe('Mixer');
        expect(findNodeInTree(tree, 'missing')).toBeNull();
    });

    it('returns the original tree for blank queries', () => {
        const tree = buildTree(flatNodes);

        expect(filterTreeByName(tree, '   ')).toBe(tree);
    });

    it('keeps full descendants when the parent name matches the query', () => {
        const tree = buildTree(flatNodes);
        const filtered = filterTreeByName(tree, 'compress');

        expect(filtered).toHaveLength(1);
        expect(filtered[0].children).toHaveLength(1);
        expect(filtered[0].children[0].id).toBe('child-a');
        expect(filtered[0].children[0].children.map(child => child.id)).toEqual(['leaf-a', 'leaf-b']);
    });

    it('keeps ancestor chain with only matching child branches', () => {
        const tree = buildTree(flatNodes);
        const filtered = filterTreeByName(tree, 'tablet');

        expect(filtered).toHaveLength(1);
        expect(filtered[0].id).toBe('root');
        expect(filtered[0].children).toHaveLength(1);
        expect(filtered[0].children[0].id).toBe('child-a');
        expect(filtered[0].children[0].children).toHaveLength(1);
        expect(filtered[0].children[0].children[0].id).toBe('leaf-a');
    });

    it('returns no matches when the query is absent and matches case-insensitively', () => {
        const tree = buildTree(flatNodes);

        expect(filterTreeByName(tree, 'unknown')).toEqual([]);
        expect(filterTreeByName(tree, 'mIxEr')[0].children[0].children[0].id).toBe('leaf-b');
    });

    it('checks whether a node id exists anywhere in the tree', () => {
        const tree = buildTree(flatNodes);

        expect(treeContainsNodeId(tree, 'leaf-a')).toBe(true);
        expect(treeContainsNodeId(tree, 'missing')).toBe(false);
    });
});
