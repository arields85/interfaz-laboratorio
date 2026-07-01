import { describe, expect, it } from 'vitest';
import {
    buildHierarchyAggregationTrace,
    resolveHierarchyBinding,
    type HierarchyContext,
    type HierarchyTraceExclusionReason,
} from './hierarchyResolver';
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

    it('keeps wrapper parity with buildHierarchyAggregationTrace and explains included/excluded contributors', () => {
        const targetWidget = makeWidget({
            id: 'hierarchy-parent',
            hierarchyMode: true,
            aggregation: 'sum',
            binding: { mode: 'real_variable', catalogVariableId: 'cv-temperature', unit: '°C' },
        });

        const publishedDashboard = makeDashboard({
            id: 'dashboard-published',
            status: 'published',
            widgets: [
                makeWidget({
                    id: 'included-1',
                    title: 'Temperatura 1',
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 10,
                        catalogVariableId: 'cv-temperature',
                        unit: '°C',
                    },
                }),
                makeWidget({
                    id: 'excluded-hierarchy',
                    title: 'Jerarquía interna',
                    hierarchyMode: true,
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 7,
                        catalogVariableId: 'cv-temperature',
                        unit: '°C',
                    },
                }),
                makeWidget({
                    id: 'excluded-mismatch',
                    title: 'Presión',
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 999,
                        catalogVariableId: 'cv-pressure',
                        unit: 'bar',
                    },
                }),
                makeWidget({
                    id: 'excluded-non-numeric',
                    title: 'Texto',
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 'offline',
                        catalogVariableId: 'cv-temperature',
                        unit: '°C',
                    },
                }),
                makeWidget({
                    id: 'excluded-no-value',
                    title: 'Sin valor',
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: null,
                        catalogVariableId: 'cv-temperature',
                        unit: '°C',
                    },
                }),
            ],
        });

        const duplicateDashboard = makeDashboard({
            id: 'dashboard-duplicate',
            status: 'published',
            widgets: [
                makeWidget({
                    id: 'duplicate-1',
                    title: 'Temperatura duplicada',
                    binding: {
                        mode: 'simulated_value',
                        simulatedValue: 12,
                        catalogVariableId: 'cv-temperature',
                        unit: '°C',
                    },
                }),
            ],
        });

        const trace = buildHierarchyAggregationTrace(
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
                        linkedDashboardId: 'dashboard-published',
                    },
                    {
                        id: 'child-b',
                        name: 'Child B',
                        type: 'line',
                        parentId: 'root',
                        order: 1,
                        linkedDashboardId: 'dashboard-published',
                    },
                    {
                        id: 'child-c',
                        name: 'Child C',
                        type: 'line',
                        parentId: 'root',
                        order: 2,
                        linkedDashboardId: 'dashboard-missing',
                    },
                    {
                        id: 'child-d',
                        name: 'Child D',
                        type: 'line',
                        parentId: 'root',
                        order: 3,
                        linkedDashboardId: 'dashboard-draft',
                    },
                    {
                        id: 'grandchild-a',
                        name: 'Grandchild A',
                        type: 'machine',
                        parentId: 'child-a',
                        order: 0,
                        linkedDashboardId: 'dashboard-duplicate',
                    },
                    {
                        id: 'grandchild-b',
                        name: 'Grandchild B',
                        type: 'machine',
                        parentId: 'child-b',
                        order: 1,
                        linkedDashboardId: 'dashboard-duplicate',
                    },
                ],
                allDashboards: [
                    publishedDashboard,
                    makeDashboard({ id: 'dashboard-draft', status: 'draft', widgets: [] }),
                    duplicateDashboard,
                ],
            }),
            new Map(),
        );

        expect(trace.state).toBe('resolved');
        expect(trace.emptyReason).toBeUndefined();
        expect(trace.descendantNodeCount).toBe(6);
        expect(trace.scannedDashboardCount).toBe(4);
        expect(trace.included).toEqual([
            expect.objectContaining({
                nodeId: 'child-a',
                dashboardId: 'dashboard-published',
                widgetId: 'included-1',
                value: 10,
                unit: '°C',
            }),
            expect.objectContaining({
                nodeId: 'grandchild-a',
                dashboardId: 'dashboard-duplicate',
                widgetId: 'duplicate-1',
                value: 12,
                unit: '°C',
            }),
        ]);
        expect(trace.excluded.map((entry) => entry.reason)).toEqual([
            'nested-hierarchy-widget',
            'catalog-mismatch',
            'non-numeric',
            'no-value',
            'duplicate-dashboard',
            'missing-dashboard',
            'draft-dashboard',
            'duplicate-dashboard',
        ] satisfies HierarchyTraceExclusionReason[]);
        expect(resolveHierarchyBinding(targetWidget, makeHierarchyContext({
            allNodes: [
                { id: 'root', name: 'Root', type: 'plant', parentId: null, order: 0 },
                {
                    id: 'child-a',
                    name: 'Child A',
                    type: 'line',
                    parentId: 'root',
                    order: 0,
                    linkedDashboardId: 'dashboard-published',
                },
                {
                    id: 'child-b',
                    name: 'Child B',
                    type: 'line',
                    parentId: 'root',
                    order: 1,
                    linkedDashboardId: 'dashboard-published',
                },
                {
                    id: 'child-c',
                    name: 'Child C',
                    type: 'line',
                    parentId: 'root',
                    order: 2,
                    linkedDashboardId: 'dashboard-missing',
                },
                {
                    id: 'child-d',
                    name: 'Child D',
                    type: 'line',
                    parentId: 'root',
                    order: 3,
                    linkedDashboardId: 'dashboard-draft',
                },
                {
                    id: 'grandchild-a',
                    name: 'Grandchild A',
                    type: 'machine',
                    parentId: 'child-a',
                    order: 0,
                    linkedDashboardId: 'dashboard-duplicate',
                },
                {
                    id: 'grandchild-b',
                    name: 'Grandchild B',
                    type: 'machine',
                    parentId: 'child-b',
                    order: 1,
                    linkedDashboardId: 'dashboard-duplicate',
                },
            ],
            allDashboards: [
                publishedDashboard,
                makeDashboard({ id: 'dashboard-draft', status: 'draft', widgets: [] }),
                duplicateDashboard,
            ],
        }), new Map())).toEqual(trace.resolved);
    });

    it.each([
        [{ currentNodeId: undefined }, 'missing-current-node'],
        [{ allNodes: [
            { id: 'root', name: 'Root', type: 'plant', parentId: null, order: 0 },
            { id: 'child-a', name: 'Child A', type: 'line', parentId: 'root', order: 0 },
        ] }, 'missing-catalog-variable'],
        [{ allNodes: [{ id: 'root', name: 'Root', type: 'plant', parentId: null, order: 0 }] }, 'no-descendants'],
    ] as const)('surfaces top-level empty reason %s', (contextOverrides, expectedReason) => {
        const trace = buildHierarchyAggregationTrace(
            makeWidget({
                hierarchyMode: true,
                binding: expectedReason === 'missing-catalog-variable'
                    ? undefined
                    : { mode: 'real_variable', catalogVariableId: 'cv-temperature' },
            }),
            makeHierarchyContext(contextOverrides),
            new Map(),
        );

        expect(trace.state).toBe('empty');
        expect(trace.emptyReason).toBe(expectedReason);
        expect(trace.resolved).toEqual({ value: null, status: 'no-data', source: 'error' });
        expect(trace.included).toEqual([]);
        expect(trace.excluded).toEqual([]);
    });

    it('marks scans with only excluded contributors as no-eligible-contributors', () => {
        const trace = buildHierarchyAggregationTrace(
            makeWidget({
                hierarchyMode: true,
                aggregation: 'avg',
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
                        linkedDashboardId: 'dashboard-child',
                    },
                ],
                allDashboards: [
                    makeDashboard({
                        id: 'dashboard-child',
                        status: 'published',
                        widgets: [
                            makeWidget({
                                id: 'excluded-mismatch',
                                binding: {
                                    mode: 'simulated_value',
                                    simulatedValue: 99,
                                    catalogVariableId: 'cv-pressure',
                                },
                            }),
                            makeWidget({
                                id: 'excluded-no-value',
                                binding: {
                                    mode: 'simulated_value',
                                    simulatedValue: null,
                                    catalogVariableId: 'cv-temperature',
                                },
                            }),
                        ],
                    }),
                ],
            }),
            new Map(),
        );

        expect(trace.state).toBe('empty');
        expect(trace.emptyReason).toBe('no-eligible-contributors');
        expect(trace.excluded.map((entry) => entry.reason)).toEqual(['catalog-mismatch', 'no-value']);
        expect(trace.resolved).toEqual({ value: null, status: 'no-data', source: 'error' });
    });
});
