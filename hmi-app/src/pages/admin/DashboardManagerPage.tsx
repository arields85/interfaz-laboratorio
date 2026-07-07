import { useState, useEffect, useMemo, useRef, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    LayoutTemplate, FileEdit, Copy, Trash2, Plus, Edit2, Check,
    GripVertical, Loader2, Search, SearchX, LayoutDashboard,
    Bookmark, Download, Upload
} from 'lucide-react';
import { dashboardStorage } from '../../services/DashboardStorageService';
import type {
    DashboardImportResult,
    DashboardPortabilityIssue,
} from '../../services/dashboardPortabilityService';
import {
    buildPortableDashboardFileName,
    dashboardPortabilityService,
    sanitizePortableDashboardFileName,
} from '../../services/dashboardPortabilityService';
import { templateStorage } from '../../services/TemplateStorageService';
import { hierarchyStorage } from '../../services/HierarchyStorageService';
import type { Dashboard, HierarchyNode, Template } from '../../domain/admin.types';
import { getDashboardVisualStatus } from '../../domain/admin.types';
import { getDashboardHeaderSubtitle, getDashboardHeaderTitle } from '../../utils/dashboardHeader';
import { getDefaultDashboardView } from '../../utils/dashboardViews';
import AdminWorkspaceLayout from '../../components/admin/AdminWorkspaceLayout';
import { loadNodeTypeLabels, resolveTypeLabel } from '../../utils/nodeTypeLabels';
import {
    ADMIN_CONTEXT_BAR_LABEL_CLS,
    ADMIN_SIDEBAR_INPUT_CLS,
    ADMIN_SIDEBAR_PANEL_CLS,
} from '../../components/admin/adminSidebarStyles';
import AdminEmptyState from '../../components/admin/AdminEmptyState';
import AdminDialog from '../../components/admin/AdminDialog';
import AdminDestructiveDialog from '../../components/admin/AdminDestructiveDialog';
import AdminActionButton from '../../components/admin/AdminActionButton';
import AdminTag from '../../components/admin/AdminTag';
import HoverTooltip from '../../components/ui/HoverTooltip';

function getVisibleDashboardSubtitle(dashboard: Dashboard, activeTemplateIds: Set<string>) {
    const subtitle = getDashboardHeaderSubtitle(dashboard);

    if (!subtitle) {
        return undefined;
    }

    const templateDerivedPrefix = 'Creado desde template:';

    if (subtitle.startsWith(templateDerivedPrefix)) {
        const templateName = subtitle.slice(templateDerivedPrefix.length).trim();

        if (!dashboard.templateId || activeTemplateIds.has(dashboard.templateId)) {
            return templateName || undefined;
        }
    }

    if (
        dashboard.templateId
        && !activeTemplateIds.has(dashboard.templateId)
        && subtitle.startsWith(templateDerivedPrefix)
    ) {
        return undefined;
    }

    return subtitle;
}

function getSuggestedTemplateName(dashboard: Dashboard) {
    const baseName = getDashboardHeaderTitle(dashboard).replace(/\s+—\s+Nuevo$/, '').trim();
    return `${baseName} (Template)`;
}

function getSuggestedDuplicateName(dashboard: Dashboard) {
    return `${getDashboardHeaderTitle(dashboard)} (copia)`;
}

function getDashboardTypeLabel(
    dashboardType: string,
    ownerNodeId: string | undefined,
    nodeMap: Map<string, HierarchyNode>,
) {
    const ownerNode = ownerNodeId ? nodeMap.get(ownerNodeId) : undefined;
    if (ownerNode) return resolveTypeLabel(ownerNode.type);
    if (!ownerNodeId) return '—';
    return resolveTypeLabel(dashboardType);
}

function getTemplateTypeLabel(dashboardType: string | undefined) {
    return resolveTypeLabel(dashboardType);
}

function getWidgetCountLabel(widgetCount: number) {
    return `${widgetCount} ${widgetCount === 1 ? 'widget' : 'widgets'}`;
}

interface DashboardManagerData {
    dashboards: Dashboard[];
    templates: Template[];
    nodeMap: Map<string, HierarchyNode>;
}

interface DashboardPortabilityFeedback {
    kind: 'success' | 'error';
    title: string;
    dashboardName?: string;
    createdCatalogVariableCount: number;
    issues: DashboardPortabilityIssue[];
}

async function loadDashboardManagerData(): Promise<DashboardManagerData> {
    const [dashboards, templates, hierarchyNodes] = await Promise.all([
        dashboardStorage.getDashboards(),
        templateStorage.getTemplates(),
        hierarchyStorage.getNodes(),
    ]);

    return {
        dashboards,
        templates,
        nodeMap: new Map(hierarchyNodes.map((node) => [node.id, node])),
    };
}

function extractPortabilityIssues(error: unknown): DashboardPortabilityIssue[] {
    if (
        error
        && typeof error === 'object'
        && 'issues' in error
        && Array.isArray(error.issues)
    ) {
        return error.issues as DashboardPortabilityIssue[];
    }

    return [{
        code: 'portable_dashboard_operation_failed',
        path: '$',
        message: 'No pudimos completar la operación portable del dashboard. Volvé a intentarlo.',
        severity: 'error',
    }];
}

function buildImportSuccessSummary(createdCatalogVariableCount: number) {
    if (createdCatalogVariableCount === 0) {
        return 'No hizo falta crear variables nuevas; las coincidencias locales se reutilizaron sin sobrescribir.';
    }

    return createdCatalogVariableCount === 1
        ? 'Se creó 1 variable nueva; las coincidencias locales existentes se reutilizaron sin sobrescribir.'
        : `Se crearon ${createdCatalogVariableCount} variables nuevas; las coincidencias locales existentes se reutilizaron sin sobrescribir.`;
}

function createImportSuccessFeedback(result: DashboardImportResult): DashboardPortabilityFeedback {
    return {
        kind: 'success',
        title: 'Importación completada',
        dashboardName: result.dashboard.name,
        createdCatalogVariableCount: result.createdCatalogVariables.length,
        issues: result.issues,
    };
}

async function triggerDashboardDownload(dashboard: Dashboard, fileNameOverride?: string) {
    const exportResult = await dashboardPortabilityService.exportDashboard(dashboard);
    const downloadUrl = URL.createObjectURL(new Blob([exportResult.json], { type: 'application/json' }));

    try {
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = sanitizePortableDashboardFileName(fileNameOverride ?? exportResult.fileName);
        link.click();
    } finally {
        URL.revokeObjectURL(downloadUrl);
    }
}

// =============================================================================
// DashboardManagerPage
// Gestor de dashboards y templates del Modo Administrador.
// Especificación Funcional Modo Admin §7 / §13
// =============================================================================

export default function DashboardManagerPage() {
    const DASHBOARD_LIST_GRID_CLS = 'grid-cols-[2rem_2fr_1fr_1fr_1fr_10rem]';
    const navigate = useNavigate();

    const [dashboards, setDashboards] = useState<Dashboard[]>([]);
    const [templates, setTemplates] = useState<Template[]>([]);
    const [nodeMap, setNodeMap] = useState<Map<string, HierarchyNode>>(new Map());
    const [isLoading, setIsLoading] = useState(true);
    const [showTemplatePrompt, setShowTemplatePrompt] = useState<string | null>(null);
    const [templateName, setTemplateName] = useState('');
    const [showDuplicatePrompt, setShowDuplicatePrompt] = useState<string | null>(null);
    const [duplicateName, setDuplicateName] = useState('');
    const [deleteDashboardId, setDeleteDashboardId] = useState<string | null>(null);
    const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null);
    const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
    const [editingTemplateName, setEditingTemplateName] = useState('');
    const [draggingDashboardId, setDraggingDashboardId] = useState<string | null>(null);
    const [dragOverDashboardId, setDragOverDashboardId] = useState<string | null>(null);
    const [dashboardSearch, setDashboardSearch] = useState('');
    const [isImporting, setIsImporting] = useState(false);
    const [exportingDashboardId, setExportingDashboardId] = useState<string | null>(null);
    const [exportDialogDashboardId, setExportDialogDashboardId] = useState<string | null>(null);
    const [exportFileName, setExportFileName] = useState('');
    const [portabilityFeedback, setPortabilityFeedback] = useState<DashboardPortabilityFeedback | null>(null);
    const [, setNodeTypeLabelsVersion] = useState(0);
    const importInputRef = useRef<HTMLInputElement | null>(null);

    const applyManagerData = ({ dashboards: nextDashboards, templates: nextTemplates, nodeMap: nextNodeMap }: DashboardManagerData) => {
        setDashboards(nextDashboards);
        setTemplates(nextTemplates);
        setNodeMap(nextNodeMap);
    };

    const refreshDashboardList = async () => {
        const nextDashboards = await dashboardStorage.getDashboards();
        setDashboards(nextDashboards);
    };

    useEffect(() => {
        void loadNodeTypeLabels().then(() => {
            setNodeTypeLabelsVersion((current) => current + 1);
        });
    }, []);

    useEffect(() => {
        const loadAll = async () => {
            setIsLoading(true);
            try {
                applyManagerData(await loadDashboardManagerData());
            } catch (error) {
                console.error("Error cargando datos:", error);
            } finally {
                setIsLoading(false);
            }
        };
        loadAll();
    }, []);

    const handleCreateNew = async () => {
        try {
            const newDash = await dashboardStorage.createEmptyDashboard('Nuevo Dashboard');
            navigate(`/admin/builder/${newDash.id}`);
        } catch (error) {
            console.error("Error creando dashboard:", error);
        }
    };

    const handleExportDashboard = async (dashboard: Dashboard, fileNameOverride?: string) => {
        setExportingDashboardId(dashboard.id);

        try {
            await triggerDashboardDownload(dashboard, fileNameOverride);
        } catch (error) {
            console.error('Error exportando dashboard:', error);
            setPortabilityFeedback({
                kind: 'error',
                title: 'No pudimos exportar el dashboard',
                dashboardName: dashboard.name,
                createdCatalogVariableCount: 0,
                issues: extractPortabilityIssues(error),
            });
        } finally {
            setExportingDashboardId(null);
        }
    };

    const handleOpenExportDialog = (dashboard: Dashboard) => {
        setExportDialogDashboardId(dashboard.id);
        setExportFileName(buildPortableDashboardFileName(getDashboardHeaderTitle(dashboard)));
    };

    const handleCloseExportDialog = () => {
        setExportDialogDashboardId(null);
        setExportFileName('');
    };

    const handleConfirmExportDashboard = async () => {
        if (!exportDialogDashboardId || !exportFileName.trim()) {
            return;
        }

        const dashboard = dashboards.find((item) => item.id === exportDialogDashboardId);

        if (!dashboard) {
            handleCloseExportDialog();
            return;
        }

        const nextFileName = exportFileName.trim();
        handleCloseExportDialog();
        await handleExportDashboard(dashboard, nextFileName);
    };

    const handleOpenImportPicker = () => {
        importInputRef.current?.click();
    };

    const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];

        if (!file) {
            return;
        }

        setIsImporting(true);

        try {
            const result = await dashboardPortabilityService.importDashboard(await file.text());
            await refreshDashboardList();
            setPortabilityFeedback(createImportSuccessFeedback(result));
        } catch (error) {
            console.error('Error importando dashboard:', error);
            setPortabilityFeedback({
                kind: 'error',
                title: 'No pudimos importar el dashboard',
                createdCatalogVariableCount: 0,
                issues: extractPortabilityIssues(error),
            });
        } finally {
            event.target.value = '';
            setIsImporting(false);
        }
    };

    const handleDelete = (id: string) => {
        setDeleteDashboardId(id);
    };

    const handleConfirmDeleteDashboard = async () => {
        if (!deleteDashboardId) return;
        const id = deleteDashboardId;
        setDeleteDashboardId(null);

        try {
            await dashboardStorage.deleteDashboard(id);
            setDashboards(dashboards.filter(d => d.id !== id));
        } catch (error) {
            console.error("Error eliminando dashboard:", error);
        }
    };

    const handleDuplicate = async (id: string, newName?: string) => {
        const trimmedName = newName?.trim();

        if (newName !== undefined && !trimmedName) {
            return;
        }

        try {
            const duplicate = await dashboardStorage.duplicateDashboard(id, trimmedName);
            if (duplicate) {
                setDashboards(prev => [...prev, duplicate]);
            }
        } catch (error) {
            console.error("Error duplicando dashboard:", error);
        }
    };

    const handleConfirmDuplicate = async () => {
        if (!showDuplicatePrompt || !duplicateName.trim()) {
            return;
        }

        const dashboardId = showDuplicatePrompt;
        const nextDuplicateName = duplicateName.trim();

        await handleDuplicate(dashboardId, nextDuplicateName);
        setShowDuplicatePrompt(null);
        setDuplicateName('');
    };

    const handleSaveAsTemplate = async (dashId: string) => {
        if (!templateName.trim()) return;
        try {
            const dash = dashboards.find(d => d.id === dashId);
            if (!dash) return;
            // Resolver tipo efectivo: desde jerarquía si asignado, vacío si no asignado
            const ownerNode = dash.ownerNodeId ? nodeMap.get(dash.ownerNodeId) : undefined;
            const effectiveDash = {
                ...dash,
                dashboardType: (ownerNode
                    ? ownerNode.type
                    : 'none') as Dashboard['dashboardType'],
            };
            const tpl = await templateStorage.createFromDashboard(effectiveDash, templateName.trim());
            setTemplates(prev => [...prev, tpl]);
            setShowTemplatePrompt(null);
            setTemplateName('');
        } catch (error) {
            console.error("Error creando template:", error);
        }
    };

    const handleCreateFromTemplate = async (template: Template) => {
        try {
            const dash = await dashboardStorage.createFromTemplate(
                template,
                `${template.name} — Nuevo`
            );
            navigate(`/admin/builder/${dash.id}`);
        } catch (error) {
            console.error("Error creando desde template:", error);
        }
    };

    const handleDeleteTemplate = (id: string) => {
        setDeleteTemplateId(id);
    };

    const handleConfirmDeleteTemplate = async () => {
        if (!deleteTemplateId) return;
        const id = deleteTemplateId;
        setDeleteTemplateId(null);

        try {
            await templateStorage.deleteTemplate(id);
            setTemplates(templates.filter(t => t.id !== id));
        } catch (error) {
            console.error("Error eliminando template:", error);
        }
    };

    const handleStartTemplateRename = (template: Template) => {
        setEditingTemplateId(template.id);
        setEditingTemplateName(template.name);
    };

    const handleCommitTemplateRename = async (template: Template) => {
        const nextName = editingTemplateName.trim();

        if (!nextName || nextName === template.name) {
            setEditingTemplateId(null);
            setEditingTemplateName('');
            return;
        }

        try {
            const updatedTemplate = { ...template, name: nextName };
            await templateStorage.saveTemplate(updatedTemplate);
            setTemplates((current) => current.map((item) => item.id === template.id ? updatedTemplate : item));
        } catch (error) {
            console.error('Error renombrando template:', error);
        } finally {
            setEditingTemplateId(null);
            setEditingTemplateName('');
        }
    };

    const moveDashboard = (items: Dashboard[], sourceId: string, targetId: string) => {
        if (sourceId === targetId) {
            return items;
        }

        const sourceIndex = items.findIndex((item) => item.id === sourceId);
        const targetIndex = items.findIndex((item) => item.id === targetId);

        if (sourceIndex < 0 || targetIndex < 0) {
            return items;
        }

        const nextItems = [...items];
        const [movedItem] = nextItems.splice(sourceIndex, 1);
        nextItems.splice(targetIndex, 0, movedItem);
        return nextItems;
    };

    const handleDashboardDrop = async (targetId: string) => {
        if (!draggingDashboardId) {
            return;
        }

        const reorderedDashboards = moveDashboard(dashboards, draggingDashboardId, targetId);

        setDraggingDashboardId(null);
        setDragOverDashboardId(null);

        if (reorderedDashboards === dashboards) {
            return;
        }

        setDashboards(reorderedDashboards);

        try {
            await dashboardStorage.reorderDashboards(reorderedDashboards.map((dashboard) => dashboard.id));
        } catch (error) {
            console.error('Error reordenando dashboards:', error);
        }
    };

    const filteredDashboards = useMemo(() => {
        const normalizedQuery = dashboardSearch.trim().toLocaleLowerCase();
        const activeTemplateIds = new Set(templates.map((template) => template.id));

        if (!normalizedQuery) {
            return dashboards;
        }

        return dashboards.filter((dashboard) => {
            const title = getDashboardHeaderTitle(dashboard).toLocaleLowerCase();
            const visibleSubtitle = getVisibleDashboardSubtitle(dashboard, activeTemplateIds);
            const subtitle = visibleSubtitle?.toLocaleLowerCase() ?? '';

            return title.includes(normalizedQuery)
                || subtitle.includes(normalizedQuery);
        });
    }, [dashboardSearch, dashboards, templates]);

    const activeTemplateIds = useMemo(() => new Set(templates.map((template) => template.id)), [templates]);
    const sourceDashboardIds = useMemo(
        () => new Set(templates.map((template) => template.sourceDashboardId).filter((id): id is string => Boolean(id))),
        [templates]
    );

    return (
        <AdminWorkspaceLayout
            contextBarPanel={
                <div className="flex h-full w-full items-center px-4">
                    <div className="flex items-center gap-2">
                        <span className={ADMIN_CONTEXT_BAR_LABEL_CLS}>Templates:</span>
                        <span className={ADMIN_CONTEXT_BAR_LABEL_CLS}>{templates.length}</span>
                    </div>
                </div>
            }
            contextBar={
                <div className="flex h-full w-full items-center justify-between gap-4 px-4">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <span className={ADMIN_CONTEXT_BAR_LABEL_CLS}>Dashboards:</span>
                            <span className={ADMIN_CONTEXT_BAR_LABEL_CLS}>{dashboards.length}</span>
                        </div>
                    </div>

                    <label className="relative w-full max-w-sm">
                        <Search
                            size={14}
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-industrial-muted"
                        />
                        <input
                            type="search"
                            value={dashboardSearch}
                            onChange={(event) => setDashboardSearch(event.target.value)}
                            placeholder="Buscar dashboards"
                            className={`${ADMIN_SIDEBAR_INPUT_CLS} h-9 pl-9 pr-3`}
                            aria-label="Buscar dashboards por nombre, subtítulo o descripción"
                        />
                    </label>

                    <input
                        ref={importInputRef}
                        type="file"
                        accept="application/json,.json"
                        className="sr-only"
                        aria-label="Seleccionar archivo portable de dashboard"
                        onChange={(event) => void handleImportFileChange(event)}
                    />

                    <div className="flex items-center gap-2 shrink-0">
                        <AdminActionButton
                            onClick={handleOpenImportPicker}
                            variant="secondary"
                            disabled={isImporting}
                        >
                            {isImporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                            Importar Dashboard
                        </AdminActionButton>

                        <AdminActionButton
                            onClick={handleCreateNew}
                            variant="primary"
                        >
                            <Plus size={14} />
                            Nuevo Dashboard
                        </AdminActionButton>
                    </div>
                </div>
            }
            rail={
                <div className="h-full w-full flex flex-col items-center py-3 gap-1">
                    <HoverTooltip label="Importar dashboard" position="right" className="flex">
                        <button
                            type="button"
                            aria-label="Importar dashboard"
                            onClick={handleOpenImportPicker}
                            disabled={isImporting}
                            className="h-9 w-9 inline-flex items-center justify-center rounded-md text-industrial-muted transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isImporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                        </button>
                    </HoverTooltip>
                    <HoverTooltip label="Nuevo dashboard" position="right" className="flex">
                        <button
                            type="button"
                            aria-label="Nuevo dashboard"
                            onClick={handleCreateNew}
                            className="h-9 w-9 inline-flex items-center justify-center rounded-md text-industrial-muted transition-colors hover:bg-white/5 hover:text-white"
                        >
                            <Plus size={18} />
                        </button>
                    </HoverTooltip>
                </div>
            }
            sidePanel={
                <div className={ADMIN_SIDEBAR_PANEL_CLS}>
                    {templates.length === 0 ? (
                        <div className="h-full px-3 py-4">
                            <AdminEmptyState
                                icon={LayoutTemplate}
                                message="No hay templates disponibles todavía."
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2 p-2">
                            {templates.map((template) => {
                                const widgetCount = template.widgetPresets?.length ?? 0;
                                const templateDashboardTypeLabel = getTemplateTypeLabel(template.dashboardType);

                                return (
                                        <article
                                            key={template.id}
                                            className="rounded-lg border border-white/10 bg-black/10 p-3"
                                        >
                                            <div className="mb-1.5 flex justify-end">
                                                <AdminTag label="TEMPLATE" variant="pink" />
                                            </div>

                                            <div className="min-w-0">
                                                {editingTemplateId === template.id ? (
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            autoFocus
                                                            value={editingTemplateName}
                                                            onChange={(e) => setEditingTemplateName(e.target.value)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    void handleCommitTemplateRename(template);
                                                                }

                                                                if (e.key === 'Escape') {
                                                                    setEditingTemplateId(null);
                                                                    setEditingTemplateName('');
                                                                }
                                                            }}
                                                            onBlur={() => {
                                                                void handleCommitTemplateRename(template);
                                                            }}
                                                            className="w-full rounded border border-admin-accent/50 bg-black/40 px-2 py-1 uppercase text-white transition-colors focus:outline-none"
                                                        />
                                                        <HoverTooltip label="Guardar nombre del template" position="right" className="flex">
                                                            <button
                                                                type="button"
                                                                aria-label="Guardar nombre del template"
                                                                onMouseDown={(e) => e.preventDefault()}
                                                                onClick={() => {
                                                                    void handleCommitTemplateRename(template);
                                                                }}
                                                                className="rounded p-1 text-admin-accent transition-colors hover:bg-white/10"
                                                            >
                                                                <Check size={14} />
                                                            </button>
                                                        </HoverTooltip>
                                                    </div>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleStartTemplateRename(template)}
                                                        className="group flex w-full items-center gap-2 text-left"
                                                    >
                                                        <h3 className="truncate uppercase text-industrial-muted transition-colors group-hover:text-admin-accent">
                                                            {template.name}
                                                        </h3>
                                                        <Edit2 size={12} className="shrink-0 text-white/20 transition-colors group-hover:text-admin-accent" />
                                                    </button>
                                                )}

                                                <p className="mt-0.5 text-industrial-muted font-mono">
                                                    {getWidgetCountLabel(widgetCount)} · {templateDashboardTypeLabel}
                                                </p>
                                            </div>

                                            <div className="mt-2 flex items-center gap-2">
                                                <AdminActionButton
                                                    onClick={() => handleCreateFromTemplate(template)}
                                                    variant="primary"
                                                    className="flex-1"
                                                >
                                                    <LayoutTemplate size={13} />
                                                    Crear Dashboard
                                                </AdminActionButton>
                                                <HoverTooltip label="Eliminar template" position="right" className="flex">
                                                    <button
                                                        type="button"
                                                        aria-label="Eliminar template"
                                                        onClick={() => handleDeleteTemplate(template.id)}
                                                        className="rounded p-2 text-industrial-muted transition-colors hover:bg-white/10 hover:[color:var(--color-status-critical)]"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </HoverTooltip>
                                            </div>
                                        </article>
                                );
                            })}
                        </div>
                    )}
                </div>
            }
        >

            <div className="flex h-full min-h-0 flex-col px-8 pb-8 pt-3">
                <div className="flex h-full min-h-0 w-full flex-col">
                    {/* LOADING */}
                    {isLoading ? (
                        <div className="flex justify-center items-center h-64 border border-white/5 rounded-xl bg-white/[0.02]">
                            <Loader2 className="animate-spin text-admin-accent" size={32} />
                        </div>
                    ) : (
                        <>

            {/* === TABLA DE DASHBOARDS === */}
            <section className="flex min-h-0 flex-1 flex-col">
                <div className="hmi-scrollbar min-h-0 flex-1 overflow-y-auto">
                    <div className={`sticky top-0 z-10 grid ${DASHBOARD_LIST_GRID_CLS} items-center gap-4 border-b border-white/5 bg-industrial-bg px-4 py-4 uppercase text-industrial-muted`}>
                        <div className="w-8"></div>
                        <div>Título / Subtítulo</div>
                        <div className="text-center">Asignación</div>
                        <div className="text-center">Tipo</div>
                        <div className="text-center">Estado</div>
                        <div className="text-center">Acciones</div>
                    </div>

                    <div className="divide-y divide-white/5">
                    {filteredDashboards.map(dash => {
                        const headerTitle = getDashboardHeaderTitle(dash);
                        const headerSubtitle = getVisibleDashboardSubtitle(dash, activeTemplateIds);
                        const initialViewName = getDefaultDashboardView(dash).name;
                        const dashboardTypeLabel = getDashboardTypeLabel(dash.dashboardType, dash.ownerNodeId, nodeMap);
                        const isAssigned = Boolean(dash.ownerNodeId);

                        return (
                            <div
                                key={dash.id}
                                onDragOver={(event) => {
                                    event.preventDefault();
                                    if (draggingDashboardId && draggingDashboardId !== dash.id) {
                                        setDragOverDashboardId(dash.id);
                                    }
                                }}
                                onDragLeave={() => {
                                    if (dragOverDashboardId === dash.id) {
                                        setDragOverDashboardId(null);
                                    }
                                }}
                                onDrop={() => void handleDashboardDrop(dash.id)}
                                className={`grid ${DASHBOARD_LIST_GRID_CLS} items-center gap-4 rounded border p-4 group transition-colors ${
                                    dragOverDashboardId === dash.id
                                        ? 'border-white/20 bg-white/10'
                                        : draggingDashboardId === dash.id
                                            ? 'border-admin-accent/30 bg-admin-accent/10'
                                            : 'border-transparent bg-transparent hover:border-white/20 hover:bg-white/10'
                                }`}
                            >
                             
                            <div
                                draggable
                                onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = 'move';
                                    event.dataTransfer.setData('text/plain', dash.id);
                                    setDraggingDashboardId(dash.id);
                                }}
                                onDragEnd={() => {
                                    setDraggingDashboardId(null);
                                    setDragOverDashboardId(null);
                                }}
                                className="flex justify-center w-8 cursor-move text-white/20"
                            >
                                <GripVertical size={16} />
                            </div>

                            <div>
                                <h3 className="text-[length:inherit] font-[weight:inherit] text-white flex items-center gap-2">
                                    {headerTitle}
                                    {sourceDashboardIds.has(dash.id) && (
                                        <AdminTag label="TEMPLATE" variant="pink" />
                                    )}
                                </h3>
                                {headerSubtitle && (
                                    <p className="text-industrial-muted truncate mt-1">
                                        {headerSubtitle}
                                    </p>
                                )}
                                <p className="mt-1 truncate text-industrial-muted">
                                    Vista inicial: {initialViewName}
                                </p>
                            </div>

                            <div className="flex justify-center">
                                <AdminTag
                                    label={isAssigned ? 'ASIGNADO' : 'SIN ASIGNAR'}
                                    variant={isAssigned ? 'cyan' : 'muted'}
                                />
                            </div>

                            <div className="flex justify-center">
                                <AdminTag label={dashboardTypeLabel} variant="muted" />
                            </div>

                            <div className="flex justify-center">
                                {(() => {
                                    const vs = getDashboardVisualStatus(dash);
                                    return (
                                        <AdminTag
                                            label={vs === 'pending' ? 'PENDING' : vs === 'published' ? 'PUBLISHED' : 'DRAFT'}
                                            variant={vs === 'pending' ? 'amber' : vs === 'published' ? 'green' : 'muted'}
                                        />
                                    );
                                })()}
                            </div>

                            <div className="flex justify-end gap-1 text-industrial-muted">
                                <HoverTooltip label="Editar en Builder" position="right" className="flex">
                                    <button 
                                        type="button"
                                        aria-label="Editar en Builder"
                                        className="p-2 hover:bg-white/10 hover:text-white rounded transition-colors"
                                        onClick={() => navigate(`/admin/builder/${dash.id}`)}
                                    >
                                        <FileEdit size={16} />
                                    </button>
                                </HoverTooltip>
                                <HoverTooltip label="Duplicar" position="right" className="flex">
                                    <button 
                                        type="button"
                                        aria-label="Duplicar"
                                        className="p-2 hover:bg-white/10 hover:text-white rounded transition-colors"
                                        onClick={() => {
                                            setShowDuplicatePrompt(dash.id);
                                            setDuplicateName(getSuggestedDuplicateName(dash));
                                        }}
                                    >
                                        <Copy size={16} />
                                    </button>
                                </HoverTooltip>
                                <HoverTooltip label="Guardar como Template" position="right" className="flex">
                                    <button 
                                        type="button"
                                        aria-label="Guardar como Template"
                                        className="p-2 hover:bg-violet-500/20 hover:text-violet-400 rounded transition-colors"
                                        onClick={() => {
                                            setShowTemplatePrompt(dash.id);
                                            setTemplateName(getSuggestedTemplateName(dash));
                                        }}
                                    >
                                        <Bookmark size={16} />
                                    </button>
                                </HoverTooltip>
                                <HoverTooltip label="Exportar dashboard" position="right" className="flex">
                                    <button
                                        type="button"
                                        aria-label={`Exportar ${headerTitle}`}
                                        className="p-2 hover:bg-white/10 hover:text-white rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                                        onClick={() => handleOpenExportDialog(dash)}
                                        disabled={exportingDashboardId === dash.id}
                                    >
                                        {exportingDashboardId === dash.id
                                            ? <Loader2 size={16} className="animate-spin" />
                                            : <Upload size={16} />}
                                    </button>
                                </HoverTooltip>
                                <HoverTooltip label="Eliminar" position="right" className="flex">
                                    <button 
                                        type="button"
                                        aria-label="Eliminar"
                                        className="p-2 hover:bg-red-500/20 hover:text-red-400 rounded transition-colors" 
                                        onClick={() => handleDelete(dash.id)}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </HoverTooltip>
                            </div>

                            </div>
                        );
                    })}
                    
                    {dashboards.length === 0 && (
                        <div className="h-56 px-4 py-6">
                            <AdminEmptyState
                                icon={LayoutDashboard}
                                message="No hay dashboards configurados."
                            />
                        </div>
                    )}

                    {dashboards.length > 0 && filteredDashboards.length === 0 && (
                        <div className="h-56 px-4 py-6">
                            <AdminEmptyState
                                icon={SearchX}
                                message={`No encontramos dashboards que coincidan con “${dashboardSearch.trim()}”.`}
                            />
                        </div>
                    )}
                </div>
                </div>
            </section>

            {/* === MODAL TEMPLATE NAME === */}
            {showTemplatePrompt && (
                <AdminDialog
                    open={Boolean(showTemplatePrompt)}
                    title="Guardar como Template"
                    onClose={() => setShowTemplatePrompt(null)}
                    actions={(
                        <>
                            <AdminActionButton variant="secondary" onClick={() => setShowTemplatePrompt(null)}>
                                Cancelar
                            </AdminActionButton>
                            <AdminActionButton
                                onClick={() => showTemplatePrompt && void handleSaveAsTemplate(showTemplatePrompt)}
                                disabled={!templateName.trim() || !showTemplatePrompt}
                                variant="primary"
                            >
                                Guardar Template
                            </AdminActionButton>
                        </>
                    )}
                >
                    <div>
                        <label className="mb-1.5 block w-auto uppercase text-industrial-muted">
                            Nombre
                        </label>
                        <input
                            type="text"
                            value={templateName}
                            onChange={e => setTemplateName(e.target.value)}
                            placeholder="Nombre del template"
                            className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                            autoFocus
                        />
                    </div>
                </AdminDialog>
            )}

            {showDuplicatePrompt && (
                <AdminDialog
                    open={Boolean(showDuplicatePrompt)}
                    title="DUPLICAR DASHBOARD"
                    onClose={() => {
                        setShowDuplicatePrompt(null);
                        setDuplicateName('');
                    }}
                    actions={(
                        <>
                            <AdminActionButton
                                variant="secondary"
                                onClick={() => {
                                    setShowDuplicatePrompt(null);
                                    setDuplicateName('');
                                }}
                            >
                                Cancelar
                            </AdminActionButton>
                            <AdminActionButton
                                onClick={() => void handleConfirmDuplicate()}
                                disabled={!duplicateName.trim() || !showDuplicatePrompt}
                                variant="primary"
                            >
                                Duplicar
                            </AdminActionButton>
                        </>
                    )}
                >
                    <div>
                        <label className="mb-1.5 block w-auto uppercase text-industrial-muted">
                            NOMBRE
                        </label>
                        <input
                            type="text"
                            value={duplicateName}
                            onChange={e => setDuplicateName(e.target.value)}
                            placeholder="Nombre del dashboard"
                            className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                            autoFocus
                        />
                    </div>
                </AdminDialog>
            )}

            <AdminDialog
                open={Boolean(exportDialogDashboardId)}
                title="Exportar dashboard"
                onClose={handleCloseExportDialog}
                actions={(
                    <>
                        <AdminActionButton variant="secondary" onClick={handleCloseExportDialog}>
                            Cancelar exportación
                        </AdminActionButton>
                        <AdminActionButton
                            onClick={() => void handleConfirmExportDashboard()}
                            disabled={!exportFileName.trim()}
                            variant="primary"
                        >
                            Confirmar exportación
                        </AdminActionButton>
                    </>
                )}
            >
                <div>
                    <label className="mb-1.5 block w-auto uppercase text-industrial-muted" htmlFor="dashboard-export-file-name">
                        Nombre del archivo
                    </label>
                    <input
                        id="dashboard-export-file-name"
                        aria-label="Nombre del archivo"
                        type="text"
                        value={exportFileName}
                        onChange={(event) => setExportFileName(event.target.value)}
                        placeholder="Nombre del archivo"
                        className={`${ADMIN_SIDEBAR_INPUT_CLS} px-3 py-2`}
                        autoFocus
                    />
                </div>
            </AdminDialog>

            {(() => {
                const targetDash = dashboards.find(d => d.id === deleteDashboardId);
                const ownerNode = targetDash?.ownerNodeId ? nodeMap.get(targetDash.ownerNodeId) : undefined;

                return ownerNode ? (
                    <AdminDestructiveDialog
                        open={Boolean(deleteDashboardId)}
                        title="Eliminar Dashboard"
                        onClose={() => setDeleteDashboardId(null)}
                        onConfirm={() => void handleConfirmDeleteDashboard()}
                        warningMessage="Este dashboard está asignado a un nodo en la jerarquía de planta."
                        affectedLabel="Nodo afectado"
                        affectedItems={[{ name: ownerNode.name, id: ownerNode.id }]}
                        confirmMessage="El nodo quedará sin dashboard vinculado. ¿Confirmar?"
                    />
                ) : (
                    <AdminDialog
                        open={Boolean(deleteDashboardId)}
                        title="Eliminar Dashboard"
                        onClose={() => setDeleteDashboardId(null)}
                        actions={(
                            <>
                                <AdminActionButton variant="secondary" onClick={() => setDeleteDashboardId(null)}>
                                    Cancelar
                                </AdminActionButton>
                                <AdminActionButton
                                    onClick={() => void handleConfirmDeleteDashboard()}
                                    variant="critical"
                                >
                                    Eliminar
                                </AdminActionButton>
                            </>
                        )}
                    >
                        <p className="text-industrial-muted">¿Eliminar este dashboard? Esta acción no se puede deshacer.</p>
                    </AdminDialog>
                );
            })()}

            <AdminDialog
                open={Boolean(deleteTemplateId)}
                title="Eliminar Template"
                onClose={() => setDeleteTemplateId(null)}
                actions={(
                    <>
                        <AdminActionButton variant="secondary" onClick={() => setDeleteTemplateId(null)}>
                            Cancelar
                        </AdminActionButton>
                        <AdminActionButton
                            onClick={() => void handleConfirmDeleteTemplate()}
                            variant="secondary"
                        >
                            Eliminar
                        </AdminActionButton>
                    </>
                )}
            >
                <p className="text-industrial-muted">¿Eliminar este template?</p>
            </AdminDialog>

            <AdminDialog
                open={Boolean(portabilityFeedback)}
                title={portabilityFeedback?.title ?? 'Portabilidad de dashboard'}
                onClose={() => setPortabilityFeedback(null)}
                actions={(
                    <AdminActionButton variant="primary" onClick={() => setPortabilityFeedback(null)}>
                        Cerrar
                    </AdminActionButton>
                )}
                maxWidth="max-w-lg"
            >
                {portabilityFeedback?.kind === 'success' ? (
                    <div className="space-y-3 text-industrial-muted">
                        <p>
                            Dashboard importado: <span className="text-white">{portabilityFeedback.dashboardName}</span>
                        </p>
                        <p>{buildImportSuccessSummary(portabilityFeedback.createdCatalogVariableCount)}</p>
                        {portabilityFeedback.issues.length > 0 && (
                            <div className="space-y-2">
                                <h4 className="uppercase text-white">Advertencias</h4>
                                <ul className="space-y-2">
                                    {portabilityFeedback.issues.map((issue) => (
                                        <li key={`${issue.code}-${issue.path}`} className="rounded border border-white/10 bg-black/10 px-3 py-2">
                                            <p>{issue.message}</p>
                                            <p className="mt-1 font-mono text-xs text-industrial-muted/80">{issue.path}</p>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-3 text-industrial-muted">
                        <p>Revisá los problemas marcados antes de volver a intentar la importación.</p>
                        <ul className="space-y-2">
                            {portabilityFeedback?.issues.map((issue) => (
                                <li key={`${issue.code}-${issue.path}`} className="rounded border border-status-critical/30 bg-status-critical/10 px-3 py-2">
                                    <p className="text-white">{issue.message}</p>
                                    <p className="mt-1 font-mono text-xs text-industrial-muted/80">{issue.path}</p>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </AdminDialog>

                        </>
                    )}
                </div>
            </div>
        </AdminWorkspaceLayout>
    );
}
