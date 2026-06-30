import type { CatalogVariable, Dashboard } from '../domain';
import { mockVariableCatalog } from '../mocks/variableCatalog.mock';
import { DASHBOARDS_STORAGE_KEY, VARIABLE_CATALOG_STORAGE_KEY } from '../utils/legacyStorageCleanup';

const STORAGE_KEY = VARIABLE_CATALOG_STORAGE_KEY;

interface AffectedDashboard {
    id: string;
    name: string;
}

class VariableCatalogStorageService {

    private async initStorage(): Promise<void> {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(mockVariableCatalog));
        }
    }

    private async readStorage(): Promise<CatalogVariable[]> {
        await this.initStorage();
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    }

    private async writeStorage(variables: CatalogVariable[]): Promise<void> {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(variables));
    }

    /** Retorna todas las variables del catálogo. */
    async getAll(): Promise<CatalogVariable[]> {
        await new Promise(r => setTimeout(r, 200));
        return this.readStorage();
    }

    /** Retorna una variable del catálogo por ID. */
    async getById(id: string): Promise<CatalogVariable | null> {
        const variables = await this.readStorage();
        return variables.find((variable) => variable.id === id) ?? null;
    }

    /** Retorna las variables cuya unidad canónica coincide con la solicitada. */
    async getByUnit(unit: string): Promise<CatalogVariable[]> {
        const variables = await this.readStorage();
        return variables.filter((variable) => variable.unit === unit);
    }

    /** Retorna una variable por nombre (case-insensitive) y unidad exacta. */
    async findByNameAndUnit(name: string, unit: string): Promise<CatalogVariable | null> {
        const variables = await this.readStorage();
        const normalizedName = name.trim().toLocaleLowerCase();

        return variables.find(
            (variable) => variable.unit === unit && variable.name.trim().toLocaleLowerCase() === normalizedName,
        ) ?? null;
    }

    /**
     * Crea una variable nueva en el catálogo.
     * Rechaza nombres duplicados dentro de la misma unidad.
     */
    async create(variable: CatalogVariable): Promise<CatalogVariable> {
        const variables = await this.readStorage();
        const duplicate = variables.some(
            (existingVariable) =>
                existingVariable.unit === variable.unit
                && existingVariable.name.toLowerCase() === variable.name.toLowerCase(),
        );

        if (duplicate) {
            throw new Error(`Variable "${variable.name}" already exists for unit "${variable.unit}"`);
        }

        variables.push(variable);
        await this.writeStorage(variables);
        return variable;
    }

    /**
     * Actualiza una variable existente.
     * La unidad se mantiene inmutable; solo admite cambios de nombre y descripción.
     */
    async update(id: string, data: Pick<CatalogVariable, 'name' | 'description'>): Promise<CatalogVariable | null> {
        const variables = await this.readStorage();
        const variableIndex = variables.findIndex((variable) => variable.id === id);

        if (variableIndex === -1) {
            return null;
        }

        const currentVariable = variables[variableIndex];
        const duplicate = variables.some(
            (existingVariable) =>
                existingVariable.id !== id
                && existingVariable.unit === currentVariable.unit
                && existingVariable.name.toLowerCase() === data.name.toLowerCase(),
        );

        if (duplicate) {
            throw new Error(`Variable "${data.name}" already exists for unit "${currentVariable.unit}"`);
        }

        variables[variableIndex] = {
            ...currentVariable,
            name: data.name,
            description: data.description,
        };

        await this.writeStorage(variables);
        return variables[variableIndex];
    }

    /** Elimina una variable del catálogo por ID. */
    async delete(id: string): Promise<boolean> {
        const variables = await this.readStorage();
        const filteredVariables = variables.filter((variable) => variable.id !== id);

        if (filteredVariables.length === variables.length) {
            return false;
        }

        await this.writeStorage(filteredVariables);
        return true;
    }

    /**
     * Lista dashboards que referencian una variable del catálogo.
     * Lee el storage de dashboards en forma directa para evitar acople circular.
     */
    async getAffectedDashboards(variableId: string): Promise<AffectedDashboard[]> {
        const storedDashboards = localStorage.getItem(DASHBOARDS_STORAGE_KEY);

        if (!storedDashboards) {
            return [];
        }

        const dashboards: Dashboard[] = JSON.parse(storedDashboards);

        return dashboards
            .filter((dashboard) =>
                dashboard.widgets.some(
                    (widget) => widget.binding?.catalogVariableId === variableId,
                ),
            )
            .map((dashboard) => ({
                id: dashboard.id,
                name: dashboard.name,
            }));
    }
}

export const variableCatalogStorage = new VariableCatalogStorageService();
