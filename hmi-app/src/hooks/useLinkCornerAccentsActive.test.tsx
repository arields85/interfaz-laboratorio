import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useLinkCornerAccentsActive } from './useLinkCornerAccentsActive';
import { previewLinkCornerAccents, resetLinkCornerAccentsOnDocument } from '../services/linkCornerAccents.service';
import { useThemeStylePresetStore } from '../store/themeStylePreset.store';

describe('useLinkCornerAccentsActive', () => {
    afterEach(() => {
        resetLinkCornerAccentsOnDocument();
        useThemeStylePresetStore.getState().setClassic(true);
    });

    it('is off by default', () => {
        expect(renderHook(() => useLinkCornerAccentsActive()).result.current).toBe(false);
    });

    it('is on with the setting on and Clasico active', () => {
        previewLinkCornerAccents(true);

        expect(renderHook(() => useLinkCornerAccentsActive()).result.current).toBe(true);
    });

    it('is off with the setting on but another preset active', () => {
        previewLinkCornerAccents(true);
        useThemeStylePresetStore.getState().setClassic(false);

        expect(renderHook(() => useLinkCornerAccentsActive()).result.current).toBe(false);
    });

    it('follows live changes of the setting and of the preset', () => {
        const { result } = renderHook(() => useLinkCornerAccentsActive());

        act(() => previewLinkCornerAccents(true));
        expect(result.current).toBe(true);

        act(() => useThemeStylePresetStore.getState().setClassic(false));
        expect(result.current).toBe(false);

        act(() => useThemeStylePresetStore.getState().setClassic(true));
        expect(result.current).toBe(true);

        act(() => previewLinkCornerAccents(false));
        expect(result.current).toBe(false);
    });
});
