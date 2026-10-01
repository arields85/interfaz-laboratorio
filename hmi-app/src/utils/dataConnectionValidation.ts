import type { DataConnectionValidationResult, DataConnectionValues } from '../domain';

// =============================================================================
// Data connection validation
// Single source of truth for what a valid set of connection values looks like.
// Used by the Connection tab export and import (and reusable for manual entry).
// =============================================================================

type EndpointField = Exclude<keyof DataConnectionValues, 'baseUrl'>;

const ENDPOINT_FIELD_LABELS: Record<EndpointField, { name: string; optional: boolean }> = {
    endpoint: { name: 'El endpoint snapshot', optional: false },
    historyEndpoint: { name: 'El endpoint histórico', optional: true },
    activitySeriesEndpoint: { name: 'El endpoint activity-series', optional: true },
};

const BASE_URL_INVALID_MESSAGE = 'La URL base debe ser una URL absoluta http o https.';

function isAbsoluteHttpUrl(value: string): boolean {
    if (/\s/.test(value)) {
        return false;
    }

    try {
        const parsed = new URL(value);

        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
    } catch {
        return false;
    }
}

// A path starts with a single "/" (a "//" prefix would be a protocol-relative URL)
// and contains no whitespace.
function isPath(value: string): boolean {
    return /^\/(?!\/)\S*$/.test(value);
}

export function validateDataConnectionValues(values: DataConnectionValues): DataConnectionValidationResult {
    const baseUrl = values.baseUrl.trim();

    if (baseUrl === '') {
        return { ok: false, message: 'La URL base es obligatoria.' };
    }

    if (!isAbsoluteHttpUrl(baseUrl)) {
        return { ok: false, message: BASE_URL_INVALID_MESSAGE };
    }

    const normalized: DataConnectionValues = { ...values, baseUrl };

    for (const field of Object.keys(ENDPOINT_FIELD_LABELS) as EndpointField[]) {
        const { name, optional } = ENDPOINT_FIELD_LABELS[field];
        const value = values[field].trim();

        if (value === '' && !optional) {
            return { ok: false, message: `${name} es obligatorio.` };
        }

        if (value !== '' && !isPath(value)) {
            return { ok: false, message: `${name} debe ser una ruta que comience con "/".` };
        }

        normalized[field] = value;
    }

    return { ok: true, values: normalized };
}
