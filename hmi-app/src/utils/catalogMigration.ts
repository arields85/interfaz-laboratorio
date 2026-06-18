import type { Dashboard } from '../domain/admin.types';
import type { CatalogVariable } from '../domain/variableCatalog.types';

interface CatalogMigrationService {
    getByUnit(unit: string): Promise<CatalogVariable[]>;
    create(variable: CatalogVariable): Promise<CatalogVariable>;
}

/**
 * Migra bindings legacy basados en `variableKey + unit` hacia `catalogVariableId`.
 * La función es idempotente: widgets ya migrados se omiten y solo retorna los
 * dashboards que realmente fueron modificados para que el caller los persista.
 */
export async function migrateLegacyBindings(
    dashboards: Dashboard[],
    catalogService: CatalogMigrationService,
): Promise<string[]> {
    const catalogCache = new Map<string, CatalogVariable>();
    const modifiedDashboardIds = new Set<string>();

    for (const dashboard of dashboards) {
        for (const widget of dashboard.widgets) {
            const binding = widget.binding;

            if (!widget.hierarchyMode || !binding?.variableKey || !binding.unit || binding.catalogVariableId) {
                continue;
            }

            const { variableKey, unit } = binding;

            const cacheKey = buildCatalogKey(variableKey, unit);
            let catalogVariable = catalogCache.get(cacheKey);

            if (!catalogVariable) {
                const unitVariables = await catalogService.getByUnit(unit);
                catalogVariable = unitVariables.find((variable) =>
                    matchesLegacyBinding(variable, variableKey, unit),
                );

                if (!catalogVariable) {
                    catalogVariable = await catalogService.create({
                        id: createCatalogVariableId(variableKey, unit),
                        name: variableKey,
                        unit,
                    });
                }

                catalogCache.set(cacheKey, catalogVariable);
            }

            widget.binding = {
                ...binding,
                catalogVariableId: catalogVariable.id,
            };
            modifiedDashboardIds.add(dashboard.id);
        }
    }

    return [...modifiedDashboardIds];
}

function buildCatalogKey(name: string, unit: string): string {
    return `${name.trim().toLocaleLowerCase()}|${unit.trim()}`;
}

function matchesLegacyBinding(variable: CatalogVariable, variableKey: string, unit: string): boolean {
    const normalizedLegacyName = normalizeName(variableKey);
    const normalizedCatalogName = normalizeName(variable.name);

    return variable.unit === unit
        && (
            normalizedCatalogName === normalizedLegacyName
            || normalizedCatalogName.startsWith(normalizedLegacyName)
            || normalizedLegacyName.startsWith(normalizedCatalogName)
        );
}

function createCatalogVariableId(name: string, unit: string): string {
    const normalizedName = slugify(name);
    const normalizedUnit = slugify(unit);
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 6);
    return `cv-${normalizedName}-${normalizedUnit}-${timestamp}-${random}`;
}

function slugify(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || 'variable';
}

function normalizeName(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .trim();
}
