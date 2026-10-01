import { act, fireEvent, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { isHiddenAccessRevealed } from '../services/hiddenAccess.service';
import { useHiddenAccess } from './useHiddenAccess';
import { useHiddenAccessShortcut } from './useHiddenAccessShortcut';

const COMBINATION = { code: 'KeyA', key: 'a', ctrlKey: true, altKey: true } as const;

function renderShortcut() {
    return renderHook(() => {
        useHiddenAccessShortcut();
        return useHiddenAccess();
    });
}

describe('useHiddenAccessShortcut', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('toggles the flag with Ctrl+Alt+A and reflects it in the hook', () => {
        const { result } = renderShortcut();
        expect(result.current).toBe(false);

        act(() => { fireEvent.keyDown(document.body, COMBINATION); });
        expect(result.current).toBe(true);
        expect(isHiddenAccessRevealed()).toBe(true);

        act(() => { fireEvent.keyDown(document.body, COMBINATION); });
        expect(result.current).toBe(false);
        expect(isHiddenAccessRevealed()).toBe(false);
    });

    it('ignores other combinations', () => {
        renderShortcut();

        for (const init of [
            { code: 'KeyA', key: 'a' },
            { code: 'KeyA', key: 'a', ctrlKey: true },
            { code: 'KeyA', key: 'a', altKey: true },
            { code: 'KeyA', key: 'a', ctrlKey: true, altKey: true, shiftKey: true },
            { code: 'KeyA', key: 'a', ctrlKey: true, altKey: true, metaKey: true },
            { code: 'KeyB', key: 'b', ctrlKey: true, altKey: true },
            { code: 'KeyZ', key: 'z', ctrlKey: true },
        ]) {
            act(() => { fireEvent.keyDown(document.body, init); });
        }

        expect(isHiddenAccessRevealed()).toBe(false);
    });

    it('is ignored while typing in a field, a text area, a select or editable content', () => {
        renderShortcut();
        const input = document.createElement('input');
        const textarea = document.createElement('textarea');
        const select = document.createElement('select');
        const editable = document.createElement('div');
        editable.contentEditable = 'true';
        // jsdom does not derive isContentEditable from the attribute.
        Object.defineProperty(editable, 'isContentEditable', { value: true });
        document.body.append(input, textarea, select, editable);

        for (const element of [input, textarea, select, editable]) {
            act(() => { fireEvent.keyDown(element, COMBINATION); });
        }

        expect(isHiddenAccessRevealed()).toBe(false);
        for (const element of [input, textarea, select, editable]) element.remove();
    });

    it('stops listening on unmount', () => {
        const { unmount } = renderShortcut();
        unmount();

        fireEvent.keyDown(document.body, COMBINATION);

        expect(isHiddenAccessRevealed()).toBe(false);
    });

    it('prevents the browser default only when it handles the combination', () => {
        renderShortcut();
        const handled = new KeyboardEvent('keydown', { ...COMBINATION, bubbles: true, cancelable: true });
        const other = new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', bubbles: true, cancelable: true });

        act(() => { document.body.dispatchEvent(handled); });
        act(() => { document.body.dispatchEvent(other); });

        expect(handled.defaultPrevented).toBe(true);
        expect(other.defaultPrevented).toBe(false);
    });
});

describe('useHiddenAccess', () => {
    it('reads the persisted flag', () => {
        localStorage.setItem('hmi:hidden-access', 'on');
        const { result } = renderHook(() => useHiddenAccess());

        expect(result.current).toBe(true);
    });
});
