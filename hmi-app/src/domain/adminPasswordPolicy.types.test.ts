import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    MAX_ADMIN_PASSWORD_BYTES,
    MIN_ADMIN_PASSWORD_CHARACTERS,
    validateAdminPasswordChange,
} from './adminPasswordPolicy.types';

const CURRENT = 'correct horse battery staple';
const NEXT = 'a different durable passphrase';

function change(overrides: Partial<{ current: string; next: string; confirmation: string }> = {}) {
    return validateAdminPasswordChange({ current: CURRENT, next: NEXT, confirmation: NEXT, ...overrides });
}

describe('admin password policy', () => {
    it('keeps its bounds identical to the runtime policy', () => {
        const here = path.dirname(fileURLToPath(import.meta.url));
        const runtime = path.resolve(here, '../../../services/leda-runtime/src/leda_runtime');
        const auth = readFileSync(path.join(runtime, 'admin_auth.py'), 'utf-8');
        const constant = (name: string) => Number(new RegExp(`^${name} = (\\d+)$`, 'm').exec(auth)?.[1]);

        expect(MIN_ADMIN_PASSWORD_CHARACTERS).toBe(constant('MIN_PASSWORD_CHARACTERS'));
        expect(MAX_ADMIN_PASSWORD_BYTES).toBe(constant('MAX_PASSWORD_BYTES'));
    });

    it('accepts a well-formed change', () => {
        expect(change()).toBeNull();
    });

    it('requires the current password', () => {
        expect(change({ current: '' })).toBe('CURRENT_REQUIRED');
    });

    it('counts the minimum in characters, not UTF-16 units', () => {
        const atMinimum = 'x'.repeat(MIN_ADMIN_PASSWORD_CHARACTERS);
        expect(change({ next: atMinimum, confirmation: atMinimum })).toBeNull();
        const short = 'x'.repeat(MIN_ADMIN_PASSWORD_CHARACTERS - 1);
        expect(change({ next: short, confirmation: short })).toBe('NEW_TOO_SHORT');
        const emoji = '\u{1F512}'.repeat(MIN_ADMIN_PASSWORD_CHARACTERS);
        expect(change({ next: emoji, confirmation: emoji })).toBeNull();
    });

    it('sets the minimum at 10 characters', () => {
        expect(MIN_ADMIN_PASSWORD_CHARACTERS).toBe(10);
        expect(change({ next: 'x'.repeat(10), confirmation: 'x'.repeat(10) })).toBeNull();
        expect(change({ next: 'x'.repeat(9), confirmation: 'x'.repeat(9) })).toBe('NEW_TOO_SHORT');
    });

    it('counts the maximum in UTF-8 bytes', () => {
        const atMaximum = 'x'.repeat(MAX_ADMIN_PASSWORD_BYTES);
        expect(change({ next: atMaximum, confirmation: atMaximum })).toBeNull();
        const over = 'x'.repeat(MAX_ADMIN_PASSWORD_BYTES + 1);
        expect(change({ next: over, confirmation: over })).toBe('NEW_TOO_LARGE');
        const accented = 'é'.repeat(MAX_ADMIN_PASSWORD_BYTES / 2 + 1);
        expect(change({ next: accented, confirmation: accented })).toBe('NEW_TOO_LARGE');
    });

    it('requires the confirmation to match and the password to change', () => {
        expect(change({ confirmation: `${NEXT}!` })).toBe('CONFIRMATION_MISMATCH');
        expect(change({ next: CURRENT, confirmation: CURRENT })).toBe('NEW_UNCHANGED');
    });

    it('reports the policy before the confirmation', () => {
        expect(change({ next: 'short', confirmation: 'other' })).toBe('NEW_TOO_SHORT');
    });
});
