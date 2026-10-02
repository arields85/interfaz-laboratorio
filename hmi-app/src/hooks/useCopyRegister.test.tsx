import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { COPY_REGISTER_STORAGE_KEY, saveCopyRegister } from '../services/copyRegister.service';
import { localStorageSharedConfig } from '../test/localStorageSharedConfig';
import { useCopyRegister } from './useCopyRegister';

describe('useCopyRegister', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns usted when nothing is configured', () => {
        const { result } = renderHook(() => useCopyRegister());
        expect(result.current).toBe('usted');
    });

    it('returns the stored register on first render', () => {
        saveCopyRegister('neutro');
        const { result } = renderHook(() => useCopyRegister());
        expect(result.current).toBe('neutro');
    });

    it('updates when another browser changes the shared register', () => {
        const { result } = renderHook(() => useCopyRegister());

        act(() => {
            saveCopyRegister('rioplatense');
            localStorageSharedConfig.emitChange([COPY_REGISTER_STORAGE_KEY]);
        });

        expect(result.current).toBe('rioplatense');
    });

    it('falls back to usted when the shared value becomes invalid', () => {
        saveCopyRegister('neutro');
        const { result } = renderHook(() => useCopyRegister());

        act(() => {
            localStorage.setItem(COPY_REGISTER_STORAGE_KEY, '{"version":1,"register":"voseo"}');
            localStorageSharedConfig.emitChange([COPY_REGISTER_STORAGE_KEY]);
        });

        expect(result.current).toBe('usted');
    });
});
