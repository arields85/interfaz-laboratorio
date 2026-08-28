import type { ReactNode } from 'react';
import type { ViewerPersistedWidgetDisplayPatch, WidgetConfig } from '../../domain/admin.types';
import type { ConnectionHealth, ContractMachine } from '../../domain/dataContract.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import { getWidgetPresentationCapability } from '../../utils/widgetCapabilities';
import type { PresentationControllerProps } from '../../widgets/controllers/PresentationControllers';
import type { WidgetPresentationEntry } from '../../domain/dashboardPresentation.types';
import {
    ActivityAnalyticsPresentationController, AlertHistoryPresentationController, ConnectionPresentationController, MachineActivityPresentationController, ProdTrendPresentationController, ProductionHistoryPresentationController, ScalarPresentationController,
    StaticPresentationController, StatusPresentationController, TrendChartController, TrendChartV2Controller,
    UnsupportedPresentationController,
} from '../../widgets/controllers/PresentationControllers';
import WidgetRenderer from '../../widgets/WidgetRenderer';
import type { TrendChartV2RenderContext } from '../../widgets/renderers/trendChartV2RenderContext';
import type { HierarchyContext } from '../../widgets/resolvers/hierarchyResolver';

interface WidgetPresentationBoundaryProps {
    widget: WidgetConfig;
    equipmentMap: Map<string, EquipmentSummary>;
    machines?: ContractMachine[];
    connection?: ConnectionHealth;
    className?: string;
    renderEntry?: (entry: WidgetPresentationEntry) => ReactNode;
    isLoadingOverview?: boolean;
    hasOverviewError?: boolean;
    isLoadingData?: boolean;
    siblingWidgets?: WidgetConfig[];
    hierarchyContext?: HierarchyContext;
    onPersistWidgetDisplayOptions?: (widgetId: string, displayOptions: ViewerPersistedWidgetDisplayPatch) => void;
    onNavigateDashboard?: (dashboardId: string) => void;
    renderContext?: TrendChartV2RenderContext;
}

const CONTROLLERS = {
    scalar: ScalarPresentationController,
    status: StatusPresentationController,
    connection: ConnectionPresentationController,
    'trend-chart': TrendChartController,
    'trend-chart-v2': TrendChartV2Controller,
    'production-history': ProductionHistoryPresentationController,
    'machine-activity': MachineActivityPresentationController,
    static: StaticPresentationController,
    'activity-analytics': ActivityAnalyticsPresentationController,
    'prod-trend': ProdTrendPresentationController,
    'alert-history': AlertHistoryPresentationController,
} as const;

export default function WidgetPresentationBoundary(props: WidgetPresentationBoundaryProps) {
    const capability = getWidgetPresentationCapability(props.widget.type);
    const Controller = capability === undefined || capability === 'unsupported'
        ? UnsupportedPresentationController
        : CONTROLLERS[capability];
    const controllerProps: PresentationControllerProps = {
        ...props,
        render: (entry) => props.renderEntry?.(entry) ?? <WidgetRenderer {...props} presentationEntry={entry} />,
    };
    return <Controller {...controllerProps} /> as ReactNode;
}
