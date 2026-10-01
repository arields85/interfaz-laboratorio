import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TAB_FRAME_TITLE_HIDDEN } from '../utils/tabFramePath';
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

    it('keeps the hidden-title sentinel as a present entry: the frame is still the tab shape, only without the title tab', () => {
        const { result } = renderHook(() => useTabFrameWidths());

        act(() => result.current.reporterFor('a')(TAB_FRAME_TITLE_HIDDEN, 25));

        expect(result.current.widths).toEqual({ a: TAB_FRAME_TITLE_HIDDEN });
        expect(result.current.heights).toEqual({ a: 25 });
    });

    it('removes the entry when a widget reports null (frame back to standard or unmounted)', () => {
        const { result } = renderHook(() => useTabFrameWidths());

        act(() => result.current.reporterFor('a')(180));
        act(() => result.current.reporterFor('a')(null));

        expect(result.current.widths).toEqual({});
    });

    it('stores the tab height next to the width, only for the widgets that report one (a taller tab)', () => {
        const { result } = renderHook(() => useTabFrameWidths());

        expect(result.current.heights).toEqual({});

        act(() => {
            result.current.reporterFor('a')(180, 47);
            result.current.reporterFor('b')(96);
        });

        expect(result.current.widths).toEqual({ a: 180, b: 96 });
        expect(result.current.heights).toEqual({ a: 47 });
    });

    it('drops the height when the widget stops reporting one or leaves the tab shape', () => {
        const { result } = renderHook(() => useTabFrameWidths());

        act(() => result.current.reporterFor('a')(180, 47));
        act(() => result.current.reporterFor('a')(180));
        expect(result.current.heights).toEqual({});

        act(() => result.current.reporterFor('a')(180, 47));
        act(() => result.current.reporterFor('a')(null));
        expect(result.current.widths).toEqual({});
        expect(result.current.heights).toEqual({});
    });

    it('follows a height change and keeps the state objects when nothing changes', () => {
        const { result } = renderHook(() => useTabFrameWidths());

        act(() => result.current.reporterFor('a')(180, 47));
        const heights = result.current.heights;
        act(() => result.current.reporterFor('a')(180, 47));
        expect(result.current.heights).toBe(heights);

        act(() => result.current.reporterFor('a')(180, 74.5));
        expect(result.current.heights).toEqual({ a: 74.5 });
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
