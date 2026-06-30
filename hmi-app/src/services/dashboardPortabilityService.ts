import type {
    CatalogVariable,
    Dashboard,
    WidgetConfig,
} from '../domain';

import { HEADER_WIDGET_SLOT_COUNT, isHeaderCompatibleWidget } from '../utils/headerWidgets';
import { buildCatalogVariableId } from '../utils/catalogVariableId';
import { supportsCatalogVariable } from '../utils/widgetCapabilities';
import { dashboardStorage } from './DashboardStorageService';
import { variableCatalogStorage } from './VariableCatalogStorageService';

type PortableDashboardDataV1 = Pick<
    Dashboard,
    'id' | 'name' | 'description' | 'dashboardType' | 'aspect' | 'cols' | 'rows' | 'widgets' | 'layout' | 'headerConfig'
>;

export interface PortableDashboardFileV1 {
    schemaVersion: 1;
    exportedAt: string;
    origin: {
        app: 'interfaz-laboratorio';
        dashboardId: string;
        dashboardName: string;
        appVersion?: string;
    };
    dashboard: PortableDashboardDataV1;
    referencedCatalogVariables: CatalogVariable[];
}

export interface DashboardPortabilityIssue {
    code: string;
    path: string;
    message: string;
    severity: 'error' | 'warning';
}

export interface DashboardImportResult {
    dashboard: Dashboard;
    issues: DashboardPortabilityIssue[];
    createdCatalogVariables: CatalogVariable[];
}

export interface DashboardExportResult {
    fileName: string;
    json: string;
    portableFile: PortableDashboardFileV1;
    issues: DashboardPortabilityIssue[];
}

export class DashboardPortabilityValidationError extends Error {
    readonly issues: DashboardPortabilityIssue[];

    constructor(issues: DashboardPortabilityIssue[]) {
        super(issues.map((issue) => issue.message).join('\n') || 'Dashboard portability validation failed');
        this.name = 'DashboardPortabilityValidationError';
        this.issues = issues;
    }
}

class DashboardPortabilityService {
    async exportDashboard(dashboard: Dashboard): Promise<DashboardExportResult> {
        const exportedAt = new Date().toISOString();
        const { referencedCatalogVariables, issues } = await this.collectReferencedCatalogVariables(dashboard);

        const portableFile: PortableDashboardFileV1 = {
            schemaVersion: 1,
            exportedAt,
            origin: {
                app: 'interfaz-laboratorio',
                dashboardId: dashboard.id,
                dashboardName: dashboard.name,
            },
            dashboard: {
                id: dashboard.id,
                name: dashboard.name,
                description: dashboard.description,
                dashboardType: dashboard.dashboardType,
                aspect: dashboard.aspect,
                cols: dashboard.cols,
                rows: dashboard.rows,
                widgets: clone(dashboard.widgets),
                layout: clone(dashboard.layout),
                headerConfig: clone(dashboard.headerConfig),
            },
            referencedCatalogVariables,
        };

        return {
            fileName: buildPortableDashboardFileName(dashboard.name, exportedAt),
            json: JSON.stringify(portableFile, null, 2),
            portableFile,
            issues,
        };
    }

    async importDashboard(json: string): Promise<DashboardImportResult> {
        const parsedFile = this.parsePortableFile(json);
        const issues = this.validatePortableFile(parsedFile);

        if (hasErrors(issues)) {
            throw new DashboardPortabilityValidationError(issues);
        }

        const portableFile = parsedFile as PortableDashboardFileV1;

        const now = new Date().toISOString();
        const sourceDashboard = portableFile.dashboard;
        const importedDashboardId = `dash-${Date.now().toString(36)}`;
        const referencedVariablesById = new Map(portableFile.referencedCatalogVariables.map((variable) => [variable.id, variable]));
        const { catalogVariableIdMap, createdCatalogVariables } = await this.reconcileCatalogVariables(
            sourceDashboard.widgets,
            referencedVariablesById,
        );
        const widgetIdMap = new Map(sourceDashboard.widgets.map((widget, index) => [widget.id, `w-imp-${Date.now().toString(36)}-${index}`]));

        const widgets = sourceDashboard.widgets.map((widget) => {
            const nextWidget = clone(widget);
            nextWidget.id = widgetIdMap.get(widget.id) ?? widget.id;

            if (nextWidget.binding?.catalogVariableId) {
                nextWidget.binding.catalogVariableId = catalogVariableIdMap.get(nextWidget.binding.catalogVariableId)
                    ?? nextWidget.binding.catalogVariableId;
            }

            if (nextWidget.type === 'alert-history' && nextWidget.displayOptions?.dashboardId) {
                if (nextWidget.displayOptions.dashboardId === sourceDashboard.id) {
                    nextWidget.displayOptions.dashboardId = importedDashboardId;
                } else {
                    issues.push({
                        code: 'external_dashboard_reference_cleared',
                        path: `dashboard.widgets[${widget.id}].displayOptions.dashboardId`,
                        message: `Widget "${widget.title}" referenced dashboard "${nextWidget.displayOptions.dashboardId}" from another environment and was cleared during import.`,
                        severity: 'warning',
                    });
                    nextWidget.displayOptions.dashboardId = undefined;
                }
            }

            return nextWidget;
        });

        const layout = sourceDashboard.layout.map((item) => ({
            ...clone(item),
            widgetId: widgetIdMap.get(item.widgetId) ?? item.widgetId,
        }));
        const headerConfig = sourceDashboard.headerConfig
            ? {
                ...clone(sourceDashboard.headerConfig),
                widgetSlots: (sourceDashboard.headerConfig.widgetSlots ?? []).map((slot) => ({
                    ...slot,
                    widgetId: widgetIdMap.get(slot.widgetId) ?? slot.widgetId,
                })),
            }
            : undefined;

        const dashboard: Dashboard = {
            id: importedDashboardId,
            name: sourceDashboard.name,
            description: sourceDashboard.description,
            dashboardType: sourceDashboard.dashboardType,
            aspect: sourceDashboard.aspect,
            cols: sourceDashboard.cols,
            rows: sourceDashboard.rows,
            widgets,
            layout,
            headerConfig,
            isTemplate: false,
            version: 1,
            status: 'draft',
            ownerNodeId: undefined,
            templateId: undefined,
            publishedSnapshot: undefined,
            lastUpdateAt: now,
        };

        await dashboardStorage.saveDashboard(dashboard);

        return {
            dashboard,
            issues,
            createdCatalogVariables,
        };
    }

    private async collectReferencedCatalogVariables(
        dashboard: Dashboard,
    ): Promise<{ referencedCatalogVariables: CatalogVariable[]; issues: DashboardPortabilityIssue[] }> {
        const referencedIds = [...new Set(
            dashboard.widgets
                .map((widget) => widget.binding?.catalogVariableId)
                .filter((catalogVariableId): catalogVariableId is string => Boolean(catalogVariableId)),
        )];

        if (referencedIds.length === 0) {
            return { referencedCatalogVariables: [], issues: [] };
        }

        const availableVariables = await variableCatalogStorage.getAll();
        const variablesById = new Map(availableVariables.map((variable) => [variable.id, variable]));
        const issues: DashboardPortabilityIssue[] = [];

        const referencedCatalogVariables = referencedIds.flatMap((catalogVariableId) => {
            const variable = variablesById.get(catalogVariableId);

            if (!variable) {
                issues.push({
                    code: 'missing_catalog_variable',
                    path: `dashboard.widgets[*].binding.catalogVariableId:${catalogVariableId}`,
                    message: `Catalog variable "${catalogVariableId}" is referenced by the dashboard but missing from local storage.`,
                    severity: 'warning',
                });

                return [];
            }

            return [clone(variable)];
        });

        return { referencedCatalogVariables, issues };
    }

    private parsePortableFile(json: string): unknown {
        try {
            return JSON.parse(json);
        } catch {
            throw new DashboardPortabilityValidationError([
                {
                    code: 'malformed_json',
                    path: '$',
                    message: 'Portable dashboard file is not valid JSON.',
                    severity: 'error',
                },
            ]);
        }
    }

    private validatePortableFile(file: unknown): DashboardPortabilityIssue[] {
        const issues: DashboardPortabilityIssue[] = [];

        if (!isRecord(file)) {
            issues.push({
                code: 'invalid_portable_file_shape',
                path: '$',
                message: 'Portable dashboard file must be a JSON object.',
                severity: 'error',
            });
            return issues;
        }

        if (file.schemaVersion !== 1) {
            issues.push({
                code: 'unsupported_schema_version',
                path: 'schemaVersion',
                message: `Portable dashboard schema version "${String(file.schemaVersion)}" is not supported.`,
                severity: 'error',
            });
            return issues;
        }

        if (!isRecord(file.dashboard)) {
            issues.push({
                code: 'missing_dashboard',
                path: 'dashboard',
                message: 'Portable dashboard file is missing the dashboard payload.',
                severity: 'error',
            });
            return issues;
        }

        if (!Array.isArray(file.referencedCatalogVariables)) {
            issues.push({
                code: 'missing_referenced_catalog_variables',
                path: 'referencedCatalogVariables',
                message: 'Portable dashboard file must include a referencedCatalogVariables array.',
                severity: 'error',
            });
        }

        if (!Array.isArray(file.dashboard.widgets)) {
            issues.push({
                code: 'missing_dashboard_widgets',
                path: 'dashboard.widgets',
                message: 'Portable dashboard file must include a dashboard.widgets array.',
                severity: 'error',
            });
        }

        if (!Array.isArray(file.dashboard.layout)) {
            issues.push({
                code: 'missing_dashboard_layout',
                path: 'dashboard.layout',
                message: 'Portable dashboard file must include a dashboard.layout array.',
                severity: 'error',
            });
        }

        if (hasErrors(issues)) {
            return issues;
        }

        const portableFile = file as unknown as PortableDashboardFileV1;

        const widgetById = new Map<string, WidgetConfig>();
        const referencedVariablesById = new Map(portableFile.referencedCatalogVariables.map((variable) => [variable.id, variable]));

        for (const widget of portableFile.dashboard.widgets) {
            if (widgetById.has(widget.id)) {
                issues.push({
                    code: 'duplicate_widget_id',
                    path: `dashboard.widgets[${widget.id}]`,
                    message: `Widget id "${widget.id}" is duplicated in the portable file.`,
                    severity: 'error',
                });
                continue;
            }

            widgetById.set(widget.id, widget);

            if (widget.binding?.catalogVariableId) {
                if (!supportsCatalogVariable(widget.type)) {
                    issues.push({
                        code: 'invalid_catalog_binding_widget_type',
                        path: `dashboard.widgets[${widget.id}].binding.catalogVariableId`,
                        message: `Widget type "${widget.type}" cannot use catalog variable bindings.`,
                        severity: 'error',
                    });
                }

                if (!referencedVariablesById.has(widget.binding.catalogVariableId)) {
                    issues.push({
                        code: 'missing_referenced_catalog_variable',
                        path: `dashboard.widgets[${widget.id}].binding.catalogVariableId`,
                        message: `Referenced catalog variable metadata for "${widget.binding.catalogVariableId}" is missing from the portable file.`,
                        severity: 'error',
                    });
                }
            }
        }

        for (const layoutItem of portableFile.dashboard.layout) {
            if (!widgetById.has(layoutItem.widgetId)) {
                issues.push({
                    code: 'invalid_layout_widget_reference',
                    path: `dashboard.layout[${layoutItem.widgetId}]`,
                    message: `Layout item references missing widget "${layoutItem.widgetId}".`,
                    severity: 'error',
                });
            }
        }

        const slots = portableFile.dashboard.headerConfig?.widgetSlots ?? [];

        if (slots.length > HEADER_WIDGET_SLOT_COUNT) {
            issues.push({
                code: 'header_slot_limit_exceeded',
                path: 'dashboard.headerConfig.widgetSlots',
                message: `Header supports up to ${HEADER_WIDGET_SLOT_COUNT} widgets.`,
                severity: 'error',
            });
        }

        const occupiedColumns = new Set<number>();

        for (const slot of slots) {
            const widget = widgetById.get(slot.widgetId);

            if (!widget) {
                issues.push({
                    code: 'invalid_header_widget_reference',
                    path: `dashboard.headerConfig.widgetSlots[${slot.widgetId}]`,
                    message: `Header slot references missing widget "${slot.widgetId}".`,
                    severity: 'error',
                });
                continue;
            }

            if (!isHeaderCompatibleWidget(widget)) {
                issues.push({
                    code: 'invalid_header_widget_type',
                    path: `dashboard.headerConfig.widgetSlots[${slot.widgetId}]`,
                    message: `Widget "${slot.widgetId}" of type "${widget.type}" cannot be placed in the header.`,
                    severity: 'error',
                });
            }

            if (slot.column !== undefined) {
                if (!Number.isInteger(slot.column) || slot.column < 0 || slot.column >= HEADER_WIDGET_SLOT_COUNT) {
                    issues.push({
                        code: 'invalid_header_widget_column',
                        path: `dashboard.headerConfig.widgetSlots[${slot.widgetId}].column`,
                        message: `Header widget column "${String(slot.column)}" is outside the supported range.`,
                        severity: 'error',
                    });
                } else if (occupiedColumns.has(slot.column)) {
                    issues.push({
                        code: 'duplicate_header_widget_column',
                        path: `dashboard.headerConfig.widgetSlots[${slot.widgetId}].column`,
                        message: `Header column "${slot.column}" is assigned more than once.`,
                        severity: 'error',
                    });
                }

                occupiedColumns.add(slot.column);
            }
        }

        return issues;
    }

    private async reconcileCatalogVariables(
        widgets: WidgetConfig[],
        referencedVariablesById: ReadonlyMap<string, CatalogVariable>,
    ): Promise<{ catalogVariableIdMap: Map<string, string>; createdCatalogVariables: CatalogVariable[] }> {
        const usedCatalogVariableIds = [...new Set(
            widgets
                .map((widget) => widget.binding?.catalogVariableId)
                .filter((catalogVariableId): catalogVariableId is string => Boolean(catalogVariableId)),
        )];
        const catalogVariableIdMap = new Map<string, string>();
        const createdCatalogVariables: CatalogVariable[] = [];

        for (const sourceCatalogVariableId of usedCatalogVariableIds) {
            const referencedVariable = referencedVariablesById.get(sourceCatalogVariableId);

            if (!referencedVariable) {
                continue;
            }

            const existingVariable = await variableCatalogStorage.findByNameAndUnit(
                referencedVariable.name,
                referencedVariable.unit,
            );

            if (existingVariable) {
                catalogVariableIdMap.set(sourceCatalogVariableId, existingVariable.id);
                continue;
            }

            const createdVariable = {
                ...clone(referencedVariable),
                id: buildUniqueCatalogVariableId(referencedVariable, [
                    ...createdCatalogVariables,
                    ...await variableCatalogStorage.getAll(),
                ]),
            };

            await variableCatalogStorage.create(createdVariable);
            createdCatalogVariables.push(createdVariable);
            catalogVariableIdMap.set(sourceCatalogVariableId, createdVariable.id);
        }

        return { catalogVariableIdMap, createdCatalogVariables };
    }
}

function buildUniqueCatalogVariableId(variable: CatalogVariable, existingVariables: CatalogVariable[]): string {
    const existingIds = new Set(existingVariables.map((item) => item.id));
    let candidate = buildCatalogVariableId(variable.name, variable.unit);

    while (existingIds.has(candidate)) {
        candidate = buildCatalogVariableId(variable.name, variable.unit);
    }

    return candidate;
}

function hasErrors(issues: DashboardPortabilityIssue[]): boolean {
    return issues.some((issue) => issue.severity === 'error');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function buildPortableDashboardFileName(dashboardName: string, exportedAt: string): string {
    const exportedDate = new Date(exportedAt);

    return `interfaz-laboratorio-dashboard-${slugifyFileSegment(dashboardName)}-${formatPortableTimestamp(exportedDate)}.json`;
}

function formatPortableTimestamp(value: Date): string {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    const hours = String(value.getUTCHours()).padStart(2, '0');
    const minutes = String(value.getUTCMinutes()).padStart(2, '0');

    return `${year}${month}${day}-${hours}${minutes}`;
}

function slugifyFileSegment(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || 'dashboard';
}

function clone<T>(value: T): T {
    if (value === undefined) {
        return value;
    }

    return JSON.parse(JSON.stringify(value)) as T;
}

export const dashboardPortabilityService = new DashboardPortabilityService();
