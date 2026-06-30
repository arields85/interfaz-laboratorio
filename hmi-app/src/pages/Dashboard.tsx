import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, Loader2, Link2Off } from 'lucide-react';
import { dashboardStorage } from '../services/DashboardStorageService';
import { hierarchyStorage } from '../services/HierarchyStorageService';
import type { ActivityAnalyticsPersistedDisplayPatch, Dashboard, HierarchyNode } from '../domain/admin.types';
import DashboardViewer from '../components/viewer/DashboardViewer';
import DashboardHeader from '../components/viewer/DashboardHeader';
import { mockEquipmentList } from '../mocks/equipment.mock';
import type { EquipmentSummary } from '../domain/equipment.types';
import { useDataOverview } from '../queries/useDataOverview';
import type { HierarchyContext } from '../widgets/resolvers/hierarchyResolver';
import { resetShieldContentReady, signalShieldContentReady } from '../shield/shieldContentReadiness';

// =============================================================================
// Dashboard Público (Visor)
// Punto de entrada de la aplicación (/ruta raíz).
// Carga dinámicamente los dashboards con `status === 'published'`.
//
// El header es ahora un componente dedicado (DashboardHeader) que consume
// `dashboard.headerConfig` para título, subtítulo y widget slots.
// Los widgets asignados al header se excluyen del grid via `headerWidgetIds`.
//
// Especificación Funcional Modo Admin §11
// =============================================================================

export default function Dashboard() {
    const [allDashboards, setAllDashboards] = useState<Dashboard[]>([]);
    const [publishedDashboards, setPublishedDashboards] = useState<Dashboard[]>([]);
    const [allNodes, setAllNodes] = useState<HierarchyNode[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [activeTab, setActiveTab] = useState(0);
    const { connection, machines } = useDataOverview();

    // Mapeo de equipos simulado (para resolver bindings)
    const equipmentMap = useMemo(() => {
        const list = mockEquipmentList;
        const map = new Map<string, EquipmentSummary>();
        list.forEach((eq: EquipmentSummary) => map.set(eq.id, { 
            id: eq.id, 
            name: eq.name, 
            status: eq.status, 
            type: eq.type, 
            primaryMetrics: eq.primaryMetrics.map((metric) => ({
                id: metric.label,
                label: metric.label,
                value: metric.value,
                unit: metric.unit,
                status: 'normal',
                timestamp: new Date().toISOString()
            })),
            connectionState: eq.connectionState 
        }));
        return map;
    }, []);

    useEffect(() => {
        resetShieldContentReady();

        const loadPublished = async () => {
            setIsLoading(true);
            setLoadFailed(false);
            try {
                const [all, nodes] = await Promise.all([
                    dashboardStorage.getDashboards(),
                    hierarchyStorage.getNodes(),
                ]);
                const published = all.filter(d => d.status === 'published');
                setAllDashboards(all);
                setPublishedDashboards(published);
                setAllNodes(nodes);
            } catch (error) {
                setLoadFailed(true);
                setAllDashboards([]);
                setPublishedDashboards([]);
                setAllNodes([]);
                console.error("Error cargando dashboards públicos:", error);
            } finally {
                setIsLoading(false);
            }
        };
        loadPublished();

        return () => {
            resetShieldContentReady();
        };
    }, []);

    // Si la cantidad de tabs publicados cambia y el índice actual queda fuera
    // de rango, se normaliza al primer dashboard disponible.
    useEffect(() => {
        if (publishedDashboards.length === 0) {
            if (activeTab !== 0) setActiveTab(0);
            return;
        }

        if (activeTab >= publishedDashboards.length) {
            setActiveTab(0);
        }
    }, [activeTab, publishedDashboards.length]);

    const rawActiveDashboard = publishedDashboards[activeTab] ?? publishedDashboards[0];

    // Si el dashboard tiene publishedSnapshot, el viewer muestra esa versión congelada
    // en vez de la working copy (que puede tener cambios pendientes del admin).
    const activeDashboard = useMemo(() => {
        if (!rawActiveDashboard) return rawActiveDashboard;
        const snap = rawActiveDashboard.publishedSnapshot;
        if (!snap) return rawActiveDashboard;
        return {
            ...rawActiveDashboard,
            aspect: snap.aspect,
            cols: snap.cols,
            rows: snap.rows,
            widgets: snap.widgets,
            layout: snap.layout,
            headerConfig: snap.headerConfig,
        };
    }, [rawActiveDashboard]);

    const dashboardViewState = isLoading
        ? 'loading'
        : loadFailed
            ? 'error'
            : publishedDashboards.length === 0 || !activeDashboard
            ? 'empty'
            : 'viewer';

    useEffect(() => {
        if (dashboardViewState === 'loading' || dashboardViewState === 'empty' || dashboardViewState === 'error' || dashboardViewState === 'viewer') {
            signalShieldContentReady();
        }
    }, [dashboardViewState]);

    // Calcular los IDs de widgets asignados al header (para excluirlos del grid)
    // Hook ubicado en la zona superior del componente para mantener el orden
    // consistente entre renders (Rules of Hooks).
    const headerWidgetIds = useMemo(() => {
        const slots = activeDashboard?.headerConfig?.widgetSlots ?? [];
        return new Set(slots.map(s => s.widgetId));
    }, [activeDashboard]);

    const hierarchyContext = useMemo<HierarchyContext>(() => ({
        allNodes,
        allDashboards,
        currentNodeId: activeDashboard?.ownerNodeId,
    }), [allNodes, allDashboards, activeDashboard?.ownerNodeId]);

    const handlePersistWidgetDisplayOptions = async (widgetId: string, displayOptions: ActivityAnalyticsPersistedDisplayPatch) => {
        if (!activeDashboard) {
            return;
        }

        const updatedDashboard = await dashboardStorage.persistPublishedWidgetDisplayOptions(activeDashboard.id, widgetId, displayOptions);

        if (!updatedDashboard) {
            return;
        }

        setAllDashboards((previous) => previous.map((dashboard) => dashboard.id === updatedDashboard.id ? updatedDashboard : dashboard));
        setPublishedDashboards((previous) => previous.map((dashboard) => dashboard.id === updatedDashboard.id ? updatedDashboard : dashboard));
    };

    const handleNavigateDashboard = (dashboardId: string) => {
        const nextIndex = publishedDashboards.findIndex((dashboard) => dashboard.id === dashboardId);

        if (nextIndex >= 0) {
            setActiveTab(nextIndex);
        }
    };

    const renderNoPublishedState = () => (
        <div className="h-full flex flex-col items-center justify-center text-industrial-muted space-y-4">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-2">
                <Link2Off size={32} className="text-industrial-muted/50" />
            </div>
            <h2 className="text-white">Sin Vistas Publicadas</h2>
            <p className="text-center max-w-sm">
                No hay ningún dashboard operativo configurado como público.
                Contacte a un administrador para publicar una vista desde el Gestor de Dashboards.
            </p>
        </div>
    );

    const renderLoadErrorState = () => (
        <div
            role="alert"
            className="h-full flex flex-col items-center justify-center text-industrial-muted space-y-4"
        >
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-2">
                <AlertTriangle size={32} className="text-industrial-muted/50" />
            </div>
            <h2 className="text-white">No se pudieron cargar los dashboards públicos.</h2>
            <p className="text-center max-w-sm">
                Reintentá desde el navegador o contactá a un administrador si el problema persiste.
            </p>
        </div>
    );

    if (isLoading) {
        return (
            <div className="h-full flex items-center justify-center text-industrial-muted gap-3">
                <Loader2 className="animate-spin" size={24} />
                <span className="uppercase">Iniciando Visor Operativo...</span>
            </div>
        );
    }

    if (loadFailed) {
        return renderLoadErrorState();
    }

    if (publishedDashboards.length === 0) {
        return renderNoPublishedState();
    }

    if (!activeDashboard) {
        return renderNoPublishedState();
    }

    return (
        <div className="flex flex-col h-full space-y-4 px-2 overflow-hidden">

            {/* HEADER CONFIGURADO DESDE dashboard.headerConfig */}
            <DashboardHeader
                dashboard={activeDashboard}
                equipmentMap={equipmentMap}
                connection={connection}
                machines={machines}
                onNavigateDashboard={handleNavigateDashboard}
                hierarchyContext={hierarchyContext}
            />

            {/* GRID DEL DASHBOARD — widgets del header excluidos */}
            <div className="flex-1 bg-[url('/grid.svg')] bg-center rounded-xl border border-white/5 overflow-hidden">
                <DashboardViewer 
                    widgets={activeDashboard.widgets}
                    layout={activeDashboard.layout}
                    equipmentMap={equipmentMap}
                    machines={machines}
                    connection={connection}
                    headerWidgetIds={headerWidgetIds}
                    hierarchyContext={hierarchyContext}
                    cols={activeDashboard.cols}
                    rows={activeDashboard.rows}
                    onPersistWidgetDisplayOptions={handlePersistWidgetDisplayOptions}
                    onNavigateDashboard={handleNavigateDashboard}
                />
            </div>
        </div>
    );
}
