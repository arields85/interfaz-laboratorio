/**
 * T16: page-scoped voice timeline records.
 *
 * The Prisma voice audio engine already emits structured, schema-typed
 * records for one playback (request start, first readable audio, playback
 * started/ended, cancel, error, ...) through `dispatchPrismaBrowserMetric`
 * (see prismaVoiceAudioEngine.ts / prismaVoiceMetrics.ts), keyed by a
 * per-playback opaque run id.
 *
 * Several events T16 needs to see are NOT scoped to one playback -- a
 * voice event arriving over SSE/poll, an orb phase change, a session
 * reset racing a live request, a stale-response discard. This module mints
 * ONE opaque run id for the whole page load and emits those through the
 * exact same `prisma-browser-metric` CustomEvent channel (reusing
 * dispatchPrismaBrowserMetric, never a parallel mechanism), so
 * prismaVoiceTimelineDiagnosticsSink.ts has a single source to listen to
 * for the whole browser voice timeline. (AudioContext resume outcomes are
 * the one exception: they ARE playback-scoped, so the engine emits
 * `audio-context-state` itself through its own per-playback
 * emitDiagnostic -- see prismaVoiceAudioEngine.ts's ensureContextRunning
 * -- not through this page-scoped module.)
 *
 * Deliberately has no dependency on prismaSessionClient.ts (which itself
 * calls recordSessionReset below) -- that would create an import cycle
 * with the sink, which needs prismaSessionClient to POST the batch.
 */
import {
    createOpaqueBrowserRunId,
    dispatchPrismaBrowserMetric,
} from './prismaVoiceMetrics';
import type { PrismaBrowserMetric } from './prismaVoiceMetrics';
import type {
    PrismaAudioMetricPayload,
    PrismaAudioMetricPhase,
    PrismaAudioMetricReason,
    PrismaAudioMetricSource,
} from '../domain/prismaAudioMetric.types';

let pageRunId: string | null = null;
let pageLoadMonotonicMs: number | null = null;
let sequence = 0;

function pageRun(): { runId: string; loadedAt: number } {
    if (pageRunId === null || pageLoadMonotonicMs === null) {
        pageRunId = createOpaqueBrowserRunId();
        pageLoadMonotonicMs = performance.now();
    }
    return { runId: pageRunId, loadedAt: pageLoadMonotonicMs };
}

function emitPageTimelineRecord(payload: PrismaAudioMetricPayload): void {
    try {
        const { runId, loadedAt } = pageRun();
        const monotonicMs = performance.now();
        const metric: PrismaBrowserMetric = {
            ...payload,
            schema_version: '1',
            layer: 'browser',
            run_id: runId,
            sequence,
            monotonic_ms: monotonicMs,
            elapsed_ms: Math.max(0, monotonicMs - loadedAt),
        };
        sequence += 1;
        dispatchPrismaBrowserMetric(metric);
    } catch {
        // Diagnostics must never affect voice playback or session behavior.
    }
}

export function recordVoiceEventReceived(source: PrismaAudioMetricSource): void {
    emitPageTimelineRecord({ record_type: 'voice-event-received', payload: { source } });
}

export function recordOrbPhase(phase: PrismaAudioMetricPhase): void {
    emitPageTimelineRecord({ record_type: 'orb-phase', payload: { phase } });
}

export function recordSpeakLiveRequestStart(): void {
    emitPageTimelineRecord({ record_type: 'speak-live-request-start', payload: {} });
}

export function recordSpeakLiveResponseReceived(httpStatus: number, elapsedMs: number): void {
    emitPageTimelineRecord({
        record_type: 'speak-live-response-received',
        payload: { http_status: httpStatus, elapsed_ms: elapsedMs },
    });
}

export function recordSpeakLiveStaleDiscarded(elapsedMs: number): void {
    emitPageTimelineRecord({ record_type: 'speak-live-stale-discarded', payload: { elapsed_ms: elapsedMs } });
}

export function recordSessionReset(reason: PrismaAudioMetricReason, epochAfter: number): void {
    emitPageTimelineRecord({ record_type: 'session-reset', payload: { reason, epoch_after: epochAfter } });
}

/** Test-only: resets the module-level page run id/sequence so tests do not
 * leak state into each other. Never called from production code. */
export function resetPrismaVoiceTimelineRecorderForTests(): void {
    pageRunId = null;
    pageLoadMonotonicMs = null;
    sequence = 0;
}
