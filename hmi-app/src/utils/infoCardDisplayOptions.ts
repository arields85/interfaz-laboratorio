import type { InfoCardDisplayOptions, InfoCardField } from '../domain/admin.types';

export const DEFAULT_INFO_CARD_VALUE_FONT_SIZE = 35;

function isInfoCardField(value: unknown): value is InfoCardField {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as Partial<InfoCardField>;

    return typeof candidate.id === 'string'
        && typeof candidate.label === 'string'
        && (candidate.value === undefined || typeof candidate.value === 'string');
}

export function resolveInfoCardFields(displayOptions: InfoCardDisplayOptions | undefined): InfoCardField[] {
    const candidateFields = (displayOptions as { fields?: unknown } | undefined)?.fields;

    return Array.isArray(candidateFields)
        ? candidateFields.filter(isInfoCardField)
        : [];
}
