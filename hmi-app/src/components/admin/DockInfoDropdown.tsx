import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import AnchoredOverlay from '../ui/AnchoredOverlay';
import {
    ADMIN_SIDEBAR_DROPDOWN_PANEL_CLS,
    ADMIN_SIDEBAR_INPUT_TRIGGER_CLS,
    ADMIN_SIDEBAR_INPUT_TRIGGER_DISABLED_CLS,
    ADMIN_SIDEBAR_INPUT_TRIGGER_ENABLED_CLS,
} from './adminSidebarStyles';

interface DockInfoDropdownProps {
    value?: ReactNode;
    summary?: ReactNode;
    children: ReactNode;
    ariaLabel?: string;
    disabled?: boolean;
    className?: string;
    estimatedHeight?: number;
}

export default function DockInfoDropdown({
    value,
    summary,
    children,
    ariaLabel,
    disabled = false,
    className = '',
    estimatedHeight = 180,
}: DockInfoDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!disabled || !isOpen) {
            return;
        }

        const timeoutId = window.setTimeout(() => {
            setIsOpen(false);
        }, 0);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [disabled, isOpen]);

    const resolvedIsOpen = disabled ? false : isOpen;
    const resolvedSummary = value ?? summary ?? '—';

    return (
        <div className={`relative ${className}`.trim()}>
            <button
                ref={triggerRef}
                type="button"
                aria-label={ariaLabel}
                aria-expanded={resolvedIsOpen}
                disabled={disabled}
                onClick={() => {
                    if (!disabled) {
                        setIsOpen((previous) => !previous);
                    }
                }}
                className={`${ADMIN_SIDEBAR_INPUT_TRIGGER_CLS} ${disabled ? ADMIN_SIDEBAR_INPUT_TRIGGER_DISABLED_CLS : ADMIN_SIDEBAR_INPUT_TRIGGER_ENABLED_CLS}`}
            >
                <span className="truncate">{resolvedSummary}</span>
                <ChevronDown size={10} className={`shrink-0 text-white/40 transition-transform ${resolvedIsOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnchoredOverlay
                triggerRef={triggerRef}
                isOpen={resolvedIsOpen}
                onClose={() => setIsOpen(false)}
                estimatedHeight={estimatedHeight}
                minWidth="trigger"
                align="start"
                gap={4}
            >
                <div className={ADMIN_SIDEBAR_DROPDOWN_PANEL_CLS} style={{ background: 'var(--color-industrial-surface)' }}>
                    {children}
                </div>
            </AnchoredOverlay>
        </div>
    );
}
