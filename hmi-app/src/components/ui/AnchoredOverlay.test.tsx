import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import AnchoredOverlay from './AnchoredOverlay';
import { resolveAnchoredOverlayStyle } from './anchoredOverlayStyle';

describe('AnchoredOverlay', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns only a bottom anchor when the overlay must open upward', () => {
        const trigger = document.createElement('button');

        Object.defineProperty(window, 'innerHeight', {
            configurable: true,
            value: 400,
        });

        vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
            x: 100,
            y: 320,
            width: 120,
            height: 32,
            top: 320,
            right: 220,
            bottom: 352,
            left: 100,
            toJSON: () => ({}),
        });

        const resolvedStyle = resolveAnchoredOverlayStyle(trigger, 120, 'trigger', 'start', 4);

        expect(resolvedStyle).toEqual(
            expect.objectContaining({
                bottom: 84,
            }),
        );
        expect(resolvedStyle).not.toHaveProperty('top');
    });

    it('applies pixel-based positioning styles to the rendered overlay DOM', () => {
        const trigger = document.createElement('button');
        const triggerRef: RefObject<HTMLElement | null> = { current: trigger };

        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            value: 1280,
        });

        Object.defineProperty(window, 'innerHeight', {
            configurable: true,
            value: 720,
        });

        vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
            x: 120,
            y: 200,
            width: 180,
            height: 32,
            top: 200,
            right: 300,
            bottom: 232,
            left: 120,
            toJSON: () => ({}),
        });

        render(
            <AnchoredOverlay triggerRef={triggerRef} isOpen onClose={vi.fn()} estimatedHeight={160} minWidth="trigger" align="start" gap={4}>
                <div data-testid="overlay-content">Overlay content</div>
            </AnchoredOverlay>,
        );

        const overlay = screen.getByTestId('overlay-content').parentElement;

        expect(overlay).not.toBeNull();
        expect(overlay).toHaveStyle({
            left: '120px',
            top: '236px',
            minWidth: '180px',
            visibility: 'visible',
        });
    });
});
