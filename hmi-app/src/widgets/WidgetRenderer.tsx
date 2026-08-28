import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { ViewerPersistedWidgetDisplayPatch, WidgetConfig } from '../domain/admin.types';
import type { EquipmentSummary } from '../domain/equipment.types';
import type { ContractMachine, ConnectionHealth } from '../domain/dataContract.types';
import type { HierarchyContext } from './resolvers/hierarchyResolver';
import type { WidgetPresentationEntry } from '../domain/dashboardPresentation.types';
import MetricWidget from './renderers/MetricWidget';
import StatusWidget from './renderers/StatusWidget';
import ConnectionStatusWidget from './renderers/ConnectionStatusWidget';
import TrendChartWidget from './renderers/TrendChartWidget';
import TrendChartV2Widget from './renderers/TrendChartV2Widget';
import KpiWidget from './renderers/KpiWidget';
import MachineActivityWidget from './renderers/MachineActivityWidget';
import ActivityAnalyticsWidget from './renderers/ActivityAnalyticsWidget';
import ProdTrendWidget from './renderers/ProdTrendWidget';
import AlertHistoryWidget from './renderers/AlertHistoryWidget';
import ProdHistoryWidget from './renderers/ProduccionHistoricaWidget';
import TextTitleWidget from './renderers/TextTitleWidget';
import InfoCardWidget from './renderers/InfoCardWidget';
import type { TrendChartV2RenderContext } from './renderers/trendChartV2RenderContext';
import { hasNestedInteractiveNavigationForConfig } from '../utils/widgetCapabilities';
import WidgetRuntimeState from '../components/ui/WidgetRuntimeState';

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
    isLoadingOverview?: boolean;
    hasOverviewError?: boolean;
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
    onPersistWidgetDisplayOptions?: (widgetId: string, displayOptions: ViewerPersistedWidgetDisplayPatch) => void;
    onNavigateDashboard?: (dashboardId: string) => void;
    renderContext?: TrendChartV2RenderContext;
    presentationEntry?: WidgetPresentationEntry;
}

const DATA_PRESENTATION_CAPABILITIES = new Set(['activity-analytics', 'prod-trend', 'production-history', 'machine-activity', 'alert-history']);
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
    isLoadingOverview = false,
    hasOverviewError = false,
    isLoadingData = false,
    className,
    siblingWidgets,
    hierarchyContext,
    onPersistWidgetDisplayOptions,
    onNavigateDashboard,
    renderContext,
    presentationEntry,
}: WidgetRendererProps) {
    if (presentationEntry && !DATA_PRESENTATION_CAPABILITIES.has(presentationEntry.capability) && presentationEntry.capability !== 'legacy-presentation') {
        return presentationEntry.capability === 'unsupported'
            ? <UnsupportedWidget type={presentationEntry.widgetType} />
            : <div className={`glass-panel flex h-full w-full flex-col justify-center p-4 ${className ?? ''}`} data-testid={`presentation-widget-${presentationEntry.widgetId}`}>
                <span className="truncate uppercase text-industrial-muted">{presentationEntry.widget.title ?? presentationEntry.widgetType}</span>
                <span className="text-industrial-text">{presentationEntry.payload.value == null ? '—' : String(presentationEntry.payload.value)}{presentationEntry.payload.unit ? ` ${presentationEntry.payload.unit}` : ''}</span>
            </div>;
    }

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
                    presentationData={presentationEntry?.payload.data}
                />
            );
            break;

        case 'activity-analytics':
            renderedWidget = (
                <ActivityAnalyticsWidget
                    widget={widget}
                    machines={machines}
                    connection={connection}
                    isLoadingOverview={isLoadingOverview}
                    hasOverviewError={hasOverviewError}
                    isLoadingData={isLoadingData}
                    className={className}
                    siblingWidgets={siblingWidgets}
                    onPersistDisplayOptions={(displayOptions) => onPersistWidgetDisplayOptions?.(widget.id, displayOptions)}
                    presentationData={presentationEntry?.payload.data}
                />
            );
            break;

        case 'prod-trend':
            renderedWidget = (
                <ProdTrendWidget
                    widget={widget}
                    machines={machines}
                    connection={connection}
                    isLoadingOverview={isLoadingOverview}
                    hasOverviewError={hasOverviewError}
                    isLoadingData={isLoadingData}
                    className={className}
                    presentationData={presentationEntry?.payload.data}
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
                    renderContext={renderContext}
                    siblingWidgets={siblingWidgets}
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
                    onPersistDisplayOptions={(displayOptions) => onPersistWidgetDisplayOptions?.(widget.id, displayOptions)}
                    presentationData={presentationEntry?.payload.data}
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
                    presentationData={presentationEntry?.payload.data}
                />
            );
            break;

        case 'text-title':
            renderedWidget = <TextTitleWidget widget={widget} className={className} />;
            break;

        case 'info-card':
            renderedWidget = <InfoCardWidget widget={widget} className={className} />;
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
    const supportsWrapperKeyboardNavigation = !hasNestedInteractiveNavigationForConfig(widget);

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
function UnsupportedWidget({ type }: { type: string; title?: string }) {
    return (
        <div className="glass-panel group flex h-full w-full items-center justify-center p-4">
            <WidgetRuntimeState
                state="invalid-config"
                labelOverride="Widget no soportado"
                testId={`unsupported-widget-${type}`}
            />
        </div>
    );
}
