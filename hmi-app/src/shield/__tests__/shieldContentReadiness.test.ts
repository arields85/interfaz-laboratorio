import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CONTENT_READY_ATTRIBUTE,
    CONTENT_READY_EVENT,
    DEFAULT_CONTENT_READY_TIMEOUT_MS,
    isShieldContentReady,
    resetShieldContentReady,
    signalShieldContentReady,
    waitForShieldContentReady,
} from '../shieldContentReadiness';

describe('shieldContentReadiness', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '<div id="root"></div>';
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    it('signals, detects, resets, and waits for coherent content readiness', async () => {
        const root = document.getElementById('root');
        const listener = new Promise<Event>((resolve) => {
            root?.addEventListener(CONTENT_READY_EVENT, resolve, { once: true });
        });
        const waiting = waitForShieldContentReady();

        expect(isShieldContentReady()).toBe(false);

        signalShieldContentReady();

        expect(root).toHaveAttribute(CONTENT_READY_ATTRIBUTE, 'true');
        expect(await listener).toBeInstanceOf(CustomEvent);
        await expect(waiting).resolves.toBeUndefined();

        resetShieldContentReady();

        expect(isShieldContentReady()).toBe(false);
    });

    it('resolves with the bounded fallback when coherent content never appears', async () => {
        const waiting = waitForShieldContentReady();

        await vi.advanceTimersByTimeAsync(DEFAULT_CONTENT_READY_TIMEOUT_MS - 1);
        expect(isShieldContentReady()).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await expect(waiting).resolves.toBeUndefined();
        expect(isShieldContentReady()).toBe(false);
    });
});
