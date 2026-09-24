import type { ReactNode } from 'react';
import ModalBackdrop from '../ui/ModalBackdrop';

interface AdminDialogProps {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
    actions: ReactNode;
    maxWidth?: string;
}

export default function AdminDialog({
    open,
    title,
    onClose,
    children,
    actions,
    maxWidth = 'max-w-md',
}: AdminDialogProps) {
    return (
        <ModalBackdrop open={open} onClose={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className={`w-full ${maxWidth} rounded-xl border border-white/10 bg-industrial-surface p-6 shadow-2xl`}
            >
                <h3 className="uppercase text-white">{title}</h3>
                <div className="mt-4 space-y-4">{children}</div>
                <div className="mt-6 flex justify-end gap-2">{actions}</div>
            </div>
        </ModalBackdrop>
    );
}
