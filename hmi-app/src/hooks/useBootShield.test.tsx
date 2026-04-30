import '@testing-library/jest-dom/vitest';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    BOOT_SHIELD_ID,
    BOOT_SHIELD_MESSAGE,
    BOOT_SHIELD_MIN_VISIBLE_MS,
    BOOT_SHIELD_TIMEOUT_MS,
    BOOT_SHIELD_TRANSITION_FALLBACK_MS,
    SHADER_CANVAS_SELECTOR,
    WEBGL_FIRST_DRAW_EVENT,
    getRequiredFontChecks,
    useBootShield,
} from './useBootShield';

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
    let resolve!: Deferred<T>['resolve'];
    let reject!: Deferred<T>['reject'];
    const promise = new Promise<T>((innerResolve, innerReject) => {
        resolve = innerResolve;
        reject = innerReject;
    });

    return { promise, resolve, reject };
}

function mountShield(className = ''): HTMLDivElement {
    document.body.innerHTML = `
        <div
            id="${BOOT_SHIELD_ID}"
            data-hmi-shield-state="visible"
            class="${className}"
        >
            texto viejo
        </div>
    `;

    return document.getElementById(BOOT_SHIELD_ID) as HTMLDivElement;
}

function expectShieldMarkup(shield: HTMLElement) {
    const typewriter = shield.querySelector<HTMLElement>('[data-hmi-shield-typewriter]');
    expect(typewriter).not.toBeNull();

    const typed = shield.querySelector<HTMLElement>('[data-hmi-shield-typed]');
    expect(typed).not.toBeNull();
    expect(typed).toHaveTextContent(BOOT_SHIELD_MESSAGE);

    const caret = shield.querySelector<HTMLElement>('[data-hmi-shield-caret]');
    expect(caret).not.toBeNull();
    expect(caret).toHaveAttribute('aria-hidden', 'true');
    expect(caret).toHaveTextContent('_');

    expect(shield.querySelector('[data-hmi-shield-label]')).toBeNull();
    expect(shield.querySelector('[data-hmi-shield-cursor-loader]')).toBeNull();
    expect(typewriter?.querySelectorAll('span')).toHaveLength(2);
    expect(shield.querySelector('[data-hmi-shield-loader-rows]')).toBeNull();
    expect(shield.querySelector('[data-hmi-shield-loader-row]')).toBeNull();
    expect(shield.querySelector('[data-hmi-shield-loader-variant]')).toBeNull();
    expect(shield.querySelector('[data-hmi-shield-loader-segment]')).toBeNull();
    expect(shield).toHaveTextContent(BOOT_SHIELD_MESSAGE);
}

function mountShaderCanvas(attributes: Record<string, string> = {}): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('data-hmi-shader-canvas', 'true');

    for (const [key, value] of Object.entries(attributes)) {
        canvas.setAttribute(key, value);
    }

    document.body.appendChild(canvas);
    return canvas;
}

describe('useBootShield', () => {
    let rafQueue: Array<{ id: number; callback: FrameRequestCallback }>;
    let cancelled: Set<number>;
    let nextRafId: number;

    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
        rafQueue = [];
        cancelled = new Set<number>();
        nextRafId = 1;

        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
            const id = nextRafId++;
            rafQueue.push({ id, callback });
            return id;
        }));

        vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
            cancelled.add(id);
        }));

        vi.stubGlobal('getComputedStyle', vi.fn(() => ({
            getPropertyValue: (property: string) => {
                switch (property) {
                    case '--font-system':
                        return '"JetBrainsMono", monospace';
                    case '--font-weight-system':
                        return '400';
                    case '--font-size-system':
                        return '11px';
                    case '--font-mono':
                        return '"IBMPlexMono", monospace';
                    case '--font-weight-mono':
                        return '400';
                    case '--font-size-mono':
                        return '10px';
                    case '--font-dashboard-title':
                        return '"Magistral", sans-serif';
                    case '--font-weight-dashboard-title':
                        return '400';
                    case '--font-size-dashboard-title':
                        return '48px';
                    default:
                        return '';
                }
            },
        })));
    });

    afterEach(() => {
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
                if (!cancelled.has(entry.id)) {
                    entry.callback(performance.now());
                }
            }
        }
    }

    it('waits for visual stability before hiding the shield, normalizes the loader markup, and keeps it reusable', async () => {
        const fontsReady = createDeferred<void>();
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: {
                ready: fontsReady.promise,
                check: vi.fn(() => true),
            },
        });
        const shield = mountShield();
        const shaderCanvas = mountShaderCanvas();

        renderHook(() => useBootShield());

        flushAnimationFrames(2);
        expect(shield).not.toHaveClass('hmi-shield--hidden');
        expectShieldMarkup(shield);

        await act(async () => {
            fontsReady.resolve(undefined);
            await Promise.resolve();
            await Promise.resolve();
        });

        act(() => {
            shaderCanvas.setAttribute('data-hmi-webgl-ready', 'true');
            shaderCanvas.dispatchEvent(new CustomEvent(WEBGL_FIRST_DRAW_EVENT, { bubbles: true }));
        });

        expect(document.querySelector(SHADER_CANVAS_SELECTOR)).toBe(shaderCanvas);

        await act(async () => {
            await Promise.resolve();
        });

        flushAnimationFrames(4);
        expect(shield).not.toHaveClass('hmi-shield--hidden');

        await act(async () => {
            vi.advanceTimersByTime(BOOT_SHIELD_MIN_VISIBLE_MS - 1);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(shield).not.toHaveClass('hmi-shield--hidden');

        await act(async () => {
            vi.advanceTimersByTime(1);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(shield).toHaveClass('hmi-shield--hidden');
        expect(shield).toHaveAttribute('data-hmi-shield-state', 'hidden');
        expect(shield).toHaveAttribute('aria-hidden', 'true');
        expectShieldMarkup(shield);

        act(() => {
            shield.dispatchEvent(new Event('transitionend'));
        });

        expect(document.getElementById(BOOT_SHIELD_ID)).toBe(shield);
    });

    it('resolves the runtime typography font checks from canonical CSS tokens before releasing the shield', async () => {
        const check = vi.fn(() => true);
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: {
                ready: Promise.resolve(),
                check,
            },
        });

        mountShield();
        mountShaderCanvas({ 'data-hmi-webgl-ready': 'true' });

        renderHook(() => useBootShield());

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(getRequiredFontChecks()).toEqual([
            '400 11px "JetBrainsMono"',
            '400 10px "IBMPlexMono"',
            '400 48px "Magistral"',
        ]);
        expect(check.mock.calls.map(([font]) => font)).toEqual(getRequiredFontChecks());
    });

    it('uses the typography selected through runtime admin design tokens instead of fixed font names', () => {
        vi.stubGlobal('getComputedStyle', vi.fn(() => ({
            getPropertyValue: (property: string) => {
                switch (property) {
                    case '--font-system':
                        return '"Poppins"';
                    case '--font-weight-system':
                        return '300';
                    case '--font-size-system':
                        return '14px';
                    case '--font-mono':
                        return '"IBMPlexSans"';
                    case '--font-weight-mono':
                        return '600';
                    case '--font-size-mono':
                        return '12px';
                    case '--font-dashboard-title':
                        return '"SpaceGrotesk"';
                    case '--font-weight-dashboard-title':
                        return '700';
                    case '--font-size-dashboard-title':
                        return '56px';
                    default:
                        return '';
                }
            },
        })));

        expect(getRequiredFontChecks()).toEqual([
            '300 14px "Poppins"',
            '600 12px "IBMPlexSans"',
            '700 56px "SpaceGrotesk"',
        ]);
    });

    it('returns an empty runtime font-check list when canonical CSS tokens are unresolvable', () => {
        vi.stubGlobal('getComputedStyle', vi.fn(() => ({
            getPropertyValue: () => '',
        })));

        expect(getRequiredFontChecks()).toEqual([]);
    });

    it('treats missing runtime font tokens as ready so the bounded timeout path stays unchanged', () => {
        const check = vi.fn(() => false);
        vi.stubGlobal('getComputedStyle', vi.fn(() => ({
            getPropertyValue: () => '',
        })));
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: {
                check,
            },
        });

        expect(getRequiredFontChecks()).toEqual([]);
        expect(check).not.toHaveBeenCalled();
        expect(() => renderHook(() => useBootShield())).not.toThrow();
    });

    it('falls back without FontFaceSet support and leaves the hidden shield reusable after the transition timeout', async () => {
        const shield = mountShield();

        renderHook(() => useBootShield());

        expectShieldMarkup(shield);

        await act(async () => {
            await Promise.resolve();
        });

        flushAnimationFrames(4);

        await act(async () => {
            vi.advanceTimersByTime(BOOT_SHIELD_MIN_VISIBLE_MS);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(shield).toHaveClass('hmi-shield--hidden');
        expect(document.getElementById(BOOT_SHIELD_ID)).toBe(shield);

        act(() => {
            vi.advanceTimersByTime(BOOT_SHIELD_TRANSITION_FALLBACK_MS);
        });

        expect(document.getElementById(BOOT_SHIELD_ID)).toBe(shield);
        expect(shield).toHaveClass('hmi-shield--hidden');
    });

    it('uses the bounded timeout when readiness never resolves', async () => {
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: { ready: new Promise<void>(() => undefined) },
        });
        const shield = mountShield();

        renderHook(() => useBootShield());

        act(() => {
            vi.advanceTimersByTime(BOOT_SHIELD_TIMEOUT_MS);
        });

        await act(async () => {
            await Promise.resolve();
        });

        expect(shield).toHaveClass('hmi-shield--hidden');
        expect(shield).toHaveAttribute('data-hmi-shield-state', 'hidden');
    });

    it('is safe when the shield is already hidden or absent', () => {
        const hiddenShield = mountShield('hmi-shield--hidden');

        expect(() => {
            renderHook(() => useBootShield());
        }).not.toThrow();
        expect(hiddenShield).toHaveClass('hmi-shield--hidden');
        expect(hiddenShield).toHaveTextContent('texto viejo');

        hiddenShield.remove();

        expect(() => {
            renderHook(() => useBootShield());
        }).not.toThrow();
    });
});
