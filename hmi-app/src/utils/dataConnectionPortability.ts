import {
    DATA_CONNECTION_FILE_FORMAT,
    DATA_CONNECTION_FILE_SCHEMA_VERSION,
    type DataConnectionFileV1,
    type DataConnectionValidationResult,
    type DataConnectionValues,
} from '../domain';
import { validateDataConnectionValues } from './dataConnectionValidation';
import { formatPortableTimestamp } from './portableFile';

// =============================================================================
// Data connection portability
// Builds and strictly parses the portable connection file. Messages are shown
// to the user, so they are in Spanish (usted).
// =============================================================================

const FILE_KEYS = ['format', 'schemaVersion', 'exportedAt', 'connection'] as const;
const CONNECTION_KEYS: ReadonlyArray<keyof DataConnectionValues> = [
    'baseUrl',
    'endpoint',
    'historyEndpoint',
    'activitySeriesEndpoint',
];

const FORMAT_MESSAGE = 'El archivo no tiene el formato de conexión de la HMI.';

export interface DataConnectionExport {
    fileName: string;
    json: string;
}

export function buildDataConnectionFileName(exportedAt: Date = new Date()): string {
    return `interfaz-laboratorio-connection-${formatPortableTimestamp(exportedAt)}.json`;
}

export function buildDataConnectionExport(
    values: DataConnectionValues,
    exportedAt: Date = new Date(),
): DataConnectionExport {
    const file: DataConnectionFileV1 = {
        format: DATA_CONNECTION_FILE_FORMAT,
        schemaVersion: DATA_CONNECTION_FILE_SCHEMA_VERSION,
        exportedAt: exportedAt.toISOString(),
        connection: {
            baseUrl: values.baseUrl,
            endpoint: values.endpoint,
            historyEndpoint: values.historyEndpoint,
            activitySeriesEndpoint: values.activitySeriesEndpoint,
        },
    };

    return {
        fileName: buildDataConnectionFileName(exportedAt),
        json: JSON.stringify(file, null, 2),
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): DataConnectionValidationResult {
    return { ok: false, message };
}

export function parseDataConnectionFile(json: string): DataConnectionValidationResult {
    let parsed: unknown;

    try {
        parsed = JSON.parse(json);
    } catch {
        return fail('El archivo no es un JSON válido.');
    }

    if (!isRecord(parsed) || parsed.format !== DATA_CONNECTION_FILE_FORMAT) {
        return fail(FORMAT_MESSAGE);
    }

    if (parsed.schemaVersion !== DATA_CONNECTION_FILE_SCHEMA_VERSION) {
        return fail(`La versión del archivo (${String(parsed.schemaVersion)}) no es compatible.`);
    }

    if (typeof parsed.exportedAt !== 'string' || !isRecord(parsed.connection)) {
        return fail(FORMAT_MESSAGE);
    }

    const unexpected = [
        ...Object.keys(parsed).filter((key) => !(FILE_KEYS as readonly string[]).includes(key)),
        ...Object.keys(parsed.connection)
            .filter((key) => !(CONNECTION_KEYS as readonly string[]).includes(key))
            .map((key) => `connection.${key}`),
    ];

    if (unexpected.length > 0) {
        return fail(`El archivo contiene campos no esperados: ${unexpected.join(', ')}.`);
    }

    const connection = parsed.connection;

    for (const key of CONNECTION_KEYS) {
        if (!(key in connection)) {
            return fail(`Falta el campo "${key}" de la conexión.`);
        }

        if (typeof connection[key] !== 'string') {
            return fail(`El campo "${key}" de la conexión debe ser texto.`);
        }
    }

    return validateDataConnectionValues({
        baseUrl: connection.baseUrl as string,
        endpoint: connection.endpoint as string,
        historyEndpoint: connection.historyEndpoint as string,
        activitySeriesEndpoint: connection.activitySeriesEndpoint as string,
    });
}
