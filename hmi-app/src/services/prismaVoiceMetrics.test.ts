import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    dispatchPrismaBrowserMetric,
    PRISMA_BROWSER_METRIC_EVENT,
} from './prismaVoiceMetrics';

describe('Prisma browser metrics', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('dispatches one opaque allowlisted browser record without using a provider path', () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch');
        const received: unknown[] = [];
        const listener = (event: Event) => {
            received.push((event as CustomEvent).detail);
        };
        window.addEventListener(PRISMA_BROWSER_METRIC_EVENT, listener);

        dispatchPrismaBrowserMetric({
            schema_version: '1',
            layer: 'browser',
            run_id: 'prisma-0123456789abcdef',
            record_type: 'request-start',
            sequence: 0,
            monotonic_ms: 40,
            elapsed_ms: 0,
            payload: {},
        });

        window.removeEventListener(PRISMA_BROWSER_METRIC_EVENT, listener);
        expect(received).toEqual([{
            schema_version: '1',
            layer: 'browser',
            run_id: 'prisma-0123456789abcdef',
            record_type: 'request-start',
            sequence: 0,
            monotonic_ms: 40,
            elapsed_ms: 0,
            payload: {},
        }]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('ignores malformed records instead of dispatching text, credentials, or audio', () => {
        const received: unknown[] = [];
        const listener = (event: Event) => {
            received.push((event as CustomEvent).detail);
        };
        window.addEventListener(PRISMA_BROWSER_METRIC_EVENT, listener);

        dispatchPrismaBrowserMetric({
            schema_version: '1',
            layer: 'browser',
            run_id: 'prisma-0123456789abcdef',
            record_type: 'request-start',
            sequence: 0,
            monotonic_ms: 41,
            elapsed_ms: 0,
            payload: {},
            credentials: 'secret',
            audio: new Uint8Array([1]),
        } as never);

        window.removeEventListener(PRISMA_BROWSER_METRIC_EVENT, listener);
        expect(received).toEqual([]);
    });
});
