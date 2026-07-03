import type { ActivityAnalyticsPersistedDisplayPatch, ActivityAnalyticsWidgetConfig, Dashboard, Template, ViewerPersistedWidgetDisplayPatch, WidgetConfig, WidgetLayout } from '../domain/admin.types';
import { mockDashboards } from '../mocks/admin.mock';
import { clampWidgetBounds, DEFAULT_COLS, isTemplateApplicable } from '../utils/gridConfig';
import { DASHBOARDS_STORAGE_KEY } from '../utils/legacyStorageCleanup';
import { TemplateAspectMismatchError } from '../utils/templateAspectMismatch';

const DEFAULT_DASHBOARD_ASPECT = '16:9' as const;
const DEFAULT_DASHBOARD_ROWS = 24;

// =============================================================================
// DashboardStorageService
// Servicio de persistencia para el Modo Administrador. Simula una BD asíncrona
// usando localStorage. Auto-puebla (seed) con datos estáticos si está vacío.
// =============================================================================

class DashboardStorageService {
    // Inicializa el Storage copiando los Mocks si es la primera vez.
    // Si ya existen datos, corrige dashboards publicados sin snapshot o sin
    // aspect/rows persistidos para mantener compatibilidad interna.
    private async initStorage(): Promise<void> {
        const stored = localStorage.getItem(DASHBOARDS_STORAGE_KEY);
        if (!stored) {
            localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify(mockDashboards));
            return;
        }

        const dashboards: Dashboard[] = JSON.parse(stored);
        let migrated = false;

        for (const dashboard of dashboards) {
            if (!dashboard.aspect) {
                dashboard.aspect = DEFAULT_DASHBOARD_ASPECT;
                migrated = true;
            }

            if (!dashboard.rows) {
                dashboard.rows = DEFAULT_DASHBOARD_ROWS;
                migrated = true;
            }

            if (!dashboard.cols) {
                dashboard.cols = DEFAULT_COLS;
                migrated = true;
            }

            if (dashboard.status === 'published' && !dashboard.ownerNodeId) {
                dashboard.status = 'draft';
                dashboard.publishedSnapshot = undefined;
                migrated = true;
            }

            if (dashboard.status === 'published' && dashboard.ownerNodeId && !dashboard.publishedSnapshot) {
                dashboard.publishedSnapshot = {
                    aspect: dashboard.aspect,
                    cols: dashboard.cols,
                    rows: dashboard.rows,
                    widgets: JSON.parse(JSON.stringify(dashboard.widgets)),
                    layout: JSON.parse(JSON.stringify(dashboard.layout)),
                    headerConfig: dashboard.headerConfig
                        ? JSON.parse(JSON.stringify(dashboard.headerConfig))
                        : undefined,
                    publishedAt: dashboard.lastUpdateAt ?? new Date().toISOString(),
                };
                migrated = true;
                continue;
            }

            if (dashboard.publishedSnapshot) {
                if (!dashboard.publishedSnapshot.aspect) {
                    dashboard.publishedSnapshot.aspect = dashboard.aspect;
                    migrated = true;
                }

                if (!dashboard.publishedSnapshot.rows) {
                    dashboard.publishedSnapshot.rows = dashboard.rows;
                    migrated = true;
                }

                if (!dashboard.publishedSnapshot.cols) {
                    dashboard.publishedSnapshot.cols = dashboard.cols;
                    migrated = true;
                }
            }
        }

        if (migrated) {
            localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify(dashboards));
        }
    }

    private async readStorage(): Promise<Dashboard[]> {
        await this.initStorage();
        const stored = localStorage.getItem(DASHBOARDS_STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    }

    async getDashboards(): Promise<Dashboard[]> {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return this.readStorage();
    }

    async getDashboard(id: string): Promise<Dashboard | null> {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const dashboards = await this.readStorage();
        return dashboards.find((dashboard) => dashboard.id === id) || null;
    }

    async saveDashboard(dashboard: Dashboard): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const dashboards = await this.readStorage();

        dashboard.lastUpdateAt = new Date().toISOString();

        const existingIndex = dashboards.findIndex((storedDashboard) => storedDashboard.id === dashboard.id);
        if (existingIndex >= 0) {
            dashboards[existingIndex] = dashboard;
        } else {
            dashboards.push(dashboard);
        }

        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify(dashboards));
    }

    async persistPublishedWidgetDisplayOptions(dashboardId: string, widgetId: string, displayOptions: ViewerPersistedWidgetDisplayPatch): Promise<Dashboard | null> {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const dashboards = await this.readStorage();
        const dashboard = dashboards.find((currentDashboard) => currentDashboard.id === dashboardId) ?? null;

        if (!dashboard) {
            return null;
        }

        dashboard.widgets = dashboard.widgets.map((widget) => (
            widget.id === widgetId
                ? applyPersistedActivityAnalyticsDisplayPatch(widget, displayOptions)
                : widget
        ));

        if (dashboard.publishedSnapshot) {
            dashboard.publishedSnapshot.widgets = dashboard.publishedSnapshot.widgets.map((widget) => (
                widget.id === widgetId
                    ? applyPersistedActivityAnalyticsDisplayPatch(widget, displayOptions)
                    : widget
            ));
        }

        dashboard.lastUpdateAt = new Date().toISOString();
        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify(dashboards));
        return dashboard;
    }

    async createEmptyDashboard(name: string): Promise<Dashboard> {
        const newDashboard: Dashboard = {
            id: `dash-${Date.now().toString(36)}`,
            name,
            status: 'draft',
            dashboardType: 'global',
            aspect: DEFAULT_DASHBOARD_ASPECT,
            cols: DEFAULT_COLS,
            rows: DEFAULT_DASHBOARD_ROWS,
            isTemplate: false,
            version: 1,
            layout: [],
            widgets: [],
            lastUpdateAt: new Date().toISOString(),
        };
        await this.saveDashboard(newDashboard);
        return newDashboard;
    }

    private materializeTemplate(template: Template, cols: number, rows: number) {
        const idSuffix = Date.now().toString(36);
        const presets = template.widgetPresets || [];
        const layoutPreset = template.layoutPreset || [];

        const widgets: WidgetConfig[] = presets.map((preset, index) => ({
            id: `w-tpl-${idSuffix}-${index}`,
            type: preset.type || 'kpi',
            title: preset.title,
            position: { x: 0, y: 0 },
            size: preset.size || { w: 1, h: 1 },
            binding: preset.binding,
            thresholds: preset.thresholds,
            styleVariant: preset.styleVariant,
            displayOptions: preset.displayOptions,
        }) as WidgetConfig);

        const layout: WidgetLayout[] = layoutPreset.map((storedLayout, index) => ({
            widgetId: widgets[index]?.id || `w-tpl-${idSuffix}-${index}`,
            ...clampWidgetBounds({
                x: storedLayout.x,
                y: storedLayout.y,
                w: storedLayout.w,
                h: storedLayout.h,
            }, cols, rows),
        }));

        return { widgets, layout };
    }

    async deleteDashboard(id: string): Promise<void> {
        const dashboards = await this.readStorage();
        const filtered = dashboards.filter((dashboard) => dashboard.id !== id);
        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify(filtered));
    }

    applyTemplate(dashboard: Dashboard, template: Template): Dashboard {
        if (!isTemplateApplicable(template, dashboard)) {
            throw new TemplateAspectMismatchError({
                templateAspect: template.aspect,
                dashboardAspect: dashboard.aspect,
            });
        }

        const { widgets, layout } = this.materializeTemplate(template, dashboard.cols, dashboard.rows);

        return {
            ...dashboard,
            widgets,
            layout,
            headerConfig: dashboard.headerConfig
                ? {
                    ...dashboard.headerConfig,
                    widgetSlots: [],
                }
                : undefined,
        };
    }

    async reorderDashboards(orderedIds: string[]): Promise<Dashboard[]> {
        const dashboards = await this.readStorage();
        const dashboardById = new Map(dashboards.map((dashboard) => [dashboard.id, dashboard]));

        const reordered = orderedIds
            .map((id) => dashboardById.get(id))
            .filter((dashboard): dashboard is Dashboard => Boolean(dashboard));

        const missingDashboards = dashboards.filter((dashboard) => !orderedIds.includes(dashboard.id));
        const nextDashboards = [...reordered, ...missingDashboards];

        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify(nextDashboards));
        return nextDashboards;
    }

    /**
     * Duplica un dashboard existente con IDs frescos.
     * Conserva widgets, layout y bindings; resetea status/version.
     */
    async duplicateDashboard(id: string, newName?: string): Promise<Dashboard | null> {
        const original = await this.getDashboard(id);
        if (!original) return null;

        const idSuffix = Date.now().toString(36);
        const idMap = new Map<string, string>();

        const newWidgets: WidgetConfig[] = original.widgets.map((widget) => {
            const newId = `${widget.id}-dup-${idSuffix}`;
            idMap.set(widget.id, newId);
            return { ...widget, id: newId };
        });

        const newLayout: WidgetLayout[] = original.layout.map((layout) => ({
            ...layout,
            widgetId: idMap.get(layout.widgetId) || layout.widgetId,
        }));

        const resolvedName = newName || `${original.name} (Copia)`;

        const duplicate: Dashboard = {
            ...original,
            id: `dash-${idSuffix}`,
            name: resolvedName,
            status: 'draft',
            version: 1,
            isTemplate: false,
            ownerNodeId: undefined,
            widgets: newWidgets,
            layout: newLayout,
            headerConfig: {
                ...original.headerConfig,
                title: resolvedName,
            },
            lastUpdateAt: new Date().toISOString(),
        };

        await this.saveDashboard(duplicate);
        return duplicate;
    }

    /**
     * Crea un dashboard a partir de un template.
     * Genera IDs únicos para cada widget y reasigna layout.
     */
    async createFromTemplate(template: Template, name: string): Promise<Dashboard> {
        const idSuffix = Date.now().toString(36);
        const { widgets, layout } = this.materializeTemplate(template, template.cols, template.rows);

        const dashboard: Dashboard = {
            id: `dash-${idSuffix}`,
            name,
            description: `Creado desde template: ${template.name}`,
            dashboardType: template.dashboardType ?? 'equipment',
            aspect: template.aspect,
            cols: template.cols,
            rows: template.rows,
            status: 'draft',
            isTemplate: false,
            version: 1,
            templateId: template.id,
            widgets,
            layout,
            lastUpdateAt: new Date().toISOString(),
        };

        await this.saveDashboard(dashboard);
        return dashboard;
    }

    /**
     * Marca un dashboard como 'published' e incrementa su versión.
     * Congela la working copy actual como `publishedSnapshot` para que el viewer
     * siempre lea de ahí. Esto lo hace visible para el Visor público.
     */
    async publishDashboard(id: string): Promise<Dashboard | null> {
        const dashboard = await this.getDashboard(id);
        if (!dashboard) return null;

        dashboard.status = 'published';
        dashboard.version = (dashboard.version || 1) + 1;
        dashboard.publishedSnapshot = {
            aspect: dashboard.aspect,
            cols: dashboard.cols,
            rows: dashboard.rows,
            widgets: JSON.parse(JSON.stringify(dashboard.widgets)),
            layout: JSON.parse(JSON.stringify(dashboard.layout)),
            headerConfig: dashboard.headerConfig
                ? JSON.parse(JSON.stringify(dashboard.headerConfig))
                : undefined,
            publishedAt: new Date().toISOString(),
        };

        await this.saveDashboard(dashboard);
        return dashboard;
    }

    /**
     * Descarta los cambios pendientes de un dashboard publicado,
     * restaurando widgets/layout/headerConfig desde el publishedSnapshot.
     * No-op si el dashboard no tiene snapshot.
     */
    async discardChanges(id: string): Promise<Dashboard | null> {
        const dashboard = await this.getDashboard(id);
        if (!dashboard?.publishedSnapshot) return dashboard ?? null;

        dashboard.aspect = dashboard.publishedSnapshot.aspect;
        dashboard.cols = dashboard.publishedSnapshot.cols;
        dashboard.rows = dashboard.publishedSnapshot.rows;
        dashboard.widgets = JSON.parse(JSON.stringify(dashboard.publishedSnapshot.widgets));
        dashboard.layout = JSON.parse(JSON.stringify(dashboard.publishedSnapshot.layout));
        dashboard.headerConfig = dashboard.publishedSnapshot.headerConfig
            ? JSON.parse(JSON.stringify(dashboard.publishedSnapshot.headerConfig))
            : undefined;
        dashboard.lastUpdateAt = new Date().toISOString();

        await this.saveDashboard(dashboard);
        return dashboard;
    }
}

function applyPersistedActivityAnalyticsDisplayPatch(widget: WidgetConfig, displayOptions: ViewerPersistedWidgetDisplayPatch): WidgetConfig {
    if (widget.type !== 'activity-analytics') {
        return { ...widget, displayOptions: { ...widget.displayOptions, ...displayOptions } } as WidgetConfig;
    }

    const activityWidget = widget as ActivityAnalyticsWidgetConfig;
    const activityDisplayOptions = displayOptions as ActivityAnalyticsPersistedDisplayPatch;

    return {
        ...activityWidget,
        displayOptions: {
            ...activityWidget.displayOptions,
            range: activityDisplayOptions.range,
            start: activityDisplayOptions.range === 'custom' ? activityDisplayOptions.start : undefined,
            end: activityDisplayOptions.range === 'custom' ? activityDisplayOptions.end : undefined,
        },
    } satisfies ActivityAnalyticsWidgetConfig;
}

export const dashboardStorage = new DashboardStorageService();
