/**
 * T16: makes the browser voice timeline observable without asking the
 * user to copy anything out of the browser console. Listens for every
 * `leda-browser-metric` CustomEvent already dispatched by
 * dispatchLedaBrowserMetric (both the per-playback records the audio
 * engine emits -- ledaVoiceAudioEngine.ts -- and the page-scoped
 * records ledaVoiceTimelineRecorder.ts emits), batches them, and
 * best-effort POSTs each batch through the existing session-capability
 * transport to POST /hmi/voice/timeline, where the runtime validates the
 * closed schema and writes one compact WARNING log line per accepted
 * record to leda-presentation-stderr.log.
 *
 * A diagnostics failure here must never affect voice playback or the
 * HMI session: every POST is fire-and-forget (its rejection is
 * swallowed), and this module never throws from its own event handlers.
 */
import { LEDA_VOICE_TIMELINE_URL } from '../config/ledaAssistant.config';
import { isLedaAudioMetric } from '../domain/ledaAudioMetric.types';
import { ledaSessionClient } from './ledaSessionClient';
import { LEDA_BROWSER_METRIC_EVENT } from './ledaVoiceMetrics';
import type { LedaBrowserMetric } from './ledaVoiceMetrics';

/** How often a non-empty pending batch is flushed on its own. */
export const LEDA_VOICE_TIMELINE_FLUSH_INTERVAL_MS = 2_000;
/** Flushes immediately once this many records are pending, instead of
 * waiting for the interval -- bounds one POST body and how much a burst
 * (e.g. every chunk of a fast local answer) can accumulate in memory. */
export const LEDA_VOICE_TIMELINE_MAX_BATCH_RECORDS = 20;

export interface LedaVoiceTimelineDiagnosticsSinkOptions {
    flushIntervalMs?: number;
    maxBatchRecords?: number;
    /** Test seam, mirroring every other service in this codebase (e.g.
     * voiceEventListener.service.ts's fetchImpl). Used for the interval and
     * batch-size flushes. Defaults to the real session-capability
     * transport. */
    transport?: (path: string, init: RequestInit) => Promise<Response>;
    /** Test seam for the pagehide flush specifically. Defaults to
     * ledaSessionClient.sendBeacon -- see that method's doc comment for
     * why the pagehide flush cannot reuse `transport`/ledaSessionClient's
     * ordinary fetch(): fetch() awaits bootstrap and re-checks the epoch,
     * which races the session-reset pagehide listener registered right
     * after this sink's own (see main.tsx) and silently loses the batch. */
    beaconTransport?: (path: string, body: string) => void;
}

export function startLedaVoiceTimelineDiagnostics(
    options: LedaVoiceTimelineDiagnosticsSinkOptions = {},
): () => void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return () => undefined;
    }

    const flushIntervalMs = options.flushIntervalMs ?? LEDA_VOICE_TIMELINE_FLUSH_INTERVAL_MS;
    const maxBatchRecords = options.maxBatchRecords ?? LEDA_VOICE_TIMELINE_MAX_BATCH_RECORDS;
    const transport = options.transport
        ?? ((path: string, init: RequestInit) => ledaSessionClient.fetch(path, init));
    const beaconTransport = options.beaconTransport
        ?? ((path: string, body: string) => ledaSessionClient.sendBeacon(path, body));

    let pending: LedaBrowserMetric[] = [];
    let stopped = false;

    const takeBatch = (): LedaBrowserMetric[] | null => {
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
            void transport(LEDA_VOICE_TIMELINE_URL, {
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
            beaconTransport(LEDA_VOICE_TIMELINE_URL, JSON.stringify({ records: batch }));
        } catch {
            // Diagnostics must never affect voice playback or the HMI session.
        }
    };

    const onMetric = (event: Event): void => {
        try {
            const detail = (event as CustomEvent<unknown>).detail;
            if (!isLedaAudioMetric(detail)) {
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

    window.addEventListener(LEDA_BROWSER_METRIC_EVENT, onMetric);
    window.addEventListener('pagehide', flushOnPageHide);
    const flushTimer = window.setInterval(flush, flushIntervalMs);

    return () => {
        if (stopped) {
            return;
        }
        stopped = true;
        window.removeEventListener(LEDA_BROWSER_METRIC_EVENT, onMetric);
        window.removeEventListener('pagehide', flushOnPageHide);
        window.clearInterval(flushTimer);
    };
}
