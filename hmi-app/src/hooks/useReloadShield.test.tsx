import '@testing-library/jest-dom/vitest';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOT_SHIELD_ID, BOOT_SHIELD_MESSAGE } from './useBootShield';
import * as reloadShieldModule from './useReloadShield';

function mountDom() {
    document.body.innerHTML = `
        <div id="${BOOT_SHIELD_ID}" class="hmi-shield--hidden" data-hmi-shield-state="hidden" aria-hidden="true">texto viejo</div>
        <canvas data-hmi-shader-canvas="true"></canvas>
    `;
}

describe('useReloadShield', () => {
    let rafQueue: Array<{ id: number; callback: FrameRequestCallback }>;
    let nextRafId: number;
    let reloadCount: number;

    beforeEach(() => {
        mountDom();
        rafQueue = [];
        nextRafId = 1;
        reloadCount = 0;

        Object.defineProperty(document, 'hasFocus', {
            configurable: true,
            value: vi.fn(() => true),
        });

        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
            const id = nextRafId++;
            rafQueue.push({ id, callback });
            return id;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.spyOn(reloadShieldModule.reloadController, 'reload').mockImplementation(() => {
            reloadCount += 1;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    function flushAnimationFrame() {
        const currentQueue = rafQueue;
        rafQueue = [];

        for (const entry of currentQueue) {
            entry.callback(performance.now());
        }
    }

    function expectShieldMarkup(shield: HTMLElement | null) {
        expect(shield).not.toBeNull();
        expect(shield?.querySelector('[data-hmi-shield-typed]')).toHaveTextContent(BOOT_SHIELD_MESSAGE);
        expect(shield?.querySelector('[data-hmi-shield-caret]')).toHaveTextContent('_');
        expect(shield?.querySelector('[data-hmi-shield-caret]')).toHaveAttribute('aria-hidden', 'true');
        expect(shield?.querySelector('[data-hmi-shield-label]')).toBeNull();
        expect(shield?.querySelector('[data-hmi-shield-cursor-loader]')).toBeNull();
        expect(shield?.querySelector('[data-hmi-shield-loader-variant]')).toBeNull();
        expect((shield?.textContent?.match(/ACTUALIZANDO DATOS/g) ?? [])).toHaveLength(1);
    }

    it('intercepts Ctrl+Shift+R, reveals the shield, hides the shader canvas, and reloads after one frame', () => {
        renderHook(() => reloadShieldModule.useReloadShield());

        const event = new KeyboardEvent('keydown', {
            key: 'R',
            ctrlKey: true,
            shiftKey: true,
            cancelable: true,
        });

        document.dispatchEvent(event);

        const shield = document.getElementById(BOOT_SHIELD_ID);
        const shaderCanvas = document.querySelector(reloadShieldModule.RELOAD_HIDE_SELECTOR);

        expect(event.defaultPrevented).toBe(true);
        expect(shield).not.toHaveClass('hmi-shield--hidden');
        expect(shield).toHaveAttribute('data-hmi-shield-state', 'visible');
        expectShieldMarkup(shield);
        expect(shaderCanvas).toHaveAttribute('data-hmi-reload-hidden', 'true');
        expect(reloadCount).toBe(0);

        flushAnimationFrame();

        expect(reloadCount).toBe(1);
    });

    it('intercepts F5 and ignores repeated reload shortcuts once a reload is in flight', () => {
        renderHook(() => reloadShieldModule.useReloadShield());

        const firstEvent = new KeyboardEvent('keydown', {
            key: 'F5',
            cancelable: true,
        });
        const repeatedEvent = new KeyboardEvent('keydown', {
            key: 'r',
            ctrlKey: true,
            cancelable: true,
        });

        document.dispatchEvent(firstEvent);
        document.dispatchEvent(repeatedEvent);
        flushAnimationFrame();

        expect(firstEvent.defaultPrevented).toBe(true);
        expect(repeatedEvent.defaultPrevented).toBe(false);
        expect(reloadCount).toBe(1);
    });

    it('ignores non-cancelable events and removes listeners on cleanup', () => {
        const { unmount } = renderHook(() => reloadShieldModule.useReloadShield());

        const uncancelableEvent = new KeyboardEvent('keydown', {
            key: 'r',
            ctrlKey: true,
            cancelable: false,
        });

        document.dispatchEvent(uncancelableEvent);
        expect(reloadCount).toBe(0);

        unmount();

        const postCleanupEvent = new KeyboardEvent('keydown', {
            key: 'r',
            ctrlKey: true,
            cancelable: true,
        });

        document.dispatchEvent(postCleanupEvent);
        flushAnimationFrame();

        expect(postCleanupEvent.defaultPrevented).toBe(false);
        expect(reloadCount).toBe(0);
    });

    it('does not intercept reload shortcuts when the document is unfocused', () => {
        vi.mocked(document.hasFocus).mockReturnValue(false);

        renderHook(() => reloadShieldModule.useReloadShield());

        const unfocusedEvent = new KeyboardEvent('keydown', {
            key: 'r',
            ctrlKey: true,
            cancelable: true,
        });

        document.dispatchEvent(unfocusedEvent);
        flushAnimationFrame();

        const shield = document.getElementById(BOOT_SHIELD_ID);
        const shaderCanvas = document.querySelector(reloadShieldModule.RELOAD_HIDE_SELECTOR);

        expect(unfocusedEvent.defaultPrevented).toBe(false);
        expect(shield).toHaveClass('hmi-shield--hidden');
        expect(shaderCanvas).not.toHaveAttribute('data-hmi-reload-hidden');
        expect(reloadCount).toBe(0);
    });
});
