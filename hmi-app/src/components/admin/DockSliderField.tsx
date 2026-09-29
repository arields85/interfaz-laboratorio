import type { ReactNode } from 'react';
import { normalizeStepValue } from '../../utils/normalizeStepValue';
import AdminNumberInput from './AdminNumberInput';
import {
    ADMIN_SIDEBAR_LABEL_CLS,
    ADMIN_SIDEBAR_VALUE_INPUT_WIDTH_CLS,
} from './adminSidebarStyles';

export interface DockSliderFieldProps {
    label: ReactNode;
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (value: number) => void;
    ariaLabel?: string;
    numberInputAriaLabel?: string;
    numberInputClassName?: string;
    /** Short unit (e.g. "px", "%") shown right after the numeric field. */
    unit?: string;
    disabled?: boolean;
    className?: string;
}

export default function DockSliderField({
    label,
    value,
    min,
    max,
    step = 1,
    onChange,
    ariaLabel,
    numberInputAriaLabel,
    numberInputClassName = ADMIN_SIDEBAR_VALUE_INPUT_WIDTH_CLS,
    unit,
    disabled = false,
    className = '',
}: DockSliderFieldProps) {
    const resolvedAriaLabel = ariaLabel ?? (typeof label === 'string' ? label : undefined);
    const resolvedNumberInputAriaLabel = numberInputAriaLabel
        ?? (resolvedAriaLabel ? `${resolvedAriaLabel} value` : undefined);

    const handleNumericChange = (nextValue: string) => {
        const parsedValue = Number(nextValue);

        if (Number.isNaN(parsedValue)) {
            return;
        }

        onChange(normalizeStepValue(parsedValue, min, max, step));
    };

    return (
        <div className={`flex flex-col gap-2 ${className}`.trim()}>
            <div className="flex items-center justify-between gap-2">
                <span className={`${ADMIN_SIDEBAR_LABEL_CLS} w-auto min-w-0`}>
                    {label}
                </span>

                <div className="flex items-center gap-1">
                    <AdminNumberInput
                        value={value}
                        min={min}
                        max={max}
                        step={step}
                        disabled={disabled}
                        commitOnBlur
                        ariaLabel={resolvedNumberInputAriaLabel}
                        className={numberInputClassName}
                        onChange={handleNumericChange}
                    />
                    {unit && <span className="text-industrial-muted">{unit}</span>}
                </div>
            </div>

            <input
                aria-label={resolvedAriaLabel}
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={disabled}
                onChange={(event) => onChange(Number(event.target.value))}
                className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/8 accent-admin-accent disabled:cursor-not-allowed disabled:opacity-40 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-admin-accent [&::-webkit-slider-thumb]:shadow-[0_0_6px_var(--color-admin-accent)]"
            />
        </div>
    );
}
