import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTabFrameWidths } from './useTabFrameWidths';

describe('useTabFrameWidths', () => {
    it('starts empty', () => {
        const { result } = renderHook(() => useTabFrameWidths());

        expect(result.current.widths).toEqual({});
    });

    it('stores the width reported for each widget', () => {
        const { result } = renderHook(() => useTabFrameWidths());

        act(() => {
            result.current.reporterFor('a')(180);
            result.current.reporterFor('b')(96);
        });

        expect(result.current.widths).toEqual({ a: 180, b: 96 });
    });

    it('removes the entry when a widget reports null (frame back to standard or unmounted)', () => {
        const { result } = renderHook(() => useTabFrameWidths());

        act(() => result.current.reporterFor('a')(180));
        act(() => result.current.reporterFor('a')(null));

        expect(result.current.widths).toEqual({});
    });

    it('hands out one stable reporter per widget id and keeps the state object when nothing changes', () => {
        const { result } = renderHook(() => useTabFrameWidths());
        const first = result.current.reporterFor('a');

        act(() => first(180));
        const snapshot = result.current.widths;

        act(() => result.current.reporterFor('a')(180));
        act(() => result.current.reporterFor('missing')(null));

        expect(result.current.reporterFor('a')).toBe(first);
        expect(result.current.widths).toBe(snapshot);
    });
});
