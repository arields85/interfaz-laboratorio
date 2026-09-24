import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PRISMA_VOICE_TIMELINE_URL } from '../config/prismaAssistant.config';
import { PRISMA_BROWSER_METRIC_EVENT } from './prismaVoiceMetrics';
import type { PrismaBrowserMetric } from './prismaVoiceMetrics';
import { startPrismaVoiceTimelineDiagnostics } from './prismaVoiceTimelineDiagnosticsSink';

function metric(overrides: Partial<PrismaBrowserMetric> = {}): PrismaBrowserMetric {
    return {
        schema_version: '1',
        layer: 'browser',
        run_id: 'prisma-0123456789abcdef',
        record_type: 'orb-phase',
        sequence: 0,
        monotonic_ms: 10,
        elapsed_ms: 10,
        payload: { phase: 'visible' },
        ...overrides,
    } as PrismaBrowserMetric;
}

function dispatchMetric(detail: unknown): void {
    window.dispatchEvent(new CustomEvent(PRISMA_BROWSER_METRIC_EVENT, { detail }));
}

describe('prismaVoiceTimelineDiagnosticsSink', () => {
    let stop: (() => void) | null = null;

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        stop?.();
        stop = null;
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('batches records instead of posting immediately', () => {
        const transport = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
        stop = startPrismaVoiceTimelineDiagnostics({ transport, flushIntervalMs: 5_000, maxBatchRecords: 20 });

        dispatchMetric(metric());

        expect(transport).not.toHaveBeenCalled();
    });

    it('flushes the pending batch on the configured interval', async () => {
        const transport = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
        stop = startPrismaVoiceTimelineDiagnostics({ transport, flushIntervalMs: 1_000, maxBatchRecords: 20 });

        dispatchMetric(metric());
        dispatchMetric(metric({ sequence: 1 }));
        await vi.advanceTimersByTimeAsync(1_000);

        expect(transport).toHaveBeenCalledTimes(1);
        const [url, init] = transport.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(PRISMA_VOICE_TIMELINE_URL);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ records: [metric(), metric({ sequence: 1 })] });
    });

    it('flushes immediately once the batch reaches the configured size', () => {
        const transport = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
        stop = startPrismaVoiceTimelineDiagnostics({ transport, flushIntervalMs: 60_000, maxBatchRecords: 2 });

        dispatchMetric(metric());
        expect(transport).not.toHaveBeenCalled();
        dispatchMetric(metric({ sequence: 1 }));

        expect(transport).toHaveBeenCalledTimes(1);
    });

    it('flushes through the beacon transport on pagehide, not the ordinary transport', () => {
        const transport = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
        const beaconTransport = vi.fn();
        stop = startPrismaVoiceTimelineDiagnostics({
            transport, beaconTransport, flushIntervalMs: 60_000, maxBatchRecords: 20,
        });

        dispatchMetric(metric());
        window.dispatchEvent(new Event('pagehide'));

        expect(transport).not.toHaveBeenCalled();
        expect(beaconTransport).toHaveBeenCalledTimes(1);
        const [url, body] = beaconTransport.mock.calls[0] as [string, string];
        expect(url).toBe(PRISMA_VOICE_TIMELINE_URL);
        expect(JSON.parse(body)).toEqual({ records: [metric()] });
    });

    it('never flushes an empty batch, on the interval or on pagehide', async () => {
        const transport = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
        const beaconTransport = vi.fn();
        stop = startPrismaVoiceTimelineDiagnostics({
            transport, beaconTransport, flushIntervalMs: 1_000, maxBatchRecords: 20,
        });

        await vi.advanceTimersByTimeAsync(1_000);
        window.dispatchEvent(new Event('pagehide'));

        expect(transport).not.toHaveBeenCalled();
        expect(beaconTransport).not.toHaveBeenCalled();
    });

    it('never throws when the beacon transport throws synchronously', () => {
        const beaconTransport = vi.fn(() => {
            throw new Error('sendBeacon failed');
        });
        stop = startPrismaVoiceTimelineDiagnostics({ beaconTransport, flushIntervalMs: 60_000, maxBatchRecords: 20 });

        dispatchMetric(metric());
        expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow();
    });

    it('ignores a malformed or foreign CustomEvent detail instead of queueing it', async () => {
        const transport = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
        stop = startPrismaVoiceTimelineDiagnostics({ transport, flushIntervalMs: 1_000, maxBatchRecords: 20 });

        dispatchMetric({ not: 'a real metric' });
        dispatchMetric(null);
        await vi.advanceTimersByTimeAsync(1_000);

        expect(transport).not.toHaveBeenCalled();
    });

    it('never throws when the transport rejects (diagnostics must never affect playback)', async () => {
        const transport = vi.fn().mockRejectedValue(new Error('network down'));
        stop = startPrismaVoiceTimelineDiagnostics({ transport, flushIntervalMs: 1_000, maxBatchRecords: 20 });

        dispatchMetric(metric());
        await expect(vi.advanceTimersByTimeAsync(1_000)).resolves.not.toThrow();
    });

    it('stops listening and flushing once stopped', async () => {
        const transport = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
        const beaconTransport = vi.fn();
        const stopSink = startPrismaVoiceTimelineDiagnostics({
            transport, beaconTransport, flushIntervalMs: 1_000, maxBatchRecords: 20,
        });

        stopSink();
        dispatchMetric(metric());
        await vi.advanceTimersByTimeAsync(5_000);
        window.dispatchEvent(new Event('pagehide'));

        expect(transport).not.toHaveBeenCalled();
        expect(beaconTransport).not.toHaveBeenCalled();
    });
});
