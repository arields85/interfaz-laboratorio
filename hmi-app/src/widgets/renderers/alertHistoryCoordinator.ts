import type { WidgetConfig } from '../../domain/admin.types';
import type { AlertHistoryEntry } from '../../domain/alertHistory.types';
import type { ContractMachine } from '../../domain/dataContract.types';
import type { EquipmentSummary } from '../../domain/equipment.types';
import {
    alertHistoryStorage,
    type AlertHistoryTransaction,
} from '../../services/AlertHistoryStorageService';
import { evaluateDashboardWidgets } from '../resolvers/alertHistoryEvaluator';

export interface AlertHistoryCoordinatorState {
    entries: AlertHistoryEntry[];
    activeSeverity: 'normal' | 'warning' | 'critical';
}

interface AlertHistoryEvaluationContext {
    widgets: WidgetConfig[];
    equipmentMap: Map<string, EquipmentSummary>;
    machines?: ContractMachine[];
}

interface AlertHistorySubscription {
    dashboardId: string;
    pollInterval: number;
    getContext: () => AlertHistoryEvaluationContext;
    onState: (state: AlertHistoryCoordinatorState) => void;
}

interface Subscriber extends Omit<AlertHistorySubscription, 'dashboardId'> {
    id: symbol;
}

interface DashboardCoordinator {
    dashboardId: string;
    subscribers: Map<symbol, Subscriber>;
    state: AlertHistoryCoordinatorState | null;
    timer: ReturnType<typeof setInterval> | null;
    timerInterval: number | null;
    cleanupToken: symbol | null;
}

const coordinators = new Map<string, DashboardCoordinator>();

export function subscribeAlertHistory(subscription: AlertHistorySubscription): () => void {
    const coordinator = getOrCreateCoordinator(subscription.dashboardId);
    const subscriber: Subscriber = {
        id: Symbol(subscription.dashboardId),
        pollInterval: subscription.pollInterval,
        getContext: subscription.getContext,
        onState: subscription.onState,
    };

    coordinator.cleanupToken = null;
    coordinator.subscribers.set(subscriber.id, subscriber);
    syncTimer(coordinator);

    if (coordinator.state === null) {
        runEvaluationCycle(coordinator);
    } else {
        subscription.onState(coordinator.state);
    }

    return () => {
        coordinator.subscribers.delete(subscriber.id);
        if (coordinator.subscribers.size > 0) {
            syncTimer(coordinator);
            return;
        }

        const cleanupToken = Symbol(subscription.dashboardId);
        coordinator.cleanupToken = cleanupToken;
        queueMicrotask(() => {
            if (coordinator.cleanupToken !== cleanupToken || coordinator.subscribers.size > 0) {
                return;
            }

            clearCoordinatorTimer(coordinator);
            coordinators.delete(coordinator.dashboardId);
        });
    };
}

export function clearAlertHistoryEntries(dashboardId: string): void {
    const state = alertHistoryStorage.runTransaction(dashboardId, (transaction) => {
        transaction.clearEntries();
        return readCoordinatorState(transaction);
    });
    const coordinator = coordinators.get(dashboardId);

    if (coordinator) {
        publishState(coordinator, state);
    }
}

function getOrCreateCoordinator(dashboardId: string): DashboardCoordinator {
    const existing = coordinators.get(dashboardId);
    if (existing) {
        return existing;
    }

    const coordinator: DashboardCoordinator = {
        dashboardId,
        subscribers: new Map(),
        state: null,
        timer: null,
        timerInterval: null,
        cleanupToken: null,
    };
    coordinators.set(dashboardId, coordinator);
    return coordinator;
}

function runEvaluationCycle(coordinator: DashboardCoordinator): void {
    const subscriber = coordinator.subscribers.values().next().value as Subscriber | undefined;
    if (!subscriber) {
        return;
    }

    const context = subscriber.getContext();
    const state = alertHistoryStorage.runTransaction(coordinator.dashboardId, (transaction) => {
        if (coordinator.dashboardId !== 'unknown' && context.widgets.length > 0) {
            evaluateDashboardWidgets(
                coordinator.dashboardId,
                context.widgets,
                context.equipmentMap,
                context.machines,
                transaction,
            );
        }

        return readCoordinatorState(transaction);
    });

    publishState(coordinator, state);
}

function readCoordinatorState(transaction: AlertHistoryTransaction): AlertHistoryCoordinatorState {
    return {
        entries: [...transaction.getEntries()],
        activeSeverity: transaction.getActiveAlertSeverity(),
    };
}

function publishState(coordinator: DashboardCoordinator, state: AlertHistoryCoordinatorState): void {
    coordinator.state = state;
    for (const subscriber of coordinator.subscribers.values()) {
        subscriber.onState(state);
    }
}

function syncTimer(coordinator: DashboardCoordinator): void {
    const nextInterval = Math.min(
        ...Array.from(coordinator.subscribers.values(), ({ pollInterval }) => pollInterval),
    );
    if (coordinator.timer !== null && coordinator.timerInterval === nextInterval) {
        return;
    }

    clearCoordinatorTimer(coordinator);
    coordinator.timerInterval = nextInterval;
    coordinator.timer = setInterval(() => runEvaluationCycle(coordinator), nextInterval);
}

function clearCoordinatorTimer(coordinator: DashboardCoordinator): void {
    if (coordinator.timer !== null) {
        clearInterval(coordinator.timer);
        coordinator.timer = null;
    }
    coordinator.timerInterval = null;
}

/** @internal Test-only cleanup for the module-scoped coordinator registry. */
export function resetAlertHistoryCoordinatorsForTests(): void {
    for (const coordinator of coordinators.values()) {
        clearCoordinatorTimer(coordinator);
    }
    coordinators.clear();
}
