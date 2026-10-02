import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sharedConfigStorage } from './sharedConfigStorage.service';
import { COPY_REGISTER_STORAGE_KEY, readCopyRegister, saveCopyRegister } from './copyRegister.service';

describe('copy register persistence', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('uses the shared configuration key', () => {
        expect(COPY_REGISTER_STORAGE_KEY).toBe('hmi:copy-register');
    });

    it('reads usted when nothing is stored, without writing a default', () => {
        const setItem = vi.spyOn(sharedConfigStorage, 'setItem');
        expect(readCopyRegister()).toBe('usted');
        expect(setItem).not.toHaveBeenCalled();
    });

    it('writes the versioned JSON shape and reads it back', () => {
        saveCopyRegister('rioplatense');
        expect(localStorage.getItem('hmi:copy-register')).toBe(
            JSON.stringify({ version: 1, register: 'rioplatense' }),
        );
        expect(readCopyRegister()).toBe('rioplatense');
    });

    it('reads usted for a corrupt stored value', () => {
        localStorage.setItem('hmi:copy-register', '{');
        expect(readCopyRegister()).toBe('usted');
    });

    it('reads usted when storage is unavailable', () => {
        vi.spyOn(sharedConfigStorage, 'getItem').mockImplementation(() => { throw new Error('storage'); });
        expect(readCopyRegister()).toBe('usted');
    });
});
