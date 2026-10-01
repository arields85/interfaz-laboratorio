// Portable file format for the HMI data connection settings (base URL + endpoints).
// Pure types and constants: parsing/validation lives in utils/dataConnectionPortability.ts.

export const DATA_CONNECTION_FILE_FORMAT = 'interfaz-laboratorio-data-connection';
export const DATA_CONNECTION_FILE_SCHEMA_VERSION = 1;

export interface DataConnectionValues {
    baseUrl: string;
    endpoint: string;
    historyEndpoint: string;
    activitySeriesEndpoint: string;
}

export interface DataConnectionFileV1 {
    format: typeof DATA_CONNECTION_FILE_FORMAT;
    schemaVersion: typeof DATA_CONNECTION_FILE_SCHEMA_VERSION;
    exportedAt: string;
    connection: DataConnectionValues;
}

export type DataConnectionValidationResult =
    | { ok: true; values: DataConnectionValues }
    | { ok: false; message: string };
