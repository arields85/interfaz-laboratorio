/**
 * T16: makes the browser voice timeline observable without asking the
 * user to copy anything out of the browser console. Listens for every
 * `prisma-browser-metric` CustomEvent already dispatched by
 * dispatchPrismaBrowserMetric (both the per-playback records the audio
 * engine emits -- prismaVoiceAudioEngine.ts -- and the page-scoped
 * records prismaVoiceTimelineRecorder.ts emits), batches them, and
 * best-effort POSTs each batch through the existing session-capability
 * transport to POST /hmi/voice/timeline, where the runtime validates the
 * closed schema and writes one compact WARNING log line per accepted
 * record to prisma-presentation-stderr.log.
 *
 * A diagnostics failure here must never affect voice playback or the
 * HMI session: every POST is fire-and-forget (its rejection is
 * swallowed), and this module never throws from its own event handlers.
 */
import { PRISMA_VOICE_TIMELINE_URL } from '../config/prismaAssistant.config';
import { isPrismaAudioMetric } from '../domain/prismaAudioMetric.types';
import { prismaSessionClient } from './prismaSessionClient';
import { PRISMA_BROWSER_METRIC_EVENT } from './prismaVoiceMetrics';
import type { PrismaBrowserMetric } from './prismaVoiceMetrics';

/** How often a non-empty pending batch is flushed on its own. */
export const PRISMA_VOICE_TIMELINE_FLUSH_INTERVAL_MS = 2_000;
/** Flushes immediately once this many records are pending, instead of
 * waiting for the interval -- bounds one POST body and how much a burst
 * (e.g. every chunk of a fast local answer) can accumulate in memory. */
export const PRISMA_VOICE_TIMELINE_MAX_BATCH_RECORDS = 20;

export interface PrismaVoiceTimelineDiagnosticsSinkOptions {
    flushIntervalMs?: number;
    maxBatchRecords?: number;
    /** Test seam, mirroring every other service in this codebase (e.g.
     * voiceEventListener.service.ts's fetchImpl). Used for the interval and
     * batch-size flushes. Defaults to the real session-capability
     * transport. */
    transport?: (path: string, init: RequestInit) => Promise<Response>;
    /** Test seam for the pagehide flush specifically. Defaults to
     * prismaSessionClient.sendBeacon -- see that method's doc comment for
     * why the pagehide flush cannot reuse `transport`/prismaSessionClient's
     * ordinary fetch(): fetch() awaits bootstrap and re-checks the epoch,
     * which races the session-reset pagehide listener registered right
     * after this sink's own (see main.tsx) and silently loses the batch. */
    beaconTransport?: (path: string, body: string) => void;
}

export function startPrismaVoiceTimelineDiagnostics(
    options: PrismaVoiceTimelineDiagnosticsSinkOptions = {},
): () => void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return () => undefined;
    }

    const flushIntervalMs = options.flushIntervalMs ?? PRISMA_VOICE_TIMELINE_FLUSH_INTERVAL_MS;
    const maxBatchRecords = options.maxBatchRecords ?? PRISMA_VOICE_TIMELINE_MAX_BATCH_RECORDS;
    const transport = options.transport
        ?? ((path: string, init: RequestInit) => prismaSessionClient.fetch(path, init));
    const beaconTransport = options.beaconTransport
        ?? ((path: string, body: string) => prismaSessionClient.sendBeacon(path, body));

    let pending: PrismaBrowserMetric[] = [];
    let stopped = false;

    const takeBatch = (): PrismaBrowserMetric[] | null => {
        if (stopped || pending.length === 0) {
            return null;
        }
        const batch = pending;
        pending = [];
        return batch;
    };

    const flush = (): void => {
        const batch = takeBatch();
        if (batch === null) {
            return;
        }
        try {
            void transport(PRISMA_VOICE_TIMELINE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: batch }),
            }).catch(() => undefined);
        } catch {
            // Diagnostics must never affect voice playback or the HMI session.
        }
    };

    const flushOnPageHide = (): void => {
        const batch = takeBatch();
        if (batch === null) {
            return;
        }
        try {
            beaconTransport(PRISMA_VOICE_TIMELINE_URL, JSON.stringify({ records: batch }));
        } catch {
            // Diagnostics must never affect voice playback or the HMI session.
        }
    };

    const onMetric = (event: Event): void => {
        try {
            const detail = (event as CustomEvent<unknown>).detail;
            if (!isPrismaAudioMetric(detail)) {
                return;
            }
            pending.push(detail);
            if (pending.length >= maxBatchRecords) {
                flush();
            }
        } catch {
            // Diagnostics must never affect voice playback or the HMI session.
        }
    };

    window.addEventListener(PRISMA_BROWSER_METRIC_EVENT, onMetric);
    window.addEventListener('pagehide', flushOnPageHide);
    const flushTimer = window.setInterval(flush, flushIntervalMs);

    return () => {
        if (stopped) {
            return;
        }
        stopped = true;
        window.removeEventListener(PRISMA_BROWSER_METRIC_EVENT, onMetric);
        window.removeEventListener('pagehide', flushOnPageHide);
        window.clearInterval(flushTimer);
    };
}
