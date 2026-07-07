import { describe, expect, it } from 'vitest';
import type { InfoCardDisplayOptions } from '../domain/admin.types';
import { DEFAULT_INFO_CARD_TEXT_ALIGN, resolveInfoCardFields, resolveInfoCardTextAlign } from './infoCardDisplayOptions';

describe('resolveInfoCardFields', () => {
    it('maps legacy global help text into the first field label without dropping later fields', () => {
        const displayOptions: InfoCardDisplayOptions = {
            subtitle: 'Shift overview',
            helpText: 'Reviewed by QA',
            fields: [
                { id: 'field-1', label: 'Batch', value: 'B-204' },
                { id: 'field-2', label: 'Operator', value: 'Ada', helpText: 'Current owner' },
            ],
        };

        expect(resolveInfoCardFields(displayOptions)).toEqual([
            { id: 'field-1', label: 'Batch', value: 'B-204', helpText: 'Reviewed by QA' },
            { id: 'field-2', label: 'Operator', value: 'Ada', helpText: 'Current owner' },
        ]);
    });

    it('creates a fallback first group when only legacy global help text exists', () => {
        expect(resolveInfoCardFields({ fields: [], helpText: 'Read-only note' })).toEqual([
            { id: 'field-1', label: '', value: '', helpText: 'Read-only note' },
        ]);
    });

    it('defaults text alignment to centered compatibility unless explicitly configured', () => {
        expect(resolveInfoCardTextAlign(undefined)).toBe(DEFAULT_INFO_CARD_TEXT_ALIGN);
        expect(resolveInfoCardTextAlign({ fields: [] })).toBe(DEFAULT_INFO_CARD_TEXT_ALIGN);
        expect(resolveInfoCardTextAlign({ fields: [], textAlign: 'left' })).toBe('left');
    });

    it('falls back to centered compatibility for invalid persisted text alignment values', () => {
        expect(resolveInfoCardTextAlign({ fields: [], textAlign: 'bottom' as never })).toBe(DEFAULT_INFO_CARD_TEXT_ALIGN);
        expect(resolveInfoCardTextAlign({ fields: [], textAlign: '' as never })).toBe(DEFAULT_INFO_CARD_TEXT_ALIGN);
    });
});
