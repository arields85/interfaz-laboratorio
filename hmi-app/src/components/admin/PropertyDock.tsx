import { useEffect, useState } from 'react';
import { Settings2, Database, Zap, Sliders, Tag, Gauge, Activity, Thermometer, Droplet, Wind, Settings, Fan, FoldVertical, History, HelpCircle, ChevronDown, MousePointerClick, TrendingUp, BarChart2, AreaChart, Lock, Loader2, AlignLeft, AlignCenter, AlignRight, HeartPulse, Siren, Wifi, LineChart, Info, Pencil } from 'lucide-react';
import type { AggregationMode, Dashboard, WidgetConfig, WidgetBinding, WidgetLayout, KpiDisplayOptions, MetricCardDisplayOptions, AlertHistoryDisplayOptions, ConnectionStatusDisplayOptions, StatusDisplayOptions, ProdHistoryDisplayOptions, MachineActivityDisplayOptions, TextTitleDisplayOptions, TextTitleColor, TrendChartDisplayOptions, TrendChartV2DisplayOptions, ActivityAnalyticsAlphaPair, ActivityAnalyticsDisplayOptions, ActivityAnalyticsStateGradientKey, ActivityAnalyticsSurfaceEffects, ActivityAnalyticsTrendBandBlendMode, ProdTrendDisplayOptions, KpiFixedTopCapEffects, KpiTravelingTopCapEffects, KpiTopCapShape, InfoCardDisplayOptions, InfoCardField, TextAlign } from '../../domain/admin.types';
import { isTrendChartV2Widget } from '../../domain/admin.types';
import { ACTIVITY_ANALYTICS_TREND_BAND_BLEND_MODE_OPTIONS } from '../../domain/admin.types';
import { HISTORICAL_DENSITY_LABELS, normalizeHistoricalDensity } from '../../utils/trendChartV2Density';
import {
    normalizeTrendChartV2ShiftDisplayMode,
    TREND_CHART_V2_SHIFT_DISPLAY_MODE_LABELS,
} from '../../utils/trendChartV2Shifts';
import type { CatalogVariable } from '../../domain';
import type { EquipmentSummary } from '../../domain/equipment.types';
import type { ContractMachine } from '../../domain/dataContract.types';
import {
    getHierarchyAggregationModeLabel,
    getHierarchyTraceEmptyStateMessage,
    getHierarchyTraceExclusionReasonLabel,
    type HierarchyAggregationTrace,
} from '../../widgets/resolvers/hierarchyResolver';
import AdminSelect from './AdminSelect';
import AdminNumberInput from './AdminNumberInput';
import AdminEmptyState from './AdminEmptyState';
import CatalogVariableSelector from './CatalogVariableSelector';
import DockColorField from './DockColorField';
import DockCheckboxField from './DockCheckboxField';
import DockCompactNumberField from './DockCompactNumberField';
import DockInfoDropdown from './DockInfoDropdown';
import DockInfoBox from './DockInfoBox';
import DockInlineControlRow from './DockInlineControlRow';
import DockSliderField from './DockSliderField';
import {
    DEFAULT_STATUS_LABELS,
    EQUIPMENT_STATUS_VALUES,
    normalizeSimulatedEquipmentStatus,
} from '../../utils/statusWidget';
import { DEFAULT_CONTRACT_STATUS_LABELS } from '../../utils/connectionWidget';
import {
    ADMIN_SIDEBAR_INPUT_CLS,
    ADMIN_SIDEBAR_HINT_CLS,
    ADMIN_SIDEBAR_INFO_ITEM_CLS,
    ADMIN_SIDEBAR_INFO_LIST_CLS,
    ADMIN_SIDEBAR_INFO_TITLE_CLS,
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
import {
    DEFAULT_INFO_CARD_VALUE_FONT_SIZE,
    DEFAULT_WIDGET_VALUE_FONT_SIZE,
    resolveInfoCardFieldContent,
    resolveInfoCardFields,
    resolveInfoCardTextAlign,
} from '../../utils/infoCardDisplayOptions';
import {
    DEFAULT_ACTIVITY_ANALYTICS_DONUT_CENTER_VALUE_FONT_SIZE,
    DEFAULT_GAUGE_VALUE_FONT_SIZE,
    clampActivityAnalyticsGroupBarWidth,
    DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_COLOR_INPUT,
    MAX_ACTIVITY_ANALYTICS_DONUT_CENTER_VALUE_FONT_SIZE,
    MIN_ACTIVITY_ANALYTICS_DONUT_CENTER_VALUE_FONT_SIZE,
    resolveActivityAnalyticsDisplayOptions,
    resolveActivityAnalyticsDonutCenterValueFontSize,
    resolveActivityAnalyticsGroupBarWidthForGroup,
    resolveActivityAnalyticsProdTrendBandBlendMode,
} from '../../utils/activityAnalyticsWidgetDefaults';
import {
    DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS,
    DEFAULT_KPI_FIXED_TOP_CAP_SHAPE,
    DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS,
    DEFAULT_CIRCULAR_ARC_GLOW_INTENSITY,
    FIXED_TOP_CAP_TRAVEL_COMPLETION_PULSE_STABILITY_VISUAL_MAX,
    KPI_FIXED_TOP_CAP_PULSE_IRREGULARITY_MAX,
    KPI_FIXED_TOP_CAP_PULSE_SPEED_MAX,
    KPI_TOP_CAP_EFFECT_MAX,
    KPI_TOP_CAP_EFFECT_MIN,
    KPI_TOP_CAP_EFFECT_STEP,
    resolveTravelCompletionPulseStabilityRuntimeValue,
    resolveTravelCompletionPulseStabilityVisualValue,
    resolveMachineActivityFixedTopCapEffects,
    resolveKpiFixedTopCapShape,
    resolveKpiTravelingTopCapEffects,
} from '../../utils/kpiTopCapEffects';
import {
    resolveProdTrendThemeDefaultLineColors,
    resolveProdTrendDisplayOptions,
} from '../../utils/prodTrendWidgetDefaults';
import { resolveCanonicalWidgetIdentityLabel } from '../../utils/activityAnalyticsTitle';
import {
    resolveActivityAnalyticsDisplayRules,
    type ActivityAnalyticsSupportedRange,
} from '../../utils/activityAnalyticsDisplayRules';
import {
    DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_PX_PER_SECOND,
    DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_SCALE,
    DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_PX_PER_SECOND,
    DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_SCALE,
    resolveStoredTravelingTopCapSpeedScale,
    sanitizeTravelingTopCapSpeedScale,
    TRAVELING_TOP_CAP_SPEED_SCALE_MAX,
    TRAVELING_TOP_CAP_SPEED_SCALE_MIN,
    TRAVELING_TOP_CAP_SPEED_SCALE_STEP,
} from '../../utils/travelingTopCapSpeed';

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
    hierarchyTrace?: HierarchyAggregationTrace;
    onCreateVariable: (name: string, unit: string) => void;
    onDeleteVariable: (variableId: string) => void;
    onUpdateWidget: (w: WidgetConfig) => void;
    availableDashboards?: Dashboard[];
    currentDashboardId?: string;
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
const LEGACY_TREND_CHART_DEFAULT_LINE_STROKE_WIDTH = 2.5;
const LEGACY_TREND_CHART_DEFAULT_LINE_GLOW_BLUR = 3;
const LEGACY_TREND_CHART_LINE_STROKE_WIDTH_MIN = 0.5;
const LEGACY_TREND_CHART_LINE_STROKE_WIDTH_MAX = 6;
const LEGACY_TREND_CHART_LINE_GLOW_BLUR_MIN = 0;
const LEGACY_TREND_CHART_LINE_GLOW_BLUR_MAX = 8;
const LEGACY_TREND_CHART_LINE_STYLE_STEP = 0.1;
const TREND_CHART_V2_DEFAULT_LINE_STROKE_WIDTH = 2.5;
const TREND_CHART_V2_DEFAULT_LINE_GLOW_BLUR = 3;
const PROD_TREND_DEFAULT_LINE_STROKE_WIDTH = 2.5;
const PROD_TREND_DEFAULT_LINE_GLOW_BLUR = 3;
const PROD_HISTORY_OEE_DEFAULT_LINE_STROKE_WIDTH = 2.5;
const PROD_HISTORY_OEE_DEFAULT_LINE_GLOW_BLUR = 3;
const PROD_HISTORY_PRODUCTION_DEFAULT_LINE_STROKE_WIDTH = 2.5;
const PROD_HISTORY_PRODUCTION_DEFAULT_LINE_GLOW_BLUR = 3;
const PRESET_UNITS = ['°C', '°F', 'RPM', '%', 'bar', 'psi', 'kW', 'A', 'V', 'Hz', 'Hs', 'mm', 'kg', 'L/min', 'm³/h', 'N', 'kN'] as const;
const CUSTOM_UNIT_OPTION_VALUE = '__custom__';
const CUSTOM_UNIT_OPTION = {
    value: CUSTOM_UNIT_OPTION_VALUE,
    label: 'Personalizado',
    icon: <Pencil size={11} />,
};
type PresetUnit = (typeof PRESET_UNITS)[number];
type ConnectionStatusTextFieldKey = 'onlineText' | 'degradadoText' | 'offlineText' | 'unknownText';
type InfoCardFieldStorageKey = keyof Pick<InfoCardField, 'helpText' | 'label' | 'value'>;

const INFO_CARD_FIELD_EDITOR_ROWS: Array<{
    storageKey: InfoCardFieldStorageKey;
    semanticLabel: 'Texto' | 'Subtexto' | 'Etiqueta';
    placeholder: string;
}> = [
    { storageKey: 'value', semanticLabel: 'Texto', placeholder: 'Primary text' },
    { storageKey: 'label', semanticLabel: 'Subtexto', placeholder: 'Secondary text' },
    { storageKey: 'helpText', semanticLabel: 'Etiqueta', placeholder: 'Optional label' },
];

const TEXT_ALIGN_BUTTON_OPTIONS: Array<{ value: TextAlign; label: string; Icon: typeof AlignLeft }> = [
    { value: 'left', label: 'Alinear a la izquierda', Icon: AlignLeft },
    { value: 'center', label: 'Alinear al centro', Icon: AlignCenter },
    { value: 'right', label: 'Alinear a la derecha', Icon: AlignRight },
];

const isPresetUnit = (value: string): value is PresetUnit => PRESET_UNITS.some(unit => unit === value);
const ACTIVITY_ANALYTICS_RANGE_OPTIONS: Array<{ value: ActivityAnalyticsSupportedRange; label: string }> = [
    { value: '7d', label: '7 días' },
    { value: '30d', label: '30 días' },
    { value: '12m', label: '12 meses' },
];
const ANALYTICS_DATA_MODE_OPTIONS = [
    { value: 'real', label: 'Real' },
    { value: 'simulated', label: 'Simulado' },
];
const ACTIVITY_ANALYTICS_GROUP_OPTIONS = [
    { value: 'shift', label: 'Turno' },
    { value: 'day', label: 'Día' },
    { value: 'week', label: 'Semana' },
    { value: 'month', label: 'Mes' },
] as const;
const ACTIVITY_ANALYTICS_STATE_GRADIENT_ROWS: Array<{
    key: ActivityAnalyticsStateGradientKey;
    label: string;
}> = [
    { key: 'prod', label: 'Producción' },
    { key: 'setup', label: 'Setup' },
    { key: 'stopped', label: 'Detenida' },
];
const ACTIVITY_ANALYTICS_GRADIENT_STOPS = [
    { slotIndex: 0 as const, key: 'start', label: 'Color inicial', hexLabel: 'HEX', alphaLabel: 'Alfa (%)' },
    { slotIndex: 1 as const, key: 'end', label: 'Color final', hexLabel: 'HEX', alphaLabel: 'Alfa (%)' },
];
const PROD_TREND_LINE_STOPS = [
    { slotIndex: 0 as const, key: 'start', label: 'Color inicial' },
    { slotIndex: 1 as const, key: 'end', label: 'Color final' },
];
const ACTIVITY_ANALYTICS_PROD_TREND_BAND_STOPS = [
    { slotIndex: 0 as const, key: 'top', label: 'Superior', hexLabel: 'HEX', alphaLabel: 'Alfa (%)' },
    { slotIndex: 1 as const, key: 'middle', label: 'Centro', hexLabel: 'HEX', alphaLabel: 'Alfa (%)' },
    { slotIndex: 2 as const, key: 'bottom', label: 'Inferior', hexLabel: 'HEX', alphaLabel: 'Alfa (%)' },
];
const ACTIVITY_ANALYTICS_PROD_TREND_BAND_BLEND_MODE_LABELS: Record<ActivityAnalyticsTrendBandBlendMode, string> = {
    overlay: 'Overlay',
    normal: 'Normal',
    multiply: 'Multiply',
    screen: 'Screen',
    'soft-light': 'Soft light',
    'hard-light': 'Hard light',
};
const ACTIVITY_ANALYTICS_SURFACE_EFFECT_CARDS = [
    { key: 'groupedBars' as const, label: 'Barras agrupadas' },
    { key: 'donut' as const, label: 'Donut' },
];
type KpiFixedTopCapVisualSliderKey = 'auraIntensity' | 'haloIntensity' | 'blur' | 'extension' | 'thickness';
type FixedTopCapPulseSliderKey = 'pulseSpeed' | 'pulseIrregularity' | 'pulseStability';
type FixedTopCapPulseSlider = {
    key: FixedTopCapPulseSliderKey;
    label: string;
    ariaLabel: string;
    min: number;
    max: number;
    step: number;
};
const KPI_FIXED_TOP_CAP_SLIDERS: Array<{
    key: KpiFixedTopCapVisualSliderKey;
    label: string;
    ariaLabel: string;
}> = [
    { key: 'auraIntensity', label: 'Aura', ariaLabel: 'Aura top cap fijo' },
    { key: 'haloIntensity', label: 'Halo', ariaLabel: 'Halo top cap fijo' },
    { key: 'blur', label: 'Blur', ariaLabel: 'Blur top cap fijo' },
    { key: 'extension', label: 'Extensión', ariaLabel: 'Extensión top cap fijo' },
    { key: 'thickness', label: 'Grosor', ariaLabel: 'Grosor top cap fijo' },
];
const FIXED_TOP_CAP_PULSE_SLIDERS: FixedTopCapPulseSlider[] = [
    {
        key: 'pulseSpeed',
        label: 'Velocidad',
        ariaLabel: 'Velocidad top cap fijo',
        min: KPI_TOP_CAP_EFFECT_MIN,
        max: KPI_FIXED_TOP_CAP_PULSE_SPEED_MAX,
        step: KPI_TOP_CAP_EFFECT_STEP,
    },
    {
        key: 'pulseIrregularity',
        label: 'Irregularidad',
        ariaLabel: 'Irregularidad top cap fijo',
        min: KPI_TOP_CAP_EFFECT_MIN,
        max: KPI_FIXED_TOP_CAP_PULSE_IRREGULARITY_MAX,
        step: KPI_TOP_CAP_EFFECT_STEP,
    },
    {
        key: 'pulseStability',
        label: 'Duración del parpadeo',
        ariaLabel: 'Duración del parpadeo top cap fijo',
        min: KPI_TOP_CAP_EFFECT_MIN,
        max: FIXED_TOP_CAP_TRAVEL_COMPLETION_PULSE_STABILITY_VISUAL_MAX,
        step: KPI_TOP_CAP_EFFECT_STEP,
    },
];
const CIRCULAR_GAUGE_VISUAL_SLIDERS = [
    {
        key: 'circularArcGlowIntensity' as const,
        label: 'Glow arco',
        ariaLabel: 'Glow arco circular',
        min: 0,
        max: 100,
        step: 1,
        defaultValue: DEFAULT_CIRCULAR_ARC_GLOW_INTENSITY,
    },
];
const KPI_TRAVELING_TOP_CAP_SLIDERS: Array<{
    key: keyof KpiTravelingTopCapEffects;
    label: string;
    ariaLabel: string;
}> = [
    { key: 'auraIntensity', label: 'Aura', ariaLabel: 'Aura top cap viajero' },
    { key: 'haloIntensity', label: 'Halo', ariaLabel: 'Halo top cap viajero' },
    { key: 'blur', label: 'Blur', ariaLabel: 'Blur top cap viajero' },
    { key: 'extension', label: 'Extensión', ariaLabel: 'Extensión top cap viajero' },
    { key: 'thickness', label: 'Grosor', ariaLabel: 'Grosor top cap viajero' },
];
const ACTIVITY_ANALYTICS_HEX_CODE_PATTERN = /^[0-9a-f]{6}$/i;
type ActivityAnalyticsGradientSlotIndex = 0 | 1;
type ActivityAnalyticsProdTrendBandSlotIndex = 0 | 1 | 2;
type ActivityAnalyticsSurfaceKey = 'groupedBars' | 'donut';
type ActivityAnalyticsHexDraftKey = `${ActivityAnalyticsStateGradientKey}-${ActivityAnalyticsGradientSlotIndex}`;
type ActivityAnalyticsProdTrendBandHexDraftKey = `prod-trend-band-${ActivityAnalyticsProdTrendBandSlotIndex}`;
type ProdTrendLineHexDraftKey = `prod-trend-line-${ActivityAnalyticsGradientSlotIndex}`;

const formatActivityAnalyticsHexCode = (value: string | undefined): string => value?.replace(/^#/, '').toLowerCase() ?? '';
const parseActivityAnalyticsHexCode = (value: string): string | null => {
    const normalizedValue = value.trim().replace(/^#/, '').toLowerCase();

    if (!ACTIVITY_ANALYTICS_HEX_CODE_PATTERN.test(normalizedValue)) {
        return null;
    }

    return `#${normalizedValue}`;
};

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
        hierarchyTrace,
        onCreateVariable,
        onDeleteVariable,
        onUpdateWidget,
        availableDashboards = [],
        currentDashboardId,
    } = props;
    const [isCustomUnit, setIsCustomUnit] = useState(false);
    const [activityAnalyticsThresholdWarning, setActivityAnalyticsThresholdWarning] = useState<string | null>(null);
    const [activityAnalyticsHexDrafts, setActivityAnalyticsHexDrafts] = useState<Partial<Record<ActivityAnalyticsHexDraftKey, string>>>({});
    const [activityAnalyticsProdTrendBandHexDrafts, setActivityAnalyticsProdTrendBandHexDrafts] = useState<Partial<Record<ActivityAnalyticsProdTrendBandHexDraftKey, string>>>({});
    const [activityAnalyticsCoverageColorDraft, setActivityAnalyticsCoverageColorDraft] = useState<string | null>(null);
    const [prodTrendLineHexDrafts, setProdTrendLineHexDrafts] = useState<Partial<Record<ProdTrendLineHexDraftKey, string>>>({});
    void selectedLayout;

    useEffect(() => {
        setIsCustomUnit(false);
        setActivityAnalyticsThresholdWarning(null);
    }, [selectedWidget?.id]);

    const prodTrendThemeDefaultLineColors = resolveProdTrendThemeDefaultLineColors();

    useEffect(() => {
        setActivityAnalyticsHexDrafts({});
        setActivityAnalyticsProdTrendBandHexDrafts({});
        setActivityAnalyticsCoverageColorDraft(null);
        setProdTrendLineHexDrafts({});
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

    const handleKpiFixedTopCapEffectChange = (key: keyof KpiFixedTopCapEffects, value: number) => {
        if (!selectedWidget || (selectedWidget.type !== 'kpi' && selectedWidget.type !== 'machine-activity')) {
            return;
        }

        const currentDisplayOptions = ((selectedWidget.type === 'kpi'
            ? selectedWidget.displayOptions as KpiDisplayOptions | undefined
            : selectedWidget.displayOptions as MachineActivityDisplayOptions | undefined) ?? {});
        const currentEffects = resolveMachineActivityFixedTopCapEffects(currentDisplayOptions.fixedTopCapEffects);
        const resolvedValue = key === 'pulseStability'
            ? resolveTravelCompletionPulseStabilityRuntimeValue(value)
            : value;

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...currentDisplayOptions,
                fixedTopCapEffects: {
                    ...currentEffects,
                    [key]: resolvedValue,
                },
            },
        });
    };

    const handleKpiTravelingTopCapEffectChange = (key: keyof KpiTravelingTopCapEffects, value: number) => {
        if (!selectedWidget || (selectedWidget.type !== 'kpi' && selectedWidget.type !== 'machine-activity')) {
            return;
        }

        const currentDisplayOptions = ((selectedWidget.type === 'kpi'
            ? selectedWidget.displayOptions as KpiDisplayOptions | undefined
            : selectedWidget.displayOptions as MachineActivityDisplayOptions | undefined) ?? {});
        const currentEffects = resolveKpiTravelingTopCapEffects(currentDisplayOptions.travelingTopCapEffects);

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...currentDisplayOptions,
                travelingTopCapEffects: {
                    ...currentEffects,
                    [key]: value,
                },
            },
        });
    };

    const handleGaugeTravelingTopCapSpeedChange = (
        key: 'travelingTopCapMinSpeed' | 'travelingTopCapMaxSpeed',
        value: string,
    ) => {
        if (!selectedWidget || (selectedWidget.type !== 'machine-activity' && selectedWidget.type !== 'kpi')) {
            return;
        }

        const currentDisplayOptions = ((selectedWidget.type === 'machine-activity'
            ? selectedWidget.displayOptions as MachineActivityDisplayOptions | undefined
            : selectedWidget.displayOptions as KpiDisplayOptions | undefined) ?? {});
        const nextRawValue = Number(value);
        const fallback = key === 'travelingTopCapMinSpeed'
            ? DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_PX_PER_SECOND
            : DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_PX_PER_SECOND;

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...currentDisplayOptions,
                [key]: sanitizeTravelingTopCapSpeedScale(
                    Number.isFinite(nextRawValue) ? nextRawValue : undefined,
                    resolveStoredTravelingTopCapSpeedScale(undefined, fallback),
                ),
            },
        });
    };

    const handleKpiFixedTopCapShapeChange = (key: keyof KpiTopCapShape, value: boolean) => {
        if (!selectedWidget || (selectedWidget.type !== 'kpi' && selectedWidget.type !== 'machine-activity')) {
            return;
        }

        const currentDisplayOptions = ((selectedWidget.type === 'kpi'
            ? selectedWidget.displayOptions as KpiDisplayOptions | undefined
            : selectedWidget.displayOptions as MachineActivityDisplayOptions | undefined) ?? {});
        const currentShape = resolveKpiFixedTopCapShape(currentDisplayOptions.fixedTopCapShape);

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...currentDisplayOptions,
                fixedTopCapShape: {
                    ...currentShape,
                    [key]: value,
                },
            },
        });
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
        if (!selectedWidget || (selectedWidget.type !== 'activity-analytics' && selectedWidget.type !== 'prod-trend')) {
            return;
        }

        const currentOptions = selectedWidget.type === 'activity-analytics'
            ? resolveActivityAnalyticsDisplayOptions(selectedWidget.displayOptions as ActivityAnalyticsDisplayOptions | undefined)
            : resolveProdTrendDisplayOptions(selectedWidget.displayOptions as ProdTrendDisplayOptions | undefined, prodTrendThemeDefaultLineColors);
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

    const handleActivityAnalyticsGroupBarWidthChange = (nextValue: number) => {
        if (!selectedWidget || selectedWidget.type !== 'activity-analytics') {
            return;
        }

        const currentOptions = resolveActivityAnalyticsDisplayOptions(selectedWidget.displayOptions as ActivityAnalyticsDisplayOptions | undefined);

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...selectedWidget.displayOptions,
                groupBarWidths: {
                    ...(selectedWidget.displayOptions?.groupBarWidths ?? {}),
                    [currentOptions.groupBy]: clampActivityAnalyticsGroupBarWidth(nextValue),
                },
            },
        });
    };

    const handleActivityAnalyticsDonutCenterValueFontSizeChange = (value: string) => {
        if (!selectedWidget || selectedWidget.type !== 'activity-analytics') {
            return;
        }

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...selectedWidget.displayOptions,
                donutCenterValueFontSize: resolveActivityAnalyticsDonutCenterValueFontSize(
                    value === '' ? undefined : Number(value),
                ),
            },
        });
    };

    const handleGaugeValueFontSizeChange = (value: string) => {
        if (!selectedWidget || (selectedWidget.type !== 'kpi' && selectedWidget.type !== 'machine-activity')) {
            return;
        }

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...(selectedWidget.displayOptions ?? {}),
                valueFontSize: resolveActivityAnalyticsDonutCenterValueFontSize(
                    value === '' ? undefined : Number(value),
                ),
            },
        } as WidgetConfig);
    };

    const handleMetricCardValueFontSizeChange = (value: string) => {
        if (!selectedWidget || selectedWidget.type !== 'metric-card') {
            return;
        }

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...(selectedWidget.displayOptions ?? {}),
                valueFontSize: resolveActivityAnalyticsDonutCenterValueFontSize(
                    value === '' ? undefined : Number(value),
                ),
            },
        });
    };

    const handleActivityAnalyticsStateGradientChange = (
        stateKey: ActivityAnalyticsStateGradientKey,
        slotIndex: 0 | 1,
        value: string,
    ) => {
        if (!selectedWidget || selectedWidget.type !== 'activity-analytics') {
            return;
        }

        const currentOptions = resolveActivityAnalyticsDisplayOptions(selectedWidget.displayOptions as ActivityAnalyticsDisplayOptions | undefined);
        const currentStateGradients = currentOptions.stateGradients as Record<ActivityAnalyticsStateGradientKey, [string, string]>;
        const currentGradient = currentStateGradients[stateKey];
        const nextStateGradients = {
            ...currentStateGradients,
            [stateKey]: [currentGradient[0], currentGradient[1]] as [string, string],
        };

        nextStateGradients[stateKey][slotIndex] = value;

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...selectedWidget.displayOptions,
                stateGradients: nextStateGradients,
            },
        });
    };

    const getActivityAnalyticsHexDraftKey = (
        stateKey: ActivityAnalyticsStateGradientKey,
        slotIndex: ActivityAnalyticsGradientSlotIndex,
    ): ActivityAnalyticsHexDraftKey => `${stateKey}-${slotIndex}`;

    const isValidActivityAnalyticsHexCode = (value: string): boolean => ACTIVITY_ANALYTICS_HEX_CODE_PATTERN.test(value.trim().replace(/^#/, ''));

    const handleActivityAnalyticsHexDraftChange = (
        stateKey: ActivityAnalyticsStateGradientKey,
        slotIndex: ActivityAnalyticsGradientSlotIndex,
        value: string,
    ) => {
        const draftKey = getActivityAnalyticsHexDraftKey(stateKey, slotIndex);
        const normalizedValue = value.trim().replace(/^#/, '');

        setActivityAnalyticsHexDrafts((currentDrafts) => ({
            ...currentDrafts,
            [draftKey]: normalizedValue,
        }));

        const nextColor = parseActivityAnalyticsHexCode(normalizedValue);

        if (!nextColor) {
            return;
        }

        handleActivityAnalyticsStateGradientChange(stateKey, slotIndex, nextColor);
        setActivityAnalyticsHexDrafts((currentDrafts) => ({
            ...currentDrafts,
            [draftKey]: normalizedValue.toLowerCase(),
        }));
    };

    const handleActivityAnalyticsHexDraftBlur = (
        stateKey: ActivityAnalyticsStateGradientKey,
        slotIndex: ActivityAnalyticsGradientSlotIndex,
        resolvedValue: string,
    ) => {
        const draftKey = getActivityAnalyticsHexDraftKey(stateKey, slotIndex);
        const draftValue = activityAnalyticsHexDrafts[draftKey];

        if (draftValue == null) {
            return;
        }

        if (isValidActivityAnalyticsHexCode(draftValue)) {
            setActivityAnalyticsHexDrafts((currentDrafts) => ({
                ...currentDrafts,
                [draftKey]: draftValue.trim().replace(/^#/, '').toLowerCase(),
            }));
            return;
        }

        setActivityAnalyticsHexDrafts((currentDrafts) => ({
            ...currentDrafts,
            [draftKey]: formatActivityAnalyticsHexCode(resolvedValue),
        }));
    };

    const handleActivityAnalyticsColorPickerChange = (
        stateKey: ActivityAnalyticsStateGradientKey,
        slotIndex: ActivityAnalyticsGradientSlotIndex,
        value: string,
    ) => {
        const normalizedValue = value.trim().toLowerCase();

        setActivityAnalyticsHexDrafts((currentDrafts) => ({
            ...currentDrafts,
            [getActivityAnalyticsHexDraftKey(stateKey, slotIndex)]: formatActivityAnalyticsHexCode(normalizedValue),
        }));
        handleActivityAnalyticsStateGradientChange(stateKey, slotIndex, normalizedValue);
    };

    const getActivityAnalyticsProdTrendBandHexDraftKey = (
        slotIndex: ActivityAnalyticsProdTrendBandSlotIndex,
    ): ActivityAnalyticsProdTrendBandHexDraftKey => `prod-trend-band-${slotIndex}`;

    const handleActivityAnalyticsProdTrendBandColorChange = (
        slotIndex: ActivityAnalyticsProdTrendBandSlotIndex,
        value: string | undefined,
    ) => {
        if (!selectedWidget || selectedWidget.type !== 'activity-analytics') {
            return;
        }

        const currentOptions = resolveActivityAnalyticsDisplayOptions(selectedWidget.displayOptions as ActivityAnalyticsDisplayOptions | undefined);
        const currentProdTrendBands = currentOptions.prodTrendBands;
        const nextColors: [string | undefined, string | undefined, string | undefined] = [...currentProdTrendBands.colors];

        nextColors[slotIndex] = value;

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...selectedWidget.displayOptions,
                prodTrendBands: {
                    ...selectedWidget.displayOptions?.prodTrendBands,
                    colors: nextColors,
                },
            },
        });
    };

    const handleActivityAnalyticsProdTrendBandHexDraftChange = (
        slotIndex: ActivityAnalyticsProdTrendBandSlotIndex,
        value: string,
    ) => {
        const draftKey = getActivityAnalyticsProdTrendBandHexDraftKey(slotIndex);
        const normalizedValue = value.trim().replace(/^#/, '');

        setActivityAnalyticsProdTrendBandHexDrafts((currentDrafts) => ({
            ...currentDrafts,
            [draftKey]: normalizedValue,
        }));

        if (normalizedValue.length === 0) {
            if (selectedWidget?.type === 'prod-trend') {
                handleProdTrendBandColorChange(slotIndex, undefined);
            } else {
                handleActivityAnalyticsProdTrendBandColorChange(slotIndex, undefined);
            }
            return;
        }

        const nextColor = parseActivityAnalyticsHexCode(normalizedValue);

        if (!nextColor) {
            return;
        }

        if (selectedWidget?.type === 'prod-trend') {
            handleProdTrendBandColorChange(slotIndex, nextColor);
        } else {
            handleActivityAnalyticsProdTrendBandColorChange(slotIndex, nextColor);
        }
        setActivityAnalyticsProdTrendBandHexDrafts((currentDrafts) => ({
            ...currentDrafts,
            [draftKey]: normalizedValue.toLowerCase(),
        }));
    };

    const handleActivityAnalyticsProdTrendBandHexDraftBlur = (
        slotIndex: ActivityAnalyticsProdTrendBandSlotIndex,
        resolvedValue: string,
    ) => {
        const draftKey = getActivityAnalyticsProdTrendBandHexDraftKey(slotIndex);
        const draftValue = activityAnalyticsProdTrendBandHexDrafts[draftKey];

        if (draftValue == null) {
            return;
        }

        const normalizedDraftValue = draftValue.trim().toLowerCase();

        if (normalizedDraftValue.length === 0) {
            setActivityAnalyticsProdTrendBandHexDrafts((currentDrafts) => ({
                ...currentDrafts,
                [draftKey]: '',
            }));
            return;
        }

        if (isValidActivityAnalyticsHexCode(normalizedDraftValue)) {
            setActivityAnalyticsProdTrendBandHexDrafts((currentDrafts) => ({
                ...currentDrafts,
                [draftKey]: normalizedDraftValue.replace(/^#/, ''),
            }));
            return;
        }

        setActivityAnalyticsProdTrendBandHexDrafts((currentDrafts) => ({
            ...currentDrafts,
            [draftKey]: formatActivityAnalyticsHexCode(resolvedValue),
        }));
    };

    const handleActivityAnalyticsProdTrendBandColorPickerChange = (
        slotIndex: ActivityAnalyticsProdTrendBandSlotIndex,
        value: string,
    ) => {
        const normalizedValue = value.trim().toLowerCase();

        setActivityAnalyticsProdTrendBandHexDrafts((currentDrafts) => ({
            ...currentDrafts,
            [getActivityAnalyticsProdTrendBandHexDraftKey(slotIndex)]: formatActivityAnalyticsHexCode(normalizedValue),
        }));
        if (selectedWidget?.type === 'prod-trend') {
            handleProdTrendBandColorChange(slotIndex, normalizedValue);
        } else {
            handleActivityAnalyticsProdTrendBandColorChange(slotIndex, normalizedValue);
        }
    };

    const handleActivityAnalyticsCoverageColorChange = (value: string) => {
        if (!selectedWidget || selectedWidget.type !== 'activity-analytics') {
            return;
        }

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...selectedWidget.displayOptions,
                coverageColor: value,
            },
        });
    };

    const handleActivityAnalyticsCoverageColorDraftChange = (value: string) => {
        const normalizedValue = value.trim().replace(/^#/, '');

        setActivityAnalyticsCoverageColorDraft(normalizedValue);

        const nextColor = parseActivityAnalyticsHexCode(normalizedValue);

        if (!nextColor) {
            return;
        }

        handleActivityAnalyticsCoverageColorChange(nextColor);
        setActivityAnalyticsCoverageColorDraft(normalizedValue.toLowerCase());
    };

    const handleActivityAnalyticsCoverageColorDraftBlur = (resolvedValue: string) => {
        if (activityAnalyticsCoverageColorDraft == null) {
            return;
        }

        if (isValidActivityAnalyticsHexCode(activityAnalyticsCoverageColorDraft)) {
            setActivityAnalyticsCoverageColorDraft(activityAnalyticsCoverageColorDraft.trim().replace(/^#/, '').toLowerCase());
            return;
        }

        setActivityAnalyticsCoverageColorDraft(formatActivityAnalyticsHexCode(resolvedValue));
    };

    const handleActivityAnalyticsStateGradientAlphaChange = (
        stateKey: ActivityAnalyticsStateGradientKey,
        slotIndex: ActivityAnalyticsGradientSlotIndex,
        value: string,
    ) => {
        if (!selectedWidget || selectedWidget.type !== 'activity-analytics') {
            return;
        }

        const currentOptions = resolveActivityAnalyticsDisplayOptions(selectedWidget.displayOptions as ActivityAnalyticsDisplayOptions | undefined);
        const currentAlphas = currentOptions.stateGradientAlphas as Record<ActivityAnalyticsStateGradientKey, ActivityAnalyticsAlphaPair>;
        const nextStateGradientAlphas = {
            ...currentAlphas,
            [stateKey]: [currentAlphas[stateKey][0], currentAlphas[stateKey][1]] as ActivityAnalyticsAlphaPair,
        };

        const clampActivityAnalyticsNumericValue = (
            rawValue: string | number,
            currentValue: number,
            min: number,
            max: number,
        ) => {
            const nextValue = typeof rawValue === 'number' ? rawValue : Number(rawValue);

            if (!Number.isFinite(nextValue)) {
                return currentValue;
            }

            return Math.min(max, Math.max(min, nextValue));
        };

        nextStateGradientAlphas[stateKey][slotIndex] = clampActivityAnalyticsNumericValue(
            value,
            currentAlphas[stateKey][slotIndex],
            0,
            100,
        );

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...selectedWidget.displayOptions,
                stateGradientAlphas: nextStateGradientAlphas,
            },
        });
    };

    const handleActivityAnalyticsProdTrendBandAlphaChange = (
        slotIndex: ActivityAnalyticsProdTrendBandSlotIndex,
        value: string,
    ) => {
        if (!selectedWidget || selectedWidget.type !== 'activity-analytics') {
            return;
        }

        const currentOptions = resolveActivityAnalyticsDisplayOptions(selectedWidget.displayOptions as ActivityAnalyticsDisplayOptions | undefined);
        const nextAlphas: [number, number, number] = [...currentOptions.prodTrendBands.alphas];
        const nextValue = Number(value);

        if (!Number.isFinite(nextValue)) {
            return;
        }

        nextAlphas[slotIndex] = Math.min(100, Math.max(0, nextValue));

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...selectedWidget.displayOptions,
                prodTrendBands: {
                    ...selectedWidget.displayOptions?.prodTrendBands,
                    alphas: nextAlphas,
                },
            },
        });
    };

    const handleActivityAnalyticsProdTrendBandBlendModeChange = (blendMode: string) => {
        if (!selectedWidget || selectedWidget.type !== 'activity-analytics') {
            return;
        }

        const resolvedBlendMode = resolveActivityAnalyticsProdTrendBandBlendMode(blendMode);

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...selectedWidget.displayOptions,
                prodTrendBands: {
                    ...selectedWidget.displayOptions?.prodTrendBands,
                    blendMode: resolvedBlendMode,
                },
            },
        });
    };

    const handleActivityAnalyticsSurfaceEffectChange = (
        surfaceKey: ActivityAnalyticsSurfaceKey,
        effectKey: keyof ActivityAnalyticsSurfaceEffects,
        value: string | number | boolean,
    ) => {
        if (!selectedWidget || selectedWidget.type !== 'activity-analytics') {
            return;
        }

        const currentOptions = resolveActivityAnalyticsDisplayOptions(selectedWidget.displayOptions as ActivityAnalyticsDisplayOptions | undefined);
        const currentVisualEffects = currentOptions.visualEffects;
        const currentSurfaceEffects = currentVisualEffects[surfaceKey] as ActivityAnalyticsSurfaceEffects;
        const clampActivityAnalyticsNumericValue = (
            rawValue: string | number,
            currentValue: number,
            min: number,
            max: number,
        ) => {
            const nextValue = typeof rawValue === 'number' ? rawValue : Number(rawValue);

            if (!Number.isFinite(nextValue)) {
                return currentValue;
            }

            return Math.min(max, Math.max(min, nextValue));
        };
        const nextEffectValue = (() => {
            if (effectKey === 'topCap') {
                return typeof value === 'boolean' ? value : currentSurfaceEffects.topCap;
            }

            if (effectKey === 'blur') {
                return clampActivityAnalyticsNumericValue(
                    typeof value === 'boolean' ? currentSurfaceEffects.blur : value,
                    currentSurfaceEffects.blur,
                    0,
                    8,
                );
            }

            return clampActivityAnalyticsNumericValue(
                typeof value === 'boolean' ? currentSurfaceEffects[effectKey] : value,
                currentSurfaceEffects[effectKey],
                0,
                100,
            );
        })();
        const nextSurfaceEffects = {
            ...currentSurfaceEffects,
            [effectKey]: nextEffectValue,
        };

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...selectedWidget.displayOptions,
                visualEffects: {
                    ...currentVisualEffects,
                    [surfaceKey]: nextSurfaceEffects,
                },
            },
        });
    };

    const handleProdTrendThresholdChange = (key: 'setupThresholdKw' | 'prodThresholdKw', value: string) => {
        if (!selectedWidget || selectedWidget.type !== 'prod-trend') {
            return;
        }

        const nextValue = value === '' ? 0 : Number(value);

        if (!Number.isFinite(nextValue) || nextValue < 0) {
            return;
        }

        const currentOptions = resolveProdTrendDisplayOptions(selectedWidget.displayOptions as ProdTrendDisplayOptions | undefined, prodTrendThemeDefaultLineColors);
        const nextSetupThresholdKw = key === 'setupThresholdKw' ? nextValue : currentOptions.setupThresholdKw;
        const nextProdThresholdKw = key === 'prodThresholdKw' ? nextValue : currentOptions.prodThresholdKw;

        if (nextProdThresholdKw <= nextSetupThresholdKw) {
            setActivityAnalyticsThresholdWarning('Prod. debe ser mayor que Setup.');
            return;
        }

        setActivityAnalyticsThresholdWarning(null);
        onUpdateWidget({ ...selectedWidget, displayOptions: { ...selectedWidget.displayOptions, [key]: nextValue } });
    };

    const handleProdTrendRangeChange = (nextRange: string) => {
        if (!selectedWidget || selectedWidget.type !== 'prod-trend') return;
        const nextRules = resolveActivityAnalyticsDisplayRules({ range: nextRange, start: undefined, end: undefined, groupBy: resolveProdTrendDisplayOptions(selectedWidget.displayOptions as ProdTrendDisplayOptions | undefined, prodTrendThemeDefaultLineColors).groupBy });
        onUpdateWidget({ ...selectedWidget, displayOptions: { ...selectedWidget.displayOptions, range: nextRules.range, groupBy: nextRules.groupBy, start: undefined, end: undefined } });
    };

    const handleProdTrendGroupChange = (nextGroupBy: string) => {
        if (!selectedWidget || selectedWidget.type !== 'prod-trend') return;
        const currentOptions = resolveProdTrendDisplayOptions(selectedWidget.displayOptions as ProdTrendDisplayOptions | undefined, prodTrendThemeDefaultLineColors);
        const nextRules = resolveActivityAnalyticsDisplayRules({ range: currentOptions.range, start: currentOptions.start, end: currentOptions.end, groupBy: nextGroupBy });
        onUpdateWidget({ ...selectedWidget, displayOptions: { ...selectedWidget.displayOptions, range: nextRules.range, groupBy: nextRules.groupBy } });
    };

    const handleProdTrendGroupBarWidthChange = (nextValue: number) => {
        if (!selectedWidget || selectedWidget.type !== 'prod-trend') return;
        const currentOptions = resolveProdTrendDisplayOptions(selectedWidget.displayOptions as ProdTrendDisplayOptions | undefined, prodTrendThemeDefaultLineColors);
        onUpdateWidget({ ...selectedWidget, displayOptions: { ...selectedWidget.displayOptions, groupBarWidths: { ...(selectedWidget.displayOptions?.groupBarWidths ?? {}), [currentOptions.groupBy]: clampActivityAnalyticsGroupBarWidth(nextValue) } } });
    };

    const handleProdTrendLineColorChange = (slotIndex: 0 | 1, value: string) => {
        if (!selectedWidget || selectedWidget.type !== 'prod-trend') return;
        const currentOptions = resolveProdTrendDisplayOptions(selectedWidget.displayOptions as ProdTrendDisplayOptions | undefined, prodTrendThemeDefaultLineColors);
        const nextColors: [string, string] = [...currentOptions.trendLineColors];
        nextColors[slotIndex] = value;
        onUpdateWidget({ ...selectedWidget, displayOptions: { ...selectedWidget.displayOptions, trendLineColors: nextColors } });
    };

    const handleProdTrendLineAlphaChange = (slotIndex: 0 | 1, value: string) => {
        if (!selectedWidget || selectedWidget.type !== 'prod-trend') return;
        const currentOptions = resolveProdTrendDisplayOptions(selectedWidget.displayOptions as ProdTrendDisplayOptions | undefined, prodTrendThemeDefaultLineColors);
        const nextAlphas: [number, number] = [...currentOptions.trendLineColorAlphas];
        const nextValue = Number(value);
        if (!Number.isFinite(nextValue)) return;
        nextAlphas[slotIndex] = Math.min(100, Math.max(0, nextValue));
        onUpdateWidget({ ...selectedWidget, displayOptions: { ...selectedWidget.displayOptions, trendLineColorAlphas: nextAlphas } });
    };

    const handleProdTrendLineHexDraftChange = (slotIndex: 0 | 1, value: string) => {
        const draftKey = `prod-trend-line-${slotIndex}` as ProdTrendLineHexDraftKey;
        const normalizedValue = value.trim().replace(/^#/, '');
        setProdTrendLineHexDrafts((currentDrafts) => ({ ...currentDrafts, [draftKey]: normalizedValue }));
        const nextColor = parseActivityAnalyticsHexCode(normalizedValue);
        if (!nextColor) return;
        handleProdTrendLineColorChange(slotIndex, nextColor);
        setProdTrendLineHexDrafts((currentDrafts) => ({ ...currentDrafts, [draftKey]: normalizedValue.toLowerCase() }));
    };

    const handleProdTrendLineHexDraftBlur = (slotIndex: 0 | 1, resolvedValue: string) => {
        const draftKey = `prod-trend-line-${slotIndex}` as ProdTrendLineHexDraftKey;
        const draftValue = prodTrendLineHexDrafts[draftKey];
        if (draftValue == null) return;
        if (isValidActivityAnalyticsHexCode(draftValue)) {
            setProdTrendLineHexDrafts((currentDrafts) => ({ ...currentDrafts, [draftKey]: draftValue.trim().replace(/^#/, '').toLowerCase() }));
            return;
        }
        setProdTrendLineHexDrafts((currentDrafts) => ({ ...currentDrafts, [draftKey]: formatActivityAnalyticsHexCode(resolvedValue) }));
    };

    const handleProdTrendLineColorPickerChange = (slotIndex: 0 | 1, value: string) => {
        const normalizedValue = value.trim().toLowerCase();
        setProdTrendLineHexDrafts((currentDrafts) => ({ ...currentDrafts, [`prod-trend-line-${slotIndex}`]: formatActivityAnalyticsHexCode(normalizedValue) }));
        handleProdTrendLineColorChange(slotIndex, normalizedValue);
    };

    const handleProdTrendBandColorChange = (slotIndex: ActivityAnalyticsProdTrendBandSlotIndex, value: string | undefined) => {
        if (!selectedWidget || selectedWidget.type !== 'prod-trend') return;
        const currentOptions = resolveProdTrendDisplayOptions(selectedWidget.displayOptions as ProdTrendDisplayOptions | undefined, prodTrendThemeDefaultLineColors);
        const nextColors: [string | undefined, string | undefined, string | undefined] = [...currentOptions.prodTrendBands.colors];
        nextColors[slotIndex] = value;
        onUpdateWidget({ ...selectedWidget, displayOptions: { ...selectedWidget.displayOptions, prodTrendBands: { ...selectedWidget.displayOptions?.prodTrendBands, colors: nextColors } } });
    };

    const handleProdTrendBandAlphaChange = (slotIndex: ActivityAnalyticsProdTrendBandSlotIndex, value: string) => {
        if (!selectedWidget || selectedWidget.type !== 'prod-trend') return;
        const currentOptions = resolveProdTrendDisplayOptions(selectedWidget.displayOptions as ProdTrendDisplayOptions | undefined, prodTrendThemeDefaultLineColors);
        const nextAlphas: [number, number, number] = [...currentOptions.prodTrendBands.alphas];
        const nextValue = Number(value);
        if (!Number.isFinite(nextValue)) return;
        nextAlphas[slotIndex] = Math.min(100, Math.max(0, nextValue));
        onUpdateWidget({ ...selectedWidget, displayOptions: { ...selectedWidget.displayOptions, prodTrendBands: { ...selectedWidget.displayOptions?.prodTrendBands, alphas: nextAlphas } } });
    };

    const handleProdTrendBandBlendModeChange = (blendMode: string) => {
        if (!selectedWidget || selectedWidget.type !== 'prod-trend') return;
        onUpdateWidget({ ...selectedWidget, displayOptions: { ...selectedWidget.displayOptions, prodTrendBands: { ...selectedWidget.displayOptions?.prodTrendBands, blendMode: resolveActivityAnalyticsProdTrendBandBlendMode(blendMode) } } });
    };

    // Product semantics are Texto/Subtexto/Etiqueta, but persisted keys stay
    // `value/label/helpText` to avoid destructive schema changes.
    const handleInfoCardFieldChange = (index: number, storageKey: InfoCardFieldStorageKey, value: string) => {
        if (!selectedWidget || selectedWidget.type !== 'info-card') {
            return;
        }

        const currentOptions = (selectedWidget.displayOptions ?? {}) as InfoCardDisplayOptions;
        const resolvedFields = resolveInfoCardFields(currentOptions);
        const currentFields = resolvedFields.length ? resolvedFields : [{ id: 'field-1', label: '', value: '', helpText: '' }];
        const nextFields = currentFields.map((field, fieldIndex) => (
            fieldIndex === index ? { ...field, [storageKey]: value } : field
        ));

        onUpdateWidget({
            ...selectedWidget,
            displayOptions: {
                ...currentOptions,
                fields: nextFields,
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

    const getUnitSelectOptions = (value?: string | null, includeCustomOption = false) => {
        const normalizedValue = value?.trim() ?? '';
        const baseOptions = PRESET_UNITS.map(unitOption => ({ value: unitOption, label: unitOption }));
        const customOptions = includeCustomOption ? [CUSTOM_UNIT_OPTION] : [];

        if (!normalizedValue || isPresetUnit(normalizedValue)) {
            return [...baseOptions, ...customOptions];
        }

        return [{ value: normalizedValue, label: normalizedValue }, ...baseOptions, ...customOptions];
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
    const isProdTrend = selectedWidget?.type === 'prod-trend';
    const isDashboardTitle = selectedWidget?.type === 'text-title';
    const isInfoCard = selectedWidget?.type === 'info-card';
    const navigationDashboardOptions = availableDashboards
        .filter((dashboard) => dashboard.id !== currentDashboardId)
        .map((dashboard) => ({
            value: dashboard.id,
            label: dashboard.status === 'published'
                ? (dashboard.headerConfig?.title?.trim() || dashboard.name)
                : `${dashboard.headerConfig?.title?.trim() || dashboard.name} (no publicado)`,
            disabled: dashboard.status !== 'published',
        }));
    const handleNavigationTargetChange = (value: string) => {
        if (!selectedWidget) {
            return;
        }

        onUpdateWidget({
            ...selectedWidget,
            navigationTargetDashboardId: value || undefined,
        });
    };
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
    const shouldShowHierarchyPreview = selectedWidget?.type === 'metric-card' && hierarchyTrace !== undefined;
    const isProdHistory = selectedWidget?.type === 'prod-history';
    const isLegacyTrendChart = selectedWidget?.type === 'trend-chart';
    const prodHistoryOptions = isProdHistory
        ? (selectedWidget.displayOptions as ProdHistoryDisplayOptions | undefined)
        : undefined;
    const legacyTrendChartOptions = isLegacyTrendChart
        ? (selectedWidget.displayOptions as TrendChartDisplayOptions | undefined)
        : undefined;
    const machineActivityOptions = isMachineActivity
        ? (selectedWidget.displayOptions as MachineActivityDisplayOptions | undefined)
        : undefined;
    const activityAnalyticsOptions = isActivityAnalytics
        ? resolveActivityAnalyticsDisplayOptions(selectedWidget.displayOptions as ActivityAnalyticsDisplayOptions | undefined)
        : null;
    const prodTrendOptions = isProdTrend
        ? resolveProdTrendDisplayOptions(selectedWidget.displayOptions as ProdTrendDisplayOptions | undefined, prodTrendThemeDefaultLineColors)
        : null;
    const infoCardOptions = isInfoCard
        ? (selectedWidget.displayOptions as InfoCardDisplayOptions | undefined)
        : undefined;
    const metricCardDisplayOptions = selectedWidget?.type === 'metric-card'
        ? (selectedWidget.displayOptions as MetricCardDisplayOptions | undefined)
        : undefined;
    const resolvedInfoCardFields = isInfoCard ? resolveInfoCardFields(infoCardOptions) : [];
    const infoCardFields = isInfoCard
        ? (resolvedInfoCardFields.length ? resolvedInfoCardFields : [{ id: 'field-1', label: '', value: '', helpText: '' }])
        : [];
    const activityAnalyticsDisplayRules = activityAnalyticsOptions
        ? resolveActivityAnalyticsDisplayRules({
            range: activityAnalyticsOptions.range,
            start: activityAnalyticsOptions.start,
            end: activityAnalyticsOptions.end,
            groupBy: activityAnalyticsOptions.groupBy,
        })
        : null;
    const prodTrendDisplayRules = prodTrendOptions
        ? resolveActivityAnalyticsDisplayRules({
            range: prodTrendOptions.range,
            start: prodTrendOptions.start,
            end: prodTrendOptions.end,
            groupBy: prodTrendOptions.groupBy,
        })
        : null;
    const isTrendChartV2 = selectedWidget ? isTrendChartV2Widget(selectedWidget) : false;
    const trendChartV2Options = isTrendChartV2
        ? (selectedWidget?.displayOptions as TrendChartV2DisplayOptions | undefined)
        : undefined;
    const kpiDisplayOptions = isKpi
        ? (selectedWidget.displayOptions as KpiDisplayOptions | undefined)
        : undefined;
    const topCapDisplayOptions = isMachineActivity
        ? machineActivityOptions
        : kpiDisplayOptions;
    const kpiFixedTopCapEffects = isMachineActivity || isKpi
        ? resolveMachineActivityFixedTopCapEffects(topCapDisplayOptions?.fixedTopCapEffects)
        : DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS;
    const kpiFixedTopCapShape = (isKpi || isMachineActivity)
        ? resolveKpiFixedTopCapShape(topCapDisplayOptions?.fixedTopCapShape)
        : DEFAULT_KPI_FIXED_TOP_CAP_SHAPE;
    const kpiTravelingTopCapEffects = (isKpi || isMachineActivity)
        ? resolveKpiTravelingTopCapEffects(topCapDisplayOptions?.travelingTopCapEffects)
        : DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS;
    const isCircularGaugeWidget = ((isMachineActivity ? machineActivityOptions?.kpiMode : kpiDisplayOptions?.kpiMode) ?? 'circular') === 'circular';
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
    const isWidgetUnitEditable = isSimulatedBinding || isUnitOverrideEnabled;
    const simulatedWidgetUnit = (binding.unit?.trim() || widgetUnitDisplayOptions?.unit?.trim() || '');
    const customUnitInputValue = isSimulatedBinding
        ? (simulatedWidgetUnit || (isMachineActivity ? '%' : ''))
        : (widgetUnitDisplayOptions?.unit ?? (isMachineActivity ? '%' : (binding.unit ?? '')));
    const normalizedCustomUnitInputValue = customUnitInputValue.trim();
    const showWidgetCustomUnitInput = isWidgetUnitEditable
        && (isCustomUnit || (!!normalizedCustomUnitInputValue && !isPresetUnit(normalizedCustomUnitInputValue)));
    const widgetUnitSelectValue = showWidgetCustomUnitInput ? CUSTOM_UNIT_OPTION_VALUE : customUnitInputValue;
    const resolvedUnitPreviewValue = resolvedVariableUnit ?? '—';
    const prodHistoryBarWidth = (() => {
        const rawValue = prodHistoryOptions?.productionBarWidth ?? 1;
        return Math.min(1.5, Math.max(0.5, Number.isFinite(rawValue) ? rawValue : 1));
    })();
    const activityAnalyticsBarWidth = activityAnalyticsOptions
        ? resolveActivityAnalyticsGroupBarWidthForGroup(
            activityAnalyticsOptions.groupBy,
            activityAnalyticsOptions.groupBarWidths,
            activityAnalyticsOptions.groupBarWidth,
        )
        : prodTrendOptions
            ? resolveActivityAnalyticsGroupBarWidthForGroup(
                prodTrendOptions.groupBy,
                prodTrendOptions.groupBarWidths,
                prodTrendOptions.groupBarWidth,
            )
        : 1;
    const propertyDockContextTitle = selectedWidget
        ? resolveCanonicalWidgetIdentityLabel(selectedWidget.type)
        : '';
    const shouldShowGeneralIconField = selectedWidget
        && selectedWidget.type !== 'connection-status'
        && selectedWidget.type !== 'text-title'
        && selectedWidget.type !== 'status'
                && selectedWidget.type !== 'trend-chart'
                && selectedWidget.type !== 'activity-analytics'
                && selectedWidget.type !== 'prod-trend';
    const genericDataUnitField = selectedWidget
        && selectedWidget.type !== 'alert-history'
        && selectedWidget.type !== 'prod-history'
        && selectedWidget.type !== 'connection-status'
        && selectedWidget.type !== 'kpi'
        && selectedWidget.type !== 'machine-activity'
        && selectedWidget.type !== 'activity-analytics'
        && selectedWidget.type !== 'prod-trend'
        ? (() => {
            const currentUnit = selectedWidget?.binding?.unit || '';
            const isPreset = isPresetUnit(currentUnit);
            const showCustom = isCustomUnit || (!isPreset && currentUnit !== '');
            const selectValue = showCustom ? CUSTOM_UNIT_OPTION_VALUE : currentUnit;

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
                                    if (val === CUSTOM_UNIT_OPTION_VALUE) {
                                        setIsCustomUnit(true);
                                    } else {
                                        setIsCustomUnit(false);
                                        handleUnitChange(val);
                                    }
                                }}
                                options={[
                                    { value: '', label: 'Sin unidad' },
                                    ...PRESET_UNITS.map(u => ({ value: u, label: u })),
                                    CUSTOM_UNIT_OPTION,
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

    const renderGaugeFixedTopCapSection = () => (
        <DockSection icon={<Sliders size={11} />} title="Top cap fijo" defaultOpen={false}>
            <DockCheckboxField
                label="Recto/Pill"
                ariaLabel="Recto/Pill top cap fijo"
                checked={kpiFixedTopCapShape.pill}
                onChange={(checked) => handleKpiFixedTopCapShapeChange('pill', checked)}
            />
            {FIXED_TOP_CAP_PULSE_SLIDERS.map(({ key, label, ariaLabel, min, max, step }) => (
                <DockSliderField
                    key={key}
                    label={label}
                    value={key === 'pulseStability'
                        ? resolveTravelCompletionPulseStabilityVisualValue(kpiFixedTopCapEffects.pulseStability)
                        : (kpiFixedTopCapEffects[key] ?? DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS[key])}
                    min={min}
                    max={max}
                    step={step}
                    ariaLabel={ariaLabel}
                    onChange={(value) => handleKpiFixedTopCapEffectChange(key, value)}
                />
            ))}
            {KPI_FIXED_TOP_CAP_SLIDERS.map(({ key, label, ariaLabel }) => (
                <DockSliderField
                    key={key}
                    label={label}
                    value={kpiFixedTopCapEffects[key] ?? DEFAULT_KPI_FIXED_TOP_CAP_EFFECTS[key]}
                    min={KPI_TOP_CAP_EFFECT_MIN}
                    max={KPI_TOP_CAP_EFFECT_MAX}
                    step={KPI_TOP_CAP_EFFECT_STEP}
                    ariaLabel={ariaLabel}
                    onChange={(value) => handleKpiFixedTopCapEffectChange(key, value)}
                />
            ))}
        </DockSection>
    );

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
                    <span data-testid="property-dock-context-badge" className="px-2 py-0.5 rounded uppercase admin-accent-ghost">
                        {propertyDockContextTitle}
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
                            {selectedWidget.type === 'metric-card' && (
                                <DockFieldRow label="Tam. Valor">
                                    <AdminNumberInput
                                        value={metricCardDisplayOptions?.valueFontSize ?? DEFAULT_WIDGET_VALUE_FONT_SIZE}
                                        min={MIN_ACTIVITY_ANALYTICS_DONUT_CENTER_VALUE_FONT_SIZE}
                                        max={MAX_ACTIVITY_ANALYTICS_DONUT_CENTER_VALUE_FONT_SIZE}
                                        step={1}
                                        commitOnBlur
                                        ariaLabel="Tarjeta de métrica tamaño de valor"
                                        onChange={handleMetricCardValueFontSizeChange}
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
                                            ...(selectedWidget.type === 'info-card'
                                                ? [{ value: 'Info', label: 'Info', icon: <Info size={12} /> }]
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
                            {(isKpi || isMachineActivity) && (
                                <DockFieldRow label="Tam. Num">
                                        <AdminNumberInput
                                            value={(isMachineActivity ? machineActivityOptions?.valueFontSize : kpiDisplayOptions?.valueFontSize)
                                            ?? DEFAULT_GAUGE_VALUE_FONT_SIZE}
                                            min={MIN_ACTIVITY_ANALYTICS_DONUT_CENTER_VALUE_FONT_SIZE}
                                            max={MAX_ACTIVITY_ANALYTICS_DONUT_CENTER_VALUE_FONT_SIZE}
                                        step={1}
                                        commitOnBlur
                                        ariaLabel={isMachineActivity ? 'Actividad de Máquina tamaño' : 'KPI tamaño'}
                                        onChange={handleGaugeValueFontSizeChange}
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
                                                {TEXT_ALIGN_BUTTON_OPTIONS.map(({ value, label, Icon }) => (
                                                    <button
                                                        key={value}
                                                        type="button"
                                                        onClick={() => handleDisplayOptionChange('textAlign', value)}
                                                        aria-label={label}
                                                        title={label}
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

                        {isInfoCard && (
                            <DockSection icon={<Info size={11} />} title="INFO-CARD">
                                <DockInfoBox
                                    variant="normal"
                                    text="Static admin-authored fields only. No telemetry binding or plant control is available."
                                />
                                <DockFieldRow label="Subtítulo">
                                    <input
                                        type="text"
                                        className={INPUT_CLS}
                                        value={infoCardOptions?.subtitle || ''}
                                        onChange={e => handleDisplayOptionChange('subtitle', e.target.value)}
                                        placeholder="Short context"
                                    />
                                </DockFieldRow>
                                <DockFieldRow label="Tamaño">
                                    <AdminNumberInput
                                        value={infoCardOptions?.valueFontSize ?? DEFAULT_INFO_CARD_VALUE_FONT_SIZE}
                                        min={12}
                                        max={200}
                                        step={1}
                                        commitOnBlur
                                        onChange={val => handleNumericDisplayOptionChange('valueFontSize', val)}
                                    />
                                </DockFieldRow>
                                <DockFieldRow label="Alinear">
                                    <div className="flex gap-1">
                                        {TEXT_ALIGN_BUTTON_OPTIONS.map(({ value, label, Icon }) => {
                                            const currentAlign = resolveInfoCardTextAlign(infoCardOptions);

                                            return (
                                                <button
                                                    key={value}
                                                    type="button"
                                                    onClick={() => handleDisplayOptionChange('textAlign', value)}
                                                    aria-label={label}
                                                    title={label}
                                                    className={`p-1.5 rounded transition-colors ${currentAlign === value ? 'bg-white/10 text-white' : 'text-industrial-muted hover:text-white hover:bg-white/5'}`}
                                                >
                                                    <Icon size={14} />
                                                </button>
                                            );
                                        })}
                                    </div>
                                </DockFieldRow>
                                {infoCardFields.map((field, index) => {
                                    const fieldContent = resolveInfoCardFieldContent(field);
                                    const valueByStorageKey: Record<InfoCardFieldStorageKey, string> = {
                                        value: fieldContent.text ?? '',
                                        label: fieldContent.subtext,
                                        helpText: fieldContent.tag ?? '',
                                    };

                                    return (
                                        <div key={field.id} className="flex flex-col gap-2">
                                            {INFO_CARD_FIELD_EDITOR_ROWS.map(({ storageKey, semanticLabel, placeholder }) => (
                                                <DockFieldRow key={`${field.id}-${storageKey}`} label={`${semanticLabel} ${index + 1}`}>
                                                    <input
                                                        type="text"
                                                        className={INPUT_CLS}
                                                        value={valueByStorageKey[storageKey]}
                                                        onChange={e => handleInfoCardFieldChange(index, storageKey, e.target.value)}
                                                        placeholder={placeholder}
                                                    />
                                                </DockFieldRow>
                                            ))}
                                        </div>
                                    );
                                })}
                            </DockSection>
                        )}

                        {/* ─── DATOS — no aplica para alert-history ni prod-history (datos mock propios) ─── */}
                        {selectedWidget.type !== 'alert-history' && selectedWidget.type !== 'prod-history' && selectedWidget.type !== 'text-title' && selectedWidget.type !== 'info-card' && (
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

                                {isActivityAnalytics || isProdTrend ? (
                                    <>
                                        {(isActivityAnalytics || isProdTrend) && (
                                            <DockFieldRow label="Modo">
                                                <AdminSelect
                                                    value={isActivityAnalytics
                                                        ? (activityAnalyticsOptions?.dataMode ?? 'real')
                                                        : (prodTrendOptions?.dataMode ?? 'real')}
                                                    onChange={(value) => handleDisplayOptionChange('dataMode', value)}
                                                    options={ANALYTICS_DATA_MODE_OPTIONS}
                                                />
                                            </DockFieldRow>
                                        )}

                                        {((isActivityAnalytics && activityAnalyticsOptions?.dataMode === 'real')
                                            || (isProdTrend && prodTrendOptions?.dataMode === 'real')) && (
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
                                        )}

                                        <DockFieldRow label="Rango">
                                            <AdminSelect
                                                value={isActivityAnalytics ? (activityAnalyticsOptions?.range ?? '7d') : (prodTrendOptions?.range ?? '7d')}
                                                onChange={isActivityAnalytics ? handleActivityAnalyticsRangeChange : handleProdTrendRangeChange}
                                                options={ACTIVITY_ANALYTICS_RANGE_OPTIONS}
                                            />
                                        </DockFieldRow>
                                    </>
                                ) : (
                                    <>
                                        {genericDataUnitField}

                                        {hasCatalogSupport && binding.mode === 'real_variable' && (
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

                                        {shouldShowHierarchyPreview && (
                                            <div className="flex flex-col gap-2">
                                                {hierarchyTrace.state === 'resolved' ? (
                                                    <>
                                                        <DockFieldRow label="Resultado">
                                                            <span className="text-white">
                                                                {`${getHierarchyAggregationModeLabel(hierarchyTrace.aggregation)} actual · ${formatHierarchyTraceValue(hierarchyTrace.resolved.value, hierarchyTrace.resolved.unit)} · ${hierarchyTrace.scannedDashboardCount} ${hierarchyTrace.scannedDashboardCount === 1 ? 'dashboard' : 'dashboards'}`}
                                                            </span>
                                                        </DockFieldRow>

                                                        {hierarchyTrace.included.length > 0 && (
                                                            <DockFieldRow label={hierarchyTrace.included.length === 1 ? 'Incluido' : 'Incluidos'}>
                                                                <DockInfoDropdown value={`${hierarchyTrace.included.length} ${hierarchyTrace.included.length === 1 ? 'widget' : 'widgets'}`}>
                                                                    <div className={ADMIN_SIDEBAR_INFO_LIST_CLS}>
                                                                        {hierarchyTrace.included.map((entry) => (
                                                                            <div key={`${entry.nodeId}-${entry.widgetId}`} className={ADMIN_SIDEBAR_INFO_ITEM_CLS}>
                                                                                <div className={ADMIN_SIDEBAR_INFO_TITLE_CLS}>{entry.widgetTitle}</div>
                                                                                <div className={ADMIN_SIDEBAR_HINT_CLS}>
                                                                                    {`${entry.nodeName} · ${formatHierarchyTraceValue(entry.value, entry.unit)}`}
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </DockInfoDropdown>
                                                            </DockFieldRow>
                                                        )}

                                                        {hierarchyTrace.excluded.length > 0 && (
                                                            <DockFieldRow label={hierarchyTrace.excluded.length === 1 ? 'Excluido' : 'Excluidos'}>
                                                                <DockInfoDropdown value={`${hierarchyTrace.excluded.length} ${hierarchyTrace.excluded.length === 1 ? 'widget' : 'widgets'}`}>
                                                                    <div className={ADMIN_SIDEBAR_INFO_LIST_CLS}>
                                                                        {hierarchyTrace.excluded.map((entry, index) => (
                                                                            <div key={`${entry.nodeId}-${entry.widgetId ?? entry.dashboardId ?? index}`} className={ADMIN_SIDEBAR_INFO_ITEM_CLS}>
                                                                                <div className={ADMIN_SIDEBAR_INFO_TITLE_CLS}>{entry.widgetTitle ?? entry.dashboardName ?? entry.nodeName}</div>
                                                                                <div className={ADMIN_SIDEBAR_HINT_CLS}>
                                                                                    {getHierarchyTraceExclusionReasonLabel(entry.reason)}
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </DockInfoDropdown>
                                                            </DockFieldRow>
                                                        )}
                                                    </>
                                                ) : hierarchyTrace.emptyReason ? (
                                                    (() => {
                                                        const message = getHierarchyTraceEmptyStateMessage(hierarchyTrace.emptyReason);
                                                        return (
                                                            <DockInlineControlRow label="Resultado" labelClassName="w-14">
                                                                <div className="flex flex-col gap-1">
                                                                    <span className="text-white">{message.title}</span>
                                                                    <span className={ADMIN_SIDEBAR_HINT_CLS}>{message.description}</span>
                                                                </div>
                                                            </DockInlineControlRow>
                                                        );
                                                    })()
                                                ) : null}
                                            </div>
                                        )}
                                    </>
                                        )}

                                        <>
                                        <DockFieldRow label={isConnectionWidget ? 'Origen' : 'Modo'}>
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
                                                        { value: 'real_variable', label: 'Real' },
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
                                            <>
                                                <DockFieldRow label="Unidad">
                                                    <AdminSelect
                                                        value={widgetUnitSelectValue}
                                                        onChange={val => {
                                                            if (val === CUSTOM_UNIT_OPTION_VALUE) {
                                                                setIsCustomUnit(true);
                                                                return;
                                                            }

                                                            setIsCustomUnit(false);
                                                            handleWidgetSimulatedUnitChange(val);
                                                        }}
                                                        placeholder="Seleccionar"
                                                        disabled={isBindingSourceDisabled}
                                                        options={getUnitSelectOptions(customUnitInputValue, true)}
                                                    />
                                                </DockFieldRow>
                                                {showWidgetCustomUnitInput && !isBindingSourceDisabled && (
                                                    <DockFieldRow label="">
                                                        <input
                                                            type="text"
                                                            className={INPUT_CLS}
                                                            value={customUnitInputValue}
                                                            onChange={e => handleWidgetSimulatedUnitChange(e.target.value)}
                                                            placeholder="Unidad personalizada"
                                                            autoFocus
                                                        />
                                                    </DockFieldRow>
                                                )}
                                            </>
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
                                                                value={isUnitOverrideEnabled ? widgetUnitSelectValue : resolvedUnitPreviewValue}
                                                                onChange={val => {
                                                                    if (val === CUSTOM_UNIT_OPTION_VALUE) {
                                                                        setIsCustomUnit(true);
                                                                        return;
                                                                    }

                                                                    setIsCustomUnit(false);
                                                                    handleWidgetDisplayUnitChange(val);
                                                                }}
                                                                placeholder="Seleccionar"
                                                                disabled={!isUnitOverrideEnabled}
                                                                options={getUnitSelectOptions(isUnitOverrideEnabled ? customUnitInputValue : resolvedUnitPreviewValue, isUnitOverrideEnabled)}
                                                            />
                                                        </DockFieldRow>
                                                        {showWidgetCustomUnitInput && isUnitOverrideEnabled && (
                                                            <DockFieldRow label="">
                                                                <input
                                                                    type="text"
                                                                    className={INPUT_CLS}
                                                                    value={customUnitInputValue}
                                                                    onChange={e => handleWidgetDisplayUnitChange(e.target.value)}
                                                                    placeholder="Unidad personalizada"
                                                                    autoFocus
                                                                />
                                                            </DockFieldRow>
                                                        )}
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

                        {(isActivityAnalytics || isProdTrend) && (
                            <DockSection icon={<BarChart2 size={11} />} title="Agrupación">
                                <DockFieldRow label="Grupo">
                                    <AdminSelect
                                        value={isActivityAnalytics ? (activityAnalyticsOptions?.groupBy ?? 'day') : (prodTrendOptions?.groupBy ?? 'day')}
                                        onChange={isActivityAnalytics ? handleActivityAnalyticsGroupChange : handleProdTrendGroupChange}
                                        options={ACTIVITY_ANALYTICS_GROUP_OPTIONS.filter((option) => (isActivityAnalytics ? activityAnalyticsDisplayRules : prodTrendDisplayRules)?.allowedGroups.includes(option.value) ?? false)}
                                    />
                                </DockFieldRow>
                                <DockSliderField
                                    label="Ancho"
                                    value={activityAnalyticsBarWidth}
                                    min={0.1}
                                    max={1.5}
                                    step={0.1}
                                    ariaLabel="Ancho"
                                    onChange={isActivityAnalytics ? handleActivityAnalyticsGroupBarWidthChange : handleProdTrendGroupBarWidthChange}
                                />
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

                        {(isActivityAnalytics || isProdTrend) && (
                            <DockSection icon={<Activity size={11} />} title="Estados Productivos">
                                <DockFieldRow label="Setup ≥">
                                    <AdminNumberInput
                                        value={isActivityAnalytics ? (activityAnalyticsOptions?.setupThresholdKw ?? 0.15) : (prodTrendOptions?.setupThresholdKw ?? 0.15)}
                                        min={0}
                                        step={0.01}
                                        commitOnBlur
                                        onChange={val => (isActivityAnalytics ? handleActivityAnalyticsThresholdChange('setupThresholdKw', val) : handleProdTrendThresholdChange('setupThresholdKw', val))}
                                    />
                                </DockFieldRow>
                                <DockFieldRow label="Prod. ≥">
                                    <AdminNumberInput
                                        value={isActivityAnalytics ? (activityAnalyticsOptions?.prodThresholdKw ?? 0.25) : (prodTrendOptions?.prodThresholdKw ?? 0.25)}
                                        min={0}
                                        step={0.01}
                                        commitOnBlur
                                        onChange={val => (isActivityAnalytics ? handleActivityAnalyticsThresholdChange('prodThresholdKw', val) : handleProdTrendThresholdChange('prodThresholdKw', val))}
                                    />
                                </DockFieldRow>
                                {activityAnalyticsThresholdWarning && (
                                    <DockInfoBox variant="warning" text={activityAnalyticsThresholdWarning} />
                                )}
                            </DockSection>
                        )}

                        {isProdTrend && prodTrendOptions && (
                            <>
                                <DockSection icon={<TrendingUp size={11} />} title="COLORES TENDENCIA % PROD">
                                    {PROD_TREND_LINE_STOPS.map(({ slotIndex, label: stopLabel }) => {
                                        const resolvedHexValue = prodTrendOptions.trendLineColors[slotIndex];
                                        const draftKey = `prod-trend-line-${slotIndex}` as ProdTrendLineHexDraftKey;
                                        const displayedHexValue = prodTrendLineHexDrafts[draftKey] ?? formatActivityAnalyticsHexCode(resolvedHexValue);
                                        const isDraftInvalid = displayedHexValue.length > 0 && !isValidActivityAnalyticsHexCode(displayedHexValue);
                                        return (
                                            <DockColorField
                                                key={draftKey}
                                                label={stopLabel}
                                                color={resolvedHexValue}
                                                hexCode={displayedHexValue}
                                                alpha={prodTrendOptions.trendLineColorAlphas[slotIndex]}
                                                invalid={isDraftInvalid}
                                                swatchAriaLabel={`Tendencia % Prod color ${slotIndex === 0 ? 'inicial' : 'final'}`}
                                                hexInputAriaLabel={`Tendencia % Prod hex ${slotIndex === 0 ? 'inicial' : 'final'}`}
                                                alphaInputAriaLabel={`Tendencia % Prod alfa ${slotIndex === 0 ? 'inicial' : 'final'}`}
                                                onColorChange={(nextValue) => handleProdTrendLineColorPickerChange(slotIndex, nextValue)}
                                                onHexCodeChange={(nextValue) => handleProdTrendLineHexDraftChange(slotIndex, nextValue)}
                                                onHexCodeBlur={() => handleProdTrendLineHexDraftBlur(slotIndex, resolvedHexValue)}
                                                onAlphaChange={(nextValue) => handleProdTrendLineAlphaChange(slotIndex, nextValue)}
                                            />
                                        );
                                    })}
                                </DockSection>

                                <DockSection icon={<TrendingUp size={11} />} title="BANDAS TENDENCIA % PROD">
                                    {ACTIVITY_ANALYTICS_PROD_TREND_BAND_STOPS.map(({ slotIndex, label: stopLabel }) => {
                                        const resolvedHexValue = prodTrendOptions.prodTrendBands.colors[slotIndex] ?? '';
                                        const displayedHexValue = activityAnalyticsProdTrendBandHexDrafts[getActivityAnalyticsProdTrendBandHexDraftKey(slotIndex)] ?? formatActivityAnalyticsHexCode(resolvedHexValue);
                                        const isDraftInvalid = displayedHexValue.length > 0 && !isValidActivityAnalyticsHexCode(displayedHexValue);
                                        const pickerValue = prodTrendOptions.prodTrendBands.colors[slotIndex] ?? DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_COLOR_INPUT;
                                        return (
                                            <DockColorField
                                                key={`prod-trend-standalone-band-${slotIndex}`}
                                                label={stopLabel}
                                                color={pickerValue}
                                                hexCode={displayedHexValue}
                                                alpha={prodTrendOptions.prodTrendBands.alphas[slotIndex]}
                                                invalid={isDraftInvalid}
                                                swatchAriaLabel={`Bandas tendencia standalone color ${stopLabel.toLowerCase()}`}
                                                hexInputAriaLabel={`Bandas tendencia standalone hex ${stopLabel.toLowerCase()}`}
                                                alphaInputAriaLabel={`Bandas tendencia standalone alfa ${stopLabel.toLowerCase()}`}
                                                onColorChange={(nextValue) => handleProdTrendBandColorChange(slotIndex, nextValue)}
                                                onHexCodeChange={(nextValue) => handleActivityAnalyticsProdTrendBandHexDraftChange(slotIndex, nextValue)}
                                                onHexCodeBlur={() => handleActivityAnalyticsProdTrendBandHexDraftBlur(slotIndex, resolvedHexValue)}
                                                onAlphaChange={(nextValue) => handleProdTrendBandAlphaChange(slotIndex, nextValue)}
                                            />
                                        );
                                    })}
                                    <DockFieldRow label="Blend">
                                        <AdminSelect
                                            value={prodTrendOptions.prodTrendBands.blendMode}
                                            onChange={handleProdTrendBandBlendModeChange}
                                            options={ACTIVITY_ANALYTICS_TREND_BAND_BLEND_MODE_OPTIONS.map((blendMode) => ({ value: blendMode, label: ACTIVITY_ANALYTICS_PROD_TREND_BAND_BLEND_MODE_LABELS[blendMode] }))}
                                        />
                                    </DockFieldRow>
                                </DockSection>
                            </>
                        )}

                        {isActivityAnalytics && activityAnalyticsOptions && (
                            <>
                                {ACTIVITY_ANALYTICS_STATE_GRADIENT_ROWS.map(({ key, label }) => {
                                    const stateGradients = activityAnalyticsOptions.stateGradients as Record<ActivityAnalyticsStateGradientKey, [string, string]>;
                                    const stateGradientAlphas = activityAnalyticsOptions.stateGradientAlphas as Record<ActivityAnalyticsStateGradientKey, ActivityAnalyticsAlphaPair>;
                                    const gradient = stateGradients[key];
                                    const gradientAlphas = stateGradientAlphas[key];
                                    const sectionTitle = key === 'prod' ? 'COLORES PRODUCCION' : `COLORES ${label.toUpperCase()}`;

                                    return (
                                        <DockSection key={key} icon={<Sliders size={11} />} title={sectionTitle}>
                                            {ACTIVITY_ANALYTICS_GRADIENT_STOPS.map(({ slotIndex, key: stopKey, label: stopLabel }) => {
                                                const resolvedHexValue = gradient[slotIndex];
                                                const draftKey = getActivityAnalyticsHexDraftKey(key, slotIndex);
                                                const displayedHexValue = activityAnalyticsHexDrafts[draftKey] ?? formatActivityAnalyticsHexCode(resolvedHexValue);
                                                const isDraftInvalid = displayedHexValue.length > 0 && !isValidActivityAnalyticsHexCode(displayedHexValue);

                                                return (
                                                    <DockColorField
                                                        key={`${key}-${stopKey}`}
                                                        label={stopLabel}
                                                        color={resolvedHexValue}
                                                        hexCode={displayedHexValue}
                                                        alpha={gradientAlphas[slotIndex]}
                                                        invalid={isDraftInvalid}
                                                        swatchAriaLabel={`${label} color ${slotIndex === 0 ? 'inicial' : 'final'}`}
                                                        hexInputAriaLabel={`${label} hex ${slotIndex === 0 ? 'inicial' : 'final'}`}
                                                        alphaInputAriaLabel={`${label} alfa ${slotIndex === 0 ? 'inicial' : 'final'}`}
                                                        onColorChange={(nextValue) => handleActivityAnalyticsColorPickerChange(key, slotIndex, nextValue)}
                                                        onHexCodeChange={(nextValue) => handleActivityAnalyticsHexDraftChange(key, slotIndex, nextValue)}
                                                        onHexCodeBlur={() => handleActivityAnalyticsHexDraftBlur(key, slotIndex, resolvedHexValue)}
                                                        onAlphaChange={(nextValue) => handleActivityAnalyticsStateGradientAlphaChange(key, slotIndex, nextValue)}
                                                    />
                                                );
                                            })}
                                        </DockSection>
                                    );
                                })}

                                <DockSection icon={<TrendingUp size={11} />} title="BANDAS TENDENCIA % PROD">
                                    {ACTIVITY_ANALYTICS_PROD_TREND_BAND_STOPS.map(({ slotIndex, label: stopLabel }) => {
                                        const resolvedHexValue = activityAnalyticsOptions.prodTrendBands.colors[slotIndex] ?? '';
                                        const displayedHexValue = activityAnalyticsProdTrendBandHexDrafts[getActivityAnalyticsProdTrendBandHexDraftKey(slotIndex)]
                                            ?? formatActivityAnalyticsHexCode(resolvedHexValue);
                                        const isDraftInvalid = displayedHexValue.length > 0 && !isValidActivityAnalyticsHexCode(displayedHexValue);
                                        const pickerValue = activityAnalyticsOptions.prodTrendBands.colors[slotIndex] ?? DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_COLOR_INPUT;

                                        return (
                                            <DockColorField
                                                key={`prod-trend-band-${slotIndex}`}
                                                label={stopLabel}
                                                color={pickerValue}
                                                hexCode={displayedHexValue}
                                                alpha={activityAnalyticsOptions.prodTrendBands.alphas[slotIndex]}
                                                invalid={isDraftInvalid}
                                                swatchAriaLabel={`Bandas tendencia color ${stopLabel.toLowerCase()}`}
                                                hexInputAriaLabel={`Bandas tendencia hex ${stopLabel.toLowerCase()}`}
                                                alphaInputAriaLabel={`Bandas tendencia alfa ${stopLabel.toLowerCase()}`}
                                                onColorChange={(nextValue) => handleActivityAnalyticsProdTrendBandColorPickerChange(slotIndex, nextValue)}
                                                onHexCodeChange={(nextValue) => handleActivityAnalyticsProdTrendBandHexDraftChange(slotIndex, nextValue)}
                                                onHexCodeBlur={() => handleActivityAnalyticsProdTrendBandHexDraftBlur(slotIndex, resolvedHexValue)}
                                                onAlphaChange={(nextValue) => handleActivityAnalyticsProdTrendBandAlphaChange(slotIndex, nextValue)}
                                            />
                                        );
                                    })}

                                    <DockFieldRow label="Blend">
                                        <AdminSelect
                                            value={activityAnalyticsOptions.prodTrendBands.blendMode}
                                            onChange={handleActivityAnalyticsProdTrendBandBlendModeChange}
                                            options={ACTIVITY_ANALYTICS_TREND_BAND_BLEND_MODE_OPTIONS.map((blendMode) => ({
                                                value: blendMode,
                                                label: ACTIVITY_ANALYTICS_PROD_TREND_BAND_BLEND_MODE_LABELS[blendMode],
                                            }))}
                                        />
                                    </DockFieldRow>
                                </DockSection>

                                {(() => {
                                    const displayedCoverageColor = activityAnalyticsCoverageColorDraft ?? formatActivityAnalyticsHexCode(activityAnalyticsOptions.coverageColor);
                                    const isCoverageDraftInvalid = displayedCoverageColor.length > 0
                                        && !isValidActivityAnalyticsHexCode(displayedCoverageColor);

                                    return (
                                        <DockSection icon={<AreaChart size={11} />} title="COBERTURA SIN DATOS">
                                            <DockColorField
                                                label="Cobertura"
                                                color={activityAnalyticsOptions.coverageColor}
                                                hexCode={displayedCoverageColor}
                                                alpha={100}
                                                showAlpha={false}
                                                invalid={isCoverageDraftInvalid}
                                                swatchAriaLabel="Cobertura / sin datos color"
                                                hexInputAriaLabel="Cobertura / sin datos hex"
                                                onColorChange={(nextValue) => {
                                                    setActivityAnalyticsCoverageColorDraft(formatActivityAnalyticsHexCode(nextValue));
                                                    handleActivityAnalyticsCoverageColorChange(nextValue);
                                                }}
                                                onHexCodeChange={handleActivityAnalyticsCoverageColorDraftChange}
                                                onHexCodeBlur={() => handleActivityAnalyticsCoverageColorDraftBlur(activityAnalyticsOptions.coverageColor)}
                                                onAlphaChange={() => undefined}
                                                className="gap-2"
                                            />
                                        </DockSection>
                                    );
                                })()}

                                {ACTIVITY_ANALYTICS_SURFACE_EFFECT_CARDS.map(({ key, label }) => {
                                    const surfaceEffects = (key === 'groupedBars'
                                        ? activityAnalyticsOptions.visualEffects.groupedBars
                                        : activityAnalyticsOptions.visualEffects.donut) as ActivityAnalyticsSurfaceEffects;

                                    return (
                                        <DockSection key={key} icon={<Settings size={11} />} title={label.toUpperCase()}>
                                            {key === 'donut' && (
                                                <DockFieldRow label="Tam. Num">
                                                    <AdminNumberInput
                                                        value={activityAnalyticsOptions.donutCenterValueFontSize ?? DEFAULT_ACTIVITY_ANALYTICS_DONUT_CENTER_VALUE_FONT_SIZE}
                                                        min={MIN_ACTIVITY_ANALYTICS_DONUT_CENTER_VALUE_FONT_SIZE}
                                                        max={MAX_ACTIVITY_ANALYTICS_DONUT_CENTER_VALUE_FONT_SIZE}
                                                        step={1}
                                                        commitOnBlur
                                                        ariaLabel="Donut tamaño"
                                                        onChange={handleActivityAnalyticsDonutCenterValueFontSizeChange}
                                                    />
                                                </DockFieldRow>
                                            )}
                                            <DockFieldRow label="Glow">
                                                <AdminNumberInput
                                                    value={surfaceEffects.glow}
                                                    min={0}
                                                    max={100}
                                                    step={1}
                                                    commitOnBlur
                                                    ariaLabel={`${label} glow`}
                                                    onChange={(nextValue) => handleActivityAnalyticsSurfaceEffectChange(key, 'glow', nextValue)}
                                                />
                                            </DockFieldRow>
                                            <DockFieldRow label="Blur">
                                                <AdminNumberInput
                                                    value={surfaceEffects.blur}
                                                    min={0}
                                                    max={8}
                                                    step={0.1}
                                                    commitOnBlur
                                                    ariaLabel={`${label} blur`}
                                                    onChange={(nextValue) => handleActivityAnalyticsSurfaceEffectChange(key, 'blur', nextValue)}
                                                />
                                            </DockFieldRow>
                                            <label className="flex items-center justify-between gap-3 text-industrial-text">
                                                <span>Top cap</span>
                                                <input
                                                    type="checkbox"
                                                    checked={surfaceEffects.topCap}
                                                    onChange={(event) => handleActivityAnalyticsSurfaceEffectChange(key, 'topCap', event.target.checked)}
                                                    aria-label={`${label} top cap`}
                                                />
                                            </label>
                                        </DockSection>
                                    );
                                })}
                            </>
                        )}

                        {(isMachineActivity || isKpi) && isCircularGaugeWidget && (
                            <DockSection icon={<Settings size={11} />} title="Visualización">
                                {CIRCULAR_GAUGE_VISUAL_SLIDERS.map(({ key, label, ariaLabel, min, max, step, defaultValue }) => (
                                    <DockSliderField
                                        key={key}
                                        label={label}
                                        value={(isMachineActivity ? machineActivityOptions?.[key] : kpiDisplayOptions?.[key]) ?? defaultValue}
                                        min={min}
                                        max={max}
                                        step={step}
                                        ariaLabel={ariaLabel}
                                        onChange={(value) => handleDisplayOptionChange(key, value)}
                                    />
                                ))}
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

                        {isMachineActivity && isCircularGaugeWidget && (
                            renderGaugeFixedTopCapSection()
                        )}

                        {isMachineActivity && isCircularGaugeWidget && (
                            <DockSection icon={<Sliders size={11} />} title="Top cap viajero" defaultOpen={false}>
                                <DockCompactNumberField
                                    label="Vel. Min"
                                    value={resolveStoredTravelingTopCapSpeedScale(
                                        machineActivityOptions?.travelingTopCapMinSpeed,
                                        DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_PX_PER_SECOND,
                                    ) ?? DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_SCALE}
                                    min={TRAVELING_TOP_CAP_SPEED_SCALE_MIN}
                                    max={TRAVELING_TOP_CAP_SPEED_SCALE_MAX}
                                    step={TRAVELING_TOP_CAP_SPEED_SCALE_STEP}
                                    ariaLabel="Vel. Min top cap viajero"
                                    onChange={(value) => handleGaugeTravelingTopCapSpeedChange('travelingTopCapMinSpeed', value)}
                                />
                                <DockCompactNumberField
                                    label="Vel. Max"
                                    value={resolveStoredTravelingTopCapSpeedScale(
                                        machineActivityOptions?.travelingTopCapMaxSpeed,
                                        DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_PX_PER_SECOND,
                                    ) ?? DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_SCALE}
                                    min={TRAVELING_TOP_CAP_SPEED_SCALE_MIN}
                                    max={TRAVELING_TOP_CAP_SPEED_SCALE_MAX}
                                    step={TRAVELING_TOP_CAP_SPEED_SCALE_STEP}
                                    ariaLabel="Vel. Max top cap viajero"
                                    onChange={(value) => handleGaugeTravelingTopCapSpeedChange('travelingTopCapMaxSpeed', value)}
                                />
                                {KPI_TRAVELING_TOP_CAP_SLIDERS.map(({ key, label, ariaLabel }) => (
                                    <DockSliderField
                                        key={key}
                                        label={label}
                                        value={kpiTravelingTopCapEffects[key] ?? DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS[key]}
                                        min={KPI_TOP_CAP_EFFECT_MIN}
                                        max={KPI_TOP_CAP_EFFECT_MAX}
                                        step={KPI_TOP_CAP_EFFECT_STEP}
                                        ariaLabel={ariaLabel}
                                        onChange={(value) => handleKpiTravelingTopCapEffectChange(key, value)}
                                    />
                                ))}
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

                        {isKpi && isCircularGaugeWidget && (
                            renderGaugeFixedTopCapSection()
                        )}

                        {isKpi && isCircularGaugeWidget && (
                            <DockSection icon={<Sliders size={11} />} title="Top cap viajero" defaultOpen={false}>
                                <DockCompactNumberField
                                    label="Vel. Min"
                                    value={resolveStoredTravelingTopCapSpeedScale(
                                        kpiDisplayOptions?.travelingTopCapMinSpeed,
                                        DEFAULT_TRAVELING_TOP_CAP_MIN_SPEED_PX_PER_SECOND,
                                    )}
                                    min={TRAVELING_TOP_CAP_SPEED_SCALE_MIN}
                                    max={TRAVELING_TOP_CAP_SPEED_SCALE_MAX}
                                    step={TRAVELING_TOP_CAP_SPEED_SCALE_STEP}
                                    ariaLabel="Vel. Min top cap viajero"
                                    onChange={(value) => handleGaugeTravelingTopCapSpeedChange('travelingTopCapMinSpeed', value)}
                                />
                                <DockCompactNumberField
                                    label="Vel. Max"
                                    value={resolveStoredTravelingTopCapSpeedScale(
                                        kpiDisplayOptions?.travelingTopCapMaxSpeed,
                                        DEFAULT_TRAVELING_TOP_CAP_MAX_SPEED_PX_PER_SECOND,
                                    )}
                                    min={TRAVELING_TOP_CAP_SPEED_SCALE_MIN}
                                    max={TRAVELING_TOP_CAP_SPEED_SCALE_MAX}
                                    step={TRAVELING_TOP_CAP_SPEED_SCALE_STEP}
                                    ariaLabel="Vel. Max top cap viajero"
                                    onChange={(value) => handleGaugeTravelingTopCapSpeedChange('travelingTopCapMaxSpeed', value)}
                                />
                                {KPI_TRAVELING_TOP_CAP_SLIDERS.map(({ key, label, ariaLabel }) => (
                                    <DockSliderField
                                        key={key}
                                        label={label}
                                        value={kpiTravelingTopCapEffects[key] ?? DEFAULT_KPI_TRAVELING_TOP_CAP_EFFECTS[key]}
                                        min={KPI_TOP_CAP_EFFECT_MIN}
                                        max={KPI_TOP_CAP_EFFECT_MAX}
                                        step={KPI_TOP_CAP_EFFECT_STEP}
                                        ariaLabel={ariaLabel}
                                        onChange={(value) => handleKpiTravelingTopCapEffectChange(key, value)}
                                    />
                                ))}
                            </DockSection>
                        )}

                        {selectedWidget.type === 'prod-history' && (
                            <DockSection icon={<Database size={11} />} title="Datos">
                                <DockFieldRow label="Unidad">
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
                                </DockFieldRow>

                                <DockFieldRow label="Modo">
                                    <AdminSelect
                                        value={binding.mode}
                                        onChange={val => handleModeChange(val as WidgetBinding['mode'])}
                                        options={[
                                            { value: 'simulated_value', label: 'Simulado' },
                                            { value: 'real_variable', label: 'Real' },
                                        ]}
                                    />
                                </DockFieldRow>

                                {binding.mode === 'real_variable' && (
                                    <>
                                        <DockFieldRow label="Var. Prod.">
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
                                        </DockFieldRow>

                                        <DockFieldRow label="Var. OEE">
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
                                        </DockFieldRow>
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

                        {selectedWidget.type === 'prod-history' && (
                            <DockSection icon={<Sliders size={11} />} title="Línea OEE">
                                <DockSliderField
                                    label="Grosor"
                                    value={prodHistoryOptions?.oeeLineStrokeWidth ?? PROD_HISTORY_OEE_DEFAULT_LINE_STROKE_WIDTH}
                                    min={LEGACY_TREND_CHART_LINE_STROKE_WIDTH_MIN}
                                    max={LEGACY_TREND_CHART_LINE_STROKE_WIDTH_MAX}
                                    step={LEGACY_TREND_CHART_LINE_STYLE_STEP}
                                    onChange={(value) => handleDisplayOptionChange('oeeLineStrokeWidth', value)}
                                />
                                <DockSliderField
                                    label="Glow"
                                    value={prodHistoryOptions?.oeeLineGlowBlur ?? PROD_HISTORY_OEE_DEFAULT_LINE_GLOW_BLUR}
                                    min={LEGACY_TREND_CHART_LINE_GLOW_BLUR_MIN}
                                    max={LEGACY_TREND_CHART_LINE_GLOW_BLUR_MAX}
                                    step={LEGACY_TREND_CHART_LINE_STYLE_STEP}
                                    onChange={(value) => handleDisplayOptionChange('oeeLineGlowBlur', value)}
                                />
                            </DockSection>
                        )}

                        {selectedWidget.type === 'prod-history' && (
                            <DockSection icon={<Sliders size={11} />} title="Línea producción">
                                <DockSliderField
                                    label="Grosor"
                                    value={prodHistoryOptions?.productionLineStrokeWidth ?? PROD_HISTORY_PRODUCTION_DEFAULT_LINE_STROKE_WIDTH}
                                    min={LEGACY_TREND_CHART_LINE_STROKE_WIDTH_MIN}
                                    max={LEGACY_TREND_CHART_LINE_STROKE_WIDTH_MAX}
                                    step={LEGACY_TREND_CHART_LINE_STYLE_STEP}
                                    onChange={(value) => handleDisplayOptionChange('productionLineStrokeWidth', value)}
                                />
                                <DockSliderField
                                    label="Glow"
                                    value={prodHistoryOptions?.productionLineGlowBlur ?? PROD_HISTORY_PRODUCTION_DEFAULT_LINE_GLOW_BLUR}
                                    min={LEGACY_TREND_CHART_LINE_GLOW_BLUR_MIN}
                                    max={LEGACY_TREND_CHART_LINE_GLOW_BLUR_MAX}
                                    step={LEGACY_TREND_CHART_LINE_STYLE_STEP}
                                    onChange={(value) => handleDisplayOptionChange('productionLineGlowBlur', value)}
                                />
                            </DockSection>
                        )}

                        {(selectedWidget.type === 'trend-chart' || selectedWidget.type === 'trend-chart-v2' || selectedWidget.type === 'prod-trend') && (
                            <DockSection icon={<Sliders size={11} />} title="Estilo de línea">
                                <DockSliderField
                                    label="Grosor"
                                    value={selectedWidget.type === 'trend-chart'
                                        ? (legacyTrendChartOptions?.lineStrokeWidth ?? LEGACY_TREND_CHART_DEFAULT_LINE_STROKE_WIDTH)
                                        : selectedWidget.type === 'trend-chart-v2'
                                            ? (trendChartV2Options?.lineStrokeWidth ?? TREND_CHART_V2_DEFAULT_LINE_STROKE_WIDTH)
                                            : (prodTrendOptions?.lineStrokeWidth ?? PROD_TREND_DEFAULT_LINE_STROKE_WIDTH)}
                                    min={LEGACY_TREND_CHART_LINE_STROKE_WIDTH_MIN}
                                    max={LEGACY_TREND_CHART_LINE_STROKE_WIDTH_MAX}
                                    step={LEGACY_TREND_CHART_LINE_STYLE_STEP}
                                    onChange={(value) => handleDisplayOptionChange('lineStrokeWidth', value)}
                                />
                                <DockSliderField
                                    label="Glow"
                                    value={selectedWidget.type === 'trend-chart'
                                        ? (legacyTrendChartOptions?.lineGlowBlur ?? LEGACY_TREND_CHART_DEFAULT_LINE_GLOW_BLUR)
                                        : selectedWidget.type === 'trend-chart-v2'
                                            ? (trendChartV2Options?.lineGlowBlur ?? TREND_CHART_V2_DEFAULT_LINE_GLOW_BLUR)
                                            : (prodTrendOptions?.lineGlowBlur ?? PROD_TREND_DEFAULT_LINE_GLOW_BLUR)}
                                    min={LEGACY_TREND_CHART_LINE_GLOW_BLUR_MIN}
                                    max={LEGACY_TREND_CHART_LINE_GLOW_BLUR_MAX}
                                    step={LEGACY_TREND_CHART_LINE_STYLE_STEP}
                                    onChange={(value) => handleDisplayOptionChange('lineGlowBlur', value)}
                                />
                            </DockSection>
                        )}

                        <DockSection icon={<MousePointerClick size={11} />} title="Navegación">
                            <DockFieldRow label="Enlace">
                                <AdminSelect
                                    value={selectedWidget.navigationTargetDashboardId ?? ''}
                                    onChange={handleNavigationTargetChange}
                                    options={[
                                        { value: '', label: 'Sin enlace' },
                                        ...navigationDashboardOptions,
                                    ]}
                                />
                            </DockFieldRow>
                            <DockInfoBox
                                variant="normal"
                                text="Si seleccionás un dashboard, este widget navegará a ese dashboard en el viewer."
                            />
                        </DockSection>

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

function formatHierarchyTraceValue(value: number | string | null, unit?: string): string {
    if (value == null) {
        return 'Sin datos';
    }

    const trimmedUnit = unit?.trim();
    return trimmedUnit ? `${value} ${trimmedUnit}` : String(value);
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
