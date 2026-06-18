import type { HierarchyNode } from '../domain/admin.types';
import { mockHierarchyNodes } from '../mocks/hierarchy.mock';
import { HIERARCHY_STORAGE_KEY } from '../utils/legacyStorageCleanup';

const STORAGE_KEY = HIERARCHY_STORAGE_KEY;

// =============================================================================
// HierarchyStorageService
// Persistencia asíncrona de la jerarquía de planta usando localStorage.
// Auto-inicializa con datos mock si el storage está vacío.
//
// Patrón análogo a DashboardStorageService (Fase 6).
// =============================================================================

class HierarchyStorageService {

    private async initStorage(): Promise<void> {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(mockHierarchyNodes));
        }
    }

    private async readStorage(): Promise<HierarchyNode[]> {
        await this.initStorage();
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    }

    /** Retorna todos los nodos de la jerarquía */
    async getNodes(): Promise<HierarchyNode[]> {
        await new Promise(r => setTimeout(r, 250));
        return this.readStorage();
    }

    /** Inserta o actualiza un nodo */
    async saveNode(node: HierarchyNode): Promise<void> {
        await new Promise(r => setTimeout(r, 300));
        const nodes = await this.readStorage();
        const idx = nodes.findIndex(n => n.id === node.id);

        if (idx >= 0) {
            nodes[idx] = node;
        } else {
            nodes.push(node);
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes));
    }

    /** Elimina un nodo por ID solo si no tiene hijos */
    async deleteNode(id: string): Promise<boolean> {
        const nodes = await this.readStorage();
        
        // Validación: No borrar si tiene hijos
        if (nodes.some(n => n.parentId === id)) {
            return false;
        }

        const filtered = nodes.filter(n => n.id !== id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
        return true;
    }

    /** Retorna un solo nodo por ID */
    async getNode(id: string): Promise<HierarchyNode | null> {
        const nodes = await this.readStorage();
        return nodes.find(n => n.id === id) || null;
    }

    /** Crea un nuevo nodo */
    async createNode(name: string, type: HierarchyNode['type'], parentId: string | null = null): Promise<HierarchyNode> {
        const nodes = await this.readStorage();
        // Obtener el máximo order actual para este parent
        const siblings = nodes.filter(n => n.parentId === parentId);
        const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(s => s.order || 0)) : 0;

        const newNode: HierarchyNode = {
            id: `hier-${Date.now().toString(36)}`,
            name,
            type,
            parentId,
            order: maxOrder + 1
        };
        await this.saveNode(newNode);
        return newNode;
    }

    /** Actualiza propiedades parciales de un nodo (excepto parentId que tiene su propio método validado) */
    async updateNode(id: string, partial: Partial<Omit<HierarchyNode, 'id' | 'parentId'>>): Promise<HierarchyNode | null> {
        const nodes = await this.readStorage();
        const idx = nodes.findIndex(n => n.id === id);
        if (idx === -1) return null;

        nodes[idx] = { ...nodes[idx], ...partial };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes));
        return nodes[idx];
    }

    /** Mueve un nodo a un nuevo padre, validando que no haya referencias circulares */
    async updateNodeParent(nodeId: string, newParentId: string | null): Promise<boolean> {
        if (nodeId === newParentId) return false;

        const nodes = await this.readStorage();
        const nodeExists = nodes.some(n => n.id === nodeId);
        if (!nodeExists) return false;
        
        // Si se asigna a un padre, verificar que el padre no sea el propio nodo o uno de sus descendientes
        if (newParentId) {
            if (!nodes.some(n => n.id === newParentId)) return false;

            let currentCheckId: string | null = newParentId;
            while (currentCheckId) {
                if (currentCheckId === nodeId) return false; // Ciclo detectado
                const checkNode = nodes.find(n => n.id === currentCheckId);
                currentCheckId = checkNode ? checkNode.parentId : null;
            }
        }

        const idx = nodes.findIndex(n => n.id === nodeId);

        nodes[idx].parentId = newParentId;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes));
        return true;
    }
}

export const hierarchyStorage = new HierarchyStorageService();
