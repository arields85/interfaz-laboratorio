import type { ThresholdRule, WidgetConfig } from '../../domain/admin.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import type { ContractMachine } from '../../domain/dataContract.types';
import type { AlertHistoryEntry } from '../../domain/alertHistory.types';
import type { MetricStatus } from '../../domain/widget.types';
import { resolveBinding } from './bindingResolver';
import {
    alertHistoryStorage,
    type AlertHistoryTransaction,
} from '../../services/AlertHistoryStorageService';

// =============================================================================
// alertHistoryEvaluator
//
// Evalúa todos los widgets con thresholds de un dashboard y registra
// cambios de estado en el AlertHistoryStorageService.
//
// Responsabilidades:
// - Filtrar widgets evaluables (con thresholds definidos).
// - Resolver cada binding y obtener su MetricStatus actual.
// - Aplicar histéresis (deadband) para suprimir re-disparos por oscilación.
// - Delegar a alertHistoryStorage.recordStateChange() la detección de cambio.
//
// Restricciones:
// - El deadband SOLO afecta al registro histórico. El color visual del widget
//   sigue reaccionando instantáneamente (thresholdEvaluator no cambia).
// - Función pura respecto a la detección: la lógica de "hubo cambio"
//   vive en AlertHistoryStorageService, no aquí.
// - No tiene efectos secundarios de UI ni estado global de React.
// - Diseñado para ser llamado desde un hook con intervalo (polling)
//   o desde el mount/update de un widget de tipo 'alert-history'.
//
// Arquitectura Técnica v1.3 §6 (resolvers layer)
// =============================================================================

export interface EvaluationResult {
    /** Cantidad de widgets evaluados en esta pasada. */
    evaluatedCount: number;

    /** Nuevos eventos registrados en esta pasada. */
    newEntries: AlertHistoryEntry[];
}

/**
 * Aplica histéresis (deadband) a la transición de estado para el registro histórico.
 *
 * Solo actúa en el camino de RECUPERACIÓN (alerted → normal): si el valor vuelve
 * a cruzar el umbral hacia abajo pero aún no salió de la banda muerta, se suprime
 * la transición y se mantiene el estado anterior en el snapshot.
 *
 * Las transiciones de entrada (normal → warning/critical) y entre niveles de alerta
 * (warning ↔ critical) NO tienen deadband y se registran de inmediato.
 *
 * @param prevStatus      Último estado confirmado en el snapshot de alerta.
 * @param rawStatus       Estado crudo actual del widget (del thresholdEvaluator).
 * @param value           Valor numérico actual del binding.
 * @param thresholds      Reglas de umbral configuradas en el widget.
 * @param deadbandPercent Porcentaje de banda muerta (default 5).
 * @returns Estado efectivo a registrar — puede mantener prevStatus para suprimir ruido.
 */
function applyDeadband(
    prevStatus: MetricStatus,
    rawStatus: MetricStatus,
    value: number | string | null | undefined,
    thresholds: ThresholdRule[],
    deadbandPercent: number,
): MetricStatus {
    // Deadband solo aplica en el camino de recuperación: alerted → normal
    const prevIsAlerted = prevStatus === 'warning' || prevStatus === 'critical';
    if (!prevIsAlerted || rawStatus !== 'normal' || typeof value !== 'number') {
        return rawStatus;
    }

    // Buscar el umbral correspondiente al estado anterior
    const relevantThreshold = thresholds
        .filter((t) => t.value !== 0)
        .find((t) => t.severity === prevStatus);

    if (!relevantThreshold) {
        return rawStatus;
    }

    const deadband = relevantThreshold.value * (deadbandPercent / 100);
    const recoveryPoint = relevantThreshold.value - deadband;

    // Dentro del deadband: suprimir la recuperación, mantener estado anterior
    if (value >= recoveryPoint) {
        return prevStatus;
    }

    return rawStatus;
}

/**
 * Evalúa todos los widgets con thresholds de un dashboard y detecta
 * cambios de estado registrables en el histórico, aplicando histéresis
 * para evitar re-disparos por oscilación alrededor del umbral.
 *
 * @param dashboardId  ID del dashboard que se está monitoreando.
 * @param widgets      Lista completa de WidgetConfig del dashboard.
 * @param equipmentMap Mapa de equipos del dominio (para resolver bindings reales).
 * @returns Resultado de la evaluación con los nuevos eventos detectados.
 */
export function evaluateDashboardWidgets(
    dashboardId: string,
    widgets: WidgetConfig[],
    equipmentMap: Map<string, EquipmentSummary>,
    machines?: ContractMachine[],
    transaction?: AlertHistoryTransaction,
): EvaluationResult {
    if (!transaction) {
        return alertHistoryStorage.runTransaction(
            dashboardId,
            (activeTransaction) => evaluateDashboardWidgets(
                dashboardId,
                widgets,
                equipmentMap,
                machines,
                activeTransaction,
            ),
        );
    }

    // Solo evaluamos widgets que tengan thresholds definidos y no sean
    // el propio widget de histórico (evitar auto-referencia)
    const evaluableWidgets = widgets.filter(
        (w) =>
            w.type !== 'alert-history' &&
            w.thresholds !== undefined &&
            w.thresholds.length > 0 &&
            w.thresholds.some((t) => t.value !== 0),
    );

    const newEntries: AlertHistoryEntry[] = [];

    for (const widget of evaluableWidgets) {
        const resolved = resolveBinding(widget, equipmentMap, machines);

        // Solo registrar cambios de estado para valores con dato real
        // (ignorar no-data/error durante evaluación de histórico)
        if (resolved.status === 'no-data') {
            continue;
        }

        // Obtener estado anterior del snapshot para el cálculo de deadband
        const prevSnapshot = transaction.getWidgetSnapshot(widget.id);
        const prevStatus: MetricStatus = prevSnapshot?.lastStatus ?? 'normal';

        // Aplicar histéresis: suprimir recuperaciones dentro de la banda muerta
        const deadbandPercent = widget.deadbandPercent ?? 5;
        const effectiveStatus = applyDeadband(
            prevStatus,
            resolved.status,
            resolved.value,
            widget.thresholds ?? [],
            deadbandPercent,
        );

        const entry = transaction.recordStateChange(
            widget.id,
            widget.title ?? `Widget ${widget.id}`,
            effectiveStatus,
            resolved.value,
            resolved.unit,
        );

        if (entry !== null) {
            newEntries.push(entry);
        }
    }

    // Cleanup: widgets without thresholds should be 'normal' — clear stale snapshots
    const nonEvaluableWidgets = widgets.filter(
        (w) =>
            w.type !== 'alert-history' &&
            (w.thresholds === undefined || w.thresholds.length === 0 || w.thresholds.every((t) => t.value === 0)),
    );

    for (const widget of nonEvaluableWidgets) {
        transaction.recordStateChange(
            widget.id,
            widget.title ?? `Widget ${widget.id}`,
            'normal',
        );
    }

    // Purge orphaned snapshots — widgets that were deleted from the dashboard
    const activeWidgetIds = new Set(
        widgets.filter((w) => w.type !== 'alert-history').map((w) => w.id),
    );
    transaction.removeOrphanedSnapshots(activeWidgetIds);

    return {
        evaluatedCount: evaluableWidgets.length,
        newEntries,
    };
}
