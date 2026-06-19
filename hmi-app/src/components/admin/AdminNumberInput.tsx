import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { ADMIN_SIDEBAR_INPUT_CLS } from './adminSidebarStyles';

// =============================================================================
// AdminNumberInput
// Input numérico custom con flechas estilizadas admin-accent.
// Selecciona todo al focus para reemplazar el "0" fácilmente.
// =============================================================================

interface AdminNumberInputProps {
    inputId?: string;
    ariaLabel?: string;
    ariaInvalid?: boolean;
    value: number | string;
    onChange: (value: string) => void;
    step?: number;
    min?: number;
    max?: number;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    inputClassName?: string;
    onBlur?: () => void;
    /** When true, onChange fires only on blur and nudge — not on every keystroke.
     *  Use for config values like thresholds where intermediate values cause side effects. */
    commitOnBlur?: boolean;
    /** Fixed text rendered inside the input at the left edge (e.g. "%", "ms"). */
    prefix?: string;
}

export default function AdminNumberInput({
    inputId,
    ariaLabel,
    ariaInvalid = false,
    value,
    onChange,
    step = 1,
    min,
    max,
    placeholder,
    disabled = false,
    className = '',
    inputClassName = '',
    onBlur,
    commitOnBlur = false,
    prefix,
}: AdminNumberInputProps) {
    const [localValue, setLocalValue] = useState(String(value ?? ''));
    const [isFocused, setIsFocused] = useState(false);

    const resolvedValue = String(value ?? '');

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setLocalValue(e.target.value);
        if (!commitOnBlur) {
            onChange(e.target.value);
        }
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
        setLocalValue(resolvedValue);
        setIsFocused(true);
        e.target.select();
    };

    const commit = () => {
        const finalValue = (localValue === '' || localValue === '-') ? '0' : localValue;
        if (finalValue !== localValue) {
            setLocalValue(finalValue);
        }
        if (commitOnBlur) {
            onChange(finalValue);
        } else if (localValue === '' || localValue === '-') {
            onChange('0');
        }
    };

    const handleBlur = () => {
        setIsFocused(false);
        commit();
        onBlur?.();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && commitOnBlur) {
            e.currentTarget.blur();
        }
    };

    const nudge = (delta: number) => {
        const effectiveValue = isFocused ? localValue : resolvedValue;
        const current = parseFloat(effectiveValue) || 0;
        let next = parseFloat((current + delta).toFixed(10));
        if (min !== undefined) next = Math.max(min, next);
        if (max !== undefined) next = Math.min(max, next);
        setLocalValue(String(next));
        onChange(String(next));
    };

    return (
        <div className={`relative flex items-center ${className}`}>
            {prefix && (
                <span className={`absolute left-2 pointer-events-none ${disabled ? 'text-industrial-muted/40' : 'text-industrial-muted'}`}>
                    {prefix}
                </span>
            )}
            <input
                id={inputId}
                aria-label={ariaLabel}
                aria-invalid={ariaInvalid}
                type="text"
                inputMode="decimal"
                disabled={disabled}
                value={isFocused ? localValue : resolvedValue}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className={`${ADMIN_SIDEBAR_INPUT_CLS} w-full ${inputClassName} ${prefix ? 'pl-6' : 'pl-2'} pr-5 ${
                    disabled ? 'text-white/30 cursor-not-allowed' : 'text-white'
                }`}
            />
            {!disabled && (
                <div className="absolute right-0.5 top-0 bottom-0 flex flex-col justify-center">
                    <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={e => { e.preventDefault(); nudge(step); }}
                        className="flex items-center justify-center h-3 w-4 text-white/30 hover:text-admin-accent transition-colors"
                    >
                        <ChevronUp size={10} strokeWidth={2.5} />
                    </button>
                    <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={e => { e.preventDefault(); nudge(-step); }}
                        className="flex items-center justify-center h-3 w-4 text-white/30 hover:text-admin-accent transition-colors"
                    >
                        <ChevronDown size={10} strokeWidth={2.5} />
                    </button>
                </div>
            )}
        </div>
    );
}
