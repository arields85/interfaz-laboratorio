import type { Dashboard, Template, WidgetConfig, WidgetLayout } from '../domain/admin.types';
import { mockTemplates } from '../mocks/template.mock';
import { TEMPLATES_STORAGE_KEY } from '../utils/legacyStorageCleanup';
import type { ConfigStoragePort } from '../domain/sharedConfig.types';
import { sharedConfigStorage } from './sharedConfigStorage.service';
import { dashboardStorage } from './DashboardStorageService';

// =============================================================================
// TemplateStorageService
// Persistencia asíncrona de templates sobre la configuración compartida del
// servidor (sharedConfigStorage). Una lectura nunca escribe: sin datos devuelve
// una colección vacía (instalación nueva sin datos de ejemplo). mockTemplates se conserva solo para inferir el
// dashboardType de templates guardados por instalaciones existentes que aún no
// lo tengan persistido.
//
// Patrón análogo a DashboardStorageService / HierarchyStorageService.
// Especificación Funcional Modo Admin §13
// =============================================================================

export class TemplateStorageService {
    private readonly storage: ConfigStoragePort;
    private readonly dashboards: Pick<typeof dashboardStorage, 'getDashboard'>;

    constructor(
        storage: ConfigStoragePort = sharedConfigStorage,
        dashboards: Pick<typeof dashboardStorage, 'getDashboard'> = dashboardStorage,
    ) {
        this.storage = storage;
        this.dashboards = dashboards;
    }

    private getMockDashboardType(template: Template) {
        return mockTemplates.find((mockTemplate) => mockTemplate.id === template.id)?.dashboardType;
    }

    private async ensureDashboardType(templates: Template[]): Promise<Template[]> {
        const migratedTemplates = await Promise.all(
            templates.map(async (template) => {
                if (template.dashboardType) {
                    return template;
                }

                let inferredDashboardType: Template['dashboardType'];

                if (template.sourceDashboardId) {
                    const sourceDashboard = await this.dashboards.getDashboard(template.sourceDashboardId);
                    inferredDashboardType = sourceDashboard?.dashboardType;
                }

                if (!inferredDashboardType) {
                    inferredDashboardType = this.getMockDashboardType(template);
                }

                if (!inferredDashboardType) {
                    return template;
                }

                return {
                    ...template,
                    dashboardType: inferredDashboardType,
                };
            }),
        );

        // Pure read: the inferred type is persisted by the next real save, never by a read.
        return migratedTemplates;
    }

    private async readStorage(): Promise<Template[]> {
        const stored = this.storage.getItem(TEMPLATES_STORAGE_KEY);
        const templates: Template[] = stored ? JSON.parse(stored) : [];
        return this.ensureDashboardType(templates);
    }

    /** Retorna todos los templates */
    async getTemplates(): Promise<Template[]> {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return this.readStorage();
    }

    /** Retorna un template por ID */
    async getTemplate(id: string): Promise<Template | null> {
        const templates = await this.readStorage();
        return templates.find((template) => template.id === id) || null;
    }

    /** Guarda o actualiza un template */
    async saveTemplate(template: Template): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const templates = await this.readStorage();
        const idx = templates.findIndex((storedTemplate) => storedTemplate.id === template.id);

        if (idx >= 0) {
            templates[idx] = template;
        } else {
            templates.push(template);
        }

        this.storage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
    }

    /** Elimina un template por ID */
    async deleteTemplate(id: string): Promise<void> {
        const templates = await this.readStorage();
        const filtered = templates.filter((template) => template.id !== id);
        this.storage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(filtered));
    }

    /**
     * Crea un template a partir de un dashboard existente.
     * Extrae la estructura visual (widgets + layout) como presets genéricos.
     */
    async createFromDashboard(dashboard: Dashboard, templateName: string): Promise<Template> {
        const template: Template = {
            id: `tpl-${Date.now().toString(36)}`,
            name: templateName,
            type: 'dashboard',
            aspect: dashboard.aspect,
            cols: dashboard.cols,
            rows: dashboard.rows,
            dashboardType: dashboard.dashboardType,
            sourceDashboardId: dashboard.id,
            status: 'active',
            widgetPresets: dashboard.widgets.map((widget) => ({
                type: widget.type,
                title: widget.title,
                size: { ...widget.size },
                binding: widget.binding ? { ...widget.binding } : undefined,
                thresholds: widget.thresholds ? [...widget.thresholds] : undefined,
                styleVariant: widget.styleVariant,
                displayOptions: widget.displayOptions ? { ...widget.displayOptions } : undefined,
            } as Partial<WidgetConfig>)),
            layoutPreset: dashboard.layout.map((layout, index) => ({
                widgetId: `preset-${index}`,
                x: layout.x,
                y: layout.y,
                w: layout.w,
                h: layout.h,
            } as WidgetLayout)),
        };

        await this.saveTemplate(template);
        return template;
    }
}

export const templateStorage = new TemplateStorageService();
