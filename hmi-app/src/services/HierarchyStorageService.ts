import type { HierarchyNode } from '../domain/admin.types';
import { HIERARCHY_STORAGE_KEY } from '../utils/legacyStorageCleanup';
import type { ConfigStoragePort } from '../domain/sharedConfig.types';
import { sharedConfigStorage } from './sharedConfigStorage.service';

const STORAGE_KEY = HIERARCHY_STORAGE_KEY;

// =============================================================================
// HierarchyStorageService
// Persistencia asíncrona de la jerarquía de planta sobre la configuración
// compartida del servidor (sharedConfigStorage). Una lectura nunca escribe: sin
// datos devuelve una colección vacía (instalación nueva sin datos de ejemplo).
//
// Patrón análogo a DashboardStorageService (Fase 6).
// =============================================================================

export class HierarchyStorageService {
    private readonly storage: ConfigStoragePort;

    constructor(storage: ConfigStoragePort = sharedConfigStorage) {
        this.storage = storage;
    }


    private async readStorage(): Promise<HierarchyNode[]> {
        const stored = this.storage.getItem(STORAGE_KEY);
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

        this.storage.setItem(STORAGE_KEY, JSON.stringify(nodes));
    }

    /** Elimina un nodo por ID solo si no tiene hijos */
    async deleteNode(id: string): Promise<boolean> {
        const nodes = await this.readStorage();
        
        // Validación: No borrar si tiene hijos
        if (nodes.some(n => n.parentId === id)) {
            return false;
        }

        const filtered = nodes.filter(n => n.id !== id);
        this.storage.setItem(STORAGE_KEY, JSON.stringify(filtered));
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
        this.storage.setItem(STORAGE_KEY, JSON.stringify(nodes));
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
        this.storage.setItem(STORAGE_KEY, JSON.stringify(nodes));
        return true;
    }
}

export const hierarchyStorage = new HierarchyStorageService();
