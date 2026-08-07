import { useEffect, useState, useRef, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import AnchoredOverlay from '../ui/AnchoredOverlay';
import {
    ADMIN_SIDEBAR_DROPDOWN_PANEL_CLS,
    ADMIN_SIDEBAR_INPUT_TRIGGER_CLS,
    ADMIN_SIDEBAR_INPUT_TRIGGER_DISABLED_CLS,
    ADMIN_SIDEBAR_INPUT_TRIGGER_ENABLED_CLS,
} from './adminSidebarStyles';

// =============================================================================
// AdminSelect
// Dropdown custom con estilo dark-theme y hover admin-accent.
// Usa AnchoredOverlay (createPortal + position:fixed) para escapar overflow:hidden.
// Posicionamiento inteligente delegado a AnchoredOverlay.
// =============================================================================

interface AdminSelectOption {
    value: string;
    label: string;
    icon?: ReactNode;
    disabled?: boolean;
}

interface AdminSelectProps {
    value: string;
    options: AdminSelectOption[];
    onChange: (value: string) => void;
    ariaLabel?: string;
    className?: string;
    placeholder?: string;
    disabled?: boolean;
    style?: CSSProperties;
}

export default function AdminSelect({ value, options, onChange, ariaLabel, className = '', placeholder, disabled = false, style }: AdminSelectProps) {
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

    const handleToggle = () => {
        if (disabled) {
            return;
        }

        setIsOpen(prev => !prev);
    };

    const estimatedHeight = Math.min(options.length * 30 + 8, 300);
    const resolvedIsOpen = disabled ? false : isOpen;
    const selected = options.find(o => o.value === value);
    const selectedLabel = selected?.label || placeholder || '—';

    return (
        <div className={`relative ${className}`} style={style}>
            <button
                ref={triggerRef}
                type="button"
                aria-label={ariaLabel}
                disabled={disabled}
                onClick={handleToggle}
                className={`${ADMIN_SIDEBAR_INPUT_TRIGGER_CLS} ${disabled ? ADMIN_SIDEBAR_INPUT_TRIGGER_DISABLED_CLS : ADMIN_SIDEBAR_INPUT_TRIGGER_ENABLED_CLS}`}
            >
                <span className="truncate flex items-center gap-1.5">
                    {selected?.icon && <span className="shrink-0 opacity-60">{selected.icon}</span>}
                    {selectedLabel}
                </span>
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
                <div
                    className={ADMIN_SIDEBAR_DROPDOWN_PANEL_CLS}
                    style={{ background: 'var(--color-industrial-surface)' }}
                >
                    {options.map(opt => (
                        <button
                            key={opt.value}
                            disabled={opt.disabled}
                            onClick={() => {
                                if (!opt.disabled) {
                                    onChange(opt.value);
                                    setIsOpen(false);
                                }
                            }}
                            className={`block w-full text-left px-3 py-1.5 whitespace-nowrap transition-colors ${
                                opt.disabled
                                    ? 'text-white/20 cursor-not-allowed'
                                    : value === opt.value
                                        ? 'text-admin-accent bg-white/5'
                                        : 'text-slate-400 hover:text-admin-accent hover:bg-white/5'
                            }`}
                        >
                            <span className="flex items-center gap-1.5">
                                {opt.icon && <span className="shrink-0 opacity-60">{opt.icon}</span>}
                                {opt.label}
                            </span>
                        </button>
                    ))}
                </div>
            </AnchoredOverlay>
        </div>
    );
}
