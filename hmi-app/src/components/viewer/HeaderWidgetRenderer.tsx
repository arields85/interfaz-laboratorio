import type { ConnectionStatusDisplayOptions, StatusDisplayOptions, WidgetConfig } from '../../domain/admin.types';
import type {
    ConnectionHealth,
    ContractMachine,
    ContractStatus,
} from '../../domain/dataContract.types';
import type {
    EquipmentStatus,
    EquipmentSummary,
} from '../../domain/equipment.types';
import { resolveStatusLabel, normalizeSimulatedEquipmentStatus } from '../../utils/statusWidget';
import {
    formatConnectionFreshness,
    normalizeSimulatedToContractStatus,
    resolveContractStatusLabel,
} from '../../utils/connectionWidget';
import { CircleHelp, Wifi, WifiOff, WifiHigh, type LucideIcon } from 'lucide-react';
import { WidgetHeaderDataMode } from '../ui/WidgetHeader';
import { resolveWidgetDataMode } from '../../utils/widgetDataMode';

// =============================================================================
// HeaderWidgetRenderer
// Wrapper liviano para renderizar widgets de estado/conexión en el header
// del dashboard. El panel material vive en HeaderWidgetCanvas para mantener
// la misma base visual del grid sin volver a colorear el contenedor general.
// =============================================================================

interface HeaderWidgetRendererProps {
    widget: WidgetConfig;
    equipmentMap: Map<string, EquipmentSummary>;
    connection?: ConnectionHealth;
    machines?: ContractMachine[];
    align?: 'start' | 'end';
}

const STATUS_COPY: Record<EquipmentStatus, { color: string; pulse?: boolean }> = {
    running: {
        color: 'var(--color-status-normal)',
        pulse: true,
    },
    idle: {
        color: 'var(--color-industrial-muted)',
    },
    warning: {
        color: 'var(--color-status-warning)',
        pulse: true,
    },
    critical: {
        color: 'var(--color-status-critical)',
        pulse: true,
    },
    offline: {
        color: 'var(--color-industrial-muted)',
    },
    maintenance: {
        color: 'var(--color-accent-purple)',
    },
    unknown: {
        color: 'var(--color-industrial-muted)',
    },
};

const CONNECTION_COPY: Record<ContractStatus, { color: string; pulse?: boolean; icon: LucideIcon }> = {
    online: {
        color: 'var(--color-status-normal)',
        pulse: true,
        icon: Wifi,
    },
    degradado: {
        color: 'var(--color-status-warning)',
        pulse: true,
        icon: WifiHigh,
    },
    offline: {
        color: 'var(--color-status-critical)',
        icon: WifiOff,
    },
    unknown: {
        color: 'var(--color-industrial-muted)',
        icon: CircleHelp,
    },
};

function CompactIndicator({
    label,
    color,
    pulse = false,
    align,
    icon: Icon,
    iconTestId,
}: {
    label: string;
    color: string;
    pulse?: boolean;
    align: 'start' | 'end';
    icon?: LucideIcon;
    iconTestId?: string;
}) {
    return (
        <div className={`flex items-center gap-2 ${align === 'start' ? 'justify-start' : 'justify-end'}`}>
            {Icon ? <Icon size={14} strokeWidth={2.25} className="shrink-0" style={{ color }} data-testid={iconTestId} aria-hidden="true" /> : null}
            <span
                className={`h-2 w-2 shrink-0 rounded-full ${pulse ? 'animate-pulse-slow' : ''}`}
                style={{
                    backgroundColor: color,
                    boxShadow: `0 0 10px color-mix(in srgb, ${color} 45%, transparent)`,
                }}
            />
            <span
                className="truncate uppercase"
                style={{ color }}
            >
                {label}
            </span>
        </div>
    );
}

export default function HeaderWidgetRenderer({
    widget,
    equipmentMap,
    connection,
    machines,
    align = 'end',
}: HeaderWidgetRendererProps) {
    const dataMode = resolveWidgetDataMode(widget);
    const alignmentClasses = align === 'start'
        ? 'items-start text-left'
        : 'items-end text-right';

    if (widget.type === 'status') {
        const options = widget.displayOptions as StatusDisplayOptions | undefined;
        const status: EquipmentStatus = widget.binding?.mode === 'simulated_value'
            ? normalizeSimulatedEquipmentStatus(widget.binding.simulatedValue)
            : (() => {
                const assetId = widget.binding?.assetId;
                const equipment = assetId ? equipmentMap.get(assetId) : undefined;
                return equipment?.status ?? 'unknown';
            })();

        const copy = STATUS_COPY[status] ?? STATUS_COPY.unknown;
        const label = resolveStatusLabel(status, options);

        return (
            <div className={`flex flex-col gap-0.5 ${alignmentClasses}`}>
                <div className="flex items-center gap-2">
                    <CompactIndicator
                        label={label}
                        color={copy.color}
                        pulse={copy.pulse}
                        align={align}
                    />
                    <WidgetHeaderDataMode
                        dataMode={dataMode}
                        dataModeTestId="header-widget-data-mode"
                        withLeadingSeparator
                    />
                </div>
            </div>
        );
    }

    if (widget.type === 'connection-status') {
        const options = widget.displayOptions as ConnectionStatusDisplayOptions | undefined;
        const scope = options?.scope ?? 'global';
        const machineId = options?.machineId;
        const binding = widget.binding;
        let status: ContractStatus = 'unknown';
        let lastSuccess: string | null = null;
        let ageMs: number | null = null;

        if (binding?.mode === 'simulated_value') {
            status = normalizeSimulatedToContractStatus(binding.simulatedValue);
        } else if (scope === 'machine') {
            if (machineId != null && machines) {
                const machine = machines.find((m) => m.unitId === machineId);
                if (machine) {
                    status = machine.status;
                    lastSuccess = machine.lastSuccess;
                    ageMs = machine.ageMs;
                }
            }
        } else if (connection) {
            status = connection.globalStatus;
            lastSuccess = connection.lastSuccess;
            ageMs = connection.ageMs;
        }

        const copy = CONNECTION_COPY[status] ?? CONNECTION_COPY.unknown;
        const label = resolveContractStatusLabel(status, options);
        const Icon = copy.icon;
        const showLastUpdate = options?.showLastUpdate !== false;
        const relativeTime = formatConnectionFreshness(ageMs, lastSuccess);

        return (
            <div
                data-testid="connection-header-layout"
                className="flex h-full w-full flex-row items-center gap-3 text-left"
            >
                <Icon
                    size={24}
                    strokeWidth={2}
                    className="shrink-0 opacity-100"
                    style={{ color: copy.color }}
                    data-testid={`connection-header-icon-${status}`}
                    aria-hidden="true"
                />
                <WidgetHeaderDataMode dataMode={dataMode} dataModeTestId="header-widget-data-mode" />

                <div data-testid="connection-header-details" className="flex min-w-0 flex-col items-start justify-center">
                    <span className="max-w-full truncate uppercase text-industrial-muted">
                        {label}
                    </span>

                    {showLastUpdate ? (
                        <div className="mt-0.5 flex items-center gap-1.5">
                            <span
                                className={`h-2 w-2 shrink-0 rounded-full -translate-y-px ${copy.pulse ? 'animate-pulse-slow' : ''}`}
                                style={{
                                    backgroundColor: copy.color,
                                    boxShadow: `0 0 10px color-mix(in srgb, ${copy.color} 45%, transparent)`,
                                }}
                                aria-hidden="true"
                            />
                            <span className="text-industrial-muted font-mono leading-none">{relativeTime || '—'}</span>
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }

    return (
        <div className={`flex flex-col gap-0.5 opacity-40 ${alignmentClasses}`}>
            <span className="uppercase text-industrial-muted">
                Widget no soportado en header
            </span>
            <span className="font-mono text-industrial-muted/60">
                {widget.type}
            </span>
        </div>
    );
}
