import { describe, expect, it } from 'vitest';

import {
    COPY_REGISTERS,
    DEFAULT_COPY_REGISTER,
    parseCopyRegister,
    serializeCopyRegister,
} from './copyRegister';

describe('copy register', () => {
    it('lists the three registers with usted as the default', () => {
        expect(COPY_REGISTERS).toEqual(['usted', 'rioplatense', 'neutro']);
        expect(DEFAULT_COPY_REGISTER).toBe('usted');
    });

    it('round-trips every register through its stored shape', () => {
        for (const register of COPY_REGISTERS) {
            expect(serializeCopyRegister(register)).toBe(JSON.stringify({ version: 1, register }));
            expect(parseCopyRegister(serializeCopyRegister(register))).toBe(register);
        }
    });

    it('falls back to usted for a missing, malformed or unknown value', () => {
        const invalid: Array<string | null> = [
            null,
            '',
            '{',
            'null',
            '[]',
            '"neutro"',
            JSON.stringify({ version: 1, register: 'voseo' }),
            JSON.stringify({ version: 1, register: 'Neutro' }),
            JSON.stringify({ version: 1, register: null }),
            JSON.stringify({ version: 2, register: 'neutro' }),
            JSON.stringify({ version: '1', register: 'neutro' }),
            JSON.stringify({ register: 'neutro' }),
            JSON.stringify({ version: 1 }),
            JSON.stringify({ version: 1, register: 'neutro', extra: true }),
        ];
        for (const raw of invalid) {
            expect(parseCopyRegister(raw), String(raw)).toBe('usted');
        }
    });
});
