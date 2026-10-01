import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabFrameIconPlacement } from './useTabFrameIconPlacement';

const BASE_TOKENS: Record<string, string> = {
    '--tab-frame-height': '25px',
    '--tab-frame-body-cut': '0px',
    '--tab-frame-icon-right': '0px',
    '--tab-frame-icon-gap': '4px',
    '--tab-frame-icon-clearance': '3px',
    '--tab-frame-icon-min-top': '0px',
    '--tab-frame-icon-tab-gap': '8px',
    '--tab-frame-icon-scale': '0.9',
};

describe('useTabFrameIconPlacement', () => {
    let tokens: Record<string, string>;

    beforeEach(() => {
        tokens = { ...BASE_TOKENS };
        // jsdom resolves no custom properties: the tokens the hook reads come from this stand-in.
        vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
            getPropertyValue: (name: string) => tokens[name] ?? '',
            fontSize: '16px',
        }) as unknown as CSSStyleDeclaration);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.documentElement.removeAttribute('style');
    });

    it('is null while the tab shape is inactive', () => {
        const ref = { current: document.createElement('div') };

        const { result } = renderHook(() => useTabFrameIconPlacement(ref, false));

        expect(result.current).toBeNull();
    });

    it('measures the placement from the tokens once active', () => {
        const ref = { current: document.createElement('div') };

        const { result } = renderHook(() => useTabFrameIconPlacement(ref, true));

        // No body chamfer: the icon cannot fit under the tab, so it sits in the strip at the top edge.
        expect(result.current).toEqual({ top: 0, right: 0, inStrip: true, reserve: 29.6 });
    });

    it('re-measures when the document style changes (a theme preview rewrites the frame tokens there)', async () => {
        const ref = { current: document.createElement('div') };
        const { result } = renderHook(() => useTabFrameIconPlacement(ref, true));
        expect(result.current?.inStrip).toBe(true);

        tokens['--tab-frame-body-cut'] = '100px';
        document.documentElement.style.setProperty('--tab-frame-body-cut', '100px');

        // A large chamfer lets the icon sit just below the body top line (tab height 25 + gap 4).
        await waitFor(() => expect(result.current).toEqual({ top: 29, right: 0, inStrip: false, reserve: 100 }));
    });

    it('re-measures when the effective tab height changes', () => {
        tokens['--tab-frame-body-cut'] = '100px';
        const ref = { current: document.createElement('div') };
        const { result, rerender } = renderHook(
            ({ tabHeight }: { tabHeight?: number }) => useTabFrameIconPlacement(ref, true, tabHeight),
            { initialProps: {} as { tabHeight?: number } },
        );
        expect(result.current?.top).toBe(29);

        rerender({ tabHeight: 40 });

        expect(result.current?.top).toBe(44);
    });
});
