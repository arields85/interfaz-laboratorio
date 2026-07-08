export type ActivityAnalyticsPerformanceDiagnosticEventName =
    | 'refresh_failed'
    | 'prefetch_suppressed'
    | 'prefetch_started'
    | 'prefetch_failed'
    | 'transition_measured';

export interface ActivityAnalyticsPerformanceDiagnosticEvent {
    widgetId: string;
    event: ActivityAnalyticsPerformanceDiagnosticEventName;
    reason?: string;
    durationMs?: number;
}

type ActivityAnalyticsPerformanceDiagnosticListener = (event: ActivityAnalyticsPerformanceDiagnosticEvent) => void;

const ACTIVITY_ANALYTICS_DIAGNOSTICS_BUFFER_KEY = '__HMI_ACTIVITY_ANALYTICS_DIAGNOSTICS__';
const ACTIVITY_ANALYTICS_DIAGNOSTICS_BUFFER_LIMIT = 50;
const diagnosticsListeners = new Set<ActivityAnalyticsPerformanceDiagnosticListener>();

export function subscribeActivityAnalyticsPerformanceDiagnostics(listener: ActivityAnalyticsPerformanceDiagnosticListener): () => void {
    diagnosticsListeners.add(listener);

    return () => {
        diagnosticsListeners.delete(listener);
    };
}

export function recordActivityAnalyticsPerformanceDiagnostic(event: ActivityAnalyticsPerformanceDiagnosticEvent): void {
    const diagnosticsBuffer = getDiagnosticsBuffer();

    diagnosticsBuffer.push(event);

    if (diagnosticsBuffer.length > ACTIVITY_ANALYTICS_DIAGNOSTICS_BUFFER_LIMIT) {
        diagnosticsBuffer.splice(0, diagnosticsBuffer.length - ACTIVITY_ANALYTICS_DIAGNOSTICS_BUFFER_LIMIT);
    }

    for (const listener of diagnosticsListeners) {
        listener(event);
    }
}

export function getActivityAnalyticsPerformanceDiagnosticsSnapshot(): ActivityAnalyticsPerformanceDiagnosticEvent[] {
    return [...getDiagnosticsBuffer()];
}

export function clearActivityAnalyticsPerformanceDiagnosticsSnapshot(): void {
    getDiagnosticsBuffer().length = 0;
}

export function startActivityAnalyticsPerformanceTransition(widgetId: string): (reason?: string) => number {
    const measurementName = `activity-analytics:${widgetId}`;
    const startMarkName = `${measurementName}:start`;
    const endMarkName = `${measurementName}:end`;
    const startTime = getPerformanceNow();
    const performanceApi = getPerformanceApi();

    performanceApi?.mark?.(startMarkName);

    return (reason?: string) => {
        const durationMs = Math.max(0, getPerformanceNow() - startTime);

        performanceApi?.mark?.(endMarkName);
        performanceApi?.measure?.(measurementName, startMarkName, endMarkName);
        performanceApi?.clearMarks?.(startMarkName);
        performanceApi?.clearMarks?.(endMarkName);
        performanceApi?.clearMeasures?.(measurementName);

        recordActivityAnalyticsPerformanceDiagnostic({
            widgetId,
            event: 'transition_measured',
            reason,
            durationMs,
        });

        return durationMs;
    };
}

function getDiagnosticsBuffer(): ActivityAnalyticsPerformanceDiagnosticEvent[] {
    const diagnosticsHost = globalThis as typeof globalThis & {
        [ACTIVITY_ANALYTICS_DIAGNOSTICS_BUFFER_KEY]?: ActivityAnalyticsPerformanceDiagnosticEvent[];
    };

    if (!Array.isArray(diagnosticsHost[ACTIVITY_ANALYTICS_DIAGNOSTICS_BUFFER_KEY])) {
        diagnosticsHost[ACTIVITY_ANALYTICS_DIAGNOSTICS_BUFFER_KEY] = [];
    }

    return diagnosticsHost[ACTIVITY_ANALYTICS_DIAGNOSTICS_BUFFER_KEY];
}

function getPerformanceNow(): number {
    const performanceApi = getPerformanceApi();

    if (typeof performanceApi?.now === 'function') {
        return performanceApi.now();
    }

    return Date.now();
}

function getPerformanceApi(): Performance | undefined {
    if (typeof globalThis === 'undefined' || !('performance' in globalThis)) {
        return undefined;
    }

    return globalThis.performance;
}
