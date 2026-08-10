import { describe, expect, it, vi } from 'vitest';

import { createDefaultPrismaVoiceConfig } from '../domain/prismaVoiceConfig';
import {
    HttpPrismaVoiceConfigReader,
    HttpPrismaVoiceConfigWriter,
    PrismaVoiceConfigReadError,
} from './prismaVoiceConfig.adapter';

function response(overrides: Partial<Response> = {}): Response {
    return {
        ok: true,
        status: 200,
        json: vi.fn(async () => createDefaultPrismaVoiceConfig()),
        ...overrides,
    } as Response;
}

describe('HttpPrismaVoiceConfigReader', () => {
    it('performs an exact GET and forwards the AbortSignal', async () => {
        const fetchMock = vi.fn(async () => response());
        const signal = new AbortController().signal;
        const reader = new HttpPrismaVoiceConfigReader(
            'https://node-red.local/hmi/prisma-config',
            fetchMock as typeof fetch,
        );

        await reader.readConfig(signal);

        expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
            'https://node-red.local/hmi/prisma-config',
            {
                method: 'GET',
                headers: { Accept: 'application/json' },
                cache: 'no-store',
                signal,
            },
        );
    });

    it('rejects non-OK HTTP responses', async () => {
        const reader = new HttpPrismaVoiceConfigReader(
            'https://node-red.local/hmi/prisma-config',
            vi.fn(async () => response({ ok: false, status: 503 })) as typeof fetch,
        );

        await expect(reader.readConfig(new AbortController().signal)).rejects.toMatchObject({
            name: 'PrismaVoiceConfigReadError',
            kind: 'http',
            statusCode: 503,
        });
    });

    it('rejects invalid JSON responses', async () => {
        const reader = new HttpPrismaVoiceConfigReader(
            'https://node-red.local/hmi/prisma-config',
            vi.fn(async () => response({
                json: vi.fn(async () => {
                    throw new SyntaxError('Unexpected token');
                }),
            })) as typeof fetch,
        );

        await expect(reader.readConfig(new AbortController().signal)).rejects.toMatchObject({
            name: 'PrismaVoiceConfigReadError',
            kind: 'json',
        });
    });

    it('rejects payloads that fail domain validation', async () => {
        const reader = new HttpPrismaVoiceConfigReader(
            'https://node-red.local/hmi/prisma-config',
            vi.fn(async () => response({
                json: vi.fn(async () => ({ effectEnabled: true })),
            })) as typeof fetch,
        );

        await expect(reader.readConfig(new AbortController().signal)).rejects.toMatchObject({
            name: 'PrismaVoiceConfigReadError',
            kind: 'validation',
        });
    });

    it('preserves network failures', async () => {
        const networkError = new TypeError('Failed to fetch');
        const reader = new HttpPrismaVoiceConfigReader(
            'https://node-red.local/hmi/prisma-config',
            vi.fn(async () => {
                throw networkError;
            }) as typeof fetch,
        );

        await expect(reader.readConfig(new AbortController().signal)).rejects.toBe(networkError);
    });

    it('returns a validated clone of a valid response', async () => {
        const payload = createDefaultPrismaVoiceConfig();
        payload.effectIntensity = 42;
        const reader = new HttpPrismaVoiceConfigReader(
            'https://node-red.local/hmi/prisma-config',
            vi.fn(async () => response({ json: vi.fn(async () => payload) })) as typeof fetch,
        );

        const result = await reader.readConfig(new AbortController().signal);

        expect(result).toEqual(payload);
        expect(result).not.toBe(payload);
        expect(result.robotic).not.toBe(payload.robotic);
        expect(PrismaVoiceConfigReadError).toBeDefined();
    });
});

describe('HttpPrismaVoiceConfigWriter', () => {
    it('validates and sends the complete config in one exact PUT request', async () => {
        const config = createDefaultPrismaVoiceConfig();
        const fetchMock = vi.fn(async () => response({ json: vi.fn(async () => config) }));
        const writer = new HttpPrismaVoiceConfigWriter(
            'https://node-red.local/hmi/prisma-config',
            fetchMock as typeof fetch,
        );

        await writer.updateConfig(config);

        expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
            'https://node-red.local/hmi/prisma-config',
            {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify(config),
                cache: 'no-store',
            },
        );
        expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
            effectEnabled: true,
            preset: 'robotic_medium_light',
            effectIntensity: 100,
            robotic: {
                modulationHz: 30,
                baseGain: 0.78,
                modulationDepth: 0.22,
                quantizationSteps: 260,
                metallicHz: 410,
                metallicMix: 0.04,
                echo1DelayMs: 40,
                echo1Gain: 0.22,
                echo2DelayMs: 95,
                echo2Gain: 0.1,
                normalizationTarget: 29_500,
                normalizationMaxGain: 1.6,
            },
        });
    });

    it('rejects an invalid local config before fetch', async () => {
        const config = createDefaultPrismaVoiceConfig();
        config.effectIntensity = Number.NaN;
        const fetchMock = vi.fn();
        const writer = new HttpPrismaVoiceConfigWriter(
            'https://node-red.local/hmi/prisma-config',
            fetchMock as typeof fetch,
        );

        await expect(writer.updateConfig(config)).rejects.toMatchObject({
            name: 'PrismaVoiceConfigWriteError',
            kind: 'request-validation',
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([400, 503])('rejects an explicit HTTP %i response without confirmation GET', async (status) => {
        const fetchMock = vi.fn(async () => response({ ok: false, status }));
        const writer = new HttpPrismaVoiceConfigWriter(
            'https://node-red.local/hmi/prisma-config',
            fetchMock as typeof fetch,
        );

        await expect(writer.updateConfig(createDefaultPrismaVoiceConfig())).rejects.toMatchObject({
            name: 'PrismaVoiceConfigWriteError',
            kind: 'http',
            statusCode: status,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT');
    });

    it.each([
        ['204 empty', response({
            status: 204,
            json: vi.fn(async () => { throw new SyntaxError('Unexpected end of JSON input'); }),
        })],
        ['invalid JSON', response({
            json: vi.fn(async () => { throw new SyntaxError('invalid'); }),
        })],
        ['non-config ACK', response({ json: vi.fn(async () => ({ ok: true })) })],
    ])('confirms an ambiguous %s PUT with one exact GET', async (_case, putResponse) => {
        const config = createDefaultPrismaVoiceConfig();
        config.effectIntensity = 65;
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
            init?.method === 'PUT'
                ? putResponse
                : response({ json: vi.fn(async () => config) })
        ));
        const writer = new HttpPrismaVoiceConfigWriter(
            'https://node-red.local/hmi/prisma-config',
            fetchMock as typeof fetch,
        );

        await expect(writer.updateConfig(config)).resolves.toEqual(config);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['PUT', 'GET']);
    });

    it('confirms a rejected PUT fetch with one GET without retrying PUT', async () => {
        const networkError = new TypeError('Failed to fetch');
        const config = createDefaultPrismaVoiceConfig();
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'PUT') throw networkError;
            return response({ json: vi.fn(async () => config) });
        });
        const writer = new HttpPrismaVoiceConfigWriter(
            'https://node-red.local/hmi/prisma-config',
            fetchMock as typeof fetch,
        );

        await expect(writer.updateConfig(config)).resolves.toEqual(config);
        expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['PUT', 'GET']);
    });

    it('rejects an ambiguous PUT when GET returns a different valid config', async () => {
        const sent = createDefaultPrismaVoiceConfig();
        sent.effectIntensity = 65;
        const persisted = createDefaultPrismaVoiceConfig();
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
            init?.method === 'PUT'
                ? response({ json: vi.fn(async () => ({ ok: true })) })
                : response({ json: vi.fn(async () => persisted) })
        ));
        const writer = new HttpPrismaVoiceConfigWriter(
            'https://node-red.local/hmi/prisma-config',
            fetchMock as typeof fetch,
        );

        await expect(writer.updateConfig(sent)).rejects.toMatchObject({
            name: 'PrismaVoiceConfigWriteError',
            kind: 'response-validation',
        });
        expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['PUT', 'GET']);
    });

    it.each([
        ['invalid', response({ json: vi.fn(async () => ({ effectEnabled: true })) })],
        ['failed', response({ ok: false, status: 503 })],
    ])('rejects an ambiguous PUT when confirmation GET is %s', async (_case, getResponse) => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => (
            init?.method === 'PUT'
                ? response({ json: vi.fn(async () => ({ ok: true })) })
                : getResponse
        ));
        const writer = new HttpPrismaVoiceConfigWriter(
            'https://node-red.local/hmi/prisma-config',
            fetchMock as typeof fetch,
        );

        await expect(writer.updateConfig(createDefaultPrismaVoiceConfig())).rejects.toMatchObject({
            name: 'PrismaVoiceConfigWriteError',
            kind: 'response-validation',
        });
        expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['PUT', 'GET']);
    });

    it('returns a validated clone of the normalized server response', async () => {
        const normalized = createDefaultPrismaVoiceConfig();
        normalized.effectIntensity = 64;
        normalized.robotic.modulationHz = 36;
        const fetchMock = vi.fn(async () => response({ json: vi.fn(async () => normalized) }));
        const writer = new HttpPrismaVoiceConfigWriter(
            'https://node-red.local/hmi/prisma-config',
            fetchMock as typeof fetch,
        );

        const result = await writer.updateConfig(createDefaultPrismaVoiceConfig());

        expect(result).toEqual(normalized);
        expect(result).not.toBe(normalized);
        expect(result.robotic).not.toBe(normalized.robotic);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT');
    });
});
