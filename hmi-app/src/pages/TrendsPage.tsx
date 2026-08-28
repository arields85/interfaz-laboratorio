import { useState } from 'react';
import { Activity, ChevronDown, Gauge } from 'lucide-react';
import { useEquipmentList } from '../queries/useEquipmentList';
import TrendWidget from '../components/TrendWidget';
import { LoadingSkeleton, ErrorState, EmptyState } from '../components/ui';
import WidgetPresentationBoundary from '../components/viewer/WidgetPresentationBoundary';
import type { WidgetConfig } from '../domain/admin.types';
import type { EquipmentSummary } from '../domain/equipment.types';

// =============================================================================
// TrendsPage
// Vista de tendencias y análisis de métricas históricas.
// Selector de equipo + rango temporal + TrendWidget + MetricWidgets vía WidgetRenderer.
//
// Integración de Fase 3:
// Las MetricCards de contexto se renderizan via WidgetRenderer con WidgetConfig
// configurados dinámicamente. Los thresholds se definen por widget, no hardcodeados
// en la página. La evaluación ocurre en thresholdEvaluator.ts (función pura).
//
// Directiva Maestra v3.1 §13.3 — Arquitectura Técnica v1.3 §17.4
// =============================================================================

const TIME_RANGES = [
    { label: '1h', value: '1h' },
    { label: '6h', value: '6h' },
    { label: '24h', value: '24h' },
    { label: '7d', value: '7d' },
];

/**
 * Genera WidgetConfig desde las primaryMetrics de un equipo.
 * En el Modo Admin esto vendrá de la config persistida. Aquí se genera
 * dinámicamente como integración de validación.
 */
/**
 * Mapa de thresholds por tipo de unidad — semántica de dominio industrial real.
 *
 * Estos valores representan rangos operativos típicos de planta farmacéutica.
 * En Modo Admin, cada widget tendrá ThresholdRule[] propio en su WidgetConfig
 * persistida. Este mapa es solo el fallback de validación de mocks.
 *
 * RPM (comprimidoras 400–2000, mezcladoras 100–1200):
 *   warning cuando se acerca al limite de diseño, critical al superarlo.
 * kN (fuerza de compactación, rango proceso: 5–30 kN):
 *   warning > 28 kN (zona de tensión mecánica), critical > 32 kN (daño potencial).
 * °C (temperatura de proceso: 35–45°C para lecho, 50–80°C para aire de secado):
 *   threshold según contexto térmico de la variable.
 */
const DOMAIN_THRESHOLDS: Record<string, { warning: number; critical: number }> = {
    // Velocidades rotacionales
    'rpm':              { warning: 1700, critical: 1900 },
    // Fuerza de compactación
    'kn':               { warning: 28,   critical: 32   },
    // Temperaturas de proceso (lecho de granulado)
    '°c':               { warning: 43,   critical: 48   },
    // Presión de spray (bar)
    'bar':              { warning: 4.5,  critical: 5.5  },
    // Throughput (unidades/min, blisters/min)
    'blisters/min':     { warning: 280,  critical: 320  },
};

function getThresholdsForUnit(unit?: string): WidgetConfig['thresholds'] {
    if (!unit) return undefined;
    const key = unit.toLowerCase();
    const found = DOMAIN_THRESHOLDS[key];
    if (!found) return undefined;
    return [
        { value: found.critical, severity: 'critical' as const },
        { value: found.warning,  severity: 'warning'  as const },
    ];
}

function buildMetricWidgets(equipment: EquipmentSummary): WidgetConfig[] {
    return equipment.primaryMetrics.map((metric, i) => ({
        id: `trends-metric-${equipment.id}-${i}`,
        type: 'metric-card' as const,
        title: metric.label,
        position: { x: i, y: 0 },
        size: { w: 1, h: 1 },
        binding: {
            mode: 'simulated_value' as const,
            simulatedValue: metric.value ?? undefined,
            unit: metric.unit,
        },
        // Thresholds derivados de la unidad de la variable — semántica de dominio real.
        // Sin match de unidad → sin thresholds (todos los valores quedan en 'normal').
        thresholds: getThresholdsForUnit(metric.unit),
    }));
}

export default function TrendsPage() {
    const [selectedRange, setSelectedRange] = useState('1h');
    const [selectedEquipmentId, setSelectedEquipmentId] = useState<string>('');
    const [dropdownOpen, setDropdownOpen] = useState(false);

    const { data: equipmentList, isLoading: loadingList, isError: errorList } = useEquipmentList();

    const selectedEquipment = (equipmentList ?? []).find(e => e.id === selectedEquipmentId)
        ?? equipmentList?.[0];

    const displayEquipment = selectedEquipmentId
        ? (equipmentList ?? []).find(e => e.id === selectedEquipmentId) ?? selectedEquipment
        : selectedEquipment;

    const equipmentMap = new Map<string, EquipmentSummary>(
        (equipmentList ?? []).map(eq => [eq.id, eq])
    );

    const metricWidgets = displayEquipment ? buildMetricWidgets(displayEquipment) : [];

    return (
        <div className="flex flex-col h-full space-y-6 max-w-7xl mx-auto mt-4 px-2">

            {/* HEADER */}
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="text-5xl text-industrial-text mb-2">
                        Tendencias
                    </h1>
                    <p className="text-industrial-muted uppercase mt-1">
                        Exploración de métricas históricas y evolución temporal.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    {/* Selector de equipo */}
                    <div className="relative">
                        <button
                            onClick={() => setDropdownOpen(v => !v)}
                            className="flex items-center gap-2 px-4 py-2.5 glass-panel hover:border-accent-cyan/50 text-industrial-text transition-colors min-w-[180px] justify-between"
                        >
                            <div className="flex items-center gap-2">
                                <Activity size={14} className="text-accent-cyan shrink-0" />
                                <span className="truncate">
                                    {loadingList ? 'Cargando...' : (displayEquipment?.name ?? 'Seleccionar equipo')}
                                </span>
                            </div>
                            <ChevronDown size={14} className={`shrink-0 text-industrial-muted transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {dropdownOpen && (
                            <div className="absolute right-0 top-full mt-1 w-full min-w-[220px] z-20 glass-panel py-1 shadow-xl">
                                {(equipmentList ?? []).map(eq => (
                                    <button
                                        key={eq.id}
                                        onClick={() => { setSelectedEquipmentId(eq.id); setDropdownOpen(false); }}
                                        className={`w-full text-left px-4 py-2.5 transition-colors ${eq.id === displayEquipment?.id
                                            ? 'bg-industrial-hover text-white'
                                            : 'text-industrial-muted hover:bg-industrial-hover hover:text-industrial-text'
                                            }`}
                                    >
                                        {eq.name}
                                        <span className="ml-2 uppercase text-industrial-muted">{eq.type}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Selector de rango */}
                    <div className="flex gap-1 glass-panel p-1">
                        {TIME_RANGES.map(r => (
                            <button
                                key={r.value}
                                onClick={() => setSelectedRange(r.value)}
                                className={`px-3 py-1.5 rounded-2xl uppercase transition-colors ${selectedRange === r.value
                                    ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20'
                                    : 'text-industrial-muted hover:text-industrial-text'
                                    }`}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* ESTADOS DE CARGA / ERROR / VACÍO */}
            {loadingList && (
                <div className="space-y-5">
                    <LoadingSkeleton variant="chart" />
                    <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
                        <LoadingSkeleton variant="card" count={4} />
                    </div>
                </div>
            )}

            {errorList && (
                <div className="glass-panel">
                    <ErrorState title="Error al cargar equipos" message="No se pudo obtener la lista de activos del sistema." />
                </div>
            )}

            {!loadingList && !errorList && !displayEquipment && (
                <div className="glass-panel">
                    <EmptyState icon={Activity} title="Sin equipos disponibles" message="No hay activos en el sistema para mostrar tendencias." />
                </div>
            )}

            {!loadingList && !errorList && displayEquipment && (
                <>
                    {/* Contexto */}
                    <div className="flex items-center gap-3 px-1">
                        <div className="w-2 h-2 rounded-full bg-accent-cyan animate-pulse-slow" />
                        <span className="uppercase text-slate-400">{displayEquipment.name}</span>
                        <span className="uppercase text-slate-600">
                            · {displayEquipment.type} · rango {selectedRange}
                        </span>
                    </div>

                    {/* GRÁFICO PRINCIPAL */}
                    <TrendWidget />

                    {/* MÉTRICAS DE CONTEXTO — vía WidgetRenderer (Fase 3) */}
                    <div className="pt-2">
                        <div className="flex items-center gap-2 mb-4">
                            <div className="w-6 h-6 rounded bg-[rgba(0,224,255,0.1)] flex items-center justify-center border border-[rgba(0,224,255,0.2)]">
                                <Gauge size={14} className="text-accent-cyan" />
                            </div>
                            <h2 className="text-slate-400 uppercase">
                                Métricas del equipo seleccionado
                            </h2>
                        </div>

                        <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
                            {metricWidgets.map(widget => (
                                <WidgetPresentationBoundary
                                    key={widget.id}
                                    widget={widget}
                                    equipmentMap={equipmentMap}
                                    isLoadingData={loadingList}
                                />
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
