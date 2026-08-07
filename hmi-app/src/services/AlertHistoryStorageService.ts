import type {
    AlertHistoryEntry,
    DashboardAlertHistory,
    HistorySeverity,
    WidgetStateSnapshot,
} from '../domain/alertHistory.types';
import type { MetricStatus } from '../domain/widget.types';

// =============================================================================
// AlertHistoryStorageService
// Servicio de persistencia del histórico de alertas por dashboard.
// Usa localStorage como capa de almacenamiento (igual que DashboardStorageService).
//
// Responsabilidades:
// - Recuperar el histórico de un dashboard.
// - Agregar nuevos eventos cuando hay cambio de estado de un widget.
// - Mantener snapshots del último estado por widget.
// - Limpiar histórico de un dashboard (ej. al eliminar el dashboard).
//
// Restricciones:
// - Solo registra transiciones HACIA 'warning' o 'critical'.
// - No registra retornos a 'normal' como evento visible.
// - Limita el histórico a MAX_ENTRIES por dashboard para no desbordar localStorage.
//
// Arquitectura Técnica v1.3 §15 (services layer)
// =============================================================================

const STORAGE_KEY_PREFIX = 'hmi_alert_history_v1_';
const MAX_ENTRIES = 200;

/**
 * Genera la clave de storage para un dashboardId específico.
 */
function storageKey(dashboardId: string): string {
    return `${STORAGE_KEY_PREFIX}${dashboardId}`;
}

export interface AlertHistoryTransaction {
    getEntries(): AlertHistoryEntry[];
    getWidgetSnapshot(widgetId: string): WidgetStateSnapshot | null;
    recordStateChange(
        widgetId: string,
        widgetTitle: string,
        newStatus: MetricStatus,
        value?: number | string | null,
        unit?: string,
    ): AlertHistoryEntry | null;
    getActiveAlertSeverity(): 'normal' | 'warning' | 'critical';
    clearEntries(): void;
    removeWidgetSnapshot(widgetId: string): void;
    removeOrphanedSnapshots(activeWidgetIds: Set<string>): void;
}

class MutableAlertHistoryTransaction implements AlertHistoryTransaction {
    private changed = false;
    private readonly history: DashboardAlertHistory;

    constructor(history: DashboardAlertHistory) {
        this.history = history;
    }

    get hasChanges(): boolean {
        return this.changed;
    }

    get value(): DashboardAlertHistory {
        return this.history;
    }

    getEntries(): AlertHistoryEntry[] {
        return this.history.entries;
    }

    getWidgetSnapshot(widgetId: string): WidgetStateSnapshot | null {
        return this.history.widgetSnapshots[widgetId] ?? null;
    }

    recordStateChange(
        widgetId: string,
        widgetTitle: string,
        newStatus: MetricStatus,
        value?: number | string | null,
        unit?: string,
    ): AlertHistoryEntry | null {
        const prevSnapshot = this.history.widgetSnapshots[widgetId];
        const prevStatus: MetricStatus = prevSnapshot?.lastStatus ?? 'normal';

        if (prevStatus === newStatus) {
            return null;
        }

        const now = new Date().toISOString();
        this.history.widgetSnapshots[widgetId] = {
            widgetId,
            lastStatus: newStatus,
            lastCheckedAt: now,
        };

        let newEntry: AlertHistoryEntry | null = null;
        if (newStatus === 'warning' || newStatus === 'critical') {
            newEntry = {
                id: `ah-${widgetId}-${Date.now().toString(36)}`,
                dashboardId: this.history.dashboardId,
                widgetId,
                widgetTitle,
                toStatus: newStatus as HistorySeverity,
                fromStatus: prevStatus,
                value,
                unit,
                detectedAt: now,
            };
            this.history.entries = [newEntry, ...this.history.entries].slice(0, MAX_ENTRIES);
        }

        this.history.lastUpdatedAt = now;
        this.changed = true;
        return newEntry;
    }

    getActiveAlertSeverity(): 'normal' | 'warning' | 'critical' {
        const snapshots = Object.values(this.history.widgetSnapshots);

        if (snapshots.some((snapshot) => snapshot.lastStatus === 'warning')) return 'warning';
        if (snapshots.some((snapshot) => snapshot.lastStatus === 'critical')) return 'critical';
        return 'normal';
    }

    clearEntries(): void {
        if (this.history.entries.length === 0) {
            return;
        }

        this.history.entries = [];
        this.history.lastUpdatedAt = new Date().toISOString();
        this.changed = true;
    }

    removeWidgetSnapshot(widgetId: string): void {
        if (!(widgetId in this.history.widgetSnapshots)) {
            return;
        }

        delete this.history.widgetSnapshots[widgetId];
        this.changed = true;
    }

    removeOrphanedSnapshots(activeWidgetIds: Set<string>): void {
        for (const widgetId of Object.keys(this.history.widgetSnapshots)) {
            if (!activeWidgetIds.has(widgetId)) {
                delete this.history.widgetSnapshots[widgetId];
                this.changed = true;
            }
        }
    }
}

class AlertHistoryStorageService {
    /**
     * Lee el histórico completo de un dashboard desde localStorage.
     * Si no existe, devuelve una estructura vacía.
     */
    getHistory(dashboardId: string): DashboardAlertHistory {
        return this.loadHistory(dashboardId).history;
    }

    /**
     * Recupera solo los entries del histórico (sin snapshots).
     * Los entries vienen ordenados del más reciente al más antiguo.
     */
    getEntries(dashboardId: string): AlertHistoryEntry[] {
        return this.getHistory(dashboardId).entries;
    }

    /**
     * Recupera el snapshot del último estado conocido de un widget.
     * Devuelve null si no hay snapshot previo.
     */
    getWidgetSnapshot(
        dashboardId: string,
        widgetId: string,
    ): WidgetStateSnapshot | null {
        const history = this.getHistory(dashboardId);
        return history.widgetSnapshots[widgetId] ?? null;
    }

    runTransaction<TResult>(
        dashboardId: string,
        operation: (transaction: AlertHistoryTransaction) => TResult,
    ): TResult {
        const loaded = this.loadHistory(dashboardId);
        const transaction = new MutableAlertHistoryTransaction(loaded.history);
        const result = operation(transaction);

        if (transaction.hasChanges && loaded.canPersist) {
            this.saveHistory(transaction.value);
        }

        return result;
    }

    /**
     * Evalúa si hay un cambio de estado para un widget y, si aplica,
     * registra el evento en el histórico y actualiza el snapshot.
     *
     * Lógica:
     * 1. Obtiene el snapshot anterior del widget.
     * 2. Si el estado nuevo es igual al anterior → no hacer nada.
     * 3. Si el estado nuevo es 'warning' o 'critical' → crear entry + actualizar snapshot.
     * 4. Si el estado nuevo es 'normal', 'stale', etc. → solo actualizar snapshot (sin entry).
     *
     * @param dashboardId  ID del dashboard
     * @param widgetId     ID del widget evaluado
     * @param widgetTitle  Título del widget (para el entry)
     * @param newStatus    MetricStatus actual del widget
     * @param value        Valor numérico/string en el momento de la transición
     * @param unit         Unidad del valor, si aplica
     * @returns El nuevo AlertHistoryEntry si se registró un evento, null si no.
     */
    recordStateChange(
        dashboardId: string,
        widgetId: string,
        widgetTitle: string,
        newStatus: MetricStatus,
        value?: number | string | null,
        unit?: string,
    ): AlertHistoryEntry | null {
        return this.runTransaction(dashboardId, (transaction) => transaction.recordStateChange(
            widgetId,
            widgetTitle,
            newStatus,
            value,
            unit,
        ));
    }

    /**
     * Calcula la severidad activa más alta del dashboard a partir de
     * los snapshots actuales de los widgets (NO del histórico de entries).
     *
     * Regla de prioridad: warning > critical > normal.
     * Si hay al menos un widget con warning activo → retorna 'warning'.
     * Si hay criticals activos pero ningún warning → retorna 'critical'.
     * Si no hay ningún widget en alerta → retorna 'normal'.
     *
     * @param dashboardId  ID del dashboard a consultar.
     * @returns La severidad activa más alta, o 'normal' si no hay alertas.
     */
    getActiveAlertSeverity(dashboardId: string): 'normal' | 'warning' | 'critical' {
        return this.runTransaction(dashboardId, (transaction) => transaction.getActiveAlertSeverity());
    }

    /**
     * Limpia completamente el histórico de un dashboard.
     * Útil si el dashboard es eliminado o reseteado por el admin.
     */
    clearHistory(dashboardId: string): void {
        try {
            localStorage.removeItem(storageKey(dashboardId));
        } catch {
            // Storage unavailable: keep the read-only HMI operational.
        }
    }

    /**
     * Limpia únicamente el array de entries visibles del histórico.
     * Los widgetSnapshots se conservan intactos — reflejan el estado presente
     * de los widgets y son necesarios para detectar transiciones futuras.
     * Útil para que el operador limpie la vista sin perder el estado activo.
     */
    clearEntries(dashboardId: string): void {
        this.runTransaction(dashboardId, (transaction) => transaction.clearEntries());
    }

    /**
     * Elimina el snapshot de un widget específico (ej. cuando se elimina el widget).
     * Los entries históricos se conservan por trazabilidad.
     */
    removeWidgetSnapshot(dashboardId: string, widgetId: string): void {
        this.runTransaction(dashboardId, (transaction) => transaction.removeWidgetSnapshot(widgetId));
    }

    /**
     * Elimina snapshots de widgets que ya no existen en el dashboard.
     * Previene que snapshots huérfanos mantengan el panel en estado de alerta.
     *
     * @param dashboardId      ID del dashboard.
     * @param activeWidgetIds  IDs de los widgets que actualmente existen en el dashboard.
     */
    removeOrphanedSnapshots(dashboardId: string, activeWidgetIds: Set<string>): void {
        this.runTransaction(
            dashboardId,
            (transaction) => transaction.removeOrphanedSnapshots(activeWidgetIds),
        );
    }

    // -------------------------------------------------------------------------
    // Helpers privados
    // -------------------------------------------------------------------------

    private loadHistory(dashboardId: string): {
        history: DashboardAlertHistory;
        canPersist: boolean;
    } {
        let raw: string | null;
        try {
            raw = localStorage.getItem(storageKey(dashboardId));
        } catch {
            return { history: this.emptyHistory(dashboardId), canPersist: false };
        }

        if (!raw) {
            return { history: this.emptyHistory(dashboardId), canPersist: true };
        }

        try {
            return { history: JSON.parse(raw) as DashboardAlertHistory, canPersist: true };
        } catch {
            return { history: this.emptyHistory(dashboardId), canPersist: true };
        }
    }

    private saveHistory(history: DashboardAlertHistory): void {
        try {
            localStorage.setItem(storageKey(history.dashboardId), JSON.stringify(history));
        } catch {
            // localStorage puede estar lleno (QuotaExceededError) — fail silencioso
            // En un entorno real se loguearía al sistema de monitoreo.
        }
    }

    private emptyHistory(dashboardId: string): DashboardAlertHistory {
        return {
            dashboardId,
            entries: [],
            widgetSnapshots: {},
            lastUpdatedAt: new Date().toISOString(),
        };
    }
}

export const alertHistoryStorage = new AlertHistoryStorageService();
