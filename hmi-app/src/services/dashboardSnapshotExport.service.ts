import {
    getDataSnapshotExportUrl,
    isDataSnapshotExportEnabled,
} from '../config/dataConnection.config';

const SNAPSHOT_EXPORT_DISABLED_MESSAGE = '[dashboard-snapshot-export] Snapshot export skipped: feature disabled or endpoint missing.';
const SNAPSHOT_EXPORT_FAILED_MESSAGE = '[dashboard-snapshot-export] Snapshot export failed.';
const SNAPSHOT_EXPORT_TIMEOUT_MESSAGE = '[dashboard-snapshot-export] Snapshot export timed out.';
const SNAPSHOT_EXPORT_TIMEOUT_MS = 4_500;
const SNAPSHOT_EXPORT_TIMEOUT_CODE = 'dashboard-snapshot-export-timeout';
const SNAPSHOT_EXPORT_FAILED_EVENT = 'hmi:snapshot-export-failed';

type SnapshotExportFailureReason = 'disabled-missing-endpoint' | 'timeout' | 'request-failed';

interface SnapshotExportFailureDetail {
    reason: SnapshotExportFailureReason;
    status: number | null;
    url: string | null;
}

let inFlightExportRequest: Promise<void> | null = null;

export async function exportDashboardSnapshot(snapshot: unknown): Promise<boolean> {
    const url = getDataSnapshotExportUrl();

    if (!isDataSnapshotExportEnabled() || !url) {
        dispatchSnapshotExportFailedEvent({
            reason: 'disabled-missing-endpoint',
            status: null,
            url,
        });
        console.warn(SNAPSHOT_EXPORT_DISABLED_MESSAGE);
        return false;
    }

    if (inFlightExportRequest) {
        return false;
    }

    const { result, completion } = runSnapshotExport(url, snapshot);
    const trackedCompletion = completion.finally(() => {
        if (inFlightExportRequest === trackedCompletion) {
            inFlightExportRequest = null;
        }
    });

    inFlightExportRequest = trackedCompletion;

    return result;
}

function runSnapshotExport(url: string, snapshot: unknown): {
    result: Promise<boolean>;
    completion: Promise<void>;
} {
    if (typeof AbortController === 'function') {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => {
            controller.abort(createSnapshotExportTimeoutError());
        }, SNAPSHOT_EXPORT_TIMEOUT_MS);

        const request = postDashboardSnapshot(url, snapshot, controller.signal)
            .catch((error: unknown) => {
                if (isSnapshotExportTimeoutError(error)) {
                    dispatchSnapshotExportFailedEvent({
                        reason: 'timeout',
                        status: null,
                        url,
                    });
                    console.warn(SNAPSHOT_EXPORT_TIMEOUT_MESSAGE, error);
                    return false;
                }

                dispatchSnapshotExportFailedEvent({
                    reason: 'request-failed',
                    status: getSnapshotExportErrorStatus(error),
                    url,
                });
                console.warn(SNAPSHOT_EXPORT_FAILED_MESSAGE, error);
                return false;
            })
            .finally(() => {
                window.clearTimeout(timeoutId);
            });

        return {
            result: request,
            completion: request.then(() => undefined),
        };
    }

    let timeoutId = 0;
    let timedOut = false;

    const request = postDashboardSnapshot(url, snapshot)
        .catch((error: unknown) => {
            if (!timedOut) {
                dispatchSnapshotExportFailedEvent({
                    reason: 'request-failed',
                    status: getSnapshotExportErrorStatus(error),
                    url,
                });
                console.warn(SNAPSHOT_EXPORT_FAILED_MESSAGE, error);
            }

            return false;
        })
        .finally(() => {
            if (timeoutId !== 0) {
                window.clearTimeout(timeoutId);
            }
        });

    const result = Promise.race<boolean>([
        request,
        new Promise<boolean>((resolve) => {
            timeoutId = window.setTimeout(() => {
                timedOut = true;
                dispatchSnapshotExportFailedEvent({
                    reason: 'timeout',
                    status: null,
                    url,
                });
                console.warn(SNAPSHOT_EXPORT_TIMEOUT_MESSAGE, new Error(`Timeout after ${SNAPSHOT_EXPORT_TIMEOUT_MS}ms`));
                resolve(false);
            }, SNAPSHOT_EXPORT_TIMEOUT_MS);
        }),
    ]);

    return {
        result,
        completion: result.then(() => undefined),
    };
}

async function postDashboardSnapshot(url: string, snapshot: unknown, signal?: AbortSignal): Promise<boolean> {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(snapshot),
        signal,
    });

    if (!response.ok) {
        throw createSnapshotExportHttpError(response.status);
    }

    return true;
}

function isAbortError(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'name' in error
        && error.name === 'AbortError';
}

function createSnapshotExportTimeoutError(): Error & { code: string } {
    const timeoutError = new Error(`Timeout after ${SNAPSHOT_EXPORT_TIMEOUT_MS}ms`) as Error & { code: string };
    timeoutError.name = 'AbortError';
    timeoutError.code = SNAPSHOT_EXPORT_TIMEOUT_CODE;
    return timeoutError;
}

function createSnapshotExportHttpError(status: number): Error & { status: number } {
    const httpError = new Error(`HTTP ${status}`) as Error & { status: number };
    httpError.status = status;
    return httpError;
}

function isSnapshotExportTimeoutError(error: unknown): boolean {
    return isAbortError(error)
        || (typeof error === 'object'
            && error !== null
            && 'code' in error
            && error.code === SNAPSHOT_EXPORT_TIMEOUT_CODE);
}

function getSnapshotExportErrorStatus(error: unknown): number | null {
    return typeof error === 'object'
        && error !== null
        && 'status' in error
        && typeof error.status === 'number'
        ? error.status
        : null;
}

function dispatchSnapshotExportFailedEvent(detail: SnapshotExportFailureDetail): void {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') {
        return;
    }

    try {
        window.dispatchEvent(new CustomEvent<SnapshotExportFailureDetail>(SNAPSHOT_EXPORT_FAILED_EVENT, { detail }));
    } catch {
        // Keep snapshot export failures non-fatal for the HMI.
    }
}

export function resetDashboardSnapshotExportStateForTests(): void {
    inFlightExportRequest = null;
}
