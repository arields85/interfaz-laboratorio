import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalBackdropProps {
    /** Controls mount/unmount of the whole backdrop + panel. */
    open: boolean;
    onClose: () => void;
    children: ReactNode;
    /**
     * Extra classes appended after the base backdrop classes (e.g. an opacity/transition
     * utility for a fade-out). Never replaces the base backdrop treatment.
     */
    className?: string;
}

// Shared centered-modal backdrop primitive: the dark, blurred full-screen layer behind a
// centered panel, with Escape-to-close and click-outside-to-close. Originally owned by
// AdminDialog (T20); extracted so every centered modal — admin or not — gets the identical
// backdrop treatment instead of a copy-pasted div, per the project's anti-parche convention.
// Rendered through a portal into document.body: an ancestor with `backdrop-filter`, `filter`
// or `transform` (e.g. the topbar's `backdrop-blur-xl`) becomes the containing block of
// `position: fixed` descendants, which would confine the backdrop to that ancestor.
export default function ModalBackdrop({
    open,
    onClose,
    children,
    className = '',
}: ModalBackdropProps) {
    useEffect(() => {
        if (!open) return;

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleEscape);
        return () => {
            window.removeEventListener('keydown', handleEscape);
        };
    }, [open, onClose]);

    if (!open) return null;

    return createPortal(
        <div
            className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm ${className}`.trim()}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
            role="presentation"
        >
            {children}
        </div>,
        document.body,
    );
}

export type { ModalBackdropProps };
