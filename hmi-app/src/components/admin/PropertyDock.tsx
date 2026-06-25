import { useEffect, useState } from 'react';
import { Settings2, Database, Zap, Sliders, Tag, Gauge, Activity, Thermometer, Droplet, Wind, Settings, Fan, FoldVertical, History, HelpCircle, ChevronDown, MousePointerClick, TrendingUp, BarChart2, AreaChart, Lock, Loader2, AlignLeft, AlignCenter, AlignRight, HeartPulse, Siren, Wifi, LineChart } from 'lucide-react';
import type { AggregationMode, WidgetConfig, WidgetBinding, WidgetLayout, KpiDisplayOptions, MetricCardDisplayOptions, AlertHistoryDisplayOptions, ConnectionStatusDisplayOptions, StatusDisplayOptions, ProdHistoryDisplayOptions, MachineActivityDisplayOptions, TextTitleDisplayOptions, TextTitleColor, TrendChartV2DisplayOptions, ActivityAnalyticsDisplayOptions } from '../../domain/admin.types';
import { isTrendChartV2Widget } from '../../domain/admin.types';
import { HISTORICAL_DENSITY_LABELS, normalizeHistoricalDensity } from '../../utils/trendChartV2Density';
import {
    normalizeTrendChartV2ShiftDisplayMode,
    TREND_CHART_V2_SHIFT_DISPLAY_MODE_LABELS,
} from '../../utils/trendChartV2Shifts';
import type { CatalogVariable } from '../../domain';
import type { EquipmentSummary } from '../../domain/equipment.types';
import type { ContractMachine } from '../../domain/dataContract.types';
import AdminSelect from './AdminSelect';
import AdminNumberInput from './AdminNumberInput';
import AdminEmptyState from './AdminEmptyState';
import CatalogVariableSelector from './CatalogVariableSelector';
import DockInfoBox from './DockInfoBox';
import {
    DEFAULT_STATUS_LABELS,
    EQUIPMENT_STATUS_VALUES,
    normalizeSimulatedEquipmentStatus,
} from '../../utils/statusWidget';
import { DEFAULT_CONTRACT_STATUS_LABELS } from '../../utils/connectionWidget';
import {
    ADMIN_SIDEBAR_INPUT_CLS,
    ADMIN_SIDEBAR_LABEL_CLS,
    ADMIN_SIDEBAR_PANEL_CLS,
    ADMIN_SIDEBAR_PANEL_HEADER_CLS,
    ADMIN_SIDEBAR_PANEL_STACK_CLS,
    ADMIN_SIDEBAR_SECTION_BODY_CLS,
    ADMIN_SIDEBAR_SECTION_BUTTON_CLS,
    ADMIN_SIDEBAR_SECTION_CLS,
    ADMIN_SIDEBAR_SECTION_HEADER_CLS,
    ADMIN_SIDEBAR_PANEL_TITLE_CLS,
} from './adminSidebarStyles';
import { supportsCatalogVariable, supportsHierarchy } from '../../utils/widgetCapabilities';
import { DEFAULT_TEXT_TITLE_FONT_SIZE } from '../../widgets/renderers/TextTitleWidget';
import { resolveActivityAnalyticsDisplayOptions } from '../../utils/activityAnalyticsWidgetDefaults';
import {
    resolveActivityAnalyticsDisplayRules,
    type ActivityAnalyticsSupportedRange,
} from '../../utils/activityAnalyticsDisplayRules';

// =============================================================================
// PropertyDock
// Dock inferior flotante del Dashboard Builder. Organiza las propiedades del
// widget seleccionado en secciones horizontales compactas, eliminando la
// necesidad de scroll vertical del antiguo panel lateral.
//
// Secciones: General | Visual | Rango | Umbrales | Datos | Acciones
// =============================================================================

interface PropertyDockProps {
    selectedWidget?: WidgetConfig;
    selectedLayout?: WidgetLayout;
    equipmentMap: Map<string, EquipmentSummary>;
    machines: ContractMachine[];
    dataLoading?: boolean;
    dataError?: boolean;
    dataEnabled?: boolean;
    catalogVariables: CatalogVariable[];
    usedCatalogVariableIds: string[];
    onCreateVariable: (name: string, unit: string) => void;
    onDeleteVariable: (variableId: string) => void;
    onUpdateWidget: (w: WidgetConfig) => void;
    onUpdateLayout: (l: WidgetLayout) => void;
    onDelete: () => void;
    onDuplicate: () => void;
    onDeselect: () => void;
}

// --- Shared input class tokens ---
const INPUT_CLS = ADMIN_SIDEBAR_INPUT_CLS;
const LABEL_CLS = ADMIN_SIDEBAR_LABEL_CLS;
const SECTION_HEADER_CLS = ADMIN_SIDEBAR_SECTION_HEADER_CLS;
const TREND_CHART_V2_TOGGLE_TRACK_CLS = "w-7 h-4 rounded-full border border-industrial-border bg-industrial-hover transition-all peer peer-checked:border-admin-accent/40 peer-checked:bg-admin-accent/20 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:h-3 after:w-3 after:rounded-full after:bg-industrial-text after:transition-all";
const TREND_CHART_V2_TOGGLE_LABEL_CLS = 'whitespace-nowrap text-industrial-text-soft transition-all peer-checked:text-industrial-text group-hover:text-industrial-text group-hover:drop-shadow-[0_0_5px_var(--color-admin-accent)]';
const FIELD_ROW_CLS = 'flex items-center gap-2';
const FIELD_LABEL_CLS = `${LABEL_CLS} shrink-0`;
const PRESET_UNITS = ['°C', '°F', 'RPM', '%', 'bar', 'psi', 'kW', 'A', 'V', 'Hz', 'mm', 'kg', 'L/min', 'm³/h', 'N', 'kN'] as const;
type PresetUnit = (typeof PRESET_UNITS)[number];
type ConnectionStatusTextFieldKey = 'onlineText' | 'degradadoText' | 'offlineText' | 'unknownText';

const isPresetUnit = (value: string): value is PresetUnit => PRESET_UNITS.some(unit => unit === value);
const ACTIVITY_ANALYTICS_RANGE_OPTIONS: Array<{ value: ActivityAnalyticsSupportedRange; label: string }> = [
    { value: '7d', label: '7 días' },
    { value: '30d', label: '30 días' },
    { value: '12m', label: '12 meses' },
];
const ACTIVITY_ANALYTICS_GROUP_OPTIONS = [
    { value: 'shift', label: 'Turno' },
    { value: 'day', label: 'Día' },
    { value: 'week', label: 'Semana' },
    { value: 'month', label: 'Mes' },
] as const;

const STATUS_TEXT_FIELDS: Array<{ key: keyof StatusDisplayOptions; label: string; placeholder: string }> = [
    { key: 'runningText', label: 'Running', placeholder: DEFAULT_STATUS_LABELS.running },
    { key: 'idleText', label: 'Idle', placeholder: DEFAULT_STATUS_LABELS.idle },
    { key: 'warningText', label: 'Warning', placeholder: DEFAULT_STATUS_LABELS.warning },
    { key: 'criticalText', label: 'Critical', placeholder: DEFAULT_STATUS_LABELS.critical },
    { key: 'offlineText', label: 'Offline', placeholder: DEFAULT_STATUS_LABELS.offline },
    { key: 'maintenanceText', label: 'Maint.', placeholder: DEFAULT_STATUS_LABELS.maintenance },
    { key: 'unknownText', label: 'Unknown', placeholder: DEFAULT_STATUS_LABELS.unknown },
];

const CONNECTION_STATUS_TEXT_FIELDS: Array<{
    key: ConnectionStatusTextFieldKey;
    label: string;
    placeholder: string;
}> = [
    { key: 'onlineText', label: 'Online', placeholder: DEFAULT_CONTRACT_STATUS_LABELS.online },
    { key: 'degradadoText', label: 'Degradado', placeholder: DEFAULT_CONTRACT_STATUS_LABELS.degradado },
    { key: 'offlineText', label: 'Offline', placeholder: DEFAULT_CONTRACT_STATUS_LABELS.offline },
    { key: 'unknownText', label: 'Unknown', placeholder: DEFAULT_CONTRACT_STATUS_LABELS.unknown },
];

export default function PropertyDock(props: PropertyDockProps) {
    const {
        selectedWidget,
        selectedLayout,
        equipmentMap,
        machines,
        dataLoading = false,
        dataError = false,
        dataEnabled = false,
        catalogVariables,
        usedCatalogVariableIds,
        onCreateVariable,
        onDeleteVariable,
        onUpdateWidget,
    } = props;
    const [isCustomUnit, setIsCustomUnit] = useState(false);
    const [activityAnalyticsThresholdWarning, setActivityAnalyticsThresholdWarning] = useState<string | null>(null);
    void selectedLayout;

    useEffect(() => {
        setActivityAnalyticsThresholdWarning(null);
    }, [selectedWidget?.id]);

    // -------------------------------------------------------------------------
    // handleDisplayOptionChange
    // Escritura controlada de displayOptions para el widget seleccionado.
    // El cast a Record<string,unknown> está justificado aquí: este dock es
    // el único punto de escritura de displayOptions en toda la app; los campos
    // escritos están controlados por la UI y son siempre válidos para el tipo.
    // El tipado estricto vive en los renderers — este dock es la capa de edición.
    // -------------------------------------------------------------------------
    const handleDisplayOptionChange = (key: string, value: string | number | boolean | null) => {
        if (!selectedWidget) return;
        const current = (selectedWidget.displayOptions ?? {}) as Record<string, unknown>;
        const displayOptions = { ...current };
        if (value === null) {
            displayOptions[key] = null;
        } else if (value === '') {
            displayOptions[key] = undefined;
        } else {
            displayOptions[key] = value;
        }
        // Cast explícito: el tipo correcto de displayOptions se garantiza por la UI
        // que solo muestra campos válidos para el tipo de widget seleccionado.
        onUpdateWidget({ ...selectedWidget, displayOptions } as WidgetConfig);
    };

    const handleNumericDisplayOptionChange = (key: string, value: string) => {
        handleDisplayOptionChange(key, value === '' ? '' : Number(value));
    };

    const handleActivityAnalyticsThresholdChange = (
        key: 'setupThresholdKw' | 'prodThresholdKw',
        value: string,
    ) => {
        if (!selectedWidget || selectedWidget.type !== 'activity-analytics') {
            return;
        }

        const nextValue = value === '' ? 0 : Number(value);

        if (!Number.isFinite(nextValue) || nextValue < 0) {
            return;
        }

        const currentOptions = resolveActivityAnalyticsDisplayOptions(selectedWidget.displayOptions as ActivityAnalyticsDisplayOptions | undefined);
        const nextSetupThresholdKw = key === 'setupThresholdKw' ? nextValue : currentOptions.setupThresholdKw;
        const nextProdThresholdKw = key === 'prodThresholdKw' ? nextValue : currentOptions.prodThresholdKw;

        if (nextProdThresholdKw <= nextSetupThresholdKw) {
            setActivityAnalyticsThresholdWarning('Prod. debe ser mayor que Setup.');
            onUpdateWidget({
                ...selectedWidget,
                displayOptions: {
                    ...selectedWidget.displayOptions,
                    setupThresholdKw: currentOptions.setupThresholdKw,
                    prodThresholdKw: currentOptions.prodThresholdKw,
                },
            });
            return;
        }

        setActivityAnalyticsThresholdWarning(null);
        handleDisplayOptionChange(key, nextValue);
    };

    const handleActivityAnalyticsRangeChange = (nextRange: string) => {
        if (!selectedWidget || selectedWidget.type !== 'activity-analytics') {
            return;
        }

        const currentOptions = resolveActivityAnalyticsDisplayOptions(selectedWidget.displayOptions as ActivityAnalyticsDisplayOptions | undefined);
        const nextRules = resolveActivityAnalyticsDisplayRules({
            range: nextRange,
            groupBy: currentOptions.groupBy,
        });

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...selectedWidget.displayOptions,
                range: nextRules.range,
                groupBy: nextRules.groupBy,
                start: undefined,
                end: undefined,
            },
        });
    };

    const handleActivityAnalyticsGroupChange = (nextGroupBy: string) => {
        if (!selectedWidget || selectedWidget.type !== 'activity-analytics') {
            return;
        }

        const currentOptions = resolveActivityAnalyticsDisplayOptions(selectedWidget.displayOptions as ActivityAnalyticsDisplayOptions | undefined);
        const nextRules = resolveActivityAnalyticsDisplayRules({
            range: currentOptions.range,
            start: currentOptions.start,
            end: currentOptions.end,
            groupBy: nextGroupBy,
        });

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...selectedWidget.displayOptions,
                range: nextRules.range,
                groupBy: nextRules.groupBy,
            },
        });
    };

    const handleUnitChange = (val: string) => {
        if (!selectedWidget) return;
        const binding = { ...selectedWidget.binding, mode: selectedWidget.binding?.mode || 'simulated_value' as const, unit: val || undefined };
        onUpdateWidget({ ...selectedWidget, binding });
    };

    const handleWidgetDisplayUnitChange = (val: string) => {
        if (!selectedWidget || (selectedWidget.type !== 'kpi' && selectedWidget.type !== 'machine-activity')) {
            return;
        }

        handleDisplayOptionChange('unit', val);
    };

    const handleWidgetSimulatedUnitChange = (val: string) => {
        if (!selectedWidget || (selectedWidget.type !== 'kpi' && selectedWidget.type !== 'machine-activity')) {
            return;
        }

        onUpdateWidget({
            ...selectedWidget,
            binding: {
                ...selectedWidget.binding,
                mode: selectedWidget.binding?.mode || 'simulated_value' as const,
                unit: val || undefined,
            },
            displayOptions: {
                ...(selectedWidget.displayOptions ?? {}),
                unit: val || undefined,
            },
        } as WidgetConfig);
    };

    const handleWidgetUnitOverrideChange = (checked: boolean) => {
        if (!selectedWidget || (selectedWidget.type !== 'kpi' && selectedWidget.type !== 'machine-activity')) {
            return;
        }

        const nextDisplayOptions = {
            ...(selectedWidget.displayOptions ?? {}),
            unitOverride: checked,
        };

        if (checked && !nextDisplayOptions.unit) {
            nextDisplayOptions.unit = selectedWidget.type === 'machine-activity' ? '%' : '';
        }

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: nextDisplayOptions,
        } as WidgetConfig);
    };

    const getUnitSelectOptions = (value?: string | null) => {
        const normalizedValue = value?.trim() ?? '';
        const baseOptions = PRESET_UNITS.map(unitOption => ({ value: unitOption, label: unitOption }));

        if (!normalizedValue || isPresetUnit(normalizedValue)) {
            return baseOptions;
        }

        return [{ value: normalizedValue, label: normalizedValue }, ...baseOptions];
    };

    // --- Binding handlers ---
    const binding = selectedWidget?.binding || { mode: 'simulated_value' as const, simulatedValue: 0 };
    const thresholds = selectedWidget?.thresholds || [];

    const handleModeChange = (mode: WidgetBinding['mode']) => {
        if (!selectedWidget) return;

        const widgetDisplayOptions = (selectedWidget.type === 'kpi' || selectedWidget.type === 'machine-activity')
            ? (selectedWidget.displayOptions as KpiDisplayOptions | MachineActivityDisplayOptions | undefined)
            : undefined;
        const nextBinding: WidgetBinding = { ...binding, mode };

        if (mode === 'simulated_value' && widgetDisplayOptions?.unit?.trim()) {
            nextBinding.unit = widgetDisplayOptions.unit.trim();
        }

        onUpdateWidget({ ...selectedWidget, binding: nextBinding });
    };

    const handleSimulatedValueChange = (val: string) => {
        if (!selectedWidget) return;
        const parsed = val === '' ? '' : Number(val);
        onUpdateWidget({
            ...selectedWidget,
            binding: { ...binding, simulatedValue: parsed }
        });
    };

    const handleMachineChange = (machineId: string) => {
        if (!selectedWidget) return;

        const parsedMachineId = machineId === '' ? undefined : Number(machineId);

        onUpdateWidget({
            ...selectedWidget,
            binding: {
                ...binding,
                machineId: parsedMachineId,
                variableKey: undefined,
                bindingVersion: 'node-red-v1',
            },
        });
    };

    const handleVariableChange = (variableKey: string) => {
        if (!selectedWidget) return;

        const selectedVariableUnit = selectedMachine?.values[variableKey]?.unit;

        onUpdateWidget({
            ...selectedWidget,
            binding: {
                ...binding,
                machineId: binding.machineId,
                variableKey,
                unit: selectedVariableUnit ?? binding.unit,
                bindingVersion: 'node-red-v1',
            }
        });
    };

    const handleCatalogVariableChange = (catalogVariableId: string | undefined) => {
        if (!selectedWidget) return;

        if (!catalogVariableId) {
            onUpdateWidget({
                ...selectedWidget,
                binding: {
                    ...binding,
                    catalogVariableId: undefined,
                },
            });
            return;
        }

        const selectedCatalogVariable = catalogVariables.find((variable) => variable.id === catalogVariableId);

        onUpdateWidget({
            ...selectedWidget,
            binding: {
                ...binding,
                catalogVariableId,
                unit: selectedCatalogVariable?.unit ?? binding.unit,
            },
        });
    };

    const handleConnectionMachineDisplayChange = (machineId: string) => {
        if (!selectedWidget || (selectedWidget.type !== 'connection-status')) {
            return;
        }

        const currentOptions = (selectedWidget.displayOptions ?? {}) as ConnectionStatusDisplayOptions;

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...currentOptions,
                scope: 'machine',
                machineId: machineId === '' ? undefined : Number(machineId),
            },
        });
    };

    const handleConnectionOriginChange = (origin: 'simulated_value' | 'global' | 'machine') => {
        if (!selectedWidget || selectedWidget.type !== 'connection-status') {
            return;
        }

        const currentOptions = (selectedWidget.displayOptions ?? {}) as ConnectionStatusDisplayOptions;

        if (origin === 'simulated_value') {
            onUpdateWidget({
                ...selectedWidget,
                binding: {
                    ...binding,
                    mode: 'simulated_value',
                },
            });
            return;
        }

        const nextOptions: ConnectionStatusDisplayOptions = {
            ...currentOptions,
            scope: origin,
        };

        if (origin === 'global') {
            delete nextOptions.machineId;
        }

        onUpdateWidget({
            ...selectedWidget,
            binding: {
                ...binding,
                mode: 'real_variable',
            },
            displayOptions: nextOptions,
        });
    };

    const handleUpdateThreshold = (index: number, value: number) => {
        if (!selectedWidget) return;
        const newThresholds = [...thresholds];
        newThresholds[index] = { ...newThresholds[index], value };
        onUpdateWidget({ ...selectedWidget, thresholds: newThresholds });
    };


    const selectedAsset = binding.assetId ? equipmentMap.get(binding.assetId) : undefined;
    const selectedMachine = binding.machineId != null
        ? machines.find((machine) => machine.unitId === binding.machineId)
        : undefined;
    const isConnectionWidget = selectedWidget?.type === 'connection-status';
    const connectionDisplayOptions = isConnectionWidget
        ? (selectedWidget?.displayOptions as ConnectionStatusDisplayOptions | undefined)
        : undefined;
    const connectionScope = connectionDisplayOptions?.scope ?? 'global';
    const connectionOrigin = isConnectionWidget
        ? (binding.mode === 'simulated_value' ? 'simulated_value' : connectionScope)
        : binding.mode;
    const isKpi = selectedWidget?.type === 'kpi';
    const isMachineActivity = selectedWidget?.type === 'machine-activity';
    const isActivityAnalytics = selectedWidget?.type === 'activity-analytics';
    const isDashboardTitle = selectedWidget?.type === 'text-title';
    const widgetType = selectedWidget?.type ?? '';
    const hasCatalogSupport = supportsCatalogVariable(widgetType);
    const hasHierarchySupport = supportsHierarchy(widgetType);
    const isHierarchyModeEnabled = hasHierarchySupport && selectedWidget?.hierarchyMode === true;
    const isAggregationDisabled = hasHierarchySupport && !isHierarchyModeEnabled;
    const isBindingSourceDisabled = hasHierarchySupport && isHierarchyModeEnabled;
    const selectedCatalogVariable = binding.catalogVariableId
        ? catalogVariables.find((variable) => variable.id === binding.catalogVariableId)
        : undefined;
    const filteredCatalogVariables = catalogVariables.filter((variable) => variable.unit === binding.unit);
    const hasCatalogVariablesForUnit = filteredCatalogVariables.length > 0;
    const isCatalogVariableRequired = isHierarchyModeEnabled || hasCatalogVariablesForUnit;
    const isUnitLocked = Boolean(binding.catalogVariableId);
    const showThresholds = isKpi || selectedWidget?.type === 'metric-card';
    const isProdHistory = selectedWidget?.type === 'prod-history';
    const prodHistoryOptions = isProdHistory
        ? (selectedWidget.displayOptions as ProdHistoryDisplayOptions | undefined)
        : undefined;
    const machineActivityOptions = isMachineActivity
        ? (selectedWidget.displayOptions as MachineActivityDisplayOptions | undefined)
        : undefined;
    const activityAnalyticsOptions = isActivityAnalytics
        ? resolveActivityAnalyticsDisplayOptions(selectedWidget.displayOptions as ActivityAnalyticsDisplayOptions | undefined)
        : null;
    const activityAnalyticsDisplayRules = activityAnalyticsOptions
        ? resolveActivityAnalyticsDisplayRules({
            range: activityAnalyticsOptions.range,
            start: activityAnalyticsOptions.start,
            end: activityAnalyticsOptions.end,
            groupBy: activityAnalyticsOptions.groupBy,
        })
        : null;
    const isTrendChartV2 = selectedWidget ? isTrendChartV2Widget(selectedWidget) : false;
    const trendChartV2Options = isTrendChartV2
        ? (selectedWidget?.displayOptions as TrendChartV2DisplayOptions | undefined)
        : undefined;
    const kpiDisplayOptions = isKpi
        ? (selectedWidget.displayOptions as KpiDisplayOptions | undefined)
        : undefined;
    const widgetUnitDisplayOptions = isMachineActivity
        ? machineActivityOptions
        : isKpi
            ? kpiDisplayOptions
            : undefined;
    const isUnitOverrideEnabled = isMachineActivity
        ? (machineActivityOptions?.unitOverride ?? true)
        : (kpiDisplayOptions?.unitOverride ?? false);
    const resolvedVariableUnit = binding.mode === 'real_variable' && binding.variableKey && selectedMachine
        ? selectedMachine.values[binding.variableKey]?.unit
        : undefined;
    const resolvedMachineActivityScaleUnit = (
        binding.mode === 'simulated_value'
            ? (binding.unit?.trim() || widgetUnitDisplayOptions?.unit)
            : (resolvedVariableUnit ?? binding.unit)
    )?.trim() ?? '';
    const machineActivityScaleMinLabel = resolvedMachineActivityScaleUnit ? `${resolvedMachineActivityScaleUnit} mín` : 'Valor mín';
    const machineActivityScaleMaxLabel = resolvedMachineActivityScaleUnit ? `${resolvedMachineActivityScaleUnit} máx` : 'Valor máx';
    const resolvedKpiScaleUnit = (
        binding.mode === 'simulated_value'
            ? (binding.unit?.trim() || widgetUnitDisplayOptions?.unit)
            : (resolvedVariableUnit ?? binding.unit)
    )?.trim() ?? '';
    const kpiScaleMinLabel = resolvedKpiScaleUnit ? `${resolvedKpiScaleUnit} mín` : 'Valor mín';
    const kpiScaleMaxLabel = resolvedKpiScaleUnit ? `${resolvedKpiScaleUnit} máx` : 'Valor máx';
    const isSimulatedBinding = binding.mode === 'simulated_value';
    const simulatedWidgetUnit = (binding.unit?.trim() || widgetUnitDisplayOptions?.unit?.trim() || '');
    const customUnitInputValue = isSimulatedBinding
        ? (simulatedWidgetUnit || (isMachineActivity ? '%' : ''))
        : (widgetUnitDisplayOptions?.unit ?? (isMachineActivity ? '%' : (binding.unit ?? '')));
    const resolvedUnitPreviewValue = resolvedVariableUnit ?? '—';
    const prodHistoryBarWidth = (() => {
        const rawValue = prodHistoryOptions?.productionBarWidth ?? 1;
        return Math.min(1.5, Math.max(0.5, Number.isFinite(rawValue) ? rawValue : 1));
    })();
    const shouldShowGeneralIconField = selectedWidget
        && selectedWidget.type !== 'connection-status'
        && selectedWidget.type !== 'text-title'
        && selectedWidget.type !== 'status'
        && selectedWidget.type !== 'activity-analytics';
    const genericDataUnitField = selectedWidget
        && selectedWidget.type !== 'alert-history'
        && selectedWidget.type !== 'prod-history'
        && selectedWidget.type !== 'connection-status'
        && selectedWidget.type !== 'kpi'
        && selectedWidget.type !== 'machine-activity'
        && selectedWidget.type !== 'activity-analytics'
        ? (() => {
            const currentUnit = selectedWidget?.binding?.unit || '';
            const isPreset = isPresetUnit(currentUnit);
            const showCustom = isCustomUnit || (!isPreset && currentUnit !== '');
            const selectValue = showCustom ? '__custom__' : currentUnit;

            return (
                <>
                    <DockFieldRow label="Unidad">
                        {isUnitLocked ? (
                            <div className={`${INPUT_CLS} flex w-full items-center justify-between gap-2 border-white/5 bg-black/20 text-industrial-muted`}>
                                <span className="truncate text-white/80">{(selectedCatalogVariable?.unit ?? currentUnit) || 'Sin unidad'}</span>
                                <span className="inline-flex shrink-0 items-center gap-1 uppercase text-status-warning">
                                    <Lock size={10} /> Fija
                                </span>
                            </div>
                        ) : (
                            <AdminSelect
                                value={selectValue}
                                placeholder="Seleccionar"
                                onChange={val => {
                                    if (val === '__custom__') {
                                        setIsCustomUnit(true);
                                    } else {
                                        setIsCustomUnit(false);
                                        handleUnitChange(val);
                                    }
                                }}
                                options={[
                                    { value: '', label: 'Sin unidad' },
                                    ...PRESET_UNITS.map(u => ({ value: u, label: u })),
                                    { value: '__custom__', label: '✏️ Personalizado' },
                                ]}
                            />
                        )}
                    </DockFieldRow>
                    {showCustom && !isUnitLocked && (
                        <DockFieldRow label="">
                            <input
                                type="text"
                                className={INPUT_CLS}
                                value={currentUnit}
                                onChange={e => handleUnitChange(e.target.value)}
                                placeholder="Unidad personalizada"
                                autoFocus
                            />
                        </DockFieldRow>
                    )}
                </>
            );
        })()
        : null;

    if (!selectedWidget) {
        return (
            <div className={`${ADMIN_SIDEBAR_PANEL_CLS} border-l border-white/5`}>
                <div className={`${ADMIN_SIDEBAR_PANEL_HEADER_CLS} justify-start`}>
                    <Settings2 size={14} className="text-industrial-muted" />
                    <span className={ADMIN_SIDEBAR_PANEL_TITLE_CLS}>Propiedades</span>
                </div>
                <div className="h-[calc(100%-44px)] px-5">
                    <AdminEmptyState
                        icon={MousePointerClick}
                        message="Seleccioná un widget para editar sus propiedades"
                    />
                </div>
            </div>
        );
    }

    return (
        <div className={`${ADMIN_SIDEBAR_PANEL_CLS} border-l border-white/5`}>
            <div className={ADMIN_SIDEBAR_PANEL_HEADER_CLS}>
                <div className="flex items-center gap-2">
                    <Settings2 size={14} className="text-industrial-muted" />
                    <span className={ADMIN_SIDEBAR_PANEL_TITLE_CLS}>Propiedades</span>
                    <span className="px-2 py-0.5 rounded uppercase admin-accent-ghost">
                        {selectedWidget.type}
                    </span>
                </div>
            </div>

            <div className={ADMIN_SIDEBAR_PANEL_STACK_CLS}>

                        {/* ─── GENERAL ─── */}
                        <DockSection icon={<Tag size={11} />} title="General">
                            <DockFieldRow label={isDashboardTitle ? 'Texto' : 'Título'}>
                                <input
                                    type="text"
                                    className={INPUT_CLS}
                                    value={selectedWidget.title || ''}
                                    onChange={e => onUpdateWidget({ ...selectedWidget, title: e.target.value })}
                                    placeholder={isDashboardTitle ? 'ej. Producción' : 'ej. Velocidad'}
                                />
                            </DockFieldRow>
                            {/* Subtítulo: header del widget (debajo del título). KPI y MetricCard. */}
                            {(selectedWidget.type === 'kpi' || selectedWidget.type === 'metric-card') && (
                                <DockFieldRow label="Subtítulo">
                                    <input
                                        type="text"
                                        className={INPUT_CLS}
                                        value={(selectedWidget.displayOptions as KpiDisplayOptions | MetricCardDisplayOptions | undefined)?.subtitle || ''}
                                        onChange={e => handleDisplayOptionChange('subtitle', e.target.value)}
                                        placeholder="ej. Estado: OK"
                                    />
                                </DockFieldRow>
                            )}
                            {/* Subtexto: footer del widget (parte inferior). KPI y MetricCard. */}
                              {(selectedWidget.type === 'kpi' || selectedWidget.type === 'metric-card') && (
                                  <DockFieldRow label="Subtexto">
                                     <input
                                         type="text"
                                         className={INPUT_CLS}
                                         value={(selectedWidget.displayOptions as KpiDisplayOptions | MetricCardDisplayOptions | undefined)?.subtext || ''}
                                         onChange={e => handleDisplayOptionChange('subtext', e.target.value)}
                                         placeholder="ej. Límite: 45°C"
                                      />
                                  </DockFieldRow>
                              )}
                            {shouldShowGeneralIconField && (
                                <DockFieldRow label="Ícono">
                                    <AdminSelect
                                        value={(() => {
                                            const currentIcon = selectedWidget.type === 'alert-history'
                                                ? (selectedWidget.displayOptions as AlertHistoryDisplayOptions | undefined)?.icon
                                                : selectedWidget.type === 'prod-history'
                                                    ? prodHistoryOptions?.icon
                                                    : selectedWidget.type === 'trend-chart-v2'
                                                        ? trendChartV2Options?.icon
                                                    : selectedWidget.type === 'machine-activity'
                                                        ? machineActivityOptions?.icon
                                                    : (selectedWidget.displayOptions as KpiDisplayOptions | MetricCardDisplayOptions | undefined)?.icon;
                                            if (currentIcon === undefined) return '__pending__';
                                            if (currentIcon === null) return '__none__';
                                            return currentIcon;
                                        })()}
                                        onChange={val => {
                                            if (val === '__none__') {
                                                handleDisplayOptionChange('icon', null);
                                                return;
                                            }
                                            if (val === '__pending__') {
                                                handleDisplayOptionChange('icon', '');
                                                return;
                                            }
                                            handleDisplayOptionChange('icon', val);
                                        }}
                                        options={[
                                            { value: '__pending__', label: '(Ícono pendiente)', icon: <HelpCircle size={12} /> },
                                            { value: '__none__', label: 'Sin ícono' },
                                            ...(selectedWidget.type === 'alert-history'
                                                ? [{ value: 'History', label: 'Historial', icon: <History size={12} /> }]
                                                : []
                                            ),
                                            { value: 'Gauge', label: 'Medidor', icon: <Gauge size={12} /> },
                                            { value: 'Activity', label: 'Actividad', icon: <Activity size={12} /> },
                                            { value: 'Thermometer', label: 'Termómetro', icon: <Thermometer size={12} /> },
                                            { value: 'Zap', label: 'Energía', icon: <Zap size={12} /> },
                                            { value: 'Droplet', label: 'Líquido', icon: <Droplet size={12} /> },
                                            { value: 'Wind', label: 'Flujo/Viento', icon: <Wind size={12} /> },
                                            { value: 'Settings', label: 'Mecánico', icon: <Settings size={12} /> },
                                            { value: 'Fan', label: 'Rotor', icon: <Fan size={12} /> },
                                            { value: 'FoldVertical', label: 'Compresión', icon: <FoldVertical size={12} /> },
                                            { value: 'TrendingUp', label: 'Tendencia', icon: <TrendingUp size={12} /> },
                                            { value: 'HeartPulse', label: 'Pulso', icon: <HeartPulse size={12} /> },
                                            { value: 'Siren', label: 'Sirena', icon: <Siren size={12} /> },
                                            { value: 'Wifi', label: 'Conexión', icon: <Wifi size={12} /> },
                                            { value: 'BarChart2', label: 'Barras', icon: <BarChart2 size={12} /> },
                                            { value: 'LineChart', label: 'Líneas', icon: <LineChart size={12} /> },
                                        ]}
                                    />
                                </DockFieldRow>
                            )}
                            {(isKpi || isMachineActivity) && (
                                <DockFieldRow label="Estilo">
                                    <AdminSelect
                                        value={(isMachineActivity ? machineActivityOptions : selectedWidget.displayOptions as KpiDisplayOptions | undefined)?.kpiMode || 'circular'}
                                        onChange={val => handleDisplayOptionChange('kpiMode', val)}
                                        options={[
                                            { value: 'circular', label: 'Radial' },
                                            { value: 'bar', label: 'Barra' },
                                        ]}
                                    />
                                </DockFieldRow>
                            )}
                            {isTrendChartV2 && (
                                <>
                                    <DockFieldRow label="Densidad">
                                        <AdminSelect
                                            value={normalizeHistoricalDensity(trendChartV2Options?.historicalDensity)}
                                            onChange={val => handleDisplayOptionChange('historicalDensity', val)}
                                            options={[
                                                { value: 'low', label: HISTORICAL_DENSITY_LABELS.low },
                                                { value: 'normal', label: HISTORICAL_DENSITY_LABELS.normal },
                                                { value: 'high', label: HISTORICAL_DENSITY_LABELS.high },
                                            ]}
                                        />
                                    </DockFieldRow>

                                    <DockFieldRow label="Turnos">
                                        <AdminSelect
                                            value={normalizeTrendChartV2ShiftDisplayMode(trendChartV2Options?.shiftDisplayMode)}
                                            onChange={val => handleDisplayOptionChange('shiftDisplayMode', val)}
                                            options={[
                                                { value: 'auto', label: TREND_CHART_V2_SHIFT_DISPLAY_MODE_LABELS.auto },
                                                { value: 'bands', label: TREND_CHART_V2_SHIFT_DISPLAY_MODE_LABELS.bands },
                                                { value: 'lines', label: TREND_CHART_V2_SHIFT_DISPLAY_MODE_LABELS.lines },
                                            ]}
                                        />
                                    </DockFieldRow>

                                    <label className="flex items-center gap-2 cursor-pointer group mt-1">
                                        <div className="relative flex items-center">
                                            <input
                                                type="checkbox"
                                                aria-label="Mostrar turnos"
                                                className="sr-only peer"
                                                checked={trendChartV2Options?.showShifts === true}
                                                onChange={e => handleDisplayOptionChange('showShifts', e.target.checked)}
                                            />
                                            <div className={TREND_CHART_V2_TOGGLE_TRACK_CLS}></div>
                                        </div>
                                        <span className={TREND_CHART_V2_TOGGLE_LABEL_CLS}>
                                            Mostrar turnos
                                        </span>
                                    </label>

                                </>
                            )}
                            {selectedWidget.type === 'prod-history' && (
                                <>
                                    <DockFieldRow label="Producción">
                                        <AdminSelect
                                            value={prodHistoryOptions?.productionChartMode ?? 'bars'}
                                            onChange={val => handleDisplayOptionChange('productionChartMode', val)}
                                            options={[
                                                { value: 'bars', label: 'Barras', icon: <BarChart2 size={12} /> },
                                                { value: 'area', label: 'Área', icon: <AreaChart size={12} /> },
                                            ]}
                                        />
                                    </DockFieldRow>

                                    <label className="flex items-center gap-2 cursor-pointer group mt-1">
                                        <div className="relative flex items-center">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={!!prodHistoryOptions?.oeeShowArea}
                                                onChange={e => handleDisplayOptionChange('oeeShowArea', e.target.checked)}
                                            />
                                            <div className="w-7 h-4 rounded-full border border-transparent bg-white/10 transition-all peer peer-checked:bg-white/20 peer-checked:border-white/30 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all"></div>
                                        </div>
                                        <span className="text-white/70 peer-checked:text-white group-hover:!text-white group-hover:drop-shadow-[0_0_5px_rgba(255,255,255,0.4)] transition-all whitespace-nowrap">
                                            Relleno bajo línea OEE
                                        </span>
                                    </label>

                                    <label className="flex items-center gap-2 cursor-pointer group mt-1">
                                        <div className="relative flex items-center">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={!!prodHistoryOptions?.oeeShowPoints}
                                                onChange={e => handleDisplayOptionChange('oeeShowPoints', e.target.checked)}
                                            />
                                            <div className="w-7 h-4 rounded-full border border-transparent bg-white/10 transition-all peer peer-checked:bg-white/20 peer-checked:border-white/30 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all"></div>
                                        </div>
                                        <span className="text-white/70 peer-checked:text-white group-hover:!text-white group-hover:drop-shadow-[0_0_5px_rgba(255,255,255,0.4)] transition-all whitespace-nowrap">
                                            Puntos en OEE
                                        </span>
                                    </label>

                                    <DockFieldRow label="Ancho barra">
                                        <div className="flex w-full items-center gap-3">
                                            <input
                                                type="range"
                                                min="0.5"
                                                max="1.5"
                                                step="0.1"
                                                value={prodHistoryBarWidth}
                                                onChange={e => handleDisplayOptionChange('productionBarWidth', Math.min(1.5, Math.max(0.5, Number(e.target.value))))}
                                                className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10"
                                                style={{ accentColor: 'var(--color-admin-accent)' }}
                                            />
                                            <span className="w-10 text-right uppercase text-industrial-muted">
                                                ×{prodHistoryBarWidth.toFixed(1)}
                                            </span>
                                        </div>
                                    </DockFieldRow>
                                </>
                            )}

                            {selectedWidget.type === 'status' && (
                                <>
                                    {STATUS_TEXT_FIELDS.map(({ key, label, placeholder }) => (
                                        <DockFieldRow key={key} label={label}>
                                            <input
                                                type="text"
                                                className={INPUT_CLS}
                                                value={(selectedWidget.displayOptions as StatusDisplayOptions | undefined)?.[key] || ''}
                                                onChange={e => handleDisplayOptionChange(key, e.target.value)}
                                                placeholder={placeholder}
                                            />
                                        </DockFieldRow>
                                    ))}
                                </>
                            )}
                            {isDashboardTitle && (() => {
                                const currentAlign = (selectedWidget.displayOptions as TextTitleDisplayOptions | undefined)?.textAlign ?? 'left';
                                const currentColor: TextTitleColor = (selectedWidget.displayOptions as TextTitleDisplayOptions | undefined)?.textColor ?? 'muted';
                                return (
                                    <>
                                        <DockFieldRow label="Tamaño">
                                            <AdminNumberInput
                                                value={(selectedWidget.displayOptions as TextTitleDisplayOptions | undefined)?.fontSize ?? DEFAULT_TEXT_TITLE_FONT_SIZE}
                                                min={12}
                                                max={200}
                                                step={1}
                                                commitOnBlur
                                                onChange={val => handleNumericDisplayOptionChange('fontSize', val)}
                                            />
                                        </DockFieldRow>
                                        <DockFieldRow label="Alinear">
                                            <div className="flex gap-1">
                                                {([
                                                    { value: 'left' as const, Icon: AlignLeft },
                                                    { value: 'center' as const, Icon: AlignCenter },
                                                    { value: 'right' as const, Icon: AlignRight },
                                                ]).map(({ value, Icon }) => (
                                                    <button
                                                        key={value}
                                                        type="button"
                                                        onClick={() => handleDisplayOptionChange('textAlign', value)}
                                                        className={`p-1.5 rounded transition-colors ${currentAlign === value ? 'bg-white/10 text-white' : 'text-industrial-muted hover:text-white hover:bg-white/5'}`}
                                                    >
                                                        <Icon size={14} />
                                                    </button>
                                                ))}
                                            </div>
                                        </DockFieldRow>
                                        <DockFieldRow label="Color">
                                            <div className="flex gap-1.5">
                                                {([
                                                    { value: 'white' as TextTitleColor, bg: 'var(--color-industrial-text)' },
                                                    { value: 'soft' as TextTitleColor, bg: 'var(--color-industrial-text-soft)' },
                                                    { value: 'muted' as TextTitleColor, bg: 'var(--color-industrial-muted)' },
                                                ]).map(({ value, bg }) => (
                                                    <button
                                                        key={value}
                                                        type="button"
                                                        onClick={() => handleDisplayOptionChange('textColor', value)}
                                                        className={`w-5 h-5 rounded-sm transition-all ${currentColor === value ? 'ring-1 ring-white/50' : 'border border-white/10'}`}
                                                        style={{ backgroundColor: bg }}
                                                    />
                                                ))}
                                            </div>
                                        </DockFieldRow>
                                    </>
                                );
                            })()}
                        </DockSection>

                        {/* ─── DATOS — no aplica para alert-history ni prod-history (datos mock propios) ─── */}
                        {selectedWidget.type !== 'alert-history' && selectedWidget.type !== 'prod-history' && selectedWidget.type !== 'text-title' && (
                            <DockSection icon={<Database size={11} />} title="Datos">
                                {hasHierarchySupport && (
                                    <DockFieldRow label="Fuente">
                                        <AdminSelect
                                            value={isHierarchyModeEnabled ? 'hierarchy' : 'own'}
                                            onChange={(val) => {
                                                onUpdateWidget({
                                                    ...selectedWidget,
                                                    hierarchyMode: val === 'hierarchy',
                                                    aggregation: val === 'hierarchy'
                                                        ? (selectedWidget.aggregation ?? 'sum')
                                                        : selectedWidget.aggregation,
                                                });
                                            }}
                                            options={[
                                                { value: 'own', label: 'Usa valor propio' },
                                                { value: 'hierarchy', label: 'Calcula desde jerarquía' },
                                            ]}
                                        />
                                    </DockFieldRow>
                                )}

                                {isActivityAnalytics ? (
                                    <>
                                        <DockFieldRow label="Equipo">
                                            {dataLoading ? (
                                                <div className={`${INPUT_CLS} flex items-center gap-2 text-industrial-muted`}>
                                                    <Loader2 size={12} className="animate-spin" />
                                                    <span>Cargando equipos...</span>
                                                </div>
                                            ) : dataError ? (
                                                <div className={`${INPUT_CLS} flex items-center text-status-critical`}>
                                                    Error cargando equipos
                                                </div>
                                            ) : !dataEnabled ? (
                                                <div className={`${INPUT_CLS} flex items-center text-industrial-muted`}>
                                                    No configurado
                                                </div>
                                            ) : machines.length === 0 ? (
                                                <AdminSelect
                                                    disabled
                                                    value=""
                                                    onChange={() => undefined}
                                                    placeholder="Sin equipos"
                                                    options={[]}
                                                />
                                            ) : (
                                                <AdminSelect
                                                    value={binding.machineId != null ? String(binding.machineId) : ''}
                                                    onChange={handleMachineChange}
                                                    placeholder="Seleccione..."
                                                    options={machines.map(machine => ({
                                                        value: String(machine.unitId),
                                                        label: machine.name,
                                                    }))}
                                                />
                                            )}
                                        </DockFieldRow>

                                        <DockFieldRow label="Rango">
                                            <AdminSelect
                                                value={activityAnalyticsOptions?.range ?? '7d'}
                                                onChange={handleActivityAnalyticsRangeChange}
                                                options={ACTIVITY_ANALYTICS_RANGE_OPTIONS}
                                            />
                                        </DockFieldRow>
                                    </>
                                ) : (
                                    <>
                                        {genericDataUnitField}

                                        {hasCatalogSupport && (
                                    <>
                                        <DockFieldRow label={<><span>Variable{isCatalogVariableRequired ? <span className="text-status-warning">*</span> : null}</span></>}>
                                            <CatalogVariableSelector
                                                variables={filteredCatalogVariables}
                                                selectedId={binding.catalogVariableId}
                                                usedIds={usedCatalogVariableIds}
                                                hasRequiredError={Boolean(binding.unit && hasCatalogVariablesForUnit && !binding.catalogVariableId)}
                                                disabled={!binding.unit}
                                                onChange={handleCatalogVariableChange}
                                                onDelete={onDeleteVariable}
                                                onCreateNew={(name) => {
                                                    if (!binding.unit) {
                                                        return;
                                                    }

                                                    onCreateVariable(name, binding.unit);
                                                }}
                                            />
                                        </DockFieldRow>

                                        {binding.unit && !hasCatalogVariablesForUnit && !isHierarchyModeEnabled && (
                                            <DockInfoBox variant="normal" text="Sin variables para esta unidad. Podés crear una nueva desde el selector." />
                                        )}

                                        {binding.unit && hasCatalogVariablesForUnit && !binding.catalogVariableId && (
                                            <DockInfoBox variant="warning" text="La unidad ya tiene variables. Selecciona una o crea una nueva desde el selector." />
                                        )}

                                        <DockFieldRow label="Operación">
                                            <AdminSelect
                                                value={selectedWidget.aggregation ?? 'sum'}
                                                disabled={isAggregationDisabled}
                                                onChange={val => onUpdateWidget({
                                                    ...selectedWidget,
                                                    aggregation: val as AggregationMode,
                                                })}
                                                options={[
                                                    { value: 'sum', label: 'Suma' },
                                                    { value: 'avg', label: 'Promedio' },
                                                    { value: 'max', label: 'Máximo' },
                                                    { value: 'min', label: 'Mínimo' },
                                                ]}
                                            />
                                        </DockFieldRow>
                                    </>
                                        )}

                                        <>
                                        <DockFieldRow label="Origen">
                                            {isConnectionWidget ? (
                                                <AdminSelect
                                                    value={connectionOrigin}
                                                    disabled={isBindingSourceDisabled}
                                                    onChange={val => handleConnectionOriginChange(val as 'simulated_value' | 'global' | 'machine')}
                                                    options={[
                                                        { value: 'simulated_value', label: 'Simulado' },
                                                        { value: 'global', label: 'Global' },
                                                        { value: 'machine', label: 'Por Máquina' },
                                                    ]}
                                                />
                                            ) : (
                                                <AdminSelect
                                                    value={binding.mode}
                                                    disabled={isBindingSourceDisabled}
                                                    onChange={val => handleModeChange(val as WidgetBinding['mode'])}
                                                    options={[
                                                        { value: 'simulated_value', label: 'Simulado' },
                                                        { value: 'real_variable', label: 'Variable Real' },
                                                    ]}
                                                />
                                            )}
                                        </DockFieldRow>

                                        {binding.mode === 'simulated_value' && (
                                            <DockFieldRow label="Valor">
                                                {isConnectionWidget ? (
                                                    <AdminSelect
                                                        disabled={isBindingSourceDisabled}
                                                        value={(() => {
                                                            const raw = typeof binding.simulatedValue === 'string'
                                                                ? binding.simulatedValue.trim().toLowerCase()
                                                                : '';
                                                            const valid = ['online', 'degradado', 'offline', 'unknown'];
                                                            if (valid.includes(raw)) return raw;
                                                            if (raw === 'degraded' || raw === 'stale') return 'degradado';
                                                            if (raw === '1' || raw === 'true' || raw === 'connected') return 'online';
                                                            if (raw === '0' || raw === 'false' || raw === 'disconnected') return 'offline';
                                                            if (typeof binding.simulatedValue === 'number') return binding.simulatedValue === 1 ? 'online' : 'offline';
                                                            if (typeof binding.simulatedValue === 'boolean') return binding.simulatedValue ? 'online' : 'offline';
                                                            return 'unknown';
                                                        })()}
                                                        onChange={val => {
                                                            onUpdateWidget({
                                                                ...selectedWidget,
                                                                binding: {
                                                                    ...binding,
                                                                    simulatedValue: val,
                                                                }
                                                            });
                                                        }}
                                                        options={[
                                                            { value: 'online', label: 'Online' },
                                                            { value: 'degradado', label: 'Degradado' },
                                                            { value: 'offline', label: 'Sin señal' },
                                                            { value: 'unknown', label: 'Sin datos' },
                                                        ]}
                                                    />
                                                ) : selectedWidget.type === 'status' ? (
                                                    <AdminSelect
                                                        disabled={isBindingSourceDisabled}
                                                        value={normalizeSimulatedEquipmentStatus(binding.simulatedValue)}
                                                        onChange={val => {
                                                            onUpdateWidget({
                                                                ...selectedWidget,
                                                                binding: {
                                                                    ...binding,
                                                                    simulatedValue: val,
                                                                }
                                                            });
                                                        }}
                                                        options={EQUIPMENT_STATUS_VALUES.map(status => ({
                                                            value: status,
                                                            label: DEFAULT_STATUS_LABELS[status],
                                                        }))}
                                                    />
                                                ) : (
                                                    <AdminNumberInput
                                                        value={(binding.simulatedValue as string | number) ?? ''}
                                                        disabled={isBindingSourceDisabled}
                                                        commitOnBlur
                                                        onChange={handleSimulatedValueChange}
                                                        placeholder="Ej. 1500"
                                                        className={`justify-end ${isBindingSourceDisabled ? 'opacity-50' : ''}`}
                                                    />
                                                )}
                                            </DockFieldRow>
                                        )}

                                        {binding.mode === 'simulated_value' && (isKpi || isMachineActivity) && (
                                            <DockFieldRow label="Unidad">
                                                <AdminSelect
                                                    value={customUnitInputValue}
                                                    onChange={handleWidgetSimulatedUnitChange}
                                                    placeholder="Seleccionar"
                                                    disabled={isBindingSourceDisabled}
                                                    options={getUnitSelectOptions(customUnitInputValue)}
                                                />
                                            </DockFieldRow>
                                        )}

                                        {binding.mode === 'real_variable' && (
                                            <>
                                                {(!isConnectionWidget || connectionScope === 'machine' || connectionScope === 'global') && (
                                                    <DockFieldRow label="Equipo">
                                                        {isConnectionWidget && connectionScope === 'global' ? (
                                                            <AdminSelect
                                                                disabled
                                                                value=""
                                                                onChange={() => undefined}
                                                                placeholder="Todos los equipos"
                                                                options={[]}
                                                            />
                                                        ) : dataLoading ? (
                                                            <div className={`${INPUT_CLS} flex items-center gap-2 text-industrial-muted`}>
                                                                <Loader2 size={12} className="animate-spin" />
                                                                <span>Cargando equipos...</span>
                                                            </div>
                                                        ) : dataError ? (
                                                            <div className={`${INPUT_CLS} flex items-center text-status-critical`}>
                                                                Error cargando equipos
                                                            </div>
                                                        ) : !dataEnabled ? (
                                                            <div className={`${INPUT_CLS} flex items-center text-industrial-muted`}>
                                                                No configurado
                                                            </div>
                                                        ) : machines.length === 0 ? (
                                                            <AdminSelect
                                                                disabled
                                                                value=""
                                                                onChange={() => undefined}
                                                                placeholder="Sin equipos"
                                                                options={[]}
                                                            />
                                                        ) : isConnectionWidget ? (
                                                            <AdminSelect
                                                                disabled={isBindingSourceDisabled}
                                                                value={connectionDisplayOptions?.machineId != null ? String(connectionDisplayOptions.machineId) : ''}
                                                                onChange={handleConnectionMachineDisplayChange}
                                                                placeholder="Seleccione..."
                                                                options={machines.map(machine => ({
                                                                    value: String(machine.unitId),
                                                                    label: machine.name,
                                                                }))}
                                                            />
                                                        ) : (
                                                            <AdminSelect
                                                                disabled={isBindingSourceDisabled}
                                                                value={binding.machineId != null ? String(binding.machineId) : ''}
                                                                onChange={handleMachineChange}
                                                                placeholder="Seleccione..."
                                                                options={machines.map(machine => ({
                                                                    value: String(machine.unitId),
                                                                    label: machine.name,
                                                                }))}
                                                            />
                                                        )}
                                                    </DockFieldRow>
                                                )}
                                                {selectedWidget.type !== 'connection-status' && selectedWidget.type !== 'status' && (
                                                    <DockFieldRow label="Variable">
                                                        {dataLoading ? (
                                                            <div className={`${INPUT_CLS} flex items-center gap-2 text-industrial-muted`}>
                                                                <Loader2 size={12} className="animate-spin" />
                                                                <span>Cargando equipos...</span>
                                                            </div>
                                                        ) : dataError ? (
                                                            <div className={`${INPUT_CLS} flex items-center text-status-critical`}>
                                                                Error cargando equipos
                                                            </div>
                                                        ) : !dataEnabled ? (
                                                            <div className={`${INPUT_CLS} flex items-center text-industrial-muted`}>
                                                                No configurado
                                                            </div>
                                                        ) : machines.length === 0 ? (
                                                            <AdminSelect
                                                                disabled
                                                                value=""
                                                                onChange={() => undefined}
                                                                placeholder="Sin variables"
                                                                options={[]}
                                                            />
                                                        ) : (
                                                            <AdminSelect
                                                                disabled={isBindingSourceDisabled || !selectedMachine}
                                                                value={binding.variableKey || ''}
                                                                onChange={handleVariableChange}
                                                                placeholder="Seleccione..."
                                                                options={Object.entries(selectedMachine?.values ?? {}).map(([key, variable]) => ({
                                                                    value: key,
                                                                    label: key + (variable.unit ? ` (${variable.unit})` : ''),
                                                                }))}
                                                            />
                                                        )}
                                                    </DockFieldRow>
                                                )}

                                                {(isKpi || isMachineActivity) && !isConnectionWidget && (
                                                    <>
                                                        <label className="flex items-center gap-2 cursor-pointer group mt-1">
                                                            <div className="relative flex items-center">
                                                                <input
                                                                    type="checkbox"
                                                                    className="sr-only peer"
                                                                    checked={isUnitOverrideEnabled}
                                                                    onChange={e => handleWidgetUnitOverrideChange(e.target.checked)}
                                                                />
                                                                <div className="w-7 h-4 rounded-full border border-transparent bg-white/10 transition-all peer peer-checked:bg-white/20 peer-checked:border-white/30 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all"></div>
                                                            </div>
                                                            <span className="text-white/70 peer-checked:text-white group-hover:!text-white group-hover:drop-shadow-[0_0_5px_rgba(255,255,255,0.4)] transition-all whitespace-nowrap">
                                                                Unidad custom
                                                            </span>
                                                        </label>

                                                        <DockFieldRow label="Unidad">
                                                            <AdminSelect
                                                                value={isUnitOverrideEnabled ? customUnitInputValue : resolvedUnitPreviewValue}
                                                                onChange={handleWidgetDisplayUnitChange}
                                                                placeholder="Seleccionar"
                                                                disabled={!isUnitOverrideEnabled}
                                                                options={getUnitSelectOptions(isUnitOverrideEnabled ? customUnitInputValue : resolvedUnitPreviewValue)}
                                                            />
                                                        </DockFieldRow>
                                                        </>
                                                )}
                                            </>
                                        )}

                                        {isConnectionWidget && (
                                            <label className="flex items-center gap-2 cursor-pointer group mt-1">
                                                <div className="relative flex items-center">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only peer"
                                                        checked={connectionDisplayOptions?.showLastUpdate !== false}
                                                        onChange={e => handleDisplayOptionChange('showLastUpdate', e.target.checked)}
                                                    />
                                                    <div className="w-7 h-4 rounded-full border border-transparent bg-white/10 transition-all peer peer-checked:bg-white/20 peer-checked:border-white/30 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all"></div>
                                                </div>
                                                <span className="text-white/70 peer-checked:text-white group-hover:!text-white group-hover:drop-shadow-[0_0_5px_rgba(255,255,255,0.4)] transition-all whitespace-nowrap">
                                                    Mostrar Tiempo
                                                </span>
                                            </label>
                                        )}
                                        </>
                                    </>
                                )}
                            </DockSection>
                        )}

                        {isActivityAnalytics && (
                            <DockSection icon={<BarChart2 size={11} />} title="Agrupación">
                                <DockFieldRow label="Grupo">
                                    <AdminSelect
                                        value={activityAnalyticsOptions?.groupBy ?? 'day'}
                                        onChange={handleActivityAnalyticsGroupChange}
                                        options={ACTIVITY_ANALYTICS_GROUP_OPTIONS.filter((option) => activityAnalyticsDisplayRules?.allowedGroups.includes(option.value) ?? false)}
                                    />
                                </DockFieldRow>
                            </DockSection>
                        )}

                        {isConnectionWidget && (
                            <DockSection icon={<Settings size={11} />} title="Textos" defaultOpen={false}>
                                {CONNECTION_STATUS_TEXT_FIELDS.map(({ key, label, placeholder }) => (
                                    <DockFieldRow key={key} label={label}>
                                        <input
                                            type="text"
                                            className={INPUT_CLS}
                                            value={connectionDisplayOptions?.[key] || ''}
                                            onChange={e => handleDisplayOptionChange(key, e.target.value)}
                                            placeholder={placeholder}
                                        />
                                    </DockFieldRow>
                                ))}
                            </DockSection>
                        )}

                        {isMachineActivity && (
                            <DockSection icon={<Sliders size={11} />} title="Escala Visual">
                                <DockFieldRow label={machineActivityScaleMinLabel}>
                                    <AdminNumberInput
                                        value={machineActivityOptions?.powerMin ?? 0}
                                        step={0.01}
                                        commitOnBlur
                                        onChange={val => handleNumericDisplayOptionChange('powerMin', val)}
                                    />
                                </DockFieldRow>
                                <DockFieldRow label={machineActivityScaleMaxLabel}>
                                    <AdminNumberInput
                                        value={machineActivityOptions?.powerMax ?? 1}
                                        step={0.01}
                                        commitOnBlur
                                        onChange={val => handleNumericDisplayOptionChange('powerMax', val)}
                                    />
                                </DockFieldRow>
                            </DockSection>
                        )}

                        {isMachineActivity && (
                            <DockSection icon={<Activity size={11} />} title="Estados Productivos">
                                <DockFieldRow label="Setup ≥">
                                    <AdminNumberInput
                                        value={machineActivityOptions?.thresholdStopped ?? 0.15}
                                        min={0}
                                        step={0.01}
                                        commitOnBlur
                                        onChange={val => handleNumericDisplayOptionChange('thresholdStopped', val)}
                                    />
                                </DockFieldRow>
                                <DockFieldRow label="Prod. ≥">
                                    <AdminNumberInput
                                        value={machineActivityOptions?.thresholdProducing ?? 0.25}
                                        min={0}
                                        step={0.01}
                                        commitOnBlur
                                        onChange={val => handleNumericDisplayOptionChange('thresholdProducing', val)}
                                    />
                                </DockFieldRow>
                                <DockFieldRow label="Histéresis">
                                    <AdminNumberInput
                                        value={machineActivityOptions?.hysteresis ?? 0.05}
                                        min={0}
                                        step={0.01}
                                        commitOnBlur
                                        onChange={val => handleNumericDisplayOptionChange('hysteresis', val)}
                                    />
                                </DockFieldRow>
                                <DockFieldRow label="Conf. (ms)">
                                    <AdminNumberInput
                                        value={machineActivityOptions?.confirmationTime ?? 2000}
                                        min={0}
                                        step={100}
                                        commitOnBlur
                                        onChange={val => handleNumericDisplayOptionChange('confirmationTime', val)}
                                    />
                                </DockFieldRow>
                                <DockFieldRow label="Suavizado" labelClassName={isSimulatedBinding ? 'text-industrial-muted' : ''}>
                                    <AdminNumberInput
                                        value={machineActivityOptions?.smoothingWindow ?? 5}
                                        min={1}
                                        step={1}
                                        commitOnBlur
                                        disabled={isSimulatedBinding}
                                        onChange={val => handleNumericDisplayOptionChange('smoothingWindow', val)}
                                    />
                                </DockFieldRow>
                            </DockSection>
                        )}

                        {isActivityAnalytics && (
                            <DockSection icon={<Activity size={11} />} title="Estados Productivos">
                                <DockFieldRow label="Setup ≥">
                                    <AdminNumberInput
                                        value={activityAnalyticsOptions?.setupThresholdKw ?? 0.15}
                                        min={0}
                                        step={0.01}
                                        commitOnBlur
                                        onChange={val => handleActivityAnalyticsThresholdChange('setupThresholdKw', val)}
                                    />
                                </DockFieldRow>
                                <DockFieldRow label="Prod. ≥">
                                    <AdminNumberInput
                                        value={activityAnalyticsOptions?.prodThresholdKw ?? 0.25}
                                        min={0}
                                        step={0.01}
                                        commitOnBlur
                                        onChange={val => handleActivityAnalyticsThresholdChange('prodThresholdKw', val)}
                                    />
                                </DockFieldRow>
                                {activityAnalyticsThresholdWarning && (
                                    <DockInfoBox variant="warning" text={activityAnalyticsThresholdWarning} />
                                )}
                            </DockSection>
                        )}

                        {isMachineActivity && (
                            <DockSection icon={<Settings size={11} />} title="Visualización">
                                <label className="flex items-center gap-2 cursor-pointer group mt-1">
                                    <div className="relative flex items-center">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={machineActivityOptions?.showStateSubtitle !== false}
                                            onChange={e => handleDisplayOptionChange('showStateSubtitle', e.target.checked)}
                                        />
                                        <div className="w-7 h-4 rounded-full border border-transparent bg-white/10 transition-all peer peer-checked:bg-white/20 peer-checked:border-white/30 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all"></div>
                                    </div>
                                    <span className="text-white/70 peer-checked:text-white group-hover:!text-white group-hover:drop-shadow-[0_0_5px_rgba(255,255,255,0.4)] transition-all whitespace-nowrap">
                                        Mostrar subtítulo de estado
                                    </span>
                                </label>

                                <label className="flex items-center gap-2 cursor-pointer group mt-1">
                                    <div className="relative flex items-center">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={machineActivityOptions?.showPowerSubtext !== false}
                                            onChange={e => handleDisplayOptionChange('showPowerSubtext', e.target.checked)}
                                        />
                                        <div className="w-7 h-4 rounded-full border border-transparent bg-white/10 transition-all peer peer-checked:bg-white/20 peer-checked:border-white/30 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all"></div>
                                    </div>
                                    <span className="text-white/70 peer-checked:text-white group-hover:!text-white group-hover:drop-shadow-[0_0_5px_rgba(255,255,255,0.4)] transition-all whitespace-nowrap">
                                        {isSimulatedBinding ? 'Mostrar valor en subtexto' : 'Mostrar variable en subtexto'}
                                    </span>
                                </label>

                                <label className="flex items-center gap-2 cursor-pointer group mt-1">
                                    <div className="relative flex items-center">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={machineActivityOptions?.showDynamicColor !== false}
                                            onChange={e => handleDisplayOptionChange('showDynamicColor', e.target.checked)}
                                        />
                                        <div className="w-7 h-4 rounded-full border border-transparent bg-white/10 transition-all peer peer-checked:bg-white/20 peer-checked:border-white/30 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all"></div>
                                    </div>
                                    <span className="text-white/70 peer-checked:text-white group-hover:!text-white group-hover:drop-shadow-[0_0_5px_rgba(255,255,255,0.4)] transition-all whitespace-nowrap">
                                        Color dinámico por estado
                                    </span>
                                </label>

                                <label className="flex items-center gap-2 cursor-pointer group mt-1">
                                    <div className="relative flex items-center">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={machineActivityOptions?.showStateAnimation !== false}
                                            onChange={e => handleDisplayOptionChange('showStateAnimation', e.target.checked)}
                                        />
                                        <div className="w-7 h-4 rounded-full border border-transparent bg-white/10 transition-all peer peer-checked:bg-white/20 peer-checked:border-white/30 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all"></div>
                                    </div>
                                    <span className="text-white/70 peer-checked:text-white group-hover:!text-white group-hover:drop-shadow-[0_0_5px_rgba(255,255,255,0.4)] transition-all whitespace-nowrap">
                                        Animación por estado
                                    </span>
                                </label>
                            </DockSection>
                        )}

                        {isMachineActivity && (
                            <DockSection icon={<Tag size={11} />} title="Textos">
                                <DockFieldRow label="Detenida">
                                    <input
                                        type="text"
                                        className={INPUT_CLS}
                                        value={machineActivityOptions?.labelStopped ?? 'Detenida'}
                                        onChange={e => handleDisplayOptionChange('labelStopped', e.target.value)}
                                        placeholder="Detenida"
                                    />
                                </DockFieldRow>
                                <DockFieldRow label="Setup">
                                    <input
                                        type="text"
                                        className={INPUT_CLS}
                                        value={machineActivityOptions?.labelCalibrating ?? 'Setup'}
                                        onChange={e => handleDisplayOptionChange('labelCalibrating', e.target.value)}
                                        placeholder="Setup"
                                    />
                                </DockFieldRow>
                                <DockFieldRow label="Produciendo">
                                    <input
                                        type="text"
                                        className={INPUT_CLS}
                                        value={machineActivityOptions?.labelProducing ?? 'Produciendo'}
                                        onChange={e => handleDisplayOptionChange('labelProducing', e.target.value)}
                                        placeholder="Produciendo"
                                    />
                                </DockFieldRow>
                            </DockSection>
                        )}

                        {/* ─── ESCALA VISUAL (solo KPI) ─── */}
                        {isKpi && (
                            <DockSection icon={<Sliders size={11} />} title="Escala Visual">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <span className={LABEL_CLS}>{kpiScaleMinLabel}</span>
                                        <AdminNumberInput
                                            value={(selectedWidget.displayOptions as KpiDisplayOptions | undefined)?.min ?? 0}
                                            onChange={val => handleDisplayOptionChange('min', val)}
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={LABEL_CLS}>{kpiScaleMaxLabel}</span>
                                        <AdminNumberInput
                                            value={(selectedWidget.displayOptions as KpiDisplayOptions | undefined)?.max ?? 100}
                                            onChange={val => handleDisplayOptionChange('max', val)}
                                        />
                                    </div>
                                </div>
                                {/* Toggle Color Dinámico */}
                                <label className="flex items-center gap-2 cursor-pointer group mt-1">
                                    <div className="relative flex items-center">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={!!(selectedWidget.displayOptions as KpiDisplayOptions | undefined)?.dynamicColor}
                                            onChange={e => handleDisplayOptionChange('dynamicColor', e.target.checked)}
                                        />
                                        <div className="w-7 h-4 rounded-full border border-transparent bg-white/10 transition-all peer peer-checked:bg-white/20 peer-checked:border-white/30 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all"></div>
                                    </div>
                                    <span className="text-white/70 peer-checked:text-white group-hover:!text-white group-hover:drop-shadow-[0_0_5px_rgba(255,255,255,0.4)] transition-all whitespace-nowrap">
                                        Color Dinámico
                                    </span>
                                </label>
                            </DockSection>
                        )}

                        {/* ─── UMBRALES ─── */}
                        {showThresholds && (
                            <DockSection icon={<Zap size={11} />} title="Umbrales">
                                {/* Toggle Activar Umbrales */}
                                <label className="flex items-center gap-2 cursor-pointer group mb-1">
                                    <div className="relative flex items-center">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={thresholds.length > 0}
                                            onChange={e => {
                                                if (!selectedWidget) return;
                                                if (e.target.checked) {
                                                    onUpdateWidget({
                                                        ...selectedWidget,
                                                        thresholds: [
                                                            { severity: 'warning', value: 0 },
                                                            { severity: 'critical', value: 0 },
                                                        ],
                                                        deadbandPercent: 5,
                                                    });
                                                } else {
                                                    onUpdateWidget({ ...selectedWidget, thresholds: [] });
                                                }
                                            }}
                                        />
                                        <div className="w-7 h-4 rounded-full border border-transparent bg-white/10 transition-all peer peer-checked:bg-white/20 peer-checked:border-white/30 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all"></div>
                                    </div>
                                    <span className="text-white/70 peer-checked:text-white group-hover:!text-white group-hover:drop-shadow-[0_0_5px_rgba(255,255,255,0.4)] transition-all whitespace-nowrap">
                                        Activar Umbrales
                                    </span>
                                </label>
                                {/* ALR ≥ field */}
                                <DockFieldRow
                                    label="ALR ≥"
                                    labelClassName={thresholds.length > 0 ? '' : 'text-industrial-muted'}
                                    labelStyle={thresholds.length > 0 ? { color: 'var(--color-status-warning)' } : undefined}
                                    controlClassName="flex justify-end"
                                >
                                    <AdminNumberInput
                                        value={thresholds.find(t => t.severity === 'warning')?.value ?? 0}
                                        disabled={thresholds.length === 0}
                                        commitOnBlur
                                        onChange={val => {
                                            const idx = thresholds.findIndex(t => t.severity === 'warning');
                                            if (idx >= 0) handleUpdateThreshold(idx, parseFloat(val) || 0);
                                        }}
                                    />
                                </DockFieldRow>
                                {/* CRI ≥ field */}
                                <DockFieldRow
                                    label="CRI ≥"
                                    labelClassName={thresholds.length > 0 ? '' : 'text-industrial-muted'}
                                    labelStyle={thresholds.length > 0 ? { color: 'var(--color-status-critical)' } : undefined}
                                    controlClassName="flex justify-end"
                                >
                                    <AdminNumberInput
                                        value={thresholds.find(t => t.severity === 'critical')?.value ?? 0}
                                        disabled={thresholds.length === 0}
                                        commitOnBlur
                                        onChange={val => {
                                            const idx = thresholds.findIndex(t => t.severity === 'critical');
                                            if (idx >= 0) handleUpdateThreshold(idx, parseFloat(val) || 0);
                                        }}
                                    />
                                </DockFieldRow>
                                {/* Deadband field — siempre visible, deshabilitado cuando los umbrales están inactivos */}
                                <DockFieldRow
                                    label="Deadband"
                                    labelClassName={thresholds.length > 0 ? '' : 'text-industrial-muted'}
                                    controlClassName="flex justify-end"
                                >
                                    <AdminNumberInput
                                        value={selectedWidget.deadbandPercent ?? 5}
                                        min={0}
                                        max={50}
                                        step={1}
                                        commitOnBlur
                                        prefix="%"
                                        disabled={thresholds.length === 0}
                                        onChange={val => {
                                            if (!selectedWidget) return;
                                            onUpdateWidget({
                                                ...selectedWidget,
                                                deadbandPercent: parseFloat(val) || 0,
                                            });
                                        }}
                                    />
                                </DockFieldRow>
                            </DockSection>
                        )}

                        {selectedWidget.type === 'prod-history' && (
                            <DockSection icon={<Database size={11} />} title="Datos">
                                <div className="flex items-center gap-2">
                                    <span className={LABEL_CLS}>Unidad</span>
                                    <AdminSelect
                                        value={prodHistoryOptions?.productionUnit ?? 'unidades'}
                                        onChange={val => handleDisplayOptionChange('productionUnit', val)}
                                        options={[
                                            { value: 'unidades', label: 'unidades' },
                                            { value: 'kg', label: 'kg' },
                                            { value: 'tn', label: 'tn' },
                                            { value: 'cuñetes', label: 'cuñetes' },
                                        ]}
                                    />
                                </div>

                                <div className="flex items-center gap-2">
                                    <span className={LABEL_CLS}>Origen</span>
                                    <AdminSelect
                                        value={binding.mode}
                                        onChange={val => handleModeChange(val as WidgetBinding['mode'])}
                                        options={[
                                            { value: 'simulated_value', label: 'Simulado' },
                                            { value: 'real_variable', label: 'Real' },
                                        ]}
                                    />
                                </div>

                                {binding.mode === 'real_variable' && (
                                    <>
                                        <div className="flex items-center gap-2">
                                            <span className={LABEL_CLS}>Var. Prod.</span>
                                            {selectedAsset ? (
                                                <AdminSelect
                                                    value={prodHistoryOptions?.productionVariableKey || ''}
                                                    onChange={val => handleDisplayOptionChange('productionVariableKey', val)}
                                                    placeholder="Seleccione..."
                                                    options={selectedAsset.primaryMetrics.map(metric => ({
                                                        value: metric.label,
                                                        label: metric.label,
                                                    }))}
                                                />
                                            ) : (
                                                <input
                                                    type="text"
                                                    className={INPUT_CLS}
                                                    value={prodHistoryOptions?.productionVariableKey || ''}
                                                    onChange={e => handleDisplayOptionChange('productionVariableKey', e.target.value)}
                                                    placeholder="Clave variable producción"
                                                />
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <span className={LABEL_CLS}>Var. OEE</span>
                                            {selectedAsset ? (
                                                <AdminSelect
                                                    value={prodHistoryOptions?.oeeVariableKey || ''}
                                                    onChange={val => handleDisplayOptionChange('oeeVariableKey', val)}
                                                    placeholder="Seleccione..."
                                                    options={selectedAsset.primaryMetrics.map(metric => ({
                                                        value: metric.label,
                                                        label: metric.label,
                                                    }))}
                                                />
                                            ) : (
                                                <input
                                                    type="text"
                                                    className={INPUT_CLS}
                                                    value={prodHistoryOptions?.oeeVariableKey || ''}
                                                    onChange={e => handleDisplayOptionChange('oeeVariableKey', e.target.value)}
                                                    placeholder="Clave variable OEE"
                                                />
                                            )}
                                        </div>
                                    </>
                                )}
                            </DockSection>
                        )}

                        {selectedWidget.type === 'prod-history' && (
                            <DockSection icon={<Activity size={11} />} title="Series">
                                <label className="flex items-center gap-2 cursor-pointer group mt-1">
                                    <div className="relative flex items-center">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={prodHistoryOptions?.defaultShowOee !== false}
                                            onChange={e => handleDisplayOptionChange('defaultShowOee', e.target.checked)}
                                        />
                                        <div className="w-7 h-4 rounded-full border border-transparent bg-white/10 transition-all peer peer-checked:bg-white/20 peer-checked:border-white/30 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all"></div>
                                    </div>
                                    <span className="text-white/70 peer-checked:text-white group-hover:!text-white group-hover:drop-shadow-[0_0_5px_rgba(255,255,255,0.4)] transition-all whitespace-nowrap">
                                        Mostrar OEE
                                    </span>
                                </label>

                                <label className="flex items-center gap-2 cursor-pointer group mt-1">
                                    <div className="relative flex items-center">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={prodHistoryOptions?.useSecondaryAxis !== false}
                                            onChange={e => handleDisplayOptionChange('useSecondaryAxis', e.target.checked)}
                                        />
                                        <div className="w-7 h-4 rounded-full border border-transparent bg-white/10 transition-all peer peer-checked:bg-white/20 peer-checked:border-white/30 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all"></div>
                                    </div>
                                    <span className="text-white/70 peer-checked:text-white group-hover:!text-white group-hover:drop-shadow-[0_0_5px_rgba(255,255,255,0.4)] transition-all whitespace-nowrap">
                                        Usar eje secundario para OEE
                                    </span>
                                </label>
                            </DockSection>
                        )}

                        {selectedWidget.type === 'prod-history' && (
                            <DockSection icon={<Sliders size={11} />} title="Escalas">
                                <label className="flex items-center gap-2 cursor-pointer group mt-1">
                                    <div className="relative flex items-center">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={prodHistoryOptions?.autoScale !== false}
                                            onChange={e => handleDisplayOptionChange('autoScale', e.target.checked)}
                                        />
                                        <div className="w-7 h-4 rounded-full border border-transparent bg-white/10 transition-all peer peer-checked:bg-white/20 peer-checked:border-white/30 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all"></div>
                                    </div>
                                    <span className="text-white/70 peer-checked:text-white group-hover:!text-white group-hover:drop-shadow-[0_0_5px_rgba(255,255,255,0.4)] transition-all whitespace-nowrap">
                                        Autoescala
                                    </span>
                                </label>

                                <div className="flex items-center gap-2">
                                    <span className={LABEL_CLS}>Prod mín</span>
                                    <AdminNumberInput
                                        value={prodHistoryOptions?.productionAxisMin ?? ''}
                                        disabled={prodHistoryOptions?.autoScale !== false}
                                        onChange={val => handleNumericDisplayOptionChange('productionAxisMin', val)}
                                        placeholder="0"
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={LABEL_CLS}>Prod máx</span>
                                    <AdminNumberInput
                                        value={prodHistoryOptions?.productionAxisMax ?? ''}
                                        disabled={prodHistoryOptions?.autoScale !== false}
                                        onChange={val => handleNumericDisplayOptionChange('productionAxisMax', val)}
                                        placeholder="250"
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={LABEL_CLS}>OEE mín</span>
                                    <AdminNumberInput
                                        value={prodHistoryOptions?.oeeAxisMin ?? ''}
                                        disabled={prodHistoryOptions?.autoScale !== false}
                                        onChange={val => handleNumericDisplayOptionChange('oeeAxisMin', val)}
                                        placeholder="0"
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={LABEL_CLS}>OEE máx</span>
                                    <AdminNumberInput
                                        value={prodHistoryOptions?.oeeAxisMax ?? ''}
                                        disabled={prodHistoryOptions?.autoScale !== false}
                                        onChange={val => handleNumericDisplayOptionChange('oeeAxisMax', val)}
                                        placeholder="100"
                                    />
                                </div>
                            </DockSection>
                        )}

                        {selectedWidget.type === 'prod-history' && (
                            <DockSection icon={<Settings size={11} />} title="Layout">
                                <label className="flex items-center gap-2 cursor-pointer group mt-1">
                                    <div className="relative flex items-center">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={prodHistoryOptions?.showGrid !== false}
                                            onChange={e => handleDisplayOptionChange('showGrid', e.target.checked)}
                                        />
                                        <div className="w-7 h-4 rounded-full border border-transparent bg-white/10 transition-all peer peer-checked:bg-white/20 peer-checked:border-white/30 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all"></div>
                                    </div>
                                    <span className="text-white/70 peer-checked:text-white group-hover:!text-white group-hover:drop-shadow-[0_0_5px_rgba(255,255,255,0.4)] transition-all whitespace-nowrap">
                                        Mostrar grilla
                                    </span>
                                </label>
                            </DockSection>
                        )}

            </div>
        </div>
    );
}

function DockFieldRow({
    label,
    children,
    labelClassName = '',
    controlClassName = '',
    labelStyle,
}: {
    label: React.ReactNode;
    children: React.ReactNode;
    labelClassName?: string;
    controlClassName?: string;
    labelStyle?: React.CSSProperties;
}) {
    return (
        <div className={FIELD_ROW_CLS}>
            <span className={`${FIELD_LABEL_CLS} ${labelClassName}`.trim()} style={labelStyle}>
                {label}
            </span>
            <div className={`min-w-0 flex-1 ${controlClassName}`.trim()}>
                {children}
            </div>
        </div>
    );
}

// =============================================================================
// DockSection — Sección colapsable del panel lateral
// =============================================================================
function DockSection({
    icon,
    title,
    children,
    defaultOpen = true,
}: {
    icon: React.ReactNode;
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <section className={ADMIN_SIDEBAR_SECTION_CLS}>
            <button
                type="button"
                onClick={() => setOpen(prev => !prev)}
                className={ADMIN_SIDEBAR_SECTION_BUTTON_CLS}
            >
                <span className={SECTION_HEADER_CLS}>
                    {icon}
                    {title}
                </span>
                <ChevronDown size={14} className={`text-industrial-muted transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div className={ADMIN_SIDEBAR_SECTION_BODY_CLS}>
                    {children}
                </div>
            )}
        </section>
    );
}
