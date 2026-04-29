import '@testing-library/jest-dom/vitest';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOT_SHIELD_ID, BOOT_SHIELD_MESSAGE, BOOT_SHIELD_MIN_VISIBLE_MS, WEBGL_FIRST_DRAW_EVENT, useBootShield } from './useBootShield';
import { useReloadShield, reloadController } from './useReloadShield';

function mountDom() {
    document.body.innerHTML = `
        <div id="${BOOT_SHIELD_ID}" data-hmi-shield-state="visible">texto viejo</div>
        <canvas data-hmi-shader-canvas="true" data-hmi-webgl-ready="true"></canvas>
    `;
}

describe('shield lifecycle', () => {
    let rafQueue: Array<{ id: number; callback: FrameRequestCallback }>;
    let nextRafId: number;
    let reloadCount: number;

    beforeEach(() => {
        vi.useFakeTimers();
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
        vi.spyOn(reloadController, 'reload').mockImplementation(() => {
            reloadCount += 1;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
        document.body.innerHTML = '';
        Reflect.deleteProperty(document, 'fonts');
    });

    function flushAnimationFrames(count = 1) {
        for (let iteration = 0; iteration < count; iteration += 1) {
            const currentQueue = rafQueue;
            rafQueue = [];

            for (const entry of currentQueue) {
                entry.callback(performance.now());
            }
        }
    }

    it('lets the boot shield hide, then reuses the same node for keyboard reload shielding', async () => {
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: { ready: Promise.resolve() },
        });

        renderHook(() => {
            useBootShield();
            useReloadShield();
        });

        await act(async () => {
            await Promise.resolve();
        });

        act(() => {
            document.querySelector('canvas')?.dispatchEvent(new CustomEvent(WEBGL_FIRST_DRAW_EVENT, { bubbles: true }));
        });

        flushAnimationFrames(4);

        await act(async () => {
            vi.advanceTimersByTime(BOOT_SHIELD_MIN_VISIBLE_MS);
            await Promise.resolve();
            await Promise.resolve();
        });

        const shield = document.getElementById(BOOT_SHIELD_ID);
        expect(shield).toHaveClass('hmi-shield--hidden');
        expect(shield?.querySelector('[data-hmi-shield-typed]')).toHaveTextContent(BOOT_SHIELD_MESSAGE);
        expect(shield?.querySelector('[data-hmi-shield-caret]')).toHaveTextContent('_');
        expect(shield?.querySelector('[data-hmi-shield-caret]')).toHaveAttribute('aria-hidden', 'true');
        expect(shield?.querySelector('[data-hmi-shield-label]')).toBeNull();
        expect(shield?.querySelector('[data-hmi-shield-cursor-loader]')).toBeNull();
        expect(shield?.querySelector('[data-hmi-shield-loader-variant]')).toBeNull();
        expect((shield?.textContent?.match(/ACTUALIZANDO DATOS/g) ?? [])).toHaveLength(1);

        act(() => {
            shield?.dispatchEvent(new Event('transitionend'));
        });

        expect(document.getElementById(BOOT_SHIELD_ID)).toBe(shield);

        const reloadEvent = new KeyboardEvent('keydown', {
            key: 'r',
            ctrlKey: true,
            cancelable: true,
        });

        document.dispatchEvent(reloadEvent);

        expect(reloadEvent.defaultPrevented).toBe(true);
        expect(document.getElementById(BOOT_SHIELD_ID)).toBe(shield);
        expect(shield).not.toHaveClass('hmi-shield--hidden');
        expect(reloadCount).toBe(0);

        flushAnimationFrames(1);

        expect(reloadCount).toBe(1);
    });
});
