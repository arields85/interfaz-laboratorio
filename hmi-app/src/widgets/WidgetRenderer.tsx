import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { ActivityAnalyticsPersistedDisplayPatch, WidgetConfig } from '../domain/admin.types';
import type { EquipmentSummary } from '../domain/equipment.types';
import type { ContractMachine, ConnectionHealth } from '../domain/dataContract.types';
import type { HierarchyContext } from './resolvers/hierarchyResolver';
import MetricWidget from './renderers/MetricWidget';
import StatusWidget from './renderers/StatusWidget';
import ConnectionStatusWidget from './renderers/ConnectionStatusWidget';
import TrendChartWidget from './renderers/TrendChartWidget';
import TrendChartV2Widget from './renderers/TrendChartV2Widget';
import KpiWidget from './renderers/KpiWidget';
import MachineActivityWidget from './renderers/MachineActivityWidget';
import ActivityAnalyticsWidget from './renderers/ActivityAnalyticsWidget';
import AlertHistoryWidget from './renderers/AlertHistoryWidget';
import ProdHistoryWidget from './renderers/ProduccionHistoricaWidget';
import TextTitleWidget from './renderers/TextTitleWidget';
import { hasNestedInteractiveNavigation } from '../utils/widgetCapabilities';

// =============================================================================
// WidgetRenderer — Dispatcher central
//
// Recibe un WidgetConfig y delega al renderer específico según widget.type.
// Esta es la única interfaz pública que consumen las páginas y el builder.
// Las páginas no importan renderers individuales.
//
// Tipos soportados:
//   'metric-card', 'kpi'        → MetricWidget / KpiWidget
//   'status'                    → StatusWidget
//   'connection-status'         → ConnectionStatusWidget
//   'trend-chart', 'trend-chart-v2' → TrendChartWidget / TrendChartV2Widget
//   'prod-history'              → ProdHistoryWidget
//   'alert-history'             → AlertHistoryWidget
//
// Para 'alert-history' se necesita la prop opcional `siblingWidgets`
// con los demás widgets del mismo dashboard para detectar cambios de estado.
//
// Arquitectura Técnica v1.3 §16 (niveles de componentes)
// =============================================================================

interface WidgetRendererProps {
    widget: WidgetConfig;
    equipmentMap: Map<string, EquipmentSummary>;
    machines?: ContractMachine[];
    connection?: ConnectionHealth;
    isLoadingData?: boolean;
    className?: string;
    /**
     * Todos los widgets del mismo dashboard.
     * Requerido para que AlertHistoryWidget pueda evaluar a sus hermanos.
     * Ignorado por todos los demás renderers.
     */
    siblingWidgets?: WidgetConfig[];
    /**
     * Contexto jerárquico para resolver widgets en modo jerárquico.
     * Contiene todos los nodos, dashboards y el nodo actual.
     * Ignorado por renderers que no soportan modo jerárquico.
     */
    hierarchyContext?: HierarchyContext;
    onPersistWidgetDisplayOptions?: (widgetId: string, displayOptions: ActivityAnalyticsPersistedDisplayPatch) => void;
    onNavigateDashboard?: (dashboardId: string) => void;
}

const NAVIGATION_INTERACTIVE_SELECTOR = [
    'button',
    'a',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[data-widget-navigation-ignore="true"]',
].join(', ');

function shouldIgnoreNavigationTarget(target: EventTarget | null, currentTarget: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
        return false;
    }

    const interactiveAncestor = target.closest(NAVIGATION_INTERACTIVE_SELECTOR);

    return interactiveAncestor != null && interactiveAncestor !== currentTarget;
}

export default function WidgetRenderer({
    widget,
    equipmentMap,
    machines,
    connection,
    isLoadingData = false,
    className,
    siblingWidgets,
    hierarchyContext,
    onPersistWidgetDisplayOptions,
    onNavigateDashboard,
}: WidgetRendererProps) {
    let renderedWidget: ReactNode;

    switch (widget.type) {
        case 'metric-card':
            renderedWidget = (
                <MetricWidget
                    widget={widget}
                    equipmentMap={equipmentMap}
                    machines={machines}
                    isLoadingData={isLoadingData}
                    className={className}
                    hierarchyContext={hierarchyContext}
                />
            );
            break;

        case 'kpi':
            renderedWidget = (
                <KpiWidget
                    widget={widget}
                    equipmentMap={equipmentMap}
                    machines={machines}
                    isLoadingData={isLoadingData}
                    className={className}
                />
            );
            break;

        case 'machine-activity':
            renderedWidget = (
                <MachineActivityWidget
                    widget={widget}
                    equipmentMap={equipmentMap}
                    machines={machines}
                    isLoadingData={isLoadingData}
                    className={className}
                />
            );
            break;

        case 'activity-analytics':
            renderedWidget = (
                <ActivityAnalyticsWidget
                    widget={widget}
                    machines={machines}
                    isLoadingData={isLoadingData}
                    className={className}
                    onPersistDisplayOptions={(displayOptions) => onPersistWidgetDisplayOptions?.(widget.id, displayOptions)}
                />
            );
            break;

        case 'status':
            renderedWidget = (
                <StatusWidget
                    widget={widget}
                    equipmentMap={equipmentMap}
                    className={className}
                />
            );
            break;

        case 'connection-status':
            renderedWidget = (
                <ConnectionStatusWidget
                    widget={widget}
                    equipmentMap={equipmentMap}
                    machines={machines}
                    connection={connection}
                    className={className}
                />
            );
            break;

        case 'trend-chart':
            renderedWidget = (
                <TrendChartWidget
                    widget={widget}
                    equipmentMap={equipmentMap}
                    machines={machines}
                    isLoadingData={isLoadingData}
                    className={className}
                />
            );
            break;

        case 'trend-chart-v2':
            renderedWidget = (
                <TrendChartV2Widget
                    widget={widget}
                    equipmentMap={equipmentMap}
                    machines={machines}
                    isLoadingData={isLoadingData}
                    className={className}
                />
            );
            break;

        case 'prod-history':
            renderedWidget = (
                <ProdHistoryWidget
                    widget={widget}
                    equipmentMap={equipmentMap}
                    isLoadingData={isLoadingData}
                    className={className}
                />
            );
            break;

        case 'alert-history':
            renderedWidget = (
                <AlertHistoryWidget
                    widget={widget}
                    equipmentMap={equipmentMap}
                    machines={machines}
                    siblingWidgets={siblingWidgets}
                    className={className}
                />
            );
            break;

        case 'text-title':
            renderedWidget = <TextTitleWidget widget={widget} className={className} />;
            break;

        // -----------------------------------------------------------------------
        // Tipos pendientes de implementación — placeholder elegante.
        // No lanza error: el builder puede incluir tipos futuros en una config
        // sin romper la renderización del dashboard actual.
        // -----------------------------------------------------------------------
        default:
            renderedWidget = (
                <UnsupportedWidget type={widget.type} title={widget.title} />
            );
            break;
    }

    const navigationTargetDashboardId = widget.navigationTargetDashboardId?.trim() ?? '';
    const isViewerNavigable = navigationTargetDashboardId !== '' && Boolean(onNavigateDashboard);
    const supportsWrapperKeyboardNavigation = !hasNestedInteractiveNavigation(widget.type);

    if (!isViewerNavigable) {
        return renderedWidget;
    }

    const handleNavigate = () => {
        onNavigateDashboard?.(navigationTargetDashboardId);
    };

    const handleClick = (event: MouseEvent<HTMLDivElement>) => {
        if (shouldIgnoreNavigationTarget(event.target, event.currentTarget)) {
            return;
        }

        handleNavigate();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        if (shouldIgnoreNavigationTarget(event.target, event.currentTarget)) {
            return;
        }

        event.preventDefault();
        handleNavigate();
    };

    return (
        <div
            role={supportsWrapperKeyboardNavigation ? 'button' : undefined}
            tabIndex={supportsWrapperKeyboardNavigation ? 0 : undefined}
            aria-label={supportsWrapperKeyboardNavigation ? (widget.title?.trim() || widget.type) : undefined}
            className="h-full w-full cursor-pointer rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-accent/40"
            onClick={handleClick}
            onKeyDown={supportsWrapperKeyboardNavigation ? handleKeyDown : undefined}
        >
            {renderedWidget}
        </div>
    );
}

// -----------------------------------------------------------------------------
// UnsupportedWidget — placeholder para tipos no implementados aún
// -----------------------------------------------------------------------------
function UnsupportedWidget({ type, title }: { type: string; title?: string }) {
    return (
        <div className="glass-panel p-4 flex flex-col gap-1 opacity-50">
            <span className="uppercase text-industrial-muted">
                Widget no implementado
            </span>
            <span className="text-industrial-muted font-mono">
                type: {type}
            </span>
            {title && <span className="text-slate-500">{title}</span>}
        </div>
    );
}
