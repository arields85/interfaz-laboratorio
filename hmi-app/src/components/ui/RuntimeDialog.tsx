import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import HmiButton from './HmiButton';

interface RuntimeDialogProps {
    children: ReactNode;
    maxWidth?: string;
    onClose: () => void;
    open: boolean;
    title: string;
}

export default function RuntimeDialog({
    children,
    maxWidth = 'max-w-3xl',
    onClose,
    open,
    title,
}: RuntimeDialogProps) {
    useEffect(() => {
        if (!open) {
            return;
        }

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [onClose, open]);

    if (!open) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 z-[200] grid place-items-center bg-industrial-bg/80 p-6 backdrop-blur-lg"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className={`glass-panel flex w-full ${maxWidth} max-h-[calc(100vh-3rem)] min-h-0 flex-col p-6`}
            >
                <div className="flex flex-none items-start justify-between gap-4 pb-5">
                    <h2 className="font-system text-industrial-text">{title}</h2>
                    <HmiButton
                        size="sm"
                        variant="secondary"
                        className="size-[30px] p-1"
                        aria-label="Cerrar"
                        onClick={onClose}
                    >
                        <X size={16} strokeWidth={2} aria-hidden="true" />
                    </HmiButton>
                </div>
                <div className="hmi-scrollbar min-h-0 overflow-y-auto">{children}</div>
            </section>
        </div>
    );
}

export type { RuntimeDialogProps };
