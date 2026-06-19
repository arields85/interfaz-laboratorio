// =============================================================================
// DOMAIN: Data Contract
// Tipos formales del contrato de integración de datos en tiempo real.
//
// La HMI no consume Node-RED, RabbitMQ ni Modbus.
// La HMI consume un contrato JSON estable.
//
// Este archivo define los tipos canónicos que la interfaz espera recibir
// de la capa de adquisición/API. Toda lógica de health, normalización
// y timestamps se resuelve FUERA de la HMI.
//
// Contrato oficial: docs/DATA_CONTRACT.md
// =============================================================================

/**
 * Estados oficiales de conexión/salud.
 * Significado fijo e independiente de la fuente real de datos:
 * - online:    dato válido y fresco
 * - degradado: existe dato pero está viejo o la fuente está reintentando
 * - offline:   no hay dato utilizable reciente o la fuente falló
 * - unknown:   no se puede determinar (sin configurar, sin datos, máquina no vinculada)
 */
export type ContractStatus = 'online' | 'degradado' | 'offline' | 'unknown';

/**
 * Health global de la conexión con la capa de datos.
 * Responde: "¿La HMI está pudiendo hablar con la capa de datos?"
 */
export interface ConnectionHealth {
    globalStatus: ContractStatus;
    lastSuccess: string | null;
    ageMs: number | null;
}

/**
 * Valor métrico individual dentro de una máquina.
 * La clave de acceso es `variableKey` (la key del Record en `ContractMachine.values`).
 * `displayName` es opcional y solo para presentación — nunca para resolución.
 */
export interface ContractMetricValue {
    value: number | null;
    unit: string | null;
    timestamp: string | null;
    /** Solo presentación. Nunca usar para resolver bindings. */
    displayName?: string;
}

/**
 * Máquina individual dentro del contrato.
 * Se resuelve por `unitId` (identificador estable, numérico).
 * `name` es presentación, no identificador.
 */
export interface ContractMachine {
    unitId: number;
    name: string;
    status: ContractStatus;
    lastSuccess: string | null;
    ageMs: number | null;
    values: Record<string, ContractMetricValue>;
}

/**
 * Respuesta completa del contrato de datos.
 * Este es el shape exacto que la capa de adquisición/API debe entregar.
 */
export interface DataContractResponse {
    contractVersion: string;
    timestamp: string;
    connection: ConnectionHealth;
    machines: ContractMachine[];
}

// =============================================================================
// Tipos derivados para consumo interno de la HMI
// =============================================================================

/**
 * Variable resuelta del contrato, con su clave incluida.
 * Resultado de buscar `values[variableKey]` en una máquina.
 * Útil para la capa de resolución que transforma el Record a un acceso directo.
 */
export interface ContractVariable {
    key: string;
    value: number | null;
    unit: string | null;
    timestamp: string | null;
    displayName?: string;
}

// =============================================================================
// Contrato de datos históricos
// La HMI consume series temporales desde un endpoint independiente.
// No fabrica historia — la recibe completa de la capa de datos/API.
//
// Claves de rango estables (minuto, hora, dia, semana, mes) viajan como
// query param. Si el backend usa otro formato, el adapter/service traduce.
// =============================================================================

/**
 * Claves estables de rango temporal para consultas de histórico.
 * Semántica:
 *   minuto = últimos 60 minutos
 *   hora   = últimas 24 horas
 *   dia    = últimos 30 días
 *   semana = últimas 12 semanas
 *   mes    = últimos 12 meses
 */
export type HistoryRange = 'minuto' | 'hora' | 'dia' | 'semana' | 'mes';

/** Preset/custom V2 history ranges for the separate Trend Chart V2 contract. */
export type HistoryRangeV2 = '1h' | '24h' | '7d' | '30d' | '12m' | 'custom';

/** Shared union while legacy and V2 widgets coexist. */
export type HistoryRangeAny = HistoryRange | HistoryRangeV2;

/** Labels visibles para cada rango. */
export const HISTORY_RANGE_LABELS: Record<HistoryRange, string> = {
    minuto: 'Minuto',
    hora: 'Hora',
    dia: 'Día',
    semana: 'Semana',
    mes: 'Mes',
};

/** Todas las claves de rango en orden de menor a mayor escala. */
export const HISTORY_RANGES: HistoryRange[] = ['minuto', 'hora', 'dia', 'semana', 'mes'];

/** V2 range labels stay transport-aligned for the new history contract. */
export const HISTORY_RANGE_V2_LABELS: Record<HistoryRangeV2, string> = {
    '1h': '1h',
    '24h': '24h',
    '7d': '7d',
    '30d': '30d',
    '12m': '12m',
    custom: 'Custom',
};

/** All V2 ranges in transport order. */
export const HISTORY_RANGES_V2: HistoryRangeV2[] = ['1h', '24h', '7d', '30d', '12m', 'custom'];

/** Optional window metadata returned by the richer V2 history contract. */
export interface HistoryWindow {
    start: string;
    end: string;
    timezone?: string;
    bucket?: string;
    bucketMs?: number;
}

/** Punto individual de una serie histórica legacy. */
export interface HistoryDataPoint {
    timestamp: string;   // ISO 8601
    value: number | null;
}

/** Punto individual de la respuesta enriquecida V2. */
export interface HistoryDataPointV2 extends HistoryDataPoint {
    timestampMs: number;
}

/** Resumen estadístico de la serie. */
export interface HistorySummary {
    last: number | null;
    min: number | null;
    max: number | null;
    avg: number | null;
}

/**
 * Respuesta completa del endpoint de histórico.
 * Shape exacto que la capa de datos/API debe entregar.
 */
export interface DataHistoryResponse {
    contractVersion: string;
    machineId: number;
    variableKey: string;
    range: HistoryRange;
    unit: string | null;
    series: HistoryDataPoint[];
    summary: HistorySummary;
}

/** V2-only response contract reserved for Slice 2+ history adaptation. */
export interface DataHistoryResponseV2 {
    contractVersion: string;
    machineId: number;
    variableKey: string;
    range: HistoryRangeV2;
    unit: string | null;
    window?: HistoryWindow;
    series: HistoryDataPointV2[];
    summary: HistorySummary;
}

export type DataHistoryResponseAny = DataHistoryResponse | DataHistoryResponseV2;

/** Parámetros para solicitar histórico. */
export interface HistoryQueryParams {
    machineId: number;
    variableKey: string;
    range: HistoryRange;
}

interface HistoryQueryParamsV2Base {
    machineId: number;
    variableKey: string;
    maxPoints?: number;
}

export interface HistoryPresetQueryParamsV2 extends HistoryQueryParamsV2Base {
    range: Exclude<HistoryRangeV2, 'custom'>;
}

export interface HistoryCustomQueryParamsV2 extends HistoryQueryParamsV2Base {
    range: 'custom';
    start: string;
    end: string;
}

/** Query parameters for Trend Chart V2 preset/custom history requests. */
export type HistoryQueryParamsV2 = HistoryPresetQueryParamsV2 | HistoryCustomQueryParamsV2;

export type HistoryQueryParamsAny = HistoryQueryParams | HistoryQueryParamsV2;
