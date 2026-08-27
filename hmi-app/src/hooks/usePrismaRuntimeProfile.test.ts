import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
    PRISMA_RUNTIME_MODE_STORAGE_KEY,
    savePrismaRuntimeMode,
} from '../config/prismaRuntime.config';
import { usePrismaRuntimeProfile } from './usePrismaRuntimeProfile';
describe('usePrismaRuntimeProfile', () => {
    afterEach(() => {
        localStorage.clear();
    });
    it('reacts immediately when the persisted profile is restored to central mode', async () => {
        localStorage.setItem(PRISMA_RUNTIME_MODE_STORAGE_KEY, 'local');
        const { result } = renderHook(() => usePrismaRuntimeProfile());

        expect(result.current.mode).toBe('local');
        const initialRevision = result.current.revision;
        act(() => savePrismaRuntimeMode('central'));

        await waitFor(() => expect(result.current.mode).toBe('central'));
        expect(result.current.isTemporaryOverride).toBe(false);
        expect(result.current.revision).toBeGreaterThan(initialRevision);
    });
    it('keeps a temporary local query override reactive while preserving the saved central mode', async () => {
        localStorage.setItem(PRISMA_RUNTIME_MODE_STORAGE_KEY, 'central');
        const { result, rerender } = renderHook(
            ({ search }) => usePrismaRuntimeProfile(search),
            { initialProps: { search: '?prismaMode=local' } },
        );

        expect(result.current).toMatchObject({ mode: 'local', isTemporaryOverride: true });
        act(() => rerender({ search: '' }));

        await waitFor(() => expect(result.current.mode).toBe('central'));
        expect(result.current.isTemporaryOverride).toBe(false);
        expect(localStorage.getItem(PRISMA_RUNTIME_MODE_STORAGE_KEY)).toBe('central');
    });
});
