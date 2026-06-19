import { useState, useMemo, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { DragEvent } from 'react';
import { useParams, useNavigate, useBlocker } from 'react-router-dom';
import { Save, ArrowLeft, Loader2, AlertCircle, ChevronRight, AlertTriangle, LayoutGrid } from 'lucide-react';
import { dashboardStorage } from '../../services/DashboardStorageService';
import { hierarchyStorage } from '../../services/HierarchyStorageService';
import { variableCatalogStorage } from '../../services/VariableCatalogStorageService';
import { mockEquipmentList } from '../../mocks/equipment.mock';
import type { CatalogVariable } from '../../domain';
import type { Dashboard, DashboardHeaderConfig, DashboardVisualStatus, HierarchyNode, WidgetType, WidgetConfig, WidgetLayout } from '../../domain/admin.types';
import { getDashboardVisualStatus } from '../../domain/admin.types';
import type { EquipmentSummary, MetricValue } from '../../domain/equipment.types';
import type { HierarchyContext } from '../../widgets/resolvers/hierarchyResolver';
import AdminWorkspaceLayout from '../../components/admin/AdminWorkspaceLayout';
import BuilderCanvas from '../../components/admin/BuilderCanvas';
import WidgetCatalogRail from '../../components/admin/WidgetCatalogRail';
import PropertyDock from '../../components/admin/PropertyDock';
import AdminEmptyState from '../../components/admin/AdminEmptyState';
import DashboardHeader from '../../components/viewer/DashboardHeader';
import AdminDialog from '../../components/admin/AdminDialog';
import AdminDestructiveDialog from '../../components/admin/AdminDestructiveDialog';
import AdminActionButton from '../../components/admin/AdminActionButton';
import AdminTag from '../../components/admin/AdminTag';
import ContextBarNotice from '../../components/admin/ContextBarNotice';
import HoverTooltip from '../../components/ui/HoverTooltip';
import { generateWidgetId } from '../../utils/idGenerator';
import {
    HEADER_WIDGET_DRAG_MIME,
    HEADER_WIDGET_SLOT_COUNT,
    type HeaderWidgetDragPayload,
    isHeaderCompatibleWidget,
    isHeaderCompatibleWidgetType,
    parseHeaderWidgetDragPayload,
    getFirstFreeHeaderSlot,
} from '../../utils/headerWidgets';
import { createDefaultStatusDisplayOptions } from '../../utils/statusWidget';
import {
    createDefaultConnectionStatusDisplayOptions,
} from '../../utils/connectionWidget';
import { createDefaultActivityAnalyticsDisplayOptions } from '../../utils/activityAnalyticsWidgetDefaults';
import { DEFAULT_TEXT_TITLE_FONT_SIZE } from '../../widgets/renderers/TextTitleWidget';
import { getAncestors } from '../../utils/hierarchyTree';
import { loadNodeTypeLabels, resolveTypeLabel } from '../../utils/nodeTypeLabels';
import { migrateLegacyBindings } from '../../utils/catalogMigration';
import { supportsCatalogVariable, getDefaultIcon, getDefaultSize } from '../../utils/widgetCapabilities';
import { DEFAULT_COLS, DEFAULT_ROWS } from '../../utils/gridConfig';
import { useUIStore } from '../../store/ui.store';
import { useDataOverview } from '../../queries/useDataOverview';

// =============================================================================
// DashboardBuilderPage
// Editor visual del dashboard. Composición de canvas central con sidebars
// de catálogo de widgets y panel de propiedades.
// =============================================================================

export default function DashboardBuilderPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    // 1. Estado original vs Estado draft para saber si hay cambios
    const [originalConfig, setOriginalConfig] = useState<Dashboard | null>(null);
    const [draft, setDraft] = useState<Dashboard | null>(null);
    const [allDashboards, setAllDashboards] = useState<Dashboard[]>([]);
    const [allNodes, setAllNodes] = useState<HierarchyNode[]>([]);
    const [catalogVariables, setCatalogVariables] = useState<CatalogVariable[]>([]);
    const [stagedVariables, setStagedVariables] = useState<CatalogVariable[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    
    // 2. Estado de selección
    const [selectedWidgetId, setSelectedWidgetId] = useState<string | undefined>();

    const [draggedWidget, setDraggedWidget] = useState<HeaderWidgetDragPayload | null>(null);
    const [isHeaderDropActive, setIsHeaderDropActive] = useState(false);
    const [dialogMessage, setDialogMessage] = useState<string | null>(null);
    const [variableDeletionState, setVariableDeletionState] = useState<VariableDeletionState | null>(null);
    const [, setNodeTypeLabelsVersion] = useState(0);

    const isGridVisible = useUIStore((state) => state.isGridVisible);
    const toggleGrid = useUIStore((state) => state.toggleGrid);
    const {
        connection,
        machines,
        isLoading: dataLoading,
        isError: dataError,
        isEnabled: dataEnabled,
    } = useDataOverview();

    useEffect(() => {
        void loadNodeTypeLabels().then(() => {
            setNodeTypeLabelsVersion((current) => current + 1);
        });
    }, []);

    const normalizeDashboardBounds = (dashboard: Dashboard): Dashboard => ({
        ...dashboard,
        cols: dashboard.cols || DEFAULT_COLS,
        rows: dashboard.rows || DEFAULT_ROWS,
        publishedSnapshot: dashboard.publishedSnapshot
            ? {
                ...dashboard.publishedSnapshot,
                cols: dashboard.publishedSnapshot.cols || dashboard.cols || DEFAULT_COLS,
                rows: dashboard.publishedSnapshot.rows || dashboard.rows || DEFAULT_ROWS,
            }
            : undefined,
    });

    const allCatalogVariables = useMemo(
        () => [...catalogVariables, ...stagedVariables],
        [catalogVariables, stagedVariables],
    );

    const usedCatalogVariableIds = useMemo(() => {
        if (!draft) {
            return [];
        }

        return [...new Set(
            draft.widgets
                .map((widget) => widget.binding?.catalogVariableId)
                .filter((catalogVariableId): catalogVariableId is string => Boolean(catalogVariableId)),
        )];
    }, [draft]);

    // 4a. IDs de widgets asignados al header — excluidos del grid del builder
    // Calculado antes del guard para respetar las reglas de hooks.
    const headerWidgetIds = useMemo(() => {
        return new Set(
            (draft?.headerConfig?.widgetSlots ?? []).map(s => s.widgetId)
        );
    }, [draft?.headerConfig?.widgetSlots]);

    // 4b. Columnas del header actualmente ocupadas (para calcular el primer slot libre).
    // El valor de `column` puede ser explícito o implícito (índice en el array).
    const headerOccupiedColumns = useMemo(() => {
        const slots = draft?.headerConfig?.widgetSlots ?? [];
        return new Set(slots.map((s, i) => s.column ?? i));
    }, [draft?.headerConfig?.widgetSlots]);

    // Dirty check — top-level para permitir useBlocker sin violar las reglas de hooks
    const isDirty = useMemo(() => {
        if (!draft || !originalConfig) return false;
        return JSON.stringify(draft.widgets) !== JSON.stringify(originalConfig.widgets) ||
               JSON.stringify(draft.layout) !== JSON.stringify(originalConfig.layout) ||
               draft.name !== originalConfig.name ||
               draft.dashboardType !== originalConfig.dashboardType ||
               JSON.stringify(draft.headerConfig) !== JSON.stringify(originalConfig.headerConfig);
    }, [draft, originalConfig]);

    const blocker = useBlocker(isDirty);

    // 4. Mapeo de equipos simulado (para resolver bindings de la F3)
    const equipmentMap = useMemo(() => {
        const list = mockEquipmentList;
        const map = new Map<string, EquipmentSummary>();
        // simplificamos para el ejemplo 
        list.forEach((eq: EquipmentSummary) => map.set(eq.id, { 
            id: eq.id, 
            name: eq.name, 
            status: eq.status, 
            type: eq.type, 
            primaryMetrics: eq.primaryMetrics.filter((m: MetricValue) => m.label === 'Velocidad' || m.label === 'Fuerza').map((m: MetricValue) => ({
                id: m.label,
                label: m.label,
                value: m.value,
                unit: m.unit,
                status: 'normal',
                timestamp: new Date().toISOString()
            })),
            connectionState: eq.connectionState,
            lastUpdateAt: eq.lastUpdateAt,
        }));
        return map;
    }, []);

    // 4. Efecto de carga inicial
    useEffect(() => {
        const loadConfig = async () => {
            if (!id) return;
            setIsLoading(true);
            try {
                const [config, dashboards, nodes, catalog] = await Promise.all([
                    dashboardStorage.getDashboard(id),
                    dashboardStorage.getDashboards(),
                    hierarchyStorage.getNodes(),
                    variableCatalogStorage.getAll(),
                ]);

                let nextDashboards = dashboards;
                let nextConfig = config;
                let nextCatalog = catalog;
                const migratedDashboardIds = await migrateLegacyBindings(nextDashboards, variableCatalogStorage);

                if (migratedDashboardIds.length > 0) {
                    await Promise.all(
                        nextDashboards
                            .filter((dashboard) => migratedDashboardIds.includes(dashboard.id))
                            .map((dashboard) => dashboardStorage.saveDashboard(dashboard)),
                    );

                    nextDashboards = await dashboardStorage.getDashboards();
                    nextConfig = nextDashboards.find((dashboard) => dashboard.id === id) ?? null;
                    nextCatalog = await variableCatalogStorage.getAll();
                }

                setAllDashboards(nextDashboards.map(normalizeDashboardBounds));
                setAllNodes(nodes);
                setCatalogVariables(nextCatalog);
                setStagedVariables([]);

                if (nextConfig) {
                    const normalizedConfig = normalizeDashboardBounds(nextConfig);
                    setOriginalConfig(normalizedConfig);
                    setDraft(JSON.parse(JSON.stringify(normalizedConfig))); // Deep copy
                }
            } catch (error) {
                console.error("Error cargando dashboard:", error);
            } finally {
                setIsLoading(false);
            }
        };
        loadConfig();
    }, [id]);

    const hierarchyContext = useMemo<HierarchyContext | undefined>(() => {
        if (!draft) return undefined;
        return {
            allNodes,
            allDashboards,
            currentNodeId: draft.ownerNodeId,
        };
    }, [allDashboards, allNodes, draft]);

    const backButton = (
        <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 text-industrial-muted transition-colors hover:text-white"
        >
            <ArrowLeft size={14} />
            Volver
        </button>
    );

    const contextBarPanel = draft ? (
        <div className="relative flex items-center gap-2 px-3">
            {backButton}
            <HoverTooltip label={isGridVisible ? 'Ocultar grid' : 'Mostrar grid'} position="right" className="flex">
                <button
                    aria-label={isGridVisible ? 'Ocultar grid' : 'Mostrar grid'}
                    aria-pressed={isGridVisible}
                    className={[
                        'h-9 w-9 inline-flex items-center justify-center rounded-md transition-colors',
                        isGridVisible
                            ? 'bg-admin-accent/15 text-admin-accent hover:bg-admin-accent/20'
                            : 'text-industrial-muted hover:bg-white/5 hover:text-white',
                    ].join(' ')}
                    type="button"
                    onClick={toggleGrid}
                >
                    <LayoutGrid size={16} />
                </button>
            </HoverTooltip>
        </div>
    ) : backButton;

    const renderContextBarState = (content: ReactNode) => (
        <div className="flex h-full items-center justify-start gap-4 px-4">
            {content}
        </div>
    );

    const handleCancelVariableDeletion = () => {
        setVariableDeletionState(null);
    };

    const handleConfirmVariableDeletion = async () => {
        if (!variableDeletionState) {
            return;
        }

        await deleteCatalogVariable(variableDeletionState.variable.id);
    };

    const deleteCatalogVariable = async (variableId: string) => {
        setIsSaving(true);

        try {
            const storedDashboards = await dashboardStorage.getDashboards();
            const dashboardsToProcess = storedDashboards.map((dashboard) => {
                if (draft && dashboard.id === draft.id) {
                    return JSON.parse(JSON.stringify(draft)) as Dashboard;
                }

                return dashboard;
            });

            const affectedDashboards = dashboardsToProcess.filter((dashboard) =>
                dashboard.widgets.some((widget) => widget.binding?.catalogVariableId === variableId),
            );

            await variableCatalogStorage.delete(variableId);

            await Promise.all(
                affectedDashboards.map(async (dashboard) => {
                    const cleanedDashboard: Dashboard = {
                        ...dashboard,
                        widgets: dashboard.widgets.map((widget) => {
                            if (widget.binding?.catalogVariableId !== variableId) {
                                return widget;
                            }

                            return {
                                ...widget,
                                binding: {
                                    ...widget.binding,
                                    catalogVariableId: undefined,
                                },
                            };
                        }),
                    };

                    await dashboardStorage.saveDashboard(cleanedDashboard);
                }),
            );

            const refreshedDashboards = await dashboardStorage.getDashboards();
            const refreshedCatalog = await variableCatalogStorage.getAll();

            setAllDashboards(refreshedDashboards);
            setCatalogVariables(refreshedCatalog);
            setStagedVariables((prev) => prev.filter((catalogVariable) => catalogVariable.id !== variableId));
            setDraft((prev) => {
                if (!prev) {
                    return prev;
                }

                return {
                    ...prev,
                    widgets: prev.widgets.map((widget) => {
                        if (widget.binding?.catalogVariableId !== variableId) {
                            return widget;
                        }

                        return {
                            ...widget,
                            binding: {
                                ...widget.binding,
                                catalogVariableId: undefined,
                            },
                        };
                    }),
                };
            });
            setOriginalConfig((prev) => {
                if (!prev) {
                    return prev;
                }

                const refreshedCurrentDashboard = refreshedDashboards.find((dashboard) => dashboard.id === prev.id);
                return refreshedCurrentDashboard ?? prev;
            });
            setVariableDeletionState(null);
        } catch (error) {
            console.error('Error eliminando variable de catálogo:', error);
            setDialogMessage('Hubo un error al eliminar la variable del catálogo.');
        } finally {
            setIsSaving(false);
        }
    };

    let mainScrollable = false;
    let rail: ReactNode;
    let sidePanel: ReactNode;
    let contextBar: ReactNode;
    let content: ReactNode;

    if (isLoading) {
        contextBar = renderContextBarState(
            <div className="flex items-center gap-2 text-industrial-muted">
                <Loader2 size={14} className="animate-spin" />
                Cargando dashboard…
            </div>
        );

        content = (
            <div className="flex h-full min-h-0 items-center justify-center text-industrial-muted">
                <Loader2 className="mr-2 animate-spin" /> Cargando entorno constructor...
            </div>
        );
    } else if (!draft || !originalConfig) {
        contextBar = renderContextBarState(
            <div className="uppercase text-industrial-muted">
                Dashboard no encontrado
            </div>
        );

        content = (
            <div className="h-full min-h-0 p-8">
                <AdminEmptyState
                    icon={AlertCircle}
                    message="Dashboard no encontrado."
                />
            </div>
        );
    } else {
        const selectedWidget = draft.widgets.find(w => w.id === selectedWidgetId);
        const isSelectedHeaderWidget = selectedWidgetId ? headerWidgetIds.has(selectedWidgetId) : false;
        const ownerNode = draft.ownerNodeId
            ? allNodes.find((node) => node.id === draft.ownerNodeId)
            : undefined;
        const ownerNodeBreadcrumbs = ownerNode
            ? getAncestors(ownerNode.id, allNodes)
            : [];
        const selectedWidgetLayout = draft.layout.find(l => l.widgetId === selectedWidgetId) ?? (
            selectedWidget && isSelectedHeaderWidget
                ? {
                    widgetId: selectedWidget.id,
                    x: 0,
                    y: 0,
                    w: selectedWidget.size.w,
                    h: selectedWidget.size.h,
                }
                : undefined
        );
        // Estado visual derivado del dashboard persistido (no del draft en memoria)
        const visualStatus: DashboardVisualStatus = getDashboardVisualStatus(originalConfig);
        const isAssigned = Boolean(draft.ownerNodeId);

        const handleSaveDraft = async () => {
            if (!draft) return;
            setIsSaving(true);
            try {
                // Si el dashboard ya está publicado, preservamos el status 'published'
                // para que el snapshot siga activo (estado PENDING).
                // Solo forzamos 'draft' cuando nunca fue publicado.
                const saveStatus = draft.status === 'published' ? 'published' : 'draft';
                const draftToSave = await prepareDashboardForSave({
                    dashboard: draft,
                    status: saveStatus,
                });

                if (!draftToSave) {
                    return;
                }

                await dashboardStorage.saveDashboard(draftToSave);

                const newConfig = await dashboardStorage.getDashboard(draft.id);
                const dashboards = await dashboardStorage.getDashboards();
                if (newConfig) {
                    setOriginalConfig(newConfig);
                    setDraft(JSON.parse(JSON.stringify(newConfig)));
                }
                setAllDashboards(dashboards);
            } catch (error) {
                console.error("Error guardando draft:", error);
                setDialogMessage('Hubo un error al guardar el borrador.');
            } finally {
                setIsSaving(false);
            }
        };

        const handlePublish = async () => {
            if (!originalConfig) return;
            setIsSaving(true);
            try {
                if (isDirty && draft) {
                    const draftToSave = await prepareDashboardForSave({
                        dashboard: draft,
                        status: draft.status,
                    });

                    if (!draftToSave) {
                        return;
                    }

                    await dashboardStorage.saveDashboard(draftToSave);
                }
                await dashboardStorage.publishDashboard(originalConfig.id);

                const newConfig = await dashboardStorage.getDashboard(originalConfig.id);
                const dashboards = await dashboardStorage.getDashboards();
                if (newConfig) {
                    setOriginalConfig(newConfig);
                    setDraft(JSON.parse(JSON.stringify(newConfig)));
                }
                setAllDashboards(dashboards);
            } catch (error) {
                console.error("Error publicando:", error);
                setDialogMessage('Hubo un error al publicar el dashboard.');
            } finally {
                setIsSaving(false);
            }
        };

        const handleUpdateHeaderConfig = (headerConfig: DashboardHeaderConfig) => {
            setDraft(prev => {
                if (!prev) return prev;
                return { ...prev, headerConfig };
            });
        };

        const handleHeaderTitleChange = (value: string) => {
            handleUpdateHeaderConfig({
                ...(draft.headerConfig ?? {}),
                title: value.trim() || undefined,
            });
        };

        const handleHeaderSubtitleChange = (value: string) => {
            handleUpdateHeaderConfig({
                ...(draft.headerConfig ?? {}),
                subtitle: value.trim() || undefined,
            });
        };

        const buildGridLayoutForWidget = (widget: WidgetConfig, layout: WidgetLayout[]): WidgetLayout => {
            const maxY = layout.reduce((acc, item) => Math.max(acc, item.y + item.h), 0);

            return {
                widgetId: widget.id,
                x: 0,
                y: maxY,
                w: widget.size.w,
                h: widget.size.h,
            };
        };

        const handleAssignWidgetToHeader = (widgetId: string) => {
            const widget = draft.widgets.find(item => item.id === widgetId);

            if (!widget || !isHeaderCompatibleWidget(widget)) {
                return;
            }

            const currentSlots = draft.headerConfig?.widgetSlots ?? [];

            if (currentSlots.some(slot => slot.widgetId === widgetId) || currentSlots.length >= HEADER_WIDGET_SLOT_COUNT) {
                return;
            }

            const targetColumn = getFirstFreeHeaderSlot(new Set(currentSlots.map((slot, index) => slot.column ?? index)));

            if (targetColumn === null) {
                return;
            }

            handleUpdateHeaderConfig({
                ...(draft.headerConfig ?? {}),
                widgetSlots: [...currentSlots, { widgetId, column: targetColumn }],
            });

            setSelectedWidgetId(widgetId);
        };

        const handleRemoveWidgetFromHeader = (widgetId: string) => {
            const widget = draft.widgets.find(item => item.id === widgetId);

            setDraft(prev => {
                if (!prev) return prev;

                const hasLayoutEntry = prev.layout.some(item => item.widgetId === widgetId);
                const nextLayout = !hasLayoutEntry && widget
                    ? [...prev.layout, buildGridLayoutForWidget(widget, prev.layout)]
                    : prev.layout;

                return {
                    ...prev,
                    layout: nextLayout,
                    headerConfig: {
                        ...(prev.headerConfig ?? {}),
                        widgetSlots: (prev.headerConfig?.widgetSlots ?? []).filter(slot => slot.widgetId !== widgetId),
                    },
                };
            });
        };

        const handleMoveHeaderWidget = (widgetId: string, targetColumn: number) => {
            const currentSlots = draft.headerConfig?.widgetSlots ?? [];

            const movingSlot = currentSlots.find(slot => slot.widgetId === widgetId);
            if (!movingSlot) return;

            const sourceColumn = movingSlot.column ?? currentSlots.indexOf(movingSlot);
            if (sourceColumn === targetColumn) return;

            const occupyingSlot = currentSlots.find((slot) => (
                (slot.column ?? currentSlots.indexOf(slot)) === targetColumn
            ));

            const newSlots = currentSlots.map((slot) => {
                if (slot.widgetId === widgetId) {
                    return { ...slot, column: targetColumn };
                }

                if (occupyingSlot && slot.widgetId === occupyingSlot.widgetId) {
                    return { ...slot, column: sourceColumn };
                }

                return slot;
            });

            handleUpdateHeaderConfig({
                ...(draft.headerConfig ?? {}),
                widgetSlots: newSlots,
            });
        };

        const handleHeaderDragOver = (event: DragEvent<HTMLDivElement>) => {
            const rawPayload = event.dataTransfer.getData(HEADER_WIDGET_DRAG_MIME);
            const payload = rawPayload ? parseHeaderWidgetDragPayload(rawPayload) : draggedWidget;

            if (
                !payload
                || !isHeaderCompatibleWidgetType(payload.widgetType)
                || (draft.headerConfig?.widgetSlots?.length ?? 0) >= HEADER_WIDGET_SLOT_COUNT
            ) {
                return;
            }

            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setIsHeaderDropActive(true);
        };

        const handleHeaderDrop = (event: DragEvent<HTMLDivElement>) => {
            const rawPayload = event.dataTransfer.getData(HEADER_WIDGET_DRAG_MIME);
            const payload = rawPayload ? parseHeaderWidgetDragPayload(rawPayload) : draggedWidget;

            setIsHeaderDropActive(false);

            if (
                !payload
                || !isHeaderCompatibleWidgetType(payload.widgetType)
                || (draft.headerConfig?.widgetSlots?.length ?? 0) >= HEADER_WIDGET_SLOT_COUNT
            ) {
                return;
            }

            event.preventDefault();
            handleAssignWidgetToHeader(payload.widgetId);
            setDraggedWidget(null);
        };

        const handleAddWidget = (type: WidgetType) => {
            const newId = generateWidgetId(type);
            const { w: defaultWidth, h: defaultHeight } = getDefaultSize(type);
            const defaultIcon = getDefaultIcon(type);

            const newWidget: WidgetConfig = type === 'trend-chart'
                ? {
                    id: newId,
                    type,
                    title: 'Trend Chart',
                    position: { x: 0, y: 0 },
                    size: { w: defaultWidth, h: defaultHeight },
                    binding: { mode: 'simulated_value', simulatedValue: 50 },
                    displayOptions: {
                        icon: defaultIcon,
                    },
                }
                : type === 'trend-chart-v2'
                    ? {
                        id: newId,
                        type,
                        title: 'Trend Chart V2',
                        position: { x: 0, y: 0 },
                        size: { w: defaultWidth, h: defaultHeight },
                        binding: { mode: 'simulated_value', simulatedValue: 50 },
                        displayOptions: {
                            historicalDensity: 'normal',
                        },
                    }
                : type === 'activity-analytics'
                    ? {
                        id: newId,
                        type,
                        title: 'Análisis de Actividad',
                        position: { x: 0, y: 0 },
                        size: { w: defaultWidth, h: defaultHeight },
                        binding: {
                            mode: 'real_variable',
                            bindingVersion: 'node-red-v1',
                        },
                        displayOptions: createDefaultActivityAnalyticsDisplayOptions(),
                    }
                : type === 'kpi'
                    ? {
                        id: newId,
                        type,
                        title: `Nuevo ${type.replace('-', ' ')}`,
                        position: { x: 0, y: 0 },
                        size: { w: defaultWidth, h: defaultHeight },
                        binding: { mode: 'simulated_value', simulatedValue: 0 },
                        displayOptions: {
                            icon: defaultIcon,
                            unitOverride: false,
                        },
                    }
                : type === 'metric-card'
                    ? {
                        id: newId,
                        type,
                        title: `Nuevo ${type.replace('-', ' ')}`,
                        position: { x: 0, y: 0 },
                        size: { w: defaultWidth, h: defaultHeight },
                        binding: { mode: 'simulated_value', simulatedValue: 0 },
                        displayOptions: {
                            icon: defaultIcon,
                        },
                    }
                : type === 'alert-history'
                    ? {
                        id: newId,
                        type,
                        title: 'Histórico de alertas',
                        position: { x: 0, y: 0 },
                        size: { w: defaultWidth, h: defaultHeight },
                        binding: { mode: 'simulated_value', simulatedValue: 0 },
                        displayOptions: {
                            dashboardId: draft.id,
                            icon: defaultIcon,
                            maxVisible: 5,
                            pollInterval: 10000,
                        },
                    }
                    : type === 'machine-activity'
                        ? {
                            id: newId,
                            type,
                            title: 'Actividad de Máquina',
                            position: { x: 0, y: 0 },
                            size: { w: defaultWidth, h: defaultHeight },
                            binding: { mode: 'simulated_value', simulatedValue: 0 },
                            displayOptions: {
                                icon: defaultIcon,
                                kpiMode: 'circular',
                                unitOverride: true,
                                unit: '%',
                                thresholdStopped: 0.15,
                                thresholdProducing: 0.25,
                                hysteresis: 0.05,
                                confirmationTime: 2000,
                                smoothingWindow: 5,
                                powerMin: 0,
                                powerMax: 1.0,
                                showStateSubtitle: true,
                                showPowerSubtext: true,
                                showDynamicColor: true,
                                showStateAnimation: true,
                                labelStopped: 'Detenida',
                                labelCalibrating: 'Setup',
                                labelProducing: 'Produciendo',
                            },
                        }
                    : type === 'prod-history'
                        ? {
                            id: newId,
                            type,
                            title: 'Producción Histórica',
                            position: { x: 0, y: 0 },
                            size: { w: defaultWidth, h: defaultHeight },
                            binding: { mode: 'simulated_value', simulatedValue: 0 },
                            displayOptions: {
                                sourceLabel: 'Simulado',
                                icon: defaultIcon,
                                productionLabel: 'Producción',
                                oeeLabel: 'OEE (%)',
                                chartTitle: 'PRODUCCIÓN HISTÓRICA',
                                productionChartMode: 'bars',
                                oeeChartMode: 'line',
                                useSecondaryAxis: true,
                                autoScale: true,
                                showGrid: true,
                                oeeShowArea: false,
                                oeeShowPoints: false,
                                defaultTemporalGrouping: 'hour',
                                defaultShowOee: true,
                            },
                        }
                    : type === 'connection-status'
                        ? {
                            id: newId,
                            type,
                            title: 'Estado Conexión',
                            position: { x: 0, y: 0 },
                            size: { w: defaultWidth, h: defaultHeight },
                            binding: { mode: 'simulated_value', simulatedValue: 'online' },
                            displayOptions: createDefaultConnectionStatusDisplayOptions(),
                        }
                        : type === 'status'
                            ? {
                                id: newId,
                                type,
                                title: `Nuevo ${type.replace('-', ' ')}`,
                                position: { x: 0, y: 0 },
                                size: { w: defaultWidth, h: defaultHeight },
                                binding: {
                                    mode: 'simulated_value',
                                    simulatedValue: 'running',
                                },
                                displayOptions: createDefaultStatusDisplayOptions(),
                            }
                            : type === 'text-title'
                                ? {
                                    id: newId,
                                    type,
                                    title: 'Texto',
                                    position: { x: 0, y: 0 },
                                    size: { w: defaultWidth, h: defaultHeight },
                                    binding: { mode: 'simulated_value', simulatedValue: 0 },
                                    displayOptions: {
                                        fontSize: DEFAULT_TEXT_TITLE_FONT_SIZE,
                                    },
                                }
                            : {
                                    id: newId,
                                    type,
                                    title: `Nuevo ${type.replace('-', ' ')}`,
                                    position: { x: 0, y: 0 },
                                    size: { w: defaultWidth, h: defaultHeight },
                                    binding: { mode: 'simulated_value', simulatedValue: 0 },
                                };

            const newLayout: WidgetLayout = {
                widgetId: newId,
                x: 0,
                y: 0,
                w: defaultWidth,
                h: defaultHeight,
            };

            setDraft(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    widgets: [...prev.widgets, newWidget],
                    layout: [...prev.layout, newLayout],
                };
            });
            setSelectedWidgetId(newId);
        };

        const handleAddHeaderWidgetFromSlot = (type: WidgetType, slotIndex: number) => {
            if (type !== 'status' && type !== 'connection-status') return;

            const currentSlots = draft.headerConfig?.widgetSlots ?? [];
            if (currentSlots.length >= HEADER_WIDGET_SLOT_COUNT) return;
            if (currentSlots.some(slot => (slot.column ?? currentSlots.indexOf(slot)) === slotIndex)) return;

            const newId = generateWidgetId(type);
            const newWidget: WidgetConfig = type === 'connection-status'
                ? {
                    id: newId,
                    type,
                    title: 'Estado',
                    position: { x: 0, y: 0 },
                    size: { w: 1, h: 1 },
                    binding: { mode: 'simulated_value', simulatedValue: 1 },
                    displayOptions: createDefaultConnectionStatusDisplayOptions(),
                }
                : type === 'status'
                    ? {
                        id: newId,
                        type,
                        title: 'Estado de equipo',
                        position: { x: 0, y: 0 },
                        size: { w: 1, h: 1 },
                        binding: {
                            mode: 'simulated_value',
                            simulatedValue: 'running',
                        },
                        displayOptions: createDefaultStatusDisplayOptions(),
                    }
                    : {
                        id: newId,
                        type,
                        title: 'Conexión',
                        position: { x: 0, y: 0 },
                        size: { w: 1, h: 1 },
                        binding: {
                            mode: 'simulated_value',
                            simulatedValue: 'online',
                        },
                        displayOptions: createDefaultConnectionStatusDisplayOptions(),
                    };

            setDraft(prev => {
                if (!prev) return prev;
                const slots = prev.headerConfig?.widgetSlots ?? [];
                const nextSlots = [...slots, { widgetId: newId, column: slotIndex }];
                return {
                    ...prev,
                    widgets: [...prev.widgets, newWidget],
                    headerConfig: {
                        ...(prev.headerConfig ?? {}),
                        widgetSlots: nextSlots,
                    },
                };
            });
            setSelectedWidgetId(newId);
        };

        const handleDropWidgetAtSlot = (widgetId: string, slotIndex: number) => {
            const widget = draft.widgets.find(item => item.id === widgetId);

            if (!widget || !isHeaderCompatibleWidget(widget)) return;

            const currentSlots = draft.headerConfig?.widgetSlots ?? [];
            const currentSlot = currentSlots.find(slot => slot.widgetId === widgetId);
            const slotTakenByAnotherWidget = currentSlots.some((slot, index) => (
                (slot.column ?? index) === slotIndex && slot.widgetId !== widgetId
            ));

            if (slotTakenByAnotherWidget) return;
            if (!currentSlot && currentSlots.length >= HEADER_WIDGET_SLOT_COUNT) return;

            setIsHeaderDropActive(false);
            setDraggedWidget(null);

            if (currentSlot) {
                handleUpdateHeaderConfig({
                    ...(draft.headerConfig ?? {}),
                    widgetSlots: currentSlots.map((slot) => (
                        slot.widgetId === widgetId
                            ? { ...slot, column: slotIndex }
                            : slot
                    )),
                });

                setSelectedWidgetId(widgetId);
                return;
            }

            handleUpdateHeaderConfig({
                ...(draft.headerConfig ?? {}),
                widgetSlots: [...currentSlots, { widgetId, column: slotIndex }],
            });

            setSelectedWidgetId(widgetId);
        };

        const handlePromoteToHeader = (widgetId: string) => {
            const targetSlot = getFirstFreeHeaderSlot(headerOccupiedColumns);
            if (targetSlot === null) return;
            handleDropWidgetAtSlot(widgetId, targetSlot);
        };

        const handleDuplicateWidget = (widgetId?: string) => {
            const targetWidgetId = widgetId ?? selectedWidgetId;

            if (!targetWidgetId) return;

            const selectedWidget = draft.widgets.find(w => w.id === targetWidgetId);
            const selectedLayout = draft.layout.find(l => l.widgetId === targetWidgetId);
            if (!selectedWidget || !selectedLayout) return;

            const newId = generateWidgetId(selectedWidget.type);
            const duplicatedWidget: WidgetConfig = {
                ...JSON.parse(JSON.stringify(selectedWidget)),
                id: newId,
                title: selectedWidget.title ? `${selectedWidget.title} (Copia)` : undefined,
            };

            const newLayout: WidgetLayout = {
                ...JSON.parse(JSON.stringify(selectedLayout)),
                widgetId: newId,
                y: selectedLayout.y + selectedLayout.h,
            };

            setDraft(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    widgets: [...prev.widgets, duplicatedWidget],
                    layout: [...prev.layout, newLayout],
                };
            });

            setSelectedWidgetId(newId);
        };

        const handleUpdateWidget = (updatedWidget: WidgetConfig) => {
            setDraft(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    widgets: prev.widgets.map(w => w.id === updatedWidget.id ? updatedWidget : w),
                };
            });
        };

        const handleCreateVariable = (name: string, unit: string) => {
            const normalizedName = name.trim();
            const normalizedUnit = unit.trim();

            if (!draft || !selectedWidgetId || !normalizedName || !normalizedUnit) {
                setDialogMessage('Definí una unidad válida antes de crear una variable de catálogo.');
                return;
            }

            const stagedVariable: CatalogVariable = {
                id: `tmp-cv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                name: normalizedName,
                unit: normalizedUnit,
            };

            setStagedVariables((prev) => [...prev, stagedVariable]);
            setDraft((prev) => {
                if (!prev) {
                    return prev;
                }

                return {
                    ...prev,
                    widgets: prev.widgets.map((widget) => {
                        if (widget.id !== selectedWidgetId) {
                            return widget;
                        }

                        return {
                            ...widget,
                            binding: {
                                ...widget.binding,
                                mode: widget.binding?.mode ?? 'simulated_value',
                                catalogVariableId: stagedVariable.id,
                                unit: stagedVariable.unit,
                            },
                        };
                    }),
                };
            });
        };

        const handleRequestVariableDeletion = async (variableId: string) => {
            const selectedVariable = allCatalogVariables.find((variable) => variable.id === variableId);

            if (!selectedVariable) {
                setDialogMessage('La variable seleccionada ya no está disponible.');
                return;
            }

            try {
                const storedAffectedDashboards = await variableCatalogStorage.getAffectedDashboards(variableId);

                if (storedAffectedDashboards.length === 0) {
                    await deleteCatalogVariable(variableId);
                    return;
                }

                const affectedDashboardMap = new Map<string, { id: string; name: string }>(
                    storedAffectedDashboards.map((dashboard) => [dashboard.id, dashboard]),
                );

                if (draft && draft.widgets.some((widget) => widget.binding?.catalogVariableId === variableId)) {
                    affectedDashboardMap.set(draft.id, {
                        id: draft.id,
                        name: draft.name,
                    });
                }

                setVariableDeletionState({
                    variable: selectedVariable,
                    affectedDashboards: Array.from(affectedDashboardMap.values()),
                });
            } catch (error) {
                console.error('Error consultando dashboards afectados:', error);
                setDialogMessage('No se pudo validar el impacto de la variable antes de eliminarla.');
            }
        };



        const prepareDashboardForSave = async ({
            dashboard,
            status,
        }: {
            dashboard: Dashboard;
            status: Dashboard['status'];
        }): Promise<Dashboard | null> => {
            const catalogAwareWidgets = dashboard.widgets.filter((widget) => supportsCatalogVariable(widget.type));

            const widgetRequiringCatalogVariable = catalogAwareWidgets.find((widget) => {
                const unit = widget.binding?.unit;
                return Boolean(unit) && allCatalogVariables.some((catalogVariable) => catalogVariable.unit === unit) && !widget.binding?.catalogVariableId;
            });

            if (widgetRequiringCatalogVariable) {
                const widgetTitle = widgetRequiringCatalogVariable.title || widgetRequiringCatalogVariable.id;
                const unit = widgetRequiringCatalogVariable.binding?.unit;
                setDialogMessage(`El widget "${widgetTitle}" tiene unidad ${unit} que requiere variable. Seleccioná una variable del catálogo.`);
                return null;
            }

            const hierarchyWidgets = catalogAwareWidgets.filter((widget) => widget.hierarchyMode);
            const missingHierarchyVariable = hierarchyWidgets.some((widget) => !widget.binding?.catalogVariableId);

            if (missingHierarchyVariable) {
                setDialogMessage('Todos los widgets en modo jerárquico requieren una variable de catálogo.');
                return null;
            }

            const currentCatalogIds = catalogAwareWidgets
                .map((widget) => widget.binding?.catalogVariableId)
                .filter((catalogVariableId): catalogVariableId is string => Boolean(catalogVariableId));

            if (new Set(currentCatalogIds).size !== currentCatalogIds.length) {
                setDialogMessage('No se permite duplicar la misma variable en un mismo dashboard.');
                return null;
            }

            let nextDashboard: Dashboard = { ...dashboard, status };

            if (stagedVariables.length > 0) {
                const stagedIdMap = new Map<string, string>();
                const persistedVariables: CatalogVariable[] = [];

                for (const stagedVariable of stagedVariables) {
                    const persistedVariable: CatalogVariable = {
                        ...stagedVariable,
                        id: buildCatalogVariableId(stagedVariable.name, stagedVariable.unit),
                    };

                    await variableCatalogStorage.create(persistedVariable);
                    stagedIdMap.set(stagedVariable.id, persistedVariable.id);
                    persistedVariables.push(persistedVariable);
                }

                nextDashboard = {
                    ...nextDashboard,
                    widgets: nextDashboard.widgets.map((widget) => {
                        const currentCatalogVariableId = widget.binding?.catalogVariableId;
                        if (!widget.binding || !currentCatalogVariableId || !stagedIdMap.has(currentCatalogVariableId)) {
                            return widget;
                        }

                        const persistedCatalogVariableId = stagedIdMap.get(currentCatalogVariableId);
                        return {
                            ...widget,
                            binding: {
                                ...widget.binding,
                                catalogVariableId: persistedCatalogVariableId,
                            },
                        };
                    }),
                };

                setCatalogVariables((prev) => [...prev, ...persistedVariables]);
                setStagedVariables([]);
            }

            const persistedHierarchyIds = nextDashboard.widgets
                .filter((widget) => supportsCatalogVariable(widget.type))
                .map((widget) => widget.binding?.catalogVariableId)
                .filter((catalogVariableId): catalogVariableId is string => Boolean(catalogVariableId));

            if (new Set(persistedHierarchyIds).size !== persistedHierarchyIds.length) {
                setDialogMessage('No se permite duplicar la misma variable en un mismo dashboard.');
                return null;
            }

            const refreshedCatalog = await variableCatalogStorage.getAll();
            setCatalogVariables(refreshedCatalog);

            return nextDashboard;
        };

        const handleUpdateLayout = (updatedLayout: WidgetLayout) => {
            setDraft(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    layout: prev.layout.map(l => l.widgetId === updatedLayout.widgetId ? updatedLayout : l),
                };
            });
        };

        const handleResizeLayout = (widgetId: string, w: number, h: number) => {
            setDraft(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    layout: prev.layout.map(l => l.widgetId === widgetId ? { ...l, w, h } : l),
                };
            });
        };

        const handleDeleteWidget = (widgetId?: string) => {
            const targetWidgetId = widgetId ?? selectedWidgetId;

            if (!targetWidgetId) return;

            setDraft(prev => {
                if (!prev) return prev;

                const nextHeaderSlots = (prev.headerConfig?.widgetSlots ?? []).filter(slot => slot.widgetId !== targetWidgetId);

                return {
                    ...prev,
                    widgets: prev.widgets.filter(w => w.id !== targetWidgetId),
                    layout: prev.layout.filter(l => l.widgetId !== targetWidgetId),
                    headerConfig: {
                        ...(prev.headerConfig ?? {}),
                        widgetSlots: nextHeaderSlots,
                    },
                };
            });
            setSelectedWidgetId(current => current === targetWidgetId ? undefined : current);
        };

        mainScrollable = true;
        contextBar = (
            <div className="flex w-full min-w-0 items-center justify-between gap-3 px-4">
                <div className="flex min-w-0 items-center gap-3">
                    {draft.ownerNodeId ? (
                        <AdminTag label="ASIGNADO" variant="cyan" />
                    ) : (
                        <AdminTag label="SIN ASIGNAR" variant="muted" />
                    )}
                    {ownerNode && (
                        <AdminTag label={resolveTypeLabel(ownerNode.type)} variant="muted" />
                    )}
                    {ownerNodeBreadcrumbs.length > 0 && (
                        <nav className="flex min-w-0 items-center gap-1 overflow-hidden uppercase text-industrial-muted">
                            {ownerNodeBreadcrumbs.map((ancestor, idx) => (
                                <span key={ancestor.id} className="flex min-w-0 items-center gap-1">
                                    {idx > 0 && <ChevronRight size={10} className="shrink-0 opacity-40" />}
                                    <span className={`truncate ${idx === ownerNodeBreadcrumbs.length - 1 ? 'text-white/80' : ''}`}>
                                        {ancestor.name}
                                    </span>
                                </span>
                            ))}
                        </nav>
                    )}
                    <AdminTag
                        label={visualStatus === 'pending' ? 'PENDING' : visualStatus === 'published' ? 'PUBLISHED' : 'DRAFT'}
                        variant={visualStatus === 'pending' ? 'amber' : visualStatus === 'published' ? 'green' : 'muted'}
                    />
                    {!draft.ownerNodeId && (
                        <ContextBarNotice icon={AlertTriangle} label="Dashboard sin nodo asignado" />
                    )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    {isDirty && (
                        <ContextBarNotice icon={AlertCircle} label="Cambios sin guardar" />
                    )}
                    <AdminActionButton
                        onClick={handleSaveDraft}
                        disabled={!isDirty || isSaving}
                        variant="secondary"
                    >
                        {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        {isAssigned && draft.status === 'published' ? 'Guardar Cambios' : 'Guardar Draft'}
                    </AdminActionButton>
                    {isAssigned && (
                        <AdminActionButton
                            onClick={handlePublish}
                            disabled={isSaving || (visualStatus === 'published' && !isDirty)}
                            variant="primary"
                        >
                            {isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
                            Publicar
                        </AdminActionButton>
                    )}
                </div>
            </div>
        );

        rail = <WidgetCatalogRail onAddWidget={handleAddWidget} />;
        sidePanel = (
            <PropertyDock
                selectedWidget={selectedWidget}
                selectedLayout={selectedWidgetLayout}
                onUpdateWidget={handleUpdateWidget}
                onUpdateLayout={handleUpdateLayout}
                equipmentMap={equipmentMap}
                machines={machines}
                dataLoading={dataLoading}
                dataError={dataError}
                dataEnabled={dataEnabled}
                catalogVariables={allCatalogVariables}
                usedCatalogVariableIds={usedCatalogVariableIds}
                onCreateVariable={handleCreateVariable}
                onDeleteVariable={handleRequestVariableDeletion}
                onDelete={handleDeleteWidget}
                onDuplicate={handleDuplicateWidget}
                onDeselect={() => setSelectedWidgetId(undefined)}
            />
        );

        content = (
            <div className="flex h-full min-h-0 flex-col bg-[url('/grid.svg')] bg-center">
                <div data-testid="dashboard-builder-content-column" className="flex h-full min-h-0 min-w-0 flex-1 flex-col px-8">
                    <div className="shrink-0 border-b border-white/5 bg-industrial-bg/60 pb-4 pt-2 backdrop-blur-sm">
                        <DashboardHeader
                            mode="preview"
                            dashboard={draft}
                            equipmentMap={equipmentMap}
                            connection={connection}
                            machines={machines}
                            hierarchyContext={hierarchyContext}
                            onTitleChange={handleHeaderTitleChange}
                            onSubtitleChange={handleHeaderSubtitleChange}
                            onHeaderDragEnter={() => setIsHeaderDropActive(Boolean(
                                draggedWidget
                                && isHeaderCompatibleWidgetType(draggedWidget.widgetType)
                                && headerWidgetIds.size < HEADER_WIDGET_SLOT_COUNT,
                            ))}
                            onHeaderDragOver={handleHeaderDragOver}
                            onHeaderDragLeave={() => setIsHeaderDropActive(false)}
                            onHeaderDrop={handleHeaderDrop}
                            onRemoveHeaderWidget={handleRemoveWidgetFromHeader}
                            onDeleteHeaderWidget={handleDeleteWidget}
                            onMoveHeaderWidget={handleMoveHeaderWidget}
                            selectedWidgetId={selectedWidgetId}
                            onSelectHeaderWidget={setSelectedWidgetId}
                            isHeaderDropActive={isHeaderDropActive}
                            canDropHeaderWidget={Boolean(
                                draggedWidget
                                && isHeaderCompatibleWidgetType(draggedWidget.widgetType)
                                && headerWidgetIds.size < HEADER_WIDGET_SLOT_COUNT,
                            )}
                            onAddHeaderWidget={handleAddHeaderWidgetFromSlot}
                            onDropWidgetAtSlot={handleDropWidgetAtSlot}
                        />
                    </div>

                    <div data-testid="dashboard-builder-canvas-viewport" className="flex min-h-0 min-w-0 flex-1 overflow-hidden pt-2 pb-3">
                        <BuilderCanvas
                            layout={draft.layout}
                            widgets={draft.widgets}
                            equipmentMap={equipmentMap}
                            connection={connection}
                            machines={machines}
                            hierarchyContext={hierarchyContext}
                            cols={draft.cols}
                            rows={draft.rows}
                            selectedWidgetId={selectedWidgetId}
                            onWidgetSelect={setSelectedWidgetId}
                            onResize={handleResizeLayout}
                            onLayoutCommit={handleUpdateLayout}
                            onDelete={handleDeleteWidget}
                            onDuplicate={handleDuplicateWidget}
                            onWidgetDragChange={(payload) => {
                                setDraggedWidget(payload);

                                if (!payload || !isHeaderCompatibleWidgetType(payload.widgetType)) {
                                    setIsHeaderDropActive(false);
                                }
                            }}
                            headerWidgetIds={headerWidgetIds}
                            headerOccupiedSlotCount={headerOccupiedColumns.size}
                            onPromoteToHeader={handlePromoteToHeader}
                        />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <>
            <AdminWorkspaceLayout
            mainScrollable={mainScrollable}
            contextBarPanel={contextBarPanel}
            contextBar={contextBar}
            rail={rail}
            sidePanel={sidePanel}
        >
            {content}
            </AdminWorkspaceLayout>

            <AdminDialog
                open={Boolean(dialogMessage)}
                title="Error de operación"
                onClose={() => setDialogMessage(null)}
                actions={(
                    <AdminActionButton variant="primary" onClick={() => setDialogMessage(null)}>
                        Entendido
                    </AdminActionButton>
                )}
            >
                <p className="text-industrial-muted">{dialogMessage}</p>
            </AdminDialog>

            <AdminDestructiveDialog
                open={Boolean(variableDeletionState)}
                title="Eliminar variable"
                onClose={handleCancelVariableDeletion}
                onConfirm={handleConfirmVariableDeletion}
                warningMessage="Esta variable se usa en otros dashboards."
                affectedLabel="Dashboards afectados"
                affectedItems={variableDeletionState?.affectedDashboards.map(d => ({ name: d.name, id: d.id })) ?? []}
                confirmMessage='Los widgets afectados van a mostrar "Sin datos" hasta que se les asigne una nueva variable manualmente. ¿Confirmar?'
                disabled={isSaving}
            />

            <AdminDialog
                open={blocker.state === 'blocked'}
                title="Cambios sin guardar"
                onClose={() => blocker.reset?.()}
                actions={(
                    <>
                        <AdminActionButton variant="primary" onClick={() => blocker.reset?.()}>
                            Quedarse
                        </AdminActionButton>
                        <AdminActionButton variant="secondary" onClick={() => blocker.proceed?.()}>
                            Salir sin guardar
                        </AdminActionButton>
                    </>
                )}
            >
                <div className="flex items-start gap-2 rounded-md border border-status-warning bg-status-warning/10 px-3 py-2.5">
                    <AlertTriangle size={16} className="shrink-0 text-status-warning" />
                    <p className="text-industrial-muted">Tenés cambios sin guardar en este dashboard. Si salís ahora, los cambios se perderán.</p>
                </div>
            </AdminDialog>

        </>
    );
}

interface VariableDeletionState {
    variable: CatalogVariable;
    affectedDashboards: Array<{
        id: string;
        name: string;
    }>;
}

function buildCatalogVariableId(name: string, unit: string): string {
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
