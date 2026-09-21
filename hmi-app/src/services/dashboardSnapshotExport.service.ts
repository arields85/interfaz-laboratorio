import { PRISMA_SNAPSHOT_URL } from '../config/prismaAssistant.config';
import type { PrismaContextIntent } from '../domain/prismaSession.types';
import { prismaSessionClient } from './prismaSessionClient';

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
    fetchImpl?: typeof fetch;
}

let activeExporter: { stop: () => void } | null = null;

export async function exportDashboardSnapshot(
    snapshot: unknown,
    lifecycleSignal?: AbortSignal,
    fetchImpl?: typeof fetch,
    intent?: PrismaContextIntent,
): Promise<boolean> {
    return sendContextCommand(
        (signal) => prismaSessionClient.publishContext(
            intent ?? prismaSessionClient.createContextIntent(), snapshot, signal, fetchImpl,
        ),
        lifecycleSignal,
    );
}

async function sendContextCommand(
    send: (signal: AbortSignal) => Promise<Response>,
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
        const response = await send(controller.signal);
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
    fetchImpl,
}: DashboardSnapshotExporterOptions): () => void {
    activeExporter?.stop();

    let stopped = false;
    let inFlight: Promise<boolean> | null = null;
    let lifecycleController = new AbortController();
    const owner = { stop: () => undefined as void };
    const canCapture = () => document.visibilityState !== 'hidden' && navigator.onLine;
    let paused = !canCapture();
    let contextInvalid = false;

    const abortPublication = () => {
        lifecycleController.abort();
        lifecycleController = new AbortController();
        inFlight = null;
    };
    const invalidate = () => {
        abortPublication();
        if (contextInvalid || activeExporter !== owner) return;
        contextInvalid = true;
        // Allocate before any asynchronous work; never reuse the aborted publish signal.
        void sendContextCommand((signal) => prismaSessionClient.invalidateContext(
            prismaSessionClient.createContextIntent(), signal, fetchImpl,
        ));
    };
    const exportCurrentSnapshot = () => {
        if (stopped || activeExporter !== owner || paused || inFlight) return;
        const epoch = prismaSessionClient.snapshot.epoch;
        const captureSignal = lifecycleController.signal;
        let intent: PrismaContextIntent;
        let snapshot: unknown;
        try {
            intent = prismaSessionClient.createContextIntent();
            snapshot = getSnapshot();
        } catch (error: unknown) {
            void sendContextCommand(() => Promise.reject(error));
            return;
        }
        // Capture is foreign code and can synchronously retire this lease or session.
        if (stopped || activeExporter !== owner || captureSignal.aborted
            || paused || !canCapture() || epoch !== prismaSessionClient.snapshot.epoch) return;
        if (snapshot === null) {
            invalidate();
            return;
        }
        contextInvalid = false;
        const request = exportDashboardSnapshot(snapshot, lifecycleController.signal, fetchImpl, intent).finally(() => {
            if (inFlight === request) inFlight = null;
        });
        inFlight = request;
        void request;
    };
    const availabilityChanged = () => {
        if (stopped || activeExporter !== owner) return;
        paused = !canCapture();
        if (paused) invalidate();
    };
    const unsubscribeReset = prismaSessionClient.subscribeToReset(() => {
        abortPublication();
        // Reset retired the old capability; only a future fresh capture may publish.
        contextInvalid = true;
    });
    const intervalId = window.setInterval(exportCurrentSnapshot, intervalMs);
    const stop = () => {
        if (stopped) return;
        stopped = true;
        window.clearInterval(intervalId);
        document.removeEventListener('visibilitychange', availabilityChanged);
        window.removeEventListener('offline', availabilityChanged);
        window.removeEventListener('online', availabilityChanged);
        unsubscribeReset();
        if (activeExporter === owner) {
            invalidate();
            if (activeExporter === owner) activeExporter = null;
        } else {
            abortPublication();
        }
    };
    owner.stop = stop;
    activeExporter = owner;
    document.addEventListener('visibilitychange', availabilityChanged);
    window.addEventListener('offline', availabilityChanged);
    window.addEventListener('online', availabilityChanged);
    if (paused) invalidate();
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
