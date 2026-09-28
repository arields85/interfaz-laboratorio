import {
    Activity,
    BarChart2,
    Droplet,
    Fan,
    FoldVertical,
    Gauge,
    Group,
    HeartPulse,
    HelpCircle,
    LineChart,
    Settings,
    Siren,
    Thermometer,
    TrendingUp,
    Wifi,
    Wind,
    Zap,
    type LucideIcon,
} from 'lucide-react';
import type { GroupWidgetConfig } from '../../domain/admin.types';
import WidgetHeader from '../../components/ui/WidgetHeader';

// =============================================================================
// GroupWidget
// Renderer para widgets de tipo 'group': un contenedor visual que agrupa
// otros widgets bajo el mismo marco/hover que cualquier widget, con header
// (texto + ícono) y cuerpo vacío — el contenedor solo enmarca a los widgets
// que se colocan encima. Qué widgets están agrupados (`memberWidgetIds`) y
// si el contenedor está cerrado (`locked`) es estado de edición del builder;
// este renderer no lee ni necesita esos campos.
// =============================================================================

const ICON_MAP: Record<string, LucideIcon> = {
    Group,
    Gauge,
    Activity,
    Thermometer,
    Zap,
    Droplet,
    Wind,
    Settings,
    Fan,
    FoldVertical,
    TrendingUp,
    HeartPulse,
    Siren,
    Wifi,
    BarChart2,
    LineChart,
};

interface GroupWidgetProps {
    widget: GroupWidgetConfig;
    className?: string;
}

export default function GroupWidget({ widget, className }: GroupWidgetProps) {
    const displayOptions = widget.displayOptions;

    // Ícono: mismo patrón que los demás widgets.
    // undefined -> selección pendiente (HelpCircle gris) | null -> sin ícono | string -> ícono configurado.
    const iconSetting = displayOptions?.icon;
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
        : 'var(--color-widget-icon)';

    // G7(c): no 'Contenedor' fallback — an empty title stays empty. When there is also no icon
    // ("Sin ícono"), the header row itself is skipped instead of rendering an empty, oddly
    // spaced row.
    const trimmedTitle = widget.title?.trim() ?? '';
    const hasHeaderContent = trimmedTitle.length > 0 || Icon !== undefined;

    return (
        <div className={[className, 'glass-panel group flex h-full w-full flex-col p-4'].filter(Boolean).join(' ')}>
            {hasHeaderContent && (
                <WidgetHeader
                    title={trimmedTitle}
                    icon={Icon}
                    iconColor={iconColor}
                    iconPosition="right"
                    iconTestId="group-header-icon"
                />
            )}
        </div>
    );
}
