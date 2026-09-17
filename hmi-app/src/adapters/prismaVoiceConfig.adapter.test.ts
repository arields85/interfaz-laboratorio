import { describe, expect, it, vi } from 'vitest';

import { createDefaultPrismaVoiceConfig } from '../domain/prismaVoiceConfig';
import {
    HttpPrismaVoiceConfigReader,
    HttpPrismaVoiceConfigWriter,
} from './prismaVoiceConfig.adapter';

function envelope(config = createDefaultPrismaVoiceConfig()) {
    return { config, sync: { configured: false, verified: false } };
}

function response(overrides: Partial<Response> = {}): Response {
    return {
        ok: true,
        status: 200,
        json: vi.fn(async () => envelope()),
        ...overrides,
    } as Response;
}

describe('HttpPrismaVoiceConfigReader', () => {
    it('performs an exact GET and validates a cloned envelope config', async () => {
        const config = createDefaultPrismaVoiceConfig();
        config.effectIntensity = 42;
        const fetchMock = vi.fn(async () => response({ json: vi.fn(async () => envelope(config)) }));
        const signal = new AbortController().signal;
        const reader = new HttpPrismaVoiceConfigReader('/api/prisma/voice-config', fetchMock as typeof fetch);

        const result = await reader.readConfig(signal);

        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/prisma/voice-config', {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            signal,
        });
        expect(result).toEqual(config);
        expect(result).not.toBe(config);
        expect(result.robotic).not.toBe(config.robotic);
    });

    it.each([
        ['non-object', null],
        ['missing config', { sync: {} }],
        ['inherited config', Object.create({ config: createDefaultPrismaVoiceConfig() })],
        ['flat body', createDefaultPrismaVoiceConfig()],
    ])('rejects a %s response shape', async (_case, payload) => {
        const reader = new HttpPrismaVoiceConfigReader(
            '/api/prisma/voice-config',
            vi.fn(async () => response({ json: vi.fn(async () => payload) })) as typeof fetch,
        );

        await expect(reader.readConfig(new AbortController().signal)).rejects.toMatchObject({
            name: 'PrismaVoiceConfigReadError',
            kind: 'validation',
        });
    });

    it('classifies HTTP, JSON, and domain validation failures', async () => {
        const httpReader = new HttpPrismaVoiceConfigReader(
            '/api/prisma/voice-config',
            vi.fn(async () => response({ ok: false, status: 503 })) as typeof fetch,
        );
        const jsonReader = new HttpPrismaVoiceConfigReader(
            '/api/prisma/voice-config',
            vi.fn(async () => response({ json: vi.fn(async () => { throw new SyntaxError('bad json'); }) })) as typeof fetch,
        );
        const domainReader = new HttpPrismaVoiceConfigReader(
            '/api/prisma/voice-config',
            vi.fn(async () => response({ json: vi.fn(async () => ({ config: { effectEnabled: true } })) })) as typeof fetch,
        );

        await expect(httpReader.readConfig(new AbortController().signal)).rejects.toMatchObject({ kind: 'http', statusCode: 503 });
        await expect(jsonReader.readConfig(new AbortController().signal)).rejects.toMatchObject({ kind: 'json' });
        await expect(domainReader.readConfig(new AbortController().signal)).rejects.toMatchObject({ kind: 'validation' });
    });
});

describe('HttpPrismaVoiceConfigWriter', () => {
    it('validates and sends one complete PUT with the caller signal', async () => {
        const config = createDefaultPrismaVoiceConfig();
        const signal = new AbortController().signal;
        const fetchMock = vi.fn(async () => response({ json: vi.fn(async () => envelope(config)) }));
        const writer = new HttpPrismaVoiceConfigWriter('/api/prisma/voice-config', fetchMock as typeof fetch);

        await writer.updateConfig(config, signal);

        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/prisma/voice-config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(config),
            cache: 'no-store',
            signal,
        });
    });

    it('rejects an invalid request before fetch', async () => {
        const fetchMock = vi.fn();
        const writer = new HttpPrismaVoiceConfigWriter('/api/prisma/voice-config', fetchMock as typeof fetch);

        await expect(writer.updateConfig({ effectEnabled: true } as never)).rejects.toMatchObject({
            name: 'PrismaVoiceConfigWriteError',
            kind: 'request-validation',
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        ['network loss', () => Promise.reject(new TypeError('Failed to fetch'))],
        ['response loss', () => Promise.resolve(response({ status: 204, json: vi.fn(async () => { throw new SyntaxError('lost'); }) }))],
        ['invalid envelope', () => Promise.resolve(response({ json: vi.fn(async () => ({ sync: {} })) }))],
    ])('confirms an ambiguous %s with one exact GET', async (_case, putResult) => {
        const config = createDefaultPrismaVoiceConfig();
        const fetchMock = vi.fn()
            .mockImplementationOnce(putResult)
            .mockResolvedValueOnce(response({ json: vi.fn(async () => envelope(config)) }));
        const writer = new HttpPrismaVoiceConfigWriter('/api/prisma/voice-config', fetchMock as typeof fetch);

        await expect(writer.updateConfig(config)).resolves.toEqual(config);

        expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['PUT', 'GET']);
    });

    it('keeps the original ambiguity authoritative when confirmation differs', async () => {
        const sent = createDefaultPrismaVoiceConfig();
        const different = createDefaultPrismaVoiceConfig();
        different.effectIntensity = 12;
        const original = new TypeError('Failed to fetch');
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(original)
            .mockResolvedValueOnce(response({ json: vi.fn(async () => envelope(different)) }));
        const writer = new HttpPrismaVoiceConfigWriter('/api/prisma/voice-config', fetchMock as typeof fetch);

        await expect(writer.updateConfig(sent)).rejects.toBe(original);
    });

    it('does not confirm an aborted ambiguous write', async () => {
        const controller = new AbortController();
        const original = new DOMException('Aborted', 'AbortError');
        const fetchMock = vi.fn(async () => {
            controller.abort();
            throw original;
        });
        const writer = new HttpPrismaVoiceConfigWriter('/api/prisma/voice-config', fetchMock as typeof fetch);

        await expect(writer.updateConfig(createDefaultPrismaVoiceConfig(), controller.signal)).rejects.toBe(original);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
