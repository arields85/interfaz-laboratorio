import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ModalBackdrop from './ModalBackdrop';

describe('ModalBackdrop', () => {
    it('renders into document.body so an ancestor with a filter or transform cannot trap it', () => {
        // Regression (PW-006 T20): the pairing modal lives inside the topbar, whose
        // `backdrop-blur-xl` makes it the containing block for `position: fixed`
        // descendants — the backdrop covered only the topbar and the panel stuck to it.
        const { container } = render(
            <header style={{ backdropFilter: 'blur(8px)' }}>
                <ModalBackdrop open onClose={() => undefined}>
                    <div role="dialog">panel</div>
                </ModalBackdrop>
            </header>,
        );

        const backdrop = screen.getByRole('presentation');
        expect(backdrop.parentElement).toBe(document.body);
        expect(container.contains(backdrop)).toBe(false);
        expect(screen.getByRole('dialog')).toHaveTextContent('panel');
    });

    it('renders nothing when closed', () => {
        render(
            <ModalBackdrop open={false} onClose={() => undefined}>
                <div role="dialog">panel</div>
            </ModalBackdrop>,
        );

        expect(screen.queryByRole('presentation')).toBeNull();
    });

    it('closes on Escape and on a click outside the panel', () => {
        const onClose = vi.fn();
        render(
            <ModalBackdrop open onClose={onClose}>
                <div role="dialog">panel</div>
            </ModalBackdrop>,
        );

        fireEvent.keyDown(window, { key: 'Escape' });
        fireEvent.mouseDown(screen.getByRole('presentation'));
        fireEvent.mouseDown(screen.getByRole('dialog'));

        expect(onClose).toHaveBeenCalledTimes(2);
    });
});
