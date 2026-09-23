import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useAutomaticViewportZoom } from './useAutomaticViewportZoom';
import { computeDampedViewportZoom } from '../utils/viewportScale';

function setInnerWidth(width: number) {
    Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: width,
    });
}

function readRootZoom(): string {
    return document.documentElement.style.getPropertyValue('zoom');
}

describe('useAutomaticViewportZoom', () => {
    const originalInnerWidth = window.innerWidth;

    afterEach(() => {
        setInnerWidth(originalInnerWidth);
        document.documentElement.style.removeProperty('zoom');
    });

    it('applies the computed damped zoom to the root element on mount', () => {
        setInnerWidth(1440);

        renderHook(() => useAutomaticViewportZoom());

        expect(readRootZoom()).toBe(String(computeDampedViewportZoom(1440)));
    });

    it('sets no zoom (exactly "1") at the 1920px design reference width', () => {
        setInnerWidth(1920);

        renderHook(() => useAutomaticViewportZoom());

        expect(readRootZoom()).toBe('1');
    });

    it('recomputes and updates the root zoom on window resize', () => {
        setInnerWidth(1440);
        renderHook(() => useAutomaticViewportZoom());
        expect(readRootZoom()).toBe(String(computeDampedViewportZoom(1440)));

        setInnerWidth(2560);
        window.dispatchEvent(new Event('resize'));

        expect(readRootZoom()).toBe(String(computeDampedViewportZoom(2560)));
    });

    it('removes the resize listener and clears the zoom style on unmount', () => {
        setInnerWidth(1440);
        const { unmount } = renderHook(() => useAutomaticViewportZoom());
        expect(readRootZoom()).toBe(String(computeDampedViewportZoom(1440)));

        unmount();
        expect(readRootZoom()).toBe('');

        setInnerWidth(2560);
        window.dispatchEvent(new Event('resize'));

        // No listener left after unmount: the style stays cleared.
        expect(readRootZoom()).toBe('');
    });

    it('recomposes an explicit fine-tune factor into the applied zoom', () => {
        setInnerWidth(1440);

        renderHook(() => useAutomaticViewportZoom(1.1));

        expect(readRootZoom()).toBe(String(computeDampedViewportZoom(1440, 1.1)));
    });
});
