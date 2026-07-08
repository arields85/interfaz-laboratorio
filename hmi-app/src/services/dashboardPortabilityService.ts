import type {
    CatalogVariable,
    Dashboard,
    DashboardView,
    WidgetConfig,
} from '../domain';

import { HEADER_WIDGET_SLOT_COUNT, isHeaderCompatibleWidget } from '../utils/headerWidgets';
import { buildCatalogVariableId } from '../utils/catalogVariableId';
import {
    DEFAULT_DASHBOARD_VIEW_ID,
    DEFAULT_DASHBOARD_VIEW_NAME,
    cloneDashboardViewsWithRemappedIds,
    materializeDashboardView,
    normalizeDashboardViews,
    remapDashboardHeaderConfigAcrossViews,
} from '../utils/dashboardViews';
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

type PortableDashboardDataV2 = Pick<
    Dashboard,
    'id' | 'name' | 'description' | 'dashboardType' | 'aspect' | 'cols' | 'rows' | 'headerConfig' | 'views' | 'activeViewId'
>;

export interface PortableDashboardFileV2 {
    schemaVersion: 2;
    exportedAt: string;
    origin: {
        app: 'interfaz-laboratorio';
        dashboardId: string;
        dashboardName: string;
        appVersion?: string;
    };
    dashboard: PortableDashboardDataV2;
    referencedCatalogVariables: CatalogVariable[];
}

type PortableDashboardFile = PortableDashboardFileV1 | PortableDashboardFileV2;
type NormalizedPortableDashboard = Dashboard & { views: DashboardView[]; activeViewId: string };

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
    portableFile: PortableDashboardFile;
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
        const normalizedDashboard = materializeDashboardView(dashboard, dashboard.activeViewId);
        const { referencedCatalogVariables, issues } = await this.collectReferencedCatalogVariables(normalizedDashboard);
        const {
            headerConfig: exportedHeaderConfig,
            issues: headerConfigIssues,
        } = sanitizeExportHeaderConfig(normalizedDashboard);
        const exportIssues = [...issues, ...headerConfigIssues];

        const portableFile: PortableDashboardFileV2 = {
            schemaVersion: 2,
            exportedAt,
            origin: {
                app: 'interfaz-laboratorio',
                dashboardId: normalizedDashboard.id,
                dashboardName: normalizedDashboard.name,
            },
            dashboard: {
                id: normalizedDashboard.id,
                name: normalizedDashboard.name,
                description: normalizedDashboard.description,
                dashboardType: normalizedDashboard.dashboardType,
                aspect: normalizedDashboard.aspect,
                cols: normalizedDashboard.cols,
                rows: normalizedDashboard.rows,
                activeViewId: normalizedDashboard.activeViewId,
                views: clone(normalizedDashboard.views),
                headerConfig: exportedHeaderConfig,
            },
            referencedCatalogVariables,
        };

        return {
            fileName: buildPortableDashboardFileName(normalizedDashboard.name, exportedAt),
            json: JSON.stringify(portableFile, null, 2),
            portableFile,
            issues: exportIssues,
        };
    }

    async importDashboard(json: string): Promise<DashboardImportResult> {
        const parsedFile = this.parsePortableFile(json);
        const issues = this.validatePortableFile(parsedFile);

        if (hasErrors(issues)) {
            throw new DashboardPortabilityValidationError(issues);
        }

        const portableFile = parsedFile as PortableDashboardFile;

        const now = new Date().toISOString();
        const sourceDashboard = normalizePortableDashboard(portableFile);
        const sourceViews = sourceDashboard.views;
        const importedDashboardId = `dash-${Date.now().toString(36)}`;
        const referencedVariablesById = new Map(portableFile.referencedCatalogVariables.map((variable) => [variable.id, variable]));
        const { catalogVariableIdMap, createdCatalogVariables } = await this.reconcileCatalogVariables(
            sourceViews.flatMap((view) => view.widgets),
            referencedVariablesById,
        );
        const cloneSeed = Date.now().toString(36);
        const clonedViewResult = cloneDashboardViewsWithRemappedIds(sourceViews, cloneSeed);
        const clonedViews = clonedViewResult.views.map((view, viewIndex) => ({
            ...view,
            widgets: view.widgets.map((widget, widgetIndex) => {
                const sourceWidget = sourceViews[viewIndex]?.widgets[widgetIndex];
                const nextWidget = clone(widget);

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
                            path: `dashboard.views[${sourceViews[viewIndex]?.id}].widgets[${sourceWidget?.id ?? widget.id}].displayOptions.dashboardId`,
                            message: `Widget "${nextWidget.title}" referenced dashboard "${nextWidget.displayOptions.dashboardId}" from another environment and was cleared during import.`,
                            severity: 'warning',
                        });
                        nextWidget.displayOptions.dashboardId = undefined;
                    }
                }

                return nextWidget;
            }),
        }));
        const activeViewId = sourceDashboard.activeViewId
            ? clonedViewResult.viewIdMap.get(sourceDashboard.activeViewId) ?? clonedViews[0]?.id
            : clonedViews[0]?.id;
        const headerConfig = remapDashboardHeaderConfigAcrossViews(
            sourceDashboard.headerConfig,
            sourceViews,
            clonedViewResult.widgetIdMapByView,
        );

        const dashboard = materializeDashboardView({
            id: importedDashboardId,
            name: sourceDashboard.name,
            description: sourceDashboard.description,
            dashboardType: sourceDashboard.dashboardType,
            aspect: sourceDashboard.aspect,
            cols: sourceDashboard.cols,
            rows: sourceDashboard.rows,
            views: clonedViews,
            activeViewId,
            headerConfig,
            isTemplate: false,
            version: 1,
            status: 'draft',
            ownerNodeId: undefined,
            templateId: undefined,
            publishedSnapshot: undefined,
            lastUpdateAt: now,
            widgets: [],
            layout: [],
        }, activeViewId);

        try {
            await dashboardStorage.saveDashboard(dashboard);
        } catch (error) {
            await this.rollbackCreatedCatalogVariables(createdCatalogVariables);
            throw error;
        }

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
            normalizeDashboardViews(dashboard).views
                ?.flatMap((view) => view.widgets)
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

        if (file.schemaVersion !== 1 && file.schemaVersion !== 2) {
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

        if (file.schemaVersion === 1) {
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
        }

        if (file.schemaVersion === 2 && !Array.isArray((file.dashboard as PortableDashboardDataV2).views)) {
            issues.push({
                code: 'missing_dashboard_views',
                path: 'dashboard.views',
                message: 'Portable dashboard file must include a dashboard.views array.',
                severity: 'error',
            });
        }

        if (hasErrors(issues)) {
            return issues;
        }

        const portableFile = file as unknown as PortableDashboardFile;

        const referencedVariablesById = new Map(portableFile.referencedCatalogVariables.map((variable) => [variable.id, variable]));
        const normalizedDashboard = normalizePortableDashboard(portableFile);
        const sourceViews = portableFile.schemaVersion === 2 ? portableFile.dashboard.views ?? [] : normalizedDashboard.views;

        if (portableFile.schemaVersion === 2) {
            const viewIds = new Set<string>();

            for (const view of sourceViews) {
                if (viewIds.has(view.id)) {
                    issues.push({
                        code: 'duplicate_view_id',
                        path: `dashboard.views[${view.id}]`,
                        message: `View id "${view.id}" is duplicated in the portable dashboard file.`,
                        severity: 'error',
                    });
                    continue;
                }

                viewIds.add(view.id);
            }

            if (portableFile.dashboard.activeViewId && !viewIds.has(portableFile.dashboard.activeViewId)) {
                issues.push({
                    code: 'invalid_active_view_reference',
                    path: 'dashboard.activeViewId',
                    message: `Active view "${portableFile.dashboard.activeViewId}" does not exist in dashboard.views.`,
                    severity: 'error',
                });
            }
        }

        if (hasErrors(issues)) {
            return issues;
        }

        const widgetByIdByView = new Map<string, Map<string, WidgetConfig>>();

        normalizedDashboard.views.forEach((view) => {
            const widgetById = new Map<string, WidgetConfig>();

            for (const widget of view.widgets) {
                if (widgetById.has(widget.id)) {
                    issues.push({
                        code: 'duplicate_widget_id',
                        path: `dashboard.views[${view.id}].widgets[${widget.id}]`,
                        message: `Widget id "${widget.id}" is duplicated in view "${view.name}".`,
                        severity: 'error',
                    });
                    continue;
                }

                widgetById.set(widget.id, widget);

                if (widget.binding?.catalogVariableId) {
                    if (!supportsCatalogVariable(widget.type)) {
                        issues.push({
                            code: 'invalid_catalog_binding_widget_type',
                            path: `dashboard.views[${view.id}].widgets[${widget.id}].binding.catalogVariableId`,
                            message: `Widget type "${widget.type}" cannot use catalog variable bindings.`,
                            severity: 'error',
                        });
                    }

                    if (!referencedVariablesById.has(widget.binding.catalogVariableId)) {
                        issues.push({
                            code: 'missing_referenced_catalog_variable',
                            path: `dashboard.views[${view.id}].widgets[${widget.id}].binding.catalogVariableId`,
                            message: `Referenced catalog variable metadata for "${widget.binding.catalogVariableId}" is missing from the portable file.`,
                            severity: 'error',
                        });
                    }
                }
            }

            for (const layoutItem of view.layout) {
                if (!widgetById.has(layoutItem.widgetId)) {
                    issues.push({
                        code: 'invalid_layout_widget_reference',
                        path: `dashboard.views[${view.id}].layout[${layoutItem.widgetId}]`,
                        message: `Layout item references missing widget "${layoutItem.widgetId}" in view "${view.name}".`,
                        severity: 'error',
                    });
                }
            }

            widgetByIdByView.set(view.id, widgetById);
        });

        const slots = normalizedDashboard.headerConfig?.widgetSlots ?? [];

        for (const slot of slots) {
            const slotViews = normalizedDashboard.views.flatMap((view) => {
                const widget = widgetByIdByView.get(view.id)?.get(slot.widgetId);

                return widget ? [{ view, widget }] : [];
            });

            if (slotViews.length === 0) {
                issues.push({
                    code: 'invalid_header_widget_reference',
                    path: `dashboard.headerConfig.widgetSlots[${slot.widgetId}]`,
                    message: `Header slot references missing widget "${slot.widgetId}".`,
                    severity: 'error',
                });
                continue;
            }

            if (slotViews.length > 1) {
                issues.push({
                    code: 'ambiguous_header_widget_reference',
                    path: `dashboard.headerConfig.widgetSlots[${slot.widgetId}]`,
                    message: `Header slot widget "${slot.widgetId}" exists in multiple views and cannot be imported unambiguously.`,
                    severity: 'error',
                });
                continue;
            }

            slotViews.forEach(({ widget }) => {
                if (!isHeaderCompatibleWidget(widget)) {
                    issues.push({
                        code: 'invalid_header_widget_type',
                        path: `dashboard.headerConfig.widgetSlots[${slot.widgetId}]`,
                        message: `Widget "${slot.widgetId}" of type "${widget.type}" cannot be placed in the header.`,
                        severity: 'error',
                    });
                }
            });
        }

        normalizedDashboard.views.forEach((view) => {
            const viewSlots = slots.filter((slot) => widgetByIdByView.get(view.id)?.has(slot.widgetId));

            if (viewSlots.length > HEADER_WIDGET_SLOT_COUNT) {
                issues.push({
                    code: 'header_slot_limit_exceeded',
                    path: 'dashboard.headerConfig.widgetSlots',
                    message: `Header supports up to ${HEADER_WIDGET_SLOT_COUNT} widgets per view.`,
                    severity: 'error',
                });
            }

            const occupiedColumns = new Set<number>();

            viewSlots.forEach((slot, index) => {
                const resolvedColumn = slot.column ?? index;

                if (!Number.isInteger(resolvedColumn) || resolvedColumn < 0 || resolvedColumn >= HEADER_WIDGET_SLOT_COUNT) {
                    issues.push({
                        code: 'invalid_header_widget_column',
                        path: `dashboard.headerConfig.widgetSlots[${slot.widgetId}].column`,
                        message: `Header widget column "${String(slot.column)}" is outside the supported range.`,
                        severity: 'error',
                    });
                    return;
                }

                if (occupiedColumns.has(resolvedColumn)) {
                    issues.push({
                        code: 'duplicate_header_widget_column',
                        path: `dashboard.headerConfig.widgetSlots[${slot.widgetId}].column`,
                        message: `Header column "${resolvedColumn}" is assigned more than once.`,
                        severity: 'error',
                    });
                    return;
                }

                occupiedColumns.add(resolvedColumn);
            });
        });

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

        try {
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
        } catch (error) {
            await this.rollbackCreatedCatalogVariables(createdCatalogVariables);
            throw error;
        }

        return { catalogVariableIdMap, createdCatalogVariables };
    }

    private async rollbackCreatedCatalogVariables(createdCatalogVariables: CatalogVariable[]): Promise<void> {
        await Promise.allSettled(
            createdCatalogVariables.map((variable) => variableCatalogStorage.delete(variable.id)),
        );
    }
}

function sanitizeExportHeaderConfig(dashboard: Dashboard): {
    headerConfig: Dashboard['headerConfig'];
    issues: DashboardPortabilityIssue[];
} {
    const headerConfig = clone(dashboard.headerConfig);

    if (!headerConfig?.widgetSlots) {
        return {
            headerConfig,
            issues: [],
        };
    }

    const availableWidgetIds = new Set(
        normalizeDashboardViews(dashboard).views.flatMap((view) => view.widgets.map((widget) => widget.id)),
    );
    const issues: DashboardPortabilityIssue[] = [];

    headerConfig.widgetSlots = headerConfig.widgetSlots.filter((slot) => {
        if (availableWidgetIds.has(slot.widgetId)) {
            return true;
        }

        issues.push({
            code: 'orphaned_header_widget_slot_omitted',
            path: `dashboard.headerConfig.widgetSlots[${slot.widgetId}]`,
            message: `Header slot references stale widget "${slot.widgetId}" and was omitted from the exported portable dashboard.`,
            severity: 'warning',
        });

        return false;
    });

    return {
        headerConfig,
        issues,
    };
}

function normalizePortableDashboard(portableFile: PortableDashboardFile): NormalizedPortableDashboard {
    if (portableFile.schemaVersion === 2) {
        return materializeDashboardView({
            id: portableFile.dashboard.id,
            name: portableFile.dashboard.name,
            description: portableFile.dashboard.description,
            dashboardType: portableFile.dashboard.dashboardType,
            aspect: portableFile.dashboard.aspect,
            cols: portableFile.dashboard.cols,
            rows: portableFile.dashboard.rows,
            views: clone(portableFile.dashboard.views ?? []),
            activeViewId: portableFile.dashboard.activeViewId,
            headerConfig: clone(portableFile.dashboard.headerConfig),
            isTemplate: false,
            version: 1,
            status: 'draft',
            widgets: [],
            layout: [],
        }, portableFile.dashboard.activeViewId) as NormalizedPortableDashboard;
    }

    return materializeDashboardView({
        id: portableFile.dashboard.id,
        name: portableFile.dashboard.name,
        description: portableFile.dashboard.description,
        dashboardType: portableFile.dashboard.dashboardType,
        aspect: portableFile.dashboard.aspect,
        cols: portableFile.dashboard.cols,
        rows: portableFile.dashboard.rows,
        views: [{
            id: DEFAULT_DASHBOARD_VIEW_ID,
            name: DEFAULT_DASHBOARD_VIEW_NAME,
            order: 0,
            widgets: clone(portableFile.dashboard.widgets),
            layout: clone(portableFile.dashboard.layout),
        } satisfies DashboardView],
        activeViewId: DEFAULT_DASHBOARD_VIEW_ID,
        headerConfig: clone(portableFile.dashboard.headerConfig),
        isTemplate: false,
        version: 1,
        status: 'draft',
        widgets: clone(portableFile.dashboard.widgets),
        layout: clone(portableFile.dashboard.layout),
    }) as NormalizedPortableDashboard;
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

export function buildPortableDashboardFileName(
    dashboardName: string,
    exportedAt: string | Date = new Date(),
): string {
    const exportedDate = exportedAt instanceof Date ? exportedAt : new Date(exportedAt);

    return `interfaz-laboratorio-dashboard-${slugifyFileSegment(dashboardName)}-${formatPortableTimestamp(exportedDate)}.json`;
}

export function sanitizePortableDashboardFileName(fileName: string): string {
    const normalizedBaseName = fileName
        .trim()
        .replace(/\.json$/i, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[.-]+|[.-]+$/g, '');

    return `${normalizedBaseName || 'dashboard'}.json`;
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

    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value)) as T;
}

export const dashboardPortabilityService = new DashboardPortabilityService();
