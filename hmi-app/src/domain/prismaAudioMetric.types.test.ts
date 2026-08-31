import { describe, expect, it } from 'vitest';

import {
    parsePrismaAudioMetric,
    validatePrismaAudioMetricSequence,
} from './prismaAudioMetric.types';

describe('Prisma audio metric contract', () => {
    it('round-trips the canonical generated snake_case browser envelope', () => {
        const metric = {
            schema_version: '1' as const,
            run_id: 'prisma-0123456789abcdef',
            layer: 'browser' as const,
            record_type: 'first-readable-audio' as const,
            sequence: 1,
            monotonic_ms: 12,
            elapsed_ms: 12,
            payload: { elapsed_ms: 12, pcm_bytes: 48_000 },
        };

        expect(parsePrismaAudioMetric(metric)).toEqual(metric);
        expect(() => parsePrismaAudioMetric({
            ...metric,
            schemaVersion: 1,
        } as never)).toThrow('allowlist');
    });

    it('round-trips an allowlisted browser record without accepting private payload fields', () => {
        const metric = {
            schema_version: '1' as const,
            run_id: 'prisma-0123456789abcdef',
            layer: 'browser' as const,
            record_type: 'playback-started' as const,
            sequence: 2,
            monotonic_ms: 12,
            elapsed_ms: 12,
            payload: {
                elapsed_ms: 12,
                transport: 'buffer-before-playback' as const,
                pcm_bytes: 48_000,
                pcm_duration_seconds: 1,
                underflow_count: 0,
            },
        };

        expect(parsePrismaAudioMetric(metric)).toEqual(metric);
        expect(() => parsePrismaAudioMetric({
            ...metric,
            payload: { ...metric.payload, text: 'must not cross the browser metric boundary' },
        })).toThrow('allowlist');
    });

    it('rejects non-monotonic records, external identifiers, and audio-bearing payloads', () => {
        const records = [
            {
                schema_version: '1' as const,
                run_id: 'prisma-0123456789abcdef',
                layer: 'browser' as const,
                record_type: 'request-start' as const,
                sequence: 0,
                monotonic_ms: 12,
                elapsed_ms: 0,
                payload: {},
            },
            {
                schema_version: '1' as const,
                run_id: 'prisma-0123456789abcdef',
                layer: 'browser' as const,
                record_type: 'cancel' as const,
                sequence: 1,
                monotonic_ms: 11,
                elapsed_ms: 0,
                payload: { elapsed_ms: 0 },
            },
        ];

        expect(() => validatePrismaAudioMetricSequence(records)).toThrow('monotonic');
        expect(() => parsePrismaAudioMetric({
            schema_version: '1' as const,
            run_id: 'prisma-0123456789abcdef',
            layer: 'browser' as const,
            record_type: 'error' as const,
            sequence: 3,
            monotonic_ms: 13,
            elapsed_ms: 1,
            payload: { error_code: 'audio-failure', event_id: 'external-event-id' },
        })).toThrow('allowlist');
        expect(() => parsePrismaAudioMetric({
            schema_version: '1' as const,
            run_id: 'prisma-0123456789abcdef',
            layer: 'browser' as const,
            record_type: 'buffering-complete' as const,
            sequence: 4,
            monotonic_ms: 14,
            elapsed_ms: 3,
            payload: {
                elapsed_ms: 3,
                pcm_bytes: 4,
                pcm_duration_seconds: 0.001,
                audio: new Uint8Array([1, 2]),
            },
        })).toThrow('allowlist');
    });

    it('round-trips the canonical EOF and decode categories for supported transports', () => {
        const metrics: unknown[] = [
            {
                schema_version: '1',
                run_id: 'prisma-0123456789abcdef',
                layer: 'browser',
                record_type: 'eof',
                sequence: 0,
                monotonic_ms: 12,
                elapsed_ms: 4,
                payload: {
                    elapsed_ms: 4,
                    transport: 'progressive',
                    pcm_bytes: 48,
                    pcm_duration_seconds: 0.001,
                },
            },
            {
                schema_version: '1',
                run_id: 'prisma-0123456789abcdef',
                layer: 'browser',
                record_type: 'canonical-decode',
                sequence: 1,
                monotonic_ms: 13,
                elapsed_ms: 5,
                payload: {
                    elapsed_ms: 5,
                    transport: 'buffer-before-playback',
                    pcm_bytes: 48,
                    pcm_duration_seconds: 0.001,
                },
            },
        ];

        expect(metrics.map((metric) => parsePrismaAudioMetric(metric))).toEqual(metrics);
    });
});
