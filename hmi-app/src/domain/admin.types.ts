import type {
    ActivityAnalyticsDisplayMode,
    ActivityAnalyticsGroupBy,
    ActivityAnalyticsRange,
} from './activityAnalytics.types';

// =============================================================================
// DOMAIN: Admin (Modo Administrador)
// Entidades para el builder de jerarquía, dashboards, widgets y bindings.
//
// RESTRICCIÓN (Especificación Funcional Modo Admin):
// El Modo Admin es read-only respecto a planta. Solo modela estructura
// visual, bindings de LECTURA y configuración de dashboards.
// Ninguna entidad aquí puede implicar escritura sobre equipos.
// =============================================================================

// --- JERARQUÍA ---

export type NodeType = string;

/**
 * Nodo del árbol jerárquico de planta.
 * Puede tener un dashboard asignado y/o un activo asociado.
 */
export interface HierarchyNode {
    id: string;
    name: string;
    type: NodeType;
    parentId: string | null;
    order: number;
    /** Dashboard asociado al nodo para navegación y agregación jerárquica. */
    linkedDashboardId?: string;
    /** Asset asociado al nodo para bindings puntuales de solo lectura. */
    linkedAssetId?: string;
}

// --- DASHBOARD ---

export type DashboardType = 'global' | 'area' | 'line' | 'equipment' | 'free' | 'template';
export type DashboardStatus = 'draft' | 'published' | 'archived';

export type DashboardAspect = '16:9' | '21:9' | '4:3';

/**
 * Slot de widget asignado al header del dashboard.
 * Referencia un widget del array `widgets` del dashboard.
 * Widgets aquí son EXCLUSIVOS del header y NO se renderizan en el grid.
 *
 * `column` (0-indexed) indica en qué columna del header de 3 columnas debe
 * renderizarse este widget. Si está ausente, el orden del array determina la
 * columna (el primer slot va a col-0, el segundo a col-1, etc.).
 * Cuando se inserta en un slot específico, `column` debe guardarse explícitamente
 * para que la posición visual sea exacta independientemente de cuántos otros
 * slots estén ocupados.
 *
 * `widgetId` debe existir en `Dashboard.widgets`.
 */
export interface DashboardHeaderWidgetSlot {
    widgetId: string;
    /** Columna del header (0, 1 o 2). Índice dentro del grid de 3 columnas. */
    column?: number;
}

/**
 * Configuración explícita del header de un dashboard.
 *
 * - `title`: sobreescribe el nombre del dashboard como título principal.
 *   Si está ausente, se usa `Dashboard.name`.
 * - `subtitle`: texto secundario debajo del título (ej. descripción técnica, turno, área).
 *   Si está ausente, se usa `Dashboard.description`.
 * - `widgetSlots`: widgets del header (estado de equipo, conexión, etc.).
 *   Los widget IDs listados aquí son EXCLUSIVOS del header: no se renderizan en el grid.
 *
 * Convención de extensión: los campos son todos opcionales para compatibilidad
 * con dashboards existentes que no tienen `headerConfig` definido.
 */
export interface DashboardHeaderConfig {
    title?: string;
    subtitle?: string;
    widgetSlots?: DashboardHeaderWidgetSlot[];
}

/**
 * Snapshot congelado de la versión publicada de un dashboard.
 * Mientras el admin edita la working copy (widgets/layout/headerConfig del Dashboard),
 * el viewer siempre lee de este snapshot. Se actualiza únicamente al publicar.
 */
export interface PublishedSnapshot {
    aspect: DashboardAspect;
    cols: number;
    rows: number;
    widgets: WidgetConfig[];
    layout: WidgetLayout[];
    headerConfig?: DashboardHeaderConfig;
    publishedAt: string;
}

/**
 * Estado visual derivado del dashboard, calculado a partir de `status` y `publishedSnapshot`.
 * - `draft`:     nunca publicado (status='draft', sin snapshot)
 * - `published`: publicado y al día (snapshot coincide con working copy)
 * - `pending`:   publicado con cambios guardados sin publicar (snapshot difiere de working copy)
 */
export type DashboardVisualStatus = 'draft' | 'published' | 'pending';

/**
 * Composición visual completa: un dashboard con su layout y sus widgets.
 */
export interface Dashboard {
    id: string;
    name: string;
    description?: string;
    dashboardType: DashboardType;
    aspect: DashboardAspect;
    cols: number;
    rows: number;
    layout: WidgetLayout[];
    widgets: WidgetConfig[];
    lastUpdateAt?: string;
    ownerNodeId?: string;
    templateId?: string;
    isTemplate: boolean;
    version: number;
    status: DashboardStatus;
    /**
     * Configuración explícita del header del dashboard.
     * Opcional: si está ausente, el header usa `name`/`description` y sin widget slots.
     */
    headerConfig?: DashboardHeaderConfig;
    /**
     * Snapshot congelado de la versión publicada.
     * Presente solo en dashboards que fueron publicados al menos una vez.
     * El viewer lee de aquí; la working copy (widgets/layout/headerConfig) es el estado
     * más reciente del editor.
     */
    publishedSnapshot?: PublishedSnapshot;
}

/**
 * Opciones de visualización unificadas para widgets de conexión.
 *
 * Soporta dos modos de alcance:
 * - `scope: 'global'`  → estado global de conexión con la capa de datos
 * - `scope: 'machine'` → estado de una máquina específica (requiere `machineId`)
 *
 * Labels personalizables por estado del contrato oficial.
 * `showLastUpdate` controla la visibilidad del footer de tiempo relativo.
 */
export interface ConnectionStatusDisplayOptions {
    scope?: 'global' | 'machine';
    machineId?: number;
    onlineText?: string;
    degradadoText?: string;
    offlineText?: string;
    unknownText?: string;
    showLastUpdate?: boolean;
    /** @deprecated Legacy — usar onlineText/offlineText */
    connectedText?: string;
    /** @deprecated Legacy — usar onlineText/offlineText */
    disconnectedText?: string;
}



export interface WidgetLayout {
    widgetId: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

// --- WIDGETS ---

export type WidgetType =
    | 'kpi'
    | 'metric-card'
    | 'status'
    | 'badge'
    | 'sparkline'
    | 'trend-chart'
    | 'trend-chart-v2'
    | 'prod-history'
    | 'table'
    | 'alert-list'
    | 'alert-history'
    | 'text-summary'
    | 'connection-status'
    | 'multi-metric'
    | 'ai-summary'
    | 'section-title'
    | 'text-title'
    | 'machine-activity'
    | 'activity-analytics'
    | 'prod-trend';

// --- AGREGACIÓN JERÁRQUICA ---

/**
 * Función de agregación aplicable cuando un widget opera en modo jerárquico.
 * El resolver recorre los descendientes del nodo actual, recolecta valores
 * numéricos de widgets con la misma unidad, y aplica esta operación.
 */
export type AggregationMode = 'sum' | 'avg' | 'max' | 'min';

// --- BINDING ---

export type BindingMode = 'real_variable' | 'simulated_value';

/**
 * Vínculo entre un widget y su fuente de dato.
 * Siempre apunta a una variable LÓGICA del dominio, nunca a un tag crudo industrial.
 */
export interface WidgetBinding {
    mode: BindingMode;
    assetId?: string;
    variableKey?: string;    // clave semántica del dominio (ej: 'rotorSpeed', 'temperature')
    formatter?: string;
    unit?: string;
    /**
     * Identidad canónica de variable para agregación jerárquica.
     * Refiere a `CatalogVariable.id`.
     */
    catalogVariableId?: string;
    lastKnownValueAllowed?: boolean;
    staleTimeout?: number;   // segundos antes de considerar el dato como stale
    simulatedValue?: number | string | boolean;
    /** Node-RED machine unitId. Present when bindingVersion = 'node-red-v1'. */
    machineId?: number;
    /** Binding version discriminator. undefined = legacy, 'node-red-v1' = Node-RED. */
    bindingVersion?: 'node-red-v1' | 'real-variable-v1';
}

export interface ThresholdRule {
    value: number;
    severity: 'warning' | 'critical';
    label?: string;
}

// =============================================================================
// DISPLAY OPTIONS — Tipado estricto por tipo de widget
//
// Contratos:
//   KpiDisplayOptions        → widget tipo 'kpi'
//   MetricCardDisplayOptions → widget tipo 'metric-card'
//   TrendChartDisplayOptions → widget tipo 'trend-chart'
//   AlertHistoryDisplayOptions → widget tipo 'alert-history'
//   StatusDisplayOptions     → widget tipo 'status'
//   BaseDisplayOptions       → widgets sin opciones específicas activas
//
// Separación conceptual que NO se mezcla nunca:
//   subtitle  → texto debajo del título en el HEADER del widget (KPI y MetricCard lo usan)
//   subtext   → texto aclaratorio en el FOOTER del widget (KPI y MetricCard lo usan)
// =============================================================================

/**
 * Opciones de visualización para widgets de tipo 'kpi'.
 *
 * - `subtitle`: texto en el header (debajo del título). Puede tener color dinámico.
 * - `subtext`:  texto aclaratorio en el footer inferior. Sin color dinámico.
 * - `icon`:     nombre del ícono Lucide a mostrar (e.g. 'Gauge', 'Activity').
 *               `undefined` = pendiente de configuración (placeholder),
 *               `null` = sin ícono explícito.
 * - `kpiMode`:  forma visual del medidor — 'circular' (default) o 'bar'.
 * - `min`:      valor mínimo del rango de la escala.
 * - `max`:      valor máximo del rango de la escala.
 * - `dynamicColor`: si true, el color del widget cambia según el estado de los thresholds.
 */
export interface KpiDisplayOptions {
    subtitle?: string;
    subtext?: string;
    icon?: string | null;
    kpiMode?: 'circular' | 'bar';
    valueFontSize?: number;
    min?: number;
    max?: number;
    dynamicColor?: boolean;
    unit?: string;
    unitOverride?: boolean;
}

/**
 * Opciones de visualización para widgets de tipo 'metric-card'.
 *
 * - `subtitle`: texto secundario en el HEADER del widget (debajo del título), mismo color que el ícono.
 *   Convive con `subtext` — son conceptos ortogonales: subtitle = cabecera, subtext = footer.
 * - `subtext`:  texto aclaratorio en el footer inferior.
 * - `icon`:     nombre del ícono Lucide a mostrar.
 *               `undefined` = pendiente de configuración (placeholder),
 *               `null` = sin ícono explícito.
 */
export interface MetricCardDisplayOptions {
    subtitle?: string;
    subtext?: string;
    icon?: string | null;
}

/**
 * Opciones de visualización para widgets de tipo 'trend-chart'.
 *
 * TrendChart no usa subtitle ni subtext propios: su header muestra la unidad
 * del binding como subtítulo (derivado de `resolved.unit`), no de displayOptions.
 */
export interface TrendChartDisplayOptions {
    lineStrokeWidth?: number;
    lineGlowBlur?: number;
}

export type HistoricalDensity = 'low' | 'normal' | 'high';
export type TrendChartV2ShiftDisplayMode = 'auto' | 'bands' | 'lines';

export interface TrendChartV2DisplayOptions {
    icon?: string | null;
    historicalDensity?: HistoricalDensity;
    shiftDisplayMode?: TrendChartV2ShiftDisplayMode;
    showShifts?: boolean;
    lineStrokeWidth?: number;
    lineGlowBlur?: number;
    /** @deprecated Visual summaries now always follow the visible range like legacy trend-chart. */
    showShiftSummary?: boolean;
}

export interface ShiftDefinition {
    id: string;
    label: string;
    start: string;
    end: string;
    weekdays?: WeekdayKey[];
}

export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface TemporalSettingsConfig {
    plantTimezone: string | null;
    shifts: ShiftDefinition[];
}

/**
 * Opciones de visualización para widgets de tipo 'alert-history'.
 *
 * - `dashboardId`:   ID del dashboard que se monitorea (requerido para evaluar widgets hermanos).
 * - `maxVisible`:    máximo de eventos históricos a mostrar en la lista (default: 5).
 * - `pollInterval`:  intervalo de polling en milisegundos (default: 10000).
 * - `icon`:          nombre del ícono Lucide a mostrar en el header.
 *                    `undefined` = pendiente de configuración (placeholder),
 *                    `null` = sin ícono explícito.
 */
export interface AlertHistoryDisplayOptions {
    dashboardId?: string;
    maxVisible?: number;
    pollInterval?: number;
    icon?: string | null;
}

/**
 * Opciones de visualización para widgets de tipo 'status'.
 *
 * Permite personalizar el label visible para cada estado operativo del equipo.
 */
export interface StatusDisplayOptions {
    runningText?: string;
    idleText?: string;
    warningText?: string;
    criticalText?: string;
    offlineText?: string;
    maintenanceText?: string;
    unknownText?: string;
}

export type ProductiveState = 'stopped' | 'calibrating' | 'producing';

export interface MachineActivityDisplayOptions {
    icon?: string | null;
    kpiMode?: 'circular' | 'bar';
    valueFontSize?: number;
    unit?: string;
    unitOverride?: boolean;
    thresholdStopped?: number;
    thresholdProducing?: number;
    hysteresis?: number;
    confirmationTime?: number;
    smoothingWindow?: number;
    powerMin?: number;
    powerMax?: number;
    showStateSubtitle?: boolean;
    showPowerSubtext?: boolean;
    showDynamicColor?: boolean;
    showStateAnimation?: boolean;
    labelStopped?: string;
    labelCalibrating?: string;
    labelProducing?: string;
}

export type ActivityAnalyticsStateGradientKey = 'prod' | 'setup' | 'stopped';
export type ActivityAnalyticsStateGradient = [string, string];
export type ActivityAnalyticsAlphaPair = [number, number];
export type ActivityAnalyticsTrendBandColorTriple = [string?, string?, string?];
export type ActivityAnalyticsTrendBandAlphaTriple = [number?, number?, number?];
export const ACTIVITY_ANALYTICS_TREND_BAND_BLEND_MODE_OPTIONS = [
    'overlay',
    'normal',
    'multiply',
    'screen',
    'soft-light',
    'hard-light',
] as const;
export type ActivityAnalyticsTrendBandBlendMode = (typeof ACTIVITY_ANALYTICS_TREND_BAND_BLEND_MODE_OPTIONS)[number];

export interface ActivityAnalyticsProdTrendBandsDisplayOptions {
    colors?: ActivityAnalyticsTrendBandColorTriple;
    alphas?: ActivityAnalyticsTrendBandAlphaTriple;
    blendMode?: ActivityAnalyticsTrendBandBlendMode;
}

export interface ActivityAnalyticsSurfaceEffects {
    glow: number;
    blur: number;
    topCap: boolean;
    topCapGlow: number;
}

export type ActivityAnalyticsGroupBarWidths = Partial<Record<ActivityAnalyticsGroupBy, number>>;

export interface ActivityAnalyticsDisplayOptions {
    range?: ActivityAnalyticsRange;
    start?: string;
    end?: string;
    groupBy?: ActivityAnalyticsGroupBy;
    donutCenterValueFontSize?: number;
    setupThresholdKw?: number;
    prodThresholdKw?: number;
    displayMode?: ActivityAnalyticsDisplayMode;
    /** Grouped stacked bar width factor in [0.1, 1.5], default 1. Legacy global fallback. */
    groupBarWidth?: number;
    /** Per-group grouped stacked bar width factors in [0.1, 1.5], default 1 per supported group. */
    groupBarWidths?: ActivityAnalyticsGroupBarWidths;
    coverageColor?: string;
    stateGradients?: Partial<Record<ActivityAnalyticsStateGradientKey, ActivityAnalyticsStateGradient>>;
    stateGradientAlphas?: Partial<Record<ActivityAnalyticsStateGradientKey, ActivityAnalyticsAlphaPair>>;
    prodTrendBands?: ActivityAnalyticsProdTrendBandsDisplayOptions;
    visualEffects?: {
        groupedBars?: Partial<ActivityAnalyticsSurfaceEffects>;
        donut?: Partial<ActivityAnalyticsSurfaceEffects>;
    };
}

export interface ProdTrendDisplayOptions {
    range?: ActivityAnalyticsRange;
    start?: string;
    end?: string;
    groupBy?: ActivityAnalyticsGroupBy;
    setupThresholdKw?: number;
    prodThresholdKw?: number;
    groupBarWidth?: number;
    groupBarWidths?: ActivityAnalyticsGroupBarWidths;
    trendLineColors?: ActivityAnalyticsStateGradient;
    trendLineColorAlphas?: ActivityAnalyticsAlphaPair;
    prodTrendBands?: ActivityAnalyticsProdTrendBandsDisplayOptions;
    lineStrokeWidth?: number;
    lineGlowBlur?: number;
}

export interface ActivityAnalyticsPersistedDisplayPatch {
    range: ActivityAnalyticsRange;
    start?: string;
    end?: string;
}

export type ProdHistoryPersistedDisplayPatch = Pick<ProdHistoryDisplayOptions, 'productionChartMode' | 'oeeShowArea'>;

export type ViewerPersistedWidgetDisplayPatch = ActivityAnalyticsPersistedDisplayPatch | ProdHistoryPersistedDisplayPatch;

export type TemporalBucket = 'hour' | 'shift' | 'day' | 'month';
export type ProductionChartMode = 'bars' | 'area';

/**
 * Unidad de producción del widget `prod-history`.
 *
 * Conceptualmente ortogonal a `binding.unit` (unidades físicas tipo °C, RPM).
 * Representa la unidad de dominio con la que se cuantifica la producción
 * del equipo/línea: cantidad discreta, masa, peso industrial o lote de envase.
 */
export type ProductionUnit = 'unidades' | 'kg' | 'tn' | 'cuñetes';

/**
 * Opciones de visualización para widgets de tipo 'prod-history'.
 *
 * - `sourceLabel`:             etiqueta de origen de datos (default: 'Simulado').
 * - `productionLabel`:         label de serie producción (default: 'Producción').
 * - `oeeLabel`:                label de serie OEE (default: 'OEE (%)').
 * - `chartTitle`:              título superior del widget (default: 'PRODUCCIÓN HISTÓRICA').
 * - `icon`:                    nombre del ícono Lucide a mostrar en el header.
 *                              `undefined` = pendiente de configuración (placeholder),
 *                              `null` = sin ícono explícito.
 * - `productionUnit`:          unidad de producción a mostrar en leyenda y ticks del
 *                              eje Y izquierdo. Ortogonal a `binding.unit` (unidades
 *                              físicas). Default: 'unidades'.
 * - `productionChartMode`:     modo de producción ('bars' | 'area', default: 'bars').
 * - `oeeChartMode`:            reservado para contrato explícito; por ahora solo 'line'.
 * - `useSecondaryAxis`:        usa eje derecho para OEE (default: true).
 * - `autoScale`:               escala Y dinámica por series visibles (default: true).
 * - `showGrid`:                habilita grid horizontal (default: true).
 * - `oeeShowArea`:             relleno bajo línea OEE (default: false).
 * - `oeeShowPoints`:           puntos visibles en línea OEE (default: false).
 * - `productionBarWidth`:      factor multiplicador en [0.5, 1.5], default 1.0,
 *                              aplicado al ancho natural de barra calculado dentro
 *                              del renderer SVG. Se clamppea silenciosamente tanto
 *                              en el renderer como en el slider del dock.
 * - `defaultTemporalGrouping`: valor inicial local del selector (default: 'hour').
 * - `defaultShowOee`:          visibilidad inicial local de OEE (default: true).
 */
export interface ProdHistoryDisplayOptions {
    sourceLabel?: string;
    productionLabel?: string;
    oeeLabel?: string;
    chartTitle?: string;
    icon?: string | null;
    productionUnit?: ProductionUnit;
    productionChartMode?: ProductionChartMode;
    oeeChartMode?: 'line';
    useSecondaryAxis?: boolean;
    autoScale?: boolean;
    showGrid?: boolean;
    oeeShowArea?: boolean;
    oeeShowPoints?: boolean;
    productionBarWidth?: number;
    productionAxisMin?: number;
    productionAxisMax?: number;
    oeeAxisMin?: number;
    oeeAxisMax?: number;
    oeeLineStrokeWidth?: number;
    oeeLineGlowBlur?: number;
    productionLineStrokeWidth?: number;
    productionLineGlowBlur?: number;
    productionVariableKey?: string;
    oeeVariableKey?: string;
    defaultTemporalGrouping?: TemporalBucket;
    defaultShowOee?: boolean;
}

/**
 * Opciones de visualización para widgets sin opciones específicas tipadas.
 * Extensible, pero deliberadamente vacío — no es un Record<string, unknown> abierto.
 */
export type BaseDisplayOptions = Record<never, never>;

export type TextTitleColor = 'white' | 'soft' | 'muted';

export interface TextTitleDisplayOptions {
    fontSize?: number;
    textAlign?: 'left' | 'center' | 'right';
    textColor?: TextTitleColor;
}

// =============================================================================
// WIDGET CONFIG — Unión discriminada por tipo
//
// Cada variante tiene su propio `displayOptions` tipado.
// El campo discriminante es `type`.
// =============================================================================

/** Campos comunes a todas las variantes de WidgetConfig. */
interface WidgetConfigBase {
    id: string;
    title?: string;
    navigationTargetDashboardId?: string;
    /**
     * @deprecated Use the matching `Dashboard.layout` entry (`WidgetLayout.x/y`) as the canonical source of truth.
     * Kept temporarily for compatibility with legacy widget config callsites during the canvas-bounds transition.
     * TODO(canvas-bounds): remove `position` after all render/edit paths read from `Dashboard.layout` only.
     */
    position: { x: number; y: number };
    /**
     * @deprecated Use the matching `Dashboard.layout` entry (`WidgetLayout.w/h`) as the canonical source of truth.
     * Kept temporarily for compatibility with legacy widget config callsites during the canvas-bounds transition.
     * TODO(canvas-bounds): remove `size` after all render/edit paths read from `Dashboard.layout` only.
     */
    size: { w: number; h: number };
    styleVariant?: string;
    binding?: WidgetBinding;
    thresholds?: ThresholdRule[];
    fallbackMode?: 'last-known' | 'empty' | 'error';
    simulatedValue?: number | string | boolean;
    /**
     * Modo jerárquico: el widget agrega valores de los descendientes del nodo
     * actual en la jerarquía de planta, en vez de mostrar un binding puntual.
     * Cuando está activo, `binding.catalogVariableId` define la variable
     * canónica a buscar en los dashboards hijos.
     * Default: false (modo puntual).
     */
    hierarchyMode?: boolean;
    /**
     * Función de agregación para modo jerárquico.
     * Ignorado cuando `hierarchyMode` es false/undefined.
     * Default: 'sum'.
     */
    aggregation?: AggregationMode;
    /**
     * Porcentaje de banda muerta (histéresis) para alertas por umbral.
     * Previene re-disparos cuando el valor oscila alrededor del umbral.
     * Ejemplo: umbral=50, deadbandPercent=5 → la recuperación a 'normal'
     * solo ocurre cuando el valor cae por debajo de 50 - (50*0.05) = 47.5.
     * Solo aplica al registro del histórico; el color visual del widget
     * sigue reaccionando instantáneamente al cruce del umbral.
     * Default: 5 cuando los umbrales están activos.
     */
    deadbandPercent?: number;
}

export interface KpiWidgetConfig extends WidgetConfigBase {
    type: 'kpi';
    displayOptions?: KpiDisplayOptions;
}

export interface MetricCardWidgetConfig extends WidgetConfigBase {
    type: 'metric-card';
    displayOptions?: MetricCardDisplayOptions;
}

export interface TrendChartWidgetConfig extends WidgetConfigBase {
    type: 'trend-chart';
    displayOptions?: TrendChartDisplayOptions;
}

export interface TrendChartV2WidgetConfig extends WidgetConfigBase {
    type: 'trend-chart-v2';
    displayOptions?: TrendChartV2DisplayOptions;
}

export interface ProdHistoryWidgetConfig extends WidgetConfigBase {
    type: 'prod-history';
    displayOptions?: ProdHistoryDisplayOptions;
}

export interface AlertHistoryWidgetConfig extends WidgetConfigBase {
    type: 'alert-history';
    displayOptions?: AlertHistoryDisplayOptions;
}

export interface ConnectionStatusWidgetConfig extends WidgetConfigBase {
    type: 'connection-status';
    displayOptions?: ConnectionStatusDisplayOptions;
}

export interface StatusWidgetConfig extends WidgetConfigBase {
    type: 'status';
    displayOptions?: StatusDisplayOptions;
}

export interface MachineActivityWidgetConfig extends WidgetConfigBase {
    type: 'machine-activity';
    displayOptions?: MachineActivityDisplayOptions;
}

export interface ActivityAnalyticsWidgetConfig extends WidgetConfigBase {
    type: 'activity-analytics';
    displayOptions?: ActivityAnalyticsDisplayOptions;
}

export interface ProdTrendWidgetConfig extends WidgetConfigBase {
    type: 'prod-trend';
    displayOptions?: ProdTrendDisplayOptions;
}

export interface TextTitleWidgetConfig extends WidgetConfigBase {
    type: 'text-title';
    displayOptions?: TextTitleDisplayOptions;
}

/** Variante genérica para todos los tipos de widget sin displayOptions específicos. */
export interface GenericWidgetConfig extends WidgetConfigBase {
    type: Exclude<WidgetType, 'kpi' | 'metric-card' | 'trend-chart' | 'trend-chart-v2' | 'prod-history' | 'alert-history' | 'connection-status' | 'status' | 'machine-activity' | 'activity-analytics' | 'prod-trend' | 'text-title'>;
    displayOptions?: BaseDisplayOptions;
}

/**
 * Un widget configurado con posición, tamaño, estilo y binding.
 * Unión discriminada: cada variante tiene displayOptions estrictamente tipado.
 */
export type WidgetConfig =
    | KpiWidgetConfig
    | MetricCardWidgetConfig
    | TrendChartWidgetConfig
    | TrendChartV2WidgetConfig
    | ProdHistoryWidgetConfig
    | AlertHistoryWidgetConfig
    | ConnectionStatusWidgetConfig
    | StatusWidgetConfig
    | MachineActivityWidgetConfig
    | ActivityAnalyticsWidgetConfig
    | ProdTrendWidgetConfig
    | TextTitleWidgetConfig
    | GenericWidgetConfig;

// =============================================================================
// TYPE GUARDS — Narrowing helpers para WidgetConfig
// =============================================================================

export function isKpiWidget(w: WidgetConfig): w is KpiWidgetConfig {
    return w.type === 'kpi';
}

export function isMetricCardWidget(w: WidgetConfig): w is MetricCardWidgetConfig {
    return w.type === 'metric-card';
}

export function isTrendChartWidget(w: WidgetConfig): w is TrendChartWidgetConfig {
    return w.type === 'trend-chart';
}

export function isTrendChartV2Widget(w: WidgetConfig): w is TrendChartV2WidgetConfig {
    return w.type === 'trend-chart-v2';
}

export function isAlertHistoryWidget(w: WidgetConfig): w is AlertHistoryWidgetConfig {
    return w.type === 'alert-history';
}

export function isActivityAnalyticsWidget(w: WidgetConfig): w is ActivityAnalyticsWidgetConfig {
    return w.type === 'activity-analytics';
}

export function isProdTrendWidget(w: WidgetConfig): w is ProdTrendWidgetConfig {
    return w.type === 'prod-trend';
}

// --- TEMPLATE ---

export type TemplateType = 'dashboard' | 'widget' | 'equipment-type';
export type TemplateStatus = 'active' | 'archived';

/**
 * Configuración reutilizable para acelerar la creación de dashboards similares.
 * Ejemplo: template "Comprimidora Estándar" con widgets de presión, velocidad y estado.
 */
export interface Template {
    id: string;
    name: string;
    type: TemplateType;
    aspect: DashboardAspect;
    cols: number;
    rows: number;
    dashboardType?: DashboardType;
    sourceDashboardId?: string;
    widgetPresets?: Partial<WidgetConfig>[];
    layoutPreset?: WidgetLayout[];
    status: TemplateStatus;
}

// =============================================================================
// DASHBOARD VISUAL STATUS — Helper derivado
// =============================================================================

/**
 * Calcula el estado visual de un dashboard a partir de su `status` y `publishedSnapshot`.
 *
 * - `draft`:     status='draft' (nunca publicado o despublicado)
 * - `published`: status='published' y working copy coincide con el snapshot
 * - `pending`:   status='published' pero working copy difiere del snapshot
 */
export function getDashboardVisualStatus(dashboard: Dashboard): DashboardVisualStatus {
    // Regla de negocio: sin nodo asignado, nunca puede estar publicado
    if (!dashboard.ownerNodeId) return 'draft';
    if (dashboard.status !== 'published') return 'draft';
    if (!dashboard.publishedSnapshot) return 'published';

    const snap = dashboard.publishedSnapshot;
    const widgetsMatch = JSON.stringify(dashboard.widgets) === JSON.stringify(snap.widgets);
    const layoutMatch = JSON.stringify(dashboard.layout) === JSON.stringify(snap.layout);
    const headerMatch = JSON.stringify(dashboard.headerConfig) === JSON.stringify(snap.headerConfig);

    return (widgetsMatch && layoutMatch && headerMatch) ? 'published' : 'pending';
}
