import { PRISMA_SNAPSHOT_URL } from '../config/prismaAssistant.config';

const SNAPSHOT_EXPORT_FAILED_MESSAGE = '[dashboard-snapshot-export] Snapshot export failed.';
const SNAPSHOT_EXPORT_TIMEOUT_MESSAGE = '[dashboard-snapshot-export] Snapshot export timed out.';
const SNAPSHOT_EXPORT_TIMEOUT_MS = 4_500;
const SNAPSHOT_EXPORT_FAILED_EVENT = 'hmi:snapshot-export-failed';

type SnapshotExportFailureReason = 'timeout' | 'request-failed';

interface SnapshotExportFailureDetail {
    reason: SnapshotExportFailureReason;
    status: number | null;
    url: string;
}

export interface DashboardSnapshotExporterOptions {
    intervalMs?: number;
    getSnapshot: () => unknown | null;
}

let activeExporter: { stop: () => void } | null = null;

export async function exportDashboardSnapshot(
    snapshot: unknown,
    lifecycleSignal?: AbortSignal,
): Promise<boolean> {
    if (lifecycleSignal?.aborted) {
        return false;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, SNAPSHOT_EXPORT_TIMEOUT_MS);
    const cancel = () => controller.abort(lifecycleSignal?.reason);
    lifecycleSignal?.addEventListener('abort', cancel, { once: true });

    try {
        const response = await fetch(PRISMA_SNAPSHOT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(snapshot),
            signal: controller.signal,
        });
        if (!response.ok) {
            const error = new Error(`HTTP ${response.status}`) as Error & { status: number };
            error.status = response.status;
            throw error;
        }
        return true;
    } catch (error: unknown) {
        if (lifecycleSignal?.aborted) {
            return false;
        }
        const detail: SnapshotExportFailureDetail = {
            reason: timedOut ? 'timeout' : 'request-failed',
            status: getErrorStatus(error),
            url: PRISMA_SNAPSHOT_URL,
        };
        dispatchSnapshotExportFailedEvent(detail);
        console.warn(timedOut ? SNAPSHOT_EXPORT_TIMEOUT_MESSAGE : SNAPSHOT_EXPORT_FAILED_MESSAGE, error);
        return false;
    } finally {
        window.clearTimeout(timeoutId);
        lifecycleSignal?.removeEventListener('abort', cancel);
    }
}

export function startDashboardSnapshotExporter({
    intervalMs = 5_000,
    getSnapshot,
}: DashboardSnapshotExporterOptions): () => void {
    activeExporter?.stop();

    let stopped = false;
    let inFlight: Promise<boolean> | null = null;
    const lifecycleController = new AbortController();

    const exportCurrentSnapshot = () => {
        if (stopped || inFlight) {
            return;
        }
        const snapshot = getSnapshot();
        if (snapshot === null) {
            return;
        }
        const request = exportDashboardSnapshot(snapshot, lifecycleController.signal).finally(() => {
            if (inFlight === request) {
                inFlight = null;
            }
        });
        inFlight = request;
        void request;
    };

    const intervalId = window.setInterval(exportCurrentSnapshot, intervalMs);
    const owner = { stop: () => undefined as void };
    const stop = () => {
        if (stopped) return;
        stopped = true;
        window.clearInterval(intervalId);
        lifecycleController.abort();
        if (activeExporter === owner) {
            activeExporter = null;
        }
    };
    owner.stop = stop;
    activeExporter = owner;
    return stop;
}

export function stopDashboardSnapshotExporter(): void {
    activeExporter?.stop();
}

function getErrorStatus(error: unknown): number | null {
    return typeof error === 'object'
        && error !== null
        && 'status' in error
        && typeof error.status === 'number'
        ? error.status
        : null;
}

function dispatchSnapshotExportFailedEvent(detail: SnapshotExportFailureDetail): void {
    if (typeof window === 'undefined' || typeof CustomEvent !== 'function') return;
    try {
        window.dispatchEvent(new CustomEvent<SnapshotExportFailureDetail>(SNAPSHOT_EXPORT_FAILED_EVENT, { detail }));
    } catch {
        // Snapshot export failures must never interrupt the HMI.
    }
}

export function resetDashboardSnapshotExportStateForTests(): void {
    stopDashboardSnapshotExporter();
    activeExporter = null;
}
