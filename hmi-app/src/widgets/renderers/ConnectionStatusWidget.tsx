import { CircleHelp, Wifi, WifiHigh, WifiOff, type LucideIcon } from 'lucide-react';
import type { ConnectionStatusDisplayOptions, WidgetConfig } from '../../domain/admin.types';
import type { PresentationPayload } from '../../domain/dashboardPresentation.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import type { ContractMachine, ContractStatus, ConnectionHealth } from '../../domain/dataContract.types';
import WidgetHeader, { WidgetHeaderDataMode } from '../../components/ui/WidgetHeader';
import {
    formatConnectionFreshness,
    normalizeSimulatedToContractStatus,
    resolveContractStatusLabel,
} from '../../utils/connectionWidget';
import { resolveWidgetDataMode } from '../../utils/widgetDataMode';

// =============================================================================
// ConnectionStatusWidget
// Widget unificado de estado de conexión con soporte para dos scopes:
//
//   scope = 'global'  → "¿La HMI está pudiendo hablar con la capa de datos?"
//   scope = 'machine' → "¿La capa de datos está pudiendo leer esta máquina?"
//
// Consume datos del contrato oficial (connection + machines).
// No calcula health — solo lee y renderiza.
//
// Estados visuales: online (verde), degradado (amarillo), offline (rojo), unknown (gris)
//
// Contrato oficial: docs/DATA_CONTRACT.md
// =============================================================================

interface ConnectionStatusWidgetProps {
    widget: WidgetConfig;
    equipmentMap: Map<string, EquipmentSummary>;
    machines?: ContractMachine[];
    connection?: ConnectionHealth;
    className?: string;
    presentationData?: PresentationPayload;
}

// --- Visual config por estado ---

interface StatusVisualConfig {
    icon: LucideIcon;
    iconColor: string;
    dotClass: string;
}

const STATUS_VISUAL: Record<ContractStatus, StatusVisualConfig> = {
    online: {
        icon: Wifi,
        iconColor: 'var(--color-status-normal)',
        dotClass: 'bg-status-normal animate-pulse-slow led-glow-green',
    },
    degradado: {
        icon: WifiHigh,
        iconColor: 'var(--color-status-warning)',
        dotClass: 'bg-status-warning animate-pulse-medium led-glow-amber',
    },
    offline: {
        icon: WifiOff,
        iconColor: 'var(--color-status-critical)',
        dotClass: 'bg-status-critical animate-pulse-fast led-glow-red',
    },
    unknown: {
        icon: CircleHelp,
        iconColor: 'var(--color-industrial-muted)',
        dotClass: 'bg-industrial-muted',
    },
};

// --- Component ---

export default function ConnectionStatusWidget({
    widget,
    machines,
    connection,
    className,
    presentationData,
}: ConnectionStatusWidgetProps) {
    const options = widget.displayOptions as ConnectionStatusDisplayOptions | undefined;
    const scope = options?.scope ?? 'global';
    const machineId = options?.machineId;
    const binding = widget.binding;

    // --- Resolve status + time ---

    let status: ContractStatus = 'unknown';
    let lastSuccess: string | null = null;
    let ageMs: number | null = null;

    if (presentationData?.value !== undefined) {
        status = presentationData.value as ContractStatus;
        lastSuccess = (presentationData as { lastSuccess?: string | null }).lastSuccess ?? null;
        ageMs = (presentationData as { ageMs?: number | null }).ageMs ?? null;
    } else if (binding?.mode === 'simulated_value') {
        // Simulated mode — status from config value
        status = normalizeSimulatedToContractStatus(binding.simulatedValue);
    } else if (scope === 'machine') {
        // Machine scope — find by unitId
        if (machineId != null && machines) {
            const machine = machines.find((m) => m.unitId === machineId);
            if (machine) {
                status = machine.status;
                lastSuccess = machine.lastSuccess;
                ageMs = machine.ageMs;
            }
        }
    } else {
        // Global scope (default)
        if (connection) {
            status = connection.globalStatus;
            lastSuccess = connection.lastSuccess;
            ageMs = connection.ageMs;
        }
    }

    const visual = STATUS_VISUAL[status];
    const label = resolveContractStatusLabel(status, options);
    const Icon = visual.icon;

    const showLastUpdate = options?.showLastUpdate !== false;
    const relativeTime = formatConnectionFreshness(ageMs, lastSuccess);
    const title = widget.title?.trim() ?? '';
    const hasTitle = title.trim().length > 0;
    const dataMode = resolveWidgetDataMode(widget);

    return (
        <div className={`glass-panel group flex h-full w-full flex-col p-5 ${className ?? ''}`}>
            {hasTitle ? (
                <WidgetHeader
                    title={title}
                    icon={visual.icon}
                    iconPosition="centered"
                    iconColor={visual.iconColor}
                    iconTestId={`connection-status-icon-${status}`}
                    dataMode={dataMode ?? undefined}
                    dataModeTestId="connection-status-widget-data-mode"
                    alignment="none"
                    className="w-full"
                />
            ) : null}

            <div className="flex flex-1 flex-col items-center justify-center text-center">
                {hasTitle ? null : (
                    <div className="mb-2 flex items-center gap-2">
                        <Icon
                            size={24}
                            strokeWidth={2}
                            className="shrink-0"
                            style={{ color: visual.iconColor }}
                            data-testid={`connection-status-icon-${status}`}
                            aria-hidden="true"
                        />
                        <WidgetHeaderDataMode
                            dataMode={dataMode}
                            dataModeTestId="connection-status-widget-data-mode"
                        />
                    </div>
                )}

                <span className="uppercase text-industrial-muted">
                    {label}
                </span>

                {showLastUpdate ? (
                    <div className="mt-0.5 flex items-center justify-center gap-1.5">
                        <span className={`h-2 w-2 shrink-0 rounded-full -translate-y-px ${visual.dotClass}`} aria-hidden="true" />
                        <span className="text-industrial-muted font-mono leading-none">{relativeTime || '—'}</span>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
