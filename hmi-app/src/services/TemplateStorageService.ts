import type { Dashboard, Template, WidgetConfig, WidgetLayout } from '../domain/admin.types';
import { mockTemplates } from '../mocks/template.mock';
import { TEMPLATES_STORAGE_KEY } from '../utils/legacyStorageCleanup';
import { dashboardStorage } from './DashboardStorageService';

// =============================================================================
// TemplateStorageService
// Persistencia asíncrona de templates usando localStorage.
// Auto-inicializa con una colección vacía si el storage está vacío (instalación
// nueva sin datos de ejemplo). mockTemplates se conserva solo para inferir el
// dashboardType de templates guardados por instalaciones existentes que aún no
// lo tengan persistido.
//
// Patrón análogo a DashboardStorageService / HierarchyStorageService.
// Especificación Funcional Modo Admin §13
// =============================================================================

class TemplateStorageService {
    private getMockDashboardType(template: Template) {
        return mockTemplates.find((mockTemplate) => mockTemplate.id === template.id)?.dashboardType;
    }

    private async ensureDashboardType(templates: Template[]): Promise<Template[]> {
        let didChange = false;

        const migratedTemplates = await Promise.all(
            templates.map(async (template) => {
                if (template.dashboardType) {
                    return template;
                }

                let inferredDashboardType: Template['dashboardType'];

                if (template.sourceDashboardId) {
                    const sourceDashboard = await dashboardStorage.getDashboard(template.sourceDashboardId);
                    inferredDashboardType = sourceDashboard?.dashboardType;
                }

                if (!inferredDashboardType) {
                    inferredDashboardType = this.getMockDashboardType(template);
                }

                if (!inferredDashboardType) {
                    return template;
                }

                didChange = true;
                return {
                    ...template,
                    dashboardType: inferredDashboardType,
                };
            }),
        );

        if (didChange) {
            localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(migratedTemplates));
        }

        return migratedTemplates;
    }

    private async initStorage(): Promise<void> {
        const stored = localStorage.getItem(TEMPLATES_STORAGE_KEY);
        if (!stored) {
            localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify([]));
        }
    }

    private async readStorage(): Promise<Template[]> {
        await this.initStorage();
        const stored = localStorage.getItem(TEMPLATES_STORAGE_KEY);
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

        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
    }

    /** Elimina un template por ID */
    async deleteTemplate(id: string): Promise<void> {
        const templates = await this.readStorage();
        const filtered = templates.filter((template) => template.id !== id);
        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(filtered));
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
