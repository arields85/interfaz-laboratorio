import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabFrameHeight } from './useTabFrameHeight';

const BASE_TOKENS: Record<string, string> = {
    '--tab-frame-height': '25px',
    '--tab-frame-tab-cut': '19px',
    '--tab-frame-body-cut': '0px',
    '--tab-frame-title-pad-y': '4.25px',
};

describe('useTabFrameHeight', () => {
    let tokens: Record<string, string>;

    beforeEach(() => {
        tokens = { ...BASE_TOKENS };
        // jsdom resolves no custom properties: the tokens the hook reads come from this stand-in.
        vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
            getPropertyValue: (name: string) => tokens[name] ?? '',
            borderTopLeftRadius: '4px',
            fontSize: '16px',
        }) as unknown as CSSStyleDeclaration);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.documentElement.removeAttribute('style');
    });

    it('is null for a title without its own size (the token applies untouched)', () => {
        const frameRef = { current: document.createElement('div') };

        const { result } = renderHook(() => useTabFrameHeight(undefined, frameRef));

        expect(result.current).toBeNull();
    });

    it('measures the tab for the title line box plus the breathing space above and below', () => {
        const frameRef = { current: document.createElement('div') };

        const { result } = renderHook(() => useTabFrameHeight(40, frameRef));

        // 40 x 1.1 line height + 2 x 4.25.
        expect(result.current?.height).toBe(52.5);
    });

    it('re-measures when the document style changes (a theme preview rewrites the frame tokens there)', async () => {
        const frameRef = { current: document.createElement('div') };
        const { result } = renderHook(() => useTabFrameHeight(40, frameRef));
        expect(result.current?.height).toBe(52.5);

        tokens['--tab-frame-title-pad-y'] = '10px';
        document.documentElement.style.setProperty('--tab-frame-title-pad-y', '10px');

        await waitFor(() => expect(result.current?.height).toBe(64));
    });
});
