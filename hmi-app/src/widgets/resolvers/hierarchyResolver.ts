import type { AggregationMode, Dashboard, HierarchyNode, WidgetConfig } from '../../domain/admin.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import type { ContractMachine } from '../../domain/dataContract.types';
import type { ResolvedBinding } from '../../domain/widget.types';
import { resolveBinding } from './bindingResolver';

export type HierarchyTraceState = 'resolved' | 'empty';

export type HierarchyTraceEmptyReason =
    | 'missing-current-node'
    | 'missing-catalog-variable'
    | 'no-descendants'
    | 'no-eligible-contributors';

export type HierarchyTraceExclusionReason =
    | 'missing-dashboard'
    | 'draft-dashboard'
    | 'duplicate-dashboard'
    | 'nested-hierarchy-widget'
    | 'catalog-mismatch'
    | 'non-numeric'
    | 'no-value';

export interface HierarchyTraceContributor {
    nodeId: string;
    nodeName: string;
    dashboardId: string;
    dashboardName: string;
    widgetId: string;
    widgetTitle: string;
    value: number;
    unit?: string;
    status: ResolvedBinding['status'];
    source: ResolvedBinding['source'];
}

export interface HierarchyTraceExclusion {
    nodeId: string;
    nodeName: string;
    dashboardId?: string;
    dashboardName?: string;
    widgetId?: string;
    widgetTitle?: string;
    reason: HierarchyTraceExclusionReason;
    value?: ResolvedBinding['value'];
    unit?: string;
    status?: ResolvedBinding['status'];
    source?: ResolvedBinding['source'];
}

export interface HierarchyAggregationTrace {
    resolved: ResolvedBinding;
    state: HierarchyTraceState;
    emptyReason?: HierarchyTraceEmptyReason;
    catalogVariableId?: string;
    aggregation: AggregationMode;
    descendantNodeCount: number;
    scannedDashboardCount: number;
    included: HierarchyTraceContributor[];
    excluded: HierarchyTraceExclusion[];
}

const EMPTY_REASON_MESSAGES: Record<HierarchyTraceEmptyReason, { title: string; description: string }> = {
    'missing-current-node': {
        title: 'Jerarquía sin nodo actual.',
        description: 'Este dashboard no tiene un nodo asignado dentro de la jerarquía.',
    },
    'missing-catalog-variable': {
        title: 'Falta variable de catálogo.',
        description: 'Asigná una variable de catálogo antes de calcular la agregación jerárquica.',
    },
    'no-descendants': {
        title: 'Sin descendientes configurados.',
        description: 'El nodo actual no tiene dashboards descendientes para recorrer.',
    },
    'no-eligible-contributors': {
        title: 'Sin datos elegibles para esta jerarquía.',
        description: 'No se encontró ningún contributor numérico para la variable seleccionada.',
    },
};

const EXCLUSION_REASON_LABELS: Record<HierarchyTraceExclusionReason, string> = {
    'missing-dashboard': 'Dashboard faltante',
    'draft-dashboard': 'Dashboard en draft',
    'duplicate-dashboard': 'Dashboard duplicado',
    'nested-hierarchy-widget': 'Jerarquía anidada',
    'catalog-mismatch': 'Variable distinta',
    'non-numeric': 'Valor no numérico',
    'no-value': 'Sin valor',
};

const AGGREGATION_MODE_LABELS: Record<AggregationMode, string> = {
    sum: 'Suma',
    avg: 'Promedio',
    max: 'Máximo',
    min: 'Mínimo',
};

// =============================================================================
// hierarchyResolver
// Resolver genérico de agregación jerárquica.
//
// Dado un widget en modo jerárquico, recorre recursivamente TODOS los
// descendientes del nodo actual en la jerarquía de planta. Para cada
// descendiente con dashboard vinculado, busca widgets con la misma variable
// canónica (`binding.catalogVariableId`) y agrega sus valores resueltos usando
// la función de agregación configurada (sum, avg, max, min).
//
// Esta función es genérica — cualquier renderer puede consumirla.
// No tiene dependencia con ningún widget específico.
//
// Arquitectura: widgets/resolvers/ (misma capa que bindingResolver)
// =============================================================================

/**
 * Contexto jerárquico necesario para resolver agregaciones.
 * Se carga una sola vez a nivel de página y se pasa como prop a los renderers.
 */
export interface HierarchyContext {
    /** Todos los nodos de la jerarquía de planta. */
    allNodes: HierarchyNode[];
    /** Todos los dashboards del sistema (para buscar widgets en hijos). */
    allDashboards: Dashboard[];
    /** ID del nodo al que pertenece el dashboard que se está renderizando. */
    currentNodeId?: string;
}

/**
 * Resuelve un widget en modo jerárquico.
 * Recorre toda la descendencia del nodo actual, recolecta valores de widgets
 * con la misma variable canónica, y aplica la función de agregación.
 *
 * Retorna `ResolvedBinding` con:
 * - `source: 'real'` si hay al menos un valor agregado
 * - `source: 'error'` con `status: 'no-data'` si no se encontraron valores
 */
export function resolveHierarchyBinding(
    widget: WidgetConfig,
    hierarchyContext: HierarchyContext,
    equipmentMap: Map<string, EquipmentSummary>,
    machines?: ContractMachine[],
): ResolvedBinding {
    return buildHierarchyAggregationTrace(widget, hierarchyContext, equipmentMap, machines).resolved;
}

export function buildHierarchyAggregationTrace(
    widget: WidgetConfig,
    hierarchyContext: HierarchyContext,
    equipmentMap: Map<string, EquipmentSummary>,
    machines?: ContractMachine[],
): HierarchyAggregationTrace {
    const { allNodes, allDashboards, currentNodeId } = hierarchyContext;
    const aggregation: AggregationMode = widget.aggregation ?? 'sum';
    const targetCatalogVariableId = widget.binding?.catalogVariableId;
    const baseTrace = createBaseTrace({
        aggregation,
        catalogVariableId: targetCatalogVariableId,
    });

    if (!currentNodeId) {
        return {
            ...baseTrace,
            emptyReason: 'missing-current-node',
        };
    }

    if (!targetCatalogVariableId) {
        return {
            ...baseTrace,
            emptyReason: 'missing-catalog-variable',
        };
    }

    const descendantNodeIds = collectDescendants(currentNodeId, allNodes);

    if (descendantNodeIds.length === 0) {
        return {
            ...baseTrace,
            descendantNodeCount: 0,
            emptyReason: 'no-descendants',
        };
    }

    const dashboardMap = new Map(allDashboards.map(d => [d.id, d]));
    const values: number[] = [];
    const processedDashboardIds = new Set<string>();
    const included: HierarchyTraceContributor[] = [];
    const excluded: HierarchyTraceExclusion[] = [];
    const nodeMap = new Map(allNodes.map((node) => [node.id, node]));
    let scannedDashboardCount = 0;

    for (const nodeId of descendantNodeIds) {
        const node = nodeMap.get(nodeId);
        if (!node?.linkedDashboardId) continue;

        if (processedDashboardIds.has(node.linkedDashboardId)) {
            excluded.push(createNodeExclusion(node, node.linkedDashboardId, 'duplicate-dashboard'));
            continue;
        }

        scannedDashboardCount += 1;

        const dashboard = dashboardMap.get(node.linkedDashboardId);
        if (!dashboard) {
            excluded.push(createNodeExclusion(node, node.linkedDashboardId, 'missing-dashboard'));
            continue;
        }

        if (dashboard.status === 'draft') {
            excluded.push(createNodeExclusion(node, node.linkedDashboardId, 'draft-dashboard', dashboard));
            continue;
        }

        processedDashboardIds.add(node.linkedDashboardId);

        for (const childWidget of dashboard.widgets) {
            if (childWidget.hierarchyMode) {
                excluded.push(createWidgetExclusion(node, dashboard, childWidget, 'nested-hierarchy-widget'));
                continue;
            }

            if (childWidget.binding?.catalogVariableId !== targetCatalogVariableId) {
                excluded.push(createWidgetExclusion(node, dashboard, childWidget, 'catalog-mismatch'));
                continue;
            }

            const resolved = resolveBinding(childWidget, equipmentMap, machines);

            if (resolved.value == null) {
                excluded.push(createWidgetExclusion(node, dashboard, childWidget, 'no-value', resolved));
                continue;
            }

            if (typeof resolved.value !== 'number') {
                excluded.push(createWidgetExclusion(node, dashboard, childWidget, 'non-numeric', resolved));
                continue;
            }

            values.push(resolved.value);
            included.push({
                nodeId: node.id,
                nodeName: node.name,
                dashboardId: dashboard.id,
                dashboardName: dashboardName(dashboard),
                widgetId: childWidget.id,
                widgetTitle: childWidget.title || childWidget.id,
                value: resolved.value,
                unit: resolved.unit ?? childWidget.binding?.unit,
                status: resolved.status,
                source: resolved.source,
            });
        }
    }

    if (values.length === 0) {
        return {
            ...baseTrace,
            descendantNodeCount: descendantNodeIds.length,
            scannedDashboardCount,
            included,
            excluded,
            emptyReason: 'no-eligible-contributors',
        };
    }

    const aggregatedValue = aggregate(values, aggregation);

    return {
        resolved: {
            value: aggregatedValue,
            unit: widget.binding?.unit ?? included[0]?.unit ?? '',
            status: 'normal',
            source: 'real',
        },
        state: 'resolved',
        catalogVariableId: targetCatalogVariableId,
        aggregation,
        descendantNodeCount: descendantNodeIds.length,
        scannedDashboardCount,
        included,
        excluded,
    };
}

export function getHierarchyTraceEmptyStateMessage(reason: HierarchyTraceEmptyReason): { title: string; description: string } {
    return EMPTY_REASON_MESSAGES[reason];
}

export function getHierarchyTraceExclusionReasonLabel(reason: HierarchyTraceExclusionReason): string {
    return EXCLUSION_REASON_LABELS[reason];
}

export function getHierarchyAggregationModeLabel(mode: AggregationMode): string {
    return AGGREGATION_MODE_LABELS[mode];
}

// -----------------------------------------------------------------------------
// Helpers internos
// -----------------------------------------------------------------------------

/**
 * Recolecta recursivamente todos los IDs de nodos descendientes de un nodo dado.
 * No incluye el nodo raíz — solo hijos, nietos, tataranietos, etc.
 */
function collectDescendants(parentId: string, allNodes: HierarchyNode[]): string[] {
    const result: string[] = [];
    const queue = [parentId];

    while (queue.length > 0) {
        const currentId = queue.shift()!;
        const children = allNodes.filter(n => n.parentId === currentId);

        for (const child of children) {
            result.push(child.id);
            queue.push(child.id);
        }
    }

    return result;
}

/**
 * Aplica la función de agregación sobre un array de valores numéricos.
 * Precondición: values.length > 0.
 */
function aggregate(values: number[], mode: AggregationMode): number {
    switch (mode) {
        case 'sum':
            return values.reduce((acc, v) => acc + v, 0);
        case 'avg':
            return values.reduce((acc, v) => acc + v, 0) / values.length;
        case 'max':
            return Math.max(...values);
        case 'min':
            return Math.min(...values);
    }
}

function createBaseTrace({
    aggregation,
    catalogVariableId,
}: {
    aggregation: AggregationMode;
    catalogVariableId?: string;
}): HierarchyAggregationTrace {
    return {
        resolved: noDataResult(),
        state: 'empty',
        catalogVariableId,
        aggregation,
        descendantNodeCount: 0,
        scannedDashboardCount: 0,
        included: [],
        excluded: [],
    };
}

function createNodeExclusion(
    node: HierarchyNode,
    dashboardId: string,
    reason: HierarchyTraceExclusionReason,
    dashboard?: Dashboard,
): HierarchyTraceExclusion {
    return {
        nodeId: node.id,
        nodeName: node.name,
        dashboardId,
        dashboardName: dashboard ? dashboardName(dashboard) : undefined,
        reason,
    };
}

function createWidgetExclusion(
    node: HierarchyNode,
    dashboard: Dashboard,
    widget: WidgetConfig,
    reason: HierarchyTraceExclusionReason,
    resolved?: ResolvedBinding,
): HierarchyTraceExclusion {
    return {
        nodeId: node.id,
        nodeName: node.name,
        dashboardId: dashboard.id,
        dashboardName: dashboardName(dashboard),
        widgetId: widget.id,
        widgetTitle: widget.title || widget.id,
        reason,
        value: resolved?.value,
        unit: resolved?.unit ?? widget.binding?.unit,
        status: resolved?.status,
        source: resolved?.source,
    };
}

function dashboardName(dashboard: Dashboard): string {
    return dashboard.headerConfig?.title?.trim() || dashboard.name;
}

function noDataResult(reason?: string): ResolvedBinding {
    void reason;
    return { value: null, status: 'no-data', source: 'error' };
}
