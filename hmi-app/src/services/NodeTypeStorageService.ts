import { NODE_TYPES_STORAGE_KEY } from '../utils/legacyStorageCleanup';
import type { ConfigStoragePort } from '../domain/sharedConfig.types';
import { sharedConfigStorage } from './sharedConfigStorage.service';

export interface NodeTypeDefinition {
    key: string;
    label: string;
    icon: string;
    color: string;
}

const STORAGE_KEY = NODE_TYPES_STORAGE_KEY;

export const DEFAULT_NODE_TYPES: NodeTypeDefinition[] = [
    { key: 'plant', label: 'Planta', icon: 'factory', color: 'text-accent-cyan' },
    { key: 'area', label: 'Área', icon: 'layers', color: 'text-accent-blue' },
    { key: 'sector', label: 'Sector', icon: 'grid', color: 'text-accent-blue-glow' },
    { key: 'line', label: 'Línea', icon: 'minus', color: 'text-accent-purple-light' },
    { key: 'cell', label: 'Celda', icon: 'square', color: 'text-accent-purple' },
    { key: 'box', label: 'Box', icon: 'box', color: 'text-accent-amber' },
    { key: 'equipment', label: 'Equipo', icon: 'cpu', color: 'text-accent-green' },
    { key: 'folder', label: 'Carpeta', icon: 'folder', color: 'text-accent-amber' },
    { key: 'group', label: 'Grupo', icon: 'users', color: 'text-accent-pink' },
];

export class NodeTypeStorageService {
    private readonly storage: ConfigStoragePort;

    constructor(storage: ConfigStoragePort = sharedConfigStorage) {
        this.storage = storage;
    }

    // Reads never write: until an administrator saves, the defaults are served as they are.
    private async readStorage(): Promise<NodeTypeDefinition[]> {
        const stored = this.storage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) as NodeTypeDefinition[] : [...DEFAULT_NODE_TYPES];
    }

    async getAll(): Promise<NodeTypeDefinition[]> {
        return this.readStorage();
    }

    async save(types: NodeTypeDefinition[]): Promise<void> {
        this.storage.setItem(STORAGE_KEY, JSON.stringify(types));
    }
}

export const nodeTypeStorage = new NodeTypeStorageService();
