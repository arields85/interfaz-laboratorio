import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { localStorageSharedConfig } from '../test/localStorageSharedConfig';
import { useSharedConfigVersion } from './useSharedConfigVersion';

const KEYS = ['hmi:a', 'hmi:b'] as const;

describe('useSharedConfigVersion', () => {
    it('starts at zero and counts remote changes that touch the watched keys', () => {
        const { result } = renderHook(() => useSharedConfigVersion(KEYS));
        expect(result.current).toBe(0);

        act(() => localStorageSharedConfig.emitChange(['hmi:b', 'hmi:other']));
        expect(result.current).toBe(1);

        act(() => localStorageSharedConfig.emitChange(['hmi:a']));
        expect(result.current).toBe(2);
    });

    it('ignores changes to other keys', () => {
        const { result } = renderHook(() => useSharedConfigVersion(KEYS));

        act(() => localStorageSharedConfig.emitChange(['hmi:unrelated']));

        expect(result.current).toBe(0);
    });

    it('unsubscribes on unmount', () => {
        const { result, unmount } = renderHook(() => useSharedConfigVersion(KEYS));
        unmount();

        act(() => localStorageSharedConfig.emitChange(['hmi:a']));

        expect(result.current).toBe(0);
    });
});
