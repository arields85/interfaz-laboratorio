import { describe, expect, it } from 'vitest';

import { normalizeHmiName } from './hmiName';

describe('normalizeHmiName', () => {
    it('normalizes an ordinary display name without escaping plain text', () => {
        expect(normalizeHmiName('  Panel   recepción  ')).toBe('Panel recepción');
        expect(normalizeHmiName('<Panel> & bombas')).toBe('<Panel> & bombas');
    });

    it('rejects empty, non-text and nonprintable labels', () => {
        for (const value of [null, 42, '', '   ', 'a\tb', 'a\u0000b']) {
            expect(normalizeHmiName(value)).toBeNull();
        }
    });

    it('bounds display names by Unicode characters without truncation', () => {
        expect(normalizeHmiName('😀'.repeat(160))).toBe('😀'.repeat(160));
        expect(normalizeHmiName('😀'.repeat(161))).toBeNull();
    });
});
