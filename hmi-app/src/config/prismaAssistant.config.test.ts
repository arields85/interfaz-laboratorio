import { describe, expect, it } from 'vitest';

import {
    PRISMA_LOCAL_CONFIG_URL,
    PRISMA_LOCAL_SNAPSHOT_URL,
    PRISMA_LOCAL_TTS_URL,
    assertPrismaLocalDestination,
    resolvePrismaConfigUrl,
    resolvePrismaTtsUrl,
} from './prismaAssistant.config';

describe('prismaAssistant.config', () => {
    it('resolves Local snapshot, configuration, and TTS only to the exact loopback allowlist', () => {
        expect(assertPrismaLocalDestination('snapshot', PRISMA_LOCAL_SNAPSHOT_URL))
            .toBe('http://127.0.0.1:5057/hmi/current-snapshot');
        expect(resolvePrismaConfigUrl('local', null))
            .toBe('http://127.0.0.1:5057/hmi/prisma-config');
        expect(resolvePrismaTtsUrl('local', 'https://server.example/prisma/speak-live'))
            .toBe('http://127.0.0.1:5056/prisma/speak-live');
        expect(assertPrismaLocalDestination('config', PRISMA_LOCAL_CONFIG_URL)).toBe(PRISMA_LOCAL_CONFIG_URL);
        expect(assertPrismaLocalDestination('tts', PRISMA_LOCAL_TTS_URL)).toBe(PRISMA_LOCAL_TTS_URL);
    });

    it.each([
        ['industrial current data', 'http://127.0.0.1:5057/api/hmi-data'],
        ['industrial history', 'http://127.0.0.1:5057/api/hmi-data/history'],
        ['industrial activity series', 'http://127.0.0.1:5057/api/hmi-data/activity-series'],
        ['remote host', 'https://node-red.example/hmi/current-snapshot'],
        ['relative path', '/hmi/current-snapshot'],
        ['unauthorized loopback path', 'http://127.0.0.1:5057/hmi/other'],
    ])('rejects %s as a Local Prisma destination', (_case, destination) => {
        for (const kind of ['snapshot', 'config', 'tts'] as const) {
            expect(() => assertPrismaLocalDestination(kind, destination))
                .toThrow('Unauthorized Prisma Local destination');
        }
    });
});
