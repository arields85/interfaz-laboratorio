import type { MetricCardWidgetConfig } from '../../domain/admin.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import type { ContractMachine } from '../../domain/dataContract.types';
import MetricCard from '../../components/ui/MetricCard';
import ConnectionBadge from '../../components/ui/ConnectionBadge';
import { resolveBinding } from '../resolvers/bindingResolver';
import { buildHierarchyAggregationTrace, type HierarchyContext } from '../resolvers/hierarchyResolver';
import { toCardStatus } from '../resolvers/thresholdEvaluator';
import { resolveActivityAnalyticsDonutCenterValueFontSize } from '../../utils/activityAnalyticsWidgetDefaults';
import { Gauge, Activity, Thermometer, Zap, Droplet, Wind, Settings, Fan, FoldVertical, HelpCircle, HeartPulse, Siren, Wifi, BarChart2, LineChart, type LucideIcon } from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
    'Gauge': Gauge,
    'Activity': Activity,
    'Thermometer': Thermometer,
    'Zap': Zap,
    'Droplet': Droplet,
    'Wind': Wind,
    'Settings': Settings,
    'Fan': Fan,
    'FoldVertical': FoldVertical,
    'HeartPulse': HeartPulse,
    'Siren': Siren,
    'Wifi': Wifi,
    'BarChart2': BarChart2,
    'LineChart': LineChart,
};
// =============================================================================
// MetricWidget
// Renderer para widgets de tipo 'metric-card' y 'kpi'.
// Traduce WidgetConfig + datos del dominio → props de MetricCard.
//
// Esta capa es responsable de:
// - Resolver el binding (real o simulado) vía bindingResolver
// - Mapear ResolvedBinding → props de MetricCard
// - Gestionar los estados stale y no-data sin acoplar lógica al componente base
// - Mostrar ConnectionBadge cuando la fuente tiene estado de conectividad relevante
//
// MetricCard NO sabe de dónde vienen los datos. Solo renderiza lo que recibe.
// =============================================================================

interface MetricWidgetProps {
    widget: MetricCardWidgetConfig;
    equipmentMap: Map<string, EquipmentSummary>;
    machines?: ContractMachine[];
    isLoadingData?: boolean;
    className?: string;
    hierarchyContext?: HierarchyContext;
}

export default function MetricWidget({
    widget,
    equipmentMap,
    machines,
    isLoadingData = false,
    className,
    hierarchyContext,
}: MetricWidgetProps) {
    if (isLoadingData) {
        return <MetricCard label={widget.title ?? '—'} value={undefined} isLoading className={className} />;
    }

    const hierarchyTrace = widget.hierarchyMode && hierarchyContext
        ? buildHierarchyAggregationTrace(widget, hierarchyContext, equipmentMap, machines)
        : undefined;
    const resolved = hierarchyTrace?.resolved ?? resolveBinding(widget, equipmentMap, machines);
    const cardStatus = toCardStatus(resolved.status);

    // --- Construcción del subtext (footer) ---
    // Lee exclusivamente `displayOptions.subtext` — texto aclaratorio inferior.
    // El concepto `subtitle` (header) no aplica a MetricCard porque su header
    // solo lleva título + ícono (sin subtítulo de cabecera en este widget base).
    // La info de frescura también se comunica por subtext + ConnectionBadge.
    let subtext: string | undefined;

    if (resolved.status === 'stale') {
        subtext = 'Dato posiblemente desactualizado';
    }

    const configSubtext = widget.displayOptions?.subtext;
    if (configSubtext) {
        // La config puede definir un subtext adicional (ej. "Límite: 45°C")
        subtext = subtext ? `${subtext} · ${configSubtext}` : configSubtext;
    }

    // --- Resolver ícono sin mezclar semántica de dato vs configuración ---
    // undefined  -> placeholder de configuración pendiente (HelpCircle gris)
    // null       -> sin ícono explícito
    // string     -> ícono configurado
    const iconSetting = widget.displayOptions?.icon;
    const isPendingIconSelection = iconSetting === undefined;
    const isNoIconSelection = iconSetting === null;
    const configuredIcon = typeof iconSetting === 'string' ? ICON_MAP[iconSetting] : undefined;
    const isInvalidConfiguredIcon = typeof iconSetting === 'string' && configuredIcon === undefined;

    const Icon = isPendingIconSelection
        ? HelpCircle
        : isNoIconSelection
          ? undefined
          : configuredIcon ?? HelpCircle;
    const iconColor = isPendingIconSelection || isInvalidConfiguredIcon
        ? 'var(--color-industrial-muted)'
        : undefined;

    // --- Subtitle del header (cabecera, no footer) ---
    const subtitle = widget.displayOptions?.subtitle;

    const showConnectionBadge =
        resolved.connectionState !== undefined &&
        resolved.connectionState !== 'online';
    const valueFontSize = resolveActivityAnalyticsDonutCenterValueFontSize(widget.displayOptions?.valueFontSize);

    return (
        <div className={`flex flex-col gap-1.5 w-full h-full min-h-0 ${className ?? ''}`}>
            <MetricCard
                label={widget.title ?? '—'}
                value={resolved.value}
                valueFontSize={valueFontSize}
                unit={resolved.unit}
                status={cardStatus}
                icon={Icon}
                iconColor={iconColor}
                subtitle={subtitle}
                subtext={subtext}
                isError={resolved.source === 'error' && resolved.status === 'no-data'}
                hierarchyTrace={hierarchyTrace}
                className="flex-1 min-h-0"
            />
            {showConnectionBadge && resolved.connectionState && (
                <div className="px-1">
                    <ConnectionBadge
                        state={resolved.connectionState}
                        lastUpdateAt={resolved.lastUpdateAt}
                    />
                </div>
            )}
        </div>
    );
}
