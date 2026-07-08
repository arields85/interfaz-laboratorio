export type TrendChartV2PerformanceDiagnosticEventName =
    | 'resize_noop_suppressed'
    | 'invalid_measurement_preserved'
    | 'resize_settled_committed'
    | 'prefetch_denied'
    | 'refresh_failed'
    | 'transition_measured';

export interface TrendChartV2PerformanceDiagnosticEvent {
    widgetId: string;
    event: TrendChartV2PerformanceDiagnosticEventName;
    reason?: string;
    durationMs?: number;
}

type TrendChartV2PerformanceDiagnosticListener = (event: TrendChartV2PerformanceDiagnosticEvent) => void;

const TREND_CHART_V2_DIAGNOSTICS_BUFFER_KEY = '__HMI_TREND_CHART_V2_DIAGNOSTICS__';
const TREND_CHART_V2_DIAGNOSTICS_BUFFER_LIMIT = 50;
const diagnosticsListeners = new Set<TrendChartV2PerformanceDiagnosticListener>();

export function subscribeTrendChartV2PerformanceDiagnostics(listener: TrendChartV2PerformanceDiagnosticListener): () => void {
    diagnosticsListeners.add(listener);

    return () => {
        diagnosticsListeners.delete(listener);
    };
}

export function recordTrendChartV2PerformanceDiagnostic(event: TrendChartV2PerformanceDiagnosticEvent): void {
    const diagnosticsBuffer = getDiagnosticsBuffer();

    diagnosticsBuffer.push(event);

    if (diagnosticsBuffer.length > TREND_CHART_V2_DIAGNOSTICS_BUFFER_LIMIT) {
        diagnosticsBuffer.splice(0, diagnosticsBuffer.length - TREND_CHART_V2_DIAGNOSTICS_BUFFER_LIMIT);
    }

    for (const listener of diagnosticsListeners) {
        listener(event);
    }
}

export function getTrendChartV2PerformanceDiagnosticsSnapshot(): TrendChartV2PerformanceDiagnosticEvent[] {
    return [...getDiagnosticsBuffer()];
}

export function clearTrendChartV2PerformanceDiagnosticsSnapshot(): void {
    getDiagnosticsBuffer().length = 0;
}

export function startTrendChartV2PerformanceTransition(widgetId: string): (reason?: string) => number {
    const measurementName = `trend-chart-v2:${widgetId}`;
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

        recordTrendChartV2PerformanceDiagnostic({
            widgetId,
            event: 'transition_measured',
            reason,
            durationMs,
        });

        return durationMs;
    };
}

function getDiagnosticsBuffer(): TrendChartV2PerformanceDiagnosticEvent[] {
    const diagnosticsHost = globalThis as typeof globalThis & {
        [TREND_CHART_V2_DIAGNOSTICS_BUFFER_KEY]?: TrendChartV2PerformanceDiagnosticEvent[];
    };

    if (!Array.isArray(diagnosticsHost[TREND_CHART_V2_DIAGNOSTICS_BUFFER_KEY])) {
        diagnosticsHost[TREND_CHART_V2_DIAGNOSTICS_BUFFER_KEY] = [];
    }

    return diagnosticsHost[TREND_CHART_V2_DIAGNOSTICS_BUFFER_KEY];
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
