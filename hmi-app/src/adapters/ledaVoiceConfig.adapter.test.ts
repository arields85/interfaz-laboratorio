import { describe, expect, it, vi } from 'vitest';

import { createDefaultLedaVoiceConfig } from '../domain/ledaVoiceConfig';
import {
    HttpLedaVoiceConfigReader,
    HttpLedaVoiceConfigWriter,
} from './ledaVoiceConfig.adapter';

function envelope(config = createDefaultLedaVoiceConfig()) {
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

describe('HttpLedaVoiceConfigReader', () => {
    it('performs an exact GET and validates a cloned envelope config', async () => {
        const config = createDefaultLedaVoiceConfig();
        config.effectIntensity = 42;
        const fetchMock = vi.fn(async () => response({ json: vi.fn(async () => envelope(config)) }));
        const signal = new AbortController().signal;
        const reader = new HttpLedaVoiceConfigReader('/api/leda/voice-config', fetchMock as typeof fetch);

        const result = await reader.readConfig(signal);

        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/leda/voice-config', {
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
        ['inherited config', Object.create({ config: createDefaultLedaVoiceConfig() })],
        ['flat body', createDefaultLedaVoiceConfig()],
    ])('rejects a %s response shape', async (_case, payload) => {
        const reader = new HttpLedaVoiceConfigReader(
            '/api/leda/voice-config',
            vi.fn(async () => response({ json: vi.fn(async () => payload) })) as typeof fetch,
        );

        await expect(reader.readConfig(new AbortController().signal)).rejects.toMatchObject({
            name: 'LedaVoiceConfigReadError',
            kind: 'validation',
        });
    });

    it('classifies HTTP, JSON, and domain validation failures', async () => {
        const httpReader = new HttpLedaVoiceConfigReader(
            '/api/leda/voice-config',
            vi.fn(async () => response({ ok: false, status: 503 })) as typeof fetch,
        );
        const jsonReader = new HttpLedaVoiceConfigReader(
            '/api/leda/voice-config',
            vi.fn(async () => response({ json: vi.fn(async () => { throw new SyntaxError('bad json'); }) })) as typeof fetch,
        );
        const domainReader = new HttpLedaVoiceConfigReader(
            '/api/leda/voice-config',
            vi.fn(async () => response({ json: vi.fn(async () => ({ config: { effectEnabled: true } })) })) as typeof fetch,
        );

        await expect(httpReader.readConfig(new AbortController().signal)).rejects.toMatchObject({ kind: 'http', statusCode: 503 });
        await expect(jsonReader.readConfig(new AbortController().signal)).rejects.toMatchObject({ kind: 'json' });
        await expect(domainReader.readConfig(new AbortController().signal)).rejects.toMatchObject({ kind: 'validation' });
    });
});

describe('HttpLedaVoiceConfigWriter', () => {
    it('validates and sends one complete PUT with the caller signal', async () => {
        const config = createDefaultLedaVoiceConfig();
        const signal = new AbortController().signal;
        const fetchMock = vi.fn(async () => response({ json: vi.fn(async () => envelope(config)) }));
        const writer = new HttpLedaVoiceConfigWriter('/api/leda/voice-config', fetchMock as typeof fetch);

        await writer.updateConfig(config, signal);

        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/leda/voice-config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(config),
            cache: 'no-store',
            signal,
        });
    });

    it('rejects an invalid request before fetch', async () => {
        const fetchMock = vi.fn();
        const writer = new HttpLedaVoiceConfigWriter('/api/leda/voice-config', fetchMock as typeof fetch);

        await expect(writer.updateConfig({ effectEnabled: true } as never)).rejects.toMatchObject({
            name: 'LedaVoiceConfigWriteError',
            kind: 'request-validation',
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        ['network loss', () => Promise.reject(new TypeError('Failed to fetch'))],
        ['response loss', () => Promise.resolve(response({ status: 204, json: vi.fn(async () => { throw new SyntaxError('lost'); }) }))],
        ['invalid envelope', () => Promise.resolve(response({ json: vi.fn(async () => ({ sync: {} })) }))],
    ])('confirms an ambiguous %s with one exact GET', async (_case, putResult) => {
        const config = createDefaultLedaVoiceConfig();
        const fetchMock = vi.fn()
            .mockImplementationOnce(putResult)
            .mockResolvedValueOnce(response({ json: vi.fn(async () => envelope(config)) }));
        const writer = new HttpLedaVoiceConfigWriter('/api/leda/voice-config', fetchMock as typeof fetch);

        await expect(writer.updateConfig(config)).resolves.toEqual(config);

        expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['PUT', 'GET']);
    });

    it('keeps the original ambiguity authoritative when confirmation differs', async () => {
        const sent = createDefaultLedaVoiceConfig();
        const different = createDefaultLedaVoiceConfig();
        different.effectIntensity = 12;
        const original = new TypeError('Failed to fetch');
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(original)
            .mockResolvedValueOnce(response({ json: vi.fn(async () => envelope(different)) }));
        const writer = new HttpLedaVoiceConfigWriter('/api/leda/voice-config', fetchMock as typeof fetch);

        await expect(writer.updateConfig(sent)).rejects.toBe(original);
    });

    it('does not confirm an aborted ambiguous write', async () => {
        const controller = new AbortController();
        const original = new DOMException('Aborted', 'AbortError');
        const fetchMock = vi.fn(async () => {
            controller.abort();
            throw original;
        });
        const writer = new HttpLedaVoiceConfigWriter('/api/leda/voice-config', fetchMock as typeof fetch);

        await expect(writer.updateConfig(createDefaultLedaVoiceConfig(), controller.signal)).rejects.toBe(original);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
