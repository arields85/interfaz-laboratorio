import type { ReactNode } from 'react';
import type { ViewerPersistedWidgetDisplayPatch, WidgetConfig } from '../../domain/admin.types';
import type { ConnectionHealth, ContractMachine } from '../../domain/dataContract.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import { getWidgetPresentationCapability } from '../../utils/widgetCapabilities';
import type { PresentationControllerProps } from '../../widgets/controllers/PresentationControllers';
import {
    ConnectionPresentationController, LegacyPresentationController, ScalarPresentationController,
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
    static: StaticPresentationController,
    'legacy-presentation': LegacyPresentationController,
} as const;

export default function WidgetPresentationBoundary(props: WidgetPresentationBoundaryProps) {
    const capability = getWidgetPresentationCapability(props.widget.type);
    const Controller = capability && capability !== 'unsupported'
        ? CONTROLLERS[capability]
        : UnsupportedPresentationController;
    const controllerProps: PresentationControllerProps = {
        ...props,
        render: (entry) => <WidgetRenderer {...props} presentationEntry={entry} />,
    };
    return <Controller {...controllerProps} /> as ReactNode;
}
