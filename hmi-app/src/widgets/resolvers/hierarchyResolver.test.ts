import { describe, expect, it } from 'vitest';
import { resolveHierarchyBinding, type HierarchyContext } from './hierarchyResolver';
import { makeDashboard, makeWidget } from '../../test/fixtures/dashboard.fixture';

function makeHierarchyContext(overrides: Partial<HierarchyContext> = {}): HierarchyContext {
    return {
        allNodes: [],
        allDashboards: [],
        currentNodeId: 'root',
        ...overrides,
    };
}

describe('resolveHierarchyBinding', () => {
    it('returns no-data when the dashboard is not linked to a hierarchy node', () => {
        const result = resolveHierarchyBinding(
            makeWidget({
                hierarchyMode: true,
                binding: { mode: 'real_variable', catalogVariableId: 'cv-temperature' },
            }),
            makeHierarchyContext({ currentNodeId: undefined }),
            new Map(),
        );

        expect(result).toEqual({ value: null, status: 'no-data', source: 'error' });
    });

    it('returns no-data when the current node has no descendants', () => {
        const result = resolveHierarchyBinding(
            makeWidget({
                hierarchyMode: true,
                binding: { mode: 'real_variable', catalogVariableId: 'cv-temperature' },
            }),
            makeHierarchyContext({
                allNodes: [{ id: 'root', name: 'Root', type: 'plant', parentId: null, order: 0 }],
            }),
            new Map(),
        );

        expect(result).toEqual({ value: null, status: 'no-data', source: 'error' });
    });

    it('aggregates recursive descendant values and skips incompatible widgets and dashboards', () => {
        const targetWidget = makeWidget({
            hierarchyMode: true,
            aggregation: 'sum',
            binding: { mode: 'real_variable', catalogVariableId: 'cv-temperature', unit: '°C' },
        });

        const childDashboard = makeDashboard({
            id: 'dashboard-child',
            status: 'published',
            widgets: [
                makeWidget({
                    id: 'child-1',
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 10,
                        catalogVariableId: 'cv-temperature',
                    },
                }),
                makeWidget({
                    id: 'child-2',
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 7,
                        catalogVariableId: 'cv-temperature',
                    },
                    hierarchyMode: true,
                }),
                makeWidget({
                    id: 'child-3',
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 999,
                        catalogVariableId: 'cv-pressure',
                    },
                }),
                makeWidget({
                    id: 'child-4',
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 'offline',
                        catalogVariableId: 'cv-temperature',
                    },
                }),
                makeWidget({
                    id: 'child-5',
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: null,
                        catalogVariableId: 'cv-temperature',
                    },
                }),
            ],
        });

        const grandchildDashboard = makeDashboard({
            id: 'dashboard-grandchild',
            status: 'published',
            widgets: [
                makeWidget({
                    id: 'grandchild-1',
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 20,
                        catalogVariableId: 'cv-temperature',
                    },
                }),
            ],
        });

        const draftDashboard = makeDashboard({
            id: 'dashboard-draft',
            status: 'draft',
            widgets: [
                makeWidget({
                    id: 'draft-1',
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 500,
                        catalogVariableId: 'cv-temperature',
                    },
                }),
            ],
        });

        const result = resolveHierarchyBinding(
            targetWidget,
            makeHierarchyContext({
                allNodes: [
                    { id: 'root', name: 'Root', type: 'plant', parentId: null, order: 0 },
                    {
                        id: 'child-a',
                        name: 'Child A',
                        type: 'line',
                        parentId: 'root',
                        order: 0,
                        linkedDashboardId: 'dashboard-child',
                    },
                    {
                        id: 'child-b',
                        name: 'Child B',
                        type: 'line',
                        parentId: 'root',
                        order: 1,
                        linkedDashboardId: 'dashboard-child',
                    },
                    {
                        id: 'grandchild-a',
                        name: 'Grandchild A',
                        type: 'machine',
                        parentId: 'child-a',
                        order: 0,
                        linkedDashboardId: 'dashboard-grandchild',
                    },
                    {
                        id: 'child-c',
                        name: 'Child C',
                        type: 'line',
                        parentId: 'root',
                        order: 2,
                        linkedDashboardId: 'dashboard-draft',
                    },
                ],
                allDashboards: [childDashboard, grandchildDashboard, draftDashboard],
            }),
            new Map(),
        );

        expect(result).toEqual({
            value: 30,
            unit: '°C',
            status: 'normal',
            source: 'real',
        });
    });

    it.each([
        ['avg', 15],
        ['max', 20],
        ['min', 10],
    ] as const)('applies the %s aggregation mode', (aggregation, expectedValue) => {
        const result = resolveHierarchyBinding(
            makeWidget({
                hierarchyMode: true,
                aggregation,
                binding: { mode: 'real_variable', catalogVariableId: 'cv-temperature', unit: '°C' },
            }),
            makeHierarchyContext({
                allNodes: [
                    { id: 'root', name: 'Root', type: 'plant', parentId: null, order: 0 },
                    {
                        id: 'child-a',
                        name: 'Child A',
                        type: 'line',
                        parentId: 'root',
                        order: 0,
                        linkedDashboardId: 'dashboard-child-a',
                    },
                    {
                        id: 'child-b',
                        name: 'Child B',
                        type: 'line',
                        parentId: 'root',
                        order: 1,
                        linkedDashboardId: 'dashboard-child-b',
                    },
                ],
                allDashboards: [
                    makeDashboard({
                        id: 'dashboard-child-a',
                        status: 'published',
                        widgets: [makeWidget({
                            binding: {
                                mode: 'simulated_value',
                                simulatedValue: 10,
                                catalogVariableId: 'cv-temperature',
                            },
                        })],
                    }),
                    makeDashboard({
                        id: 'dashboard-child-b',
                        status: 'published',
                        widgets: [makeWidget({
                            binding: {
                                mode: 'simulated_value',
                                simulatedValue: 20,
                                catalogVariableId: 'cv-temperature',
                            },
                        })],
                    }),
                ],
            }),
            new Map(),
        );

        expect(result).toMatchObject({
            value: expectedValue,
            unit: '°C',
            status: 'normal',
            source: 'real',
        });
    });

    it('returns no-data when descendants have no numeric values for the configured variable', () => {
        const result = resolveHierarchyBinding(
            makeWidget({
                hierarchyMode: true,
                binding: { mode: 'real_variable', catalogVariableId: 'cv-temperature' },
            }),
            makeHierarchyContext({
                allNodes: [
                    { id: 'root', name: 'Root', type: 'plant', parentId: null, order: 0 },
                    {
                        id: 'child-a',
                        name: 'Child A',
                        type: 'line',
                        parentId: 'root',
                        order: 0,
                        linkedDashboardId: 'dashboard-child',
                    },
                ],
                allDashboards: [
                    makeDashboard({
                        id: 'dashboard-child',
                        status: 'published',
                        widgets: [makeWidget({
                            binding: {
                                mode: 'simulated_value',
                                simulatedValue: 'not-a-number',
                                catalogVariableId: 'cv-temperature',
                            },
                        })],
                    }),
                ],
            }),
            new Map(),
        );

        expect(result).toEqual({ value: null, status: 'no-data', source: 'error' });
    });
});
