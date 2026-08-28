import type { StatusDisplayOptions, WidgetConfig } from '../../domain/admin.types';
import type { PresentationPayload } from '../../domain/dashboardPresentation.types';
import type { EquipmentSummary, EquipmentStatus } from '../../domain/equipment.types';
import StatusBadge from '../../components/ui/StatusBadge';
import { WidgetHeaderDataMode } from '../../components/ui/WidgetHeader';
import { normalizeSimulatedEquipmentStatus, resolveStatusLabel } from '../../utils/statusWidget';
import { resolveWidgetDataMode } from '../../utils/widgetDataMode';

// =============================================================================
// StatusWidget
// Renderer para widgets de tipo 'status'.
// Traduce WidgetConfig + datos del dominio → StatusBadge.
//
// El binding para StatusWidget es semánticamente diferente al de MetricWidget:
// no resuelve un valor numérico — resuelve un EquipmentStatus directamente
// desde el equipo indicado en binding.assetId.
//
// Si assetId no está en equipmentMap → StatusBadge status="unknown".
// =============================================================================

interface StatusWidgetProps {
    widget: WidgetConfig;
    equipmentMap: Map<string, EquipmentSummary>;
    compact?: boolean;
    className?: string;
    presentationData?: PresentationPayload;
}

export default function StatusWidget({
    widget,
    equipmentMap,
    compact = false,
    className,
    presentationData,
}: StatusWidgetProps) {
    const options = widget.displayOptions as StatusDisplayOptions | undefined;
    const binding = widget.binding;

    const status = presentationData?.status !== undefined || presentationData?.value !== undefined
        ? (presentationData.status ?? presentationData.value) as EquipmentStatus
        : binding?.mode === 'simulated_value'
            ? normalizeSimulatedEquipmentStatus(binding.simulatedValue)
            : (() => {
                const assetId = binding?.assetId;
                const equipment = assetId ? equipmentMap.get(assetId) : undefined;
                return equipment?.status ?? 'unknown';
            })();

    const label = resolveStatusLabel(status, options);
    const dataMode = resolveWidgetDataMode(widget);

    return (
        <div className={`relative w-full h-full flex items-center justify-center gap-2 glass-panel group ${className ?? ''}`}>
            <StatusBadge status={status} label={label} compact={compact} />
            <WidgetHeaderDataMode
                dataMode={dataMode}
                dataModeTestId="status-widget-data-mode"
                withLeadingSeparator
            />
        </div>
    );
}
