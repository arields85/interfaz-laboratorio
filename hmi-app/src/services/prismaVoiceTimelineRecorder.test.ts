import { afterEach, describe, expect, it } from 'vitest';

import { PRISMA_BROWSER_METRIC_EVENT } from './prismaVoiceMetrics';
import {
    recordOrbPhase,
    recordSessionReset,
    recordSpeakLiveRequestStart,
    recordSpeakLiveResponseReceived,
    recordSpeakLiveStaleDiscarded,
    recordVoiceEventReceived,
    resetPrismaVoiceTimelineRecorderForTests,
} from './prismaVoiceTimelineRecorder';

function collect(run: () => void): unknown[] {
    const received: unknown[] = [];
    const listener = (event: Event) => {
        received.push((event as CustomEvent).detail);
    };
    window.addEventListener(PRISMA_BROWSER_METRIC_EVENT, listener);
    try {
        run();
    } finally {
        window.removeEventListener(PRISMA_BROWSER_METRIC_EVENT, listener);
    }
    return received;
}

describe('prismaVoiceTimelineRecorder', () => {
    afterEach(() => {
        resetPrismaVoiceTimelineRecorderForTests();
    });

    it('dispatches a well-formed, schema-valid record for every recorder function', () => {
        const received = collect(() => {
            recordVoiceEventReceived('sse');
            recordOrbPhase('visible');
            recordSpeakLiveRequestStart();
            recordSpeakLiveResponseReceived(200, 143);
            recordSpeakLiveStaleDiscarded(88);
            recordSessionReset('unauthorized-401', 3);
        });

        expect(received).toEqual([
            expect.objectContaining({ record_type: 'voice-event-received', payload: { source: 'sse' } }),
            expect.objectContaining({ record_type: 'orb-phase', payload: { phase: 'visible' } }),
            expect.objectContaining({ record_type: 'speak-live-request-start', payload: {} }),
            expect.objectContaining({
                record_type: 'speak-live-response-received',
                payload: { http_status: 200, elapsed_ms: 143 },
            }),
            expect.objectContaining({ record_type: 'speak-live-stale-discarded', payload: { elapsed_ms: 88 } }),
            expect.objectContaining({
                record_type: 'session-reset',
                payload: { reason: 'unauthorized-401', epoch_after: 3 },
            }),
        ]);
    });

    it('shares one opaque run id and a monotonically increasing sequence across every call', () => {
        const received = collect(() => {
            recordOrbPhase('visible');
            recordOrbPhase('fading');
            recordOrbPhase('hidden');
        }) as { run_id: string; sequence: number }[];

        expect(received).toHaveLength(3);
        const [first, second, third] = received;
        expect(first.run_id).toMatch(/^prisma-[0-9a-f]{16,64}$/);
        expect(second.run_id).toBe(first.run_id);
        expect(third.run_id).toBe(first.run_id);
        expect([first.sequence, second.sequence, third.sequence]).toEqual([0, 1, 2]);
    });

    it('mints a new run id after a test reset (isolating consecutive playbacks in tests)', () => {
        const [firstBatch] = collect(() => recordOrbPhase('visible')) as { run_id: string }[];
        resetPrismaVoiceTimelineRecorderForTests();
        const [secondBatch] = collect(() => recordOrbPhase('visible')) as { run_id: string }[];

        expect(secondBatch.run_id).not.toBe(firstBatch.run_id);
    });
});
