import { describe, expect, it } from 'vitest';

import {
    buildDataConnectionExport,
    buildDataConnectionFileName,
    parseDataConnectionFile,
} from './dataConnectionPortability';

const VALUES = {
    baseUrl: 'https://node-red.local:1880',
    endpoint: '/api/hmi-data',
    historyEndpoint: '/api/hmi-data/history',
    activitySeriesEndpoint: '/api/hmi-data/activity-series',
};

const FORMAT_MESSAGE = 'El archivo no tiene el formato de conexión de la HMI.';

function fileWith(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        format: 'interfaz-laboratorio-data-connection',
        schemaVersion: 1,
        exportedAt: '2026-10-01T12:00:00.000Z',
        connection: VALUES,
        ...overrides,
    });
}

describe('buildDataConnectionExport', () => {
    it('serializes the format marker, version and the four values', () => {
        const result = buildDataConnectionExport(VALUES, new Date('2026-10-01T12:34:00.000Z'));

        expect(JSON.parse(result.json)).toEqual({
            format: 'interfaz-laboratorio-data-connection',
            schemaVersion: 1,
            exportedAt: '2026-10-01T12:34:00.000Z',
            connection: VALUES,
        });
        expect(result.fileName).toBe('interfaz-laboratorio-connection-20261001-1234.json');
    });

    it('builds the file name with the same timestamp convention as dashboard exports', () => {
        expect(buildDataConnectionFileName(new Date('2026-01-02T03:04:00.000Z'))).toBe(
            'interfaz-laboratorio-connection-20260102-0304.json',
        );
    });
});

describe('parseDataConnectionFile', () => {
    it('round-trips an exported file', () => {
        const { json } = buildDataConnectionExport(VALUES);

        expect(parseDataConnectionFile(json)).toEqual({ ok: true, values: VALUES });
    });

    it('rejects text that is not JSON', () => {
        expect(parseDataConnectionFile('{nope')).toEqual({
            ok: false,
            message: 'El archivo no es un JSON válido.',
        });
    });

    it.each([
        ['an array', '[]'],
        ['null', 'null'],
        ['a string', '"x"'],
    ])('rejects %s at the root', (_name, json) => {
        expect(parseDataConnectionFile(json)).toEqual({ ok: false, message: FORMAT_MESSAGE });
    });

    it('rejects a wrong format marker', () => {
        expect(parseDataConnectionFile(fileWith({ format: 'other' }))).toEqual({ ok: false, message: FORMAT_MESSAGE });
    });

    it('rejects an unsupported version', () => {
        expect(parseDataConnectionFile(fileWith({ schemaVersion: 2 }))).toEqual({
            ok: false,
            message: 'La versión del archivo (2) no es compatible.',
        });
    });

    it('rejects a non-string exportedAt', () => {
        expect(parseDataConnectionFile(fileWith({ exportedAt: 5 }))).toEqual({ ok: false, message: FORMAT_MESSAGE });
    });

    it('rejects unexpected top-level fields', () => {
        expect(parseDataConnectionFile(fileWith({ extra: true }))).toEqual({
            ok: false,
            message: 'El archivo contiene campos no esperados: extra.',
        });
    });

    it('rejects a missing connection block', () => {
        expect(parseDataConnectionFile(fileWith({ connection: undefined }))).toEqual({ ok: false, message: FORMAT_MESSAGE });
    });

    it('rejects missing connection fields', () => {
        const partial: Record<string, string> = { ...VALUES };
        delete partial.endpoint;

        expect(parseDataConnectionFile(fileWith({ connection: partial }))).toEqual({
            ok: false,
            message: 'Falta el campo "endpoint" de la conexión.',
        });
    });

    it('rejects unexpected connection fields', () => {
        expect(parseDataConnectionFile(fileWith({ connection: { ...VALUES, token: 'x' } }))).toEqual({
            ok: false,
            message: 'El archivo contiene campos no esperados: connection.token.',
        });
    });

    it('rejects non-string connection values', () => {
        expect(parseDataConnectionFile(fileWith({ connection: { ...VALUES, baseUrl: 5 } }))).toEqual({
            ok: false,
            message: 'El campo "baseUrl" de la conexión debe ser texto.',
        });
    });

    it('applies the shared validation to the values', () => {
        expect(parseDataConnectionFile(fileWith({ connection: { ...VALUES, baseUrl: 'node-red.local' } }))).toEqual({
            ok: false,
            message: 'La URL base debe ser una URL absoluta http o https.',
        });
        expect(parseDataConnectionFile(fileWith({ connection: { ...VALUES, endpoint: 'api' } })).ok).toBe(false);
    });
});
