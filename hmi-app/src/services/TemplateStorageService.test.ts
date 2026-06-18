import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { templateStorage } from './TemplateStorageService';
import { DASHBOARDS_STORAGE_KEY, TEMPLATES_STORAGE_KEY } from '../utils/legacyStorageCleanup';
import { makeDashboard, makeLayout, makeWidget } from '../test/fixtures/dashboard.fixture';
import type { Template } from '../domain/admin.types';

describe('TemplateStorageService', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-16T15:30:00.000Z'));
        vi.spyOn(Date, 'now').mockReturnValue(2_345_678_901);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('seeds and reads templates from TEMPLATES_STORAGE_KEY', async () => {
        const templatesPromise = templateStorage.getTemplates();

        await vi.advanceTimersByTimeAsync(200);
        const templates = await templatesPromise;

        expect(templates.length).toBeGreaterThan(0);
        expect(localStorage.getItem(TEMPLATES_STORAGE_KEY)).not.toBeNull();
    });

    it('creates templates from dashboards preserving layoutPreset, aspect, cols, and rows', async () => {
        const dashboard = makeDashboard({
            id: 'dashboard-for-template',
            name: 'Origen',
            dashboardType: 'equipment',
            aspect: '4:3',
            cols: 18,
            rows: 10,
            widgets: [makeWidget({ id: 'widget-1', title: 'Velocidad' })],
            layout: [makeLayout({ widgetId: 'widget-1', x: 5, y: 6, w: 7, h: 8 })],
        });

        const templatePromise = templateStorage.createFromDashboard(dashboard, 'Template 4:3');

        await vi.advanceTimersByTimeAsync(500);
        const template = await templatePromise;

        expect(template.aspect).toBe('4:3');
        expect(template.cols).toBe(18);
        expect(template.rows).toBe(10);
        expect(template.layoutPreset).toEqual([
            expect.objectContaining({ widgetId: 'preset-0', x: 5, y: 6, w: 7, h: 8 }),
        ]);

        const persistedTemplates = JSON.parse(localStorage.getItem(TEMPLATES_STORAGE_KEY) ?? '[]');
        expect(persistedTemplates).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: template.id,
                    aspect: '4:3',
                    cols: 18,
                    rows: 10,
                    layoutPreset: [expect.objectContaining({ x: 5, y: 6, w: 7, h: 8 })],
                }),
            ]),
        );
    });

    it('copies optional widget properties when creating a template from a dashboard', async () => {
        const dashboard = makeDashboard({
            id: 'dashboard-with-widget-options',
            dashboardType: 'equipment',
            widgets: [makeWidget({
                id: 'widget-with-options',
                binding: { mode: 'real_variable', variableKey: 'speed', unit: 'rpm' },
                thresholds: [{ value: 10, severity: 'warning' }],
                styleVariant: 'accent',
                displayOptions: { subtitle: 'Motor speed' },
            })],
            layout: [makeLayout({ widgetId: 'widget-with-options' })],
        });

        const templatePromise = templateStorage.createFromDashboard(dashboard, 'Configured template');

        await vi.advanceTimersByTimeAsync(500);
        const template = await templatePromise;

        expect(template.widgetPresets).toEqual([
            expect.objectContaining({
                binding: { mode: 'real_variable', variableKey: 'speed', unit: 'rpm' },
                thresholds: [{ value: 10, severity: 'warning' }],
                styleVariant: 'accent',
                displayOptions: { subtitle: 'Motor speed' },
            }),
        ]);
    });

    it('returns aspect, cols, and rows from stored templates on read paths', async () => {
        const storedTemplate: Template = {
            id: 'stored-template',
            name: 'Stored template',
            type: 'dashboard',
            dashboardType: 'free',
            aspect: '21:9',
            cols: 28,
            rows: 16,
            status: 'active',
            widgetPresets: [makeWidget({ title: 'Stored widget' })],
            layoutPreset: [makeLayout({ widgetId: 'preset-0', x: 1, y: 2, w: 3, h: 4 })],
        };

        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify([storedTemplate]));

        const template = await templateStorage.getTemplate('stored-template');

        expect(template).toEqual(expect.objectContaining({ aspect: '21:9', cols: 28, rows: 16 }));
        expect(template?.layoutPreset).toEqual([
            expect.objectContaining({ x: 1, y: 2, w: 3, h: 4 }),
        ]);
    });

    it('returns null when a template record is missing', async () => {
        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify([]));

        await expect(templateStorage.getTemplate('missing-template')).resolves.toBeNull();
    });

    it('rejects read operations when template storage contains malformed JSON', async () => {
        localStorage.setItem(TEMPLATES_STORAGE_KEY, '{not-valid-json');

        await expect(templateStorage.getTemplate('any-template')).rejects.toThrow(SyntaxError);
    });

    it('hydrates missing dashboardType from the source dashboard and persists the migration', async () => {
        const sourceDashboard = makeDashboard({
            id: 'source-dashboard',
            dashboardType: 'line',
        });

        const storedTemplate: Template = {
            id: 'template-with-source-dashboard',
            name: 'Source-based template',
            type: 'dashboard',
            aspect: '16:9',
            cols: 12,
            rows: 8,
            sourceDashboardId: sourceDashboard.id,
            status: 'active',
            widgetPresets: [],
            layoutPreset: [],
        };

        localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify([sourceDashboard]));
        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify([storedTemplate]));

        const templatePromise = templateStorage.getTemplate(storedTemplate.id);

        await vi.advanceTimersByTimeAsync(200);
        const template = await templatePromise;

        expect(template).toEqual(expect.objectContaining({ dashboardType: 'line' }));
        expect(JSON.parse(localStorage.getItem(TEMPLATES_STORAGE_KEY) ?? '[]')).toEqual([
            expect.objectContaining({ id: storedTemplate.id, dashboardType: 'line' }),
        ]);
    });

    it('falls back to the mock template dashboardType when storage lacks it', async () => {
        const storedTemplate: Template = {
            id: 'tpl-comprimidora-std',
            name: 'Comprimidora Estándar',
            type: 'dashboard',
            aspect: '16:9',
            cols: 40,
            rows: 24,
            status: 'active',
            widgetPresets: [],
            layoutPreset: [],
        };

        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify([storedTemplate]));

        const template = await templateStorage.getTemplate(storedTemplate.id);

        expect(template).toEqual(expect.objectContaining({ dashboardType: 'equipment' }));
        expect(JSON.parse(localStorage.getItem(TEMPLATES_STORAGE_KEY) ?? '[]')).toEqual([
            expect.objectContaining({ id: storedTemplate.id, dashboardType: 'equipment' }),
        ]);
    });

    it('leaves templates unchanged when no dashboardType can be inferred', async () => {
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
        const storedTemplate: Template = {
            id: 'template-without-dashboard-type',
            name: 'Unknown type template',
            type: 'dashboard',
            aspect: '4:3',
            cols: 10,
            rows: 6,
            status: 'active',
            widgetPresets: [],
            layoutPreset: [],
        };

        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify([storedTemplate]));
        setItemSpy.mockClear();

        const template = await templateStorage.getTemplate(storedTemplate.id);

        expect(template).toEqual(storedTemplate);
        expect(setItemSpy).not.toHaveBeenCalled();
    });

    it('updates an existing template instead of appending a duplicate record', async () => {
        const originalTemplate: Template = {
            id: 'template-to-update',
            name: 'Original name',
            type: 'dashboard',
            aspect: '16:9',
            cols: 16,
            rows: 9,
            dashboardType: 'global',
            status: 'active',
            widgetPresets: [],
            layoutPreset: [],
        };

        const updatedTemplate: Template = {
            ...originalTemplate,
            name: 'Updated name',
            dashboardType: 'area',
        };

        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify([originalTemplate]));

        const savePromise = templateStorage.saveTemplate(updatedTemplate);

        await vi.advanceTimersByTimeAsync(300);
        await savePromise;

        expect(JSON.parse(localStorage.getItem(TEMPLATES_STORAGE_KEY) ?? '[]')).toEqual([updatedTemplate]);
    });

    it('appends a new template when saving a record with a new id', async () => {
        const existingTemplate: Template = {
            id: 'existing-template',
            name: 'Existing template',
            type: 'dashboard',
            aspect: '16:9',
            cols: 16,
            rows: 9,
            status: 'active',
            widgetPresets: [],
            layoutPreset: [],
        };

        const newTemplate: Template = {
            ...existingTemplate,
            id: 'new-template',
            name: 'New template',
        };

        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify([existingTemplate]));

        const savePromise = templateStorage.saveTemplate(newTemplate);

        await vi.advanceTimersByTimeAsync(300);
        await savePromise;

        expect(JSON.parse(localStorage.getItem(TEMPLATES_STORAGE_KEY) ?? '[]')).toEqual([
            existingTemplate,
            newTemplate,
        ]);
    });

    it('deletes matching templates and preserves non-matching records', async () => {
        const retainedTemplate: Template = {
            id: 'template-to-keep',
            name: 'Keep me',
            type: 'dashboard',
            aspect: '16:9',
            cols: 20,
            rows: 12,
            status: 'active',
            widgetPresets: [],
            layoutPreset: [],
        };

        const removedTemplate: Template = {
            ...retainedTemplate,
            id: 'template-to-delete',
            name: 'Delete me',
        };

        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify([retainedTemplate, removedTemplate]));

        await templateStorage.deleteTemplate(removedTemplate.id);

        expect(JSON.parse(localStorage.getItem(TEMPLATES_STORAGE_KEY) ?? '[]')).toEqual([retainedTemplate]);
    });
});
