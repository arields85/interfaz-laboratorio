import type { AggregationMode, Dashboard, HierarchyNode, WidgetConfig } from '../../domain/admin.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import type { ContractMachine } from '../../domain/dataContract.types';
import type { ResolvedBinding } from '../../domain/widget.types';
import { resolveBinding } from './bindingResolver';

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
    const { allNodes, allDashboards, currentNodeId } = hierarchyContext;

    // Sin nodo actual → no se puede resolver jerarquía
    if (!currentNodeId) {
        return noDataResult('Dashboard sin nodo de jerarquía asignado');
    }

    const targetCatalogVariableId = widget.binding?.catalogVariableId;
    if (!targetCatalogVariableId) {
        return noDataResult('Widget jerárquico sin variable de catálogo asignada');
    }

    const aggregation: AggregationMode = widget.aggregation ?? 'sum';

    // Recolectar TODOS los IDs de nodos descendientes recursivamente
    const descendantNodeIds = collectDescendants(currentNodeId, allNodes);

    if (descendantNodeIds.length === 0) {
        return noDataResult('Nodo sin descendientes');
    }

    // Indexar dashboards por ID para O(1) lookup
    const dashboardMap = new Map(allDashboards.map(d => [d.id, d]));

    // Recolectar valores numéricos de widgets compatibles en dashboards hijos
    const values: number[] = [];
    const processedDashboardIds = new Set<string>();

    for (const nodeId of descendantNodeIds) {
        const node = allNodes.find(n => n.id === nodeId);
        if (!node?.linkedDashboardId) continue;
        if (processedDashboardIds.has(node.linkedDashboardId)) continue;

        const dashboard = dashboardMap.get(node.linkedDashboardId);
        if (!dashboard) continue;

        if (dashboard.status === 'draft') continue;

        processedDashboardIds.add(node.linkedDashboardId);

        // Buscar widgets compatibles con la misma variable canónica en este dashboard
        for (const childWidget of dashboard.widgets) {
            // Solo considerar widgets que NO estén en modo jerárquico ellos mismos
            // (evita recursión infinita y doble conteo)
            if (childWidget.hierarchyMode) continue;

            if (childWidget.binding?.catalogVariableId !== targetCatalogVariableId) continue;

            // Resolver el valor del widget hijo
            const resolved = resolveBinding(childWidget, equipmentMap, machines);

            // Solo agregar valores numéricos válidos
            if (typeof resolved.value === 'number' && resolved.status !== 'no-data') {
                values.push(resolved.value);
            }
        }
    }

    if (values.length === 0) {
        return noDataResult('Sin datos para la variable configurada en descendientes');
    }

    // Aplicar función de agregación
    const aggregatedValue = aggregate(values, aggregation);

    return {
        value: aggregatedValue,
        unit: widget.binding?.unit ?? '',
        status: 'normal',
        source: 'real',
    };
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

function noDataResult(reason?: string): ResolvedBinding {
    void reason;
    return { value: null, status: 'no-data', source: 'error' };
}
