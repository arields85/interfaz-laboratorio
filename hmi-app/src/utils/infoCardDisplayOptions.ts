import type { InfoCardDisplayOptions, InfoCardField, TextAlign } from '../domain/admin.types';

export const DEFAULT_WIDGET_VALUE_FONT_SIZE = 35;
export const DEFAULT_INFO_CARD_VALUE_FONT_SIZE = DEFAULT_WIDGET_VALUE_FONT_SIZE;
export const DEFAULT_INFO_CARD_TEXT_ALIGN: TextAlign = 'center';

const INFO_CARD_TEXT_ALIGN_VALUES: readonly TextAlign[] = ['left', 'center', 'right'];

const DEFAULT_INFO_CARD_FIELD_ID = 'field-1';

export interface InfoCardFieldContentAliases {
    text: string | undefined;
    subtext: string;
    tag: string | undefined;
}

/**
 * Product semantics for persisted info-card fields.
 * Storage must remain `value/label/helpText` for dashboard compatibility.
 */
export function resolveInfoCardFieldContent(field: InfoCardField): InfoCardFieldContentAliases {
    return {
        text: field.value,
        subtext: field.label,
        tag: field.helpText,
    };
}

function resolveLegacyInfoCardHelpText(displayOptions: InfoCardDisplayOptions | undefined): string | undefined {
    const helpText = displayOptions?.helpText?.trim() ?? '';

    return helpText === '' ? undefined : helpText;
}

function isInfoCardField(value: unknown): value is InfoCardField {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as Partial<InfoCardField>;

    return typeof candidate.id === 'string'
        && typeof candidate.label === 'string'
        && (candidate.value === undefined || typeof candidate.value === 'string')
        && (candidate.helpText === undefined || typeof candidate.helpText === 'string');
}

export function resolveInfoCardFields(displayOptions: InfoCardDisplayOptions | undefined): InfoCardField[] {
    const candidateFields = (displayOptions as { fields?: unknown } | undefined)?.fields;
    // Legacy dashboards stored a global `displayOptions.helpText`.
    // Runtime semantics now treat that value as the first field's Etiqueta.
    const legacyFirstFieldTag = resolveLegacyInfoCardHelpText(displayOptions);

    const normalizedFields = Array.isArray(candidateFields)
        ? candidateFields.filter(isInfoCardField).map(field => ({ ...field }))
        : [];

    if (normalizedFields.length === 0) {
        return legacyFirstFieldTag
            ? [{ id: DEFAULT_INFO_CARD_FIELD_ID, label: '', value: '', helpText: legacyFirstFieldTag }]
            : [];
    }

    if (legacyFirstFieldTag && normalizedFields[0].helpText === undefined) {
        normalizedFields[0] = {
            ...normalizedFields[0],
            helpText: legacyFirstFieldTag,
        };
    }

    return normalizedFields;
}

export function resolveInfoCardTextAlign(displayOptions: InfoCardDisplayOptions | undefined): TextAlign {
    const textAlign = (displayOptions as { textAlign?: unknown } | undefined)?.textAlign;

    return INFO_CARD_TEXT_ALIGN_VALUES.includes(textAlign as TextAlign)
        ? textAlign as TextAlign
        : DEFAULT_INFO_CARD_TEXT_ALIGN;
}
